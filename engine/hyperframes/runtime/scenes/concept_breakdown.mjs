// concept_breakdown — DOM/SVG + GSAP scene builder (HyperFrames composition).
// Hub-and-branches mental model diagram (anatomy | decision | chapter) with central Core,
// 2..6 progressive branches connected via deterministic SVG curves, and optional Takeaway bar.

const STYLE_ID = "tvs-style-concept-breakdown";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CSS = `
.cbd { position: absolute; inset: 0; }
.cbd__head { position: absolute; left: 0; top: 0; right: 0; height: 42px; display: flex; align-items: center; gap: 16px; }
.cbd__sub { font: 500 20px var(--tvs-font); color: #CBD5E1; white-space: pre; flex: 1 1 auto; min-width: 0; }
.tvs-scene--light .cbd__sub { color: #334155; }
.cbd__svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.cbd__core { position: absolute; border-radius: 20px; border: 2.5px solid;
  background: linear-gradient(180deg, rgba(14, 28, 56, 0.96) 0%, rgba(9, 17, 34, 0.94) 100%);
  padding: 20px 24px; display: flex; flex-direction: column; justify-content: center; gap: 10px;
  box-shadow: 0 18px 42px rgba(0,0,0,0.45); }
.tvs-scene--light .cbd__core { box-shadow: 0 18px 40px rgba(15, 23, 42, 0.20); }
.cbd__cbadge { align-self: flex-start; padding: 4px 12px; border-radius: 8px; border: 1.2px solid;
  font: 800 13px/16px var(--tvs-mono); letter-spacing: 0.04em; white-space: pre; }
.cbd__clbl { font: 800 26px/33px var(--tvs-font); color: #F8FAFC; }
.cbd__csub { font: 500 17.5px/23px var(--tvs-font); color: #CBD5E1; }
.cbd__ccode { padding: 10px 14px; border-radius: 10px; background: #040812; border: 1px solid rgba(148,163,184,0.22);
  font: 600 14.5px/20px var(--tvs-mono); color: #90E0F0; white-space: pre; }
.cbd__branch { position: absolute; border-radius: 16px; border: 2px solid;
  background: rgba(9, 17, 34, 0.92); padding: 14px 20px; display: flex; flex-direction: column; justify-content: center; gap: 6px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.36); }
.tvs-scene--light .cbd__branch { box-shadow: 0 14px 32px rgba(15, 23, 42, 0.16); }
.cbd__bhead { display: flex; align-items: center; gap: 10px; }
.cbd__brole { flex: none; padding: 3px 10px; border-radius: 8px; border: 1.2px solid;
  font: 800 13px/16px var(--tvs-mono); white-space: pre; }
.cbd__blbl { font: 700 21px/26px var(--tvs-font); color: #F8FAFC; white-space: pre; flex: 1 1 auto; min-width: 0; }
.cbd__bdet { font: 500 17px/22px var(--tvs-font); color: #CBD5E1; }
.cbd__bex { align-self: flex-start; padding: 4px 11px; border-radius: 8px; background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.28); font: 600 14px/18px var(--tvs-mono); color: #90E0F0; white-space: pre; }
.cbd__line { white-space: pre; }
.cbd__takeaway { position: absolute; left: 0; right: 0; bottom: 4px; height: 64px; border-radius: 15px; border: 2px solid #10C0F0;
  background: rgba(10, 32, 58, 0.95); display: flex; align-items: center; gap: 16px; padding: 0 24px; }
.tvs-scene--light .cbd__takeaway { box-shadow: 0 14px 32px rgba(15, 23, 42, 0.18); }
.cbd__tlabel { flex: none; font: 800 17px var(--tvs-font); color: #10C0F0; white-space: pre; }
.cbd__ttext { font: 600 19.5px/25px var(--tvs-font); color: #F8FAFC; white-space: pre; }
`;

