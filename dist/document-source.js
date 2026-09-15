// Local document decoding. The caller owns canvas caching and render scheduling.
const MM_PER_POINT = 25.4 / 72;
const MM_PER_PIXEL = 25.4 / 96;
const MAX_PIXELS = 8_000_000;
const MAX_AXIS = 8192;
const SVG_NS = 'http://www.w3.org/2000/svg';
let pdfLibraryPromise;

function cancelled(message = 'The operation was cancelled.') {
  return new DOMException(message, 'AbortError');
}

function checkSignals(...signals) {
  for (const signal of signals) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : cancelled();
  }
}

function abortable(promise, signals = [], onAbort) {
  return new Promise((resolve, reject) => {
    const clean = () => signals.forEach(signal => signal?.removeEventListener('abort', abort));
    const abort = () => {
      clean();
      try { onAbort?.(); } catch { /* Cancellation cleanup is best effort. */ }
      try { checkSignals(...signals); } catch (error) { reject(error); }
    };
    for (const signal of signals) signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
    if (signals.some(signal => signal?.aborted)) abort();
  });
}

function progress(callback, phase, loaded, total) {
  // A progress display should never make an otherwise valid document fail.
  try { callback?.({ phase, loaded, total }); } catch { /* Ignore UI callback errors. */ }
}

function dimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('This file has invalid page dimensions.');
  }
  return { widthMm: width, heightMm: height };
}

