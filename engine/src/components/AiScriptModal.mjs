import React, { useEffect, useMemo, useState } from "react";

const h = React.createElement;
const MAX_BATCH = 5;

const FORMAT_CODEC_CHOICES = [
  { id: "mp4:h264", label: "MP4 · H.264", format: "mp4", codec: "h264" },
  { id: "mp4:hevc", label: "MP4 · HEVC", format: "mp4", codec: "hevc" },
  { id: "webm:vp9", label: "WebM · VP9", format: "webm", codec: "vp9" },
];

export function AiScriptModal({
  isOpen,
  mode = "single",
  course,
  targetEpisode = null,
  workerStatus = null,
  renderPrefs = null,
  onClose,
  onSubmitJob,
}) {
  const episodes = course?.episodes || [];
  const eligibleEpisodes = useMemo(
    () => episodes.filter((ep) => ep.overall_status !== "completed" || ep.id === targetEpisode?.id),
    [episodes, targetEpisode?.id]
  );

  const [selectedIds, setSelectedIds] = useState([]);
  const [instructions, setInstructions] = useState("");
  const [autoProduce, setAutoProduce] = useState(false);
  const [voiceProfileId, setVoiceProfileId] = useState("");
  const [voices, setVoices] = useState([]);
  const [formatCodec, setFormatCodec] = useState(renderPrefs?.formatCodec || "mp4:h264");
  const [resolution, setResolution] = useState(renderPrefs?.resolution || "1080p");
  const [hardware, setHardware] = useState(renderPrefs?.hardware || "auto");
  const [fps, setFps] = useState(renderPrefs?.fps || 60);
  const [busy, setBusy] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg("");
    setBusy(false);
    setAutoProduce(false);
    setInstructions("");
    setVoiceProfileId(course?.tts_profile || "");
    setFormatCodec(renderPrefs?.formatCodec || "mp4:h264");
    setResolution(renderPrefs?.resolution || "1080p");
    setHardware(renderPrefs?.hardware || "auto");
    setFps(renderPrefs?.fps || 60);

    if (mode === "single" && targetEpisode) {
      setSelectedIds([targetEpisode.id]);
    } else {
      const next = (course?.episodes || [])
        .filter((e) => e.overall_status === "planned" || e.overall_status === "needs_revision")
        .slice(0, 3)
        .map((e) => e.id);
      setSelectedIds(next);
    }
  }, [isOpen, mode, course?.id, course?.tts_profile, targetEpisode?.id]);

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
      if (e.key === "Escape" && !busy && onClose) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen || !course) return null;

  const workerOnline = Boolean(workerStatus?.online);
  const primaryWorker = workerStatus?.primary_worker;

  const toggleEpisode = (epId) => {
    setSelectedIds((prev) => {
      if (prev.includes(epId)) return prev.filter((id) => id !== epId);
      if (prev.length >= MAX_BATCH) return prev;
      return [...prev, epId];
    });
  };

  const pickPreset = (filterFn, limit) => {
    const picked = episodes.filter(filterFn).slice(0, limit).map((e) => e.id);
    setSelectedIds(picked);
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText("Bật VideoMaker Worker");
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workerOnline) {
      setErrorMsg('Antigravity Worker chưa online. Hãy mở chat Argon và gõ "Bật VideoMaker Worker".');
      return;
    }
    if (selectedIds.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất 1 tập để biên kịch.");
      return;
    }

    const fc = FORMAT_CODEC_CHOICES.find((o) => o.id === formatCodec) || FORMAT_CODEC_CHOICES[0];
    let safeHardware = hardware;
    if (fc.codec === "vp9" && safeHardware === "gpu") safeHardware = "cpu";
    if (fc.codec === "hevc" && safeHardware === "cpu") safeHardware = "auto";

    setBusy(true);
    setErrorMsg("");
    try {
      await onSubmitJob({
        type: mode === "single" && selectedIds.length === 1 ? "script_episode" : "script_batch",
        course: course.id,
        episode_ids: selectedIds,
        custom_instructions: instructions.trim(),
        auto_produce: autoProduce,
        render_prefs: autoProduce
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
      onClose && onClose();
    } catch (err) {
      setErrorMsg(err.message || "Không thể đẩy lệnh biên kịch.");
    } finally {
      setBusy(false);
    }
  };

  return h(
    "div",
    {
      className: "studio-modal-backdrop",
      onClick: () => {
        if (!busy && onClose) onClose();
      },
    },
    h(
      "div",
      {
        className: "studio-modal ai-script-modal",
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
          h(
            "h2",
            { id: "ai-script-modal-title", className: "studio-modal-title" },
            mode === "single" ? "✍️ Biên kịch Tập (AI Argon)" : "✍️ Biên kịch Đợt (3–5 Tập · AI Argon)"
          ),
          h(
            "div",
            { className: "studio-modal-sub" },
            mode === "single" && targetEpisode
              ? `${course.id} · Tập ${String(targetEpisode.number || 0).padStart(2, "0")}: ${targetEpisode.title}`
              : `${course.id} · ${course.title || ""} · Giới hạn an toàn tối đa ${MAX_BATCH} tập/đợt`
          )
        ),
        h(
          "button",
          {
            type: "button",
            className: "studio-modal-close",
            onClick: () => !busy && onClose && onClose(),
            disabled: busy,
            "aria-label": "Đóng",
          },
          "✕"
        )
      ),

      h(
        "form",
        { className: "studio-modal-body", onSubmit: handleSubmit },
        // Worker Connection Gate Banner
        workerOnline
          ? h(
              "div",
              { className: "ai-worker-online-bar" },
              h("span", { className: "ai-dot is-online" }),
              h(
                "span",
                null,
                `Worker trực tuyến: `,
                h("strong", null, primaryWorker?.model || "Gemini 4 Argon"),
                primaryWorker?.worker_id ? ` (${primaryWorker.worker_id})` : ""
              )
            )
          : h(
              "div",
              { className: "modal-error-banner ai-offline-gate" },
              h(
                "div",
                { className: "ai-offline-gate-text" },
                h("strong", null, "🔴 Worker Offline: "),
                "Chưa có phiên Antigravity Worker nào kết nối. Hãy mở chat Antigravity (model Gemini 4 Argon) và gửi lệnh:"
              ),
              h(
                "div",
                { className: "ai-offline-cmd-row" },
                h("code", null, "Bật VideoMaker Worker"),
                h(
                  "button",
                  { type: "button", className: "btn-secondary btn-xs", onClick: handleCopyCommand },
                  copiedCmd ? "✅ Đã copy" : "📋 Copy lệnh"
                )
              )
            ),

        // Episode selector (batch) or summary chip (single)
        mode === "batch"
          ? h(
              "div",
              { className: "form-field" },
              h(
                "div",
                { className: "ai-batch-label-row" },
                h("label", { className: "form-label" }, `Chọn tập biên kịch (${selectedIds.length}/${MAX_BATCH})`),
                h(
                  "div",
                  { className: "ai-quick-picks" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ai-pick-btn",
                      onClick: () =>
                        pickPreset((e) => e.overall_status === "planned" || e.overall_status === "needs_revision", 3),
                    },
                    "3 tập tiếp theo"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ai-pick-btn",
                      onClick: () =>
                        pickPreset((e) => e.overall_status === "planned" || e.overall_status === "needs_revision", 5),
                    },
                    "5 tập tiếp theo"
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
                ...eligibleEpisodes.map((ep) => {
                  const checked = selectedIds.includes(ep.id);
                  const disabledCheck = !checked && selectedIds.length >= MAX_BATCH;
                  return h(
                    "label",
                    {
                      key: ep.id,
                      className: `ai-ep-check-item ${checked ? "is-checked" : ""} ${disabledCheck ? "is-disabled" : ""}`,
                    },
                    h("input", {
                      type: "checkbox",
                      checked,
                      disabled: busy || disabledCheck,
                      onChange: () => toggleEpisode(ep.id),
                    }),
                    h("span", { className: "ai-ep-num" }, `Tập ${String(ep.number || 0).padStart(2, "0")}`),
                    h("span", { className: "ai-ep-title" }, ep.title || ep.id),
                    h("span", { className: `ai-ep-status is-${ep.overall_status}` }, ep.overall_status)
                  );
                })
              )
            )
          : targetEpisode?.has_script
            ? h(
                "div",
                { className: "ai-rewrite-notice" },
                "🔄 Tập này đã có ",
                h("code", null, "script.json"),
                ". AI sẽ biên tập/cập nhật lại kịch bản và giữ nguyên an toàn bài học."
              )
            : null,

        // Lesson-scoped instructions
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
            rows: 3,
            maxLength: 1200,
            value: instructions,
            onChange: (e) => setInstructions(e.target.value),
            placeholder:
              "Ví dụ: Nhấn mạnh ví dụ cross-account AssumeRole; dùng TimelineFlow cho luồng token và ComparisonMatrix so sánh IAM Role vs Access Key...",
            disabled: busy,
          })
        ),

        // Auto-produce Toggle (DEFAULT FALSE)
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
                    h("option", { value: "" }, `Mặc định khóa học (${course.tts_profile || "mặc định"})`),
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
                    ...FORMAT_CODEC_CHOICES.map((fc) => h("option", { key: fc.id, value: fc.id }, fc.label))
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
        ),

        errorMsg ? h("div", { className: "modal-error-banner" }, `⚠️ ${errorMsg}`) : null,

        h(
          "div",
          { className: "studio-modal-footer" },
          h(
            "button",
            {
              type: "button",
              className: "btn-secondary",
              onClick: () => !busy && onClose && onClose(),
              disabled: busy,
            },
            "Hủy"
          ),
          h(
            "button",
            {
              type: "submit",
              className: "btn-export",
              disabled: busy || !workerOnline || selectedIds.length === 0,
            },
            busy
              ? "Đang gửi lệnh..."
              : `✍️ Gửi lệnh Biên kịch (${selectedIds.length} tập)`
          )
        )
      )
    )
  );
}
