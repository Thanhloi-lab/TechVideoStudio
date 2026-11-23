#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { detectInstalledAgents } from "../engine/agent_detector.mjs";
import { checkAllDependencies, getDependencyInstallPlan, runDependencyInstall } from "../engine/dep_installer.mjs";
import { checkAiEnvKeys, installDetectedAgent } from "../engine/setup_adapters.mjs";

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), "..");

const RUNTIME_ENTRIES = [
  "engine",
  "plugin",
  "AGENTS.md",
  "CHANGELOG.md",
  "GUIDE.md",
  "README.md",
  "setup.mjs",
  "package.json",
];

const SYNC_SKIP_NAMES = new Set([
  ".git",
  ".agents",
  ".claude",
  "node_modules",
  "__pycache__",
  ".voice_cache",
  ".voice_preview_cache",
  ".ai_credentials.json",
  ".ai_preferences.json",
  ".ai_queue.json",
]);

function printUsage() {
  console.log(`
Tech Course Video Studio — Universal Installer & CLI (Zero-Dependency)

Usage:
  npx tech-video-studio [command] [options]
  npx github:Thanhloi-lab/TechVideoStudio [command] [options]

Commands:
  setup, init          Detect installed AI Agents & dependencies, then install plugin/skills (default)
  check, detect        Read-only scan of Node/Python/Chrome and locally installed AI Agents
  studio, serve        Start the 3-screen Web Studio server (http://localhost:3030)
  help                 Show this help message

Options:
  --agents <id1,id2>   Non-interactive agent selection (only accepts detected agent IDs)
  --install-dir <dir>  Permanent runtime directory (default: ~/.tech-video-studio when run via npx)
  --workspace <dir>    Target workspace directory for workspace-level skills/plugins (default: cwd)
  --no-workspace       Skip workspace-level files; install global user-level configs only
  --install-deps       Automatically install missing Python / Chrome without prompting
  --no-install-deps    Skip installing missing system dependencies
  --yes, -y            Accept defaults non-interactively (all detected agents)
  --dry-run            Preview planned actions without modifying files or running installers
  --port <num>         Port for 'studio' command (default: 3030)
  --json               Output machine-readable JSON summary
  --help, -h           Show help
`.trim());
}

