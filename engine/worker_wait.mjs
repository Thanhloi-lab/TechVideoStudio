import http from "node:http";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const eq = tok.indexOf("=");
    if (eq > 0) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else {
      const k = tok.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[k] = next;
        i += 1;
      } else {
        out[k] = "true";
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const HOST = args.host || process.env.VIDEO_MAKER_HOST || "127.0.0.1";
const PORT = Number(args.port || process.env.VIDEO_MAKER_PORT || 3030);
const WORKER_ID = String(args["worker-id"] || args.worker_id || `worker-${process.pid}`).trim();
const MODEL = String(args.model || "Gemini 4 Argon").trim();
const SESSION_LABEL = args["session-label"] || args.session_label || "Antigravity Studio Worker";
const HEARTBEAT_MS = Math.max(1000, Number(args["heartbeat-ms"] || 5000));
const WAIT_TIMEOUT_MS = Math.max(2000, Math.min(28000, Number(args["wait-ms"] || 25000)));

let stopped = false;
let activeWaitReq = null;
let hbTimer = null;

function postJson(path, body, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve({ status: res.statusCode || 500, body: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({ status: res.statusCode || 500, body: { raw } });
          }
        });
      }
    );
    if (path === "/api/ai/worker/wait") activeWaitReq = req;
    req.on("timeout", () => req.destroy(new Error(`Request timeout (${path})`)));
    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

function sendHeartbeatOnce() {
  return postJson(
    "/api/ai/worker/heartbeat",
    {
      worker_id: WORKER_ID,
      model: MODEL,
      mode: "watcher",
      session_label: SESSION_LABEL,
      pid: process.pid,
    },
    4500
  ).catch((err) => {
    process.stderr.write(`[worker_wait] Heartbeat retry (${HOST}:${PORT}): ${err.message}\n`);
    return null;
  });
}

function shutdown(code = 0) {
  stopped = true;
  if (hbTimer) {
    clearInterval(hbTimer);
    hbTimer = null;
  }
  if (activeWaitReq) {
    try {
      activeWaitReq.destroy();
    } catch {
      // ignore
    }
    activeWaitReq = null;
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  await sendHeartbeatOnce();
  hbTimer = setInterval(() => {
    if (!stopped) void sendHeartbeatOnce();
  }, HEARTBEAT_MS);
  if (typeof hbTimer.unref === "function") hbTimer.unref();

  while (!stopped) {
    try {
      const res = await postJson(
        "/api/ai/worker/wait",
        {
          worker_id: WORKER_ID,
          model: MODEL,
          mode: "watcher",
          session_label: SESSION_LABEL,
          pid: process.pid,
          timeout_ms: WAIT_TIMEOUT_MS,
        },
        WAIT_TIMEOUT_MS + 5000
      );
      activeWaitReq = null;

      if (res?.body?.wake && res?.body?.job) {
        process.stdout.write(`${JSON.stringify(res.body, null, 2)}\n`);
        shutdown(0);
        return;
      }
    } catch (err) {
      activeWaitReq = null;
      process.stderr.write(`[worker_wait] Waiting for Studio server at ${HOST}:${PORT} (${err.message})...\n`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

void main();
