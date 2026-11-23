import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = __dirname;
const WORKSPACE_ROOT = process.env.VIDEO_MAKER_WORKSPACE_ROOT
  ? path.resolve(process.env.VIDEO_MAKER_WORKSPACE_ROOT)
  : path.resolve(ENGINE_DIR, "..");

const VALID_FORMATS = new Set(["mp4", "webm"]);
const VALID_CODECS = new Set(["h264", "hevc", "vp9"]);
const VALID_HARDWARE = new Set(["auto", "gpu", "cpu"]);
const VALID_RESOLUTIONS = new Set(["720p", "1080p", "1440p", "2160p"]);
const VALID_FPS = new Set([24, 30, 60]);
const VALID_SPEEDS = new Set([1, 1.25, 1.5, 2]);
// Sole supported engine: HyperFrames composition + zero-dep CDP capture + WebCodecs (engine/hyperframes/).
const VALID_ENGINES = new Set(["hyperframes"]);
const VALID_CAPTURE_FORMATS = new Set(["jpeg", "png"]);

function printUsage() {
  console.log(
    `Usage: node render_video.mjs --course <COURSE> --episode <EP_ID> [--part <part_id>] [--port 3030] [--format mp4|webm] [--codec h264|hevc|vp9] [--hardware auto|gpu|cpu] [--resolution 720p|1080p|1440p|2160p] [--fps 24|30|60] [--speed 1|1.25|1.5|2] [--output <filename>] [--timeout-ms <ms>] [--workers 1..8] [--capture-format jpeg|png] [--jpeg-quality 50..100] [--compile-only] [--check-layout|--no-check-layout] [--qc-strict]\n` +
      `       Engine: hyperframes (sole supported renderer; default 30fps). See engine/HYPERFRAMES_ENGINE.md.`
  );
}

function resolveExpectedOutputFilename(rawName, episodeId, actualExt) {
  const safeExt = String(actualExt || "").toLowerCase() === "mp4" ? "mp4" : "webm";
  const fallbackStem =
    String(episodeId || "video")
      .trim()
      .replace(/[\\/]+/g, "")
      .replace(/\.(mp4|webm)$/i, "") || "video";

  let stem = String(rawName ?? "").trim();
  stem = stem.replace(/[\\/]+/g, "").replace(/\.\.+/g, ".");
  while (/\.(mp4|webm)$/i.test(stem)) {
    stem = stem.replace(/\.(mp4|webm)$/i, "");
  }
  stem = stem.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  stem = stem.replace(/^\.+/, "").slice(0, 96);
  if (!stem || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,95}$/.test(stem)) {
    stem = fallbackStem;
  }
  return `${stem}.${safeExt}`;
}

function defaultTimeoutForOptions(opts) {
  const resMul =
    opts.resolution === "2160p"
      ? 2.2
      : opts.resolution === "1440p"
        ? 1.5
        : opts.resolution === "720p"
          ? 0.85
          : 1.0;
  const fpsMul = opts.fps >= 60 ? 1.75 : opts.fps <= 24 ? 0.85 : 1.0;
  const floorMs = Math.round(3_600_000 * resMul * fpsMul);
  const durationSec = Number(opts.durationSec);
  if (Number.isFinite(durationSec) && durationSec > 0) {
    const speed = Math.max(0.5, Number(opts.speed) || 1);
    const effectiveSec = durationSec / speed;
    const estFrames = effectiveSec * (Number(opts.fps) || 30);
    // Allow generous capture+encode margin for 15–25+ minute deep-dive episodes + 5 min overhead.
    const scaledMs = Math.round(estFrames * 300 * resMul + 300_000);
    return Math.min(28_800_000, Math.max(floorMs, scaledMs));
  }
  return Math.min(28_800_000, Math.round(7_200_000 * resMul * fpsMul));
}

