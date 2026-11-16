import React, { useEffect, useMemo, useRef, useState } from "react";

const h = React.createElement;

const RES_SHORT = {
  "720p": "HD",
  "1080p": "FHD",
  "1440p": "2K",
  "2160p": "4K",
};

const HW_SHORT = {
  auto: "Auto",
  gpu: "GPU",
  cpu: "CPU",
};

const CODEC_SHORT = {
  h264: "H.264",
  hevc: "HEVC",
  vp9: "VP9",
};

const MODE_META = {
  tts_only: { label: "TTS", cls: "is-tts" },
  render_only: { label: "Xuất Video", cls: "is-render" },
  tts_and_render: { label: "TTS + Render", cls: "is-full" },
  script_episode: { label: "🤖 AI · 1 tập", cls: "is-ai" },
  script_batch: { label: "🤖 AI · Đợt", cls: "is-ai" },
};

function isJobActive(job) {
  return job?.status === "running" || job?.status === "queued";
}

function isJobPaused(job) {
  return job?.status === "paused";
}

function isJobCompleted(job) {
  return job?.status === "completed" || job?.status === "done" || job?.status === "succeeded";
}

function isJobFailed(job) {
  return job?.status === "failed" || job?.status === "error";
}

function getStepLabel(job) {
  if (!job) return "";
  if (job.kind === "ai_script") {
    const done = Array.isArray(job.completed_episodes) ? job.completed_episodes.length : 0;
    const total = Array.isArray(job.episode_ids) ? job.episode_ids.length : 1;
    if (job.status === "paused") {
      return job.pause_reason === "quota_exhausted"
        ? `⏸️ Hết Quota (${done}/${total})`
        : `⏸️ Tạm dừng (${done}/${total})`;
    }
    if (job.status === "queued") return `Chờ Worker (${total} tập)`;
    if (job.status === "running") {
      const pct = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
      const cur = job.current_episode || "";
      return `✍️ ${job.step || "Đang viết"}${cur ? ` · ${cur}` : ""} (${done}/${total} · ${pct}%)`;
    }
    if (isJobCompleted(job)) {
      return job.auto_produce ? "Xong KB · Đã đẩy Render" : `Hoàn tất KB (${total} tập)`;
    }
    if (isJobFailed(job)) return "AI Thất bại";
    if (job.status === "cancelled") return "Đã hủy AI";
    return String(job.status || "");
  }
  if (job.status === "queued") {
    const pos = Number(job.queue_position);
    return Number.isFinite(pos) && pos > 0 ? `Đang xếp hàng (#${pos})` : "Đang xếp hàng";
  }
  if (job.status === "running") {
    const pct = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
    if (job.step === "assign_voice") return "Gán giọng";
    if (job.step === "tts_processing") return "TTS";
    if (job.step === "rendering") return `Render ${pct}%`;
    return `${job.step || "Đang chạy"} ${pct}%`;
  }
  if (isJobCompleted(job)) return "Hoàn tất";
  if (isJobFailed(job)) return "Thất bại";
  if (job.status === "cancelled") return "Đã hủy";
  return String(job.status || "");
}

function formatSpecSummary(job) {
  if (!job) return "";
  if (job.kind === "ai_script") {
    const prov = job.provider_id || (job.execution_mode === "mcp" ? "antigravity" : "");
    const modelStr = job.model || job.claimed_model || (prov === "antigravity" ? "Antigravity Worker" : "AI");
    const label = prov && !String(modelStr).toLowerCase().includes(prov.toLowerCase())
      ? `${prov} · ${modelStr}`
      : modelStr;
    return `${label} · ${job.auto_produce ? "Tự chạy TTS & Render" : "Dừng ở script_ready (Storyboard)"}`;
  }
  if (job.mode === "tts_only") return "";
  const parts = [];
  if (job.resolution) parts.push(RES_SHORT[job.resolution] || job.resolution);
  if (job.fps) parts.push(`${job.fps}fps`);
  if (job.speed !== undefined && job.speed !== null) {
    parts.push(`${Number(job.speed) || 1}x`);
  }
  if (job.hardware) parts.push(HW_SHORT[job.hardware] || String(job.hardware).toUpperCase());
  const fmt = job.format ? String(job.format).toUpperCase() : "";
  const cdc = job.codec ? CODEC_SHORT[job.codec] || String(job.codec).toUpperCase() : "";
  if (fmt && cdc) parts.push(`${fmt} ${cdc}`);
  else if (fmt) parts.push(fmt);
  return parts.join(" · ");
}

