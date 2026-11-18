// Week and Day time grid: day labels, all-day row, timeline, now line, and pointer interactions.
import { h, calVars } from './dom.js';
import { store, targetCalendarId } from '../app/store.js';
import * as A from '../app/actions.js';
import { parse, dtKey, dateKey, addDays, addMinutes, sameDay, diffDays, diffMinutes, minutesOfDay, formatTime, formatTimeCompact, hourLabel, WEEKDAYS_SHORT, WEEKDAYS, isWeekend, formatLongDate } from '../lib/dates.js';
import { occurrences, isDone } from '../lib/model.js';
import { justClosedOverlay } from './overlays.js';
import { layoutDay, layoutLanes } from '../lib/layout.js';
import { startDayDrag } from './drag.js';

const THRESHOLD = 4;
const snapMinutes = () => store.get().prefs.snapMinutes || 15;
let scrollMemo = null;
let lastScrollReq = 0;
let lastTap = { key: null, t: 0 };

/** Our own double-click detection; the DOM is rebuilt between the two clicks. */
export function isDoubleTap(key) {
  const now = Date.now();
  const hit = lastTap.key === key && now - lastTap.t < 450;
  lastTap = hit ? { key: null, t: 0 } : { key, t: now };
  return hit;
}

export function draftOccurrence(s) {
  const d = s.ui.draft;
  if (!d) return null;
  const cal = s.data.calendars.find((c) => c.id === d.calendarId) || { color: '#ff2d55', name: '' };
  return { oid: 'draft', eventId: 'draft', start: parse(d.start), end: parse(d.end), allDay: d.allDay, event: { title: d.title || 'New Event', location: '' }, calendar: cal, draft: true, recurring: false };
}

export function occLabel(o, use24) {
  const when = o.allDay ? `${formatLongDate(o.start)}, all day` : `${formatLongDate(o.start)}, ${formatTime(o.start, use24)} to ${formatTime(o.end, use24)}`;
  return `${o.event.title}, ${when}${o.event.location ? ', ' + o.event.location : ''}, ${o.calendar.name} calendar${o.recurring ? ', repeating' : ''}`;
}

function timeRange(o, use24) {
  const sameMer = !use24 && (o.start.getHours() < 12) === (o.end.getHours() < 12) && sameDay(o.start, o.end);
  const a = formatTimeCompact(o.start, use24);
  const b = formatTimeCompact(o.end, use24);
  return sameMer ? `${a.replace(/ (AM|PM)$/, '')} – ${b}` : `${a} – ${b}`;
}

/**
 * Render the grid into host.
 * mode 'week' shows day labels; mode 'day' shows a big date header instead.
 */
