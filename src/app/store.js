// App state, persistence (localStorage), undo, and change notification.
import { dtKey, dateKey, addDays, startOfDay, startOfWeek, parse } from '../lib/dates.js';
import { makeEvent } from '../lib/model.js';
import { stamp, SYNCED_PREFS } from '../lib/sync.js';

const KEY = 'central-calendar.v1';
export const PALETTE = ['#ff2d55', '#ff9500', '#ffcc00', '#65db39', '#34aadc', '#cc73e1', '#a2845e'];

export const DEFAULT_PREFS = {
  theme: 'system',
  view: 'week',
  daysPerWeek: 7,
  weekStart: 0,
  startWithToday: false,
  hoursDisplayed: 12,
  timeFormat: '12',
  dateOrder: 'MDY',
  dateSep: '/',
  defaultCalendar: 'selected',
  defaultAlert: null,
  defaultDuration: 15,
  snapMinutes: 15,
  openEventsIn: 'view',
  contrast: 'standard',
  dayPanelCollapsed: false,
  sidebarCollapsed: false,
  selectedCalendarId: null,
  desktopNotifications: false,
  prefsVersion: 2,
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function seed() {
  const today = startOfDay(new Date());
  const monday = addDays(startOfWeek(today, 0), 1);
  const at = (d, h, m = 0) => {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return dtKey(x);
  };
  const calendars = [
    { id: uid(), name: 'Personal', color: '#34aadc', visible: true },
    { id: uid(), name: 'Work', color: '#ff2d55', visible: true },
    { id: uid(), name: 'Family', color: '#65db39', visible: true },
  ];
  const [personal, work, family] = calendars.map((c) => c.id);
  const sat = addDays(startOfWeek(today, 0), 6);
  const events = [
    makeEvent({ id: uid(), calendarId: work, title: 'Team standup', location: 'Video call', start: at(monday, 9, 30), end: at(monday, 9, 45), repeat: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], endType: 'never' } }),
    makeEvent({ id: uid(), calendarId: work, title: 'Project review', location: 'Room 4B', start: at(today, 14), end: at(today, 15), alerts: [15] }),
    makeEvent({ id: uid(), calendarId: personal, title: 'Lunch with Sam', location: 'Corner Bistro', start: at(addDays(today, 1), 12, 30), end: at(addDays(today, 1), 13, 30) }),
    makeEvent({ id: uid(), calendarId: personal, title: 'Gym', start: at(addDays(monday, 1), 18), end: at(addDays(monday, 1), 19), repeat: { freq: 'weekly', interval: 1, byDay: [2, 4], endType: 'never' } }),
    makeEvent({ id: uid(), calendarId: family, title: 'Weekend away', allDay: true, start: dtKey(sat), end: dtKey(addDays(sat, 2)) }),
    makeEvent({ id: uid(), calendarId: family, title: "Mom's birthday", allDay: true, start: dtKey(addDays(today, 9)), end: dtKey(addDays(today, 10)), repeat: { freq: 'yearly', interval: 1, endType: 'never' }, alerts: [900] }),
  ];
  return { calendars, events };
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function initialState() {
  const saved = loadPersisted();
  const data = saved?.data && Array.isArray(saved.data.calendars) ? saved.data : seed();
  data.events = data.events.map(makeEvent);
  data.tombstones = data.tombstones || [];
  const prefs = { ...DEFAULT_PREFS, ...(saved?.prefs || {}) };
  // v2: 15-minute time blocking defaults for people upgrading from v1.
  if ((saved?.prefs?.prefsVersion || 1) < 2) Object.assign(prefs, { defaultDuration: 15, snapMinutes: 15, prefsVersion: 2 });
  if (!data.calendars.some((c) => c.id === prefs.selectedCalendarId)) prefs.selectedCalendarId = data.calendars[0]?.id ?? null;
  return {
    data,
    prefs,
    inbox: saved?.inbox || [],
    fired: saved?.fired || {},
    sync: saved?.sync || { ownerId: null, version: 0, lastSyncedAt: 0 },
    prefsUpdatedAt: saved?.prefsUpdatedAt || 0,
    seedUntouched: saved ? !!saved.seedUntouched : true,
    ui: {
      view: prefs.view,
      cursor: startOfDay(new Date()),
      selection: [],
      sidebar: 'calendars',
      search: '',
      drawer: false,
      draft: null,
      editingCalendar: null,
      inspectorOpen: false,
    },
  };
}

const listeners = new Set();
const changeListeners = new Set();
const emitChange = () => {
  for (const fn of changeListeners) fn();
};
const undoStack = [];
let state = initialState();
let pending = false;
let saveError = null;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, data: state.data, prefs: state.prefs, inbox: state.inbox, fired: state.fired, sync: state.sync, prefsUpdatedAt: state.prefsUpdatedAt, seedUntouched: state.seedUntouched }));
    saveError = null;
  } catch (e) {
    saveError = e;
  }
}

function notify() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    for (const fn of listeners) fn(state);
  });
}

