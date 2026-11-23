import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateScriptDiagrams } from "./src/diagram_validator.mjs";
import { loadSvgCatalog, validateScriptWithSvgs } from "./src/svg_catalog.mjs";

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
export const VALID_PART_STATUSES = new Set([
  "pending",
  "in_progress",
  "reviewing",
  "needs_revision",
  "completed",
]);
export const VALID_AI_VERDICTS = new Set(["APPROVED", "REVISE"]);

export const OVERALL_STATUSES = [
  "planned",
  "scripting",
  "script_ready",
  "processing",
  "needs_revision",
  "completed",
];

export function writeTextAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export function writeJsonAtomic(filePath, data) {
  writeTextAtomic(filePath, JSON.stringify(data, null, 2) + "\n");
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

function countAudioFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return 0;
  let count = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += countAudioFilesRecursive(fullPath);
    } else if (entry.isFile() && /\.(mp3|wav)$/i.test(entry.name)) {
      count += 1;
    }
  }
  return count;
}

function scanVideoFiles(dirPath, defaultStem = "") {
  let video_file = null;
  const video_files = [];
  if (!fs.existsSync(dirPath)) return { video_file, video_files };
  let dirStat;
  try {
    dirStat = fs.statSync(dirPath);
  } catch {
    return { video_file, video_files };
  }
  if (!dirStat.isDirectory()) return { video_file, video_files };

  const stemLower = String(defaultStem || "").toLowerCase();
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const rawVideos = [];
  for (const entry of entries) {
    if (!/\.(mp4|webm)$/i.test(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
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
      Boolean(stemLower) &&
      (lowerName === `${stemLower}.mp4` || lowerName === `${stemLower}.webm`);
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
  return { video_file, video_files };
}

/**
 * Scan a Markdown review file for an explicit APPROVED or REVISE verdict marker.
 */
export function parseReviewVerdict(reviewMdPath) {
  if (!reviewMdPath || !fs.existsSync(reviewMdPath)) return null;
  let text = "";
  try {
    text = fs.readFileSync(reviewMdPath, "utf-8");
  } catch {
    return null;
  }
  if (!text.trim()) return null;

  const lines = text.split(/\r?\n/);
  const explicitKeyRe =
    /^(?:>\s*)?(?:#+\s*)?(?:[-*]\s*)?(?:\*{0,2}|__)?(?:verdict|status|kết\s*luận|trạng\s*thái)(?:\*{0,2}|__)?\s*[:\-–—]\s*(?:\*{0,2}|`|__|\s)*(APPROVED|REVISE)\b/i;
  let matchedExplicit = null;
  for (const line of lines) {
    const m = explicitKeyRe.exec(line.trim());
    if (m) matchedExplicit = m[1].toUpperCase();
  }
  if (matchedExplicit) return matchedExplicit;

  const standaloneLineRe =
    /^(?:>\s*)?(?:#+\s*)?(?:[-*]\s*)?(?:\*{0,2}|`|__)?(APPROVED|REVISE)(?:\*{0,2}|`|__)?[\s.!]*$/i;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = standaloneLineRe.exec(lines[i].trim());
    if (m) return m[1].toUpperCase();
  }

  const emphasizedRe = /(?:\*\*|__|`)\s*(APPROVED|REVISE)\s*(?:\*\*|__|`)/gi;
  let lastEmph = null;
  let match;
  while ((match = emphasizedRe.exec(text)) !== null) {
    lastEmph = match[1].toUpperCase();
  }
  return lastEmph;
}

function readJsonFileOrNull(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function inspectEpisodeArtifacts(courseDir, epId) {
  const epDir = path.join(courseDir, "episodes", epId);
  const brief = fs.existsSync(path.join(epDir, "brief.json"));
  const dialogue = fs.existsSync(path.join(epDir, "dialogue.json"));
  const audio_spine = fs.existsSync(path.join(epDir, "audio_spine.json"));
  const script = fs.existsSync(path.join(epDir, "script.json"));
  const notes = fs.existsSync(path.join(epDir, "notes.md"));
  const subtitles = fs.existsSync(path.join(epDir, "subtitles.srt"));
  const audio_count = countAudioFilesRecursive(path.join(epDir, "audio"));
  const { video_file, video_files } = scanVideoFiles(epDir, epId);

  const partsDir = path.join(epDir, "parts");
  const parts = [];
  if (fs.existsSync(partsDir) && fs.statSync(partsDir).isDirectory()) {
    const partEntries = fs
      .readdirSync(partsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^part_/i.test(d.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const entry of partEntries) {
      const partId = entry.name;
      const partDir = path.join(partsDir, partId);
      const reviewPath = path.join(partDir, "review.md");
      const has_review = fs.existsSync(reviewPath);
      const { video_file: partVideoFile } = scanVideoFiles(partDir, partId);
      parts.push({
        part_id: partId,
        has_dialogue: fs.existsSync(path.join(partDir, "dialogue.json")),
        has_review,
        review_verdict: has_review ? parseReviewVerdict(reviewPath) : null,
        has_audio_spine: fs.existsSync(path.join(partDir, "audio_spine.json")),
        has_script: fs.existsSync(path.join(partDir, "script.json")),
        has_notes: fs.existsSync(path.join(partDir, "notes.md")),
        audio_count: countAudioFilesRecursive(path.join(partDir, "audio")),
        subtitles: fs.existsSync(path.join(partDir, "subtitles.srt")),
        video_file: partVideoFile,
      });
    }
  }

  return {
    brief,
    dialogue,
    audio_spine,
    script,
    notes,
    audio_count,
    subtitles,
    video_file,
    video_files,
    parts,
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

export function createEpisodeStateFromMeta(
  epMeta,
  artifacts,
  { seedReady = true, courseDir = null } = {}
) {
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
    parts: [],
    merged_at: null,
    revisions: [],
    voice_override: null,
    last_error: null,
  };

  if (courseDir || (Array.isArray(artifacts?.parts) && artifacts.parts.length > 0)) {
    reconcileEpisodeParts(courseDir, epMeta.id, state, artifacts);
  }

  return recomputeState(state);
}

export function reconcileEpisodeParts(courseDir, epId, state, artifacts) {
  const briefPath = courseDir ? path.join(courseDir, "episodes", epId, "brief.json") : null;
  const briefJson = readJsonFileOrNull(briefPath);
  const briefParts = Array.isArray(briefJson?.parts) ? briefJson.parts : [];
  const artParts = Array.isArray(artifacts?.parts) ? artifacts.parts : [];
  const existingParts = Array.isArray(state?.parts) ? state.parts : [];

  if (briefParts.length === 0 && artParts.length === 0 && existingParts.length === 0) {
    return false;
  }

  const briefById = new Map();
  const orderedIds = [];
  const seenIds = new Set();
  const pushId = (id) => {
    const clean = String(id || "").trim();
    if (!clean || seenIds.has(clean)) return;
    seenIds.add(clean);
    orderedIds.push(clean);
  };

  for (const bp of briefParts) {
    const pid = String(bp?.part_id || bp?.id || "").trim();
    if (!pid) continue;
    briefById.set(pid, bp);
    pushId(pid);
  }

  const artById = new Map();
  for (const ap of artParts) {
    if (!ap?.part_id) continue;
    artById.set(ap.part_id, ap);
    pushId(ap.part_id);
  }

  const existingById = new Map();
  for (const ep of existingParts) {
    if (!ep?.part_id) continue;
    existingById.set(ep.part_id, ep);
    pushId(ep.part_id);
  }

  const nextParts = orderedIds.map((partId) => {
    const briefItem = briefById.get(partId) || {};
    const art = artById.get(partId) || null;
    const existing = existingById.get(partId) || {};

    const rawDur = briefItem.target_duration_sec ?? briefItem.estimated_duration_sec ?? existing.target_duration_sec;
    const parsedDur = rawDur !== undefined && rawDur !== null && rawDur !== "" ? Number(rawDur) : NaN;
    const target_duration_sec = Number.isFinite(parsedDur) ? parsedDur : null;

    let status = existing.status && VALID_PART_STATUSES.has(existing.status) ? existing.status : "pending";
    if (status === "pending" && art) {
      if (art.has_script) {
        status = "completed";
      } else if (art.review_verdict === "REVISE") {
        status = "needs_revision";
      } else if (art.has_review && art.review_verdict === "APPROVED") {
        status = "reviewing";
      } else if (art.has_dialogue) {
        status = "in_progress";
      }
    }

    const diskTtsDone = Boolean(art && art.audio_count > 0 && art.subtitles);
    const tts_done =
      typeof existing.tts_done === "boolean" ? (existing.tts_done || diskTtsDone) : diskTtsDone;

    return {
      part_id: partId,
      title: String(briefItem.title || existing.title || partId),
      target_duration_sec,
      status,
      ai_review_verdict: existing.ai_review_verdict || art?.review_verdict || null,
      approved: typeof existing.approved === "boolean" ? existing.approved : false,
      approved_at: existing.approved_at ?? null,
      tts_done,
      video_file: art?.video_file || existing.video_file || null,
      notes: existing.notes !== undefined && existing.notes !== null ? String(existing.notes) : "",
    };
  });

  state.parts = nextParts;
  if (state.merged_at === undefined) {
    state.merged_at = null;
  }
  return true;
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
    state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true, courseDir });
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
    const validation = validateScriptWithSvgs(scriptJson);
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
  const now = new Date().toISOString();

  let created = 0;
  let existing = 0;
  const createdIds = [];

  for (const epMeta of episodes) {
    const statePath = path.join(stateDir, `${epMeta.id}.json`);
    const artifacts = inspectEpisodeArtifacts(courseDir, epMeta.id);
    if (fs.existsSync(statePath)) {
      existing += 1;
      const saved = readEpisodeState(stateDir, epMeta.id);
      if (saved) {
        const before = JSON.stringify(saved);
        if (reconcileEpisodeParts(courseDir, epMeta.id, saved, artifacts)) {
          saved.artifacts = artifacts;
          recomputeState(saved);
          if (JSON.stringify(saved) !== before) {
            saved.updated_at = now;
            writeJsonAtomic(statePath, saved);
          }
        }
      }
      continue;
    }
    const state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true, courseDir });
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
      reconcileEpisodeParts(courseDir, epMeta.id, saved, artifacts);
      return recomputeState(saved);
    }
    return createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true, courseDir });
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
      const validation = validateScriptWithSvgs(scriptJson);
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
      state = createEpisodeStateFromMeta(epMeta, artifacts, { seedReady: true, courseDir });
      writeJsonAtomic(statePath, state);
      updatedIds.push(epMeta.id);
      continue;
    }

    const before = JSON.stringify(state);
    state.artifacts = artifacts;
    reconcileEpisodeParts(courseDir, epMeta.id, state, artifacts);

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

function remapPartAssetPath(relPath, partId) {
  if (!relPath) return relPath;
  const clean = String(relPath).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean) return relPath;
  if (clean.startsWith(`parts/${partId}/`) || clean.startsWith("parts/")) {
    return clean;
  }
  return `parts/${partId}/${clean}`;
}

