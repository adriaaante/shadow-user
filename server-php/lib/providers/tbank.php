<?php
/* providers/tbank.php — T-Bank (Tinkoff) acquiring. Port of tbank.js to real HTTPS.
 *
 * Recurring model (https://www.tbank.ru/kassa/dev/payments/):
 *   startTrial → Init {Recurrent:Y, CustomerKey} → return PaymentURL for 3-DS card binding.
 *                On the payment notification store RebillId + cardOnFile.
 *   chargeRecurring → Init a new payment, then Charge {PaymentId, RebillId} (no user).
 *   webhook → T-Bank POSTs status; Token verified by recomputing the signature.
 *
 * ⚠️ The Init/Charge/webhook round-trips MUST be validated against the T-Bank TEST
 * terminal before going live (can't be unit-tested without it). The Token signature
 * IS deterministic and unit-tested. */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../entitlement.php';

class TbankProvider {
  private string $terminalKey, $password, $api;
  function __construct() {
    $this->terminalKey = env('TBANK_TERMINAL_KEY', '');
    $this->password = env('TBANK_PASSWORD', '');
    $this->api = rtrim(env('TBANK_API', 'https://securepay.tinkoff.ru/v2'), '/');
  }
  function name(): string { return 'tbank'; }
  function ready(): bool { return $this->terminalKey !== '' && $this->password !== ''; }

  /** Token = SHA-256 of root scalar params (incl. Password), sorted by key, values joined. */
  function makeToken(array $params): string {
    $data = $params;
    $data['Password'] = $this->password;
    $data = array_filter($data, fn ($v) => !is_array($v) && !is_object($v) && $v !== null);
    ksort($data);
    $concat = implode('', array_map(fn ($v) => is_bool($v) ? ($v ? 'true' : 'false') : (string) $v, $data));
    return hash('sha256', $concat);
  }

  private function call(string $method, array $params): array {
    $params['TerminalKey'] = $this->terminalKey;
    $params['Token'] = $this->makeToken($params);
    $ch = curl_init($this->api . '/' . $method);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
      CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($params)]);
    $res = curl_exec($ch); curl_close($ch);
    return json_decode($res ?: '{}', true) ?: [];
  }

  private function amountKopecks(array $acc): int {
    $p = ent_plan();
    return (($acc['interval'] ?? '') === 'year' ? $p['priceYearly'] : $p['priceMonthly']) * 100;
  }

  function startTrial(array &$acc, array $pd, int $now): array {
    $acc['provider'] = 'tbank'; $acc['plan'] = 'pro'; $acc['status'] = 'trialing';
    $acc['trialEndsAt'] = $now + TRIAL_DAYS * DAY_MS; $acc['canceled'] = false;
    $acc['interval'] = (($pd['interval'] ?? '') === 'year') ? 'year' : 'month';
    $acc['cardOnFile'] = false; $acc['_pendingConfirm'] = true;
    $r = $this->call('Init', [
      'Amount' => $this->amountKopecks($acc),
      'OrderId' => 'trial-' . $acc['email'] . '-' . $now,
      'Recurrent' => 'Y', 'CustomerKey' => $acc['email'],
      'NotificationURL' => env('TBANK_NOTIFICATION_URL', ''),
      'SuccessURL' => env('TBANK_SUCCESS_URL', ''), 'FailURL' => env('TBANK_FAIL_URL', ''),
      'Description' => 'Driftly Pro',
    ]);
    if (!empty($r['Success']) && !empty($r['PaymentURL'])) {
      $acc['providerPaymentId'] = $r['PaymentId'] ?? null;
      return ['ok' => true, 'needsConfirm' => true, 'redirectUrl' => $r['PaymentURL']];
    }
    return ['ok' => false, 'error' => $r['Message'] ?? 'init_failed', 'detail' => $r['Details'] ?? null];
  }

  function chargeRecurring(array &$acc, int $now): array {
    if (!empty($acc['canceled'])) { $acc['status'] = 'expired'; return ['ok' => false, 'status' => 'expired']; }
    if (empty($acc['providerRebillId'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due', 'reason' => 'no_rebill_id']; }
    $init = $this->call('Init', ['Amount' => $this->amountKopecks($acc),
      'OrderId' => 'renew-' . $acc['email'] . '-' . $now, 'CustomerKey' => $acc['email'], 'Description' => 'Driftly Pro renewal']);
    if (empty($init['Success']) || empty($init['PaymentId'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due', 'reason' => 'init_failed']; }
    $charge = $this->call('Charge', ['PaymentId' => $init['PaymentId'], 'RebillId' => $acc['providerRebillId']]);
    if (!empty($charge['Success']) && ($charge['Status'] ?? '') === 'CONFIRMED') {
      $acc['status'] = 'active';
      $acc['currentPeriodEnd'] = $now + (($acc['interval'] ?? '') === 'year' ? 365 : 30) * DAY_MS;
      return ['ok' => true, 'status' => 'active', 'currentPeriodEnd' => $acc['currentPeriodEnd']];
    }
    $acc['status'] = 'past_due';
    return ['ok' => false, 'status' => 'past_due', 'reason' => $charge['Message'] ?? 'charge_failed'];
  }

  function verifyWebhook(array $headers, string $raw): ?array {
    $body = json_decode($raw ?: '{}', true);
    if (!is_array($body)) return null;
    $received = (string) ($body['Token'] ?? '');
    $check = $body; unset($check['Token']);
    return hash_equals($this->makeToken($check), $received) ? $body : null;
  }
}
