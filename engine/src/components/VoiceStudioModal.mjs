import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const h = React.createElement;

const PROVIDERS = [
  { id: "voicestudio", label: "VoiceStudio Local (OpenAI-compat)" },
  { id: "edge", label: "Microsoft Edge Neural TTS" },
  { id: "openai_compat", label: "OpenAI-Compatible API (/v1/audio/speech)" },
  { id: "custom_http", label: "Custom HTTP / JSON Adapter" },
  { id: "google", label: "Google Translate TTS (Dự phòng)" },
];

const DEFAULT_CUSTOM_FORM = {
  id: "",
  label: "",
  provider: "voicestudio",
  voice_id: "default",
  endpoint: "http://localhost:8000/v1/audio/speech",
  rate: "1.0",
  pitch: "+0Hz",
  headers_env: "",
  response_format: "mp3",
  audio_json_field: "",
  payload_template: "",
  sample_text: "Xin chào, đây là giọng đọc tùy chỉnh cho khóa học kỹ thuật.",
};

export function VoiceStudioModal({
  isOpen,
  mode = "course", // "course" | "episode"
  course,
  episode = null,
  onClose,
  onAssigned,
  onRunProduction,
}) {
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [defaultProfileId, setDefaultProfileId] = useState("edge-hoaimy");
  const [voicestudioUrl, setVoicestudioUrl] = useState("http://localhost:8000");
  const [profiles, setProfiles] = useState([]);
  const [discovered, setDiscovered] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [sampleText, setSampleText] = useState(
    "Xin chào, hôm nay chúng ta sẽ cùng khám phá kiến trúc hệ thống thực chiến."
  );
  const [previewBusyId, setPreviewBusyId] = useState("");
  const [previewState, setPreviewState] = useState(null); // { url, provider, profileId }
  const [showAddForm, setShowAddForm] = useState(false);
  const [customForm, setCustomForm] = useState(DEFAULT_CUSTOM_FORM);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState(null); // { ok, msg }

  const previewAudioRef = useRef(null);

  const courseDefaultVoice = course?.meta?.tts_profile || course?.meta?.tts_voice || "";
  const episodeOverrideVoice =
    episode?.state?.voice_override?.tts_profile ||
    episode?.tts_profile ||
    "";
  const activeVoiceId =
    mode === "episode"
      ? episodeOverrideVoice || courseDefaultVoice || defaultProfileId
      : courseDefaultVoice || defaultProfileId;

  const loadVoices = useCallback(async (withDiscover = false) => {
    if (withDiscover) {
      setScanning(true);
    } else {
      setLoading(true);
    }
    try {
      const url = withDiscover ? "/api/voices?discover=1" : "/api/voices";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const list = data.profiles || [];
      setProfiles(list);
      setDefaultProfileId(data.default_profile || "edge-hoaimy");
      setVoicestudioUrl(data.voicestudio_base_url || "http://localhost:8000");
      if (data.discovered_voicestudio !== undefined) {
        setDiscovered(data.discovered_voicestudio);
      }
      setSelectedId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev;
        const preferred =
          (mode === "episode" ? episodeOverrideVoice : "") ||
          courseDefaultVoice ||
          data.default_profile ||
          list[0]?.id ||
          "";
        return list.some((p) => p.id === preferred) ? preferred : list[0]?.id || "";
      });
    } catch (err) {
      setFeedback({ ok: false, msg: `Không tải được danh sách giọng đọc: ${err.message}` });
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, [mode, courseDefaultVoice, episodeOverrideVoice]);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    setPreviewState(null);
    setShowAddForm(false);
    loadVoices(false);
  }, [isOpen, loadVoices]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !busyAction) {
        onClose && onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, busyAction, onClose]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedId) || null,
    [profiles, selectedId]
  );

  if (!isOpen) return null;

  const handlePreview = async (profile) => {
    const target = profile || selectedProfile;
    if (!target || previewBusyId) return;
    setSelectedId(target.id);
    setPreviewBusyId(target.id);
    setFeedback(null);
    try {
      const textToSpeak = (sampleText || target.sample_text || "").trim() ||
        "Xin chào, đây là giọng đọc thử nghiệm từ Tech Course Video Studio.";
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: target.id,
          text: textToSpeak,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const cacheBustUrl = `${data.audio_url}${data.audio_url.includes("?") ? "&" : "?"}t=${Date.now()}`;
      setPreviewState({
        url: cacheBustUrl,
        provider: data.provider_used || target.provider,
        profileId: target.id,
        label: target.label || target.id,
      });
      setTimeout(() => {
        if (previewAudioRef.current) {
          previewAudioRef.current.load();
          previewAudioRef.current.play().catch(() => {});
        }
      }, 40);
    } catch (err) {
      setFeedback({ ok: false, msg: `Lỗi nghe thử "${target.id}": ${err.message}` });
    } finally {
      setPreviewBusyId("");
    }
  };

  const handleAssign = async (assignToEpisode = false, runMode = null) => {
    if (!selectedProfile || !course || busyAction) return;
    setBusyAction(runMode || (assignToEpisode ? "assign-ep" : "assign-course"));
    setFeedback(null);
    try {
      const payload = {
        course: course.id,
        profile_id: selectedProfile.id,
      };
      if (assignToEpisode && episode) {
        payload.episode = episode.id;
      }
      const res = await fetch("/api/voices/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onAssigned && (await onAssigned(data, { assignToEpisode, profile: selectedProfile }));
      if (runMode && onRunProduction && episode) {
        await onRunProduction({
          course: course.id,
          episode: episode.id,
          mode: runMode,
          profile_id: selectedProfile.id,
          format: "webm",
        });
        onClose && onClose();
        return;
      }
      setFeedback({
        ok: true,
        msg: assignToEpisode && episode
          ? `Đã gán giọng "${selectedProfile.label || selectedProfile.id}" cho tập ${episode.id}.`
          : `Đã đặt "${selectedProfile.label || selectedProfile.id}" làm giọng mặc định cho khóa ${course.id}.`,
      });
    } catch (err) {
      setFeedback({ ok: false, msg: `Lỗi gán giọng đọc: ${err.message}` });
    } finally {
      setBusyAction("");
    }
  };

  const handleSetSystemDefault = async (e, profile) => {
    e.stopPropagation();
    if (busyAction) return;
    setBusyAction(`default:${profile.id}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "set_default", id: profile.id }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDefaultProfileId(profile.id);
      setFeedback({ ok: true, msg: `Đã đặt "${profile.id}" làm mặc định toàn hệ thống.` });
    } catch (err) {
      setFeedback({ ok: false, msg: `Lỗi đặt mặc định: ${err.message}` });
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteProfile = async (e, profile) => {
    e.stopPropagation();
    if (busyAction) return;
    setBusyAction(`delete:${profile.id}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "delete", id: profile.id }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await loadVoices(false);
      setFeedback({ ok: true, msg: `Đã xóa profile "${profile.id}".` });
    } catch (err) {
      setFeedback({ ok: false, msg: `Lỗi xóa profile: ${err.message}` });
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveCustomProfile = async (e) => {
    e.preventDefault();
    const id = customForm.id.trim().replace(/\s+/g, "-").toLowerCase();
    const label = customForm.label.trim() || id;
    if (!id) {
      setFeedback({ ok: false, msg: "Vui lòng nhập Profile ID (ví dụ: voicestudio-myvoice)." });
      return;
    }

    let parsedTemplate = undefined;
    if (customForm.payload_template.trim()) {
      try {
        parsedTemplate = JSON.parse(customForm.payload_template.trim());
      } catch {
        setFeedback({ ok: false, msg: "payload_template phải là JSON hợp lệ." });
        return;
      }
    }

    const profilePayload = {
      id,
      label,
      provider: customForm.provider,
      voice_id: customForm.voice_id.trim() || "default",
      rate: customForm.rate.trim() || "+0%",
      pitch: customForm.pitch.trim() || "+0Hz",
      language: "vi",
      response_format: customForm.response_format || "mp3",
      sample_text: customForm.sample_text.trim() || sampleText,
    };
    if (customForm.endpoint.trim()) {
      profilePayload.endpoint = customForm.endpoint.trim();
    }
    if (customForm.headers_env.trim()) {
      profilePayload.headers_env = customForm.headers_env.trim();
    }
    if (customForm.audio_json_field.trim()) {
      profilePayload.audio_json_field = customForm.audio_json_field.trim();
    }
    if (parsedTemplate !== undefined) {
      profilePayload.payload_template = parsedTemplate;
    }

    setBusyAction("save-custom");
    setFeedback(null);
    try {
      const res = await fetch("/api/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "upsert", profile: profilePayload }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await loadVoices(false);
      setSelectedId(id);
      setShowAddForm(false);
      setCustomForm(DEFAULT_CUSTOM_FORM);
      setFeedback({ ok: true, msg: `Đã lưu giọng đọc tùy chỉnh "${label}" (${id}).` });
    } catch (err) {
      setFeedback({ ok: false, msg: `Lỗi lưu giọng đọc: ${err.message}` });
    } finally {
      setBusyAction("");
    }
  };

  const prefillFromDiscovered = (voiceItem) => {
    const vid = typeof voiceItem === "string" ? voiceItem : voiceItem.id || voiceItem.voice_id || voiceItem.name;
    const vname = typeof voiceItem === "string" ? voiceItem : voiceItem.name || voiceItem.label || vid;
    const slug = `vs-${String(vid || "custom").toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
    setCustomForm({
      ...DEFAULT_CUSTOM_FORM,
      id: slug,
      label: `VoiceStudio · ${vname}`,
      provider: "voicestudio",
      voice_id: String(vid || "default"),
      endpoint: `${voicestudioUrl.replace(/\/+$/, "")}/v1/audio/speech`,
      rate: "1.0",
      pitch: "+0Hz",
    });
    setShowAddForm(true);
  };

  const discoveredVoices = discovered?.voices || [];

  return h(
    "div",
    {
      className: "studio-modal-backdrop",
      onClick: () => !busyAction && onClose && onClose(),
    },
    h(
      "div",
      {
        className: "studio-modal studio-modal-wide",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "voice-modal-title",
        onClick: (e) => e.stopPropagation(),
      },
      // Header
      h(
        "div",
        { className: "studio-modal-header" },
        h(
          "div",
          null,
          h(
            "h2",
            { id: "voice-modal-title", className: "studio-modal-title" },
            mode === "episode"
              ? "🎙️ Voice Studio — Chọn Giọng cho Tập"
              : "🎙️ Voice Studio — Giọng Đọc Mặc Định Khóa Học"
          ),
          h(
            "div",
            { className: "studio-modal-sub" },
            mode === "episode" && episode
              ? `${course?.id || ""} · Tập ${String(episode.number || 0).padStart(2, "0")}: ${episode.title || episode.id} (Đang dùng: ${activeVoiceId || "chưa đặt"})`
              : `${course?.id || ""} · ${course?.meta?.title || ""} (Mặc định khóa học: ${courseDefaultVoice || defaultProfileId})`
          )
        ),
        h(
          "button",
          {
            type: "button",
            className: "studio-modal-close",
            onClick: () => !busyAction && onClose && onClose(),
            disabled: Boolean(busyAction),
            "aria-label": "Đóng",
          },
          "✕"
        )
      ),

      h(
        "div",
        { className: "studio-modal-body" },
        // Action toolbar: Discover VoiceStudio + Toggle Add Custom Form
        h(
          "div",
          { className: "voice-toolbar" },
          h(
            "button",
            {
              type: "button",
              className: "btn-secondary",
              onClick: () => loadVoices(true),
              disabled: scanning || loading,
            },
            scanning ? "⏳ Đang quét VoiceStudio..." : "🔄 Quét VoiceStudio (localhost:8000)"
          ),
          h(
            "button",
            {
              type: "button",
              className: `btn-secondary ${showAddForm ? "is-active-toggle" : ""}`,
              onClick: () => setShowAddForm((v) => !v),
            },
            showAddForm ? "− Đóng form thêm giọng" : "➕ Thêm Giọng Tùy Chỉnh"
          )
        ),

        // Discovered VoiceStudio results banner
        discovered !== null
          ? h(
              "div",
              { className: `voice-discover-box ${discovered.reachable ? "is-online" : "is-offline"}` },
              discovered.reachable
                ? h(
                    "div",
                    null,
                    h(
                      "div",
                      { className: "voice-discover-head" },
                      `🟢 VoiceStudio đang chạy tại ${discovered.base_url || voicestudioUrl} · Tìm thấy ${discoveredVoices.length} giọng`
                    ),
                    discoveredVoices.length > 0
                      ? h(
                          "div",
                          { className: "voice-discover-chips" },
                          ...discoveredVoices.map((v, idx) => {
                            const name = typeof v === "string" ? v : v.name || v.label || v.id;
                            return h(
                              "button",
                              {
                                key: `${name}-${idx}`,
                                type: "button",
                                className: "voice-discover-chip",
                                onClick: () => prefillFromDiscovered(v),
                              },
                              `+ Thêm "${name}"`
                            );
                          })
                        )
                      : null
                  )
                : h(
                    "div",
                    { className: "voice-discover-head" },
                    `⚪ Chưa kết nối được VoiceStudio tại ${discovered.base_url || voicestudioUrl}. Bật VoiceStudio hoặc dùng Edge / Custom HTTP.`
                  )
            )
          : null,

        // Add Custom Voice Form
        showAddForm
          ? h(
              "form",
              { className: "voice-custom-form", onSubmit: handleSaveCustomProfile },
              h("div", { className: "voice-custom-title" }, "➕ Thêm / Cập nhật Giọng Đọc Tùy Chỉnh (voices.json)"),
              h(
                "div",
                { className: "voice-form-grid" },
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Profile ID *"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "vd: voicestudio-clone-1",
                    value: customForm.id,
                    onChange: (e) => setCustomForm((f) => ({ ...f, id: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Tên hiển thị *"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "vd: Giọng Clone Studio",
                    value: customForm.label,
                    onChange: (e) => setCustomForm((f) => ({ ...f, label: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Provider"),
                  h(
                    "select",
                    {
                      className: "studio-input",
                      value: customForm.provider,
                      onChange: (e) => setCustomForm((f) => ({ ...f, provider: e.target.value })),
                    },
                    ...PROVIDERS.map((p) => h("option", { key: p.id, value: p.id }, p.label))
                  )
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Voice ID"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "vd: default hoặc vi-VN-NamMinhNeural",
                    value: customForm.voice_id,
                    onChange: (e) => setCustomForm((f) => ({ ...f, voice_id: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field voice-col-span2" },
                  h("label", { className: "form-label" }, "Endpoint URL (VoiceStudio / OpenAI-compat / Custom HTTP)"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "http://localhost:8000/v1/audio/speech",
                    value: customForm.endpoint,
                    onChange: (e) => setCustomForm((f) => ({ ...f, endpoint: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Rate / Speed"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "+4% hoặc 1.0",
                    value: customForm.rate,
                    onChange: (e) => setCustomForm((f) => ({ ...f, rate: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Pitch"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "+0Hz hoặc -2Hz",
                    value: customForm.pitch,
                    onChange: (e) => setCustomForm((f) => ({ ...f, pitch: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Headers Env Var (tùy chọn)"),
                  h("input", {
                    type: "text",
                    className: "studio-input",
                    placeholder: "vd: ELEVENLABS_API_KEY",
                    value: customForm.headers_env,
                    onChange: (e) => setCustomForm((f) => ({ ...f, headers_env: e.target.value })),
                  })
                ),
                h(
                  "div",
                  { className: "form-field" },
                  h("label", { className: "form-label" }, "Response Format"),
                  h(
                    "select",
                    {
                      className: "studio-input",
                      value: customForm.response_format,
                      onChange: (e) => setCustomForm((f) => ({ ...f, response_format: e.target.value })),
                    },
                    h("option", { value: "mp3" }, "mp3"),
                    h("option", { value: "wav" }, "wav")
                  )
                ),
                customForm.provider === "custom_http"
                  ? h(
                      "div",
                      { className: "form-field" },
                      h("label", { className: "form-label" }, "Audio JSON Field (nếu trả JSON base64)"),
                      h("input", {
                        type: "text",
                        className: "studio-input",
                        placeholder: "vd: audio_base64",
                        value: customForm.audio_json_field,
                        onChange: (e) =>
                          setCustomForm((f) => ({ ...f, audio_json_field: e.target.value })),
                      })
                    )
                  : null,
                customForm.provider === "custom_http"
                  ? h(
                      "div",
                      { className: "form-field voice-col-span2" },
                      h("label", { className: "form-label" }, "Payload Template JSON (tùy chọn)"),
                      h("textarea", {
                        className: "studio-textarea",
                        rows: 2,
                        placeholder: '{"text": "{{text}}", "voice": "{{voice_id}}"}',
                        value: customForm.payload_template,
                        onChange: (e) =>
                          setCustomForm((f) => ({ ...f, payload_template: e.target.value })),
                      })
                    )
                  : null
              ),
              h(
                "div",
                { className: "voice-custom-actions" },
                h(
                  "button",
                  { type: "submit", className: "btn-export", disabled: busyAction === "save-custom" },
                  busyAction === "save-custom" ? "Đang lưu..." : "💾 Lưu vào Catalog"
                )
              )
            )
          : null,

        // Sample preview sentence + inline audio player
        h(
          "div",
          { className: "voice-preview-bar" },
          h(
            "div",
            { className: "voice-preview-input-row" },
            h("input", {
              type: "text",
              className: "studio-input",
              value: sampleText,
              onChange: (e) => setSampleText(e.target.value),
              placeholder: "Nhập câu mẫu để nghe thử giọng đọc...",
            }),
            h(
              "button",
              {
                type: "button",
                className: "btn-preview-sample",
                disabled: !selectedProfile || Boolean(previewBusyId),
                onClick: () => handlePreview(selectedProfile),
              },
              previewBusyId ? "⏳ Đang tạo mẫu..." : "🔊 Nghe thử mẫu"
            )
          ),
          previewState
            ? h(
                "div",
                { className: "voice-audio-player-wrap" },
                h(
                  "span",
                  { className: "voice-audio-label" },
                  `Đang phát: ${previewState.label} (${previewState.provider})`
                ),
                h("audio", {
                  ref: previewAudioRef,
                  controls: true,
                  src: previewState.url,
                  className: "voice-audio-el",
                })
              )
            : null
        ),

        // Catalog list
        loading
          ? h("div", { className: "empty-feed" }, "Đang tải catalog giọng đọc...")
          : h(
              "div",
              { className: "voice-catalog-grid" },
              ...profiles.map((p) => {
                const isSelected = p.id === selectedId;
                const isSysDefault = p.id === defaultProfileId;
                const isCourseActive = p.id === courseDefaultVoice;
                const isEpActive = mode === "episode" && p.id === episodeOverrideVoice;
                return h(
                  "div",
                  {
                    key: p.id,
                    className: `voice-card ${isSelected ? "is-selected" : ""}`,
                    onClick: () => setSelectedId(p.id),
                  },
                  h(
                    "div",
                    { className: "voice-card-top" },
                    h(
                      "div",
                      { className: "voice-card-title-row" },
                      h("span", { className: "voice-card-name" }, p.label || p.id),
                      h("span", { className: "voice-provider-badge" }, p.provider)
                    ),
                    h(
                      "div",
                      { className: "voice-card-badges" },
                      isEpActive
                        ? h("span", { className: "voice-flag is-ep" }, "Đang dùng (Tập)")
                        : null,
                      isCourseActive
                        ? h("span", { className: "voice-flag is-course" }, "Mặc định Khóa")
                        : null,
                      isSysDefault
                        ? h("span", { className: "voice-flag is-sys" }, "Hệ thống")
                        : null
                    )
                  ),
                  h(
                    "div",
                    { className: "voice-card-meta" },
                    h("span", null, `ID: ${p.id}`),
                    h("span", null, `Voice: ${p.voice_id}`),
                    p.rate ? h("span", null, `Rate: ${p.rate}`) : null,
                    p.pitch ? h("span", null, `Pitch: ${p.pitch}`) : null
                  ),
                  p.notes || p.endpoint
                    ? h("div", { className: "voice-card-notes" }, p.notes || p.endpoint)
                    : null,
                  h(
                    "div",
                    { className: "voice-card-actions" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "rev-act-btn is-jump",
                        disabled: Boolean(previewBusyId),
                        onClick: (e) => {
                          e.stopPropagation();
                          handlePreview(p);
                        },
                      },
                      previewBusyId === p.id ? "⏳ Đang tạo..." : "🔊 Nghe thử"
                    ),
                    !isSysDefault
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "rev-act-btn",
                            disabled: Boolean(busyAction),
                            onClick: (e) => handleSetSystemDefault(e, p),
                          },
                          "⭐ Mặc định HT"
                        )
                      : null,
                    !isSysDefault
                      ? h(
                          "button",
                          {
                            type: "button",
                            className: "rev-act-btn is-delete",
                            disabled: Boolean(busyAction),
                            onClick: (e) => handleDeleteProfile(e, p),
                          },
                          "🗑️"
                        )
                      : null
                  )
                );
              })
            ),

        feedback
          ? h(
              "div",
              { className: feedback.ok ? "modal-ok-banner" : "modal-error-banner" },
              feedback.ok ? `✅ ${feedback.msg}` : `⚠️ ${feedback.msg}`
            )
          : null
      ),

      // Footer
      h(
        "div",
        { className: "studio-modal-footer voice-modal-footer" },
        h(
          "button",
          {
            type: "button",
            className: "btn-secondary",
            onClick: () => !busyAction && onClose && onClose(),
            disabled: Boolean(busyAction),
          },
          "Đóng"
        ),
        mode === "episode" && episode
          ? h(
              "div",
              { className: "voice-footer-actions" },
              h(
                "button",
                {
                  type: "button",
                  className: "btn-secondary",
                  disabled: !selectedProfile || Boolean(busyAction),
                  onClick: () => handleAssign(false),
                },
                "🌐 Đặt mặc định Khóa học"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "btn-export",
                  disabled: !selectedProfile || Boolean(busyAction),
                  onClick: () => handleAssign(true),
                },
                busyAction === "assign-ep" ? "Đang áp dụng..." : "✅ Áp dụng cho Tập này"
              ),
              onRunProduction
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "btn-run-tts-direct",
                      disabled: !selectedProfile || Boolean(busyAction),
                      onClick: () => handleAssign(true, "tts_only"),
                    },
                    "🎙️ Áp dụng & Tạo Audio"
                  )
                : null
            )
          : h(
              "button",
              {
                type: "button",
                className: "btn-export",
                disabled: !selectedProfile || Boolean(busyAction),
                onClick: () => handleAssign(false),
              },
              busyAction === "assign-course"
                ? "Đang lưu..."
                : "Đặt làm mặc định Khóa học"
            )
      )
    )
  );
}
