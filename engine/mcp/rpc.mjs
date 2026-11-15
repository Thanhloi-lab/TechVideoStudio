import http from "node:http";
import { SUPPORTED_VISUAL_TYPES } from "../src/motion/kernel.mjs";

export const SERVER_INFO = { name: "tech-video-studio", version: "1.1.0" };

export const TOOLS = [
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

export const STATIC_RESOURCES = [
  {
    uri: "studio://courses",
    name: "Studio Courses",
    description: "List all courses in the VideoMaker workspace with progress stats and episodes.",
    mimeType: "application/json",
  },
  {
    uri: "studio://jobs/queue",
    name: "Studio Job Queue",
    description: "Live AI scripting jobs, worker status, and TTS/Video production jobs.",
    mimeType: "application/json",
  },
  {
    uri: "studio://templates/schema",
    name: "Script & Visual Template Schema",
    description: "4-part blueprint, 7 symmetric visual templates, zone/routing rules, and V2 motion fields.",
    mimeType: "application/json",
  },
];

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "studio://courses/{course}",
    name: "Course Context",
    description: "Load course.json, curriculum.md, open revision tickets, and episode states for a course.",
    mimeType: "application/json",
  },
];

export function createStudioHttpRequester({ host = "127.0.0.1", port = 3030 } = {}) {
  const resolvePort = typeof port === "function" ? port : () => port;
  return function requestStudio(method, urlPath, body = null, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const payload = body !== null ? JSON.stringify(body) : null;
      const headers = {};
      if (payload !== null) {
        headers["Content-Type"] = "application/json; charset=utf-8";
        headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const req = http.request(
        {
          host,
          port: Number(resolvePort()),
          path: urlPath,
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
        req.destroy(new Error(`Timeout calling Studio server (${method} ${urlPath})`));
      });
      req.on("error", (err) => reject(err));
      if (payload !== null) req.write(payload);
      req.end();
    });
  };
}

function buildTemplatesSchemaDoc() {
  return {
    parts: ["problem", "architecture", "setup", "exam_tips"],
    supported_visual_types: [...SUPPORTED_VISUAL_TYPES],
    v2_motion_fields: {
      "scene.highlight_words": "string[] — technical keywords accented in box-free subtitles",
      "flow_step.camera_focus": "{ x: 0..100, y: 0..100, zoom: 1.0..1.25 } — 16:9 camera focus target",
      "highlight_phase.code_override": "string[] | string — updated code snapshot for code_cli morphing",
      "highlight_phase.laser_scan": "boolean | number[] — red laser scanline highlight for risk/error lines",
    },
    architecture_rules: {
      zones: "roles: client|network|compute|security|data|danger; max 2 nested levels via parent_zone; use node_ids[] or x,y,w,h in 0..100",
      routing: "auto (default) | straight | orthogonal | curved (only for bidirectional pairs or skip-node arcs)",
      layout: "clean directional flow left-to-right or top-to-bottom without overlapping nodes or crossing unrelated nodes",
    },
    template_limits: {
      comparison_matrix: { columns: "2..4", rows: "1..6" },
      timeline_flow: { orientation: "horizontal|vertical", milestones: "2..6" },
      kpi_metrics: { cards: "1..4", chart_series: "1..8" },
    },
  };
}

