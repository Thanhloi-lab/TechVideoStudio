// Tech Video Studio × HyperFrames — shared browser helpers for DOM + GSAP scene builders.
// Copied verbatim into every compiled composition as `lib/tvs-hf-common.mjs`.
//
// Determinism contract (HyperFrames): every visual must be a pure function of the timeline time.
// No Date.now(), no Math.random(), no requestAnimationFrame, no setTimeout, no GSAP callbacks
// (onUpdate/onComplete/call): HyperFrames seeks with timeline.totalTime(t, suppressEvents).

import { MOTION_TOKENS, clamp01 } from "./kernel.mjs";
import { ICON_GLYPHS, TONE_STYLES, getTone, renderIconSvg } from "./icons.mjs";

export { MOTION_TOKENS, clamp01, getTone, ICON_GLYPHS, TONE_STYLES };

export const FRAME_W = 1920;
export const FRAME_H = 1080;

export const CAUSAL_MECHANICS = Object.freeze([
  "blur-materialize",
  "wire-draw",
  "arc-emission",
  "width-push",
  "squash-drop",
  "typographic-strike",
]);

/**
 * Content stage box (px, 1920x1080 frame): below the 92px top bar, above the subtitle band.
 * Matches the legacy Canvas 2D content area (x 88..1832, y 128..900).
 */
export const STAGE = Object.freeze({ left: 88, top: 128, width: 1744, height: 772 });

export const palette = MOTION_TOKENS.paletteV2;

/** GSAP ease names mirroring MOTION_TOKENS (Quart-Out reveal, accelerate-out exit, camera). */
export const EASE = Object.freeze({
  reveal: "power3.out",
  exit: "power2.in",
  camera: "power3.inOut",
  spring: "back.out(2.4)",
  linear: "none",
});

/** Seconds, from MOTION_TOKENS.timing (ms). */
export const DUR = Object.freeze({
  reveal: MOTION_TOKENS.timing.elementRevealMs / 1000,
  exit: MOTION_TOKENS.timing.sceneExitMs / 1000,
  breather: MOTION_TOKENS.timing.sceneBreatherMs / 1000,
  stagger: MOTION_TOKENS.timing.listStaggerMs / 1000,
  stamp: MOTION_TOKENS.timing.stampSlamMs / 1000,
  camera: MOTION_TOKENS.timing.cameraFocusMs / 1000,
  cursorBlinkHalf: MOTION_TOKENS.timing.cursorBlinkHalfMs / 1000,
});

const SVG_NS = "http://www.w3.org/2000/svg";

function applyAttrs(node, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, value === true ? "" : String(value));
  }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

/**
 * Create an HTML element.
 * @param {string} tag  e.g. "div" or "div.card.card--red" (dot-separated classes allowed)
 * @param {{ class?: string, style?: object|string, text?: string, html?: string, attrs?: object, id?: string }} [opts]
 * @param {...any} children
 */
export function el(tag, opts = {}, ...children) {
  const [name, ...classes] = String(tag).split(".");
  const node = document.createElement(name || "div");
  if (classes.length) node.className = classes.join(" ");
  if (opts.class) node.className = [node.className, opts.class].filter(Boolean).join(" ");
  if (opts.id) node.id = opts.id;
  if (opts.style) {
    if (typeof opts.style === "string") node.style.cssText = opts.style;
    else Object.assign(node.style, opts.style);
  }
  applyAttrs(node, opts.attrs);
  if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
  if (opts.html !== undefined && opts.html !== null) node.innerHTML = String(opts.html);
  appendChildren(node, children);
  return node;
}

/** Create an SVG element (attrs are set verbatim, e.g. { "stroke-width": 2 }). */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

const CAMEL_TO_KEBAB = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** Tiny React.createElement shim so icons.mjs#renderIconSvg can build real SVG DOM nodes. */
const SVG_REACT_SHIM = {
  createElement(tag, props, ...children) {
    const attrs = {};
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "key" || k === "children") continue;
      attrs[k === "viewBox" ? "viewBox" : CAMEL_TO_KEBAB(k)] = v;
    }
    return svg(tag, attrs, ...children);
  },
};

