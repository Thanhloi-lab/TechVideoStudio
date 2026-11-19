import React, { useEffect, useMemo, useState } from "react";

const h = React.createElement;

const SCOPE_META = {
  script: { icon: "📝", label: "Kịch bản", cls: "scope-script", agent: "Argon" },
  visual: { icon: "🎨", label: "Sơ đồ / UI", cls: "scope-visual", agent: "Argon" },
  production: { icon: "🎙️", label: "TTS / Video", cls: "scope-production", agent: "Hydrogen" },
};

const QUICK_SCOPES = [
  { id: "script", label: "📝 Kịch bản / Nội dung" },
  { id: "visual", label: "🎨 Sơ đồ / Animation" },
  { id: "production", label: "🎙️ Giọng đọc / Video" },
];

const STATUS_META = {
  open: { label: "Đang mở", cls: "st-open" },
  in_progress: { label: "Đang sửa", cls: "st-progress" },
  resolved: { label: "Đã xong", cls: "st-resolved" },
};

const FILTER_TABS = [
  { id: "open", label: "Đang mở" },
  { id: "in_progress", label: "Đang sửa" },
  { id: "resolved", label: "Đã xong" },
  { id: "all", label: "Tất cả" },
];

function formatShortTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("vi-VN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

async function copyTextSafe(text) {
  // Run execCommand("copy") synchronously first while user click activation is active
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.fontSize = "12pt";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    ok = false;
  }
  if (ok) return true;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function buildAgentPrompt({ courseId, episode, tickets }) {
  const openTickets = (tickets || []).filter((t) => t.status !== "resolved");
  const argonTickets = openTickets.filter((t) => t.scope === "script" || t.scope === "visual");
  const hydrogenTickets = openTickets.filter((t) => t.scope === "production");

  const epLabel = episode
    ? `${episode.id} (Tập ${String(episode.number || 0).padStart(2, "0")}: ${episode.title || episode.id})`
    : "Nhiều tập";

  const lines = [
    `# Yêu cầu sửa lỗi Video Studio — Khóa học ${courseId}${episode ? ` · ${epLabel}` : ""}`,
    "",
  ];

  if (argonTickets.length > 0) {
    lines.push("## 🧠 Phần dành cho Gemini 4 Argon (Conv 2 — Kịch bản / Sơ đồ / Motion)");
    lines.push("Các ticket `script` & `visual` cần chỉnh sửa trong `script.json` / `notes.md`:");
    for (const t of argonTickets) {
      const epPrefix = t._episodeId ? `[${t._episodeId}] ` : "";
      const sceneTag = t.scene_id ? `Cảnh \`${t.scene_id}\`` : "Toàn tập";
      lines.push(`- **${t.id}** (${epPrefix}${t.scope} · ${sceneTag} · ${t.status}): ${t.description}`);
    }
    lines.push("");
    lines.push("Sau khi sửa xong, chạy kiểm tra & đóng ticket:");
    if (episode) {
      lines.push(`- \`node "D:\\VideoMaker\\engine\\state_cli.mjs" validate-diagrams --course ${courseId} --ep ${episode.id}\``);
      for (const t of argonTickets) {
        lines.push(`- \`node "D:\\VideoMaker\\engine\\state_cli.mjs" resolve-revision --course ${courseId} --ep ${episode.id} --rev ${t.id} --note "Đã sửa xong"\``);
      }
      lines.push(`- \`node "D:\\VideoMaker\\engine\\state_cli.mjs" set --course ${courseId} --ep ${episode.id} --stage scripting --status completed --note "Script & diagram updated"\``);
    }
    lines.push("");
  }

  if (hydrogenTickets.length > 0) {
    lines.push("## ⚡ Phần dành cho Gemini 4 Hydrogen (Conv 3 — TTS Audio & Render Video)");
    lines.push("Các ticket `production` cần tạo lại giọng đọc / render video:");
    for (const t of hydrogenTickets) {
      const epPrefix = t._episodeId ? `[${t._episodeId}] ` : "";
      const sceneTag = t.scene_id ? `Cảnh \`${t.scene_id}\`` : "Toàn tập";
      lines.push(`- **${t.id}** (${epPrefix}${sceneTag} · ${t.status}): ${t.description}`);
    }
    lines.push("");
    if (episode) {
      lines.push("Lệnh thực thi:");
      lines.push(`- \`python "D:\\VideoMaker\\engine\\tts_pipeline.py" --episode "D:\\VideoMaker\\${courseId}\\episodes\\${episode.id}\\script.json" --course "D:\\VideoMaker\\${courseId}\\course.json"\``);
      lines.push(`- \`node "D:\\VideoMaker\\engine\\render_video.mjs" --course ${courseId} --episode ${episode.id} --format webm\``);
      for (const t of hydrogenTickets) {
        lines.push(`- \`node "D:\\VideoMaker\\engine\\state_cli.mjs" resolve-revision --course ${courseId} --ep ${episode.id} --rev ${t.id} --note "Đã cập nhật audio/video"\``);
      }
    }
    lines.push("");
  }

  if (argonTickets.length === 0 && hydrogenTickets.length === 0) {
    lines.push("Hiện không có ticket nào đang mở.");
  }

  return lines.join("\n").trim();
}

export function RevisionPanel({
  mode = "course",
  courseId,
  episodes = [],
  episode = null,
  currentSceneId = "",
  scenes = null,
  onOpenAiRewrite = null,
  onOpenScriptingStage = null,
  onJumpToTicket,
  onStateAction,
  onTriggerProduction,
  onCreateRevision = null,
  activeJob = null,
}) {
  const sceneList = useMemo(() => {
    const raw =
      Array.isArray(scenes) && scenes.length > 0
        ? scenes
        : episode?.script?.scenes || [];
    return raw.map((sc, idx) => ({
      id: sc.id,
      title: sc.title || sc.id,
      index: typeof sc.index === "number" ? sc.index : idx,
    }));
  }, [scenes, episode]);

  const allTickets = useMemo(() => {
    if (mode === "episode" && episode) {
      const scMap = new Map(sceneList.map((s) => [s.id, { idx: s.index, title: s.title }]));
      return (episode.state?.revisions || []).map((rev) => ({
        ...rev,
        _episodeId: episode.id,
        _episodeNumber: episode.number,
        _episodeTitle: episode.title,
        _sceneInfo: rev.scene_id ? scMap.get(rev.scene_id) : null,
      }));
    }

    const list = [];
    for (const ep of episodes) {
      const scMap = new Map((ep.script?.scenes || []).map((s, idx) => [s.id, { idx, title: s.title }]));
      const revs = ep.state?.revisions || [];
      for (const rev of revs) {
        list.push({
          ...rev,
          _episodeId: ep.id,
          _episodeNumber: ep.number,
          _episodeTitle: ep.title,
          _sceneInfo: rev.scene_id ? scMap.get(rev.scene_id) : null,
        });
      }
    }
    return list.sort((a, b) => {
      const order = { open: 0, in_progress: 1, resolved: 2 };
      const diff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      if (diff !== 0) return diff;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }, [mode, episode, episodes, sceneList]);

  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, resolved: 0, all: allTickets.length };
    for (const t of allTickets) {
      if (c[t.status] !== undefined) c[t.status] += 1;
    }
    return c;
  }, [allTickets]);

  const [statusFilter, setStatusFilter] = useState(() => (counts.open > 0 ? "open" : "all"));
  const [busyKey, setBusyKey] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // Inline Quick-Add Revision Form state (episode mode)
  const [quickSceneId, setQuickSceneId] = useState(currentSceneId || "");
  const [sceneManualOverride, setSceneManualOverride] = useState(false);
  const [quickScope, setQuickScope] = useState("script");
  const [quickDesc, setQuickDesc] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  useEffect(() => {
    setSceneManualOverride(false);
    setQuickSceneId(currentSceneId || "");
    setQuickScope("script");
    setQuickDesc("");
  }, [episode?.id]);

  useEffect(() => {
    if (!sceneManualOverride) {
      setQuickSceneId(currentSceneId || "");
    }
  }, [currentSceneId, sceneManualOverride]);

  const visibleTickets = useMemo(() => {
    if (statusFilter === "all") return allTickets;
    return allTickets.filter((t) => t.status === statusFilter);
  }, [allTickets, statusFilter]);

  const openOrProgressCount = counts.open + counts.in_progress;
  const hasOpenProductionTicket = useMemo(
    () => allTickets.some((t) => t.scope === "production" && t.status !== "resolved"),
    [allTickets]
  );
  const isJobRunning = Boolean(activeJob && (activeJob.status === "queued" || activeJob.status === "running"));

  const handleQuickCreate = async (e) => {
    e.preventDefault();
    if (mode !== "episode" || !episode || quickBusy) return;
    const desc = quickDesc.trim();
    if (!desc) {
      setErrMsg("Vui lòng nhập mô tả yêu cầu sửa.");
      return;
    }
    setQuickBusy(true);
    setErrMsg("");
    try {
      const payload = {
        course: courseId,
        episode: episode.id,
        action: "create_revision",
        scope: quickScope,
        scene_id: quickSceneId || null,
        description: desc,
        owner: "user-ui",
      };
      if (onStateAction) {
        await onStateAction(payload);
      } else {
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      }
      setQuickDesc("");
      setSceneManualOverride(false);
      setQuickSceneId(currentSceneId || "");
      if (statusFilter !== "open" && statusFilter !== "all") {
        setStatusFilter("open");
      }
    } catch (err) {
      setErrMsg(err.message || "Không thể tạo yêu cầu sửa.");
    } finally {
      setQuickBusy(false);
    }
  };

  const handleUpdateTicket = async (e, ticket, nextStatus, resolutionNote = "") => {
    e.stopPropagation();
    if (!onStateAction || busyKey) return;
    const key = `${ticket._episodeId}:${ticket.id}:${nextStatus}`;
    setBusyKey(key);
    setErrMsg("");
    try {
      await onStateAction({
        course: courseId,
        episode: ticket._episodeId,
        action: "update_revision",
        rev_id: ticket.id,
        status: nextStatus,
        resolution_note: resolutionNote,
        owner: "user-ui",
      });
    } catch (err) {
      setErrMsg(err.message || "Không thể cập nhật ticket.");
    } finally {
      setBusyKey("");
    }
  };

  const handleDeleteTicket = async (e, ticket) => {
    e.stopPropagation();
    if (!onStateAction || busyKey) return;
    const key = `${ticket._episodeId}:${ticket.id}:delete`;
    setBusyKey(key);
    setErrMsg("");
    try {
      await onStateAction({
        course: courseId,
        episode: ticket._episodeId,
        action: "delete_revision",
        rev_id: ticket.id,
      });
    } catch (err) {
      setErrMsg(err.message || "Không thể xóa ticket.");
    } finally {
      setBusyKey("");
    }
  };

  const handleCopyPrompt = async () => {
    const promptText = buildAgentPrompt({
      courseId,
      episode: mode === "episode" ? episode : null,
      tickets: allTickets,
    });
    const ok = await copyTextSafe(promptText);
    setCopyStatus(ok ? "✅ Đã copy Prompt cho Agent!" : "⚠️ Không copy được tự động");
    setTimeout(() => setCopyStatus(""), 2800);
  };

  return h(
    "div",
    { className: "revision-panel" },
    // Inline Quick-Add Revision Form (Player / Lesson Detail tab 🛠️ Sửa)
    mode === "episode" && episode
      ? h(
          "form",
          { className: "rev-quick-form", onSubmit: handleQuickCreate },
          h(
            "div",
            { className: "rev-quick-form-head" },
            h("span", { className: "rev-quick-title" }, "➕ Thêm yêu cầu sửa nhanh"),
            sceneManualOverride
              ? h("span", { className: "rev-quick-lock-hint" }, "Đã khóa cảnh chọn")
              : null
          ),
          h(
            "div",
            { className: "rev-quick-row" },
            h(
              "select",
              {
                className: "studio-input studio-input-sm rev-quick-select",
                "aria-label": "Phân cảnh cần sửa",
                value: quickSceneId,
                disabled: quickBusy,
                onChange: (e) => {
                  setQuickSceneId(e.target.value);
                  setSceneManualOverride(true);
                },
              },
              h("option", { value: "" }, "Toàn tập"),
              ...sceneList.map((sc) =>
                h(
                  "option",
                  { key: sc.id, value: sc.id },
                  `Cảnh ${String(sc.index + 1).padStart(2, "0")} — ${sc.title}`
                )
              )
            )
          ),
          h(
            "div",
            { className: "rev-quick-scope-row" },
            ...QUICK_SCOPES.map((sc) =>
              h(
                "button",
                {
                  key: sc.id,
                  type: "button",
                  className: `rev-quick-scope-pill ${quickScope === sc.id ? "is-active" : ""}`,
                  "data-scope": sc.id,
                  disabled: quickBusy,
                  onClick: () => setQuickScope(sc.id),
                },
                sc.label
              )
            )
          ),
          h("textarea", {
            className: "studio-textarea rev-quick-textarea",
            rows: 2,
            value: quickDesc,
            disabled: quickBusy,
            onChange: (e) => setQuickDesc(e.target.value),
            placeholder: "Mô tả ngắn điểm cần sửa (lời thoại, sơ đồ, animation, giọng đọc)...",
          }),
          h(
            "div",
            { className: "rev-quick-footer" },
            h(
              "button",
              {
                type: "submit",
                className: "rev-quick-submit",
                disabled: quickBusy || !quickDesc.trim(),
              },
              quickBusy ? "⏳ Đang thêm..." : "+ Thêm yêu cầu"
            )
          )
        )
      : null,

    // Filter pills
    h(
      "div",
      { className: "rev-filter-row" },
      ...FILTER_TABS.map((tab) =>
        h(
          "button",
          {
            key: tab.id,
            type: "button",
            className: `rev-filter-pill ${statusFilter === tab.id ? "is-active" : ""}`,
            onClick: () => setStatusFilter(tab.id),
          },
          `${tab.label} (${counts[tab.id] || 0})`
        )
      )
    ),

    // Action bar (Primary AI Rewrite + Copy Agent Prompt + Conditional Production Retry)
    (mode === "episode" || openOrProgressCount > 0)
      ? h(
          "div",
          { className: "rev-toolbar-actions" },
          mode === "episode"
            ? h(
                "button",
                {
                  type: "button",
                  className: "rev-btn-ai-rewrite",
                  onClick: () => onOpenAiRewrite && onOpenAiRewrite(),
                  title: "Mở AI Script Modal để AI sửa lại kịch bản kèm toàn bộ yêu cầu đang mở",
                },
                openOrProgressCount > 0
                  ? `🔄 Gửi AI Sửa Kịch Bản (${openOrProgressCount} yêu cầu)`
                  : "🔄 Gửi AI Sửa Kịch Bản"
              )
            : null,
          mode === "episode" && onOpenScriptingStage && (episode?.has_brief || episode?.has_dialogue)
            ? h(
                "button",
                {
                  type: "button",
                  className: "rev-btn-copy-prompt",
                  onClick: () => onOpenScriptingStage(),
                  title: "Mở trình duyệt & chỉnh sửa Brief / Lời thoại (Dual-Text) / Audio-Spine",
                },
                "📝 Xem Brief / Thoại"
              )
            : null,
          openOrProgressCount > 0
            ? h(
                "button",
                {
                  type: "button",
                  className: "rev-btn-copy-prompt",
                  onClick: handleCopyPrompt,
                  title: "Copy danh sách ticket đã phân nhóm Argon (script/visual) vs Hydrogen (production)",
                },
                copyStatus || "📋 Copy Prompt cho Agent"
              )
            : null,
          mode === "episode" && onTriggerProduction && episode?.has_script && hasOpenProductionTicket
            ? h(
                "button",
                {
                  type: "button",
                  className: "rev-btn-run-prod",
                  disabled: isJobRunning,
                  onClick: () =>
                    onTriggerProduction({
                      course: courseId,
                      episode: episode.id,
                      mode: "tts_and_render",
                      format: "webm",
                    }),
                },
                isJobRunning ? "⏳ Đang xử lý TTS & Render..." : "▶ Chạy lại TTS & Render ngay"
              )
            : null
        )
      : null,

    errMsg ? h("div", { className: "modal-error-banner" }, `⚠️ ${errMsg}`) : null,

    // Ticket list
    visibleTickets.length === 0
      ? h(
          "div",
          { className: "empty-feed" },
          allTickets.length === 0
            ? mode === "episode"
              ? "Chưa có yêu cầu sửa nào. Dùng form ở trên để thêm yêu cầu hoặc bấm \"🔄 Gửi AI Sửa Kịch Bản\"."
              : "Chưa có yêu cầu sửa nào. Mở chi tiết từng tập để tạo yêu cầu sửa mới."
            : "Không có ticket nào ở trạng thái đang lọc."
        )
      : h(
          "div",
          { className: "rev-list" },
          ...visibleTickets.map((t) => {
            const sc = SCOPE_META[t.scope] || SCOPE_META.script;
            const st = STATUS_META[t.status] || STATUS_META.open;
            const sceneText = t.scene_id
              ? t._sceneInfo
                ? `Cảnh ${t._sceneInfo.idx + 1}: ${t._sceneInfo.title}`
                : t.scene_id
              : "Toàn tập";

            return h(
              "div",
              {
                key: `${t._episodeId}:${t.id}`,
                className: `rev-card ${st.cls} ${onJumpToTicket ? "is-clickable" : ""}`,
                onClick: () => {
                  if (onJumpToTicket) {
                    onJumpToTicket(t._episodeId, t.scene_id || "");
                  }
                },
                title: onJumpToTicket
                  ? t.scene_id
                    ? `Bấm để mở ngay cảnh ${t.scene_id}`
                    : `Bấm để mở tập ${t._episodeId}`
                  : undefined,
              },
              h(
                "div",
                { className: "rev-card-top" },
                h(
                  "div",
                  { className: "rev-card-badges" },
                  h("span", { className: "rev-id-tag" }, t.id),
                  h("span", { className: `rev-scope-tag ${sc.cls}` }, `${sc.icon} ${sc.label}`),
                  h("span", { className: `rev-status-tag ${st.cls}` }, st.label)
                ),
                h("span", { className: "rev-agent-chip" }, sc.agent)
              ),

              mode === "course"
                ? h(
                    "div",
                    { className: "rev-ep-line" },
                    `Tập ${String(t._episodeNumber || 0).padStart(2, "0")} · ${t._episodeTitle || t._episodeId}`
                  )
                : null,

              h(
                "div",
                { className: "rev-scene-line" },
                h("span", { className: "rev-scene-pill" }, `🎯 ${sceneText}`),
                t.created_at
                  ? h("span", { className: "rev-time" }, formatShortTime(t.created_at))
                  : null
              ),

              h("div", { className: "rev-desc" }, t.description),

              t.resolution_note && t.status === "resolved"
                ? h("div", { className: "rev-res-note" }, `✓ ${t.resolution_note}`)
                : null,

              h(
                "div",
                { className: "rev-card-actions" },
                onJumpToTicket
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "rev-act-btn is-jump",
                        onClick: (e) => {
                          e.stopPropagation();
                          onJumpToTicket(t._episodeId, t.scene_id || "");
                        },
                      },
                      t.scene_id ? "🎬 Tới cảnh" : "▶ Mở tập"
                    )
                  : null,
                t.status !== "resolved" && onStateAction
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "rev-act-btn is-resolve",
                        disabled: Boolean(busyKey),
                        onClick: (e) =>
                          handleUpdateTicket(e, t, "resolved", "Đã xác nhận sửa xong trên Studio"),
                      },
                      "Đã sửa xong"
                    )
                  : null,
                t.status === "resolved" && onStateAction
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "rev-act-btn is-reopen",
                        disabled: Boolean(busyKey),
                        onClick: (e) => handleUpdateTicket(e, t, "open", ""),
                      },
                      "Mở lại"
                    )
                  : null,
                onStateAction
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "rev-act-btn is-delete",
                        disabled: Boolean(busyKey),
                        onClick: (e) => handleDeleteTicket(e, t),
                      },
                      "Xóa"
                    )
                  : null
              )
            );
          })
        )
  );
}
