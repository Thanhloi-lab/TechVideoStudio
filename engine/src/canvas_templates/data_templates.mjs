import { getTone, ICON_GLYPHS } from "../icons.mjs";
import {
  computeComparisonMatrixState,
  computeKpiMetricsState,
  computeTimelineFlowState,
} from "../motion/kernel.mjs";
import { roundRect, wrapText } from "./shared.mjs";

export function drawComparisonMatrixScene(ctx, W, H, scene, progress) {
  const data = scene.visual_data || {};
  const state = computeComparisonMatrixState(data, progress);
  const { columns, rows, showTakeaway, takeawayReveal, takeaway, badge } = state;

  const areaX = 88;
  const areaY = 128;
  const areaW = W - 176;
  const areaH = H - 308;

  // Top badge + optional subtitle
  ctx.save();
  ctx.font = '700 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  const badgeText = badge || "So sánh Chuyên sâu";
  const badgeW = Math.min(420, ctx.measureText(badgeText).width + 36);
  roundRect(ctx, areaX, areaY, badgeW, 38, 19);
  ctx.fillStyle = "rgba(16, 192, 240, 0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 192, 240, 0.55)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = "#90E0F0";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, areaX + 18, areaY + 19);

  if (data.title) {
    ctx.font = '500 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#CBD5E1";
    ctx.fillText(String(data.title), areaX + badgeW + 18, areaY + 19);
  }
  ctx.restore();

  const tableY = areaY + 52;
  const colGap = 14;
  const critW = Math.round(areaW * 0.23);
  const colCount = Math.max(1, columns.length);
  const colW = Math.floor((areaW - critW - colGap * colCount) / colCount);
  const headH = 82;

  // Header row
  roundRect(ctx, areaX, tableY, critW, headH, 14);
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '700 21px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  ctx.fillStyle = "#94A3B8";
  ctx.textBaseline = "middle";
  ctx.fillText(String(data.criterion_heading || "Tiêu chí so sánh"), areaX + 20, tableY + headH / 2);

  columns.forEach((col, cIdx) => {
    const cx = areaX + critW + colGap + cIdx * (colW + colGap);
    const tone = getTone(col.tone || (cIdx === colCount - 1 ? "green" : "blue"));
    roundRect(ctx, cx, tableY, colW, headH, 14);
    ctx.fillStyle = tone.bg;
    ctx.fill();
    ctx.strokeStyle = tone.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '700 23px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    ctx.textBaseline = col.subtitle ? "alphabetic" : "middle";
    const titleY = col.subtitle ? tableY + 36 : tableY + headH / 2;
    ctx.fillText(String(col.title || col.id || ""), cx + 20, titleY);

    if (col.badge) {
      ctx.font = '700 14px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      const bText = String(col.badge);
      const bw = Math.min(180, ctx.measureText(bText).width + 20);
      roundRect(ctx, cx + colW - bw - 14, tableY + 12, bw, 26, 13);
      ctx.fillStyle = tone.badge;
      ctx.fill();
      ctx.fillStyle = "#020A14";
      ctx.textBaseline = "middle";
      ctx.fillText(bText, cx + colW - bw - 4, tableY + 25);
    }
    if (col.subtitle) {
      ctx.font = '500 17px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = tone.text;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String(col.subtitle), cx + 20, tableY + 64);
    }
  });

  // Rows
  const takeawayReserve = showTakeaway ? 88 : 16;
  const rowsAreaH = Math.max(120, areaH - 52 - headH - takeawayReserve);
  const rowGap = 10;
  const rowH = Math.min(
    96,
    Math.max(58, Math.floor((rowsAreaH - rowGap * Math.max(0, rows.length - 1)) / Math.max(1, rows.length)))
  );

  rows.forEach((row, rIdx) => {
    const ry = tableY + headH + 14 + rIdx * (rowH + rowGap);
    const alpha = row.visible ? Math.max(0.18, row.revealProgress) : 0.14;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (row.active) {
      const midX = areaX + areaW / 2;
      const midY = ry + rowH / 2;
      ctx.translate(midX, midY);
      ctx.scale(1.01, 1.01);
      ctx.translate(-midX, -midY);
    }

    // Criterion cell
    roundRect(ctx, areaX, ry, critW, rowH, 12);
    ctx.fillStyle = row.active ? "rgba(16, 42, 74, 0.92)" : "rgba(9, 17, 34, 0.85)";
    ctx.fill();
    ctx.strokeStyle = row.active ? "#10C0F0" : "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = row.active ? 2.2 : 1.2;
    ctx.stroke();

    ctx.font = '600 19px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = row.active ? "#FFFFFF" : "#E2E8F0";
    ctx.textBaseline = "top";
    const critLines = wrapText(ctx, row.criterion, critW - 34).slice(0, 2);
    const critStartY = ry + Math.max(12, (rowH - critLines.length * 24) / 2);
    critLines.forEach((line, lIdx) => ctx.fillText(line, areaX + 18, critStartY + lIdx * 24));

    // Value cells
    columns.forEach((col, cIdx) => {
      const cx = areaX + critW + colGap + cIdx * (colW + colGap);
      const cell = row.values?.[col.id] || {};
      const st = cell.status || "neutral";
      const isGood = st === "good" || st === "best";
      const isBad = st === "bad" || st === "risk";
      const isWarn = st === "warn";

      roundRect(ctx, cx, ry, colW, rowH, 12);
      ctx.fillStyle = row.active ? "rgba(12, 26, 52, 0.94)" : "rgba(9, 17, 34, 0.78)";
      ctx.fill();
      ctx.strokeStyle = row.active
        ? "#10C0F0"
        : isGood
          ? "rgba(16, 185, 129, 0.35)"
          : isBad
            ? "rgba(239, 68, 68, 0.35)"
            : isWarn
              ? "rgba(245, 158, 11, 0.35)"
              : "rgba(148, 163, 184, 0.2)";
      ctx.lineWidth = row.active ? 2.2 : 1.2;
      ctx.stroke();

      let textOffsetX = 18;
      if (st !== "neutral") {
        const dotColor = isGood ? "#10B981" : isBad ? "#EF4444" : "#F59E0B";
        const iconChar = isGood ? (st === "best" ? "★" : "✓") : isBad ? "✕" : "!";
        roundRect(ctx, cx + 16, ry + rowH / 2 - 13, 26, 26, 8);
        const savedAlpha = ctx.globalAlpha;
        ctx.fillStyle = dotColor;
        ctx.globalAlpha = savedAlpha * 0.24;
        ctx.fill();
        ctx.globalAlpha = savedAlpha;
        ctx.font = '800 16px "Be Vietnam Pro", Inter, system-ui, sans-serif';
        ctx.fillStyle = dotColor;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(iconChar, cx + 29, ry + rowH / 2);
        ctx.textAlign = "left";
        textOffsetX = 52;
      }

      ctx.font = '500 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = isBad ? "#FECACA" : isGood ? "#D1FAE5" : isWarn ? "#FDE68A" : "#E2E8F0";
      ctx.textBaseline = "top";
      const valLines = wrapText(ctx, String(cell.text ?? "—"), colW - textOffsetX - 18).slice(0, 2);
      const valStartY = ry + Math.max(12, (rowH - valLines.length * 23) / 2);
      valLines.forEach((line, lIdx) => ctx.fillText(line, cx + textOffsetX, valStartY + lIdx * 23));
    });

    ctx.restore();
  });

  if (showTakeaway && takeaway?.text) {
    const ty = areaY + areaH - 68 + (1 - takeawayReveal) * 14;
    ctx.save();
    ctx.globalAlpha *= takeawayReveal;
    roundRect(ctx, areaX, ty, areaW, 62, 16);
    ctx.fillStyle = "rgba(10, 32, 58, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "#10C0F0";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '700 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#10C0F0";
    ctx.textBaseline = "middle";
    const lbl = String(takeaway.label || "💡 Nguyên tắc chốt");
    ctx.fillText(lbl, areaX + 24, ty + 31);
    const lblW = ctx.measureText(lbl).width + 20;

    ctx.font = '600 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    ctx.fillText(String(takeaway.text), areaX + 24 + lblW, ty + 31);
    ctx.restore();
  }
}

