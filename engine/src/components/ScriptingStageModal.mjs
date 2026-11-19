import React, { useEffect, useState } from "react";

const h = React.createElement;

const PART_OPTIONS = [
  { id: "problem", label: "problem (Bài toán)" },
  { id: "architecture", label: "architecture (Kiến trúc)" },
  { id: "setup", label: "setup (Thực hành)" },
  { id: "exam_tips", label: "exam_tips (Bẫy / Tổng kết)" },
];

export function ScriptingStageModal({
  isOpen,
  course,
  episode,
  onClose,
  onSaved,
  onContinueToStage,
}) {
  const [activeTab, setActiveTab] = useState("brief");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const [brief, setBrief] = useState(null);
  const [dialogue, setDialogue] = useState(null);
  const [audioSpine, setAudioSpine] = useState(null);
  const [notesMd, setNotesMd] = useState("");

  useEffect(() => {
    if (!isOpen || !course?.id || !episode?.id) return;
    let alive = true;
    setLoading(true);
    setErrorMsg("");
    setStatusMsg("");
    const phase = episode?.scripting_phase || episode?.state?.scripting?.phase || "";
    if (phase === "dialogue_ready") setActiveTab("dialogue");
    else if (phase === "audio_spine_ready") setActiveTab("audio_spine");
    else if (episode?.has_dialogue && !episode?.has_brief) setActiveTab("dialogue");
    else setActiveTab("brief");

    fetch(
      `/api/episodes/scripting-artifacts?course=${encodeURIComponent(course.id)}&episode=${encodeURIComponent(episode.id)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d?.ok) {
          setErrorMsg(d?.error || "Không tải được dữ liệu biên kịch.");
          return;
        }
        setBrief(d.brief || null);
        setDialogue(d.dialogue || null);
        setAudioSpine(d.audio_spine || null);
        setNotesMd(d.notes || "");
        if (!d.brief && d.dialogue) setActiveTab("dialogue");
      })
      .catch((err) => {
        if (alive) setErrorMsg(err?.message || "Lỗi kết nối tải dữ liệu.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [isOpen, course?.id, episode?.id]);

  if (!isOpen || !course || !episode) return null;

  const updateBriefField = (section, key, val) => {
    setBrief((prev) => {
      if (!prev) return prev;
      if (!section) return { ...prev, [key]: val };
      return {
        ...prev,
        [section]: {
          ...(prev[section] || {}),
          [key]: val,
        },
      };
    });
  };

  const updateBriefBeat = (idx, key, val) => {
    setBrief((prev) => {
      if (!prev || !Array.isArray(prev.teaching_beats)) return prev;
      const nextBeats = prev.teaching_beats.map((b, i) => (i === idx ? { ...b, [key]: val } : b));
      return { ...prev, teaching_beats: nextBeats };
    });
  };

  const updateDialogueBeat = (idx, key, val) => {
    setDialogue((prev) => {
      if (!prev || !Array.isArray(prev.beats)) return prev;
      const nextBeats = prev.beats.map((b, i) => (i === idx ? { ...b, [key]: val } : b));
      return { ...prev, beats: nextBeats };
    });
  };

  const handleSaveBrief = async () => {
    if (!brief) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await fetch("/api/episodes/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: course.id, episode: episode.id, brief }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBrief(data.brief || brief);
      setStatusMsg("✅ Đã lưu Content Brief.");
      onSaved && (await onSaved("brief"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể lưu Brief.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDialogue = async () => {
    if (!dialogue) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await fetch("/api/episodes/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          dialogue,
          notes_md: notesMd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDialogue(data.dialogue || dialogue);
      setStatusMsg("✅ Đã lưu Lời thoại & Ghi chú.");
      onSaved && (await onSaved("dialogue"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể lưu Lời thoại.");
    } finally {
      setBusy(false);
    }
  };

  const handleLockAudioSpine = async () => {
    if (!dialogue) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      // Save latest dialogue edits first before locking audio durations
      const saveRes = await fetch("/api/episodes/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          dialogue,
          notes_md: notesMd,
        }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || !saveData.ok) {
        throw new Error(saveData.error || `Không lưu được Dialogue (HTTP ${saveRes.status})`);
      }

      const res = await fetch("/api/episodes/audio-spine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: course.id, episode: episode.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Audio-Spine failed (HTTP ${res.status})`);
      }
      setAudioSpine(data.audio_spine || null);
      setActiveTab("audio_spine");
      setStatusMsg(
        `🔒 Đã khóa Audio-Spine (${data.audio_spine?.beats?.length || 0} beats · ${((data.audio_spine?.total_duration_ms || 0) / 1000).toFixed(2)}s).`
      );
      onSaved && (await onSaved("audio_spine"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể khóa Audio-Spine TTS.");
    } finally {
      setBusy(false);
    }
  };

  return h(
    "div",
    {
      className: "studio-modal-backdrop",
      onClick: (e) => {
        if (e.target === e.currentTarget && !busy) onClose && onClose();
      },
    },
    h(
      "div",
      {
        className: "studio-modal studio-modal-wide scripting-stage-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": `Duyệt kịch bản 3 tầng — ${episode.title || episode.id}`,
      },
      h(
        "div",
        { className: "studio-modal-head" },
        h(
          "div",
          null,
          h("h3", null, `📝 Duyệt Kịch bản Tách lớp — Tập ${String(episode.number || 0).padStart(2, "0")}`),
          h("p", { className: "modal-sub" }, episode.title || episode.id)
        ),
        h(
          "button",
          {
            type: "button",
            className: "studio-modal-close",
            onClick: () => !busy && onClose && onClose(),
            disabled: busy,
          },
          "✕"
        )
      ),

      h(
        "div",
        { className: "scripting-stage-tabs" },
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "brief" ? "is-active" : ""}`,
            onClick: () => setActiveTab("brief"),
          },
          `1. Brief (Nội dung & Hook)${brief ? " ✓" : ""}`
        ),
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "dialogue" ? "is-active" : ""}`,
            onClick: () => setActiveTab("dialogue"),
          },
          `2. Lời thoại & Dual-Text${dialogue ? " ✓" : ""}`
        ),
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "audio_spine" ? "is-active" : ""}`,
            onClick: () => setActiveTab("audio_spine"),
          },
          `3. Audio-Spine${audioSpine ? " 🔒" : ""}`
        )
      ),

      h(
        "div",
        { className: "studio-modal-body scripting-stage-body" },
        loading
          ? h("div", { className: "empty-feed" }, "⏳ Đang tải dữ liệu Brief & Lời thoại...")
          : activeTab === "brief"
            ? !brief
              ? h("div", { className: "empty-feed" }, "Chưa có brief.json. Hãy chạy AI Biên kịch ở chế độ 3 Tầng tách biệt.")
              : h(
                  "div",
                  { className: "stage-editor-stack" },
                  h(
                    "div",
                    { className: "stage-card" },
                    h("div", { className: "stage-card-title" }, "🎣 Hook Angle & Narrative Arc"),
                    h(
                      "div",
                      { className: "form-field" },
                      h("label", { className: "form-label-sm" }, "Hook Conflict Statement"),
                      h("input", {
                        type: "text",
                        className: "studio-input studio-input-sm",
                        value: brief.hook_angle?.conflict_statement || "",
                        onChange: (e) => updateBriefField("hook_angle", "conflict_statement", e.target.value),
                        disabled: busy,
                      })
                    ),
                    h(
                      "div",
                      { className: "form-field" },
                      h("label", { className: "form-label-sm" }, "Stakes (Tại sao quan trọng?)"),
                      h("input", {
                        type: "text",
                        className: "studio-input studio-input-sm",
                        value: brief.hook_angle?.stakes || "",
                        onChange: (e) => updateBriefField("hook_angle", "stakes", e.target.value),
                        disabled: busy,
                      })
                    ),
                    h(
                      "div",
                      { className: "stage-arc-grid" },
                      h(
                        "div",
                        null,
                        h("label", { className: "form-label-sm" }, "Setup"),
                        h("textarea", {
                          className: "studio-textarea",
                          rows: 2,
                          value: brief.narrative_arc?.setup || "",
                          onChange: (e) => updateBriefField("narrative_arc", "setup", e.target.value),
                          disabled: busy,
                        })
                      ),
                      h(
                        "div",
                        null,
                        h("label", { className: "form-label-sm" }, "Escalation"),
                        h("textarea", {
                          className: "studio-textarea",
                          rows: 2,
                          value: brief.narrative_arc?.escalation || "",
                          onChange: (e) => updateBriefField("narrative_arc", "escalation", e.target.value),
                          disabled: busy,
                        })
                      ),
                      h(
                        "div",
                        null,
                        h("label", { className: "form-label-sm" }, "Reversal"),
                        h("textarea", {
                          className: "studio-textarea",
                          rows: 2,
                          value: brief.narrative_arc?.reversal || "",
                          onChange: (e) => updateBriefField("narrative_arc", "reversal", e.target.value),
                          disabled: busy,
                        })
                      )
                    )
                  ),
                  h(
                    "div",
                    { className: "stage-beats-list" },
                    ...(brief.teaching_beats || []).map((b, idx) =>
                      h(
                        "div",
                        { key: b.id || idx, className: "stage-beat-card" },
                        h(
                          "div",
                          { className: "stage-beat-head" },
                          h("strong", null, b.id || `beat_${idx + 1}`),
                          h(
                            "select",
                            {
                              className: "studio-input studio-input-sm",
                              value: b.part || "architecture",
                              onChange: (e) => updateBriefBeat(idx, "part", e.target.value),
                              disabled: busy,
                            },
                            ...PART_OPTIONS.map((p) => h("option", { key: p.id, value: p.id }, p.label))
                          )
                        ),
                        h(
                          "div",
                          { className: "form-field" },
                          h("label", { className: "form-label-sm" }, "Luận điểm cốt lõi (key_claim)"),
                          h("input", {
                            type: "text",
                            className: "studio-input studio-input-sm",
                            value: b.key_claim || "",
                            onChange: (e) => updateBriefBeat(idx, "key_claim", e.target.value),
                            disabled: busy,
                          })
                        ),
                        h(
                          "div",
                          { className: "form-field" },
                          h("label", { className: "form-label-sm" }, "Bằng chứng / Neo kỹ thuật (concrete_proof_anchor)"),
                          h("input", {
                            type: "text",
                            className: "studio-input studio-input-sm",
                            value: b.concrete_proof_anchor || "",
                            onChange: (e) => updateBriefBeat(idx, "concrete_proof_anchor", e.target.value),
                            disabled: busy,
                          })
                        )
                      )
                    )
                  )
                )
            : activeTab === "dialogue"
              ? !dialogue
                ? h("div", { className: "empty-feed" }, "Chưa có dialogue.json. Hãy duyệt Brief rồi bấm Tiếp tục sang Lời thoại.")
                : h(
                    "div",
                    { className: "stage-editor-stack" },
                    ...(dialogue.beats || []).map((b, idx) =>
                      h(
                        "div",
                        { key: b.beat_id || idx, className: "stage-beat-card" },
                        h(
                          "div",
                          { className: "stage-beat-head" },
                          h("strong", null, `${b.beat_id || `beat_${idx + 1}`} · ${b.scene_group || b.part}`),
                          h("span", { className: "stage-fact-chip" }, `WHAT: ${b.on_screen_fact || "—"}`)
                        ),
                        h(
                          "div",
                          { className: "form-field" },
                          h("label", { className: "form-label-sm" }, "display_text (Hiển thị phụ đề chuẩn kỹ thuật)"),
                          h("textarea", {
                            className: "studio-textarea",
                            rows: 2,
                            value: b.display_text || "",
                            onChange: (e) => updateDialogueBeat(idx, "display_text", e.target.value),
                            disabled: busy,
                          })
                        ),
                        h(
                          "div",
                          { className: "form-field" },
                          h("label", { className: "form-label-sm" }, "tts_text (Ngữ âm đọc cho TTS — tách viết tắt/số)"),
                          h("textarea", {
                            className: "studio-textarea",
                            rows: 2,
                            value: b.tts_text || "",
                            onChange: (e) => updateDialogueBeat(idx, "tts_text", e.target.value),
                            disabled: busy,
                          })
                        )
                      )
                    ),
                    h(
                      "div",
                      { className: "stage-card" },
                      h("label", { className: "form-label-sm" }, "notes.md (Tài liệu học tập kèm tập)"),
                      h("textarea", {
                        className: "studio-textarea",
                        rows: 4,
                        value: notesMd,
                        onChange: (e) => setNotesMd(e.target.value),
                        disabled: busy,
                      })
                    )
                  )
              : !audioSpine
                ? h(
                    "div",
                    { className: "empty-feed" },
                    "Chưa khóa Audio-Spine. Nếu muốn đo thời lượng audio thật từng beat trước khi dựng Visual, bấm nút Khóa Audio-Spine bên dưới."
                  )
                : h(
                    "div",
                    { className: "stage-editor-stack" },
                    h(
                      "div",
                      { className: "stage-card" },
                      h(
                        "div",
                        { className: "stage-card-title" },
                        `🔒 Audio-Spine: ${audioSpine.beats?.length || 0} beats · ${((audioSpine.total_duration_ms || 0) / 1000).toFixed(2)}s (${audioSpine.total_frames || 0} frames @${audioSpine.fps || 30}fps)`
                      ),
                      h(
                        "div",
                        { className: "stage-beats-list" },
                        ...(audioSpine.beats || []).map((sb, i) =>
                          h(
                            "div",
                            { key: sb.beat_id || i, className: "stage-spine-row" },
                            h("strong", null, sb.beat_id),
                            h("span", null, `${sb.duration_ms}ms (${sb.start_frame}→${sb.end_frame}f)`),
                            h("span", { className: "muted" }, sb.display_text || "")
                          )
                        )
                      )
                    )
                  ),

        errorMsg ? h("div", { className: "modal-error-banner" }, `⚠️ ${errorMsg}`) : null,
        statusMsg ? h("div", { className: "stage-status-banner" }, statusMsg) : null
      ),

      h(
        "div",
        { className: "studio-modal-footer stage-modal-footer" },
        h(
          "button",
          {
            type: "button",
            className: "btn-secondary",
            onClick: () => !busy && onClose && onClose(),
            disabled: busy,
          },
          "Đóng"
        ),
        activeTab === "brief" && brief
          ? h(
              "button",
              {
                type: "button",
                className: "btn-secondary",
                onClick: handleSaveBrief,
                disabled: busy,
              },
              busy ? "⏳ Đang lưu..." : "💾 Lưu Brief"
            )
          : null,
        activeTab === "dialogue" && dialogue
          ? h(
              "button",
              {
                type: "button",
                className: "btn-secondary",
                onClick: handleSaveDialogue,
                disabled: busy,
              },
              busy ? "⏳ Đang lưu..." : "💾 Lưu Lời thoại"
            )
          : null,
        dialogue
          ? h(
              "button",
              {
                type: "button",
                className: "btn-secondary",
                onClick: handleLockAudioSpine,
                disabled: busy,
                title: "Tổng hợp TTS từng beat để khóa duration_ms thật trước Tầng 3",
              },
              busy ? "⏳ Đang chạy TTS..." : "🔒 Khóa Audio-Spine (TTS)"
            )
          : null,
        activeTab === "brief" && brief
          ? h(
              "button",
              {
                type: "button",
                className: "btn-export",
                disabled: busy,
                onClick: () => {
                  onClose && onClose();
                  onContinueToStage &&
                    onContinueToStage({
                      episode,
                      startFrom: "dialogue",
                      initialMode: "three_stage",
                      initialPauseAfter: "dialogue",
                    });
                },
              },
              "▶ Tiếp tục sang Lời thoại"
            )
          : null,
        dialogue
          ? h(
              "button",
              {
                type: "button",
                className: "btn-export",
                disabled: busy,
                onClick: () => {
                  onClose && onClose();
                  onContinueToStage &&
                    onContinueToStage({
                      episode,
                      startFrom: "visual",
                      initialMode: "three_stage",
                      initialPauseAfter: "none",
                    });
                },
              },
              "▶ Tiếp tục sang Visual Director"
            )
          : null
      )
    )
  );
}
