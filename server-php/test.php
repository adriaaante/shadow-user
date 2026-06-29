<?php
/* server-php/test.php — local test of the PHP backend core (store + license +
 * entitlement) against an in-memory SQLite DB. Run: php test.php */

require_once __DIR__ . '/lib/store.php';
require_once __DIR__ . '/lib/license.php';
require_once __DIR__ . '/lib/entitlement.php';

$pass = 0; $fail = 0;
function ok($name, $cond) { global $pass, $fail; if ($cond) { $pass++; echo "  ✓ $name\n"; } else { $fail++; echo "  ✗ FAIL: $name\n"; } }

// ensure a keypair exists for signing
if (!is_file(__DIR__ . '/.keys/ec-private.pem')) { passthru('php ' . escapeshellarg(__DIR__ . '/keygen.php') . ' >/dev/null'); }
$pub = file_get_contents(__DIR__ . '/.keys/ec-public.pem');

$store = new Store(new PDO('sqlite::memory:'));

// ---- accounts ----
$store->putAccount(['email' => 'alice@example.com', 'plan' => 'none', 'status' => 'none']);
$a = $store->getAccount('alice@example.com');
ok('account upsert + read', $a && $a['email'] === 'alice@example.com');

// ---- license sign + verify + entitlement ----
$now = now_ms();
$acc = ['email' => 'alice@example.com', 'plan' => 'pro', 'status' => 'trialing',
  'interval' => 'month', 'trialEndsAt' => $now + 3 * DAY_MS, 'currentPeriodEnd' => null, 'canceled' => false];
$issued = issue_license($acc, $now);
ok('license issued', $issued && !empty($issued['token']));
$verified = jwt_verify_es256($issued['token'], $pub);
ok('license verifies (ES256)', $verified && $verified['sub'] === 'alice@example.com' && $verified['status'] === 'trialing');
$ent = ent_compute($verified, $now);
ok('trialing → access granted', $ent['access'] === true && $ent['reason'] === 'trial');
ok('trial shows ~3 days', $ent['trialDaysLeft'] === 3);

// tamper
$bad = substr($issued['token'], 0, -2) . (substr($issued['token'], -2) === 'AA' ? 'BB' : 'AA');
ok('tampered token rejected', jwt_verify_es256($bad, $pub) === null);

// past_due / expired / none
ok('past_due → blocked + needsPayment', (function () use ($now) {
  $e = ent_compute(['sub' => 'x', 'status' => 'past_due'], $now); return $e['blocked'] && $e['needsPayment']; })());
ok('expired trial → blocked, not past_due', (function () use ($now) {
  $e = ent_compute(['sub' => 'x', 'status' => 'trialing', 'trialEndsAt' => $now - 1000], $now);
  return $e['blocked'] && $e['needsPayment'] === false; })());
ok('no license → blocked(none)', ent_compute(null, $now)['reason'] === 'none');

// yearly period
$accY = ['email' => 'y@e.com', 'plan' => 'pro', 'status' => 'active', 'interval' => 'year',
  'currentPeriodEnd' => $now + 365 * DAY_MS];
ok('active yearly → access', ent_compute(license_payload($accY, $now), $now)['access'] === true);

// ---- device cap (max 2): a 3rd token evicts the oldest ----
foreach (['t1', 't2', 't3'] as $t) { $store->putToken($t, 'bob@e.com'); }
$store->pruneTokens('bob@e.com', 2);
ok('device cap = 2 (oldest evicted)',
  $store->emailForToken('t1') === null && $store->emailForToken('t2') === 'bob@e.com' && $store->emailForToken('t3') === 'bob@e.com');
$store->delToken('t2');
ok('sign-out frees a slot', $store->emailForToken('t2') === null);

// ---- codes ----
$store->putCode('c@e.com', ['hash' => 'abc', 'exp' => $now + 600000, 'tries' => 0]);
$c = $store->getCode('c@e.com');
ok('code stored + read', $c && $c['hash'] === 'abc' && $c['tries'] === 0);
$store->delCode('c@e.com');
ok('code deleted', $store->getCode('c@e.com') === null);

echo "\nRESULT: $pass passed, $fail failed\n";
exit($fail ? 1 : 0);
