'use strict';
/* providers/yookassa.js — YooKassa (ЮKassa) adapter — ARCHITECTURE STUB.
 *
 * Same interface as mock.js. Wire the real HTTPS calls at the TODOs, then set env:
 * DRIFTLY_PROVIDER=yookassa, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY.
 *
 * YooKassa recurring model (https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments):
 *   1) Create a payment with save_payment_method=true (the trial/first payment).
 *      The user confirms via the returned confirmation_url. YooKassa then returns
 *      a payment_method_id you store for future autopayments.
 *   2) Autopay: create a new payment with {amount, payment_method_id, capture:true}
 *      — no user interaction. succeeded → active; canceled → past_due.
 *   3) Webhooks: payment.succeeded / payment.canceled notifications.
 */

const DAY = 86400000;
const TRIAL_DAYS = 3;

function cfg() {
  return {
    shopId: process.env.YOOKASSA_SHOP_ID || '',
    secret: process.env.YOOKASSA_SECRET_KEY || '',
    api: process.env.YOOKASSA_API || 'https://api.yookassa.ru/v3',
  };
}

module.exports = {
  name: 'yookassa',
  ready() { const c = cfg(); return !!(c.shopId && c.secret); },

  async startTrial(acc, paymentData, now) {
    now = now || Date.now();
    acc.provider = 'yookassa';
    acc.plan = 'pro';
    acc.status = 'trialing';
    acc.trialEndsAt = now + TRIAL_DAYS * DAY;
    acc.canceled = false;
    // TODO: POST /payments { amount, save_payment_method:true, confirmation:{type:'redirect', return_url} }
    //       Return confirmation_url for the client; on webhook store:
    //         acc.providerMethodId = payment.payment_method.id; acc.cardOnFile = true;
    acc.cardOnFile = false;
    acc._pendingConfirm = true;
    return { ok: true, needsConfirm: true, redirectUrl: null, note: 'Configure YOOKASSA_* env to enable.' };
  },

  async chargeRecurring(acc, now) {
    now = now || Date.now();
    if (!acc.providerMethodId) { acc.status = 'past_due'; return { ok: false, status: 'past_due', reason: 'no_method' }; }
    // TODO: POST /payments { amount, capture:true, payment_method_id: acc.providerMethodId }
    //       succeeded → active (currentPeriodEnd = now+30d) ; else past_due.
    acc.status = 'past_due';
    return { ok: false, status: 'past_due', reason: 'not_configured' };
  },

  // YooKassa webhooks aren't signed; verify by source IP allowlist + re-fetching
  // the payment via the API. Here we just parse.
  verifyWebhook(headers, rawBody) { try { return JSON.parse(rawBody || '{}'); } catch (e) { return null; } },
};
