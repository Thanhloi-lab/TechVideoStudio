// architecture — DOM/SVG + GSAP scene builder (HyperFrames composition).
//
// Port of the legacy Canvas 2D template (engine/src/canvas_templates/architecture.mjs, the visual
// spec) and the Studio player (engine/src/components/ArchitectureDiagram.mjs) to the scene-module
// contract in engine/HYPERFRAMES_ENGINE.md §6:
//   export default function build(ctx) — creates DOM inside ctx.stage and adds tweens to ctx.tl at
//   ABSOLUTE times. No callbacks, no randomness, no wall clock.
//
// Geometry comes from the shared kernel (computeArchitectureLayout) with exactly the Canvas
// exporter's layout box, card size and label measurement, so zones / ports / edge routing / label
// placement / packet-badge sides match the legacy render 1:1.
//
// Determinism strategy: every (element, property-set) is owned by ONE "track" that emits
// non-overlapping fromTo tweens with explicit from-values (cut tweens hand their interpolated value
// to the next one). The first tween of a track renders immediately, so the pre-event state is what
// shows before it. Packets travel via stroke-dashoffset on copies of the edge path (pathLength =
// sampled arc length) and the packet_label pill follows the same eased arc-length curve through
// piecewise-linear x/y segments — no MotionPathPlugin, no onUpdate.

import { computeArchitectureLayout, computePacketBadgePos } from "../kernel.mjs";

const STYLE_ID = "tvs-style-architecture";
const FONT = `"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;

/** Legacy Canvas layout box in the 1920x1080 frame: areaX=70, areaY=126, W-140, H-300. */
const AREA_FRAME = Object.freeze({ x: 70, y: 126, w: 1780, h: 780 });
/** Camera viewport top (frame y): zoomed content panning above this slides under the top bar. */
const VIEWPORT_TOP = 94;
/** Legacy card metrics (getCachedArchitectureLayout). */
const CARD = Object.freeze({ w: 244, h: 150, radius: 20 });
/** Legacy camera: zoom toward the active-node centroid when a step has no explicit camera_focus. */
const AUTO_FOCUS = true;
const AUTO_FOCUS_ZOOM = 1.1;
const FOCUS_ZOOM_DEFAULT = 1.14;
const FOCUS_ZOOM_MAX = 1.25;

const COLOR = Object.freeze({
  cyan: "#10C0F0",
  glow: "#90E0F0",
  danger: "#EF4444",
  dangerText: "#FCA5A5",
  muted: "#475569",
  auraCyan: "rgba(16, 192, 240, 0.28)",
  auraDanger: "rgba(239, 68, 68, 0.28)",
});

const CSS = `
.arch { position: absolute; inset: 0; }
.arch__viewport { position: absolute; overflow: hidden; }
.arch__camera { position: absolute; transform-origin: 50% 50%; }
.arch__layer { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.arch__svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.arch__zone { position: absolute; }
.arch__zpill { position: absolute; display: flex; align-items: center; height: 32px; padding: 0 13px; border-radius: 9px;
  border: 1.5px solid; white-space: pre; overflow: hidden; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32); }
.arch__zpill-label { flex: 0 0 auto; font: 700 17px var(--tvs-font); }
.arch__zpill-sub { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 500 15px var(--tvs-font); }
.arch__elabel { position: absolute; }
.arch__elabel-pill { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px;
  white-space: nowrap; font: 600 19px var(--tvs-font); }
.arch__elabel-base { background: rgba(11, 20, 38, 0.9); border: 1.5px solid #334155; color: #94A3B8; }
.arch__elabel-act { background: rgba(6, 12, 26, 0.96); border: 2px solid; color: #F8FAFC; opacity: 0; }
.arch__node { position: absolute; }
.arch__node-in, .arch__node-st { position: absolute; inset: 0; }
.arch__node-base { position: absolute; inset: 0; border-radius: ${CARD.radius}px; background: rgba(11, 20, 38, 0.9);
  border: 2px solid rgba(148, 163, 184, 0.28); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); }
.arch__node-hl { position: absolute; inset: 0; border-radius: ${CARD.radius}px; background: rgba(15, 28, 52, 0.96); border: 3.5px solid; opacity: 0; }
.arch__node-body { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 0 12px; text-align: center; }
.arch__node-icon { flex: none; width: 54px; height: 54px; border-radius: 14px; border: 1.5px solid; display: grid; place-items: center; margin-bottom: 9px; }
.arch__node-icon .tvs-icon-glyph { font-size: 28px; }
.arch__node-art { flex: none; width: 100%; height: 68px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }
.arch__node-art-img { width: 112px; height: 68px; object-fit: contain; display: block; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.55)); }
.arch__node-label { max-width: 100%; font: 700 22px/28px var(--tvs-font); color: #F8FAFC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arch__node-sub { max-width: 100%; margin-top: 3px; font: 600 17px/22px var(--tvs-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arch__node-body--wrap .arch__node-icon { width: 44px; height: 44px; border-radius: 12px; margin-bottom: 6px; }
.arch__node-body--wrap .arch__node-art { height: 54px; margin-bottom: 4px; }
.arch__node-body--wrap .arch__node-art-img { width: 92px; height: 54px; }
.arch__node-body--wrap .arch__node-label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal;
  overflow-wrap: anywhere; text-wrap: balance; font-size: 18px; line-height: 22px; }
