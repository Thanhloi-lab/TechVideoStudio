import React, { useMemo, useState } from "react";
import { renderMarkdownToHtml } from "../markdown.mjs";
import { computeCourseStats, SseStatusBadge } from "./ProjectDashboard.mjs";
import { AiScriptModal } from "./AiScriptModal.mjs";
import { HeaderJobsTray } from "./HeaderJobsTray.mjs";
import { RevisionPanel } from "./RevisionPanel.mjs";
import { VoiceStudioModal } from "./VoiceStudioModal.mjs";

const h = React.createElement;

const SCRIPTING_BADGES = {
  pending: { icon: "⏳", label: "Planned", cls: "is-pending" },
  planning: { icon: "📝", label: "Planning", cls: "is-active" },
  in_progress: { icon: "✍️", label: "Scripting", cls: "is-active" },
  reviewing: { icon: "🔍", label: "Script Reviewing", cls: "is-reviewing" },
  needs_revision: { icon: "⚠️", label: "Needs Revision", cls: "is-revision" },
  completed: { icon: "✅", label: "Script Ready", cls: "is-done" },
};

const PRODUCTION_BADGES = {
  pending: { icon: "⏸️", label: "Chờ", cls: "is-pending" },
  tts_processing: { icon: "🎙️", label: "TTS Processing", cls: "is-active" },
  rendering: { icon: "🎬", label: "Rendering", cls: "is-active" },
  reviewing: { icon: "🛡️", label: "Verifying", cls: "is-reviewing" },
  needs_revision: { icon: "⚠️", label: "Needs Revision", cls: "is-revision" },
  completed: { icon: "🎉", label: "Completed", cls: "is-done" },
};

const FILTER_OPTIONS = [
  { id: "all", label: "Tất cả" },
  { id: "running", label: "Đang chạy" },
  { id: "waiting_video", label: "Chờ Video" },
  { id: "completed", label: "Hoàn thành" },
  { id: "needs_revision", label: "Cần sửa" },
];

function getEpisodeOverallStatus(ep) {
  if (ep?.state?.overall_status) return ep.state.overall_status;
  if (ep?.has_video) return "completed";
  if (ep?.has_script) return "script_ready";
  return "planned";
}

function getScriptingBadge(ep) {
  const raw = ep?.state?.scripting?.status || (ep?.has_script ? "completed" : "pending");
  return SCRIPTING_BADGES[raw] || SCRIPTING_BADGES.pending;
}

function getProductionBadge(ep) {
  const raw = ep?.state?.production?.status || (ep?.has_video ? "completed" : "pending");
  return PRODUCTION_BADGES[raw] || PRODUCTION_BADGES.pending;
}

function matchesFilter(ep, filterId) {
  if (filterId === "all") return true;
  const overall = getEpisodeOverallStatus(ep);
  if (filterId === "running") {
    return overall === "scripting" || overall === "processing";
  }
  if (filterId === "waiting_video") {
    return overall === "script_ready";
  }
  if (filterId === "completed") {
    return overall === "completed";
  }
  if (filterId === "needs_revision") {
    return overall === "needs_revision";
  }
  return true;
}

function formatEventTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(ts);
  }
}

