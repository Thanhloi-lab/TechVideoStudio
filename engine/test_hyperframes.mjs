#!/usr/bin/env node
// HyperFrames engine test suite (zero deps): audio probe, compiler contract, runtime determinism
// across all 7 templates, and a real MP4 render verified for duration / frame size / audio.
//
// Usage: node engine/test_hyperframes.mjs [--keep] [--skip-render]
//   --keep         keep the temporary workspace for inspection
//   --skip-render  only run unit + compile + snapshot checks

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.dirname(__filename);
const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const SKIP_RENDER = argv.includes("--skip-render");

const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-hf-test-"));
process.env.VIDEO_MAKER_WORKSPACE_ROOT = tmpWorkspace;

const imp = (rel) => import(pathToFileURL(path.join(ENGINE_DIR, rel)).href);
const { probeWavDuration, probeMp3Duration, probeAudioDuration } = await imp("hyperframes/audio_probe.mjs");
const { compileEpisodeProject, computeTimeline, jsonForHtml, normalizeCodeLang } = await imp("hyperframes/compiler.mjs");
const { writeDemoCourse, createToneWav, DEMO_EPISODE_ID } = await imp("hyperframes/fixtures/make_demo_course.mjs");
const { getFreePort } = await imp("hyperframes/cdp.mjs");
const { ensureStudioServer, fetchEpisodePayload } = await imp("hyperframes/studio_server.mjs");
const { captureSnapshots } = await imp("hyperframes/snapshot.mjs");
const { verifyEpisodeVideo } = await imp("hyperframes/verify_video.mjs");
const { verifyVendoredFiles } = await imp("scripts/vendor_libs.mjs");

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`PASS: ${msg}`);
}