function getJobOrderScore(job) {
  if (job.status === "running") return 0;
  if (job.status === "paused") return 1;
  if (job.status === "queued") return 2;
  if (isJobCompleted(job)) return 3;
  if (isJobFailed(job)) return 4;
  return 5;
}

export function HeaderJobsTray({
  jobs = [],
  onCancelJob,
  onClearFinishedJobs,
  onNavigateToPlayer,
  onResumeAiJob,
  highlightSignal = 0,
}) {
  const [open, setOpen] = useState(false);
  const [busyCancelIds, setBusyCancelIds] = useState({});
  const [clearing, setClearing] = useState(false);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!highlightSignal) return undefined;
    setIsHighlighted(true);
    const timer = setTimeout(() => setIsHighlighted(false), 2600);
    return () => clearTimeout(timer);
  }, [highlightSignal]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const sortedJobs = useMemo(() => {
    return [...(jobs || [])].sort((a, b) => {
      const scoreDiff = getJobOrderScore(a) - getJobOrderScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      if (a.status === "queued" && b.status === "queued") {
        const qa = Number(a.queue_position) || 999;
        const qb = Number(b.queue_position) || 999;
        if (qa !== qb) return qa - qb;
      }
      return String(b.updated_at || b.started_at || "").localeCompare(
        String(a.updated_at || a.started_at || "")
      );
    });
  }, [jobs]);

  const stats = useMemo(() => {
    const running = sortedJobs.filter((j) => j.status === "running");
    const queued = sortedJobs.filter((j) => j.status === "queued");
    const paused = sortedJobs.filter(isJobPaused);
    const completed = sortedJobs.filter(isJobCompleted);
    const failed = sortedJobs.filter(isJobFailed);
    const finishedCount = sortedJobs.filter((j) => !isJobActive(j) && !isJobPaused(j)).length;
    const activeCount = running.length + queued.length;
    const avgPct =
      running.length > 0
        ? Math.round(
            running.reduce((sum, j) => sum + Math.max(0, Math.min(100, Number(j.progress) || 0)), 0) /
              running.length
          )
        : 0;
    return {
      runningCount: running.length,
      queuedCount: queued.length,
      pausedCount: paused.length,
      activeCount,
      completedCount: completed.length,
      failedCount: failed.length,
      finishedCount,
      avgPct,
    };
  }, [sortedJobs]);

  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const visualPct = stats.activeCount > 0 ? Math.max(stats.runningCount > 0 ? 8 : 16, stats.avgPct) : 0;
  const dashOffset = circumference * (1 - visualPct / 100);

  const handleCancelClick = async (jobId) => {
    if (!onCancelJob || busyCancelIds[jobId]) return;
    setBusyCancelIds((prev) => ({ ...prev, [jobId]: true }));
    try {
      await onCancelJob(jobId);
    } finally {
      setBusyCancelIds((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    }
  };

  const handleClearClick = async () => {
    if (!onClearFinishedJobs || clearing) return;
    setClearing(true);
    try {
      await onClearFinishedJobs();
    } finally {
      setClearing(false);
    }
  };

  const buttonStateClass =
    stats.activeCount > 0
      ? "is-active"
      : stats.pausedCount > 0
        ? "is-paused"
        : stats.completedCount > 0
          ? "is-completed"
          : stats.failedCount > 0
            ? "is-failed"
            : "is-idle";

  return h(
    "div",
    { className: "jobs-tray-wrap", ref: containerRef },
    h(
      "button",
      {
        type: "button",
        className: [
          "jobs-tray-btn",
          buttonStateClass,
          open ? "is-open" : "",
          isHighlighted ? "is-highlighted" : "",
        ]
          .filter(Boolean)
          .join(" "),
        onClick: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        title:
          stats.activeCount > 0
            ? `${stats.runningCount} đang chạy, ${stats.queuedCount} đang chờ (${stats.avgPct}%)`
            : stats.completedCount > 0
              ? `${stats.completedCount} tác vụ đã hoàn tất`
              : "Tác vụ chạy ngầm trên Server",
      },
      // Circular SVG Indicator
      stats.activeCount > 0
        ? h(
            "svg",
            {
              className: `jobs-ring-svg ${stats.runningCount === 0 || stats.avgPct < 5 ? "is-spinning" : ""}`,
              width: 20,
              height: 20,
              viewBox: "0 0 24 24",
              "aria-hidden": "true",
            },
            h("circle", {
              className: "jobs-ring-track",
              cx: 12,
              cy: 12,
              r: radius,
              fill: "none",
              strokeWidth: 2.6,
            }),
            h("circle", {
              className: "jobs-ring-fill",
              cx: 12,
              cy: 12,
              r: radius,
              fill: "none",
              strokeWidth: 2.6,
              strokeLinecap: "round",
              strokeDasharray: circumference.toFixed(2),
              strokeDashoffset: dashOffset.toFixed(2),
              transform: "rotate(-90 12 12)",
            })
          )
        : stats.completedCount > 0
          ? h(
              "svg",
              {
                className: "jobs-check-svg",
                width: 19,
                height: 19,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2.4,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": "true",
              },
              h("circle", { cx: 12, cy: 12, r: 9 }),
              h("path", { d: "M8.5 12.5l2.5 2.5 4.5-5" })
            )
          : h(
              "svg",
              {
                className: "jobs-idle-svg",
                width: 18,
                height: 18,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2.1,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": "true",
              },
              h("path", { d: "M12 4v10" }),
              h("path", { d: "M8 10l4 4 4-4" }),
              h("path", { d: "M5 18h14" })
            ),

      h(
        "span",
        { className: "jobs-tray-label" },
        stats.activeCount > 0 ? `${stats.avgPct}%` : stats.pausedCount > 0 ? "Tạm dừng" : "Tác vụ"
      ),

      stats.activeCount > 0
        ? h("span", { className: "jobs-count-pill is-active" }, stats.activeCount)
        : stats.pausedCount > 0
          ? h("span", { className: "jobs-count-pill is-paused" }, `⏸ ${stats.pausedCount}`)
          : stats.completedCount > 0
            ? h("span", { className: "jobs-count-pill is-done" }, `✓ ${stats.completedCount}`)
            : stats.failedCount > 0
              ? h("span", { className: "jobs-count-pill is-err" }, stats.failedCount)
              : null
    ),

    open
      ? h(
          "div",
          {
            className: "jobs-popover",
            role: "dialog",
            "aria-label": "Danh sách tác vụ nền",
          },
          h(
            "div",
            { className: "jobs-popover-header" },
            h(
              "div",
              null,
              h("div", { className: "jobs-popover-title" }, "Tác vụ nền Server"),
              h(
                "div",
                { className: "jobs-popover-sub" },
                stats.activeCount > 0
                  ? `${stats.runningCount} đang chạy · ${stats.queuedCount} đang xếp hàng`
                  : sortedJobs.length > 0
                    ? `${sortedJobs.length} tác vụ gần đây`
                    : "Đóng trình duyệt vẫn chạy tiếp"
              )
            ),
            h(
              "button",
              {
                type: "button",
                className: "jobs-popover-close",
                onClick: () => setOpen(false),
                "aria-label": "Đóng",
              },
              "✕"
            )
          ),

          h(
            "div",
            { className: "jobs-popover-body" },
            sortedJobs.length === 0
              ? h(
                  "div",
                  { className: "jobs-empty" },
                  "Chưa có tác vụ nào. Dùng \"🎬 Xuất Video ▾\" hoặc \"🎬 Tạo Audio & Render\" trong Player để xuất ngầm trên Server."
                )
              : sortedJobs.map((job) => {
                  const isAi = job.kind === "ai_script";
                  const active = isJobActive(job);
                  const paused = isJobPaused(job);
                  const completed = isJobCompleted(job);
                  const failed = isJobFailed(job);
                  const cancelled = job.status === "cancelled";
                  const modeKey = isAi ? job.type : job.mode;
                  const modeInfo =
                    MODE_META[modeKey] ||
                    (isAi
                      ? { label: `🤖 AI · ${job.episode_ids?.length || 1} tập`, cls: "is-ai" }
                      : { label: job.mode || "Job", cls: "is-full" });
                  const pct = completed ? 100 : Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
                  const specText = formatSpecSummary(job);
                  const primaryEp = isAi ? job.episode_ids?.[0] || "" : job.episode || "";
                  const displayTitle = isAi
                    ? job.episode_ids?.length > 1
                      ? `${job.episode_ids.length} tập: ${job.episode_ids.join(", ")}`
                      : job.episode_titles?.[primaryEp]
                        ? `${primaryEp} · ${job.episode_titles[primaryEp]}`
                        : primaryEp
                    : job.episode_title
                      ? `${job.episode} · ${job.episode_title}`
                      : job.episode;
                  const latestLog =
                    job.error ||
                    (Array.isArray(job.logs) && job.logs.length > 0
                      ? job.logs[job.logs.length - 1]
                      : "") ||
                    job.message ||
                    "";

                  return h(
                    "div",
                    {
                      key: job.id,
                      className: `job-row is-${job.status || "queued"} ${isAi ? "is-ai-job" : ""}`,
                    },
                    h(
                      "div",
                      { className: "job-row-top" },
                      h(
                        "div",
                        { className: "job-row-ident" },
                        h("span", { className: "job-course-badge" }, job.course),
                        h(
                          "span",
                          { className: "job-ep-title", title: displayTitle },
                          displayTitle
                        )
                      ),
                      h("span", { className: `job-mode-badge ${modeInfo.cls}` }, modeInfo.label)
                    ),

                    h(
                      "div",
                      { className: "job-row-status-line" },
                      h(
                        "span",
                        {
                          className: `job-step-label ${
                            completed ? "is-done" : paused ? "is-paused" : failed ? "is-err" : cancelled ? "is-cancelled" : ""
                          }`,
                        },
                        getStepLabel(job)
                      ),
                      h("span", { className: "job-pct-num" }, `${pct}%`)
                    ),

                    h(
                      "div",
                      { className: "job-row-track" },
                      h("div", {
                        className: `job-row-fill ${
                          job.status === "queued"
                            ? "is-queued"
                            : paused
                              ? "is-paused"
                              : active && pct < 5
                                ? "is-indeterminate"
                                : completed
                                  ? "is-done"
                                  : failed
                                    ? "is-err"
                                    : cancelled
                                      ? "is-cancelled"
                                      : ""
                        }`,
                        style: { width: `${active && pct < 5 ? 18 : pct}%` },
                      })
                    ),

                    specText
                      ? h("div", { className: "job-spec-line" }, specText)
                      : null,

                    latestLog
                      ? h(
                          "div",
                          { className: `job-log-line ${failed ? "is-err" : ""}`, title: latestLog },
                          latestLog
                        )
                      : null,

                    h(
                      "div",
                      { className: "job-row-actions" },
                      isAi && paused
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "job-act-btn is-resume",
                              onClick: () => {
                                setOpen(false);
                                if (onResumeAiJob) {
                                  onResumeAiJob(job);
                                } else if (job.course) {
                                  window.location.href = `?view=roadmap&course=${encodeURIComponent(job.course)}`;
                                }
                              },
                            },
                            "▶ Tiếp tục"
                          )
                        : null,
                      active || (isAi && paused)
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "job-act-btn is-cancel",
                              disabled: Boolean(busyCancelIds[job.id]),
                              onClick: () => handleCancelClick(job.id),
                            },
                            busyCancelIds[job.id] ? "Đang hủy..." : "✕ Hủy"
                          )
                        : null,
                      !isAi && completed && job.output_file
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "job-saved-file-badge",
                              title: `Đã lưu tại ${job.course}/episodes/${job.episode}/${job.output_file} — Bấm để mở Player`,
                              onClick: () => {
                                setOpen(false);
                                if (onNavigateToPlayer) {
                                  onNavigateToPlayer(job.course, primaryEp);
                                } else {
                                  window.location.href = `?course=${encodeURIComponent(job.course)}&ep=${encodeURIComponent(primaryEp)}&view=player`;
                                }
                              },
                            },
                            `📁 ${job.output_file}`
                          )
                        : null,
                      completed && primaryEp
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "job-act-btn is-watch",
                              onClick: () => {
                                setOpen(false);
                                if (onNavigateToPlayer) {
                                  onNavigateToPlayer(job.course, primaryEp);
                                } else {
                                  window.location.href = `?course=${encodeURIComponent(job.course)}&ep=${encodeURIComponent(primaryEp)}&view=player`;
                                }
                              },
                            },
                            isAi ? "🎬 Storyboard" : "▶ Xem"
                          )
                        : null
                    )
                  );
                })
          ),

          stats.finishedCount > 0
            ? h(
                "div",
                { className: "jobs-popover-footer" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "jobs-clear-btn",
                    disabled: clearing,
                    onClick: handleClearClick,
                  },
                  clearing ? "Đang xóa..." : `Xóa lịch sử đã xong (${stats.finishedCount})`
                )
              )
            : null
        )
      : null
  );
}
