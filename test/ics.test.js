import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toICS, fromICS } from '../src/lib/ics.js';
import { makeEvent } from '../src/lib/model.js';

const data = {
  calendars: [{ id: 'work', name: 'Work', color: '#ff2d55', visible: true }],
  events: [
    makeEvent({
      id: 'abc',
      calendarId: 'work',
      title: 'Planning, Q4; review',
      location: 'Room 1',
      notes: 'Line one\nLine two',
      start: '2026-11-12T14:00',
      end: '2026-11-12T15:30',
      repeat: { freq: 'weekly', interval: 2, byDay: [1, 4], endType: 'count', count: 6 },
      exdates: ['2026-11-19T14:00'],
      alerts: [15],
    }),
    makeEvent({ id: 'trip', calendarId: 'work', title: 'Trip', allDay: true, start: '2026-11-20T00:00', end: '2026-11-23T00:00' }),
  ],
};

test('toICS writes a valid calendar with escaped text, RRULE, EXDATE and VALARM', () => {
  const ics = toICS(data, new Date(Date.UTC(2026, 10, 18, 12, 0)));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /SUMMARY:Planning\\, Q4\\; review\r\n/);
  assert.match(ics, /DESCRIPTION:Line one\\nLine two\r\n/);
  assert.match(ics, /DTSTART:20261112T140000\r\n/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=6\r\n/);
  assert.match(ics, /EXDATE:20261119T140000\r\n/);
  assert.match(ics, /TRIGGER:-PT15M\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261123\r\n/);
});

test('fromICS reads back what toICS wrote', () => {
  let n = 0;
  const events = fromICS(toICS(data), { calendarId: 'imp', idGen: () => `i${++n}` });
  assert.equal(events.length, 2);
  const [a, b] = events;
  assert.equal(a.title, 'Planning, Q4; review');
  assert.equal(a.notes, 'Line one\nLine two');
  assert.equal(a.start, '2026-11-12T14:00');
  assert.equal(a.end, '2026-11-12T15:30');
  assert.deepEqual(a.repeat, { freq: 'weekly', interval: 2, byDay: [1, 4], endType: 'count', count: 6 });
  assert.deepEqual(a.exdates, ['2026-11-19T14:00']);
  assert.deepEqual(a.alerts, [15]);
  assert.equal(a.calendarId, 'imp');
  assert.equal(b.allDay, true);
  assert.equal(b.start, '2026-11-20T00:00');
  assert.equal(b.end, '2026-11-23T00:00');
});

test('fromICS handles folded lines, UTC times, UNTIL and missing DTEND', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'SUMMARY:A very long title that the',
    '  producer folded',
    'DTSTART:20261112T150000Z',
    'DURATION:PT45M',
    'RRULE:FREQ=DAILY;UNTIL=20261120T235959Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:No end',
    'DTSTART;TZID=Europe/London:20261113T090000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const [a, b] = fromICS(text, { calendarId: 'c', idGen: () => 'x' });
  assert.equal(a.title, 'A very long title that the producer folded');
  const start = new Date(Date.UTC(2026, 10, 12, 15, 0));
  const pad = (v) => String(v).padStart(2, '0');
  assert.equal(a.start, `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`);
  assert.equal(a.repeat.freq, 'daily');
  assert.equal(a.repeat.endType, 'until');
  assert.match(a.repeat.until, /^2026-11-2[01]$/);
  // missing DTEND: default 1 hour
  assert.equal(b.start, '2026-11-13T09:00');
  assert.equal(b.end, '2026-11-13T10:00');
});