.arch__node-body--wrap .arch__node-sub { line-height: 20px; }
.arch__pbadge { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.arch__pbadge-pill { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); display: flex; align-items: center; height: 24px; padding: 0 9px;
  border-radius: 12px; border: 1.5px solid; background: rgba(2, 10, 20, 0.92); font: 700 16px var(--tvs-mono); white-space: nowrap;
  opacity: 0; visibility: hidden; }
.arch__bwrap { position: absolute; left: 0; right: 0; top: -16px; /* frame y 112, legacy banner */ height: 50px; display: flex; justify-content: center; pointer-events: none; }
.arch__banner { display: flex; align-items: center; gap: 13px; height: 50px; max-width: 1740px; padding: 0 31px 0 22px; border-radius: 25px;
  border: 2px solid var(--tvs-cyan); background: rgba(6, 12, 26, 0.94); box-shadow: 0 0 20px rgba(16, 192, 240, 0.28);
  color: #E0F7FF; font: 700 23px var(--tvs-font); white-space: nowrap; opacity: 0; visibility: hidden; }
.arch__banner-dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--tvs-gold); box-shadow: 0 0 10px var(--tvs-gold); }
.arch__banner-text { overflow: hidden; text-overflow: ellipsis; }
`;

function ensureStyle(common) {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(common.el("style", { id: STYLE_ID, text: CSS }));
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const r2 = (n) => Math.round(n * 100) / 100;
/** Legacy shows any truthy badge_text / packet_label (numbers included); blank strings hide it. */
const textOf = (v) => (v === null || v === undefined || v === false || typeof v === "object" ? "" : String(v).trim());

/** Canvas 2D text measurement (allowed by the contract: fonts are ready before builders run). */
function makeMeasurer() {
  const c2d = document.createElement("canvas").getContext("2d");
  return (font, text) => {
    c2d.font = font;
    return c2d.measureText(String(text ?? "")).width;
  };
}

/**
 * Arc-length parametrisation of a kernel edge geometry (pointAt/tangentAt take the kernel's own
 * parameter: arc length for polylines, Bézier t for curves).
 */
function buildArc(geom, samples = 160) {
  const ts = [0];
  const cum = [0];
  let prev = geom.pointAt(0);
  let total = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const p = geom.pointAt(t);
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    ts.push(t);
    cum.push(total);
    prev = p;
  }
  const L = Math.max(0.01, total);
  const tAt = (s) => {
    const target = clamp(s, 0, total);
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo];
    const f = seg > 1e-9 ? (target - cum[lo]) / seg : 0;
    return ts[lo] + f * (ts[hi] - ts[lo]);
  };
  return { L, pointAtS: (s) => geom.pointAt(tAt(s)), tangentAtS: (s) => geom.tangentAt(tAt(s)) };
}

/** Convert flat track values into GSAP vars (`attr:<name>` → attr, `blur` → filter). */
function toVars(values) {
  const vars = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith("attr:")) (vars.attr || (vars.attr = {}))[k.slice(5)] = v;
    else if (k === "blur") vars.filter = `blur(${r2(v)}px)`;
    else vars[k] = v;
  }
  return vars;
}

/**
 * A single owner for a set of numeric properties on one target. Events are state changes at
 * absolute times; they become non-overlapping fromTo tweens with explicit from-values. A tween cut
 * short by the next event hands its eased intermediate value to the next tween, so arbitrary seek
 * order always yields the same pixels. The first emitted tween renders immediately (pre-event state).
 */
function createTrack(tl, gsap, target, initial, endT) {
  const events = [];
  const keys = Object.keys(initial);
  return {
    add(t, to, duration = 0.001, ease = "none") {
      if (Number.isFinite(t)) events.push({ t, to, duration, ease, order: events.length });
      return this;
    },
    commit() {
      events.sort((a, b) => a.t - b.t || a.order - b.order);
      let cur = { ...initial };
      let emitted = false;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.t >= endT - 1e-4) break;
        const next = { ...cur, ...ev.to };
        const nextT = i + 1 < events.length ? events[i + 1].t : Infinity;
        const full = Math.max(0.001, ev.duration);
        const room = Math.min(nextT, endT) - ev.t;
        if (room <= 5e-4) {
          cur = next; // superseded instantly by the following event
          continue;
        }
        if (keys.every((k) => Math.abs(next[k] - cur[k]) < 1e-6)) continue;
        const d = Math.min(full, room);
        tl.fromTo(target, toVars(cur), { ...toVars(next), duration: d, ease: ev.ease, immediateRender: !emitted }, ev.t);
        emitted = true;
        if (d >= full) {
          cur = next;
        } else {
          const p = gsap.parseEase(ev.ease)(d / full);
          const out = {};
          for (const k of keys) out[k] = Math.round((cur[k] + (next[k] - cur[k]) * p) * 1e4) / 1e4;
          cur = out;
        }
      }
      if (!emitted) gsap.set(target, toVars(initial));
    },
  };
}

export default function buildArchitecture(ctx) {
  const { tl, gsap, common, vd, stage, at, start, dur, index } = ctx;
  const { el, svg, icon, getTone, mark, EASE, DUR, STAGE, FRAME_W, FRAME_H } = common;
  ensureStyle(common);

  const uid = `arch${index}`;
  const t0 = start;
  const tEnd = start + dur;
  const usableEnd = Math.max(start + dur * 0.5, tEnd - DUR.exit - DUR.breather);
  const track = (target, initial) => createTrack(tl, gsap, target, initial, tEnd);
  const measure = makeMeasurer();

  // ---- Shared layout (same call as the Canvas exporter) -------------------------------------
  const layout = computeArchitectureLayout(vd, AREA_FRAME.w, AREA_FRAME.h, {
    cardW: CARD.w,
    cardH: CARD.h,
    cornerRadius: 18,
    labelScale: 1.48,
    measureLabelWidth: (txt) => measure(`600 19px ${FONT}`, txt) + 26,
  });
  const AW = layout.width;
  const AH = layout.height;
  const centerX = AW / 2;
  const centerY = AH / 2;
  const nodeById = new Map(layout.nodes.map((nr) => [nr.id, nr]));

  // ---- Flow steps → hold segments ------------------------------------------------------------
  // A step owns [its start, next step start): gaps hold the previous step, the last step holds to
  // the end. Before the first step everything is neutral (reveal choreography).
  const rawSteps = Array.isArray(vd.flow_steps) ? vd.flow_steps : [];
  const nSteps = Math.max(1, rawSteps.length);
  let steps = rawSteps
    .map((s, i) => {
      const raw = s && typeof s === "object" ? s : {};
      const ps = mark(raw.progress_start, i / nSteps);
      const pe = Math.max(ps, mark(raw.progress_end, (i + 1) / nSteps));
      return { i, raw, ps, pe };
    })
    .sort((a, b) => a.ps - b.ps || a.i - b.i);
  steps = steps.filter((s, k) => k === 0 || s.ps - steps[k - 1].ps > 1e-3);
  steps.forEach((s, k) => {
    s.tS = at(s.ps);
    s.tE = Math.max(s.tS + 0.05, at(s.pe));
    s.segEnd = k + 1 < steps.length ? at(steps[k + 1].ps) : tEnd;
    s.nodes = new Set((Array.isArray(s.raw.active_nodes) ? s.raw.active_nodes : []).filter(Boolean));
    s.edges = new Set((Array.isArray(s.raw.active_edges) ? s.raw.active_edges : []).filter(Boolean));
    s.drawDur = Math.min(0.42, Math.max(0.1, s.tE - s.tS) * 0.4);
  });

  // ---- DOM skeleton --------------------------------------------------------------------------
  const root = el("div.arch");
  const viewport = el("div.arch__viewport", {
    style: {
      left: `${-STAGE.left}px`,
      top: `${VIEWPORT_TOP - STAGE.top}px`,
      width: `${FRAME_W}px`,
      height: `${FRAME_H - VIEWPORT_TOP}px`,
    },
  });
  const camera = el("div.arch__camera", {
    style: { left: `${AREA_FRAME.x}px`, top: `${AREA_FRAME.y - VIEWPORT_TOP}px`, width: `${AW}px`, height: `${AH}px` },
  });
  viewport.appendChild(camera);
  root.appendChild(viewport);

  const zoneLayer = el("div.arch__layer");
  const edgeSvg = svg("svg", { class: "arch__svg", width: AW, height: AH, viewBox: `0 0 ${AW} ${AH}` });
  const defs = svg("defs");
  edgeSvg.appendChild(defs);
  const labelLayer = el("div.arch__layer");
  const packetSvg = svg("svg", { class: "arch__svg", width: AW, height: AH, viewBox: `0 0 ${AW} ${AH}` });
  const nodeLayer = el("div.arch__layer");
  const badgeLayer = el("div.arch__layer");
  camera.append(zoneLayer, edgeSvg, labelLayer, packetSvg, nodeLayer, badgeLayer);

  const region = { x: -240, y: -240, width: AW + 480, height: AH + 480 };
  const glowId = `${uid}-glow`;
  defs.appendChild(
    svg("filter", { id: glowId, filterUnits: "userSpaceOnUse", ...region }, svg("feGaussianBlur", { stdDeviation: 5 }))
  );

  // ---- Reveal schedule (zones → nodes staggered L→R → edges drawn) ----------------------------
  const zoneT = (i) => t0 + 0.04 + i * 0.07;
  const nodeOrder = [...layout.nodes].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  const nNodes = nodeOrder.length;
  const nodeStagger = nNodes > 1 ? Math.min(0.09, 0.5 / (nNodes - 1)) : 0;
  const nodeT0 = t0 + 0.1 + Math.min(0.15, layout.zones.length * 0.04);
  const nodeRevealT = new Map(nodeOrder.map((nr, i) => [nr.id, nodeT0 + i * nodeStagger]));
  const edgeOrder = [...layout.edges].sort(
    (a, b) =>
      (nodeRevealT.get(a.from) ?? 0) - (nodeRevealT.get(b.from) ?? 0) ||
      (nodeRevealT.get(a.to) ?? 0) - (nodeRevealT.get(b.to) ?? 0)
  );
  const nEdges = edgeOrder.length;
  const edgeStagger = nEdges > 1 ? Math.min(0.08, 0.45 / (nEdges - 1)) : 0;
  const edgeT0 = nodeT0 + nodeStagger * Math.max(0, nNodes - 1) * 0.5 + 0.22;
  const EDGE_DRAW = 0.5;
  const edgeRevealT = new Map();
  edgeOrder.forEach((geom, i) => {
    const firstActive = steps.find((s) => s.edges.has(geom.id));
    edgeRevealT.set(geom.id, Math.min(edgeT0 + i * edgeStagger, firstActive ? firstActive.tS : Infinity));
  });

  // ---- Zones ---------------------------------------------------------------------------------
  layout.zones.forEach((z, i) => {
    const pad = 4;
    const wrap = el("div.arch__zone", {
      style: { left: `${z.x - pad}px`, top: `${z.y - pad}px`, width: `${z.w + pad * 2}px`, height: `${z.h + pad * 2}px` },
    });
    const box = svg("svg", { class: "arch__svg", width: z.w + pad * 2, height: z.h + pad * 2 });
    box.appendChild(
      svg("rect", {
        x: pad,
        y: pad,
        width: r2(z.w),
        height: r2(z.h),
        rx: z.depth === 0 ? 22 : 16,
        fill: z.depth === 0 ? z.style.fill : z.style.fillNested,
        stroke: z.style.stroke,
        "stroke-width": z.depth === 0 ? 2.4 : 1.8,
        "stroke-dasharray": z.dashed ? "12 8" : null,
      })
    );
    wrap.appendChild(box);
    if (z.label) {
      wrap.appendChild(
        el(
          "div.arch__zpill",
          {
            style: {
              left: `${z.badgeX - z.x + pad}px`,
              top: `${z.badgeY - z.y + pad}px`,
              maxWidth: `${Math.max(40, z.w - 24)}px`,
              background: z.style.badgeBg,
              borderColor: z.style.stroke,
              color: z.style.badgeText,
            },
          },
          el("span.arch__zpill-label", { text: z.label }),
          z.sublabel ? el("span.arch__zpill-sub", { text: `  •  ${z.sublabel}`, style: { color: z.style.subText } }) : null
        )
      );
    }
    zoneLayer.appendChild(wrap);
    tl.fromTo(
      wrap,
      { autoAlpha: 0, scale: 0.97, filter: "blur(8px)" },
      { autoAlpha: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: EASE.reveal },
      zoneT(i)
    );
  });

  // ---- Edges ---------------------------------------------------------------------------------
  const maskPath = (d, L) =>
    svg("path", {
      d,
      fill: "none",
      stroke: "#FFFFFF",
      "stroke-width": 32,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      pathLength: r2(L),
      "stroke-dasharray": `${r2(L)} ${r2(L + 100)}`,
      "stroke-dashoffset": r2(L + 30),
    });
  const dot = (x, y, r, fill, stroke, width) =>
    svg("circle", { cx: r2(x), cy: r2(y), r, fill, stroke, "stroke-width": width });
  const arrow = (x, y, angleDeg, fill) =>
    svg("path", {
      d: "M 0 0 L -13.86 -8 L -13.86 8 Z",
      fill,
      transform: `translate(${r2(x)} ${r2(y)}) rotate(${r2(angleDeg)})`,
    });
  const flowDash = (path) => {
    // Finite flowing dash (legacy: lineDashOffset = -sceneTime * 48 px/s), linear over the scene.
    tl.fromTo(path, { attr: { "stroke-dashoffset": 0 } }, { attr: { "stroke-dashoffset": r2(-48 * dur) }, duration: dur, ease: "none" }, t0);
  };

  const edgeInfo = layout.edges.map((geom, ei) => {
    const arc = buildArc(geom);
    const L = arc.L;
    const d = geom.svgPathD;
    const isDanger = geom.style === "danger";
    const isDashed = geom.style === "dashed";
    const baseColor = isDanger ? COLOR.danger : COLOR.muted;
    const actColor = isDanger ? COLOR.danger : COLOR.cyan;
    const aura = isDanger ? COLOR.auraDanger : COLOR.auraCyan;
    const endTan = geom.tangentAt(1);
    const stroke = (color, width, extra = {}) =>
      svg("path", {
        d,
        fill: "none",
        stroke: color,
        "stroke-width": width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...extra,
      });

    // Base (resting) edge: muted / danger stroke, junction dots, arrowhead — drawn in once.
    const baseMask = maskPath(d, L);
    defs.appendChild(svg("mask", { id: `${uid}-mb${ei}`, maskUnits: "userSpaceOnUse", ...region }, baseMask));
    const baseMain = stroke(baseColor, 2.6, { "stroke-dasharray": isDashed ? "12 8" : null });
    const baseStart = dot(geom.sx, geom.sy, 4.5, "#0F172A", baseColor, 2);
    const baseEnd = svg("g", {}, dot(geom.ex, geom.ey, 4.5, "#0F172A", baseColor, 2), arrow(geom.ex, geom.ey, endTan.angleDeg, baseColor));
    const baseG = svg("g", {}, svg("g", { mask: `url(#${uid}-mb${ei})` }, baseMain), baseStart, baseEnd);

    // Active overlay: glow aura + bright stroke re-drawn at each activation, glowing dots + arrow.
    const actMask = maskPath(d, L);
    defs.appendChild(svg("mask", { id: `${uid}-ma${ei}`, maskUnits: "userSpaceOnUse", ...region }, actMask));
    const actAura = stroke(aura, 14, { filter: `url(#${glowId})` });
    const actMain = stroke(actColor, 4.5, { "stroke-dasharray": isDashed ? "12 8" : null });
    const actStart = svg("g", {}, dot(geom.sx, geom.sy, 6.5, "#060C18", actColor, 3), dot(geom.sx, geom.sy, 2.5, "#FFFFFF", "none", 0));
    const actEnd = svg(
      "g",
      {},
      dot(geom.ex, geom.ey, 6.5, "#060C18", actColor, 3),
      dot(geom.ex, geom.ey, 2.5, "#FFFFFF", "none", 0),
      arrow(geom.ex, geom.ey, endTan.angleDeg, actColor)
    );
    const actG = svg("g", { style: "opacity:0;visibility:hidden" }, svg("g", { mask: `url(#${uid}-ma${ei})` }, actAura, actMain), actStart, actEnd);

    edgeSvg.appendChild(svg("g", { class: "arch__edge", "data-edge": geom.id }, baseG, actG));
    if (isDashed) {
      flowDash(baseMain);
      flowDash(actMain);
    }

    // Base reveal: draw-in through the mask, start dot first, end dot + arrowhead on arrival.
    const tR = edgeRevealT.get(geom.id) ?? edgeT0;
    tl.fromTo(baseMask, { attr: { "stroke-dashoffset": r2(L + 30) } }, { attr: { "stroke-dashoffset": 0 }, duration: EDGE_DRAW, ease: "power2.out" }, tR);
    tl.fromTo(baseStart, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, ease: "none" }, tR);
    tl.fromTo(baseEnd, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.14, ease: "none" }, tR + EDGE_DRAW * 0.72);

    // Edge label pill (anti-overlap position from the kernel; legacy width = max(kernel, measured))
    let labelAct = null;
    if (geom.label) {
      const lw = Math.max(geom.labelW || 0, measure(`600 19px ${FONT}`, geom.label) + 26);
      const lh = geom.labelH || 34;
      labelAct = el("div.arch__elabel-pill.arch__elabel-act", { text: geom.label, style: { borderColor: actColor, boxShadow: `0 0 16px ${aura}` } });
      const wrap = el(
        "div.arch__elabel",
        { style: { left: `${r2(geom.labelX - lw / 2)}px`, top: `${r2(geom.labelY - lh / 2)}px`, width: `${r2(lw)}px`, height: `${lh}px` } },
        el("div.arch__elabel-pill.arch__elabel-base", { text: geom.label }),
        labelAct
      );
      labelLayer.appendChild(wrap);
      tl.fromTo(wrap, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: EASE.reveal }, tR + EDGE_DRAW * 0.45);
    }

    // Flow-step state tracks
    const baseTr = track(baseG, { opacity: 1 });
    const actTr = track(actG, { autoAlpha: 0 });
    const actMaskTr = track(actMask, { "attr:stroke-dashoffset": r2(L + 30) });
    const actEndTr = track(actEnd, { autoAlpha: 0 });
    const labelTr = labelAct ? track(labelAct, { opacity: 0 }) : null;
    let wasActive = false;
    for (const s of steps) {
      const isActive = s.edges.has(geom.id);
      baseTr.add(s.tS, { opacity: isActive ? 0.36 : 1 }, 0.25, EASE.reveal);
      actTr.add(s.tS, { autoAlpha: isActive ? 1 : 0 }, isActive ? 0.12 : 0.25, isActive ? "none" : EASE.exit);
      labelTr?.add(s.tS, { opacity: isActive ? 1 : 0 }, 0.22, EASE.reveal);
      if (isActive && !wasActive) {
        actMaskTr.add(s.tS, { "attr:stroke-dashoffset": r2(L + 30) }, 0.001);
        actMaskTr.add(s.tS + 0.001, { "attr:stroke-dashoffset": 0 }, s.drawDur, EASE.reveal);
        actEndTr.add(s.tS, { autoAlpha: 0 }, 0.001);
        actEndTr.add(s.tS + s.drawDur * 0.8, { autoAlpha: 1 }, 0.1, "none");
      }
      wasActive = isActive;
    }
    for (const tr of [baseTr, actTr, actMaskTr, actEndTr, labelTr]) tr?.commit();

    return { geom, arc, L, isDanger };
  });
  const edgeById = new Map(edgeInfo.map((e) => [e.geom.id, e]));

  // ---- Packets (one capsule + comet tail per active edge per step) ----------------------------
  const PACKET_EASE = EASE.reveal; // legacy easeQuartOut per traversal == GSAP power3.out
  const invQuartOut = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 0.25);
  for (const s of steps) {
    const a = s.tS + s.drawDur * 0.55;
    const b = Math.min(s.tE, s.segEnd, usableEnd) - 0.02;
    if (b - a < 0.25) continue;
    const cycles = Math.max(1, Math.round((b - a) / 1.3));
    const T = (b - a) / cycles;
    const fadeOut = Math.min(0.14, T * 0.15);
    const label = textOf(s.raw.packet_label);

    for (const id of s.edges) {
      const info = edgeById.get(id);
      if (!info) continue;
      const { geom, arc, L, isDanger } = info;
      const pColor = isDanger ? COLOR.danger : COLOR.cyan;
      const d = geom.svgPathD;
      // Dash parts riding the path: tails (behind the head), glow, white rim, coloured core.
      const parts = [
        { len: 84, gap: 10, width: 4, color: pColor, opacity: 0.16 },
        { len: 54, gap: 10, width: 6.5, color: pColor, opacity: 0.3 },
        { len: 28, gap: 10, width: 9, color: pColor, opacity: 0.5 },
        { len: 16, center: true, width: 24, color: pColor, opacity: 0.55, glow: true },
        { len: 16, center: true, width: 18, color: "#FFFFFF", opacity: 1 },
        { len: 16, center: true, width: 14, color: pColor, opacity: 1 },
      ];
      const offsetAt = (part, sArc) => r2(part.center ? part.len / 2 - sArc : part.gap + part.len - sArc);
      const group = svg("g", { class: "arch__packet", style: "opacity:0;visibility:hidden" });
      const partTracks = parts.map((part) => {
        const path = svg("path", {
          d,
          fill: "none",
          stroke: part.color,
          "stroke-width": part.width,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: part.opacity,
          filter: part.glow ? `url(#${glowId})` : null,
          pathLength: r2(L),
          "stroke-dasharray": `${part.len} ${r2(L + 400)}`,
          "stroke-dashoffset": offsetAt(part, 0),
        });
        group.appendChild(path);
        return { part, tr: track(path, { "attr:stroke-dashoffset": offsetAt(part, 0) }) };
      });
      packetSvg.appendChild(group);
      const visTr = track(group, { autoAlpha: 0 });

      // packet_label pill follows the packet on the kernel's locked side (computePacketBadgePos).
      let badge = null;
      if (label) {
        const pill = el("div.arch__pbadge-pill", {
          text: label,
          style: { borderColor: isDanger ? COLOR.danger : COLOR.glow, color: isDanger ? COLOR.dangerText : COLOR.glow },
        });
        const outer = el("div.arch__pbadge", {}, pill);
        badgeLayer.appendChild(outer);
        const badgeAt = (sArc) =>
          computePacketBadgePos(arc.pointAtS(sArc), arc.tangentAtS(sArc), geom, {
            offset: 34,
            canvasW: AW,
            canvasH: AH,
            padX: 90,
            padYTop: 24,
            padYBottom: 22,
          });
        const p0 = badgeAt(0);
        badge = { badgeAt, posTr: track(outer, { x: r2(p0.x), y: r2(p0.y) }), visTr: track(pill, { autoAlpha: 0 }) };
      }

      for (let c = 0; c < cycles; c++) {
        const tc = a + c * T;
        const travel = T - 0.002;
        visTr.add(tc, { autoAlpha: 1 }, 0.08);
        visTr.add(tc + T - fadeOut, { autoAlpha: 0 }, fadeOut - 0.001);
        for (const { part, tr } of partTracks) {
          tr.add(tc, { "attr:stroke-dashoffset": offsetAt(part, 0) }, 0.001);
          tr.add(tc, { "attr:stroke-dashoffset": offsetAt(part, L) }, travel, PACKET_EASE);
        }
        if (badge) {
          badge.visTr.add(tc, { autoAlpha: 1 }, 0.08);
          badge.visTr.add(tc + T - fadeOut, { autoAlpha: 0 }, fadeOut - 0.001);
          // Sample evenly in arc length; time from the inverse quart-out ease (same curve as the dash).
          const K = clamp(Math.ceil(L / 16), 10, 90);
          const p0 = badge.badgeAt(0);
          badge.posTr.add(tc, { x: r2(p0.x), y: r2(p0.y) }, 0.001);
          for (let j = 0; j < K; j++) {
            const ta = tc + invQuartOut(j / K) * travel;
            const tb = tc + invQuartOut((j + 1) / K) * travel;
            const p = badge.badgeAt(((j + 1) / K) * L);
            badge.posTr.add(ta, { x: r2(p.x), y: r2(p.y) }, Math.max(0.001, tb - ta));
          }
        }
      }
      visTr.commit();
      for (const { tr } of partTracks) tr.commit();
      if (badge) {
        badge.posTr.commit();
        badge.visTr.commit();
      }
    }
  }

  // ---- Nodes ---------------------------------------------------------------------------------
  for (const nr of layout.nodes) {
    const n = nr.raw || {};
    const tone = getTone(n.tone);
    const labelText = String(n.label || n.id || "");
    const subText = n.sublabel ? String(n.sublabel) : "";
    const maxTextW = CARD.w - 28;
    const fit = (weight, size, min, text) => {
      const w = measure(`${weight} ${size}px ${FONT}`, text);
      return w > maxTextW ? Math.max(min, Math.floor((size * maxTextW) / w)) : size;
    };
    // Long labels: shrink to >= 18px on one line, else a balanced 2-line clamp at 18px (smaller icon).
    const labelSize = fit(700, 22, 1, labelText);
    const wrapLabel = labelSize < 18;
    const subSize = subText ? fit(600, wrapLabel ? 15 : 17, 13, subText) : 17;

    const rawSvg = typeof n.svg === "string" ? n.svg.trim().replace(/\.svg$/i, "") : "";
    const hasSvgArt = Boolean(rawSvg && /^[a-z0-9_-]+$/i.test(rawSvg));
    const artNode = hasSvgArt
      ? el(
          "div.arch__node-art",
          {},
          el("img.arch__node-art-img", {
            attrs: { src: `./assets/svg/${rawSvg}.svg`, alt: labelText },
            style: { filter: `drop-shadow(0 0 12px ${tone.glow}) drop-shadow(0 6px 14px rgba(0, 0, 0, 0.55))` },
          })
        )
      : el("div.arch__node-icon", { style: { background: tone.bg, borderColor: tone.border } }, icon(n.icon, tone.text, wrapLabel ? 26 : 32));

    const hl = el("div.arch__node-hl", { style: { borderColor: tone.border, boxShadow: `0 0 28px 2px ${tone.glow}, 0 10px 28px rgba(2, 10, 20, 0.65)` } });
    const body = el(
      wrapLabel ? "div.arch__node-body.arch__node-body--wrap" : "div.arch__node-body",
      {},
      artNode,
      el("div.arch__node-label", { text: labelText, style: !wrapLabel && labelSize !== 22 ? { fontSize: `${labelSize}px` } : undefined }),
      subText ? el("div.arch__node-sub", { text: subText, style: { color: tone.text, fontSize: `${subSize}px` } }) : null
    );
    const st = el("div.arch__node-st", {}, el("div.arch__node-base"), hl, body);
    const inner = el("div.arch__node-in", {}, st);
    const card = el(
      "div.arch__node",
      { attrs: { "data-node": nr.id }, style: { left: `${r2(nr.x)}px`, top: `${r2(nr.y)}px`, width: `${r2(nr.w)}px`, height: `${r2(nr.h)}px` } },
      inner
    );
    nodeLayer.appendChild(card);

    tl.fromTo(
      inner,
      { autoAlpha: 0, y: 18, scale: 0.92, filter: "blur(10px)" },
      { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.45, ease: EASE.reveal },
      nodeRevealT.get(nr.id) ?? nodeT0
    );

    const stTr = track(st, { opacity: 1, scale: 1 });
    const hlTr = track(hl, { opacity: 0 });
    for (const s of steps) {
      const isHl = s.nodes.has(nr.id);
      const dimmed = s.nodes.size > 0 && !isHl;
      stTr.add(s.tS, { opacity: dimmed ? 0.42 : 1, scale: isHl ? 1.06 : 1 }, 0.32, EASE.reveal);
      hlTr.add(s.tS, { opacity: isHl ? 1 : 0 }, 0.28, EASE.reveal);
    }
    stTr.commit();
    hlTr.commit();
  }

  // ---- Camera rig (explicit camera_focus, else legacy auto-focus on the active-node centroid) --
  const cameraTarget = (s) => {
    let zoom = 1;
    let fx = centerX;
    let fy = centerY;
    const cf = s.raw.camera_focus;
    if (cf && typeof cf === "object") {
      zoom = clamp(num(cf.zoom, FOCUS_ZOOM_DEFAULT) || FOCUS_ZOOM_DEFAULT, 1, FOCUS_ZOOM_MAX);
      fx = (clamp(num(cf.x, 50), 0, 100) / 100) * AW;
      fy = (clamp(num(cf.y, 50), 0, 100) / 100) * AH;
    } else if (AUTO_FOCUS && s.nodes.size > 0 && s.nodes.size < layout.nodes.length) {
      const act = [...s.nodes].map((id) => nodeById.get(id)).filter(Boolean);
      if (act.length) {
        fx = act.reduce((acc, nr) => acc + nr.cx, 0) / act.length;
        fy = act.reduce((acc, nr) => acc + nr.cy, 0) / act.length;
        zoom = AUTO_FOCUS_ZOOM;
      }
    }
    // Legacy shift: (center - focus) * (zoom - 1) * 1.15, clamped to 8.5% W / 7.5% H.
    const x = clamp((centerX - fx) * (zoom - 1) * 1.15, -FRAME_W * 0.085, FRAME_W * 0.085);
    const y = clamp((centerY - fy) * (zoom - 1) * 1.15, -FRAME_H * 0.075, FRAME_H * 0.075);
    return { x: r2(x), y: r2(y), scale: r2(zoom) };
  };
  const camTr = track(camera, { x: 0, y: 0, scale: 1 });
  for (const s of steps) camTr.add(s.tS, cameraTarget(s), DUR.camera, EASE.camera);
  camTr.commit();

  // ---- Step callout banners (outside the camera so they stay sharp & centred) ----------------
  for (const s of steps) {
    const text = textOf(s.raw.badge_text);
    if (!text) continue;
    const banner = el("div.arch__banner", {}, el("span.arch__banner-dot"), el("span.arch__banner-text", { text }));
    root.appendChild(el("div.arch__bwrap", {}, banner));
    const tr = track(banner, { autoAlpha: 0, y: -12, scale: 0.98, blur: 10 });
    tr.add(s.tS, { autoAlpha: 1, y: 0, scale: 1, blur: 0 }, Math.min(DUR.reveal * 1.4, (s.segEnd - s.tS) * 0.5), EASE.reveal);
    if (s.segEnd < usableEnd - 0.05) tr.add(s.segEnd, { autoAlpha: 0, y: -8, scale: 0.98, blur: 6 }, 0.2, EASE.exit);
    tr.commit();
  }

  stage.appendChild(root);
}
