import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedPixels, chooseRasterDensity } from '../dist/raster-resolution.js';

const ratio = 2 ** 0.25;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${actual} should equal ${expected}`);

test('density follows a low-high-low zoom sequence instead of retaining the largest raster', () => {
  const low = chooseRasterDensity(0.08);
  const high = chooseRasterDensity(9, low);
  const returned = chooseRasterDensity(0.08, high);
  assert.ok(low < 0.2);
  assert.ok(high >= 9);
  assert.equal(returned, low);
  const zoomedOut = chooseRasterDensity(0.004, returned);
  assert.ok(zoomedOut >= 0.004 && zoomedOut < 0.004 * ratio);
});

test('initial density uses relative quarter-octave buckets at both small and large scales', () => {
  for (const demand of [0.000001, 0.01, 0.08, 0.19, 0.201, 0.3, 0.75, 1, 2.01, 3, 7, 12, 16]) {
    const density = chooseRasterDensity(demand);
    assert.ok(density >= demand * (1 - 1e-12));
    assert.ok(density <= demand * ratio * (1 + 1e-12));
    close(Math.log2(density) * 4, Math.round(Math.log2(density) * 4));
  }
  for (let step = -40; step <= 16; step++) {
    const exact = 2 ** (step / 4);
    assert.equal(chooseRasterDensity(exact), exact);
  }
});

test('hysteresis prevents boundary chatter but permits meaningful zoom changes in both directions', () => {
  let previous = 2;
  for (const demand of [2.001, 1.99, 2.03, 1.96, 2.02]) {
    previous = chooseRasterDensity(demand, previous);
    assert.equal(previous, 2);
  }
  const higher = chooseRasterDensity(2.09, previous);
  close(higher, 2 * ratio);
  for (const demand of [2.01, 1.99, 2.02, 1.95]) assert.equal(chooseRasterDensity(demand, higher), higher);
  assert.equal(chooseRasterDensity(1.90, higher), 2);
  assert.ok(chooseRasterDensity(0.1, higher) < 0.2);
});

test('density caps at16 without imposing a positive floor or returning zero', () => {
  assert.equal(chooseRasterDensity(100), 16);
  assert.equal(chooseRasterDensity(Number.MAX_VALUE, 16), 16);
  assert.equal(chooseRasterDensity(Number.MIN_VALUE), Number.MIN_VALUE);
  assert.equal(chooseRasterDensity(1, null), 1);
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, '2']) {
    assert.throws(() => chooseRasterDensity(invalid), /positive and finite/);
    assert.throws(() => chooseRasterDensity(1, invalid), /positive and finite/);
  }
});

test('ordinary page dimensions round down consistently and never produce an empty canvas', () => {
  assert.deepEqual(boundedPixels(215.9 * 4, 279.4 * 4), { width: 863, height: 1117 });
  assert.deepEqual(boundedPixels(0.03, 0.01), { width: 1, height: 1 });
  assert.deepEqual(boundedPixels(1024, 512), { width: 1024, height: 512 });
});

test('whole-page memory limits preserve aspect and produce a stable capped cache size', () => {
  const moderate = boundedPixels(8400, 11880);
  const extreme = boundedPixels(84000, 118800);
  assert.ok(moderate.width * moderate.height <= 8_000_000);
  assert.deepEqual(extreme, moderate);
  assert.ok(Math.abs(moderate.width / moderate.height - 8400 / 11880) < 0.001);
  assert.ok(moderate.width * moderate.height > 7_990_000);
});

test('memory-capped dimensions do not jitter by a pixel between quarter-octave zoom buckets', () => {
  for (let step = 12; step <= 16; step++) {
    const density = 2 ** (step / 4);
    assert.deepEqual(boundedPixels(800 * density, 400 * density), { width: 4000, height: 2000 });
    assert.deepEqual(boundedPixels(400 * density, 800 * density), { width: 2000, height: 4000 });
  }
  for (let step = 0; step <= 16; step++) {
    const density = 2 ** (step / 4);
    assert.deepEqual(boundedPixels(10_000 * density, 10 * density), { width: 8192, height: 8 });
    assert.deepEqual(boundedPixels(10 * density, 10_000 * density), { width: 8, height: 8192 });
  }
});

test('axis caps handle very long pages in either orientation without exceeding the memory limit', () => {
  assert.deepEqual(boundedPixels(100_000, 100), { width: 8192, height: 8 });
  assert.deepEqual(boundedPixels(100, 100_000), { width: 8, height: 8192 });
  const huge = boundedPixels(Number.MAX_VALUE, Number.MAX_VALUE);
  assert.ok(huge.width <= 8192 && huge.height <= 8192);
  assert.ok(huge.width * huge.height <= 8_000_000);
  assert.ok(huge.width > 2800);
});

test('native raster limits prevent upsampling and preserve useful zoom-out rerenders', () => {
  const native = { maxWidth: 192, maxHeight: 96 };
  assert.deepEqual(boundedPixels(1200, 600, native), { width: 192, height: 96 });
  assert.deepEqual(boundedPixels(48, 24, native), { width: 48, height: 24 });
  const large = boundedPixels(20_000, 20_000, { maxWidth: 10_000, maxHeight: 10_000 });
  assert.ok(large.width * large.height <= 8_000_000);
  assert.ok(large.width <= 8192 && large.height <= 8192);
});

test('invalid render dimensions and optional bounds fail before allocation', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, '2']) {
    assert.throws(() => boundedPixels(invalid, 100), /positive and finite/);
    assert.throws(() => boundedPixels(100, invalid), /positive and finite/);
    assert.throws(() => boundedPixels(100, 100, { maxWidth: invalid }), /positive and finite/);
    assert.throws(() => boundedPixels(100, 100, { maxHeight: invalid }), /positive and finite/);
  }
});
