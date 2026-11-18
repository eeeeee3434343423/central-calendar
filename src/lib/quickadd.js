// Quick Add: turn "Focus 4pm 15m" or "Dentist fri 3-4pm" into an event range.
import { addDays, addMinutes, startOfDay, sameDay, nextHalfHour, daysInMonth } from './dates.js';

const MER = '(am|pm|a|p)';
const NUM_TIME = '(\\d{1,2})(?::(\\d{2}))?';
const END = '(?=\\s)';
const START = '(?:^|\\s)';
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

/** 1–6 without am/pm means afternoon; 7–11 morning; 0 and 13–23 are 24-hour times. */
function guessHour(h) {
  if (h >= 1 && h <= 6) return h + 12;
  return h;
}

function withMer(h, mer) {
  if (!mer) return null;
  const pm = mer.toLowerCase().startsWith('p');
  if (h < 1 || h > 12) return null;
  return pm ? (h % 12) + 12 : h % 12;
}

function makeDate(y, m, d) {
  if (m < 0 || m > 11 || d < 1 || d > daysInMonth(y, m)) return null;
  return new Date(y, m, d);
}

/**
 * parseQuickAdd(text, { now, base, defaultDuration, dateOrder })
 * Returns { title, allDay, start: Date, end: Date } or null for empty input.
 */
export function parseQuickAdd(raw, { now = new Date(), base = now, defaultDuration = 30, dateOrder = 'MDY' } = {}) {
  let s = ` ${String(raw ?? '').replace(/\s+/g, ' ').trim()} `;
  if (!s.trim()) return null;
  const today = startOfDay(now);
  const take = (re) => {
    const m = re.exec(s);
    if (!m) return null;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    return m;
  };

  // ---- date
  let date = null;
  let m;
  if ((m = take(new RegExp(`${START}(today|tonight)${END}`, 'i')))) date = today;
  else if ((m = take(new RegExp(`${START}(tomorrow|tmrw|tmr)${END}`, 'i')))) date = addDays(today, 1);
  else if ((m = take(new RegExp(`${START}(?:on\\s+)?(next\\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|r|rs|rsday|urday)?${END}`, 'i')))) {
    const wd = WEEKDAYS[m[2].toLowerCase()];
    date = addDays(today, (wd - today.getDay() + 7) % 7 + (m[1] ? 7 : 0));
  } else if ((m = take(new RegExp(`${START}(?:on\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`, 'i')))) {
    date = resolveDate(MONTHS.indexOf(m[1].toLowerCase()), +m[2], m[3] ? +m[3] : null, today);
  } else if ((m = take(new RegExp(`${START}(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:\\s+(\\d{4}))?${END}`, 'i')))) {
    date = resolveDate(MONTHS.indexOf(m[2].toLowerCase()), +m[1], m[3] ? +m[3] : null, today);
  } else if ((m = take(new RegExp(`${START}(?:on\\s+)?(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?${END}`, 'i')))) {
    const [a, b] = dateOrder === 'DMY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    date = resolveDate(a - 1, b, y, today);
  }
  const day = date || startOfDay(base);

  // ---- time range
  let startMin = null;
  let endMin = null;
  if ((m = take(new RegExp(`${START}(?:from\\s+)?${NUM_TIME}\\s*${MER}?\\s*(?:-|–|—|to|until|till)\\s*${NUM_TIME}\\s*${MER}?${END}`, 'i')))) {
    const [, h1, m1, mer1, h2, m2, mer2] = m;
    if (m1 || m2 || mer1 || mer2) {
      const mi1 = m1 ? +m1 : 0;
      const mi2 = m2 ? +m2 : 0;
      let e = withMer(+h2, mer2);
      if (e === null) e = +h2 <= 23 ? guessHour(+h2) : null;
      let st = withMer(+h1, mer1);
      if (st === null && mer2) {
        st = withMer(+h1, mer2);
        if (st !== null && st * 60 + mi1 >= e * 60 + mi2) st = withMer(+h1, mer2.toLowerCase().startsWith('p') ? 'am' : 'pm');
      }
      if (st === null) st = +h1 <= 23 ? guessHour(+h1) : null;
      if (st !== null && e !== null) {
        startMin = st * 60 + mi1;
        endMin = e * 60 + mi2;
        if (endMin <= startMin && endMin + 720 > startMin && e < 12) endMin += 720;
        if (endMin <= startMin) endMin = null;
      }
    } else {
      s = ` ${m[0]} ${s}`; // not a time after all ("pages 10-20"): put it back
    }
  }

  // ---- duration
  let duration = null;
  if ((m = take(new RegExp(`${START}(?:for\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:h|hr|hrs|hour|hours)(?:\\s*(\\d+)\\s*(?:m|min|mins|minute|minutes))?${END}`, 'i')))) {
    duration = Math.round(parseFloat(m[1]) * 60) + (m[2] ? +m[2] : 0);
  } else if ((m = take(new RegExp(`${START}(?:for\\s+)?(\\d+)\\s*(?:m|min|mins|minute|minutes)${END}`, 'i')))) {
    duration = +m[1];
  }

  // ---- single time
  if (startMin === null) {
    if ((m = take(new RegExp(`${START}(?:at\\s+|@\\s*)?${NUM_TIME}\\s*${MER}${END}`, 'i')))) {
      const hh = withMer(+m[1], m[3]);
      if (hh !== null) startMin = hh * 60 + (m[2] ? +m[2] : 0);
    } else if ((m = take(new RegExp(`${START}(?:at\\s+|@\\s*)?(\\d{1,2}):(\\d{2})${END}`, 'i')))) {
      if (+m[1] <= 23 && +m[2] <= 59) startMin = guessHour(+m[1]) * 60 + +m[2];
    } else if ((m = take(new RegExp(`${START}(?:at|@)\\s*(\\d{1,2})${END}`, 'i')))) {
      if (+m[1] <= 23) startMin = guessHour(+m[1]) * 60;
    } else if ((m = take(new RegExp(`${START}(?:at\\s+)?(noon|midday|midnight)${END}`, 'i')))) {
      startMin = m[1].toLowerCase() === 'midnight' ? 0 : 720;
    }
  }

  // ---- title
  let title = s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:at|on|for|from|@)\s+)+/i, '')
    .replace(/(?:\s+(?:at|on|for|from|@))+$/i, '')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();
  if (!title) title = 'New Event';

  // ---- assemble
  if (startMin === null && duration === null) {
    return { title, allDay: true, start: day, end: addDays(day, 1) };
  }
  let start;
  if (startMin === null) {
    start = sameDay(day, now) ? nextHalfHour(now) : addMinutes(day, 9 * 60);
  } else {
    start = addMinutes(day, startMin);
  }
  let end;
  if (endMin !== null) end = addMinutes(day, endMin);
  else end = addMinutes(start, duration ?? defaultDuration);
  return { title, allDay: false, start, end };
}

function resolveDate(month, d, year, today) {
  if (month < 0) return null;
  if (year) return makeDate(year, month, d);
  const thisYear = makeDate(today.getFullYear(), month, d);
  if (thisYear && thisYear >= today) return thisYear;
  return makeDate(today.getFullYear() + 1, month, d);
}
