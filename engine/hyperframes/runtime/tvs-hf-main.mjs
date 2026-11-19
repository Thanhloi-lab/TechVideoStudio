// Tech Video Studio × HyperFrames — composition bootstrap.
// Copied into every compiled project as `lib/tvs-hf-main.mjs` and loaded by index.html.
//
// Responsibilities:
//   1. Read the compiled episode data (<script type="application/json" id="tvs-episode-data">).
//   2. Build the persistent layers (ambient background, bokeh, progress bar, sparkle FX).
//   3. For each scene clip (<section class="clip tvs-scene" data-start data-duration>), build the
//      top bar + stage, then call the DOM+GSAP builder for its visual_type.
//   4. Animate subtitle cue clips and the scene envelope (blur-to-sharp reveal, Z-recede exit).
//   5. Register ONE paused GSAP timeline at window.__timelines[<composition-id>] (HyperFrames contract).

import { getSceneBurstInfo } from "./kernel.mjs";
import * as common from "./tvs-hf-common.mjs";

const { el, rng, hashString, palette, EASE, DUR, FRAME_W, FRAME_H } = common;

/** visual_type → scene module path (one ES module per template, default export = builder). */
export const SCENE_MODULES = Object.freeze({
  architecture: "./scenes/architecture.mjs",
  console_setup: "./scenes/console_setup.mjs",
  code_cli: "./scenes/code_cli.mjs",
  exam_tips: "./scenes/exam_tips.mjs",
  comparison_matrix: "./scenes/comparison_matrix.mjs",
  timeline_flow: "./scenes/timeline_flow.mjs",
  kpi_metrics: "./scenes/kpi_metrics.mjs",
});

/** Load only the builders this episode uses; a broken module only breaks its own scenes. */
async function loadBuilders(types) {
  const builders = {};
  await Promise.all(
    [...new Set(types)].map(async (type) => {
      const spec = SCENE_MODULES[type] || SCENE_MODULES.architecture;
      try {
        const mod = await import(spec);
        if (typeof mod.default !== "function") throw new Error(`${spec} has no default export builder`);
        builders[type] = mod.default;
      } catch (err) {
        reportBuildError(`load ${spec}`, err);
      }
    })
  );
  return builders;
}

const buildErrors = [];
window.__tvsBuildErrors = buildErrors;

function reportBuildError(context, err) {
  const message = `${context}: ${err?.stack || err?.message || err}`;
  buildErrors.push(message);
  console.error(`[tvs-hf] ${message}`);
}

function readEpisodeData() {
  const node = document.getElementById("tvs-episode-data");
  if (!node) throw new Error("Missing #tvs-episode-data JSON block");
  return JSON.parse(node.textContent || "{}");
}

// ---------------------------------------------------------------------------
// Persistent layers
// ---------------------------------------------------------------------------

const BOKEH_COLORS = [palette.accentPrimary, palette.accentCyan, palette.accentGlow, palette.gold, palette.success, "#FFFFFF"];
const SPARKLE_COLORS = [palette.accentCyan, palette.accentGlow, palette.gold, palette.success, "#FFFFFF", palette.accentPrimary];

function buildAmbient(tl, gsap, root, total) {
  const grid = root.querySelector(".tvs-bg-grid");
  if (grid) {
    const wrapGrid = gsap.utils.wrap(0, 60);
    tl.fromTo(
      grid,
      { x: 0, y: 0 },
      {
        x: Math.max(12, total * 4.2),
        y: Math.max(8, total * 2.8),
        duration: Math.max(0.01, total),
        ease: "none",
        modifiers: {
          x: (v) => `${wrapGrid(parseFloat(v)).toFixed(2)}px`,
          y: (v) => `${wrapGrid(parseFloat(v)).toFixed(2)}px`,
        },
      },
      0
    );
  }
  const layer = root.querySelector("#tvs-ambient");
  if (!layer) return;
  const rand = rng(133742);
  const count = 22;
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const speed = 0.002 + rand() * 0.0045;
    const seed = {
      x: rand(),
      y: rand(),
      r: 1.8 + rand() * 3.8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.0012,
      alpha: 0.06 + rand() * 0.16,
      phase: rand() * Math.PI * 2,
      pulseSpeed: 0.4 + rand() * 0.7,
      color: BOKEH_COLORS[i % BOKEH_COLORS.length],
    };
    const radius = seed.r * 1.6;
    const size = Math.round(radius * 2 * (seed.r > 3.2 ? 2.4 : 1));
    const dot = el("div.tvs-bokeh", {
      style: {
        width: `${size}px`,
        height: `${size}px`,
        marginLeft: `${-size / 2}px`,
        marginTop: `${-size / 2}px`,
        background:
          seed.r > 3.2
            ? `radial-gradient(circle, ${seed.color} 0%, ${seed.color} 40%, transparent 70%)`
            : seed.color,
        opacity: String(seed.alpha),
      },
    });
    layer.appendChild(dot);
    const wrapX = gsap.utils.wrap(0, FRAME_W);
    const wrapY = gsap.utils.wrap(0, FRAME_H);
    tl.fromTo(
      dot,
      { x: seed.x * FRAME_W, y: seed.y * FRAME_H },
      {
        x: (seed.x + seed.vx * total) * FRAME_W,
        y: (seed.y + seed.vy * total) * FRAME_H,
        duration: Math.max(0.01, total),
        ease: "none",
        modifiers: { x: (v) => `${wrapX(parseFloat(v))}px`, y: (v) => `${wrapY(parseFloat(v))}px` },
      },
      0
    );
    const period = Math.PI / seed.pulseSpeed; // half sine period in seconds
    const cycles = Math.max(1, Math.floor(total / period));
    tl.fromTo(
      dot,
      { opacity: seed.alpha * (0.65 + 0.35 * Math.sin(seed.phase)) },
      {
        opacity: seed.alpha * 0.3,
        duration: period,
        ease: "sine.inOut",
        repeat: cycles,
        yoyo: true,
      },
      0
    );
  }
}

