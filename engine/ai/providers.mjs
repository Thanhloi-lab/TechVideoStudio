import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ENGINE_DIR = path.resolve(__dirname, "..");

const HANDSHAKE_CACHE_TTL_MS = 30_000;
const CLOUD_TIMEOUT_MS = 4_000;
const LOCAL_TIMEOUT_MS = 800;
const PING_TIMEOUT_MS = 12_000;

export const BRAND_CATALOG = [
  {
    id: "antigravity",
    name: "Antigravity Worker",
    kind: "mcp",
    execution_mode: "mcp",
    requires_key: false,
    default_base_url: null,
    env_vars: [],
    env_base_url_vars: [],
    allow_custom_model: false,
    supports_ping: false,
  },
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    kind: "cloud",
    execution_mode: "builtin",
    requires_key: true,
    default_base_url: "https://api.openai.com/v1",
    env_vars: ["OPENAI_API_KEY"],
    env_base_url_vars: ["VIDEO_MAKER_OPENAI_BASE_URL", "OPENAI_BASE_URL"],
    allow_custom_model: true,
    supports_ping: true,
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    kind: "cloud",
    execution_mode: "builtin",
    requires_key: true,
    default_base_url: "https://api.anthropic.com/v1",
    env_vars: ["ANTHROPIC_API_KEY"],
    env_base_url_vars: ["VIDEO_MAKER_ANTHROPIC_BASE_URL", "ANTHROPIC_BASE_URL"],
    allow_custom_model: true,
    supports_ping: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "cloud",
    execution_mode: "builtin",
    requires_key: true,
    default_base_url: "https://api.deepseek.com/v1",
    env_vars: ["DEEPSEEK_API_KEY"],
    env_base_url_vars: ["VIDEO_MAKER_DEEPSEEK_BASE_URL", "DEEPSEEK_BASE_URL"],
    allow_custom_model: true,
    supports_ping: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "cloud",
    execution_mode: "builtin",
    requires_key: true,
    default_base_url: "https://generativelanguage.googleapis.com/v1beta",
    env_vars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    env_base_url_vars: ["VIDEO_MAKER_GEMINI_BASE_URL", "GEMINI_BASE_URL"],
    allow_custom_model: true,
    supports_ping: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "cloud",
    execution_mode: "builtin",
    requires_key: true,
    default_base_url: "https://openrouter.ai/api/v1",
    env_vars: ["OPENROUTER_API_KEY"],
    env_base_url_vars: ["VIDEO_MAKER_OPENROUTER_BASE_URL", "OPENROUTER_BASE_URL"],
    allow_custom_model: true,
    supports_ping: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    kind: "local",
    execution_mode: "builtin",
    requires_key: false,
    default_base_url: "http://127.0.0.1:11434",
    env_vars: [],
    env_base_url_vars: ["VIDEO_MAKER_OLLAMA_BASE_URL", "OLLAMA_HOST"],
    allow_custom_model: true,
    supports_ping: false,
  },
  {
    id: "lmstudio",
    name: "LM Studio (Local)",
    kind: "local",
    execution_mode: "builtin",
    requires_key: false,
    default_base_url: "http://127.0.0.1:1234/v1",
    env_vars: [],
    env_base_url_vars: ["VIDEO_MAKER_LMSTUDIO_BASE_URL", "LMSTUDIO_BASE_URL"],
    allow_custom_model: true,
    supports_ping: false,
  },
  {
    id: "manual_web",
    name: "Manual Web ($0)",
    kind: "manual",
    execution_mode: "manual",
    requires_key: false,
    default_base_url: null,
    env_vars: [],
    env_base_url_vars: [],
    allow_custom_model: false,
    supports_ping: false,
  },
];

const BRAND_MAP = new Map(BRAND_CATALOG.map((b) => [b.id, b]));
const handshakeCache = new Map(); // provider_id -> { ts, data }
const runtimeQuotaFlags = new Map(); // provider_id -> { error, at }

export function getBrandSpec(providerId) {
  return BRAND_MAP.get(String(providerId || "").trim()) || null;
}

export function isBuiltinProviderId(providerId) {
  const spec = getBrandSpec(providerId);
  return Boolean(spec && spec.execution_mode === "builtin");
}

function getCredentialsFilePath(engineDir = DEFAULT_ENGINE_DIR) {
  if (process.env.VIDEO_MAKER_AI_CREDENTIALS_FILE) {
    return path.resolve(process.env.VIDEO_MAKER_AI_CREDENTIALS_FILE);
  }
  return path.join(engineDir, ".ai_credentials.json");
}

