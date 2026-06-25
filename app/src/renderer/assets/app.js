/* app.js — Driftly renderer logic (no Node access; talks to main via window.driftly). */
(function () {
  'use strict';

  /* ---------------- preview mock (when opened outside Electron) ---------------- */
  const api = window.driftly || (function makeMock() {
    let cfg = JSON.parse(JSON.stringify({
      runMode: 'always',
      generator: { level: 'balanced', intensity: 50, includeClicks: true, includeScroll: true, includeKeys: false, keyName: 'shift', pauseOnUser: true, pauseThresholdMs: 3000 },
      schedule: { days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }, ranges: [{ start: '09:00', end: '18:00' }] },
      prefs: { lang: 'ru', theme: 'dark', minimizeToTray: true, launchAtLogin: false },
    }));
    const now = Date.now();
    const series = Array.from({ length: 120 }, (_, i) => {
      const on = i % 30 < 20;
      return { ts: now - (120 - i) * 60000, genEnabled: on, synthetic: on ? 25 + Math.round(20 * Math.abs(Math.sin(i / 6))) : 0, real: Math.round(12 * Math.abs(Math.sin(i / 9 + 1))), total: 0 };
    });
    const status = () => ({ runMode: cfg.runMode, generatorOn: cfg.runMode !== 'off', scheduleActive: true, minutesUntilScheduleChange: 42, backendMode: 'simulation', monitorMode: 'self-report', genStats: { actions: 128 } });
    return {
      getInitial: () => Promise.resolve({ config: cfg, status: status(), paths: { dir: '/preview' } }),
      patchConfig: (p) => { cfg = deepAssign(cfg, p); return Promise.resolve({ config: cfg, status: status() }); },
      setRunMode: (m) => { cfg.runMode = m; return Promise.resolve({ config: cfg, status: status() }); },
      metricsSeries: (n) => Promise.resolve(series.slice(-n)),
      metricsSummary: () => Promise.resolve({ compare: { shadowAvgScore: 46, passiveAvgScore: 14, syntheticAvgScore: 33, realAvgScore: 12, shadowMinutes: 80, passiveMinutes: 40 } }),
      metricsLive: () => Promise.resolve({ gauge: 40 + Math.round(20 * Math.random()), eventsPer10s: 18, synthetic: 14, real: 4 }),
      metricsReset: () => Promise.resolve(true),
      metricsExport: () => Promise.resolve({ ok: true, filePath: '/preview/export' }),
      openDataFolder: () => Promise.resolve(true),
      onTick: (cb) => setInterval(() => cb({ live: { gauge: 38 + Math.round(24 * Math.random()), eventsPer10s: 16 + Math.round(8 * Math.random()), synthetic: 12, real: 4 }, status: status() }), 1000),
      onStatus: () => {}, onConfigChanged: () => {},
    };
    function deepAssign(b, p) { for (const k in p) { b[k] = (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) ? deepAssign(b[k] || {}, p[k]) : p[k]; } return b; }
  }());

  /* ----------------------------------- i18n ----------------------------------- */
  let lang = 'ru';
  const L = {
    ru: { active: 'Активна', paused: 'Пауза', waiting: 'Ожидает расписания', moves: 'движ/мин', clicks: 'клик/мин', scrolls: 'прокр/мин',
      bReal: 'Реальный ввод', bSim: 'Симуляция', mGlobal: 'Глобальный мониторинг', mSelf: 'Только синтетика',
      schedOn: 'Расписание активно', schedOff: 'Вне расписания', nextIn: 'Смена через', min: 'мин',
      exported: 'Файл сохранён', resetOk: 'Метрики сброшены',
      monNote: 'Измерение реального ввода требует нативного модуля. Текущий режим мониторинга: ',
      runOn: 'Driftly активна', runWait: 'Driftly ждёт расписания', runOff: 'Driftly выключена',
      days: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] },
    en: { active: 'Active', paused: 'Paused', waiting: 'Waiting for schedule', moves: 'moves/min', clicks: 'clicks/min', scrolls: 'scrolls/min',
      bReal: 'Real input', bSim: 'Simulation', mGlobal: 'Global monitoring', mSelf: 'Synthetic only',
      schedOn: 'Schedule active', schedOff: 'Outside schedule', nextIn: 'Changes in', min: 'min',
      exported: 'File saved', resetOk: 'Metrics reset',
      monNote: 'Measuring real input requires a native module. Current monitor mode: ',
      runOn: 'Driftly is active', runWait: 'Driftly waits for schedule', runOff: 'Driftly is off',
      days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] },
  };
  const t = (k) => L[lang][k];
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-ru]').forEach((el) => {
      const val = el.dataset[lang];
      if (val == null) return;
      if (val.includes('<')) el.innerHTML = val; else el.textContent = val;
    });
    document.getElementById('lang-ru').classList.toggle('active', lang === 'ru');
    document.getElementById('lang-en').classList.toggle('active', lang === 'en');
    document.getElementById('set-ru').classList.toggle('active', lang === 'ru');
    document.getElementById('set-en').classList.toggle('active', lang === 'en');
    renderDays(); renderRanges(); renderRates(); renderBadges(); renderStatus(); renderSchedule();
  }

  /* --------------------------------- state ----------------------------------- */
  let cfg = null; let status = null;
  const $ = (id) => document.getElementById(id);

  async function patch(p) { const r = await api.patchConfig(p); cfg = r.config; status = r.status; }

  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200); }

  /* --------------------------------- views ----------------------------------- */
  const TITLES = {
    dashboard: { ru: ['Дашборд', 'Статус и живая активность'], en: ['Dashboard', 'Status & live activity'] },
    activity: { ru: ['Активность', 'Уровень и поведение генератора'], en: ['Activity', 'Generator level & behavior'] },
    schedule: { ru: ['Расписание', 'Рабочие дни и диапазоны времени'], en: ['Schedule', 'Working days & time ranges'] },
    compare: { ru: ['Сравнение', 'Shadow vs Passive · экспорт'], en: ['Compare', 'Shadow vs Passive · export'] },
    settings: { ru: ['Настройки', 'Язык, приватность, система'], en: ['Settings', 'Language, privacy, system'] },
  };
  function showView(name) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $('vtitle').textContent = TITLES[name][lang][0];
    $('vsub').textContent = TITLES[name][lang][1];
    refreshCharts();
  }
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => showView(n.dataset.view)));

  /* ------------------------------- dashboard --------------------------------- */
  function renderStatus() {
    if (!status) return;
    const on = status.generatorOn;
    const dot = $('statusdot'); dot.className = 'statusdot' + (on ? ' on' : (status.runMode === 'schedule' ? ' sched' : ''));
    $('statustext').textContent = on ? t('active') : (status.runMode === 'schedule' ? t('waiting') : t('paused'));
    $('statushint').textContent = on ? t('runOn') : (status.runMode === 'schedule' ? t('runWait') : t('runOff'));
    document.querySelectorAll('#runmode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === status.runMode));
  }
  function renderBadges() {
    if (!status) return;
    const bb = $('badge-backend'); bb.classList.toggle('on', status.backendMode === 'real');
    bb.lastElementChild.textContent = status.backendMode === 'real' ? t('bReal') : t('bSim');
    const mb = $('badge-monitor'); mb.classList.toggle('on', status.monitorMode === 'global'); mb.classList.toggle('warn', status.monitorMode !== 'global');
    mb.lastElementChild.textContent = status.monitorMode === 'global' ? t('mGlobal') : t('mSelf');
    const note = $('monitor-note'); if (note) note.textContent = t('monNote') + (status.monitorMode === 'global' ? t('mGlobal') : t('mSelf')) + '.';
  }
  document.querySelectorAll('#runmode button').forEach((b) => b.addEventListener('click', async () => {
    const r = await api.setRunMode(b.dataset.mode); cfg = r.config; status = r.status; renderStatus(); renderBadges();
  }));

  /* -------------------------------- activity --------------------------------- */
  function lerp(a, b, x) { return a + (b - a) * x; }
  const PRESET_RATES = {
    gentle: { move: 6, click: 0.5, scroll: 1 },
    balanced: { move: 18, click: 2, scroll: 3 },
    energetic: { move: 40, click: 5, scroll: 6 },
  };
  function renderRates() {
    if (!cfg) return;
    const g = cfg.generator;
    let base;
    if (g.level === 'custom') {
      const i = g.intensity / 100;
      base = { move: lerp(4, 50, i), click: lerp(0.3, 6, i), scroll: lerp(0.5, 7, i) };
    } else { base = PRESET_RATES[g.level] || PRESET_RATES.balanced; }
    const items = [
      [Math.round(base.move), t('moves')],
      [g.includeClicks ? (+base.click).toFixed(1) : '0', t('clicks')],
      [g.includeScroll ? (+base.scroll).toFixed(1) : '0', t('scrolls')],
    ];
    $('rates').innerHTML = items.map(([n, l]) => `<div class="rate"><b>${n}</b><span>${l}</span></div>`).join('');
  }
  function renderActivity() {
    if (!cfg) return;
    const g = cfg.generator;
    document.querySelectorAll('#levels .level').forEach((el) => el.classList.toggle('active', el.dataset.level === g.level));
    $('custom-wrap').style.display = g.level === 'custom' ? 'block' : 'none';
    $('intensity').value = g.intensity; $('intensity-val').textContent = g.intensity;
    $('opt-clicks').checked = g.includeClicks; $('opt-scroll').checked = g.includeScroll;
    $('opt-keys').checked = g.includeKeys; $('opt-pause').checked = g.pauseOnUser;
    renderRates();
  }
  document.querySelectorAll('#levels .level').forEach((el) => el.addEventListener('click', async () => {
    await patch({ generator: { level: el.dataset.level } }); renderActivity();
  }));
  $('intensity').addEventListener('input', (e) => { $('intensity-val').textContent = e.target.value; renderRates(); });
  $('intensity').addEventListener('change', async (e) => { await patch({ generator: { intensity: parseInt(e.target.value, 10) } }); });
  [['opt-clicks', 'includeClicks'], ['opt-scroll', 'includeScroll'], ['opt-keys', 'includeKeys'], ['opt-pause', 'pauseOnUser']].forEach(([id, key]) => {
    $(id).addEventListener('change', async (e) => { await patch({ generator: { [key]: e.target.checked } }); renderRates(); });
  });

  /* -------------------------------- schedule --------------------------------- */
  function renderDays() {
    if (!cfg) return;
    const box = $('days'); box.innerHTML = '';
    DAY_KEYS.forEach((k, idx) => {
      const d = document.createElement('div');
      d.className = 'day' + (cfg.schedule.days[k] ? ' on' : ''); d.textContent = t('days')[idx];
      d.addEventListener('click', async () => { await patch({ schedule: { days: { [k]: !cfg.schedule.days[k] } } }); renderDays(); renderSchedule(); });
      box.appendChild(d);
    });
  }
  function renderRanges() {
    if (!cfg) return;
    const box = $('ranges'); box.innerHTML = '';
    cfg.schedule.ranges.forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'range-row';
      row.innerHTML = `<input type="time" value="${r.start}" data-i="${i}" data-f="start">
        <span class="to">—</span><input type="time" value="${r.end}" data-i="${i}" data-f="end">
        <button class="btn ghost" data-del="${i}" style="padding:8px 12px">✕</button>`;
      box.appendChild(row);
    });
    box.querySelectorAll('input[type=time]').forEach((inp) => inp.addEventListener('change', async () => {
      const ranges = cfg.schedule.ranges.map((x) => ({ ...x }));
      ranges[+inp.dataset.i][inp.dataset.f] = inp.value;
      await patch({ schedule: { ranges } }); renderSchedule();
    }));
    box.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
      const ranges = cfg.schedule.ranges.filter((_, i) => i !== +btn.dataset.del);
      await patch({ schedule: { ranges: ranges.length ? ranges : [{ start: '09:00', end: '18:00' }] } });
      renderRanges(); renderSchedule();
    }));
  }
  $('add-range').addEventListener('click', async () => {
    const ranges = cfg.schedule.ranges.concat([{ start: '14:00', end: '18:00' }]);
    await patch({ schedule: { ranges } }); renderRanges(); renderSchedule();
  });
  function renderSchedule() {
    if (!status) return;
    const dot = $('sched-dot'); dot.className = 'statusdot' + (status.scheduleActive ? ' on' : '');
    $('sched-text').textContent = status.scheduleActive ? t('schedOn') : t('schedOff');
    const m = status.minutesUntilScheduleChange;
    $('sched-hint').textContent = (m != null) ? `${t('nextIn')} ~${m} ${t('min')}` : '';
  }

  /* -------------------------------- compare ---------------------------------- */
  async function renderCompare() {
    const s = await api.metricsSummary(); const c = s.compare || {};
    const set = (barId, valId, v) => { $(barId).style.width = Math.min(100, v) + '%'; $(valId).textContent = v; };
    set('cmp-shadow', 'cmp-shadow-v', c.shadowAvgScore || 0);
    set('cmp-passive', 'cmp-passive-v', c.passiveAvgScore || 0);
    set('cmp-syn', 'cmp-syn-v', c.syntheticAvgScore || 0);
    set('cmp-real', 'cmp-real-v', c.realAvgScore || 0);
  }
  $('exp-csv').addEventListener('click', async () => { const r = await api.metricsExport('csv'); if (r && r.ok) toast(t('exported')); });
  $('exp-json').addEventListener('click', async () => { const r = await api.metricsExport('json'); if (r && r.ok) toast(t('exported')); });
  $('open-folder').addEventListener('click', () => api.openDataFolder());
  $('reset-metrics').addEventListener('click', async () => { await api.metricsReset(); await renderCompare(); refreshCharts(); toast(t('resetOk')); });

  /* --------------------------------- charts ---------------------------------- */
  async function refreshCharts() {
    const active = document.querySelector('.view.active').id;
    if (active === 'view-dashboard') { const s = await api.metricsSeries(60); window.Charts.area($('dash-chart'), s); }
    if (active === 'view-compare') { const s = await api.metricsSeries(120); window.Charts.area($('cmp-chart'), s, { height: 200 }); renderCompare(); }
  }

  /* -------------------------------- settings --------------------------------- */
  document.querySelectorAll('#lang-ru,#lang-en,#set-ru,#set-en').forEach((b) => b.addEventListener('click', async () => {
    lang = b.id.endsWith('ru') ? 'ru' : 'en'; await patch({ prefs: { lang } }); applyLang();
    const a = document.querySelector('.nav-item.active'); if (a) showView(a.dataset.view);
  }));
  $('opt-tray').addEventListener('change', (e) => patch({ prefs: { minimizeToTray: e.target.checked } }));
  $('opt-login').addEventListener('change', (e) => patch({ prefs: { launchAtLogin: e.target.checked } }));

  /* ---------------------------------- tick ----------------------------------- */
  api.onTick((data) => {
    if (data.live) {
      window.Charts.gauge($('gauge'), data.live.gauge);
      $('kpi-events').textContent = data.live.eventsPer10s;
      $('kpi-syn').textContent = data.live.synthetic;
      $('kpi-real').textContent = data.live.real;
    }
    if (data.status) { status = data.status; renderStatus(); renderBadges(); renderSchedule(); }
  });
  api.onStatus((s) => { status = s; renderStatus(); renderBadges(); renderSchedule(); });
  api.onConfigChanged((d) => { cfg = d.config; status = d.status; renderStatus(); renderBadges(); });

  setInterval(refreshCharts, 2500);
  window.addEventListener('resize', refreshCharts);

  /* ----------------------------------- init ---------------------------------- */
  (async function init() {
    const r = await api.getInitial();
    cfg = r.config; status = r.status; lang = (cfg.prefs && cfg.prefs.lang) || 'ru';
    $('opt-tray').checked = cfg.prefs.minimizeToTray; $('opt-login').checked = cfg.prefs.launchAtLogin;
    applyLang(); renderActivity(); renderStatus(); renderBadges(); renderSchedule();
    window.Charts.gauge($('gauge'), 0);
    const deep = (location.hash || '').replace('#', '');
    showView(TITLES[deep] ? deep : 'dashboard');
  }());
  window.addEventListener('hashchange', () => { const d = (location.hash || '').replace('#', ''); if (TITLES[d]) showView(d); });
}());
