// Account UI: sign in / create account, sync status button, account popover, new-password dialog.
import { h, icon } from './dom.js';
import { openDialog, openPopover, toast } from './overlays.js';
import { cloud, onCloud, signIn, signUp, signOut, syncNow, sendPasswordReset, updatePassword, signedIn } from '../app/cloud.js';
import { store } from '../app/store.js';
import { formatRelative } from '../lib/dates.js';

const STATUS = {
  'signed-out': { icon: 'user', text: 'Not signed in' },
  syncing: { icon: 'refresh', text: 'Syncing…' },
  synced: { icon: 'cloudCheck', text: 'Synced' },
  offline: { icon: 'cloudOff', text: 'Offline' },
  error: { icon: 'cloudAlert', text: 'Sync problem' },
};

function lastSyncedText() {
  const t = store.get().sync.lastSyncedAt;
  return t ? `Last synced ${formatRelative(new Date(t), new Date())}` : 'Not synced yet';
}

/** Toolbar button that shows sync state and opens sign-in or the account popover. */
export function syncButton() {
  const btn = h('button.btn-icon.tb-btn.sync-btn', { type: 'button' });
  const render = () => {
    const st = signedIn() ? cloud.status : 'signed-out';
    const meta = STATUS[st] || STATUS.synced;
    btn.className = `btn-icon tb-btn sync-btn status-${st}`;
    btn.replaceChildren(icon(meta.icon, 19), st === 'signed-out' ? h('span.sync-btn-text', 'Sign In') : null);
    const label = st === 'signed-out' ? 'Sign in to sync' : `${meta.text}${cloud.error && st !== 'synced' ? ': ' + cloud.error : ''}. Account and sync`;
    btn.setAttribute('aria-label', label);
    btn.title = st === 'signed-out' ? 'Sign in to sync between devices' : `${meta.text} · ${cloud.user?.email || ''}`;
  };
  btn.addEventListener('click', () => (signedIn() ? openAccountPopover(btn) : openSignIn()));
  onCloud(render);
  render();
  return btn;
}

export function openAccountPopover(anchor) {
  const st = cloud.status;
  const meta = STATUS[st] || STATUS.synced;
  const email = cloud.user?.email || '';
  let pop;
  const content = h(
    'div.account-pop',
    h('div.acct-head', h('span.acct-avatar', { 'aria-hidden': 'true' }, (email[0] || '?').toUpperCase()), h('div.acct-id', h('div.acct-email', email), h('div.acct-sub', 'Central account'))),
    h('div.acct-status', { class: `status-${st}` }, icon(meta.icon, 16), h('span', st === 'synced' ? lastSyncedText() : st === 'error' || st === 'offline' ? cloud.error || meta.text : meta.text)),
    h('p.acct-note', 'Calendars, events and most settings sync to this account. Theme and contrast stay per device.'),
    h(
      'div.acct-actions',
      h('button.btn.btn-secondary', { type: 'button', on: { click: async () => { pop.close(); await syncNow(); toast(cloud.status === 'synced' ? 'Synced' : cloud.error || 'Sync didn’t finish'); } } }, icon('refresh', 14), 'Sync Now'),
      h('button.btn.btn-secondary.destructive', { type: 'button', on: { click: async () => { pop.close(); await signOut(); toast('Signed out. Your calendar stays on this device.'); } } }, icon('logOut', 14), 'Sign Out'),
    ),
  );
  pop = openPopover({ anchor, content, side: 'below', className: 'acct-popover', label: 'Account' });
}