/** Vector icon (same glyph set as the Studio player) as an <svg> element. */
export function icon(name, color = "#F8FAFC", size = 34) {
  try {
    const node = renderIconSvg(SVG_REACT_SHIM, name, color, size);
    if (node) return node;
  } catch {
    // fall through to emoji glyph
  }
  return el("span.tvs-icon-glyph", { text: ICON_GLYPHS[name] || "•", style: { fontSize: `${Math.round(size * 0.8)}px` } });
}

/** Deterministic PRNG (mulberry32), identical to kernel.mjs#createRng. */
export function rng(seed = 20260401) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit FNV-1a hash of a string (for per-scene seeds). */
export function hashString(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Read a progress mark in [0..1] with fallback. */
export function mark(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp01(n) : clamp01(fallback);
}

/** Escape text for innerHTML use. Prefer el(..., { text }) instead whenever possible. */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Render `**bold**` / `highlight_words` accents as spans (box-free subtitle & callout styling).
 * Returns an array of Text/Element nodes.
 */
export function accentNodes(segments) {
  return (segments || []).map((seg) =>
    seg.accent ? el("span.tvs-accent", { text: seg.text }) : document.createTextNode(String(seg.text || ""))
  );
}

/** Format a number with fixed decimals and thousands separators (en-US style, deterministic). */
export function formatNumber(value, decimals = 0) {
  const d = Math.max(0, Math.min(6, Math.floor(Number(decimals) || 0)));
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  const fixed = Math.abs(n).toFixed(d);
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/**
 * Render a split rectangular SharpTag (`border-radius: 3px`, `1.5px` border:
 * accent-filled uppercase label cell + monospace value cell).
 */
export function sharpTag(label, value, { tone = "blue", className = "" } = {}) {
  const t = getTone(tone);
  const tag = el(`div.tvs-sharp-tag${className ? `.${className}` : ""}`, {
    style: { borderColor: t.border || t.badge || "rgba(16, 192, 240, 0.6)" },
  });
  tag.appendChild(
    el("span.tvs-sharp-tag__label", {
      text: String(label ?? ""),
      style: { background: t.badge || t.border || "#10C0F0", color: "#020A14" },
    })
  );
  if (value !== undefined && value !== null && String(value) !== "") {
    tag.appendChild(
      el("span.tvs-sharp-tag__value", {
        text: String(value),
      })
    );
  }
  return tag;
}

/**
 * Standard "blur-to-sharp" or causal-mechanic element reveal used across templates.
 * Always drops CSS `filter` and `clipPath` at completion for seek-order determinism.
 */
export function reveal(tl, target, t, opts = {}) {
  const {
    y = 18,
    x = 0,
    scale = 1,
    blur = 12,
    duration = DUR.reveal,
    ease = EASE.reveal,
    immediateRender = true,
    mechanic = "blur-materialize",
  } = opts;

  let fromVars = { autoAlpha: 0, x, y, scale: scale === 1 ? 1 : scale, filter: `blur(${blur}px)` };
  let toVars = { autoAlpha: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)", duration, ease, immediateRender };

  if (mechanic === "width-push" || mechanic === "wire-draw") {
    fromVars = { autoAlpha: 0, x: x || -28, y: 0, scale: 1, clipPath: "inset(0 100% 0 0)" };
    toVars = { autoAlpha: 1, x: 0, y: 0, scale: 1, clipPath: "inset(0 0% 0 0)", duration, ease, immediateRender };
  } else if (mechanic === "arc-emission") {
    fromVars = { autoAlpha: 0, x: -16, y: Math.max(22, Math.abs(y) || 22), scale: 0.94, filter: `blur(${Math.min(8, blur)}px)` };
  } else if (mechanic === "squash-drop") {
    fromVars = { autoAlpha: 0, x: 0, y: -Math.max(24, Math.abs(y) || 24), scaleX: 0.95, scaleY: 1.08 };
    toVars = { autoAlpha: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, duration, ease: EASE.spring, immediateRender };
  } else if (mechanic === "typographic-strike") {
    fromVars = { autoAlpha: 0, x: 0, y: 0, scale: 1.14, filter: `blur(${Math.min(6, blur)}px)` };
  }

  tl.fromTo(target, fromVars, toVars, t);
  // Drop lingering filter / clipPath surfaces explicitly with fromTo so forward & reverse seeks render identical pixels.
  tl.fromTo(
    target,
    {
      filter: toVars.filter || "none",
      clipPath: toVars.clipPath || "none",
    },
    {
      filter: "none",
      clipPath: "none",
      duration: 0,
      immediateRender: false,
    },
    t + duration
  );
}

/** Slam-in stamp (scale 1.45 → 1, spring-ish), used for alert stamps & badges. */
export function stamp(tl, target, t, opts = {}) {
  const { from = 1.45, rotation = 0, duration = DUR.stamp * 2.2 } = opts;
  tl.fromTo(
    target,
    { autoAlpha: 0, scale: from, rotation: rotation ? rotation * 1.6 : 0 },
    { autoAlpha: 1, scale: 1, rotation, duration, ease: EASE.spring },
    t
  );
}

/**
 * Typewriter for monospace text: animates a clip width in `ch` units with stepped easing.
 * The element must use a monospace font and `white-space: pre`.
 */
export function typewriter(tl, target, text, t, duration) {
  const len = Math.max(1, String(text || "").length);
  target.textContent = String(text || "");
  target.style.display = "inline-block";
  target.style.overflow = "hidden";
  target.style.verticalAlign = "top";
  target.style.whiteSpace = "pre";
  tl.fromTo(
    target,
    { width: "0ch" },
    { width: `${len}ch`, duration: Math.max(0.05, duration), ease: `steps(${len})` },
    t
  );
}

/**
 * Finite blink (HyperFrames forbids infinite repeats): toggles opacity every `half` seconds
 * between `from` and `to` absolute times.
 */
export function blink(tl, target, from, to, half = DUR.cursorBlinkHalf) {
  const span = Math.max(0, to - from);
  const cycles = Math.max(0, Math.floor(span / (half * 2)));
  if (cycles <= 0) return;
  tl.fromTo(
    target,
    { opacity: 1 },
    { opacity: 0, duration: half, ease: "steps(1)", repeat: cycles * 2 - 1, yoyo: true, immediateRender: false },
    from
  );
}

/**
 * SVG path "draw on" (stroke-dashoffset) — rough-notation style strike/circle/underline.
 * `length` = path length in user units; omit it to normalise the path with pathLength="1"
 * (so short and long paths both draw over the whole duration).
 */
export function drawPath(tl, path, t, duration = 0.32, length = null, ease = "power2.out") {
  if (!(Number(length) > 0)) {
    path.setAttribute("pathLength", "1");
    length = 1;
  }
  path.setAttribute("stroke-dasharray", String(length));
  tl.fromTo(path, { attr: { "stroke-dashoffset": length } }, { attr: { "stroke-dashoffset": 0 }, duration, ease }, t);
}

/** Hand-drawn style SVG paths for annotations (deterministic jitter from seed). */
export function roughStrikePath(w, h, seed = 1) {
  const r = rng(seed);
  const y = h * (0.52 + (r() - 0.5) * 0.06);
  return `M ${-4} ${y + (r() - 0.5) * 4} C ${w * 0.3} ${y + (r() - 0.5) * 6}, ${w * 0.7} ${y + (r() - 0.5) * 6}, ${w + 4} ${y + (r() - 0.5) * 4}`;
}

export function roughEllipsePath(w, h, seed = 1) {
  const r = rng(seed);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 + 10;
  const ry = h / 2 + 8;
  const pts = [];
  const steps = 28;
  for (let i = 0; i <= steps + 3; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    const jx = (r() - 0.5) * 5;
    const jy = (r() - 0.5) * 4;
    pts.push(`${(cx + Math.cos(a) * rx + jx).toFixed(1)} ${(cy + Math.sin(a) * ry + jy).toFixed(1)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(" L ")}`;
}

/** Linear interpolation of a numeric series into an SVG polyline `points` string. */
export function sparklinePoints(series, w, h, pad = 4) {
  const nums = (series || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  return nums
    .map((v, i) => {
      const x = pad + (i / (nums.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
