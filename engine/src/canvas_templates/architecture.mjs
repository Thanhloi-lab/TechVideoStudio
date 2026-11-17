import { getTone, ICON_GLYPHS } from "../icons.mjs";
import {
  clamp01,
  computeArchitectureLayout,
  computePacketBadgePos,
  easeCubicInOut,
  easeQuartOut,
} from "../motion/kernel.mjs";
import { paletteV2, roundRect, timing } from "./shared.mjs";

const archLayoutCache = new WeakMap();

export function getCachedArchitectureLayout(ctx, data, areaW, areaH) {
  const key = `${areaW}x${areaH}`;
  let entry = archLayoutCache.get(data);
  if (entry && entry.key === key) {
    return entry.layout;
  }
  ctx.save();
  ctx.font = '600 19px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  const measureLabelWidth = (txt) => ctx.measureText(String(txt || "")).width + 26;
  const computed = computeArchitectureLayout(data, areaW, areaH, {
    cardW: 244,
    cardH: 150,
    cornerRadius: 18,
    labelScale: 1.48,
    measureLabelWidth,
  });
  ctx.restore();
  if (data && typeof data === "object") {
    archLayoutCache.set(data, { key, layout: computed });
  }
  return computed;
}

function computeCanvasPacketBadgePos(pos, tan, geom, areaW, areaH) {
  return computePacketBadgePos(pos, tan, geom, {
    offset: 34,
    canvasW: areaW,
    canvasH: areaH,
    padX: 90,
    padYTop: 24,
    padYBottom: 22,
  });
}

