/* app.js — Driftly renderer logic (no Node access; talks to main via window.driftly). */
(function () {
  'use strict';

  /* ---------------- preview mock (when opened outside Electron) ---------------- */
  const api = window.driftly || (function makeMock() {
    let cfg = JSON.parse(JSON.stringify({
      runMode: 'always',
      generator: { level: 'balanced', intensity: 50, includeClicks: true, includeScroll: true, includeKeys: false, keyName: 'shift', switchWindows: false, pauseOnUser: true, pauseThresholdMs: 3000 },
      schedule: { days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }, ranges: [{ start: '09:00', end: '18:00' }] },
      prefs: { lang: 'ru', theme: 'dark', minimizeToTray: true, launchAtLogin: false },
    }));
    const now = Date.now();
    const series = Array.from({ length: 120 }, (_, i) => {
      const on = i % 30 < 20;
      return { ts: now - (120 - i) * 60000, genEnabled: on, synthetic: on ? 25 + Math.round(20 * Math.abs(Math.sin(i / 6))) : 0, real: Math.round(12 * Math.abs(Math.sin(i / 9 + 1))), total: 0 };
    });
    const previewLicense = { api: '', preview: true, online: false, signedIn: false, entitlement: { plan: 'preview', status: 'preview', access: true, blocked: false, isPro: true, needsPayment: false, reason: 'preview', preview: true, features: [], trialDaysLeft: 0, account: null, renewsAt: null } };
    const status = () => ({ runMode: cfg.runMode, generatorOn: cfg.runMode !== 'off', scheduleActive: true, minutesUntilScheduleChange: 42, backendMode: 'simulation', monitorMode: 'self-report', genStats: { actions: 128 }, license: previewLicense });
    return {
      getInitial: () => Promise.resolve({ config: cfg, status: status(), paths: { dir: '/preview' } }),
      patchConfig: (p) => { cfg = deepAssign(cfg, p); return Promise.resolve({ config: cfg, status: status() }); },
      setRunMode: (m) => { cfg.runMode = m; return Promise.resolve({ config: cfg, status: status() }); },
      metricsSeries: (n) => Promise.resolve(series.slice(-n)),
      metricsSummary: () => Promise.resolve({ compare: { shadowAvgScore: 46, passiveAvgScore: 14, syntheticAvgScore: 33, realAvgScore: 12, shadowMinutes: 80, passiveMinutes: 40 } }),
      metricsLive: () => Promise.resolve({ gauge: 40 + Math.round(20 * Math.random()), eventsLastHour: 1280, synthetic: 980, real: 300 }),
      metricsReset: () => Promise.resolve(true),
      metricsExport: () => Promise.resolve({ ok: true, filePath: '/preview/export' }),
      openDataFolder: () => Promise.resolve(true),
      onTick: (cb) => setInterval(() => cb({ live: { gauge: 38 + Math.round(24 * Math.random()), eventsLastHour: 1240 + Math.round(80 * Math.random()), synthetic: 950, real: 300 }, status: status() }), 1000),
      onStatus: () => {}, onConfigChanged: () => {},
      licenseGet: () => Promise.resolve(previewLicense),
      licenseSetApi: () => Promise.resolve(previewLicense),
      licenseAuthRequest: () => Promise.resolve({ ok: false, error: 'no_api' }),
      licenseAuthVerify: () => Promise.resolve({ result: { ok: false }, info: previewLicense }),
      licenseStartTrial: () => Promise.resolve({ result: { ok: false }, info: previewLicense }),
      licenseRetry: () => Promise.resolve({ result: { ok: false }, info: previewLicense }),
      licenseCancel: () => Promise.resolve({ result: { ok: false }, info: previewLicense }),
      licenseResume: () => Promise.resolve({ result: { ok: false }, info: previewLicense }),
      licenseSignOut: () => Promise.resolve(previewLicense),
      licenseRefresh: () => Promise.resolve(previewLicense),
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
      subPreview: 'Демо-режим: сервер лицензий не подключён — доступ открыт.', previewTitle: 'Демо-режим',
      signInFirst: 'Войдите в аккаунт, чтобы управлять подпиской.', online: 'на связи', offline: 'нет связи',
      startTrial: 'Подключить карту — 3 дня бесплатно', subscribe: 'Оформить подписку', trialActive: 'Пробный период', daysLeft: 'дн. осталось',
      subActive: 'Подписка активна', renews: 'Продление', inactive: 'Подписка неактивна',
      pastDue: 'Необходимо оплатить', pastDueDesc: 'Списание не прошло. Оплатите, чтобы продолжить.',
      retryPay: 'Повторить оплату', cancelSub: 'Отменить подписку', goSub: 'Открыть подписку',
      pwTitle: 'Требуется подписка', pwTextNone: 'Подключите карту и получите 3 дня бесплатно. Доступ к Driftly — и в вебе, и в десктопе.',
      apiSaved: 'Сервер сохранён', trialStarted: '3 дня бесплатно активированы!', payRetried: 'Оплата повторно проведена.',
      needEmail: 'Введите корректный email.', testCard: 'тестовая карта (демо):', cardOk: 'успешно', cardFail: 'нет средств',
      getCode: 'Получить код', sendCode: 'Код отправлен на почту', enterCode: 'Введите код из письма', codeBad: 'Неверный код',
      resume: 'Возобновить', accessUntil: 'доступ до', trialCanceledNote: 'Пробный период отменён', subCanceledNote: 'Подписка отменена', noRenew: 'продление не произойдёт',
      monthly: 'Помесячно', yearly: 'За год', perMonth: '₽/мес', perYear: '₽/год', planYearWord: 'годовая', planMonthWord: 'месячная',
      days: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] },
    en: { active: 'Active', paused: 'Paused', waiting: 'Waiting for schedule', moves: 'moves/min', clicks: 'clicks/min', scrolls: 'scrolls/min',
      bReal: 'Real input', bSim: 'Simulation', mGlobal: 'Global monitoring', mSelf: 'Synthetic only',
      schedOn: 'Schedule active', schedOff: 'Outside schedule', nextIn: 'Changes in', min: 'min',
      exported: 'File saved', resetOk: 'Metrics reset',
      monNote: 'Measuring real input requires a native module. Current monitor mode: ',
      runOn: 'Driftly is active', runWait: 'Driftly waits for schedule', runOff: 'Driftly is off',
      subPreview: 'Demo mode: no licensing server connected — access is open.', previewTitle: 'Demo mode',
      signInFirst: 'Sign in to manage your subscription.', online: 'online', offline: 'offline',
      startTrial: 'Add a card — 3 days free', subscribe: 'Subscribe', trialActive: 'Free trial', daysLeft: 'days left',
      subActive: 'Subscription active', renews: 'Renews', inactive: 'Subscription inactive',
      pastDue: 'Payment required', pastDueDesc: 'The charge failed. Please pay to continue.',
      retryPay: 'Retry payment', cancelSub: 'Cancel subscription', goSub: 'Open subscription',
      pwTitle: 'Subscription required', pwTextNone: 'Add a card and get 3 days free. Driftly unlocks on web and desktop.',
      apiSaved: 'Server saved', trialStarted: '3 free days activated!', payRetried: 'Payment retried.',
      needEmail: 'Enter a valid email.', testCard: 'test card (demo):', cardOk: 'success', cardFail: 'no funds',
      getCode: 'Get code', sendCode: 'Code sent to your email', enterCode: 'Enter the code from the email', codeBad: 'Invalid code',
      resume: 'Resume', accessUntil: 'access until', trialCanceledNote: 'Trial cancelled', subCanceledNote: 'Subscription cancelled', noRenew: 'will not renew',
      monthly: 'Monthly', yearly: 'Yearly', perMonth: '₽/mo', perYear: '₽/yr', planYearWord: 'yearly', planMonthWord: 'monthly',
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
    renderDays(); renderRanges(); renderRates(); renderBadges(); renderStatus(); renderSchedule(); renderLicense();
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
    compare: { ru: ['Сравнение', 'Активный против Пассивного · экспорт'], en: ['Compare', 'Shadow vs Passive · export'] },
    subscription: { ru: ['Подписка', 'Единая подписка на веб и десктоп'], en: ['Subscription', 'One subscription for web & desktop'] },
    settings: { ru: ['Настройки', 'Язык, приватность, система'], en: ['Settings', 'Language, privacy, system'] },
  };
  let activeView = 'dashboard';
  function showView(name) {
    activeView = name;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $('vtitle').textContent = TITLES[name][lang][0];
    $('vsub').textContent = TITLES[name][lang][1];
    refreshCharts();
    if (typeof renderLicense === 'function') renderLicense(); // paywall is hidden on the subscription view
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
    $('opt-windows').checked = g.switchWindows;
    renderRates();
  }
  document.querySelectorAll('#levels .level').forEach((el) => el.addEventListener('click', async () => {
    await patch({ generator: { level: el.dataset.level } }); renderActivity();
  }));
  $('intensity').addEventListener('input', (e) => { $('intensity-val').textContent = e.target.value; renderRates(); });
  $('intensity').addEventListener('change', async (e) => { await patch({ generator: { intensity: parseInt(e.target.value, 10) } }); });
  [['opt-clicks', 'includeClicks'], ['opt-scroll', 'includeScroll'], ['opt-keys', 'includeKeys'], ['opt-windows', 'switchWindows'], ['opt-pause', 'pauseOnUser']].forEach(([id, key]) => {
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

  /* ------------------------------ subscription ------------------------------- */
  const PRICE = (window.DriftlyEntitlement && window.DriftlyEntitlement.PLAN) || { priceMonthly: 249, priceYearly: 2500, yearlyDiscountPct: 16 };
  let selectedInterval = 'month';
  function fmtDate(ms) { try { return new Date(ms).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US'); } catch (_) { return ''; } }
  function statusBox(cls, ic, title, desc) { return `<div class="sub-status ${cls}"><span class="ic">${ic}</span><div><div class="t">${title}</div><div class="d">${desc || ''}</div></div></div>`; }
  function planToggle() {
    const yr = selectedInterval === 'year';
    return `<div class="plan-toggle">
      <button class="${yr ? '' : 'on'}" data-interval="month"><b>${PRICE.priceMonthly} ${t('perMonth')}</b><span>${t('monthly')}</span></button>
      <button class="${yr ? 'on' : ''}" data-interval="year"><b>${PRICE.priceYearly} ${t('perYear')}</b><span>${t('yearly')} · −${PRICE.yearlyDiscountPct}%</span></button>
    </div>`;
  }
  function trialBlock(info) {
    // The one-time free trial is only offered while the account hasn't used it yet; a returning
    // user (trialUsed) subscribes and is charged immediately, so the button says so.
    const used = !!(info && info.account && info.account.trialUsed);
    const price = selectedInterval === 'year' ? `${PRICE.priceYearly} ${t('perYear')}` : `${PRICE.priceMonthly} ${t('perMonth')}`;
    const label = used ? `${t('subscribe')} — ${price}` : t('startTrial');
    return planToggle() + `<button class="btn primary btn-lg" data-act="trial">${label}</button>
      <div class="devcard">${t('testCard')}<select id="dev-card"><option value="tok_ok">${t('cardOk')}</option><option value="tok_insufficient">${t('cardFail')}</option></select></div>`;
  }
  function planWord(e) { return e.interval === 'year' ? t('planYearWord') : t('planMonthWord'); }
  function cancelBlock() { return `<button class="btn ghost" data-act="cancel" style="margin-top:12px">${t('cancelSub')}</button>`; }
  function resumeBlock() { return `<button class="btn primary" data-act="resume" style="margin-top:12px">${t('resume')}</button>`; }

  function licInfo() { return status && status.license; }

  function renderLicense() {
    const info = licInfo(); if (!info) return;
    const e = info.entitlement || {};
    const blocked = !!e.blocked && !info.preview;

    // banner
    const bn = $('subbanner');
    if (info.preview) { bn.style.display = 'flex'; bn.className = 'subbanner preview'; bn.innerHTML = `<span>${t('subPreview')}</span>`; }
    else if (e.reason === 'trial') { bn.style.display = 'flex'; bn.className = 'subbanner'; bn.innerHTML = `<span>✨ ${t('trialActive')}: ${e.trialDaysLeft} ${t('daysLeft')}</span><button class="btn" data-go-sub>${t('goSub')}</button>`; }
    else if (e.needsPayment) { bn.style.display = 'flex'; bn.className = 'subbanner warn'; bn.innerHTML = `<span>⚠ ${t('pastDue')}</span><button class="btn" data-go-sub>${t('retryPay')}</button>`; }
    else bn.style.display = 'none';

    // paywall overlay — never cover the Subscription view itself (the user must
    // be able to sign in / pay there to resolve the block).
    const pw = $('paywall');
    if (blocked && activeView !== 'subscription') {
      pw.style.display = 'flex';
      $('pw-title').textContent = e.needsPayment ? t('pastDue') : t('pwTitle');
      $('pw-text').textContent = e.needsPayment ? t('pastDueDesc') : t('pwTextNone');
      $('pw-cta').textContent = t('goSub');
      const rb = $('pw-retry');
      if (e.needsPayment) { rb.style.display = 'inline-flex'; rb.textContent = t('retryPay'); } else rb.style.display = 'none';
    } else pw.style.display = 'none';

    // gate run controls
    document.querySelectorAll('#runmode button').forEach((b) => { b.disabled = blocked; b.style.opacity = blocked ? '.4' : ''; b.style.pointerEvents = blocked ? 'none' : ''; });

    // subscription view
    $('price-main').textContent = PRICE.priceMonthly + ' ₽';
    $('sub-api').value = info.api || '';
    $('sub-api-state').textContent = info.preview ? t('subPreview') : `${info.api} · ${info.online ? t('online') : t('offline')}`;
    $('sub-signin').style.display = info.signedIn ? 'none' : 'block';
    $('sub-signedin').style.display = info.signedIn ? 'block' : 'none';
    if (info.signedIn) $('sub-who').textContent = e.account || '';

    const box = $('sub-state');
    if (info.preview) { box.innerHTML = statusBox('trial', '✨', t('previewTitle'), t('subPreview')); return; }
    if (!info.signedIn) { box.innerHTML = statusBox('', '👤', t('signInFirst'), ''); return; }
    if (e.reason === 'trial') box.innerHTML = e.canceled
      ? statusBox('trial', '✨', t('trialCanceledNote'), `${t('accessUntil')} ${fmtDate(e.renewsAt)}`) + resumeBlock()
      : statusBox('trial', '✨', t('trialActive'), `${e.trialDaysLeft} ${t('daysLeft')}`) + cancelBlock();
    else if (e.reason === 'active') box.innerHTML = e.canceled
      ? statusBox('ok', '✓', t('subCanceledNote'), `${t('accessUntil')} ${fmtDate(e.renewsAt)} · ${t('noRenew')}`) + resumeBlock()
      : statusBox('ok', '✓', `${t('subActive')} · ${planWord(e)}`, `${t('renews')}: ${fmtDate(e.renewsAt)}`) + cancelBlock();
    else if (e.needsPayment) box.innerHTML = statusBox('bad', '⚠', t('pastDue'), t('pastDueDesc')) + `<button class="btn primary" data-act="retry">${t('retryPay')}</button>`;
    else box.innerHTML = statusBox('', '🔓', t('inactive'), '') + trialBlock(info);
  }

  function applyInfo(info) { if (!status) status = {}; status.license = info; renderLicense(); renderStatus(); }

  async function doTrial() { const card = ($('dev-card') && $('dev-card').value) || 'tok_ok'; const r = await api.licenseStartTrial(card, selectedInterval); applyInfo(r.info); toast(r.info.entitlement && r.info.entitlement.access ? t('trialStarted') : t('pastDue')); }
  async function doRetry() { const r = await api.licenseRetry(); applyInfo(r.info); toast(r.info.entitlement && r.info.entitlement.access ? t('payRetried') : t('pastDue')); }
  async function doCancel() { const r = await api.licenseCancel(); applyInfo(r.info); }
  async function doResume() { const r = await api.licenseResume(); applyInfo(r.info); }

  // two-step passwordless sign-in
  $('btn-getcode').addEventListener('click', async () => {
    const email = $('sub-email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast(t('needEmail')); return; }
    const r = await api.licenseAuthRequest(email);
    if (r && r.ok) {
      $('sub-step-code').style.display = 'flex';
      $('sub-auth-note').textContent = t('sendCode') + (r.devCode ? ` (dev: ${r.devCode})` : '');
      if (r.devCode) $('sub-code').value = r.devCode;
      $('sub-code').focus();
    } else toast(t('needEmail'));
  });
  $('btn-verify').addEventListener('click', async () => {
    const email = $('sub-email').value.trim(); const code = $('sub-code').value.trim();
    const r = await api.licenseAuthVerify(email, code);
    if (r.result && r.result.ok) { $('sub-step-code').style.display = 'none'; $('sub-auth-note').textContent = ''; applyInfo(r.info); }
    else toast(t('codeBad'));
  });
  $('btn-signout').addEventListener('click', async () => applyInfo(await api.licenseSignOut()));
  $('btn-setapi').addEventListener('click', async () => { const info = await api.licenseSetApi($('sub-api').value.trim()); applyInfo(info); toast(t('apiSaved')); });
  $('pw-cta').addEventListener('click', () => showView('subscription'));
  $('pw-retry').addEventListener('click', doRetry);
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-act],[data-go-sub],[data-interval]'); if (!a) return;
    if (a.hasAttribute('data-go-sub')) { showView('subscription'); return; }
    const act = a.dataset.act;
    if (a.dataset.interval) { selectedInterval = a.dataset.interval; renderLicense(); return; }
    if (act === 'trial') doTrial(); else if (act === 'retry') doRetry(); else if (act === 'cancel') doCancel(); else if (act === 'resume') doResume();
  });

  /* ---------------------------------- tick ----------------------------------- */
  api.onTick((data) => {
    if (data.live) {
      window.Charts.gauge($('gauge'), data.live.gauge);
      $('kpi-events').textContent = data.live.eventsLastHour;
      $('kpi-syn').textContent = data.live.synthetic;
      $('kpi-real').textContent = data.live.real;
    }
    if (data.status) { status = data.status; renderStatus(); renderBadges(); renderSchedule(); renderLicense(); }
  });
  api.onStatus((s) => { status = s; renderStatus(); renderBadges(); renderSchedule(); renderLicense(); });
  api.onConfigChanged((d) => { cfg = d.config; status = d.status; renderStatus(); renderBadges(); renderLicense(); });

  setInterval(refreshCharts, 2500);
  window.addEventListener('resize', refreshCharts);

  /* ----------------------------------- init ---------------------------------- */
  (async function init() {
    const r = await api.getInitial();
    cfg = r.config; status = r.status; lang = (cfg.prefs && cfg.prefs.lang) || 'ru';
    $('opt-tray').checked = cfg.prefs.minimizeToTray; $('opt-login').checked = cfg.prefs.launchAtLogin;
    applyLang(); renderActivity(); renderStatus(); renderBadges(); renderSchedule(); renderLicense();
    window.Charts.gauge($('gauge'), 0);
    const deep = (location.hash || '').replace('#', '');
    showView(TITLES[deep] ? deep : 'dashboard');
  }());
  window.addEventListener('hashchange', () => { const d = (location.hash || '').replace('#', ''); if (TITLES[d]) showView(d); });
}());