export function drawTimelineFlowScene(ctx, W, H, scene, progress) {
  const data = scene.visual_data || {};
  const state = computeTimelineFlowState(data, progress);
  const { orientation, milestones, trackFillRatio, showCallout, callout, calloutReveal } = state;

  const areaX = 88;
  const areaY = 128;
  const areaW = W - 176;
  const areaH = H - 308;

  // Header badge
  ctx.save();
  ctx.font = '700 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  const badgeText = String(data.badge || "Chuỗi xử lý theo thời gian");
  const badgeW = Math.min(460, ctx.measureText(badgeText).width + 36);
  roundRect(ctx, areaX, areaY, badgeW, 38, 19);
  ctx.fillStyle = "rgba(16, 192, 240, 0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 192, 240, 0.55)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = "#90E0F0";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, areaX + 18, areaY + 19);

  if (data.subtitle) {
    ctx.font = '500 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#CBD5E1";
    ctx.fillText(String(data.subtitle), areaX + badgeW + 18, areaY + 19);
  }
  ctx.restore();

  const count = Math.max(1, milestones.length);
  const calloutReserve = showCallout ? 96 : 16;

  if (orientation === "vertical") {
    const railX = areaX + 52;
    const listY = areaY + 62;
    const listH = Math.max(160, areaH - 62 - calloutReserve);
    const gapY = 14;
    const rowH = Math.min(118, Math.max(66, Math.floor((listH - gapY * Math.max(0, count - 1)) / count)));

    if (count > 1) {
      const topY = listY + rowH / 2;
      const botY = listY + (count - 1) * (rowH + gapY) + rowH / 2;
      ctx.fillStyle = "rgba(51, 65, 85, 0.7)";
      roundRect(ctx, railX - 3, topY, 6, Math.max(10, botY - topY), 3);
      ctx.fill();

      const fillGrad = ctx.createLinearGradient(0, topY, 0, botY);
      fillGrad.addColorStop(0, "#2A62FF");
      fillGrad.addColorStop(1, "#10C0F0");
      ctx.fillStyle = fillGrad;
      roundRect(ctx, railX - 3, topY, 6, Math.max(0, (botY - topY) * trackFillRatio), 3);
      ctx.fill();
    }

    milestones.forEach((m, idx) => {
      const tone = getTone(m.tone);
      const ry = listY + idx * (rowH + gapY);
      const markerY = ry + rowH / 2;
      const alpha = m.started ? Math.max(0.28, m.revealProgress) : 0.22;

      ctx.save();
      ctx.globalAlpha *= alpha;

      // Circle marker
      ctx.beginPath();
      ctx.arc(railX, markerY, 26, 0, Math.PI * 2);
      ctx.fillStyle = m.completed ? "#064E3B" : m.active ? "#0B3252" : "#0B1221";
      ctx.fill();
      ctx.lineWidth = m.active ? 3 : 2;
      ctx.strokeStyle = m.active ? "#10C0F0" : m.completed ? "#10B981" : tone.border;
      ctx.stroke();

      ctx.font = '700 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = m.completed ? "#6EE7B7" : "#F8FAFC";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.completed ? "✓" : ICON_GLYPHS[m.icon] || "•", railX, markerY);
      ctx.textAlign = "left";

      // Row Card
      const cardX = railX + 54;
      const cardW = areaX + areaW - cardX;
      roundRect(ctx, cardX, ry, cardW, rowH, 16);
      ctx.fillStyle = m.active ? "rgba(14, 30, 56, 0.92)" : "rgba(9, 17, 34, 0.82)";
      ctx.fill();
      ctx.strokeStyle = m.active ? "#10C0F0" : m.completed ? "rgba(16, 185, 129, 0.5)" : "rgba(148, 163, 184, 0.25)";
      ctx.lineWidth = m.active ? 2.4 : 1.4;
      ctx.stroke();

      ctx.font = '700 15px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      const stepW = ctx.measureText(m.timeLabel).width + 24;
      roundRect(ctx, cardX + 20, ry + 14, stepW, 28, 14);
      ctx.fillStyle = tone.bg;
      ctx.fill();
      ctx.fillStyle = tone.text;
      ctx.textBaseline = "middle";
      ctx.fillText(m.timeLabel, cardX + 32, ry + 28);

      ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = "#F8FAFC";
      ctx.fillText(m.title, cardX + 32 + stepW, ry + 28);

      if (m.description) {
        ctx.font = '500 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
        ctx.fillStyle = "#CBD5E1";
        ctx.textBaseline = "top";
        const descLines = wrapText(ctx, m.description, cardW - 44).slice(0, 2);
        descLines.forEach((line, lIdx) => ctx.fillText(line, cardX + 20, ry + 50 + lIdx * 23));
      }
      ctx.restore();
    });
  } else {
    const gap = 22;
    const cardW = Math.floor((areaW - gap * Math.max(0, count - 1)) / count);
    const railY = areaY + 106;
    const cardY = railY + 52;
    const cardH = Math.min(395, Math.max(220, areaH - (cardY - areaY) - calloutReserve));

    if (count > 1) {
      const firstCx = areaX + cardW / 2;
      const lastCx = areaX + (count - 1) * (cardW + gap) + cardW / 2;
      roundRect(ctx, firstCx, railY - 4, Math.max(10, lastCx - firstCx), 8, 4);
      ctx.fillStyle = "rgba(51, 65, 85, 0.72)";
      ctx.fill();

      const grad = ctx.createLinearGradient(firstCx, 0, lastCx, 0);
      grad.addColorStop(0, "#2A62FF");
      grad.addColorStop(1, "#10C0F0");
      roundRect(ctx, firstCx, railY - 4, Math.max(0, (lastCx - firstCx) * trackFillRatio), 8, 4);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    milestones.forEach((m, idx) => {
      const tone = getTone(m.tone);
      const cx = areaX + idx * (cardW + gap);
      const centerX = cx + cardW / 2;
      const alpha = m.started ? Math.max(0.28, m.revealProgress) : 0.22;

      ctx.save();
      ctx.globalAlpha *= alpha;
      if (m.active) {
        ctx.translate(centerX, cardY + cardH / 2);
        ctx.scale(1.03, 1.03);
        ctx.translate(-centerX, -(cardY + cardH / 2));
      }

      // Circle marker on horizontal rail
      ctx.beginPath();
      ctx.arc(centerX, railY, 30, 0, Math.PI * 2);
      ctx.fillStyle = m.completed ? "#064E3B" : m.active ? "#0B3252" : "#091122";
      ctx.fill();
      ctx.lineWidth = m.active ? 3.5 : 2;
      ctx.strokeStyle = m.active ? "#10C0F0" : m.completed ? "#10B981" : tone.border;
      ctx.stroke();

      ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = m.completed ? "#6EE7B7" : "#F8FAFC";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.completed ? "✓" : ICON_GLYPHS[m.icon] || String(idx + 1), centerX, railY);
      ctx.textAlign = "left";

      // Milestone Card
      roundRect(ctx, cx, cardY, cardW, cardH, 18);
      ctx.fillStyle = m.active ? "rgba(14, 30, 56, 0.94)" : "rgba(9, 17, 34, 0.84)";
      ctx.fill();
      ctx.strokeStyle = m.active ? "#10C0F0" : m.completed ? "rgba(16, 185, 129, 0.55)" : "rgba(148, 163, 184, 0.24)";
      ctx.lineWidth = m.active ? 2.5 : 1.5;
      ctx.stroke();

      // Step tag
      ctx.font = '700 15px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      const stepTagW = Math.min(cardW - 36, ctx.measureText(m.timeLabel).width + 24);
      roundRect(ctx, cx + 20, cardY + 20, stepTagW, 28, 14);
      ctx.fillStyle = tone.bg;
      ctx.fill();
      ctx.strokeStyle = tone.border;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = tone.text;
      ctx.textBaseline = "middle";
      ctx.fillText(m.timeLabel, cx + 32, cardY + 34);

      if (m.metricBadge) {
        ctx.font = '600 14px "JetBrains Mono", monospace';
        ctx.fillStyle = "#94A3B8";
        ctx.fillText(m.metricBadge, cx + 20, cardY + 66);
      }

      const titleY = m.metricBadge ? cardY + 84 : cardY + 66;
      ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = "#F8FAFC";
      ctx.textBaseline = "top";
      const titleLines = wrapText(ctx, m.title, cardW - 40).slice(0, 3);
      titleLines.forEach((line, lIdx) => ctx.fillText(line, cx + 20, titleY + lIdx * 28));

      if (m.description) {
        const descY = titleY + titleLines.length * 28 + 14;
        ctx.font = '500 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
        ctx.fillStyle = "#CBD5E1";
        const descLines = wrapText(ctx, m.description, cardW - 40).slice(0, 5);
        descLines.forEach((line, lIdx) => ctx.fillText(line, cx + 20, descY + lIdx * 24));
      }

      ctx.restore();
    });
  }

  if (showCallout && callout) {
    const cy = areaY + areaH - 72 + (1 - calloutReveal) * 14;
    ctx.save();
    ctx.globalAlpha *= calloutReveal;
    roundRect(ctx, areaX, cy, areaW, 66, 16);
    ctx.fillStyle = "rgba(10, 32, 58, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "#10C0F0";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '700 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#90E0F0";
    ctx.textBaseline = "middle";
    const cTitle = callout.title ? `${callout.title}: ` : "";
    ctx.fillText(cTitle, areaX + 26, cy + 33);
    const titleW = cTitle ? ctx.measureText(cTitle).width : 0;

    ctx.font = '600 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    ctx.fillText(String(callout.text || ""), areaX + 26 + titleW, cy + 33);
    ctx.restore();
  }
}

