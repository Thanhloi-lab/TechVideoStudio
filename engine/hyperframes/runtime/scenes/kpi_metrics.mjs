// kpi_metrics — DOM + GSAP scene builder (HyperFrames composition).
// Contract: engine/HYPERFRAMES_ENGINE.md §6 — export default build(ctx); every tween is placed on ctx.tl
// at an ABSOLUTE time; no callbacks, no randomness, no wall clock.
//
// Legacy semantics (canvas_templates/data_templates.mjs#drawKpiMetricsScene + components/KpiMetricsCard.mjs),
// thresholds from the shared kernel state `computeKpiMetricsState`:
//   • 1..4 KPI cards: ghost (opacity .14) until `progress_start`, reveal over 12% of the scene, counter
//     0 → `numeric_target` (prefix/suffix/decimals) over 24% with Quart-Out, sparkline drawn on from
//     start+.03 over 28%, delta badge in `delta_tone`;
//   • optional bar chart at `chart.show_at_progress` (default .40): ghost → reveal over 14%, bars grow
//     (Quart-Out over 22%, staggered .032), counting value labels shown once a bar passes 15%, `unit`,
//     gold highlighted bar;
//   • optional `alert_stamp` slams in at `show_at_progress` (default .72), rotated −7°, danger/success.
// Counters are seek-safe: GSAP tweens the element's innerText with snap + modifiers (no onUpdate).

import { computeKpiMetricsState } from "../kernel.mjs";

const STYLE_ID = "tvs-style-kpi-metrics";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CSS = `
.km { position: absolute; inset: 0; }
.km__card { position: absolute; border-radius: 20px; border: 2.2px solid;
  background: linear-gradient(180deg, rgba(13,24,46,0.94) 0%, rgba(9,17,34,0.9) 100%); transform-origin: 50% 60%; }
.km__halo { position: absolute; inset: -9.2px; border-radius: 27px; border: 5px solid; pointer-events: none; }
.km__label { position: absolute; left: 24px; right: 24px; top: 22px; color: #CBD5E1; font: 600 20px/26px var(--tvs-font); }
.km__line { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.km__value { position: absolute; left: 24px; font-family: ${MONO}; font-weight: 800; white-space: pre; font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em; }
.km__delta { position: absolute; left: 24px; height: 32px; padding: 0 14px; border-radius: 16px; border: 1.2px solid;
  display: inline-flex; align-items: center; font: 700 16px var(--tvs-font); white-space: nowrap; transform-origin: 0% 50%; }
.km__spark { position: absolute; left: 24px; overflow: visible; }
.km__chart { position: absolute; left: 0; border-radius: 20px; border: 1.5px solid rgba(148,163,184,0.25);
  background: linear-gradient(180deg, rgba(11,20,40,0.92) 0%, rgba(9,17,34,0.88) 100%); }
.km__ctitle { position: absolute; left: 28px; display: flex; align-items: center; gap: 14px; height: 36px; max-width: 70%; }
.km__ctext { font: 700 22px var(--tvs-font); color: #F8FAFC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.km__unit { flex: none; height: 28px; padding: 0 10px; border-radius: 8px; display: inline-flex; align-items: center;
  border: 1px solid rgba(144,224,240,0.35); background: rgba(16,192,240,0.1); color: #90E0F0; font: 600 16px ${MONO}; }
.km__grid { position: absolute; height: 0; border-top: 1px dashed rgba(148,163,184,0.14); }
.km__base { position: absolute; height: 2px; border-radius: 1px; background: rgba(148,163,184,0.32); }
.km__bar { position: absolute; bottom: 0; border-radius: 10px 10px 4px 4px; background: linear-gradient(180deg, #10C0F0 0%, #2A62FF 100%); }
.km__bar--hl { background: linear-gradient(180deg, #F0C040 0%, #FF9900 100%); }
.km__bval { position: absolute; bottom: 0; text-align: center; font: 700 17px ${MONO}; color: #E2E8F0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.km__bval--hl { color: #FDE68A; }
.km__blbl { position: absolute; text-align: center; font: 600 18px var(--tvs-font); color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.km__stamp { position: absolute; height: 68px; border-radius: 12px; border: 4px solid; display: flex; align-items: center; justify-content: center;
  color: #FFFFFF; font: 800 28px var(--tvs-font); letter-spacing: 0.04em; white-space: nowrap; }
.km__shock { position: absolute; height: 68px; border-radius: 12px; border: 3px solid; pointer-events: none; }
`;

