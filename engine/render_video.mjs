import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = __dirname;
const WORKSPACE_ROOT = process.env.VIDEO_MAKER_WORKSPACE_ROOT
  ? path.resolve(process.env.VIDEO_MAKER_WORKSPACE_ROOT)
  : path.resolve(ENGINE_DIR, "..");
const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const VALID_FORMATS = new Set(["mp4", "webm"]);
const VALID_CODECS = new Set(["h264", "hevc", "vp9"]);
const VALID_HARDWARE = new Set(["auto", "gpu", "cpu"]);
const VALID_RESOLUTIONS = new Set(["720p", "1080p", "1440p", "2160p"]);
const VALID_FPS = new Set([24, 30, 60]);
const VALID_SPEEDS = new Set([1, 1.25, 1.5, 2]);
// "hyperframes" (default): HyperFrames composition + zero-dep CDP capture + WebCodecs (engine/hyperframes/).
// "legacy": previous Canvas 2D exporter (window.__STUDIO_RENDER_OFFLINE__ in engine/src/exporter.mjs).
const VALID_ENGINES = new Set(["hyperframes", "legacy"]);
const VALID_CAPTURE_FORMATS = new Set(["jpeg", "png"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(
    `Usage: node render_video.mjs --course <COURSE> --episode <EP_ID> [--engine hyperframes|legacy] [--port 3030] [--format mp4|webm] [--codec h264|hevc|vp9] [--hardware auto|gpu|cpu] [--resolution 720p|1080p|1440p|2160p] [--fps 24|30|60] [--speed 1|1.25|1.5|2] [--output <filename>] [--timeout-ms 900000]\n` +
      `       HyperFrames-only: [--workers 1..8] [--capture-format jpeg|png] [--jpeg-quality 50..100] [--compile-only]\n` +
      `       Default engine: hyperframes (or env TVS_RENDER_ENGINE). See engine/HYPERFRAMES_ENGINE.md.`
  );
}

function resolveExpectedOutputFilename(rawName, episodeId, actualExt) {
  const safeExt = String(actualExt || "").toLowerCase() === "mp4" ? "mp4" : "webm";
  const fallbackStem =
    String(episodeId || "video")
      .trim()
      .replace(/[\\/]+/g, "")
      .replace(/\.(mp4|webm)$/i, "") || "video";

  let stem = String(rawName ?? "").trim();
  stem = stem.replace(/[\\/]+/g, "").replace(/\.\.+/g, ".");
  while (/\.(mp4|webm)$/i.test(stem)) {
    stem = stem.replace(/\.(mp4|webm)$/i, "");
  }
  stem = stem.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  stem = stem.replace(/^\.+/, "").slice(0, 96);
  if (!stem || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,95}$/.test(stem)) {
    stem = fallbackStem;
  }
  return `${stem}.${safeExt}`;
}

function defaultTimeoutForOptions(opts) {
  let base = 900_000;
  if (opts.resolution === "1440p") base = 1_200_000;
  if (opts.resolution === "2160p") base = 1_800_000;
  if (opts.fps === 60 && opts.resolution !== "720p") {
    base = Math.max(base, 900_000);
  }
  // HyperFrames captures every frame through the DOM: allow a 4x larger safety margin.
  return opts.engine === "legacy" ? base : base * 4;
}

