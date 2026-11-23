// Zero-dependency HyperFrames renderer for Tech Video Studio.
//
// Pipeline (see engine/HYPERFRAMES_ENGINE.md §7):
//   1. Reuse/spawn the Studio server, read the normalized episode payload (GET /api/courses).
//   2. Compile the episode into a HyperFrames project (<ep>/hyperframes/index.html).
//   3. Headless Chrome (raw CDP): N isolated worker tabs load the composition with the official
//      HyperFrames runtime + our render-mode bridge, seek frame i (time = i / fps) through the
//      HyperFrames protocol (window.__hf.seek → __player.renderSeek, then
//      __hfWaitForSeekCompletion) and capture it (Page.captureScreenshot).
//   4. One encoder tab (/public/hf-encoder.html) receives frames strictly in order and encodes them
//      with WebCodecs (H.264/HEVC/VP9) + mixes/encodes narration (AAC/Opus) → /api/save-video.
// No FFmpeg, no npm packages.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectPageErrors, evaluate, launchChrome, navigate, openPage, sleep } from "./cdp.mjs";
import { compileEpisodeProject } from "./compiler.mjs";
import { buildRenderBridgeScript, seekExpression, waitForComposition } from "./bridge.mjs";
import { DEFAULT_QC_CHECKPOINTS, formatLayoutQcSummary, runCompositionLayoutQc } from "./layout_qc.mjs";
import { ensureStudioServer, fetchEpisodePayload, projectUrl } from "./studio_server.mjs";

const RESOLUTION_WIDTHS = { "720p": 1280, "1080p": 1920, "1440p": 2560, "2160p": 3840 };

export function defaultWorkerCount(totalFrames) {
  const cpus = Math.max(1, os.availableParallelism?.() || os.cpus().length || 2);
  const byCpu = Math.max(1, Math.min(4, Math.floor(cpus / 3)));
  return Math.max(1, Math.min(byCpu, Math.ceil(totalFrames / 60)));
}

/**
 * Render one episode through HyperFrames.
 * @returns {Promise<object>} encoder result ({ ok, savedFile, bytes, width, height, fps, frames, durationSec, ... })
 */
