<?php
/* providers/tbank.php — T-Bank (Tinkoff) acquiring.
 *
 * Recurring model (https://developer.tbank.ru/eacq/):
 *   startTrial, first time  → Init {Recurrent:Y, ~1 ₽, OrderId trial-…} → card form.
 *                The CONFIRMED webhook carries RebillId (AddCard on this acquirer does
 *                NOT); the ~1 ₽ is refunded (Cancel) and the free 3-day trial activates.
 *   startTrial, returning   → the trial is once-per-account: Init {Recurrent:Y, FULL
 *                period amount, OrderId sub-…} → paid subscription activates on
 *                confirmation, nothing is refunded, no second trial.
 *   attachCard → same ~1 ₽ verify (trial-…) to change the saved card; never touches
 *                the trial/period.
 *   chargeRecurring → Init + Charge {PaymentId, RebillId} (no user) — renewals, run by
 *                tick.php when the trial/period ends (OrderId renew-…).
 *   webhook → T-Bank POSTs status; Token verified by recomputing the signature.
 *
 * ⚠️ Recurrent methods need рекуррентные платежи enabled on the terminal and
 * NotificationURL/SuccessURL set in the Т-Касса cabinet. The Token signature IS
 * deterministic and unit-tested. */

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

  private function verifyKopecks(): int { return max(100, (int) env('TBANK_VERIFY_KOPECKS', '100')); } // ~1 ₽

  // One Init of a recurrent payment (Recurrent=Y) that RELIABLY returns a RebillId in the
  // CONFIRMED webhook (AddCard on this acquirer yields no RebillId). The OrderId prefix tells
  // the webhook what this payment means:
  //   trial-  → ~1 ₽ card verification (refunded), used for the free trial AND card changes.
  //   sub-    → full first charge for a returning user who has no free trial left (NOT refunded).
  private function initPayment(array &$acc, int $now, int $amount, string $prefix, string $desc, string $receiptName): array {
    $r = $this->call('Init', [
      'Amount' => $amount,
      'OrderId' => $prefix . $acc['email'] . '-' . $now,
      'CustomerKey' => $acc['email'],
      'Recurrent' => 'Y',
      'Description' => $desc,
      'Receipt' => $this->receipt((string) ($acc['email'] ?? ''), $amount, $receiptName),
    ]);
    dbg_log('initPayment.resp', $r);
    if (!empty($r['Success']) && !empty($r['PaymentURL'])) {
      $acc['providerPaymentId'] = (string) ($r['PaymentId'] ?? '');
      return ['ok' => true, 'needsConfirm' => true, 'redirectUrl' => $r['PaymentURL']];
    }
    return ['ok' => false, 'error' => $r['Message'] ?? 'init_failed', 'detail' => $r['Details'] ?? null];
  }

  /** ~1 ₽ card-verification Init (refunded once confirmed). */
  private function verifyDesc(int $amount): string {
    return 'Driftly — привязка карты (возврат ' . number_format($amount / 100, 2, '.', '') . ' ₽)';
  }

  /** Refund/reverse the verification payment so the ~1 ₽ is returned. */
  function cancelPayment(string $paymentId): array {
    $r = $this->call('Cancel', ['PaymentId' => $paymentId]);
    dbg_log('Cancel.resp', $r);
    return $r;
  }

  function startTrial(array &$acc, array $pd, int $now): array {
    $acc['provider'] = 'tbank'; $acc['plan'] = 'pro';
    $acc['interval'] = (($pd['interval'] ?? '') === 'year') ? 'year' : 'month';
    $acc['canceled'] = false; $acc['cardOnFile'] = false;
    // The free 3-day trial is granted ONCE per account for all time. trialUsed is the
    // explicit marker; a persisted trialEndsAt covers accounts created before the flag
    // existed (every account that ever activated a trial has one).
    $firstTime = empty($acc['trialUsed']) && empty($acc['trialEndsAt']);
    if ($firstTime) {
      $acc['status'] = 'pending'; $acc['pendingTrial'] = true; $acc['pendingPaid'] = false;
      $amount = $this->verifyKopecks();
      $r = $this->initPayment($acc, $now, $amount, 'trial-', $this->verifyDesc($amount), 'Привязка карты Driftly');
    } else {
      $acc['status'] = 'pending'; $acc['pendingPaid'] = true; $acc['pendingTrial'] = false;
      $acc['trialUsed'] = true; // normalize accounts from before the flag existed
      $amount = $this->amountKopecks($acc);
      $r = $this->initPayment($acc, $now, $amount, 'sub-', 'Driftly Pro — подписка', 'Подписка Driftly Pro');
    }
    if (!empty($r['ok'])) {
      // Bind the pending activation to THIS payment. confirm-card must verify this exact
      // payment cleared — a later ~1 ₽ attach-card payment (which also sets cardOnFile)
      // must never be able to confirm a full 'sub-' activation. Snapshot the interval too,
      // so switching plans while pending can't stretch a month's payment into a year.
      $acc['pendingPaymentId'] = $acc['providerPaymentId'];
      $acc['pendingInterval'] = $acc['interval'];
    }
    return $r;
  }

  /** Re-bind or change the saved card WITHOUT resetting the trial/period (~1 ₽, refunded). */
  function attachCard(array &$acc): array {
    $acc['provider'] = 'tbank';
    $amount = $this->verifyKopecks();
    return $this->initPayment($acc, now_ms(), $amount, 'trial-', $this->verifyDesc($amount), 'Привязка карты Driftly');
  }

  /** Raw GetState for a payment (diagnostics + reliable RebillId capture without the webhook). */
  function getStateRaw(string $paymentId): array {
    $r = $this->call('GetState', ['PaymentId' => $paymentId]);
    dbg_log('GetState.resp', $r);
    return is_array($r) ? $r : [];
  }
  /** Raw GetCardList for a customer (also used for diagnostics). */
  function getCardListRaw(string $email): array {
    $r = $this->call('GetCardList', ['CustomerKey' => $email]);
    dbg_log('GetCardList.resp', $r);
    return is_array($r) ? $r : [];
  }
  // Confirm the card is valid (webhook-independent). The ~1 ₽ verification being CONFIRMED proves
  // the card is real and chargeable → mark cardOnFile now so the trial activates immediately; the
  // RebillId (needed for the day-4 charge) is captured here when available, otherwise by the webhook.
  function confirmCard(array &$acc): array {
    if (!empty($acc['providerRebillId'])) return ['ok' => true, 'cardOnFile' => true, 'via' => 'already'];
    if (!empty($acc['providerPaymentId'])) {
      $st = $this->getStateRaw((string) $acc['providerPaymentId']);
      if (!empty($st['RebillId'])) { $acc['providerRebillId'] = (string) $st['RebillId']; }
      if (!empty($st['RebillId']) || in_array(strtoupper((string) ($st['Status'] ?? '')), ['CONFIRMED', 'AUTHORIZED'], true)) {
        $acc['cardOnFile'] = true;
        return ['ok' => true, 'cardOnFile' => true, 'via' => 'getstate', 'status' => $st['Status'] ?? null, 'rebill' => !empty($acc['providerRebillId'])];
      }
    }
    // Fallback: a card already saved for recurrent shows up in GetCardList with a RebillId.
    $r = $this->getCardListRaw($acc['email']);
    foreach ((is_array($r) ? $r : []) as $c) {
      if (is_array($c) && ($c['Status'] ?? '') === 'A' && !empty($c['RebillId'])) {
        $acc['providerRebillId'] = (string) $c['RebillId']; $acc['cardOnFile'] = true;
        return ['ok' => true, 'cardOnFile' => true, 'via' => 'getcardlist'];
      }
    }
    return ['ok' => true, 'cardOnFile' => false, 'cards' => is_array($r) ? count($r) : 0];
  }

  function chargeRecurring(array &$acc, int $now): array {
    if (!empty($acc['canceled'])) { $acc['status'] = 'expired'; return ['ok' => false, 'status' => 'expired']; }
    if (empty($acc['providerRebillId'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due', 'reason' => 'no_rebill_id']; }
    $amount = $this->amountKopecks($acc);
    $init = $this->call('Init', ['Amount' => $amount,
      'OrderId' => 'renew-' . $acc['email'] . '-' . $now, 'CustomerKey' => $acc['email'], 'Description' => 'Driftly Pro — продление подписки',
      'Receipt' => $this->receipt((string) ($acc['email'] ?? ''), $amount, 'Подписка Driftly Pro')]);
    if (empty($init['Success']) || empty($init['PaymentId'])) { $acc['status'] = 'past_due'; return ['ok' => false, 'status' => 'past_due', 'reason' => 'init_failed']; }
    $charge = $this->call('Charge', ['PaymentId' => $init['PaymentId'], 'RebillId' => $acc['providerRebillId']]);
    if (!empty($charge['Success']) && ($charge['Status'] ?? '') === 'CONFIRMED') {
      $acc['status'] = 'active';
      $acc['currentPeriodEnd'] = $now + (($acc['interval'] ?? '') === 'year' ? 365 : 30) * DAY_MS;
      // A successful charge supersedes any pending signup — clear the flags so a stale
      // pending payment can't later trigger a second activation.
      unset($acc['pendingTrial'], $acc['pendingPaid'], $acc['pendingPaymentId'], $acc['pendingInterval']);
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
