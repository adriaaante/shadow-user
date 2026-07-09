<?php
/* server-php/index.php — Driftly licensing & subscription API (PHP port of server/index.js).
 * Same endpoints + JSON shapes as the Node server, so the web/desktop clients work
 * unchanged (just point them at this base URL). Runs on PHP 8.x shared hosting. */

require_once __DIR__ . '/lib/config.php';
require_once __DIR__ . '/lib/store.php';
require_once __DIR__ . '/lib/license.php';
require_once __DIR__ . '/lib/entitlement.php';
require_once __DIR__ . '/lib/mailer.php';
require_once __DIR__ . '/lib/providers.php';

const AUTH_CODE_TTL_MS = 300000; // 5 min
function max_devices(): int { return max(1, (int) env('MAX_DEVICES', '2')); }
function hashCode(string $email, string $code): string { return hash('sha256', $email . ':' . $code); }

$ORIGIN = $_SERVER['HTTP_ORIGIN'] ?? '*';
header('Access-Control-Allow-Origin: ' . ($ORIGIN ?: '*'));
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Vary: Origin');
header('Content-Type: application/json');

function send(int $code, array $obj): void { http_response_code($code); echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function body(): array { $b = file_get_contents('php://input'); $j = json_decode($b ?: '{}', true); return is_array($j) ? $j : []; }
function bearer(): ?string { $h = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''); return preg_match('/^Bearer\s+(.+)$/i', $h, $m) ? $m[1] : null; }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

