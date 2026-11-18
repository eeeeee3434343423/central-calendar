// User-level actions shared by views, sidebar, header and keyboard.
import { store, uid, targetCalendarId } from './store.js';
import { parse, dtKey, dateKey, addDays, addMinutes, startOfDay, nextHalfHour, stepCursor, viewRange, diffMinutes, formatLongDate } from '../lib/dates.js';
import { occurrences, updateOccurrence, deleteOccurrence, makeEvent, findOccurrence, toggleDone as toggleDoneData, isDone } from '../lib/model.js';
import { openPopover, alertDialog, toast, closeAllPopovers } from '../ui/overlays.js';
import { eventForm } from '../ui/editor.js';
import { eventCard } from '../ui/eventcard.js';
import { parseQuickAdd } from '../lib/quickadd.js';

// ---------- navigation
export function setView(view) {
  const s = store.get();
  if (view === s.ui.view) return;
  store.setUI({ view, draft: null });
}

export function step(dir) {
  const s = store.get();
  store.setUI({ cursor: stepCursor(s.ui.view, s.ui.cursor, dir, s.prefs), draft: null });
}

export function goToday() {
  store.setUI({ cursor: startOfDay(new Date()), draft: null, scrollReq: { now: true, t: Date.now() } });
}

export function goToDate(d, view) {
  store.setUI({ cursor: startOfDay(d), ...(view ? { view } : {}), draft: null });
}

export function currentRange(s = store.get()) {
  return viewRange(s.ui.view, s.ui.cursor, s.prefs, new Date());
}

export function visibleOccurrences(s = store.get()) {
  const r = currentRange(s);
  return occurrences(s.data, r.start, r.end);
}

// ---------- selection
export function select(oids, { additive = false } = {}) {
  const s = store.get();
  const next = additive ? [...new Set([...s.ui.selection, ...oids])] : oids;
  if (next.join() === s.ui.selection.join()) return;
  store.setUI({ selection: next });
}

export function clearSelection() {
  if (store.get().ui.selection.length) store.setUI({ selection: [] });
}

export function selectedOccurrences(s = store.get()) {
  return s.ui.selection
    .map((oid) => {
      const [eventId, key] = oid.split('|');
      return findOccurrence(s.data, eventId, key);
    })
    .filter(Boolean);
}

/** Move the selection to the previous/next visible event (arrow keys). */
export function moveSelection(dir, extend = false) {
  const s = store.get();
  const list = visibleOccurrences(s);
  if (!list.length) return;
  const cur = s.ui.selection[s.ui.selection.length - 1];
  let i = list.findIndex((o) => o.oid === cur);
  i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir));
  select(extend ? [...s.ui.selection.filter((x) => x !== list[i].oid), list[i].oid] : [list[i].oid]);
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-oid="${CSS.escape(list[i].oid)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      el.focus({ preventScroll: true });
    }
  });
}

export function selectAllVisible() {
  select(visibleOccurrences().map((o) => o.oid));
}

// ---------- create / edit
export function defaultNewRange(day, s = store.get()) {
  const now = new Date();
  let start;
  if (day && dateKey(day) !== dateKey(now)) {
    start = new Date(day);
    start.setHours(9, 0, 0, 0);
  } else start = nextHalfHour(now);
  return { start: dtKey(start), end: dtKey(addMinutes(start, s.prefs.defaultDuration || 60)) };
}

function defaultAlerts(allDay, s = store.get()) {
  const a = s.prefs.defaultAlert;
  if (a === null || a === undefined || allDay) return [];
  return [a];
}

/** Open the Add Event popover for a draft range. anchor: element or rect. */
export function openAdd({ start, end, allDay = false }, anchor, { side = 'auto' } = {}) {
  const s = store.get();
  const calendarId = targetCalendarId(s);
  if (!calendarId) {
    toast('Create a calendar first.');
    return;
  }
  const draft = { start, end, allDay, calendarId, title: 'New Event' };
  store.setUI({ draft, selection: [] });
  const ev = makeEvent({ id: 'draft', calendarId, start, end, allDay, alerts: defaultAlerts(allDay, s) });
  let pop;
  const form = eventForm({
    mode: 'add',
    event: ev,
    calendars: s.data.calendars,
    prefs: s.prefs,
    onCancel: () => pop.close('cancel'),
    onSubmit: (vals) => {
      const id = uid();
      store.commit((d) => ({ ...d, events: [...d.events, makeEvent({ ...vals, id })] }), { label: 'Add event' });
      pop.close('submit');
      const key = vals.start;
      store.setUI({ selection: [`${id}|${key}`] });
      ensureVisible(parse(vals.start));
    },
  });
  // Anchor at the draft block once it has rendered, if no explicit anchor.
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      const target = anchor || document.querySelector('[data-oid="draft"]') || document.querySelector('.hdr-add');
      pop = openPopover({
        anchor: target,
        content: form,
        side: anchor && anchor.classList && anchor.classList.contains('hdr-add') ? 'below' : side,
        className: 'editor-pop',
        label: 'Add Event',
        onClose: () => {
          if (store.get().ui.draft === draft) store.setUI({ draft: null });
        },
      });
      form.focusTitle();
    });
  });
}

