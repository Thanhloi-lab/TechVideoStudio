import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandHealthGrid, isProviderReady } from "./ai/BrandHealthGrid.mjs";

const h = React.createElement;

const FORMAT_CODEC_CHOICES = [
  { id: "mp4:h264", label: "MP4 · H.264", format: "mp4", codec: "h264" },
  { id: "mp4:hevc", label: "MP4 · HEVC", format: "mp4", codec: "hevc" },
  { id: "webm:vp9", label: "WebM · VP9", format: "webm", codec: "vp9" },
];

function isEpisodeScripted(ep) {
  if (!ep) return false;
  return Boolean(
    ep.has_script ||
      ep.state?.overall_status === "completed" ||
      ep.state?.scripting?.status === "completed"
  );
}

function getOpenRevisionSummary(ep) {
  const revs = ep?.state?.revisions || [];
  const open = revs.filter((r) => r.status === "open" || r.status === "in_progress");
  if (open.length === 0) return "";
  return open
    .map((r) => `[${r.id}${r.scene_id ? ` · ${r.scene_id}` : ""}] ${r.description || ""}`.trim())
    .join("\n");
}

function getPauseReasonLabel(reason) {
  if (reason === "quota_exhausted") return "Hết Quota / Giới hạn Rate Limit";
  if (reason === "server_interrupted") return "Server khởi động lại giữa chừng";
  if (reason === "error") return "Gặp lỗi khi gọi AI";
  return reason || "Tạm dừng";
}

