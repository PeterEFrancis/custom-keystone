/** Pure physical-page layout helpers. All lengths are millimetres. */
const MAX_TILES = 2000;
const CONTINUOUS_GAP = 10;

function finiteNumber(value, name, { positive = false, nonnegative = false } = {}) {
  if (!Number.isFinite(value) || (positive && value <= 0) || (nonnegative && value < 0)) {
    throw new RangeError(`${name} must be a ${positive ? 'positive ' : nonnegative ? 'nonnegative ' : ''}finite number.`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
  return value;
}

/**
 * Expand one-based numbers/ranges into an ordered, zero-based page list.
 * Repeated pages and descending ranges are intentional. A literal 0 creates a
 * blank slot, represented by -1. ! exclusions apply to
 * every occurrence, regardless of their position in the expression. An empty
 * expression, or one containing only exclusions, starts with every page.
 */
export function parsePageSelection(text = '', pageCount) {
  positiveInteger(pageCount, 'Page count');
  if (typeof text !== 'string') throw new TypeError('Page selection must be text.');
  const expression = text.trim();
  const selected = [];
  const excluded = new Set();
  let hasInclusions = false;

  if (expression) {
    for (const part of expression.split(',')) {
      const match = part.trim().match(/^(!\s*)?(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw new RangeError(`Invalid page selection: "${part.trim()}". Use page numbers or ranges separated by commas.`);
      const exclude = Boolean(match[1]);
      const first = Number(match[2]);
      const last = match[3] === undefined ? first : Number(match[3]);
      const isBlank = first === 0 && match[3] === undefined;
      if (!isBlank && ![first, last].every(value => Number.isSafeInteger(value) && value >= 1 && value <= pageCount)) {
        throw new RangeError(`Page numbers must be between 1 and ${pageCount}.`);
      }
      const count = Math.abs(last - first) + 1;
      if (count > MAX_TILES || (!exclude && selected.length + count > MAX_TILES)) {
        throw new RangeError(`Select at most ${MAX_TILES} pages, including repeated pages.`);
      }
      if (!exclude) hasInclusions = true;
      const step = first <= last ? 1 : -1;
      for (let offset = 0; offset < count; offset++) {
        const pageIndex = first + offset * step - 1;
        if (exclude) excluded.add(pageIndex);
        else selected.push(pageIndex);
      }
      if (excluded.size > MAX_TILES) throw new RangeError(`Exclude at most ${MAX_TILES} pages.`);
    }
  }

  if (!hasInclusions) {
    if (pageCount > MAX_TILES) throw new RangeError(`Select at most ${MAX_TILES} pages explicitly for this document.`);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) selected.push(pageIndex);
  }
  return selected.filter(pageIndex => !excluded.has(pageIndex));
}

function readTrim(input = {}) {
  return Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [
    side, finiteNumber(input[side] ?? 0, `The ${side} trim`, { nonnegative: true }),
  ]));
}

/**
 * Lay out cropped pages at their original physical scale.
 * Single mode uses pageIndex and ignores selection. Continuous mode stacks the
 * selection vertically with 10 mm gaps. Stitch mode uses shared column widths
 * and row heights, top-aligning/left-aligning mixed-size pages within each track.
 * Overlap removes spacing between tracks; it never rescales an individual tile.
 * Providing rows reserves exactly columns × rows cells, padding the remaining
 * cells with blank tiles in the requested fill order. Omitting rows sizes the
 * grid automatically to the selection.
 */
export function buildPatternLayout(pages, options = {}) {
  if (!Array.isArray(pages) || pages.length === 0) throw new RangeError('The document must contain at least one page.');
  const mode = options.mode ?? 'single';
  if (!['single', 'continuous', 'stitch'].includes(mode)) throw new RangeError('Choose single, continuous, or stitch layout.');
  const trim = readTrim(options.trim);
  let selection;
  if (mode === 'single') {
    const pageIndex = options.pageIndex ?? 0;
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) throw new RangeError('Choose a valid page.');
    selection = [pageIndex];
  } else selection = parsePageSelection(options.selection ?? '', pages.length);
  if (!selection.length) throw new RangeError('Select at least one page.');
  let explicitGrid = null;
  if (mode === 'stitch' && options.rows !== undefined) {
    const columns = positiveInteger(options.columns ?? 2, 'Column count');
    const rows = positiveInteger(options.rows, 'Row count');
    const cells = columns * rows;
    if (!Number.isSafeInteger(cells) || cells > MAX_TILES) throw new RangeError(`The stitch grid can contain at most ${MAX_TILES} cells, including blank pages.`);
    if (cells < selection.length) throw new RangeError(`The stitch grid needs at least ${selection.length} cells for the selected pages.`);
    explicitGrid = { columns, rows };
    while (selection.length < cells) selection.push(-1);
  }
  const blankReferenceIndex = selection.find(pageIndex => pageIndex >= 0) ?? 0;

  const tiles = selection.map((pageIndex, index) => {
    const sourceIndex = pageIndex < 0 ? blankReferenceIndex : pageIndex;
    const page = pages[sourceIndex];
    const pageWidth = finiteNumber(page?.widthMm, `Page ${sourceIndex + 1} width`, { positive: true });
    const pageHeight = finiteNumber(page?.heightMm, `Page ${sourceIndex + 1} height`, { positive: true });
    const width = pageWidth - trim.left - trim.right;
    const height = pageHeight - trim.top - trim.bottom;
    if (width <= 0 || height <= 0) throw new RangeError(`Trim removes all of page ${sourceIndex + 1}. Reduce the page margins.`);
    return { id: `tile-${index}`, pageIndex, x: 0, y: 0, width, height, crop: { ...trim }, pageWidth, pageHeight };
  });

  if (mode === 'single') return { width: tiles[0].width, height: tiles[0].height, tiles, rows: 1, columns: 1 };
  if (mode === 'continuous') {
    let height = 0;
    let width = 0;
    for (const tile of tiles) {
      tile.y = height;
      height += tile.height + CONTINUOUS_GAP;
      width = Math.max(width, tile.width);
    }
    return { width, height: height - CONTINUOUS_GAP, tiles, rows: tiles.length, columns: 1 };
  }

  const requestedColumns = positiveInteger(options.columns ?? 2, 'Column count');
  const columns = explicitGrid?.columns ?? Math.min(requestedColumns, tiles.length);
  const rows = explicitGrid?.rows ?? Math.ceil(tiles.length / columns);
  const order = options.order ?? 'row';
  if (!['row', 'column'].includes(order)) throw new RangeError('Choose row or column page order.');
  const overlapX = finiteNumber(options.overlapX ?? 0, 'Horizontal overlap', { nonnegative: true });
  const overlapY = finiteNumber(options.overlapY ?? 0, 'Vertical overlap', { nonnegative: true });
  const columnWidths = Array(columns).fill(0);
  const rowHeights = Array(rows).fill(0);
  const cells = tiles.map((tile, index) => {
    const column = order === 'row' ? index % columns : Math.floor(index / rows);
    const row = order === 'row' ? Math.floor(index / columns) : index % rows;
    columnWidths[column] = Math.max(columnWidths[column], tile.width);
    rowHeights[row] = Math.max(rowHeights[row], tile.height);
    return { column, row };
  });

  // Column-major filling may leave trailing requested columns wholly empty.
  // Such columns are not part of the resulting grid or its physical extent.
  while (columnWidths.at(-1) === 0) columnWidths.pop();
  const xPositions = trackPositions(columnWidths, overlapX, 'Horizontal');
  const yPositions = trackPositions(rowHeights, overlapY, 'Vertical');
  tiles.forEach((tile, index) => {
    tile.x = xPositions[cells[index].column];
    tile.y = yPositions[cells[index].row];
  });
  return {
    width: Math.max(...tiles.map(tile => tile.x + tile.width)),
    height: Math.max(...tiles.map(tile => tile.y + tile.height)),
    tiles,
    rows,
    columns: columnWidths.length,
  };
}