function parseArgs(argv) {
  const opts = {
    course: "",
    episode: "",
    port: 3030,
    format: "mp4",
    codec: "",
    hardware: "auto",
    resolution: "1080p",
    fps: 60,
    speed: 1,
    output: "",
    timeoutMs: null,
    help: false,
    engine: String(process.env.TVS_RENDER_ENGINE || "hyperframes").toLowerCase(),
    workers: 0,
    captureFormat: "jpeg",
    jpegQuality: 92,
    compileOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--engine") {
      opts.engine = String(argv[++i] || "hyperframes").toLowerCase();
    } else if (arg === "--workers") {
      opts.workers = Number(argv[++i] || 0);
    } else if (arg === "--capture-format") {
      opts.captureFormat = String(argv[++i] || "jpeg").toLowerCase();
    } else if (arg === "--jpeg-quality") {
      opts.jpegQuality = Number(argv[++i] || 92);
    } else if (arg === "--compile-only") {
      opts.compileOnly = true;
    } else if (arg === "--course") {
      opts.course = argv[++i] || "";
    } else if (arg === "--episode" || arg === "--ep") {
      opts.episode = argv[++i] || "";
    } else if (arg === "--port") {
      opts.port = Number(argv[++i] || 3030);
    } else if (arg === "--format") {
      opts.format = String(argv[++i] || "mp4").toLowerCase();
    } else if (arg === "--codec") {
      opts.codec = String(argv[++i] || "").toLowerCase();
    } else if (arg === "--hardware") {
      opts.hardware = String(argv[++i] || "auto").toLowerCase();
    } else if (arg === "--resolution") {
      opts.resolution = String(argv[++i] || "1080p").toLowerCase();
    } else if (arg === "--fps") {
      opts.fps = Number(argv[++i] || 60);
    } else if (arg === "--speed") {
      opts.speed = Number(argv[++i] || 1);
    } else if (arg === "--output") {
      opts.output = String(argv[++i] || "").trim();
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[++i] || 900_000);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.codec) {
    opts.codec = opts.format === "webm" ? "vp9" : "h264";
  }
  if (opts.timeoutMs === null) {
    opts.timeoutMs = defaultTimeoutForOptions(opts);
  }

  return opts;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const text = Buffer.concat(chunks).toString("utf-8");
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Timeout contacting ${url}`));
    });
    req.on("error", reject);
  });
}

async function isServerRunning(port) {
  try {
    const data = await httpGetJson(`http://127.0.0.1:${port}/api/courses`, 1500);
    return Array.isArray(data?.courses);
  } catch {
    return false;
  }
}

async function ensureServer(port) {
  if (await isServerRunning(port)) {
    console.log(`[render_video] Using existing server at http://localhost:${port}`);
    return null;
  }

  console.log(`[render_video] Starting temporary server.mjs on port ${port}...`);
  const serverScript = path.join(ENGINE_DIR, "server.mjs");
  const child = spawn(process.execPath, [serverScript], {
    cwd: ENGINE_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Temporary server.mjs exited early (${child.exitCode}): ${stderrBuf}`);
    }
    if (await isServerRunning(port)) {
      console.log(`[render_video] Temporary server ready on http://localhost:${port}`);
      return child;
    }
    await sleep(200);
  }

  child.kill();
  throw new Error(`Timed out waiting for temporary server.mjs on port ${port}`);
}

