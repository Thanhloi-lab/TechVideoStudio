import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram.mjs";
import { CleanConsoleMockup } from "./components/CleanConsoleMockup.mjs";
import { ComparisonMatrix } from "./components/ComparisonMatrix.mjs";
import { TerminalAndCode } from "./components/TerminalAndCode.mjs";
import { TimelineFlow } from "./components/TimelineFlow.mjs";
import { ExamTipCard } from "./components/ExamTipCard.mjs";
import { KpiMetricsCard } from "./components/KpiMetricsCard.mjs";
import { ProjectDashboard, SseStatusBadge } from "./components/ProjectDashboard.mjs";
import { EpisodeRoadmap } from "./components/EpisodeRoadmap.mjs";
import { HeaderJobsTray } from "./components/HeaderJobsTray.mjs";
import { AiScriptModal } from "./components/AiScriptModal.mjs";
import { RevisionPanel } from "./components/RevisionPanel.mjs";
import { ScriptingStageModal } from "./components/ScriptingStageModal.mjs";
import { VoiceStudioModal } from "./components/VoiceStudioModal.mjs";
import { ParticleStage } from "./motion/ParticleStage.mjs";
import { computeSceneEnvelope, getSceneBurstInfo, parseSubtitleSegments } from "./motion/kernel.mjs";
import { renderMarkdownToHtml } from "./markdown.mjs";

const h = React.createElement;

const RENDER_PREFS_STORAGE_KEY = "videomaker.renderPrefs.v1";

const DEFAULT_RENDER_PREFS = {
  engine: "hyperframes",
  hardware: "auto",
  formatCodec: "mp4:h264",
  resolution: "1080p",
  fps: 60,
};

// Render engines (engine/render_video.mjs --engine). See engine/HYPERFRAMES_ENGINE.md.
const ENGINE_OPTIONS = [
  { id: "hyperframes", label: "HyperFrames (DOM + GSAP)", short: "HyperFrames" },
  { id: "legacy", label: "Canvas 2D cũ (nhanh)", short: "Canvas" },
];

const HARDWARE_OPTIONS = [
  { id: "auto", label: "Auto (Ưu tiên GPU)", short: "Auto" },
  { id: "gpu", label: "GPU Hardware", short: "GPU" },
  { id: "cpu", label: "CPU Software", short: "CPU" },
];

const FORMAT_CODEC_OPTIONS = [
  { id: "mp4:h264", label: "MP4 · H.264", format: "mp4", codec: "h264", short: "MP4 H.264" },
  { id: "mp4:hevc", label: "MP4 · HEVC H.265", format: "mp4", codec: "hevc", short: "MP4 HEVC" },
  { id: "webm:vp9", label: "WebM · VP9", format: "webm", codec: "vp9", short: "WebM VP9" },
];

const RESOLUTION_OPTIONS = [
  { id: "720p", label: "HD 720p", short: "HD" },
  { id: "1080p", label: "FHD 1080p", short: "FHD" },
  { id: "1440p", label: "2K 1440p", short: "2K" },
  { id: "2160p", label: "4K 2160p", short: "4K" },
];

const FPS_OPTIONS = [
  { id: 24, label: "24fps" },
  { id: 30, label: "30fps" },
  { id: 60, label: "60fps" },
];

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0];

function splitFormatCodec(formatCodec) {
  const found = FORMAT_CODEC_OPTIONS.find((o) => o.id === formatCodec) || FORMAT_CODEC_OPTIONS[0];
  return { format: found.format, codec: found.codec, short: found.short };
}

function applyRenderPrefsWithGuardrails(prev, patch) {
  const base = {
    engine: ENGINE_OPTIONS.some((o) => o.id === prev?.engine) ? prev.engine : DEFAULT_RENDER_PREFS.engine,
    hardware: HARDWARE_OPTIONS.some((o) => o.id === prev?.hardware) ? prev.hardware : DEFAULT_RENDER_PREFS.hardware,
    formatCodec: FORMAT_CODEC_OPTIONS.some((o) => o.id === prev?.formatCodec)
      ? prev.formatCodec
      : DEFAULT_RENDER_PREFS.formatCodec,
    resolution: RESOLUTION_OPTIONS.some((o) => o.id === prev?.resolution)
      ? prev.resolution
      : DEFAULT_RENDER_PREFS.resolution,
    fps: FPS_OPTIONS.some((o) => o.id === Number(prev?.fps)) ? Number(prev.fps) : DEFAULT_RENDER_PREFS.fps,
  };

  const engine =
    patch.engine !== undefined && ENGINE_OPTIONS.some((o) => o.id === patch.engine) ? patch.engine : base.engine;
  let hardware = patch.hardware !== undefined ? patch.hardware : base.hardware;
  let formatCodec = patch.formatCodec !== undefined ? patch.formatCodec : base.formatCodec;
  const resolution =
    patch.resolution !== undefined && RESOLUTION_OPTIONS.some((o) => o.id === patch.resolution)
      ? patch.resolution
      : base.resolution;
  const fps =
    patch.fps !== undefined && FPS_OPTIONS.some((o) => o.id === Number(patch.fps))
      ? Number(patch.fps)
      : base.fps;

  if (!HARDWARE_OPTIONS.some((o) => o.id === hardware)) hardware = base.hardware;
  if (!FORMAT_CODEC_OPTIONS.some((o) => o.id === formatCodec)) formatCodec = base.formatCodec;

  let note = "";
  const hwChanged = patch.hardware !== undefined && patch.hardware !== base.hardware;
  const fmtChanged = patch.formatCodec !== undefined && patch.formatCodec !== base.formatCodec;

  if (hardware === "gpu" && formatCodec === "webm:vp9") {
    if (fmtChanged && !hwChanged) {
      hardware = "cpu";
      note =
        "WebM · VP9 chỉ hỗ trợ CPU Software trong Chrome (GPU hardware encode hỗ trợ MP4 H.264/HEVC) — đã tự chuyển Hardware sang CPU Software.";
    } else {
      formatCodec = "mp4:h264";
      note =
        "Chrome GPU hardware encode chỉ hỗ trợ H.264/HEVC MP4 (VP9 chỉ chạy CPU) — đã tự chuyển sang MP4 · H.264.";
    }
  } else if (hardware === "cpu" && formatCodec === "mp4:hevc") {
    if (fmtChanged && !hwChanged) {
      hardware = "gpu";
      note =
        "MP4 · HEVC H.265 không có bộ mã hóa CPU Software trong Chrome — đã tự chuyển Hardware sang GPU Hardware.";
    } else {
      formatCodec = "mp4:h264";
      note =
        "MP4 · HEVC H.265 không có bộ mã hóa CPU Software trong Chrome — đã tự chuyển sang MP4 · H.264.";
    }
  }

  return {
    prefs: { engine, hardware, formatCodec, resolution, fps },
    note,
  };
}

