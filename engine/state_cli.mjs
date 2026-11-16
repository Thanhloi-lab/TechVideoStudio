import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateScriptDiagrams } from "./src/diagram_validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, "..");

export const VALID_SCRIPTING_STATUSES = new Set([
  "pending",
  "planning",
  "in_progress",
  "reviewing",
  "needs_revision",
  "completed",
]);

export const VALID_PRODUCTION_STATUSES = new Set([
  "pending",
  "tts_processing",
  "rendering",
  "reviewing",
  "needs_revision",
  "completed",
]);

export const VALID_REVISION_SCOPES = new Set(["script", "visual", "production"]);
export const VALID_REVISION_STATUSES = new Set(["open", "in_progress", "resolved"]);

export const OVERALL_STATUSES = [
  "planned",
  "scripting",
  "script_ready",
  "processing",
  "needs_revision",
  "completed",
];

export function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export function appendEvent(stateDir, event) {
  fs.mkdirSync(stateDir, { recursive: true });
  const eventsPath = path.join(stateDir, "events.jsonl");
  const record = {
    ts: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(eventsPath, JSON.stringify(record) + "\n", "utf-8");
  return record;
}

export function readEvents(stateDir, limit = 50) {
  const eventsPath = path.join(stateDir, "events.jsonl");
  if (!fs.existsSync(eventsPath)) return [];
  const raw = fs.readFileSync(eventsPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parsed = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      parsed.push(JSON.parse(lines[i]));
      if (parsed.length >= limit) break;
    } catch {
      // Skip malformed line
    }
  }
  return parsed;
}

export function loadCourseJson(courseDir) {
  const courseJsonPath = path.join(courseDir, "course.json");
  if (!fs.existsSync(courseJsonPath)) {
    throw new Error(`course.json not found at ${courseJsonPath}`);
  }
  return JSON.parse(fs.readFileSync(courseJsonPath, "utf-8"));
}

export function flattenCourseEpisodes(courseJson) {
  const items = [];
  const stages = Array.isArray(courseJson?.stages) ? courseJson.stages : [];
  for (const stageObj of stages) {
    const stageNum = stageObj.stage ?? 0;
    const stageTitle = stageObj.title || `Stage ${stageNum}`;
    const eps = Array.isArray(stageObj.episodes) ? stageObj.episodes : [];
    for (const ep of eps) {
      items.push({
        id: ep.id,
        number: ep.number ?? 0,
        stage: stageNum,
        stage_title: stageTitle,
        title: ep.title || ep.id,
        duration_target: ep.duration_target || "",
        course_status: ep.status || "planned",
      });
    }
  }
  return items;
}

export function inspectEpisodeArtifacts(courseDir, epId) {
  const epDir = path.join(courseDir, "episodes", epId);
  const script = fs.existsSync(path.join(epDir, "script.json"));
  const notes = fs.existsSync(path.join(epDir, "notes.md"));
  const subtitles = fs.existsSync(path.join(epDir, "subtitles.srt"));

  let audio_count = 0;
  const audioDir = path.join(epDir, "audio");
  if (fs.existsSync(audioDir) && fs.statSync(audioDir).isDirectory()) {
    const countAudioRecursive = (dirPath) => {
      let count = 0;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          count += countAudioRecursive(fullPath);
        } else if (entry.isFile() && /\.(mp3|wav)$/i.test(entry.name)) {
          count += 1;
        }
      }
      return count;
    };
    audio_count = countAudioRecursive(audioDir);
  }

  let video_file = null;
  const video_files = [];
  if (fs.existsSync(epDir) && fs.statSync(epDir).isDirectory()) {
    const epLower = String(epId || "").toLowerCase();
    const entries = fs.readdirSync(epDir, { withFileTypes: true });
    const rawVideos = [];
    for (const entry of entries) {
      if (!/\.(mp4|webm)$/i.test(entry.name)) continue;
      const fullPath = path.join(epDir, entry.name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const format = path.extname(entry.name).slice(1).toLowerCase();
      const lowerName = entry.name.toLowerCase();
      const is_default =
        Boolean(epLower) &&
        (lowerName === `${epLower}.mp4` || lowerName === `${epLower}.webm`);
      rawVideos.push({
        filename: entry.name,
        format,
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        is_default,
        _mtimeMs: stat.mtimeMs,
      });
    }
    rawVideos.sort((a, b) => {
      const mtimeDiff = b._mtimeMs - a._mtimeMs;
      if (mtimeDiff !== 0) return mtimeDiff;
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      if (a.format !== b.format) return a.format === "mp4" ? -1 : 1;
      return a.filename.localeCompare(b.filename);
    });
    for (const { _mtimeMs, ...meta } of rawVideos) {
      video_files.push(meta);
    }
    if (video_files.length > 0) {
      video_file = video_files[0].filename;
    }
  }

  return {
    script,
    notes,
    audio_count,
    subtitles,
    video_file,
    video_files,
  };
}