function getPreferencesFilePath(engineDir = DEFAULT_ENGINE_DIR) {
  if (process.env.VIDEO_MAKER_AI_PREFERENCES_FILE) {
    return path.resolve(process.env.VIDEO_MAKER_AI_PREFERENCES_FILE);
  }
  return path.join(engineDir, ".ai_preferences.json");
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomicLocal(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function sanitizeErrorText(text) {
  return String(text || "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1REDACTED")
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, "REDACTED")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1REDACTED")
    .trim()
    .slice(0, 400);
}

function normalizeBaseUrl(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

function stripVersionSuffix(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v\d+(?:beta)?$/i, "");
}

function loadLocalCredentialsStore(engineDir = DEFAULT_ENGINE_DIR) {
  const filePath = getCredentialsFilePath(engineDir);
  const data = readJsonSafe(filePath, { version: 1, providers: {} });
  if (!data.providers || typeof data.providers !== "object") {
    data.providers = {};
  }
  return { filePath, data };
}

function resolveProviderCredentialsInternal(providerId, engineDir = DEFAULT_ENGINE_DIR) {
  const spec = getBrandSpec(providerId);
  if (!spec) return null;

  const { data } = loadLocalCredentialsStore(engineDir);
  const saved = data.providers[providerId] && typeof data.providers[providerId] === "object"
    ? data.providers[providerId]
    : {};

  let envKey = "";
  for (const envName of spec.env_vars || []) {
    const val = String(process.env[envName] || "").trim();
    if (val) {
      envKey = val;
      break;
    }
  }
  const localKey = String(saved.api_key || "").trim();

  let credential_source = "none";
  if (envKey && localKey) credential_source = "env+local";
  else if (localKey) credential_source = "local_file";
  else if (envKey) credential_source = "env";

  // Local file takes priority when user explicitly saves/overrides a key in Studio UI
  const apiKey = localKey || envKey || "";
  const has_credential = Boolean(apiKey);

  let envBaseUrl = "";
  for (const envName of spec.env_base_url_vars || []) {
    const val = normalizeBaseUrl(process.env[envName]);
    if (val) {
      envBaseUrl = val;
      break;
    }
  }
  const savedBaseUrl = normalizeBaseUrl(saved.base_url);
  const base_url = savedBaseUrl || envBaseUrl || spec.default_base_url || "";
  const is_custom_base = Boolean(base_url && spec.default_base_url && base_url !== spec.default_base_url);

  return {
    spec,
    api_key: apiKey,
    has_credential,
    credential_source,
    base_url,
    is_custom_base,
  };
}

export const VALID_PIPELINE_ROLES = Object.freeze([
  "outliner",
  "brief_scriptwriter",
  "visual_director",
  "repair",
]);

function normalizePipelineRoutingMap(rawRouting) {
  const out = {};
  const src = rawRouting && typeof rawRouting === "object" ? rawRouting : {};
  for (const role of VALID_PIPELINE_ROLES) {
    const entry = src[role];
    if (entry && typeof entry === "object" && entry.provider_id) {
      const pid = String(entry.provider_id).trim();
      if (getBrandSpec(pid)) {
        out[role] = {
          provider_id: pid,
          model: entry.model ? String(entry.model).trim().slice(0, 160) : null,
        };
        continue;
      }
    }
    out[role] = null;
  }
  return out;
}

export function loadAiPreferences(engineDir = DEFAULT_ENGINE_DIR) {
  const filePath = getPreferencesFilePath(engineDir);
  const raw = readJsonSafe(filePath, {});
  const sel = raw?.last_selection && typeof raw.last_selection === "object" ? raw.last_selection : null;
  return {
    last_selection: sel
      ? {
          provider_id: sel.provider_id ? String(sel.provider_id) : null,
          model: sel.model ? String(sel.model) : null,
          auto_produce: Boolean(sel.auto_produce),
          updated_at: sel.updated_at || null,
        }
      : null,
    pipeline_routing: normalizePipelineRoutingMap(raw?.pipeline_routing),
  };
}

export function saveLastSelection({ provider_id, model, auto_produce = false }, engineDir = DEFAULT_ENGINE_DIR) {
  const filePath = getPreferencesFilePath(engineDir);
  const existing = readJsonSafe(filePath, {});
  const next = {
    ...existing,
    version: 1,
    last_selection: {
      provider_id: provider_id ? String(provider_id) : null,
      model: model ? String(model) : null,
      auto_produce: Boolean(auto_produce),
      updated_at: new Date().toISOString(),
    },
    pipeline_routing: normalizePipelineRoutingMap(existing?.pipeline_routing),
  };
  writeJsonAtomicLocal(filePath, next);
  return next.last_selection;
}

export function savePipelineRouting(routing = {}, engineDir = DEFAULT_ENGINE_DIR) {
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
    throw Object.assign(new Error("pipeline_routing must be an object."), { statusCode: 400 });
  }
  const filePath = getPreferencesFilePath(engineDir);
  const existing = readJsonSafe(filePath, {});
  const merged = { ...normalizePipelineRoutingMap(existing?.pipeline_routing) };

  for (const [role, value] of Object.entries(routing)) {
    if (!VALID_PIPELINE_ROLES.includes(role)) {
      throw Object.assign(
        new Error(`Unknown pipeline role "${role}". Allowed: ${VALID_PIPELINE_ROLES.join(", ")}`),
        { statusCode: 400 }
      );
    }
    if (value === null || value === undefined || value === "") {
      merged[role] = null;
      continue;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw Object.assign(new Error(`Role "${role}" routing entry must be null or { provider_id, model }.`), {
        statusCode: 400,
      });
    }
    const pid = String(value.provider_id || "").trim();
    if (!pid) {
      merged[role] = null;
      continue;
    }
    const spec = getBrandSpec(pid);
    if (!spec) {
      throw Object.assign(new Error(`Unknown provider "${pid}" for role "${role}".`), { statusCode: 400 });
    }
    merged[role] = {
      provider_id: pid,
      model: value.model ? String(value.model).trim().slice(0, 160) : null,
    };
  }

  const next = {
    ...existing,
    version: 1,
    pipeline_routing: merged,
    updated_at: new Date().toISOString(),
  };
  writeJsonAtomicLocal(filePath, next);
  return next.pipeline_routing;
}

