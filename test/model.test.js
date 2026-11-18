import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, dtKey } from '../src/lib/dates.js';
import { occurrences, updateOccurrence, deleteOccurrence, search, makeEvent, eventsForCalendarDelete } from '../src/lib/model.js';

const ids = () => {
  let n = 0;
  return () => `new${++n}`;
};

const base = () => ({
  calendars: [
    { id: 'work', name: 'Work', color: '#ff2d55', visible: true },
    { id: 'home', name: 'Home', color: '#34aadc', visible: false },
  ],
  events: [
    makeEvent({ id: 'standup', calendarId: 'work', title: 'Standup', start: '2026-11-02T09:00', end: '2026-11-02T09:15', repeat: { freq: 'weekly', interval: 1 } }),
    makeEvent({ id: 'dentist', calendarId: 'work', title: 'Dentist', location: 'Main St', start: '2026-11-12T14:00', end: '2026-11-12T15:00' }),
    makeEvent({ id: 'hidden', calendarId: 'home', title: 'Secret party', start: '2026-11-12T18:00', end: '2026-11-12T20:00' }),
  ],
});

const occOf = (data, id, key) =>
  occurrences(data, parse('2026-01-01'), parse('2027-01-01'), { includeHidden: true }).find((o) => o.eventId === id && o.key === key);

test('makeEvent fills defaults', () => {
  const e = makeEvent({ id: 'x', calendarId: 'c', start: '2026-11-12T09:00', end: '2026-11-12T10:00' });
  assert.equal(e.title, 'New Event');
  assert.equal(e.allDay, false);
  assert.deepEqual(e.exdates, []);
  assert.deepEqual(e.alerts, []);
  assert.deepEqual(e.invitees, []);
  assert.equal(e.repeat, null);
});

test('occurrences skip hidden calendars, expand repeats and sort by start', () => {
  const occ = occurrences(base(), parse('2026-11-08'), parse('2026-11-15'));
  assert.deepEqual(
    occ.map((o) => [o.eventId, o.key]),
    [
      ['standup', '2026-11-09T09:00'],
      ['dentist', '2026-11-12T14:00'],
    ],
  );
  assert.equal(occ[0].recurring, true);
  assert.equal(occ[0].calendar.name, 'Work');
  assert.equal(occ[1].oid, 'dentist|2026-11-12T14:00');
});

test('all-day occurrences sort before timed ones on the same day', () => {
  const data = base();
  data.events.push(makeEvent({ id: 'trip', calendarId: 'work', title: 'Trip', allDay: true, start: '2026-11-12T00:00', end: '2026-11-13T00:00' }));
  const occ = occurrences(data, parse('2026-11-12'), parse('2026-11-13'));
  assert.equal(occ[0].eventId, 'trip');
});

test('updating a single event merges the patch without mutating the input', () => {
  const data = base();
  const before = JSON.stringify(data);
  const next = updateOccurrence(data, occOf(data, 'dentist', '2026-11-12T14:00'), { title: 'Dentist (moved)', start: '2026-11-13T10:00', end: '2026-11-13T11:00' }, 'single');
  const e = next.events.find((x) => x.id === 'dentist');
  assert.equal(e.title, 'Dentist (moved)');
  assert.equal(e.start, '2026-11-13T10:00');
  assert.equal(JSON.stringify(data), before);
});

test('"Only this event" splits the occurrence into its own event and excludes it from the series', () => {
  const data = base();
  const next = updateOccurrence(data, occOf(data, 'standup', '2026-11-09T09:00'), { start: '2026-11-09T10:00', end: '2026-11-09T10:15' }, 'this', ids());
  const master = next.events.find((x) => x.id === 'standup');
  const single = next.events.find((x) => x.id === 'new1');
  assert.deepEqual(master.exdates, ['2026-11-09T09:00']);
  assert.equal(single.repeat, null);
  assert.equal(single.title, 'Standup');
  assert.equal(single.start, '2026-11-09T10:00');
  assert.equal(single.seriesId, 'standup');
  const week = occurrences(next, parse('2026-11-08'), parse('2026-11-15')).map((o) => [o.eventId, o.key]);
  assert.deepEqual(week, [
    ['new1', '2026-11-09T10:00'],
    ['dentist', '2026-11-12T14:00'],
  ]);
});

