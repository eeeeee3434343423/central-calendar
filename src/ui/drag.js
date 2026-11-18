// Day-granularity drag for chips (all-day row and Month view).
import { parse, addDays, diffDays, dateKey } from '../lib/dates.js';

const THRESHOLD = 4;

/** The [data-date] cell under a point, found by geometry so overlapping chips don't get in the way. */
export function cellAt(cells, x, y) {
  for (const c of cells) {
    const r = c.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return c;
  }
  return null;
}

/** Number of calendar days an occurrence touches (end is exclusive). */
export function spanDays(occ) {
  return Math.max(1, diffDays(occ.start, new Date(Math.max(+occ.start, +occ.end - 1))) + 1);
}

/**
 * Start a possible drag from a pointerdown on a chip.
 * opts: { chip, occ, cells: () => Element[], onDrop(deltaDays) }
 */
export function startDayDrag(e, { chip, occ, cells, onDrop }) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const all = cells();
  const originCell = cellAt(all, x0, y0);
  if (!originCell) return;
  const originDate = parse(originCell.dataset.date);
  const span = spanDays(occ);
  let dragging = false;
  let target = originCell;

  const paint = () => {
    for (const c of all) c.classList.remove('drop-target');
    if (!target) return;
    const first = addDays(occ.start, diffDays(originDate, parse(target.dataset.date)));
    const keys = new Set(Array.from({ length: span }, (_, i) => dateKey(addDays(first, i))));
    for (const c of all) if (keys.has(c.dataset.date)) c.classList.add('drop-target');
  };

  const move = (ev) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      chip.classList.add('drag-origin');
      document.body.classList.add('is-dragging');
      paint();
    }
    const c = cellAt(all, ev.clientX, ev.clientY);
    if (c && c !== target) {
      target = c;
      paint();
    }
  };
  const finish = (commit) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    document.body.classList.remove('is-dragging');
    for (const c of all) c.classList.remove('drop-target');
    chip.classList.remove('drag-origin');
    if (commit && dragging && target) {
      const delta = diffDays(originDate, parse(target.dataset.date));
      if (delta) onDrop(delta);
    }
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
