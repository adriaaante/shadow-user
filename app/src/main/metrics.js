'use strict';
/**
 * metrics.js
 * Per-minute activity buckets. Each bucket counts events split by source
 * (synthetic vs real) and records whether the generator was enabled during
 * that minute (shadow vs passive). This is the data behind the Compare view
 * and the CSV/JSON export used to benchmark an external measuring tool.
 */

const MIN = 60 * 1000;
const DEFAULT_RETENTION_DAYS = 14;

// Event weights → a normalized 0..100 activity score per minute.
const W = { move: 0.35, click: 8, scroll: 3, key: 5 };

function minuteOf(ts) { return Math.floor(ts / MIN) * MIN; }

function emptyCounts() { return { move: 0, click: 0, scroll: 0, key: 0 }; }

function scoreOf(counts) {
  const raw = counts.move * W.move + counts.click * W.click
    + counts.scroll * W.scroll + counts.key * W.key;
  return Math.min(100, Math.round(raw));
}

class Metrics {
  constructor() {
    this.buckets = new Map(); // minuteTs -> bucket
    this.retentionDays = DEFAULT_RETENTION_DAYS;
    this._genEnabled = false;
    this._recent = []; // [{ts, synthetic}] last ~10s, for the live gauge
  }

  setGeneratorEnabled(on) { this._genEnabled = !!on; }

  _bucket(ts) {
    const m = minuteOf(ts);
    let b = this.buckets.get(m);
    if (!b) {
      b = { ts: m, genEnabled: this._genEnabled, synthetic: emptyCounts(), real: emptyCounts() };
      this.buckets.set(m, b);
      this._prune();
    }
    // If the generator turns on at any point during the minute, mark the
    // minute as a shadow minute (it contained generated activity).
    if (this._genEnabled) b.genEnabled = true;
    return b;
  }

  record(ev) {
    const b = this._bucket(ev.ts);
    const bag = ev.synthetic ? b.synthetic : b.real;
    if (bag[ev.kind] !== undefined) bag[ev.kind] += 1;
    this._recent.push({ ts: ev.ts, synthetic: ev.synthetic });
    const cutoff = ev.ts - 10000;
    while (this._recent.length && this._recent[0].ts < cutoff) this._recent.shift();
  }

  _prune() {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * MIN;
    for (const k of this.buckets.keys()) if (k < cutoff) this.buckets.delete(k);
  }

  /** Instantaneous activity for the live gauge (0..100) + recent rates. */
  live() {
    const now = Date.now();
    const win = this._recent.filter((e) => e.ts >= now - 10000);
    const syn = win.filter((e) => e.synthetic).length;
    const real = win.length - syn;
    // events in 10s → scale to a friendly 0..100 gauge
    const gauge = Math.min(100, Math.round(win.length * 2.2));
    return { gauge, eventsPer10s: win.length, synthetic: syn, real };
  }

  /** Returns N contiguous minute buckets (gaps filled empty), oldest→newest. */
  series(minutes = 60) {
    const out = [];
    const end = minuteOf(Date.now());
    for (let i = minutes - 1; i >= 0; i -= 1) {
      const ts = end - i * MIN;
      const b = this.buckets.get(ts);
      if (b) {
        out.push({
          ts,
          genEnabled: b.genEnabled,
          synthetic: scoreOf(b.synthetic),
          real: scoreOf(b.real),
          total: scoreOf({
            move: b.synthetic.move + b.real.move,
            click: b.synthetic.click + b.real.click,
            scroll: b.synthetic.scroll + b.real.scroll,
            key: b.synthetic.key + b.real.key,
          }),
          counts: { synthetic: b.synthetic, real: b.real },
        });
      } else {
        out.push({ ts, genEnabled: false, synthetic: 0, real: 0, total: 0, counts: { synthetic: emptyCounts(), real: emptyCounts() } });
      }
    }
    return out;
  }

  /** Aggregate summary incl. the shadow-vs-passive comparison. */
  summary() {
    const all = [...this.buckets.values()];
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const today = all.filter((b) => b.ts >= startOfDay.getTime());

    const sum = (arr, src, kind) => arr.reduce((a, b) => a + b[src][kind], 0);
    const totals = (arr) => ({
      synthetic: { move: sum(arr, 'synthetic', 'move'), click: sum(arr, 'synthetic', 'click'), scroll: sum(arr, 'synthetic', 'scroll'), key: sum(arr, 'synthetic', 'key') },
      real: { move: sum(arr, 'real', 'move'), click: sum(arr, 'real', 'click'), scroll: sum(arr, 'real', 'scroll'), key: sum(arr, 'real', 'key') },
    });

    const shadow = all.filter((b) => b.genEnabled);
    const passive = all.filter((b) => !b.genEnabled);
    const avgScore = (arr, src) => (arr.length
      ? Math.round(arr.reduce((a, b) => a + scoreOf(b[src]), 0) / arr.length)
      : 0);
    const avgTotal = (arr) => (arr.length
      ? Math.round(arr.reduce((a, b) => a + scoreOf({
        move: b.synthetic.move + b.real.move, click: b.synthetic.click + b.real.click,
        scroll: b.synthetic.scroll + b.real.scroll, key: b.synthetic.key + b.real.key,
      }), 0) / arr.length)
      : 0);

    return {
      todayTotals: totals(today),
      allTotals: totals(all),
      minutesTracked: all.length,
      compare: {
        shadowMinutes: shadow.length,
        passiveMinutes: passive.length,
        shadowAvgScore: avgTotal(shadow),
        passiveAvgScore: avgTotal(passive),
        syntheticAvgScore: avgScore(all, 'synthetic'),
        realAvgScore: avgScore(all, 'real'),
      },
    };
  }

  exportJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      retentionDays: this.retentionDays,
      buckets: [...this.buckets.values()].sort((a, b) => a.ts - b.ts),
      summary: this.summary(),
    }, null, 2);
  }

  exportCSV() {
    const rows = [['minute_iso', 'generator_enabled', 'syn_move', 'syn_click', 'syn_scroll', 'syn_key', 'real_move', 'real_click', 'real_scroll', 'real_key', 'synthetic_score', 'real_score']];
    [...this.buckets.values()].sort((a, b) => a.ts - b.ts).forEach((b) => {
      rows.push([
        new Date(b.ts).toISOString(), b.genEnabled ? 1 : 0,
        b.synthetic.move, b.synthetic.click, b.synthetic.scroll, b.synthetic.key,
        b.real.move, b.real.click, b.real.scroll, b.real.key,
        scoreOf(b.synthetic), scoreOf(b.real),
      ]);
    });
    return rows.map((r) => r.join(',')).join('\n');
  }

  reset() { this.buckets.clear(); this._recent = []; }

  dump() {
    return { retentionDays: this.retentionDays, buckets: [...this.buckets.values()] };
  }

  load(data) {
    if (!data) return;
    if (data.retentionDays) this.retentionDays = data.retentionDays;
    if (Array.isArray(data.buckets)) {
      data.buckets.forEach((b) => {
        if (b && typeof b.ts === 'number') {
          this.buckets.set(b.ts, {
            ts: b.ts,
            genEnabled: !!b.genEnabled,
            synthetic: { ...emptyCounts(), ...(b.synthetic || {}) },
            real: { ...emptyCounts(), ...(b.real || {}) },
          });
        }
      });
      this._prune();
    }
  }
}

module.exports = new Metrics();