try {
  $store = Store::fromEnv();
  $provider = provider_select();
  $mailer = mailer_select();
  $hasKey = license_private_key() !== null;

  $publicAccount = function (array $a) use ($provider): array {
    return [
      'email' => $a['email'], 'plan' => $a['plan'] ?? 'none', 'status' => $a['status'] ?? 'none',
      'trialEndsAt' => $a['trialEndsAt'] ?? null, 'currentPeriodEnd' => $a['currentPeriodEnd'] ?? null,
      'cardOnFile' => (bool) ($a['cardOnFile'] ?? false), 'provider' => $a['provider'] ?? $provider->name(),
      'canceled' => (bool) ($a['canceled'] ?? false), 'interval' => $a['interval'] ?? 'month',
      'trialUsed' => (bool) ($a['trialUsed'] ?? false),
      'lastError' => (($a['status'] ?? '') === 'past_due' && !empty($a['lastError'])) ? $a['lastError'] : null,
    ];
  };
  $stateResponse = function (array $a) use ($publicAccount): array {
    $issued = issue_license($a);
    return [
      'account' => $publicAccount($a),
      'license' => $issued ? $issued['token'] : null,
      'entitlement' => ent_compute($issued ? $issued['payload'] : null),
    ];
  };
  $authAccount = function () use ($store): ?array {
    $tok = bearer(); if (!$tok) return null;
    $email = $store->emailForToken($tok); return $email ? $store->getAccount($email) : null;
  };

  // ---- public ----
  if ($path === '/v1/health') send(200, ['ok' => true, 'provider' => $provider->name(), 'keys' => $hasKey]);
  if ($path === '/v1/config') {
    $p = ent_plan();
    send(200, ['provider' => $provider->name(), 'trialDays' => TRIAL_DAYS,
      'price' => ['currency' => $p['currency'], 'monthly' => $p['priceMonthly'], 'yearly' => $p['priceYearly'], 'yearlyDiscountPct' => $p['yearlyDiscountPct']],
      'keys' => $hasKey]);
  }

  // ---- TEMPORARY: T-Bank certification (3 test payments). Disable by removing DRIFTLY_TEST_PAY
  // from .env once the merchant is switched to real data. The flag doubles as the URL secret;
  // opens a real payment form so the test cards run success/fail/refund. The resulting webhook is
  // signature-verified then ignored (no matching account), so it can't touch subscriptions.
  if ($path === '/v1/test/pay' && $provider->name() === 'tbank') {
    $secret = (string) env('DRIFTLY_TEST_PAY', '');
    if ($secret === '' || (string) ($_GET['t'] ?? '') !== $secret) send(404, ['error' => 'not_found']);
    $amount = max(100, (int) ($_GET['amount'] ?? 10000)); // kopecks; default 100 ₽
    $email = strtolower(trim((string) ($_GET['email'] ?? 'test@driftly.site')));
    $r = $provider->testInit($amount, 'test-' . now_ms(), $email);
    if (!empty($r['url'])) { header('Location: ' . $r['url']); http_response_code(302); exit; }
    send(502, ['error' => 'init_failed', 'detail' => $r]);
  }
  // TEMPORARY: force a recurring charge for <email> to validate the AddCard→RebillId→Charge loop
  // without waiting for day 4. Same DRIFTLY_TEST_PAY secret; remove the flag to disable.
  if ($path === '/v1/test/charge' && $provider->name() === 'tbank') {
    $secret = (string) env('DRIFTLY_TEST_PAY', '');
    if ($secret === '' || (string) ($_GET['t'] ?? '') !== $secret) send(404, ['error' => 'not_found']);
    $email = strtolower(trim((string) ($_GET['email'] ?? '')));
    $a = $email !== '' ? $store->getAccount($email) : null;
    if (!$a) send(404, ['error' => 'no_account', 'email' => $email]);
    $r = $provider->chargeRecurring($a, now_ms());
    $store->putAccount($a);
    send(200, ['charge' => $r, 'account' => [
      'status' => $a['status'] ?? null, 'cardOnFile' => (bool) ($a['cardOnFile'] ?? false),
      'rebillId' => isset($a['providerRebillId']) ? 'set' : 'missing',
      'currentPeriodEnd' => $a['currentPeriodEnd'] ?? null,
    ]]);
  }

  // TEMPORARY: raw GetState for a paymentId, or confirm+activate a pending trial for an email. Same secret.
  if ($path === '/v1/test/state' && $provider->name() === 'tbank') {
    $secret = (string) env('DRIFTLY_TEST_PAY', '');
    if ($secret === '' || (string) ($_GET['t'] ?? '') !== $secret) send(404, ['error' => 'not_found']);
    if (!empty($_GET['paymentId']) && method_exists($provider, 'getStateRaw')) {
      send(200, ['state' => $provider->getStateRaw((string) $_GET['paymentId'])]);
    }
    $email = strtolower(trim((string) ($_GET['email'] ?? '')));
    $a = $email !== '' ? $store->getAccount($email) : null;
    if (!$a) send(404, ['error' => 'no_account', 'email' => $email]);
    $r = method_exists($provider, 'confirmCard') ? $provider->confirmCard($a) : ['ok' => false];
    // Same activation rule as /v1/billing/confirm-card: only the PENDING payment counts.
    if (!empty($a['pendingTrial']) || !empty($a['pendingPaid'])) {
      $pid = (string) ($a['pendingPaymentId'] ?? $a['providerPaymentId'] ?? '');
      $st = ($pid !== '' && method_exists($provider, 'getStateRaw')) ? $provider->getStateRaw($pid) : [];
      if (in_array(strtoupper((string) ($st['Status'] ?? '')), ['CONFIRMED', 'AUTHORIZED'], true)) {
        $a['cardOnFile'] = true;
        if (!empty($a['pendingTrial'])) {
          $a['status'] = 'trialing'; $a['trialEndsAt'] = now_ms() + TRIAL_DAYS * DAY_MS;
          if ($pid !== '' && ($a['refundedPaymentId'] ?? '') !== $pid && method_exists($provider, 'cancelPayment')) {
            $provider->cancelPayment($pid); $a['refundedPaymentId'] = $pid;
          }
        } else {
          $a['status'] = 'active';
          $a['currentPeriodEnd'] = now_ms() + ((($a['pendingInterval'] ?? $a['interval'] ?? '') === 'year') ? 365 : 30) * DAY_MS;
        }
        $a['trialUsed'] = true;
        unset($a['pendingTrial'], $a['pendingPaid'], $a['pendingPaymentId'], $a['pendingInterval'], $a['lastError']);
      }
    }
    $store->putAccount($a);
    send(200, ['result' => $r, 'account' => ['status' => $a['status'] ?? null, 'cardOnFile' => (bool) ($a['cardOnFile'] ?? false), 'rebillId' => isset($a['providerRebillId']) && $a['providerRebillId'] !== '' ? 'set' : 'missing']]);
  }
  // TEMPORARY: raw GetCardList for an email (diagnostics). Same secret.
  if ($path === '/v1/test/cards' && $provider->name() === 'tbank') {
    $secret = (string) env('DRIFTLY_TEST_PAY', '');
    if ($secret === '' || (string) ($_GET['t'] ?? '') !== $secret) send(404, ['error' => 'not_found']);
    $email = strtolower(trim((string) ($_GET['email'] ?? '')));
    send(200, ['email' => $email, 'cards' => method_exists($provider, 'getCardListRaw') ? $provider->getCardListRaw($email) : 'n/a']);
  }
  // TEMPORARY: reset an account so the trial/card-binding can be re-run from scratch. Same secret.
  if ($path === '/v1/test/reset' && $provider->name() === 'tbank') {
    $secret = (string) env('DRIFTLY_TEST_PAY', '');
    if ($secret === '' || (string) ($_GET['t'] ?? '') !== $secret) send(404, ['error' => 'not_found']);
    $email = strtolower(trim((string) ($_GET['email'] ?? '')));
    if ($email !== '') $store->deleteAccount($email);
    send(200, ['reset' => true, 'email' => $email]);
  }
  // TEMPORARY: view the T-Bank debug log (AddCard responses + raw webhooks). Same secret; remove the flag to disable.
  if ($path === '/v1/test/log') {
    $secret = (string) env('DRIFTLY_TEST_PAY', '');
    if ($secret === '' || (string) ($_GET['t'] ?? '') !== $secret) send(404, ['error' => 'not_found']);
    header('Content-Type: text/plain; charset=utf-8');
    $f = sys_get_temp_dir() . '/driftly-tbank.log';
    echo is_file($f) ? mb_substr((string) file_get_contents($f), -6000) : '(log empty)';
    exit;
  }

  if ($path === '/v1/auth/request' && $method === 'POST') {
    $email = strtolower(trim(body()['email'] ?? ''));
    if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $email)) send(400, ['error' => 'invalid_email']);
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $store->putCode($email, ['hash' => hashCode($email, $code), 'exp' => now_ms() + AUTH_CODE_TTL_MS, 'tries' => 0]);
    $r = ($mailer['send'])($email, $code);
    $resp = ['ok' => true, 'sent' => true];
    if ($mailer['name'] === 'console' && !empty($r['devCode'])) $resp['devCode'] = $r['devCode'];
    send(200, $resp);
  }
  if ($path === '/v1/auth/verify' && $method === 'POST') {
    $b = body(); $email = strtolower(trim($b['email'] ?? '')); $code = trim((string) ($b['code'] ?? ''));
    $rec = $store->getCode($email);
    if (!$rec) send(400, ['error' => 'no_code']);
    if (now_ms() > $rec['exp']) { $store->delCode($email); send(400, ['error' => 'code_expired']); }
    if ($rec['tries'] >= 5) { $store->delCode($email); send(429, ['error' => 'too_many_attempts']); }
    if (!hash_equals($rec['hash'], hashCode($email, $code))) { $rec['tries']++; $store->putCode($email, $rec); send(401, ['error' => 'bad_code']); }
    $store->delCode($email);
    $acc = $store->getAccount($email);
    if (!$acc) { $acc = ['email' => $email, 'plan' => 'none', 'status' => 'none']; $store->putAccount($acc); }
    $token = bin2hex(random_bytes(24));
    $store->putToken($token, $email);
    $evicted = $store->pruneTokens($email, max_devices());
    send(200, ['accountToken' => $token, 'email' => $email, 'devices' => $store->countTokensForEmail($email), 'maxDevices' => max_devices(), 'evicted' => $evicted]);
  }
  if ($path === '/v1/auth/signout' && $method === 'POST') {
    $tok = bearer(); if ($tok) $store->delToken($tok);
    send(200, ['ok' => true]);
  }

  // ---- authed ----
  $needsAuth = str_starts_with($path, '/v1/license') || str_starts_with($path, '/v1/status') || str_starts_with($path, '/v1/billing');
  $acc = $authAccount();
  if ($needsAuth && !$acc) send(401, ['error' => 'unauthorized']);

  if ($path === '/v1/license') {
    $i = issue_license($acc);
    send($i ? 200 : 503, $i ? ['token' => $i['token'], 'entitlement' => ent_compute($i['payload'])] : ['error' => 'no_signing_key']);
  }
  if ($path === '/v1/status') send(200, $stateResponse($acc));

  if ($path === '/v1/billing/start-trial' && $method === 'POST') {
    $b = body();
    $r = $provider->startTrial($acc, ['card' => $b['card'] ?? null, 'interval' => $b['interval'] ?? null], now_ms());
    $store->putAccount($acc);
    send(200, array_merge(['provider' => $provider->name(), 'result' => $r], $stateResponse($acc)));
  }
  if ($path === '/v1/billing/confirm-card' && $method === 'POST') {
    // Actively confirm the payment via the provider, webhook-independent.
    if (!method_exists($provider, 'confirmCard')) send(400, ['error' => 'not_supported']);
    if (!empty($acc['pendingTrial']) || !empty($acc['pendingPaid'])) {
      // A pending signup activates ONLY when its OWN payment cleared. cardOnFile alone is
      // not proof of payment — a ~1 ₽ attach-card verify also sets it, and must never be
      // able to confirm a full 'sub-' activation.
      $pid = (string) ($acc['pendingPaymentId'] ?? $acc['providerPaymentId'] ?? '');
      $st = ($pid !== '' && method_exists($provider, 'getStateRaw')) ? $provider->getStateRaw($pid) : [];
      if (!empty($st['RebillId'])) $acc['providerRebillId'] = (string) $st['RebillId'];
      $paid = in_array(strtoupper((string) ($st['Status'] ?? '')), ['CONFIRMED', 'AUTHORIZED'], true);
      $r = ['ok' => true, 'via' => 'pending', 'paid' => $paid];
      if ($paid) {
        $acc['cardOnFile'] = true;
        if (!empty($acc['pendingTrial'])) {
          $acc['status'] = 'trialing';
          $acc['trialEndsAt'] = now_ms() + TRIAL_DAYS * DAY_MS;
          // Refund the ~1 ₽ here too — the webhook can be delayed or misconfigured.
          // refundedPaymentId keeps the two paths idempotent (one refund per payment).
          if ($pid !== '' && ($acc['refundedPaymentId'] ?? '') !== $pid && method_exists($provider, 'cancelPayment')) {
            $provider->cancelPayment($pid); $acc['refundedPaymentId'] = $pid;
          }
        } else {
          // Returning user (no free trial left) — the full charge cleared → paid period
          // starts now, for the interval that was actually paid for (snapshot at Init).
          $acc['status'] = 'active';
          $acc['currentPeriodEnd'] = now_ms() + ((($acc['pendingInterval'] ?? $acc['interval'] ?? '') === 'year') ? 365 : 30) * DAY_MS;
        }
        $acc['trialUsed'] = true;
        unset($acc['pendingTrial'], $acc['pendingPaid'], $acc['pendingPaymentId'], $acc['pendingInterval'], $acc['lastError']);
      }
    } else {
      $r = $provider->confirmCard($acc); // card change: confirm the new binding only
    }
    $store->putAccount($acc);
    send(200, array_merge(['result' => $r], $stateResponse($acc)));
  }
  if ($path === '/v1/billing/attach-card' && $method === 'POST') {
    // (Re)bind or change the saved card without touching the trial/period. While a signup
    // is pending, re-issue the SAME pending payment (correct amount + intent) instead —
    // otherwise a ~1 ₽ verify would displace the pending 'sub-' payment as the account's
    // latest payment and could stand in for it.
    if (!method_exists($provider, 'attachCard')) send(400, ['error' => 'not_supported']);
    $r = (!empty($acc['pendingTrial']) || !empty($acc['pendingPaid']))
      ? $provider->startTrial($acc, ['interval' => $acc['pendingInterval'] ?? ($acc['interval'] ?? null)], now_ms())
      : $provider->attachCard($acc);
    $store->putAccount($acc);
    send(200, array_merge(['result' => $r], $stateResponse($acc)));
  }
  if ($path === '/v1/billing/retry' && $method === 'POST') {
    // Retry only when a charge is actually DUE (failed charge, or the trial/period has
    // ended and tick hasn't run yet). Without this guard a direct API call would charge
    // a LIVE trial/period immediately (ending a free trial early / double-charging).
    $st = $acc['status'] ?? '';
    $due = $st === 'past_due'
      || ($st === 'trialing' && now_ms() >= ($acc['trialEndsAt'] ?? 0))
      || ($st === 'active' && now_ms() >= ($acc['currentPeriodEnd'] ?? 0));
    if (!$due) send(409, array_merge(['error' => 'not_past_due'], $stateResponse($acc)));
    $r = $provider->chargeRecurring($acc, now_ms()); $store->putAccount($acc);
    send(200, array_merge(['result' => $r], $stateResponse($acc)));
  }
  if ($path === '/v1/billing/cancel' && $method === 'POST') {
    $acc['canceled'] = true; $store->putAccount($acc); send(200, $stateResponse($acc));
  }
  if ($path === '/v1/billing/resume' && $method === 'POST') {
    $acc['canceled'] = false; $store->putAccount($acc); send(200, $stateResponse($acc));
  }
  if ($path === '/v1/billing/interval' && $method === 'POST') {
    // Switch the billing interval (e.g. monthly → yearly). Takes effect from the
    // next charge — the new amount is charged when tick.php renews via RebillId.
    $acc['interval'] = (body()['interval'] ?? '') === 'year' ? 'year' : 'month';
    $store->putAccount($acc); send(200, $stateResponse($acc));
  }
  if ($path === '/v1/billing/_fix-funds' && $method === 'POST' && $provider->name() === 'mock') {
    $provider->fixFunds($acc); $store->putAccount($acc); send(200, $stateResponse($acc));
  }

  if (str_starts_with($path, '/v1/webhooks/')) {
    $raw = file_get_contents('php://input');
    dbg_log('webhook.raw', $raw ?: '(empty)');
    $ev = $provider->verifyWebhook(getallheaders() ?: [], $raw ?: '');
    if (!$ev) send(400, ['error' => 'bad_webhook']);
    // T-Bank: on a successful authorization store RebillId + cardOnFile, set active/past_due.
    if ($provider->name() === 'tbank') {
      // T-Bank notifications don't always echo CustomerKey, so resolve the account by
      // CustomerKey, else the email embedded in OrderId (trial-<email>-<ts> /
      // renew-<email>-<ts>), else the PaymentId we stored at Init.
      $email = strtolower((string) ($ev['CustomerKey'] ?? ''));
      if ($email === '' && !empty($ev['OrderId']) && preg_match('/^(?:trial|sub|renew)-(.+)-\d+$/', (string) $ev['OrderId'], $m)) {
        $email = strtolower($m[1]);
      }
      $a = $email !== '' ? $store->getAccount($email) : null;
      if (!$a && !empty($ev['PaymentId'])) {
        foreach ($store->allAccounts() as $cand) {
          if ((string) ($cand['providerPaymentId'] ?? '') === (string) $ev['PaymentId']) { $a = $cand; break; }
        }
      }
      if ($a) {
        $rebill = !empty($ev['RebillId']);
        if ($rebill) { $a['providerRebillId'] = (string) $ev['RebillId']; $a['cardOnFile'] = true; }
        $status = strtoupper((string) ($ev['Status'] ?? ''));
        $paid = in_array($status, ['CONFIRMED', 'AUTHORIZED', 'COMPLETED'], true);
        // The OrderId tells apart a ~1 ₽ card verification (trial-…, used for both the initial
        // trial AND changing the card) from a real renewal charge (renew-…). This prevents a card
        // change from being mistaken for a paid renewal and extending the period for 1 ₽.
        $isVerify = strpos((string) ($ev['OrderId'] ?? ''), 'trial-') === 0;
        $isSignup = strpos((string) ($ev['OrderId'] ?? ''), 'sub-') === 0;
        if ($isVerify) {
          if ($paid || $rebill) {
            // Card verified → activate the trial only if it was pending; always refund the ~1 ₽.
            // The free trial is granted ONCE per account — mark trialUsed so it can never repeat.
            if (!empty($a['pendingTrial'])) {
              $a['status'] = 'trialing';
              $a['trialEndsAt'] = now_ms() + TRIAL_DAYS * DAY_MS;
              $a['trialUsed'] = true;
              unset($a['pendingTrial'], $a['pendingPaid'], $a['pendingPaymentId'], $a['pendingInterval'], $a['lastError']);
            }
            // One refund per payment — confirm-card may already have returned this ~1 ₽.
            $pid = (string) ($ev['PaymentId'] ?? '');
            if ($pid !== '' && $paid && ($a['refundedPaymentId'] ?? '') !== $pid && method_exists($provider, 'cancelPayment')) {
              $provider->cancelPayment($pid); $a['refundedPaymentId'] = $pid;
            }
          }
          // A failed verification (REJECTED) simply leaves a pending trial un-activated.
        } elseif ($isSignup) {
          // Paid signup (sub-…): a returning user with no free trial left is charged the FULL
          // period up front. On success → active for the interval that was paid for (snapshot
          // at Init); the charge is NOT refunded and no second free trial is ever granted.
          if ($paid && !empty($a['pendingPaid'])) {
            $a['status'] = 'active';
            $a['currentPeriodEnd'] = now_ms() + ((($a['pendingInterval'] ?? $a['interval'] ?? '') === 'year') ? 365 : 30) * DAY_MS;
            $a['trialUsed'] = true;
            unset($a['pendingTrial'], $a['pendingPaid'], $a['pendingPaymentId'], $a['pendingInterval'], $a['lastError']);
          }
          // A failed charge (REJECTED) leaves the account pending — no access granted.
        } else {
          // Renewal (renew-…): chargeRecurring() owns the success path; the webhook only flags a
          // failed charge so access is paused until paid.
          if ($status === 'REJECTED') $a['status'] = 'past_due';
        }
        $store->putAccount($a);
      }
    }
    send(200, ['received' => true]);
  }

  send(404, ['error' => 'not_found']);
} catch (Throwable $e) {
  send(500, ['error' => 'server_error', 'detail' => substr($e->getMessage(), 0, 200)]);
}
