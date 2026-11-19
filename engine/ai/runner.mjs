import { resolveProviderExecutionConfig } from "./providers.mjs";
import { validateScriptDiagrams, validateSingleScene } from "../src/diagram_validator.mjs";
import { getSchemaPromptSpec } from "../src/template_schema.mjs";
import { SUPPORTED_VISUAL_TYPES } from "../src/motion/kernel.mjs";

const DEFAULT_LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.VIDEO_MAKER_AI_TIMEOUT_MS) || 120_000);
const MAX_SELF_REPAIR_RETRIES = 2;
const VALID_GENERATION_MODES = new Set([
  "auto",
  "two_pass",
  "single_pass",
  "storyboard_only",
  "three_stage",
]);
const VALID_PAUSE_AFTER = new Set(["none", "brief", "dialogue"]);
const VALID_START_FROM = new Set(["brief", "dialogue", "visual"]);
const VALID_PART_SET = new Set(["problem", "architecture", "setup", "exam_tips"]);

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

function buildSharedTargetHeader({
  courseJson = {},
  curriculumMd = "",
  episodeMeta = {},
  customInstructions = "",
}) {
  const { courseId, epId, epNum, epTitle } = resolveEpisodeDefaults(courseJson, episodeMeta);
  const parts = [
    "# Target Episode",
    `- Course: ${courseId} (${courseJson.title || courseId})`,
    `- Episode ID: ${epId} (#${epNum})`,
    `- Title: ${epTitle}`,
    episodeMeta.duration_target ? `- Target Duration: ${episodeMeta.duration_target}` : "",
    episodeMeta.stage_title ? `- Stage: ${episodeMeta.stage_title}` : "",
  ].filter(Boolean);

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
 * Stage 1 (Content Brief & Narrative Arc): decides WHAT to teach, hook conflict, and factual proof anchors
 * WITHOUT touching visual templates, layout, CSS, or GSAP.
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
}) {
  const { courseId, epId, epNum, epTitle } = resolveEpisodeDefaults(courseJson, episodeMeta);
  const systemPrompt = [
    "You are the Lead Pedagogical Content Architect (Stage 1: Content Brief & Narrative Arc).",
    "Your ONLY responsibility is deciding WHAT to explain, why it matters, the story order, and concrete technical facts.",
    "STRICT PROHIBITION: Do NOT mention visual templates, visual_type, nodes, edges, zones, coordinates, CSS, or GSAP.",
    "",
    "### Content & Hook Rules:",
    "1. Hook Angle: Start with a real developer conflict, cost/latency collision, production outage, or myth-bust (NEVER greetings or textbook definitions).",
    "2. Narrative Arc (Setup -> Escalation -> Reversal): Sequence ideas so each beat causes the next across the 4 blueprint parts (`problem`, `architecture`, `setup`, `exam_tips`). It must fail the Shuffle Test if reordered arbitrarily.",
    "3. Concrete Proof Anchors: Every teaching beat must cite a real command, config, benchmark/metric, or production/exam trap (no vague hand-waving).",
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
            escalation: "Mechanism & trade-off deeper dive",
            reversal: "Key production insight / exam trap reversal",
          },
          teaching_beats: [
            {
              id: "beat_01",
              part: "problem | architecture | setup | exam_tips",
              goal: "What the learner must grasp here",
              key_claim: "Core factual statement",
              concrete_proof_anchor: "Specific CLI command, config key, number, or real scenario",
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
  });

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
  if (existingBrief) {
    userParts.push("", "## Existing Content Brief (Revise/Preserve Where Good)", JSON.stringify(existingBrief, null, 2).slice(0, 8000));
  } else if (existingScript) {
    userParts.push("", "## Existing Script Context", JSON.stringify(existingScript, null, 2).slice(0, 6000));
  }

  userParts.push("", 'Respond ONLY with `{ "brief": { ... } }`.');
  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

export function parseBriefPayload(rawText, { courseJson = {}, episodeMeta = {} } = {}) {
  const parsed = parseJsonObjectLoose(rawText);
  const brief = parsed.brief && typeof parsed.brief === "object" ? parsed.brief : parsed;
  const beats = Array.isArray(brief?.teaching_beats) ? brief.teaching_beats : [];
  if (!brief || typeof brief !== "object" || beats.length === 0) {
    throw new Error('Stage 1 brief JSON must contain "brief.teaching_beats" as a non-empty array.');
  }
  const { courseId, epId, epNum, epTitle } = resolveEpisodeDefaults(courseJson, episodeMeta);
  const normalizedBeats = beats.map((b, i) => {
    const part = VALID_PART_SET.has(b?.part) ? b.part : "architecture";
    const claim = String(b?.key_claim || b?.goal || "").trim();
    if (!claim) {
      throw new Error(`brief.teaching_beats[${i}] must have a non-empty key_claim or goal.`);
    }
    return {
      id: String(b?.id || `beat_${String(i + 1).padStart(2, "0")}`).trim(),
      part,
      goal: String(b?.goal || claim).trim(),
      key_claim: claim,
      concrete_proof_anchor: String(b?.concrete_proof_anchor || "").trim(),
    };
  });

  return {
    course_id: String(brief.course_id || courseId || "").trim(),
    episode_id: String(brief.episode_id || epId || "").trim(),
    episode_number: Number.isFinite(Number(brief.episode_number)) ? Number(brief.episode_number) : epNum,
    title: String(brief.title || epTitle || "").trim(),
    subtitle: String(brief.subtitle || "").trim(),
    hook_angle:
      brief.hook_angle && typeof brief.hook_angle === "object"
        ? brief.hook_angle
        : { family: "conflict", conflict_statement: "", stakes: "" },
    narrative_arc:
      brief.narrative_arc && typeof brief.narrative_arc === "object"
        ? brief.narrative_arc
        : { setup: "", escalation: "", reversal: "" },
    teaching_beats: normalizedBeats,
  };
}

/**
 * Stage 2 (Dialogue & Beat Script): writes natural spoken Vietnamese narration + Dual-Text TTS safety
 * + What-vs-Why separation + study notes, WITHOUT choosing visual components or animations.
 */
export function buildDialoguePrompt({
  briefJson,
  courseJson = {},
  episodeMeta = {},
  existingDialogue = null,
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
    "You are the Lead Spoken Scriptwriter (Stage 2: Dialogue & TTS Beats).",
    "Turn the approved Content Brief into crisp spoken beats (1-2 sentences each, ~5-12 seconds per beat) + study notes.",
    "STRICT PROHIBITION: Do NOT choose visual templates, visual_type, nodes, edges, coordinates, CSS, or GSAP.",
    "",
    "### Spoken & TTS Safety Rules:",
    "1. Natural Vietnamese Narration: Conversational instructor tone, preserving authentic English technical terms.",
    "2. What vs. Why Separation:",
    "   - `on_screen_fact` (WHAT): concise metric, state, CLI command, or contrast for the screen.",
    "   - `display_text` (WHY): spoken Vietnamese explaining the cause, trade-off, or consequence (NEVER repeat on_screen_fact verbatim).",
    "3. Dual-Text TTS Safety:",
    "   - `display_text`: exact technical spelling for subtitles & UI (e.g. `K8s`, `RDB`, `140ms`, `1,000,000 req/s`).",
    "   - `tts_text`: Vietnamese TTS-safe phonetic version (e.g. `K-8-S`, `R-D-B`, `một trăm bốn mươi mili giây`, `một triệu request mỗi giây`). Avoid placing two similar-sounding numbers in the same sentence.",
    "4. Rhythm & Grouping: Group consecutive beats belonging to the same conceptual scene using `scene_group` (slug like `scene_01_hook`) and `scene_title` across all 4 parts (`problem`, `architecture`, `setup`, `exam_tips`). Vary sentence openings (avoid repeating 'Và...', 'Tiếp theo...').",
    "",
    "Return STRICT VALID JSON ONLY matching:",
    JSON.stringify(
      {
        dialogue: {
          course_id: courseId,
          episode_id: epId,
          episode_number: epNum,
          title: briefJson?.title || epTitle,
          subtitle: briefJson?.subtitle || "",
          tts_profile: ttsProfile,
          tts_voice: ttsVoice,
          tts_rate: ttsRate,
          beats: [
            {
              beat_id: "beat_01",
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
        notes_md: "# One-Page Cheat Sheet, CLI/Config snippets & 3 exam MCQs...",
      },
      null,
      2
    ),
  ].join("\n");

  const userParts = [
    "# Approved Content Brief (Stage 1)",
    JSON.stringify(briefJson || {}, null, 2),
  ];
  if (customInstructions) {
    userParts.push("", "# Additional User Instructions", customInstructions);
  }
  if (rewriteNote && rewriteNote.trim()) {
    userParts.push("", "# Rewrite Note", rewriteNote.trim());
  }
  if (Array.isArray(openRevisions) && openRevisions.length > 0) {
    userParts.push(
      "",
      "# Open Revision Tickets",
      ...openRevisions.map(
        (r) => `- [${r.id}] (${r.scope}${r.scene_id ? ` / ${r.scene_id}` : ""}): ${r.description}`
      )
    );
  }
  if (existingDialogue) {
    userParts.push("", "# Existing Dialogue Reference", JSON.stringify(existingDialogue, null, 2).slice(0, 10000));
  }
  if (existingNotes) {
    userParts.push("", "# Existing Notes Reference", String(existingNotes).slice(0, 3000));
  }
  userParts.push("", 'Respond ONLY with `{ "dialogue": { ... }, "notes_md": "..." }`.');
  return { system_prompt: systemPrompt, user_prompt: userParts.join("\n") };
}

export function parseDialoguePayload(rawText, { briefJson = null, courseJson = {}, episodeMeta = {}, fallbackNotes = "" } = {}) {
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
      scene_title: String(b?.scene_title || briefJson?.title || epTitle).trim(),
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

  const notesMd = parsed.notes_md !== undefined && parsed.notes_md !== null
    ? String(parsed.notes_md)
    : String(fallbackNotes || "");

  return {
    dialogue: {
      course_id: String(dialogue.course_id || briefJson?.course_id || courseId || "").trim(),
      episode_id: String(dialogue.episode_id || briefJson?.episode_id || epId || "").trim(),
      episode_number: Number.isFinite(Number(dialogue.episode_number))
        ? Number(dialogue.episode_number)
        : briefJson?.episode_number ?? epNum,
      title: String(dialogue.title || briefJson?.title || epTitle || "").trim(),
      subtitle: String(dialogue.subtitle || briefJson?.subtitle || "").trim(),
      tts_profile: String(dialogue.tts_profile || ttsProfile),
      tts_voice: String(dialogue.tts_voice || ttsVoice),
      tts_rate: String(dialogue.tts_rate || ttsRate),
      beats: normalizedBeats,
    },
    notes_md: notesMd,
  };
}

/**
 * Stage 3 (Visual Director & Motion Compiler): maps locked spoken beats (+ optional audio_spine)
 * into validated 7-template runtime `script_json` without changing spoken wording.
 */
export function buildVisualDirectionPrompt({
  dialogueJson,
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
  const svgListStr = Array.isArray(availableSvgs) && availableSvgs.length > 0
    ? availableSvgs.map((s) => (typeof s === "string" ? s : s?.id)).filter(Boolean).join(", ")
    : "server-rack, redis-stack, ram-stick, ssd-disk, postgres, database, docker, kubernetes, api-gateway, browser-client, cloud-infra, event-loop, kafka-queue, shield-lock, terminal-cli";

  const systemPrompt = [
    "You are the Visual Director & Motion Compiler (Stage 3) for Tech Video Studio.",
    "Your job is to convert the LOCKED spoken beats in `dialogue.json` into `{ \"script_json\": { ... }, \"notes_md\": \"...\" }`.",
    "",
    "### Mandatory Visual Direction Rules:",
    "1. PRESERVE SPOKEN WORDING: Group beats by `scene_group` into `scenes[]`. Do NOT rewrite the spoken text. Set `scene.narration` to the joined `display_text` of that scene's beats, and preserve `scene.tts_beats = [{ beat_id, display_text, tts_text }]` verbatim.",
    "2. Visual Job Gate: Assign EVERY scene an explicit `visual_job` (`Proof` | `Mechanism` | `Consequence` | `Action` | `Transition`). Show WHAT (`on_screen_fact`), never repeat the spoken explanation as prose.",
    "3. Choose the sharpest `visual_type` among the 7 templates below. Include `layout_mode: \"auto\"` on `architecture` scenes (node x/y optional).",
    `4. Local SVG Assets ONLY: When using \`node.svg\` in \`architecture\`, pick strictly from: [${svgListStr}]. Always include fallback \`node.icon\`.`,
    "5. Motion Variety & Anti-Static (>3.5s rule): Rotate `causal_mechanic` (`wire-draw`, `arc-emission`, `width-push`, `squash-drop`, `typographic-strike`, `blur-materialize`) so no two consecutive scenes share the same mechanic. Ensure multi-beat scenes have multiple sub-steps (`flow_steps`, `steps`, `highlight_phases`, `milestones`, `cards`, `comparisons`, `rows`) keyed by `cue_sentence` (1-based) and `cue_text`.",
    "6. Optional Visual Fields: Set `world_theme` (`\"dark\"` or `\"light\"`), `sfx_cues` (`[{ progress, type: \"whoosh_short\"|\"pop\"|\"click\"|\"typing_fast\"|\"impact\"|\"chime\" }]`), `camera_focus`, `code_override`, and `laser_scan` where helpful.",
    "",
    getSchemaPromptSpec({ compact: false, pass: 2 }),
    "",
    `Top-level script_json metadata: { "course_id": "${courseId}", "episode_id": "${epId}", "episode_number": ${epNum}, "aspect_ratio": "16:9", "language": "vi", "tts_profile": "${ttsProfile}", "tts_voice": "${ttsVoice}", "tts_rate": "${ttsRate}", "scenes": [...] }`,
  ].join("\n");

  const userParts = [
    "# Locked Dialogue & Beats (Stage 2)",
    JSON.stringify(dialogueJson || {}, null, 2),
  ];
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
  if (Array.isArray(openRevisions) && openRevisions.length > 0) {
    userParts.push(
      "",
      "# Open Revision Tickets",
      ...openRevisions.map(
        (r) => `- [${r.id}] (${r.scope}${r.scene_id ? ` / ${r.scene_id}` : ""}): ${r.description}`
      )
    );
  }
  if (existingScript) {
    userParts.push("", "# Reference Existing Script (Preserve working layouts if applicable)", JSON.stringify(existingScript, null, 2).slice(0, 7000));
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
 * Deterministically normalize compiled script_json:
 * - Fill missing script metadata defaults from courseJson/episodeMeta
 * - Fill missing progress_start/progress_end in [0..1] proportionally
 * - Set layout_mode: "auto" on architecture scenes missing node x, y
 */
export function normalizeCompiledScript(
  scriptJson,
  { courseJson = {}, episodeMeta = {}, dialogueJson = null, audioSpine = null } = {}
) {
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

    // Preserve Dual-Text tts_beats from Stage 2 dialogueJson when omitted by Stage 3 compiler
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
  dialogueJson = null,
  audioSpine = null,
  validateScriptFn,
  onProgress,
  engineDir,
}) {
  let currentScript = normalizeCompiledScript(scriptJson, {
    courseJson,
    episodeMeta,
    dialogueJson,
    audioSpine,
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
      });
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

export async function generateEpisodeScript({
  provider_id,
  model,
  compiler_provider_id = null,
  compiler_model = null,
  role_routing = null,
  mode = "auto",
  pause_after = "none",
  start_from = null,
  courseJson,
  curriculumMd,
  episodeMeta,
  existingBrief = null,
  existingDialogue = null,
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
  const effectiveMode = VALID_GENERATION_MODES.has(mode) ? mode : "auto";
  const effectivePauseAfter = VALID_PAUSE_AFTER.has(pause_after) ? pause_after : "none";
  const effectiveStartFrom = VALID_START_FROM.has(start_from) ? start_from : null;
  const pass2Provider = compiler_provider_id || provider_id;
  const pass2Model = compiler_model || model;

  if (effectiveMode === "three_stage") {
    const briefProv = role_routing?.brief_scriptwriter?.provider_id || provider_id;
    const briefMdl = role_routing?.brief_scriptwriter?.model || model;
    const directorProv = role_routing?.visual_director?.provider_id || pass2Provider;
    const directorMdl = role_routing?.visual_director?.model || pass2Model;
    const repairProv = role_routing?.repair?.provider_id || directorProv;
    const repairMdl = role_routing?.repair?.model || directorMdl;

    let totalCalls = 0;
    let briefJson = existingBrief && Array.isArray(existingBrief.teaching_beats) ? existingBrief : null;
    let dialogueJson = existingDialogue && Array.isArray(existingDialogue.beats) ? existingDialogue : null;
    let notesMd = String(existingNotes || "");

    // Stage 1: Content Brief (unless resuming from dialogue/visual with existing artifact)
    const skipStage1 =
      (effectiveStartFrom === "dialogue" && Boolean(briefJson)) ||
      (effectiveStartFrom === "visual" && Boolean(dialogueJson));

    if (!skipStage1) {
      const s1 = buildContentBriefPrompt({
        courseJson,
        curriculumMd,
        episodeMeta,
        existingBrief: briefJson,
        existingScript,
        openRevisions,
        customInstructions,
        rewriteNote,
      });
      const res1 = await runJsonStageLoop({
        provider_id: briefProv,
        model: briefMdl,
        system_prompt: s1.system_prompt,
        user_prompt: s1.user_prompt,
        parseFn: (raw) => parseBriefPayload(raw, { courseJson, episodeMeta }),
        retryHint: 'Return ONLY valid JSON: { "brief": { "teaching_beats": [...] } }.',
        phase: "stage_1_brief",
        stageLabel: "Stage 1 Content Brief",
        onProgress,
        engineDir,
      });
      briefJson = res1.value;
      totalCalls += res1.calls;

      if (effectivePauseAfter === "brief") {
        return {
          mode: "three_stage",
          mode_used: "three_stage_brief",
          paused_at: "brief",
          brief_json: briefJson,
          dialogue_json: null,
          audio_spine: null,
          notes_md: notesMd,
          validation: { valid: true, errors: [], warnings: [], scene_count: 0 },
          attempts: totalCalls,
        };
      }
    }

    // Stage 2: Spoken Dialogue & Beats (unless resuming directly at visual with existingDialogue)
    const skipStage2 = effectiveStartFrom === "visual" && Boolean(dialogueJson);
    if (!skipStage2) {
      const s2 = buildDialoguePrompt({
        briefJson,
        courseJson,
        episodeMeta,
        existingDialogue: dialogueJson,
        existingNotes: notesMd,
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
            courseJson,
            episodeMeta,
            fallbackNotes: notesMd,
          }),
        retryHint: 'Return ONLY valid JSON: { "dialogue": { "beats": [...] }, "notes_md": "..." }.',
        phase: "stage_2_dialogue",
        stageLabel: "Stage 2 Dialogue & TTS Beats",
        onProgress,
        engineDir,
      });
      dialogueJson = res2.value.dialogue;
      notesMd = res2.value.notes_md || notesMd;
      totalCalls += res2.calls;

      if (effectivePauseAfter === "dialogue") {
        return {
          mode: "three_stage",
          mode_used: "three_stage_dialogue",
          paused_at: "dialogue",
          brief_json: briefJson,
          dialogue_json: dialogueJson,
          audio_spine: null,
          notes_md: notesMd,
          validation: { valid: true, errors: [], warnings: [], scene_count: 0 },
          attempts: totalCalls,
        };
      }
    }

    // Optional Audio-Spine Hook right between Stage 2 (Dialogue) and Stage 3 (Visual Director)
    let activeAudioSpine = audioSpine;
    if (typeof onBeforeVisualStage === "function") {
      onProgress?.({
        phase: "audio_spine_lock",
        message: "Locking Audio-Spine beat durations before Visual Director...",
      });
      const hookSpine = await onBeforeVisualStage({
        brief_json: briefJson,
        dialogue_json: dialogueJson,
        notes_md: notesMd,
      });
      if (hookSpine && typeof hookSpine === "object") {
        activeAudioSpine = hookSpine;
      }
    }

    // Stage 3: Visual Director & Motion Compiler -> script.json + self-repair
    const s3 = buildVisualDirectionPrompt({
      dialogueJson,
      audioSpine: activeAudioSpine,
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
    let lastStage3Err = null;
    for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
      onProgress?.({
        phase: "stage_3_visual",
        message: `Stage 3 Visual Director (${directorProv}${directorMdl ? `/${directorMdl}` : ""}, attempt ${attempt + 1})...`,
      });
      const rawReply = await callProviderChat({
        provider_id: directorProv,
        model: directorMdl,
        messages: s3Messages,
        engineDir,
      });
      totalCalls += 1;
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
          audioSpine: activeAudioSpine,
          validateScriptFn,
          onProgress,
          engineDir,
        });
        totalCalls += checked.extraCalls;
        if (checked.validation.valid) {
          return {
            mode: "three_stage",
            mode_used: "three_stage",
            paused_at: null,
            brief_json: briefJson,
            dialogue_json: dialogueJson,
            audio_spine: activeAudioSpine || null,
            script_json: checked.script_json,
            notes_md: checked.notes_md,
            validation: checked.validation,
            attempts: totalCalls,
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
    const finalErr = new Error(lastStage3Err?.message || "Failed in Stage 3 Visual Director.");
    finalErr.code = "SCRIPT_VALIDATION_FAILED";
    throw finalErr;
  }

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