/** Sign in / create account dialog. */
export function openSignIn(mode = 'signin') {
  if (!cloud.configured) {
    openDialog({
      title: 'Sync isn’t set up yet',
      className: 'small-dialog.signin-dialog',
      content: h('p.signin-lead', 'This copy of Central Calendar isn’t connected to a sync server, so everything stays in this browser. Use Settings › Data › Download Backup to move your calendar for now.'),
    });
    return;
  }
  let current = mode;
  const body = h('div.signin-body');
  const dlg = openDialog({ title: '', className: 'small-dialog.signin-dialog', content: body, labelledBy: 'signin-title' });

  const render = (notice) => {
    const isUp = current === 'signup';
    const email = h('input.text-field.signin-input', { type: 'email', id: 'signin-email', autocomplete: 'email', required: true, placeholder: 'you@example.com', autofocus: true, value: body.dataset.email || '' });
    const pw = h('input.text-field.signin-input', { type: 'password', id: 'signin-password', autocomplete: isUp ? 'new-password' : 'current-password', required: true, minlength: 6, placeholder: isUp ? 'At least 6 characters' : 'Password' });
    const show = h('button.link-btn.show-pw', { type: 'button', 'aria-pressed': 'false', on: { click: () => { const on = pw.type === 'password'; pw.type = on ? 'text' : 'password'; show.textContent = on ? 'Hide' : 'Show'; show.setAttribute('aria-pressed', String(on)); } } }, 'Show');
    const err = h('p.signin-error', { role: 'alert' });
    const submit = h('button.btn.btn-primary.btn-wide', { type: 'submit' }, isUp ? 'Create Account' : 'Sign In');
    const form = h(
      'form.signin-form',
      { novalidate: true },
      h('label.signin-label', { for: 'signin-email' }, 'Email'),
      email,
      h('label.signin-label', { for: 'signin-password' }, 'Password'),
      h('div.pw-wrap', pw, show),
      err,
      h('div.signin-submit', submit),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      body.dataset.email = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return (err.textContent = 'Enter your email address.');
      if (pw.value.length < 6) return (err.textContent = 'Use a password with at least 6 characters.');
      err.textContent = '';
      submit.disabled = true;
      submit.textContent = isUp ? 'Creating…' : 'Signing In…';
      try {
        if (isUp) {
          const r = await signUp(email.value.trim(), pw.value);
          if (r.needsConfirmation) {
            renderConfirm(email.value.trim());
            return;
          }
        } else {
          await signIn(email.value.trim(), pw.value);
        }
        dlg.close('done');
        toast(`Signed in as ${cloud.user?.email}. Your calendar will stay in sync.`);
      } catch (ex) {
        err.textContent = ex.message;
        submit.disabled = false;
        submit.textContent = isUp ? 'Create Account' : 'Sign In';
      }
    });
    body.replaceChildren(
      h('h2.dialog-title', { id: 'signin-title' }, isUp ? 'Create Your Account' : 'Sign In'),
      h('p.signin-lead', 'Sign in to keep the same calendar on your PC, your Mac and your phone. It updates automatically.'),
      notice ? h('p.signin-notice', notice) : null,
      form,
      h(
        'div.signin-links',
        h('button.link-btn', { type: 'button', on: { click: () => { body.dataset.email = email.value.trim(); current = isUp ? 'signin' : 'signup'; render(); } } }, isUp ? 'Have an account? Sign in' : 'New here? Create an account'),
        isUp
          ? null
          : h(
              'button.link-btn',
              {
                type: 'button',
                on: {
                  click: async () => {
                    const v = email.value.trim();
                    if (!/^\S+@\S+\.\S+$/.test(v)) return (err.textContent = 'Type your email above first, then choose Forgot password.');
                    try {
                      await sendPasswordReset(v);
                      body.dataset.email = v;
                      render(`If there’s an account for ${v}, a reset link is on its way. Open it on this device to set a new password.`);
                    } catch (ex) {
                      err.textContent = ex.message;
                    }
                  },
                },
              },
              'Forgot password?',
            ),
      ),
    );
    requestAnimationFrame(() => (email.value ? pw : email).focus());
  };

  const renderConfirm = (email) => {
    body.replaceChildren(
      h('div.signin-confirm', icon('cloudCheck', 34)),
      h('h2.dialog-title', { id: 'signin-title' }, 'Check Your Email'),
      h('p.signin-lead', `We sent a confirmation link to ${email}. Open it to activate your account, then come back and sign in.`),
      h('div.signin-submit', h('button.btn.btn-primary.btn-wide', { type: 'button', on: { click: () => { current = 'signin'; render(); } } }, 'Back to Sign In')),
    );
  };
  render();
}

/** Shown after following a password-reset link. */
export function openNewPassword() {
  const pw = h('input.text-field.signin-input', { type: 'password', autocomplete: 'new-password', minlength: 6, placeholder: 'At least 6 characters', 'aria-label': 'New password', autofocus: true });
  const err = h('p.signin-error', { role: 'alert' });
  const btn = h('button.btn.btn-primary.btn-wide', { type: 'submit' }, 'Save Password');
  const form = h('form.signin-form', pw, err, h('div.signin-submit', btn));
  const dlg = openDialog({ title: 'Set a New Password', className: 'small-dialog.signin-dialog', content: form });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pw.value.length < 6) return (err.textContent = 'Use at least 6 characters.');
    btn.disabled = true;
    try {
      await updatePassword(pw.value);
      dlg.close('done');
      toast('Password updated');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

/** Account section for Settings. */
export function accountSettings(rerender) {
  if (!cloud.configured) return [h('p.set-text', 'This copy isn’t connected to a sync server, so your calendar lives only in this browser.')];
  if (!signedIn()) {
    return [
      h('p.set-text', 'Sign in to keep the same calendar on every device: this PC, your Mac and your phone. Changes sync automatically, and the app still works offline.'),
      h('div.set-actions', h('button.btn.btn-primary', { type: 'button', on: { click: () => openSignIn('signin') } }, 'Sign In'), h('button.btn.btn-secondary', { type: 'button', on: { click: () => openSignIn('signup') } }, 'Create Account')),
    ];
  }
  const meta = STATUS[cloud.status] || STATUS.synced;
  return [
    h('h3.set-section', 'Signed In'),
    h('p.set-text', cloud.user?.email || ''),
    h('div.acct-status', { class: `status-${cloud.status}` }, icon(meta.icon, 16), h('span', cloud.status === 'synced' ? lastSyncedText() : cloud.error || meta.text)),
    h('div.set-actions', h('button.btn.btn-secondary', { type: 'button', on: { click: async () => { await syncNow(); rerender(); } } }, icon('refresh', 14), 'Sync Now'), h('button.btn.btn-secondary.destructive', { type: 'button', on: { click: async () => { await signOut(); rerender(); } } }, 'Sign Out')),
    h('p.set-hint', 'Signing out keeps a copy of your calendar on this device.'),
  ];
}
