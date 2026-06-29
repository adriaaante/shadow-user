<?php
/* server-php/tick.php — recurring-charge tick. Run from CRON (shared hosting has no
 * always-on process), e.g. every 10 min:  php /path/to/server-php/tick.php
 * Charges trials that have ended and active subscriptions past their period end. */

require_once __DIR__ . '/lib/config.php';
require_once __DIR__ . '/lib/store.php';
require_once __DIR__ . '/lib/entitlement.php';
require_once __DIR__ . '/lib/providers.php';

$store = Store::fromEnv();
$provider = provider_select();
$now = now_ms();
$charged = 0;

foreach ($store->allAccounts() as $acc) {
  $pro = ($acc['plan'] ?? '') === 'pro';
  $due = ($pro && ($acc['status'] ?? '') === 'trialing' && $now >= ($acc['trialEndsAt'] ?? 0))
    || ($pro && ($acc['status'] ?? '') === 'active' && $now >= ($acc['currentPeriodEnd'] ?? 0));
  if ($due) {
    $provider->chargeRecurring($acc, $now);
    $store->putAccount($acc);
    $charged++;
    echo "[tick] {$acc['email']} -> {$acc['status']}\n";
  }
}
echo "[tick] done, processed $charged account(s)\n";
