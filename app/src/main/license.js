'use strict';
/* license.js — desktop subscription/entitlement client.
 *
 * Talks to the Driftly licensing server, caches the signed license token locally,
 * and VERIFIES it offline with the embedded Ed25519 public key (tamper-resistant,
 * works without a connection within the offline-grace window). Computes the same
 * entitlement the web app uses, so one subscription unlocks both.
 *
 * The licensing server is fixed to https://api.driftly.site (same as the web app) —
 * there is no user-visible setting. DRIFTLY_LICENSE_API env var overrides it for dev. */

const fs = require('fs');
const path = require('path');
const verify = require('../shared/verify-node');
const entitlement = require('../shared/entitlement');

const PUB = fs.readFileSync(path.join(__dirname, '..', 'shared', 'license-public.pem'), 'utf8');

let store = null;
const state = { token: null, license: null, account: null, online: false, lastError: null };

// The deployed licensing server — same default as the web client, so the installed app
// works out of the box (no user-visible "licensing server" setting). Env var = dev override.
const DEFAULT_API = 'https://api.driftly.site';

function init(s) {
  store = s;
  const a = (store.getConfig().account) || {};
  state.token = a.token || null;
  state.license = a.license || null;
}
function persist() { if (store) store.patchConfig({ account: { token: state.token, license: state.license } }); }

function apiBase() { return process.env.DRIFTLY_LICENSE_API || DEFAULT_API; }
function isPreview() { return !apiBase(); }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token }; }

function currentEntitlement() {
  if (isPreview()) {
    return { plan: 'preview', status: 'preview', access: true, blocked: false, isPro: true, needsPayment: false, reason: 'preview', preview: true, features: entitlement.FEATURES.slice(), trialDaysLeft: 0, account: null, renewsAt: null };
  }
  const payload = state.license ? verify.verify(state.license, PUB) : null;
  return entitlement.compute(payload);
}

function info() {
  return {
    api: apiBase(), preview: isPreview(), online: state.online, lastError: state.lastError,
    signedIn: !!state.token, entitlement: currentEntitlement(), account: state.account || null,
  };
}

async function call(method, p, body) {
  const res = await fetch(apiBase() + p, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
  const j = await res.json();
  if (j && j.account) state.account = j.account; // keep info().account fresh on billing calls
  return j;
}

async function refresh() {
  if (isPreview() || !state.token) return info();
  try {
    const r = await fetch(apiBase() + '/v1/status', { headers: authHeaders() });
    const j = await r.json();
    if (j && j.license) { state.license = j.license; persist(); }
    if (j && j.account) state.account = j.account;
    state.online = true; state.lastError = null;
  } catch (e) { state.online = false; state.lastError = String(e && e.message || e); }
  return info();
}

// Passwordless sign-in: request a code by email, then verify it. This proves the
// user owns the email before unlocking the subscription, so signing in on another
// device is secure and one account = one subscription across web + desktop.
async function authRequest(email) {
  if (isPreview()) return { ok: false, error: 'no_api' };
  try {
    const r = await fetch(apiBase() + '/v1/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    return await r.json();
  } catch (e) { state.online = false; state.lastError = String(e); return { ok: false, error: 'offline' }; }
}
async function authVerify(email, code) {
  if (isPreview()) return { ok: false, error: 'no_api' };
  try {
    const r = await fetch(apiBase() + '/v1/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
    const j = await r.json();
    if (j.accountToken) { state.token = j.accountToken; persist(); await refresh(); return { ok: true, email: j.email }; }
    return { ok: false, error: j.error || 'failed' };
  } catch (e) { state.online = false; state.lastError = String(e); return { ok: false, error: 'offline' }; }
}

async function startTrial(card, interval) { if (isPreview() || !state.token) return { ok: false, error: 'no_account' }; const j = await call('POST', '/v1/billing/start-trial', { card: card || 'tok_ok', interval: interval === 'year' ? 'year' : 'month' }); if (j.license) { state.license = j.license; persist(); } return j; }
// Poll target after the browser payment: activates a pending signup server-side.
async function confirmCard() { if (isPreview() || !state.token) return info(); const j = await call('POST', '/v1/billing/confirm-card'); if (j.license) { state.license = j.license; persist(); } return info(); }
// (Re)bind or change the saved card — returns the T-Bank form URL to open.
async function attachCard() { if (isPreview() || !state.token) return { ok: false, error: 'no_account' }; const j = await call('POST', '/v1/billing/attach-card'); if (j.license) { state.license = j.license; persist(); } return j; }
// Switch monthly/yearly — applies from the next charge.
async function changeInterval(interval) { if (isPreview() || !state.token) return { ok: false, error: 'no_account' }; const j = await call('POST', '/v1/billing/interval', { interval: interval === 'year' ? 'year' : 'month' }); if (j.license) { state.license = j.license; persist(); } return j; }
async function retry() { if (isPreview() || !state.token) return { ok: false }; const j = await call('POST', '/v1/billing/retry'); if (j.license) { state.license = j.license; persist(); } return j; }
async function cancel() { if (isPreview() || !state.token) return { ok: false }; const j = await call('POST', '/v1/billing/cancel'); if (j.license) { state.license = j.license; persist(); } return j; }
async function resume() { if (isPreview() || !state.token) return { ok: false }; const j = await call('POST', '/v1/billing/resume'); if (j.license) { state.license = j.license; persist(); } return j; }

function signOut() {
  const tok = state.token;
  state.token = null; state.license = null; state.account = null; persist();
  // Best-effort: tell the server to drop this device token so its seat frees up.
  if (tok && !isPreview()) {
    try { fetch(apiBase() + '/v1/auth/signout', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }).catch(() => {}); } catch (_) { /* noop */ }
  }
  return info();
}

module.exports = { init, info, refresh, authRequest, authVerify, startTrial, confirmCard, attachCard, changeInterval, retry, cancel, resume, signOut, currentEntitlement, isPreview };
