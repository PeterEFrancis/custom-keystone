import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory } from '../dist/history.js';

function fixture(options = {}) {
  let state = { x: 0, layers: [{ id: 'size', visible: true }] };
  const changes = [];
  const history = createHistory({ capture: () => state, restore: value => { state = value; }, onChange: value => changes.push(value), ...options });
  return { history, changes, get state() { return state; }, set state(value) { state = value; } };
}

test('undo and redo restore independent nested snapshots without retaining caller references', () => {
  const f = fixture(), original = f.state;
  assert.equal(f.history.transaction(() => { f.state.x = 10; f.state.layers[0].visible = false; return 'edited'; }), 'edited');
  original.x = 900;
  assert.equal(f.history.undo(), true);
  assert.deepEqual(f.state, { x: 0, layers: [{ id: 'size', visible: true }] });
  f.state.layers[0].visible = false;
  assert.equal(f.history.redo(), true);
  assert.deepEqual(f.state, { x: 10, layers: [{ id: 'size', visible: false }] });
  f.history.undo();
  assert.equal(f.state.layers[0].visible, true);
});

test('no-op edits preserve redo and ignore equivalent object property order', () => {
  const f = fixture();
  f.history.transaction(() => { f.state.x = 1; });
  f.history.undo();
  f.history.transaction(() => { f.state = { layers: f.state.layers, x: 0 }; });
  assert.equal(f.history.canUndo, false);
  assert.equal(f.history.canRedo, true);
  f.history.redo();
  assert.equal(f.state.x, 1);
});

test('a real edit after undo abandons only the redo branch', () => {
  const f = fixture();
  for (const x of [1, 2, 3]) f.history.transaction(() => { f.state.x = x; });
  f.history.undo(); f.history.undo();
  f.history.transaction(() => { f.state.x = 8; });
  assert.equal(f.history.canRedo, false);
  f.history.undo(); assert.equal(f.state.x, 1);
  f.history.undo(); assert.equal(f.state.x, 0);
  assert.equal(f.history.undo(), false);
});

test('consecutive grouped edits undo together and explicit boundaries start another step', () => {
  const f = fixture();
  for (const x of [1, 2, 3]) f.history.transaction(() => { f.state.x = x; }, { group: 'pan' });
  f.history.endGroup();
  f.history.transaction(() => { f.state.x = 4; }, { group: 'pan' });
  f.history.undo(); assert.equal(f.state.x, 3);
  f.history.undo(); assert.equal(f.state.x, 0);
  f.history.redo(); assert.equal(f.state.x, 3);
  f.history.redo(); assert.equal(f.state.x, 4);
});

test('different groups and ungrouped no-ops break consecutive grouping', () => {
  const f = fixture();
  f.history.transaction(() => { f.state.x = 1; }, { group: 'pan' });
  f.history.transaction(() => {}, { group: 'scale' });
  f.history.transaction(() => { f.state.x = 2; }, { group: 'pan' });
  f.history.transaction(() => {});
  f.history.transaction(() => { f.state.x = 3; }, { group: 'pan' });
  for (const x of [2, 1, 0]) { f.history.undo(); assert.equal(f.state.x, x); }
});

test('a net-zero group removes itself, restores redo, and can continue from its original start', () => {
  const f = fixture();
  f.history.transaction(() => { f.state.x = 10; });
  f.history.undo();
  f.history.transaction(() => { f.state.x = 1; }, { group: 'pan' });
  assert.equal(f.history.canRedo, false);
  f.history.transaction(() => { f.state.x = 0; }, { group: 'pan' });
  assert.equal(f.history.canUndo, false);
  assert.equal(f.history.canRedo, true);
  f.history.transaction(() => { f.state.x = 2; }, { group: 'pan' });
  assert.equal(f.history.canRedo, false);
  f.history.undo(); assert.equal(f.state.x, 0);
  f.history.redo(); assert.equal(f.state.x, 2);
});

test('a bounded history retains recent steps without losing old steps to a net-zero group', () => {
  const f = fixture({ limit: 2 });
  for (const x of [1, 2]) f.history.transaction(() => { f.state.x = x; });
  f.history.transaction(() => { f.state.x = 3; }, { group: 'drag' });
  f.history.transaction(() => { f.state.x = 2; }, { group: 'drag' });
  f.history.endGroup();
  f.history.undo(); assert.equal(f.state.x, 1);
  f.history.undo(); assert.equal(f.state.x, 0);
  f.history.clear();
  for (const x of [1, 2, 3, 4]) f.history.transaction(() => { f.state.x = x; });
  f.history.undo(); assert.equal(f.state.x, 3);
  f.history.undo(); assert.equal(f.state.x, 2);
  assert.equal(f.history.undo(), false);
  f.history.redo(); f.history.redo(); assert.equal(f.state.x, 4);
});

test('an explicit gesture includes direct changes and inner transactions in one step', () => {
  const f = fixture();
  assert.equal(f.history.begin(), true);
  f.state.x = 1;
  assert.equal(f.history.begin(), false);
  f.history.transaction(() => { f.state.x = 2; }, { group: 'inner' });
  f.state.layers[0].visible = false;
  assert.equal(f.history.canUndo, false);
  assert.equal(f.history.commit(), true);
  assert.equal(f.history.commit(), false);
  f.history.undo(); assert.equal(f.state.x, 0); assert.equal(f.state.layers[0].visible, true);
  f.history.redo(); assert.equal(f.state.x, 2); assert.equal(f.state.layers[0].visible, false);
});

