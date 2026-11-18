// Event alerts: checks every 20s, fires a toast + Inbox entry (+ system notification if allowed).
import { store, uid } from '../app/store.js';
import { occurrences, isDone } from '../lib/model.js';
import { addDays, addMinutes, formatTime } from '../lib/dates.js';
import { toast } from './overlays.js';
import * as A from '../app/actions.js';

const LATE_WINDOW = 10 * 60 * 1000; // still fire if we were asleep for up to 10 minutes

export function notificationStatus() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestDesktopNotifications() {
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = await Notification.requestPermission();
  store.setPrefs({ desktopNotifications: p === 'granted' });
  return p;
}

function describeAlert(o, minutesBefore, use24) {
  if (o.allDay) return 'All day';
  if (minutesBefore <= 0) return `Now · ${formatTime(o.start, use24)}`;
  if (minutesBefore < 60) return `In ${minutesBefore} minutes · ${formatTime(o.start, use24)}`;
  if (minutesBefore < 1440) return `In ${minutesBefore / 60} hour${minutesBefore === 60 ? '' : 's'} · ${formatTime(o.start, use24)}`;
  return `${o.start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · ${formatTime(o.start, use24)}`;
}

export function checkAlarms(now = new Date()) {
  const s = store.get();
  const use24 = s.prefs.timeFormat === '24';
  const due = [];
  for (const o of occurrences(s.data, addDays(now, -1), addDays(now, 9))) {
    if (isDone(o)) continue;
    for (const a of o.event.alerts || []) {
      const fireAt = addMinutes(o.start, -a);
      const key = `${o.oid}|${a}`;
      if (fireAt <= now && now - fireAt < LATE_WINDOW && !s.fired[key]) due.push({ o, a, key });
    }
  }
  if (!due.length) return;
  const items = [];
  for (const { o, a, key } of due) {
    store.markFired(key);
    items.push({ id: uid(), eventId: o.eventId, key: o.key, title: o.event.title, start: +o.start, allDay: o.allDay, color: o.calendar.color, firedAt: Date.now(), read: false });
    const when = describeAlert(o, a, use24);
    if (notificationStatus() === 'granted') {
      try {
        const n = new Notification(o.event.title, { body: [when, o.event.location].filter(Boolean).join('\n'), tag: key });
        n.onclick = () => {
          window.focus();
          A.revealOccurrence(o.eventId, o.key);
        };
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    }
  }
  store.setInbox([...items, ...store.get().inbox].slice(0, 100));
  const first = due[0];
  toast(due.length === 1 ? `${first.o.event.title} · ${describeAlert(first.o, first.a, use24)}` : `${due.length} alerts`, {
    action: 'Show',
    onAction: () => A.revealOccurrence(first.o.eventId, first.o.key),
    timeout: 12000,
  });
}

export function startAlarms() {
  checkAlarms();
  setInterval(checkAlarms, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkAlarms();
  });
}
