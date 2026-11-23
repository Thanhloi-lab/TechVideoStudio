import React, { useCallback, useEffect, useMemo, useState } from "react";
import { renderMarkdownToHtml } from "../markdown.mjs";

const h = React.createElement;

const PART_OPTIONS = [
  { id: "problem", label: "problem (Bài toán)" },
  { id: "architecture", label: "architecture (Kiến trúc)" },
  { id: "setup", label: "setup (Thực hành)" },
  { id: "exam_tips", label: "exam_tips (Bẫy / Tổng kết)" },
];

function parseReviewVerdictClient(mdText) {
  if (!mdText || !String(mdText).trim()) return null;
  const lines = String(mdText).split(/\r?\n/);
  const explicitKeyRe =
    /^(?:>\s*)?(?:#+\s*)?(?:[-*]\s*)?(?:\*{0,2}|__)?(?:verdict|status|kết\s*luận|trạng\s*thái)(?:\*{0,2}|__)?\s*[:\-–—]\s*(?:\*{0,2}|`|__|\s)*(APPROVED|REVISE)\b/i;
  let matchedExplicit = null;
  for (const line of lines) {
    const m = explicitKeyRe.exec(line.trim());
    if (m) matchedExplicit = m[1].toUpperCase();
  }
  if (matchedExplicit) return matchedExplicit;

  const standaloneLineRe =
    /^(?:>\s*)?(?:#+\s*)?(?:[-*]\s*)?(?:\*{0,2}|`|__)?(APPROVED|REVISE)(?:\*{0,2}|`|__)?[\s.!]*$/i;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = standaloneLineRe.exec(lines[i].trim());
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function mergePartsCatalog(apiParts, episodeParts, briefParts) {
  const byId = new Map();
  const order = [];
  const push = (id) => {
    const clean = String(id || "").trim();
    if (!clean || byId.has(clean)) return;
    byId.set(clean, { part_id: clean });
    order.push(clean);
  };

  for (const bp of Array.isArray(briefParts) ? briefParts : []) {
    const pid = String(bp?.part_id || bp?.id || "").trim();
    if (!pid) continue;
    push(pid);
    byId.set(pid, {
      ...byId.get(pid),
      part_id: pid,
      title: bp.title || pid,
      target_duration_sec: bp.target_duration_sec ?? null,
    });
  }
  for (const ep of Array.isArray(episodeParts) ? episodeParts : []) {
    if (!ep?.part_id) continue;
    push(ep.part_id);
    byId.set(ep.part_id, { ...byId.get(ep.part_id), ...ep });
  }
  for (const ap of Array.isArray(apiParts) ? apiParts : []) {
    if (!ap?.part_id) continue;
    push(ap.part_id);
    byId.set(ap.part_id, { ...byId.get(ap.part_id), ...ap });
  }
  return order.map((id) => byId.get(id));
}

export function ScriptingStageModal({
  isOpen,
  course,
  episode,
  initialPartId = null,
  onClose,
  onSaved,
  onContinueToStage,
}) {
  const [selectedScope, setSelectedScope] = useState("master"); // "master" | "part_01" | ...
  const [activeTab, setActiveTab] = useState("brief"); // "brief" | "dialogue" | "audio_spine" | "review"
  const [loading, setLoading] = useState(false);
  const [partLoading, setPartLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const [brief, setBrief] = useState(null);
  const [briefReviewMd, setBriefReviewMd] = useState("");
  const [briefReviewVerdict, setBriefReviewVerdict] = useState(null);
  const [partsList, setPartsList] = useState([]);
  const [mergedAt, setMergedAt] = useState(null);

  const [rootDialogue, setRootDialogue] = useState(null);
  const [rootAudioSpine, setRootAudioSpine] = useState(null);
  const [rootNotesMd, setRootNotesMd] = useState("");

  const [partDialogue, setPartDialogue] = useState(null);
  const [partAudioSpine, setPartAudioSpine] = useState(null);
  const [partNotesMd, setPartNotesMd] = useState("");
  const [partReviewMd, setPartReviewMd] = useState("");
  const [partReviewVerdict, setPartReviewVerdict] = useState(null);
  const [partState, setPartState] = useState(null);

  const loadPartArtifacts = useCallback(
    async (partId) => {
      if (!course?.id || !episode?.id || !partId || partId === "master") return;
      setPartLoading(true);
      setErrorMsg("");
      try {
        const res = await fetch(
          `/api/episodes/part?course=${encodeURIComponent(course.id)}&episode=${encodeURIComponent(episode.id)}&part=${encodeURIComponent(partId)}`
        );
        const d = await res.json();
        if (!res.ok || !d?.ok) {
          throw new Error(d?.error || `HTTP ${res.status}`);
        }
        setPartDialogue(d.dialogue || null);
        setPartAudioSpine(d.audio_spine || null);
        setPartNotesMd(d.notes || "");
        setPartReviewMd(d.review_md || "");
        setPartReviewVerdict(d.review_verdict || parseReviewVerdictClient(d.review_md || ""));
        setPartState(d.part_state || null);
      } catch (err) {
        setPartDialogue(null);
        setPartAudioSpine(null);
        setPartNotesMd("");
        setPartReviewMd("");
        setPartReviewVerdict(null);
        setPartState(null);
        setErrorMsg(err?.message || `Không tải được dữ liệu phần ${partId}.`);
      } finally {
        setPartLoading(false);
      }
    },
    [course?.id, episode?.id]
  );

  const reloadModalData = useCallback(async () => {
    if (!course?.id || !episode?.id) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(
        `/api/episodes/scripting-artifacts?course=${encodeURIComponent(course.id)}&episode=${encodeURIComponent(episode.id)}`
      );
      const d = await res.json();
      if (!res.ok || !d?.ok) {
        setErrorMsg(d?.error || "Không tải được dữ liệu biên kịch.");
        return;
      }
      setBrief(d.brief || null);
      setBriefReviewMd(d.brief_review_md || "");
      setBriefReviewVerdict(
        d.brief_review_verdict || parseReviewVerdictClient(d.brief_review_md || "")
      );
      setRootDialogue(d.dialogue || null);
      setRootAudioSpine(d.audio_spine || null);
      setRootNotesMd(d.notes || "");
      setMergedAt(d.merged_at || episode?.merged_at || null);

      const mergedCatalog = mergePartsCatalog(d.parts, episode?.parts, d.brief?.parts);
      setPartsList(mergedCatalog);

      if (initialPartId && mergedCatalog.some((p) => p.part_id === initialPartId)) {
        setSelectedScope(initialPartId);
        setActiveTab("dialogue");
        await loadPartArtifacts(initialPartId);
      } else {
        setSelectedScope("master");
        const phase = episode?.scripting_phase || episode?.state?.scripting?.phase || "";
        if (phase === "part_review_ready" && mergedCatalog.length > 0) {
          const firstWithReview = mergedCatalog.find((p) => p.has_review) || mergedCatalog[0];
          setSelectedScope(firstWithReview.part_id);
          setActiveTab("review");
          await loadPartArtifacts(firstWithReview.part_id);
        } else if (phase === "dialogue_ready") {
          setActiveTab("dialogue");
        } else if (phase === "audio_spine_ready") {
          setActiveTab("audio_spine");
        } else if (d.dialogue && !d.brief) {
          setActiveTab("dialogue");
        } else {
          setActiveTab("brief");
        }
      }
    } catch (err) {
      setErrorMsg(err?.message || "Lỗi kết nối tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [course?.id, episode?.id, episode?.merged_at, episode?.parts, episode?.scripting_phase, episode?.state?.scripting?.phase, initialPartId, loadPartArtifacts]);

  useEffect(() => {
    if (!isOpen || !course?.id || !episode?.id) return;
    setStatusMsg("");
    void reloadModalData();
  }, [isOpen, course?.id, episode?.id]);

  const activeDialogue = selectedScope === "master" ? rootDialogue : partDialogue;
  const activeAudioSpine = selectedScope === "master" ? rootAudioSpine : partAudioSpine;
  const activeNotesMd = selectedScope === "master" ? rootNotesMd : partNotesMd;
  const activeReviewMd = selectedScope === "master" ? briefReviewMd : partReviewMd;
  const activeReviewVerdict = useMemo(() => {
    if (selectedScope === "master") {
      return briefReviewVerdict || parseReviewVerdictClient(briefReviewMd);
    }
    return partReviewVerdict || parseReviewVerdictClient(partReviewMd);
  }, [selectedScope, briefReviewVerdict, briefReviewMd, partReviewVerdict, partReviewMd]);

  const currentPartMeta = useMemo(
    () => partsList.find((p) => p.part_id === selectedScope) || null,
    [partsList, selectedScope]
  );
  const isCurrentPartApproved = Boolean(partState?.approved ?? currentPartMeta?.approved);

  if (!isOpen || !course || !episode) return null;

  const handleSelectScope = (scopeId) => {
    setErrorMsg("");
    setStatusMsg("");
    setSelectedScope(scopeId);
    if (scopeId === "master") {
      if (activeTab !== "review") setActiveTab("brief");
      return;
    }
    if (activeTab === "brief") {
      const targetPart = partsList.find((p) => p.part_id === scopeId);
      setActiveTab(targetPart?.has_review && !targetPart?.has_dialogue ? "review" : "dialogue");
    }
    void loadPartArtifacts(scopeId);
  };

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

  const updateBriefPartBeat = (partIdx, beatIdx, key, val) => {
    setBrief((prev) => {
      if (!prev || !Array.isArray(prev.parts)) return prev;
      const nextParts = prev.parts.map((part, pIdx) => {
        if (pIdx !== partIdx || !Array.isArray(part.teaching_beats)) return part;
        return {
          ...part,
          teaching_beats: part.teaching_beats.map((b, bIdx) =>
            bIdx === beatIdx ? { ...b, [key]: val } : b
          ),
        };
      });
      return { ...prev, parts: nextParts };
    });
  };

  const updateDialogueBeat = (idx, key, val) => {
    const updater = (prev) => {
      if (!prev || !Array.isArray(prev.beats)) return prev;
      const nextBeats = prev.beats.map((b, i) => (i === idx ? { ...b, [key]: val } : b));
      return { ...prev, beats: nextBeats };
    };
    if (selectedScope === "master") {
      setRootDialogue(updater);
    } else {
      setPartDialogue(updater);
    }
  };

  const setActiveNotesMd = (val) => {
    if (selectedScope === "master") setRootNotesMd(val);
    else setPartNotesMd(val);
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
      setPartsList(mergePartsCatalog(partsList, episode?.parts, (data.brief || brief)?.parts));
      setStatusMsg("✅ Đã lưu Master Brief.");
      onSaved && (await onSaved("brief"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể lưu Brief.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDialogue = async () => {
    if (!activeDialogue) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const partIdPayload = selectedScope !== "master" ? selectedScope : undefined;
      const res = await fetch("/api/episodes/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          part_id: partIdPayload,
          dialogue: activeDialogue,
          notes_md: activeNotesMd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (selectedScope === "master") setRootDialogue(data.dialogue || activeDialogue);
      else setPartDialogue(data.dialogue || activeDialogue);
      setStatusMsg(
        `✅ Đã lưu Lời thoại & Ghi chú${partIdPayload ? ` (${partIdPayload})` : ""}.`
      );
      onSaved && (await onSaved("dialogue"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể lưu Lời thoại.");
    } finally {
      setBusy(false);
    }
  };

  const handleLockAudioSpine = async () => {
    if (!activeDialogue) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const partIdPayload = selectedScope !== "master" ? selectedScope : undefined;
      const saveRes = await fetch("/api/episodes/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          part_id: partIdPayload,
          dialogue: activeDialogue,
          notes_md: activeNotesMd,
        }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || !saveData.ok) {
        throw new Error(saveData.error || `Không lưu được Dialogue (HTTP ${saveRes.status})`);
      }

      const res = await fetch("/api/episodes/audio-spine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          part_id: partIdPayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Audio-Spine failed (HTTP ${res.status})`);
      }
      if (selectedScope === "master") setRootAudioSpine(data.audio_spine || null);
      else setPartAudioSpine(data.audio_spine || null);
      setActiveTab("audio_spine");
      setStatusMsg(
        `🔒 Đã khóa Audio-Spine${partIdPayload ? ` (${partIdPayload})` : ""} (${data.audio_spine?.beats?.length || 0} beats · ${((data.audio_spine?.total_duration_ms || 0) / 1000).toFixed(2)}s).`
      );
      onSaved && (await onSaved("audio_spine"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể khóa Audio-Spine TTS.");
    } finally {
      setBusy(false);
    }
  };

  const handleApprovePart = async () => {
    if (selectedScope === "master" || busy) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    const nextApproved = !isCurrentPartApproved;
    try {
      const res = await fetch("/api/episodes/part/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          part_id: selectedScope,
          approved: nextApproved,
          status: nextApproved ? "completed" : "reviewing",
          note: nextApproved ? "Approved in ScriptingStageModal" : "Approval revoked in UI",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPartState(data.part || null);
      setPartsList((prev) =>
        prev.map((p) => (p.part_id === selectedScope ? { ...p, ...(data.part || {}) } : p))
      );
      setStatusMsg(
        nextApproved
          ? `✅ Đã duyệt ${selectedScope}.`
          : `↺ Đã bỏ duyệt ${selectedScope}.`
      );
      onSaved && (await onSaved("part_approved"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể cập nhật trạng thái duyệt phần.");
    } finally {
      setBusy(false);
    }
  };

  const handleMergeParts = async (force = false) => {
    if (busy) return;
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await fetch("/api/episodes/merge-parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: course.id,
          episode: episode.id,
          force,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMergedAt(data.merged_at || new Date().toISOString());
      setStatusMsg(
        `🔗 Đã gộp ${data.parts_merged?.length || partsList.length} phần thành script.json (${data.scene_count || 0} cảnh · ${Math.round(data.total_duration_sec || 0)}s)!`
      );
      onSaved && (await onSaved("merged"));
    } catch (err) {
      setErrorMsg(err.message || "Không thể gộp các phần.");
    } finally {
      setBusy(false);
    }
  };

  const allPartsApproved =
    partsList.length > 0 && partsList.every((p) => Boolean(p.approved) && Boolean(p.has_script));

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
        "aria-label": `Duyệt kịch bản Multi-Part & AI Review — ${episode.title || episode.id}`,
      },
      h(
        "div",
        { className: "studio-modal-head" },
        h(
          "div",
          null,
          h(
            "h3",
            null,
            `📝 Duyệt Kịch bản & AI Review — Tập ${String(episode.number || 0).padStart(2, "0")}`
          ),
          h(
            "p",
            { className: "modal-sub" },
            `${episode.title || episode.id}${mergedAt ? " · 🔗 Đã gộp script.json" : ""}`
          )
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

      // Part Selector Bar (when episode has multi-part breakdown)
      partsList.length > 0
        ? h(
            "div",
            { className: "stage-parts-selector", role: "tablist", "aria-label": "Chọn phần nội dung" },
            h(
              "button",
              {
                type: "button",
                className: `stage-part-pill ${selectedScope === "master" ? "is-active" : ""}`,
                onClick: () => handleSelectScope("master"),
                disabled: busy,
              },
              `🧭 Master Brief${briefReviewVerdict === "APPROVED" ? " ✓" : briefReviewVerdict === "REVISE" ? " ⚠️" : ""}`
            ),
            ...partsList.map((p, idx) => {
              const verdict = p.ai_review_verdict || p.review_verdict;
              const badgeIcon = p.approved
                ? " ✓"
                : verdict === "REVISE"
                  ? " ⚠️"
                  : verdict === "APPROVED"
                    ? " 🛡️"
                    : " ⏳";
              return h(
                "button",
                {
                  key: p.part_id,
                  type: "button",
                  className: `stage-part-pill ${selectedScope === p.part_id ? "is-active" : ""} ${
                    p.approved ? "is-approved" : verdict === "REVISE" ? "is-revise" : ""
                  }`,
                  onClick: () => handleSelectScope(p.part_id),
                  disabled: busy,
                  title: `${p.title || p.part_id} · Review: ${verdict || "Chưa"} · Duyệt: ${p.approved ? "Đã duyệt" : "Chưa"}`,
                },
                `Phần ${idx + 1} (${p.part_id})${badgeIcon}`
              );
            })
          )
        : null,

      h(
        "div",
        { className: "scripting-stage-tabs" },
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "brief" ? "is-active" : ""}`,
            onClick: () => {
              if (selectedScope !== "master") setSelectedScope("master");
              setActiveTab("brief");
            },
          },
          `1. Master Brief${brief ? " ✓" : ""}`
        ),
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "dialogue" ? "is-active" : ""}`,
            onClick: () => setActiveTab("dialogue"),
          },
          `2. Lời thoại & Dual-Text${activeDialogue ? " ✓" : ""}`
        ),
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "audio_spine" ? "is-active" : ""}`,
            onClick: () => setActiveTab("audio_spine"),
          },
          `3. Audio-Spine${activeAudioSpine ? " 🔒" : ""}`
        ),
        h(
          "button",
          {
            type: "button",
            className: `stage-tab-btn ${activeTab === "review" ? "is-active" : ""}`,
            onClick: () => setActiveTab("review"),
          },
          `4. 🛡️ AI Review${
            activeReviewVerdict === "APPROVED"
              ? " ✅"
              : activeReviewVerdict === "REVISE"
                ? " ⚠️"
                : ""
          }`
        )
      ),

      h(
        "div",
        { className: "studio-modal-body scripting-stage-body" },
        loading || partLoading
          ? h("div", { className: "empty-feed" }, "⏳ Đang tải dữ liệu kịch bản & review...")
          : activeTab === "review"
            ? !activeReviewMd
              ? h(
                  "div",
                  { className: "empty-feed" },
                  selectedScope === "master"
                    ? "Chưa có brief_review.md. Hãy chạy AI Biên kịch (deep_course) để Content Reviewer phản biện Master Brief."
                    : `Chưa có parts/${selectedScope}/review.md. Hãy chạy AI Biên kịch (deep_course) để Content Reviewer kiểm duyệt độc lập phần này.`
                )
              : h(
                  "div",
                  { className: "stage-review-panel" },
                  h(
                    "div",
                    { className: "stage-review-header" },
                    h(
                      "span",
                      {
                        className: `stage-review-verdict-badge ${
                          activeReviewVerdict === "APPROVED"
                            ? "is-approved"
                            : activeReviewVerdict === "REVISE"
                              ? "is-revise"
                              : "is-unknown"
                        }`,
                      },
                      activeReviewVerdict === "APPROVED"
                        ? "✅ VERDICT: APPROVED"
                        : activeReviewVerdict === "REVISE"
                          ? "⚠️ VERDICT: REVISE"
                          : "🛡️ BÁO CÁO PHẢN BIỆN ĐỘC LẬP"
                    ),
                    h(
                      "span",
                      { className: "stage-review-scope-tag" },
                      selectedScope === "master" ? "brief_review.md" : `parts/${selectedScope}/review.md`
                    )
                  ),
                  h("div", {
                    className: "md-body stage-review-md",
                    dangerouslySetInnerHTML: {
                      __html: renderMarkdownToHtml(activeReviewMd),
                    },
                  })
                )
            : activeTab === "brief"
              ? !brief
                ? h(
                    "div",
                    { className: "empty-feed" },
                    "Chưa có brief.json. Hãy chạy AI Biên kịch chế độ deep_course."
                  )
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
                          onChange: (e) =>
                            updateBriefField("hook_angle", "conflict_statement", e.target.value),
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
                            onChange: (e) =>
                              updateBriefField("narrative_arc", "escalation", e.target.value),
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
                            onChange: (e) =>
                              updateBriefField("narrative_arc", "reversal", e.target.value),
                            disabled: busy,
                          })
                        )
                      )
                    ),
                    brief.episode_canon
                      ? h(
                          "div",
                          { className: "stage-card" },
                          h("div", { className: "stage-card-title" }, "🧬 Episode Canon (Tính nhất quán xuyên suốt)"),
                          brief.episode_canon.running_example
                            ? h(
                                "div",
                                { className: "stage-canon-line" },
                                h("strong", null, "Running Example: "),
                                brief.episode_canon.running_example
                              )
                            : null,
                          brief.episode_canon.audience_level
                            ? h(
                                "div",
                                { className: "stage-canon-line" },
                                h("strong", null, "Audience Level: "),
                                brief.episode_canon.audience_level
                              )
                            : null,
                          Array.isArray(brief.episode_canon.shared_glossary) &&
                            brief.episode_canon.shared_glossary.length > 0
                            ? h(
                                "div",
                                { className: "stage-canon-glossary" },
                                ...brief.episode_canon.shared_glossary.map((g, gi) =>
                                  h(
                                    "span",
                                    { key: gi, className: "stage-fact-chip" },
                                    typeof g === "string"
                                      ? g
                                      : `${g.term || g.name || ""}${g.definition ? `: ${g.definition}` : ""}`
                                  )
                                )
                              )
                            : null
                        )
                      : null,
                    Array.isArray(brief.parts) && brief.parts.length > 0
                      ? h(
                          "div",
                          { className: "stage-beats-list" },
                          ...brief.parts.map((partItem, pIdx) =>
                            h(
                              "div",
                              { key: partItem.part_id || pIdx, className: "stage-card" },
                              h(
                                "div",
                                { className: "stage-beat-head" },
                                h(
                                  "strong",
                                  null,
                                  `📦 Phần ${pIdx + 1} (${partItem.part_id}): ${partItem.title || ""}`
                                ),
                                h(
                                  "span",
                                  { className: "stage-fact-chip" },
                                  `Mục tiêu: ${partItem.target_duration_sec || 300}s`
                                )
                              ),
                              Array.isArray(partItem.must_cover_concepts) &&
                                partItem.must_cover_concepts.length > 0
                                ? h(
                                    "div",
                                    { className: "stage-canon-line" },
                                    h("strong", null, "Must-cover: "),
                                    partItem.must_cover_concepts.join(" · ")
                                  )
                                : null,
                              ...(partItem.teaching_beats || []).map((b, bIdx) =>
                                h(
                                  "div",
                                  { key: b.id || bIdx, className: "stage-beat-card" },
                                  h(
                                    "div",
                                    { className: "stage-beat-head" },
                                    h("strong", null, b.id || `beat_${bIdx + 1}`),
                                    h(
                                      "select",
                                      {
                                        className: "studio-input studio-input-sm",
                                        value: b.part || "architecture",
                                        onChange: (e) =>
                                          updateBriefPartBeat(pIdx, bIdx, "part", e.target.value),
                                        disabled: busy,
                                      },
                                      ...PART_OPTIONS.map((p) =>
                                        h("option", { key: p.id, value: p.id }, p.label)
                                      )
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
                                      onChange: (e) =>
                                        updateBriefPartBeat(pIdx, bIdx, "key_claim", e.target.value),
                                      disabled: busy,
                                    })
                                  ),
                                  h(
                                    "div",
                                    { className: "form-field" },
                                    h(
                                      "label",
                                      { className: "form-label-sm" },
                                      "Bằng chứng / Neo kỹ thuật (concrete_proof_anchor)"
                                    ),
                                    h("input", {
                                      type: "text",
                                      className: "studio-input studio-input-sm",
                                      value: b.concrete_proof_anchor || "",
                                      onChange: (e) =>
                                        updateBriefPartBeat(
                                          pIdx,
                                          bIdx,
                                          "concrete_proof_anchor",
                                          e.target.value
                                        ),
                                      disabled: busy,
                                    })
                                  )
                                )
                              )
                            )
                          )
                        )
                      : h(
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
                                  ...PART_OPTIONS.map((p) =>
                                    h("option", { key: p.id, value: p.id }, p.label)
                                  )
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
                                h(
                                  "label",
                                  { className: "form-label-sm" },
                                  "Bằng chứng / Neo kỹ thuật (concrete_proof_anchor)"
                                ),
                                h("input", {
                                  type: "text",
                                  className: "studio-input studio-input-sm",
                                  value: b.concrete_proof_anchor || "",
                                  onChange: (e) =>
                                    updateBriefBeat(idx, "concrete_proof_anchor", e.target.value),
                                  disabled: busy,
                                })
                              )
                            )
                          )
                        )
                  )
              : activeTab === "dialogue"
                ? !activeDialogue
                  ? h(
                      "div",
                      { className: "empty-feed" },
                      selectedScope === "master"
                        ? "Chưa có dialogue.json ở thư mục gốc. Chọn một Phần bên trên hoặc bấm Tiếp tục sang Lời thoại."
                        : `Chưa có parts/${selectedScope}/dialogue.json.`
                    )
                  : h(
                      "div",
                      { className: "stage-editor-stack" },
                      ...(activeDialogue.beats || []).map((b, idx) =>
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
                            h(
                              "label",
                              { className: "form-label-sm" },
                              "display_text (Hiển thị phụ đề chuẩn kỹ thuật)"
                            ),
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
                            h(
                              "label",
                              { className: "form-label-sm" },
                              "tts_text (Ngữ âm đọc cho TTS — tách viết tắt/số)"
                            ),
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
                        h(
                          "label",
                          { className: "form-label-sm" },
                          `notes.md (${selectedScope === "master" ? "Toàn tập" : selectedScope})`
                        ),
                        h("textarea", {
                          className: "studio-textarea",
                          rows: 4,
                          value: activeNotesMd,
                          onChange: (e) => setActiveNotesMd(e.target.value),
                          disabled: busy,
                        })
                      )
                    )
                : !activeAudioSpine
                  ? h(
                      "div",
                      { className: "empty-feed" },
                      "Chưa khóa Audio-Spine cho phạm vi này. Bấm nút Khóa Audio-Spine bên dưới nếu muốn đo thời lượng từng beat."
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
                          `🔒 Audio-Spine: ${activeAudioSpine.beats?.length || 0} beats · ${((activeAudioSpine.total_duration_ms || 0) / 1000).toFixed(2)}s (${activeAudioSpine.total_frames || 0} frames @${activeAudioSpine.fps || 30}fps)`
                        ),
                        h(
                          "div",
                          { className: "stage-beats-list" },
                          ...(activeAudioSpine.beats || []).map((sb, i) =>
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
        activeTab === "dialogue" && activeDialogue
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
        activeDialogue
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
        partsList.length > 0 && selectedScope !== "master"
          ? h(
              "button",
              {
                type: "button",
                className: `btn-approve-part ${isCurrentPartApproved ? "is-approved" : ""}`,
                onClick: handleApprovePart,
                disabled: busy || partLoading,
                title: isCurrentPartApproved
                  ? "Bỏ duyệt phần này"
                  : "Xác nhận duyệt phần này để cho phép gộp (Merge)",
              },
              isCurrentPartApproved ? "✅ Đã duyệt phần này" : "✅ Duyệt phần này"
            )
          : null,
        partsList.length > 0
          ? h(
              "button",
              {
                type: "button",
                className: `btn-merge-parts ${allPartsApproved ? "is-ready" : ""}`,
                onClick: () => handleMergeParts(false),
                disabled: busy,
                title: allPartsApproved
                  ? "Tất cả phần đã duyệt — Gộp thành script.json, subtitles.srt & notes.md"
                  : "Gộp các phần đã duyệt thành tập hoàn chỉnh (cần duyệt hết các phần)",
              },
              "🔗 Gộp tất cả phần (Merge)"
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
                      initialMode: "deep_course",
                      initialPauseAfter: "part_review",
                    });
                },
              },
              "▶ Tiếp tục sang Lời thoại"
            )
          : null,
        activeDialogue
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
                      initialMode: "deep_course",
                      initialPauseAfter: "none",
                      partId: selectedScope !== "master" ? selectedScope : null,
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
