import fs from "node:fs";
import path from "node:path";
import {
  getBrandSpec,
  getProvidersOverview,
  isBuiltinProviderId,
  loadAiPreferences,
  markProviderQuotaExhausted,
  pingProviderOneToken,
  probeProvider,
  resolveRoleProvider,
  saveLastSelection,
  savePipelineRouting,
  saveProviderCredentials,
  VALID_PIPELINE_ROLES,
} from "./providers.mjs";
import {
  buildManualPromptPack,
  generateEpisodeScript,
  stripMarkdownCodeFences,
} from "./runner.mjs";
import { findMissingScriptSvgs, loadSvgCatalog } from "../src/svg_catalog.mjs";
import { reconcileEpisodeParts } from "../state_cli.mjs";

const WORKER_HEARTBEAT_INTERVAL_MS = 5000;
const WORKER_WATCHER_TTL_MS = Math.max(1000, Number(process.env.VIDEO_MAKER_WATCHER_TTL_MS) || 18_000);
const WORKER_SCHEDULE_TTL_MS = Math.max(5000, Number(process.env.VIDEO_MAKER_SCHEDULE_TTL_MS) || 90_000);
const WORKER_SWEEP_INTERVAL_MS = Math.max(500, Number(process.env.VIDEO_MAKER_SWEEP_INTERVAL_MS) || 3000);
const ALLOWED_AI_TASK_TYPES = new Set(["script_episode", "script_batch"]);
const VALID_AI_GENERATION_MODES = new Set(["deep_course", "three_stage"]);
const LEGACY_AI_GENERATION_MODES = new Set([
  "auto",
  "two_pass",
  "single_pass",
  "storyboard_only",
  "three_stage",
  "deep_course",
]);
const VALID_PAUSE_AFTER = new Set(["none", "brief", "part_review", "dialogue"]);
const VALID_START_FROM = new Set(["brief", "dialogue", "visual"]);
const PART_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_AI_BATCH_MCP = 5;
const MAX_AI_BATCH_BUILTIN = 100;
const MAX_AI_CUSTOM_INSTRUCTIONS_LEN = 1200;
const MAX_AI_REWRITE_NOTE_LEN = 4000;

function normalizeIncomingGenerationMode(rawMode) {
  if (rawMode === undefined || rawMode === null || String(rawMode).trim() === "") {
    return "deep_course";
  }
  const clean = String(rawMode).trim().toLowerCase();
  return LEGACY_AI_GENERATION_MODES.has(clean) ? "deep_course" : null;
}

