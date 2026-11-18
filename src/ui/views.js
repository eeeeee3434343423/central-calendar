// View dispatcher plus Day (panel + inspector), Month and Year views.
import { h, calVars, icon } from './dom.js';
import { store } from '../app/store.js';
import * as A from '../app/actions.js';
import { parse, dtKey, dateKey, addDays, sameDay, diffDays, isWeekend, WEEKDAYS_SHORT, MONTHS, formatTimeCompact, startOfDay, addMonths } from '../lib/dates.js';
import { occurrences, isDone } from '../lib/model.js';
import { layoutLanes } from '../lib/layout.js';
import { renderTimeGrid, draftOccurrence, occLabel, isDoubleTap } from './timegrid.js';
import { miniCal } from './minical.js';
import { startDayDrag } from './drag.js';
import { eventForm } from './editor.js';
import { eventCard } from './eventcard.js';

let inspectorCache = null;
let inspectorMode = { oid: null, mode: 'view' };
let panelMonth = null;

export function renderView(host, s) {
  const range = A.currentRange(s);
  host.replaceChildren();
  host.dataset.view = s.ui.view;
  if (s.ui.view === 'week') return renderTimeGrid(host, s, range, 'week');
  if (s.ui.view === 'day') return renderDay(host, s, range);
  if (s.ui.view === 'month') return renderMonth(host, s, range);
  return renderYear(host, s);
}

// ------------------------------------------------------------------ Day
function renderDay(host, s, range) {
  const collapsed = !!s.prefs.dayPanelCollapsed;
  const wrap = h('div.day-view', { class: collapsed ? 'panel-collapsed' : null });
  const left = h('div.day-left');
  if (collapsed) {
    // The panel folds into a thin strip; one click brings it back.
    const sel = A.selectedOccurrences(s);
    const rail = h(
      'aside.day-rail',
      { 'aria-label': 'Day details (hidden)' },
      h('button.rail-btn', { type: 'button', title: 'Show day panel (\\)', 'aria-label': 'Show day panel', on: { click: () => store.setPrefs({ dayPanelCollapsed: false }) } }, icon('chevronLeft', 16)),
      h('span.rail-label', { 'aria-hidden': 'true' }, sel.length === 1 ? sel[0].event.title : 'Day details'),
    );
    wrap.append(left, rail);
    host.append(wrap);
    return renderTimeGrid(left, s, range, 'day');
  }
  const panel = h('aside.day-panel', { 'aria-label': 'Day details' });
  wrap.append(left, panel);
  host.append(wrap);
  const tg = renderTimeGrid(left, s, range, 'day');
  panel.append(
    h(
      'div.panel-bar',
      h('button.btn-icon.panel-collapse', { type: 'button', title: 'Hide day panel (\\)', 'aria-label': 'Hide day panel', on: { click: () => store.setPrefs({ dayPanelCollapsed: true }) } }, icon('chevronRight', 16)),
    ),
  );

  // mini month (browsable independently of the cursor)
  const cursor = s.ui.cursor;
  if (!panelMonth || panelMonth.anchor !== dateKey(cursor)) panelMonth = { anchor: dateKey(cursor), shown: new Date(cursor.getFullYear(), cursor.getMonth(), 1) };
  const mcHost = h('div.day-mc');
  const drawMini = () => {
    const shown = panelMonth.shown;
    const r0 = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const r1 = new Date(shown.getFullYear(), shown.getMonth() + 1, 1);
    const days = new Set();
    for (const o of occurrences(s.data, r0, r1)) {
      for (let d = startOfDay(o.start); d < o.end || sameDay(d, o.start); d = addDays(d, 1)) {
        days.add(dateKey(d));
        if (d >= r1) break;
      }
    }
    mcHost.replaceChildren(
      miniCal({
        month: shown,
        selected: cursor,
        today: new Date(),
        weekStart: s.prefs.weekStart,
        eventDays: days,
        header: 'nav',
        onNav: (dir) => {
          panelMonth.shown = addMonths(panelMonth.shown, dir);
          drawMini();
        },
        onPick: (d) => A.goToDate(d),
      }),
    );
  };
  drawMini();
  panel.append(mcHost, h('div.panel-sep'));

  // inspector
  const sel = A.selectedOccurrences(s);
  const insp = h('div.inspector');
  if (sel.length === 1) {
    const occ = sel[0];
    if (inspectorMode.oid !== occ.oid) inspectorMode = { oid: occ.oid, mode: s.prefs.openEventsIn === 'edit' ? 'edit' : 'view' };
    const toView = () => {
      inspectorMode.mode = 'view';
      inspectorCache = null;
      store.setUI({});
    };
    if (inspectorMode.mode === 'edit') {
      let form;
      if (inspectorCache && inspectorCache.key === occ.oid && inspectorCache.event === occ.event) {
        form = inspectorCache.form;
      } else {
        form = eventForm({
          mode: 'edit',
          inline: true,
          event: { ...occ.event, start: dtKey(occ.start), end: dtKey(occ.end) },
          calendars: s.data.calendars,
          prefs: s.prefs,
          onCancel: toView,
          onDelete: () => A.deleteFlow(occ),
          onSubmit: async (vals) => {
            if (await A.saveFlow(occ, vals)) toView();
          },
        });
        inspectorCache = { key: occ.oid, event: occ.event, form };
      }
      insp.append(form);
    } else {
      inspectorCache = null;
      insp.append(
        eventCard({
          occ,
          prefs: s.prefs,
          inline: true,
          onEdit: () => {
            inspectorMode.mode = 'edit';
            store.setUI({});
            requestAnimationFrame(() => document.querySelector('.inspector .ef-title-input')?.focus());
          },
          onDelete: () => A.deleteFlow(occ),
          onToggleDone: () => A.toggleDone(occ),
        }),
      );
    }
  } else {
    inspectorCache = null;
    insp.append(h('p.inspector-empty', sel.length > 1 ? `${sel.length} Events Selected` : 'No Event Selected'));
  }
  panel.append(insp);
  return tg;
}

