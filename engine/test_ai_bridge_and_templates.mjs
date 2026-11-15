import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUPPORTED_VISUAL_TYPES,
  computeComparisonMatrixState,
  computeKpiMetricsState,
  computeTimelineFlowState,
  getSceneBurstInfo,
} from "./src/motion/kernel.mjs";
import { validateScriptDiagrams } from "./src/diagram_validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = __dirname;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // Create isolated temp workspace for Server + MCP + Chrome E2E
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-e2e-"));
  const testPort = await getFreePort();
  const queueFile = path.join(tmpWorkspace, ".ai_queue.json");
  let serverProc = null;
  let mcpClient = null;
  let workerWaitProc = null;
  let sseReq = null;
  let keepaliveTimer = null;

  try {
    const courseDir = path.join(tmpWorkspace, "TESTCOURSE");
    const stateDir = path.join(courseDir, "state");
    const ep1Dir = path.join(courseDir, "episodes", "ep01-test");
    const ep2Dir = path.join(courseDir, "episodes", "ep02-test");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(ep1Dir, { recursive: true });
    fs.mkdirSync(ep2Dir, { recursive: true });

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
              episodes: [
                { id: "ep01-test", number: 1, title: "Test Episode 1", duration_target: "3m" },
                { id: "ep02-test", number: 2, title: "Test Episode 2", duration_target: "3m" },
              ],
            },
          ],
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(courseDir, "curriculum.md"), "# TESTCOURSE\n- ep01-test\n- ep02-test\n");

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
    fs.writeFileSync(path.join(stateDir, "ep01-test.json"), JSON.stringify(initState("ep01-test", 1, "Test Episode 1"), null, 2));
    fs.writeFileSync(path.join(stateDir, "ep02-test.json"), JSON.stringify(initState("ep02-test", 2, "Test Episode 2"), null, 2));
    fs.writeFileSync(path.join(stateDir, "events.jsonl"), "");

    const stderrRef = { buf: "" };
    serverProc = spawn(process.execPath, [path.join(ENGINE_DIR, "server.mjs")], {
      cwd: ENGINE_DIR,
      env: {
        ...process.env,
        PORT: String(testPort),
        VIDEO_MAKER_WORKSPACE_ROOT: tmpWorkspace,
        VIDEO_MAKER_AI_QUEUE_FILE: queueFile,
        VIDEO_MAKER_WATCHER_TTL_MS: "2500",
        VIDEO_MAKER_SWEEP_INTERVAL_MS: "500",
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

    console.log("=== 3. MCP Stdio Handshake & Whitelist Verification ===");
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
    console.log("PASS: MCP JSON-RPC 2.0 initialize & strict 9-tool whitelist verified.");

    console.log("=== 4. Offline Gate, Task Whitelist, worker_wait.mjs Wakeup & Full MCP Flow ===");
    // Verify Offline 503 gate before any heartbeat
    const offlinePost = await httpRequestJson(testPort, "POST", "/api/ai/jobs", {
      type: "script_episode",
      course: "TESTCOURSE",
      episode_ids: ["ep01-test"],
    });
    assert.equal(offlinePost.status, 503);
    assert.equal(offlinePost.body.code, "WORKER_OFFLINE");

    // Verify Browser UI renders Offline badge & disabled buttons before worker starts
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
            return {
              pillText: pill.textContent,
              pillOffline: pill.classList.contains('is-offline'),
              batchDisabled: batchBtn.disabled,
              epDisabled: epBtn.disabled,
              bannerPresent: Boolean(document.querySelector('.worker-offline-banner')),
            };
          }
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Roadmap controls never mounted');
      })()`
    );
    assert.equal(uiOfflineCheck.pillOffline, true);
    assert.equal(uiOfflineCheck.batchDisabled, true);
    assert.equal(uiOfflineCheck.epDisabled, true);
    assert.equal(uiOfflineCheck.bannerPresent, true);

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

    console.log("=== 6. Headless Canvas 2D Video Export of All 3 New Templates ===");
    const renderCode = await new Promise((resolve, reject) => {
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
          reject(new Error(`render_video exited ${code}:\nOUT:\n${out}\nERR:\n${err}`));
        } else {
          resolve(code);
        }
      });
    });
    assert.equal(renderCode, 0);
    const outWebmPath = path.join(ep1Dir, "ep01-test.webm");
    assert.ok(fs.existsSync(outWebmPath), "Rendered .webm must exist");
    const webmSize = fs.statSync(outWebmPath).size;
    assert.ok(webmSize > 10_000, `Rendered .webm looks too small (${webmSize} bytes)`);
    console.log(`PASS: Headless Canvas 2D WebM export succeeded (${webmSize} bytes) covering comparison_matrix, timeline_flow, kpi_metrics.`);

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