function buildProgressBar(tl, root, total) {
  const fill = root.querySelector("#tvs-progress-fill");
  if (!fill) return;
  tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: Math.max(0.01, total), ease: "none" }, 0);
}

function spawnSparkles(tl, layer, cx, cy, t, seed) {
  const rand = rng(seed);
  const n = 24;
  const flash = el("div.tvs-sparkle-flash", { style: { left: `${cx}px`, top: `${cy}px` } });
  layer.appendChild(flash);
  // Rule: the FROM state of an element's earliest tween is what shows before that tween starts,
  // so every burst begins with a hidden→visible step and only then animates out.
  tl.fromTo(flash, { autoAlpha: 0, scale: 0.3 }, { autoAlpha: 0.9, scale: 0.3, duration: 0.001, ease: "none" }, t);
  tl.to(flash, { autoAlpha: 0, scale: 1.6, duration: 0.18, ease: "power2.out" }, t + 0.001);
  for (let i = 0; i < n; i++) {
    const baseAngle = (Math.PI * 2 * i) / n + (rand() - 0.5) * 0.35;
    const speed = 130 + rand() * 260;
    const life = 0.22 + rand() * 0.16;
    const travel = speed * life * 0.55; // drag-integrated displacement approximation
    const size = 3.5 + rand() * 5.5;
    const diamond = i % 3 === 0;
    const color = SPARKLE_COLORS[i % SPARKLE_COLORS.length];
    const p = el(diamond ? "div.tvs-sparkle.tvs-sparkle--diamond" : "div.tvs-sparkle", {
      style: {
        left: `${cx}px`,
        top: `${cy}px`,
        width: `${size}px`,
        height: `${diamond ? size : size * 0.72}px`,
        background: color,
        boxShadow: `0 0 8px ${color}`,
      },
    });
    layer.appendChild(p);
    const rot0 = rand() * 360;
    tl.fromTo(p, { autoAlpha: 0, x: 0, y: 0, rotation: rot0 }, { autoAlpha: 1, duration: 0.001, ease: "none" }, t);
    // Explicit start values: `to()` would record its start lazily and drift by ~1e-5 deg
    // depending on seek order.
    tl.fromTo(
      p,
      { autoAlpha: 1, x: 0, y: 0, rotation: rot0 },
      {
        immediateRender: false,
        autoAlpha: 0,
        x: Math.cos(baseAngle) * travel,
        y: Math.sin(baseAngle) * travel + 10,
        rotation: rot0 + (rand() - 0.5) * 14 * life * 57,
        duration: life,
        ease: "power2.out",
      },
      t + 0.001
    );
  }
}

/** Sample the kernel burst key across a scene and spawn confetti at each change (deterministic). */
function buildSceneBursts(tl, layer, scene, index, start, dur) {
  if (!layer) return;
  let lastKey = null;
  const steps = Math.max(40, Math.ceil(dur * 20));
  const usable = Math.max(0, dur - DUR.exit - DUR.breather);
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    if (p * dur > usable) break;
    let info;
    try {
      info = getSceneBurstInfo(scene, p, FRAME_W, FRAME_H, index);
    } catch {
      return;
    }
    if (!info || info.key === lastKey) continue;
    lastKey = info.key;
    if (info.key === "none") continue;
    spawnSparkles(tl, layer, info.cx, info.cy, start + p * dur, hashString(`${scene.id}:${info.key}`));
  }
}

