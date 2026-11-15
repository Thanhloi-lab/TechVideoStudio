#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_ENV_KEY_NAMES,
  checkAiEnvKeys,
  getDefaultAdapterPaths,
  inspectExistingInstall,
  inspectWorkspaceAdapters,
  installClaudeDesktopConfig,
  installMcpJson,
  installPluginToDir,
  installSkillAdapter,
  normalizeAgentList,
  verifyInstalledDir,
} from "./engine/setup_adapters.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename));
const ENGINE_DIR = path.join(REPO_ROOT, "engine");
const ADAPTER_PATHS = getDefaultAdapterPaths(REPO_ROOT);

const REQUIRED_ENGINE_FILES = [
  "server.mjs",
  "mcp_server.mjs",
  "state_cli.mjs",
  "tts_pipeline.py",
  "render_video.mjs",
  "worker_wait.mjs",
  "voices.json",
  "public/index.html",
];

function printUsage() {
  console.log(`
Tech Course Video Studio — Universal Multi-Agent Setup

Usage:
  node setup.mjs [options]

Options:
  --workspace                    Install workspace adapters (default)
  --global                       Install Antigravity plugin into ~/.gemini/config/plugins/tech-video-studio
  --all                          Install into both workspace and global Antigravity paths
  --agents <list|all>            Target agent adapters: antigravity|claude|codex|all (default: antigravity)
  --claude-desktop               Merge tech-video-studio MCP server into OS claude_desktop_config.json (creates .bak)
  --out <dir>                    Install resolved Antigravity plugin into a custom directory
  --agy                          When used with --global, install via 'agy plugin install' if available
  --check                        Check prerequisites, adapters & OS env key presence without writing files
  --json                         Output machine-readable JSON summary
  --help, -h                     Show this help message
`.trim());
}

function parseArgs(argv) {
  const opts = {
    target: "workspace",
    customOut: "",
    agents: ["antigravity"],
    claudeDesktop: false,
    useAgy: false,
    checkOnly: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--workspace") opts.target = "workspace";
    else if (arg === "--global") opts.target = "global";
    else if (arg === "--all") opts.target = "all";
    else if (arg === "--out") {
      opts.customOut = argv[++i] || "";
      opts.target = "custom";
    } else if (arg === "--target") {
      const val = (argv[++i] || "").toLowerCase();
      if (!["workspace", "global", "all"].includes(val)) {
        throw new Error(`Invalid --target value: ${val} (expected workspace|global|all)`);
      }
      opts.target = val;
    } else if (arg === "--agents") {
      opts.agents = normalizeAgentList(argv[++i] || "");
    } else if (arg === "--claude-desktop") {
      opts.claudeDesktop = true;
    } else if (arg === "--agy") {
      opts.useAgy = true;
    } else if (arg === "--check") {
      opts.checkOnly = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function parseSemver(verStr) {
  const m = String(verStr || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: m[0] } : null;
}

function probeCommand(cmd, args) {
  try {
    const res = spawnSync(cmd, args, { encoding: "utf-8", windowsHide: true });
    if (res.error) return null;
    return { status: res.status ?? 0, output: `${res.stdout || ""}\n${res.stderr || ""}`.trim() };
  } catch {
    return null;
  }
}

function checkNode() {
  const parsed = parseSemver(process.versions.node);
  const ok = Boolean(parsed && parsed.major >= 22);
  return {
    version: process.versions.node,
    ok,
    note: ok
      ? "OK (supports global WebSocket for headless Chrome CDP rendering)"
      : "Node.js >= 22 recommended (render_video.mjs uses global WebSocket)",
  };
}

function checkPython() {
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const bin of candidates) {
    const res = probeCommand(bin, bin === "py" ? ["-3", "--version"] : ["--version"]);
    if (res && res.status === 0) {
      const parsed = parseSemver(res.output);
      if (parsed) {
        const ok = parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 10);
        const resolvedBin = bin === "py" ? "python" : bin;
        return {
          found: true,
          bin: resolvedBin,
          version: parsed.raw,
          ok,
          needsPythonBinEnv: resolvedBin !== "python",
          note: ok
            ? resolvedBin === "python"
              ? "OK"
              : `OK (detected '${resolvedBin}'; set PYTHON_BIN=${resolvedBin} if 'python' is absent)`
            : "Python >= 3.10 is required by engine/tts_pipeline.py",
        };
      }
    }
  }
  return { found: false, bin: "python", version: null, ok: false, needsPythonBinEnv: false, note: "Python >= 3.10 not found in PATH" };
}

function findChrome() {
  const defaultWinChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (process.env.CHROME_PATH) {
    const exists = fs.existsSync(process.env.CHROME_PATH);
    return {
      found: exists,
      path: process.env.CHROME_PATH,
      isDefaultWinPath: path.resolve(process.env.CHROME_PATH) === path.resolve(defaultWinChrome),
      note: exists ? "OK (from CHROME_PATH)" : `CHROME_PATH does not exist: ${process.env.CHROME_PATH}`,
    };
  }
  const candidates = process.platform === "win32"
    ? [
        defaultWinChrome,
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")] : []),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const isDefault = process.platform === "win32" && path.resolve(candidate) === path.resolve(defaultWinChrome);
      return {
        found: true,
        path: candidate,
        isDefaultWinPath: isDefault,
        note: isDefault ? "OK (default render_video.mjs path)" : `Found at non-default path; set CHROME_PATH="${candidate}" when rendering`,
      };
    }
  }
  return { found: false, path: null, isDefaultWinPath: false, note: "Google Chrome not found; install Chrome or set CHROME_PATH" };
}

