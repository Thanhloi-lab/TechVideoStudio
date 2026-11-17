import { resolveProviderExecutionConfig } from "./providers.mjs";
import { validateScriptDiagrams, validateSingleScene } from "../src/diagram_validator.mjs";
import { getSchemaPromptSpec } from "../src/template_schema.mjs";
import { SUPPORTED_VISUAL_TYPES } from "../src/motion/kernel.mjs";

const DEFAULT_LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.VIDEO_MAKER_AI_TIMEOUT_MS) || 120_000);
const MAX_SELF_REPAIR_RETRIES = 2;
const VALID_GENERATION_MODES = new Set(["auto", "two_pass", "single_pass", "storyboard_only"]);

function sanitizeErr(text) {
  return String(text || "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1REDACTED")
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, "REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1REDACTED")
    .trim()
    .slice(0, 600);
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
  // Also handle prose before/after a JSON code block
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
    // Try extracting outermost JSON object if extra text surrounded it
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

  if (!parsed || typeof parsed !== "object") {
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

function parseStoryboardPayload(rawText, fallbackNotes = "") {
  const parsed = parseJsonObjectLoose(rawText);
  const notesMd = parsed.notes_md ?? parsed.notesMd ?? null;
  const resolvedNotes = notesMd !== null && notesMd !== undefined ? String(notesMd) : String(fallbackNotes || "");

  // Case A: Model already returned full script_json (single-shot shortcut or mock provider)
  const candidateScript = parsed.script_json ?? parsed.scriptJson ?? null;
  if (candidateScript && typeof candidateScript === "object" && Array.isArray(candidateScript.scenes) && candidateScript.scenes.length > 0) {
    const hasVisualData = candidateScript.scenes.some((s) => s && typeof s.visual_data === "object");
    if (hasVisualData) {
      return {
        is_full_script: true,
        script_json: candidateScript,
        notes_md: resolvedNotes,
      };
    }
  }

  // Case B: Top-level scenes[] already containing full visual_data
  if (!parsed.storyboard && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
    const hasVisualData = parsed.scenes.some((s) => s && typeof s.visual_data === "object");
    const hasIntentOnly = parsed.scenes.some((s) => s && typeof s.visual_intent === "object" && !s.visual_data);
    if (hasVisualData && !hasIntentOnly) {
      return {
        is_full_script: true,
        script_json: parsed,
        notes_md: resolvedNotes,
      };
    }
  }

  // Case C: Storyboard object
  let storyboard = parsed.storyboard && typeof parsed.storyboard === "object" ? parsed.storyboard : null;
  if (!storyboard && candidateScript && Array.isArray(candidateScript.scenes)) {
    storyboard = candidateScript;
  } else if (!storyboard && Array.isArray(parsed.scenes)) {
    storyboard = parsed;
  }

  if (!storyboard || !Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    throw new Error('JSON output must contain a "storyboard" (or "script_json") object with a non-empty "scenes" array.');
  }

  return {
    is_full_script: false,
    storyboard,
    notes_md: resolvedNotes,
  };
}

/**
 * Compact curriculum.md around the target stage/episode (~1500-2500 chars)
 * instead of blindly slicing 6000 chars.
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

  // 1. Capture brief course overview before the first ## heading
  const overviewLines = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) break;
    overviewLines.push(line);
  }
  const overview = overviewLines.join("\n").trim().slice(0, 420);

  // 2. Split into ## / ### sections
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

  // 3. Score sections by relevance to episodeMeta
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
    // Fallback: slice cleanly at newline
    const cut = raw.slice(0, maxChars);
    const lastNl = cut.lastIndexOf("\n");
    return (lastNl > maxChars * 0.6 ? cut.slice(0, lastNl) : cut).trim();
  }

  const budgetForSection = Math.max(800, maxChars - (overview ? overview.length + 12 : 0));
  let focusedBody = best.body;

  if (focusedBody.length > budgetForSection) {
    // Center window around the specific episode match while keeping section heading
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
  if (Array.isArray(openRevisions) && openRevisions.length > 0) {
    userParts.push(
      "",
      "## Open Revision Tickets",
      ...openRevisions.map(
        (r) => `- [${r.id}] (${r.scope}${r.scene_id ? ` / ${r.scene_id}` : ""}): ${r.description}`
      )
    );
  }
  if (existingScript) {
    userParts.push("", "## Existing script.json", JSON.stringify(existingScript, null, 2).slice(0, 18000));
  }
  if (existingNotes) {
    userParts.push("", "## Existing notes.md", String(existingNotes).slice(0, 4000));
  }
}

export function buildScriptPrompt({
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  existingScript = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
}) {
  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );

  const systemPrompt = [
    "You are the Lead Curriculum Scriptwriter & Visual Motion Architect for Tech Video Studio.",
    "Return STRICT VALID JSON ONLY (no prose before or after, no markdown fences if avoidable) matching exactly:",
    '{ "script_json": { ... }, "notes_md": "# Markdown study notes..." }',
    "",
    "### Blueprint & Scene Rules:",
    "1. Use the 4-part episode blueprint (`part` field on each scene):",
    '   - "problem": Hook & real-world pain point',
    '   - "architecture": Deep-dive mechanism / architecture',
    '   - "setup": Hands-on CLI / Console / Code walkthrough',
    '   - "exam_tips": Certification exam traps, summary & review quiz',
    "2. Visual Templates & V2 Motion Fields (prefer `layout_mode: \"auto\"` on `architecture` so manual node x/y are optional):",
    getSchemaPromptSpec({ compact: true, pass: 2 }),
    "3. Narration & Study Notes:",
    "   - `narration`: natural spoken Vietnamese script (3–5 minute total episode pacing; clear technical English terms kept intact).",
    "   - `highlight_words`: `string[]` of technical terms to highlight in box-free subtitles.",
    "   - `key_points`: `string[]` concise bullet takeaways.",
    "4. Required top-level `script_json` metadata:",
    `   { "course_id": "${courseId}", "episode_id": "${epId}", "episode_number": ${epNum}, "title": "...", "subtitle": "...", "aspect_ratio": "16:9", "language": "vi", "tts_profile": "${ttsProfile}", "tts_voice": "${ttsVoice}", "tts_rate": "${ttsRate}", "scenes": [...] }`,
  ].join("\n");

  const userParts = [
    `# Target Episode`,
    `- Course: ${courseId} (${courseJson.title || courseId})`,
    `- Episode ID: ${epId} (#${epNum})`,
    `- Title: ${epTitle}`,
    episodeMeta.duration_target ? `- Target Duration: ${episodeMeta.duration_target}` : "",
    episodeMeta.stage_title ? `- Stage: ${episodeMeta.stage_title}` : "",
  ].filter(Boolean);

  const compactCurriculum = extractRelevantCurriculumContext(curriculumMd, episodeMeta);
  if (compactCurriculum) {
    userParts.push("", "# Course Curriculum Context", compactCurriculum);
  }

  if (customInstructions) {
    userParts.push("", "# Additional User Instructions", customInstructions);
  }

  appendRewriteContext(userParts, { existingScript, existingNotes, openRevisions, rewriteNote });

  userParts.push(
    "",
    'Respond now with a single JSON object `{ "script_json": { ... }, "notes_md": "..." }`.'
  );

  return {
    system_prompt: systemPrompt,
    user_prompt: userParts.join("\n"),
    has_existing_script: Boolean(existingScript),
  };
}

/**
 * Pass 1 prompt: produces a cohesive 4-part episode storyboard + spoken narration + visual_intent.
 */
export function buildStoryboardPrompt({
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  existingScript = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
}) {
  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );

  const systemPrompt = [
    "You are the Lead Curriculum Architect & Storyboard Director for Tech Video Studio (Pass 1).",
    "Return STRICT VALID JSON ONLY matching either:",
    '  { "storyboard": { "course_id": "...", "episode_id": "...", "episode_number": 1, "title": "...", "subtitle": "...", "scenes": [...] }, "notes_md": "# Markdown study notes..." }',
    "OR a complete validated `{ \"script_json\": { ... }, \"notes_md\": \"...\" }` if emitting full runtime visual_data directly.",
    "",
    "### Episode Arc & Storyboard Contract:",
    "1. Cover all 4 blueprint parts (`problem`, `architecture`, `setup`, `exam_tips`) across ~6–8 well-paced scenes (3–5 minutes total).",
    "2. Write complete, natural spoken Vietnamese `narration` (keeping English tech terms intact), `highlight_words[]`, and `key_points[]` for each scene.",
    `3. Metadata defaults: tts_profile="${ttsProfile}", tts_voice="${ttsVoice}", tts_rate="${ttsRate}".`,
    getSchemaPromptSpec({ compact: true, pass: 1 }),
  ].join("\n");

  const userParts = [
    `# Target Episode`,
    `- Course: ${courseId} (${courseJson.title || courseId})`,
    `- Episode ID: ${epId} (#${epNum})`,
    `- Title: ${epTitle}`,
    episodeMeta.duration_target ? `- Target Duration: ${episodeMeta.duration_target}` : "",
    episodeMeta.stage_title ? `- Stage: ${episodeMeta.stage_title}` : "",
  ].filter(Boolean);

  const compactCurriculum = extractRelevantCurriculumContext(curriculumMd, episodeMeta);
  if (compactCurriculum) {
    userParts.push("", "# Course Curriculum Context", compactCurriculum);
  }

  if (customInstructions) {
    userParts.push("", "# Additional User Instructions", customInstructions);
  }

  appendRewriteContext(userParts, { existingScript, existingNotes, openRevisions, rewriteNote });

  userParts.push(
    "",
    'Respond with a single JSON object `{ "storyboard": { ... }, "notes_md": "..." }`.'
  );

  return {
    system_prompt: systemPrompt,
    user_prompt: userParts.join("\n"),
    has_existing_script: Boolean(existingScript),
  };
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
 * Deterministically normalize compiled script_json:
 * - Fill missing script metadata defaults from courseJson/episodeMeta
 * - Fill missing progress_start/progress_end in [0..1] proportionally
 * - Set layout_mode: "auto" on architecture scenes missing node x, y
 */
export function normalizeCompiledScript(scriptJson, { courseJson = {}, episodeMeta = {} } = {}) {
  if (!scriptJson || typeof scriptJson !== "object") return scriptJson;

  const { courseId, epId, epNum, epTitle, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );

  if (!scriptJson.course_id && courseId) scriptJson.course_id = courseId;
  if (!scriptJson.episode_id && epId) scriptJson.episode_id = epId;
  if (scriptJson.episode_number === undefined && epNum) scriptJson.episode_number = epNum;
  if (!scriptJson.title && epTitle) scriptJson.title = epTitle;
  if (!scriptJson.aspect_ratio) scriptJson.aspect_ratio = "16:9";
  if (!scriptJson.language) scriptJson.language = "vi";
  if (!scriptJson.tts_profile) scriptJson.tts_profile = ttsProfile;
  if (!scriptJson.tts_voice) scriptJson.tts_voice = ttsVoice;
  if (!scriptJson.tts_rate) scriptJson.tts_rate = ttsRate;

  const scenes = Array.isArray(scriptJson.scenes) ? scriptJson.scenes : [];
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") continue;
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
            (cmd.progress_start === undefined || cmd.progress_start === null || !Number.isFinite(Number(cmd.progress_start)))
          ) {
            cmd.progress_start = Number(((idx / cn) * 0.85).toFixed(3));
          }
        });
      }
    } else if (vtype === "timeline_flow") {
      fillProportionalIntervals(vd.milestones, "progress_start", "progress_end");
    }
  }

  return scriptJson;
}