// ---------------------------------------------------------------------------
// Scene chrome + envelope
// ---------------------------------------------------------------------------

function buildWorldThemeLayer(tl, gsap, root, scenes, timingScenes) {
  const lightBg = root.querySelector(".tvs-bg-light");
  if (!lightBg || !Array.isArray(scenes) || !scenes.length) return;
  let prevLight = scenes[0]?.world_theme === "light";
  gsap.set(lightBg, { autoAlpha: prevLight ? 1 : 0 });
  for (let i = 1; i < scenes.length; i++) {
    const curLight = scenes[i]?.world_theme === "light";
    if (curLight === prevLight) continue;
    const tStart = Number(timingScenes?.[i]?.start ?? 0);
    tl.fromTo(
      lightBg,
      { autoAlpha: prevLight ? 1 : 0 },
      { autoAlpha: curLight ? 1 : 0, duration: 0.32, ease: "power2.inOut", immediateRender: false },
      Math.max(0, tStart - 0.1)
    );
    prevLight = curLight;
  }
}

function buildTopBar(data, scene) {
  const ep = String(data.episode?.number || 1).padStart(2, "0");
  const rightTag = scene.visual_job
    ? common.sharpTag(scene.visual_job, `Tập ${ep} • ${data.episode?.course_id || ""}`, { tone: "blue" })
    : el("div.tvs-topbar__badge", { text: `Tập ${ep} • ${data.episode?.course_id || ""}` });
  return el(
    "header.tvs-topbar",
    {},
    el("div.tvs-topbar__pill", { text: scene.part_label || "Bài học" }),
    el("div.tvs-topbar__title", { text: scene.title || "" }),
    rightTag
  );
}

function buildEnvelope(tl, inner, stage, start, slotDur, { overlapOut = 0, mechanic = "blur-materialize" } = {}) {
  let reveal = DUR.reveal;
  let exit = DUR.exit;
  let breather = overlapOut > 0 ? 0 : DUR.breather;
  const minTotal = reveal + (overlapOut > 0 ? 0.05 : exit + breather);
  if (slotDur < minTotal + 0.05) {
    const k = slotDur / (minTotal + 0.05);
    reveal *= k;
    exit *= k;
    breather *= k;
  }

  // Zero-static-frame micro-motion floor: subtle deterministic creep zoom on active stage
  if (stage) {
    tl.fromTo(stage, { scale: 1 }, { scale: 1.015, duration: Math.max(0.1, slotDur), ease: "none" }, start);
  }

  let fromVars = { autoAlpha: 0, scale: 0.94, filter: "blur(20px)" };
  let toVars = { autoAlpha: 1, scale: 1, filter: "blur(0px)", duration: Math.max(0.01, reveal), ease: EASE.reveal };
  if (mechanic === "width-push" || mechanic === "wire-draw") {
    fromVars = { autoAlpha: 0, x: -24, scale: 1, clipPath: "inset(0 100% 0 0)" };
    toVars = { autoAlpha: 1, x: 0, scale: 1, clipPath: "inset(0 0% 0 0)", duration: Math.max(0.01, reveal), ease: EASE.reveal };
  } else if (mechanic === "arc-emission") {
    fromVars = { autoAlpha: 0, x: -16, y: 18, scale: 0.95, filter: "blur(10px)" };
    toVars = { autoAlpha: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)", duration: Math.max(0.01, reveal), ease: EASE.reveal };
  } else if (mechanic === "squash-drop") {
    fromVars = { autoAlpha: 0, y: -22, scaleX: 0.96, scaleY: 1.05 };
    toVars = { autoAlpha: 1, y: 0, scaleX: 1, scaleY: 1, duration: Math.max(0.01, reveal), ease: EASE.spring };
  } else if (mechanic === "typographic-strike") {
    fromVars = { autoAlpha: 0, scale: 1.06, filter: "blur(8px)" };
  }

  tl.fromTo(inner, fromVars, toVars, start);
  // Explicit zero-duration transition so forward & reverse seeks leave crisp filter:"none", clipPath:"none".
  tl.fromTo(
    inner,
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
    start + Math.max(0.01, reveal)
  );

  if (overlapOut > 0) {
    const outStart = Math.max(start + reveal + 0.02, start + slotDur - 0.04);
    const outDur = Math.max(0.05, overlapOut + 0.02);
    tl.fromTo(
      inner,
      { autoAlpha: 1, scale: 1, filter: "blur(0px)" },
      {
        autoAlpha: 0,
        scale: 0.97,
        filter: "blur(14px)",
        duration: outDur,
        ease: EASE.exit,
        immediateRender: false,
      },
      outStart
    );
  } else {
    const breatherStart = Math.max(0, slotDur - breather);
    const exitStart = Math.max(0, breatherStart - exit);
    tl.fromTo(
      inner,
      { autoAlpha: 1, scale: 1, filter: "blur(0px)" },
      {
        autoAlpha: 0,
        scale: 0.96,
        filter: "blur(20px)",
        duration: Math.max(0.01, exit),
        ease: EASE.exit,
        immediateRender: false,
      },
      start + exitStart
    );
  }
}

