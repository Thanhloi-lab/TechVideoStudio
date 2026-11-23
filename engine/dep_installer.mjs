import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function parseSemver(verStr) {
  const m = String(verStr || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: m[0] } : null;
}

export function probeCommand(cmd, args, timeout = 4000) {
  try {
    const res = spawnSync(cmd, args, { encoding: "utf-8", windowsHide: true, timeout });
    if (res.error) return null;
    return { status: res.status ?? 0, output: `${res.stdout || ""}\n${res.stderr || ""}`.trim() };
  } catch {
    return null;
  }
}

export function checkNode() {
  const parsed = parseSemver(process.versions.node);
  const ok = Boolean(parsed && parsed.major >= 22);
  return {
    id: "node",
    name: "Node.js (>= 22)",
    version: process.versions.node,
    found: true,
    ok,
    note: ok
      ? "OK (supports global WebSocket for headless Chrome CDP rendering)"
      : "Node.js >= 22 required (render_video.mjs uses global WebSocket)",
  };
}

export function checkPython() {
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const bin of candidates) {
    const res = probeCommand(bin, bin === "py" ? ["-3", "--version"] : ["--version"]);
    if (res && res.status === 0) {
      const parsed = parseSemver(res.output);
      if (parsed) {
        const ok = parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 10);
        const resolvedBin = bin === "py" ? "python" : bin;
        return {
          id: "python",
          name: "Python (>= 3.10)",
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
  return {
    id: "python",
    name: "Python (>= 3.10)",
    found: false,
    bin: process.platform === "win32" ? "python" : "python3",
    version: null,
    ok: false,
    needsPythonBinEnv: false,
    note: "Python >= 3.10 not found in PATH",
  };
}

export function findChrome() {
  const defaultWinChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (process.env.CHROME_PATH) {
    const exists = fs.existsSync(process.env.CHROME_PATH);
    return {
      id: "chrome",
      name: "Google Chrome",
      found: exists,
      ok: exists,
      path: process.env.CHROME_PATH,
      isDefaultWinPath: path.resolve(process.env.CHROME_PATH) === path.resolve(defaultWinChrome),
      note: exists ? "OK (from CHROME_PATH)" : `CHROME_PATH does not exist: ${process.env.CHROME_PATH}`,
    };
  }
  const candidates =
    process.platform === "win32"
      ? [
          defaultWinChrome,
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          ...(process.env.LOCALAPPDATA
            ? [path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")]
            : []),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const isDefault = process.platform === "win32" && path.resolve(candidate) === path.resolve(defaultWinChrome);
      return {
        id: "chrome",
        name: "Google Chrome",
        found: true,
        ok: true,
        path: candidate,
        isDefaultWinPath: isDefault,
        note: isDefault
          ? "OK (default render_video.mjs path)"
          : `Found at non-default path; set CHROME_PATH="${candidate}" when rendering`,
      };
    }
  }
  return {
    id: "chrome",
    name: "Google Chrome",
    found: false,
    ok: false,
    path: null,
    isDefaultWinPath: false,
    note: "Google Chrome not found; install Chrome or set CHROME_PATH",
  };
}

export function checkAllDependencies() {
  const node = checkNode();
  const python = checkPython();
  const chrome = findChrome();
  const missing = [node, python, chrome].filter((d) => !d.ok);
  return { node, python, chrome, ok: missing.length === 0, missing };
}

/**
 * Determine the official OS package manager command to install a missing dependency.
 * Uses signed system installers (winget / brew / apt / dnf) to remain WDAC-safe.
 */
export function getDependencyInstallPlan(depId, platform = process.platform) {
  if (platform === "win32") {
    const hasWinget = Boolean(probeCommand("winget", ["--version"])?.status === 0);
    if (!hasWinget) {
      return {
        supported: false,
        reason: "winget is not available. Please install manually from the official website.",
      };
    }
    if (depId === "python") {
      return {
        supported: true,
        manager: "winget",
        cmd: "winget",
        args: [
          "install",
          "--id",
          "Python.Python.3.12",
          "-e",
          "--source",
          "winget",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        display: "winget install --id Python.Python.3.12 -e",
      };
    }
    if (depId === "chrome") {
      return {
        supported: true,
        manager: "winget",
        cmd: "winget",
        args: [
          "install",
          "--id",
          "Google.Chrome",
          "-e",
          "--source",
          "winget",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        display: "winget install --id Google.Chrome -e",
      };
    }
    if (depId === "node") {
      return {
        supported: true,
        manager: "winget",
        cmd: "winget",
        args: [
          "install",
          "--id",
          "OpenJS.NodeJS.LTS",
          "-e",
          "--source",
          "winget",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        display: "winget install --id OpenJS.NodeJS.LTS -e",
      };
    }
  }

  if (platform === "darwin") {
    const hasBrew = Boolean(probeCommand("brew", ["--version"])?.status === 0);
    if (!hasBrew) {
      return {
        supported: false,
        reason: "Homebrew (brew) is not available. Install Homebrew or download the official installer.",
      };
    }
    if (depId === "python") {
      return { supported: true, manager: "brew", cmd: "brew", args: ["install", "python@3.12"], display: "brew install python@3.12" };
    }
    if (depId === "chrome") {
      return { supported: true, manager: "brew", cmd: "brew", args: ["install", "--cask", "google-chrome"], display: "brew install --cask google-chrome" };
    }
    if (depId === "node") {
      return { supported: true, manager: "brew", cmd: "brew", args: ["install", "node@22"], display: "brew install node@22" };
    }
  }

  if (platform === "linux") {
    const hasApt = Boolean(probeCommand("apt-get", ["--version"])?.status === 0);
    const hasDnf = Boolean(probeCommand("dnf", ["--version"])?.status === 0);
    if (hasApt) {
      if (depId === "python") {
        return { supported: true, manager: "apt-get", cmd: "sudo", args: ["apt-get", "install", "-y", "python3"], display: "sudo apt-get install -y python3" };
      }
      if (depId === "chrome") {
        return { supported: true, manager: "apt-get", cmd: "sudo", args: ["apt-get", "install", "-y", "chromium-browser"], display: "sudo apt-get install -y chromium-browser" };
      }
    }
    if (hasDnf) {
      if (depId === "python") {
        return { supported: true, manager: "dnf", cmd: "sudo", args: ["dnf", "install", "-y", "python3"], display: "sudo dnf install -y python3" };
      }
      if (depId === "chrome") {
        return { supported: true, manager: "dnf", cmd: "sudo", args: ["dnf", "install", "-y", "chromium"], display: "sudo dnf install -y chromium" };
      }
    }
  }

  return {
    supported: false,
    reason: `No supported automatic package manager found for '${depId}' on ${platform}.`,
  };
}

/**
 * Execute an OS dependency installation plan interactively (inheriting stdio).
 */
export function runDependencyInstall(depId, { log = console.log, dryRun = false } = {}) {
  const plan = getDependencyInstallPlan(depId);
  if (!plan.supported) {
    return { id: depId, ok: false, skipped: true, reason: plan.reason };
  }
  if (dryRun) {
    log(`[deps:dry-run] Would run: ${plan.display}`);
    return { id: depId, ok: true, dryRun: true, command: plan.display };
  }
  log(`[deps] Installing ${depId} via ${plan.manager}: ${plan.display}`);
  const res = spawnSync(plan.cmd, plan.args, { stdio: "inherit" });
  const ok = !res.error && res.status === 0;
  return {
    id: depId,
    ok,
    manager: plan.manager,
    command: plan.display,
    status: res.status,
    error: res.error?.message || null,
  };
}
