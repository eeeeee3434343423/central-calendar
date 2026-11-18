import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/lib/quickadd.js';
import { dtKey } from '../src/lib/dates.js';

// Wednesday 2026-11-18, 08:10
const now = new Date(2026, 10, 18, 8, 10);
const q = (text, opts = {}) => {
  const r = parseQuickAdd(text, { now, base: now, defaultDuration: 15, ...opts });
  return r && { title: r.title, allDay: r.allDay, start: dtKey(r.start), end: dtKey(r.end) };
};

test('time + duration: "Focus 4pm 15m"', () => {
  assert.deepEqual(q('Focus 4pm 15m'), { title: 'Focus', allDay: false, start: '2026-11-18T16:00', end: '2026-11-18T16:15' });
});

test('"at 4 for 15 minutes" reads 4 as afternoon', () => {
  assert.deepEqual(q('Call mom at 4 for 15 minutes'), { title: 'Call mom', allDay: false, start: '2026-11-18T16:00', end: '2026-11-18T16:15' });
});

test('time with no duration uses the default block length', () => {
  assert.deepEqual(q('Email 9:15'), { title: 'Email', allDay: false, start: '2026-11-18T09:15', end: '2026-11-18T09:30' });
  assert.equal(q('Email 9:15', { defaultDuration: 60 }).end, '2026-11-18T10:15');
});

test('ranges, with the meridiem borrowed from the end time', () => {
  assert.deepEqual(q('Standup 9:30-9:45am'), { title: 'Standup', allDay: false, start: '2026-11-18T09:30', end: '2026-11-18T09:45' });
  assert.deepEqual(q('Lunch 12-1pm'), { title: 'Lunch', allDay: false, start: '2026-11-18T12:00', end: '2026-11-18T13:00' });
  assert.deepEqual(q('Workshop 11 to 1pm'), { title: 'Workshop', allDay: false, start: '2026-11-18T11:00', end: '2026-11-18T13:00' });
  assert.deepEqual(q('Gym 17:00–18:30'), { title: 'Gym', allDay: false, start: '2026-11-18T17:00', end: '2026-11-18T18:30' });
});

test('hours and mixed durations', () => {
  assert.equal(q('Deep work 2pm 1h30m').end, '2026-11-18T15:30');
  assert.equal(q('Deep work 2pm 1.5h').end, '2026-11-18T15:30');
  assert.equal(q('Deep work 2pm 90 min').end, '2026-11-18T15:30');
  assert.equal(q('Deep work 2pm for 2 hours').end, '2026-11-18T16:00');
});

test('dates: tomorrow, weekday names, next weekday, month day, m/d', () => {
  assert.equal(q('Dentist tomorrow 3pm').start, '2026-11-19T15:00');
  assert.equal(q('Dentist fri 3pm').start, '2026-11-20T15:00');
  assert.equal(q('Dentist on Wednesday 3pm').start, '2026-11-18T15:00');
  assert.equal(q('Dentist next wed 3pm').start, '2026-11-25T15:00');
  assert.equal(q('Dentist Dec 3 at 10am').start, '2026-12-03T10:00');
  assert.equal(q('Dentist 12/3 10am').start, '2026-12-03T10:00');
  assert.equal(q('Dentist 1/5 10am').start, '2027-01-05T10:00');
});

test('no time means an all-day item on that date', () => {
  assert.deepEqual(q('Pay rent tomorrow'), { title: 'Pay rent', allDay: true, start: '2026-11-19T00:00', end: '2026-11-20T00:00' });
});

test('duration without a time starts at the next half hour today', () => {
  assert.deepEqual(q('Inbox zero 30m'), { title: 'Inbox zero', allDay: false, start: '2026-11-18T08:30', end: '2026-11-18T09:00' });
  // on another day it starts at 9 AM
  assert.equal(q('Inbox zero tomorrow 30m').start, '2026-11-19T09:00');
});

test('the base date is used when no date is typed', () => {
  const base = new Date(2026, 10, 24);
  assert.equal(q('Review 10am', { base }).start, '2026-11-24T10:00');
});

test('noon and midnight words, and an untitled block', () => {
  assert.equal(q('Lunch at noon').start, '2026-11-18T12:00');
  assert.deepEqual(q('4pm 15m'), { title: 'New Event', allDay: false, start: '2026-11-18T16:00', end: '2026-11-18T16:15' });
});

test('empty input returns null', () => {
  assert.equal(parseQuickAdd('   ', { now, base: now, defaultDuration: 15 }), null);
});

test('numbers inside words stay in the title', () => {
  assert.equal(q('Read chapter 4 at 7pm').title, 'Read chapter 4');
  assert.equal(q('Read chapter 4 at 7pm').start, '2026-11-18T19:00');
});