export function createAiBroker(deps) {
  const {
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
    runAudioSpineProcess = null,
  } = deps;

  const validateWithSvgs = (scriptObj) => {
    const base = validateScriptDiagrams(scriptObj);
    const svgErrors = findMissingScriptSvgs(scriptObj);
    if (!svgErrors.length) return base;
    const errors = [...(base.errors || []), ...svgErrors];
    return { ...base, valid: errors.length === 0, errors };
  };

  const aiWorkers = new Map(); // worker_id -> worker record
  const pendingWaiterResponses = new Set(); // { res, worker_id, timer }
  const aiJobs = new Map(); // aijob-... -> aiJob
  const activeAiJobByEp = new Map(); // `${course}:${ep}` -> aijobId
  const runningBuiltinJobs = new Set(); // job.id currently executing loop
  let aiJobSeqCounter = 0;
  let lastWorkerSignature = "";

  function isLoopbackReq(req) {
    const addr = String(req.socket?.remoteAddress || "").trim();
    return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  }

  function requireLoopback(req, res) {
    if (!isLoopbackReq(req)) {
      sendJson(res, 403, {
        ok: false,
        code: "LOOPBACK_ONLY",
        error: "Worker and MCP endpoints are restricted to local loopback (127.0.0.1).",
      });
      return false;
    }
    return true;
  }

  function purgeExpiredWorkersInternal() {
    const now = Date.now();
    let removed = false;
    for (const [id, rec] of aiWorkers.entries()) {
      const ttl = rec.mode === "schedule" ? WORKER_SCHEDULE_TTL_MS : WORKER_WATCHER_TTL_MS;
      if (now - rec.last_heartbeat_at > ttl) {
        aiWorkers.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  function buildWorkerStatusSnapshot() {
    const workers = Array.from(aiWorkers.values())
      .sort((a, b) => b.last_heartbeat_at - a.last_heartbeat_at)
      .map((w) => ({
        worker_id: w.worker_id,
        model: w.model,
        mode: w.mode,
        session_label: w.session_label || null,
        registered_at: w.registered_at,
        last_heartbeat_iso: w.last_heartbeat_iso,
        age_ms: Math.max(0, Date.now() - w.last_heartbeat_at),
        ttl_ms: w.mode === "schedule" ? WORKER_SCHEDULE_TTL_MS : WORKER_WATCHER_TTL_MS,
      }));

    return {
      online: workers.length > 0,
      worker_count: workers.length,
      primary_worker: workers[0] || null,
      workers,
      heartbeat_interval_ms: WORKER_HEARTBEAT_INTERVAL_MS,
      watcher_ttl_ms: WORKER_WATCHER_TTL_MS,
      schedule_ttl_ms: WORKER_SCHEDULE_TTL_MS,
      ts: new Date().toISOString(),
    };
  }

  function workerStatusSignature(snap) {
    return JSON.stringify({
      online: snap.online,
      ids: snap.workers.map((w) => `${w.worker_id}:${w.model}:${w.mode}`),
    });
  }

  function getAiWorkerStatusSnapshot() {
    purgeExpiredWorkersInternal();
    return buildWorkerStatusSnapshot();
  }

  function hasOnlineWorker() {
    purgeExpiredWorkersInternal();
    return aiWorkers.size > 0;
  }

  function sweepExpiredWorkers({ broadcast = true } = {}) {
    const removed = purgeExpiredWorkersInternal();
    const snap = buildWorkerStatusSnapshot();
    const sig = workerStatusSignature(snap);
    if ((removed || sig !== lastWorkerSignature) && broadcast) {
      lastWorkerSignature = sig;
      broadcastSse("worker_status", snap);
    }
    return snap;
  }

  function recordWorkerHeartbeat(body = {}) {
    const rawId = String(body.worker_id || body.workerId || "").trim();
    if (!rawId || !/^[A-Za-z0-9._-]{1,80}$/.test(rawId)) {
      return { ok: false, status: 400, error: "Invalid worker_id (expected 1-80 chars of A-Za-z0-9._-)" };
    }
    const model = String(body.model || "connected-agent").trim().slice(0, 120) || "connected-agent";
    const mode = body.mode === "schedule" ? "schedule" : "watcher";
    const session_label = body.session_label ? String(body.session_label).trim().slice(0, 120) : null;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const existing = aiWorkers.get(rawId);

    aiWorkers.set(rawId, {
      worker_id: rawId,
      model,
      mode,
      session_label,
      pid: Number.isFinite(Number(body.pid)) ? Number(body.pid) : existing?.pid || null,
      registered_at: existing?.registered_at || nowIso,
      last_heartbeat_at: nowMs,
      last_heartbeat_iso: nowIso,
    });

    purgeExpiredWorkersInternal();
    const snap = buildWorkerStatusSnapshot();
    const sig = workerStatusSignature(snap);
    if (sig !== lastWorkerSignature) {
      lastWorkerSignature = sig;
      broadcastSse("worker_status", snap);
    }
    return { ok: true, worker_status: snap };
  }

  function sanitizeAiJobForApi(job) {
    return {
      id: job.id,
      kind: "ai_script",
      type: job.type,
      course: job.course,
      execution_mode: job.execution_mode || "mcp",
      provider_id: job.provider_id || "antigravity",
      model: job.model || job.claimed_model || null,
      mode: normalizeIncomingGenerationMode(job.mode) || "deep_course",
      pause_after: job.pause_after || "none",
      start_from: job.start_from || null,
      part_id: job.part_id || null,
      max_part_duration_sec: job.max_part_duration_sec ?? null,
      lock_audio_spine: Boolean(job.lock_audio_spine),
      role_routing: job.role_routing ? { ...job.role_routing } : null,
      paused_at: job.paused_at || null,
      paused_part_id: job.paused_part_id || null,
      compiler_provider_id: job.compiler_provider_id || null,
      compiler_model: job.compiler_model || null,
      episode_ids: [...(job.episode_ids || [])],
      episode_titles: { ...(job.episode_titles || {}) },
      current_episode: job.current_episode || null,
      completed_episodes: [...(job.completed_episodes || [])],
      custom_instructions: job.custom_instructions || "",
      rewrite_notes: job.rewrite_notes ? { ...job.rewrite_notes } : {},
      auto_produce: Boolean(job.auto_produce),
      render_prefs: job.render_prefs ? { ...job.render_prefs } : null,
      status: job.status,
      step: job.step,
      progress: job.progress ?? 0,
      pause_reason: job.pause_reason || null,
      failed_episode: job.failed_episode || null,
      claimed_by: job.claimed_by || null,
      claimed_model: job.claimed_model || null,
      logs: [...(job.logs || [])],
      error: job.error || null,
      summary: job.summary || null,
      spawned_production_jobs: [...(job.spawned_production_jobs || [])],
      created_at: job.created_at,
      started_at: job.started_at || null,
      updated_at: job.updated_at,
      completed_at: job.completed_at || null,
    };
  }

  function appendAiJobLog(job, line) {
    if (!line) return;
    job.logs = job.logs || [];
    job.logs.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
    if (job.logs.length > 100) {
      job.logs.splice(0, job.logs.length - 100);
    }
  }

  function listSortedAiJobs(courseFilter = "") {
    const list = Array.from(aiJobs.values())
      .filter((j) => !courseFilter || j.course === courseFilter)
      .sort((a, b) => (b._seq || 0) - (a._seq || 0));
    return list.map(sanitizeAiJobForApi);
  }

  function persistAiQueue() {
    try {
      const payload = {
        version: 1,
        updated_at: new Date().toISOString(),
        seq: aiJobSeqCounter,
        jobs: Array.from(aiJobs.values()),
      };
      writeJsonAtomic(AI_QUEUE_FILE, payload);
    } catch (err) {
      console.error(`[ai_queue] persist failed: ${err.message}`);
    }
  }

  function releaseAiEpLocks(job) {
    for (const epId of job?.episode_ids || []) {
      const k = `${job.course}:${epId}`;
      if (activeAiJobByEp.get(k) === job.id) {
        activeAiJobByEp.delete(k);
      }
    }
  }

  function acquireAiEpLocks(job, epIds = job.episode_ids) {
    for (const epId of epIds || []) {
      activeAiJobByEp.set(`${job.course}:${epId}`, job.id);
    }
  }

  function loadAiQueueFromDisk() {
    if (!fs.existsSync(AI_QUEUE_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(AI_QUEUE_FILE, "utf-8"));
      const list = Array.isArray(raw?.jobs) ? raw.jobs : [];
      aiJobSeqCounter = Math.max(0, Number(raw?.seq) || list.length);
      const now = new Date().toISOString();
      let modified = false;

      for (const item of list) {
        if (!item || !item.id || !ALLOWED_AI_TASK_TYPES.has(item.type)) continue;
        item.completed_episodes = Array.isArray(item.completed_episodes) ? item.completed_episodes : [];
        item.mode = normalizeIncomingGenerationMode(item.mode) || "deep_course";
        if (item.part_id === undefined) item.part_id = null;
        if (item.max_part_duration_sec === undefined) item.max_part_duration_sec = null;
        if (item.paused_part_id === undefined) item.paused_part_id = null;
        const isBuiltin = item.execution_mode === "builtin" || isBuiltinProviderId(item.provider_id);
        if (item.status === "running" || (isBuiltin && item.status === "queued")) {
          item.status = "paused";
          item.step = "paused";
          item.pause_reason = "server_interrupted";
          item.claimed_by = null;
          item.updated_at = now;
          appendAiJobLog(
            item,
            `Server restarted while ${isBuiltin ? "builtin" : "worker"} job was active; paused (${item.completed_episodes.length}/${(item.episode_ids || []).length} done).`
          );
          modified = true;
        }
        aiJobs.set(item.id, item);
        // Only queued/running hold active episode locks; paused jobs NEVER lock episodes
        if (item.status === "queued") {
          for (const epId of item.episode_ids || []) {
            if (!item.completed_episodes.includes(epId)) {
              activeAiJobByEp.set(`${item.course}:${epId}`, item.id);
            }
          }
        }
      }
      if (modified) persistAiQueue();
    } catch (err) {
      console.error(`[ai_queue] load failed: ${err.message}`);
    }
  }

  function findNextQueuedAiJob() {
    return (
      Array.from(aiJobs.values())
        .filter(
          (j) =>
            j.status === "queued" &&
            (j.execution_mode === "mcp" || !j.execution_mode) &&
            !isBuiltinProviderId(j.provider_id)
        )
        .sort((a, b) => (a._seq || 0) - (b._seq || 0))[0] || null
    );
  }

  function wakeWaiters(reason, job) {
    if (pendingWaiterResponses.size === 0) return;
    const snap = buildWorkerStatusSnapshot();
    const payload = {
      ok: true,
      wake: true,
      reason,
      job: job ? sanitizeAiJobForApi(job) : null,
      worker_status: snap,
    };
    for (const waiter of [...pendingWaiterResponses]) {
      pendingWaiterResponses.delete(waiter);
      clearTimeout(waiter.timer);
      try {
        sendJson(waiter.res, 200, payload);
      } catch {
        // ignore closed socket
      }
    }
  }

  function readJsonOrNull(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  function readTextOrEmpty(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return "";
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  function getFileMtimeMs(filePath) {
    try {
      return filePath && fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
    } catch {
      return 0;
    }
  }

  function writeTextAtomic(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, String(text ?? ""), "utf-8");
    fs.renameSync(tmp, filePath);
  }

  function loadEpisodeContextForRunner(course, episodeId) {
    const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
    if (!courseDir || !fs.existsSync(path.join(courseDir, "course.json"))) {
      throw new Error(`Course "${course}" not found.`);
    }
    const courseJsonPath = path.join(courseDir, "course.json");
    const courseJson = loadCourseJson(courseDir);
    const epMeta = flattenCourseEpisodes(courseJson).find((e) => e.id === episodeId);
    if (!epMeta) {
      throw new Error(`Episode "${episodeId}" not found in ${course}/course.json.`);
    }
    const curriculumPath = path.join(courseDir, "curriculum.md");
    const curriculumMd = fs.existsSync(curriculumPath) ? fs.readFileSync(curriculumPath, "utf-8") : "";
    const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId]);
    const briefPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "brief.json"]);
    const briefReviewPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "brief_review.md"]);
    const dialoguePath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "dialogue.json"]);
    const audioSpinePath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "audio_spine.json"]);
    const scriptPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "script.json"]);
    const notesPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "notes.md"]);
    const existingBrief = readJsonOrNull(briefPath);
    const existingBriefReviewMd = readTextOrEmpty(briefReviewPath);
    const existingDialogue = readJsonOrNull(dialoguePath);
    const audioSpine = readJsonOrNull(audioSpinePath);
    const existingScript = readJsonOrNull(scriptPath);
    const existingNotes = readTextOrEmpty(notesPath);

    const existingParts = {};
    const partsDir = path.join(epDir, "parts");
    if (fs.existsSync(partsDir) && fs.statSync(partsDir).isDirectory()) {
      const partDirs = fs
        .readdirSync(partsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^part_/i.test(d.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      for (const ent of partDirs) {
        const partId = ent.name;
        const pDir = path.join(partsDir, partId);
        const pDialoguePath = path.join(pDir, "dialogue.json");
        const pSpinePath = path.join(pDir, "audio_spine.json");
        const pNotesPath = path.join(pDir, "notes.md");
        existingParts[partId] = {
          part_id: partId,
          part_dir: pDir,
          dialogue_json: readJsonOrNull(pDialoguePath),
          review_md: readTextOrEmpty(path.join(pDir, "review.md")),
          audio_spine: readJsonOrNull(pSpinePath),
          script_json: readJsonOrNull(path.join(pDir, "script.json")),
          notes_md: readTextOrEmpty(pNotesPath),
        };
      }
      // For single-part episodes edited via root endpoints (/api/episodes/dialogue or /audio-spine),
      // prefer whichever artifact on disk was updated more recently.
      const partKeys = Object.keys(existingParts);
      if (partKeys.length === 1) {
        const onlyKey = partKeys[0];
        const pDir = existingParts[onlyKey].part_dir;
        if (existingDialogue && getFileMtimeMs(dialoguePath) > getFileMtimeMs(path.join(pDir, "dialogue.json"))) {
          existingParts[onlyKey].dialogue_json = existingDialogue;
        }
        if (audioSpine && getFileMtimeMs(audioSpinePath) > getFileMtimeMs(path.join(pDir, "audio_spine.json"))) {
          existingParts[onlyKey].audio_spine = audioSpine;
        }
        if (existingNotes && getFileMtimeMs(notesPath) > getFileMtimeMs(path.join(pDir, "notes.md"))) {
          existingParts[onlyKey].notes_md = existingNotes;
        }
      }
    }

    const openRevisions = listRevisions(WORKSPACE_ROOT, course, { episodeId, status: "open" });
    let availableSvgs = [];
    try {
      const cat = loadSvgCatalog(ENGINE_DIR);
      availableSvgs = Array.isArray(cat?.svgs) ? cat.svgs : [];
    } catch {
      availableSvgs = [];
    }
    return {
      courseDir,
      courseJsonPath,
      courseJson,
      curriculumMd,
      epMeta,
      epDir,
      briefPath,
      briefReviewPath,
      dialoguePath,
      audioSpinePath,
      scriptPath,
      notesPath,
      existingBrief,
      existingBriefReviewMd,
      existingDialogue,
      existingParts,
      audioSpine,
      existingScript,
      existingNotes,
      openRevisions,
      availableSvgs,
    };
  }

  function persistPartArtifacts({ epDir, partId, partData }) {
    if (!epDir || !partId || !partData || typeof partData !== "object") return;
    const partDir = path.join(epDir, "parts", partId);
    fs.mkdirSync(partDir, { recursive: true });
    if (partData.dialogue_json && typeof partData.dialogue_json === "object") {
      writeJsonAtomic(path.join(partDir, "dialogue.json"), partData.dialogue_json);
    }
    if (partData.review_md !== undefined && partData.review_md !== null && String(partData.review_md).trim()) {
      writeTextAtomic(path.join(partDir, "review.md"), String(partData.review_md));
    }
    if (partData.audio_spine && typeof partData.audio_spine === "object") {
      writeJsonAtomic(path.join(partDir, "audio_spine.json"), partData.audio_spine);
    }
    if (partData.script_json && typeof partData.script_json === "object") {
      writeJsonAtomic(path.join(partDir, "script.json"), partData.script_json);
    }
    if (partData.notes_md !== undefined && partData.notes_md !== null && String(partData.notes_md).trim()) {
      writeTextAtomic(path.join(partDir, "notes.md"), String(partData.notes_md));
    }
  }

  function syncGeneratedPartsIntoEpisodeState(courseDir, epId, epState, artifacts, { partOutputs = {}, pausedAt = null } = {}) {
    reconcileEpisodeParts(courseDir, epId, epState, artifacts);
    if (!Array.isArray(epState.parts)) epState.parts = [];
    const byId = new Map(epState.parts.map((p) => [p.part_id, p]));
    for (const [partId, partData] of Object.entries(partOutputs || {})) {
      if (!partData || typeof partData !== "object") continue;
      let entry = byId.get(partId);
      if (!entry) {
        entry = {
          part_id: partId,
          title: String(partData.part_spec?.title || partData.dialogue_json?.title || partId),
          target_duration_sec: partData.part_spec?.target_duration_sec ?? null,
          status: "pending",
          ai_review_verdict: null,
          approved: false,
          approved_at: null,
          tts_done: false,
          video_file: null,
          notes: "",
        };
        epState.parts.push(entry);
        byId.set(partId, entry);
      }
      if (partData.review_json?.verdict) {
        entry.ai_review_verdict = partData.review_json.verdict;
      }
      if (partData.script_json) {
        entry.status = "completed";
        entry.approved = false;
        entry.approved_at = null;
        entry.notes =
          partData.review_json?.verdict === "REVISE"
            ? "AI đã compile nhưng Content Review ghi chú REVISE (xem review.md)"
            : "Đã compile visual part — chờ user duyệt & merge-parts";
      } else if (pausedAt === "part_review") {
        entry.status = partData.review_json?.verdict === "REVISE" ? "needs_revision" : "reviewing";
        entry.approved = false;
        entry.approved_at = null;
        entry.notes = `Đã hoàn tất Content Review (${partData.review_json?.verdict || "DONE"})`;
      } else if (pausedAt === "dialogue") {
        entry.status = "in_progress";
        entry.approved = false;
        entry.approved_at = null;
        entry.notes = "Đã viết xong Lời thoại — chờ duyệt trước review/visual";
      }
    }
  }

  function saveEpisodeArtifactsAndState({
    course,
    courseDir = null,
    episodeId,
    epDir,
    scriptPath,
    notesPath,
    scriptJson,
    notesMd,
    ownerLabel,
    summaryNote,
    jobId = null,
    validation,
    scriptingPhase = null,
    partOutputs = null,
  }) {
    fs.mkdirSync(epDir, { recursive: true });
    writeJsonAtomic(scriptPath, scriptJson);

    if (notesMd !== undefined && notesMd !== null) {
      writeTextAtomic(notesPath, String(notesMd));
    }

    const resolvedCourseDir = courseDir || path.join(WORKSPACE_ROOT, course);
    const now = new Date().toISOString();
    const state = mutateEpisodeStateForJob(
      course,
      episodeId,
      (epState, artifacts) => {
        if (partOutputs && Object.keys(partOutputs).length > 0) {
          syncGeneratedPartsIntoEpisodeState(resolvedCourseDir, episodeId, epState, artifacts, {
            partOutputs,
            pausedAt: null,
          });
        }
        epState.scripting = epState.scripting || {};
        epState.scripting.status = "completed";
        if (scriptingPhase) {
          epState.scripting.phase = scriptingPhase;
        }
        epState.scripting.started_at = epState.scripting.started_at || now;
        epState.scripting.completed_at = now;
        epState.scripting.owner = ownerLabel;
        epState.scripting.notes = summaryNote;
        epState.production = epState.production || {};
        if (
          epState.production.tts_done ||
          epState.production.video_done ||
          artifacts.audio_count > 0 ||
          artifacts.video_file
        ) {
          epState.production.stale = true;
          epState.production.stale_reason = "Kịch bản vừa được AI biên tập lại; cần tạo lại Audio/Video";
        }
        if (epState.production.status === "needs_revision") {
          epState.production.status = "pending";
        }
        epState.last_error = null;
      },
      {
        type: "ai_script_submitted",
        job_id: jobId,
        owner: ownerLabel,
        message: `Hoàn tất kịch bản & diagram check (${validation.scene_count} visual scenes): ${episodeId}`,
      }
    );
    return state;
  }

  async function runBuiltinAiJobLoop(jobId) {
    if (runningBuiltinJobs.has(jobId)) return;
    const job = aiJobs.get(jobId);
    if (!job || job.status === "cancelled" || job.status === "completed") return;

    runningBuiltinJobs.add(jobId);
    const episodesAwaitingMerge = new Set();
    try {
      const nowStart = new Date().toISOString();
      job.status = "running";
      job.step = "in_progress";
      job.pause_reason = null;
      job.failed_episode = null;
      job.error = null;
      job.paused_at = null;
      job.paused_part_id = null;
      job.claimed_by = `builtin:${job.provider_id}`;
      job.claimed_model = job.model;
      job.started_at = job.started_at || nowStart;
      job.updated_at = nowStart;
      acquireAiEpLocks(
        job,
        job.episode_ids.filter((id) => !job.completed_episodes.includes(id))
      );
      persistAiQueue();
      broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });

      for (const epId of job.episode_ids) {
        if (job.completed_episodes.includes(epId)) continue;
        if (job.status === "cancelled") {
          releaseAiEpLocks(job);
          return;
        }

        const stepNow = new Date().toISOString();
        job.current_episode = epId;
        job.step = "in_progress";
        job.updated_at = stepNow;
        appendAiJobLog(
          job,
          `Generating ${epId}${job.part_id ? ` [${job.part_id}]` : ""} via ${job.provider_id}/${job.model}...`
        );

        const ownerLabel = `${job.provider_id}:${job.model}`;
        try {
          mutateEpisodeStateForJob(
            job.course,
            epId,
            (epState) => {
              epState.scripting = epState.scripting || {};
              epState.scripting.status = "in_progress";
              epState.scripting.started_at = epState.scripting.started_at || stepNow;
              epState.scripting.owner = ownerLabel;
              epState.last_error = null;
            },
            { type: "ai_job_progress", job_id: job.id, phase: "in_progress", message: `Đang viết kịch bản ${epId}...` }
          );
        } catch {
          // ignore if state init needed
        }

        persistAiQueue();
        broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });

        try {
          const ctx = loadEpisodeContextForRunner(job.course, epId);
          const epRewriteNote =
            (job.rewrite_notes && (job.rewrite_notes[epId] || job.rewrite_notes._shared)) || "";

          const resolvedBriefRole = resolveRoleProvider("brief_scriptwriter", {
            overrides: job.role_routing,
            job,
            engineDir: ENGINE_DIR,
          });
          const resolvedReviewerRole = resolveRoleProvider("content_reviewer", {
            overrides: job.role_routing,
            job,
            engineDir: ENGINE_DIR,
          });
          const resolvedDirectorRole = resolveRoleProvider("visual_director", {
            overrides: job.role_routing,
            job,
            engineDir: ENGINE_DIR,
          });
          const resolvedRepairRole = resolveRoleProvider("repair", {
            overrides: job.role_routing,
            job,
            engineDir: ENGINE_DIR,
          });
          const resolvedRoleRouting = {
            brief_scriptwriter: resolvedBriefRole,
            content_reviewer: resolvedReviewerRole,
            visual_director: resolvedDirectorRole,
            repair: resolvedRepairRole,
          };

          const fmtRole = (r) => `${r.provider_id || job.provider_id}/${r.model || job.model || "default"}(${r.source})`;
          appendAiJobLog(
            job,
            `[${epId}] Role routing: writer=${fmtRole(resolvedBriefRole)}, reviewer=${fmtRole(resolvedReviewerRole)}, director=${fmtRole(resolvedDirectorRole)}, repair=${fmtRole(resolvedRepairRole)}`
          );

          const saveRootBrief = ({ brief_json, brief_review_md }) => {
            fs.mkdirSync(ctx.epDir, { recursive: true });
            if (brief_json && ctx.briefPath) {
              writeJsonAtomic(ctx.briefPath, brief_json);
            }
            if (brief_review_md && String(brief_review_md).trim() && ctx.briefReviewPath) {
              writeTextAtomic(ctx.briefReviewPath, String(brief_review_md));
            }
          };

          const generated = await generateEpisodeScript({
            provider_id: resolvedBriefRole.provider_id || job.provider_id,
            model: resolvedBriefRole.model || job.model,
            compiler_provider_id: resolvedDirectorRole.provider_id || job.compiler_provider_id || null,
            compiler_model: resolvedDirectorRole.model || job.compiler_model || null,
            role_routing: resolvedRoleRouting,
            mode: normalizeIncomingGenerationMode(job.mode) || "deep_course",
            pause_after: job.pause_after || "none",
            start_from: job.start_from || null,
            part_id: job.part_id || null,
            max_part_duration_sec: job.max_part_duration_sec ?? null,
            courseJson: ctx.courseJson,
            curriculumMd: ctx.curriculumMd,
            episodeMeta: ctx.epMeta,
            existingBrief: ctx.existingBrief,
            existingBriefReviewMd: ctx.existingBriefReviewMd,
            existingDialogue: ctx.existingDialogue,
            existingParts: ctx.existingParts,
            audioSpine: ctx.audioSpine,
            availableSvgs: ctx.availableSvgs,
            existingScript: ctx.existingScript,
            existingNotes: ctx.existingNotes,
            openRevisions: ctx.openRevisions,
            customInstructions: job.custom_instructions,
            rewriteNote: epRewriteNote,
            validateScriptFn: validateWithSvgs,
            onBeforeVisualStage: async ({
              part_id: activePartId,
              brief_json,
              dialogue_json,
              review_md,
              notes_md,
            }) => {
              saveRootBrief({ brief_json });
              const resolvedPartId = activePartId || job.part_id || "part_01";
              const partDir = path.join(ctx.epDir, "parts", resolvedPartId);
              persistPartArtifacts({
                epDir: ctx.epDir,
                partId: resolvedPartId,
                partData: { dialogue_json, review_md, notes_md },
              });
              const briefPartCount = Array.isArray(brief_json?.parts) ? brief_json.parts.length : 1;
              const isSinglePartRoot =
                !job.part_id && briefPartCount <= 1 && Object.keys(ctx.existingParts || {}).length <= 1;
              if (isSinglePartRoot) {
                if (dialogue_json && ctx.dialoguePath) writeJsonAtomic(ctx.dialoguePath, dialogue_json);
                if (notes_md !== undefined && notes_md !== null && String(notes_md).trim() && ctx.notesPath) {
                  writeTextAtomic(ctx.notesPath, String(notes_md));
                }
              }
              const targetSpineEpDir = isSinglePartRoot ? ctx.epDir : partDir;
              const targetDialoguePath = isSinglePartRoot
                ? ctx.dialoguePath
                : path.join(partDir, "dialogue.json");

              if (job.lock_audio_spine && typeof runAudioSpineProcess === "function" && targetDialoguePath) {
                appendAiJobLog(
                  job,
                  `[${epId}/${resolvedPartId}] Locking Audio-Spine TTS durations before Visual Director...`
                );
                try {
                  const spineRes = await runAudioSpineProcess({
                    courseJsonPath: ctx.courseJsonPath,
                    epDir: targetSpineEpDir,
                    dialoguePath: targetDialoguePath,
                  });
                  if (spineRes?.ok && spineRes.audio_spine) {
                    if (!isSinglePartRoot && ctx.existingParts?.[resolvedPartId]) {
                      ctx.existingParts[resolvedPartId].audio_spine = spineRes.audio_spine;
                    }
                    appendAiJobLog(
                      job,
                      `[${epId}/${resolvedPartId}] Audio-Spine locked (${spineRes.audio_spine.beats?.length || 0} beats, ${spineRes.audio_spine.total_duration_ms || 0}ms).`
                    );
                    return spineRes.audio_spine;
                  }
                  appendAiJobLog(
                    job,
                    `[${epId}/${resolvedPartId}] Audio-Spine warning (continuing without lock): ${spineRes?.error || "TTS failed"}`
                  );
                } catch (spineErr) {
                  appendAiJobLog(
                    job,
                    `[${epId}/${resolvedPartId}] Audio-Spine warning (continuing without lock): ${spineErr?.message || spineErr}`
                  );
                }
              }
              return (!isSinglePartRoot ? ctx.existingParts?.[resolvedPartId]?.audio_spine : null) || ctx.audioSpine || null;
            },
            onProgress: ({ phase, message }) => {
              if (phase) job.step = String(phase);
              if (message) appendAiJobLog(job, `[${epId}] ${message}`);
              job.updated_at = new Date().toISOString();
              persistAiQueue();
              broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
            },
            engineDir: ENGINE_DIR,
          });

          if (job.status === "cancelled") {
            releaseAiEpLocks(job);
            return;
          }

          saveRootBrief({
            brief_json: generated.brief_json,
            brief_review_md: generated.brief_review_md,
          });
          for (const [partId, partData] of Object.entries(generated.parts || {})) {
            persistPartArtifacts({ epDir: ctx.epDir, partId, partData });
          }

          const briefPartCount = Array.isArray(generated.brief_json?.parts)
            ? generated.brief_json.parts.length
            : 0;
          const genPartKeys = Object.keys(generated.parts || {});
          const isMultiPart =
            Boolean(job.part_id) ||
            briefPartCount > 1 ||
            genPartKeys.length > 1 ||
            Object.keys(ctx.existingParts || {}).length > 1;

          if (
            generated.paused_at === "brief" ||
            generated.paused_at === "dialogue" ||
            generated.paused_at === "part_review"
          ) {
            episodesAwaitingMerge.add(epId);
            if (!isMultiPart && generated.paused_at !== "brief") {
              if (generated.dialogue_json && ctx.dialoguePath) {
                writeJsonAtomic(ctx.dialoguePath, generated.dialogue_json);
              }
              if (generated.notes_md !== undefined && generated.notes_md !== null && String(generated.notes_md).trim() && ctx.notesPath) {
                writeTextAtomic(ctx.notesPath, String(generated.notes_md));
              }
            }
            job.paused_at = generated.paused_at;
            job.paused_part_id = generated.paused_part_id || null;
            const targetPhase =
              generated.paused_at === "brief"
                ? "brief_ready"
                : generated.paused_at === "dialogue"
                  ? "dialogue_ready"
                  : "part_review";
            const stageHuman =
              generated.paused_at === "brief"
                ? "Content Brief (Tầng 1)"
                : generated.paused_at === "dialogue"
                  ? "Lời thoại & Beats (Tầng 2)"
                  : "Content Review (Tầng 2.5)";
            try {
              mutateEpisodeStateForJob(
                job.course,
                epId,
                (epState, artifacts) => {
                  syncGeneratedPartsIntoEpisodeState(ctx.courseDir, epId, epState, artifacts, {
                    partOutputs: generated.parts,
                    pausedAt: generated.paused_at,
                  });
                  epState.scripting = epState.scripting || {};
                  epState.scripting.status = artifacts.script ? "completed" : "reviewing";
                  epState.scripting.phase = targetPhase;
                  epState.scripting.owner = ownerLabel;
                  epState.scripting.notes = `Đang chờ duyệt ${stageHuman}${job.paused_part_id ? ` (${job.paused_part_id})` : ""}`;
                  epState.last_error = null;
                },
                {
                  type: "ai_stage_paused",
                  job_id: job.id,
                  paused_at: generated.paused_at,
                  paused_part_id: job.paused_part_id,
                  owner: ownerLabel,
                  message: `Đã hoàn tất ${stageHuman} cho ${epId} — chờ duyệt trước khi tiếp tục.`,
                }
              );
            } catch {
              // ignore if state file missing
            }
          } else if (!isMultiPart) {
            if (generated.dialogue_json && ctx.dialoguePath) {
              writeJsonAtomic(ctx.dialoguePath, generated.dialogue_json);
            }
            if (generated.audio_spine && ctx.audioSpinePath) {
              writeJsonAtomic(ctx.audioSpinePath, generated.audio_spine);
            }
            const summaryNote = epRewriteNote
              ? `Viết lại KB bởi ${ownerLabel}: ${epRewriteNote.slice(0, 120)}`
              : `Script deep_course biên soạn bởi ${ownerLabel} (${generated.attempts} lần gọi)`;

            saveEpisodeArtifactsAndState({
              course: job.course,
              courseDir: ctx.courseDir,
              episodeId: epId,
              epDir: ctx.epDir,
              scriptPath: ctx.scriptPath,
              notesPath: ctx.notesPath,
              scriptJson: generated.script_json,
              notesMd: generated.notes_md,
              ownerLabel,
              summaryNote,
              jobId: job.id,
              validation: generated.validation,
              scriptingPhase: "visual_compiled",
              partOutputs: generated.parts,
            });
          } else {
            // Multi-part episode (or targeted part_id): persist parts/* and wait for per-part approval + merge-parts
            episodesAwaitingMerge.add(epId);
            const partSummaryLabel = job.part_id
              ? `Biên soạn part ${job.part_id} bởi ${ownerLabel} (${generated.attempts} lần gọi) — chờ duyệt & merge-parts`
              : `Biên soạn ${genPartKeys.length} part(s) bởi ${ownerLabel} (${generated.attempts} lần gọi) — chờ duyệt từng part & merge-parts`;
            try {
              mutateEpisodeStateForJob(
                job.course,
                epId,
                (epState, artifacts) => {
                  syncGeneratedPartsIntoEpisodeState(ctx.courseDir, epId, epState, artifacts, {
                    partOutputs: generated.parts,
                    pausedAt: null,
                  });
                  epState.scripting = epState.scripting || {};
                  epState.scripting.status = artifacts.script ? "completed" : "reviewing";
                  epState.scripting.phase = "parts_ready";
                  epState.scripting.owner = ownerLabel;
                  epState.scripting.notes = partSummaryLabel;
                  epState.last_error = null;
                },
                {
                  type: "ai_parts_compiled",
                  job_id: job.id,
                  part_ids: genPartKeys,
                  owner: ownerLabel,
                  message: `Đã biên soạn ${genPartKeys.join(", ")} cho ${epId} — chờ duyệt & merge-parts.`,
                }
              );
            } catch {
              // ignore if state file missing
            }
          }

          if (!job.completed_episodes.includes(epId)) {
            job.completed_episodes.push(epId);
          }
          const nextPending = job.episode_ids.find((id) => !job.completed_episodes.includes(id));
          job.current_episode = nextPending || epId;
          job.progress = Math.min(
            95,
            Math.round((job.completed_episodes.length / Math.max(1, job.episode_ids.length)) * 90)
          );
          job.updated_at = new Date().toISOString();
          appendAiJobLog(
            job,
            `Completed ${epId} (${job.completed_episodes.length}/${job.episode_ids.length}).`
          );

          persistAiQueue();
          broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
        } catch (err) {
          if (job.status === "cancelled") {
            releaseAiEpLocks(job);
            return;
          }

          const errNow = new Date().toISOString();
          const isQuota = err?.code === "QUOTA_EXHAUSTED";
          if (isQuota) {
            markProviderQuotaExhausted(job.provider_id, err.message);
          }

          job.status = "paused";
          job.step = "paused";
          job.pause_reason = isQuota ? "quota_exhausted" : "error";
          job.failed_episode = epId;
          job.error = err?.message || String(err);
          job.updated_at = errNow;
          appendAiJobLog(
            job,
            `Paused at ${epId} (${job.pause_reason}): ${job.error}`
          );

          releaseAiEpLocks(job);

          try {
            mutateEpisodeStateForJob(
              job.course,
              epId,
              (epState, artifacts) => {
                epState.scripting = epState.scripting || {};
                if (epState.scripting.status === "in_progress" || epState.scripting.status === "planning") {
                  epState.scripting.status = artifacts.script ? "completed" : "pending";
                }
                epState.last_error = job.error;
              },
              {
                type: "ai_job_paused",
                job_id: job.id,
                pause_reason: job.pause_reason,
                error: job.error,
              }
            );
          } catch {
            // ignore missing state dir
          }

          persistAiQueue();
          broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
          return;
        }
      }

      // All episodes completed
      const doneNow = new Date().toISOString();
      releaseAiEpLocks(job);

      const spawned = [];
      if (
        job.auto_produce &&
        !job.paused_at &&
        (!job.pause_after || job.pause_after === "none") &&
        !job.part_id
      ) {
        for (const epId of job.episode_ids) {
          if (episodesAwaitingMerge.has(epId)) {
            appendAiJobLog(
              job,
              `Auto-produce skipped for ${epId}: multi-part episode awaits part approval & merge-parts.`
            );
            continue;
          }
          const prodRes = enqueueProductionJob({
            course: job.course,
            episode: epId,
            ...(job.render_prefs || {}),
            mode: job.render_prefs?.mode || "tts_and_render",
          });
          if (prodRes.ok && prodRes.job?.id) {
            spawned.push(prodRes.job.id);
            appendAiJobLog(job, `Auto-queued production ${prodRes.job.id} for ${epId}.`);
          } else {
            appendAiJobLog(job, `Auto-produce skipped for ${epId}: ${prodRes.error}`);
          }
        }
      }

      job.spawned_production_jobs = spawned;
      job.status = "completed";
      job.step = "done";
      job.progress = 100;
      job.summary = `Hoàn tất ${job.episode_ids.length} tập (${job.provider_id}/${job.model}).`;
      job.completed_at = doneNow;
      job.updated_at = doneNow;
      appendAiJobLog(job, job.summary);

      persistAiQueue();
      broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    } finally {
      runningBuiltinJobs.delete(jobId);
    }
  }

  function normalizeRewriteNotes(body = {}) {
    const out = {};
    if (body.rewrite_notes && typeof body.rewrite_notes === "object" && !Array.isArray(body.rewrite_notes)) {
      for (const [k, v] of Object.entries(body.rewrite_notes)) {
        const key = String(k || "").trim();
        const val = String(v || "").trim().slice(0, MAX_AI_REWRITE_NOTE_LEN);
        if (key && val) out[key] = val;
      }
    }
    if (body.rewrite_note) {
      const shared = String(body.rewrite_note).trim().slice(0, MAX_AI_REWRITE_NOTE_LEN);
      if (shared && !out._shared) out._shared = shared;
    }
    return out;
  }

  /**
   * Parse and validate shared pipeline control options for job creation and resume.
   */
  function parsePipelineOptionsFromBody(body = {}, existing = null) {
    const isCreate = !existing;
    let mode = existing ? existing.mode : "deep_course";
    if (isCreate || (body.mode !== undefined && body.mode !== null && String(body.mode).trim() !== "")) {
      const parsedMode = normalizeIncomingGenerationMode(body.mode);
      if (!parsedMode) {
        return {
          ok: false,
          code: "INVALID_MODE",
          error: `Invalid generation mode "${String(body.mode)}". Allowed: ${Array.from(VALID_AI_GENERATION_MODES).join(", ")}.`,
        };
      }
      mode = parsedMode;
    }

    let pause_after = existing ? existing.pause_after || "none" : "none";
    if (isCreate || (body.pause_after !== undefined && body.pause_after !== null && String(body.pause_after).trim() !== "")) {
      const pa =
        body.pause_after !== undefined && body.pause_after !== null && String(body.pause_after).trim() !== ""
          ? String(body.pause_after).trim().toLowerCase()
          : "none";
      if (!VALID_PAUSE_AFTER.has(pa)) {
        return {
          ok: false,
          code: "INVALID_PAUSE_AFTER",
          error: `Invalid pause_after "${pa}". Allowed: ${Array.from(VALID_PAUSE_AFTER).join(", ")}.`,
        };
      }
      pause_after = pa;
    }

    let start_from = existing ? existing.start_from ?? null : null;
    if (isCreate || body.start_from !== undefined) {
      const sf =
        body.start_from !== undefined && body.start_from !== null && String(body.start_from).trim() !== ""
          ? String(body.start_from).trim().toLowerCase()
          : null;
      if (sf && !VALID_START_FROM.has(sf)) {
        return {
          ok: false,
          code: "INVALID_START_FROM",
          error: `Invalid start_from "${sf}". Allowed: ${Array.from(VALID_START_FROM).join(", ")}.`,
        };
      }
      start_from = sf;
    }

    let part_id = existing ? existing.part_id ?? null : null;
    if (isCreate || body.part_id !== undefined || body.partId !== undefined) {
      const rawPartId = body.part_id ?? body.partId ?? null;
      const pid =
        rawPartId !== undefined && rawPartId !== null && String(rawPartId).trim() !== ""
          ? String(rawPartId).trim()
          : null;
      if (pid && !PART_ID_RE.test(pid)) {
        return { ok: false, code: "INVALID_PART_ID", error: `Invalid part_id "${pid}".` };
      }
      part_id = pid;
    }

    let max_part_duration_sec = existing ? existing.max_part_duration_sec ?? null : null;
    if (isCreate || body.max_part_duration_sec !== undefined || body.maxPartDurationSec !== undefined) {
      const rawMax = body.max_part_duration_sec ?? body.maxPartDurationSec ?? null;
      if (rawMax === undefined || rawMax === null || String(rawMax).trim() === "") {
        max_part_duration_sec = null;
      } else {
        const parsedMax = Number(rawMax);
        if (!Number.isFinite(parsedMax) || parsedMax < 60 || parsedMax > 600) {
          return {
            ok: false,
            code: "INVALID_MAX_PART_DURATION",
            error: "max_part_duration_sec must be a number between 60 and 600 seconds.",
          };
        }
        max_part_duration_sec = Math.round(parsedMax);
      }
    }

    const lock_audio_spine =
      body.lock_audio_spine !== undefined
        ? Boolean(body.lock_audio_spine)
        : Boolean(existing?.lock_audio_spine);

    let role_routing = existing ? existing.role_routing ?? null : null;
    if (body.role_routing !== undefined) {
      if (body.role_routing && typeof body.role_routing === "object" && !Array.isArray(body.role_routing)) {
        const parsedRouting = {};
        for (const [rKey, rVal] of Object.entries(body.role_routing)) {
          if (!VALID_PIPELINE_ROLES.includes(rKey) || !rVal || typeof rVal !== "object") continue;
          const rPid = rVal.provider_id ? String(rVal.provider_id).trim() : null;
          if (rPid && !getBrandSpec(rPid)) {
            return {
              ok: false,
              code: "INVALID_PROVIDER",
              error: `Role "${rKey}" provider "${rPid}" is unknown.`,
            };
          }
          parsedRouting[rKey] = {
            provider_id: rPid,
            model: rVal.model ? String(rVal.model).trim().slice(0, 160) : null,
          };
        }
        role_routing = Object.keys(parsedRouting).length > 0 ? parsedRouting : null;
      } else {
        role_routing = null;
      }
    }

    let compiler_provider_id = existing ? existing.compiler_provider_id ?? null : null;
    if (isCreate || body.compiler_provider_id !== undefined) {
      const cp = body.compiler_provider_id
        ? String(body.compiler_provider_id).trim().slice(0, 80)
        : null;
      if (cp && !isBuiltinProviderId(cp)) {
        return {
          ok: false,
          code: "INVALID_PROVIDER",
          error: `Compiler provider "${cp}" must be a builtin provider.`,
        };
      }
      compiler_provider_id = cp;
    }

    const compiler_model =
      isCreate || body.compiler_model !== undefined
        ? body.compiler_model
          ? String(body.compiler_model).trim().slice(0, 160)
          : null
        : existing?.compiler_model ?? null;

    return {
      ok: true,
      options: {
        mode,
        pause_after,
        start_from,
        part_id,
        max_part_duration_sec,
        lock_audio_spine,
        role_routing,
        compiler_provider_id,
        compiler_model,
      },
    };
  }

  // --- HTTP Handlers ---

  function handleGetAiStatus(res) {
    const snap = getAiWorkerStatusSnapshot();
    const allJobs = Array.from(aiJobs.values());
    const prefs = loadAiPreferences(ENGINE_DIR);
    return sendJson(res, 200, {
      ok: true,
      ...snap,
      queued_jobs: allJobs.filter((j) => j.status === "queued").length,
      running_jobs: allJobs.filter((j) => j.status === "running").length,
      paused_jobs: allJobs.filter((j) => j.status === "paused").length,
      allowed_task_types: Array.from(ALLOWED_AI_TASK_TYPES),
      supported_visual_types: [...SUPPORTED_VISUAL_TYPES],
      last_selection: prefs.last_selection,
    });
  }

  function handleGetAiJobs(res, parsedUrl) {
    const course = String(parsedUrl.searchParams.get("course") || "").trim();
    if (course && !/^[A-Za-z0-9_-]+$/.test(course)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course identifier" });
    }
    return sendJson(res, 200, { ok: true, jobs: listSortedAiJobs(course) });
  }

  async function handleGetAiProviders(res, parsedUrl) {
    const forceRaw = String(parsedUrl.searchParams.get("force") || "").toLowerCase();
    const force = forceRaw === "1" || forceRaw === "true";
    const workerStatus = getAiWorkerStatusSnapshot();
    try {
      const overview = await getProvidersOverview({
        force,
        workerStatus,
        workspaceRoot: WORKSPACE_ROOT,
        engineDir: ENGINE_DIR,
      });
      return sendJson(res, 200, {
        ok: true,
        ...overview,
        worker_status: workerStatus,
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  async function handlePostProviderCredentials(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const providerId = String(body.provider_id || "").trim();
    if (!getBrandSpec(providerId)) {
      return sendJson(res, 400, { ok: false, error: `Unknown provider "${providerId}"` });
    }

    try {
      saveProviderCredentials(
        {
          provider_id: providerId,
          api_key: body.api_key,
          base_url: body.base_url,
          clear: Boolean(body.clear),
        },
        ENGINE_DIR
      );
      const workerStatus = getAiWorkerStatusSnapshot();
      const provider = await probeProvider(providerId, {
        force: true,
        workerStatus,
        workspaceRoot: WORKSPACE_ROOT,
        engineDir: ENGINE_DIR,
      });
      const overview = await getProvidersOverview({
        force: false,
        workerStatus,
        workspaceRoot: WORKSPACE_ROOT,
        engineDir: ENGINE_DIR,
      });
      return sendJson(res, 200, {
        ok: true,
        provider,
        ...overview,
      });
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
    }
  }

  async function handleTestProvider(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const providerId = String(body.provider_id || "").trim();
    if (!getBrandSpec(providerId)) {
      return sendJson(res, 400, { ok: false, error: `Unknown provider "${providerId}"` });
    }

    const workerStatus = getAiWorkerStatusSnapshot();
    const doPing = Boolean(body.ping_one_token) || body.mode === "ping";

    try {
      let ping_result = null;
      if (doPing) {
        ping_result = await pingProviderOneToken({
          provider_id: providerId,
          model: body.model,
          engineDir: ENGINE_DIR,
        });
      }
      const provider = await probeProvider(providerId, {
        force: true,
        workerStatus,
        workspaceRoot: WORKSPACE_ROOT,
        engineDir: ENGINE_DIR,
      });
      return sendJson(res, 200, {
        ok: doPing ? Boolean(ping_result?.ok) : true,
        provider,
        ping_result,
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  async function handleCreateAiJob(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const type = String(body.type || "").trim();
    if (!ALLOWED_AI_TASK_TYPES.has(type)) {
      return sendJson(res, 400, {
        ok: false,
        code: "TASK_NOT_ALLOWED",
        error: `Task type "${type}" không nằm trong whitelist. Chỉ hỗ trợ: ${Array.from(ALLOWED_AI_TASK_TYPES).join(", ")}.`,
      });
    }

    const rawProvider = String(body.provider_id || "").trim();
    const rawMode = String(body.execution_mode || "").trim().toLowerCase();
    const isBuiltin = rawMode === "builtin" || isBuiltinProviderId(rawProvider);
    const provider_id = isBuiltin ? rawProvider : "antigravity";
    const execution_mode = isBuiltin ? "builtin" : "mcp";

    let resolvedModel = body.model ? String(body.model).trim().slice(0, 160) : null;

    if (!isBuiltin) {
      if (!hasOnlineWorker()) {
        return sendJson(res, 503, {
          ok: false,
          code: "WORKER_OFFLINE",
          error:
            'Chưa kết nối Antigravity Worker. Vui lòng mở Antigravity IDE và gửi lệnh "Bật VideoMaker Worker" hoặc chọn nhà cung cấp API khác.',
          worker_status: getAiWorkerStatusSnapshot(),
        });
      }
    } else {
      const spec = getBrandSpec(provider_id);
      if (!spec || spec.execution_mode !== "builtin") {
        return sendJson(res, 400, {
          ok: false,
          code: "INVALID_PROVIDER",
          error: `Provider "${provider_id}" không hỗ trợ chế độ chạy tự động builtin.`,
        });
      }
      const probe = await probeProvider(provider_id, {
        force: false,
        workerStatus: getAiWorkerStatusSnapshot(),
        workspaceRoot: WORKSPACE_ROOT,
        engineDir: ENGINE_DIR,
      });
      if (probe.auth_status === "invalid") {
        return sendJson(res, 401, {
          ok: false,
          code: "AUTH_INVALID",
          error: probe.last_error || `API key của ${spec.name} không hợp lệ.`,
          provider: probe,
        });
      }
      if (probe.auth_status === "quota_exhausted") {
        return sendJson(res, 429, {
          ok: false,
          code: "QUOTA_EXHAUSTED",
          error: probe.last_error || `${spec.name} đang hết quota hoặc số dư.`,
          provider: probe,
        });
      }
      if (probe.auth_status === "unconfigured" || !probe.ready) {
        return sendJson(res, 400, {
          ok: false,
          code: "PROVIDER_NOT_READY",
          error: probe.setup_hint || `${spec.name} chưa sẵn sàng (${probe.auth_status}).`,
          provider: probe,
        });
      }
      if (!resolvedModel) {
        resolvedModel = probe.models?.[0]?.id || null;
      }
      if (!resolvedModel) {
        return sendJson(res, 400, {
          ok: false,
          code: "MODEL_REQUIRED",
          error: `Vui lòng chọn hoặc nhập tên model cho ${spec.name}.`,
        });
      }
    }

    const course = String(body.course || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(course)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course identifier" });
    }
    const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
    if (!courseDir || !fs.existsSync(path.join(courseDir, "course.json"))) {
      return sendJson(res, 404, { ok: false, error: `Không tìm thấy khóa học "${course}".` });
    }

    let courseJson;
    try {
      courseJson = loadCourseJson(courseDir);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const rawEpList = Array.isArray(body.episode_ids)
      ? body.episode_ids
      : body.episode_id || body.episode
        ? [body.episode_id || body.episode]
        : [];
    const episode_ids = [];
    const seenEps = new Set();
    for (const item of rawEpList) {
      const ep = String(item || "").trim();
      if (!ep || seenEps.has(ep)) continue;
      seenEps.add(ep);
      episode_ids.push(ep);
    }

    const maxBatch = isBuiltin ? MAX_AI_BATCH_BUILTIN : MAX_AI_BATCH_MCP;
    if (episode_ids.length === 0) {
      return sendJson(res, 400, { ok: false, error: "Cần chọn ít nhất 1 tập để biên kịch." });
    }
    if (type === "script_episode" && episode_ids.length !== 1) {
      return sendJson(res, 400, { ok: false, error: "script_episode chỉ nhận đúng 1 tập." });
    }
    if (episode_ids.length > maxBatch) {
      return sendJson(res, 400, {
        ok: false,
        error: `Mỗi đợt biên kịch tối đa ${maxBatch} tập (đã chọn ${episode_ids.length}).`,
      });
    }

    const courseEps = new Map(flattenCourseEpisodes(courseJson).map((e) => [e.id, e]));
    const episode_titles = {};
    for (const epId of episode_ids) {
      if (!/^[A-Za-z0-9_-]+$/.test(epId) || !courseEps.has(epId)) {
        return sendJson(res, 404, {
          ok: false,
          error: `Tập "${epId}" không tồn tại trong ${course}/course.json.`,
        });
      }
      const key = `${course}:${epId}`;
      if (activeAiJobByEp.has(key)) {
        const existingId = activeAiJobByEp.get(key);
        const existing = aiJobs.get(existingId);
        if (existing && (existing.status === "queued" || existing.status === "running")) {
          return sendJson(res, 409, {
            ok: false,
            code: "EPISODE_BUSY",
            error: `Tập "${epId}" đang có tác vụ AI biên kịch (${existing.status}).`,
            job_id: existingId,
          });
        }
        activeAiJobByEp.delete(key);
      }
      if (activeJobByEp.has(key)) {
        const prodId = activeJobByEp.get(key);
        const prodJob = jobs.get(prodId);
        if (prodJob && (prodJob.status === "queued" || prodJob.status === "running")) {
          return sendJson(res, 409, {
            ok: false,
            code: "EPISODE_BUSY",
            error: `Tập "${epId}" đang chạy tác vụ TTS/Render (${prodJob.status}).`,
            job_id: prodId,
          });
        }
        activeJobByEp.delete(key);
      }
      episode_titles[epId] = courseEps.get(epId)?.title || epId;
    }

    const optsParsed = parsePipelineOptionsFromBody(body);
    if (!optsParsed.ok) {
      return sendJson(res, 400, {
        ok: false,
        code: optsParsed.code,
        error: optsParsed.error,
      });
    }
    const {
      mode: requestedMode,
      pause_after,
      start_from,
      part_id,
      max_part_duration_sec,
      lock_audio_spine,
      role_routing,
      compiler_provider_id,
      compiler_model,
    } = optsParsed.options;

    const custom_instructions = String(body.custom_instructions || "")
      .trim()
      .slice(0, MAX_AI_CUSTOM_INSTRUCTIONS_LEN);
    const rewrite_notes = normalizeRewriteNotes(body);
    const auto_produce =
      pause_after !== "none" || Boolean(part_id) ? false : Boolean(body.auto_produce);
    let render_prefs = null;
    if (auto_produce) {
      const rawPrefs = body.render_prefs && typeof body.render_prefs === "object" ? body.render_prefs : {};
      const validRes = validateRenderOptions({ ...rawPrefs, mode: rawPrefs.mode || "tts_and_render" });
      if (!validRes.ok) {
        return sendJson(res, validRes.status || 400, { ok: false, error: validRes.error });
      }
      render_prefs = validRes.options;
    }

    if (isBuiltin) {
      saveLastSelection({ provider_id, model: resolvedModel, auto_produce }, ENGINE_DIR);
    }

    const now = new Date().toISOString();
    const aiJob = {
      id: `aijob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      _seq: ++aiJobSeqCounter,
      kind: "ai_script",
      type,
      course,
      execution_mode,
      provider_id,
      model: resolvedModel,
      mode: requestedMode,
      pause_after,
      start_from,
      part_id,
      max_part_duration_sec,
      lock_audio_spine,
      role_routing,
      paused_at: null,
      paused_part_id: null,
      compiler_provider_id,
      compiler_model,
      episode_ids,
      episode_titles,
      current_episode: episode_ids[0],
      completed_episodes: [],
      custom_instructions,
      rewrite_notes,
      auto_produce,
      render_prefs,
      status: "queued",
      step: "queued",
      progress: 0,
      pause_reason: null,
      failed_episode: null,
      claimed_by: null,
      claimed_model: isBuiltin ? resolvedModel : null,
      logs: [],
      error: null,
      summary: null,
      spawned_production_jobs: [],
      created_at: now,
      started_at: null,
      updated_at: now,
      completed_at: null,
    };
    appendAiJobLog(
      aiJob,
      `Queued ${type} [${execution_mode}:${provider_id}${resolvedModel ? `/${resolvedModel}` : ""}; mode=${requestedMode}${part_id ? `; part=${part_id}` : ""}${compiler_model ? `; compiler=${compiler_provider_id || provider_id}/${compiler_model}` : ""}] for ${course} (${episode_ids.length} ep; auto_produce=${auto_produce})`
    );

    aiJobs.set(aiJob.id, aiJob);
    acquireAiEpLocks(aiJob);
    persistAiQueue();

    const stateDir = path.join(courseDir, "state");
    if (fs.existsSync(stateDir)) {
      appendEvent(stateDir, {
        type: "ai_job_queued",
        course,
        job_id: aiJob.id,
        execution_mode,
        provider_id,
        model: resolvedModel,
        episode_ids,
        auto_produce,
        message: `Web UI đã đẩy lệnh biên kịch AI (${provider_id}) cho ${episode_ids.join(", ")}`,
      });
    }

    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(aiJob) });

    if (isBuiltin) {
      setImmediate(() => void runBuiltinAiJobLoop(aiJob.id));
    } else {
      wakeWaiters("job_enqueued", aiJob);
    }

    return sendJson(res, 202, {
      ok: true,
      job: sanitizeAiJobForApi(aiJob),
      worker_status: getAiWorkerStatusSnapshot(),
    });
  }

  async function handleResumeAiJob(req, res) {
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
    const job = aiJobs.get(jobId);
    if (!job) {
      return sendJson(res, 404, { ok: false, error: "AI job not found" });
    }
    if (job.status !== "paused" && job.status !== "failed") {
      return sendJson(res, 400, {
        ok: false,
        error: `Chỉ có thể tiếp tục job đang paused/failed (hiện tại: ${job.status}).`,
      });
    }

    const remainingEps = (job.episode_ids || []).filter((id) => !(job.completed_episodes || []).includes(id));
    if (remainingEps.length === 0) {
      return sendJson(res, 400, { ok: false, error: "Job đã hoàn tất tất cả các tập." });
    }

    for (const epId of remainingEps) {
      const key = `${job.course}:${epId}`;
      const existingAiId = activeAiJobByEp.get(key);
      if (existingAiId && existingAiId !== job.id) {
        const existing = aiJobs.get(existingAiId);
        if (existing && (existing.status === "queued" || existing.status === "running")) {
          return sendJson(res, 409, {
            ok: false,
            code: "EPISODE_BUSY",
            error: `Tập "${epId}" đang bận trong job khác (${existingAiId}).`,
          });
        }
      }
      if (activeJobByEp.has(key)) {
        const prodId = activeJobByEp.get(key);
        const prodJob = jobs.get(prodId);
        if (prodJob && (prodJob.status === "queued" || prodJob.status === "running")) {
          return sendJson(res, 409, {
            ok: false,
            code: "EPISODE_BUSY",
            error: `Tập "${epId}" đang chạy TTS/Render (${prodJob.status}).`,
          });
        }
      }
    }

    const targetProvider = String(body.provider_id || job.provider_id || "antigravity").trim();
    const isBuiltin = isBuiltinProviderId(targetProvider) && body.execution_mode !== "mcp";
    const execution_mode = isBuiltin ? "builtin" : "mcp";
    let targetModel = body.model !== undefined ? String(body.model || "").trim() : job.model || "";

    if (!isBuiltin) {
      if (!hasOnlineWorker()) {
        return sendJson(res, 503, {
          ok: false,
          code: "WORKER_OFFLINE",
          error: "Antigravity Worker chưa online để tiếp tục job.",
          worker_status: getAiWorkerStatusSnapshot(),
        });
      }
      targetModel = targetModel || null;
    } else {
      const probe = await probeProvider(targetProvider, {
        force: false,
        workerStatus: getAiWorkerStatusSnapshot(),
        workspaceRoot: WORKSPACE_ROOT,
        engineDir: ENGINE_DIR,
      });
      if (probe.auth_status === "invalid") {
        return sendJson(res, 401, {
          ok: false,
          code: "AUTH_INVALID",
          error: probe.last_error || `API key của ${targetProvider} không hợp lệ.`,
        });
      }
      if (probe.auth_status === "quota_exhausted") {
        return sendJson(res, 429, {
          ok: false,
          code: "QUOTA_EXHAUSTED",
          error: probe.last_error || `Provider ${targetProvider} đang hết quota.`,
        });
      }
      if (!probe.ready) {
        return sendJson(res, 400, {
          ok: false,
          code: "PROVIDER_NOT_READY",
          error: probe.setup_hint || `Provider ${targetProvider} chưa sẵn sàng.`,
        });
      }
      if (!targetModel) {
        targetModel = probe.models?.[0]?.id || "";
      }
      if (!targetModel) {
        return sendJson(res, 400, { ok: false, code: "MODEL_REQUIRED", error: "Cần chọn model để tiếp tục." });
      }
    }

    if (body.custom_instructions !== undefined) {
      job.custom_instructions = String(body.custom_instructions || "")
        .trim()
        .slice(0, MAX_AI_CUSTOM_INSTRUCTIONS_LEN);
    }
    if (body.rewrite_notes || body.rewrite_note) {
      job.rewrite_notes = {
        ...(job.rewrite_notes || {}),
        ...normalizeRewriteNotes(body),
      };
    }

    const resumeOpts = parsePipelineOptionsFromBody(body, job);
    if (!resumeOpts.ok) {
      return sendJson(res, 400, {
        ok: false,
        code: resumeOpts.code,
        error: resumeOpts.error,
      });
    }
    Object.assign(job, resumeOpts.options);
    if (job.pause_after !== "none" || job.part_id) {
      job.auto_produce = false;
    }

    job.execution_mode = execution_mode;
    job.provider_id = isBuiltin ? targetProvider : "antigravity";
    job.model = targetModel;
    job.paused_at = null;
    job.paused_part_id = null;
    job.pause_reason = null;
    job.failed_episode = null;
    job.error = null;
    job.current_episode = remainingEps[0];
    job.updated_at = new Date().toISOString();

    if (isBuiltin) {
      saveLastSelection(
        { provider_id: job.provider_id, model: job.model, auto_produce: Boolean(job.auto_produce) },
        ENGINE_DIR
      );
      job.status = "queued";
      job.step = "resuming";
      acquireAiEpLocks(job, remainingEps);
      appendAiJobLog(
        job,
        `Resumed via ${job.provider_id}/${job.model} (${remainingEps.length} remaining: ${remainingEps.join(", ")}).`
      );
      persistAiQueue();
      broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
      setImmediate(() => void runBuiltinAiJobLoop(job.id));
    } else {
      job.status = "queued";
      job.step = "queued";
      job.claimed_by = null;
      job.claimed_model = null;
      acquireAiEpLocks(job, remainingEps);
      appendAiJobLog(job, `Re-queued remaining ${remainingEps.length} ep(s) for Antigravity Worker.`);
      persistAiQueue();
      broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
      wakeWaiters("job_resumed", job);
    }

    return sendJson(res, 200, { ok: true, job: sanitizeAiJobForApi(job) });
  }

  async function handleCancelAiJob(req, res) {
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
    const job = aiJobs.get(jobId);
    if (!job) {
      return sendJson(res, 404, { ok: false, error: "AI job not found" });
    }
    if (job.status !== "queued" && job.status !== "running" && job.status !== "paused") {
      return sendJson(res, 400, { ok: false, error: `Job is already ${job.status}` });
    }

    const wasRunning = job.status === "running";
    job.status = "cancelled";
    job.step = "cancelled";
    job.completed_at = new Date().toISOString();
    job.updated_at = job.completed_at;
    appendAiJobLog(job, "Cancelled from Studio UI.");
    releaseAiEpLocks(job);

    if (wasRunning) {
      for (const epId of job.episode_ids) {
        if ((job.completed_episodes || []).includes(epId)) continue;
        try {
          mutateEpisodeStateForJob(
            job.course,
            epId,
            (state, artifacts) => {
              if (state.scripting && state.scripting.status !== "completed") {
                state.scripting.status = artifacts.script ? "completed" : "pending";
              }
            },
            { type: "ai_job_cancelled", job_id: job.id }
          );
        } catch {
          // ignore missing state dir
        }
      }
    }

    persistAiQueue();
    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    return sendJson(res, 200, { ok: true, job: sanitizeAiJobForApi(job) });
  }

  function handleClearFinishedAiJobs(res) {
    let removed = 0;
    for (const [id, job] of aiJobs.entries()) {
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        aiJobs.delete(id);
        removed += 1;
      }
    }
    persistAiQueue();
    const remaining = listSortedAiJobs();
    broadcastSse("ai_jobs_cleared", { jobs: remaining, removed, ts: new Date().toISOString() });
    return sendJson(res, 200, { ok: true, removed, jobs: remaining });
  }

  async function handleManualPrompt(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const course = String(body.course || "").trim();
    const epId = String(
      body.episode_id ||
        body.episode ||
        (Array.isArray(body.episode_ids) ? body.episode_ids[0] : "") ||
        ""
    ).trim();

    if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(epId)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course or episode_id" });
    }

    const rawPartId = body.part_id ?? body.partId ?? null;
    const partId = rawPartId && String(rawPartId).trim() ? String(rawPartId).trim() : null;
    if (partId && !PART_ID_RE.test(partId)) {
      return sendJson(res, 400, { ok: false, error: `Invalid part_id "${partId}"` });
    }

    try {
      const ctx = loadEpisodeContextForRunner(course, epId);
      const partCtx = partId && ctx.existingParts?.[partId] ? ctx.existingParts[partId] : null;
      const rewriteNotes = normalizeRewriteNotes(body);
      const rewriteNote = rewriteNotes[epId] || rewriteNotes._shared || "";
      const pack = buildManualPromptPack({
        courseJson: ctx.courseJson,
        curriculumMd: ctx.curriculumMd,
        episodeMeta: ctx.epMeta,
        existingBrief: ctx.existingBrief,
        existingDialogue: partCtx?.dialogue_json || ctx.existingDialogue,
        existingScript: partCtx?.script_json || ctx.existingScript,
        existingNotes: partCtx?.notes_md || ctx.existingNotes,
        openRevisions: ctx.openRevisions,
        availableSvgs: ctx.availableSvgs,
        partId,
        maxPartDurationSec: body.max_part_duration_sec ? Number(body.max_part_duration_sec) : null,
        customInstructions: String(body.custom_instructions || "").trim(),
        rewriteNote,
      });

      return sendJson(res, 200, {
        ok: true,
        course,
        episode_id: epId,
        ...(partId ? { part_id: partId } : {}),
        ...pack,
      });
    } catch (err) {
      return sendJson(res, 404, { ok: false, error: err.message });
    }
  }

  async function handleManualSubmit(req, res) {
    let body;
    try {
      body = await readJsonBody(req, 4 * 1024 * 1024);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const course = String(body.course || "").trim();
    const episodeId = String(body.episode_id || body.episode || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episodeId)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course or episode_id" });
    }

    let rawPayload = body.script_json ?? body.scriptJson ?? body.payload ?? null;
    let notesMd = body.notes_md ?? body.notesMd ?? null;
    if (typeof rawPayload === "string") {
      try {
        const parsed = JSON.parse(stripMarkdownCodeFences(rawPayload));
        if (parsed && typeof parsed === "object" && parsed.script_json) {
          rawPayload = parsed.script_json;
          if (notesMd === null && parsed.notes_md !== undefined) {
            notesMd = parsed.notes_md;
          }
        } else {
          rawPayload = parsed;
        }
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: `Invalid JSON: ${err.message}` });
      }
    }

    if (!rawPayload || !Array.isArray(rawPayload.scenes) || rawPayload.scenes.length === 0) {
      return sendJson(res, 422, {
        ok: false,
        code: "SCRIPT_VALIDATION_FAILED",
        errors: ["script_json must contain a non-empty scenes[] array."],
        warnings: [],
      });
    }

    const validation = validateWithSvgs(rawPayload);
    if (!validation.valid) {
      return sendJson(res, 422, {
        ok: false,
        code: "SCRIPT_VALIDATION_FAILED",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    let ctx;
    try {
      ctx = loadEpisodeContextForRunner(course, episodeId);
    } catch (err) {
      return sendJson(res, 404, { ok: false, error: err.message });
    }

    const summaryNote = String(body.summary_note || "Kịch bản nhập thủ công qua Manual Web ($0)").trim();
    const state = saveEpisodeArtifactsAndState({
      course,
      episodeId,
      epDir: ctx.epDir,
      scriptPath: ctx.scriptPath,
      notesPath: ctx.notesPath,
      scriptJson: rawPayload,
      notesMd: notesMd !== null ? notesMd : ctx.existingNotes || undefined,
      ownerLabel: "manual_web",
      summaryNote,
      validation,
    });

    if (typeof scheduleStateBroadcast === "function") {
      scheduleStateBroadcast(course, `${episodeId}.json`);
    }

    return sendJson(res, 200, {
      ok: true,
      episode_id: episodeId,
      validation,
      state,
    });
  }

  async function handleWorkerHeartbeat(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    const result = recordWorkerHeartbeat(body);
    if (!result.ok) {
      return sendJson(res, result.status || 400, { ok: false, error: result.error });
    }
    return sendJson(res, 200, {
      ok: true,
      worker_status: result.worker_status,
      queued_jobs: Array.from(aiJobs.values()).filter((j) => j.status === "queued").length,
    });
  }

  async function handleWorkerWait(req, res) {
    if (!requireLoopback(req, res)) return;
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const hb = recordWorkerHeartbeat({ ...body, mode: body.mode || "watcher" });
    if (!hb.ok) {
      return sendJson(res, hb.status || 400, { ok: false, error: hb.error });
    }

    const nextJob = findNextQueuedAiJob();
    if (nextJob) {
      return sendJson(res, 200, {
        ok: true,
        wake: true,
        reason: "job_available",
        job: sanitizeAiJobForApi(nextJob),
        worker_status: hb.worker_status,
      });
    }

    const timeoutMs = Math.min(28_000, Math.max(1500, Number(body.timeout_ms) || 25_000));
    const waiter = {
      res,
      worker_id: String(body.worker_id || body.workerId),
      timer: null,
    };
    waiter.timer = setTimeout(() => {
      pendingWaiterResponses.delete(waiter);
      try {
        sendJson(res, 200, {
          ok: true,
          wake: false,
          reason: "timeout",
          job: null,
          worker_status: buildWorkerStatusSnapshot(),
        });
      } catch {
        // ignore
      }
    }, timeoutMs);

    pendingWaiterResponses.add(waiter);
    req.on("close", () => {
      if (pendingWaiterResponses.has(waiter)) {
        pendingWaiterResponses.delete(waiter);
        clearTimeout(waiter.timer);
      }
    });
  }

  async function handlePollAiJob(req, res) {
    if (!requireLoopback(req, res)) return;
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    if (body.worker_id || body.workerId) {
      const hb = recordWorkerHeartbeat(body);
      if (!hb.ok) {
        return sendJson(res, hb.status || 400, { ok: false, error: hb.error });
      }
    }
    const nextJob = findNextQueuedAiJob();
    return sendJson(res, 200, {
      ok: true,
      job: nextJob ? sanitizeAiJobForApi(nextJob) : null,
      queued_count: Array.from(aiJobs.values()).filter((j) => j.status === "queued").length,
      worker_status: getAiWorkerStatusSnapshot(),
    });
  }

  async function handleClaimAiJob(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const workerId = String(body.worker_id || body.workerId || "").trim();
    const hb = recordWorkerHeartbeat({ ...body, worker_id: workerId });
    if (!hb.ok) {
      return sendJson(res, hb.status || 400, { ok: false, error: hb.error });
    }

    let job = null;
    if (body.job_id) {
      job = aiJobs.get(String(body.job_id).trim()) || null;
      if (!job) {
        return sendJson(res, 404, { ok: false, error: `AI job "${body.job_id}" not found` });
      }
      if (job.status !== "queued") {
        return sendJson(res, 409, {
          ok: false,
          code: "JOB_ALREADY_CLAIMED",
          error: `AI job "${job.id}" has status "${job.status}"`,
          job: sanitizeAiJobForApi(job),
        });
      }
    } else {
      job = findNextQueuedAiJob();
    }

    if (!job) {
      return sendJson(res, 200, { ok: true, claimed: false, job: null });
    }

    const now = new Date().toISOString();
    const workerRec = aiWorkers.get(workerId);
    job.status = "running";
    job.step = "planning";
    job.progress = 5;
    job.claimed_by = workerId;
    job.claimed_model = String(body.model || workerRec?.model || "connected-agent");
    job.started_at = job.started_at || now;
    job.updated_at = now;
    const firstPendingEp = job.episode_ids.find((id) => !job.completed_episodes.includes(id)) || job.episode_ids[0];
    job.current_episode = firstPendingEp;
    appendAiJobLog(job, `Claimed by ${workerId} (${job.claimed_model}). Starting ${firstPendingEp}...`);

    if (firstPendingEp) {
      mutateEpisodeStateForJob(
        job.course,
        firstPendingEp,
        (state) => {
          state.scripting = state.scripting || {};
          state.scripting.status = "planning";
          state.scripting.started_at = state.scripting.started_at || now;
          state.scripting.owner = job.claimed_model;
          state.last_error = null;
        },
        { type: "ai_job_claimed", job_id: job.id, owner: job.claimed_model }
      );
    }

    persistAiQueue();
    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    return sendJson(res, 200, { ok: true, claimed: true, job: sanitizeAiJobForApi(job) });
  }

  async function handleProgressAiJob(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    const jobId = String(body.job_id || "").trim();
    const workerId = String(body.worker_id || "").trim();
    const job = aiJobs.get(jobId);
    if (!job) return sendJson(res, 404, { ok: false, error: "AI job not found" });
    if (job.status === "cancelled") {
      return sendJson(res, 409, { ok: false, code: "JOB_CANCELLED", error: "AI job was cancelled from UI" });
    }
    if (job.status !== "running") {
      return sendJson(res, 409, { ok: false, error: `AI job is not running (${job.status})` });
    }
    if (workerId && job.claimed_by && workerId !== job.claimed_by) {
      return sendJson(res, 403, { ok: false, error: `Job claimed by ${job.claimed_by}` });
    }
    if (workerId) recordWorkerHeartbeat({ ...body, worker_id: workerId, model: job.claimed_model });

    const epId = body.episode_id ? String(body.episode_id).trim() : job.current_episode;
    if (epId && job.episode_ids.includes(epId)) {
      job.current_episode = epId;
    }
    if (body.status && ["planning", "in_progress", "reviewing"].includes(body.status)) {
      job.step = body.status;
      if (epId && job.episode_ids.includes(epId)) {
        mutateEpisodeStateForJob(
          job.course,
          epId,
          (state) => {
            state.scripting = state.scripting || {};
            state.scripting.status = body.status;
            state.scripting.phase = body.phase ? String(body.phase) : state.scripting.phase;
            state.scripting.owner = job.claimed_model || workerId;
          },
          body.message
            ? { type: "ai_job_progress", job_id: job.id, phase: body.status, message: String(body.message) }
            : null
        );
      }
    } else if (body.phase) {
      job.step = String(body.phase);
    }
    if (body.progress !== undefined && Number.isFinite(Number(body.progress))) {
      job.progress = Math.max(0, Math.min(99, Math.round(Number(body.progress))));
    }
    job.updated_at = new Date().toISOString();
    if (body.message) appendAiJobLog(job, String(body.message));

    persistAiQueue();
    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    return sendJson(res, 200, { ok: true, job: sanitizeAiJobForApi(job) });
  }

  async function handleSubmitAiEpisode(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req, 4 * 1024 * 1024);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const jobId = String(body.job_id || "").trim();
    const workerId = String(body.worker_id || "").trim();
    const course = String(body.course || "").trim();
    const episodeId = String(body.episode_id || body.episode || "").trim();

    const job = aiJobs.get(jobId);
    if (!job) return sendJson(res, 404, { ok: false, error: "AI job not found" });
    if (job.status === "cancelled") {
      return sendJson(res, 409, { ok: false, code: "JOB_CANCELLED", error: "AI job was cancelled from UI" });
    }
    if (job.status !== "running") {
      return sendJson(res, 409, { ok: false, error: `AI job is not running (${job.status})` });
    }
    if (workerId && job.claimed_by && workerId !== job.claimed_by) {
      return sendJson(res, 403, { ok: false, error: `Job claimed by ${job.claimed_by}` });
    }
    if (workerId) recordWorkerHeartbeat({ ...body, worker_id: workerId, model: job.claimed_model });

    if (course !== job.course || !job.episode_ids.includes(episodeId)) {
      return sendJson(res, 400, {
        ok: false,
        error: `Tập ${course}/${episodeId} không thuộc phạm vi AI job "${jobId}".`,
      });
    }

    const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId]);
    const scriptPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "script.json"]);
    const notesPath = safeResolve(WORKSPACE_ROOT, [course, "episodes", episodeId, "notes.md"]);
    if (!epDir || !scriptPath || !notesPath) {
      return sendJson(res, 403, { ok: false, error: "Forbidden path" });
    }

    let scriptJson = body.script_json ?? body.scriptJson ?? null;
    if (typeof scriptJson === "string") {
      try {
        scriptJson = JSON.parse(scriptJson);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: `Invalid script_json string: ${err.message}` });
      }
    }
    if (!scriptJson) {
      if (!fs.existsSync(scriptPath)) {
        return sendJson(res, 400, {
          ok: false,
          error: `Không có payload script_json và cũng chưa thấy file trên đĩa tại ${scriptPath}`,
        });
      }
      try {
        scriptJson = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: `Lỗi đọc JSON từ đĩa: ${err.message}` });
      }
    }

    if (!Array.isArray(scriptJson?.scenes) || scriptJson.scenes.length === 0) {
      return sendJson(res, 422, {
        ok: false,
        code: "SCRIPT_VALIDATION_FAILED",
        errors: ["script.json must contain a non-empty scenes[] array."],
        warnings: [],
      });
    }

    const validation = validateWithSvgs(scriptJson);
    if (!validation.valid) {
      return sendJson(res, 422, {
        ok: false,
        code: "SCRIPT_VALIDATION_FAILED",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    const ownerLabel = job.claimed_model || workerId || "connected-agent";
    const summaryNote = String(body.summary_note || `Script biên soạn bởi AI (${ownerLabel})`).trim();
    const notesMd = body.notes_md ?? body.notesMd;
    const state = saveEpisodeArtifactsAndState({
      course,
      episodeId,
      epDir,
      scriptPath,
      notesPath,
      scriptJson,
      notesMd,
      ownerLabel,
      summaryNote,
      jobId: job.id,
      validation,
    });

    const now = new Date().toISOString();
    if (!job.completed_episodes.includes(episodeId)) {
      job.completed_episodes.push(episodeId);
    }
    const nextPending = job.episode_ids.find((id) => !job.completed_episodes.includes(id));
    job.current_episode = nextPending || episodeId;
    job.progress = Math.min(95, Math.round((job.completed_episodes.length / Math.max(1, job.episode_ids.length)) * 90));
    job.updated_at = now;
    appendAiJobLog(job, `Submitted ${episodeId} (${job.completed_episodes.length}/${job.episode_ids.length}).`);

    persistAiQueue();
    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    return sendJson(res, 200, {
      ok: true,
      episode_id: episodeId,
      validation,
      state,
      job: sanitizeAiJobForApi(job),
    });
  }

  async function handleCompleteAiJob(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const jobId = String(body.job_id || "").trim();
    const workerId = String(body.worker_id || "").trim();
    const job = aiJobs.get(jobId);
    if (!job) return sendJson(res, 404, { ok: false, error: "AI job not found" });
    if (job.status === "cancelled") {
      return sendJson(res, 409, { ok: false, code: "JOB_CANCELLED", error: "AI job was cancelled from UI" });
    }
    if (job.status !== "running") {
      return sendJson(res, 409, { ok: false, error: `AI job is not running (${job.status})` });
    }
    if (workerId && job.claimed_by && workerId !== job.claimed_by) {
      return sendJson(res, 403, { ok: false, error: `Job claimed by ${job.claimed_by}` });
    }
    if (workerId) recordWorkerHeartbeat({ ...body, worker_id: workerId, model: job.claimed_model });

    const missing = job.episode_ids.filter((id) => !job.completed_episodes.includes(id));
    if (missing.length > 0) {
      return sendJson(res, 400, {
        ok: false,
        error: `Chưa nộp kịch bản cho tất cả tập trong đợt. Còn thiếu: ${missing.join(", ")}`,
      });
    }

    const now = new Date().toISOString();
    releaseAiEpLocks(job);

    const spawned = [];
    if (job.auto_produce) {
      for (const epId of job.episode_ids) {
        const prodRes = enqueueProductionJob({
          course: job.course,
          episode: epId,
          ...(job.render_prefs || {}),
          mode: job.render_prefs?.mode || "tts_and_render",
        });
        if (prodRes.ok && prodRes.job?.id) {
          spawned.push(prodRes.job.id);
          appendAiJobLog(job, `Auto-queued production ${prodRes.job.id} for ${epId}.`);
        } else {
          appendAiJobLog(job, `Auto-produce skipped for ${epId}: ${prodRes.error}`);
        }
      }
    }

    job.spawned_production_jobs = spawned;
    job.status = "completed";
    job.step = "done";
    job.progress = 100;
    job.summary = body.summary ? String(body.summary).trim() : `Hoàn tất ${job.episode_ids.length} tập.`;
    job.completed_at = now;
    job.updated_at = now;
    appendAiJobLog(job, job.summary);

    persistAiQueue();
    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    return sendJson(res, 200, {
      ok: true,
      job: sanitizeAiJobForApi(job),
      spawned_production_jobs: spawned,
    });
  }

  async function handleFailAiJob(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const jobId = String(body.job_id || "").trim();
    const workerId = String(body.worker_id || "").trim();
    const job = aiJobs.get(jobId);
    if (!job) return sendJson(res, 404, { ok: false, error: "AI job not found" });
    if (workerId) recordWorkerHeartbeat({ ...body, worker_id: workerId, model: job.claimed_model });

    const now = new Date().toISOString();
    const errText = String(body.error || "Worker reported failure").trim();
    job.status = "failed";
    job.step = "error";
    job.error = errText;
    job.completed_at = now;
    job.updated_at = now;
    appendAiJobLog(job, `Failed: ${errText}`);
    releaseAiEpLocks(job);

    for (const epId of job.episode_ids) {
      if (job.completed_episodes.includes(epId)) continue;
      try {
        mutateEpisodeStateForJob(
          job.course,
          epId,
          (state) => {
            if (state.scripting && state.scripting.status !== "completed") {
              state.scripting.status = "needs_revision";
              state.last_error = errText;
            }
          },
          { type: "ai_job_failed", job_id: job.id, error: errText }
        );
      } catch {
        // ignore missing course dir
      }
    }

    persistAiQueue();
    broadcastSse("ai_job_update", { job: sanitizeAiJobForApi(job) });
    return sendJson(res, 200, { ok: true, job: sanitizeAiJobForApi(job) });
  }

  function handleGetAiContext(req, res, parsedUrl) {
    if (!requireLoopback(req, res)) return;
    const course = String(parsedUrl.searchParams.get("course") || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(course)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course identifier" });
    }
    const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
    if (!courseDir || !fs.existsSync(path.join(courseDir, "course.json"))) {
      return sendJson(res, 404, { ok: false, error: `Course "${course}" not found` });
    }

    const courseJson = loadCourseJson(courseDir);
    const allMetas = flattenCourseEpisodes(courseJson);
    const epsParam = String(parsedUrl.searchParams.get("episodes") || "").trim();
    const filterSet = epsParam
      ? new Set(epsParam.split(",").map((s) => s.trim()).filter(Boolean))
      : null;
    const targetMetas = filterSet ? allMetas.filter((m) => filterSet.has(m.id)) : allMetas;
    const openRevs = listRevisions(WORKSPACE_ROOT, course, { status: "open" });

    let curriculumMd = "";
    const curriculumPath = path.join(courseDir, "curriculum.md");
    if (fs.existsSync(curriculumPath)) {
      curriculumMd = fs.readFileSync(curriculumPath, "utf-8");
    }

    const stateDir = path.join(courseDir, "state");
    const episodes = targetMetas.map((meta) => {
      const epDir = path.join(courseDir, "episodes", meta.id);
      const scriptPath = path.join(epDir, "script.json");
      const notesPath = path.join(epDir, "notes.md");
      let existingScript = null;
      if (fs.existsSync(scriptPath)) {
        try {
          existingScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
        } catch {
          existingScript = null;
        }
      }
      const existingNotes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : "";
      const epState = fs.existsSync(stateDir) ? readEpisodeState(stateDir, meta.id) : null;
      return {
        ...meta,
        state: epState,
        script_path: scriptPath,
        notes_path: notesPath,
        existing_script: existingScript,
        existing_notes: existingNotes,
        open_revisions: openRevs.filter((r) => r.episode_id === meta.id),
      };
    });

    return sendJson(res, 200, {
      ok: true,
      course,
      course_json: courseJson,
      curriculum_md: curriculumMd,
      supported_visual_types: [...SUPPORTED_VISUAL_TYPES],
      available_svgs: loadSvgCatalog(),
      open_revisions: openRevs,
      episodes,
    });
  }

  async function handleValidateScriptEndpoint(req, res) {
    if (!requireLoopback(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    let scriptJson = body.script_json ?? body.scriptJson ?? null;
    if (typeof scriptJson === "string") {
      try {
        scriptJson = JSON.parse(scriptJson);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: `Invalid JSON string: ${err.message}` });
      }
    }
    if (!scriptJson && body.course && (body.episode_id || body.episode)) {
      const c = String(body.course).trim();
      const e = String(body.episode_id || body.episode).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(c) || !/^[A-Za-z0-9_-]+$/.test(e)) {
        return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
      }
      const sp = safeResolve(WORKSPACE_ROOT, [c, "episodes", e, "script.json"]);
      if (!sp || !fs.existsSync(sp)) {
        return sendJson(res, 404, { ok: false, error: `script.json not found for ${c}/${e}` });
      }
      scriptJson = JSON.parse(fs.readFileSync(sp, "utf-8"));
    }
    if (!scriptJson || typeof scriptJson !== "object") {
      return sendJson(res, 400, { ok: false, error: "Provide script_json or { course, episode_id }" });
    }
    const validation = validateWithSvgs(scriptJson);
    return sendJson(res, 200, { ok: true, validation });
  }

  async function handleSavePipelineRouting(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    try {
      const routingInput =
        body && typeof body.pipeline_routing === "object" && !Array.isArray(body.pipeline_routing)
          ? body.pipeline_routing
          : body;
      const pipeline_routing = savePipelineRouting(routingInput, ENGINE_DIR);
      return sendJson(res, 200, { ok: true, pipeline_routing });
    } catch (err) {
      return sendJson(res, err?.statusCode || 400, { ok: false, error: err?.message || String(err) });
    }
  }

  function startTimersAndLoad() {
    loadAiQueueFromDisk();
    const timer = setInterval(() => sweepExpiredWorkers({ broadcast: true }), WORKER_SWEEP_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  function handleRequest(req, res, pathname, parsedUrl) {
    if (req.method === "GET" && pathname === "/api/ai/status") {
      handleGetAiStatus(res);
      return true;
    }
    if (req.method === "GET" && pathname === "/api/ai/providers") {
      void handleGetAiProviders(res, parsedUrl);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/providers/credentials") {
      void handlePostProviderCredentials(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/providers/test") {
      void handleTestProvider(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/preferences/routing") {
      void handleSavePipelineRouting(req, res);
      return true;
    }
    if (req.method === "GET" && pathname === "/api/ai/jobs") {
      handleGetAiJobs(res, parsedUrl);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs") {
      void handleCreateAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/resume") {
      void handleResumeAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/cancel") {
      void handleCancelAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/clear") {
      handleClearFinishedAiJobs(res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/manual-prompt") {
      void handleManualPrompt(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/manual-submit") {
      void handleManualSubmit(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/worker/heartbeat") {
      void handleWorkerHeartbeat(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/worker/wait") {
      void handleWorkerWait(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/poll") {
      void handlePollAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/claim") {
      void handleClaimAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/progress") {
      void handleProgressAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/submit-episode") {
      void handleSubmitAiEpisode(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/complete") {
      void handleCompleteAiJob(req, res);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/jobs/fail") {
      void handleFailAiJob(req, res);
      return true;
    }
    if (req.method === "GET" && pathname === "/api/ai/context") {
      handleGetAiContext(req, res, parsedUrl);
      return true;
    }
    if (req.method === "POST" && pathname === "/api/ai/validate-script") {
      void handleValidateScriptEndpoint(req, res);
      return true;
    }
    return false;
  }

  return {
    startTimersAndLoad,
    handleRequest,
    requireLoopback,
    getAiWorkerStatusSnapshot,
    listSortedAiJobs,
  };
}
