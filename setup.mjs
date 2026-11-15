#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname);
const ENGINE_DIR = path.join(REPO_ROOT, "engine");
const PLUGIN_TEMPLATE_DIR = path.join(REPO_ROOT, "plugin", "tech-video-studio");
const WORKSPACE_PLUGIN_DIR = path.join(REPO_ROOT, ".agents", "plugins", "tech-video-studio");
const GLOBAL_PLUGIN_DIR = path.join(os.homedir(), ".gemini", "config", "plugins", "tech-video-studio");

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

const EXPECTED_PLUGIN_FILES = [
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

function printUsage() {
  console.log(`
Tech Course Video Studio — Automated Setup

Usage:
  node setup.mjs [options]

Options:
  --workspace        Install plugin & skills into ./.agents/plugins/tech-video-studio (default)
  --global           Install plugin & skills into ~/.gemini/config/plugins/tech-video-studio
  --all              Install into both workspace (.agents/) and global (~/.gemini/config/)
  --out <dir>        Install resolved plugin into a custom directory
  --agy              When used with --global, install via 'agy plugin install' if available
  --check            Check prerequisites & installation status without writing files
  --json             Output machine-readable JSON summary
  --help, -h         Show this help message
`.trim());
}

function parseArgs(argv) {
  const opts = {
    target: "workspace",
    customOut: "",
    useAgy: false,
    checkOnly: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--workspace") {
      opts.target = "workspace";
    } else if (arg === "--global") {
      opts.target = "global";
    } else if (arg === "--all") {
      opts.target = "all";
    } else if (arg === "--out") {
      opts.customOut = argv[++i] || "";
      opts.target = "custom";
    } else if (arg === "--target") {
      const val = (argv[++i] || "").toLowerCase();
      if (!["workspace", "global", "all"].includes(val)) {
        throw new Error(`Invalid --target value: ${val} (expected workspace|global|all)`);
      }
      opts.target = val;
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
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: m[0] };
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

function probeCommand(cmd, args) {
  try {
    const res = spawnSync(cmd, args, { encoding: "utf-8", windowsHide: true });
    if (res.error) return null;
    return {
      status: res.status ?? 0,
      output: `${res.stdout || ""}\n${res.stderr || ""}`.trim(),
    };
  } catch {
    return null;
  }
}

function checkPython() {
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const bin of candidates) {
    const args = bin === "py" ? ["-3", "--version"] : ["--version"];
    const res = probeCommand(bin, args);
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
              : `OK (detected '${resolvedBin}'; set PYTHON_BIN=${resolvedBin} before starting server.mjs if 'python' is absent)`
            : "Python >= 3.10 is required by engine/tts_pipeline.py",
        };
      }
    }
  }
  return {
    found: false,
    bin: "python",
    version: null,
    ok: false,
    needsPythonBinEnv: false,
    note: "Python >= 3.10 not found in PATH",
  };
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

  const candidates = [];
  if (process.platform === "win32") {
    candidates.push(defaultWinChrome);
    candidates.push("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const isDefault = process.platform === "win32" && path.resolve(candidate) === path.resolve(defaultWinChrome);
      return {
        found: true,
        path: candidate,
        isDefaultWinPath: isDefault,
        note: isDefault
          ? "OK (default render_video.mjs path)"
          : `Found at non-default path; set CHROME_PATH="${candidate}" when rendering videos`,
      };
    }
  }

  if (process.platform !== "win32") {
    const which = probeCommand("which", ["google-chrome"]);
    if (which && which.status === 0 && which.output) {
      const p = which.output.split(/\r?\n/)[0].trim();
      return {
        found: true,
        path: p,
        isDefaultWinPath: false,
        note: `Found via which; set CHROME_PATH="${p}" when rendering videos`,
      };
    }
  }

  return {
    found: false,
    path: null,
    isDefaultWinPath: false,
    note: "Google Chrome not found; install Chrome or set CHROME_PATH for headless video rendering",
  };
}