export function drawKpiMetricsScene(ctx, W, H, scene, progress) {
  const data = scene.visual_data || {};
  const state = computeKpiMetricsState(data, progress);
  const { cards, chart, showChart, chartReveal, alertStamp, showStamp, stampScale, stampProgress } = state;

  const areaX = 88;
  const areaY = 128;
  const areaW = W - 176;
  const areaH = H - 308;

  const hasChart = Boolean(chart?.series?.length);
  const cardsCount = Math.max(1, cards.length);
  const cardGap = 20;
  const cardW = Math.floor((areaW - cardGap * Math.max(0, cardsCount - 1)) / cardsCount);
  const cardH = hasChart ? 260 : 440;

  cards.forEach((card, idx) => {
    const tone = getTone(card.tone);
    const deltaTone = getTone(card.deltaTone);
    const cx = areaX + idx * (cardW + cardGap);
    const alpha = card.visible ? Math.max(0.2, card.revealProgress) : 0.14;

    ctx.save();
    ctx.globalAlpha *= alpha;
    roundRect(ctx, cx, areaY, cardW, cardH, 20);
    ctx.fillStyle = card.visible ? "rgba(9, 17, 34, 0.90)" : "rgba(9, 17, 34, 0.45)";
    ctx.fill();
    ctx.strokeStyle = card.visible ? tone.border : "rgba(148, 163, 184, 0.2)";
    ctx.lineWidth = card.visible ? 2.2 : 1.2;
    ctx.stroke();

    ctx.font = '600 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#CBD5E1";
    ctx.textBaseline = "top";
    const lblLines = wrapText(ctx, card.label, cardW - 44).slice(0, 2);
    lblLines.forEach((line, lIdx) => ctx.fillText(line, cx + 24, areaY + 24 + lIdx * 26));

    const valY = areaY + (hasChart ? 82 : 112);
    ctx.font = `800 ${cardsCount >= 4 ? 46 : 56}px "JetBrains Mono", "Be Vietnam Pro", monospace`;
    ctx.fillStyle = tone.text;
    ctx.fillText(card.displayValue, cx + 24, valY);

    if (card.deltaText) {
      const dy = valY + (cardsCount >= 4 ? 62 : 74);
      ctx.font = '700 16px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      const dw = Math.min(cardW - 48, ctx.measureText(card.deltaText).width + 24);
      roundRect(ctx, cx + 24, dy, dw, 32, 16);
      ctx.fillStyle = deltaTone.bg;
      ctx.fill();
      ctx.strokeStyle = deltaTone.border;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = deltaTone.text;
      ctx.textBaseline = "middle";
      ctx.fillText(card.deltaText, cx + 36, dy + 16);
    }

    if (card.sparkline.length >= 2 && card.sparklineProgress > 0.02) {
      const spX = cx + 24;
      const spW = cardW - 48;
      const spH = hasChart ? 48 : 88;
      const spY = areaY + cardH - spH - 20;
      const minV = Math.min(...card.sparkline);
      const maxV = Math.max(...card.sparkline);
      const span = maxV - minV || 1;
      const pts = card.sparkline.map((v, i) => ({
        x: spX + (i / (card.sparkline.length - 1)) * spW,
        y: spY + spH - ((v - minV) / span) * (spH - 6) - 3,
      }));
      const visCount = Math.max(2, Math.ceil(pts.length * card.sparklineProgress));
      const drawn = pts.slice(0, visCount);
      ctx.beginPath();
      ctx.moveTo(drawn[0].x, drawn[0].y);
      for (let i = 1; i < drawn.length; i++) ctx.lineTo(drawn[i].x, drawn[i].y);
      ctx.strokeStyle = tone.border;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  });

  if (hasChart) {
    const chY = areaY + cardH + 24;
    const chH = Math.max(220, areaY + areaH - chY);
    const series = chart.series;
    const maxVal = Math.max(1, ...series.map((pt) => Math.max(0, pt.value)));

    ctx.save();
    ctx.globalAlpha *= showChart ? chartReveal : 0.14;
    roundRect(ctx, areaX, chY, areaW, chH, 20);
    ctx.fillStyle = "rgba(9, 17, 34, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    ctx.textBaseline = "middle";
    ctx.fillText(chart.title || "Biểu đồ xu hướng", areaX + 28, chY + 34);
    if (chart.unit) {
      ctx.font = '600 16px "JetBrains Mono", monospace';
      ctx.fillStyle = "#90E0F0";
      ctx.textAlign = "right";
      ctx.fillText(chart.unit, areaX + areaW - 28, chY + 34);
      ctx.textAlign = "left";
    }

    const plotX = areaX + 54;
    const plotW = areaW - 108;
    const plotTop = chY + 78;
    const plotH = chH - 134;
    const slotW = plotW / Math.max(1, series.length);
    const barW = Math.min(110, slotW * 0.56);

    series.forEach((pt, idx) => {
      const bx = plotX + idx * slotW + (slotW - barW) / 2;
      const barH = Math.max(6, (Math.max(0, pt.value) / maxVal) * plotH * pt.barRatio);
      const by = plotTop + plotH - barH;

      const barGrad = ctx.createLinearGradient(0, by, 0, plotTop + plotH);
      if (pt.highlight) {
        barGrad.addColorStop(0, "#F0C040");
        barGrad.addColorStop(1, "#FF9900");
      } else {
        barGrad.addColorStop(0, "#10C0F0");
        barGrad.addColorStop(1, "#2A62FF");
      }
      roundRect(ctx, bx, by, barW, barH, 10);
      ctx.fillStyle = barGrad;
      ctx.fill();

      if (pt.barRatio > 0.15) {
        ctx.font = '700 17px "JetBrains Mono", monospace';
        ctx.fillStyle = pt.highlight ? "#FDE68A" : "#E2E8F0";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(Math.round(pt.value * pt.barRatio).toLocaleString("en-US"), bx + barW / 2, by - 8);
      }

      ctx.font = '600 18px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = "#94A3B8";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(pt.label, bx + barW / 2, plotTop + plotH + 14);
      ctx.textAlign = "left";
    });

    ctx.restore();
  }

  if (showStamp && alertStamp?.text) {
    const isOk = alertStamp.tone === "success";
    const stampColor = isOk ? "#10B981" : "#EF4444";
    const stampBg = isOk ? "rgba(6, 78, 59, 0.90)" : "rgba(127, 29, 29, 0.90)";
    const cx = areaX + areaW - 220;
    const cy = areaY + (hasChart ? cardH + 100 : 120);

    ctx.save();
    ctx.globalAlpha *= Math.min(1, stampProgress * 4);
    ctx.translate(cx, cy);
    ctx.rotate(-0.12);
    ctx.scale(stampScale, stampScale);

    ctx.font = '800 28px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    const tw = Math.min(460, ctx.measureText(alertStamp.text).width + 52);
    roundRect(ctx, -tw / 2, -34, tw, 68, 12);
    ctx.fillStyle = stampBg;
    ctx.fill();
    ctx.strokeStyle = stampColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(alertStamp.text), 0, 0);
    ctx.restore();
  }
}
