import { clamp01, easeQuartOut } from "../motion/kernel.mjs";
import { drawViewfinderBrackets, paletteV2, roundRect, wrapText } from "./shared.mjs";

export function drawConsoleScene(ctx, W, H, scene, progress, sceneTime, sceneDur) {
  const data = scene.visual_data || {};
  const steps = data.steps || [];
  const activeStep =
    steps.find((s) => progress >= s.progress_start && progress <= s.progress_end) ||
    steps[steps.length - 1] ||
    null;

  const winX = 90;
  const winY = 126;
  const winW = W - 180;
  const winH = H - 296;

  // Outer Console Window + Viewfinder L-Brackets
  ctx.save();
  roundRect(ctx, winX, winY, winW, winH, 20);
  ctx.fillStyle = "rgba(11, 20, 38, 0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(51, 65, 85, 0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  drawViewfinderBrackets(ctx, winX - 6, winY - 6, winW + 12, winH + 12, 26, paletteV2.accentCyan, 3);

  // Browser bar
  ctx.save();
  roundRect(ctx, winX + 2, winY + 2, winW - 4, 58, [18, 18, 0, 0]);
  ctx.fillStyle = "#131E36";
  ctx.fill();

  // macOS Traffic Dots
  const dotColors = ["#EF4444", "#F59E0B", "#10B981"];
  dotColors.forEach((c, idx) => {
    ctx.beginPath();
    ctx.arc(winX + 34 + idx * 24, winY + 31, 7, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  ctx.font = '600 20px "JetBrains Mono", Consolas, monospace';
  ctx.fillStyle = "#CBD5E1";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`🔒 ${data.url || "console.aws.amazon.com"}`, winX + 120, winY + 31);

  if (activeStep) {
    const stepText = `Bước ${activeStep.step_number}/${steps.length}`;
    ctx.font = '700 20px "Be Vietnam Pro", Inter, sans-serif';
    const spW = ctx.measureText(stepText).width + 30;
    roundRect(ctx, winX + winW - spW - 24, winY + 13, spW, 36, 10);
    ctx.fillStyle = "rgba(42, 98, 255, 0.24)";
    ctx.fill();
    ctx.strokeStyle = "rgba(16, 192, 240, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = paletteV2.accentGlow;
    ctx.textAlign = "center";
    ctx.fillText(stepText, winX + winW - spW / 2 - 24, winY + 31);
  }
  ctx.restore();

  if (!activeStep) return;

  const stepLocalTime = Math.max(0, sceneTime - activeStep.progress_start * sceneDur);
  const stepProg = clamp01(
    (progress - activeStep.progress_start) /
      Math.max(0.01, activeStep.progress_end - activeStep.progress_start)
  );
  const stepRevP = easeQuartOut(clamp01(stepLocalTime / 0.22));

  ctx.save();
  ctx.globalAlpha = clamp01(stepRevP * 1.15);
  if (stepRevP < 0.98) {
    const blur = (1 - stepRevP) * 10;
    if (blur >= 0.8) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  }

  ctx.font = '700 32px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  ctx.fillStyle = "#F8FAFC";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `Bước ${activeStep.step_number}/${steps.length}: ${activeStep.heading}`,
    winX + 48,
    winY + 106
  );

  // Measure footer (multi-line tip + primary button) upfront to compute dynamic field budget
  let btnW = 0;
  if (activeStep.primary_button) {
    ctx.font = '700 22px "Be Vietnam Pro", Inter, sans-serif';
    btnW = Math.max(150, ctx.measureText(activeStep.primary_button).width + 52);
  }

  const tipFontSize = 21;
  const tipLineH = 26;
  let tipLines = [];
  if (activeStep.tip) {
    ctx.font = `600 ${tipFontSize}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    const tipMaxW = Math.max(240, winW - 96 - (btnW > 0 ? btnW + 32 : 0));
    tipLines = wrapText(ctx, `💡 ${activeStep.tip}`, tipMaxW).slice(0, 3);
  }

  const footerH = Math.max(66, tipLines.length * tipLineH + 26);
  const footerTop = winY + winH - footerH;

  const fields = activeStep.fields || [];
  const hasSpotlight = fields.some((f) => f.highlight);
  const pulse = 0.5 + 0.5 * Math.sin(sceneTime * 4.2);

  const fieldsStartY = winY + 150;
  const availFieldsH = Math.max(140, footerTop - 16 - fieldsStartY);
  const count = fields.length;

  let fh = 114;
  let fieldGap = 22;
  if (count > 0) {
    if (count <= 3 && availFieldsH >= count * 114 + (count - 1) * 22) {
      fh = 114;
      fieldGap = 22;
    } else {
      fieldGap = count > 5 ? 10 : count > 4 ? 14 : 18;
      fh = Math.min(114, Math.max(52, Math.floor((availFieldsH - fieldGap * Math.max(0, count - 1)) / count)));
    }
  }
  const stepY = fh + fieldGap;

  let fy = fieldsStartY;
  for (let idx = 0; idx < count; idx++) {
    const f = fields[idx];
    if (fy + fh > footerTop - 6) break;

    const isSpot = Boolean(f.highlight);
    const fx = winX + 48;
    const fw = winW - 96;

    ctx.save();
    if (hasSpotlight && !isSpot) {
      ctx.globalAlpha *= 0.48;
    }

    if (isSpot) {
      const cx = fx + fw / 2;
      const cy = fy + fh / 2;
      ctx.translate(cx, cy);
      ctx.scale(1.015, 1.015);
      ctx.translate(-cx, -cy);
      ctx.shadowColor = `rgba(16, 192, 240, ${(0.28 + pulse * 0.22).toFixed(2)})`;
      ctx.shadowBlur = 26;
    }

    roundRect(ctx, fx, fy, fw, fh, Math.min(14, Math.round(fh * 0.2)));
    ctx.fillStyle = isSpot ? "rgba(16, 192, 240, 0.14)" : "#131E36";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isSpot ? paletteV2.accentCyan : "rgba(148, 163, 184, 0.24)";
    ctx.lineWidth = isSpot ? 3 : 1.5;
    ctx.stroke();

    if (isSpot) {
      drawViewfinderBrackets(ctx, fx - 5, fy - 5, fw + 10, fh + 10, 16, paletteV2.accentCyan, 2.5);
    }

    const labelPx = fh >= 98 ? 20 : fh >= 72 ? 17 : 15;
    const valPx = fh >= 98 ? 24 : fh >= 72 ? 20 : 17;
    const valLineH = Math.round(valPx * 1.24);
    const labelY = fy + Math.max(17, Math.round(fh * 0.26));

    ctx.font = `600 ${labelPx}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    ctx.fillStyle = isSpot ? paletteV2.accentGlow : "#94A3B8";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(f.label || "", fx + 28, labelY);

    const valText =
      f.type === "radio"
        ? `◉ ${f.selected || (Array.isArray(f.options) && f.options[0]) || ""}`
        : f.type === "checkbox_row"
          ? `☑ ${f.value || ""}`
          : f.value || "";

    ctx.font = `700 ${valPx}px "JetBrains Mono", Inter, system-ui, sans-serif`;
    ctx.fillStyle = "#F8FAFC";
    const maxValLines = fh >= 92 ? 2 : 1;
    const valLines = wrapText(ctx, valText, fw - 56).slice(0, maxValLines);

    if (valLines.length <= 1) {
      ctx.fillText(valLines[0] || "", fx + 28, fy + Math.round(fh * 0.67));
    } else {
      const startValY = fy + Math.max(labelY - fy + 22, fh - valLines.length * valLineH - 8);
      ctx.textBaseline = "top";
      valLines.forEach((line, lIdx) => {
        ctx.fillText(line, fx + 28, startValY + lIdx * valLineH);
      });
    }
    ctx.restore();

    fy += stepY;
  }

  // Footer Tip (wrapped multi-line) + Primary Button + Animated Spotlight Pulse
  if (tipLines.length > 0) {
    ctx.save();
    ctx.font = `600 ${tipFontSize}px "Be Vietnam Pro", Inter, system-ui, sans-serif`;
    ctx.fillStyle = paletteV2.accentGlow;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tipTotalH = tipLines.length * tipLineH;
    const tipStartY = footerTop + (footerH - tipTotalH) / 2 + tipLineH / 2 - 4;
    tipLines.forEach((line, lIdx) => {
      ctx.fillText(line, winX + 48, tipStartY + lIdx * tipLineH);
    });
    ctx.restore();
  }

  if (activeStep.primary_button) {
    const btnText = activeStep.primary_button;
    ctx.font = '700 22px "Be Vietnam Pro", Inter, sans-serif';
    const btnH = 48;
    const btnX = winX + winW - btnW - 48;
    const btnY = winY + winH - 68;
    const isBtnSpot = Boolean(activeStep.highlight_button);

    ctx.save();
    if (isBtnSpot) {
      ctx.shadowColor = "rgba(16, 192, 240, 0.65)";
      ctx.shadowBlur = 22 + pulse * 10;
    }
    roundRect(ctx, btnX, btnY, btnW, btnH, 10);
    if (isBtnSpot) {
      const grad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
      grad.addColorStop(0, paletteV2.accentPrimary);
      grad.addColorStop(1, paletteV2.accentCyan);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = "#1E293B";
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(btnText, btnX + btnW / 2, btnY + btnH / 2);

    // Click ripple on highlighted primary button near end of step
    if (isBtnSpot && stepProg > 0.65) {
      const rippleP = ((stepProg - 0.65) / 0.35) % 1;
      ctx.beginPath();
      ctx.arc(btnX + btnW / 2, btnY + btnH / 2, 12 + rippleP * 28, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(16, 192, 240, ${(1 - rippleP) * 0.9})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}
