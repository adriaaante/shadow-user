/* ============ Driftly — site.js ============ */
(function () {
  'use strict';
  var doc = document;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- dynamic year ---------- */
  var yr = doc.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- language toggle ---------- */
  var LANG_KEY = 'driftly-lang';
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
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  }
  var stored = 'ru';
  try { stored = localStorage.getItem(LANG_KEY) || 'ru'; } catch (e) {}
  applyLang(stored);
  doc.querySelectorAll('[data-lang-btn]').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.getAttribute('data-lang-btn')); });
  });

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

  /* ---------- animated hero demo (canvas + rAF) ---------- */
  var canvas = doc.getElementById('demoCanvas');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;

    // layout regions
    var gaugeCx = W * 0.80, gaugeCy = H * 0.30, gaugeR = 50;
    var chartX = W * 0.60, chartY = H * 0.58, chartW = W * 0.33, chartH = H * 0.30;

    // cursor drift state
    var targets = [
      {x: W * 0.18, y: H * 0.30}, {x: W * 0.42, y: H * 0.62},
      {x: W * 0.30, y: H * 0.78}, {x: W * 0.50, y: H * 0.34},
      {x: W * 0.22, y: H * 0.55}
    ];
    var ti = 0, cur = {x: targets[0].x, y: targets[0].y};
    var from = {x: cur.x, y: cur.y}, to = targets[1];
    var legX = 0, legDur = 80, clickT = 0;
    var trail = [];

    var gauge = 0.4, gTarget = 0.6;
    var bars = [0.5, 0.7, 0.45, 0.8, 0.55, 0.65, 0.6];
    var barTick = 0;

    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    function drawStatic() {
      paintFrame(0.62, [0.6, 0.78, 0.5, 0.86, 0.62, 0.72, 0.66], cur, false);
    }

    function paintFrame(gVal, barVals, cpos, showClick) {
      ctx.clearRect(0, 0, W, H);
      // bg
      ctx.fillStyle = '#0a0a11'; ctx.fillRect(0, 0, W, H);

      // soft glow
      var rg = ctx.createRadialGradient(gaugeCx, gaugeCy, 4, gaugeCx, gaugeCy, 130);
      rg.addColorStop(0, 'rgba(124,92,255,0.10)'); rg.addColorStop(1, 'rgba(124,92,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

      // ---- left panel label ----
      ctx.fillStyle = 'rgba(242,242,248,.55)';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Activity gauge', 24, 30);

      // ---- gauge ----
      ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.beginPath();
      ctx.arc(gaugeCx, gaugeCy, gaugeR, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();
      var a0 = Math.PI * 0.75, a1 = a0 + (Math.PI * 1.5) * gVal;
      var grad = ctx.createLinearGradient(gaugeCx - gaugeR, gaugeCy, gaugeCx + gaugeR, gaugeCy);
      grad.addColorStop(0, '#7c5cff'); grad.addColorStop(1, '#2dd4bf');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.arc(gaugeCx, gaugeCy, gaugeR, a0, a1);
      ctx.stroke();
      ctx.fillStyle = '#f2f2f8';
      ctx.font = '700 22px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(gVal * 100), gaugeCx, gaugeCy + 6);
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(242,242,248,.45)';
      ctx.fillText('активность', gaugeCx, gaugeCy + 22);
      ctx.textAlign = 'left';

      // ---- mini bar chart (Shadow vs Passive) ----
      ctx.fillStyle = 'rgba(242,242,248,.55)';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Shadow vs Passive', chartX, chartY - 14);
      var n = barVals.length, bw = (chartW / n) * 0.55, gap = (chartW / n);
      for (var i = 0; i < n; i++) {
        var bx = chartX + i * gap;
        // passive (dim)
        var ph = barVals[i] * chartH * 0.42;
        ctx.fillStyle = 'rgba(242,242,248,.20)';
        roundRect(bx + bw * 0.55, chartY + chartH - ph, bw * 0.5, ph, 2);
        // shadow (brand)
        var sh = barVals[i] * chartH;
        var bg = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
        bg.addColorStop(0, '#9d86ff'); bg.addColorStop(1, '#2dd4bf');
        ctx.fillStyle = bg;
        roundRect(bx, chartY + chartH - sh, bw, sh, 3);
      }

      // ---- cursor trail ----
      for (var t = 0; t < trail.length; t++) {
        var p = trail[t], alpha = (t / trail.length) * 0.5;
        ctx.fillStyle = 'rgba(124,92,255,' + alpha + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + (t / trail.length) * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- click ripple ----
      if (showClick && clickT > 0) {
        var prog = 1 - clickT / 26;
        ctx.strokeStyle = 'rgba(45,212,191,' + (1 - prog) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cpos.x, cpos.y, 4 + prog * 22, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ---- cursor arrow ----
      drawCursor(cpos.x, cpos.y);
    }

    function roundRect(x, y, w, h, r) {
      if (h <= 0) return;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.fill();
    }

    function drawCursor(x, y) {
      ctx.save();
      ctx.translate(x, y);
      // shadow
      ctx.fillStyle = 'rgba(124,92,255,.30)';
      cursorPath(2.5, 2.5);
      // body
      var g = ctx.createLinearGradient(0, 0, 18, 22);
      g.addColorStop(0, '#9d86ff'); g.addColorStop(1, '#2dd4bf');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#f2f2f8'; ctx.lineWidth = 1.1;
      cursorPath(0, 0, true);
      ctx.restore();
    }
    function cursorPath(ox, oy, stroke) {
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + 0, oy + 18);
      ctx.lineTo(ox + 4.5, oy + 12.5);
      ctx.lineTo(ox + 11, oy + 11);
      ctx.closePath();
      ctx.fill();
      if (stroke) ctx.stroke();
    }

    if (reduceMotion) {
      drawStatic();
    } else {
      var raf = function () {
        legX++;
        var tt = ease(Math.min(legX / legDur, 1));
        cur.x = from.x + (to.x - from.x) * tt;
        cur.y = from.y + (to.y - from.y) * tt;
        // micro jitter
        cur.x += Math.sin(legX * 0.6) * 0.4;
        cur.y += Math.cos(legX * 0.5) * 0.4;

        trail.push({x: cur.x, y: cur.y});
        if (trail.length > 14) trail.shift();

        if (legX >= legDur) {
          // arrived -> click, pick next target
          clickT = 26;
          legX = 0;
          ti = (ti + 1) % targets.length;
          from = {x: cur.x, y: cur.y};
          to = targets[ti];
          gTarget = 0.45 + Math.random() * 0.5;
        }
        if (clickT > 0) clickT--;

        // gauge eases toward target, plus subtle drift
        gauge += (gTarget - gauge) * 0.04;
        var gShown = Math.max(0.05, Math.min(1, gauge + Math.sin(legX * 0.08) * 0.03));

        // bars update periodically
        barTick++;
        if (barTick % 40 === 0) {
          bars.push(0.4 + Math.random() * 0.55);
          bars.shift();
        }

        paintFrame(gShown, bars, cur, true);
        rafId = window.requestAnimationFrame(raf);
      };
      var rafId = window.requestAnimationFrame(raf);

      // pause when offscreen to save CPU
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            if (e.isIntersecting && !rafId) { rafId = window.requestAnimationFrame(raf); }
            else if (!e.isIntersecting && rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
          });
        }, { threshold: 0 }).observe(canvas);
      }
    }
  }
})();
