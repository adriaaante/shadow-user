'use strict';
/**
 * monitor.js
 * Global input monitor. Uses uiohook-napi to observe EVERY input event on the
 * machine (real human + synthetic), and tags each as synthetic or real.
 *
 * Tagging strategy: the generator brackets each injected action with
 * beginInject()/endInject(). Any hook event observed while injection is active
 * (plus a tiny grace window for late OS delivery) is classified SYNTHETIC;
 * everything else is REAL human input. This is what lets Driftly measure
 * activity *with* and *without* its own generator, and separate the two.
 *
 * If uiohook-napi is unavailable (simulation builds), the monitor runs in
 * 'self-report' mode: only synthetic events — pushed by the generator via
 * report() — are counted. Real human input cannot be observed without the
 * native module, which the UI makes clear.
 */

let uiohook = null;
try {
  // eslint-disable-next-line global-require
  uiohook = require('uiohook-napi');
} catch (_) {
  uiohook = null;
}

const GRACE_MS = 50; // synthetic events may be delivered slightly after injection ends

class Monitor {
  constructor() {
    this.mode = uiohook ? 'global' : 'self-report';
    this.handler = null;
    this._injectDepth = 0;
    this._lastInjectEnd = 0;
    this._lastRealTs = 0;
    this._lastPos = { x: 0, y: 0 };
    this._running = false;
    this._hook = uiohook ? uiohook.uIOhook : null;
  }

  onActivity(cb) { this.handler = cb; }

  /** Generator calls this immediately before injecting input. */
  beginInject() { this._injectDepth += 1; }

  /** Generator calls this immediately after injecting input. */
  endInject() {
    this._injectDepth = Math.max(0, this._injectDepth - 1);
    this._lastInjectEnd = Date.now();
  }

  _isInjecting() {
    return this._injectDepth > 0 || (Date.now() - this._lastInjectEnd) < GRACE_MS;
  }

  /** ms since the last REAL human event (Infinity if none / unknown). */
  msSinceRealActivity() {
    return this._lastRealTs ? (Date.now() - this._lastRealTs) : Infinity;
  }

  _emit(kind, x, y) {
    const synthetic = this._isInjecting();
    const ts = Date.now();
    if (!synthetic) this._lastRealTs = ts;
    if (typeof x === 'number') this._lastPos = { x, y };
    if (this.handler) {
      this.handler({ kind, x: x ?? this._lastPos.x, y: y ?? this._lastPos.y, synthetic, ts });
    }
  }

  /**
   * Self-report path (simulation mode): generator reports its own synthetic
   * actions so metrics/charts still work without the native hook.
   */
  report(kind, x, y) {
    if (this.mode !== 'self-report') return;
    const ts = Date.now();
    if (typeof x === 'number') this._lastPos = { x, y };
    if (this.handler) this.handler({ kind, x: x ?? this._lastPos.x, y: y ?? this._lastPos.y, synthetic: true, ts });
  }

  start() {
    if (this._running) return;
    this._running = true;
    if (!this._hook) return; // self-report mode, nothing to start
    const h = this._hook;
    h.on('mousemove', (e) => this._emit('move', e.x, e.y));
    h.on('mousedown', (e) => this._emit('click', e.x, e.y));
    h.on('wheel', (e) => this._emit('scroll', e.x, e.y));
    h.on('keydown', () => this._emit('key'));
    try { h.start(); } catch (_) { this.mode = 'self-report'; this._hook = null; }
  }

  stop() {
    this._running = false;
    if (this._hook) { try { this._hook.stop(); } catch (_) { /* noop */ } }
  }
}

module.exports = new Monitor();