export function EpisodeRoadmap({
  course,
  events = [],
  sseStatus = "connecting",
  onBack,
  onOpenEpisode,
  onOpenLatestEpisode,
  onStateAction,
  onRefreshCourses,
  jobs = [],
  aiJobs = [],
  workerStatus = { online: false },
  onStartAiScript,
  renderPrefs = null,
  onCancelJob,
  onClearFinishedJobs,
  onNavigateToPlayer,
  trayHighlightSignal = 0,
}) {
  const [filterId, setFilterId] = useState("all");
  const [rightTab, setRightTab] = useState("feed"); // "feed" | "revisions" | "curriculum"
  const [curriculumCollapsed, setCurriculumCollapsed] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [aiModal, setAiModal] = useState({ open: false, mode: "single", episode: null });
  const [workerGuideOpen, setWorkerGuideOpen] = useState(false);
  const [copiedWorkerCmd, setCopiedWorkerCmd] = useState(false);
  const [actionToast, setActionToast] = useState(null);

  const workerOnline = Boolean(workerStatus?.online);
  const primaryWorker = workerStatus?.primary_worker || null;
  const activeAiJobByEpId = useMemo(() => {
    const map = new Map();
    for (const job of aiJobs || []) {
      if (!job || job.course !== course?.id) continue;
      if (job.status !== "queued" && job.status !== "running") continue;
      for (const epId of job.episode_ids || []) {
        if (!map.has(epId)) map.set(epId, job);
      }
    }
    return map;
  }, [aiJobs, course?.id]);

  const handleCopyWorkerCommand = async () => {
    try {
      await navigator.clipboard.writeText("Bật VideoMaker Worker");
      setCopiedWorkerCmd(true);
      setTimeout(() => setCopiedWorkerCmd(false), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  const meta = course?.meta || {};
  const episodes = course?.episodes || [];
  const stats = useMemo(() => computeCourseStats(course), [course]);
  const courseVoiceLabel = meta.tts_profile || meta.tts_voice || "edge-hoaimy";

  const openRevisionsCount = useMemo(() => {
    let n = 0;
    for (const ep of episodes) {
      for (const r of ep.state?.revisions || []) {
        if (r.status === "open" || r.status === "in_progress") n += 1;
      }
    }
    return n;
  }, [episodes]);

  // Build lookup map of episodes by id
  const episodeById = useMemo(() => {
    const map = new Map();
    for (const ep of episodes) {
      map.set(ep.id, ep);
    }
    return map;
  }, [episodes]);

  // Group episodes by Stage from course.meta.stages (falling back to ep.stage)
  const stageGroups = useMemo(() => {
    const metaStages = meta.stages || [];
    if (metaStages.length > 0) {
      return metaStages.map((st) => {
        const stageEps = (st.episodes || []).map((stub) => {
          const full = episodeById.get(stub.id);
          return (
            full || {
              id: stub.id,
              number: stub.number,
              stage: st.stage,
              title: stub.title,
              duration_target: stub.duration_target || "",
              has_script: false,
              has_notes: false,
              has_audio: false,
              has_video: false,
              state: null,
            }
          );
        });
        return {
          stage: st.stage,
          title: st.title || `Chặng ${st.stage}`,
          episodes: stageEps,
        };
      });
    }

    const byStage = new Map();
    for (const ep of episodes) {
      const sNum = ep.stage || 1;
      if (!byStage.has(sNum)) {
        byStage.set(sNum, { stage: sNum, title: `Chặng ${sNum}`, episodes: [] });
      }
      byStage.get(sNum).episodes.push(ep);
    }
    return Array.from(byStage.values()).sort((a, b) => a.stage - b.stage);
  }, [meta.stages, episodes, episodeById]);

  const playableEpisodes = useMemo(
    () => episodes.filter((ep) => Boolean(ep.has_script)),
    [episodes]
  );

  const showToast = (ok, msg) => {
    setActionToast({ ok, msg });
    setTimeout(() => setActionToast(null), 3500);
  };

  const visibleStageGroups = stageGroups
    .map((grp) => ({
      ...grp,
      filteredEpisodes: grp.episodes.filter((ep) => matchesFilter(ep, filterId)),
    }))
    .filter((grp) => filterId === "all" || grp.filteredEpisodes.length > 0);

  return h(
    "div",
    { className: "studio-shell roadmap-shell" },
    // Top bar
    h(
      "header",
      { className: "studio-topbar roadmap-topbar" },
      h(
        "div",
        { className: "roadmap-topbar-left" },
        h(
          "button",
          {
            type: "button",
            className: "btn-back",
            onClick: onBack,
          },
          "← Tất cả Dự án"
        ),
        h(
          "div",
          { className: "roadmap-title-block" },
          h(
            "div",
            { className: "roadmap-title-row" },
            h("span", { className: "project-id-badge" }, course.id),
            meta.target_exam
              ? h("span", { className: "project-exam-badge" }, meta.target_exam)
              : null,
            h("h1", { className: "roadmap-course-title" }, meta.title || course.id)
          ),
          meta.subtitle
            ? h("div", { className: "brand-sub" }, meta.subtitle)
            : null
        )
      ),
      h(
        "div",
        { className: "topbar-controls" },
        h(
          "span",
          {
            className: "course-voice-badge",
            title: `Giọng đọc mặc định của khóa học: ${courseVoiceLabel}`,
          },
          `🎙️ ${courseVoiceLabel}`
        ),
        h(
          "button",
          {
            type: "button",
            className: "btn-voice-studio",
            onClick: () => setVoiceModalOpen(true),
          },
          "🎙️ Giọng đọc Khóa học"
        ),
        h(HeaderJobsTray, {
          jobs,
          onCancelJob,
          onClearFinishedJobs,
          onNavigateToPlayer,
          highlightSignal: trayHighlightSignal,
        }),
        h(
          "button",
          {
            type: "button",
            className: `worker-status-pill ${workerOnline ? "is-online" : "is-offline"}`,
            onClick: () => setWorkerGuideOpen((v) => !v),
            title: workerOnline
              ? `Antigravity Worker Online · ${primaryWorker?.model || "Gemini 4 Argon"} · Heartbeat: ${primaryWorker?.last_heartbeat_iso || ""}`
              : "Antigravity Worker Offline — Bấm để xem hướng dẫn bật Worker",
          },
          h("span", { className: `worker-dot ${workerOnline ? "is-online" : "is-offline"}` }),
          workerOnline
            ? `Worker: ${
                String(primaryWorker?.model || "Argon").toLowerCase().includes("hydrogen")
                  ? "Hydrogen"
                  : "Argon"
              } (Online)`
            : "Worker: Offline"
        ),
        h(SseStatusBadge, { sseStatus }),
        h(
          "button",
          {
            type: "button",
            className: "btn-export",
            disabled: playableEpisodes.length === 0,
            onClick: () => onOpenLatestEpisode && onOpenLatestEpisode(),
          },
          "Mở Studio Xem Tập Gần Nhất"
        )
      )
    ),

    // KPI Strip + Filter Pills Bar
    h(
      "section",
      { className: "roadmap-toolbar" },
      h(
        "div",
        { className: "kpi-strip" },
        h(
          "div",
          { className: "kpi-card" },
          h("span", { className: "kpi-val" }, stats.total),
          h("span", { className: "kpi-lbl" }, "Tổng số tập")
        ),
        h(
          "div",
          { className: "kpi-card is-scripted" },
          h("span", { className: "kpi-val" }, stats.scriptedTotal),
          h("span", { className: "kpi-lbl" }, "Đã có Script")
        ),
        h(
          "div",
          { className: "kpi-card is-waiting" },
          h("span", { className: "kpi-val" }, stats.scriptReady),
          h("span", { className: "kpi-lbl" }, "Chờ Video")
        ),
        h(
          "div",
          { className: "kpi-card is-running" },
          h("span", { className: "kpi-val" }, stats.processing),
          h("span", { className: "kpi-lbl" }, "Đang chạy")
        ),
        h(
          "div",
          { className: "kpi-card is-completed" },
          h("span", { className: "kpi-val" }, stats.completed),
          h("span", { className: "kpi-lbl" }, "Hoàn thành")
        ),
        h(
          "div",
          { className: "kpi-card is-revision" },
          h("span", { className: "kpi-val" }, stats.needsRevision),
          h("span", { className: "kpi-lbl" }, "Cần sửa")
        )
      ),

      h(
        "div",
        { className: "filter-pills-row" },
        ...FILTER_OPTIONS.map((opt) =>
          h(
            "button",
            {
              key: opt.id,
              type: "button",
              className: `filter-pill ${filterId === opt.id ? "is-active" : ""}`,
              onClick: () => setFilterId(opt.id),
            },
            opt.label
          )
        ),
        h(
          "button",
          {
            type: "button",
            className: `btn-ai-batch ${!workerOnline ? "is-disabled-offline" : ""}`,
            disabled: !workerOnline,
            title: workerOnline
              ? "Biên kịch tự động một đợt 3–5 tập qua Antigravity Worker (Argon)"
              : "Cần bật VideoMaker Worker trong Antigravity IDE trước khi biên kịch",
            onClick: () => setAiModal({ open: true, mode: "batch", episode: null }),
          },
          "✍️ Biên kịch Đợt (3–5 tập)"
        )
      )
    ),

    (!workerOnline || workerGuideOpen)
      ? h(
          "div",
          { className: `worker-offline-banner ${workerOnline ? "is-guide-online" : ""}` },
          h(
            "div",
            { className: "worker-offline-msg" },
            workerOnline
              ? h(
                  "span",
                  null,
                  `🟢 Worker đang trực (${primaryWorker?.model || "Gemini 4 Argon"} · ID: `,
                  h("code", null, primaryWorker?.worker_id || "argon-worker"),
                  `). Sẵn sàng nhận lệnh biên kịch tức thì từ giao diện.`
                )
              : h(
                  "span",
                  null,
                  h("strong", null, "🔴 Worker Offline: "),
                  "Để kích hoạt nút Biên kịch trên UI, hãy mở Antigravity IDE (chat Gemini 4 Argon) và chạy lệnh:"
                )
          ),
          h(
            "div",
            { className: "worker-offline-actions" },
            h("code", { className: "worker-cmd-chip" }, "Bật VideoMaker Worker"),
            h(
              "button",
              {
                type: "button",
                className: "btn-secondary btn-xs",
                onClick: handleCopyWorkerCommand,
              },
              copiedWorkerCmd ? "✅ Đã copy" : "📋 Copy"
            ),
            workerOnline
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "btn-secondary btn-xs",
                    onClick: () => setWorkerGuideOpen(false),
                  },
                  "Ẩn"
                )
              : null
          )
        )
      : null,

    actionToast
      ? h(
          "div",
          { className: `roadmap-toast ${actionToast.ok ? "is-ok" : "is-err"}` },
          actionToast.msg
        )
      : null,

    // 2-Column Body: Left Stages & Episodes | Right Live Activity Feed + Collapsible curriculum.md
    h(
      "main",
      { className: "roadmap-body" },
      // Left Column: Stages
      h(
        "section",
        { className: "roadmap-stages-col" },
        visibleStageGroups.length === 0
          ? h(
              "div",
              { className: "empty-panel" },
              "Không có tập nào phù hợp với bộ lọc hiện tại."
            )
          : visibleStageGroups.map((grp) => {
              const doneInStage = grp.episodes.filter(
                (ep) => getEpisodeOverallStatus(ep) === "completed"
              ).length;

              return h(
                "div",
                { key: grp.stage, className: "stage-group-card" },
                h(
                  "div",
                  { className: "stage-group-header" },
                  h(
                    "div",
                    { className: "stage-group-title-wrap" },
                    h("span", { className: "stage-num-pill" }, `Chặng ${grp.stage}`),
                    h("h2", { className: "stage-group-title" }, grp.title)
                  ),
                  h(
                    "span",
                    { className: "stage-group-progress" },
                    `${doneInStage}/${grp.episodes.length} hoàn thành`
                  )
                ),

                h(
                  "div",
                  { className: "episodes-grid" },
                  ...grp.filteredEpisodes.map((ep) => {
                    const overall = getEpisodeOverallStatus(ep);
                    const scBadge = getScriptingBadge(ep);
                    const prBadge = getProductionBadge(ep);
                    const isLive = overall === "scripting" || overall === "processing";
                    const canPlay = Boolean(ep.has_script);
                    const epRevisions = ep.state?.revisions || [];
                    const openEpRevs = epRevisions.filter(
                      (r) => r.status === "open" || r.status === "in_progress"
                    );
                    const hasOpenRevs = openEpRevs.length > 0;
                    const latestOpenRev = openEpRevs[0] || null;
                    const isStale = Boolean(ep.state?.production?.stale);
                    const epVoiceOverride =
                      ep.state?.voice_override?.tts_profile ||
                      (ep.tts_profile && ep.tts_profile !== meta.tts_profile ? ep.tts_profile : "");
                    const activeOwner =
                      overall === "scripting"
                        ? ep.state?.scripting?.owner
                        : overall === "processing"
                          ? ep.state?.production?.owner
                          : null;
                    const activePhase =
                      overall === "scripting"
                        ? ep.state?.scripting?.phase
                        : overall === "processing"
                          ? ep.state?.production?.phase
                          : null;

                    return h(
                      "div",
                      {
                        key: ep.id,
                        className: [
                          "episode-card",
                          `status-${overall}`,
                          isLive ? "is-live" : "",
                          canPlay ? "is-clickable" : "is-locked",
                        ]
                          .filter(Boolean)
                          .join(" "),
                        onClick: () => {
                          if (canPlay && onOpenEpisode) {
                            onOpenEpisode(ep.id);
                          }
                        },
                        title: canPlay
                          ? "Bấm để mở trong Studio Player"
                          : "Chưa có script.json — chưa thể xem preview",
                      },
                      // Card Header: Number + Duration + Live Owner Badge
                      h(
                        "div",
                        { className: "episode-card-top" },
                        h(
                          "div",
                          { className: "ep-num-group" },
                          h(
                            "span",
                            { className: "ep-num-badge" },
                            `Tập ${String(ep.number || 0).padStart(2, "0")}`
                          ),
                          ep.duration_target
                            ? h("span", { className: "ep-dur-tag" }, ep.duration_target)
                            : null,
                          ep.has_script && !ep.has_audio
                            ? h("span", { className: "ep-storyboard-tag" }, "Storyboard")
                            : null,
                          ep.has_video
                            ? h("span", { className: "ep-video-tag" }, "Video Ready")
                            : null,
                          isStale
                            ? h("span", { className: "ep-stale-tag" }, "🔄 Cần render lại")
                            : null,
                          epVoiceOverride
                            ? h("span", { className: "ep-voice-tag" }, `🎙️ ${epVoiceOverride}`)
                            : null
                        ),
                        isLive
                          ? h(
                              "span",
                              { className: "live-owner-badge" },
                              h("span", { className: "live-pulse-dot" }),
                              activeOwner || (overall === "scripting" ? "scripting" : "processing")
                            )
                          : null
                      ),

                      // Episode Title
                      h("div", { className: "episode-card-title" }, ep.title || ep.id),
                      activePhase
                        ? h("div", { className: "episode-phase-note" }, `Phase: ${activePhase}`)
                        : null,
                      latestOpenRev
                        ? h(
                            "div",
                            { className: "episode-revision-note" },
                            h(
                              "strong",
                              null,
                              `[${latestOpenRev.id}${latestOpenRev.scene_id ? ` · ${latestOpenRev.scene_id}` : ""}] `
                            ),
                            latestOpenRev.description
                          )
                        : overall === "needs_revision" && (ep.state?.last_error || ep.state?.scripting?.notes || ep.state?.production?.notes)
                          ? h(
                              "div",
                              { className: "episode-revision-note" },
                              ep.state?.last_error || ep.state?.scripting?.notes || ep.state?.production?.notes
                            )
                          : null,

                      // Dual-Pipeline Status Row
                      h(
                        "div",
                        { className: "dual-pipeline-row" },
                        h(
                          "span",
                          { className: `pipeline-pill ${scBadge.cls}`, title: "Scripting Pipeline" },
                          `${scBadge.icon} ${scBadge.label}`
                        ),
                        h(
                          "span",
                          { className: `pipeline-pill ${prBadge.cls}`, title: "Video Production Pipeline" },
                          `${prBadge.icon} ${prBadge.label}`
                        )
                      ),

                      // Card Actions Row
                      (canPlay || hasOpenRevs || activeAiJobByEpId.has(ep.id) || overall !== "completed")
                        ? h(
                            "div",
                            { className: "episode-card-actions" },
                            canPlay
                              ? h(
                                  "button",
                                  {
                                    type: "button",
                                    className: "ep-btn-play",
                                    onClick: (e) => {
                                      e.stopPropagation();
                                      onOpenEpisode && onOpenEpisode(ep.id);
                                    },
                                  },
                                  ep.has_audio ? "▶ Mở Studio" : "🎬 Preview Storyboard"
                                )
                              : null,
                            (() => {
                              const activeAi = activeAiJobByEpId.get(ep.id);
                              if (activeAi) {
                                const isCur = activeAi.current_episode === ep.id && activeAi.status === "running";
                                return h(
                                  "div",
                                  {
                                    className: "ep-ai-live-group",
                                    onClick: (e) => e.stopPropagation(),
                                  },
                                  h(
                                    "span",
                                    { className: "ep-ai-progress-pill" },
                                    activeAi.status === "queued"
                                      ? "🤖 Chờ Worker"
                                      : isCur
                                        ? `✍️ ${activeAi.step || "Scripting"} (${activeAi.progress || 0}%)`
                                        : `🤖 Trong đợt (${activeAi.progress || 0}%)`
                                  ),
                                  h(
                                    "button",
                                    {
                                      type: "button",
                                      className: "ep-ai-cancel-btn",
                                      onClick: (e) => {
                                        e.stopPropagation();
                                        onCancelJob && onCancelJob(activeAi.id);
                                      },
                                      title: "Hủy tác vụ AI này",
                                    },
                                    "✕ Hủy"
                                  )
                                );
                              }
                              if (overall === "completed") return null;
                              return h(
                                "button",
                                {
                                  type: "button",
                                  className: `ep-btn-ai ${ep.has_script ? "is-rewrite" : ""} ${
                                    !workerOnline ? "is-disabled-offline" : ""
                                  }`,
                                  disabled: !workerOnline,
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    setAiModal({ open: true, mode: "single", episode: ep });
                                  },
                                  title: workerOnline
                                    ? ep.has_script
                                      ? "Yêu cầu AI viết lại/cập nhật kịch bản"
                                      : "Giao Antigravity AI (Argon) biên kịch tập này"
                                    : "Worker Offline — hãy bật VideoMaker Worker trong Antigravity IDE trước",
                                },
                                ep.has_script ? "🔄 Viết lại KB" : "✍️ Biên kịch"
                              );
                            })(),
                            hasOpenRevs
                              ? canPlay
                                ? h(
                                    "button",
                                    {
                                      type: "button",
                                      className: "ep-btn-revision ep-tag-revision",
                                      onClick: (e) => {
                                        e.stopPropagation();
                                        onOpenEpisode &&
                                          onOpenEpisode(ep.id, latestOpenRev?.scene_id || "", "revisions");
                                      },
                                      title: "Xem chi tiết các yêu cầu sửa đang mở của tập này",
                                    },
                                    `⚠️ Yêu cầu sửa (${openEpRevs.length})`
                                  )
                                : h(
                                    "span",
                                    {
                                      className: "ep-btn-revision ep-tag-revision is-readonly",
                                      title: "Tập này đang có yêu cầu sửa",
                                    },
                                    `⚠️ Yêu cầu sửa (${openEpRevs.length})`
                                  )
                              : null
                          )
                        : null
                    );
                  })
                )
              );
            })
      ),

      // Right Column: Live Activity Feed + Revision Queue + Collapsible curriculum.md tab
      h(
        "aside",
        { className: "roadmap-side-col" },
        h(
          "div",
          { className: "side-panel-card" },
          h(
            "div",
            { className: "side-panel-tabs" },
            h(
              "button",
              {
                type: "button",
                className: `drawer-tab ${rightTab === "feed" ? "is-active" : ""}`,
                onClick: () => setRightTab("feed"),
              },
              `📡 Live (${events.length})`
            ),
            h(
              "button",
              {
                type: "button",
                className: `drawer-tab ${rightTab === "revisions" ? "is-active" : ""}`,
                onClick: () => setRightTab("revisions"),
              },
              `🛠️ Yêu cầu sửa (${openRevisionsCount})`
            ),
            h(
              "button",
              {
                type: "button",
                className: `drawer-tab ${rightTab === "curriculum" ? "is-active" : ""}`,
                onClick: () => {
                  setRightTab("curriculum");
                  setCurriculumCollapsed(false);
                },
              },
              "🗺️ curriculum.md"
            ),
            rightTab === "curriculum"
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "collapse-btn",
                    onClick: () => setCurriculumCollapsed((v) => !v),
                    title: curriculumCollapsed ? "Mở rộng curriculum.md" : "Thu gọn curriculum.md",
                  },
                  curriculumCollapsed ? "▼" : "▲"
                )
              : null
          ),

          h(
            "div",
            { className: "side-panel-content" },
            rightTab === "feed"
              ? h(
                  "div",
                  { className: "activity-feed-list" },
                  events.length === 0
                    ? h(
                        "div",
                        { className: "empty-feed" },
                        "Chưa có sự kiện nào được ghi nhận trong events.jsonl."
                      )
                    : events.map((ev, idx) =>
                        h(
                          "div",
                          { key: ev.id || `${ev.ts || ev.timestamp || ""}-${idx}`, className: "activity-item" },
                          h(
                            "div",
                            { className: "activity-item-top" },
                            h("span", { className: "activity-ep" }, ev.episode_id || ev.episode || course.id),
                            h("span", { className: "activity-time" }, formatEventTime(ev.ts || ev.timestamp))
                          ),
                          h(
                            "div",
                            { className: "activity-item-body" },
                            ev.type ? h("span", { className: "activity-stage-tag" }, ev.type) : null,
                            ev.stage ? h("span", { className: "activity-stage-tag" }, ev.stage) : null,
                            ev.status || ev.action || ev.overall_status
                              ? h(
                                  "span",
                                  { className: "activity-status-tag" },
                                  ev.status || ev.action || ev.overall_status
                                )
                              : null,
                            ev.owner ? h("span", { className: "activity-owner" }, `@${ev.owner}`) : null
                          ),
                          ev.note || ev.message
                            ? h("div", { className: "activity-note" }, ev.note || ev.message)
                            : null
                        )
                      )
                )
              : rightTab === "revisions"
                ? h(RevisionPanel, {
                    mode: "course",
                    courseId: course.id,
                    episodes,
                    onJumpToTicket: (epId, sceneId) =>
                      onOpenEpisode && onOpenEpisode(epId, sceneId, "revisions"),
                    onStateAction,
                  })
                : curriculumCollapsed
                  ? h(
                      "div",
                      { className: "empty-feed" },
                      "curriculum.md đang thu gọn. Bấm ▼ ở trên để mở xem."
                    )
                  : h("div", {
                      className: "md-body",
                      dangerouslySetInnerHTML: {
                        __html: renderMarkdownToHtml(course?.curriculum || ""),
                      },
                    })
          )
        )
      )
    ),

    // Voice Studio Modal (Course Default Voice)
    h(VoiceStudioModal, {
      isOpen: voiceModalOpen,
      mode: "course",
      course,
      onClose: () => setVoiceModalOpen(false),
      onAssigned: async (_data, info) => {
        if (onRefreshCourses) await onRefreshCourses();
        showToast(
          true,
          `Đã đặt giọng "${info?.profile?.label || info?.profile?.id || ""}" cho khóa ${course.id}.`
        );
      },
    }),

    // AI Scripting Modal (Single Episode or 3-5 Batch)
    h(AiScriptModal, {
      isOpen: aiModal.open,
      mode: aiModal.mode,
      course,
      targetEpisode: aiModal.episode,
      workerStatus,
      renderPrefs,
      onClose: () => setAiModal({ open: false, mode: "single", episode: null }),
      onSubmitJob: async (payload) => {
        if (onStartAiScript) {
          await onStartAiScript(payload);
        }
      },
    })
  );
}
