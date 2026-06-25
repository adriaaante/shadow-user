'use strict';
/* server/lib.js — token signing + account-state helpers for the licensing server. */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const licenseCodec = require('../shared/license');
const entitlement = require('../shared/entitlement');

const DAY = 86400000;
const KEY_DIR = path.join(__dirname, '.keys');
const PRIV_PATH = path.join(KEY_DIR, 'ed25519-private.pem');
const PUB_PATH = path.join(__dirname, '..', 'shared', 'license-public.pem');

function loadPrivateKey() {
  if (!fs.existsSync(PRIV_PATH)) {
    throw new Error('No private key. Run: npm run keygen  (in server/)');
  }
  return fs.readFileSync(PRIV_PATH, 'utf8');
}

/** Build and sign an Ed25519 license token (JWT-like). */
function signToken(payload, privateKeyPem) {
  const header = { alg: 'EdDSA', typ: 'DLT' }; // DLT = Driftly License Token
  const input = licenseCodec.b64urlEncode(JSON.stringify(header))
    + '.' + licenseCodec.b64urlEncode(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(input), privateKeyPem)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return input + '.' + sig;
}

/**
 * Advance the account's billing state given the clock (mock of what a real
 * payment provider's webhooks would do). 3-day trial → if a card is on file it
 * "charges" and becomes active for 30 days; otherwise it expires.
 */
function refreshState(acc, now) {
  now = now || Date.now();
  if (acc.plan === 'pro' && acc.status === 'trialing' && now >= acc.trialEndsAt) {
    if (acc.cardOnFile && !acc.canceled) {
      acc.status = 'active';
      acc.currentPeriodEnd = now + 30 * DAY; // mock charge → 30-day period
    } else {
      acc.status = 'expired';
    }
  }
  if (acc.plan === 'pro' && acc.status === 'active' && now >= (acc.currentPeriodEnd || 0)) {
    if (acc.cardOnFile && !acc.canceled) acc.currentPeriodEnd = now + 30 * DAY; // renew
    else acc.status = 'expired';
  }
  return acc;
}

/**
 * Issue a fresh signed license token reflecting the account's current state.
 * Billing transitions (trial→active/past_due, renewals) are owned by the payment
 * provider + the server's auto-charge loop — NOT here. entitlement.compute()
 * still bounds real access by trialEndsAt / currentPeriodEnd, so a token can
 * never grant access past those dates even between charge ticks.
 */
function issueLicense(acc, privateKeyPem, now) {
  now = now || Date.now();
  const payload = {
    sub: acc.email,
    plan: acc.plan || 'free',
    status: acc.status || 'free',
    canceled: !!acc.canceled,
    trialEndsAt: acc.trialEndsAt || null,
    currentPeriodEnd: acc.currentPeriodEnd || null,
    iat: now,
    exp: now + 7 * DAY, // offline grace; real access is still bounded by the dates above
  };
  return { token: signToken(payload, privateKeyPem), payload };
}

module.exports = {
  DAY, KEY_DIR, PRIV_PATH, PUB_PATH,
  loadPrivateKey, signToken, refreshState, issueLicense, entitlement, licenseCodec,
};