export async function renderEpisodeHyperframes(opts, { log = console.log, isCancelled = () => false, onChrome } = {}) {
  const {
    workspaceRoot,
    course,
    episode: episodeId,
    port,
    format,
    codec,
    hardware,
    resolution,
    fps,
    speed,
    output,
    captureFormat = "jpeg",
    jpegQuality = 92,
    checkLayout = true,
    qcStrict = false,
    qcCheckpoints = DEFAULT_QC_CHECKPOINTS,
  } = opts;

  const width = RESOLUTION_WIDTHS[resolution] || 1920;
  const scale = width / 1920;
  const browserErrors = [];
  let server = null;
  let chrome = null;

  const checkCancel = () => {
    if (isCancelled()) throw new Error("Render cancelled");
  };

  try {
    server = await ensureStudioServer(port, { log, workspaceRoot });
    checkCancel();
    const episode = await fetchEpisodePayload(port, course, episodeId);
    log(`[render] 1% Compiling HyperFrames composition (${episode.script.scenes.length} scenes, speed ${speed}x)...`);
    const { manifest, projectDir } = await compileEpisodeProject({ workspaceRoot, courseId: course, episode, speed });
    const totalFrames = Math.max(1, Math.ceil(manifest.total_duration * fps - 1e-6));
    const workers = Math.max(1, Math.min(8, Number(opts.workers) || defaultWorkerCount(totalFrames)));
    log(
      `[render] 2% Composition ready: ${path.relative(workspaceRoot, projectDir)} (${manifest.total_duration}s, ${totalFrames} frames @ ${fps}fps, ${workers} worker${workers > 1 ? "s" : ""})`
    );
    checkCancel();

    chrome = await launchChrome({ label: "hyperframes-chrome" });
    onChrome?.(chrome);
    const { cdp } = chrome;

    // ---- Encoder tab -------------------------------------------------------------------------
    const enc = await openPage(cdp);
    await cdp.send("Runtime.enable", {}, { sessionId: enc.sessionId });
    await cdp.send("Log.enable", {}, { sessionId: enc.sessionId });
    collectPageErrors(cdp, enc.sessionId, browserErrors, { echo: true, prefix: "[encoder]" });
    await navigate(cdp, enc.sessionId, `http://127.0.0.1:${port}/public/hf-encoder.html`);
    for (let i = 0; i < 100; i++) {
      if (await evaluate(cdp, enc.sessionId, "window.__TVS_HF_ENCODER_READY__ === true")) break;
      await sleep(100);
    }
    const audio = (manifest.audio || []).map((a) => ({
      url: projectUrl(port, course, episodeId, a.src),
      start: a.start,
      duration: a.duration,
      media_start: a.media_start,
      volume: a.volume,
      playback_rate: a.playback_rate,
    }));
    const sfx = (manifest.sfx || []).map((s) => ({
      url: projectUrl(port, course, episodeId, s.src),
      start: s.start,
      volume: s.volume,
      type: s.type,
    }));
    const bgm = manifest.bgm?.src
      ? {
          url: projectUrl(port, course, episodeId, manifest.bgm.src),
          volume: manifest.bgm.volume,
          carve_hz: manifest.bgm.carve_hz,
          carve_db: manifest.bgm.carve_db,
        }
      : null;
    const encoderConfig = {
      courseId: course,
      episodeId,
      format,
      codec,
      hardware,
      resolution,
      fps,
      speed,
      totalFrames,
      totalDuration: totalFrames / fps,
      audio,
      sfx,
      bgm,
      loudnessTargetLufs: -16,
      outputFilename: output || "",
    };
    log(`[render] 3% Preparing WebCodecs encoder + mixing ${audio.length} narration clip(s) + ${sfx.length} SFX cue(s)...`);
    const profile = await evaluate(cdp, enc.sessionId, `window.__TVS_HF_ENCODER__.init(${JSON.stringify(encoderConfig)})`, {
      timeoutMs: 180_000,
    });
    const lufsNote = profile.loudness ? ` [${profile.loudness.outputLufs} LUFS]` : "";
    log(
      `[render] 4% Encoder: ${profile.format}/${profile.videoCodec} ${profile.width}x${profile.height}@${profile.fps} (${profile.hardwareAcceleration}), audio ${profile.audioCodec}${lufsNote}`
    );
    const encObj = await cdp.send(
      "Runtime.evaluate",
      { expression: "window.__TVS_HF_ENCODER__", returnByValue: false },
      { sessionId: enc.sessionId }
    );
    const encoderObjectId = encObj?.result?.objectId;
    if (!encoderObjectId) throw new Error("Encoder object not available");

    // ---- Worker tabs -------------------------------------------------------------------------
    const url = projectUrl(port, course, episodeId);
    const bridge = buildRenderBridgeScript({ fps });
    const workerPages = await Promise.all(
      Array.from({ length: workers }, async (_, k) => {
        const page = await openPage(cdp, { isolated: true });
        const sid = page.sessionId;
        await cdp.send("Runtime.enable", {}, { sessionId: sid });
        await cdp.send("Log.enable", {}, { sessionId: sid });
        collectPageErrors(cdp, sid, browserErrors, { echo: true, prefix: `[worker ${k}]` });
        await cdp.send(
          "Emulation.setDeviceMetricsOverride",
          { width: 1920, height: 1080, deviceScaleFactor: scale, mobile: false },
          { sessionId: sid }
        );
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: bridge }, { sessionId: sid });
        await navigate(cdp, sid, url, 60_000);
        const ready = await waitForComposition((expr) => evaluate(cdp, sid, expr), { sleepFn: sleep, timeoutMs: 60_000 });
        if (ready.buildErrors?.length) {
          throw new Error(`Composition build errors:\n${ready.buildErrors.join("\n")}`);
        }
        if (Math.abs(ready.duration - manifest.total_duration) > 1 / fps + 1e-3) {
          throw new Error(`Runtime duration ${ready.duration}s ≠ manifest ${manifest.total_duration}s`);
        }
        await evaluate(
          cdp,
          sid,
          "typeof window.__hfForceTimelineRebind === 'function' ? (window.__hfForceTimelineRebind(), true) : false"
        );
        return { k, sid };
      })
    );
    log(`[render] 5% ${workers} capture worker(s) ready; rendering ${totalFrames} frames...`);
    checkCancel();

    let layoutQc = null;
    if (checkLayout) {
      layoutQc = await runCompositionLayoutQc({
        cdp,
        sessionId: workerPages[0].sid,
        manifest,
        checkpoints: Array.isArray(qcCheckpoints) && qcCheckpoints.length ? qcCheckpoints : DEFAULT_QC_CHECKPOINTS,
      });
      log(`[render] QC: ${formatLayoutQcSummary(layoutQc)}`);
      for (const f of layoutQc.findings) {
        log(`[render] QC [${f.severity}] ${f.scene_id} @ ${f.timestamp}s (${f.code}) ${f.selector}: ${f.message}`);
      }
      if (qcStrict && layoutQc.error_count > 0) {
        const preview = layoutQc.findings
          .filter((f) => f.severity === "error")
          .slice(0, 10)
          .map((f) => `  - ${f.scene_id} @ ${f.timestamp}s (${f.code}) ${f.selector}: ${f.message}`)
          .join("\n");
        throw new Error(`Layout QC failed with ${layoutQc.error_count} error(s):\n${preview}`);
      }
      checkCancel();
    }

    // ---- Capture → in-order encode -----------------------------------------------------------
    const frames = new Map();
    let nextToEncode = 0;
    let failure = null;
    const windowSize = workers * 3;
    let wake = null;
    const signal = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const waitSignal = () => new Promise((resolve) => (wake = resolve));
    const workerWaiters = [];
    const notifyWorkers = () => {
      while (workerWaiters.length) workerWaiters.shift()();
    };

    const shotParams =
      captureFormat === "png"
        ? { format: "png", optimizeForSpeed: true }
        : { format: "jpeg", quality: Math.max(50, Math.min(100, jpegQuality)), optimizeForSpeed: true };
    const mime = captureFormat === "png" ? "image/png" : "image/jpeg";

    const runWorker = async ({ k, sid }) => {
      for (let i = k; i < totalFrames; i += workers) {
        while (!failure && i >= nextToEncode + windowSize) {
          await new Promise((resolve) => workerWaiters.push(resolve));
        }
        if (failure || isCancelled()) return;
        await evaluate(cdp, sid, seekExpression(i / fps), { timeoutMs: 60_000 });
        const shot = await cdp.send("Page.captureScreenshot", shotParams, { sessionId: sid, timeoutMs: 60_000 });
        frames.set(i, shot.data);
        signal();
      }
    };

    const runEncoder = async () => {
      let lastPct = -1;
      const started = Date.now();
      while (nextToEncode < totalFrames) {
        if (failure) return;
        if (isCancelled()) throw new Error("Render cancelled");
        const data = frames.get(nextToEncode);
        if (data === undefined) {
          await waitSignal();
          continue;
        }
        frames.delete(nextToEncode);
        await cdp.send(
          "Runtime.callFunctionOn",
          {
            objectId: encoderObjectId,
            functionDeclaration: "function (i, b64, mime) { return this.pushFrame(i, b64, mime); }",
            arguments: [{ value: nextToEncode }, { value: data }, { value: mime }],
            awaitPromise: true,
            returnByValue: true,
          },
          { sessionId: enc.sessionId, timeoutMs: 60_000 }
        ).then((r) => {
          if (r?.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "pushFrame failed");
          }
        });
        nextToEncode++;
        notifyWorkers();
        const pct = 5 + Math.floor((nextToEncode / totalFrames) * 90);
        if (pct !== lastPct && (nextToEncode % 15 === 0 || nextToEncode === totalFrames)) {
          lastPct = pct;
          const elapsed = (Date.now() - started) / 1000;
          const fpsRate = nextToEncode / Math.max(0.001, elapsed);
          const eta = (totalFrames - nextToEncode) / Math.max(0.001, fpsRate);
          log(
            `[render] ${pct}% frame ${nextToEncode}/${totalFrames} (${fpsRate.toFixed(1)} fps capture, ETA ${eta.toFixed(0)}s)`
          );
        }
      }
    };

    const tasks = [
      runEncoder().catch((err) => {
        failure = failure || err;
        notifyWorkers();
        throw err;
      }),
      ...workerPages.map((w) =>
        runWorker(w).catch((err) => {
          failure = failure || err;
          signal();
          throw err;
        })
      ),
    ];
    const settled = await Promise.allSettled(tasks);
    const firstError = failure || settled.find((s) => s.status === "rejected")?.reason;
    if (firstError) throw firstError;
    checkCancel();

    log(`[render] 96% Flushing encoders & muxing...`);
    const result = await evaluate(cdp, enc.sessionId, "window.__TVS_HF_ENCODER__.finish()", { timeoutMs: 300_000 });
    log(`[render] 99% Saved ${result.savedFile} (${(result.bytes / 1024 / 1024).toFixed(2)} MB)`);
    return { ...result, browserErrors, projectDir, manifest, workers, layoutQc };
  } finally {
    if (chrome) await chrome.close();
    if (server) await server.stop();
  }
}
