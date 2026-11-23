// Helpers to reuse (or temporarily spawn) the Studio server (engine/server.mjs) and read the
// normalized episode payload (script.json + active voice track) from GET /api/courses.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { httpGetJson, sleep, terminateProcess } from "./cdp.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_DIR = path.resolve(path.dirname(__filename), "..");

export async function isServerRunning(port) {
  try {
    const data = await httpGetJson(`http://127.0.0.1:${port}/api/courses`, 1500);
    return Array.isArray(data?.courses);
  } catch {
    return false;
  }
}

/**
 * Ensure a Studio server is listening on `port`. Returns { child, stop() } where child is null
 * when an existing server is reused.
 */
export async function ensureStudioServer(port, { log = console.log, workspaceRoot } = {}) {
  if (await isServerRunning(port)) {
    log(`[hyperframes] Using existing Studio server at http://localhost:${port}`);
    return { child: null, stop: async () => {} };
  }
  log(`[hyperframes] Starting temporary Studio server on port ${port}...`);
  const env = { ...process.env, PORT: String(port) };
  if (workspaceRoot) env.VIDEO_MAKER_WORKSPACE_ROOT = workspaceRoot;
  const child = spawn(process.execPath, [path.join(ENGINE_DIR, "server.mjs")], {
    cwd: ENGINE_DIR,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Temporary server.mjs exited early (${child.exitCode}): ${stderr}`);
    if (await isServerRunning(port)) {
      log(`[hyperframes] Temporary Studio server ready on http://localhost:${port}`);
      return { child, stop: () => terminateProcess(child, "server.mjs") };
    }
    await sleep(200);
  }
  await terminateProcess(child, "server.mjs");
  throw new Error(`Timed out waiting for temporary server.mjs on port ${port}`);
}

/** Fetch the normalized episode (or single part) payload as the Studio player sees it. */
export async function fetchEpisodePayload(port, courseId, episodeId, partId = "") {
  const cleanPartId = String(partId || "").trim();
  if (cleanPartId) {
    const partUrl = `http://127.0.0.1:${port}/api/episodes/part?course=${encodeURIComponent(courseId)}&episode=${encodeURIComponent(episodeId)}&part=${encodeURIComponent(cleanPartId)}`;
    try {
      const partData = await httpGetJson(partUrl, 15_000);
      if (partData?.ok === false) {
        throw new Error(partData.error || `Part not found: ${courseId}/${episodeId}/${cleanPartId}`);
      }
      const script = partData?.script || partData?.episode?.script || null;
      if (!script?.scenes?.length) {
        throw new Error(`Part ${courseId}/${episodeId}/${cleanPartId} has no valid script.json scenes`);
      }
      const baseEp = partData?.episode && typeof partData.episode === "object" ? partData.episode : {};
      return {
        ...baseEp,
        id: baseEp.id || episodeId,
        part_id: partData?.part_id || cleanPartId,
        base_url:
          baseEp.base_url ||
          `/courses/${encodeURIComponent(courseId)}/episodes/${encodeURIComponent(episodeId)}/parts/${encodeURIComponent(cleanPartId)}`,
        script,
      };
    } catch (err) {
      if (!String(err?.message || "").includes("HTTP 404")) {
        throw err;
      }
      // Fallback when /api/episodes/part is not mounted yet: fetch static part script.json + parent episode metadata.
      const staticScriptUrl = `http://127.0.0.1:${port}/courses/${encodeURIComponent(courseId)}/episodes/${encodeURIComponent(episodeId)}/parts/${encodeURIComponent(cleanPartId)}/script.json`;
      const partScript = await httpGetJson(staticScriptUrl, 15_000);
      if (!partScript?.scenes?.length) {
        throw new Error(`Part ${courseId}/${episodeId}/${cleanPartId} has no valid script.json scenes`);
      }
      let parentMeta = {};
      try {
        const coursesData = await httpGetJson(`http://127.0.0.1:${port}/api/courses`, 15_000);
        const course = (coursesData.courses || []).find((c) => c.id === courseId);
        const ep = (course?.episodes || []).find((e) => e.id === episodeId);
        if (ep) {
          const { script: _ignoredScript, ...rest } = ep;
          parentMeta = rest;
        }
      } catch {
        // Parent metadata lookup is best-effort for fallback
      }
      return {
        ...parentMeta,
        id: episodeId,
        part_id: cleanPartId,
        base_url: `/courses/${encodeURIComponent(courseId)}/episodes/${encodeURIComponent(episodeId)}/parts/${encodeURIComponent(cleanPartId)}`,
        script: partScript,
      };
    }
  }

  const data = await httpGetJson(`http://127.0.0.1:${port}/api/courses`, 15_000);
  const course = (data.courses || []).find((c) => c.id === courseId);
  if (!course) throw new Error(`Course not found: ${courseId}`);
  const episode = (course.episodes || []).find((e) => e.id === episodeId);
  if (!episode) throw new Error(`Episode not found: ${courseId}/${episodeId}`);
  if (!episode.script?.scenes?.length) throw new Error(`Episode ${episodeId} has no valid script.json scenes`);
  return episode;
}

export function projectUrl(port, courseId, episodeId, file = "index.html", partId = "") {
  const cleanFile = String(file || "index.html").replace(/^\/+/, "");
  const cleanPartId = String(partId || "").trim();
  const base = cleanPartId
    ? `http://127.0.0.1:${port}/courses/${encodeURIComponent(courseId)}/episodes/${encodeURIComponent(episodeId)}/parts/${encodeURIComponent(cleanPartId)}/hyperframes`
    : `http://127.0.0.1:${port}/courses/${encodeURIComponent(courseId)}/episodes/${encodeURIComponent(episodeId)}/hyperframes`;
  return `${base}/${cleanFile}`;
}
