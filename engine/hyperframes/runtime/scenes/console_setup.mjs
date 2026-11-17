// console_setup — DOM + GSAP scene builder (HyperFrames composition).
// Cloud-console walkthrough: browser chrome (URL bar, step pill), left nav, stepper, one form panel per step
// (text / radio / checkbox_row fields, spotlight viewfinder, tip callout, primary button with cursor click).
//
// Contract (engine/HYPERFRAMES_ENGINE.md §6): DOM inside ctx.stage, tweens on ctx.tl at ABSOLUTE times
// (ctx.at(progress) + fixed offsets in seconds). No callbacks, no randomness, no wall clock, no DOM measuring
// (absolute layout from fixed metrics + canvas measureText).
//
// Motion uses opacity / blur / layout properties (left, top, inset, width) rather than transforms on large
// boxes: a sub-pixel translate on a composited box makes Chrome reuse a fractionally-offset raster later,
// which breaks the "same frame ⇒ same pixels" contract when frames are captured out of order.
//
// Legacy semantics (engine/src/canvas_templates/console_setup.mjs + components/CleanConsoleMockup.mjs):
//   • active step = the step whose [progress_start, progress_end] window contains the playhead
//     (here: sticky until the next step starts; the last step stays to the end of the scene)
//   • step switch = blur-to-sharp (220 ms) exit/enter of the form; "Bước n/N" pill + stepper chips update
//   • fields: adaptive heights (legacy 52..114 px budget), spotlight (highlight) = cyan border, glow pulse,
//     viewfinder L-brackets, others dimmed to 48 %
//   • highlight_button: cursor glides in at 56 % of the step, clicks at 84 % (press + ripple until 98 %)

const STYLE_ID = "tvs-style-console-setup";

