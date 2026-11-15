/* OMIE price chart — dependency-free SVG renderer.
 * Contract: docs/static-site.md, "Chart/template contract (T4 ↔ T5)".
 * Expects <div id="omie-chart" data-report="...">; range tabs are the
 * [data-range] buttons in the enclosing <section>. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var COLOR = {
    primary: '#0f62fe', // OMIE line + area (€/MWh, left axis)
    pvpc: '#161616',    // PVPC approximation line (€/kWh, right axis) — on-surface
    tertiary: '#198038',// fixed benchmark dashed line / "min" annotations
    error: '#da1e28',   // "max" annotations
    outline: '#e0e0e0', // grid + frame
    muted: '#525252'    // tick labels (on-surface-variant)
  };
  var MONO = '"IBM Plex Mono", monospace';

  // PVPC approximation — same constants as internal/stats.
  function pvpcKwh(mwh) { return (mwh / 1000) * 1.051 * 1.10 + 0.031; }

  // Fixed viewBox; the SVG scales to its container via width:100%.
  var W = 1000, H = 420;
  var M = { top: 28, right: 78, bottom: 42, left: 66 };
  var PW = W - M.left - M.right;
  var PH = H - M.top - M.bottom;

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('omie-chart');
    if (!container) return;
    container.style.position = 'relative';

    var reportUrl = (container.getAttribute('data-report') || '').trim();
    var jobs = [
      fetchJSON('../data/omie.json'),
      fetchJSON('../data/metrics.json').catch(function () { return null; })
    ];
    if (reportUrl) {
      // Annotations are optional — a failed report fetch must not break the chart.
      jobs.push(fetchJSON(reportUrl).catch(function () { return null; }));
    }
    Promise.all(jobs).then(function (res) {
      var omie = res[0];
      if (!omie || !Array.isArray(omie.days) || !omie.days.length) {
        placeholder(container);
        return;
      }
      var fb = res[1] && res[1].fixed_benchmark;
      var state = {
        days: omie.days,
        range: 90,
        benchmark: fb && typeof fb.kwh === 'number' ? fb.kwh : null,
        annotations: (res[2] && Array.isArray(res[2].annotations)) ? res[2].annotations : []
      };
      wireTabs(container, state);
      render(state, container);
    }).catch(function () { placeholder(container); });
  });

  function fetchJSON(rel) {
    return fetch(new URL(rel, document.baseURI).href).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function placeholder(container) {
    container.innerHTML = '';
    var d = document.createElement('div');
    d.textContent = '\u2014';
    d.style.cssText = 'display:flex;align-items:center;justify-content:center;' +
      'height:320px;font-size:24px;color:' + COLOR.muted + ';';
    container.appendChild(d);
  }

  function wireTabs(container, state) {
    var scope = container.closest('section') || document;
    var tabs = Array.prototype.slice.call(scope.querySelectorAll('[data-range]'));
    if (!tabs.length) return;
    // Class sets mirror the tab markup in layouts/partials/index/chart.html.
    var ACTIVE = 'px-3 py-1.5 text-[12px] font-semibold bg-white text-primary border border-[#e0e0e0] shadow-sm';
    var INACTIVE = 'px-3 py-1.5 text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors';
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(btn.getAttribute('data-range'), 10);
        if (!n || n < 1) return;
        state.range = n;
        tabs.forEach(function (t) { t.className = (t === btn) ? ACTIVE : INACTIVE; });
        render(state, container);
      });
    });
  }

  function render(state, container) {
    // Client-side slice: last N days; source gaps simply disappear.
    var days = state.days.slice(-state.range);
    var pts = [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (!d || typeof d.avg_mwh !== 'number' || !isFinite(d.avg_mwh)) continue;
      pts.push({
        date: d.date,
        avg: d.avg_mwh,
        min: typeof d.min_mwh === 'number' ? d.min_mwh : null,
        max: typeof d.max_mwh === 'number' ? d.max_mwh : null
      });
    }
    if (!pts.length) { placeholder(container); return; }

    var lang = (document.documentElement && document.documentElement.lang) || 'es';
    var fmtTick = new Intl.DateTimeFormat(lang, { day: '2-digit', month: 'short', timeZone: 'UTC' });
    var fmtFull = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    function fmtNum(v, dp) {
      return new Intl.NumberFormat(lang, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
    }

    // Left scale (€/MWh) from OMIE averages; right scale (€/kWh) from PVPC.
    var lMin = Infinity, lMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    pts.forEach(function (p) {
      lMin = Math.min(lMin, p.avg); lMax = Math.max(lMax, p.avg);
      var k = pvpcKwh(p.avg);
      rMin = Math.min(rMin, k); rMax = Math.max(rMax, k);
    });
    if (state.benchmark != null) { rMin = Math.min(rMin, state.benchmark); rMax = Math.max(rMax, state.benchmark); }
    // Annotation dots sit at that day's hourly min/max, not the daily average;
    // include them in the left domain or they land outside the plot area.
    (state.annotations || []).forEach(function (a) {
      if (!a || !a.date) return;
      var p = null;
      for (var i = 0; i < pts.length; i++) if (pts[i].date === a.date) { p = pts[i]; break; }
      if (!p) return;
      var v = a.kind === 'min' ? p.min : p.max;
      if (v == null) v = p.avg;
      lMin = Math.min(lMin, v); lMax = Math.max(lMax, v);
    });
    var lp = padDomain(lMin, lMax), rp = padDomain(rMin, rMax);
    lMin = lp.lo; lMax = lp.hi; rMin = rp.lo; rMax = rp.hi;

    var n = pts.length;
    function xAt(i) { return M.left + (n === 1 ? PW / 2 : i * (PW / (n - 1))); }
    function yL(v) { return M.top + PH - ((v - lMin) / (lMax - lMin)) * PH; }
    function yR(v) { return M.top + PH - ((v - rMin) / (rMax - rMin)) * PH; }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      role: 'img',
      'aria-label': 'OMIE daily average price and PVPC approximation'
    });
    svg.setAttribute('style', 'width:100%;height:auto;display:block;');

    // Area fill gradient for the OMIE series.
    var defs = el('defs', {});
    var grad = el('linearGradient', { id: 'omieAreaGrad', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': COLOR.primary, 'stop-opacity': '0.22' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': COLOR.primary, 'stop-opacity': '0.02' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Grid + tick labels on both y-axes (mono font).
    niceTicks(lMin, lMax, 5).forEach(function (t) {
      var y = yL(t);
      svg.appendChild(el('line', { x1: M.left, x2: M.left + PW, y1: y, y2: y, stroke: COLOR.outline, 'stroke-width': 1 }));
      svg.appendChild(text(M.left - 8, y + 3.5, fmtNum(t, t >= 100 ? 0 : 1), {
        'text-anchor': 'end', fill: COLOR.muted, 'font-size': 10, 'font-family': MONO
      }));
    });
    niceTicks(rMin, rMax, 5).forEach(function (t) {
      var y = yR(t);
      svg.appendChild(text(M.left + PW + 8, y + 3.5, fmtNum(t, 3), {
        'text-anchor': 'start', fill: COLOR.muted, 'font-size': 10, 'font-family': MONO
      }));
    });
    // Plot floor.
    svg.appendChild(el('line', { x1: M.left, x2: M.left + PW, y1: M.top + PH, y2: M.top + PH, stroke: '#8d8d8d', 'stroke-width': 1 }));

    // X-axis date ticks (~7).
    var tickCount = Math.min(7, n);
    var seen = {};
    for (var k = 0; k < tickCount; k++) {
      var idx = Math.round(k * (n - 1) / Math.max(1, tickCount - 1));
      if (seen[idx]) continue;
      seen[idx] = true;
      svg.appendChild(text(xAt(idx), H - M.bottom + 20, fmtTick.format(parseDate(pts[idx].date)), {
        'text-anchor': 'middle', fill: COLOR.muted, 'font-size': 11, 'font-family': MONO
      }));
    }

    // OMIE area + line (left axis, primary).
    var omieD = pts.map(function (p, i) { return (i ? 'L' : 'M') + xAt(i).toFixed(2) + ',' + yL(p.avg).toFixed(2); }).join(' ');
    svg.appendChild(el('path', {
      d: omieD + ' L' + xAt(n - 1).toFixed(2) + ',' + (M.top + PH) + ' L' + xAt(0).toFixed(2) + ',' + (M.top + PH) + ' Z',
      fill: 'url(#omieAreaGrad)', stroke: 'none'
    }));
    svg.appendChild(el('path', { d: omieD, fill: 'none', stroke: COLOR.primary, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'data-series': 'omie' }));

    // PVPC approximation line (right axis, thinner).
    var pvpcD = pts.map(function (p, i) { return (i ? 'L' : 'M') + xAt(i).toFixed(2) + ',' + yR(pvpcKwh(p.avg)).toFixed(2); }).join(' ');
    svg.appendChild(el('path', { d: pvpcD, fill: 'none', stroke: COLOR.pvpc, 'stroke-width': 1.5, 'data-series': 'pvpc' }));

    // Fixed benchmark dashed line (€/kWh → right axis), only when present.
    if (state.benchmark != null) {
      var by = yR(state.benchmark);
      svg.appendChild(el('line', { x1: M.left, x2: M.left + PW, y1: by, y2: by, stroke: COLOR.tertiary, 'stroke-width': 1.5, 'stroke-dasharray': '6,4' }));
      svg.appendChild(text(M.left + PW - 4, by - 6, fmtNum(state.benchmark, 3) + ' \u20ac/kWh', {
        'text-anchor': 'end', fill: COLOR.tertiary, 'font-size': 10, 'font-family': MONO, 'font-weight': 600
      }));
    }

    // Event annotations from the report (marker at that day's min or max).
    var annByDate = {};
    state.annotations.forEach(function (a) {
      if (!a || !a.date) return;
      var p = pts.filter(function (q) { return q.date === a.date; })[0];
      if (!p) return;
      var v = a.kind === 'min' ? p.min : p.max;
      if (v == null) v = p.avg; // fall back so a marker still shows
      annByDate[a.date] = a;
      svg.appendChild(el('circle', { cx: xAt(pts.indexOf(p)), cy: yL(v), r: 4.5, fill: a.kind === 'min' ? COLOR.tertiary : COLOR.error, stroke: '#ffffff', 'stroke-width': 1.5 }));
    });

    // Crosshair (updated on mousemove).
    var crossLine = el('line', { y1: M.top, y2: M.top + PH, stroke: COLOR.primary, 'stroke-width': 1, 'stroke-dasharray': '2,2', visibility: 'hidden' });
    var dotL = el('circle', { r: 4, fill: COLOR.primary, stroke: '#fff', 'stroke-width': 1.5, visibility: 'hidden' });
    var dotR = el('circle', { r: 3, fill: COLOR.pvpc, stroke: '#fff', 'stroke-width': 1.5, visibility: 'hidden' });
    svg.appendChild(crossLine);
    svg.appendChild(dotL);
    svg.appendChild(dotR);

    // Tooltip (HTML div so long annotation text can wrap).
    var tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:10;' +
      'background:#fff;border:1px solid #161616;padding:8px 10px;max-width:260px;' +
      "font-family:" + MONO + ';font-size:11px;line-height:1.5;color:#161616;' +
      'box-shadow:0 4px 12px rgba(0,0,0,.12);';
    var tipTitle = document.createElement('div');
    tipTitle.style.cssText = 'font-weight:600;margin-bottom:2px;';
    var tipRows = document.createElement('div');
    tip.appendChild(tipTitle);
    tip.appendChild(tipRows);

    // Transparent overlay capturing pointer events over the plot area.
    var overlay = el('rect', { x: M.left, y: M.top, width: PW, height: PH, fill: 'transparent' });
    function showAt(i) {
      var p = pts[i];
      var x = xAt(i);
      crossLine.setAttribute('x1', x); crossLine.setAttribute('x2', x);
      dotL.setAttribute('cx', x); dotL.setAttribute('cy', yL(p.avg));
      dotR.setAttribute('cx', x); dotR.setAttribute('cy', yR(pvpcKwh(p.avg)));
      [crossLine, dotL, dotR].forEach(function (e) { e.setAttribute('visibility', 'visible'); });

      tipTitle.textContent = fmtFull.format(parseDate(p.date));
      tipRows.textContent = '';
      tipRows.appendChild(tipRow('OMIE pool: ' + fmtNum(p.avg, 2) + ' \u20ac/MWh', COLOR.primary));
      tipRows.appendChild(tipRow('PVPC 2.0TD: ' + fmtNum(pvpcKwh(p.avg), 3) + ' \u20ac/kWh', '#161616'));
      var a = annByDate[p.date];
      if (a && a.text) tipRows.appendChild(tipRow((a.time ? a.time + ' \u00b7 ' : '') + a.text, a.kind === 'min' ? COLOR.tertiary : COLOR.error));

      tip.style.display = 'block';
      var cr = container.getBoundingClientRect();
      var left = evClientX - cr.left + 14;
      if (left > cr.width - 270) left = evClientX - cr.left - 270;
      var top = Math.max(4, evClientY - cr.top - 60);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function hide() {
      [crossLine, dotL, dotR].forEach(function (e) { e.setAttribute('visibility', 'hidden'); });
      tip.style.display = 'none';
    }
    var evClientX = 0, evClientY = 0;
    overlay.addEventListener('mousemove', function (ev) {
      evClientX = ev.clientX; evClientY = ev.clientY;
      var sr = svg.getBoundingClientRect();
      var x = (evClientX - sr.left) * (W / sr.width);
      var i = n === 1 ? 0 : Math.round((x - M.left) / (PW / (n - 1)));
      showAt(Math.max(0, Math.min(n - 1, i)));
    });
    overlay.addEventListener('mouseleave', hide);
    svg.appendChild(overlay);

    container.innerHTML = '';
    container.appendChild(svg);
    container.appendChild(tip);
  }

  function tipRow(textStr, color) {
    var d = document.createElement('div');
    d.textContent = textStr;
    d.style.color = color;
    return d;
  }

  function parseDate(s) {
    // "YYYY-MM-DD" → UTC midnight (avoids local-TZ day shifts).
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(0);
  }

  function padDomain(lo, hi) {
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    var p = (hi - lo) * 0.12;
    return { lo: lo - p, hi: hi + p };
  }

  // "Nice" tick values covering [lo, hi], ~count of them.
  function niceTicks(lo, hi, count) {
    var span = hi - lo;
    if (!(span > 0)) return [lo];
    var raw = span / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var step = mag;
    [1, 2, 2.5, 5, 10].forEach(function (c) { if (raw <= c * mag) step = c * mag; });
    var out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      out.push(Math.round(v * 1000) / 1000);
    }
    return out;
  }

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function text(x, y, str, attrs) {
    var t = el('text', attrs || {});
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.appendChild(document.createTextNode(str));
    return t;
  }
})();
