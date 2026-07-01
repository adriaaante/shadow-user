<?php
/* providers/tbank.php — T-Bank (Tinkoff) acquiring. Port of tbank.js to real HTTPS.
 *
 * Recurring model (https://developer.tbank.ru/eacq/):
 *   startTrial → AddCard {CheckType:3DS, CustomerKey} → PaymentURL for 0₽ card binding.
 *                The trial is FREE — nothing is charged now. The binding notification
 *                carries RebillId; we store it + set cardOnFile.
 *   chargeRecurring → Init a new payment, then Charge {PaymentId, RebillId} (no user) —
 *                the FIRST real charge, run by tick.php only when the trial/period ends.
 *   webhook → T-Bank POSTs status; Token verified by recomputing the signature.
 *
 * ⚠️ AddCard/Charge are recurrent methods — the terminal must have рекуррентные
 * платежи enabled, and NotificationURL/SuccessURL set in the Т-Касса cabinet (AddCard
 * doesn't take them per-request). Validate the round-trips on the TEST terminal before
 * going live. The Token signature IS deterministic and unit-tested. */

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

  /** 54-ФЗ fiscal receipt for Init. Taxation/VAT come from .env so they match the ИП's real
   *  regime (default: УСН «доходы», без НДС). The receipt is an array, so makeToken() excludes
   *  it from the Token — correct per T-Bank (Token uses only root-level scalars). */
  private function receipt(string $email, int $amountKopecks, string $name): array {
    return [
      'Email' => $email !== '' ? $email : (env('MAIL_FROM_EMAIL', 'support@driftly.site')),
      'Taxation' => env('TBANK_TAXATION', 'usn_income'),
      'Items' => [[
        'Name' => mb_substr($name, 0, 64),
        'Price' => $amountKopecks,
        'Quantity' => 1,
        'Amount' => $amountKopecks,
        'Tax' => env('TBANK_VAT', 'none'),
        'PaymentMethod' => 'full_payment',
        'PaymentObject' => 'service',
      ]],
    ];
  }

  // FREE trial / card change: BIND the card without charging. AddCard runs a 0₽ verification and
  // returns a RebillId in the binding notification; the first real charge is tick.php on day 4.
  private function bindCardUrl(array &$acc): array {
    $r = $this->call('AddCard', [
      'CustomerKey' => $acc['email'],
      'CheckType' => env('TBANK_CHECKTYPE', '3DS'), // NO | 3DS | HOLD | 3DSHOLD — 3DS can fail to link on test terminals
    ]);
    dbg_log('AddCard.resp', $r);
    if (!empty($r['Success']) && !empty($r['PaymentURL'])) {
      $acc['providerRequestKey'] = $r['RequestKey'] ?? null;
      return ['ok' => true, 'needsConfirm' => true, 'redirectUrl' => $r['PaymentURL']];
    }
    return ['ok' => false, 'error' => $r['Message'] ?? 'addcard_failed', 'detail' => $r['Details'] ?? null];
  }

  function startTrial(array &$acc, array $pd, int $now): array {
    $acc['provider'] = 'tbank'; $acc['plan'] = 'pro'; $acc['status'] = 'trialing';
    $acc['trialEndsAt'] = $now + TRIAL_DAYS * DAY_MS; $acc['canceled'] = false;
    $acc['interval'] = (($pd['interval'] ?? '') === 'year') ? 'year' : 'month';
    $acc['cardOnFile'] = false;
    return $this->bindCardUrl($acc);
  }

  /** Re-bind or change the saved card WITHOUT resetting the trial/period. */
  function attachCard(array &$acc): array {
    $acc['provider'] = 'tbank';
    return $this->bindCardUrl($acc);
  }

  function chargeRecurring(array &$acc, int $now): array {
    if (!empty($acc['canceled'])) { $acc['status'] = 'expired'; return ['ok' => false, 'status' => 'expired']; }
    if (empty($acc['providerRebillId'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due', 'reason' => 'no_rebill_id']; }
    $amount = $this->amountKopecks($acc);
    $init = $this->call('Init', ['Amount' => $amount,
      'OrderId' => 'renew-' . $acc['email'] . '-' . $now, 'CustomerKey' => $acc['email'], 'Description' => 'Driftly Pro renewal',
      'Receipt' => $this->receipt((string) ($acc['email'] ?? ''), $amount, 'Подписка Driftly Pro')]);
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

  /** TEMP (T-Bank certification): create a standard one-off payment (Init) so their
   *  test cards can run success/fail/refund. Not used by the product flow. */
  function testInit(int $amountKopecks, string $orderId, string $email = 'test@driftly.site'): array {
    $r = $this->call('Init', ['Amount' => $amountKopecks, 'OrderId' => $orderId, 'Description' => 'Driftly certification test',
      'Receipt' => $this->receipt($email, $amountKopecks, 'Подписка Driftly Pro (тест)')]);
    if (!empty($r['Success']) && !empty($r['PaymentURL'])) return ['ok' => true, 'url' => $r['PaymentURL'], 'paymentId' => $r['PaymentId'] ?? null];
    return ['ok' => false, 'error' => $r['Message'] ?? 'init_failed', 'detail' => $r['Details'] ?? null, 'raw' => $r];
  }

  function verifyWebhook(array $headers, string $raw): ?array {
    $body = json_decode($raw ?: '{}', true);
    if (!is_array($body)) return null;
    $received = (string) ($body['Token'] ?? '');
    $check = $body; unset($check['Token']);
    return hash_equals($this->makeToken($check), $received) ? $body : null;
  }
}
