/* Grid CO2 intensity vs. OMIE wholesale price — dependency-free SVG renderer.
 * Mirrors site/static/js/chart.js conventions.
 * Expects <div id="carbon-chart"> inside #intensidad-co2 with [data-carbon-range] tabs. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var COLOR = {
    carbonBarFill: '#24a148',
    carbonBarStroke: '#198038',
    carbonInk: '#044317',
    priceLine: '#0f62fe',
    priceInk: '#0043ce',
    grid: '#d9d9d9',
    axis: '#525252',
    axisGuide: '#8d8d8d',
    ink: '#161616',
    muted: '#525252'
  };
  var MONO = '"IBM Plex Mono", monospace';

  var W = 1000, H = 340;

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('carbon-chart');
    if (!container) return;
    container.style.position = 'relative';

    fetch(new URL('../data/carbon.json', document.baseURI).href)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.days) || !data.days.length) {
          placeholder(container);
          return;
        }
        var state = { days: data.days, range: 30 };
        wireTabs(container, state);
        render(state, container);
      })
      .catch(function () { placeholder(container); });
  });

  function placeholder(container) {
    container.innerHTML = '';
    var d = document.createElement('div');
    d.textContent = '\u2014';
    d.style.cssText = 'display:flex;align-items:center;justify-content:center;' +
      'height:260px;font-size:24px;color:' + COLOR.muted + ';';
    container.appendChild(d);
  }

  function wireTabs(container, state) {
    var scope = container.closest('section') || document;
    var tabs = Array.prototype.slice.call(scope.querySelectorAll('[data-carbon-range]'));
    if (!tabs.length) return;
    var ACTIVE = 'px-3 py-1.5 text-[12px] font-semibold bg-white text-primary border border-[#e0e0e0] shadow-sm';
    var INACTIVE = 'px-3 py-1.5 text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors';
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(btn.getAttribute('data-carbon-range'), 10);
        if (!n || n < 1) return;
        state.range = n;
        tabs.forEach(function (t) { t.className = (t === btn) ? ACTIVE : INACTIVE; });
        render(state, container);
      });
    });
  }

  function render(state, container) {
    var slice = state.days.slice(-state.range);
    var pts = [];
    var hasPrice = false;
    for (var i = 0; i < slice.length; i++) {
      var d = slice[i];
      if (!d || typeof d.avg_gco2 !== 'number' || !isFinite(d.avg_gco2)) continue;
      var hasP = typeof d.omie_kwh === 'number' && isFinite(d.omie_kwh);
      if (hasP) hasPrice = true;
      pts.push({
        date: d.date,
        avg: d.avg_gco2,
        min: typeof d.min_gco2 === 'number' ? d.min_gco2 : null,
        max: typeof d.max_gco2 === 'number' ? d.max_gco2 : null,
        price: hasP ? d.omie_kwh : null
      });
    }
    if (!pts.length) { placeholder(container); return; }

    var lang = (document.documentElement && document.documentElement.lang) || 'es';
    var locale = lang === 'es' ? 'es-ES' : 'en-GB';
    var fmtTick = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' });
    var fmtFull = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    function fmtNum(v, dp) {
      return new Intl.NumberFormat(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
    }

    var gMax = 0, pMin = Infinity, pMax = -Infinity;
    pts.forEach(function (p) {
      if (p.avg > gMax) gMax = p.avg;
      if (p.price != null) {
        if (p.price < pMin) pMin = p.price;
        if (p.price > pMax) pMax = p.price;
      }
    });
    if (gMax <= 0) gMax = 100;
    if (!isFinite(pMax)) { pMin = 0; pMax = 0.10; }
    if (pMax === 0 && pMin === 0) pMax = 0.05;

    var gScale = niceScale(0, gMax, 5, true);
    var pScale = niceScale(pMin, pMax, 5, pMin >= 0);

    var M = hasPrice
      ? { top: 28, right: 78, bottom: 44, left: 66 }
      : { top: 28, right: 24, bottom: 44, left: 66 };
    var PW = W - M.left - M.right;
    var PH = H - M.top - M.bottom;

    var n = pts.length;
    var slotW = PW / n;
    function xAt(idx) { return M.left + slotW * (idx + 0.5); }
    function yG(v) { return M.top + PH - ((v - gScale.lo) / (gScale.hi - gScale.lo)) * PH; }
    function yP(v) { return M.top + PH - ((v - pScale.lo) / (pScale.hi - pScale.lo)) * PH; }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      role: 'img',
      'aria-label': 'Grid CO2 intensity and OMIE wholesale price'
    });
    svg.setAttribute('style', 'width:100%;height:auto;display:block;overflow:visible;');

    // Axis unit headers
    svg.appendChild(text(M.left, 14, 'gCO\u2082/kWh', {
      'text-anchor': 'start', fill: COLOR.carbonInk, 'font-size': 11, 'font-weight': 600, 'font-family': MONO
    }));
    if (hasPrice) {
      svg.appendChild(text(M.left + PW, 14, '\u20ac/kWh', {
        'text-anchor': 'end', fill: COLOR.priceInk, 'font-size': 11, 'font-weight': 600, 'font-family': MONO
      }));
    }

    // Horizontal gridlines & left Y-axis ticks (gCO2/kWh)
    gScale.ticks.forEach(function (tk) {
      var y = yG(tk);
      svg.appendChild(el('line', {
        x1: M.left, x2: M.left + PW, y1: y, y2: y,
        stroke: COLOR.grid, 'stroke-width': 1, 'stroke-dasharray': '3,3'
      }));
      svg.appendChild(text(M.left - 10, y + 4, String(Math.round(tk)), {
        'text-anchor': 'end', fill: COLOR.carbonInk, 'font-size': 11, 'font-weight': 500, 'font-family': MONO
      }));
    });

    // Right Y-axis ticks (OMIE €/kWh)
    if (hasPrice) {
      pScale.ticks.forEach(function (tk) {
        var y = yP(tk);
        svg.appendChild(el('line', {
          x1: M.left + PW, x2: M.left + PW + 5, y1: y, y2: y,
          stroke: COLOR.axisGuide, 'stroke-width': 1
        }));
        svg.appendChild(text(M.left + PW + 10, y + 4, fmtNum(tk, 3) + ' \u20ac', {
          'text-anchor': 'start', fill: COLOR.priceInk, 'font-size': 11, 'font-weight': 500, 'font-family': MONO
        }));
      });
    }

    // Plot axes frame
    svg.appendChild(el('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + PH, stroke: COLOR.axisGuide, 'stroke-width': 1 }));
    svg.appendChild(el('line', { x1: M.left, x2: M.left + PW, y1: M.top + PH, y2: M.top + PH, stroke: COLOR.axis, 'stroke-width': 1.25 }));
    if (hasPrice) {
      svg.appendChild(el('line', { x1: M.left + PW, x2: M.left + PW, y1: M.top, y2: M.top + PH, stroke: COLOR.axisGuide, 'stroke-width': 1 }));
    }

    // X-axis date ticks (~7 evenly spaced, never overlapping)
    var tickCount = Math.min(7, n);
    var idxs = [];
    if (n === 1) {
      idxs.push(0);
    } else {
      for (var k = 0; k < tickCount; k++) {
        var idx = Math.round(k * (n - 1) / (tickCount - 1));
        if (idxs.indexOf(idx) === -1) idxs.push(idx);
      }
    }
    var lastX = -Infinity;
    idxs.forEach(function (idx, pos) {
      var cx = xAt(idx);
      if (pos > 0 && pos < idxs.length - 1 && (cx - lastX) < 88) return;
      lastX = cx;
      svg.appendChild(el('line', { x1: cx, x2: cx, y1: M.top + PH, y2: M.top + PH + 5, stroke: COLOR.axis, 'stroke-width': 1 }));
      var anchor = 'middle';
      if (pos === 0 && cx - M.left < 28) anchor = 'start';
      if (pos === idxs.length - 1 && (M.left + PW - cx) < 28) anchor = 'end';
      svg.appendChild(text(cx, M.top + PH + 22, fmtTick.format(parseDate(pts[idx].date)), {
        'text-anchor': anchor, fill: COLOR.ink, 'font-size': 11, 'font-weight': 500, 'font-family': MONO
      }));
    });

    // CO2 bars (left axis)
    var bw = Math.max(3, Math.min(20, slotW * 0.65));
    pts.forEach(function (p, i) {
      var topY = yG(p.avg);
      var barH = Math.max(1, (M.top + PH) - topY);
      svg.appendChild(el('rect', {
        x: (xAt(i) - bw / 2).toFixed(2),
        y: topY.toFixed(2),
        width: bw.toFixed(2),
        height: barH.toFixed(2),
        rx: '1.5',
        fill: COLOR.carbonBarFill,
        'fill-opacity': '0.32',
        stroke: COLOR.carbonBarStroke,
        'stroke-width': n > 90 ? '0.6' : '1'
      }));
    });

    // OMIE price line (right axis)
    if (hasPrice) {
      var segments = [];
      var cur = [];
      pts.forEach(function (p, i) {
        if (p.price != null) {
          cur.push({ x: xAt(i), y: yP(p.price) });
        } else if (cur.length) {
          segments.push(cur);
          cur = [];
        }
      });
      if (cur.length) segments.push(cur);

      segments.forEach(function (seg) {
        if (seg.length >= 2) {
          var dStr = seg.map(function (pt, j) {
            return (j === 0 ? 'M' : 'L') + pt.x.toFixed(2) + ',' + pt.y.toFixed(2);
          }).join(' ');
          svg.appendChild(el('path', {
            d: dStr, fill: 'none', stroke: COLOR.priceLine,
            'stroke-width': '2.25', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
          }));
        }
        if (n <= 90) {
          seg.forEach(function (pt) {
            svg.appendChild(el('circle', {
              cx: pt.x.toFixed(2), cy: pt.y.toFixed(2), r: '2.8',
              fill: COLOR.priceLine, stroke: '#ffffff', 'stroke-width': '1.25'
            }));
          });
        }
      });
    }

    // Crosshair + Tooltip
    var crossLine = el('line', {
      y1: M.top, y2: M.top + PH,
      stroke: COLOR.axis, 'stroke-width': 1, 'stroke-dasharray': '2,2', visibility: 'hidden'
    });
    var dotG = el('circle', { r: 4.5, fill: COLOR.carbonBarStroke, stroke: '#ffffff', 'stroke-width': 1.5, visibility: 'hidden' });
    var dotP = el('circle', { r: 4.5, fill: COLOR.priceLine, stroke: '#ffffff', 'stroke-width': 1.5, visibility: 'hidden' });
    svg.appendChild(crossLine);
    svg.appendChild(dotG);
    svg.appendChild(dotP);

    var tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:10;' +
      'background:#ffffff;border:1px solid #161616;border-radius:3px;padding:8px 10px;' +
      'font-family:' + MONO + ';font-size:11px;line-height:1.5;color:#161616;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.14);white-space:nowrap;';
    var tipTitle = document.createElement('div');
    tipTitle.style.cssText = 'font-weight:600;margin-bottom:2px;color:#161616;';
    var tipRows = document.createElement('div');
    tip.appendChild(tipTitle);
    tip.appendChild(tipRows);

    function showAt(i, clientX, clientY) {
      var p = pts[i];
      var x = xAt(i);
      crossLine.setAttribute('x1', x); crossLine.setAttribute('x2', x);
      crossLine.setAttribute('visibility', 'visible');
      dotG.setAttribute('cx', x); dotG.setAttribute('cy', yG(p.avg));
      dotG.setAttribute('visibility', 'visible');
      if (hasPrice && p.price != null) {
        dotP.setAttribute('cx', x); dotP.setAttribute('cy', yP(p.price));
        dotP.setAttribute('visibility', 'visible');
      } else {
        dotP.setAttribute('visibility', 'hidden');
      }

      tipTitle.textContent = fmtFull.format(parseDate(p.date));
      tipRows.textContent = '';
      var gText = 'CO\u2082: ' + fmtNum(p.avg, 0) + ' gCO\u2082/kWh';
      if (p.min != null && p.max != null && Math.round(p.min) !== Math.round(p.max)) {
        gText += ' (' + fmtNum(p.min, 0) + '\u2013' + fmtNum(p.max, 0) + ')';
      }
      tipRows.appendChild(tipRow(gText, COLOR.carbonInk));
      if (hasPrice) {
        tipRows.appendChild(tipRow('OMIE: ' + (p.price != null ? fmtNum(p.price, 4) + ' \u20ac/kWh' : '\u2014'), COLOR.priceInk));
      }

      tip.style.display = 'block';
      var cr = container.getBoundingClientRect();
      var tipW = tip.offsetWidth || 190;
      var left = clientX - cr.left + 14;
      if (left + tipW > cr.width - 4) left = Math.max(4, clientX - cr.left - tipW - 14);
      var top = Math.max(4, clientY - cr.top - 58);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function hide() {
      crossLine.setAttribute('visibility', 'hidden');
      dotG.setAttribute('visibility', 'hidden');
      dotP.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    }

    var overlay = el('rect', { x: M.left, y: M.top, width: PW, height: PH, fill: 'transparent', style: 'cursor:crosshair;' });
    function onPoint(cx, cy) {
      var sr = svg.getBoundingClientRect();
      if (!sr.width) return;
      var x = (cx - sr.left) * (W / sr.width);
      var idx = Math.max(0, Math.min(n - 1, Math.floor((x - M.left) / slotW)));
      showAt(idx, cx, cy);
    }
    overlay.addEventListener('mousemove', function (ev) { onPoint(ev.clientX, ev.clientY); });
    overlay.addEventListener('touchstart', function (ev) {
      if (ev.touches && ev.touches[0]) onPoint(ev.touches[0].clientX, ev.touches[0].clientY);
    }, { passive: true });
    overlay.addEventListener('touchmove', function (ev) {
      if (ev.touches && ev.touches[0]) onPoint(ev.touches[0].clientX, ev.touches[0].clientY);
    }, { passive: true });
    overlay.addEventListener('mouseleave', hide);
    overlay.addEventListener('touchend', hide);
    svg.appendChild(overlay);

    container.innerHTML = '';
    container.appendChild(svg);
    container.appendChild(tip);
  }

  function tipRow(str, color) {
    var d = document.createElement('div');
    d.textContent = str;
    d.style.color = color;
    return d;
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(0);
  }

  function niceScale(minV, maxV, targetTicks, forceZero) {
    var lo = forceZero ? Math.min(0, minV) : minV;
    var hi = maxV;
    if (!(hi > lo)) hi = lo + (forceZero ? 1 : 0.05);
    var paddedHi = hi + (hi - lo) * 0.12;
    var rawStep = (paddedHi - lo) / Math.max(2, targetTicks);
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var norm = rawStep / mag;
    var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    var step = mult * mag;
    var niceLo = forceZero && minV >= 0 ? 0 : Math.floor(lo / step) * step;
    var niceHi = Math.ceil(paddedHi / step) * step;
    if (niceHi <= niceLo) niceHi = niceLo + step;
    var ticks = [];
    for (var v = niceLo; v <= niceHi + step * 1e-6; v += step) {
      ticks.push(Math.round(v * 100000) / 100000);
    }
    return { lo: niceLo, hi: niceHi, ticks: ticks };
  }

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }

  function text(x, y, str, attrs) {
    var t = el('text', attrs || {});
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.appendChild(document.createTextNode(str));
    return t;
  }
})();
