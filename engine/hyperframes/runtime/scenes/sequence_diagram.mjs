// sequence_diagram — DOM/SVG + GSAP scene builder (HyperFrames composition).
// Protocol, RPC, auth handshake & async trace across 2..5 actors and 1..10 messages.
// Contract: deterministic tl.fromTo() tweens at absolute ctx.at(p); zero callbacks/randomness;
// all painted geometry strictly inside 1744x772 stage.

const STYLE_ID = "tvs-style-sequence-diagram";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CSS = `
.seq { position: absolute; inset: 0; }
.seq__head { position: absolute; left: 0; top: 0; right: 0; height: 40px; display: flex; align-items: center; gap: 16px; }
.seq__sub { font: 500 20px var(--tvs-font); color: #CBD5E1; white-space: pre; }
.tvs-scene--light .seq__sub { color: #334155; }
.seq__svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.seq__actor { position: absolute; border-radius: 14px; border: 2px solid; background: rgba(11, 20, 38, 0.94);
  display: flex; align-items: center; gap: 12px; padding: 0 16px; box-shadow: 0 10px 26px rgba(0,0,0,0.38); }
.tvs-scene--light .seq__actor { box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16); }
.seq__aicon { flex: none; width: 42px; height: 42px; border-radius: 11px; border: 1.5px solid; display: grid; place-items: center; }
.seq__atext { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
.seq__albl { font: 700 20px/24px var(--tvs-font); color: #F8FAFC; white-space: pre; }
.seq__asub { font: 600 14px/18px var(--tvs-mono); white-space: pre; }
.seq__pill { position: absolute; height: 30px; border-radius: 9px; border: 1.5px solid; padding: 0 12px;
  display: inline-flex; align-items: center; gap: 8px; background: rgba(9, 17, 34, 0.96); box-shadow: 0 6px 18px rgba(0,0,0,0.38); }
.tvs-scene--light .seq__pill { box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14); }
.seq__mbadge { flex: none; padding: 2px 7px; border-radius: 5px; font: 800 12px/15px var(--tvs-mono); color: #020A14; white-space: pre; }
.seq__mlbl { font: 700 16px/20px var(--tvs-font); color: #F8FAFC; white-space: pre; }
.seq__mdetail { position: absolute; text-align: center; font: 500 13.5px/17px var(--tvs-mono); color: #94A3B8; white-space: pre; }
.tvs-scene--light .seq__mdetail { color: #475569; }
.seq__hlzone { position: absolute; border-radius: 12px; border: 2px dashed; pointer-events: none; }
.seq__hlbar { position: absolute; left: 0; right: 0; bottom: 6px; height: 62px; border-radius: 14px; border: 2px solid;
  background: rgba(10, 22, 44, 0.96); display: flex; align-items: center; gap: 14px; padding: 0 22px; }
.tvs-scene--light .seq__hlbar { box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16); }
.seq__hltag { flex: none; height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center;
  font: 800 14px var(--tvs-mono); color: #020A14; white-space: pre; }
.seq__hltext { font: 600 20px/26px var(--tvs-font); color: #F8FAFC; white-space: pre; }
`;

const MSG_STYLE = {
  solid: { color: "#10C0F0", badgeBg: "#10C0F0", dash: null },
  dashed: { color: "#94A3B8", badgeBg: "#CBD5E1", dash: "9 6" },
  danger: { color: "#EF4444", badgeBg: "#EF4444", dash: null },
  async: { color: "#F59E0B", badgeBg: "#F59E0B", dash: "6 5" },
};

