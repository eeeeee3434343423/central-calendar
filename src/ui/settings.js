// Settings modal (Appearance, Formats, Events, Data) and import/export.
import { h, icon, downloadText, pickTextFile } from './dom.js';
import { store, uid, nextCalendarColor, DEFAULT_PREFS } from '../app/store.js';
import { openDialog, alertDialog, toast } from './overlays.js';
import { selectButton, checkbox } from './controls.js';
import { toICS, fromICS } from '../lib/ics.js';
import { makeEvent } from '../lib/model.js';
import { WEEKDAYS, dateKey } from '../lib/dates.js';
import { TIMED_ALERTS } from './editor.js';
import { requestDesktopNotifications, notificationStatus } from './alarms.js';
import { accountSettings } from './account.js';
import { onCloud } from '../app/cloud.js';

const TABS = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'formats', label: 'Formats', icon: 'globe' },
  { id: 'events', label: 'Events', icon: 'layers' },
  { id: 'account', label: 'Account & Sync', icon: 'cloud' },
  { id: 'data', label: 'Data', icon: 'database' },
];

export function openSettings(tab = 'appearance') {
  let current = tab;
  const nav = h('nav.settings-nav', { 'aria-label': 'Settings sections' });
  const header = h('h2.settings-header', { id: 'settings-title' });
  const content = h('div.settings-body');
  content.addEventListener('scroll', () => header.classList.toggle('scrolled', content.scrollTop > 2), { passive: true });

  const renderNav = () => {
    nav.replaceChildren(
      ...TABS.map((t) =>
        h(
          'button.settings-tab',
          { type: 'button', 'aria-current': t.id === current ? 'page' : null, class: t.id === current ? 'selected' : null, on: { click: () => { current = t.id; renderNav(); renderTab(); } } },
          icon(t.icon, 18),
          t.label,
        ),
      ),
    );
  };
  const renderTab = () => {
    const t = TABS.find((x) => x.id === current);
    header.textContent = t.label;
    content.replaceChildren(...TAB_RENDER[current](renderTab));
    content.scrollTop = 0;
  };
  renderNav();
  renderTab();
  const unsubStore = store.subscribe(() => {
    // keep the Data tab counts fresh
    if (current === 'data') renderTab();
  });
  const unsubCloud = onCloud(() => {
    if (current === 'account') renderTab();
  });
  const unsub = () => {
    unsubStore();
    unsubCloud();
  };
  openDialog({
    className: 'settings-dialog',
    labelledBy: 'settings-title',
    content: [nav, h('div.settings-main', header, content)],
    onClose: () => unsub(),
  });
}

const field = (label, control, hint) => h('div.set-field', h('div.set-label', label), control, hint ? h('p.set-hint', hint) : null);
const section = (title) => h('h3.set-section', title);
const prefs = () => store.get().prefs;
const set = (patch) => store.setPrefs(patch);

