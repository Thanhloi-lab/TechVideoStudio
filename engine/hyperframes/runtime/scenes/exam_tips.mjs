// exam_tips — DOM + GSAP scene builder (HyperFrames composition).
// Contract: engine/HYPERFRAMES_ENGINE.md §6 — export default build(ctx); every tween is placed on ctx.tl
// at an ABSOLUTE time; no callbacks, no randomness (seeded jitter only), no wall clock.
//
// Legacy semantics reproduced (engine/src/canvas_templates/exam_tips.mjs + components/ExamTipCard.mjs):
//   • up to 4 wrong-vs-right cards (2 columns), each hidden until `progress_start`, then a blur-to-sharp
//     spring reveal (scale .94→1), CHECK pill impact (1.28→1), ❌/✅ icons stamped in (1.45→1, ±6°),
//     rough-notation strike-through over the wrong answer and a hand-drawn ellipse around the right one;
//   • quiz box at `quiz.show_at_progress` (default .68): cards compact to make room (legacy 254→216px),
//     question + 2..4 options (A–D, 2×2 grid), then the `correct_key` reveal (green highlight + ✓,
//     wrong options dimmed) and the `explanation` line.

const STYLE_ID = "tvs-style-exam-tips";
const FONT = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';

const CSS = `
.ex { position: absolute; inset: 0; }
.ex__head { position: absolute; left: 0; top: 0; height: 38px; display: flex; align-items: center; gap: 18px; max-width: 100%; }
.ex__sub { font: 500 20px var(--tvs-font); color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex__card { position: absolute; border-radius: 16px; border: 2px solid rgba(16,192,240,0.28); background: linear-gradient(180deg, rgba(14,26,48,0.96) 0%, rgba(10,18,36,0.95) 100%);
  transform-origin: 50% 50%; }
.ex__title { position: absolute; left: 26px; top: 20px; height: 32px; line-height: 32px; font-weight: 700; color: #F0C040;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex__check { position: absolute; right: 22px; top: 23px; height: 26px; line-height: 23px; padding: 0 11px; border-radius: 7px;
  background: rgba(16,192,240,0.14); border: 1.4px solid rgba(16,192,240,0.45); color: #90E0F0;
  font: 800 13px var(--tvs-font); letter-spacing: 0.08em; }
.ex__block { position: absolute; left: 24px; }
.ex__icon { position: absolute; left: 0; top: 0; width: 30px; display: flex; align-items: center; justify-content: center; }
.ex__lines { position: absolute; left: 38px; top: 0; }
.ex__line { position: relative; white-space: pre; }
.ex__wrong { color: #F08070; }
.ex__right { color: #6EE7B7; }
.ex__lbl-w { font-weight: 700; color: #FCA5A5; }
.ex__lbl-r { font-weight: 700; color: #A7F3D0; }
.ex__ann { position: absolute; overflow: visible; pointer-events: none; }
.ex__quiz { position: absolute; left: 0; border-radius: 16px; border: 2.5px solid #10C0F0; background: rgba(6,12,26,0.96); }
.ex__halo { position: absolute; inset: -10.5px; border-radius: 24px; border: 5px solid rgba(16,192,240,0.08); pointer-events: none; }
.ex__qtag { position: absolute; left: 26px; font-weight: 800; color: #10C0F0; letter-spacing: 0.02em; white-space: nowrap; }
.ex__qans { position: absolute; right: 22px; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-radius: 17px;
  background: rgba(16,185,129,0.18); border: 1.6px solid #10B981; color: #A7F3D0; font-weight: 800; white-space: nowrap; }
.ex__qtext { position: absolute; left: 26px; right: 26px; font-weight: 700; color: #F8FAFC; }
.ex__opt { position: absolute; border-radius: 12px; background: #131E36; border: 1.5px solid rgba(148,163,184,0.3);
  display: flex; align-items: center; gap: 14px; padding: 0 16px; color: #E2E8F0; font-weight: 600; transform-origin: 50% 50%; }
.ex__ofx { position: absolute; inset: -1.5px; border-radius: 12px; border: 2px solid #10B981; background: rgba(16,185,129,0.2); pointer-events: none; }
.ex__ofx-halo { position: absolute; inset: -8px; border-radius: 17px; border: 4px solid rgba(16,185,129,0.2); }
.ex__okey { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(148,163,184,0.14); border: 1.5px solid rgba(148,163,184,0.42); font: 800 16px var(--tvs-font); color: #E2E8F0; }
.ex__okey-ok { position: absolute; inset: -1.5px; border-radius: 50%; display: grid; place-items: center; background: #10B981;
  color: #02140D; font: 900 19px var(--tvs-font); }
.ex__otext { position: relative; flex: 1 1 auto; min-width: 0; }
.ex__oline { white-space: pre; }
.ex__expl { position: absolute; left: 26px; right: 26px; color: #BAE6FD; font-weight: 600; }
.ex__expl-lbl { color: #10C0F0; font-weight: 800; }
`;

