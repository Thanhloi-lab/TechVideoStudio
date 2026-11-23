// memory_layout — DOM/SVG + GSAP scene builder (HyperFrames composition).
// Visualizes RAM/heap/cache/hash/B-tree lanes (1..4 lanes x 1..8 cells) with deterministic
// state transitions, SVG pointer arcs, and step callouts inside 1744x772 stage.

const STYLE_ID = "tvs-style-memory-layout";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CSS = `
.mem { position: absolute; inset: 0; }
.mem__head { position: absolute; left: 0; top: 0; right: 0; height: 42px; display: flex; align-items: center; gap: 16px; }
.mem__sub { font: 500 20px var(--tvs-font); color: #CBD5E1; white-space: pre; flex: 1 1 auto; min-width: 0; }
.tvs-scene--light .mem__sub { color: #334155; }
.mem__cx-wrap { position: relative; flex: none; width: 320px; height: 36px; display: flex; justify-content: flex-end; align-items: center; }
.mem__cx { position: absolute; right: 0; top: 0; }
.mem__lane { position: absolute; left: 0; right: 0; border-radius: 16px; border: 1.8px solid rgba(148,163,184,0.24);
  background: rgba(9, 17, 34, 0.90); }
.tvs-scene--light .mem__lane { box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14); }
.mem__lbar { position: absolute; left: 0; top: 14px; bottom: 14px; width: 5px; border-radius: 0 4px 4px 0; }
.mem__linfo { position: absolute; left: 22px; top: 14px; bottom: 14px; width: 244px; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.mem__llbl { font: 700 21px/26px var(--tvs-font); color: #F8FAFC; white-space: pre; }
.mem__lsub { font: 600 14.5px/19px var(--tvs-mono); color: #94A3B8; white-space: pre; }
.mem__cell { position: absolute; border-radius: 12px; border: 2px solid; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 6px 10px; gap: 4px; }
.mem__clbl { font: 700 14px/17px var(--tvs-mono); color: #94A3B8; white-space: pre; }
.mem__cval { font: 800 24px/28px var(--tvs-mono); color: #F8FAFC; white-space: pre; }
.mem__csub { font: 600 13px/16px var(--tvs-mono); color: #CBD5E1; white-space: pre; }
.mem__svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.mem__ppill { position: absolute; height: 24px; padding: 0 10px; border-radius: 12px; border: 1.5px solid;
  background: rgba(2, 10, 20, 0.95); font: 700 13.5px/21px var(--tvs-mono); white-space: pre; }
.mem__stepbar { position: absolute; left: 0; right: 0; bottom: 4px; height: 82px; border-radius: 16px;
  border: 1.8px solid rgba(16, 192, 240, 0.42); background: rgba(9, 17, 34, 0.95); }
.tvs-scene--light .mem__stepbar { box-shadow: 0 14px 32px rgba(15, 23, 42, 0.16); }
.mem__steppanel { position: absolute; inset: 0; padding: 12px 22px; display: flex; align-items: center; gap: 18px; }
.mem__stepnum { flex: none; height: 34px; padding: 0 14px; border-radius: 10px; background: rgba(16,192,240,0.18);
  border: 1.5px solid #10C0F0; color: #90E0F0; font: 800 15px/31px var(--tvs-mono); white-space: pre; }
.mem__steptext { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; }
.mem__steplbl { font: 700 20px/25px var(--tvs-font); color: #F8FAFC; white-space: pre; }
.mem__stepcall { font: 500 16.5px/22px var(--tvs-font); color: #CBD5E1; white-space: pre; }
`;

const CELL_STYLES = {
  idle: { borderColor: "rgba(148, 163, 184, 0.28)", backgroundColor: "rgba(15, 23, 42, 0.78)" },
  active: { borderColor: "#10C0F0", backgroundColor: "rgba(16, 192, 240, 0.18)" },
  match: { borderColor: "#10B981", backgroundColor: "rgba(16, 185, 129, 0.20)" },
  write: { borderColor: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.20)" },
  danger: { borderColor: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.22)" },
};

function ensureStyle(common) {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(common.el("style", { id: STYLE_ID, text: CSS }));
}

