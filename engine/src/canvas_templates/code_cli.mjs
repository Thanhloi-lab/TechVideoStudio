import { clamp01, easeQuartOut } from "../motion/kernel.mjs";
import { paletteV2, roundRect, timing, wrapText } from "./shared.mjs";

export const TOKYO_NIGHT_PALETTE = Object.freeze({
  fg: "#A9B1D6",
  fgHighlight: "#E2E8F0",
  comment: "#565F89",
  string: "#9ECE6A",
  property: "#7AA2F7",
  keyword: "#BB9AF7",
  number: "#FF9E64",
  operator: "#89DDFF",
  function: "#7DCFFF",
  flag: "#E0AF68",
});

const LANG_ALIASES = {
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  yml: "yaml",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
};

const KEYWORD_SETS = {
  python: new Set([
    "import", "from", "as", "def", "return", "class", "if", "elif", "else", "for", "while",
    "in", "not", "and", "or", "is", "try", "except", "finally", "with", "raise", "pass",
    "break", "continue", "lambda", "yield", "async", "await", "True", "False", "None", "self",
  ]),
  javascript: new Set([
    "import", "from", "export", "default", "const", "let", "var", "function", "return", "if",
    "else", "for", "while", "of", "in", "switch", "case", "break", "continue", "try", "catch",
    "finally", "throw", "new", "class", "extends", "async", "await", "typeof", "true", "false",
    "null", "undefined",
  ]),
  bash: new Set([
    "if", "then", "else", "elif", "fi", "for", "do", "done", "while", "case", "esac", "export",
    "local", "return", "echo", "cat", "aws", "kubectl", "docker", "terraform", "curl", "jq",
    "grep", "sed", "awk", "cd", "ls", "mkdir", "rm", "cp", "mv", "chmod", "sudo", "true", "false",
  ]),
  json: new Set(["true", "false", "null"]),
  yaml: new Set(["true", "false", "null", "yes", "no", "on", "off"]),
};

const shikiTokenCache = new Map();
let shikiWarmupPromise = null;
const shikiPendingKeys = new Set();

function normalizeLang(rawLang) {
  const clean = String(rawLang || "json").trim().toLowerCase();
  return LANG_ALIASES[clean] || clean || "json";
}

/**
 * Register externally precomputed Shiki line tokens (e.g. from browser Shiki singleton).
 */
export function registerShikiTokens(codeText, lang, tokenLines) {
  if (!codeText || !Array.isArray(tokenLines)) return;
  const key = `${normalizeLang(lang)}\0${codeText}`;
  shikiTokenCache.set(key, tokenLines);
}

/**
 * Non-blocking best-effort Shiki warmup in browser environments with vendored `shiki`.
 */
function tryWarmupShiki(codeText, lang) {
  if (typeof window === "undefined") return;
  const norm = normalizeLang(lang);
  const key = `${norm}\0${codeText}`;
  if (shikiTokenCache.has(key) || shikiPendingKeys.has(key)) return;
  shikiPendingKeys.add(key);

  if (!shikiWarmupPromise) {
    shikiWarmupPromise = import("shiki")
      .then((mod) =>
        mod.getSingletonHighlighter({
          themes: ["tokyo-night"],
          langs: ["json", "python", "bash", "yaml", "javascript", "typescript"],
        })
      )
      .catch(() => null);
  }

  shikiWarmupPromise
    .then(async (hl) => {
      if (!hl) return;
      let targetLang = norm;
      const loaded = hl.getLoadedLanguages ? hl.getLoadedLanguages() : [];
      if (!loaded.includes(targetLang)) {
        try {
          await hl.loadLanguage(targetLang);
        } catch {
          targetLang = "text";
        }
      }
      const res = hl.codeToTokens(codeText, { lang: targetLang, theme: "tokyo-night" });
      if (Array.isArray(res?.tokens)) {
        shikiTokenCache.set(key, res.tokens);
      }
    })
    .catch(() => {});
}

/**
 * Synchronous zero-dependency syntax tokenizer using the `tokyo-night` palette.
 * Supports JSON, YAML, Python, Bash/Shell, and JavaScript/TypeScript.
 */
