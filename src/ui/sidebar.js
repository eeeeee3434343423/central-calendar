// Sidebar: calendar list (show/hide, select target, create, rename, recolor, delete), inbox, search results.
import { h, icon, iconButton, onColor } from './dom.js';
import { store, uid, nextCalendarColor, PALETTE } from '../app/store.js';
import * as A from '../app/actions.js';
import { openMenu, openPopover, alertDialog, toast } from './overlays.js';
import { eventsForCalendarDelete, search } from '../lib/model.js';
import { formatTime, formatLongDate, sameDay, addDays, MONTHS_SHORT, WEEKDAYS_SHORT } from '../lib/dates.js';
import { openSettings, importICSFlow, exportICS } from './settings.js';
import { openGoToDate, openShortcuts } from './dialogs.js';

let editRow = null;

export function openActionsMenu(anchor) {
  const s = store.get();
  openMenu(
    anchor,
    [
      { label: 'Settings', icon: 'gear', hint: '', onSelect: () => openSettings() },
      'divider',
      { label: 'Go to Date…', icon: 'calendarSearch', onSelect: () => goToDateDialog() },
      { label: 'Keyboard Shortcuts', icon: 'keyboard', onSelect: () => openShortcuts() },
      'divider',
      { label: 'Import .ics…', icon: 'upload', onSelect: () => importICSFlow() },
      { label: 'Export .ics', icon: 'download', onSelect: () => exportICS() },
      'divider',
      { label: s.ui.selection.length > 1 ? 'Delete Events' : 'Delete Event', icon: 'minusCircle', destructive: true, disabled: !s.ui.selection.length, onSelect: () => A.deleteSelected() },
    ],
    { label: 'Actions' },
  );
}

export function goToDateDialog() {
  const s = store.get();
  openGoToDate({ initial: s.ui.cursor, today: new Date(), weekStart: s.prefs.weekStart, onGo: (d) => A.goToDate(d) });
}

export function renderSidebar(host, s) {
  const unread = s.inbox.filter((n) => !n.read).length;
  const mode = s.ui.search.trim() ? 'search' : s.ui.sidebar;
  const head = h(
    'div.sb-head',
    h(
      'div.sb-toggles',
      iconButton('calendarGrid', 'Show calendars', () => store.setUI({ sidebar: 'calendars', search: s.ui.search && '' }), { cls: 'toggle', pressed: mode === 'calendars' }),
      h(
        'span.badge-wrap',
        iconButton('inbox', unread ? `Show inbox, ${unread} new` : 'Show inbox', () => openInbox(), { cls: 'toggle', pressed: mode === 'inbox' }),
        unread ? h('span.badge', { 'aria-hidden': 'true' }, String(unread)) : null,
      ),
    ),
    iconButton('moreCircle', 'Open actions menu', (e) => openActionsMenu(e.currentTarget), { cls: 'red', size: 18 }),
  );
  const body = h('div.sb-body');
  if (mode === 'search') body.append(searchResults(s));
  else if (mode === 'inbox') body.append(inboxPanel(s));
  else body.append(calendarList(s));
  host.replaceChildren(head, body);
}

export function openInbox() {
  const s = store.get();
  store.setUI({ sidebar: 'inbox', search: '', drawer: true });
  if (s.inbox.some((n) => !n.read)) setTimeout(() => store.setInbox(store.get().inbox.map((n) => ({ ...n, read: true }))), 1500);
}

// ---------------------------------------------------------------- calendars
function calendarList(s) {
  const frag = h('div.cal-section');
  frag.append(
    h(
      'div.sb-section-head',
      h('h2.sb-title', 'Calendars'),
      h('button.btn-icon.add-cal', { type: 'button', 'aria-label': 'Add a new calendar', title: 'Add a new calendar', on: { click: addCalendar } }, icon('plusCircle', 18)),
    ),
    h('div.sb-rule'),
  );
  const ul = h('ul.cal-list', { 'aria-label': 'Calendars' });
  for (const cal of s.data.calendars) ul.append(s.ui.editingCalendar === cal.id ? editRowFor(cal) : calRow(cal, s));
  if (!s.data.calendars.length) ul.append(h('li.cal-empty', 'No calendars. Use + to add one.'));
  frag.append(ul);
  return frag;
}

