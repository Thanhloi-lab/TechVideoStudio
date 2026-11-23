import { resolveProviderExecutionConfig } from "./providers.mjs";
import { validateScriptDiagrams, validateSingleScene } from "../src/diagram_validator.mjs";
import { getSchemaPromptSpec } from "../src/template_schema.mjs";
import { SUPPORTED_VISUAL_TYPES } from "../src/motion/kernel.mjs";

const DEFAULT_LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.VIDEO_MAKER_AI_TIMEOUT_MS) || 120_000);
const MAX_SELF_REPAIR_RETRIES = 2;
export const MAX_CONTENT_REVIEW_ROUNDS = 2;
export const DEFAULT_MAX_PART_DURATION_SEC = 300;

export const VALID_GENERATION_MODES = new Set(["deep_course", "three_stage"]);
const LEGACY_MODE_ALIASES = new Set([
  "auto",
  "two_pass",
  "single_pass",
  "storyboard_only",
  "three_stage",
  "deep_course",
]);
export const VALID_PAUSE_AFTER = new Set(["none", "brief", "part_review", "dialogue"]);
export const VALID_START_FROM = new Set(["brief", "dialogue", "visual"]);
const VALID_PART_SET = new Set(["problem", "architecture", "setup", "exam_tips"]);

const CAUSAL_MECHANICS = Object.freeze([
  "blur-materialize",
  "wire-draw",
  "arc-emission",
  "width-push",
  "squash-drop",
  "typographic-strike",
]);

const ALL_ELEVEN_VISUAL_TYPES = Object.freeze([
  "architecture",
  "console_setup",
  "code_cli",
  "exam_tips",
  "comparison_matrix",
  "timeline_flow",
  "kpi_metrics",
  "sequence_diagram",
  "memory_layout",
  "code_diff",
  "concept_breakdown",
]);

const EXTRA_FOUR_TEMPLATES_SPEC = [
  "   - `sequence_diagram`:",
  "     `{ badge?, subtitle?, actors: (2..5)[{ id, label, sublabel?, icon?, tone? }], messages: (1..10)[{ id?, from, to, label, detail?, style?: 'solid'|'dashed'|'danger'|'async', badge?, cue_sentence?, cue_text?, progress_start, progress_end }], highlights?: [{ label, from_msg?, to_msg?, tone?: 'danger'|'warn'|'info'|'success', cue_sentence?, show_at_progress }] }`.",
  "   - `memory_layout`:",
  "     `{ badge?, subtitle?, complexity_badge?, lanes: (1..4)[{ id, label, sublabel?, tone?, cells: (1..8)[{ id, label, value?, subtext?, state?: 'idle'|'active'|'match'|'write'|'danger' }] }], steps: (1..8)[{ label, callout?, complexity?, highlight_cells?: [{ lane_id, cell_id, state }], pointers?: [{ from_lane, from_cell, to_lane, to_cell, label?, tone? }], cue_sentence?, cue_text?, progress_start, progress_end }] }`.",
  "   - `code_diff`:",
  "     `{ badge?, subtitle?, language?, left_title, left_badge?, left_lines: (1..16)string[], right_title, right_badge?, right_lines: (1..16)string[], focus_steps: (1..6)[{ left_lines?: number[], right_lines?: number[], callout, consequence?, fix_reason?, tone?: 'danger'|'success'|'info', cue_sentence?, cue_text?, progress_start, progress_end }] }`.",
  "   - `concept_breakdown`:",
  "     `{ badge?, subtitle?, mode?: 'anatomy'|'decision'|'chapter', core: { label, sublabel?, badge?, code_snippet?, tone? }, branches: (2..6)[{ id, label, role_badge?, detail, example?, tone?, cue_sentence?, cue_text?, progress_start, progress_end }], takeaway?: { label?, text, show_at_progress } }`.",
].join("\n");

function sanitizeErr(text) {
  return String(text || "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1REDACTED")
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, "REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1REDACTED")
    .trim()
    .slice(0, 600);
}

/**
 * Normalize any incoming generation mode string (including legacy aliases) to "deep_course".
 */
export function normalizeGenerationMode(mode) {
  if (mode === undefined || mode === null || String(mode).trim() === "") {
    return "deep_course";
  }
  const clean = String(mode).trim().toLowerCase();
  return LEGACY_MODE_ALIASES.has(clean) ? "deep_course" : "deep_course";
}

export function classifyProviderError(status, bodyText = "") {
  const numStatus = Number(status) || 0;
  const rawText = sanitizeErr(bodyText);
  const lower = rawText.toLowerCase();

  if (
    numStatus === 429 ||
    numStatus === 402 ||
    /insufficient_quota|rate_limit|rate limit|quota_exceeded|exceeded your current quota|credit balance|billing|out of credits|resource_exhausted/.test(
      lower
    )
  ) {
    const err = new Error(rawText || `Provider quota/rate limit reached (HTTP ${numStatus || 429}).`);
    err.code = "QUOTA_EXHAUSTED";
    err.status = numStatus || 429;
    return err;
  }

  if (
    numStatus === 401 ||
    numStatus === 403 ||
    /invalid_api_key|incorrect api key|authentication_error|permission_denied|api key not valid|unauthorized/.test(
      lower
    )
  ) {
    const err = new Error(rawText || `Provider authentication failed (HTTP ${numStatus || 401}).`);
    err.code = "AUTH_INVALID";
    err.status = numStatus || 401;
    return err;
  }

  const err = new Error(rawText || `Provider request failed (HTTP ${numStatus || "network"}).`);
  err.code = "PROVIDER_ERROR";
  err.status = numStatus;
  return err;
}

