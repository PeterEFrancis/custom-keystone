// Export layout coordinates (millimetres, top-left origin) without baking in
// projector calibration, panning, display colors, or the projection viewport.
const POINTS_PER_MM = 72 / 25.4;
const MAX_RASTER_PIXELS = 4_000_000;
const MAX_RASTER_SIDE = 4096;
const RASTER_DPI = 150;

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

function aborted(signal) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function hasLayers(doc) {
  const layers = typeof doc.getLayers === 'function' ? doc.getLayers() : doc.layers;
  return Array.isArray(layers) ? layers.length > 0 : Boolean(layers && Object.keys(layers).length);
}

function pageBox(page) {
  // PDF viewers use the intersection of the CropBox and MediaBox. A source
  // CropBox need not begin at (0, 0), and its page rotation is applied later.
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const left = Math.max(crop.x, media.x);
  const bottom = Math.max(crop.y, media.y);
  const right = Math.min(crop.x + crop.width, media.x + media.width);
  const top = Math.min(crop.y + crop.height, media.y + media.height);
  if (right <= left || top <= bottom) throw new Error('The PDF page has an invalid crop box.');
  return { left, bottom, right, top };
}

function tileGeometry(tile, layoutHeight, pointsPerMm) {
  const crop = { top: 0, right: 0, bottom: 0, left: 0, ...tile.crop };
  const x = (tile.x - crop.left) * pointsPerMm;
  const y = (layoutHeight - tile.y + crop.top - tile.pageHeight) * pointsPerMm;
  return {
    x, y,
    width: tile.pageWidth * pointsPerMm,
    height: tile.pageHeight * pointsPerMm,
    clip: {
      x: tile.x * pointsPerMm,
      y: (layoutHeight - tile.y - tile.height) * pointsPerMm,
      width: tile.width * pointsPerMm,
      height: tile.height * pointsPerMm,
    },
  };
}

function validateLayout(layout) {
  positive(layout?.width, 'Pattern width');
  positive(layout?.height, 'Pattern height');
  if (!Array.isArray(layout.tiles) || !layout.tiles.length) throw new Error('There are no pages to export.');
  for (const tile of layout.tiles) {
    if (!Number.isInteger(tile.pageIndex) || tile.pageIndex < -1) throw new Error('The page layout is invalid.');
    positive(tile.width, 'Tile width');
    positive(tile.height, 'Tile height');
    positive(tile.pageWidth, 'Source page width');
    positive(tile.pageHeight, 'Source page height');
    if (![tile.x, tile.y, ...Object.values(tile.crop || {})].every(Number.isFinite)) {
      throw new Error('The page layout contains invalid coordinates.');
    }
  }
}