function parseSrtTimestampMs(hh, mm, ss, mmm) {
  return ((Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 1000) + Number(mmm);
}

function formatSrtTimestamp(totalMs) {
  const ms = Math.max(0, Math.round(totalMs));
  const hrs = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const rem = ms % 1000;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
}

function parseSrtCues(srtText) {
  const normalized = String(srtText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n\s*\n+/);
  const cues = [];
  const timeRe = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})(.*)$/;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.replace(/\r$/, ""));
    let timeLineIdx = -1;
    let match = null;
    for (let i = 0; i < lines.length; i += 1) {
      const m = timeRe.exec(lines[i].trim());
      if (m) {
        timeLineIdx = i;
        match = m;
        break;
      }
    }
    if (timeLineIdx === -1 || !match) continue;
    const startMs = parseSrtTimestampMs(match[1], match[2], match[3], match[4]);
    const endMs = parseSrtTimestampMs(match[5], match[6], match[7], match[8]);
    const tail = match[9] || "";
    const text = lines.slice(timeLineIdx + 1).join("\n").trim();
    if (!text) continue;
    cues.push({ startMs, endMs, tail, text });
  }
  return cues;
}

function serializeSrtCues(cues) {
  if (!Array.isArray(cues) || cues.length === 0) return "";
  return (
    cues
      .map(
        (c, idx) =>
          `${idx + 1}\n${formatSrtTimestamp(c.startMs)} --> ${formatSrtTimestamp(c.endMs)}${c.tail || ""}\n${c.text}\n`
      )
      .join("\n") + "\n"
  );
}