function parseArgs(argv) {
  const opts = {
    command: "setup",
    agents: null,
    installDir: "",
    workspaceDir: "",
    includeWorkspace: true,
    installDeps: null, // null = ask if missing, true = auto-install, false = skip
    yes: false,
    dryRun: false,
    port: 3030,
    json: false,
    help: false,
  };

  let positionalSet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--yes" || arg === "-y") {
      opts.yes = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--install-deps") {
      opts.installDeps = true;
    } else if (arg === "--no-install-deps") {
      opts.installDeps = false;
    } else if (arg === "--no-workspace") {
      opts.includeWorkspace = false;
    } else if (arg === "--agents") {
      const raw = argv[++i] || "";
      opts.agents = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === "--install-dir") {
      opts.installDir = argv[++i] || "";
    } else if (arg === "--workspace") {
      opts.workspaceDir = argv[++i] || "";
    } else if (arg === "--port") {
      opts.port = Number(argv[++i] || 3030) || 3030;
    } else if (!arg.startsWith("-") && !positionalSet) {
      opts.command = arg.toLowerCase();
      positionalSet = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function isEphemeralNpxRoot(dir) {
  const norm = path.resolve(dir).replace(/\\/g, "/").toLowerCase();
  if (fs.existsSync(path.join(dir, ".git"))) return false;
  return norm.includes("/_npx/") || norm.includes("/node_modules/") || norm.includes("/npm-cache/");
}

function copyFilteredSync(src, dst) {
  const stat = fs.lstatSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (SYNC_SKIP_NAMES.has(entry.name)) continue;
      copyFilteredSync(path.join(src, entry.name), path.join(dst, entry.name));
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

/**
 * Ensure the engine + plugin bundle lives at a permanent path on disk so installed
 * skills and MCP server configs never point into a temporary npx cache directory.
 */
function materializeRuntime(opts) {
  const runningFromNpx = isEphemeralNpxRoot(PACKAGE_ROOT);
  const targetDir = opts.installDir
    ? path.resolve(opts.installDir)
    : runningFromNpx
      ? path.join(os.homedir(), ".tech-video-studio")
      : PACKAGE_ROOT;

  const needsCopy = path.resolve(targetDir) !== path.resolve(PACKAGE_ROOT);
  if (needsCopy && !opts.dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const rel of RUNTIME_ENTRIES) {
      const src = path.join(PACKAGE_ROOT, rel);
      if (fs.existsSync(src)) {
        copyFilteredSync(src, path.join(targetDir, rel));
      }
    }
  }

  return {
    installRoot: targetDir,
    copiedFromPackage: needsCopy,
    runningFromNpx,
  };
}

function askYesNo(question, defaultYes = true) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    rl.question(`${question} ${hint}: `, (answer) => {
      rl.close();
      const trimmed = String(answer || "").trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

/**
 * Zero-dependency interactive checkbox multi-select for detected AI agents.
 * Supports arrow keys + Space + Enter on raw TTY, with numbered fallback otherwise.
 */
function promptSelectAgents(detectedAgents) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    return new Promise((resolve) => {
      console.log("\nDetected AI Agents on this machine:");
      detectedAgents.forEach((a, idx) => {
        const badge = a.kind === "cli" ? "CLI" : "App";
        console.log(`  [${idx + 1}] ${a.name} [${badge}] — ${a.installSummary}`);
      });
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("\nSelect numbers (comma-separated, or press Enter for ALL detected): ", (ans) => {
        rl.close();
        const trimmed = String(ans || "").trim().toLowerCase();
        if (!trimmed || trimmed === "all" || trimmed === "*") {
          return resolve(detectedAgents);
        }
        const indices = trimmed
          .split(/[,\s]+/)
          .map((n) => Number(n) - 1)
          .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < detectedAgents.length);
        resolve(Array.from(new Set(indices)).map((idx) => detectedAgents[idx]));
      });
    });
  }

  return new Promise((resolve) => {
    let cursor = 0;
    const selected = new Set(detectedAgents.map((_, i) => i));
    let renderedLines = 0;

    const render = () => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      }
      const lines = [
        "Select AI Agent(s) detected on this machine (↑/↓ move, Space toggle, a all, Enter confirm):",
      ];
      detectedAgents.forEach((agent, idx) => {
        const pointer = idx === cursor ? ">" : " ";
        const box = selected.has(idx) ? "[x]" : "[ ]";
        const badge = agent.kind === "cli" ? "CLI" : "App";
        lines.push(` ${pointer} ${box} ${agent.name} [${badge}]`);
        lines.push(`       ${agent.installSummary}`);
      });
      lines.push(` (${selected.size}/${detectedAgents.length} selected)`);
      process.stdout.write(`${lines.join("\n")}\n`);
      renderedLines = lines.length;
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render();

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const onKeypress = (_str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\nCancelled.\n");
        process.exit(130);
      }
      if (key.name === "q" || key.name === "escape") {
        cleanup();
        resolve([]);
        return;
      }
      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + detectedAgents.length) % detectedAgents.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % detectedAgents.length;
        render();
      } else if (key.name === "space") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render();
      } else if (key.name === "a") {
        if (selected.size === detectedAgents.length) selected.clear();
        else detectedAgents.forEach((_, i) => selected.add(i));
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        const chosen = detectedAgents.filter((_, i) => selected.has(i));
        resolve(chosen);
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function runStudioCommand(opts) {
  const runtime = materializeRuntime({ ...opts, dryRun: true });
  const serverPath = path.join(runtime.installRoot, "engine", "server.mjs");
  const actualServer = fs.existsSync(serverPath) ? serverPath : path.join(PACKAGE_ROOT, "engine", "server.mjs");
  const workspaceRoot = opts.workspaceDir ? path.resolve(opts.workspaceDir) : process.cwd();

  console.log(`[tvs] Starting Web Studio on http://localhost:${opts.port}`);
  console.log(`[tvs] Workspace: ${workspaceRoot}`);
  const child = spawn(process.execPath, [actualServer], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(opts.port),
      VIDEO_MAKER_WORKSPACE_ROOT: workspaceRoot,
    },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function runCheckCommand(opts) {
  const deps = checkAllDependencies();
  const agents = detectInstalledAgents();
  const aiEnvKeys = checkAiEnvKeys();
  const runtime = materializeRuntime({ ...opts, dryRun: true });

  const report = {
    mode: "check",
    packageRoot: PACKAGE_ROOT,
    installRoot: runtime.installRoot,
    dependencies: deps,
    agents: {
      detectedCount: agents.detected.length,
      detected: agents.detected,
      notDetected: agents.notDetected.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    },
    aiEnvKeys,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=== Tech Course Video Studio — System & AI Agent Check ===");
  console.log(`Runtime dir    : ${runtime.installRoot}`);
  console.log(`Node.js        : ${deps.node.version} -> ${deps.node.ok ? "OK" : "NEEDS UPGRADE (>= 22)"}`);
  console.log(`Python         : ${deps.python.version || "Not found"} -> ${deps.python.ok ? "OK" : "MISSING (>= 3.10)"}`);
  console.log(`Google Chrome  : ${deps.chrome.path || "Not found"} -> ${deps.chrome.ok ? "OK" : "MISSING"}`);
  console.log(`\nDetected AI Agents (${agents.detected.length}/${agents.all.length}):`);
  if (agents.detected.length === 0) {
    console.log("  (None detected on this machine)");
  } else {
    for (const a of agents.detected) {
      console.log(`  ✔ ${a.name} [${a.kind.toUpperCase()}] (${a.id})`);
      console.log(`      Found : ${a.evidence}`);
      console.log(`      Target: ${a.installSummary}`);
    }
  }
}

async function runSetupCommand(opts) {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !opts.yes && !opts.json);
  let deps = checkAllDependencies();
  const depActions = [];

  if (!opts.json) {
    console.log("=== Tech Course Video Studio — Universal Setup ===");
    console.log(`Node.js       : ${deps.node.version} (${deps.node.ok ? "OK" : "WARNING: >= 22 recommended"})`);
    console.log(`Python        : ${deps.python.version || "Not found"} (${deps.python.ok ? "OK" : "MISSING"})`);
    console.log(`Google Chrome : ${deps.chrome.path || "Not found"} (${deps.chrome.ok ? "OK" : "MISSING"})`);
  }

  // Step 1: Install missing OS dependencies (Python / Chrome) if requested or confirmed
  const installableMissing = deps.missing.filter((d) => d.id === "python" || d.id === "chrome");
  if (installableMissing.length > 0 && opts.installDeps !== false) {
    let shouldInstall = opts.installDeps === true;
    if (opts.installDeps === null && interactive) {
      console.log("\nMissing system dependencies detected:");
      for (const dep of installableMissing) {
        const plan = getDependencyInstallPlan(dep.id);
        console.log(`  - ${dep.name}: ${plan.supported ? plan.display : plan.reason}`);
      }
      shouldInstall = await askYesNo("Install missing dependencies automatically now?", true);
    }

    if (shouldInstall) {
      for (const dep of installableMissing) {
        depActions.push(runDependencyInstall(dep.id, { dryRun: opts.dryRun, log: opts.json ? () => {} : console.log }));
      }
      if (!opts.dryRun) {
        deps = checkAllDependencies();
      }
    }
  }

  // Step 2: Ensure permanent runtime directory (important when invoked via npx temp cache)
  const runtime = materializeRuntime(opts);
  const workspaceRoot = opts.workspaceDir
    ? path.resolve(opts.workspaceDir)
    : runtime.runningFromNpx
      ? process.cwd()
      : runtime.installRoot;

  if (!opts.json && runtime.copiedFromPackage) {
    console.log(
      `\n[runtime] ${opts.dryRun ? "Would sync" : "Synced"} studio engine & plugin SSOT -> ${runtime.installRoot}`
    );
  }

  // Step 3: Detect locally installed AI Agents (strictly ONLY show detected agents)
  const scan = detectInstalledAgents();
  if (scan.detected.length === 0) {
    const emptyReport = {
      ok: false,
      reason: "no_ai_agents_detected",
      installRoot: runtime.installRoot,
      dependencies: deps,
      dependencyActions: depActions,
      detectedAgents: [],
      installations: [],
    };
    if (opts.json) {
      console.log(JSON.stringify(emptyReport, null, 2));
    } else {
      console.log("\nNo supported AI Agent (App or CLI) was detected on this machine.");
      console.log("Checked: " + scan.all.map((a) => `${a.name} (${a.id})`).join(", "));
      console.log(`Engine files are still ready at: ${runtime.installRoot}`);
    }
    return;
  }

  let selectedAgents = [];
  if (opts.agents && opts.agents.length > 0) {
    const detectedById = new Map(scan.detected.map((a) => [a.id, a]));
    const invalid = opts.agents.filter((id) => !detectedById.has(id));
    if (invalid.length > 0) {
      const availableList = scan.detected.map((a) => a.id).join(", ");
      throw new Error(
        `Agent(s) not detected on this machine: ${invalid.join(", ")}. Detected options: ${availableList}`
      );
    }
    selectedAgents = opts.agents.map((id) => detectedById.get(id));
  } else if (interactive) {
    console.log("");
    selectedAgents = await promptSelectAgents(scan.detected);
  } else {
    selectedAgents = scan.detected;
  }

  if (selectedAgents.length === 0) {
    if (opts.json) {
      console.log(
        JSON.stringify({ ok: true, cancelled: true, detectedAgents: scan.detected, installations: [] }, null, 2)
      );
    } else {
      console.log("\nNo AI Agent selected. Nothing was installed.");
    }
    return;
  }

  // Step 4: Install plugin / skills / MCP into each selected AI Agent
  const installations = [];
  for (const agent of selectedAgents) {
    if (opts.dryRun) {
      installations.push({
        agentId: agent.id,
        name: agent.name,
        ok: true,
        dryRun: true,
        summary: agent.installSummary,
      });
      continue;
    }
    const res = installDetectedAgent(agent.id, {
      repoRoot: runtime.installRoot,
      workspaceRoot,
      pythonBin: deps.python.bin || "python",
      includeWorkspace: opts.includeWorkspace,
    });
    installations.push({ name: agent.name, ...res });
  }

  const report = {
    ok: installations.every((i) => i.ok),
    dryRun: opts.dryRun,
    installRoot: runtime.installRoot,
    workspaceRoot,
    copiedFromPackage: runtime.copiedFromPackage,
    dependencies: deps,
    dependencyActions: depActions,
    detectedAgents: scan.detected,
    selectedAgents: selectedAgents.map((a) => a.id),
    installations,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\n=== Installation Summary ===");
  for (const inst of installations) {
    if (inst.dryRun) {
      console.log(`  [dry-run] ${inst.name} (${inst.agentId}) -> ${inst.summary}`);
      continue;
    }
    console.log(`  ${inst.ok ? "✔" : "✖"} ${inst.name} (${inst.agentId})`);
    for (const r of inst.results || []) {
      const target = r.targetDir || r.path || r.target;
      console.log(`      - ${r.target}: ${target} (${r.ok ? "OK" : "FAILED"})${r.backupPath ? ` [backup: ${r.backupPath}]` : ""}`);
    }
  }

  console.log("\n=== Next Steps ===");
  console.log("1. Reload or reopen your AI Agent so the new skills, rules & MCP server load.");
  console.log("2. You do NOT need to start port 3030 to create curricula, scripts, TTS, or render videos.");
  console.log("3. Optional Web Studio UI: run `npx tech-video-studio studio` (http://localhost:3030).");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.command === "help") {
    printUsage();
    return;
  }
  if (opts.command === "check" || opts.command === "detect") {
    await runCheckCommand(opts);
    return;
  }
  if (opts.command === "studio" || opts.command === "serve") {
    runStudioCommand(opts);
    return;
  }
  if (opts.command === "setup" || opts.command === "init") {
    await runSetupCommand(opts);
    return;
  }
  throw new Error(`Unknown command: ${opts.command}. Run with --help for usage.`);
}

try {
  await main();
} catch (err) {
  console.error(`[tech-video-studio] ERROR: ${err.message}`);
  process.exit(1);
}
