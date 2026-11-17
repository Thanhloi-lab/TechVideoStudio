// code_cli — DOM + GSAP scene builder (HyperFrames composition).
// Code panel (Shiki tokens pre-highlighted at compile time → ctx.scene.code) + animated CLI terminal.
//
// Contract (engine/HYPERFRAMES_ENGINE.md §6): DOM inside ctx.stage, tweens on ctx.tl at ABSOLUTE times
// (ctx.at(progress) + fixed offsets in seconds). No callbacks, no randomness, no wall clock, no DOM
// measuring (layout is computed from canvas measureText + fixed metrics).
//
// Legacy semantics reproduced (engine/src/canvas_templates/code_cli.mjs + components/TerminalAndCode.mjs):
//   • split code | terminal layout; code-only / terminal-only when one side is empty (legacy `layout` honoured)
//   • adaptive code font (21 → 13px) + token-preserving wrapping, viewport scroll when even 13px overflows
//   • highlight_phases: active-line highlight bar + dimmed context lines, accent cyan/danger/red/amber/gold/warning,
//     callout bar with annotate_text annotation (underline gold, box red when laser_scan)
//   • code_override → line-level "magic move" morph between Shiki snapshots (kept lines glide, changed lines crossfade)
//   • laser_scan → red scanline sweep + danger tint on the given lines (or the highlighted lines when `true`)
//   • terminal: `$` prompt, command typed over type_duration (progress units, default 0.14), output reveal,
//     red error output (is_error or auto-detected) + hazard banner, finite blinking block cursor, idle prompt

const STYLE_ID = "tvs-style-code-cli";

const CSS = `
.ccli { position: absolute; inset: 0; }
.ccli-pane { position: absolute; top: 0; height: 100%; border-radius: 16px; overflow: hidden;
  box-shadow: 0 18px 48px rgba(0,0,0,0.5); }
.ccli-code { background: #060C18; border: 2px solid rgba(148,163,184,0.24); }
.ccli-term { background: #02060E; border: 2px solid rgba(16,192,240,0.24); }
.ccli-glow { position: absolute; inset: 0; border-radius: 14px; border: 2px solid; pointer-events: none; z-index: 8;
  opacity: 0; visibility: hidden; }
.ccli-head { position: absolute; left: 0; right: 0; top: 0; height: 56px; display: flex; align-items: center; gap: 14px;
  padding: 0 20px; background: #0F1A2E; border-bottom: 1px solid rgba(148,163,184,0.18); }
.ccli-lang { flex: none; height: 28px; line-height: 25px; padding: 0 10px; border-radius: 7px; background: rgba(122,162,247,0.18);
  border: 1.2px solid rgba(122,162,247,0.45); color: #7AA2F7; font: 800 15px var(--tvs-mono); letter-spacing: 0.04em; }
.ccli-tab { position: relative; flex: 0 1 auto; min-width: 0; align-self: flex-end; height: 44px; display: flex; align-items: center; gap: 10px;
  padding: 0 18px; border-radius: 10px 10px 0 0; background: #060C18; border: 1px solid rgba(148,163,184,0.18); border-bottom: none;
  margin-bottom: -1px; }
.ccli-tab::before { content: ""; position: absolute; left: 10px; right: 10px; top: 0; height: 2px; border-radius: 2px; background: var(--tvs-cyan);
  box-shadow: 0 0 10px rgba(16,192,240,0.7); }
.ccli-tab__name { font: 700 21px var(--tvs-font); color: var(--tvs-glow); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccli-head__meta { margin-left: auto; flex: none; font: 600 15px var(--tvs-mono); color: #475569; white-space: nowrap; }
.ccli-body { position: absolute; left: 0; right: 0; overflow: hidden; }
.ccli-gutter { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(15,26,46,0.55); border-right: 1px solid rgba(148,163,184,0.12); }
.ccli-scroll { position: absolute; left: 0; right: 0; top: 0; height: 100%; }
.ccli-layer { position: absolute; inset: 0; }
.ccli-snap { position: absolute; inset: 0; font-family: var(--tvs-mono); font-weight: 500; font-variant-ligatures: none; }
.ccli-line { position: absolute; left: 0; right: 0; opacity: 0; visibility: hidden; }
.ccli-row { position: relative; white-space: pre; }
.ccli-ln { position: absolute; left: 0; text-align: right; color: #64748B; }
.ccli-src { position: absolute; top: 0; white-space: pre; }
.ccli-hl { position: absolute; left: 6px; right: 6px; top: 0; border-radius: 6px; opacity: 0; visibility: hidden; }
.ccli-hl__edge { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; border-radius: 3px; }
.ccli-laser { position: absolute; right: 6px; overflow: hidden; border-radius: 4px; opacity: 0; visibility: hidden; }
.ccli-laser__tint { position: absolute; inset: 0; background: rgba(239,68,68,0.10); box-shadow: inset 0 0 0 1px rgba(239,68,68,0.28); }
.ccli-laser__beam { position: absolute; top: 0; bottom: 0; left: 0; width: 140px;
  background: linear-gradient(90deg, rgba(239,68,68,0) 0%, rgba(239,68,68,0.10) 55%, rgba(239,68,68,0.32) 97%, rgba(239,68,68,0) 97%); }
.ccli-laser__beam::after { content: ""; position: absolute; right: 2px; top: -2px; bottom: -2px; width: 3px;
  background: linear-gradient(180deg, rgba(239,68,68,0.2) 0%, #EF4444 22%, #FFFFFF 50%, #EF4444 78%, rgba(239,68,68,0.2) 100%);
  box-shadow: 0 0 12px #EF4444, 0 0 24px rgba(239,68,68,0.8); }
.ccli-callouts { position: absolute; left: 0; right: 0; bottom: 0; }
.ccli-callout { position: absolute; inset: 0; display: flex; align-items: center; gap: 12px; padding: 0 22px;
  border-top: 1.5px solid; opacity: 0; visibility: hidden; }
.ccli-callout__icon { flex: none; font-size: 22px; line-height: 1; }
.ccli-callout__text { min-width: 0; padding: 6px 4px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccli-callout__text--2 { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.28; }
.ccli-target { position: relative; font-weight: 800; }
.ccli-annot { position: absolute; left: -5px; top: -4px; overflow: visible; pointer-events: none; }
.ccli-tbadge { flex: none; height: 28px; line-height: 25px; padding: 0 10px; border-radius: 7px; background: rgba(16,185,129,0.2);
  border: 1.2px solid rgba(16,185,129,0.45); color: #6EE7B7; font: 800 15px var(--tvs-font); letter-spacing: 0.04em; white-space: nowrap; }
.ccli-ttitle { min-width: 0; font: 700 21px var(--tvs-font); color: #6EE7B7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccli-dots { margin-left: auto; flex: none; display: flex; gap: 8px; }
.ccli-dots span { width: 12px; height: 12px; border-radius: 50%; }
.ccli-tbody { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden;
  background: radial-gradient(circle at 80% 0%, rgba(16,192,240,0.05) 0, rgba(2,6,14,0) 520px); }
.ccli-tscroll { position: absolute; top: 0; }
.ccli-trow { position: absolute; left: 0; right: 0; white-space: pre; font-family: var(--tvs-mono); font-variant-ligatures: none; opacity: 0; visibility: hidden; }
.ccli-prompt { color: #10B981; font-weight: 700; }
.ccli-cmd { color: #10C0F0; font-weight: 700; }
.ccli-out { color: #CBD5E1; font-weight: 500; }
.ccli-out--err { color: #FCA5A5; }
.ccli-curwrap { display: inline-block; vertical-align: top; opacity: 0; visibility: hidden; }
.ccli-cur { display: inline-block; width: 0.58em; background: #10C0F0; box-shadow: 0 0 10px rgba(16,192,240,0.75); }
.ccli-banner { position: absolute; left: 0; right: 0; height: 32px; border-radius: 6px; display: flex; align-items: center; gap: 8px;
  padding: 0 12px; font: 800 14px var(--tvs-font); letter-spacing: 0.04em; color: #FECACA; white-space: nowrap; overflow: hidden;
  border: 1.2px solid rgba(239,68,68,0.55); opacity: 0; visibility: hidden;
  background: repeating-linear-gradient(-45deg, rgba(239,68,68,0.24) 0 10px, rgba(2,10,20,0.82) 10px 20px); }
.ccli-empty { position: absolute; inset: 160px 300px; display: grid; place-items: center; border-radius: 16px;
  border: 2px dashed rgba(148,163,184,0.3); color: #94A3B8; font: 600 26px var(--tvs-font); }
`;