function ensureStyle(common) {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(common.el("style", { id: STYLE_ID, text: CSS }));
}

let measureCtx = null;
function measure(text, font) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(String(text)).width;
}

function wrapText(text, font, width, maxLines) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  let truncated = false;
  for (let i = 0; i < words.length; i++) {
    const test = cur ? `${cur} ${words[i]}` : words[i];
    if (!cur || measure(test, font) <= width) {
      cur = test;
      continue;
    }
    lines.push(cur);
    cur = words[i];
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }
  if (!truncated && cur) lines.push(cur);
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last && measure(`${last}…`, font) > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** Legacy formatKpiDisplayNumber decimals: explicit integer `decimals`, else inferred from the target (≤ 3). */
function kpiDecimals(card) {
  if (Number.isInteger(card?.decimals) && card.decimals >= 0) return Math.min(6, card.decimals);
  const asStr = String(Number(card?.numeric_target));
  const dot = asStr.indexOf(".");
  return dot >= 0 ? Math.min(3, asStr.length - dot - 1) : 0;
}

export default function buildKpiMetrics(ctx) {
  const { tl, common, vd, stage, at } = ctx;
  const { el, svg, getTone, stamp, drawPath, sparklinePoints, formatNumber, DUR, STAGE } = common;
  ensureStyle(common);

  const W = STAGE.width;
  const H = STAGE.height;
  const sceneEnd = ctx.start + ctx.dur;
  const fitDur = (t, d) => Math.max(0.02, Math.min(d, sceneEnd - 0.01 - t));
  const clampT = (t) => Math.min(t, sceneEnd - 0.03);

  const base = computeKpiMetricsState(vd, 0);
  const rawCards = (Array.isArray(vd.cards) ? vd.cards : []).slice(0, 4);
  const cards = base.cards.slice(0, 4);
  const n = cards.length;
  const chart = base.chart && base.chart.series.length ? base.chart : null;
  const series = chart ? chart.series.slice(0, 8) : [];
  const alertStamp = base.alertStamp && base.alertStamp.text ? base.alertStamp : null;

  const root = el("div.km");

  // ---- KPI cards ----------------------------------------------------------------
  const gap = 20;
  const cardH = chart ? 260 : 456;
  const cardsTop = chart ? 0 : 24;
  const cardW = n === 1 ? Math.min(W, chart ? 600 : 720) : Math.floor((W - gap * Math.max(0, n - 1)) / Math.max(1, n));
  const cardsX0 = n === 1 ? Math.round((W - cardW) / 2) : 0;
  const baseValPx = chart ? (n >= 4 ? 46 : 56) : n >= 4 ? 52 : n === 3 ? 62 : 72;

  const cardEls = cards.map((c, idx) => {
    const raw = rawCards[idx] || {};
    const tone = getTone(c.tone);
    const deltaTone = getTone(c.deltaTone);
    const x = cardsX0 + idx * (cardW + gap);
    // No overflow clip / CSS outline: anti-aliased rounded clips and outline corners re-raster
    // differently depending on seek order; a bordered halo element (analytic rrect) is stable.
    const card = el("div.km__card", {
      style: { left: `${x}px`, top: `${cardsTop}px`, width: `${cardW}px`, height: `${cardH}px`, borderColor: tone.border },
    });
    card.appendChild(el("div.km__halo", { style: { borderColor: tone.bg } }));

    const labelLines = wrapText(c.label, `600 20px ${FONT}`, cardW - 48, 2);
    card.appendChild(el("div.km__label", {}, labelLines.map((l) => el("div.km__line", { text: l }))));

    // Value / counter (font shrinks so the final text fits the card)
    const hasNumeric = Number.isFinite(Number(raw.numeric_target));
    const decimals = hasNumeric ? kpiDecimals(raw) : 0;
    const prefix = raw.prefix ? String(raw.prefix) : "";
    const suffix = raw.suffix ? String(raw.suffix) : "";
    const target = hasNumeric ? Number(raw.numeric_target) : 0;
    const fmt = (v) => `${prefix}${formatNumber(v, decimals)}${suffix}`;
    const finalText = hasNumeric
      ? raw.value !== undefined && raw.value !== null && raw.value !== "" ? String(raw.value) : fmt(target)
      : String(raw.value ?? "");
    let valPx = baseValPx;
    const widest = Math.max(measure(finalText, `800 ${valPx}px ${MONO}`), hasNumeric ? measure(fmt(target), `800 ${valPx}px ${MONO}`) : 0);
    if (widest > cardW - 48) valPx = Math.max(24, Math.floor((valPx * (cardW - 48)) / widest));
    const valY = chart ? 80 : labelLines.length > 1 ? 100 : 88;
    const value = el("div.km__value", {
      text: hasNumeric ? fmt(0) : finalText,
      style: { top: `${valY}px`, fontSize: `${valPx}px`, lineHeight: `${Math.round(valPx * 1.12)}px`, color: tone.text },
    });
    card.appendChild(value);

    let delta = null;
    if (c.deltaText) {
      const dy = valY + Math.round(valPx * 1.12) + (chart ? 10 : 16);
      // Pre-truncated (no overflow clip on the rounded pill — see the note on .km__card).
      let deltaText = c.deltaText;
      const deltaFont = `700 16px ${FONT}`;
      if (measure(deltaText, deltaFont) > cardW - 48 - 28) {
        while (deltaText && measure(`${deltaText}…`, deltaFont) > cardW - 48 - 28) deltaText = deltaText.slice(0, -1);
        deltaText = `${deltaText.trimEnd()}…`;
      }
      if (vd.sharp_tags || raw.delta_label) {
        delta = common.sharpTag(raw.delta_label || "DELTA", deltaText, { tone: c.deltaTone || "blue" });
        delta.style.position = "absolute";
        delta.style.left = "24px";
        delta.style.top = `${dy}px`;
        delta.style.maxWidth = `${cardW - 48}px`;
      } else {
        delta = el("div.km__delta", {
          text: deltaText,
          style: { top: `${dy}px`, maxWidth: `${cardW - 48}px`, background: deltaTone.bg, color: deltaTone.text, borderColor: deltaTone.border },
        });
      }
      card.appendChild(delta);
    }

    // Sparkline (stroke draw-on + soft area + end dot)
    let spark = null;
    if (c.sparkline.length >= 2) {
      const spW = cardW - 48;
      const spH = chart ? 46 : 120;
      const spY = cardH - spH - 22;
      const pts = sparklinePoints(c.sparkline, spW, spH, 5);
      const coords = pts.split(" ").map((p) => p.split(",").map(Number));
      let len = 0;
      for (let i = 1; i < coords.length; i++) len += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
      const [lx, ly] = coords[coords.length - 1];
      const area = svg("polygon", { points: `${pts} ${coords[coords.length - 1][0]},${spH} ${coords[0][0]},${spH}`, fill: tone.bg, opacity: "0" });
      const line = svg("polyline", {
        points: pts,
        fill: "none",
        stroke: tone.border,
        "stroke-width": chart ? "3" : "3.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      const dot = svg("circle", { cx: lx.toFixed(1), cy: ly.toFixed(1), r: chart ? "5" : "6", fill: tone.text, stroke: tone.border, "stroke-width": "2" });
      const node = svg("svg", { class: "km__spark", width: spW, height: spH, viewBox: `0 0 ${spW} ${spH}`, style: `top:${spY}px` }, area, line, dot);
      card.appendChild(node);
      spark = { area, line, dot, len: Math.ceil(len + 4) };
    }

    root.appendChild(card);
    return { c, card, value, delta, spark, hasNumeric, target, fmt, finalText, decimals };
  });

  // ---- Bar chart ------------------------------------------------------------------
  let chartEls = null;
  if (chart) {
    const chY = cardH + 24;
    const chH = H - chY;
    const box = el("div.km__chart", { style: { top: `${chY}px`, width: `${W}px`, height: `${chH}px` } });
    const headH = alertStamp ? 100 : 68;
    const title = el(
      "div.km__ctitle",
      { style: { top: "16px" } },
      el("div.km__ctext", { text: chart.title || "Biểu đồ xu hướng" }),
      chart.unit ? el("div.km__unit", { text: chart.unit }) : null
    );
    box.appendChild(title);

    const plotX = 54;
    const plotW = W - 108;
    const plotTop = headH + 10;
    const plotBottom = chH - 52;
    const plotH = plotBottom - plotTop;
    const labelRoom = 30;
    const maxVal = Math.max(1, ...series.map((pt) => Math.max(0, pt.value)));
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      box.appendChild(el("div.km__grid", { style: { left: `${plotX}px`, width: `${plotW}px`, top: `${Math.round(plotBottom - f * (plotH - labelRoom))}px` } }));
    });
    box.appendChild(el("div.km__base", { style: { left: `${plotX - 8}px`, width: `${plotW + 16}px`, top: `${plotBottom}px` } }));

    const slotW = plotW / Math.max(1, series.length);
    const barW = Math.min(110, slotW * 0.56);
    const bars = series.map((pt, idx) => {
      const bx = plotX + idx * slotW + (slotW - barW) / 2;
      const fullH = Math.max(6, (Math.max(0, pt.value) / maxVal) * (plotH - labelRoom));
      const bar = el(`div.km__bar${pt.highlight ? ".km__bar--hl" : ""}`, { style: { left: `${bx}px`, width: `${barW}px`, height: "6px", bottom: `${chH - plotBottom}px` } });
      const valW = Math.max(barW + 40, slotW);
      const val = el(`div.km__bval${pt.highlight ? ".km__bval--hl" : ""}`, {
        text: formatNumber(0, 0),
        style: { left: `${bx + barW / 2 - valW / 2}px`, width: `${valW}px`, bottom: `${chH - plotBottom}px` },
      });
      const lbl = el("div.km__blbl", { text: pt.label, style: { left: `${plotX + idx * slotW}px`, width: `${slotW}px`, top: `${plotBottom + 14}px` } });
      box.append(bar, val, lbl);
      return { pt, bar, val, fullH };
    });
    root.appendChild(box);
    chartEls = { box, bars, chY, headH };
  }

  // ---- Alert stamp ------------------------------------------------------------------
  let stampEls = null;
  if (alertStamp) {
    const isOk = alertStamp.tone === "success";
    const color = isOk ? "#10B981" : "#EF4444";
    const bg = isOk ? "rgba(6, 78, 59, 0.92)" : "rgba(127, 29, 29, 0.92)";
    const text = String(alertStamp.text);
    const sw = Math.min(480, Math.ceil(measure(text, `800 28px ${FONT}`) * 1.04 + 56));
    // Chart: inside the chart header band (right). No chart: in the free band under the cards.
    const cx = chart ? W - 40 - sw / 2 : W - 300;
    const cy = chart ? chartEls.chY + 52 : Math.round(cardsTop + cardH + (H - cardsTop - cardH) / 2);
    const pos = { left: `${Math.round(cx - sw / 2)}px`, top: `${Math.round(cy - 34)}px`, width: `${sw}px` };
    const shock = el("div.km__shock", { style: { ...pos, borderColor: color } });
    const st = el("div.km__stamp", { text, style: { ...pos, borderColor: color, background: bg } });
    root.append(shock, st);
    stampEls = { st, shock };
  }

  stage.appendChild(root);

  // ---- Timeline ---------------------------------------------------------------------
  // NB: no CSS filters / blurred box-shadows here — their partial re-raster is not bit-stable across
  // seek orders in Chrome (ghost states use opacity only, like the legacy Canvas exporter).
  const t0 = at(0);
  const QUART_OUT = "power3.out"; // GSAP power3 = quartic (kernel easeQuartOut)

  cardEls.forEach((k, idx) => {
    const ps = k.c.progressStart;
    const tStart = clampT(Math.max(t0 + 0.04 + idx * 0.03, at(ps)));
    // Ghost (legacy alpha .14) → visible over 12% of the scene.
    tl.fromTo(k.card, { opacity: 0.14, scale: 0.97 }, { opacity: 1, scale: 1, duration: fitDur(tStart, Math.max(0.2, 0.12 * ctx.dur)), ease: QUART_OUT }, tStart);

    // Counter: innerText 0 → target over 24% of the scene (Quart-Out), formatted every frame by a
    // pure modifier (seek-safe: no onUpdate). The last frame shows `value` verbatim like the kernel.
    if (k.hasNumeric) {
      const step = 1 / 10 ** k.decimals;
      const target = k.target;
      tl.fromTo(
        k.value,
        { innerText: 0 },
        {
          innerText: target,
          duration: fitDur(tStart, Math.max(0.3, 0.24 * ctx.dur)),
          ease: QUART_OUT,
          snap: { innerText: step },
          // The initial (immediate) render bypasses modifiers and would print a raw "0"; the element's
          // static text already is the formatted zero, and backward seeks render ratio 0 through the
          // modifier (same string), so skip it.
          immediateRender: false,
          modifiers: {
            innerText: (v) => {
              const num = Number.parseFloat(v);
              return Math.abs(num - target) <= step / 2 ? k.finalText : k.fmt(Number.isFinite(num) ? num : 0);
            },
          },
        },
        tStart
      );
    }
    if (k.delta) {
      const td = clampT(tStart + 0.14);
      tl.fromTo(k.delta, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: fitDur(td, 0.32), ease: "back.out(2)" }, td);
    }
    if (k.spark) {
      const tsp = clampT(Math.max(tStart + 0.05, at(Math.min(1, ps + 0.03))));
      const dsp = fitDur(tsp, Math.max(0.35, 0.28 * ctx.dur));
      drawPath(tl, k.spark.line, tsp, dsp, k.spark.len, QUART_OUT);
      tl.fromTo(k.spark.area, { attr: { opacity: 0 } }, { attr: { opacity: 0.65 }, duration: dsp, ease: QUART_OUT }, tsp);
      const tdot = clampT(tsp + dsp * 0.55);
      tl.fromTo(k.spark.dot, { autoAlpha: 0, scale: 0, transformOrigin: "50% 50%" }, { autoAlpha: 1, scale: 1, transformOrigin: "50% 50%", duration: fitDur(tdot, 0.3), ease: "back.out(3)" }, tdot);
    }
  });

  if (chartEls) {
    const cs = base.chartStart;
    const tc = clampT(Math.max(t0 + 0.06, at(cs)));
    // Ghost chart (legacy alpha .14) → revealed over 14% of the scene.
    tl.fromTo(chartEls.box, { opacity: 0.14, y: 10 }, { opacity: 1, y: 0, duration: fitDur(tc, Math.max(0.22, 0.14 * ctx.dur)), ease: QUART_OUT }, tc);
    chartEls.bars.forEach((b, idx) => {
      const tb = clampT(Math.max(tc, at(Math.min(1, cs + idx * 0.032))));
      const db = fitDur(tb, Math.max(0.3, 0.22 * ctx.dur));
      tl.fromTo(b.bar, { height: 6 }, { height: b.fullH, duration: db, ease: QUART_OUT }, tb);
      // Value label rides the bar top and counts up with the same easing; shown once the bar passes 15%.
      tl.fromTo(b.val, { y: -(6 + 8) }, { y: -(b.fullH + 8), duration: db, ease: QUART_OUT }, tb);
      tl.fromTo(
        b.val,
        { innerText: 0 },
        {
          innerText: Math.max(0, b.pt.value),
          duration: db,
          ease: QUART_OUT,
          snap: { innerText: 1 },
          immediateRender: false,
          modifiers: { innerText: (v) => formatNumber(Math.round(Number.parseFloat(v) || 0), 0) },
        },
        tb
      );
      const tShow = clampT(tb + db * (1 - Math.pow(0.85, 0.25)));
      tl.fromTo(b.val, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tShow, 0.12), ease: "none" }, tShow);
    });
  }

  if (stampEls) {
    const ts = clampT(Math.max(t0 + 0.1, at(base.stampStart)));
    // Slam (legacy dampedSpring 1.55 → 1, −7°) + a crisp shockwave ring.
    stamp(tl, stampEls.st, ts, { from: 1.55, rotation: -7, duration: Math.min(0.42, Math.max(0.3, DUR.stamp * 2.6)) });
    const tw = clampT(ts + 0.12);
    tl.fromTo(stampEls.shock, { autoAlpha: 0, scale: 1, rotation: -7 }, { autoAlpha: 0.75, duration: fitDur(tw, 0.02), ease: "none" }, tw);
    tl.fromTo(stampEls.shock, { autoAlpha: 0.75, scale: 1 }, { autoAlpha: 0, scale: 1.32, duration: fitDur(tw + 0.02, 0.5), ease: "power2.out", immediateRender: false }, clampT(tw + 0.02));
  }

}
