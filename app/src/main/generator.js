'use strict';
/**
 * generator.js
 * The synthetic activity engine. Produces humanized mouse movement, clicks,
 * scroll and (optionally) safe keystrokes at a rate driven by the activity
 * level. Every injected action is bracketed with monitor.beginInject/endInject
 * so the monitor can tag the resulting events as synthetic.
 */

const backend = require('./input-backend');
const monitor = require('./monitor');

const PRESET_INTENSITY = { gentle: 20, balanced: 50, energetic: 85 };
// Exact per-minute rates for presets (kept in sync with PLAN.md and the website).
const PRESET_RATES = {
  gentle: { move: 6, click: 0.5, scroll: 1, key: 0.3, window: 0.2 },
  balanced: { move: 18, click: 2, scroll: 3, key: 0.6, window: 0.5 },
  energetic: { move: 40, click: 5, scroll: 6, key: 1, window: 1 },
};

function lerp(a, b, t) { return a + (b - a) * t; }
function rnd(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class Generator {
  constructor() {
    this.running = false;
    this._timer = null;
    this._size = { width: 1920, height: 1080 };
    this.cfg = {
      level: 'balanced',      // 'gentle'|'balanced'|'energetic'|'custom'
      intensity: 50,          // used when level === 'custom'
      includeClicks: true,
      includeScroll: true,
      includeKeys: false,     // safe keys, OFF by default
      keyName: 'shift',
      switchWindows: false,   // Alt+Tab / minimize real windows (screen changes), OFF by default
      pauseOnUser: true,
      pauseThresholdMs: 3000,
    };
    this.stats = { actions: 0, lastAction: null, lastAt: 0, backedOff: 0 };
  }

  configure(patch = {}) { Object.assign(this.cfg, patch); }

  _intensity() {
    if (this.cfg.level === 'custom') return Math.max(1, Math.min(100, this.cfg.intensity));
    return PRESET_INTENSITY[this.cfg.level] ?? 50;
  }

  rates() {
    let base;
    if (this.cfg.level === 'custom') {
      const t = this._intensity() / 100;
      base = { move: lerp(4, 50, t), click: lerp(0.3, 6, t), scroll: lerp(0.5, 7, t), key: lerp(0.2, 2.2, t), window: lerp(0.1, 1.2, t) };
    } else {
      base = PRESET_RATES[this.cfg.level] || PRESET_RATES.balanced;
    }
    return {
      move: base.move,
      click: this.cfg.includeClicks ? base.click : 0,
      scroll: this.cfg.includeScroll ? base.scroll : 0,
      key: this.cfg.includeKeys ? base.key : 0,
      window: this.cfg.switchWindows ? base.window : 0,
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    try { this._size = await backend.screenSize(); } catch (_) { /* keep default */ }
    this._scheduleNext(300);
  }

  stop() {
    this.running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _scheduleNext(ms) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._tick().catch(() => {}), ms);
  }

  _nextDelay() {
    const r = this.rates();
    const perMin = Math.max(0.1, r.move + r.click + r.scroll + r.key + r.window);
    const base = 60000 / perMin;
    return Math.round(base * rnd(0.55, 1.6));
  }

  _chooseAction() {
    const r = this.rates();
    const bag = [];
    bag.push(['move', r.move]);
    if (r.click > 0) bag.push(['click', r.click]);
    if (r.scroll > 0) bag.push(['scroll', r.scroll]);
    if (r.key > 0) bag.push(['key', r.key]);
    if (r.window > 0) bag.push(['window', r.window]);
    const total = bag.reduce((a, [, w]) => a + w, 0);
    let x = Math.random() * total;
    for (const [name, w] of bag) { if ((x -= w) <= 0) return name; }
    return 'move';
  }

  _target() {
    const { width, height } = this._size;
    const mx = Math.round(width * 0.04);
    const my = Math.round(height * 0.04);
    return {
      x: Math.round(rnd(mx, width - mx)),
      y: Math.round(rnd(my, height - my)),
    };
  }

  async _inject(fn, kind, reportXY) {
    monitor.beginInject();
    try { await fn(); } finally { monitor.endInject(); }
    // In self-report mode the global hook can't see us, so report directly.
    if (monitor.mode === 'self-report') monitor.report(kind, reportXY && reportXY.x, reportXY && reportXY.y);
    this.stats.actions += 1;
    this.stats.lastAction = kind;
    this.stats.lastAt = Date.now();
  }

  async _tick() {
    if (!this.running) return;

    // Back off if the real user is active (never fight the human).
    if (this.cfg.pauseOnUser && monitor.msSinceRealActivity() < this.cfg.pauseThresholdMs) {
      this.stats.backedOff += 1;
      this._scheduleNext(Math.round(this.cfg.pauseThresholdMs * rnd(0.6, 1.1)));
      return;
    }

    const action = this._chooseAction();
    try {
      if (action === 'move') {
        const t = this._target();
        await this._inject(() => backend.moveTo(t.x, t.y, Math.round(rnd(14, 30))), 'move', t);
      } else if (action === 'click') {
        if (Math.random() < 0.6) {
          const t = this._target();
          await this._inject(() => backend.moveTo(t.x, t.y, Math.round(rnd(12, 24))), 'move', t);
        }
        await this._inject(() => backend.click('left'), 'click');
      } else if (action === 'scroll') {
        const amount = pick([-3, -2, -1, 1, 2, 3]);
        await this._inject(() => backend.scroll(amount), 'scroll');
      } else if (action === 'key') {
        await this._inject(() => backend.tapKey(this.cfg.keyName), 'key');
      } else if (action === 'window') {
        // Mostly switch windows (Alt/Cmd+Tab); occasionally minimize/restore. Reported
        // as a key action — it's keyboard-driven. pauseOnUser already keeps it idle-only.
        if (Math.random() < 0.8) await this._inject(() => backend.switchWindow(), 'key');
        else await this._inject(() => backend.minimizeWindow(), 'key');
      }
    } catch (_) { /* swallow transient backend errors */ }

    if (this.running) this._scheduleNext(this._nextDelay());
  }
}

module.exports = new Generator();
