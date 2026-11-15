import React, { useEffect, useState } from "react";

const h = React.createElement;

export const REVISION_SCOPES = [
  {
    id: "script",
    icon: "📝",
    label: "Kịch bản / Nội dung",
    agent: "Argon",
    hint: "Sửa lời thoại, kiến thức, ví dụ hoặc notes.md",
  },
  {
    id: "visual",
    icon: "🎨",
    label: "Sơ đồ / UI Motion",
    agent: "Argon",
    hint: "Sửa sơ đồ kiến trúc, zone, mũi tên, code/console UI",
  },
  {
    id: "production",
    icon: "🎙️",
    label: "TTS / Audio-Video",
    agent: "Hydrogen",
    hint: "Đọc lại giọng TTS, chỉnh tốc độ hoặc render lại video",
  },
];

export function RevisionModal({
  isOpen,
  courseId,
  episode,
  defaultSceneId = "",
  onClose,
  onSubmitted,
}) {
  const scenes = episode?.script?.scenes || [];
  const [scope, setScope] = useState("script");
  const [sceneId, setSceneId] = useState(defaultSceneId || "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setScope("script");
    setSceneId(defaultSceneId || "");
    setDescription("");
    setErrorMsg("");
    setBusy(false);
  }, [isOpen, episode?.id, defaultSceneId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !busy) {
        onClose && onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen || !episode) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const desc = description.trim();
    if (!desc) {
      setErrorMsg("Vui lòng nhập mô tả chi tiết điểm cần sửa.");
      return;
    }
    setBusy(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: courseId,
          episode: episode.id,
          action: "create_revision",
          scope,
          scene_id: sceneId || null,
          description: desc,
          owner: "user-ui",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onSubmitted && (await onSubmitted(data));
      onClose && onClose();
    } catch (err) {
      setErrorMsg(err.message || "Không thể tạo yêu cầu sửa.");
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
        className: "studio-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "revision-modal-title",
        onClick: (e) => e.stopPropagation(),
      },
      h(
        "div",
        { className: "studio-modal-header" },
        h(
          "div",
          null,
          h("h2", { id: "revision-modal-title", className: "studio-modal-title" }, "⚠️ Tạo Yêu Cầu Sửa"),
          h(
            "div",
            { className: "studio-modal-sub" },
            `${courseId} · Tập ${String(episode.number || 0).padStart(2, "0")}: ${episode.title || episode.id}`
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
        // Scope pills
        h(
          "div",
          { className: "form-field" },
          h("label", { className: "form-label" }, "Phạm vi cần sửa"),
          h(
            "div",
            { className: "scope-pills-grid" },
            ...REVISION_SCOPES.map((sc) =>
              h(
                "button",
                {
                  key: sc.id,
                  type: "button",
                  className: `scope-pill ${scope === sc.id ? "is-active" : ""}`,
                  onClick: () => setScope(sc.id),
                  disabled: busy,
                },
                h("div", { className: "scope-pill-title" }, `${sc.icon} ${sc.label}`),
                h("div", { className: "scope-pill-hint" }, sc.hint)
              )
            )
          )
        ),

        // Scene selector
        h(
          "div",
          { className: "form-field" },
          h("label", { htmlFor: "rev-scene-select", className: "form-label" }, "Phân cảnh liên quan"),
          h(
            "select",
            {
              id: "rev-scene-select",
              className: "studio-input",
              value: sceneId,
              onChange: (e) => setSceneId(e.target.value),
              disabled: busy,
            },
            h("option", { value: "" }, "Toàn tập (General / Nhiều cảnh)"),
            ...scenes.map((sc, idx) =>
              h(
                "option",
                { key: sc.id, value: sc.id },
                `Cảnh ${idx + 1}: ${sc.title || sc.id} [${sc.visual_type || "scene"}]`
              )
            )
          )
        ),

        // Description textarea
        h(
          "div",
          { className: "form-field" },
          h("label", { htmlFor: "rev-desc-textarea", className: "form-label" }, "Chi tiết yêu cầu sửa *"),
          h("textarea", {
            id: "rev-desc-textarea",
            className: "studio-textarea",
            rows: 4,
            value: description,
            onChange: (e) => setDescription(e.target.value),
            placeholder:
              "Nhập yêu cầu cụ thể (Tiếng Việt hoặc English), ví dụ: Cảnh 2 sơ đồ mũi tên bị chéo nhau, cần tách zone Client và VPC rõ hơn; hoặc giọng đọc đoạn này hơi nhanh...",
            disabled: busy,
            autoFocus: true,
          })
        ),

        errorMsg
          ? h("div", { className: "modal-error-banner" }, `⚠️ ${errorMsg}`)
          : null,

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
              disabled: busy || !description.trim(),
            },
            busy ? "Đang lưu ticket..." : "Gửi Yêu Cầu Sửa"
          )
        )
      )
    )
  );
}