// ------------------------------------------------------------------ Month
function renderMonth(host, s, range) {
  const now = new Date();
  const use24 = s.prefs.timeFormat === '24';
  const cursor = s.ui.cursor;
  const weeks = range.weeks;
  const selected = new Set(s.ui.selection);
  const occs = occurrences(s.data, range.start, range.end);
  const draft = draftOccurrence(s);
  if (draft && draft.end > range.start && draft.start < range.end) occs.push(draft);
  const byOid = new Map(occs.map((o) => [o.oid, o]));

  const mv = h('div.mv', { style: { '--weeks': weeks } });
  const head = h('div.mv-head', { 'aria-hidden': 'true' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(range.start, i);
    head.append(h('div.mv-wd', { class: d.getDay() === now.getDay() ? 'today' : null }, WEEKDAYS_SHORT[d.getDay()]));
  }
  const weeksEl = h('div.mv-weeks', { role: 'grid', 'aria-label': `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}` });
  mv.append(head, weeksEl);
  const cellsAll = [];
  const weekEls = [];
  for (let w = 0; w < weeks; w++) {
    const wkStart = addDays(range.start, w * 7);
    const cells = h('div.mv-cells', { role: 'row' });
    for (let i = 0; i < 7; i++) {
      const d = addDays(wkStart, i);
      const isToday = sameDay(d, now);
      const cell = h(
        'div.mv-cell',
        {
          role: 'gridcell',
          dataset: { date: dateKey(d) },
          class: [isWeekend(d) ? 'weekend' : null, d.getMonth() !== cursor.getMonth() ? 'other' : null, isToday ? 'today' : null].filter(Boolean).join(' ') || null,
        },
        h(
          'div.mv-cell-head',
          h('button.mv-daynum', { type: 'button', 'aria-label': `${d.toDateString()}. Open in Day view`, 'aria-current': isToday ? 'date' : null, on: { click: (e) => { e.stopPropagation(); A.goToDate(d, 'day'); } } }, String(d.getDate())),
        ),
      );
      cells.append(cell);
      cellsAll.push(cell);
    }
    const events = h('div.mv-events');
    const week = h('div.mv-week', cells, events);
    weekEls.push({ week, events, wkStart });
    weeksEl.append(week);
  }
  host.append(mv);

  // Measure how many 20px rows fit under the date number.
  const weekH = weekEls[0].week.clientHeight;
  const maxLanes = Math.max(1, Math.floor((weekH - 38) / 20));

  for (const { events, wkStart } of weekEls) {
    const wkEnd = addDays(wkStart, 7);
    const items = occs
      .filter((o) => o.start < wkEnd && (o.end > wkStart || (+o.end === +o.start && o.start >= wkStart)))
      .map((o) => {
        const last = +o.end === +o.start ? o.start : new Date(+o.end - 1);
        return { id: o.oid, o, startCol: Math.max(0, diffDays(wkStart, o.start)), endCol: Math.min(6, diffDays(wkStart, last)) };
      });
    // Bars (all-day or multi-day) first, then timed chips in time order.
    items.sort((a, b) => (b.endCol - b.startCol > 0 || b.o.allDay) - (a.endCol - a.startCol > 0 || a.o.allDay) || a.startCol - b.startCol || a.o.start - b.o.start);
    const { lanes } = layoutLanes(items);
    const overflow = Array(7).fill(false);
    for (const it of items) if (lanes.get(it.id) >= maxLanes) for (let c = it.startCol; c <= it.endCol; c++) overflow[c] = true;
    const limit = (c) => (overflow[c] ? maxLanes - 1 : maxLanes);
    let changed = true;
    while (changed) {
      changed = false;
      for (const it of items) {
        const lane = lanes.get(it.id);
        let hidden = false;
        for (let c = it.startCol; c <= it.endCol; c++) if (lane >= limit(c)) hidden = true;
        if (hidden) for (let c = it.startCol; c <= it.endCol; c++) if (!overflow[c]) { overflow[c] = true; changed = true; }
      }
    }
    const hiddenCount = Array(7).fill(0);
    for (const it of items) {
      const lane = lanes.get(it.id);
      let hidden = false;
      for (let c = it.startCol; c <= it.endCol; c++) if (lane >= limit(c)) hidden = true;
      if (hidden) {
        for (let c = it.startCol; c <= it.endCol; c++) hiddenCount[c]++;
        continue;
      }
      events.append(monthChip(it, lane, selected, use24, wkStart));
    }
    hiddenCount.forEach((n, c) => {
      if (!n) return;
      const d = addDays(wkStart, c);
      events.append(
        h('button.mv-more', { type: 'button', style: { gridColumn: String(c + 1), gridRow: String(limit(c) + 1) }, on: { click: () => A.goToDate(d, 'day') } }, `+${n} more`),
      );
    });
  }

  // interactions
  weeksEl.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.mv-chip');
    if (!chip) return;
    const o = byOid.get(chip.dataset.oid);
    if (!o || o.draft) return;
    startDayDrag(e, { chip, occ: o, cells: () => cellsAll, onDrop: (delta) => A.moveFlow(o, addDays(o.start, delta), addDays(o.end, delta)) });
  });
  weeksEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.mv-chip');
    if (chip) {
      const o = byOid.get(chip.dataset.oid);
      if (!o || o.draft) return;
      if (isDoubleTap(o.oid)) A.openEvent(o, chip);
      else A.select([o.oid], { additive: e.shiftKey || e.metaKey || e.ctrlKey });
      return;
    }
    if (e.target.closest('.mv-more, .mv-daynum')) return;
    // empty space in a cell: find the cell under the pointer (the events layer sits on top)
    const cell = cellsAll.find((c) => {
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    });
    if (!cell) return;
    if (isDoubleTap('mv|' + cell.dataset.date)) {
      const d = parse(cell.dataset.date);
      A.openAdd(A.defaultNewRange(d), null);
    } else A.clearSelection();
  });
  weeksEl.addEventListener('keydown', (e) => {
    const chip = e.target.closest && e.target.closest('.mv-chip');
    if (!chip || (e.key !== 'Enter' && e.key !== ' ')) return;
    const o = byOid.get(chip.dataset.oid);
    if (!o || o.draft) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') A.openEvent(o, chip);
    else A.select([o.oid]);
  });
  mv.relayout = () => store.setUI({});
  return mv;
}