export function stripMarkdownCodeFences(text) {
  const s = String(text || "").trim();
  const fenced = s.match(/^```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (fenced) return fenced[1].trim();
  const innerBlock = s.match(/```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n```/);
  if (innerBlock) return innerBlock[1].trim();
  return s;
}

function parseJsonObjectLoose(rawText) {
  const cleaned = stripMarkdownCodeFences(rawText);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (firstErr) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        throw new Error(`Invalid JSON output: ${firstErr.message}`);
      }
    } else {
      throw new Error(`Invalid JSON output: ${firstErr.message}`);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI output JSON must be an object.");
  }
  return parsed;
}

export function parseAiScriptPayload(rawText, fallbackNotes = "") {
  const parsed = parseJsonObjectLoose(rawText);

  let scriptJson = parsed.script_json ?? parsed.scriptJson ?? null;
  const notesMd = parsed.notes_md ?? parsed.notesMd ?? null;

  if (!scriptJson && Array.isArray(parsed.scenes)) {
    scriptJson = parsed;
  }
  if (!scriptJson || typeof scriptJson !== "object") {
    throw new Error('JSON output must contain a "script_json" object with a non-empty "scenes" array.');
  }
  if (!Array.isArray(scriptJson.scenes) || scriptJson.scenes.length === 0) {
    throw new Error("script_json.scenes must be a non-empty array.");
  }

  return {
    script_json: scriptJson,
    notes_md: notesMd !== null && notesMd !== undefined ? String(notesMd) : String(fallbackNotes || ""),
  };
}

/**
 * Compact curriculum.md around the target stage/episode (~1500-2500 chars).
 */
export function extractRelevantCurriculumContext(curriculumMd = "", episodeMeta = {}, maxChars = 2400) {
  const raw = String(curriculumMd || "").trim();
  if (!raw) return "";
  if (raw.length <= maxChars) return raw;

  const epId = String(episodeMeta.id || episodeMeta.episode_id || "").trim();
  const epTitle = String(episodeMeta.title || "").trim();
  const stageTitle = String(episodeMeta.stage_title || "").trim();
  const stageNum = episodeMeta.stage !== undefined && episodeMeta.stage !== null ? String(episodeMeta.stage).trim() : "";

  const lines = raw.split(/\r?\n/);

  const overviewLines = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) break;
    overviewLines.push(line);
  }
  const overview = overviewLines.join("\n").trim().slice(0, 420);

  const sections = [];
  let cur = { heading: "", lines: [] };
  for (const line of lines) {
    if (/^#{2,3}\s+/.test(line)) {
      if (cur.lines.length > 0 || cur.heading) sections.push(cur);
      cur = { heading: line, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.length > 0 || cur.heading) sections.push(cur);

  const epNum = episodeMeta.number ? String(episodeMeta.number) : "";
  const epNumPad = epNum ? epNum.padStart(2, "0") : "";
  const scored = sections.map((sec, idx) => {
    const body = sec.lines.join("\n");
    const lower = body.toLowerCase();
    let score = 0;
    if (epId && lower.includes(epId.toLowerCase())) score += 100;
    if (epTitle && epTitle.length >= 4 && lower.includes(epTitle.toLowerCase())) score += 60;
    if (stageTitle && stageTitle.length >= 4 && lower.includes(stageTitle.toLowerCase())) score += 40;
    if (stageNum && new RegExp(`(?:chặng|stage)\\s*${stageNum}\\b`, "i").test(sec.heading)) score += 35;
    if (epNum && new RegExp(`(?:ep\\s*0?${epNum}|tập\\s*0?${epNum}|#${epNum}\\b|ep${epNumPad})`, "i").test(lower)) score += 25;
    return { idx, sec, body, score };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const best = scored[0];

  if (!best || best.score === 0) {
    const cut = raw.slice(0, maxChars);
    const lastNl = cut.lastIndexOf("\n");
    return (lastNl > maxChars * 0.6 ? cut.slice(0, lastNl) : cut).trim();
  }

  const budgetForSection = Math.max(800, maxChars - (overview ? overview.length + 12 : 0));
  let focusedBody = best.body;

  if (focusedBody.length > budgetForSection) {
    const secLines = best.sec.lines;
    const header = secLines[0] || "";
    const matchIdx = secLines.findIndex(
      (l, i) =>
        i > 0 &&
        ((epId && l.toLowerCase().includes(epId.toLowerCase())) ||
          (epTitle && epTitle.length >= 4 && l.toLowerCase().includes(epTitle.toLowerCase())))
    );
    if (matchIdx > 0) {
      const startLine = Math.max(1, matchIdx - 6);
      const picked = [header];
      let used = header.length;
      for (let i = startLine; i < secLines.length; i++) {
        const nextLen = used + secLines[i].length + 1;
        if (nextLen > budgetForSection) break;
        picked.push(secLines[i]);
        used = nextLen;
      }
      focusedBody = picked.join("\n");
    } else {
      focusedBody = focusedBody.slice(0, budgetForSection);
    }
  }

  const parts = [];
  if (overview && !focusedBody.includes(overview.slice(0, 60))) {
    parts.push(overview);
  }
  parts.push(focusedBody);
  return parts.join("\n\n").slice(0, maxChars).trim();
}

function resolveEpisodeDefaults(courseJson = {}, episodeMeta = {}) {
  return {
    courseId: courseJson.course || courseJson.id || "",
    epId: episodeMeta.id || episodeMeta.episode_id || "",
    epNum: episodeMeta.number || 1,
    epTitle: episodeMeta.title || episodeMeta.id || episodeMeta.episode_id || "",
    ttsProfile: courseJson.tts_profile || "auto-vi",
    ttsVoice: courseJson.tts_voice || "vi-VN-HoaiMyNeural",
    ttsRate: courseJson.tts_rate || "+6%",
  };
}

function resolveMaxPartDurationSec(explicitMax, courseJson = {}) {
  const candidate = Number(explicitMax ?? courseJson?.max_part_duration_sec ?? DEFAULT_MAX_PART_DURATION_SEC);
  if (!Number.isFinite(candidate) || candidate < 60) return DEFAULT_MAX_PART_DURATION_SEC;
  return Math.min(600, Math.round(candidate));
}

function formatOpenRevisionsLines(openRevisions = []) {
  if (!Array.isArray(openRevisions) || openRevisions.length === 0) return [];
  return [
    "",
    "# Open Revision Tickets",
    ...openRevisions.map(
      (r) => `- [${r.id}] (${r.scope}${r.scene_id ? ` / ${r.scene_id}` : ""}): ${r.description}`
    ),
  ];
}

function appendRewriteContext(userParts, { existingScript, existingNotes, openRevisions, rewriteNote }) {
  const hasRewriteContext =
    Boolean(existingScript) ||
    Boolean(rewriteNote && rewriteNote.trim()) ||
    (Array.isArray(openRevisions) && openRevisions.length > 0);

  if (!hasRewriteContext) return;

  userParts.push(
    "",
    "# MANDATORY REWRITE INSTRUCTIONS",
    "You are revising/rewriting an existing episode script. Preserve valid scenes, structure, and strong visual layouts where appropriate, and strictly apply the requested changes below:"
  );
  if (rewriteNote && rewriteNote.trim()) {
    userParts.push("", "## Requested Changes (Rewrite Note)", rewriteNote.trim());
  }
  userParts.push(...formatOpenRevisionsLines(openRevisions));
  if (existingScript) {
    userParts.push("", "## Existing script.json", JSON.stringify(existingScript, null, 2).slice(0, 18000));
  }
  if (existingNotes) {
    userParts.push("", "## Existing notes.md", String(existingNotes).slice(0, 4000));
  }
}

function buildSharedTargetHeader({
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  customInstructions = "",
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
}) {
  const { courseId, epId, epNum, epTitle } = resolveEpisodeDefaults(courseJson, episodeMeta);
  const parts = [
    "# Target Episode",
    `- Course: ${courseId} (${courseJson.title || courseId})`,
    `- Episode ID: ${epId} (#${epNum})`,
    `- Title: ${epTitle}`,
    episodeMeta.stage_title ? `- Stage: ${episodeMeta.stage_title}` : "",
    episodeMeta.estimated_duration_min ? `- Estimated Total Duration: ${episodeMeta.estimated_duration_min} min` : "",
    episodeMeta.estimated_parts ? `- Estimated Parts: ${episodeMeta.estimated_parts} part(s) (each <= ${maxPartDurationSec}s)` : `- Max Part Duration: ${maxPartDurationSec}s`,
    episodeMeta.duration_target ? `- Duration Target: ${episodeMeta.duration_target}` : "",
  ].filter(Boolean);

  if (Array.isArray(episodeMeta.prerequisites) && episodeMeta.prerequisites.length > 0) {
    parts.push(`- Prerequisites: ${episodeMeta.prerequisites.join("; ")}`);
  }
  if (Array.isArray(episodeMeta.learning_objectives) && episodeMeta.learning_objectives.length > 0) {
    parts.push("", "## Learning Objectives", ...episodeMeta.learning_objectives.map((o) => `- ${o}`));
  }
  if (Array.isArray(episodeMeta.must_cover_concepts) && episodeMeta.must_cover_concepts.length > 0) {
    parts.push("", "## Mandatory Must-Cover Concepts (100% Required)", ...episodeMeta.must_cover_concepts.map((c) => `- ${c}`));
  }

  const compactCurriculum = extractRelevantCurriculumContext(curriculumMd, episodeMeta);
  if (compactCurriculum) {
    parts.push("", "# Course Curriculum Context", compactCurriculum);
  }
  if (customInstructions) {
    parts.push("", "# Additional User Instructions", customInstructions);
  }
  return parts;
}

/**
 * Compute spoken word count across dialogue.json beats[].display_text.
 */
export function computeDialogueWordCount(dialogueJson) {
  const beats = Array.isArray(dialogueJson?.beats) ? dialogueJson.beats : [];
  let total = 0;
  for (const b of beats) {
    const text = String(b?.display_text || b?.narration || "").trim();
    if (!text) continue;
    total += text.split(/\s+/).filter(Boolean).length;
  }
  return total;
}

function buildPartHandoff(dialogueJson, partSpec = {}) {
  const beats = Array.isArray(dialogueJson?.beats) ? dialogueJson.beats : [];
  const joinedText = beats.map((b) => String(b?.display_text || "").trim()).filter(Boolean).join(" ");
  const sentences = joinedText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const finalSentences = sentences.slice(-2);

  const identifiers = new Set();
  for (const b of beats) {
    for (const w of Array.isArray(b?.highlight_words) ? b.highlight_words : []) {
      const clean = String(w || "").trim();
      if (clean) identifiers.add(clean);
    }
  }

  return {
    part_id: partSpec?.part_id || dialogueJson?.part_id || "part_01",
    title: partSpec?.title || dialogueJson?.title || "",
    covered_concepts: Array.isArray(partSpec?.must_cover_concepts) ? [...partSpec.must_cover_concepts] : [],
    key_terms_and_identifiers: Array.from(identifiers).slice(0, 20),
    exit_bridge: String(partSpec?.exit_bridge || "").trim(),
    final_sentences: finalSentences,
  };
}

function normalizeStringArray(val) {
  if (!Array.isArray(val)) return [];
  return val.map((item) => String(item || "").trim()).filter(Boolean);
}

/**
 * Normalize a Stage 1 Content Brief object (supporting both multi-part deep_course and legacy single-part briefs).
 */
export function normalizeBriefObject(
  rawBrief,
  { courseJson = {}, episodeMeta = {}, maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC } = {}
) {
  if (!rawBrief || typeof rawBrief !== "object") {
    throw new Error("Stage 1 brief must be an object.");
  }
  const { courseId, epId, epNum, epTitle } = resolveEpisodeDefaults(courseJson, episodeMeta);
  const maxPartSec = resolveMaxPartDurationSec(maxPartDurationSec, courseJson);

  const normalizeBeat = (b, i, fallbackPartId = null) => {
    const part = VALID_PART_SET.has(b?.part) ? b.part : "architecture";
    const claim = String(b?.key_claim || b?.goal || "").trim();
    if (!claim) {
      throw new Error(`teaching_beats[${i}] must have a non-empty key_claim or goal.`);
    }
    const out = {
      id: String(b?.id || `beat_${String(i + 1).padStart(2, "0")}`).trim(),
      part,
      goal: String(b?.goal || claim).trim(),
      key_claim: claim,
      concrete_proof_anchor: String(b?.concrete_proof_anchor || "").trim(),
    };
    const pid = String(b?.part_id || fallbackPartId || "").trim();
    if (pid) out.part_id = pid;
    return out;
  };

  const rawTopBeats = Array.isArray(rawBrief.teaching_beats) ? rawBrief.teaching_beats : [];
  const rawParts = Array.isArray(rawBrief.parts) ? rawBrief.parts : [];

  let normalizedParts = [];
  if (rawParts.length > 0) {
    normalizedParts = rawParts.map((p, pIdx) => {
      const partNumber = Number.isFinite(Number(p?.part_number)) && Number(p.part_number) > 0
        ? Math.round(Number(p.part_number))
        : pIdx + 1;
      const partId = String(p?.part_id || p?.id || `part_${String(partNumber).padStart(2, "0")}`).trim();
      const rawDur = Number(p?.target_duration_sec);
      const targetDur = Number.isFinite(rawDur) && rawDur > 0 ? Math.round(rawDur) : Math.min(maxPartSec, 270);
      const partBeatsRaw = Array.isArray(p?.teaching_beats) ? p.teaching_beats : [];
      const partBeats = partBeatsRaw.map((b, bIdx) => normalizeBeat(b, bIdx, partId));

      return {
        part_id: partId,
        part_number: partNumber,
        title: String(p?.title || `${epTitle} (${partId})`).trim(),
        target_duration_sec: targetDur,
        must_cover_concepts: normalizeStringArray(p?.must_cover_concepts),
        entry_bridge: String(p?.entry_bridge || "").trim(),
        exit_bridge: String(p?.exit_bridge || "").trim(),
        teaching_beats: partBeats,
      };
    });

    // If parts[] had empty teaching_beats but top-level teaching_beats was provided, distribute them
    const totalPartBeats = normalizedParts.reduce((sum, p) => sum + p.teaching_beats.length, 0);
    if (totalPartBeats === 0 && rawTopBeats.length > 0) {
      const normalizedTop = rawTopBeats.map((b, i) => normalizeBeat(b, i));
      const perPart = Math.max(1, Math.ceil(normalizedTop.length / normalizedParts.length));
      normalizedParts.forEach((part, pIdx) => {
        const byId = normalizedTop.filter((b) => b.part_id === part.part_id);
        part.teaching_beats =
          byId.length > 0
            ? byId
            : normalizedTop.slice(pIdx * perPart, (pIdx + 1) * perPart).map((b) => ({ ...b, part_id: part.part_id }));
      });
    }
  } else {
    if (rawTopBeats.length === 0) {
      throw new Error('Stage 1 brief JSON must contain "brief.parts[].teaching_beats" or "brief.teaching_beats" as a non-empty array.');
    }
    const normalizedTop = rawTopBeats.map((b, i) => normalizeBeat(b, i, "part_01"));
    const estDur = Math.min(maxPartSec, Math.max(120, normalizedTop.length * 45));
    normalizedParts = [
      {
        part_id: "part_01",
        part_number: 1,
        title: String(rawBrief.title || epTitle || "Part 1").trim(),
        target_duration_sec: estDur,
        must_cover_concepts: normalizeStringArray(episodeMeta.must_cover_concepts),
        entry_bridge: String(rawBrief.hook_angle?.conflict_statement || "").trim(),
        exit_bridge: "",
        teaching_beats: normalizedTop,
      },
    ];
  }

  const flattenedBeats = normalizedParts.flatMap((p) => p.teaching_beats);
  if (flattenedBeats.length === 0) {
    throw new Error('Stage 1 brief JSON must contain at least one teaching_beat across "parts[]".');
  }

  const rawCanon = rawBrief.episode_canon && typeof rawBrief.episode_canon === "object" ? rawBrief.episode_canon : {};
  const sharedGlossary = Array.isArray(rawCanon.shared_glossary)
    ? rawCanon.shared_glossary
    : rawCanon.shared_glossary && typeof rawCanon.shared_glossary === "object"
      ? rawCanon.shared_glossary
      : [];
  const totalPartsDur = normalizedParts.reduce((acc, p) => acc + (Number(p.target_duration_sec) || 0), 0);
  const rawCanonDur = Number(rawCanon.target_total_duration_sec);
  const episodeCanon = {
    shared_glossary: sharedGlossary,
    running_example: String(rawCanon.running_example || "").trim(),
    audience_level: String(
      rawCanon.audience_level ||
        (Array.isArray(rawCanon.target_audience_assumptions)
          ? rawCanon.target_audience_assumptions.join("; ")
          : "") ||
        ""
    ).trim(),
    target_total_duration_sec:
      Number.isFinite(rawCanonDur) && rawCanonDur > 0 ? Math.round(rawCanonDur) : totalPartsDur,
  };
  if (Array.isArray(rawCanon.target_audience_assumptions)) {
    episodeCanon.target_audience_assumptions = rawCanon.target_audience_assumptions;
  }

  return {
    course_id: String(rawBrief.course_id || courseId || "").trim(),
    episode_id: String(rawBrief.episode_id || epId || "").trim(),
    episode_number: Number.isFinite(Number(rawBrief.episode_number)) ? Number(rawBrief.episode_number) : epNum,
    title: String(rawBrief.title || epTitle || "").trim(),
    subtitle: String(rawBrief.subtitle || "").trim(),
    hook_angle:
      rawBrief.hook_angle && typeof rawBrief.hook_angle === "object"
        ? rawBrief.hook_angle
        : { family: "conflict", conflict_statement: "", stakes: "" },
    narrative_arc:
      rawBrief.narrative_arc && typeof rawBrief.narrative_arc === "object"
        ? rawBrief.narrative_arc
        : { setup: "", escalation: "", reversal: "" },
    episode_canon: episodeCanon,
    parts: normalizedParts,
    teaching_beats: flattenedBeats,
  };
}

/**
 * Stage 1 (Content Brief & Multi-Part Blueprint): decides WHAT to teach across reviewable parts (<= maxPartDurationSec)
 * with episode_canon continuity, WITHOUT touching visual templates, coordinates, CSS, or GSAP.
 */
export function buildContentBriefPrompt({
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  existingBrief = null,
  existingScript = null,
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
  rewriteInstructions = "",
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
}) {
  const { courseId, epId, epNum, epTitle } = resolveEpisodeDefaults(courseJson, episodeMeta);
  const maxPartSec = resolveMaxPartDurationSec(maxPartDurationSec, courseJson);
  const estPartsHint = Number(episodeMeta.estimated_parts) || null;
  const estMinHint = Number(episodeMeta.estimated_duration_min) || null;

  const systemPrompt = [
    "You are the Lead Pedagogical Content Architect (Stage 1: Content Brief & Deep-Dive Multi-Part Blueprint).",
    "Your ONLY responsibility is designing a thorough, deep-dive course episode whose total duration is decided by pedagogical depth (no artificial 3-5 minute episode cap!) and splitting it into sequential, independently reviewable parts.",
    "STRICT PROHIBITION: Do NOT mention visual templates, visual_type, nodes, edges, zones, coordinates, CSS, or GSAP.",
    "",
    "### Deep-Dive Brief Rules:",
    "1. Hook Angle: Open with a concrete production outage, latency/cost collision, or myth-bust (NEVER greetings or dictionary definitions).",
    "2. Narrative Arc (Setup -> Escalation -> Reversal): Sequence ideas causally across the 4 blueprint phases (`problem`, `architecture`, `setup`, `exam_tips`).",
    "3. Episode Canon (`episode_canon`): Lock a shared glossary (`shared_glossary`), ONE concrete end-to-end `running_example` (real service/dataset/workload reused across every part), `audience_level`, and `target_total_duration_sec`.",
    `4. Sequential Parts (\`parts[]\`): Split the episode into 1..N parts (${estPartsHint ? `target ~${estPartsHint} parts` : "size naturally by topic depth"}${estMinHint ? `, ~${estMinHint} minutes total` : ""}), where EVERY part has \`target_duration_sec <= ${maxPartSec}\` (${Math.round(maxPartSec / 60)} min max per reviewable part).`,
    "   - Distribute 100% of the episode's `must_cover_concepts` across `parts[].must_cover_concepts`.",
    "   - Give every part an explicit `entry_bridge` (connecting seamlessly from the previous part's `exit_bridge`) and `exit_bridge` (handing off cleanly to the next part without premature outro).",
    "   - Every `teaching_beats[]` item inside each part MUST have a concrete proof anchor (real CLI command, config, benchmark, byte/latency trace, or production/exam trap).",
    "",
    "Return STRICT VALID JSON ONLY matching:",
    JSON.stringify(
      {
        brief: {
          course_id: courseId,
          episode_id: epId,
          episode_number: epNum,
          title: epTitle,
          subtitle: "Short episode subtitle",
          hook_angle: {
            family: "conflict | myth_bust | shock_stat | outage_story",
            conflict_statement: "One crisp sentence capturing the tension",
            stakes: "Why an engineer loses sleep or fails an exam if they miss this",
          },
          narrative_arc: {
            setup: "Core premise / pain point",
            escalation: "Under-the-hood mechanism & trade-off deeper dive",
            reversal: "Key production insight / exam trap reversal",
          },
          episode_canon: {
            shared_glossary: ["Term: consistent Vietnamese + English definition"],
            running_example: "One concrete production scenario reused consistently across all parts",
            audience_level: "Target learner assumptions",
            target_total_duration_sec: maxPartSec * 2,
          },
          parts: [
            {
              part_id: "part_01",
              part_number: 1,
              title: "Focused part title",
              target_duration_sec: Math.min(maxPartSec, 270),
              must_cover_concepts: ["Exact concept assigned to part_01"],
              entry_bridge: "Opening hook or transition from previous part",
              exit_bridge: "Unresolved question handing off to part_02",
              teaching_beats: [
                {
                  id: "p01_beat_01",
                  part: "problem | architecture | setup | exam_tips",
                  goal: "What the learner must grasp here",
                  key_claim: "Core factual under-the-hood mechanism",
                  concrete_proof_anchor: "Specific CLI command, config key, number, or trace",
                },
              ],
            },
          ],
        },
      },
      null,
      2
    ),
  ].join("\n");

  const userParts = buildSharedTargetHeader({
    courseJson,
    curriculumMd,
    episodeMeta,
    customInstructions,
    maxPartDurationSec: maxPartSec,
  });

  if (rewriteNote && rewriteNote.trim()) {
    userParts.push("", "## Requested Changes (Rewrite Note)", rewriteNote.trim());
  }
  if (rewriteInstructions && rewriteInstructions.trim()) {
    userParts.push("", "## Independent Reviewer Rewrite Instructions (Apply Strictly)", rewriteInstructions.trim());
  }
  userParts.push(...formatOpenRevisionsLines(openRevisions));
  if (existingBrief) {
    userParts.push("", "## Existing Content Brief (Revise/Preserve Where Good)", JSON.stringify(existingBrief, null, 2).slice(0, 12000));
  } else if (existingScript) {
    userParts.push("", "## Existing Script Context", JSON.stringify(existingScript, null, 2).slice(0, 6000));
  }

  userParts.push("", 'Respond ONLY with `{ "brief": { ... } }`.');
  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

export function parseBriefPayload(
  rawText,
  { courseJson = {}, episodeMeta = {}, maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC } = {}
) {
  const parsed = parseJsonObjectLoose(rawText);
  const brief = parsed.brief && typeof parsed.brief === "object" ? parsed.brief : parsed;
  return normalizeBriefObject(brief, { courseJson, episodeMeta, maxPartDurationSec });
}

/**
 * Stage 1.5 Prompt: Independent Brief Review in fresh conversation context.
 */
export function buildBriefReviewPrompt({
  briefJson,
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  round = 1,
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
}) {
  const maxPartSec = resolveMaxPartDurationSec(maxPartDurationSec, courseJson);
  const systemPrompt = [
    "You are an Independent Deep-Dive Content Reviewer (Stage 1.5: Brief Gate).",
    "Evaluate this episode Content Brief strictly using a fresh perspective against 5 criteria:",
    "1. technical_accuracy: Are commands, limits, protocols, and technical claims factually accurate?",
    "2. explanation_depth: Do teaching beats explain under-the-hood mechanisms + concrete proof anchors rather than shallow dictionary summaries?",
    "3. pedagogical_clarity: Does the narrative arc flow causally without conceptual leaps against prerequisites?",
    "4. canon_continuity: Are `episode_canon` (`shared_glossary`, `running_example`) and part `entry_bridge` / `exit_bridge` cohesive across parts?",
    `5. budget_and_coverage: Is every part \`target_duration_sec <= ${maxPartSec}\`s and do \`parts[].must_cover_concepts\` cover 100% of the episode's required concepts?`,
    "",
    "Verdict rules:",
    '- Set `"verdict": "REVISE"` whenever there is ANY item in `blocker_issues` or `major_issues`.',
    '- Set `"verdict": "APPROVED"` ONLY when `blocker_issues` and `major_issues` are BOTH empty.',
    "",
    "Return STRICT VALID JSON ONLY matching:",
    JSON.stringify(
      {
        review: {
          verdict: "APPROVED | REVISE",
          score: 88,
          summary: "Concise overall assessment",
          criteria: {
            technical_accuracy: "PASS | FAIL",
            explanation_depth: "PASS | FAIL",
            pedagogical_clarity: "PASS | FAIL",
            canon_continuity: "PASS | FAIL",
            budget_and_coverage: "PASS | FAIL",
          },
          strengths: ["..."],
          blocker_issues: [],
          major_issues: [],
          minor_issues: [],
          rewrite_instructions: "Exact actionable fixes if REVISE, else empty string",
        },
      },
      null,
      2
    ),
  ].join("\n");

  const userParts = [
    `# Brief Review Target (Round ${round})`,
    ...buildSharedTargetHeader({
      courseJson,
      curriculumMd,
      episodeMeta,
      maxPartDurationSec: maxPartSec,
    }),
    "",
    "# Submitted brief.json",
    JSON.stringify(briefJson || {}, null, 2),
    "",
    'Respond ONLY with `{ "review": { ... } }`.',
  ];

  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

/**
 * Parse independent reviewer JSON output (used by both Brief Review and Part Content Review).
 */
export function parseContentReviewPayload(rawText) {
  const parsed = parseJsonObjectLoose(rawText);
  const raw = parsed.review && typeof parsed.review === "object" ? parsed.review : parsed;

  const rawVerdict = String(raw.verdict || "").trim().toUpperCase();
  const blockerIssues = normalizeStringArray(raw.blocker_issues);
  const majorIssues = normalizeStringArray(raw.major_issues);
  const minorIssues = normalizeStringArray(raw.minor_issues);
  const strengths = normalizeStringArray(raw.strengths);
  const summary = String(raw.summary || "").trim();
  const rewriteInstructions = String(raw.rewrite_instructions || "").trim();

  // Only verdict === "REVISE" or non-empty blocker/major issues require rewrite (minor_issues alone do NOT!)
  const needsRewrite = rawVerdict === "REVISE" || blockerIssues.length > 0 || majorIssues.length > 0;
  const verdict = needsRewrite ? "REVISE" : "APPROVED";

  const numScore = Number(raw.score);
  const score = Number.isFinite(numScore)
    ? Math.max(0, Math.min(100, Math.round(numScore)))
    : verdict === "APPROVED"
      ? 88
      : 55;

  const rawCriteria = raw.criteria && typeof raw.criteria === "object" ? raw.criteria : {};
  const criteria = {};
  for (const k of [
    "technical_accuracy",
    "explanation_depth",
    "pedagogical_clarity",
    "canon_continuity",
    "budget_and_coverage",
  ]) {
    if (rawCriteria[k] !== undefined) {
      criteria[k] = String(rawCriteria[k]).trim().toUpperCase() === "FAIL" ? "FAIL" : "PASS";
    }
  }

  return {
    verdict,
    score,
    summary,
    criteria,
    strengths,
    blocker_issues: blockerIssues,
    major_issues: majorIssues,
    minor_issues: minorIssues,
    rewrite_instructions: rewriteInstructions,
    needs_rewrite: needsRewrite,
  };
}

/**
 * Format a parsed review object into clean Markdown ending with an explicit verdict line
 * compatible with state_cli.mjs parseReviewVerdict().
 */
export function formatReviewMarkdown(
  reviewObj,
  {
    episodeId = "",
    partId = null,
    kind = "part",
    round = 1,
    reviewerLabel = "content-reviewer",
    wordCount = null,
    partSpec = null,
  } = {}
) {
  const rev = reviewObj?.review && typeof reviewObj.review === "object" ? reviewObj.review : reviewObj || {};
  const verdict = String(rev.verdict || "REVISE").trim().toUpperCase() === "APPROVED" ? "APPROVED" : "REVISE";
  const targetLabel = partId ? `${episodeId}/${partId}` : episodeId || "episode";
  const heading =
    kind === "brief"
      ? `# Brief Review — ${targetLabel} (Round ${round})`
      : `# Content Review — ${targetLabel} (Round ${round})`;

  const lines = [
    heading,
    "",
    `- **Reviewed Target:** ${kind === "brief" ? "`brief.json`" : `\`parts/${partId || "part_01"}/dialogue.json\`, \`notes.md\``}`,
    `- **Reviewer:** \`${reviewerLabel}\``,
    `- **Score:** ${rev.score ?? (verdict === "APPROVED" ? 88 : 55)}/100`,
  ];

  if (wordCount !== null && wordCount !== undefined) {
    lines.push(`- **Spoken Word Count (\`display_text\`):** ${wordCount} words (Target ~600–850 words, <= 5m)`);
  }
  if (partSpec && Array.isArray(partSpec.must_cover_concepts) && partSpec.must_cover_concepts.length > 0) {
    lines.push(`- **Assigned Must-Cover Concepts:** ${partSpec.must_cover_concepts.join("; ")}`);
  }

  const criteriaKeys = Object.keys(rev.criteria || {});
  if (criteriaKeys.length > 0) {
    lines.push("- **Rubric Criteria:**");
    for (const k of criteriaKeys) {
      lines.push(`  - \`${k}\`: **${rev.criteria[k]}**`);
    }
  }

  if (rev.summary) {
    lines.push("", "## Summary", rev.summary);
  }
  if (Array.isArray(rev.strengths) && rev.strengths.length > 0) {
    lines.push("", "## Strengths", ...rev.strengths.map((s) => `- ${s}`));
  }

  lines.push("", "## Issues Found");
  const formatBucket = (title, items) => {
    lines.push(`### ${title}`);
    if (!Array.isArray(items) || items.length === 0) {
      lines.push("- (None)");
    } else {
      for (const it of items) lines.push(`- ${it}`);
    }
  };
  formatBucket("BLOCKER", rev.blocker_issues);
  formatBucket("MAJOR", rev.major_issues);
  formatBucket("MINOR", rev.minor_issues);

  if (rev.rewrite_instructions) {
    lines.push("", "## Rewrite Instructions", rev.rewrite_instructions);
  }

  lines.push("", `## Verdict: ${verdict}`, "");
  return lines.join("\n");
}

/**
 * Run independent Stage 1.5 Content Brief review in a fresh conversation context.
 */
export async function reviewContentBrief({
  provider_id,
  model,
  briefJson,
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  round = 1,
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
  onProgress = null,
  engineDir,
}) {
  const prompt = buildBriefReviewPrompt({
    briefJson,
    courseJson,
    curriculumMd,
    episodeMeta,
    round,
    maxPartDurationSec,
  });
  const res = await runJsonStageLoop({
    provider_id,
    model,
    system_prompt: prompt.system_prompt,
    user_prompt: prompt.user_prompt,
    parseFn: parseContentReviewPayload,
    retryHint: 'Return ONLY valid JSON: { "review": { "verdict": "APPROVED | REVISE", "score": 0..100, "summary": "...", "strengths": [], "blocker_issues": [], "major_issues": [], "minor_issues": [], "rewrite_instructions": "..." } }.',
    phase: "stage_1_brief_review",
    stageLabel: `Stage 1.5 Brief Review (Round ${round})`,
    onProgress,
    engineDir,
  });

  const reviewerLabel = model ? `${provider_id}:${model}` : String(provider_id || "content-reviewer");
  const reviewMd = formatReviewMarkdown(res.value, {
    episodeId: briefJson?.episode_id || episodeMeta?.id || "",
    kind: "brief",
    round,
    reviewerLabel,
  });

  return {
    review_json: res.value,
    review_md: reviewMd,
    needs_rewrite: res.value.needs_rewrite,
    calls: res.calls,
  };
}

/**
 * Stage 2 Per-Part Dialogue Prompt: writes deep-dive spoken Vietnamese beats + notes.md for one reviewable part.
 */
export function buildPartDialoguePrompt({
  briefJson,
  partSpec,
  partIndex = 0,
  totalParts = 1,
  previousPartHandoff = null,
  nextPartPreview = null,
  courseJson = {},
  episodeMeta = {},
  existingDialogue = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
  rewriteInstructions = "",
}) {
  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );
  const resolvedPart =
    partSpec ||
    (Array.isArray(briefJson?.parts) ? briefJson.parts[partIndex] : null) || {
      part_id: "part_01",
      part_number: partIndex + 1,
      title: briefJson?.title || epTitle,
      target_duration_sec: 260,
      must_cover_concepts: normalizeStringArray(episodeMeta.must_cover_concepts),
      entry_bridge: briefJson?.hook_angle?.conflict_statement || "",
      exit_bridge: "",
      teaching_beats: briefJson?.teaching_beats || [],
    };

  const targetSec = Math.max(60, Math.min(300, Number(resolvedPart.target_duration_sec) || 260));
  const minWords = targetSec >= 240 ? 600 : Math.max(180, Math.round((targetSec / 300) * 600));
  const maxWords = targetSec >= 240 ? 850 : Math.max(300, Math.round((targetSec / 300) * 850));
  const isFirstPart = partIndex === 0;
  const isLastPart = partIndex >= Math.max(1, totalParts) - 1;

  const continuityRules = [
    isFirstPart
      ? "- OPENING RULE (`part_01`): Start immediately with the hook conflict / outage tension (`hook_angle` & `entry_bridge`). NEVER open with 'Xin chào các bạn...'."
      : `- CONTINUATION RULE (\`${resolvedPart.part_id}\`, Part ${partIndex + 1}/${totalParts}): Continue SEAMLESSLY from \`previous_part_handoff\` via \`entry_bridge\`. Do NOT repeat the episode introduction, title recap, or greetings!`,
    isLastPart
      ? "- CLOSING RULE (Final Part): Wrap up the full episode arc cleanly, reinforce key production takeaways, and finish study notes with hands-on CLI/exam scenarios."
      : `- HANDOFF RULE (Intermediate Part ${partIndex + 1}/${totalParts}): End cleanly on \`exit_bridge\` setting up \`next_part_preview\`. Do NOT emit a premature final episode outro!`,
  ];

  const systemPrompt = [
    "You are the Lead Spoken Scriptwriter (Stage 2: Dialogue & TTS Beats).",
    `Author deep-dive spoken Vietnamese beats + focused \`notes_md\` for **${resolvedPart.part_id}** (Part ${partIndex + 1}/${totalParts}, budget <= ${targetSec}s ≈ ${minWords}–${maxWords} spoken Vietnamese words across \`display_text\`).`,
    "STRICT PROHIBITION: Do NOT choose visual templates, visual_type, nodes, edges, coordinates, CSS, or GSAP.",
    "",
    "### Deep-Dive Engineering Depth & Spoken Safety Rules:",
    "1. Under-the-Hood Mechanism (NO Dictionary Summaries): Never settle for superficial 'X helps performance' bullets. Trace step-by-step what happens internally (memory, kernel, network, scheduler, or protocol) on `episode_canon.running_example` with concrete numbers, commands, outputs, and failure edge cases.",
    "2. Episode Canon & Part Continuity:",
    "   - Keep `episode_canon.shared_glossary` terms and `episode_canon.running_example` names/endpoints 100% consistent.",
    ...continuityRules,
    "3. What vs. Why Separation:",
    "   - `on_screen_fact` (WHAT): concise metric, state transition, CLI command, or contrast for the screen.",
    "   - `display_text` (WHY): natural spoken Vietnamese explaining cause, mechanism, or consequence (NEVER read `on_screen_fact` verbatim).",
    "4. Dual-Text TTS Safety:",
    "   - `display_text`: exact technical spelling for subtitles & UI (`K8s`, `RDB`, `140ms`, `O(log N)`).",
    "   - `tts_text`: Vietnamese TTS-safe phonetic version (`K-8-S`, `R-D-B`, `một trăm bốn mươi mili giây`, `ô lốc n`). Avoid placing two similar-sounding numbers in the same sentence.",
    "5. Scene Grouping: Group consecutive beats into ~5–7 conceptual scenes via `scene_group` (e.g. `scene_01_hook`) and `scene_title` using blueprint `part` values (`problem`, `architecture`, `setup`, `exam_tips`).",
    "",
    "Return STRICT VALID JSON ONLY matching:",
    JSON.stringify(
      {
        dialogue: {
          course_id: courseId,
          episode_id: epId,
          episode_number: epNum,
          part_id: resolvedPart.part_id,
          title: resolvedPart.title || briefJson?.title || epTitle,
          subtitle: briefJson?.subtitle || "",
          tts_profile: ttsProfile,
          tts_voice: ttsVoice,
          tts_rate: ttsRate,
          beats: [
            {
              beat_id: `${resolvedPart.part_id}_b01`,
              part: "problem | architecture | setup | exam_tips",
              scene_group: "scene_01_hook",
              scene_title: "Crisp Vietnamese scene heading",
              spoken_purpose: "Why this beat matters in the story",
              on_screen_fact: "WHAT fact/command/number must appear on screen",
              display_text: "Spoken sentence(s) with exact tech orthography for subtitles",
              tts_text: "Phonetically normalized Vietnamese sentence(s) for TTS engine",
              highlight_words: ["Redis", "Latency"],
              cue_hint: "Brief note on what proof/change happens during this sentence",
            },
          ],
        },
        notes_md: "# Focused Cheat Sheet, Verified Commands/Configs & Scenario MCQs for this part...",
      },
      null,
      2
    ),
  ].join("\n");

  const userParts = [
    "# Episode Canon & Hook (Stage 1)",
    JSON.stringify(
      {
        course_id: courseId,
        episode_id: epId,
        title: briefJson?.title || epTitle,
        subtitle: briefJson?.subtitle || "",
        hook_angle: briefJson?.hook_angle || {},
        narrative_arc: briefJson?.narrative_arc || {},
        episode_canon: briefJson?.episode_canon || {},
      },
      null,
      2
    ),
    "",
    `# Target Part Spec (${resolvedPart.part_id} — Part ${partIndex + 1} of ${totalParts})`,
    JSON.stringify(resolvedPart, null, 2),
  ];

  if (previousPartHandoff) {
    userParts.push("", "# Previous Part Handoff (Continue Smoothly, NO Repeated Intro)", JSON.stringify(previousPartHandoff, null, 2));
  }
  if (nextPartPreview) {
    userParts.push("", "# Next Part Preview (Hand Off Cleanly via exit_bridge)", JSON.stringify(nextPartPreview, null, 2));
  }
  if (customInstructions) {
    userParts.push("", "# Additional User Instructions", customInstructions);
  }
  if (rewriteNote && rewriteNote.trim()) {
    userParts.push("", "# Rewrite Note", rewriteNote.trim());
  }
  if (rewriteInstructions && rewriteInstructions.trim()) {
    userParts.push("", "# MANDATORY CONTENT REVIEWER REWRITE INSTRUCTIONS", rewriteInstructions.trim());
  }
  userParts.push(...formatOpenRevisionsLines(openRevisions));
  if (existingDialogue) {
    userParts.push("", "# Existing Dialogue Reference", JSON.stringify(existingDialogue, null, 2).slice(0, 12000));
  }
  if (existingNotes) {
    userParts.push("", "# Existing Part Notes Reference", String(existingNotes).slice(0, 3000));
  }
  userParts.push("", 'Respond ONLY with `{ "dialogue": { ... }, "notes_md": "..." }`.');
  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

/**
 * Backward-compatible wrapper for Stage 2 Dialogue generation (single-part or selected part from briefJson).
 */
export function buildDialoguePrompt({
  briefJson,
  partSpec = null,
  partId = null,
  partIndex = 0,
  totalParts = null,
  previousPartHandoff = null,
  nextPartPreview = null,
  courseJson = {},
  episodeMeta = {},
  existingDialogue = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
  rewriteInstructions = "",
}) {
  const partsList = Array.isArray(briefJson?.parts) ? briefJson.parts : [];
  let idx = partIndex;
  let resolvedPart = partSpec;
  if (!resolvedPart && partsList.length > 0) {
    if (partId) {
      const foundIdx = partsList.findIndex((p) => p?.part_id === partId);
      idx = foundIdx >= 0 ? foundIdx : 0;
    }
    resolvedPart = partsList[idx] || partsList[0];
  }
  const count = totalParts ?? (partsList.length > 0 ? partsList.length : 1);
  const nextPreview =
    nextPartPreview ||
    (partsList[idx + 1]
      ? {
          part_id: partsList[idx + 1].part_id,
          title: partsList[idx + 1].title,
          entry_bridge: partsList[idx + 1].entry_bridge,
        }
      : null);

  return buildPartDialoguePrompt({
    briefJson,
    partSpec: resolvedPart,
    partIndex: idx,
    totalParts: count,
    previousPartHandoff,
    nextPartPreview: nextPreview,
    courseJson,
    episodeMeta,
    existingDialogue,
    existingNotes,
    openRevisions,
    customInstructions,
    rewriteNote,
    rewriteInstructions,
  });
}

export function parseDialoguePayload(
  rawText,
  { briefJson = null, partSpec = null, courseJson = {}, episodeMeta = {}, fallbackNotes = "" } = {}
) {
  const parsed = parseJsonObjectLoose(rawText);
  const dialogue = parsed.dialogue && typeof parsed.dialogue === "object" ? parsed.dialogue : parsed;
  const beats = Array.isArray(dialogue?.beats) ? dialogue.beats : [];
  if (!dialogue || typeof dialogue !== "object" || beats.length === 0) {
    throw new Error('Stage 2 dialogue JSON must contain "dialogue.beats" as a non-empty array.');
  }
  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );
  const resolvedPartId = String(dialogue.part_id || partSpec?.part_id || "").trim() || null;

  const normalizedBeats = beats.map((b, i) => {
    const displayText = String(b?.display_text || b?.narration || b?.text || "").trim();
    if (!displayText) {
      throw new Error(`dialogue.beats[${i}] requires non-empty "display_text".`);
    }
    const ttsText = String(b?.tts_text || displayText).trim();
    const part = VALID_PART_SET.has(b?.part) ? b.part : "architecture";
    return {
      beat_id: String(b?.beat_id || b?.id || `beat_${String(i + 1).padStart(2, "0")}`).trim(),
      part,
      scene_group: String(b?.scene_group || `scene_${part}`).trim(),
      scene_title: String(b?.scene_title || partSpec?.title || briefJson?.title || epTitle).trim(),
      spoken_purpose: String(b?.spoken_purpose || "").trim(),
      on_screen_fact: String(b?.on_screen_fact || "").trim(),
      display_text: displayText,
      tts_text: ttsText,
      highlight_words: Array.isArray(b?.highlight_words)
        ? b.highlight_words.map((w) => String(w || "").trim()).filter(Boolean)
        : [],
      cue_hint: String(b?.cue_hint || "").trim(),
    };
  });

  const notesMd =
    parsed.notes_md !== undefined && parsed.notes_md !== null
      ? String(parsed.notes_md)
      : String(fallbackNotes || "");

  const outDialogue = {
    course_id: String(dialogue.course_id || briefJson?.course_id || courseId || "").trim(),
    episode_id: String(dialogue.episode_id || briefJson?.episode_id || epId || "").trim(),
    episode_number: Number.isFinite(Number(dialogue.episode_number))
      ? Number(dialogue.episode_number)
      : briefJson?.episode_number ?? epNum,
    ...(resolvedPartId ? { part_id: resolvedPartId } : {}),
    title: String(dialogue.title || partSpec?.title || briefJson?.title || epTitle || "").trim(),
    subtitle: String(dialogue.subtitle || briefJson?.subtitle || "").trim(),
    tts_profile: String(dialogue.tts_profile || ttsProfile),
    tts_voice: String(dialogue.tts_voice || ttsVoice),
    tts_rate: String(dialogue.tts_rate || ttsRate),
    beats: normalizedBeats,
  };

  return {
    dialogue: outDialogue,
    notes_md: notesMd,
  };
}

/**
 * Stage 2.5 Prompt: Independent Content Review in fresh conversation context (zero writer history).
 */
export function buildContentReviewPrompt({
  briefJson,
  partSpec = null,
  dialogueJson,
  notesMd = "",
  previousPartHandoff = null,
  courseJson = {},
  episodeMeta = {},
  round = 1,
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
}) {
  const maxPartSec = resolveMaxPartDurationSec(maxPartDurationSec, courseJson);
  const resolvedPart =
    partSpec ||
    (Array.isArray(briefJson?.parts)
      ? briefJson.parts.find((p) => p?.part_id === dialogueJson?.part_id) || briefJson.parts[0]
      : null);
  const wordCount = computeDialogueWordCount(dialogueJson);
  const targetSec = Number(resolvedPart?.target_duration_sec) || maxPartSec;

  const systemPrompt = [
    "You are an Independent Deep-Dive Content Reviewer (Stage 2.5).",
    "Audit the submitted part `dialogue.json` and `notes.md` in a completely fresh evaluation against 5 criteria:",
    "1. technical_accuracy: Commands, flags, protocols, Big-O, limits, configs, and quiz options/explanations must be 100% accurate.",
    "2. explanation_depth: Reject superficial dictionary definitions or bullet lists. Require under-the-hood mechanism + concrete trace on `episode_canon.running_example` + why/trade-offs.",
    "3. pedagogical_clarity: Zero conceptual leaps for self-learners; sharp What (`on_screen_fact`) vs. Why (`display_text`) separation; clean Dual-Text TTS phonetic safety (`tts_text` vs `display_text`).",
    "4. canon_continuity: Strict consistency with `episode_canon` (`shared_glossary`, `running_example`); `part_02+` continues smoothly from `previous_part_handoff` WITHOUT repeating intro/greetings; non-final parts hand off cleanly without premature episode outro.",
    `5. budget_and_coverage: Spoken budget fits <= ${Math.min(maxPartSec, targetSec)}s (~600-850 Vietnamese words for a 5m part, avoid bloated >950 words or thin <350 words when heavy concepts remain) and covers 100% of this part's \`must_cover_concepts\`.`,
    "",
    "Verdict Gate:",
    '- `"verdict": "REVISE"` is REQUIRED whenever `blocker_issues` or `major_issues` is non-empty.',
    '- `"verdict": "APPROVED"` ONLY when `blocker_issues` and `major_issues` are BOTH empty (`minor_issues` alone may still be APPROVED).',
    "",
    "Return STRICT VALID JSON ONLY matching:",
    JSON.stringify(
      {
        review: {
          verdict: "APPROVED | REVISE",
          score: 88,
          summary: "Concise review summary",
          criteria: {
            technical_accuracy: "PASS | FAIL",
            explanation_depth: "PASS | FAIL",
            pedagogical_clarity: "PASS | FAIL",
            canon_continuity: "PASS | FAIL",
            budget_and_coverage: "PASS | FAIL",
          },
          strengths: ["..."],
          blocker_issues: [],
          major_issues: [],
          minor_issues: [],
          rewrite_instructions: "Exact beat_id/section instructions if REVISE, else empty string",
        },
      },
      null,
      2
    ),
  ].join("\n");

  const userParts = [
    `# Review Target: ${episodeMeta?.id || briefJson?.episode_id || "episode"} / ${resolvedPart?.part_id || dialogueJson?.part_id || "part_01"} (Round ${round})`,
    `- Measured Spoken Word Count (\`display_text\`): ${wordCount} words`,
    `- Target Part Duration: <= ${Math.min(maxPartSec, targetSec)}s`,
    "",
    "# Approved Episode Canon & Part Spec",
    JSON.stringify(
      {
        episode_canon: briefJson?.episode_canon || {},
        hook_angle: briefJson?.hook_angle || {},
        part_spec: resolvedPart || {},
      },
      null,
      2
    ),
  ];

  if (previousPartHandoff) {
    userParts.push("", "# Previous Part Handoff", JSON.stringify(previousPartHandoff, null, 2));
  }
  userParts.push(
    "",
    "# Submitted dialogue.json",
    JSON.stringify(dialogueJson || {}, null, 2),
    "",
    "# Submitted notes.md",
    String(notesMd || "").slice(0, 6000),
    "",
    'Respond ONLY with `{ "review": { ... } }`.'
  );

  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

/**
 * Run independent Stage 2.5 Part Dialogue Review in a fresh conversation context.
 */
export async function reviewPartDialogue({
  provider_id,
  model,
  briefJson,
  partSpec = null,
  dialogueJson,
  notesMd = "",
  previousPartHandoff = null,
  courseJson = {},
  episodeMeta = {},
  round = 1,
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
  onProgress = null,
  engineDir,
}) {
  const partId = partSpec?.part_id || dialogueJson?.part_id || "part_01";
  const wordCount = computeDialogueWordCount(dialogueJson);
  const prompt = buildContentReviewPrompt({
    briefJson,
    partSpec,
    dialogueJson,
    notesMd,
    previousPartHandoff,
    courseJson,
    episodeMeta,
    round,
    maxPartDurationSec,
  });

  const res = await runJsonStageLoop({
    provider_id,
    model,
    system_prompt: prompt.system_prompt,
    user_prompt: prompt.user_prompt,
    parseFn: parseContentReviewPayload,
    retryHint: 'Return ONLY valid JSON: { "review": { "verdict": "APPROVED | REVISE", "score": 0..100, "summary": "...", "strengths": [], "blocker_issues": [], "major_issues": [], "minor_issues": [], "rewrite_instructions": "..." } }.',
    phase: "stage_2_5_review",
    stageLabel: `Stage 2.5 Content Review (${partId}, Round ${round})`,
    onProgress,
    engineDir,
  });

  const reviewerLabel = model ? `${provider_id}:${model}` : String(provider_id || "content-reviewer");
  const reviewMd = formatReviewMarkdown(res.value, {
    episodeId: dialogueJson?.episode_id || briefJson?.episode_id || episodeMeta?.id || "",
    partId,
    kind: "part",
    round,
    reviewerLabel,
    wordCount,
    partSpec,
  });

  return {
    review_json: res.value,
    review_md: reviewMd,
    needs_rewrite: res.value.needs_rewrite,
    calls: res.calls,
  };
}

/**
 * Stage 3 (Visual Director & Motion Compiler): compiles locked per-part spoken beats (+ optional audio_spine)
 * into validated 11-template runtime `script_json` (5-7 scenes per part) enforcing Visual Variety Guard.
 */
export function buildVisualDirectionPrompt({
  dialogueJson,
  partSpec = null,
  audioSpine = null,
  availableSvgs = [],
  courseJson = {},
  episodeMeta = {},
  existingScript = null,
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
}) {
  const { courseId, epId, epNum, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );
  const partId = partSpec?.part_id || dialogueJson?.part_id || null;
  const svgListStr =
    Array.isArray(availableSvgs) && availableSvgs.length > 0
      ? availableSvgs.map((s) => (typeof s === "string" ? s : s?.id)).filter(Boolean).join(", ")
      : "server-rack, redis-stack, ram-stick, ssd-disk, postgres, database, docker, kubernetes, api-gateway, browser-client, cloud-infra, event-loop, kafka-queue, shield-lock, terminal-cli";

  const schemaSpec = getSchemaPromptSpec({ compact: false, pass: 2 });
  const hasAllElevenInSchema =
    schemaSpec.includes("sequence_diagram") &&
    schemaSpec.includes("memory_layout") &&
    schemaSpec.includes("code_diff") &&
    schemaSpec.includes("concept_breakdown");
  const visualTypesLabel = Array.from(new Set([...SUPPORTED_VISUAL_TYPES, ...ALL_ELEVEN_VISUAL_TYPES])).join(", ");

  const systemPrompt = [
    "You are the Visual Director & Motion Compiler (Stage 3) for Tech Video Studio.",
    `Convert the LOCKED spoken beats in \`dialogue.json\`${partId ? ` for \`${partId}\`` : ""} into 5–7 rich visual scenes returning \`{ "script_json": { ... }, "notes_md": "..." }\`.`,
    "",
    "### Mandatory Visual Direction Rules:",
    "1. PRESERVE SPOKEN WORDING: Group beats by `scene_group` into `scenes[]`. Do NOT rewrite the spoken text. Set `scene.narration` to the joined `display_text` of that scene's beats, and preserve `scene.tts_beats = [{ beat_id, display_text, tts_text }]` verbatim.",
    "2. Visual Job Gate: Assign EVERY scene an explicit `visual_job` (`Proof` | `Mechanism` | `Consequence` | `Action` | `Transition`). Show WHAT (`on_screen_fact`), never repeat the spoken explanation as prose.",
    `3. All 11 Visual Templates Available: [${visualTypesLabel}]. Prefer \`layout_mode: "auto"\` on \`architecture\` scenes (node x/y optional).`,
    "4. MANDATORY VISUAL VARIETY GUARD:",
    "   - NEVER use the exact same `visual_type` in two adjacent scenes (`scene[i].visual_type !== scene[i-1].visual_type`, except deliberate `code_cli` continuation).",
    "   - Use >= 3 distinct `visual_type` templates in this part (when >= 3 scenes).",
    "   - Alternate `world_theme` (`\"dark\"` vs `\"light\"`) cleanly across consecutive scenes.",
    `5. Local SVG Assets ONLY: When using \`node.svg\` in \`architecture\`, pick strictly from: [${svgListStr}]. Always include fallback \`node.icon\`.`,
    `6. Motion Variety & Anti-Static (>3.5s rule): Rotate \`causal_mechanic\` (${CAUSAL_MECHANICS.map((m) => `\`${m}\``).join(", ")}) across consecutive scenes. Populate \`cue_sentence\` (1-based) and \`cue_text\` on every step/message/focus_step/branch/phase/milestone/card/row.`,
    '7. Optional Visual Fields: Set `sfx_cues` (`[{ progress, type: "whoosh_short"|"pop"|"click"|"typing_fast"|"impact"|"chime" }]`), `camera_focus`, `code_override`, and `laser_scan` where helpful.',
    "",
    schemaSpec,
    ...(hasAllElevenInSchema ? [] : ["", "   Additional Deep-Dive Templates (SSOT Contract):", EXTRA_FOUR_TEMPLATES_SPEC]),
    "",
    `Top-level script_json metadata: { "course_id": "${courseId}", "episode_id": "${epId}", "episode_number": ${epNum}${partId ? `, "part_id": "${partId}"` : ""}, "aspect_ratio": "16:9", "language": "vi", "tts_profile": "${ttsProfile}", "tts_voice": "${ttsVoice}", "tts_rate": "${ttsRate}", "scenes": [...] }`,
  ].join("\n");

  const userParts = [
    "# Locked Dialogue & Beats (Stage 2)",
    JSON.stringify(dialogueJson || {}, null, 2),
  ];
  if (partSpec) {
    userParts.push("", "# Part Metadata", JSON.stringify(partSpec, null, 2));
  }
  if (audioSpine && Array.isArray(audioSpine.beats) && audioSpine.beats.length > 0) {
    userParts.push(
      "",
      "# Locked Audio Spine Timings (Use exact proportions for progress_start / progress_end)",
      JSON.stringify(
        audioSpine.beats.map((b) => ({
          beat_id: b.beat_id,
          scene_group: b.scene_group,
          duration_ms: b.duration_ms,
          start_ms: b.start_ms,
          end_ms: b.end_ms,
          start_frame: b.start_frame,
          end_frame: b.end_frame,
        })),
        null,
        2
      )
    );
  }
  if (customInstructions) {
    userParts.push("", "# Additional Instructions", customInstructions);
  }
  if (rewriteNote) {
    userParts.push("", "# Rewrite Note", rewriteNote);
  }
  userParts.push(...formatOpenRevisionsLines(openRevisions));
  if (existingScript) {
    userParts.push(
      "",
      "# Reference Existing Script (Preserve working layouts if applicable)",
      JSON.stringify(existingScript, null, 2).slice(0, 7000)
    );
  }
  userParts.push("", 'Return ONLY `{ "script_json": { ... }, "notes_md": "..." }`.');
  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