export function resolveRoleProvider(
  role,
  { overrides = null, job = null, engineDir = DEFAULT_ENGINE_DIR } = {}
) {
  const prefs = loadAiPreferences(engineDir);
  const isReadyBuiltinOrNonBuiltin = (pid) => {
    const spec = getBrandSpec(pid);
    if (!spec) return false;
    if (spec.execution_mode !== "builtin") return true;
    return resolveProviderExecutionConfig(pid, engineDir).ok;
  };

  // 1. Explicit per-job override (overrides[role])
  const ov = overrides && typeof overrides === "object" ? overrides[role] : null;
  if (ov && typeof ov === "object" && (ov.provider_id || ov.model)) {
    const pid = String(ov.provider_id || job?.provider_id || prefs.last_selection?.provider_id || "").trim();
    const spec = pid ? getBrandSpec(pid) : null;
    if (spec) {
      const mdl =
        (ov.model ? String(ov.model).trim() : null) ||
        (pid === job?.provider_id ? job?.model || null : null) ||
        (pid === prefs.last_selection?.provider_id ? prefs.last_selection?.model || null : null);
      return { provider_id: pid, model: mdl, source: "override" };
    }
  }

  // 2. Saved pipeline_routing[role] (only when provider is configured/ready)
  const savedRole = VALID_PIPELINE_ROLES.includes(role) ? prefs.pipeline_routing?.[role] : null;
  if (savedRole && savedRole.provider_id && isReadyBuiltinOrNonBuiltin(savedRole.provider_id)) {
    const mdl =
      savedRole.model ||
      (savedRole.provider_id === job?.provider_id ? job?.model || null : null) ||
      (savedRole.provider_id === prefs.last_selection?.provider_id ? prefs.last_selection?.model || null : null);
    return { provider_id: savedRole.provider_id, model: mdl, source: "pipeline_routing" };
  }

  // 3. Legacy compiler_provider_id / compiler_model for visual_director & repair
  if ((role === "visual_director" || role === "repair") && (job?.compiler_provider_id || job?.compiler_model)) {
    const pid = String(job.compiler_provider_id || job.provider_id || "").trim();
    if (pid && getBrandSpec(pid)) {
      const mdl = job.compiler_model || (pid === job.provider_id ? job.model || null : null);
      return { provider_id: pid, model: mdl, source: "compiler_legacy" };
    }
  }

  // 4. Job's primary provider/model
  if (job?.provider_id && getBrandSpec(job.provider_id)) {
    return {
      provider_id: String(job.provider_id).trim(),
      model: job.model ? String(job.model).trim() : null,
      source: "job",
    };
  }

  // 5. Saved last_selection
  if (prefs.last_selection?.provider_id && isReadyBuiltinOrNonBuiltin(prefs.last_selection.provider_id)) {
    return {
      provider_id: prefs.last_selection.provider_id,
      model: prefs.last_selection.model || null,
      source: "last_selection",
    };
  }

  return { provider_id: null, model: null, source: "none" };
}

export function invalidateProviderCache(providerId = null) {
  if (providerId) {
    handshakeCache.delete(providerId);
  } else {
    handshakeCache.clear();
  }
}

export function markProviderQuotaExhausted(providerId, errorMsg = "Quota exhausted") {
  if (!providerId) return;
  runtimeQuotaFlags.set(providerId, {
    error: sanitizeErrorText(errorMsg) || "Hết quota hoặc bị giới hạn tốc độ (429/402).",
    at: new Date().toISOString(),
  });
  handshakeCache.delete(providerId);
}

export function clearProviderQuotaExhausted(providerId) {
  if (!providerId) return;
  runtimeQuotaFlags.delete(providerId);
  handshakeCache.delete(providerId);
}