export function renderTimeGrid(host, s, range, mode) {
  const N = range.days;
  const days = Array.from({ length: N }, (_, i) => addDays(range.start, i));
  const now = new Date();
  const use24 = s.prefs.timeFormat === '24';
  const selected = new Set(s.ui.selection);
  const occs = occurrences(s.data, range.start, range.end);
  const draft = draftOccurrence(s);
  if (draft && draft.end > range.start && draft.start < range.end) occs.push(draft);
  const byOid = new Map(occs.map((o) => [o.oid, o]));

  const isAllDayRow = (o) => o.allDay || diffMinutes(o.start, o.end) >= 1440;
  const allDayOccs = occs.filter(isAllDayRow);
  const timedOccs = occs.filter((o) => !isAllDayRow(o));

  const tg = h(`div.tg.tg-${mode}`, { style: { '--days': N } });

  // ---------- header
  if (mode === 'week') {
    const labels = h('div.tg-daylabels');
    days.forEach((d) => {
      const isToday = sameDay(d, now);
      labels.append(
        h(
          'button.tg-daylabel',
          {
            type: 'button',
            class: [isToday ? 'today' : null, isWeekend(d) ? 'weekend' : null].filter(Boolean).join(' ') || null,
            'aria-label': `${formatLongDate(d)}. Open in Day view`,
            'aria-current': isToday ? 'date' : null,
            on: { click: () => A.goToDate(d, 'day') },
          },
          h('span.dl-num', String(d.getDate())),
          h('span.dl-wd', N > 7 ? WEEKDAYS_SHORT[d.getDay()][0] : WEEKDAYS_SHORT[d.getDay()]),
        ),
      );
    });
    tg.append(h('div.tg-head', h('div.tg-gutter-head'), labels));
  } else {
    const d = days[0];
    tg.append(
      h(
        'div.tg-dayhead',
        { class: sameDay(d, now) ? 'today' : null },
        h('span.dh-num', String(d.getDate())),
        h('span.dh-wd', WEEKDAYS[d.getDay()]),
      ),
    );
  }

  // ---------- all-day row
  const adCells = h('div.ad-cells');
  days.forEach((d) => adCells.append(h('div.ad-cell', { dataset: { date: dateKey(d) }, class: isWeekend(d) ? 'weekend' : null })));
  const adChips = h('div.ad-chips');
  const spans = allDayOccs.map((o) => {
    const last = new Date(Math.max(+o.start, +o.end - 1));
    return { id: o.oid, startCol: Math.max(0, diffDays(range.start, o.start)), endCol: Math.min(N - 1, diffDays(range.start, last)), o };
  });
  const { lanes } = layoutLanes(spans);
  for (const sp of spans) {
    const o = sp.o;
    const contL = o.start < range.start;
    const contR = new Date(+o.end - 1) >= range.end;
    adChips.append(
      h(
        'div.ad-chip',
        {
          tabIndex: 0,
          role: 'button',
          dataset: { oid: o.oid },
          'aria-label': occLabel(o, use24),
          'aria-pressed': String(selected.has(o.oid) || !!o.draft),
          class: [selected.has(o.oid) || o.draft ? 'selected' : null, contL ? 'cont-left' : null, contR ? 'cont-right' : null, !o.draft && isDone(o) ? 'done' : null].filter(Boolean).join(' ') || null,
          style: { ...calVars(o.calendar.color), gridColumn: `${sp.startCol + 1} / ${sp.endCol + 2}`, gridRow: String(lanes.get(o.oid) + 1) },
        },
        !o.allDay ? h('span.chip-time', formatTimeCompact(o.start, use24)) : null,
        h('span.chip-title', o.event.title),
      ),
    );
  }
  const adGrid = h('div.ad-grid', adCells, adChips);
  tg.append(h('div.tg-allday', h('div.tg-allday-label', 'All Day'), h('div.ad-scroll', adGrid)));

  adGrid.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.ad-chip');
    if (!chip) return;
    const o = byOid.get(chip.dataset.oid);
    if (!o || o.draft) return;
    startDayDrag(e, {
      chip,
      occ: o,
      cells: () => [...adCells.children],
      onDrop: (delta) => A.moveFlow(o, addDays(o.start, delta), addDays(o.end, delta)),
    });
  });
  adGrid.addEventListener('click', (e) => {
    const chip = e.target.closest('.ad-chip');
    if (chip) {
      const o = byOid.get(chip.dataset.oid);
      if (!o || o.draft) return;
      if (isDoubleTap(o.oid)) A.openEvent(o, chip);
      else A.select([o.oid], { additive: e.shiftKey || e.metaKey || e.ctrlKey });
      return;
    }
    const cell = e.target.closest('.ad-cell');
    if (!cell) return;
    if (isDoubleTap('ad|' + cell.dataset.date)) {
      const d = parse(cell.dataset.date);
      A.openAdd({ start: dtKey(d), end: dtKey(addDays(d, 1)), allDay: true }, null);
    } else A.clearSelection();
  });

  // ---------- timeline
  const hours = h('div.tg-hours', { 'aria-hidden': 'true' });
  const nowMin = minutesOfDay(now);
  const todayIdx = days.findIndex((d) => sameDay(d, now));
  for (let hr = 1; hr < 24; hr++) {
    hours.append(h('div.tg-hour', { style: { top: `${(hr / 24) * 100}%` }, dataset: { hour: String(hr) } }, hourLabel(hr, use24)));
  }
  const cols = h('div.tg-cols');
  const colEls = days.map((d, i) => {
    const col = h('div.tg-col', { dataset: { date: dateKey(d), index: String(i) }, class: [isWeekend(d) ? 'weekend' : null, i === todayIdx ? 'today' : null].filter(Boolean).join(' ') || null });
    cols.append(col);
    return col;
  });

  // segments per day column
  const perCol = days.map(() => []);
  for (const o of timedOccs) {
    const first = Math.max(0, diffDays(range.start, o.start));
    const lastDay = +o.end === +o.start ? o.start : new Date(+o.end - 1);
    const last = Math.min(N - 1, diffDays(range.start, lastDay));
    for (let i = first; i <= last; i++) {
      const dayStart = days[i];
      const dayEnd = addDays(dayStart, 1);
      const segS = o.start > dayStart ? o.start : dayStart;
      const segE = o.end < dayEnd ? o.end : dayEnd;
      const startMin = diffMinutes(dayStart, segS);
      const endMin = segE >= dayEnd ? 1440 : diffMinutes(dayStart, segE);
      perCol[i].push({ id: `${o.oid}#${i}`, o, startMin, endMin, contTop: o.start < dayStart, contBottom: o.end > dayEnd });
    }
  }
  perCol.forEach((segs, i) => {
    const lay = layoutDay(segs.map((sg) => ({ id: sg.id, start: sg.startMin, end: Math.max(sg.endMin, sg.startMin + 25) })));
    for (const sg of segs) {
      const { col, cols: ncols } = lay.get(sg.id);
      colEls[i].append(eventBlock(sg, col, ncols, selected, use24));
    }
  });

  const nowEls = [];
  if (todayIdx >= 0) {
    const top = `${(nowMin / 1440) * 100}%`;
    const label = h('div.tg-now-label', formatTime(now, use24));
    const line = h('div.tg-now', { style: { top }, 'aria-hidden': 'true' }, label, h('div.tg-now-line'));
    const dot = h('div.tg-now-dot', { style: { top }, 'aria-hidden': 'true' });
    colEls[todayIdx].append(dot);
    nowEls.push(line, dot);
  }

  const body = h('div.tg-body', hours, cols, ...nowEls.filter((x) => x.classList.contains('tg-now')));
  const scroller = h('div.tg-scroll', body);
  tg.append(scroller);
  host.append(tg);

  // ---------- sizing + scroll position
  const hoverSlot = h('div.tg-hover', { 'aria-hidden': 'true' }, h('span.tg-hover-label'));
  const sizeHours = () => {
    const hh = Math.max(40, scroller.clientHeight / (s.prefs.hoursDisplayed || 12));
    tg.style.setProperty('--hour-h', `${hh}px`);
    tg.classList.toggle('quarters', hh >= 44);
    fitBlocks(tg);
    markNearNow(tg);
    return hh;
  };
  const hh = sizeHours();
  const req = s.ui.scrollReq;
  const scrollToMin = (min) => {
    scroller.scrollTop = Math.max(0, (min / 60) * hh - scroller.clientHeight / 4);
  };
  if (req && req.t !== lastScrollReq) {
    lastScrollReq = req.t;
    scrollToMin(req.now ? nowMin : req.min);
  } else if (scrollMemo !== null) {
    scroller.scrollTop = scrollMemo;
  } else {
    scrollToMin(todayIdx >= 0 ? nowMin : 8 * 60);
  }
  scrollMemo = scroller.scrollTop;
  scroller.addEventListener('scroll', () => (scrollMemo = scroller.scrollTop), { passive: true });
  tg.resize = sizeHours;

  // ---------- interactions
  attachTimelineInteractions({ tg, body, cols, colEls, scroller, range, days, byOid, s, hoverSlot });
  tg.addEventListener('keydown', (e) => {
    const blk = e.target.closest && e.target.closest('[data-oid]');
    if (!blk || (e.key !== 'Enter' && e.key !== ' ')) return;
    const o = byOid.get(blk.dataset.oid);
    if (!o || o.draft) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') A.openEvent(o, blk);
    else A.select([o.oid]);
  });
  return tg;
}

