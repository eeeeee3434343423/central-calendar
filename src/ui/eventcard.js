// Read-only event view: what, when, how long, deadline, details. Edit is one click away.
import { h, icon, calVars } from './dom.js';
import { formatTime, formatDuration, formatRelative, diffMinutes, sameDay, addDays, parse, WEEKDAYS, MONTHS, MONTHS_SHORT } from '../lib/dates.js';
import { describe } from '../lib/recurrence.js';
import { isDone } from '../lib/model.js';
import { TIMED_ALERTS, ALLDAY_ALERTS } from './editor.js';

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/g;

function longDay(d) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function shortDay(d) {
  const today = new Date();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, addDays(today, 1))) return 'Tomorrow';
  if (sameDay(d, addDays(today, -1))) return 'Yesterday';
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** Status line for an occurrence: countdown, in progress, or how long ago it ended. */
export function occStatus(occ, now = new Date()) {
  if (isDone(occ)) return { text: 'Done', tone: 'done' };
  if (occ.allDay) {
    const lastDay = addDays(occ.end, -1);
    if (now >= occ.start && now < occ.end) return { text: 'Today', tone: 'now' };
    if (now < occ.start) return { text: `Starts ${formatRelative(occ.start, now)}`, tone: 'soon' };
    return { text: `Ended ${formatRelative(lastDay < occ.start ? occ.start : occ.end, now)}`, tone: 'past' };
  }
  if (now < occ.start) return { text: `Starts ${formatRelative(occ.start, now)}`, tone: diffMinutes(now, occ.start) <= 60 ? 'soon' : 'later' };
  if (now < occ.end) return { text: `Happening now · ends ${formatRelative(occ.end, now)}`, tone: 'now' };
  return { text: `Ended ${formatRelative(occ.end, now)}`, tone: 'past' };
}

function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function alertLabel(minutes, allDay) {
  const list = allDay ? ALLDAY_ALERTS : TIMED_ALERTS;
  return list.find((a) => a.value === minutes)?.label || `${minutes} minutes before`;
}

/**
 * eventCard({ occ, prefs, inline, onEdit, onDelete, onToggleDone, onClose })
 */
export function eventCard({ occ, prefs, inline = false, onEdit, onDelete, onToggleDone }) {
  const use24 = prefs.timeFormat === '24';
  const ev = occ.event;
  const now = new Date();
  const done = isDone(occ);
  const rows = [];
  const row = (iconName, label, ...content) => h('div.ec-row', h('span.ec-icon', { title: label, 'aria-hidden': 'true' }, icon(iconName, 16)), h('div.ec-text', h('span.ec-label', label), ...content));

  // When
  let whenMain;
  let whenSub;
  if (occ.allDay) {
    const last = addDays(occ.end, -1);
    whenMain = sameDay(occ.start, last) || last < occ.start ? longDay(occ.start) : `${longDay(occ.start)} – ${longDay(last)}`;
    whenSub = 'All day';
  } else {
    whenMain = sameDay(occ.start, occ.end) ? longDay(occ.start) : `${shortDay(occ.start)} – ${shortDay(occ.end)}`;
    whenSub = `${formatTime(occ.start, use24)} – ${formatTime(occ.end, use24)} · ${formatDuration(diffMinutes(occ.start, occ.end))}`;
  }
  const st = occStatus(occ, now);
  rows.push(row('clock', 'Time', h('div.ec-main', whenMain), h('div.ec-sub', whenSub), h(`span.ec-pill.${st.tone}`, st.text)));

  // Deadline
  if (ev.deadline) {
    const due = parse(ev.deadline);
    const overdue = due < now && !done;
    rows.push(
      row(
        'flag',
        'Deadline',
        h('div.ec-main', `Due ${shortDay(due)} at ${formatTime(due, use24)}`),
        h(`span.ec-pill.${done ? 'done' : overdue ? 'overdue' : diffMinutes(now, due) <= 1440 ? 'soon' : 'later'}`, done ? 'Done' : overdue ? `Overdue by ${formatRelative(due, now).replace(' ago', '')}` : `Due ${formatRelative(due, now)}`),
      ),
    );
  }

  if (ev.location) rows.push(row('pin', 'Location', h('div.ec-main.wrap', linkify(ev.location))));
  if (ev.repeat) rows.push(row('repeat', 'Repeats', h('div.ec-main', describe(ev.repeat))));
  if (ev.alerts && ev.alerts.length) rows.push(row('bell', 'Alerts', h('div.ec-main', ev.alerts.map((a) => alertLabel(a, ev.allDay)).join(', '))));
  if (ev.invitees && ev.invitees.length) rows.push(row('people', 'Invitees', h('div.ec-main.wrap', ev.invitees.join(', '))));
  if (ev.url) rows.push(row('link', 'Link', h('a.ec-link', { href: /^https?:\/\//i.test(ev.url) ? ev.url : `https://${ev.url}`, target: '_blank', rel: 'noopener noreferrer' }, ev.url)));
  rows.push(row('note', 'Details', ev.notes ? h('div.ec-notes', linkify(ev.notes)) : h('div.ec-empty', 'No details yet. Use Edit to add notes.')));

  const doneBtn = h(
    'button.ec-done',
    { type: 'button', 'aria-pressed': String(done), title: done ? 'Mark as not done' : 'Mark as done', on: { click: () => onToggleDone && onToggleDone() } },
    icon(done ? 'checkCircleFill' : 'checkCircle', 20),
    h('span', done ? 'Done' : 'Mark Done'),
  );

  const card = h(
    `div.event-card${inline ? '.inline' : ''}`,
    { style: calVars(occ.calendar.color), class: done ? 'is-done' : null, role: 'group', 'aria-label': `${ev.title} details` },
    h(
      'div.ec-head',
      h('span.ec-bar', { 'aria-hidden': 'true' }),
      h('div.ec-titles', h('h3.ec-title', ev.title), h('div.ec-cal', h('span.chip-dot'), occ.calendar.name, occ.recurring ? h('span.ec-tag', 'Repeating') : null)),
    ),
    h('div.ec-body', rows),
    h(
      'div.ec-footer',
      doneBtn,
      h('span.ec-spacer'),
      onDelete ? h('button.btn.btn-secondary.destructive', { type: 'button', on: { click: () => onDelete() } }, 'Delete') : null,
      h('button.btn.btn-primary', { type: 'button', on: { click: () => onEdit && onEdit() } }, icon('pencil', 14), 'Edit'),
    ),
  );
  card.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E' || (e.key === 'Enter' && e.target === card)) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
      e.preventDefault();
      onEdit && onEdit();
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });
  card.tabIndex = -1;
  return card;
}