function fillProportionalIntervals(items, startKey = "progress_start", endKey = "progress_end") {
  if (!Array.isArray(items) || items.length === 0) return;
  const n = items.length;
  for (let i = 0; i < n; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    const hasStart = item[startKey] !== undefined && item[startKey] !== null && Number.isFinite(Number(item[startKey]));
    const hasEnd = item[endKey] !== undefined && item[endKey] !== null && Number.isFinite(Number(item[endKey]));
    if (!hasStart) {
      item[startKey] = Number((i / n).toFixed(3));
    } else {
      item[startKey] = Math.max(0, Math.min(1, Number(item[startKey])));
    }
    if (!hasEnd) {
      const defEnd = Number(((i + 1) / n).toFixed(3));
      item[endKey] = Math.max(item[startKey], defEnd);
    } else {
      item[endKey] = Math.max(item[startKey], Math.min(1, Number(item[endKey])));
    }
  }
}

/**
 * Deterministically normalize compiled script_json across all 11 visual templates:
 * - Fill missing script metadata defaults from courseJson/episodeMeta
 * - Preserve Dual-Text tts_beats and audioSpine scene durations
 * - Fill missing progress_start/progress_end proportionally across ALL 11 templates
 * - Set layout_mode: "auto" on architecture scenes missing node x, y
 */
