// Sync helpers: stamp local changes, merge two copies, and fingerprint a document.
// Each calendar/event carries updatedAt (ms). Deletions are kept as tombstones for 90 days.

const TOMBSTONE_TTL = 90 * 86400000;

/** Preferences that follow you between devices (theme and contrast stay per device). */
export const SYNCED_PREFS = ['daysPerWeek', 'weekStart', 'startWithToday', 'hoursDisplayed', 'timeFormat', 'dateOrder', 'dateSep', 'defaultCalendar', 'defaultAlert', 'defaultDuration', 'snapMinutes', 'openEventsIn'];

function stampList(prevList, nextList, kind, now, tombs) {
  const prevById = new Map(prevList.map((x) => [x.id, x]));
  const nextIds = new Set();
  const out = nextList.map((x) => {
    nextIds.add(x.id);
    if (prevById.get(x.id) === x) return x;
    tombs.delete(x.id);
    return { ...x, updatedAt: now };
  });
  for (const x of prevList) if (!nextIds.has(x.id)) tombs.set(x.id, { id: x.id, kind, at: now });
  return out;
}

/** Mark what changed between two versions of { calendars, events, tombstones }. */
export function stamp(prev, next, now = Date.now()) {
  const tombs = new Map((next.tombstones || prev.tombstones || []).map((t) => [t.id, t]));
  const calendars = stampList(prev.calendars, next.calendars, 'calendar', now, tombs);
  const events = stampList(prev.events, next.events, 'event', now, tombs);
  return { ...next, calendars, events, tombstones: [...tombs.values()] };
}

function mergeList(localList, remoteList, tombs) {
  const pick = new Map();
  const order = [];
  for (const x of localList) {
    pick.set(x.id, x);
    order.push(x.id);
  }
  for (const x of remoteList) {
    const cur = pick.get(x.id);
    if (!cur) {
      pick.set(x.id, x);
      order.push(x.id);
    } else if ((x.updatedAt || 0) > (cur.updatedAt || 0) || ((x.updatedAt || 0) === (cur.updatedAt || 0) && JSON.stringify(x) > JSON.stringify(cur))) {
      pick.set(x.id, x);
    }
  }
  return order.map((id) => pick.get(id)).filter((x) => !(tombs.has(x.id) && tombs.get(x.id).at >= (x.updatedAt || 0)));
}

/** Merge two copies. Newest item wins; a deletion wins over anything older than it. */
export function merge(local, remote, now = Date.now()) {
  const tombs = new Map();
  for (const t of [...(local.tombstones || []), ...(remote.tombstones || [])]) {
    if (now - t.at > TOMBSTONE_TTL) continue;
    const cur = tombs.get(t.id);
    if (!cur || t.at > cur.at) tombs.set(t.id, t);
  }
  const calendars = mergeList(local.calendars || [], remote.calendars || [], tombs);
  const events = mergeList(local.events || [], remote.events || [], tombs);
  // A tombstone that lost to a newer edit is no longer needed.
  const live = new Set([...calendars, ...events].map((x) => x.id));
  const tombstones = [...tombs.values()].filter((t) => !live.has(t.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const out = { calendars, events, tombstones };
  const lp = local.prefsUpdatedAt || 0;
  const rp = remote.prefsUpdatedAt || 0;
  if (local.prefs || remote.prefs) {
    const newer = rp > lp || (rp === lp && remote.prefs) ? remote : local;
    out.prefs = pickPrefs(newer.prefs || {});
    out.prefsUpdatedAt = Math.max(lp, rp);
  }
  return out;
}

export function pickPrefs(p) {
  return Object.fromEntries(SYNCED_PREFS.filter((k) => k in p).map((k) => [k, p[k]]));
}

/** Order-independent fingerprint, used to skip uploads that would change nothing. */
export function signature(doc) {
  const items = [...(doc.calendars || []), ...(doc.events || [])].map((x) => `${x.id}:${x.updatedAt || 0}`).sort();
  const tombs = (doc.tombstones || []).map((t) => `${t.id}@${t.at}`).sort();
  return `${items.join(',')}|${tombs.join(',')}|${doc.prefsUpdatedAt || 0}`;
}
