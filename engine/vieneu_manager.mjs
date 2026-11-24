import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { probeCommand } from "./dep_installer.mjs";

export const VIENEU_REPO_URL = "https://github.com/pnnbao97/VieNeu-TTS.git";
export const DEFAULT_VIENEU_PORT = 8000;

/**
 * Find `uv` binary in PATH or standard user install locations.
 */
export function findUvBinary() {
  const direct = probeCommand("uv", ["--version"]);
  if (direct && direct.status === 0) {
    return { found: true, bin: "uv", version: direct.output.split(/\r?\n/)[0]?.trim() || "installed" };
  }
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, ".local", "bin", "uv.exe"),
          path.join(home, ".cargo", "bin", "uv.exe"),
        ]
      : [
          path.join(home, ".local", "bin", "uv"),
          path.join(home, ".cargo", "bin", "uv"),
          "/opt/homebrew/bin/uv",
          "/usr/local/bin/uv",
        ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const res = probeCommand(candidate, ["--version"]);
      if (res && res.status === 0) {
        return { found: true, bin: candidate, version: res.output.split(/\r?\n/)[0]?.trim() || "installed" };
      }
    }
  }
  return { found: false, bin: null, version: null };
}

function isVieneuRepoDir(dir) {
  if (!dir) return false;
  try {
    return (
      fs.existsSync(path.join(dir, "pyproject.toml")) &&
      fs.existsSync(path.join(dir, "apps", "openai_speech.py"))
    );
  } catch {
    return false;
  }
}

/**
 * Locate an existing VieNeu-TTS installation or return the default managed install target.
 */
export function resolveVieneuDir({ installRoot, customDir } = {}) {
  if (customDir) {
    const abs = path.resolve(customDir);
    return { dir: abs, installed: isVieneuRepoDir(abs), source: "custom" };
  }
  if (process.env.VIENEU_DIR) {
    const abs = path.resolve(process.env.VIENEU_DIR);
    return { dir: abs, installed: isVieneuRepoDir(abs), source: "env" };
  }

  const managedInRoot = installRoot ? path.join(path.resolve(installRoot), "vieneu-tts") : null;
  const managedInHome = path.join(os.homedir(), ".tech-video-studio", "vieneu-tts");
  const siblingRepo = installRoot ? path.join(path.dirname(path.resolve(installRoot)), "VieNeu-TTS") : null;

  const searchOrder = [
    managedInRoot ? { dir: managedInRoot, source: "managed-root" } : null,
    { dir: managedInHome, source: "managed-home" },
    siblingRepo ? { dir: siblingRepo, source: "sibling" } : null,
  ].filter(Boolean);

  for (const candidate of searchOrder) {
    if (isVieneuRepoDir(candidate.dir)) {
      return { dir: candidate.dir, installed: true, source: candidate.source };
    }
  }

  // Default managed install location: inside ~/.tech-video-studio/vieneu-tts (or installRoot/vieneu-tts if already in home)
  const defaultDir = managedInHome;
  return { dir: defaultDir, installed: false, source: "default" };
}

export function isVieneuReadyOnDisk(dir) {
  if (!isVieneuRepoDir(dir)) return false;
  const venvDir = path.join(dir, ".venv");
  return fs.existsSync(venvDir);
}

/**
 * Probe whether VieNeu-TTS OpenAI speech server is responding on `port`.
 */
export function probeVieneuServer(port = DEFAULT_VIENEU_PORT, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

export async function inspectVieneuStatus({ installRoot, customDir, port = DEFAULT_VIENEU_PORT } = {}) {
  const uv = findUvBinary();
  const git = probeCommand("git", ["--version"]);
  const loc = resolveVieneuDir({ installRoot, customDir });
  const venvReady = isVieneuReadyOnDisk(loc.dir);
  const running = await probeVieneuServer(port);
  return {
    installed: loc.installed,
    venvReady,
    ready: loc.installed && venvReady,
    dir: loc.dir,
    source: loc.source,
    port,
    running,
    uv,
    gitFound: Boolean(git && git.status === 0),
  };
}

/**
 * Automatically install `uv` using official signed OS installer if missing.
 */
export function ensureUvInstalled({ log = console.log, dryRun = false } = {}) {
  const current = findUvBinary();
  if (current.found) return current;

  if (process.platform === "win32") {
    const hasWinget = Boolean(probeCommand("winget", ["--version"])?.status === 0);
    if (hasWinget) {
      if (dryRun) {
        log("[vieneu:dry-run] Would install uv via winget install --id astral-sh.uv -e");
        return { found: true, bin: "uv", dryRun: true };
      }
      log("[vieneu] Installing uv via winget...");
      const res = spawnSync(
        "winget",
        [
          "install",
          "--id",
          "astral-sh.uv",
          "-e",
          "--source",
          "winget",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        { stdio: "inherit" }
      );
      if (res.status === 0) {
        const after = findUvBinary();
        if (after.found) return after;
      }
    }
    if (dryRun) {
      log("[vieneu:dry-run] Would install uv via PowerShell official script (https://astral.sh/uv/install.ps1)");
      return { found: true, bin: "uv", dryRun: true };
    }
    log("[vieneu] Installing uv via official PowerShell installer...");
    spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "ByPass", "-c", "irm https://astral.sh/uv/install.ps1 | iex"], {
      stdio: "inherit",
    });
    return findUvBinary();
  }

  if (dryRun) {
    log("[vieneu:dry-run] Would install uv via https://astral.sh/uv/install.sh");
    return { found: true, bin: "uv", dryRun: true };
  }
  log("[vieneu] Installing uv via official shell installer...");
  spawnSync("sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"], { stdio: "inherit" });
  return findUvBinary();
}