const LAYOUT = Object.freeze({
  headH: 38,
  gridTop: 56,
  colGap: 40,
  rowGap: 20,
  quizGap: 18,
  padX: 24,
  bodyTop: 68,
  bottomPad: 22,
  minCardH: 168,
});

/** [font px, line height, gap between wrong/right blocks] — largest that fits wins (legacy fitCardRows). */
/** Quiz typography variants, largest first (M = legacy Canvas sizes). */
const QUIZ_VARIANTS = [
  { q: [30, 40], o: [24, 31], e: [23, 31], tag: 22, optH: 74 },
  { q: [26, 34], o: [21, 27], e: [21, 28], tag: 20, optH: 64 },
  { q: [22, 29], o: [18, 23], e: [19, 25], tag: 18, optH: 54 },
];

const CARD_FONTS = [
  [26, 34, 18],
  [24, 31, 18],
  [22, 29, 16],
  [20, 26, 15],
  [18, 23, 14],
  [16.5, 21, 13],
  [15, 19, 12],
];

function ensureStyle(common) {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(common.el("style", { id: STYLE_ID, text: CSS }));
}

// ---------------------------------------------------------------------------
// Text measuring (canvas measureText is allowed: fonts are ready before builders run)
// ---------------------------------------------------------------------------

let measureCtx = null;
function measure(text, font) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(String(text)).width;
}