/** Show as much text as fits: one line + time for short blocks, more lines for tall ones. */
function fitBlocks(tg) {
  for (const b of tg.querySelectorAll('.ev-block:not(.preview)')) {
    const hgt = b.offsetHeight;
    const short = hgt < 34;
    b.classList.toggle('short', short);
    const title = b.querySelector('.ev-title');
    const sub = b.querySelector('.ev-sub');
    const titleLines = short ? 1 : hgt < 56 ? 1 : 2;
    if (title) title.style.webkitLineClamp = String(titleLines);
    if (sub) {
      const subLines = short ? 0 : Math.floor((hgt - 7 - titleLines * 14) / 13);
      sub.hidden = subLines <= 0;
      sub.style.webkitLineClamp = String(Math.max(1, subLines));
    }
  }
}

/** Hide hour labels the "now" label would sit on top of (depends on how tall an hour is). */
function markNearNow(tg) {
  const hh = parseFloat(tg.style.getPropertyValue('--hour-h')) || 48;
  const hasNow = !!tg.querySelector('.tg-now');
  const nowMin = minutesOfDay(new Date());
  const threshold = (20 / hh) * 60; // minutes covered by about 20px
  for (const el of tg.querySelectorAll('.tg-hour')) {
    el.classList.toggle('near-now', hasNow && Math.abs(nowMin - +el.dataset.hour * 60) < threshold);
  }
}

