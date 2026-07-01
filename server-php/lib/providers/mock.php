<?php
/* providers/mock.php — reference payment provider (no real charges). Port of mock.js.
 * Simulates the card-on-file 3-day trial → auto-charge, and a failed charge so the
 * past_due ("необходимо оплатить") flow is testable. */

require_once __DIR__ . '/../entitlement.php';

class MockProvider {
  function name(): string { return 'mock'; }
  function ready(): bool { return true; }

  function startTrial(array &$acc, array $pd, int $now): array {
    $card = $pd['card'] ?? 'tok_ok';
    $acc['provider'] = 'mock';
    $acc['providerMethodId'] = 'mock_pm_' . bin2hex(random_bytes(4));
    $acc['cardOnFile'] = true;
    $acc['canceled'] = false;
    $acc['plan'] = 'pro';
    $acc['interval'] = (($pd['interval'] ?? '') === 'year') ? 'year' : 'month';
    $acc['status'] = 'trialing';
    $acc['trialEndsAt'] = $now + TRIAL_DAYS * DAY_MS;
    $acc['currentPeriodEnd'] = null;
    $acc['_simFail'] = in_array($card, ['tok_insufficient', 'tok_fail'], true);
    return ['ok' => true];
  }

  function attachCard(array &$acc): array {
    $acc['provider'] = 'mock';
    $acc['providerMethodId'] = 'mock_pm_' . bin2hex(random_bytes(4));
    $acc['cardOnFile'] = true;
    return ['ok' => true];
  }
  function confirmCard(array &$acc): array {
    $acc['cardOnFile'] = true;
    return ['ok' => true, 'cardOnFile' => true];
  }

  function chargeRecurring(array &$acc, int $now): array {
    if (!empty($acc['canceled'])) { $acc['status'] = 'expired'; return ['ok' => false, 'status' => 'expired']; }
    if (empty($acc['cardOnFile'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due']; }
    if (!empty($acc['_simFail'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due']; }
    $acc['status'] = 'active';
    $acc['currentPeriodEnd'] = $now + (($acc['interval'] ?? '') === 'year' ? 365 : 30) * DAY_MS;
    return ['ok' => true, 'status' => 'active', 'currentPeriodEnd' => $acc['currentPeriodEnd']];
  }

  function fixFunds(array &$acc): array { $acc['_simFail'] = false; return ['ok' => true]; }
  function verifyWebhook(array $headers, string $raw): ?array { $j = json_decode($raw ?: '{}', true); return is_array($j) ? $j : null; }
}