/** Greedy word wrap with first-line indent, hard breaks for over-long words and an ellipsis on overflow. */
function wrapText(text, font, width, maxLines, firstIndent = 0) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  const avail = () => width - (lines.length === 0 ? firstIndent : 0);
  let cur = "";
  let truncated = false;
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    const test = cur ? `${cur} ${word}` : word;
    if (measure(test, font) <= avail()) {
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
    // word alone on a fresh line: hard-break if it still does not fit
    while (measure(word, font) > avail() && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut), font) > avail()) cut--;
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
    const li = lines.length - 1;
    const w = width - (li === 0 ? firstIndent : 0);
    let last = lines[li];
    while (last && measure(`${last}…`, font) > w) last = last.slice(0, -1);
    lines[li] = `${last.trimEnd()}…`;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export default function buildExamTips(ctx) {
  const { tl, common, vd, stage, at } = ctx;
  const { el, svg, mark, stamp, drawPath, roughStrikePath, roughEllipsePath, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const sceneEnd = ctx.start + ctx.dur;
  const exitAt = sceneEnd - DUR.exit - DUR.breather; // envelope exit starts here
  const fitDur = (t, d) => Math.max(0.03, Math.min(d, sceneEnd - 0.01 - t));
  const W = STAGE.width;
  const H = STAGE.height;

  const comparisons = (Array.isArray(vd.comparisons) ? vd.comparisons : []).slice(0, 4).filter(Boolean);
  const rawQuiz = vd.quiz && typeof vd.quiz === "object" ? vd.quiz : null;
  const quizOptions = rawQuiz ? (Array.isArray(rawQuiz.options) ? rawQuiz.options : []).filter(Boolean).slice(0, 4) : [];
  const quiz = rawQuiz && (rawQuiz.question || quizOptions.length) ? rawQuiz : null;
  const n = comparisons.length;
  const rows = Math.ceil(n / 2);

  const root = el("div.ex");

  // ---- Header badge (+ optional subtitle) -----------------------------------
  const badgeText = String(vd.badge || "DVA-C02 Exam Tips");
  const head = el("div.ex__head", {}, el("div.tvs-badge", { text: `🎯 ${badgeText}` }));
  if (vd.subtitle) head.appendChild(el("div.ex__sub", { text: String(vd.subtitle) }));
  root.appendChild(head);

  // ---- Card + quiz geometry ----------------------------------------------------
  const colW = Math.floor((W - LAYOUT.colGap) / 2);
  const cardModels = comparisons.map((cmp, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const lastOdd = n % 2 === 1 && idx === n - 1;
    const width = n === 1 ? Math.min(W, 1180) : colW;
    const x = n === 1 || lastOdd ? Math.round((W - width) / 2) : col * (colW + LAYOUT.colGap);
    return { cmp, idx, row, x, width };
  });

  const measureQuiz = (v) => {
    const innerW = W - 52;
    const optCols = quizOptions.length <= 1 ? 1 : 2;
    const optGapX = 18;
    const optW = Math.floor((innerW - optGapX * (optCols - 1)) / optCols);
    const optTextW = optW - 32 - 34 - 14 - 8;
    const qLines = wrapText(quiz.question || "", `700 ${v.q[0]}px ${FONT}`, innerW, 2);
    const optLines = quizOptions.map((o) => wrapText(o.text ?? "", `600 ${v.o[0]}px ${FONT}`, optTextW, 2));
    const twoLineOpts = optLines.some((l) => l.length > 1);
    const optH = v.optH + (twoLineOpts ? v.o[1] - 4 : 0);
    const optRows = Math.max(1, Math.ceil(quizOptions.length / optCols));
    const explLabel = "💡 Giải thích: ";
    const explLabelW = measure(explLabel, `800 ${v.e[0]}px ${FONT}`);
    const explLines = quiz.explanation ? wrapText(quiz.explanation, `600 ${v.e[0]}px ${FONT}`, innerW, 2, explLabelW) : [];
    const tagY = 18;
    const qY = tagY + v.tag + 16;
    const optY = qY + qLines.length * v.q[1] + 16;
    const explY = optY + optRows * optH + (optRows - 1) * 12 + 16;
    const height = explY + (explLines.length ? explLines.length * v.e[1] + 4 : -16) + 22;
    return { qFont: v.q, oFont: v.o, eFont: v.e, tagPx: v.tag, optCols, optGapX, optW, qLines, optLines, optH, optRows, explLabel, explLines, tagY, qY, optY, explY, height };
  };

  const avail = H - LAYOUT.gridTop;
  const rowGaps = LAYOUT.rowGap * Math.max(0, rows - 1);
  const wrongLabel = "Bẫy: ";
  const rightLabel = "Chuẩn: ";
  const fitCard = (m, [px, lh, gap]) => {
    const textW = m.width - LAYOUT.padX * 2 - 38;
    const font = `500 ${px}px ${FONT}`;
    const lblFont = `700 ${px}px ${FONT}`;
    const wIndent = measure(wrongLabel, lblFont);
    const rIndent = measure(rightLabel, lblFont);
    const wrongLines = wrapText(m.cmp.wrong ?? "", font, textW, 3, wIndent);
    const rightLines = wrapText(m.cmp.right ?? "", font, textW, 3, rIndent);
    const bodyTop = LAYOUT.bodyTop + Math.max(0, px - 22);
    const needed = bodyTop + (wrongLines.length + rightLines.length) * lh + gap + 10 + LAYOUT.bottomPad;
    return { px, lh, gap, font, wIndent, rIndent, wrongLines, rightLines, bodyTop, needed };
  };
  /** Largest card font whose grid fits `availGrid`; all cards share one (content-sized) height. */
  const fitGrid = (availGrid) => {
    let fits = [];
    let cardH = 0;
    if (!n) return { fits, cardH, ok: true, px: 99 };
    for (let fi = 0; fi < CARD_FONTS.length; fi++) {
      fits = cardModels.map((m) => fitCard(m, CARD_FONTS[fi]));
      cardH = Math.max(LAYOUT.minCardH, ...fits.map((f) => f.needed));
      if (rows * cardH + rowGaps <= availGrid) return { fits, cardH, ok: true, px: CARD_FONTS[fi][0] };
    }
    return { fits, cardH: Math.max(120, Math.floor((availGrid - rowGaps) / rows)), ok: false, px: 0 };
  };

  // Quiz scale: the largest variant that still leaves the cards ≥ 22px text (legacy size is "M").
  let quizModel = null;
  let grid = null;
  if (quiz) {
    for (let vi = 0; vi < QUIZ_VARIANTS.length; vi++) {
      const qm = measureQuiz(QUIZ_VARIANTS[vi]);
      const g = fitGrid(avail - (n ? LAYOUT.quizGap : 0) - qm.height);
      quizModel = qm;
      grid = g;
      if ((g.ok && g.px >= 22) || vi === QUIZ_VARIANTS.length - 1) break;
    }
  } else {
    grid = fitGrid(avail);
  }
  const { fits, cardH } = grid;
  const gridH = rows ? rows * cardH + rowGaps : 0;
  // Before the quiz: grid centred in the content area. With the quiz: grid+quiz block centred,
  // so the cards glide up to make room (legacy compacted the cards when the quiz appeared).
  const gridTopPre = LAYOUT.gridTop + Math.max(0, Math.floor((avail - gridH) / 2) - 8);
  const blockH = quizModel ? gridH + (rows ? LAYOUT.quizGap : 0) + quizModel.height : gridH;
  const blockTop = LAYOUT.gridTop + Math.max(0, Math.floor((avail - blockH) / 2) - 8);
  const gridTopPost = quizModel ? blockTop : gridTopPre;

  // ---- Cards -----------------------------------------------------------------
  const cards = cardModels.map((m, mi) => {
    const { cmp, idx, x, width, row } = m;
    const fit = fits[mi];
    const titleText = String(cmp.title || "");
    let titlePx = Math.max(23, fit.px + 2);
    if (measure(titleText, `700 ${titlePx}px ${FONT}`) > width - 26 - 130) titlePx = 20;

    const top = gridTopPre + row * (cardH + LAYOUT.rowGap);
    const topPost = gridTopPost + row * (cardH + LAYOUT.rowGap);
    const card = el("div.ex__card", { style: { left: `${x}px`, top: `${top}px`, width: `${width}px`, height: `${cardH}px` } });
    card.appendChild(el("div.ex__title", { text: titleText, style: { fontSize: `${titlePx}px`, right: "126px" } }));
    const check = el("div.ex__check", { text: "CHECK" });
    card.appendChild(check);

    const lineStyle = { height: `${fit.lh}px`, lineHeight: `${fit.lh}px`, fontSize: `${fit.px}px` };
    const blockLines = (lines, label, labelCls, cls) =>
      lines.map((line, li) =>
        el(
          `div.ex__line.${cls}`,
          { style: lineStyle },
          li === 0 ? el(`span.${labelCls}`, { text: label }) : null,
          line
        )
      );

    // Wrong block + strike-through (one rough stroke per wrapped line, drawn left→right in sequence)
    const wrongTop = fit.bodyTop;
    const wrongH = fit.wrongLines.length * fit.lh;
    const wrongBlock = el("div.ex__block", { style: { top: `${wrongTop}px`, width: `${width - LAYOUT.padX * 2}px`, height: `${wrongH}px` } });
    const wrongIcon = el("div.ex__icon", { text: "❌", style: { height: `${fit.lh}px`, fontSize: `${Math.round(fit.px * 0.92)}px` } });
    const wrongLinesEl = el("div.ex__lines", {}, blockLines(fit.wrongLines, wrongLabel.trimEnd() + " ", "ex__lbl-w", "ex__wrong"));
    wrongBlock.append(wrongIcon, wrongLinesEl);
    const strikes = fit.wrongLines.map((line, li) => {
      const w = Math.max(24, (li === 0 ? fit.wIndent : 0) + measure(line, fit.font));
      const path = svg("path", {
        d: roughStrikePath(w, fit.lh, (ctx.seed + idx * 97 + li * 13) >>> 0),
        fill: "none",
        stroke: "rgba(239,68,68,0.92)",
        "stroke-width": Math.max(2, fit.px * 0.11).toFixed(2),
        "stroke-linecap": "round",
      });
      const node = svg("svg", { class: "ex__ann", width: Math.ceil(w + 8), height: fit.lh, viewBox: `0 0 ${Math.ceil(w + 8)} ${fit.lh}`, style: `left:${38}px;top:${li * fit.lh}px` }, path);
      wrongBlock.appendChild(node);
      return { path, w };
    });
    card.appendChild(wrongBlock);

    // Right block + hand-drawn ellipse around the correct answer
    const rightTop = wrongTop + wrongH + fit.gap;
    const rightH = fit.rightLines.length * fit.lh;
    const rightBlock = el("div.ex__block", { style: { top: `${rightTop}px`, width: `${width - LAYOUT.padX * 2}px`, height: `${rightH}px` } });
    const rightIcon = el("div.ex__icon", { text: "✅", style: { height: `${fit.lh}px`, fontSize: `${Math.round(fit.px * 0.92)}px` } });
    const rightLinesEl = el("div.ex__lines", {}, blockLines(fit.rightLines, rightLabel.trimEnd() + " ", "ex__lbl-r", "ex__right"));
    rightBlock.append(rightIcon, rightLinesEl);
    // One-line answer: circle the whole answer. Wrapped answer: an ellipse cannot enclose a wide
    // multi-line block without cutting through glyphs, so circle the "Chuẩn:" label instead
    // (exactly what the legacy Studio player did with rough-notation).
    const singleLine = fit.rightLines.length === 1;
    const rightW = singleLine ? measure(fit.rightLines[0], fit.font) + fit.rIndent : measure(rightLabel.trim(), `700 ${fit.px}px ${FONT}`);
    const maxEllW = width - LAYOUT.padX * 2 - 38 - 4;
    const ellBoxW = Math.min(maxEllW, rightW + (singleLine ? 18 : 10));
    const ellBoxH = fit.lh - (singleLine ? 4 : 8);
    const ellTop = singleLine ? (rightH - ellBoxH) / 2 : (fit.lh - ellBoxH) / 2;
    const ellPad = 14;
    const ellSvgW = Math.ceil(ellBoxW + 2 * (10 + ellPad));
    const ellSvgH = Math.ceil(ellBoxH + 2 * (8 + ellPad));
    const ellPath = svg("path", {
      d: roughEllipsePath(ellBoxW, ellBoxH, (ctx.seed + idx * 131 + 7) >>> 0),
      fill: "none",
      stroke: "#10B981",
      "stroke-width": "2.2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      transform: `translate(${10 + ellPad} ${8 + ellPad})`,
    });
    const ellSvg = svg(
      "svg",
      {
        class: "ex__ann",
        width: ellSvgW,
        height: ellSvgH,
        viewBox: `0 0 ${ellSvgW} ${ellSvgH}`,
        style: `left:${38 - (singleLine ? 9 : 5) - 10 - ellPad}px;top:${ellTop - 8 - ellPad}px`,
      },
      ellPath
    );
    rightBlock.appendChild(ellSvg);
    card.appendChild(rightBlock);

    root.appendChild(card);
    return { ...m, card, check, wrongIcon, rightIcon, strikes, ellPath, ellBoxW, ellBoxH, top, topPost };
  });

  // ---- Quiz box --------------------------------------------------------------
  let quizEls = null;
  if (quizModel) {
    const q = quizModel;
    const quizTop = blockTop + gridH + (rows ? LAYOUT.quizGap : 0);
    const box = el("div.ex__quiz", { style: { top: `${quizTop}px`, width: `${W}px`, height: `${q.height}px` } }, el("div.ex__halo"));

    const examCode = /\b([A-Z]{2,5}-[A-Z0-9]{2,4})\b/.exec(badgeText)?.[1] || "";
    const tagText = String(quiz.tag || `⚡ CÂU HỎI NHANH${examCode ? ` ${examCode}` : ""}`);
    box.appendChild(el("div.ex__qtag", { text: tagText, style: { top: `${q.tagY}px`, fontSize: `${q.tagPx}px`, lineHeight: `${q.tagPx + 4}px` } }));

    const correctKey = String(quiz.correct_key ?? "").trim();
    const correctIdx = quizOptions.findIndex((o) => String(o.key ?? "").trim() === correctKey);
    const ansChip = correctIdx >= 0
      ? el("div.ex__qans", {
          text: `✓ Đáp án đúng: ${correctKey}`,
          style: { top: `${q.tagY - 6}px`, height: `${q.tagPx + 16}px`, fontSize: `${q.tagPx - 1}px` },
        })
      : null;
    if (ansChip) box.appendChild(ansChip);

    const qText = el(
      "div.ex__qtext",
      { style: { top: `${q.qY}px`, fontSize: `${q.qFont[0]}px`, lineHeight: `${q.qFont[1]}px` } },
      q.qLines.map((line) => el("div.ex__oline", { text: line }))
    );
    box.appendChild(qText);

    const opts = quizOptions.map((opt, oi) => {
      const oc = oi % q.optCols;
      const or = Math.floor(oi / q.optCols);
      const key = String(opt.key ?? String.fromCharCode(65 + oi));
      const isCorrect = oi === correctIdx;
      const fx = isCorrect ? el("div.ex__ofx", {}, el("div.ex__ofx-halo")) : null;
      const ok = isCorrect ? el("div.ex__okey-ok", { text: "✓" }) : null;
      const node = el(
        "div.ex__opt",
        {
          style: {
            left: `${26 + oc * (q.optW + q.optGapX)}px`,
            top: `${q.optY + or * (q.optH + 12)}px`,
            width: `${q.optW}px`,
            height: `${q.optH}px`,
            fontSize: `${q.oFont[0]}px`,
            lineHeight: `${q.oFont[1]}px`,
          },
        },
        fx,
        el("div.ex__okey", {}, key, ok),
        el("div.ex__otext", {}, q.optLines[oi].map((line) => el("div.ex__oline", { text: line })))
      );
      box.appendChild(node);
      return { node, fx, ok, isCorrect };
    });

    let expl = null;
    if (q.explLines.length) {
      expl = el(
        "div.ex__expl",
        { style: { top: `${q.explY}px`, fontSize: `${q.eFont[0]}px`, lineHeight: `${q.eFont[1]}px` } },
        q.explLines.map((line, li) =>
          el("div.ex__oline", {}, li === 0 ? el("span.ex__expl-lbl", { text: q.explLabel }) : null, line)
        )
      );
      box.appendChild(expl);
    }
    root.appendChild(box);
    quizEls = { box, qText, opts, expl, ansChip, correctIdx };
  }

  stage.appendChild(root);

  // ---- Timeline -------------------------------------------------------------
  /**
   * Blur-to-sharp reveal that DROPS the filter once sharp. A lingering `filter: blur(0px)` (what
   * common.reveal leaves behind) keeps a filter surface whose partial re-raster is not bit-stable
   * across seek orders; same for blurred box-shadows and CSS outlines (rounded outline corners) —
   * this template draws halos as bordered elements (analytic rounded rects) instead.
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

  cards.forEach((c, i) => {
    const tc = Math.max(t0 + 0.08, at(mark(c.cmp.progress_start, 0))) + (mark(c.cmp.progress_start, 0) <= 0 ? i * DUR.stagger : 0);
    // Spring-ish card reveal: blur 14→0, scale .94→1 (legacy dampedSpring 0.28s), y 8→0.
    // NB: never put a filter on an overshooting ease (negative blur() is invalid CSS → stale frame).
    blurIn(c.card, tc, { y: 8, blur: 14 });
    tl.fromTo(c.card, { scale: 0.94 }, { scale: 1, duration: fitDur(tc, 0.34), ease: "back.out(1.8)" }, tc);
    stamp(tl, c.check, tc + 0.04, { from: 1.28, duration: 0.26 });
    // ❌ / ✅ icons stamp in (1.45 → 1, ∓6° → 0), the ✅ 80 ms later (legacy STAMP_SPRING + delay .08).
    tl.fromTo(c.wrongIcon, { autoAlpha: 0, scale: 1.45, rotation: -6 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: fitDur(tc + 0.08, DUR.stamp * 2.2), ease: EASE.spring }, tc + 0.08);
    tl.fromTo(c.rightIcon, { autoAlpha: 0, scale: 1.45, rotation: 6 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: fitDur(tc + 0.16, DUR.stamp * 2.2), ease: EASE.spring }, tc + 0.16);

    // Strike-through (300 ms total across lines, like rough-notation animationDuration 300).
    const totalW = c.strikes.reduce((s, k) => s + k.w, 0) || 1;
    let ts = tc + 0.26;
    c.strikes.forEach((k) => {
      const d = Math.max(0.08, 0.3 * (k.w / totalW));
      let len = k.w + 12;
      try {
        len = k.path.getTotalLength() + 2 || len;
      } catch {
        // estimate is fine
      }
      drawPath(tl, k.path, ts, fitDur(ts, d), Math.ceil(len), "power1.inOut");
      ts += d;
    });

    // Ellipse around the correct answer (340 ms).
    const te = ts + 0.08;
    const a = c.ellBoxW / 2 + 10;
    const b = c.ellBoxH / 2 + 8;
    let ellLen = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * (31 / 28) * 1.06;
    try {
      ellLen = c.ellPath.getTotalLength() + 2 || ellLen;
    } catch {
      // estimate is fine
    }
    drawPath(tl, c.ellPath, te, fitDur(te, 0.34), Math.ceil(ellLen), "power2.inOut");
  });

  if (quizEls) {
    const q = quizModel;
    const qP = mark(quiz.show_at_progress, 0.68);
    const tq = Math.max(t0 + 0.1, at(qP));

    // Cards compact to make room for the quiz (legacy: 254→216px), then the box rises in.
    const shift = cards.some((c) => Math.abs(c.topPost - c.top) > 1);
    if (shift) {
      const shiftDur = fitDur(tq, 0.45);
      cards.forEach((c) => {
        tl.fromTo(c.card, { top: c.top }, { top: c.topPost, duration: shiftDur, ease: EASE.camera }, tq);
      });
    }
    const tBox = tq + (shift ? 0.16 : 0);
    blurIn(quizEls.box, tBox, { y: 12, scale: 0.96, blur: 16 }, DUR.reveal + 0.05);
    blurIn(quizEls.qText, tBox + 0.08, { y: 8, blur: 8 });
    quizEls.opts.forEach((o, i) => blurIn(o.node, tBox + 0.16 + i * DUR.stagger * 1.6, { y: 10, blur: 8 }));

    // Answer reveal: quiz.reveal_at_progress, else ~42% into the remaining window (≥ .9 s of think time).
    const optsDone = tBox + 0.16 + quizOptions.length * DUR.stagger * 1.6 + DUR.reveal;
    let tAns;
    if (quiz.reveal_at_progress !== undefined && quiz.reveal_at_progress !== null && quiz.reveal_at_progress !== "") {
      tAns = Math.max(optsDone, at(mark(quiz.reveal_at_progress, 0.85)));
    } else {
      const window = Math.max(0, exitAt - tq);
      tAns = Math.max(optsDone + 0.1, Math.min(tq + Math.max(0.9, window * 0.42), exitAt - 0.75));
    }
    tAns = Math.min(tAns, sceneEnd - 0.2);

    if (quizEls.correctIdx >= 0) {
      quizEls.opts.forEach((o) => {
        if (o.isCorrect) {
          tl.fromTo(o.fx, { autoAlpha: 0 }, { autoAlpha: 1, duration: fitDur(tAns, 0.22), ease: EASE.reveal }, tAns);
          stamp(tl, o.ok, tAns + 0.02, { from: 1.6, duration: 0.3 });
          tl.fromTo(o.node, { scale: 1 }, { scale: 1.03, duration: fitDur(tAns, 0.12), ease: "power2.out", immediateRender: false }, tAns);
          tl.fromTo(o.node, { scale: 1.03 }, { scale: 1, duration: fitDur(tAns + 0.12, 0.2), ease: "power2.inOut", immediateRender: false }, tAns + 0.12);
        } else {
          tl.fromTo(o.node, { opacity: 1 }, { opacity: 0.4, duration: fitDur(tAns, 0.24), ease: EASE.reveal, immediateRender: false }, tAns);
        }
      });
      if (quizEls.ansChip) stamp(tl, quizEls.ansChip, tAns + 0.06, { from: 1.35, duration: 0.3 });
    }
    if (quizEls.expl) {
      const tx = tAns + 0.18;
      blurIn(quizEls.expl, tx, { y: 6, blur: 6 }, 0.24);
    }
  }
}