/** Minimal MPEG-1 Layer III CBR stream: 128 kbps, 44.1 kHz, stereo, zero payload. */
function makeCbrMp3(frames) {
  const parts = [];
  for (let i = 0; i < frames; i++) {
    const padding = i % 3 === 0 ? 0 : 1; // ~417.96 bytes average
    const size = Math.floor((144 * 128000) / 44100) + padding;
    const buf = Buffer.alloc(size);
    buf[0] = 0xff;
    buf[1] = 0xfb; // MPEG-1, Layer III, no CRC
    buf[2] = (0x9 << 4) | (0 << 2) | (padding << 1); // 128 kbps, 44.1 kHz
    buf[3] = 0x00; // stereo
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

async function main() {
  console.log(`[test_hyperframes] temp workspace: ${tmpWorkspace}`);

  // 1. Vendored runtime integrity -------------------------------------------------------------
  const vendor = verifyVendoredFiles();
  assert.ok(vendor.rawCount >= 3, "raw vendor files (HyperFrames runtime, GSAP UMD) must be pinned");
  pass(`vendor manifest verified (${vendor.moduleCount} ESM modules, ${vendor.rawCount} pinned raw files)`);

  // 2. Audio probe ---------------------------------------------------------------------------------
  const wav = createToneWav(2.5, { sampleRate: 24000 });
  assert.ok(Math.abs(probeWavDuration(wav) - 2.5) < 1e-3);
  const mp3 = makeCbrMp3(380);
  const mp3Dur = probeMp3Duration(mp3);
  assert.ok(Math.abs(mp3Dur - (380 * 1152) / 44100) < 1e-6, `mp3 duration ${mp3Dur}`);
  const tmpMp3 = path.join(tmpWorkspace, "probe.mp3");
  fs.writeFileSync(tmpMp3, mp3);
  assert.ok(Math.abs(probeAudioDuration(tmpMp3) - mp3Dur) < 1e-9);
  assert.equal(probeAudioDuration(path.join(tmpWorkspace, "missing.wav")), null);
  pass("audio_probe measures WAV and CBR MP3 durations exactly");

  // 3. Compiler units --------------------------------------------------------------------------------
  assert.equal(jsonForHtml({ a: "</script><b>&" }).includes("</script>"), false);
  assert.equal(normalizeCodeLang("sh"), "bash");
  assert.equal(normalizeCodeLang("YML"), "yaml");
  const tl = computeTimeline(
    [
      { id: "a", duration_sec: 3 },
      { id: "b", duration_sec: 4.5 },
      { id: "c" },
    ],
    { speed: 1.5 }
  );
  assert.deepEqual(
    tl.scenes.map((s) => [s.start, s.duration]),
    [
      [0, 2],
      [2, 3],
      [5, 3.333],
    ]
  );
  assert.equal(tl.total, 8.333);
  pass("computeTimeline divides narration time by speed (fallback 5s without audio)");

  // 4. Demo course compile (all 7 templates) ---------------------------------------------------------
  const sceneSec = 2.5;
  writeDemoCourse({ workspaceRoot: tmpWorkspace, courseId: "HFTEST", sceneSec });
  const port = await getFreePort();
  const server = await ensureStudioServer(port, { workspaceRoot: tmpWorkspace, log: () => {} });
  try {
    const episode = await fetchEpisodePayload(port, "HFTEST", DEMO_EPISODE_ID);
    const { projectDir, manifest } = await compileEpisodeProject({
      workspaceRoot: tmpWorkspace,
      courseId: "HFTEST",
      episode,
      speed: 1,
    });
    const html = fs.readFileSync(path.join(projectDir, "index.html"), "utf-8");
    assert.match(html, /<div id="root" data-composition-id="main" data-start="0" data-duration="17\.5" data-width="1920" data-height="1080">/);
    assert.match(html, /<script data-hyperframes-preview-runtime src="\.\/lib\/hyperframe\.runtime\.iife\.js"><\/script>/);
    assert.equal((html.match(/class="clip tvs-scene"/g) || []).length, 7);
    assert.equal((html.match(/<audio /g) || []).length, 7);
    assert.ok((html.match(/class="clip tvs-subtitle"/g) || []).length >= 7);
    for (const f of [
      "lib/hyperframe.runtime.iife.js",
      "lib/HYPERFRAMES_LICENSE.txt",
      "lib/gsap.min.js",
      "lib/kernel.mjs",
      "lib/icons.mjs",
      "lib/tvs-hf-main.mjs",
      "lib/tvs-hf-common.mjs",
      "lib/tvs-hf.css",
      "composition.json",
    ]) {
      assert.ok(fs.existsSync(path.join(projectDir, ...f.split("/"))), `missing ${f}`);
    }
    for (const t of ["architecture", "console_setup", "code_cli", "exam_tips", "comparison_matrix", "timeline_flow", "kpi_metrics"]) {
      assert.ok(fs.existsSync(path.join(projectDir, "lib", "scenes", `${t}.mjs`)), `missing scene module ${t}`);
    }
    assert.equal(manifest.total_duration, 17.5);
    assert.equal(manifest.audio.length, 7);
    manifest.scenes.forEach((s, i) => {
      assert.equal(s.start, i * sceneSec);
      assert.equal(s.duration, sceneSec);
    });
    const data = JSON.parse(html.match(/<script type="application\/json" id="tvs-episode-data">([\s\S]*?)<\/script>/)[1]);
    const code = data.scenes.find((s) => s.visual_type === "code_cli").code;
    assert.ok(code.snapshots.length >= 2 && Array.isArray(code.snapshots[0].tokens), "code_cli snapshots must be Shiki-tokenized");
    assert.ok(code.phase_snapshot.length === 3);
    pass("compiler emits a HyperFrames-contract project (root attrs, 7 scene clips, 7 audio clips, Shiki tokens)");

    // 5. Runtime readiness + determinism for every template ------------------------------------
    const times = manifest.scenes.map((s) => Math.round((s.start + s.duration * 0.62) * 1000) / 1000);
    const snap = await captureSnapshots({
      course: "HFTEST",
      episode: DEMO_EPISODE_ID,
      port,
      times,
      scene: null,
      at: [],
      out: path.join(tmpWorkspace, "snapshots"),
      speed: 1,
      scale: 0.5,
      checkDeterminism: true,
    });
    assert.deepEqual(snap.errors, [], `browser/build errors:\n${snap.errors.join("\n")}`);
    assert.equal(snap.files.length, 7);
    pass("HyperFrames runtime builds all 7 templates with 0 errors; reverse-order seeks give identical visible state");
  } finally {
    await server.stop();
  }

  // 6. Real render through render_video.mjs ---------------------------------------------------------
  if (!SKIP_RENDER) {
    const renderPort = await getFreePort();
    const res = spawnSync(
      process.execPath,
      [
        path.join(ENGINE_DIR, "render_video.mjs"),
        "--course",
        "HFTEST",
        "--episode",
        DEMO_EPISODE_ID,
        "--port",
        String(renderPort),
        "--resolution",
        "720p",
        "--fps",
        "24",
        "--workers",
        "2",
        "--output",
        "hf-e2e",
      ],
      { cwd: ENGINE_DIR, env: { ...process.env }, encoding: "utf-8", timeout: 600_000 }
    );
    if (res.status !== 0) {
      throw new Error(`render_video failed (${res.status}):\n${res.stdout}\n${res.stderr}`);
    }
    assert.match(res.stdout, /engine=hyperframes/);
    const out = path.join(tmpWorkspace, "HFTEST", "episodes", DEMO_EPISODE_ID, "hf-e2e.mp4");
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 50_000, "rendered mp4 must exist and be non-trivial");
    const verifyPort = await getFreePort();
    const info = await verifyEpisodeVideo({ port: verifyPort, course: "HFTEST", episode: DEMO_EPISODE_ID, file: "hf-e2e.mp4" });
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
    assert.ok(Math.abs(info.duration - 17.5) < 0.15, `duration ${info.duration}`);
    assert.ok(info.audio && !info.audio.error && info.audio.rms > 1e-3, `audio ${JSON.stringify(info.audio)}`);
    pass(`render_video.mjs (HyperFrames) → hf-e2e.mp4 ${info.width}x${info.height}, ${info.duration.toFixed(2)}s, audio rms ${info.audio.rms.toFixed(3)}`);
  }

  console.log(`\n[test_hyperframes] ${passed} checks passed.`);
}

main()
  .catch((err) => {
    console.error(`[test_hyperframes] FAIL: ${err?.stack || err?.message || err}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (KEEP) {
      console.log(`[test_hyperframes] kept workspace ${tmpWorkspace}`);
    } else {
      try {
        fs.rmSync(tmpWorkspace, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
      } catch {
        // best effort
      }
    }
  });
