// Tech Video Studio → HyperFrames composition compiler (pure Node.js ESM, zero npm deps).
//
// Input : an episode payload as returned by GET /api/courses (script.json with the active voice
//         track applied by server.mjs#normalizeScriptVoiceTracks) + render options.
// Output: a standard HyperFrames project in <COURSE>/episodes/<EP>/hyperframes/
//           index.html         root composition (data-composition-id="main")
//           composition.json   manifest consumed by engine/hyperframes/render.mjs
//           lib/               HyperFrames runtime, GSAP, tvs-hf.css, scene modules
//           assets/audio/      per-scene narration copied from the episode folder
//
// See engine/HYPERFRAMES_ENGINE.md for the full contract.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseSubtitleSegments, SUPPORTED_VISUAL_TYPES } from "../src/motion/kernel.mjs";
import { probeAudioDuration } from "./audio_probe.mjs";

const __filename = fileURLToPath(import.meta.url);
const HF_DIR = path.dirname(__filename);
const ENGINE_DIR = path.resolve(HF_DIR, "..");
const RUNTIME_DIR = path.join(HF_DIR, "runtime");
const VENDOR_DIR = path.join(ENGINE_DIR, "public", "vendor");

export const COMPOSITION_ID = "main";
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
export const HF_RUNTIME_VERSION = "0.9.59";
export const GSAP_VERSION = "3.15.1";
export const PROJECT_DIRNAME = "hyperframes";

const VENDOR_FILES = Object.freeze([
  { from: path.join(VENDOR_DIR, "raw", "@hyperframes", "core@0.9.59", "hyperframe.runtime.iife.js"), to: "lib/hyperframe.runtime.iife.js" },
  { from: path.join(VENDOR_DIR, "raw", "@hyperframes", "core@0.9.59", "LICENSE"), to: "lib/HYPERFRAMES_LICENSE.txt" },
  { from: path.join(VENDOR_DIR, "raw", "gsap@3.15.1", "gsap.min.js"), to: "lib/gsap.min.js" },
  { from: path.join(ENGINE_DIR, "src", "motion", "kernel.mjs"), to: "lib/kernel.mjs" },
  { from: path.join(ENGINE_DIR, "src", "icons.mjs"), to: "lib/icons.mjs" },
]);

const SHIKI_ENTRY = path.join(VENDOR_DIR, "esm", "shiki@4.6.0", "index.mjs");
const SHIKI_THEME = "tokyo-night";
const SHIKI_LANG_ALIASES = Object.freeze({
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  console: "bash",
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  tf: "hcl",
  terraform: "hcl",
  py: "python",
  ps1: "powershell",
  dockerfile: "docker",
  text: "text",
  plaintext: "text",
  txt: "text",
});

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** JSON safe for embedding in <script type="application/json"> (no "</script>" breakouts). */
export function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function escapeAttr(text) {
  return escapeHtml(text);
}

