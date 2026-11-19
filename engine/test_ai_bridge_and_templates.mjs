import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUPPORTED_VISUAL_TYPES,
  computeArchitectureLayout,
  computeComparisonMatrixState,
  computeKpiMetricsState,
  computeTimelineFlowState,
  getSceneBurstInfo,
} from "./src/motion/kernel.mjs";
import {
  TEMPLATE_SPECS,
  TEMPLATE_LAYOUT_BUDGETS,
  buildTemplatesSchemaDoc,
  getSchemaPromptSpec,
} from "./src/template_schema.mjs";
import {
  validateArchitectureData,
  validateScriptDiagrams,
  validateSingleScene,
} from "./src/diagram_validator.mjs";
import {
  extractRelevantCurriculumContext,
  generateEpisodeScript,
  normalizeCompiledScript,
} from "./ai/runner.mjs";
import { wrapText } from "./src/canvas_templates/shared.mjs";
import {
  TOKYO_NIGHT_PALETTE,
  drawCodeCliScene,
  registerShikiTokens,
  tokenizeCodeLine,
} from "./src/canvas_templates/code_cli.mjs";
import { createMediaHandlers } from "./routes/media.mjs";
import { resolveOutputFilename } from "./src/exporter.mjs";
import { inspectEpisodeArtifacts, readEpisodeState } from "./state_cli.mjs";
import {
  checkAiEnvKeys,
  inspectWorkspaceAdapters,
  installClaudeDesktopConfig,
  installMcpJson,
  installPluginToDir,
  installSkillAdapter,
} from "./setup_adapters.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = __dirname;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runSpawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...opts,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString("utf-8");
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString("utf-8");
    });
    proc.on("error", reject);
    proc.on("exit", (code) => resolve({ status: code, stdout, stderr }));
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

function createSilentWavBuffer(durationSec = 1.2, sampleRate = 22050) {
  const numSamples = Math.max(100, Math.floor(durationSec * sampleRate));
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

function buildSampleScenes() {
  return [
    {
      id: "s1_matrix",
      part: "problem",
      part_label: "Phần 1 · So sánh",
      title: "So sánh Static Access Key vs STS Temporary Token",
      duration_sec: 1.2,
      audio_file: "audio/s1_matrix.wav",
      narration: "So sánh IAM User tĩnh với IAM Role STS tạm thời cho môi trường production.",
      highlight_words: ["IAM Role", "STS"],
      subtitles: [{ start: 0, end: 1.2, text: "Dùng **IAM Role** với **STS** thay key tĩnh." }],
      visual_type: "comparison_matrix",
      visual_data: {
        badge: "So sánh Kiến trúc",
        title: "Quản lý Credential trên AWS",
        criterion_heading: "Tiêu chí",
        columns: [
          { id: "user", title: "IAM User", subtitle: "Long-term Key", tone: "red" },
          { id: "role", title: "IAM Role + STS", subtitle: "Recommended", tone: "green", badge: "Production" },
        ],
        rows: [
          {
            criterion: "Loại Credential",
            progress_start: 0.1,
            values: {
              user: { text: "Access Key tĩnh vĩnh viễn", status: "bad" },
              role: { text: "Token tạm 15m–12h tự xoay", status: "good" },
            },
          },
          {
            criterion: "Rủi ro lộ Secret",
            progress_start: 0.42,
            values: {
              user: { text: "Cao nếu lỡ commit vào Git", status: "bad" },
              role: { text: "Giảm tối đa nhờ tự hết hạn", status: "best" },
            },
          },
        ],
        takeaway: {
          label: "💡 Quy tắc vàng",
          text: "EC2 và Lambda luôn dùng IAM Role thay vì nhúng Access Key.",
          show_at_progress: 0.72,
        },
      },
    },
    {
      id: "s2_timeline",
      part: "architecture",
      part_label: "Phần 2 · Luồng STS",
      title: "Chuỗi AssumeRole từ Application tới S3",
      duration_sec: 1.2,
      audio_file: "audio/s2_timeline.wav",
      narration: "Ứng dụng gọi STS AssumeRole nhận token ngắn hạn trước khi truy cập S3.",
      subtitles: [{ start: 0, end: 1.2, text: "Ứng dụng xin **token tạm** từ **AWS STS**." }],
      visual_type: "timeline_flow",
      visual_data: {
        orientation: "horizontal",
        badge: "Luồng AssumeRole",
        subtitle: "Zero Static Secrets",
        milestones: [
          {
            id: "m1",
            time_label: "Bước 1",
            title: "App gọi STS",
            description: "Gửi yêu cầu AssumeRole kèm ExternalId",
            icon: "sts",
            tone: "blue",
            metric_badge: "TLS 1.3",
            progress_start: 0.08,
            progress_end: 0.36,
          },
          {
            id: "m2",
            time_label: "Bước 2",
            title: "Kiểm tra Trust Policy",
            description: "STS xác thực danh tính và điều kiện",
            icon: "shield",
            tone: "purple",
            metric_badge: "~18ms",
            progress_start: 0.36,
            progress_end: 0.68,
          },
          {
            id: "m3",
            time_label: "Bước 3",
            title: "Truy cập S3",
            description: "Dùng SessionToken để đọc bucket an toàn",
            icon: "s3",
            tone: "green",
            metric_badge: "Auto-Expire",
            progress_start: 0.68,
            progress_end: 0.92,
          },
        ],
        callout: {
          title: "Zero Static Key",
          text: "Toàn bộ chuỗi xác thực hoàn tất dưới 50ms.",
          show_at_progress: 0.78,
        },
      },
    },
    {
      id: "s3_kpi",
      part: "exam_tips",
      part_label: "Phần 3 · Tác động thực tế",
      title: "Chi phí & Rủi ro khi lộ Root Access Key",
      duration_sec: 1.2,
      audio_file: "audio/s3_kpi.wav",
      narration: "Lộ Access Key tĩnh có thể làm chi phí EC2 tăng vọt hàng chục nghìn đô trong vài giờ.",
      subtitles: [{ start: 0, end: 1.2, text: "Cảnh báo **chi phí EC2** tăng vọt khi lộ key." }],
      visual_type: "kpi_metrics",
      visual_data: {
        cards: [
          {
            id: "cost",
            label: "Thiệt hại khi lộ Key",
            value: "$48,200",
            numeric_target: 48200,
            prefix: "$",
            delta_text: "+1,400% chi phí EC2",
            delta_tone: "danger",
            tone: "red",
            sparkline: [12, 18, 25, 68, 95, 100],
            progress_start: 0.06,
          },
          {
            id: "revoked",
            label: "Thời gian thu hồi Role",
            value: "1.5s",
            numeric_target: 1.5,
            suffix: "s",
            decimals: 1,
            delta_text: "Cắt quyền tức thì",
            delta_tone: "success",
            tone: "green",
            sparkline: [90, 60, 35, 12, 5, 2],
            progress_start: 0.16,
          },
        ],
        chart: {
          title: "Chi phí phát sinh theo giờ sau khi lộ Key",
          type: "bar",
          show_at_progress: 0.34,
          unit: "USD",
          series: [
            { label: "1h", value: 420 },
            { label: "3h", value: 4900 },
            { label: "6h", value: 18500, highlight: true },
          ],
        },
        alert_stamp: {
          text: "REVOKE KEY NGAY!",
          tone: "danger",
          show_at_progress: 0.65,
        },
      },
    },
  ];
}

function httpRequestJson(port, method, urlPath, body = null, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const headers = {};
    if (payload !== null) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method, headers, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 500, body: json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`HTTP timeout on ${method} ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function httpRequestBinary(port, method, urlPath, bufferBody, headers = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.isBuffer(bufferBody) ? bufferBody : Buffer.from(bufferBody || "");
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          "Content-Length": buf.length,
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 500, body: json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`HTTP timeout on ${method} ${urlPath}`)));
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

class McpStdioClient {
  constructor(port) {
    this.proc = spawn(process.execPath, [path.join(ENGINE_DIR, "mcp_server.mjs")], {
      cwd: ENGINE_DIR,
      env: { ...process.env, VIDEO_MAKER_PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.buf = Buffer.alloc(0);
    this.proc.stderr.on("data", (d) => {
      this.stderr += d.toString("utf-8");
    });
    this.proc.stdout.on("data", (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (true) {
        const nl = this.buf.indexOf(0x0a);
        if (nl === -1) break;
        const line = this.buf.subarray(0, nl).toString("utf-8").trim();
        this.buf = this.buf.subarray(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout for ${method}. stderr=${this.stderr}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async callTool(name, args = {}) {
    const resp = await this.request("tools/call", { name, arguments: args });
    const text = resp.result?.content?.[0]?.text || "{}";
    return {
      isError: Boolean(resp.result?.isError),
      data: JSON.parse(text),
      raw: resp,
    };
  }

  close() {
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      // ignore
    }
  }
}

async function waitForServerReady(port, proc, stderrRef) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Test server exited early (${proc.exitCode}): ${stderrRef.buf}`);
    }
    try {
      const res = await httpRequestJson(port, "GET", "/api/ai/status", null, 1000);
      if (res.status === 200 && res.body?.ok) return;
    } catch {
      // retrying
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for test server on port ${port}`);
}

function assertNoSecretsLeaked(payload, forbiddenSecrets, contextLabel = "response") {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  for (const secret of forbiddenSecrets) {
    assert.equal(
      serialized.includes(secret),
      false,
      `SECURITY LEAK (${contextLabel}): forbidden secret fragment "${secret}" appeared in output!`
    );
  }
  assert.equal(
    /sk-[A-Za-z0-9_-]{6,}/.test(serialized),
    false,
    `SECURITY LEAK (${contextLabel}): sk-... key pattern appeared in output!`
  );
  assert.equal(
    /"api_key"\s*:\s*"[^"]+"/.test(serialized),
    false,
    `SECURITY LEAK (${contextLabel}): non-empty api_key field appeared in output!`
  );
}

async function createMockProviderServer(scenes) {
  const state = {
    openaiMode: "ok", // "ok" | "quota_on_third"
    openaiChatCalls: 0,
    deepseekRequests: [],
    pingCalls: [],
  };

  const VALID_OPENAI_KEY = "sk-valid-openai-secret-123456";
  const VALID_DEEPSEEK_KEY = "sk-valid-deepseek-secret-987654";
  const VALID_OPENROUTER_KEY = "sk-or-valid-secret-555555";

  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      let parsedBody = {};
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        parsedBody = {};
      }

      const authHeader = String(req.headers.authorization || "");
      const urlPath = (req.url || "/").split("?")[0];
      const send = (status, obj) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(obj));
      };

      // OpenAI mock
      if (req.method === "GET" && urlPath === "/openai/v1/models") {
        if (authHeader !== `Bearer ${VALID_OPENAI_KEY}`) {
          return send(401, { error: { message: "Incorrect API key provided", code: "invalid_api_key" } });
        }
        return send(200, {
          data: [
            { id: "gpt-4o" },
            { id: "gpt-4.1-mini" },
            { id: "text-embedding-3-small" },
            { id: "whisper-1" },
            { id: "tts-1" },
            { id: "dall-e-3" },
          ],
        });
      }
      if (req.method === "POST" && urlPath === "/openai/v1/chat/completions") {
        if (authHeader !== `Bearer ${VALID_OPENAI_KEY}`) {
          return send(401, { error: { message: "Unauthorized" } });
        }
        if (parsedBody.max_tokens === 1) {
          state.pingCalls.push({ provider: "openai", model: parsedBody.model });
          return send(200, { choices: [{ message: { content: "ok" } }] });
        }
        state.openaiChatCalls += 1;
        if (state.openaiMode === "quota_on_third" && state.openaiChatCalls >= 3) {
          return send(429, {
            error: {
              message: "You exceeded your current quota, please check your plan and billing details.",
              code: "insufficient_quota",
            },
          });
        }
        return send(200, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  script_json: {
                    title: `OpenAI Generated #${state.openaiChatCalls}`,
                    total_duration_sec: 1.2,
                    scenes: [scenes[0]],
                  },
                  notes_md: `# OpenAI Notes #${state.openaiChatCalls}\n- Auto generated`,
                }),
              },
            },
          ],
        });
      }

      // Anthropic mock (for testing invalid key darkening in BrandHealthGrid)
      if (req.method === "GET" && urlPath === "/anthropic/v1/models") {
        return send(401, { error: { type: "authentication_error", message: "invalid x-api-key" } });
      }

      // DeepSeek mock
      if (req.method === "GET" && urlPath === "/deepseek/v1/models") {
        if (authHeader !== `Bearer ${VALID_DEEPSEEK_KEY}`) {
          return send(401, { error: { message: "Invalid DeepSeek API key" } });
        }
        return send(200, {
          data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
        });
      }
      if (req.method === "GET" && urlPath === "/deepseek/user/balance") {
        if (authHeader !== `Bearer ${VALID_DEEPSEEK_KEY}`) {
          return send(401, { error: { message: "Invalid DeepSeek API key" } });
        }
        return send(200, {
          is_available: true,
          balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "0.00", topped_up_balance: "12.50" }],
        });
      }
      if (req.method === "POST" && urlPath === "/deepseek/v1/chat/completions") {
        if (authHeader !== `Bearer ${VALID_DEEPSEEK_KEY}`) {
          return send(401, { error: { message: "Unauthorized" } });
        }
        state.deepseekRequests.push(parsedBody);
        return send(200, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  script_json: {
                    title: `DeepSeek Resumed #${state.deepseekRequests.length}`,
                    total_duration_sec: 1.2,
                    scenes: [scenes[1]],
                  },
                  notes_md: `# DeepSeek Notes #${state.deepseekRequests.length}`,
                }),
              },
            },
          ],
        });
      }

      // OpenRouter mock (/models is public, /key verifies auth & limit)
      if (req.method === "GET" && urlPath === "/openrouter/v1/key") {
        if (authHeader !== `Bearer ${VALID_OPENROUTER_KEY}`) {
          return send(401, { error: { message: "Invalid OpenRouter key" } });
        }
        return send(200, {
          data: {
            label: "mock-or-key",
            limit: 100,
            limit_remaining: 42,
            usage: 58,
            is_free_tier: false,
          },
        });
      }
      if (req.method === "GET" && urlPath === "/openrouter/v1/models") {
        return send(200, {
          data: [{ id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" }],
        });
      }

      // Local mocks (fast offline 503)
      if (urlPath.startsWith("/ollama/") || urlPath.startsWith("/lmstudio/")) {
        return send(503, { error: "Local server not running" });
      }

      // Mock OpenAI-compatible TTS endpoint for multi-voice A/B tests
      if (req.method === "POST" && urlPath === "/tts/speech") {
        const dur = parsedBody.voice === "voice-b" ? 1.8 : 1.1;
        const wav = createSilentWavBuffer(dur);
        res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length });
        res.end(wav);
        return;
      }

      return send(404, { error: `Unhandled mock route: ${req.method} ${urlPath}` });
    });
  });

  await new Promise((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const port = srv.address().port;
  return {
    port,
    state,
    keys: {
      VALID_OPENAI_KEY,
      VALID_DEEPSEEK_KEY,
      VALID_OPENROUTER_KEY,
      INVALID_OPENAI_KEY: "sk-bad-openai-key-999999",
      INVALID_ANTHROPIC_KEY: "sk-ant-bad-test-000000",
    },
    close: () => new Promise((resolve) => srv.close(() => resolve())),
  };
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  const openPromise = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", (err) => reject(new Error(err?.message || "CDP socket error")));
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method && handlers.has(msg.method)) {
      for (const fn of handlers.get(msg.method)) fn(msg.params);
    }
  });

  return {
    openPromise,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    },
    close() {
      ws.close();
    },
  };
}

