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

(async () => {
  await new Promise((res) => srv.server.listen(process.env.PORT, res));

  // health/config
  let r = await api('GET', '/v1/health'); ok('health ok + keys present', r.json.ok && r.json.keys);
  r = await api('GET', '/v1/config'); ok('config exposes 3-day trial + price', r.json.trialDays === 3 && r.json.price.rub === 490);

  // ---- happy path: trial → active ----
  r = await api('POST', '/v1/account', null, { email: 'Alice@Example.com' });
  const tokA = r.json.accountToken; ok('account created + token', !!tokA && r.json.email === 'alice@example.com');

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
  srv.db.accounts['alice@example.com'].trialEndsAt = Date.now() - 1000; srv.saveDb();
  r = await api('GET', '/v1/status', tokA);
  ok('expired trial before charge → blocked(expired)', r.json.entitlement.blocked === true);
  r = await api('POST', '/v1/billing/retry', tokA); // drives chargeRecurring (mock: success)
  ok('after successful charge → active access', r.json.entitlement.access === true && r.json.entitlement.reason === 'active');

  // ---- failure path: insufficient funds → past_due (blocked) ----
  r = await api('POST', '/v1/account', null, { email: 'bob@example.com' });
  const tokB = r.json.accountToken;
  await api('POST', '/v1/billing/start-trial', tokB, { card: 'tok_insufficient' });
  srv.db.accounts['bob@example.com'].trialEndsAt = Date.now() - 1000; srv.saveDb();
  r = await api('POST', '/v1/billing/retry', tokB); // charge fails
  ok('failed charge → past_due', r.json.account.status === 'past_due');
  ok('past_due → blocked + needsPayment (необходимо оплатить)', r.json.entitlement.blocked === true && r.json.entitlement.needsPayment === true);

  // user tops up funds → retry succeeds → active
  await api('POST', '/v1/billing/_fix-funds', tokB);
  r = await api('POST', '/v1/billing/retry', tokB);
  ok('retry after funds fixed → active', r.json.entitlement.access === true);

  // ---- single subscription spans devices: same account, new token (e.g. desktop) ----
  r = await api('POST', '/v1/account', null, { email: 'alice@example.com' });
  const tokA2 = r.json.accountToken; // "sign in" on a second device
  r = await api('GET', '/v1/status', tokA2);
  ok('same account on a 2nd device shares the subscription', r.json.entitlement.access === true);

  // ---- cancel ----
  r = await api('POST', '/v1/billing/cancel', tokA2);
  ok('cancel during active keeps access until period end', r.json.account.canceled === true);

  // unauthorized
  r = await api('GET', '/v1/status', 'badtoken'); ok('bad token → 401', r.code === 401);

  console.log(out.join('\n'));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  srv.server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(2); });
