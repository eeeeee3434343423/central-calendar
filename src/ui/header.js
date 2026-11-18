// App toolbar (brand, inbox bell, settings) and the main header (title, view switcher, search, navigation).
import { h, icon, iconButton } from './dom.js';
import { store } from '../app/store.js';
import * as A from '../app/actions.js';
import { segmented } from './controls.js';
import { MONTHS, MONTHS_SHORT, addDays } from '../lib/dates.js';
import { openSettings } from './settings.js';
import { openInbox } from './sidebar.js';
import { syncButton } from './account.js';
import { openQuickAdd } from './quickaddui.js';

/** Sidebar button: a drawer on narrow screens, show/hide on wide ones. */
export function toggleSidebar() {
  if (window.matchMedia('(max-width: 1023px)').matches) store.setUI({ drawer: !store.get().ui.drawer });
  else store.setPrefs({ sidebarCollapsed: !store.get().prefs.sidebarCollapsed });
}

let els = null;

export function mountChrome(root) {
  // ---- toolbar
  const bellBadge = h('span.badge', { hidden: true, 'aria-hidden': 'true' });
  const bell = iconButton('bell', 'Alerts and inbox', () => openInbox(), { cls: 'tb-btn', size: 19 });
  const drawerBtn = iconButton('panelLeft', 'Show or hide calendars ([)', () => toggleSidebar(), { cls: 'tb-btn drawer-btn', size: 19 });
  const toolbar = h(
    'header.toolbar',
    drawerBtn,
    h(
      'div.brand',
      { 'aria-label': 'Central Calendar' },
      h('span.brand-mark', { 'aria-hidden': 'true' }, h('span.brand-mark-top'), h('span.brand-mark-num', String(new Date().getDate()))),
      h('span.brand-central', 'Central'),
      h('span.brand-app', 'Calendar'),
    ),
    h(
      'div.tb-actions',
      syncButton(),
      h('span.badge-wrap', bell, bellBadge),
      iconButton('keyboard', 'Keyboard shortcuts (?)', () => import('./dialogs.js').then((m) => m.openShortcuts()), { cls: 'tb-btn', size: 19 }),
      iconButton('gear', 'Settings', () => openSettings(), { cls: 'tb-btn', size: 19 }),
    ),
  );

  // ---- main header
  const titleMain = h('span.title-main');
  const titleSub = h('span.title-sub');
  const title = h('h1.view-title', { 'aria-live': 'polite' }, titleMain, titleSub);
  const seg = segmented({
    label: 'View',
    segments: [
      { value: 'day', label: 'Day', title: 'Day (D)' },
      { value: 'week', label: 'Week', title: 'Week (W)' },
      { value: 'month', label: 'Month', title: 'Month (M)' },
      { value: 'year', label: 'Year', title: 'Year (Y)' },
    ],
    value: store.get().ui.view,
    onChange: (v) => A.setView(v),
  });
  const searchInput = h('input.search-input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search events', autocomplete: 'off', spellcheck: 'false' });
  const clearBtn = h('button.search-clear', { type: 'button', 'aria-label': 'Clear search', hidden: true, on: { click: () => { searchInput.value = ''; store.setUI({ search: '' }); searchInput.focus(); } } }, icon('xCircle', 15));
  searchInput.addEventListener('input', () => {
    store.setUI({ search: searchInput.value, ...(searchInput.value ? { drawer: true } : {}) });
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      searchInput.value = '';
      store.setUI({ search: '' });
      searchInput.blur();
    }
    if (e.key === 'Enter') {
      const first = document.querySelector('.result-row');
      if (first) first.click();
    }
  });
  const search = h('div.search-field', { role: 'search' }, h('span.search-icon', icon('search', 14)), searchInput, clearBtn);
  const nav = h(
    'div.nav-group',
    h(
      'div.nav-cluster',
      iconButton('chevronLeft', 'Previous', () => A.step(-1), { cls: 'red nav-btn', size: 18 }),
      h('button.btn-text.today-btn', { type: 'button', on: { click: () => A.goToday() }, title: 'Today (T)' }, 'Today'),
      iconButton('chevronRight', 'Next', () => A.step(1), { cls: 'red nav-btn', size: 18 }),
    ),
    h(
      'div.add-cluster',
      iconButton('zap', 'Quick add blocks (Q)', (e) => openQuickAdd(e.currentTarget), { cls: 'red hdr-quick', size: 18 }),
      iconButton('plus', 'New event (N)', (e) => A.newEventFromToolbar(e.currentTarget), { cls: 'red hdr-add', size: 19 }),
    ),
  );
  const mainHeader = h('div.main-header', h('div.title-block', title), h('div.seg-wrap', seg), h('div.header-right', search, nav));

  const sidebar = h('aside.sidebar', { 'aria-label': 'Calendars' });
  const scrim = h('div.drawer-scrim', { on: { click: () => store.setUI({ drawer: false }) } });
  const viewBody = h('main.view-body', { id: 'view-body', tabIndex: -1, 'aria-label': 'Calendar' });
  const main = h('section.main', mainHeader, h('div.banner-host'), viewBody);
  const shell = h('div.shell', sidebar, scrim, main);
  root.replaceChildren(toolbar, shell);

  els = { bellBadge, bell, drawerBtn, titleMain, titleSub, seg, search, searchInput, clearBtn, sidebar, viewBody, shell };
  return els;
}

