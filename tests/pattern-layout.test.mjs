import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPatternLayout, measurementScale, orientedSize, parsePageSelection, visibleTiles } from '../dist/pattern-layout.js';

const letter = { widthMm: 215.9, heightMm: 279.4 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

test('selection preserves intentional ordering, descending ranges, and repeated pages', () => {
  assert.deepEqual(parsePageSelection('3, 1-2, 3, 5-4', 5), [2, 0, 1, 2, 4, 3]);
  assert.deepEqual(parsePageSelection('', 3), [0, 1, 2]);
  assert.deepEqual(parsePageSelection('  ', 3), [0, 1, 2]);
});

test('exclusions remove every selected occurrence regardless of expression order', () => {
  assert.deepEqual(parsePageSelection('!2, 1-4, 2, 4', 4), [0, 2, 3, 3]);
  assert.deepEqual(parsePageSelection('! 4-2', 5), [0, 4]);
  assert.deepEqual(parsePageSelection('1-3,!1-3', 3), []);
});

test('selection rejects invalid pages and caps expansion, including repeated pages', () => {
  for (const value of ['0-1', '0-0', '1-0', '4', '-1', '1.5', '1,,2', '1,', '1-2-3', '1 2', '!']) {
    assert.throws(() => parsePageSelection(value, 3), RangeError, value);
  }
  assert.throws(() => parsePageSelection('1-2001', 2001), /2000/);
  assert.throws(() => parsePageSelection('1,'.repeat(2000) + '1', 1), /2000/);
  assert.throws(() => parsePageSelection('', 2001), /2000/);
  assert.equal(parsePageSelection('1-2000,!2', 2000).length, 1999);
  assert.deepEqual(parsePageSelection('2001', 2001), [2000]);
});

test('literal zero inserts blank physical slots using the first selected real page', () => {
  assert.deepEqual(parsePageSelection('0,2,0,1', 2), [-1, 1, -1, 0]);
  assert.deepEqual(parsePageSelection('0,2,0,!0', 2), [1]);
  const pages = [letter, { widthMm: 100, heightMm: 200 }];
  const layout = buildPatternLayout(pages, { mode: 'stitch', columns: 2, selection: '0,2,0,1', trim: { left: 10 } });
  assert.deepEqual(layout.tiles.map(tile => tile.pageIndex), [-1, 1, -1, 0]);
  assert.equal(layout.tiles[0].width, 90);
  assert.equal(layout.tiles[0].height, 200);
  assert.equal(layout.tiles[0].pageWidth, 100);
  assert.equal(layout.tiles[0].crop.left, 10);
  assert.equal(new Set(layout.tiles.map(tile => tile.id)).size, 4);
  const blank = buildPatternLayout(pages, { mode: 'stitch', selection: '0' });
  assert.equal(blank.width, letter.widthMm);
  assert.equal(blank.height, letter.heightMm);
});

test('an untrimmed US letter page retains exact physical dimensions at 100 percent', () => {
  const layout = buildPatternLayout([letter], { mode: 'single' });
  assert.equal(layout.width, 215.9);
  assert.equal(layout.height, 279.4);
  assert.deepEqual(layout.tiles[0], {
    id: 'tile-0', pageIndex: 0, x: 0, y: 0, width: 215.9, height: 279.4,
    crop: { top: 0, right: 0, bottom: 0, left: 0 }, pageWidth: 215.9, pageHeight: 279.4,
  });
  const second = buildPatternLayout([letter, { widthMm: 297, heightMm: 420 }], { mode: 'single', pageIndex: 1, selection: '1' });
  assert.equal(second.width, 297);
  assert.equal(second.tiles[0].pageIndex, 1);
});

test('continuous pages preserve size and order with only 10 mm between pages', () => {
  const layout = buildPatternLayout([letter, { widthMm: 100, heightMm: 150 }], { mode: 'continuous', selection: '2,1,2' });
  assert.deepEqual(layout.tiles.map(tile => tile.pageIndex), [1, 0, 1]);
  assert.deepEqual(layout.tiles.map(tile => tile.y), [0, 160, 449.4]);
  close(layout.height, 599.4);
  assert.equal(layout.width, 215.9);
  assert.equal(new Set(layout.tiles.map(tile => tile.id)).size, 3);
  assert.equal(layout.rows, 3);
  assert.equal(layout.columns, 1);
});

test('trim crops source millimetres and overlap subtracts only inter-track spacing', () => {
  const layout = buildPatternLayout(Array(4).fill(letter), {
    mode: 'stitch', columns: 2, trim: { top: 5, right: 6, bottom: 7, left: 8 }, overlapX: 10, overlapY: 20,
  });
  const tile = layout.tiles[0];
  close(tile.width, 201.9);
  close(tile.height, 267.4);
  assert.deepEqual(tile.crop, { top: 5, right: 6, bottom: 7, left: 8 });
  assert.equal(tile.pageWidth, letter.widthMm);
  assert.equal(tile.pageHeight, letter.heightMm);
  close(layout.tiles[1].x, 191.9);
  close(layout.tiles[2].y, 247.4);
  close(layout.width, 393.8);
  close(layout.height, 514.8);
});

test('column and row order fill their respective tracks without reordering the tile list', () => {
  const pages = Array(6).fill({ widthMm: 100, heightMm: 200 });
  const row = buildPatternLayout(pages, { mode: 'stitch', columns: 3, order: 'row' });
  const column = buildPatternLayout(pages, { mode: 'stitch', columns: 3, order: 'column' });
  assert.deepEqual(row.tiles.map(({ x, y }) => [x, y]), [[0, 0], [100, 0], [200, 0], [0, 200], [100, 200], [200, 200]]);
  assert.deepEqual(column.tiles.map(({ x, y }) => [x, y]), [[0, 0], [0, 200], [100, 0], [100, 200], [200, 0], [200, 200]]);
  assert.deepEqual(column.tiles.map(tile => tile.pageIndex), [0, 1, 2, 3, 4, 5]);
});

test('mixed-size pages use consistent tracks without stretching individual pages', () => {
  const pages = [{ widthMm: 100, heightMm: 200 }, { widthMm: 120, heightMm: 90 }, { widthMm: 150, heightMm: 80 }];
  const layout = buildPatternLayout(pages, { mode: 'stitch', columns: 2, overlapX: 5, overlapY: 10 });
  assert.deepEqual(layout.tiles.map(({ x, y, width, height }) => [x, y, width, height]), [
    [0, 0, 100, 200], [145, 0, 120, 90], [0, 190, 150, 80],
  ]);
  assert.equal(layout.width, 265);
  assert.equal(layout.height, 270);
  const column = buildPatternLayout(Array(5).fill(letter), { mode: 'stitch', columns: 4, order: 'column' });
  assert.equal(column.rows, 2);
  assert.equal(column.columns, 3);
  close(column.width, letter.widthMm * 3);
});

test('explicit rows preserve the requested rectangular grid and pad every missing cell', () => {
  const layout = buildPatternLayout(Array(5).fill(letter), { mode: 'stitch', columns: 2, rows: 4, order: 'row' });
  assert.equal(layout.rows, 4);
  assert.equal(layout.columns, 2);
  assert.equal(layout.tiles.length, 8);
  assert.deepEqual(layout.tiles.map(tile => tile.pageIndex), [0, 1, 2, 3, 4, -1, -1, -1]);
  assert.equal(new Set(layout.tiles.map(tile => tile.id)).size, 8);
  close(layout.width, letter.widthMm * 2);
  close(layout.height, letter.heightMm * 4);
  layout.tiles.forEach((tile, index) => {
    close(tile.x, (index % 2) * letter.widthMm);
    close(tile.y, Math.floor(index / 2) * letter.heightMm);
  });
});

test('explicit column-major rows place pages downward before padded blank cells', () => {
  const layout = buildPatternLayout(Array(5).fill({ widthMm: 100, heightMm: 200 }), { mode: 'stitch', columns: 2, rows: 4, order: 'column' });
  assert.deepEqual(layout.tiles.map(({ pageIndex, x, y }) => [pageIndex, x, y]), [
    [0, 0, 0], [1, 0, 200], [2, 0, 400], [3, 0, 600],
    [4, 100, 0], [-1, 100, 200], [-1, 100, 400], [-1, 100, 600],
  ]);
  assert.equal(layout.width, 200);
  assert.equal(layout.height, 800);
});

test('automatic padding uses the same source size and trim as explicit blank slots', () => {
  const pages = [letter, { widthMm: 100, heightMm: 200 }];
  const layout = buildPatternLayout(pages, {
    mode: 'stitch', selection: '0,2,1', columns: 2, rows: 2,
    trim: { top: 5, right: 6, bottom: 7, left: 8 }, overlapX: 10, overlapY: 20,
  });
  const [explicitBlank, , , padding] = layout.tiles;
  assert.equal(padding.pageIndex, -1);
  for (const key of ['width', 'height', 'crop', 'pageWidth', 'pageHeight']) assert.deepEqual(padding[key], explicitBlank[key]);
  assert.equal(padding.pageWidth, 100);
  assert.equal(padding.pageHeight, 200);
  assert.equal(padding.width, 86);
  assert.equal(padding.height, 188);
  close(layout.width, (215.9 - 14) + 86 - 10);
  close(layout.height, (279.4 - 12) + 188 - 20);
});

test('explicit rows reject invalid counts, insufficient cells, and more than 2000 padded cells', () => {
  const pages = Array(5).fill(letter);
  for (const rows of [0, -1, 1.5, Infinity, NaN, null]) {
    assert.throws(() => buildPatternLayout(pages, { mode: 'stitch', columns: 2, rows }), /Row count/);
  }
  assert.throws(() => buildPatternLayout(pages, { mode: 'stitch', columns: 2, rows: 2 }), /at least 5 cells/);
  assert.throws(() => buildPatternLayout(pages, { mode: 'stitch', columns: 45, rows: 45 }), /2000 cells/);
  const maximum = buildPatternLayout(pages, { mode: 'stitch', selection: '1', columns: 50, rows: 40 });
  assert.equal(maximum.tiles.length, 2000);
  assert.equal(maximum.tiles.filter(tile => tile.pageIndex === -1).length, 1999);
});

test('layout rejects empty selections, impossible crops, and nonpositive track steps', () => {
  const pages = [letter, letter];
  assert.throws(() => buildPatternLayout([], {}), /at least one page/);
  assert.throws(() => buildPatternLayout(pages, { mode: 'continuous', selection: '!1-2' }), /at least one page/);
  assert.throws(() => buildPatternLayout(pages, { trim: { left: letter.widthMm } }), /Trim/);
  assert.throws(() => buildPatternLayout(pages, { trim: { top: 100, bottom: 180 } }), /Trim/);
  assert.throws(() => buildPatternLayout(pages, { trim: { left: -1 } }), /nonnegative/);
  assert.throws(() => buildPatternLayout(pages, { mode: 'stitch', columns: 2, overlapX: letter.widthMm }), /overlap/);
  assert.throws(() => buildPatternLayout(pages, { mode: 'stitch', columns: 1, overlapY: letter.heightMm }), /overlap/);
  assert.throws(() => buildPatternLayout(pages, { mode: 'stitch', columns: 0 }), /Column/);
  assert.throws(() => buildPatternLayout(pages, { pageIndex: 2 }), /valid page/);
  assert.throws(() => buildPatternLayout([{ widthMm: Infinity, heightMm: 100 }]), /finite/);
});

test('visible tile queries respect crop bounds, gaps, and optional prefetch padding', () => {
  const layout = buildPatternLayout(Array(3).fill({ widthMm: 100, heightMm: 100 }), { mode: 'continuous' });
  assert.deepEqual(visibleTiles(layout, { x: 0, y: 105, width: 100, height: 2 }), []);
  assert.deepEqual(visibleTiles(layout, { x: 0, y: 105, width: 100, height: 2 }, 10).map(tile => tile.pageIndex), [0, 1]);
  assert.deepEqual(visibleTiles(layout, { x: 0, y: 110, width: 100, height: 100 }).map(tile => tile.pageIndex), [1]);
  assert.deepEqual(visibleTiles(layout, { x: 0, y: 0, width: 0, height: 100 }), []);
});

test('quarter turns normalize angles and swap physical bounds without changing scale', () => {
  assert.deepEqual(orientedSize(215.9, 279.4, 90), { width: 279.4, height: 215.9, rotation: 90 });
  assert.deepEqual(orientedSize(215.9, 279.4, -90), { width: 279.4, height: 215.9, rotation: 270 });
  assert.deepEqual(orientedSize(215.9, 279.4, 540), { width: 215.9, height: 279.4, rotation: 180 });
  assert.deepEqual(orientedSize(215.9, 279.4, 720), { width: 215.9, height: 279.4, rotation: 0 });
  assert.throws(() => orientedSize(100, 200, 45), /90 degrees/);
});

test('measured scale correction uses physical lengths and rejects missing measurement', () => {
  assert.equal(measurementScale(20, 25), 1.25);
  assert.equal(measurementScale(25.4, 25.4), 1);
  assert.throws(() => measurementScale(0, 25), /positive/);
  assert.throws(() => measurementScale(25, -1), /positive/);
});