/** Open an event the way Settings › Events says: the View card (default) or the editor. */
export function openEvent(occ, anchor) {
  if (store.get().prefs.openEventsIn === 'edit') openEdit(occ, anchor);
  else openView(occ, anchor);
}

function anchorFor(occ, anchor) {
  const target = (anchor && anchor.isConnected ? anchor : null) || document.querySelector(`[data-oid="${CSS.escape(occ.oid)}"]`) || document.querySelector('.view-body');
  if (target.dataset && target.dataset.oid) target.scrollIntoView({ block: 'nearest' });
  return target;
}

/** Read-only View card in a popover, with Edit / Delete / Mark Done. */
export function openView(occ, anchor) {
  select([occ.oid]);
  let pop;
  let current = occ;
  const build = () =>
    eventCard({
      occ: current,
      prefs: store.get().prefs,
      onEdit: () => {
        const a = pop.anchorEl;
        pop.close('edit');
        openEdit(current, a);
      },
      onDelete: async () => {
        pop.close('delete');
        await deleteFlow(current);
      },
      onToggleDone: () => {
        toggleDone(current);
        current = findOccurrence(store.get().data, current.eventId, current.key) || current;
        pop.el.querySelector('.pop-content').replaceChildren(build());
      },
    });
  requestAnimationFrame(() => {
    const card = build();
    pop = openPopover({ anchor: anchorFor(occ, anchor), content: card, className: 'view-pop', label: `${occ.event.title} details` });
    pop.el.querySelector('.ec-footer .btn-primary')?.focus({ preventScroll: true });
  });
}

/** Mark one occurrence done / not done (no repeating-event prompt). */
export function toggleDone(occ) {
  const was = isDone(occ);
  store.commit((d) => toggleDoneData(d, occ), { label: was ? 'Mark not done' : 'Mark done' });
}

/** Create one event from a Quick Add line. Returns the created event's range, or null. */
export function quickAdd(text, base) {
  const s = store.get();
  const calendarId = targetCalendarId(s);
  if (!calendarId) return null;
  const r = parseQuickAdd(text, { now: new Date(), base: base || new Date(), defaultDuration: s.prefs.defaultDuration || 15, dateOrder: s.prefs.dateOrder });
  if (!r) return null;
  const id = uid();
  const start = dtKey(r.start);
  store.commit((d) => ({ ...d, events: [...d.events, makeEvent({ id, calendarId, title: r.title, allDay: r.allDay, start, end: dtKey(r.end), alerts: r.allDay ? [] : defaultAlerts(false, s) })] }), { label: 'Quick add' });
  return { ...r, id, key: start };
}

/** Open the Edit Event popover for an occurrence. */
export function openEdit(occ, anchor) {
  const s = store.get();
  select([occ.oid]);
  let pop;
  const eventLike = { ...occ.event, start: dtKey(occ.start), end: dtKey(occ.end) };
  const form = eventForm({
    mode: 'edit',
    event: eventLike,
    calendars: s.data.calendars,
    prefs: s.prefs,
    onCancel: () => pop.close('cancel'),
    onDelete: async () => {
      pop.close('delete');
      await deleteFlow(occ);
    },
    onSubmit: async (vals) => {
      const ok = await saveFlow(occ, vals);
      if (ok) pop.close('submit');
    },
  });
  requestAnimationFrame(() => {
    pop = openPopover({ anchor: anchorFor(occ, anchor), content: form, className: 'editor-pop', label: 'Edit Event' });
    form.focusTitle();
  });
}

/** Only the fields that changed compared with the occurrence. */
function diffPatch(occ, vals) {
  const before = { ...occ.event, start: dtKey(occ.start), end: dtKey(occ.end) };
  const patch = {};
  for (const k of Object.keys(vals)) if (stable(vals[k]) !== stable(before[k] ?? (Array.isArray(vals[k]) ? [] : before[k]))) patch[k] = vals[k];
  return patch;
}

