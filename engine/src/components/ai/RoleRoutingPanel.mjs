import React, { useEffect, useMemo, useState } from "react";

const h = React.createElement;

export const PIPELINE_ROLE_SPECS = Object.freeze([
  {
    key: "outliner",
    label: "Đề cương (Outliner)",
    shortLabel: "Outliner",
    description: "Lập cấu trúc chặng & lộ trình bài học",
  },
  {
    key: "brief_scriptwriter",
    label: "Brief & Lời thoại (Tầng 1–2)",
    shortLabel: "Brief & Thoại",
    description: "Lập Content Brief, Hook & viết thoại TTS",
  },
  {
    key: "visual_director",
    label: "Đạo diễn Visual (Tầng 3)",
    shortLabel: "Visual",
    description: "Chọn template, bố cục sơ đồ & motion",
  },
  {
    key: "repair",
    label: "Tự sửa cảnh lỗi (Repair)",
    shortLabel: "Repair",
    description: "Tự động sửa cảnh chưa đạt kiểm định QC",
  },
]);

function isProviderReadyLocal(provider) {
  if (!provider) return false;
  if (typeof provider.ready === "boolean") return provider.ready;
  const st = String(provider.auth_status || "").toLowerCase();
  return st === "verified" || st === "online" || st === "ready";
}

