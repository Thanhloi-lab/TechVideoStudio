import { resolveProviderExecutionConfig } from "./providers.mjs";
import { validateScriptDiagrams } from "../src/diagram_validator.mjs";
import { SUPPORTED_VISUAL_TYPES } from "../src/motion/kernel.mjs";

const DEFAULT_LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.VIDEO_MAKER_AI_TIMEOUT_MS) || 120_000);
const MAX_SELF_REPAIR_RETRIES = 2;

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

export function parseAiScriptPayload(rawText, fallbackNotes = "") {
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

  let scriptJson = parsed.script_json ?? parsed.scriptJson ?? null;
  let notesMd = parsed.notes_md ?? parsed.notesMd ?? null;

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
  const courseId = courseJson.course || courseJson.id || "";
  const epId = episodeMeta.id || episodeMeta.episode_id || "";
  const epNum = episodeMeta.number || 1;
  const epTitle = episodeMeta.title || epId;
  const ttsProfile = courseJson.tts_profile || "edge-hoaimy";
  const ttsVoice = courseJson.tts_voice || "vi-VN-HoaiMyNeural";
  const ttsRate = courseJson.tts_rate || "+0%";

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
    "2. Supported `visual_type` templates (7 symmetric templates; choose the best fit per scene):",
    `   ${SUPPORTED_VISUAL_TYPES.join(", ")}`,
    "   - `architecture`: `visual_data` has `zones[]` (`{ id, label, role: 'client'|'network'|'compute'|'security'|'data'|'danger', node_ids[] }`, max 2 nested levels via `parent_zone`), `nodes[]` (`{ id, label, sublabel, icon, x, y, tone }` with `x,y` in `0..100` spaced cleanly so nodes never overlap), `edges[]` (`{ id, from, to, label, routing: 'auto'|'straight'|'orthogonal'|'curved' }` — default `'auto'`, never cross unrelated nodes, use `'curved'` only for bidirectional pairs), and `flow_steps[]` (optional V2 `camera_focus: { x, y, zoom }` with `x,y` in `0..100`, `zoom` in `1.0..1.25`).",
    "   - `console_setup`: `{ service, breadcrumb, steps: [{ step, title, description, field, value, highlight }] }`.",
    "   - `code_cli`: `{ language, filename, code, highlight_phases: [{ step, label, lines, code_override?, laser_scan? }] }`.",
    "   - `exam_tips`: `{ question, options: string[], correct_index: number, explanation, traps: string[] }`.",
    "   - `comparison_matrix`: `{ badge, title, criterion_heading, columns: (2..4){ id, title, subtitle, tone, badge? }, rows: (1..6){ criterion, progress_start?, values: { [colId]: { text, status } } }, takeaway? }`.",
    "   - `timeline_flow`: `{ orientation: 'horizontal'|'vertical', badge, subtitle, milestones: (2..6){ id, time_label, title, description, icon, tone, metric_badge, progress_start, progress_end }, callout? }`.",
    "   - `kpi_metrics`: `{ cards: (1..4){ id, label, value, numeric_target, prefix?, suffix?, decimals?, delta_text, delta_tone, tone, sparkline? }, chart?: { title, type, unit, series[1..8] }, alert_stamp? }`.",
    "3. V2 scene fields:",
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

  if (curriculumMd) {
    userParts.push("", "# Course Curriculum Context", curriculumMd.slice(0, 6000));
  }

  if (customInstructions) {
    userParts.push("", "# Additional User Instructions", customInstructions);
  }

  const hasRewriteContext =
    Boolean(existingScript) ||
    Boolean(rewriteNote && rewriteNote.trim()) ||
    (Array.isArray(openRevisions) && openRevisions.length > 0);

  if (hasRewriteContext) {
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

export function buildManualPromptPack(opts) {
  const built = buildScriptPrompt(opts);
  const full_prompt = `${built.system_prompt}\n\n---\n\n${built.user_prompt}`;
  return {
    ...built,
    full_prompt,
    prompt: full_prompt,
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
    const res = await doFetch(`${execCfg.base_url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": execCfg.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
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

export async function generateEpisodeScript({
  provider_id,
  model,
  courseJson,
  curriculumMd,
  episodeMeta,
  existingScript = null,
  existingNotes = "",
  openRevisions = [],
  customInstructions = "",
  rewriteNote = "",
  validateScriptFn = validateScriptDiagrams,
  engineDir,
}) {
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
  for (let attempt = 0; attempt <= MAX_SELF_REPAIR_RETRIES; attempt++) {
    const rawReply = await callProviderChat({
      provider_id,
      model,
      messages,
      engineDir,
    });

    try {
      const parsed = parseAiScriptPayload(rawReply, existingNotes);
      const validation = validateScriptFn(parsed.script_json);
      if (validation.valid) {
        return {
          script_json: parsed.script_json,
          notes_md: parsed.notes_md,
          validation,
          attempts: attempt + 1,
        };
      }
      const errSummary = validation.errors
        .map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e)))
        .join("\n- ");
      lastError = new Error(`Diagram/Template validation failed:\n- ${errSummary}`);
      messages.push({ role: "assistant", content: rawReply });
      messages.push({
        role: "user",
        content: `Your JSON failed Studio diagram validation with these errors:\n- ${errSummary}\n\nFix ONLY the invalid fields/coordinates/counts and return the complete valid JSON object { "script_json": ..., "notes_md": ... }.`,
      });
    } catch (parseErr) {
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
