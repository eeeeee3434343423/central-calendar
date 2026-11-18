import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/lib/dates.js';

const d = (s) => D.parse(s);

test('dateKey / dtKey / parse round-trip in local time', () => {
  const x = new Date(2026, 10, 13, 14, 15);
  assert.equal(D.dateKey(x), '2026-11-13');
  assert.equal(D.dtKey(x), '2026-11-13T14:15');
  assert.equal(D.dtKey(D.parse('2026-11-13T14:15')), '2026-11-13T14:15');
  assert.equal(D.dtKey(D.parse('2026-11-13')), '2026-11-13T00:00');
});

test('addDays / addMonths clamp and keep local time', () => {
  assert.equal(D.dtKey(D.addDays(d('2026-11-30T09:00'), 1)), '2026-12-01T09:00');
  assert.equal(D.dateKey(D.addMonths(d('2026-01-31'), 1)), '2026-02-28');
  assert.equal(D.dateKey(D.addMonths(d('2024-01-31'), 1)), '2024-02-29');
  assert.equal(D.dateKey(D.addMonths(d('2026-11-15'), -12)), '2025-11-15');
});

test('startOfWeek honours the week-start day', () => {
  // 2026-11-12 is a Thursday
  assert.equal(D.dateKey(D.startOfWeek(d('2026-11-12'), 0)), '2026-11-08');
  assert.equal(D.dateKey(D.startOfWeek(d('2026-11-12'), 1)), '2026-11-09');
  assert.equal(D.dateKey(D.startOfWeek(d('2026-11-08'), 1)), '2026-11-02');
});

test('diffDays counts calendar days, ignoring time of day', () => {
  assert.equal(D.diffDays(d('2026-11-01T23:00'), d('2026-11-02T01:00')), 1);
  assert.equal(D.diffDays(d('2026-03-01'), d('2026-04-01')), 31);
  assert.equal(D.diffDays(d('2026-11-12'), d('2026-11-08')), -4);
});

test('monthGrid covers whole weeks: Nov 2026 = Nov 1 .. Dec 5 (5 weeks)', () => {
  const g = D.monthGrid(d('2026-11-12'), 0);
  assert.equal(D.dateKey(g.start), '2026-11-01');
  assert.equal(g.weeks, 5);
  assert.equal(D.dateKey(D.addDays(g.start, g.weeks * 7 - 1)), '2026-12-05');
  // Aug 2026 starts on Saturday -> needs 6 weeks
  assert.equal(D.monthGrid(d('2026-08-10'), 0).weeks, 6);
  // Monday start shifts the first cell
  assert.equal(D.dateKey(D.monthGrid(d('2026-11-12'), 1).start), '2026-10-26');
});

test('viewRange for day, week (7 and 5 days, start-with-today) and month', () => {
  const today = d('2026-11-12');
  const prefs = { weekStart: 0, daysPerWeek: 7, startWithToday: false };
  const day = D.viewRange('day', d('2026-11-13'), prefs, today);
  assert.equal(D.dateKey(day.start), '2026-11-13');
  assert.equal(day.days, 1);

  const wk = D.viewRange('week', d('2026-11-12'), prefs, today);
  assert.equal(D.dateKey(wk.start), '2026-11-08');
  assert.equal(wk.days, 7);
  assert.equal(D.dateKey(wk.end), '2026-11-15');

  const work = D.viewRange('week', d('2026-11-12'), { ...prefs, weekStart: 1, daysPerWeek: 5 }, today);
  assert.equal(D.dateKey(work.start), '2026-11-09');
  assert.equal(work.days, 5);

  const rolling = D.viewRange('week', d('2026-11-20'), { ...prefs, startWithToday: true }, today);
  assert.equal(D.dateKey(rolling.start), '2026-11-19');

  const mo = D.viewRange('month', d('2026-11-12'), prefs, today);
  assert.equal(D.dateKey(mo.start), '2026-11-01');
  assert.equal(mo.days, 35);

  const yr = D.viewRange('year', d('2026-11-12'), prefs, today);
  assert.equal(D.dateKey(yr.start), '2026-01-01');
  assert.equal(D.dateKey(yr.end), '2027-01-01');
});

