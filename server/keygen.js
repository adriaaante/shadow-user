'use strict';
/* server/keygen.js — generate the Ed25519 keypair for license signing.
 * Private key → server/.keys/ (gitignored, never leaves the server).
 * Public key → shared/license-public.pem (committed, embedded in the clients). */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { KEY_DIR, PRIV_PATH, PUB_PATH } = require('./lib');

if (fs.existsSync(PRIV_PATH) && !process.argv.includes('--force')) {
  console.log('Key already exists at', PRIV_PATH, '\nUse --force to overwrite.');
  process.exit(0);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.mkdirSync(KEY_DIR, { recursive: true });
fs.writeFileSync(PRIV_PATH, privPem);
fs.writeFileSync(path.join(KEY_DIR, 'ed25519-public.pem'), pubPem);
fs.writeFileSync(PUB_PATH, pubPem);

console.log('Generated Ed25519 keypair.');
console.log('  private (keep secret):', PRIV_PATH);
console.log('  public  (committed)  :', PUB_PATH);
