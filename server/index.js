'use strict';
/* server/index.js — Driftly licensing & subscription server (reference).
 *
 * Dependency-free Node HTTP server. Manages accounts and issues Ed25519-signed
 * license tokens that BOTH the web and desktop clients verify, so one
 * subscription unlocks both. Implements the card-on-file 3-day trial, automatic
 * recurring charge, and the past_due ("необходимо оплатить") blocked state.
 *
 * This is a reference implementation: storage is embedded SQLite (server/store.js).
 * Run behind HTTPS and configure a real mailer + payment provider in production.
 * Payment goes through a pluggable provider (mock | tbank | yookassa) — see providers/.
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');

const lib = require('./lib');
const entitlement = require('../shared/entitlement');
const providers = require('./providers');
const mailers = require('./mailer');
const store = require('./store');

const AUTH_CODE_TTL = 10 * 60 * 1000; // sign-in code valid 10 minutes
// One subscription unlocks at most this many devices (web + desktop = 2 by design).
// A 3rd sign-in evicts the oldest device, so a license can't be shared around.
const MAX_DEVICES = Math.max(1, parseInt(process.env.MAX_DEVICES || '2', 10));
function hashCode(email, code) { return crypto.createHash('sha256').update(email + ':' + code).digest('hex'); }

const PORT = parseInt(process.env.PORT || '8787', 10);

let PRIVATE_KEY = null;
try { PRIVATE_KEY = lib.loadPrivateKey(); } catch (e) { console.warn('[server]', e.message); }

const provider = providers.select();
console.log('[server] payment provider:', provider.name);
const mailer = mailers.select();
console.log('[server] mailer:', mailer.name);

/* ------------------------------- store ------------------------------- */
store.init(path.join(__dirname, '.data', 'driftly.db'));

function publicAccount(acc) {
  return {
    email: acc.email, plan: acc.plan || 'none', status: acc.status || 'none',
    trialEndsAt: acc.trialEndsAt || null, currentPeriodEnd: acc.currentPeriodEnd || null,
    cardOnFile: !!acc.cardOnFile, provider: acc.provider || provider.name, canceled: !!acc.canceled,
    interval: acc.interval || 'month',
  };
}

/* ------------------------------- http utils ------------------------------- */
function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}
function authAccount(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const email = store.emailForToken(m[1]);
  return email ? store.getAccount(email) : null;
}
function licenseFor(acc) {
  if (!PRIVATE_KEY) return null;
  const issued = lib.issueLicense(acc, PRIVATE_KEY);
  return issued;
}
function stateResponse(acc) {
  const issued = licenseFor(acc); // pure read — callers persist their own mutations
  return {
    account: publicAccount(acc),
    license: issued ? issued.token : null,
    entitlement: entitlement.compute(issued ? issued.payload : null),
  };
}

