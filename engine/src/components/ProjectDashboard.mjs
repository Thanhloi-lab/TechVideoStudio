import React from "react";
import { HeaderJobsTray } from "./HeaderJobsTray.mjs";

const h = React.createElement;

export function computeCourseStats(course) {
  const episodes = course?.episodes || [];
  const total = episodes.length || course?.meta?.total_episodes || 0;

  let completed = 0;
  let scriptReady = 0;
  let scriptedTotal = 0;
  let processing = 0;
  let needsRevision = 0;
  let planned = 0;
  let openRevisions = 0;
  let staleCount = 0;

  for (const ep of episodes) {
    const st = ep.state || {};
    const overall = st.overall_status || (ep.has_video ? "completed" : ep.has_script ? "script_ready" : "planned");
    const hasScript = Boolean(ep.has_script || st.scripting?.status === "completed");
    if (hasScript) scriptedTotal += 1;

    const epRevs = Array.isArray(st.revisions) ? st.revisions : [];
    for (const r of epRevs) {
      if (r.status === "open" || r.status === "in_progress") {
        openRevisions += 1;
      }
    }
    if (st.production?.stale) {
      staleCount += 1;
    }

    if (overall === "completed") {
      completed += 1;
    } else if (overall === "needs_revision") {
      needsRevision += 1;
    } else if (overall === "scripting" || overall === "processing") {
      processing += 1;
    } else if (overall === "script_ready") {
      scriptReady += 1;
    } else {
      planned += 1;
    }
  }

  // Fallback to backend stats/summary if episodes array wasn't populated
  if (episodes.length === 0 && (course?.stats || course?.summary)) {
    const s = course.stats || course.summary;
    const byStatus = s.by_overall_status || s.counts || s;
    completed = byStatus.completed || 0;
    scriptReady = byStatus.script_ready || 0;
    processing = (byStatus.scripting || 0) + (byStatus.processing || 0);
    needsRevision = byStatus.needs_revision || 0;
    scriptedTotal = s.scripted || completed + scriptReady;
    planned = Math.max(0, total - completed - scriptReady - processing - needsRevision);
  }

  const pctCompleted = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    scriptReady,
    scriptedTotal,
    processing,
    needsRevision,
    planned,
    openRevisions,
    staleCount,
    pctCompleted,
  };
}

export function SseStatusBadge({ sseStatus }) {
  const isLive = sseStatus === "live";
  const label = isLive ? "● Live Monitor" : "↻ Reconnecting";
  return h(
    "span",
    {
      className: `sse-badge ${isLive ? "is-live" : "is-reconnecting"}`,
      title: isLive ? "Kết nối SSE thời gian thực đang hoạt động" : "Đang kết nối lại SSE stream...",
    },
    h("span", { className: "sse-dot" }),
    isLive ? "Live Monitor" : "Reconnecting"
  );
}