function computeScriptDurationMs(scriptObj) {
  const totalSec = Number(scriptObj?.total_duration_sec);
  if (Number.isFinite(totalSec) && totalSec > 0) {
    return Math.round(totalSec * 1000);
  }
  const scenes = Array.isArray(scriptObj?.scenes) ? scriptObj.scenes : [];
  const sumSec = scenes.reduce((acc, s) => acc + Math.max(0, Number(s?.duration_sec) || 0), 0);
  return Math.round(sumSec * 1000);
}

function slugifyMarkdownAnchor(heading) {
  return String(heading || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function getEpisodeParts(workspaceRoot, courseId, epId) {
  const { courseDir, epMeta, artifacts, state } = loadOrInitEpisodeState(
    workspaceRoot,
    courseId,
    epId
  );
  reconcileEpisodeParts(courseDir, epId, state, artifacts);
  const artById = new Map((artifacts.parts || []).map((p) => [p.part_id, p]));
  const parts = (state.parts || []).map((p) => ({
    ...p,
    artifacts: artById.get(p.part_id) || {
      part_id: p.part_id,
      has_dialogue: false,
      has_review: false,
      review_verdict: null,
      has_audio_spine: false,
      has_script: false,
      has_notes: false,
      audio_count: 0,
      subtitles: false,
      video_file: null,
    },
  }));
  return {
    ok: true,
    course: courseId,
    episode_id: epMeta.id,
    title: epMeta.title,
    merged_at: state.merged_at ?? null,
    parts,
  };
}

export function setPartState({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  course,
  courseId,
  epId,
  ep,
  partId,
  part,
  status,
  approved,
  aiVerdict,
  note,
  ttsDone,
  videoFile,
}) {
  const resolvedCourse = String(course || courseId || "").trim();
  const resolvedEpId = String(epId || ep || "").trim();
  const resolvedPartId = String(partId || part || "").trim();
  if (!resolvedCourse || !resolvedEpId || !resolvedPartId) {
    throw new Error("course, epId, and partId are required for setPartState.");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(resolvedPartId)) {
    throw new Error(`Invalid partId "${resolvedPartId}".`);
  }

  if (status !== undefined) {
    if (!VALID_PART_STATUSES.has(status)) {
      throw new Error(
        `Invalid part status "${status}". Expected one of: ${Array.from(VALID_PART_STATUSES).join(", ")}.`
      );
    }
  }

  let normalizedVerdict = undefined;
  if (aiVerdict !== undefined) {
    if (aiVerdict === null || aiVerdict === "null" || aiVerdict === "") {
      normalizedVerdict = null;
    } else {
      const upper = String(aiVerdict).trim().toUpperCase();
      if (!VALID_AI_VERDICTS.has(upper)) {
        throw new Error(`Invalid AI review verdict "${aiVerdict}". Expected APPROVED or REVISE.`);
      }
      normalizedVerdict = upper;
    }
  }

  const { courseDir, stateDir, artifacts, state } = loadOrInitEpisodeState(
    workspaceRoot,
    resolvedCourse,
    resolvedEpId
  );
  reconcileEpisodeParts(courseDir, resolvedEpId, state, artifacts);
  if (!Array.isArray(state.parts)) state.parts = [];

  const now = new Date().toISOString();
  let partEntry = state.parts.find((p) => p.part_id === resolvedPartId);
  if (!partEntry) {
    const art = (artifacts.parts || []).find((a) => a.part_id === resolvedPartId) || null;
    partEntry = {
      part_id: resolvedPartId,
      title: resolvedPartId,
      target_duration_sec: null,
      status: "pending",
      ai_review_verdict: art?.review_verdict || null,
      approved: false,
      approved_at: null,
      tts_done: Boolean(art && art.audio_count > 0 && art.subtitles),
      video_file: art?.video_file || null,
      notes: "",
    };
    state.parts.push(partEntry);
  }

  if (status !== undefined) partEntry.status = status;
  if (normalizedVerdict !== undefined) partEntry.ai_review_verdict = normalizedVerdict;
  if (approved !== undefined) {
    const boolApproved = Boolean(approved);
    partEntry.approved = boolApproved;
    partEntry.approved_at = boolApproved ? now : null;
  }
  if (ttsDone !== undefined) partEntry.tts_done = Boolean(ttsDone);
  if (videoFile !== undefined) {
    partEntry.video_file =
      videoFile === null || videoFile === "null" || videoFile === "" ? null : String(videoFile);
  }
  if (note !== undefined) partEntry.notes = String(note);

  state.artifacts = artifacts;
  if (state.merged_at === undefined) state.merged_at = null;
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${resolvedEpId}.json`), state);
  appendEvent(stateDir, {
    type: "part_state_change",
    course: resolvedCourse,
    episode_id: resolvedEpId,
    part_id: resolvedPartId,
    status: partEntry.status,
    approved: partEntry.approved,
    ai_review_verdict: partEntry.ai_review_verdict,
    tts_done: partEntry.tts_done,
    note: note ?? "",
  });

  return { ok: true, part: partEntry, state };
}

export function mergeEpisodeParts({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  course,
  courseId,
  epId,
  ep,
  force = false,
  insertChapterDividers = false,
}) {
  const resolvedCourse = String(course || courseId || "").trim();
  const resolvedEpId = String(epId || ep || "").trim();
  if (!resolvedCourse || !resolvedEpId) {
    throw new Error("course and epId are required for mergeEpisodeParts.");
  }

  const { courseDir, stateDir, epMeta, artifacts, state } = loadOrInitEpisodeState(
    workspaceRoot,
    resolvedCourse,
    resolvedEpId
  );
  reconcileEpisodeParts(courseDir, resolvedEpId, state, artifacts);

  const epDir = path.join(courseDir, "episodes", resolvedEpId);
  const partsRoot = path.join(epDir, "parts");
  const briefJson = readJsonFileOrNull(path.join(epDir, "brief.json"));
  const briefParts = Array.isArray(briefJson?.parts) ? briefJson.parts : [];
  const briefById = new Map();
  for (const bp of briefParts) {
    const pid = String(bp?.part_id || bp?.id || "").trim();
    if (pid) briefById.set(pid, bp);
  }

  // 1) Discover parts ordered by brief.json parts[] if available, else sorted parts/part_* dirs
  const diskPartIds =
    fs.existsSync(partsRoot) && fs.statSync(partsRoot).isDirectory()
      ? fs
          .readdirSync(partsRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^part_/i.test(d.name))
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      : [];

  const orderedPartIds = [];
  const seenPartIds = new Set();
  const pushOrdered = (pid) => {
    if (!pid || seenPartIds.has(pid)) return;
    seenPartIds.add(pid);
    orderedPartIds.push(pid);
  };
  for (const bp of briefParts) {
    const pid = String(bp?.part_id || bp?.id || "").trim();
    if (pid && (diskPartIds.includes(pid) || fs.existsSync(path.join(partsRoot, pid, "script.json")))) {
      pushOrdered(pid);
    }
  }
  for (const pid of diskPartIds) {
    pushOrdered(pid);
  }

  const partsWithScript = [];
  const missingScripts = [];
  for (const partId of orderedPartIds) {
    const partDir = path.join(partsRoot, partId);
    const scriptPath = path.join(partDir, "script.json");
    if (fs.existsSync(scriptPath)) {
      partsWithScript.push({ partId, partDir, scriptPath });
    } else {
      missingScripts.push(partId);
    }
  }

  if (partsWithScript.length === 0) {
    throw new Error(
      `No part script.json files found under ${path.join(epDir, "parts", "part_*")} for ${resolvedCourse}/${resolvedEpId}.`
    );
  }
  if (!force && missingScripts.length > 0) {
    throw new Error(
      `Cannot merge ${resolvedCourse}/${resolvedEpId}: part(s) missing script.json: ${missingScripts.join(", ")}. Pass --force to merge completed parts only.`
    );
  }

  // 2) Require every part's state approved === true unless --force
  const statePartById = new Map((state.parts || []).map((p) => [p.part_id, p]));
  if (!force) {
    const checkIds = new Set([
      ...orderedPartIds,
      ...(state.parts || []).map((p) => p.part_id),
    ]);
    const unapproved = [];
    for (const pid of checkIds) {
      const sp = statePartById.get(pid);
      if (!sp || sp.approved !== true) {
        unapproved.push(pid);
      }
    }
    if (unapproved.length > 0) {
      throw new Error(
        `Cannot merge ${resolvedCourse}/${resolvedEpId}: unapproved part(s): ${unapproved.join(", ")}. Approve with set-part --approved true or pass --force.`
      );
    }
  }

  // 3) Validate each part's script.json with validateScriptWithSvgs before merging
  const loadedParts = [];
  for (const item of partsWithScript) {
    const partScript = JSON.parse(fs.readFileSync(item.scriptPath, "utf-8"));
    const validation = validateScriptWithSvgs(partScript);
    if (!validation.valid) {
      const details = (validation.errors || [])
        .map((e) => (typeof e === "string" ? e : `${e.scene_id || "-"} (${e.code}): ${e.message}`))
        .join("; ");
      throw new Error(
        `Diagram/schema validation failed for ${resolvedCourse}/${resolvedEpId}/${item.partId}: ${details}`
      );
    }
    const statePart = statePartById.get(item.partId);
    const briefPart = briefById.get(item.partId);
    const partTitle = String(
      briefPart?.title || statePart?.title || partScript?.title || item.partId
    ).trim();
    loadedParts.push({
      ...item,
      partScript,
      partTitle,
      sceneIdMap: new Map(),
    });
  }

  // 4) Deterministically merge into <ep>/script.json
  const now = new Date().toISOString();
  const firstScript = loadedParts[0].partScript;
  const mergedScenes = [];
  let totalDurationSec = 0;

  for (let pIdx = 0; pIdx < loadedParts.length; pIdx += 1) {
    const part = loadedParts[pIdx];
    const rawScenes = Array.isArray(part.partScript.scenes) ? part.partScript.scenes : [];
    for (let sIdx = 0; sIdx < rawScenes.length; sIdx += 1) {
      const cloned = structuredClone(rawScenes[sIdx]);
      const origId = String(cloned.id || `scene_${sIdx + 1}`).trim();
      const prefixedId = origId.startsWith(`${part.partId}_`) ? origId : `${part.partId}_${origId}`;
      part.sceneIdMap.set(origId, prefixedId);
      cloned.id = prefixedId;
      cloned.source_part = part.partId;
      cloned.source_part_title = part.partTitle;
      if (insertChapterDividers && sIdx === 0) {
        cloned.chapter_divider = {
          part_id: part.partId,
          part_number: pIdx + 1,
          title: part.partTitle,
        };
      }
      if (cloned.audio_file) {
        cloned.audio_file = remapPartAssetPath(cloned.audio_file, part.partId);
      }
      totalDurationSec += Math.max(0, Number(cloned.duration_sec) || 0);
      mergedScenes.push(cloned);
    }
  }

  // Merge voice_tracks across matching profile IDs present across all merged parts
  const mergedVoiceTracks = {};
  const profileLists = loadedParts.map((p) =>
    p.partScript.voice_tracks && typeof p.partScript.voice_tracks === "object"
      ? Object.keys(p.partScript.voice_tracks)
      : []
  );
  const commonProfileIds =
    profileLists.length > 0
      ? profileLists[0].filter((pid) => profileLists.every((list) => list.includes(pid)))
      : [];

  for (const profileId of commonProfileIds) {
    const firstTrack = loadedParts[0].partScript.voice_tracks[profileId] || {};
    const mergedSceneData = {};
    let trackDurSec = 0;
    for (const part of loadedParts) {
      const pTrack = part.partScript.voice_tracks?.[profileId];
      const pSceneData = pTrack?.scene_data && typeof pTrack.scene_data === "object" ? pTrack.scene_data : {};
      for (const [origSid, sdata] of Object.entries(pSceneData)) {
        const newSid =
          part.sceneIdMap.get(origSid) ||
          (origSid.startsWith(`${part.partId}_`) ? origSid : `${part.partId}_${origSid}`);
        const clonedData = structuredClone(sdata);
        if (clonedData.audio_file) {
          clonedData.audio_file = remapPartAssetPath(clonedData.audio_file, part.partId);
        }
        trackDurSec += Math.max(0, Number(clonedData.duration_sec) || 0);
        mergedSceneData[newSid] = clonedData;
      }
    }
    mergedVoiceTracks[profileId] = {
      tts_profile: firstTrack.tts_profile || profileId,
      tts_provider: firstTrack.tts_provider || "edge",
      tts_voice: firstTrack.tts_voice || "",
      tts_rate: firstTrack.tts_rate || "+0%",
      ...(firstTrack.tts_pitch ? { tts_pitch: firstTrack.tts_pitch } : {}),
      subtitles_srt: `subtitles.${profileId}.srt`,
      total_duration_sec: Number(trackDurSec.toFixed(3)),
      generated_at: now,
      scene_data: mergedSceneData,
    };
  }

  const epTitle = String(briefJson?.title || epMeta.title || firstScript.title || resolvedEpId);
  const mergedScript = {
    course_id: firstScript.course_id || resolvedCourse,
    episode_id: resolvedEpId,
    episode_number: epMeta.number || firstScript.episode_number || 0,
    title: epTitle,
    ...(briefJson?.subtitle || firstScript.subtitle
      ? { subtitle: briefJson?.subtitle || firstScript.subtitle }
      : {}),
    aspect_ratio: firstScript.aspect_ratio || "16:9",
    language: firstScript.language || "vi",
    ...(firstScript.tts_profile ? { tts_profile: firstScript.tts_profile } : {}),
    ...(firstScript.tts_voice ? { tts_voice: firstScript.tts_voice } : {}),
    ...(firstScript.tts_rate ? { tts_rate: firstScript.tts_rate } : {}),
    ...(firstScript.tts_provider_used ? { tts_provider_used: firstScript.tts_provider_used } : {}),
    total_duration_sec: Number(totalDurationSec.toFixed(3)),
    merged_from_parts: loadedParts.map((p) => p.partId),
    merged_at: now,
    scenes: mergedScenes,
  };

  if (Object.keys(mergedVoiceTracks).length > 0) {
    mergedScript.voice_tracks = mergedVoiceTracks;
    const preferredActive =
      firstScript.active_voice_track && mergedVoiceTracks[firstScript.active_voice_track]
        ? firstScript.active_voice_track
        : Object.keys(mergedVoiceTracks)[0];
    mergedScript.active_voice_track = preferredActive;
    const activeTrackObj = mergedVoiceTracks[preferredActive];
    if (activeTrackObj?.tts_profile) mergedScript.tts_profile = activeTrackObj.tts_profile;
    if (activeTrackObj?.tts_voice) mergedScript.tts_voice = activeTrackObj.tts_voice;
    if (activeTrackObj?.tts_rate) mergedScript.tts_rate = activeTrackObj.tts_rate;
  }

  const scriptOutPath = path.join(epDir, "script.json");
  writeJsonAtomic(scriptOutPath, mergedScript);

  // 5) Deterministically merge subtitles into <ep>/subtitles.srt and subtitles.<profile>.srt
  const mergeSrtFiles = (fileNameForPart, durationMsForPart) => {
    const allCues = [];
    let offsetMs = 0;
    let foundAny = false;
    for (const part of loadedParts) {
      const srtFile = path.join(part.partDir, fileNameForPart);
      if (fs.existsSync(srtFile)) {
        foundAny = true;
        const rawSrt = fs.readFileSync(srtFile, "utf-8");
        const cues = parseSrtCues(rawSrt);
        for (const c of cues) {
          allCues.push({
            startMs: c.startMs + offsetMs,
            endMs: c.endMs + offsetMs,
            tail: c.tail,
            text: c.text,
          });
        }
      }
      offsetMs += durationMsForPart(part);
    }
    return { foundAny, serialized: serializeSrtCues(allCues) };
  };

  const rootSrtResult = mergeSrtFiles("subtitles.srt", (part) => computeScriptDurationMs(part.partScript));
  const subtitlesOutPath = path.join(epDir, "subtitles.srt");
  if (rootSrtResult.foundAny && rootSrtResult.serialized) {
    writeTextAtomic(subtitlesOutPath, rootSrtResult.serialized);
  }

  // Per-profile SRTs across parts
  const profileSrtSet = new Set(Object.keys(mergedVoiceTracks));
  for (const part of loadedParts) {
    if (!fs.existsSync(part.partDir)) continue;
    for (const entry of fs.readdirSync(part.partDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const m = /^subtitles\.(.+)\.srt$/i.exec(entry.name);
      if (m && m[1]) profileSrtSet.add(m[1]);
    }
  }
  const mergedProfileSrts = [];
  for (const profileId of profileSrtSet) {
    const allPartsHaveProfileSrt = loadedParts.every((p) =>
      fs.existsSync(path.join(p.partDir, `subtitles.${profileId}.srt`))
    );
    if (!allPartsHaveProfileSrt && !mergedVoiceTracks[profileId]) continue;
    const profRes = mergeSrtFiles(`subtitles.${profileId}.srt`, (part) => {
      const pTrack = part.partScript.voice_tracks?.[profileId];
      if (pTrack) {
        const td = Number(pTrack.total_duration_sec);
        if (Number.isFinite(td) && td > 0) return Math.round(td * 1000);
        const sDataDur = Object.values(pTrack.scene_data || {}).reduce(
          (acc, s) => acc + Math.max(0, Number(s?.duration_sec) || 0),
          0
        );
        if (sDataDur > 0) return Math.round(sDataDur * 1000);
      }
      return computeScriptDurationMs(part.partScript);
    });
    if (profRes.foundAny && profRes.serialized) {
      writeTextAtomic(path.join(epDir, `subtitles.${profileId}.srt`), profRes.serialized);
      mergedProfileSrts.push(`subtitles.${profileId}.srt`);
    }
  }

  // 6) Deterministically merge notes.md into <ep>/notes.md
  const tocLines = [];
  const sectionBlocks = [];
  for (let i = 0; i < loadedParts.length; i += 1) {
    const part = loadedParts[i];
    const partNum = i + 1;
    const headingText = `Phần ${partNum}: ${part.partTitle}`;
    const anchor = slugifyMarkdownAnchor(headingText);
    tocLines.push(`- [${headingText}](#${anchor}) (\`${part.partId}\`)`);

    const partNotesPath = path.join(part.partDir, "notes.md");
    const partNotesBody = fs.existsSync(partNotesPath)
      ? fs.readFileSync(partNotesPath, "utf-8").trim()
      : "";
    sectionBlocks.push(
      `---\n\n# ${headingText}\n\n${partNotesBody || "_(Chưa có ghi chú cho phần này.)_"}`
    );
  }
  const mergedNotesContent = `# ${epTitle}\n\n## Mục lục\n\n${tocLines.join("\n")}\n\n${sectionBlocks.join("\n\n")}\n`;
  const notesOutPath = path.join(epDir, "notes.md");
  writeTextAtomic(notesOutPath, mergedNotesContent);

  // 7) Update state/<epId>.json atomically & append "parts_merged" event
  const allScenesHaveAudio =
    mergedScenes.length > 0 &&
    mergedScenes.every((s) => Boolean(s.audio_file) && fs.existsSync(path.join(epDir, s.audio_file)));

  const updatedArtifacts = inspectEpisodeArtifacts(courseDir, resolvedEpId);
  state.merged_at = now;
  state.scripting = state.scripting || {};
  state.scripting.status = "completed";
  state.scripting.started_at = state.scripting.started_at || now;
  state.scripting.completed_at = now;
  state.scripting.phase = "merged";
  state.scripting.notes = `Merged ${loadedParts.length} part(s) (${mergedScenes.length} scenes)`;

  state.production = state.production || {};
  if (allScenesHaveAudio) {
    state.production.tts_done = true;
  }
  if (state.production.video_done) {
    state.production.stale = true;
    state.production.stale_reason = "Merged updated parts after prior video render";
  }

  state.artifacts = updatedArtifacts;
  reconcileEpisodeParts(courseDir, resolvedEpId, state, updatedArtifacts);
  state.updated_at = now;
  recomputeState(state);

  writeJsonAtomic(path.join(stateDir, `${resolvedEpId}.json`), state);
  appendEvent(stateDir, {
    type: "parts_merged",
    course: resolvedCourse,
    episode_id: resolvedEpId,
    parts: loadedParts.map((p) => p.partId),
    scene_count: mergedScenes.length,
    total_duration_sec: mergedScript.total_duration_sec,
    tts_done: state.production.tts_done,
    merged_at: now,
    overall_status: state.overall_status,
    message: `Merged ${loadedParts.length} part(s) into ${resolvedEpId}/script.json (${mergedScenes.length} scenes)`,
  });

  return {
    ok: true,
    course: resolvedCourse,
    episode_id: resolvedEpId,
    merged_at: now,
    parts_merged: loadedParts.map((p) => p.partId),
    scene_count: mergedScenes.length,
    total_duration_sec: mergedScript.total_duration_sec,
    tts_done: state.production.tts_done,
    script_path: scriptOutPath,
    subtitles_path: rootSrtResult.foundAny && rootSrtResult.serialized ? subtitlesOutPath : null,
    profile_subtitles: mergedProfileSrts,
    notes_path: notesOutPath,
    state,
  };
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

function printPartsTable(overview) {
  console.log(
    `Episode: ${overview.course}/${overview.episode_id} — ${overview.title}${overview.merged_at ? ` (merged_at: ${overview.merged_at})` : ""}`
  );
  if (!overview.parts.length) {
    console.log("(No multi-part breakdown found)");
    return;
  }
  const rows = overview.parts.map((p) => {
    const a = p.artifacts || {};
    return {
      part: p.part_id,
      status: p.status || "pending",
      verdict: p.ai_review_verdict || a.review_verdict || "-",
      approved: p.approved ? "YES" : "NO",
      script: a.has_script ? "yes" : "no",
      audio: String(a.audio_count ?? 0),
      srt: a.subtitles ? "yes" : "no",
      video: p.video_file || a.video_file || "-",
      title: p.title || p.part_id,
    };
  });
  const cols = [
    ["part", "PART"],
    ["status", "STATUS"],
    ["verdict", "AI_REVIEW"],
    ["approved", "APPROVED"],
    ["script", "SCRIPT"],
    ["audio", "AUDIO"],
    ["srt", "SRT"],
    ["video", "VIDEO"],
    ["title", "TITLE"],
  ];
  const widths = cols.map(([k, hdr]) =>
    Math.max(hdr.length, ...rows.map((r) => String(r[k] ?? "").length))
  );
  const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  console.log(fmt(cols.map(([, hdr]) => hdr)));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(fmt(cols.map(([k]) => r[k])));
  }
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
        "  node state_cli.mjs parts --course <COURSE> --ep <EP_ID> [--json]",
        "  node state_cli.mjs set-part --course <COURSE> --ep <EP_ID> --part <PART_ID> [--status <pending|in_progress|reviewing|needs_revision|completed>] [--approved true|false] [--ai-verdict APPROVED|REVISE] [--tts-done true|false] [--video-file <name>] [--note \"...\"]",
        "  node state_cli.mjs merge-parts --course <COURSE> --ep <EP_ID> [--force] [--insert-chapter-dividers] [--json]",
        "  node state_cli.mjs sync --course <COURSE>",
        "  node state_cli.mjs add-revision --course <COURSE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc \"<text>\" [--owner \"<name>\"] [--json]",
        "  node state_cli.mjs revisions --course <COURSE> [--ep <EP_ID>] [--status open|in_progress|resolved|all] [--json]",
        "  node state_cli.mjs resolve-revision --course <COURSE> --ep <EP_ID> --rev <REV-XXX> --note \"<text>\" [--owner \"<name>\"] [--json]",
        "  node state_cli.mjs validate-diagrams --course <COURSE> [--ep <EP_ID>] [--json]",
        "  node state_cli.mjs svg-list [--json]",
      ].join("\n")
    );
    process.exit(0);
  }

  if (command === "svg-list") {
    const svgs = loadSvgCatalog();
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, count: svgs.length, svgs }, null, 2));
    } else {
      console.log(`Available SVG illustrations (${svgs.length}):`);
      for (const s of svgs) {
        console.log(`  - ${s.id} [${s.category}]${s.exists ? "" : " (MISSING FILE)"} — ${s.label} (${s.keywords.join(", ")})`);
      }
    }
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
    } else if (command === "parts") {
      const ep = String(flags.ep || "");
      if (!ep) {
        throw new Error("--ep is required for parts");
      }
      const res = getEpisodeParts(workspaceRoot, course, ep);
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        printPartsTable(res);
      }
    } else if (command === "set-part") {
      const ep = String(flags.ep || "");
      const part = String(flags.part || "");
      if (!ep || !part) {
        throw new Error("--ep and --part are required for set-part");
      }
      const res = setPartState({
        workspaceRoot,
        course,
        epId: ep,
        partId: part,
        status: flags.status !== undefined ? String(flags.status) : undefined,
        approved: flags.approved !== undefined ? parseBoolFlag(flags.approved, "--approved") : undefined,
        aiVerdict: flags["ai-verdict"] !== undefined ? String(flags["ai-verdict"]) : undefined,
        ttsDone: flags["tts-done"] !== undefined ? parseBoolFlag(flags["tts-done"], "--tts-done") : undefined,
        videoFile: flags["video-file"] !== undefined ? String(flags["video-file"]) : undefined,
        note: flags.note !== undefined ? String(flags.note) : undefined,
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "merge-parts") {
      const ep = String(flags.ep || "");
      if (!ep) {
        throw new Error("--ep is required for merge-parts");
      }
      const res = mergeEpisodeParts({
        workspaceRoot,
        course,
        epId: ep,
        force: flags.force ? parseBoolFlag(flags.force, "--force") : false,
        insertChapterDividers: flags["insert-chapter-dividers"]
          ? parseBoolFlag(flags["insert-chapter-dividers"], "--insert-chapter-dividers")
          : false,
      });
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(
          `Merged ${res.parts_merged.length} part(s) (${res.parts_merged.join(", ")}) for ${course}/${ep}: ${res.scene_count} scenes, ${res.total_duration_sec}s, tts_done=${res.tts_done}`
        );
      }
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
