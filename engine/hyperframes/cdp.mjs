// Minimal zero-dependency Chrome launcher + Chrome DevTools Protocol client (Node 22 global WebSocket).
// Shared by engine/hyperframes/render.mjs and engine/hyperframes/snapshot.mjs.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    DEFAULT_CHROME_PATH,
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Chrome executable not found. Set CHROME_PATH. Tried: ${candidates.join(", ")}`);
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout contacting ${url}`)));
    req.on("error", reject);
  });
}

export async function terminateProcess(proc, label = "process", waitMs = 3000) {
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
          // ignore
        }
      }
      setTimeout(finish, 300);
    }, waitMs);
  });
  if (proc.exitCode === null && proc.signalCode === null) {
    console.warn(`[cdp] Warning: ${label} did not report exit cleanly`);
  }
}

/** CDP client over a browser- or page-level websocket. Supports flattened target sessions. */
export function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  let nextId = 1;
  const pending = new Map();
  const eventHandlers = new Map(); // key: `${sessionId||""}|${method}`

  const openPromise = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (err) => reject(new Error(err?.message || "CDP WebSocket error")));
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf-8"));
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
      else entry.resolve(msg.result);
    } else if (msg.method) {
      for (const key of [`${msg.sessionId || ""}|${msg.method}`, `*|${msg.method}`]) {
        const handlers = eventHandlers.get(key);
        if (!handlers) continue;
        for (const fn of handlers) {
          try {
            fn(msg.params, msg.sessionId);
          } catch {
            // ignore handler errors
          }
        }
      }
    }
  });

  ws.addEventListener("close", () => {
    for (const [, entry] of pending) entry.reject(new Error(`CDP WebSocket closed before ${entry.method} completed`));
    pending.clear();
  });

  function send(method, params = {}, { sessionId, timeoutMs = 30_000 } = {}) {
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
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }

  /** Subscribe to an event. sessionId "*" matches every session; undefined = browser session. */
  function on(method, handler, sessionId = "*") {
    const key = `${sessionId ?? ""}|${method}`;
    if (!eventHandlers.has(key)) eventHandlers.set(key, new Set());
    eventHandlers.get(key).add(handler);
    return () => eventHandlers.get(key)?.delete(handler);
  }

  function close() {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    } catch {
      // ignore
    }
  }

  return { openPromise, send, on, close };
}

/**
 * Launch headless Chrome with remote debugging and connect a browser-level CDP client.
 * Returns { proc, cdp, userDataDir, close() }.
 */
export async function launchChrome({ extraArgs = [], label = "chrome" } = {}) {
  const chromePath = resolveChromePath();
  const cdpPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-hf-chrome-"));
  const proc = spawn(
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
      "--disable-backgrounding-occluded-windows",
      "--disable-extensions",
      "--hide-scrollbars",
      "--mute-audio",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      ...extraArgs,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderrTail = "";
  proc.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });

  const deadline = Date.now() + 20_000;
  let wsUrl = null;
  while (Date.now() < deadline && !wsUrl) {
    if (proc.exitCode !== null) throw new Error(`${label} exited early (${proc.exitCode}): ${stderrTail}`);
    try {
      const info = await httpGetJson(`http://127.0.0.1:${cdpPort}/json/version`, 1000);
      wsUrl = info?.webSocketDebuggerUrl || null;
    } catch {
      await sleep(150);
    }
  }
  if (!wsUrl) {
    await terminateProcess(proc, label);
    throw new Error(`Timed out waiting for ${label} DevTools endpoint: ${stderrTail}`);
  }
  const cdp = createCdpClient(wsUrl);
  await cdp.openPromise;

  async function close() {
    await cdp.send("Browser.close", {}, { timeoutMs: 2000 }).catch(() => {});
    cdp.close();
    await terminateProcess(proc, label);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    } catch {
      // temp profile cleanup is best effort
    }
  }

  return { proc, cdp, userDataDir, close, stderrTail: () => stderrTail };
}

/**
 * Open a new page target (optionally in a fresh browser context = separate renderer process)
 * and attach a flattened session. Returns { targetId, sessionId, browserContextId }.
 */
export async function openPage(cdp, { url = "about:blank", isolated = false } = {}) {
  let browserContextId;
  if (isolated) {
    const ctx = await cdp.send("Target.createBrowserContext", { disposeOnDetach: true });
    browserContextId = ctx.browserContextId;
  }
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  if (url && url !== "about:blank") {
    await cdp.send("Page.enable", {}, { sessionId });
  }
  return { targetId, sessionId, browserContextId };
}

/** Navigate and wait for the load event. */
export async function navigate(cdp, sessionId, url, timeoutMs = 30_000) {
  await cdp.send("Page.enable", {}, { sessionId });
  const loaded = new Promise((resolve) => {
    const off = cdp.on(
      "Page.loadEventFired",
      () => {
        off();
        resolve();
      },
      sessionId
    );
  });
  const res = await cdp.send("Page.navigate", { url }, { sessionId, timeoutMs });
  if (res?.errorText) throw new Error(`Navigation to ${url} failed: ${res.errorText}`);
  await Promise.race([loaded, sleep(timeoutMs).then(() => Promise.reject(new Error(`Load timeout for ${url}`)))]);
}

/** Evaluate an expression in a page session; returns the by-value result or throws on exception. */
export async function evaluate(cdp, sessionId, expression, { awaitPromise = true, timeoutMs = 30_000 } = {}) {
  const resp = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    { sessionId, timeoutMs }
  );
  if (resp?.exceptionDetails) {
    const d = resp.exceptionDetails;
    throw new Error(d.exception?.description || d.text || "Runtime.evaluate exception");
  }
  return resp?.result?.value;
}

/** Collect console errors / exceptions for a page session into `sink` (array of strings). */
export function collectPageErrors(cdp, sessionId, sink, { echo = false, prefix = "[browser]" } = {}) {
  cdp.on(
    "Runtime.consoleAPICalled",
    (params) => {
      const text = (params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || "")).join(" ");
      if (params.type === "error") {
        sink.push(text);
        if (echo) console.error(`${prefix} console.error ${text}`);
      } else if (echo && /\[(render|tvs-hf|hf-encoder)\]/.test(text)) {
        console.log(text);
      }
    },
    sessionId
  );
  cdp.on(
    "Runtime.exceptionThrown",
    (params) => {
      const d = params.exceptionDetails;
      const msg = d?.exception?.description || d?.text || "Unknown browser exception";
      sink.push(msg);
      if (echo) console.error(`${prefix} exception ${msg}`);
    },
    sessionId
  );
  cdp.on(
    "Log.entryAdded",
    (params) => {
      const e = params.entry || {};
      if (e.level === "error" && !/favicon\.ico/.test(e.url || "")) {
        const msg = `${e.text || ""}${e.url ? ` (${e.url})` : ""}`;
        sink.push(msg);
        if (echo) console.error(`${prefix} log ${msg}`);
      }
    },
    sessionId
  );
}
