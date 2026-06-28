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
      wakeNo: 'Этот браузер не умеет удерживать экран активным.', wakeErr: 'Не удалось удержать экран активным (нужен HTTPS).' },
    en: { running: 'Running', paused: 'Paused', moves: 'moves/min', clicks: 'clicks/min', scrolls: 'scrolls/min',
      exported: 'File saved', reset: 'Reset', wakeOn: 'Screen is kept awake.', wakeOff: 'Wake Lock off.',
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
  const DEFAULT = { running: false, level: 'balanced', intensity: 50, includeClicks: true, includeScroll: true, pauseOnUser: true, wake: false };
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
  function moveCursor(tx, ty, dur) {
    const sx = cur.x, sy = cur.y; const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    cancelAnimationFrame(moveRAF);
    function step(tm) {
      const k = Math.min(1, (tm - start) / dur); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cur.x = sx + (tx - sx) * e; cur.y = sy + (ty - sy) * e;
      cursor.style.transform = `translate(${cur.x}px,${cur.y}px)`;
      if (k < 1) moveRAF = requestAnimationFrame(step);
    }
    moveRAF = requestAnimationFrame(step);
    cur.x = tx; cur.y = ty; // logical position lands immediately (animation is cosmetic)
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
    const open = label && /Откр|Open/.test(label);
    const text = lang === 'ru' ? (open ? 'Окно открыто' : 'Файл сохранён') : (open ? 'Window opened' : 'File saved');
    const el = document.createElement('div'); el.className = 'sand-pop'; el.innerHTML = '<i></i>' + text;
    sandPops.appendChild(el); while (sandPops.children.length > 3) sandPops.removeChild(sandPops.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 360); }, 1600);
  }
  function scrollList(dir) {
    const box = sandList.parentElement; const max = Math.max(0, sandList.scrollHeight - box.clientHeight + 8);
    listY = clamp(listY - dir * 34, -max, 0); sandList.style.transform = `translateY(${listY}px)`;
    if (sandThumb) { const track = Math.max(0, box.clientHeight - sandThumb.offsetHeight - 16); const ratio = max > 0 ? (-listY / max) : 0; sandThumb.style.transform = `translateY(${ratio * track}px)`; }
  }

  // Move the cursor onto an element, let it "land", then press it and run cb.
  function clickAt(el, cb) {
    const c = centerOf(el); const dur = rnd(320, 560);
    moveCursor(c.x - 6, c.y - 4, dur); M.record('move', true);
    setTimeout(() => { try { press(el); ripple(c.x, c.y); M.record('click', true); if (cb) cb(); } catch (_) { if (cb) cb(); } }, dur * 0.9);
  }

  // A realistic, ordered scenario: click the input → it becomes active → type the
  // text → the cursor moves to a button, stops on it, clicks → text clears + popup.
  let formBusy = false;
  function runForm(after) {
    const input = stage.querySelector('.sand-input');
    const btns = [].slice.call(stage.querySelectorAll('.sand-btn'));
    if (!input || !btns.length) { if (after) after(); return; }
    formBusy = true;
    const btn = btns[Math.floor(Math.random() * btns.length)];
    clickAt(input, () => {
      input.classList.add('focused');                 // active only after the click lands
      typeWord($('sand-type'), () => {                // then text is typed
        clickAt(btn, () => {                          // cursor goes to the button and presses it
          input.classList.remove('focused');
          clearInput();                               // and the text disappears
          popup(btn.textContent || '');
          formBusy = false;
          if (after) after();
        });
      });
    });
  }

  function nextDelay() { const r = rates(); const pm = Math.max(0.1, r.move + r.click + r.scroll); return Math.round((60000 / pm) * rnd(0.55, 1.6)); }
  function chooseAction() { const r = rates(); const bag = [['move', r.move]]; if (r.click > 0) bag.push(['click', r.click]); if (r.scroll > 0) bag.push(['scroll', r.scroll]); const total = bag.reduce((a, [, w]) => a + w, 0); let x = Math.random() * total; for (const [n, w] of bag) { if ((x -= w) <= 0) return n; } return 'move'; }

  function schedule() { if (cfg.running && !formBusy) genTimer = setTimeout(tick, nextDelay()); }
  function tick() {
    if (!cfg.running || formBusy) return;
    if (cfg.pauseOnUser && now() - lastReal < 3000) { genTimer = setTimeout(tick, 2400); return; }
    let { w, h } = stageSize(); if (!w) { w = 360; h = 230; }
    const action = chooseAction(); actions++;
    try {
      if (action === 'click') {
        // most clicks run the full input→type→button flow; otherwise a single button press
        if (Math.random() < 0.7) { runForm(schedule); }
        else { const bs = [].slice.call(stage.querySelectorAll('.sand-btn')); clickAt(bs[Math.floor(Math.random() * bs.length)] || stage, schedule); }
        return; // these reschedule via their own callback when the action finishes
      }
      if (action === 'scroll') { scrollList(Math.random() < 0.5 ? 1 : -1); M.record('scroll', true); }
      else { moveCursor(rnd(18, w - 28), rnd(18, h - 28), rnd(260, 560)); M.record('move', true); }
    } catch (_) {}
    schedule();
  }
  function startGen() { if (genTimer) return; M.genOn = true; formBusy = false; cur = { x: 40, y: 40 }; genTimer = setTimeout(tick, 300); }
  function stopGen() { M.genOn = false; formBusy = false; if (genTimer) { clearTimeout(genTimer); genTimer = null; } }

  /* ------------------------------ wake lock ----------------------------- */
  let wakeLock = null; const wakeSupported = ('wakeLock' in navigator);
  async function enableWake() { if (!wakeSupported) return; try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => {}); } catch (_) { cfg.wake = false; $('opt-wake').checked = false; toast(t('wakeErr')); } renderWakeNote(); }
  function disableWake() { if (wakeLock) { try { wakeLock.release(); } catch (_) {} wakeLock = null; } renderWakeNote(); }
  document.addEventListener('visibilitychange', () => { if (cfg.wake && document.visibilityState === 'visible') enableWake(); });
  function renderWakeNote() { const n = $('wake-note'); if (!wakeSupported) { n.textContent = t('wakeNo'); return; } n.textContent = cfg.wake ? t('wakeOn') : t('wakeOff'); }

  /* -------------------------------- render ------------------------------ */
  function renderStatus() {
    $('dot').className = 'statusdot' + (cfg.running ? ' on' : '');
    $('statustext').textContent = cfg.running ? t('running') : t('paused');
    document.querySelectorAll('#runmode button').forEach((b) => b.classList.toggle('active', (b.dataset.mode === 'on') === cfg.running));
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
  $('opt-wake').addEventListener('change', (e) => { cfg.wake = e.target.checked; saveCfg(); if (cfg.wake) enableWake(); else disableWake(); });
  function download(name, text, type) { const b = new Blob([text], { type }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  $('exp-csv').addEventListener('click', () => { download('driftly-web-metrics.csv', '\uFEFF' + M.csv(), 'text/csv;charset=utf-8'); toast(t('exported')); });
  $('exp-json').addEventListener('click', () => { download('driftly-web-metrics.json', M.json(), 'application/json'); toast(t('exported')); });
  $('reset').addEventListener('click', () => { M.reset(); refreshCharts(); toast(t('reset')); });
  document.querySelectorAll('#lang-ru,#lang-en').forEach((b) => b.addEventListener('click', () => { lang = b.id.endsWith('ru') ? 'ru' : 'en'; localStorage.setItem('driftly.lang', lang); applyLang(); window.dispatchEvent(new Event('driftly-lang-changed')); }));
  let toastTimer; function toast(m) { const el = $('toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200); }

  /* --------------------------------- loop ------------------------------- */
  setInterval(() => { const lv = M.live(); const h = M.lastHour(); window.Charts.gauge($('gauge'), lv.gauge); $('kpi-events').textContent = h.total; $('kpi-syn').textContent = h.synthetic; $('kpi-real').textContent = h.real; }, 1000);
  setInterval(refreshCharts, 2500);
  setInterval(() => M.save(), 15000);
  window.addEventListener('beforeunload', () => M.save());
  window.addEventListener('resize', refreshCharts);

  /* --------------------------------- init ------------------------------- */
  $('opt-clicks').checked = cfg.includeClicks; $('opt-scroll').checked = cfg.includeScroll;
  $('opt-pause').checked = cfg.pauseOnUser; $('opt-wake').checked = false; $('intensity').value = cfg.intensity; $('intensity-val').textContent = cfg.intensity;
  applyLang(); renderStatus(); renderRates(); window.Charts.gauge($('gauge'), 0); refreshCharts();

  // PWA service worker (offline app shell) — optional, ignore failures.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}());