export function saveProviderCredentials(
  { provider_id, api_key, base_url, clear = false },
  engineDir = DEFAULT_ENGINE_DIR
) {
  const spec = getBrandSpec(provider_id);
  if (!spec) {
    throw Object.assign(new Error(`Unknown provider "${provider_id}"`), { statusCode: 400 });
  }
  const { filePath, data } = loadLocalCredentialsStore(engineDir);
  if (clear) {
    delete data.providers[provider_id];
  } else {
    const prev = data.providers[provider_id] && typeof data.providers[provider_id] === "object"
      ? { ...data.providers[provider_id] }
      : {};
    if (api_key !== undefined) {
      const trimmedKey = String(api_key || "").trim();
      if (trimmedKey) prev.api_key = trimmedKey;
      else delete prev.api_key;
    }
    if (base_url !== undefined) {
      const norm = normalizeBaseUrl(base_url);
      if (norm) prev.base_url = norm;
      else delete prev.base_url;
    }
    prev.updated_at = new Date().toISOString();
    if (!prev.api_key && !prev.base_url) {
      delete data.providers[provider_id];
    } else {
      data.providers[provider_id] = prev;
    }
  }
  writeJsonAtomicLocal(filePath, data);
  clearProviderQuotaExhausted(provider_id);
  invalidateProviderCache(provider_id);
}

export function resolveProviderExecutionConfig(providerId, engineDir = DEFAULT_ENGINE_DIR) {
  const resolved = resolveProviderCredentialsInternal(providerId, engineDir);
  if (!resolved) {
    return { ok: false, error: `Unknown provider "${providerId}"` };
  }
  const { spec, api_key, has_credential, base_url } = resolved;
  if (spec.requires_key && !has_credential) {
    return {
      ok: false,
      code: "PROVIDER_UNCONFIGURED",
      error: `Nhà cung cấp "${spec.name}" chưa có API key.`,
    };
  }
  return {
    ok: true,
    provider_id: spec.id,
    name: spec.name,
    kind: spec.kind,
    execution_mode: spec.execution_mode,
    api_key,
    base_url,
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = CLOUD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, text, json };
  } catch (err) {
    const isTimeout = err?.name === "AbortError" || /abort|timeout/i.test(err?.message || "");
    return {
      ok: false,
      status: 0,
      text: isTimeout ? `Timeout after ${timeoutMs}ms` : String(err?.message || err),
      json: null,
      networkError: true,
      isTimeout,
    };
  } finally {
    clearTimeout(timer);
  }
}

function filterOpenAiModels(rawList) {
  const rejectRe = /(embedding|tts|whisper|dall-e|moderation|audio|realtime|transcribe|sora|babbage|davinci)/i;
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(rawList) ? rawList : []) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id) || rejectRe.test(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function detectPluginInstalled(workspaceRoot) {
  const candidates = [
    workspaceRoot ? path.join(workspaceRoot, ".agents", "plugins", "tech-video-studio") : null,
    path.join(os.homedir(), ".gemini", "config", "plugins", "tech-video-studio"),
  ].filter(Boolean);
  return candidates.some((dir) => fs.existsSync(dir));
}

function formatBaseResult(resolved, overrides = {}) {
  const { spec, has_credential, credential_source, base_url, is_custom_base } = resolved;
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    execution_mode: spec.execution_mode,
    requires_key: spec.requires_key,
    has_credential,
    credential_source,
    auth_status: "unconfigured",
    ready: false,
    status_label: "Chưa cấu hình",
    setup_hint: "",
    last_error: null,
    models: [],
    models_source: "none",
    quota_info: null,
    allow_custom_model: Boolean(spec.allow_custom_model),
    supports_ping: Boolean(spec.supports_ping),
    endpoint_config: spec.default_base_url
      ? {
          base_url,
          default_base_url: spec.default_base_url,
          is_custom: is_custom_base,
        }
      : null,
    ...overrides,
  };
}

function applyRuntimeQuotaIfSet(providerId, result) {
  const flag = runtimeQuotaFlags.get(providerId);
  if (!flag) return result;
  if (result.auth_status === "invalid" || result.auth_status === "unconfigured") {
    return result;
  }
  return {
    ...result,
    auth_status: "quota_exhausted",
    ready: false,
    status_label: "Hết Quota / Giới hạn (429)",
    last_error: flag.error,
    setup_hint: result.setup_hint || "Kiểm tra số dư / hạn mức tài khoản hoặc test lại 1 token.",
  };
}

