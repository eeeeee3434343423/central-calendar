// Popovers, menus, dialogs, alerts and toasts. One stack, Escape closes the top one.
import { h, icon } from './dom.js';

const stack = [];
const root = () => document.getElementById('overlay-root');

function push(entry) {
  stack.push(entry);
  return entry;
}

function remove(entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
}

export function hasOverlay() {
  return stack.length > 0;
}

export function topOverlay() {
  return stack[stack.length - 1] || null;
}

/** Close the top overlay (Escape). Returns true if something closed. */
export function closeTop(reason = 'escape') {
  const top = topOverlay();
  if (!top) return false;
  top.close(reason);
  return true;
}

export function closeAllPopovers(reason = 'replaced') {
  for (const e of [...stack]) if (e.kind === 'popover' || e.kind === 'menu') e.close(reason);
}

// Clicking outside a popover or menu closes it (dialogs use their backdrop).
document.addEventListener(
  'pointerdown',
  (e) => {
    const top = topOverlay();
    if (!top || (top.kind !== 'popover' && top.kind !== 'menu')) return;
    if (top.el.contains(e.target)) return;
    if (top.anchorEl && top.anchorEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.ui-dialog, .ui-alert, .toast')) return;
    lastOutsideClose = Date.now();
    top.close('outside');
  },
  true,
);

let lastOutsideClose = 0;
/** True right after a click outside closed a popover, so that same click doesn't also create something. */
export function justClosedOverlay() {
  return Date.now() - lastOutsideClose < 600;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function placePopover(el, rect, side) {
  const M = 7;
  const A = 11;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W = el.offsetWidth;
  const H = el.offsetHeight;
  const arrow = el.querySelector('.pop-arrow');
  let left;
  let top;
  let dir;
  const fitsRight = rect.right + A + W <= vw - M;
  const fitsLeft = rect.left - A - W >= M;
  if (side !== 'below' && (fitsRight || fitsLeft)) {
    dir = fitsRight ? 'left' : 'right';
    left = fitsRight ? rect.right + A : rect.left - A - W;
    const visTop = Math.max(rect.top, 0);
    const visBottom = Math.min(rect.bottom, vh);
    const cy = visTop + Math.min((visBottom - visTop) / 2, 60);
    top = clamp(cy - Math.min(H / 2, 80), M, vh - H - M);
    if (arrow) arrow.style.top = `${clamp(cy - top - 8, 14, H - 30)}px`;
  } else {
    const cx = rect.left + rect.width / 2;
    left = clamp(cx - W / 2, M, vw - W - M);
    if (rect.bottom + A + H <= vh - M || rect.top - A - H < M) {
      dir = 'up';
      top = clamp(rect.bottom + A, M, vh - H - M);
    } else {
      dir = 'down';
      top = rect.top - A - H;
    }
    if (arrow) arrow.style.left = `${clamp(cx - left - 8, 14, W - 30)}px`;
  }
  el.dataset.arrow = dir;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

/**
 * openPopover({ anchor: Element | DOMRect, content, side: 'auto'|'below', onClose(reason), className, arrow })
 * Returns { el, close(reason), reposition() }.
 */
export function openPopover({ anchor, content, side = 'auto', onClose, className = '', arrow = true, kind = 'popover', label }) {
  closeAllPopovers('replaced');
  const anchorEl = anchor instanceof Element ? anchor : null;
  const el = h(`div.ui-popover${className ? '.' + className : ''}`, { role: kind === 'menu' ? 'menu' : 'dialog', 'aria-label': label || null }, arrow ? h('div.pop-arrow') : null, h('div.pop-content', content));
  root().append(el);
  let closed = false;
  const rectOf = () => (anchorEl && anchorEl.isConnected ? anchorEl.getBoundingClientRect() : anchor instanceof Element ? anchor.getBoundingClientRect() : anchor);
  const entry = push({
    kind,
    el,
    anchorEl,
    close(reason = 'close') {
      if (closed) return;
      closed = true;
      remove(entry);
      el.classList.add('closing');
      setTimeout(() => el.remove(), 160);
      onClose && onClose(reason);
    },
    reposition() {
      placePopover(el, rectOf(), side);
    },
  });
  placePopover(el, rectOf(), side);
  el.classList.add('opening');
  return entry;
}

/** items: [{ label, icon, onSelect, destructive, disabled, checked } | 'divider'] */
export function openMenu(anchor, items, { side = 'below', label = 'Menu', onClose } = {}) {
  let entry;
  const list = h('div.ui-menu');
  const buttons = [];
  for (const it of items) {
    if (it === 'divider') {
      list.append(h('div.menu-divider', { role: 'separator' }));
      continue;
    }
    const b = h(
      'button.menu-item',
      {
        type: 'button',
        role: 'menuitem',
        disabled: !!it.disabled,
        class: it.destructive ? 'destructive' : null,
        on: {
          click: () => {
            b.classList.add('chosen');
            setTimeout(() => {
              entry.close('select');
              it.onSelect && it.onSelect();
            }, 90);
          },
        },
      },
      h('span.menu-icon', it.icon ? icon(it.icon, 16) : it.checked ? icon('check', 15) : null),
      h('span.menu-label', it.label),
      it.hint ? h('span.menu-hint', it.hint) : null,
    );
    buttons.push(b);
    list.append(b);
  }
  list.addEventListener('keydown', (e) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      enabled[(i + 1) % enabled.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      enabled[(i - 1 + enabled.length) % enabled.length]?.focus();
    }
  });
  entry = openPopover({ anchor, content: list, side, className: 'menu-pop', kind: 'menu', label, onClose });
  buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  return entry;
}

/** A modal dialog with backdrop. Returns { el, close }. */
export function openDialog({ title, content, footer, className = '', onClose, closeButton = true, labelledBy }) {
  // Menus close; an open editor popover stays underneath (e.g. Custom Repeat, repeating-event prompts).
  for (const e of [...stack]) if (e.kind === 'menu') e.close('replaced');
  const opener = document.activeElement;
  const backdrop = h('div.ui-backdrop');
  const titleId = labelledBy || `dlg-${Math.random().toString(36).slice(2, 8)}`;
  let entry;
  const panel = h(
    `div.ui-dialog${className ? '.' + className : ''}`,
    { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    closeButton ? h('button.btn-icon.dialog-close', { type: 'button', 'aria-label': 'Close', title: 'Close', on: { click: () => entry.close('close') } }, icon('x', 18)) : null,
    title ? h('h2.dialog-title', { id: titleId }, title) : null,
    h('div.dialog-body', content),
    footer ? h('div.dialog-footer', footer) : null,
  );
  const wrap = h('div.ui-dialog-wrap', backdrop, panel);
  backdrop.addEventListener('click', () => entry.close('backdrop'));
  root().append(wrap);
  let closed = false;
  entry = push({
    kind: 'dialog',
    el: wrap,
    close(reason = 'close') {
      if (closed) return;
      closed = true;
      remove(entry);
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 180);
      onClose && onClose(reason);
      if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
    },
  });
  trapFocus(panel);
  requestAnimationFrame(() => {
    const first = panel.querySelector('[autofocus]') || panel.querySelector('input, select, textarea, button:not(.dialog-close)');
    first && first.focus();
  });
  return entry;
}

function trapFocus(panel) {
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

/**
 * Alert with stacked or side-by-side buttons. buttons: [{ label, value, primary, destructive }]
 * Resolves with the chosen value, or null on Escape.
 */
export function alertDialog({ title, body, buttons, iconName = 'calendar' }) {
  return new Promise((resolve) => {
    let entry;
    let result = null;
    const stacked = buttons.length > 2 || buttons.some((b) => b.label.length > 14);
    const row = h(
      `div.alert-buttons${stacked ? '.stacked' : ''}`,
      buttons.map((b) =>
        h(
          `button.btn.btn-lg${b.primary ? '.btn-primary' : '.btn-secondary'}${b.destructive ? '.destructive' : ''}`,
          { type: 'button', autofocus: !!b.primary, on: { click: () => { result = b.value; entry.close('select'); } } },
          b.label,
        ),
      ),
    );
    entry = openDialog({
      className: 'ui-alert',
      closeButton: false,
      content: [h('div.alert-icon', icon(iconName, 30)), h('h2.alert-title', { id: 'alert-title' }, title), body ? h('p.alert-body', body) : null, row],
      labelledBy: 'alert-title',
      onClose: () => resolve(result),
    });
  });
}

let toastTimer;
/** toast('Event deleted', { action: 'Undo', onAction }) */
export function toast(message, { action, onAction, timeout = 5000 } = {}) {
  const host = document.getElementById('toast-root');
  host.replaceChildren();
  const t = h(
    'div.toast',
    { role: 'status' },
    h('span', message),
    action
      ? h('button.toast-action', { type: 'button', on: { click: () => { t.remove(); onAction && onAction(); } } }, action)
      : null,
    h('button.btn-icon.toast-close', { type: 'button', 'aria-label': 'Dismiss', on: { click: () => t.remove() } }, icon('x', 14)),
  );
  host.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), timeout);
}