/**
 * Pass 2 compiler: converts a Pass 1 storyboard into full strict runtime script_json + notes_md.
 */
export async function compileStoryboardToScript({
  provider_id,
  model,
  storyboard,
  notesMd = "",
  courseJson = {},
  episodeMeta = {},
  existingScript = null,
  customInstructions = "",
  rewriteNote = "",
  engineDir,
}) {
  const { courseId, epId, epNum, ttsProfile, ttsVoice, ttsRate } = resolveEpisodeDefaults(
    courseJson,
    episodeMeta
  );

  const systemPrompt = [
    "You are the Visual Motion Compiler for Tech Video Studio (Pass 2).",
    "Convert the provided Pass 1 storyboard into STRICT VALID JSON `{ \"script_json\": { ... }, \"notes_md\": \"...\" }`.",
    "Preserve every scene's `id`, `part`, `part_label`, `title`, `visual_type`, `narration`, `highlight_words`, and `key_points` while expanding `visual_intent` into exact runtime `visual_data`.",
    "For `architecture` scenes, set `layout_mode: \"auto\"` (node x/y may be omitted so the DAG auto-layout engine places them collision-free).",
    "",
    getSchemaPromptSpec({ compact: false, pass: 2 }),
    "",
    `Top-level script_json metadata: { "course_id": "${courseId}", "episode_id": "${epId}", "episode_number": ${epNum}, "aspect_ratio": "16:9", "language": "vi", "tts_profile": "${ttsProfile}", "tts_voice": "${ttsVoice}", "tts_rate": "${ttsRate}", "scenes": [...] }`,
  ].join("\n");

  const userParts = [
    "# Pass 1 Storyboard to Compile",
    JSON.stringify(storyboard, null, 2),
  ];
  if (notesMd) {
    userParts.push("", "# Existing/Draft Study Notes", String(notesMd).slice(0, 4000));
  }
  if (customInstructions) {
    userParts.push("", "# Additional Instructions", customInstructions);
  }
  if (rewriteNote) {
    userParts.push("", "# Rewrite Note", rewriteNote);
  }
  if (existingScript && !storyboard?.scenes) {
    userParts.push("", "# Reference Existing Script", JSON.stringify(existingScript, null, 2).slice(0, 8000));
  }
  userParts.push("", 'Return ONLY `{ "script_json": { ... }, "notes_md": "..." }`.');

  const rawReply = await callProviderChat({
    provider_id,
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts.join("\n") },
    ],
    engineDir,
  });

  const parsed = parseAiScriptPayload(rawReply, notesMd);
  return parsed;
}