async function runLiveHandshake(providerId, { workerStatus = null, workspaceRoot = null, engineDir = DEFAULT_ENGINE_DIR } = {}) {
  const resolved = resolveProviderCredentialsInternal(providerId, engineDir);
  if (!resolved) {
    throw new Error(`Unknown provider "${providerId}"`);
  }
  const { spec, api_key, has_credential, base_url } = resolved;

  if (providerId === "manual_web") {
    return formatBaseResult(resolved, {
      auth_status: "ready",
      status: "ready",
      ready: true,
      status_label: "Sẵn sàng ($0 Web)",
      setup_hint: "Copy prompt đem sang ChatGPT/Claude/Gemini web, rồi dán JSON kết quả vào Studio.",
      models: [],
      models_source: "manual",
    });
  }

  if (providerId === "antigravity") {
    if (workerStatus?.online && workerStatus.primary_worker) {
      const seen = new Set();
      const models = [];
      for (const w of workerStatus.workers || [workerStatus.primary_worker]) {
        const m = String(w?.model || "").trim();
        if (m && !seen.has(m)) {
          seen.add(m);
          models.push({ id: m, label: m });
        }
      }
      return formatBaseResult(resolved, {
        auth_status: "online",
        ready: true,
        status_label: "Online",
        setup_hint: `Worker ${workerStatus.primary_worker.worker_id} đang kết nối.`,
        models,
        models_source: "heartbeat",
      });
    }
    const pluginInstalled = detectPluginInstalled(workspaceRoot);
    return formatBaseResult(resolved, {
      auth_status: pluginInstalled ? "standby_needed" : "unconfigured",
      ready: false,
      status_label: pluginInstalled ? "Chờ bật Worker" : "Chưa cài Plugin",
      setup_hint: 'Mở Antigravity IDE và gửi lệnh: "Bật VideoMaker Worker"',
      models: [],
      models_source: "none",
    });
  }

  if (providerId === "ollama") {
    const res = await fetchJsonWithTimeout(`${base_url}/api/tags`, { method: "GET" }, LOCAL_TIMEOUT_MS);
    if (res.ok && res.json) {
      const rawModels = Array.isArray(res.json.models) ? res.json.models : [];
      const models = rawModels
        .map((m) => String(m?.name || m?.model || "").trim())
        .filter(Boolean)
        .map((id) => ({ id, label: id }));
      return formatBaseResult(resolved, {
        auth_status: "verified",
        status: "ready",
        ready: true,
        status_label: models.length > 0 ? `Sẵn sàng (${models.length} model)` : "Đã bật (chưa có model)",
        setup_hint: models.length > 0 ? "" : "Chạy `ollama pull qwen2.5-coder` để tải model local.",
        models,
        models_source: "live",
      });
    }
    return formatBaseResult(resolved, {
      auth_status: "unconfigured",
      ready: false,
      status_label: "Chưa bật Ollama",
      setup_hint: `Khởi động Ollama tại ${base_url} để chạy miễn phí trên máy.`,
      last_error: res.networkError ? sanitizeErrorText(res.text) : `HTTP ${res.status}`,
    });
  }

  if (providerId === "lmstudio") {
    const res = await fetchJsonWithTimeout(`${base_url}/models`, { method: "GET" }, LOCAL_TIMEOUT_MS);
    if (res.ok && res.json) {
      const rawModels = Array.isArray(res.json.data) ? res.json.data : [];
      const models = rawModels
        .map((m) => String(m?.id || "").trim())
        .filter(Boolean)
        .map((id) => ({ id, label: id }));
      return formatBaseResult(resolved, {
        auth_status: "verified",
        status: "ready",
        ready: true,
        status_label: models.length > 0 ? `Sẵn sàng (${models.length} model)` : "Đã bật (chưa load model)",
        setup_hint: models.length > 0 ? "" : "Load một model trong LM Studio Local Server.",
        models,
        models_source: "live",
      });
    }
    return formatBaseResult(resolved, {
      auth_status: "unconfigured",
      ready: false,
      status_label: "Chưa bật LM Studio",
      setup_hint: `Mở LM Studio -> Local Server tại ${base_url}.`,
      last_error: res.networkError ? sanitizeErrorText(res.text) : `HTTP ${res.status}`,
    });
  }

  // Cloud APIs (require key)
  if (!has_credential) {
    return formatBaseResult(resolved, {
      auth_status: "unconfigured",
      ready: false,
      status_label: "Chưa có Key",
      setup_hint: `Nhập API key hoặc đặt biến môi trường ${spec.env_vars.join(" / ")}.`,
    });
  }

  if (providerId === "openai") {
    const res = await fetchJsonWithTimeout(
      `${base_url}/models`,
      { method: "GET", headers: { Authorization: `Bearer ${api_key}` } },
      CLOUD_TIMEOUT_MS
    );
    if (res.status === 401 || res.status === 403) {
      return formatBaseResult(resolved, {
        auth_status: "invalid",
        ready: false,
        status_label: "Key không hợp lệ",
        last_error: `HTTP ${res.status}: API key bị từ chối.`,
        setup_hint: "Kiểm tra lại OpenAI API key và quyền truy cập.",
      });
    }
    if (res.status === 429 || res.status === 402) {
      return formatBaseResult(resolved, {
        auth_status: "quota_exhausted",
        ready: false,
        status_label: "Hết Quota / Rate Limit",
        last_error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
      });
    }
    if (res.ok && res.json) {
      const models = filterOpenAiModels(res.json.data);
      return applyRuntimeQuotaIfSet(
        providerId,
        formatBaseResult(resolved, {
          auth_status: "verified",
          ready: true,
          status_label: `Sẵn sàng (${models.length} models)`,
          models,
          models_source: "live",
        })
      );
    }
    return formatBaseResult(resolved, {
      auth_status: "untested",
      ready: false,
      status_label: "Không kết nối được",
      last_error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
    });
  }

  if (providerId === "anthropic") {
    const res = await fetchJsonWithTimeout(
      `${base_url}/models`,
      {
        method: "GET",
        headers: {
          "x-api-key": api_key,
          "anthropic-version": "2023-06-01",
        },
      },
      CLOUD_TIMEOUT_MS
    );
    if (res.status === 401 || res.status === 403) {
      return formatBaseResult(resolved, {
        auth_status: "invalid",
        ready: false,
        status_label: "Key không hợp lệ",
        last_error: `HTTP ${res.status}: Anthropic API key bị từ chối.`,
        setup_hint: "Kiểm tra lại ANTHROPIC_API_KEY.",
      });
    }
    if (res.status === 429 || res.status === 402) {
      return formatBaseResult(resolved, {
        auth_status: "quota_exhausted",
        ready: false,
        status_label: "Hết Credit / Rate Limit",
        last_error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
      });
    }
    if (res.ok && res.json) {
      const raw = Array.isArray(res.json.data) ? res.json.data : [];
      const models = raw
        .map((m) => ({
          id: String(m?.id || "").trim(),
          label: String(m?.display_name || m?.id || "").trim(),
        }))
        .filter((m) => m.id);
      return applyRuntimeQuotaIfSet(
        providerId,
        formatBaseResult(resolved, {
          auth_status: "verified",
          ready: true,
          status_label: `Sẵn sàng (${models.length} models)`,
          models,
          models_source: "live",
        })
      );
    }
    return formatBaseResult(resolved, {
      auth_status: "untested",
      ready: false,
      status_label: "Không kết nối được",
      last_error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
    });
  }

  if (providerId === "gemini") {
    const res = await fetchJsonWithTimeout(
      `${base_url}/models?key=${encodeURIComponent(api_key)}`,
      { method: "GET" },
      CLOUD_TIMEOUT_MS
    );
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return formatBaseResult(resolved, {
        auth_status: "invalid",
        ready: false,
        status_label: "Key không hợp lệ",
        last_error: `HTTP ${res.status}: Gemini API key bị từ chối.`,
        setup_hint: "Kiểm tra lại GEMINI_API_KEY / GOOGLE_API_KEY.",
      });
    }
    if (res.status === 429) {
      return formatBaseResult(resolved, {
        auth_status: "quota_exhausted",
        ready: false,
        status_label: "Hết Quota Gemini",
        last_error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
      });
    }
    if (res.ok && res.json) {
      const raw = Array.isArray(res.json.models) ? res.json.models : [];
      const models = [];
      for (const m of raw) {
        const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        if (!methods.includes("generateContent")) continue;
        const fullName = String(m?.name || "").trim();
        const id = fullName.replace(/^models\//, "");
        if (!id) continue;
        models.push({
          id,
          label: String(m?.displayName || id),
        });
      }
      return applyRuntimeQuotaIfSet(
        providerId,
        formatBaseResult(resolved, {
          auth_status: "verified",
          ready: true,
          status_label: `Sẵn sàng (${models.length} models)`,
          models,
          models_source: "live",
        })
      );
    }
    return formatBaseResult(resolved, {
      auth_status: "untested",
      ready: false,
      status_label: "Không kết nối được",
      last_error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
    });
  }

  if (providerId === "deepseek") {
    const rootUrl = stripVersionSuffix(base_url);
    const [modelsRes, balanceRes] = await Promise.all([
      fetchJsonWithTimeout(
        `${base_url}/models`,
        { method: "GET", headers: { Authorization: `Bearer ${api_key}` } },
        CLOUD_TIMEOUT_MS
      ),
      fetchJsonWithTimeout(
        `${rootUrl}/user/balance`,
        { method: "GET", headers: { Authorization: `Bearer ${api_key}` } },
        CLOUD_TIMEOUT_MS
      ),
    ]);

    if (
      modelsRes.status === 401 ||
      modelsRes.status === 403 ||
      balanceRes.status === 401 ||
      balanceRes.status === 403
    ) {
      return formatBaseResult(resolved, {
        auth_status: "invalid",
        ready: false,
        status_label: "Key không hợp lệ",
        last_error: `HTTP ${modelsRes.status === 401 || modelsRes.status === 403 ? modelsRes.status : balanceRes.status}: DeepSeek API key bị từ chối.`,
        setup_hint: "Kiểm tra lại DEEPSEEK_API_KEY.",
      });
    }

    let quota_info = null;
    let balanceUnavailable = false;
    if (balanceRes.ok && balanceRes.json) {
      const isAvail = balanceRes.json.is_available !== false;
      const infos = Array.isArray(balanceRes.json.balance_infos) ? balanceRes.json.balance_infos : [];
      const firstInfo = infos[0] || null;
      const total_balance = firstInfo?.total_balance ?? balanceRes.json.total_balance ?? null;
      const currency = firstInfo?.currency ?? balanceRes.json.currency ?? "USD";
      balanceUnavailable = balanceRes.json.is_available === false;
      quota_info = {
        summary:
          total_balance !== null && total_balance !== undefined
            ? `Số dư: ${total_balance} ${currency}`
            : isAvail
              ? "Khả dụng"
              : "Hết số dư",
        available: isAvail,
        currency,
        total_balance: total_balance !== null && total_balance !== undefined ? String(total_balance) : null,
      };
    }

    if (balanceUnavailable || modelsRes.status === 429 || modelsRes.status === 402 || balanceRes.status === 402) {
      return formatBaseResult(resolved, {
        auth_status: "quota_exhausted",
        ready: false,
        status_label: "Hết số dư DeepSeek",
        last_error: "Tài khoản DeepSeek hết số dư hoặc bị giới hạn (is_available=false).",
        quota_info,
        models: modelsRes.ok && modelsRes.json
          ? (Array.isArray(modelsRes.json.data) ? modelsRes.json.data : []).map((m) => ({
              id: String(m.id),
              label: String(m.id),
            }))
          : [],
        models_source: modelsRes.ok ? "live" : "none",
      });
    }

    if (modelsRes.ok && modelsRes.json) {
      const models = (Array.isArray(modelsRes.json.data) ? modelsRes.json.data : [])
        .map((m) => ({ id: String(m?.id || "").trim(), label: String(m?.id || "").trim() }))
        .filter((m) => m.id);
      return applyRuntimeQuotaIfSet(
        providerId,
        formatBaseResult(resolved, {
          auth_status: "verified",
          ready: true,
          status_label: quota_info?.summary ? `Sẵn sàng (${quota_info.summary})` : `Sẵn sàng (${models.length} models)`,
          models,
          models_source: "live",
          quota_info,
        })
      );
    }

    return formatBaseResult(resolved, {
      auth_status: "untested",
      ready: false,
      status_label: "Không kết nối được",
      last_error: sanitizeErrorText(modelsRes.text) || `HTTP ${modelsRes.status}`,
      quota_info,
    });
  }

  if (providerId === "openrouter") {
    // OpenRouter /models is public, so /key MUST be verified first
    const [keyRes, modelsRes] = await Promise.all([
      fetchJsonWithTimeout(
        `${base_url}/key`,
        { method: "GET", headers: { Authorization: `Bearer ${api_key}` } },
        CLOUD_TIMEOUT_MS
      ),
      fetchJsonWithTimeout(
        `${base_url}/models`,
        { method: "GET", headers: { Authorization: `Bearer ${api_key}` } },
        CLOUD_TIMEOUT_MS
      ),
    ]);

    const keyText = String(keyRes.text || "");
    if (keyRes.status === 402 || (keyRes.status === 403 && /limit|quota|credit/i.test(keyText))) {
      return formatBaseResult(resolved, {
        auth_status: "quota_exhausted",
        ready: false,
        status_label: "Hết hạn mức OpenRouter",
        last_error: sanitizeErrorText(keyText) || `HTTP ${keyRes.status}`,
        quota_info: { summary: "Còn 0% hạn mức", percent_remaining: 0, available: false },
      });
    }
    if (keyRes.status === 401 || keyRes.status === 403) {
      return formatBaseResult(resolved, {
        auth_status: "invalid",
        ready: false,
        status_label: "Key không hợp lệ",
        last_error: `HTTP ${keyRes.status}: OpenRouter API key bị từ chối.`,
        setup_hint: "Kiểm tra lại OPENROUTER_API_KEY.",
      });
    }

    if (keyRes.ok && keyRes.json) {
      const kData = keyRes.json.data && typeof keyRes.json.data === "object" ? keyRes.json.data : keyRes.json;
      const limit = kData.limit !== undefined && kData.limit !== null ? Number(kData.limit) : null;
      const usage = Number(kData.usage || 0);
      let limitRemaining =
        kData.limit_remaining !== undefined && kData.limit_remaining !== null
          ? Number(kData.limit_remaining)
          : limit !== null
            ? Math.max(0, limit - usage)
            : null;
      let percentRemaining = null;
      let quota_info = null;

      if (limit !== null && Number.isFinite(limit) && limit > 0 && limitRemaining !== null) {
        limitRemaining = Math.max(0, limitRemaining);
        percentRemaining = Math.max(0, Math.min(100, Math.round((limitRemaining / limit) * 100)));
        quota_info = {
          summary: `Còn ${percentRemaining}% ($${limitRemaining.toFixed(2)}/$${limit.toFixed(2)})`,
          percent_remaining: percentRemaining,
          available: limitRemaining > 0,
        };
      } else {
        quota_info = {
          summary: kData.is_free_tier ? `Free tier (Đã dùng $${usage.toFixed(2)})` : `Đã dùng $${usage.toFixed(2)}`,
          available: true,
        };
      }

      const modelsRaw = modelsRes.ok && modelsRes.json && Array.isArray(modelsRes.json.data) ? modelsRes.json.data : [];
      const models = modelsRaw
        .map((m) => ({
          id: String(m?.id || "").trim(),
          label: String(m?.name || m?.id || "").trim(),
        }))
        .filter((m) => m.id);

      if (limit !== null && limit > 0 && limitRemaining !== null && limitRemaining <= 0) {
        return formatBaseResult(resolved, {
          auth_status: "quota_exhausted",
          ready: false,
          status_label: "Hết hạn mức OpenRouter",
          last_error: "Key OpenRouter đã đạt giới hạn chi tiêu (limit_remaining = 0).",
          models,
          models_source: models.length > 0 ? "live" : "none",
          quota_info,
        });
      }

      return applyRuntimeQuotaIfSet(
        providerId,
        formatBaseResult(resolved, {
          auth_status: "verified",
          ready: true,
          status_label:
            percentRemaining !== null ? `Sẵn sàng (Còn ${percentRemaining}%)` : `Sẵn sàng (${models.length} models)`,
          models,
          models_source: models.length > 0 ? "live" : "none",
          quota_info,
        })
      );
    }

    return formatBaseResult(resolved, {
      auth_status: "untested",
      ready: false,
      status_label: "Không kết nối được",
      last_error: sanitizeErrorText(keyRes.text) || `HTTP ${keyRes.status}`,
    });
  }

  return formatBaseResult(resolved);
}

