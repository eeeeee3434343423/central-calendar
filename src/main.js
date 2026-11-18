// Central Calendar: entry point. Wires the store to the shell, sidebar and views.
import { store } from './app/store.js';
import { dateKey } from './lib/dates.js';
import { mountChrome, updateChrome } from './ui/header.js';
import { renderSidebar } from './ui/sidebar.js';
import { renderView } from './ui/views.js';
import { tickNow } from './ui/timegrid.js';
import { startAlarms } from './ui/alarms.js';
import { bindKeyboard } from './ui/keyboard.js';
import { startCloud, handleAuthRedirect } from './app/cloud.js';
import { openNewPassword } from './ui/account.js';
import { toast } from './ui/overlays.js';

const root = document.getElementById('app');
const els = mountChrome(root);
let lastDay = dateKey(new Date());
let lastSaveErr = null;

const moreContrastOS = window.matchMedia('(prefers-contrast: more)');
function applyTheme(theme, contrast) {
  const html = document.documentElement;
  if (theme === 'light' || theme === 'dark') html.dataset.theme = theme;
  else delete html.dataset.theme;
  if (contrast === 'more' || moreContrastOS.matches) html.dataset.contrast = 'more';
  else delete html.dataset.contrast;
}

/** Remember what had focus so a re-render doesn't drop keyboard users back to <body>. */
function focusToken(host) {
  const a = document.activeElement;
  if (!a || !host.contains(a) || a === host) return null;
  if (a.dataset && a.dataset.oid) return { oid: a.dataset.oid };
  if (a.dataset && a.dataset.date) return { date: a.dataset.date, tag: a.tagName };
  const label = a.getAttribute('aria-label');
  return { tag: a.tagName, label, text: label ? null : a.textContent };
}

function restoreFocus(host, tok) {
  if (!tok || (document.activeElement && document.activeElement !== document.body)) return;
  let el = null;
  if (tok.oid) el = host.querySelector(`[data-oid="${CSS.escape(tok.oid)}"]`);
  else if (tok.date) el = host.querySelector(`${tok.tag}[data-date="${tok.date}"]`);
  else el = [...host.querySelectorAll(tok.tag)].find((x) => (tok.label ? x.getAttribute('aria-label') === tok.label : x.textContent === tok.text));
  if (el) el.focus({ preventScroll: true });
}

function render() {
  const s = store.get();
  applyTheme(s.prefs.theme, s.prefs.contrast);
  updateChrome(s);
  const sbTok = focusToken(els.sidebar);
  const viewTok = focusToken(els.viewBody);
  renderSidebar(els.sidebar, s);
  renderView(els.viewBody, s);
  restoreFocus(els.sidebar, sbTok);
  restoreFocus(els.viewBody, viewTok);
  lastDay = dateKey(new Date());
  const err = store.saveError();
  if (err && err !== lastSaveErr) toast('Couldn’t save changes in this browser (storage is full or blocked). Export a backup from Settings › Data.', { timeout: 10000 });
  lastSaveErr = err;
}

store.subscribe(render);
render();

// Keep layout in sync with the window.
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

// Move the now line every 30s; re-render when the day rolls over.
setInterval(() => {
  if (dateKey(new Date()) !== lastDay) render();
  else tickNow(store.get().prefs.timeFormat === '24');
}, 30000);

// Another tab changed the data.
window.addEventListener('storage', (e) => {
  if (e.key === store.key) store.reloadFromStorage();
});

// Follow the OS theme when set to "Match System".
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());

bindKeyboard();
startAlarms();
startCloud();
handleAuthRedirect()
  .then((r) => {
    if (!r) return;
    if (r.error) toast(r.error, { timeout: 10000 });
    else if (r.type === 'recovery') openNewPassword();
    else toast('Email confirmed. You’re signed in and syncing.');
  })
  .catch((e) => toast(e.message || 'Sign-in link didn’t work. Try signing in again.'));

// Make the app usable from a phone-sized screen by defaulting to Day view the first time.
if (window.innerWidth < 600 && matchMedia('(pointer: coarse)').matches && !localStorage.getItem('central-calendar.seen')) store.setUI({ view: 'day' });
try {
  localStorage.setItem('central-calendar.seen', '1');
} catch {
  /* private mode */
}

document.getElementById('boot')?.remove();
