// code_diff — DOM + GSAP scene builder (HyperFrames composition).
// Side-by-side Shiki-highlighted code diff (1..16 lines/side) with progressive focus_steps,
// consequence/fix_reason badges, and Light/Dark theme support inside 1744x772 stage.

const STYLE_ID = "tvs-style-code-diff";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CSS = `
.diff { position: absolute; inset: 0; }
.diff__head { position: absolute; left: 0; top: 0; right: 0; height: 42px; display: flex; align-items: center; gap: 16px; }
.diff__sub { font: 500 20px var(--tvs-font); color: #CBD5E1; white-space: pre; flex: 1 1 auto; min-width: 0; }
.tvs-scene--light .diff__sub { color: #334155; }
.diff__lang { flex: none; height: 32px; line-height: 29px; padding: 0 12px; border-radius: 8px;
  background: rgba(42, 98, 255, 0.2); border: 1.5px solid rgba(16, 192, 240, 0.5);
  color: #90E0F0; font: 800 15px var(--tvs-mono); white-space: pre; }
.tvs-scene--light .diff__lang { background: rgba(42, 98, 255, 0.12); color: #1D4ED8; border-color: #2A62FF; }
.diff__pane { position: absolute; top: 50px; height: 604px; border-radius: 16px; overflow: hidden;
  background: #060C18; border: 2px solid rgba(148, 163, 184, 0.24); box-shadow: 0 18px 42px rgba(0,0,0,0.45); }
.tvs-scene--light .diff__pane { box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18); }
.diff__glow { position: absolute; inset: 0; border-radius: 14px; border: 2.5px solid; pointer-events: none; z-index: 6; }
.diff__phead { position: absolute; left: 0; right: 0; top: 0; height: 50px; padding: 0 18px;
  display: flex; align-items: center; gap: 12px; background: #0F1A2E; border-bottom: 1px solid rgba(148,163,184,0.18); }
.diff__pbadge { flex: none; height: 26px; padding: 0 10px; border-radius: 7px; font: 800 13px/26px var(--tvs-mono);
  letter-spacing: 0.04em; white-space: pre; }
.diff__pbadge--left { background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #FCA5A5; }
.diff__pbadge--right { background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.5); color: #6EE7B7; }
.diff__ptitle { flex: 1 1 auto; min-width: 0; font: 700 19px var(--tvs-font); color: #F8FAFC; white-space: pre; }
.diff__body { position: absolute; left: 0; right: 0; top: 50px; bottom: 0; overflow: hidden; }
.diff__gutter { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(15, 26, 46, 0.55); border-right: 1px solid rgba(148,163,184,0.12); }
.diff__hl { position: absolute; left: 4px; right: 4px; border-radius: 6px; pointer-events: none; }
.diff__hl-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 3px; }
.diff__line { position: absolute; left: 0; right: 0; font-family: var(--tvs-mono); font-weight: 500; font-variant-ligatures: none; }
.diff__row { position: relative; white-space: pre; }
.diff__ln { position: absolute; left: 0; text-align: right; color: #64748B; }
.diff__src { position: absolute; top: 0; white-space: pre; }
.diff__vs { position: absolute; left: 854px; top: 334px; width: 36px; height: 36px; border-radius: 50%;
  background: #0F172A; border: 2px solid #10C0F0; color: #90E0F0; display: grid; place-items: center;
  font: 800 18px var(--tvs-mono); z-index: 8; box-shadow: 0 6px 18px rgba(0,0,0,0.45); }
.diff__foot { position: absolute; left: 0; right: 0; bottom: 4px; height: 102px; border-radius: 16px;
  border: 1.8px solid rgba(16, 192, 240, 0.4); background: rgba(9, 17, 34, 0.95); }
.tvs-scene--light .diff__foot { box-shadow: 0 14px 32px rgba(15, 23, 42, 0.16); }
.diff__fpanel { position: absolute; inset: 0; padding: 14px 22px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
.diff__ftop { display: flex; align-items: center; gap: 12px; }
.diff__fstep { flex: none; padding: 3px 10px; border-radius: 8px; font: 800 13.5px/18px var(--tvs-mono);
  background: rgba(16, 192, 240, 0.18); border: 1.2px solid #10C0F0; color: #90E0F0; white-space: pre; }
.diff__fcall { font: 700 20px/25px var(--tvs-font); color: #F8FAFC; white-space: pre; }
.diff__fmeta { display: flex; align-items: center; gap: 14px; }
.diff__fchip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 8px;
  font: 600 15.5px/20px var(--tvs-font); white-space: pre; border: 1.2px solid; }
.diff__fchip--danger { background: rgba(239, 68, 68, 0.14); border-color: rgba(239, 68, 68, 0.45); color: #FECACA; }
.diff__fchip--success { background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.45); color: #A7F3D0; }
`;

