/* shared/entitlement.js
 * Framework-agnostic plan + ACCESS logic, shared by the desktop app, the web app
 * and the licensing server. Loads in Node (require) and the browser
 * (window.DriftlyEntitlement).
 *
 * Model (as specified by the owner): Driftly is a paid product with a card-on-file
 * free trial. A single subscription, tied to the ACCOUNT (email), unlocks BOTH the
 * web and desktop versions.
 *
 *   none / no card     → blocked, must start trial or subscribe
 *   trialing (≤3 days) → full access
 *   active             → full access
 *   past_due           → BLOCKED, charge failed → "необходимо оплатить"
 *   canceled/expired   → blocked
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DriftlyEntitlement = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TRIAL_DAYS = 3;
  var DAY = 86400000;

  // Capabilities unlocked when access is granted (trialing or active).
  var FEATURES = [
    'generate',            // run the activity generator at all
    'measure',             // record + compare activity, charts
    'level.energetic',
    'level.custom',
    'schedule.multiRange',
    'run.always',
    'compare.export',
    'monitor.global',      // desktop: system-wide real-user monitoring
    'autostart',
  ];

  var PLAN = {
    id: 'pro', name: 'Driftly Pro',
    currency: 'RUB',
    priceMonthly: 199, // ₽ / month
    priceYearly: 1999, // ₽ / year (vs 12×199 = 2388 → save 389 ₽)
    trialDays: TRIAL_DAYS,
    features: FEATURES.slice(),
  };
  // % saved by paying yearly instead of 12 monthly charges (rounded).
  PLAN.yearlyDiscountPct = Math.round((1 - PLAN.priceYearly / (PLAN.priceMonthly * 12)) * 100);

  function blocked(reason, account, status) {
    return {
      plan: 'none', status: status || reason || 'none',
      access: false, blocked: true, isPro: false, needsPayment: reason === 'past_due',
      reason: reason || 'none', features: [], trialDaysLeft: 0,
      account: account || null, renewsAt: null,
    };
  }

  /**
   * Compute access from a (already-verified) license payload.
   * license = { sub, plan, status, trialEndsAt, currentPeriodEnd } | null
   */
  function compute(license, nowMs) {
    var now = nowMs || Date.now();
    if (!license) return blocked('none', null);
    var status = license.status || 'none';
    var account = license.sub || null;

    var trialing = status === 'trialing' && now < (license.trialEndsAt || 0);
    var active = status === 'active' && now < (license.currentPeriodEnd || Infinity);

    if (trialing || active) {
      return {
        plan: 'pro', status: status,
        access: true, blocked: false, isPro: true, needsPayment: false,
        canceled: !!license.canceled,
        interval: license.interval || 'month',
        reason: trialing ? 'trial' : 'active',
        features: FEATURES.slice(),
        trialDaysLeft: trialing ? Math.max(0, Math.ceil((license.trialEndsAt - now) / DAY)) : 0,
        account: account,
        renewsAt: license.currentPeriodEnd || license.trialEndsAt || null,
      };
    }
    if (status === 'past_due') return blocked('past_due', account, 'past_due');
    if (status === 'canceled') return blocked('canceled', account, 'canceled');
    if (status === 'trialing' || status === 'active') return blocked('expired', account, 'expired');
    return blocked('none', account, status);
  }

  return {
    TRIAL_DAYS: TRIAL_DAYS, FEATURES: FEATURES, PLAN: PLAN,
    blocked: function (r) { return blocked(r); },
    compute: compute,
  };
}));
