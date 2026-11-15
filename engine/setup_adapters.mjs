import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const EXPECTED_PLUGIN_FILES = [
  "plugin.json",
  "README.md",
  "mcp_config.json",
  "assets/logo.svg",
  "rules/AGENTS.md",
  "skills/curriculum-architect/SKILL.md",
  "skills/episode-producer/SKILL.md",
  "skills/studio-worker/SKILL.md",
  "skills/video-renderer/SKILL.md",
];

export const EXPECTED_SKILLS = [
  "curriculum-architect",
  "episode-producer",
  "studio-worker",
  "video-renderer",
];

export const AI_ENV_KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
];

export function getClaudeDesktopConfigPath(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "Claude", "claude_desktop_config.json");
}

export function getDefaultAdapterPaths(repoRoot) {
  return {
    workspacePluginDir: path.join(repoRoot, ".agents", "plugins", "tech-video-studio"),
    globalPluginDir: path.join(os.homedir(), ".gemini", "config", "plugins", "tech-video-studio"),
    agentSkillsDir: path.join(repoRoot, ".agents", "skills"),
    claudeSkillsDir: path.join(repoRoot, ".claude", "skills"),
    claudeMcpFile: path.join(repoRoot, ".mcp.json"),
    claudeDesktopConfigPath: getClaudeDesktopConfigPath(),
  };
}

/**
 * Boolean-only check for OS AI provider env keys.
 * NEVER reads, slices, stores, or returns secret values.
 */
export function checkAiEnvKeys(env = process.env) {
  const result = {};
  for (const keyName of AI_ENV_KEY_NAMES) {
    result[keyName] = typeof env[keyName] === "string" && env[keyName].trim().length > 0;
  }
  return result;
}

export function toFileUriBase(fsPath) {
  const normalized = fsPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `file:///${normalized}`;
}

