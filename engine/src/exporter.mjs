import { getTone, ICON_GLYPHS } from "./icons.mjs";
import {
  MOTION_TOKENS,
  clamp01,
  computeArchitectureLayout,
  computeComparisonMatrixState,
  computeKpiMetricsState,
  computePacketBadgePos,
  computeSceneEnvelope,
  computeTimelineFlowState,
  createBokehSeeds,
  createSparkleParticles,
  dampedSpring,
  easeCubicInOut,
  easeQuartOut,
  getSceneBurstInfo,
  parseSubtitleSegments,
  renderAmbientLayer,
  renderSparkleBurst,
  stepSparkleParticles,
} from "./motion/kernel.mjs";

const { paletteV2, timing, layout } = MOTION_TOKENS;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Wrap segmented subtitle runs [{ text, accent }] into lines while preserving accent flags.
 */
function wrapSubtitleSegments(ctx, segments, maxWidth) {
  const tokens = [];
  for (const seg of segments) {
    const parts = String(seg.text || "").split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      tokens.push({ text: part, accent: Boolean(seg.accent), isSpace: /^\s+$/.test(part) });
    }
  }

  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  for (const tok of tokens) {
    if (tok.isSpace && currentLine.length === 0) continue;
    const tokW = ctx.measureText(tok.text).width;
    if (!tok.isSpace && currentWidth + tokW > maxWidth && currentLine.length > 0) {
      while (currentLine.length && currentLine[currentLine.length - 1].isSpace) {
        currentLine.pop();
      }
      lines.push(currentLine);
      currentLine = [tok];
      currentWidth = tokW;
    } else {
      currentLine.push(tok);
      currentWidth += tokW;
    }
  }

  while (currentLine.length && currentLine[currentLine.length - 1].isSpace) {
    currentLine.pop();
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines;
}

function drawViewfinderBrackets(ctx, x, y, w, h, len = 18, color = paletteV2.accentCyan, lineWidth = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "square";
  ctx.shadowColor = "rgba(16, 192, 240, 0.7)";
  ctx.shadowBlur = 10;

  ctx.beginPath();
  // Top-left
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  // Top-right
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  // Bottom-left
  ctx.moveTo(x, y + h - len);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + len, y + h);
  // Bottom-right
  ctx.moveTo(x + w - len, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
  ctx.restore();
}

function drawTopProgressBar(ctx, W, globalProgress) {
  const barH = layout.progressBarHeightPx || 6;
  const p = clamp01(globalProgress);

  ctx.save();
  ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
  ctx.fillRect(0, 0, W, barH);

  if (p > 0) {
    const fillW = W * p;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, paletteV2.accentPrimary);
    grad.addColorStop(0.7, paletteV2.accentCyan);
    grad.addColorStop(1, paletteV2.accentGlow);
    ctx.shadowColor = "rgba(16, 192, 240, 0.75)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, fillW, barH);
  }
  ctx.restore();
}

function drawTopBar(ctx, W, script, scene) {
  const topOffset = layout.progressBarHeightPx || 6;
  const barH = 86;

  ctx.save();
  ctx.fillStyle = "rgba(2, 10, 20, 0.82)";
  ctx.fillRect(0, topOffset, W, barH);
  ctx.strokeStyle = "rgba(16, 192, 240, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, topOffset + barH);
  ctx.lineTo(W, topOffset + barH);
  ctx.stroke();

  const centerY = topOffset + barH / 2;

  // Part Pill (V2 Navy-Cyan)
  const partText = scene.part_label || "Bài học";
  ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  const pillW = ctx.measureText(partText).width + 44;
  roundRect(ctx, 48, centerY - 23, pillW, 46, 23);
  ctx.fillStyle = "rgba(42, 98, 255, 0.2)";
  ctx.fill();
  ctx.strokeStyle = paletteV2.accentCyan;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = paletteV2.accentGlow;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(partText, 70, centerY);

  // Scene Title
  ctx.font = '800 30px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  ctx.fillStyle = "#F8FAFC";
  ctx.fillText(scene.title || "", 48 + pillW + 26, centerY);

  // Episode Badge on right
  ctx.textAlign = "right";
  ctx.font = '600 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  ctx.fillStyle = "#94A3B8";
  ctx.fillText(
    `Tập ${String(script.episode_number || 1).padStart(2, "0")} • ${script.course_id || ""}`,
    W - 48,
    centerY
  );
  ctx.restore();
}

function drawSubtitles(ctx, W, H, script, scene, sceneTime) {
  const subs = scene.subtitles || [];
  const active = subs.find((s) => sceneTime >= s.start_sec && sceneTime <= s.end_sec + 0.15);
  if (!active || !active.text) return;

  const segments = parseSubtitleSegments(active.text, scene.highlight_words || []);
  if (!segments.length) return;

  ctx.save();
  ctx.font = '800 36px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const lines = wrapSubtitleSegments(ctx, segments, W - 260);
  const lineHeight = 48;
  const safeBottomPct =
    script?.aspect_ratio === "9:16"
      ? layout.safeBottomPct9x16
      : layout.safeBottomPct16x9;
  const bottomY = H * (1 - safeBottomPct / 100);
  const firstLineY = bottomY - (lines.length - 1) * lineHeight - 16;

  lines.forEach((lineTokens, lineIdx) => {
    const lineWidth = lineTokens.reduce((acc, t) => acc + ctx.measureText(t.text).width, 0);
    let cursorX = (W - lineWidth) / 2;
    const y = firstLineY + lineIdx * lineHeight;

    for (const tok of lineTokens) {
      const tw = ctx.measureText(tok.text).width;
      if (!tok.isSpace) {
        // Multi-pass drop shadow + crisp dark halo for box-free legibility
        ctx.shadowColor = "rgba(0, 0, 0, 0.96)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        ctx.strokeStyle = "rgba(2, 6, 14, 0.78)";
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.strokeText(tok.text, cursorX, y);

        if (tok.accent) {
          ctx.shadowColor = "rgba(16, 192, 240, 0.45)";
          ctx.shadowBlur = 12;
          ctx.fillStyle = paletteV2.subtitleAccent;
        } else {
          ctx.shadowColor = "rgba(2, 6, 14, 0.9)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = paletteV2.subtitleText;
        }
        ctx.fillText(tok.text, cursorX, y);
      }
      cursorX += tw;
    }
  });
  ctx.restore();
}

const archLayoutCache = new WeakMap();