function normalizeModelsLocal(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => {
      if (typeof m === "string") return { id: m, label: m };
      if (m && typeof m === "object" && m.id) {
        return { id: String(m.id), label: String(m.label || m.id) };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeDraftRouting(rawRouting) {
  const src = rawRouting && typeof rawRouting === "object" ? rawRouting : {};
  const next = {};
  for (const role of PIPELINE_ROLE_SPECS) {
    const entry = src[role.key];
    if (entry && typeof entry === "object" && entry.provider_id) {
      next[role.key] = {
        provider_id: String(entry.provider_id),
        model: entry.model ? String(entry.model) : "",
      };
    } else {
      next[role.key] = null;
    }
  }
  return next;
}

export function RoleRoutingPanel({
  providersData = null,
  onRoutingSaved = null,
  disabled = false,
  compact = false,
  defaultExpanded = false,
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const [draftRouting, setDraftRouting] = useState(() =>
    normalizeDraftRouting(providersData?.pipeline_routing)
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const incomingRoutingKey = useMemo(
    () => JSON.stringify(normalizeDraftRouting(providersData?.pipeline_routing)),
    [providersData?.pipeline_routing]
  );

  useEffect(() => {
    setDraftRouting(normalizeDraftRouting(providersData?.pipeline_routing));
  }, [incomingRoutingKey]);

  const eligibleProviders = useMemo(() => {
    const list = providersData?.providers || providersData?.brands || [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p) =>
        p &&
        p.id &&
        p.execution_mode === "builtin" &&
        p.id !== "antigravity" &&
        p.id !== "manual_web"
    );
  }, [providersData]);

  const providerMap = useMemo(() => {
    const m = new Map();
    for (const p of eligibleProviders) m.set(p.id, p);
    return m;
  }, [eligibleProviders]);

  const overriddenRoles = useMemo(
    () =>
      PIPELINE_ROLE_SPECS.filter((role) => Boolean(draftRouting[role.key]?.provider_id)),
    [draftRouting]
  );

  const customCount = overriddenRoles.length;

  const updateRoleProvider = (roleKey, providerId) => {
    setFeedback(null);
    setDraftRouting((prev) => {
      if (!providerId) {
        return { ...prev, [roleKey]: null };
      }
      if (prev[roleKey]?.provider_id === providerId) {
        return prev;
      }
      return {
        ...prev,
        [roleKey]: { provider_id: providerId, model: "" },
      };
    });
  };

  const updateRoleModel = (roleKey, modelId) => {
    setFeedback(null);
    setDraftRouting((prev) => {
      const cur = prev[roleKey];
      if (!cur || !cur.provider_id) return prev;
      return {
        ...prev,
        [roleKey]: {
          provider_id: cur.provider_id,
          model: modelId,
        },
      };
    });
  };

  const persistRouting = async (routingPayload, successMsg) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/ai/preferences/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_routing: routingPayload }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const nextRouting = data.pipeline_routing || routingPayload;
      setDraftRouting(normalizeDraftRouting(nextRouting));
      setFeedback({ ok: true, msg: successMsg });
      onRoutingSaved && onRoutingSaved(nextRouting);
    } catch (err) {
      setFeedback({
        ok: false,
        msg: `⚠️ ${err?.message || "Không thể lưu định tuyến AI."}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    const payload = {};
    for (const role of PIPELINE_ROLE_SPECS) {
      const entry = draftRouting[role.key];
      if (entry && entry.provider_id) {
        const trimmedModel = String(entry.model || "").trim();
        payload[role.key] = {
          provider_id: entry.provider_id,
          model: trimmedModel || null,
        };
      } else {
        payload[role.key] = null;
      }
    }
    void persistRouting(payload, "✅ Đã lưu định tuyến AI theo vai trò.");
  };

  const handleReset = () => {
    const payload = {};
    for (const role of PIPELINE_ROLE_SPECS) {
      payload[role.key] = null;
    }
    void persistRouting(payload, "↺ Đã đặt lại toàn bộ vai trò về mặc định chung.");
  };

  return h(
    "div",
    {
      className: `role-routing-panel ${compact ? "is-compact" : ""} ${expanded ? "is-expanded" : ""}`,
      "data-testid": "role-routing-panel",
    },
    h(
      "button",
      {
        type: "button",
        className: "role-routing-toggle",
        "data-testid": "role-routing-toggle",
        "aria-expanded": expanded,
        onClick: () => setExpanded((v) => !v),
      },
      h(
        "span",
        { className: "role-routing-toggle-main" },
        h("span", { className: "role-routing-title" }, "🧭 Định tuyến AI theo vai trò"),
        h(
          "span",
          {
            className: `role-routing-count-pill ${customCount > 0 ? "is-custom" : ""}`,
            "data-testid": "role-routing-count-pill",
          },
          customCount > 0 ? `${customCount}/4 tùy chỉnh` : "Mặc định chung"
        ),
        customCount > 0
          ? h(
              "span",
              { className: "role-routing-chips" },
              ...overriddenRoles.map((role) => {
                const entry = draftRouting[role.key];
                const prov = providerMap.get(entry.provider_id);
                const provName = prov?.name || prov?.label || entry.provider_id;
                const summaryText = entry.model
                  ? `${role.shortLabel}: ${provName} · ${entry.model}`
                  : `${role.shortLabel}: ${provName}`;
                return h(
                  "span",
                  {
                    key: role.key,
                    className: "role-routing-chip",
                    title: `${role.label} → ${provName}${entry.model ? ` (${entry.model})` : ""}`,
                  },
                  summaryText
                );
              })
            )
          : null
      ),
      h("span", { className: "role-routing-chevron", "aria-hidden": "true" }, expanded ? "▾" : "▸")
    ),

    expanded
      ? h(
          "div",
          {
            className: "role-routing-body",
            "data-testid": "role-routing-body",
          },
          h(
            "div",
            { className: "role-routing-rows" },
            ...PIPELINE_ROLE_SPECS.map((role) => {
              const entry = draftRouting[role.key];
              const chosenPid = entry?.provider_id || "";
              const chosenProvider = chosenPid ? providerMap.get(chosenPid) || null : null;
              const models = normalizeModelsLocal(chosenProvider?.models);
              const currentModel = entry?.model || "";
              const inLiveList = Boolean(currentModel && models.some((m) => m.id === currentModel));
              const hasCustomValue = Boolean(currentModel && !inLiveList);
              const showCustomInput = Boolean(
                chosenPid && (chosenProvider?.allow_custom_model || hasCustomValue)
              );
              const selectModelValue = inLiveList
                ? currentModel
                : hasCustomValue
                  ? currentModel
                  : "";

              return h(
                "div",
                {
                  key: role.key,
                  className: `role-routing-row ${chosenPid ? "is-overridden" : ""}`,
                  "data-role": role.key,
                },
                h(
                  "div",
                  { className: "role-routing-role-info" },
                  h("span", { className: "role-routing-role-label" }, role.label),
                  h("span", { className: "role-routing-role-desc" }, role.description)
                ),
                h(
                  "div",
                  { className: "role-routing-controls" },
                  h(
                    "select",
                    {
                      className: "studio-input studio-input-sm role-routing-select",
                      "data-role-provider": role.key,
                      "aria-label": `${role.label} Provider`,
                      value: chosenPid,
                      disabled: disabled || saving,
                      onChange: (e) => updateRoleProvider(role.key, e.target.value),
                    },
                    h("option", { value: "" }, "Theo mặc định Job / chọn chung"),
                    ...eligibleProviders.map((p) => {
                      const ready = isProviderReadyLocal(p);
                      const statusNote = ready
                        ? ""
                        : ` (${p.status_label || "Chưa cấu hình"})`;
                      return h(
                        "option",
                        { key: p.id, value: p.id },
                        `${ready ? "🟢" : "⚫"} ${p.name || p.label || p.id}${statusNote}`
                      );
                    }),
                    chosenPid && !chosenProvider
                      ? h("option", { key: `__missing_${chosenPid}`, value: chosenPid }, chosenPid)
                      : null
                  ),
                  h(
                    "select",
                    {
                      className: "studio-input studio-input-sm role-routing-select",
                      "data-role-model": role.key,
                      "aria-label": `${role.label} Model`,
                      value: selectModelValue,
                      disabled: disabled || saving || !chosenPid,
                      onChange: (e) => updateRoleModel(role.key, e.target.value),
                    },
                    h("option", { value: "" }, "Mặc định provider"),
                    ...models.map((m) =>
                      h("option", { key: m.id, value: m.id }, m.label || m.id)
                    ),
                    hasCustomValue
                      ? h(
                          "option",
                          { key: `__custom_${currentModel}`, value: currentModel },
                          `${currentModel} (tùy chỉnh)`
                        )
                      : null
                  ),
                  showCustomInput
                    ? h("input", {
                        type: "text",
                        className: "studio-input studio-input-sm role-routing-custom-input",
                        "data-role-custom-model": role.key,
                        "aria-label": `${role.label} Custom Model`,
                        placeholder: "Model tùy chỉnh...",
                        value: inLiveList ? "" : currentModel,
                        disabled: disabled || saving,
                        onChange: (e) => updateRoleModel(role.key, e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === "Enter") e.preventDefault();
                        },
                      })
                    : null
                )
              );
            })
          ),

          h(
            "div",
            { className: "role-routing-footer" },
            h(
              "div",
              { className: "role-routing-actions" },
              h(
                "button",
                {
                  type: "button",
                  className: "btn-export btn-xs role-routing-save-btn",
                  "data-testid": "role-routing-save",
                  disabled: disabled || saving,
                  onClick: handleSave,
                },
                saving ? "⏳ Đang lưu..." : "💾 Lưu định tuyến"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "btn-secondary btn-xs role-routing-reset-btn",
                  "data-testid": "role-routing-reset",
                  disabled: disabled || saving,
                  onClick: handleReset,
                },
                "↺ Đặt lại mặc định"
              )
            ),
            feedback
              ? h(
                  "div",
                  {
                    className: `role-routing-feedback ${feedback.ok ? "is-ok" : "is-err"}`,
                    "data-testid": "role-routing-feedback",
                  },
                  feedback.msg
                )
              : null
          )
        )
      : null
  );
}