function eventBlock(sg, col, ncols, selected, use24) {
  const o = sg.o;
  const dur = sg.endMin - sg.startMin;
  const isSel = selected.has(o.oid) || !!o.draft;
  const done = !o.draft && isDone(o);
  const dl = o.event.deadline ? parse(o.event.deadline) : null;
  const due = dl ? `Due ${formatTimeCompact(dl, use24)}${sameDay(dl, o.start) ? '' : ` ${dl.getMonth() + 1}/${dl.getDate()}`}` : null;
  const sub = [timeRange(o, use24), o.event.location, due].filter(Boolean).join('\n');
  return h(
    'div.ev-block',
    {
      tabIndex: o.draft ? -1 : 0,
      role: 'button',
      dataset: { oid: o.oid },
      'aria-label': occLabel(o, use24),
      'aria-pressed': String(isSel),
      class: [isSel ? 'selected' : null, dur < 30 ? 'short' : null, done ? 'done' : null, o.draft ? 'draft' : null, sg.contTop ? 'cont-top' : null, sg.contBottom ? 'cont-bottom' : null].filter(Boolean).join(' ') || null,
      style: {
        ...calVars(o.calendar.color),
        top: `${(sg.startMin / 1440) * 100}%`,
        height: `${(Math.max(dur, 0) / 1440) * 100}%`,
        left: `calc(${col} * 100% / ${ncols})`,
        width: `calc(100% / ${ncols} - 2px)`,
      },
    },
    h(
      'div.ev-text',
      h('div.ev-title', done ? h('span.ev-check', { 'aria-hidden': 'true' }, '✓ ') : null, o.event.title, h('span.ev-inline-time', ` ${formatTimeCompact(o.start, use24)}`)),
      h('div.ev-sub', sub),
      o.recurring ? h('span.ev-repeat', { 'aria-hidden': 'true', title: 'Repeating event' }, '↻') : null,
    ),
    !sg.contTop && !o.draft ? h('div.rz.rz-top', { 'aria-hidden': 'true' }) : null,
    !sg.contBottom && !o.draft ? h('div.rz.rz-bottom', { 'aria-hidden': 'true' }) : null,
  );
}