async function runChromeUiCheck(port, targetUrl, assertionExpr) {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }
  const cdpPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-chrome-"));
  const chrome = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu-sandbox",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
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
        const res = await httpRequestJson(cdpPort, "GET", "/json/list", null, 1000);
        const target = Array.isArray(res.body)
          ? res.body.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
          : null;
        if (target?.webSocketDebuggerUrl) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // waiting
      }
      await sleep(150);
    }
    if (!wsUrl) throw new Error(`CDP target unavailable for ${targetUrl}`);

    cdp = createCdpClient(wsUrl);
    await cdp.openPromise;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const consoleErrors = [];
    const runtimeExceptions = [];
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") {
        consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
      }
    });
    cdp.on("Runtime.exceptionThrown", (p) => {
      runtimeExceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Exception");
    });

    const loadedPromise = new Promise((resolve) => {
      cdp.on("Page.loadEventFired", () => resolve());
      setTimeout(resolve, 6000);
    });
    await cdp.send("Page.navigate", { url: targetUrl });
    await loadedPromise;

    let evalRes = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        evalRes = await cdp.send("Runtime.evaluate", {
          expression: assertionExpr,
          awaitPromise: true,
          returnByValue: true,
        });
        break;
      } catch (err) {
        if (String(err.message || err).includes("Execution context was destroyed") && attempt < 2) {
          await sleep(300);
          continue;
        }
        throw err;
      }
    }
    if (evalRes?.exceptionDetails) {
      throw new Error(`Browser eval failed: ${JSON.stringify(evalRes.exceptionDetails)}`);
    }
    assert.equal(consoleErrors.length, 0, `Browser console errors on ${targetUrl}: ${consoleErrors.join("; ")}`);
    assert.equal(runtimeExceptions.length, 0, `Browser exceptions on ${targetUrl}: ${runtimeExceptions.join("; ")}`);
    return evalRes.result?.value;
  } finally {
    if (cdp) {
      await cdp.send("Browser.close").catch(() => {});
      cdp.close();
    }
    try {
      if (chrome.exitCode === null) chrome.kill();
    } catch {
      // ignore
    }
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

async function runTests() {
  console.log("=== 1. Kernel State & Shared Burst Unit Tests ===");
  assert.deepEqual(
    [...SUPPORTED_VISUAL_TYPES],
    [
      "architecture",
      "console_setup",
      "code_cli",
      "exam_tips",
      "comparison_matrix",
      "timeline_flow",
      "kpi_metrics",
    ]
  );

  const scenes = buildSampleScenes();
  const matrixData = scenes[0].visual_data;
  assert.equal(computeComparisonMatrixState(matrixData, 0).visibleCount, 0);
  assert.equal(computeComparisonMatrixState(matrixData, 0.25).visibleCount, 1);
  assert.equal(computeComparisonMatrixState(matrixData, 0.5).visibleCount, 2);
  assert.equal(computeComparisonMatrixState(matrixData, 0.85).showTakeaway, true);
  assert.equal(computeComparisonMatrixState(matrixData, 1.0).visibleCount, 2);

  const timelineData = scenes[1].visual_data;
  const tl0 = computeTimelineFlowState(timelineData, 0);
  const tl50 = computeTimelineFlowState(timelineData, 0.5);
  const tl100 = computeTimelineFlowState(timelineData, 1.0);
  assert.equal(tl0.activeIndex, -1);
  assert.equal(tl50.activeIndex, 1);
  assert.equal(tl50.milestones[0].completed, true);
  assert.ok(tl50.trackFillRatio > 0.3 && tl50.trackFillRatio < 0.8);
  assert.equal(tl100.showCallout, true);
  assert.equal(tl100.trackFillRatio, 1);
  assert.equal(computeTimelineFlowState({ ...timelineData, orientation: "vertical" }, 0.5).orientation, "vertical");

  const kpiData = scenes[2].visual_data;
  const kpi0 = computeKpiMetricsState(kpiData, 0);
  const kpi25 = computeKpiMetricsState(kpiData, 0.25);
  const kpi85 = computeKpiMetricsState(kpiData, 0.85);
  assert.equal(kpi0.cards[0].visible, false);
  assert.equal(kpi25.cards[0].visible, true);
  assert.notEqual(kpi25.cards[0].displayValue, "$0");
  assert.equal(kpi85.cards[0].displayValue, "$48,200");
  assert.equal(kpi85.showChart, true);
  assert.equal(kpi85.showStamp, true);
  assert.ok(Math.abs(kpi85.stampScale - 1) < 0.1);

  for (let i = 0; i < scenes.length; i++) {
    const b = getSceneBurstInfo(scenes[i], 0.5, 1920, 1080, i);
    assert.ok(b.key && b.key !== "none");
    assert.ok(b.nx >= 0 && b.nx <= 1 && b.ny >= 0 && b.ny <= 1);
    assert.ok(b.cx > 0 && b.cy > 0);
  }
  console.log("PASS: Kernel state calculations and shared burst points verified.");

  console.log("=== 2. Diagram & Template Validator Unit Tests ===");
  const validRes = validateScriptDiagrams({ title: "Demo", scenes });
  assert.equal(validRes.valid, true, `Expected valid script: ${validRes.errors.join("; ")}`);
  assert.equal(validRes.scene_count, 3);

  const badType = validateScriptDiagrams({
    scenes: [{ id: "bad_type", visual_type: "magic_3d", visual_data: {} }],
  });
  assert.equal(badType.valid, false);

  const badMatrix = validateScriptDiagrams({
    scenes: [
      {
        id: "too_many_cols",
        visual_type: "comparison_matrix",
        visual_data: {
          columns: [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, title: `Col ${n}` })),
          rows: [{ criterion: "C1", values: {} }],
        },
      },
    ],
  });
  assert.equal(badMatrix.valid, false);
  assert.ok(badMatrix.errors[0].includes("max 4"));

  const badTimeline = validateScriptDiagrams({
    scenes: [
      {
        id: "too_many_ms",
        visual_type: "timeline_flow",
        visual_data: {
          orientation: "diagonal",
          milestones: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ title: `Step ${n}` })),
        },
      },
    ],
  });
  assert.equal(badTimeline.valid, false);
  assert.ok(badTimeline.errors.some((e) => e.includes("orientation")));
  assert.ok(badTimeline.errors.some((e) => e.includes("max 6")));

  const badKpi = validateScriptDiagrams({
    scenes: [
      {
        id: "too_many_cards",
        visual_type: "kpi_metrics",
        visual_data: {
          cards: [1, 2, 3, 4, 5].map((n) => ({ label: `M${n}`, value: "1" })),
        },
      },
    ],
  });
  assert.equal(badKpi.valid, false);
  console.log("PASS: Validator accept/reject checks verified.");

  // Create isolated temp workspace for Server + MCP + Mock Providers + Chrome E2E
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-e2e-"));
  const testPort = await getFreePort();
  const queueFile = path.join(tmpWorkspace, ".ai_queue.json");
  const credFile = path.join(tmpWorkspace, ".ai_credentials.json");
  const prefFile = path.join(tmpWorkspace, ".ai_preferences.json");
  const mockProviders = await createMockProviderServer(scenes);
  let serverProc = null;
  let mcpClient = null;
  let workerWaitProc = null;
  let sseReq = null;
  let keepaliveTimer = null;

  try {
    const courseDir = path.join(tmpWorkspace, "TESTCOURSE");
    const stateDir = path.join(courseDir, "state");
    const epIds = [
      "ep01-test",
      "ep02-test",
      "ep03-test",
      "ep04-test",
      "ep05-test",
      "ep06-test",
      "ep07-test",
    ];
    fs.mkdirSync(stateDir, { recursive: true });
    for (const epId of epIds) {
      fs.mkdirSync(path.join(courseDir, "episodes", epId), { recursive: true });
    }
    const ep1Dir = path.join(courseDir, "episodes", "ep01-test");

    fs.writeFileSync(
      path.join(courseDir, "course.json"),
      JSON.stringify(
        {
          course: "TESTCOURSE",
          title: "Test Course",
          tts_profile: "edge-hoaimy",
          stages: [
            {
              stage: 1,
              title: "Chặng 1",
              episodes: epIds.map((id, idx) => ({
                id,
                number: idx + 1,
                title: `Test Episode ${idx + 1}`,
                duration_target: "3m",
              })),
            },
          ],
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(courseDir, "curriculum.md"),
      `# TESTCOURSE\n${epIds.map((id) => `- ${id}`).join("\n")}\n`
    );

    const initState = (id, num, title) => ({
      course: "TESTCOURSE",
      episode_id: id,
      number: num,
      stage: 1,
      title,
      overall_status: "planned",
      scripting: { status: "pending", owner: null, phase: null, notes: "" },
      production: { status: "pending", tts_done: false, video_done: false, verified: false, stale: false },
      revisions: [],
      artifacts: { script: false, notes: false, audio_count: 0, subtitles: false, video_file: null },
    });
    epIds.forEach((id, idx) => {
      fs.writeFileSync(
        path.join(stateDir, `${id}.json`),
        JSON.stringify(initState(id, idx + 1, `Test Episode ${idx + 1}`), null, 2)
      );
    });
    fs.writeFileSync(path.join(stateDir, "events.jsonl"), "");

    const stderrRef = { buf: "" };
    serverProc = spawn(process.execPath, [path.join(ENGINE_DIR, "server.mjs")], {
      cwd: ENGINE_DIR,
      env: {
        ...process.env,
        PORT: String(testPort),
        VIDEO_MAKER_WORKSPACE_ROOT: tmpWorkspace,
        VIDEO_MAKER_AI_QUEUE_FILE: queueFile,
        VIDEO_MAKER_AI_CREDENTIALS_FILE: credFile,
        VIDEO_MAKER_AI_PREFERENCES_FILE: prefFile,
        VIDEO_MAKER_WATCHER_TTL_MS: "2500",
        VIDEO_MAKER_SWEEP_INTERVAL_MS: "500",
        VIDEO_MAKER_OPENAI_BASE_URL: `http://127.0.0.1:${mockProviders.port}/openai/v1`,
        VIDEO_MAKER_ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockProviders.port}/anthropic/v1`,
        VIDEO_MAKER_DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockProviders.port}/deepseek/v1`,
        VIDEO_MAKER_OPENROUTER_BASE_URL: `http://127.0.0.1:${mockProviders.port}/openrouter/v1`,
        VIDEO_MAKER_OLLAMA_BASE_URL: `http://127.0.0.1:${mockProviders.port}/ollama`,
        VIDEO_MAKER_LMSTUDIO_BASE_URL: `http://127.0.0.1:${mockProviders.port}/lmstudio/v1`,
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        DEEPSEEK_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc.stderr.on("data", (d) => {
      stderrRef.buf += d.toString("utf-8");
    });

    await waitForServerReady(testPort, serverProc, stderrRef);

    // Subscribe to SSE stream
    const sseEvents = [];
    await new Promise((resolve) => {
      sseReq = http.get(`http://127.0.0.1:${testPort}/api/stream`, (res) => {
        let cur = "";
        res.on("data", (chunk) => {
          cur += chunk.toString("utf-8");
          const blocks = cur.split("\n\n");
          cur = blocks.pop() || "";
          for (const blk of blocks) {
            const evMatch = blk.match(/^event:\s*(.+)$/m);
            const dataMatch = blk.match(/^data:\s*(.+)$/m);
            if (evMatch && dataMatch) {
              try {
                sseEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1]) });
              } catch {
                // ignore
              }
            }
          }
        });
        resolve();
      });
    });

    console.log("=== 3. MCP Stdio + HTTP /mcp Handshake, 9 Tools & Resources Verification ===");
    mcpClient = new McpStdioClient(testPort);
    const initResp = await mcpClient.request("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "test-harness", version: "1.0.0" },
    });
    assert.equal(initResp.result?.serverInfo?.name, "tech-video-studio");
    mcpClient.notify("notifications/initialized", {});

    const listResp = await mcpClient.request("tools/list", {});
    const toolNames = (listResp.result?.tools || []).map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "studio_claim_ai_job",
      "studio_complete_ai_job",
      "studio_fail_ai_job",
      "studio_get_context",
      "studio_poll_ai_job",
      "studio_report_ai_progress",
      "studio_submit_episode_script",
      "studio_validate_script",
      "studio_worker_heartbeat",
    ]);

    const resListStdio = await mcpClient.request("resources/list", {});
    const stdioUris = (resListStdio.result?.resources || []).map((r) => r.uri);
    assert.ok(stdioUris.includes("studio://courses"));
    assert.ok(stdioUris.includes("studio://jobs/queue"));
    assert.ok(stdioUris.includes("studio://templates/schema"));
    assert.ok(stdioUris.includes("studio://courses/TESTCOURSE"));

    const tplReadStdio = await mcpClient.request("resources/read", { uri: "studio://templates/schema" });
    const tplDoc = JSON.parse(tplReadStdio.result?.contents?.[0]?.text || "{}");
    assert.equal(tplDoc.supported_visual_types.length, 7);

    const courseReadStdio = await mcpClient.request("resources/read", { uri: "studio://courses/TESTCOURSE" });
    const courseDoc = JSON.parse(courseReadStdio.result?.contents?.[0]?.text || "{}");
    assert.equal(courseDoc.course, "TESTCOURSE");
    assert.equal(courseDoc.course_json?.course, "TESTCOURSE");

    // HTTP GET /mcp & POST /mcp verification
    const getMcpRes = await httpRequestJson(testPort, "GET", "/mcp");
    assert.equal(getMcpRes.status, 200);
    assert.equal(getMcpRes.body.ok, true);
    assert.equal(getMcpRes.body.tools.length, 9);
    assert.ok(getMcpRes.body.resources.includes("studio://templates/schema"));

    const postMcpInit = await httpRequestJson(testPort, "POST", "/mcp", {
      jsonrpc: "2.0",
      id: 101,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", clientInfo: { name: "http-test", version: "1.0.0" } },
    });
    assert.equal(postMcpInit.status, 200);
    assert.equal(postMcpInit.body.result?.serverInfo?.name, "tech-video-studio");

    const postMcpTools = await httpRequestJson(testPort, "POST", "/mcp", {
      jsonrpc: "2.0",
      id: 102,
      method: "tools/list",
      params: {},
    });
    assert.equal(postMcpTools.status, 200);
    assert.equal(postMcpTools.body.result?.tools?.length, 9);

    const postMcpResList = await httpRequestJson(testPort, "POST", "/mcp", {
      jsonrpc: "2.0",
      id: 103,
      method: "resources/list",
      params: {},
    });
    assert.equal(postMcpResList.status, 200);
    assert.ok((postMcpResList.body.result?.resources || []).some((r) => r.uri === "studio://courses/TESTCOURSE"));

    const postMcpCourses = await httpRequestJson(testPort, "POST", "/mcp", {
      jsonrpc: "2.0",
      id: 104,
      method: "resources/read",
      params: { uri: "studio://courses" },
    });
    assert.equal(postMcpCourses.status, 200);
    const httpCoursesData = JSON.parse(postMcpCourses.body.result?.contents?.[0]?.text || "{}");
    assert.ok(httpCoursesData.courses.some((c) => c.id === "TESTCOURSE"));

    const postMcpQueue = await httpRequestJson(testPort, "POST", "/mcp", {
      jsonrpc: "2.0",
      id: 105,
      method: "resources/read",
      params: { uri: "studio://jobs/queue" },
    });
    assert.equal(postMcpQueue.status, 200);
    const httpQueueData = JSON.parse(postMcpQueue.body.result?.contents?.[0]?.text || "{}");
    assert.equal(httpQueueData.ai_status?.ok, true);
    console.log("PASS: MCP stdio + HTTP /mcp (9 tools + resources/list + resources/read) verified.");

    console.log("=== 4. Offline Gate, Task Whitelist, worker_wait.mjs Wakeup & Full MCP Flow ===");
    // Verify Offline 503 gate before any heartbeat (for Antigravity/MCP mode)
    const offlinePost = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_episode",
      course: "TESTCOURSE",
      episode_ids: ["ep01-test"],
    });
    assert.equal(offlinePost.status, 503);
    assert.equal(offlinePost.body.code, "WORKER_OFFLINE");

    // Verify Browser UI keeps episode/batch scripting buttons enabled & opens BrandHealthGrid even when Antigravity is offline
    const uiOfflineCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=roadmap&course=TESTCOURSE`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const pill = document.querySelector('.worker-status-pill');
          const batchBtn = document.querySelector('.btn-ai-batch');
          const epBtn = document.querySelector('.ep-btn-ai');
          if (pill && batchBtn && epBtn) {
            pill.click();
            await new Promise(r => setTimeout(r, 150));
            const brandCards = document.querySelectorAll('.provider-drawer-panel .brand-card');
            return {
              pillText: pill.textContent,
              pillHasOnlineText: pill.textContent.includes('Online'),
              batchDisabled: batchBtn.disabled,
              epDisabled: epBtn.disabled,
              drawerOpen: Boolean(document.querySelector('.provider-drawer-panel')),
              brandCardCount: brandCards.length,
            };
          }
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Roadmap controls never mounted');
      })()`
    );
    assert.equal(uiOfflineCheck.pillHasOnlineText, false);
    assert.equal(uiOfflineCheck.batchDisabled, false);
    assert.equal(uiOfflineCheck.epDisabled, false);
    assert.equal(uiOfflineCheck.drawerOpen, true);
    assert.equal(uiOfflineCheck.brandCardCount, 9);

    // Start real worker_wait.mjs watcher process
    let waiterStdout = "";
    const waiterDonePromise = new Promise((resolve, reject) => {
      workerWaitProc = spawn(
        process.execPath,
        [
          path.join(ENGINE_DIR, "worker_wait.mjs"),
          "--worker-id",
          "argon-e2e",
          "--model",
          "Gemini 4 Argon",
          "--port",
          String(testPort),
          "--heartbeat-ms",
          "1000",
          "--wait-ms",
          "8000",
        ],
        { cwd: ENGINE_DIR, stdio: ["ignore", "pipe", "pipe"] }
      );
      workerWaitProc.stdout.on("data", (d) => {
        waiterStdout += d.toString("utf-8");
      });
      workerWaitProc.on("exit", (code) => resolve(code));
      workerWaitProc.on("error", reject);
    });

    // Wait for worker_wait.mjs to register Online heartbeat
    for (let i = 0; i < 30; i++) {
      const st = await httpRequestJson(testPort, "GET", "/api/ai/status");
      if (st.body?.online) break;
      await sleep(100);
    }
    const onlineStatus = await httpRequestJson(testPort, "GET", "/api/ai/status");
    assert.equal(onlineStatus.body.online, true);
    assert.equal(onlineStatus.body.primary_worker.model, "Gemini 4 Argon");

    // Verify rejected non-whitelist types and >5 batch limit
    const badTask = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "edit_workflow",
      course: "TESTCOURSE",
      episode_ids: ["ep01-test"],
    });
    assert.equal(badTask.status, 400);
    assert.equal(badTask.body.code, "TASK_NOT_ALLOWED");

    const badBatch = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_batch",
      course: "TESTCOURSE",
      episode_ids: ["a", "b", "c", "d", "e", "f"],
    });
    assert.equal(badBatch.status, 400);

    // Enqueue valid single script job (auto_produce=false) and verify instant watcher wakeup
    const tEnqueue = Date.now();
    const enqueueRes = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_episode",
      course: "TESTCOURSE",
      episode_ids: ["ep01-test"],
      custom_instructions: "Dùng đủ 3 template mới",
      auto_produce: false,
    });
    assert.equal(enqueueRes.status, 202);
    const jobId = enqueueRes.body.job.id;

    // Duplicate enqueue while active must return 409 EPISODE_BUSY
    const dupRes = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_episode",
      course: "TESTCOURSE",
      episode_ids: ["ep01-test"],
    });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.body.code, "EPISODE_BUSY");

    const exitCode = await Promise.race([
      waiterDonePromise,
      sleep(3000).then(() => {
        throw new Error("worker_wait.mjs did not wake within 3s");
      }),
    ]);
    const wakeLatencyMs = Date.now() - tEnqueue;
    assert.equal(exitCode, 0);
    const wakePayload = JSON.parse(waiterStdout);
    assert.equal(wakePayload.wake, true);
    assert.equal(wakePayload.job.id, jobId);
    console.log(`PASS: worker_wait.mjs woke up in ${wakeLatencyMs}ms with job ${jobId}.`);

    // Drive full Worker scripting lifecycle strictly via MCP stdio tools
    const claimRes = await mcpClient.callTool("studio_claim_ai_job", {
      worker_id: "argon-e2e",
      job_id: jobId,
      model: "Gemini 4 Argon",
    });
    assert.equal(claimRes.isError, false);
    assert.equal(claimRes.data.claimed, true);

    const ctxRes = await mcpClient.callTool("studio_get_context", {
      course: "TESTCOURSE",
      episode_ids: ["ep01-test"],
    });
    assert.equal(ctxRes.isError, false);
    assert.equal(ctxRes.data.supported_visual_types.length, 7);

    const progRes = await mcpClient.callTool("studio_report_ai_progress", {
      job_id: jobId,
      worker_id: "argon-e2e",
      episode_id: "ep01-test",
      status: "in_progress",
      progress: 55,
      message: "Drafting 3 new V2 template scenes",
    });
    assert.equal(progRes.isError, false);

    // Invalid script submit must be rejected by server validation gate
    const badSubmit = await mcpClient.callTool("studio_submit_episode_script", {
      job_id: jobId,
      worker_id: "argon-e2e",
      course: "TESTCOURSE",
      episode_id: "ep01-test",
      script_json: {
        title: "Invalid Matrix",
        scenes: [
          {
            id: "bad_m",
            visual_type: "comparison_matrix",
            visual_data: {
              columns: [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, title: `C${i}` })),
              rows: [{ criterion: "X", values: {} }],
            },
          },
        ],
      },
    });
    assert.equal(badSubmit.isError, true);
    assert.equal(badSubmit.data.code, "SCRIPT_VALIDATION_FAILED");

    // Prepare valid script with silent WAV files for later video export verification
    const ep1AudioDir = path.join(ep1Dir, "audio");
    fs.mkdirSync(ep1AudioDir, { recursive: true });
    for (const s of scenes) {
      fs.writeFileSync(path.join(ep1Dir, s.audio_file), createSilentWavBuffer(1.2));
    }
    const scriptPayload = {
      course: "TESTCOURSE",
      episode_id: "ep01-test",
      title: "Demo 3 New Visual Templates",
      total_duration_sec: 3.6,
      scenes,
    };

    const valTool = await mcpClient.callTool("studio_validate_script", { script_json: scriptPayload });
    assert.equal(valTool.isError, false);
    assert.equal(valTool.data.validation.valid, true);

    const goodSubmit = await mcpClient.callTool("studio_submit_episode_script", {
      job_id: jobId,
      worker_id: "argon-e2e",
      course: "TESTCOURSE",
      episode_id: "ep01-test",
      script_json: scriptPayload,
      notes_md: "# Test Notes\n- Verify 3 new templates\n",
      summary_note: "E2E approved with 3 templates",
    });
    assert.equal(goodSubmit.isError, false);
    assert.equal(goodSubmit.data.state.overall_status, "script_ready");

    const completeRes = await mcpClient.callTool("studio_complete_ai_job", {
      job_id: jobId,
      worker_id: "argon-e2e",
      summary: "Done without auto_produce",
    });
    assert.equal(completeRes.isError, false);
    assert.equal(completeRes.data.job.status, "completed");
    assert.equal(completeRes.data.spawned_production_jobs.length, 0);

    // Check SSE events captured worker_status + ai_job_update transitions
    assert.ok(sseEvents.some((e) => e.event === "worker_status" && e.data.online === true));
    assert.ok(sseEvents.some((e) => e.event === "ai_job_update" && e.data.job?.status === "completed"));
    console.log("PASS: Full MCP lifecycle, validation gate, script_ready state, and SSE updates verified.");

    console.log("=== 5. Headless Chrome UI (Online Roadmap + 3 React Preview Templates) ===");
    // Keep worker heartbeat alive while Chrome launches & executes Steps 5-6 (test TTL=2500ms)
    keepaliveTimer = setInterval(() => {
      void httpRequestJson(testPort, "POST", "/api/ai/worker/heartbeat", {
        worker_id: "argon-e2e",
        model: "Gemini 4 Argon",
        mode: "watcher",
      }).catch(() => {});
    }, 800);
    if (typeof keepaliveTimer.unref === "function") keepaliveTimer.unref();
    await httpRequestJson(testPort, "POST", "/api/ai/worker/heartbeat", {
      worker_id: "argon-e2e",
      model: "Gemini 4 Argon",
      mode: "watcher",
    });

    const uiOnlineCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=roadmap&course=TESTCOURSE`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const pill = document.querySelector('.worker-status-pill');
          const batchBtn = document.querySelector('.btn-ai-batch');
          if (pill && pill.classList.contains('is-online') && batchBtn && !batchBtn.disabled) {
            batchBtn.click();
            await new Promise(r => setTimeout(r, 120));
            return {
              pillText: pill.textContent,
              batchDisabled: batchBtn.disabled,
              modalOpen: Boolean(document.querySelector('.ai-script-modal')),
            };
          }
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Online Worker state did not unlock UI buttons');
      })()`
    );
    assert.equal(uiOnlineCheck.batchDisabled, false);
    assert.equal(uiOnlineCheck.modalOpen, true);
    assert.ok(uiOnlineCheck.pillText.includes("Online"));

    // Verify each of the 3 new React Preview templates renders in Studio Player (0 console/page errors)
    for (const [sceneId, selector] of [
      ["s1_matrix", ".scene-matrix .tpl-matrix-table"],
      ["s2_timeline", ".scene-timeline .tpl-timeline-track-area"],
      ["s3_kpi", ".scene-kpi .tpl-kpi-grid"],
    ]) {
      const playerCheck = await runChromeUiCheck(
        testPort,
        `http://127.0.0.1:${testPort}/?view=player&course=TESTCOURSE&ep=ep01-test&scene=${sceneId}`,
        `(async () => {
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline) {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              return { found: true, textLen: el.textContent.trim().length };
            }
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error('Missing expected template DOM element: ' + ${JSON.stringify(selector)});
        })()`
      );
      assert.equal(playerCheck.found, true);
      assert.ok(playerCheck.textLen > 10);
    }
    console.log("PASS: Headless Chrome Online Roadmap Modal + all 3 React Preview templates rendered with 0 errors.");

    console.log("=== 6. Headless Video Export of All 3 New Templates (HyperFrames default + legacy Canvas 2D) ===");
    const runRenderVideo = (extraArgs) =>
      new Promise((resolve, reject) => {
        const proc = spawn(
          process.execPath,
          [
            path.join(ENGINE_DIR, "render_video.mjs"),
            "--course",
            "TESTCOURSE",
            "--episode",
            "ep01-test",
            "--port",
            String(testPort),
            "--format",
            "webm",
            "--codec",
            "vp9",
            "--hardware",
            "cpu",
            "--resolution",
            "720p",
            "--fps",
            "24",
            ...extraArgs,
          ],
          {
            cwd: ENGINE_DIR,
            env: {
              ...process.env,
              VIDEO_MAKER_WORKSPACE_ROOT: tmpWorkspace,
            },
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
        let out = "";
        let err = "";
        proc.stdout.on("data", (d) => {
          out += d.toString("utf-8");
        });
        proc.stderr.on("data", (d) => {
          err += d.toString("utf-8");
        });
        proc.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`render_video ${extraArgs.join(" ")} exited ${code}:
OUT:
${out}
ERR:
${err}`));
          } else {
            resolve({ code, out });
          }
        });
      });

    // 6a. Default engine = HyperFrames composition (engine/hyperframes/) + WebCodecs
    const hfRender = await runRenderVideo([]);
    assert.equal(hfRender.code, 0);
    assert.ok(hfRender.out.includes("engine=hyperframes"), "default render must use the HyperFrames engine");
    const outWebmPath = path.join(ep1Dir, "ep01-test.webm");
    assert.ok(fs.existsSync(outWebmPath), "Rendered .webm must exist");
    const webmSize = fs.statSync(outWebmPath).size;
    assert.ok(webmSize > 10_000, `Rendered .webm looks too small (${webmSize} bytes)`);
    const hfIndex = path.join(ep1Dir, "hyperframes", "index.html");
    assert.ok(fs.existsSync(hfIndex), "HyperFrames project index.html must be generated");
    const hfHtml = fs.readFileSync(hfIndex, "utf-8");
    assert.ok(hfHtml.includes('data-composition-id="main"'), "composition root must declare data-composition-id");
    assert.ok(hfHtml.includes("hyperframe.runtime.iife.js"), "composition must load the HyperFrames runtime");
    console.log(`PASS: HyperFrames WebM export succeeded (${webmSize} bytes) covering comparison_matrix, timeline_flow, kpi_metrics.`);

    // 6b. Legacy Canvas 2D engine stays available as a fallback
    const legacyRender = await runRenderVideo(["--engine", "legacy", "--output", "ep01-test-legacy"]);
    assert.equal(legacyRender.code, 0);
    const legacyPath = path.join(ep1Dir, "ep01-test-legacy.webm");
    assert.ok(fs.existsSync(legacyPath), "Legacy rendered .webm must exist");
    const legacySize = fs.statSync(legacyPath).size;
    assert.ok(legacySize > 10_000, `Legacy rendered .webm looks too small (${legacySize} bytes)`);
    console.log(`PASS: Legacy Canvas 2D WebM export (--engine legacy) succeeded (${legacySize} bytes).`);

    console.log("=== 7. Auto-Produce Handoff & Heartbeat Expiry Offline Flip ===");
    const autoRes = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_episode",
      course: "TESTCOURSE",
      episode_ids: ["ep02-test"],
      auto_produce: true,
      render_prefs: {
        mode: "tts_only",
        format: "mp4",
      },
    });
    assert.equal(autoRes.status, 202);
    const autoJobId = autoRes.body.job.id;

    await mcpClient.callTool("studio_claim_ai_job", { worker_id: "argon-e2e", job_id: autoJobId });
    await mcpClient.callTool("studio_submit_episode_script", {
      job_id: autoJobId,
      worker_id: "argon-e2e",
      course: "TESTCOURSE",
      episode_id: "ep02-test",
      script_json: { title: "Auto Ep 2", scenes: [scenes[0]] },
    });
    const autoDone = await mcpClient.callTool("studio_complete_ai_job", {
      job_id: autoJobId,
      worker_id: "argon-e2e",
    });
    assert.equal(autoDone.isError, false);
    assert.equal(autoDone.data.spawned_production_jobs.length, 1);

    // Cancel spawned production job cleanly before waiting for TTL expiry
    await httpRequestJson(testPort, "POST", "/api/jobs/cancel", {
      job_id: autoDone.data.spawned_production_jobs[0],
    });

    // Stop keepalive and wait past VIDEO_MAKER_WATCHER_TTL_MS=2500ms (+ sweep 500ms) -> worker must flip Offline!
    clearInterval(keepaliveTimer);
    await sleep(3400);
    const expiredStatus = await httpRequestJson(testPort, "GET", "/api/ai/status");
    assert.equal(expiredStatus.body.online, false);
    assert.ok(sseEvents.some((e) => e.event === "worker_status" && e.data.online === false));
    console.log("PASS: auto_produce queued production job & expired worker flipped back to Offline cleanly.");

    console.log("=== 8. AI Providers Zero Key Leakage, Mock Handshakes, 401 Gate & Quota Extraction ===");
    const forbiddenSecrets = [
      mockProviders.keys.VALID_OPENAI_KEY,
      mockProviders.keys.VALID_DEEPSEEK_KEY,
      mockProviders.keys.VALID_OPENROUTER_KEY,
      mockProviders.keys.INVALID_OPENAI_KEY,
      mockProviders.keys.INVALID_ANTHROPIC_KEY,
      "123456",
      "987654",
      "555555",
      "999999",
    ];

    const initialProviders = await httpRequestJson(testPort, "GET", "/api/ai/providers?force=1");
    assert.equal(initialProviders.status, 200);
    assert.equal(initialProviders.body.providers.length, 9);
    assertNoSecretsLeaked(initialProviders.body, forbiddenSecrets, "initial GET /api/ai/providers");
    const initManual = initialProviders.body.providers.find((p) => p.id === "manual_web");
    const initOpenai = initialProviders.body.providers.find((p) => p.id === "openai");
    assert.equal(initManual.ready, true);
    assert.equal(initManual.auth_status, "ready");
    assert.equal(initOpenai.has_credential, false);
    assert.equal(initOpenai.auth_status, "unconfigured");

    // Save invalid OpenAI key -> auth_status="invalid", zero leakage, job creation rejected (401)
    const badCredRes = await httpRequestJson(testPort, "POST", "/api/ai/providers/credentials", {
      provider_id: "openai",
      api_key: mockProviders.keys.INVALID_OPENAI_KEY,
    });
    assert.equal(badCredRes.status, 200);
    assertNoSecretsLeaked(badCredRes.body, forbiddenSecrets, "POST invalid credentials");
    assert.equal(badCredRes.body.provider.has_credential, true);
    assert.equal(badCredRes.body.provider.auth_status, "invalid");
    assert.equal(badCredRes.body.provider.ready, false);

    const rejectedJobRes = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_episode",
      course: "TESTCOURSE",
      provider_id: "openai",
      episode_ids: ["ep03-test"],
    });
    assert.equal(rejectedJobRes.status, 401);
    assert.equal(rejectedJobRes.body.code, "AUTH_INVALID");

    // Save invalid Anthropic key too so UI BrandHealthGrid tests both is-auth-error and is-unconfigured
    const badAntRes = await httpRequestJson(testPort, "POST", "/api/ai/providers/credentials", {
      provider_id: "anthropic",
      api_key: mockProviders.keys.INVALID_ANTHROPIC_KEY,
    });
    assert.equal(badAntRes.status, 200);
    assert.equal(badAntRes.body.provider.auth_status, "invalid");
    assertNoSecretsLeaked(badAntRes.body, forbiddenSecrets, "POST invalid anthropic credentials");

    // Save valid keys for OpenAI, DeepSeek, and OpenRouter
    const okOpenaiRes = await httpRequestJson(testPort, "POST", "/api/ai/providers/credentials", {
      provider_id: "openai",
      api_key: mockProviders.keys.VALID_OPENAI_KEY,
    });
    assert.equal(okOpenaiRes.status, 200);
    assertNoSecretsLeaked(okOpenaiRes.body, forbiddenSecrets, "POST valid openai credentials");
    assert.equal(okOpenaiRes.body.provider.auth_status, "verified");
    assert.equal(okOpenaiRes.body.provider.ready, true);
    const openaiModelIds = okOpenaiRes.body.provider.models.map((m) => m.id);
    assert.ok(openaiModelIds.includes("gpt-4o"));
    assert.ok(openaiModelIds.includes("gpt-4.1-mini"));
    assert.equal(openaiModelIds.some((id) => /(embedding|whisper|tts|dall-e)/.test(id)), false);

    const okDeepseekRes = await httpRequestJson(testPort, "POST", "/api/ai/providers/credentials", {
      provider_id: "deepseek",
      api_key: mockProviders.keys.VALID_DEEPSEEK_KEY,
    });
    assert.equal(okDeepseekRes.status, 200);
    assertNoSecretsLeaked(okDeepseekRes.body, forbiddenSecrets, "POST valid deepseek credentials");
    assert.equal(okDeepseekRes.body.provider.auth_status, "verified");
    assert.equal(okDeepseekRes.body.provider.quota_info?.total_balance, "12.50");
    assert.equal(okDeepseekRes.body.provider.quota_info?.currency, "USD");
    assert.ok(okDeepseekRes.body.provider.quota_info?.summary.includes("12.50"));

    const okOrRes = await httpRequestJson(testPort, "POST", "/api/ai/providers/credentials", {
      provider_id: "openrouter",
      api_key: mockProviders.keys.VALID_OPENROUTER_KEY,
    });
    assert.equal(okOrRes.status, 200);
    assertNoSecretsLeaked(okOrRes.body, forbiddenSecrets, "POST valid openrouter credentials");
    assert.equal(okOrRes.body.provider.auth_status, "verified");
    assert.equal(okOrRes.body.provider.quota_info?.percent_remaining, 42);
    assert.ok(okOrRes.body.provider.quota_info?.summary.includes("42%"));

    // Verify GET /api/ai/providers leaks ZERO raw or masked keys
    const allProvidersRes = await httpRequestJson(testPort, "GET", "/api/ai/providers?force=1");
    assert.equal(allProvidersRes.status, 200);
    assertNoSecretsLeaked(allProvidersRes.body, forbiddenSecrets, "GET /api/ai/providers after keys saved");

    // Verify 1-token ping endpoint
    const pingRes = await httpRequestJson(testPort, "POST", "/api/ai/providers/test", {
      provider_id: "openai",
      model: "gpt-4o",
      ping_one_token: true,
    });
    assert.equal(pingRes.status, 200);
    assert.equal(pingRes.body.ok, true);
    assert.equal(pingRes.body.ping_result?.ok, true);
    assert.equal(mockProviders.state.pingCalls.length, 1);
    console.log("PASS: Zero key leakage, mock handshakes, 401 gate, DeepSeek/OpenRouter quota_info & 1-token ping verified.");

    console.log("=== 9. Refined UI (Roadmap Cards, BrandHealthGrid Selection, Studio Player Export/Revision/Calibrator) ===");
    // Mark ep01-test as production completed via state_cli.mjs so overall_status === "completed"
    const stateCliRes = spawnSync(
      process.execPath,
      [
        path.join(ENGINE_DIR, "state_cli.mjs"),
        "set",
        "--workspace",
        tmpWorkspace,
        "--course",
        "TESTCOURSE",
        "--ep",
        "ep01-test",
        "--stage",
        "production",
        "--status",
        "completed",
        "--tts-done",
        "true",
        "--video-done",
        "true",
        "--verified",
        "true",
      ],
      {
        cwd: ENGINE_DIR,
        encoding: "utf-8",
      }
    );
    assert.equal(stateCliRes.status, 0, `state_cli.mjs failed: ${stateCliRes.stderr}`);

    // Send a heartbeat so Antigravity shows unclipped "Online" badge inside BrandHealthGrid
    await httpRequestJson(testPort, "POST", "/api/ai/worker/heartbeat", {
      worker_id: "argon-e2e",
      model: "Gemini 4 Argon",
      mode: "watcher",
    });

    const uiRoadmapAndGridCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=roadmap&course=TESTCOURSE`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const completedCard = document.querySelector('.episode-card.status-completed');
          const plannedCard = document.querySelector('.episode-card.status-planned');
          const selectMultiBtn = document.querySelector('.btn-select-multi');
          if (completedCard && plannedCard && selectMultiBtn) break;
          await new Promise(r => setTimeout(r, 100));
        }

        const playBtnCount = document.querySelectorAll('.ep-btn-play').length;
        const completedCard = document.querySelector('.episode-card.status-completed');
        const scriptedCard = document.querySelector('.episode-card.status-script_ready');
        const plannedCards = Array.from(document.querySelectorAll('.episode-card.status-planned'));
        const gridText = document.querySelector('.episodes-grid')?.textContent || '';
        const completedHasAiBtn = Boolean(completedCard?.querySelector('.ep-btn-ai'));
        const scriptedHasAiBtn = Boolean(scriptedCard?.querySelector('.ep-btn-ai'));
        const plannedAiTexts = plannedCards.map((c) => c.querySelector('.ep-btn-ai')?.textContent?.trim() || '');
        const hasTitleTooltip = Boolean(completedCard?.querySelector('.episode-title-wrap .ep-title-tooltip'));

        // Open BrandHealthGrid via batch button to inspect selection UX & unclipped Antigravity "Online"
        const batchBtn = document.querySelector('.btn-ai-batch');
        batchBtn.click();
        await new Promise(r => setTimeout(r, 250));
        const modal = document.querySelector('.ai-script-modal');
        if (!modal) throw new Error('AiScriptModal did not open');

        const selectedCards = Array.from(modal.querySelectorAll('.brand-card.is-selected'));
        const selectedRadio = selectedCards[0]?.querySelector('.brand-radio-dot')?.textContent?.trim() || '';
        const selectedPill = selectedCards[0]?.querySelector('.brand-selected-pill')?.textContent?.trim() || '';
        const readyUnselected = Array.from(modal.querySelectorAll('.brand-card.is-ready:not(.is-selected)'));
        const unselectedRadios = readyUnselected.map((c) => c.querySelector('.brand-radio-dot')?.textContent?.trim() || '');
        const unselectedHasPill = readyUnselected.some((c) => Boolean(c.querySelector('.brand-selected-pill')));
        const readyIconsText = Array.from(modal.querySelectorAll('.brand-card.is-ready .brand-status-icon')).map((el) => el.textContent).join(' ');
        const activeSummaryChip = modal.querySelector('.brand-active-summary-chip')?.textContent?.trim() || '';
        const agyBadge = modal.querySelector('[data-provider-id="antigravity"] .brand-status-badge');
        const agyBadgeText = agyBadge?.textContent?.trim() || '';
        const agyBadgeClipped = agyBadge ? (agyBadge.scrollWidth > agyBadge.clientWidth + 2) : true;
        const unconfiguredCards = modal.querySelectorAll('.brand-card.is-unconfigured').length;
        const authErrorCards = modal.querySelectorAll('.brand-card.is-auth-error').length;
        const readyCards = modal.querySelectorAll('.brand-card.is-ready').length;
        const bodyHtml = document.body.innerHTML;

        modal.querySelector('.studio-modal-close').click();
        await new Promise(r => setTimeout(r, 150));

        // Multi-select mode + checkboxes + FloatingBatchBar
        const selectMultiBtn = document.querySelector('.btn-select-multi');
        selectMultiBtn.click();
        await new Promise(r => setTimeout(r, 120));
        const checkboxes = Array.from(document.querySelectorAll('.ep-select-checkbox.is-visible'));
        if (checkboxes.length >= 2) {
          checkboxes[0].click();
          checkboxes[1].click();
        }
        await new Promise(r => setTimeout(r, 150));
        const floatingBar = document.querySelector('.floating-batch-bar');
        const floatingText = floatingBar ? floatingBar.textContent : '';

        return {
          playBtnCount,
          completedHasAiBtn,
          scriptedHasAiBtn,
          gridHasRewriteKbText: gridText.includes('Viết lại KB'),
          plannedAiTexts,
          hasTitleTooltip,
          selectedCount: selectedCards.length,
          selectedRadio,
          selectedPill,
          unselectedRadios,
          unselectedHasPill,
          readyHasCheckEmoji: readyIconsText.includes('✅'),
          activeSummaryChip,
          agyBadgeText,
          agyBadgeClipped,
          unconfiguredCards,
          authErrorCards,
          readyCards,
          visibleCheckboxes: checkboxes.length,
          hasFloatingBar: Boolean(floatingBar),
          floatingText,
          bodyHtml,
        };
      })()`
    );
    assert.equal(uiRoadmapAndGridCheck.playBtnCount, 0);
    assert.equal(uiRoadmapAndGridCheck.completedHasAiBtn, false);
    assert.equal(uiRoadmapAndGridCheck.scriptedHasAiBtn, false);
    assert.equal(uiRoadmapAndGridCheck.gridHasRewriteKbText, false);
    assert.ok(uiRoadmapAndGridCheck.plannedAiTexts.length >= 4);
    assert.ok(uiRoadmapAndGridCheck.plannedAiTexts.every((t) => t.includes("Biên kịch")));
    assert.equal(uiRoadmapAndGridCheck.hasTitleTooltip, true);
    assert.equal(uiRoadmapAndGridCheck.selectedCount, 1);
    assert.equal(uiRoadmapAndGridCheck.selectedRadio, "◉");
    assert.equal(uiRoadmapAndGridCheck.selectedPill, "✓ Đang chọn");
    assert.ok(uiRoadmapAndGridCheck.unselectedRadios.length >= 2);
    assert.ok(uiRoadmapAndGridCheck.unselectedRadios.every((r) => r === "○"));
    assert.equal(uiRoadmapAndGridCheck.unselectedHasPill, false);
    assert.equal(uiRoadmapAndGridCheck.readyHasCheckEmoji, false);
    assert.ok(uiRoadmapAndGridCheck.activeSummaryChip.includes("Đang chọn:"));
    assert.equal(uiRoadmapAndGridCheck.agyBadgeText, "Online");
    assert.equal(uiRoadmapAndGridCheck.agyBadgeClipped, false);
    assert.ok(uiRoadmapAndGridCheck.unconfiguredCards >= 3);
    assert.ok(uiRoadmapAndGridCheck.authErrorCards >= 1);
    assert.ok(uiRoadmapAndGridCheck.readyCards >= 3);
    assert.equal(uiRoadmapAndGridCheck.visibleCheckboxes, 7);
    assert.equal(uiRoadmapAndGridCheck.hasFloatingBar, true);
    assert.ok(uiRoadmapAndGridCheck.floatingText.includes("Đã chọn 2 tập"));
    assert.ok(uiRoadmapAndGridCheck.floatingText.includes("Biên kịch hàng loạt (1 Model)"));
    assertNoSecretsLeaked(uiRoadmapAndGridCheck.bodyHtml, forbiddenSecrets, "Chrome UI Roadmap DOM");

    // Verify Studio Player topbar unified export popover, inline tab 🛠️ Sửa form & AI Rewrite modal (manual timing calibrator hidden from UI)
    const uiPlayerCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=player&course=TESTCOURSE&ep=ep01-test&scene=s1_matrix`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (document.querySelector('.btn-export-unified') && document.querySelector('.scenes-list')) break;
          await new Promise(r => setTimeout(r, 100));
        }

        const hasTopbarRevisionBtn = Boolean(document.querySelector('#btn-revision-topbar, .btn-revision-topbar'));
        const hasTimingCalibratorUi = Boolean(document.querySelector('.timing-calibrator-head, .timing-calibrator'));

        // 1) Unified Export Popover
        const exportBtn = document.querySelector('.btn-export-unified');
        exportBtn.click();
        await new Promise(r => setTimeout(r, 150));
        const popover = document.querySelector('.export-menu-popover');
        const qualityPillCount = popover ? popover.querySelectorAll('.render-opt-pill').length : 0;
        const hasTtsCheckbox = Boolean(popover?.querySelector('.export-tts-check-row input[type="checkbox"]'));
        const hasExportCta = Boolean(popover?.querySelector('.export-cta-btn'));
        const hasDownloadLink = Boolean(popover?.querySelector('.export-download-link'));
        const hasAnyDownloadBtn = Boolean(document.querySelector('.job-act-btn.is-download, a[href*="/api/download-video"]'));
        popover?.querySelector('.jobs-popover-close')?.click();
        await new Promise(r => setTimeout(r, 100));

        // 2) Confirm manual Timing Calibrator is removed from UI (handled automatically by Agents / tts_pipeline)
        const sceneCardsCount = document.querySelectorAll('.scenes-list .scene-item, .scenes-list button').length;

        // 3) Switch to tab 🛠️ Sửa -> Inline Revision Quick-Add + Scene switching + 🔄 Gửi AI Sửa Kịch Bản
        const sửaTab = Array.from(document.querySelectorAll('.drawer-tab')).find((b) => b.textContent.includes('Sửa'));
        if (!sửaTab) throw new Error('Tab Sửa not found in Studio Player');
        sửaTab.click();
        await new Promise(r => setTimeout(r, 150));

        const quickSelect = document.querySelector('.rev-quick-select');
        const defaultSceneValue = quickSelect ? quickSelect.value : '';
        if (quickSelect) {
          quickSelect.value = 's2_timeline';
          quickSelect.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 100));
        }
        const hasLockHintAfterSwitch = Boolean(document.querySelector('.rev-quick-lock-hint'));

        const aiRewriteBtn = document.querySelector('.rev-btn-ai-rewrite');
        if (!aiRewriteBtn) throw new Error('rev-btn-ai-rewrite not found in tab Sửa');
        aiRewriteBtn.click();
        await new Promise(r => setTimeout(r, 250));

        const modal = document.querySelector('.ai-script-modal');
        const hasRewriteNotice = Boolean(modal?.querySelector('.ai-rewrite-notice.is-warning'));
        const sharedTextarea = modal?.querySelector('#ai-shared-rewrite-note');
        const submitBtn = modal?.querySelector('.studio-modal-footer button[type="submit"]');
        const disabledWhenEmpty = submitBtn ? submitBtn.disabled : null;
        if (sharedTextarea) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(sharedTextarea, 'Cập nhật ví dụ STS AssumeRole');
          sharedTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 120));
        }
        const enabledAfterNote = submitBtn ? !submitBtn.disabled : false;

        return {
          hasTopbarRevisionBtn,
          hasTimingCalibratorUi,
          sceneCardsCount,
          popoverOpen: Boolean(popover),
          qualityPillCount,
          hasTtsCheckbox,
          hasExportCta,
          hasDownloadLink,
          hasAnyDownloadBtn,
          defaultSceneValue,
          hasLockHintAfterSwitch,
          aiRewriteText: aiRewriteBtn.textContent.trim(),
          hasRewriteNotice,
          disabledWhenEmpty,
          enabledAfterNote,
          bodyHtml: document.body.innerHTML,
        };
      })()`
    );
    assert.equal(uiPlayerCheck.hasTopbarRevisionBtn, false);
    assert.equal(uiPlayerCheck.hasTimingCalibratorUi, false);
    assert.ok(uiPlayerCheck.sceneCardsCount >= 1);
    assert.equal(uiPlayerCheck.popoverOpen, true);
    assert.ok(uiPlayerCheck.qualityPillCount >= 8);
    assert.equal(uiPlayerCheck.hasTtsCheckbox, true);
    assert.equal(uiPlayerCheck.hasExportCta, true);
    assert.equal(uiPlayerCheck.hasDownloadLink, false);
    assert.equal(uiPlayerCheck.hasAnyDownloadBtn, false);
    assert.equal(uiPlayerCheck.defaultSceneValue, "s1_matrix");
    assert.equal(uiPlayerCheck.hasLockHintAfterSwitch, true);
    assert.ok(uiPlayerCheck.aiRewriteText.includes("Gửi AI Sửa Kịch Bản"));
    assert.equal(uiPlayerCheck.hasRewriteNotice, true);
    assert.equal(uiPlayerCheck.disabledWhenEmpty, true);
    assert.equal(uiPlayerCheck.enabledAfterNote, true);
    assertNoSecretsLeaked(uiPlayerCheck.bodyHtml, forbiddenSecrets, "Chrome UI Player DOM");
    console.log("PASS: Chrome UI verified for Roadmap cards, BrandHealthGrid selection, unified Export popover, inline Revision form, AI Rewrite & Timing Calibrator.");

    console.log("=== 10. 7-Episode Batch (>5), 429 Pause, Stale Rewrite, Clean Release & Resume to DeepSeek ===");
    mockProviders.state.openaiMode = "quota_on_third";
    mockProviders.state.openaiChatCalls = 0;

    const batchRes = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_batch",
      course: "TESTCOURSE",
      provider_id: "openai",
      model: "gpt-4o",
      episode_ids: epIds,
      rewrite_notes: {
        "ep01-test": "Thêm phần so sánh STS Token TTL",
        _shared: "Giữ chuẩn 4 phần",
      },
      auto_produce: false,
    });
    assert.equal(batchRes.status, 202, `Expected 202 for 7-ep builtin batch, got ${batchRes.status}: ${JSON.stringify(batchRes.body)}`);
    const batchJobId = batchRes.body.job.id;

    // Verify last_selection persisted immediately to preferences file & API
    const prefsDisk = JSON.parse(fs.readFileSync(prefFile, "utf-8"));
    assert.equal(prefsDisk.last_selection?.provider_id, "openai");
    assert.equal(prefsDisk.last_selection?.model, "gpt-4o");
    const statusWithLastSel = await httpRequestJson(testPort, "GET", "/api/ai/status");
    assert.equal(statusWithLastSel.body.last_selection?.provider_id, "openai");

    // Wait for job to hit simulated 429 on ep03-test and transition to "paused"
    let pausedJob = null;
    const pauseDeadline = Date.now() + 10_000;
    while (Date.now() < pauseDeadline) {
      const jobsRes = await httpRequestJson(testPort, "GET", "/api/ai/jobs?course=TESTCOURSE");
      const found = (jobsRes.body.jobs || []).find((j) => j.id === batchJobId);
      if (found && found.status === "paused") {
        pausedJob = found;
        break;
      }
      await sleep(100);
    }
    assert.ok(pausedJob, "7-episode job did not transition to paused after 429");
    assert.equal(pausedJob.pause_reason, "quota_exhausted");
    assert.deepEqual(pausedJob.completed_episodes, ["ep01-test", "ep02-test"]);
    assert.equal(pausedJob.failed_episode, "ep03-test");

    // Verify incomplete ep03-test state released cleanly (not stuck in_progress/planning)
    const ep3State = JSON.parse(fs.readFileSync(path.join(stateDir, "ep03-test.json"), "utf-8"));
    assert.notEqual(ep3State.scripting?.status, "in_progress");
    assert.notEqual(ep3State.scripting?.status, "planning");

    // Verify re-scripting completed ep01-test set production.stale = true
    const ep1StateAfterRewrite = JSON.parse(fs.readFileSync(path.join(stateDir, "ep01-test.json"), "utf-8"));
    assert.equal(ep1StateAfterRewrite.production?.stale, true);

    // Verify Chrome UI shows .paused-resume-banner with 2/7 progress
    const uiPausedBannerCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=roadmap&course=TESTCOURSE`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const banner = document.querySelector('.paused-resume-banner');
          if (banner) {
            return {
              bannerText: banner.textContent,
              hasBtn: Boolean(banner.querySelector('.paused-resume-btn')),
            };
          }
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Paused resume banner did not render');
      })()`
    );
    assert.ok(uiPausedBannerCheck.bannerText.includes("2/7"));
    assert.equal(uiPausedBannerCheck.hasBtn, true);

    // Resume paused job by switching provider/model to DeepSeek
    const resumeRes = await httpRequestJson(testPort, "POST", "/api/ai/jobs/resume", {
      job_id: batchJobId,
      provider_id: "deepseek",
      model: "deepseek-chat",
    });
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.body.job.provider_id, "deepseek");

    let completedBatchJob = null;
    const resumeDeadline = Date.now() + 10_000;
    while (Date.now() < resumeDeadline) {
      const jobsRes = await httpRequestJson(testPort, "GET", "/api/ai/jobs?course=TESTCOURSE");
      const found = (jobsRes.body.jobs || []).find((j) => j.id === batchJobId);
      if (found && found.status === "completed") {
        completedBatchJob = found;
        break;
      }
      await sleep(100);
    }
    assert.ok(completedBatchJob, "Resumed job did not complete");
    assert.equal(completedBatchJob.completed_episodes.length, 7);
    assert.equal(mockProviders.state.deepseekRequests.length, 5);

    const providersAfterResume = await httpRequestJson(testPort, "GET", "/api/ai/providers");
    assert.equal(providersAfterResume.body.last_selection?.provider_id, "deepseek");
    assert.equal(providersAfterResume.body.last_selection?.model, "deepseek-chat");

    // Verify manual-prompt includes rewrite note & existing script, and manual-submit preserves production.stale=true
    const manualPromptRes = await httpRequestJson(testPort, "POST", "/api/ai/manual-prompt", {
      course: "TESTCOURSE",
      episode_id: "ep01-test",
      rewrite_note: "Giữ nguyên flow và sửa ví dụ STS",
    });
    assert.equal(manualPromptRes.status, 200);
    assert.equal(manualPromptRes.body.has_existing_script, true);
    assert.ok(manualPromptRes.body.full_prompt.includes("MANDATORY REWRITE INSTRUCTIONS"));
    assert.ok(manualPromptRes.body.full_prompt.includes("Giữ nguyên flow và sửa ví dụ STS"));

    const manualSubmitRes = await httpRequestJson(testPort, "POST", "/api/ai/manual-submit", {
      course: "TESTCOURSE",
      episode_id: "ep01-test",
      script_json: { title: "Manual Rewritten Ep1", scenes: [scenes[0]] },
      notes_md: "# Manual Rewrite Notes\n",
    });
    assert.equal(manualSubmitRes.status, 200);
    assert.equal(manualSubmitRes.body.state?.production?.stale, true);
    console.log("PASS: 7-ep batch pause/resume, clean state release, last_selection, rewrite prompt & production.stale=true verified.");

    console.log("=== 11. Universal Setup Adapters & --check --json Verification ===");
    const tmpSetupRoot = path.join(tmpWorkspace, "mock-repo-setup");
    const repoRoot = path.resolve(ENGINE_DIR, "..");
    fs.mkdirSync(path.join(tmpSetupRoot, "engine"), { recursive: true });
    fs.writeFileSync(path.join(tmpSetupRoot, "engine", "mcp_server.mjs"), "// stub\n", "utf-8");
    const srcPluginDir = path.join(repoRoot, "plugin", "tech-video-studio");
    const destPluginTemplate = path.join(tmpSetupRoot, "plugin", "tech-video-studio");
    fs.cpSync(srcPluginDir, destPluginTemplate, { recursive: true });

    const agyRes = installPluginToDir(path.join(tmpSetupRoot, ".agents", "plugins", "tech-video-studio"), {
      repoRoot: tmpSetupRoot,
      templateDir: destPluginTemplate,
    });
    assert.equal(agyRes.ok, true);

    const codexRes = installSkillAdapter({
      targetSkillsDir: path.join(tmpSetupRoot, ".agents", "skills"),
      repoRoot: tmpSetupRoot,
      templateDir: destPluginTemplate,
    });
    assert.equal(codexRes.ok, true);
    assert.equal(codexRes.skills.length, 4);

    const claudeSkillsRes = installSkillAdapter({
      targetSkillsDir: path.join(tmpSetupRoot, ".claude", "skills"),
      repoRoot: tmpSetupRoot,
      templateDir: destPluginTemplate,
    });
    assert.equal(claudeSkillsRes.ok, true);
    assert.equal(claudeSkillsRes.skills.length, 4);

    const mcpJsonRes = installMcpJson({
      mcpFilePath: path.join(tmpSetupRoot, ".mcp.json"),
      repoRoot: tmpSetupRoot,
    });
    assert.equal(mcpJsonRes.ok, true);

    const mockDesktopPath = path.join(tmpSetupRoot, "claude_desktop_config.json");
    fs.writeFileSync(
      mockDesktopPath,
      JSON.stringify({ mcpServers: { "existing-other-mcp": { command: "echo", args: ["ok"] } } }, null, 2),
      "utf-8"
    );
    const desktopRes = installClaudeDesktopConfig({
      configPath: mockDesktopPath,
      repoRoot: tmpSetupRoot,
    });
    assert.equal(desktopRes.ok, true);
    assert.ok(desktopRes.backupPath && fs.existsSync(desktopRes.backupPath), "Backup .bak must be created");
    assert.deepEqual(desktopRes.preservedServers, ["existing-other-mcp"]);
    const mergedDesktop = JSON.parse(fs.readFileSync(mockDesktopPath, "utf-8"));
    assert.ok(mergedDesktop.mcpServers["existing-other-mcp"]);
    assert.ok(mergedDesktop.mcpServers["tech-video-studio"]);

    const inspected = inspectWorkspaceAdapters(tmpSetupRoot, { claudeDesktopPath: mockDesktopPath });
    assert.equal(inspected.antigravityPlugin.ok, true);
    assert.equal(inspected.agentSkills.ok, true);
    assert.equal(inspected.claudeSkills.ok, true);
    assert.equal(inspected.claudeMcp.ok, true);
    assert.equal(inspected.claudeDesktop.ok, true);

    const envBoolCheck = checkAiEnvKeys({
      OPENAI_API_KEY: "sk-must-never-appear-in-check",
      DEEPSEEK_API_KEY: "",
    });
    assert.deepEqual(envBoolCheck, {
      OPENAI_API_KEY: true,
      ANTHROPIC_API_KEY: false,
      DEEPSEEK_API_KEY: false,
      GEMINI_API_KEY: false,
      OPENROUTER_API_KEY: false,
    });
    assertNoSecretsLeaked(envBoolCheck, ["sk-must-never-appear-in-check"], "checkAiEnvKeys");

    const setupCli = spawnSync(process.execPath, [path.join(repoRoot, "setup.mjs"), "--check", "--json"], {
      cwd: repoRoot,
      env: { ...process.env, OPENAI_API_KEY: "sk-cli-secret-should-be-bool" },
      encoding: "utf-8",
    });
    assert.equal(setupCli.status, 0, `setup.mjs --check --json failed: ${setupCli.stderr}`);
    assertNoSecretsLeaked(setupCli.stdout, ["sk-cli-secret-should-be-bool"], "setup.mjs --check --json stdout");
    const setupJson = JSON.parse(setupCli.stdout);
    assert.equal(setupJson.environment?.engine?.ok, true);
    assert.equal(setupJson.environment?.aiEnvKeys?.OPENAI_API_KEY, true);
    assert.equal(typeof setupJson.environment?.aiEnvKeys?.DEEPSEEK_API_KEY, "boolean");
    console.log("PASS: Setup adapters (antigravity + claude + codex + .mcp.json + .bak merge), boolean env check & setup.mjs --check --json verified.");

    console.log("=== 12. Multi-Voice A/B Preservation, 2-Layer Alignment, Scene Timings API & Recursive Audio Scan ===");
    const pythonBin = process.env.PYTHON_BIN || "python";
    const ep4Dir = path.join(courseDir, "episodes", "ep04-test");
    const ep4ScriptPath = path.join(ep4Dir, "script.json");
    const ep4Scenes = buildSampleScenes().map((s) => ({
      ...s,
      narration: s.id === "s1_matrix"
        ? "So sánh IAM User tĩnh với Access Key tĩnh vĩnh viễn. Và rủi ro lộ Secret khi commit Git."
        : s.narration,
    }));
    fs.writeFileSync(
      ep4ScriptPath,
      JSON.stringify(
        {
          course: "TESTCOURSE",
          episode_id: "ep04-test",
          title: "Multi-Voice & Sync Episode",
          total_duration_sec: 3.6,
          scenes: ep4Scenes,
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(ep4Dir, "notes.md"), "# Ep 4 Notes\n");
    fs.writeFileSync(path.join(ep4Dir, "ep04-test.webm"), Buffer.alloc(16_384, 0x1a));

    const ep4StateDone = spawnSync(
      process.execPath,
      [
        path.join(ENGINE_DIR, "state_cli.mjs"),
        "set",
        "--workspace",
        tmpWorkspace,
        "--course",
        "TESTCOURSE",
        "--ep",
        "ep04-test",
        "--stage",
        "production",
        "--status",
        "completed",
        "--tts-done",
        "true",
        "--video-done",
        "true",
        "--verified",
        "true",
      ],
      { cwd: ENGINE_DIR, encoding: "utf-8" }
    );
    assert.equal(ep4StateDone.status, 0, `state_cli.mjs ep04 failed: ${ep4StateDone.stderr}`);

    const customVoicesPath = path.join(tmpWorkspace, "test_voices.json");
    fs.writeFileSync(
      customVoicesPath,
      JSON.stringify(
        {
          default_profile: "voice-a",
          profiles: [
            {
              id: "voice-a",
              label: "Voice A (1.1s)",
              provider: "openai_compat",
              endpoint: `http://127.0.0.1:${mockProviders.port}/tts/speech`,
              voice_id: "voice-a",
              rate: "+0%",
              pitch: "+0Hz",
              language: "vi",
              response_format: "wav",
            },
            {
              id: "voice-b",
              label: "Voice B (1.8s)",
              provider: "openai_compat",
              endpoint: `http://127.0.0.1:${mockProviders.port}/tts/speech`,
              voice_id: "voice-b",
              rate: "+0%",
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

    // 1) Synthesize Voice A
    const ttsARes = await runSpawnAsync(
      pythonBin,
      [
        path.join(ENGINE_DIR, "tts_pipeline.py"),
        "--episode",
        ep4ScriptPath,
        "--voices",
        customVoicesPath,
        "--profile",
        "voice-a",
        "--json",
      ],
      { cwd: ENGINE_DIR }
    );
    assert.equal(ttsARes.status, 0, `tts_pipeline voice-a failed: ${ttsARes.stderr}\n${ttsARes.stdout}`);
    const ttsAJson = JSON.parse(ttsARes.stdout);
    assert.equal(ttsAJson.ok, true);
    assert.equal(ttsAJson.active_voice_track, "voice-a");
    assert.deepEqual(ttsAJson.voice_tracks, ["voice-a"]);
    assert.ok(fs.existsSync(path.join(ep4Dir, "audio", "voice-a", "s1_matrix.wav")));
    assert.ok(fs.existsSync(path.join(ep4Dir, "subtitles.voice-a.srt")));

    const scriptAfterA = JSON.parse(fs.readFileSync(ep4ScriptPath, "utf-8"));
    const baseTimingsSnapshot = JSON.stringify(scriptAfterA.scenes[0]._base_timings);
    assert.ok(scriptAfterA.scenes[0]._base_timings, "_base_timings must be snapshotted before first modification");

    // 2) Synthesize Voice B -> must preserve Voice A files & track, and keep _base_timings intact
    const ttsBRes = await runSpawnAsync(
      pythonBin,
      [
        path.join(ENGINE_DIR, "tts_pipeline.py"),
        "--episode",
        ep4ScriptPath,
        "--voices",
        customVoicesPath,
        "--profile",
        "voice-b",
        "--json",
      ],
      { cwd: ENGINE_DIR }
    );
    assert.equal(ttsBRes.status, 0, `tts_pipeline voice-b failed: ${ttsBRes.stderr}\n${ttsBRes.stdout}`);
    const ttsBJson = JSON.parse(ttsBRes.stdout);
    assert.equal(ttsBJson.ok, true);
    assert.equal(ttsBJson.active_voice_track, "voice-b");
    assert.deepEqual(ttsBJson.voice_tracks, ["voice-a", "voice-b"]);
    assert.ok(fs.existsSync(path.join(ep4Dir, "audio", "voice-a", "s1_matrix.wav")), "Voice A WAV must be preserved");
    assert.ok(fs.existsSync(path.join(ep4Dir, "subtitles.voice-a.srt")), "Voice A SRT must be preserved");
    assert.ok(fs.existsSync(path.join(ep4Dir, "audio", "voice-b", "s1_matrix.wav")), "Voice B WAV must exist");
    assert.ok(fs.existsSync(path.join(ep4Dir, "subtitles.voice-b.srt")), "Voice B SRT must exist");

    const scriptAfterB = JSON.parse(fs.readFileSync(ep4ScriptPath, "utf-8"));
    assert.ok(scriptAfterB.voice_tracks["voice-a"] && scriptAfterB.voice_tracks["voice-b"]);
    assert.equal(JSON.stringify(scriptAfterB.scenes[0]._base_timings), baseTimingsSnapshot, "_base_timings must not drift");

    // 3) Recursive inspectEpisodeArtifacts & state_cli.mjs sync across nested audio/<profile_id>/
    const scannedEp4 = inspectEpisodeArtifacts(courseDir, "ep04-test");
    assert.equal(scannedEp4.audio_count, 6);
    const syncRes = spawnSync(
      process.execPath,
      [path.join(ENGINE_DIR, "state_cli.mjs"), "sync", "--workspace", tmpWorkspace, "--course", "TESTCOURSE", "--json"],
      { cwd: ENGINE_DIR, encoding: "utf-8" }
    );
    assert.equal(syncRes.status, 0, `state_cli sync failed: ${syncRes.stderr}`);
    const ep4DiskStateAfterSync = JSON.parse(fs.readFileSync(path.join(stateDir, "ep04-test.json"), "utf-8"));
    assert.equal(ep4DiskStateAfterSync.artifacts?.audio_count, 6);

    // 4) Chrome UI verification for Multi-Voice A/B switcher in Studio Player
    const uiVoiceAbCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=player&course=TESTCOURSE&ep=ep04-test&scene=s1_matrix`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (document.querySelector('.voice-ab-switcher')) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const chips = document.querySelectorAll('.voice-ab-chip').length;
        const activePills = document.querySelectorAll('.voice-ab-pill.is-active').length;
        const delBtns = document.querySelectorAll('.voice-ab-del-btn').length;
        return { chips, activePills, delBtns };
      })()`
    );
    assert.equal(uiVoiceAbCheck.chips, 2);
    assert.equal(uiVoiceAbCheck.activePills, 1);
    assert.equal(uiVoiceAbCheck.delBtns, 1);

    // 5) Layer 1 --realign-only CLI + _base_timings preservation
    const realignCli = spawnSync(
      pythonBin,
      [
        path.join(ENGINE_DIR, "tts_pipeline.py"),
        "--realign-only",
        "--episode",
        ep4ScriptPath,
        "--scene",
        "s1_matrix",
        "--json",
      ],
      { cwd: ENGINE_DIR, encoding: "utf-8" }
    );
    assert.equal(realignCli.status, 0, `--realign-only failed: ${realignCli.stderr}\n${realignCli.stdout}`);
    const realignJson = JSON.parse(realignCli.stdout);
    assert.equal(realignJson.ok, true);
    assert.equal(realignJson.mode, "realign_only");
    assert.deepEqual(realignJson.aligned_scenes, ["s1_matrix"]);
    const scriptAfterRealign = JSON.parse(fs.readFileSync(ep4ScriptPath, "utf-8"));
    assert.equal(JSON.stringify(scriptAfterRealign.scenes[0]._base_timings), baseTimingsSnapshot);

    // 6) API POST /api/episodes/voice-track/activate -> swaps track cleanly & flags stale when video exists
    const activateRes = await httpRequestJson(testPort, "POST", "/api/episodes/voice-track/activate", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      profile_id: "voice-a",
    });
    assert.equal(activateRes.status, 200);
    assert.equal(activateRes.body.active_voice_track, "voice-a");
    assert.equal(activateRes.body.script?.scenes?.[0]?.audio_file, "audio/voice-a/s1_matrix.wav");
    assert.equal(activateRes.body.state?.production?.stale, true);

    // 7) Layer 2 POST /api/episodes/scene-timings (save Playhead timings + auto_align + production.stale=true)
    // Reset stale to false first so we prove scene-timings save sets production.stale = true
    spawnSync(
      process.execPath,
      [
        path.join(ENGINE_DIR, "state_cli.mjs"),
        "set",
        "--workspace",
        tmpWorkspace,
        "--course",
        "TESTCOURSE",
        "--ep",
        "ep04-test",
        "--stage",
        "production",
        "--status",
        "completed",
        "--video-done",
        "true",
        "--verified",
        "true",
      ],
      { cwd: ENGINE_DIR, encoding: "utf-8" }
    );

    const saveTimingsRes = await httpRequestJson(testPort, "POST", "/api/episodes/scene-timings", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      scene_id: "s1_matrix",
      action: "save",
      timings: {
        rows: [{ progress_start: 0.15 }, { progress_start: 0.55 }],
        takeaway: { show_at_progress: 0.82 },
      },
    });
    assert.equal(saveTimingsRes.status, 200);
    assert.equal(saveTimingsRes.body.scene?.visual_data?.rows?.[0]?.progress_start, 0.15);
    assert.equal(saveTimingsRes.body.scene?.visual_data?.takeaway?.show_at_progress, 0.82);
    assert.equal(
      saveTimingsRes.body.script?.voice_tracks?.["voice-a"]?.scene_data?.s1_matrix?.timings?.rows?.[0]?.progress_start,
      0.15
    );
    assert.equal(JSON.stringify(saveTimingsRes.body.scene?._base_timings), baseTimingsSnapshot);
    assert.equal(saveTimingsRes.body.state?.production?.stale, true);

    const autoAlignRes = await httpRequestJson(testPort, "POST", "/api/episodes/scene-timings", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      scene_id: "s1_matrix",
      action: "auto_align",
    });
    assert.equal(autoAlignRes.status, 200);
    assert.equal(autoAlignRes.body.ok, true);
    assert.equal(autoAlignRes.body.action, "auto_align");

    // 8) API POST /api/episodes/voice-track/delete (reject active, remove unused, guard last track)
    const delActiveRes = await httpRequestJson(testPort, "POST", "/api/episodes/voice-track/delete", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      profile_id: "voice-a",
    });
    assert.equal(delActiveRes.status, 409);

    const delUnusedRes = await httpRequestJson(testPort, "POST", "/api/episodes/voice-track/delete", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      profile_id: "voice-b",
    });
    assert.equal(delUnusedRes.status, 200);
    assert.equal(delUnusedRes.body.deleted_profile_id, "voice-b");
    assert.equal(fs.existsSync(path.join(ep4Dir, "audio", "voice-b")), false);
    assert.equal(fs.existsSync(path.join(ep4Dir, "subtitles.voice-b.srt")), false);
    assert.equal(fs.existsSync(path.join(ep4Dir, "audio", "voice-a", "s1_matrix.wav")), true);

    const delLastRes = await httpRequestJson(testPort, "POST", "/api/episodes/voice-track/delete", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      profile_id: "voice-a",
    });
    assert.equal(delLastRes.status, 400);
    console.log("PASS: Multi-voice A/B preservation, activate/delete APIs, 2-layer Subtitle-Cue & Playhead alignment, and recursive audio count verified.");

    console.log("=== 13. Video Files List, Custom Export Filename, Overwrite Warning, Preview Modal & Video Delete ===");
    // 1) Unit checks for resolveOutputFilename & render_video.mjs --output CLI flag
    assert.equal(resolveOutputFilename("ep04-test-60fps.mp4", "ep04-test", "webm"), "ep04-test-60fps.webm");
    assert.equal(resolveOutputFilename("  custom name  ", "ep04-test", "mp4"), "custom-name.mp4");
    assert.equal(resolveOutputFilename("", "ep04-test", "mp4"), "ep04-test.mp4");
    assert.equal(resolveOutputFilename("../evil/stem.mp4", "ep04-test", "mp4"), "evilstem.mp4");
    const renderHelp = spawnSync(process.execPath, [path.join(ENGINE_DIR, "render_video.mjs"), "--help"], {
      cwd: ENGINE_DIR,
      encoding: "utf-8",
    });
    assert.equal(renderHelp.status, 0);
    assert.ok(renderHelp.stdout.includes("--output"), "render_video.mjs --help must document --output");

    // 2) Verify GET /api/download-video is removed (404)
    const removedDownloadRes = await httpRequestJson(
      testPort,
      "GET",
      "/api/download-video?course=TESTCOURSE&episode=ep04-test"
    );
    assert.equal(removedDownloadRes.status, 404);

    // 3) Verify validateRenderOptions + sanitizeVideoOutputStem via POST /api/jobs/run-production
    const badStemProdRes = await httpRequestJson(testPort, "POST", "/api/jobs/run-production", {
      course: "TESTCOURSE",
      episode: "ep05-test",
      mode: "render_only",
      format: "mp4",
      codec: "h264",
      output_filename: "../evil.mp4",
    });
    assert.equal(badStemProdRes.status, 400);
    assert.ok(String(badStemProdRes.body?.error || "").includes("không hợp lệ"));

    const validStemNoAudioRes = await httpRequestJson(testPort, "POST", "/api/jobs/run-production", {
      course: "TESTCOURSE",
      episode: "ep05-test",
      mode: "render_only",
      format: "mp4",
      codec: "h264",
      output_filename: "ep05-custom 60fps.mp4",
    });
    assert.equal(validStemNoAudioRes.status, 400);
    assert.ok(
      String(validStemNoAudioRes.body?.error || "").includes("chưa có file audio"),
      `Expected missing-audio 400 after valid stem passed validateRenderOptions, got: ${JSON.stringify(validStemNoAudioRes.body)}`
    );

    // 4) Verify handleSaveVideo preserves custom stems & fallback ext without overwriting distinct stems
    const badSaveVideoRes = await httpRequestBinary(
      testPort,
      "POST",
      "/api/save-video?course=TESTCOURSE&episode=ep04-test&format=mp4&filename=../evil.mp4",
      Buffer.alloc(1024, 0x22),
      { "Content-Type": "video/mp4" }
    );
    assert.equal(badSaveVideoRes.status, 400);

    const saveCustomMp4Res = await httpRequestBinary(
      testPort,
      "POST",
      "/api/save-video?course=TESTCOURSE&episode=ep04-test&format=mp4&filename=ep04-test-60fps.mp4",
      Buffer.alloc(4096, 0x33),
      { "Content-Type": "video/mp4" }
    );
    assert.equal(saveCustomMp4Res.status, 200);
    assert.equal(saveCustomMp4Res.body.file, "ep04-test-60fps.mp4");

    // Simulate WebCodecs->MediaRecorder fallback saving .webm while preserving custom stem
    const saveFallbackWebmRes = await httpRequestBinary(
      testPort,
      "POST",
      "/api/save-video?course=TESTCOURSE&episode=ep04-test&format=webm&filename=ep04-test-60fps.mp4",
      Buffer.alloc(3072, 0x44),
      { "Content-Type": "video/webm" }
    );
    assert.equal(saveFallbackWebmRes.status, 200);
    assert.equal(saveFallbackWebmRes.body.file, "ep04-test-60fps.webm");

    const saveDefaultMp4Res = await httpRequestBinary(
      testPort,
      "POST",
      "/api/save-video?course=TESTCOURSE&episode=ep04-test&format=mp4&filename=ep04-test.mp4",
      Buffer.alloc(5120, 0x55),
      { "Content-Type": "video/mp4" }
    );
    assert.equal(saveDefaultMp4Res.status, 200);
    assert.equal(saveDefaultMp4Res.body.file, "ep04-test.mp4");

    // Verify inspectEpisodeArtifacts multi-file video_files[] scanning & metadata
    const ep4MultiArtifacts = inspectEpisodeArtifacts(courseDir, "ep04-test");
    assert.equal(ep4MultiArtifacts.video_files.length, 4);
    assert.ok(typeof ep4MultiArtifacts.video_file === "string" && ep4MultiArtifacts.video_file.length > 0);
    const scannedNames = ep4MultiArtifacts.video_files.map((f) => f.filename);
    assert.ok(scannedNames.includes("ep04-test.webm"));
    assert.ok(scannedNames.includes("ep04-test.mp4"));
    assert.ok(scannedNames.includes("ep04-test-60fps.mp4"));
    assert.ok(scannedNames.includes("ep04-test-60fps.webm"));
    const defaultEntry = ep4MultiArtifacts.video_files.find((f) => f.filename === "ep04-test.mp4");
    const customEntry = ep4MultiArtifacts.video_files.find((f) => f.filename === "ep04-test-60fps.mp4");
    assert.equal(defaultEntry?.is_default, true);
    assert.equal(customEntry?.is_default, false);
    assert.equal(customEntry?.format, "mp4");
    assert.equal(customEntry?.size_bytes, 4096);

    // Verify GET /api/courses exposes video_files[] with playback URLs
    const coursesMultiRes = await httpRequestJson(testPort, "GET", "/api/courses");
    assert.equal(coursesMultiRes.status, 200);
    const testCourseApi = (coursesMultiRes.body.courses || []).find((c) => c.id === "TESTCOURSE");
    const ep4Api = (testCourseApi?.episodes || []).find((e) => e.id === "ep04-test");
    assert.equal(ep4Api?.video_files?.length, 4);
    assert.ok(ep4Api.video_files.every((f) => f.url && f.url.startsWith("/courses/TESTCOURSE/episodes/ep04-test/")));

    // 5) Headless Chrome UI checks: 📁 Video đã xuất, pre-filled stem, live collision warning + -v2 quick-rename, preview modal
    const uiVideoFilesCheck = await runChromeUiCheck(
      testPort,
      `http://127.0.0.1:${testPort}/?view=player&course=TESTCOURSE&ep=ep04-test&scene=s1_matrix`,
      `(async () => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (document.querySelector('.ep-video-files-card') && document.querySelectorAll('.ep-video-file-row').length === 4) {
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }

        const filesTitle = document.querySelector('.ep-video-files-title')?.textContent?.trim() || '';
        const rowCount = document.querySelectorAll('.ep-video-file-row').length;
        const hasAnyDownload = Boolean(
          document.querySelector('.export-download-link, .job-act-btn.is-download, a[href*="/api/download-video"]')
        );

        // Open unified Export popover -> defaults to ep04-test + .mp4 -> collides with ep04-test.mp4
        document.querySelector('.btn-export-unified').click();
        await new Promise(r => setTimeout(r, 150));

        const filenameInput = document.querySelector('.export-filename-input');
        const initialStem = filenameInput ? filenameInput.value : '';
        const initialExt = document.querySelector('.export-filename-ext')?.textContent?.trim() || '';
        const initialCollisionText = document.querySelector('.export-collision-warn')?.textContent?.trim() || '';
        const initialCtaOverwrite = Boolean(document.querySelector('.export-cta-btn.is-overwrite'));
        const suggestBtn = document.querySelector('.export-suggest-btn');
        const suggestText = suggestBtn ? suggestBtn.textContent.trim() : '';

        if (!suggestBtn) throw new Error('Expected .export-suggest-btn on filename collision');
        suggestBtn.click();
        await new Promise(r => setTimeout(r, 150));

        const renamedStem = filenameInput ? filenameInput.value : '';
        const collisionAfterRename = Boolean(document.querySelector('.export-collision-warn'));
        const targetPathAfterRename = document.querySelector('.export-target-path')?.textContent?.trim() || '';
        const ctaOverwriteAfterRename = Boolean(document.querySelector('.export-cta-btn.is-overwrite'));

        // Close popover
        document.querySelector('.export-menu-popover .jobs-popover-close')?.click();
        await new Promise(r => setTimeout(r, 120));

        // Click ✏️ Chọn tên on a WEBM row to verify prefill + format switch to .webm
        const rows = Array.from(document.querySelectorAll('.ep-video-file-row'));
        const webmRow = rows.find((r) => r.textContent.includes('ep04-test-60fps.webm'));
        const pickNameBtn = Array.from(webmRow?.querySelectorAll('.ep-video-act-btn') || []).find((b) =>
          b.textContent.includes('Chọn tên')
        );
        if (!pickNameBtn) throw new Error('Pick filename button not found on webm row');
        pickNameBtn.click();
        await new Promise(r => setTimeout(r, 150));

        const pickedStem = document.querySelector('.export-filename-input')?.value || '';
        const pickedExt = document.querySelector('.export-filename-ext')?.textContent?.trim() || '';
        const pickedCollision = Boolean(document.querySelector('.export-collision-warn'));
        document.querySelector('.export-menu-popover .jobs-popover-close')?.click();
        await new Promise(r => setTimeout(r, 120));

        // Open ▶ Xem thử modal and close it
        const previewBtn = document.querySelector('.ep-video-act-btn.is-preview');
        if (!previewBtn) throw new Error('Preview button not found');
        previewBtn.click();
        await new Promise(r => setTimeout(r, 150));

        const modalOpen = Boolean(document.querySelector('.ep-video-modal-backdrop'));
        const hasVideoElement = Boolean(document.querySelector('.ep-video-preview-modal video.ep-video-preview-player'));
        const closePreviewBtn = document.querySelector('.ep-video-preview-modal .studio-modal-close');
        if (!closePreviewBtn) throw new Error('Preview modal close button not found');
        closePreviewBtn.click();
        await new Promise(r => setTimeout(r, 120));
        const modalClosed = !document.querySelector('.ep-video-modal-backdrop');

        return {
          filesTitle,
          rowCount,
          hasAnyDownload,
          initialStem,
          initialExt,
          initialCollisionText,
          initialCtaOverwrite,
          suggestText,
          renamedStem,
          collisionAfterRename,
          targetPathAfterRename,
          ctaOverwriteAfterRename,
          pickedStem,
          pickedExt,
          pickedCollision,
          modalOpen,
          hasVideoElement,
          modalClosed,
        };
      })()`
    );
    assert.ok(uiVideoFilesCheck.filesTitle.includes("Video đã xuất (4)"));
    assert.equal(uiVideoFilesCheck.rowCount, 4);
    assert.equal(uiVideoFilesCheck.hasAnyDownload, false);
    assert.equal(uiVideoFilesCheck.initialStem, "ep04-test");
    assert.equal(uiVideoFilesCheck.initialExt, ".mp4");
    assert.ok(uiVideoFilesCheck.initialCollisionText.includes("ep04-test.mp4"));
    assert.equal(uiVideoFilesCheck.initialCtaOverwrite, true);
    assert.ok(uiVideoFilesCheck.suggestText.includes("ep04-test-v2.mp4"));
    assert.equal(uiVideoFilesCheck.renamedStem, "ep04-test-v2");
    assert.equal(uiVideoFilesCheck.collisionAfterRename, false);
    assert.ok(uiVideoFilesCheck.targetPathAfterRename.includes("TESTCOURSE/episodes/ep04-test/ep04-test-v2.mp4"));
    assert.equal(uiVideoFilesCheck.ctaOverwriteAfterRename, false);
    assert.equal(uiVideoFilesCheck.pickedStem, "ep04-test-60fps");
    assert.equal(uiVideoFilesCheck.pickedExt, ".webm");
    assert.equal(uiVideoFilesCheck.pickedCollision, true);
    assert.equal(uiVideoFilesCheck.modalOpen, true);
    assert.equal(uiVideoFilesCheck.hasVideoElement, true);
    assert.equal(uiVideoFilesCheck.modalClosed, true);

    // 6) Verify POST /api/episodes/video/delete (invalid check, partial delete, last-file delete state reset)
    const badDelVideoRes = await httpRequestJson(testPort, "POST", "/api/episodes/video/delete", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      filename: "../evil.mp4",
    });
    assert.equal(badDelVideoRes.status, 400);

    const delOneVideoRes = await httpRequestJson(testPort, "POST", "/api/episodes/video/delete", {
      course: "TESTCOURSE",
      episode: "ep04-test",
      filename: "ep04-test-60fps.mp4",
    });
    assert.equal(delOneVideoRes.status, 200);
    assert.equal(delOneVideoRes.body.deleted, "ep04-test-60fps.mp4");
    assert.equal(delOneVideoRes.body.video_files.length, 3);
    assert.equal(fs.existsSync(path.join(ep4Dir, "ep04-test-60fps.mp4")), false);

    const ep4StateMidDelete = JSON.parse(fs.readFileSync(path.join(stateDir, "ep04-test.json"), "utf-8"));
    assert.equal(ep4StateMidDelete.production?.video_done, true);

    for (const remFile of ["ep04-test-60fps.webm", "ep04-test.mp4", "ep04-test.webm"]) {
      const delRem = await httpRequestJson(testPort, "POST", "/api/episodes/video/delete", {
        course: "TESTCOURSE",
        episode: "ep04-test",
        filename: remFile,
      });
      assert.equal(delRem.status, 200);
    }

    const ep4AfterAllDeleted = inspectEpisodeArtifacts(courseDir, "ep04-test");
    assert.equal(ep4AfterAllDeleted.video_files.length, 0);
    assert.equal(ep4AfterAllDeleted.video_file, null);
    const ep4StateCleared = JSON.parse(fs.readFileSync(path.join(stateDir, "ep04-test.json"), "utf-8"));
    assert.equal(ep4StateCleared.production?.video_done, false);
    assert.equal(ep4StateCleared.production?.verified, false);
    assert.equal(ep4StateCleared.production?.status, "pending");
    console.log("PASS: Video files list, custom export filename, collision warning, preview modal, and delete API verified.");

    console.log("=== 14. 7-Template SSOT Schema, Full Validator, Scene Metadata & Legacy Compat ===");
    assert.deepEqual(Object.keys(TEMPLATE_SPECS).sort(), [...SUPPORTED_VISUAL_TYPES].sort());
    assert.deepEqual(Object.keys(TEMPLATE_LAYOUT_BUDGETS).sort(), [...SUPPORTED_VISUAL_TYPES].sort());
    const schemaDoc = buildTemplatesSchemaDoc();
    assert.equal(schemaDoc.supported_visual_types.length, 7);
    assert.equal(Object.keys(schemaDoc.templates).length, 7);
    assert.equal(Object.keys(schemaDoc.layout_budgets).length, 7);
    assert.ok(schemaDoc.v2_motion_fields && schemaDoc.scene_metadata);
    assert.ok(getSchemaPromptSpec({ compact: false, pass: 1 }).includes("Pass 1"));
    assert.ok(getSchemaPromptSpec({ compact: true, pass: 1 }).includes("Pass 1"));
    assert.ok(getSchemaPromptSpec({ compact: false, pass: 2 }).includes("console_setup"));
    assert.ok(getSchemaPromptSpec({ compact: true, pass: 2 }).includes("exam_tips"));

    // console_setup validation (error on empty steps, warn on >4 fields & long tip)
    const badConsole = validateSingleScene({
      id: "cs_bad",
      part: "setup",
      narration: "Test",
      visual_type: "console_setup",
      visual_data: { steps: [] },
    });
    assert.equal(badConsole.valid, false);
    const warnConsole = validateSingleScene({
      id: "cs_warn",
      part: "setup",
      narration: "Test",
      visual_type: "console_setup",
      visual_data: {
        steps: [
          {
            step_number: 1,
            progress_start: 0,
            progress_end: 1,
            heading: "Step 1",
            fields: [1, 2, 3, 4, 5].map((n) => ({ label: `Field ${n}`, type: "text", value: "val" })),
            tip: "T".repeat(120),
          },
        ],
      },
    });
    assert.equal(warnConsole.valid, true);
    assert.equal(warnConsole.warnings.length, 2);

    // code_cli validation (reject invalid 1-based line, warn instead of failing on legacy layout: "code_only")
    const badCodeLine = validateSingleScene({
      id: "cc_bad",
      part: "setup",
      narration: "Test",
      visual_type: "code_cli",
      visual_data: {
        code_lines: ["line1", "line2"],
        highlight_phases: [{ progress_start: 0, progress_end: 1, lines: [3] }],
      },
    });
    assert.equal(badCodeLine.valid, false);
    const legacyCodeOnly = validateSingleScene({
      id: "cc_legacy",
      part: "setup",
      narration: "Test",
      visual_type: "code_cli",
      visual_data: {
        layout: "code_only",
        code_lines: ["line1", "line2"],
        highlight_phases: [{ progress_start: 0, progress_end: 1, lines: [1, 2] }],
      },
    });
    assert.equal(legacyCodeOnly.valid, true);
    assert.equal(legacyCodeOnly.warnings.some((w) => w.code === "legacy-layout"), true);

    // exam_tips validation
    const badExam = validateSingleScene({
      id: "ex_bad",
      part: "exam_tips",
      narration: "Test",
      visual_type: "exam_tips",
      visual_data: {
        quiz: {
          question: "Which?",
          options: [
            { key: "A", text: "One" },
            { key: "B", text: "Two" },
          ],
          correct_key: "Z",
        },
      },
    });
    assert.equal(badExam.valid, false);
    const goodExam = validateSingleScene({
      id: "ex_good",
      part: "exam_tips",
      narration: "Test",
      visual_type: "exam_tips",
      visual_data: {
        comparisons: [{ title: "Trap", wrong: "Static Key", right: "IAM Role" }],
        quiz: {
          question: "Which?",
          options: [
            { key: "A", text: "Static Key" },
            { key: "B", text: "IAM Role" },
          ],
          correct_key: "B",
        },
      },
    });
    assert.equal(goodExam.valid, true);

    // architecture flow_steps unknown ref + duplicate scene.id + invalid metadata
    const badFlowRef = validateSingleScene({
      id: "arch_bad_ref",
      part: "architecture",
      narration: "Test",
      visual_type: "architecture",
      visual_data: {
        layout_mode: "auto",
        nodes: [{ id: "n1", label: "Node 1" }],
        edges: [],
        flow_steps: [{ progress_start: 0, progress_end: 1, active_nodes: ["ghost_node"], active_edges: ["ghost_edge"] }],
      },
    });
    assert.equal(badFlowRef.valid, false);
    assert.equal(badFlowRef.errors.some((e) => e.code === "flow-step-unknown-node"), true);
    assert.equal(badFlowRef.errors.some((e) => e.code === "flow-step-unknown-edge"), true);

    const dupSceneRes = validateScriptDiagrams({
      scenes: [
        { id: "dup_id", part: "wrong_part", narration: "", visual_type: "exam_tips", visual_data: { comparisons: [{ title: "T", wrong: "W", right: "R" }] } },
        { id: "dup_id", part: "exam_tips", narration: "Valid", visual_type: "exam_tips", visual_data: { comparisons: [{ title: "T", wrong: "W", right: "R" }] } },
      ],
    });
    assert.equal(dupSceneRes.valid, false);
    assert.ok(dupSceneRes.errors.some((e) => typeof e === "string" && e.includes("Duplicate scene.id")));
    assert.ok(dupSceneRes.errors.some((e) => typeof e === "string" && e.includes('valid "part"')));
    assert.ok(dupSceneRes.errors.some((e) => typeof e === "string" && e.includes("narration")));
    console.log("PASS: 7-template SSOT, full validator, scene metadata, duplicate id & legacy layout compat verified.");

    console.log("=== 15. Zero-LLM Layered DAG Auto-Layout & Manual Coordinate Preservation ===");
    const autoArchData = {
      layout_mode: "auto",
      zones: [
        { id: "z_client", label: "Client", role: "client", node_ids: ["client"] },
        { id: "z_edge", label: "Edge", role: "network", node_ids: ["apigw", "auth"] },
        { id: "z_data", label: "Data", role: "data", node_ids: ["db"] },
      ],
      nodes: [
        { id: "client", label: "Client App", icon: "user", tone: "blue" },
        { id: "apigw", label: "API Gateway", icon: "apigw", tone: "orange" },
        { id: "auth", label: "Auth Lambda", icon: "lambda", tone: "purple" },
        { id: "db", label: "DynamoDB", icon: "dynamodb", tone: "green" },
      ],
      edges: [
        { id: "e_c_g", from: "client", to: "apigw", label: "HTTPS", routing: "auto" },
        { id: "e_g_a", from: "apigw", to: "auth", label: "Verify", routing: "auto" },
        { id: "e_a_g", from: "auth", to: "apigw", label: "Allow", routing: "auto" },
        { id: "e_g_d", from: "apigw", to: "db", label: "Query", routing: "auto" },
      ],
      flow_steps: [
        { progress_start: 0, progress_end: 0.5, active_nodes: ["client", "apigw"], active_edges: ["e_c_g"] },
        { progress_start: 0.5, progress_end: 1, active_nodes: ["apigw", "auth", "db"], active_edges: ["e_g_a", "e_a_g", "e_g_d"] },
      ],
    };
    const autoLayout = computeArchitectureLayout(autoArchData, 1000, 560);
    assert.equal(autoLayout.layoutMode, "auto");
    assert.equal(autoLayout.nodes.length, 4);
    for (const ln of autoLayout.nodes) {
      assert.ok(ln.xPct >= 8 && ln.xPct <= 92, `xPct out of [8..92]: ${ln.xPct}`);
      assert.ok(ln.yPct >= 14 && ln.yPct <= 84, `yPct out of [14..84]: ${ln.yPct}`);
    }
    const bidirEdges = autoLayout.edges.filter((e) => e.id === "e_g_a" || e.id === "e_a_g");
    assert.equal(bidirEdges.length, 2);
    assert.ok(bidirEdges.every((e) => e.routing === "curved"), "Bidirectional auto edges must promote to curved");
    const autoArchVal = validateArchitectureData(autoArchData, "auto_dag");
    assert.equal(autoArchVal.valid, true, `Auto-layout failed validation: ${JSON.stringify(autoArchVal.errors)}`);

    const manualArchData = {
      nodes: [
        { id: "m1", label: "Left", x: 20, y: 40 },
        { id: "m2", label: "Right", x: 75, y: 60 },
      ],
      edges: [{ id: "me1", from: "m1", to: "m2", label: "Call" }],
    };
    const manualLayout = computeArchitectureLayout(manualArchData, 1000, 560);
    assert.equal(manualLayout.nodes[0].xPct, 20);
    assert.equal(manualLayout.nodes[0].yPct, 40);
    assert.equal(manualLayout.nodes[1].xPct, 75);
    assert.equal(manualLayout.nodes[1].yPct, 60);
    console.log("PASS: Zero-LLM Layered DAG auto-layout, bidirectional curve upgrade & manual coord preservation verified.");

    console.log("=== 16. Runner 2-Pass Pipeline, Compaction, Normalization & Scene-Level Self-Repair ===");
    const hugeCurriculum = [
      "# Kubernetes Mastery",
      "Overview of cluster architecture.",
      ...Array.from({ length: 10 }, (_, stIdx) => [
        `## Stage ${stIdx + 1}: Module ${stIdx + 1}`,
        Array.from({ length: 8 }, (__, epIdx) => `- ep${stIdx * 8 + epIdx + 1}: Deep dive ${"z".repeat(120)}`).join("\n"),
      ].join("\n\n")),
    ].join("\n\n");
    const compactedCurric = extractRelevantCurriculumContext(hugeCurriculum, {
      id: "ep45",
      number: 45,
      stage: 6,
      title: "Module 6",
    });
    assert.ok(compactedCurric.length <= 2400 && compactedCurric.length > 200);
    assert.ok(compactedCurric.includes("ep45"));

    const normalizedNorm = normalizeCompiledScript(
      {
        scenes: [
          {
            id: "norm_arch",
            part: "architecture",
            narration: "Auto layout",
            visual_type: "architecture",
            visual_data: {
              nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
              edges: [{ id: "e1", from: "a", to: "b", label: "Go" }],
              flow_steps: [{ active_nodes: ["a"], active_edges: [] }, { active_nodes: ["b"], active_edges: ["e1"] }],
            },
          },
        ],
      },
      { courseJson: { course: "TESTCOURSE" }, episodeMeta: { id: "ep07-test", number: 7 } }
    );
    assert.equal(normalizedNorm.tts_profile, "auto-vi");
    assert.equal(normalizedNorm.tts_rate, "+6%");
    assert.equal(normalizedNorm.scenes[0].visual_data.layout_mode, "auto");
    assert.equal(normalizedNorm.scenes[0].visual_data.flow_steps[0].progress_start, 0);
    assert.equal(normalizedNorm.scenes[0].visual_data.flow_steps[0].progress_end, 0.5);
    assert.equal(normalizedNorm.scenes[0].visual_data.flow_steps[1].progress_start, 0.5);
    assert.equal(normalizedNorm.scenes[0].visual_data.flow_steps[1].progress_end, 1);

    // Isolated OpenAI-compatible mock server for 2-Pass + Scene-Level Repair
    const twoPassCalls = [];
    const twoPassSrv = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
        twoPassCalls.push(body);
        const sys = body.messages?.[0]?.content || "";
        const sendReply = (obj) => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }));
        };
        if (sys.includes("Scene Repair Assistant")) {
          return sendReply({
            scenes: [
              {
                id: "s_bad",
                part: "exam_tips",
                narration: "Repaired scene",
                visual_type: "exam_tips",
                visual_data: { comparisons: [{ title: "Trap", wrong: "Old", right: "New" }] },
              },
            ],
          });
        }
        if (sys.includes("Pass 2") && body.model === "compiler-model") {
          return sendReply({
            script_json: {
              title: "Compiled Two-Pass",
              scenes: [
                {
                  id: "s_ok",
                  part: "problem",
                  narration: "Valid intro",
                  visual_type: "exam_tips",
                  visual_data: { comparisons: [{ title: "T1", wrong: "W1", right: "R1" }] },
                },
                {
                  id: "s_bad",
                  part: "exam_tips",
                  narration: "Invalid quiz key",
                  visual_type: "exam_tips",
                  visual_data: {
                    quiz: {
                      question: "Q?",
                      options: [{ key: "A", text: "1" }, { key: "B", text: "2" }],
                      correct_key: "Z",
                    },
                  },
                },
              ],
            },
            notes_md: "# Compiled Notes",
          });
        }
        return sendReply({
          storyboard: {
            title: "Pass 1 Storyboard",
            scenes: [
              { id: "s_ok", part: "problem", visual_type: "exam_tips", narration: "Valid intro", visual_intent: {} },
              { id: "s_bad", part: "exam_tips", visual_type: "exam_tips", narration: "Quiz", visual_intent: {} },
            ],
          },
          notes_md: "# Storyboard Notes",
        });
      });
    });
    await new Promise((resolve) => twoPassSrv.listen(0, "127.0.0.1", resolve));
    const twoPassPort = twoPassSrv.address().port;
    const twoPassEngineDir = fs.mkdtempSync(path.join(tmpWorkspace, "runner-p2-"));
    fs.writeFileSync(
      path.join(twoPassEngineDir, ".ai_credentials.json"),
      JSON.stringify({ openai: { api_key: "sk-runner-p2-test-key-7777" } })
    );
    const prevOpenAiBase = process.env.VIDEO_MAKER_OPENAI_BASE_URL;
    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.VIDEO_MAKER_OPENAI_BASE_URL = `http://127.0.0.1:${twoPassPort}/v1`;
    process.env.OPENAI_API_KEY = "sk-runner-p2-test-key-7777";
    try {
      const sbOnlyRes = await generateEpisodeScript({
        provider_id: "openai",
        model: "planner-model",
        mode: "storyboard_only",
        courseJson: { course: "TESTCOURSE" },
        curriculumMd: hugeCurriculum,
        episodeMeta: { id: "ep45", number: 45 },
        engineDir: twoPassEngineDir,
      });
      assert.equal(sbOnlyRes.mode, "storyboard_only");
      assert.equal(sbOnlyRes.storyboard.scenes.length, 2);
      assert.equal(twoPassCalls.length, 1);

      twoPassCalls.length = 0;
      const twoPassRes = await generateEpisodeScript({
        provider_id: "openai",
        model: "planner-model",
        compiler_provider_id: "openai",
        compiler_model: "compiler-model",
        mode: "two_pass",
        courseJson: { course: "TESTCOURSE" },
        curriculumMd: hugeCurriculum,
        episodeMeta: { id: "ep45", number: 45 },
        engineDir: twoPassEngineDir,
      });
      assert.equal(twoPassRes.mode_used, "two_pass");
      assert.equal(twoPassRes.validation.valid, true);
      assert.equal(twoPassRes.script_json.scenes.length, 2);
      assert.equal(twoPassCalls.length, 3);
      assert.equal(twoPassCalls[0].model, "planner-model");
      assert.equal(twoPassCalls[1].model, "compiler-model");
      const repairPrompt = twoPassCalls[2].messages[1].content;
      assert.ok(repairPrompt.includes("s_bad") && !repairPrompt.includes("s_ok"));
    } finally {
      if (prevOpenAiBase === undefined) delete process.env.VIDEO_MAKER_OPENAI_BASE_URL;
      else process.env.VIDEO_MAKER_OPENAI_BASE_URL = prevOpenAiBase;
      if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAiKey;
      await new Promise((resolve) => twoPassSrv.close(resolve));
    }
    console.log("PASS: 2-Pass storyboard/compile, compaction, normalization & targeted scene-level self-repair verified.");

    console.log("=== 17. Offline Vendor/CSS, /courses/* Whitelist, Atomic /api/save-video & Canvas Tokenizer/wrapText ===");
    const stylesRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}/public/styles.css`, (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], len: Buffer.concat(c).length }));
      }).on("error", reject);
    });
    assert.equal(stylesRes.status, 200);
    assert.ok(String(stylesRes.type || "").includes("text/css"));
    assert.ok(stylesRes.len > 1000);

    const manifestRes = await httpRequestJson(testPort, "GET", "/vendor/vendor-manifest.json");
    assert.equal(manifestRes.status, 200);
    assert.equal(Object.keys(manifestRes.body?.importMap || {}).length, 14);

    const vendorReactRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}/vendor/esm/react@18.3.1/index.mjs`, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] }));
      }).on("error", reject);
    });
    assert.equal(vendorReactRes.status, 200);
    assert.ok(String(vendorReactRes.type || "").includes("javascript"));

    for (const blockedPath of [
      "/courses/.git/config",
      "/courses/.agents/skills/test",
      "/courses/engine/server.mjs",
      "/courses/NO_COURSE_JSON/foo.txt",
    ]) {
      const blocked = await httpRequestJson(testPort, "GET", blockedPath);
      assert.ok(blocked.status === 403 || blocked.status === 404, `Expected 403/404 for ${blockedPath}, got ${blocked.status}`);
    }
    const allowedCourseJson = await httpRequestJson(testPort, "GET", "/courses/TESTCOURSE/course.json");
    assert.equal(allowedCourseJson.status, 200);
    assert.equal(allowedCourseJson.body.course, "TESTCOURSE");

    // Atomic streaming /api/save-video size cap (413) & client abort .tmp cleanup on isolated media server
    const mediaHandlers = createMediaHandlers({
      ENGINE_DIR,
      WORKSPACE_ROOT: tmpWorkspace,
      VOICE_PREVIEW_CACHE_DIR: path.join(tmpWorkspace, ".voice_cache"),
      safeResolve: (root, segs) => {
        const target = path.resolve(root, ...segs);
        const rel = path.relative(root, target);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
        return target;
      },
      sendJson: (res, status, obj) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(obj));
      },
      readJsonBody: async () => ({}),
      sanitizeVideoOutputStem: (raw, fallback) => ({
        ok: true,
        stem: String(raw || fallback).replace(/\.(mp4|webm)$/i, "") || fallback,
      }),
      inspectEpisodeArtifacts,
      readEpisodeState,
      recomputeState: (s) => s,
      writeJsonAtomic: (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2)),
      appendEvent: () => {},
      scheduleStateBroadcast: () => {},
      mapEpisodeVideoFiles: () => [],
      broadcastSse: () => {},
      activeJobByEp: new Map(),
      jobs: new Map(),
      mutateEpisodeStateForJob: () => {},
    });
    const mediaSrv = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST" && parsedUrl.pathname === "/api/save-video") {
        return mediaHandlers.handleSaveVideo(req, res, parsedUrl);
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => mediaSrv.listen(0, "127.0.0.1", resolve));
    const mediaPort = mediaSrv.address().port;
    const prevMaxUpload = process.env.VIDEO_MAKER_MAX_UPLOAD_BYTES;
    process.env.VIDEO_MAKER_MAX_UPLOAD_BYTES = "2048";
    const ep5Dir = path.join(courseDir, "episodes", "ep05-test");
    try {
      const okSave = await httpRequestBinary(
        mediaPort,
        "POST",
        "/api/save-video?course=TESTCOURSE&episode=ep05-test&format=mp4&filename=ok-stream.mp4",
        Buffer.alloc(1024, 0x11),
        { "Content-Type": "video/mp4" }
      );
      assert.equal(okSave.status, 200);
      assert.equal(fs.existsSync(path.join(ep5Dir, "ok-stream.mp4")), true);

      const overCapRes = await httpRequestBinary(
        mediaPort,
        "POST",
        "/api/save-video?course=TESTCOURSE&episode=ep05-test&format=mp4&filename=too-big.mp4",
        Buffer.alloc(4096, 0x22),
        { "Content-Type": "video/mp4" }
      );
      assert.equal(overCapRes.status, 413);
      assert.equal(fs.existsSync(path.join(ep5Dir, "too-big.mp4")), false);

      // Client abort mid-stream must remove .tmp file cleanly
      await new Promise((resolve) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: mediaPort,
            path: "/api/save-video?course=TESTCOURSE&episode=ep05-test&format=mp4&filename=aborted.mp4",
            method: "POST",
            headers: { "Content-Type": "video/mp4", "Content-Length": "1024" },
          },
          () => resolve()
        );
        req.on("error", () => resolve());
        req.write(Buffer.alloc(256, 0x33));
        setTimeout(() => {
          req.destroy(new Error("Simulated client abort"));
          setTimeout(resolve, 150);
        }, 80);
      });
      let leftoverTmp = [];
      for (let i = 0; i < 20; i++) {
        leftoverTmp = fs.readdirSync(ep5Dir).filter((f) => f.endsWith(".tmp"));
        if (leftoverTmp.length === 0) break;
        await sleep(100);
      }
      assert.deepEqual(leftoverTmp, [], `Expected 0 leftover .tmp files, got: ${leftoverTmp.join(", ")}`);
      assert.equal(fs.existsSync(path.join(ep5Dir, "aborted.mp4")), false);
    } finally {
      if (prevMaxUpload === undefined) delete process.env.VIDEO_MAKER_MAX_UPLOAD_BYTES;
      else process.env.VIDEO_MAKER_MAX_UPLOAD_BYTES = prevMaxUpload;
      await new Promise((resolve) => mediaSrv.close(resolve));
    }

    // Canvas 2D tokyo-night tokenization + registerShikiTokens + wrapText memoization
    const jsonToks = tokenizeCodeLine('  "Effect": "Allow", // rule', "json", true);
    assert.ok(jsonToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.property));
    assert.ok(jsonToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.string));
    assert.ok(jsonToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.comment));
    const pyToks = tokenizeCodeLine("def handler(event): # ok", "python");
    assert.ok(pyToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.keyword));
    assert.ok(pyToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.function));
    const shToks = tokenizeCodeLine("aws s3 ls --recursive", "bash");
    assert.ok(shToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.keyword));
    assert.ok(shToks.some((t) => t.color === TOKYO_NIGHT_PALETTE.flag));

    const drawnColors = [];
    const mockCtx = {
      font: '500 20px "JetBrains Mono", monospace',
      fillStyle: "#FFFFFF",
      strokeStyle: "#FFFFFF",
      lineWidth: 1,
      globalAlpha: 1,
      shadowBlur: 0,
      shadowColor: "transparent",
      textAlign: "left",
      textBaseline: "middle",
      save() {},
      restore() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      stroke() {},
      fillRect() {},
      moveTo() {},
      lineTo() {},
      measureText(str) {
        return { width: String(str || "").length * 9 };
      },
      fillText(txt) {
        drawnColors.push({ txt: String(txt), color: this.fillStyle });
      },
    };
    const w1 = wrapText(mockCtx, "Alpha Beta Gamma Delta Epsilon Zeta", 110);
    const w2 = wrapText(mockCtx, "Alpha Beta Gamma Delta Epsilon Zeta", 110);
    assert.equal(w1, w2, "wrapText must return memoized array for identical font+maxWidth+text");
    assert.ok(w1.length >= 2);
    const customCode = "const secretToken = 42;";
    registerShikiTokens(customCode, "javascript", [[{ content: customCode, color: "#12ABCD", fontStyle: 2 }]]);
    drawCodeCliScene(
      mockCtx,
      1920,
      1080,
      {
        visual_type: "code_cli",
        visual_data: {
          code_language: "javascript",
          code_title: "shiki-test.js",
          code_lines: [customCode],
          highlight_phases: [{ progress_start: 0, progress_end: 1, lines: [1], callout: "Token check" }],
        },
      },
      0.5,
      1.0
    );
    assert.ok(drawnColors.some((d) => d.txt.includes("secretToken") && d.color === "#12ABCD"));
    console.log("PASS: Offline /vendor & /public/styles.css, /courses/* whitelist, atomic /api/save-video & Canvas tokyo-night/wrapText verified.");

    console.log("\nALL TESTS PASSED!");
  } finally {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    if (sseReq) {
      try {
        sseReq.destroy();
      } catch {
        // ignore
      }
    }
    if (mcpClient) mcpClient.close();
    if (workerWaitProc && workerWaitProc.exitCode === null) {
      try {
        workerWaitProc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    if (serverProc && serverProc.exitCode === null) {
      try {
        serverProc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    await mockProviders.close().catch(() => {});
    await sleep(300);
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

runTests().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