export function AiScriptModal({
  isOpen,
  mode = "single",
  course,
  targetEpisode = null,
  initialSelectedIds = null,
  initialMode = null,
  initialPauseAfter = null,
  startFrom = null,
  resumeJob = null,
  providersData = null,
  onProvidersLoaded = null,
  renderPrefs = null,
  onClose,
  onSubmitJob,
  onResumeJob,
  onManualCompleted,
}) {
  const episodes = course?.episodes || [];

  const [localProvidersData, setLocalProvidersData] = useState(providersData);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [previousBrokenProviderId, setPreviousBrokenProviderId] = useState("");

  const [selectedIds, setSelectedIds] = useState([]);
  const [instructions, setInstructions] = useState("");
  const [sharedRewriteNote, setSharedRewriteNote] = useState("");
  const [epRewriteNotes, setEpRewriteNotes] = useState({});

  const [generationMode, setGenerationMode] = useState("three_stage");
  const [pauseAfter, setPauseAfter] = useState("dialogue");
  const [lockAudioSpine, setLockAudioSpine] = useState(false);

  const [autoProduce, setAutoProduce] = useState(false);
  const [voiceProfileId, setVoiceProfileId] = useState("");
  const [voices, setVoices] = useState([]);
  const [formatCodec, setFormatCodec] = useState(renderPrefs?.formatCodec || "mp4:h264");
  const [resolution, setResolution] = useState(renderPrefs?.resolution || "1080p");
  const [hardware, setHardware] = useState(renderPrefs?.hardware || "auto");
  const [fps, setFps] = useState(renderPrefs?.fps || 60);

  // Manual Web Mode state
  const [manualEpId, setManualEpId] = useState("");
  const [manualPromptText, setManualPromptText] = useState("");
  const [manualScriptText, setManualScriptText] = useState("");
  const [manualNotesText, setManualNotesText] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [copiedManualPrompt, setCopiedManualPrompt] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (providersData) setLocalProvidersData(providersData);
  }, [providersData]);

  const effectiveProvidersData = providersData || localProvidersData;
  const providersList = useMemo(() => {
    const arr = effectiveProvidersData?.providers || effectiveProvidersData?.brands || [];
    return Array.isArray(arr) ? arr : [];
  }, [effectiveProvidersData]);

  const applySelectionFromProvidersData = useCallback(
    (data, forceFallback = false) => {
      const list = data?.providers || data?.brands || [];
      if (!Array.isArray(list) || list.length === 0) return;

      const lastSel = data?.last_selection || null;
      const preferredId =
        mode === "resume" && resumeJob?.pause_reason === "quota_exhausted"
          ? ""
          : lastSel?.provider_id || resumeJob?.provider_id || "";

      if (preferredId) {
        const match = list.find((p) => p.id === preferredId);
        if (match && isProviderReady(match)) {
          setPreviousBrokenProviderId("");
          setSelectedProviderId(match.id);
          const models = Array.isArray(match.models) ? match.models : [];
          const wantModel = lastSel?.model || resumeJob?.model || "";
          const modelValid =
            wantModel &&
            (models.some((m) => (m.id || m) === wantModel) || match.allow_custom_model);
          setSelectedModel(modelValid ? wantModel : models[0]?.id || models[0] || "");
          return;
        }
        if (match && !isProviderReady(match)) {
          setPreviousBrokenProviderId(match.id);
        }
      } else if (mode === "resume" && resumeJob?.provider_id) {
        setPreviousBrokenProviderId(resumeJob.provider_id);
      } else {
        setPreviousBrokenProviderId("");
      }

      if (forceFallback || !selectedProviderId) {
        const firstReady =
          list.find((p) => isProviderReady(p) && p.id !== "manual_web") ||
          list.find((p) => isProviderReady(p));
        if (firstReady) {
          const models = Array.isArray(firstReady.models) ? firstReady.models : [];
          setSelectedProviderId(firstReady.id);
          setSelectedModel(models[0]?.id || models[0] || "");
        } else {
          setSelectedProviderId("");
          setSelectedModel("");
        }
      }
    },
    [mode, resumeJob?.pause_reason, resumeJob?.provider_id, resumeJob?.model, selectedProviderId]
  );

  // Reset modal state on open
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg("");
    setBusy(false);
    setManualPromptText("");
    setManualScriptText("");
    setManualNotesText("");
    setManualBusy(false);
    setCopiedManualPrompt(false);

    setVoiceProfileId(course?.tts_profile || "");
    setFormatCodec(renderPrefs?.formatCodec || "mp4:h264");
    setResolution(renderPrefs?.resolution || "1080p");
    setHardware(renderPrefs?.hardware || "auto");
    setFps(renderPrefs?.fps || 60);

    const nextGenMode = initialMode || "three_stage";
    const defaultPause =
      initialPauseAfter ||
      (startFrom === "visual" ? "none" : mode === "batch" ? "none" : "dialogue");
    setGenerationMode(nextGenMode);
    setPauseAfter(defaultPause);
    setLockAudioSpine(false);

    let nextIds = [];
    if (mode === "resume" && resumeJob) {
      const doneSet = new Set(resumeJob.completed_episodes || []);
      nextIds = (resumeJob.episode_ids || []).filter((id) => !doneSet.has(id));
      setInstructions(resumeJob.custom_instructions || "");
      setAutoProduce(Boolean(resumeJob.auto_produce));
      setSharedRewriteNote("");
    } else if (mode === "single" && targetEpisode) {
      nextIds = [targetEpisode.id];
      setInstructions("");
      setAutoProduce(
        nextGenMode === "three_stage" && defaultPause !== "none"
          ? false
          : Boolean(effectiveProvidersData?.last_selection?.auto_produce)
      );
      setSharedRewriteNote("");
    } else {
      if (Array.isArray(initialSelectedIds) && initialSelectedIds.length > 0) {
        nextIds = initialSelectedIds.filter((id) => episodes.some((e) => e.id === id));
      } else {
        nextIds = episodes
          .filter((e) => e.overall_status === "planned" || e.overall_status === "needs_revision")
          .slice(0, 3)
          .map((e) => e.id);
      }
      setInstructions("");
      setAutoProduce(
        nextGenMode === "three_stage" && defaultPause !== "none"
          ? false
          : Boolean(effectiveProvidersData?.last_selection?.auto_produce)
      );
      setSharedRewriteNote("");
    }

    setSelectedIds(nextIds);
    setManualEpId(nextIds[0] || targetEpisode?.id || episodes[0]?.id || "");

    // Prefill per-episode rewrite notes from open revisions (or previous job rewrite_notes)
    const prefilled = {};
    for (const ep of episodes) {
      const fromJob = resumeJob?.rewrite_notes?.[ep.id];
      const fromRevs = getOpenRevisionSummary(ep);
      if (fromJob) prefilled[ep.id] = fromJob;
      else if (fromRevs) prefilled[ep.id] = fromRevs;
    }
    setEpRewriteNotes(prefilled);

    // Fetch fresh providers snapshot
    let alive = true;
    fetch("/api/ai/providers")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d) return;
        setLocalProvidersData(d);
        onProvidersLoaded && onProvidersLoaded(d);
        applySelectionFromProvidersData(d, true);
      })
      .catch(() => {
        if (effectiveProvidersData) {
          applySelectionFromProvidersData(effectiveProvidersData, true);
        }
      });

    return () => {
      alive = false;
    };
  }, [isOpen, mode, course?.id, targetEpisode?.id, resumeJob?.id, initialMode, initialPauseAfter, startFrom]);

  useEffect(() => {
    if (!isOpen || !autoProduce || voices.length > 0) return;
    let alive = true;
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.ok && Array.isArray(d.profiles)) {
          setVoices(d.profiles);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isOpen, autoProduce, voices.length]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !busy && !manualBusy && onClose) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, busy, manualBusy, onClose]);

  const episodeMap = useMemo(() => {
    const m = new Map();
    for (const ep of episodes) m.set(ep.id, ep);
    return m;
  }, [episodes]);

  const selectedEpisodes = useMemo(
    () => selectedIds.map((id) => episodeMap.get(id)).filter(Boolean),
    [selectedIds, episodeMap]
  );

  const scriptedSelected = useMemo(
    () => selectedEpisodes.filter(isEpisodeScripted),
    [selectedEpisodes]
  );

  const hasAnyRewrite = scriptedSelected.length > 0;
  const hasRenderedRewrite = scriptedSelected.some(
    (ep) => ep.has_video || ep.has_audio || ep.state?.overall_status === "completed"
  );

  const missingRewriteNotes = useMemo(() => {
    if (!hasAnyRewrite) return false;
    const shared = sharedRewriteNote.trim();
    if (shared.length > 0) return false;
    return scriptedSelected.some((ep) => !(epRewriteNotes[ep.id] || "").trim());
  }, [hasAnyRewrite, sharedRewriteNote, scriptedSelected, epRewriteNotes]);

  if (!isOpen || !course) return null;

  const selectedProvider = providersList.find((p) => p.id === selectedProviderId) || null;
  const selectedProviderReady = isProviderReady(selectedProvider);
  const isManualWeb = selectedProviderId === "manual_web";
  const isBuiltinSelected = Boolean(
    selectedProviderId && selectedProviderId !== "antigravity" && selectedProviderId !== "manual_web"
  );
  const effectivePausedGate =
    isBuiltinSelected && generationMode === "three_stage" && pauseAfter !== "none";
  const mcpBatchLimitExceeded =
    selectedProviderId === "antigravity" && mode !== "resume" && selectedIds.length > 5;

  const toggleEpisode = (epId) => {
    setSelectedIds((prev) =>
      prev.includes(epId) ? prev.filter((id) => id !== epId) : [...prev, epId]
    );
  };

  const pickPreset = (filterFn, limit = Infinity) => {
    const picked = episodes.filter(filterFn).slice(0, limit).map((e) => e.id);
    setSelectedIds(picked);
  };

  const buildRewriteNotesPayload = () => {
    const map = {};
    const shared = sharedRewriteNote.trim();
    for (const ep of scriptedSelected) {
      const specific = (epRewriteNotes[ep.id] || "").trim();
      const note = specific || shared;
      if (note) map[ep.id] = note;
    }
    return map;
  };

  const handleGenerateManualPrompt = async () => {
    const epId = manualEpId || selectedIds[0] || targetEpisode?.id;
    if (!epId) {
      setErrorMsg("Vui lòng chọn tập để tạo Prompt Pack.");
      return;
    }
    const epObj = episodeMap.get(epId);
    const specificNote = (epRewriteNotes[epId] || "").trim() || sharedRewriteNote.trim();
    if (isEpisodeScripted(epObj) && !specificNote) {
      setErrorMsg("Vui lòng nhập ghi chú nội dung cần chỉnh sửa cho tập viết lại trước khi tạo Prompt.");
      return;
    }

    setManualBusy(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/ai/manual-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode_id: epId,
          custom_instructions: instructions.trim(),
          rewrite_note: specificNote,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setManualPromptText(data.full_prompt || data.prompt || data.prompt_text || "");
    } catch (err) {
      setErrorMsg(err.message || "Không thể tạo Prompt Pack.");
    } finally {
      setManualBusy(false);
    }
  };

  const handleCopyManualPrompt = async () => {
    if (!manualPromptText) return;
    try {
      await navigator.clipboard.writeText(manualPromptText);
      setCopiedManualPrompt(true);
      setTimeout(() => setCopiedManualPrompt(false), 1800);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const handleManualSubmit = async () => {
    const epId = manualEpId || selectedIds[0] || targetEpisode?.id;
    if (!epId) {
      setErrorMsg("Vui lòng chọn tập.");
      return;
    }
    if (!manualScriptText.trim()) {
      setErrorMsg("Vui lòng dán nội dung script.json vào ô bên dưới.");
      return;
    }
    setManualBusy(true);
    setErrorMsg("");
    try {
      let parsedScript = manualScriptText.trim();
      // Strip optional markdown code fences if user copied directly from ChatGPT/Claude
      const fenceMatch = parsedScript.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (fenceMatch) parsedScript = fenceMatch[1];

      const res = await fetch("/api/ai/manual-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode_id: epId,
          script_json: parsedScript,
          notes_md: manualNotesText.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        const errList = Array.isArray(data.errors) ? data.errors.join("; ") : "";
        throw new Error(errList || data.error || `HTTP ${res.status}`);
      }
      onManualCompleted && (await onManualCompleted(data, epId));
      onClose && onClose();
    } catch (err) {
      setErrorMsg(err.message || "Kịch bản JSON không hợp lệ.");
    } finally {
      setManualBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isManualWeb) return;

    if (!selectedProviderId || !selectedProviderReady) {
      setErrorMsg("Vui lòng chọn một Brand & Model AI đang sẵn sàng.");
      return;
    }
    if (mode !== "resume" && selectedIds.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất 1 tập để biên kịch.");
      return;
    }
    if (missingRewriteNotes) {
      setErrorMsg(
        "Vui lòng nhập yêu cầu chỉnh sửa (Rewrite Note) cho các tập đã có kịch bản để AI biết cần thay đổi gì."
      );
      return;
    }

    const rewriteNotesPayload = buildRewriteNotesPayload();
    const fc = FORMAT_CODEC_CHOICES.find((o) => o.id === formatCodec) || FORMAT_CODEC_CHOICES[0];
    let safeHardware = hardware;
    if (fc.codec === "vp9" && safeHardware === "gpu") safeHardware = "cpu";
    if (fc.codec === "hevc" && safeHardware === "cpu") safeHardware = "auto";

    setBusy(true);
    setErrorMsg("");
    try {
      if (mode === "resume" && resumeJob) {
        await onResumeJob({
          job_id: resumeJob.id,
          provider_id: selectedProviderId,
          model: selectedModel || undefined,
          execution_mode: selectedProviderId === "antigravity" ? "mcp" : "builtin",
          custom_instructions: instructions.trim() || undefined,
          rewrite_notes: Object.keys(rewriteNotesPayload).length > 0 ? rewriteNotesPayload : undefined,
        });
      } else {
        const effectiveAutoProduce = effectivePausedGate ? false : autoProduce;
        await onSubmitJob({
          type: mode === "single" && selectedIds.length === 1 ? "script_episode" : "script_batch",
          course: course.id,
          episode_ids: selectedIds,
          provider_id: selectedProviderId,
          model: selectedModel || undefined,
          execution_mode: selectedProviderId === "antigravity" ? "mcp" : "builtin",
          mode: isBuiltinSelected ? generationMode : "auto",
          pause_after:
            isBuiltinSelected && generationMode === "three_stage" ? pauseAfter : "none",
          start_from: isBuiltinSelected && startFrom ? startFrom : undefined,
          lock_audio_spine:
            isBuiltinSelected && generationMode === "three_stage" && pauseAfter === "none"
              ? Boolean(lockAudioSpine)
              : false,
          custom_instructions: instructions.trim(),
          rewrite_note: sharedRewriteNote.trim() || undefined,
          rewrite_notes: Object.keys(rewriteNotesPayload).length > 0 ? rewriteNotesPayload : undefined,
          auto_produce: effectiveAutoProduce,
          render_prefs: effectiveAutoProduce
            ? {
                mode: "tts_and_render",
                profile_id: voiceProfileId || null,
                format: fc.format,
                codec: fc.codec,
                hardware: safeHardware,
                resolution,
                fps: Number(fps) || 60,
                speed: 1,
              }
            : null,
        });
      }
      onClose && onClose();
    } catch (err) {
      setErrorMsg(err.message || "Không thể đẩy lệnh biên kịch.");
    } finally {
      setBusy(false);
    }
  };

  const modalTitle =
    mode === "resume"
      ? "▶ Tiếp tục Đợt Biên kịch Tạm dừng"
      : mode === "single"
        ? "✍️ Biên kịch / Chỉnh sửa Tập"
        : `✍️ Biên kịch Hàng loạt (${selectedIds.length} tập)`;

  const resumeDoneSet = new Set(resumeJob?.completed_episodes || []);
  const resumeAllIds = resumeJob?.episode_ids || [];

  return h(
    "div",
    {
      className: "studio-modal-backdrop",
      onClick: () => {
        if (!busy && !manualBusy && onClose) onClose();
      },
    },
    h(
      "div",
      {
        className: "studio-modal ai-script-modal ai-script-modal-wide",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "ai-script-modal-title",
        onClick: (e) => e.stopPropagation(),
      },
      h(
        "div",
        { className: "studio-modal-header" },
        h(
          "div",
          null,
          h("h2", { id: "ai-script-modal-title", className: "studio-modal-title" }, modalTitle),
          h(
            "div",
            { className: "studio-modal-sub" },
            mode === "resume" && resumeJob
              ? `${course.id} · Job ${resumeJob.id} · ${resumeDoneSet.size}/${resumeAllIds.length} tập đã xong`
              : mode === "single" && targetEpisode
                ? `${course.id} · Tập ${String(targetEpisode.number || 0).padStart(2, "0")}: ${targetEpisode.title}`
                : `${course.id} · ${course.meta?.title || course.title || ""} · Không giới hạn số tập`
          )
        ),
        h(
          "button",
          {
            type: "button",
            className: "studio-modal-close",
            onClick: () => !busy && !manualBusy && onClose && onClose(),
            disabled: busy || manualBusy,
            "aria-label": "Đóng",
          },
          "✕"
        )
      ),

      h(
        "form",
        { className: "studio-modal-body", onSubmit: handleSubmit },

        // Brand Health Grid (live provider selection + credentials + 1-token test)
        h(BrandHealthGrid, {
          providersData: effectiveProvidersData,
          onProvidersLoaded: (d) => {
            setLocalProvidersData(d);
            onProvidersLoaded && onProvidersLoaded(d);
          },
          selectedProviderId,
          selectedModel,
          previousBrokenProviderId,
          disabled: busy || manualBusy,
          compact: true,
          onSelectProvider: (pid, modelId) => {
            setSelectedProviderId(pid);
            setSelectedModel(modelId || "");
            setErrorMsg("");
          },
        }),

        // Resume Progress Checklist
        mode === "resume" && resumeJob
          ? h(
              "div",
              { className: "resume-job-box" },
              h(
                "div",
                { className: "resume-job-reason" },
                h("strong", null, `⚠️ Lý do tạm dừng: ${getPauseReasonLabel(resumeJob.pause_reason)}`),
                resumeJob.error
                  ? h("div", { className: "resume-job-err" }, resumeJob.error)
                  : null
              ),
              h(
                "div",
                { className: "resume-ep-chips" },
                ...resumeAllIds.map((epId) => {
                  const isDone = resumeDoneSet.has(epId);
                  const isFailedEp = resumeJob.failed_episode === epId;
                  return h(
                    "span",
                    {
                      key: epId,
                      className: `resume-ep-chip ${isDone ? "is-done" : isFailedEp ? "is-failed" : "is-pending"}`,
                    },
                    isDone ? `✅ ${epId}` : `⏳ ${epId}`
                  );
                })
              )
            )
          : null,

        // Batch Episode Selector (no 5-ep cap!)
        mode === "batch"
          ? h(
              "div",
              { className: "form-field" },
              h(
                "div",
                { className: "ai-batch-label-row" },
                h("label", { className: "form-label" }, `Chọn tập biên kịch (${selectedIds.length} tập)`),
                h(
                  "div",
                  { className: "ai-quick-picks" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ai-pick-btn",
                      onClick: () =>
                        pickPreset((e) => !isEpisodeScripted(e), 3),
                    },
                    "3 tập tiếp theo"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ai-pick-btn",
                      onClick: () =>
                        pickPreset((e) => !isEpisodeScripted(e), 5),
                    },
                    "5 tập tiếp theo"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ai-pick-btn",
                      onClick: () => pickPreset((e) => !isEpisodeScripted(e)),
                    },
                    "Tất cả chưa có KB"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ai-pick-btn",
                      onClick: () => setSelectedIds([]),
                    },
                    "Bỏ chọn"
                  )
                )
              ),
              h(
                "div",
                { className: "ai-ep-checklist" },
                ...episodes.map((ep) => {
                  const checked = selectedIds.includes(ep.id);
                  const scripted = isEpisodeScripted(ep);
                  const st = ep.state?.overall_status || (ep.has_video ? "completed" : ep.has_script ? "script_ready" : "planned");
                  return h(
                    "label",
                    {
                      key: ep.id,
                      className: `ai-ep-check-item ${checked ? "is-checked" : ""}`,
                    },
                    h("input", {
                      type: "checkbox",
                      checked,
                      disabled: busy || manualBusy,
                      onChange: () => toggleEpisode(ep.id),
                    }),
                    h("span", { className: "ai-ep-num" }, `Tập ${String(ep.number || 0).padStart(2, "0")}`),
                    h("span", { className: "ai-ep-title" }, ep.title || ep.id),
                    scripted
                      ? h("span", { className: "ai-ep-rewrite-tag" }, "🔄 Viết lại")
                      : null,
                    h("span", { className: `ai-ep-status is-${st}` }, st)
                  );
                })
              )
            )
          : null,

        // Rewrite Warning & Mandatory Rewrite Notes Box
        hasAnyRewrite
          ? h(
              "div",
              { className: "rewrite-notes-box" },
              h(
                "div",
                { className: "ai-rewrite-notice is-warning" },
                h(
                  "div",
                  null,
                  h("strong", null, `⚠️ Cảnh báo viết lại kịch bản (${scriptedSelected.length} tập đã có script.json): `),
                  hasRenderedRewrite
                    ? "Các tập đã có Audio/Video sau khi viết lại kịch bản mới sẽ tự động chuyển sang trạng thái "
                    : "AI sẽ đọc kịch bản hiện tại để chỉnh sửa đúng phần bạn yêu cầu. ",
                  hasRenderedRewrite
                    ? h("strong", null, "🔄 Cần render lại")
                    : null,
                  hasRenderedRewrite ? " (production.stale = true)." : null
                )
              ),
              h(
                "div",
                { className: "rewrite-shared-field" },
                h(
                  "label",
                  { htmlFor: "ai-shared-rewrite-note", className: "form-label" },
                  "📝 Yêu cầu chỉnh sửa bắt buộc (áp dụng chung hoặc nhập riêng cho từng tập bên dưới) *"
                ),
                h("textarea", {
                  id: "ai-shared-rewrite-note",
                  className: "studio-textarea",
                  rows: 2,
                  maxLength: 1500,
                  value: sharedRewriteNote,
                  onChange: (e) => setSharedRewriteNote(e.target.value),
                  placeholder:
                    "Ví dụ: Giữ nguyên cấu trúc 4 phần, rút ngắn cảnh 2 và bổ sung ví dụ CLI cụ thể + sơ đồ zone rõ hơn...",
                  disabled: busy || manualBusy,
                })
              ),
              scriptedSelected.length > 0
                ? h(
                    "div",
                    { className: "rewrite-per-ep-list" },
                    ...scriptedSelected.map((ep) =>
                      h(
                        "div",
                        { key: ep.id, className: "rewrite-per-ep-row" },
                        h(
                          "label",
                          { className: "rewrite-per-ep-label" },
                          `Tập ${String(ep.number || 0).padStart(2, "0")} (${ep.id}):`
                        ),
                        h("textarea", {
                          className: "studio-textarea rewrite-per-ep-input",
                          rows: 2,
                          value: epRewriteNotes[ep.id] || "",
                          onChange: (e) =>
                            setEpRewriteNotes((prev) => ({
                              ...prev,
                              [ep.id]: e.target.value,
                            })),
                          placeholder:
                            sharedRewriteNote.trim()
                              ? "Để trống sẽ dùng yêu cầu chung ở trên..."
                              : "Nhập phần cần sửa cho tập này (bắt buộc nếu ô chung trống)...",
                          disabled: busy || manualBusy,
                        })
                      )
                    )
                  )
                : null
            )
          : null,

        // Lesson-scoped custom instructions
        h(
          "div",
          { className: "form-field" },
          h(
            "label",
            { htmlFor: "ai-custom-instructions", className: "form-label" },
            "Yêu cầu trọng tâm kịch bản (tùy chọn — chỉ áp dụng vào nội dung bài học)"
          ),
          h("textarea", {
            id: "ai-custom-instructions",
            className: "studio-textarea",
            rows: 2,
            maxLength: 1200,
            value: instructions,
            onChange: (e) => setInstructions(e.target.value),
            placeholder:
              "Ví dụ: Nhấn mạnh ví dụ thực tế; dùng TimelineFlow cho luồng xử lý và ComparisonMatrix so sánh 2 kiến trúc...",
            disabled: busy || manualBusy,
          })
        ),

        isBuiltinSelected && mode !== "resume"
          ? h(
              "div",
              { className: "form-field ai-pipeline-stage-box" },
              startFrom
                ? h(
                    "div",
                    { className: "ai-stage-resume-banner" },
                    startFrom === "dialogue"
                      ? "▶ Tiếp tục từ Content Brief đã duyệt → Viết lời thoại & Beats (Tầng 2)"
                      : "▶ Tiếp tục từ Lời thoại đã chốt → Đạo diễn Visual & Component (Tầng 3)"
                  )
                : null,
              h(
                "div",
                { className: "ai-render-prefs-grid" },
                h(
                  "div",
                  null,
                  h("label", { className: "form-label-sm" }, "Quy trình biên kịch"),
                  h(
                    "select",
                    {
                      className: "studio-input studio-input-sm",
                      value: generationMode,
                      onChange: (e) => {
                        const nextM = e.target.value;
                        setGenerationMode(nextM);
                        if (nextM === "three_stage" && pauseAfter !== "none") {
                          setAutoProduce(false);
                        }
                      },
                      disabled: busy,
                    },
                    h("option", { value: "three_stage" }, "3 Tầng tách biệt (Brief → Thoại → Visual)"),
                    h("option", { value: "two_pass" }, "2-Pass (Storyboard → Compiler)"),
                    h("option", { value: "auto" }, "Tự động nhanh (auto)")
                  )
                ),
                generationMode === "three_stage"
                  ? h(
                      "div",
                      null,
                      h("label", { className: "form-label-sm" }, "Điểm dừng duyệt"),
                      h(
                        "select",
                        {
                          className: "studio-input studio-input-sm",
                          value: pauseAfter,
                          onChange: (e) => {
                            const nextP = e.target.value;
                            setPauseAfter(nextP);
                            if (nextP !== "none") setAutoProduce(false);
                          },
                          disabled: busy,
                        },
                        h("option", { value: "brief" }, "Dừng sau Brief (Duyệt dàn ý)"),
                        h("option", { value: "dialogue" }, "Dừng sau Lời thoại (Khuyến nghị)"),
                        h("option", { value: "none" }, "Chạy liền tới Visual (script.json)")
                      )
                    )
                  : null
              ),
              generationMode === "three_stage" && pauseAfter === "none"
                ? h(
                    "label",
                    { className: "ai-switch-row ai-spine-toggle" },
                    h("input", {
                      type: "checkbox",
                      checked: lockAudioSpine,
                      onChange: (e) => setLockAudioSpine(e.target.checked),
                      disabled: busy,
                    }),
                    h(
                      "span",
                      { className: "ai-switch-text" },
                      h("strong", null, "🔒 Khóa Audio-Spine (TTS từng beat) trước khi dựng Visual"),
                      h(
                        "small",
                        null,
                        "Tạo audio từng beat giữa Tầng 2 và Tầng 3 để đo thời lượng thật trước khi bố cục animation (tự bỏ qua nếu TTS offline)."
                      )
                    )
                  )
                : null
            )
          : null,

        // Manual Web Flow (when provider_id === "manual_web")
        isManualWeb
          ? h(
              "div",
              { className: "manual-web-box" },
              h(
                "div",
                { className: "manual-web-head" },
                h("strong", null, "🌐 Chế độ Web Thủ Công ($0 — ChatGPT / Claude / Gemini Web)"),
                selectedIds.length > 1
                  ? h(
                      "select",
                      {
                        className: "studio-input studio-input-sm",
                        value: manualEpId,
                        onChange: (e) => setManualEpId(e.target.value),
                      },
                      ...selectedEpisodes.map((ep) =>
                        h(
                          "option",
                          { key: ep.id, value: ep.id },
                          `Tập ${String(ep.number || 0).padStart(2, "0")}: ${ep.title || ep.id}`
                        )
                      )
                    )
                  : null
              ),
              h(
                "div",
                { className: "manual-web-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "btn-secondary btn-xs",
                    disabled: manualBusy,
                    onClick: handleGenerateManualPrompt,
                  },
                  manualBusy ? "⏳ Đang tạo Prompt..." : "📋 Tạo Prompt Pack"
                ),
                manualPromptText
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "btn-secondary btn-xs",
                        onClick: handleCopyManualPrompt,
                      },
                      copiedManualPrompt ? "✅ Đã copy Prompt" : "📋 Copy Prompt"
                    )
                  : null
              ),
              manualPromptText
                ? h("textarea", {
                    className: "studio-textarea manual-prompt-output",
                    rows: 4,
                    readOnly: true,
                    value: manualPromptText,
                  })
                : null,
              h(
                "div",
                { className: "form-field" },
                h("label", { className: "form-label-sm" }, "Dán script.json do AI Web trả về *"),
                h("textarea", {
                  className: "studio-textarea",
                  rows: 5,
                  value: manualScriptText,
                  onChange: (e) => setManualScriptText(e.target.value),
                  placeholder: '{"title":"...", "scenes":[...]}',
                  disabled: manualBusy,
                })
              ),
              h(
                "div",
                { className: "form-field" },
                h("label", { className: "form-label-sm" }, "Dán notes.md (tùy chọn)"),
                h("textarea", {
                  className: "studio-textarea",
                  rows: 2,
                  value: manualNotesText,
                  onChange: (e) => setManualNotesText(e.target.value),
                  placeholder: "# Ghi chú tóm tắt bài học...",
                  disabled: manualBusy,
                })
              )
            )
          : mode !== "resume" && !effectivePausedGate
            ? // Auto-produce Toggle (DEFAULT FALSE)
              h(
                "div",
                { className: "form-field ai-autoproduce-box" },
                h(
                  "label",
                  { className: "ai-switch-row" },
                  h("input", {
                    type: "checkbox",
                    checked: autoProduce,
                    onChange: (e) => setAutoProduce(e.target.checked),
                    disabled: busy,
                  }),
                  h(
                    "span",
                    { className: "ai-switch-text" },
                    h("strong", null, "🎬 Tự động chạy TTS & Render Video sau khi xong kịch bản"),
                    h(
                      "small",
                      null,
                      "Mặc định TẮT để dừng tại script_ready cho bạn duyệt Storyboard Preview trước khi sinh Audio/Video."
                    )
                  )
                ),
                autoProduce
                  ? h(
                      "div",
                      { className: "ai-render-prefs-grid" },
                      h(
                        "div",
                        null,
                        h("label", { className: "form-label-sm" }, "Giọng đọc TTS"),
                        h(
                          "select",
                          {
                            className: "studio-input studio-input-sm",
                            value: voiceProfileId,
                            onChange: (e) => setVoiceProfileId(e.target.value),
                            disabled: busy,
                          },
                          h("option", { value: "" }, `Mặc định khóa học (${course.tts_profile || course.meta?.tts_profile || "mặc định"})`),
                          ...voices.map((v) =>
                            h("option", { key: v.id, value: v.id }, `${v.label || v.id} (${v.provider})`)
                          )
                        )
                      ),
                      h(
                        "div",
                        null,
                        h("label", { className: "form-label-sm" }, "Định dạng"),
                        h(
                          "select",
                          {
                            className: "studio-input studio-input-sm",
                            value: formatCodec,
                            onChange: (e) => setFormatCodec(e.target.value),
                            disabled: busy,
                          },
                          ...FORMAT_CODEC_CHOICES.map((fc) =>
                            h("option", { key: fc.id, value: fc.id }, fc.label)
                          )
                        )
                      ),
                      h(
                        "div",
                        null,
                        h("label", { className: "form-label-sm" }, "Độ phân giải / FPS"),
                        h(
                          "div",
                          { className: "ai-dual-select" },
                          h(
                            "select",
                            {
                              className: "studio-input studio-input-sm",
                              value: resolution,
                              onChange: (e) => setResolution(e.target.value),
                              disabled: busy,
                            },
                            h("option", { value: "720p" }, "720p"),
                            h("option", { value: "1080p" }, "1080p FHD"),
                            h("option", { value: "1440p" }, "1440p 2K"),
                            h("option", { value: "2160p" }, "2160p 4K")
                          ),
                          h(
                            "select",
                            {
                              className: "studio-input studio-input-sm",
                              value: fps,
                              onChange: (e) => setFps(Number(e.target.value)),
                              disabled: busy,
                            },
                            h("option", { value: 24 }, "24fps"),
                            h("option", { value: 30 }, "30fps"),
                            h("option", { value: 60 }, "60fps")
                          )
                        )
                      )
                    )
                  : null
              )
            : null,

        mcpBatchLimitExceeded
          ? h(
              "div",
              { className: "brand-prev-warning" },
              `⚠️ Antigravity Worker giới hạn tối đa 5 tập/đợt (đang chọn ${selectedIds.length} tập). Hãy chọn Cloud API / Local AI để chạy hàng loạt không giới hạn, hoặc giảm số tập xuống ≤ 5.`
            )
          : null,

        errorMsg ? h("div", { className: "modal-error-banner" }, `⚠️ ${errorMsg}`) : null,

        h(
          "div",
          { className: "studio-modal-footer" },
          h(
            "button",
            {
              type: "button",
              className: "btn-secondary",
              onClick: () => !busy && !manualBusy && onClose && onClose(),
              disabled: busy || manualBusy,
            },
            "Hủy"
          ),
          isManualWeb
            ? h(
                "button",
                {
                  type: "button",
                  className: "btn-export",
                  disabled: manualBusy || !manualScriptText.trim(),
                  onClick: handleManualSubmit,
                },
                manualBusy ? "⏳ Đang kiểm tra & lưu..." : "✅ Kiểm tra & Lưu Kịch bản"
              )
            : h(
                "button",
                {
                  type: "submit",
                  className: "btn-export",
                  disabled:
                    busy ||
                    !selectedProviderId ||
                    !selectedProviderReady ||
                    mcpBatchLimitExceeded ||
                    (mode !== "resume" && selectedIds.length === 0) ||
                    missingRewriteNotes,
                },
                busy
                  ? "Đang gửi lệnh..."
                  : mode === "resume"
                    ? `▶ Tiếp tục (${selectedIds.length} tập còn lại)`
                    : `✍️ Gửi lệnh Biên kịch (${selectedIds.length} tập)`
              )
        )
      )
    )
  );
}
