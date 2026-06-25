/* chart.js — tiny dependency-free canvas charts for Driftly. */
(function () {
  function setup(canvas, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
    const h = cssH || canvas.clientHeight || 160;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h };
  }

  function gauge(canvas, value) {
    const { ctx, w, h } = setup(canvas, 200);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 14;
    const start = Math.PI * 0.75, end = Math.PI * 2.25;
    const v = Math.max(0, Math.min(100, value)) / 100;
    ctx.clearRect(0, 0, w, h);
    // track
    ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.stroke();
    // value
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#7c5cff'); g.addColorStop(1, '#2dd4bf');
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + (end - start) * v); ctx.stroke();
    // center text
    ctx.fillStyle = '#f2f2f8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 40px "Space Grotesk", sans-serif';
    ctx.fillText(Math.round(value), cx, cy - 4);
    ctx.fillStyle = 'rgba(242,242,248,.5)'; ctx.font = '500 12px Inter, sans-serif';
    ctx.fillText('активность', cx, cy + 26);
  }

  function area(canvas, series, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas, opts.height || 170);
    const pad = { l: 6, r: 6, t: 10, b: 16 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    ctx.clearRect(0, 0, w, h);
    if (!series || !series.length) return;
    const n = series.length;
    const max = Math.max(20, ...series.map((d) => Math.max(d.synthetic || 0, d.real || 0, d.total || 0)));
    const X = (i) => pad.l + (iw * i) / (n - 1 || 1);
    const Y = (val) => pad.t + ih - (ih * val) / max;

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    for (let k = 0; k <= 3; k += 1) {
      const y = pad.t + (ih * k) / 3;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }
    // shadow-window shading (where the generator was on)
    series.forEach((d, i) => {
      if (d.genEnabled) {
        ctx.fillStyle = 'rgba(124,92,255,.07)';
        const x0 = X(Math.max(0, i - 0.5)), x1 = X(Math.min(n - 1, i + 0.5));
        ctx.fillRect(x0, pad.t, x1 - x0, ih);
      }
    });

    function drawLine(key, color, fill) {
      ctx.beginPath();
      series.forEach((d, i) => { const x = X(i), y = Y(d[key] || 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (fill) {
        ctx.lineTo(X(n - 1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
        const grd = ctx.createLinearGradient(0, pad.t, 0, h);
        grd.addColorStop(0, fill); grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd; ctx.fill();
      } else {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      }
    }
    drawLine('synthetic', '#7c5cff', 'rgba(124,92,255,.22)');
    drawLine('synthetic', '#9d86ff');
    drawLine('real', '#2dd4bf', 'rgba(45,212,191,.18)');
    drawLine('real', '#2dd4bf');
  }

  window.Charts = { gauge, area };
}());