function checkEngineFiles() {
  const missing = [];
  for (const rel of REQUIRED_ENGINE_FILES) {
    const full = path.join(ENGINE_DIR, rel);
    if (!fs.existsSync(full)) missing.push(rel);
  }
  return {
    ok: missing.length === 0,
    engineDir: ENGINE_DIR,
    missing,
  };
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

function hasAgyCli() {
  const res = probeCommand("agy", ["--version"]);
  return Boolean(res && res.status === 0);
}

function toFileUriBase(fsPath) {
  const normalized = fsPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `file:///${normalized}`;
}

function renderTextTemplate(raw, { repoRoot, pythonBin }) {
  const fileUriRoot = toFileUriBase(repoRoot);
  let out = raw.replaceAll("{{WORKSPACE_ROOT_FILE_URI}}", fileUriRoot);
  out = out.replaceAll("{{PYTHON_BIN}}", pythonBin);
  out = out.replace(/\{\{WORKSPACE_ROOT\}\}((?:\/[^\s`'")\],;:]*)?)/g, (_, suffix = "") => {
    if (!suffix) return repoRoot;
    const parts = suffix.split("/").filter(Boolean);
    const joined = path.join(repoRoot, ...parts);
    return suffix.endsWith("/") ? `${joined}${path.sep}` : joined;
  });
  return out;
}

function walkFiles(dirPath, baseDir = dirPath) {
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

function installPluginToDir(targetDir, { repoRoot, pythonBin }) {
  if (!fs.existsSync(PLUGIN_TEMPLATE_DIR)) {
    throw new Error(`Plugin source bundle not found at ${PLUGIN_TEMPLATE_DIR}`);
  }

  const relFiles = walkFiles(PLUGIN_TEMPLATE_DIR);
  const written = [];

  for (const rel of relFiles) {
    const srcPath = path.join(PLUGIN_TEMPLATE_DIR, rel);
    const dstPath = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });

    const normRel = rel.replace(/\\/g, "/");
    if (normRel === "mcp_config.json") {
      const mcpConfig = {
        mcpServers: {
          "tech-video-studio": {
            command: "node",
            args: [path.join(repoRoot, "engine", "mcp_server.mjs")],
            env: {
              VIDEO_MAKER_PORT: "3030",
            },
          },
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

function verifyInstalledDir(targetDir, written = []) {
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

function inspectExistingInstall(dir) {
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
  const agyAvailable = hasAgyCli();

  const report = {
    repoRoot: REPO_ROOT,
    mode: opts.checkOnly ? "check" : opts.target,
    environment: {
      node: nodeInfo,
      python: pythonInfo,
      chrome: chromeInfo,
      engine: engineInfo,
      serverPort3030Running: serverRunning,
      agyCliAvailable: agyAvailable,
    },
    installations: [],
    existing: {
      workspace: inspectExistingInstall(WORKSPACE_PLUGIN_DIR),
      global: inspectExistingInstall(GLOBAL_PLUGIN_DIR),
    },
  };

  if (!engineInfo.ok) {
    throw new Error(`Missing required engine files: ${engineInfo.missing.join(", ")}`);
  }

  if (!opts.checkOnly) {
    const context = { repoRoot: REPO_ROOT, pythonBin: pythonInfo.bin };

    if (opts.target === "custom") {
      if (!opts.customOut) {
        throw new Error("--out requires a target directory path");
      }
      const resolvedOut = path.resolve(opts.customOut);
      report.installations.push({
        scope: "custom",
        ...installPluginToDir(resolvedOut, context),
      });
    } else {
      if (opts.target === "workspace" || opts.target === "all") {
        report.installations.push({
          scope: "workspace",
          ...installPluginToDir(WORKSPACE_PLUGIN_DIR, context),
        });
      }

      if (opts.target === "global" || opts.target === "all") {
        if (opts.useAgy && agyAvailable) {
          const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvs-plugin-"));
          try {
            installPluginToDir(stageDir, context);
            const agyRes = spawnSync("agy", ["plugin", "install", stageDir], {
              encoding: "utf-8",
              windowsHide: true,
            });
            if (agyRes.status !== 0) {
              throw new Error(
                `agy plugin install failed (${agyRes.status}): ${agyRes.stderr || agyRes.stdout}`
              );
            }
            report.installations.push({
              scope: "global-agy",
              ...verifyInstalledDir(GLOBAL_PLUGIN_DIR),
            });
          } finally {
            fs.rmSync(stageDir, { recursive: true, force: true });
          }
        } else {
          report.installations.push({
            scope: "global",
            ...installPluginToDir(GLOBAL_PLUGIN_DIR, context),
          });
        }
      }
    }

    report.existing = {
      workspace: inspectExistingInstall(WORKSPACE_PLUGIN_DIR),
      global: inspectExistingInstall(GLOBAL_PLUGIN_DIR),
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

  if (opts.checkOnly) {
    console.log("\n--- Existing Installations ---");
    console.log(
      `Workspace (.agents/plugins): ${
        report.existing.workspace.installed ? (report.existing.workspace.ok ? "Installed (OK)" : "Incomplete") : "Not installed"
      }`
    );
    console.log(
      `Global (~/.gemini/config)  : ${
        report.existing.global.installed ? (report.existing.global.ok ? "Installed (OK)" : "Incomplete") : "Not installed"
      }`
    );
  } else {
    console.log("\n--- Installed Plugin Bundles ---");
    for (const inst of report.installations) {
      console.log(`[${inst.scope}] ${inst.targetDir}`);
      console.log(`  Status     : ${inst.ok ? "OK" : "FAILED"}`);
      console.log(`  Files      : ${inst.fileCount} files (4 skills + rules + mcp_config.json)`);
      console.log(`  MCP Server : ${inst.mcpServerPath} (${inst.mcpServerExists ? "exists" : "missing"})`);
      if (inst.missing.length > 0) {
        console.log(`  Missing    : ${inst.missing.join(", ")}`);
      }
    }
    console.log("\n--- Next Steps ---");
    console.log('1. Start Studio server: node "engine/server.mjs"');
    console.log("2. Open Web Studio   : http://localhost:3030");
    console.log("3. Re-open / reload this workspace in Antigravity so the plugin & 4 skills are active.");
  }
}

try {
  await main();
} catch (err) {
  console.error(`[setup] ERROR: ${err.message}`);
  process.exit(1);
}
