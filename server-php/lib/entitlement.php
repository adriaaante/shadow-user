<?php
/* server-php/lib/entitlement.php — port of shared/entitlement.js (access logic).
 * Times are in MILLISECONDS to match the JS clients (Date.now()). */

const TRIAL_DAYS = 3;
const DAY_MS = 86400000;

function now_ms(): int { return (int) round(microtime(true) * 1000); }

function ent_features(): array {
  return ['generate', 'measure', 'level.energetic', 'level.custom', 'schedule.multiRange',
    'run.always', 'compare.export', 'monitor.global', 'autostart'];
}

function ent_plan(): array {
  $m = 249; $y = 2500;
  return [
    'id' => 'pro', 'name' => 'Driftly Pro', 'currency' => 'RUB',
    'priceMonthly' => $m, 'priceYearly' => $y, 'trialDays' => TRIAL_DAYS,
    'yearlyDiscountPct' => (int) round((1 - $y / ($m * 12)) * 100),
    'features' => ent_features(),
  ];
}

function ent_blocked(string $reason, ?string $account = null, ?string $status = null): array {
  return [
    'plan' => 'none', 'status' => $status ?: ($reason ?: 'none'),
    'access' => false, 'blocked' => true, 'isPro' => false, 'needsPayment' => $reason === 'past_due',
    'reason' => $reason ?: 'none', 'features' => [], 'trialDaysLeft' => 0,
    'account' => $account, 'renewsAt' => null,
  ];
}

/** Compute access from a license payload (assoc array) or null. */
function ent_compute(?array $license, ?int $nowMs = null): array {
  $now = $nowMs ?? now_ms();
  if (!$license) return ent_blocked('none');
  $status = $license['status'] ?? 'none';
  $account = $license['sub'] ?? null;

  $trialing = $status === 'trialing' && $now < ($license['trialEndsAt'] ?? 0);
  $active = $status === 'active' && $now < ($license['currentPeriodEnd'] ?? PHP_INT_MAX);

  if ($trialing || $active) {
    return [
      'plan' => 'pro', 'status' => $status,
      'access' => true, 'blocked' => false, 'isPro' => true, 'needsPayment' => false,
      'canceled' => (bool) ($license['canceled'] ?? false),
      'interval' => $license['interval'] ?? 'month',
      'reason' => $trialing ? 'trial' : 'active',
      'features' => ent_features(),
      'trialDaysLeft' => $trialing ? max(0, (int) ceil(($license['trialEndsAt'] - $now) / DAY_MS)) : 0,
      'account' => $account,
      'renewsAt' => $license['currentPeriodEnd'] ?? ($license['trialEndsAt'] ?? null),
    ];
  }
  if ($status === 'past_due') return ent_blocked('past_due', $account, 'past_due');
  if ($status === 'canceled') return ent_blocked('canceled', $account, 'canceled');
  if ($status === 'trialing' || $status === 'active') return ent_blocked('expired', $account, 'expired');
  return ent_blocked('none', $account, $status);
}