function getCachedArchitectureLayout(ctx, data, areaW, areaH) {
  const key = `${areaW}x${areaH}`;
  let entry = archLayoutCache.get(data);
  if (entry && entry.key === key) {
    return entry.layout;
  }
  ctx.save();
  ctx.font = '600 19px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  const measureLabelWidth = (txt) => ctx.measureText(String(txt || "")).width + 26;
  const layout = computeArchitectureLayout(data, areaW, areaH, {
    cardW: 244,
    cardH: 150,
    cornerRadius: 18,
    labelScale: 1.48,
    measureLabelWidth,
  });
  ctx.restore();
  if (data && typeof data === "object") {
    archLayoutCache.set(data, { key, layout });
  }
  return layout;
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

function drawArchitectureScene(ctx, W, H, scene, progress, sceneTime, sceneDur, camState) {
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
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const areaX = 70;
  const areaY = 126;
  const areaW = W - 140;
  const areaH = H - 300;
  const areaCenterX = W / 2;
  const areaCenterY = areaY + areaH / 2;

  const archLayout = getCachedArchitectureLayout(ctx, data, areaW, areaH);

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

  // Compute subtle camera focus zoom toward active nodes or explicit camera_focus
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
      const n = nodeMap.get(id);
      if (n) {
        sumX += areaX + (n.x / 100) * areaW;
        sumY += areaY + (n.y / 100) * areaH;
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

function drawConsoleScene(ctx, W, H, scene, progress, sceneTime, sceneDur) {
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
    if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  }

  ctx.font = '700 32px "Be Vietnam Pro", Inter, system-ui, sans-serif';
  ctx.fillStyle = "#F8FAFC";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `Bước ${activeStep.step_number}/${steps.length}: ${activeStep.heading}`,
    winX + 48,
    winY + 112
  );

  const fields = activeStep.fields || [];
  const hasSpotlight = fields.some((f) => f.highlight);
  const pulse = 0.5 + 0.5 * Math.sin(sceneTime * 4.2);

  let fy = winY + 168;
  for (const f of fields) {
    const isSpot = Boolean(f.highlight);
    const fx = winX + 48;
    const fw = winW - 96;
    const fh = 114;

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

    roundRect(ctx, fx, fy, fw, fh, 14);
    ctx.fillStyle = isSpot ? "rgba(16, 192, 240, 0.14)" : "#131E36";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isSpot ? paletteV2.accentCyan : "rgba(148, 163, 184, 0.24)";
    ctx.lineWidth = isSpot ? 3 : 1.5;
    ctx.stroke();

    if (isSpot) {
      drawViewfinderBrackets(ctx, fx - 5, fy - 5, fw + 10, fh + 10, 16, paletteV2.accentCyan, 2.5);
    }

    ctx.font = '600 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = isSpot ? paletteV2.accentGlow : "#94A3B8";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(f.label || "", fx + 28, fy + 34);

    ctx.font = '700 25px "JetBrains Mono", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    const valText =
      f.type === "radio"
        ? `◉ ${f.selected || ""}`
        : f.type === "checkbox_row"
          ? `☑ ${f.value || ""}`
          : f.value || "";
    ctx.fillText(valText, fx + 28, fy + 78);
    ctx.restore();

    fy += 136;
  }

  // Footer Tip + Primary Button + Animated Spotlight Pulse
  if (activeStep.tip) {
    ctx.font = '600 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = paletteV2.accentGlow;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`💡 ${activeStep.tip}`, winX + 48, winY + winH - 46);
  }

  if (activeStep.primary_button) {
    const btnText = activeStep.primary_button;
    ctx.font = '700 22px "Be Vietnam Pro", Inter, sans-serif';
    const btnW = Math.max(150, ctx.measureText(btnText).width + 52);
    const btnH = 48;
    const btnX = winX + winW - btnW - 48;
    const btnY = winY + winH - 70;
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

function drawCodeCliScene(ctx, W, H, scene, progress, sceneTime) {
  const data = scene.visual_data || {};
  const codeLines = data.code_lines || [];
  const phases = data.highlight_phases || [];
  const cmds = data.terminal_commands || [];
  const hasCode = codeLines.length > 0;
  const hasTerm = cmds.length > 0;

  const activePhase =
    phases.find((p) => progress >= p.progress_start && progress <= p.progress_end) ||
    phases[phases.length - 1] ||
    null;
  const hlSet = new Set(activePhase?.lines || []);
  const displayLines = activePhase?.code_override || codeLines;

  const topY = 126;
  const paneH = H - 296;

  if (hasCode) {
    const cw = hasTerm ? (W - 180) / 2 - 16 : W - 180;
    const cx = 90;

    ctx.save();
    roundRect(ctx, cx, topY, cw, paneH, 16);
    ctx.fillStyle = "#060C18";
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.24)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Header
    roundRect(ctx, cx + 1, topY + 1, cw - 2, 54, [15, 15, 0, 0]);
    ctx.fillStyle = "#0F1A2E";
    ctx.fill();

    ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = paletteV2.accentGlow;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(data.code_title || "code", cx + 26, topY + 28);

    ctx.font = '500 21px "JetBrains Mono", Consolas, monospace';
    let firstHlY = null;
    let lastHlY = null;

    displayLines.slice(0, 18).forEach((line, i) => {
      const ly = topY + 84 + i * 32;
      const isHl = hlSet.has(i + 1);
      const isDimmed = hlSet.size > 0 && !isHl;

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.35;

      if (isHl) {
        if (firstHlY === null) firstHlY = ly - 15;
        lastHlY = ly + 15;

        // Highlight row fill
        ctx.fillStyle = "rgba(16, 192, 240, 0.14)";
        ctx.fillRect(cx + 6, ly - 15, cw - 12, 30);

        // Glowing Left Cyan Accent Rail
        ctx.shadowColor = "rgba(16, 192, 240, 0.85)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = paletteV2.accentCyan;
        ctx.fillRect(cx + 6, ly - 15, 5, 30);
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = isHl ? paletteV2.accentCyan : "#64748B";
      ctx.fillText(String(i + 1).padStart(2, " "), cx + 22, ly);
      ctx.fillStyle = isHl ? "#FFFFFF" : "#E2E8F0";
      ctx.fillText(String(line).slice(0, 56), cx + 68, ly);
      ctx.restore();
    });

    // Optional Laser Scanline across highlighted lines
    if (activePhase?.laser_scan && firstHlY !== null && lastHlY !== null) {
      const scanP = (sceneTime * 0.85) % 1;
      const scanX = cx + 64 + scanP * (cw - 96);
      ctx.save();
      ctx.strokeStyle = paletteV2.danger;
      ctx.lineWidth = 3;
      ctx.shadowColor = paletteV2.danger;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(scanX, firstHlY);
      ctx.lineTo(scanX, lastHlY);
      ctx.stroke();
      ctx.restore();
    }

    if (activePhase?.callout) {
      ctx.fillStyle = "rgba(16, 192, 240, 0.12)";
      ctx.fillRect(cx + 2, topY + paneH - 54, cw - 4, 52);
      ctx.font = '600 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = "#E0F7FF";
      ctx.fillText(`👉 ${activePhase.callout}`, cx + 24, topY + paneH - 28);
    }
    ctx.restore();
  }

  if (hasTerm) {
    const tw = hasCode ? (W - 180) / 2 - 16 : W - 180;
    const tx = hasCode ? 90 + (W - 180) / 2 + 16 : 90;

    ctx.save();
    roundRect(ctx, tx, topY, tw, paneH, 16);
    ctx.fillStyle = "#02060E";
    ctx.fill();
    ctx.strokeStyle = "rgba(16, 192, 240, 0.24)";
    ctx.lineWidth = 2;
    ctx.stroke();

    roundRect(ctx, tx + 1, topY + 1, tw - 2, 54, [15, 15, 0, 0]);
    ctx.fillStyle = "#0F1A2E";
    ctx.fill();

    ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = "#6EE7B7";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(data.terminal_title || "AWS Terminal", tx + 26, topY + 28);

    const cursorVisible = Math.floor((sceneTime * 1000) / timing.cursorBlinkHalfMs) % 2 === 0;
    let ty = topY + 90;
    ctx.font = '500 21px "JetBrains Mono", Consolas, monospace';

    const visibleCmds = cmds.filter((c) => progress >= c.progress_start);
    visibleCmds.forEach((item, idx) => {
      const elapsed = progress - item.progress_start;
      const typeRatio = Math.min(1, elapsed / 0.14);
      const visibleCmd = String(item.command || "").slice(
        0,
        Math.ceil((item.command || "").length * typeRatio)
      );
      const isLastVisible = idx === visibleCmds.length - 1;
      const showOutput = elapsed >= 0.14;

      ctx.fillStyle = paletteV2.success;
      ctx.fillText("$", tx + 26, ty);

      ctx.fillStyle = paletteV2.accentCyan;
      const cmdText = ` ${visibleCmd}`;
      ctx.fillText(cmdText, tx + 42, ty);

      if (typeRatio < 1 || (isLastVisible && !showOutput)) {
        if (cursorVisible) {
          const cursorX = tx + 42 + ctx.measureText(cmdText).width + 4;
          ctx.save();
          ctx.fillStyle = paletteV2.accentCyan;
          ctx.shadowColor = paletteV2.accentCyan;
          ctx.shadowBlur = 10;
          ctx.fillRect(cursorX, ty - 11, 12, 22);
          ctx.restore();
        }
      }

      ty += 34;

      if (showOutput) {
        const outElapsed = elapsed - 0.14;
        const lines = item.output_lines || [];
        lines.forEach((out, oIdx) => {
          if (outElapsed < oIdx * 0.015) return;
          ctx.fillStyle = "#CBD5E1";
          ctx.fillText(String(out).slice(0, 62), tx + 26, ty);
          ty += 30;
        });
      }
      ty += 18;
    });

    // Trailing blinking cyan cursor on idle prompt
    if (visibleCmds.length === 0 || progress - visibleCmds[visibleCmds.length - 1].progress_start >= 0.14) {
      if (ty < topY + paneH - 30) {
        ctx.fillStyle = paletteV2.success;
        ctx.fillText("$", tx + 26, ty);
        if (cursorVisible) {
          ctx.save();
          ctx.fillStyle = paletteV2.accentCyan;
          ctx.shadowColor = paletteV2.accentCyan;
          ctx.shadowBlur = 10;
          ctx.fillRect(tx + 50, ty - 11, 12, 22);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }
}

function drawExamScene(ctx, W, H, scene, progress, sceneTime, sceneDur) {
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

    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 90 + col * (colW + 40);
    const y = 128 + row * rowGap;

    ctx.save();
    ctx.globalAlpha = clamp01(revP * 1.15);
    if (revP < 0.98) {
      const blur = (1 - revP) * 14;
      if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
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

    ctx.font = '700 23px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = paletteV2.gold;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(cmp.title || "", x + 26, y + 36);

    ctx.font = '500 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = paletteV2.dangerText;
    wrapText(ctx, `❌ ${cmp.wrong}`, colW - 52)
      .slice(0, 2)
      .forEach((l, li) => {
        ctx.fillText(l, x + 26, y + 84 + li * 28);
      });

    ctx.fillStyle = "#6EE7B7";
    wrapText(ctx, `✅ ${cmp.right}`, colW - 52)
      .slice(0, 2)
      .forEach((l, li) => {
        ctx.fillText(l, x + 26, y + (showQuiz ? 148 : 164) + li * 28);
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
    ctx.fillText("⚡ CÂU HỎI NHANH DVA-C02", qx + 26, qy + 30);

    ctx.font = '700 22px "Be Vietnam Pro", Inter, sans-serif';
    ctx.fillStyle = "#F8FAFC";
    ctx.fillText(quiz.question || "", qx + 26, qy + 66);

    const optW = (qw - 72) / 2;
    (quiz.options || []).slice(0, 4).forEach((opt, oi) => {
      const oc = oi % 2;
      const or = Math.floor(oi / 2);
      const ox = qx + 26 + oc * (optW + 20);
      const oy = qy + 98 + or * 64;
      roundRect(ctx, ox, oy, optW, 52, 10);
      ctx.fillStyle = "#131E36";
      ctx.fill();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '600 18px "Be Vietnam Pro", Inter, sans-serif';
      ctx.fillStyle = "#E2E8F0";
      ctx.fillText(`${opt.key}. ${opt.text}`, ox + 16, oy + 26);
    });
    ctx.restore();
  }
}

function drawComparisonMatrixScene(ctx, W, H, scene, progress) {
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
  const rowH = Math.min(96, Math.max(58, Math.floor((rowsAreaH - rowGap * Math.max(0, rows.length - 1)) / Math.max(1, rows.length))));

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

function drawTimelineFlowScene(ctx, W, H, scene, progress) {
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

function drawKpiMetricsScene(ctx, W, H, scene, progress) {
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

function drawSceneFrame(
  ctx,
  W,
  H,
  script,
  scene,
  sceneIdx,
  sceneTime,
  sceneDur,
  globalTimeSec,
  globalProgress,
  fxState,
  speed = 1
) {
  const logicalW = LOGICAL_WIDTH;
  const logicalH = LOGICAL_HEIGHT;
  const dur = Math.max(0.1, sceneDur || scene.duration_sec || 1);
  const progress = clamp01(sceneTime / dur);
  const envelope = computeSceneEnvelope(sceneTime, dur);

  // Fill physical canvas bounds first to avoid 1px rounding seams on fractional scales (720p/1440p)
  ctx.save();
  ctx.fillStyle = paletteV2.bgBottom;
  ctx.fillRect(0, 0, W, H);
  ctx.scale(W / logicalW, H / logicalH);

  try {
    // Layer 0: V2 Navy-Cyan gradient + 60px blueprint grid + deterministic slow bokeh
    renderAmbientLayer(ctx, logicalW, logicalH, globalTimeSec, fxState.bokehSeeds, {
      drawBackground: true,
    });

    // Layer 1: Scene Header + Visual Content wrapped with Blur-to-Sharp Entrance, Exit Z-Recede, Dark Breather
    if (!envelope.inBreather && envelope.opacity > 0.005) {
      ctx.save();
      if (envelope.opacity < 0.999) {
        ctx.globalAlpha = envelope.opacity;
      }
      if (envelope.blurPx > 0.35) {
        ctx.filter = `blur(${envelope.blurPx.toFixed(1)}px)`;
      }
      if (Math.abs(envelope.scale - 1) > 0.0005) {
        ctx.translate(logicalW / 2, logicalH / 2);
        ctx.scale(envelope.scale, envelope.scale);
        ctx.translate(-logicalW / 2, -logicalH / 2);
      }

      drawTopBar(ctx, logicalW, script, scene);

      if (scene.visual_type === "console_setup") {
        drawConsoleScene(ctx, logicalW, logicalH, scene, progress, sceneTime, dur);
      } else if (scene.visual_type === "code_cli") {
        drawCodeCliScene(ctx, logicalW, logicalH, scene, progress, sceneTime);
      } else if (scene.visual_type === "exam_tips") {
        drawExamScene(ctx, logicalW, logicalH, scene, progress, sceneTime, dur);
      } else if (scene.visual_type === "comparison_matrix") {
        drawComparisonMatrixScene(ctx, logicalW, logicalH, scene, progress);
      } else if (scene.visual_type === "timeline_flow") {
        drawTimelineFlowScene(ctx, logicalW, logicalH, scene, progress);
      } else if (scene.visual_type === "kpi_metrics") {
        drawKpiMetricsScene(ctx, logicalW, logicalH, scene, progress);
      } else {
        drawArchitectureScene(ctx, logicalW, logicalH, scene, progress, sceneTime, dur, fxState.camera);
      }
      ctx.restore();
    }

    // Layer 2: Multi-color Sparkle Confetti Bursts on scene / major step transitions
    const dt = Math.max(0.001, Math.min(0.05, globalTimeSec - fxState.lastGlobalTime));
    fxState.lastGlobalTime = globalTimeSec;

    const burst = getSceneBurstInfo(scene, progress, logicalW, logicalH, sceneIdx);
    if (burst.key !== fxState.lastBurstKey && !envelope.inBreather) {
      fxState.lastBurstKey = burst.key;
      fxState.sparkles = fxState.sparkles.concat(createSparkleParticles(burst.cx, burst.cy, 24));
    }
    if (fxState.sparkles.length > 0) {
      fxState.sparkles = stepSparkleParticles(fxState.sparkles, dt);
      if (fxState.sparkles.length > 0) {
        renderSparkleBurst(ctx, fxState.sparkles);
      }
    }

    // Layer 3: Top 6px V2 Gradient Progress Bar & Box-Free Keyword-Highlighted Subtitles
    // Subtitles in script.json are authored in 1x audio seconds, so scale sceneTime by playback speed.
    drawTopProgressBar(ctx, logicalW, globalProgress);
    drawSubtitles(ctx, logicalW, logicalH, script, scene, sceneTime * speed);
  } finally {
    ctx.restore();
  }
}

const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const EXPORT_AUDIO_SAMPLE_RATE = 48_000;
const EXPORT_AUDIO_CHANNELS = 2;
const EXPORT_AUDIO_BITRATE = 128_000;

export const RESOLUTION_PRESETS = Object.freeze({
  "720p": Object.freeze({ id: "720p", width: 1280, height: 720, label: "HD 720p" }),
  "1080p": Object.freeze({ id: "1080p", width: 1920, height: 1080, label: "FHD 1080p" }),
  "1440p": Object.freeze({ id: "1440p", width: 2560, height: 1440, label: "2K 1440p" }),
  "2160p": Object.freeze({ id: "2160p", width: 3840, height: 2160, label: "4K 2160p" }),
});

export const FPS_PRESETS = Object.freeze([24, 30, 60]);
export const SPEED_PRESETS = Object.freeze([1, 1.25, 1.5, 2]);
export const HARDWARE_MODES = Object.freeze(["auto", "gpu", "cpu"]);

export const FORMAT_CODEC_PRESETS = Object.freeze({
  "mp4:h264": Object.freeze({ format: "mp4", codec: "h264", ext: "mp4", mimeType: "video/mp4" }),
  "mp4:hevc": Object.freeze({ format: "mp4", codec: "hevc", ext: "mp4", mimeType: "video/mp4" }),
  "webm:vp9": Object.freeze({ format: "webm", codec: "vp9", ext: "webm", mimeType: "video/webm" }),
});

const BASE_60FPS_BITRATES = Object.freeze({
  "720p": 6_000_000,
  "1080p": 12_000_000,
  "1440p": 20_000_000,
  "2160p": 36_000_000,
});

export function computeTargetVideoBitrate({ resolution = "1080p", fps = 60, codec = "h264" } = {}) {
  const resKey = RESOLUTION_PRESETS[resolution] ? resolution : "1080p";
  const base60 = BASE_60FPS_BITRATES[resKey] || 12_000_000;
  const numFps = Number(fps) || 60;
  const fpsMul = numFps <= 24 ? 0.55 : numFps <= 30 ? 0.65 : 1.0;
  const normCodec = String(codec || "h264").toLowerCase();
  const codecMul = normCodec === "hevc" || normCodec === "vp9" ? 0.75 : 1.0;
  return Math.round(base60 * fpsMul * codecMul);
}

export function normalizeExportOptions({
  format,
  codec,
  hardware = "auto",
  resolution = "1080p",
  fps = 60,
  speed = 1,
} = {}) {
  let normFormat = format ? String(format).trim().toLowerCase() : "";
  let normCodec = codec ? String(codec).trim().toLowerCase() : "";

  if (normCodec === "avc" || normCodec === "h.264") normCodec = "h264";
  if (normCodec === "h265" || normCodec === "h.265") normCodec = "hevc";

  if (!normFormat && !normCodec) {
    normFormat = "mp4";
    normCodec = "h264";
  } else if (normFormat === "mp4" && !normCodec) {
    normCodec = "h264";
  } else if (normFormat === "webm" && !normCodec) {
    normCodec = "vp9";
  } else if (!normFormat && normCodec) {
    normFormat = normCodec === "vp9" ? "webm" : "mp4";
  }

  const pairKey = `${normFormat}:${normCodec}`;
  if (!FORMAT_CODEC_PRESETS[pairKey]) {
    throw new Error(
      `Định dạng/codec không hợp lệ: format="${normFormat}", codec="${normCodec}". Hỗ trợ: mp4 (h264, hevc) hoặc webm (vp9).`
    );
  }

  const normHardware = String(hardware || "auto").trim().toLowerCase();
  if (!HARDWARE_MODES.includes(normHardware)) {
    throw new Error(`Chế độ hardware không hợp lệ: "${hardware}". Hỗ trợ: auto, gpu, cpu.`);
  }

  const normResolution = String(resolution || "1080p").trim().toLowerCase();
  const resPreset = RESOLUTION_PRESETS[normResolution];
  if (!resPreset) {
    throw new Error(`Độ phân giải không hợp lệ: "${resolution}". Hỗ trợ: 720p, 1080p, 1440p, 2160p.`);
  }

  const normFps = Number(fps ?? 60);
  if (!FPS_PRESETS.includes(normFps)) {
    throw new Error(`FPS không hợp lệ: "${fps}". Hỗ trợ: 24, 30, 60.`);
  }

  const rawSpeed = Number(speed ?? 1);
  const matchedSpeed = SPEED_PRESETS.find((s) => Math.abs(s - rawSpeed) < 1e-6);
  if (!matchedSpeed) {
    throw new Error(`Tốc độ không hợp lệ: "${speed}". Hỗ trợ: 1, 1.25, 1.5, 2.`);
  }

  return {
    format: normFormat,
    codec: normCodec,
    ext: FORMAT_CODEC_PRESETS[pairKey].ext,
    mimeType: FORMAT_CODEC_PRESETS[pairKey].mimeType,
    hardware: normHardware,
    resolution: normResolution,
    width: resPreset.width,
    height: resPreset.height,
    fps: normFps,
    speed: matchedSpeed,
    bitrate: computeTargetVideoBitrate({ resolution: normResolution, fps: normFps, codec: normCodec }),
  };
}

const WSOLA_WINDOW_MS = 40;
const WSOLA_SEARCH_MS = 15;

/**
 * Compute WSOLA read positions using 50% overlap Hann window and coarse-to-fine
 * normalized cross-correlation (NCC) search.
 */
function computeWsolaPlan(refChannel, rate, sampleRate = EXPORT_AUDIO_SAMPLE_RATE) {
  const inputLen = refChannel?.length || 0;
  const safeRate = Number(rate);
  if (!Number.isFinite(safeRate) || safeRate <= 0) {
    throw new Error(`Tốc độ time-stretch không hợp lệ: ${rate}`);
  }
  if (inputLen <= 0) {
    return { winLen: 0, hopOut: 0, outLen: 0, window: new Float32Array(0), offsets: null };
  }

  const outLen = Math.max(1, Math.round(inputLen / safeRate));
  const halfWin = Math.max(64, Math.round((WSOLA_WINDOW_MS / 2000) * sampleRate));
  const winLen = halfWin * 2;
  const hopOut = halfWin;
  const searchRadius = Math.max(16, Math.round((WSOLA_SEARCH_MS / 1000) * sampleRate));

  const window = new Float32Array(winLen);
  for (let n = 0; n < winLen; n++) {
    window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / winLen));
  }

  if (inputLen <= winLen || Math.abs(safeRate - 1) < 1e-4) {
    return { winLen, hopOut, outLen, window, offsets: null };
  }

  const maxStart = inputLen - winLen;
  const numFrames = Math.ceil(outLen / hopOut);
  const offsets = new Int32Array(numFrames);
  offsets[0] = 0;

  const ovLen = hopOut;
  const coarseStep = 4;
  const innerCoarseStep = 2;

  for (let m = 1; m < numFrames; m++) {
    const outPos = m * hopOut;
    const nomPos = Math.min(maxStart, Math.max(0, Math.round(outPos * safeRate)));
    const natPos = Math.min(maxStart, offsets[m - 1] + hopOut);

    let tmplEnergy = 0;
    for (let j = 0; j < ovLen; j++) {
      const s = refChannel[natPos + j];
      tmplEnergy += s * s;
    }

    if (tmplEnergy < 1e-9) {
      offsets[m] = nomPos;
      continue;
    }

    const searchMin = Math.max(0, nomPos - searchRadius);
    const searchMax = Math.min(maxStart, nomPos + searchRadius);

    let bestPos = nomPos;
    let bestScore = -Infinity;
    for (let cand = searchMin; cand <= searchMax; cand += coarseStep) {
      let dot = 0;
      let candEnergy = 0;
      for (let j = 0; j < ovLen; j += innerCoarseStep) {
        const a = refChannel[natPos + j];
        const b = refChannel[cand + j];
        dot += a * b;
        candEnergy += b * b;
      }
      const score = candEnergy > 1e-11 ? dot / Math.sqrt(candEnergy) : -Infinity;
      if (score > bestScore) {
        bestScore = score;
        bestPos = cand;
      }
    }

    const fineMin = Math.max(searchMin, bestPos - coarseStep);
    const fineMax = Math.min(searchMax, bestPos + coarseStep);
    let fineBestPos = bestPos;
    let fineBestScore = -Infinity;
    for (let cand = fineMin; cand <= fineMax; cand++) {
      let dot = 0;
      let candEnergy = 0;
      for (let j = 0; j < ovLen; j++) {
        const a = refChannel[natPos + j];
        const b = refChannel[cand + j];
        dot += a * b;
        candEnergy += b * b;
      }
      const score = candEnergy > 1e-11 ? dot / Math.sqrt(candEnergy) : -Infinity;
      if (score > fineBestScore) {
        fineBestScore = score;
        fineBestPos = cand;
      }
    }

    offsets[m] = fineBestScore === -Infinity ? nomPos : fineBestPos;
  }

  return { winLen, hopOut, outLen, window, offsets };
}

function synthesizeWsolaChannel(inputFloat32, plan, rate) {
  const inputLen = inputFloat32?.length || 0;
  if (inputLen === 0) return new Float32Array(0);

  const { winLen, hopOut, outLen, window, offsets } = plan;
  if (!offsets) {
    if (Math.abs(rate - 1) < 1e-4) {
      return new Float32Array(inputFloat32);
    }
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = Math.min(inputLen - 1, i * rate);
      const i0 = Math.floor(srcIdx);
      const i1 = Math.min(inputLen - 1, i0 + 1);
      const frac = srcIdx - i0;
      out[i] = inputFloat32[i0] * (1 - frac) + inputFloat32[i1] * frac;
    }
    return out;
  }

  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  // Keep frame 0 initial attack at unity gain; taper only its right half for overlap
  const firstLimit = Math.min(winLen, outLen);
  for (let j = 0; j < firstLimit; j++) {
    const w = j < hopOut ? 1.0 : window[j];
    out[j] += inputFloat32[j] * w;
    norm[j] += w;
  }

  for (let m = 1; m < offsets.length; m++) {
    const outPos = m * hopOut;
    const inPos = offsets[m];
    const limit = Math.min(winLen, outLen - outPos, inputLen - inPos);
    for (let j = 0; j < limit; j++) {
      const w = window[j];
      out[outPos + j] += inputFloat32[inPos + j] * w;
      norm[outPos + j] += w;
    }
  }

  for (let i = 0; i < outLen; i++) {
    if (norm[i] > 1e-6) {
      const s = out[i] / norm[i];
      out[i] = s > 1 ? 1 : s < -1 ? -1 : s;
    }
  }

  return out;
}

/**
 * Pure-JS WSOLA pitch-preserving time-stretch for a single Float32Array channel.
 */
export function timeStretchChannel(inputFloat32, rate, sampleRate = EXPORT_AUDIO_SAMPLE_RATE) {
  const src = inputFloat32 instanceof Float32Array ? inputFloat32 : new Float32Array(inputFloat32 || 0);
  const safeRate = Number(rate ?? 1);
  if (Math.abs(safeRate - 1) < 1e-4) {
    return new Float32Array(src);
  }
  const plan = computeWsolaPlan(src, safeRate, sampleRate);
  return synthesizeWsolaChannel(src, plan, safeRate);
}

/**
 * Pure-JS WSOLA pitch-preserving time-stretch for an AudioBuffer (mono/stereo/multi-channel).
 * Computes shared hop alignment from a mono mix so stereo phase stays locked.
 */
export function timeStretchAudioBuffer(audioBuffer, rate, opts = {}) {
  const safeRate = Number(rate ?? 1);
  if (!audioBuffer || Math.abs(safeRate - 1) < 1e-4) {
    return audioBuffer;
  }

  const numChannels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const len = audioBuffer.length || 0;
  const sr =
    (typeof opts === "number" ? opts : opts?.sampleRate) ||
    audioBuffer.sampleRate ||
    EXPORT_AUDIO_SAMPLE_RATE;

  let refChannel;
  if (numChannels === 1) {
    refChannel = audioBuffer.getChannelData(0);
  } else {
    refChannel = new Float32Array(len);
    const inv = 1 / numChannels;
    for (let c = 0; c < numChannels; c++) {
      const chData = audioBuffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        refChannel[i] += chData[i] * inv;
      }
    }
  }

  const plan = computeWsolaPlan(refChannel, safeRate, sr);
  const stretchedChannels = [];
  for (let c = 0; c < numChannels; c++) {
    stretchedChannels.push(synthesizeWsolaChannel(audioBuffer.getChannelData(c), plan, safeRate));
  }
  const outLen = stretchedChannels[0]?.length || 1;

  const ctx = typeof opts === "object" ? opts?.audioContext : null;
  if (ctx && typeof ctx.createBuffer === "function") {
    const outBuf = ctx.createBuffer(numChannels, outLen, sr);
    for (let c = 0; c < numChannels; c++) {
      outBuf.copyToChannel
        ? outBuf.copyToChannel(stretchedChannels[c], c)
        : outBuf.getChannelData(c).set(stretchedChannels[c]);
    }
    return outBuf;
  }

  if (typeof OfflineAudioContext === "function") {
    const tmpCtx = new OfflineAudioContext(numChannels, outLen, sr);
    const outBuf = tmpCtx.createBuffer(numChannels, outLen, sr);
    for (let c = 0; c < numChannels; c++) {
      outBuf.getChannelData(c).set(stretchedChannels[c]);
    }
    return outBuf;
  }

  return {
    numberOfChannels: numChannels,
    length: outLen,
    sampleRate: sr,
    duration: outLen / sr,
    getChannelData: (c) => stretchedChannels[c],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInitialFxState(W, H) {
  return {
    bokehSeeds: createBokehSeeds(22),
    sparkles: [],
    lastBurstKey: null,
    lastGlobalTime: 0,
    camera: {
      stepKey: null,
      fromX: W / 2,
      fromY: H / 2,
      fromZoom: 1,
      currX: W / 2,
      currY: H / 2,
      currZoom: 1,
      startTime: 0,
    },
  };
}

async function loadMuxerModule(format) {
  if (format === "mp4") {
    return import("https://esm.sh/mp4-muxer@5.1.4");
  }
  try {
    return await import("webm-muxer");
  } catch {
    return import("https://esm.sh/webm-muxer@5.1.4");
  }
}

function getVideoCodecCandidates(codec, width, height, fps) {
  if (codec === "hevc") {
    if (width >= 3840 && fps > 30) {
      return ["hvc1.1.6.L153.90", "hvc1.1.6.L150.90", "hvc1.1.6.L123.90", "hvc1.1.6.L120.90"];
    }
    if (width >= 2560 || height >= 1440) {
      return ["hvc1.1.6.L150.90", "hvc1.1.6.L153.90", "hvc1.1.6.L123.90", "hvc1.1.6.L120.90"];
    }
    return ["hvc1.1.6.L123.90", "hvc1.1.6.L120.90", "hvc1.1.6.L150.90", "hvc1.1.6.L153.90"];
  }

  if (codec === "vp9") {
    if (width >= 3840) {
      return ["vp09.00.51.08", "vp09.00.50.08", "vp09.00.41.08", "vp09.00.10.08"];
    }
    if (width >= 2560 || height >= 1440) {
      return ["vp09.00.50.08", "vp09.00.51.08", "vp09.00.41.08", "vp09.00.10.08"];
    }
    return ["vp09.00.41.08", "vp09.00.50.08", "vp09.00.51.08", "vp09.00.10.08"];
  }

  // h264
  if (width >= 3840 && fps > 30) {
    return ["avc1.640034", "avc1.640033", "avc1.4d0033", "avc1.64002a", "avc1.4d002a"];
  }
  if (width >= 2560 || height >= 1440) {
    return ["avc1.640033", "avc1.4d0033", "avc1.640034", "avc1.64002a", "avc1.4d002a"];
  }
  return ["avc1.64002a", "avc1.4d002a", "avc1.640033", "avc1.4d0033", "avc1.640034"];
}

function getHardwarePreferenceOrder(codec, hardware) {
  if (hardware === "gpu") return ["prefer-hardware"];
  if (hardware === "cpu") return ["prefer-software"];
  // auto: probe showed VP9 prefer-hardware returns supported:false on AMD RX 9070 XT, so use no-preference for VP9
  if (codec === "vp9") return ["no-preference"];
  return ["prefer-hardware", "no-preference"];
}

export async function resolveWebCodecsProfile(options = "mp4") {
  const rawOpts = typeof options === "string" ? { format: options } : options || {};
  const opts = normalizeExportOptions(rawOpts);

  if (
    typeof VideoEncoder !== "function" ||
    typeof AudioEncoder !== "function" ||
    typeof VideoFrame !== "function" ||
    typeof AudioData !== "function" ||
    typeof VideoEncoder.isConfigSupported !== "function" ||
    typeof AudioEncoder.isConfigSupported !== "function"
  ) {
    return null;
  }

  const codecCandidates = getVideoCodecCandidates(opts.codec, opts.width, opts.height, opts.fps);
  const hwOrder = getHardwarePreferenceOrder(opts.codec, opts.hardware);

  let videoConfig = null;
  let resolvedHardwareAcceleration = hwOrder[0];

  for (const hwPref of hwOrder) {
    for (const codecString of codecCandidates) {
      const cfg = {
        codec: codecString,
        width: opts.width,
        height: opts.height,
        bitrate: opts.bitrate,
        framerate: opts.fps,
        hardwareAcceleration: hwPref,
      };
      try {
        const res = await VideoEncoder.isConfigSupported(cfg);
        if (res?.supported) {
          videoConfig = cfg;
          resolvedHardwareAcceleration = hwPref;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
    if (videoConfig) break;
  }

  if (!videoConfig) {
    if (opts.hardware === "gpu") {
      if (opts.codec === "vp9") {
        throw new Error(
          "GPU hardware encode trong Chrome chỉ hỗ trợ H.264 / HEVC MP4 (VP9 không hỗ trợ prefer-hardware). Hãy chuyển sang MP4 (H.264/HEVC) hoặc chọn CPU / Auto."
        );
      }
      throw new Error(
        `GPU hardware encode (${opts.codec.toUpperCase()}) ở ${opts.resolution} ${opts.fps}fps không được hỗ trợ trên thiết bị/trình duyệt này. Hãy thử chế độ Auto hoặc CPU (H.264).`
      );
    }
    if (opts.hardware === "cpu") {
      if (opts.codec === "hevc") {
        throw new Error(
          "HEVC (H.265) trong Chrome yêu cầu GPU hardware encode (prefer-software không được hỗ trợ). Hãy dùng H.264 (MP4) hoặc VP9 (WebM) cho CPU, hoặc chuyển sang GPU / Auto."
        );
      }
      throw new Error(
        `CPU software encode (${opts.codec.toUpperCase()}) ở ${opts.resolution} ${opts.fps}fps không được trình duyệt hỗ trợ (prefer-software: false).`
      );
    }
    throw new Error(
      `Trình duyệt không hỗ trợ WebCodecs ${opts.codec.toUpperCase()} (${opts.format.toUpperCase()}) ở ${opts.resolution} ${opts.fps}fps.`
    );
  }

  let audioConfig = null;
  let muxerAudioCodec = opts.format === "mp4" ? "aac" : "A_OPUS";

  if (opts.format === "mp4") {
    const aacCfg = {
      codec: "mp4a.40.2",
      numberOfChannels: EXPORT_AUDIO_CHANNELS,
      sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      bitrate: EXPORT_AUDIO_BITRATE,
    };
    try {
      const aRes = await AudioEncoder.isConfigSupported(aacCfg);
      if (aRes?.supported) {
        audioConfig = aacCfg;
        muxerAudioCodec = "aac";
      }
    } catch {
      // Fallback below
    }
    if (!audioConfig) {
      const opusCfg = {
        codec: "opus",
        numberOfChannels: EXPORT_AUDIO_CHANNELS,
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        bitrate: EXPORT_AUDIO_BITRATE,
      };
      try {
        const oRes = await AudioEncoder.isConfigSupported(opusCfg);
        if (oRes?.supported) {
          audioConfig = opusCfg;
          muxerAudioCodec = "opus";
        }
      } catch {
        // Ignore
      }
    }
  } else {
    const opusCfg = {
      codec: "opus",
      numberOfChannels: EXPORT_AUDIO_CHANNELS,
      sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      bitrate: EXPORT_AUDIO_BITRATE,
    };
    try {
      const aRes = await AudioEncoder.isConfigSupported(opusCfg);
      if (aRes?.supported) {
        audioConfig = opusCfg;
        muxerAudioCodec = "A_OPUS";
      }
    } catch {
      // Ignore
    }
  }

  if (!audioConfig) {
    throw new Error(`Trình duyệt không hỗ trợ AudioEncoder cho định dạng ${opts.format.toUpperCase()}.`);
  }

  const muxerVideoCodec =
    opts.format === "mp4"
      ? opts.codec === "hevc"
        ? "hevc"
        : "avc"
      : "V_VP9";

  return {
    ...opts,
    hardwareAcceleration: resolvedHardwareAcceleration,
    videoConfig,
    audioConfig,
    muxerVideoCodec,
    muxerAudioCodec,
  };
}

async function decodeSceneAudioBuffers(episode, scenes, onProgress, speed = 1) {
  const decodeCtx = new OfflineAudioContext(EXPORT_AUDIO_CHANNELS, 1, EXPORT_AUDIO_SAMPLE_RATE);
  const buffers = [];
  const needStretch = Math.abs(speed - 1) >= 1e-4;

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    onProgress?.({
      phase: "loading",
      label: needStretch
        ? `Đang tải & xử lý âm thanh ${speed}x cảnh ${i + 1}/${scenes.length}...`
        : `Đang tải âm thanh cảnh ${i + 1}/${scenes.length}...`,
      percent: 5 + Math.round((i / scenes.length) * 15),
    });

    if (!sc.audio_file) {
      const origDur = Number(sc.duration_sec) || 5;
      const silentFrames = Math.max(1, Math.round((origDur / speed) * EXPORT_AUDIO_SAMPLE_RATE));
      buffers.push(decodeCtx.createBuffer(EXPORT_AUDIO_CHANNELS, silentFrames, EXPORT_AUDIO_SAMPLE_RATE));
      continue;
    }

    const resp = await fetch(`${episode.base_url}/${sc.audio_file}`);
    if (!resp.ok) {
      throw new Error(`Không thể tải audio ${sc.audio_file} (HTTP ${resp.status})`);
    }
    const arr = await resp.arrayBuffer();
    const decoded = await decodeCtx.decodeAudioData(arr);

    let normalizedBuf;
    if (
      decoded.sampleRate === EXPORT_AUDIO_SAMPLE_RATE &&
      decoded.numberOfChannels === EXPORT_AUDIO_CHANNELS
    ) {
      normalizedBuf = decoded;
    } else {
      const targetFrames = Math.max(1, Math.round(decoded.duration * EXPORT_AUDIO_SAMPLE_RATE));
      const resampleCtx = new OfflineAudioContext(
        EXPORT_AUDIO_CHANNELS,
        targetFrames,
        EXPORT_AUDIO_SAMPLE_RATE
      );
      const src = resampleCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(resampleCtx.destination);
      src.start(0);
      normalizedBuf = await resampleCtx.startRendering();
    }

    if (needStretch) {
      normalizedBuf = timeStretchAudioBuffer(normalizedBuf, speed, {
        audioContext: decodeCtx,
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
      });
    }
    buffers.push(normalizedBuf);
  }

  return buffers;
}

export function resolveOutputFilename(rawName, episodeId, actualExt = "webm") {
  const safeExt = String(actualExt || "").toLowerCase() === "mp4" ? "mp4" : "webm";
  const fallbackStem =
    String(episodeId || "video")
      .trim()
      .replace(/[\\/]+/g, "")
      .replace(/\.(mp4|webm)$/i, "") || "video";

  let stem = String(rawName ?? "").trim();
  // Strip path separators and parent-traversal sequences safely
  stem = stem.replace(/[\\/]+/g, "").replace(/\.\.+/g, ".");
  while (/\.(mp4|webm)$/i.test(stem)) {
    stem = stem.replace(/\.(mp4|webm)$/i, "");
  }
  stem = stem.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  stem = stem.replace(/^\.+/, "").slice(0, 96);
  if (!stem || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,95}$/.test(stem)) {
    stem = fallbackStem;
  }
  return `${stem}.${safeExt}`;
}

async function saveVideoToServer(courseId, episodeId, ext, blob, mimeType, rawFilename) {
  const safeExt = ext === "mp4" ? "mp4" : "webm";
  const resolvedMime = mimeType || (safeExt === "mp4" ? "video/mp4" : "video/webm");
  const filename = resolveOutputFilename(rawFilename, episodeId, safeExt);
  const saveResp = await fetch(
    `/api/save-video?course=${encodeURIComponent(courseId)}&episode=${encodeURIComponent(episodeId)}&ext=${encodeURIComponent(safeExt)}&filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": resolvedMime,
        "X-Video-Filename": filename,
      },
      body: blob,
    }
  );
  if (!saveResp.ok) {
    let detail = `HTTP ${saveResp.status}`;
    try {
      const body = await saveResp.json();
      if (body?.error) detail = body.error;
    } catch {
      // Ignore parse error
    }
    throw new Error(detail);
  }
  return saveResp.json();
}

async function exportEpisodeMediaRecorder({
  courseId,
  episode,
  resolution = "1080p",
  fps = 60,
  speed = 1,
  outputFilename,
  filename,
  onProgress,
  throwOnSaveError = false,
}) {
  const opts = normalizeExportOptions({ format: "webm", codec: "vp9", hardware: "auto", resolution, fps, speed });
  const script = episode.script;
  const scenes = script.scenes || [];
  if (!scenes.length) throw new Error("Tập học chưa có phân cảnh nào.");

  const W = opts.width;
  const H = opts.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const needStretch = Math.abs(opts.speed - 1) >= 1e-4;

  // Decode & optionally WSOLA-stretch all scene audio buffers upfront so timing is exact
  const buffers = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    onProgress?.({
      phase: "loading",
      label: `Đang tải âm thanh cảnh ${i + 1}/${scenes.length}...`,
      percent: 5 + Math.round((i / scenes.length) * 15),
    });
    if (!sc.audio_file) {
      const origDur = Number(sc.duration_sec) || 5;
      const silentFrames = Math.max(1, Math.round((origDur / opts.speed) * audioCtx.sampleRate));
      buffers.push(audioCtx.createBuffer(EXPORT_AUDIO_CHANNELS, silentFrames, audioCtx.sampleRate));
      continue;
    }
    const resp = await fetch(`${episode.base_url}/${sc.audio_file}`);
    if (!resp.ok) {
      throw new Error(`Không thể tải audio ${sc.audio_file} (HTTP ${resp.status})`);
    }
    const arr = await resp.arrayBuffer();
    let decoded = await audioCtx.decodeAudioData(arr);
    if (needStretch) {
      decoded = timeStretchAudioBuffer(decoded, opts.speed, {
        audioContext: audioCtx,
        sampleRate: decoded.sampleRate,
      });
    }
    buffers.push(decoded);
  }

  const videoStream = canvas.captureStream(opts.fps);
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: opts.bitrate,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const sceneDurs = buffers.map((b) => b.length / b.sampleRate);
  const totalDur = sceneDurs.reduce((acc, d) => acc + d, 0);
  const stoppedPromise = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });

  const fxState = createInitialFxState(LOGICAL_WIDTH, LOGICAL_HEIGHT);
  recorder.start(250);

  let elapsedBefore = 0;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const buf = buffers[i];
    const dur = sceneDurs[i];

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();

    const startPerf = performance.now();
    await new Promise((resolve) => {
      function tick() {
        const sceneTime = (performance.now() - startPerf) / 1000;
        const clampedSceneTime = Math.min(sceneTime, dur);
        const globalTimeSec = elapsedBefore + clampedSceneTime;
        const globalProg = globalTimeSec / Math.max(0.1, totalDur);

        drawSceneFrame(
          ctx,
          W,
          H,
          script,
          sc,
          i,
          clampedSceneTime,
          dur,
          globalTimeSec,
          globalProg,
          fxState,
          opts.speed
        );

        onProgress?.({
          phase: "recording",
          label: `Đang xuất cảnh ${i + 1}/${scenes.length} (${Math.round(globalProg * 100)}%)`,
          percent: 20 + Math.round(globalProg * 75),
        });
        if (sceneTime >= dur) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    });

    elapsedBefore += dur;
  }

  recorder.stop();
  const blob = await stoppedPromise;
  await audioCtx.close();

  const resolvedFilename = resolveOutputFilename(outputFilename ?? filename, episode.id, "webm");
  onProgress?.({ phase: "saving", label: `Đang lưu file ${resolvedFilename} vào ổ đĩa...`, percent: 97 });
  let saved = null;
  try {
    saved = await saveVideoToServer(courseId, episode.id, "webm", blob, "video/webm", resolvedFilename);
    onProgress?.({ phase: "done", label: `Đã lưu thành công: ${saved.path}`, percent: 100 });
  } catch (err) {
    if (throwOnSaveError) throw err;
    onProgress?.({
      phase: "done",
      label: `Đã xuất ${resolvedFilename} (tải trực tiếp qua trình duyệt; lưu server thất bại: ${err.message})`,
      percent: 100,
    });
  }
  const savedFile = saved?.file || resolvedFilename;
  return {
    blob,
    saved,
    savedFile,
    format: "webm",
    ext: "webm",
    codec: "vp9",
    hardware: "auto",
    resolution: opts.resolution,
    width: W,
    height: H,
    fps: opts.fps,
    speed: opts.speed,
    mimeType: "video/webm",
    filename: savedFile,
    durationSec: totalDur,
    bytes: blob.size,
  };
}

export async function exportEpisodeFast({
  courseId,
  episode,
  format = "mp4",
  codec,
  hardware = "auto",
  resolution = "1080p",
  fps = 60,
  speed = 1,
  outputFilename,
  filename,
  onProgress,
  throwOnSaveError = false,
}) {
  const script = episode?.script;
  const scenes = script?.scenes || [];
  if (!scenes.length) throw new Error("Tập học chưa có phân cảnh nào.");

  const requestedFilename = outputFilename ?? filename;
  const profile = await resolveWebCodecsProfile({ format, codec, hardware, resolution, fps, speed });
  if (!profile) {
    onProgress?.({
      phase: "starting",
      label: "WebCodecs không khả dụng, chuyển sang MediaRecorder dự phòng...",
      percent: 3,
    });
    return exportEpisodeMediaRecorder({
      courseId,
      episode,
      resolution,
      fps,
      speed,
      outputFilename: requestedFilename,
      onProgress,
      throwOnSaveError,
    });
  }

  const W = profile.width;
  const H = profile.height;
  const outFps = profile.fps;
  const outSpeed = profile.speed;

  onProgress?.({
    phase: "starting",
    label: `Đang nạp muxer ${profile.format.toUpperCase()} (${profile.videoConfig.codec}, ${W}x${H}@${outFps}fps, ${outSpeed}x, ${profile.hardwareAcceleration})...`,
    percent: 3,
  });

  const MuxerPkg = await loadMuxerModule(profile.format);
  const buffers = await decodeSceneAudioBuffers(episode, scenes, onProgress, outSpeed);

  const sceneDurs = buffers.map((b) => b.length / EXPORT_AUDIO_SAMPLE_RATE);
  const sceneStarts = [];
  const sceneEnds = [];
  let accDur = 0;
  for (const d of sceneDurs) {
    sceneStarts.push(accDur);
    accDur += d;
    sceneEnds.push(accDur);
  }
  const totalDur = accDur;
  const totalFrames = Math.max(1, Math.ceil(totalDur * outFps));

  const target = new MuxerPkg.ArrayBufferTarget();
  const muxer =
    profile.format === "mp4"
      ? new MuxerPkg.Muxer({
          target,
          video: { codec: profile.muxerVideoCodec, width: W, height: H, frameRate: outFps },
          audio: {
            codec: profile.muxerAudioCodec,
            numberOfChannels: EXPORT_AUDIO_CHANNELS,
            sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
          },
          fastStart: "in-memory",
          firstTimestampBehavior: "offset",
        })
      : new MuxerPkg.Muxer({
          target,
          video: { codec: profile.muxerVideoCodec, width: W, height: H, frameRate: outFps },
          audio: {
            codec: profile.muxerAudioCodec,
            numberOfChannels: EXPORT_AUDIO_CHANNELS,
            sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
          },
          firstTimestampBehavior: "offset",
        });

  let encoderError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (err) {
        encoderError = err;
      }
    },
    error: (err) => {
      encoderError = err;
    },
  });
  videoEncoder.configure(profile.videoConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addAudioChunk(chunk, meta);
      } catch (err) {
        encoderError = err;
      }
    },
    error: (err) => {
      encoderError = err;
    },
  });
  audioEncoder.configure(profile.audioConfig);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const fxState = createInitialFxState(LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Interleaved audio + video encoding cursor so muxer Clusters stay strictly monotonic
  const AUDIO_CHUNK_SAMPLES = 4096;
  let audioSceneIdx = 0;
  let audioOffsetInScene = 0;
  let audioSampleCursor = 0;

  function encodeAudioUpToSample(targetSample) {
    while (audioSceneIdx < buffers.length && audioSampleCursor < targetSample) {
      if (encoderError) throw encoderError;
      const buf = buffers[audioSceneIdx];
      const remainingInScene = buf.length - audioOffsetInScene;
      if (remainingInScene <= 0) {
        audioSceneIdx++;
        audioOffsetInScene = 0;
        continue;
      }
      const count = Math.min(AUDIO_CHUNK_SAMPLES, remainingInScene);
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      const planar = new Float32Array(count * 2);
      planar.set(ch0.subarray(audioOffsetInScene, audioOffsetInScene + count), 0);
      planar.set(ch1.subarray(audioOffsetInScene, audioOffsetInScene + count), count);

      const timestampUs = Math.round((audioSampleCursor / EXPORT_AUDIO_SAMPLE_RATE) * 1_000_000);
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        numberOfFrames: count,
        numberOfChannels: EXPORT_AUDIO_CHANNELS,
        timestamp: timestampUs,
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();

      audioOffsetInScene += count;
      audioSampleCursor += count;
    }
  }

  try {
    let sceneCursor = 0;
    let lastLoggedPct = -1;

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (encoderError) throw encoderError;

      const globalTimeSec = frameIdx / outFps;
      while (sceneCursor < scenes.length - 1 && globalTimeSec >= sceneEnds[sceneCursor]) {
        sceneCursor++;
      }

      const sc = scenes[sceneCursor];
      const dur = Math.max(0.1, sceneDurs[sceneCursor]);
      const sceneTime = Math.max(0, Math.min(dur, globalTimeSec - sceneStarts[sceneCursor]));
      const globalProg = clamp01(globalTimeSec / Math.max(0.1, totalDur));

      drawSceneFrame(
        ctx,
        W,
        H,
        script,
        sc,
        sceneCursor,
        sceneTime,
        dur,
        globalTimeSec,
        globalProg,
        fxState,
        outSpeed
      );

      const timestampUs = Math.round((frameIdx * 1_000_000) / outFps);
      const nextTimestampUs = Math.round(((frameIdx + 1) * 1_000_000) / outFps);
      const frame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: Math.max(1, nextTimestampUs - timestampUs),
      });
      videoEncoder.encode(frame, { keyFrame: frameIdx % (outFps * 2) === 0 });
      frame.close();

      const targetAudioSample = Math.round(((frameIdx + 1) / outFps) * EXPORT_AUDIO_SAMPLE_RATE);
      encodeAudioUpToSample(targetAudioSample);

      const pct = 20 + Math.round((frameIdx / totalFrames) * 75);
      if (pct !== lastLoggedPct && (frameIdx % 15 === 0 || frameIdx === totalFrames - 1)) {
        lastLoggedPct = pct;
        onProgress?.({
          phase: "recording",
          label: `Render ${profile.format.toUpperCase()} (${profile.resolution} ${outFps}fps) — cảnh ${sceneCursor + 1}/${scenes.length} (${Math.round(globalProg * 100)}%)`,
          percent: pct,
        });
      }

      while (videoEncoder.encodeQueueSize > 6 || audioEncoder.encodeQueueSize > 16) {
        if (encoderError) throw encoderError;
        await sleep(2);
      }
      if (frameIdx % 12 === 0) {
        await sleep(0);
      }
    }

    // Flush any remaining trailing audio samples
    encodeAudioUpToSample(Number.MAX_SAFE_INTEGER);
    if (encoderError) throw encoderError;

    onProgress?.({ phase: "recording", label: "Đang đóng gói video (muxing)...", percent: 96 });
    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    if (encoderError) throw encoderError;
  } finally {
    if (videoEncoder.state !== "closed") videoEncoder.close();
    if (audioEncoder.state !== "closed") audioEncoder.close();
  }

  muxer.finalize();
  const blob = new Blob([target.buffer], { type: profile.mimeType });
  const resolvedFilename = resolveOutputFilename(requestedFilename, episode.id, profile.ext);

  onProgress?.({
    phase: "saving",
    label: `Đang lưu file ${resolvedFilename} vào ổ đĩa...`,
    percent: 98,
  });

  let saved = null;
  try {
    saved = await saveVideoToServer(courseId, episode.id, profile.ext, blob, profile.mimeType, resolvedFilename);
    onProgress?.({ phase: "done", label: `Đã lưu thành công: ${saved.path}`, percent: 100 });
  } catch (err) {
    if (throwOnSaveError) throw err;
    onProgress?.({
      phase: "done",
      label: `Đã xuất ${resolvedFilename} (tải trực tiếp qua trình duyệt; lưu server thất bại: ${err.message})`,
      percent: 100,
    });
  }

  const savedFile = saved?.file || resolvedFilename;
  return {
    blob,
    saved,
    savedFile,
    format: profile.format,
    ext: profile.ext,
    codec: profile.codec,
    hardware: profile.hardware,
    hardwareAcceleration: profile.hardwareAcceleration,
    resolution: profile.resolution,
    width: W,
    height: H,
    fps: outFps,
    speed: outSpeed,
    mimeType: profile.mimeType,
    filename: savedFile,
    durationSec: totalDur,
    bytes: blob.size,
  };
}

export async function exportEpisodeVideo({
  courseId,
  episode,
  onProgress,
  format = "mp4",
  codec,
  hardware = "auto",
  resolution = "1080p",
  fps = 60,
  speed = 1,
  outputFilename,
  filename,
}) {
  return exportEpisodeFast({
    courseId,
    episode,
    format,
    codec,
    hardware,
    resolution,
    fps,
    speed,
    outputFilename,
    filename,
    onProgress,
    throwOnSaveError: false,
  });
}

if (typeof window !== "undefined") {
  window.__STUDIO_RENDER_OFFLINE__ = async ({
    courseId,
    episodeId,
    format = "mp4",
    codec,
    hardware = "auto",
    resolution = "1080p",
    fps = 60,
    speed = 1,
    outputFilename,
    filename,
  } = {}) => {
    if (!courseId || !episodeId) {
      throw new Error("Thiếu courseId hoặc episodeId.");
    }
    const resp = await fetch("/api/courses", { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Không thể tải /api/courses (HTTP ${resp.status})`);
    }
    const data = await resp.json();
    const course = (data.courses || []).find((c) => c.id === courseId);
    if (!course) {
      throw new Error(`Không tìm thấy khóa học: ${courseId}`);
    }
    const episode = (course.episodes || []).find((e) => e.id === episodeId);
    if (!episode) {
      throw new Error(`Không tìm thấy tập học: ${episodeId}`);
    }
    if (!episode.script?.scenes?.length) {
      throw new Error(`Tập ${episodeId} chưa có script.json hợp lệ.`);
    }

    let lastLogPct = -10;
    const result = await exportEpisodeFast({
      courseId,
      episode,
      format,
      codec,
      hardware,
      resolution,
      fps,
      speed,
      outputFilename,
      filename,
      throwOnSaveError: true,
      onProgress: (p) => {
        if (
          typeof p?.percent === "number" &&
          (p.percent - lastLogPct >= 5 || p.percent === 100 || p.phase === "saving")
        ) {
          lastLogPct = p.percent;
          console.log(`[OFFLINE_RENDER] [render] ${p.percent}% (${p.phase}) ${p.label}`);
        }
      },
    });

    const savedFile = result.saved?.file || result.savedFile || result.filename;
    return {
      ok: true,
      path: result.saved?.path || "",
      savedFile,
      filename: savedFile,
      bytes: result.saved?.bytes ?? result.bytes,
      format: result.format,
      ext: result.ext,
      codec: result.codec,
      hardware: result.hardware,
      hardwareAcceleration: result.hardwareAcceleration,
      resolution: result.resolution,
      width: result.width,
      height: result.height,
      fps: result.fps,
      speed: result.speed,
      durationSec: Number(result.durationSec.toFixed(3)),
    };
  };
}
