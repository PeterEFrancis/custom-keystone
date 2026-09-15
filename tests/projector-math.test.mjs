import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibratedPixelsPerMm, composeOrientation, orientationBounds,
  projectPoint, reflectionOrientation, rotationOrientation, unprojectPoint,
} from '../dist/projector-math.js';

const identity = { a: 1, b: 0, c: 0, d: 1 };
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
const pointClose = (actual, expected) => { close(actual.x, expected.x); close(actual.y, expected.y); };
const linear = (point, matrix) => ({ x: matrix.a * point.x + matrix.c * point.y, y: matrix.b * point.x + matrix.d * point.y });

test('native PDF points remain exact physical mm at 100 percent document scale', () => {
  const widthMm = 612 * 25.4 / 72;
  const heightMm = 792 * 25.4 / 72;
  const bounds = orientationBounds(widthMm, heightMm);
  close(bounds.width, 215.9);
  close(bounds.height, 279.4);
  const pan = { x: 20, y: 30 };
  const a = projectPoint({ x: 0, y: 0 }, identity, bounds, pan, 1);
  const b = projectPoint({ x: 72 * 25.4 / 72, y: 0 }, identity, bounds, pan, 1);
  close(Math.hypot(b.x - a.x, b.y - a.y), 25.4);
  pointClose(projectPoint({ x: widthMm, y: heightMm }, identity, bounds, pan, 1), { x: 235.9, y: 309.4 });
});

test('quarter-turn bounds include correct translated minima and swapped extents', () => {
  assert.deepEqual(rotationOrientation(90), { a: 0, b: 1, c: -1, d: 0 });
  assert.deepEqual(rotationOrientation(-450), { a: 0, b: -1, c: 1, d: 0 });
  assert.deepEqual(orientationBounds(100, 200, rotationOrientation(90)), { minX: -200, minY: 0, width: 200, height: 100 });
  assert.deepEqual(orientationBounds(100, 200, rotationOrientation(180)), { minX: -100, minY: -200, width: 100, height: 200 });
});

test('arbitrary rotation bounds contain all four corners at the tight extent', () => {
  const matrix = rotationOrientation(37.5);
  const bounds = orientationBounds(215.9, 279.4, matrix);
  const corners = [{ x: 0, y: 0 }, { x: 215.9, y: 0 }, { x: 215.9, y: 279.4 }, { x: 0, y: 279.4 }]
    .map(point => projectPoint(point, matrix, bounds, { x: 0, y: 0 }, 1));
  close(Math.min(...corners.map(point => point.x)), 0);
  close(Math.min(...corners.map(point => point.y)), 0);
  close(Math.max(...corners.map(point => point.x)), bounds.width);
  close(Math.max(...corners.map(point => point.y)), bounds.height);
  close(bounds.width, 215.9 * Math.abs(matrix.a) + 279.4 * Math.abs(matrix.c));
});

test('projection roundtrips after arbitrary rotation, reflection, pan, and scale', () => {
  const reflection = reflectionOrientation({ x: 4, y: 5 }, { x: 15, y: 31 });
  const pan = { x: -47.3, y: 118.8 };
  for (const angle of [-391.5, -90, 0, 23.4, 180, 711]) {
    for (const scale of [0.1, 1, 1.37, 7]) {
      const matrix = composeOrientation(rotationOrientation(angle), reflection);
      const bounds = orientationBounds(215.9, 279.4, matrix);
      for (const point of [{ x: 0, y: 0 }, { x: 110.2, y: 127.9 }, { x: 215.9, y: 279.4 }, { x: -10, y: 500 }]) {
        pointClose(unprojectPoint(projectPoint(point, matrix, bounds, pan, scale), matrix, bounds, pan, scale), point);
      }
    }
  }
});

test('composition applies the right matrix first and preserves noncommuting order', () => {
  const rotation = rotationOrientation(90);
  const reflection = reflectionOrientation({ x: 0, y: 0 }, { x: 1, y: 0 });
  const point = { x: 20, y: 30 };
  pointClose(linear(point, composeOrientation(rotation, reflection)), linear(linear(point, reflection), rotation));
  assert.notDeepEqual(linear(point, composeOrientation(rotation, reflection)), linear(point, composeOrientation(reflection, rotation)));
});

test('fold reflection leaves its anchored line fixed and flips signed perpendicular distance', () => {
  const p1 = { x: 30, y: 40 };
  const p2 = { x: 90, y: 120 };
  const midpoint = { x: 60, y: 80 };
  const matrix = reflectionOrientation(p1, p2);
  const reflectAnchored = point => {
    const delta = linear({ x: point.x - midpoint.x, y: point.y - midpoint.y }, matrix);
    return { x: midpoint.x + delta.x, y: midpoint.y + delta.y };
  };
  pointClose(reflectAnchored(p1), p1);
  pointClose(reflectAnchored(p2), p2);
  const point = { x: midpoint.x - 8, y: midpoint.y + 6 };
  pointClose(reflectAnchored(point), { x: midpoint.x + 8, y: midpoint.y - 6 });
  pointClose(reflectAnchored(reflectAnchored(point)), point);
  close(matrix.a * matrix.d - matrix.b * matrix.c, -1);
});

test('raster density uses the greatest horizontal or vertical calibrated edge ratio', () => {
  const rectangle = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 600 }, { x: 0, y: 600 }];
  assert.equal(calibratedPixelsPerMm(rectangle, 600, 300), 2);
  const skewed = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 900, y: 800 }, { x: -300, y: 800 }];
  close(calibratedPixelsPerMm(skewed, 600, 300), Math.hypot(300, 800) / 300);
});

test('invalid physical sizes, points, matrices, folds, and scales fail clearly', () => {
  assert.throws(() => orientationBounds(0, 100), /positive/);
  assert.throws(() => orientationBounds(100, Infinity), /finite/);
  assert.throws(() => rotationOrientation(NaN), /finite/);
  assert.throws(() => reflectionOrientation({ x: 1, y: 1 }, { x: 1, y: 1 }), /different/);
  assert.throws(() => composeOrientation(identity, { a: 1, b: 0, c: 0, d: NaN }), /finite/);
  const bounds = orientationBounds(100, 100);
  assert.throws(() => projectPoint({ x: 1, y: 1 }, identity, bounds, { x: 0, y: 0 }, 0), /positive/);
  assert.throws(() => unprojectPoint({ x: 1, y: 1 }, { a: 1, b: 1, c: 1, d: 1 }, bounds, { x: 0, y: 0 }, 1), /invertible/);
  assert.throws(() => calibratedPixelsPerMm([], 100, 100), /four/);
  assert.throws(() => calibratedPixelsPerMm(Array(4).fill({ x: 0, y: 0 }), 100, 100), /positive/);
});