function boundedPixels(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The requested render size is invalid.');
  }
  let scale = Math.min(1, MAX_AXIS / width, MAX_AXIS / height);
  const area = (width * scale) * (height * scale);
  if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function canvasFor(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser could not create a document canvas.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

function validateRender(index, count, pixelsPerMm, ...signals) {
  checkSignals(...signals);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new RangeError('The page does not exist.');
  if (!Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0) throw new RangeError('Render resolution must be positive.');
}

async function readBlob(file, signal, asText = false, onProgress) {
  checkSignals(signal);
  const reader = new FileReader();
  const promise = new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The file could not be read. Please select it again.'));
    reader.onabort = () => reject(cancelled());
    reader.onprogress = event => progress(onProgress, 'read', event.loaded, event.total || file.size);
    if (asText) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
  try { return await abortable(promise, [signal], () => reader.abort()); }
  finally { reader.onload = reader.onerror = reader.onabort = reader.onprogress = null; }
}

async function pdfLibrary(signal) {
  pdfLibraryPromise ??= import('./vendor/pdfjs/build/pdf.min.mjs').catch(error => {
    pdfLibraryPromise = null;
    throw error;
  });
  const library = await abortable(pdfLibraryPromise, [signal]);
  library.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/build/pdf.worker.min.mjs', import.meta.url).href;
  return library;
}

async function loadPdf(file, { signal: externalSignal, onProgress, onPassword }) {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const externalAbort = () => lifetime.abort(cancelled());
  externalSignal?.addEventListener('abort', externalAbort, { once: true });
  if (externalSignal?.aborted) externalAbort();
  let loadingTask, destroyPromise, disposed = false;
  const renders = new Set();
  const destroy = () => {
    for (const task of renders) task.cancel();
    if (loadingTask) destroyPromise ??= loadingTask.destroy().catch(() => {});
    return destroyPromise;
  };
  signal.addEventListener('abort', destroy, { once: true });
  try {
    const library = await pdfLibrary(signal);
    const data = new Uint8Array(await readBlob(file, signal, false, onProgress));
    checkSignals(signal);
    const assetBase = new URL('./vendor/pdfjs/', import.meta.url).href;
    loadingTask = library.getDocument({
      data,
      cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`, iccUrl: `${assetBase}iccs/`,
      isEvalSupported: false,
      enableXfa: false,
    });
    loadingTask.onProgress = ({ loaded, total }) => progress(onProgress, 'read', loaded, total || file.size);
    loadingTask.onPassword = (updatePassword, reason) => {
      void (async () => {
        if (!onPassword) throw new Error('This PDF needs a password. Open an unlocked copy or provide its password.');
        const password = await abortable(Promise.resolve().then(() => onPassword(reason)), [signal]);
        checkSignals(signal);
        if (password === null || password === undefined) throw cancelled('Password entry was cancelled.');
        updatePassword(String(password));
      })().catch(error => lifetime.abort(error instanceof Error ? error : new Error('The PDF password could not be read.')));
    };
    const pdf = await abortable(loadingTask.promise, [signal]);
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('This PDF has no pages.');
    const pages = new Array(pdf.numPages);
    let nextPage = 0, completed = 0;
    const readPageSizes = async () => {
      while (nextPage < pages.length) {
        checkSignals(signal);
        const index = nextPage++;
        const page = await abortable(pdf.getPage(index + 1), [signal]);
        try {
          const view = page.getViewport({ scale: 1 });
          // getViewport already applies page rotation and PDF /UserUnit.
          pages[index] = {
            ...dimensions(view.width * MM_PER_POINT, view.height * MM_PER_POINT),
            rotation: ((page.rotate % 360) + 360) % 360,
            userUnit: page.userUnit,
          };
          progress(onProgress, 'metadata', ++completed, pages.length);
        } finally { page.cleanup(); }
      }
    };
    const [optionalContent] = await Promise.all([
      abortable(pdf.getOptionalContentConfig({ intent: 'display' }), [signal]),
      Promise.all(Array.from({ length: Math.min(4, pages.length) }, readPageSizes)),
    ]);
    checkSignals(signal);
    // PDF.js 6 exposes an iterator; older getGroups() is no longer available.
    const layers = Array.from(optionalContent, ([id, group], index) => ({
      id: String(id), name: String(group.name || `Layer ${index + 1}`), visible: !!group.visible,
    }));
    const source = {
      name: String(file.name || 'Document.pdf'), type: 'pdf', format: 'pdf', pages, layers,
      physicalScaleKnown: true,
      get layersModified() { return !optionalContent.hasInitialVisibility; },
      async copyBytes() { return new Uint8Array(await readBlob(file, signal)); },
      setLayerVisible(id, visible) {
        checkSignals(signal);
        if (!optionalContent.getGroup(String(id))) return false;
        optionalContent.setVisibility(String(id), !!visible);
        // Selecting a radio-group layer may change another layer too.
        for (const layer of layers) layer.visible = !!optionalContent.getGroup(layer.id)?.visible;
        return true;
      },
      async renderPage(index, { pixelsPerMm = 4, signal: renderSignal } = {}) {
        validateRender(index, pages.length, pixelsPerMm, signal, renderSignal);
        let canvas, page, renderTask;
        try {
          page = await abortable(pdf.getPage(index + 1), [signal, renderSignal]);
          const base = page.getViewport({ scale: 1 });
          const size = boundedPixels(pages[index].widthMm * pixelsPerMm, pages[index].heightMm * pixelsPerMm);
          const scale = Math.min(size.width / base.width, size.height / base.height);
          const viewport = page.getViewport({ scale });
          const target = canvasFor(size.width, size.height);
          canvas = target.canvas;
          canvas.setAttribute('aria-label', `Page ${index + 1}`);
          checkSignals(signal, renderSignal);
          // Snapshot visibility so a layer change cannot partially affect an in-flight render.
          const config = optionalContent.constructor.fromSerializable(optionalContent.serializable);
          renderTask = page.render({
            canvasContext: target.context, viewport,
            background: '#ffffff', intent: 'display',
            optionalContentConfigPromise: Promise.resolve(config),
          });
          renders.add(renderTask);
          await abortable(renderTask.promise, [signal, renderSignal], () => renderTask.cancel());
          checkSignals(signal, renderSignal);
          return canvas;
        } catch (error) {
          if (canvas) canvas.width = canvas.height = 0;
          checkSignals(signal, renderSignal);
          throw error;
        } finally {
          if (renderTask) renders.delete(renderTask);
          page?.cleanup();
        }
      },
      dispose() {
        if (!disposed) { disposed = true; lifetime.abort(cancelled('The document was closed.')); }
        return destroy();
      },
    };
    progress(onProgress, 'ready', pages.length, pages.length);
    checkSignals(signal);
    return source;
  } catch (error) {
    lifetime.abort(error);
    await destroy();
    if (error?.name === 'PasswordException') throw new Error('This PDF needs a password. Please open an unlocked copy.');
    if (error?.name === 'InvalidPDFException') throw new Error('This PDF is damaged or is not a valid PDF.');
    throw error;
  } finally { externalSignal?.removeEventListener('abort', externalAbort); }
}

function safeCss(value) {
  // Decode escapes before checking URLs; escaped url()/@import must not bypass filtering.
  const decoded = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n\f])/gi,
    (_, hex, character) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : character);
  if (/@|expression\s*\(|image-set\s*\(|src\s*\(|-moz-binding|behavior\s*:/i.test(decoded)) return '';
  let invalid = false;
  const checked = decoded.replace(/url\s*\(([^)]*)\)/gi, (_, raw) => {
    const reference = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (!/^#[^\s"'()<>]+$/.test(reference)) { invalid = true; return ''; }
    return `url("${reference}")`;
  });
  if (invalid || /url\s*\(/i.test(checked.replace(/url\("#[^"()]+"\)/g, ''))) return '';
  return checked;
}

function svgLength(value) {
  const match = String(value || '').trim().match(/^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|in|pt|pc|px|q)?$/i);
  if (!match) return null;
  const number = Number(match[1]), unit = (match[2] || 'px').toLowerCase();
  const factors = { mm: 1, cm: 10, in: 25.4, pt: MM_PER_POINT, pc: 25.4 / 6, px: MM_PER_PIXEL, q: 0.25 };
  const mm = number * factors[unit];
  return Number.isFinite(mm) && mm > 0 ? { mm, physical: unit !== 'px' } : null;
}

function prepareSvg(text) {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (parsed.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new Error('This SVG is damaged or is not a valid SVG image.');
  }
  const removeNames = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animatemotion', 'animatetransform', 'set', 'mpath']);
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element !== root && (element.namespaceURI !== SVG_NS || removeNames.has(element.localName.toLowerCase()))) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase();
      if (name.startsWith('on') || name === 'base') {
        element.removeAttributeNode(attribute);
      } else if (name === 'href' || name === 'src') {
        const value = attribute.value.trim();
        const local = /^#[^\s"'<>]+$/.test(value);
        const raster = element.localName === 'image' && /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value);
        if (!local && !raster) element.removeAttributeNode(attribute);
      } else if (name === 'style' || /url|\\|@/i.test(attribute.value)) {
        const value = safeCss(attribute.value);
        if (value) attribute.value = value;
        else element.removeAttributeNode(attribute);
      }
    }
    if (element.localName === 'style') {
      const css = safeCss(element.textContent);
      if (css) element.textContent = css;
      else element.remove();
    }
  }
  // Serializing only the root excludes processing instructions and document types.
  let width = svgLength(root.getAttribute('width')), height = svgLength(root.getAttribute('height'));
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const validViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
  const aspect = validViewBox ? viewBox[2] / viewBox[3] : null;
  if (!width && height && aspect) width = { mm: height.mm * aspect, physical: height.physical };
  if (!height && width && aspect) height = { mm: width.mm / aspect, physical: width.physical };
  width ??= { mm: (validViewBox ? viewBox[2] : 300) * MM_PER_PIXEL, physical: false };
  height ??= { mm: (validViewBox ? viewBox[3] : 150) * MM_PER_PIXEL, physical: false };
  const size = dimensions(width.mm, height.mm);
  // A viewBox allows every subsequent render to request a bounded raster size.
  if (!validViewBox) root.setAttribute('viewBox', `0 0 ${width.mm / MM_PER_PIXEL} ${height.mm / MM_PER_PIXEL}`);
  const groups = [...root.querySelectorAll('g')];
  const label = group => [...group.attributes].find(attribute => attribute.localName === 'label')?.value || group.getAttribute('data-name') || group.id;
  const declared = groups.filter(group => [...group.attributes].some(attribute => attribute.localName === 'groupmode' && attribute.value === 'layer'));
  const layerGroups = declared.length ? declared : groups.filter(group => label(group) && group.parentElement === root);
  const layers = layerGroups.map((group, index) => ({
    id: `svg-layer-${index}`, name: String(label(group) || `Layer ${index + 1}`),
    visible: group.getAttribute('display') !== 'none' && group.style.getPropertyValue('display') !== 'none' && group.getAttribute('visibility') !== 'hidden' && group.style.getPropertyValue('visibility') !== 'hidden',
  }));
  return { root, layers, layerGroups, size, physicalScaleKnown: width.physical && height.physical };
}

async function decodeImage(url, signals) {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await abortable(image.decode(), signals, () => image.removeAttribute('src'));
    checkSignals(...signals);
    dimensions(image.naturalWidth, image.naturalHeight);
    return image;
  } catch (error) {
    image.removeAttribute('src');
    checkSignals(...signals);
    throw new Error('This image could not be decoded. Try a PNG, JPEG, WebP, or valid SVG.');
  }
}

async function loadImage(file, { signal: externalSignal, onProgress }, isSvg) {
  const lifetime = new AbortController(), signal = lifetime.signal;
  const urls = new Set();
  let image, svg;
  const releaseUrl = url => { URL.revokeObjectURL(url); urls.delete(url); };
  const makeUrl = blob => { const url = URL.createObjectURL(blob); urls.add(url); return url; };
  const dispose = () => {
    if (!signal.aborted) lifetime.abort(cancelled('The document was closed.'));
    image?.removeAttribute('src');
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  };
  const externalAbort = () => { lifetime.abort(cancelled()); dispose(); };
  externalSignal?.addEventListener('abort', externalAbort, { once: true });
  if (externalSignal?.aborted) externalAbort();
  try {
    checkSignals(signal);
    if (isSvg) {
      svg = prepareSvg(await readBlob(file, signal, true, onProgress));
      const bounded = boundedPixels(svg.size.widthMm / MM_PER_PIXEL, svg.size.heightMm / MM_PER_PIXEL);
      svg.root.setAttribute('width', String(bounded.width));
      svg.root.setAttribute('height', String(bounded.height));
      const url = makeUrl(new Blob([new XMLSerializer().serializeToString(svg.root)], { type: 'image/svg+xml' }));
      try { image = await decodeImage(url, [signal]); } finally { releaseUrl(url); }
    } else {
      image = await decodeImage(makeUrl(file), [signal]);
    }
    const pixelWidth = svg ? svg.size.widthMm / MM_PER_PIXEL : image.naturalWidth;
    const pixelHeight = svg ? svg.size.heightMm / MM_PER_PIXEL : image.naturalHeight;
    const pages = [svg?.size || dimensions(pixelWidth * MM_PER_PIXEL, pixelHeight * MM_PER_PIXEL)];
    const layers = svg?.layers || [];
    const initialVisibility = layers.map(layer => layer.visible);
    const source = {
      name: String(file.name || 'Image'), type: 'image', format: isSvg ? 'svg' : 'raster',
      pages, pixelWidth, pixelHeight, layers, physicalScaleKnown: svg?.physicalScaleKnown || false,
      get layersModified() { return layers.some((layer, index) => layer.visible !== initialVisibility[index]); },
      async copyBytes() { return new Uint8Array(await readBlob(file, signal)); },
      setLayerVisible(id, visible) {
        checkSignals(signal);
        const index = layers.findIndex(layer => layer.id === String(id));
        if (index < 0) return false;
        layers[index].visible = !!visible;
        const group = svg.layerGroups[index];
        group.style.setProperty('display', visible ? 'inline' : 'none', 'important');
        group.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
        return true;
      },
      async renderPage(index, { pixelsPerMm = 4, signal: renderSignal } = {}) {
        validateRender(index, 1, pixelsPerMm, signal, renderSignal);
        let width = pages[0].widthMm * pixelsPerMm, height = pages[0].heightMm * pixelsPerMm;
        // Upsampling a raster cannot reveal additional detail. SVG stays resolution independent.
        if (!svg) { const scale = Math.min(1, pixelWidth / width, pixelHeight / height); width *= scale; height *= scale; }
        const size = boundedPixels(width, height);
        let renderImage = image, url, canvas;
        try {
          if (svg) {
            const root = svg.root.cloneNode(true);
            root.setAttribute('width', String(size.width));
            root.setAttribute('height', String(size.height));
            url = makeUrl(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
            renderImage = await decodeImage(url, [signal, renderSignal]);
          }
          checkSignals(signal, renderSignal);
          const target = canvasFor(size.width, size.height);
          canvas = target.canvas;
          target.context.drawImage(renderImage, 0, 0, size.width, size.height);
          checkSignals(signal, renderSignal);
          return canvas;
        } catch (error) {
          if (canvas) canvas.width = canvas.height = 0;
          throw error;
        } finally {
          if (url) { renderImage?.removeAttribute('src'); releaseUrl(url); }
        }
      },
      dispose,
    };
    progress(onProgress, 'ready', 1, 1);
    checkSignals(signal);
    return source;
  } catch (error) { dispose(); throw error; }
  finally { externalSignal?.removeEventListener('abort', externalAbort); }
}

/**
 * Read a local File without uploading it. Page measurements are millimetres.
 * Raster dimensions assume 96 dpi; callers may adjust pages[0] using a known size.
 * onPassword receives PDF.js reason 1 (required) or 2 (incorrect); null cancels.
 * Each render returns a new canvas, bounded to 8 million pixels / 8192 per axis.
 */
export async function loadDocument(file, { signal, onProgress, onPassword } = {}) {
  checkSignals(signal);
  if (!(file instanceof Blob)) throw new TypeError('Choose a local PDF or image file.');
  const name = String(file.name || ''), type = String(file.type || '').toLowerCase();
  const options = { signal, onProgress, onPassword };
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return loadPdf(file, options);
  const isSvg = type === 'image/svg+xml' || /\.svg$/i.test(name);
  if (isSvg || type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|ico)$/i.test(name)) {
    return loadImage(file, options, isSvg);
  }
  throw new Error('Choose a PDF, SVG, PNG, JPEG, WebP, or other supported image file.');
}
