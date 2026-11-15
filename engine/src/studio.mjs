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
import { RevisionModal } from "./components/RevisionModal.mjs";
import { RevisionPanel } from "./components/RevisionPanel.mjs";
import { VoiceStudioModal } from "./components/VoiceStudioModal.mjs";
import { ParticleStage } from "./motion/ParticleStage.mjs";
import { computeSceneEnvelope, getSceneBurstInfo, parseSubtitleSegments } from "./motion/kernel.mjs";
import { renderMarkdownToHtml } from "./markdown.mjs";
import { exportEpisodeVideo } from "./exporter.mjs";

const h = React.createElement;

const RENDER_PREFS_STORAGE_KEY = "videomaker.renderPrefs.v1";

const DEFAULT_RENDER_PREFS = {
  hardware: "auto",
  formatCodec: "mp4:h264",
  resolution: "1080p",
  fps: 60,
};

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
    hardware: HARDWARE_OPTIONS.some((o) => o.id === prev?.hardware) ? prev.hardware : DEFAULT_RENDER_PREFS.hardware,
    formatCodec: FORMAT_CODEC_OPTIONS.some((o) => o.id === prev?.formatCodec)
      ? prev.formatCodec
      : DEFAULT_RENDER_PREFS.formatCodec,
    resolution: RESOLUTION_OPTIONS.some((o) => o.id === prev?.resolution)
      ? prev.resolution
      : DEFAULT_RENDER_PREFS.resolution,
    fps: FPS_OPTIONS.some((o) => o.id === Number(prev?.fps)) ? Number(prev.fps) : DEFAULT_RENDER_PREFS.fps,
  };

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
    prefs: { hardware, formatCodec, resolution, fps },
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
  return `${resShort} · ${prefs.fps}fps · ${speed}x · ${hwShort} · ${fmtShort}`;
}

