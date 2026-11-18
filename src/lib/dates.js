// Pure date helpers. Everything works in the browser's local time.
// Stored values are "floating" local strings: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = WEEKDAYS.map((w) => w.slice(0, 3));
export const WEEKDAYS_INITIAL = WEEKDAYS.map((w) => w[0]);
export const MINUTES_PER_DAY = 1440;

export const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dtKey(d) {
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parse(s) {
  if (s instanceof Date) return new Date(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s));
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

export const isValid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMinutes(d, n) {
  // Wall-clock arithmetic so that DST changes don't shift times by an hour.
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + n);
  return x;
}

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

export function addMonths(d, n) {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const target = new Date(y, m, 1, d.getHours(), d.getMinutes());
  target.setDate(Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth())));
  return target;
}

export function startOfWeek(d, weekStart = 0) {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() - weekStart + 7) % 7));
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function diffDays(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** Wall-clock minutes from a to b (DST-neutral). */
export function diffMinutes(a, b) {
  return diffDays(a, b) * MINUTES_PER_DAY + (minutesOfDay(b) - minutesOfDay(a));
}

export function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

export function atMinutes(day, minutes) {
  const x = startOfDay(day);
  x.setMinutes(minutes);
  return x;
}

export function snap(min, step = 5) {
  return Math.round(min / step) * step;
}

export function monthGrid(cursor, weekStart = 0) {
  const first = startOfMonth(cursor);
  const start = startOfWeek(first, weekStart);
  const offset = diffDays(start, first);
  const weeks = Math.ceil((offset + daysInMonth(first.getFullYear(), first.getMonth())) / 7);
  return { start, weeks };
}

function weekStartFor(cursor, prefs, today) {
  if (prefs.startWithToday) {
    const n = prefs.daysPerWeek || 7;
    const k = Math.floor(diffDays(today, cursor) / n);
    return addDays(startOfDay(today), k * n);
  }
  return startOfWeek(cursor, prefs.weekStart || 0);
}

/** The visible range for a view: { start, end (exclusive), days }. */
export function viewRange(view, cursor, prefs = {}, today = new Date()) {
  const c = startOfDay(cursor);
  if (view === 'day') return { start: c, end: addDays(c, 1), days: 1 };
  if (view === 'week') {
    const start = weekStartFor(c, prefs, startOfDay(today));
    const days = prefs.daysPerWeek || 7;
    return { start, end: addDays(start, days), days };
  }
  if (view === 'month') {
    const { start, weeks } = monthGrid(c, prefs.weekStart || 0);
    return { start, end: addDays(start, weeks * 7), days: weeks * 7, weeks };
  }
  const start = new Date(c.getFullYear(), 0, 1);
  const end = new Date(c.getFullYear() + 1, 0, 1);
  return { start, end, days: diffDays(start, end) };
}

export function stepCursor(view, cursor, dir, prefs = {}) {
  if (view === 'day') return addDays(cursor, dir);
  if (view === 'week') return addDays(cursor, dir * (prefs.startWithToday ? prefs.daysPerWeek || 7 : 7));
  if (view === 'month') return addMonths(cursor, dir);
  return addMonths(cursor, dir * 12);
}

export function formatTime(d, use24 = false) {
  const h = d.getHours();
  const m = d.getMinutes();
  if (use24) return `${pad(h)}:${pad(m)}`;
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Compact time for tight places: "9 AM", "9:30 AM", "14:00". */
export function formatTimeCompact(d, use24 = false) {
  if (use24) return formatTime(d, true);
  const m = d.getMinutes();
  const h = d.getHours();
  return `${h % 12 || 12}${m ? ':' + pad(m) : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function hourLabel(h, use24 = false) {
  if (use24) return `${pad(h)}:00`;
  if (h === 12) return 'Noon';
  if (h === 0 || h === 24) return 'Midnight';
  return `${h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDate(d, order = 'MDY', sep = '/') {
  const parts = { Y: String(d.getFullYear()), M: pad(d.getMonth() + 1), D: pad(d.getDate()) };
  return order.split('').map((k) => parts[k]).join(sep);
}

export function formatLongDate(d) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Parse what a person types into a time field. Returns minutes after midnight, or null. */
export function parseTimeInput(raw) {
  const s = String(raw).trim().toLowerCase().replace(/\./g, '');
  if (!s) return null;
  if (s === 'noon') return 720;
  if (s === 'midnight') return 0;
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const mer = m[3];
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer.startsWith('a')) h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

export function nextHalfHour(now) {
  const base = startOfDay(now);
  const mins = Math.ceil((minutesOfDay(now) + 1) / 30) * 30;
  return addMinutes(base, mins);
}

export function isWeekend(d) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

/** 15 → "15 min", 90 → "1 hr 30 min", 2940 → "2 days 1 hr". */
export function formatDuration(min) {
  const m = Math.max(0, Math.round(min));
  if (m >= 1440) {
    const days = Math.floor(m / 1440);
    const hrs = Math.floor((m % 1440) / 60);
    return `${days} day${days === 1 ? '' : 's'}${hrs ? ` ${hrs} hr` : ''}`;
  }
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** "in 25 min", "2 days ago", "now". Days are counted once the gap passes 24 hours. */
export function formatRelative(target, now = new Date()) {
  const diff = Math.round((target - now) / 60000);
  if (Math.abs(diff) < 1) return 'now';
  const abs = Math.abs(diff);
  // Under 3 days keep the hours ("1 day 13 hr"); after that, whole days are enough.
  const text = abs >= 3 * 1440 ? `${Math.round(abs / 1440)} days` : formatDuration(abs >= 1440 ? Math.floor(abs / 60) * 60 : abs);
  return diff > 0 ? `in ${text}` : `${text} ago`;
}