export function normalizeCompiledScript(
  scriptJson,
  { courseJson = {}, episodeMeta = {}, dialogueJson = null, audioSpine = null, partSpec = null } = {}
) {
  if (!scriptJson || typeof scriptJson !== "object") return scriptJson;

  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );

  if (!scriptJson.course_id && courseId) scriptJson.course_id = courseId;
  if (!scriptJson.episode_id && epId) scriptJson.episode_id = epId;
  if (scriptJson.episode_number === undefined && epNum) scriptJson.episode_number = epNum;
  if (!scriptJson.part_id && (partSpec?.part_id || dialogueJson?.part_id)) {
    scriptJson.part_id = partSpec?.part_id || dialogueJson?.part_id;
  }
  if (!scriptJson.title && (partSpec?.title || epTitle)) scriptJson.title = partSpec?.title || epTitle;
  if (!scriptJson.aspect_ratio) scriptJson.aspect_ratio = "16:9";
  if (!scriptJson.language) scriptJson.language = "vi";
  if (!scriptJson.tts_profile) scriptJson.tts_profile = ttsProfile;
  if (!scriptJson.tts_voice) scriptJson.tts_voice = ttsVoice;
  if (!scriptJson.tts_rate) scriptJson.tts_rate = ttsRate;

  const beatsByGroup = new Map();
  if (Array.isArray(dialogueJson?.beats)) {
    for (const beat of dialogueJson.beats) {
      if (!beat || typeof beat !== "object") continue;
      const grp = String(beat.scene_group || "").trim();
      if (!grp) continue;
      if (!beatsByGroup.has(grp)) beatsByGroup.set(grp, []);
      beatsByGroup.get(grp).push(beat);
    }
  }
  const spineByBeatId = new Map();
  if (Array.isArray(audioSpine?.beats)) {
    for (const sb of audioSpine.beats) {
      if (sb && sb.beat_id) spineByBeatId.set(String(sb.beat_id), sb);
    }
  }

  const scenes = Array.isArray(scriptJson.scenes) ? scriptJson.scenes : [];
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") continue;

    const matchedBeats = scene.id ? beatsByGroup.get(String(scene.id).trim()) : null;
    if (matchedBeats && matchedBeats.length > 0) {
      if (!Array.isArray(scene.tts_beats) || scene.tts_beats.length === 0) {
        scene.tts_beats = matchedBeats.map((b) => ({
          beat_id: b.beat_id,
          display_text: b.display_text,
          tts_text: b.tts_text || b.display_text,
        }));
      }
      if (!scene.narration || !String(scene.narration).trim()) {
        scene.narration = matchedBeats.map((b) => b.display_text).join(" ");
      }
      if (!Array.isArray(scene.highlight_words) || scene.highlight_words.length === 0) {
        const hw = Array.from(
          new Set(matchedBeats.flatMap((b) => (Array.isArray(b.highlight_words) ? b.highlight_words : [])))
        );
        if (hw.length > 0) scene.highlight_words = hw;
      }
      if (!scene.duration_sec && spineByBeatId.size > 0) {
        const totalMs = matchedBeats.reduce(
          (acc, b) => acc + (Number(spineByBeatId.get(b.beat_id)?.duration_ms) || 0),
          0
        );
        if (totalMs > 0) {
          scene.duration_sec = Number((totalMs / 1000).toFixed(3));
        }
      }
    }

    const vtype = scene.visual_type || "architecture";
    const vd = scene.visual_data && typeof scene.visual_data === "object" ? scene.visual_data : null;
    if (!vd) continue;

    if (vtype === "architecture") {
      const nodes = Array.isArray(vd.nodes) ? vd.nodes : [];
      const anyMissingCoord = nodes.some(
        (n) =>
          !n ||
          n.x === undefined ||
          n.x === null ||
          n.x === "" ||
          !Number.isFinite(Number(n.x)) ||
          n.y === undefined ||
          n.y === null ||
          n.y === "" ||
          !Number.isFinite(Number(n.y))
      );
      if (anyMissingCoord && vd.layout_mode !== "auto") {
        vd.layout_mode = "auto";
      }
      fillProportionalIntervals(vd.flow_steps, "progress_start", "progress_end");
    } else if (vtype === "console_setup") {
      fillProportionalIntervals(vd.steps, "progress_start", "progress_end");
      if (Array.isArray(vd.steps)) {
        vd.steps.forEach((st, idx) => {
          if (st && typeof st === "object" && (st.step_number === undefined || st.step_number === null)) {
            st.step_number = idx + 1;
          }
        });
      }
    } else if (vtype === "code_cli") {
      fillProportionalIntervals(vd.highlight_phases, "progress_start", "progress_end");
      if (Array.isArray(vd.terminal_commands) && vd.terminal_commands.length > 0) {
        const cn = vd.terminal_commands.length;
        vd.terminal_commands.forEach((cmd, idx) => {
          if (
            cmd &&
            typeof cmd === "object" &&
            (cmd.progress_start === undefined ||
              cmd.progress_start === null ||
              !Number.isFinite(Number(cmd.progress_start)))
          ) {
            cmd.progress_start = Number(((idx / cn) * 0.85).toFixed(3));
          }
        });
      }
    } else if (vtype === "timeline_flow") {
      fillProportionalIntervals(vd.milestones, "progress_start", "progress_end");
    } else if (vtype === "sequence_diagram") {
      fillProportionalIntervals(vd.messages, "progress_start", "progress_end");
    } else if (vtype === "memory_layout") {
      fillProportionalIntervals(vd.steps, "progress_start", "progress_end");
    } else if (vtype === "code_diff") {
      fillProportionalIntervals(vd.focus_steps, "progress_start", "progress_end");
    } else if (vtype === "concept_breakdown") {
      fillProportionalIntervals(vd.branches, "progress_start", "progress_end");
    }
  }

  return scriptJson;
}

