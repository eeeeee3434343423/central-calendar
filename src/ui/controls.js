// Form controls styled after the spec: select buttons (native select on top), switches, checkboxes.
import { h, icon } from './dom.js';
import { pad, parseTimeInput } from '../lib/dates.js';

/**
 * A select that shows its current label + optional color dot + up/down chevrons,
 * with a transparent native <select> on top that takes the clicks.
 * options: [{ value, label, color? }]
 */
export function selectButton({ options, value, onChange, label, dot = false, variant = '', id, disabled = false }) {
  const text = h('span.sb-text');
  const dotEl = dot ? h('span.sb-dot') : null;
  const sel = h(
    'select.sb-native',
    { 'aria-label': label || null, id: id || null, disabled },
    options.map((o) => h('option', { value: String(o.value) }, o.label)),
  );
  const wrap = h(`div.select-btn${variant ? '.' + variant : ''}`, text, dotEl, h('span.sb-chev', icon('chevronsUpDown', 13)), sel);
  const sync = () => {
    const o = options.find((x) => String(x.value) === sel.value) || options[0];
    text.textContent = o ? o.shortLabel || o.label : '';
    if (dotEl) dotEl.style.background = o?.color || 'transparent';
  };
  sel.value = String(value);
  if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  sync();
  sel.addEventListener('change', () => {
    sync();
    const o = options.find((x) => String(x.value) === sel.value);
    onChange && onChange(o ? o.value : sel.value);
  });
  wrap.select = sel;
  wrap.setValue = (v) => {
    sel.value = String(v);
    sync();
  };
  if (disabled) wrap.classList.add('disabled');
  return wrap;
}

export function switchControl({ checked, onChange, label }) {
  const input = h('input.switch-input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: !!checked });
  input.addEventListener('change', () => onChange && onChange(input.checked));
  return h('label.switch', input, h('span.switch-track', h('span.switch-knob')));
}

export function checkbox({ checked, onChange, label, color }) {
  const input = h('input.cb-input', { type: 'checkbox', checked: !!checked, 'aria-label': typeof label === 'string' && color ? label : null });
  input.addEventListener('change', () => onChange && onChange(input.checked));
  const box = h('span.cb-box', { style: color ? { '--cb': color } : null }, icon('check', 12));
  return h('label.checkbox', input, box, color ? null : h('span.cb-label', label));
}

/** Time entry: text field + AM/PM select (12h) or a single 24h field. Calls onChange(minutes). */
export function timeField({ minutes, use24, onChange, label }) {
  const input = h('input.text-field.time-input', { type: 'text', inputmode: 'numeric', 'aria-label': label, autocomplete: 'off', spellcheck: 'false' });
  let current = minutes;
  let mer;
  const render = () => {
    const hh = Math.floor(current / 60);
    const mm = current % 60;
    input.value = use24 ? `${pad(hh)}:${pad(mm)}` : `${pad(hh % 12 || 12)}:${pad(mm)}`;
    if (mer) mer.setValue(hh < 12 ? 'AM' : 'PM');
  };
  const commit = () => {
    const raw = input.value.trim();
    let v = parseTimeInput(raw);
    if (v === null) {
      render();
      return;
    }
    if (!use24 && !/[ap]/i.test(raw) && !/noon|midnight/i.test(raw)) {
      const hh = Math.floor(v / 60);
      if (hh >= 1 && hh <= 12) {
        const pm = mer.select.value === 'PM';
        v = ((hh % 12) + (pm ? 12 : 0)) * 60 + (v % 60);
      }
    }
    if (v !== current) {
      current = v;
      onChange(v);
    }
    render();
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      current = (current + (e.key === 'ArrowUp' ? 5 : -5) + 1440) % 1440;
      render();
      onChange(current);
    }
  });
  const parts = [input];
  if (!use24) {
    mer = selectButton({
      options: [
        { value: 'AM', label: 'AM' },
        { value: 'PM', label: 'PM' },
      ],
      value: minutes < 720 ? 'AM' : 'PM',
      label: `${label} AM or PM`,
      variant: 'compact',
      onChange: (v) => {
        const hh = Math.floor(current / 60);
        const next = ((hh % 12) + (v === 'PM' ? 12 : 0)) * 60 + (current % 60);
        if (next !== current) {
          current = next;
          onChange(current);
        }
      },
    });
    parts.push(mer);
  }
  const wrap = h('div.time-field', parts);
  wrap.setMinutes = (m) => {
    current = m;
    render();
  };
  render();
  return wrap;
}

/** Native date input (keyboard + picker friendly). value / onChange use 'YYYY-MM-DD'. */
export function dateField({ value, onChange, label, min }) {
  const input = h('input.date-field', { type: 'date', value, 'aria-label': label, min: min || null, required: true });
  input.addEventListener('change', () => {
    if (input.value) onChange(input.value);
  });
  input.setValue = (v) => {
    input.value = v;
  };
  return input;
}

/** Segmented control. segments: [{ value, label }] */
export function segmented({ segments, value, onChange, label }) {
  const wrap = h('div.segmented', { role: 'radiogroup', 'aria-label': label });
  const btns = segments.map((s) =>
    h(
      'button.segment',
      {
        type: 'button',
        role: 'radio',
        dataset: { value: s.value },
        title: s.title || null,
        on: { click: () => onChange(s.value) },
      },
      h('span.segment-label', { 'data-text': s.label }, s.label),
    ),
  );
  wrap.append(...btns);
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const n = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
    n.focus();
    onChange(n.dataset.value);
  });
  wrap.setValue = (v) => {
    btns.forEach((b, i) => {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('checked', on);
      b.classList.toggle('before-checked', btns[i + 1]?.dataset.value === v);
    });
  };
  wrap.setValue(value);
  return wrap;
}
