// Small dialogs: Custom Repeat, Go To Date, Keyboard Shortcuts.
import { h } from './dom.js';
import { openDialog } from './overlays.js';
import { selectButton, dateField } from './controls.js';
import { miniCal } from './minical.js';
import { WEEKDAYS_INITIAL, WEEKDAYS, dateKey, parse, addMonths } from '../lib/dates.js';

/** Custom repeat rule editor. onConfirm(rule) gets { freq, interval, byDay? }. */
export function openCustomRepeat({ rule, startDay, onConfirm, onCancel }) {
  const r = { freq: rule.freq || 'weekly', interval: rule.interval || 1, byDay: rule.byDay && rule.byDay.length ? [...rule.byDay] : [startDay] };
  let confirmed = false;
  const unitText = () => ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' })[r.freq] + (r.interval === 1 ? '' : 's');
  const unitEl = h('span');
  const tailEl = h('span');
  const days = h('div.weekday-toggles', { role: 'group', 'aria-label': 'Repeat on' });

  const renderDays = () => {
    days.replaceChildren();
    days.hidden = r.freq !== 'weekly';
    for (let d = 0; d < 7; d++) {
      const on = r.byDay.includes(d);
      days.append(
        h(
          'button.weekday-toggle',
          {
            type: 'button',
            class: [on ? 'on' : null, d === 0 || d === 6 ? 'weekend' : null].filter(Boolean).join(' ') || null,
            'aria-pressed': String(on),
            'aria-label': WEEKDAYS[d],
            on: {
              click: () => {
                if (on && r.byDay.length === 1) return; // keep at least one day
                r.byDay = on ? r.byDay.filter((x) => x !== d) : [...r.byDay, d].sort((a, b) => a - b);
                renderDays();
              },
            },
          },
          WEEKDAYS_INITIAL[d],
        ),
      );
    }
  };
  const renderText = () => {
    unitEl.textContent = unitText();
    tailEl.textContent = r.freq === 'weekly' ? ' on:' : '';
  };

  const freq = selectButton({
    options: [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'yearly', label: 'Yearly' },
    ],
    value: r.freq,
    label: 'Frequency',
    variant: 'large',
    onChange: (f) => {
      r.freq = f;
      renderText();
      renderDays();
    },
  });
  const n = h('input.text-field.interval-input', { type: 'number', min: 1, max: 99, value: String(r.interval), 'aria-label': 'Repeat every' });
  n.addEventListener('input', () => {
    r.interval = Math.max(1, Math.min(99, parseInt(n.value, 10) || 1));
    renderText();
  });
  renderText();
  renderDays();

  const dlg = openDialog({
    title: 'Repeat',
    className: 'small-dialog.repeat-dialog',
    content: [h('div.repeat-freq', freq), h('div.repeat-every', 'Every', n, unitEl, tailEl), days],
    footer: [h('button.btn.btn-primary.btn-wide', { type: 'button', on: { click: () => { confirmed = true; dlg.close('confirm'); onConfirm({ freq: r.freq, interval: r.interval, ...(r.freq === 'weekly' ? { byDay: r.byDay } : {}) }); } } }, 'Confirm')],
    onClose: () => {
      if (!confirmed && onCancel) onCancel();
    },
  });
  return dlg;
}

/** Go To Date: date field + browsable month + OK. */
export function openGoToDate({ initial, today, weekStart, onGo }) {
  let picked = new Date(initial);
  let shown = new Date(initial);
  const cardHost = h('div.goto-card');
  const field = dateField({
    value: dateKey(picked),
    label: 'Date',
    onChange: (v) => {
      picked = parse(v);
      shown = new Date(picked);
      renderCard();
    },
  });
  const renderCard = () => {
    cardHost.replaceChildren(
      miniCal({
        month: shown,
        selected: picked,
        today,
        weekStart,
        header: 'nav',
        variant: 'picker',
        onNav: (dir) => {
          shown = addMonths(new Date(shown.getFullYear(), shown.getMonth(), 1), dir);
          renderCard();
        },
        onPick: (d) => {
          picked = d;
          field.setValue(dateKey(d));
          renderCard();
          cardHost.querySelector('button.selected')?.focus();
        },
      }),
    );
  };
  renderCard();
  const go = () => {
    dlg.close('ok');
    onGo(picked);
  };
  cardHost.addEventListener('dblclick', (e) => e.target.dataset?.date && go());
  const dlg = openDialog({
    title: 'Go To Date…',
    className: 'small-dialog.goto-dialog',
    content: [h('div.goto-field', field), cardHost],
    footer: [h('button.btn.btn-primary.btn-wide', { type: 'button', on: { click: go } }, 'OK')],
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field.value) picked = parse(field.value);
      go();
    }
  });
  return dlg;
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
export const SHORTCUTS = [
  ['Views', [[`D / W / M / Y`, 'Day, Week, Month, Year'], [`${mod} 1 – 4`, 'Day, Week, Month, Year']]],
  ['Navigate', [['← / →', 'Previous / next period (nothing selected)'], [`${mod} ← / →`, 'Previous / next period'], ['T', 'Go to today'], ['G', 'Go to date…']]],
  ['Events', [['N', 'New event'], ['Q', 'Quick Add blocks ("Focus 4pm 15m")'], ['Enter', 'View the selected event'], [`${mod} E`, 'Edit the selected event'], ['Delete / Backspace', 'Delete the selected event'], ['← → ↑ ↓', 'Move the selection between events'], [`${mod} A`, 'Select all visible events'], [`${mod} Z`, 'Undo']]],
  ['App', [[`${mod} F or /`, 'Search'], ['[', 'Show or hide the calendar list'], ['\\', 'Show or hide the Day panel'], [`${mod} ,`, 'Settings'], ['?', 'This list'], ['Esc', 'Close, cancel or clear']]],
];

export function openShortcuts() {
  return openDialog({
    title: 'Keyboard Shortcuts',
    className: 'small-dialog.shortcuts-dialog',
    content: SHORTCUTS.map(([group, rows]) =>
      h('section.sc-group', h('h3.sc-title', group), h('dl.sc-list', rows.map(([k, d]) => [h('dt', k.split(' or ').map((x, i) => [i ? ' or ' : '', h('kbd', x)])), h('dd', d)]))),
    ),
  });
}