function checkEngineFiles() {
  const missing = REQUIRED_ENGINE_FILES.filter((rel) => !fs.existsSync(path.join(ENGINE_DIR, rel)));
  return { ok: missing.length === 0, engineDir: ENGINE_DIR, missing };
}

function checkPort3030() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (running) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(running);
      }
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(3030, "127.0.0.1");
  });
}

function installGlobalAgy(context) {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-plugin-"));
  try {
    installPluginToDir(stageDir, context);
    const agyRes = spawnSync("agy", ["plugin", "install", stageDir], { encoding: "utf-8", windowsHide: true });
    if (agyRes.status !== 0) {
      throw new Error(`agy plugin install failed (${agyRes.status}): ${agyRes.stderr || agyRes.stdout}`);
    }
    return { scope: "global-agy", ...verifyInstalledDir(ADAPTER_PATHS.globalPluginDir) };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  const nodeInfo = checkNode();
  const pythonInfo = checkPython();
  const chromeInfo = findChrome();
  const engineInfo = checkEngineFiles();
  const serverRunning = await checkPort3030();
  const agyAvailable = Boolean(probeCommand("agy", ["--version"])?.status === 0);
  const aiEnvKeys = checkAiEnvKeys();

  if (!engineInfo.ok) {
    throw new Error(`Missing required engine files: ${engineInfo.missing.join(", ")}`);
  }

  const report = {
    repoRoot: REPO_ROOT,
    mode: opts.checkOnly ? "check" : opts.target,
    agents: opts.agents,
    environment: {
      node: nodeInfo,
      python: pythonInfo,
      chrome: chromeInfo,
      engine: engineInfo,
      serverPort3030Running: serverRunning,
      agyCliAvailable: agyAvailable,
      aiEnvKeys,
    },
    installations: [],
    adapterInstallations: [],
    existing: {
      workspace: inspectExistingInstall(ADAPTER_PATHS.workspacePluginDir),
      global: inspectExistingInstall(ADAPTER_PATHS.globalPluginDir),
      adapters: inspectWorkspaceAdapters(REPO_ROOT),
    },
  };

  if (!opts.checkOnly) {
    const context = { repoRoot: REPO_ROOT, pythonBin: pythonInfo.bin };

    if (opts.target === "custom") {
      if (!opts.customOut) throw new Error("--out requires a target directory path");
      report.installations.push({ scope: "custom", ...installPluginToDir(path.resolve(opts.customOut), context) });
    } else if (opts.agents.includes("antigravity")) {
      if (opts.target === "workspace" || opts.target === "all") {
        report.installations.push({ scope: "workspace", ...installPluginToDir(ADAPTER_PATHS.workspacePluginDir, context) });
      }
      if (opts.target === "global" || opts.target === "all") {
        report.installations.push(
          opts.useAgy && agyAvailable
            ? installGlobalAgy(context)
            : { scope: "global", ...installPluginToDir(ADAPTER_PATHS.globalPluginDir, context) }
        );
      }
    }

    if (opts.agents.includes("claude")) {
      report.adapterInstallations.push({
        agent: "claude-skills",
        ...installSkillAdapter({ targetSkillsDir: ADAPTER_PATHS.claudeSkillsDir, ...context }),
      });
      report.adapterInstallations.push({
        agent: "claude-mcp",
        ...installMcpJson({ mcpFilePath: ADAPTER_PATHS.claudeMcpFile, repoRoot: REPO_ROOT }),
      });
    }

    if (opts.agents.includes("codex")) {
      report.adapterInstallations.push({
        agent: "codex-agent-skills",
        ...installSkillAdapter({ targetSkillsDir: ADAPTER_PATHS.agentSkillsDir, ...context }),
      });
    }

    if (opts.claudeDesktop) {
      report.adapterInstallations.push({
        agent: "claude-desktop",
        ...installClaudeDesktopConfig({ repoRoot: REPO_ROOT }),
      });
    }

    report.existing = {
      workspace: inspectExistingInstall(ADAPTER_PATHS.workspacePluginDir),
      global: inspectExistingInstall(ADAPTER_PATHS.globalPluginDir),
      adapters: inspectWorkspaceAdapters(REPO_ROOT),
    };
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=== Tech Course Video Studio Setup ===");
  console.log(`Workspace root : ${REPO_ROOT}`);
  console.log(`Node.js        : ${nodeInfo.version} -> ${nodeInfo.note}`);
  console.log(`Python         : ${pythonInfo.version || "not found"} -> ${pythonInfo.note}`);
  console.log(`Google Chrome  : ${chromeInfo.path || "not found"} -> ${chromeInfo.note}`);
  console.log(`Engine files   : ${engineInfo.ok ? "OK" : "MISSING"}`);
  console.log(`Studio :3030   : ${serverRunning ? "Running (http://localhost:3030)" : "Stopped"}`);
  console.log(`Antigravity CLI: ${agyAvailable ? "Found ('agy')" : "Not in PATH (using direct plugin install)"}`);
  const presentKeys = AI_ENV_KEY_NAMES.filter((k) => aiEnvKeys[k]);
  console.log(`OS AI Env Keys : ${presentKeys.length ? presentKeys.join(", ") : "None detected (can configure in Web Studio)"}`);

  if (opts.checkOnly) {
    const a = report.existing.adapters;
    console.log("\n--- Existing Installations & Adapters ---");
    console.log(`Antigravity (.agents/plugins) : ${a.antigravityPlugin.installed ? (a.antigravityPlugin.ok ? "OK" : "Incomplete") : "Not installed"}`);
    console.log(`Antigravity Global (~/.gemini): ${report.existing.global.installed ? (report.existing.global.ok ? "OK" : "Incomplete") : "Not installed"}`);
    console.log(`Agent Skills (.agents/skills) : ${a.agentSkills.installed ? (a.agentSkills.ok ? "OK" : "Incomplete") : "Not installed"}`);
    console.log(`Claude Skills (.claude/skills): ${a.claudeSkills.installed ? (a.claudeSkills.ok ? "OK" : "Incomplete") : "Not installed"}`);
    console.log(`Claude MCP (.mcp.json)        : ${a.claudeMcp.installed ? (a.claudeMcp.ok ? "OK" : "Incomplete") : "Not installed"}`);
    console.log(`Claude Desktop MCP            : ${a.claudeDesktop.installed ? (a.claudeDesktop.ok ? "Configured" : "Invalid") : "Not configured"}`);
  } else {
    console.log("\n--- Installed Bundles & Adapters ---");
    for (const inst of report.installations) {
      console.log(`[antigravity:${inst.scope}] ${inst.targetDir} -> ${inst.ok ? "OK" : "FAILED"} (${inst.fileCount} files)`);
    }
    for (const adp of report.adapterInstallations) {
      const target = adp.targetDir || adp.path;
      console.log(`[${adp.agent}] ${target} -> ${adp.ok ? "OK" : "FAILED"}${adp.backupPath ? ` (backup: ${adp.backupPath})` : ""}`);
    }
    console.log("\n--- Next Steps ---");
    console.log('1. Start Studio server: node "engine/server.mjs"');
    console.log("2. Open Web Studio   : http://localhost:3030");
    console.log("3. Reload your IDE / agent session (Antigravity, Claude Code/Desktop, or Codex) to load updated skills & MCP tools.");
  }
}

try {
  await main();
} catch (err) {
  console.error(`[setup] ERROR: ${err.message}`);
  process.exit(1);
}