/**
 * Build a complete single-shot prompt pack for Manual Web ($0) mode following deep_course 11-template rules.
 */
export function buildManualPromptPack({
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  existingBrief = null,
  existingDialogue = null,
  existingScript = null,
  existingNotes = "",
  openRevisions = [],
  availableSvgs = [],
  partId = null,
  maxPartDurationSec = DEFAULT_MAX_PART_DURATION_SEC,
  customInstructions = "",
  rewriteNote = "",
}) {
  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );
  const maxPartSec = resolveMaxPartDurationSec(maxPartDurationSec, courseJson);
  const svgListStr =
    Array.isArray(availableSvgs) && availableSvgs.length > 0
      ? availableSvgs.map((s) => (typeof s === "string" ? s : s?.id)).filter(Boolean).join(", ")
      : "server-rack, redis-stack, ram-stick, ssd-disk, postgres, database, docker, kubernetes, api-gateway, browser-client, cloud-infra, event-loop, kafka-queue, shield-lock, terminal-cli";

  const schemaSpec = getSchemaPromptSpec({ compact: false, pass: 2 });
  const hasAllEleven =
    schemaSpec.includes("sequence_diagram") &&
    schemaSpec.includes("memory_layout") &&
    schemaSpec.includes("code_diff") &&
    schemaSpec.includes("concept_breakdown");
  const visualTypesLabel = Array.from(new Set([...SUPPORTED_VISUAL_TYPES, ...ALL_ELEVEN_VISUAL_TYPES])).join(", ");

  const systemPrompt = [
    "You are the Lead Deep-Course Scriptwriter & Visual Director for Tech Video Studio (`deep_course` pipeline).",
    "Return STRICT VALID JSON ONLY matching:",
    '{ "script_json": { ... }, "notes_md": "# Study Notes..." }',
    "",
    "### Deep-Course Quality & Visual Standards:",
    `1. Deep-Dive Pedagogical Depth (NO superficial 3-5m episode cap; ${partId ? `focus specifically on part "${partId}" (<= ${maxPartSec}s)` : `keep cohesive <= ${maxPartSec}s pacing per conceptual part`}). Explain under-the-hood mechanisms step-by-step with concrete traces, commands, and trade-offs.`,
    "2. Dual-Text & What-vs-Why: Write natural spoken Vietnamese `narration` (preserving English tech terms) plus `tts_beats: [{ beat_id, display_text, tts_text }]` where `tts_text` normalizes acronyms/numbers phonetically for Vietnamese TTS.",
    `3. 11 Visual Templates (${visualTypesLabel}) + Visual Variety Guard:`,
    "   - Never repeat the same `visual_type` in adjacent scenes (except deliberate `code_cli` continuation).",
    "   - Use >= 3 distinct `visual_type` values; alternate `world_theme` (`\"dark\"` / `\"light\"`) and rotate `causal_mechanic`.",
    `   - Prefer \`layout_mode: "auto"\` on \`architecture\` and pick \`node.svg\` strictly from [${svgListStr}].`,
    "",
    schemaSpec,
    ...(hasAllEleven ? [] : ["", "   Additional Deep-Dive Templates (SSOT Contract):", EXTRA_FOUR_TEMPLATES_SPEC]),
    "",
    `4. Required top-level \`script_json\` metadata: { "course_id": "${courseId}", "episode_id": "${epId}", "episode_number": ${epNum}${partId ? `, "part_id": "${partId}"` : ""}, "title": "${epTitle}", "subtitle": "...", "aspect_ratio": "16:9", "language": "vi", "tts_profile": "${ttsProfile}", "tts_voice": "${ttsVoice}", "tts_rate": "${ttsRate}", "scenes": [...] }`,
  ].join("\n");

  const userParts = buildSharedTargetHeader({
    courseJson,
    curriculumMd,
    episodeMeta,
    customInstructions,
    maxPartDurationSec: maxPartSec,
  });

  if (partId) {
    userParts.push("", `# Target Part Scope: ${partId}`);
  }
  if (existingBrief) {
    userParts.push("", "## Existing Content Brief Context", JSON.stringify(existingBrief, null, 2).slice(0, 6000));
  }
  if (existingDialogue) {
    userParts.push("", "## Existing Dialogue Context", JSON.stringify(existingDialogue, null, 2).slice(0, 6000));
  }

  appendRewriteContext(userParts, { existingScript, existingNotes, openRevisions, rewriteNote });

  userParts.push("", 'Respond now with a single JSON object `{ "script_json": { ... }, "notes_md": "..." }`.');
  const user_prompt = userParts.join("\n");
  const full_prompt = `${systemPrompt}\n\n---\n\n${user_prompt}`;

  return {
    mode: "deep_course",
    system_prompt: systemPrompt,
    user_prompt,
    full_prompt,
    prompt: full_prompt,
    has_existing_script: Boolean(existingScript),
  };
}

