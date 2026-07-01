'use strict';
/* providers/index.js — select the active payment provider.
 * DRIFTLY_PROVIDER = mock | tbank. Falls back to mock when the chosen provider
 * has no keys configured, so the server is always runnable in dev. */

const mock = require('./mock');
const tbank = require('./tbank');

const REGISTRY = { mock: mock, tbank: tbank };

function select() {
  const want = (process.env.DRIFTLY_PROVIDER || 'mock').toLowerCase();
  const p = REGISTRY[want];
  if (p && p.ready()) return p;
  if (p && !p.ready()) { console.warn(`[providers] "${want}" not configured (missing keys) → using mock`); }
  return mock;
}

module.exports = { select, REGISTRY };
