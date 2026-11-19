// timeline_flow — DOM + GSAP scene builder (HyperFrames composition).
// Contract: engine/HYPERFRAMES_ENGINE.md §6 — export default build(ctx); every tween is placed on ctx.tl
// at an ABSOLUTE time; no callbacks, no randomness, no wall clock.
//
// Legacy semantics (canvas_templates/data_templates.mjs#drawTimelineFlowScene + components/TimelineFlow.mjs),
// driven by the shared kernel state `computeTimelineFlowState` so thresholds match Studio/Canvas exactly:
//   • horizontal (cards under a rail) or vertical (rail on the left, row cards) layout, 2..6 milestones;
//   • pending milestones are ghosts (opacity .22, blur 6, scale .96) and reveal at `progress_start`;
//   • the rail fills segment by segment (cubic in-out between consecutive starts, kernel trackFillRatio);
//   • the active milestone is emphasised (cyan ring + glow, card scale 1.03), completed ones turn green ✓;
//   • `callout` banner slides in at `callout.show_at_progress` (default .80).

import { computeTimelineFlowState } from "../kernel.mjs";

const STYLE_ID = "tvs-style-timeline-flow";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CSS = `
.tf { position: absolute; inset: 0; }
.tf__head { position: absolute; left: 0; top: 0; height: 38px; display: flex; align-items: center; gap: 18px; max-width: 100%; }
.tf__sub { font: 500 20px var(--tvs-font); color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tf__rails { position: absolute; inset: 0; pointer-events: none; }
.tf__rail { position: absolute; border-radius: 4px; background: rgba(51,65,85,0.72); }
.tf__fill { position: absolute; left: 0; top: 0; border-radius: 4px; background: linear-gradient(90deg, #2A62FF, #10C0F0); }
.tf__rail--v .tf__fill { background: linear-gradient(180deg, #2A62FF, #10C0F0); }
.tf__fill::after { content: ""; position: absolute; right: 0; top: 0; bottom: 0; width: min(18px, 100%); border-radius: 4px;
  background: linear-gradient(90deg, rgba(144,224,240,0) 0%, #E6FAFF 100%); }
.tf__rail--v .tf__fill::after { left: 0; right: 0; top: auto; bottom: 0; width: auto; height: min(18px, 100%);
  background: linear-gradient(180deg, rgba(144,224,240,0) 0%, #E6FAFF 100%); }
.tf__item { position: absolute; transform-origin: 50% 50%; }
.tf__marker { position: absolute; border-radius: 50%; }
.tf__mlayer { position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center; }
.tf__mbase { background: #091122; border: 2px solid; }
.tf__mactive { background: radial-gradient(circle, #135A86 0%, #0B3252 72%); border: 3.5px solid #10C0F0; }
.tf__mdone { background: #064E3B; border: 2.5px solid #10B981; }
.tf__halo { position: absolute; border-radius: 50%; border: 5px solid rgba(16,192,240,0.2); pointer-events: none; }
.tf__mactive > .tf__halo { inset: -10.5px; }
.tf__mdone > .tf__halo { inset: -6.5px; border-width: 3px; border-color: rgba(16,185,129,0.18); }
.tf__cactive > .tf__halo { inset: -8.5px; border-width: 4px; border-color: rgba(16,192,240,0.13); }
.tf__callout > .tf__halo { inset: -9px; border-width: 4px; border-color: rgba(16,192,240,0.1); border-radius: 23px; }
.tf__check { color: #6EE7B7; font: 900 24px var(--tvs-font); line-height: 1; }
.tf__ring { position: absolute; inset: -2px; border-radius: 50%; border: 2.5px solid #10C0F0; pointer-events: none; }
.tf__card { position: absolute; border-radius: 18px; }
.tf__clayer { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.tf__cbase { background: linear-gradient(180deg, rgba(12,22,42,0.9) 0%, rgba(9,17,34,0.84) 100%); border: 1.5px solid rgba(148,163,184,0.24); }
.tf__cactive { background: linear-gradient(180deg, rgba(16,38,70,0.96) 0%, rgba(12,28,54,0.94) 100%); border: 2.5px solid #10C0F0; }
.tf__cdone { border: 1.5px solid rgba(16,185,129,0.55); }
.tf__body { position: absolute; inset: 0; }
.tf__tag { position: absolute; display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 14px; border: 1.2px solid;
  font: 700 15px var(--tvs-font); white-space: nowrap; }
.tf__metric { position: absolute; display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(148,163,184,0.3); background: rgba(15,23,42,0.75); color: #94A3B8; font: 600 14px ${MONO}; white-space: nowrap; }
.tf__title { position: absolute; color: #F8FAFC; font-weight: 700; }
.tf__desc { position: absolute; color: #CBD5E1; font-weight: 500; }
.tf__line { white-space: pre; }
.tf__callout { position: absolute; left: 0; right: 0; height: 66px; border-radius: 16px; border: 2px solid #10C0F0; background: rgba(10,32,58,0.95);
  display: flex; align-items: center; gap: 12px; padding: 0 26px; }
.tf__ctitle { flex: none; font: 700 20px var(--tvs-font); color: #90E0F0; white-space: nowrap; }
.tf__ctext { font: 600 20px var(--tvs-font); color: #F8FAFC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

/** Greedy word wrap with hard breaks for over-long words and an ellipsis on overflow. */
function wrapText(text, font, width, maxLines) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  let truncated = false;
  for (let i = 0; i < words.length && !truncated; i++) {
    let word = words[i];
    const test = cur ? `${cur} ${word}` : word;
    if (measure(test, font) <= width) {
      cur = test;
      continue;
    }
    if (cur) {
      lines.push(cur);
      cur = "";
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    }
    while (measure(word, font) > width && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut), font) > width) cut--;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    }
    cur = word;
  }
  if (!truncated && cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last && measure(`${last}…`, font) > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/**
 * Exact state-change points of a piecewise-constant function of progress: dense sampling, then
 * bisection to ~1e-7 progress. Returns [{ p, key }] starting with the state at p = 0.
 */
function stateChanges(keyAt, samples = 1200) {
  const out = [{ p: 0, key: keyAt(0) }];
  let prevP = 0;
  let prevKey = out[0].key;
  for (let i = 1; i <= samples; i++) {
    const p = i / samples;
    const key = keyAt(p);
    if (key !== prevKey) {
      let lo = prevP;
      let hi = p;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (keyAt(mid) === prevKey) lo = mid;
        else hi = mid;
      }
      out.push({ p: hi, key });
      prevKey = key;
    }
    prevP = p;
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function buildTimelineFlow(ctx) {
  const { tl, gsap, common, vd, stage, at } = ctx;
  const { el, icon, getTone, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const W = STAGE.width;
  const H = STAGE.height;
  const sceneEnd = ctx.start + ctx.dur;
  const fitDur = (t, d) => Math.max(0.02, Math.min(d, sceneEnd - 0.01 - t));
  const clampT = (t) => Math.min(t, sceneEnd - 0.03);

  const base = computeTimelineFlowState(vd, 0);
  const vertical = base.orientation === "vertical";
  const ms = base.milestones.slice(0, 6);
  const n = ms.length;
  const callout = base.callout && (base.callout.title || base.callout.text) ? base.callout : null;

  const root = el("div.tf");
  const head = el("div.tf__head", {}, el("div.tvs-badge", { text: String(vd.badge || "Chuỗi xử lý theo thời gian") }));
  if (vd.subtitle) head.appendChild(el("div.tf__sub", { text: String(vd.subtitle) }));
  root.appendChild(head);

  // ---- Layout -----------------------------------------------------------------
  const calloutTop = H - 72;
  const items = []; // { m, item, card + marker layers, activeScale }
  // Rail = one segment per gap BETWEEN markers (never under a marker): the growing fill then never
  // invalidates marker pixels, whose partial re-raster is not bit-stable across seek orders.
  const rails = el("div.tf__rails");
  const segs = []; // { fill, span (centre-to-centre px), gapR (hidden px at each end), len (visible px) }
  const addSeg = (style, span, gapR, isV) => {
    const len = Math.max(0, span - 2 * gapR);
    const seg = el(`div.tf__rail${isV ? ".tf__rail--v" : ""}`, { style });
    const fill = el("div.tf__fill", { style: isV ? { width: "100%", height: "0px", backgroundSize: `100% ${len}px` } : { width: "0px", height: "100%", backgroundSize: `${len}px 100%` } });
    seg.appendChild(fill);
    rails.appendChild(seg);
    segs.push({ fill, span, gapR, len });
  };

  const buildMarker = (m, size, iconPx) => {
    const tone = getTone(m.tone);
    const marker = el("div.tf__marker", { style: { width: `${size}px`, height: `${size}px` } });
    const mBase = el("div.tf__mlayer.tf__mbase", { style: { borderColor: tone.border } }, icon(m.icon, tone.text, iconPx));
    const mActive = el("div.tf__mlayer.tf__mactive", {}, el("div.tf__halo"), icon(m.icon, "#90E0F0", iconPx));
    const check = el("div.tf__check", { text: "✓", style: { fontSize: `${Math.round(size * 0.42)}px` } });
    const mDone = el("div.tf__mlayer.tf__mdone", {}, el("div.tf__halo"), check);
    const ring = el("div.tf__ring");
    marker.append(mBase, mActive, mDone, ring);
    return { marker, mActive, mDone, check, ring };
  };

  const buildCardShell = (w, h, radius) => {
    const card = el("div.tf__card", { style: { width: `${w}px`, height: `${h}px`, borderRadius: `${radius}px` } });
    const cBase = el("div.tf__clayer.tf__cbase");
    const cDone = el("div.tf__clayer.tf__cdone");
    const cActive = el("div.tf__clayer.tf__cactive", {}, el("div.tf__halo", { style: { borderRadius: `${radius + 6}px` } }));
    const body = el("div.tf__body");
    card.append(cBase, cDone, cActive, body);
    return { card, cDone, cActive, body };
  };

  const tagEl = (m, x, y, px = 15) => {
    const tone = getTone(m.tone);
    return el("div.tf__tag", {
      text: m.timeLabel,
      style: { left: `${x}px`, top: `${y}px`, background: tone.bg, color: tone.text, borderColor: tone.border, fontSize: `${px}px` },
    });
  };

  const linesEl = (cls, lines, x, y, w, px, lh) =>
    el(cls, { style: { left: `${x}px`, top: `${y}px`, width: `${w}px`, fontSize: `${px}px`, lineHeight: `${lh}px` } }, lines.map((l) => el("div.tf__line", { text: l })));

  if (!vertical) {
    // Horizontal: rail on top, one card per milestone underneath (legacy gap 22, marker r 30).
    const gap = 22;
    const cardW = n === 1 ? Math.min(W, 760) : Math.floor((W - gap * Math.max(0, n - 1)) / Math.max(1, n));
    const x0 = n === 1 ? Math.round((W - cardW) / 2) : 0;
    const [titlePx, titleLh, descPx, descLh] = n <= 3 ? [27, 35, 20.5, 28] : n === 4 ? [24, 31, 19, 26] : [20, 26, 16.5, 22];
    const pad = n >= 5 ? 18 : 22;
    const innerW = cardW - pad * 2;
    const models = ms.map((m) => {
      const tagW = Math.min(innerW, measure(m.timeLabel, `700 15px ${FONT}`) + 26);
      const metricW = m.metricBadge ? measure(m.metricBadge, `600 14px ${MONO}`) + 22 : 0;
      const metricInline = Boolean(m.metricBadge) && tagW + 10 + metricW <= innerW;
      const titleLines = wrapText(m.title, `700 ${titlePx}px ${FONT}`, innerW, 3);
      const descLines = m.description ? wrapText(m.description, `500 ${descPx}px ${FONT}`, innerW, 5) : [];
      const titleY = pad + 28 + (m.metricBadge && !metricInline ? 34 : 0) + 16;
      const descY = titleY + titleLines.length * titleLh + 10;
      const needed = (descLines.length ? descY + descLines.length * descLh : titleY + titleLines.length * titleLh) + pad + 4;
      return { m, tagW, metricW, metricInline, titleLines, descLines, titleY, descY, needed };
    });
    const regionTop = 54;
    const regionBottom = callout ? calloutTop - 22 : H;
    const markerD = 60;
    const maxCardH = regionBottom - regionTop - markerD - 22;
    const minCardH = n <= 4 ? 290 : 260;
    const cardH = Math.max(Math.min(minCardH, maxCardH), Math.min(maxCardH, Math.max(...models.map((md) => md.needed), 0)));
    const blockH = markerD + 22 + cardH;
    const blockTop = regionTop + Math.max(0, Math.round((regionBottom - regionTop - blockH) * 0.42));
    const railY = blockTop + markerD / 2;

    if (n > 1) {
      const span = cardW + gap;
      const gapR = markerD / 2 + 14;
      for (let i = 0; i < n - 1; i++) {
        const cx = x0 + i * span + cardW / 2;
        addSeg({ left: `${cx + gapR}px`, top: `${railY - 4}px`, width: `${Math.max(0, span - 2 * gapR)}px`, height: "8px" }, span, gapR, false);
      }
      root.appendChild(rails);
    }

    models.forEach((md, idx) => {
      const { m } = md;
      const x = x0 + idx * (cardW + gap);
      const item = el("div.tf__item", { style: { left: `${x}px`, top: `${blockTop}px`, width: `${cardW}px`, height: `${blockH}px` } });
      const mk = buildMarker(m, markerD, 28);
      mk.marker.style.left = `${cardW / 2 - markerD / 2}px`;
      mk.marker.style.top = "0px";
      const shell = buildCardShell(cardW, cardH, 18);
      shell.card.style.left = "0px";
      shell.card.style.top = `${markerD + 22}px`;
      shell.card.style.transformOrigin = "50% 0%";
      shell.body.appendChild(tagEl(m, pad, pad));
      if (m.metricBadge) {
        const mx = md.metricInline ? pad + md.tagW + 10 : pad;
        const my = md.metricInline ? pad + 1 : pad + 28 + 8;
        shell.body.appendChild(el("div.tf__metric", { text: m.metricBadge, style: { left: `${mx}px`, top: `${my}px` } }));
      }
      shell.body.appendChild(linesEl("div.tf__title", md.titleLines, pad, md.titleY, innerW, titlePx, titleLh));
      if (md.descLines.length) shell.body.appendChild(linesEl("div.tf__desc", md.descLines, pad, md.descY, innerW, descPx, descLh));
      item.append(shell.card, mk.marker);
      root.appendChild(item);
      items.push({ m, item, ...mk, ...shell, activeScale: 1.03 });
    });
  } else {
    // Vertical: rail on the left (legacy railX 52, list from y 62, rows 66..118px, gap 14).
    const railX = 52;
    const listY = 62;
    const gapY = 14;
    const listH = Math.max(160, H - listY - (callout ? 96 : 16));
    const rowH = Math.min(118, Math.max(66, Math.floor((listH - gapY * Math.max(0, n - 1)) / Math.max(1, n))));
    const markerD = rowH >= 84 ? 52 : 46;
    const cardX = railX + 54;
    const cardW = W - cardX;
    const compact = rowH < 86;
    const [titlePx, descPx, descLh] = compact ? [20, 16.5, 21] : [22, 18, 23];
    const descMax = Math.max(0, Math.min(2, Math.floor((rowH - 48 - 10) / descLh)));

    if (n > 1) {
      const span = rowH + gapY;
      const gapR = markerD / 2 + (markerD >= 52 ? 12 : 10);
      for (let i = 0; i < n - 1; i++) {
        const cy = listY + i * span + rowH / 2;
        addSeg({ left: `${railX - 3}px`, top: `${cy + gapR}px`, width: "6px", height: `${Math.max(0, span - 2 * gapR)}px` }, span, gapR, true);
      }
      root.appendChild(rails);
    }

    ms.forEach((m, idx) => {
      const ry = listY + idx * (rowH + gapY);
      const item = el("div.tf__item", { style: { left: "0px", top: `${ry}px`, width: `${W}px`, height: `${rowH}px`, transformOrigin: `${railX}px 50%` } });
      const mk = buildMarker(m, markerD, 24);
      mk.marker.style.left = `${railX - markerD / 2}px`;
      mk.marker.style.top = `${rowH / 2 - markerD / 2}px`;
      const shell = buildCardShell(cardW, rowH, 16);
      shell.card.style.left = `${cardX}px`;
      shell.card.style.top = "0px";
      shell.card.style.transformOrigin = "0% 50%";
      const pad = 20;
      const headY = descMax > 0 ? 12 : Math.round((rowH - 28) / 2);
      const tagW = measure(m.timeLabel, `700 15px ${FONT}`) + 26;
      shell.body.appendChild(tagEl(m, pad, headY));
      const metricW = m.metricBadge ? measure(m.metricBadge, `600 14px ${MONO}`) + 22 : 0;
      const titleX = pad + tagW + 14;
      const titleW = cardW - titleX - pad - (metricW ? metricW + 14 : 0);
      const titleLines = wrapText(m.title, `700 ${titlePx}px ${FONT}`, titleW, 1);
      shell.body.appendChild(linesEl("div.tf__title", titleLines, titleX, headY - 1, titleW, titlePx, 30));
      if (m.metricBadge) {
        shell.body.appendChild(el("div.tf__metric", { text: m.metricBadge, style: { right: `${pad}px`, top: `${headY + 1}px` } }));
      }
      if (m.description && descMax > 0) {
        const descLines = wrapText(m.description, `500 ${descPx}px ${FONT}`, cardW - pad * 2, descMax);
        shell.body.appendChild(linesEl("div.tf__desc", descLines, pad, headY + 28 + 9, cardW - pad * 2, descPx, descLh));
      }
      item.append(shell.card, mk.marker);
      root.appendChild(item);
      items.push({ m, item, ...mk, ...shell, activeScale: 1.012 });
    });
  }

  let calloutEl = null;
  if (callout) {
    calloutEl = el(
      "div.tf__callout",
      { style: { top: `${calloutTop}px` } },
      el("div.tf__halo"),
      callout.title ? el("div.tf__ctitle", { text: `${callout.title}${callout.text ? ":" : ""}` }) : null,
      callout.text ? el("div.tf__ctext", { text: String(callout.text) }) : null
    );
    root.appendChild(calloutEl);
  }
  stage.appendChild(root);

  // ---- Timeline -------------------------------------------------------------
  /**
   * Blur-to-sharp reveal that DROPS the filter once sharp. A lingering `filter: blur(0px)` (what
   * common.reveal leaves behind) keeps a filter surface whose partial re-raster is not bit-stable
   * across seek orders; same for blurred box-shadows and CSS outlines (rounded outline corners) —
   * this template draws glows as bordered halo elements (analytic rounded rects) and gradients.
   */
  const blurIn = (target, t, from = {}, dur = DUR.reveal, ease = EASE.reveal) => {
    const { blur = 12, ...rest } = from;
    const to = {};
    for (const k of Object.keys(rest)) to[k] = k === "scale" ? 1 : 0;
    const d = fitDur(t, dur);
    tl.fromTo(target, { autoAlpha: 0, ...rest, filter: `blur(${blur}px)` }, { autoAlpha: 1, ...to, filter: "blur(0px)", duration: d, ease }, t);
    tl.fromTo(target, { filter: "blur(0px)" }, { filter: "none", duration: 0, immediateRender: false }, t + d);
  };

  const t0 = at(0);
  common.reveal(tl, head, t0 + 0.05, { y: -10, mechanic: ctx.mechanic || "blur-materialize" });
  if (segs.length) blurIn(rails, t0 + 0.08, { blur: 6 });

  // Exact state changes of every milestone from the shared kernel (pending/started/active/done).
  const keyAt = (p) =>
    computeTimelineFlowState(vd, p)
      .milestones.slice(0, n)
      .map((m) => (m.completed ? "d" : m.active ? "a" : m.started ? "s" : "p"))
      .join("");
  const changes = stateChanges(keyAt).map((c) => ({ t: at(c.p), key: c.key }));

  /** Tween `target` through the per-state vars sequence (first tween owns the pre-event state). */
  const drive = (target, idx, varsOf, dur, ease = EASE.reveal) => {
    let prev = varsOf(changes[0].key[idx]);
    gsap.set(target, prev);
    let first = true;
    for (let k = 1; k < changes.length; k++) {
      const next = varsOf(changes[k].key[idx]);
      if (same(prev, next)) continue;
      const t = clampT(changes[k].t);
      tl.fromTo(target, { ...prev }, { ...next, duration: fitDur(t, dur), ease, immediateRender: first }, t);
      first = false;
      prev = next;
    }
  };

  const revealDur = Math.max(0.2, 0.11 * ctx.dur);
  items.forEach((it, idx) => {
    // Ghost → revealed at progress_start (Canvas exporter: alpha .22 → 1; Studio: scale .96 → 1).
    const tStart = clampT(Math.max(t0 + 0.06 + idx * 0.03, at(it.m.progressStart)));
    tl.fromTo(it.item, { opacity: 0.22, scale: 0.96 }, { opacity: 1, scale: 1, duration: fitDur(tStart, revealDur), ease: EASE.reveal }, tStart);
    drive(it.cActive, idx, (s) => ({ autoAlpha: s === "a" ? 1 : 0 }), 0.26);
    drive(it.cDone, idx, (s) => ({ autoAlpha: s === "d" ? 1 : 0 }), 0.3);
    drive(it.card, idx, (s) => ({ scale: s === "a" ? it.activeScale : 1 }), 0.32, EASE.camera);
    drive(it.mActive, idx, (s) => ({ autoAlpha: s === "a" ? 1 : 0 }), 0.24);
    drive(it.mDone, idx, (s) => ({ autoAlpha: s === "d" ? 1 : 0 }), 0.26);

    // One-shot accents: pulse ring on activation, ✓ stamp on completion.
    gsap.set(it.ring, { autoAlpha: 0 });
    let lastState = changes[0].key[idx];
    let ringFirst = true;
    let checkFirst = true;
    changes.forEach((c, k) => {
      const s = c.key[idx];
      if (k > 0 && s === lastState) return;
      const t = clampT(Math.max(t0 + 0.06, c.t));
      if (s === "a") {
        tl.fromTo(it.ring, { autoAlpha: 0, scale: 1 }, { autoAlpha: 0.85, scale: 1.08, duration: fitDur(t, 0.08), ease: "none", immediateRender: ringFirst }, t);
        tl.fromTo(it.ring, { autoAlpha: 0.85, scale: 1.08 }, { autoAlpha: 0, scale: 1.6, duration: fitDur(t + 0.08, 0.6), ease: "power2.out", immediateRender: false }, clampT(t + 0.08));
        ringFirst = false;
      }
      if (s === "d" && checkFirst) {
        // Scale-only stamp: rotated glyphs are rasterized as paths, which is not bit-stable under partial re-raster.
        tl.fromTo(it.check, { scale: 1.7 }, { scale: 1, duration: fitDur(t, DUR.stamp * 2.4), ease: EASE.spring }, t);
        checkFirst = false;
      }
      lastState = s;
    });
  });

  // Rail fill (kernel trackFillRatio): segment i covers (i + cubicInOut(u)) / (n − 1) between starts
  // i and i+1 — tween the virtual centre-to-centre distance, map it to the visible part (pure modifier).
  if (segs.length) {
    const prop = vertical ? "height" : "width";
    segs.forEach((sg, i) => {
      const cur = ms[i].progressStart;
      const nxt = ms[i + 1].progressStart;
      const t = clampT(at(cur));
      const d = nxt > cur ? fitDur(t, at(nxt) - at(cur)) : 0.02;
      const visible = (v) => `${Math.max(0, Math.min(sg.len, (Number.parseFloat(v) || 0) - sg.gapR)).toFixed(2)}px`;
      tl.fromTo(sg.fill, { [prop]: 0 }, { [prop]: sg.span, duration: d, ease: "power2.inOut", modifiers: { [prop]: visible } }, t);
    });
  }

  if (calloutEl) {
    const tc = clampT(Math.max(t0 + 0.1, at(base.calloutStart)));
    blurIn(calloutEl, tc, { y: 14, blur: 8 }, Math.max(0.25, 0.12 * ctx.dur));
  }
}
