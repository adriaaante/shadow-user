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

const AUTH_CODE_TTL_MS = 600000; // 10 min
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
  if ($path === '/v1/billing/retry' && $method === 'POST') {
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
    $ev = $provider->verifyWebhook(getallheaders() ?: [], $raw ?: '');
    if (!$ev) send(400, ['error' => 'bad_webhook']);
    // T-Bank: on a successful authorization store RebillId + cardOnFile, set active/past_due.
    if ($provider->name() === 'tbank') {
      // T-Bank notifications don't always echo CustomerKey, so resolve the account by
      // CustomerKey, else the email embedded in OrderId (trial-<email>-<ts> /
      // renew-<email>-<ts>), else the PaymentId we stored at Init.
      $email = strtolower((string) ($ev['CustomerKey'] ?? ''));
      if ($email === '' && !empty($ev['OrderId']) && preg_match('/^(?:trial|renew)-(.+)-\d+$/', (string) $ev['OrderId'], $m)) {
        $email = strtolower($m[1]);
      }
      $a = $email !== '' ? $store->getAccount($email) : null;
      if (!$a && !empty($ev['PaymentId'])) {
        foreach ($store->allAccounts() as $cand) {
          if ((string) ($cand['providerPaymentId'] ?? '') === (string) $ev['PaymentId']) { $a = $cand; break; }
        }
      }
      if ($a) {
        if (!empty($ev['RebillId'])) { $a['providerRebillId'] = (string) $ev['RebillId']; $a['cardOnFile'] = true; }
        $status = $ev['Status'] ?? '';
        if ($status === 'CONFIRMED' || $status === 'AUTHORIZED') {
          if (($a['status'] ?? '') !== 'trialing') { $a['status'] = 'active'; $a['currentPeriodEnd'] = now_ms() + (($a['interval'] ?? '') === 'year' ? 365 : 30) * DAY_MS; }
        } elseif ($status === 'REJECTED') { $a['status'] = 'past_due'; }
        $store->putAccount($a);
      }
    }
    send(200, ['received' => true]);
  }

  send(404, ['error' => 'not_found']);
} catch (Throwable $e) {
  send(500, ['error' => 'server_error', 'detail' => substr($e->getMessage(), 0, 200)]);
}
