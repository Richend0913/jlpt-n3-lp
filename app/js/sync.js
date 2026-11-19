// Account (email + password) and cloud sync of progress, plus file backup (Export / Import).
// Local-first: localStorage stays the source the app reads; the cloud copy is reconciled by
// "newer updatedAt wins". Offline, everything keeps working and syncs when the browser is back online.
(function () {
  'use strict';
  const N3 = window.N3;
  const ACCT_KEY = 'n3tango.account.v1';   // {token, exp, id, email, plan}
  const SYNC_KEY = 'n3tango.sync.v1';      // {owner, syncedAt}
  const DEBOUNCE_MS = 1500;
  const TIMEOUT_MS = 15000;

  // API base: dev override in localStorage ('n3tango.api'), local worker when served from 127.0.0.1 /
  // localhost (wrangler dev), otherwise the production Worker.
  const PROD_API = 'https://jlpt-account.burningbros.workers.dev';
  // Stripe Payment Links (filled in once Stripe is connected; empty = checkout not open yet).
  // Each link carries metadata plan=monthly|yearly; success URL .../app/#/settings?checkout=success
  const PAY_LINKS = { monthly: '', yearly: '' };
  N3.PAY_LINKS = PAY_LINKS;
  function apiBase() {
    let o = null;
    try { o = localStorage.getItem('n3tango.api'); } catch (e) {}
    if (o) return o.replace(/\/+$/, '');
    // Dev Worker only for the plain-http local dev server. Capacitor store builds are served from
    // capacitor://localhost (iOS) / https://localhost (Android) and must use the production Worker.
    const dev = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    return dev ? 'http://127.0.0.1:8787' : PROD_API;
  }

  const readJson = k => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
  const writeJson = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) {} };

  let acct = readJson(ACCT_KEY);
  let meta = readJson(SYNC_KEY) || { owner: null, syncedAt: 0 };
  const saveMeta = () => writeJson(SYNC_KEY, meta);

  const signedIn = () => !!(acct && acct.token && acct.exp * 1000 > Date.now());

  // ---------- status ----------
  // off | pending | syncing | synced | offline | error | expired
  let status = 'off';
  const STATUS_TEXT = {
    off: 'Not signed in — progress is saved on this device only',
    pending: 'Syncing…',
    syncing: 'Syncing…',
    synced: 'Synced',
    offline: 'Offline — saved on this device',
    error: 'Sync failed — saved on this device',
    expired: 'Session expired — log in again to sync',
  };
  function setStatus(s) {
    if (s === status) return;
    status = s;
    if (typeof N3.onSyncStatus === 'function') { try { N3.onSyncStatus(s); } catch (e) {} }
  }

  // ---------- HTTP ----------
  class ApiError extends Error { constructor(code, status, body) { super(code); this.code = code; this.status = status; this.body = body || {}; } }

  async function api(method, path, body, auth) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = 'Bearer ' + acct.token;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(apiBase() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl && ctl.signal, cache: 'no-store' });
    } catch (e) {
      throw new ApiError('network', 0);
    } finally { if (timer) clearTimeout(timer); }
    let j = null;
    try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw new ApiError((j && j.error) || 'http_' + res.status, res.status, j);
    return j || {};
  }

  // ---------- sync ----------
  let inflight = null;      // the running reconcile/push promise
  let again = false;        // a change happened while a request was in flight
  let timer = null;

  function onFailure(e) {
    if (e.code === 'unauthorized') { expire(); return; }
    setStatus(e.code === 'network' ? 'offline' : 'error');
  }
  function expire() {
    if (acct) { acct = { email: acct.email }; writeJson(ACCT_KEY, acct); }
    setStatus('expired');
  }

  function adopt(remote) {
    N3.replaceState(remote.progress, remote.updatedAt);
    meta = { owner: acct.id, syncedAt: remote.updatedAt };
    saveMeta();
    if (typeof N3.onRemoteAdopt === 'function') { try { N3.onRemoteAdopt(); } catch (e) {} }
  }

  async function push() {
    const sentAt = N3.state.updatedAt;
    const progress = Object.assign({}, N3.state);
    delete progress.premium;
    try {
      await api('PUT', '/progress', { progress, updatedAt: sentAt }, true);
      meta = { owner: acct.id, syncedAt: sentAt };
      saveMeta();
    } catch (e) {
      // Another device saved a newer copy: take it (newer wins).
      if (e.code === 'stale') { await pull(true); return; }
      throw e;
    }
  }

  // The server owns Premium: apply its entitlement to the local mirror.
  function applyEntitlement(ent) {
    if (!ent || typeof ent !== 'object') return;
    const plan = ent.active && (ent.plan === 'monthly' || ent.plan === 'yearly') ? ent.plan : null;
    if (acct && acct.plan !== plan) { acct.plan = plan; writeJson(ACCT_KEY, acct); }
    if (N3.setPremium(!!ent.active) && typeof N3.onEntitlement === 'function') { try { N3.onEntitlement(!!ent.active); } catch (e) {} }
  }

  // Session token payload 'sub' = the account's internal id (used as Stripe client_reference_id).
  function userId() {
    if (!signedIn()) return '';
    try {
      const p = acct.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const sub = JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).sub;
      return typeof sub === 'string' ? sub : '';
    } catch (e) { return ''; }
  }

  // GET the cloud copy and reconcile with this device.
  async function pull(forceAdopt) {
    const remote = await api('GET', '/progress', undefined, true);
    applyEntitlement(remote && remote.entitlement);
    const has = remote && remote.progress && typeof remote.updatedAt === 'number';
    if (!has) { await push(); return; }
    if (forceAdopt) { adopt(remote); return; }
    if (meta.owner !== acct.id) {
      // This device's progress was never synced to this account.
      const localWords = Object.keys(N3.state.srs).length;
      if (!localWords || meta.owner) { adopt(remote); return; }   // nothing to keep, or another account's data
      // Anonymous progress on this device vs. an existing cloud copy: let the learner choose.
      const cloudWords = remote.progress.srs ? Object.keys(remote.progress.srs).length : 0;
      const keepLocal = typeof confirm === 'function' && confirm(
        `This device has progress (${N3.plural(localWords, 'word')}) that isn't in your account yet. ` +
        `Your account has ${N3.plural(cloudWords, 'word')} saved.\n\nOK = keep this device's progress (replaces the account copy)\nCancel = use the account's progress`);
      if (keepLocal) { N3.state.updatedAt = Math.max(Date.now(), remote.updatedAt + 1); N3.replaceState(N3.state, N3.state.updatedAt); await push(); }
      else adopt(remote);
      return;
    }
    // Same account: newer copy wins.
    if (remote.updatedAt > N3.state.updatedAt) adopt(remote);
    else if (N3.state.updatedAt > remote.updatedAt) await push();
    else { meta = { owner: acct.id, syncedAt: remote.updatedAt }; saveMeta(); }
  }

  function run(task) {
    if (!signedIn()) { setStatus(acct && acct.email ? 'expired' : 'off'); return Promise.resolve(); }
    if (inflight) { again = true; return inflight; }
    setStatus('syncing');
    inflight = (async () => {
      try {
        await task();
        while (again) { again = false; if (N3.state.updatedAt > meta.syncedAt) await push(); }
        setStatus(N3.state.updatedAt > meta.syncedAt ? 'pending' : 'synced');
        if (status === 'pending') schedule();
      } catch (e) {
        again = false;
        onFailure(e);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(push); }, DEBOUNCE_MS);
  }

  // Called by N3.save() after every local change.
  N3.onLocalChange = () => {
    if (!signedIn()) return;
    if (meta.owner !== acct.id) return;   // not reconciled with this account yet; the next pull handles it
    if (status !== 'offline' && status !== 'error') setStatus('pending');
    schedule();
  };

  // ---------- account ----------
  async function authenticate(path, email, password) {
    const j = await api('POST', path, { email, password });
    acct = { token: j.token, exp: j.exp, id: j.user.id, email: j.user.email };
    writeJson(ACCT_KEY, acct);
    await run(() => pull(false));
    return acct;
  }

  const ERR_TEXT = {
    invalid_email: 'Enter a valid email address.',
    weak_password: 'Use at least 8 characters for your password.',
    email_taken: 'An account with this email already exists — log in instead.',
    invalid_credentials: 'Email or password is incorrect.',
    network: "Can't reach the server. Check your connection and try again.",
  };
  function errorText(e) {
    if (e && e.code === 'too_many_attempts') {
      const m = Math.max(1, Math.ceil((e.body.retryAfter || 60) / 60));
      return `Too many attempts. Try again in ${m} min.`;
    }
    return (e && ERR_TEXT[e.code]) || 'Something went wrong. Please try again.';
  }

  N3.sync = {
    apiBase,
    signedIn,
    email: () => (acct && acct.email) || '',
    userId,
    plan: () => (acct && acct.plan) || null,
    status: () => (signedIn() ? status : acct && acct.email ? 'expired' : 'off'),
    statusText: s => STATUS_TEXT[s || N3.sync.status()] || '',
    errorText,
    signup: (email, password) => authenticate('/auth/signup', email, password),
    login: (email, password) => authenticate('/auth/login', email, password),
    logout() {
      clearTimeout(timer);
      acct = null;
      writeJson(ACCT_KEY, null);
      N3.setPremium(false);   // Premium belongs to the account, not to the device
      setStatus('off');
    },
    syncNow: () => run(() => pull(false)),
  };

  // ---------- backup (no account needed) ----------
  N3.backup = {
    make() {
      const progress = Object.assign({}, N3.state);
      delete progress.premium;
      return { app: 'n3tango', type: 'progress-backup', version: 1, exportedAt: new Date().toISOString(), progress };
    },
    // Returns {state, exportedAt} or throws Error('not_backup').
    parse(text) {
      let j;
      try { j = JSON.parse(text); } catch (e) { throw new Error('not_backup'); }
      const st = j && j.app === 'n3tango' && j.progress ? j.progress : j;
      if (!N3.looksLikeState(st)) throw new Error('not_backup');
      return { state: st, exportedAt: (j && typeof j.exportedAt === 'string' && j.exportedAt) || null };
    },
  };

  // ---------- lifecycle ----------
  window.addEventListener('online', () => { if (signedIn()) run(() => pull(false)); });
  window.addEventListener('offline', () => { if (signedIn()) setStatus('offline'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && signedIn() && timer) { clearTimeout(timer); timer = null; run(push); }   // flush before backgrounding
  });

  if (signedIn()) { setStatus('pending'); setTimeout(() => run(() => pull(false)), 0); }
  else if (acct && acct.email) status = 'expired';
})();