function parseArgs(argv) {
  const opts = {
    course: "",
    episode: "",
    part: "",
    port: 3030,
    format: "mp4",
    codec: "",
    hardware: "auto",
    resolution: "1080p",
    fps: 30,
    speed: 1,
    output: "",
    timeoutMs: null,
    help: false,
    engine: String(process.env.TVS_RENDER_ENGINE || "hyperframes").toLowerCase(),
    workers: 0,
    captureFormat: "jpeg",
    jpegQuality: 92,
    compileOnly: false,
    checkLayout: true,
    qcStrict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--engine") {
      opts.engine = String(argv[++i] || "hyperframes").toLowerCase();
    } else if (arg === "--workers") {
      opts.workers = Number(argv[++i] || 0);
    } else if (arg === "--capture-format") {
      opts.captureFormat = String(argv[++i] || "jpeg").toLowerCase();
    } else if (arg === "--jpeg-quality") {
      opts.jpegQuality = Number(argv[++i] || 92);
    } else if (arg === "--compile-only") {
      opts.compileOnly = true;
    } else if (arg === "--check-layout") {
      opts.checkLayout = true;
    } else if (arg === "--no-check-layout") {
      opts.checkLayout = false;
    } else if (arg === "--qc-strict") {
      opts.qcStrict = true;
      opts.checkLayout = true;
    } else if (arg === "--course") {
      opts.course = argv[++i] || "";
    } else if (arg === "--episode" || arg === "--ep") {
      opts.episode = argv[++i] || "";
    } else if (arg === "--part") {
      opts.part = String(argv[++i] || "").trim();
    } else if (arg === "--port") {
      opts.port = Number(argv[++i] || 3030);
    } else if (arg === "--format") {
      opts.format = String(argv[++i] || "mp4").toLowerCase();
    } else if (arg === "--codec") {
      opts.codec = String(argv[++i] || "").toLowerCase();
    } else if (arg === "--hardware") {
      opts.hardware = String(argv[++i] || "auto").toLowerCase();
    } else if (arg === "--resolution") {
      opts.resolution = String(argv[++i] || "1080p").toLowerCase();
    } else if (arg === "--fps") {
      opts.fps = Number(argv[++i] || 30);
    } else if (arg === "--speed") {
      opts.speed = Number(argv[++i] || 1);
    } else if (arg === "--output") {
      opts.output = String(argv[++i] || "").trim();
    } else if (arg === "--timeout-ms") {
      const rawTimeout = argv[++i];
      opts.timeoutMs = rawTimeout === undefined ? NaN : Number(rawTimeout);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.codec) {
    opts.codec = opts.format === "webm" ? "vp9" : "h264";
  }

  return opts;
}

/**
 * Compile the episode (or single part) to a HyperFrames project and render it with the zero-dep
 * CDP capture + WebCodecs pipeline (engine/hyperframes/render.mjs).
 */