const MONO_FALLBACK = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';
const SANS_FALLBACK = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const FG = "#A9B1D6";
const LN_COLOR = "#64748B";

const ACCENTS = {
  cyan: { bar: "#10C0F0", bg: "rgba(16,192,240,0.14)", glow: "0 0 14px rgba(16,192,240,0.85)", text: "#E0F7FF", calloutBg: "rgba(16,192,240,0.12)", calloutBorder: "rgba(16,192,240,0.32)" },
  red: { bar: "#EF4444", bg: "rgba(239,68,68,0.16)", glow: "0 0 14px rgba(239,68,68,0.85)", text: "#FECACA", calloutBg: "rgba(239,68,68,0.14)", calloutBorder: "rgba(239,68,68,0.4)" },
  amber: { bar: "#FF9900", bg: "rgba(255,153,0,0.16)", glow: "0 0 14px rgba(255,153,0,0.8)", text: "#FFE7C2", calloutBg: "rgba(255,153,0,0.12)", calloutBorder: "rgba(255,153,0,0.38)" },
};

const LANG_TAGS = { javascript: "JS", typescript: "TS", python: "PYTHON", bash: "BASH", shellscript: "BASH", yaml: "YAML", json: "JSON" };

const CALLOUT_KEYWORD_RE =
  /(Explicit Deny|Implicit Deny|Least Privilege|Trust Policy|Permissions Policy|SessionToken|AssumeRole|Access Key|hardcode Key|ARN|s3:GetObject|s3:ListBucket|Statement|Version|Effect|Action|Resource|boto3|IAM Role|DVA-C02)/i;

const ERROR_RE = /AccessDenied|error occurred|failed|denied|Exception|Error:/i;

function ensureStyle(common) {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(common.el("style", { id: STYLE_ID, text: CSS }));
}

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

let measureCtx = null;
function textWidth(font, text) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(String(text ?? "")).width;
}

function monoCharWidth(fontPx, weight, monoStack) {
  const w = textWidth(`${weight} ${fontPx}px ${monoStack}`, "0".repeat(20)) / 20;
  return w > 0 ? w : fontPx * 0.6;
}

function phaseAccent(phase) {
  if (!phase) return ACCENTS.cyan;
  if (phase.laser_scan || phase.accent === "danger" || phase.accent === "red") return ACCENTS.red;
  if (phase.accent === "amber" || phase.accent === "gold" || phase.accent === "warning") return ACCENTS.amber;
  return ACCENTS.cyan;
}

function isErrorCommand(item) {
  if (!item) return false;
  if (item.is_error) return true;
  return (item.output_lines || []).some((l) => ERROR_RE.test(String(l)));
}

/** Same targeting rules as the Studio player (annotate_text → keyword → "Label:" prefix → whole text). */
function splitCallout(text, preferred) {
  const src = String(text || "");
  if (!src) return { before: "", target: "", after: "" };
  if (preferred) {
    const idx = src.indexOf(preferred);
    if (idx >= 0) return { before: src.slice(0, idx), target: src.slice(idx, idx + preferred.length), after: src.slice(idx + preferred.length) };
  }
  const m = src.match(CALLOUT_KEYWORD_RE);
  if (m && m.index !== undefined) return { before: src.slice(0, m.index), target: m[0], after: src.slice(m.index + m[0].length) };
  const colon = src.indexOf(":");
  if (colon > 0 && colon < 32) return { before: "", target: src.slice(0, colon), after: src.slice(colon) };
  return { before: "", target: src, after: "" };
}

