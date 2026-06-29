'use strict';
/* shared/verify-node.js
 * Node-side ES256 (ECDSA P-256) verification of a Driftly license token. Used by the
 * desktop app (offline, tamper-resistant) and by the server's self-test. The embedded
 * PUBLIC key verifies tokens signed by the licensing server's PRIVATE key.
 * Signature is raw R||S (IEEE-P1363), matching both the PHP and Node signers. */

const crypto = require('crypto');
const license = require('./license');

/**
 * Verify a token against an EC P-256 public key (PEM string).
 * Returns the decoded payload if the signature is valid AND not expired, else null.
 */
function verify(token, publicKeyPem, nowMs) {
  const input = license.signingInput(token);
  const sig = license.signature(token);
  if (!input || !sig) return null;
  let ok = false;
  try {
    ok = crypto.verify(
      'sha256',
      Buffer.from(input),
      { key: publicKeyPem, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    );
  } catch (e) { return null; }
  if (!ok) return null;
  const payload = license.decode(token);
  if (!payload || license.isExpired(payload, nowMs)) return null;
  return payload;
}

module.exports = { verify };
