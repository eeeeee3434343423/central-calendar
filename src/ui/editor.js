// The Add Event / Edit Event form, used in the popover and in the Day-view inspector.
import { h, icon } from './dom.js';
import { selectButton, switchControl, timeField, dateField } from './controls.js';
import { parse, dateKey, dtKey, addDays, minutesOfDay, diffDays, pad } from '../lib/dates.js';
import { describe, presetOf } from '../lib/recurrence.js';
import { openCustomRepeat } from './dialogs.js';

export const TIMED_ALERTS = [
  { value: 'none', label: 'None' },
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
];
export const ALLDAY_ALERTS = [
  { value: 'none', label: 'None' },
  { value: -540, label: 'On day of event (9 AM)' },
  { value: 900, label: '1 day before (9 AM)' },
  { value: 2340, label: '2 days before (9 AM)' },
  { value: 9540, label: '1 week before (9 AM)' },
];

const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const EMAILISH = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function initialValues(ev) {
  const s = parse(ev.start);
  const e = parse(ev.end);
  let eDate;
  if (ev.allDay) {
    const last = addDays(e, -1);
    eDate = dateKey(last < s ? s : last);
  } else eDate = dateKey(e);
  return {
    title: ev.title ?? 'New Event',
    location: ev.location || '',
    calendarId: ev.calendarId,
    allDay: !!ev.allDay,
    sDate: dateKey(s),
    eDate,
    sMin: ev.allDay ? 540 : minutesOfDay(s),
    eMin: ev.allDay ? 600 : minutesOfDay(e),
    repeat: ev.repeat ? { ...ev.repeat } : null,
    alerts: [ev.alerts?.[0] ?? null, ev.alerts?.[1] ?? null],
    invitees: [...(ev.invitees || [])],
    url: ev.url || '',
    notes: ev.notes || '',
    deadline: ev.deadline || null,
  };
}

/**
 * eventForm({ mode: 'add'|'edit', event, calendars, prefs, inline, onSubmit(values), onCancel(), onDelete() })
 * `event` carries start/end strings like stored events. onSubmit receives a patch with the same shape.
 */
