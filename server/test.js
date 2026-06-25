'use strict';
/* server/test.js — end-to-end test of the licensing & subscription lifecycle.
 * Exercises: account → start trial → offline token verify → trial→active charge,
 * the failed-charge → past_due (blocked) flow, retry after funds fixed, cancel,
 * and signature tamper rejection. Run: node test.js  (after npm run keygen). */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const verifyNode = require('../shared/verify-node');
const entitlement = require('../shared/entitlement');

let pass = 0, fail = 0; const out = [];
function ok(name, cond) { if (cond) { pass++; out.push('  ✓ ' + name); } else { fail++; out.push('  ✗ FAIL: ' + name); } }

const PUB = fs.readFileSync(path.join(__dirname, '..', 'shared', 'license-public.pem'), 'utf8');
process.env.PORT = process.env.PORT || '8799';
process.env.TICK_MS = '999999'; // disable auto tick; we drive charges explicitly
const BASE = `http://localhost:${process.env.PORT}`;
const srv = require('./index');

async function api(method, p, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { code: r.status, json: await r.json() };
}
async function signIn(email) {
  const q = await api('POST', '/v1/auth/request', null, { email });
  const v = await api('POST', '/v1/auth/verify', null, { email: String(email).toLowerCase(), code: q.json.devCode });
  return v.json;
}
// push an account's trial end into the past, directly in the store (simulates time passing)
function expireTrial(email) { const a = srv.store.getAccount(email); a.trialEndsAt = Date.now() - 1000; srv.store.putAccount(a); }

(async () => {
  await new Promise((res) => srv.server.listen(process.env.PORT, res));

  // health/config
  let r = await api('GET', '/v1/health'); ok('health ok + keys present', r.json.ok && r.json.keys);
  r = await api('GET', '/v1/config'); ok('config exposes 3-day trial + price', r.json.trialDays === 3 && r.json.price.rub === 490);

  // ---- passwordless sign-in (email code) ----
  const ar = await api('POST', '/v1/auth/request', null, { email: 'Alice@Example.com' });
  ok('auth/request issues a 6-digit code', ar.json.ok && /^[0-9]{6}$/.test(ar.json.devCode || ''));
  const wrong = ar.json.devCode === '000000' ? '111111' : '000000';
  const badV = await api('POST', '/v1/auth/verify', null, { email: 'alice@example.com', code: wrong });
  ok('wrong code rejected (401)', badV.code === 401);
  const av = await api('POST', '/v1/auth/verify', null, { email: 'alice@example.com', code: ar.json.devCode });
  const tokA = av.json.accountToken; ok('correct code → account token', !!tokA && av.json.email === 'alice@example.com');

  r = await api('GET', '/v1/status', tokA);
  ok('new account is blocked (no card)', r.json.entitlement.blocked === true && r.json.entitlement.reason === 'none');

  r = await api('POST', '/v1/billing/start-trial', tokA, { card: 'tok_ok' });
  ok('trial → access granted', r.json.entitlement.access === true && r.json.entitlement.reason === 'trial');
  ok('trial shows ~3 days left', r.json.entitlement.trialDaysLeft === 3);
  const tokenA = r.json.license;

  // offline token verification (what the DESKTOP app does)
  const payload = verifyNode.verify(tokenA, PUB);
  ok('license token verifies offline (Ed25519)', payload && payload.sub === 'alice@example.com' && payload.status === 'trialing');
  ok('verified token → compute() grants access', entitlement.compute(payload).access === true);

  // tamper: flip one char in the signature → must fail
  const bad = tokenA.slice(0, -3) + (tokenA.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  ok('tampered token rejected', verifyNode.verify(bad, PUB) === null);

  // simulate the trial ending, then the auto-charge succeeds → active
  expireTrial('alice@example.com');
  r = await api('GET', '/v1/status', tokA);
  ok('expired trial before charge → blocked(expired)', r.json.entitlement.blocked === true);
  r = await api('POST', '/v1/billing/retry', tokA); // drives chargeRecurring (mock: success)
  ok('after successful charge → active access', r.json.entitlement.access === true && r.json.entitlement.reason === 'active');

  // ---- failure path: insufficient funds → past_due (blocked) ----
  const tokB = (await signIn('bob@example.com')).accountToken;
  await api('POST', '/v1/billing/start-trial', tokB, { card: 'tok_insufficient' });
  expireTrial('bob@example.com');
  r = await api('POST', '/v1/billing/retry', tokB); // charge fails
  ok('failed charge → past_due', r.json.account.status === 'past_due');
  ok('past_due → blocked + needsPayment (необходимо оплатить)', r.json.entitlement.blocked === true && r.json.entitlement.needsPayment === true);

  // user tops up funds → retry succeeds → active
  await api('POST', '/v1/billing/_fix-funds', tokB);
  r = await api('POST', '/v1/billing/retry', tokB);
  ok('retry after funds fixed → active', r.json.entitlement.access === true);

  // ---- single subscription spans devices: same email, new sign-in (e.g. desktop) ----
  const tokA2 = (await signIn('alice@example.com')).accountToken; // sign in on a 2nd device
  r = await api('GET', '/v1/status', tokA2);
  ok('same account on a 2nd device shares the subscription', r.json.entitlement.access === true);

  // ---- cancel during ACTIVE: keep access until period end, stop renewal ----
  r = await api('POST', '/v1/billing/cancel', tokA2);
  ok('cancel during active keeps access', r.json.account.canceled === true && r.json.entitlement.access === true);

  // ---- cancel during TRIAL: keep trial access; resume; cancelled trial → expired (no charge) ----
  const tokC = (await signIn('carol@example.com')).accountToken;
  await api('POST', '/v1/billing/start-trial', tokC, { card: 'tok_ok' });
  r = await api('POST', '/v1/billing/cancel', tokC);
  ok('cancel during trial keeps trial access', r.json.entitlement.access === true && r.json.entitlement.reason === 'trial' && r.json.entitlement.canceled === true);
  r = await api('POST', '/v1/billing/resume', tokC);
  ok('resume clears cancellation', r.json.account.canceled === false);
  await api('POST', '/v1/billing/cancel', tokC);
  expireTrial('carol@example.com');
  r = await api('POST', '/v1/billing/retry', tokC);
  ok('cancelled trial ends → expired & blocked, NOT past_due', r.json.account.status === 'expired' && r.json.entitlement.blocked === true && r.json.entitlement.needsPayment === false);

  // unauthorized
  r = await api('GET', '/v1/status', 'badtoken'); ok('bad token → 401', r.code === 401);

  // durability: billing state survives a restart (close + reopen the SQLite file)
  r = await api('GET', '/v1/status', tokA); // alice is active from earlier
  srv.store.close();
  srv.store.init(path.join(__dirname, '.data', 'driftly.db'));
  const persisted = srv.store.getAccount('alice@example.com');
  ok('SQLite persists across restart', !!persisted && persisted.status === 'active' && persisted.email === 'alice@example.com');

  console.log(out.join('\n'));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  srv.server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(2); });
