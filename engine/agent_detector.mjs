import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Probe whether a CLI command is available in PATH and exits 0.
 * Never throws; returns { found, version, bin }.
 */
export function probeCli(bin, args = ["--version"]) {
  try {
    const res = spawnSync(bin, args, {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 3500,
    });
    if (res.error || res.status !== 0) {
      return { found: false, bin, version: null };
    }
    const output = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
    const firstLine = output.split(/\r?\n/)[0]?.trim() || "";
    return { found: true, bin, version: firstLine || "installed" };
  } catch {
    return { found: false, bin, version: null };
  }
}

function firstExistingPath(candidates = []) {
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

function hasExtensionPrefix(extDir, prefix) {
  try {
    if (!extDir || !fs.existsSync(extDir)) return false;
    const lower = prefix.toLowerCase();
    return fs.readdirSync(extDir).some((name) => name.toLowerCase().startsWith(lower));
  } catch {
    return false;
  }
}

function getPlatformPaths(platform = process.platform, env = process.env, home = os.homedir()) {
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return { platform, env, home, localAppData, appData, programFiles, programFilesX86, xdgConfig };
}

/**
 * Catalog of popular AI Agents (both Desktop Apps/IDEs and CLIs).
 * Each entry defines strict local detection so ONLY agents actually installed
 * on the user's machine are offered for selection.
 */
export function getAgentCatalog({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = getPlatformPaths(platform, env, home);

  return [
    {
      id: "antigravity-app",
      name: "Antigravity App (IDE)",
      kind: "app",
      vendor: "Google",
      installSummary: "Plugin + 6 skills + rules + MCP (~/.gemini/config/plugins & workspace)",
      detect() {
        const candidates =
          p.platform === "win32"
            ? [
                path.join(p.localAppData, "Programs", "Antigravity", "Antigravity.exe"),
                path.join(p.programFiles, "Antigravity", "Antigravity.exe"),
                path.join(p.home, ".gemini", "antigravity"),
              ]
            : p.platform === "darwin"
              ? [
                  "/Applications/Antigravity.app",
                  path.join(p.home, "Applications", "Antigravity.app"),
                  path.join(p.home, ".gemini", "antigravity"),
                ]
              : [
                  "/usr/bin/antigravity",
                  "/opt/Antigravity",
                  path.join(p.home, ".gemini", "antigravity"),
                ];
        const hit = firstExistingPath(candidates);
        return hit
          ? { detected: true, evidence: hit }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "antigravity-cli",
      name: "Antigravity CLI (agy)",
      kind: "cli",
      vendor: "Google",
      installSummary: "Global plugin via `agy plugin install`",
      detect() {
        const probe = probeCli("agy", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `agy (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop App",
      kind: "app",
      vendor: "Anthropic",
      installSummary: "MCP server in claude_desktop_config.json (with .bak backup)",
      detect() {
        const candidates =
          p.platform === "win32"
            ? [
                path.join(p.localAppData, "AnthropicClaude", "claude.exe"),
                path.join(p.localAppData, "Programs", "Claude", "Claude.exe"),
                path.join(p.appData, "Claude", "claude_desktop_config.json"),
                path.join(p.appData, "Claude", "config.json"),
              ]
            : p.platform === "darwin"
              ? [
                  "/Applications/Claude.app",
                  path.join(p.home, "Applications", "Claude.app"),
                  path.join(p.home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
                ]
              : [
                  path.join(p.xdgConfig, "Claude", "claude_desktop_config.json"),
                ];
        const hit = firstExistingPath(candidates);
        return hit
          ? { detected: true, evidence: hit }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "claude-code",
      name: "Claude Code CLI (claude)",
      kind: "cli",
      vendor: "Anthropic",
      installSummary: "6 skills (~/.claude/skills) + MCP (.mcp.json)",
      detect() {
        const probe = probeCli("claude", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `claude (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "codex-cli",
      name: "OpenAI Codex CLI (codex)",
      kind: "cli",
      vendor: "OpenAI",
      installSummary: "6 skills (~/.agents/skills & ~/.codex/skills)",
      detect() {
        const probe = probeCli("codex", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `codex (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "codex-app",
      name: "OpenAI Codex App",
      kind: "app",
      vendor: "OpenAI",
      installSummary: "6 skills (~/.codex/skills & ~/.agents/skills)",
      detect() {
        const candidates =
          p.platform === "win32"
            ? [
                path.join(p.localAppData, "Programs", "Codex", "Codex.exe"),
                path.join(p.localAppData, "Codex", "Codex.exe"),
              ]
            : p.platform === "darwin"
              ? ["/Applications/Codex.app", path.join(p.home, "Applications", "Codex.app")]
              : ["/usr/bin/codex-app", "/opt/Codex"];
        const hit = firstExistingPath(candidates);
        return hit
          ? { detected: true, evidence: hit }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI (gemini)",
      kind: "cli",
      vendor: "Google",
      installSummary: "MCP (~/.gemini/settings.json) + 6 skills (~/.gemini/skills)",
      detect() {
        const probe = probeCli("gemini", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `gemini (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "cursor-app",
      name: "Cursor App (IDE)",
      kind: "app",
      vendor: "Cursor",
      installSummary: "MCP (~/.cursor/mcp.json) + 6 skills (~/.cursor/skills)",
      detect() {
        const candidates =
          p.platform === "win32"
            ? [
                path.join(p.localAppData, "Programs", "cursor", "Cursor.exe"),
                path.join(p.programFiles, "cursor", "Cursor.exe"),
              ]
            : p.platform === "darwin"
              ? ["/Applications/Cursor.app", path.join(p.home, "Applications", "Cursor.app")]
              : ["/usr/bin/cursor", "/opt/Cursor", path.join(p.home, ".cursor", "mcp.json")];
        const hit = firstExistingPath(candidates);
        if (hit) return { detected: true, evidence: hit };
        const probe = probeCli("cursor", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `cursor (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "windsurf-app",
      name: "Windsurf App (IDE)",
      kind: "app",
      vendor: "Codeium",
      installSummary: "MCP (~/.codeium/windsurf/mcp_config.json) + 6 skills",
      detect() {
        const candidates =
          p.platform === "win32"
            ? [
                path.join(p.localAppData, "Programs", "Windsurf", "Windsurf.exe"),
                path.join(p.programFiles, "Windsurf", "Windsurf.exe"),
              ]
            : p.platform === "darwin"
              ? ["/Applications/Windsurf.app", path.join(p.home, "Applications", "Windsurf.app")]
              : ["/usr/bin/windsurf", "/opt/Windsurf"];
        const hit = firstExistingPath(candidates);
        if (hit) return { detected: true, evidence: hit };
        const probe = probeCli("windsurf", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `windsurf (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
    {
      id: "vscode-copilot",
      name: "VS Code + GitHub Copilot",
      kind: "app",
      vendor: "Microsoft / GitHub",
      installSummary: "6 skills (~/.copilot/skills) + MCP (VS Code mcp.json)",
      detect() {
        const extDir = path.join(p.home, ".vscode", "extensions");
        if (hasExtensionPrefix(extDir, "github.copilot")) {
          return { detected: true, evidence: extDir };
        }
        const insidersExtDir = path.join(p.home, ".vscode-insiders", "extensions");
        if (hasExtensionPrefix(insidersExtDir, "github.copilot")) {
          return { detected: true, evidence: insidersExtDir };
        }
        return { detected: false, evidence: null };
      },
    },
    {
      id: "opencode-cli",
      name: "OpenCode CLI (opencode)",
      kind: "cli",
      vendor: "OpenCode",
      installSummary: "6 skills (~/.config/opencode/skills)",
      detect() {
        const probe = probeCli("opencode", ["--version"]);
        return probe.found
          ? { detected: true, evidence: `opencode (${probe.version})` }
          : { detected: false, evidence: null };
      },
    },
  ];
}

/**
 * Scan the local machine for all known AI agents (Apps/IDEs and CLIs).
 * Returns { all, detected, notDetected }.
 */
export function detectInstalledAgents(options = {}) {
  const catalog = getAgentCatalog(options);
  const all = catalog.map((agent) => {
    const res = agent.detect();
    return {
      id: agent.id,
      name: agent.name,
      kind: agent.kind,
      vendor: agent.vendor,
      installSummary: agent.installSummary,
      detected: Boolean(res?.detected),
      evidence: res?.evidence || null,
    };
  });
  return {
    all,
    detected: all.filter((a) => a.detected),
    notDetected: all.filter((a) => !a.detected),
  };
}