const FG = "#A9B1D6";
const TONE_ACCENT = {
  danger: { bar: "#EF4444", bg: "rgba(239, 68, 68, 0.16)", border: "rgba(239, 68, 68, 0.72)" },
  success: { bar: "#10B981", bg: "rgba(16, 185, 129, 0.16)", border: "rgba(16, 185, 129, 0.72)" },
  info: { bar: "#10C0F0", bg: "rgba(16, 192, 240, 0.14)", border: "rgba(16, 192, 240, 0.70)" },
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

function monoCharWidth(fontPx, monoStack) {
  const w = measure("0".repeat(20), `500 ${fontPx}px ${monoStack}`) / 20;
  return w > 0 ? w : fontPx * 0.6;
}

function wrapTokenLine(tokens, cap) {
  const total = tokens.reduce((n, tk) => n + tk.t.length, 0);
  if (total <= cap) return [tokens.map((tk) => ({ ...tk }))];
  const rows = [[]];
  let width = 0;
  const push = (t, c, s) => {
    const row = rows[rows.length - 1];
    const prev = row[row.length - 1];
    if (prev && prev.c === c && prev.s === s) prev.t += t;
    else row.push({ t, c, s });
    width += t.length;
  };
  const newRow = () => {
    rows.push([]);
    width = 0;
  };
  for (const tk of tokens) {
    for (const part of tk.t.split(/(\s+)/)) {
      if (!part) continue;
      if (width + part.length <= cap) push(part, tk.c, tk.s);
      else if (/^\s+$/.test(part)) {
        if (width > 0) newRow();
      } else if (part.length <= cap) {
        if (width > 0) newRow();
        push(part, tk.c, tk.s);
      } else {
        for (const ch of part) {
          if (width + 1 > cap && width > 0) newRow();
          push(ch, tk.c, tk.s);
        }
      }
    }
  }
  return rows.filter((r, i) => i === 0 || r.length);
}

function toLineArray(val) {
  if (Array.isArray(val)) return val.map((x) => String(x ?? ""));
  if (typeof val === "string") return val.split("\n");
  return [];
}

export default function buildCodeDiff(ctx) {
  const { tl, common, vd, stage, at, scene } = ctx;
  const { el, mark, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const W = STAGE.width;
  const H = STAGE.height;
  const sceneEnd = ctx.start + ctx.dur;
  const t0 = ctx.start;
  const clampT = (t) => Math.min(Math.max(t, t0), sceneEnd - 0.03);
  const fitDur = (t, d) => Math.max(0.02, Math.min(d, sceneEnd - 0.015 - t));

  const compiled = scene.code_diff || {};
  const lang = String(compiled.lang || vd.language || vd.code_language || "json").toUpperCase();
  const leftLines = (compiled.left_lines?.length ? compiled.left_lines : toLineArray(vd.left_lines)).slice(0, 16);
  const rightLines = (compiled.right_lines?.length ? compiled.right_lines : toLineArray(vd.right_lines)).slice(0, 16);
  const leftTokens = Array.isArray(compiled.left_tokens) ? compiled.left_tokens : null;
  const rightTokens = Array.isArray(compiled.right_tokens) ? compiled.right_tokens : null;
  const steps = (Array.isArray(vd.focus_steps) ? vd.focus_steps : [])
    .slice(0, 6)
    .map((s, i) => ({ ...s, idx: i, ps: mark(s?.progress_start, i / 6), pe: mark(s?.progress_end, (i + 1) / 6) }));

  const root = el("div.diff");

  // Header
  const badgeStr = fitLine(vd.badge || "Code Diff · Before vs After", `700 18px ${FONT}`, 420);
  const head = el("div.diff__head", {}, el("div.tvs-badge", { text: badgeStr }));
  if (vd.subtitle) {
    const badgeW = measure(badgeStr, `700 18px ${FONT}`) + 44;
    const subAvail = Math.max(200, W - badgeW - 160);
    head.appendChild(el("div.diff__sub", { text: fitLine(vd.subtitle, `500 20px ${FONT}`, subAvail) }));
  }
  head.appendChild(el("div.diff__lang", { text: fitLine(lang, `800 15px ${MONO}`, 110) }));
  root.appendChild(head);

  const paneW = 856;
  const paneH = 604;
  const bodyH = paneH - 50;
  const PAD_T = 12;
  const availH = bodyH - PAD_T - 12;

  const toTokLines = (lines, tokens) =>
    lines.map((line, idx) => {
      const raw = Array.isArray(tokens?.[idx]) ? tokens[idx] : null;
      return raw
        ? raw.map((tk) => ({ t: String(tk?.t ?? "").replace(/\t/g, "  "), c: tk?.c || FG, s: Number(tk?.s) || 0 })).filter((tk) => tk.t.length)
        : String(line ?? "")
          ? [{ t: String(line).replace(/\t/g, "  "), c: FG, s: 0 }]
          : [];
    });

  const leftTokLines = toTokLines(leftLines, leftTokens);
  const rightTokLines = toTokLines(rightLines, rightTokens);

  // Adaptive font fitting both panes cleanly inside 526px
  const candidates = [20, 18.5, 17, 15.5, 14, 13];
  let chosen = null;
  for (const cand of candidates) {
    const lineH = Math.round(cand * 1.44);
    const gw = Math.max(44, Math.round(cand * 2.55));
    const cap = Math.max(16, Math.floor((paneW - gw - 28) / monoCharWidth(cand, MONO)));
    const wL = leftTokLines.map((toks) => wrapTokenLine(toks, cap));
    const wR = rightTokLines.map((toks) => wrapTokenLine(toks, cap));
    const rowsL = wL.reduce((s, r) => s + r.length, 0);
    const rowsR = wR.reduce((s, r) => s + r.length, 0);
    const maxRows = Math.max(rowsL, rowsR);
    const wraps = wL.some((r) => r.length > 1) || wR.some((r) => r.length > 1);
    const fits = maxRows * lineH <= availH;
    chosen = { fp: cand, lineH, gw, wL, wR, fits, wraps };
    if (fits && !wraps) break;
    if (fits && cand <= 17) break;
  }

  const { fp, lineH, gw, wL, wR } = chosen;

  function buildPane(side, x, badgeText, titleText, wrappedLines) {
    const isLeft = side === "left";
    const pane = el("div.diff__pane", { style: { left: `${x}px`, width: `${paneW}px` } });
    const glow = el("div.diff__glow", {
      style: {
        borderColor: isLeft ? "rgba(239, 68, 68, 0.72)" : "rgba(16, 185, 129, 0.72)",
      },
    });
    const bStr = fitLine(badgeText || (isLeft ? "BEFORE" : "AFTER"), `800 13px ${MONO}`, 160);
    const bW = measure(bStr, `800 13px ${MONO}`) + 28;
    const tStr = fitLine(titleText || (isLeft ? "Before" : "After"), `700 19px ${FONT}`, paneW - 48 - bW);
    const phead = el(
      "div.diff__phead",
      {},
      el(`span.diff__pbadge.${isLeft ? "diff__pbadge--left" : "diff__pbadge--right"}`, { text: bStr }),
      el("span.diff__ptitle", { text: tStr })
    );
    const body = el("div.diff__body");
    const gutter = el("div.diff__gutter", { style: { width: `${gw}px` } });
    const hlLayer = el("div");
    const codeLayer = el("div");

    let rowCursor = 0;
    const lineItems = wrappedLines.map((rows, li) => {
      const top = PAD_T + rowCursor * lineH;
      const lineHTotal = rows.length * lineH;
      const hlBox = el("div.diff__hl", {
        style: { top: `${top}px`, height: `${lineHTotal}px`, backgroundColor: "transparent" },
      });
      const hlBar = el("div.diff__hl-bar", { style: { backgroundColor: "transparent" } });
      hlBox.appendChild(hlBar);
      hlLayer.appendChild(hlBox);

      const lineEl = el("div.diff__line", { style: { top: `${top}px`, height: `${lineHTotal}px`, fontSize: `${fp}px` } });
      rows.forEach((row, ri) => {
        const rowEl = el("div.diff__row", { style: { height: `${lineH}px`, lineHeight: `${lineH}px` } });
        if (ri === 0) {
          rowEl.appendChild(el("span.diff__ln", { text: String(li + 1), style: { width: `${gw - 10}px` } }));
        }
        const src = el("span.diff__src", { style: { left: `${gw + 12}px` } });
        row.forEach((tk) => {
          const st = { color: tk.c || FG };
          if (tk.s & 1) st.fontStyle = "italic";
          if (tk.s & 2) st.fontWeight = "700";
          src.appendChild(el("span", { text: tk.t, style: st }));
        });
        rowEl.appendChild(src);
        lineEl.appendChild(rowEl);
      });
      codeLayer.appendChild(lineEl);
      rowCursor += rows.length;
      return { lineEl, hlBox, hlBar, op: 1, hlTone: "none" };
    });

    body.append(gutter, hlLayer, codeLayer);
    pane.append(phead, body, glow);
    root.appendChild(pane);
    return { pane, glow, lineItems };
  }

  const leftPane = buildPane("left", 0, vd.left_badge || "BEFORE", vd.left_title, wL);
  const rightPane = buildPane("right", 888, vd.right_badge || "AFTER", vd.right_title, wR);
  const vsPill = el("div.diff__vs", { text: "→" });
  root.appendChild(vsPill);

  // Bottom callout foot
  const foot = el("div.diff__foot");
  const stepPanels = steps.map((st, idx) => {
    const stepTag = `FOCUS ${idx + 1}/${steps.length}`;
    const tagW = measure(stepTag, `800 13.5px ${MONO}`) + 28;
    const callText = fitLine(st.callout || "", `700 20px ${FONT}`, W - 44 - tagW - 16);
    const hasMeta = Boolean(st.consequence || st.fix_reason);
    const maxChipW = st.consequence && st.fix_reason ? Math.floor((W - 60) / 2) : W - 48;
    const panel = el(
      "div.diff__fpanel",
      {},
      el(
        "div.diff__ftop",
        {},
        el("span.diff__fstep", { text: stepTag }),
        el("div.diff__fcall", { text: callText })
      ),
      hasMeta
        ? el(
            "div.diff__fmeta",
            {},
            st.consequence
              ? el("div.diff__fchip.diff__fchip--danger", { text: fitLine(`⚠ ${st.consequence}`, `600 15.5px ${FONT}`, maxChipW) })
              : null,
            st.fix_reason
              ? el("div.diff__fchip.diff__fchip--success", { text: fitLine(`✓ ${st.fix_reason}`, `600 15.5px ${FONT}`, maxChipW) })
              : null
          )
        : null
    );
    foot.appendChild(panel);
    return panel;
  });
  if (steps.length) root.appendChild(foot);

  stage.appendChild(root);

  // ---- Deterministic Timeline ----
  const mech = ctx.mechanic || "blur-materialize";
  common.reveal(tl, head, t0 + 0.04, { y: -10, mechanic: mech });
  common.reveal(tl, leftPane.pane, t0 + 0.06, { y: 12, mechanic: mech });
  common.reveal(tl, rightPane.pane, t0 + 0.12, { y: 12, mechanic: mech });
  tl.fromTo(vsPill, { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 1, scale: 1, duration: 0.24, ease: EASE.spring }, t0 + 0.14);

  tl.fromTo(leftPane.glow, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
  tl.fromTo(rightPane.glow, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0);
  stepPanels.forEach((p) => tl.fromTo(p, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.001 }, t0));

  let glowLOn = false;
  let glowROn = false;
  let prevPanelIdx = -1;
  let prevStepEndT = t0 + 0.16;

  steps.forEach((st, idx) => {
    const tStep = clampT(Math.max(at(st.ps), prevStepEndT + 0.02));
    const stepDur = fitDur(tStep, 0.24);
    prevStepEndT = tStep + stepDur;

    const tone = TONE_ACCENT[st.tone] ? st.tone : "info";
    const wantL = tone === "danger";
    const wantR = tone === "success";
    if (wantL !== glowLOn) {
      tl.fromTo(leftPane.glow, { autoAlpha: glowLOn ? 1 : 0 }, { autoAlpha: wantL ? 1 : 0, duration: stepDur, immediateRender: false }, tStep);
      glowLOn = wantL;
    }
    if (wantR !== glowROn) {
      tl.fromTo(rightPane.glow, { autoAlpha: glowROn ? 1 : 0 }, { autoAlpha: wantR ? 1 : 0, duration: stepDur, immediateRender: false }, tStep);
      glowROn = wantR;
    }

    const applyPaneLines = (items, hlLineNums, sideDefaultTone) => {
      const set = new Set((Array.isArray(hlLineNums) ? hlLineNums : []).map(Number).filter(Number.isInteger));
      const anyFocused = items.some((_, i) => set.has(i + 1));
      const acc = TONE_ACCENT[sideDefaultTone] || TONE_ACCENT.info;
      items.forEach((item, i) => {
        const isHl = set.has(i + 1);
        const nextOp = anyFocused && !isHl ? 0.34 : 1;
        const nextHl = isHl ? sideDefaultTone : "none";
        if (nextOp !== item.op) {
          tl.fromTo(
            item.lineEl,
            { opacity: item.op },
            { opacity: nextOp, duration: stepDur, ease: EASE.reveal, immediateRender: false },
            tStep
          );
          item.op = nextOp;
        }
        if (nextHl !== item.hlTone) {
          const prevBg = item.hlTone === "none" ? "transparent" : (TONE_ACCENT[item.hlTone]?.bg || "transparent");
          const prevBar = item.hlTone === "none" ? "transparent" : (TONE_ACCENT[item.hlTone]?.bar || "transparent");
          const nextBg = isHl ? acc.bg : "transparent";
          const nextBar = isHl ? acc.bar : "transparent";
          tl.fromTo(item.hlBox, { backgroundColor: prevBg }, { backgroundColor: nextBg, duration: stepDur, immediateRender: false }, tStep);
          tl.fromTo(item.hlBar, { backgroundColor: prevBar }, { backgroundColor: nextBar, duration: stepDur, immediateRender: false }, tStep);
          item.hlTone = nextHl;
        }
      });
    };

    const leftTone = tone === "info" ? "danger" : tone;
    const rightTone = tone === "info" ? "success" : tone;
    applyPaneLines(leftPane.lineItems, st.left_lines, leftTone);
    applyPaneLines(rightPane.lineItems, st.right_lines, rightTone);

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
        { autoAlpha: 1, y: 0, duration: stepDur, ease: EASE.reveal, immediateRender: false },
        tStep
      );
      prevPanelIdx = idx;
    }
  });
}