const MODE_BADGES = {
  anatomy: "Concept Anatomy",
  decision: "Decision Matrix",
  chapter: "Chapter Overview",
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

function wrapText(text, font, width, maxLines) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  let truncated = false;
  for (let i = 0; i < words.length; i++) {
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
    if (truncated) break;
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

export default function buildConceptBreakdown(ctx) {
  const { tl, common, vd, stage, at } = ctx;
  const { el, svg, getTone, drawPath, mark, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const W = STAGE.width;
  const H = STAGE.height;
  const sceneEnd = ctx.start + ctx.dur;
  const t0 = ctx.start;
  const clampT = (t) => Math.min(Math.max(t, t0), sceneEnd - 0.03);
  const fitDur = (t, d) => Math.max(0.02, Math.min(d, sceneEnd - 0.015 - t));
  const isLight = ctx.worldTheme === "light";

  const mode = MODE_BADGES[vd.mode] ? vd.mode : "anatomy";
  const core = vd.core && typeof vd.core === "object" ? vd.core : { label: "Core Concept" };
  const branches = (Array.isArray(vd.branches) ? vd.branches : [])
    .slice(0, 6)
    .map((b, i) => ({ ...b, idx: i, ps: mark(b?.progress_start, i / 6), pe: mark(b?.progress_end, (i + 1) / 6) }));
  const takeaway = vd.takeaway && vd.takeaway.text ? vd.takeaway : null;

  const root = el("div.cbd");

  // Header
  const badgeStr = fitLine(vd.badge || MODE_BADGES[mode], `700 18px ${FONT}`, 380);
  const head = el("div.cbd__head", {}, el("div.tvs-badge", { text: badgeStr }));
  if (vd.subtitle) {
    const badgeW = measure(badgeStr, `700 18px ${FONT}`) + 44;
    head.appendChild(el("div.cbd__sub", { text: fitLine(vd.subtitle, `500 20px ${FONT}`, Math.max(200, W - badgeW - 24)) }));
  }
  root.appendChild(head);

  const mainTop = 54;
  const mainBottom = takeaway ? H - 82 : H - 12;
  const mainH = mainBottom - mainTop;
  const n = branches.length;
  const bilateral = n >= 4;

  // Core card geometry
  const coreW = bilateral ? 460 : 500;
  const coreX = bilateral ? Math.round((W - coreW) / 2) : 0;
  const codeLines = core.code_snippet ? String(core.code_snippet).split("\n").slice(0, 5) : [];
  const coreInnerW = coreW - 48;
  const coreLblLines = wrapText(core.label || "", `800 26px ${FONT}`, coreInnerW, 3);
  const coreSubLines = core.sublabel ? wrapText(core.sublabel, `500 17.5px ${FONT}`, coreInnerW, 3) : [];
  const estCoreH =
    44 +
    (core.badge ? 34 : 0) +
    coreLblLines.length * 33 +
    (coreSubLines.length ? coreSubLines.length * 23 + 8 : 0) +
    (codeLines.length ? codeLines.length * 20 + 28 : 0) +
    20;
  const coreH = Math.min(mainH - 16, Math.max(200, estCoreH));
  const coreY = mainTop + Math.round((mainH - coreH) / 2);
  const coreCy = coreY + coreH / 2;

  const coreTone = getTone(core.tone || "blue");
  const coreEl = el(
    "div.cbd__core",
    {
      style: {
        left: `${coreX}px`,
        top: `${coreY}px`,
        width: `${coreW}px`,
        height: `${coreH}px`,
        borderColor: coreTone.border,
      },
    },
    core.badge
      ? el("div.cbd__cbadge", {
          text: fitLine(core.badge, `800 13px ${MONO}`, coreInnerW),
          style: { background: coreTone.bg, borderColor: coreTone.border, color: coreTone.text },
        })
      : null,
    el("div.cbd__clbl", {}, coreLblLines.map((l) => el("div.cbd__line", { text: l }))),
    coreSubLines.length ? el("div.cbd__csub", {}, coreSubLines.map((l) => el("div.cbd__line", { text: l }))) : null,
    codeLines.length
      ? el("div.cbd__ccode", {
          text: codeLines.map((l) => fitLine(l, `600 14.5px ${MONO}`, coreInnerW - 28)).join("\n"),
        })
      : null
  );

  // SVG connectors layer
  const connSvg = svg("svg", { class: "cbd__svg", viewBox: `0 0 ${W} ${H}` });
  root.appendChild(connSvg);
  root.appendChild(coreEl);

  // Branch positions
  const branchItems = [];
  const placeColumn = (list, x, w, isLeftCol) => {
    const gap = 16;
    const cardH = Math.min(240, Math.floor((mainH - gap * Math.max(0, list.length - 1)) / Math.max(1, list.length)));
    const totalColH = list.length * cardH + Math.max(0, list.length - 1) * gap;
    const colTop = mainTop + Math.round((mainH - totalColH) / 2);
    const detPx = cardH < 175 ? 15.5 : 17;
    const detLh = cardH < 175 ? 20 : 22;
    const detMaxLines = cardH >= 195 ? 3 : 2;
    const innerW = w - 40;

    list.forEach((b, posIdx) => {
      const y = colTop + posIdx * (cardH + gap);
      const tone = getTone(b.tone || "blue");
      const roleStr = b.role_badge
        ? fitLine(b.role_badge, `800 13px ${MONO}`, 180)
        : mode === "decision"
          ? `CASE ${b.idx + 1}`
          : mode === "chapter"
            ? `CH ${String(b.idx + 1).padStart(2, "0")}`
            : `0${b.idx + 1}`;
      const roleW = measure(roleStr, `800 13px ${MONO}`) + 24;
      const lblStr = fitLine(b.label || "", `700 21px ${FONT}`, Math.max(100, innerW - roleW - 12));
      const detLines = wrapText(b.detail || "", `500 ${detPx}px ${FONT}`, innerW, detMaxLines);

      const card = el(
        "div.cbd__branch",
        {
          style: {
            left: `${x}px`,
            top: `${y}px`,
            width: `${w}px`,
            height: `${cardH}px`,
            borderColor: "rgba(148, 163, 184, 0.28)",
          },
        },
        el(
          "div.cbd__bhead",
          {},
          el("span.cbd__brole", {
            text: roleStr,
            style: { background: tone.bg, borderColor: tone.border, color: tone.text },
          }),
          el("div.cbd__blbl", { text: lblStr })
        ),
        el(
          "div.cbd__bdet",
          { style: { fontSize: `${detPx}px`, lineHeight: `${detLh}px` } },
          detLines.map((l) => el("div.cbd__line", { text: l }))
        ),
        b.example && cardH >= 148
          ? el("div.cbd__bex", { text: fitLine(b.example, `600 14px ${MONO}`, innerW - 24) })
          : null
      );
      root.appendChild(card);

      // SVG Bezier connector from Core to Branch
      const brCy = y + cardH / 2;
      const sx = isLeftCol ? coreX : coreX + coreW;
      const ex = isLeftCol ? x + w : x;
      const midX = (sx + ex) / 2;
      const d = `M ${sx} ${coreCy} C ${midX} ${coreCy}, ${midX} ${brCy}, ${ex} ${brCy}`;
      const baseColor = isLight ? "rgba(71, 85, 105, 0.35)" : "rgba(148, 163, 184, 0.28)";
      const connBase = svg("path", { d, fill: "none", stroke: baseColor, "stroke-width": 2.4, "stroke-dasharray": "6 6" });
      const connActive = svg("path", { d, fill: "none", stroke: tone.border, "stroke-width": 3.4, "stroke-linecap": "round" });
      const endDot = svg("circle", { cx: ex, cy: brCy, r: 5.5, fill: tone.border });
      connSvg.append(connBase, connActive, endDot);

      branchItems.push({
        b,
        card,
        tone,
        connBase,
        connActive,
        endDot,
        approxLen: Math.max(40, Math.hypot(ex - sx, brCy - coreCy) * 1.2),
      });
    });
  };

  if (bilateral) {
    const leftCount = Math.ceil(n / 2);
    const sideW = 552;
    placeColumn(branches.slice(0, leftCount), 6, sideW, true);
    placeColumn(branches.slice(leftCount), W - sideW - 6, sideW, false);
  } else {
    const rightX = coreW + 84;
    placeColumn(branches, rightX, W - rightX - 6, false);
  }
  branchItems.sort((a, b) => a.b.idx - b.b.idx);

  let takeawayEl = null;
  if (takeaway) {
    const tLbl = fitLine(takeaway.label || "💡 Tổng kết", `800 17px ${FONT}`, 260);
    const tLblW = measure(tLbl, `800 17px ${FONT}`) + 24;
    takeawayEl = el(
      "div.cbd__takeaway",
      {},
      el("div.cbd__tlabel", { text: tLbl }),
      el("div.cbd__ttext", { text: fitLine(takeaway.text, `600 19.5px ${FONT}`, Math.max(240, W - 48 - tLblW)) })
    );
    root.appendChild(takeawayEl);
  }

  stage.appendChild(root);

  // ---- Deterministic Timeline ----
  const mech = ctx.mechanic || "blur-materialize";
  common.reveal(tl, head, t0 + 0.04, { y: -10, mechanic: mech });
  common.reveal(tl, coreEl, t0 + 0.06, { y: 12, mechanic: mech });

  branchItems.forEach((bi) => {
    tl.fromTo(bi.card, { opacity: 0.16, scale: 0.97 }, { opacity: 0.16, scale: 0.97, duration: 0.001 }, t0);
    tl.fromTo(bi.connActive, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
    tl.fromTo(bi.endDot, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
    tl.fromTo(bi.connBase, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: EASE.reveal }, t0 + 0.08);
  });
  if (takeawayEl) {
    tl.fromTo(takeawayEl, { autoAlpha: 0, y: 12 }, { autoAlpha: 0, y: 12, duration: 0.001 }, t0);
  }

  let prevEndT = t0 + 0.10;
  let prevBranch = null;

  branchItems.forEach((bi) => {
    const tBr = clampT(Math.max(at(bi.b.ps), prevEndT + 0.02));
    const brDur = fitDur(tBr, 0.26);
    prevEndT = tBr + brDur;

    if (prevBranch) {
      tl.fromTo(
        prevBranch.card,
        { borderColor: prevBranch.tone.border, scale: 1.015 },
        { borderColor: "rgba(148, 163, 184, 0.34)", scale: 1, duration: fitDur(tBr, 0.18), ease: EASE.reveal, immediateRender: false },
        tBr
      );
    }

    tl.fromTo(
      bi.card,
      { opacity: 0.16, scale: 0.97, borderColor: "rgba(148, 163, 184, 0.28)" },
      { opacity: 1, scale: 1.015, borderColor: bi.tone.border, duration: brDur, ease: EASE.reveal, immediateRender: false },
      tBr
    );
    tl.fromTo(bi.connActive, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, immediateRender: false }, tBr);
    drawPath(tl, bi.connActive, tBr, brDur, bi.approxLen, EASE.reveal);
    tl.fromTo(bi.endDot, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tBr + brDur * 0.5, 0.14), immediateRender: false }, clampT(tBr + brDur * 0.5));
    prevBranch = bi;
  });

  if (takeawayEl) {
    const tTake = clampT(Math.max(at(mark(takeaway.show_at_progress, 0.80)), prevEndT + 0.02));
    if (prevBranch) {
      tl.fromTo(
        prevBranch.card,
        { borderColor: prevBranch.tone.border, scale: 1.015 },
        { borderColor: "rgba(148, 163, 184, 0.34)", scale: 1, duration: fitDur(tTake, 0.18), immediateRender: false },
        tTake
      );
    }
    tl.fromTo(
      takeawayEl,
      { autoAlpha: 0, y: 12 },
      { autoAlpha: 1, y: 0, duration: fitDur(tTake, 0.26), ease: EASE.reveal, immediateRender: false },
      tTake
    );
  }
}
