import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, merge, signature, SYNCED_PREFS } from '../src/lib/sync.js';

const ev = (id, title, updatedAt) => ({ id, calendarId: 'c1', title, start: '2026-11-18T09:00', end: '2026-11-18T10:00', updatedAt });
const cal = (id, name, updatedAt) => ({ id, name, color: '#34aadc', visible: true, updatedAt });

test('stamp marks new and changed items, leaves untouched ones alone', () => {
  const a = ev('a', 'A', 1);
  const b = ev('b', 'B', 1);
  const prev = { calendars: [cal('c1', 'Work', 1)], events: [a, b], tombstones: [] };
  const next = { ...prev, events: [a, { ...b, title: 'B2' }, ev('c', 'C')] };
  const out = stamp(prev, next, 500);
  assert.equal(out.events[0], a, 'unchanged object is reused');
  assert.equal(out.events[1].updatedAt, 500);
  assert.equal(out.events[2].updatedAt, 500);
  assert.equal(out.calendars[0].updatedAt, 1);
});

test('stamp records deletions as tombstones and clears them when an item comes back (undo)', () => {
  const a = ev('a', 'A', 1);
  const prev = { calendars: [], events: [a], tombstones: [] };
  const deleted = stamp(prev, { ...prev, events: [] }, 600);
  assert.deepEqual(deleted.tombstones, [{ id: 'a', kind: 'event', at: 600 }]);
  const undone = stamp(deleted, { ...deleted, events: [a] }, 700);
  assert.deepEqual(undone.tombstones, []);
  assert.equal(undone.events[0].updatedAt, 700, 'restored item is newer than its tombstone');
});

test('merge keeps the newest version of each item', () => {
  const local = { calendars: [], events: [ev('a', 'local edit', 300), ev('b', 'B', 100)], tombstones: [] };
  const remote = { calendars: [], events: [ev('a', 'remote edit', 200), ev('c', 'from mac', 250)], tombstones: [] };
  const m = merge(local, remote, 1000);
  assert.deepEqual(m.events.map((e) => [e.id, e.title]).sort(), [['a', 'local edit'], ['b', 'B'], ['c', 'from mac']]);
});

test('a deletion on one device removes older copies on the other', () => {
  const local = { calendars: [], events: [ev('a', 'A', 100)], tombstones: [] };
  const remote = { calendars: [], events: [], tombstones: [{ id: 'a', kind: 'event', at: 150 }] };
  const m = merge(local, remote, 1000);
  assert.deepEqual(m.events, []);
  assert.deepEqual(m.tombstones, [{ id: 'a', kind: 'event', at: 150 }]);
});

test('an edit made after a deletion wins over the deletion', () => {
  const local = { calendars: [], events: [ev('a', 'edited later', 200)], tombstones: [] };
  const remote = { calendars: [], events: [], tombstones: [{ id: 'a', kind: 'event', at: 150 }] };
  assert.deepEqual(merge(local, remote, 1000).events.map((e) => e.title), ['edited later']);
});

test('merge is order-independent (both devices converge)', () => {
  const x = { calendars: [cal('c1', 'Work', 5)], events: [ev('a', 'x', 5), ev('b', 'xb', 9)], tombstones: [{ id: 'z', kind: 'event', at: 3 }] };
  const y = { calendars: [cal('c1', 'Job', 7), cal('c2', 'Home', 1)], events: [ev('a', 'y', 6), ev('z', 'old', 2)], tombstones: [] };
  assert.equal(signature(merge(x, y, 1000)), signature(merge(y, x, 1000)));
  const m = merge(x, y, 1000);
  assert.equal(m.calendars.find((c) => c.id === 'c1').name, 'Job');
  assert.equal(m.events.some((e) => e.id === 'z'), false);
});

test('calendar order: local order first, remote-only calendars appended', () => {
  const local = { calendars: [cal('b', 'B', 1), cal('a', 'A', 1)], events: [], tombstones: [] };
  const remote = { calendars: [cal('a', 'A', 1), cal('c', 'C', 1), cal('b', 'B', 1)], events: [], tombstones: [] };
  assert.deepEqual(merge(local, remote, 1000).calendars.map((c) => c.id), ['b', 'a', 'c']);
});

test('old tombstones are pruned after 90 days', () => {
  const day = 86400000;
  const local = { calendars: [], events: [], tombstones: [{ id: 'old', kind: 'event', at: 0 }, { id: 'new', kind: 'event', at: 95 * day }] };
  const m = merge(local, { calendars: [], events: [], tombstones: [] }, 100 * day);
  assert.deepEqual(m.tombstones.map((t) => t.id), ['new']);
});

test('prefs: the newer set wins, and only synced keys travel', () => {
  const local = { calendars: [], events: [], tombstones: [], prefs: { timeFormat: '12', theme: 'dark' }, prefsUpdatedAt: 10 };
  const remote = { calendars: [], events: [], tombstones: [], prefs: { timeFormat: '24' }, prefsUpdatedAt: 20 };
  const m = merge(local, remote, 1000);
  assert.equal(m.prefs.timeFormat, '24');
  assert.equal(m.prefsUpdatedAt, 20);
  assert.equal(SYNCED_PREFS.includes('theme'), false);
});

test('signature changes when content changes and ignores array order', () => {
  const a = { calendars: [cal('c1', 'W', 1)], events: [ev('a', 'A', 1), ev('b', 'B', 2)], tombstones: [] };
  const b = { calendars: [cal('c1', 'W', 1)], events: [ev('b', 'B', 2), ev('a', 'A', 1)], tombstones: [] };
  assert.equal(signature(a), signature(b));
  assert.notEqual(signature(a), signature({ ...a, events: [ev('a', 'A', 3), ev('b', 'B', 2)] }));
});