/** JSON with sorted keys and undefined dropped, so key order never reads as a change. */
function stable(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
    .join(',')}}`;
}

async function askScope(kind) {
  if (kind === 'change') {
    return alertDialog({
      title: 'Change repeating event?',
      body: 'You’re changing a repeating event. Do you want to change only this occurrence, or all events in the series?',
      buttons: [
        { label: 'Only This Event', value: 'this', primary: true },
        { label: 'All Events', value: 'all' },
        { label: 'Cancel', value: null },
      ],
      iconName: 'repeat',
    });
  }
  return alertDialog({
    title: 'Delete repeating event?',
    body: 'Do you want to delete only this occurrence, or this and all future occurrences?',
    buttons: [
      { label: 'Only This Event', value: 'this', primary: true },
      { label: 'All Future Events', value: 'future', destructive: true },
      { label: 'Cancel', value: null },
    ],
    iconName: 'repeat',
  });
}

/** Save editor values for an occurrence. Returns false if cancelled. */
export async function saveFlow(occ, vals) {
  const patch = diffPatch(occ, vals);
  if (!Object.keys(patch).length) return true;
  let scope = 'single';
  if (occ.recurring) {
    // Changing the repeat rule itself always applies to the series.
    scope = 'repeat' in patch ? 'all' : await askScope('change');
    if (!scope) return false;
  }
  let newId = null;
  store.commit((d) => updateOccurrence(d, occ, patch, scope, () => (newId = uid())), { label: 'Edit event' });
  const eventId = newId || occ.eventId;
  const key = scope === 'this' || scope === 'single' ? patch.start || dtKey(occ.start) : null;
  if (key) store.setUI({ selection: [`${eventId}|${key}`] });
  else clearSelection();
  return true;
}

/** Move/resize: new absolute start/end for the occurrence. Returns false if cancelled. */
export async function moveFlow(occ, newStart, newEnd) {
  const patch = { start: dtKey(newStart), end: dtKey(newEnd) };
  if (patch.start === dtKey(occ.start) && patch.end === dtKey(occ.end)) return false;
  let scope = 'single';
  if (occ.recurring) {
    scope = await askScope('change');
    if (!scope) {
      store.setUI({}); // re-render to snap back
      return false;
    }
  }
  let newId = null;
  store.commit((d) => updateOccurrence(d, occ, patch, scope, () => (newId = uid())), { label: 'Move event' });
  if (scope === 'all') {
    const delta = diffMinutes(occ.start, newStart);
    const masterStart = addMinutes(parse(occ.key), delta);
    store.setUI({ selection: [`${occ.eventId}|${dtKey(masterStart)}`] });
  } else store.setUI({ selection: [`${newId || occ.eventId}|${patch.start}`] });
  return true;
}

/** Delete with the repeating prompt and an Undo toast. */
export async function deleteFlow(occ) {
  let scope = 'single';
  if (occ.recurring) {
    scope = await askScope('delete');
    if (!scope) return false;
  }
  store.commit((d) => deleteOccurrence(d, occ, scope), { label: 'Delete event' });
  store.setUI({ selection: store.get().ui.selection.filter((x) => x !== occ.oid) });
  toast(`“${occ.event.title}” deleted`, { action: 'Undo', onAction: undo });
  return true;
}

export async function deleteSelected() {
  const occs = selectedOccurrences();
  if (!occs.length) return;
  if (occs.length === 1) return deleteFlow(occs[0]);
  const repeating = occs.some((o) => o.recurring);
  let scope = 'this';
  if (repeating) {
    scope = await askScope('delete');
    if (!scope) return;
  }
  store.commit((d) => occs.reduce((acc, o) => deleteOccurrence(acc, o, o.recurring ? scope : 'single'), d), { label: 'Delete events' });
  store.setUI({ selection: [] });
  toast(`${occs.length} events deleted`, { action: 'Undo', onAction: undo });
}

export function undo() {
  closeAllPopovers();
  const label = store.undo();
  if (label) toast(`Undid: ${label}`);
}

/** Navigate so a date is visible, keeping the current view. */
export function ensureVisible(date) {
  const s = store.get();
  const r = currentRange(s);
  if (date < r.start || date >= r.end) store.setUI({ cursor: startOfDay(date) });
}

export function revealOccurrence(eventId, key) {
  const d = parse(key);
  const s = store.get();
  const occ = findOccurrence(s.data, eventId, key);
  const cal = s.data.calendars.find((c) => c.id === occ?.event.calendarId);
  if (cal && !cal.visible) {
    store.commit((data) => ({ ...data, calendars: data.calendars.map((c) => (c.id === cal.id ? { ...c, visible: true } : c)) }), { undoable: false });
  }
  store.setUI({ cursor: startOfDay(d), selection: [`${eventId}|${key}`], scrollReq: { min: d.getHours() * 60 + d.getMinutes(), t: Date.now() } });
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-oid="${CSS.escape(eventId + '|' + key)}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  });
}

/** New event from the toolbar + / N key. */
export function newEventFromToolbar(anchor) {
  const s = store.get();
  const r = defaultNewRange(s.ui.view === 'day' || s.ui.view === 'week' ? s.ui.cursor : null, s);
  if (!anchor && (s.ui.view === 'day' || s.ui.view === 'week')) {
    ensureVisible(parse(r.start));
    store.setUI({ scrollReq: { min: parse(r.start).getHours() * 60, t: Date.now() } });
    openAdd(r, null);
    return;
  }
  openAdd(r, anchor || document.querySelector('.hdr-add'), { side: 'below' });
}

export function describeDay(d) {
  return formatLongDate(d);
}

export { addDays, dateKey };
