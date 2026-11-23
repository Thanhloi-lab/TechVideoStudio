#!/usr/bin/env node
// Verify a rendered episode video with headless Chrome (zero deps): container duration, frame
// size, decodable audio with non-silent RMS, and optional still frames extracted to PNG.
//
// Usage:
//   node engine/hyperframes/verify_video.mjs --course <COURSE> --episode <EP_ID> --file <name.mp4>
//        [--port 3030] [--frames 1.5,20] [--out <dir>] [--expect-duration 49]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate, launchChrome, navigate, openPage, sleep } from "./cdp.mjs";
import { buildRenderBridgeScript, waitForComposition } from "./bridge.mjs";
import { compileEpisodeProject } from "./compiler.mjs";
import { DEFAULT_QC_CHECKPOINTS, runCompositionLayoutQc } from "./layout_qc.mjs";
import { ensureStudioServer, fetchEpisodePayload, projectUrl } from "./studio_server.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.resolve(path.dirname(__filename), "..");
const WORKSPACE_ROOT = process.env.VIDEO_MAKER_WORKSPACE_ROOT
  ? path.resolve(process.env.VIDEO_MAKER_WORKSPACE_ROOT)
  : path.resolve(ENGINE_DIR, "..");

export async function verifyEpisodeVideo(opts = {}) {
  const {
    port = 3030,
    course,
    episode,
    file,
    frames = [],
    outDir = "",
    qcCheckpoints = DEFAULT_QC_CHECKPOINTS,
  } = opts;
  const qcStrict = Boolean(opts.qcStrict);
  const checkLayout = opts.checkLayout !== undefined ? Boolean(opts.checkLayout) : qcStrict;
  const server = await ensureStudioServer(port, { workspaceRoot: WORKSPACE_ROOT, log: () => {} });
  let chrome = null;
  try {
    chrome = await launchChrome({ label: "verify-chrome" });
    const { cdp } = chrome;
    const { sessionId } = await openPage(cdp);
    await navigate(cdp, sessionId, `http://127.0.0.1:${port}/public/hf-encoder.html`);
    for (let i = 0; i < 50; i++) {
      if (await evaluate(cdp, sessionId, "Boolean(window.__TVS_AUDIO_DSP__)")) break;
      await sleep(100);
    }
    const url = `/courses/${encodeURIComponent(course)}/episodes/${encodeURIComponent(episode)}/${encodeURIComponent(file)}`;
    const info = await evaluate(
      cdp,
      sessionId,
      `(async () => {
        const url = ${JSON.stringify(url)};
        const v = document.createElement("video");
        v.muted = true; v.preload = "auto"; v.src = url;
        await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("video load error " + (v.error && v.error.code))); });
        const out = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, frames: [] };
        const buf = await (await fetch(url)).arrayBuffer();
        out.bytes = buf.byteLength;
        try {
          const ctx = new OfflineAudioContext(2, 1, 48000);
          const audio = await ctx.decodeAudioData(buf.slice(0));
          const ch = audio.getChannelData(0);
          const chR = audio.numberOfChannels > 1 ? audio.getChannelData(1) : ch;
          let sum = 0, peak = 0;
          for (let i = 0; i < ch.length; i++) { const s = ch[i]; sum += s * s; if (Math.abs(s) > peak) peak = Math.abs(s); }
          const dsp = window.__TVS_AUDIO_DSP__?.measureIntegratedLufs(ch, chR, audio.sampleRate);
          out.audio = {
            duration: audio.duration,
            sampleRate: audio.sampleRate,
            channels: audio.numberOfChannels,
            rms: Math.sqrt(sum / Math.max(1, ch.length)),
            peak: dsp ? dsp.peak : peak,
            lufs: dsp ? Number(dsp.lufs.toFixed(2)) : null,
          };
        } catch (err) { out.audio = { error: String(err && err.message || err) }; }
        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        const g = canvas.getContext("2d");
        for (const t of ${JSON.stringify(frames)}) {
          v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.01));
          await new Promise((res) => { v.onseeked = res; });
          g.drawImage(v, 0, 0);
          out.frames.push({ t, png: canvas.toDataURL("image/png").split(",")[1] });
        }
        return out;
      })()`,
      { timeoutMs: 120_000 }
    );
    const written = [];
    if (info.frames.length) {
      const dir = path.resolve(outDir || path.join(WORKSPACE_ROOT, course, "episodes", episode, "hyperframes-verify"));
      fs.mkdirSync(dir, { recursive: true });
      for (const f of info.frames) {
        const p = path.join(dir, `${path.parse(file).name}_t${String(f.t).replace(".", "_")}.png`);
        fs.writeFileSync(p, Buffer.from(f.png, "base64"));
        written.push(p);
      }
    }
    delete info.frames;

    let layoutQc = null;
    if (checkLayout) {
      const projectDir = path.join(WORKSPACE_ROOT, course, "episodes", episode, "hyperframes");
      const manifestPath = path.join(projectDir, "composition.json");
      const indexPath = path.join(projectDir, "index.html");
      let manifest;
      if (fs.existsSync(manifestPath) && fs.existsSync(indexPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      } else {
        const epPayload = await fetchEpisodePayload(port, course, episode);
        ({ manifest } = await compileEpisodeProject({
          workspaceRoot: WORKSPACE_ROOT,
          courseId: course,
          episode: epPayload,
          speed: 1,
        }));
      }

      const qcPage = await openPage(cdp, { isolated: true });
      const qcSid = qcPage.sessionId;
      await cdp.send("Runtime.enable", {}, { sessionId: qcSid });
      await cdp.send("Log.enable", {}, { sessionId: qcSid });
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
        { sessionId: qcSid }
      );
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: buildRenderBridgeScript({ fps: 60 }) }, { sessionId: qcSid });
      await navigate(cdp, qcSid, projectUrl(port, course, episode), 60_000);
      const ready = await waitForComposition((expr) => evaluate(cdp, qcSid, expr), { sleepFn: sleep });
      if (ready.buildErrors?.length) {
        throw new Error(`Composition build errors:\n${ready.buildErrors.join("\n")}`);
      }
      layoutQc = await runCompositionLayoutQc({
        cdp,
        sessionId: qcSid,
        manifest,
        checkpoints: Array.isArray(qcCheckpoints) && qcCheckpoints.length ? qcCheckpoints : DEFAULT_QC_CHECKPOINTS,
      });
    }

    return {
      ...info,
      frameFiles: written,
      ...(layoutQc ? { layout_qc: layoutQc } : {}),
    };
  } finally {
    if (chrome) await chrome.close();
    await server.stop();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (flag, fallback = "") => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] ?? fallback : fallback;
  };
  const hasFlag = (flag) => argv.includes(flag);
  const qcStrict = hasFlag("--qc-strict");
  const checkLayout = hasFlag("--check-layout") || qcStrict;
  const qcCheckpointsRaw = get("--qc-checkpoints");
  const opts = {
    port: Number(get("--port", "3030")) || 3030,
    course: get("--course"),
    episode: get("--episode"),
    file: get("--file"),
    frames: get("--frames") ? get("--frames").split(",").map(Number).filter(Number.isFinite) : [],
    outDir: get("--out"),
    checkLayout,
    qcStrict,
    ...(qcCheckpointsRaw
      ? { qcCheckpoints: qcCheckpointsRaw.split(",").map(Number).filter(Number.isFinite) }
      : {}),
  };
  const expectDuration = Number(get("--expect-duration", "NaN"));
  if (!opts.course || !opts.episode || !opts.file) {
    console.log("Usage: node engine/hyperframes/verify_video.mjs --course <C> --episode <EP> --file <name.mp4> [--port 3030] [--frames 1.5,20] [--expect-duration 49] [--check-layout] [--qc-strict]");
    process.exit(1);
  }
  verifyEpisodeVideo(opts)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      const problems = [];
      if (!(res.duration > 0)) problems.push("video duration is not positive");
      if (Number.isFinite(expectDuration) && Math.abs(res.duration - expectDuration) > 0.2) {
        problems.push(`duration ${res.duration}s differs from expected ${expectDuration}s`);
      }
      if (!res.audio || res.audio.error) problems.push(`audio not decodable: ${res.audio?.error}`);
      else if (!(res.audio.rms > 1e-4)) problems.push("audio track is silent");
      if (opts.qcStrict && res.layout_qc && res.layout_qc.error_count > 0) {
        problems.push(`layout QC failed with ${res.layout_qc.error_count} error(s)`);
      }
      if (problems.length) {
        console.error(`[verify_video] FAIL: ${problems.join("; ")}`);
        process.exitCode = 1;
      } else {
        console.log("[verify_video] OK");
      }
    })
    .catch((err) => {
      console.error(`[verify_video] ERROR: ${err?.stack || err?.message || err}`);
      process.exitCode = 1;
    });
}
