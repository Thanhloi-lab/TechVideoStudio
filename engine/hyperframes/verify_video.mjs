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

import { evaluate, launchChrome, navigate, openPage } from "./cdp.mjs";
import { ensureStudioServer } from "./studio_server.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.resolve(path.dirname(__filename), "..");
const WORKSPACE_ROOT = process.env.VIDEO_MAKER_WORKSPACE_ROOT
  ? path.resolve(process.env.VIDEO_MAKER_WORKSPACE_ROOT)
  : path.resolve(ENGINE_DIR, "..");

export async function verifyEpisodeVideo({ port = 3030, course, episode, file, frames = [], outDir = "" }) {
  const server = await ensureStudioServer(port, { workspaceRoot: WORKSPACE_ROOT, log: () => {} });
  let chrome = null;
  try {
    chrome = await launchChrome({ label: "verify-chrome" });
    const { cdp } = chrome;
    const { sessionId } = await openPage(cdp);
    await navigate(cdp, sessionId, `http://127.0.0.1:${port}/public/hf-encoder.html`);
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
          let sum = 0, peak = 0;
          for (let i = 0; i < ch.length; i++) { const s = ch[i]; sum += s * s; if (Math.abs(s) > peak) peak = Math.abs(s); }
          out.audio = { duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels, rms: Math.sqrt(sum / Math.max(1, ch.length)), peak };
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
    return { ...info, frameFiles: written };
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
  const opts = {
    port: Number(get("--port", "3030")) || 3030,
    course: get("--course"),
    episode: get("--episode"),
    file: get("--file"),
    frames: get("--frames") ? get("--frames").split(",").map(Number).filter(Number.isFinite) : [],
    outDir: get("--out"),
  };
  const expectDuration = Number(get("--expect-duration", "NaN"));
  if (!opts.course || !opts.episode || !opts.file) {
    console.log("Usage: node engine/hyperframes/verify_video.mjs --course <C> --episode <EP> --file <name.mp4> [--port 3030] [--frames 1.5,20] [--expect-duration 49]");
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
