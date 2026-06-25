'use strict';
/* shared/verify-node.js
 * Node-side Ed25519 verification of a Driftly license token. Used by the desktop
 * app (offline, tamper-resistant) and by the server's self-test. The embedded
 * PUBLIC key verifies tokens signed by the licensing server's PRIVATE key. */

const crypto = require('crypto');
const license = require('./license');

/**
 * Verify a token against an Ed25519 public key (PEM string).
 * Returns the decoded payload if the signature is valid AND not expired, else null.
 */
function verify(token, publicKeyPem, nowMs) {
  const input = license.signingInput(token);
  const sig = license.signature(token);
  if (!input || !sig) return null;
  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.from(input),
      publicKeyPem,
      Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    );
  } catch (e) { return null; }
  if (!ok) return null;
  const payload = license.decode(token);
  if (!payload || license.isExpired(payload, nowMs)) return null;
  return payload;
}

module.exports = { verify };