export function buildManualPromptPack(opts) {
  const built = buildScriptPrompt(opts);
  const full_prompt = `${built.system_prompt}\n\n---\n\n${built.user_prompt}`;
  return {
    ...built,
    full_prompt,
    prompt: full_prompt,
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
  return errors.map((e) => (typeof e === "string" ? e : `[${e.scene_id || "scene"}] ${e.code || "error"}: ${e.message || JSON.stringify(e)}`));
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
    "Return STRICT VALID JSON ONLY: { \"scenes\": [ ...fixed scene objects preserving each scene's id... ] }.",
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
    const content = Array.isArray(json.content)
      ? json.content
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
      : "";
    return content;
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

  // OpenAI-compatible: openai, deepseek, openrouter, lmstudio
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
  validateScriptFn,
  onProgress,
  engineDir,
}) {
  let currentScript = normalizeCompiledScript(scriptJson, { courseJson, episodeMeta });
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
      currentScript = repairRes.script_json;
      validation = repairRes.validation;
      if (repairRes.repaired) {
        break;
      }
      // If no scenes matched or repair made no progress, break to allow full retry
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

export async function generateEpisodeScript({
  provider_id,
  model,
  compiler_provider_id = null,
  compiler_model = null,
  mode = "auto",
  courseJson,
  curriculumMd,
  episodeMeta,
  existingScript = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
  validateScriptFn = validateScriptDiagrams,
  onProgress = null,
  engineDir,
}) {
  const effectiveMode = VALID_GENERATION_MODES.has(mode) ? mode : "auto";
  const pass2Provider = compiler_provider_id || provider_id;
  const pass2Model = compiler_model || model;

  if (effectiveMode === "storyboard_only") {
    const { system_prompt, user_prompt } = buildStoryboardPrompt({
      courseJson,
      curriculumMd,
      episodeMeta,
      existingScript,
      existingNotes,
      openRevisions,
      customInstructions,
      rewriteNote,
    });
    const messages = [
      { role: "system", content: system_prompt },
      { role: "user", content: user_prompt },
    ];
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
      onProgress?.({
        phase: "pass_1_storyboard",
        message: `Generating Pass 1 storyboard (attempt ${attempt + 1})...`,
      });
      const rawReply = await callProviderChat({ provider_id, model, messages, engineDir });
      try {
        const sbParsed = parseStoryboardPayload(rawReply, existingNotes);
        const storyboard = sbParsed.is_full_script ? sbParsed.script_json : sbParsed.storyboard;
        return {
          mode: "storyboard_only",
          storyboard,
          notes_md: sbParsed.notes_md,
          validation: { valid: true, errors: [], warnings: [], scene_count: storyboard.scenes.length },
          attempts: attempt + 1,
        };
      } catch (err) {
        lastErr = err;
        messages.push({ role: "assistant", content: rawReply });
        messages.push({
          role: "user",
          content: `Invalid storyboard JSON: ${err.message}\nReturn ONLY { "storyboard": { "scenes": [...] }, "notes_md": "..." }.`,
        });
      }
    }
    const finalErr = new Error(lastErr?.message || "Failed to generate storyboard.");
    finalErr.code = "SCRIPT_VALIDATION_FAILED";
    throw finalErr;
  }

  // 2-Pass or Auto (tries Pass 1 storyboard first; accepts valid single-shot script_json shortcut in auto mode)
  if (effectiveMode === "two_pass" || effectiveMode === "auto") {
    const { system_prompt, user_prompt } = buildStoryboardPrompt({
      courseJson,
      curriculumMd,
      episodeMeta,
      existingScript,
      existingNotes,
      openRevisions,
      customInstructions,
      rewriteNote,
    });
    const pass1Messages = [
      { role: "system", content: system_prompt },
      { role: "user", content: user_prompt },
    ];

    let totalCalls = 0;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
      onProgress?.({
        phase: "pass_1_storyboard",
        message: `Pass 1 (${provider_id}/${model}) generating storyboard/script...`,
      });
      const rawReply = await callProviderChat({
        provider_id,
        model,
        messages: pass1Messages,
        engineDir,
      });
      totalCalls += 1;

      try {
        const sbParsed = parseStoryboardPayload(rawReply, existingNotes);

        // Single-shot shortcut when mode === "auto" and Pass 1 already emitted full { script_json, notes_md }
        if (effectiveMode === "auto" && sbParsed.is_full_script) {
          const checked = await validateAndRepairScript({
            scriptJson: sbParsed.script_json,
            notesMd: sbParsed.notes_md,
            provider_id,
            model,
            courseJson,
            episodeMeta,
            validateScriptFn,
            onProgress,
            engineDir,
          });
          totalCalls += checked.extraCalls;
          if (checked.validation.valid) {
            return {
              mode: "auto",
              mode_used: "single_pass_shortcut",
              script_json: checked.script_json,
              notes_md: checked.notes_md,
              validation: checked.validation,
              attempts: totalCalls,
            };
          }
          const errSummary = formatValidationErrorList(checked.validation.errors).join("\n- ");
          lastError = new Error(`Diagram/Template validation failed:\n- ${errSummary}`);
          pass1Messages.push({ role: "assistant", content: rawReply });
          pass1Messages.push({
            role: "user",
            content: `Your JSON failed Studio validation with these errors:\n- ${errSummary}\n\nFix the errors and return the complete valid JSON object { "script_json": ..., "notes_md": ... }.`,
          });
          continue;
        }

        // Pass 2: compile storyboard -> full runtime script_json
        const storyboardObj = sbParsed.is_full_script ? sbParsed.script_json : sbParsed.storyboard;
        onProgress?.({
          phase: "pass_2_compile",
          message: `Pass 2 (${pass2Provider}/${pass2Model}) compiling storyboard to full 7-template JSON...`,
        });

        const compiled = await compileStoryboardToScript({
          provider_id: pass2Provider,
          model: pass2Model,
          storyboard: storyboardObj,
          notesMd: sbParsed.notes_md,
          courseJson,
          episodeMeta,
          existingScript,
          customInstructions,
          rewriteNote,
          engineDir,
        });
        totalCalls += 1;

        const checked = await validateAndRepairScript({
          scriptJson: compiled.script_json,
          notesMd: compiled.notes_md,
          provider_id: pass2Provider,
          model: pass2Model,
          courseJson,
          episodeMeta,
          validateScriptFn,
          onProgress,
          engineDir,
        });
        totalCalls += checked.extraCalls;

        if (checked.validation.valid) {
          return {
            mode: effectiveMode,
            mode_used: "two_pass",
            storyboard: storyboardObj,
            script_json: checked.script_json,
            notes_md: checked.notes_md,
            validation: checked.validation,
            attempts: totalCalls,
          };
        }

        const errSummary = formatValidationErrorList(checked.validation.errors).join("\n- ");
        lastError = new Error(`Diagram/Template validation failed:\n- ${errSummary}`);
        // Retry with full script prompt containing the specific errors
        break;
      } catch (err) {
        if (err?.code === "QUOTA_EXHAUSTED" || err?.code === "AUTH_INVALID") {
          throw err;
        }
        lastError = err;
        pass1Messages.push({ role: "assistant", content: rawReply });
        pass1Messages.push({
          role: "user",
          content: `Your output could not be parsed: ${err.message}\nReturn ONLY valid JSON.`,
        });
      }
    }

    if (effectiveMode === "two_pass") {
      const finalErr = new Error(lastError?.message || "Failed to generate valid episode script in two_pass mode.");
      finalErr.code = "SCRIPT_VALIDATION_FAILED";
      throw finalErr;
    }
    // In auto mode, if two-pass fell short after parse/compile issues, fall through once to single-pass repair prompt
    if (lastError && effectiveMode === "auto" && totalCalls > MAX_SELF_REPAIR_RETRIES + 1) {
      const finalErr = new Error(lastError.message);
      finalErr.code = "SCRIPT_VALIDATION_FAILED";
      throw finalErr;
    }
  }

  // Single-pass path (or fallback from auto)
  const { system_prompt, user_prompt } = buildScriptPrompt({
    courseJson,
    curriculumMd,
    episodeMeta,
    existingScript,
    existingNotes,
    openRevisions,
    customInstructions,
    rewriteNote,
  });

  const messages = [
    { role: "system", content: system_prompt },
    { role: "user", content: user_prompt },
  ];

  let lastError = null;
  let totalCalls = 0;
  for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
    onProgress?.({
      phase: "in_progress",
      message: `Single-pass generation (attempt ${attempt + 1})...`,
    });
    const rawReply = await callProviderChat({
      provider_id,
      model,
      messages,
      engineDir,
    });
    totalCalls += 1;

    try {
      const parsed = parseAiScriptPayload(rawReply, existingNotes);
      const checked = await validateAndRepairScript({
        scriptJson: parsed.script_json,
        notesMd: parsed.notes_md,
        provider_id,
        model,
        courseJson,
        episodeMeta,
        validateScriptFn,
        onProgress,
        engineDir,
      });
      totalCalls += checked.extraCalls;

      if (checked.validation.valid) {
        return {
          mode: effectiveMode,
          mode_used: "single_pass",
          script_json: checked.script_json,
          notes_md: checked.notes_md,
          validation: checked.validation,
          attempts: totalCalls,
        };
      }
      const errSummary = formatValidationErrorList(checked.validation.errors).join("\n- ");
      lastError = new Error(`Diagram/Template validation failed:\n- ${errSummary}`);
      messages.push({ role: "assistant", content: rawReply });
      messages.push({
        role: "user",
        content: `Your JSON failed Studio diagram validation with these errors:\n- ${errSummary}\n\nFix ONLY the invalid fields/coordinates/counts and return the complete valid JSON object { "script_json": ..., "notes_md": ... }.`,
      });
    } catch (parseErr) {
      if (parseErr?.code === "QUOTA_EXHAUSTED" || parseErr?.code === "AUTH_INVALID") {
        throw parseErr;
      }
      lastError = parseErr;
      messages.push({ role: "assistant", content: rawReply });
      messages.push({
        role: "user",
        content: `Your output was not valid script JSON: ${parseErr.message}\nReturn ONLY a single valid JSON object { "script_json": { "scenes": [...] }, "notes_md": "..." }.`,
      });
    }
  }

  const finalErr = new Error(lastError?.message || "Failed to generate valid episode script after retries.");
  finalErr.code = "SCRIPT_VALIDATION_FAILED";
  throw finalErr;
}