test('"All events" shifts the whole series by the same time delta, including exdates', () => {
  const data = base();
  data.events[0].exdates = ['2026-11-16T09:00'];
  const next = updateOccurrence(data, occOf(data, 'standup', '2026-11-09T09:00'), { start: '2026-11-09T11:30', end: '2026-11-09T12:00' }, 'all');
  const master = next.events.find((x) => x.id === 'standup');
  assert.equal(master.start, '2026-11-02T11:30');
  assert.equal(master.end, '2026-11-02T12:00');
  assert.deepEqual(master.exdates, ['2026-11-16T11:30']);
});

test('"All events" with a title-only patch leaves times alone', () => {
  const data = base();
  const next = updateOccurrence(data, occOf(data, 'standup', '2026-11-23T09:00'), { title: 'Daily sync' }, 'all');
  const master = next.events.find((x) => x.id === 'standup');
  assert.equal(master.title, 'Daily sync');
  assert.equal(master.start, '2026-11-02T09:00');
});

test('deleting: single, only this, all future, and future-from-first', () => {
  const data = base();
  const a = deleteOccurrence(data, occOf(data, 'dentist', '2026-11-12T14:00'), 'single');
  assert.equal(a.events.some((x) => x.id === 'dentist'), false);

  const b = deleteOccurrence(data, occOf(data, 'standup', '2026-11-16T09:00'), 'this');
  assert.deepEqual(b.events.find((x) => x.id === 'standup').exdates, ['2026-11-16T09:00']);

  const c = deleteOccurrence(data, occOf(data, 'standup', '2026-11-16T09:00'), 'future');
  const rep = c.events.find((x) => x.id === 'standup').repeat;
  assert.equal(rep.endType, 'until');
  assert.equal(rep.until, '2026-11-15');
  const left = occurrences(c, parse('2026-11-01'), parse('2026-12-31')).filter((o) => o.eventId === 'standup');
  assert.deepEqual(left.map((o) => o.key), ['2026-11-02T09:00', '2026-11-09T09:00']);

  const d = deleteOccurrence(data, occOf(data, 'standup', '2026-11-02T09:00'), 'future');
  assert.equal(d.events.some((x) => x.id === 'standup'), false);
});

test('search matches title, location and notes and returns the next occurrence', () => {
  const data = base();
  const now = parse('2026-11-12T12:00');
  assert.deepEqual(search(data, 'stand', now).map((r) => [r.event.id, dtKey(r.start)]), [['standup', '2026-11-16T09:00']]);
  assert.deepEqual(search(data, 'main st', now).map((r) => r.event.id), ['dentist']);
  assert.deepEqual(search(data, '', now), []);
  // hidden calendars are still searchable
  assert.deepEqual(search(data, 'party', now).map((r) => r.event.id), ['hidden']);
});

test('search lists past one-off events after upcoming ones', () => {
  const data = base();
  data.events.push(makeEvent({ id: 'old', calendarId: 'work', title: 'Standup retro', start: '2026-10-01T09:00', end: '2026-10-01T10:00' }));
  const r = search(data, 'standup', parse('2026-11-12T12:00')).map((x) => x.event.id);
  assert.deepEqual(r, ['standup', 'old']);
});

test('eventsForCalendarDelete removes a calendar and its events', () => {
  const next = eventsForCalendarDelete(base(), 'work');
  assert.deepEqual(next.calendars.map((c) => c.id), ['home']);
  assert.deepEqual(next.events.map((e) => e.id), ['hidden']);
});

test('toggleDone marks one occurrence of a repeating event', async () => {
  const { toggleDone, isDone } = await import('../src/lib/model.js');
  const data = base();
  const occ = occOf(data, 'standup', '2026-11-09T09:00');
  const next = toggleDone(data, occ);
  assert.equal(isDone(occOf(next, 'standup', '2026-11-09T09:00')), true);
  assert.equal(isDone(occOf(next, 'standup', '2026-11-16T09:00')), false);
  assert.equal(isDone(occOf(toggleDone(next, occOf(next, 'standup', '2026-11-09T09:00')), 'standup', '2026-11-09T09:00')), false);
});

test('makeEvent keeps deadline and updatedAt', () => {
  const e = makeEvent({ id: 'x', calendarId: 'c', start: '2026-11-12T09:00', end: '2026-11-12T10:00', deadline: '2026-11-14T17:00', updatedAt: 42 });
  assert.equal(e.deadline, '2026-11-14T17:00');
  assert.equal(e.updatedAt, 42);
});
