'use strict';
/**
 * scheduler.js
 * Decides whether "now" falls inside an active working window (weekdays +
 * one or more time ranges). It only ever reports active/inactive; main.js
 * combines that with the run mode to enable/disable the generator. The
 * monitor always runs, so passive measurement continues outside windows.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
}

class Scheduler {
  constructor() {
    this.cfg = {
      days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
      ranges: [{ start: '09:00', end: '18:00' }],
    };
    this.active = false;
    this._timer = null;
    this.onChange = null;
  }

  configure(patch = {}) {
    if (patch.days) this.cfg.days = { ...this.cfg.days, ...patch.days };
    if (Array.isArray(patch.ranges)) this.cfg.ranges = patch.ranges;
    this._evaluate();
  }

  isActiveAt(date = new Date()) {
    const dayKey = DAY_KEYS[date.getDay()];
    if (!this.cfg.days[dayKey]) return false;
    const mins = date.getHours() * 60 + date.getMinutes();
    return this.cfg.ranges.some((r) => {
      const s = toMinutes(r.start);
      const e = toMinutes(r.end);
      if (s === e) return false;
      if (s < e) return mins >= s && mins < e;          // same-day window
      return mins >= s || mins < e;                     // window crosses midnight
    });
  }

  /** Minutes until the schedule state next flips (for the UI hint). */
  minutesUntilChange(date = new Date()) {
    const now = this.isActiveAt(date);
    for (let i = 1; i <= 24 * 60; i += 1) {
      const t = new Date(date.getTime() + i * 60000);
      if (this.isActiveAt(t) !== now) return i;
    }
    return null;
  }

  _evaluate() {
    const next = this.isActiveAt(new Date());
    if (next !== this.active) {
      this.active = next;
      if (this.onChange) this.onChange(next);
    }
  }

  start(onChange) {
    this.onChange = onChange;
    this.active = this.isActiveAt(new Date());
    if (this.onChange) this.onChange(this.active);
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this._evaluate(), 20000);
  }

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
}

module.exports = new Scheduler();
