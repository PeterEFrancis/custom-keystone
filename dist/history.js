// Snapshots contain application state, never live documents, DOM nodes, or files.
function sameSnapshot(left, right, leftSeen = new WeakMap(), rightSeen = new WeakMap()) {
  if (left === right || (Number.isNaN(left) && Number.isNaN(right))) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Object.prototype.toString.call(left) !== Object.prototype.toString.call(right)) return false;
  if (leftSeen.has(left)) return leftSeen.get(left) === right;
  if (rightSeen.has(right)) return false;
  leftSeen.set(left, right);
  rightSeen.set(right, left);
  if (left instanceof Date) return Object.is(left.getTime(), right.getTime());
  if (left instanceof RegExp) return left.source === right.source && left.flags === right.flags;
  if (left instanceof ArrayBuffer || ArrayBuffer.isView(left)) {
    if (left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left.buffer || left, left.byteOffset || 0, left.byteLength);
    const b = new Uint8Array(right.buffer || right, right.byteOffset || 0, right.byteLength);
    return a.every((value, index) => value === b[index]);
  }
  if (left instanceof Map || left instanceof Set) {
    if (left.size !== right.size) return false;
    const a = [...left], b = [...right];
    return a.every((value, index) => sameSnapshot(value, b[index], leftSeen, rightSeen));
  }
  const keys = Object.keys(left), otherKeys = Object.keys(right);
  return keys.length === otherKeys.length && keys.every(key =>
    Object.hasOwn(right, key) && sameSnapshot(left[key], right[key], leftSeen, rightSeen));
}

function synchronous(fn, ...args) {
  if (Object.prototype.toString.call(fn) === '[object AsyncFunction]') {
    throw new TypeError('History callbacks must be synchronous.');
  }
  const result = fn(...args);
  if (result && typeof result.then === 'function') {
    // Avoid an unhandled rejection, but callers must not start asynchronous edits.
    Promise.resolve(result).catch(() => {});
    throw new TypeError('History callbacks must be synchronous.');
  }
  return result;
}

/**
 * Track synchronous edits using independent structured-clone snapshots.
 * transaction() returns its callback's value. begin()/commit()/cancel() and
 * undo()/redo() return whether they opened, committed, cancelled, or restored.
 * Repeated begin() calls share the current gesture. clear() keeps current state.
 * onChange({canUndo, canRedo}) runs only when those availability flags change.
 */
export function createHistory({ capture, restore, onChange, limit = 100 } = {}) {
  if (typeof capture !== 'function' || typeof restore !== 'function') {
    throw new TypeError('History needs capture and restore functions.');
  }
  if (onChange !== undefined && typeof onChange !== 'function') throw new TypeError('onChange must be a function.');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('History limit must be a non-negative integer.');
  let undoSteps = [], redoSteps = [], pending = null, groupState = null;
  let depth = 0, restoring = false;
  let lastCanUndo = false, lastCanRedo = false;
  const snapshot = () => structuredClone(synchronous(capture));
  const notify = () => {
    const canUndo = undoSteps.length > 0, canRedo = redoSteps.length > 0;
    if (canUndo === lastCanUndo && canRedo === lastCanRedo) return;
    lastCanUndo = canUndo;
    lastCanRedo = canRedo;
    onChange?.({ canUndo, canRedo });
  };
  const endGroup = () => { groupState = null; };
  const bounded = steps => limit ? steps.slice(-limit) : [];
  const apply = value => {
    restoring = true;
    try { synchronous(restore, structuredClone(value)); }
    finally { restoring = false; }
  };

  function record(before, after, group = null) {
    if (groupState && (group === null || !Object.is(groupState.key, group) || !sameSnapshot(groupState.after, before))) endGroup();
    if (sameSnapshot(before, after)) return false;
    if (group !== null) {
      groupState ??= { key: group, before, after: before, undoBefore: undoSteps.slice(), redoBefore: redoSteps.slice() };
      groupState.after = after;
      if (sameSnapshot(groupState.before, after)) {
        // A gesture returning to its start must not evict history or destroy redo.
        undoSteps = groupState.undoBefore.slice();
        redoSteps = groupState.redoBefore.slice();
      } else {
        undoSteps = bounded([...groupState.undoBefore, { before: groupState.before, after }]);
        redoSteps = [];
      }
    } else {
      undoSteps = bounded([...undoSteps, { before, after }]);
      redoSteps = [];
    }
    notify();
    return true;
  }

  function transaction(fn, { group = null } = {}) {
    if (typeof fn !== 'function') throw new TypeError('A history transaction needs a function.');
    // Explicit gestures and nested actions are captured by their outer boundary.
    if (pending || depth || restoring) {
      depth++;
      try { return synchronous(fn); }
      finally { depth--; }
    }
    const before = snapshot();
    let result, after;
    depth++;
    try { result = synchronous(fn); after = snapshot(); }
    catch (error) {
      apply(before);
      throw error;
    } finally { depth--; }
    record(before, after, group);
    return result;
  }

  function begin() {
    if (pending || depth || restoring) return false;
    const before = snapshot();
    endGroup();
    pending = { before };
    return true;
  }

  function commit() {
    if (!pending || depth || restoring) return false;
    const after = snapshot(), before = pending.before;
    pending = null;
    return record(before, after);
  }

  function cancel() {
    if (!pending || depth || restoring) return false;
    apply(pending.before);
    pending = null;
    endGroup();
    return true;
  }

  function undo() {
    if (depth || restoring) return false;
    commit();
    endGroup();
    const step = undoSteps.at(-1);
    if (!step) return false;
    // Do not move either stack until restoration succeeds.
    apply(step.before);
    undoSteps.pop();
    redoSteps.push(step);
    notify();
    return true;
  }

  function redo() {
    if (depth || restoring) return false;
    commit();
    endGroup();
    const step = redoSteps.at(-1);
    if (!step) return false;
    apply(step.after);
    redoSteps.pop();
    undoSteps.push(step);
    notify();
    return true;
  }

  function clear() {
    if (depth || restoring) return;
    undoSteps = [];
    redoSteps = [];
    pending = null;
    endGroup();
    notify();
  }

  return { transaction, begin, commit, cancel, undo, redo, clear, endGroup,
    get canUndo() { return undoSteps.length > 0; },
    get canRedo() { return redoSteps.length > 0; },
  };
}
