'use strict';
/* providers/tbank.js — T-Bank (Tinkoff) acquiring adapter — ARCHITECTURE STUB.
 *
 * Implements the same interface as mock.js. Wire the real HTTPS calls where the
 * TODOs are, then set env: DRIFTLY_PROVIDER=tbank, TBANK_TERMINAL_KEY, TBANK_PASSWORD.
 *
 * T-Bank recurring-payment model (https://developer.tbank.ru/eacq/):
 *   1) AddCard    — for a FREE trial, bind the card with CheckType=3DS (a 0₽ check,
 *                   NOT a charge), CustomerKey=acc.email, plus a Token (signature).
 *   2) The customer confirms the card (3-D Secure) → the binding notification carries
 *                   a RebillId (store it; set cardOnFile). No money is taken.
 *   3) Charge     — Init a new payment then call Charge with {PaymentId, RebillId}
 *                   to debit the saved card WITHOUT the customer (the day-4 auto-renewal).
 *   4) Notifications (webhook) — T-Bank POSTs payment status; verify the Token.
 *   (See server-php/lib/providers/tbank.php for the live PHP implementation.)
 *
 * Signature (Token): SHA-256 of the request params (incl. Password) sorted by key.
 */

const crypto = require('crypto');
const DAY = 86400000;
const TRIAL_DAYS = 3;

function cfg() {
  return {
    terminalKey: process.env.TBANK_TERMINAL_KEY || '',
    password: process.env.TBANK_PASSWORD || '',
    api: process.env.TBANK_API || 'https://securepay.tinkoff.ru/v2',
  };
}

/** Build the T-Bank request Token (signature) per their algorithm. */
function makeToken(params, password) {
  const data = Object.assign({}, params, { Password: password });
  const concat = Object.keys(data).sort().filter((k) => typeof data[k] !== 'object')
    .map((k) => data[k]).join('');
  return crypto.createHash('sha256').update(concat).digest('hex');
}

module.exports = {
  name: 'tbank',
  ready() { const c = cfg(); return !!(c.terminalKey && c.password); },

  async startTrial(acc, paymentData, now) {
    now = now || Date.now();
    acc.provider = 'tbank';
    acc.plan = 'pro';
    acc.status = 'trialing';
    acc.trialEndsAt = now + TRIAL_DAYS * DAY;
    acc.canceled = false;
    // TODO: call Init with Recurrent=Y, CustomerKey=acc.email, Token=makeToken(...).
    //       Return Init's PaymentURL so the client can confirm the card (3-DS).
    //       On notification, store RebillId on the account:
    //         acc.providerRebillId = <RebillId>; acc.cardOnFile = true;
    // For now (no keys) we mark the card as pending confirmation.
    acc.cardOnFile = false;
    acc._pendingConfirm = true;
    return { ok: true, needsConfirm: true, redirectUrl: null, note: 'Configure TBANK_* env to enable.' };
  },

  async chargeRecurring(acc, now) {
    now = now || Date.now();
    if (!acc.providerRebillId) { acc.status = 'past_due'; return { ok: false, status: 'past_due', reason: 'no_rebill_id' }; }
    // TODO: Init a payment, then Charge({ PaymentId, RebillId: acc.providerRebillId, Token }).
    //       ok → status 'active', currentPeriodEnd = now+30d ; decline → 'past_due'.
    acc.status = 'past_due';
    return { ok: false, status: 'past_due', reason: 'not_configured' };
  },

  /** Verify a T-Bank notification by recomputing its Token. */
  verifyWebhook(headers, rawBody) {
    try {
      const body = JSON.parse(rawBody || '{}');
      const received = body.Token;
      const check = Object.assign({}, body); delete check.Token;
      const expected = makeToken(check, cfg().password);
      return received === expected ? body : null;
    } catch (e) { return null; }
  },
};
