/* web.js — Driftly Web: no-install browser version.
   Runs an in-page activity engine + measurement. Local-only (localStorage).
   A browser cannot control the OS cursor or measure system-wide activity;
   this measures activity ON THIS PAGE and keeps the screen awake via Wake Lock. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* -------------------------------- i18n -------------------------------- */
  let lang = localStorage.getItem('driftly.lang') || 'ru';
  const L = {
    ru: { running: 'Работает', paused: 'Пауза', moves: 'движ/мин', clicks: 'клик/мин', scrolls: 'прокр/мин',
      exported: 'Файл сохранён', reset: 'Сброшено', wakeOn: 'Экран удерживается активным.', wakeOff: 'Удержание экрана выключено.',
      wakeIdle: 'Экран будет удерживаться, пока приложение работает.',
      wakeHidden: 'Вкладка свёрнута — экран может гаснуть. Вернитесь на вкладку Driftly (или скачайте десктоп для работы в фоне).',
      wakeNo: 'Этот браузер не умеет удерживать экран активным.', wakeErr: 'Не удалось удержать экран активным (нужен HTTPS).' },
    en: { running: 'Running', paused: 'Paused', moves: 'moves/min', clicks: 'clicks/min', scrolls: 'scrolls/min',
      exported: 'File saved', reset: 'Reset', wakeOn: 'Screen is kept awake.', wakeOff: 'Wake Lock off.',
      wakeIdle: 'The screen will be kept awake while the app is running.',
      wakeHidden: 'This tab is in the background — the screen may sleep. Return to the Driftly tab (or get the desktop app for background use).',
      wakeNo: 'Wake Lock is not supported by this browser.', wakeErr: 'Could not enable Wake Lock (needs HTTPS).' },
  };
  const t = (k) => L[lang][k];
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-ru]').forEach((el) => { const v = el.dataset[lang]; if (v != null) (v.includes('<') ? el.innerHTML = v : el.textContent = v); });
    $('lang-ru').classList.toggle('active', lang === 'ru'); $('lang-en').classList.toggle('active', lang === 'en');
    renderRates(); renderStatus(); renderWakeNote();
  }

  /* ------------------------------- config ------------------------------- */
  const DEFAULT = { running: false, level: 'balanced', intensity: 50, includeClicks: true, includeScroll: true, pauseOnUser: true, wake: true };
  let cfg = Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem('driftly.cfg') || '{}'));
  cfg.running = false; // never auto-run on load
  const saveCfg = () => localStorage.setItem('driftly.cfg', JSON.stringify(cfg));

  const PRESET = { gentle: { move: 6, click: 0.5, scroll: 1 }, balanced: { move: 18, click: 2, scroll: 3 }, energetic: { move: 40, click: 5, scroll: 6 } };
  function rates() {
    let b;
    if (cfg.level === 'custom') { const x = cfg.intensity / 100; b = { move: 4 + 46 * x, click: 0.3 + 5.7 * x, scroll: 0.5 + 6.5 * x }; }
    else b = PRESET[cfg.level] || PRESET.balanced;
    return { move: b.move, click: cfg.includeClicks ? b.click : 0, scroll: cfg.includeScroll ? b.scroll : 0 };
  }

  /* ------------------------------- metrics ------------------------------ */
  const W = { move: 0.35, click: 8, scroll: 3 };
  const MIN = 60000;
  const score = (c) => Math.min(100, Math.round((c.move || 0) * W.move + (c.click || 0) * W.click + (c.scroll || 0) * W.scroll));
  const M = {
    buckets: new Map(), recent: [], genOn: false,
    load() { try { JSON.parse(localStorage.getItem('driftly.metrics') || '[]').forEach((b) => this.buckets.set(b.ts, b)); } catch (_) {} },
    save() { localStorage.setItem('driftly.metrics', JSON.stringify([...this.buckets.values()].slice(-1440))); },
    bucket(ts) { const m = Math.floor(ts / MIN) * MIN; let b = this.buckets.get(m); if (!b) { b = { ts: m, genEnabled: this.genOn, synthetic: { move: 0, click: 0, scroll: 0 }, real: { move: 0, click: 0, scroll: 0 } }; this.buckets.set(m, b); } if (this.genOn) b.genEnabled = true; return b; },
    record(kind, synthetic) { const ts = now(); const b = this.bucket(ts); const bag = synthetic ? b.synthetic : b.real; if (bag[kind] !== undefined) bag[kind] += 1; this.recent.push({ ts, synthetic }); const cut = ts - 10000; while (this.recent.length && this.recent[0].ts < cut) this.recent.shift(); },
    live() { const w = this.recent; const syn = w.filter((e) => e.synthetic).length; return { gauge: Math.min(100, Math.round(w.length * 2.2)), events: w.length, synthetic: syn, real: w.length - syn }; },
    // Total actions in the trailing hour (summed from the per-minute buckets).
    lastHour() { const cut = now() - 3600000; let s = 0, r = 0; for (const b of this.buckets.values()) { if (b.ts >= cut) { s += b.synthetic.move + b.synthetic.click + b.synthetic.scroll; r += b.real.move + b.real.click + b.real.scroll; } } return { total: s + r, synthetic: s, real: r }; },
    series(n) { const out = []; const end = Math.floor(now() / MIN) * MIN; for (let i = n - 1; i >= 0; i--) { const ts = end - i * MIN; const b = this.buckets.get(ts); out.push(b ? { ts, genEnabled: b.genEnabled, synthetic: score(b.synthetic), real: score(b.real) } : { ts, genEnabled: false, synthetic: 0, real: 0 }); } return out; },
    summary() { const all = [...this.buckets.values()]; const sh = all.filter((b) => b.genEnabled); const pa = all.filter((b) => !b.genEnabled); const avg = (a) => a.length ? Math.round(a.reduce((s, b) => s + score({ move: b.synthetic.move + b.real.move, click: b.synthetic.click + b.real.click, scroll: b.synthetic.scroll + b.real.scroll }), 0) / a.length) : 0; return { shadow: avg(sh), passive: avg(pa) }; },
    csv() { const rows = [['minute_iso', 'generator_enabled', 'syn_move', 'syn_click', 'syn_scroll', 'real_move', 'real_click', 'real_scroll', 'synthetic_score', 'real_score']]; [...this.buckets.values()].sort((a, b) => a.ts - b.ts).forEach((b) => rows.push([new Date(b.ts).toISOString(), b.genEnabled ? 1 : 0, b.synthetic.move, b.synthetic.click, b.synthetic.scroll, b.real.move, b.real.click, b.real.scroll, score(b.synthetic), score(b.real)])); return 'sep=,\r\n' + rows.map((r) => r.join(',')).join('\r\n'); },
    json() { return JSON.stringify({ exportedAt: new Date().toISOString(), buckets: [...this.buckets.values()].sort((a, b) => a.ts - b.ts), summary: this.summary() }, null, 2); },
    reset() { this.buckets.clear(); this.recent = []; this.save(); },
  };
  M.load();

  /* ------------------------- real-input monitoring ---------------------- */
  let lastReal = 0; let lastMoveAt = 0;
  function onReal(kind) { lastReal = now(); M.record(kind, false); }
  // One continuous mouse movement = ONE action: count a "move" only when motion
  // starts after a pause (>500ms still), not for every pointermove event.
  document.addEventListener('pointermove', () => {
    const tnow = now(); lastReal = tnow;
    if (tnow - lastMoveAt > 500) M.record('move', false);
    lastMoveAt = tnow;
  }, { passive: true });
  document.addEventListener('click', () => onReal('click'));
  document.addEventListener('wheel', () => onReal('scroll'), { passive: true });
  document.addEventListener('keydown', () => { lastReal = now(); /* count as activity, not logging content */ M.record('click', false); });

  /* ----------------------------- generator ------------------------------ */
  // The sandbox shows REAL-style actions, not just a moving cursor: the cursor
  // travels to UI targets, clicks flash buttons + ripple, scrolling moves a list,
  // and typing/“window opened” popups appear — so it reads as a real user working.
  const stage = $('stage'); const cursor = $('cursor');
  const sandList = $('sand-list'); const sandThumb = $('sand-thumb'); const sandPops = $('sand-pops');
  for (let i = 0; i < 16; i++) { const r = document.createElement('div'); r.className = 'swin-row'; sandList.appendChild(r); }
  let cur = { x: 40, y: 40 }; let listY = 0; let genTimer = null; let actions = 0;
  function stageSize() { const r = stage.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  function targets() { return [].slice.call(stage.querySelectorAll('[data-target]')); }
  function centerOf(el) { const s = stage.getBoundingClientRect(); const e = el.getBoundingClientRect(); return { x: e.left - s.left + e.width / 2, y: e.top - s.top + e.height / 2 }; }

  let moveRAF = 0;
  // Animate the cursor to (tx,ty); `done` fires the instant it actually arrives,
  // so a click can wait for the cursor to truly land on its target (not snap early).
  function moveCursor(tx, ty, dur, done) {
    const sx = cur.x, sy = cur.y; const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    cancelAnimationFrame(moveRAF);
    function step(tm) {
      const k = Math.min(1, (tm - start) / dur); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cur.x = sx + (tx - sx) * e; cur.y = sy + (ty - sy) * e;
      cursor.style.transform = `translate(${cur.x}px,${cur.y}px)`;
      if (k < 1) { moveRAF = requestAnimationFrame(step); }
      else { cur.x = tx; cur.y = ty; if (done) done(); }
    }
    moveRAF = requestAnimationFrame(step);
  }
  function ripple(x, y) { const el = document.createElement('div'); el.className = 'ripple'; el.style.left = x + 'px'; el.style.top = y + 'px'; stage.appendChild(el); setTimeout(() => el.remove(), 620); }
  function press(el) { el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 240); }
  function typeWord(el, done) {
    if (!el) { if (done) done(); return; }
    const words = lang === 'ru' ? ['Отчёт.docx', 'Привет', 'Данные', 'Задача', 'Готово'] : ['Report.docx', 'Hello', 'Data', 'Task', 'Done'];
    const w = words[Math.floor(Math.random() * words.length)]; el.textContent = ''; let i = 0;
    const iv = setInterval(() => { el.textContent += w[i++] || ''; if (i >= w.length) { clearInterval(iv); if (done) setTimeout(done, rnd(280, 600)); } }, rnd(60, 100));
  }
  function clearInput() { const el = $('sand-type'); if (el) el.textContent = ''; }
  function popup(label) {
    if (!sandPops) return;
    let text;
    if (label && /Сверн|Minim/.test(label)) text = lang === 'ru' ? 'Свернуто' : 'Minimized';
    else if (label && /Откр|Open/.test(label)) text = lang === 'ru' ? 'Окно открыто' : 'Window opened';
    else text = lang === 'ru' ? 'Файл сохранён' : 'File saved';
    const el = document.createElement('div'); el.className = 'sand-pop'; el.innerHTML = '<i></i>' + text;
    sandPops.appendChild(el); while (sandPops.children.length > 3) sandPops.removeChild(sandPops.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 360); }, 1600);
  }
  function scrollList(dir) {
    const box = sandList.parentElement; const max = Math.max(0, sandList.scrollHeight - box.clientHeight + 8);
    listY = clamp(listY - dir * 34, -max, 0); sandList.style.transform = `translateY(${listY}px)`;
    if (sandThumb) { const track = Math.max(0, box.clientHeight - sandThumb.offsetHeight - 16); const ratio = max > 0 ? (-listY / max) : 0; sandThumb.style.transform = `translateY(${ratio * track}px)`; }
  }

  // The arrow tip sits ~5px right / 3px down inside the cursor SVG, so offset the
  // cursor box by that much to put the tip exactly on the target point.
  const TIP_X = 5, TIP_Y = 3;
  // Travel the cursor so its tip lands exactly on point p, then run cb on arrival.
  function moveTo(p, cb) { moveCursor(p.x - TIP_X, p.y - TIP_Y, rnd(440, 760), cb); }
  // Move the cursor onto an element, wait for it to truly land, pause as a human
  // would before pressing, then click exactly where the tip rests and run cb.
  function clickAt(el, cb) {
    const c = centerOf(el);
    moveTo(c, () => {
      M.record('move', true);                          // the move is counted once it completes
      setTimeout(() => {                               // brief settle before the press (no click-before-aim)
        try { press(el); ripple(c.x, c.y); M.record('click', true); } catch (_) {}
        if (cb) cb();
      }, rnd(220, 420));
    });
  }

  // A realistic, ordered scenario with human pauses between every stage:
  // cursor lands on the input → click → field activates → (pause) → text typed →
  // (pause, "reads" it) → cursor travels to a button, stops, clicks → text clears
  // + confirmation popup → (rest) → next scene.
  let formBusy = false;
  function runForm(after) {
    const input = stage.querySelector('.sand-input');
    const btns = [].slice.call(stage.querySelectorAll('.sand-btn'));
    if (!input || !btns.length) { if (after) after(); return; }
    formBusy = true;
    const btn = btns[Math.floor(Math.random() * btns.length)];
    clickAt(input, () => {                              // 1. land on the field and click it
      input.classList.add('focused');                  //    active ONLY after the click lands
      setTimeout(() => {                                //    short beat, then start typing
        typeWord($('sand-type'), () => {               // 2. type the text
          setTimeout(() => {                            //    ~1.5s pause, as if reading what was typed
            clickAt(btn, () => {                        // 3. travel to the button, settle, press it
              input.classList.remove('focused');
              clearInput();                             //    the text disappears
              popup(btn.textContent || '');             //    confirmation appears
              setTimeout(() => { formBusy = false; if (after) after(); }, rnd(900, 1500)); // rest before next scene
            });
          }, rnd(1100, 1600));
        });
      }, rnd(420, 700));
    });
  }

  function nextDelay() { const r = rates(); const pm = Math.max(0.1, r.move + r.click + r.scroll); return Math.round((60000 / pm) * rnd(0.55, 1.6)); }
  function chooseAction() { const r = rates(); const bag = [['move', r.move]]; if (r.click > 0) bag.push(['click', r.click]); if (r.scroll > 0) bag.push(['scroll', r.scroll]); const total = bag.reduce((a, [, w]) => a + w, 0); let x = Math.random() * total; for (const [n, w] of bag) { if ((x -= w) <= 0) return n; } return 'move'; }

  // Drift the cursor to a free spot in the stage, settle, then continue.
  function runMove(after) {
    formBusy = true;
    let { w, h } = stageSize(); if (!w) { w = 360; h = 230; }
    moveCursor(rnd(24, w - 30), rnd(24, h - 30), rnd(420, 760), () => {
      M.record('move', true);
      setTimeout(() => { formBusy = false; if (after) after(); }, rnd(500, 900));
    });
  }
  // Move the cursor onto the document list, then scroll a few notches under it.
  function runScroll(after) {
    formBusy = true;
    const box = sandList.parentElement; const c = centerOf(box);
    moveTo(c, () => {
      M.record('move', true);
      let n = 1 + Math.floor(Math.random() * 3); const dir = Math.random() < 0.5 ? 1 : -1;
      (function stepScroll() {
        if (n-- <= 0) { setTimeout(() => { formBusy = false; if (after) after(); }, rnd(500, 900)); return; }
        scrollList(dir); M.record('scroll', true);
        setTimeout(stepScroll, rnd(280, 480));
      })();
    });
  }
  // Single deliberate button press (no form), serialized like the other scenes.
  function runClick(after) {
    formBusy = true;
    const bs = [].slice.call(stage.querySelectorAll('.sand-btn'));
    clickAt(bs[Math.floor(Math.random() * bs.length)] || stage, () => {
      setTimeout(() => { formBusy = false; if (after) after(); }, rnd(800, 1300));
    });
  }

  // Window scene: the cursor lands on a window's title bar, "clicks", the window
  // minimizes (sinks + fades), then a moment later restores ("opens"). Mirrors the
  // desktop's Alt+Tab/minimize so the sandbox reads as real multi-window work.
  function runWindow(after) {
    formBusy = true;
    const wins = [].slice.call(stage.querySelectorAll('.swin'));
    if (!wins.length) { formBusy = false; if (after) after(); return; }
    const win = wins[Math.floor(Math.random() * wins.length)];
    const bar = win.querySelector('.swin-bar') || win;
    moveTo(centerOf(bar), () => {                          // 1. travel to the title bar
      M.record('move', true);
      setTimeout(() => {                                   // 2. click → minimize
        const c = centerOf(bar); ripple(c.x, c.y); M.record('click', true);
        win.classList.add('min'); popup('Свернуть');
        setTimeout(() => {                                 // 3. restore → "open"
          win.classList.remove('min'); M.record('click', true); popup('Открыть');
          setTimeout(() => { formBusy = false; if (after) after(); }, rnd(700, 1100));
        }, rnd(1100, 1700));
      }, rnd(220, 420));
    });
  }

  // The full input→type→button scene is the showcase, but raw click rates make it
  // rare. Guarantee it recurs every few scenes so the sandbox always reads as a
  // real user working (filler move/scroll scenes play in between).
  let sinceClick = 0, clickEvery = 4 + Math.floor(Math.random() * 4);
  let sinceScene = 0, winEvery = 7 + Math.floor(Math.random() * 6);
  function schedule() { if (cfg.running && !formBusy) genTimer = setTimeout(tick, nextDelay()); }
  function tick() {
    if (!cfg.running || formBusy) return;
    if (cfg.pauseOnUser && now() - lastReal < 3000) { genTimer = setTimeout(tick, 2400); return; }
    // Every few scenes, play a window minimize/open animation (mirrors the desktop).
    if (++sinceScene >= winEvery) { sinceScene = 0; winEvery = 7 + Math.floor(Math.random() * 6); actions++; runWindow(schedule); return; }
    let action = chooseAction(); actions++;
    if (action !== 'click' && rates().click > 0 && ++sinceClick >= clickEvery) action = 'click';
    if (action === 'click') { sinceClick = 0; clickEvery = 4 + Math.floor(Math.random() * 4); }
    try {
      // Each branch is a self-contained "scene" that reschedules via its callback
      // when it finishes, so scenes never overlap and the cursor never teleports.
      if (action === 'click') { if (Math.random() < 0.7) runForm(schedule); else runClick(schedule); return; }
      if (action === 'scroll') { runScroll(schedule); return; }
      runMove(schedule); return;
    } catch (_) { formBusy = false; schedule(); }
  }
  function startGen() { if (genTimer) return; M.genOn = true; formBusy = false; cur = { x: 40, y: 40 }; genTimer = setTimeout(tick, 300); syncWake(); }
  function stopGen() { M.genOn = false; formBusy = false; if (genTimer) { clearTimeout(genTimer); genTimer = null; } syncWake(); }

  /* ------------------------------ wake lock ----------------------------- */
  // The browser keeps the screen awake ONLY while this tab is visible — every
  // browser drops the Wake Lock when the tab is hidden/minimized and it can't be
  // re-taken from the background, nor can a page focus its own tab. So we hold the
  // lock while the app is running + visible, re-take it on return, and say so
  // honestly. For guaranteed background keep-awake, the desktop app is the answer.
  let wakeLock = null; const wakeSupported = ('wakeLock' in navigator);
  async function syncWake() {
    const wantLock = cfg.running && cfg.wake && document.visibilityState === 'visible';
    if (wantLock && !wakeLock && wakeSupported) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; renderWakeNote(); });
      } catch (_) { wakeLock = null; toast(t('wakeErr')); }
    } else if (!wantLock && wakeLock) {
      try { wakeLock.release(); } catch (_) {} wakeLock = null;
    }
    renderWakeNote();
  }
  document.addEventListener('visibilitychange', syncWake);
  function renderWakeNote() {
    const n = $('wake-note'); if (!n) return; let msg, warn = false;
    if (!wakeSupported) msg = t('wakeNo');
    else if (!cfg.wake) msg = t('wakeOff');
    else if (!cfg.running) msg = t('wakeIdle');
    else if (document.visibilityState !== 'visible') { msg = t('wakeHidden'); warn = true; } // truly backgrounded
    else if (wakeLock) msg = t('wakeOn');                                                    // visible + held
    else { msg = t('wakeErr'); warn = true; }                                                // visible but couldn't hold
    n.textContent = msg; n.classList.toggle('warn', warn);
  }

  /* -------------------------------- render ------------------------------ */
  function renderStatus() {
    $('dot').className = 'statusdot' + (cfg.running ? ' on' : '');
    $('statustext').textContent = cfg.running ? t('running') : t('paused');
    // Show only one control: green "Run" when stopped, red "Stop" when running.
    document.querySelectorAll('#runmode button').forEach((b) => { b.style.display = ((b.dataset.mode === 'on') === !cfg.running) ? '' : 'none'; });
  }
  function renderRates() {
    let b; if (cfg.level === 'custom') { const x = cfg.intensity / 100; b = { move: 4 + 46 * x, click: 0.3 + 5.7 * x, scroll: 0.5 + 6.5 * x }; } else b = PRESET[cfg.level] || PRESET.balanced;
    const items = [[Math.round(b.move), t('moves')], [cfg.includeClicks ? b.click.toFixed(1) : '0', t('clicks')], [cfg.includeScroll ? b.scroll.toFixed(1) : '0', t('scrolls')]];
    $('rates').innerHTML = items.map(([n, l]) => `<div class="rate"><b>${n}</b><span>${l}</span></div>`).join('');
    document.querySelectorAll('#levels button').forEach((x) => x.classList.toggle('active', x.dataset.level === cfg.level));
    $('custom-wrap').style.display = cfg.level === 'custom' ? 'block' : 'none';
  }
  async function refreshCharts() {
    window.Charts.area($('chart'), M.series(60), { height: 170 });
    const s = M.summary();
    $('cmp-shadow').style.width = Math.min(100, s.shadow) + '%'; $('cmp-shadow-v').textContent = s.shadow;
    $('cmp-passive').style.width = Math.min(100, s.passive) + '%'; $('cmp-passive-v').textContent = s.passive;
  }

  /* -------------------------------- events ------------------------------ */
  document.querySelectorAll('#runmode button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'on' && window.DriftlyGate && !window.DriftlyGate.allowed()) { window.DriftlyGate.show(); return; }
    cfg.running = b.dataset.mode === 'on'; saveCfg(); if (cfg.running) startGen(); else stopGen(); renderStatus();
  }));
  // Stop the engine immediately if access is revoked (e.g. trial ended / past_due).
  window.addEventListener('driftly-access-changed', () => {
    if (window.DriftlyGate && !window.DriftlyGate.allowed() && cfg.running) {
      cfg.running = false; saveCfg(); stopGen(); renderStatus();
    }
  });
  document.querySelectorAll('#levels button').forEach((b) => b.addEventListener('click', () => { cfg.level = b.dataset.level; saveCfg(); renderRates(); }));
  $('intensity').addEventListener('input', (e) => { cfg.intensity = +e.target.value; $('intensity-val').textContent = e.target.value; renderRates(); });
  $('intensity').addEventListener('change', saveCfg);
  [['opt-clicks', 'includeClicks'], ['opt-scroll', 'includeScroll'], ['opt-pause', 'pauseOnUser']].forEach(([id, key]) => $(id).addEventListener('change', (e) => { cfg[key] = e.target.checked; saveCfg(); renderRates(); }));
  $('opt-wake').addEventListener('change', (e) => { cfg.wake = e.target.checked; saveCfg(); syncWake(); });
  function download(name, text, type) { const b = new Blob([text], { type }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  $('exp-csv').addEventListener('click', () => { download('driftly-web-metrics.csv', '\uFEFF' + M.csv(), 'text/csv;charset=utf-8'); toast(t('exported')); });
  $('exp-json').addEventListener('click', () => { download('driftly-web-metrics.json', M.json(), 'application/json'); toast(t('exported')); });
  $('reset').addEventListener('click', () => { M.reset(); refreshCharts(); toast(t('reset')); });
  document.querySelectorAll('#lang-ru,#lang-en').forEach((b) => b.addEventListener('click', () => { lang = b.id.endsWith('ru') ? 'ru' : 'en'; localStorage.setItem('driftly.lang', lang); applyLang(); window.dispatchEvent(new Event('driftly-lang-changed')); }));
  let toastTimer; function toast(m, kind) { const el = $('toast'); el.textContent = m; el.className = 'toast show' + (kind ? ' ' + kind : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
  window.DriftlyToast = toast; // prominent notifications, reused by web-account.js
  // Styled confirmation dialog (replaces window.confirm), returns a Promise<boolean>.
  function driftlyConfirm(message) {
    return new Promise((resolve) => {
      const ov = $('confirm-modal');
      if (!ov) { resolve(window.confirm(message)); return; }
      $('confirm-msg').textContent = message;
      ov.style.display = 'flex';
      const yes = $('confirm-yes'), no = $('confirm-no');
      const done = (v) => { ov.style.display = 'none'; yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); ov.removeEventListener('click', onBg); document.removeEventListener('keydown', onKey); resolve(v); };
      const onYes = () => done(true), onNo = () => done(false);
      const onBg = (e) => { if (e.target === ov) done(false); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      yes.addEventListener('click', onYes); no.addEventListener('click', onNo); ov.addEventListener('click', onBg); document.addEventListener('keydown', onKey);
    });
  }
  window.DriftlyConfirm = driftlyConfirm;

  /* --------------------------------- loop ------------------------------- */
  setInterval(() => { const lv = M.live(); const h = M.lastHour(); window.Charts.gauge($('gauge'), lv.gauge); $('kpi-events').textContent = h.total; $('kpi-syn').textContent = h.synthetic; $('kpi-real').textContent = h.real; }, 1000);
  setInterval(refreshCharts, 2500);
  setInterval(() => M.save(), 15000);
  window.addEventListener('beforeunload', () => M.save());
  window.addEventListener('resize', refreshCharts);

  /* --------------------------------- init ------------------------------- */
  $('opt-clicks').checked = cfg.includeClicks; $('opt-scroll').checked = cfg.includeScroll;
  $('opt-pause').checked = cfg.pauseOnUser; $('opt-wake').checked = cfg.wake; $('intensity').value = cfg.intensity; $('intensity-val').textContent = cfg.intensity;
  applyLang(); renderStatus(); renderRates(); renderWakeNote(); window.Charts.gauge($('gauge'), 0); refreshCharts();

  /* --------------------------------- tabs ------------------------------- */
  // Section tabs: Приложение (engine) / Подписка / Аккаунт. The panels keep all
  // their element ids, so web-account.js keeps rendering into them regardless of
  // which tab is visible. window.DriftlyTabs.show lets the paywall jump to a tab.
  function showTab(name) {
    if (!document.querySelector('.tab-panel[data-panel="' + name + '"]')) name = 'app'; // guard stale/removed tabs (e.g. old "account")
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = (p.dataset.panel !== name); });
    try { localStorage.setItem('driftly.tab', name); } catch (_) {}
    if (name === 'app') { try { refreshCharts(); } catch (_) {} } // re-render canvases sized while hidden
  }
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  window.DriftlyTabs = { show: showTab };
  showTab(localStorage.getItem('driftly.tab') || 'app');

  // PWA service worker (offline app shell) — optional, ignore failures.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}());