export const store = {
  get: () => state,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Replace calendar data. Undoable unless { undoable: false }. */
  commit(mutator, { label = 'Change', undoable = true } = {}) {
    const before = state.data;
    const changed = mutator(before);
    if (changed === before) return false;
    if (undoable) {
      undoStack.push({ data: before, label });
      if (undoStack.length > 50) undoStack.shift();
    }
    state = { ...state, data: stamp(before, changed, Date.now()), seedUntouched: false };
    persist();
    notify();
    emitChange();
    return true;
  },
  canUndo: () => undoStack.length > 0,
  undo() {
    const last = undoStack.pop();
    if (!last) return null;
    // Undo is a new change: restored items get fresh timestamps so they win when syncing.
    state = { ...state, data: stamp(state.data, { ...last.data, tombstones: state.data.tombstones }, Date.now()), ui: { ...state.ui, selection: [] } };
    persist();
    notify();
    emitChange();
    return last.label;
  },
  setUI(patch) {
    state = { ...state, ui: { ...state.ui, ...patch } };
    if (patch.view) {
      state.prefs = { ...state.prefs, view: patch.view };
      persist();
    }
    notify();
  },
  setPrefs(patch) {
    const synced = Object.keys(patch).some((k) => SYNCED_PREFS.includes(k) && patch[k] !== state.prefs[k]);
    state = { ...state, prefs: { ...state.prefs, ...patch }, ...(synced ? { prefsUpdatedAt: Date.now() } : {}) };
    persist();
    notify();
    if (synced) emitChange();
  },
  /** Called by the sync engine with a merged copy. Not undoable, not re-stamped. */
  applyRemote(doc, { replaceUndo = true } = {}) {
    const data = { calendars: doc.calendars, events: doc.events.map(makeEvent), tombstones: doc.tombstones || [] };
    let prefs = state.prefs;
    let prefsUpdatedAt = state.prefsUpdatedAt;
    if (doc.prefs && (doc.prefsUpdatedAt || 0) > state.prefsUpdatedAt) {
      prefs = { ...prefs, ...doc.prefs };
      prefsUpdatedAt = doc.prefsUpdatedAt;
    }
    if (!data.calendars.some((c) => c.id === prefs.selectedCalendarId)) prefs = { ...prefs, selectedCalendarId: data.calendars[0]?.id ?? null };
    if (replaceUndo) undoStack.length = 0;
    state = { ...state, data, prefs, prefsUpdatedAt, seedUntouched: false };
    persist();
    notify();
  },
  setSync(patch) {
    state = { ...state, sync: { ...state.sync, ...patch } };
    persist();
  },
  onChange(fn) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  },
  setInbox(inbox) {
    state = { ...state, inbox };
    persist();
    notify();
  },
  markFired(key) {
    state = { ...state, fired: { ...state.fired, [key]: Date.now() } };
    // keep the fired map small
    const keys = Object.keys(state.fired);
    if (keys.length > 500) {
      const cutoff = Date.now() - 30 * 86400000;
      state.fired = Object.fromEntries(Object.entries(state.fired).filter(([, t]) => t > cutoff));
    }
    persist();
  },
  replaceAll(data, prefs) {
    undoStack.length = 0;
    const next = { calendars: data.calendars, events: data.events.map(makeEvent), tombstones: state.data.tombstones || [] };
    state = { ...state, data: stamp(state.data, next, Date.now()), prefs: { ...state.prefs, ...(prefs || {}) }, ui: { ...state.ui, selection: [] }, seedUntouched: false };
    if (prefs) state.prefsUpdatedAt = Date.now();
    if (!state.data.calendars.some((c) => c.id === state.prefs.selectedCalendarId)) state.prefs.selectedCalendarId = state.data.calendars[0]?.id ?? null;
    persist();
    notify();
    emitChange();
  },
  saveError: () => saveError,
  reloadFromStorage() {
    const saved = loadPersisted();
    if (!saved?.data) return;
    state = { ...state, data: { calendars: saved.data.calendars, events: saved.data.events.map(makeEvent), tombstones: saved.data.tombstones || [] }, prefs: { ...state.prefs, ...saved.prefs }, inbox: saved.inbox || [], fired: saved.fired || {}, sync: saved.sync || state.sync, prefsUpdatedAt: saved.prefsUpdatedAt || 0 };
    notify();
  },
  key: KEY,
};

/** The calendar new events should go to. */
export function targetCalendarId(s = state) {
  const { prefs, data } = s;
  if (prefs.defaultCalendar !== 'selected' && data.calendars.some((c) => c.id === prefs.defaultCalendar)) return prefs.defaultCalendar;
  return data.calendars.some((c) => c.id === prefs.selectedCalendarId) ? prefs.selectedCalendarId : data.calendars[0]?.id;
}

export function nextCalendarColor(s = state) {
  const used = new Set(s.data.calendars.map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[s.data.calendars.length % PALETTE.length];
}

export function cursorKey(s = state) {
  return dateKey(s.ui.cursor);
}

export { parse };
