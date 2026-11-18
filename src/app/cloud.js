// Sign-in (Supabase Auth) and calendar sync (one JSON document per person, merged item by item).
import { store } from './store.js';
import { merge, signature, pickPrefs } from '../lib/sync.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const SESSION_KEY = 'central-calendar.session';
const TABLE = 'calendar_docs';
const listeners = new Set();

export const cloud = {
  configured: !!(SUPABASE_URL && SUPABASE_KEY),
  status: 'signed-out', // signed-out | syncing | synced | offline | error
  error: '',
  user: null,
};

function setStatus(status, error = '') {
  cloud.status = status;
  cloud.error = error;
  for (const fn of listeners) fn(cloud);
}

export function onCloud(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ------------------------------------------------------------------ session
function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: session lasts for this page only */
  }
}
let session = loadSession();

function fromAuthResponse(j) {
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
}

class CloudError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CloudError('You’re offline. Changes are saved on this device and will sync when you reconnect.', 0);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.msg || json?.error_description || json?.message || json?.error || `Request failed (${res.status})`;
    throw new CloudError(friendly(msg), res.status);
  }
  return json;
}

function friendly(msg) {
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you, then sign in.';
  if (/user already registered/i.test(msg)) return 'There’s already an account with that email. Sign in instead.';
  if (/password should be at least/i.test(msg)) return 'Use a password with at least 6 characters.';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  return msg;
}

async function validToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  try {
    const j = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
    session = fromAuthResponse(j);
    saveSession(session);
    return session.access_token;
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      // refresh token revoked or expired: sign out locally
      session = null;
      saveSession(null);
      cloud.user = null;
      setStatus('signed-out', 'Your session expired. Sign in again to keep syncing.');
      return null;
    }
    throw e;
  }
}

const redirectUrl = () => `${location.origin}${location.pathname}`;

// ------------------------------------------------------------------ auth
export async function signUp(email, password) {
  const j = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectUrl())}`, { method: 'POST', body: { email, password } });
  if (j && j.access_token) {
    await startSession(fromAuthResponse(j));
    return { signedIn: true };
  }
  return { signedIn: false, needsConfirmation: true };
}

export async function signIn(email, password) {
  const j = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  await startSession(fromAuthResponse(j));
}

export async function sendPasswordReset(email) {
  await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectUrl())}`, { method: 'POST', body: { email } });
}

export async function updatePassword(password) {
  const token = await validToken();
  await request('/auth/v1/user', { method: 'PUT', body: { password }, token });
}

export async function signOut() {
  const token = session?.access_token;
  session = null;
  saveSession(null);
  cloud.user = null;
  setStatus('signed-out');
  if (token) request('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
}

async function startSession(s) {
  session = s;
  saveSession(s);
  cloud.user = s.user;
  await syncNow();
}

/** After clicking an email link, Supabase sends people back with tokens in the URL hash. */
export async function handleAuthRedirect() {
  if (!location.hash || !/access_token=|error_description=/.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error_description')) return { error: p.get('error_description').replace(/\+/g, ' ') };
  const access = p.get('access_token');
  const user = await request('/auth/v1/user', { token: access });
  await startSession({ access_token: access, refresh_token: p.get('refresh_token'), expires_at: +p.get('expires_at') || Math.floor(Date.now() / 1000) + (+p.get('expires_in') || 3600), user: { id: user.id, email: user.email } });
  return { type: p.get('type') || 'signin' };
}

// ------------------------------------------------------------------ sync
function localDoc(s = store.get()) {
  return { v: 1, calendars: s.data.calendars, events: s.data.events, tombstones: s.data.tombstones || [], prefs: pickPrefs(s.prefs), prefsUpdatedAt: s.prefsUpdatedAt || 0 };
}

let running = null;
let again = false;

/** Pull, merge and push. Safe to call often; overlapping calls are coalesced. */
export function syncNow() {
  if (!cloud.configured || !session) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
      setStatus('synced');
    } catch (e) {
      setStatus(e.status === 0 ? 'offline' : session ? 'error' : 'signed-out', e.message);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce(attempt = 0) {
  const token = await validToken();
  if (!token) return;
  const uid = session.user.id;
  cloud.user = session.user;
  setStatus('syncing');
  const rows = await request(`/rest/v1/${TABLE}?select=doc,version&user_id=eq.${uid}`, { token });
  const row = rows && rows[0];
  const s = store.get();
  const mine = !s.sync.ownerId || s.sync.ownerId === uid;
  // Data on this device that belongs to someone else, or untouched sample data, is not merged into the account.
  const keepLocal = mine && !(row && !s.sync.ownerId && s.seedUntouched);
  const local = localDoc(s);
  const base = keepLocal ? local : { v: 1, calendars: [], events: [], tombstones: [], prefs: local.prefs, prefsUpdatedAt: 0 };
  const merged = row ? merge(base, row.doc) : base;
  if (!merged.calendars.length) merged.calendars = [{ id: crypto.randomUUID(), name: 'Personal', color: '#34aadc', visible: true, updatedAt: Date.now() }];
  if (signature(merged) !== signature(local) || !keepLocal) store.applyRemote(merged);
  const doc = { ...localDoc(), v: 1 };
  if (!row) {
    try {
      await request(`/rest/v1/${TABLE}`, { method: 'POST', token, body: { user_id: uid, doc, version: 1 }, headers: { Prefer: 'return=minimal' } });
      store.setSync({ ownerId: uid, version: 1, lastSyncedAt: Date.now() });
    } catch (e) {
      if (e.status === 409 && attempt < 3) return syncOnce(attempt + 1); // another device created it first
      throw e;
    }
    return;
  }
  if (signature(doc) !== signature(row.doc)) {
    const updated = await request(`/rest/v1/${TABLE}?user_id=eq.${uid}&version=eq.${row.version}`, {
      method: 'PATCH',
      token,
      body: { doc, version: row.version + 1, updated_at: new Date().toISOString() },
      headers: { Prefer: 'return=representation' },
    });
    if (!updated || !updated.length) {
      if (attempt < 3) return syncOnce(attempt + 1); // someone else saved in between: merge again
      throw new Error('Sync kept colliding with another device. Try again in a moment.');
    }
    store.setSync({ ownerId: uid, version: row.version + 1, lastSyncedAt: Date.now() });
  } else {
    store.setSync({ ownerId: uid, version: row.version, lastSyncedAt: Date.now() });
  }
}

let debounce;
export function startCloud() {
  if (!cloud.configured) {
    setStatus('signed-out');
    return;
  }
  if (session) {
    cloud.user = session.user;
    syncNow();
  }
  store.onChange(() => {
    if (!session) return;
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 1200);
  });
  setInterval(() => session && !document.hidden && syncNow(), 60000);
  window.addEventListener('focus', () => session && syncNow());
  window.addEventListener('online', () => session && syncNow());
  document.addEventListener('visibilitychange', () => !document.hidden && session && syncNow());
}

export function signedIn() {
  return !!session;
}
