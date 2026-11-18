// Pure data operations on { calendars, events }. Inputs are never mutated.
import { parse, dtKey, dateKey, addDays, addMinutes, diffMinutes, diffDays, startOfDay } from './dates.js';
import { expand, nextOccurrence } from './recurrence.js';

export function makeEvent(f) {
  return {
    id: f.id,
    calendarId: f.calendarId,
    title: f.title ?? 'New Event',
    location: f.location ?? '',
    notes: f.notes ?? '',
    url: f.url ?? '',
    allDay: !!f.allDay,
    start: f.start,
    end: f.end,
    repeat: f.repeat ? { ...f.repeat, ...(f.repeat.byDay ? { byDay: [...f.repeat.byDay] } : {}) } : null,
    exdates: f.exdates ? [...f.exdates] : [],
    alerts: f.alerts ? [...f.alerts] : [],
    invitees: f.invitees ? [...f.invitees] : [],
    seriesId: f.seriesId ?? null,
    deadline: f.deadline || null,
    completed: f.completed ? [...f.completed] : [],
    ...(f.updatedAt ? { updatedAt: f.updatedAt } : {}),
  };
}

/** Is this occurrence marked done? */
export function isDone(occ) {
  return !!(occ.event && occ.event.completed && occ.event.completed.includes(occ.key));
}

/** Toggle done for one occurrence (repeating events track each occurrence separately). */
export function toggleDone(data, occ) {
  return replaceEvent(data, occ.eventId, (e) => {
    const has = e.completed.includes(occ.key);
    return [makeEvent({ ...e, completed: has ? e.completed.filter((k) => k !== occ.key) : [...e.completed, occ.key] })];
  });
}

function compareOcc(a, b) {
  return (
    diffDays(b.start, a.start) ||
    (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) ||
    a.start - b.start ||
    b.end - b.start - (a.end - a.start) ||
    a.event.title.localeCompare(b.event.title)
  );
}

/** Concrete occurrences overlapping [start, end), sorted for display. */
export function occurrences(data, start, end, { includeHidden = false } = {}) {
  const cals = new Map(data.calendars.map((c) => [c.id, c]));
  const out = [];
  for (const ev of data.events) {
    const cal = cals.get(ev.calendarId);
    if (!cal || (!includeHidden && !cal.visible)) continue;
    for (const o of expand(ev, start, end)) {
      out.push({
        oid: `${ev.id}|${o.key}`,
        eventId: ev.id,
        key: o.key,
        start: o.start,
        end: o.end,
        allDay: ev.allDay,
        event: ev,
        calendar: cal,
        recurring: !!ev.repeat,
      });
    }
  }
  return out.sort(compareOcc);
}

function replaceEvent(data, id, fn) {
  return { ...data, events: data.events.flatMap((e) => (e.id === id ? fn(e) : [e])) };
}

/**
 * Apply a patch to an occurrence.
 * scope: 'single' (not repeating), 'this' (split one occurrence out), 'all' (whole series).
 */
export function updateOccurrence(data, occ, patch, scope, idGen = () => crypto.randomUUID()) {
  const master = data.events.find((e) => e.id === occ.eventId);
  if (!master) return data;

  if (!master.repeat || scope === 'single') {
    return replaceEvent(data, master.id, (e) => [makeEvent({ ...e, ...patch })]);
  }

  if (scope === 'this') {
    const single = makeEvent({
      ...master,
      start: dtKey(occ.start),
      end: dtKey(occ.end),
      ...patch,
      id: idGen(),
      repeat: null,
      exdates: [],
      completed: master.completed.includes(occ.key) ? [patch.start || dtKey(occ.start)] : [],
      seriesId: master.id,
    });
    const next = replaceEvent(data, master.id, (e) => [makeEvent({ ...e, exdates: [...e.exdates, occ.key] })]);
    return { ...next, events: [...next.events, single] };
  }

  // scope === 'all'
  return replaceEvent(data, master.id, (e) => {
    const merged = { ...e, ...patch };
    if (patch.start !== undefined || patch.end !== undefined) {
      const newStart = parse(patch.start ?? dtKey(occ.start));
      const newEnd = parse(patch.end ?? dtKey(occ.end));
      const delta = diffMinutes(occ.start, newStart);
      const dur = diffMinutes(newStart, newEnd);
      const ms = addMinutes(parse(e.start), delta);
      merged.start = dtKey(ms);
      merged.end = dtKey(addMinutes(ms, dur));
      merged.exdates = e.exdates.map((x) => dtKey(addMinutes(parse(x), delta)));
      const shift = ((diffDays(occ.start, newStart) % 7) + 7) % 7;
      const rep = patch.repeat !== undefined ? patch.repeat : e.repeat;
      if (rep && rep.byDay && rep.byDay.length && shift) {
        merged.repeat = { ...rep, byDay: rep.byDay.map((d) => (d + shift) % 7).sort((a, b) => a - b) };
      }
    }
    return [makeEvent(merged)];
  });
}

/** Delete an occurrence. scope: 'single', 'this' (one occurrence), 'future' (this and later). */
export function deleteOccurrence(data, occ, scope) {
  const master = data.events.find((e) => e.id === occ.eventId);
  if (!master) return data;
  if (!master.repeat || scope === 'single') return replaceEvent(data, master.id, () => []);
  if (scope === 'this') {
    return replaceEvent(data, master.id, (e) => [makeEvent({ ...e, exdates: [...e.exdates, occ.key] })]);
  }
  if (occ.key <= master.start) return replaceEvent(data, master.id, () => []);
  return replaceEvent(data, master.id, (e) => {
    const { count, ...rest } = e.repeat;
    return [
      makeEvent({
        ...e,
        repeat: { ...rest, endType: 'until', until: dateKey(addDays(parse(occ.key), -1)) },
        exdates: e.exdates.filter((x) => x < occ.key),
      }),
    ];
  });
}

export function eventsForCalendarDelete(data, calendarId) {
  return {
    ...data,
    calendars: data.calendars.filter((c) => c.id !== calendarId),
    events: data.events.filter((e) => e.calendarId !== calendarId),
  };
}

/** Text search over all calendars (hidden ones included). Upcoming first, then past (most recent first). */
export function search(data, q, now = new Date()) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const cals = new Map(data.calendars.map((c) => [c.id, c]));
  const upcoming = [];
  const past = [];
  for (const ev of data.events) {
    const cal = cals.get(ev.calendarId);
    if (!cal) continue;
    const hay = `${ev.title}\n${ev.location}\n${ev.notes}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    const next = nextOccurrence(ev, now);
    if (next) {
      upcoming.push({ event: ev, calendar: cal, ...next });
      continue;
    }
    let last = { start: parse(ev.start), end: parse(ev.end), key: ev.start };
    if (ev.repeat) {
      const all = expand(ev, parse(ev.start), now);
      if (all.length) last = all[all.length - 1];
    }
    past.push({ event: ev, calendar: cal, ...last });
  }
  upcoming.sort((a, b) => a.start - b.start);
  past.sort((a, b) => b.start - a.start);
  return [...upcoming, ...past];
}

/** Occurrence for a given event and original start key (used to restore selection). */
export function findOccurrence(data, eventId, key) {
  const ev = data.events.find((e) => e.id === eventId);
  if (!ev) return null;
  const s = parse(key);
  const found = occurrences({ calendars: data.calendars, events: [ev] }, startOfDay(s), addDays(startOfDay(s), 1), { includeHidden: true });
  return found.find((o) => o.key === key) || found[0] || null;
}
