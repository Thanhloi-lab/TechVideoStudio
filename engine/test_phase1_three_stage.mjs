#!/usr/bin/env node
// Phase 1 Integration & Unit Test Suite:
// - Dynamic per-role provider routing (zero hardcoded agent/model defaults)
// - 3-Stage Decoupled Scriptwriting (Brief -> Dialogue -> Visual Director) + pause_after + start_from
// - Dual-Text TTS Safety (tts_text vs display_text) & Audio-Spine Lock (--audio-spine + POST /api/episodes/audio-spine)
// - New scripting artifact endpoints & backward-compatible validator warnings

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadAiPreferences,
  resolveRoleProvider,
  savePipelineRouting,
  VALID_PIPELINE_ROLES,
} from "./ai/providers.mjs";
import { validateScriptDiagrams, validateSingleScene } from "./src/diagram_validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.dirname(__filename);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function runCommandAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...opts,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf-8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ status: code, stdout, stderr });
    });
  });
}

function makeToneWavBuffer(durationSec = 0.55, sampleRate = 24000) {
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 6000);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return buf;
}

function httpRequestJson(port, method, reqPath, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj !== null ? Buffer.from(JSON.stringify(bodyObj), "utf-8") : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: reqPath,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": payload.length }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServerReady(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await httpRequestJson(port, "GET", "/api/courses");
      if (r.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Studio server on port ${port} did not become ready within ${timeoutMs}ms`);
}

async function waitForAiJobDone(port, jobId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await httpRequestJson(port, "GET", "/api/ai/jobs");
    const list = r.body?.jobs || [];
    const found = list.find((j) => j.id === jobId);
    if (found && (found.status === "completed" || found.status === "failed" || found.status === "paused")) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`AI job ${jobId} timed out`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-phase1-test-"));
const tmpEngineDir = path.join(tmpRoot, "engine-cfg");
const tmpWorkspace = path.join(tmpRoot, "workspace");
fs.mkdirSync(tmpEngineDir, { recursive: true });
fs.mkdirSync(tmpWorkspace, { recursive: true });

let mockLlmServer = null;
let mockTtsServer = null;
let serverProc = null;

try {
  // -------------------------------------------------------------------------
  // 1. Dynamic Per-Role Provider Routing Unit Tests
  // -------------------------------------------------------------------------
  console.log("=== 1. Dynamic Per-Role Provider Routing ===");
  const prevPrefEnv = process.env.VIDEO_MAKER_AI_PREFERENCES_FILE;
  const prevCredEnv = process.env.VIDEO_MAKER_AI_CREDENTIALS_FILE;
  const prefFile = path.join(tmpEngineDir, ".ai_preferences.json");
  const credFile = path.join(tmpEngineDir, ".ai_credentials.json");
  process.env.VIDEO_MAKER_AI_PREFERENCES_FILE = prefFile;
  process.env.VIDEO_MAKER_AI_CREDENTIALS_FILE = credFile;

  // With nothing configured, must return null/none (zero hardcoded agent/model defaults)
  for (const role of VALID_PIPELINE_ROLES) {
    const emptyRes = resolveRoleProvider(role, { engineDir: tmpEngineDir });
    assert.equal(emptyRes.provider_id, null);
    assert.equal(emptyRes.model, null);
    assert.equal(emptyRes.source, "none");
  }

  // Write dummy credentials for openai & deepseek so pipeline_routing considers them ready
  fs.writeFileSync(
    credFile,
    JSON.stringify({
      version: 1,
      providers: {
        openai: { api_key: "sk-test-openai-key" },
        deepseek: { api_key: "sk-test-deepseek-key" },
      },
    }),
    "utf-8"
  );

  savePipelineRouting(
    {
      brief_scriptwriter: { provider_id: "openai", model: "mock-writer-v1" },
      visual_director: { provider_id: "deepseek", model: "mock-director-v2" },
    },
    tmpEngineDir
  );
  const loadedPrefs = loadAiPreferences(tmpEngineDir);
  assert.equal(loadedPrefs.pipeline_routing.brief_scriptwriter.provider_id, "openai");
  assert.equal(loadedPrefs.pipeline_routing.visual_director.model, "mock-director-v2");

  // Priority: explicit override > saved pipeline_routing > legacy compiler > job
  const fromSaved = resolveRoleProvider("visual_director", {
    job: { provider_id: "openai", model: "job-model", compiler_provider_id: "gemini", compiler_model: "legacy-c" },
    engineDir: tmpEngineDir,
  });
  assert.equal(fromSaved.provider_id, "deepseek");
  assert.equal(fromSaved.model, "mock-director-v2");
  assert.equal(fromSaved.source, "pipeline_routing");

  const fromOverride = resolveRoleProvider("visual_director", {
    overrides: { visual_director: { provider_id: "openai", model: "override-director" } },
    job: { provider_id: "deepseek", model: "job-model" },
    engineDir: tmpEngineDir,
  });
  assert.equal(fromOverride.provider_id, "openai");
  assert.equal(fromOverride.model, "override-director");
  assert.equal(fromOverride.source, "override");

  // Repair has no saved routing -> falls back to job dynamically
  const repairFallback = resolveRoleProvider("repair", {
    job: { provider_id: "openai", model: "dynamic-job-model" },
    engineDir: tmpEngineDir,
  });
  assert.equal(repairFallback.provider_id, "openai");
  assert.equal(repairFallback.model, "dynamic-job-model");
  assert.equal(repairFallback.source, "job");
  console.log("PASS: Dynamic per-role provider routing verified.");

  // -------------------------------------------------------------------------
  // 2. Validator Optional Metadata & Non-Blocking Warnings
  // -------------------------------------------------------------------------
  console.log("=== 2. Validator Optional Metadata & Static-Hold Warning ===");
  const longStaticScene = {
    id: "scene_static_warn",
    part: "problem",
    title: "Long Hold",
    visual_type: "kpi_metrics",
    visual_job: "Consequence",
    world_theme: "dark",
    causal_mechanic: "blur-materialize",
    narration:
      "Đây là một câu thuyết minh rất dài vượt quá hai mươi tám từ để kiểm tra xem bộ kiểm định có phát sinh cảnh báo nhẹ khi một cảnh chỉ có đúng một bước chuyển động hay không.",
    visual_data: {
      cards: [{ id: "c1", label: "Latency", value: "140ms", progress_start: 0.1 }],
    },
  };
  const warnRes = validateSingleScene(longStaticScene, 0);
  assert.equal(warnRes.valid, true);
  assert.ok(warnRes.warnings.some((w) => w.includes("static hold")));
  console.log("PASS: Optional visual_job/world_theme & non-blocking static-hold warning verified.");

  // -------------------------------------------------------------------------
  // 3. Setup Temp Course, Mock LLM Server & Mock VoiceStudio TTS Server
  // -------------------------------------------------------------------------
  const courseDir = path.join(tmpWorkspace, "DEMO3");
  fs.mkdirSync(path.join(courseDir, "episodes"), { recursive: true });
  fs.writeFileSync(
    path.join(courseDir, "course.json"),
    JSON.stringify(
      {
        id: "DEMO3",
        title: "Demo 3-Stage Course",
        tts_profile: "mock-vi",
        tts_provider: "openai_compat",
        tts_voice: "MockVoice",
        stages: [
          {
            stage: 1,
            title: "Core Stage",
            episodes: [
              { id: "ep01-cache", number: 1, title: "Tại sao K8s cần RDB Snapshot", duration_target: "3m", status: "planned" },
            ],
          },
        ],
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(courseDir, "curriculum.md"), "# DEMO3\n- ep01-cache: K8s + RDB\n");

  const initRes = spawnSync(
    process.execPath,
    [path.join(ENGINE_DIR, "state_cli.mjs"), "init", "--workspace", tmpWorkspace, "--course", "DEMO3"],
    { cwd: ENGINE_DIR, encoding: "utf-8" }
  );
  assert.equal(initRes.status, 0, initRes.stderr);

  const llmCalls = [];
  const mockLlmPort = await getFreePort();
  mockLlmServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      const reqJson = rawBody ? JSON.parse(rawBody) : {};
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-writer-v1" }, { id: "mock-director-v2" }] }));
        return;
      }
      const sysPrompt = String(reqJson.messages?.find((m) => m.role === "system")?.content || "");
      const userPrompt = String(reqJson.messages?.find((m) => m.role === "user")?.content || "");
      let stage = "unknown";
      let contentObj = {};

      if (sysPrompt.includes("Stage 1: Content Brief")) {
        stage = "stage_1_brief";
        assert.ok(sysPrompt.includes("STRICT PROHIBITION: Do NOT mention visual templates"));
        contentObj = {
          brief: {
            course_id: "DEMO3",
            episode_id: "ep01-cache",
            episode_number: 1,
            title: "Tại sao K8s cần RDB Snapshot",
            subtitle: "Khởi động lại pod không mất trạng thái",
            hook_angle: {
              family: "conflict",
              conflict_statement: "Pod restart làm bay sạch cache chỉ trong 140ms.",
              stakes: "Database chính sập vì cache stampede.",
            },
            narrative_arc: {
              setup: "Pod K8s bị kill bất ngờ.",
              escalation: "Cache lạnh gây quá tải DB.",
              reversal: "RDB snapshot nạp lại RAM trong vài giây.",
            },
            teaching_beats: [
              {
                id: "beat_01",
                part: "problem",
                goal: "Hiểu rủi ro mất cache khi pod restart",
                key_claim: "140ms latency tăng vọt lên 4000ms khi cache trống",
                concrete_proof_anchor: "P99 latency spike 140ms -> 4000ms",
              },
              {
                id: "beat_02",
                part: "architecture",
                goal: "Hiểu cơ chế RDB Snapshot",
                key_claim: "Redis fork tiến trình ghi RDB xuống ổ đĩa bền vững",
                concrete_proof_anchor: "SAVE 60 1000 / BGSAVE",
              },
            ],
          },
        };
      } else if (sysPrompt.includes("Stage 2: Dialogue & TTS Beats")) {
        stage = "stage_2_dialogue";
        assert.ok(sysPrompt.includes("STRICT PROHIBITION: Do NOT choose visual templates"));
        contentObj = {
          dialogue: {
            course_id: "DEMO3",
            episode_id: "ep01-cache",
            episode_number: 1,
            title: "Tại sao K8s cần RDB Snapshot",
            beats: [
              {
                beat_id: "beat_01",
                part: "problem",
                scene_group: "scene_01_hook",
                scene_title: "Cú sốc mất cache trên K8s",
                spoken_purpose: "Giải thích hệ quả sập DB khi pod restart",
                on_screen_fact: "P99: 140ms -> 4,000ms",
                display_text: "Khi pod K8s khởi động lại, độ trễ vọt từ 140ms lên rất cao.",
                tts_text: "Khi pod K-8-S khởi động lại, độ trễ vọt từ một trăm bốn mươi mili giây lên rất cao.",
                highlight_words: ["K8s", "140ms"],
                cue_hint: "Show latency spike card",
              },
              {
                beat_id: "beat_02",
                part: "architecture",
                scene_group: "scene_02_rdb",
                scene_title: "Cơ chế RDB Snapshot",
                spoken_purpose: "Giải thích cách RDB bảo vệ dữ liệu",
                on_screen_fact: "BGSAVE -> dump.rdb",
                display_text: "Cơ chế RDB sẽ fork tiến trình và lưu snapshot an toàn.",
                tts_text: "Cơ chế R-D-B sẽ fork tiến trình và lưu snapshot an toàn.",
                highlight_words: ["RDB", "snapshot"],
                cue_hint: "Show Client -> Redis -> Disk flow",
              },
            ],
          },
          notes_md: "# Ghi chú bài 01\n- RDB BGSAVE\n",
        };
      } else if (sysPrompt.includes("Visual Director & Motion Compiler (Stage 3)")) {
        stage = "stage_3_visual";
        assert.ok(userPrompt.includes("Locked Audio Spine Timings"), "Stage 3 prompt should receive audio_spine timings");
        contentObj = {
          script_json: {
            course_id: "DEMO3",
            episode_id: "ep01-cache",
            episode_number: 1,
            title: "Tại sao K8s cần RDB Snapshot",
            scenes: [
              {
                id: "scene_01_hook",
                part: "problem",
                part_label: "Phần 1: Bài toán thực tế",
                title: "Cú sốc mất cache trên K8s",
                visual_job: "Consequence",
                world_theme: "dark",
                causal_mechanic: "blur-materialize",
                visual_type: "kpi_metrics",
                narration: "Khi pod K8s khởi động lại, độ trễ vọt từ 140ms lên rất cao.",
                highlight_words: ["K8s", "140ms"],
                sfx_cues: [{ progress: 0.05, type: "whoosh_short" }],
                visual_data: {
                  cards: [
                    { id: "lat", label: "P99 Latency", value: "140ms", delta_text: "+28x spike", delta_tone: "danger", progress_start: 0.1 },
                    { id: "err", label: "DB Load", value: "99%", delta_text: "Cache Miss", delta_tone: "danger", progress_start: 0.45 },
                  ],
                },
              },
              {
                id: "scene_02_rdb",
                part: "architecture",
                part_label: "Phần 2: Sơ đồ Kiến trúc",
                title: "Cơ chế RDB Snapshot",
                visual_job: "Mechanism",
                world_theme: "light",
                causal_mechanic: "wire-draw",
                visual_type: "architecture",
                narration: "Cơ chế RDB sẽ fork tiến trình và lưu snapshot an toàn.",
                highlight_words: ["RDB"],
                visual_data: {
                  layout_mode: "auto",
                  zones: [
                    { id: "z_compute", label: "Compute", role: "compute", node_ids: ["redis"] },
                    { id: "z_data", label: "Storage", role: "data", node_ids: ["disk"] },
                  ],
                  nodes: [
                    { id: "redis", label: "Redis Node", sublabel: "BGSAVE", icon: "database", svg: "redis-stack", tone: "red" },
                    { id: "disk", label: "SSD Volume", sublabel: "dump.rdb", icon: "s3", svg: "ssd-disk", tone: "blue" },
                  ],
                  edges: [
                    { id: "e1", from: "redis", to: "disk", label: "Fork Write", style: "solid" },
                  ],
                  flow_steps: [
                    { progress_start: 0.1, progress_end: 0.85, active_nodes: ["redis", "disk"], active_edges: ["e1"], badge_text: "BGSAVE", packet_label: "RDB" },
                  ],
                },
              },
            ],
          },
          notes_md: "# Ghi chú bài 01\n- RDB BGSAVE\n",
        };
      }

      llmCalls.push({ stage, model: reqJson.model || null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(contentObj) } }] }));
    });
  });
  await new Promise((resolve) => mockLlmServer.listen(mockLlmPort, "127.0.0.1", resolve));

  const ttsInputsSeen = [];
  const mockTtsPort = await getFreePort();
  const sampleWav = makeToneWavBuffer(0.55, 24000);
  mockTtsServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      const body = raw ? JSON.parse(raw) : {};
      ttsInputsSeen.push(String(body.input || ""));
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": sampleWav.length });
      res.end(sampleWav);
    });
  });
  await new Promise((resolve) => mockTtsServer.listen(mockTtsPort, "127.0.0.1", resolve));

  const tmpVoicesPath = path.join(tmpEngineDir, "voices.json");
  fs.writeFileSync(
    tmpVoicesPath,
    JSON.stringify(
      {
        default_profile: "mock-vi",
        voicestudio_base_url: `http://127.0.0.1:${mockTtsPort}`,
        profiles: [
          {
            id: "mock-vi",
            label: "Mock VieNeu WAV",
            provider: "openai_compat",
            voice_id: "MockVoice",
            endpoint: `http://127.0.0.1:${mockTtsPort}/v1/audio/speech`,
            rate: "1.0",
            pitch: "+0Hz",
            language: "vi",
            response_format: "wav",
          },
        ],
      },
      null,
      2
    )
  );

  // Start Studio Server on free port
  const studioPort = await getFreePort();
  const queueFile = path.join(tmpEngineDir, ".ai_queue.json");
  serverProc = spawn(process.execPath, [path.join(ENGINE_DIR, "server.mjs")], {
    cwd: ENGINE_DIR,
    env: {
      ...process.env,
      PORT: String(studioPort),
      VIDEO_MAKER_WORKSPACE_ROOT: tmpWorkspace,
      VIDEO_MAKER_AI_QUEUE_FILE: queueFile,
      VIDEO_MAKER_AI_CREDENTIALS_FILE: credFile,
      VIDEO_MAKER_AI_PREFERENCES_FILE: prefFile,
      VIDEO_MAKER_VOICES_FILE: tmpVoicesPath,
      VIDEO_MAKER_OPENAI_BASE_URL: `http://127.0.0.1:${mockLlmPort}/v1`,
      VIDEO_MAKER_DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockLlmPort}/v1`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady(studioPort);

  // -------------------------------------------------------------------------
  // 4. Test POST /api/ai/preferences/routing + 3-Stage Pause/Resume Flow
  // -------------------------------------------------------------------------
  console.log("=== 3. 3-Stage Pipeline: pause_after=brief -> Edit -> Dialogue -> Audio-Spine -> Visual ===");
  const routingPost = await httpRequestJson(studioPort, "POST", "/api/ai/preferences/routing", {
    pipeline_routing: {
      brief_scriptwriter: { provider_id: "openai", model: "mock-writer-v1" },
      visual_director: { provider_id: "deepseek", model: "mock-director-v2" },
    },
  });
  assert.equal(routingPost.status, 200);
  assert.equal(routingPost.body.pipeline_routing.visual_director.model, "mock-director-v2");

  // Stage 1 only (pause_after: "brief", even if auto_produce: true was sent -> must be forced false)
  const job1Res = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep01-cache"],
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    mode: "three_stage",
    pause_after: "brief",
    auto_produce: true,
  });
  assert.equal(job1Res.status, 202);
  assert.equal(job1Res.body.job.auto_produce, false, "auto_produce must be forced false when paused at brief");
  const job1Done = await waitForAiJobDone(studioPort, job1Res.body.job.id);
  assert.equal(job1Done.status, "completed");
  assert.equal(job1Done.paused_at, "brief");
  assert.equal(job1Done.spawned_production_jobs.length, 0);

  const epDir = path.join(courseDir, "episodes", "ep01-cache");
  assert.ok(fs.existsSync(path.join(epDir, "brief.json")), "brief.json must exist after Stage 1");
  assert.ok(!fs.existsSync(path.join(epDir, "script.json")), "script.json must NOT exist yet after Stage 1");
  assert.equal(llmCalls.length, 1);
  assert.equal(llmCalls[0].stage, "stage_1_brief");

  // Fetch scripting artifacts & edit brief via REST
  const art1 = await httpRequestJson(studioPort, "GET", "/api/episodes/scripting-artifacts?course=DEMO3&episode=ep01-cache");
  assert.equal(art1.status, 200);
  assert.equal(art1.body.scripting_phase, "brief_ready");
  const editedBrief = {
    ...art1.body.brief,
    hook_angle: {
      ...art1.body.brief.hook_angle,
      conflict_statement: "Pod restart làm bay sạch cache (đã duyệt bởi user).",
    },
  };
  const saveBriefRes = await httpRequestJson(studioPort, "POST", "/api/episodes/brief", {
    course: "DEMO3",
    episode: "ep01-cache",
    brief: editedBrief,
  });
  assert.equal(saveBriefRes.status, 200);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(epDir, "brief.json"), "utf-8")).hook_angle.conflict_statement,
    "Pod restart làm bay sạch cache (đã duyệt bởi user)."
  );

  // Stage 2 only (start_from: "dialogue", pause_after: "dialogue") -> must skip Stage 1!
  const job2Res = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep01-cache"],
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    mode: "three_stage",
    start_from: "dialogue",
    pause_after: "dialogue",
  });
  assert.equal(job2Res.status, 202);
  const job2Done = await waitForAiJobDone(studioPort, job2Res.body.job.id);
  assert.equal(job2Done.status, "completed");
  assert.equal(job2Done.paused_at, "dialogue");
  assert.equal(llmCalls.length, 2, "Stage 1 must NOT re-run when start_from=dialogue");
  assert.equal(llmCalls[1].stage, "stage_2_dialogue");
  assert.ok(fs.existsSync(path.join(epDir, "dialogue.json")), "dialogue.json must exist after Stage 2");
  assert.ok(!fs.existsSync(path.join(epDir, "script.json")), "script.json must NOT exist yet after Stage 2");

  // Edit dialogue via REST
  const art2 = await httpRequestJson(studioPort, "GET", "/api/episodes/scripting-artifacts?course=DEMO3&episode=ep01-cache");
  assert.equal(art2.body.scripting_phase, "dialogue_ready");
  const editedDialogue = { ...art2.body.dialogue };
  editedDialogue.beats[0].tts_text =
    "Khi pod K-8-S khởi động lại, độ trễ vọt từ một trăm bốn mươi mili giây lên cực cao.";
  const saveDialRes = await httpRequestJson(studioPort, "POST", "/api/episodes/dialogue", {
    course: "DEMO3",
    episode: "ep01-cache",
    dialogue: editedDialogue,
    notes_md: art2.body.notes,
  });
  assert.equal(saveDialRes.status, 200);

  // Lock Audio-Spine via POST /api/episodes/audio-spine (uses mock VoiceStudio WAV server)
  const spineRes = await httpRequestJson(studioPort, "POST", "/api/episodes/audio-spine", {
    course: "DEMO3",
    episode: "ep01-cache",
  });
  assert.equal(spineRes.status, 200, JSON.stringify(spineRes.body));
  assert.ok(fs.existsSync(path.join(epDir, "audio_spine.json")), "audio_spine.json must exist");
  assert.equal(spineRes.body.audio_spine.beats.length, 2);
  assert.ok(spineRes.body.audio_spine.total_duration_ms >= 1000);
  // Check Dual-Text sent tts_text (K-8-S) to TTS server, while display_text kept K8s
  assert.ok(ttsInputsSeen[0].includes("K-8-S"), `Expected phonetic K-8-S in TTS input, got: ${ttsInputsSeen[0]}`);
  assert.ok(!ttsInputsSeen[0].includes("K8s"), "Raw K8s should not be sent when tts_text overrides it");
  assert.ok(spineRes.body.audio_spine.beats[0].display_text.includes("K8s"));

  // Stage 3 only (start_from: "visual", pause_after: "none") -> must skip Stages 1 & 2 and route to deepseek/mock-director-v2
  const job3Res = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep01-cache"],
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    mode: "three_stage",
    start_from: "visual",
    pause_after: "none",
  });
  assert.equal(job3Res.status, 202);
  const job3Done = await waitForAiJobDone(studioPort, job3Res.body.job.id);
  assert.equal(job3Done.status, "completed");
  assert.equal(job3Done.paused_at, null);
  assert.equal(llmCalls.length, 3, "Stage 1 & Stage 2 must NOT re-run when start_from=visual");
  assert.equal(llmCalls[2].stage, "stage_3_visual");
  assert.equal(llmCalls[2].model, "mock-director-v2", "Visual Director should resolve dynamic pipeline_routing model");

  const finalScriptPath = path.join(epDir, "script.json");
  assert.ok(fs.existsSync(finalScriptPath), "script.json must exist after Stage 3");
  const compiledScript = JSON.parse(fs.readFileSync(finalScriptPath, "utf-8"));
  assert.equal(compiledScript.scenes.length, 2);
  assert.ok(Array.isArray(compiledScript.scenes[0].tts_beats), "normalizeCompiledScript must preserve tts_beats");
  assert.equal(compiledScript.scenes[0].tts_beats[0].tts_text, editedDialogue.beats[0].tts_text);
  const valRes = validateScriptDiagrams(compiledScript);
  assert.equal(valRes.valid, true, JSON.stringify(valRes.errors));

  // Verify /api/courses exposes new flags cleanly
  const coursesRes = await httpRequestJson(studioPort, "GET", "/api/courses");
  const demoEp = coursesRes.body.courses.find((c) => c.id === "DEMO3")?.episodes?.[0];
  assert.equal(demoEp.has_brief, true);
  assert.equal(demoEp.has_dialogue, true);
  assert.equal(demoEp.has_audio_spine, true);
  assert.equal(demoEp.has_script, true);
  assert.equal(demoEp.scripting_phase, "visual_compiled");
  assert.equal(demoEp.state.overall_status, "script_ready");

  // -------------------------------------------------------------------------
  // 5. Test Dual-Text TTS Episode Synthesis (tts_beats -> tts_text spoken, display_text subtitles)
  // -------------------------------------------------------------------------
  console.log("=== 4. Dual-Text TTS Episode Synthesis ===");
  ttsInputsSeen.length = 0;
  const ttsEpRes = await runCommandAsync(
    "python",
    [
      path.join(ENGINE_DIR, "tts_pipeline.py"),
      "--episode",
      finalScriptPath,
      "--course",
      path.join(courseDir, "course.json"),
      "--voices",
      tmpVoicesPath,
      "--json",
    ],
    { cwd: ENGINE_DIR, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
  );
  assert.equal(ttsEpRes.status, 0, ttsEpRes.stderr || ttsEpRes.stdout);
  const ttsJson = JSON.parse(ttsEpRes.stdout);
  assert.equal(ttsJson.ok, true);
  assert.ok(ttsInputsSeen[0].includes("K-8-S"), "Episode TTS must speak tts_text");
  assert.ok(ttsInputsSeen[1].includes("R-D-B"), "Episode TTS must speak tts_text for scene 2");
  const srtContent = fs.readFileSync(path.join(epDir, "subtitles.srt"), "utf-8");
  assert.ok(srtContent.includes("K8s"), "Subtitles SRT must display technical orthography display_text");
  assert.ok(!srtContent.includes("K-8-S"), "Subtitles SRT must NOT leak phonetic K-8-S");

  console.log("PASS: 3-stage pipeline, dynamic routing, edit endpoints, audio_spine & Dual-Text TTS verified.");
  console.log("\nALL PHASE 1 TESTS PASSED!");
} finally {
  if (serverProc && serverProc.exitCode === null) {
    serverProc.kill();
    await new Promise((r) => {
      serverProc.once("close", r);
      setTimeout(r, 1500);
    });
  }
  if (mockLlmServer) {
    mockLlmServer.closeAllConnections?.();
    await new Promise((r) => mockLlmServer.close(r));
  }
  if (mockTtsServer) {
    mockTtsServer.closeAllConnections?.();
    await new Promise((r) => mockTtsServer.close(r));
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore transient Windows file lock on temp cleanup
  }
}