test('cancel restores a gesture without creating a step or losing redo', () => {
  const f = fixture();
  f.history.transaction(() => { f.state.x = 1; }); f.history.undo();
  f.history.begin(); f.state.x = 9; f.history.transaction(() => { f.state.layers[0].visible = false; });
  assert.equal(f.history.cancel(), true);
  assert.equal(f.history.cancel(), false);
  assert.deepEqual(f.state, { x: 0, layers: [{ id: 'size', visible: true }] });
  assert.equal(f.history.canUndo, false); assert.equal(f.history.canRedo, true);
  f.history.redo(); assert.equal(f.state.x, 1);
});

test('undo first commits the pending gesture and redo commits new branches before deciding availability', () => {
  const f = fixture();
  f.history.begin(); f.state.x = 3;
  assert.equal(f.history.undo(), true); assert.equal(f.state.x, 0);
  assert.equal(f.history.redo(), true); assert.equal(f.state.x, 3);
  f.history.undo(); f.history.begin(); f.state.x = 8;
  assert.equal(f.history.redo(), false); assert.equal(f.state.x, 8);
  f.history.undo(); assert.equal(f.state.x, 0);
});

test('an explicit no-op keeps redo and clear discards pending history without restoring state', () => {
  const f = fixture();
  f.history.transaction(() => { f.state.x = 2; }); f.history.undo();
  f.history.begin(); f.state.x = 3; f.state.x = 0;
  assert.equal(f.history.commit(), false); assert.equal(f.history.canRedo, true);
  f.history.begin(); f.state.x = 8; f.history.clear();
  assert.equal(f.state.x, 8); assert.equal(f.history.commit(), false);
  assert.equal(f.history.canUndo, false); assert.equal(f.history.canRedo, false);
});

test('nested synchronous actions become one step and a failed action rolls back', () => {
  const f = fixture();
  f.history.transaction(() => {
    f.state.x = 1;
    f.history.transaction(() => { f.state.layers[0].visible = false; });
  });
  f.history.undo(); assert.equal(f.state.x, 0); assert.equal(f.history.canUndo, false);
  assert.throws(() => f.history.transaction(() => { f.state.x = 999; throw new Error('Rejected edit'); }), /Rejected edit/);
  assert.equal(f.state.x, 0); assert.equal(f.history.canRedo, true);
  f.history.redo(); assert.equal(f.state.x, 1);
});

test('a transaction producing an unclonable snapshot rolls back without losing redo', () => {
  const f = fixture();
  f.history.transaction(() => { f.state.x = 1; }); f.history.undo();
  assert.throws(() => f.history.transaction(() => { f.state.invalid = () => {}; }), { name: 'DataCloneError' });
  assert.equal(Object.hasOwn(f.state, 'invalid'), false);
  assert.equal(f.history.canUndo, false); assert.equal(f.history.canRedo, true);
});

test('an inner action cannot prematurely commit an explicit gesture', () => {
  const f = fixture();
  f.history.begin();
  f.history.transaction(() => { f.state.x = 1; assert.equal(f.history.commit(), false); f.state.x = 2; });
  assert.equal(f.history.canUndo, false);
  f.history.commit(); f.history.undo(); assert.equal(f.state.x, 0);
});

test('availability notifications occur only when the flags change', () => {
  const f = fixture();
  f.history.transaction(() => {});
  f.history.transaction(() => { f.state.x = 1; });
  f.history.transaction(() => { f.state.x = 2; });
  f.history.undo(); f.history.undo(); f.history.undo();
  f.history.redo(); f.history.redo(); f.history.clear(); f.history.clear();
  assert.deepEqual(f.changes, [
    { canUndo: true, canRedo: false }, { canUndo: true, canRedo: true },
    { canUndo: false, canRedo: true }, { canUndo: true, canRedo: true },
    { canUndo: true, canRedo: false }, { canUndo: false, canRedo: false },
  ]);
});

test('failed restoration leaves the history entry available for a retry', () => {
  let state = 0, fail = false;
  const history = createHistory({ capture: () => state, restore: value => { if (fail) throw Error('Restore failed'); state = value; } });
  history.transaction(() => { state = 1; }); fail = true;
  assert.throws(() => history.undo(), /Restore failed/);
  assert.equal(history.canUndo, true); assert.equal(history.canRedo, false);
  fail = false; history.undo(); assert.equal(state, 0);
});

test('structured snapshots preserve cycles, typed data, dates, and map values', () => {
  let state = { date: new Date('2026-09-15'), values: new Float32Array([1, 2]), sizes: new Map([['S', true]]) };
  state.self = state;
  const history = createHistory({ capture: () => state, restore: value => { state = value; } });
  history.transaction(() => {}); assert.equal(history.canUndo, false);
  history.transaction(() => { state.values[1] = 9; state.sizes.set('S', false); });
  history.undo();
  assert.equal(state.self, state); assert.equal(state.values[1], 2); assert.equal(state.sizes.get('S'), true);
  assert.equal(state.date.toISOString(), '2026-09-15T00:00:00.000Z');
});

test('invalid configuration and asynchronous callbacks fail clearly; zero limit disables retention', () => {
  assert.throws(() => createHistory(), /capture and restore/);
  assert.throws(() => fixture({ limit: -1 }), /non-negative integer/);
  assert.throws(() => fixture({ limit: 1.5 }), /non-negative integer/);
  const f = fixture();
  assert.throws(() => f.history.transaction(async () => { f.state.x = 9; }), /synchronous/);
  assert.equal(f.state.x, 0); assert.equal(f.history.canUndo, false);
  const disabled = fixture({ limit: 0 }); disabled.history.transaction(() => { disabled.state.x = 2; });
  assert.equal(disabled.state.x, 2); assert.equal(disabled.history.canUndo, false);
});
