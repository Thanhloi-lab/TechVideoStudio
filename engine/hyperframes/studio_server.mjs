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

/** Fetch the normalized episode payload (as the Studio player sees it). */
export async function fetchEpisodePayload(port, courseId, episodeId) {
  const data = await httpGetJson(`http://127.0.0.1:${port}/api/courses`, 15_000);
  const course = (data.courses || []).find((c) => c.id === courseId);
  if (!course) throw new Error(`Course not found: ${courseId}`);
  const episode = (course.episodes || []).find((e) => e.id === episodeId);
  if (!episode) throw new Error(`Episode not found: ${courseId}/${episodeId}`);
  if (!episode.script?.scenes?.length) throw new Error(`Episode ${episodeId} has no valid script.json scenes`);
  return episode;
}

export function projectUrl(port, courseId, episodeId, file = "index.html") {
  return `http://127.0.0.1:${port}/courses/${encodeURIComponent(courseId)}/episodes/${encodeURIComponent(episodeId)}/hyperframes/${file}`;
}