/**
 * Clone & sync VieNeu-TTS (torch-free ONNX Runtime by default, or --extra cuda if requested).
 */
export function installVieneuTts({
  installRoot,
  customDir,
  cuda = false,
  log = console.log,
  dryRun = false,
} = {}) {
  const loc = resolveVieneuDir({ installRoot, customDir });
  const targetDir = loc.dir;

  const git = probeCommand("git", ["--version"]);
  if (!git || git.status !== 0) {
    return { ok: false, dir: targetDir, error: "git is required to install VieNeu-TTS." };
  }

  const uv = ensureUvInstalled({ log, dryRun });
  if (!uv.found) {
    return { ok: false, dir: targetDir, error: "Failed to install or locate `uv`. Install uv from https://docs.astral.sh/uv/." };
  }

  if (!loc.installed) {
    if (dryRun) {
      log(`[vieneu:dry-run] Would clone ${VIENEU_REPO_URL} -> ${targetDir}`);
    } else {
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      log(`[vieneu] Cloning VieNeu-TTS -> ${targetDir}...`);
      const cloneRes = spawnSync("git", ["clone", "--depth", "1", VIENEU_REPO_URL, targetDir], {
        stdio: "inherit",
      });
      if (cloneRes.error || cloneRes.status !== 0) {
        return { ok: false, dir: targetDir, error: `git clone VieNeu-TTS failed (${cloneRes.status ?? "err"})` };
      }
    }
  } else if (!dryRun) {
    log(`[vieneu] Found existing VieNeu-TTS at ${targetDir}`);
  }

  const syncArgs = cuda ? ["sync", "--extra", "cuda"] : ["sync"];
  if (dryRun) {
    log(`[vieneu:dry-run] Would run \`${uv.bin} ${syncArgs.join(" ")}\` in ${targetDir}`);
    return { ok: true, dryRun: true, dir: targetDir, cuda };
  }

  log(`[vieneu] Running \`${uv.bin} ${syncArgs.join(" ")}\` (torch-free ONNX Runtime${cuda ? " + CUDA" : ""})...`);
  const syncRes = spawnSync(uv.bin, syncArgs, {
    cwd: targetDir,
    stdio: "inherit",
  });
  if (syncRes.error || syncRes.status !== 0) {
    return { ok: false, dir: targetDir, error: `uv sync failed (${syncRes.status ?? "err"})` };
  }

  return {
    ok: isVieneuReadyOnDisk(targetDir),
    dir: targetDir,
    cuda,
    uvBin: uv.bin,
  };
}

/**
 * Spawn VieNeu-TTS OpenAI-compatible speech server (`POST /v1/audio/speech`) on `port`.
 * Returns { alreadyRunning, child, dir, port, stop() }.
 */
export async function startVieneuServer({
  installRoot,
  customDir,
  port = DEFAULT_VIENEU_PORT,
  log = console.log,
} = {}) {
  if (await probeVieneuServer(port)) {
    log(`[vieneu] Reusing running VieNeu-TTS server at http://127.0.0.1:${port}`);
    return { alreadyRunning: true, child: null, port, stop: () => {} };
  }

  const status = await inspectVieneuStatus({ installRoot, customDir, port });
  if (!status.installed || !status.venvReady) {
    throw new Error(
      `VieNeu-TTS is not installed at ${status.dir}. Run \`npx github:Thanhloi-lab/TechVideoStudio setup --with-vieneu\` first.`
    );
  }
  if (!status.uv.found) {
    throw new Error("`uv` not found in PATH. Install uv or re-run setup --with-vieneu.");
  }

  log(`[vieneu] Starting VieNeu-TTS OpenAI Speech API on http://127.0.0.1:${port} (${status.dir})...`);
  const child = spawn(status.uv.bin, ["run", "python", "-m", "apps.openai_speech"], {
    cwd: status.dir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      VIENEU_PORT: String(port),
    },
  });

  const stop = () => {
    if (child && !child.killed && child.exitCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  };

  return { alreadyRunning: false, child, dir: status.dir, port, stop };
}