export function renderTextTemplate(raw, { repoRoot, pythonBin = "python" }) {
  const fileUriRoot = toFileUriBase(repoRoot);
  let out = String(raw).replaceAll("{{WORKSPACE_ROOT_FILE_URI}}", fileUriRoot);
  out = out.replaceAll("{{PYTHON_BIN}}", pythonBin);
  out = out.replace(/\{\{WORKSPACE_ROOT\}\}((?:\/[^\s`'")\],;:]*)?)/g, (_, suffix = "") => {
    if (!suffix) return repoRoot;
    const parts = suffix.split("/").filter(Boolean);
    const joined = path.join(repoRoot, ...parts);
    return suffix.endsWith("/") ? `${joined}${path.sep}` : joined;
  });
  return out;
}

export function walkFiles(dirPath, baseDir = dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, full));
    }
  }
  return results;
}

export function buildMcpServerEntry(repoRoot) {
  return {
    command: "node",
    args: [path.join(repoRoot, "engine", "mcp_server.mjs")],
    env: {
      VIDEO_MAKER_PORT: "3030",
    },
  };
}

function getTemplateDir(repoRoot, templateDir) {
  return templateDir || path.join(repoRoot, "plugin", "tech-video-studio");
}

export function verifyInstalledDir(targetDir, written = []) {
  const missing = [];
  for (const rel of EXPECTED_PLUGIN_FILES) {
    const full = path.join(targetDir, rel);
    if (!fs.existsSync(full)) missing.push(rel);
  }

  const pluginJson = JSON.parse(fs.readFileSync(path.join(targetDir, "plugin.json"), "utf-8"));
  const mcpConfig = JSON.parse(fs.readFileSync(path.join(targetDir, "mcp_config.json"), "utf-8"));
  const mcpServerArg = mcpConfig?.mcpServers?.["tech-video-studio"]?.args?.[0] || "";
  const mcpServerExists = Boolean(mcpServerArg && fs.existsSync(mcpServerArg));

  return {
    targetDir,
    ok: missing.length === 0 && Boolean(pluginJson?.name) && mcpServerExists,
    missing,
    pluginName: pluginJson?.name || "",
    mcpServerPath: mcpServerArg,
    mcpServerExists,
    fileCount: written.length || EXPECTED_PLUGIN_FILES.length,
  };
}

export function inspectExistingInstall(dir) {
  if (!fs.existsSync(path.join(dir, "plugin.json"))) {
    return { installed: false, dir };
  }
  try {
    const check = verifyInstalledDir(dir);
    return { installed: true, dir, ...check };
  } catch (err) {
    return { installed: true, dir, ok: false, error: err.message };
  }
}

export function installPluginToDir(targetDir, { repoRoot, pythonBin = "python", templateDir } = {}) {
  const srcRoot = getTemplateDir(repoRoot, templateDir);
  if (!fs.existsSync(srcRoot)) {
    throw new Error(`Plugin source bundle not found at ${srcRoot}`);
  }

  const relFiles = walkFiles(srcRoot);
  const written = [];

  for (const rel of relFiles) {
    const srcPath = path.join(srcRoot, rel);
    const dstPath = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });

    const normRel = rel.replace(/\\/g, "/");
    if (normRel === "mcp_config.json") {
      const mcpConfig = {
        mcpServers: {
          "tech-video-studio": buildMcpServerEntry(repoRoot),
        },
      };
      fs.writeFileSync(dstPath, `${JSON.stringify(mcpConfig, null, 2)}\n`, "utf-8");
    } else if (normRel === "plugin.json") {
      const parsed = JSON.parse(fs.readFileSync(srcPath, "utf-8"));
      if (Array.isArray(parsed.suggestedPrompts)) {
        parsed.suggestedPrompts = parsed.suggestedPrompts.map((p) =>
          renderTextTemplate(String(p), { repoRoot, pythonBin })
        );
      }
      fs.writeFileSync(dstPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    } else if (normRel.endsWith(".md") || normRel.endsWith(".txt")) {
      const raw = fs.readFileSync(srcPath, "utf-8");
      const rendered = renderTextTemplate(raw, { repoRoot, pythonBin });
      fs.writeFileSync(dstPath, rendered, "utf-8");
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }

    written.push(normRel);
  }

  return verifyInstalledDir(targetDir, written);
}

export function installSkillAdapter({ targetSkillsDir, repoRoot, pythonBin = "python", templateDir } = {}) {
  const srcSkillsDir = path.join(getTemplateDir(repoRoot, templateDir), "skills");
  if (!fs.existsSync(srcSkillsDir)) {
    throw new Error(`Plugin skills source directory not found at ${srcSkillsDir}`);
  }

  const relFiles = walkFiles(srcSkillsDir);
  const written = [];
  for (const rel of relFiles) {
    const srcPath = path.join(srcSkillsDir, rel);
    const dstPath = path.join(targetSkillsDir, rel);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });

    const normRel = rel.replace(/\\/g, "/");
    if (normRel.endsWith(".md") || normRel.endsWith(".txt")) {
      const raw = fs.readFileSync(srcPath, "utf-8");
      fs.writeFileSync(dstPath, renderTextTemplate(raw, { repoRoot, pythonBin }), "utf-8");
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
    written.push(normRel);
  }

  const status = inspectSkillsDir(targetSkillsDir);
  return {
    targetDir: targetSkillsDir,
    ...status,
    fileCount: written.length,
  };
}

function mergeMcpJsonFile(filePath, repoRoot, { createBackup = false } = {}) {
  let baseConfig = {};
  let backupPath = null;

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`Expected JSON object in ${filePath}`);
        }
        baseConfig = parsed;
      } catch (err) {
        throw new Error(`Failed to parse existing MCP config at ${filePath}: ${err.message}`);
      }
    }
    if (createBackup) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = `${filePath}.${stamp}.bak`;
      fs.copyFileSync(filePath, backupPath);
    }
  }

  const existingServers =
    baseConfig.mcpServers && typeof baseConfig.mcpServers === "object" && !Array.isArray(baseConfig.mcpServers)
      ? { ...baseConfig.mcpServers }
      : {};
  const preservedServers = Object.keys(existingServers).filter((k) => k !== "tech-video-studio");

  const nextConfig = {
    ...baseConfig,
    mcpServers: {
      ...existingServers,
      "tech-video-studio": buildMcpServerEntry(repoRoot),
    },
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");

  const mcpServerPath = nextConfig.mcpServers["tech-video-studio"].args[0];
  return {
    path: filePath,
    ok: fs.existsSync(mcpServerPath),
    backupPath,
    mcpServerPath,
    mcpServerExists: fs.existsSync(mcpServerPath),
    preservedServers,
  };
}

export function installMcpJson({ mcpFilePath, repoRoot }) {
  return mergeMcpJsonFile(mcpFilePath, repoRoot, { createBackup: false });
}

export function installClaudeDesktopConfig({ configPath, repoRoot }) {
  const targetPath = configPath || getClaudeDesktopConfigPath();
  return mergeMcpJsonFile(targetPath, repoRoot, { createBackup: true });
}

export function inspectSkillsDir(skillsDir) {
  if (!fs.existsSync(skillsDir)) {
    return {
      installed: false,
      ok: false,
      dir: skillsDir,
      skills: [],
      missing: EXPECTED_SKILLS.map((s) => `${s}/SKILL.md`),
    };
  }
  const present = [];
  const missing = [];
  for (const skill of EXPECTED_SKILLS) {
    const skillMd = path.join(skillsDir, skill, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      present.push(skill);
    } else {
      missing.push(`${skill}/SKILL.md`);
    }
  }
  return {
    installed: present.length > 0,
    ok: missing.length === 0,
    dir: skillsDir,
    skills: present,
    missing,
  };
}

export function inspectMcpFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { installed: false, ok: false, path: filePath, mcpServerPath: null, mcpServerExists: false };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const entry = parsed?.mcpServers?.["tech-video-studio"];
    const mcpServerPath = Array.isArray(entry?.args) ? entry.args[0] || "" : "";
    const mcpServerExists = Boolean(mcpServerPath && fs.existsSync(mcpServerPath));
    return {
      installed: Boolean(entry),
      ok: Boolean(entry && mcpServerExists),
      path: filePath,
      mcpServerPath: mcpServerPath || null,
      mcpServerExists,
    };
  } catch (err) {
    return { installed: true, ok: false, path: filePath, error: err.message };
  }
}

export function inspectWorkspaceAdapters(repoRoot, { claudeDesktopPath } = {}) {
  const paths = getDefaultAdapterPaths(repoRoot);
  const desktopPath = claudeDesktopPath || paths.claudeDesktopConfigPath;
  return {
    antigravityPlugin: inspectExistingInstall(paths.workspacePluginDir),
    agentSkills: inspectSkillsDir(paths.agentSkillsDir),
    claudeSkills: inspectSkillsDir(paths.claudeSkillsDir),
    claudeMcp: inspectMcpFile(paths.claudeMcpFile),
    claudeDesktop: inspectMcpFile(desktopPath),
  };
}

export function normalizeAgentList(agentsArg) {
  const valid = new Set(["antigravity", "claude", "codex", "all"]);
  const rawList = Array.isArray(agentsArg)
    ? agentsArg
    : String(agentsArg || "antigravity")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  if (rawList.length === 0) return ["antigravity"];
  for (const item of rawList) {
    if (!valid.has(item)) {
      throw new Error(`Invalid --agents value: ${item} (expected antigravity|claude|codex|all)`);
    }
  }
  if (rawList.includes("all")) {
    return ["antigravity", "claude", "codex"];
  }
  return Array.from(new Set(rawList));
}