const HL_TONE = {
  danger: { border: "#EF4444", bg: "rgba(239, 68, 68, 0.10)", badge: "#EF4444", tag: "BOTTLENECK / LỖI" },
  warn: { border: "#F59E0B", bg: "rgba(245, 158, 11, 0.10)", badge: "#F59E0B", tag: "CẢNH BÁO" },
  info: { border: "#10C0F0", bg: "rgba(16, 192, 240, 0.10)", badge: "#10C0F0", tag: "LƯU Ý" },
  success: { border: "#10B981", bg: "rgba(16, 185, 129, 0.10)", badge: "#10B981", tag: "TỐI ƯU" },
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
  while (out.length > 1 && measure(`${out}…`, font) > maxW) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

function resolveMsgIndex(ref, messages) {
  if (ref === undefined || ref === null || ref === "") return -1;
  if (typeof ref === "number" && Number.isFinite(ref)) {
    if (ref >= 0 && ref < messages.length) return ref;
    if (ref >= 1 && ref <= messages.length) return ref - 1;
    return -1;
  }
  const s = String(ref).trim();
  const byId = messages.findIndex((m) => String(m?.id || "").trim() === s);
  if (byId >= 0) return byId;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 0 && n < messages.length) return n;
    if (n >= 1 && n <= messages.length) return n - 1;
  }
  return -1;
}

