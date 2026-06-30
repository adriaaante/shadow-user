'use strict';
/**
 * store.js
 * Local-only persistence. Writes config + rolling metrics as JSON files inside
 * the OS per-user app-data folder. Nothing is ever uploaded. (See PRIVACY.md.)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  runMode: 'schedule', // 'schedule' | 'always' | 'off'
  generator: {
    level: 'balanced',
    intensity: 50,
    includeClicks: true,
    includeScroll: true,
    includeKeys: false,
    keyName: 'shift',
    switchWindows: false,
    pauseOnUser: true,
    pauseThresholdMs: 3000,
  },
  schedule: {
    days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
    ranges: [{ start: '09:00', end: '18:00' }],
  },
  prefs: {
    lang: 'ru',
    theme: 'dark',
    minimizeToTray: true,
    launchAtLogin: false,
  },
  account: {
    api: '',      // licensing server base URL ('' → preview mode)
    token: null,  // account token (this device's session)
    license: null, // cached signed license token (verified offline)
  },
};

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === 'object') {
    const out = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = (base && typeof base[k] === 'object' && !Array.isArray(base[k]))
        ? deepMerge(base[k] || {}, patch[k])
        : patch[k];
    }
    return out;
  }
  return patch;
}

class Store {
  constructor() {
    this.dir = process.cwd();
    this.configPath = path.join(this.dir, 'config.json');
    this.metricsPath = path.join(this.dir, 'metrics.json');
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this._cfgTimer = null;
    this._metTimer = null;
  }

  init(dir) {
    this.dir = dir;
    this.configPath = path.join(dir, 'config.json');
    this.metricsPath = path.join(dir, 'metrics.json');
    this._loadConfig();
  }

  _loadConfig() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      this.config = deepMerge(DEFAULT_CONFIG, raw);
    } catch (_) {
      this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return this.config;
  }

  getConfig() { return this.config; }

  patchConfig(patch) {
    this.config = deepMerge(this.config, patch);
    this.saveConfig();
    return this.config;
  }

  _atomicWrite(file, data) {
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file);
    } catch (_) { /* best effort */ }
  }

  saveConfig() {
    if (this._cfgTimer) clearTimeout(this._cfgTimer);
    this._cfgTimer = setTimeout(() => {
      this._atomicWrite(this.configPath, JSON.stringify(this.config, null, 2));
    }, 250);
  }

  loadMetrics() {
    try { return JSON.parse(fs.readFileSync(this.metricsPath, 'utf8')); } catch (_) { return null; }
  }

  saveMetrics(data) {
    if (this._metTimer) clearTimeout(this._metTimer);
    this._metTimer = setTimeout(() => {
      this._atomicWrite(this.metricsPath, JSON.stringify(data));
    }, 1000);
  }

  paths() { return { dir: this.dir, config: this.configPath, metrics: this.metricsPath }; }
}

module.exports = new Store();
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