function formatJobModeTitle(mode) {
  if (mode === "tts_only") return "🎙️ Tạo Audio (TTS)";
  if (mode === "render_only") return "🎬 Xuất Video (Server)";
  return "🎬 Tạo Audio & Render Video";
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
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
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [jobsList, setJobsList] = useState([]);
  const [aiJobsList, setAiJobsList] = useState([]);
  const [workerStatus, setWorkerStatus] = useState({
    online: false,
    worker_count: 0,
    primary_worker: null,
    workers: [],
  });
  const [trayHighlightSignal, setTrayHighlightSignal] = useState(0);
  const [renderPrefs, setRenderPrefs] = useState(loadInitialRenderPrefs);
  const [renderSettingsOpen, setRenderSettingsOpen] = useState(false);
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
    if (!renderSettingsOpen) return undefined;
    const onMouseDown = (e) => {
      if (renderSettingsRef.current && !renderSettingsRef.current.contains(e.target)) {
        setRenderSettingsOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setRenderSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [renderSettingsOpen]);

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

  useEffect(() => {
    fetchCourses();
    fetchJobs();
    if (!initialRoute.headless) {
      fetchAiStatus();
      fetchAiJobs();
    }
  }, [fetchCourses, fetchJobs, fetchAiStatus, fetchAiJobs, initialRoute.headless]);

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

        const notifyKey = `ai:${job.id}:${job.status}`;
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
  }, [fetchCourses, fetchEvents, fetchJobs, fetchAiStatus, fetchAiJobs, initialRoute.headless, showToast, upsertJob, upsertAiJob]);

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

  const handleExport = async () => {
    if (!currentCourse || !currentEpisode) return;
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
    }
    try {
      setExportStatus({ phase: "starting", label: "Đang khởi tạo bộ xuất video...", percent: 2 });
      const res = await exportEpisodeVideo({
        courseId: currentCourse.id,
        episode: currentEpisode,
        onProgress: setExportStatus,
      });
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentEpisode.id}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setExportStatus({ phase: "error", label: `Lỗi xuất video: ${err.message}`, percent: 0 });
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
        showToast(
          true,
          `✍️ Đã gửi lệnh biên kịch ${epCount} tập cho Antigravity Worker (${
            data.worker_status?.primary_worker?.model || "Argon"
          }).`
        );
        return data;
      } catch (err) {
        showToast(false, `⚠️ ${err.message}`);
        throw err;
      }
    },
    [showToast, upsertAiJob]
  );

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

  const handleServerExport = useCallback(async () => {
    if (!currentCourse || !currentEpisode) return;
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
    }
    setExportStatus(null);
    const { format, codec } = splitFormatCodec(renderPrefs.formatCodec);
    try {
      await handleRunProduction({
        course: currentCourse.id,
        episode: currentEpisode.id,
        mode: "render_only",
        format,
        codec,
        hardware: renderPrefs.hardware,
        resolution: renderPrefs.resolution,
        fps: renderPrefs.fps,
        speed: playbackRate,
      });
    } catch {
      // Error toast is already surfaced by handleRunProduction
    }
  }, [currentCourse, currentEpisode, handleRunProduction, isPlaying, playbackRate, renderPrefs]);

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
    () => getSceneBurstInfo(currentScene, sceneProgress, 1, 1, sceneIdx),
    [currentScene, sceneProgress, sceneIdx]
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
    return h(EpisodeRoadmap, {
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
      onStartAiScript: handleStartAiScript,
      renderPrefs,
      onCancelJob: handleCancelJob,
      onClearFinishedJobs: handleClearFinishedJobs,
      onNavigateToPlayer: handleNavigateToPlayer,
      trayHighlightSignal,
    });
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
    currentEpisode?.state?.voice_override?.tts_profile ||
    currentEpisode?.tts_profile ||
    currentCourse?.meta?.tts_profile ||
    currentCourse?.meta?.tts_voice ||
    "edge-hoaimy";
  const epJobKey =
    currentCourse && currentEpisode ? `${currentCourse.id}:${currentEpisode.id}` : "";
  const activeEpJob = epJobKey ? jobsMap[epJobKey] || null : null;
  const isEpJobRunning = Boolean(
    activeEpJob && (activeEpJob.status === "queued" || activeEpJob.status === "running")
  );
  const activeFormatSpec = splitFormatCodec(renderPrefs.formatCodec);
  const renderSettingsSummary = formatRenderPrefsPill(renderPrefs, playbackRate);

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
                  }),
                title: "Tạo lại file audio TTS ngay trên server",
              },
              isEpJobRunning && activeEpJob?.mode === "tts_only" ? "⏳ TTS..." : "🎙️ Tạo Audio (TTS)"
            )
          : null,

        // Compact Render Settings Pill + Floating Popover
        h(
          "div",
          { className: "render-settings-wrap", ref: renderSettingsRef },
          h(
            "button",
            {
              type: "button",
              className: `btn-render-settings ${renderSettingsOpen ? "is-open" : ""}`,
              onClick: () => setRenderSettingsOpen((v) => !v),
              "aria-expanded": renderSettingsOpen,
              "aria-haspopup": "dialog",
              title: "Cấu hình xuất Video (Hardware / Định dạng / Độ phân giải / FPS / Tốc độ)",
            },
            h("span", null, "⚙️"),
            h("span", { className: "render-settings-summary" }, renderSettingsSummary)
          ),
          renderSettingsOpen
            ? h(
                "div",
                {
                  className: "render-settings-popover",
                  role: "dialog",
                  "aria-label": "Cấu hình Render Video",
                },
                h(
                  "div",
                  { className: "render-pop-head" },
                  h("span", { className: "render-pop-title" }, "Cấu hình Xuất Video"),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "jobs-popover-close",
                      onClick: () => setRenderSettingsOpen(false),
                      "aria-label": "Đóng",
                    },
                    "✕"
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

                guardrailNote
                  ? h("div", { className: "render-guardrail-note" }, `ℹ️ ${guardrailNote}`)
                  : h(
                      "div",
                      { className: "render-compat-hint" },
                      "GPU encode hỗ trợ MP4 H.264 / HEVC; WebM VP9 & CPU mode dùng bộ mã hóa phần mềm."
                    )
              )
            : null
        ),

        currentEpisode?.has_script
          ? h(
              "button",
              {
                type: "button",
                className: "btn-render-direct",
                disabled: isEpJobRunning,
                onClick: () =>
                  handleRunProduction({
                    course: currentCourse.id,
                    episode: currentEpisode.id,
                    mode: "tts_and_render",
                    format: activeFormatSpec.format,
                    codec: activeFormatSpec.codec,
                    hardware: renderPrefs.hardware,
                    resolution: renderPrefs.resolution,
                    fps: renderPrefs.fps,
                    speed: playbackRate,
                  }),
                title: `Chạy TTS + Render Video (${renderSettingsSummary}) trên server`,
              },
              isEpJobRunning && activeEpJob?.mode === "tts_and_render"
                ? "⏳ Rendering..."
                : "🎬 Tạo Audio & Render Video"
            )
          : null,
        (currentEpisode?.has_script || currentEpisode?.has_video)
          ? h(
              "button",
              {
                type: "button",
                className: "btn-revision-topbar",
                onClick: () => setRevisionModalOpen(true),
              },
              "⚠️ Yêu cầu sửa"
            )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "btn-export",
            onClick: handleServerExport,
            disabled: !currentEpisode?.has_script || isEpJobRunning,
            title: `Xuất Video ngầm trên Server (${renderSettingsSummary}) — đóng trình duyệt vẫn chạy tiếp`,
          },
          isEpJobRunning && activeEpJob?.mode === "render_only"
            ? "⏳ Đang xuất..."
            : `⬇ Xuất Video (.${activeFormatSpec.format})`
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
                h(SCENE_COMPONENTS[currentScene.visual_type] || ArchitectureDiagram, {
                  scene: currentScene,
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
                    (activeEpJob.status === "completed" || activeEpJob.status === "done" || activeEpJob.status === "succeeded") &&
                    (activeEpJob.output_file || activeEpJob.mode !== "tts_only")
                      ? h(
                          "a",
                          {
                            className: "job-act-btn is-download",
                            href: `/api/download-video?${new URLSearchParams({
                              course: activeEpJob.course,
                              ep: activeEpJob.episode,
                              file: activeEpJob.output_file || `${activeEpJob.episode}.${activeEpJob.format || "mp4"}`,
                            }).toString()}`,
                            download: activeEpJob.output_file || `${activeEpJob.episode}.${activeEpJob.format || "mp4"}`,
                          },
                          "⬇ Tải về"
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
        )
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
                    onJumpToTicket: (_epId, targetSceneId) => {
                      if (!targetSceneId) return;
                      const idx = scenes.findIndex((s) => s.id === targetSceneId);
                      if (idx >= 0) {
                        jumpToScene(idx, false);
                      }
                    },
                    onStateAction: handleStateAction,
                    onTriggerProduction: handleRunProduction,
                    onCreateRevision: () => setRevisionModalOpen(true),
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

    // Revision Ticket Modal (Pre-selects currently playing scene)
    h(RevisionModal, {
      isOpen: revisionModalOpen,
      courseId: currentCourse?.id || "",
      episode: currentEpisode,
      defaultSceneId: currentScene?.id || "",
      onClose: () => setRevisionModalOpen(false),
      onSubmitted: async (data) => {
        await fetchCourses();
        if (currentCourse?.id) await fetchEvents(currentCourse.id);
        setActiveTab("revisions");
        showToast(true, `Đã tạo ticket ${data?.ticket?.id || ""} cho ${currentEpisode?.id || "tập"}.`);
      },
    }),

    // Voice Studio Modal (Episode Voice Picker & Direct TTS)
    h(VoiceStudioModal, {
      isOpen: voiceModalOpen,
      mode: "episode",
      course: currentCourse,
      episode: currentEpisode,
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
    })
  );
}

createRoot(document.getElementById("root")).render(h(StudioApp));
