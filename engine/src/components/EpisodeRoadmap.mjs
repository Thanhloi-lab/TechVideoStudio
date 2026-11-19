import React, { useEffect, useMemo, useState } from "react";
import { renderMarkdownToHtml } from "../markdown.mjs";
import { computeCourseStats, SseStatusBadge } from "./ProjectDashboard.mjs";
import { AiScriptModal } from "./AiScriptModal.mjs";
import { BrandHealthGrid, isProviderReady } from "./ai/BrandHealthGrid.mjs";
import { FloatingBatchBar } from "./ai/FloatingBatchBar.mjs";
import { HeaderJobsTray } from "./HeaderJobsTray.mjs";
import { RevisionPanel } from "./RevisionPanel.mjs";
import { ScriptingStageModal } from "./ScriptingStageModal.mjs";
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
  providersData = null,
  onProvidersLoaded = null,
  onStartAiScript,
  onResumeAiJob,
  pendingResumeJob = null,
  onClearPendingResume = null,
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
  const [scriptingStageEp, setScriptingStageEp] = useState(null);
  const [aiModal, setAiModal] = useState({
    open: false,
    mode: "single",
    episode: null,
    initialSelectedIds: null,
    initialMode: null,
    initialPauseAfter: null,
    startFrom: null,
    resumeJob: null,
  });
  const [providerPanelOpen, setProviderPanelOpen] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedEpIds, setSelectedEpIds] = useState([]);
  const [actionToast, setActionToast] = useState(null);

  const workerOnline = Boolean(workerStatus?.online);
  const primaryWorker = workerStatus?.primary_worker || null;
  const providersList = useMemo(() => {
    const arr = providersData?.providers || providersData?.brands || [];
    return Array.isArray(arr) ? arr : [];
  }, [providersData]);
  const readyBrandsCount = useMemo(
    () => providersList.filter(isProviderReady).length,
    [providersList]
  );

  useEffect(() => {
    setSelectedEpIds([]);
    setMultiSelectMode(false);
  }, [course?.id]);

  useEffect(() => {
    if (!pendingResumeJob) return;
    setAiModal({
      open: true,
      mode: "resume",
      episode: null,
      initialSelectedIds: null,
      resumeJob: pendingResumeJob,
    });
    onClearPendingResume && onClearPendingResume();
  }, [pendingResumeJob, onClearPendingResume]);

  const pausedCourseJobs = useMemo(
    () => (aiJobs || []).filter((j) => j && j.course === course?.id && j.status === "paused"),
    [aiJobs, course?.id]
  );

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

  const toggleSelectEp = (epId) => {
    setSelectedEpIds((prev) =>
      prev.includes(epId) ? prev.filter((id) => id !== epId) : [...prev, epId]
    );
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
          onResumeAiJob: (job) =>
            setAiModal({
              open: true,
              mode: "resume",
              episode: null,
              initialSelectedIds: null,
              resumeJob: job,
            }),
          highlightSignal: trayHighlightSignal,
        }),
        h(
          "button",
          {
            type: "button",
            className: `worker-status-pill ${
              workerOnline || readyBrandsCount > 0 ? "is-online" : "is-standby"
            } ${providerPanelOpen ? "is-open" : ""}`,
            onClick: () => setProviderPanelOpen((v) => !v),
            title: workerOnline
              ? `Antigravity Worker Online (${primaryWorker?.model || "Worker"}) · ${readyBrandsCount} AI Providers sẵn sàng`
              : `${readyBrandsCount} AI Providers sẵn sàng — Bấm để cấu hình API Key / Local AI / Worker`,
          },
          h("span", {
            className: `worker-dot ${workerOnline || readyBrandsCount > 0 ? "is-online" : "is-standby"}`,
          }),
          workerOnline
            ? `🤖 AI Worker & Models · Online (${readyBrandsCount})`
            : `🤖 AI Worker & Models (${readyBrandsCount} sẵn sàng)`
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
          "div",
          { className: "toolbar-batch-actions" },
          h(
            "button",
            {
              type: "button",
              className: `btn-select-multi ${multiSelectMode ? "is-active" : ""}`,
              onClick: () => setMultiSelectMode((v) => !v),
              title: "Bật/tắt chế độ chọn nhiều tập để biên kịch hàng loạt",
            },
            multiSelectMode && selectedEpIds.length > 0
              ? `☑️ Chọn nhiều (${selectedEpIds.length})`
              : "☑️ Chọn nhiều"
          ),
          h(
            "button",
            {
              type: "button",
              className: "btn-ai-batch",
              title: "Biên kịch hàng loạt bằng 1 Brand & Model AI đã chọn (không giới hạn số tập)",
              onClick: () =>
                setAiModal({
                  open: true,
                  mode: "batch",
                  episode: null,
                  initialSelectedIds: selectedEpIds.length > 0 ? selectedEpIds : null,
                  resumeJob: null,
                }),
            },
            "✍️ Biên kịch Đợt / Hàng loạt"
          )
        )
      )
    ),

    providerPanelOpen
      ? h(
          "div",
          { className: "provider-drawer-panel" },
          h(
            "div",
            { className: "provider-drawer-head" },
            h(
              "span",
              { className: "provider-drawer-title" },
              "🔌 Quản lý AI Providers, API Keys & Local Models (BYOK / Antigravity / Web $0)"
            ),
            h(
              "button",
              {
                type: "button",
                className: "btn-secondary btn-xs",
                onClick: () => setProviderPanelOpen(false),
              },
              "Ẩn"
            )
          ),
          h(BrandHealthGrid, {
            providersData,
            onProvidersLoaded,
            compact: true,
          })
        )
      : null,

    ...pausedCourseJobs.map((pJob) => {
      const doneCount = Array.isArray(pJob.completed_episodes) ? pJob.completed_episodes.length : 0;
      const totalCount = Array.isArray(pJob.episode_ids) ? pJob.episode_ids.length : 1;
      const reasonText =
        pJob.pause_reason === "quota_exhausted"
          ? "Hết Quota / Rate Limit"
          : pJob.pause_reason === "server_interrupted"
            ? "Server khởi động lại giữa chừng"
            : pJob.pause_reason || "Tạm dừng giữa chừng";
      return h(
        "div",
        { key: pJob.id, className: "paused-resume-banner" },
        h(
          "div",
          { className: "paused-resume-info" },
          h(
            "div",
            { className: "paused-resume-title" },
            `⏸️ Đợt biên kịch ${pJob.id} đang tạm dừng (${doneCount}/${totalCount} tập đã xong) — Lý do: ${reasonText}`
          ),
          h(
            "div",
            { className: "paused-resume-sub" },
            `${pJob.provider_id || "AI"} · ${pJob.model || pJob.claimed_model || ""}${
              pJob.error ? ` · ${pJob.error}` : ""
            }`
          )
        ),
        h(
          "button",
          {
            type: "button",
            className: "btn-export paused-resume-btn",
            onClick: () =>
              setAiModal({
                open: true,
                mode: "resume",
                episode: null,
                initialSelectedIds: null,
                resumeJob: pJob,
              }),
          },
          "▶ Tiếp tục (Resume / Đổi Model)"
        )
      );
    }),

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

                    const isEpSelected = selectedEpIds.includes(ep.id);
                    const isCompletedEp = overall === "completed";
                    const isScriptedEp = Boolean(ep.has_script || isCompletedEp);

                    return h(
                      "div",
                      {
                        key: ep.id,
                        className: [
                          "episode-card",
                          `status-${overall}`,
                          isLive ? "is-live" : "",
                          canPlay ? "is-clickable" : "is-locked",
                          isEpSelected ? "is-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" "),
                        onClick: () => {
                          if (multiSelectMode) {
                            toggleSelectEp(ep.id);
                            return;
                          }
                          if (canPlay && onOpenEpisode) {
                            onOpenEpisode(ep.id);
                          }
                        },
                        title: multiSelectMode
                          ? "Bấm để chọn / bỏ chọn tập này"
                          : canPlay
                            ? "Bấm để mở trong Studio Player"
                            : "Chưa có script.json — chưa thể xem preview",
                      },
                      // Card Header: Checkbox + Number + Duration + Live Owner Badge
                      h(
                        "div",
                        { className: "episode-card-top" },
                        h(
                          "div",
                          { className: "ep-num-group" },
                          h("input", {
                            type: "checkbox",
                            className: `ep-select-checkbox ${multiSelectMode || isEpSelected ? "is-visible" : ""}`,
                            checked: isEpSelected,
                            "aria-label": `Chọn ${ep.title || ep.id}`,
                            onClick: (e) => e.stopPropagation(),
                            onChange: () => toggleSelectEp(ep.id),
                          }),
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
                          ep.scripting_phase === "brief_ready"
                            ? h("span", { className: "ep-stage-phase-tag" }, "📝 Brief chờ duyệt")
                            : ep.scripting_phase === "dialogue_ready"
                              ? h("span", { className: "ep-stage-phase-tag" }, "🗣️ Thoại chờ duyệt")
                              : ep.scripting_phase === "audio_spine_ready"
                                ? h("span", { className: "ep-stage-phase-tag" }, "🔒 Audio-Spine")
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

                      // Episode Title (fixed 2-line clamp + non-clipped hover tooltip)
                      h(
                        "div",
                        {
                          className: "episode-title-wrap",
                          title: ep.title || ep.id,
                        },
                        h("div", { className: "episode-card-title" }, ep.title || ep.id),
                        h(
                          "span",
                          { className: "ep-title-tooltip", role: "tooltip" },
                          ep.title || ep.id
                        )
                      ),
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

                      // Fixed-bottom card footer (Dual-Pipeline Status Row + Card Actions)
                      h(
                        "div",
                        { className: "episode-card-footer" },
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

                        h(
                          "div",
                          { className: "episode-card-actions" },
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
                                    ? "🤖 Đang chờ"
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
                            if (isScriptedEp) return null;
                            return h(
                              "button",
                              {
                                type: "button",
                                className: "ep-btn-ai",
                                onClick: (e) => {
                                  e.stopPropagation();
                                  setAiModal({
                                    open: true,
                                    mode: "single",
                                    episode: ep,
                                    initialSelectedIds: null,
                                    resumeJob: null,
                                  });
                                },
                                title: "Biên kịch tập này bằng AI (Antigravity / Cloud API / Local / Web)",
                              },
                              "✍️ Biên kịch"
                            );
                          })(),
                          (ep.has_brief ||
                            ep.has_dialogue ||
                            ep.scripting_phase === "brief_ready" ||
                            ep.scripting_phase === "dialogue_ready" ||
                            ep.scripting_phase === "audio_spine_ready")
                            ? h(
                                "button",
                                {
                                  type: "button",
                                  className: "ep-btn-stage-review",
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    setScriptingStageEp(ep);
                                  },
                                  title: "Xem & duyệt Brief / Lời thoại (Dual-Text) / Audio-Spine",
                                },
                                "📝 Duyệt Brief / Thoại"
                              )
                            : null,
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
                      )
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

    // Floating Multi-Select Batch Action Bar
    h(FloatingBatchBar, {
      selectedEpisodes: episodes.filter((ep) => selectedEpIds.includes(ep.id)),
      onClear: () => setSelectedEpIds([]),
      onOpenBatchModal: () =>
        setAiModal({
          open: true,
          mode: "batch",
          episode: null,
          initialSelectedIds: selectedEpIds,
          resumeJob: null,
        }),
    }),

    // Scripting 3-Stage Review Modal (Brief / Dialogue / Audio-Spine)
    h(ScriptingStageModal, {
      isOpen: Boolean(scriptingStageEp),
      course,
      episode: scriptingStageEp,
      onClose: () => setScriptingStageEp(null),
      onSaved: async () => {
        if (onRefreshCourses) await onRefreshCourses();
      },
      onContinueToStage: ({ episode: targetEp, startFrom, initialMode, initialPauseAfter }) => {
        setAiModal({
          open: true,
          mode: "single",
          episode: targetEp,
          initialSelectedIds: null,
          initialMode: initialMode || "three_stage",
          initialPauseAfter: initialPauseAfter || (startFrom === "visual" ? "none" : "dialogue"),
          startFrom: startFrom || null,
          resumeJob: null,
        });
      },
    }),

    // AI Scripting Modal (Single Episode, Unlimited Batch, Resume, or Manual Web)
    h(AiScriptModal, {
      isOpen: aiModal.open,
      mode: aiModal.mode,
      course,
      targetEpisode: aiModal.episode,
      initialSelectedIds: aiModal.initialSelectedIds,
      initialMode: aiModal.initialMode,
      initialPauseAfter: aiModal.initialPauseAfter,
      startFrom: aiModal.startFrom,
      resumeJob: aiModal.resumeJob,
      providersData,
      onProvidersLoaded,
      renderPrefs,
      onClose: () =>
        setAiModal({
          open: false,
          mode: "single",
          episode: null,
          initialSelectedIds: null,
          initialMode: null,
          initialPauseAfter: null,
          startFrom: null,
          resumeJob: null,
        }),
      onSubmitJob: async (payload) => {
        if (onStartAiScript) {
          await onStartAiScript(payload);
        }
        setSelectedEpIds([]);
      },
      onResumeJob: async (payload) => {
        if (onResumeAiJob) {
          await onResumeAiJob(payload);
        }
      },
      onManualCompleted: async (_data, epId) => {
        if (onRefreshCourses) await onRefreshCourses();
        showToast(true, `✅ Đã lưu kịch bản thủ công cho ${epId}.`);
      },
    })
  );
}
