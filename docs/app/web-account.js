/* web-account.js — Driftly Web subscription/account client + paywall.
 * Talks to the same licensing server as the desktop app, so ONE subscription
 * unlocks both. The web client trusts the HTTPS server response (and caches the
 * signed token for offline display). If no API is configured it runs in PREVIEW
 * mode (open access + a banner). Defines window.DriftlyGate for web.js. */
(function () {
  'use strict';
  var Ent = window.DriftlyEntitlement; // shared/entitlement.js
  var Lic = window.DriftlyLicense;      // shared/license.js
  var $ = function (id) { return document.getElementById(id); };

  // The deployed licensing server — the backend that stores the subscription on the
  // account (by email) and issues signed licenses, so it's active in the browser and
  // the desktop alike. (Override for testing via ?api= or localStorage.)
  var DEFAULT_API = 'https://api.driftly.site';

  var state = {
    api: localStorage.getItem('driftly.api') || DEFAULT_API,
    token: localStorage.getItem('driftly.acctToken') || null,
    license: localStorage.getItem('driftly.license') || null,
    serverEnt: null, account: null, online: false,
  };
  var qApi = new URLSearchParams(location.search).get('api');
  if (qApi !== null) { state.api = qApi; localStorage.setItem('driftly.api', qApi); }
  var dismissed = false; // paywall temporarily dismissed so the sign-in/pay panel stays reachable
  var activating = false; // showing "activating…" while we confirm a card binding after redirect
  var PRICE = (Ent && Ent.PLAN) || { priceMonthly: 199, priceYearly: 1999, yearlyDiscountPct: 16 };
  var selectedInterval = 'month';

  function preview() { return !state.api; }
  function persist() {
    localStorage.setItem('driftly.api', state.api || '');
    if (state.token) localStorage.setItem('driftly.acctToken', state.token); else localStorage.removeItem('driftly.acctToken');
    if (state.license) localStorage.setItem('driftly.license', state.license); else localStorage.removeItem('driftly.license');
  }

  function entitlement() {
    if (preview()) return { plan: 'preview', status: 'preview', access: true, blocked: false, isPro: true, needsPayment: false, reason: 'preview', preview: true, features: (Ent ? Ent.FEATURES.slice() : []), trialDaysLeft: 0, account: null, renewsAt: null };
    if (state.online && state.serverEnt) return state.serverEnt;             // fresh from server
    var payload = state.license && Lic ? Lic.decode(state.license) : null;   // offline fallback
    return Ent ? Ent.compute(payload) : { blocked: true, access: false, reason: 'none', needsPayment: false };
  }

  function headers() { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token }; }
  function emit() { window.dispatchEvent(new Event('driftly-access-changed')); render(); }

  async function refresh() {
    if (preview() || !state.token) { emit(); return; }
    try {
      var r = await fetch(state.api + '/v1/status', { headers: headers() });
      var j = await r.json();
      if (j.license) state.license = j.license;
      state.serverEnt = j.entitlement || null; state.account = j.account || null; state.online = true; persist();
    } catch (e) { state.online = false; }
    emit();
  }
  async function call(method, p, body) {
    var r = await fetch(state.api + p, { method: method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    var j = await r.json();
    if (j.license) state.license = j.license;
    if (j.entitlement) state.serverEnt = j.entitlement;
    if (j.account) state.account = j.account;
    state.online = true; persist(); emit();
    return j;
  }
  async function authRequest(email) {
    try { var r = await fetch(state.api + '/v1/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }); return await r.json(); }
    catch (e) { return { ok: false, error: 'offline' }; }
  }
  async function authVerify(email, code) {
    try {
      var r = await fetch(state.api + '/v1/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, code: code }) });
      var j = await r.json();
      if (j.accountToken) { state.token = j.accountToken; persist(); await refresh(); return { ok: true }; }
      return { ok: false, error: j.error };
    } catch (e) { return { ok: false, error: 'offline' }; }
  }

  // ---- gate API consumed by web.js ----
  window.DriftlyGate = {
    allowed: function () { return !!entitlement().access; },
    show: function () { dismissed = false; render(); }, // re-show the paywall prompt
    refresh: refresh,
    entitlement: entitlement,
  };

  /* ------------------------------- rendering ------------------------------- */
  var L = {
    ru: { preview: 'Демо-режим: сервер лицензий не подключён — доступ открыт.', signin: 'Войдите, чтобы управлять подпиской.', trial: 'Подключить карту — 3 дня бесплатно', trialActive: 'Пробный период', daysLeft: 'дн. осталось', active: 'Подписка активна', renews: 'Продление', inactive: 'Подписка неактивна', pastDue: 'Необходимо оплатить', pastDueDesc: 'Списание не прошло. Оплатите, чтобы продолжить.', retry: 'Повторить оплату', cancel: 'Отменить подписку', attachCard: 'Привязать карту', updateCard: 'Изменить карту', activating: 'Активируем подписку… несколько секунд', confirmCancel: 'Отменить подписку? Доступ сохранится до конца оплаченного периода, автосписание не произойдёт.', confirmPlanQ: 'Перейти на тариф', bindFailed: 'Не удалось привязать карту. Попробуйте ещё раз.', pwText: 'Подключите карту и получите 3 дня бесплатно. Driftly работает и в браузере, и в десктоп-приложении.', goSub: 'Открыть подписку', codeBad: 'Неверный код', emailEmpty: 'Введите email', emailBad: 'Неверный формат email', codeSent: 'Код отправлен — проверьте почту', sentTo: 'Код отправлен на', resend: 'Отправить ещё раз', changeEmail: 'Изменить email', codeValidFor: 'Код действителен ещё', codeExpired: 'Код истёк — запросите новый', resume: 'Возобновить', accessUntil: 'доступ до', trialCanceled: 'Пробный период отменён', subCanceled: 'Подписка отменена', noRenew: 'продление не произойдёт', monthly: 'Помесячно', yearly: 'За год', perMonth: '₽/мес', perYear: '₽/год', planYearWord: 'годовая', planMonthWord: 'месячная', changePlan: 'Тариф', intervalNote: 'Смена тарифа применится со следующего списания.' },
    en: { preview: 'Demo mode: no licensing server — access is open.', signin: 'Sign in to manage your subscription.', trial: 'Add a card — 3 days free', trialActive: 'Free trial', daysLeft: 'days left', active: 'Subscription active', renews: 'Renews', inactive: 'Subscription inactive', pastDue: 'Payment required', pastDueDesc: 'The charge failed. Pay to continue.', retry: 'Retry payment', cancel: 'Cancel subscription', attachCard: 'Add a card', updateCard: 'Change card', activating: 'Activating your subscription… a few seconds', confirmCancel: 'Cancel subscription? Access stays until the end of the paid period; no auto-charge will happen.', confirmPlanQ: 'Switch to plan', bindFailed: 'Could not link the card. Please try again.', pwText: 'Add a card and get 3 days free. Driftly works in the browser and in the desktop app.', goSub: 'Open subscription', codeBad: 'Invalid code', emailEmpty: 'Enter your email', emailBad: 'Invalid email format', codeSent: 'Code sent — check your email', sentTo: 'Code sent to', resend: 'Resend code', changeEmail: 'Change email', codeValidFor: 'Code valid for', codeExpired: 'Code expired — request a new one', resume: 'Resume', accessUntil: 'access until', trialCanceled: 'Trial cancelled', subCanceled: 'Subscription cancelled', noRenew: 'will not renew', monthly: 'Monthly', yearly: 'Yearly', perMonth: '₽/mo', perYear: '₽/yr', planYearWord: 'yearly', planMonthWord: 'monthly', changePlan: 'Plan', intervalNote: 'The plan change applies from your next charge.' },
  };
  function lang() { return localStorage.getItem('driftly.lang') || 'ru'; }
  function t(k) { return L[lang()][k]; }
  function fmt(ms) { try { return new Date(ms).toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-US'); } catch (e) { return ''; } }

  // Jump to the subscription tab (web.js owns the tabs) and scroll it into view.
  function showView(v) { if (v === 'subscription') { if (window.DriftlyTabs) window.DriftlyTabs.show('sub'); var el = $('sub-panel'); if (el) el.scrollIntoView({ behavior: 'smooth' }); } }

  function render() {
    var e = entitlement();
    // banner
    var bn = $('acc-banner');
    if (bn) {
      if (preview()) { bn.style.display = 'flex'; bn.className = 'note info'; bn.textContent = t('preview'); }
      else if (e.reason === 'trial') { bn.style.display = 'flex'; bn.className = 'note info'; bn.textContent = '✨ ' + t('trialActive') + ': ' + e.trialDaysLeft + ' ' + t('daysLeft'); }
      else if (e.needsPayment) { bn.style.display = 'flex'; bn.className = 'note warn'; bn.textContent = '⚠ ' + t('pastDue'); }
      else bn.style.display = 'none';
    }
    // paywall — dismissable so the sign-in / payment panel below stays reachable.
    var blocked = e.blocked && !preview();
    if (!blocked) dismissed = false; // reset so it reappears next time access is lost
    var pw = $('paywall');
    if (pw) {
      var show = blocked && !dismissed;
      pw.style.display = show ? 'flex' : 'none';
      if (show) {
        $('pw-title').textContent = e.needsPayment ? t('pastDue') : t('goSub');
        $('pw-text').textContent = e.needsPayment ? t('pastDueDesc') : t('pwText');
        $('pw-retry').style.display = e.needsPayment ? 'inline-flex' : 'none';
        $('pw-retry').textContent = t('retry');
        $('pw-cta').textContent = t('goSub');
      }
    }
    // account block (sign-in / signed-in) — lives at the top of the Subscription card
    if ($('sub-auth')) $('sub-auth').style.display = preview() ? 'none' : 'block';
    if ($('sub-signin')) $('sub-signin').style.display = (!preview() && !state.token) ? 'block' : 'none';
    if ($('sub-signedin')) $('sub-signedin').style.display = (state.token && !preview()) ? 'block' : 'none';
    if ($('sub-who')) $('sub-who').textContent = e.account || '';
    var box = $('sub-state'); if (!box) return;
    if (preview()) { box.innerHTML = sb('trial', '✨', t('preview'), ''); return; }
    if (!state.token) { box.innerHTML = sb('', '👤', t('signin'), ''); return; }
    // Just returned from the card form — confirming the binding before showing the plan.
    if (activating && !(e.reason === 'trial' || e.reason === 'active')) { box.innerHTML = sb('trial', '⏳', t('activating'), ''); return; }
    var cof = !!(state.account && state.account.cardOnFile);
    if (e.reason === 'trial') box.innerHTML = e.canceled
      ? sb('trial', '✨', t('trialCanceled'), t('accessUntil') + ' ' + fmt(e.renewsAt)) + rbtn()
      : sb('trial', '✨', t('trialActive'), e.trialDaysLeft + ' ' + t('daysLeft')) + cardbtn(cof) + cbtn() + itoggle(e.interval);
    else if (e.reason === 'active') box.innerHTML = e.canceled
      ? sb('ok', '✓', t('subCanceled'), t('accessUntil') + ' ' + fmt(e.renewsAt) + ' · ' + t('noRenew')) + rbtn()
      : sb('ok', '✓', t('active') + ' · ' + (e.interval === 'year' ? t('planYearWord') : t('planMonthWord')), t('renews') + ': ' + fmt(e.renewsAt)) + cardbtn(cof) + cbtn() + itoggle(e.interval);
    else if (e.needsPayment) box.innerHTML = sb('bad', '⚠', t('pastDue'), t('pastDueDesc')) + '<button class="btn primary" data-acc="retry">' + t('retry') + '</button>';
    else box.innerHTML = sb('', '🔓', t('inactive'), '') + tbtn();
  }
  function sb(c, ic, ti, d) { return '<div class="sub-status ' + c + '"><span class="ic">' + ic + '</span><div><div class="t">' + ti + '</div><div class="d">' + (d || '') + '</div></div></div>'; }
  function ptoggle() {
    var yr = selectedInterval === 'year';
    return '<div class="plan-toggle">'
      + '<button class="' + (yr ? '' : 'on') + '" data-interval="month"><b>' + PRICE.priceMonthly + ' ' + t('perMonth') + '</b><span>' + t('monthly') + '</span></button>'
      + '<button class="' + (yr ? 'on' : '') + '" data-interval="year"><b>' + PRICE.priceYearly + ' ' + t('perYear') + '</b><span>' + t('yearly') + ' · −' + PRICE.yearlyDiscountPct + '%</span></button>'
      + '</div>';
  }
  function tbtn() { return ptoggle() + '<button class="btn primary btn-lg" data-acc="trial">' + t('trial') + '</button>'; }
  function cbtn() { return '<button class="btn ghost" data-acc="cancel" style="margin-top:12px">' + t('cancel') + '</button>'; }
  // In-account card management: a subtle "Изменить карту" when a card is on file, a
  // prominent "Привязать карту" only if somehow there's none.
  function cardbtn(cof) { return '<button class="btn ' + (cof ? 'ghost' : 'primary') + '" data-acc="attach-card" style="margin-top:12px">' + (cof ? t('updateCard') : t('attachCard')) + '</button>'; }
  function rbtn() { return '<button class="btn primary" data-acc="resume" style="margin-top:12px">' + t('resume') + '</button>'; }
  // Plan switch for an active/trial sub: highlights the CURRENT interval; clicking
  // the other one switches via /v1/billing/interval (applies from the next charge).
  function itoggle(current) {
    var yr = current === 'year';
    return '<div class="section-title" style="margin-top:18px">' + t('changePlan') + '</div>'
      + '<div class="plan-toggle">'
      + '<button class="' + (yr ? '' : 'on') + '" data-interval="month"><b>' + PRICE.priceMonthly + ' ' + t('perMonth') + '</b><span>' + t('monthly') + '</span></button>'
      + '<button class="' + (yr ? 'on' : '') + '" data-interval="year"><b>' + PRICE.priceYearly + ' ' + t('perYear') + '</b><span>' + t('yearly') + ' · −' + PRICE.yearlyDiscountPct + '%</span></button>'
      + '</div><div class="mode-note">' + t('intervalNote') + '</div>';
  }

  /* -------------------------------- events --------------------------------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-acc],[data-interval]'); if (!a) return;
    if (a.dataset.interval) {
      var ent = entitlement();
      // Subscribed (trial/active) → switch the billing interval on the server (with a
      // confirmation); otherwise it's just the pre-trial choice for the start-trial call.
      if (!preview() && state.token && (ent.reason === 'trial' || ent.reason === 'active') && a.dataset.interval !== ent.interval) {
        var yr = a.dataset.interval === 'year';
        var price = yr ? (PRICE.priceYearly + ' ' + t('perYear')) : (PRICE.priceMonthly + ' ' + t('perMonth'));
        var msg = t('confirmPlanQ') + ' «' + (yr ? t('yearly') : t('monthly')) + '» (' + price + ')?\n' + t('intervalNote');
        if (window.confirm(msg)) call('POST', '/v1/billing/interval', { interval: a.dataset.interval });
        else render();
      } else { selectedInterval = a.dataset.interval; render(); }
      return;
    }
    var act = a.dataset.acc;
    if (act === 'trial') {
      call('POST', '/v1/billing/start-trial', { interval: selectedInterval }).then(function (j) {
        var url = j && j.result && j.result.redirectUrl;
        if (url) window.location.href = url; // T-Bank: card binding (AddCard) + 3-D Secure
      });
    }
    else if (act === 'attach-card') {
      call('POST', '/v1/billing/attach-card').then(function (j) {
        var url = j && j.result && j.result.redirectUrl;
        if (url) window.location.href = url; // T-Bank: card binding (AddCard)
      });
    }
    else if (act === 'retry') call('POST', '/v1/billing/retry');
    else if (act === 'cancel') { if (window.confirm(t('confirmCancel'))) call('POST', '/v1/billing/cancel'); }
    else if (act === 'resume') call('POST', '/v1/billing/resume');
  });
  /* ---- sign-in code: validation toast + a persistent countdown timer ---- */
  var CODE_TTL = 300000; // 5 min — code validity, MUST match the server (AUTH_CODE_TTL_MS)
  var codeTimer = null;
  // Inline feedback right under the email/code field (not a bottom toast).
  function notify(msg, kind) { var n = $('sub-auth-note'); if (n) { stopCodeTimer(); n.innerHTML = '<span class="auth-msg ' + (kind || '') + '">' + msg + '</span>'; } else if (window.DriftlyToast) window.DriftlyToast(msg, kind); }
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function stopCodeTimer() { if (codeTimer) { clearTimeout(codeTimer); codeTimer = null; } }
  // Swap the email row for the code row (or back) — one row visible at a time.
  function showCodeStep(on) {
    if ($('sub-step-email')) $('sub-step-email').style.display = on ? 'none' : 'flex';
    if ($('sub-step-code')) $('sub-step-code').style.display = on ? 'flex' : 'none';
  }
  function codeExpired() { return (+localStorage.getItem('driftly.codeExp') || 0) <= Date.now(); }
  function clearCode() { stopCodeTimer(); localStorage.removeItem('driftly.codeExp'); localStorage.removeItem('driftly.codeEmail'); showCodeStep(false); if ($('sub-code')) $('sub-code').value = ''; if ($('sub-auth-note')) $('sub-auth-note').innerHTML = ''; }
  // Renders the code row + a 5-min validity countdown. While the code is live it
  // shows the time left; once it expires the code is dead (sign-in is blocked) and
  // "Отправить ещё раз" appears to request a fresh one.
  function runCodeTimer() {
    showCodeStep(true);
    stopCodeTimer();
    var email = localStorage.getItem('driftly.codeEmail') || ($('sub-email') && $('sub-email').value) || '';
    var exp = +localStorage.getItem('driftly.codeExp') || 0;
    var change = '<button type="button" class="linkbtn" data-act="change">' + t('changeEmail') + '</button>';
    (function tick() {
      var note = $('sub-auth-note'); if (!note) return;
      var left = exp - Date.now();
      var meta = left > 0
        ? '<span class="code-timer">⏳ ' + t('codeValidFor') + ' <b>' + mmss(left) + '</b></span>' + change
        : '<span class="code-timer warn">' + t('codeExpired') + '</span>'
          + '<button type="button" class="linkbtn" data-act="resend">' + t('resend') + '</button>' + change;
      note.innerHTML = '<div class="code-sent">' + t('sentTo') + ' <b>' + email + '</b></div>'
        + '<div class="code-meta">' + meta + '</div>';
      if (left <= 0) { stopCodeTimer(); return; } // code is dead; only resend / change remain
      codeTimer = setTimeout(tick, 1000);
    })();
  }
  // Validate the email, request a code, then flip to the code row + countdown.
  async function sendCode(email) {
    var r = await authRequest(email);
    if (r && r.ok) {
      localStorage.setItem('driftly.codeExp', String(Date.now() + CODE_TTL));
      localStorage.setItem('driftly.codeEmail', email);
      runCodeTimer();
      if (r.devCode && $('sub-code')) $('sub-code').value = r.devCode;
      if ($('sub-code')) $('sub-code').focus();
      return true;
    }
    notify(t('codeBad'), 'warn');
    return false;
  }
  // Resume the code row after a tab reload while the code is still valid.
  (function () { var em = localStorage.getItem('driftly.codeEmail'); if (!state.token && em && !codeExpired()) { if ($('sub-email')) $('sub-email').value = em; runCodeTimer(); } else if (em) { clearCode(); } })();
  window.addEventListener('driftly-lang-changed', function () { if (localStorage.getItem('driftly.codeEmail') && !codeExpired()) runCodeTimer(); });

  if ($('btn-getcode')) $('btn-getcode').addEventListener('click', function () {
    var email = ($('sub-email').value || '').trim();
    if (!email) { notify(t('emailEmpty'), 'warn'); $('sub-email').focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { notify(t('emailBad'), 'warn'); $('sub-email').focus(); return; }
    sendCode(email);
  });
  // "Resend" / "Change email" links live inside the countdown note.
  if ($('sub-auth-note')) $('sub-auth-note').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
    if (b.getAttribute('data-act') === 'resend') {
      var em = localStorage.getItem('driftly.codeEmail') || ($('sub-email') && $('sub-email').value) || '';
      if (em) sendCode(em);
    } else {
      var prev = localStorage.getItem('driftly.codeEmail') || '';
      clearCode();
      if (prev && $('sub-email')) $('sub-email').value = prev;
      if ($('sub-email')) $('sub-email').focus();
    }
  });
  if ($('btn-verify')) $('btn-verify').addEventListener('click', async function () {
    // The code dies with the 5-min timer — refuse an expired one before hitting the server.
    if (codeExpired()) { runCodeTimer(); return; }
    var email = (localStorage.getItem('driftly.codeEmail') || ($('sub-email') && $('sub-email').value) || '').trim();
    var r = await authVerify(email, ($('sub-code').value || '').trim());
    if (r && r.ok) { clearCode(); }
    else notify(t('codeBad'), 'warn');
  });
  if ($('btn-signout')) $('btn-signout').addEventListener('click', function () {
    // Best-effort: free this device's seat on the server, then clear locally.
    if (state.api && state.token) { try { fetch(state.api + '/v1/auth/signout', { method: 'POST', headers: { Authorization: 'Bearer ' + state.token } }); } catch (e) {} }
    state.token = null; state.license = null; state.serverEnt = null; persist(); emit();
  });
  if ($('pw-cta')) $('pw-cta').addEventListener('click', function () { dismissed = true; render(); showView('subscription'); });
  if ($('pw-retry')) $('pw-retry').addEventListener('click', function () { call('POST', '/v1/billing/retry'); });
  window.addEventListener('driftly-lang-changed', render);

  refresh();
  setInterval(refresh, 60000);
  // After the card form, confirm the binding server-side (GetState/GetCardList) so the trial
  // activates automatically — no manual refresh. Polls persistently to cover webhook latency,
  // shows an "activating…" state, and cleans the ?paid flag from the URL.
  function confirmCardBinding() {
    if (!state.token) return;
    activating = true; render();
    var tries = 0;
    var run = function () {
      call('POST', '/v1/billing/confirm-card').then(function () {
        var e = entitlement();
        if (e.reason === 'trial' || e.reason === 'active') { activating = false; render(); return; }
        if (++tries < 30) setTimeout(run, 3000); else { activating = false; if (window.DriftlyToast) window.DriftlyToast(t('bindFailed'), 'warn'); render(); }
      });
    };
    run();
  }
  if (/[?&]paid=1\b/.test(location.search)) {
    try { history.replaceState({}, '', location.pathname); } catch (e) {}
    confirmCardBinding();
  } else if (/[?&]paid=0\b/.test(location.search)) {
    try { history.replaceState({}, '', location.pathname); } catch (e) {}
    if (window.DriftlyToast) window.DriftlyToast(t('bindFailed'), 'warn');
  } else {
    window.addEventListener('driftly-access-changed', function once() {
      if (state.account && state.account.status === 'pending') { window.removeEventListener('driftly-access-changed', once); confirmCardBinding(); }
    });
  }
}());