export function recomputeState(state) {
  state.revisions = Array.isArray(state.revisions) ? state.revisions : [];
  if (state.voice_override === undefined) {
    state.voice_override = null;
  }
  state.scripting = state.scripting || { status: "pending" };
  state.production = state.production || { status: "pending" };
  if (typeof state.production.stale !== "boolean") {
    state.production.stale = false;
  }
  if (state.production.stale_reason === undefined) {
    state.production.stale_reason = null;
  }

  // Open or in-progress revision tickets automatically drive needs_revision
  const activeRevs = state.revisions.filter(
    (r) => r && (r.status === "open" || r.status === "in_progress")
  );
  const hasScriptingRev = activeRevs.some(
    (r) => r.scope === "script" || r.scope === "visual"
  );
  const hasProductionRev = activeRevs.some((r) => r.scope === "production");

  if (hasScriptingRev) {
    state.scripting.status = "needs_revision";
    state.scripting.completed_at = null;
  }
  if (hasProductionRev) {
    state.production.status = "needs_revision";
    state.production.completed_at = null;
  }

  const scriptingStatus = state.scripting?.status || "pending";
  const productionStatus = state.production?.status || "pending";

  let overall_status = "planned";
  let current_stage = "curriculum";

  if (scriptingStatus === "needs_revision" || productionStatus === "needs_revision") {
    overall_status = "needs_revision";
    current_stage =
      scriptingStatus === "needs_revision" || scriptingStatus !== "completed"
        ? "scripting"
        : "production";
  } else if (scriptingStatus !== "completed") {
    if (scriptingStatus === "pending") {
      overall_status = "planned";
      current_stage = "curriculum";
    } else {
      overall_status = "scripting";
      current_stage = "scripting";
    }
  } else {
    // scriptingStatus === "completed"
    if (productionStatus === "completed") {
      if (state.production.stale) {
        overall_status = "script_ready";
        current_stage = "production";
      } else {
        overall_status = "completed";
        current_stage = "done";
      }
    } else if (productionStatus === "pending") {
      overall_status = "script_ready";
      current_stage = "production";
    } else {
      overall_status = "processing";
      current_stage = "production";
    }
  }

  state.overall_status = overall_status;
  state.current_stage = current_stage;
  return state;
}

export function createEpisodeStateFromMeta(epMeta, artifacts, { seedReady = true } = {}) {
  const now = new Date().toISOString();
  const hasFullReadyBundle =
    seedReady &&
    epMeta.course_status === "ready" &&
    artifacts.script &&
    artifacts.notes &&
    artifacts.audio_count > 0 &&
    artifacts.subtitles;

  const hasScriptOnly = seedReady && artifacts.script && !hasFullReadyBundle;

  const state = {
    episode_id: epMeta.id,
    number: epMeta.number,
    stage: epMeta.stage,
    title: epMeta.title,
    overall_status: "planned",
    current_stage: "curriculum",
    updated_at: now,
    scripting: {
      status: hasFullReadyBundle || hasScriptOnly ? "completed" : "pending",
      phase: null,
      owner: null,
      started_at: hasFullReadyBundle || hasScriptOnly ? now : null,
      completed_at: hasFullReadyBundle || hasScriptOnly ? now : null,
      notes: "",
    },
    production: {
      status: hasFullReadyBundle ? "completed" : "pending",
      phase: null,
      owner: null,
      started_at: hasFullReadyBundle ? now : null,
      completed_at: hasFullReadyBundle ? now : null,
      tts_done: hasFullReadyBundle ? true : artifacts.audio_count > 0 && artifacts.subtitles,
      video_done: Boolean(artifacts.video_file),
      verified: hasFullReadyBundle ? true : false,
      stale: false,
      stale_reason: null,
      notes: "",
    },
    artifacts: { ...artifacts },
    revisions: [],
    voice_override: null,
    last_error: null,
  };

  return recomputeState(state);
}

