import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RoleRoutingPanel } from "./RoleRoutingPanel.mjs";

const h = React.createElement;

const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio"]);

export function isProviderReady(provider) {
  if (!provider) return false;
  if (typeof provider.ready === "boolean") return provider.ready;
  const st = String(provider.auth_status || "").toLowerCase();
  return st === "verified" || st === "online" || st === "ready";
}

function getProviderStatusClass(provider) {
  const st = String(provider?.auth_status || "unconfigured").toLowerCase();
  if (st === "verified" || st === "online" || st === "ready") return "is-ready";
  if (st === "invalid") return "is-auth-error";
  if (st === "quota_exhausted") return "is-quota-exhausted";
  if (st === "standby_needed") return "is-standby";
  return "is-unconfigured";
}

function getProviderStatusIcon(provider) {
  const id = String(provider?.id || "").toLowerCase();
  if (id === "manual_web") return "📝";
  const st = String(provider?.auth_status || "unconfigured").toLowerCase();
  if (st === "online" || st === "verified" || st === "ready") return "🟢";
  if (st === "invalid" || st === "error") return "❌";
  if (st === "quota_exhausted") return "⚠️";
  if (st === "standby_needed") return "🟡";
  return "⚫";
}

function getCredentialBadgeText(provider) {
  const src = String(provider?.credential_source || "none").toLowerCase();
  if (src === "env") return "OS Env";
  if (src === "local_file") return "Key đã lưu";
  if (src === "env+local") return "Env + Local";
  return "";
}