export default function buildSequenceDiagram(ctx) {
  const { tl, common, vd, stage, at } = ctx;
  const { el, svg, icon, getTone, drawPath, mark, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const W = STAGE.width;
  const H = STAGE.height;
  const sceneEnd = ctx.start + ctx.dur;
  const t0 = ctx.start;
  const clampT = (t) => Math.min(Math.max(t, t0), sceneEnd - 0.03);
  const fitDur = (t, d) => Math.max(0.02, Math.min(d, sceneEnd - 0.015 - t));
  const isLight = ctx.worldTheme === "light";

  const actors = (Array.isArray(vd.actors) ? vd.actors : []).slice(0, 5);
  const messages = (Array.isArray(vd.messages) ? vd.messages : []).slice(0, 10);
  const highlights = (Array.isArray(vd.highlights) ? vd.highlights : []).slice(0, 4);
  const hasHighlights = highlights.length > 0;

  const root = el("div.seq");

  // Header
  const badgeText = fitLine(vd.badge || "Sequence Trace", `700 18px ${FONT}`, 420);
  const head = el("div.seq__head", {}, el("div.tvs-badge", { text: badgeText }));
  if (vd.subtitle) {
    const badgeW = measure(badgeText, `700 18px ${FONT}`) + 44;
    const subAvail = Math.max(200, W - badgeW - 24);
    head.appendChild(el("div.seq__sub", { text: fitLine(vd.subtitle, `500 20px ${FONT}`, subAvail) }));
  }
  root.appendChild(head);

  if (!actors.length) {
    stage.appendChild(root);
    return;
  }

  // Geometry
  const padX = 36;
  const usableW = W - padX * 2;
  const colSpan = usableW / actors.length;
  const actorW = Math.min(286, Math.max(180, Math.floor(colSpan - 24)));
  const actorH = 82;
  const actorTop = 52;
  const lifelineTop = actorTop + actorH;
  const lifelineBottom = hasHighlights ? H - 82 : H - 14;
  const colCenter = (idx) => Math.round(padX + (idx + 0.5) * colSpan);
  const actorIndexById = new Map(actors.map((a, idx) => [String(a.id || ""), idx]));

  const msgTop = lifelineTop + 14;
  const msgBottom = lifelineBottom - 8;
  const rowStep = Math.min(78, Math.max(46, Math.floor((msgBottom - msgTop) / Math.max(1, messages.length))));

  // Background highlight zones layer (behind lifelines & arrows)
  const zoneLayer = el("div.seq__zones");
  root.appendChild(zoneLayer);

  // SVG layer for lifelines + animated arrows
  const svgNode = svg("svg", { class: "seq__svg", viewBox: `0 0 ${W} ${H}` });
  const lifelineColor = isLight ? "rgba(51, 65, 85, 0.36)" : "rgba(148, 163, 184, 0.28)";
  const lifelineEls = actors.map((a, idx) => {
    const cx = colCenter(idx);
    const line = svg("line", {
      x1: cx,
      y1: lifelineTop,
      x2: cx,
      y2: lifelineBottom,
      stroke: lifelineColor,
      "stroke-width": 2.2,
      "stroke-dasharray": "7 7",
    });
    svgNode.appendChild(line);
    return line;
  });

  // Actor cards
  const actorEls = actors.map((a, idx) => {
    const tone = getTone(a.tone || "blue");
    const cx = colCenter(idx);
    const x = Math.round(cx - actorW / 2);
    const textAvail = actorW - 16 - 42 - 12 - 16;
    const lbl = fitLine(a.label || a.id, `700 20px ${FONT}`, textAvail);
    const sub = a.sublabel ? fitLine(a.sublabel, `600 14px ${MONO}`, textAvail) : "";
    const card = el(
      "div.seq__actor",
      { style: { left: `${x}px`, top: `${actorTop}px`, width: `${actorW}px`, height: `${actorH}px`, borderColor: tone.border } },
      el("div.seq__aicon", { style: { background: tone.bg, borderColor: tone.border } }, icon(a.icon || "ec2", tone.text, 24)),
      el(
        "div.seq__atext",
        {},
        el("div.seq__albl", { text: lbl }),
        sub ? el("div.seq__asub", { text: sub, style: { color: tone.text } }) : null
      )
    );
    root.appendChild(card);
    return card;
  });

  root.appendChild(svgNode);

  // Messages
  const msgEls = messages.map((m, idx) => {
    const fromIdx = actorIndexById.get(String(m.from || "")) ?? 0;
    const toIdx = actorIndexById.get(String(m.to || "")) ?? fromIdx;
    const x1 = colCenter(fromIdx);
    const x2 = colCenter(toIdx);
    const rowTop = msgTop + idx * rowStep;
    const yArrow = Math.round(rowTop + Math.min(rowStep * 0.72, rowStep - (m.detail && rowStep >= 62 ? 18 : 8)));
    const st = MSG_STYLE[m.style] || MSG_STYLE.solid;
    const isSelf = fromIdx === toIdx;

    let pathD;
    let arrowPoly;
    let pillCenterX;
    let pillMaxW;

    if (isSelf) {
      const goLeft = fromIdx === actors.length - 1 && actors.length > 1;
      const loopW = 58;
      const dx = goLeft ? -loopW : loopW;
      const yA = yArrow - 12;
      const yB = yArrow + 10;
      pathD = `M ${x1} ${yA} L ${x1 + dx} ${yA} L ${x1 + dx} ${yB} L ${x1 + (goLeft ? -10 : 10)} ${yB}`;
      arrowPoly = goLeft
        ? `${x1 - 2},${yB} ${x1 - 13},${yB - 5} ${x1 - 13},${yB + 5}`
        : `${x1 + 2},${yB} ${x1 + 13},${yB - 5} ${x1 + 13},${yB + 5}`;
      pillCenterX = goLeft ? x1 - loopW - 140 : x1 + loopW + 140;
      pillMaxW = 280;
    } else {
      const dir = x2 > x1 ? 1 : -1;
      const xStart = x1 + dir * 4;
      const xEnd = x2 - dir * 12;
      pathD = `M ${xStart} ${yArrow} L ${xEnd} ${yArrow}`;
      const tipX = x2 - dir * 2;
      arrowPoly = `${tipX},${yArrow} ${tipX - dir * 13},${yArrow - 6} ${tipX - dir * 13},${yArrow + 6}`;
      pillCenterX = (x1 + x2) / 2;
      pillMaxW = Math.max(250, Math.min(640, Math.abs(x2 - x1) - 18));
    }

    const lineAttrs = {
      d: pathD,
      fill: "none",
      stroke: st.color,
      "stroke-width": m.style === "danger" ? 3.4 : 2.8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    };
    if (st.dash) lineAttrs["stroke-dasharray"] = st.dash;
    const arrowLine = svg("path", lineAttrs);
    const arrowHead = svg("polygon", { points: arrowPoly, fill: st.color });
    const srcDot = svg("circle", { cx: x1, cy: isSelf ? yArrow - 12 : yArrow, r: 5.5, fill: st.color });
    svgNode.append(arrowLine, arrowHead, srcDot);

    // Label pill
    const badgeStr = m.badge ? fitLine(m.badge, `800 12px ${MONO}`, 110) : "";
    const badgeNeedW = badgeStr ? measure(badgeStr, `800 12px ${MONO}`) + 22 : 0;
    const labelStr = fitLine(m.label || "", `700 16px ${FONT}`, Math.max(90, pillMaxW - 28 - badgeNeedW));
    const pillTextW = measure(labelStr, `700 16px ${FONT}`);
    const pillW = Math.min(pillMaxW, Math.ceil(28 + badgeNeedW + pillTextW));
    const pillLeft = Math.max(14, Math.min(W - pillW - 14, Math.round(pillCenterX - pillW / 2)));
    const pillTop = Math.max(lifelineTop + 4, yArrow - 34);

    const pill = el(
      "div.seq__pill",
      {
        style: {
          left: `${pillLeft}px`,
          top: `${pillTop}px`,
          width: `${pillW}px`,
          borderColor: st.color,
        },
      },
      badgeStr ? el("span.seq__mbadge", { text: badgeStr, style: { background: st.badgeBg } }) : null,
      el("span.seq__mlbl", { text: labelStr })
    );
    root.appendChild(pill);

    let detailEl = null;
    if (m.detail && rowStep >= 62) {
      const detStr = fitLine(m.detail, `500 13.5px ${MONO}`, Math.max(200, pillMaxW + 40));
      const detW = Math.min(W - 28, Math.ceil(measure(detStr, `500 13.5px ${MONO}`) + 16));
      const detLeft = Math.max(14, Math.min(W - detW - 14, Math.round(pillCenterX - detW / 2)));
      detailEl = el("div.seq__mdetail", {
        text: detStr,
        style: { left: `${detLeft}px`, top: `${yArrow + 5}px`, width: `${detW}px` },
      });
      root.appendChild(detailEl);
    }

    return {
      m,
      idx,
      ps: mark(m.progress_start, idx / Math.max(1, messages.length)),
      pe: mark(m.progress_end, (idx + 1) / Math.max(1, messages.length)),
      arrowLine,
      arrowHead,
      srcDot,
      pill,
      detailEl,
      isDashed: Boolean(st.dash),
      pathLen: isSelf ? 140 : Math.max(20, Math.abs(x2 - x1)),
    };
  });

  // Highlights (zone boxes + bottom banner)
  const hlEls = highlights.map((hl, hi) => {
    const ht = HL_TONE[hl.tone] || HL_TONE.info;
    let zoneBox = null;
    const i0 = resolveMsgIndex(hl.from_msg, messages);
    const i1 = resolveMsgIndex(hl.to_msg, messages);
    if (i0 >= 0 || i1 >= 0) {
      const a = i0 >= 0 ? i0 : i1;
      const b = i1 >= 0 ? i1 : i0;
      const lo = Math.min(a, b);
      const hiIdx = Math.max(a, b);
      const zTop = Math.max(lifelineTop + 2, msgTop + lo * rowStep + 2);
      const zBot = Math.min(lifelineBottom - 2, msgTop + (hiIdx + 1) * rowStep - 2);
      zoneBox = el("div.seq__hlzone", {
        style: {
          left: "16px",
          top: `${zTop}px`,
          width: `${W - 32}px`,
          height: `${Math.max(36, zBot - zTop)}px`,
          borderColor: ht.border,
          background: ht.bg,
        },
      });
      zoneLayer.appendChild(zoneBox);
    }

    const tagW = measure(ht.tag, `800 14px ${MONO}`) + 28;
    const textAvail = Math.max(240, W - 44 - tagW - 24);
    const bar = el(
      "div.seq__hlbar",
      { style: { borderColor: ht.border } },
      el("div.seq__hltag", { text: ht.tag, style: { background: ht.badge } }),
      el("div.seq__hltext", { text: fitLine(hl.label || "", `600 20px ${FONT}`, textAvail) })
    );
    root.appendChild(bar);
    return {
      hl,
      idx: hi,
      showAt: mark(hl.show_at_progress, 0.72 + hi * 0.06),
      zoneBox,
      bar,
    };
  });

  stage.appendChild(root);

  // ---- Deterministic Timeline ----
  const mech = ctx.mechanic || "blur-materialize";
  common.reveal(tl, head, t0 + 0.04, { y: -10, mechanic: mech });
  actorEls.forEach((card, i) => {
    common.reveal(tl, card, clampT(t0 + 0.06 + i * DUR.stagger), { y: -12, mechanic: mech });
  });
  lifelineEls.forEach((ln, i) => {
    tl.fromTo(
      ln,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: fitDur(clampT(t0 + 0.1 + i * 0.03), 0.24), ease: EASE.reveal },
      clampT(t0 + 0.1 + i * 0.03)
    );
  });

  let prevMsgT = t0 + 0.14;
  msgEls.forEach((me, i) => {
    const tMsg = clampT(Math.max(at(me.ps), prevMsgT + 0.04));
    prevMsgT = tMsg;
    const spanSec = Math.max(0.18, at(me.pe) - tMsg);
    const drawDur = fitDur(tMsg + 0.02, Math.min(0.32, Math.max(0.14, spanSec * 0.55)));

    tl.fromTo(me.srcDot, { autoAlpha: 0, scale: 0.2, transformOrigin: "50% 50%" }, { autoAlpha: 1, scale: 1, transformOrigin: "50% 50%", duration: fitDur(tMsg, 0.16), ease: EASE.spring }, tMsg);
    if (me.isDashed) {
      tl.fromTo(me.arrowLine, { autoAlpha: 0 }, { autoAlpha: 1, duration: drawDur, ease: EASE.reveal }, tMsg + 0.02);
    } else {
      tl.fromTo(me.arrowLine, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, ease: "none" }, tMsg + 0.02);
      drawPath(tl, me.arrowLine, tMsg + 0.02, drawDur, me.pathLen, EASE.reveal);
    }
    const tHead = clampT(tMsg + 0.02 + drawDur * 0.65);
    tl.fromTo(me.arrowHead, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tHead, 0.14), ease: EASE.reveal }, tHead);
    tl.fromTo(me.pill, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: fitDur(tMsg + 0.04, 0.22), ease: EASE.reveal }, clampT(tMsg + 0.04));
    if (me.detailEl) {
      tl.fromTo(me.detailEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tHead, 0.18), ease: EASE.reveal }, tHead);
    }
  });

  let prevBar = null;
  let prevBarEndT = t0 + 0.2;
  hlEls.forEach((he) => {
    const tHl = clampT(Math.max(at(he.showAt), prevBarEndT + 0.02));
    const hlDur = fitDur(tHl, 0.24);
    prevBarEndT = tHl + hlDur;
    if (he.zoneBox) {
      tl.fromTo(he.zoneBox, { autoAlpha: 0 }, { autoAlpha: 1, duration: hlDur, ease: EASE.reveal }, tHl);
    }
    if (prevBar) {
      tl.fromTo(prevBar, { autoAlpha: 1 }, { autoAlpha: 0, duration: fitDur(tHl, 0.12), ease: EASE.exit, immediateRender: false }, tHl);
    }
    tl.fromTo(he.bar, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: hlDur, ease: EASE.reveal }, tHl);
    prevBar = he.bar;
  });
}
