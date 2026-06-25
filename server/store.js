'use strict';
/* server/store.js — durable storage for the licensing server, backed by SQLite.
 *
 * Uses Node's built-in `node:sqlite` (DatabaseSync) — no external dependency, no
 * native module to compile on the deploy host (requires Node >= 22.5). Real
 * transactions + WAL durability, so account/billing state survives crashes and
 * concurrent writes. Card data is NEVER stored here — the payment provider holds it.
 *
 * Account objects are stored as a JSON blob keyed by email, so the flexible
 * account shape (status, trial/period dates, provider ids, canceled, …) can evolve
 * without schema migrations. Sign-in codes and account tokens get their own tables.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

let db = null;

function init(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');   // durable + allows concurrent reads
  db.exec('PRAGMA synchronous = NORMAL'); // safe with WAL, fast
  db.exec('CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, data TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, hash TEXT NOT NULL, exp INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0)');
}

/* ---- accounts (one durable row per email) ---- */
function getAccount(email) {
  const row = db.prepare('SELECT data FROM accounts WHERE email = ?').get(email);
  return row ? JSON.parse(row.data) : null;
}
function putAccount(acc) {
  db.prepare('INSERT INTO accounts(email, data) VALUES(?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data')
    .run(acc.email, JSON.stringify(acc));
}
function allAccounts() {
  return db.prepare('SELECT data FROM accounts').all().map((r) => JSON.parse(r.data));
}

/* ---- account tokens (this device's session → email) ---- */
function emailForToken(token) {
  const row = db.prepare('SELECT email FROM tokens WHERE token = ?').get(token);
  return row ? row.email : null;
}
function putToken(token, email) {
  db.prepare('INSERT INTO tokens(token, email) VALUES(?, ?) ON CONFLICT(token) DO UPDATE SET email = excluded.email').run(token, email);
}

/* ---- passwordless sign-in codes (single-use, expiring) ---- */
function getCode(email) {
  const row = db.prepare('SELECT hash, exp, tries FROM codes WHERE email = ?').get(email);
  return row ? { hash: row.hash, exp: Number(row.exp), tries: Number(row.tries) } : null;
}
function putCode(email, rec) {
  db.prepare('INSERT INTO codes(email, hash, exp, tries) VALUES(?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET hash = excluded.hash, exp = excluded.exp, tries = excluded.tries')
    .run(email, rec.hash, rec.exp, rec.tries | 0);
}
function delCode(email) { db.prepare('DELETE FROM codes WHERE email = ?').run(email); }

function close() { if (db) { db.close(); db = null; } }

module.exports = { init, getAccount, putAccount, allAccounts, emailForToken, putToken, getCode, putCode, delCode, close };
