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

  // Configure your deployed licensing server here (or via ?api= / localStorage).
  var DEFAULT_API = '';

  var state = {
    api: localStorage.getItem('driftly.api') || DEFAULT_API,
    token: localStorage.getItem('driftly.acctToken') || null,
    license: localStorage.getItem('driftly.license') || null,
    serverEnt: null, online: false,
  };
  var qApi = new URLSearchParams(location.search).get('api');
  if (qApi !== null) { state.api = qApi; localStorage.setItem('driftly.api', qApi); }
  var dismissed = false; // paywall temporarily dismissed so the sign-in/pay panel stays reachable
  var PRICE = (Ent && Ent.PLAN) || { priceMonthly: 149, priceYearly: 1500, yearlyDiscountPct: 16 };
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
      state.serverEnt = j.entitlement || null; state.online = true; persist();
    } catch (e) { state.online = false; }
    emit();
  }
  async function call(method, p, body) {
    var r = await fetch(state.api + p, { method: method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    var j = await r.json();
    if (j.license) state.license = j.license;
    if (j.entitlement) state.serverEnt = j.entitlement;
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
    ru: { preview: 'Демо-режим: сервер лицензий не подключён — доступ открыт.', signin: 'Войдите, чтобы управлять подпиской.', trial: 'Подключить карту — 3 дня бесплатно', trialActive: 'Пробный период', daysLeft: 'дн. осталось', active: 'Подписка активна', renews: 'Продление', inactive: 'Подписка неактивна', pastDue: 'Необходимо оплатить', pastDueDesc: 'Списание не прошло. Оплатите, чтобы продолжить.', retry: 'Повторить оплату', cancel: 'Отменить подписку', pwText: 'Подключите карту и получите 3 дня бесплатно. Driftly работает и в вебе, и в десктопе.', goSub: 'Открыть подписку', testCard: 'тестовая карта (демо):', ok: 'успешно', fail: 'нет средств', online: 'на связи', offline: 'нет связи', sendCode: 'Код отправлен на почту', codeBad: 'Неверный код', resume: 'Возобновить', accessUntil: 'доступ до', trialCanceled: 'Пробный период отменён', subCanceled: 'Подписка отменена', noRenew: 'продление не произойдёт', monthly: 'Помесячно', yearly: 'За год', perMonth: '₽/мес', perYear: '₽/год', planYearWord: 'годовая', planMonthWord: 'месячная' },
    en: { preview: 'Demo mode: no licensing server — access is open.', signin: 'Sign in to manage your subscription.', trial: 'Add a card — 3 days free', trialActive: 'Free trial', daysLeft: 'days left', active: 'Subscription active', renews: 'Renews', inactive: 'Subscription inactive', pastDue: 'Payment required', pastDueDesc: 'The charge failed. Pay to continue.', retry: 'Retry payment', cancel: 'Cancel subscription', pwText: 'Add a card and get 3 days free. Driftly works on web and desktop.', goSub: 'Open subscription', testCard: 'test card (demo):', ok: 'success', fail: 'no funds', online: 'online', offline: 'offline', sendCode: 'Code sent to your email', codeBad: 'Invalid code', resume: 'Resume', accessUntil: 'access until', trialCanceled: 'Trial cancelled', subCanceled: 'Subscription cancelled', noRenew: 'will not renew', monthly: 'Monthly', yearly: 'Yearly', perMonth: '₽/mo', perYear: '₽/yr', planYearWord: 'yearly', planMonthWord: 'monthly' },
  };
  function lang() { return localStorage.getItem('driftly.lang') || 'ru'; }
  function t(k) { return L[lang()][k]; }
  function fmt(ms) { try { return new Date(ms).toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-US'); } catch (e) { return ''; } }

  // lightweight view switch (the web app is a single page; we toggle a panel)
  function showView(v) { if (v === 'subscription') { var el = $('sub-panel'); if (el) el.scrollIntoView({ behavior: 'smooth' }); } }

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
    // account panel
    if ($('sub-api')) $('sub-api').value = state.api || '';
    if ($('sub-api-state')) $('sub-api-state').textContent = preview() ? t('preview') : (state.api + ' · ' + (state.online ? t('online') : t('offline')));
    if ($('sub-signin')) $('sub-signin').style.display = (!preview() && !state.token) ? 'block' : 'none';
    if ($('sub-signedin')) $('sub-signedin').style.display = (state.token && !preview()) ? 'block' : 'none';
    if ($('sub-who')) $('sub-who').textContent = e.account || '';
    var box = $('sub-state'); if (!box) return;
    if (preview()) { box.innerHTML = sb('trial', '✨', t('preview'), ''); return; }
    if (!state.token) { box.innerHTML = sb('', '👤', t('signin'), ''); return; }
    if (e.reason === 'trial') box.innerHTML = e.canceled
      ? sb('trial', '✨', t('trialCanceled'), t('accessUntil') + ' ' + fmt(e.renewsAt)) + rbtn()
      : sb('trial', '✨', t('trialActive'), e.trialDaysLeft + ' ' + t('daysLeft')) + cbtn();
    else if (e.reason === 'active') box.innerHTML = e.canceled
      ? sb('ok', '✓', t('subCanceled'), t('accessUntil') + ' ' + fmt(e.renewsAt) + ' · ' + t('noRenew')) + rbtn()
      : sb('ok', '✓', t('active') + ' · ' + (e.interval === 'year' ? t('planYearWord') : t('planMonthWord')), t('renews') + ': ' + fmt(e.renewsAt)) + cbtn();
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
  function tbtn() { return ptoggle() + '<button class="btn primary btn-lg" data-acc="trial">' + t('trial') + '</button><div class="devcard">' + t('testCard') + '<select id="dev-card"><option value="tok_ok">' + t('ok') + '</option><option value="tok_insufficient">' + t('fail') + '</option></select></div>'; }
  function cbtn() { return '<button class="btn ghost" data-acc="cancel" style="margin-top:12px">' + t('cancel') + '</button>'; }
  function rbtn() { return '<button class="btn primary" data-acc="resume" style="margin-top:12px">' + t('resume') + '</button>'; }

  /* -------------------------------- events --------------------------------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-acc],[data-interval]'); if (!a) return;
    if (a.dataset.interval) { selectedInterval = a.dataset.interval; render(); return; }
    var act = a.dataset.acc;
    if (act === 'trial') { var card = ($('dev-card') && $('dev-card').value) || 'tok_ok'; call('POST', '/v1/billing/start-trial', { card: card, interval: selectedInterval }); }
    else if (act === 'retry') call('POST', '/v1/billing/retry');
    else if (act === 'cancel') call('POST', '/v1/billing/cancel');
    else if (act === 'resume') call('POST', '/v1/billing/resume');
  });
  if ($('btn-getcode')) $('btn-getcode').addEventListener('click', async function () {
    var email = ($('sub-email').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    var r = await authRequest(email);
    if (r && r.ok) {
      $('sub-step-code').style.display = 'flex';
      $('sub-auth-note').textContent = t('sendCode') + (r.devCode ? ' (dev: ' + r.devCode + ')' : '');
      if (r.devCode) $('sub-code').value = r.devCode;
      $('sub-code').focus();
    }
  });
  if ($('btn-verify')) $('btn-verify').addEventListener('click', async function () {
    var email = ($('sub-email').value || '').trim();
    var r = await authVerify(email, ($('sub-code').value || '').trim());
    if (r && r.ok) { $('sub-step-code').style.display = 'none'; $('sub-auth-note').textContent = ''; }
    else if ($('sub-auth-note')) $('sub-auth-note').textContent = t('codeBad');
  });
  if ($('btn-setapi')) $('btn-setapi').addEventListener('click', function () { state.api = ($('sub-api').value || '').trim().replace(/\/$/, ''); state.serverEnt = null; persist(); refresh(); });
  if ($('btn-signout')) $('btn-signout').addEventListener('click', function () { state.token = null; state.license = null; state.serverEnt = null; persist(); emit(); });
  if ($('pw-cta')) $('pw-cta').addEventListener('click', function () { dismissed = true; render(); showView('subscription'); });
  if ($('pw-retry')) $('pw-retry').addEventListener('click', function () { call('POST', '/v1/billing/retry'); });
  window.addEventListener('driftly-lang-changed', render);

  refresh();
  setInterval(refresh, 60000);
}());