const CSS = `
.cset { position: absolute; inset: 0; }
.cset-vf { position: absolute; pointer-events: none; opacity: 0; visibility: hidden; }
.cset-vf span { position: absolute; width: 30px; height: 30px; border: 0 solid var(--tvs-cyan); filter: drop-shadow(0 0 6px rgba(16,192,240,0.7)); }
.cset-vf .tl { left: 0; top: 0; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 6px; }
.cset-vf .tr { right: 0; top: 0; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 6px; }
.cset-vf .bl { left: 0; bottom: 0; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 6px; }
.cset-vf .br { right: 0; bottom: 0; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 6px; }
.cset-win { position: absolute; inset: 0; border-radius: 20px; overflow: hidden; background: rgba(11,20,38,0.96);
  border: 2px solid rgba(51,65,85,0.9); box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
.cset-top { position: absolute; left: 0; right: 0; top: 0; height: 60px; display: flex; align-items: center; gap: 18px; padding: 0 22px;
  background: #131E36; border-bottom: 1px solid rgba(148,163,184,0.18); }
.cset-dots { flex: none; display: flex; gap: 10px; }
.cset-dots span { width: 14px; height: 14px; border-radius: 50%; }
.cset-url { flex: 1 1 auto; min-width: 0; height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-radius: 10px;
  background: #060C18; border: 1px solid rgba(148,163,184,0.16); }
.cset-url__text { min-width: 0; font: 600 18px var(--tvs-mono); color: #CBD5E1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cset-url__text b { color: #F8FAFC; font-weight: 700; }
.cset-load { position: absolute; left: 0; bottom: -1px; height: 3px; width: 0; border-radius: 2px;
  background: linear-gradient(90deg, var(--tvs-accent), var(--tvs-cyan) 70%, var(--tvs-glow)); box-shadow: 0 0 10px rgba(16,192,240,0.8); }
.cset-pill { flex: none; position: relative; height: 36px; border-radius: 10px; background: rgba(42,98,255,0.24); border: 1.5px solid rgba(16,192,240,0.55);
  color: var(--tvs-glow); font: 700 19px var(--tvs-font); overflow: hidden; }
.cset-pill span { position: absolute; left: 0; right: 0; top: 0; line-height: 33px; text-align: center; white-space: nowrap; opacity: 0; visibility: hidden; }
.cset-nav { position: absolute; left: 0; top: 60px; bottom: 0; background: #060C18; border-right: 1px solid rgba(148,163,184,0.16); padding: 22px 16px; }
.cset-nav__title { position: relative; display: flex; align-items: center; gap: 12px; height: 40px; margin-bottom: 14px; opacity: 0; visibility: hidden; }
.cset-nav__logo { flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
  background: linear-gradient(135deg, #FF9900, #F0C040); box-shadow: 0 0 14px rgba(240,192,64,0.35); }
.cset-nav__name { min-width: 0; font: 800 20px var(--tvs-font); color: var(--tvs-gold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cset-nav__item { position: relative; height: 44px; line-height: 44px; margin-bottom: 6px; padding: 0 16px; border-radius: 10px;
  font: 500 18px var(--tvs-font); color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; visibility: hidden; }
.cset-nav__hl { position: absolute; left: 16px; right: 16px; height: 44px; border-radius: 10px; background: rgba(16,192,240,0.16);
  box-shadow: inset 4px 0 0 var(--tvs-cyan), 0 0 18px rgba(16,192,240,0.15); opacity: 0; visibility: hidden; }
.cset-nav__item.is-active { color: #E0F7FF; font-weight: 700; }
.cset-main { position: absolute; top: 60px; right: 0; bottom: 0; }
.cset-stepper { position: absolute; left: 32px; right: 32px; top: 22px; height: 44px; display: flex; align-items: center; gap: 12px; }
.cset-chip { position: relative; flex: 0 1 auto; min-width: 0; height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 16px 0 6px;
  border-radius: 20px; background: #131E36; border: 1.5px solid rgba(148,163,184,0.14); color: #94A3B8; opacity: 0; visibility: hidden; }
.cset-chip__num { position: relative; flex: none; width: 28px; height: 28px; border-radius: 50%; background: #1E293B; color: #CBD5E1;
  font: 800 15px var(--tvs-font); }
.cset-chip__num span { position: absolute; inset: 0; display: grid; place-items: center; }
.cset-chip__label { min-width: 0; font: 600 16px var(--tvs-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cset-sep { flex: none; width: 18px; height: 2px; border-radius: 1px; background: rgba(148,163,184,0.25); opacity: 0; visibility: hidden; }
.cset-card { position: absolute; left: 32px; right: 32px; bottom: 24px; border-radius: 16px; background: #081020;
  border: 1.5px solid rgba(148,163,184,0.2); opacity: 0; visibility: hidden; }
.cset-step { position: absolute; opacity: 0; visibility: hidden; }
.cset-head { position: absolute; left: 0; right: 0; top: 0; height: 44px; display: flex; align-items: center; gap: 14px; }
.cset-head__num { flex: none; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; font: 800 20px var(--tvs-font); color: #020A14;
  background: linear-gradient(135deg, var(--tvs-cyan), var(--tvs-glow)); box-shadow: 0 0 16px rgba(16,192,240,0.45); }
.cset-head__text { position: relative; min-width: 0; font: 700 28px var(--tvs-font); color: #F8FAFC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cset-field { position: absolute; left: 0; right: 0; }
.cset-field__box { position: absolute; inset: 0; border-radius: 12px; background: #131E36; border: 1.5px solid rgba(148,163,184,0.24); }
.cset-field__glow { position: absolute; inset: -2px; border-radius: 14px; border: 3px solid var(--tvs-cyan); background: rgba(16,192,240,0.12);
  box-shadow: 0 0 26px rgba(16,192,240,0.45), inset 0 0 18px rgba(16,192,240,0.12); opacity: 0; visibility: hidden; }
.cset-field__in { position: absolute; inset: 0; padding: 0 26px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.cset-field__in--row { flex-direction: row; align-items: center; justify-content: flex-start; gap: 22px; }
.cset-label { min-width: 0; font-family: var(--tvs-font); font-weight: 600; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cset-field__in--row .cset-label { flex: none; }
.cset-value { position: relative; min-width: 0; display: flex; align-items: center; white-space: nowrap; overflow: hidden; }
.cset-typed { font-family: var(--tvs-mono); font-weight: 700; color: #F8FAFC; font-variant-ligatures: none; }
.cset-caret { flex: none; width: 3px; margin-left: 2px; background: var(--tvs-cyan); box-shadow: 0 0 8px rgba(16,192,240,0.8); opacity: 0; visibility: hidden; }
.cset-radios { display: flex; gap: 12px; min-width: 0; overflow: hidden; }
.cset-radio { position: relative; flex: none; display: flex; align-items: center; gap: 10px; border-radius: 9px; background: #060C18;
  border: 1.5px solid rgba(148,163,184,0.18); color: #94A3B8; font-family: var(--tvs-font); font-weight: 600; white-space: nowrap; }
.cset-radio__sel { position: absolute; inset: -1.5px; border-radius: 9px; border: 2px solid var(--tvs-cyan); background: rgba(16,192,240,0.1);
  box-shadow: 0 0 12px rgba(16,192,240,0.3); opacity: 0; visibility: hidden; }
.cset-radio__c { position: relative; flex: none; border-radius: 50%; border: 2px solid var(--tvs-cyan); }
.cset-radio__dot { position: absolute; border-radius: 50%; background: var(--tvs-cyan); box-shadow: 0 0 8px rgba(16,192,240,0.9); opacity: 0; visibility: hidden; }
.cset-radio__t { position: relative; }
.cset-check { position: relative; flex: none; border-radius: 6px; border: 2px solid rgba(110,231,183,0.7); margin-right: 14px; }
.cset-check__fill { position: absolute; inset: -2px; border-radius: 6px; background: #10B981; box-shadow: 0 0 12px rgba(16,185,129,0.55);
  display: grid; place-items: center; color: #020A14; font-weight: 900; opacity: 0; visibility: hidden; }
.cset-checkv { min-width: 0; font-family: var(--tvs-mono); font-weight: 700; color: #6EE7B7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-variant-ligatures: none; }
.cset-bk { position: absolute; pointer-events: none; opacity: 0; visibility: hidden; }
.cset-bk span { position: absolute; width: 18px; height: 18px; border: 0 solid var(--tvs-cyan); filter: drop-shadow(0 0 6px rgba(16,192,240,0.8)); }
.cset-bk .tl { left: 0; top: 0; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 4px; }
.cset-bk .tr { right: 0; top: 0; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 4px; }
.cset-bk .bl { left: 0; bottom: 0; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 4px; }
.cset-bk .br { right: 0; bottom: 0; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 4px; }
.cset-tip { position: absolute; left: 0; display: flex; align-items: center; gap: 14px; padding: 0 20px 0 18px; border-radius: 12px;
  background: rgba(240,192,64,0.07); border: 1px solid rgba(240,192,64,0.28); opacity: 0; visibility: hidden; }
.cset-tip__bar { position: absolute; left: 0; top: 10px; bottom: 10px; width: 4px; border-radius: 2px; background: var(--tvs-gold); box-shadow: 0 0 10px rgba(240,192,64,0.7); }
.cset-tip__icon { flex: none; font-size: 24px; line-height: 1; }
.cset-tip__text { min-width: 0; font: 600 20px/27px var(--tvs-font); color: #E2E8F0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cset-btn { position: absolute; height: 52px; border-radius: 12px; display: grid; place-items: center; font: 700 21px var(--tvs-font); color: #FFFFFF;
  background: #1E293B; border: 1.5px solid rgba(148,163,184,0.25); white-space: nowrap; }
.cset-btn--hot { background: linear-gradient(135deg, var(--tvs-accent), var(--tvs-cyan)); border-color: rgba(144,224,240,0.6); }
.cset-btn__glow { position: absolute; inset: -3px; border-radius: 14px; box-shadow: 0 0 28px rgba(16,192,240,0.75), 0 0 8px rgba(16,192,240,0.6); opacity: 0; }
.cset-btn__flash { position: absolute; inset: 0; border-radius: 12px; background: rgba(255,255,255,0.35); opacity: 0; visibility: hidden; }
.cset-ripple { position: absolute; border-radius: 50%; border: 3px solid var(--tvs-cyan); box-shadow: 0 0 12px rgba(16,192,240,0.7); opacity: 0; visibility: hidden; }
.cset-cursor { position: absolute; width: 34px; height: 34px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6)); opacity: 0; visibility: hidden; z-index: 5; }
.cset-empty { position: absolute; inset: 0; display: grid; place-items: center; color: #64748B; font: 600 24px var(--tvs-font); }
`;