function trackPositions(sizes, overlap, axis) {
  const positions = [0];
  for (let index = 0; index < sizes.length - 1; index++) {
    const step = sizes[index] - overlap;
    if (step <= 0) throw new RangeError(`${axis} overlap must be smaller than each preceding page track.`);
    positions.push(positions[index] + step);
  }
  return positions;
}

/** Return tiles intersecting a viewport, optionally expanded on every side. */
export function visibleTiles(layout, viewport, padding = 0) {
  finiteNumber(viewport?.x, 'Viewport x');
  finiteNumber(viewport?.y, 'Viewport y');
  finiteNumber(viewport?.width, 'Viewport width', { nonnegative: true });
  finiteNumber(viewport?.height, 'Viewport height', { nonnegative: true });
  finiteNumber(padding, 'Viewport padding', { nonnegative: true });
  const left = viewport.x - padding;
  const top = viewport.y - padding;
  const right = viewport.x + viewport.width + padding;
  const bottom = viewport.y + viewport.height + padding;
  if (left === right || top === bottom) return [];
  return layout.tiles.filter(tile => tile.x < right && tile.x + tile.width > left && tile.y < bottom && tile.y + tile.height > top);
}

/** Normalize an exact quarter-turn angle in degrees and return its bounds. */
export function orientedSize(width, height, rotation = 0) {
  finiteNumber(width, 'Width', { positive: true });
  finiteNumber(height, 'Height', { positive: true });
  if (!Number.isSafeInteger(rotation) || rotation % 90 !== 0) throw new RangeError('Rotation must be a multiple of 90 degrees.');
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized % 180 === 0
    ? { width, height, rotation: normalized }
    : { width: height, height: width, rotation: normalized };
}

/** Scale a measured document segment to its known physical target length. */
export function measurementScale(lengthInLayoutMm, targetMm) {
  finiteNumber(lengthInLayoutMm, 'Measured length', { positive: true });
  finiteNumber(targetMm, 'Target length', { positive: true });
  return targetMm / lengthInLayoutMm;
}