function normalizeModels(models) {
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

export function BrandHealthGrid({
  providersData = null,
  onProvidersLoaded = null,
  selectedProviderId = "",
  selectedModel = "",
  onSelectProvider = null,
  previousBrokenProviderId = "",
  disabled = false,
  compact = false,
  showRoleRouting = true,
}) {
  const [internalData, setInternalData] = useState(providersData);
  const [loading, setLoading] = useState(!providersData);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [customModelByProvider, setCustomModelByProvider] = useState({});
  const [savingId, setSavingId] = useState("");
  const [testingId, setTestingId] = useState("");
  const [testResultByProvider, setTestResultByProvider] = useState({});
  const [panelFeedback, setPanelFeedback] = useState(null);
  const [copiedWorkerCmd, setCopiedWorkerCmd] = useState(false);

  useEffect(() => {
    if (providersData) {
      setInternalData(providersData);
      setLoading(false);
    }
  }, [providersData]);

  const effectiveData = providersData || internalData;
  const providers = useMemo(() => {
    const list = effectiveData?.providers || effectiveData?.brands || [];
    return Array.isArray(list) ? list : [];
  }, [effectiveData]);

  const fetchProviders = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const url = force ? "/api/ai/providers?force=1" : "/api/ai/providers";
        const res = await fetch(url);
        const data = await res.json();
        if (res.ok && data) {
          setInternalData(data);
          onProvidersLoaded && onProvidersLoaded(data);
        }
      } catch {
        // Ignore transient network errors
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onProvidersLoaded]
  );

  useEffect(() => {
    if (!providersData) {
      fetchProviders(false);
    }
  }, [providersData, fetchProviders]);

  const openSetupPanel = (provider) => {
    if (!provider) return;
    const pid = provider.id;
    if (expandedId === pid) {
      setExpandedId("");
      setApiKeyInput("");
      setPanelFeedback(null);
      return;
    }
    setExpandedId(pid);
    setApiKeyInput("");
    setBaseUrlInput(
      provider.endpoint_config?.base_url ||
        provider.base_url ||
        ""
    );
    setPanelFeedback(null);
  };

  const handleSaveCredential = async (provider) => {
    const pid = provider.id;
    const isLocal = LOCAL_PROVIDER_IDS.has(pid);
    const trimmedKey = apiKeyInput.trim();
    const trimmedBase = baseUrlInput.trim();

    if (!isLocal && !trimmedKey && !trimmedBase) {
      setPanelFeedback({ ok: false, msg: "Vui lòng nhập API Key hoặc Base URL mới." });
      return;
    }

    setSavingId(pid);
    setPanelFeedback(null);
    try {
      const payload = { provider_id: pid };
      if (trimmedKey) payload.api_key = trimmedKey;
      if (trimmedBase || provider.endpoint_config?.base_url) {
        payload.base_url = trimmedBase;
      }

      const res = await fetch("/api/ai/providers/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Immediately clear secret input from memory
      setApiKeyInput("");

      if (data.providers_data || data.providers) {
        const nextData = data.providers_data || data;
        setInternalData(nextData);
        onProvidersLoaded && onProvidersLoaded(nextData);
      } else {
        await fetchProviders(true);
      }

      const updated = data.provider || (data.providers || []).find((x) => x.id === pid);
      if (updated && isProviderReady(updated)) {
        const models = normalizeModels(updated.models);
        const firstModel = models[0]?.id || "";
        onSelectProvider && onSelectProvider(pid, firstModel);
        setPanelFeedback({
          ok: true,
          msg: `✅ ${updated.name || pid} đã kết nối thành công (${models.length} models).`,
        });
      } else {
        setPanelFeedback({
          ok: false,
          msg: updated?.last_error || updated?.setup_hint || "Đã lưu cấu hình nhưng kiểm tra chưa thành công.",
        });
      }
    } catch (err) {
      setPanelFeedback({ ok: false, msg: `⚠️ ${err.message || "Không thể lưu cấu hình."}` });
    } finally {
      setSavingId("");
    }
  };

  const handleDeleteCredential = async (provider) => {
    const pid = provider.id;
    setSavingId(pid);
    setPanelFeedback(null);
    try {
      const res = await fetch("/api/ai/providers/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: pid, clear: true, api_key: null }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setApiKeyInput("");
      setBaseUrlInput("");
      if (data.providers_data || data.providers) {
        const nextData = data.providers_data || data;
        setInternalData(nextData);
        onProvidersLoaded && onProvidersLoaded(nextData);
      } else {
        await fetchProviders(true);
      }
      setPanelFeedback({ ok: true, msg: "Đã xóa key lưu cục bộ." });
    } catch (err) {
      setPanelFeedback({ ok: false, msg: `⚠️ ${err.message || "Không thể xóa key."}` });
    } finally {
      setSavingId("");
    }
  };

  const handleTestOneToken = async (provider, modelId) => {
    const pid = provider.id;
    setTestingId(pid);
    setTestResultByProvider((prev) => ({ ...prev, [pid]: null }));
    try {
      const res = await fetch("/api/ai/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: pid,
          model: modelId || "",
          ping_one_token: true,
        }),
      });
      const data = await res.json();
      const ping = data.ping_result || null;
      const ok = res.ok && data.ok !== false && (ping ? ping.ok !== false : true);
      if (!ok) {
        setTestResultByProvider((prev) => ({
          ...prev,
          [pid]: { ok: false, msg: ping?.error || data.error || `HTTP ${res.status}` },
        }));
      } else {
        const ms = ping?.latency_ms ?? data.latency_ms;
        setTestResultByProvider((prev) => ({
          ...prev,
          [pid]: {
            ok: true,
            msg: data.message || `✅ Phản hồi OK (${ms ? `${ms}ms` : "1 token"})`,
          },
        }));
      }
      if (data.provider) {
        await fetchProviders(true);
      }
    } catch (err) {
      setTestResultByProvider((prev) => ({
        ...prev,
        [pid]: { ok: false, msg: err.message || "Lỗi kiểm tra 1 token" },
      }));
    } finally {
      setTestingId("");
    }
  };

  const handleCopyWorkerCmd = async (e) => {
    e && e.stopPropagation();
    try {
      await navigator.clipboard.writeText("Bật VideoMaker Worker");
      setCopiedWorkerCmd(true);
      setTimeout(() => setCopiedWorkerCmd(false), 1800);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const readyCount = providers.filter(isProviderReady).length;
  const expandedProvider = providers.find((p) => p.id === expandedId) || null;
  const effectiveSelectedId =
    selectedProviderId ||
    (!onSelectProvider ? effectiveData?.last_selection?.provider_id || "" : "");
  const effectiveSelectedModel =
    selectedModel ||
    (!onSelectProvider ? effectiveData?.last_selection?.model || "" : "");
  const activeProvider = useMemo(
    () => providers.find((p) => p.id === effectiveSelectedId) || null,
    [providers, effectiveSelectedId]
  );
  const activeBrandLabel = activeProvider
    ? activeProvider.name || activeProvider.label || activeProvider.id
    : "Chưa chọn";
  const activeModelLabel = useMemo(() => {
    if (!activeProvider) return "";
    const models = normalizeModels(activeProvider.models);
    const custom = (customModelByProvider[activeProvider.id] || "").trim();
    if (custom) return custom;
    const match = models.find((m) => m.id === effectiveSelectedModel);
    return (
      match?.label ||
      effectiveSelectedModel ||
      models[0]?.label ||
      models[0]?.id ||
      "Mặc định"
    );
  }, [activeProvider, effectiveSelectedModel, customModelByProvider]);

  return h(
    "div",
    { className: `brand-health-wrap ${compact ? "is-compact" : ""}` },
    h(
      "div",
      { className: "brand-health-header" },
      h(
        "div",
        { className: "brand-health-title-row" },
        h("span", { className: "brand-health-heading" }, "🤖 Chọn Brand & Model AI"),
        h(
          "span",
          { className: "brand-ready-pill" },
          loading ? "Đang quét..." : `${readyCount}/${providers.length} sẵn sàng`
        ),
        activeProvider
          ? h(
              "span",
              {
                className: "brand-active-summary-chip",
                title: `Đang chọn: ${activeBrandLabel} · ${activeModelLabel}`,
              },
              `Đang chọn: ${activeBrandLabel} · ${activeModelLabel}`
            )
          : null
      ),
      h(
        "button",
        {
          type: "button",
          className: "btn-secondary btn-xs brand-refresh-btn",
          disabled: refreshing || disabled,
          onClick: () => fetchProviders(true),
          title: "Quét lại toàn bộ kết nối & model thực tế ($0 token)",
        },
        refreshing ? "⏳ Đang quét..." : "🔄 Quét lại"
      )
    ),

    previousBrokenProviderId
      ? h(
          "div",
          { className: "brand-prev-warning" },
          `⚠️ Provider đã dùng trước đó (${previousBrokenProviderId}) hiện không sẵn sàng hoặc hết quota. Vui lòng chọn Brand/Model khác hoặc cập nhật key bên dưới.`
        )
      : null,

    loading && providers.length === 0
      ? h("div", { className: "brand-loading-box" }, "Đang kiểm tra trạng thái các AI Providers...")
      : h(
          "div",
          { className: "brand-grid" },
          ...providers.map((p) => {
            const ready = isProviderReady(p);
            const statusCls = getProviderStatusClass(p);
            const icon = getProviderStatusIcon(p);
            const isSelected = effectiveSelectedId === p.id;
            const isBrokenPrev = previousBrokenProviderId && previousBrokenProviderId === p.id && !ready;
            const models = normalizeModels(p.models);
            const currentCustom = customModelByProvider[p.id] ?? "";
            const effectiveModel = isSelected
              ? effectiveSelectedModel || models[0]?.id || ""
              : models[0]?.id || "";
            const credBadge = getCredentialBadgeText(p);
            const showPing =
              typeof p.supports_ping === "boolean"
                ? p.supports_ping
                : p.id !== "antigravity" &&
                  p.id !== "manual_web" &&
                  !LOCAL_PROVIDER_IDS.has(p.id);
            const testRes = testResultByProvider[p.id];

            return h(
              "div",
              {
                key: p.id,
                className: [
                  "brand-card",
                  statusCls,
                  isSelected ? "is-selected" : "",
                  isBrokenPrev ? "is-prev-broken" : "",
                  expandedId === p.id ? "is-expanded" : "",
                ]
                  .filter(Boolean)
                  .join(" "),
                "data-provider-id": p.id,
                "data-auth-status": p.auth_status || "unconfigured",
                onClick: () => {
                  if (disabled) return;
                  if (ready) {
                    const picked =
                      (isSelected && effectiveSelectedModel) ||
                      currentCustom.trim() ||
                      models[0]?.id ||
                      "";
                    onSelectProvider && onSelectProvider(p.id, picked);
                  } else {
                    openSetupPanel(p);
                  }
                },
              },
              // Card top: radio + icon + name + status badge
              h(
                "div",
                { className: "brand-card-top" },
                h(
                  "div",
                  { className: "brand-card-name-row" },
                  ready
                    ? h(
                        "span",
                        {
                          className: `brand-radio-dot ${isSelected ? "is-selected" : ""}`,
                          "aria-hidden": "true",
                        },
                        isSelected ? "◉" : "○"
                      )
                    : null,
                  h("span", { className: "brand-status-icon", "aria-hidden": "true" }, icon),
                  h(
                    "span",
                    {
                      className: "brand-card-name",
                      title: p.name || p.label || p.id,
                    },
                    p.name || p.label || p.id
                  )
                ),
                h(
                  "span",
                  { className: `brand-status-badge ${statusCls}` },
                  p.status_label || p.auth_status || "Chưa cấu hình"
                )
              ),

              // Meta chips (selected pill, credential source, quota_info.summary, models_source)
              h(
                "div",
                { className: "brand-card-meta" },
                isSelected
                  ? h("span", { className: "brand-selected-pill" }, "✓ Đang chọn")
                  : null,
                credBadge ? h("span", { className: "brand-meta-chip" }, credBadge) : null,
                p.quota_info?.summary
                  ? h("span", { className: "brand-quota-chip" }, p.quota_info.summary)
                  : null,
                p.models_source === "live" && models.length > 0
                  ? h("span", { className: "brand-meta-chip is-live" }, `${models.length} models`)
                  : null
              ),

              // Ready state: model dropdown + optional custom model + test ping + config button
              ready
                ? h(
                    "div",
                    {
                      className: "brand-card-ready-body",
                      onClick: (e) => e.stopPropagation(),
                    },
                    models.length > 0
                      ? h(
                          "select",
                          {
                            className: "studio-input studio-input-sm brand-model-select",
                            value: models.some((m) => m.id === effectiveModel)
                              ? effectiveModel
                              : models[0]?.id || "",
                            disabled: disabled,
                            onChange: (e) => {
                              const nextModel = e.target.value;
                              setCustomModelByProvider((prev) => ({ ...prev, [p.id]: "" }));
                              onSelectProvider && onSelectProvider(p.id, nextModel);
                            },
                          },
                          ...models.map((m) =>
                            h("option", { key: m.id, value: m.id }, m.label || m.id)
                          )
                        )
                      : null,

                    p.allow_custom_model
                      ? h("input", {
                          type: "text",
                          className: "studio-input studio-input-sm brand-custom-model-input",
                          placeholder: "Hoặc nhập tên model tùy chỉnh...",
                          value: currentCustom,
                          disabled: disabled,
                          onChange: (e) => {
                            const val = e.target.value;
                            setCustomModelByProvider((prev) => ({ ...prev, [p.id]: val }));
                            if (val.trim()) {
                              onSelectProvider && onSelectProvider(p.id, val.trim());
                            }
                          },
                        })
                      : null,

                    h(
                      "div",
                      { className: "brand-card-actions-row" },
                      showPing
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "brand-mini-btn",
                              disabled: disabled || testingId === p.id,
                              onClick: () =>
                                handleTestOneToken(
                                  p,
                                  currentCustom.trim() || effectiveModel
                                ),
                              title: "Gửi 1 token kiểm tra tín dụng thực tế",
                            },
                            testingId === p.id ? "⏳ Đang test..." : "🧪 Test 1 token"
                          )
                        : null,
                      p.id !== "antigravity" && p.id !== "manual_web"
                        ? h(
                            "button",
                            {
                              type: "button",
                              className: "brand-mini-btn",
                              disabled: disabled,
                              onClick: () => openSetupPanel(p),
                            },
                            expandedId === p.id ? "Ẩn cấu hình" : "🔑 Key / URL"
                          )
                        : null
                    ),

                    testRes
                      ? h(
                          "div",
                          {
                            className: `brand-test-result ${testRes.ok ? "is-ok" : "is-err"}`,
                          },
                          testRes.msg
                        )
                      : null
                  )
                : h(
                    "div",
                    { className: "brand-card-dim-body" },
                    p.last_error
                      ? h("div", { className: "brand-error-line" }, p.last_error)
                      : null,
                    p.setup_hint
                      ? h("div", { className: "brand-hint-line" }, p.setup_hint)
                      : null,
                    h(
                      "div",
                      { className: "brand-setup-cta" },
                      p.id === "antigravity"
                        ? "Bấm để xem lệnh bật Worker"
                        : LOCAL_PROVIDER_IDS.has(p.id)
                          ? "Bấm để cấu hình Endpoint"
                          : "Bấm để nhập / đổi API Key"
                    )
                  )
            );
          })
        ),

    // Inline credential / setup panel for the clicked card
    expandedProvider
      ? h(
          "div",
          {
            className: "brand-setup-panel",
            onClick: (e) => e.stopPropagation(),
          },
          h(
            "div",
            { className: "brand-setup-panel-head" },
            h(
              "strong",
              null,
              `⚙️ Cấu hình ${expandedProvider.name || expandedProvider.id}`
            ),
            h(
              "button",
              {
                type: "button",
                className: "brand-mini-btn",
                onClick: () => {
                  setExpandedId("");
                  setApiKeyInput("");
                  setPanelFeedback(null);
                },
              },
              "✕ Đóng"
            )
          ),

          expandedProvider.id === "antigravity"
            ? h(
                "div",
                { className: "brand-antigravity-setup" },
                h(
                  "p",
                  { className: "brand-hint-line" },
                  expandedProvider.setup_hint ||
                    'Mở chat Antigravity IDE (Argon) và gửi lệnh để kết nối MCP Worker:'
                ),
                h(
                  "div",
                  { className: "ai-offline-cmd-row" },
                  h("code", { className: "worker-cmd-chip" }, "Bật VideoMaker Worker"),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "btn-secondary btn-xs",
                      onClick: handleCopyWorkerCmd,
                    },
                    copiedWorkerCmd ? "✅ Đã copy" : "📋 Copy lệnh"
                  )
                )
              )
            : h(
                "div",
                { className: "brand-cred-form" },
                !LOCAL_PROVIDER_IDS.has(expandedProvider.id)
                  ? h(
                      "div",
                      { className: "brand-cred-field" },
                      h("label", { className: "form-label-sm" }, "API Key (chỉ lưu cục bộ trên máy bạn, không gửi ra UI)"),
                      h("input", {
                        type: "password",
                        autoComplete: "new-password",
                        className: "studio-input studio-input-sm",
                        placeholder: expandedProvider.has_credential
                          ? "Nhập API Key mới để thay thế..."
                          : "Dán API Key...",
                        value: apiKeyInput,
                        disabled: savingId === expandedProvider.id,
                        onChange: (e) => setApiKeyInput(e.target.value),
                      })
                    )
                  : null,

                h(
                  "div",
                  { className: "brand-cred-field" },
                  h(
                    "label",
                    { className: "form-label-sm" },
                    LOCAL_PROVIDER_IDS.has(expandedProvider.id)
                      ? "Endpoint URL"
                      : "Base URL tùy chỉnh (tùy chọn — để trống dùng mặc định)"
                  ),
                  h("input", {
                    type: "text",
                    className: "studio-input studio-input-sm",
                    placeholder:
                      expandedProvider.endpoint_config?.default_base_url ||
                      "https://...",
                    value: baseUrlInput,
                    disabled: savingId === expandedProvider.id,
                    onChange: (e) => setBaseUrlInput(e.target.value),
                  })
                ),

                expandedProvider.credential_source === "env"
                  ? h(
                      "div",
                      { className: "brand-hint-line" },
                      "ℹ️ Đang dùng biến môi trường OS (OS Env). Lưu key tại đây sẽ ghi đè ưu tiên cục bộ."
                    )
                  : null,

                h(
                  "div",
                  { className: "brand-cred-actions" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "btn-export btn-xs",
                      disabled: savingId === expandedProvider.id,
                      onClick: () => handleSaveCredential(expandedProvider),
                    },
                    savingId === expandedProvider.id
                      ? "⏳ Đang kiểm tra..."
                      : "💾 Lưu & Kiểm tra"
                  ),
                  expandedProvider.has_credential &&
                    (expandedProvider.credential_source === "local_file" ||
                      expandedProvider.credential_source === "env+local")
                    ? h(
                        "button",
                        {
                          type: "button",
                          className: "ep-ai-cancel-btn",
                          disabled: savingId === expandedProvider.id,
                          onClick: () => handleDeleteCredential(expandedProvider),
                        },
                        "🗑️ Xóa key"
                      )
                    : null
                ),

                panelFeedback
                  ? h(
                      "div",
                      {
                        className: `brand-test-result ${
                          panelFeedback.ok ? "is-ok" : "is-err"
                        }`,
                      },
                      panelFeedback.msg
                    )
                  : null
              )
        )
      : null,

    showRoleRouting
      ? h(RoleRoutingPanel, {
          providersData: effectiveData,
          disabled,
          compact,
          defaultExpanded: false,
          onRoutingSaved: (nextRouting) => {
            const base =
              effectiveData && typeof effectiveData === "object" ? effectiveData : {};
            const nextData = { ...base, pipeline_routing: nextRouting };
            setInternalData(nextData);
            onProvidersLoaded && onProvidersLoaded(nextData);
          },
        })
      : null
  );
}