function extractErrorSceneTag(errItem) {
  if (!errItem) return null;
  if (typeof errItem === "object" && errItem.scene_id) {
    return String(errItem.scene_id).trim();
  }
  const msg = typeof errItem === "string" ? errItem : String(errItem.message || "");
  const m = msg.match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

function formatValidationErrorList(errors = []) {
  return errors.map((e) =>
    typeof e === "string" ? e : `[${e.scene_id || "scene"}] ${e.code || "error"}: ${e.message || JSON.stringify(e)}`
  );
}

/**
 * Scene-level self-repair: prompts the LLM to fix ONLY failing scenes and merges them back.
 */
export async function repairInvalidScenes({
  provider_id,
  model,
  scriptJson,
  validation,
  courseJson = {},
  episodeMeta = {},
  validateScriptFn = validateScriptDiagrams,
  engineDir,
}) {
  if (!scriptJson || !Array.isArray(scriptJson.scenes) || scriptJson.scenes.length === 0) {
    return { repaired: false, script_json: scriptJson, validation };
  }

  const errorsBySceneIdx = new Map();
  const scenes = scriptJson.scenes;

  for (const err of validation?.errors || []) {
    const tag = extractErrorSceneTag(err);
    if (!tag) continue;
    const idx = scenes.findIndex((s, i) => (s?.id && s.id === tag) || `scene_${i + 1}` === tag);
    if (idx < 0) continue;
    if (!errorsBySceneIdx.has(idx)) errorsBySceneIdx.set(idx, []);
    errorsBySceneIdx.get(idx).push(typeof err === "string" ? err : `[${tag}] ${err.code || ""}: ${err.message}`);
  }

  if (errorsBySceneIdx.size === 0) {
    for (let i = 0; i < scenes.length; i++) {
      const singleRes = validateSingleScene(scenes[i], i);
      if (!singleRes.valid) {
        errorsBySceneIdx.set(i, formatValidationErrorList(singleRes.errors));
      }
    }
  }

  if (errorsBySceneIdx.size === 0) {
    return { repaired: false, script_json: scriptJson, validation };
  }

  const failingEntries = Array.from(errorsBySceneIdx.entries()).map(([idx, errs]) => ({
    index: idx,
    scene: scenes[idx],
    errors: errs,
  }));

  const repairSystem = [
    "You are a precision JSON Scene Repair Assistant for Tech Video Studio.",
    "Fix ONLY the invalid scene(s) listed below so every field passes validation.",
    'Return STRICT VALID JSON ONLY: { "scenes": [ ...fixed scene objects preserving each scene\'s id... ] }.',
    "",
    getSchemaPromptSpec({ compact: true, pass: 2 }),
  ].join("\n");

  const repairUser = [
    "# Failing Scenes & Exact Validation Errors",
    ...failingEntries.map(
      (entry) =>
        `## Scene #${entry.index + 1} (id="${entry.scene?.id || `scene_${entry.index + 1}`}")\nErrors:\n- ${entry.errors.join("\n- ")}\nCurrent Scene JSON:\n${JSON.stringify(entry.scene, null, 2)}`
    ),
    "",
    'Return ONLY `{ "scenes": [ ... ] }` containing the fixed scene object(s) in the same order.',
  ].join("\n\n");

  const rawReply = await callProviderChat({
    provider_id,
    model,
    messages: [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser },
    ],
    engineDir,
  });

  const parsed = parseJsonObjectLoose(rawReply);
  const fixedList = Array.isArray(parsed.scenes)
    ? parsed.scenes
    : Array.isArray(parsed.script_json?.scenes)
      ? parsed.script_json.scenes
      : parsed.scene && typeof parsed.scene === "object"
        ? [parsed.scene]
        : parsed.id && parsed.visual_type
          ? [parsed]
          : null;

  if (!fixedList || fixedList.length === 0) {
    return { repaired: false, script_json: scriptJson, validation };
  }

  const mergedScenes = [...scenes];
  for (let i = 0; i < fixedList.length; i++) {
    const fixed = fixedList[i];
    if (!fixed || typeof fixed !== "object") continue;
    const matchIdx = fixed.id ? mergedScenes.findIndex((s) => s?.id === fixed.id) : -1;
    if (matchIdx >= 0) {
      mergedScenes[matchIdx] = fixed;
    } else if (failingEntries[i]) {
      mergedScenes[failingEntries[i].index] = fixed;
    }
  }

  const mergedScript = normalizeCompiledScript(
    { ...scriptJson, scenes: mergedScenes },
    { courseJson, episodeMeta }
  );
  const nextValidation = validateScriptFn(mergedScript);
  return {
    repaired: Boolean(nextValidation.valid),
    script_json: mergedScript,
    validation: nextValidation,
  };
}

async function callProviderChat({ provider_id, model, messages, timeoutMs = DEFAULT_LLM_TIMEOUT_MS, engineDir }) {
  const execCfg = resolveProviderExecutionConfig(provider_id, engineDir);
  if (!execCfg.ok) {
    const err = new Error(execCfg.error);
    err.code = execCfg.code || "PROVIDER_UNCONFIGURED";
    throw err;
  }

  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const doFetch = async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      const isTimeout = err?.name === "AbortError" || /abort|timeout/i.test(err?.message || "");
      const e = new Error(isTimeout ? `LLM request timed out after ${timeoutMs}ms` : String(err?.message || err));
      e.code = "PROVIDER_ERROR";
      e.status = 0;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  if (provider_id === "anthropic") {
    const maxTokens = Math.max(1024, Number(process.env.VIDEO_MAKER_AI_MAX_TOKENS) || 16384);
    const res = await doFetch(`${execCfg.base_url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": execCfg.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemMsg,
        messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw classifyProviderError(res.status, res.text);
    const json = JSON.parse(res.text);
    return Array.isArray(json.content)
      ? json.content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
      : "";
  }

  if (provider_id === "gemini") {
    const contents = nonSystemMsgs.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const res = await doFetch(
      `${execCfg.base_url}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(execCfg.api_key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
          contents,
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      }
    );
    if (!res.ok) throw classifyProviderError(res.status, res.text);
    const json = JSON.parse(res.text);
    const parts = json?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p?.text || "").join("");
  }

  if (provider_id === "ollama") {
    const res = await doFetch(`${execCfg.base_url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages,
      }),
    });
    if (!res.ok) throw classifyProviderError(res.status, res.text);
    const json = JSON.parse(res.text);
    return json?.message?.content || "";
  }

  const headers = { "Content-Type": "application/json" };
  if (execCfg.api_key) {
    headers.Authorization = `Bearer ${execCfg.api_key}`;
  }

  const sendOpenAiCompatible = async (useJsonFormat) => {
    const payload = {
      model,
      messages,
      temperature: 0.3,
    };
    if (useJsonFormat) {
      payload.response_format = { type: "json_object" };
    }
    return doFetch(`${execCfg.base_url}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  };

  let res = await sendOpenAiCompatible(provider_id !== "lmstudio");
  if (!res.ok && res.status === 400 && /response_format/i.test(res.text)) {
    res = await sendOpenAiCompatible(false);
  }
  if (!res.ok) throw classifyProviderError(res.status, res.text);

  const json = JSON.parse(res.text);
  return json?.choices?.[0]?.message?.content || "";
}