export function tokenizeCodeLine(rawLine, rawLang = "json", isHighlighted = false) {
  const line = String(rawLine ?? "");
  if (!line) return [];
  const lang = normalizeLang(rawLang);
  const defaultFg = isHighlighted ? TOKYO_NIGHT_PALETTE.fgHighlight : TOKYO_NIGHT_PALETTE.fg;
  const kwSet = KEYWORD_SETS[lang] || KEYWORD_SETS.javascript;

  const tokens = [];
  let i = 0;
  const len = line.length;

  const pushTok = (text, color, bold = false, italic = false) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.color === color && Boolean(prev.bold) === bold && Boolean(prev.italic) === italic) {
      prev.text += text;
    } else {
      tokens.push({ text, color, bold, italic });
    }
  };

  // YAML key prefix check at start of line
  let yamlKeyHandled = false;
  if (lang === "yaml") {
    const ym = line.match(/^(\s*(?:-\s*)?)([A-Za-z0-9_.-]+)(\s*:)(.*)$/);
    if (ym && !ym[1].trimStart().startsWith("#")) {
      pushTok(ym[1], TOKYO_NIGHT_PALETTE.operator);
      pushTok(ym[2], TOKYO_NIGHT_PALETTE.property);
      pushTok(ym[3], TOKYO_NIGHT_PALETTE.operator);
      i = ym[1].length + ym[2].length + ym[3].length;
      yamlKeyHandled = true;
    }
  }

  while (i < len) {
    const ch = line[i];

    // Whitespace
    if (ch === " " || ch === "\t") {
      let j = i + 1;
      while (j < len && (line[j] === " " || line[j] === "\t")) j++;
      pushTok(line.slice(i, j), defaultFg);
      i = j;
      continue;
    }

    // Comments (# for python/bash/yaml, // for js/ts/jsonc)
    if (
      (ch === "#" && (lang === "python" || lang === "bash" || lang === "yaml")) ||
      (ch === "/" && line[i + 1] === "/" && (lang === "javascript" || lang === "typescript" || lang === "json"))
    ) {
      pushTok(line.slice(i), TOKYO_NIGHT_PALETTE.comment, false, true);
      break;
    }

    // Quoted strings ("...", '...', `...`)
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < len) {
        if (line[j] === "\\" && j + 1 < len) {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      const strText = line.slice(i, j);
      const rest = line.slice(j);
      const isJsonKey = (lang === "json" || lang === "javascript" || lang === "typescript") && /^\s*:/.test(rest);
      pushTok(strText, isJsonKey ? TOKYO_NIGHT_PALETTE.property : TOKYO_NIGHT_PALETTE.string);
      i = j;
      continue;
    }

    // Bash CLI flags (--role-arn, -p)
    if (lang === "bash" && ch === "-" && /[A-Za-z-]/.test(line[i + 1] || "")) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_-]/.test(line[j])) j++;
      pushTok(line.slice(i, j), TOKYO_NIGHT_PALETTE.flag);
      i = j;
      continue;
    }

    // Env / template variables ($VAR, ${VAR})
    if (ch === "$" && /[A-Za-z_{]/.test(line[i + 1] || "")) {
      let j = i + 1;
      if (line[j] === "{") {
        while (j < len && line[j] !== "}") j++;
        if (j < len) j++;
      } else {
        while (j < len && /[A-Za-z0-9_]/.test(line[j])) j++;
      }
      pushTok(line.slice(i, j), TOKYO_NIGHT_PALETTE.number);
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(line[i - 1]))) {
      let j = i + 1;
      while (j < len && /[0-9._xXa-fA-F]/.test(line[j])) j++;
      pushTok(line.slice(i, j), TOKYO_NIGHT_PALETTE.number);
      i = j;
      continue;
    }

    // Identifiers / Keywords / Function calls
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_.-]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const nextNonSpace = line.slice(j).match(/^\s*(.)/)?.[1] || "";

      if (kwSet.has(word)) {
        const isLit = word === "true" || word === "false" || word === "null" || word === "True" || word === "False" || word === "None";
        pushTok(word, isLit ? TOKYO_NIGHT_PALETTE.number : TOKYO_NIGHT_PALETTE.keyword, !isLit);
      } else if (nextNonSpace === "(") {
        pushTok(word, TOKYO_NIGHT_PALETTE.function);
      } else if ((lang === "javascript" || lang === "typescript") && nextNonSpace === ":") {
        pushTok(word, TOKYO_NIGHT_PALETTE.property);
      } else if (yamlKeyHandled && j === len && !/\s/.test(line.slice(i))) {
        pushTok(word, defaultFg);
      } else {
        pushTok(word, defaultFg);
      }
      i = j;
      continue;
    }

    // Operators / Punctuation
    if (/[{}[\]():,=<>!&|+-/*]/.test(ch)) {
      pushTok(ch, TOKYO_NIGHT_PALETTE.operator);
      i++;
      continue;
    }

    pushTok(ch, defaultFg);
    i++;
  }

  return tokens;
}

export function tokenizeCodeLines(lines, lang = "json", highlightedSet = null) {
  const arr = Array.isArray(lines) ? lines : String(lines ?? "").split("\n");
  const joined = arr.join("\n");
  const norm = normalizeLang(lang);
  const cacheKey = `${norm}\0${joined}`;
  const shikiLines = shikiTokenCache.get(cacheKey);
  if (shikiLines && shikiLines.length === arr.length) {
    return shikiLines.map((lineToks, idx) => {
      const isHl = Boolean(highlightedSet?.has(idx + 1));
      return lineToks.map((t) => ({
        text: t.content ?? t.text ?? "",
        color: t.color || (isHl ? TOKYO_NIGHT_PALETTE.fgHighlight : TOKYO_NIGHT_PALETTE.fg),
        bold: Boolean(t.fontStyle && (t.fontStyle & 2)),
        italic: Boolean(t.fontStyle && (t.fontStyle & 1)),
      }));
    });
  }

  tryWarmupShiki(joined, norm);
  return arr.map((line, idx) => tokenizeCodeLine(line, norm, Boolean(highlightedSet?.has(idx + 1))));
}

/**
 * Wrap a line's syntax tokens into visual sub-lines fitting within maxWidth without losing token colors.
 */
function wrapTokenizedLine(ctx, tokens, maxWidth) {
  const visualLines = [[]];
  let currentWidth = 0;

  const pushTextToCurrent = (text, color, bold, italic) => {
    const lineArr = visualLines[visualLines.length - 1];
    const prev = lineArr[lineArr.length - 1];
    if (prev && prev.color === color && prev.bold === bold && prev.italic === italic) {
      prev.text += text;
    } else {
      lineArr.push({ text, color, bold, italic });
    }
  };

  for (const tok of tokens) {
    const parts = String(tok.text || "").split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      const w = ctx.measureText(part).width;
      if (currentWidth + w <= maxWidth || (currentWidth === 0 && w <= maxWidth)) {
        pushTextToCurrent(part, tok.color, tok.bold, tok.italic);
        currentWidth += w;
        continue;
      }

      if (/^\s+$/.test(part)) {
        visualLines.push([]);
        currentWidth = 0;
        continue;
      }

      if (w <= maxWidth) {
        visualLines.push([]);
        currentWidth = 0;
        pushTextToCurrent(part, tok.color, tok.bold, tok.italic);
        currentWidth += w;
      } else {
        // Hard-wrap an ultra-long single token (e.g., ARN or URL) cleanly by char
        for (const ch of part) {
          const cw = ctx.measureText(ch).width;
          if (currentWidth + cw > maxWidth && currentWidth > 0) {
            visualLines.push([]);
            currentWidth = 0;
          }
          pushTextToCurrent(ch, tok.color, tok.bold, tok.italic);
          currentWidth += cw;
        }
      }
    }
  }

  return visualLines.filter((vl, idx) => idx === 0 || vl.length > 0);
}

function isErrorCommandOutput(item) {
  if (!item) return false;
  if (item.is_error) return true;
  const lines = item.output_lines || [];
  return lines.some((l) => /AccessDenied|error occurred|failed|denied|Exception|Error:/i.test(String(l)));
}

export function drawCodeCliScene(ctx, W, H, scene, progress, sceneTime) {
  const data = scene.visual_data || {};
  const rawCodeLines = Array.isArray(data.code_lines) ? data.code_lines : [];
  const phases = data.highlight_phases || [];
  const cmds = data.terminal_commands || [];

  const activePhase =
    phases.find((p) => progress >= p.progress_start && progress <= p.progress_end) ||
    phases[phases.length - 1] ||
    null;

  const rawOverride = activePhase?.code_override;
  const displayLines = Array.isArray(rawOverride)
    ? rawOverride
    : typeof rawOverride === "string"
      ? rawOverride.split("\n")
      : rawCodeLines;

  const hasCodeContent = displayLines.length > 0;
  const hasTermContent = cmds.length > 0;

  const normLayout = String(data.layout || "split").trim().toLowerCase();
  let showCode = hasCodeContent;
  let showTerm = hasTermContent;
  if (normLayout === "code" || normLayout === "code_only") {
    showCode = hasCodeContent;
    showTerm = !hasCodeContent && hasTermContent;
  } else if (normLayout === "terminal") {
    showCode = !hasTermContent && hasCodeContent;
    showTerm = hasTermContent;
  }

  const hlSet = new Set(activePhase?.lines || []);
  const laserLineSet = Array.isArray(activePhase?.laser_scan) ? new Set(activePhase.laser_scan) : null;
  const isDangerPhase = Boolean(activePhase?.laser_scan || activePhase?.accent === "danger" || activePhase?.accent === "red");
  const hlBarColor = isDangerPhase ? paletteV2.danger : paletteV2.accentCyan;
  const hlBgColor = isDangerPhase ? "rgba(239, 68, 68, 0.16)" : "rgba(16, 192, 240, 0.14)";
  const codeLang = data.code_language || "json";

  const topY = 126;
  const paneH = H - 296;

  if (showCode) {
    const cw = showTerm ? (W - 180) / 2 - 16 : W - 180;
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

    // Language badge + Title
    ctx.font = '800 15px "JetBrains Mono", Consolas, monospace';
    const langTag = normalizeLang(codeLang).toUpperCase();
    const badgeW = Math.max(56, ctx.measureText(langTag).width + 20);
    roundRect(ctx, cx + 20, topY + 14, badgeW, 26, 7);
    ctx.fillStyle = "rgba(122, 162, 247, 0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(122, 162, 247, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = TOKYO_NIGHT_PALETTE.property;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(langTag, cx + 20 + badgeW / 2, topY + 27);

    ctx.font = '700 22px "Be Vietnam Pro", Inter, system-ui, sans-serif';
    ctx.fillStyle = paletteV2.accentGlow;
    ctx.textAlign = "left";
    ctx.fillText(data.code_title || "code", cx + 32 + badgeW, topY + 28);

    const calloutReserve = activePhase?.callout ? 62 : 14;
    const bodyTop = topY + 68;
    const availBodyH = Math.max(120, paneH - 68 - calloutReserve);

    const tokenizedLines = tokenizeCodeLines(displayLines, codeLang, hlSet);

    // Adaptive font sizing + token-preserving wrapping so >18 lines & >56 chars fit without truncation
    const fontCandidates = [21, 19, 17, 15.5, 14, 13];
    let chosenFontPx = 13;
    let chosenLineH = 20;
    let chosenGutterW = 54;
    let chosenRows = [];

    for (const fp of fontCandidates) {
      const lh = Math.round(fp * 1.44);
      const gw = Math.max(48, Math.round(fp * 2.75));
      const textMaxW = Math.max(140, cw - gw - 26);
      ctx.font = `500 ${fp}px "JetBrains Mono", Consolas, monospace`;

      const rows = [];
      for (let idx = 0; idx < tokenizedLines.length; idx++) {
        const wrapped = wrapTokenizedLine(ctx, tokenizedLines[idx], textMaxW);
        for (let wi = 0; wi < wrapped.length; wi++) {
          rows.push({
            lineNo: idx + 1,
            showLineNo: wi === 0,
            tokens: wrapped[wi],
          });
        }
      }

      chosenFontPx = fp;
      chosenLineH = lh;
      chosenGutterW = gw;
      chosenRows = rows;
      if (rows.length * lh <= availBodyH) {
        break;
      }
    }

    // If an extra-long file overflows even 13px, center a clean viewport window around highlighted lines
    const maxVisibleRows = Math.max(1, Math.floor(availBodyH / chosenLineH));
    let rowStart = 0;
    if (chosenRows.length > maxVisibleRows && hlSet.size > 0) {
      const firstHlIdx = chosenRows.findIndex((r) => hlSet.has(r.lineNo));
      if (firstHlIdx >= 0) {
        rowStart = Math.max(0, Math.min(chosenRows.length - maxVisibleRows, firstHlIdx - Math.floor(maxVisibleRows * 0.25)));
      }
    }
    const visibleRows = chosenRows.slice(rowStart, rowStart + maxVisibleRows);

    let firstLaserY = null;
    let lastLaserY = null;

    ctx.textBaseline = "middle";
    visibleRows.forEach((row, rIdx) => {
      const ly = bodyTop + rIdx * chosenLineH + chosenLineH * 0.5;
      const isHl = hlSet.has(row.lineNo);
      const isDimmed = hlSet.size > 0 && !isHl;
      const isLaserLine = Boolean(activePhase?.laser_scan) && (laserLineSet ? laserLineSet.has(row.lineNo) : isHl);

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.35;

      if (isHl || isLaserLine) {
        if (isLaserLine) {
          if (firstLaserY === null) firstLaserY = ly - chosenLineH * 0.48;
          lastLaserY = ly + chosenLineH * 0.48;
        }
        ctx.fillStyle = isLaserLine && laserLineSet ? "rgba(239, 68, 68, 0.16)" : hlBgColor;
        ctx.fillRect(cx + 6, ly - chosenLineH * 0.48, cw - 12, chosenLineH * 0.96);

        ctx.shadowColor = isLaserLine && laserLineSet ? "rgba(239, 68, 68, 0.85)" : hlBarColor;
        ctx.shadowBlur = 12;
        ctx.fillStyle = isLaserLine && laserLineSet ? paletteV2.danger : hlBarColor;
        ctx.fillRect(cx + 6, ly - chosenLineH * 0.48, 5, chosenLineH * 0.96);
        ctx.shadowBlur = 0;
      }

      if (row.showLineNo) {
        ctx.font = `500 ${chosenFontPx}px "JetBrains Mono", Consolas, monospace`;
        ctx.fillStyle = isHl ? hlBarColor : "#64748B";
        ctx.textAlign = "right";
        ctx.fillText(String(row.lineNo), cx + chosenGutterW - 10, ly);
      }

      ctx.textAlign = "left";
      let cursorX = cx + chosenGutterW + 6;
      for (const tok of row.tokens) {
        const weight = tok.bold ? "700" : "500";
        const style = tok.italic ? "italic " : "";
        ctx.font = `${style}${weight} ${chosenFontPx}px "JetBrains Mono", Consolas, monospace`;
        ctx.fillStyle = tok.color || (isHl ? TOKYO_NIGHT_PALETTE.fgHighlight : TOKYO_NIGHT_PALETTE.fg);
        ctx.fillText(tok.text, cursorX, ly);
        cursorX += ctx.measureText(tok.text).width;
      }
      ctx.restore();
    });

    // Optional Laser Scanline across highlighted/flagged lines
    if (activePhase?.laser_scan && firstLaserY !== null && lastLaserY !== null) {
      const scanP = (sceneTime * 0.85) % 1;
      const scanX = cx + chosenGutterW + scanP * (cw - chosenGutterW - 24);
      ctx.save();
      ctx.strokeStyle = paletteV2.danger;
      ctx.lineWidth = 3;
      ctx.shadowColor = paletteV2.danger;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(scanX, firstLaserY);
      ctx.lineTo(scanX, lastLaserY);
      ctx.stroke();
      ctx.restore();
    }

    if (activePhase?.callout) {
      ctx.fillStyle = isDangerPhase ? "rgba(239, 68, 68, 0.14)" : "rgba(16, 192, 240, 0.12)";
      ctx.fillRect(cx + 2, topY + paneH - 54, cw - 4, 52);
      ctx.font = '600 20px "Be Vietnam Pro", Inter, system-ui, sans-serif';
      ctx.fillStyle = isDangerPhase ? "#FECACA" : "#E0F7FF";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`👉 ${activePhase.callout}`, cx + 24, topY + paneH - 28);
    }
    ctx.restore();
  }

  if (showTerm) {
    const tw = showCode ? (W - 180) / 2 - 16 : W - 180;
    const tx = showCode ? 90 + (W - 180) / 2 + 16 : 90;

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
    const termFontPx = cmds.length > 3 ? 18 : 20;
    const termLineH = Math.round(termFontPx * 1.45);
    const termMaxW = tw - 56;
    let ty = topY + 88;
    ctx.font = `500 ${termFontPx}px "JetBrains Mono", Consolas, monospace`;

    const visibleCmds = cmds.filter((c) => progress >= c.progress_start);
    visibleCmds.forEach((item, idx) => {
      if (ty > topY + paneH - 36) return;

      const elapsed = progress - item.progress_start;
      const typeDur = item.type_duration ?? 0.14;
      const typeRatio = Math.min(1, elapsed / typeDur);
      const visibleCmd = String(item.command || "").slice(
        0,
        Math.ceil((item.command || "").length * typeRatio)
      );
      const isLastVisible = idx === visibleCmds.length - 1;
      const showOutput = elapsed >= typeDur;
      const hasError = isErrorCommandOutput(item);

      const cmdWrapped = wrapText(ctx, `$ ${visibleCmd}`, termMaxW);
      cmdWrapped.forEach((cLine, cIdx) => {
        if (ty > topY + paneH - 30) return;
        if (cIdx === 0) {
          ctx.fillStyle = paletteV2.success;
          ctx.fillText("$", tx + 26, ty);
          ctx.fillStyle = paletteV2.accentCyan;
          ctx.fillText(cLine.slice(1), tx + 40, ty);
        } else {
          ctx.fillStyle = paletteV2.accentCyan;
          ctx.fillText(cLine, tx + 42, ty);
        }

        if (cIdx === cmdWrapped.length - 1 && (typeRatio < 1 || (isLastVisible && !showOutput))) {
          if (cursorVisible) {
            const textWidth = cIdx === 0
              ? 14 + ctx.measureText(cLine.slice(1)).width
              : 16 + ctx.measureText(cLine).width;
            const cursorX = tx + 26 + textWidth + 4;
            ctx.save();
            ctx.fillStyle = paletteV2.accentCyan;
            ctx.shadowColor = paletteV2.accentCyan;
            ctx.shadowBlur = 10;
            ctx.fillRect(cursorX, ty - termFontPx * 0.52, 11, termFontPx * 1.04);
            ctx.restore();
          }
        }
        ty += termLineH;
      });

      if (showOutput) {
        const outElapsed = elapsed - typeDur;
        const lines = item.output_lines || [];
        lines.forEach((out, oIdx) => {
          if (outElapsed < oIdx * 0.015) return;
          const wrappedOut = wrapText(ctx, String(out), termMaxW);
          wrappedOut.forEach((wLine) => {
            if (ty > topY + paneH - 26) return;
            ctx.fillStyle = hasError ? "#FCA5A5" : "#CBD5E1";
            ctx.fillText(wLine, tx + 26, ty);
            ty += Math.round(termLineH * 0.92);
          });
        });

        if (hasError && ty + 32 <= topY + paneH - 16) {
          roundRect(ctx, tx + 24, ty + 2, tw - 48, 28, 6);
          ctx.fillStyle = "rgba(127, 29, 29, 0.55)";
          ctx.fill();
          ctx.strokeStyle = "rgba(239, 68, 68, 0.55)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.font = '700 14px "Be Vietnam Pro", Inter, sans-serif';
          ctx.fillStyle = "#FECACA";
          ctx.fillText("⚠ SANDBOX GUARD · ACCESS DENIED / POLICY BLOCKED", tx + 36, ty + 16);
          ctx.font = `500 ${termFontPx}px "JetBrains Mono", Consolas, monospace`;
          ty += 36;
        }
      }
      ty += 14;
    });

    // Trailing blinking cyan cursor on idle prompt
    if (visibleCmds.length === 0 || progress - visibleCmds[visibleCmds.length - 1].progress_start >= (visibleCmds[visibleCmds.length - 1].type_duration ?? 0.14)) {
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
