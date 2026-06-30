'use strict';
/**
 * input-backend.js
 * Pluggable input backend. Tries to use @nut-tree-fork/nut-js for REAL input
 * control. If that native module is unavailable on this platform/build, falls
 * back to a SIMULATION backend so the whole app still runs and demonstrates.
 *
 * Public interface (all async-safe):
 *   mode                  'real' | 'simulation'
 *   ready()               Promise<void>
 *   screenSize()          Promise<{width,height}>
 *   position()            Promise<{x,y}>
 *   moveTo(x,y,steps)     Promise<void>  (eased, multi-step move)
 *   click(button)         Promise<void>  ('left'|'right')
 *   scroll(amount)        Promise<void>  (+down / -up, in ticks)
 *   tapKey(name)          Promise<void>  (safe keys only)
 */

let nut = null;
try {
  // eslint-disable-next-line global-require
  nut = require('@nut-tree-fork/nut-js');
} catch (_) {
  nut = null;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ----------------------------- REAL backend ----------------------------- */
function createRealBackend() {
  const { mouse, Button, Point, keyboard, Key, screen } = nut;
  // Move as fast as we ask; we control easing by emitting our own points.
  try { mouse.config.mouseSpeed = 3000; } catch (_) { /* noop */ }
  try { mouse.config.autoDelayMs = 0; } catch (_) { /* noop */ }

  const SAFE_KEYS = { shift: Key.LeftShift, ctrl: Key.LeftControl, f15: Key.F15 };

  let cachedSize = null;

  return {
    mode: 'real',
    async ready() { /* nut is sync-required */ },
    async screenSize() {
      if (cachedSize) return cachedSize;
      const width = await screen.width();
      const height = await screen.height();
      cachedSize = { width, height };
      return cachedSize;
    },
    async position() {
      const p = await mouse.getPosition();
      return { x: p.x, y: p.y };
    },
    async moveTo(x, y, steps = 24) {
      const { width, height } = await this.screenSize();
      const start = await this.position();
      const tx = clamp(Math.round(x), 0, width - 1);
      const ty = clamp(Math.round(y), 0, height - 1);
      const points = [];
      for (let i = 1; i <= steps; i += 1) {
        // ease-in-out cubic
        const t = i / steps;
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const jitter = (Math.sin(i * 1.7) * (1 - t)) * 1.2; // tiny human wobble
        points.push(new Point(
          Math.round(start.x + (tx - start.x) * e + jitter),
          Math.round(start.y + (ty - start.y) * e),
        ));
      }
      await mouse.move(points);
    },
    async click(button = 'left') {
      await mouse.click(button === 'right' ? Button.RIGHT : Button.LEFT);
    },
    async scroll(amount = 3) {
      if (amount >= 0) await mouse.scrollDown(Math.abs(amount));
      else await mouse.scrollUp(Math.abs(amount));
    },
    async tapKey(name = 'shift') {
      const key = SAFE_KEYS[name] || SAFE_KEYS.shift;
      await keyboard.pressKey(key);
      await keyboard.releaseKey(key);
    },
    async switchWindow() {
      // Alt+Tab (Win/Linux) / Cmd+Tab (mac): switch to another open window so the
      // monitor visibly changes between programs — reads as a real user working.
      // Hold the modifier briefly so the OS switcher registers, then release. The
      // finally block guarantees no modifier is ever left stuck down.
      const mod = process.platform === 'darwin' ? Key.LeftSuper : Key.LeftAlt;
      try {
        await keyboard.pressKey(mod);
        await keyboard.pressKey(Key.Tab);
        await new Promise((r) => setTimeout(r, 70));
        await keyboard.releaseKey(Key.Tab);
        await new Promise((r) => setTimeout(r, 220));
      } finally {
        try { await keyboard.releaseKey(Key.Tab); } catch (_) { /* noop */ }
        try { await keyboard.releaseKey(mod); } catch (_) { /* noop */ }
      }
    },
    async minimizeWindow() {
      // Best-effort minimize/restore — OS-specific; a harmless no-op where the
      // shortcut isn't bound. mac: Cmd+M, Windows/Linux: Super+Down.
      const combo = process.platform === 'darwin' ? [Key.LeftSuper, Key.M] : [Key.LeftSuper, Key.Down];
      try {
        await keyboard.pressKey(combo[0], combo[1]);
        await keyboard.releaseKey(combo[1], combo[0]);
      } catch (_) {
        try { await keyboard.releaseKey(combo[0]); await keyboard.releaseKey(combo[1]); } catch (_) { /* noop */ }
      }
    },
  };
}

/* -------------------------- SIMULATION backend -------------------------- */
function createSimBackend() {
  const size = { width: 1920, height: 1080 };
  let pos = { x: Math.round(size.width / 2), y: Math.round(size.height / 2) };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    mode: 'simulation',
    async ready() { /* nothing to init */ },
    async screenSize() { return { ...size }; },
    async position() { return { ...pos }; },
    async moveTo(x, y) {
      pos = { x: clamp(Math.round(x), 0, size.width - 1), y: clamp(Math.round(y), 0, size.height - 1) };
      await wait(6);
    },
    async click() { await wait(4); },
    async scroll() { await wait(4); },
    async tapKey() { await wait(2); },
    async switchWindow() { await wait(8); },
    async minimizeWindow() { await wait(6); },
  };
}

const backend = nut ? createRealBackend() : createSimBackend();

module.exports = backend;