function buildSubtitles(tl, root) {
  for (const cue of root.querySelectorAll(".tvs-subtitle")) {
    const t = Number(cue.dataset.start);
    const text = cue.querySelector(".tvs-subtitle__text");
    if (!text || !Number.isFinite(t)) continue;
    tl.fromTo(text, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.16, ease: EASE.reveal }, t);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const gsap = window.gsap;
  if (!gsap) throw new Error("window.gsap is not loaded (lib/gsap.min.js)");
  const data = readEpisodeData();
  const compositionId = data.composition_id || "main";
  const root = document.querySelector(`[data-composition-id="${compositionId}"]`);
  if (!root) throw new Error(`Composition root [data-composition-id="${compositionId}"] not found`);
  const total = Number(root.getAttribute("data-duration")) || Number(data.timing?.total) || 1;

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // fonts are best effort
    }
  }

  // 2D transforms only: GSAP's default force3D:"auto" promotes animated elements to compositor
  // layers whose raster is reused at sub-pixel offsets (soft text, seek-order-dependent pixels).
  gsap.config({ force3D: false });
  const tl = gsap.timeline({ paused: true, defaults: { overwrite: false } });
  const fxLayer = root.querySelector("#tvs-fx");

  buildAmbient(tl, gsap, root, total);
  buildProgressBar(tl, root, total);

  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  buildWorldThemeLayer(tl, gsap, root, scenes, data.timing?.scenes || []);
  const builders = await loadBuilders(scenes.map((s) => s.visual_type));
  scenes.forEach((scene, index) => {
    const clip = root.querySelector(`#scene-${index}`);
    if (!clip) return;
    const start = Number(clip.getAttribute("data-start")) || 0;
    const clipDur = Math.max(0.1, Number(clip.getAttribute("data-duration")) || 0.1);
    const slotDur = Math.max(0.1, Number(clip.getAttribute("data-slot-duration")) || clipDur);
    const overlapOut = Math.max(0, Number(clip.getAttribute("data-overlap-out")) || 0);
    const mechanic = scene.causal_mechanic || "blur-materialize";
    const worldTheme = scene.world_theme === "light" ? "light" : "dark";
    const inner = el("div.tvs-scene-inner");
    const stage = el("div.tvs-stage");
    inner.appendChild(buildTopBar(data, scene));
    inner.appendChild(stage);
    clip.appendChild(inner);

    const builder = builders[scene.visual_type];
    const at = (p) => start + common.clamp01(Number(p) || 0) * slotDur;
    const ctx = {
      gsap,
      tl,
      common,
      data,
      scene,
      vd: scene.visual_data || {},
      index,
      start,
      dur: slotDur,
      at,
      stage,
      sceneEl: inner,
      mechanic,
      worldTheme,
      seed: hashString(`${data.episode?.id || ""}:${scene.id}:${index}`),
    };
    try {
      if (!builder) throw new Error(`no builder loaded for visual_type "${scene.visual_type}"`);
      builder(ctx);
    } catch (err) {
      reportBuildError(`scene ${index} (${scene.id}, ${scene.visual_type})`, err);
      stage.appendChild(el("div.tvs-build-error", { text: `⚠ ${scene.visual_type}: ${err?.message || err}` }));
    }
    buildEnvelope(tl, inner, stage, start, slotDur, { overlapOut, mechanic });
    buildSceneBursts(tl, fxLayer, scene, index, start, slotDur);
  });

  buildSubtitles(tl, root);

  // Pad the timeline to the exact composition length so getDuration() === data-duration.
  tl.set({}, {}, total);
  tl.totalTime(0, true);

  window.__timelines = window.__timelines || {};
  window.__timelines[compositionId] = tl;
  window.__tvsReady = true;
}

main().catch((err) => {
  reportBuildError("bootstrap", err);
  window.__tvsReady = true;
});
