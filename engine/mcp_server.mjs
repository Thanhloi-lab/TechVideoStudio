import http from "node:http";

const PORT = Number(process.env.VIDEO_MAKER_PORT || process.env.PORT || 3030);
const HOST = process.env.VIDEO_MAKER_HOST || "127.0.0.1";
const SERVER_INFO = { name: "tech-video-studio", version: "1.0.0" };

function logErr(msg) {
  process.stderr.write(`[mcp:tech-video-studio] ${msg}\n`);
}

function writeJsonRpc(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function sendResult(id, result) {
  if (id === undefined || id === null) return;
  writeJsonRpc({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data = undefined) {
  if (id === undefined || id === null) return;
  const err = { code, message: String(message || "Internal error") };
  if (data !== undefined) err.data = data;
  writeJsonRpc({ jsonrpc: "2.0", id, error: err });
}

function requestStudio(method, path, body = null, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const headers = {};
    if (payload !== null) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Timeout calling Studio server (${method} ${path})`));
    });
    req.on("error", (err) => reject(err));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const TOOLS = [
  {
    name: "studio_worker_heartbeat",
    description:
      "Register or refresh this Antigravity AI Worker heartbeat with Tech Video Studio (localhost:3030) so the Web UI shows Online status.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string", description: "Stable worker identifier, e.g. 'argon-worker-1'." },
        model: { type: "string", description: "Active model name, e.g. 'Gemini 4 Argon' or 'Gemini 4 Hydrogen'." },
        mode: { type: "string", enum: ["watcher", "schedule"], default: "watcher" },
        session_label: { type: "string", description: "Optional human-readable session description." },
      },
      required: ["worker_id", "model"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_poll_ai_job",
    description:
      "Non-blocking check for the next queued AI scripting job in Tech Video Studio without claiming it.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string" },
        model: { type: "string" },
        mode: { type: "string", enum: ["watcher", "schedule"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "studio_claim_ai_job",
    description:
      "Atomically claim the next queued AI scripting job (strictly script_episode or script_batch) and transition the target episode state to planning.",
    inputSchema: {
      type: "object",
      properties: {
        worker_id: { type: "string" },
        job_id: { type: "string", description: "Optional specific job_id to claim." },
        model: { type: "string" },
      },
      required: ["worker_id"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_get_context",
    description:
      "Load course.json, curriculum.md, open revision tickets, supported_visual_types (7 templates), and existing scripts/notes for a course or selected episodes.",
    inputSchema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course code, e.g. 'AWS' or 'DOCKER'." },
        episode_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of episode IDs to filter context cleanly.",
        },
      },
      required: ["course"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_report_ai_progress",
    description:
      "Report scripting stage progress ('planning', 'in_progress', 'reviewing'), percentage, and log message for a claimed AI job back to Studio UI & state.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        worker_id: { type: "string" },
        episode_id: { type: "string" },
        status: { type: "string", enum: ["planning", "in_progress", "reviewing"] },
        phase: { type: "string" },
        progress: { type: "number" },
        message: { type: "string" },
      },
      required: ["job_id", "worker_id"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_validate_script",
    description:
      "Validate script.json diagrams & visual templates (architecture, comparison_matrix, timeline_flow, kpi_metrics) before submitting.",
    inputSchema: {
      type: "object",
      properties: {
        script_json: { type: "object", description: "Full script.json object to validate." },
        course: { type: "string", description: "Alternative: validate saved disk script.json by course + episode_id." },
        episode_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "studio_submit_episode_script",
    description:
      "Validate and save script.json (+ optional notes_md) for a single episode inside the claimed AI job, advancing it atomically to script_ready.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        worker_id: { type: "string" },
        course: { type: "string" },
        episode_id: { type: "string" },
        script_json: {
          type: "object",
          description: "Optional full script.json object. Omit if already written safely to episodes/<ep>/script.json on disk.",
        },
        notes_md: { type: "string", description: "Optional Markdown study notes for episodes/<ep>/notes.md." },
        summary_note: { type: "string", description: "Short Vietnamese summary stored in episode state.scripting.notes." },
      },
      required: ["job_id", "worker_id", "course", "episode_id"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_complete_ai_job",
    description:
      "Complete the claimed AI scripting job after all episodes are submitted as script_ready. Automatically triggers TTS/Render only if auto_produce was enabled on the job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        worker_id: { type: "string" },
        summary: { type: "string" },
      },
      required: ["job_id", "worker_id"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_fail_ai_job",
    description:
      "Abort/fail a claimed AI scripting job cleanly and restore incomplete episodes out of active scripting state.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        worker_id: { type: "string" },
        error: { type: "string" },
      },
      required: ["job_id", "worker_id", "error"],
      additionalProperties: false,
    },
  },
];

async function handleToolCall(name, args = {}) {
  let res;
  if (name === "studio_worker_heartbeat") {
    res = await requestStudio("POST", "/api/ai/worker/heartbeat", args);
  } else if (name === "studio_poll_ai_job") {
    res = await requestStudio("POST", "/api/ai/jobs/poll", args);
  } else if (name === "studio_claim_ai_job") {
    res = await requestStudio("POST", "/api/ai/jobs/claim", args);
  } else if (name === "studio_get_context") {
    const course = encodeURIComponent(String(args.course || ""));
    const eps = Array.isArray(args.episode_ids) && args.episode_ids.length > 0
      ? `&episodes=${encodeURIComponent(args.episode_ids.join(","))}`
      : "";
    res = await requestStudio("GET", `/api/ai/context?course=${course}${eps}`);
  } else if (name === "studio_report_ai_progress") {
    res = await requestStudio("POST", "/api/ai/jobs/progress", args);
  } else if (name === "studio_validate_script") {
    res = await requestStudio("POST", "/api/ai/validate-script", args);
  } else if (name === "studio_submit_episode_script") {
    res = await requestStudio("POST", "/api/ai/jobs/submit-episode", args, 30_000);
  } else if (name === "studio_complete_ai_job") {
    res = await requestStudio("POST", "/api/ai/jobs/complete", args);
  } else if (name === "studio_fail_ai_job") {
    res = await requestStudio("POST", "/api/ai/jobs/fail", args);
  } else {
    throw new Error(`Unknown or disallowed tool "${name}".`);
  }

  const isError = res.status >= 400 || res.body?.ok === false;
  return {
    content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }],
    isError,
  };
}

async function processMessage(msg) {
  const { id, method, params } = msg || {};
  if (!method) return;

  try {
    if (method === "initialize") {
      return sendResult(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return;
    }
    if (method === "ping") {
      return sendResult(id, {});
    }
    if (method === "tools/list") {
      return sendResult(id, { tools: TOOLS });
    }
    if (method === "tools/call") {
      const toolName = String(params?.name || "").trim();
      const toolArgs = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        const result = await handleToolCall(toolName, toolArgs);
        return sendResult(id, result);
      } catch (err) {
        const message =
          err?.code === "ECONNREFUSED"
            ? `Tech Video Studio server (http://${HOST}:${PORT}) is not running. Start it with: node "D:\\VideoMaker\\engine\\server.mjs"`
            : err?.message || String(err);
        return sendResult(id, {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          isError: true,
        });
      }
    }
    if (id !== undefined && id !== null) {
      return sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    logErr(`Error handling ${method}: ${err.message}`);
    sendError(id, -32603, err.message);
  }
}

let rawBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, chunk]);
  while (true) {
    const nlIdx = rawBuffer.indexOf(0x0a);
    if (nlIdx === -1) break;
    const lineBuf = rawBuffer.subarray(0, nlIdx);
    rawBuffer = rawBuffer.subarray(nlIdx + 1);
    const line = lineBuf.toString("utf-8").trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      void processMessage(parsed);
    } catch (err) {
      logErr(`Invalid JSON-RPC line: ${err.message}`);
      writeJsonRpc({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