function titleFor(s) {
  const c = s.ui.cursor;
  const view = s.ui.view;
  if (view === 'year') return [String(c.getFullYear()), ''];
  if (view === 'week') {
    const r = A.currentRange(s);
    const last = addDays(r.end, -1);
    if (r.start.getMonth() === last.getMonth()) return [MONTHS[r.start.getMonth()], String(r.start.getFullYear())];
    if (r.start.getFullYear() === last.getFullYear()) return [`${MONTHS_SHORT[r.start.getMonth()]} – ${MONTHS_SHORT[last.getMonth()]}`, String(last.getFullYear())];
    return [`${MONTHS_SHORT[r.start.getMonth()]} ${r.start.getFullYear()} – ${MONTHS_SHORT[last.getMonth()]}`, String(last.getFullYear())];
  }
  return [MONTHS[c.getMonth()], String(c.getFullYear())];
}

export function updateChrome(s) {
  if (!els) return;
  const [main, sub] = titleFor(s);
  els.titleMain.textContent = main;
  els.titleSub.textContent = sub;
  els.seg.setValue(s.ui.view);
  if (els.searchInput.value !== s.ui.search && document.activeElement !== els.searchInput) els.searchInput.value = s.ui.search;
  els.clearBtn.hidden = !s.ui.search;
  els.search.classList.toggle('has-value', !!s.ui.search);
  const unread = s.inbox.filter((n) => !n.read).length;
  els.bellBadge.hidden = !unread;
  els.bellBadge.textContent = String(unread);
  els.bell.classList.toggle('has-alerts', unread > 0);
  els.bell.setAttribute('aria-label', unread ? `Alerts and inbox, ${unread} new` : 'Alerts and inbox');
  els.shell.classList.toggle('drawer-open', !!s.ui.drawer);
  const wide = !window.matchMedia('(max-width: 1023px)').matches;
  els.shell.classList.toggle('sidebar-collapsed', wide && !!s.prefs.sidebarCollapsed);
  els.drawerBtn.setAttribute('aria-expanded', String(wide ? !s.prefs.sidebarCollapsed : !!s.ui.drawer));
  document.title = `${main}${sub ? ' ' + sub : ''} · Central Calendar`;
}

export function focusSearch() {
  if (!els) return;
  els.searchInput.focus();
  els.searchInput.select();
}

export function chrome() {
  return els;
}