export async function probeProvider(providerId, { force = false, workerStatus = null, workspaceRoot = null, engineDir = DEFAULT_ENGINE_DIR } = {}) {
  if (!getBrandSpec(providerId)) {
    throw Object.assign(new Error(`Unknown provider "${providerId}"`), { statusCode: 400 });
  }
  // Never cache antigravity worker status because heartbeat changes in real time
  const useCache = !force && providerId !== "antigravity" && providerId !== "manual_web";
  if (useCache) {
    const cached = handshakeCache.get(providerId);
    if (cached && Date.now() - cached.ts < HANDSHAKE_CACHE_TTL_MS) {
      return applyRuntimeQuotaIfSet(providerId, cached.data);
    }
  }
  const result = await runLiveHandshake(providerId, { workerStatus, workspaceRoot, engineDir });
  if (providerId !== "antigravity" && providerId !== "manual_web") {
    handshakeCache.set(providerId, { ts: Date.now(), data: result });
  }
  return result;
}

export async function getProvidersOverview({ force = false, workerStatus = null, workspaceRoot = null, engineDir = DEFAULT_ENGINE_DIR } = {}) {
  const providers = await Promise.all(
    BRAND_CATALOG.map((b) => probeProvider(b.id, { force, workerStatus, workspaceRoot, engineDir }))
  );
  const prefs = loadAiPreferences(engineDir);
  return {
    providers,
    last_selection: prefs.last_selection,
    pipeline_routing: prefs.pipeline_routing,
  };
}

