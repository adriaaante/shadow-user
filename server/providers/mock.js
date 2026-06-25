'use strict';
/* providers/mock.js — reference payment provider for local development.
 * No real charges. Simulates a card-on-file 3-day trial that auto-charges, and
 * can simulate a FAILED charge (insufficient funds) so the "past_due / необходимо
 * оплатить" blocked flow is fully testable. Real providers (T-Bank, YooKassa)
 * implement the same interface in tbank.js / yookassa.js. */

const crypto = require('crypto');
const DAY = 86400000;
const TRIAL_DAYS = 3;

module.exports = {
  name: 'mock',
  // is this provider ready (keys configured)? mock is always ready.
  ready() { return true; },

  /** Attach a card and start the 3-day trial. paymentData.card is a token. */
  async startTrial(acc, paymentData, now) {
    now = now || Date.now();
    const card = (paymentData && paymentData.card) || 'tok_ok';
    acc.provider = 'mock';
    acc.providerMethodId = 'mock_pm_' + crypto.randomBytes(4).toString('hex');
    acc.cardOnFile = true;
    acc.canceled = false;
    acc.plan = 'pro';
    acc.status = 'trialing';
    acc.trialEndsAt = now + TRIAL_DAYS * DAY;
    acc.currentPeriodEnd = null;
    // test hooks: special tokens simulate a later failed charge
    acc._simFail = (card === 'tok_insufficient' || card === 'tok_fail');
    return { ok: true };
  },

  /** Attempt the recurring charge (called when the trial ends, or on retry). */
  async chargeRecurring(acc, now) {
    now = now || Date.now();
    // Cancelled → don't charge; the subscription simply ends (not past_due).
    if (acc.canceled) { acc.status = 'expired'; return { ok: false, status: 'expired' }; }
    if (!acc.cardOnFile) { acc.status = 'past_due'; return { ok: false, status: 'past_due' }; }
    if (acc._simFail) { acc.status = 'past_due'; return { ok: false, status: 'past_due' }; }
    acc.status = 'active';
    acc.currentPeriodEnd = now + 30 * DAY;
    return { ok: true, status: 'active', currentPeriodEnd: acc.currentPeriodEnd };
  },

  /** Clear the failure flag (e.g. user topped up funds) so a retry can succeed. */
  async fixFunds(acc) { acc._simFail = false; return { ok: true }; },

  verifyWebhook(headers, rawBody) { try { return JSON.parse(rawBody || '{}'); } catch (e) { return null; } },
};