async function canvasPng(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Could not encode the rendered page.')),
    'image/png',
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Export a single stitched PDF page at exact physical dimensions.
 *
 * `scale` applies the user-selected source correction and pattern scale. The
 * layout itself stays in its original millimetres. Ordinary PDF pages remain
 * vectors. Layered PDFs, annotated PDFs, SVGs, and images are rendered one page
 * at a time so current layer visibility survives without a giant bitmap.
 *
 * The returned Blob has an `exportInfo` property with mode, warnings, dimensions,
 * and filename so callers can explain any raster fallback beside the download.
 */
export async function exportPatternPdf(doc, layout, {
  name = 'stitched-pattern.pdf', scale = 1, signal, onProgress,
  _rasterFallback = false,
} = {}) {
  validateLayout(layout);
  positive(scale, 'Pattern scale');
  if (!doc) throw new Error('Open a document before exporting.');
  aborted(signal);
  const lib = await import('./vendor/pdf-lib/pdf-lib.esm.min.js');
  const { PDFDocument, PDFName, PDFNumber, degrees, rgb,
    pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = lib;
  const output = await PDFDocument.create();
  const widthMm = layout.width * scale;
  const heightMm = layout.height * scale;
  // /UserUnit keeps very long patterns within PDF's 14,400-unit page limit.
  const userUnit = Math.max(1, Math.ceil(Math.max(widthMm, heightMm) * POINTS_PER_MM / 14400));
  if (userUnit > 75000) throw new Error('This pattern is too large to export as one PDF page.');
  const pointsPerMm = POINTS_PER_MM * scale / userUnit;
  const outputPage = output.addPage([layout.width * pointsPerMm, layout.height * pointsPerMm]);
  if (userUnit > 1) outputPage.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
  output.setTitle(String(name).replace(/\.pdf$/i, ''));
  output.setCreator('Keystone');
  output.setSubject(`Stitched pattern at ${scale * 100}% scale. Print at actual size.`);
  output.catalog.getOrCreateViewerPreferences().setPrintScaling(lib.PrintScaling.None);
  const warnings = new Set();
  const resources = new Map();
  let vectorSource = null;
  if (_rasterFallback) warnings.add('Some source PDF features require rendered export.');
  if (!_rasterFallback && doc.type === 'pdf' && typeof doc.copyBytes === 'function' && !hasLayers(doc)) {
    try {
      vectorSource = await PDFDocument.load(await doc.copyBytes());
    } catch {
      warnings.add('Some source PDF features require rendered export.');
    }
  }
  let vectorCount = 0;
  let rasterCount = 0;

  async function getResource(tile) {
    const key = `${tile.pageIndex}:${tile.pageWidth}:${tile.pageHeight}`;
    if (resources.has(key)) return resources.get(key);
    let resource;
    if (vectorSource && tile.pageIndex < vectorSource.getPageCount()) {
      const page = vectorSource.getPage(tile.pageIndex);
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      // Appearance streams and layer visibility are rendered by the document
      // source; embedding only the page content would silently drop them.
      const annotations = page.node.Annots();
      if (rotation % 90 === 0 && (!annotations || annotations.size() === 0)) {
        try {
          const embedded = await output.embedPage(page, pageBox(page));
          // Embed now, so unsupported streams fall back before drawing them.
          await embedded.embed();
          resource = { kind: 'vector', embedded, rotation };
        } catch (cause) {
          // An unsuccessful embed is still registered in pdf-lib's document.
          // Restart in a clean document; otherwise saving retries that failure.
          const error = new Error('The source page needs rendered export.', { cause });
          error.needsRasterFallback = true;
          throw error;
        }
      }
    }
    if (!resource) resource = await renderResource(doc, tile, output, { signal, scale });
    resources.set(key, resource);
    return resource;
  }

  for (let index = 0; index < layout.tiles.length; index++) {
    aborted(signal);
    const tile = layout.tiles[index];
    const geometry = tileGeometry(tile, layout.height, pointsPerMm);
    const { clip: bounds } = geometry;
    outputPage.pushOperators(pushGraphicsState(), rectangle(bounds.x, bounds.y, bounds.width, bounds.height), clip(), endPath());
    // Match the opaque white canvas tiles used by the viewer, including overlaps.
    outputPage.drawRectangle({ ...bounds, color: rgb(1, 1, 1), borderWidth: 0 });
    if (tile.pageIndex >= 0) {
      let resource;
      try {
        resource = await getResource(tile);
      } catch (error) {
        if (error.needsRasterFallback && !_rasterFallback) {
          return exportPatternPdf(doc, layout, { name, scale, signal, onProgress, _rasterFallback: true });
        }
        throw error;
      }
      aborted(signal);
      if (resource.kind === 'vector') {
        const { embedded, rotation } = resource;
        const sideways = rotation === 90 || rotation === 270;
        let { x, y } = geometry;
        if (rotation === 90 || rotation === 180) y += geometry.height;
        if (rotation === 180 || rotation === 270) x += geometry.width;
        outputPage.drawPage(embedded, {
          x, y,
          width: sideways ? geometry.height : geometry.width,
          height: sideways ? geometry.width : geometry.height,
          rotate: degrees(-rotation),
        });
        vectorCount++;
      } else {
        outputPage.drawImage(resource.embedded, {
          x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
        });
        rasterCount++;
        if (resource.limited) warnings.add('Large pages were rendered at a reduced resolution to limit memory use.');
      }
    }
    outputPage.pushOperators(popGraphicsState());
    onProgress?.({ completed: index + 1, total: layout.tiles.length });
  }
  if (rasterCount) warnings.add('Rendered pages preserve visible layers, but their lines and text are rasterized and layers are flattened.');
  aborted(signal);
  const bytes = await output.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  Object.defineProperty(blob, 'exportInfo', { value: Object.freeze({
    name, mode: rasterCount ? (vectorCount ? 'mixed' : 'raster') : 'vector',
    warnings: [...warnings], widthMm, heightMm, scale,
  }) });
  return blob;
}

async function renderResource(doc, tile, output, { signal, scale }) {
  const desired = RASTER_DPI / 25.4 * scale;
  const pixelsPerMm = Math.min(desired,
    MAX_RASTER_SIDE / Math.max(tile.pageWidth, tile.pageHeight),
    Math.sqrt(MAX_RASTER_PIXELS / (tile.pageWidth * tile.pageHeight)));
  aborted(signal);
  const rendered = await doc.renderPage(tile.pageIndex, { pixelsPerMm, signal });
  const canvas = rendered?.canvas || rendered;
  if (!canvas || !Number.isFinite(canvas.width) || !canvas.width || !canvas.height) {
    throw new Error('This document page could not be rendered for export.');
  }
  let bytes;
  try {
    aborted(signal);
    bytes = await canvasPng(canvas);
  } finally {
    // renderPage gives ownership of a fresh canvas to this caller.
    canvas.width = 0;
    canvas.height = 0;
  }
  const embedded = await output.embedPng(bytes);
  await embedded.embed();
  return { kind: 'raster', embedded, limited: pixelsPerMm < desired * 0.99 };
}
