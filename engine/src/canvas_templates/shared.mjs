import {
  MOTION_TOKENS,
  clamp01,
  parseSubtitleSegments,
  renderAmbientLayer,
} from "../motion/kernel.mjs";

const { paletteV2, timing, layout } = MOTION_TOKENS;

export { paletteV2, timing, layout, renderAmbientLayer };

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const WRAP_TEXT_CACHE = new Map();
const WRAP_TEXT_CACHE_MAX = 2048;

/**
 * Memoized word/token text wrapping keyed by font + maxWidth + text.
 */
export function wrapText(ctx, text, maxWidth) {
  const raw = String(text ?? "");
  if (!raw) return [];
  const safeMaxW = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 400;
  const cacheKey = `${ctx.font || ""}|${Math.round(safeMaxW * 100)}|${raw}`;
  const cached = WRAP_TEXT_CACHE.get(cacheKey);
  if (cached) return cached;

  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  const pushLongWord = (word) => {
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (ctx.measureText(next).width > safeMaxW && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    return chunk;
  };

  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > safeMaxW) {
      if (current) {
        lines.push(current);
        current = ctx.measureText(w).width > safeMaxW ? pushLongWord(w) : w;
      } else {
        current = pushLongWord(w);
      }
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  if (WRAP_TEXT_CACHE.size >= WRAP_TEXT_CACHE_MAX) {
    WRAP_TEXT_CACHE.clear();
  }
  WRAP_TEXT_CACHE.set(cacheKey, lines);
  return lines;
}

/**
 * Wrap segmented subtitle runs [{ text, accent }] into lines while preserving accent flags.
 */
export function wrapSubtitleSegments(ctx, segments, maxWidth) {
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

export function drawViewfinderBrackets(ctx, x, y, w, h, len = 18, color = paletteV2.accentCyan, lineWidth = 3) {
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

export function drawTopProgressBar(ctx, W, globalProgress) {
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

export function drawTopBar(ctx, W, script, scene) {
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

export function drawSubtitles(ctx, W, H, script, scene, sceneTime) {
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