/* ------------------------------- routes ------------------------------- */
const server = http.createServer(async (req, res) => {
  cors(res, req.headers.origin);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/v1/health') return send(res, 200, { ok: true, provider: provider.name, keys: !!PRIVATE_KEY });
    if (p === '/v1/config') {
      return send(res, 200, {
        provider: provider.name, trialDays: entitlement.TRIAL_DAYS,
        price: {
          currency: entitlement.PLAN.currency,
          monthly: entitlement.PLAN.priceMonthly,
          yearly: entitlement.PLAN.priceYearly,
          yearlyDiscountPct: entitlement.PLAN.yearlyDiscountPct,
        },
        keys: !!PRIVATE_KEY,
      });
    }

    // ---- passwordless sign-in (email code). Proves the user owns the email
    // before any subscription is tied to it — so signing in on another device
    // is secure, and you can't take over someone else's billing by typing their
    // address. Swap the console mailer for real email in mailer.js. ----
    if (p === '/v1/auth/request' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'invalid_email' });
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      store.putCode(email, { hash: hashCode(email, code), exp: Date.now() + AUTH_CODE_TTL, tries: 0 });
      const r = await mailer.send(email, code);
      const resp = { ok: true, sent: true };
      if (mailer.name === 'console' && r && r.devCode) resp.devCode = r.devCode; // dev only
      return send(res, 200, resp);
    }
    if (p === '/v1/auth/verify' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const email = String(body.email || '').trim().toLowerCase();
      const code = String(body.code || '').trim();
      const rec = store.getCode(email);
      if (!rec) return send(res, 400, { error: 'no_code' });
      if (Date.now() > rec.exp) { store.delCode(email); return send(res, 400, { error: 'code_expired' }); }
      if (rec.tries >= 5) { store.delCode(email); return send(res, 429, { error: 'too_many_attempts' }); }
      if (rec.hash !== hashCode(email, code)) { rec.tries++; store.putCode(email, rec); return send(res, 401, { error: 'bad_code' }); }
      store.delCode(email);
      let acc = store.getAccount(email);
      if (!acc) { acc = { email, plan: 'none', status: 'none' }; store.putAccount(acc); }
      const token = crypto.randomBytes(24).toString('hex');
      store.putToken(token, email);
      // Enforce the device cap: keep only the newest MAX_DEVICES tokens for this
      // account, so a shared login can never run on more than that many devices.
      const evicted = store.pruneTokens(email, MAX_DEVICES);
      return send(res, 200, { accountToken: token, email, devices: store.countTokensForEmail(email), maxDevices: MAX_DEVICES, evicted });
    }

    // Sign out THIS device — frees a device slot immediately (deletes the token).
    if (p === '/v1/auth/signout' && req.method === 'POST') {
      const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      if (m) store.delToken(m[1]);
      return send(res, 200, { ok: true });
    }

    // everything below needs auth
    const acc = authAccount(req);
    if (p.startsWith('/v1/license') || p.startsWith('/v1/status') || p.startsWith('/v1/billing')) {
      if (!acc) return send(res, 401, { error: 'unauthorized' });
    }

    if (p === '/v1/license') { const i = licenseFor(acc); return send(res, i ? 200 : 503, i ? { token: i.token, entitlement: entitlement.compute(i.payload) } : { error: 'no_signing_key' }); }
    if (p === '/v1/status') return send(res, 200, stateResponse(acc));

    if (p === '/v1/billing/start-trial' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await provider.startTrial(acc, { card: body.card, interval: body.interval }, Date.now());
      store.putAccount(acc);
      return send(res, 200, Object.assign({ provider: provider.name, result: r }, stateResponse(acc)));
    }

    if (p === '/v1/billing/retry' && req.method === 'POST') {
      const r = await provider.chargeRecurring(acc, Date.now());
      store.putAccount(acc);
      return send(res, 200, Object.assign({ result: r }, stateResponse(acc)));
    }

    if (p === '/v1/billing/cancel' && req.method === 'POST') {
      // Stop future charges but KEEP access until the paid period / trial ends
      // (legally required: a user who cancels during the free trial still gets
      // the full trial; one who cancels mid-period keeps what they paid for).
      acc.canceled = true;
      store.putAccount(acc);
      return send(res, 200, stateResponse(acc));
    }

    if (p === '/v1/billing/resume' && req.method === 'POST') {
      acc.canceled = false; // re-enable auto-renewal before the period ends
      store.putAccount(acc);
      return send(res, 200, stateResponse(acc));
    }

    // DEV ONLY (mock): clear the simulated insufficient-funds flag.
    if (p === '/v1/billing/_fix-funds' && req.method === 'POST' && provider.name === 'mock') {
      await provider.fixFunds(acc); store.putAccount(acc);
      return send(res, 200, stateResponse(acc));
    }

    if (p.startsWith('/v1/webhooks/')) {
      const raw = await readBody(req);
      const ev = provider.verifyWebhook(req.headers, raw);
      if (!ev) return send(res, 400, { error: 'bad_webhook' });
      // A real handler maps provider events → account status here.
      return send(res, 200, { received: true });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    return send(res, 500, { error: 'server_error', detail: String(e && e.message || e) });
  }
});

/* --------- auto-charge loop: trial ends → charge → active OR past_due --------- */
const TICK_MS = parseInt(process.env.TICK_MS || '10000', 10);
setInterval(async () => {
  const now = Date.now();
  for (const acc of store.allAccounts()) {
    if (acc.plan === 'pro' && acc.status === 'trialing' && now >= (acc.trialEndsAt || 0)) {
      await provider.chargeRecurring(acc, now); store.putAccount(acc);
    } else if (acc.plan === 'pro' && acc.status === 'active' && now >= (acc.currentPeriodEnd || 0)) {
      await provider.chargeRecurring(acc, now); store.putAccount(acc);
    }
  }
}, TICK_MS);

if (require.main === module) {
  server.listen(PORT, () => console.log(`[server] Driftly licensing on http://localhost:${PORT}`));
}
module.exports = { server, store };
