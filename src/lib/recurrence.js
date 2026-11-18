// Repeat rules and expansion into concrete occurrences.
// rule = { freq: 'daily'|'weekly'|'monthly'|'yearly', interval: n, byDay?: [0..6],
//          endType?: 'never'|'count'|'until', count?: n, until?: 'YYYY-MM-DD' }
import { parse, dtKey, addDays, addMinutes, diffDays, diffMinutes, startOfWeek, startOfDay, WEEKDAYS_SHORT, MONTHS_SHORT } from './dates.js';

const UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

/** All starts for one period index, ascending. Some may fall before the series start. */
function periodStarts(rule, start, anchor, i) {
  const n = Math.max(1, rule.interval || 1);
  const h = start.getHours();
  const mi = start.getMinutes();
  switch (rule.freq) {
    case 'daily':
      return [addDays(start, i * n)];
    case 'weekly': {
      const days = rule.byDay && rule.byDay.length ? [...new Set(rule.byDay)].sort((a, b) => a - b) : [start.getDay()];
      const weekBase = addDays(anchor, i * n * 7);
      return days.map((wd) => {
        const d = addDays(weekBase, wd);
        d.setHours(h, mi, 0, 0);
        return d;
      });
    }
    case 'monthly': {
      const day = start.getDate();
      const d = new Date(start.getFullYear(), start.getMonth() + i * n, day, h, mi);
      return d.getDate() === day ? [d] : [];
    }
    case 'yearly': {
      const d = new Date(start.getFullYear() + i * n, start.getMonth(), start.getDate(), h, mi);
      return d.getMonth() === start.getMonth() ? [d] : [];
    }
    default:
      return [];
  }
}

/** First period index worth generating for a range (only used when COUNT doesn't need a full walk). */
function firstPeriod(rule, start, anchor, rangeStart, durDays) {
  const n = Math.max(1, rule.interval || 1);
  let back;
  switch (rule.freq) {
    case 'daily':
      back = Math.floor((diffDays(start, rangeStart) - durDays - 1) / n);
      break;
    case 'weekly':
      back = Math.floor((diffDays(anchor, rangeStart) - durDays - 7) / (7 * n));
      break;
    case 'monthly': {
      const months = (rangeStart.getFullYear() - start.getFullYear()) * 12 + (rangeStart.getMonth() - start.getMonth());
      back = Math.floor((months - Math.ceil(durDays / 28) - 1) / n);
      break;
    }
    case 'yearly':
      back = Math.floor((rangeStart.getFullYear() - start.getFullYear() - Math.ceil(durDays / 365) - 1) / n);
      break;
    default:
      back = 0;
  }
  return Math.max(0, back);
}

/**
 * Expand an event into occurrences overlapping [rangeStart, rangeEnd).
 * Returns [{ start: Date, end: Date, key: 'YYYY-MM-DDTHH:mm' }] where key is the original start.
 */
export function expand(ev, rangeStart, rangeEnd, maxIter = 20000) {
  const start = parse(ev.start);
  const end = parse(ev.end);
  const dur = Math.max(0, diffMinutes(start, end));
  const out = [];
  const overlaps = (s, e) => s < rangeEnd && (e > rangeStart || (dur === 0 && s >= rangeStart));

  const rule = ev.repeat;
  if (!rule || !UNIT[rule.freq]) {
    if (overlaps(start, end)) out.push({ start, end, key: dtKey(start) });
    return out;
  }

  const ex = new Set(ev.exdates || []);
  const countLimit = rule.endType === 'count' ? Math.max(1, rule.count || 1) : Infinity;
  const untilLimit = rule.endType === 'until' && rule.until ? addDays(startOfDay(parse(rule.until)), 1) : null;
  const anchor = startOfWeek(start, 0);
  const durDays = Math.ceil(dur / 1440);
  let i = countLimit === Infinity ? firstPeriod(rule, start, anchor, rangeStart, durDays) : 0;
  let count = 0;

  for (let iter = 0; iter < maxIter; iter++, i++) {
    for (const s of periodStarts(rule, start, anchor, i)) {
      if (s < start) continue;
      if (untilLimit && s >= untilLimit) return out;
      if (count >= countLimit) return out;
      count++;
      if (s >= rangeEnd) return out;
      const key = dtKey(s);
      if (ex.has(key)) continue;
      const e = addMinutes(s, dur);
      if (overlaps(s, e)) out.push({ start: s, end: e, key });
    }
  }
  return out;
}

/** The first occurrence that hasn't ended by `after`, or null. */
export function nextOccurrence(ev, after) {
  if (!ev.repeat) {
    const s = parse(ev.start);
    const e = parse(ev.end);
    return e > after || (+s === +e && s >= after) ? { start: s, end: e, key: dtKey(s) } : null;
  }
  let from = after;
  for (let k = 0; k < 30; k++) {
    const to = addDays(from, 366);
    const found = expand(ev, from, to);
    if (found.length) return found[0];
    from = to;
  }
  return null;
}

export function presetOf(rule) {
  if (!rule) return 'never';
  if ((rule.interval || 1) === 1 && !(rule.byDay && rule.byDay.length)) return rule.freq;
  return 'custom';
}

export function describe(rule) {
  if (!rule) return 'Never';
  const n = rule.interval || 1;
  const unit = UNIT[rule.freq];
  let text;
  if (rule.freq === 'weekly' && rule.byDay && rule.byDay.length) {
    const days = [...rule.byDay].sort((a, b) => a - b).map((d) => WEEKDAYS_SHORT[d]).join(', ');
    text = `Every ${n > 1 ? n + ' weeks' : 'week'} on ${days}`;
  } else if (n === 1) {
    text = `Every ${unit[0].toUpperCase()}${unit.slice(1)}`;
  } else {
    text = `Every ${n} ${unit}s`;
  }
  if (rule.endType === 'count' && rule.count) text += `, ${rule.count} time${rule.count === 1 ? '' : 's'}`;
  if (rule.endType === 'until' && rule.until) {
    const u = parse(rule.until);
    text += `, until ${MONTHS_SHORT[u.getMonth()]} ${u.getDate()}, ${u.getFullYear()}`;
  }
  return text;
}
