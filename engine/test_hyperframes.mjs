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
const { compileEpisodeProject, computeTimeline, jsonForHtml, normalizeCodeLang, VALID_SFX_TYPES } = await imp("hyperframes/compiler.mjs");
const { measureIntegratedLufs, normalizeLoudnessAndLimit } = await imp("src/audio_dsp.mjs");
const { writeDemoCourse, createToneWav, DEMO_EPISODE_ID } = await imp("hyperframes/fixtures/make_demo_course.mjs");
const { getFreePort, launchChrome, openPage, navigate, evaluate, sleep } = await imp("hyperframes/cdp.mjs");
const { ensureStudioServer, fetchEpisodePayload, projectUrl } = await imp("hyperframes/studio_server.mjs");
const { buildRenderBridgeScript, waitForComposition } = await imp("hyperframes/bridge.mjs");
const { buildLayoutQcExpression } = await imp("hyperframes/layout_qc.mjs");
const { renderEpisodeHyperframes } = await imp("hyperframes/render.mjs");
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

  // 3b. Phase 2: SFX WAV assets + pure-JS BS.1770 LUFS DSP --------------------------------------
  for (const sfxType of VALID_SFX_TYPES) {
    const sfxPath = path.join(ENGINE_DIR, "assets", "sfx", `${sfxType}.wav`);
    assert.ok(fs.existsSync(sfxPath), `missing SFX asset ${sfxPath}`);
    assert.ok(probeWavDuration(fs.readFileSync(sfxPath)) > 0.02, `invalid SFX duration for ${sfxType}`);
  }
  const dspSr = 48000;
  const dspSamples = dspSr * 2;
  const qL = new Float32Array(dspSamples);
  const qR = new Float32Array(dspSamples);
  for (let i = 0; i < dspSamples; i++) {
    const v = 0.04 * Math.sin((2 * Math.PI * 440 * i) / dspSr);
    qL[i] = v;
    qR[i] = v;
  }
  const normRes = normalizeLoudnessAndLimit(qL, qR, { sampleRate: dspSr, targetLufs: -16 });
  assert.ok(Math.abs(normRes.outputLufs - -16) <= 0.5, `normalized LUFS out of range: ${normRes.outputLufs}`);
  assert.ok(normRes.peak <= 0.85, `limiter ceiling exceeded: ${normRes.peak}`);
  const silentRes = normalizeLoudnessAndLimit(new Float32Array(dspSr), null, { sampleRate: dspSr, targetLufs: -16 });
  assert.equal(Number.isFinite(silentRes.outputLufs), false, "pure silence should stay -Infinity LUFS");
  assert.equal(silentRes.gainDb, 0, "pure silence should receive 0 dB gain");
  pass(`SFX assets (${VALID_SFX_TYPES.length} WAVs) & pure-JS BS.1770 DSP verified (${normRes.inputLufs} → ${normRes.outputLufs} LUFS)`);

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
    assert.match(html, /class="tvs-bg-grid"/);
    assert.match(html, /class="tvs-bg-light"/);
    assert.match(html, /id="scene-1"[^>]*data-overlap-out="0\.45"[^>]*data-scene-id="s2_console"/);
    assert.match(html, /id="scene-3"[^>]*data-overlap-out="0"[^>]*data-scene-id="s4_exam"/);
    assert.ok(Array.isArray(manifest.sfx) && manifest.sfx.length > 0, "compiler should emit SFX cues");
    for (const cue of manifest.sfx) {
      assert.ok(fs.existsSync(path.join(projectDir, "assets", "sfx", `${cue.type}.wav`)), `missing copied SFX ${cue.type}.wav`);
    }
    const data = JSON.parse(html.match(/<script type="application\/json" id="tvs-episode-data">([\s\S]*?)<\/script>/)[1]);
    const code = data.scenes.find((s) => s.visual_type === "code_cli").code;
    assert.ok(code.snapshots.length >= 2 && Array.isArray(code.snapshots[0].tokens), "code_cli snapshots must be Shiki-tokenized");
    assert.ok(code.phase_snapshot.length === 3);
    pass("compiler emits a HyperFrames-contract project (root attrs, 7 scene clips, 7 audio clips, SFX cues, overlap, Shiki tokens)");

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
      checkLayout: true,
      qcStrict: true,
    });
    assert.deepEqual(snap.errors, [], `browser/build errors:\n${snap.errors.join("\n")}`);
    assert.equal(snap.files.length, 7);
    assert.ok(snap.layoutQc, "captureSnapshots should return layoutQc when checkLayout=true");
    assert.equal(snap.layoutQc.scenes_checked, 7);
    assert.equal(snap.layoutQc.frames_checked, 21);
    assert.equal(snap.layoutQc.error_count, 0, `expected 0 layout QC errors, got: ${JSON.stringify(snap.layoutQc.findings)}`);
    pass("HyperFrames runtime builds all 7 templates with 0 errors; determinism + strict Layout QC pass (21 frames)");

    // 5b. Mixed Light/Dark world_theme, causal_mechanic rotation, SharpTag & BGM determinism -----
    const ep2Id = "ep02-phase2";
    const ep2Dir = path.join(tmpWorkspace, "HFTEST", "episodes", ep2Id);
    const ep2AudioDir = path.join(ep2Dir, "audio", "demo-tone");
    fs.mkdirSync(ep2AudioDir, { recursive: true });
    const p2SceneSec = 2.2;
    fs.writeFileSync(path.join(ep2Dir, "bgm.wav"), createToneWav(p2SceneSec, { freq: 110, seed: 99 }));
    const p2Scenes = [
      {
        id: "p2_s1",
        part: "problem",
        part_label: "Phần 1 · Bài toán",
        title: "So sánh Latency & SharpTags",
        narration: "Kiểm tra metrics với SharpTag và hiệu ứng width-push.",
        visual_type: "kpi_metrics",
        visual_job: "PROOF",
        world_theme: "dark",
        causal_mechanic: "width-push",
        sfx_cues: [{ type: "impact", progress: 0.2, volume: 0.7 }],
        visual_data: {
          sharp_tags: true,
          subtitle: "Throughput Benchmark",
          cards: [
            { label: "Latency P99", value: 12, unit: "ms", delta_label: "-68%", tone: "cyan", progress_start: 0.05 },
            { label: "Cache Hit", value: 99, unit: "%", delta_label: "+42%", tone: "green", progress_start: 0.25 },
          ],
        },
      },
      {
        id: "p2_s2",
        part: "architecture",
        part_label: "Phần 2 · Đối chiếu",
        title: "Light World & Arc Emission",
        narration: "Chuyển sang nền sáng để tạo nhịp tương phản.",
        visual_type: "comparison_matrix",
        visual_job: "CONTRAST",
        world_theme: "light",
        causal_mechanic: "arc-emission",
        visual_data: {
          columns: ["Tiêu chí", "REST", "gRPC"],
          rows: [
            { label: "Payload", values: ["JSON", "Protobuf"], tone: "blue", progress_start: 0.1 },
            { label: "Streaming", values: ["No", "Bi-di"], tone: "green", progress_start: 0.35 },
          ],
          takeaway: { text: "gRPC giảm ~60% overhead", tone: "blue", show_at_progress: 0.72 },
        },
      },
      {
        id: "p2_s3",
        part: "setup",
        part_label: "Phần 3 · Thiết lập",
        title: "Timeline Flow & Squash Drop",
        narration: "Các bước codegen trong cùng một phần.",
        visual_type: "timeline_flow",
        visual_job: "CONCEPT",
        world_theme: "dark",
        causal_mechanic: "squash-drop",
        visual_data: {
          milestones: [
            { time_label: "01", title: "Parse Schema", detail: "Validate .proto", tone: "blue", progress_start: 0.1 },
            { time_label: "02", title: "Codegen", detail: "Stub + Client", tone: "cyan", progress_start: 0.45 },
          ],
          callout: { text: "Zero-copy framing", tone: "amber", show_at_progress: 0.78 },
        },
      },
      {
        id: "p2_s4",
        part: "setup",
        part_label: "Phần 3 · Kết luận",
        title: "Exam Tips & Typographic Strike",
        narration: "Ghi nhớ protocol HTTP/2 khi ôn thi.",
        visual_type: "exam_tips",
        visual_job: "RECAP",
        world_theme: "light",
        causal_mechanic: "typographic-strike",
        visual_data: {
          comparisons: [{ left_label: "JSON", left_text: "Text overhead cao", right_label: "Protobuf", right_text: "Binary nhỏ gọn", progress_start: 0.12 }],
          traps: ["Không gửi raw token qua plaintext HTTP/2"],
          quiz: { question: "gRPC chạy trên protocol nào?", options: ["HTTP/2", "FTP"], answer_index: 0, explain: "HTTP/2 hỗ trợ multiplexing", show_at_progress: 0.7 },
        },
      },
    ].map((sc, i) => {
      const file = `audio/demo-tone/${sc.id}.wav`;
      fs.writeFileSync(path.join(ep2Dir, ...file.split("/")), createToneWav(p2SceneSec, { freq: 240 + i * 35, seed: i + 21 }));
      return { ...sc, audio_file: file, duration_sec: p2SceneSec };
    });

    const p2Script = {
      course_id: "HFTEST",
      episode_id: ep2Id,
      episode_number: 2,
      title: "Phase 2 Grammar & BGM Test",
      aspect_ratio: "16:9",
      tts_profile: "demo-tone",
      bgm_file: "bgm.wav",
      total_duration_sec: p2Scenes.length * p2SceneSec,
      scenes: p2Scenes,
    };
    fs.writeFileSync(path.join(ep2Dir, "script.json"), JSON.stringify(p2Script, null, 2) + "\n", "utf-8");
    const courseJsonPath = path.join(tmpWorkspace, "HFTEST", "course.json");
    const courseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    courseJson.stages[0].episodes.push({ id: ep2Id, number: 2, title: p2Script.title, duration_target: "1 phút" });
    fs.writeFileSync(courseJsonPath, JSON.stringify(courseJson, null, 2) + "\n", "utf-8");

    const ep2Payload = await fetchEpisodePayload(port, "HFTEST", ep2Id);
    const compiled2 = await compileEpisodeProject({
      workspaceRoot: tmpWorkspace,
      courseId: "HFTEST",
      episode: ep2Payload,
      speed: 1,
    });
    const html2 = fs.readFileSync(compiled2.indexPath, "utf-8");
    assert.equal(compiled2.manifest.bgm?.src, "assets/bgm/bgm.wav");
    assert.ok(fs.existsSync(path.join(compiled2.projectDir, "assets", "bgm", "bgm.wav")), "BGM must be copied into project");
    assert.match(html2, /class="clip tvs-scene tvs-scene--light"[^>]*data-world-theme="light"/);
    assert.ok(compiled2.manifest.sfx.some((c) => c.type === "impact"), "explicit impact SFX cue must be compiled");

    const times2 = compiled2.manifest.scenes.map((s) => Math.round((s.start + s.duration * 0.55) * 1000) / 1000);
    const snap2 = await captureSnapshots({
      course: "HFTEST",
      episode: ep2Id,
      port,
      times: times2,
      scene: null,
      at: [],
      out: path.join(tmpWorkspace, "snapshots-p2"),
      speed: 1,
      scale: 0.5,
      checkDeterminism: true,
      checkLayout: true,
      qcStrict: true,
    });
    assert.deepEqual(snap2.errors, [], `phase 2 browser/determinism errors:\n${snap2.errors.join("\n")}`);
    assert.ok(snap2.layoutQc, "Phase 2 captureSnapshots should return layoutQc");
    assert.equal(snap2.layoutQc.scenes_checked, 4);
    assert.equal(snap2.layoutQc.frames_checked, 12);
    assert.equal(snap2.layoutQc.error_count, 0, `Phase 2 layout QC errors: ${JSON.stringify(snap2.layoutQc.findings)}`);
    pass("Phase 2 mixed Light/Dark world_theme, causal_mechanic, SharpTag & BGM pass determinism + strict Layout QC with 0 errors");

    // 5c. Phase 3.2: Synthetic broken episode (ep03-qc-broken) + topbar_collision QC verification ----
    const ep3Id = "ep03-qc-broken";
    const ep3Dir = path.join(tmpWorkspace, "HFTEST", "episodes", ep3Id);
    fs.mkdirSync(path.join(ep3Dir, "audio", "demo-tone"), { recursive: true });
    const p3SceneSec = 2.5;
    const longCell =
      "Đây là đoạn văn bản mô tả rất dài vượt quá giới hạn hai dòng của ô ma trận so sánh để kiểm tra cơ chế phát hiện clipped_text khi nội dung bị cắt xén bởi overflow hidden trong trình duyệt Chrome.";
    const p3Rows = Array.from({ length: 14 }, (_, idx) => ({
      criterion: `Tiêu chí tràn dòng số ${idx + 1}`,
      progress_start: 0.05,
      values: {
        a: { text: idx === 0 ? longCell : `Giá trị mẫu ${idx + 1}A`, status: "bad" },
        b: { text: `Giá trị mẫu ${idx + 1}B`, status: "good" },
      },
    }));
    const p3Scenes = [
      {
        id: "b1_matrix",
        part: "problem",
        part_label: "Phần 1 · Lỗi Layout",
        title:
          "Tiêu đề tập cực kỳ dài để kiểm tra cảnh báo topbar_title_truncated khi văn bản bị cắt xén ở thanh tiêu đề trên cùng của khung hình 1920x1080 trong HyperFrames",
        narration: "Kiểm tra tràn khung và cắt chữ.",
        visual_type: "comparison_matrix",
        visual_data: {
          badge: "Broken Layout Test",
          columns: [
            { id: "a", title: "Cột A", tone: "red" },
            { id: "b", title: "Cột B", tone: "green" },
          ],
          rows: p3Rows,
        },
        subtitles: [
          {
            start_sec: 0.1,
            end_sec: 2.3,
            text: "SubTokenWithoutSpaces_12345678901234567890123456789012345678901234567890123456789012345678901234567890_End",
          },
        ],
      },
      {
        id: "b2_arch",
        part: "architecture",
        part_label: "Phần 2 · Node tràn",
        title: "Kiến trúc node đặt ngoài safe-zone",
        narration: "Node bị đẩy ra ngoài stage.",
        visual_type: "architecture",
        visual_data: {
          layout_mode: "manual",
          nodes: [
            { id: "n1", label: "Node Trong", sublabel: "OK", icon: "ec2", tone: "blue", x: 30, y: 50 },
            { id: "n2", label: "Node Tràn Dưới & Phải", sublabel: "Broken", icon: "s3", tone: "red", x: 96, y: 108 },
          ],
          edges: [{ id: "e1", from: "n1", to: "n2", label: "Overflow", style: "danger" }],
          flow_steps: [],
        },
        subtitles: [{ start_sec: 0.1, end_sec: 2.3, text: "Phụ đề đụng **Node Tràn Dưới** ở đây." }],
      },
    ].map((sc, i) => {
      const file = `audio/demo-tone/${sc.id}.wav`;
      fs.writeFileSync(path.join(ep3Dir, ...file.split("/")), createToneWav(p3SceneSec, { freq: 210 + i * 30, seed: i + 51 }));
      return { ...sc, audio_file: file, duration_sec: p3SceneSec };
    });
    fs.writeFileSync(
      path.join(ep3Dir, "script.json"),
      JSON.stringify(
        {
          course_id: "HFTEST",
          episode_id: ep3Id,
          episode_number: 3,
          title: "Phase 3 QC Broken Episode",
          aspect_ratio: "16:9",
          tts_profile: "demo-tone",
          total_duration_sec: p3Scenes.length * p3SceneSec,
          scenes: p3Scenes,
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );
    const cj3 = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    cj3.stages[0].episodes.push({ id: ep3Id, number: 3, title: "Phase 3 QC Broken", duration_target: "1 phút" });
    fs.writeFileSync(courseJsonPath, JSON.stringify(cj3, null, 2) + "\n", "utf-8");

    const snapBroken = await captureSnapshots({
      course: "HFTEST",
      episode: ep3Id,
      port,
      times: [],
      scene: null,
      at: [],
      out: path.join(tmpWorkspace, "snapshots-broken"),
      speed: 1,
      scale: 0.5,
      checkLayout: true,
      qcStrict: false,
    });
    assert.ok(snapBroken.layoutQc, "ep03-qc-broken should produce layoutQc");
    assert.ok(snapBroken.layoutQc.error_count > 0, "ep03-qc-broken must report QC errors");
    assert.ok(snapBroken.layoutQc.warning_count > 0, "ep03-qc-broken must report topbar_title_truncated warning");
    const brokenCodes = new Set(snapBroken.layoutQc.findings.map((f) => f.code));
    for (const expectedCode of [
      "viewport_overflow",
      "stage_overflow",
      "subtitle_collision",
      "subtitle_overflow",
      "clipped_text",
      "topbar_title_truncated",
    ]) {
      assert.ok(brokenCodes.has(expectedCode), `Expected finding code "${expectedCode}", got: ${[...brokenCodes].join(", ")}`);
    }
    for (const f of snapBroken.layoutQc.findings) {
      assert.ok(f.scene_id && Number.isInteger(f.scene_index) && f.visual_type && Number.isFinite(f.checkpoint) && Number.isFinite(f.timestamp));
      assert.ok(f.code && f.severity && f.selector && f.message && f.rect);
    }

    const snapBrokenStrict = await captureSnapshots({
      course: "HFTEST",
      episode: ep3Id,
      port,
      times: [],
      scene: null,
      at: [],
      out: path.join(tmpWorkspace, "snapshots-broken-strict"),
      speed: 1,
      scale: 0.5,
      checkLayout: true,
      qcStrict: true,
    });
    assert.ok(snapBrokenStrict.errors.some((e) => e.includes("[layout-qc]")), "qcStrict must populate errors[] on broken layout");

    // Verify renderEpisodeHyperframes throws when qcStrict=true on broken episode
    await assert.rejects(
      () =>
        renderEpisodeHyperframes(
          {
            workspaceRoot: tmpWorkspace,
            course: "HFTEST",
            episode: ep3Id,
            port,
            format: "mp4",
            codec: "h264",
            hardware: "auto",
            resolution: "720p",
            fps: 24,
            speed: 1,
            checkLayout: true,
            qcStrict: true,
          },
          { log: () => {} }
        ),
      /Layout QC failed/
    );

    // Direct Chrome verification for topbar_collision + finding deduplication
    const qcProbeChrome = await launchChrome({ label: "qc-topbar-probe" });
    try {
      const { cdp } = qcProbeChrome;
      const { sessionId } = await openPage(cdp, { isolated: true });
      await cdp.send("Runtime.enable", {}, { sessionId });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, { sessionId });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: buildRenderBridgeScript({ fps: 60 }) }, { sessionId });
      await navigate(cdp, sessionId, projectUrl(port, "HFTEST", ep3Id));
      await waitForComposition((expr) => evaluate(cdp, sessionId, expr), { sleepFn: sleep });
      await evaluate(
        cdp,
        sessionId,
        `(async () => {
          if (typeof window.__hfForceTimelineRebind === "function") window.__hfForceTimelineRebind();
          window.__hf.seek(0.5);
          if (typeof window.__hfWaitForSeekCompletion === "function") await window.__hfWaitForSeekCompletion();
          const stage = document.querySelector("#scene-0 .tvs-stage");
          const badge = document.createElement("div");
          badge.className = "qc-injected-topbar-hit";
          badge.textContent = "Injected topbar collision";
          badge.style.cssText = "position:absolute;left:100px;top:-90px;width:400px;height:60px;background:#ef4444;color:#fff;";
          stage.appendChild(badge);
          return true;
        })()`
      );
      const topHitRes = await evaluate(
        cdp,
        sessionId,
        buildLayoutQcExpression({
          sceneId: "b1_matrix",
          sceneIndex: 0,
          visualType: "comparison_matrix",
          checkpoint: 0.2,
          timestamp: 0.5,
        })
      );
      assert.ok(
        topHitRes.findings.some((f) => f.code === "topbar_collision" && f.severity === "error"),
        `Expected topbar_collision finding, got: ${JSON.stringify(topHitRes.findings)}`
      );
    } finally {
      await qcProbeChrome.close();
    }
    pass("ep03-qc-broken triggers all 6 layout QC checks + topbar_title_truncated warning & fails qcStrict in snapshot/render");
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
    assert.match(res.stdout, /\[render\] QC: PASS/);
    assert.match(res.stdout, /qc_errors=0/);
    const out = path.join(tmpWorkspace, "HFTEST", "episodes", DEMO_EPISODE_ID, "hf-e2e.mp4");
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 50_000, "rendered mp4 must exist and be non-trivial");
    const verifyPort = await getFreePort();
    const info = await verifyEpisodeVideo({
      port: verifyPort,
      course: "HFTEST",
      episode: DEMO_EPISODE_ID,
      file: "hf-e2e.mp4",
      checkLayout: true,
    });
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
    assert.ok(Math.abs(info.duration - 17.5) < 0.15, `duration ${info.duration}`);
    assert.ok(info.audio && !info.audio.error && info.audio.rms > 1e-3, `audio ${JSON.stringify(info.audio)}`);
    assert.ok(Number.isFinite(info.audio.lufs), `expected measured LUFS, got ${JSON.stringify(info.audio)}`);
    assert.ok(info.audio.lufs >= -18.5 && info.audio.lufs <= -13.5, `output LUFS out of target range: ${info.audio.lufs}`);
    assert.ok(info.audio.peak <= 0.90, `output peak exceeded ceiling: ${info.audio.peak}`);
    assert.ok(info.layout_qc, "verifyEpisodeVideo({ checkLayout: true }) must return layout_qc");
    assert.equal(info.layout_qc.scenes_checked, 7);
    assert.equal(info.layout_qc.frames_checked, 21);
    assert.equal(info.layout_qc.error_count, 0, `verify_video layout_qc errors: ${JSON.stringify(info.layout_qc.findings)}`);
    pass(`render_video.mjs (HyperFrames) + verifyEpisodeVideo Layout QC → hf-e2e.mp4 ${info.width}x${info.height}, ${info.duration.toFixed(2)}s, audio rms ${info.audio.rms.toFixed(3)}, ${info.audio.lufs} LUFS, qc scenes=7 errors=0`);
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
