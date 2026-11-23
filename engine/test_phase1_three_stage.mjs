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
import {
  createCdpClient,
  resolveChromePath,
  sleep,
  terminateProcess,
} from "./hyperframes/cdp.mjs";
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
  assert.deepEqual([...VALID_PIPELINE_ROLES], [
    "outliner",
    "brief_scriptwriter",
    "content_reviewer",
    "visual_director",
    "repair",
  ]);
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
      content_reviewer: { provider_id: "deepseek", model: "mock-reviewer-v1" },
      visual_director: { provider_id: "deepseek", model: "mock-director-v2" },
    },
    tmpEngineDir
  );
  const loadedPrefs = loadAiPreferences(tmpEngineDir);
  assert.equal(loadedPrefs.pipeline_routing.brief_scriptwriter.provider_id, "openai");
  assert.equal(loadedPrefs.pipeline_routing.content_reviewer.provider_id, "deepseek");
  assert.equal(loadedPrefs.pipeline_routing.content_reviewer.model, "mock-reviewer-v1");
  assert.equal(loadedPrefs.pipeline_routing.visual_director.model, "mock-director-v2");

  // Priority: explicit override > saved pipeline_routing > legacy compiler > job
  const fromSavedReviewer = resolveRoleProvider("content_reviewer", {
    job: { provider_id: "openai", model: "job-model" },
    engineDir: tmpEngineDir,
  });
  assert.equal(fromSavedReviewer.provider_id, "deepseek");
  assert.equal(fromSavedReviewer.model, "mock-reviewer-v1");
  assert.equal(fromSavedReviewer.source, "pipeline_routing");
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
              {
                id: "ep02-multipart",
                number: 2,
                title: "Deep-Dive Redis Persistence & Memory Internals",
                estimated_duration_min: 7,
                estimated_parts: 2,
                must_cover_concepts: ["RDB Copy-on-Write", "Memory Arena", "AOF Rewrite Diff"],
                status: "planned",
              },
            ],
          },
        ],
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(courseDir, "curriculum.md"),
    "# DEMO3\n- ep01-cache: K8s + RDB\n- ep02-multipart: Deep-Dive Redis Persistence & Memory Internals (Part 1 + Part 2)\n"
  );

  const initRes = spawnSync(
    process.execPath,
    [path.join(ENGINE_DIR, "state_cli.mjs"), "init", "--workspace", tmpWorkspace, "--course", "DEMO3"],
    { cwd: ENGINE_DIR, encoding: "utf-8" }
  );
  assert.equal(initRes.status, 0, initRes.stderr);

  const llmCalls = [];
  let ep02Part01ReviewCount = 0;
  const mockLlmPort = await getFreePort();
  mockLlmServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      const reqJson = rawBody ? JSON.parse(rawBody) : {};
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "mock-writer-v1" }, { id: "mock-reviewer-v1" }, { id: "mock-director-v2" }],
          })
        );
        return;
      }
      if (req.url.endsWith("/user/balance")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ is_available: true, balance_infos: [{ total_balance: "10.00", currency: "USD" }] }));
        return;
      }
      const sysPrompt = String(reqJson.messages?.find((m) => m.role === "system")?.content || "");
      const userPrompt = String(reqJson.messages?.find((m) => m.role === "user")?.content || "");
      const isEp02 =
        userPrompt.includes("- Episode ID: ep02-multipart") ||
        userPrompt.includes('"episode_id": "ep02-multipart"');
      const isPart02 = /part_02/i.test(userPrompt) && !/part_01/i.test(userPrompt.split("# Part")[0] || "");
      const messageCount = Array.isArray(reqJson.messages) ? reqJson.messages.length : 0;
      let stage = "unknown";
      let contentObj = {};
      let sawRewrite = false;
      let sawHandoff = false;

      if (sysPrompt.includes("Stage 1.5: Brief Gate")) {
        stage = "stage_1_brief_review";
        assert.equal(messageCount, 2, "Stage 1.5 Brief Reviewer must run in fresh context (2 messages)");
        contentObj = {
          review: {
            verdict: "APPROVED",
            score: 94,
            summary: "Master brief APPROVED with clear parts and proof anchors.",
            strengths: ["Part budgets <= 300s", "Concrete CLI proof anchors"],
            blocker_issues: [],
            major_issues: [],
            minor_issues: [],
            rewrite_instructions: "",
          },
        };
      } else if (sysPrompt.includes("Stage 1: Content Brief")) {
        stage = "stage_1_brief";
        assert.ok(sysPrompt.includes("STRICT PROHIBITION: Do NOT mention visual templates"));
        if (isEp02) {
          contentObj = {
            brief: {
              course_id: "DEMO3",
              episode_id: "ep02-multipart",
              episode_number: 2,
              title: "Deep-Dive Redis Persistence & Memory Internals",
              subtitle: "Copy-on-Write, Memory Arena & AOF Rewrite",
              hook_angle: {
                family: "deep_mechanism",
                conflict_statement: "Tại sao BGSAVE làm RAM tăng gấp đôi dù Redis chỉ 4GB?",
                stakes: "OOM killer giết container giữa giờ cao điểm.",
              },
              narrative_arc: {
                setup: "Fork tiến trình chia sẻ page table.",
                escalation: "Client ghi dữ liệu kích hoạt Copy-on-Write trên RAM.",
                reversal: "Định cỡ memory overhead & cấu hình AOF rewrite an toàn.",
              },
              episode_canon: {
                shared_glossary: ["Copy-on-Write", "Page Table", "AOF Rewrite"],
                running_example: "Redis 4GB cache node xử lý 20k RPS",
                target_audience_assumptions: "Backend/SRE nắm cơ bản Redis SET/GET",
              },
              parts: [
                {
                  part_id: "part_01",
                  title: "Part 1: Fork & Copy-on-Write Memory Trace",
                  target_duration_sec: 180,
                  must_cover: ["RDB Copy-on-Write", "Memory Arena"],
                  entry_bridge: "",
                  exit_bridge: "Handoff từ Part 1: Đã thấy page 4KB nhân bản khi ghi — Part 2 đi sâu AOF rewrite diff.",
                  teaching_beats: [
                    {
                      id: "b1_1",
                      part: "architecture",
                      goal: "Trace fork handshake giữa Parent và Child",
                      key_claim: "Parent chỉ copy page table chứ chưa copy data ngay",
                      concrete_proof_anchor: "fork() page table share + RDB ACK",
                    },
                    {
                      id: "b1_2",
                      part: "architecture",
                      goal: "Trace memory page mutation",
                      key_claim: "Khi write chạm page 0x10, kernel copy page mới",
                      concrete_proof_anchor: "4KB page allocation at 0x10",
                    },
                  ],
                },
                {
                  part_id: "part_02",
                  title: "Part 2: AOF Rewrite Diff & Production Guardrails",
                  target_duration_sec: 210,
                  must_cover: ["AOF Rewrite Diff"],
                  entry_bridge: "Tiếp nối trực tiếp trace Copy-on-Write ở Part 1",
                  exit_bridge: "",
                  teaching_beats: [
                    {
                      id: "b2_1",
                      part: "setup",
                      goal: "So sánh cấu hình AOF an toàn",
                      key_claim: "Bật no-appendfsync-on-rewrite giảm stall disk I/O",
                      concrete_proof_anchor: "no-appendfsync-on-rewrite yes",
                    },
                    {
                      id: "b2_2",
                      part: "exam_tips",
                      goal: "Tổng kết 2 nguyên tắc chống OOM",
                      key_claim: "Giữ headroom >= 50% RAM cho CoW + theo dõi rdb_last_cow_size",
                      concrete_proof_anchor: "INFO persistence -> rdb_last_cow_size",
                    },
                  ],
                },
              ],
            },
          };
        } else {
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
        }
      } else if (sysPrompt.includes("Stage 2.5")) {
        stage = "stage_2_content_review";
        assert.equal(messageCount, 2, "Stage 2.5 Content Reviewer must run in fresh context (2 messages, zero writer history)");
        const reviewingPart2 = userPrompt.includes('"part_id": "part_02"') || userPrompt.includes("part_02 — Part 2");
        if (isEp02 && !reviewingPart2) {
          ep02Part01ReviewCount += 1;
          if (ep02Part01ReviewCount === 1) {
            contentObj = {
              review: {
                verdict: "REVISE",
                score: 62,
                summary: "Beat b1_2 thiếu địa chỉ byte offset cụ thể trong trace.",
                strengths: ["Handoff rõ ràng"],
                blocker_issues: [
                  {
                    beat_id: "b1_2",
                    category: "concrete_proof",
                    issue: "Chưa nêu rõ byte offset 0x00 -> 0x10 trong lời thoại.",
                  },
                ],
                major_issues: [],
                minor_issues: [],
                rewrite_instructions: "Bổ sung trace byte offset cụ thể 0x00 -> 0x10 cho beat b1_2.",
              },
            };
          } else {
            contentObj = {
              review: {
                verdict: "APPROVED",
                score: 96,
                summary: "Đã bổ sung byte offset 0x00 -> 0x10 đầy đủ, Dual-Text an toàn.",
                strengths: ["Trace rõ từng byte offset", "Dual-Text sạch"],
                blocker_issues: [],
                major_issues: [],
                minor_issues: [],
                rewrite_instructions: "",
              },
            };
          }
        } else {
          contentObj = {
            review: {
              verdict: "APPROVED",
              score: 93,
              summary: "Dialogue APPROVED.",
              strengths: ["Dual-Text clean", "No fluff"],
              blocker_issues: [],
              major_issues: [],
              minor_issues: [],
              rewrite_instructions: "",
            },
          };
        }
      } else if (sysPrompt.includes("Stage 2: Dialogue & TTS Beats")) {
        stage = "stage_2_dialogue";
        assert.ok(sysPrompt.includes("STRICT PROHIBITION: Do NOT choose visual templates"));
        if (isEp02) {
          const targetingPart2 =
            userPrompt.includes("# Target Part Spec (part_02") || sysPrompt.includes("**part_02**");
          if (targetingPart2) {
            sawHandoff =
              userPrompt.includes("# Previous Part Handoff") &&
              userPrompt.includes("Handoff từ Part 1");
            contentObj = {
              dialogue: {
                course_id: "DEMO3",
                episode_id: "ep02-multipart",
                part_id: "part_02",
                title: "Part 2: AOF Rewrite Diff & Production Guardrails",
                beats: [
                  {
                    beat_id: "b2_1",
                    part: "setup",
                    scene_group: "scene_03_diff",
                    scene_title: "So sánh cấu hình AOF Rewrite",
                    spoken_purpose: "Chỉ ra cấu hình chống nghẽn fsync",
                    on_screen_fact: "no-appendfsync-on-rewrite yes",
                    display_text: "Chuyển no-appendfsync-on-rewrite sang yes để tránh block parent.",
                    tts_text: "Chuyển cấu hình chống block parent trong lúc A-O-F rewrite.",
                    highlight_words: ["no-appendfsync-on-rewrite", "AOF"],
                  },
                  {
                    beat_id: "b2_2",
                    part: "exam_tips",
                    scene_group: "scene_04_breakdown",
                    scene_title: "Tổng kết 2 nguyên tắc chống OOM",
                    spoken_purpose: "Khắc sâu headroom 50% và metric theo dõi",
                    on_screen_fact: "Headroom 50% + rdb_last_cow_size",
                    display_text: "Luôn giữ 50% RAM trống và đo rdb_last_cow_size qua INFO.",
                    tts_text: "Luôn giữ năm mươi phần trăm RAM trống và đo thông số cow size.",
                    highlight_words: ["RAM", "50%", "rdb_last_cow_size"],
                  },
                ],
              },
              notes_md: "# Part 2: AOF Rewrite & Guardrails\n- Bật `no-appendfsync-on-rewrite yes`\n- Giám sát `rdb_last_cow_size`\n",
            };
          } else {
            sawRewrite = userPrompt.includes("Bổ sung trace byte offset");
            contentObj = {
              dialogue: {
                course_id: "DEMO3",
                episode_id: "ep02-multipart",
                part_id: "part_01",
                title: "Part 1: Fork & Copy-on-Write Memory Trace",
                beats: [
                  {
                    beat_id: "b1_1",
                    part: "architecture",
                    scene_group: "scene_01_seq",
                    scene_title: "Fork handshake giữa Parent và Child",
                    spoken_purpose: "Giải thích parent chia sẻ page table với child",
                    on_screen_fact: "Parent -> Fork -> Child (Shared Page Table)",
                    display_text: "Khi chạy BGSAVE, tiến trình parent gọi fork sang child với bảng page chung.",
                    tts_text: "Khi chạy B-G-SAVE, tiến trình cha gọi fork sang tiến trình con với bảng page chung.",
                    highlight_words: ["BGSAVE", "fork"],
                  },
                  {
                    beat_id: "b1_2",
                    part: "architecture",
                    scene_group: "scene_02_mem",
                    scene_title: "Trace Copy-on-Write theo byte offset",
                    spoken_purpose: "Chứng minh kernel cấp phát page mới khi ghi",
                    on_screen_fact: "0x00 -> 0x10 Copy-on-Write 4KB",
                    display_text: sawRewrite
                      ? "Khi client ghi ở offset 0x00 tới 0x10, kernel tách trang nhớ mới."
                      : "Khi client ghi dữ liệu, kernel tách một trang nhớ mới cho tiến trình cha.",
                    tts_text: sawRewrite
                      ? "Khi client ghi ở vị trí không xê không không tới không xê một không, kernel tách trang nhớ mới."
                      : "Khi client ghi dữ liệu, kernel tách một trang nhớ mới cho tiến trình cha.",
                    highlight_words: ["0x00", "0x10", "kernel"],
                  },
                ],
              },
              notes_md: "# Part 1: Copy-on-Write\n- Fork chia sẻ Page Table\n- Trace `0x00 -> 0x10`\n",
            };
          }
        } else {
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
        }
      } else if (sysPrompt.includes("Visual Director & Motion Compiler (Stage 3)")) {
        stage = "stage_3_visual";
        if (isEp02) {
          const targetingPart2 = userPrompt.includes("b2_1") || /Target Part.*part_02/i.test(userPrompt);
          if (targetingPart2) {
            contentObj = {
              script_json: {
                course_id: "DEMO3",
                episode_id: "ep02-multipart",
                title: "Part 2: AOF Rewrite Diff & Production Guardrails",
                scenes: [
                  {
                    id: "scene_03_diff",
                    part: "setup",
                    title: "So sánh cấu hình AOF Rewrite",
                    visual_job: "Action",
                    world_theme: "dark",
                    causal_mechanic: "width-push",
                    visual_type: "code_diff",
                    narration: "Chuyển no-appendfsync-on-rewrite sang yes để tránh block parent.",
                    tts_beats: [
                      {
                        beat_id: "b2_1",
                        display_text: "Chuyển no-appendfsync-on-rewrite sang yes để tránh block parent.",
                        tts_text: "Chuyển cấu hình chống block parent trong lúc A-O-F rewrite.",
                      },
                    ],
                    visual_data: {
                      language: "ini",
                      left_title: "Unsafe Default",
                      right_title: "Production Safe",
                      left_lines: ["appendfsync everysec", "no-appendfsync-on-rewrite no"],
                      right_lines: ["appendfsync everysec", "no-appendfsync-on-rewrite yes"],
                      focus_steps: [
                        {
                          callout: "Bật yes để tránh block I/O khi rewrite",
                          left_lines: [2],
                          right_lines: [2],
                          progress_start: 0.1,
                          progress_end: 0.9,
                          tone: "success",
                        },
                      ],
                    },
                  },
                  {
                    id: "scene_04_breakdown",
                    part: "exam_tips",
                    title: "Tổng kết 2 nguyên tắc chống OOM",
                    visual_job: "Transition",
                    world_theme: "light",
                    causal_mechanic: "squash-drop",
                    visual_type: "concept_breakdown",
                    narration: "Luôn giữ 50% RAM trống và đo rdb_last_cow_size qua INFO.",
                    tts_beats: [
                      {
                        beat_id: "b2_2",
                        display_text: "Luôn giữ 50% RAM trống và đo rdb_last_cow_size qua INFO.",
                        tts_text: "Luôn giữ năm mươi phần trăm RAM trống và đo thông số cow size.",
                      },
                    ],
                    visual_data: {
                      core: { label: "Chống OOM CoW", sublabel: "2 Invariants" },
                      branches: [
                        { id: "br1", label: "Headroom 50%", detail: "Chừa RAM cho dirty pages", metric: ">= 50%", progress_start: 0.1, progress_end: 0.5 },
                        { id: "br2", label: "Metric Cow", detail: "Đo rdb_last_cow_size sau fork", metric: "INFO", progress_start: 0.5, progress_end: 0.9 },
                      ],
                      takeaway: { text: "Đo rdb_last_cow_size sau mỗi lần BGSAVE", show_at_progress: 0.78 },
                    },
                  },
                ],
              },
              notes_md: "# Part 2: AOF Rewrite & Guardrails\n- Bật `no-appendfsync-on-rewrite yes`\n- Giám sát `rdb_last_cow_size`\n",
            };
          } else {
            contentObj = {
              script_json: {
                course_id: "DEMO3",
                episode_id: "ep02-multipart",
                title: "Part 1: Fork & Copy-on-Write Memory Trace",
                scenes: [
                  {
                    id: "scene_01_seq",
                    part: "architecture",
                    title: "Fork handshake giữa Parent và Child",
                    visual_job: "Mechanism",
                    world_theme: "dark",
                    causal_mechanic: "wire-draw",
                    visual_type: "sequence_diagram",
                    narration: "Khi chạy BGSAVE, tiến trình parent gọi fork sang child với bảng page chung.",
                    tts_beats: [
                      {
                        beat_id: "b1_1",
                        display_text: "Khi chạy BGSAVE, tiến trình parent gọi fork sang child với bảng page chung.",
                        tts_text: "Khi chạy B-G-SAVE, tiến trình cha gọi fork sang tiến trình con với bảng page chung.",
                      },
                    ],
                    visual_data: {
                      actors: [
                        { id: "parent", label: "Parent" },
                        { id: "child", label: "Child" },
                      ],
                      messages: [
                        { id: "m1", from: "parent", to: "child", label: "fork()", kind: "sync", progress_start: 0.1, progress_end: 0.5 },
                        { id: "m2", from: "child", to: "parent", label: "CoW Shared", kind: "return", progress_start: 0.55, progress_end: 0.9 },
                      ],
                      highlights: [{ label: "Page Table Shared", message_ids: ["m1", "m2"], show_at_progress: 0.45, tone: "info" }],
                    },
                  },
                  {
                    id: "scene_02_mem",
                    part: "architecture",
                    title: "Trace Copy-on-Write theo byte offset",
                    visual_job: "Proof",
                    world_theme: "light",
                    causal_mechanic: "arc-emission",
                    visual_type: "memory_layout",
                    narration: "Khi client ghi ở offset 0x00 tới 0x10, kernel tách trang nhớ mới.",
                    tts_beats: [
                      {
                        beat_id: "b1_2",
                        display_text: "Khi client ghi ở offset 0x00 tới 0x10, kernel tách trang nhớ mới.",
                        tts_text: "Khi client ghi ở vị trí không xê không không tới không xê một không, kernel tách trang nhớ mới.",
                      },
                    ],
                    visual_data: {
                      lanes: [
                        {
                          id: "ram",
                          label: "Physical RAM",
                          cells: [
                            { id: "p0", label: "0x00 Base", state: "idle" },
                            { id: "p1", label: "0x10 New", state: "write" },
                          ],
                        },
                      ],
                      steps: [
                        {
                          label: "Kernel allocate 0x10",
                          progress_start: 0.1,
                          progress_end: 0.85,
                          highlight_cells: [{ lane_id: "ram", cell_id: "p1", state: "write" }],
                          pointers: [{ label: "COW", from_lane: "ram", from_cell: "p0", to_lane: "ram", to_cell: "p1", color: "#2563EB" }],
                        },
                      ],
                    },
                  },
                ],
              },
              notes_md: "# Part 1: Copy-on-Write\n- Fork chia sẻ Page Table\n- Trace `0x00 -> 0x10`\n",
            };
          }
        } else {
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
      }

      llmCalls.push({
        stage,
        model: reqJson.model || null,
        messageCount,
        sawRewrite,
        sawHandoff,
        ep: isEp02 ? "ep02-multipart" : "ep01-cache",
      });
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
  console.log("=== 3. Deep-Course Pipeline: pause_after=brief -> Edit -> Dialogue -> Audio-Spine -> Visual ===");
  const routingPost = await httpRequestJson(studioPort, "POST", "/api/ai/preferences/routing", {
    pipeline_routing: {
      brief_scriptwriter: { provider_id: "openai", model: "mock-writer-v1" },
      content_reviewer: { provider_id: "deepseek", model: "mock-reviewer-v1" },
      visual_director: { provider_id: "deepseek", model: "mock-director-v2" },
    },
  });
  assert.equal(routingPost.status, 200);
  assert.equal(routingPost.body.pipeline_routing.content_reviewer.model, "mock-reviewer-v1");
  assert.equal(routingPost.body.pipeline_routing.visual_director.model, "mock-director-v2");

  // Stage 1 only (pause_after: "brief", even if auto_produce: true was sent -> must be forced false)
  const job1Res = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep01-cache"],
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    mode: "deep_course",
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
  assert.ok(fs.existsSync(path.join(epDir, "brief_review.md")), "brief_review.md must exist after Stage 1.5");
  assert.ok(!fs.existsSync(path.join(epDir, "script.json")), "script.json must NOT exist yet after Stage 1");
  assert.equal(llmCalls.length, 2);
  assert.equal(llmCalls[0].stage, "stage_1_brief");
  assert.equal(llmCalls[1].stage, "stage_1_brief_review");
  assert.equal(llmCalls[1].model, "mock-reviewer-v1");

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

  // Stage 2 only (start_from: "dialogue", pause_after: "dialogue") -> must skip Stage 1 & pause before Stage 2.5/3!
  const job2Res = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep01-cache"],
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    mode: "deep_course",
    start_from: "dialogue",
    pause_after: "dialogue",
  });
  assert.equal(job2Res.status, 202);
  const job2Done = await waitForAiJobDone(studioPort, job2Res.body.job.id);
  assert.equal(job2Done.status, "completed");
  assert.equal(job2Done.paused_at, "dialogue");
  assert.equal(llmCalls.length, 3, "Stage 1 must NOT re-run when start_from=dialogue");
  assert.equal(llmCalls[2].stage, "stage_2_dialogue");
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
    mode: "deep_course",
    start_from: "visual",
    pause_after: "none",
  });
  assert.equal(job3Res.status, 202);
  const job3Done = await waitForAiJobDone(studioPort, job3Res.body.job.id);
  assert.equal(job3Done.status, "completed");
  assert.equal(job3Done.paused_at, null);
  assert.equal(llmCalls.length, 4, "Stage 1 & Stage 2 must NOT re-run when start_from=visual");
  assert.equal(llmCalls[3].stage, "stage_3_visual");
  assert.equal(llmCalls[3].model, "mock-director-v2", "Visual Director should resolve dynamic pipeline_routing model");

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
  const demoEp = coursesRes.body.courses.find((c) => c.id === "DEMO3")?.episodes?.find((e) => e.id === "ep01-cache");
  assert.equal(demoEp.has_brief, true);
  assert.equal(demoEp.has_dialogue, true);
  assert.equal(demoEp.has_audio_spine, true);
  assert.equal(demoEp.has_script, true);
  assert.equal(demoEp.scripting_phase, "visual_compiled");
  assert.equal(demoEp.state.overall_status, "script_ready");

  // -------------------------------------------------------------------------
  // 5. Test Audio-Spine Beat Reuse (0 duplicate TTS calls!)
  // -------------------------------------------------------------------------
  console.log("=== 4. Audio-Spine Beat Reuse & Dual-Text Subtitles ===");
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
  assert.equal(ttsJson.reused_scenes, 2, "process_episode() must reuse both locked audio_spine.json scenes");
  assert.equal(ttsInputsSeen.length, 0, "Audio-Spine beat reuse must make 0 duplicate TTS requests");
  const srtContent = fs.readFileSync(path.join(epDir, "subtitles.srt"), "utf-8");
  assert.ok(srtContent.includes("K8s"), "Subtitles SRT must display technical orthography display_text");
  assert.ok(!srtContent.includes("K-8-S"), "Subtitles SRT must NOT leak phonetic K-8-S");
  console.log("PASS: Deep-course single-part gates, dynamic routing, audio_spine beat reuse (0 duplicate TTS calls) & Dual-Text verified.");

  // -------------------------------------------------------------------------
  // 5B. Multi-Part Deep-Dive + Fresh Content Reviewer (REVISE -> APPROVED) + Merge
  // -------------------------------------------------------------------------
  console.log("=== 4B. Multi-Part Deep-Course + Content Reviewer Loop + Part Merge ===");
  const ep2Dir = path.join(courseDir, "episodes", "ep02-multipart");
  const llmStartIdx = llmCalls.length;
  const mpPartReviewJobRes = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep02-multipart"],
    part_id: "part_01",
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    mode: "deep_course",
    pause_after: "part_review",
    auto_produce: true,
  });
  assert.equal(mpPartReviewJobRes.status, 202);
  assert.equal(mpPartReviewJobRes.body.job.auto_produce, false, "auto_produce must be forced false at part_review gate");
  const mpPartReviewDone = await waitForAiJobDone(studioPort, mpPartReviewJobRes.body.job.id, 20_000);
  assert.equal(mpPartReviewDone.status, "completed");
  assert.equal(mpPartReviewDone.paused_at, "part_review");
  assert.equal(mpPartReviewDone.spawned_production_jobs.length, 0);

  const ep2Stage1And2Calls = llmCalls.slice(llmStartIdx);
  // Expect Stage 1 (brief) -> Stage 1.5 (brief_review) -> part_01 Stage 2 r1 -> Stage 2.5 r1 (REVISE) -> Stage 2 r2 -> Stage 2.5 r2 (APPROVED)
  assert.ok(ep02Part01ReviewCount === 2, `Expected 2 content_reviewer rounds for part_01, got ${ep02Part01ReviewCount}`);
  assert.ok(ep2Stage1And2Calls.some((c) => c.stage === "stage_2_dialogue" && c.sawRewrite), "Stage 2 round 2 must receive reviewer rewrite_instructions");
  assert.ok(fs.existsSync(path.join(ep2Dir, "brief_review.md")));
  assert.ok(fs.existsSync(path.join(ep2Dir, "parts", "part_01", "review.md")));
  assert.match(fs.readFileSync(path.join(ep2Dir, "parts", "part_01", "review.md"), "utf-8"), /Verdict:\s*APPROVED/i);
  assert.ok(!fs.existsSync(path.join(ep2Dir, "parts", "part_01", "script.json")), "part_01 script.json must NOT exist before visual stage when paused at part_review");

  // Compile part_01 (visual stage only), then generate & compile part_02 (verify handoff!)
  const mpP1VisRes = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep02-multipart"],
    part_id: "part_01",
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    start_from: "visual",
    pause_after: "none",
  });
  assert.equal(mpP1VisRes.status, 202);
  const mpP1VisDone = await waitForAiJobDone(studioPort, mpP1VisRes.body.job.id);
  assert.equal(mpP1VisDone.status, "completed");

  const llmBeforeP2 = llmCalls.length;
  const mpP2Res = await httpRequestJson(studioPort, "POST", "/api/ai/jobs", {
    type: "script_episode",
    course: "DEMO3",
    episode_ids: ["ep02-multipart"],
    part_id: "part_02",
    provider_id: "openai",
    model: "mock-writer-v1",
    execution_mode: "builtin",
    start_from: "dialogue",
    pause_after: "none",
  });
  assert.equal(mpP2Res.status, 202);
  const mpP2Done = await waitForAiJobDone(studioPort, mpP2Res.body.job.id);
  assert.equal(mpP2Done.status, "completed");
  const p2Calls = llmCalls.slice(llmBeforeP2);
  assert.ok(p2Calls.some((c) => c.stage === "stage_2_dialogue" && c.sawHandoff), "part_02 Stage 2 must receive previousPartHandoff from part_01");

  // Synthesize TTS on both parts (also testing cue alignment across the 4 new templates!)
  ttsInputsSeen.length = 0;
  for (const partId of ["part_01", "part_02"]) {
    const partScriptPath = path.join(ep2Dir, "parts", partId, "script.json");
    assert.ok(fs.existsSync(partScriptPath), `Missing ${partId}/script.json`);
    const partTts = await runCommandAsync(
      "python",
      [
        path.join(ENGINE_DIR, "tts_pipeline.py"),
        "--episode",
        partScriptPath,
        "--course",
        path.join(courseDir, "course.json"),
        "--voices",
        tmpVoicesPath,
        "--json",
      ],
      { cwd: ENGINE_DIR, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
    );
    assert.equal(partTts.status, 0, partTts.stderr || partTts.stdout);
    const partTtsJson = JSON.parse(partTts.stdout);
    assert.equal(partTtsJson.ok, true);
  }
  assert.equal(ttsInputsSeen.length, 4, "4 fresh scenes across part_01 + part_02 should synthesize 4 TTS calls");
  assert.ok(ttsInputsSeen.some((s) => s.includes("B-G-SAVE")), "sequence_diagram scene must speak tts_text");
  assert.ok(ttsInputsSeen.some((s) => s.includes("không xê một không")), "memory_layout scene must speak tts_text");
  assert.ok(ttsInputsSeen.some((s) => s.includes("A-O-F rewrite")), "code_diff scene must speak tts_text");

  const p1Aligned = JSON.parse(fs.readFileSync(path.join(ep2Dir, "parts", "part_01", "script.json"), "utf-8"));
  const p2Aligned = JSON.parse(fs.readFileSync(path.join(ep2Dir, "parts", "part_02", "script.json"), "utf-8"));
  assert.ok(Number.isFinite(p1Aligned.scenes[0].visual_data.messages[0].progress_start), "sequence_diagram cues aligned");
  assert.ok(Number.isFinite(p1Aligned.scenes[1].visual_data.steps[0].progress_start), "memory_layout cues aligned");
  assert.ok(Number.isFinite(p2Aligned.scenes[0].visual_data.focus_steps[0].progress_start), "code_diff cues aligned");
  assert.ok(Number.isFinite(p2Aligned.scenes[1].visual_data.branches[0].progress_start), "concept_breakdown cues aligned");

  // Verify state_cli parts, set-part --approved true, and merge-parts
  const partsCliRes = spawnSync(
    process.execPath,
    [path.join(ENGINE_DIR, "state_cli.mjs"), "parts", "--workspace", tmpWorkspace, "--course", "DEMO3", "--ep", "ep02-multipart", "--json"],
    { cwd: ENGINE_DIR, encoding: "utf-8" }
  );
  assert.equal(partsCliRes.status, 0, partsCliRes.stderr);
  const partsInfo = JSON.parse(partsCliRes.stdout);
  assert.equal(partsInfo.parts.length, 2);

  for (const partId of ["part_01", "part_02"]) {
    const approveCli = spawnSync(
      process.execPath,
      [
        path.join(ENGINE_DIR, "state_cli.mjs"),
        "set-part",
        "--workspace",
        tmpWorkspace,
        "--course",
        "DEMO3",
        "--ep",
        "ep02-multipart",
        "--part",
        partId,
        "--status",
        "completed",
        "--ai-verdict",
        "APPROVED",
        "--approved",
        "true",
        "--json",
      ],
      { cwd: ENGINE_DIR, encoding: "utf-8" }
    );
    assert.equal(approveCli.status, 0, approveCli.stderr);
  }

  const mergeCli = spawnSync(
    process.execPath,
    [path.join(ENGINE_DIR, "state_cli.mjs"), "merge-parts", "--workspace", tmpWorkspace, "--course", "DEMO3", "--ep", "ep02-multipart", "--json"],
    { cwd: ENGINE_DIR, encoding: "utf-8" }
  );
  assert.equal(mergeCli.status, 0, mergeCli.stderr || mergeCli.stdout);
  const mergeSummary = JSON.parse(mergeCli.stdout);
  assert.deepEqual(mergeSummary.parts_merged, ["part_01", "part_02"]);
  assert.equal(mergeSummary.scene_count, 4);
  assert.equal(mergeSummary.tts_done, true, "merge-parts must set production.tts_done = true when all parts have audio");

  const mergedScript = JSON.parse(fs.readFileSync(path.join(ep2Dir, "script.json"), "utf-8"));
  assert.equal(mergedScript.scenes.length, 4);
  assert.ok(mergedScript.scenes[0].id.startsWith("part_01_"), `Expected part_01_ prefix, got ${mergedScript.scenes[0].id}`);
  assert.ok(mergedScript.scenes[2].id.startsWith("part_02_"), `Expected part_02_ prefix, got ${mergedScript.scenes[2].id}`);
  assert.ok(mergedScript.scenes[0].audio_file.startsWith("parts/part_01/audio/"), mergedScript.scenes[0].audio_file);
  assert.ok(mergedScript.scenes[2].audio_file.startsWith("parts/part_02/audio/"), mergedScript.scenes[2].audio_file);

  const mergedSrt = fs.readFileSync(path.join(ep2Dir, "subtitles.srt"), "utf-8");
  assert.ok(mergedSrt.includes("BGSAVE") && mergedSrt.includes("rdb_last_cow_size"));
  assert.ok(!mergedSrt.includes("00:00:00,000 -->") || mergedSrt.includes("00:00:01,"), "Cumulative SRT offsets expected after part_01");
  const mergedNotes = fs.readFileSync(path.join(ep2Dir, "notes.md"), "utf-8");
  assert.ok(mergedNotes.includes("Part 1") && mergedNotes.includes("Part 2"));

  const ep2StateAfterMerge = JSON.parse(fs.readFileSync(path.join(courseDir, "state", "ep02-multipart.json"), "utf-8"));
  assert.equal(ep2StateAfterMerge.overall_status, "script_ready");
  assert.equal(ep2StateAfterMerge.production.tts_done, true);
  console.log("PASS: Multi-part deep_course, fresh content_reviewer loop (REVISE -> APPROVED), handoff, cue alignment & merge-parts verified.");

  // -------------------------------------------------------------------------
  // 6. Phase 3.1 Headless Chrome UI Verification: Per-Role Provider Routing UI
  // -------------------------------------------------------------------------
  console.log("=== 5. Phase 3.1 + V2 Headless Chrome UI: 5-Role RoleRoutingPanel & ScriptingStageModal ===");
  const resetInit = await httpRequestJson(studioPort, "POST", "/api/ai/preferences/routing", {
    pipeline_routing: {
      outliner: null,
      brief_scriptwriter: null,
      content_reviewer: null,
      visual_director: null,
      repair: null,
    },
  });
  assert.equal(resetInit.status, 200);

  const chromePath = resolveChromePath();
  const cdpPort = await getFreePort();
  const chromeUserDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-phase31-chrome-"));
  const chromeProc = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu-sandbox",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${chromeUserDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  let cdp = null;
  try {
    const deadline = Date.now() + 12_000;
    let wsUrl = null;
    while (Date.now() < deadline) {
      try {
        const listRes = await httpRequestJson(cdpPort, "GET", "/json/list");
        const target = Array.isArray(listRes.body)
          ? listRes.body.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
          : null;
        if (target?.webSocketDebuggerUrl) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // waiting for Chrome CDP endpoint
      }
      await sleep(120);
    }
    assert.ok(wsUrl, "Chrome CDP WebSocket URL unavailable");

    cdp = createCdpClient(wsUrl);
    await cdp.openPromise;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const consoleErrors = [];
    const pageExceptions = [];
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") {
        consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
      }
    });
    cdp.on("Runtime.exceptionThrown", (p) => {
      pageExceptions.push(
        p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Uncaught page exception"
      );
    });

    const loadedPromise = new Promise((resolve) => {
      cdp.on("Page.loadEventFired", () => resolve());
      setTimeout(resolve, 6000);
    });
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${studioPort}/?view=roadmap&course=DEMO3`,
    });
    await loadedPromise;

    const evalBrowser = async (expr) => {
      const res = await cdp.send("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res?.exceptionDetails) {
        throw new Error(`Browser eval failed: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res?.result?.value;
    };

    // Step 6A: Open AI Worker drawer, expand RoleRoutingPanel, set brief_scriptwriter & visual_director, save
    const roadmapSaveRes = await evalBrowser(`(async () => {
      const waitFor = async (fn, msg, timeoutMs = 10000) => {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
          const v = fn();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 80));
        }
        throw new Error('Timeout waiting for: ' + msg);
      };

      const setSelectValue = (sel, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, val);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const workerPill = await waitFor(
        () => {
          const el = document.querySelector('.worker-status-pill');
          return el && /sẵn sàng|Online/.test(el.textContent || '') ? el : null;
        },
        'worker-status-pill ready'
      );
      workerPill.click();

      const drawer = await waitFor(() => document.querySelector('.provider-drawer-panel'), 'provider-drawer-panel');
      const panel = await waitFor(() => drawer.querySelector('[data-testid="role-routing-panel"]'), 'role-routing-panel');
      const toggle = panel.querySelector('[data-testid="role-routing-toggle"]');
      if (!toggle) throw new Error('role-routing-toggle missing');

      const initialPillText = panel.querySelector('[data-testid="role-routing-count-pill"]')?.textContent?.trim() || '';
      const initiallyCollapsed = !panel.querySelector('[data-testid="role-routing-body"]');

      toggle.click();
      const body = await waitFor(() => panel.querySelector('[data-testid="role-routing-body"]'), 'role-routing-body');
      const rows = Array.from(body.querySelectorAll('[data-role]')).map((r) => r.getAttribute('data-role'));

      const writerProvSel = body.querySelector('[data-role-provider="brief_scriptwriter"]');
      const writerOptions = Array.from(writerProvSel.options).map((o) => ({ value: o.value, text: o.textContent }));
      const hasAntigravityOpt = writerOptions.some((o) => o.value === 'antigravity');
      const hasManualOpt = writerOptions.some((o) => o.value === 'manual_web');
      const firstOptText = writerOptions[0]?.text || '';

      setSelectValue(writerProvSel, 'openai');
      const writerModelSel = await waitFor(() => {
        const s = body.querySelector('[data-role-model="brief_scriptwriter"]');
        return s && Array.from(s.options).some((o) => o.value === 'mock-writer-v1') ? s : null;
      }, 'openai models populated');
      setSelectValue(writerModelSel, 'mock-writer-v1');

      const dirProvSel = body.querySelector('[data-role-provider="visual_director"]');
      setSelectValue(dirProvSel, 'deepseek');
      const dirModelSel = await waitFor(() => {
        const s = body.querySelector('[data-role-model="visual_director"]');
        return s && Array.from(s.options).some((o) => o.value === 'mock-director-v2') ? s : null;
      }, 'deepseek models populated');
      setSelectValue(dirModelSel, 'mock-director-v2');

      const saveBtn = body.querySelector('[data-testid="role-routing-save"]');
      saveBtn.click();

      const feedback = await waitFor(
        () => panel.querySelector('[data-testid="role-routing-feedback"].is-ok'),
        'save success feedback'
      );
      const savedPillText = panel.querySelector('[data-testid="role-routing-count-pill"]')?.textContent?.trim() || '';

      // Collapse to confirm summary chips stay visible when collapsed
      toggle.click();
      await waitFor(() => !panel.querySelector('[data-testid="role-routing-body"]'), 'collapsed after save');
      const collapsedChips = Array.from(panel.querySelectorAll('.role-routing-chip')).map((c) => c.textContent.trim());

      // Expand again and verify zero horizontal overflow in Roadmap drawer
      toggle.click();
      await waitFor(() => panel.querySelector('[data-testid="role-routing-body"]'), 're-expanded');
      const drawerOverflow = drawer.scrollWidth > drawer.clientWidth + 2;
      const panelOverflow = panel.scrollWidth > panel.clientWidth + 2;

      return {
        initialPillText,
        initiallyCollapsed,
        rows,
        hasAntigravityOpt,
        hasManualOpt,
        firstOptText,
        hasReadyOptMarker: writerOptions.some((o) => o.value === 'openai' && o.text.includes('🟢')),
        hasUnconfiguredOptMarker: writerOptions.some((o) => o.value === 'anthropic' && o.text.includes('⚫')),
        feedbackText: feedback.textContent.trim(),
        savedPillText,
        collapsedChips,
        drawerOverflow,
        panelOverflow,
      };
    })()`);

    assert.equal(roadmapSaveRes.initialPillText, "Mặc định chung");
    assert.equal(roadmapSaveRes.initiallyCollapsed, true);
    assert.deepEqual(roadmapSaveRes.rows, [
      "outliner",
      "brief_scriptwriter",
      "content_reviewer",
      "visual_director",
      "repair",
    ]);
    assert.equal(roadmapSaveRes.hasAntigravityOpt, false);
    assert.equal(roadmapSaveRes.hasManualOpt, false);
    assert.equal(roadmapSaveRes.firstOptText, "Theo mặc định Job / chọn chung");
    assert.equal(roadmapSaveRes.hasReadyOptMarker, true);
    assert.equal(roadmapSaveRes.hasUnconfiguredOptMarker, true);
    assert.equal(roadmapSaveRes.savedPillText, "2/5 tùy chỉnh");
    assert.equal(roadmapSaveRes.collapsedChips.length, 2);
    assert.equal(roadmapSaveRes.drawerOverflow, false, "Roadmap drawer must have zero horizontal overflow");
    assert.equal(roadmapSaveRes.panelOverflow, false, "RoleRoutingPanel must have zero horizontal overflow");

    // Verify persistence in VIDEO_MAKER_AI_PREFERENCES_FILE after UI Save
    const prefsAfterUiSave = JSON.parse(fs.readFileSync(prefFile, "utf-8"));
    assert.equal(prefsAfterUiSave.pipeline_routing.outliner, null);
    assert.deepEqual(prefsAfterUiSave.pipeline_routing.brief_scriptwriter, {
      provider_id: "openai",
      model: "mock-writer-v1",
    });
    assert.deepEqual(prefsAfterUiSave.pipeline_routing.visual_director, {
      provider_id: "deepseek",
      model: "mock-director-v2",
    });
    assert.equal(prefsAfterUiSave.pipeline_routing.repair, null);

    // Step 6B: Reset routing from UI -> verify all 4 roles cleared to null on UI & disk
    const roadmapResetRes = await evalBrowser(`(async () => {
      const waitFor = async (fn, msg, timeoutMs = 8000) => {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
          const v = fn();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 80));
        }
        throw new Error('Timeout waiting for: ' + msg);
      };
      const panel = document.querySelector('.provider-drawer-panel [data-testid="role-routing-panel"]');
      const resetBtn = panel.querySelector('[data-testid="role-routing-reset"]');
      resetBtn.click();
      await waitFor(
        () => {
          const pill = panel.querySelector('[data-testid="role-routing-count-pill"]');
          return pill && pill.textContent.trim() === 'Mặc định chung' ? pill : null;
        },
        'reset pill update'
      );
      const providerVals = ['outliner', 'brief_scriptwriter', 'content_reviewer', 'visual_director', 'repair'].map(
        (r) => panel.querySelector('[data-role-provider="' + r + '"]')?.value
      );
      const chipsAfterReset = panel.querySelectorAll('.role-routing-chip').length;
      return { providerVals, chipsAfterReset };
    })()`);

    assert.deepEqual(roadmapResetRes.providerVals, ["", "", "", "", ""]);
    assert.equal(roadmapResetRes.chipsAfterReset, 0);

    const prefsAfterUiReset = JSON.parse(fs.readFileSync(prefFile, "utf-8"));
    for (const role of VALID_PIPELINE_ROLES) {
      assert.equal(prefsAfterUiReset.pipeline_routing[role], null, `Role ${role} must be null after reset`);
    }

    // Step 6C: Open AiScriptModal in three_stage mode -> compact RoleRoutingPanel inside stage box, zero duplication, zero overflow
    const modalCheckRes = await evalBrowser(`(async () => {
      const waitFor = async (fn, msg, timeoutMs = 10000) => {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
          const v = fn();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 80));
        }
        throw new Error('Timeout waiting for: ' + msg);
      };

      const setSelectValue = (sel, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, val);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };

      // Close Roadmap provider drawer
      document.querySelector('.worker-status-pill')?.click();
      await new Promise((r) => setTimeout(r, 100));

      // Open batch modal (defaults to three_stage mode)
      const batchBtn = await waitFor(() => document.querySelector('.btn-ai-batch'), 'btn-ai-batch');
      batchBtn.click();

      const modal = await waitFor(() => document.querySelector('.ai-script-modal'), 'ai-script-modal');
      const stageBox = await waitFor(() => modal.querySelector('.ai-pipeline-stage-box'), 'ai-pipeline-stage-box');
      const allPanelsInModal = modal.querySelectorAll('[data-testid="role-routing-panel"]');
      const stagePanel = stageBox.querySelector('[data-testid="role-routing-panel"]');
      if (!stagePanel) throw new Error('RoleRoutingPanel missing in AiScriptModal three_stage box');

      const isCompact = stagePanel.classList.contains('is-compact');
      const initiallyCollapsed = !stagePanel.querySelector('[data-testid="role-routing-body"]');

      stagePanel.querySelector('[data-testid="role-routing-toggle"]').click();
      const body = await waitFor(() => stagePanel.querySelector('[data-testid="role-routing-body"]'), 'modal role-routing-body');
      const rows = Array.from(body.querySelectorAll('[data-role]')).map((r) => r.getAttribute('data-role'));

      // Verify custom model input + Enter key guard inside AiScriptModal + saving without submitting outer form
      const outlinerSel = body.querySelector('[data-role-provider="outliner"]');
      setSelectValue(outlinerSel, 'openai');
      const outlinerModelSel = await waitFor(() => {
        const s = body.querySelector('[data-role-model="outliner"]');
        return s && Array.from(s.options).some((o) => o.value === 'mock-writer-v1') ? s : null;
      }, 'modal outliner models');
      setSelectValue(outlinerModelSel, 'mock-writer-v1');

      const customModelInput = await waitFor(
        () => body.querySelector('[data-role-custom-model="outliner"]'),
        'custom model input for outliner'
      );
      const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      inputSetter.call(customModelInput, 'custom-outliner-v9');
      customModelInput.dispatchEvent(new Event('input', { bubbles: true }));
      customModelInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 80));

      body.querySelector('[data-testid="role-routing-save"]').click();
      await waitFor(() => stagePanel.querySelector('[data-testid="role-routing-feedback"].is-ok'), 'modal save feedback');

      const modalStillOpen = Boolean(document.querySelector('.ai-script-modal'));
      const modalBody = modal.querySelector('.studio-modal-body');
      const modalOverflow = modalBody ? modalBody.scrollWidth > modalBody.clientWidth + 2 : true;
      const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;

      return {
        panelCountInModal: allPanelsInModal.length,
        isCompact,
        initiallyCollapsed,
        rows,
        customModelSelectValue: body.querySelector('[data-role-model="outliner"]')?.value || '',
        modalStillOpen,
        modalPillText: stagePanel.querySelector('[data-testid="role-routing-count-pill"]')?.textContent?.trim() || '',
        modalOverflow,
        docOverflow,
      };
    })()`);

    assert.equal(modalCheckRes.panelCountInModal, 1, "BrandHealthGrid inside AiScriptModal must not render duplicate RoleRoutingPanel");
    assert.equal(modalCheckRes.isCompact, true);
    assert.equal(modalCheckRes.initiallyCollapsed, true);
    assert.deepEqual(modalCheckRes.rows, [
      "outliner",
      "brief_scriptwriter",
      "content_reviewer",
      "visual_director",
      "repair",
    ]);
    assert.equal(modalCheckRes.customModelSelectValue, "custom-outliner-v9");
    assert.equal(modalCheckRes.modalStillOpen, true, "Saving RoleRoutingPanel or pressing Enter in custom model input must not submit outer AiScriptModal form");
    assert.equal(modalCheckRes.modalPillText, "1/5 tùy chỉnh");
    assert.equal(modalCheckRes.modalOverflow, false, "AiScriptModal must have zero horizontal overflow");
    assert.equal(modalCheckRes.docOverflow, false, "Document must have zero horizontal overflow");

    const prefsAfterModalSave = JSON.parse(fs.readFileSync(prefFile, "utf-8"));
    assert.deepEqual(prefsAfterModalSave.pipeline_routing.outliner, {
      provider_id: "openai",
      model: "custom-outliner-v9",
    });

    // Step 6D: Verify Player Part Switcher, 4 new React components & ScriptingStageModal AI Review tab
    const playerLoadedPromise = new Promise((resolve) => {
      cdp.on("Page.loadEventFired", () => resolve());
      setTimeout(resolve, 6000);
    });
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${studioPort}/?view=player&course=DEMO3&ep=ep02-multipart`,
    });
    await playerLoadedPromise;

    const multiUiRes = await evalBrowser(`(async () => {
      const waitFor = async (fn, msg, timeoutMs = 10000) => {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
          const v = fn();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 80));
        }
        throw new Error('Timeout waiting for: ' + msg);
      };
      const switcher = await waitFor(() => document.querySelector('.player-part-switcher'), 'player-part-switcher');
      const pills = Array.from(switcher.querySelectorAll('.player-part-pill')).map((b) => b.textContent.trim());
      const openModalBtn = await waitFor(() => document.querySelector('.player-part-act-btn'), 'Review / Merge button');
      openModalBtn.click();
      const stagePills = await waitFor(() => {
        const list = document.querySelectorAll('.stage-parts-selector .stage-part-pill');
        return list.length >= 3 ? list : null;
      }, 'stage-parts-selector pills');
      stagePills[1].click(); // part_01
      await new Promise((r) => setTimeout(r, 200));
      const tabs = Array.from(document.querySelectorAll('.stage-tab-btn'));
      const reviewTab = tabs.find((t) => /AI Review/.test(t.textContent || ''));
      if (!reviewTab) throw new Error('Missing 4. AI Review tab in ScriptingStageModal');
      reviewTab.click();
      const reviewPanel = await waitFor(() => document.querySelector('.stage-review-panel'), 'stage-review-panel');
      return {
        partPillCount: pills.length,
        stagePillCount: stagePills.length,
        reviewText: reviewPanel.textContent.trim(),
      };
    })()`);
    assert.ok(multiUiRes.partPillCount >= 3, `Expected Full + 2 parts pills, got ${multiUiRes.partPillCount}`);
    assert.ok(multiUiRes.stagePillCount >= 3, `Expected Master + 2 parts pills, got ${multiUiRes.stagePillCount}`);
    assert.ok(multiUiRes.reviewText.includes("APPROVED"), `Expected APPROVED badge in ScriptingStageModal AI Review tab`);

    assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join("; ")}`);
    assert.equal(pageExceptions.length, 0, `Browser page exceptions: ${pageExceptions.join("; ")}`);
    console.log("PASS: Phase 3.1 + v2 Chrome UI RoleRoutingPanel (5 roles) & ScriptingStageModal verified (0 console/page errors).");
  } finally {
    if (cdp) {
      await cdp.send("Browser.close").catch(() => {});
      cdp.close();
    }
    await terminateProcess(chromeProc, "chrome-phase31");
    try {
      fs.rmSync(chromeUserDir, { recursive: true, force: true });
    } catch {
      // ignore transient Windows file lock
    }
  }

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
