import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDay, layoutLanes } from '../src/lib/layout.js';

test('non-overlapping events each get the full width', () => {
  const m = layoutDay([
    { id: 'a', start: 60, end: 120 },
    { id: 'b', start: 120, end: 180 },
  ]);
  assert.deepEqual(m.get('a'), { col: 0, cols: 1 });
  assert.deepEqual(m.get('b'), { col: 0, cols: 1 });
});

test('overlapping events split the column side by side', () => {
  const m = layoutDay([
    { id: 'a', start: 60, end: 180 },
    { id: 'b', start: 90, end: 150 },
    { id: 'c', start: 100, end: 130 },
  ]);
  assert.deepEqual([m.get('a'), m.get('b'), m.get('c')], [
    { col: 0, cols: 3 },
    { col: 1, cols: 3 },
    { col: 2, cols: 3 },
  ]);
});

test('a freed column is reused inside the same cluster', () => {
  const m = layoutDay([
    { id: 'a', start: 0, end: 240 },
    { id: 'b', start: 30, end: 60 },
    { id: 'c', start: 90, end: 120 },
  ]);
  assert.deepEqual(m.get('b'), { col: 1, cols: 2 });
  assert.deepEqual(m.get('c'), { col: 1, cols: 2 });
});

test('separate clusters size independently', () => {
  const m = layoutDay([
    { id: 'a', start: 0, end: 60 },
    { id: 'b', start: 30, end: 60 },
    { id: 'c', start: 300, end: 360 },
  ]);
  assert.equal(m.get('a').cols, 2);
  assert.equal(m.get('c').cols, 1);
});

test('zero-length events still get a slot', () => {
  const m = layoutDay([{ id: 'a', start: 60, end: 60 }]);
  assert.deepEqual(m.get('a'), { col: 0, cols: 1 });
});

test('layoutLanes stacks overlapping multi-day spans into lanes', () => {
  const { lanes, count } = layoutLanes([
    { id: 'a', startCol: 0, endCol: 2 },
    { id: 'b', startCol: 1, endCol: 1 },
    { id: 'c', startCol: 3, endCol: 6 },
    { id: 'd', startCol: 2, endCol: 4 },
  ]);
  assert.equal(lanes.get('a'), 0);
  assert.equal(lanes.get('b'), 1);
  assert.equal(lanes.get('c'), 0);
  assert.equal(lanes.get('d'), 1);
  assert.equal(count, 2);
});

test('layoutLanes puts longer spans first so they stay on top', () => {
  const { lanes } = layoutLanes([
    { id: 'short', startCol: 2, endCol: 2 },
    { id: 'long', startCol: 0, endCol: 6 },
  ]);
  assert.equal(lanes.get('long'), 0);
  assert.equal(lanes.get('short'), 1);
});
