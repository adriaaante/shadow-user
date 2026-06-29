'use strict';
/* server/lib.js — token signing + account-state helpers for the licensing server. */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const licenseCodec = require('../shared/license');

const DAY = 86400000;
const KEY_DIR = path.join(__dirname, '.keys');
const PRIV_PATH = path.join(KEY_DIR, 'ec-private.pem');
const PUB_PATH = path.join(__dirname, '..', 'shared', 'license-public.pem');

function loadPrivateKey() {
  if (!fs.existsSync(PRIV_PATH)) {
    throw new Error('No private key. Run: npm run keygen  (in server/)');
  }
  return fs.readFileSync(PRIV_PATH, 'utf8');
}

/** Build and sign an Ed25519 license token (JWT-like). */
function signToken(payload, privateKeyPem) {
  const header = { alg: 'ES256', typ: 'DLT' }; // DLT = Driftly License Token (ECDSA P-256)
  const input = licenseCodec.b64urlEncode(JSON.stringify(header))
    + '.' + licenseCodec.b64urlEncode(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return input + '.' + sig;
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
    interval: acc.interval || 'month',
    trialEndsAt: acc.trialEndsAt || null,
    currentPeriodEnd: acc.currentPeriodEnd || null,
    iat: now,
    exp: now + 7 * DAY, // offline grace; real access is still bounded by the dates above
  };
  return { token: signToken(payload, privateKeyPem), payload };
}

module.exports = { KEY_DIR, PRIV_PATH, PUB_PATH, loadPrivateKey, issueLicense };