export async function pingProviderOneToken({ provider_id, model, engineDir = DEFAULT_ENGINE_DIR }) {
  const execCfg = resolveProviderExecutionConfig(provider_id, engineDir);
  if (!execCfg.ok) {
    return {
      ok: false,
      code: execCfg.code || "PROVIDER_UNCONFIGURED",
      auth_status: "unconfigured",
      error: execCfg.error,
    };
  }
  const targetModel = String(model || "").trim();
  if (!targetModel) {
    return { ok: false, code: "MODEL_REQUIRED", error: "Cần chọn model để test 1 token." };
  }

  const started = Date.now();
  let res;
  if (provider_id === "anthropic") {
    res = await fetchJsonWithTimeout(
      `${execCfg.base_url}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": execCfg.api_key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
      PING_TIMEOUT_MS
    );
  } else if (provider_id === "gemini") {
    res = await fetchJsonWithTimeout(
      `${execCfg.base_url}/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(execCfg.api_key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
      PING_TIMEOUT_MS
    );
  } else if (provider_id === "ollama") {
    res = await fetchJsonWithTimeout(
      `${execCfg.base_url}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: targetModel,
          stream: false,
          options: { num_predict: 1 },
          messages: [{ role: "user", content: "hi" }],
        }),
      },
      PING_TIMEOUT_MS
    );
  } else {
    const headers = { "Content-Type": "application/json" };
    if (execCfg.api_key) headers.Authorization = `Bearer ${execCfg.api_key}`;
    res = await fetchJsonWithTimeout(
      `${execCfg.base_url}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: targetModel,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
      PING_TIMEOUT_MS
    );
  }

  const latency_ms = Date.now() - started;
  if (res.ok) {
    clearProviderQuotaExhausted(provider_id);
    return { ok: true, provider_id, model: targetModel, latency_ms };
  }

  const bodyLower = String(res.text || "").toLowerCase();
  if (
    res.status === 429 ||
    res.status === 402 ||
    /insufficient_quota|rate_limit|quota|credit balance|billing|resource_exhausted/.test(bodyLower)
  ) {
    const msg = sanitizeErrorText(res.text) || `HTTP ${res.status}: Quota exhausted`;
    markProviderQuotaExhausted(provider_id, msg);
    return {
      ok: false,
      code: "QUOTA_EXHAUSTED",
      auth_status: "quota_exhausted",
      status: res.status,
      latency_ms,
      error: msg,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      code: "AUTH_INVALID",
      auth_status: "invalid",
      status: res.status,
      latency_ms,
      error: sanitizeErrorText(res.text) || `HTTP ${res.status}: Authentication failed`,
    };
  }

  return {
    ok: false,
    code: "PING_FAILED",
    status: res.status,
    latency_ms,
    error: sanitizeErrorText(res.text) || `HTTP ${res.status}`,
  };
}