export function createMcpHandler({ requestStudio, serverHost = "127.0.0.1", serverPort = 3030 } = {}) {
  const callStudio = requestStudio || createStudioHttpRequester({ host: serverHost, port: serverPort });

  function makeResult(id, result) {
    if (id === undefined || id === null) return null;
    return { jsonrpc: "2.0", id, result };
  }

  function makeError(id, code, message, data = undefined) {
    if (id === undefined || id === null) return null;
    const err = { code, message: String(message || "Internal error") };
    if (data !== undefined) err.data = data;
    return { jsonrpc: "2.0", id, error: err };
  }

  async function handleToolCall(name, args = {}) {
    let res;
    if (name === "studio_worker_heartbeat") {
      res = await callStudio("POST", "/api/ai/worker/heartbeat", args);
    } else if (name === "studio_poll_ai_job") {
      res = await callStudio("POST", "/api/ai/jobs/poll", args);
    } else if (name === "studio_claim_ai_job") {
      res = await callStudio("POST", "/api/ai/jobs/claim", args);
    } else if (name === "studio_get_context") {
      const course = encodeURIComponent(String(args.course || ""));
      const eps =
        Array.isArray(args.episode_ids) && args.episode_ids.length > 0
          ? `&episodes=${encodeURIComponent(args.episode_ids.join(","))}`
          : "";
      res = await callStudio("GET", `/api/ai/context?course=${course}${eps}`);
    } else if (name === "studio_report_ai_progress") {
      res = await callStudio("POST", "/api/ai/jobs/progress", args);
    } else if (name === "studio_validate_script") {
      res = await callStudio("POST", "/api/ai/validate-script", args);
    } else if (name === "studio_submit_episode_script") {
      res = await callStudio("POST", "/api/ai/jobs/submit-episode", args, 30_000);
    } else if (name === "studio_complete_ai_job") {
      res = await callStudio("POST", "/api/ai/jobs/complete", args);
    } else if (name === "studio_fail_ai_job") {
      res = await callStudio("POST", "/api/ai/jobs/fail", args);
    } else {
      throw new Error(`Unknown or disallowed tool "${name}".`);
    }

    const isError = res.status >= 400 || res.body?.ok === false;
    return {
      content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }],
      isError,
    };
  }

  async function handleListResources() {
    const resources = [...STATIC_RESOURCES];
    try {
      const res = await callStudio("GET", "/api/courses");
      if (res.status < 400 && Array.isArray(res.body?.courses)) {
        for (const c of res.body.courses) {
          if (!c?.id) continue;
          resources.push({
            uri: `studio://courses/${c.id}`,
            name: c.meta?.title ? `${c.id}: ${c.meta.title}` : c.id,
            description: `Course details, curriculum, and episode states for ${c.id}.`,
            mimeType: "application/json",
          });
        }
      }
    } catch {
      // keep static resources if server not reachable yet
    }
    return { resources };
  }

  async function handleReadResource(uri) {
    const target = String(uri || "").trim();
    if (!target) {
      throw Object.assign(new Error("Resource uri is required"), { rpcCode: -32602 });
    }

    if (target === "studio://courses") {
      const res = await callStudio("GET", "/api/courses");
      const courses = Array.isArray(res.body?.courses)
        ? res.body.courses.map((c) => ({
            id: c.id,
            title: c.meta?.title || c.id,
            subtitle: c.meta?.subtitle || "",
            target_exam: c.meta?.target_exam || "",
            stats: c.stats,
            stages: c.stages,
          }))
        : [];
      return {
        contents: [
          {
            uri: target,
            mimeType: "application/json",
            text: JSON.stringify({ workspace: res.body?.workspace || null, courses }, null, 2),
          },
        ],
      };
    }

    if (target.startsWith("studio://courses/")) {
      const course = decodeURIComponent(target.slice("studio://courses/".length)).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(course)) {
        throw Object.assign(new Error(`Invalid course resource URI: ${target}`), { rpcCode: -32602 });
      }
      const res = await callStudio("GET", `/api/ai/context?course=${encodeURIComponent(course)}`);
      if (res.status >= 400 || res.body?.ok === false) {
        throw Object.assign(new Error(res.body?.error || `Course "${course}" not found`), { rpcCode: -32002 });
      }
      return {
        contents: [
          {
            uri: target,
            mimeType: "application/json",
            text: JSON.stringify(res.body, null, 2),
          },
        ],
      };
    }

    if (target === "studio://jobs/queue") {
      const [aiStatusRes, aiJobsRes, prodJobsRes] = await Promise.all([
        callStudio("GET", "/api/ai/status"),
        callStudio("GET", "/api/ai/jobs"),
        callStudio("GET", "/api/jobs"),
      ]);
      return {
        contents: [
          {
            uri: target,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                ai_status: aiStatusRes.body,
                ai_jobs: aiJobsRes.body?.jobs || [],
                production_jobs: prodJobsRes.body?.jobs || [],
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (target === "studio://templates/schema") {
      return {
        contents: [
          {
            uri: target,
            mimeType: "application/json",
            text: JSON.stringify(buildTemplatesSchemaDoc(), null, 2),
          },
        ],
      };
    }

    throw Object.assign(new Error(`Resource not found: ${target}`), { rpcCode: -32002 });
  }

  async function processMessage(msg) {
    const { id, method, params } = msg || {};
    if (!method) return null;

    try {
      if (method === "initialize") {
        return makeResult(id, {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: SERVER_INFO,
        });
      }
      if (method === "notifications/initialized" || method === "notifications/cancelled") {
        return null;
      }
      if (method === "ping") {
        return makeResult(id, {});
      }
      if (method === "tools/list") {
        return makeResult(id, { tools: TOOLS });
      }
      if (method === "tools/call") {
        const toolName = String(params?.name || "").trim();
        const toolArgs = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
        try {
          const result = await handleToolCall(toolName, toolArgs);
          return makeResult(id, result);
        } catch (err) {
          const message =
            err?.code === "ECONNREFUSED"
              ? `Tech Video Studio server (http://${serverHost}:${serverPort}) is not running. Start it with: node "D:\\VideoMaker\\engine\\server.mjs"`
              : err?.message || String(err);
          return makeResult(id, {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            isError: true,
          });
        }
      }
      if (method === "resources/list") {
        const resList = await handleListResources();
        return makeResult(id, resList);
      }
      if (method === "resources/templates/list") {
        return makeResult(id, { resourceTemplates: RESOURCE_TEMPLATES });
      }
      if (method === "resources/read") {
        try {
          const readRes = await handleReadResource(params?.uri);
          return makeResult(id, readRes);
        } catch (err) {
          return makeError(id, err.rpcCode || -32002, err.message);
        }
      }
      if (id !== undefined && id !== null) {
        return makeError(id, -32601, `Method not found: ${method}`);
      }
      return null;
    } catch (err) {
      return makeError(id, -32603, err.message);
    }
  }

  return {
    TOOLS,
    STATIC_RESOURCES,
    RESOURCE_TEMPLATES,
    processMessage,
  };
}