function safeSlug(text, fallback = "x") {
  const s = String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

// ---------------------------------------------------------------------------
// Code highlighting (Shiki at compile time → plain token data in the composition)
// ---------------------------------------------------------------------------

let shikiHighlighterPromise = null;
const loadedShikiLangs = new Set();

async function getShiki() {
  if (!shikiHighlighterPromise) {
    shikiHighlighterPromise = (async () => {
      const shiki = await import(pathToFileURL(SHIKI_ENTRY).href);
      const hl = await shiki.createHighlighter({ themes: [SHIKI_THEME], langs: [] });
      return hl;
    })().catch((err) => {
      shikiHighlighterPromise = null;
      throw err;
    });
  }
  return shikiHighlighterPromise;
}

export function normalizeCodeLang(raw) {
  const low = String(raw || "").trim().toLowerCase();
  if (!low) return "json";
  return SHIKI_LANG_ALIASES[low] || low;
}

/**
 * Tokenize code lines with the vendored Shiki (tokyo-night). Returns
 * `[[{ t: text, c: "#RRGGBB", s: fontStyle }]]` per line, or null when highlighting is unavailable.
 */
export async function highlightCodeLines(lines, rawLang) {
  const lang = normalizeCodeLang(rawLang);
  const text = (Array.isArray(lines) ? lines : String(lines ?? "").split("\n")).map((l) => String(l ?? "")).join("\n");
  if (lang === "text") {
    return text.split("\n").map((line) => (line ? [{ t: line, c: "#A9B1D6", s: 0 }] : []));
  }
  try {
    const hl = await getShiki();
    if (!loadedShikiLangs.has(lang)) {
      await hl.loadLanguage(lang);
      loadedShikiLangs.add(lang);
    }
    const res = hl.codeToTokens(text, { lang, theme: SHIKI_THEME });
    return res.tokens.map((lineTokens) =>
      lineTokens.map((tok) => ({ t: tok.content, c: tok.color || "#A9B1D6", s: tok.fontStyle || 0 }))
    );
  } catch {
    return null;
  }
}

function toLineArray(value) {
  if (Array.isArray(value)) return value.map((l) => String(l ?? ""));
  if (typeof value === "string") return value.split("\n");
  return [];
}

async function buildCodeCliAssets(scene) {
  const vd = scene.visual_data || {};
  const lang = normalizeCodeLang(vd.code_language || "json");
  const snapshots = [];
  const snapshotIndexByKey = new Map();
  const addSnapshot = async (lines) => {
    const key = lines.join("\n");
    if (snapshotIndexByKey.has(key)) return snapshotIndexByKey.get(key);
    const tokens = await highlightCodeLines(lines, lang);
    const idx = snapshots.length;
    snapshots.push({ lines, tokens });
    snapshotIndexByKey.set(key, idx);
    return idx;
  };

  const baseLines = toLineArray(vd.code_lines);
  const baseIdx = baseLines.length ? await addSnapshot(baseLines) : -1;
  // Same semantics as the legacy canvas template and the Studio player (TerminalAndCode):
  // a phase shows its own code_override, otherwise it falls back to code_lines.
  const phaseSnapshot = [];
  for (const phase of Array.isArray(vd.highlight_phases) ? vd.highlight_phases : []) {
    const override = toLineArray(phase?.code_override);
    phaseSnapshot.push(override.length ? await addSnapshot(override) : baseIdx);
  }
  return { lang, base: baseIdx, snapshots, phase_snapshot: phaseSnapshot };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

function readCue(cue) {
  if (!cue || typeof cue !== "object") return null;
  const start = Number(cue.start_sec ?? cue.start);
  const end = Number(cue.end_sec ?? cue.end);
  const text = String(cue.text ?? "").trim();
  if (!Number.isFinite(start) || !text) return null;
  return { start: Math.max(0, start), end: Number.isFinite(end) ? Math.max(start, end) : start + 2, text };
}

/**
 * Compute the output timeline: each scene lasts as long as its narration audio (÷ speed),
 * falling back to scene.duration_sec (÷ speed) when there is no audio file.
 */
export function computeTimeline(scenes, { episodeDir, speed = 1 } = {}) {
  const rate = Number(speed) > 0 ? Number(speed) : 1;
  let cursor = 0;
  const out = [];
  scenes.forEach((scene, index) => {
    let sourceDuration = null;
    let audioAbs = null;
    const rel = scene.audio_file ? String(scene.audio_file).replace(/\\/g, "/") : "";
    if (rel && episodeDir) {
      const candidate = path.resolve(episodeDir, ...rel.split("/"));
      if (candidate.startsWith(path.resolve(episodeDir)) && fs.existsSync(candidate)) {
        audioAbs = candidate;
        sourceDuration = probeAudioDuration(candidate);
      }
    }
    if (!(sourceDuration > 0)) {
      const fallback = Number(scene.duration_sec);
      sourceDuration = fallback > 0 ? fallback : 5;
    }
    const duration = Math.max(0.1, sourceDuration / rate);
    out.push({
      index,
      id: String(scene.id || `scene_${index + 1}`),
      start: round3(cursor),
      duration: round3(duration),
      source_duration: round3(sourceDuration),
      audio_abs: audioAbs,
      audio_rel: rel || null,
    });
    cursor += duration;
  });
  return { scenes: out, total: round3(cursor), speed: rate };
}

function buildSubtitleCues(scene, timing, rate) {
  const subs = (Array.isArray(scene.subtitles) ? scene.subtitles : []).map(readCue).filter(Boolean);
  subs.sort((a, b) => a.start - b.start);
  const sceneEnd = timing.start + timing.duration;
  const cues = [];
  for (let i = 0; i < subs.length; i++) {
    const cue = subs[i];
    const next = subs[i + 1];
    const start = timing.start + cue.start / rate;
    if (start >= sceneEnd - 0.02) continue;
    // Legacy renderer keeps a cue visible until end + 0.15s (1x audio seconds)
    let end = timing.start + (cue.end + 0.15) / rate;
    if (next) end = Math.min(end, timing.start + next.start / rate);
    end = Math.min(end, sceneEnd);
    if (end - start < 0.05) continue;
    cues.push({
      start: round3(start),
      duration: round3(end - start),
      segments: parseSubtitleSegments(cue.text, scene.highlight_words || []),
    });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function renderSubtitleHtml(cue, sceneIndex, cueIndex) {
  const inner = cue.segments
    .map((seg) => (seg.accent ? `<span class="tvs-accent">${escapeHtml(seg.text)}</span>` : escapeHtml(seg.text)))
    .join("");
  return `    <div id="sub-${sceneIndex}-${cueIndex}" class="clip tvs-subtitle" data-start="${cue.start}" data-duration="${cue.duration}" data-track-index="2"><span class="tvs-subtitle__text">${inner}</span></div>`;
}

export function renderIndexHtml({ title, total, scenesTiming, scenes, audioClips, cuesByScene, episodeData }) {
  const sceneClips = scenesTiming
    .map((t, i) => {
      const sc = scenes[i] || {};
      return `    <section id="scene-${i}" class="clip tvs-scene" data-start="${t.start}" data-duration="${t.duration}" data-track-index="1" data-scene-id="${escapeAttr(sc.id || t.id)}" data-visual-type="${escapeAttr(sc.visual_type || "architecture")}"></section>`;
    })
    .join("\n");
  const subtitleClips = cuesByScene
    .flatMap((cues, sIdx) => cues.map((cue, cIdx) => renderSubtitleHtml(cue, sIdx, cIdx)))
    .join("\n");
  const audioTags = audioClips
    .map(
      (a) =>
        `    <audio id="${a.id}" src="${escapeAttr(a.src)}" data-start="${a.start}" data-duration="${a.duration}" data-media-start="0" data-volume="${a.volume}"${a.playback_rate !== 1 ? ` data-playback-rate="${a.playback_rate}"` : ""} data-track-index="${a.track_index}" preload="auto"></audio>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${FRAME_WIDTH}, height=${FRAME_HEIGHT}" />
  <title>${escapeHtml(title)}</title>
  <!-- HyperFrames runtime (@hyperframes/core ${HF_RUNTIME_VERSION}, Apache-2.0). The official CLI strips this tag and injects its own verified runtime. -->
  <script data-hyperframes-preview-runtime src="./lib/hyperframe.runtime.iife.js"></script>
  <script src="./lib/gsap.min.js"></script>
  <link rel="stylesheet" href="./lib/tvs-hf.css" />
</head>
<body>
  <div id="root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="${total}" data-width="${FRAME_WIDTH}" data-height="${FRAME_HEIGHT}">
    <div class="tvs-bg"></div>
    <div id="tvs-ambient"></div>
${sceneClips}
    <div id="tvs-fx"></div>
    <div class="tvs-subtitles">
${subtitleClips}
    </div>
    <div class="tvs-progress"><div id="tvs-progress-fill"></div></div>
${audioTags}
  </div>
  <script type="application/json" id="tvs-episode-data">${jsonForHtml(episodeData)}</script>
  <script type="module" src="./lib/tvs-hf-main.mjs"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Project assembly
// ---------------------------------------------------------------------------

function copyFileIfChanged(from, to) {
  const buf = fs.readFileSync(from);
  if (fs.existsSync(to)) {
    const existing = fs.readFileSync(to);
    if (existing.length === buf.length && existing.equals(buf)) return false;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  return true;
}

function listRuntimeFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) listRuntimeFiles(abs, base, out);
    else if (/\.(mjs|js|css)$/i.test(entry.name)) out.push(path.relative(base, abs));
  }
  return out;
}

function pickSceneForComposition(scene, extra) {
  return {
    id: String(scene.id || ""),
    part: scene.part || "",
    part_label: scene.part_label || "",
    title: scene.title || "",
    visual_type: SUPPORTED_VISUAL_TYPES.includes(scene.visual_type) ? scene.visual_type : "architecture",
    visual_data: scene.visual_data || {},
    highlight_words: Array.isArray(scene.highlight_words) ? scene.highlight_words : [],
    key_points: Array.isArray(scene.key_points) ? scene.key_points : [],
    ...extra,
  };
}

/**
 * Compile one episode into a HyperFrames project.
 *
 * @param {object} args
 * @param {string} args.workspaceRoot   repo root (course folders live here)
 * @param {string} args.courseId        course folder name
 * @param {object} args.episode         episode payload from GET /api/courses (needs .id and .script)
 * @param {number} [args.speed=1]       playback speed (1, 1.25, 1.5, 2) baked into the timeline
 * @param {string} [args.outDir]        override output folder (default <ep>/hyperframes)
 * @returns {Promise<{ projectDir: string, indexPath: string, manifest: object }>}
 */
export async function compileEpisodeProject({ workspaceRoot, courseId, episode, speed = 1, outDir } = {}) {
  if (!workspaceRoot || !courseId || !episode?.id) throw new Error("compileEpisodeProject: missing workspaceRoot/courseId/episode");
  const script = episode.script;
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  if (!scenes.length) throw new Error(`Episode ${episode.id} has no scenes in script.json`);

  const episodeDir = path.join(workspaceRoot, courseId, "episodes", episode.id);
  const projectDir = outDir ? path.resolve(outDir) : path.join(episodeDir, PROJECT_DIRNAME);
  fs.mkdirSync(path.join(projectDir, "lib", "scenes"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "assets", "audio"), { recursive: true });

  // 1. Runtime + vendor files
  for (const f of VENDOR_FILES) {
    if (!fs.existsSync(f.from)) {
      throw new Error(`Missing vendored file ${f.from}. Run: node engine/scripts/vendor_libs.mjs --raw-only`);
    }
    copyFileIfChanged(f.from, path.join(projectDir, ...f.to.split("/")));
  }
  for (const rel of listRuntimeFiles(RUNTIME_DIR)) {
    copyFileIfChanged(path.join(RUNTIME_DIR, rel), path.join(projectDir, "lib", rel));
  }

  // 2. Timeline
  const timing = computeTimeline(scenes, { episodeDir, speed });

  // 3. Audio clips (copied so the project is self-contained for `npx hyperframes render`)
  const audioClips = [];
  const wantedAudio = new Set();
  for (const t of timing.scenes) {
    if (!t.audio_abs) continue;
    const ext = path.extname(t.audio_abs).toLowerCase() || ".mp3";
    const name = `${String(t.index + 1).padStart(2, "0")}-${safeSlug(t.id, `scene${t.index + 1}`)}${ext}`;
    wantedAudio.add(name);
    const dest = path.join(projectDir, "assets", "audio", name);
    copyFileIfChanged(t.audio_abs, dest);
    audioClips.push({
      id: `audio-${t.index}`,
      scene_index: t.index,
      src: `assets/audio/${name}`,
      start: t.start,
      duration: t.duration,
      media_start: 0,
      source_duration: t.source_duration,
      volume: 1,
      playback_rate: timing.speed,
      track_index: 10,
      sha256: sha256(fs.readFileSync(dest)),
    });
  }
  for (const stale of fs.readdirSync(path.join(projectDir, "assets", "audio"))) {
    if (!wantedAudio.has(stale)) fs.rmSync(path.join(projectDir, "assets", "audio", stale), { force: true });
  }

  // 4. Per-scene compiled extras (code tokens, subtitle cues)
  const compiledScenes = [];
  const cuesByScene = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const extra = {};
    if (scene.visual_type === "code_cli") {
      extra.code = await buildCodeCliAssets(scene);
    }
    compiledScenes.push(pickSceneForComposition(scene, extra));
    cuesByScene.push(buildSubtitleCues(scene, timing.scenes[i], timing.speed));
  }

  const episodeData = {
    composition_id: COMPOSITION_ID,
    generator: "tech-video-studio/hyperframes-compiler@1",
    episode: {
      id: episode.id,
      course_id: script.course_id || courseId,
      number: Number(script.episode_number || episode.number || 1),
      title: script.title || episode.title || episode.id,
      aspect_ratio: script.aspect_ratio || "16:9",
    },
    timing: {
      total: timing.total,
      speed: timing.speed,
      scenes: timing.scenes.map(({ index, id, start, duration }) => ({ index, id, start, duration })),
    },
    scenes: compiledScenes,
  };

  const html = renderIndexHtml({
    title: `${episodeData.episode.course_id} · ${episodeData.episode.title}`,
    total: timing.total,
    scenesTiming: timing.scenes,
    scenes: compiledScenes,
    audioClips,
    cuesByScene,
    episodeData,
  });
  const indexPath = path.join(projectDir, "index.html");
  fs.writeFileSync(indexPath, html, "utf-8");

  const manifest = {
    version: 1,
    generator: episodeData.generator,
    generated_at: new Date().toISOString(),
    composition_id: COMPOSITION_ID,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    course_id: courseId,
    episode_id: episode.id,
    speed: timing.speed,
    total_duration: timing.total,
    scenes: timing.scenes.map(({ index, id, start, duration, source_duration, audio_rel }) => ({
      index,
      id,
      visual_type: compiledScenes[index].visual_type,
      start,
      duration,
      source_duration,
      audio_file: audio_rel,
      subtitle_cues: cuesByScene[index].length,
    })),
    audio: audioClips,
    runtime: { hyperframes_core: HF_RUNTIME_VERSION, gsap: GSAP_VERSION },
  };
  fs.writeFileSync(path.join(projectDir, "composition.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  return { projectDir, indexPath, manifest };
}
