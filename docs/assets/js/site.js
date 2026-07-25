/* ============ Driftly — site.js ============ */
(function () {
  'use strict';
  var doc = document;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- dynamic year ---------- */
  var yr = doc.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- language toggle ---------- */
  var LANG_KEY = 'driftly.lang';
  function applyLang(lang) {
    if (lang !== 'en') lang = 'ru';
    doc.documentElement.setAttribute('lang', lang);
    doc.documentElement.setAttribute('data-lang', lang);
    var nodes = doc.querySelectorAll('[data-ru][data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].getAttribute('data-' + lang);
      if (t !== null) nodes[i].textContent = t;
    }
    var btns = doc.querySelectorAll('[data-lang-btn]');
    for (var j = 0; j < btns.length; j++) {
      var active = btns[j].getAttribute('data-lang-btn') === lang;
      btns[j].classList.toggle('active', active);
      btns[j].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    try { localStorage.setItem(LANG_KEY, lang); localStorage.setItem('driftly-lang', lang); } catch (e) {}
  }
  var stored = 'ru';
  try { stored = localStorage.getItem(LANG_KEY) || localStorage.getItem('driftly-lang') || 'ru'; } catch (e) {}
  applyLang(stored);
  doc.querySelectorAll('[data-lang-btn]').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.getAttribute('data-lang-btn')); });
  });
  function curLang() { return doc.documentElement.getAttribute('data-lang') || 'ru'; }

  /* ---------- desktop download availability ----------
     The .exe/.dmg/.AppImage live in GitHub Releases. Until a release is
     published, /releases/latest is an empty 404 page — so check the API first:
       • no release  → buttons say "Скоро — сборка готовится" and don't navigate
                       (the web-version CTA below stays the working path);
       • release out → each button auto-wires to its real installer asset.
     Transient API errors leave the original /releases/latest href intact. */
  (function () {
    var REPO = 'adriaaante/shadow-user';
    // Strictly the three OS buttons in the download section.
    var dlBtns = [].slice.call(doc.querySelectorAll('#download .dl-card .btn-primary'));
    if (!dlBtns.length) return;
    function osOf(btn) {
      var t = (btn.getAttribute('data-en') || '').toLowerCase();
      if (t.indexOf('windows') >= 0) return 'win';
      if (t.indexOf('macos') >= 0) return 'mac';
      if (t.indexOf('linux') >= 0) return 'linux';
      return null;
    }
    function assetFor(assets, os) {
      if (!os) return null;
      var rx = os === 'win' ? /\.exe$/i : os === 'mac' ? /\.dmg$/i : /(\.AppImage|\.deb|\.zip)$/i;
      for (var i = 0; i < assets.length; i++) { if (rx.test(assets[i].name || '')) return assets[i].browser_download_url; }
      return null;
    }
    function setPending() {
      dlBtns.forEach(function (b) {
        b.setAttribute('data-ru', 'Скоро — сборка готовится');
        b.setAttribute('data-en', 'Coming soon — build in progress');
        b.setAttribute('aria-disabled', 'true');
        b.classList.add('is-pending');
        b.removeAttribute('href');
        b.addEventListener('click', function (e) {
          e.preventDefault();
          var web = doc.querySelector('.dl-soft-cta .btn');
          if (web) { web.scrollIntoView({ behavior: 'smooth', block: 'center' }); web.focus({ preventScroll: true }); }
        });
      });
      applyLang(curLang());
    }
    function wire(rel) {
      var assets = (rel && rel.assets) || [];
      dlBtns.forEach(function (b) {
        var url = assetFor(assets, osOf(b));
        if (url) { b.setAttribute('href', url); b.setAttribute('download', ''); }
        // else: keep the existing /releases/latest href (release page works)
      });
    }
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (r.status === 404) { setPending(); return null; }   // no release yet
        if (!r.ok) return null;                                 // transient → leave defaults
        return r.json();
      })
      .then(function (rel) { if (rel) wire(rel); })
      .catch(function () { /* offline/blocked → leave defaults */ });
  }());

  /* ---------- mobile nav ---------- */
  var burger = doc.getElementById('hamburger');
  var links = doc.getElementById('navLinks');
  var scrim = doc.getElementById('navScrim');
  function setMenu(open) {
    if (!links) return;
    links.classList.toggle('open', open);
    if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (scrim) scrim.hidden = !open;
    doc.body.style.overflow = open ? 'hidden' : '';
  }
  if (burger) burger.addEventListener('click', function () {
    setMenu(!links.classList.contains('open'));
  });
  if (scrim) scrim.addEventListener('click', function () { setMenu(false); });
  if (links) links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setMenu(false); });
  });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  /* ---------- reveal on scroll ---------- */
  var reveals = doc.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  }

})();