function monthChip(it, lane, selected, use24, wkStart) {
  const o = it.o;
  const isBar = o.allDay || it.endCol > it.startCol;
  const isSel = selected.has(o.oid) || !!o.draft;
  const contL = o.start < wkStart;
  const contR = new Date(+o.end - 1) >= addDays(wkStart, 7);
  return h(
    'div.mv-chip',
    {
      tabIndex: o.draft ? -1 : 0,
      role: 'button',
      dataset: { oid: o.oid },
      'aria-label': occLabel(o, use24),
      'aria-pressed': String(isSel),
      class: [isBar ? 'bar' : 'timed', isSel ? 'selected' : null, contL ? 'cont-left' : null, contR ? 'cont-right' : null, !o.draft && isDone(o) ? 'done' : null].filter(Boolean).join(' '),
      style: { ...calVars(o.calendar.color), gridColumn: `${it.startCol + 1} / ${it.endCol + 2}`, gridRow: String(lane + 1) },
    },
    isBar ? null : h('span.chip-dot'),
    h('span.chip-title', o.event.title),
    isBar ? (o.allDay ? null : h('span.chip-time', formatTimeCompact(o.start, use24))) : h('span.chip-time', formatTimeCompact(o.start, use24)),
  );
}

// ------------------------------------------------------------------ Year
function renderYear(host, s) {
  const year = s.ui.cursor.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const days = new Set();
  for (const o of occurrences(s.data, start, end)) {
    const last = +o.end === +o.start ? o.start : new Date(+o.end - 1);
    for (let d = startOfDay(o.start); d <= last; d = addDays(d, 1)) {
      if (d >= end) break;
      days.add(dateKey(d));
    }
  }
  const grid = h('div.yv', { role: 'list', 'aria-label': String(year) });
  for (let m = 0; m < 12; m++) {
    grid.append(
      h(
        'div.yv-month',
        { role: 'listitem' },
        miniCal({
          month: new Date(year, m, 1),
          today: new Date(),
          weekStart: s.prefs.weekStart,
          eventDays: days,
          header: 'title',
          variant: 'year',
          onTitle: () => A.goToDate(new Date(year, m, 1), 'month'),
          onPick: (d) => A.goToDate(d, 'day'),
        }),
      ),
    );
  }
  host.append(grid);
  return grid;
}