async function waitForCdpTarget(cdpPort, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await httpGetJson(`http://127.0.0.1:${cdpPort}/json/list`, 1000);
      const page = Array.isArray(list)
        ? list.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ||
          list.find((t) => t.webSocketDebuggerUrl)
        : null;
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome DevTools HTTP endpoint not ready yet
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Chrome CDP target on port ${cdpPort}`);
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const eventHandlers = new Map();

  const openPromise = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (err) => reject(new Error(err?.message || "CDP WebSocket error")));
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
        } else {
          entry.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      const handlers = eventHandlers.get(msg.method);
      if (handlers) {
        for (const fn of handlers) {
          try {
            fn(msg.params);
          } catch {
            // Ignore handler error
          }
        }
      }
    }
  });

  ws.addEventListener("close", () => {
    for (const [, entry] of pending) {
      entry.reject(new Error(`CDP WebSocket closed before ${entry.method} completed`));
    }
    pending.clear();
  });

  function send(method, params = {}, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`CDP WebSocket is not open (state=${ws.readyState})`));
        return;
      }
      const id = nextId++;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id);
                reject(new Error(`CDP timeout after ${timeoutMs}ms for ${method}`));
              }
            }, timeoutMs)
          : null;

      pending.set(id, {
        method,
        resolve: (res) => {
          if (timer) clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });

      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  function on(method, handler) {
    if (!eventHandlers.has(method)) eventHandlers.set(method, new Set());
    eventHandlers.get(method).add(handler);
  }

  function close() {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch {
      // Ignore close error
    }
  }

  return { openPromise, send, on, close };
}

async function terminateProcess(proc, label, waitMs = 3000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    proc.once("exit", finish);
    proc.once("close", finish);
    try {
      proc.kill();
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }
      setTimeout(finish, 300);
    }, waitMs);
  });
  if (proc.exitCode === null && proc.signalCode === null) {
    console.warn(`[render_video] Warning: ${label} did not report exit cleanly`);
  }
}

async function waitForOfflineRenderer(cdp, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let injectedFallback = false;

  while (Date.now() < deadline) {
    const check = await cdp.send("Runtime.evaluate", {
      expression: `({ isHttp: typeof location === "object" && String(location.protocol || "").startsWith("http"), ready: document.readyState, hasFn: typeof window.__STUDIO_RENDER_OFFLINE__ === "function" })`,
      returnByValue: true,
    }).catch(() => null);
    const val = check?.result?.value;
    if (val?.isHttp && val?.hasFn) {
      return;
    }
    if (val?.isHttp && val?.ready === "complete" && !injectedFallback) {
      const importResp = await cdp.send("Runtime.evaluate", {
        expression: `import("/src/exporter.mjs").then(() => typeof window.__STUDIO_RENDER_OFFLINE__ === "function")`,
        awaitPromise: true,
        returnByValue: true,
      }).catch(() => null);
      if (!importResp?.exceptionDetails && importResp?.result?.value === true) {
        injectedFallback = true;
        return;
      }
    }
    await sleep(250);
  }

  throw new Error("Timed out waiting for window.__STUDIO_RENDER_OFFLINE__ to become ready");
}

/**
 * Default engine: compile the episode to a HyperFrames project and render it with the zero-dep
 * CDP capture + WebCodecs pipeline (engine/hyperframes/render.mjs). Same CLI contract, progress
 * lines ("[render] NN% ...") and output location as the legacy engine.
 */
async function runHyperframesRender(opts, epDir) {
  const { renderEpisodeHyperframes } = await import("./hyperframes/render.mjs");
  const startMs = Date.now();
  let cancelled = false;
  let chrome = null;

  const requestCancel = (reason) => {
    if (cancelled) return;
    cancelled = true;
    console.warn(`[render_video] Cancellation requested (${reason}); closing browser...`);
    if (chrome) chrome.close().catch(() => {});
  };
  const onSigInt = () => requestCancel("SIGINT");
  const onSigTerm = () => requestCancel("SIGTERM");
  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);
  const onStdinData = (chunk) => {
    if (String(chunk || "").toUpperCase().includes("CANCEL")) requestCancel("stdin CANCEL");
  };
  if (process.stdin && !process.stdin.isTTY) {
    try {
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", onStdinData);
      process.stdin.resume();
      process.stdin.unref();
    } catch {
      // Ignore stdin pipe errors
    }
  }

  try {
    console.log(
      `[render] 0% Starting HyperFrames render pipeline (${opts.resolution} @ ${opts.fps}fps, ${opts.speed}x, ${opts.format}/${opts.codec}, hw=${opts.hardware})...`
    );

    if (opts.compileOnly) {
      const { compileEpisodeProject } = await import("./hyperframes/compiler.mjs");
      const { ensureStudioServer, fetchEpisodePayload, projectUrl } = await import("./hyperframes/studio_server.mjs");
      const server = await ensureStudioServer(opts.port, { workspaceRoot: WORKSPACE_ROOT });
      try {
        const episode = await fetchEpisodePayload(opts.port, opts.course, opts.episode);
        const { projectDir, manifest } = await compileEpisodeProject({
          workspaceRoot: WORKSPACE_ROOT,
          courseId: opts.course,
          episode,
          speed: opts.speed,
        });
        console.log(`[render] 100% Compiled HyperFrames project (${manifest.total_duration}s, ${manifest.scenes.length} scenes)`);
        console.log(`[render_video] PROJECT: ${projectDir}`);
        console.log(`[render_video] PREVIEW: ${projectUrl(opts.port, opts.course, opts.episode)} (while server.mjs runs)`);
      } finally {
        await server.stop();
      }
      return;
    }

    const timer = setTimeout(() => requestCancel(`timeout ${opts.timeoutMs}ms`), opts.timeoutMs);
    timer.unref?.();
    let result;
    try {
      result = await renderEpisodeHyperframes(
        {
          workspaceRoot: WORKSPACE_ROOT,
          course: opts.course,
          episode: opts.episode,
          port: opts.port,
          format: opts.format,
          codec: opts.codec,
          hardware: opts.hardware,
          resolution: opts.resolution,
          fps: opts.fps,
          speed: opts.speed,
          output: opts.output,
          workers: opts.workers,
          captureFormat: opts.captureFormat,
          jpegQuality: opts.jpegQuality,
        },
        {
          log: (line) => console.log(line),
          isCancelled: () => cancelled,
          onChrome: (c) => {
            chrome = c;
          },
        }
      );
    } finally {
      clearTimeout(timer);
    }
    if (cancelled) throw new Error("Render cancelled");
    if (result.browserErrors?.length) {
      throw new Error(`Browser reported ${result.browserErrors.length} error(s):\n${result.browserErrors.slice(0, 10).join("\n")}`);
    }

    const expectedFilename = resolveExpectedOutputFilename(result.savedFile || opts.output, opts.episode, result.ext || opts.format);
    const outPath = path.join(epDir, expectedFilename);
    if (!fs.existsSync(outPath)) throw new Error(`Expected output file missing on disk: ${outPath}`);
    const stat = fs.statSync(outPath);
    if (stat.size <= 0) throw new Error(`Output file is empty (0 bytes): ${outPath}`);

    const elapsedSec = (Date.now() - startMs) / 1000;
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    const speedup = result.durationSec > 0 ? (result.durationSec / elapsedSec).toFixed(2) : "N/A";
    console.log(`[render] 100% Output saved: ${path.basename(outPath)} (${sizeMb} MB)`);
    console.log(
      `[render_video] SUCCESS: ${outPath} (${sizeMb} MB / ${stat.size} bytes, engine=hyperframes, format=${result.format}, codec=${opts.codec}, hw=${result.hardwareAcceleration}, res=${result.width}x${result.height}, fps=${result.fps}, speed=${opts.speed}x, frames=${result.frames}, workers=${result.workers}, duration=${result.durationSec}s, elapsed=${elapsedSec.toFixed(2)}s, speedup=${speedup}x)`
    );
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    if (process.stdin && !process.stdin.isTTY) process.stdin.off("data", onStdinData);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  if (!opts.course || !opts.episode) {
    printUsage();
    throw new Error("Missing required --course and/or --episode flags.");
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) {
    throw new Error(`Invalid --port: ${opts.port}`);
  }
  if (!VALID_FORMATS.has(opts.format)) {
    throw new Error(`Invalid --format: ${opts.format}. Expected mp4 or webm.`);
  }
  if (!VALID_CODECS.has(opts.codec)) {
    throw new Error(`Invalid --codec: ${opts.codec}. Expected h264, hevc, or vp9.`);
  }
  if (!VALID_HARDWARE.has(opts.hardware)) {
    throw new Error(`Invalid --hardware: ${opts.hardware}. Expected auto, gpu, or cpu.`);
  }
  if (!VALID_RESOLUTIONS.has(opts.resolution)) {
    throw new Error(`Invalid --resolution: ${opts.resolution}. Expected 720p, 1080p, 1440p, or 2160p.`);
  }
  if (!VALID_FPS.has(opts.fps)) {
    throw new Error(`Invalid --fps: ${opts.fps}. Expected 24, 30, or 60.`);
  }
  if (!VALID_SPEEDS.has(opts.speed)) {
    throw new Error(`Invalid --speed: ${opts.speed}. Expected 1, 1.25, 1.5, or 2.`);
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${opts.timeoutMs}`);
  }
  if (!VALID_ENGINES.has(opts.engine)) {
    throw new Error(`Invalid --engine: ${opts.engine}. Expected hyperframes or legacy.`);
  }
  if (!VALID_CAPTURE_FORMATS.has(opts.captureFormat)) {
    throw new Error(`Invalid --capture-format: ${opts.captureFormat}. Expected jpeg or png.`);
  }
  if (opts.workers && (!Number.isInteger(opts.workers) || opts.workers < 1 || opts.workers > 8)) {
    throw new Error(`Invalid --workers: ${opts.workers}. Expected 1..8.`);
  }

  const epDir = path.join(WORKSPACE_ROOT, opts.course, "episodes", opts.episode);
  const scriptPath = path.join(epDir, "script.json");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Episode script.json not found: ${scriptPath}`);
  }

  if (opts.engine === "hyperframes") {
    await runHyperframesRender(opts, epDir);
    return;
  }

  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome executable not found at: ${chromePath}`);
  }

  const startMs = Date.now();
  let spawnedServer = null;
  let chromeProc = null;
  let cdp = null;
  let cancelled = false;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvm-chrome-"));

  const requestCancel = (reason) => {
    if (cancelled) return;
    cancelled = true;
    console.warn(`[render_video] Cancellation requested (${reason}); closing browser...`);
    if (cdp) {
      cdp.send("Browser.close", {}, 1500).catch(() => {});
      cdp.close();
    }
    if (chromeProc && chromeProc.exitCode === null) {
      try {
        chromeProc.kill();
      } catch {
        // ignore
      }
    }
  };

  const onSigInt = () => requestCancel("SIGINT");
  const onSigTerm = () => requestCancel("SIGTERM");
  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);

  const onStdinData = (chunk) => {
    if (String(chunk || "").toUpperCase().includes("CANCEL")) {
      requestCancel("stdin CANCEL");
    }
  };
  if (process.stdin && !process.stdin.isTTY) {
    try {
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", onStdinData);
      process.stdin.resume();
      process.stdin.unref();
    } catch {
      // Ignore stdin pipe errors
    }
  }

  try {
    console.log(`[render] 0% Starting render pipeline (${opts.resolution} @ ${opts.fps}fps, ${opts.speed}x, ${opts.format}/${opts.codec}, hw=${opts.hardware})...`);
    spawnedServer = await ensureServer(opts.port);
    const cdpPort = await getFreePort();
    const targetUrl = `http://localhost:${opts.port}/?course=${encodeURIComponent(opts.course)}&ep=${encodeURIComponent(opts.episode)}&view=player&headless=1`;

    console.log(`[render] 2% Launching headless Chrome (CDP port ${cdpPort})...`);
    console.log(`[render_video] Target URL: ${targetUrl}`);

    chromeProc = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu-sandbox",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        targetUrl,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let chromeStderr = "";
    chromeProc.stderr.on("data", (d) => {
      chromeStderr += d.toString();
      if (chromeStderr.length > 4000) {
        chromeStderr = chromeStderr.slice(-4000);
      }
    });

    if (cancelled) throw new Error("Render cancelled");

    const wsUrl = await waitForCdpTarget(cdpPort, 15_000);
    cdp = createCdpClient(wsUrl);
    await cdp.openPromise;

    await cdp.send("Runtime.enable");

    cdp.on("Runtime.consoleAPICalled", (params) => {
      const text = (params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || ""))
        .join(" ");
      if (text.includes("[render]")) {
        console.log(text);
      } else if (text.includes("[OFFLINE_RENDER]")) {
        const cleaned = text.replace("[OFFLINE_RENDER]", "").trim();
        console.log(`[render] ${cleaned}`);
      } else if (params.type === "error") {
        console.error(`[browser console.error] ${text}`);
      }
    });

    cdp.on("Runtime.exceptionThrown", (params) => {
      const detail = params.exceptionDetails;
      const msg = detail?.exception?.description || detail?.text || "Unknown browser exception";
      console.error(`[browser exception] ${msg}`);
    });

    console.log(`[render] 4% Waiting for offline renderer readiness...`);
    await waitForOfflineRenderer(cdp, 25_000);
    if (cancelled) throw new Error("Render cancelled");

    const renderOptions = {
      courseId: opts.course,
      episodeId: opts.episode,
      format: opts.format,
      codec: opts.codec,
      hardware: opts.hardware,
      resolution: opts.resolution,
      fps: opts.fps,
      speed: opts.speed,
      outputFilename: opts.output || "",
    };

    console.log(
      `[render] 5% Rendering ${opts.course}/${opts.episode} (${opts.format}/${opts.codec}, ${opts.resolution} @ ${opts.fps}fps, ${opts.speed}x, hw=${opts.hardware})...`
    );
    const evalResp = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `window.__STUDIO_RENDER_OFFLINE__(${JSON.stringify(renderOptions)})`,
        awaitPromise: true,
        returnByValue: true,
      },
      opts.timeoutMs
    );

    if (cancelled) throw new Error("Render cancelled");

    if (evalResp?.exceptionDetails) {
      const errText =
        evalResp.exceptionDetails.exception?.description ||
        evalResp.exceptionDetails.text ||
        "Offline render threw an exception";
      throw new Error(errText);
    }

    const result = evalResp?.result?.value;
    if (!result || !result.ok) {
      throw new Error(`Offline render failed: ${JSON.stringify(result)}`);
    }

    const actualExt = result.format || opts.format;
    const expectedFilename = resolveExpectedOutputFilename(
      result.savedFile || result.filename || opts.output,
      opts.episode,
      actualExt
    );
    const expectedOutPath = path.join(epDir, expectedFilename);
    if (!fs.existsSync(expectedOutPath)) {
      throw new Error(`Expected output file missing on disk: ${expectedOutPath}`);
    }

    const stat = fs.statSync(expectedOutPath);
    if (stat.size <= 0) {
      throw new Error(`Output file is empty (0 bytes): ${expectedOutPath}`);
    }

    const elapsedSec = (Date.now() - startMs) / 1000;
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    const speedup = result.durationSec > 0 ? (result.durationSec / elapsedSec).toFixed(2) : "N/A";

    console.log(`[render] 100% Output saved: ${path.basename(expectedOutPath)} (${sizeMb} MB)`);
    console.log(
      `[render_video] SUCCESS: ${expectedOutPath} (${sizeMb} MB / ${stat.size} bytes, format=${actualExt}, codec=${opts.codec}, hw=${opts.hardware}, res=${opts.resolution}, fps=${opts.fps}, speed=${opts.speed}x, duration=${result.durationSec}s, elapsed=${elapsedSec.toFixed(2)}s, speedup=${speedup}x)`
    );
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    if (process.stdin && !process.stdin.isTTY) {
      process.stdin.off("data", onStdinData);
    }
    if (cdp) {
      await cdp.send("Browser.close", {}, 2000).catch(() => {});
      cdp.close();
    }
    if (chromeProc) {
      await terminateProcess(chromeProc, "Chrome");
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    } catch (err) {
      console.warn(`[render_video] Warning: failed to remove temp profile ${userDataDir}: ${err.message}`);
    }
    if (spawnedServer) {
      await terminateProcess(spawnedServer, "server.mjs");
    }
  }
}

main().catch((err) => {
  console.error(`[render_video] ERROR: ${err?.stack || err?.message || err}`);
  process.exitCode = 1;
});