function loadInitialRenderPrefs() {
  try {
    const raw = window.localStorage.getItem(RENDER_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_RENDER_PREFS;
    const parsed = JSON.parse(raw);
    return applyRenderPrefsWithGuardrails(DEFAULT_RENDER_PREFS, parsed || {}).prefs;
  } catch {
    return DEFAULT_RENDER_PREFS;
  }
}

function formatRenderPrefsPill(prefs, speed) {
  const resShort = RESOLUTION_OPTIONS.find((r) => r.id === prefs.resolution)?.short || prefs.resolution;
  const hwShort = HARDWARE_OPTIONS.find((w) => w.id === prefs.hardware)?.short || prefs.hardware;
  const fmtShort = splitFormatCodec(prefs.formatCodec).short;
  const engineShort = ENGINE_OPTIONS.find((e) => e.id === prefs.engine)?.short || "HyperFrames";
  return `${engineShort} · ${resShort} · ${prefs.fps}fps · ${speed}x · ${hwShort} · ${fmtShort}`;
}

function formatJobModeTitle(mode) {
  if (mode === "tts_only") return "🎙️ Tạo Audio (TTS)";
  if (mode === "render_only") return "🎬 Xuất Video (Server)";
  return "🎬 Tạo Audio & Render Video";
}

function sanitizeOutputFilenameInput(raw) {
  let note = "";
  let s = String(raw || "");
  if (/\.(mp4|webm)$/i.test(s.trim())) {
    s = s.trim().replace(/\.(mp4|webm)$/i, "");
    note = "Đã tự bỏ đuôi .mp4/.webm (định dạng được khóa tự động theo codec).";
  }
  const withoutForbidden = s.replace(/[/\\:*?"<>|\x00-\x1f]/g, "");
  if (withoutForbidden !== s) {
    s = withoutForbidden;
    note = "Đã loại bỏ ký tự đường dẫn không hợp lệ (/ \\ : * ? \" < > |).";
  }
  if (s.includes("..")) {
    while (s.includes("..")) {
      s = s.replace(/\.\./g, ".");
    }
    note = "Đã loại bỏ chuỗi '..' không hợp lệ trong tên file.";
  }
  s = s.replace(/^[.\s]+/, "").replace(/\s+/g, "-");
  if (s.length > 96) {
    s = s.slice(0, 96);
  }
  return { stem: s, note };
}

function resolveOutputFilenameStem(rawStem, fallbackId) {
  const { stem } = sanitizeOutputFilenameInput(rawStem);
  const clean = stem.replace(/[.\s]+$/g, "");
  if (!clean) {
    return String(fallbackId || "video").trim() || "video";
  }
  return clean;
}

function suggestNextVideoFilenameStem(stem, ext, videoFiles) {
  const existing = new Set(
    (Array.isArray(videoFiles) ? videoFiles : [])
      .map((f) => String(f?.filename || "").toLowerCase())
      .filter(Boolean)
  );
  const base = String(stem || "video").replace(/-v\d+$/i, "") || String(stem || "video");
  let n = 2;
  while (n < 999) {
    const candidate = `${base}-v${n}`;
    if (!existing.has(`${candidate}.${ext}`.toLowerCase())) {
      return candidate;
    }
    n += 1;
  }
  return `${base}-v${Date.now()}`;
}

function formatVideoFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "0 MB";
  if (n < 1024 * 1024) {
    return `${Math.max(1, Math.round(n / 1024))} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVideoTimestamp(isoOrMs) {
  if (!isoOrMs) return "";
  try {
    const d = new Date(isoOrMs);
    if (Number.isNaN(d.getTime())) return String(isoOrMs);
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(isoOrMs);
  }
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function clamp01(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round4(val) {
  return Math.round(clamp01(val) * 10000) / 10000;
}

function cloneVisualData(vd) {
  try {
    return JSON.parse(JSON.stringify(vd || {}));
  } catch {
    return {};
  }
}

function formatShortVoiceLabel(trackId, track) {
  const raw = String(track?.tts_profile || trackId || "").trim();
  if (!raw) return "Voice";
  const cleaned = raw.replace(/^(edge-|voicestudio-|openai-|google-)/i, "");
  return cleaned || raw;
}

function extractCalibratableItems(visualType, visualData) {
  const vd = visualData || {};
  const items = [];
  const pushArrayItems = (group, arr, getLabel, forceMark = false) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const it = arr[i] || {};
      const hasRange = !forceMark && (it.progress_start !== undefined || it.progress_end !== undefined);
      const start = clamp01(
        it.progress_start ?? it.progress_at ?? (i / Math.max(1, n))
      );
      const end =
        it.progress_end !== undefined
          ? clamp01(it.progress_end)
          : hasRange
            ? clamp01((i + 1) / Math.max(1, n))
            : null;
      items.push({
        id: `${group}:${i}`,
        group,
        index: i,
        stepNum: items.length + 1,
        kind: end !== null && !forceMark ? "range" : "mark",
        label: String(getLabel(it, i) || `Bước ${i + 1}`).slice(0, 64),
        start,
        end,
      });
    }
  };

  if (visualType === "architecture") {
    pushArrayItems(
      "flow_steps",
      vd.flow_steps,
      (s, i) => s.label || s.badge_text || s.callout || s.cue_text || `Bước ${i + 1}`
    );
  } else if (visualType === "console_setup") {
    pushArrayItems(
      "steps",
      vd.steps,
      (s, i) => s.label || s.action || s.title || s.cue_text || `Bước ${i + 1}`
    );
  } else if (visualType === "code_cli") {
    pushArrayItems(
      "highlight_phases",
      vd.highlight_phases,
      (p, i) => p.label || p.explanation || p.cue_text || `Phase ${i + 1}`
    );
    pushArrayItems(
      "terminal_commands",
      vd.terminal_commands,
      (c, i) => c.cmd || c.cue_text || `Lệnh ${i + 1}`,
      true
    );
  } else if (visualType === "timeline_flow") {
    pushArrayItems(
      "milestones",
      vd.milestones,
      (m, i) => m.title || m.label || m.cue_text || `Mốc ${i + 1}`
    );
    if (vd.callout && typeof vd.callout === "object") {
      items.push({
        id: "callout:0",
        group: "callout",
        index: 0,
        stepNum: items.length + 1,
        kind: "mark",
        label: vd.callout.title || "Callout tổng kết",
        start: clamp01(vd.callout.show_at_progress ?? 0.8),
        end: null,
      });
    }
  } else if (visualType === "comparison_matrix") {
    pushArrayItems(
      "rows",
      vd.rows,
      (r, i) => r.label || r.feature || r.name || r.cue_text || `Hàng ${i + 1}`,
      !Array.isArray(vd.rows) || vd.rows.every((r) => r?.progress_end === undefined)
    );
    if (vd.takeaway && typeof vd.takeaway === "object") {
      items.push({
        id: "takeaway:0",
        group: "takeaway",
        index: 0,
        stepNum: items.length + 1,
        kind: "mark",
        label: "Kết luận (Takeaway)",
        start: clamp01(vd.takeaway.show_at_progress ?? 0.78),
        end: null,
      });
    }
  } else if (visualType === "exam_tips") {
    pushArrayItems(
      "comparisons",
      vd.comparisons,
      (c, i) => c.label || c.title || c.wrong || c.right || `So sánh ${i + 1}`,
      !Array.isArray(vd.comparisons) || vd.comparisons.every((c) => c?.progress_end === undefined)
    );
    if (vd.quiz && typeof vd.quiz === "object") {
      items.push({
        id: "quiz:0",
        group: "quiz",
        index: 0,
        stepNum: items.length + 1,
        kind: "mark",
        label: "Quiz Show",
        start: clamp01(vd.quiz.show_at_progress ?? 0.68),
        end: null,
      });
    }
  } else if (visualType === "kpi_metrics") {
    const kpiField = Array.isArray(vd.cards) && vd.cards.length
      ? "cards"
      : Array.isArray(vd.metrics) && vd.metrics.length
        ? "metrics"
        : Array.isArray(vd.bars) && vd.bars.length
          ? "bars"
          : "cards";
    pushArrayItems(
      kpiField,
      vd[kpiField],
      (c, i) => c.label || c.title || c.name || `Chỉ số ${i + 1}`,
      !Array.isArray(vd[kpiField]) || vd[kpiField].every((c) => c?.progress_end === undefined)
    );
    if (vd.chart && typeof vd.chart === "object") {
      items.push({
        id: "chart:0",
        group: "chart",
        index: 0,
        stepNum: items.length + 1,
        kind: "mark",
        label: "Biểu đồ (Chart)",
        start: clamp01(vd.chart.show_at_progress ?? 0.4),
        end: null,
      });
    }
    if (vd.alert_stamp && typeof vd.alert_stamp === "object") {
      items.push({
        id: "alert_stamp:0",
        group: "alert_stamp",
        index: 0,
        stepNum: items.length + 1,
        kind: "mark",
        label: "Alert Stamp",
        start: clamp01(vd.alert_stamp.show_at_progress ?? 0.72),
        end: null,
      });
    }
  }

  return items;
}

function applyPlayheadToVisualData(visualData, item, playheadProgress) {
  const next = cloneVisualData(visualData);
  const p = clamp01(playheadProgress);
  if (
    item.group === "quiz" ||
    item.group === "callout" ||
    item.group === "takeaway" ||
    item.group === "chart" ||
    item.group === "alert_stamp"
  ) {
    if (!next[item.group] || typeof next[item.group] !== "object") {
      next[item.group] = {};
    }
    next[item.group].show_at_progress = round4(Math.min(0.98, p));
    return next;
  }

  const arr = Array.isArray(next[item.group]) ? next[item.group] : null;
  if (!arr || !arr[item.index]) return next;

  const idx = item.index;
  if (item.kind === "range") {
    const prevStart = idx > 0 ? clamp01(arr[idx - 1].progress_start ?? 0) : -0.02;
    const minBound = idx > 0 ? Math.min(0.96, prevStart + 0.02) : 0;
    const curEnd = clamp01(arr[idx].progress_end ?? ((idx + 1) / Math.max(1, arr.length)));
    const maxBound = Math.max(minBound, Math.min(0.98, curEnd - 0.02));
    const clampedP = Math.max(minBound, Math.min(maxBound, p));
    arr[idx].progress_start = round4(clampedP);
    if (arr[idx].progress_at !== undefined) {
      arr[idx].progress_at = round4(clampedP);
    }
    if (idx > 0) {
      arr[idx - 1].progress_end = round4(clampedP);
    }
  } else {
    const prevVal = idx > 0 ? clamp01(arr[idx - 1].progress_start ?? arr[idx - 1].progress_at ?? 0) : -0.01;
    const nextVal =
      idx + 1 < arr.length
        ? clamp01(arr[idx + 1].progress_start ?? arr[idx + 1].progress_at ?? 0.99)
        : 0.99;
    const minBound = idx > 0 ? Math.min(0.97, prevVal + 0.01) : 0;
    const maxBound = Math.max(minBound, Math.min(0.98, nextVal - 0.01));
    const clampedP = Math.max(minBound, Math.min(maxBound, p));
    if (arr[idx].progress_start !== undefined || arr[idx].progress_at === undefined) {
      arr[idx].progress_start = round4(clampedP);
    }
    if (arr[idx].progress_at !== undefined) {
      arr[idx].progress_at = round4(clampedP);
    }
  }
  return next;
}

function extractTimingsPayload(visualData) {
  const vd = visualData || {};
  const timings = {};
  const arrayKeys = [
    "flow_steps",
    "highlight_phases",
    "terminal_commands",
    "steps",
    "milestones",
    "rows",
    "comparisons",
    "cards",
    "metrics",
    "bars",
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(vd[key]) && vd[key].length > 0) {
      timings[key] = vd[key].map((item) => {
        const entry = {};
        if (item.progress_start !== undefined) entry.progress_start = round4(item.progress_start);
        if (item.progress_end !== undefined) entry.progress_end = round4(item.progress_end);
        if (item.progress_at !== undefined) entry.progress_at = round4(item.progress_at);
        return entry;
      });
    }
  }
  for (const objKey of ["quiz", "callout", "takeaway", "chart", "alert_stamp"]) {
    if (vd[objKey] && typeof vd[objKey] === "object" && vd[objKey].show_at_progress !== undefined) {
      timings[objKey] = { show_at_progress: round4(vd[objKey].show_at_progress) };
    }
  }
  return timings;
}

function getInitialRouteParams() {
  const params = new URLSearchParams(window.location.search);
  const course = params.get("course") || "";
  const ep = params.get("ep") || "";
  const scene = params.get("scene") || "";
  const viewParam = params.get("view") || "";
  const headless = params.get("headless") === "1" || params.get("headless") === "true";

  let view = "projects";
  if (viewParam === "player" || (headless && ep)) {
    view = "player";
  } else if (viewParam === "roadmap" && course) {
    view = "roadmap";
  }

  return { course, ep, scene, view, headless };
}

const SCENE_COMPONENTS = {
  architecture: ArchitectureDiagram,
  console_setup: CleanConsoleMockup,
  code_cli: TerminalAndCode,
  exam_tips: ExamTipCard,
  comparison_matrix: ComparisonMatrix,
  timeline_flow: TimelineFlow,
  kpi_metrics: KpiMetricsCard,
};

function StudioApp() {
  const initialRoute = useMemo(() => getInitialRouteParams(), []);

  const [view, setView] = useState(initialRoute.view); // "projects" | "roadmap" | "player"
  const [courses, setCourses] = useState([]);
  const [events, setEvents] = useState([]);
  const [sseStatus, setSseStatus] = useState("connecting"); // "connecting" | "live" | "reconnecting"
  const [loading, setLoading] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState(initialRoute.course);
  const [selectedEpId, setSelectedEpId] = useState(initialRoute.ep);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [sceneTime, setSceneTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [activeTab, setActiveTab] = useState("scenes"); // "scenes" | "notes" | "revisions" | "curriculum"
  const [exportStatus, setExportStatus] = useState(null);
  const [exportSeekActive, setExportSeekActive] = useState(false);
  const [playerAiModalOpen, setPlayerAiModalOpen] = useState(false);
  const [playerAiOptions, setPlayerAiOptions] = useState({
    initialMode: null,
    initialPauseAfter: null,
    startFrom: null,
  });
  const [playerStageModalOpen, setPlayerStageModalOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceTrackBusy, setVoiceTrackBusy] = useState(false);
  const [calibratorOpen, setCalibratorOpen] = useState(true);
  const [timingDraft, setTimingDraft] = useState(null); // { sceneId, visualData }
  const [timingDraftDirty, setTimingDraftDirty] = useState(false);
  const [timingSaving, setTimingSaving] = useState(false);
  const [timingAutoAligning, setTimingAutoAligning] = useState(false);
  const [jobsList, setJobsList] = useState([]);
  const [aiJobsList, setAiJobsList] = useState([]);
  const [workerStatus, setWorkerStatus] = useState({
    online: false,
    worker_count: 0,
    primary_worker: null,
    workers: [],
  });
  const [providersData, setProvidersData] = useState(null);
  const [pendingResumeJob, setPendingResumeJob] = useState(null);
  const [trayHighlightSignal, setTrayHighlightSignal] = useState(0);
  const [renderPrefs, setRenderPrefs] = useState(loadInitialRenderPrefs);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [includeTtsBeforeExport, setIncludeTtsBeforeExport] = useState(false);
  const [outputFilenameStem, setOutputFilenameStem] = useState("");
  const [filenameSanitizeNote, setFilenameSanitizeNote] = useState("");
  const [previewVideoFile, setPreviewVideoFile] = useState(null);
  const [deletingVideoFile, setDeletingVideoFile] = useState("");
  const [guardrailNote, setGuardrailNote] = useState("");
  const [audioVersion, setAudioVersion] = useState(1);
  const [revisionToast, setRevisionToast] = useState(null);

  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const virtualTimeRef = useRef(0);
  const timelineStateRef = useRef({ scenes: [], sceneOffsets: [], totalDuration: 0, isStoryboardMode: false });
  const selectedCourseIdRef = useRef(selectedCourseId);
  const selectedEpIdRef = useRef(selectedEpId);
  const sseRefreshTimerRef = useRef(null);
  const pendingSceneIdRef = useRef(initialRoute.scene || "");
  const renderSettingsRef = useRef(null);
  const exportFilenameInputRef = useRef(null);
  const notifiedJobStatesRef = useRef(new Set());

  selectedCourseIdRef.current = selectedCourseId;
  selectedEpIdRef.current = selectedEpId;

  useEffect(() => {
    try {
      window.localStorage.setItem(RENDER_PREFS_STORAGE_KEY, JSON.stringify(renderPrefs));
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }, [renderPrefs]);

  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const onMouseDown = (e) => {
      if (e.target?.closest && e.target.closest("[data-export-trigger]")) {
        return;
      }
      if (renderSettingsRef.current && !renderSettingsRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!previewVideoFile) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setPreviewVideoFile(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewVideoFile]);

  const updateRenderPrefs = useCallback((patch) => {
    setRenderPrefs((prev) => {
      const { prefs, note } = applyRenderPrefsWithGuardrails(prev, patch);
      if (note) {
        setGuardrailNote(note);
      } else if (patch.hardware !== undefined || patch.formatCodec !== undefined) {
        setGuardrailNote("");
      }
      return prefs;
    });
  }, []);

  const jobsMap = useMemo(() => {
    const map = {};
    for (const j of jobsList) {
      if (!j || !j.course || !j.episode) continue;
      const key = `${j.course}:${j.episode}`;
      const prev = map[key];
      const jActive = j.status === "running" || j.status === "queued";
      const prevActive = prev && (prev.status === "running" || prev.status === "queued");
      if (
        !prev ||
        (jActive && !prevActive) ||
        (jActive === Boolean(prevActive) &&
          String(j.updated_at || j.started_at || "") >= String(prev.updated_at || prev.started_at || ""))
      ) {
        map[key] = j;
      }
    }
    return map;
  }, [jobsList]);

  const upsertJob = useCallback((job) => {
    if (!job || !job.id) return;
    setJobsList((prev) => {
      const idx = prev.findIndex((item) => item.id === job.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...job };
        return next;
      }
      return [job, ...prev];
    });
  }, []);

  const showToast = useCallback((ok, msg) => {
    setRevisionToast({ ok, msg });
    setTimeout(() => setRevisionToast(null), 4500);
  }, []);

  const fetchCourses = useCallback(async () => {
    try {
      const r = await fetch("/api/courses");
      const data = await r.json();
      const list = data.courses || [];
      setCourses(list);

      if (list.length > 0) {
        const currentCid = selectedCourseIdRef.current;
        const targetCourse = list.find((c) => c.id === currentCid) || list[0];
        if (!currentCid || !list.some((c) => c.id === currentCid)) {
          setSelectedCourseId(targetCourse.id);
        }

        const currentEid = selectedEpIdRef.current;
        const eps = targetCourse.episodes || [];
        if (!currentEid || !eps.some((e) => e.id === currentEid)) {
          const firstPlayable = eps.find((e) => e.has_script) || eps[0];
          if (firstPlayable) {
            setSelectedEpId(firstPlayable.id);
          }
        }
      }
    } catch {
      // Keep existing courses state on transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async (courseId) => {
    if (!courseId) {
      setEvents([]);
      return;
    }
    try {
      const r = await fetch(`/api/events?course=${encodeURIComponent(courseId)}&limit=50`);
      if (!r.ok) return;
      const data = await r.json();
      const list = Array.isArray(data) ? data : data.events || [];
      setEvents(list);
    } catch {
      // Ignore transient event fetch errors
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const r = await fetch("/api/jobs");
      if (!r.ok) return;
      const data = await r.json();
      const list = Array.isArray(data.jobs) ? data.jobs : [];
      setJobsList(list);
    } catch {
      // Ignore transient jobs fetch errors
    }
  }, []);

  const upsertAiJob = useCallback((incoming) => {
    if (!incoming || !incoming.id) return;
    setAiJobsList((prev) => {
      const idx = prev.findIndex((j) => j.id === incoming.id);
      if (idx === -1) return [incoming, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...incoming };
      return next;
    });
  }, []);

  const fetchAiStatus = useCallback(async () => {
    if (initialRoute.headless) return;
    try {
      const r = await fetch("/api/ai/status");
      if (!r.ok) return;
      const data = await r.json();
      if (data && typeof data.online === "boolean") {
        setWorkerStatus(data);
      }
    } catch {
      // Ignore transient errors
    }
  }, [initialRoute.headless]);

  const fetchAiJobs = useCallback(async () => {
    if (initialRoute.headless) return;
    try {
      const r = await fetch("/api/ai/jobs");
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.jobs)) {
        setAiJobsList(data.jobs);
      }
    } catch {
      // Ignore transient errors
    }
  }, [initialRoute.headless]);

  const fetchAiProviders = useCallback(async () => {
    if (initialRoute.headless) return;
    try {
      const r = await fetch("/api/ai/providers");
      if (!r.ok) return;
      const data = await r.json();
      if (data && Array.isArray(data.providers || data.brands)) {
        setProvidersData(data);
      }
    } catch {
      // Ignore transient errors
    }
  }, [initialRoute.headless]);

  useEffect(() => {
    fetchCourses();
    fetchJobs();
    if (!initialRoute.headless) {
      fetchAiStatus();
      fetchAiJobs();
      fetchAiProviders();
    }
  }, [fetchCourses, fetchJobs, fetchAiStatus, fetchAiJobs, fetchAiProviders, initialRoute.headless]);

  useEffect(() => {
    if (selectedCourseId) {
      fetchEvents(selectedCourseId);
    }
  }, [selectedCourseId, fetchEvents]);

  // Subscribe to EventSource("/api/stream") for live dashboard/roadmap/player updates
  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;

    const es = new EventSource("/api/stream");
    const scheduleRefresh = () => {
      clearTimeout(sseRefreshTimerRef.current);
      sseRefreshTimerRef.current = setTimeout(() => {
        fetchCourses();
        if (selectedCourseIdRef.current) {
          fetchEvents(selectedCourseIdRef.current);
        }
      }, 120);
    };

    const handleJobUpdate = (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        const job = parsed.job || parsed;
        if (!job || !job.course || !job.episode) return;
        upsertJob(job);

        const notifyKey = `${job.id}:${job.status}`;
        const alreadyNotified = notifiedJobStatesRef.current.has(notifyKey);

        if (job.status === "completed" || job.status === "done" || job.status === "succeeded") {
          setAudioVersion((v) => v + 1);
          scheduleRefresh();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            showToast(
              true,
              job.mode === "tts_only"
                ? `✅ Đã tạo xong Audio (TTS) cho ${job.episode}.`
                : job.mode === "render_only"
                  ? `✅ Đã xuất xong Video ${job.output_file || job.episode}.`
                  : `✅ Đã tạo Audio & Render Video xong cho ${job.episode}.`
            );
          }
        } else if (job.status === "failed" || job.status === "error") {
          scheduleRefresh();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            showToast(false, `⚠️ Lỗi job ${job.episode}: ${job.error || job.message || "Không xác định"}`);
          }
        } else if (job.status === "cancelled") {
          scheduleRefresh();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            showToast(false, `⏹️ Đã hủy tác vụ ${job.episode}.`);
          }
        }
      } catch {
        // Ignore malformed job_update SSE payload
      }
    };

    const handleJobsCleared = (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        if (Array.isArray(parsed.jobs)) {
          setJobsList(parsed.jobs);
        } else {
          fetchJobs();
        }
      } catch {
        fetchJobs();
      }
    };

    const handleWorkerStatus = (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        if (parsed && typeof parsed.online === "boolean") {
          setWorkerStatus(parsed);
          fetchAiProviders();
        }
      } catch {
        // Ignore malformed worker_status payload
      }
    };

    const handleAiJobUpdate = (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        const job = parsed.job || parsed;
        if (!job || !job.id) return;
        upsertAiJob(job);

        const doneCount = Array.isArray(job.completed_episodes) ? job.completed_episodes.length : 0;
        const totalCount = Array.isArray(job.episode_ids) ? job.episode_ids.length : 1;
        const notifyKey = `ai:${job.id}:${job.status}:${doneCount}`;
        const alreadyNotified = notifiedJobStatesRef.current.has(notifyKey);
        if (job.status === "completed") {
          scheduleRefresh();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            showToast(
              true,
              `✅ AI đã biên kịch xong ${(job.episode_ids || []).length} tập (${job.course})${
                job.auto_produce ? " và đẩy sang hàng đợi TTS/Render." : " (script_ready)."
              }`
            );
          }
        } else if (job.status === "paused") {
          scheduleRefresh();
          fetchAiProviders();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            if (job.pause_reason === "quota_exhausted") {
              showToast(
                false,
                `⏸️ AI tạm dừng do hết Quota (${doneCount}/${totalCount} tập đã xong) — Bấm "Tiếp tục" để đổi Model.`
              );
            } else if (job.pause_reason === "server_interrupted") {
              showToast(
                false,
                `⏸️ AI tạm dừng do Server khởi động lại (${doneCount}/${totalCount} tập đã xong) — Bấm "Tiếp tục" để chạy nốt.`
              );
            } else {
              showToast(
                false,
                `⏸️ AI tạm dừng (${doneCount}/${totalCount} tập đã xong): ${job.error || "Bấm Tiếp tục để chạy lại"}`
              );
            }
          }
        } else if (job.status === "failed") {
          scheduleRefresh();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            showToast(false, `⚠️ AI Biên kịch lỗi: ${job.error || "Không xác định"}`);
          }
        } else if (job.status === "cancelled") {
          scheduleRefresh();
          if (!alreadyNotified) {
            notifiedJobStatesRef.current.add(notifyKey);
            showToast(false, `⏹️ Đã hủy lệnh biên kịch AI (${job.id}).`);
          }
        } else if (job.status === "running") {
          scheduleRefresh();
        }
      } catch {
        // Ignore malformed ai_job_update SSE payload
      }
    };

    const handleAiJobsCleared = (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        if (Array.isArray(parsed.jobs)) {
          setAiJobsList(parsed.jobs);
        } else {
          fetchAiJobs();
        }
      } catch {
        fetchAiJobs();
      }
    };

    const markLive = () => {
      setSseStatus("live");
      fetchJobs();
      if (!initialRoute.headless) {
        fetchAiStatus();
        fetchAiJobs();
        fetchAiProviders();
      }
    };
    es.onopen = markLive;
    es.onerror = () => {
      setSseStatus("reconnecting");
    };
    es.addEventListener("connected", markLive);
    es.addEventListener("state_update", scheduleRefresh);
    es.addEventListener("job_update", handleJobUpdate);
    es.addEventListener("jobs_cleared", handleJobsCleared);
    es.addEventListener("worker_status", handleWorkerStatus);
    es.addEventListener("ai_job_update", handleAiJobUpdate);
    es.addEventListener("ai_jobs_cleared", handleAiJobsCleared);
    es.onmessage = scheduleRefresh;

    return () => {
      clearTimeout(sseRefreshTimerRef.current);
      es.removeEventListener("connected", markLive);
      es.removeEventListener("state_update", scheduleRefresh);
      es.removeEventListener("job_update", handleJobUpdate);
      es.removeEventListener("jobs_cleared", handleJobsCleared);
      es.removeEventListener("worker_status", handleWorkerStatus);
      es.removeEventListener("ai_job_update", handleAiJobUpdate);
      es.removeEventListener("ai_jobs_cleared", handleAiJobsCleared);
      es.close();
    };
  }, [fetchCourses, fetchEvents, fetchJobs, fetchAiStatus, fetchAiJobs, fetchAiProviders, initialRoute.headless, showToast, upsertJob, upsertAiJob]);

  // Sync URL query params (when not in headless export mode)
  useEffect(() => {
    if (initialRoute.headless) return;
    const params = new URLSearchParams();
    if (view === "roadmap" && selectedCourseId) {
      params.set("view", "roadmap");
      params.set("course", selectedCourseId);
    } else if (view === "player" && selectedCourseId) {
      params.set("view", "player");
      params.set("course", selectedCourseId);
      if (selectedEpId) params.set("ep", selectedEpId);
      const currScId = timelineStateRef.current.scenes?.[sceneIdx]?.id || pendingSceneIdRef.current;
      if (currScId) params.set("scene", currScId);
    }
    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (window.location.search !== (qs ? `?${qs}` : "")) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [view, selectedCourseId, selectedEpId, sceneIdx, initialRoute.headless]);

  const currentCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const currentEpisode = useMemo(
    () => currentCourse?.episodes?.find((e) => e.id === selectedEpId) || null,
    [currentCourse, selectedEpId]
  );

  const scenes = currentEpisode?.script?.scenes || [];
  const currentScene = scenes[sceneIdx] || null;
  const effectiveScene = useMemo(() => {
    if (!currentScene) return null;
    if (timingDraft && timingDraft.sceneId === currentScene.id && timingDraft.visualData) {
      return { ...currentScene, visual_data: timingDraft.visualData };
    }
    return currentScene;
  }, [currentScene, timingDraft]);

  const voiceTracks = currentEpisode?.script?.voice_tracks || {};
  const voiceTrackKeys = Object.keys(voiceTracks);
  const activeVoiceTrackId =
    currentEpisode?.script?.active_voice_track ||
    (voiceTrackKeys.length === 1 ? voiceTrackKeys[0] : "");
  const activeTrackObj = activeVoiceTrackId ? voiceTracks[activeVoiceTrackId] || null : null;
  const currentTrackHasAudio = Boolean(
    activeTrackObj
      ? Object.keys(activeTrackObj.scene_data || {}).length > 0
      : currentEpisode?.has_audio
  );
  const isEpStaleVal = Boolean(currentEpisode?.state?.production?.stale);

  useEffect(() => {
    setTimingDraft(null);
    setTimingDraftDirty(false);
  }, [currentEpisode?.id, currentScene?.id, activeVoiceTrackId]);

  useEffect(() => {
    setIncludeTtsBeforeExport(!currentTrackHasAudio || isEpStaleVal);
  }, [currentEpisode?.id, currentTrackHasAudio, isEpStaleVal, activeVoiceTrackId]);

  useEffect(() => {
    setOutputFilenameStem(currentEpisode?.id || "");
    setFilenameSanitizeNote("");
    setPreviewVideoFile(null);
  }, [currentEpisode?.id]);

  const isStoryboardMode = Boolean(
    currentEpisode &&
      currentScene &&
      (currentEpisode.has_audio === false || !currentScene.audio_file)
  );

  // Resolve deep-linked scene_id once episode scenes load
  useEffect(() => {
    const targetSceneId = pendingSceneIdRef.current;
    if (!targetSceneId || view !== "player" || !currentEpisode || scenes.length === 0) return;
    const idx = scenes.findIndex((s) => s.id === targetSceneId);
    pendingSceneIdRef.current = "";
    if (idx >= 0) {
      virtualTimeRef.current = 0;
      setSceneIdx(idx);
      setSceneTime(0);
      setIsPlaying(false);
    }
  }, [view, currentEpisode?.id, scenes]);

  // Compute cumulative scene start offsets (supporting virtual 24s duration fallback in storyboard mode)
  const sceneOffsets = useMemo(() => {
    let acc = 0;
    return scenes.map((sc) => {
      const dur = sc.duration_sec || 24;
      const start = acc;
      acc += dur;
      return { start, end: acc, dur };
    });
  }, [scenes]);

  const totalDuration = sceneOffsets.length
    ? sceneOffsets[sceneOffsets.length - 1].end
    : 0;
  const currentSceneDuration = currentScene ? currentScene.duration_sec || 24 : 0;
  const globalTime = (sceneOffsets[sceneIdx]?.start || 0) + sceneTime;
  const globalProgress = totalDuration > 0 ? Math.max(0, Math.min(1, globalTime / totalDuration)) : 0;

  timelineStateRef.current = { scenes, sceneOffsets, totalDuration, isStoryboardMode };
  virtualTimeRef.current = sceneTime;

  // Deterministic scrubbing / headless stepping hook
  useEffect(() => {
    window.__STUDIO_EXPORT_SEEK__ = (globalTimeSec) => {
      const { scenes: scList, sceneOffsets: offs, totalDuration: tot } = timelineStateRef.current;
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        audio.pause();
      }
      setIsPlaying(false);
      setExportSeekActive(true);

      if (!scList.length || !offs.length) {
        return { sceneIdx: 0, sceneTime: 0, globalTime: 0, sceneId: null };
      }

      const clampedGlobal = Math.max(0, Math.min(tot, Number(globalTimeSec) || 0));
      let targetIdx = offs.findIndex((o, idx) =>
        idx === offs.length - 1
          ? clampedGlobal <= o.end + 1e-6
          : clampedGlobal >= o.start && clampedGlobal < o.end
      );
      if (targetIdx < 0) targetIdx = scList.length - 1;
      const localTime = Math.max(0, clampedGlobal - offs[targetIdx].start);

      virtualTimeRef.current = localTime;
      setSceneIdx(targetIdx);
      setSceneTime(localTime);
      try {
        if (audio && audio.readyState >= 1) {
          audio.currentTime = localTime;
        }
      } catch {
        // Ignore seek errors before audio metadata loads
      }

      return {
        sceneIdx: targetIdx,
        sceneTime: localTime,
        globalTime: clampedGlobal,
        sceneId: scList[targetIdx]?.id || null,
      };
    };

    return () => {
      delete window.__STUDIO_EXPORT_SEEK__;
    };
  }, []);

  // Sync audio source when scene changes (skipped cleanly in Storyboard Preview Mode)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (view !== "player" || !currentEpisode || !currentScene || isStoryboardMode) {
      if (!audio.paused) audio.pause();
      if (audio.dataset.src) {
        audio.dataset.src = "";
        audio.removeAttribute("src");
        audio.load();
      }
      return;
    }

    const targetSrc = `${currentEpisode.base_url}/${currentScene.audio_file}?v=${audioVersion}`;
    if (audio.dataset.src !== targetSrc) {
      audio.dataset.src = targetSrc;
      audio.src = targetSrc;
      audio.load();
    }
    audio.playbackRate = playbackRate;
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [view, currentEpisode?.id, currentScene?.id, isStoryboardMode, audioVersion]);

  // Update playback rate dynamically
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const jumpToScene = useCallback(
    (idx, autoPlay = isPlaying) => {
      const clamped = Math.max(0, Math.min(scenes.length - 1, idx));
      setExportSeekActive(false);
      virtualTimeRef.current = 0;
      setSceneIdx(clamped);
      setSceneTime(0);
      setIsPlaying(autoPlay);
      if (audioRef.current) {
        try {
          audioRef.current.currentTime = 0;
        } catch {
          // Ignore seek errors before audio metadata loads
        }
      }
    },
    [scenes.length, isPlaying]
  );

  // 60fps requestAnimationFrame timeline loop synced to <audio> OR virtual timer in Storyboard Mode
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (view !== "player" || !isPlaying || !currentScene) return;

    if (isStoryboardMode) {
      let lastTs = performance.now();
      const dur = currentScene.duration_sec || 24;
      const loopStoryboard = (now) => {
        const dt = Math.max(0, (now - lastTs) / 1000) * playbackRate;
        lastTs = now;
        const nextTime = virtualTimeRef.current + dt;
        if (nextTime >= dur) {
          if (sceneIdx + 1 < scenes.length) {
            jumpToScene(sceneIdx + 1, true);
          } else {
            virtualTimeRef.current = dur;
            setSceneTime(dur);
            setIsPlaying(false);
          }
          return;
        }
        virtualTimeRef.current = nextTime;
        setSceneTime(nextTime);
        rafRef.current = requestAnimationFrame(loopStoryboard);
      };
      rafRef.current = requestAnimationFrame(loopStoryboard);
      return () => cancelAnimationFrame(rafRef.current);
    }

    const loopAudio = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setSceneTime(audio.currentTime);
      }
      rafRef.current = requestAnimationFrame(loopAudio);
    };
    rafRef.current = requestAnimationFrame(loopAudio);
    return () => cancelAnimationFrame(rafRef.current);
  }, [view, isPlaying, sceneIdx, isStoryboardMode, playbackRate, currentScene, scenes.length, jumpToScene]);

  const togglePlay = () => {
    if (!currentScene) return;
    setExportSeekActive(false);

    if (isStoryboardMode) {
      if (!isPlaying && sceneIdx === scenes.length - 1 && sceneTime >= currentSceneDuration - 0.05) {
        jumpToScene(0, true);
        return;
      }
      setIsPlaying((prev) => !prev);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.playbackRate = playbackRate;
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleAudioEnded = () => {
    if (sceneIdx + 1 < scenes.length) {
      jumpToScene(sceneIdx + 1, true);
    } else {
      setIsPlaying(false);
      setSceneTime(currentSceneDuration);
    }
  };

  const handleScrubGlobal = (e) => {
    if (!totalDuration) return;
    setExportSeekActive(false);
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = ratio * totalDuration;
    let targetIdx = sceneOffsets.findIndex((o, idx) =>
      idx === sceneOffsets.length - 1
        ? targetSec <= o.end + 1e-6
        : targetSec >= o.start && targetSec < o.end
    );
    if (targetIdx < 0) targetIdx = scenes.length - 1;
    const localTime = Math.max(0, targetSec - sceneOffsets[targetIdx].start);
    virtualTimeRef.current = localTime;
    setSceneIdx(targetIdx);
    setSceneTime(localTime);
    if (!isStoryboardMode) {
      setTimeout(() => {
        if (audioRef.current) {
          try {
            audioRef.current.currentTime = localTime;
          } catch {
            // Ignore seek errors before audio metadata loads
          }
        }
      }, 30);
    }
  };

  const handleStateAction = useCallback(
    async (payload) => {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchCourses();
      if (payload.course) {
        await fetchEvents(payload.course);
      }
      return data;
    },
    [fetchCourses, fetchEvents]
  );

  const handleStartAiScript = useCallback(
    async (payload) => {
      try {
        const res = await fetch("/api/ai/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.worker_status) {
          setWorkerStatus(data.worker_status);
        }
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (data.job) {
          upsertAiJob(data.job);
        }
        setTrayHighlightSignal((n) => n + 1);
        const epCount = data.job?.episode_ids?.length || 1;
        const modelLabel =
          data.job?.model ||
          data.job?.provider_id ||
          data.worker_status?.primary_worker?.model ||
          "AI";
        showToast(
          true,
          `✍️ Đã bắt đầu biên kịch ${epCount} tập (${modelLabel}).`
        );
        return data;
      } catch (err) {
        showToast(false, `⚠️ ${err.message}`);
        throw err;
      }
    },
    [showToast, upsertAiJob]
  );

  const handleResumeAiJob = useCallback(
    async (payload) => {
      try {
        const res = await fetch("/api/ai/jobs/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.worker_status) {
          setWorkerStatus(data.worker_status);
        }
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (data.job) {
          upsertAiJob(data.job);
        }
        setTrayHighlightSignal((n) => n + 1);
        fetchAiProviders();
        showToast(
          true,
          `▶ Đã tiếp tục đợt biên kịch ${data.job?.id || payload.job_id} (${
            data.job?.model || payload.model || payload.provider_id || "AI"
          }).`
        );
        return data;
      } catch (err) {
        showToast(false, `⚠️ Không thể tiếp tục job: ${err.message}`);
        throw err;
      }
    },
    [fetchAiProviders, showToast, upsertAiJob]
  );

  const handleOpenResumeFromTray = useCallback((job) => {
    if (!job) return;
    if (job.course) {
      setSelectedCourseId(job.course);
    }
    setPendingResumeJob(job);
    setView("roadmap");
  }, []);

  const handleCancelJob = useCallback(
    async (jobId) => {
      if (!jobId) return null;
      const isAi = String(jobId).startsWith("aijob-");
      try {
        const res = await fetch(isAi ? "/api/ai/jobs/cancel" : "/api/jobs/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (data.job) {
          if (isAi) upsertAiJob(data.job);
          else upsertJob(data.job);
        } else {
          if (isAi) await fetchAiJobs();
          else await fetchJobs();
        }
        return data;
      } catch (err) {
        showToast(false, `⚠️ Không thể hủy tác vụ: ${err.message}`);
        return null;
      }
    },
    [fetchAiJobs, fetchJobs, showToast, upsertAiJob, upsertJob]
  );

  const handleClearFinishedJobs = useCallback(async () => {
    try {
      const [prodRes, aiRes] = await Promise.all([
        fetch("/api/jobs/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        fetch("/api/ai/jobs/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      ]);
      const prodData = await prodRes.json();
      const aiData = await aiRes.json();
      if (Array.isArray(prodData.jobs)) {
        setJobsList(prodData.jobs);
      } else {
        setJobsList((prev) => prev.filter((j) => j.status === "queued" || j.status === "running"));
      }
      if (Array.isArray(aiData.jobs)) {
        setAiJobsList(aiData.jobs);
      } else {
        setAiJobsList((prev) => prev.filter((j) => j.status === "queued" || j.status === "running"));
      }
      return { prodData, aiData };
    } catch (err) {
      showToast(false, `⚠️ Không thể xóa lịch sử tác vụ: ${err.message}`);
      return null;
    }
  }, [showToast]);

  const combinedJobs = useMemo(
    () => [...(aiJobsList || []), ...(jobsList || [])],
    [aiJobsList, jobsList]
  );

  const handleRunProduction = useCallback(
    async ({
      course,
      episode,
      mode = "tts_and_render",
      profile_id,
      format,
      codec,
      hardware,
      resolution,
      fps,
      speed,
      engine,
      output_filename,
    }) => {
      try {
        const prefFmt = splitFormatCodec(renderPrefs.formatCodec);
        const resolvedFormat = format || prefFmt.format;
        const resolvedCodec =
          codec ||
          (format && format !== prefFmt.format
            ? format === "mp4"
              ? "h264"
              : "vp9"
            : prefFmt.codec);
        const resolvedHardware = hardware || renderPrefs.hardware;
        const resolvedResolution = resolution || renderPrefs.resolution;
        const resolvedFps = Number(fps) || renderPrefs.fps;
        const resolvedSpeed = Number(speed) || playbackRate || 1;

        const body = {
          course,
          episode,
          mode,
          format: resolvedFormat,
        };
        if (mode !== "tts_only") {
          body.codec = resolvedCodec;
          body.hardware = resolvedHardware;
          body.resolution = resolvedResolution;
          body.fps = resolvedFps;
          body.speed = resolvedSpeed;
          body.engine = engine || renderPrefs.engine || DEFAULT_RENDER_PREFS.engine;
          if (output_filename) {
            body.output_filename = output_filename;
          }
        }
        if (profile_id) body.profile_id = profile_id;

        const res = await fetch("/api/jobs/run-production", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (data.job) {
          upsertJob(data.job);
        }
        setTrayHighlightSignal((n) => n + 1);
        showToast(
          true,
          mode === "tts_only"
            ? `🎙️ Đã đưa tạo Audio (TTS) cho ${episode} vào hàng đợi Server...`
            : mode === "render_only"
              ? `🎬 Đã đưa vào hàng đợi xuất ngầm trên Server — đóng trình duyệt vẫn chạy tiếp (${episode})`
              : `🎬 Đã đưa Tạo Audio & Render Video (${episode}) vào hàng đợi Server — đóng trình duyệt vẫn chạy tiếp`
        );
        return data;
      } catch (err) {
        showToast(false, `⚠️ Không thể chạy production: ${err.message}`);
        throw err;
      }
    },
    [playbackRate, renderPrefs, showToast, upsertJob]
  );

  const handleUnifiedExport = useCallback(async () => {
    if (!currentCourse || !currentEpisode) return;
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
    }
    setExportStatus(null);
    setExportMenuOpen(false);
    const { format, codec } = splitFormatCodec(renderPrefs.formatCodec);
    const resolvedStem = resolveOutputFilenameStem(outputFilenameStem, currentEpisode.id);
    const resolvedFilename = `${resolvedStem}.${format}`;
    try {
      await handleRunProduction({
        course: currentCourse.id,
        episode: currentEpisode.id,
        mode: includeTtsBeforeExport ? "tts_and_render" : "render_only",
        format,
        codec,
        hardware: renderPrefs.hardware,
        resolution: renderPrefs.resolution,
        fps: renderPrefs.fps,
        speed: playbackRate,
        engine: renderPrefs.engine,
        output_filename: resolvedFilename,
      });
    } catch {
      // Error toast is already surfaced by handleRunProduction
    }
  }, [
    currentCourse,
    currentEpisode,
    handleRunProduction,
    includeTtsBeforeExport,
    isPlaying,
    outputFilenameStem,
    playbackRate,
    renderPrefs,
  ]);

  const openExportMenuWithFocus = useCallback(() => {
    setExportMenuOpen(true);
    setTimeout(() => {
      if (exportFilenameInputRef.current) {
        exportFilenameInputRef.current.focus();
        exportFilenameInputRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 30);
  }, []);

  const handlePickFilenameForExport = useCallback(
    (file) => {
      if (!file?.filename) return;
      const rawName = String(file.filename);
      const stem = rawName.replace(/\.(mp4|webm)$/i, "");
      const targetFormat = String(
        file.format || (rawName.toLowerCase().endsWith(".webm") ? "webm" : "mp4")
      ).toLowerCase();
      const currentFormat = splitFormatCodec(renderPrefs.formatCodec).format;

      setOutputFilenameStem(stem || currentEpisode?.id || "");
      setFilenameSanitizeNote("");
      if (targetFormat !== currentFormat) {
        updateRenderPrefs({
          formatCodec: targetFormat === "webm" ? "webm:vp9" : "mp4:h264",
        });
      }
      openExportMenuWithFocus();
    },
    [currentEpisode?.id, openExportMenuWithFocus, renderPrefs.formatCodec, updateRenderPrefs]
  );

  const handleCopyVideoPath = useCallback(
    async (file) => {
      if (!currentCourse || !currentEpisode || !file?.filename) return;
      const relPath = `${currentCourse.id}/episodes/${currentEpisode.id}/${file.filename}`;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(relPath);
        } else {
          const ta = document.createElement("textarea");
          ta.value = relPath;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        showToast(true, `📋 Đã sao chép đường dẫn: ${relPath}`);
      } catch (err) {
        showToast(false, `⚠️ Không thể sao chép đường dẫn: ${err.message}`);
      }
    },
    [currentCourse, currentEpisode, showToast]
  );

  const handleDeleteVideoFile = useCallback(
    async (file) => {
      if (!currentCourse || !currentEpisode || !file?.filename || deletingVideoFile) return;
      const confirmed = window.confirm(
        `Xóa vĩnh viễn file video "${file.filename}" khỏi thư mục ${currentCourse.id}/episodes/${currentEpisode.id}/?`
      );
      if (!confirmed) return;

      setDeletingVideoFile(file.filename);
      try {
        const res = await fetch("/api/episodes/video/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course: currentCourse.id,
            episode: currentEpisode.id,
            filename: file.filename,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (previewVideoFile?.filename === file.filename) {
          setPreviewVideoFile(null);
        }
        await fetchCourses();
        await fetchEvents(currentCourse.id);
        showToast(true, `🗑️ Đã xóa file video ${file.filename}.`);
      } catch (err) {
        showToast(false, `⚠️ Không thể xóa ${file.filename}: ${err.message}`);
      } finally {
        setDeletingVideoFile("");
      }
    },
    [currentCourse, currentEpisode, deletingVideoFile, fetchCourses, fetchEvents, previewVideoFile?.filename, showToast]
  );

  const handleActivateVoiceTrack = useCallback(
    async (profileId) => {
      if (!currentCourse || !currentEpisode || !profileId || voiceTrackBusy) return;
      if (profileId === activeVoiceTrackId) return;
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      setVoiceTrackBusy(true);
      try {
        const res = await fetch("/api/episodes/voice-track/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course: currentCourse.id,
            episode: currentEpisode.id,
            profile_id: profileId,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setTimingDraft(null);
        setTimingDraftDirty(false);
        virtualTimeRef.current = 0;
        setSceneTime(0);
        setAudioVersion((v) => v + 1);
        await fetchCourses();
        await fetchEvents(currentCourse.id);
        showToast(true, `🎙️ Đã chuyển sang track giọng "${profileId}" (0s switch).`);
      } catch (err) {
        showToast(false, `⚠️ Không thể đổi track giọng: ${err.message}`);
      } finally {
        setVoiceTrackBusy(false);
      }
    },
    [activeVoiceTrackId, currentCourse, currentEpisode, fetchCourses, fetchEvents, showToast, voiceTrackBusy]
  );

  const handleDeleteVoiceTrack = useCallback(
    async (profileId) => {
      if (!currentCourse || !currentEpisode || !profileId || voiceTrackBusy) return;
      if (!window.confirm(`Xóa track giọng đọc "${profileId}" và các file audio của track này?`)) {
        return;
      }
      setVoiceTrackBusy(true);
      try {
        const res = await fetch("/api/episodes/voice-track/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course: currentCourse.id,
            episode: currentEpisode.id,
            profile_id: profileId,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        await fetchCourses();
        await fetchEvents(currentCourse.id);
        showToast(true, `🗑️ Đã xóa track giọng "${profileId}".`);
      } catch (err) {
        showToast(false, `⚠️ Không thể xóa track giọng: ${err.message}`);
      } finally {
        setVoiceTrackBusy(false);
      }
    },
    [currentCourse, currentEpisode, fetchCourses, fetchEvents, showToast, voiceTrackBusy]
  );

  const handleCalibrateStepStart = useCallback(
    (item) => {
      if (!currentScene || !item) return;
      const dur = Math.max(0.1, currentSceneDuration || 24);
      const p = clamp01(sceneTime / dur);
      const baseVd =
        timingDraft && timingDraft.sceneId === currentScene.id && timingDraft.visualData
          ? timingDraft.visualData
          : currentScene.visual_data;
      const updatedVd = applyPlayheadToVisualData(baseVd, item, p);
      setTimingDraft({ sceneId: currentScene.id, visualData: updatedVd });
      setTimingDraftDirty(true);
    },
    [currentScene, currentSceneDuration, sceneTime, timingDraft]
  );

  const handleSaveTimings = useCallback(async () => {
    if (!currentCourse || !currentEpisode || !currentScene || timingSaving) return;
    const vd =
      timingDraft && timingDraft.sceneId === currentScene.id && timingDraft.visualData
        ? timingDraft.visualData
        : currentScene.visual_data;
    const timings = extractTimingsPayload(vd);
    setTimingSaving(true);
    try {
      const res = await fetch("/api/episodes/scene-timings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: currentCourse.id,
          episode: currentEpisode.id,
          scene_id: currentScene.id,
          action: "save",
          timings,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setTimingDraft(null);
      setTimingDraftDirty(false);
      await fetchCourses();
      await fetchEvents(currentCourse.id);
      showToast(true, `💾 Đã lưu timing animation cho ${currentScene.id}.`);
    } catch (err) {
      showToast(false, `⚠️ Lỗi lưu timing: ${err.message}`);
    } finally {
      setTimingSaving(false);
    }
  }, [currentCourse, currentEpisode, currentScene, fetchCourses, fetchEvents, showToast, timingDraft, timingSaving]);

  const handleAutoAlignTimings = useCallback(async () => {
    if (!currentCourse || !currentEpisode || !currentScene || timingAutoAligning) return;
    setTimingAutoAligning(true);
    try {
      const res = await fetch("/api/episodes/scene-timings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: currentCourse.id,
          episode: currentEpisode.id,
          scene_id: currentScene.id,
          action: "auto_align",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setTimingDraft(null);
      setTimingDraftDirty(false);
      await fetchCourses();
      await fetchEvents(currentCourse.id);
      showToast(true, `⚡ Đã tự căn lại timing theo phụ đề cho ${currentScene.id}.`);
    } catch (err) {
      showToast(false, `⚠️ Không thể tự căn timing: ${err.message}`);
    } finally {
      setTimingAutoAligning(false);
    }
  }, [currentCourse, currentEpisode, currentScene, fetchCourses, fetchEvents, showToast, timingAutoAligning]);

  // Navigation handlers across the 3 screens
  const stopPlayback = () => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  };

  const handleNavigateToPlayer = useCallback((courseId, epId) => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    if (courseId) setSelectedCourseId(courseId);
    if (epId) setSelectedEpId(epId);
    pendingSceneIdRef.current = "";
    setExportSeekActive(false);
    virtualTimeRef.current = 0;
    setSceneIdx(0);
    setSceneTime(0);
    setExportStatus(null);
    setView("player");
  }, []);

  const openProjectsView = () => {
    stopPlayback();
    setView("projects");
  };

  const openRoadmapView = (courseId) => {
    stopPlayback();
    if (courseId) {
      setSelectedCourseId(courseId);
      const targetCourse = courses.find((c) => c.id === courseId);
      const firstPlayable = targetCourse?.episodes?.find((e) => e.has_script) || targetCourse?.episodes?.[0];
      if (firstPlayable) setSelectedEpId(firstPlayable.id);
    }
    setView("roadmap");
  };

  const openPlayerForEpisode = (epId, targetSceneId = "", targetTab = "scenes") => {
    stopPlayback();
    pendingSceneIdRef.current = targetSceneId || "";
    setSelectedEpId(epId);
    setActiveTab(targetTab || "scenes");
    setExportSeekActive(false);
    virtualTimeRef.current = 0;
    setSceneIdx(0);
    setSceneTime(0);
    setExportStatus(null);
    setView("player");
  };

  const openLatestPlayableEpisode = () => {
    const eps = (currentCourse?.episodes || []).filter((e) => Boolean(e.has_script));
    if (eps.length === 0) return;
    const latest = [...eps].sort((a, b) => (b.number || 0) - (a.number || 0))[0];
    openPlayerForEpisode(latest.id);
  };

  const activeSubtitle = useMemo(() => {
    const subs = currentScene?.subtitles || [];
    return subs.find((s) => sceneTime >= s.start_sec && sceneTime <= s.end_sec + 0.15) || null;
  }, [currentScene, sceneTime]);

  const subtitleSegments = useMemo(() => {
    if (!activeSubtitle?.text) return [];
    return parseSubtitleSegments(activeSubtitle.text, currentScene?.highlight_words || []);
  }, [activeSubtitle?.text, currentScene?.highlight_words]);

  const sceneProgress = currentScene
    ? Math.max(0, Math.min(1, sceneTime / Math.max(0.1, currentSceneDuration || 1)))
    : 0;

  const burstInfo = useMemo(
    () => getSceneBurstInfo(effectiveScene, sceneProgress, 1, 1, sceneIdx),
    [effectiveScene, sceneProgress, sceneIdx]
  );

  const particleTriggerKey = currentScene
    ? `${currentEpisode?.id || ""}:${currentScene.id}:${burstInfo.key}`
    : undefined;

  const sceneEnvelope = useMemo(() => {
    if (!currentScene) {
      return { opacity: 1, scale: 1, blurPx: 0, inBreather: false, isEntering: false, isExiting: false };
    }
    if (!isPlaying && sceneTime === 0 && !exportSeekActive) {
      return { opacity: 1, scale: 1, blurPx: 0, inBreather: false, isEntering: false, isExiting: false };
    }
    return computeSceneEnvelope(sceneTime, currentSceneDuration);
  }, [currentScene, isPlaying, sceneTime, exportSeekActive, currentSceneDuration]);

  const calibratableItems = useMemo(
    () =>
      effectiveScene
        ? extractCalibratableItems(effectiveScene.visual_type, effectiveScene.visual_data)
        : [],
    [effectiveScene]
  );

  if (loading) {
    return h("div", { className: "studio-loading" }, "Đang tải Tech Course Video Studio...");
  }

  // Screen 1: Project Dashboard
  if (view === "projects") {
    return h(ProjectDashboard, {
      courses,
      sseStatus,
      onOpenCourse: openRoadmapView,
      jobs: combinedJobs,
      onCancelJob: handleCancelJob,
      onClearFinishedJobs: handleClearFinishedJobs,
      onNavigateToPlayer: handleNavigateToPlayer,
      trayHighlightSignal,
    });
  }

  // Screen 2: Episode Roadmap & Live Monitor
  if (view === "roadmap" && currentCourse) {
    return h(
      React.Fragment,
      null,
      revisionToast
        ? h(
            "div",
            { className: `roadmap-toast studio-global-toast ${revisionToast.ok ? "is-ok" : "is-err"}` },
            revisionToast.msg
          )
        : null,
      h(EpisodeRoadmap, {
        course: currentCourse,
        events,
        sseStatus,
        onBack: openProjectsView,
        onOpenEpisode: openPlayerForEpisode,
        onOpenLatestEpisode: openLatestPlayableEpisode,
        onStateAction: handleStateAction,
        onRefreshCourses: fetchCourses,
        jobs: combinedJobs,
        aiJobs: aiJobsList,
        workerStatus,
        providersData,
        onProvidersLoaded: setProvidersData,
        onStartAiScript: handleStartAiScript,
        onResumeAiJob: handleResumeAiJob,
        pendingResumeJob,
        onClearPendingResume: () => setPendingResumeJob(null),
        renderPrefs,
        onCancelJob: handleCancelJob,
        onClearFinishedJobs: handleClearFinishedJobs,
        onNavigateToPlayer: handleNavigateToPlayer,
        trayHighlightSignal,
      })
    );
  }

  // Screen 3: Studio Player
  const epRevisions = currentEpisode?.state?.revisions || [];
  const openEpRevisions = epRevisions.filter(
    (r) => r.status === "open" || r.status === "in_progress"
  );
  const openRevCount = openEpRevisions.length;
  const openSceneRevCounts = {};
  for (const r of openEpRevisions) {
    if (r.scene_id) {
      openSceneRevCounts[r.scene_id] = (openSceneRevCounts[r.scene_id] || 0) + 1;
    }
  }
  const isEpStale = Boolean(currentEpisode?.state?.production?.stale);
  const activeEpVoice =
    activeVoiceTrackId ||
    currentEpisode?.state?.voice_override?.tts_profile ||
    currentEpisode?.tts_profile ||
    currentCourse?.meta?.tts_profile ||
    currentCourse?.meta?.tts_voice ||
    "edge-hoaimy";
  const voiceTrackEntries = Object.entries(voiceTracks);
  const epJobKey =
    currentCourse && currentEpisode ? `${currentCourse.id}:${currentEpisode.id}` : "";
  const activeEpJob = epJobKey ? jobsMap[epJobKey] || null : null;
  const isEpJobRunning = Boolean(
    activeEpJob && (activeEpJob.status === "queued" || activeEpJob.status === "running")
  );
  const activeFormatSpec = splitFormatCodec(renderPrefs.formatCodec);
  const renderSettingsSummary = formatRenderPrefsPill(renderPrefs, playbackRate);
  const epVideoFiles = Array.isArray(currentEpisode?.video_files) ? currentEpisode.video_files : [];
  const activeExt = activeFormatSpec.format === "webm" ? "webm" : "mp4";
  const resolvedOutputStem = resolveOutputFilenameStem(
    outputFilenameStem,
    currentEpisode?.id || "video"
  );
  const resolvedOutputFilename = `${resolvedOutputStem}.${activeExt}`;
  const collidingVideoFile =
    epVideoFiles.find(
      (f) => String(f?.filename || "").toLowerCase() === resolvedOutputFilename.toLowerCase()
    ) || null;
  const suggestedNextStem = collidingVideoFile
    ? suggestNextVideoFilenameStem(resolvedOutputStem, activeExt, epVideoFiles)
    : "";
  const isEpJobCompleted = Boolean(
    activeEpJob &&
      (activeEpJob.status === "completed" ||
        activeEpJob.status === "done" ||
        activeEpJob.status === "succeeded")
  );
  const activeEpJobPreviewFile =
    isEpJobCompleted && activeEpJob.mode !== "tts_only"
      ? activeEpJob.output_file
        ? epVideoFiles.find(
            (f) => String(f?.filename || "").toLowerCase() === String(activeEpJob.output_file).toLowerCase()
          ) || {
            filename: activeEpJob.output_file,
            format: String(activeEpJob.output_file).toLowerCase().endsWith(".webm") ? "webm" : "mp4",
            url: `/courses/${encodeURIComponent(activeEpJob.course)}/episodes/${encodeURIComponent(activeEpJob.episode)}/${encodeURIComponent(activeEpJob.output_file)}`,
          }
        : epVideoFiles[0] || null
      : null;

  return h(
    "div",
    { className: `studio-shell ${initialRoute.headless ? "is-headless" : ""}` },
    h("audio", { ref: audioRef, onEnded: handleAudioEnded, preload: "auto" }),

    // Top Navigation Bar
    h(
      "header",
      { className: "studio-topbar" },
      h(
        "div",
        { className: "roadmap-topbar-left" },
        h(
          "button",
          {
            type: "button",
            className: "btn-back",
            onClick: () => openRoadmapView(currentCourse?.id || selectedCourseId),
          },
          "← Danh sách Tập"
        ),
        h(
          "div",
          { className: "brand" },
          h("span", { className: "brand-logo" }, "▶"),
          h(
            "div",
            null,
            h("div", { className: "brand-title" }, "Tech Course Video Studio"),
            h("div", { className: "brand-sub" }, "Multi-Agent Interactive Video Engine (16:9 Full HD)")
          )
        ),
        openRevCount > 0
          ? h(
              "button",
              {
                type: "button",
                className: "player-status-badge is-revision",
                onClick: () => setActiveTab("revisions"),
                title: "Xem danh sách yêu cầu sửa đang mở",
              },
              `⚠️ Cần sửa (${openRevCount})`
            )
          : null,
        isEpStale
          ? h(
              "span",
              {
                className: "player-status-badge is-stale",
                title: currentEpisode?.state?.production?.stale_reason || "Kịch bản hoặc giọng đọc đã thay đổi, cần render lại video",
              },
              "🔄 Cần render lại"
            )
          : null
      ),
      h(
        "div",
        { className: "topbar-controls" },
        h(HeaderJobsTray, {
          jobs: combinedJobs,
          onCancelJob: handleCancelJob,
          onClearFinishedJobs: handleClearFinishedJobs,
          onNavigateToPlayer: handleNavigateToPlayer,
          onResumeAiJob: handleOpenResumeFromTray,
          highlightSignal: trayHighlightSignal,
        }),
        h(SseStatusBadge, { sseStatus }),
        h(
          "select",
          {
            className: "studio-select",
            value: selectedCourseId,
            onChange: (e) => {
              const cid = e.target.value;
              setSelectedCourseId(cid);
              const c = courses.find((x) => x.id === cid);
              const firstPlayable = c?.episodes?.find((ep) => ep.has_script) || c?.episodes?.[0];
              setSelectedEpId(firstPlayable?.id || "");
              setExportSeekActive(false);
              virtualTimeRef.current = 0;
              setSceneIdx(0);
              setSceneTime(0);
              setIsPlaying(false);
            },
          },
          ...courses.map((c) => h("option", { key: c.id, value: c.id }, `${c.id} — ${c.meta?.title || c.id}`))
        ),
        h(
          "select",
          {
            className: "studio-select",
            value: selectedEpId,
            onChange: (e) => {
              setSelectedEpId(e.target.value);
              setExportSeekActive(false);
              virtualTimeRef.current = 0;
              setSceneIdx(0);
              setSceneTime(0);
              setIsPlaying(false);
            },
          },
          ...(currentCourse?.episodes || []).map((ep) =>
            h(
              "option",
              { key: ep.id, value: ep.id, disabled: !ep.has_script },
              `Tập ${String(ep.number).padStart(2, "0")}: ${ep.title}${ep.has_script ? "" : " (Chưa có script)"}`
            )
          )
        ),
        currentEpisode
          ? h(
              "button",
              {
                type: "button",
                className: "btn-voice-pill",
                onClick: () => setVoiceModalOpen(true),
                title: "Chọn giọng đọc cho tập này hoặc nghe thử / thêm giọng mới",
              },
              `🎙️ ${activeEpVoice}`
            )
          : null,
        currentEpisode && voiceTrackEntries.length >= 1
          ? h(
              "div",
              {
                className: "voice-ab-switcher",
                role: "group",
                "aria-label": "Chuyển nhanh track giọng đọc (A/B Switcher)",
              },
              ...voiceTrackEntries.map(([trackId, track]) => {
                const isActiveTrack =
                  trackId === activeVoiceTrackId ||
                  (voiceTrackEntries.length === 1 && !activeVoiceTrackId);
                const shortLabel = formatShortVoiceLabel(trackId, track);
                const durSec = Math.round(Number(track?.total_duration_sec) || 0);
                return h(
                  "div",
                  {
                    key: trackId,
                    className: `voice-ab-chip ${isActiveTrack ? "is-active" : ""}`,
                  },
                  h(
                    "button",
                    {
                      type: "button",
                      className: `voice-ab-pill ${isActiveTrack ? "is-active" : ""}`,
                      disabled: voiceTrackBusy || isEpJobRunning,
                      onClick: () => handleActivateVoiceTrack(trackId),
                      title: isActiveTrack
                        ? `Track đang phát: ${track?.tts_profile || trackId} (${durSec}s)`
                        : `Chuyển ngay sang track "${track?.tts_profile || trackId}" (${durSec}s) — không cần tạo lại TTS`,
                    },
                    h("span", null, isActiveTrack ? `● ${shortLabel}` : shortLabel),
                    durSec > 0 ? h("span", { className: "voice-ab-dur" }, `${durSec}s`) : null
                  ),
                  voiceTrackEntries.length >= 2 && !isActiveTrack
                    ? h(
                        "button",
                        {
                          type: "button",
                          className: "voice-ab-del-btn",
                          disabled: voiceTrackBusy || isEpJobRunning,
                          onClick: (e) => {
                            e.stopPropagation();
                            handleDeleteVoiceTrack(trackId);
                          },
                          title: `Xóa track giọng "${trackId}"`,
                          "aria-label": `Xóa track giọng ${trackId}`,
                        },
                        "🗑️"
                      )
                    : null
                );
              })
            )
          : null,
        currentEpisode?.has_script
          ? h(
              "button",
              {
                type: "button",
                className: "btn-tts-direct",
                disabled: isEpJobRunning,
                onClick: () =>
                  handleRunProduction({
                    course: currentCourse.id,
                    episode: currentEpisode.id,
                    mode: "tts_only",
                    profile_id: activeEpVoice,
                  }),
                title: "Tạo lại file audio TTS ngay trên server",
              },
              isEpJobRunning && activeEpJob?.mode === "tts_only" ? "⏳ TTS..." : "🎙️ Tạo Audio (TTS)"
            )
          : null,

        // Unified Export Button + Popover Menu (Quality, TTS Toggle, CTA, Existing Video Download)
        h(
          "div",
          { className: "render-settings-wrap", ref: renderSettingsRef },
          h(
            "button",
            {
              type: "button",
              className: `btn-export-unified ${exportMenuOpen ? "is-open" : ""}`,
              disabled: !currentEpisode?.has_script && !currentEpisode?.has_video,
              onClick: () => setExportMenuOpen((v) => !v),
              "aria-expanded": exportMenuOpen,
              "aria-haspopup": "dialog",
              title: `Xuất Video (${renderSettingsSummary})`,
            },
            isEpJobRunning && activeEpJob?.mode !== "tts_only"
              ? "⏳ Đang xuất..."
              : "🎬 Xuất Video ▾"
          ),
          exportMenuOpen
            ? h(
                "div",
                {
                  className: "render-settings-popover export-menu-popover",
                  role: "dialog",
                  "aria-label": "Xuất Video & Cấu hình Render",
                },
                h(
                  "div",
                  { className: "render-pop-head" },
                  h(
                    "div",
                    null,
                    h("div", { className: "render-pop-title" }, "🎬 Xuất Video"),
                    h("div", { className: "render-settings-summary" }, renderSettingsSummary)
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "jobs-popover-close",
                      onClick: () => setExportMenuOpen(false),
                      "aria-label": "Đóng",
                    },
                    "✕"
                  )
                ),

                h(
                  "label",
                  { className: "export-tts-check-row" },
                  h("input", {
                    type: "checkbox",
                    checked: includeTtsBeforeExport,
                    onChange: (e) => setIncludeTtsBeforeExport(e.target.checked),
                  }),
                  h(
                    "span",
                    null,
                    "🎙️ Tạo lại Audio (TTS) cho giọng hiện tại trước khi xuất"
                  )
                ),

                h(
                  "div",
                  { className: "render-pop-group" },
                  h("div", { className: "render-pop-label" }, "Engine render"),
                  h(
                    "div",
                    { className: "render-pills-grid cols-2" },
                    ...ENGINE_OPTIONS.map((opt) =>
                      h(
                        "button",
                        {
                          key: opt.id,
                          type: "button",
                          className: `render-opt-pill ${renderPrefs.engine === opt.id ? "is-selected" : ""}`,
                          onClick: () => updateRenderPrefs({ engine: opt.id }),
                          title:
                            opt.id === "hyperframes"
                              ? "Biên dịch tập thành composition HyperFrames (HTML + GSAP) rồi render deterministic qua Chrome + WebCodecs"
                              : "Engine Canvas 2D cũ (window.__STUDIO_RENDER_OFFLINE__), giữ làm fallback",
                        },
                        opt.label
                      )
                    )
                  )
                ),

                h(
                  "div",
                  { className: "render-pop-group" },
                  h("div", { className: "render-pop-label" }, "Phần cứng mã hóa (Hardware)"),
                  h(
                    "div",
                    { className: "render-pills-grid cols-3" },
                    ...HARDWARE_OPTIONS.map((opt) =>
                      h(
                        "button",
                        {
                          key: opt.id,
                          type: "button",
                          className: `render-opt-pill ${renderPrefs.hardware === opt.id ? "is-selected" : ""}`,
                          onClick: () => updateRenderPrefs({ hardware: opt.id }),
                        },
                        opt.label
                      )
                    )
                  )
                ),

                h(
                  "div",
                  { className: "render-pop-group" },
                  h("div", { className: "render-pop-label" }, "Định dạng & Codec"),
                  h(
                    "div",
                    { className: "render-pills-grid cols-3" },
                    ...FORMAT_CODEC_OPTIONS.map((opt) =>
                      h(
                        "button",
                        {
                          key: opt.id,
                          type: "button",
                          className: `render-opt-pill ${renderPrefs.formatCodec === opt.id ? "is-selected" : ""}`,
                          onClick: () => updateRenderPrefs({ formatCodec: opt.id }),
                        },
                        opt.label
                      )
                    )
                  )
                ),

                h(
                  "div",
                  { className: "render-pop-group" },
                  h("div", { className: "render-pop-label" }, "Độ phân giải"),
                  h(
                    "div",
                    { className: "render-pills-grid cols-4" },
                    ...RESOLUTION_OPTIONS.map((opt) =>
                      h(
                        "button",
                        {
                          key: opt.id,
                          type: "button",
                          className: `render-opt-pill ${renderPrefs.resolution === opt.id ? "is-selected" : ""}`,
                          onClick: () => updateRenderPrefs({ resolution: opt.id }),
                        },
                        opt.label
                      )
                    )
                  )
                ),

                h(
                  "div",
                  { className: "render-pop-row-split" },
                  h(
                    "div",
                    { className: "render-pop-group" },
                    h("div", { className: "render-pop-label" }, "FPS"),
                    h(
                      "div",
                      { className: "render-pills-grid cols-3" },
                      ...FPS_OPTIONS.map((opt) =>
                        h(
                          "button",
                          {
                            key: opt.id,
                            type: "button",
                            className: `render-opt-pill ${renderPrefs.fps === opt.id ? "is-selected" : ""}`,
                            onClick: () => updateRenderPrefs({ fps: opt.id }),
                          },
                          opt.label
                        )
                      )
                    )
                  ),
                  h(
                    "div",
                    { className: "render-pop-group" },
                    h("div", { className: "render-pop-label" }, "Tốc độ (đồng bộ Player)"),
                    h(
                      "div",
                      { className: "render-pills-grid cols-4" },
                      ...SPEED_OPTIONS.map((rate) =>
                        h(
                          "button",
                          {
                            key: rate,
                            type: "button",
                            className: `render-opt-pill ${playbackRate === rate ? "is-selected" : ""}`,
                            onClick: () => setPlaybackRate(rate),
                          },
                          `${rate}x`
                        )
                      )
                    )
                  )
                ),

                h(
                  "div",
                  { className: "render-pop-group" },
                  h("div", { className: "render-pop-label" }, "Tên file đầu ra"),
                  h(
                    "div",
                    { className: "export-filename-wrap" },
                    h("input", {
                      ref: exportFilenameInputRef,
                      type: "text",
                      className: "export-filename-input",
                      value: outputFilenameStem,
                      placeholder: currentEpisode?.id || "ep01-video",
                      "aria-label": "Tên file đầu ra",
                      spellCheck: false,
                      onChange: (e) => {
                        const { stem, note } = sanitizeOutputFilenameInput(e.target.value);
                        setOutputFilenameStem(stem);
                        setFilenameSanitizeNote(note);
                      },
                    }),
                    h("span", { className: "export-filename-ext" }, `.${activeExt}`)
                  ),
                  !String(outputFilenameStem || "").trim()
                    ? h(
                        "div",
                        { className: "export-filename-helper" },
                        `Để trống sẽ tự dùng tên mặc định: ${currentEpisode?.id || "video"}.${activeExt}`
                      )
                    : null,
                  filenameSanitizeNote
                    ? h("div", { className: "export-filename-helper is-note" }, `ℹ️ ${filenameSanitizeNote}`)
                    : null,
                  collidingVideoFile
                    ? h(
                        "div",
                        { className: "export-collision-warn", role: "alert" },
                        h(
                          "div",
                          { className: "export-collision-text" },
                          `⚠️ File "${collidingVideoFile.filename}" đã tồn tại (${formatVideoFileSize(collidingVideoFile.size_bytes)}, ${formatVideoTimestamp(collidingVideoFile.modified_at)}) — nếu không đổi tên sẽ GHI ĐÈ lên file cũ`
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            className: "export-suggest-btn",
                            onClick: () => {
                              setOutputFilenameStem(suggestedNextStem);
                              setFilenameSanitizeNote("");
                            },
                          },
                          `✨ Đổi sang ${suggestedNextStem}.${activeExt}`
                        )
                      )
                    : h(
                        "div",
                        { className: "export-target-path" },
                        `📄 Sẽ lưu tại: ${currentCourse?.id || ""}/episodes/${currentEpisode?.id || ""}/${resolvedOutputFilename}`
                      )
                ),

                guardrailNote
                  ? h("div", { className: "render-guardrail-note" }, `ℹ️ ${guardrailNote}`)
                  : h(
                      "div",
                      { className: "render-compat-hint" },
                      "GPU encode hỗ trợ MP4 H.264 / HEVC; WebM VP9 & CPU mode dùng bộ mã hóa phần mềm."
                    ),

                h(
                  "div",
                  { className: "export-pop-actions" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: `export-cta-btn ${collidingVideoFile ? "is-overwrite" : ""}`,
                      disabled: !currentEpisode?.has_script || isEpJobRunning,
                      onClick: handleUnifiedExport,
                    },
                    isEpJobRunning
                      ? "⏳ Đang xử lý trên Server..."
                      : collidingVideoFile
                        ? `⚠️ Ghi đè "${resolvedOutputFilename}"`
                        : "🚀 Bắt đầu Xuất Video"
                  )
                )
              )
            : null
        )
      )
    ),

    revisionToast
      ? h(
          "div",
          { className: `roadmap-toast ${revisionToast.ok ? "is-ok" : "is-err"}` },
          revisionToast.msg
        )
      : null,

    // Main Content Grid: Left Video Stage + Right Knowledge Drawer
    h(
      "main",
      { className: "studio-main" },
      // Left Column: 16:9 Stage + Player Controls
      h(
        "section",
        { className: "stage-column" },
        currentScene
          ? h(
              "div",
              { className: "aspect-frame" },
              // Top 6px V2 Gradient Progress Bar (#2A62FF -> #10C0F0) at y=0
              h(
                "div",
                { className: "stage-top-progress", "aria-hidden": "true" },
                h("div", {
                  className: "stage-top-progress-fill",
                  style: { width: `${(globalProgress * 100).toFixed(3)}%` },
                })
              ),

              // Layer 0 Ambient Grid + Bokeh & Layer 2 Sparkle Confetti Burst
              h(ParticleStage, {
                triggerKey: particleTriggerKey,
                burstPoint: { x: burstInfo.nx, y: burstInfo.ny },
                isPlaying,
                timeSec: globalTime,
              }),

              // Stage Content Wrapper with Blur-to-Sharp Entrance, Exit Z-Recede, and Dark Breather
              h(
                "div",
                {
                  className: "stage-envelope-layer",
                  style: {
                    position: "absolute",
                    inset: 0,
                    zIndex: 5,
                    opacity: sceneEnvelope.opacity,
                    transform: `scale(${sceneEnvelope.scale.toFixed(4)})`,
                    filter: sceneEnvelope.blurPx > 0.05 ? `blur(${sceneEnvelope.blurPx.toFixed(2)}px)` : "none",
                    transformOrigin: "center center",
                    willChange: "opacity, transform, filter",
                    pointerEvents: sceneEnvelope.inBreather ? "none" : "auto",
                  },
                },
                // Stage Header Overlay
                h(
                  "div",
                  { className: "stage-header" },
                  h("span", { className: "stage-part-pill" }, currentScene.part_label || "Bài học"),
                  h("span", { className: "stage-scene-title" }, currentScene.title),
                  isStoryboardMode
                    ? h("span", { className: "storyboard-mode-pill" }, "🎬 Storyboard Preview")
                    : null,
                  h(
                    "span",
                    { className: "stage-ep-tag" },
                    `Cảnh ${sceneIdx + 1}/${scenes.length}`
                  )
                ),

                // Dynamic Visual Scene Component across all 7 templates
                h(SCENE_COMPONENTS[effectiveScene?.visual_type || currentScene.visual_type] || ArchitectureDiagram, {
                  scene: effectiveScene || currentScene,
                  progress: sceneProgress,
                })
              ),

              // Box-Free Floating V2 Subtitle Layer (Drop Shadow + Keyword Accent Coloring)
              activeSubtitle && subtitleSegments.length > 0
                ? h(
                    "div",
                    {
                      className: `stage-subtitle-wrap ${
                        currentEpisode?.script?.aspect_ratio === "9:16" ? "is-vertical" : ""
                      }`,
                    },
                    h(
                      "div",
                      { className: "stage-subtitle-text" },
                      ...subtitleSegments.map((seg, idx) =>
                        seg.accent
                          ? h("span", { key: idx, className: "sub-accent" }, seg.text)
                          : h(React.Fragment, { key: idx }, seg.text)
                      )
                    )
                  )
                : null
            )
          : h("div", { className: "empty-stage" }, "Tập này chưa có script.json để phát preview."),

        // Timeline & Playback Controls
        h(
          "div",
          { className: "player-bar" },
          h(
            "div",
            { className: "timeline-track", onClick: handleScrubGlobal, title: "Bấm để tua đến bất kỳ thời điểm nào" },
            ...sceneOffsets.map((off, idx) => {
              const widthPct = totalDuration ? (off.dur / totalDuration) * 100 : 0;
              const isPast = idx < sceneIdx;
              const isCurr = idx === sceneIdx;
              const fillPct = isPast ? 100 : isCurr ? sceneProgress * 100 : 0;
              return h(
                "div",
                {
                  key: idx,
                  className: `timeline-segment ${isCurr ? "is-active" : ""}`,
                  style: { width: `${widthPct}%` },
                  title: scenes[idx]?.title,
                },
                h("div", { className: "timeline-fill", style: { width: `${fillPct}%` } })
              );
            })
          ),

          h(
            "div",
            { className: "controls-row" },
            h(
              "div",
              { className: "controls-left" },
              h(
                "button",
                {
                  type: "button",
                  className: "ctrl-btn",
                  onClick: () => jumpToScene(sceneIdx - 1),
                  disabled: sceneIdx === 0,
                },
                "⏮ Cảnh trước"
              ),
              h(
                "button",
                { type: "button", className: "ctrl-btn ctrl-play", onClick: togglePlay, disabled: !currentScene },
                isPlaying ? "⏸ Tạm dừng" : isStoryboardMode ? "▶ Preview Storyboard" : "▶ Phát bài giảng"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ctrl-btn",
                  onClick: () => jumpToScene(sceneIdx + 1),
                  disabled: sceneIdx >= scenes.length - 1,
                },
                "Cảnh sau ⏭"
              ),
              h(
                "span",
                { className: "time-readout" },
                `${formatTime(globalTime)} / ${formatTime(totalDuration)}`
              )
            ),
            h(
              "div",
              { className: "controls-right" },
              ...SPEED_OPTIONS.map((rate) =>
                h(
                  "button",
                  {
                    key: rate,
                    type: "button",
                    className: `rate-btn ${playbackRate === rate ? "is-selected" : ""}`,
                    onClick: () => setPlaybackRate(rate),
                  },
                  `${rate}x`
                )
              )
            )
          ),

          exportStatus
            ? h(
                "div",
                { className: `export-banner is-${exportStatus.phase}` },
                h("span", null, exportStatus.label),
                exportStatus.percent > 0
                  ? h("span", { className: "export-pct" }, `${exportStatus.percent}%`)
                  : null
              )
            : null,

          activeEpJob
            ? h(
                "div",
                { className: `job-progress-banner is-${activeEpJob.status || "running"}` },
                h(
                  "div",
                  { className: "job-progress-top" },
                  h(
                    "span",
                    { className: "job-progress-title" },
                    `${formatJobModeTitle(activeEpJob.mode)} · ${activeEpJob.phase || activeEpJob.step || activeEpJob.status}${
                      activeEpJob.mode !== "tts_only" && activeEpJob.resolution
                        ? ` (${activeEpJob.resolution} · ${activeEpJob.fps || 60}fps · ${Number(activeEpJob.speed) || 1}x · ${String(activeEpJob.format || "mp4").toUpperCase()})`
                        : ""
                    }`
                  ),
                  h(
                    "div",
                    { className: "job-progress-right" },
                    h(
                      "span",
                      { className: "job-progress-pct" },
                      activeEpJob.progress !== undefined && activeEpJob.progress !== null
                        ? `${Math.round(activeEpJob.progress)}%`
                        : activeEpJob.status
                    ),
                    isEpJobRunning
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "job-act-btn is-cancel",
                            onClick: () => handleCancelJob(activeEpJob.id),
                          },
                          "✕ Hủy"
                        )
                      : null,
                    activeEpJob.output_file && isEpJobCompleted && activeEpJob.mode !== "tts_only"
                      ? h(
                          "span",
                          {
                            className: "job-saved-file-pill",
                            title: `${activeEpJob.course}/episodes/${activeEpJob.episode}/${activeEpJob.output_file}`,
                          },
                          `📁 ${activeEpJob.output_file}`
                        )
                      : null,
                    activeEpJobPreviewFile
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "job-act-btn is-watch",
                            onClick: () => setPreviewVideoFile(activeEpJobPreviewFile),
                          },
                          "▶ Xem thử"
                        )
                      : null
                  )
                ),
                (activeEpJob.error || activeEpJob.message || activeEpJob.logs?.[activeEpJob.logs.length - 1])
                  ? h(
                      "div",
                      { className: "job-progress-msg" },
                      activeEpJob.error ||
                        activeEpJob.message ||
                        activeEpJob.logs[activeEpJob.logs.length - 1]
                    )
                  : null,
                h(
                  "div",
                  { className: "job-progress-track" },
                  h("div", {
                    className: `job-progress-fill ${isEpJobRunning && !(activeEpJob.progress > 0) ? "is-indeterminate" : ""}`,
                    style: {
                      width:
                        activeEpJob.status === "completed" || activeEpJob.status === "done"
                          ? "100%"
                          : `${Math.max(6, Math.min(100, Number(activeEpJob.progress) || 35))}%`,
                    },
                  })
                )
              )
            : null
        ),

        // Existing Video Files Panel for this Lesson
        currentEpisode
          ? h(
              "div",
              { className: "ep-video-files-card" },
              h(
                "div",
                { className: "ep-video-files-head" },
                h(
                  "div",
                  { className: "ep-video-files-title" },
                  `📁 Video đã xuất (${epVideoFiles.length})`
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "ep-video-new-btn",
                    "data-export-trigger": "true",
                    disabled: !currentEpisode?.has_script,
                    onClick: openExportMenuWithFocus,
                  },
                  "+ Xuất bản mới"
                )
              ),
              epVideoFiles.length === 0
                ? h(
                    "div",
                    { className: "ep-video-files-empty" },
                    "Chưa có file video nào trong thư mục bài học. Bấm \"+ Xuất bản mới\" hoặc \"🎬 Xuất Video ▾\" để render và lưu trực tiếp tại đây."
                  )
                : h(
                    "div",
                    { className: "ep-video-files-list" },
                    ...epVideoFiles.map((file) => {
                      const fmtUpper = String(
                        file.format || (String(file.filename || "").toLowerCase().endsWith(".webm") ? "webm" : "mp4")
                      ).toUpperCase();
                      const isDeletingThis = deletingVideoFile === file.filename;
                      const previewUrl =
                        file.url ||
                        `/courses/${encodeURIComponent(currentCourse?.id || "")}/episodes/${encodeURIComponent(currentEpisode?.id || "")}/${encodeURIComponent(file.filename || "")}`;
                      return h(
                        "div",
                        { key: file.filename, className: "ep-video-file-row" },
                        h(
                          "div",
                          { className: "ep-video-file-info" },
                          h(
                            "div",
                            { className: "ep-video-file-main" },
                            h(
                              "span",
                              {
                                className: `ep-video-fmt-badge ${fmtUpper === "WEBM" ? "is-webm" : "is-mp4"}`,
                              },
                              fmtUpper
                            ),
                            h(
                              "span",
                              { className: "ep-video-file-name", title: file.filename },
                              file.filename
                            ),
                            file.is_default
                              ? h("span", { className: "ep-video-default-pill" }, "Mặc định")
                              : null
                          ),
                          h(
                            "div",
                            { className: "ep-video-file-meta" },
                            `${formatVideoFileSize(file.size_bytes)}${
                              file.modified_at ? ` · ${formatVideoTimestamp(file.modified_at)}` : ""
                            }`
                          )
                        ),
                        h(
                          "div",
                          { className: "ep-video-file-actions" },
                          h(
                            "button",
                            {
                              type: "button",
                              className: "ep-video-act-btn is-preview",
                              onClick: () => setPreviewVideoFile({ ...file, url: previewUrl }),
                              title: `Xem thử ${file.filename}`,
                            },
                            "▶ Xem thử"
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "ep-video-act-btn",
                              "data-export-trigger": "true",
                              onClick: () => handlePickFilenameForExport(file),
                              title: "Điền sẵn tên file này vào bảng Xuất Video",
                            },
                            "✏️ Chọn tên"
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "ep-video-act-btn",
                              onClick: () => handleCopyVideoPath(file),
                              title: `Sao chép ${currentCourse?.id}/episodes/${currentEpisode?.id}/${file.filename}`,
                            },
                            "📋 Copy path"
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "ep-video-act-btn is-danger",
                              disabled: Boolean(deletingVideoFile),
                              onClick: () => handleDeleteVideoFile(file),
                              title: `Xóa ${file.filename}`,
                            },
                            isDeletingThis ? "⏳" : "🗑️ Xóa"
                          )
                        )
                      );
                    })
                  )
            )
          : null
      ),

      // Right Column: Scene List / Cheat-Sheet Notes / Revisions / Course Curriculum
      h(
        "aside",
        { className: "drawer-column" },
        h(
          "div",
          { className: "drawer-tabs" },
          h(
            "button",
            {
              type: "button",
              className: `drawer-tab ${activeTab === "scenes" ? "is-active" : ""}`,
              onClick: () => setActiveTab("scenes"),
            },
            "🎬 Phân cảnh"
          ),
          h(
            "button",
            {
              type: "button",
              className: `drawer-tab ${activeTab === "notes" ? "is-active" : ""}`,
              onClick: () => setActiveTab("notes"),
            },
            "📝 Ghi chú"
          ),
          h(
            "button",
            {
              type: "button",
              className: `drawer-tab ${activeTab === "revisions" ? "is-active" : ""}`,
              onClick: () => setActiveTab("revisions"),
            },
            `🛠️ Sửa (${openRevCount})`
          ),
          h(
            "button",
            {
              type: "button",
              className: `drawer-tab ${activeTab === "curriculum" ? "is-active" : ""}`,
              onClick: () => setActiveTab("curriculum"),
            },
            "🗺️ Lộ trình"
          )
        ),

        h(
          "div",
          { className: "drawer-content" },
          activeTab === "scenes"
            ? h(
                "div",
                { className: "scenes-tab-wrap" },
                h(
                  "div",
                  { className: "scenes-list" },
                  ...scenes.map((sc, idx) => {
                    const scRevCount = openSceneRevCounts[sc.id] || 0;
                    return h(
                      "button",
                      {
                        key: sc.id,
                        type: "button",
                        className: `scene-item ${idx === sceneIdx ? "is-active" : ""}`,
                        onClick: () => jumpToScene(idx, true),
                      },
                      h(
                        "div",
                        { className: "scene-item-top" },
                        h("span", { className: "scene-item-num" }, `Cảnh ${idx + 1}`),
                        h(
                          "span",
                          { className: "scene-item-right-tags" },
                          scRevCount > 0
                            ? h("span", { className: "scene-rev-dot" }, `⚠️ ${scRevCount}`)
                            : null,
                          h("span", { className: "scene-item-dur" }, `${Math.round(sc.duration_sec || 24)}s`)
                        )
                      ),
                      h("div", { className: "scene-item-title" }, sc.title),
                      h("div", { className: "scene-item-part" }, sc.part_label)
                    );
                  })
                )
              )
            : activeTab === "notes"
              ? h("div", {
                  className: "md-body",
                  dangerouslySetInnerHTML: {
                    __html: renderMarkdownToHtml(currentEpisode?.notes || ""),
                  },
                })
              : activeTab === "revisions"
                ? h(RevisionPanel, {
                    mode: "episode",
                    courseId: currentCourse?.id || "",
                    episode: currentEpisode,
                    currentSceneId: currentScene?.id || "",
                    scenes: scenes.map((s, idx) => ({ id: s.id, title: s.title, index: idx })),
                    onOpenAiRewrite: () => {
                      setPlayerAiOptions({ initialMode: null, initialPauseAfter: null, startFrom: null });
                      setPlayerAiModalOpen(true);
                    },
                    onOpenScriptingStage: () => setPlayerStageModalOpen(true),
                    onJumpToTicket: (_epId, targetSceneId) => {
                      if (!targetSceneId) return;
                      const idx = scenes.findIndex((s) => s.id === targetSceneId);
                      if (idx >= 0) {
                        jumpToScene(idx, false);
                      }
                    },
                    onStateAction: handleStateAction,
                    onTriggerProduction: handleRunProduction,
                    activeJob: activeEpJob,
                  })
                : h("div", {
                    className: "md-body",
                    dangerouslySetInnerHTML: {
                      __html: renderMarkdownToHtml(currentCourse?.curriculum || ""),
                    },
                  })
        )
      )
    ),

    // Scripting 3-Stage Review Modal inside Studio Player
    h(ScriptingStageModal, {
      isOpen: playerStageModalOpen,
      course: currentCourse,
      episode: currentEpisode,
      onClose: () => setPlayerStageModalOpen(false),
      onSaved: async () => {
        await fetchCourses();
      },
      onContinueToStage: ({ startFrom, initialMode, initialPauseAfter }) => {
        setPlayerAiOptions({
          initialMode: initialMode || "three_stage",
          initialPauseAfter: initialPauseAfter || (startFrom === "visual" ? "none" : "dialogue"),
          startFrom: startFrom || null,
        });
        setPlayerAiModalOpen(true);
      },
    }),

    // AI Rewrite / Scripting Modal directly inside Studio Player
    h(AiScriptModal, {
      isOpen: playerAiModalOpen,
      mode: "single",
      course: currentCourse,
      targetEpisode: currentEpisode,
      initialMode: playerAiOptions.initialMode,
      initialPauseAfter: playerAiOptions.initialPauseAfter,
      startFrom: playerAiOptions.startFrom,
      providersData,
      onProvidersLoaded: setProvidersData,
      renderPrefs,
      onClose: () => {
        setPlayerAiModalOpen(false);
        setPlayerAiOptions({ initialMode: null, initialPauseAfter: null, startFrom: null });
      },
      onSubmitJob: async (payload) => {
        await handleStartAiScript(payload);
      },
      onManualCompleted: async (_data, epId) => {
        await fetchCourses();
        if (currentCourse?.id) await fetchEvents(currentCourse.id);
        setAudioVersion((v) => v + 1);
        showToast(true, `✅ Đã lưu kịch bản thủ công cho ${epId}.`);
      },
    }),

    // Voice Studio Modal (Episode Voice Picker & Direct TTS)
    h(VoiceStudioModal, {
      isOpen: voiceModalOpen,
      mode: "episode",
      course: currentCourse,
      episode: currentEpisode,
      script: currentEpisode?.script || null,
      onClose: () => setVoiceModalOpen(false),
      onAssigned: async (_data, info) => {
        await fetchCourses();
        if (currentCourse?.id) await fetchEvents(currentCourse.id);
        showToast(
          true,
          info?.assignToEpisode
            ? `Đã gán giọng "${info?.profile?.label || info?.profile?.id}" cho ${currentEpisode?.id}.`
            : `Đã đặt giọng mặc định khóa học: ${info?.profile?.label || info?.profile?.id}.`
        );
      },
      onRunProduction: handleRunProduction,
    }),

    // In-App Video Preview Modal
    previewVideoFile
      ? h(
          "div",
          {
            className: "studio-modal-backdrop ep-video-modal-backdrop",
            onClick: (e) => {
              if (e.target === e.currentTarget) setPreviewVideoFile(null);
            },
          },
          h(
            "div",
            {
              className: "studio-modal studio-modal-wide ep-video-preview-modal",
              role: "dialog",
              "aria-modal": "true",
              "aria-label": `Xem thử ${previewVideoFile.filename}`,
            },
            h(
              "div",
              { className: "studio-modal-header" },
              h(
                "div",
                null,
                h(
                  "h3",
                  { className: "studio-modal-title ep-video-modal-title" },
                  h(
                    "span",
                    {
                      className: `ep-video-fmt-badge ${
                        String(previewVideoFile.format || "").toLowerCase() === "webm" ||
                        String(previewVideoFile.filename || "").toLowerCase().endsWith(".webm")
                          ? "is-webm"
                          : "is-mp4"
                      }`,
                    },
                    String(
                      previewVideoFile.format ||
                        (String(previewVideoFile.filename || "").toLowerCase().endsWith(".webm")
                          ? "webm"
                          : "mp4")
                    ).toUpperCase()
                  ),
                  h("span", null, previewVideoFile.filename)
                ),
                h(
                  "div",
                  { className: "studio-modal-sub" },
                  `${currentCourse?.id || ""}/episodes/${currentEpisode?.id || ""}/${previewVideoFile.filename}${
                    previewVideoFile.size_bytes
                      ? ` · ${formatVideoFileSize(previewVideoFile.size_bytes)}`
                      : ""
                  }${
                    previewVideoFile.modified_at
                      ? ` · ${formatVideoTimestamp(previewVideoFile.modified_at)}`
                      : ""
                  }`
                )
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "studio-modal-close",
                  onClick: () => setPreviewVideoFile(null),
                  "aria-label": "Đóng xem thử",
                },
                "✕"
              )
            ),
            h(
              "div",
              { className: "studio-modal-body ep-video-modal-body" },
              h("video", {
                key: previewVideoFile.url || previewVideoFile.filename,
                className: "ep-video-preview-player",
                src:
                  previewVideoFile.url ||
                  `/courses/${encodeURIComponent(currentCourse?.id || "")}/episodes/${encodeURIComponent(currentEpisode?.id || "")}/${encodeURIComponent(previewVideoFile.filename || "")}`,
                controls: true,
                autoPlay: true,
                playsInline: true,
              })
            )
          )
        )
      : null
  );
}

createRoot(document.getElementById("root")).render(h(StudioApp));