/** Greedy word wrap by character count (monospace), hard-wrapping over-long words. */
function wrapChars(text, cap) {
  const src = String(text ?? "").replace(/\t/g, "  ");
  const c = Math.max(4, cap);
  if (src.length <= c) return [src];
  const rows = [""];
  for (const part of src.split(/(\s+)/)) {
    if (!part) continue;
    const cur = rows[rows.length - 1];
    if (cur.length + part.length <= c) {
      rows[rows.length - 1] = cur + part;
    } else if (/^\s+$/.test(part)) {
      if (cur.length) rows.push("");
    } else if (part.length <= c) {
      if (cur.trim().length) rows.push(part);
      else rows[rows.length - 1] = cur.length + part.length <= c ? cur + part : part;
    } else {
      let rest = part;
      while (rest.length) {
        const row = rows[rows.length - 1];
        const room = c - row.length;
        if (room <= 0) {
          rows.push("");
          continue;
        }
        rows[rows.length - 1] = row + rest.slice(0, room);
        rest = rest.slice(room);
        if (rest.length) rows.push("");
      }
    }
  }
  return rows.map((r) => r.replace(/\s+$/, "")).filter((r, i) => i === 0 || r.length);
}

/** Wrap one line of Shiki tokens into visual rows of ≤ cap characters, preserving token colors. */
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

/** Longest common subsequence of two string arrays → matched index pairs [ai, bi]. */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Contiguous runs of sorted 1-based line numbers → [[first, last], ...]. */
function lineGroups(lines, maxLine) {
  const sorted = [...new Set((lines || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= maxLine))].sort((x, y) => x - y);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n === g[1] + 1) g[1] = n;
    else groups.push([n, n]);
  }
  return groups;
}

function toLines(value) {
  if (Array.isArray(value)) return value.map((l) => String(l ?? ""));
  if (typeof value === "string") return value.split("\n");
  return [];
}

/** Fallback when the compiler did not attach `scene.code` (plain, unhighlighted lines; same carry-forward rule). */
function buildPlainCode(vd) {
  const snapshots = [];
  const byKey = new Map();
  const add = (lines) => {
    const key = lines.join("\n");
    if (byKey.has(key)) return byKey.get(key);
    snapshots.push({ lines, tokens: null });
    byKey.set(key, snapshots.length - 1);
    return snapshots.length - 1;
  };
  const baseLines = toLines(vd.code_lines);
  const base = baseLines.length ? add(baseLines) : -1;
  let current = base;
  const phase_snapshot = (Array.isArray(vd.highlight_phases) ? vd.highlight_phases : []).map((p) => {
    const ov = toLines(p?.code_override);
    if (ov.length) current = add(ov);
    return current;
  });
  return { lang: String(vd.code_language || "json").toLowerCase(), base, snapshots, phase_snapshot };
}