async function validateAndRepairScript({
  scriptJson,
  notesMd,
  provider_id,
  model,
  courseJson,
  episodeMeta,
  dialogueJson = null,
  audioSpine = null,
  partSpec = null,
  validateScriptFn,
  onProgress,
  engineDir,
}) {
  let currentScript = normalizeCompiledScript(scriptJson, {
    courseJson,
    episodeMeta,
    dialogueJson,
    audioSpine,
    partSpec,
  });
  let validation = validateScriptFn(currentScript);
  let extraCalls = 0;

  for (let r = 0; r < MAX_SELF_REPAIR_RETRIES && !validation.valid; r++) {
    onProgress?.({
      phase: "repairing",
      message: `Scene-level self-repair attempt ${r + 1} (${validation.errors.length} error(s))...`,
    });
    try {
      const repairRes = await repairInvalidScenes({
        provider_id,
        model,
        scriptJson: currentScript,
        validation,
        courseJson,
        episodeMeta,
        validateScriptFn,
        engineDir,
      });
      extraCalls += 1;
      currentScript = normalizeCompiledScript(repairRes.script_json, {
        courseJson,
        episodeMeta,
        dialogueJson,
        audioSpine,
        partSpec,
      });
      validation = repairRes.validation;
      if (repairRes.repaired) {
        break;
      }
      if (repairRes.script_json === scriptJson) {
        break;
      }
    } catch (repairErr) {
      if (repairErr?.code === "QUOTA_EXHAUSTED" || repairErr?.code === "AUTH_INVALID") {
        throw repairErr;
      }
      break;
    }
  }

  return { script_json: currentScript, notes_md: notesMd, validation, extraCalls };
}

async function runJsonStageLoop({
  provider_id,
  model,
  system_prompt,
  user_prompt,
  parseFn,
  retryHint,
  phase,
  stageLabel,
  onProgress,
  engineDir,
}) {
  const messages = [
    { role: "system", content: system_prompt },
    { role: "user", content: user_prompt },
  ];
  let lastErr = null;
  let calls = 0;
  for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
    onProgress?.({
      phase,
      message: `${stageLabel} (${provider_id}${model ? `/${model}` : ""}, attempt ${attempt + 1})...`,
    });
    const rawReply = await callProviderChat({ provider_id, model, messages, engineDir });
    calls += 1;
    try {
      const value = parseFn(rawReply);
      return { value, calls };
    } catch (err) {
      if (err?.code === "QUOTA_EXHAUSTED" || err?.code === "AUTH_INVALID") {
        throw err;
      }
      lastErr = err;
      messages.push({ role: "assistant", content: rawReply });
      messages.push({
        role: "user",
        content: `Your output was invalid (${err.message}).\n${retryHint}`,
      });
    }
  }
  const finalErr = new Error(lastErr?.message || `Failed during ${stageLabel}.`);
  finalErr.code = "SCRIPT_VALIDATION_FAILED";
  throw finalErr;
}

async function compilePartVisuals({
  directorProv,
  directorMdl,
  repairProv,
  repairMdl,
  partSpec,
  dialogueJson,
  audioSpine,
  notesMd,
  availableSvgs,
  courseJson,
  episodeMeta,
  existingScript,
  openRevisions,
  customInstructions,
  rewriteNote,
  validateScriptFn,
  onProgress,
  engineDir,
}) {
  const s3 = buildVisualDirectionPrompt({
    dialogueJson,
    partSpec,
    audioSpine,
    availableSvgs,
    courseJson,
    episodeMeta,
    existingScript,
    openRevisions,
    customInstructions,
    rewriteNote,
  });
  const s3Messages = [
    { role: "system", content: s3.system_prompt },
    { role: "user", content: s3.user_prompt },
  ];
  let calls = 0;
  let lastStage3Err = null;
  for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
    onProgress?.({
      phase: "stage_3_visual",
      message: `Stage 3 Visual Director [${partSpec.part_id}] (${directorProv}${directorMdl ? `/${directorMdl}` : ""}, attempt ${attempt + 1})...`,
    });
    const rawReply = await callProviderChat({
      provider_id: directorProv,
      model: directorMdl,
      messages: s3Messages,
      engineDir,
    });
    calls += 1;
    try {
      const parsed = parseAiScriptPayload(rawReply, notesMd);
      const checked = await validateAndRepairScript({
        scriptJson: parsed.script_json,
        notesMd: parsed.notes_md || notesMd,
        provider_id: repairProv,
        model: repairMdl,
        courseJson,
        episodeMeta,
        dialogueJson,
        audioSpine,
        partSpec,
        validateScriptFn,
        onProgress,
        engineDir,
      });
      calls += checked.extraCalls;
      if (checked.validation.valid) {
        return {
          script_json: checked.script_json,
          notes_md: checked.notes_md,
          validation: checked.validation,
          calls,
        };
      }
      const errSummary = formatValidationErrorList(checked.validation.errors).join("\n- ");
      lastStage3Err = new Error(`Diagram/Template validation failed:\n- ${errSummary}`);
      s3Messages.push({ role: "assistant", content: rawReply });
      s3Messages.push({
        role: "user",
        content: `Stage 3 Visual JSON failed validation:\n- ${errSummary}\n\nFix ONLY the invalid visual fields while preserving dialogue wording, and return { "script_json": ..., "notes_md": ... }.`,
      });
    } catch (err) {
      if (err?.code === "QUOTA_EXHAUSTED" || err?.code === "AUTH_INVALID") {
        throw err;
      }
      lastStage3Err = err;
      s3Messages.push({ role: "assistant", content: rawReply });
      s3Messages.push({
        role: "user",
        content: `Invalid Stage 3 script JSON: ${err.message}\nReturn ONLY valid { "script_json": { "scenes": [...] }, "notes_md": "..." }.`,
      });
    }
  }
  const finalErr = new Error(lastStage3Err?.message || `Failed in Stage 3 Visual Director for ${partSpec.part_id}.`);
  finalErr.code = "SCRIPT_VALIDATION_FAILED";
  throw finalErr;
}

function buildCombinedEpisodePreview({ partsOutput, briefJson, courseJson, episodeMeta, validateScriptFn }) {
  const partEntries = Object.entries(partsOutput);
  if (partEntries.length === 0) {
    return {
      dialogue_json: null,
      script_json: null,
      notes_md: "",
      validation: { valid: true, errors: [], warnings: [], scene_count: 0 },
    };
  }
  if (partEntries.length === 1) {
    const [, single] = partEntries[0];
    return {
      dialogue_json: single.dialogue_json || null,
      script_json: single.script_json || null,
      notes_md: single.notes_md || "",
      validation: single.validation || { valid: true, errors: [], warnings: [], scene_count: 0 },
    };
  }

  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );
  const allBeats = [];
  const allScenes = [];
  const notesSections = [];
  for (const [partId, out] of partEntries) {
    if (Array.isArray(out.dialogue_json?.beats)) {
      allBeats.push(...out.dialogue_json.beats);
    }
    if (Array.isArray(out.script_json?.scenes)) {
      for (let i = 0; i < out.script_json.scenes.length; i++) {
        const cloned = structuredClone(out.script_json.scenes[i]);
        const origId = String(cloned.id || `scene_${i + 1}`).trim();
        cloned.id = origId.startsWith(`${partId}_`) ? origId : `${partId}_${origId}`;
        cloned.source_part = partId;
        allScenes.push(cloned);
      }
    }
    if (out.notes_md && String(out.notes_md).trim()) {
      notesSections.push(`# ${partId}\n\n${String(out.notes_md).trim()}`);
    }
  }

  const combinedDialogue =
    allBeats.length > 0
      ? {
          course_id: briefJson?.course_id || courseId,
          episode_id: briefJson?.episode_id || epId,
          episode_number: briefJson?.episode_number ?? epNum,
          title: briefJson?.title || epTitle,
          subtitle: briefJson?.subtitle || "",
          tts_profile: ttsProfile,
          tts_voice: ttsVoice,
          tts_rate: ttsRate,
          beats: allBeats,
        }
      : null;

  const combinedScript =
    allScenes.length > 0
      ? {
          course_id: briefJson?.course_id || courseId,
          episode_id: briefJson?.episode_id || epId,
          episode_number: briefJson?.episode_number ?? epNum,
          title: briefJson?.title || epTitle,
          subtitle: briefJson?.subtitle || "",
          aspect_ratio: "16:9",
          language: "vi",
          tts_profile: ttsProfile,
          tts_voice: ttsVoice,
          tts_rate: ttsRate,
          scenes: allScenes,
        }
      : null;

  const validation = combinedScript
    ? validateScriptFn(combinedScript)
    : { valid: true, errors: [], warnings: [], scene_count: 0 };

  return {
    dialogue_json: combinedDialogue,
    script_json: combinedScript,
    notes_md: notesSections.join("\n\n---\n\n"),
    validation,
  };
}

/**
 * Unified Deep-Course Multi-Part Orchestrator:
 * Stage 1 (Brief) -> Stage 1.5 (Brief Review) -> per-part loop:
 * [Stage 2 (Dialogue + Notes) -> Stage 2.5 (Independent Content Reviewer up to 2 rounds) -> Audio-Spine Hook -> Stage 3 (11-Template Visual Compile + Repair)].
 */