const TAB_RENDER = {
  account: (rerender) => accountSettings(rerender),
  appearance: () => [
    h(
      'div.set-check',
      checkbox({ checked: prefs().contrast === 'more', label: 'Increase Contrast', onChange: (v) => set({ contrast: v ? 'more' : 'standard' }) }),
    ),
    h('p.set-hint.after-check', 'Darker text, lines and labels. Helps in bright light or on dim screens.'),
    field(
      'Theme:',
      selectButton({
        options: [
          { value: 'system', label: 'Match System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
        value: prefs().theme,
        label: 'Theme',
        variant: 'settings',
        onChange: (v) => set({ theme: v }),
      }),
    ),
    field(
      'Days Per Week:',
      selectButton({ options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) })), value: prefs().daysPerWeek, label: 'Days per week', variant: 'settings', onChange: (v) => set({ daysPerWeek: Number(v) }) }),
    ),
    field('Start Week On:', selectButton({ options: WEEKDAYS.map((w, i) => ({ value: i, label: w })), value: prefs().weekStart, label: 'Start week on', variant: 'settings', onChange: (v) => set({ weekStart: Number(v) }) })),
    h('div.set-check', checkbox({ checked: prefs().startWithToday, label: 'Start Current Week with Today', onChange: (v) => set({ startWithToday: v }) })),
    field(
      'Number of Hours Displayed:',
      selectButton({ options: [6, 8, 10, 12, 14, 16, 18, 20, 24].map((n) => ({ value: n, label: String(n) })), value: prefs().hoursDisplayed, label: 'Hours displayed', variant: 'settings', onChange: (v) => set({ hoursDisplayed: Number(v) }) }),
      'How many hours fit in the Day and Week views without scrolling.',
    ),
  ],
  formats: () => [
    section('Date & Time Formats'),
    h(
      'div.set-grid',
      field(
        'Date Format:',
        selectButton({
          options: [
            { value: 'MDY', label: 'MM/DD/YYYY' },
            { value: 'DMY', label: 'DD/MM/YYYY' },
            { value: 'YMD', label: 'YYYY/MM/DD' },
          ],
          value: prefs().dateOrder,
          label: 'Date format',
          variant: 'settings',
          onChange: (v) => set({ dateOrder: v }),
        }),
      ),
      field(
        'Time Format:',
        selectButton({
          options: [
            { value: '12', label: '12 Hour' },
            { value: '24', label: '24 Hour' },
          ],
          value: prefs().timeFormat,
          label: 'Time format',
          variant: 'settings',
          onChange: (v) => set({ timeFormat: v }),
        }),
      ),
      field(
        'Date Separator:',
        selectButton({ options: ['/', '-', '.'].map((x) => ({ value: x, label: x })), value: prefs().dateSep, label: 'Date separator', variant: 'settings', onChange: (v) => set({ dateSep: v }) }),
      ),
    ),
    section('Time Zone'),
    h('p.set-text', `Times are shown in your device’s time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Events keep their clock time if you travel.`),
  ],
  events: (rerender) => {
    const s = store.get();
    const status = notificationStatus();
    return [
      section('Default Calendar'),
      field(
        'Add New Events to:',
        selectButton({
          options: [{ value: 'selected', label: 'Selected Calendar' }, ...s.data.calendars.map((c) => ({ value: c.id, label: c.name, color: c.color }))],
          value: s.prefs.defaultCalendar,
          label: 'Default calendar',
          variant: 'settings',
          onChange: (v) => set({ defaultCalendar: v }),
        }),
        '“Selected Calendar” is the one highlighted in the sidebar.',
      ),
      section('New Events'),
      field(
        'Default Alert:',
        selectButton({
          options: TIMED_ALERTS,
          value: s.prefs.defaultAlert === null || s.prefs.defaultAlert === undefined ? 'none' : s.prefs.defaultAlert,
          label: 'Default alert',
          variant: 'settings',
          onChange: (v) => set({ defaultAlert: v === 'none' ? null : Number(v) }),
        }),
      ),
      field(
        'Default Block Length:',
        selectButton({
          options: [15, 30, 45, 60, 90, 120].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours` })),
          value: s.prefs.defaultDuration,
          label: 'Default block length',
          variant: 'settings',
          onChange: (v) => set({ defaultDuration: Number(v) }),
        }),
        'Clicking an empty time, Quick Add and N create blocks this long.',
      ),
      field(
        'Time Grid Interval:',
        selectButton({
          options: [5, 10, 15, 30].map((m) => ({ value: m, label: `${m} minutes` })),
          value: s.prefs.snapMinutes || 15,
          label: 'Time grid interval',
          variant: 'settings',
          onChange: (v) => set({ snapMinutes: Number(v) }),
        }),
        'New, moved and resized events snap to this step.',
      ),
      field(
        'Open Events In:',
        selectButton({
          options: [
            { value: 'view', label: 'View (details first)' },
            { value: 'edit', label: 'Edit form' },
          ],
          value: s.prefs.openEventsIn || 'view',
          label: 'Open events in',
          variant: 'settings',
          onChange: (v) => set({ openEventsIn: v }),
        }),
        'Double-clicking an event shows this first. You can switch with the Edit button.',
      ),
      section('Alerts'),
      h(
        'div.set-field',
        h('div.set-label', 'Desktop Notifications:'),
        status === 'granted'
          ? h('p.set-text', 'On. Alerts also appear as system notifications while Central Calendar is open.')
          : status === 'denied'
            ? h('p.set-text', 'Blocked in your browser settings. Alerts still appear in the app and in the Inbox.')
            : status === 'unsupported'
              ? h('p.set-text', 'Not available in this browser. Alerts appear in the app and in the Inbox.')
              : h(
                  'div',
                  h('button.btn.btn-secondary', { type: 'button', on: { click: async () => { await requestDesktopNotifications(); rerender(); } } }, 'Turn On Desktop Notifications'),
                  h('p.set-hint', 'Alerts show in the app either way. This adds a system notification too.'),
                ),
      ),
    ];
  },
  data: () => {
    const s = store.get();
    return [
      h('p.set-text', `Your calendars live in this browser only (${s.data.calendars.length} calendar${s.data.calendars.length === 1 ? '' : 's'}, ${s.data.events.length} event${s.data.events.length === 1 ? '' : 's'}). Export a backup to keep a copy or move to another device.`),
      section('Calendar Files (.ics)'),
      h(
        'div.set-actions',
        h('button.btn.btn-secondary', { type: 'button', on: { click: exportICS } }, icon('download', 15), 'Export .ics'),
        h('button.btn.btn-secondary', { type: 'button', on: { click: importICSFlow } }, icon('upload', 15), 'Import .ics…'),
      ),
      h('p.set-hint', 'Import adds a new calendar named after the file. Works with exports from Google, Outlook and Apple calendars.'),
      section('Backup'),
      h(
        'div.set-actions',
        h('button.btn.btn-secondary', { type: 'button', on: { click: exportBackup } }, icon('download', 15), 'Download Backup'),
        h('button.btn.btn-secondary', { type: 'button', on: { click: restoreBackup } }, icon('upload', 15), 'Restore Backup…'),
      ),
      h('p.set-hint', 'A backup includes calendars, events and settings.'),
      section('Reset'),
      h('div.set-actions', h('button.btn.btn-secondary.destructive', { type: 'button', on: { click: eraseAll } }, 'Erase All Data…')),
    ];
  },
};

export function exportICS() {
  const s = store.get();
  downloadText(`central-calendar-${dateKey(new Date())}.ics`, toICS(s.data), 'text/calendar');
  toast(`Exported ${s.data.events.length} event${s.data.events.length === 1 ? '' : 's'}`);
}

export async function importICSFlow() {
  const file = await pickTextFile('.ics,text/calendar');
  if (!file) return;
  const calId = uid();
  let events;
  try {
    events = fromICS(file.text, { calendarId: calId, idGen: uid });
  } catch {
    events = [];
  }
  if (!events.length) {
    toast(`No events found in ${file.name}`);
    return;
  }
  const name = file.name.replace(/\.ics$/i, '').slice(0, 60) || 'Imported';
  store.commit((d) => ({ ...d, calendars: [...d.calendars, { id: calId, name, color: nextCalendarColor(store.get()), visible: true }], events: [...d.events, ...events] }), { label: 'Import calendar' });
  toast(`Imported ${events.length} event${events.length === 1 ? '' : 's'} into “${name}”`, { action: 'Undo', onAction: () => store.undo() });
}

function exportBackup() {
  const s = store.get();
  downloadText(`central-calendar-backup-${dateKey(new Date())}.json`, JSON.stringify({ app: 'central-calendar', version: 1, exportedAt: new Date().toISOString(), data: s.data, prefs: s.prefs }, null, 2), 'application/json');
}

async function restoreBackup() {
  const file = await pickTextFile('.json,application/json');
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    toast('That file isn’t a Central Calendar backup.');
    return;
  }
  const data = parsed?.data;
  if (!data || !Array.isArray(data.calendars) || !Array.isArray(data.events)) {
    toast('That file isn’t a Central Calendar backup.');
    return;
  }
  const ok = await alertDialog({
    title: 'Replace everything with this backup?',
    body: `The backup has ${data.calendars.length} calendars and ${data.events.length} events. Your current calendars and events will be replaced.`,
    buttons: [
      { label: 'Cancel', value: null, primary: true },
      { label: 'Replace', value: 'yes', destructive: true },
    ],
  });
  if (ok !== 'yes') return;
  const clean = {
    calendars: data.calendars.filter((c) => c && c.id && c.name).map((c) => ({ id: String(c.id), name: String(c.name), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#34aadc', visible: c.visible !== false })),
    events: data.events.filter((e) => e && e.id && e.start && e.end).map((e) => makeEvent(e)),
  };
  store.replaceAll(clean, parsed.prefs && typeof parsed.prefs === 'object' ? pickPrefs(parsed.prefs) : null);
  toast('Backup restored');
}

function pickPrefs(p) {
  return Object.fromEntries(Object.keys(DEFAULT_PREFS).filter((k) => k in p).map((k) => [k, p[k]]));
}

async function eraseAll() {
  const ok = await alertDialog({
    title: 'Erase all calendars and events?',
    body: 'Everything stored in this browser will be deleted. This can’t be undone. Download a backup first if you might want it back.',
    buttons: [
      { label: 'Cancel', value: null, primary: true },
      { label: 'Erase All Data', value: 'yes', destructive: true },
    ],
  });
  if (ok !== 'yes') return;
  store.replaceAll({ calendars: [{ id: uid(), name: 'Personal', color: '#34aadc', visible: true }], events: [] });
  store.setInbox([]);
  toast('All data erased');
}
