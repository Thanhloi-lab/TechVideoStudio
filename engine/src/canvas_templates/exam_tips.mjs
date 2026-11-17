import { clamp01, dampedSpring, easeQuartOut } from "../motion/kernel.mjs";
import { paletteV2, roundRect, timing, wrapText } from "./shared.mjs";

function fitCardRows(ctx, colW, maxTextH, wrongText, rightText) {
  const candidates = [
    { fontPx: 20, lineH: 26, rowGap: 12 },
    { fontPx: 18, lineH: 23, rowGap: 10 },
    { fontPx: 16.5, lineH: 21, rowGap: 8 },
    { fontPx: 15, lineH: 19, rowGap: 6 },
  ];
  const maxW = colW - 52;

  for (const cand of candidates) {
    ctx.font = `500 ${cand.fontPx}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    const wrongLines = wrapText(ctx, `❌ Bẫy: ${wrongText || ""}`, maxW).slice(0, 3);
    const rightLines = wrapText(ctx, `✅ Chuẩn: ${rightText || ""}`, maxW).slice(0, 3);
    const totalH = (wrongLines.length + rightLines.length) * cand.lineH + cand.rowGap;
    if (totalH <= maxTextH || cand === candidates[candidates.length - 1]) {
      return { ...cand, wrongLines, rightLines };
    }
  }
  return { fontPx: 16, lineH: 20, rowGap: 8, wrongLines: [], rightLines: [] };
}

export function drawExamScene(ctx, W, H, scene, progress, sceneTime, sceneDur) {
  const data = scene.visual_data || {};
  const cmps = data.comparisons || [];
  const quiz = data.quiz || null;
  const showQuiz = Boolean(quiz && progress >= (quiz.show_at_progress ?? 0.68));
  const colW = (W - 220) / 2;
  const cardH = showQuiz ? 216 : 254;
  const rowGap = showQuiz ? 236 : 278;

  cmps.slice(0, 4).forEach((cmp, idx) => {
    const startP = cmp.progress_start ?? 0;
    if (progress < startP) return;

    const localTime = Math.max(0, sceneTime - startP * sceneDur);
    const revP = easeQuartOut(clamp01(localTime / (timing.elementRevealMs / 1000)));
    const springScale = dampedSpring(clamp01(localTime / 0.28), {
      from: 0.94,
      to: 1.0,
      durationSec: 0.28,
    });
    const checkImpactScale = dampedSpring(clamp01((progress - startP) / 0.008), {
      from: 1.28,
      to: 1.0,
      durationSec: 0.22,
    });

    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 90 + col * (colW + 40);
    const y = 128 + row * rowGap;

    ctx.save();
    ctx.globalAlpha = clamp01(revP * 1.15);
    if (revP < 0.98) {
      const blur = (1 - revP) * 14;
      if (blur >= 0.8) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    }
    ctx.translate(x + colW / 2, y + cardH / 2);
    ctx.scale(springScale, springScale);
    ctx.translate(-(x + colW / 2), -(y + cardH / 2));

    roundRect(ctx, x, y, colW, cardH, 16);
    ctx.fillStyle = "rgba(11, 20, 38, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(16, 192, 240, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Header row: Title + CHECK badge (matching ExamTipCard.mjs)
    const checkW = 68;
    const checkH = 24;
    const checkX = x + colW - checkW - 22;
    const checkY = y + 22;

    const rawTitle = String(cmp.title || "");
    let titleFontPx = 23;
    ctx.font = `700 ${titleFontPx}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    const maxTitleW = colW - checkW - 64;
    if (ctx.measureText(rawTitle).width > maxTitleW) {
      titleFontPx = 20;
      ctx.font = `700 ${titleFontPx}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    }
    ctx.fillStyle = paletteV2.gold;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(rawTitle, x + 26, y + 34, maxTitleW);

    // CHECK pill badge
    ctx.save();
    ctx.translate(checkX + checkW / 2, checkY + checkH / 2);
    ctx.scale(checkImpactScale, checkImpactScale);
    roundRect(ctx, -checkW / 2, -checkH / 2, checkW, checkH, 6);
    ctx.fillStyle = "rgba(16, 192, 240, 0.14)";
    ctx.fill();
    ctx.strokeStyle = "rgba(16, 192, 240, 0.45)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = '800 13px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#90E0F0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CHECK", 0, 0);
    ctx.restore();

    // Adaptive 1..3 wrapped lines for wrong & right rows
    const bodyStartY = y + 66;
    const maxTextH = cardH - 80;
    const fitted = fitCardRows(ctx, colW, maxTextH, cmp.wrong, cmp.right);

    ctx.font = `500 ${fitted.fontPx}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    ctx.fillStyle = paletteV2.dangerText;
    fitted.wrongLines.forEach((l, li) => {
      ctx.fillText(l, x + 26, bodyStartY + li * fitted.lineH);
    });

    const rightStartY = bodyStartY + fitted.wrongLines.length * fitted.lineH + fitted.rowGap;
    ctx.fillStyle = "#6EE7B7";
    fitted.rightLines.forEach((l, li) => {
      ctx.fillText(l, x + 26, rightStartY + li * fitted.lineH);
    });

    ctx.restore();
  });

  if (showQuiz) {
    const qStart = quiz.show_at_progress ?? 0.68;
    const qLocalTime = Math.max(0, sceneTime - qStart * sceneDur);
    const qRev = easeQuartOut(clamp01(qLocalTime / (timing.elementRevealMs / 1000)));
    const qy = 128 + 2 * rowGap + 6;
    const qx = 90;
    const qw = W - 180;
    const qh = 248;

    ctx.save();
    ctx.globalAlpha = clamp01(qRev * 1.15);
    roundRect(ctx, qx, qy, qw, qh, 16);
    ctx.fillStyle = "rgba(6, 12, 26, 0.96)";
    ctx.fill();
    ctx.strokeStyle = paletteV2.accentCyan;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.font = '800 18px "Be Vietnam Pro", Inter, sans-serif';
    ctx.fillStyle = paletteV2.accentCyan;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("⚡ CÂU HỎI NHANH DVA-C02", qx + 26, qy + 28);

    ctx.font = '700 21px "Be Vietnam Pro", Inter, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    const qLines = wrapText(ctx, quiz.question || "", qw - 52).slice(0, 2);
    qLines.forEach((ql, qi) => {
      ctx.fillText(ql, qx + 26, qy + 60 + qi * 26);
    });

    const optW = (qw - 72) / 2;
    const optTopOffset = qLines.length > 1 ? 106 : 96;
    (quiz.options || []).slice(0, 4).forEach((opt, oi) => {
      const oc = oi % 2;
      const or = Math.floor(oi / 2);
      const ox = qx + 26 + oc * (optW + 20);
      const oy = qy + optTopOffset + or * 62;
      roundRect(ctx, ox, oy, optW, 52, 10);
      ctx.fillStyle = "#131E36";
      ctx.fill();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '600 17px "Be Vietnam Pro", Inter, sans-serif';
      ctx.fillStyle = "#E2E8F0";
      const optLines = wrapText(ctx, `${opt.key}. ${opt.text}`, optW - 32).slice(0, 2);
      if (optLines.length <= 1) {
        ctx.textBaseline = "middle";
        ctx.fillText(optLines[0] || "", ox + 16, oy + 26);
      } else {
        ctx.textBaseline = "top";
        optLines.forEach((ol, oli) => {
          ctx.fillText(ol, ox + 16, oy + 7 + oli * 20);
        });
      }
    });
    ctx.restore();
  }
}
