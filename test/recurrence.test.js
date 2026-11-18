import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, dtKey } from '../src/lib/dates.js';
import { expand, describe, presetOf, nextOccurrence } from '../src/lib/recurrence.js';

const ev = (over) => ({
  id: 'e1',
  start: '2026-11-02T09:00',
  end: '2026-11-02T10:00',
  allDay: false,
  repeat: null,
  exdates: [],
  ...over,
});
const keys = (occ) => occ.map((o) => o.key);
const range = (a, b) => [parse(a), parse(b)];

test('a non-repeating event appears once when it overlaps the range', () => {
  assert.deepEqual(keys(expand(ev(), ...range('2026-11-01', '2026-11-08'))), ['2026-11-02T09:00']);
  assert.deepEqual(expand(ev(), ...range('2026-11-03', '2026-11-08')), []);
  // range end is exclusive; an event that ends exactly at range start is excluded
  assert.deepEqual(expand(ev(), ...range('2026-11-02T10:00', '2026-11-03')), []);
});

test('daily with interval and count', () => {
  const e = ev({ repeat: { freq: 'daily', interval: 2, endType: 'count', count: 3 } });
  assert.deepEqual(keys(expand(e, ...range('2026-11-01', '2026-12-01'))), [
    '2026-11-02T09:00',
    '2026-11-04T09:00',
    '2026-11-06T09:00',
  ]);
});

test('weekly on several weekdays, every 2 weeks, until a date (inclusive)', () => {
  // 2026-11-02 is a Monday. byDay: Mon(1), Wed(3)
  const e = ev({ repeat: { freq: 'weekly', interval: 2, byDay: [1, 3], endType: 'until', until: '2026-11-30' } });
  assert.deepEqual(keys(expand(e, ...range('2026-11-01', '2027-01-01'))), [
    '2026-11-02T09:00',
    '2026-11-04T09:00',
    '2026-11-16T09:00',
    '2026-11-18T09:00',
    '2026-11-30T09:00',
  ]);
});

test('weekly ignores byDay slots before the series start', () => {
  // starts Wednesday; byDay Mon+Wed -> first is that Wednesday
  const e = ev({ start: '2026-11-04T09:00', end: '2026-11-04T10:00', repeat: { freq: 'weekly', interval: 1, byDay: [1, 3] } });
  assert.deepEqual(keys(expand(e, ...range('2026-11-01', '2026-11-10'))), ['2026-11-04T09:00', '2026-11-09T09:00']);
});

test('weekly without byDay uses the start weekday', () => {
  const e = ev({ repeat: { freq: 'weekly', interval: 1 } });
  assert.deepEqual(keys(expand(e, ...range('2026-11-08', '2026-11-24'))), ['2026-11-09T09:00', '2026-11-16T09:00', '2026-11-23T09:00']);
});

test('monthly on the 31st skips short months', () => {
  const e = ev({ start: '2026-01-31T09:00', end: '2026-01-31T10:00', repeat: { freq: 'monthly', interval: 1 } });
  assert.deepEqual(keys(expand(e, ...range('2026-01-01', '2026-06-01'))), ['2026-01-31T09:00', '2026-03-31T09:00', '2026-05-31T09:00']);
});

test('yearly on Feb 29 only lands in leap years', () => {
  const e = ev({ start: '2024-02-29T09:00', end: '2024-02-29T10:00', repeat: { freq: 'yearly', interval: 1 } });
  assert.deepEqual(keys(expand(e, ...range('2024-01-01', '2029-01-01'))), ['2024-02-29T09:00', '2028-02-29T09:00']);
});

test('exdates remove single occurrences but still count toward COUNT', () => {
  const e = ev({ repeat: { freq: 'daily', interval: 1, endType: 'count', count: 4 }, exdates: ['2026-11-03T09:00'] });
  assert.deepEqual(keys(expand(e, ...range('2026-11-01', '2026-12-01'))), ['2026-11-02T09:00', '2026-11-04T09:00', '2026-11-05T09:00']);
});

test('occurrences keep the event duration and cross midnight correctly', () => {
  const e = ev({ start: '2026-11-02T23:00', end: '2026-11-03T01:30', repeat: { freq: 'daily', interval: 1 } });
  const [first, second] = expand(e, ...range('2026-11-02', '2026-11-04'));
  assert.equal(dtKey(first.end), '2026-11-03T01:30');
  assert.equal(dtKey(second.start), '2026-11-03T23:00');
  assert.equal(dtKey(second.end), '2026-11-04T01:30');
});

test('an occurrence that started before the range but overlaps it is included', () => {
  const e = ev({ start: '2026-11-02T23:00', end: '2026-11-03T01:30', repeat: { freq: 'daily', interval: 1 } });
  assert.deepEqual(keys(expand(e, ...range('2026-11-05T00:00', '2026-11-05T01:00'))), ['2026-11-04T23:00']);
});

test('far-future ranges stay fast and correct for open-ended daily series', () => {
  const e = ev({ repeat: { freq: 'daily', interval: 1 } });
  const out = expand(e, ...range('2036-11-02', '2036-11-03'));
  assert.deepEqual(keys(out), ['2036-11-02T09:00']);
});

test('describe and presetOf', () => {
  assert.equal(presetOf(null), 'never');
  assert.equal(presetOf({ freq: 'weekly', interval: 1 }), 'weekly');
  assert.equal(presetOf({ freq: 'weekly', interval: 1, byDay: [2] }), 'custom');
  assert.equal(presetOf({ freq: 'daily', interval: 3 }), 'custom');
  assert.equal(describe(null), 'Never');
  assert.equal(describe({ freq: 'daily', interval: 1 }), 'Every Day');
  assert.equal(describe({ freq: 'weekly', interval: 2, byDay: [1, 3] }), 'Every 2 weeks on Mon, Wed');
  assert.equal(describe({ freq: 'monthly', interval: 3 }), 'Every 3 months');
});

test('nextOccurrence finds the first occurrence ending after a moment', () => {
  const e = ev({ repeat: { freq: 'weekly', interval: 1 } });
  assert.equal(nextOccurrence(e, parse('2026-11-12T12:00')).key, '2026-11-16T09:00');
  assert.equal(nextOccurrence(ev(), parse('2026-12-01')), null);
  assert.equal(nextOccurrence(ev(), parse('2026-11-01')).key, '2026-11-02T09:00');
});