export function readEpisodeState(stateDir, epId) {
  const filePath = path.join(stateDir, `${epId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function generateNextRevisionId(revisions) {
  let maxNum = 0;
  for (const rev of Array.isArray(revisions) ? revisions : []) {
    const match = /^REV-(\d+)$/i.exec(String(rev?.id || "").trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `REV-${String(maxNum + 1).padStart(3, "0")}`;
}

function loadOrInitEpisodeState(workspaceRoot, courseId, epId) {
  const courseDir = path.join(workspaceRoot, courseId);
  const stateDir = path.join(courseDir, "state");
  const courseJson = loadCourseJson(courseDir);
  const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === epId);
  if (!epMeta) {
    throw new Error(`Episode "${epId}" not found in ${courseId}/course.json`);
  }
  const artifacts = inspectEpisodeArtifacts(courseDir, epId);
  let state = readEpisodeState(stateDir, epId);
  if (!state) {
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  }
  state.revisions = Array.isArray(state.revisions) ? state.revisions : [];
  state.production = state.production || {};
  return { courseDir, stateDir, epMeta, artifacts, state };
}

export function addRevisionTicket(
  workspaceRoot,
  courseId,
  epId,
  { scope, scene_id = null, description, owner = null }
) {
  if (!VALID_REVISION_SCOPES.has(scope)) {
    throw new Error(`Invalid revision scope "${scope}". Expected "script", "visual", or "production".`);
  }
  const desc = String(description || "").trim();
  if (!desc) {
    throw new Error("Revision description is required.");
  }

  const { stateDir, artifacts, state } = loadOrInitEpisodeState(workspaceRoot, courseId, epId);
  const now = new Date().toISOString();
  const id = generateNextRevisionId(state.revisions);

  const ticket = {
    id,
    scope,
    scene_id: scene_id ? String(scene_id).trim() : null,
    description: desc,
    status: "open",
    created_at: now,
    created_by: owner ? String(owner).trim() : null,
    resolved_at: null,
    resolution_note: null,
  };

  state.revisions.push(ticket);

  if (scope === "script" || scope === "visual") {
    state.scripting.status = "needs_revision";
    state.scripting.completed_at = null;
    if (owner) state.scripting.owner = String(owner).trim();
    if (state.production.video_done || artifacts.video_file) {
      state.production.stale = true;
      state.production.stale_reason = `Revision ${id} (${scope}) opened after video render`;
    }
  } else {
    state.production.status = "needs_revision";
    state.production.completed_at = null;
    if (owner) state.production.owner = String(owner).trim();
  }

  state.artifacts = artifacts;
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${epId}.json`), state);
  appendEvent(stateDir, {
    type: "revision_created",
    course: courseId,
    episode_id: epId,
    rev_id: id,
    scope,
    scene_id: ticket.scene_id,
    overall_status: state.overall_status,
    owner: ticket.created_by,
    note: desc,
  });

  return { ticket, state };
}

