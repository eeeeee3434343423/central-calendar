// Mini month grid used by the Day panel, Year view and Go To Date.
import { h, icon } from './dom.js';
import { MONTHS, WEEKDAYS_INITIAL, WEEKDAYS, dateKey, addDays, monthGrid, sameDay, isWeekend, formatLongDate } from '../lib/dates.js';

/**
 * miniCal({ month, selected, today, weekStart, eventDays, onPick, header: 'none'|'nav'|'title',
 *           onNav(dir), onTitle(), variant: 'panel'|'year'|'picker' })
 */
export function miniCal({ month, selected = null, today = new Date(), weekStart = 0, eventDays = null, onPick, header = 'none', onNav, onTitle, variant = 'panel' }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const { start, weeks } = monthGrid(first, weekStart);
  const el = h(`div.minical.mc-${variant}`);

  if (header === 'nav') {
    el.append(
      h(
        'div.mc-head',
        h('span.mc-title', `${MONTHS[first.getMonth()]} ${first.getFullYear()}`),
        h(
          'div.mc-nav',
          h('button.btn-icon.red', { type: 'button', 'aria-label': 'Previous month', on: { click: () => onNav(-1) } }, icon('chevronLeft', 16)),
          h('button.btn-icon.red', { type: 'button', 'aria-label': 'Next month', on: { click: () => onNav(1) } }, icon('chevronRight', 16)),
        ),
      ),
    );
  } else if (header === 'title') {
    const isCurrent = first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth();
    el.append(h('button.mc-month-title', { type: 'button', class: isCurrent ? 'current' : null, on: { click: () => onTitle && onTitle() } }, MONTHS[first.getMonth()]));
  }

  const grid = h('div.mc-grid', { role: 'grid', 'aria-label': `${MONTHS[first.getMonth()]} ${first.getFullYear()}` });
  const headRow = h('div.mc-row', { role: 'row' });
  for (let i = 0; i < 7; i++) {
    const wd = (weekStart + i) % 7;
    headRow.append(h('span.mc-wd', { role: 'columnheader', 'aria-label': WEEKDAYS[wd], class: wd === 0 || wd === 6 ? 'weekend' : null }, WEEKDAYS_INITIAL[wd]));
  }
  grid.append(headRow);
  for (let w = 0; w < weeks; w++) {
    const r = h('div.mc-row', { role: 'row' });
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      if (d.getMonth() !== first.getMonth()) {
        r.append(h('span.mc-cell.empty', { role: 'gridcell' }));
        continue;
      }
      const key = dateKey(d);
      const cls = ['mc-day'];
      if (isWeekend(d)) cls.push('weekend');
      if (sameDay(d, today)) cls.push('today');
      if (selected && sameDay(d, selected)) cls.push('selected');
      if (eventDays && eventDays.has(key)) cls.push('has-events');
      r.append(
        h(
          'span.mc-cell',
          { role: 'gridcell' },
          h(
            `button.${cls.join('.')}`,
            {
              type: 'button',
              tabIndex: selected && sameDay(d, selected) ? 0 : -1,
              dataset: { date: key },
              'aria-label': formatLongDate(d) + (eventDays && eventDays.has(key) ? ', has events' : ''),
              'aria-current': sameDay(d, today) ? 'date' : null,
              'aria-pressed': selected ? String(sameDay(d, selected)) : null,
              on: { click: () => onPick && onPick(d) },
            },
            String(d.getDate()),
          ),
        ),
      );
    }
    grid.append(r);
  }
  // Arrow-key navigation between dates.
  grid.addEventListener('keydown', (e) => {
    const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in map) || !e.target.dataset.date) return;
    e.preventDefault();
    e.stopPropagation();
    const btns = [...grid.querySelectorAll('button[data-date]')];
    const i = btns.indexOf(e.target);
    const next = btns[i + map[e.key]];
    if (next) next.focus();
  });
  if (!grid.querySelector('button[tabindex="0"]')) {
    const t = grid.querySelector('button.today') || grid.querySelector('button[data-date]');
    if (t) t.tabIndex = 0;
  }
  el.append(grid);
  return el;
}
