'use strict';
/* server/index.js — Driftly licensing & subscription server (reference).
 *
 * Dependency-free Node HTTP server. Manages accounts and issues Ed25519-signed
 * license tokens that BOTH the web and desktop clients verify, so one
 * subscription unlocks both. Implements the card-on-file 3-day trial, automatic
 * recurring charge, and the past_due ("необходимо оплатить") blocked state.
 *
 * This is a reference implementation: swap the JSON store for a real DB and run
 * behind HTTPS in production. Payment goes through a pluggable provider
 * (mock | tbank | yookassa) — see providers/.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lib = require('./lib');
const entitlement = require('../shared/entitlement');
const providers = require('./providers');
const mailers = require('./mailer');

const AUTH_CODE_TTL = 10 * 60 * 1000; // sign-in code valid 10 minutes
function hashCode(email, code) { return crypto.createHash('sha256').update(email + ':' + code).digest('hex'); }

const PORT = parseInt(process.env.PORT || '8787', 10);
const DATA_DIR = path.join(__dirname, '.data');
const DATA_PATH = path.join(DATA_DIR, 'accounts.json');

let PRIVATE_KEY = null;
try { PRIVATE_KEY = lib.loadPrivateKey(); } catch (e) { console.warn('[server]', e.message); }

const provider = providers.select();
console.log('[server] payment provider:', provider.name);
const mailer = mailers.select();
console.log('[server] mailer:', mailer.name);

/* ------------------------------- store ------------------------------- */
let db = { accounts: {}, tokens: {}, codes: {} };
function loadDb() { try { db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch (e) { db = { accounts: {}, tokens: {}, codes: {} }; } if (!db.codes) db.codes = {}; }
// Atomic write: serialize to a temp file then rename, so a crash mid-write can
// never corrupt accounts.json (a plain writeFileSync could leave it half-written).
function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_PATH);
  } catch (e) {}
}
loadDb();

function publicAccount(acc) {
  return {
    email: acc.email, plan: acc.plan || 'none', status: acc.status || 'none',
    trialEndsAt: acc.trialEndsAt || null, currentPeriodEnd: acc.currentPeriodEnd || null,
    cardOnFile: !!acc.cardOnFile, provider: acc.provider || provider.name, canceled: !!acc.canceled,
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
  const email = db.tokens[m[1]];
  return email ? db.accounts[email] : null;
}
function licenseFor(acc) {
  if (!PRIVATE_KEY) return null;
  const issued = lib.issueLicense(acc, PRIVATE_KEY);
  return issued;
}
function stateResponse(acc) {
  const issued = licenseFor(acc);
  saveDb();
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
        price: { usd: entitlement.PLAN.priceMonthly, rub: entitlement.PLAN.priceMonthlyRub },
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
      db.codes[email] = { hash: hashCode(email, code), exp: Date.now() + AUTH_CODE_TTL, tries: 0 };
      saveDb();
      const r = await mailer.send(email, code);
      const resp = { ok: true, sent: true };
      if (mailer.name === 'console' && r && r.devCode) resp.devCode = r.devCode; // dev only
      return send(res, 200, resp);
    }
    if (p === '/v1/auth/verify' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const email = String(body.email || '').trim().toLowerCase();
      const code = String(body.code || '').trim();
      const rec = db.codes[email];
      if (!rec) return send(res, 400, { error: 'no_code' });
      if (Date.now() > rec.exp) { delete db.codes[email]; saveDb(); return send(res, 400, { error: 'code_expired' }); }
      if (rec.tries >= 5) { delete db.codes[email]; saveDb(); return send(res, 429, { error: 'too_many_attempts' }); }
      if (rec.hash !== hashCode(email, code)) { rec.tries++; saveDb(); return send(res, 401, { error: 'bad_code' }); }
      delete db.codes[email];
      let acc = db.accounts[email];
      if (!acc) { acc = { email, plan: 'none', status: 'none' }; db.accounts[email] = acc; }
      const token = crypto.randomBytes(24).toString('hex');
      db.tokens[token] = email; saveDb();
      return send(res, 200, { accountToken: token, email });
    }

    // everything below needs auth
    const acc = authAccount(req);
    if (p.startsWith('/v1/license') || p.startsWith('/v1/status') || p.startsWith('/v1/billing')) {
      if (!acc) return send(res, 401, { error: 'unauthorized' });
    }

    if (p === '/v1/license') { const i = licenseFor(acc); saveDb(); return send(res, i ? 200 : 503, i ? { token: i.token, entitlement: entitlement.compute(i.payload) } : { error: 'no_signing_key' }); }
    if (p === '/v1/status') return send(res, 200, stateResponse(acc));

    if (p === '/v1/billing/start-trial' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await provider.startTrial(acc, { card: body.card }, Date.now());
      saveDb();
      return send(res, 200, Object.assign({ provider: provider.name, result: r }, stateResponse(acc)));
    }

    if (p === '/v1/billing/retry' && req.method === 'POST') {
      const r = await provider.chargeRecurring(acc, Date.now());
      saveDb();
      return send(res, 200, Object.assign({ result: r }, stateResponse(acc)));
    }

    if (p === '/v1/billing/cancel' && req.method === 'POST') {
      // Stop future charges but KEEP access until the paid period / trial ends
      // (legally required: a user who cancels during the free trial still gets
      // the full trial; one who cancels mid-period keeps what they paid for).
      acc.canceled = true;
      saveDb();
      return send(res, 200, stateResponse(acc));
    }

    if (p === '/v1/billing/resume' && req.method === 'POST') {
      acc.canceled = false; // re-enable auto-renewal before the period ends
      saveDb();
      return send(res, 200, stateResponse(acc));
    }

    // DEV ONLY (mock): clear the simulated insufficient-funds flag.
    if (p === '/v1/billing/_fix-funds' && req.method === 'POST' && provider.name === 'mock') {
      await provider.fixFunds(acc); saveDb();
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
  let changed = false;
  for (const email of Object.keys(db.accounts)) {
    const acc = db.accounts[email];
    if (acc.plan === 'pro' && acc.status === 'trialing' && now >= (acc.trialEndsAt || 0)) {
      await provider.chargeRecurring(acc, now); changed = true;
    } else if (acc.plan === 'pro' && acc.status === 'active' && now >= (acc.currentPeriodEnd || 0)) {
      await provider.chargeRecurring(acc, now); changed = true;
    }
  }
  if (changed) saveDb();
}, TICK_MS);

if (require.main === module) {
  server.listen(PORT, () => console.log(`[server] Driftly licensing on http://localhost:${PORT}`));
}
module.exports = { server, db, loadDb, saveDb };
