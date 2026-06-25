'use strict';
/* license.js — desktop subscription/entitlement client.
 *
 * Talks to the Driftly licensing server, caches the signed license token locally,
 * and VERIFIES it offline with the embedded Ed25519 public key (tamper-resistant,
 * works without a connection within the offline-grace window). Computes the same
 * entitlement the web app uses, so one subscription unlocks both.
 *
 * If no licensing API is configured (DRIFTLY_LICENSE_API / settings), the app runs
 * in PREVIEW mode (full access + a visible banner) so it is usable before the
 * server is deployed. Set the API and the real trial/paywall/past_due gating
 * activates immediately. */

const fs = require('fs');
const path = require('path');
const verify = require('../shared/verify-node');
const entitlement = require('../shared/entitlement');

const PUB = fs.readFileSync(path.join(__dirname, '..', 'shared', 'license-public.pem'), 'utf8');

let store = null;
const state = { api: '', token: null, license: null, online: false, lastError: null };

function init(s) {
  store = s;
  const a = (store.getConfig().account) || {};
  state.api = a.api || '';
  state.token = a.token || null;
  state.license = a.license || null;
}
function persist() { if (store) store.patchConfig({ account: { api: state.api, token: state.token, license: state.license } }); }

function apiBase() { return process.env.DRIFTLY_LICENSE_API || state.api || ''; }
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
    signedIn: !!state.token, entitlement: currentEntitlement(),
  };
}

async function call(method, p, body) {
  const res = await fetch(apiBase() + p, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function refresh() {
  if (isPreview() || !state.token) return info();
  try {
    const r = await fetch(apiBase() + '/v1/status', { headers: authHeaders() });
    const j = await r.json();
    if (j && j.license) { state.license = j.license; persist(); }
    state.online = true; state.lastError = null;
  } catch (e) { state.online = false; state.lastError = String(e && e.message || e); }
  return info();
}

async function signIn(email) {
  if (isPreview()) return { ok: false, error: 'no_api' };
  try {
    const r = await fetch(apiBase() + '/v1/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const j = await r.json();
    if (j.accountToken) { state.token = j.accountToken; persist(); await refresh(); return { ok: true, email: j.email }; }
    return { ok: false, error: j.error || 'failed' };
  } catch (e) { state.online = false; state.lastError = String(e); return { ok: false, error: 'offline' }; }
}

async function startTrial(card) { if (isPreview() || !state.token) return { ok: false, error: 'no_account' }; const j = await call('POST', '/v1/billing/start-trial', { card: card || 'tok_ok' }); if (j.license) { state.license = j.license; persist(); } return j; }
async function retry() { if (isPreview() || !state.token) return { ok: false }; const j = await call('POST', '/v1/billing/retry'); if (j.license) { state.license = j.license; persist(); } return j; }
async function cancel() { if (isPreview() || !state.token) return { ok: false }; const j = await call('POST', '/v1/billing/cancel'); if (j.license) { state.license = j.license; persist(); } return j; }

function setApi(url) { state.api = (url || '').trim().replace(/\/$/, ''); persist(); return refresh(); }
function signOut() { state.token = null; state.license = null; persist(); return info(); }

module.exports = { init, info, refresh, signIn, startTrial, retry, cancel, setApi, signOut, currentEntitlement, isPreview };
