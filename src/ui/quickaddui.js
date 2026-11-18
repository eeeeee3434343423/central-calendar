// Quick Add popover: type "Focus 4pm 15m", press Enter, keep going to plan the day block by block.
import { h, icon, calVars } from './dom.js';
import { openPopover } from './overlays.js';
import { store, targetCalendarId } from '../app/store.js';
import * as A from '../app/actions.js';
import { parseQuickAdd } from '../lib/quickadd.js';
import { formatTime, sameDay, addDays, WEEKDAYS, MONTHS_SHORT, formatDuration, diffMinutes } from '../lib/dates.js';

const EXAMPLES = ['Focus 4pm 15m', 'Standup 9:30-9:45am', 'Gym tomorrow 6pm 1h', 'Pay rent fri'];

function dayName(d) {
  const t = new Date();
  if (sameDay(d, t)) return 'Today';
  if (sameDay(d, addDays(t, 1))) return 'Tomorrow';
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function describeResult(r, use24) {
  if (r.allDay) return `${dayName(r.start)} · All day`;
  return `${dayName(r.start)} · ${formatTime(r.start, use24)} – ${formatTime(r.end, use24)} (${formatDuration(diffMinutes(r.start, r.end))})`;
}

export function openQuickAdd(anchor) {
  const s = store.get();
  const use24 = s.prefs.timeFormat === '24';
  const base = s.ui.view === 'day' ? s.ui.cursor : new Date();
  const cal = s.data.calendars.find((c) => c.id === targetCalendarId(s));
  const input = h('input.qa-input', { type: 'text', placeholder: 'Add a block, e.g. Focus 4pm 15m', 'aria-label': 'Quick add', autocomplete: 'off', spellcheck: 'false' });
  const preview = h('div.qa-preview', { 'aria-live': 'polite' });
  const added = h('ul.qa-added', { 'aria-label': 'Added' });
  const parse = () => parseQuickAdd(input.value, { now: new Date(), base, defaultDuration: store.get().prefs.defaultDuration || 15, dateOrder: store.get().prefs.dateOrder });

  const renderPreview = () => {
    const r = parse();
    if (!r) {
      preview.replaceChildren(
        h('span.qa-hint', 'Try: '),
        ...EXAMPLES.map((ex) => h('button.qa-example', { type: 'button', on: { click: () => { input.value = ex; renderPreview(); input.focus(); } } }, ex)),
      );
      return;
    }
    preview.replaceChildren(h('div.qa-result', { style: cal ? calVars(cal.color) : null }, h('span.chip-dot'), h('strong', r.title), h('span.qa-when', describeResult(r, use24))));
  };

  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    const r = A.quickAdd(text, base);
    if (!r) return;
    A.ensureVisible(r.start);
    if (!r.allDay) store.setUI({ scrollReq: { min: r.start.getHours() * 60 + r.start.getMinutes(), t: Date.now() } });
    const oid = `${r.id}|${r.key}`;
    added.prepend(
      h(
        'li.qa-item',
        icon('check', 14),
        h('span.qa-item-text', h('strong', r.title), ` ${describeResult(r, use24)}`),
        h(
          'button.link-btn',
          {
            type: 'button',
            'aria-label': `Remove ${r.title}`,
            on: {
              click: (e) => {
                store.commit((d) => ({ ...d, events: d.events.filter((x) => x.id !== r.id) }), { label: 'Remove block' });
                e.currentTarget.closest('li').remove();
                input.focus();
              },
            },
          },
          'Remove',
        ),
      ),
    );
    void oid;
    input.value = '';
    renderPreview();
    input.focus();
  };

  input.addEventListener('input', renderPreview);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      add();
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });

  const content = h(
    'div.quick-add',
    h('div.qa-head', icon('zap', 16), h('span', 'Quick Add'), cal ? h('span.qa-cal', { style: calVars(cal.color) }, h('span.chip-dot'), cal.name) : null),
    h('div.qa-field', input, h('button.btn.btn-primary.qa-add', { type: 'button', on: { click: add } }, 'Add')),
    preview,
    added,
    h('p.qa-foot', 'Enter adds it and keeps this open for the next block. Esc closes.'),
  );
  renderPreview();
  const pop = openPopover({ anchor, content, side: 'below', className: 'qa-pop', label: 'Quick Add' });
  requestAnimationFrame(() => input.focus());
  return pop;
}