function fileIcon(common, color) {
  const { svg } = common;
  return svg(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
    svg("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
    svg("path", { d: "M14 2v6h6" }),
    svg("path", { d: "M9.5 13.5 8 15l1.5 1.5M14.5 13.5 16 15l-1.5 1.5" })
  );
}

export default function buildCodeCli(ctx) {
  const { tl, common, vd, stage, at, start, dur, scene } = ctx;
  const { el, svg, typewriter, blink, drawPath, mark, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const MONO = cssVar("--tvs-mono", MONO_FALLBACK);
  const SANS = cssVar("--tvs-font", SANS_FALLBACK);
  const t0 = start;
  const limit = start + dur - 0.02; // every tween ends before the scene clip ends
  const clampT = (t) => Math.min(Math.max(t, t0), limit - 0.01);
  const fitDur = (t, d) => Math.max(0.001, Math.min(d, limit - t));

  // first-tween bookkeeping: the earliest tween on an element must start from its hidden pre-event state
  const seen = new WeakSet();
  function show(target, t, { from = {}, to = {}, duration = 0.25, ease = EASE.reveal } = {}) {
    const tt = clampT(t);
    const d = fitDur(tt, duration);
    if (!seen.has(target)) {
      seen.add(target);
      tl.fromTo(target, { autoAlpha: 0, ...from }, { autoAlpha: 1, ...to, duration: d, ease }, tt);
    } else {
      if (Object.keys(from).length) tl.to(target, { ...from, duration: 0.001 }, tt);
      tl.to(target, { autoAlpha: 1, ...to, duration: d, ease }, tt + (Object.keys(from).length ? 0.001 : 0));
    }
  }
  function hide(target, t, { to = {}, duration = 0.18, ease = EASE.exit } = {}) {
    const tt = clampT(t);
    tl.to(target, { autoAlpha: 0, ...to, duration: fitDur(tt, duration), ease }, tt);
  }
  // Large panes reveal with opacity + blur only: a sub-pixel translate on a composited pane makes Chrome
  // reuse a fractionally-offset raster afterwards (frames then depend on seek history).
  function revealPane(target, t) {
    tl.fromTo(target, { autoAlpha: 0, filter: "blur(12px)" }, { autoAlpha: 1, filter: "blur(0px)", duration: DUR.reveal, ease: EASE.reveal }, t);
  }

  // ---- Data ------------------------------------------------------------------------------------
  const code = scene.code && Array.isArray(scene.code.snapshots) ? scene.code : buildPlainCode(vd);
  const snapshots = code.snapshots || [];
  const rawPhases = Array.isArray(vd.highlight_phases) ? vd.highlight_phases : [];
  const phases = rawPhases
    .map((p, i) => ({ p: p || {}, i, ps: mark(p?.progress_start, 0), snap: Number.isInteger(code.phase_snapshot?.[i]) ? code.phase_snapshot[i] : -1 }))
    .sort((a, b) => a.ps - b.ps || a.i - b.i);
  let prevT = -Infinity;
  phases.forEach((ph) => {
    ph.t = Math.max(at(ph.ps), t0 + 0.3, prevT + 0.05);
    prevT = ph.t;
  });
  phases.forEach((ph, k) => {
    ph.tEnd = k + 1 < phases.length ? phases[k + 1].t : limit;
  });

  const cmds = (Array.isArray(vd.terminal_commands) ? vd.terminal_commands : [])
    .map((c, i) => ({ c: c || {}, i, ps: mark(c?.progress_start, 0) }))
    .filter((x) => String(x.c.command ?? "").trim())
    .sort((a, b) => a.ps - b.ps || a.i - b.i);

  const hasCode = snapshots.some((s) => (s.lines || []).length > 0);
  const hasTerm = cmds.length > 0;
  const layout = String(vd.layout || "split").trim().toLowerCase();
  let showCode = hasCode;
  let showTerm = hasTerm;
  if (layout === "code" || layout === "code_only") showTerm = !hasCode && hasTerm;
  else if (layout === "terminal" || layout === "terminal_only") showCode = !hasTerm && hasCode;

  const W = STAGE.width;
  const H = STAGE.height;
  const GAP = 24;
  const split = showCode && showTerm;
  const codeW = split ? Math.round((W - GAP) * 0.52) : W;
  const termW = split ? W - GAP - codeW : W;
  const termX = split ? codeW + GAP : 0;

  const root = el("div.ccli");
  stage.appendChild(root);

  if (!showCode && !showTerm) {
    const empty = el("div.ccli-empty", { text: vd.code_title || "code" });
    root.appendChild(empty);
    revealPane(empty, t0 + 0.05);
    return;
  }

  if (showCode) buildCodePane(0, codeW);
  if (showTerm) buildTerminalPane(termX, termW);

  // =================================================================================================
  // Code pane
  // =================================================================================================
  function buildCodePane(x, w) {
    const innerW = w - 4;
    const innerH = H - 4;
    const HEAD = 56;
    const anyCallout = phases.some((ph) => String(ph.p.callout || "").trim());
    const SLOT = anyCallout ? 64 : 0;
    const PAD_T = 14;
    const PAD_B = 12;
    const bodyH = innerH - HEAD - SLOT;
    const availH = bodyH - PAD_T - PAD_B;

    // tokens per snapshot line (Shiki → { t, c, s }; plain fallback when tokens are null)
    const snapLines = snapshots.map((snap) =>
      (snap.lines || []).map((line, li) => {
        const raw = Array.isArray(snap.tokens) && Array.isArray(snap.tokens[li]) ? snap.tokens[li] : null;
        const toks = raw
          ? raw.map((tk) => ({ t: String(tk?.t ?? "").replace(/\t/g, "  "), c: tk?.c || FG, s: Number(tk?.s) || 0 })).filter((tk) => tk.t.length)
          : String(line ?? "")
            ? [{ t: String(line).replace(/\t/g, "  "), c: FG, s: 0 }]
            : [];
        return { text: String(line ?? "").replace(/\s+$/, ""), toks };
      })
    );

    // adaptive font (legacy candidates 21 → 13, plus 24/22 for short snippets): prefer the biggest size that
    // fits every snapshot WITHOUT wrapping; otherwise the biggest size whose wrapped rows still fit.
    const candidates = [24, 22, 21, 19, 17, 15.5, 14, 13];
    const layoutFor = (cand) => {
      const lh = Math.round(cand * 1.44);
      const g = Math.max(48, Math.round(cand * 2.75));
      const cap = Math.max(12, Math.floor((innerW - g - 14 - 20) / monoCharWidth(cand, 500, MONO)));
      const wr = snapLines.map((lines) => lines.map((l) => wrapTokenLine(l.toks, cap)));
      const rows = Math.max(0, ...wr.map((ls) => ls.reduce((n, r) => n + r.length, 0)));
      const wraps = wr.some((ls) => ls.some((r) => r.length > 1));
      return { fp: cand, lineH: lh, gw: g, wrapped: wr, fits: rows * lh <= availH, wraps };
    };
    const layouts = candidates.map(layoutFor);
    const chosen =
      layouts.find((l) => l.fits && !l.wraps && l.fp > 21 && l.fp <= (split ? 22 : 24)) ||
      layouts.find((l) => l.fits && l.fp <= 21) ||
      layouts[layouts.length - 1];
    const { fp, lineH, gw, wrapped } = chosen;
    const visibleRows = Math.max(1, Math.floor(availH / lineH));

    const accent0 = ACCENTS.cyan;
    const pane = el("div.ccli-pane.ccli-code", { style: { left: `${x}px`, width: `${w}px` } });
    const glowRed = el("div.ccli-glow", { style: { borderColor: "rgba(239,68,68,0.7)", boxShadow: "0 0 30px rgba(239,68,68,0.28), inset 0 0 24px rgba(239,68,68,0.12)" } });
    const glowAmber = el("div.ccli-glow", { style: { borderColor: "rgba(255,153,0,0.6)", boxShadow: "0 0 28px rgba(255,153,0,0.22), inset 0 0 22px rgba(255,153,0,0.1)" } });
    const langKey = String(code.lang || vd.code_language || "json").toLowerCase();
    const head = el(
      "div.ccli-head",
      {},
      el("span.ccli-lang", { text: LANG_TAGS[langKey] || langKey.toUpperCase() }),
      el("div.ccli-tab", {}, fileIcon(common, accent0.bar), el("span.ccli-tab__name", { text: vd.code_title || "code" }))
    );
    const maxLines = Math.max(0, ...snapshots.map((s) => (s.lines || []).length));
    head.appendChild(el("span.ccli-head__meta", { text: `${maxLines} lines · UTF-8` }));

    const body = el("div.ccli-body", { style: { top: `${HEAD}px`, height: `${bodyH}px` } });
    const gutter = el("div.ccli-gutter", { style: { width: `${gw}px` } });
    const scroll = el("div.ccli-scroll");
    const hlLayer = el("div.ccli-layer");
    const textLayer = el("div.ccli-layer");
    const laserLayer = el("div.ccli-layer");
    scroll.append(hlLayer, textLayer, laserLayer);
    body.append(gutter, scroll);
    pane.append(head, body, glowRed, glowAmber);

    // ---- line DOM per snapshot ----
    const snapDom = wrapped.map((linesRows, si) => {
      const snapEl = el("div.ccli-snap", { style: { fontSize: `${fp}px` } });
      textLayer.appendChild(snapEl);
      let rowCursor = 0;
      const lines = linesRows.map((rows, li) => {
        const top = PAD_T + rowCursor * lineH;
        const lineEl = el("div.ccli-line", { style: { top: `${top}px`, height: `${rows.length * lineH}px` } });
        const inner = el("div.ccli-line__in");
        let numEl = null;
        rows.forEach((row, ri) => {
          const rowEl = el("div.ccli-row", { style: { height: `${lineH}px`, lineHeight: `${lineH}px` } });
          if (ri === 0) {
            numEl = el("span.ccli-ln", { text: String(li + 1), style: { width: `${gw - 12}px` } });
            rowEl.appendChild(numEl);
          }
          const src = el("span.ccli-src", { style: { left: `${gw + 14}px` } });
          row.forEach((tk) => {
            const style = { color: tk.c || FG };
            if (tk.s & 1) style.fontStyle = "italic";
            if (tk.s & 2) style.fontWeight = "700";
            if (tk.s & 4) style.textDecoration = "underline";
            src.appendChild(el("span", { text: tk.t, style }));
          });
          rowEl.appendChild(src);
          inner.appendChild(rowEl);
        });
        lineEl.appendChild(inner);
        snapEl.appendChild(lineEl);
        const entry = { el: lineEl, inner, numEl, top, rowStart: rowCursor, rowCount: rows.length, text: snapLines[si][li].text, op: 1, num: LN_COLOR };
        rowCursor += rows.length;
        return entry;
      });
      return { el: snapEl, lines, totalRows: rowCursor };
    });

    // ---- callout slot ----
    let calloutBox = null;
    if (SLOT) {
      calloutBox = el("div.ccli-callouts", { style: { height: `${SLOT}px` } });
      pane.appendChild(calloutBox);
    }
    root.appendChild(pane);

    // ---- timeline: pane + initial cascade ----
    revealPane(pane, t0 + 0.04);
    const initialSnap = code.base >= 0 && snapDom[code.base] ? code.base : Math.max(0, phases.find((ph) => ph.snap >= 0)?.snap ?? 0);
    const initLines = snapDom[initialSnap]?.lines || [];
    const cascadeStart = t0 + 0.18;
    const stagger = Math.min(0.03, 0.55 / Math.max(1, initLines.length));
    initLines.forEach((L, i) => {
      show(L.el, cascadeStart + i * stagger, { from: { left: -12 }, to: { left: 0 }, duration: 0.26 });
    });

    // ---- per-phase state machine ----
    const MORPH = 0.4;
    let curSnap = initialSnap;
    let scrollY = 0;
    let scrollTouched = false;
    const bars = []; // pool: { el, edge, visible, touched }
    let glowState = "none";
    let activeCallout = null;

    const getBar = (k) => {
      if (!bars[k]) {
        const edge = el("div.ccli-hl__edge");
        const bar = el("div.ccli-hl", {}, edge);
        hlLayer.appendChild(bar);
        bars[k] = { el: bar, edge, visible: false };
      }
      return bars[k];
    };

    phases.forEach((ph, k) => {
      const T = ph.t;
      const phase = ph.p;
      const acc = phaseAccent(phase);

      // 1) code_override morph (line-level magic move)
      const nextSnap = ph.snap >= 0 && snapDom[ph.snap] ? ph.snap : curSnap;
      let tState = clampT(T);
      if (nextSnap !== curSnap) {
        morph(snapDom[curSnap].lines, snapDom[nextSnap].lines, T);
        curSnap = nextSnap;
        tState = clampT(T) + 0.002; // after the instant state carry-over of the morph (no overlapping tweens)
      }
      const lines = snapDom[curSnap].lines;

      // 2) dim context lines + accent line numbers
      const hlSet = new Set((phase.lines || []).map(Number).filter((n) => Number.isInteger(n)));
      const hasHl = lines.some((_, li) => hlSet.has(li + 1));
      lines.forEach((L, li) => {
        const isHl = hlSet.has(li + 1);
        const op = hasHl && !isHl ? 0.35 : 1;
        const num = isHl ? acc.bar : LN_COLOR;
        if (op !== L.op) {
          tl.to(L.inner, { opacity: op, duration: fitDur(tState, 0.24), ease: EASE.reveal }, tState);
          L.op = op;
        }
        if (num !== L.num && L.numEl) {
          tl.to(L.numEl, { color: num, duration: fitDur(tState, 0.2), ease: "none" }, tState);
          L.num = num;
        }
      });

      // 3) viewport scroll when the snapshot overflows even at 13px (legacy: centre on first highlight)
      const total = snapDom[curSnap].totalRows;
      let targetScroll = 0;
      if (total > visibleRows) {
        const firstHl = lines.find((_, li) => hlSet.has(li + 1));
        if (firstHl) targetScroll = Math.max(0, Math.min(total - visibleRows, firstHl.rowStart - Math.floor(visibleRows * 0.25))) * lineH;
      }
      if (targetScroll !== scrollY) {
        const tt = clampT(T);
        if (!scrollTouched) {
          tl.fromTo(scroll, { top: 0 }, { top: -targetScroll, duration: fitDur(tt, DUR.camera), ease: EASE.camera }, tt);
          scrollTouched = true;
        } else tl.to(scroll, { top: -targetScroll, duration: fitDur(tt, DUR.camera), ease: EASE.camera }, tt);
        scrollY = targetScroll;
      }

      // 4) highlight bars (pool; glide between phases, colour follows accent)
      const groups = lineGroups([...hlSet], lines.length).map(([a, b]) => {
        const first = lines[a - 1];
        const last = lines[b - 1];
        return { y: PAD_T + first.rowStart * lineH, h: (last.rowStart + last.rowCount - first.rowStart) * lineH };
      });
      const barCount = Math.max(groups.length, bars.length);
      for (let g = 0; g < barCount; g++) {
        const geo = groups[g];
        const bar = geo ? getBar(g) : bars[g];
        if (!bar) continue;
        const tt = clampT(T);
        if (geo && !bar.visible) {
          const vars = { top: geo.y, height: geo.h, backgroundColor: acc.bg };
          if (!seen.has(bar.el)) {
            seen.add(bar.el);
            tl.fromTo(bar.el, { autoAlpha: 0, clipPath: "inset(0% 100% 0% 0%)", ...vars }, { autoAlpha: 1, clipPath: "inset(0% 0% 0% 0%)", ...vars, duration: fitDur(tt, 0.3), ease: EASE.reveal }, tt);
            tl.fromTo(bar.edge, { backgroundColor: acc.bar, boxShadow: acc.glow }, { backgroundColor: acc.bar, boxShadow: acc.glow, duration: 0.001 }, tt);
            seen.add(bar.edge);
          } else {
            tl.to(bar.el, { ...vars, clipPath: "inset(0% 100% 0% 0%)", duration: 0.001 }, tt);
            tl.to(bar.el, { autoAlpha: 1, clipPath: "inset(0% 0% 0% 0%)", duration: fitDur(tt, 0.3), ease: EASE.reveal }, tt + 0.001);
            tl.to(bar.edge, { backgroundColor: acc.bar, boxShadow: acc.glow, duration: 0.001 }, tt);
          }
          bar.visible = true;
        } else if (geo && bar.visible) {
          tl.to(bar.el, { top: geo.y, height: geo.h, backgroundColor: acc.bg, duration: fitDur(tt, 0.36), ease: EASE.camera }, tt);
          tl.to(bar.edge, { backgroundColor: acc.bar, boxShadow: acc.glow, duration: fitDur(tt, 0.3), ease: "none" }, tt);
        } else if (!geo && bar.visible) {
          hide(bar.el, tt, { duration: 0.16 });
          bar.visible = false;
        }
      }

      // 5) pane glow for danger / amber phases
      const wantGlow = acc === ACCENTS.red ? "red" : acc === ACCENTS.amber ? "amber" : "none";
      if (wantGlow !== glowState) {
        if (glowState === "red") hide(glowRed, T, { duration: 0.2 });
        if (glowState === "amber") hide(glowAmber, T, { duration: 0.2 });
        if (wantGlow === "red") show(glowRed, T, { duration: 0.28 });
        if (wantGlow === "amber") show(glowAmber, T, { duration: 0.28 });
        glowState = wantGlow;
      }

      // 6) laser scan over flagged lines (or highlighted lines when laser_scan === true)
      const ls = phase.laser_scan;
      const laserLines = Array.isArray(ls) ? ls : typeof ls === "number" ? [ls] : ls ? [...hlSet] : [];
      lineGroups(laserLines, lines.length).forEach(([a, b], gi) => {
        const first = lines[a - 1];
        const last = lines[b - 1];
        const gy = PAD_T + first.rowStart * lineH;
        const gh = (last.rowStart + last.rowCount - first.rowStart) * lineH;
        const laserW = innerW - gw - 6;
        const beam = el("div.ccli-laser__beam");
        const box = el("div.ccli-laser", { style: { left: `${gw}px`, top: `${gy}px`, height: `${gh}px` } }, el("div.ccli-laser__tint"), beam);
        laserLayer.appendChild(box);
        const tIn = clampT(T + 0.08 + gi * 0.06);
        const tOut = clampT(ph.tEnd);
        show(box, tIn, { from: { clipPath: "inset(50% 0% 50% 0%)" }, to: { clipPath: "inset(0% 0% 0% 0%)" }, duration: 0.22 });
        const sweepStart = tIn + 0.12;
        const windowLen = Math.max(0.3, tOut - sweepStart);
        const PERIOD = 1.25;
        const sweeps = Math.max(1, Math.floor(windowLen / PERIOD));
        const period = Math.min(PERIOD, windowLen);
        tl.fromTo(beam, { left: -150 }, { left: laserW + 10, duration: period, ease: "power1.inOut", repeat: sweeps - 1 }, Math.max(t0, Math.min(sweepStart, limit - sweeps * period)));
        if (ph.tEnd < limit - 0.05) hide(box, tOut, { duration: 0.16 });
      });

      // 7) callout bar per phase (crossfade) + annotation on the target words
      const calloutText = String(phase.callout || "").trim();
      if (activeCallout) {
        hide(activeCallout, T, { duration: 0.14 });
        activeCallout = null;
      }
      if (calloutText && calloutBox) {
        const parts = splitCallout(calloutText, phase.annotate_text);
        const laser = Boolean(phase.laser_scan);
        const avail = innerW - 44 - 36;
        const twoLines = textWidth(`600 20px ${SANS}`, calloutText) > avail;
        const target = el("span.ccli-target", { text: parts.target, style: { color: laser ? "#FCA5A5" : "#F0C040" } });
        // rough-notation style mark sized in real px (measureText) so pathLength-normalised dashes draw evenly
        const fsz = twoLines ? 17 : 20;
        const aw = Math.ceil(textWidth(`800 ${fsz}px ${SANS}`, parts.target)) + 10;
        const ah = Math.round(fsz * 1.3) + 8;
        const annot = svg("svg", { class: "ccli-annot", width: aw, height: ah, viewBox: `0 0 ${aw} ${ah}` });
        const f = (n) => n.toFixed(1);
        const path = svg("path", {
          d: laser
            ? `M ${f(4)} ${f(5)} L ${f(aw - 3)} ${f(3.5)} L ${f(aw - 3.5)} ${f(ah - 3)} L ${f(3)} ${f(ah - 2.5)} L ${f(4.5)} ${f(3)}`
            : `M ${f(2)} ${f(ah - 3)} C ${f(aw * 0.3)} ${f(ah - 1)}, ${f(aw * 0.68)} ${f(ah - 5.5)}, ${f(aw - 1)} ${f(ah - 2.5)}`,
          fill: "none",
          stroke: laser ? "#EF4444" : "#F0C040",
          "stroke-width": 2.4,
          "stroke-linecap": "butt",
          "stroke-linejoin": "round",
          pathLength: 1,
        });
        annot.appendChild(path);
        target.appendChild(annot);
        const textEl = el(
          twoLines ? "span.ccli-callout__text.ccli-callout__text--2" : "span.ccli-callout__text",
          { style: { fontSize: twoLines ? "17px" : "20px", color: acc.text } },
          parts.before,
          target,
          parts.after
        );
        const box = el(
          "div.ccli-callout",
          { style: { background: acc.calloutBg, borderTopColor: acc.calloutBorder } },
          el("span.ccli-callout__icon", { text: "👉" }),
          textEl
        );
        calloutBox.appendChild(box);
        show(box, T + 0.06, { from: { filter: "blur(6px)" }, to: { filter: "blur(0px)" }, duration: 0.26 });
        drawPath(tl, path, clampT(T + 0.34), fitDur(clampT(T + 0.34), 0.32), 1);
        activeCallout = box;
      }
    });

    // ---- morph helper (closure over tl / show / hide) ----
    function morph(fromLines, toLines, T) {
      const tt = clampT(T);
      const pairs = lcsPairs(fromLines.map((l) => l.text), toLines.map((l) => l.text));
      const keptA = new Set(pairs.map(([a]) => a));
      const keptB = new Map(pairs.map(([a, b]) => [b, a]));
      fromLines.forEach((L, ai) => {
        if (keptA.has(ai)) hide(L.el, tt, { duration: 0.001, ease: "none" });
        else hide(L.el, tt, { to: { left: 18 }, duration: 0.16, ease: "power2.out" });
      });
      toLines.forEach((L, bi) => {
        if (keptB.has(bi)) {
          const src = fromLines[keptB.get(bi)];
          const dy = src.top - L.top;
          // carry the visual state of the kept line so the swap is invisible
          if (src.op !== L.op) {
            tl.to(L.inner, { opacity: src.op, duration: 0.001 }, tt);
            L.op = src.op;
          }
          if (src.num !== L.num && L.numEl) {
            tl.to(L.numEl, { color: src.num, duration: 0.001 }, tt);
            L.num = src.num;
          }
          show(L.el, tt, { from: { left: 0, top: src.top }, duration: 0.001, ease: "none" });
          if (dy !== 0) tl.to(L.el, { top: L.top, duration: fitDur(tt + 0.002, MORPH), ease: EASE.reveal }, tt + 0.002);
        } else {
          show(L.el, tt + 0.08, { from: { left: -16, top: L.top }, to: { left: 0 }, duration: 0.3 });
        }
      });
    }
  }

  // =================================================================================================
  // Terminal pane
  // =================================================================================================
  function buildTerminalPane(x, w) {
    const innerW = w - 4;
    const innerH = H - 4;
    const HEAD = 56;
    const PAD_X = 26;
    const PAD_T = 20;
    const PAD_B = 18;
    const bodyH = innerH - HEAD;
    const viewH = bodyH - PAD_T - PAD_B;
    const contentW = innerW - PAD_X * 2;
    const fp = split ? (cmds.length > 3 ? 18 : 20) : cmds.length > 3 ? 20 : 22;
    const LH = Math.round(fp * 1.45);
    const OLH = Math.round(LH * 0.92);
    const chW = monoCharWidth(fp, 700, MONO);
    const cap = Math.max(16, Math.floor(contentW / chW) - 2); // minus the "$ " / continuation indent
    const outCap = Math.max(16, Math.floor(contentW / monoCharWidth(fp, 500, MONO)));
    const BANNER_H = 32;
    const BLOCK_GAP = 14;
    const curH = Math.round(fp * 1.05);
    const curMargin = Math.round((LH - curH) / 2);

    const pane = el("div.ccli-pane.ccli-term", { style: { left: `${x}px`, width: `${w}px` } });
    const head = el(
      "div.ccli-head",
      {},
      el("span.ccli-tbadge", { text: vd.terminal_badge || "SANDBOX · CLI" }),
      el("span.ccli-ttitle", { text: vd.terminal_title || "AWS Terminal" }),
      el("span.ccli-dots", {}, ["#EF4444", "#F59E0B", "#10B981"].map((c) => el("span", { style: { background: c, opacity: 0.85 } })))
    );
    const body = el("div.ccli-tbody", { style: { top: `${HEAD}px`, height: `${bodyH}px` } });
    const content = el("div.ccli-tscroll", { style: { left: `${PAD_X}px`, top: `${PAD_T}px`, width: `${contentW}px`, fontSize: `${fp}px` } });
    body.appendChild(content);
    const alarm = el("div.ccli-glow", { style: { borderColor: "rgba(239,68,68,0.75)", boxShadow: "0 0 30px rgba(239,68,68,0.3), inset 0 0 26px rgba(239,68,68,0.14)" } });
    pane.append(head, body, alarm);
    root.appendChild(pane);
    revealPane(pane, t0 + (split ? 0.12 : 0.04));

    const makeCursor = () => {
      const cur = el("span.ccli-cur", { style: { height: `${curH}px`, marginTop: `${curMargin}px` } });
      const wrap = el("span.ccli-curwrap", { style: { height: `${LH}px`, marginLeft: "2px" } }, cur);
      return { wrap, cur };
    };
    const makeRow = (top, h) => el("div.ccli-trow", { style: { top: `${top}px`, height: `${h}px`, lineHeight: `${h}px` } });

    // ---- layout + timing (absolute seconds) ----
    let y = 0;
    let prevFinish = t0 + 0.3; // idle prompt of the first command appears with the pane
    const events = []; // { t, bottom } for auto-scroll
    const blocks = cmds.map((entry, k) => {
      const c = entry.c;
      const command = String(c.command).trim();
      const S = Math.min(Math.max(at(entry.ps), t0 + 0.2), limit - 0.4);
      const nextS = k + 1 < cmds.length ? Math.max(at(cmds[k + 1].ps), t0 + 0.2) : limit;
      const tdRaw = Number(c.type_duration);
      const td = Number.isFinite(tdRaw) && tdRaw > 0 ? tdRaw : 0.14;
      let typeSec = td <= 1 ? td * dur : td; // legacy: progress units; >1 is read as seconds
      typeSec = Math.max(0.2, Math.min(typeSec, Math.max(0.2, nextS - S - 0.1), limit - S - 0.15));
      const cmdRows = wrapChars(command, cap);
      const totalChars = Math.max(1, cmdRows.reduce((n, r) => n + r.length, 0));
      const outLines = (Array.isArray(c.output_lines) ? c.output_lines : []).map((l) => String(l ?? ""));
      const outRows = outLines.flatMap((l) => wrapChars(l, outCap));
      const isErr = isErrorCommand(c);
      const P = Math.min(S, prevFinish); // prompt (idle cursor) appears when the previous output is done

      const block = { S, P, typeSec, rows: [], outRows: [], banner: null, isErr };
      let charsBefore = 0;
      cmdRows.forEach((text, j) => {
        const row = makeRow(y, LH);
        if (j === 0) row.appendChild(el("span.ccli-prompt", { text: "$ " }));
        else row.appendChild(el("span", { text: "  " }));
        const typed = el("span.ccli-cmd");
        const cursor = makeCursor();
        row.append(typed, cursor.wrap);
        content.appendChild(row);
        const tStart = S + (typeSec * charsBefore) / totalChars;
        const tDur = (typeSec * Math.max(1, text.length)) / totalChars;
        charsBefore += text.length;
        block.rows.push({ row, typed, cursor, text, tStart, tDur, top: y });
        events.push({ t: j === 0 ? P : tStart, bottom: y + LH });
        y += LH;
      });
      const typedEnd = S + typeSec;
      let tCursor = typedEnd;
      let lastOutT = typedEnd;
      if (outRows.length) {
        y += 4;
        const st = Math.min(0.06, 0.45 / outRows.length);
        outRows.forEach((text, j) => {
          const row = makeRow(y, OLH);
          row.appendChild(el(isErr ? "span.ccli-out.ccli-out--err" : "span.ccli-out", { text }));
          content.appendChild(row);
          const t = typedEnd + 0.04 + j * st;
          block.outRows.push({ row, t, top: y });
          events.push({ t, bottom: y + OLH });
          y += OLH;
          lastOutT = t;
          tCursor = t + 0.16;
        });
      }
      if (isErr) {
        y += 6;
        const banner = el("div.ccli-banner", { style: { top: `${y}px` } }, el("span", { text: "⚠" }), el("span", { text: "SANDBOX GUARD · ACCESS DENIED / POLICY BLOCKED" }));
        content.appendChild(banner);
        const tB = lastOutT + 0.06;
        block.banner = { el: banner, t: tB };
        events.push({ t: tB, bottom: y + BANNER_H });
        y += BANNER_H;
        tCursor = Math.max(tCursor, tB + 0.28);
      }
      y += BLOCK_GAP;
      block.finish = tCursor;
      prevFinish = tCursor;
      return block;
    });

    // trailing idle prompt after the last command
    const idleRow = makeRow(y, LH);
    idleRow.appendChild(el("span.ccli-prompt", { text: "$ " }));
    const idleCursor = makeCursor();
    idleRow.appendChild(idleCursor.wrap);
    content.appendChild(idleRow);
    const tIdle = Math.min(prevFinish + 0.05, limit - 0.1);
    events.push({ t: tIdle, bottom: y + LH });

    // ---- tweens ----
    let alarmFree = -Infinity;
    blocks.forEach((b) => {
      b.rows.forEach((r, j) => {
        const appearT = j === 0 ? b.P : r.tStart;
        show(r.row, appearT, { duration: j === 0 && b.P < b.S - 0.05 ? 0.18 : 0.001, ease: "none" });
        typewriter(tl, r.typed, r.text, clampT(r.tStart), fitDur(clampT(r.tStart), Math.max(0.05, r.tDur)));
        // cursor: solid while typing (and idle-blinking on the prompt before typing starts)
        const off = j === b.rows.length - 1 ? b.S + b.typeSec : r.tStart + r.tDur;
        if (off <= appearT + 0.004) return;
        show(r.cursor.wrap, appearT, { duration: 0.001, ease: "none" });
        if (j === 0 && b.S - b.P > 0.3) blink(tl, r.cursor.cur, b.P + 0.15, b.S);
        hide(r.cursor.wrap, off, { duration: 0.001, ease: "none" });
      });
      b.outRows.forEach((o) => show(o.row, o.t, { from: { top: o.top + 6 }, to: { top: o.top }, duration: 0.16 }));
      if (b.banner) {
        show(b.banner.el, b.banner.t, { from: { clipPath: "inset(0% 100% 0% 0%)" }, to: { clipPath: "inset(0% 0% 0% 0%)" }, duration: 0.28 });
        // brief red alarm on the terminal frame
        const tt = clampT(b.banner.t);
        if (tt >= alarmFree) {
          show(alarm, tt, { duration: 0.18, ease: "none" });
          const back = clampT(tt + 0.8);
          if (back > tt + 0.2) hide(alarm, back, { duration: 0.5, ease: "none" });
          alarmFree = back + 0.52;
        }
      }
    });
    show(idleRow, tIdle, { duration: 0.12, ease: "none" });
    show(idleCursor.wrap, tIdle, { duration: 0.001, ease: "none" });
    blink(tl, idleCursor.cur, tIdle + 0.2, limit - 0.05);

    // ---- auto-scroll (terminal keeps the newest line in view); clusters of close events share a tween ----
    events.sort((a, b) => a.t - b.t);
    let scrolled = 0;
    let scrollTouched = false;
    let lastTweenT = -Infinity;
    let i = 0;
    while (i < events.length) {
      let j = i;
      let need = Math.max(0, events[i].bottom - viewH);
      while (j + 1 < events.length && events[j + 1].t - events[i].t < 0.35) {
        j++;
        need = Math.max(need, events[j].bottom - viewH);
      }
      if (need > scrolled + 0.5) {
        const tt = clampT(Math.max(events[i].t, lastTweenT + 0.26));
        const d = fitDur(tt, 0.25);
        if (!scrollTouched) {
          tl.fromTo(content, { top: PAD_T }, { top: PAD_T - need, duration: d, ease: "power2.out" }, tt);
          scrollTouched = true;
        } else tl.to(content, { top: PAD_T - need, duration: d, ease: "power2.out" }, tt);
        scrolled = need;
        lastTweenT = tt;
      }
      i = j + 1;
    }
  }
}
