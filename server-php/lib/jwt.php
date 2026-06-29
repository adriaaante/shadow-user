<?php
/* server-php/lib/jwt.php — ES256 (ECDSA P-256) license token codec.
 *
 * Produces the SAME JWT-like token the clients expect: b64url(header).b64url(payload).b64url(sig)
 * Signature is raw R||S (64 bytes, IEEE-P1363) so JS (Node crypto / WebCrypto) verifies it
 * with dsaEncoding 'ieee-p1363'. Uses openssl only — no sodium dependency. */

function b64url_encode(string $bin): string {
  return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}
function b64url_decode(string $s): string {
  return base64_decode(strtr($s, '-_', '+/'));
}

/* Convert an OpenSSL ECDSA signature (ASN.1 DER) to raw R||S of $size*2 bytes. */
function ecdsa_der_to_raw(string $der, int $size = 32): string {
  $off = 0;
  if (ord($der[$off++]) !== 0x30) throw new Exception('bad der: no sequence');
  // sequence length (skip; supports short and one-byte long form)
  $len = ord($der[$off++]);
  if ($len & 0x80) { $n = $len & 0x7f; $off += $n; }
  $read = function () use ($der, &$off, $size) {
    if (ord($der[$off++]) !== 0x02) throw new Exception('bad der: no integer');
    $l = ord($der[$off++]);
    $v = substr($der, $off, $l); $off += $l;
    $v = ltrim($v, "\x00");                       // strip sign/zero padding
    return str_pad($v, $size, "\x00", STR_PAD_LEFT); // left-pad to fixed size
  };
  $r = $read(); $s = $read();
  return $r . $s;
}

/* Convert raw R||S back to ASN.1 DER (for openssl_verify). */
function ecdsa_raw_to_der(string $raw, int $size = 32): string {
  $r = substr($raw, 0, $size); $s = substr($raw, $size, $size);
  $enc = function ($v) {
    $v = ltrim($v, "\x00");
    if ($v === '') $v = "\x00";
    if (ord($v[0]) & 0x80) $v = "\x00" . $v;       // ensure positive integer
    return "\x02" . chr(strlen($v)) . $v;
  };
  $body = $enc($r) . $enc($s);
  return "\x30" . chr(strlen($body)) . $body;
}

/* Sign a payload (assoc array) → ES256 token. $privPem is an EC P-256 private key PEM. */
function jwt_sign_es256(array $payload, string $privPem): string {
  $header = ['alg' => 'ES256', 'typ' => 'DLT'];
  $input = b64url_encode(json_encode($header, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))
    . '.' . b64url_encode(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
  $key = openssl_pkey_get_private($privPem);
  if (!$key) throw new Exception('bad private key');
  $der = '';
  if (!openssl_sign($input, $der, $key, OPENSSL_ALGO_SHA256)) throw new Exception('sign failed');
  return $input . '.' . b64url_encode(ecdsa_der_to_raw($der, 32));
}

/* Verify a token with an EC public key PEM → payload array, or null. (server self-test) */
function jwt_verify_es256(string $token, string $pubPem): ?array {
  $parts = explode('.', $token);
  if (count($parts) !== 3) return null;
  [$h, $p, $s] = $parts;
  $input = $h . '.' . $p;
  $der = ecdsa_raw_to_der(b64url_decode($s), 32);
  $key = openssl_pkey_get_public($pubPem);
  if (!$key) return null;
  $ok = openssl_verify($input, $der, $key, OPENSSL_ALGO_SHA256);
  if ($ok !== 1) return null;
  $payload = json_decode(b64url_decode($p), true);
  return is_array($payload) ? $payload : null;
}
