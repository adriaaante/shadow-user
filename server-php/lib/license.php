<?php
/* server-php/lib/license.php — build + sign the license token from an account.
 * Mirrors the Node server's lib.js issueLicense(). */

require_once __DIR__ . '/jwt.php';
require_once __DIR__ . '/entitlement.php';

/** The signed payload (7-day offline grace; real access still bounded by the dates). */
function license_payload(array $acc, ?int $nowMs = null): array {
  $now = $nowMs ?? now_ms();
  return [
    'sub' => $acc['email'],
    'plan' => $acc['plan'] ?? 'free',
    'status' => $acc['status'] ?? 'free',
    'canceled' => (bool) ($acc['canceled'] ?? false),
    'interval' => $acc['interval'] ?? 'month',
    'trialEndsAt' => $acc['trialEndsAt'] ?? null,
    'currentPeriodEnd' => $acc['currentPeriodEnd'] ?? null,
    'iat' => $now,
    'exp' => $now + 7 * DAY_MS,
  ];
}

/** Load the EC private key PEM (env LICENSE_PRIVATE_KEY, or .keys/ec-private.pem). */
function license_private_key(): ?string {
  $pem = getenv('LICENSE_PRIVATE_KEY');
  if ($pem) return $pem;
  $path = __DIR__ . '/../.keys/ec-private.pem';
  return is_file($path) ? file_get_contents($path) : null;
}

/** Issue a signed license for an account → ['token'=>..., 'payload'=>...] or null. */
function issue_license(array $acc, ?int $nowMs = null): ?array {
  $priv = license_private_key();
  if (!$priv) return null;
  $payload = license_payload($acc, $nowMs);
  return ['token' => jwt_sign_es256($payload, $priv), 'payload' => $payload];
}