export function eventForm({ mode, event, calendars, prefs, inline = false, onSubmit, onCancel, onDelete }) {
  const v = initialValues(event);
  const use24 = prefs.timeFormat === '24';

  const values = () => {
    let start;
    let end;
    if (v.allDay) {
      start = `${v.sDate}T00:00`;
      end = dtKey(addDays(parse(v.eDate), 1));
    } else {
      start = `${v.sDate}T${hhmm(v.sMin)}`;
      end = `${v.eDate}T${hhmm(v.eMin)}`;
    }
    let repeat = v.repeat;
    if (repeat && repeat.endType === 'until' && (!repeat.until || repeat.until < v.sDate)) repeat = { ...repeat, endType: 'never', until: undefined };
    if (repeat) repeat = Object.fromEntries(Object.entries(repeat).filter(([, x]) => x !== undefined));
    return {
      title: v.title.trim() || 'New Event',
      location: v.location.trim(),
      calendarId: v.calendarId,
      allDay: v.allDay,
      start,
      end,
      repeat,
      alerts: [...new Set(v.alerts.filter((a) => a !== null))],
      invitees: v.invitees,
      url: v.url.trim(),
      notes: v.notes,
      deadline: v.deadline,
    };
  };
  const initialJSON = JSON.stringify(values());
  const isValid = () => {
    const x = values();
    return v.allDay ? v.eDate >= v.sDate : x.end > x.start;
  };

  // ---- header
  const header = h('div.ef-header', h('h3.ef-title', mode === 'add' ? 'Add Event' : 'Edit Event'));
  const body = h('div.ef-body');
  body.addEventListener('scroll', () => header.classList.toggle('scrolled', body.scrollTop > 2), { passive: true });

  // ---- title + location
  const titleInput = h('input.text-field.ef-title-input', { type: 'text', value: v.title, placeholder: 'Title', 'aria-label': 'Title', maxlength: 300 });
  titleInput.addEventListener('input', () => {
    v.title = titleInput.value;
    refresh();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  const locInput = h('textarea.text-area.ef-location', { rows: 1, placeholder: 'Location or Video Call', 'aria-label': 'Location or Video Call', value: v.location });
  autoGrow(locInput);
  locInput.addEventListener('input', () => {
    v.location = locInput.value;
    refresh();
  });
  body.append(h('div.ef-stack', titleInput, locInput));

  const row = (label, control, cls = '') => h(`div.ef-row${cls ? '.' + cls : ''}`, h('span.ef-label', label), h('div.ef-control', control));

  // ---- calendar
  const calSelect = selectButton({
    options: calendars.map((c) => ({ value: c.id, label: c.name, color: c.color })),
    value: v.calendarId,
    label: 'Calendar',
    dot: true,
    onChange: (id) => {
      v.calendarId = id;
      refresh();
    },
  });
  body.append(row('Calendar', calSelect));

  // ---- all day
  const allDaySwitch = switchControl({
    checked: v.allDay,
    label: 'All Day',
    onChange: (on) => {
      v.allDay = on;
      v.alerts = [null, null];
      if (!on && v.eDate === v.sDate && v.eMin <= v.sMin) v.eMin = Math.min(v.sMin + 60, 1435);
      renderTimes();
      renderAlerts();
      refresh();
    },
  });
  body.append(row('All Day', allDaySwitch));

  // ---- starts / ends
  const timesHost = h('div.ef-times');
  body.append(timesHost);
  const errorEl = h('p.ef-error', { role: 'alert' });

  function shiftEndWithStart(newSDate, newSMin) {
    const dur = diffDays(parse(v.sDate), parse(v.eDate)) * 1440 + (v.allDay ? 0 : v.eMin - v.sMin);
    v.sDate = newSDate;
    v.sMin = newSMin;
    if (v.allDay) {
      v.eDate = dateKey(addDays(parse(newSDate), Math.round(dur / 1440)));
    } else {
      const total = newSMin + dur;
      v.eDate = dateKey(addDays(parse(newSDate), Math.floor(total / 1440)));
      v.eMin = ((total % 1440) + 1440) % 1440;
    }
  }

  function renderTimes() {
    timesHost.replaceChildren();
    const startDate = dateField({
      value: v.sDate,
      label: 'Start date',
      onChange: (d) => {
        shiftEndWithStart(d, v.sMin);
        renderTimes();
        refresh();
      },
    });
    const endDate = dateField({
      value: v.eDate,
      label: 'End date',
      onChange: (d) => {
        v.eDate = d;
        refresh();
      },
    });
    const startParts = [startDate];
    const endParts = [endDate];
    if (!v.allDay) {
      startParts.push(
        timeField({
          minutes: v.sMin,
          use24,
          label: 'Start time',
          onChange: (m) => {
            shiftEndWithStart(v.sDate, m);
            renderTimes();
            refresh();
          },
        }),
      );
      endParts.push(
        timeField({
          minutes: v.eMin,
          use24,
          label: 'End time',
          onChange: (m) => {
            v.eMin = m;
            refresh();
          },
        }),
      );
    }
    timesHost.append(row('Starts', h('div.ef-datetime', startParts)), row('Ends', h('div.ef-datetime', endParts)));
    if (!v.allDay) {
      const cur = diffDays(parse(v.sDate), parse(v.eDate)) * 1440 + v.eMin - v.sMin;
      const setLength = (m) => {
        const total = v.sMin + m;
        v.eDate = dateKey(addDays(parse(v.sDate), Math.floor(total / 1440)));
        v.eMin = total % 1440;
        renderTimes();
        refresh();
      };
      timesHost.append(
        row(
          'Length',
          h(
            'div.dur-chips',
            { role: 'group', 'aria-label': 'Length' },
            [15, 30, 45, 60, 90, 120].map((m) =>
              h('button.dur-chip', { type: 'button', 'aria-pressed': String(cur === m), class: cur === m ? 'on' : null, title: `${m} minutes`, on: { click: () => setLength(m) } }, m < 60 ? `${m}m` : `${m / 60}h`),
            ),
          ),
        ),
      );
    }
    timesHost.append(errorEl);
  }
  renderTimes();

  // ---- deadline (optional "due by", separate from when the block happens)
  const deadlineHost = h('div.ef-deadline');
  body.append(deadlineHost);
  function renderDeadline() {
    deadlineHost.replaceChildren();
    if (!v.deadline) {
      deadlineHost.append(
        row(
          'Deadline',
          h('button.btn-icon.red', { type: 'button', 'aria-label': 'Add a deadline', title: 'Add a deadline', on: { click: () => { v.deadline = v.allDay ? `${v.eDate}T17:00` : `${v.eDate}T${hhmm(v.eMin)}`; renderDeadline(); refresh(); } } }, icon('plus', 16)),
        ),
      );
      return;
    }
    const [dd, tt] = v.deadline.split('T');
    const [th, tm] = tt.split(':').map(Number);
    deadlineHost.append(
      row(
        'Deadline',
        h(
          'div.ef-datetime',
          dateField({ value: dd, label: 'Deadline date', onChange: (d) => { v.deadline = `${d}T${tt}`; refresh(); } }),
          timeField({ minutes: th * 60 + tm, use24, label: 'Deadline time', onChange: (m) => { v.deadline = `${v.deadline.split('T')[0]}T${hhmm(m)}`; refresh(); } }),
          h('button.btn-icon', { type: 'button', 'aria-label': 'Remove deadline', title: 'Remove deadline', on: { click: () => { v.deadline = null; renderDeadline(); refresh(); } } }, icon('x', 14)),
        ),
      ),
    );
  }
  renderDeadline();

  // ---- repeat
  const repeatHost = h('div.ef-repeat');
  body.append(repeatHost);
  function renderRepeat() {
    repeatHost.replaceChildren();
    const preset = presetOf(v.repeat);
    const opts = [
      { value: 'never', label: 'Never' },
      { value: 'daily', label: 'Every Day' },
      { value: 'weekly', label: 'Every Week' },
      { value: 'monthly', label: 'Every Month' },
      { value: 'yearly', label: 'Every Year' },
    ];
    if (preset === 'custom') opts.push({ value: 'current', label: describe({ ...v.repeat, endType: 'never' }), shortLabel: 'Custom' });
    opts.push({ value: 'custom', label: 'Custom…' });
    const sel = selectButton({
      options: opts,
      value: preset === 'custom' ? 'current' : preset,
      label: 'Repeat',
      onChange: (val) => {
        const keepEnd = v.repeat ? { endType: v.repeat.endType || 'never', count: v.repeat.count, until: v.repeat.until } : { endType: 'never' };
        if (val === 'never') v.repeat = null;
        else if (val === 'current') return;
        else if (val === 'custom') {
          const init = v.repeat || { freq: 'weekly', interval: 1, byDay: [parse(v.sDate).getDay()] };
          openCustomRepeat({
            rule: init,
            startDay: parse(v.sDate).getDay(),
            onConfirm: (rule) => {
              v.repeat = { ...rule, ...keepEnd };
              renderRepeat();
              refresh();
            },
            onCancel: () => renderRepeat(),
          });
          return;
        } else v.repeat = { freq: val, interval: 1, ...keepEnd };
        renderRepeat();
        refresh();
      },
    });
    repeatHost.append(row('Repeat', sel));
    if (v.repeat) {
      const endType = v.repeat.endType || 'never';
      const parts = [
        selectButton({
          options: [
            { value: 'never', label: 'Never' },
            { value: 'count', label: 'After Number of Times' },
            { value: 'until', label: 'On Date' },
          ],
          value: endType,
          label: 'End repeat',
          onChange: (t) => {
            v.repeat = { ...v.repeat, endType: t };
            if (t === 'count' && !v.repeat.count) v.repeat.count = 5;
            if (t === 'until' && !v.repeat.until) v.repeat.until = dateKey(addDays(parse(v.sDate), 30));
            renderRepeat();
            refresh();
          },
        }),
      ];
      if (endType === 'count') {
        const n = h('input.text-field.ef-count', { type: 'number', min: 1, max: 999, value: String(v.repeat.count || 5), 'aria-label': 'Number of times' });
        n.addEventListener('input', () => {
          const k = Math.max(1, Math.min(999, parseInt(n.value, 10) || 1));
          v.repeat = { ...v.repeat, count: k };
          refresh();
        });
        parts.push(n, h('span.ef-unit', 'times'));
      }
      if (endType === 'until') {
        parts.push(
          dateField({
            value: v.repeat.until,
            min: v.sDate,
            label: 'Repeat until',
            onChange: (d) => {
              v.repeat = { ...v.repeat, until: d };
              refresh();
            },
          }),
        );
      }
      repeatHost.append(row('End', h('div.ef-inline', parts)));
    }
  }
  renderRepeat();

  // ---- alerts
  const alertsHost = h('div.ef-alerts');
  body.append(alertsHost);
  function renderAlerts() {
    alertsHost.replaceChildren();
    const options = v.allDay ? ALLDAY_ALERTS : TIMED_ALERTS;
    const mk = (i, label) =>
      selectButton({
        options,
        value: v.alerts[i] === null ? 'none' : v.alerts[i],
        label,
        onChange: (val) => {
          v.alerts[i] = val === 'none' ? null : Number(val);
          if (i === 0 && v.alerts[0] === null) v.alerts[1] = null;
          renderAlerts();
          refresh();
        },
      });
    alertsHost.append(row('Alert', mk(0, 'Alert')));
    if (v.alerts[0] !== null) alertsHost.append(row('2nd Alert', mk(1, 'Second alert')));
  }
  renderAlerts();

  // ---- invitees (stored with the event; nothing is sent)
  const invHost = h('div.ef-invitees');
  body.append(invHost);
  let invEditing = false;
  function renderInvitees() {
    invHost.replaceChildren();
    const toggle = invEditing
      ? h('button.pill-done', { type: 'button', on: { click: () => { commitToken(); invEditing = false; renderInvitees(); } } }, 'Done')
      : h('button.btn-icon.red', { type: 'button', 'aria-label': 'Add a person', title: 'Add a person', on: { click: () => { invEditing = true; renderInvitees(); invHost.querySelector('.token-entry')?.focus(); } } }, icon('plus', 16));
    invHost.append(h('div.ef-row', h('span.ef-label', 'Invitees'), h('div.ef-control', toggle)));
    if (invEditing || v.invitees.length) {
      const box = h('div.token-box', { class: invEditing ? 'editing' : null });
      v.invitees.forEach((p, i) =>
        box.append(
          h(
            'span.token',
            { class: EMAILISH.test(p) ? null : 'plain' },
            p,
            h('button.token-x', { type: 'button', 'aria-label': `Remove ${p}`, on: { click: () => { v.invitees.splice(i, 1); renderInvitees(); refresh(); } } }, icon('x', 11)),
          ),
        ),
      );
      if (invEditing) {
        const entry = h('input.token-entry', { type: 'text', placeholder: v.invitees.length ? '' : 'Name or email', 'aria-label': 'Add invitee' });
        entry.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && entry.value.trim())) && !e.isComposing) {
            e.preventDefault();
            commitToken();
            renderInvitees();
            invHost.querySelector('.token-entry')?.focus();
          } else if (e.key === 'Backspace' && !entry.value && v.invitees.length) {
            v.invitees.pop();
            renderInvitees();
            refresh();
            invHost.querySelector('.token-entry')?.focus();
          }
        });
        box.append(entry);
        box.addEventListener('click', (e) => e.target === box && entry.focus());
      }
      invHost.append(box);
      if (invEditing) invHost.append(h('p.ef-hint', 'Invitees are saved with the event. Central Calendar doesn’t send invitations.'));
    }
  }
  function commitToken() {
    const entry = invHost.querySelector('.token-entry');
    if (!entry) return;
    const parts = entry.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) if (!v.invitees.includes(p)) v.invitees.push(p);
    entry.value = '';
    if (parts.length) refresh();
  }
  renderInvitees();

  // ---- url + notes
  const urlInput = h('input.text-field', { type: 'url', placeholder: 'URL', 'aria-label': 'URL', value: v.url });
  urlInput.addEventListener('input', () => {
    v.url = urlInput.value;
    refresh();
  });
  const notesInput = h('textarea.text-area', { rows: 1, placeholder: 'Notes', 'aria-label': 'Notes', value: v.notes });
  autoGrow(notesInput);
  notesInput.addEventListener('input', () => {
    v.notes = notesInput.value;
    refresh();
  });
  body.append(h('div.ef-stack.ef-bottom', urlInput, notesInput));

  // ---- footer
  const primary = h('button.btn.btn-primary', { type: 'button', on: { click: () => submit() } }, mode === 'add' ? 'Add' : 'Save');
  const cancel = h('button.btn.btn-secondary', { type: 'button', on: { click: () => onCancel && onCancel() } }, 'Cancel');
  const footer = h('div.ef-footer', { class: mode === 'edit' ? 'three' : null });
  if (mode === 'edit') footer.append(h('button.btn.btn-secondary.destructive', { type: 'button', on: { click: () => onDelete && onDelete() } }, 'Delete'));
  footer.append(cancel, primary);

  function refresh() {
    const valid = isValid();
    errorEl.textContent = valid ? '' : v.allDay ? 'The end date can’t be before the start date.' : 'The event must end after it starts.';
    const dirty = JSON.stringify(values()) !== initialJSON;
    primary.disabled = !valid || (mode === 'edit' && !dirty);
    form.classList.toggle('dirty', dirty);
  }

  function submit() {
    commitToken();
    // flush a time field that's mid-edit
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('time-input') && form.contains(active)) active.dispatchEvent(new Event('change'));
    refresh();
    if (primary.disabled) return;
    onSubmit(values());
  }

  const form = h(`div.event-form${inline ? '.inline' : ''}`, { 'aria-label': mode === 'add' ? 'Add Event' : 'Edit Event' }, header, body, footer);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
    // Keep single-key app shortcuts from firing while working in the form; Escape still closes it.
    if (e.key !== 'Escape') e.stopPropagation();
  });
  form.focusTitle = () => {
    titleInput.focus({ preventScroll: true });
    if (mode === 'add') titleInput.select();
  };
  form.isDirty = () => JSON.stringify(values()) !== initialJSON;
  refresh();
  return form;
}

function autoGrow(ta) {
  let tries = 0;
  const fit = () => {
    // Wait until the textarea is laid out (it is built before the popover attaches it).
    if (!ta.isConnected || !ta.offsetParent) {
      if (tries++ < 20) requestAnimationFrame(fit);
      return;
    }
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 220)}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
}