test('stepCursor moves by the view unit', () => {
  const prefs = { weekStart: 0, daysPerWeek: 7, startWithToday: false };
  assert.equal(D.dateKey(D.stepCursor('day', d('2026-11-12'), 1, prefs)), '2026-11-13');
  assert.equal(D.dateKey(D.stepCursor('week', d('2026-11-12'), -1, prefs)), '2026-11-05');
  assert.equal(D.dateKey(D.stepCursor('month', d('2026-01-31'), 1, prefs)), '2026-02-28');
  assert.equal(D.dateKey(D.stepCursor('year', d('2026-11-12'), 1, prefs)), '2027-11-12');
  // rolling 3-day week pages by 3 days
  assert.equal(D.dateKey(D.stepCursor('week', d('2026-11-12'), 1, { ...prefs, daysPerWeek: 3, startWithToday: true })), '2026-11-15');
});

test('formatTime and hourLabel for 12h and 24h', () => {
  assert.equal(D.formatTime(d('2026-11-12T18:17'), false), '6:17 PM');
  assert.equal(D.formatTime(d('2026-11-12T00:05'), false), '12:05 AM');
  assert.equal(D.formatTime(d('2026-11-12T18:17'), true), '18:17');
  assert.equal(D.hourLabel(12, false), 'Noon');
  assert.equal(D.hourLabel(1, false), '1 AM');
  assert.equal(D.hourLabel(13, false), '1 PM');
  assert.equal(D.hourLabel(13, true), '13:00');
});

test('formatDate honours order and separator', () => {
  const x = d('2026-11-03');
  assert.equal(D.formatDate(x, 'MDY', '/'), '11/03/2026');
  assert.equal(D.formatDate(x, 'DMY', '.'), '03.11.2026');
  assert.equal(D.formatDate(x, 'YMD', '-'), '2026-11-03');
});

test('parseTimeInput accepts common typed forms', () => {
  assert.equal(D.parseTimeInput('2:15 pm'), 14 * 60 + 15);
  assert.equal(D.parseTimeInput('14:15'), 14 * 60 + 15);
  assert.equal(D.parseTimeInput('9'), 9 * 60);
  assert.equal(D.parseTimeInput('9a'), 9 * 60);
  assert.equal(D.parseTimeInput('12am'), 0);
  assert.equal(D.parseTimeInput('12 PM'), 12 * 60);
  assert.equal(D.parseTimeInput('0930'), 9 * 60 + 30);
  assert.equal(D.parseTimeInput('noon'), 12 * 60);
  assert.equal(D.parseTimeInput('25:00'), null);
  assert.equal(D.parseTimeInput('abc'), null);
});

test('nextHalfHour rounds strictly up to :00 or :30', () => {
  assert.equal(D.dtKey(D.nextHalfHour(d('2026-11-12T18:17'))), '2026-11-12T18:30');
  assert.equal(D.dtKey(D.nextHalfHour(d('2026-11-12T18:30'))), '2026-11-12T19:00');
  assert.equal(D.dtKey(D.nextHalfHour(d('2026-11-12T23:45'))), '2026-11-13T00:00');
});

test('snap rounds minutes to the step', () => {
  assert.equal(D.snap(133, 5), 135);
  assert.equal(D.snap(132, 5), 130);
  assert.equal(D.snap(7, 15), 0);
});

test('formatDuration reads naturally', () => {
  assert.equal(D.formatDuration(15), '15 min');
  assert.equal(D.formatDuration(60), '1 hr');
  assert.equal(D.formatDuration(90), '1 hr 30 min');
  assert.equal(D.formatDuration(120), '2 hr');
  assert.equal(D.formatDuration(1440), '1 day');
  assert.equal(D.formatDuration(2 * 1440 + 60), '2 days 1 hr');
});

test('formatRelative gives a countdown or time since', () => {
  const now = d('2026-11-18T08:00');
  assert.equal(D.formatRelative(d('2026-11-18T08:25'), now), 'in 25 min');
  assert.equal(D.formatRelative(d('2026-11-18T10:30'), now), 'in 2 hr 30 min');
  assert.equal(D.formatRelative(d('2026-11-20T09:00'), now), 'in 2 days 1 hr');
  assert.equal(D.formatRelative(d('2026-11-19T21:30'), now), 'in 1 day 13 hr');
  assert.equal(D.formatRelative(d('2026-11-25T09:00'), now), 'in 7 days');
  assert.equal(D.formatRelative(d('2026-11-18T07:00'), now), '1 hr ago');
  assert.equal(D.formatRelative(d('2026-11-15T08:00'), now), '3 days ago');
  assert.equal(D.formatRelative(d('2026-11-18T08:00'), now), 'now');
});
