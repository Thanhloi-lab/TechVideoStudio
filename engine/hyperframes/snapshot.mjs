#!/usr/bin/env node
// Compile an episode to HyperFrames and capture still frames (PNG) at chosen times — a fast,
// zero-dep visual check for scene builders (no encoding, no audio).
//
// Usage:
//   node engine/hyperframes/snapshot.mjs --course <COURSE> --episode <EP_ID>
//        [--times 1.5,8,12.25] [--scene <index|id> --at 0.1,0.5,0.9] [--out <dir>]
//        [--port 3030] [--speed 1] [--scale 0.5] [--check-determinism]
//
// --check-determinism re-captures every frame after seeking to the end and walking backwards,
// and fails if any frame differs (the HyperFrames "same frame ⇒ same pixels" contract).
//
// Prints one line per PNG plus any console/page/build errors (exit code 1 when errors occur).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectPageErrors, evaluate, launchChrome, navigate, openPage, sleep } from "./cdp.mjs";
import { compileEpisodeProject } from "./compiler.mjs";
import { buildRenderBridgeScript, seekExpression, waitForComposition } from "./bridge.mjs";
import { ensureStudioServer, fetchEpisodePayload, projectUrl } from "./studio_server.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.resolve(path.dirname(__filename), "..");
const WORKSPACE_ROOT = process.env.VIDEO_MAKER_WORKSPACE_ROOT
  ? path.resolve(process.env.VIDEO_MAKER_WORKSPACE_ROOT)
  : path.resolve(ENGINE_DIR, "..");

/**
 * FNV-1a hash of everything the timeline can change inside the composition root: inline styles,
 * animated SVG/HTML attributes and leaf text (counters, typewriters). Same frame ⇒ same hash.
 */
const STATE_HASH_EXPRESSION = `(() => {
  const root = document.querySelector("[data-composition-id]");
  if (!root) return "no-root";
  let h = 0x811c9dc5;
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  // Effective (computed) values, so an inline value equal to the stylesheet default compares equal.
  const PROPS = ["opacity", "visibility", "transform", "filter", "color", "background-color", "border-color",
    "box-shadow", "width", "height", "left", "top", "right", "bottom", "clip-path", "max-width", "max-height",
    "stroke-dashoffset", "stroke-dasharray", "fill", "stroke"];
  const ATTRS = ["d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "stroke-dashoffset"];
  for (const el of root.querySelectorAll("*")) {
    if (el.tagName === "AUDIO" || el.tagName === "VIDEO") continue;
    // Only what is painted: hidden scenes/elements may legitimately keep different
    // not-yet-rendered tween values depending on seek history.
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    mix(el.tagName);
    const cs = getComputedStyle(el);
    for (const p of PROPS) mix(p + ":" + cs.getPropertyValue(p));
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v !== null) mix(a + "=" + v);
    }
    if (!el.firstElementChild) mix(el.textContent || "");
  }
  return h.toString(16);
})()`;

