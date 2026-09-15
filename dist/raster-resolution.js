const MAX_PIXELS = 8_000_000;
const MAX_AXIS = 8192;
const MAX_DENSITY = 16;
const BUCKET_RATIO = 2 ** 0.25;
const HYSTERESIS = 1.04;

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite.`);
}

/**
 * Fit a requested raster within the memory and per-axis limits, retaining its
 * aspect ratio before integer rounding. Optional limits only lower those caps;
 * image renderers use them to avoid upsampling beyond a raster's native size.
 */
export function boundedPixels(width, height, { maxWidth = MAX_AXIS, maxHeight = MAX_AXIS } = {}) {
  positiveFinite(width, 'Render width');
  positiveFinite(height, 'Render height');
  positiveFinite(maxWidth, 'Maximum width');
  positiveFinite(maxHeight, 'Maximum height');
  let scale = Math.min(1, Math.min(MAX_AXIS, maxWidth) / width, Math.min(MAX_AXIS, maxHeight) / height);
  // Apply axis caps first so even enormous finite dimensions cannot overflow area.
  const area = (width * scale) * (height * scale);
  if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
  // Algebraically identical capped sizes can land just below an integer after
  // floating-point scaling. Snap only rounding noise, not a visible fraction.
  const pixels = value => Math.max(1, Math.floor(value + Math.max(1, value) * Number.EPSILON * 16));
  return {
    width: pixels(width * scale),
    height: pixels(height * scale),
  };
}

function bucket(demand) {
  // Tolerance keeps exact quarter-octave boundaries stable under log2 rounding.
  return Math.min(MAX_DENSITY, 2 ** (Math.ceil(Math.log2(Math.min(MAX_DENSITY, demand)) * 4 - 1e-10) / 4));
}

/**
 * Choose the current view's raster density in quarter-octave steps, in BOTH
 * zoom directions. Pass the previous returned density, not a capped canvas's
 * measured density. A 4% deadband avoids rerendering around bucket boundaries.
 * There is no minimum density; the resulting canvas still has at least one pixel.
 */
export function chooseRasterDensity(demand, previousDensity) {
  positiveFinite(demand, 'Raster density');
  const target = Math.min(MAX_DENSITY, demand);
  if (previousDensity !== undefined && previousDensity !== null) {
    positiveFinite(previousDensity, 'Previous raster density');
    const previous = bucket(previousDensity);
    if (target >= previous / BUCKET_RATIO / HYSTERESIS && target <= previous * HYSTERESIS) return previous;
  }
  return bucket(target);
}
