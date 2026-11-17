import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateScriptDiagrams } from "./src/diagram_validator.mjs";
import { SUPPORTED_VISUAL_TYPES } from "./src/motion/kernel.mjs";
import { createAiBroker } from "./ai/queue_broker.mjs";
import { createMcpHandler, createStudioHttpRequester, SERVER_INFO as MCP_SERVER_INFO } from "./mcp/rpc.mjs";
import { createMediaHandlers } from "./routes/media.mjs";
import {
  addRevisionTicket,
  appendEvent,
  createEpisodeStateFromMeta,
  deleteRevisionTicket,
  flattenCourseEpisodes,
  inspectEpisodeArtifacts,
  listRevisions,
  loadCourseJson,
  readEpisodeState,
  readEvents,
  recomputeState,
  updateRevisionTicket,
  writeJsonAtomic,
} from "./state_cli.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = __dirname;
const WORKSPACE_ROOT = process.env.VIDEO_MAKER_WORKSPACE_ROOT
  ? path.resolve(process.env.VIDEO_MAKER_WORKSPACE_ROOT)
  : path.resolve(ENGINE_DIR, "..");
const PORT = Number(process.env.PORT || 3030);
const AI_QUEUE_FILE = process.env.VIDEO_MAKER_AI_QUEUE_FILE
  ? path.resolve(process.env.VIDEO_MAKER_AI_QUEUE_FILE)
  : path.join(ENGINE_DIR, ".ai_queue.json");

const VOICES_JSON_PATH = path.join(ENGINE_DIR, "voices.json");
const VOICE_PREVIEW_CACHE_DIR = path.join(ENGINE_DIR, ".voice_preview_cache");
const TTS_SCRIPT_PATH = path.join(ENGINE_DIR, "tts_pipeline.py");
const RENDER_SCRIPT_PATH = path.join(ENGINE_DIR, "render_video.mjs");
const PYTHON_BIN = process.env.PYTHON_BIN || "python";

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function safeResolve(baseDir, relParts) {
  const target = path.resolve(baseDir, ...relParts);
  const resolvedBase = path.resolve(baseDir);
  if (!target.startsWith(resolvedBase + path.sep) && target !== resolvedBase) {
    return null;
  }
  return target;
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function runChildProcess(
  cmd,
  args,
  { cwd = ENGINE_DIR, timeoutMs = 120000, onLog = null, pipeStdin = false, onSpawn = null } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: [pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (onSpawn) {
      try {
        onSpawn(child);
      } catch {
        // ignore
      }
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              if (pipeStdin && child.stdin && child.stdin.writable) {
                child.stdin.write("CANCEL\n");
              }
            } catch {
              // ignore
            }
            setTimeout(() => {
              try {
                if (child.exitCode === null) child.kill("SIGTERM");
              } catch {
                // ignore
              }
            }, 500);
          }, timeoutMs)
        : null;

    const emitLines = (chunk, isErr) => {
      const text = chunk.toString("utf-8");
      if (isErr) stderr += text;
      else stdout += text;
      if (onLog) {
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) onLog(trimmed, isErr);
        }
      }
    };

    child.stdout.on("data", (c) => emitLines(c, false));
    child.stderr.on("data", (c) => emitLines(c, true));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: timedOut ? -1 : code ?? -1,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}

function parseJsonFromStdout(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      const s = line.trim();
      if (s.startsWith("{") && s.endsWith("}")) {
        try {
          return JSON.parse(s);
        } catch {
          // keep scanning
        }
      }
    }
    return null;
  }
}

function loadVoicesConfig() {
  const fallback = {
    default_profile: "edge-hoaimy",
    voicestudio_base_url: "http://localhost:8000",
    profiles: [],
  };
  if (!fs.existsSync(VOICES_JSON_PATH)) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(VOICES_JSON_PATH, "utf-8"));
    return {
      default_profile: parsed.default_profile || fallback.default_profile,
      voicestudio_base_url: parsed.voicestudio_base_url || fallback.voicestudio_base_url,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    return fallback;
  }
}

function emptyStats() {
  return {
    total: 0,
    planned: 0,
    scripting: 0,
    script_ready: 0,
    processing: 0,
    needs_revision: 0,
    completed: 0,
  };
}

function listCourseDirs() {
  const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name === "engine" || name.startsWith(".") || name === "node_modules") continue;
    const courseDir = path.join(WORKSPACE_ROOT, name);
    const hasCourseJson = fs.existsSync(path.join(courseDir, "course.json"));
    const hasEpisodesDir = fs.existsSync(path.join(courseDir, "episodes"));
    const hasStateDir = fs.existsSync(path.join(courseDir, "state"));
    if (hasCourseJson || hasEpisodesDir || hasStateDir) {
      dirs.push({ name, courseDir });
    }
  }
  return dirs;
}

function mapEpisodeVideoFiles(courseName, epId, artifacts) {
  const encodedCourse = encodeURIComponent(courseName);
  const encodedEp = encodeURIComponent(epId);
  const list = Array.isArray(artifacts?.video_files) ? artifacts.video_files : [];
  return list.map((f) => ({
    ...f,
    url: `/courses/${encodedCourse}/episodes/${encodedEp}/${encodeURIComponent(f.filename)}`,
  }));
}

function buildEpisodePayload(courseName, courseDir, stateDir, epMeta, courseMeta = {}) {
  const epId = epMeta.id;
  const epPath = path.join(courseDir, "episodes", epId);
  const scriptPath = path.join(epPath, "script.json");
  const notesPath = path.join(epPath, "notes.md");

  let script = null;
  if (fs.existsSync(scriptPath)) {
    try {
      script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    } catch {
      script = null;
    }
  }

  const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";
  const artifacts = inspectEpisodeArtifacts(courseDir, epId);
  const audioCount =
    artifacts.audio_count > 0 ? artifacts.audio_count : countEpisodeAudioFiles(epPath);
  if (artifacts.audio_count === 0 && audioCount > 0) {
    artifacts.audio_count = audioCount;
  }

  let state = readEpisodeState(stateDir, epId);
  if (state) {
    state.artifacts = artifacts;
    recomputeState(state);
  } else {
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  }

  if (script) {
    script = normalizeScriptVoiceTracks(script, epPath, courseMeta, state);
  }

  const encodedCourse = encodeURIComponent(courseName);
  const encodedEp = encodeURIComponent(epId);
  const videoFile = artifacts.video_file || null;
  const videoFiles = mapEpisodeVideoFiles(courseName, epId, artifacts);

  const activeTrack =
    script?.active_voice_track && script?.voice_tracks?.[script.active_voice_track]
      ? script.voice_tracks[script.active_voice_track]
      : null;

  const effectiveProfile =
    state.voice_override?.tts_profile ||
    script?.tts_profile ||
    activeTrack?.tts_profile ||
    script?.active_voice_track ||
    courseMeta?.tts_profile ||
    null;
  const effectiveVoice =
    state.voice_override?.tts_voice ||
    script?.tts_voice ||
    activeTrack?.tts_voice ||
    courseMeta?.tts_voice ||
    null;
  const effectiveRate =
    state.voice_override?.tts_rate ||
    script?.tts_rate ||
    activeTrack?.tts_rate ||
    courseMeta?.tts_rate ||
    null;
  const providerUsed =
    script?.tts_provider_used ||
    activeTrack?.tts_provider ||
    state.voice_override?.tts_provider ||
    courseMeta?.tts_provider ||
    null;
  const ttsFallbackReason =
    script?.tts_fallback_reason || activeTrack?.tts_fallback_reason || null;
  if (ttsFallbackReason && !artifacts.tts_fallback_reason) {
    artifacts.tts_fallback_reason = ttsFallbackReason;
  }

  return {
    id: epId,
    number: epMeta.number || script?.episode_number || 0,
    stage: epMeta.stage ?? 0,
    stage_title: epMeta.stage_title || "",
    title: script?.title || epMeta.title || epId,
    subtitle: script?.subtitle || epMeta.subtitle || "",
    duration_target: epMeta.duration_target || "",
    total_duration_sec: script?.total_duration_sec || 0,
    tts_profile: effectiveProfile,
    tts_voice: effectiveVoice,
    tts_rate: effectiveRate,
    tts_provider_used: providerUsed,
    tts_fallback_reason: ttsFallbackReason,
    has_script: Boolean(script),
    has_audio: audioCount > 0,
    has_video: Boolean(videoFile),
    video_file: videoFile,
    video_url: videoFile
      ? `/courses/${encodedCourse}/episodes/${encodedEp}/${encodeURIComponent(videoFile)}`
      : null,
    video_files: videoFiles,
    base_url: `/courses/${encodedCourse}/episodes/${encodedEp}`,
    script,
    notes,
    state,
  };
}

function scanCourses() {
  const courses = [];

  for (const { name, courseDir } of listCourseDirs()) {
    const courseJsonPath = path.join(courseDir, "course.json");
    const curriculumPath = path.join(courseDir, "curriculum.md");
    const episodesDir = path.join(courseDir, "episodes");
    const stateDir = path.join(courseDir, "state");

    let meta = {
      id: name,
      title: name,
      subtitle: "",
      target_exam: "",
      tts_profile: null,
      tts_provider: null,
      tts_voice: null,
      tts_rate: null,
      stages: [],
    };
    if (fs.existsSync(courseJsonPath)) {
      try {
        meta = { ...meta, ...JSON.parse(fs.readFileSync(courseJsonPath, "utf-8")) };
      } catch {
        // Ignore malformed course.json
      }
    }

    const curriculum = fs.existsSync(curriculumPath)
      ? fs.readFileSync(curriculumPath, "utf-8")
      : "";

    const courseEpMetas = flattenCourseEpisodes(meta);
    const seenEpIds = new Set(courseEpMetas.map((e) => e.id));

    // Include any extra episode folders on disk not listed in course.json
    if (fs.existsSync(episodesDir)) {
      const epEntries = fs
        .readdirSync(episodesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !seenEpIds.has(d.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const epDirEnt of epEntries) {
        courseEpMetas.push({
          id: epDirEnt.name,
          number: 0,
          stage: 0,
          stage_title: "Unlisted",
          title: epDirEnt.name,
          duration_target: "",
          course_status: "planned",
        });
      }
    }

    const episodes = courseEpMetas.map((epMeta) =>
      buildEpisodePayload(name, courseDir, stateDir, epMeta, meta)
    );

    const stats = emptyStats();
    const stageStatsMap = new Map();
    for (const st of Array.isArray(meta.stages) ? meta.stages : []) {
      stageStatsMap.set(st.stage, {
        stage: st.stage,
        title: st.title,
        episode_ids: (st.episodes || []).map((e) => e.id),
        stats: emptyStats(),
      });
    }

    for (const ep of episodes) {
      const status = ep.state?.overall_status || "planned";
      stats.total += 1;
      if (stats[status] !== undefined) stats[status] += 1;
      const stBucket = stageStatsMap.get(ep.stage);
      if (stBucket) {
        stBucket.stats.total += 1;
        if (stBucket.stats[status] !== undefined) stBucket.stats[status] += 1;
      }
    }

    courses.push({
      id: name,
      meta,
      curriculum,
      stages: Array.from(stageStatsMap.values()),
      stats,
      episodes,
    });
  }

  return courses;
}

// --- SSE Watch & Broadcast Hub ---
const sseClients = new Set();
const stateWatchers = new Map(); // courseName -> fs.FSWatcher
const debounceTimers = new Map(); // courseName -> Timeout
let heartbeatTimer = null;

function broadcastSse(eventName, payload) {
  if (sseClients.size === 0) return;
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

function scheduleStateBroadcast(courseName, filename = null) {
  const existing = debounceTimers.get(courseName);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(courseName);
    broadcastSse("state_update", {
      course: courseName,
      filename: filename || null,
      ts: new Date().toISOString(),
    });
  }, 150);
  debounceTimers.set(courseName, timer);
}

function syncStateWatchers() {
  for (const { name, courseDir } of listCourseDirs()) {
    const stateDir = path.join(courseDir, "state");
    if (!fs.existsSync(stateDir) || stateWatchers.has(name)) continue;
    try {
      const watcher = fs.watch(stateDir, (_eventType, filename) => {
        if (filename && String(filename).endsWith(".tmp")) return;
        scheduleStateBroadcast(name, filename ? String(filename) : null);
      });
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          // ignore
        }
        stateWatchers.delete(name);
      });
      stateWatchers.set(name, watcher);
    } catch {
      // ignore watch failures
    }
  }
}