async function runHyperframesRender(opts, epDir) {
  const { renderEpisodeHyperframes } = await import("./hyperframes/render.mjs");
  const startMs = Date.now();
  let cancelled = false;
  let chrome = null;

  const requestCancel = (reason) => {
    if (cancelled) return;
    cancelled = true;
    console.warn(`[render_video] Cancellation requested (${reason}); closing browser...`);
    if (chrome) chrome.close().catch(() => {});
  };
  const onSigInt = () => requestCancel("SIGINT");
  const onSigTerm = () => requestCancel("SIGTERM");
  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);
  const onStdinData = (chunk) => {
    if (String(chunk || "").toUpperCase().includes("CANCEL")) requestCancel("stdin CANCEL");
  };
  if (process.stdin && !process.stdin.isTTY) {
    try {
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", onStdinData);
      process.stdin.resume();
      process.stdin.unref();
    } catch {
      // Ignore stdin pipe errors
    }
  }

  try {
    const targetLabel = opts.part ? `${opts.course}/${opts.episode} (part=${opts.part})` : `${opts.course}/${opts.episode}`;
    console.log(
      `[render] 0% Starting HyperFrames render pipeline for ${targetLabel} (${opts.resolution} @ ${opts.fps}fps, ${opts.speed}x, ${opts.format}/${opts.codec}, hw=${opts.hardware})...`
    );

    if (opts.compileOnly) {
      const { compileEpisodeProject } = await import("./hyperframes/compiler.mjs");
      const { ensureStudioServer, fetchEpisodePayload, projectUrl } = await import("./hyperframes/studio_server.mjs");
      const server = await ensureStudioServer(opts.port, { workspaceRoot: WORKSPACE_ROOT });
      try {
        const episode = await fetchEpisodePayload(opts.port, opts.course, opts.episode, opts.part);
        const compileOpts = {
          workspaceRoot: WORKSPACE_ROOT,
          courseId: opts.course,
          episode,
          speed: opts.speed,
        };
        if (opts.part) compileOpts.partId = opts.part;
        const { projectDir, manifest } = await compileEpisodeProject(compileOpts);
        console.log(`[render] 100% Compiled HyperFrames project (${manifest.total_duration}s, ${manifest.scenes.length} scenes)`);
        console.log(`[render_video] PROJECT: ${projectDir}`);
        console.log(
          `[render_video] PREVIEW: ${projectUrl(opts.port, opts.course, opts.episode, "index.html", opts.part)} (while server.mjs runs)`
        );
      } finally {
        await server.stop();
      }
      return;
    }

    const timer = setTimeout(() => requestCancel(`timeout ${opts.timeoutMs}ms`), opts.timeoutMs);
    timer.unref?.();
    let result;
    try {
      result = await renderEpisodeHyperframes(
        {
          workspaceRoot: WORKSPACE_ROOT,
          course: opts.course,
          episode: opts.episode,
          ...(opts.part ? { part: opts.part } : {}),
          port: opts.port,
          format: opts.format,
          codec: opts.codec,
          hardware: opts.hardware,
          resolution: opts.resolution,
          fps: opts.fps,
          speed: opts.speed,
          output: opts.output,
          workers: opts.workers,
          captureFormat: opts.captureFormat,
          jpegQuality: opts.jpegQuality,
          checkLayout: opts.checkLayout,
          qcStrict: opts.qcStrict,
        },
        {
          log: (line) => console.log(line),
          isCancelled: () => cancelled,
          onChrome: (c) => {
            chrome = c;
          },
        }
      );
    } finally {
      clearTimeout(timer);
    }
    if (cancelled) throw new Error("Render cancelled");
    if (result.browserErrors?.length) {
      throw new Error(`Browser reported ${result.browserErrors.length} error(s):\n${result.browserErrors.slice(0, 10).join("\n")}`);
    }

    const expectedFilename = resolveExpectedOutputFilename(
      result.savedFile || opts.output,
      opts.part || opts.episode,
      result.ext || opts.format
    );
    const outDir = opts.part ? path.join(epDir, "parts", opts.part) : epDir;
    const outPath = path.join(outDir, expectedFilename);
    if (!fs.existsSync(outPath)) throw new Error(`Expected output file missing on disk: ${outPath}`);
    const stat = fs.statSync(outPath);
    if (stat.size <= 0) throw new Error(`Output file is empty (0 bytes): ${outPath}`);

    const elapsedSec = (Date.now() - startMs) / 1000;
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    const speedup = result.durationSec > 0 ? (result.durationSec / elapsedSec).toFixed(2) : "N/A";
    const qcInfo = result.layoutQc
      ? `, qc_errors=${result.layoutQc.error_count}, qc_warnings=${result.layoutQc.warning_count}`
      : `, qc=skipped`;
    const partInfo = opts.part ? `, part=${opts.part}` : "";
    console.log(`[render] 100% Output saved: ${path.basename(outPath)} (${sizeMb} MB)`);
    console.log(
      `[render_video] SUCCESS: ${outPath} (${sizeMb} MB / ${stat.size} bytes, engine=hyperframes${partInfo}, format=${result.format}, codec=${opts.codec}, hw=${result.hardwareAcceleration}, res=${result.width}x${result.height}, fps=${result.fps}, speed=${opts.speed}x, frames=${result.frames}, workers=${result.workers}, duration=${result.durationSec}s, elapsed=${elapsedSec.toFixed(2)}s, speedup=${speedup}x${qcInfo})`
    );
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    if (process.stdin && !process.stdin.isTTY) process.stdin.off("data", onStdinData);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  if (!opts.course || !opts.episode) {
    printUsage();
    throw new Error("Missing required --course and/or --episode flags.");
  }
  if (opts.part && !/^[A-Za-z0-9_-]+$/.test(opts.part)) {
    throw new Error(`Invalid --part: ${opts.part}. Expected alphanumeric, underscore, or hyphen identifier.`);
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) {
    throw new Error(`Invalid --port: ${opts.port}`);
  }
  if (!VALID_FORMATS.has(opts.format)) {
    throw new Error(`Invalid --format: ${opts.format}. Expected mp4 or webm.`);
  }
  if (!VALID_CODECS.has(opts.codec)) {
    throw new Error(`Invalid --codec: ${opts.codec}. Expected h264, hevc, or vp9.`);
  }
  if (!VALID_HARDWARE.has(opts.hardware)) {
    throw new Error(`Invalid --hardware: ${opts.hardware}. Expected auto, gpu, or cpu.`);
  }
  if (!VALID_RESOLUTIONS.has(opts.resolution)) {
    throw new Error(`Invalid --resolution: ${opts.resolution}. Expected 720p, 1080p, 1440p, or 2160p.`);
  }
  if (!VALID_FPS.has(opts.fps)) {
    throw new Error(`Invalid --fps: ${opts.fps}. Expected 24, 30, or 60.`);
  }
  if (!VALID_SPEEDS.has(opts.speed)) {
    throw new Error(`Invalid --speed: ${opts.speed}. Expected 1, 1.25, 1.5, or 2.`);
  }
  if (opts.timeoutMs !== null && (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0)) {
    throw new Error(`Invalid --timeout-ms: ${opts.timeoutMs}`);
  }
  if (opts.engine === "legacy") {
    throw new Error(
      'Legacy Canvas 2D renderer (--engine legacy) has been removed. Use HyperFrames (--engine hyperframes, default).'
    );
  }
  if (!VALID_ENGINES.has(opts.engine)) {
    throw new Error(`Invalid --engine: ${opts.engine}. Only "hyperframes" is supported.`);
  }
  if (!VALID_CAPTURE_FORMATS.has(opts.captureFormat)) {
    throw new Error(`Invalid --capture-format: ${opts.captureFormat}. Expected jpeg or png.`);
  }
  if (opts.workers && (!Number.isInteger(opts.workers) || opts.workers < 1 || opts.workers > 8)) {
    throw new Error(`Invalid --workers: ${opts.workers}. Expected 1..8.`);
  }

  const epDir = path.join(WORKSPACE_ROOT, opts.course, "episodes", opts.episode);
  const scriptPath = opts.part
    ? path.join(epDir, "parts", opts.part, "script.json")
    : path.join(epDir, "script.json");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`${opts.part ? `Part (${opts.part}) ` : "Episode "}script.json not found: ${scriptPath}`);
  }

  if (opts.timeoutMs === null) {
    let durationSec = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
      const declared = Number(parsed?.total_duration_sec);
      if (Number.isFinite(declared) && declared > 0) {
        durationSec = declared;
      } else if (Array.isArray(parsed?.scenes)) {
        durationSec = parsed.scenes.reduce((acc, s) => acc + Math.max(0, Number(s?.duration_sec) || 0), 0);
      }
    } catch {
      // Fall back to default duration budget
    }
    opts.timeoutMs = defaultTimeoutForOptions({ ...opts, durationSec });
  }

  await runHyperframesRender(opts, epDir);
}

main().catch((err) => {
  console.error(`[render_video] ERROR: ${err?.stack || err?.message || err}`);
  process.exitCode = 1;
});