function attachTimelineInteractions({ body, cols, colEls, scroller, range, days, byOid, hoverSlot }) {
  const N = days.length;
  const use24 = () => store.get().prefs.timeFormat === '24';
  const timeAt = (x, y) => {
    const cr = cols.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const dayIndex = Math.max(0, Math.min(N - 1, Math.floor(((x - cr.left) / cr.width) * N)));
    const minutes = Math.max(0, Math.min(1440, ((y - br.top) / br.height) * 1440));
    return { dayIndex, minutes, abs: dayIndex * 1440 + minutes };
  };
  const absToDate = (abs) => addMinutes(range.start, Math.round(abs));
  const snapAbs = (abs) => Math.round(abs / snapMinutes()) * snapMinutes();
  const floorAbs = (abs) => Math.floor(abs / snapMinutes()) * snapMinutes();

  // Hover preview of the block a click would create.
  const hideHover = () => hoverSlot.remove();
  cols.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons || document.body.classList.contains('is-dragging') || e.target.closest('.ev-block')) {
      hideHover();
      return;
    }
    const p = timeAt(e.clientX, e.clientY);
    const st = store.get();
    const startMin = Math.min(1440 - snapMinutes(), Math.floor(p.minutes / snapMinutes()) * snapMinutes());
    const len = Math.min(st.prefs.defaultDuration || 15, 1440 - startMin);
    hoverSlot.style.top = `${(startMin / 1440) * 100}%`;
    hoverSlot.style.height = `${(len / 1440) * 100}%`;
    hoverSlot.firstChild.textContent = `+ ${formatTimeCompact(addMinutes(days[p.dayIndex], startMin), use24())}`;
    if (hoverSlot.parentNode !== colEls[p.dayIndex]) colEls[p.dayIndex].append(hoverSlot);
  });
  cols.addEventListener('pointerleave', hideHover);

  let previews = [];
  const clearPreview = () => {
    previews.forEach((p) => p.remove());
    previews = [];
  };
  const drawPreview = (start, end, o, cls) => {
    clearPreview();
    for (let i = 0; i < N; i++) {
      const dayStart = days[i];
      const dayEnd = addDays(dayStart, 1);
      if (!(start < dayEnd && end > dayStart) && !(+start === +end && start >= dayStart && start < dayEnd)) continue;
      const segS = start > dayStart ? start : dayStart;
      const segE = end < dayEnd ? end : dayEnd;
      const sm = diffMinutes(dayStart, segS);
      const em = segE >= dayEnd ? 1440 : diffMinutes(dayStart, segE);
      const p = h(
        `div.ev-block.selected.preview${cls ? '.' + cls : ''}`,
        { style: { ...calVars(o.calendar.color), top: `${(sm / 1440) * 100}%`, height: `${((em - sm) / 1440) * 100}%`, left: '0', width: 'calc(100% - 2px)' } },
        h('div.ev-text', h('div.ev-title', o.event.title), h('div.ev-sub', `${formatTimeCompact(start, use24())} – ${formatTimeCompact(end, use24())}`)),
      );
      colEls[i].append(p);
      previews.push(p);
    }
  };

  cols.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const blk = e.target.closest('.ev-block');
    const o = blk ? byOid.get(blk.dataset.oid) : null;
    if (blk && (!o || o.draft)) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const p0 = timeAt(x0, y0);
    let mode = blk ? (e.target.classList.contains('rz-top') ? 'resize-top' : e.target.classList.contains('rz-bottom') ? 'resize-bottom' : 'move') : 'create';
    let active = mode.startsWith('resize');
    let last = { x: x0, y: y0 };
    let result = null;
    const grabAbs = mode === 'create' ? floorAbs(p0.abs) : p0.abs;
    const SNAP = snapMinutes();
    const hadSelection = store.get().ui.selection.length > 0;
    const closedSomething = justClosedOverlay();
    if (mode === 'create') e.preventDefault();
    hideHover();

    const compute = () => {
      const p = timeAt(last.x, last.y);
      if (mode === 'move') {
        const delta = snapAbs(p.abs - grabAbs);
        result = { start: addMinutes(o.start, delta), end: addMinutes(o.end, delta) };
        drawPreview(result.start, result.end, o, 'moving');
      } else if (mode === 'resize-bottom') {
        const startAbs = diffMinutes(range.start, o.start);
        const endAbs = Math.max(startAbs + SNAP, snapAbs(p.abs));
        result = { start: o.start, end: absToDate(endAbs) };
        drawPreview(result.start, result.end, o);
      } else if (mode === 'resize-top') {
        const endAbs = diffMinutes(range.start, o.end);
        const startAbs = Math.min(endAbs - SNAP, snapAbs(p.abs));
        result = { start: absToDate(startAbs), end: o.end };
        drawPreview(result.start, result.end, o);
      } else {
        const dayBase = Math.floor(grabAbs / 1440) * 1440;
        let cur = Math.max(dayBase, Math.min(dayBase + 1440, snapAbs(p0.dayIndex === p.dayIndex ? p.abs : p.dayIndex > p0.dayIndex ? dayBase + 1440 : dayBase)));
        let a = Math.min(grabAbs, cur);
        let b = Math.max(grabAbs, cur);
        if (b - a < SNAP) b = Math.min(dayBase + 1440, a + SNAP);
        if (b - a < SNAP) a = b - SNAP;
        result = { start: absToDate(a), end: absToDate(b) };
        const st = store.get();
        const cal = st.data.calendars.find((c) => c.id === targetCalendarId(st)) || { color: '#ff2d55' };
        drawPreview(result.start, result.end, { calendar: cal, event: { title: 'New Event' } }, 'draft');
      }
    };

    if (active) {
      blk.classList.add('drag-origin');
      document.body.classList.add(mode === 'move' ? 'is-dragging' : 'is-resizing');
    }

    let raf = 0;
    const autoScroll = () => {
      raf = 0;
      if (!active) return;
      const r = scroller.getBoundingClientRect();
      let dy = 0;
      if (last.y < r.top + 28) dy = -Math.ceil((r.top + 28 - last.y) / 3);
      else if (last.y > r.bottom - 28) dy = Math.ceil((last.y - (r.bottom - 28)) / 3);
      if (dy) {
        scroller.scrollTop += dy;
        compute();
        raf = requestAnimationFrame(autoScroll);
      }
    };

    const move = (ev) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
        active = true;
        if (blk) blk.classList.add('drag-origin');
        document.body.classList.add(mode === 'create' ? 'is-creating' : 'is-dragging');
      }
      compute();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };
    const finish = (commit) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc, true);
      cancelAnimationFrame(raf);
      document.body.classList.remove('is-dragging', 'is-resizing', 'is-creating');
      if (blk) blk.classList.remove('drag-origin');
      clearPreview();
      if (!commit) return;
      if (active && result) {
        if (mode === 'create') A.openAdd({ start: dtKey(result.start), end: dtKey(result.end) }, null);
        else A.moveFlow(o, result.start, result.end);
        return;
      }
      // a plain click
      if (o) {
        if (isDoubleTap(o.oid)) A.openEvent(o, blk);
        else A.select([o.oid], { additive: e.shiftKey || e.metaKey || e.ctrlKey });
      } else if (hadSelection || closedSomething) {
        // The first click only clears the selection or closes the open popover.
        A.clearSelection();
      } else {
        // Click an empty slot to add a block there (length = Settings > Events > Default Block Length).
        const st = store.get();
        const start = absToDate(floorAbs(p0.abs));
        A.openAdd({ start: dtKey(start), end: dtKey(addMinutes(start, st.prefs.defaultDuration || 15)) }, null);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const esc = (ev) => {
      if (ev.key === 'Escape' && active) {
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc, true);
  });

  // Touch: tap selects, double-tap opens/creates (scrolling stays native).
  cols.addEventListener('click', (e) => {
    if (e.pointerType !== 'touch' && !(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
    const blk = e.target.closest('.ev-block');
    const o = blk ? byOid.get(blk.dataset.oid) : null;
    if (o && !o.draft) {
      if (isDoubleTap(o.oid)) A.openEvent(o, blk);
      else A.select([o.oid]);
      return;
    }
    const p = timeAt(e.clientX, e.clientY);
    const slot = `${p.dayIndex}|${floorAbs(p.minutes)}`;
    if (isDoubleTap('slot|' + slot)) {
      const start = absToDate(floorAbs(p.abs));
      A.openAdd({ start: dtKey(start), end: dtKey(addMinutes(start, store.get().prefs.defaultDuration || 15)) }, null);
    } else A.clearSelection();
  });
}

/** Called every minute: move the now line without a full re-render. */
export function tickNow(use24) {
  const now = new Date();
  const top = `${(minutesOfDay(now) / 1440) * 100}%`;
  document.querySelectorAll('.tg-now, .tg-now-dot').forEach((el) => (el.style.top = top));
  document.querySelectorAll('.tg-now-label').forEach((el) => (el.textContent = formatTime(now, use24)));
  document.querySelectorAll('.tg').forEach(markNearNow);
}

export function resetScrollMemo() {
  scrollMemo = null;
}