function cleanupWatchersIfIdle() {
  if (sseClients.size > 0) return;
  for (const watcher of stateWatchers.values()) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
  }
  stateWatchers.clear();
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function handleSseStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  sseClients.add(res);
  syncStateWatchers();

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      syncStateWatchers();
      for (const client of sseClients) {
        try {
          client.write(`: heartbeat ${new Date().toISOString()}\n\n`);
        } catch {
          sseClients.delete(client);
        }
      }
      if (sseClients.size === 0) cleanupWatchersIfIdle();
    }, 15000);
  }

  req.on("close", () => {
    sseClients.delete(res);
    cleanupWatchersIfIdle();
  });
}

// --- Voice Helpers & Handlers ---
function assignVoiceProfile({ course, episode = null, profileId }) {
  if (!/^[A-Za-z0-9_-]+$/.test(course)) {
    throw Object.assign(new Error("Invalid course identifier"), { statusCode: 400 });
  }
  if (episode && !/^[A-Za-z0-9_-]+$/.test(episode)) {
    throw Object.assign(new Error("Invalid episode identifier"), { statusCode: 400 });
  }

  const voicesData = loadVoicesConfig();
  const profile = voicesData.profiles.find((p) => p && p.id === profileId);
  if (!profile) {
    throw Object.assign(new Error(`Voice profile "${profileId}" not found in voices.json`), {
      statusCode: 404,
    });
  }

  const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
  if (!courseDir || !fs.existsSync(courseDir)) {
    throw Object.assign(new Error("Course not found"), { statusCode: 404 });
  }
  const courseJsonPath = path.join(courseDir, "course.json");
  if (!fs.existsSync(courseJsonPath)) {
    throw Object.assign(new Error("course.json not found"), { statusCode: 404 });
  }

  let courseJson;
  try {
    courseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
  } catch {
    throw Object.assign(new Error("Malformed course.json"), { statusCode: 500 });
  }

  const stateDir = path.join(courseDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const now = new Date().toISOString();

  if (!episode) {
    courseJson.tts_profile = profile.id;
    courseJson.tts_provider = profile.provider || "edge";
    courseJson.tts_voice = profile.voice_id || "vi-VN-HoaiMyNeural";
    courseJson.tts_rate = profile.rate || "+0%";
    writeJsonAtomic(courseJsonPath, courseJson);

    appendEvent(stateDir, {
      type: "course_voice_assigned",
      course,
      profile_id: profile.id,
      provider: courseJson.tts_provider,
      voice_id: courseJson.tts_voice,
      rate: courseJson.tts_rate,
      message: `Course default voice set to ${profile.label || profile.id}`,
    });
    scheduleStateBroadcast(course, "course.json");

    return {
      ok: true,
      scope: "course",
      course,
      profile_id: profile.id,
      meta: {
        tts_profile: courseJson.tts_profile,
        tts_provider: courseJson.tts_provider,
        tts_voice: courseJson.tts_voice,
        tts_rate: courseJson.tts_rate,
      },
    };
  }

  const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === episode) || {
    id: episode,
    number: 0,
    stage: 0,
    title: episode,
    course_status: "planned",
  };
  const epDir = path.join(courseDir, "episodes", episode);
  if (!flattenCourseEpisodes(courseJson).some((e) => e.id === episode) && !fs.existsSync(epDir)) {
    throw Object.assign(new Error(`Episode "${episode}" not found`), { statusCode: 404 });
  }

  const artifacts = inspectEpisodeArtifacts(courseDir, episode);
  let state = readEpisodeState(stateDir, episode);
  if (!state) {
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  }

  state.voice_override = {
    tts_profile: profile.id,
    tts_provider: profile.provider || "edge",
    tts_voice: profile.voice_id || "vi-VN-HoaiMyNeural",
    tts_rate: profile.rate || "+0%",
    updated_at: now,
  };

  // Update script.json top-level voice metadata without touching scenes or narration
  const scriptPath = path.join(epDir, "script.json");
  if (fs.existsSync(scriptPath)) {
    try {
      const scriptJson = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      scriptJson.tts_profile = profile.id;
      scriptJson.tts_voice = profile.voice_id || "vi-VN-HoaiMyNeural";
      scriptJson.tts_rate = profile.rate || "+0%";
      writeJsonAtomic(scriptPath, scriptJson);
    } catch {
      // Ignore malformed script.json
    }
  }

  state.production = state.production || {};
  state.production.stale = true;
  state.production.stale_reason = `Voice changed to ${profile.id}`;
  state.artifacts = artifacts;
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${episode}.json`), state);
  appendEvent(stateDir, {
    type: "episode_voice_assigned",
    course,
    episode_id: episode,
    profile_id: profile.id,
    voice_id: profile.voice_id,
    overall_status: state.overall_status,
    message: `Voice changed to ${profile.id} (production marked stale)`,
  });
  scheduleStateBroadcast(course, `${episode}.json`);

  return {
    ok: true,
    scope: "episode",
    course,
    episode,
    profile_id: profile.id,
    state,
  };
}

async function handleGetVoices(res, parsedUrl) {
  const data = loadVoicesConfig();
  const discover = parsedUrl.searchParams.get("discover") === "1";
  let discovered_voicestudio = null;

  if (discover) {
    try {
      const result = await runChildProcess(
        PYTHON_BIN,
        [TTS_SCRIPT_PATH, "--discover-voicestudio", "--json"],
        { timeoutMs: 12000 }
      );
      const parsed = parseJsonFromStdout(result.stdout);
      discovered_voicestudio = parsed || {
        ok: false,
        reachable: false,
        base_url: data.voicestudio_base_url,
        voices: [],
        error: result.stderr?.trim() || "Discovery returned no JSON",
      };
    } catch (err) {
      discovered_voicestudio = {
        ok: false,
        reachable: false,
        base_url: data.voicestudio_base_url,
        voices: [],
        error: err.message,
      };
    }
  }

  return sendJson(res, 200, {
    ok: true,
    default_profile: data.default_profile,
    voicestudio_base_url: data.voicestudio_base_url,
    profiles: data.profiles,
    discovered_voicestudio,
  });
}

async function handlePostVoices(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const op = String(body.op || "");
  if (!["upsert", "delete", "set_default"].includes(op)) {
    return sendJson(res, 400, {
      ok: false,
      error: 'Unsupported op. Expected "upsert", "delete", or "set_default".',
    });
  }

  const data = loadVoicesConfig();

  if (op === "upsert") {
    const profile = body.profile;
    if (!profile || typeof profile !== "object") {
      return sendJson(res, 400, { ok: false, error: "profile object is required for upsert" });
    }
    const id = String(profile.id || "").trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
      return sendJson(res, 400, { ok: false, error: "Invalid profile.id" });
    }
    const normalized = {
      ...profile,
      id,
      label: String(profile.label || id).trim(),
      provider: String(profile.provider || "edge").trim(),
      voice_id: String(profile.voice_id || "vi-VN-HoaiMyNeural").trim(),
    };
    const idx = data.profiles.findIndex((p) => p && p.id === id);
    if (idx >= 0) {
      data.profiles[idx] = { ...data.profiles[idx], ...normalized };
    } else {
      data.profiles.push(normalized);
    }
  } else if (op === "delete") {
    const id = String(body.id || body.profile?.id || "").trim();
    if (!id) {
      return sendJson(res, 400, { ok: false, error: "id is required for delete" });
    }
    const prevLen = data.profiles.length;
    data.profiles = data.profiles.filter((p) => p && p.id !== id);
    if (data.profiles.length === prevLen) {
      return sendJson(res, 404, { ok: false, error: `Profile "${id}" not found` });
    }
    if (data.default_profile === id) {
      data.default_profile = data.profiles[0]?.id || "";
    }
  } else if (op === "set_default") {
    const id = String(body.id || "").trim();
    if (!id) {
      return sendJson(res, 400, { ok: false, error: "id is required for set_default" });
    }
    if (!data.profiles.some((p) => p && p.id === id)) {
      return sendJson(res, 404, { ok: false, error: `Profile "${id}" not found` });
    }
    data.default_profile = id;
  }

  writeJsonAtomic(VOICES_JSON_PATH, data);
  broadcastSse("voices_update", {
    op,
    default_profile: data.default_profile,
    ts: new Date().toISOString(),
  });

  return sendJson(res, 200, {
    ok: true,
    default_profile: data.default_profile,
    voicestudio_base_url: data.voicestudio_base_url,
    profiles: data.profiles,
  });
}

async function handleVoicePreview(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const profileId = String(body.profile_id || "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(profileId)) {
    return sendJson(res, 400, { ok: false, error: "Invalid profile_id" });
  }

  const voicesData = loadVoicesConfig();
  const profile = voicesData.profiles.find((p) => p && p.id === profileId);
  if (!profile) {
    return sendJson(res, 404, { ok: false, error: `Profile "${profileId}" not found` });
  }

  const text = String(
    body.text ||
      profile.sample_text ||
      "Xin chào, hôm nay chúng ta sẽ cùng khám phá kiến trúc hệ thống thực chiến."
  ).trim();

  fs.mkdirSync(VOICE_PREVIEW_CACHE_DIR, { recursive: true });
  const hash = crypto
    .createHash("sha1")
    .update(`${profileId}|${profile.provider}|${profile.voice_id}|${profile.rate || ""}|${profile.pitch || ""}|${profile.endpoint || ""}|${text}`)
    .digest("hex")
    .slice(0, 12);

  const extHint = profile.response_format === "wav" ? "wav" : "mp3";
  const cacheBase = `preview-${profileId}-${hash}.${extHint}`;
  const cacheOut = path.join(VOICE_PREVIEW_CACHE_DIR, cacheBase);

  // Cache hit check (.mp3 or .wav)
  for (const candidateExt of [extHint, "mp3", "wav"]) {
    const candidateName = `preview-${profileId}-${hash}.${candidateExt}`;
    const candidatePath = path.join(VOICE_PREVIEW_CACHE_DIR, candidateName);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).size > 0) {
      return sendJson(res, 200, {
        ok: true,
        cached: true,
        audio_url: `/api/voices/preview-file/${encodeURIComponent(candidateName)}`,
        provider_used: profile.provider || "edge",
        voice_id: profile.voice_id,
      });
    }
  }

  try {
    const result = await runChildProcess(
      PYTHON_BIN,
      [
        TTS_SCRIPT_PATH,
        "--preview",
        "--profile",
        profileId,
        "--text",
        text,
        "--out",
        cacheOut,
        "--json",
      ],
      { timeoutMs: 35000 }
    );

    const parsed = parseJsonFromStdout(result.stdout);
    if (result.code !== 0 || !parsed?.ok) {
      const errMsg =
        parsed?.error || result.stderr?.trim() || result.stdout?.trim() || "Preview synthesis failed";
      return sendJson(res, 502, { ok: false, error: errMsg });
    }

    const actualFileName = parsed.out ? path.basename(String(parsed.out)) : cacheBase;
    const resolvedOut = safeResolve(VOICE_PREVIEW_CACHE_DIR, [actualFileName]);
    if (!resolvedOut || !fs.existsSync(resolvedOut)) {
      return sendJson(res, 500, { ok: false, error: "Preview output file missing on disk" });
    }

    return sendJson(res, 200, {
      ok: true,
      cached: false,
      audio_url: `/api/voices/preview-file/${encodeURIComponent(actualFileName)}`,
      provider_used: parsed.provider_used || profile.provider,
      duration_sec: parsed.duration_sec ?? null,
      voice_id: parsed.voice_id || profile.voice_id,
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleVoiceAssign(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const course = String(body.course || "").trim();
  const episode = body.episode ? String(body.episode).trim() : null;
  const profileId = String(body.profile_id || "").trim();

  if (!course || !profileId) {
    return sendJson(res, 400, { ok: false, error: "course and profile_id are required" });
  }

  try {
    const result = assignVoiceProfile({ course, episode, profileId });
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
  }
}

// --- Multi-Voice Track & Scene-Timings Helpers ---
function isValidSafeTrackId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 120 &&
    /^[A-Za-z0-9_.-]+$/.test(id) &&
    id !== "." &&
    id !== ".." &&
    !id.includes("..")
  );
}

function sanitizeTrackId(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

function clamp01(val, fallback = 0) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.min(1, Math.max(0, num)) * 10000) / 10000;
}

function cloneJsonSafe(obj) {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function extractSceneTimings(scene) {
  const vd = scene?.visual_data && typeof scene.visual_data === "object" ? scene.visual_data : {};
  const timings = {};

  if (Array.isArray(vd.flow_steps)) {
    timings.flow_steps = vd.flow_steps.map((s) => ({
      progress_start: clamp01(s?.progress_start, 0),
      progress_end: clamp01(s?.progress_end, 1),
    }));
  }
  if (Array.isArray(vd.highlight_phases)) {
    timings.highlight_phases = vd.highlight_phases.map((p) => ({
      progress_start: clamp01(p?.progress_start, 0),
      progress_end: clamp01(p?.progress_end, 1),
    }));
  }
  if (Array.isArray(vd.terminal_commands)) {
    timings.terminal_commands = vd.terminal_commands.map((c) => {
      const p = clamp01(c?.progress_start ?? c?.progress_at, 0);
      return c?.progress_at !== undefined
        ? { progress_start: p, progress_at: p }
        : { progress_start: p };
    });
  }
  if (Array.isArray(vd.steps)) {
    timings.steps = vd.steps.map((s) => ({
      progress_start: clamp01(s?.progress_start, 0),
      progress_end: clamp01(s?.progress_end, 1),
    }));
  }
  if (Array.isArray(vd.milestones)) {
    timings.milestones = vd.milestones.map((m) => {
      const item = {
        progress_start: clamp01(m?.progress_start, 0),
        progress_end: clamp01(m?.progress_end, 1),
      };
      if (m?.progress_at !== undefined) {
        item.progress_at = clamp01(m.progress_at, item.progress_start);
      }
      return item;
    });
  }
  if (Array.isArray(vd.rows)) {
    timings.rows = vd.rows.map((r, idx) => {
      const fallback = clamp01(0.08 + (idx / Math.max(1, vd.rows.length)) * 0.62, 0);
      const item = { progress_start: clamp01(r?.progress_start, fallback) };
      if (r?.progress_end !== undefined) {
        item.progress_end = clamp01(r.progress_end, 1);
      }
      return item;
    });
  }
  if (Array.isArray(vd.comparisons)) {
    timings.comparisons = vd.comparisons.map((c, idx) => {
      const fallback = clamp01(idx / Math.max(1, vd.comparisons.length), 0);
      const item = { progress_start: clamp01(c?.progress_start, fallback) };
      if (c?.progress_end !== undefined) {
        item.progress_end = clamp01(c.progress_end, 1);
      }
      return item;
    });
  }
  if (Array.isArray(vd.cards)) {
    timings.cards = vd.cards.map((c, idx) => {
      const fallback = clamp01(0.06 + idx * 0.09, 0);
      const item = { progress_start: clamp01(c?.progress_start, fallback) };
      if (c?.progress_end !== undefined) {
        item.progress_end = clamp01(c.progress_end, 1);
      }
      return item;
    });
  }
  if (Array.isArray(vd.metrics)) {
    timings.metrics = vd.metrics.map((c, idx) => {
      const fallback = clamp01(0.06 + idx * 0.09, 0);
      const item = { progress_start: clamp01(c?.progress_start, fallback) };
      if (c?.progress_end !== undefined) {
        item.progress_end = clamp01(c.progress_end, 1);
      }
      return item;
    });
  }
  if (Array.isArray(vd.bars)) {
    timings.bars = vd.bars.map((c, idx) => {
      const fallback = clamp01(0.06 + idx * 0.09, 0);
      const item = { progress_start: clamp01(c?.progress_start, fallback) };
      if (c?.progress_end !== undefined) {
        item.progress_end = clamp01(c.progress_end, 1);
      }
      return item;
    });
  }
  if (vd.quiz && typeof vd.quiz === "object") {
    timings.quiz = { show_at_progress: clamp01(vd.quiz.show_at_progress, 0.68) };
  }
  if (vd.callout && typeof vd.callout === "object" && vd.callout.show_at_progress !== undefined) {
    timings.callout = { show_at_progress: clamp01(vd.callout.show_at_progress, 0.8) };
  }
  if (vd.takeaway && typeof vd.takeaway === "object" && vd.takeaway.show_at_progress !== undefined) {
    timings.takeaway = { show_at_progress: clamp01(vd.takeaway.show_at_progress, 0.78) };
  }
  if (vd.chart && typeof vd.chart === "object" && vd.chart.show_at_progress !== undefined) {
    timings.chart = { show_at_progress: clamp01(vd.chart.show_at_progress, 0.4) };
  }
  if (
    vd.alert_stamp &&
    typeof vd.alert_stamp === "object" &&
    vd.alert_stamp.show_at_progress !== undefined
  ) {
    timings.alert_stamp = { show_at_progress: clamp01(vd.alert_stamp.show_at_progress, 0.72) };
  }
  return timings;
}

function clampIntervalSteps(rawList, existingList = [], minSlice = 0.01) {
  const count = Math.min(rawList.length, existingList.length || rawList.length);
  if (count === 0) return [];
  const out = [];
  let prevEnd = 0;
  for (let i = 0; i < count; i++) {
    const raw = rawList[i] || {};
    const ex = existingList[i] || {};
    const defStart = i / count;
    const defEnd = (i + 1) / count;
    let s = clamp01(raw.progress_start ?? ex.progress_start, defStart);
    if (i > 0 && s < prevEnd) s = prevEnd;
    s = Math.min(s, Math.max(0, Math.round((1 - minSlice) * 10000) / 10000));
    let e = clamp01(raw.progress_end ?? ex.progress_end, Math.max(s + minSlice, defEnd));
    if (e < s + minSlice) {
      e = Math.min(1, Math.round((s + minSlice) * 10000) / 10000);
    }
    if (e < s) e = s;
    const item = { progress_start: s, progress_end: e };
    if (raw.progress_at !== undefined || ex.progress_at !== undefined) {
      const at = clamp01(raw.progress_at ?? ex.progress_at, s);
      item.progress_at = Math.min(e, Math.max(s, at));
    }
    prevEnd = e;
    out.push(item);
  }
  return out;
}

function clampPointSteps(rawList, existingList = [], { syncProgressAt = false } = {}) {
  const count = Math.min(rawList.length, existingList.length || rawList.length);
  if (count === 0) return [];
  const out = [];
  let prevStart = 0;
  for (let i = 0; i < count; i++) {
    const raw = rawList[i] || {};
    const ex = existingList[i] || {};
    let s = clamp01(raw.progress_start ?? raw.progress_at ?? ex.progress_start ?? ex.progress_at, i / count);
    if (i > 0 && s < prevStart) s = prevStart;
    const item = { progress_start: s };
    if (syncProgressAt || raw.progress_at !== undefined || ex.progress_at !== undefined) {
      item.progress_at = s;
    }
    if (raw.progress_end !== undefined || ex.progress_end !== undefined) {
      const e = clamp01(raw.progress_end ?? ex.progress_end, 1);
      item.progress_end = Math.max(s, e);
    }
    prevStart = s;
    out.push(item);
  }
  return out;
}

function normalizeAndClampTimings(scene, rawTimings) {
  const vd = scene?.visual_data && typeof scene.visual_data === "object" ? scene.visual_data : {};
  const input = rawTimings && typeof rawTimings === "object" ? rawTimings : {};
  const result = extractSceneTimings(scene);

  if (Array.isArray(input.flow_steps) && Array.isArray(vd.flow_steps)) {
    result.flow_steps = clampIntervalSteps(input.flow_steps, vd.flow_steps);
  }
  if (Array.isArray(input.highlight_phases) && Array.isArray(vd.highlight_phases)) {
    result.highlight_phases = clampIntervalSteps(input.highlight_phases, vd.highlight_phases);
  }
  if (Array.isArray(input.terminal_commands) && Array.isArray(vd.terminal_commands)) {
    result.terminal_commands = clampPointSteps(input.terminal_commands, vd.terminal_commands, {
      syncProgressAt: true,
    });
  }
  if (Array.isArray(input.steps) && Array.isArray(vd.steps)) {
    result.steps = clampIntervalSteps(input.steps, vd.steps);
  }
  if (Array.isArray(input.milestones) && Array.isArray(vd.milestones)) {
    result.milestones = clampIntervalSteps(input.milestones, vd.milestones);
  }
  if (Array.isArray(input.rows) && Array.isArray(vd.rows)) {
    result.rows = clampPointSteps(input.rows, vd.rows);
  }
  if (Array.isArray(input.comparisons) && Array.isArray(vd.comparisons)) {
    result.comparisons = clampPointSteps(input.comparisons, vd.comparisons);
  }
  if (Array.isArray(input.cards) && Array.isArray(vd.cards)) {
    result.cards = clampPointSteps(input.cards, vd.cards);
  }
  if (Array.isArray(input.metrics) && Array.isArray(vd.metrics)) {
    result.metrics = clampPointSteps(input.metrics, vd.metrics);
  }
  if (Array.isArray(input.bars) && Array.isArray(vd.bars)) {
    result.bars = clampPointSteps(input.bars, vd.bars);
  }

  const quizShow =
    input.quiz && typeof input.quiz === "object"
      ? input.quiz.show_at_progress
      : input.quiz_show_at_progress;
  if (quizShow !== undefined && vd.quiz && typeof vd.quiz === "object") {
    result.quiz = { show_at_progress: clamp01(quizShow, 0.68) };
  }

  const calloutShow =
    input.callout && typeof input.callout === "object"
      ? input.callout.show_at_progress
      : input.callout_show_at_progress;
  if (calloutShow !== undefined && vd.callout && typeof vd.callout === "object") {
    result.callout = { show_at_progress: clamp01(calloutShow, 0.8) };
  }

  const takeawayShow =
    input.takeaway && typeof input.takeaway === "object"
      ? input.takeaway.show_at_progress
      : input.takeaway_show_at_progress;
  if (takeawayShow !== undefined && vd.takeaway && typeof vd.takeaway === "object") {
    result.takeaway = { show_at_progress: clamp01(takeawayShow, 0.78) };
  }

  const chartShow =
    input.chart && typeof input.chart === "object"
      ? input.chart.show_at_progress
      : input.chart_show_at_progress;
  if (chartShow !== undefined && vd.chart && typeof vd.chart === "object") {
    result.chart = { show_at_progress: clamp01(chartShow, 0.4) };
  }

  const stampShow =
    input.alert_stamp && typeof input.alert_stamp === "object"
      ? input.alert_stamp.show_at_progress
      : input.alert_stamp_show_at_progress;
  if (stampShow !== undefined && vd.alert_stamp && typeof vd.alert_stamp === "object") {
    result.alert_stamp = { show_at_progress: clamp01(stampShow, 0.72) };
  }

  return result;
}

function applySceneTimings(scene, timings) {
  if (!scene || typeof scene !== "object" || !timings || typeof timings !== "object") return;
  if (!scene.visual_data || typeof scene.visual_data !== "object") {
    scene.visual_data = {};
  }
  const vd = scene.visual_data;

  const applyInterval = (key) => {
    if (!Array.isArray(timings[key]) || !Array.isArray(vd[key])) return;
    for (let i = 0; i < Math.min(timings[key].length, vd[key].length); i++) {
      const t = timings[key][i];
      if (!t || !vd[key][i] || typeof vd[key][i] !== "object") continue;
      if (t.progress_start !== undefined) vd[key][i].progress_start = clamp01(t.progress_start);
      if (t.progress_end !== undefined) vd[key][i].progress_end = clamp01(t.progress_end);
      if (t.progress_at !== undefined) vd[key][i].progress_at = clamp01(t.progress_at);
    }
  };

  const applyPoints = (key, syncAt = false) => {
    if (!Array.isArray(timings[key]) || !Array.isArray(vd[key])) return;
    for (let i = 0; i < Math.min(timings[key].length, vd[key].length); i++) {
      const t = timings[key][i];
      if (!t || !vd[key][i] || typeof vd[key][i] !== "object") continue;
      const p = clamp01(t.progress_start ?? t.progress_at);
      vd[key][i].progress_start = p;
      if (syncAt || t.progress_at !== undefined || vd[key][i].progress_at !== undefined) {
        vd[key][i].progress_at = clamp01(t.progress_at ?? p);
      }
      if (t.progress_end !== undefined) {
        vd[key][i].progress_end = clamp01(t.progress_end);
      }
    }
  };

  applyInterval("flow_steps");
  applyInterval("highlight_phases");
  applyPoints("terminal_commands", true);
  applyInterval("steps");
  applyInterval("milestones");
  applyPoints("rows");
  applyPoints("comparisons");
  applyPoints("cards");
  applyPoints("metrics");
  applyPoints("bars");

  if (timings.quiz && typeof timings.quiz === "object" && vd.quiz && typeof vd.quiz === "object") {
    if (timings.quiz.show_at_progress !== undefined) {
      vd.quiz.show_at_progress = clamp01(timings.quiz.show_at_progress, 0.68);
    }
  }
  if (
    timings.callout &&
    typeof timings.callout === "object" &&
    vd.callout &&
    typeof vd.callout === "object"
  ) {
    if (timings.callout.show_at_progress !== undefined) {
      vd.callout.show_at_progress = clamp01(timings.callout.show_at_progress, 0.8);
    }
  }
  if (
    timings.takeaway &&
    typeof timings.takeaway === "object" &&
    vd.takeaway &&
    typeof vd.takeaway === "object"
  ) {
    if (timings.takeaway.show_at_progress !== undefined) {
      vd.takeaway.show_at_progress = clamp01(timings.takeaway.show_at_progress, 0.78);
    }
  }
  if (timings.chart && typeof timings.chart === "object" && vd.chart && typeof vd.chart === "object") {
    if (timings.chart.show_at_progress !== undefined) {
      vd.chart.show_at_progress = clamp01(timings.chart.show_at_progress, 0.4);
    }
  }
  if (
    timings.alert_stamp &&
    typeof timings.alert_stamp === "object" &&
    vd.alert_stamp &&
    typeof vd.alert_stamp === "object"
  ) {
    if (timings.alert_stamp.show_at_progress !== undefined) {
      vd.alert_stamp.show_at_progress = clamp01(timings.alert_stamp.show_at_progress, 0.72);
    }
  }
}

function normalizeScriptVoiceTracks(script, epDir, courseMeta = {}, state = null) {
  if (!script || typeof script !== "object") return script;

  const normalized = { ...script };
  const rawTracks =
    normalized.voice_tracks &&
    typeof normalized.voice_tracks === "object" &&
    !Array.isArray(normalized.voice_tracks)
      ? { ...normalized.voice_tracks }
      : {};

  const trackKeys = Object.keys(rawTracks);
  if (trackKeys.length > 0) {
    normalized.voice_tracks = rawTracks;
    if (!normalized.active_voice_track || !rawTracks[normalized.active_voice_track]) {
      if (normalized.tts_profile && rawTracks[normalized.tts_profile]) {
        normalized.active_voice_track = normalized.tts_profile;
      } else {
        normalized.active_voice_track = trackKeys[0];
      }
    }
    return normalized;
  }

  // Legacy fallback: detect root audio/<scene_id>.mp3|wav files without voice_tracks
  const audioDir = path.join(epDir, "audio");
  const scenes = Array.isArray(normalized.scenes) ? normalized.scenes : [];
  const legacySceneData = {};
  let foundLegacyAudio = false;

  for (const scene of scenes) {
    if (!scene || !scene.id) continue;
    let relAudio = scene.audio_file ? String(scene.audio_file).replace(/\\/g, "/") : "";
    let fullAudio = relAudio ? safeResolve(epDir, relAudio.split("/")) : null;

    if (!fullAudio || !fs.existsSync(fullAudio) || fs.statSync(fullAudio).size === 0) {
      relAudio = "";
      fullAudio = null;
      if (fs.existsSync(audioDir) && fs.statSync(audioDir).isDirectory()) {
        for (const ext of ["mp3", "wav"]) {
          const candidate = path.join(audioDir, `${scene.id}.${ext}`);
          if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
            relAudio = `audio/${scene.id}.${ext}`;
            fullAudio = candidate;
            break;
          }
        }
      }
    }

    if (fullAudio && relAudio) {
      foundLegacyAudio = true;
      legacySceneData[scene.id] = {
        audio_file: relAudio,
        duration_sec: Number(scene.duration_sec) || 0,
        subtitles: Array.isArray(scene.subtitles) ? scene.subtitles : [],
        timings: extractSceneTimings(scene),
      };
    }
  }

  if (foundLegacyAudio) {
    const legacyId = sanitizeTrackId(
      normalized.tts_profile ||
        state?.voice_override?.tts_profile ||
        courseMeta?.tts_profile ||
        "legacy"
    );
    const providerVal = Array.isArray(normalized.tts_provider_used)
      ? normalized.tts_provider_used[0]
      : normalized.tts_provider_used;
    normalized.voice_tracks = {
      [legacyId]: {
        tts_profile:
          normalized.tts_profile ||
          state?.voice_override?.tts_profile ||
          courseMeta?.tts_profile ||
          legacyId,
        tts_provider:
          providerVal || state?.voice_override?.tts_provider || courseMeta?.tts_provider || "edge",
        tts_voice:
          normalized.tts_voice || state?.voice_override?.tts_voice || courseMeta?.tts_voice || "",
        tts_rate:
          normalized.tts_rate || state?.voice_override?.tts_rate || courseMeta?.tts_rate || "",
        subtitles_srt: fs.existsSync(path.join(epDir, "subtitles.srt")) ? "subtitles.srt" : null,
        total_duration_sec: Number(normalized.total_duration_sec) || 0,
        generated_at: normalized.generated_at || null,
        legacy: true,
        scene_data: legacySceneData,
      },
    };
    normalized.active_voice_track = legacyId;
  } else {
    normalized.voice_tracks = {};
    normalized.active_voice_track = normalized.active_voice_track || null;
  }

  return normalized;
}

function summarizeVoiceTracks(script) {
  const tracks = script?.voice_tracks && typeof script.voice_tracks === "object" ? script.voice_tracks : {};
  const activeId = script?.active_voice_track || null;
  return Object.entries(tracks).map(([id, t]) => ({
    profile_id: id,
    tts_profile: t?.tts_profile || id,
    tts_provider: t?.tts_provider || null,
    tts_fallback_reason: t?.tts_fallback_reason || null,
    tts_voice: t?.tts_voice || null,
    tts_rate: t?.tts_rate || null,
    subtitles_srt: t?.subtitles_srt || null,
    total_duration_sec: Number(t?.total_duration_sec) || 0,
    generated_at: t?.generated_at || null,
    legacy: Boolean(t?.legacy),
    scenes_count: t?.scene_data && typeof t.scene_data === "object" ? Object.keys(t.scene_data).length : 0,
    is_active: id === activeId,
  }));
}

async function handleVoiceTrackActivate(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const course = String(body.course || "").trim();
  const episode = String(body.episode || "").trim();
  const profileId = String(body.profile_id || "").trim();

  if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
    return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
  }
  if (!isValidSafeTrackId(profileId)) {
    return sendJson(res, 400, { ok: false, error: "Invalid profile_id" });
  }

  const key = `${course}:${episode}`;
  if (activeJobByEp.has(key)) {
    const existingJob = jobs.get(activeJobByEp.get(key));
    if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
      return sendJson(res, 409, {
        ok: false,
        error: `Tập ${episode} đang có tác vụ TTS/Render đang chạy. Vui lòng đợi hoàn tất trước khi chuyển giọng.`,
      });
    }
  }

  const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
  const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode]);
  const scriptPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode, "script.json"]);
  if (!courseDir || !epDir || !scriptPath || !fs.existsSync(scriptPath)) {
    return sendJson(res, 404, { ok: false, error: `Không tìm thấy script.json cho ${course}/${episode}.` });
  }

  let courseMeta = {};
  const courseJsonPath = path.join(courseDir, "course.json");
  if (fs.existsSync(courseJsonPath)) {
    try {
      courseMeta = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    } catch {
      courseMeta = {};
    }
  }

  let rawScript;
  try {
    rawScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  } catch {
    return sendJson(res, 400, { ok: false, error: `script.json của ${course}/${episode} bị lỗi cú pháp JSON.` });
  }

  const stateDir = path.join(courseDir, "state");
  const existingState = readEpisodeState(stateDir, episode);
  const script = normalizeScriptVoiceTracks(rawScript, epDir, courseMeta, existingState);

  const track = script.voice_tracks?.[profileId];
  if (!track || typeof track !== "object") {
    return sendJson(res, 404, {
      ok: false,
      error: `Không tìm thấy track giọng "${profileId}" trong script.json.`,
    });
  }

  script.active_voice_track = profileId;
  script.tts_profile = track.tts_profile || profileId;
  if (track.tts_voice) script.tts_voice = track.tts_voice;
  if (track.tts_rate) script.tts_rate = track.tts_rate;
  if (track.tts_pitch) script.tts_pitch = track.tts_pitch;
  if (track.tts_provider) {
    script.tts_provider_used = Array.isArray(track.tts_provider)
      ? track.tts_provider
      : [track.tts_provider];
  }

  const sceneDataMap = track.scene_data && typeof track.scene_data === "object" ? track.scene_data : {};
  let computedTotalDur = 0;
  for (const scene of Array.isArray(script.scenes) ? script.scenes : []) {
    if (!scene || !scene.id) continue;
    const sd = sceneDataMap[scene.id];
    if (sd && typeof sd === "object") {
      if (sd.audio_file !== undefined) scene.audio_file = sd.audio_file;
      if (sd.duration_sec !== undefined) scene.duration_sec = Number(sd.duration_sec) || 0;
      if (Array.isArray(sd.subtitles)) scene.subtitles = cloneJsonSafe(sd.subtitles);
      if (sd.timings && typeof sd.timings === "object") {
        if (!scene._base_timings) {
          scene._base_timings = extractSceneTimings(scene);
        }
        applySceneTimings(scene, sd.timings);
      }
    }
    computedTotalDur += Number(scene.duration_sec) || 0;
  }

  script.total_duration_sec =
    Number(track.total_duration_sec) > 0
      ? Number(track.total_duration_sec)
      : Math.round(computedTotalDur * 1000) / 1000;

  // Copy track SRT -> root subtitles.srt if present
  const srtDest = path.join(epDir, "subtitles.srt");
  const candidateSrtNames = [
    track.subtitles_srt ? String(track.subtitles_srt) : "",
    `subtitles.${profileId}.srt`,
  ].filter(Boolean);

  for (const srtName of candidateSrtNames) {
    const srtSrc = safeResolve(epDir, [srtName]);
    if (srtSrc && srtSrc !== srtDest && fs.existsSync(srtSrc) && fs.statSync(srtSrc).isFile()) {
      fs.copyFileSync(srtSrc, srtDest);
      break;
    }
  }

  writeJsonAtomic(scriptPath, script);

  const now = new Date().toISOString();
  const state = mutateEpisodeStateForJob(
    course,
    episode,
    (st, artifacts) => {
      st.voice_override = {
        tts_profile: track.tts_profile || profileId,
        tts_provider:
          (Array.isArray(track.tts_provider) ? track.tts_provider[0] : track.tts_provider) ||
          st.voice_override?.tts_provider ||
          "edge",
        tts_voice: track.tts_voice || script.tts_voice || "",
        tts_rate: track.tts_rate || script.tts_rate || "+0%",
        updated_at: now,
      };
      st.production = st.production || {};
      st.production.tts_done = true;
      if (st.production.video_done || artifacts.video_file) {
        st.production.stale = true;
        st.production.stale_reason = `Switched active voice track to ${profileId}`;
      }
    },
    {
      type: "voice_track_activated",
      profile_id: profileId,
      tts_voice: track.tts_voice || script.tts_voice || null,
      message: `Switched active voice track to ${profileId}`,
    }
  );

  return sendJson(res, 200, {
    ok: true,
    course,
    episode,
    active_voice_track: script.active_voice_track,
    voice_tracks: script.voice_tracks,
    voice_tracks_summary: summarizeVoiceTracks(script),
    script,
    state,
  });
}

async function handleVoiceTrackDelete(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const course = String(body.course || "").trim();
  const episode = String(body.episode || "").trim();
  const profileId = String(body.profile_id || "").trim();

  if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
    return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
  }
  if (!isValidSafeTrackId(profileId)) {
    return sendJson(res, 400, { ok: false, error: "Invalid profile_id" });
  }

  const key = `${course}:${episode}`;
  if (activeJobByEp.has(key)) {
    const existingJob = jobs.get(activeJobByEp.get(key));
    if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
      return sendJson(res, 409, {
        ok: false,
        error: `Tập ${episode} đang có tác vụ TTS/Render đang chạy hoặc chờ xử lý. Vui lòng đợi hoàn tất trước khi xóa giọng đọc.`,
      });
    }
  }

  const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
  const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode]);
  const scriptPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode, "script.json"]);
  if (!courseDir || !epDir || !scriptPath || !fs.existsSync(scriptPath)) {
    return sendJson(res, 404, { ok: false, error: `Không tìm thấy script.json cho ${course}/${episode}.` });
  }

  let courseMeta = {};
  const courseJsonPath = path.join(courseDir, "course.json");
  if (fs.existsSync(courseJsonPath)) {
    try {
      courseMeta = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    } catch {
      courseMeta = {};
    }
  }

  let rawScript;
  try {
    rawScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  } catch {
    return sendJson(res, 400, { ok: false, error: `script.json của ${course}/${episode} bị lỗi cú pháp JSON.` });
  }

  const stateDir = path.join(courseDir, "state");
  const existingState = readEpisodeState(stateDir, episode);
  const script = normalizeScriptVoiceTracks(rawScript, epDir, courseMeta, existingState);

  const trackIds = Object.keys(script.voice_tracks || {});
  if (!script.voice_tracks || !script.voice_tracks[profileId]) {
    return sendJson(res, 404, {
      ok: false,
      error: `Không tìm thấy track giọng "${profileId}" trong script.json.`,
    });
  }

  if (trackIds.length <= 1) {
    return sendJson(res, 400, {
      ok: false,
      error: "Không thể xóa track giọng duy nhất còn lại của tập. Cần giữ lại ít nhất 1 giọng đọc.",
    });
  }

  if (script.active_voice_track === profileId) {
    return sendJson(res, 409, {
      ok: false,
      error: `Không thể xóa track giọng đang kích hoạt ("${profileId}"). Hãy chuyển sang giọng khác trước khi xóa.`,
    });
  }

  const track = script.voice_tracks[profileId];
  const audioDir = path.join(epDir, "audio");
  const trackAudioDir = safeResolve(audioDir, [profileId]);
  if (
    trackAudioDir &&
    trackAudioDir !== path.resolve(audioDir) &&
    fs.existsSync(trackAudioDir) &&
    fs.statSync(trackAudioDir).isDirectory()
  ) {
    fs.rmSync(trackAudioDir, { recursive: true, force: true });
  }

  // Also remove any unshared per-scene files referenced by this track inside audio/
  const remainingAudioFiles = new Set();
  for (const [otherId, otherTrack] of Object.entries(script.voice_tracks)) {
    if (otherId === profileId || !otherTrack?.scene_data) continue;
    for (const sd of Object.values(otherTrack.scene_data)) {
      if (sd?.audio_file) {
        const resolved = safeResolve(epDir, String(sd.audio_file).split(/[\\/]/));
        if (resolved) remainingAudioFiles.add(resolved);
      }
    }
  }
  if (track?.scene_data && typeof track.scene_data === "object") {
    for (const sd of Object.values(track.scene_data)) {
      if (!sd?.audio_file) continue;
      const targetAudio = safeResolve(epDir, String(sd.audio_file).split(/[\\/]/));
      if (
        targetAudio &&
        targetAudio.startsWith(path.resolve(audioDir) + path.sep) &&
        !remainingAudioFiles.has(targetAudio) &&
        fs.existsSync(targetAudio) &&
        fs.statSync(targetAudio).isFile()
      ) {
        fs.unlinkSync(targetAudio);
      }
    }
  }

  const srtRoot = path.join(epDir, "subtitles.srt");
  const srtCandidates = [
    `subtitles.${profileId}.srt`,
    track?.subtitles_srt ? String(track.subtitles_srt) : "",
  ].filter(Boolean);
  for (const srtName of srtCandidates) {
    const srtTarget = safeResolve(epDir, [srtName]);
    if (
      srtTarget &&
      srtTarget !== path.resolve(srtRoot) &&
      fs.existsSync(srtTarget) &&
      fs.statSync(srtTarget).isFile()
    ) {
      fs.unlinkSync(srtTarget);
    }
  }

  delete script.voice_tracks[profileId];
  writeJsonAtomic(scriptPath, script);

  const state = mutateEpisodeStateForJob(
    course,
    episode,
    () => {},
    {
      type: "voice_track_deleted",
      profile_id: profileId,
      message: `Deleted unused voice track ${profileId}`,
    }
  );

  return sendJson(res, 200, {
    ok: true,
    course,
    episode,
    deleted_profile_id: profileId,
    active_voice_track: script.active_voice_track,
    voice_tracks: script.voice_tracks,
    voice_tracks_summary: summarizeVoiceTracks(script),
    script,
    state,
  });
}

async function handleSceneTimings(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const course = String(body.course || "").trim();
  const episode = String(body.episode || "").trim();
  const sceneId = String(body.scene_id || "").trim();
  const action = String(body.action || "save").trim();

  if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
    return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
  }
  if (!sceneId || !/^[A-Za-z0-9_.-]+$/.test(sceneId)) {
    return sendJson(res, 400, { ok: false, error: "Invalid scene_id" });
  }
  if (action !== "save" && action !== "auto_align") {
    return sendJson(res, 400, { ok: false, error: 'action must be "save" or "auto_align"' });
  }

  const key = `${course}:${episode}`;
  if (activeJobByEp.has(key)) {
    const existingJob = jobs.get(activeJobByEp.get(key));
    if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
      return sendJson(res, 409, {
        ok: false,
        error: `Tập ${episode} đang có tác vụ TTS/Render đang chạy. Vui lòng đợi hoàn tất trước khi chỉnh timing.`,
      });
    }
  }

  const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
  const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode]);
  const scriptPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode, "script.json"]);
  if (!courseDir || !epDir || !scriptPath || !fs.existsSync(scriptPath)) {
    return sendJson(res, 404, { ok: false, error: `Không tìm thấy script.json cho ${course}/${episode}.` });
  }

  let courseMeta = {};
  const courseJsonPath = path.join(courseDir, "course.json");
  if (fs.existsSync(courseJsonPath)) {
    try {
      courseMeta = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    } catch {
      courseMeta = {};
    }
  }

  let rawScript;
  try {
    rawScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  } catch {
    return sendJson(res, 400, { ok: false, error: `script.json của ${course}/${episode} bị lỗi cú pháp JSON.` });
  }

  const stateDir = path.join(courseDir, "state");
  const existingState = readEpisodeState(stateDir, episode);
  let script = normalizeScriptVoiceTracks(rawScript, epDir, courseMeta, existingState);

  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  let targetScene = scenes.find((s) => s && s.id === sceneId);
  if (!targetScene) {
    return sendJson(res, 404, { ok: false, error: `Không tìm thấy phân cảnh "${sceneId}" trong script.json.` });
  }

  if (action === "auto_align") {
    const ttsArgs = [TTS_SCRIPT_PATH, "--realign-only", "--episode", scriptPath, "--scene", sceneId, "--json"];
    const activeProfile = script.active_voice_track || script.tts_profile || null;
    if (activeProfile && isValidSafeTrackId(activeProfile)) {
      const voicesData = loadVoicesConfig();
      if (
        voicesData.profiles.some((p) => p && p.id === activeProfile) ||
        script.voice_tracks?.[activeProfile]
      ) {
        ttsArgs.push("--profile", activeProfile);
      }
    }

    let alignRes;
    try {
      alignRes = await runChildProcess(PYTHON_BIN, ttsArgs, { timeoutMs: 60_000 });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }

    const parsedAlign = parseJsonFromStdout(alignRes.stdout);
    if (alignRes.code !== 0 || parsedAlign?.ok === false) {
      const errMsg =
        parsedAlign?.error ||
        alignRes.stderr?.trim() ||
        alignRes.stdout?.trim() ||
        `Realign exited with code ${alignRes.code}`;
      return sendJson(res, 502, { ok: false, error: errMsg });
    }

    try {
      const reloaded = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      script = normalizeScriptVoiceTracks(reloaded, epDir, courseMeta, existingState);
      targetScene = (Array.isArray(script.scenes) ? script.scenes : []).find((s) => s && s.id === sceneId) || targetScene;
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: `Không thể đọc lại script.json sau khi căn timing: ${err.message}` });
    }
  } else {
    if (!body.timings || typeof body.timings !== "object" || Array.isArray(body.timings)) {
      return sendJson(res, 400, { ok: false, error: "timings object is required when action is \"save\"" });
    }

    if (!targetScene._base_timings) {
      targetScene._base_timings = extractSceneTimings(targetScene);
    }

    const clampedTimings = normalizeAndClampTimings(targetScene, body.timings);
    applySceneTimings(targetScene, clampedTimings);

    const activeId = script.active_voice_track;
    if (activeId && script.voice_tracks && script.voice_tracks[activeId]) {
      const track = script.voice_tracks[activeId];
      track.scene_data = track.scene_data && typeof track.scene_data === "object" ? track.scene_data : {};
      const prevSceneData = track.scene_data[sceneId] && typeof track.scene_data[sceneId] === "object"
        ? track.scene_data[sceneId]
        : {
            audio_file: targetScene.audio_file || null,
            duration_sec: Number(targetScene.duration_sec) || 0,
            subtitles: Array.isArray(targetScene.subtitles) ? targetScene.subtitles : [],
          };
      track.scene_data[sceneId] = {
        ...prevSceneData,
        timings: cloneJsonSafe(clampedTimings),
      };
    }

    writeJsonAtomic(scriptPath, script);
  }

  const state = mutateEpisodeStateForJob(
    course,
    episode,
    (st, artifacts) => {
      st.production = st.production || {};
      if (st.production.video_done || artifacts.video_file) {
        st.production.stale = true;
        st.production.stale_reason =
          action === "auto_align"
            ? `Auto-aligned animation timings for ${sceneId}`
            : `Updated animation timings for ${sceneId}`;
      }
    },
    {
      type: "scene_timings_updated",
      scene_id: sceneId,
      action,
      profile_id: script.active_voice_track || null,
      message:
        action === "auto_align"
          ? `Auto-aligned subtitle cues for ${sceneId}`
          : `Saved manual timings for ${sceneId}`,
    }
  );

  return sendJson(res, 200, {
    ok: true,
    course,
    episode,
    scene_id: sceneId,
    action,
    active_voice_track: script.active_voice_track || null,
    scene: targetScene,
    script,
    state,
  });
}

// --- Background Production Job Runner ---
const MAX_CONCURRENT_JOBS = 1;
const VALID_JOB_MODES = new Set(["tts_and_render", "tts_only", "render_only"]);
const VALID_VIDEO_FORMATS = new Set(["mp4", "webm"]);
const VALID_VIDEO_CODECS = new Set(["h264", "hevc", "vp9"]);
const VALID_HARDWARE_MODES = new Set(["auto", "gpu", "cpu"]);
const VALID_RESOLUTIONS = new Set(["720p", "1080p", "1440p", "2160p"]);
const VALID_FPS = new Set([24, 30, 60]);
const VALID_SPEEDS = new Set([1, 1.25, 1.5, 2]);

const VALID_TTS_PROVIDERS = new Set([
  "auto",
  "edge",
  "google",
  "voicestudio",
  "openai_compat",
  "custom_http",
]);

const jobs = new Map(); // jobId -> job
const jobRuntimes = new Map(); // jobId -> { child, cancelled }
const activeJobByEp = new Map(); // `${course}:${episode}` -> jobId
const pendingQueue = []; // FIFO array of jobId
let runningJobCount = 0;
let jobSeqCounter = 0;

function sanitizeJobForApi(job) {
  return {
    id: job.id,
    course: job.course,
    episode: job.episode,
    episode_title: job.episode_title || job.episode,
    mode: job.mode,
    profile_id: job.profile_id || null,
    tts_profile: job.tts_profile || job.profile_id || null,
    tts_provider: job.tts_provider || null,
    tts_voice: job.tts_voice || null,
    tts_rate: job.tts_rate || null,
    format: job.format,
    codec: job.codec,
    hardware: job.hardware,
    resolution: job.resolution,
    fps: job.fps,
    speed: job.speed,
    status: job.status,
    step: job.step,
    progress: job.progress,
    queue_position: job.queue_position ?? null,
    output_stem: job.output_stem ?? null,
    output_filename: job.output_filename ?? null,
    output_file: job.output_file ?? null,
    logs: [...job.logs],
    error: job.error ?? null,
    started_at: job.started_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at ?? null,
  };
}

function appendJobLog(job, line) {
  if (!line) return;
  job.logs.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  if (job.logs.length > 100) {
    job.logs.splice(0, job.logs.length - 100);
  }
}

function countEpisodeAudioFiles(epDir) {
  const audioDir = path.join(epDir, "audio");
  if (!fs.existsSync(audioDir) || !fs.statSync(audioDir).isDirectory()) {
    return 0;
  }
  let count = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(mp3|wav)$/i.test(entry.name)) {
        try {
          if (fs.statSync(fullPath).size > 0) count += 1;
        } catch {
          // ignore
        }
      }
    }
  };
  walk(audioDir);
  return count;
}

function resolveEpisodeTitle(courseDir, epId, scriptJson = null) {
  if (scriptJson?.title) return String(scriptJson.title);
  const scriptPath = path.join(courseDir, "episodes", epId, "script.json");
  if (fs.existsSync(scriptPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      if (parsed?.title) return String(parsed.title);
    } catch {
      // ignore
    }
  }
  const courseJsonPath = path.join(courseDir, "course.json");
  if (fs.existsSync(courseJsonPath)) {
    try {
      const courseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
      const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === epId);
      if (epMeta?.title) return String(epMeta.title);
    } catch {
      // ignore
    }
  }
  return epId;
}

function renderTimeoutForJob(job) {
  if (job.resolution === "2160p") return 1_800_000;
  if (job.resolution === "1440p") return 1_200_000;
  return 900_000;
}

function mutateEpisodeStateForJob(course, episode, mutator, eventPayload = null) {
  const courseDir = path.join(WORKSPACE_ROOT, course);
  const stateDir = path.join(courseDir, "state");
  const courseJsonPath = path.join(courseDir, "course.json");
  fs.mkdirSync(stateDir, { recursive: true });

  let courseJson = { stages: [] };
  if (fs.existsSync(courseJsonPath)) {
    try {
      courseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
    } catch {
      courseJson = { stages: [] };
    }
  }
  const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === episode) || {
    id: episode,
    number: 0,
    stage: 0,
    title: episode,
    course_status: "planned",
  };
  const artifacts = inspectEpisodeArtifacts(courseDir, episode);
  let state = readEpisodeState(stateDir, episode);
  if (!state) {
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  }
  mutator(state, artifacts);
  state.artifacts = inspectEpisodeArtifacts(courseDir, episode);
  state.updated_at = new Date().toISOString();
  recomputeState(state);
  writeJsonAtomic(path.join(stateDir, `${episode}.json`), state);
  if (eventPayload) {
    appendEvent(stateDir, {
      course,
      episode_id: episode,
      overall_status: state.overall_status,
      ...eventPayload,
    });
  }
  scheduleStateBroadcast(course, `${episode}.json`);
  return state;
}

function refreshQueuePositions({ broadcast = true } = {}) {
  for (let i = 0; i < pendingQueue.length; i++) {
    const qId = pendingQueue[i];
    const qJob = jobs.get(qId);
    if (!qJob || qJob.status !== "queued") continue;
    const nextPos = i + 1;
    if (qJob.queue_position !== nextPos) {
      qJob.queue_position = nextPos;
      qJob.updated_at = new Date().toISOString();
      if (broadcast) {
        broadcastSse("job_update", { job: sanitizeJobForApi(qJob) });
      }
    }
  }
}

function pumpJobQueue() {
  while (runningJobCount < MAX_CONCURRENT_JOBS && pendingQueue.length > 0) {
    const nextJobId = pendingQueue.shift();
    const job = jobs.get(nextJobId);
    if (!job || job.status !== "queued") continue;

    runningJobCount += 1;
    job.queue_position = null;
    job.status = "running";
    job.step = job.mode === "render_only" ? "rendering" : "tts_processing";
    job.updated_at = new Date().toISOString();
    broadcastSse("job_update", { job: sanitizeJobForApi(job) });
    refreshQueuePositions({ broadcast: true });

    void executeProductionJob(job).finally(() => {
      runningJobCount = Math.max(0, runningJobCount - 1);
      pumpJobQueue();
    });
  }
}

async function executeProductionJob(job) {
  const key = `${job.course}:${job.episode}`;
  const courseDir = path.join(WORKSPACE_ROOT, job.course);
  const courseJsonPath = path.join(courseDir, "course.json");
  const epDir = path.join(courseDir, "episodes", job.episode);
  const scriptPath = path.join(epDir, "script.json");

  const rt = { child: null, cancelled: false };
  jobRuntimes.set(job.id, rt);

  const emitJob = (patch = {}, logLine = null) => {
    if (rt.cancelled || job.status === "cancelled") return;
    Object.assign(job, patch, { updated_at: new Date().toISOString() });
    appendJobLog(job, logLine);
    broadcastSse("job_update", { job: sanitizeJobForApi(job) });
  };

  const mutateState = (mutator, eventPayload = null) =>
    mutateEpisodeStateForJob(job.course, job.episode, mutator, eventPayload);

  try {
    if (rt.cancelled || job.status === "cancelled") return;

    if (job.mode !== "render_only") {
      // Step 1: Optional voice profile assignment
      if (job.profile_id) {
        emitJob(
          { status: "running", step: "assign_voice", progress: 5 },
          `Applying voice profile "${job.profile_id}"...`
        );
        assignVoiceProfile({ course: job.course, episode: job.episode, profileId: job.profile_id });
        if (rt.cancelled) return;
      }

      // Step 2: TTS Synthesis
      const nowStart = new Date().toISOString();
      mutateState(
        (state) => {
          state.production = state.production || {};
          state.production.status = "tts_processing";
          state.production.started_at = state.production.started_at || nowStart;
          state.last_error = null;
        },
        { type: "job_tts_started", job_id: job.id, mode: job.mode }
      );
      emitJob(
        { status: "running", step: "tts_processing", progress: 15 },
        `Starting TTS synthesis for ${job.course}/${job.episode}...`
      );

      const ttsArgs = [TTS_SCRIPT_PATH, "--episode", scriptPath, "--course", courseJsonPath, "--json"];
      if (job.profile_id) {
        ttsArgs.push("--profile", job.profile_id);
      }
      if (job.tts_provider) {
        ttsArgs.push("--provider", job.tts_provider);
      }
      if (job.tts_voice) {
        ttsArgs.push("--voice", job.tts_voice);
      }
      if (job.tts_rate) {
        ttsArgs.push("--rate", job.tts_rate);
      }

      const ttsRes = await runChildProcess(PYTHON_BIN, ttsArgs, {
        timeoutMs: 300_000,
        onSpawn: (child) => {
          rt.child = child;
        },
        onLog: (line) => {
          const currentProgress = Math.min(48, job.progress + 3);
          emitJob({ progress: currentProgress }, line);
        },
      });
      rt.child = null;

      if (rt.cancelled || job.status === "cancelled") return;

      if (ttsRes.code !== 0) {
        const errMsg =
          ttsRes.stderr?.trim() || ttsRes.stdout?.trim() || `TTS exited with code ${ttsRes.code}`;
        mutateState(
          (state) => {
            state.production.status = "needs_revision";
            state.last_error = errMsg;
          },
          { type: "job_failed", job_id: job.id, step: "tts_processing", error: errMsg }
        );
        emitJob(
          {
            status: "failed",
            step: "error",
            error: errMsg,
            completed_at: new Date().toISOString(),
          },
          `TTS failed: ${errMsg}`
        );
        return;
      }

      if (job.mode === "tts_only") {
        const nowDone = new Date().toISOString();
        mutateState(
          (state, artifacts) => {
            state.production.tts_done = true;
            if (state.production.video_done || artifacts.video_file) {
              state.production.stale = true;
              state.production.stale_reason = "Audio regenerated; video needs re-render";
            } else {
              state.production.stale = false;
              state.production.stale_reason = null;
            }
            state.production.status = "pending";
            state.last_error = null;
          },
          { type: "job_tts_completed", job_id: job.id }
        );
        emitJob(
          {
            status: "completed",
            step: "done",
            progress: 100,
            completed_at: nowDone,
          },
          "TTS synthesis completed."
        );
        return;
      }
    } else {
      // render_only preflight validation before spawning Chrome
      if (!fs.existsSync(scriptPath)) {
        const errMsg = `Không tìm thấy script.json cho ${job.course}/${job.episode}.`;
        emitJob(
          {
            status: "failed",
            step: "error",
            error: errMsg,
            completed_at: new Date().toISOString(),
          },
          errMsg
        );
        return;
      }
      const audioCount = countEpisodeAudioFiles(epDir);
      if (audioCount === 0) {
        const errMsg = `Tập "${job.episode}" chưa có file audio trong thư mục audio/. Hãy chạy TTS trước hoặc chọn "Tạo Audio & Render".`;
        mutateState(
          (state) => {
            state.production = state.production || {};
            state.production.status = "needs_revision";
            state.last_error = errMsg;
          },
          { type: "job_failed", job_id: job.id, step: "rendering", error: errMsg }
        );
        emitJob(
          {
            status: "failed",
            step: "error",
            error: errMsg,
            completed_at: new Date().toISOString(),
          },
          errMsg
        );
        return;
      }
    }

    if (rt.cancelled || job.status === "cancelled") return;

    // Step 3: Headless Chrome Video Rendering (tts_and_render / render_only)
    const nowRenderStart = new Date().toISOString();
    const renderStartProgress = job.mode === "render_only" ? 5 : 55;
    mutateState(
      (state) => {
        state.production = state.production || {};
        state.production.tts_done = true;
        state.production.started_at = state.production.started_at || nowRenderStart;
        state.production.status = "rendering";
        state.last_error = null;
      },
      {
        type: "job_render_started",
        job_id: job.id,
        format: job.format,
        codec: job.codec,
        hardware: job.hardware,
        resolution: job.resolution,
        fps: job.fps,
        speed: job.speed,
      }
    );
    emitJob(
      { status: "running", step: "rendering", progress: renderStartProgress },
      `${job.mode === "render_only" ? "Starting" : "TTS complete. Starting"} offline video render (${job.resolution} @ ${job.fps}fps, ${job.speed}x, ${job.format}/${job.codec}, hw=${job.hardware})...`
    );

    const renderTimeoutMs = renderTimeoutForJob(job);
    const targetOutputFilename =
      job.output_filename || `${job.output_stem || job.episode}.${job.format}`;
    const renderArgs = [
      RENDER_SCRIPT_PATH,
      "--course",
      job.course,
      "--episode",
      job.episode,
      "--port",
      String(PORT),
      "--format",
      job.format,
      "--codec",
      job.codec,
      "--hardware",
      job.hardware,
      "--resolution",
      job.resolution,
      "--fps",
      String(job.fps),
      "--speed",
      String(job.speed),
      "--output",
      targetOutputFilename,
      "--timeout-ms",
      String(renderTimeoutMs),
    ];

    const renderRes = await runChildProcess(process.execPath, renderArgs, {
      timeoutMs: renderTimeoutMs,
      pipeStdin: true,
      onSpawn: (child) => {
        rt.child = child;
      },
      onLog: (line) => {
        let nextProgress = job.progress;
        const pctMatch = /(\d{1,3}(?:\.\d+)?)%/.exec(line);
        if (pctMatch) {
          const pct = Number(pctMatch[1]);
          if (Number.isFinite(pct)) {
            const span = 96 - renderStartProgress;
            nextProgress = Math.max(
              renderStartProgress,
              Math.min(96, Math.round(renderStartProgress + (pct / 100) * span))
            );
          }
        } else {
          nextProgress = Math.min(95, job.progress + 2);
        }
        emitJob({ progress: nextProgress }, line);
      },
    });
    rt.child = null;

    if (rt.cancelled || job.status === "cancelled") return;

    if (renderRes.code !== 0) {
      const errMsg =
        renderRes.stderr?.trim() ||
        renderRes.stdout?.trim() ||
        `render_video.mjs exited with code ${renderRes.code}`;
      mutateState(
        (state) => {
          state.production.status = "needs_revision";
          state.last_error = errMsg;
        },
        { type: "job_failed", job_id: job.id, step: "rendering", error: errMsg }
      );
      emitJob(
        {
          status: "failed",
          step: "error",
          error: errMsg,
          completed_at: new Date().toISOString(),
        },
        `Render failed: ${errMsg}`
      );
      return;
    }

    const outputStem = job.output_stem || job.episode;
    const expectedFilename = `${outputStem}.${job.format}`;
    const fallbackWebmFilename = `${outputStem}.webm`;
    const expectedPath = path.join(epDir, expectedFilename);
    const fallbackWebmPath = path.join(epDir, fallbackWebmFilename);
    const artifacts = inspectEpisodeArtifacts(courseDir, job.episode);

    let outputFile = artifacts.video_file || expectedFilename;
    const hasExpected = fs.existsSync(expectedPath);
    const hasFallbackWebm =
      fallbackWebmFilename !== expectedFilename && fs.existsSync(fallbackWebmPath);
    if (hasExpected && hasFallbackWebm) {
      const expectedMtime = fs.statSync(expectedPath).mtimeMs;
      const fallbackMtime = fs.statSync(fallbackWebmPath).mtimeMs;
      outputFile = fallbackMtime > expectedMtime ? fallbackWebmFilename : expectedFilename;
    } else if (hasExpected) {
      outputFile = expectedFilename;
    } else if (hasFallbackWebm) {
      outputFile = fallbackWebmFilename;
    }

    const nowFinal = new Date().toISOString();
    mutateState(
      (state) => {
        state.production.tts_done = true;
        state.production.video_done = true;
        state.production.verified = true;
        state.production.stale = false;
        state.production.stale_reason = null;
        state.production.status = "completed";
        state.production.completed_at = nowFinal;
        state.last_error = null;
      },
      {
        type: "job_render_completed",
        job_id: job.id,
        format: job.format,
        codec: job.codec,
        output_file: outputFile,
      }
    );
    emitJob(
      {
        status: "completed",
        step: "done",
        progress: 100,
        output_file: outputFile,
        completed_at: nowFinal,
      },
      `${job.mode === "render_only" ? "Video render" : "TTS & Video render"} completed cleanly: ${outputFile}`
    );
  } catch (err) {
    if (!rt.cancelled && job.status !== "cancelled") {
      emitJob(
        {
          status: "failed",
          step: "error",
          error: err.message,
          completed_at: new Date().toISOString(),
        },
        `Unexpected job error: ${err.message}`
      );
    }
  } finally {
    jobRuntimes.delete(job.id);
    if (activeJobByEp.get(key) === job.id) {
      activeJobByEp.delete(key);
    }
  }
}

function listSortedJobs({ course = "", episode = "" } = {}) {
  let list = Array.from(jobs.values());
  if (course) list = list.filter((j) => j.course === course);
  if (episode) list = list.filter((j) => j.episode === episode);
  list.sort((a, b) => {
    const tCmp = String(b.started_at).localeCompare(String(a.started_at));
    if (tCmp !== 0) return tCmp;
    return (b._seq || 0) - (a._seq || 0);
  });
  return list.map(sanitizeJobForApi);
}

function handleGetJobs(res, parsedUrl) {
  const course = parsedUrl.searchParams.get("course") || "";
  const episode = parsedUrl.searchParams.get("episode") || "";
  return sendJson(res, 200, { ok: true, jobs: listSortedJobs({ course, episode }) });
}

function sanitizeVideoOutputStem(rawName, episodeId = "") {
  let stem = String(rawName ?? "").trim();
  stem = stem.replace(/\.(mp4|webm)$/i, "").trim();
  stem = stem.replace(/\s+/g, "-");
  if (!stem) {
    stem = String(episodeId ?? "")
      .trim()
      .replace(/\.(mp4|webm)$/i, "")
      .trim()
      .replace(/\s+/g, "-");
  }
  if (!stem) {
    return { ok: false, error: "Tên file đầu ra không được để trống." };
  }
  if (
    stem.includes("/") ||
    stem.includes("\\") ||
    stem.includes("..") ||
    !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,95}$/.test(stem)
  ) {
    return {
      ok: false,
      error:
        'Tên file đầu ra không hợp lệ. Chỉ dùng chữ, số, "_", "-", "." (tối đa 96 ký tự, không chứa "/", "\\", "..").',
    };
  }
  return { ok: true, stem };
}

function validateRenderOptions(raw = {}, { requireScriptCheck = false } = {}) {
  const mode = String(raw.mode || "tts_and_render").trim();
  const rawProfileId = raw.profile_id ?? raw.tts_profile ?? null;
  const profile_id = rawProfileId ? String(rawProfileId).trim() : null;
  const tts_provider = raw.tts_provider ? String(raw.tts_provider).trim() : null;
  const tts_voice = raw.tts_voice ? String(raw.tts_voice).trim() : null;
  const tts_rate = raw.tts_rate ? String(raw.tts_rate).trim() : null;
  const format = String(raw.format || "mp4").trim().toLowerCase();
  const codec = String(raw.codec || (format === "webm" ? "vp9" : "h264")).trim().toLowerCase();
  const hardware = String(raw.hardware || "auto").trim().toLowerCase();
  const resolution = String(raw.resolution || "1080p").trim().toLowerCase();
  const fps = raw.fps !== undefined && raw.fps !== null && raw.fps !== "" ? Number(raw.fps) : 60;
  const speed = raw.speed !== undefined && raw.speed !== null && raw.speed !== "" ? Number(raw.speed) : 1;
  const rawOutputName = raw.output_filename ?? raw.output_name ?? "";
  const episodeFallback = raw.episode ? String(raw.episode).trim() : "";

  if (!VALID_JOB_MODES.has(mode)) {
    return { ok: false, status: 400, error: 'mode must be "tts_and_render", "tts_only", or "render_only"' };
  }
  if (tts_provider && !VALID_TTS_PROVIDERS.has(tts_provider)) {
    return { ok: false, status: 400, error: `Unsupported tts_provider "${tts_provider}"` };
  }
  if (!VALID_VIDEO_FORMATS.has(format)) {
    return { ok: false, status: 400, error: 'format must be "mp4" or "webm"' };
  }
  if (!VALID_VIDEO_CODECS.has(codec)) {
    return { ok: false, status: 400, error: 'codec must be "h264", "hevc", or "vp9"' };
  }
  if (format === "mp4" && codec === "vp9") {
    return { ok: false, status: 400, error: 'Định dạng MP4 chỉ hỗ trợ codec "h264" hoặc "hevc".' };
  }
  if (format === "webm" && codec !== "vp9") {
    return { ok: false, status: 400, error: 'Định dạng WebM chỉ hỗ trợ codec "vp9".' };
  }
  if (!VALID_HARDWARE_MODES.has(hardware)) {
    return { ok: false, status: 400, error: 'hardware must be "auto", "gpu", or "cpu"' };
  }
  if (hardware === "gpu" && codec === "vp9") {
    return {
      ok: false,
      status: 400,
      error: "GPU Chrome chỉ hỗ trợ mã hóa phần cứng H.264/HEVC MP4 (VP9 cần chế độ CPU).",
    };
  }
  if (hardware === "cpu" && codec === "hevc") {
    return {
      ok: false,
      status: 400,
      error: "CPU software encoder không hỗ trợ HEVC trong Chrome (chọn GPU hoặc H.264/VP9).",
    };
  }
  if (!VALID_RESOLUTIONS.has(resolution)) {
    return { ok: false, status: 400, error: 'resolution must be "720p", "1080p", "1440p", or "2160p"' };
  }
  if (!VALID_FPS.has(fps)) {
    return { ok: false, status: 400, error: "fps must be 24, 30, or 60" };
  }
  if (!VALID_SPEEDS.has(speed)) {
    return { ok: false, status: 400, error: "speed must be 1, 1.25, 1.5, or 2" };
  }

  let output_stem = null;
  let output_filename = null;
  if (String(rawOutputName).trim() !== "" || episodeFallback !== "") {
    const stemRes = sanitizeVideoOutputStem(rawOutputName, episodeFallback);
    if (!stemRes.ok) {
      return { ok: false, status: 400, error: stemRes.error };
    }
    output_stem = stemRes.stem;
    output_filename = `${output_stem}.${format}`;
  }

  if (profile_id && (mode !== "render_only" || !requireScriptCheck)) {
    const voicesData = loadVoicesConfig();
    if (!voicesData.profiles.some((p) => p && p.id === profile_id)) {
      return { ok: false, status: 404, error: `Voice profile "${profile_id}" not found` };
    }
  }

  return {
    ok: true,
    options: {
      mode,
      profile_id: mode === "render_only" ? null : profile_id,
      tts_profile: mode === "render_only" ? null : profile_id,
      tts_provider: mode === "render_only" ? null : tts_provider,
      tts_voice: mode === "render_only" ? null : tts_voice,
      tts_rate: mode === "render_only" ? null : tts_rate,
      format,
      codec,
      hardware,
      resolution,
      fps,
      speed,
      output_stem,
      output_filename,
    },
  };
}

function enqueueProductionJob(params = {}) {
  const course = String(params.course || "").trim();
  const episode = String(params.episode || "").trim();

  if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
    return { ok: false, status: 400, error: "Invalid course or episode identifier" };
  }

  const optsRes = validateRenderOptions(params, { requireScriptCheck: true });
  if (!optsRes.ok) {
    return optsRes;
  }
  const {
    mode,
    profile_id,
    tts_profile,
    tts_provider,
    tts_voice,
    tts_rate,
    format,
    codec,
    hardware,
    resolution,
    fps,
    speed,
    output_stem,
    output_filename,
  } = optsRes.options;
  const resolvedStem = output_stem || episode;
  const resolvedOutputFilename = output_filename || `${resolvedStem}.${format}`;

  const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
  const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode]);
  const scriptPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode, "script.json"]);
  if (!courseDir || !epDir || !scriptPath || !fs.existsSync(scriptPath)) {
    return {
      ok: false,
      status: 404,
      error: `Không tìm thấy script.json cho ${course}/${episode}.`,
    };
  }

  let scriptJson = null;
  try {
    scriptJson = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  } catch {
    return {
      ok: false,
      status: 400,
      error: `script.json của ${course}/${episode} bị lỗi cú pháp JSON.`,
    };
  }

  if (mode === "render_only") {
    const audioCount = countEpisodeAudioFiles(epDir);
    if (audioCount === 0) {
      return {
        ok: false,
        status: 400,
        error: `Tập "${episode}" chưa có file audio trong thư mục audio/. Hãy tạo Audio (TTS) trước hoặc chọn "Tạo Audio & Render".`,
      };
    }
  }

  const key = `${course}:${episode}`;
  if (activeJobByEp.has(key)) {
    const existingId = activeJobByEp.get(key);
    const existingJob = jobs.get(existingId);
    if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
      return {
        ok: false,
        status: 409,
        error: `Tập ${episode} đang có tác vụ ${existingJob.status === "queued" ? "trong hàng đợi" : "đang chạy"}.`,
        extra: { job_id: existingId, job: sanitizeJobForApi(existingJob) },
      };
    }
    activeJobByEp.delete(key);
  }

  const episode_title = resolveEpisodeTitle(courseDir, episode, scriptJson);
  const now = new Date().toISOString();
  const job = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    _seq: ++jobSeqCounter,
    course,
    episode,
    episode_title,
    mode,
    profile_id,
    tts_profile,
    tts_provider,
    tts_voice,
    tts_rate,
    format,
    codec,
    hardware,
    resolution,
    fps,
    speed,
    output_stem: resolvedStem,
    output_filename: resolvedOutputFilename,
    status: "queued",
    step: "queued",
    progress: 0,
    queue_position: pendingQueue.length + 1,
    output_file: null,
    logs: [],
    error: null,
    started_at: now,
    updated_at: now,
    completed_at: null,
  };
  appendJobLog(
    job,
    `Queued ${mode} (${resolution} @ ${fps}fps, ${speed}x, ${format}/${codec}, hw=${hardware}, output=${resolvedOutputFilename})`
  );

  jobs.set(job.id, job);
  activeJobByEp.set(key, job.id);
  pendingQueue.push(job.id);

  broadcastSse("job_update", { job: sanitizeJobForApi(job) });
  pumpJobQueue();

  return { ok: true, status: 202, job: sanitizeJobForApi(job) };
}

async function handleRunProductionJob(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const result = enqueueProductionJob(body);
  if (!result.ok) {
    return sendJson(res, result.status || 400, {
      ok: false,
      error: result.error,
      ...(result.extra || {}),
    });
  }
  return sendJson(res, 202, { ok: true, job: result.job });
}

async function handleCancelJob(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const jobId = String(body.job_id || "").trim();
  if (!jobId) {
    return sendJson(res, 400, { ok: false, error: "job_id is required" });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return sendJson(res, 404, { ok: false, error: `Job "${jobId}" not found` });
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return sendJson(res, 200, { ok: true, already_finished: true, job: sanitizeJobForApi(job) });
  }

  const key = `${job.course}:${job.episode}`;
  const now = new Date().toISOString();
  const wasQueued = job.status === "queued";

  const qIdx = pendingQueue.indexOf(job.id);
  if (qIdx >= 0) {
    pendingQueue.splice(qIdx, 1);
  }

  const rt = jobRuntimes.get(job.id);
  if (rt) {
    rt.cancelled = true;
    const child = rt.child;
    if (child && child.exitCode === null) {
      try {
        if (child.stdin && child.stdin.writable) {
          child.stdin.write("CANCEL\n");
        }
      } catch {
        // ignore
      }
      if (job.step === "rendering") {
        setTimeout(() => {
          try {
            if (child.exitCode === null) child.kill();
          } catch {
            // ignore
          }
        }, 600);
      } else {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    }
  }

  job.status = "cancelled";
  job.step = "cancelled";
  job.queue_position = null;
  job.error = "Đã hủy bởi người dùng";
  job.completed_at = now;
  job.updated_at = now;
  appendJobLog(job, wasQueued ? "Đã hủy tác vụ trong hàng đợi." : "Đã hủy tác vụ đang chạy.");

  if (activeJobByEp.get(key) === job.id) {
    activeJobByEp.delete(key);
  }

  if (!wasQueued) {
    try {
      mutateEpisodeStateForJob(
        job.course,
        job.episode,
        (state) => {
          state.production = state.production || {};
          if (state.production.status === "rendering" || state.production.status === "tts_processing") {
            state.production.status =
              state.production.video_done && state.production.verified && !state.production.stale
                ? "completed"
                : "pending";
          }
          state.last_error = null;
        },
        { type: "job_cancelled", job_id: job.id }
      );
    } catch {
      // ignore if course/state directory no longer exists
    }
  }

  refreshQueuePositions({ broadcast: true });
  broadcastSse("job_update", { job: sanitizeJobForApi(job) });

  return sendJson(res, 200, { ok: true, job: sanitizeJobForApi(job) });
}

function handleClearFinishedJobs(res) {
  let removed = 0;
  for (const [jobId, job] of jobs.entries()) {
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      jobs.delete(jobId);
      removed += 1;
    }
  }
  const remaining = listSortedJobs();
  broadcastSse("jobs_cleared", { jobs: remaining, removed, ts: new Date().toISOString() });
  return sendJson(res, 200, { ok: true, removed, jobs: remaining });
}

// --- AI Broker (Providers, Builtin Runner, Worker Heartbeat & Queue) + MCP HTTP ---
const aiBroker = createAiBroker({
  ENGINE_DIR,
  WORKSPACE_ROOT,
  AI_QUEUE_FILE,
  sendJson,
  readJsonBody,
  safeResolve,
  broadcastSse,
  scheduleStateBroadcast,
  mutateEpisodeStateForJob,
  enqueueProductionJob,
  validateRenderOptions,
  activeJobByEp,
  jobs,
  loadCourseJson,
  flattenCourseEpisodes,
  readEpisodeState,
  listRevisions,
  appendEvent,
  writeJsonAtomic,
  validateScriptDiagrams,
  SUPPORTED_VISUAL_TYPES,
});

aiBroker.startTimersAndLoad();

const mcpHandler = createMcpHandler({
  requestStudio: createStudioHttpRequester({
    host: "127.0.0.1",
    port: () => server.address()?.port || PORT,
  }),
  serverHost: "127.0.0.1",
  serverPort: PORT,
});

async function handleMcpHttp(req, res) {
  if (!aiBroker.requireLoopback(req, res)) return;

  if (req.method === "GET") {
    const accept = String(req.headers.accept || "");
    if (accept.includes("text/event-stream")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write("event: endpoint\ndata: /mcp\n\n");
      const timer = setInterval(() => {
        try {
          res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          clearInterval(timer);
        }
      }, 15_000);
      if (typeof timer.unref === "function") timer.unref();
      req.on("close", () => clearInterval(timer));
      return;
    }
    return sendJson(res, 200, {
      ok: true,
      serverInfo: MCP_SERVER_INFO,
      transport: "http",
      endpoint: "/mcp",
      tools: mcpHandler.TOOLS.map((t) => t.name),
      resources: mcpHandler.STATIC_RESOURCES.map((r) => r.uri),
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req, 4 * 1024 * 1024);
    } catch (err) {
      return sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: err.message || "Parse error" },
      });
    }

    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map((item) => mcpHandler.processMessage(item)))).filter(
        (r) => r !== null
      );
      if (results.length === 0) {
        res.writeHead(202);
        res.end();
        return;
      }
      return sendJson(res, 200, results);
    }

    const resp = await mcpHandler.processMessage(body);
    if (resp === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    return sendJson(res, 200, resp);
  }

  res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "Method Not Allowed (use GET or POST /mcp)" }));
}

// --- API Handlers ---
function handleGetEvents(res, parsedUrl) {
  const course = parsedUrl.searchParams.get("course") || "";
  const limitRaw = Number(parsedUrl.searchParams.get("limit") || 50);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;

  if (course) {
    if (!/^[A-Za-z0-9_-]+$/.test(course)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course identifier" });
    }
    const stateDir = safeResolve(WORKSPACE_ROOT, [course, "state"]);
    if (!stateDir) {
      return sendJson(res, 403, { ok: false, error: "Forbidden" });
    }
    const events = readEvents(stateDir, limit);
    return sendJson(res, 200, { ok: true, course, events });
  }

  const allEvents = [];
  for (const { courseDir } of listCourseDirs()) {
    const stateDir = path.join(courseDir, "state");
    allEvents.push(...readEvents(stateDir, limit));
  }
  allEvents.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  return sendJson(res, 200, { ok: true, course: null, events: allEvents.slice(0, limit) });
}

async function handlePostState(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  const course = String(body.course || "");
  const episode = String(body.episode || "");
  const action = String(body.action || "");
  const note = body.note !== undefined ? String(body.note) : undefined;
  const owner = body.owner !== undefined ? String(body.owner) : undefined;
  const targetStage = body.target_stage ? String(body.target_stage) : undefined;

  if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
    return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
  }

  const supportedActions = [
    "needs_revision",
    "reset_production",
    "approve_script",
    "create_revision",
    "update_revision",
    "delete_revision",
    "validate_diagrams",
  ];
  if (!supportedActions.includes(action)) {
    return sendJson(res, 400, {
      ok: false,
      error: `Unsupported action "${action}".`,
    });
  }

  const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
  if (!courseDir || !fs.existsSync(courseDir)) {
    return sendJson(res, 404, { ok: false, error: "Course not found" });
  }

  const courseJsonPath = path.join(courseDir, "course.json");
  if (!fs.existsSync(courseJsonPath)) {
    return sendJson(res, 404, { ok: false, error: "course.json not found" });
  }

  let courseJson;
  try {
    courseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
  } catch {
    return sendJson(res, 500, { ok: false, error: "Malformed course.json" });
  }

  const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === episode);
  if (!epMeta) {
    return sendJson(res, 404, { ok: false, error: `Episode "${episode}" not found in course.json` });
  }

  // New structured revision & diagram actions
  if (action === "create_revision") {
    try {
      const { ticket, state } = addRevisionTicket(WORKSPACE_ROOT, course, episode, {
        scope: String(body.scope || ""),
        scene_id: body.scene_id ? String(body.scene_id) : null,
        description: String(body.description || ""),
        owner: owner || null,
      });
      scheduleStateBroadcast(course, `${episode}.json`);
      return sendJson(res, 200, { ok: true, ticket, state });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (action === "update_revision") {
    try {
      const { ticket, state } = updateRevisionTicket(WORKSPACE_ROOT, course, episode, {
        rev_id: String(body.rev_id || ""),
        status: String(body.status || ""),
        resolution_note: body.resolution_note !== undefined ? String(body.resolution_note) : undefined,
        owner,
      });
      scheduleStateBroadcast(course, `${episode}.json`);
      return sendJson(res, 200, { ok: true, ticket, state });
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 400;
      return sendJson(res, status, { ok: false, error: err.message });
    }
  }

  if (action === "delete_revision") {
    try {
      const { deleted_id, state } = deleteRevisionTicket(
        WORKSPACE_ROOT,
        course,
        episode,
        String(body.rev_id || "")
      );
      scheduleStateBroadcast(course, `${episode}.json`);
      return sendJson(res, 200, { ok: true, deleted_id, state });
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 400;
      return sendJson(res, status, { ok: false, error: err.message });
    }
  }

  if (action === "validate_diagrams") {
    const scriptPath = path.join(courseDir, "episodes", episode, "script.json");
    if (!fs.existsSync(scriptPath)) {
      return sendJson(res, 404, { ok: false, error: "script.json not found for episode" });
    }
    try {
      const scriptJson = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      const validation = validateScriptDiagrams(scriptJson);
      return sendJson(res, 200, { ok: true, validation });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // Legacy actions preserved
  const stateDir = path.join(courseDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const now = new Date().toISOString();
  const artifacts = inspectEpisodeArtifacts(courseDir, episode);
  let state = readEpisodeState(stateDir, episode);
  if (!state) {
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  }

  if (action === "needs_revision") {
    const revStage = targetStage === "production" ? "production" : "scripting";
    state[revStage].status = "needs_revision";
    state[revStage].completed_at = null;
    if (note !== undefined) state[revStage].notes = note;
    if (owner !== undefined) state[revStage].owner = owner;
  } else if (action === "reset_production") {
    state.production = {
      status: "pending",
      phase: null,
      owner: owner !== undefined ? owner : null,
      started_at: null,
      completed_at: null,
      tts_done: false,
      video_done: false,
      verified: false,
      stale: false,
      stale_reason: null,
      notes: note !== undefined ? note : "",
    };
    state.last_error = null;
  } else if (action === "approve_script") {
    state.revisions = Array.isArray(state.revisions) ? state.revisions : [];
    for (const rev of state.revisions) {
      if (
        rev &&
        (rev.scope === "script" || rev.scope === "visual") &&
        (rev.status === "open" || rev.status === "in_progress")
      ) {
        rev.status = "resolved";
        rev.resolved_at = now;
        rev.resolution_note = note || "Approved";
      }
    }
    state.scripting.status = "completed";
    state.scripting.started_at = state.scripting.started_at || now;
    state.scripting.completed_at = now;
    if (note !== undefined) state.scripting.notes = note;
    if (owner !== undefined) state.scripting.owner = owner;
    if (state.production?.status === "needs_revision") {
      state.production.status = "pending";
    }
    state.last_error = null;
  }

  state.artifacts = artifacts;
  state.updated_at = now;
  recomputeState(state);

  const statePath = path.join(stateDir, `${episode}.json`);
  writeJsonAtomic(statePath, state);
  appendEvent(stateDir, {
    type: "api_state_action",
    action,
    course,
    episode_id: episode,
    overall_status: state.overall_status,
    owner: owner || null,
    note: note || "",
  });

  scheduleStateBroadcast(course, `${episode}.json`);
  return sendJson(res, 200, { ok: true, state });
}

const mediaHandlers = createMediaHandlers({
  ENGINE_DIR,
  WORKSPACE_ROOT,
  VOICE_PREVIEW_CACHE_DIR,
  safeResolve,
  sendJson,
  readJsonBody,
  sanitizeVideoOutputStem,
  inspectEpisodeArtifacts,
  readEpisodeState,
  recomputeState,
  writeJsonAtomic,
  appendEvent,
  scheduleStateBroadcast,
  mapEpisodeVideoFiles,
  broadcastSse,
  activeJobByEp,
  jobs,
  mutateEpisodeStateForJob,
});

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (req.method === "GET" && pathname === "/api/courses") {
    return sendJson(res, 200, { workspace: WORKSPACE_ROOT, courses: scanCourses() });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    return handleGetEvents(res, parsedUrl);
  }

  if (req.method === "POST" && pathname === "/api/state") {
    return void handlePostState(req, res);
  }

  if (req.method === "GET" && pathname === "/api/voices") {
    return void handleGetVoices(res, parsedUrl);
  }

  if (req.method === "POST" && pathname === "/api/voices") {
    return void handlePostVoices(req, res);
  }

  if (req.method === "POST" && pathname === "/api/voices/preview") {
    return void handleVoicePreview(req, res);
  }

  if (req.method === "POST" && pathname === "/api/voices/assign") {
    return void handleVoiceAssign(req, res);
  }

  if (req.method === "POST" && pathname === "/api/episodes/voice-track/activate") {
    return void handleVoiceTrackActivate(req, res);
  }

  if (req.method === "POST" && pathname === "/api/episodes/voice-track/delete") {
    return void handleVoiceTrackDelete(req, res);
  }

  if (req.method === "POST" && pathname === "/api/episodes/scene-timings") {
    return void handleSceneTimings(req, res);
  }

  if (req.method === "GET" && pathname === "/api/jobs") {
    return handleGetJobs(res, parsedUrl);
  }

  if (req.method === "POST" && pathname === "/api/jobs/run-production") {
    return void handleRunProductionJob(req, res);
  }

  if (req.method === "POST" && pathname === "/api/jobs/cancel") {
    return void handleCancelJob(req, res);
  }

  if (req.method === "POST" && pathname === "/api/jobs/clear") {
    return handleClearFinishedJobs(res);
  }

  if (aiBroker.handleRequest(req, res, pathname, parsedUrl)) {
    return;
  }

  if (pathname === "/mcp") {
    return void handleMcpHttp(req, res);
  }

  if (req.method === "GET" && pathname === "/api/stream") {
    return handleSseStream(req, res);
  }

  if (mediaHandlers.handleMediaRoutes(req, res, pathname, parsedUrl)) {
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Tech Video Studio server running at http://localhost:${PORT}`);
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
});