export function updateRevisionTicket(
  workspaceRoot,
  courseId,
  epId,
  { rev_id, status, resolution_note = undefined, owner = undefined }
) {
  if (!VALID_REVISION_STATUSES.has(status)) {
    throw new Error(`Invalid revision status "${status}". Expected "open", "in_progress", or "resolved".`);
  }
  const targetId = String(rev_id || "").trim().toUpperCase();
  if (!targetId) {
    throw new Error("rev_id is required.");
  }

  const { stateDir, artifacts, state } = loadOrInitEpisodeState(workspaceRoot, courseId, epId);
  const ticket = state.revisions.find((r) => String(r?.id || "").toUpperCase() === targetId);
  if (!ticket) {
    throw new Error(`Revision ticket "${rev_id}" not found in ${courseId}/${epId}`);
  }

  const now = new Date().toISOString();
  ticket.status = status;

  if (status === "resolved") {
    ticket.resolved_at = now;
    if (resolution_note !== undefined) {
      ticket.resolution_note = String(resolution_note);
    } else if (ticket.resolution_note === null || ticket.resolution_note === undefined) {
      ticket.resolution_note = "";
    }
  } else {
    ticket.resolved_at = null;
    if (resolution_note !== undefined) {
      ticket.resolution_note = String(resolution_note);
    }
  }

  const activeRevs = state.revisions.filter(
    (r) => r && (r.status === "open" || r.status === "in_progress")
  );

  if (ticket.scope === "script" || ticket.scope === "visual") {
    const remainingScripting = activeRevs.some(
      (r) => r.scope === "script" || r.scope === "visual"
    );
    if (!remainingScripting && status === "resolved" && state.scripting.status === "needs_revision") {
      if (artifacts.script) {
        state.scripting.status = "completed";
        state.scripting.completed_at = state.scripting.completed_at || now;
      } else {
        state.scripting.status = "pending";
      }
      if (resolution_note !== undefined) {
        state.scripting.notes = String(resolution_note);
      }
    }
  } else if (ticket.scope === "production") {
    const remainingProd = activeRevs.some((r) => r.scope === "production");
    if (!remainingProd && status === "resolved" && state.production.status === "needs_revision") {
      if (state.production.stale) {
        state.production.status = "pending";
      } else if (
        state.production.tts_done &&
        state.production.video_done &&
        state.production.verified
      ) {
        state.production.status = "completed";
        state.production.completed_at = state.production.completed_at || now;
      } else {
        state.production.status = "pending";
      }
      if (resolution_note !== undefined) {
        state.production.notes = String(resolution_note);
      }
    }
  }

  if (owner !== undefined) {
    const stageKey = ticket.scope === "production" ? "production" : "scripting";
    state[stageKey].owner = owner ? String(owner) : null;
  }

  state.artifacts = artifacts;
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${epId}.json`), state);
  appendEvent(stateDir, {
    type: status === "resolved" ? "revision_resolved" : "revision_updated",
    course: courseId,
    episode_id: epId,
    rev_id: ticket.id,
    scope: ticket.scope,
    status,
    overall_status: state.overall_status,
    owner: owner || null,
    note: resolution_note ?? ticket.resolution_note ?? "",
  });

  return { ticket, state };
}

export function deleteRevisionTicket(workspaceRoot, courseId, epId, revId) {
  const targetId = String(revId || "").trim().toUpperCase();
  if (!targetId) {
    throw new Error("rev_id is required.");
  }

  const { stateDir, artifacts, state } = loadOrInitEpisodeState(workspaceRoot, courseId, epId);
  const idx = state.revisions.findIndex((r) => String(r?.id || "").toUpperCase() === targetId);
  if (idx === -1) {
    throw new Error(`Revision ticket "${revId}" not found in ${courseId}/${epId}`);
  }

  const [removed] = state.revisions.splice(idx, 1);
  const now = new Date().toISOString();
  const activeRevs = state.revisions.filter(
    (r) => r && (r.status === "open" || r.status === "in_progress")
  );

  if (removed.scope === "script" || removed.scope === "visual") {
    const remainingScripting = activeRevs.some(
      (r) => r.scope === "script" || r.scope === "visual"
    );
    if (!remainingScripting && state.scripting.status === "needs_revision") {
      if (artifacts.script) {
        state.scripting.status = "completed";
        state.scripting.completed_at = state.scripting.completed_at || now;
      } else {
        state.scripting.status = "pending";
      }
    }
  } else if (removed.scope === "production") {
    const remainingProd = activeRevs.some((r) => r.scope === "production");
    if (!remainingProd && state.production.status === "needs_revision") {
      if (state.production.stale) {
        state.production.status = "pending";
      } else if (
        state.production.tts_done &&
        state.production.video_done &&
        state.production.verified
      ) {
        state.production.status = "completed";
      } else {
        state.production.status = "pending";
      }
    }
  }

  state.artifacts = artifacts;
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${epId}.json`), state);
  appendEvent(stateDir, {
    type: "revision_deleted",
    course: courseId,
    episode_id: epId,
    rev_id: removed.id,
    scope: removed.scope,
    overall_status: state.overall_status,
  });

  return { deleted_id: removed.id, state };
}

export function listRevisions(workspaceRoot, courseId, { epId = null, status = "all" } = {}) {
  if (status !== "all" && !VALID_REVISION_STATUSES.has(status)) {
    throw new Error(`Invalid --status "${status}". Expected open, in_progress, resolved, or all.`);
  }
  const states = loadMergedEpisodeStates(workspaceRoot, courseId);
  const filteredStates = epId ? states.filter((s) => s.episode_id === epId) : states;
  const items = [];
  for (const s of filteredStates) {
    for (const rev of s.revisions || []) {
      if (status === "all" || rev.status === status) {
        items.push({
          course: courseId,
          episode_id: s.episode_id,
          number: s.number,
          episode_title: s.title,
          overall_status: s.overall_status,
          ...rev,
        });
      }
    }
  }
  return items;
}

export function validateCourseDiagrams(workspaceRoot, courseId, epId = null) {
  const courseDir = path.join(workspaceRoot, courseId);
  const courseJson = loadCourseJson(courseDir);
  const epMetas = flattenCourseEpisodes(courseJson);
  const targets = epId ? epMetas.filter((e) => e.id === epId) : epMetas;
  if (epId && targets.length === 0) {
    throw new Error(`Episode "${epId}" not found in ${courseId}/course.json`);
  }

  const results = [];
  let allValid = true;

  for (const ep of targets) {
    const scriptPath = path.join(courseDir, "episodes", ep.id, "script.json");
    if (!fs.existsSync(scriptPath)) {
      if (epId) {
        throw new Error(`script.json not found at ${scriptPath}`);
      }
      continue;
    }
    const scriptJson = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    const validation = validateScriptDiagrams(scriptJson);
    if (!validation.valid) allValid = false;
    results.push({
      episode_id: ep.id,
      number: ep.number,
      title: ep.title,
      valid: validation.valid,
      scene_count: validation.scene_count ?? 0,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
    });
  }

  return { course: courseId, valid: allValid, results };
}