function calRow(cal, s) {
  const isTarget = s.prefs.selectedCalendarId === cal.id;
  const count = s.data.events.filter((e) => e.calendarId === cal.id).length;
  const cb = h('input.cb-input', {
    type: 'checkbox',
    checked: cal.visible,
    'aria-label': `Show ${cal.name}`,
    on: { change: (e) => setCalendar(cal.id, { visible: e.target.checked }, false) },
  });
  const row = h(
    'li.cal-row',
    { class: isTarget ? 'selected' : null, style: { '--cb': cal.color, '--on-cb': onColor(cal.color) } },
    h('label.checkbox.cal-cb', cb, h('span.cb-box', icon('check', 12))),
    h(
      'button.cal-name',
      {
        type: 'button',
        title: isTarget ? `${cal.name}: new events go here` : `Make ${cal.name} the calendar for new events`,
        'aria-pressed': String(isTarget),
        on: { click: () => store.setPrefs({ selectedCalendarId: cal.id }), dblclick: () => store.setUI({ editingCalendar: cal.id }) },
      },
      cal.name,
    ),
    h('span.cal-count', { 'aria-label': `${count} events` }, count ? String(count) : ''),
    h(
      'div.cal-trailing',
      h(
        'button.btn-icon.red.cal-more',
        {
          type: 'button',
          'aria-label': `${cal.name} actions`,
          title: 'Calendar actions',
          on: {
            click: (e) => {
              const li = e.currentTarget.closest('.cal-row');
              li.classList.add('menu-open');
              openMenu(
                e.currentTarget,
                [
                  { label: 'Edit Calendar', icon: 'pencil', onSelect: () => store.setUI({ editingCalendar: cal.id }) },
                  { label: cal.visible ? 'Hide Calendar' : 'Show Calendar', icon: 'calendar', onSelect: () => setCalendar(cal.id, { visible: !cal.visible }, false) },
                  { label: 'Show Only This Calendar', icon: 'layers', onSelect: () => showOnly(cal.id) },
                  'divider',
                  { label: 'Delete Calendar', icon: 'minusCircle', destructive: true, onSelect: () => deleteCalendar(cal) },
                ],
                { label: `${cal.name} actions`, onClose: () => li.classList.remove('menu-open') },
              );
            },
          },
        },
        icon('moreCircle', 16),
      ),
    ),
  );
  return row;
}

function editRowFor(cal) {
  if (editRow && editRow.id === cal.id && editRow.el.isConnected) return editRow.el;
  const input = h('input.text-field.cal-edit-input', { type: 'text', value: cal.name, 'aria-label': 'Calendar name', maxlength: 80 });
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    editRow = null;
    if (name && name !== cal.name) setCalendar(cal.id, { name }, true, 'Rename calendar');
    store.setUI({ editingCalendar: null });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      done = true;
      editRow = null;
      store.setUI({ editingCalendar: null });
    }
  });
  input.addEventListener('blur', () => {
    // keep editing while the color popover is open
    setTimeout(() => {
      if (!document.querySelector('.color-pop') && !done) commit();
    }, 120);
  });
  const colorBtn = h(
    'button.color-btn',
    { type: 'button', 'aria-label': 'Calendar color', title: 'Change color', style: { '--cb': cal.color }, on: { click: (e) => openColorPicker(e.currentTarget, cal, () => input.focus()) } },
    h('span.color-dot'),
  );
  const del = h('button.btn-icon.red', { type: 'button', 'aria-label': 'Delete calendar', title: 'Delete calendar', on: { click: () => { done = true; editRow = null; store.setUI({ editingCalendar: null }); deleteCalendar(cal); } } }, icon('minusCircleFill', 18));
  const el = h('li.cal-row.editing', colorBtn, input, del);
  editRow = { id: cal.id, el };
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return el;
}

function openColorPicker(anchor, cal, refocus) {
  const current = store.get().data.calendars.find((c) => c.id === cal.id)?.color || cal.color;
  let pop;
  const pick = (color) => {
    setCalendar(cal.id, { color }, true, 'Change calendar color');
    anchor.style.setProperty('--cb', color);
    pop.el.querySelectorAll('.swatch').forEach((sw) => sw.classList.toggle('on', sw.dataset.color === color));
  };
  const well = h('input.color-well-input', { type: 'color', value: current, 'aria-label': 'Custom color', on: { input: (e) => pick(e.target.value) } });
  const content = h(
    'div.color-picker',
    h('div.cp-caption', 'Color'),
    h(
      'div.cp-row',
      PALETTE.map((c) => h('button.swatch', { type: 'button', class: c === current ? 'on' : null, dataset: { color: c }, style: { '--sw': c }, 'aria-label': `Color ${c}`, on: { click: () => pick(c) } })),
      h('label.color-well', { title: 'Custom color' }, well),
    ),
  );
  pop = openPopover({ anchor, content, side: 'below', className: 'color-pop', label: 'Calendar color', onClose: () => refocus && refocus() });
}

