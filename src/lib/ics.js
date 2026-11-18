// iCalendar (.ics) export and import. Times are written as floating local times.
import { parse, pad, dtKey, dateKey, addDays, addMinutes } from './dates.js';
import { makeEvent } from './model.js';

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unesc = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

function fold(line) {
  if (line.length <= 74) return line;
  const parts = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73));
  return parts.join('\r\n');
}

const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const icsDateTime = (d) => `${icsDate(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function trigger(minutesBefore) {
  if (minutesBefore === 0) return 'PT0S';
  return `${minutesBefore > 0 ? '-' : ''}PT${Math.abs(minutesBefore)}M`;
}

export function toICS(data, now = new Date()) {
  const cals = new Map(data.calendars.map((c) => [c.id, c]));
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Central//Central Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Central Calendar'];
  for (const ev of data.events) {
    const s = parse(ev.start);
    const e = parse(ev.end);
    L.push('BEGIN:VEVENT', `UID:${ev.id}@central-calendar`, `DTSTAMP:${icsUtc(now)}`, `SUMMARY:${esc(ev.title)}`);
    if (ev.allDay) L.push(`DTSTART;VALUE=DATE:${icsDate(s)}`, `DTEND;VALUE=DATE:${icsDate(e)}`);
    else L.push(`DTSTART:${icsDateTime(s)}`, `DTEND:${icsDateTime(e)}`);
    if (ev.location) L.push(`LOCATION:${esc(ev.location)}`);
    if (ev.notes) L.push(`DESCRIPTION:${esc(ev.notes)}`);
    if (ev.url) L.push(`URL:${ev.url}`);
    const cal = cals.get(ev.calendarId);
    if (cal) L.push(`CATEGORIES:${esc(cal.name)}`);
    if (ev.repeat) {
      const r = ev.repeat;
      let rule = `FREQ=${r.freq.toUpperCase()}`;
      if ((r.interval || 1) > 1) rule += `;INTERVAL=${r.interval}`;
      if (r.freq === 'weekly' && r.byDay && r.byDay.length) rule += `;BYDAY=${[...r.byDay].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(',')}`;
      if (r.endType === 'count' && r.count) rule += `;COUNT=${r.count}`;
      if (r.endType === 'until' && r.until) rule += `;UNTIL=${ev.allDay ? icsDate(parse(r.until)) : icsDate(parse(r.until)) + 'T235959'}`;
      L.push(`RRULE:${rule}`);
      for (const x of ev.exdates) L.push(ev.allDay ? `EXDATE;VALUE=DATE:${icsDate(parse(x))}` : `EXDATE:${icsDateTime(parse(x))}`);
    }
    for (const a of ev.alerts) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, `TRIGGER:${trigger(a)}`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** Parse an ICS date or date-time value into { date: Date, allDay: bool }. */
function parseIcsValue(value, params) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  if (!m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
  if (m[7]) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))), allDay: false };
  // TZID times are treated as floating local times (no time zone database in the browser build).
  return { date: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), allDay: params.VALUE === 'DATE' };
}

/** ISO 8601 duration in minutes, e.g. -PT15M, P1D, PT1H30M. */
function parseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const mins = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.round((+m[6] || 0) / 60);
  return m[1] === '-' ? -mins : mins;
}

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(';');
  const params = {};
  for (const p of rawParams) {
    const [k, ...rest] = p.split('=');
    params[k.toUpperCase()] = rest.join('=').replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function parseRRule(value, allDay) {
  const parts = Object.fromEntries(value.split(';').map((p) => p.split('=')));
  const freq = (parts.FREQ || '').toLowerCase();
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null;
  const rule = { freq, interval: Math.max(1, +parts.INTERVAL || 1) };
  if (freq === 'weekly' && parts.BYDAY) {
    const days = parts.BYDAY.split(',').map((c) => DAY_CODES.indexOf(c.replace(/^[+-]?\d+/, ''))).filter((d) => d >= 0);
    if (days.length) rule.byDay = [...new Set(days)].sort((a, b) => a - b);
  }
  if (parts.COUNT) {
    rule.endType = 'count';
    rule.count = Math.max(1, +parts.COUNT);
  } else if (parts.UNTIL) {
    const u = parseIcsValue(parts.UNTIL, {});
    if (u) {
      rule.endType = 'until';
      rule.until = dateKey(u.date);
    } else rule.endType = 'never';
  } else {
    rule.endType = 'never';
  }
  void allDay;
  return rule;
}

export function fromICS(text, { calendarId, idGen = () => crypto.randomUUID() }) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  let inAlarm = false;
  for (const raw of lines) {
    if (!raw) continue;
    const ln = parseLine(raw);
    if (!ln) continue;
    if (ln.name === 'BEGIN' && ln.value === 'VEVENT') {
      cur = { exdates: [], alerts: [] };
      continue;
    }
    if (!cur) continue;
    if (ln.name === 'BEGIN' && ln.value === 'VALARM') inAlarm = true;
    else if (ln.name === 'END' && ln.value === 'VALARM') inAlarm = false;
    else if (inAlarm) {
      if (ln.name === 'TRIGGER' && ln.params.VALUE !== 'DATE-TIME' && ln.params.RELATED !== 'END') {
        const d = parseDuration(ln.value);
        if (d !== null) cur.alerts.push(-d);
      }
    } else if (ln.name === 'END' && ln.value === 'VEVENT') {
      const ev = finishEvent(cur, calendarId, idGen);
      if (ev) events.push(ev);
      cur = null;
    } else if (ln.name === 'SUMMARY') cur.title = unesc(ln.value);
    else if (ln.name === 'LOCATION') cur.location = unesc(ln.value);
    else if (ln.name === 'DESCRIPTION') cur.notes = unesc(ln.value);
    else if (ln.name === 'URL') cur.url = ln.value;
    else if (ln.name === 'DTSTART') cur.dtstart = parseIcsValue(ln.value, ln.params);
    else if (ln.name === 'DTEND') cur.dtend = parseIcsValue(ln.value, ln.params);
    else if (ln.name === 'DURATION') cur.duration = parseDuration(ln.value);
    else if (ln.name === 'RRULE') cur.rrule = ln.value;
    else if (ln.name === 'EXDATE') {
      for (const v of ln.value.split(',')) {
        const p = parseIcsValue(v, ln.params);
        if (p) cur.exdates.push(dtKey(p.date));
      }
    }
  }
  return events;
}

function finishEvent(cur, calendarId, idGen) {
  if (!cur.dtstart) return null;
  const allDay = cur.dtstart.allDay;
  const start = cur.dtstart.date;
  let end;
  if (cur.dtend) end = cur.dtend.date;
  else if (cur.duration != null) end = addMinutes(start, cur.duration);
  else end = allDay ? addDays(start, 1) : addMinutes(start, 60);
  if (end < start) end = start;
  return makeEvent({
    id: idGen(),
    calendarId,
    title: cur.title || 'Untitled',
    location: cur.location,
    notes: cur.notes,
    url: cur.url,
    allDay,
    start: dtKey(start),
    end: dtKey(end),
    repeat: cur.rrule ? parseRRule(cur.rrule, allDay) : null,
    exdates: cur.exdates,
    alerts: [...new Set(cur.alerts)].slice(0, 2),
  });
}