const SANS_FALLBACK = '"Be Vietnam Pro", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO_FALLBACK = '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const CHIP = {
  todo: { bg: "#131E36", border: "rgba(148,163,184,0.14)", color: "#94A3B8", numBg: "#1E293B", numColor: "#CBD5E1" },
  current: { bg: "rgba(42,98,255,0.22)", border: "#10C0F0", color: "#E0F7FF", numBg: "#10C0F0", numColor: "#020A14" },
  done: { bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.45)", color: "#6EE7B7", numBg: "#10B981", numColor: "#020A14" },
};

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

/** Greedy word wrap by measured width (proportional font). */
function wrapByWidth(font, text, maxW) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || textWidth(font, next) <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function lockIcon(common) {
  const { svg } = common;
  return svg(
    "svg",
    { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "#10B981", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" },
    svg("rect", { x: 4.5, y: 10.5, width: 15, height: 10, rx: 2.2 }),
    svg("path", { d: "M8 10.5V7.5a4 4 0 0 1 8 0v3" })
  );
}

function cubeIcon(common) {
  const { svg } = common;
  return svg(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "#020A14", "stroke-width": 2.2, "stroke-linejoin": "round" },
    svg("path", { d: "M12 2.8 20 7.2v9.6L12 21.2 4 16.8V7.2z" }),
    svg("path", { d: "M4 7.2 12 11.6 20 7.2M12 11.6v9.6" })
  );
}

function pointerIcon(common) {
  const { svg } = common;
  return svg(
    "svg",
    { width: 34, height: 34, viewBox: "0 0 24 24", fill: "none" },
    svg("path", { d: "M5 3.2L19.2 12.6L12.7 14.1L15.4 20.1L12.8 21.3L10.1 15.2L5.6 19.3V3.2Z", fill: "#FFFFFF", stroke: "#020A14", "stroke-width": 1.6, "stroke-linejoin": "round" })
  );
}

function brackets(el, cls) {
  return el(`div.${cls}`, {}, el("span.tl"), el("span.tr"), el("span.bl"), el("span.br"));
}

