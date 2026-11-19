import fs from "node:fs";
import path from "node:path";

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".srt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export function serveFileWithRange(req, res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const total = stat.size;
  const range = req.headers.range;

  if (range && total > 0) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (start <= end && start < total) {
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }
  }

  res.writeHead(200, {
    "Content-Length": total,
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

export function resolveVideoFormatFromRequest(req, parsedUrl) {
  const queryFmt =
    parsedUrl.searchParams.get("format") || parsedUrl.searchParams.get("ext") || "";
  if (queryFmt) return queryFmt.trim().toLowerCase();

  const headerFmt = req.headers["x-video-format"];
  if (typeof headerFmt === "string" && headerFmt.trim()) {
    return headerFmt.trim().toLowerCase();
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("video/mp4")) return "mp4";
  if (contentType.includes("video/webm")) return "webm";

  return "webm";
}

function getMaxVideoUploadBytes() {
  const raw = Number(process.env.VIDEO_MAKER_MAX_UPLOAD_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_UPLOAD_BYTES;
}

export function createMediaHandlers({
  ENGINE_DIR,
  WORKSPACE_ROOT,
  VOICE_PREVIEW_CACHE_DIR,
  safeResolve,
  sendJson,
  readJsonBody,
  sanitizeVideoOutputStem,
  inspectEpisodeArtifacts,
  readEpisodeState,
  recomputeState,
  writeJsonAtomic,
  appendEvent,
  scheduleStateBroadcast,
  mapEpisodeVideoFiles,
  broadcastSse,
  activeJobByEp,
  jobs,
  mutateEpisodeStateForJob,
}) {
  const publicDir = path.join(ENGINE_DIR, "public");
  const vendorDir = path.join(publicDir, "vendor");
  const srcDir = path.join(ENGINE_DIR, "src");
  const svgAssetsDir = path.join(ENGINE_DIR, "assets", "svg");

  function handleSaveVideo(req, res, parsedUrl) {
    const course = parsedUrl.searchParams.get("course") || "";
    const episode = parsedUrl.searchParams.get("episode") || "";
    const ext = resolveVideoFormatFromRequest(req, parsedUrl);

    if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
    }
    if (ext !== "webm" && ext !== "mp4") {
      return sendJson(res, 400, { ok: false, error: "Only webm or mp4 formats are supported" });
    }

    const rawRequestedName =
      parsedUrl.searchParams.get("filename") ||
      parsedUrl.searchParams.get("output_filename") ||
      (typeof req.headers["x-video-filename"] === "string"
        ? req.headers["x-video-filename"]
        : "") ||
      "";
    const stemRes = sanitizeVideoOutputStem(rawRequestedName, episode);
    if (!stemRes.ok) {
      return sendJson(res, 400, { ok: false, error: stemRes.error });
    }

    const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode]);
    if (!epDir || !fs.existsSync(epDir)) {
      return sendJson(res, 404, { ok: false, error: "Episode directory not found" });
    }

    const filename = `${stemRes.stem}.${ext}`;
    const outPath = safeResolve(epDir, [filename]);
    if (!outPath) {
      return sendJson(res, 403, { ok: false, error: "Forbidden" });
    }

    const maxBytes = getMaxVideoUploadBytes();
    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      req.resume();
      return sendJson(res, 413, {
        ok: false,
        error: `Video upload exceeds max size limit (${maxBytes} bytes)`,
      });
    }

    const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
    const writeStream = fs.createWriteStream(tmpPath);
    let bytesWritten = 0;
    let settled = false;
    let reqEnded = false;

    const unlinkTmpSafe = () => {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    const failUpload = (status, message, destroyReq = false) => {
      if (settled) return;
      settled = true;

      const finishReply = () => {
        unlinkTmpSafe();
        if (!res.headersSent && !res.writableEnded) {
          sendJson(res, status, { ok: false, error: message });
        }
      };

      if (destroyReq && !req.destroyed) {
        req.destroy();
      }

      if (writeStream.closed || writeStream.destroyed) {
        finishReply();
      } else {
        writeStream.once("close", finishReply);
        writeStream.destroy();
      }
    };

    req.on("data", (chunk) => {
      if (settled) return;
      bytesWritten += chunk.length;
      if (bytesWritten > maxBytes) {
        failUpload(
          413,
          `Video upload exceeds max size limit (${maxBytes} bytes)`,
          true
        );
        return;
      }
      const canContinue = writeStream.write(chunk);
      if (!canContinue) {
        req.pause();
      }
    });

    writeStream.on("drain", () => {
      if (!settled && !req.destroyed) {
        req.resume();
      }
    });

    req.on("aborted", () => {
      failUpload(499, "Upload aborted by client");
    });

    req.on("close", () => {
      if (!reqEnded && !settled) {
        failUpload(499, "Client connection closed before upload completed");
      }
    });

    req.on("error", (err) => {
      failUpload(500, err.message);
    });

    writeStream.on("error", (err) => {
      failUpload(500, err.message, true);
    });

    req.on("end", () => {
      reqEnded = true;
      if (settled) return;
      writeStream.end();
    });

    writeStream.on("finish", () => {
      if (settled) return;
      settled = true;

      try {
        fs.renameSync(tmpPath, outPath);
      } catch (err) {
        unlinkTmpSafe();
        if (!res.headersSent && !res.writableEnded) {
          sendJson(res, 500, { ok: false, error: err.message });
        }
        return;
      }

      const courseDir = path.join(WORKSPACE_ROOT, course);
      const artifacts = inspectEpisodeArtifacts(courseDir, episode);
      if (!artifacts.video_file) {
        artifacts.video_file = filename;
      }

      // Auto-update state/<episode>.json if it exists
      const stateDir = path.join(courseDir, "state");
      const statePath = path.join(stateDir, `${episode}.json`);
      if (fs.existsSync(statePath)) {
        const state = readEpisodeState(stateDir, episode);
        if (state) {
          const now = new Date().toISOString();
          state.artifacts = artifacts;
          state.production = state.production || {};
          state.production.video_done = true;
          state.updated_at = now;
          recomputeState(state);
          writeJsonAtomic(statePath, state);
          appendEvent(stateDir, {
            type: "video_saved",
            course,
            episode_id: episode,
            video_file: filename,
            format: ext,
            bytes: bytesWritten,
            overall_status: state.overall_status,
          });
          scheduleStateBroadcast(course, `${episode}.json`);
        }
      }

      const videoFiles = mapEpisodeVideoFiles(course, episode, artifacts);
      broadcastSse("courses_updated", {
        course,
        episode_id: episode,
        video_file: artifacts.video_file || filename,
        ts: new Date().toISOString(),
      });

      const videoUrl = `/courses/${encodeURIComponent(course)}/episodes/${encodeURIComponent(episode)}/${encodeURIComponent(filename)}`;
      sendJson(res, 200, {
        ok: true,
        file: filename,
        filename,
        format: ext,
        path: outPath,
        bytes: bytesWritten,
        video_url: videoUrl,
        video_file: artifacts.video_file || filename,
        video_files: videoFiles,
      });
    });
  }

  async function handleDeleteEpisodeVideo(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const course = String(body.course || "").trim();
    const episode = String(body.episode || "").trim();
    const filename = String(body.filename || "").trim();

    if (!/^[A-Za-z0-9_-]+$/.test(course) || !/^[A-Za-z0-9_-]+$/.test(episode)) {
      return sendJson(res, 400, { ok: false, error: "Invalid course or episode identifier" });
    }
    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..") ||
      !/^[A-Za-z0-9_.-]+\.(mp4|webm)$/i.test(filename)
    ) {
      return sendJson(res, 400, { ok: false, error: "Invalid video filename" });
    }

    const jobKey = `${course}:${episode}`;
    if (activeJobByEp.has(jobKey)) {
      const existingJob = jobs.get(activeJobByEp.get(jobKey));
      if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) {
        return sendJson(res, 409, {
          ok: false,
          error: `Tập ${episode} đang có tác vụ TTS/Render đang chạy hoặc chờ xử lý. Vui lòng đợi hoàn tất trước khi xóa video.`,
        });
      }
    }

    const courseDir = safeResolve(WORKSPACE_ROOT, [course]);
    const epDir = safeResolve(WORKSPACE_ROOT, [course, "episodes", episode]);
    if (!courseDir || !epDir || !fs.existsSync(epDir)) {
      return sendJson(res, 404, { ok: false, error: "Episode directory not found" });
    }

    const targetPath = safeResolve(epDir, [filename]);
    if (!targetPath || targetPath === path.resolve(epDir)) {
      return sendJson(res, 403, { ok: false, error: "Forbidden" });
    }
    if (fs.existsSync(targetPath)) {
      if (fs.statSync(targetPath).isDirectory()) {
        return sendJson(res, 400, { ok: false, error: "Target is a directory" });
      }
      fs.unlinkSync(targetPath);
    }

    const artifacts = inspectEpisodeArtifacts(courseDir, episode);
    const remainingVideos = Array.isArray(artifacts.video_files) ? artifacts.video_files.length : 0;
    const videoFiles = mapEpisodeVideoFiles(course, episode, artifacts);

    const stateDir = path.join(courseDir, "state");
    const statePath = path.join(stateDir, `${episode}.json`);
    if (fs.existsSync(stateDir) || fs.existsSync(statePath)) {
      mutateEpisodeStateForJob(
        course,
        episode,
        (state, freshArtifacts) => {
          const count = Array.isArray(freshArtifacts.video_files)
            ? freshArtifacts.video_files.length
            : 0;
          if (count === 0) {
            state.production = state.production || {};
            state.production.video_done = false;
            state.production.verified = false;
            state.production.stale = false;
            state.production.stale_reason = null;
            if (state.production.status === "completed") {
              state.production.status = "pending";
              state.production.completed_at = null;
            }
          }
        },
        {
          type: "video_file_deleted",
          filename,
          remaining_count: remainingVideos,
          video_file: artifacts.video_file || null,
          message: `Deleted rendered video ${filename}`,
        }
      );
    }

    broadcastSse("courses_updated", {
      course,
      episode_id: episode,
      deleted: filename,
      video_file: artifacts.video_file || null,
      video_files: videoFiles,
      ts: new Date().toISOString(),
    });

    return sendJson(res, 200, {
      ok: true,
      deleted: filename,
      video_file: artifacts.video_file || null,
      video_files: videoFiles,
    });
  }

  function handleMediaRoutes(req, res, pathname, parsedUrl) {
    if (req.method === "POST" && pathname === "/api/save-video") {
      handleSaveVideo(req, res, parsedUrl);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/episodes/video/delete") {
      void handleDeleteEpisodeVideo(req, res);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/api/voices/preview-file/")) {
      const filename = pathname.slice("/api/voices/preview-file/".length);
      if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
        sendJson(res, 400, { ok: false, error: "Invalid preview filename" });
        return true;
      }
      const target = safeResolve(VOICE_PREVIEW_CACHE_DIR, [filename]);
      if (!target) {
        sendJson(res, 403, { ok: false, error: "Forbidden" });
        return true;
      }
      serveFileWithRange(req, res, target);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/courses/")) {
      const rel = pathname.slice("/courses/".length).split("/").filter(Boolean);
      if (rel.length === 0) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return true;
      }
      const courseSlug = rel[0];
      if (
        courseSlug.startsWith(".") ||
        courseSlug === "engine" ||
        courseSlug === "node_modules" ||
        courseSlug.includes("\\") ||
        courseSlug.includes("..")
      ) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return true;
      }
      const courseRoot = safeResolve(WORKSPACE_ROOT, [courseSlug]);
      if (!courseRoot || !fs.existsSync(path.join(courseRoot, "course.json"))) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return true;
      }
      const target = safeResolve(courseRoot, rel.slice(1));
      if (!target || target === courseRoot) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return true;
      }
      serveFileWithRange(req, res, target);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/assets/svg/")) {
      const rel = pathname.slice("/assets/svg/".length).split("/").filter(Boolean);
      const target = safeResolve(svgAssetsDir, rel);
      if (!target || target === path.resolve(svgAssetsDir)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return true;
      }
      serveFileWithRange(req, res, target);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/vendor/")) {
      const rel = pathname.slice("/vendor/".length).split("/").filter(Boolean);
      const target = safeResolve(vendorDir, rel);
      if (!target || target === path.resolve(vendorDir)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return true;
      }
      serveFileWithRange(req, res, target);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/public/")) {
      const rel = pathname.slice("/public/".length).split("/").filter(Boolean);
      const target = safeResolve(publicDir, rel);
      if (!target || target === path.resolve(publicDir)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return true;
      }
      serveFileWithRange(req, res, target);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/src/")) {
      const rel = pathname.slice("/src/".length).split("/").filter(Boolean);
      const target = safeResolve(srcDir, rel);
      if (!target) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return true;
      }
      serveFileWithRange(req, res, target);
      return true;
    }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      serveFileWithRange(req, res, path.join(publicDir, "index.html"));
      return true;
    }

    return false;
  }

  return {
    handleSaveVideo,
    handleDeleteEpisodeVideo,
    handleMediaRoutes,
  };
}
