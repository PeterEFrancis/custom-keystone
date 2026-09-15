/**
 * Coordinate transforms between physical document and calibrated mat spaces.
 * Matrices follow the CSS convention: x' = a*x + c*y, y' = b*x + d*y.
 */
const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1 });

function finite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive.`);
  return value;
}

function readPoint(point, name) {
  finite(point?.x, `${name} x`);
  finite(point?.y, `${name} y`);
  return point;
}

function readOrientation(orientation = IDENTITY) {
  for (const key of ['a', 'b', 'c', 'd']) finite(orientation?.[key], `Orientation ${key}`);
  return orientation;
}

function transform(point, orientation) {
  return { x: orientation.a * point.x + orientation.c * point.y, y: orientation.b * point.x + orientation.d * point.y };
}

/** Bounding rectangle of an oriented layout whose original top-left is (0, 0). */
export function orientationBounds(layoutWidth, height, orientation = IDENTITY) {
  positive(layoutWidth, 'Layout width');
  positive(height, 'Layout height');
  readOrientation(orientation);
  const corners = [
    { x: 0, y: 0 }, { x: layoutWidth, y: 0 },
    { x: layoutWidth, y: height }, { x: 0, y: height },
  ].map(point => transform(point, orientation));
  const minX = Math.min(...corners.map(point => point.x));
  const minY = Math.min(...corners.map(point => point.y));
  return {
    minX, minY,
    width: Math.max(...corners.map(point => point.x)) - minX,
    height: Math.max(...corners.map(point => point.y)) - minY,
  };
}

function readProjection(orientation, bounds, pan, scale) {
  readOrientation(orientation);
  finite(bounds?.minX, 'Bounds minX');
  finite(bounds?.minY, 'Bounds minY');
  readPoint(pan, 'Pan');
  positive(scale, 'Scale');
}

/** Convert a document point in mm to a calibrated mat point in mm. */
export function projectPoint(point, orientation, bounds, pan, scale) {
  readPoint(point, 'Document point');
  readProjection(orientation, bounds, pan, scale);
  const oriented = transform(point, orientation);
  return {
    x: pan.x + scale * (oriented.x - bounds.minX),
    y: pan.y + scale * (oriented.y - bounds.minY),
  };
}

/** Convert a calibrated mat point in mm back into document coordinates. */
export function unprojectPoint(point, orientation, bounds, pan, scale) {
  readPoint(point, 'Mat point');
  readProjection(orientation, bounds, pan, scale);
  const determinant = orientation.a * orientation.d - orientation.b * orientation.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new RangeError('Orientation must be invertible.');
  }
  const x = (point.x - pan.x) / scale + bounds.minX;
  const y = (point.y - pan.y) / scale + bounds.minY;
  return {
    x: (orientation.d * x - orientation.c * y) / determinant,
    y: (orientation.a * y - orientation.b * x) / determinant,
  };
}

/** Compose linear orientations: apply right first, then left. */
export function composeOrientation(left, right) {
  readOrientation(left);
  readOrientation(right);
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
  };
}

function clean(value) {
  return Math.abs(value) < 1e-14 ? 0 : value;
}

/** Positive angles rotate clockwise in screen/mat coordinates (y down). */
export function rotationOrientation(degrees) {
  finite(degrees, 'Rotation');
  const radians = (degrees % 360) * Math.PI / 180;
  const cosine = clean(Math.cos(radians));
  const sine = clean(Math.sin(radians));
  return { a: cosine, b: sine, c: clean(-sine), d: cosine };
}

/**
 * Linear reflection around the direction of a two-point fold line. Translation
 * is deliberately omitted: anchor a point on the fold line when applying it.
 */
export function reflectionOrientation(p1, p2) {
  readPoint(p1, 'First fold point');
  readPoint(p2, 'Second fold point');
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Choose two different fold points.');
  const x = dx / length;
  const y = dy / length;
  return { a: clean(2 * x * x - 1), b: clean(2 * x * y), c: clean(2 * x * y), d: clean(2 * y * y - 1) };
}

/**
 * Approximate raster density for TL, TR, BR, BL calibration corners in pixels.
 * The densest opposing edge determines the estimate to preserve page detail.
 */
export function calibratedPixelsPerMm(corners, widthMm, heightMm) {
  if (!Array.isArray(corners) || corners.length !== 4) throw new RangeError('Calibration needs four ordered corners.');
  corners.forEach((point, index) => readPoint(point, `Corner ${index + 1}`));
  positive(widthMm, 'Calibration width');
  positive(heightMm, 'Calibration height');
  const edge = (first, last) => Math.hypot(corners[last].x - corners[first].x, corners[last].y - corners[first].y);
  const density = Math.max(edge(0, 1) / widthMm, edge(3, 2) / widthMm, edge(0, 3) / heightMm, edge(1, 2) / heightMm);
  return positive(density, 'Calibration pixel density');
}