function setCalendar(id, patch, undoable = true, label = 'Edit calendar') {
  store.commit((d) => ({ ...d, calendars: d.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), { undoable, label });
}

function showOnly(id) {
  store.commit((d) => ({ ...d, calendars: d.calendars.map((c) => ({ ...c, visible: c.id === id })) }), { undoable: false });
}

function addCalendar() {
  const s = store.get();
  const names = new Set(s.data.calendars.map((c) => c.name));
  let n = 1;
  while (names.has(`Untitled ${n}`)) n++;
  const cal = { id: uid(), name: `Untitled ${n}`, color: nextCalendarColor(s), visible: true };
  store.commit((d) => ({ ...d, calendars: [...d.calendars, cal] }), { label: 'Add calendar' });
  store.setPrefs({ selectedCalendarId: cal.id });
  store.setUI({ editingCalendar: cal.id, sidebar: 'calendars', search: '' });
}

async function deleteCalendar(cal) {
  const n = store.get().data.events.filter((e) => e.calendarId === cal.id).length;
  const choice = await alertDialog({
    title: `Delete calendar “${cal.name}”?`,
    body: n ? `This deletes the calendar and all ${n} of its event${n === 1 ? '' : 's'}.` : 'This calendar has no events.',
    buttons: [
      { label: 'Cancel', value: null, primary: true },
      { label: 'Delete Calendar', value: 'delete', destructive: true },
    ],
  });
  if (choice !== 'delete') return;
  store.commit((d) => eventsForCalendarDelete(d, cal.id), { label: 'Delete calendar' });
  const s = store.get();
  if (s.prefs.selectedCalendarId === cal.id) store.setPrefs({ selectedCalendarId: s.data.calendars[0]?.id ?? null });
  store.setUI({ selection: [] });
  toast(`Calendar “${cal.name}” deleted`, { action: 'Undo', onAction: () => A.undo() });
}

// ---------------------------------------------------------------- inbox
function relDay(d) {
  const t = new Date();
  if (sameDay(d, t)) return 'Today';
  if (sameDay(d, addDays(t, 1))) return 'Tomorrow';
  if (sameDay(d, addDays(t, -1))) return 'Yesterday';
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function inboxPanel(s) {
  const use24 = s.prefs.timeFormat === '24';
  const list = [...s.inbox].sort((a, b) => b.firedAt - a.firedAt);
  const wrap = h('div.inbox');
  wrap.append(
    h('div.sb-section-head', h('h2.sb-title', 'Inbox'), list.length ? h('button.link-btn', { type: 'button', on: { click: () => store.setInbox([]) } }, 'Clear All') : null),
    h('p.inbox-count', `${list.length} Notification${list.length === 1 ? '' : 's'}`),
  );
  if (!list.length) {
    wrap.append(h('p.inbox-empty', 'Alerts for your events show up here.'));
    return wrap;
  }
  const ul = h('ul.inbox-list');
  for (const n of list) {
    const start = new Date(n.start);
    ul.append(
      h(
        'li.inbox-item',
        { class: n.read ? null : 'unread', style: { '--c': n.color } },
        h(
          'button.inbox-main',
          { type: 'button', on: { click: () => A.revealOccurrence(n.eventId, n.key) } },
          h('span.chip-dot'),
          h('span.inbox-text', h('span.inbox-title', n.title), h('span.inbox-when', n.allDay ? `${relDay(start)} · All day` : `${relDay(start)} · ${formatTime(start, use24)}`)),
        ),
        h('button.btn-icon.inbox-x', { type: 'button', 'aria-label': `Dismiss ${n.title}`, title: 'Dismiss', on: { click: () => store.setInbox(store.get().inbox.filter((x) => x.id !== n.id)) } }, icon('x', 14)),
      ),
    );
  }
  wrap.append(ul);
  return wrap;
}

// ---------------------------------------------------------------- search
function searchResults(s) {
  const use24 = s.prefs.timeFormat === '24';
  const results = search(s.data, s.ui.search, new Date()).slice(0, 200);
  const wrap = h('div.search-results');
  wrap.append(h('div.sb-section-head', h('h2.sb-title', 'Results'), h('span.result-count', { 'aria-live': 'polite' }, results.length ? `${results.length}` : '')), h('div.sb-rule'));
  if (!results.length) {
    wrap.append(h('p.no-results', 'No Results'));
    return wrap;
  }
  const ul = h('ul.result-list', { 'aria-label': 'Search results' });
  for (const r of results) {
    const past = r.end < new Date();
    ul.append(
      h(
        'li',
        h(
          'button.result-row',
          { type: 'button', class: past ? 'past' : null, style: { '--c': r.calendar.color }, on: { click: () => { A.revealOccurrence(r.event.id, r.key); store.setUI({ drawer: false }); } } },
          h('span.chip-dot'),
          h(
            'span.result-text',
            h('span.result-title', highlight(r.event.title, s.ui.search)),
            h('span.result-when', `${formatLongDate(r.start)}${r.event.allDay ? '' : ' · ' + formatTime(r.start, use24)}${r.event.repeat ? ' · repeats' : ''}`),
          ),
        ),
      ),
    );
  }
  wrap.append(ul);
  return wrap;
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return text;
  const n = q.trim().length;
  return [text.slice(0, i), h('mark', text.slice(i, i + n)), text.slice(i + n)];
}