export function initCourse(workspaceRoot, courseId) {
  const courseDir = path.join(workspaceRoot, courseId);
  const stateDir = path.join(courseDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  const courseJson = loadCourseJson(courseDir);
  const episodes = flattenCourseEpisodes(courseJson);

  let created = 0;
  let existing = 0;
  const createdIds = [];

  for (const epMeta of episodes) {
    const statePath = path.join(stateDir, `${epMeta.id}.json`);
    if (fs.existsSync(statePath)) {
      existing += 1;
      continue;
    }
    const artifacts = inspectEpisodeArtifacts(courseDir, epMeta.id);
    const state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
    writeJsonAtomic(statePath, state);
    created += 1;
    createdIds.push(epMeta.id);
  }

  const eventsPath = path.join(stateDir, "events.jsonl");
  const isEventsEmpty =
    !fs.existsSync(eventsPath) || fs.readFileSync(eventsPath, "utf-8").trim().length === 0;

  if (isEventsEmpty) {
    const summary = getCourseSummary(workspaceRoot, courseId);
    appendEvent(stateDir, {
      type: "course_init",
      course: courseId,
      created,
      existing,
      total: episodes.length,
      stats: summary.stats,
      message: `Initialized state for ${episodes.length} episodes (${summary.stats.completed} completed, ${summary.stats.planned} planned)`,
    });
  }

  return { course: courseId, total: episodes.length, created, existing, createdIds };
}

export function loadMergedEpisodeStates(workspaceRoot, courseId) {
  const courseDir = path.join(workspaceRoot, courseId);
  const stateDir = path.join(courseDir, "state");
  const courseJson = loadCourseJson(courseDir);
  const epMetas = flattenCourseEpisodes(courseJson);

  return epMetas.map((epMeta) => {
    const artifacts = inspectEpisodeArtifacts(courseDir, epMeta.id);
    const saved = readEpisodeState(stateDir, epMeta.id);
    if (saved) {
      saved.artifacts = artifacts;
      return recomputeState(saved);
    }
    return createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  });
}

export function getNextEpisodes(workspaceRoot, courseId, stage, limit = 5) {
  if (stage !== "scripting" && stage !== "production") {
    throw new Error(`Invalid --stage "${stage}". Expected "scripting" or "production".`);
  }
  const states = loadMergedEpisodeStates(workspaceRoot, courseId);
  let filtered;
  if (stage === "scripting") {
    filtered = states.filter(
      (s) =>
        (s.overall_status === "planned" || s.overall_status === "needs_revision") &&
        s.scripting?.status !== "completed"
    );
  } else {
    filtered = states.filter(
      (s) =>
        s.overall_status === "script_ready" ||
        (s.production?.status === "needs_revision" && s.scripting?.status === "completed")
    );
  }
  return filtered.slice(0, Math.max(1, limit));
}

export function getCourseSummary(workspaceRoot, courseId) {
  const courseDir = path.join(workspaceRoot, courseId);
  const courseJson = loadCourseJson(courseDir);
  const states = loadMergedEpisodeStates(workspaceRoot, courseId);

  const emptyCounts = () => ({
    total: 0,
    planned: 0,
    scripting: 0,
    script_ready: 0,
    processing: 0,
    needs_revision: 0,
    completed: 0,
  });

  const stats = emptyCounts();
  const stageMap = new Map();

  for (const st of courseJson.stages || []) {
    stageMap.set(st.stage, {
      stage: st.stage,
      title: st.title,
      ...emptyCounts(),
    });
  }

  for (const s of states) {
    stats.total += 1;
    if (stats[s.overall_status] !== undefined) stats[s.overall_status] += 1;
    const stEntry = stageMap.get(s.stage);
    if (stEntry) {
      stEntry.total += 1;
      if (stEntry[s.overall_status] !== undefined) stEntry[s.overall_status] += 1;
    }
  }

  const nextScripting = getNextEpisodes(workspaceRoot, courseId, "scripting", 5).map(
    (s) => s.episode_id
  );
  const nextProduction = getNextEpisodes(workspaceRoot, courseId, "production", 5).map(
    (s) => s.episode_id
  );

  return {
    course: courseId,
    title: courseJson.title || courseId,
    stats,
    stages: Array.from(stageMap.values()),
    next: {
      scripting: nextScripting,
      production: nextProduction,
    },
  };
}

export function setEpisodeState(workspaceRoot, courseId, epId, opts) {
  const {
    stage,
    status,
    phase,
    owner,
    note,
    error,
    ttsDone,
    videoDone,
    verified,
    allowDiagramWarnings = false,
  } = opts;

  if (stage !== "scripting" && stage !== "production") {
    throw new Error(`Invalid --stage "${stage}". Expected "scripting" or "production".`);
  }
  if (stage === "scripting" && !VALID_SCRIPTING_STATUSES.has(status)) {
    throw new Error(`Invalid scripting status "${status}".`);
  }
  if (stage === "production" && !VALID_PRODUCTION_STATUSES.has(status)) {
    throw new Error(`Invalid production status "${status}".`);
  }

  const courseDir = path.join(workspaceRoot, courseId);
  const stateDir = path.join(courseDir, "state");
  const courseJson = loadCourseJson(courseDir);
  const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === epId);
  if (!epMeta) {
    throw new Error(`Episode "${epId}" not found in ${courseId}/course.json`);
  }

  // Automatic diagram validation gate when completing scripting
  if (stage === "scripting" && status === "completed") {
    const scriptPath = path.join(courseDir, "episodes", epId, "script.json");
    if (fs.existsSync(scriptPath)) {
      const scriptJson = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      const validation = validateScriptDiagrams(scriptJson);
      for (const w of validation.warnings || []) {
        console.error(`[DIAGRAM WARNING] ${w.scene_id || "-"} (${w.code}): ${w.message}`);
      }
      if (!validation.valid && !allowDiagramWarnings) {
        for (const e of validation.errors || []) {
          console.error(`[DIAGRAM ERROR] ${e.scene_id || "-"} (${e.code}): ${e.message}`);
        }
        throw new Error(
          `Diagram validation failed for ${epId} with ${validation.errors.length} error(s). Pass --allow-diagram-warnings to override.`
        );
      }
    }
  }

  const now = new Date().toISOString();
  const artifacts = inspectEpisodeArtifacts(courseDir, epId);
  let state = readEpisodeState(stateDir, epId);
  if (!state) {
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
  }

  state[stage].status = status;
  if (status !== "pending" && !state[stage].started_at) {
    state[stage].started_at = now;
  }
  if (status === "completed") {
    state[stage].completed_at = now;
  } else if (status === "pending" || status === "needs_revision") {
    state[stage].completed_at = null;
  }

  if (phase !== undefined) state[stage].phase = phase === "null" ? null : phase;
  if (owner !== undefined) state[stage].owner = owner === "null" ? null : owner;
  if (note !== undefined) state[stage].notes = note;
  if (error !== undefined) state.last_error = error === "null" || error === "" ? null : error;

  if (ttsDone !== undefined) state.production.tts_done = ttsDone;
  if (videoDone !== undefined) {
    state.production.video_done = videoDone;
  } else if (artifacts.video_file) {
    state.production.video_done = true;
  }
  if (verified !== undefined) state.production.verified = verified;

  // Clear stale flag when a fresh tts_done + video_done production completes cleanly
  if (
    stage === "production" &&
    status === "completed" &&
    state.production.tts_done &&
    state.production.video_done
  ) {
    state.production.stale = false;
    state.production.stale_reason = null;
  }

  state.artifacts = artifacts;
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${epId}.json`), state);
  appendEvent(stateDir, {
    type: "state_change",
    course: courseId,
    episode_id: epId,
    stage,
    status,
    overall_status: state.overall_status,
    phase: state[stage].phase,
    owner: state[stage].owner,
    note: note ?? "",
    error: state.last_error,
  });

  return state;
}

export function syncCourse(workspaceRoot, courseId) {
  const courseDir = path.join(workspaceRoot, courseId);
  const stateDir = path.join(courseDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  const courseJson = loadCourseJson(courseDir);
  const epMetas = flattenCourseEpisodes(courseJson);
  const now = new Date().toISOString();
  const updatedIds = [];

  for (const epMeta of epMetas) {
    const statePath = path.join(stateDir, `${epMeta.id}.json`);
    const artifacts = inspectEpisodeArtifacts(courseDir, epMeta.id);
    let state = readEpisodeState(stateDir, epMeta.id);

    if (!state) {
      state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true });
      writeJsonAtomic(statePath, state);
      updatedIds.push(epMeta.id);
      continue;
    }

    const before = JSON.stringify(state);
    state.artifacts = artifacts;

    if (state.scripting.status === "pending" && artifacts.script) {
      state.scripting.status = "completed";
      state.scripting.started_at = state.scripting.started_at || now;
      state.scripting.completed_at = state.scripting.completed_at || now;
    }

    if (artifacts.audio_count > 0 && artifacts.subtitles && !state.production.tts_done) {
      state.production.tts_done = true;
    }
    if (artifacts.video_file && !state.production.video_done) {
      state.production.video_done = true;
    }

    if (
      state.scripting.status === "completed" &&
      state.production.status === "pending" &&
      !state.production.stale &&
      state.production.tts_done &&
      state.production.video_done &&
      state.production.verified
    ) {
      state.production.status = "completed";
      state.production.completed_at = state.production.completed_at || now;
    }

    recomputeState(state);
    const afterCandidate = JSON.stringify(state);
    if (before !== afterCandidate) {
      state.updated_at = now;
      writeJsonAtomic(statePath, state);
      updatedIds.push(epMeta.id);
    }
  }

  if (updatedIds.length > 0) {
    appendEvent(stateDir, {
      type: "course_sync",
      course: courseId,
      updated_count: updatedIds.length,
      updated_episodes: updatedIds,
      message: `Synced disk artifacts for ${updatedIds.length} episode(s)`,
    });
  }

  return { course: courseId, total: epMetas.length, updated_count: updatedIds.length, updatedIds };
}

function parseBoolFlag(val, flagName) {
  if (val === "true" || val === true) return true;
  if (val === "false" || val === false) return false;
  throw new Error(`Flag ${flagName} expects true or false, got "${val}"`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const key = token.slice(2, eqIdx);
      flags[key] = token.slice(eqIdx + 1);
    } else {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function printSummaryText(summary) {
  const { stats, stages, next } = summary;
  console.log(`Course: ${summary.course} — ${summary.title}`);
  console.log(
    `Total: ${stats.total} | planned: ${stats.planned} | scripting: ${stats.scripting} | script_ready: ${stats.script_ready} | processing: ${stats.processing} | needs_revision: ${stats.needs_revision} | completed: ${stats.completed}`
  );
  console.log("");
  console.log("Stages:");
  for (const st of stages) {
    console.log(
      `  Stage ${st.stage} (${st.total} eps): planned=${st.planned}, scripting=${st.scripting}, script_ready=${st.script_ready}, processing=${st.processing}, needs_revision=${st.needs_revision}, completed=${st.completed} — ${st.title}`
    );
  }
  console.log("");
  console.log(`Next for scripting : ${next.scripting.length ? next.scripting.join(", ") : "(none)"}`);
  console.log(`Next for production: ${next.production.length ? next.production.join(", ") : "(none)"}`);
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const workspaceRoot = flags.workspace ? path.resolve(String(flags.workspace)) : DEFAULT_WORKSPACE_ROOT;
  const course = flags.course ? String(flags.course) : "";

  if (!command || command === "--help" || command === "-h") {
    console.log(
      [
        "Usage:",
        "  node state_cli.mjs init --course <COURSE>",
        "  node state_cli.mjs summary --course <COURSE> [--json]",
        "  node state_cli.mjs next --course <COURSE> --stage <scripting|production> [--limit N] [--json]",
        "  node state_cli.mjs set --course <COURSE> --ep <EP_ID> --stage <scripting|production> --status <STATUS> [--phase P] [--owner O] [--note N] [--error E] [--tts-done true|false] [--video-done true|false] [--verified true|false] [--allow-diagram-warnings]",
        "  node state_cli.mjs sync --course <COURSE>",
        "  node state_cli.mjs add-revision --course <COURSE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc \"<text>\" [--owner \"<name>\"] [--json]",
        "  node state_cli.mjs revisions --course <COURSE> [--ep <EP_ID>] [--status open|in_progress|resolved|all] [--json]",
        "  node state_cli.mjs resolve-revision --course <COURSE> --ep <EP_ID> --rev <REV-XXX> --note \"<text>\" [--owner \"<name>\"] [--json]",
        "  node state_cli.mjs validate-diagrams --course <COURSE> [--ep <EP_ID>] [--json]",
      ].join("\n")
    );
    process.exit(0);
  }

  if (!course) {
    console.error("Error: --course <COURSE> is required.");
    process.exit(1);
  }

  try {
    if (command === "init") {
      const res = initCourse(workspaceRoot, course);
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "summary") {
      const res = getCourseSummary(workspaceRoot, course);
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        printSummaryText(res);
      }
    } else if (command === "next") {
      const stage = String(flags.stage || "");
      const limit = flags.limit ? Number(flags.limit) : 5;
      const list = getNextEpisodes(workspaceRoot, course, stage, limit);
      if (flags.json) {
        console.log(JSON.stringify(list, null, 2));
      } else if (list.length === 0) {
        console.log(`No episodes ready for stage "${stage}".`);
      } else {
        for (const ep of list) {
          console.log(
            `${ep.episode_id} (#${ep.number}, Stage ${ep.stage}) [${ep.overall_status}] — ${ep.title}`
          );
        }
      }
    } else if (command === "set") {
      const ep = String(flags.ep || "");
      const stage = String(flags.stage || "");
      const status = String(flags.status || "");
      if (!ep || !stage || !status) {
        throw new Error("--ep, --stage, and --status are required for set");
      }
      const res = setEpisodeState(workspaceRoot, course, ep, {
        stage,
        status,
        phase: flags.phase !== undefined ? String(flags.phase) : undefined,
        owner: flags.owner !== undefined ? String(flags.owner) : undefined,
        note: flags.note !== undefined ? String(flags.note) : undefined,
        error: flags.error !== undefined ? String(flags.error) : undefined,
        ttsDone: flags["tts-done"] !== undefined ? parseBoolFlag(flags["tts-done"], "--tts-done") : undefined,
        videoDone: flags["video-done"] !== undefined ? parseBoolFlag(flags["video-done"], "--video-done") : undefined,
        verified: flags.verified !== undefined ? parseBoolFlag(flags["verified"], "--verified") : undefined,
        allowDiagramWarnings: flags["allow-diagram-warnings"]
          ? parseBoolFlag(flags["allow-diagram-warnings"], "--allow-diagram-warnings")
          : false,
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "sync") {
      const res = syncCourse(workspaceRoot, course);
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "add-revision") {
      const ep = String(flags.ep || "");
      const scope = String(flags.scope || "");
      const desc = flags.desc !== undefined ? String(flags.desc) : "";
      const scene = flags.scene !== undefined ? String(flags.scene) : null;
      const owner = flags.owner !== undefined ? String(flags.owner) : null;
      if (!ep || !scope || !desc) {
        throw new Error("--ep, --scope, and --desc are required for add-revision");
      }
      const res = addRevisionTicket(workspaceRoot, course, ep, {
        scope,
        scene_id: scene,
        description: desc,
        owner,
      });
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `Created ${res.ticket.id} on ${course}/${ep} [${res.ticket.scope}${res.ticket.scene_id ? ` @ ${res.ticket.scene_id}` : ""}] -> overall_status=${res.state.overall_status}`
        );
      }
    } else if (command === "revisions") {
      const ep = flags.ep ? String(flags.ep) : null;
      const status = flags.status ? String(flags.status) : "all";
      const list = listRevisions(workspaceRoot, course, { epId: ep, status });
      if (flags.json) {
        console.log(JSON.stringify(list, null, 2));
      } else if (list.length === 0) {
        console.log(`No revisions found (status=${status}).`);
      } else {
        for (const r of list) {
          console.log(
            `${r.episode_id} | ${r.id} [${r.status}] (${r.scope}${r.scene_id ? `:${r.scene_id}` : ""}) — ${r.description}`
          );
        }
      }
    } else if (command === "resolve-revision") {
      const ep = String(flags.ep || "");
      const rev = String(flags.rev || "");
      const note = flags.note !== undefined ? String(flags.note) : "";
      const owner = flags.owner !== undefined ? String(flags.owner) : undefined;
      if (!ep || !rev) {
        throw new Error("--ep and --rev are required for resolve-revision");
      }
      const res = updateRevisionTicket(workspaceRoot, course, ep, {
        rev_id: rev,
        status: "resolved",
        resolution_note: note,
        owner,
      });
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `Resolved ${res.ticket.id} on ${course}/${ep} -> overall_status=${res.state.overall_status}${res.state.production?.stale ? " (production.stale=true)" : ""}`
        );
      }
    } else if (command === "validate-diagrams") {
      const ep = flags.ep ? String(flags.ep) : null;
      const report = validateCourseDiagrams(workspaceRoot, course, ep);
      if (flags.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        for (const r of report.results) {
          const statusTag = r.valid ? "PASS" : "FAIL";
          console.log(
            `[${statusTag}] ${r.episode_id} (${r.errors.length} errors, ${r.warnings.length} warnings)`
          );
          for (const e of r.errors) {
            console.log(`  ERROR [${e.scene_id || "-"}] ${e.code}: ${e.message}`);
          }
          for (const w of r.warnings) {
            console.log(`  WARN  [${w.scene_id || "-"}] ${w.code}: ${w.message}`);
          }
        }
      }
      if (!report.valid) process.exit(1);
    } else {
      throw new Error(`Unknown command "${command}"`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main();
}