export async function generateEpisodeScript({
  provider_id,
  model,
  compiler_provider_id = null,
  compiler_model = null,
  role_routing = null,
  mode = "deep_course",
  pause_after = "none",
  start_from = null,
  part_id = null,
  max_part_duration_sec = null,
  skip_brief_review = false,
  skip_content_review = false,
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  existingBrief = null,
  existingBriefReviewMd = "",
  existingDialogue = null,
  existingParts = null,
  audioSpine = null,
  availableSvgs = [],
  existingScript = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
  validateScriptFn = validateScriptDiagrams,
  onBeforeVisualStage = null,
  onProgress = null,
  engineDir,
}) {
  // Accept legacy modes cleanly and unify onto "deep_course"
  normalizeGenerationMode(mode);
  const effectivePauseAfter = VALID_PAUSE_AFTER.has(pause_after) ? pause_after : "none";
  const effectiveStartFrom = VALID_START_FROM.has(start_from) ? start_from : null;
  const maxPartSec = resolveMaxPartDurationSec(max_part_duration_sec, courseJson);
  const targetPartFilter = part_id ? String(part_id).trim() : null;

  const pass2Provider = compiler_provider_id || provider_id;
  const pass2Model = compiler_model || model;
  const briefProv = role_routing?.brief_scriptwriter?.provider_id || provider_id;
  const briefMdl = role_routing?.brief_scriptwriter?.model || model;
  const reviewerProv = role_routing?.content_reviewer?.provider_id || briefProv;
  const reviewerMdl = role_routing?.content_reviewer?.model || briefMdl;
  const directorProv = role_routing?.visual_director?.provider_id || pass2Provider;
  const directorMdl = role_routing?.visual_director?.model || pass2Model;
  const repairProv = role_routing?.repair?.provider_id || directorProv;
  const repairMdl = role_routing?.repair?.model || directorMdl;

  let totalCalls = 0;
  let briefJson = null;
  if (existingBrief && typeof existingBrief === "object") {
    try {
      briefJson = normalizeBriefObject(existingBrief, {
        courseJson,
        episodeMeta,
        maxPartDurationSec: maxPartSec,
      });
    } catch {
      briefJson = null;
    }
  }
  let briefReviewJson = null;
  let briefReviewMd = String(existingBriefReviewMd || "");
  const partsDiskMap = existingParts && typeof existingParts === "object" ? existingParts : {};
  const hasAnyExistingDialogue =
    Boolean(existingDialogue && Array.isArray(existingDialogue.beats) && existingDialogue.beats.length > 0) ||
    Object.values(partsDiskMap).some((p) => Array.isArray(p?.dialogue_json?.beats) && p.dialogue_json.beats.length > 0);

  // Stage 1: Master Content Brief + Stage 1.5: Independent Brief Review (unless resuming later stage)
  const skipStage1 =
    (effectiveStartFrom === "dialogue" && Boolean(briefJson)) ||
    (effectiveStartFrom === "visual" && (Boolean(briefJson) || hasAnyExistingDialogue));

  if (!skipStage1) {
    let briefRewriteGuidance = "";
    const maxBriefRounds = skip_brief_review ? 1 : MAX_CONTENT_REVIEW_ROUNDS;
    for (let round = 1; round <= maxBriefRounds; round++) {
      const s1 = buildContentBriefPrompt({
        courseJson,
        curriculumMd,
        episodeMeta,
        existingBrief: briefJson,
        existingScript,
        openRevisions,
        customInstructions,
        rewriteNote,
        rewriteInstructions: briefRewriteGuidance,
        maxPartDurationSec: maxPartSec,
      });
      const res1 = await runJsonStageLoop({
        provider_id: briefProv,
        model: briefMdl,
        system_prompt: s1.system_prompt,
        user_prompt: s1.user_prompt,
        parseFn: (raw) =>
          parseBriefPayload(raw, {
            courseJson,
            episodeMeta,
            maxPartDurationSec: maxPartSec,
          }),
        retryHint: 'Return ONLY valid JSON: { "brief": { "episode_canon": {...}, "parts": [...] } }.',
        phase: "stage_1_brief",
        stageLabel: round === 1 ? "Stage 1 Content Brief" : `Stage 1 Content Brief Revision (Round ${round})`,
        onProgress,
        engineDir,
      });
      briefJson = res1.value;
      totalCalls += res1.calls;

      if (skip_brief_review) break;

      const brRes = await reviewContentBrief({
        provider_id: reviewerProv,
        model: reviewerMdl,
        briefJson,
        courseJson,
        curriculumMd,
        episodeMeta,
        round,
        maxPartDurationSec: maxPartSec,
        onProgress,
        engineDir,
      });
      totalCalls += brRes.calls;
      briefReviewJson = brRes.review_json;
      briefReviewMd = brRes.review_md;
      if (!brRes.needs_rewrite || round >= maxBriefRounds) {
        break;
      }
      briefRewriteGuidance =
        brRes.review_json.rewrite_instructions ||
        [...brRes.review_json.blocker_issues, ...brRes.review_json.major_issues].join("\n");
    }

    if (effectivePauseAfter === "brief") {
      return {
        mode: "deep_course",
        mode_used: "deep_course",
        paused_at: "brief",
        paused_part_id: null,
        brief_json: briefJson,
        brief_review_json: briefReviewJson,
        brief_review_md: briefReviewMd,
        parts: {},
        dialogue_json: null,
        script_json: null,
        audio_spine: null,
        notes_md: String(existingNotes || ""),
        validation: { valid: true, errors: [], warnings: [], scene_count: 0 },
        attempts: totalCalls,
      };
    }
  }

  // Synthesize minimal brief wrapper when resuming at visual with root existingDialogue only
  if (!briefJson && hasAnyExistingDialogue) {
    const fallbackBeats = Array.isArray(existingDialogue?.beats) ? existingDialogue.beats : [];
    briefJson = {
      course_id: courseJson.course || courseJson.id || "",
      episode_id: episodeMeta.id || episodeMeta.episode_id || "",
      episode_number: episodeMeta.number || 1,
      title: existingDialogue?.title || episodeMeta.title || "",
      subtitle: existingDialogue?.subtitle || "",
      hook_angle: { family: "conflict", conflict_statement: "", stakes: "" },
      narrative_arc: { setup: "", escalation: "", reversal: "" },
      episode_canon: { shared_glossary: [], running_example: "", audience_level: "", target_total_duration_sec: 260 },
      parts: [
        {
          part_id: targetPartFilter || "part_01",
          part_number: 1,
          title: existingDialogue?.title || episodeMeta.title || "Part 1",
          target_duration_sec: 260,
          must_cover_concepts: [],
          entry_bridge: "",
          exit_bridge: "",
          teaching_beats: fallbackBeats.map((b, i) => ({
            id: b.beat_id || `beat_${i + 1}`,
            part: b.part || "architecture",
            goal: b.spoken_purpose || b.display_text || "Goal",
            key_claim: b.display_text || "Claim",
            concrete_proof_anchor: b.on_screen_fact || "",
          })),
        },
      ],
      teaching_beats: [],
    };
  }

  const allBriefParts = Array.isArray(briefJson?.parts) ? briefJson.parts : [];
  if (allBriefParts.length === 0) {
    throw new Error("deep_course pipeline requires a valid brief with non-empty parts[].");
  }
  if (targetPartFilter && !allBriefParts.some((p) => p.part_id === targetPartFilter)) {
    throw new Error(
      `Part "${targetPartFilter}" not found in brief.parts (${allBriefParts.map((p) => p.part_id).join(", ")}).`
    );
  }

  const partsOutput = {};
  let priorHandoff = null;

  for (let pIdx = 0; pIdx < allBriefParts.length; pIdx++) {
    const partSpec = allBriefParts[pIdx];
    const partId = partSpec.part_id;
    const diskEntry = partsDiskMap[partId] || {};
    const fallbackRootDialogue = allBriefParts.length === 1 ? existingDialogue : null;
    const fallbackRootNotes = allBriefParts.length === 1 ? existingNotes : "";
    const fallbackRootSpine = allBriefParts.length === 1 ? audioSpine : null;
    const fallbackRootScript = allBriefParts.length === 1 ? existingScript : null;

    let partDialogue =
      diskEntry.dialogue_json && Array.isArray(diskEntry.dialogue_json.beats)
        ? diskEntry.dialogue_json
        : fallbackRootDialogue && Array.isArray(fallbackRootDialogue.beats)
          ? fallbackRootDialogue
          : null;
    let partNotes = String(diskEntry.notes_md ?? fallbackRootNotes ?? "");
    let partReviewJson = null;
    let partReviewMd = String(diskEntry.review_md || "");
    let partSpine = diskEntry.audio_spine || fallbackRootSpine || null;
    const partExistingScript = diskEntry.script_json || fallbackRootScript || null;

    // If targeting a specific later part, capture handoff from prior part on disk without re-generating prior parts
    if (targetPartFilter && partId !== targetPartFilter) {
      if (partDialogue) {
        priorHandoff = buildPartHandoff(partDialogue, partSpec);
      } else {
        priorHandoff = {
          part_id: partId,
          title: partSpec.title,
          covered_concepts: partSpec.must_cover_concepts || [],
          key_terms_and_identifiers: [],
          exit_bridge: partSpec.exit_bridge || "",
          final_sentences: [],
        };
      }
      continue;
    }

    const nextSpec = allBriefParts[pIdx + 1]
      ? {
          part_id: allBriefParts[pIdx + 1].part_id,
          title: allBriefParts[pIdx + 1].title,
          entry_bridge: allBriefParts[pIdx + 1].entry_bridge,
        }
      : null;

    const skipStage2ForPart = effectiveStartFrom === "visual" && Boolean(partDialogue);

    if (!skipStage2ForPart) {
      const s2 = buildPartDialoguePrompt({
        briefJson,
        partSpec,
        partIndex: pIdx,
        totalParts: allBriefParts.length,
        previousPartHandoff: priorHandoff,
        nextPartPreview: nextSpec,
        courseJson,
        episodeMeta,
        existingDialogue: partDialogue,
        existingNotes: partNotes,
        openRevisions,
        customInstructions,
        rewriteNote,
      });
      const res2 = await runJsonStageLoop({
        provider_id: briefProv,
        model: briefMdl,
        system_prompt: s2.system_prompt,
        user_prompt: s2.user_prompt,
        parseFn: (raw) =>
          parseDialoguePayload(raw, {
            briefJson,
            partSpec,
            courseJson,
            episodeMeta,
            fallbackNotes: partNotes,
          }),
        retryHint: 'Return ONLY valid JSON: { "dialogue": { "beats": [...] }, "notes_md": "..." }.',
        phase: "stage_2_dialogue",
        stageLabel: `Stage 2 Dialogue & TTS Beats (${partId})`,
        onProgress,
        engineDir,
      });
      partDialogue = res2.value.dialogue;
      partNotes = res2.value.notes_md || partNotes;
      totalCalls += res2.calls;

      if (effectivePauseAfter !== "dialogue" && !skip_content_review) {
        // Stage 2.5: Independent Content Reviewer Loop (max 2 rounds, fresh context every round)
        for (let round = 1; round <= MAX_CONTENT_REVIEW_ROUNDS; round++) {
          const revRes = await reviewPartDialogue({
            provider_id: reviewerProv,
            model: reviewerMdl,
            briefJson,
            partSpec,
            dialogueJson: partDialogue,
            notesMd: partNotes,
            previousPartHandoff: priorHandoff,
            courseJson,
            episodeMeta,
            round,
            maxPartDurationSec: maxPartSec,
            onProgress,
            engineDir,
          });
          totalCalls += revRes.calls;
          partReviewJson = revRes.review_json;
          partReviewMd = revRes.review_md;

          if (!revRes.needs_rewrite || round >= MAX_CONTENT_REVIEW_ROUNDS) {
            break;
          }

          const rewriteGuidance =
            revRes.review_json.rewrite_instructions ||
            [...revRes.review_json.blocker_issues, ...revRes.review_json.major_issues].join("\n");
          const s2Fix = buildPartDialoguePrompt({
            briefJson,
            partSpec,
            partIndex: pIdx,
            totalParts: allBriefParts.length,
            previousPartHandoff: priorHandoff,
            nextPartPreview: nextSpec,
            courseJson,
            episodeMeta,
            existingDialogue: partDialogue,
            existingNotes: partNotes,
            openRevisions,
            customInstructions,
            rewriteNote,
            rewriteInstructions: rewriteGuidance,
          });
          const res2Fix = await runJsonStageLoop({
            provider_id: briefProv,
            model: briefMdl,
            system_prompt: s2Fix.system_prompt,
            user_prompt: s2Fix.user_prompt,
            parseFn: (raw) =>
              parseDialoguePayload(raw, {
                briefJson,
                partSpec,
                courseJson,
                episodeMeta,
                fallbackNotes: partNotes,
              }),
            retryHint: 'Return ONLY valid JSON: { "dialogue": { "beats": [...] }, "notes_md": "..." }.',
            phase: "stage_2_dialogue",
            stageLabel: `Stage 2 Dialogue Revision (${partId}, Round ${round})`,
            onProgress,
            engineDir,
          });
          partDialogue = res2Fix.value.dialogue;
          partNotes = res2Fix.value.notes_md || partNotes;
          totalCalls += res2Fix.calls;
        }
      }
    }

    partsOutput[partId] = {
      part_spec: partSpec,
      dialogue_json: partDialogue,
      review_json: partReviewJson,
      review_md: partReviewMd,
      audio_spine: partSpine,
      script_json: null,
      notes_md: partNotes,
      validation: { valid: true, errors: [], warnings: [], scene_count: 0 },
    };
    priorHandoff = buildPartHandoff(partDialogue, partSpec);
  }

  // Pause gates before Stage 3 Visual Compile
  if (effectivePauseAfter === "dialogue" || effectivePauseAfter === "part_review") {
    const preview = buildCombinedEpisodePreview({
      partsOutput,
      briefJson,
      courseJson,
      episodeMeta,
      validateScriptFn,
    });
    return {
      mode: "deep_course",
      mode_used: "deep_course",
      paused_at: effectivePauseAfter,
      paused_part_id: targetPartFilter,
      brief_json: briefJson,
      brief_review_json: briefReviewJson,
      brief_review_md: briefReviewMd,
      parts: partsOutput,
      dialogue_json: preview.dialogue_json,
      script_json: null,
      audio_spine: null,
      notes_md: preview.notes_md,
      validation: { valid: true, errors: [], warnings: [], scene_count: 0 },
      attempts: totalCalls,
    };
  }

  // Stage 3: Per-Part Audio-Spine Lock Hook -> Visual Compile across 11 Templates + Targeted Repair
  for (const [partId, pOut] of Object.entries(partsOutput)) {
    const partSpec = pOut.part_spec;
    let activePartSpine = pOut.audio_spine;
    if (typeof onBeforeVisualStage === "function") {
      onProgress?.({
        phase: "audio_spine_lock",
        message: `Locking Audio-Spine beat durations for ${partId} before Visual Director...`,
      });
      const hookSpine = await onBeforeVisualStage({
        part_id: partId,
        brief_json: briefJson,
        dialogue_json: pOut.dialogue_json,
        review_json: pOut.review_json,
        review_md: pOut.review_md,
        notes_md: pOut.notes_md,
      });
      if (hookSpine && typeof hookSpine === "object") {
        activePartSpine = hookSpine;
        pOut.audio_spine = hookSpine;
      }
    }

    const diskEntry = partsDiskMap[partId] || {};
    const compiledPart = await compilePartVisuals({
      directorProv,
      directorMdl,
      repairProv,
      repairMdl,
      partSpec,
      dialogueJson: pOut.dialogue_json,
      audioSpine: activePartSpine,
      notesMd: pOut.notes_md,
      availableSvgs,
      courseJson,
      episodeMeta,
      existingScript: diskEntry.script_json || (allBriefParts.length === 1 ? existingScript : null),
      openRevisions,
      customInstructions,
      rewriteNote,
      validateScriptFn,
      onProgress,
      engineDir,
    });
    totalCalls += compiledPart.calls;
    pOut.script_json = compiledPart.script_json;
    pOut.notes_md = compiledPart.notes_md || pOut.notes_md;
    pOut.validation = compiledPart.validation;
  }

  const combined = buildCombinedEpisodePreview({
    partsOutput,
    briefJson,
    courseJson,
    episodeMeta,
    validateScriptFn,
  });
  const firstSpine = Object.values(partsOutput).find((p) => p?.audio_spine)?.audio_spine || null;

  return {
    mode: "deep_course",
    mode_used: "deep_course",
    paused_at: null,
    paused_part_id: null,
    brief_json: briefJson,
    brief_review_json: briefReviewJson,
    brief_review_md: briefReviewMd,
    parts: partsOutput,
    dialogue_json: combined.dialogue_json,
    audio_spine: firstSpine,
    script_json: combined.script_json,
    notes_md: combined.notes_md,
    validation: combined.validation,
    attempts: totalCalls,
  };
}
