// Global keyboard shortcuts (see dialogs.js SHORTCUTS for the help sheet).
import { store } from '../app/store.js';
import * as A from '../app/actions.js';
import { closeTop, hasOverlay } from './overlays.js';
import { isTyping } from './dom.js';
import { focusSearch } from './header.js';
import { openSettings } from './settings.js';
import { openShortcuts } from './dialogs.js';
import { goToDateDialog } from './sidebar.js';
import { toggleSidebar } from './header.js';
import { openQuickAdd } from './quickaddui.js';

const VIEWS = { d: 'day', w: 'week', m: 'month', y: 'year', 1: 'day', 2: 'week', 3: 'month', 4: 'year' };

function editSelected(view = false) {
  const occs = A.selectedOccurrences();
  if (occs.length !== 1) return false;
  const el = document.querySelector(`[data-oid="${CSS.escape(occs[0].oid)}"]`);
  if (view) A.openEvent(occs[0], el);
  else A.openEdit(occs[0], el);
  return true;
}

export function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    const s = store.get();
    if (e.key === 'Escape') {
      if (closeTop()) {
        e.preventDefault();
        return;
      }
      if (s.ui.search) store.setUI({ search: '' });
      else if (s.ui.drawer) store.setUI({ drawer: false });
      else if (s.ui.editingCalendar) store.setUI({ editingCalendar: null });
      else A.clearSelection();
      return;
    }
    if (hasOverlay()) return;
    const mod = e.metaKey || e.ctrlKey;
    const typing = isTyping(e.target);
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (mod && k === 'f') {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (typing) return;
    if (mod && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      A.undo();
      return;
    }
    if (mod && k === ',') {
      e.preventDefault();
      openSettings();
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && ['1', '2', '3', '4'].includes(k)) {
      e.preventDefault();
      A.setView(VIEWS[k]);
      return;
    }
    if (mod && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault();
      A.step(k === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (mod && k === 'e') {
      e.preventDefault();
      editSelected();
      return;
    }
    if (mod && k === 'a') {
      e.preventDefault();
      A.selectAllVisible();
      return;
    }
    if (mod && e.shiftKey && k === 'p') {
      e.preventDefault();
      store.reloadFromStorage();
      return;
    }
    if (mod || e.altKey) return;

    const onButton = e.target.closest && e.target.closest('button, a, [role="button"], [role="radio"], input, select');
    switch (k) {
      case 'd':
      case 'w':
      case 'm':
      case 'y':
        A.setView(VIEWS[k]);
        break;
      case 't':
        A.goToday();
        break;
      case 'n':
        e.preventDefault();
        A.newEventFromToolbar(null);
        break;
      case 'q':
        e.preventDefault();
        openQuickAdd(document.querySelector('.hdr-quick'));
        break;
      case '\\':
        e.preventDefault();
        store.setPrefs({ dayPanelCollapsed: !s.prefs.dayPanelCollapsed });
        break;
      case '[':
        e.preventDefault();
        toggleSidebar();
        break;
      case 'g':
        e.preventDefault();
        goToDateDialog();
        break;
      case '?':
        openShortcuts();
        break;
      case '/':
        e.preventDefault();
        focusSearch();
        break;
      case 'Enter':
        if (onButton) return;
        if (editSelected(true)) e.preventDefault();
        break;
      case 'Backspace':
      case 'Delete':
        if (s.ui.selection.length) {
          e.preventDefault();
          A.deleteSelected();
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (onButton && !e.target.closest('[data-oid]')) return;
        const dir = k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1;
        if (s.ui.selection.length) {
          e.preventDefault();
          A.moveSelection(dir, e.shiftKey);
        } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
          e.preventDefault();
          A.step(dir);
        }
        break;
      }
      default:
    }
  });
}