export default function buildConsoleSetup(ctx) {
  const { tl, common, vd, stage, at, start, dur } = ctx;
  const { el, blink, mark, typewriter, EASE, DUR, STAGE } = common;
  ensureStyle(common);

  const SANS = cssVar("--tvs-font", SANS_FALLBACK);
  const MONO = cssVar("--tvs-mono", MONO_FALLBACK);
  const t0 = start;
  const limit = start + dur - 0.02;
  const clampT = (t) => Math.min(Math.max(t, t0), limit - 0.01);
  const fitDur = (t, d) => Math.max(0.001, Math.min(d, limit - t));

  // first-tween bookkeeping: the earliest tween on an element starts from its hidden pre-event state
  const seen = new WeakSet();
  function show(target, t, { from = {}, to = {}, duration = 0.26, ease = EASE.reveal } = {}) {
    const tt = clampT(t);
    const d = fitDur(tt, duration);
    if (!seen.has(target)) {
      seen.add(target);
      tl.fromTo(target, { autoAlpha: 0, ...from }, { autoAlpha: 1, ...to, duration: d, ease }, tt);
    } else {
      const hasFrom = Object.keys(from).length > 0;
      if (hasFrom) tl.to(target, { ...from, duration: 0.001 }, tt);
      tl.to(target, { autoAlpha: 1, ...to, duration: d, ease }, tt + (hasFrom ? 0.001 : 0));
    }
  }
  function hide(target, t, { to = {}, duration = 0.18, ease = EASE.exit } = {}) {
    const tt = clampT(t);
    tl.to(target, { autoAlpha: 0, ...to, duration: fitDur(tt, duration), ease }, tt);
  }
  /** Fade + slide in via `top` (relative/absolute layout offset, no transform). */
  function rise(target, t, baseTop, { dy = 12, duration = 0.28, blur = 8 } = {}) {
    show(target, t, { from: { top: baseTop + dy, filter: `blur(${blur}px)` }, to: { top: baseTop, filter: "blur(0px)" }, duration });
  }

  // ---- Data ----------------------------------------------------------------------------------------
  const steps = (Array.isArray(vd.steps) ? vd.steps : [])
    .map((s, i) => ({ s: s || {}, i, ps: mark(s?.progress_start, 0), pe: mark(s?.progress_end, 1) }))
    .sort((a, b) => a.ps - b.ps || a.i - b.i);
  const N = steps.length;
  let prevT = -Infinity;
  steps.forEach((st, k) => {
    st.num = Number.isFinite(Number(st.s.step_number)) && Number(st.s.step_number) > 0 ? Number(st.s.step_number) : k + 1;
    st.t = Math.max(at(st.ps), t0 + 0.32, prevT + 0.3);
    prevT = st.t;
  });
  steps.forEach((st, k) => {
    st.tNext = k + 1 < N ? steps[k + 1].t : limit;
    // legacy step-local progress window (cursor / click timings); never shorter than the visible window
    st.winStart = st.t;
    st.winEnd = Math.max(st.t + 0.6, Math.min(at(st.pe), st.tNext));
  });
  const navItems = (Array.isArray(vd.nav_items) ? vd.nav_items : []).map((x) => String(x ?? "")).filter(Boolean);
  const hasNav = navItems.length > 0 || Boolean(vd.service_name);

  // ---- Geometry (stage px) -------------------------------------------------------------------------
  const W = STAGE.width;
  const H = STAGE.height;
  const IW = W - 4; // window inner (2px border)
  const IH = H - 4;
  const TOP_H = 60;
  const NAV_W = hasNav ? 286 : 0;
  const MAIN_W = IW - NAV_W;
  const BODY_H = IH - TOP_H;
  const CARD_TOP = 22 + 44 + 18;
  const CARD_W = MAIN_W - 64;
  const CARD_H = BODY_H - CARD_TOP - 24;
  const PAD_X = 30;
  const PAD_Y = 24;
  const CW = CARD_W - 3 - PAD_X * 2; // content box inside the card
  const CH = CARD_H - 3 - PAD_Y * 2;

  // ---- Chrome DOM ------------------------------------------------------------------------------------
  const root = el("div.cset");
  const vf = brackets(el, "cset-vf");
  const win = el("div.cset-win");
  root.append(win, vf);
  stage.appendChild(root);

  const pillTexts = steps.map((st) => `Bước ${st.num}/${N}`);
  const pillW = Math.ceil(Math.max(120, ...pillTexts.map((t) => textWidth(`700 19px ${SANS}`, t)))) + 34;
  const pill = el("div.cset-pill", { style: { width: `${pillW}px` } });
  const pillSpans = pillTexts.map((text) => {
    const span = el("span", { text });
    pill.appendChild(span);
    return span;
  });
  const urlText = String(vd.url || "console.aws.amazon.com");
  const slash = urlText.indexOf("/");
  const urlNode = el(
    "span.cset-url__text",
    {},
    el("b", { text: slash > 0 ? urlText.slice(0, slash) : urlText }),
    slash > 0 ? urlText.slice(slash) : ""
  );
  const load = el("div.cset-load");
  const top = el(
    "div.cset-top",
    {},
    el("div.cset-dots", {}, ["#EF4444", "#F59E0B", "#10B981"].map((c) => el("span", { style: { background: c } }))),
    el("div.cset-url", {}, lockIcon(common), urlNode),
    N ? pill : null,
    load
  );
  win.appendChild(top);

  // nav
  let navHl = null;
  const navEls = [];
  let navTitle = null;
  let activeNavTop = null;
  if (hasNav) {
    const nav = el("div.cset-nav", { style: { width: `${NAV_W}px` } });
    navTitle = el("div.cset-nav__title", {}, el("div.cset-nav__logo", {}, cubeIcon(common)), el("div.cset-nav__name", { text: vd.service_name || "Cloud Console" }));
    nav.appendChild(navTitle);
    const maxItems = Math.max(0, Math.floor((BODY_H - 44 - 54) / 50));
    const activeName = String(vd.active_nav ?? "");
    navItems.slice(0, maxItems).forEach((name, i) => {
      const isActive = name === activeName;
      const item = el(isActive ? "div.cset-nav__item.is-active" : "div.cset-nav__item", { text: name });
      if (isActive) activeNavTop = 22 + 54 + i * 50;
      navEls.push(item);
    });
    if (activeNavTop !== null) {
      navHl = el("div.cset-nav__hl", { style: { top: `${activeNavTop}px` } });
      nav.appendChild(navHl);
    }
    navEls.forEach((item) => nav.appendChild(item));
    win.appendChild(nav);
  }

  // main: stepper + card
  const main = el("div.cset-main", { style: { left: `${NAV_W}px`, width: `${MAIN_W}px` } });
  win.appendChild(main);
  const stepper = el("div.cset-stepper");
  main.appendChild(stepper);
  const chipMax = N ? Math.floor((MAIN_W - 64 - (N - 1) * 42) / N) : 0;
  const chips = steps.map((st, k) => {
    if (k > 0) stepper.appendChild(el("div.cset-sep"));
    const num = el("span", { text: String(st.num) });
    const check = el("span", { text: "✓", style: { opacity: 0, visibility: "hidden" } });
    const numBox = el("div.cset-chip__num", {}, num, check);
    const label = el("div.cset-chip__label", { text: st.s.heading || `Bước ${st.num}` });
    const chip = el("div.cset-chip", { style: { maxWidth: `${chipMax}px` } }, numBox, label);
    stepper.appendChild(chip);
    return { chip, numBox, num, check, state: "todo" };
  });
  const seps = [...stepper.querySelectorAll(".cset-sep")];
  const card = el("div.cset-card", { style: { top: `${CARD_TOP}px`, height: `${CARD_H}px` } });
  main.appendChild(card);

  // ---- Step panels -------------------------------------------------------------------------------------
  const panels = steps.map((st) => buildStepPanel(st));
  if (!N) card.appendChild(el("div.cset-empty", { text: vd.service_name || "Console" }));

  // ---- Timeline: chrome --------------------------------------------------------------------------------
  tl.fromTo(win, { autoAlpha: 0, filter: "blur(14px)" }, { autoAlpha: 1, filter: "blur(0px)", duration: DUR.reveal, ease: EASE.reveal }, t0 + 0.02);
  tl.fromTo(
    vf,
    { autoAlpha: 0, left: -30, top: -30, width: W + 60, height: H + 60 },
    { autoAlpha: 1, left: -8, top: -8, width: W + 16, height: H + 16, duration: 0.42, ease: EASE.reveal },
    t0 + 0.06
  );
  tl.fromTo(load, { autoAlpha: 1, width: 0 }, { width: IW, duration: fitDur(t0 + 0.08, 0.75), ease: "power2.inOut" }, t0 + 0.08);
  tl.to(load, { autoAlpha: 0, duration: fitDur(t0 + 0.86, 0.2), ease: "none" }, t0 + 0.86);
  if (navTitle) rise(navTitle, t0 + 0.14, 0, { dy: 0, duration: 0.24 });
  navEls.forEach((item, i) => show(item, t0 + 0.18 + i * 0.04, { from: { left: -14 }, to: { left: 0 }, duration: 0.24 }));
  if (navHl) show(navHl, t0 + 0.24 + navEls.length * 0.04, { from: { clipPath: "inset(0% 100% 0% 0%)" }, to: { clipPath: "inset(0% 0% 0% 0%)" }, duration: 0.36 });
  chips.forEach((c, i) => show(c.chip, t0 + 0.16 + i * 0.05, { duration: 0.24 }));
  seps.forEach((s, i) => show(s, t0 + 0.2 + i * 0.05, { duration: 0.2 }));
  show(card, t0 + 0.12, { from: { filter: "blur(10px)" }, to: { filter: "blur(0px)" }, duration: 0.28 });

  // step switches: pill text, stepper chip states, panel exit/enter
  const setChip = (c, stateName, t) => {
    if (c.state === stateName) return;
    const s = CHIP[stateName];
    const tt = clampT(t);
    const d = fitDur(tt, 0.26);
    tl.to(c.chip, { backgroundColor: s.bg, borderColor: s.border, color: s.color, duration: d, ease: "none" }, tt);
    tl.to(c.numBox, { backgroundColor: s.numBg, color: s.numColor, duration: d, ease: "none" }, tt);
    if (stateName === "done") {
      hide(c.num, tt, { duration: 0.12 });
      show(c.check, tt + 0.08, { duration: 0.2 });
    }
    c.state = stateName;
  };
  steps.forEach((st, k) => {
    const T = st.t;
    if (pillSpans[k]) {
      if (k > 0) hide(pillSpans[k - 1], T - 0.14, { to: { top: -12 }, duration: 0.12 });
      show(pillSpans[k], k === 0 ? t0 + 0.2 : T, { from: { top: 12 }, to: { top: 0 }, duration: 0.22 });
    }
    chips.forEach((c, j) => setChip(c, j < k ? "done" : j === k ? "current" : "todo", k === 0 ? Math.max(t0 + 0.4, T) : T));
    panels[k].animate(k);
  });

  // =====================================================================================================
  function buildStepPanel(st) {
    const s = st.s;
    const panel = el("div.cset-step", { style: { left: `${PAD_X}px`, top: `${PAD_Y}px`, width: `${CW}px`, height: `${CH}px` } });
    card.appendChild(panel);

    // heading
    const headNum = el("div.cset-head__num", { text: String(st.num) });
    const headText = el("div.cset-head__text", { text: s.heading || "" });
    const head = el("div.cset-head", {}, headNum, headText);
    panel.appendChild(head);

    // footer: tip (left) + primary button (right)
    const btnText = String(s.primary_button || "").trim();
    const btnW = btnText ? Math.max(150, Math.ceil(textWidth(`700 21px ${SANS}`, btnText)) + 60) : 0;
    const tipText = String(s.tip || "").trim();
    const tipW = Math.max(260, CW - (btnW ? btnW + 32 : 0));
    const tipLines = tipText ? Math.min(3, Math.max(1, wrapByWidth(`600 20px ${SANS}`, tipText, tipW - 18 - 24 - 14 - 20 - 4).length)) : 0;
    const tipH = tipLines ? tipLines * 27 + 24 : 0;
    const footerH = Math.max(btnText ? 56 : 0, tipH);
    const footerTop = CH - footerH;

    let tipEl = null;
    if (tipText) {
      tipEl = el(
        "div.cset-tip",
        { style: { top: `${footerTop + (footerH - tipH) / 2}px`, width: `${tipW}px`, height: `${tipH}px` } },
        el("div.cset-tip__bar"),
        el("span.cset-tip__icon", { text: "💡" }),
        el("div.cset-tip__text", { text: tipText })
      );
      panel.appendChild(tipEl);
    }
    let btn = null;
    let btnGlow = null;
    let btnFlash = null;
    const btnCX = CW - btnW / 2;
    const btnCY = footerTop + footerH / 2;
    const hot = Boolean(btnText && s.highlight_button);
    if (btnText) {
      btnGlow = hot ? el("div.cset-btn__glow") : null;
      btnFlash = el("div.cset-btn__flash");
      btn = el(
        hot ? "div.cset-btn.cset-btn--hot" : "div.cset-btn",
        { style: { left: `${CW - btnW}px`, top: `${btnCY - 26}px`, width: `${btnW}px` } },
        btnGlow,
        el("span", { text: btnText, style: { position: "relative" } }),
        btnFlash
      );
      panel.appendChild(btn);
    }

    // fields: legacy height budget (≤3 fields at 114 px when they fit, otherwise shrink to ≥52 px)
    const fields = (Array.isArray(s.fields) ? s.fields : []).slice(0, 6).map((f) => f || {});
    const count = fields.length;
    const FIELDS_TOP = 44 + 20;
    const availH = Math.max(120, footerTop - 18 - FIELDS_TOP);
    let fh = 114;
    let gap = 22;
    if (count > 0 && !(count <= 3 && availH >= count * 114 + (count - 1) * 22)) {
      gap = count > 5 ? 10 : count > 4 ? 14 : 18;
      fh = Math.min(114, Math.max(52, Math.floor((availH - gap * Math.max(0, count - 1)) / count)));
    }
    const compact = fh < 70;
    const labelPx = fh >= 98 ? 19 : fh >= 72 ? 16 : 15;
    const valuePx = fh >= 98 ? 24 : fh >= 72 ? 20 : 17;
    const hasSpot = fields.some((f) => f.highlight === true);

    const fieldEls = fields.map((f, idx) => {
      const topY = FIELDS_TOP + idx * (fh + gap);
      if (topY + fh > footerTop - 6) return null; // legacy: fields that do not fit are dropped
      const isSpot = f.highlight === true;
      const wrap = el("div.cset-field", { style: { top: `${topY}px`, height: `${fh}px` } });
      const box = el("div.cset-field__box");
      const glow = isSpot ? el("div.cset-field__glow") : null;
      const inner = el(compact ? "div.cset-field__in.cset-field__in--row" : "div.cset-field__in");
      const label = el("div.cset-label", { text: f.label || "", style: { fontSize: `${labelPx}px`, maxWidth: compact ? `${Math.round(CW * 0.3)}px` : undefined } });
      inner.appendChild(label);
      const valueBox = el("div.cset-value", { style: { height: `${Math.round(valuePx * 1.35)}px` } });
      inner.appendChild(valueBox);
      const availValueW = (compact ? CW - Math.round(CW * 0.3) - 22 : CW) - 52 - 8;
      const entry = { wrap, box, glow, label, isSpot, type: f.type || "text", topY, fh };

      if (entry.type === "radio") {
        const opts = (Array.isArray(f.options) ? f.options : []).map((o) => String(o ?? ""));
        const selected = String(f.selected ?? opts[0] ?? "");
        let px = Math.min(valuePx - 2, 20);
        const pillW = (o, p) => textWidth(`600 ${p}px ${SANS}`, o) + p * 0.9 + 10 + 32;
        while (px > 14 && opts.reduce((n, o) => n + pillW(o, px) + 12, 0) > availValueW) px -= 1;
        const circle = Math.round(px * 0.9);
        const radios = el("div.cset-radios");
        entry.radios = opts.map((o) => {
          const isSel = o === selected;
          const dot = el("span.cset-radio__dot", { style: { left: `${Math.round(circle * 0.2)}px`, top: `${Math.round(circle * 0.2)}px`, width: `${circle - 4 - 2 * Math.round(circle * 0.2)}px`, height: `${circle - 4 - 2 * Math.round(circle * 0.2)}px` } });
          const sel = isSel ? el("span.cset-radio__sel") : null;
          const pillEl = el(
            "div.cset-radio",
            { style: { fontSize: `${px}px`, height: `${Math.round(px * 1.75)}px`, padding: `0 16px 0 12px` } },
            sel,
            el("span.cset-radio__c", { style: { width: `${circle}px`, height: `${circle}px` } }, dot),
            el("span.cset-radio__t", { text: o })
          );
          radios.appendChild(pillEl);
          return { pillEl, dot, sel, isSel };
        });
        valueBox.style.height = `${Math.round(px * 1.75)}px`;
        valueBox.appendChild(radios);
      } else if (entry.type === "checkbox_row") {
        const size = Math.round(valuePx * 1.05);
        const fill = el("div.cset-check__fill", { text: "✓", style: { fontSize: `${Math.round(size * 0.8)}px` } });
        const check = el("div.cset-check", { style: { width: `${size}px`, height: `${size}px` } }, fill);
        const v = el("span.cset-checkv", { text: f.value || "", style: { fontSize: `${valuePx}px`, maxWidth: `${availValueW - size - 14}px` } });
        valueBox.append(check, v);
        entry.checkFill = fill;
      } else {
        // text input: fit the font, truncate as a last resort (typewriter clips in `ch` units)
        let text = String(f.value ?? "");
        let px = valuePx;
        const chW = (p) => textWidth(`700 ${p}px ${MONO}`, "0".repeat(20)) / 20 || p * 0.6;
        while (px > 15 && text.length * chW(px) > availValueW) px -= 1;
        const maxChars = Math.max(4, Math.floor(availValueW / chW(px)));
        if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
        const typed = el("span.cset-typed", { style: { fontSize: `${px}px` } });
        const caret = el("span.cset-caret", { style: { height: `${Math.round(px * 1.15)}px` } });
        valueBox.append(typed, caret);
        Object.assign(entry, { typed, caret, text });
      }

      let bk = null;
      if (isSpot) bk = brackets(el, "cset-bk");
      wrap.append(...[glow, box, inner, bk].filter(Boolean));
      entry.bk = bk;
      panel.appendChild(wrap);
      return entry;
    });

    // cursor + ripple (highlight_button)
    let cursor = null;
    let ripples = [];
    if (hot) {
      ripples = [0, 1].map(() => el("div.cset-ripple"));
      ripples.forEach((r) => panel.appendChild(r));
      cursor = el("div.cset-cursor", {}, pointerIcon(common));
      panel.appendChild(cursor);
    }

    function animate(k) {
      const T = st.t;
      const tNext = st.tNext;
      const isLast = k === N - 1;
      const span = Math.max(0.6, tNext - T);
      const local = (f) => T + f * span; // seconds inside the visible step window

      // panel enter / exit (legacy: blur-to-sharp 220 ms)
      show(panel, T, { from: { filter: "blur(8px)" }, to: { filter: "blur(0px)" }, duration: 0.22 });
      if (!isLast) hide(panel, tNext - 0.16, { to: { filter: "blur(8px)" }, duration: 0.16 });

      // heading + fields stagger
      show(headNum, T, { from: { filter: "blur(6px)" }, to: { filter: "blur(0px)" }, duration: 0.26 });
      show(headText, T + 0.02, { from: { left: -16 }, to: { left: 0 }, duration: 0.28 });
      const fieldBudget = Math.min(0.42 * span, 2.2); // typing / selection must finish early in the step
      const live = fieldEls.filter(Boolean);
      live.forEach((fe, i) => {
        rise(fe.wrap, T + 0.06 + i * 0.05, fe.topY, { dy: 14, duration: 0.3 });
        const tAct = T + 0.28 + (i * Math.min(0.16, fieldBudget / Math.max(1, live.length)));
        if (fe.type === "radio") {
          fe.radios.forEach((r) => {
            if (!r.isSel) return;
            show(r.sel, tAct, { duration: 0.2 });
            show(r.dot, tAct + 0.04, { from: { filter: "blur(3px)" }, to: { filter: "blur(0px)" }, duration: 0.24 });
            tl.to(r.pillEl, { color: "#F8FAFC", duration: fitDur(clampT(tAct), 0.2), ease: "none" }, clampT(tAct));
          });
        } else if (fe.type === "checkbox_row") {
          show(fe.checkFill, tAct, { from: { filter: "blur(4px)" }, to: { filter: "blur(0px)" }, duration: 0.24 });
        } else if (fe.typed) {
          const len = Math.max(1, fe.text.length);
          const typeDur = Math.max(0.2, Math.min(0.045 * len, fieldBudget * 0.7, 1.1));
          const tt = clampT(tAct);
          typewriter(tl, fe.typed, fe.text, tt, fitDur(tt, typeDur));
          show(fe.caret, tt, { duration: 0.001, ease: "none" });
          const tEndType = tt + typeDur;
          if (fe.isSpot && local(0.98) - tEndType > 1) blink(tl, fe.caret, tEndType + 0.1, Math.min(local(0.95), limit - 0.05));
          else hide(fe.caret, tEndType + 0.15, { duration: 0.001, ease: "none" });
        }
      });

      // spotlight: dim the others, glow + viewfinder brackets lock on, gentle pulse
      if (hasSpot) {
        const tSpot = T + Math.min(0.55, 0.22 * span);
        live.forEach((fe) => {
          if (fe.isSpot) {
            show(fe.glow, tSpot, { duration: 0.28 });
            tl.to(fe.label, { color: "#90E0F0", duration: fitDur(clampT(tSpot), 0.24), ease: "none" }, clampT(tSpot));
            show(fe.bk, tSpot + 0.04, { from: { left: -24, top: -24, right: -24, bottom: -24 }, to: { left: -9, top: -9, right: -9, bottom: -9 }, duration: 0.4, ease: EASE.reveal });
            const pulseStart = tSpot + 0.4;
            const pulseEnd = Math.min(isLast ? limit - 0.1 : tNext - 0.2, limit - 0.1);
            const half = 0.75;
            const reps = Math.floor((pulseEnd - pulseStart) / half);
            if (reps >= 2) {
              const n = reps % 2 === 0 ? reps : reps - 1;
              tl.fromTo(fe.glow, { opacity: 1 }, { opacity: 0.55, duration: half, ease: "sine.inOut", repeat: n - 1, yoyo: true, immediateRender: false }, pulseStart);
            }
          } else {
            tl.to(fe.wrap, { opacity: 0.48, duration: fitDur(clampT(tSpot), 0.28), ease: EASE.reveal }, clampT(tSpot + 0.3));
          }
        });
      }

      // tip callout
      if (tipEl) {
        show(tipEl, T + 0.36, { from: { filter: "blur(6px)", clipPath: "inset(0% 100% 0% 0%)" }, to: { filter: "blur(0px)", clipPath: "inset(0% 0% 0% 0%)" }, duration: 0.42 });
      }
      if (btn) show(btn, T + 0.3, { from: { filter: "blur(6px)" }, to: { filter: "blur(0px)" }, duration: 0.26 });

      // highlight_button: glow pulse, cursor glide (56 → 82 %), click at 84 %, ripple until 98 % (legacy step progress)
      if (hot) {
        const ws = st.winStart;
        const we = Math.min(st.winEnd, isLast ? limit : tNext - 0.05);
        const sp = (f) => ws + f * (we - ws);
        const glowStart = T + 0.4;
        const tCursorIn = Math.max(sp(0.56), T + 0.5);
        const tGlideEnd = Math.max(sp(0.82), tCursorIn + 0.25);
        const tClick = Math.min(Math.max(sp(0.84), tGlideEnd + 0.03), limit - 0.3);
        const tRippleEnd = Math.min(Math.max(sp(0.98), tClick + 0.35), limit - 0.02);
        if (btnGlow) {
          const reps = Math.floor((tClick - glowStart) / 0.75);
          if (reps >= 2) {
            const n = reps % 2 === 0 ? reps : reps - 1;
            tl.fromTo(btnGlow, { opacity: 0.35 }, { opacity: 1, duration: 0.75, ease: "sine.inOut", repeat: n - 1, yoyo: true }, glowStart);
          } else tl.fromTo(btnGlow, { opacity: 0.35 }, { opacity: 1, duration: 0.3, ease: "none" }, clampT(glowStart));
        }
        // cursor path: from the spotlight field (or up-left of the button) to the button centre
        const spot = live.find((fe) => fe.isSpot);
        const fromX = spot ? Math.min(CW - btnW - 40, CW * 0.55) : btnCX - 230;
        const fromY = spot ? spot.topY + spot.fh * 0.6 : btnCY - 120;
        const tipX = 7;
        const tipY = 4;
        show(cursor, tCursorIn, { from: { left: fromX - tipX, top: fromY - tipY }, duration: Math.min(0.12, (tGlideEnd - tCursorIn) * 0.3), ease: "none" });
        tl.to(cursor, { left: btnCX - tipX + 6, top: btnCY - tipY + 4, duration: fitDur(clampT(tCursorIn), tGlideEnd - tCursorIn), ease: "power3.inOut" }, clampT(tCursorIn));
        // click: press nudge, white flash on the button, two expanding rings
        const tc = clampT(tClick);
        tl.to(cursor, { top: btnCY - tipY + 7, duration: fitDur(tc, 0.06), ease: "power2.out" }, tc);
        tl.to(cursor, { top: btnCY - tipY + 4, duration: fitDur(tc + 0.06, 0.14), ease: "power2.out" }, tc + 0.06);
        show(btnFlash, tc, { duration: 0.05, ease: "none" });
        hide(btnFlash, tc + 0.07, { duration: 0.25, ease: "power2.out" });
        const rippleDur = Math.max(0.3, tRippleEnd - tClick);
        ripples.forEach((r, i) => {
          const rt = tc + i * 0.09;
          const d = fitDur(rt, rippleDur - i * 0.09);
          const r0 = 10;
          const r1 = 46 + i * 20;
          // first tween starts hidden (pre-click state), then the ring expands and fades
          tl.fromTo(r, { autoAlpha: 0, left: btnCX - r0, top: btnCY - r0, width: r0 * 2, height: r0 * 2 }, { autoAlpha: 0.95, duration: 0.001, ease: "none" }, rt);
          tl.to(r, { autoAlpha: 0, left: btnCX - r1, top: btnCY - r1, width: r1 * 2, height: r1 * 2, duration: d, ease: "power2.out" }, rt + 0.001);
        });
        if (!isLast) hide(cursor, tNext - 0.16, { duration: 0.12 });
      }
    }

    return { panel, animate };
  }
}