let measureCtx = null;
function measure(text, font) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(String(text ?? "")).width;
}

function fitLine(text, font, maxW) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (measure(s, font) <= maxW) return s;
  let out = s;
  while (out.length > 1 && measure(`${out}…`, font) > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

export default function buildMemoryLayout(ctx) {
  const { tl, common, vd, stage, at } = ctx;
  const { el, svg, getTone, drawPath, mark, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const W = STAGE.width;
  const H = STAGE.height;
  const sceneEnd = ctx.start + ctx.dur;
  const t0 = ctx.start;
  const clampT = (t) => Math.min(Math.max(t, t0), sceneEnd - 0.03);
  const fitDur = (t, d) => Math.max(0.02, Math.min(d, sceneEnd - 0.015 - t));

  const lanes = (Array.isArray(vd.lanes) ? vd.lanes : []).slice(0, 4);
  const steps = (Array.isArray(vd.steps) ? vd.steps : [])
    .slice(0, 8)
    .map((s, i) => ({ ...s, idx: i, ps: mark(s?.progress_start, i / 8), pe: mark(s?.progress_end, (i + 1) / 8) }));

  const hasPointers = steps.some((s) => Array.isArray(s.pointers) && s.pointers.length > 0);
  const hasSteps = steps.length > 0;

  const root = el("div.mem");

  // Header
  const badgeStr = fitLine(vd.badge || "Memory & Data Layout", `700 18px ${FONT}`, 380);
  const head = el("div.mem__head", {}, el("div.tvs-badge", { text: badgeStr }));
  const cxWrap = el("div.mem__cx-wrap");
  if (vd.subtitle) {
    const badgeW = measure(badgeStr, `700 18px ${FONT}`) + 44;
    const subAvail = Math.max(200, W - badgeW - 350);
    head.appendChild(el("div.mem__sub", { text: fitLine(vd.subtitle, `500 20px ${FONT}`, subAvail) }));
  }
  head.appendChild(cxWrap);
  root.appendChild(head);

  const cxBadges = [];
  if (vd.complexity_badge) {
    const tag = common.sharpTag("COMPLEXITY", fitLine(vd.complexity_badge, `700 16px ${MONO}`, 200), { tone: "blue", className: "mem__cx" });
    cxWrap.appendChild(tag);
    cxBadges.push({ stepIdx: -1, el: tag });
  }
  steps.forEach((st, idx) => {
    if (!st.complexity) return;
    const tag = common.sharpTag("STEP", fitLine(st.complexity, `700 16px ${MONO}`, 200), { tone: "green", className: "mem__cx" });
    cxWrap.appendChild(tag);
    cxBadges.push({ stepIdx: idx, el: tag });
  });

  // Lanes geometry
  const topPad = hasPointers ? 76 : 56;
  const bottomLimit = hasSteps ? H - 96 : H - 14;
  const availH = Math.max(120, bottomLimit - topPad);
  const laneGap = hasPointers ? (lanes.length >= 4 ? 32 : 42) : 18;
  const laneH = Math.min(182, Math.max(88, Math.floor((availH - laneGap * Math.max(0, lanes.length - 1)) / Math.max(1, lanes.length))));
  const totalLanesH = lanes.length * laneH + Math.max(0, lanes.length - 1) * laneGap;
  const lanesTop = topPad + Math.max(0, Math.round((availH - totalLanesH) * 0.45));

  const cellGeoMap = new Map(); // `${laneId}::${cellId}` -> { x, y, w, h, cx, cy, el, baseState }
  const laneEls = [];

  const cellsX = 286;
  const cellsAreaW = W - cellsX - 18;

  lanes.forEach((lane, lIdx) => {
    const lid = String(lane.id || `lane_${lIdx}`);
    const tone = getTone(lane.tone || "blue");
    const ly = lanesTop + lIdx * (laneH + laneGap);
    const laneEl = el("div.mem__lane", {
      style: { top: `${ly}px`, height: `${laneH}px`, borderColor: "rgba(148,163,184,0.28)" },
    });
    laneEl.appendChild(el("div.mem__lbar", { style: { background: tone.border } }));
    laneEl.appendChild(
      el(
        "div.mem__linfo",
        {},
        el("div.mem__llbl", { text: fitLine(lane.label || lid, `700 21px ${FONT}`, 240) }),
        lane.sublabel ? el("div.mem__lsub", { text: fitLine(lane.sublabel, `600 14.5px ${MONO}`, 240), style: { color: tone.text } }) : null
      )
    );

    const cells = (Array.isArray(lane.cells) ? lane.cells : []).slice(0, 8);
    const cGap = cells.length >= 7 ? 8 : 12;
    const cW = Math.floor((cellsAreaW - cGap * Math.max(0, cells.length - 1)) / Math.max(1, cells.length));
    const cH = laneH - 22;
    const cTop = 11;
    const valPx = cW < 150 ? 18 : cW < 200 ? 22 : 25;

    cells.forEach((cell, cIdx) => {
      const cid = String(cell.id || `c_${cIdx}`);
      const cx = cellsX + cIdx * (cW + cGap);
      const baseState = CELL_STYLES[cell.state] ? cell.state : "idle";
      const stCss = CELL_STYLES[baseState];
      const cellEl = el(
        "div.mem__cell",
        {
          style: {
            left: `${cx}px`,
            top: `${cTop}px`,
            width: `${cW}px`,
            height: `${cH}px`,
            borderColor: stCss.borderColor,
            backgroundColor: stCss.backgroundColor,
          },
        },
        el("div.mem__clbl", { text: fitLine(cell.label || cid, `700 14px ${MONO}`, cW - 18) }),
        cell.value !== undefined && cell.value !== null && String(cell.value) !== ""
          ? el("div.mem__cval", {
              text: fitLine(String(cell.value), `800 ${valPx}px ${MONO}`, cW - 18),
              style: { fontSize: `${valPx}px`, lineHeight: `${Math.round(valPx * 1.15)}px` },
            })
          : null,
        cell.subtext ? el("div.mem__csub", { text: fitLine(cell.subtext, `600 13px ${MONO}`, cW - 18) }) : null
      );
      laneEl.appendChild(cellEl);
      cellGeoMap.set(`${lid}::${cid}`, {
        laneIdx: lIdx,
        cellIdx: cIdx,
        x: cx,
        y: ly + cTop,
        w: cW,
        h: cH,
        cx: cx + cW / 2,
        cy: ly + cTop + cH / 2,
        el: cellEl,
        baseState,
      });
    });

    root.appendChild(laneEl);
    laneEls.push(laneEl);
  });

  // Pointer SVG + Pill layer
  const ptrSvg = svg("svg", { class: "mem__svg", viewBox: `0 0 ${W} ${H}` });
  const ptrPills = el("div.mem__ppills");
  root.append(ptrSvg, ptrPills);

  const stepPtrGroups = steps.map((st) => {
    const ptrs = Array.isArray(st.pointers) ? st.pointers : [];
    const items = [];
    for (const ptr of ptrs) {
      const from = cellGeoMap.get(`${ptr.from_lane}::${ptr.from_cell}`);
      const to = cellGeoMap.get(`${ptr.to_lane}::${ptr.to_cell}`);
      if (!from || !to) continue;
      const tone = getTone(ptr.tone || "blue");
      let x1 = from.cx;
      let y1;
      let x2 = to.cx;
      let y2;
      let pathD;
      let arrowPts;
      let pillX;
      let pillY;

      if (from.laneIdx === to.laneIdx) {
        y1 = from.y - 2;
        y2 = to.y - 2;
        const apexY = Math.max(48, y1 - 28);
        const midX = (x1 + x2) / 2;
        pathD = `M ${x1} ${y1} Q ${midX} ${apexY} ${x2} ${y2}`;
        arrowPts = `${x2},${y2} ${x2 - 5},${y2 - 10} ${x2 + 5},${y2 - 10}`;
        pillX = midX;
        pillY = Math.max(46, apexY - 10);
      } else if (from.laneIdx < to.laneIdx) {
        y1 = from.y + from.h;
        y2 = to.y - 3;
        const midY = (y1 + y2) / 2;
        pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        arrowPts = `${x2},${y2} ${x2 - 5},${y2 - 11} ${x2 + 5},${y2 - 11}`;
        pillX = (x1 + x2) / 2;
        pillY = midY - 12;
      } else {
        y1 = from.y;
        y2 = to.y + to.h + 3;
        const midY = (y1 + y2) / 2;
        pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        arrowPts = `${x2},${y2} ${x2 - 5},${y2 + 11} ${x2 + 5},${y2 + 11}`;
        pillX = (x1 + x2) / 2;
        pillY = midY - 12;
      }

      const path = svg("path", { d: pathD, fill: "none", stroke: tone.border, "stroke-width": 2.8, "stroke-linecap": "round" });
      const headPoly = svg("polygon", { points: arrowPts, fill: tone.border });
      ptrSvg.append(path, headPoly);

      let pillEl = null;
      if (ptr.label) {
        const lbl = fitLine(ptr.label, `700 13.5px ${MONO}`, 190);
        const pw = Math.ceil(measure(lbl, `700 13.5px ${MONO}`) + 24);
        const pl = Math.max(12, Math.min(W - pw - 12, Math.round(pillX - pw / 2)));
        const pt = Math.max(46, Math.min(bottomLimit - 28, Math.round(pillY)));
        pillEl = el("div.mem__ppill", {
          text: lbl,
          style: { left: `${pl}px`, top: `${pt}px`, borderColor: tone.border, color: tone.text },
        });
        ptrPills.appendChild(pillEl);
      }
      items.push({ path, headPoly, pillEl, approxLen: Math.max(40, Math.hypot(x2 - x1, y2 - y1) * 1.25) });
    }
    return items;
  });

  // Step callout bar
  const stepPanels = [];
  if (hasSteps) {
    const bar = el("div.mem__stepbar");
    steps.forEach((st, idx) => {
      const numStr = `BƯỚC ${idx + 1}/${steps.length}`;
      const numW = measure(numStr, `800 15px ${MONO}`) + 32;
      const textW = Math.max(240, W - 44 - numW - 22);
      const panel = el(
        "div.mem__steppanel",
        {},
        el("div.mem__stepnum", { text: numStr }),
        el(
          "div.mem__steptext",
          {},
          el("div.mem__steplbl", { text: fitLine(st.label || "", `700 20px ${FONT}`, textW) }),
          st.callout ? el("div.mem__stepcall", { text: fitLine(st.callout, `500 16.5px ${FONT}`, textW) }) : null
        )
      );
      bar.appendChild(panel);
      stepPanels.push(panel);
    });
    root.appendChild(bar);
  }

  stage.appendChild(root);

  // ---- Deterministic Timeline ----
  const mech = ctx.mechanic || "blur-materialize";
  common.reveal(tl, head, t0 + 0.04, { y: -10, mechanic: mech });
  laneEls.forEach((ln, i) => {
    common.reveal(tl, ln, clampT(t0 + 0.06 + i * DUR.stagger), { y: 14, mechanic: mech });
  });

  // Initialize complexity badges
  let activeCxEl = null;
  if (cxBadges.length) {
    const def = cxBadges.find((b) => b.stepIdx === -1) || cxBadges[0];
    cxBadges.forEach((b) => {
      if (b === def) {
        tl.fromTo(b.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: EASE.reveal }, t0 + 0.06);
        activeCxEl = b.el;
      } else {
        tl.fromTo(b.el, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
      }
    });
  }

  // Track cell states across steps so every cell tween is strictly sequential & deterministic
  const curCellState = new Map();
  for (const [key, geo] of cellGeoMap.entries()) {
    curCellState.set(key, geo.baseState);
  }

  // Hide all step panels & pointers initially
  stepPanels.forEach((p) => {
    tl.fromTo(p, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
  });
  stepPtrGroups.forEach((grp) => {
    grp.forEach((item) => {
      tl.fromTo(item.path, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
      tl.fromTo(item.headPoly, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
      if (item.pillEl) tl.fromTo(item.pillEl, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
    });
  });

  let prevStepEndT = t0 + 0.06;
  let prevPanelIdx = -1;
  let prevPtrIdx = -1;

  steps.forEach((st, idx) => {
    const tStep = clampT(Math.max(at(st.ps), prevStepEndT + 0.02));
    const stepAnimDur = fitDur(tStep, 0.22);
    prevStepEndT = tStep + stepAnimDur;

    // Step panel swap
    if (prevPanelIdx >= 0 && stepPanels[prevPanelIdx]) {
      tl.fromTo(
        stepPanels[prevPanelIdx],
        { autoAlpha: 1 },
        { autoAlpha: 0, duration: fitDur(tStep, 0.12), ease: EASE.exit, immediateRender: false },
        tStep
      );
    }
    if (stepPanels[idx]) {
      tl.fromTo(
        stepPanels[idx],
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: stepAnimDur, ease: EASE.reveal, immediateRender: false },
        tStep
      );
      prevPanelIdx = idx;
    }

    // Complexity badge override
    const stepCx = cxBadges.find((b) => b.stepIdx === idx);
    if (stepCx && stepCx.el !== activeCxEl) {
      if (activeCxEl) {
        tl.fromTo(activeCxEl, { autoAlpha: 1 }, { autoAlpha: 0, duration: fitDur(tStep, 0.12), immediateRender: false }, tStep);
      }
      tl.fromTo(stepCx.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tStep, 0.2), immediateRender: false }, tStep);
      activeCxEl = stepCx.el;
    }

    // Cell states for this step: apply explicit highlight_cells, revert previously highlighted cells back to baseState
    const nextStateMap = new Map();
    for (const [key, geo] of cellGeoMap.entries()) nextStateMap.set(key, geo.baseState);
    if (Array.isArray(st.highlight_cells)) {
      for (const hc of st.highlight_cells) {
        const key = `${hc.lane_id}::${hc.cell_id}`;
        if (cellGeoMap.has(key) && CELL_STYLES[hc.state]) {
          nextStateMap.set(key, hc.state);
        }
      }
    }
    for (const [key, geo] of cellGeoMap.entries()) {
      const prevSt = curCellState.get(key) || "idle";
      const nextSt = nextStateMap.get(key) || "idle";
      if (prevSt !== nextSt) {
        tl.fromTo(
          geo.el,
          CELL_STYLES[prevSt],
          { ...CELL_STYLES[nextSt], duration: stepAnimDur, ease: EASE.reveal, immediateRender: false },
          tStep
        );
        curCellState.set(key, nextSt);
      }
    }

    // Hide previous pointers, draw current pointers
    if (prevPtrIdx >= 0 && stepPtrGroups[prevPtrIdx]) {
      for (const item of stepPtrGroups[prevPtrIdx]) {
        tl.fromTo(item.path, { autoAlpha: 1 }, { autoAlpha: 0, duration: fitDur(tStep, 0.12), immediateRender: false }, tStep);
        tl.fromTo(item.headPoly, { autoAlpha: 1 }, { autoAlpha: 0, duration: fitDur(tStep, 0.12), immediateRender: false }, tStep);
        if (item.pillEl) {
          tl.fromTo(item.pillEl, { autoAlpha: 1 }, { autoAlpha: 0, duration: fitDur(tStep, 0.12), immediateRender: false }, tStep);
        }
      }
    }
    if (stepPtrGroups[idx]?.length) {
      for (const item of stepPtrGroups[idx]) {
        tl.fromTo(item.path, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, immediateRender: false }, tStep);
        drawPath(tl, item.path, tStep, stepAnimDur, item.approxLen, EASE.reveal);
        const tHead = clampT(tStep + stepAnimDur * 0.6);
        tl.fromTo(item.headPoly, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tHead, 0.14), immediateRender: false }, tHead);
        if (item.pillEl) {
          tl.fromTo(item.pillEl, { autoAlpha: 0, y: 4 }, { autoAlpha: 1, y: 0, duration: fitDur(tStep + 0.04, 0.18), immediateRender: false }, clampT(tStep + 0.04));
        }
      }
      prevPtrIdx = idx;
    } else {
      prevPtrIdx = -1;
    }
  });
}