export function ProjectDashboard({
  courses = [],
  sseStatus = "connecting",
  onOpenCourse,
  jobs = [],
  onCancelJob,
  onClearFinishedJobs,
  onNavigateToPlayer,
  trayHighlightSignal = 0,
}) {
  const totalCourses = courses.length;
  const totalEpisodesAll = courses.reduce((acc, c) => acc + (c.episodes?.length || c.meta?.total_episodes || 0), 0);

  return h(
    "div",
    { className: "studio-shell dashboard-shell" },
    // Top bar
    h(
      "header",
      { className: "studio-topbar" },
      h(
        "div",
        { className: "brand" },
        h("span", { className: "brand-logo" }, "▶"),
        h(
          "div",
          null,
          h("div", { className: "brand-title" }, "Tech Course Video Studio"),
          h("div", { className: "brand-sub" }, "Multi-Agent Course Pipeline & Live Monitor")
        )
      ),
      h(
        "div",
        { className: "topbar-controls" },
        h("span", { className: "topbar-pill" }, `${totalCourses} Dự án · ${totalEpisodesAll} Tập`),
        h(HeaderJobsTray, {
          jobs,
          onCancelJob,
          onClearFinishedJobs,
          onNavigateToPlayer,
          highlightSignal: trayHighlightSignal,
        }),
        h(SseStatusBadge, { sseStatus })
      )
    ),

    // Main Dashboard Content
    h(
      "main",
      { className: "dashboard-main" },
      h(
        "div",
        { className: "dashboard-hero" },
        h("h1", { className: "dashboard-heading" }, "Danh sách Dự án Khóa học"),
        h(
          "p",
          { className: "dashboard-desc" },
          "Theo dõi tiến độ song song (Scripting → TTS → Render → Verify) theo thời gian thực và mở Studio Player cho từng tập."
        )
      ),

      courses.length === 0
        ? h(
            "div",
            { className: "empty-panel" },
            "Chưa tìm thấy khóa học nào trong workspace. Hãy tạo thư mục khóa học có course.json để bắt đầu."
          )
        : h(
            "div",
            { className: "projects-grid" },
            ...courses.map((course) => {
              const meta = course.meta || {};
              const stats = computeCourseStats(course);
              const stageCount = meta.stages?.length || 0;
              const segDenominator = Math.max(1, stats.total);

              const wCompleted = (stats.completed / segDenominator) * 100;
              const wScriptReady = (stats.scriptReady / segDenominator) * 100;
              const wProcessing = (stats.processing / segDenominator) * 100;
              const wNeedsRev = (stats.needsRevision / segDenominator) * 100;

              return h(
                "article",
                {
                  key: course.id,
                  className: "project-card",
                  onClick: () => onOpenCourse && onOpenCourse(course.id),
                },
                // Top badges row
                h(
                  "div",
                  { className: "project-card-top" },
                  h(
                    "div",
                    { className: "project-badges" },
                    h("span", { className: "project-id-badge" }, course.id),
                    meta.target_exam
                      ? h("span", { className: "project-exam-badge" }, meta.target_exam)
                      : null,
                    stageCount > 0
                      ? h("span", { className: "project-meta-chip" }, `${stageCount} Chặng`)
                      : null,
                    (meta.tts_profile || meta.tts_voice)
                      ? h("span", { className: "project-voice-chip" }, `🎙️ ${meta.tts_profile || meta.tts_voice}`)
                      : null,
                    stats.openRevisions > 0
                      ? h(
                          "span",
                          { className: "project-rev-pill" },
                          `🛠️ ${stats.openRevisions} yêu cầu sửa`
                        )
                      : null,
                    stats.staleCount > 0
                      ? h(
                          "span",
                          { className: "project-stale-pill" },
                          `🔄 ${stats.staleCount} cần render lại`
                        )
                      : null
                  ),
                  h("span", { className: "project-total-pill" }, `${stats.total} Tập`)
                ),

                // Title & subtitle
                h("h2", { className: "project-card-title" }, meta.title || course.id),
                meta.subtitle
                  ? h("p", { className: "project-card-sub" }, meta.subtitle)
                  : null,

                // Segmented Progress Bar
                h(
                  "div",
                  { className: "project-progress-wrap" },
                  h(
                    "div",
                    { className: "project-progress-header" },
                    h("span", null, "Tiến độ sản xuất Video"),
                    h("strong", null, `${stats.completed}/${stats.total} (${stats.pctCompleted}%)`)
                  ),
                  h(
                    "div",
                    { className: "segmented-bar", title: "Completed / Script Ready / Processing / Needs Revision / Planned" },
                    wCompleted > 0
                      ? h("div", {
                          className: "seg-fill seg-completed",
                          style: { width: `${wCompleted}%` },
                        })
                      : null,
                    wScriptReady > 0
                      ? h("div", {
                          className: "seg-fill seg-scripted",
                          style: { width: `${wScriptReady}%` },
                        })
                      : null,
                    wProcessing > 0
                      ? h("div", {
                          className: "seg-fill seg-processing",
                          style: { width: `${wProcessing}%` },
                        })
                      : null,
                    wNeedsRev > 0
                      ? h("div", {
                          className: "seg-fill seg-revision",
                          style: { width: `${wNeedsRev}%` },
                        })
                      : null
                  )
                ),

                // Counts Grid: Scripted, Processing, Completed, Needs Revision
                h(
                  "div",
                  { className: "project-counts-grid" },
                  h(
                    "div",
                    { className: "count-chip is-scripted" },
                    h("span", { className: "count-num" }, stats.scriptedTotal),
                    h("span", { className: "count-lbl" }, "Scripted")
                  ),
                  h(
                    "div",
                    { className: "count-chip is-processing" },
                    h("span", { className: "count-num" }, stats.processing),
                    h("span", { className: "count-lbl" }, "Processing")
                  ),
                  h(
                    "div",
                    { className: "count-chip is-completed" },
                    h("span", { className: "count-num" }, stats.completed),
                    h("span", { className: "count-lbl" }, "Completed")
                  ),
                  h(
                    "div",
                    { className: "count-chip is-revision" },
                    h("span", { className: "count-num" }, stats.needsRevision),
                    h("span", { className: "count-lbl" }, "Needs Revision")
                  )
                ),

                // Footer action
                h(
                  "div",
                  { className: "project-card-footer" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "btn-open-project",
                      onClick: (e) => {
                        e.stopPropagation();
                        onOpenCourse && onOpenCourse(course.id);
                      },
                    },
                    "Mở Dự Án →"
                  )
                )
              );
            })
          )
    )
  );
}