function parseArgs(argv) {
  const o = { course: "", episode: "", times: [], scene: null, at: [], out: "", port: 3030, speed: 1, scale: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--course") o.course = next();
    else if (a === "--episode" || a === "--ep") o.episode = next();
    else if (a === "--times") o.times = next().split(",").map(Number).filter(Number.isFinite);
    else if (a === "--scene") o.scene = next();
    else if (a === "--at") o.at = next().split(",").map(Number).filter(Number.isFinite);
    else if (a === "--out") o.out = next();
    else if (a === "--port") o.port = Number(next()) || 3030;
    else if (a === "--speed") o.speed = Number(next()) || 1;
    else if (a === "--scale") o.scale = Math.min(2, Math.max(0.25, Number(next()) || 1));
    else if (a === "--check-determinism") o.checkDeterminism = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

export async function captureSnapshots(opts) {
  const errors = [];
  const server = await ensureStudioServer(opts.port, { workspaceRoot: WORKSPACE_ROOT });
  let chrome = null;
  try {
    const episode = await fetchEpisodePayload(opts.port, opts.course, opts.episode);
    const { manifest, projectDir } = await compileEpisodeProject({
      workspaceRoot: WORKSPACE_ROOT,
      courseId: opts.course,
      episode,
      speed: opts.speed,
    });

    let times = [...opts.times];
    if (opts.scene !== null && opts.scene !== undefined) {
      const sc =
        manifest.scenes.find((s) => String(s.index) === String(opts.scene)) ||
        manifest.scenes.find((s) => s.id === opts.scene);
      if (!sc) throw new Error(`Scene not found: ${opts.scene}`);
      const marks = opts.at.length ? opts.at : [0.1, 0.35, 0.6, 0.85];
      times.push(...marks.map((p) => Math.round((sc.start + Math.min(0.999, Math.max(0, p)) * sc.duration) * 1000) / 1000));
    }
    if (!times.length) times = manifest.scenes.map((s) => Math.round((s.start + s.duration * 0.6) * 1000) / 1000);

    const outDir = path.resolve(opts.out || path.join(projectDir, "..", "hyperframes-snapshots"));
    fs.mkdirSync(outDir, { recursive: true });

    // GPU rasterization adds ±2–3/255 noise to blurred glows/dashed SVG paths between identical
    // paints; the determinism check compares the timeline, so rasterize on the CPU for it.
    chrome = await launchChrome({
      label: "snapshot-chrome",
      extraArgs: opts.checkDeterminism ? ["--disable-gpu-rasterization"] : [],
    });
    const { cdp } = chrome;
    const { sessionId } = await openPage(cdp);
    await cdp.send("Runtime.enable", {}, { sessionId });
    await cdp.send("Log.enable", {}, { sessionId });
    collectPageErrors(cdp, sessionId, errors);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1080, deviceScaleFactor: opts.scale, mobile: false },
      { sessionId }
    );
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: buildRenderBridgeScript({ fps: 60 }) }, { sessionId });
    await navigate(cdp, sessionId, projectUrl(opts.port, opts.course, opts.episode));

    const ready = await waitForComposition((expr) => evaluate(cdp, sessionId, expr), { sleepFn: sleep });
    for (const e of ready.buildErrors || []) errors.push(`[build] ${e}`);

    const capture = async (t) => {
      await evaluate(cdp, sessionId, seekExpression(t));
      const state = opts.checkDeterminism ? await evaluate(cdp, sessionId, STATE_HASH_EXPRESSION) : null;
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, { sessionId });
      return { png: Buffer.from(shot.data, "base64"), state };
    };

    const written = [];
    const warnings = [];
    const forward = new Map();
    for (const t of times) {
      const frame = await capture(t);
      forward.set(t, frame);
      const file = path.join(outDir, `t${t.toFixed(3).replace(".", "_")}.png`);
      fs.writeFileSync(file, frame.png);
      written.push(file);
      console.log(`[snapshot] t=${t.toFixed(3)}s → ${file}`);
    }

    if (opts.checkDeterminism) {
      // HyperFrames contract: the same frame yields the same state regardless of seek order.
      // We compare the full timeline-driven DOM state (inline styles, animated attributes, text)
      // after seeking to the end and walking backwards. Pixel-only differences with an identical
      // state are Chrome raster noise (anti-aliasing / tiling) and are reported as warnings.
      const order = [...times].reverse();
      await capture(manifest.total_duration * 0.999);
      for (const t of order) {
        const again = await capture(t);
        const first = forward.get(t);
        const tag = `t${t.toFixed(3).replace(".", "_")}`;
        if (again.state !== first.state) {
          const file = path.join(outDir, `${tag}.reverse.png`);
          fs.writeFileSync(file, again.png);
          errors.push(`Non-deterministic timeline state at t=${t.toFixed(3)}s (forward vs reverse seek; see ${file})`);
        } else if (!again.png.equals(first.png)) {
          const file = path.join(outDir, `${tag}.reverse.png`);
          fs.writeFileSync(file, again.png);
          warnings.push(`raster-only pixel noise at t=${t.toFixed(3)}s (identical DOM state; see ${file})`);
        }
      }
      for (const w of warnings) console.warn(`[snapshot] warning: ${w}`);
      console.log(`[snapshot] determinism check: ${times.length} frame(s) compared after reverse-order seeks`);
    }
    return { files: written, errors, warnings, manifest };
  } finally {
    if (chrome) await chrome.close();
    await server.stop();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.course || !opts.episode) {
    console.log(
      "Usage: node engine/hyperframes/snapshot.mjs --course <COURSE> --episode <EP_ID> [--times 1.5,8] [--scene <index|id> --at 0.1,0.5] [--out <dir>] [--port 3030] [--speed 1] [--scale 0.5]"
    );
    process.exit(opts.help ? 0 : 1);
  }
  captureSnapshots(opts)
    .then(({ errors }) => {
      if (errors.length) {
        console.error(`[snapshot] ${errors.length} browser error(s):`);
        for (const e of errors) console.error(`  - ${e}`);
        process.exitCode = 1;
      } else {
        console.log("[snapshot] OK: 0 console/page errors");
      }
    })
    .catch((err) => {
      console.error(`[snapshot] ERROR: ${err?.stack || err?.message || err}`);
      process.exitCode = 1;
    });
}