export function drawArchitectureScene(ctx, W, H, scene, progress, sceneTime, sceneDur, camState) {
  const data = scene.visual_data || {};
  const nodes = data.nodes || [];
  const flowSteps = data.flow_steps || [];
  const activeStepIdx = flowSteps.findIndex(
    (s) => progress >= s.progress_start && progress <= s.progress_end
  );
  const resolvedStepIdx = activeStepIdx >= 0 ? activeStepIdx : Math.max(0, flowSteps.length - 1);
  const activeStep = flowSteps[resolvedStepIdx] || null;

  const activeNodes = new Set(activeStep?.active_nodes || []);
  const activeEdges = new Set(activeStep?.active_edges || []);

  const areaX = 70;
  const areaY = 126;
  const areaW = W - 140;
  const areaH = H - 300;
  const areaCenterX = W / 2;
  const areaCenterY = areaY + areaH / 2;

  const archLayout = getCachedArchitectureLayout(ctx, data, areaW, areaH);
  const layoutNodeMap = new Map(archLayout.nodes.map((nr) => [nr.id, nr]));

  const stepDur = activeStep
    ? Math.max(0.1, (activeStep.progress_end - activeStep.progress_start) * sceneDur)
    : sceneDur;
  const stepLocalTime = activeStep
    ? Math.max(0, sceneTime - activeStep.progress_start * sceneDur)
    : sceneTime;
  const stepProg = activeStep
    ? clamp01(
        (progress - activeStep.progress_start) /
          Math.max(0.01, activeStep.progress_end - activeStep.progress_start)
      )
    : 0;

  // Compute subtle camera focus zoom toward active nodes (using resolved layout positions) or explicit camera_focus
  let targetZoom = 1.0;
  let targetFx = areaCenterX;
  let targetFy = areaCenterY;
  if (activeStep?.camera_focus) {
    targetZoom = Math.max(1.0, Math.min(1.26, Number(activeStep.camera_focus.zoom) || 1.14));
    targetFx = areaX + ((Number(activeStep.camera_focus.x) || 50) / 100) * areaW;
    targetFy = areaY + ((Number(activeStep.camera_focus.y) || 50) / 100) * areaH;
  } else if (activeNodes.size > 0 && activeNodes.size < nodes.length) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const id of activeNodes) {
      const nr = layoutNodeMap.get(id);
      if (nr) {
        sumX += areaX + nr.cx;
        sumY += areaY + nr.cy;
        count++;
      }
    }
    if (count > 0) {
      targetFx = sumX / count;
      targetFy = sumY / count;
      targetZoom = 1.1;
    }
  }

  const stepKey = `${scene.id}:${resolvedStepIdx}`;
  if (camState.stepKey !== stepKey) {
    camState.fromX = camState.currX ?? areaCenterX;
    camState.fromY = camState.currY ?? areaCenterY;
    camState.fromZoom = camState.currZoom ?? 1.0;
    camState.startTime = sceneTime;
    camState.stepKey = stepKey;
  }
  const camDuration = timing.cameraFocusMs / 1000;
  const camP = easeCubicInOut(clamp01((sceneTime - camState.startTime) / Math.max(0.1, camDuration)));
  const currZoom = camState.fromZoom + (targetZoom - camState.fromZoom) * camP;
  const currFx = camState.fromX + (targetFx - camState.fromX) * camP;
  const currFy = camState.fromY + (targetFy - camState.fromY) * camP;
  camState.currX = currFx;
  camState.currY = currFy;
  camState.currZoom = currZoom;

  const rawShiftX = (areaCenterX - currFx) * (currZoom - 1) * 1.15;
  const rawShiftY = (areaCenterY - currFy) * (currZoom - 1) * 1.15;
  const maxShiftX = W * 0.085;
  const maxShiftY = H * 0.075;
  const shiftX = Math.max(-maxShiftX, Math.min(maxShiftX, rawShiftX));
  const shiftY = Math.max(-maxShiftY, Math.min(maxShiftY, rawShiftY));

  ctx.save();
  ctx.translate(areaCenterX + shiftX, areaCenterY + shiftY);
  ctx.scale(currZoom, currZoom);
  ctx.translate(-areaCenterX, -areaCenterY);
  ctx.translate(areaX, areaY);

  // Layer A: Trust / Network Zones (outer depth 0 -> inner depth 1)
  for (const z of archLayout.zones) {
    ctx.save();
    roundRect(ctx, z.x, z.y, z.w, z.h, z.depth === 0 ? 22 : 16);
    ctx.fillStyle = z.depth === 0 ? z.style.fill : z.style.fillNested;
    ctx.fill();
    if (z.dashed) {
      ctx.setLineDash([12, 8]);
    }
    ctx.strokeStyle = z.style.stroke;
    ctx.lineWidth = z.depth === 0 ? 2.4 : 1.8;
    ctx.stroke();
    ctx.restore();

    // Top-left zone header pill
    ctx.save();
    ctx.font = '700 17px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    const labelW = ctx.measureText(z.label).width;
    let subW = 0;
    const subStr = z.sublabel ? `  •  ${z.sublabel}` : "";
    if (subStr) {
      ctx.font = '500 15px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      subW = ctx.measureText(subStr).width;
    }
    const pillW = Math.min(z.w - 24, labelW + subW + 26);
    const pillH = 32;
    roundRect(ctx, z.badgeX, z.badgeY, pillW, pillH, 9);
    ctx.fillStyle = z.style.badgeBg;
    ctx.fill();
    ctx.strokeStyle = z.style.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = '700 17px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = z.style.badgeText;
    const textY = z.badgeY + pillH / 2;
    ctx.fillText(z.label, z.badgeX + 13, textY);
    if (subStr && labelW + 26 < pillW) {
      ctx.font = '500 15px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = z.style.subText;
      ctx.fillText(subStr, z.badgeX + 13 + labelW, textY);
    }
    ctx.restore();
  }

  // Layer B: Shared Computed Edges (Straight / Orthogonal Rounded-Elbow / Gentle Curved)
  for (const geom of archLayout.edges) {
    const edge = geom.raw;
    const { sx, sy, ex, ey } = geom;
    const isAct = activeEdges.has(edge.id);
    const isDanger = edge.style === "danger";
    const color = isDanger ? paletteV2.danger : isAct ? paletteV2.accentCyan : "#475569";
    const drawP = isAct ? easeQuartOut(clamp01(stepLocalTime / Math.min(0.42, stepDur * 0.4))) : 1;

    // Subtle muted guide path underneath active draw-in
    if (isAct) {
      ctx.save();
      if (edge.style === "dashed") ctx.setLineDash([12, 8]);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      geom.drawCanvasPath(ctx, 1);
      ctx.restore();
    }

    // Glowing Aura under active edge
    if (isAct) {
      ctx.save();
      ctx.strokeStyle = isDanger ? "rgba(239, 68, 68, 0.28)" : "rgba(16, 192, 240, 0.28)";
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      geom.drawCanvasPath(ctx, drawP);
      ctx.restore();
    }

    // Main Stroke
    ctx.save();
    if (edge.style === "dashed") {
      ctx.setLineDash([12, 8]);
      if (isAct) ctx.lineDashOffset = -sceneTime * 48;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = isAct ? 4.5 : 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    geom.drawCanvasPath(ctx, drawP);
    ctx.restore();

    // Junction Anchor Dots at Start & End
    for (const [jx, jy, visible] of [
      [sx, sy, true],
      [ex, ey, drawP >= 0.94],
    ]) {
      if (!visible) continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(jx, jy, isAct ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isAct ? "#060C18" : "#0F172A";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isAct ? 3 : 2;
      if (isAct) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.stroke();

      if (isAct) {
        ctx.beginPath();
        ctx.arc(jx, jy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
      }
      ctx.restore();
    }

    // Arrowhead oriented along path tangent
    if (drawP >= 0.2) {
      const tip = geom.pointAt(drawP);
      const tan = geom.tangentAt(drawP);
      const angle = tan.angleRad;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - 16 * Math.cos(angle - Math.PI / 6), tip.y - 16 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(tip.x - 16 * Math.cos(angle + Math.PI / 6), tip.y - 16 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Anti-Overlap Edge Label Pill
    if (edge.label) {
      const mx = geom.labelX;
      const my = geom.labelY;
      ctx.save();
      ctx.font = '600 19px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      const lw = Math.max(geom.labelW, ctx.measureText(edge.label).width + 26);
      const lh = geom.labelH || 34;
      roundRect(ctx, mx - lw / 2, my - lh / 2, lw, lh, 8);
      ctx.fillStyle = isAct ? "rgba(6, 12, 26, 0.96)" : "rgba(11, 20, 38, 0.9)";
      ctx.fill();
      ctx.strokeStyle = isAct ? color : "#334155";
      ctx.lineWidth = isAct ? 2 : 1.5;
      ctx.stroke();
      ctx.fillStyle = isAct ? "#F8FAFC" : "#94A3B8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(edge.label, mx, my);
      ctx.restore();
    }

    // Eased Glowing Capsule Packet + Fade Trail
    if (isAct && drawP >= 0.7) {
      const pktRaw = (stepProg * 1.5) % 1;
      const pktT = easeQuartOut(pktRaw);

      for (let k = 6; k >= 1; k--) {
        const trailT = Math.max(0, pktT - k * 0.03);
        const tp = geom.pointAt(trailT);
        ctx.save();
        ctx.globalAlpha = (1 - k / 7) * 0.55;
        ctx.fillStyle = isDanger ? paletteV2.danger : paletteV2.accentCyan;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 7.5 - k * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const pos = geom.pointAt(pktT);
      const tan = geom.tangentAt(pktT);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(tan.angleRad);
      ctx.shadowColor = isDanger ? paletteV2.danger : paletteV2.accentCyan;
      ctx.shadowBlur = 18;
      roundRect(ctx, -15, -7, 30, 14, 7);
      ctx.fillStyle = isDanger ? paletteV2.danger : paletteV2.accentCyan;
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      if (activeStep?.packet_label) {
        const badgePos = computeCanvasPacketBadgePos(pos, tan, geom, areaW, areaH);
        ctx.save();
        ctx.font = '700 16px "JetBrains Mono", Inter, monospace';
        const pw = ctx.measureText(activeStep.packet_label).width + 18;
        roundRect(ctx, badgePos.x - pw / 2, badgePos.y - 12, pw, 24, 12);
        ctx.fillStyle = "rgba(2, 10, 20, 0.92)";
        ctx.fill();
        ctx.strokeStyle = isDanger ? paletteV2.danger : paletteV2.accentGlow;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = isDanger ? "#FCA5A5" : paletteV2.accentGlow;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(activeStep.packet_label, badgePos.x, badgePos.y);
        ctx.restore();
      }
    }
  }

  // Layer C: Nodes
  for (const nr of archLayout.nodes) {
    const n = nr.raw;
    const tone = getTone(n.tone);
    const cardW = archLayout.cardW;
    const cardH = archLayout.cardH;
    const isHl = activeNodes.has(n.id);
    const dimmed = activeNodes.size > 0 && !isHl;
    const nodeScale = isHl ? 1.06 : 1.0;

    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.42;
    ctx.translate(nr.cx, nr.cy);
    ctx.scale(nodeScale, nodeScale);

    if (isHl) {
      ctx.shadowColor = tone.glow;
      ctx.shadowBlur = 28;
    }

    roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 20);
    ctx.fillStyle = isHl ? "rgba(15, 28, 52, 0.96)" : "rgba(11, 20, 38, 0.9)";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isHl ? tone.border : "rgba(148, 163, 184, 0.28)";
    ctx.lineWidth = isHl ? 3.5 : 2;
    ctx.stroke();

    ctx.font = "34px Segoe UI Emoji, Apple Color Emoji, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ICON_GLYPHS[n.icon] || "☁️", 0, -34);

    ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    ctx.fillText(n.label || "", 0, 14);

    if (n.sublabel) {
      ctx.font = '600 17px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = tone.text;
      ctx.fillText(n.sublabel, 0, 44);
    }
    ctx.restore();
  }

  ctx.restore();

  // Callout Banner outside camera zoom so it remains sharp and centered
  if (activeStep?.badge_text) {
    const revP = easeQuartOut(clamp01(stepLocalTime / (timing.elementRevealMs / 1000)));
    ctx.save();
    ctx.globalAlpha = clamp01(revP * 1.15);
    ctx.font = '700 23px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    const bw = Math.min(W - 180, ctx.measureText(activeStep.badge_text).width + 78);
    const bx = (W - bw) / 2;
    const by = 112;
    ctx.shadowColor = "rgba(16, 192, 240, 0.28)";
    ctx.shadowBlur = 20;
    roundRect(ctx, bx, by, bw, 50, 25);
    ctx.fillStyle = "rgba(6, 12, 26, 0.94)";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = paletteV2.accentCyan;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Glowing Gold Accent Dot
    ctx.beginPath();
    ctx.arc(bx + 28, by + 25, 6, 0, Math.PI * 2);
    ctx.fillStyle = paletteV2.gold;
    ctx.shadowColor = paletteV2.gold;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#E0F7FF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(activeStep.badge_text, W / 2 + 8, by + 25);
    ctx.restore();
  }
}
