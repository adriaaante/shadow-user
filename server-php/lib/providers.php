<?php
/* providers.php — select the payment provider via DRIFTLY_PROVIDER (mock|tbank). */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/providers/mock.php';
require_once __DIR__ . '/providers/tbank.php';

function provider_select(): object {
  $want = strtolower(env('DRIFTLY_PROVIDER', 'mock'));
  if ($want === 'tbank') { $p = new TbankProvider(); if ($p->ready()) return $p; }
  return new MockProvider();
}
