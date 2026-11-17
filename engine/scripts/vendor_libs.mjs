#!/usr/bin/env node
/**
 * Offline ESM Vendor Bundler for Tech Video Studio (Pure Node.js ESM, zero npm deps).
 *
 * Recursively mirrors browser-ready ESM modules from esm.sh into:
 *   engine/public/vendor/esm/...
 * rewrites internal static & dynamic module specifiers to local relative paths,
 * strips remote sourceMappingURL hints, writes engine/public/vendor/vendor-manifest.json,
 * and verifies zero unresolved https://esm.sh URLs or missing static dependencies remain.
 *
 * Usage:
 *   node engine/scripts/vendor_libs.mjs
 *   node engine/scripts/vendor_libs.mjs --verify-only
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(ENGINE_DIR, "public", "vendor");
const ESM_ROOT_DIR = path.join(VENDOR_DIR, "esm");
const MANIFEST_PATH = path.join(VENDOR_DIR, "vendor-manifest.json");

const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const VENDOR_SPECS = [
  { key: "react", url: "https://esm.sh/react@18.3.1" },
  { key: "react/jsx-runtime", url: "https://esm.sh/react@18.3.1/jsx-runtime" },
  { key: "react-dom", url: "https://esm.sh/react-dom@18.3.1" },
  { key: "react-dom/client", url: "https://esm.sh/react-dom@18.3.1/client" },
  { key: "gsap", url: "https://esm.sh/gsap@3.15.1" },
  { key: "animejs", url: "https://esm.sh/animejs@4.5.0" },
  { key: "motion", url: "https://esm.sh/motion@14.14.0" },
  { key: "motion/react", url: "https://esm.sh/motion@14.14.0/react?external=react,react-dom" },
  { key: "rough-notation", url: "https://esm.sh/rough-notation@0.5.1" },
  { key: "shiki", url: "https://esm.sh/shiki@4.6.0" },
  { key: "@shikijs/magic-move/core", url: "https://esm.sh/@shikijs/magic-move@4.6.0/core" },
  { key: "@shikijs/magic-move/renderer", url: "https://esm.sh/@shikijs/magic-move@4.6.0/renderer" },
  { key: "webm-muxer", url: "https://esm.sh/webm-muxer@5.1.4" },
  { key: "mp4-muxer", url: "https://esm.sh/mp4-muxer@5.1.4" },
];

// Curated Shiki themes & languages mirrored for offline TerminalAndCode highlighting
const SHIKI_THEMES = new Set(["tokyo-night", "github-dark", "dracula"]);
const SHIKI_LANGS = new Set([
  "json",
  "python",
  "bash",
  "shellscript",
  "yaml",
  "javascript",
  "typescript",
  "dockerfile",
  "docker",
  "hcl",
  "terraform",
  "sql",
  "go",
  "html",
  "css",
  "markdown",
  "toml",
  "ini",
  "powershell",
  "xml",
  "java",
  "rust",
  "jsx",
  "tsx",
  "nginx",
  "makefile",
  "diff",
  "http",
]);

const KNOWN_EXTENSIONS = new Set([".mjs", ".js", ".css", ".json", ".wasm"]);

function sha256Hex(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sanitizeSegment(seg) {
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    // Keep raw segment if malformed percent encoding
  }
  return decoded.replace(/[^a-zA-Z0-9._@+-]/g, "_");
}

/**
 * Deterministically maps a canonical https://esm.sh/... URL to a Windows-safe
 * relative POSIX path under `engine/public/vendor/`.
 */
export function urlToRelVendorPath(rawUrl) {
  const u = new URL(rawUrl);
  const rawSegments = u.pathname.split("/").filter(Boolean);
  const segments = rawSegments.map(sanitizeSegment);
  if (segments.length === 0) {
    segments.push("root");
  }

  const querySuffix = u.search ? `--q_${sha256Hex(u.search).slice(0, 8)}` : "";
  const last = segments[segments.length - 1];
  const ext = path.posix.extname(last).toLowerCase();

  if (KNOWN_EXTENSIONS.has(ext)) {
    if (querySuffix) {
      const stem = last.slice(0, last.length - ext.length);
      segments[segments.length - 1] = `${stem}${querySuffix}${ext}`;
    }
  } else {
    // Extensionless entrypoint (e.g. /react@18.3.1 or /react@18.3.1/jsx-runtime)
    // becomes .../index.mjs so it never collides with subpath directories like /react@18.3.1/es2022/
    if (querySuffix) {
      segments[segments.length - 1] = `${last}${querySuffix}`;
    }
    segments.push("index.mjs");
  }

  return path.posix.join("esm", ...segments);
}

/**
 * Tokenizes JS/ESM enough to find static and dynamic import/export module specifiers
 * without false-positives inside string literals, template strings, comments, or regexes.
 */
export function scanModuleSpecifiers(code) {
  const specs = [];
  const n = code.length;
  let i = 0;
  let prevSignificant = "";

  const regexPrev = new Set([
    "",
    "(",
    "[",
    "{",
    ",",
    ";",
    ":",
    "=",
    "!",
    "?",
    "&",
    "|",
    "^",
    "~",
    "+",
    "-",
    "*",
    "/",
    "%",
    "<",
    ">",
    "return",
    "typeof",
    "void",
    "delete",
    "throw",
    "in",
    "instanceof",
    "of",
    "case",
    "else",
    "await",
    "yield",
    "=>",
  ]);

  const isIdentStart = (c) =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
  const isIdentPart = (c) => isIdentStart(c) || (c >= "0" && c <= "9");

  const tokens = [];
  while (i < n) {
    const ch = code[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      i += 2;
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      const q = ch;
      i++;
      while (i < n && code[i] !== q) {
        if (code[i] === "\\") i += 2;
        else i++;
      }
      i++;
      tokens.push({
        type: "string",
        start,
        end: i,
        quote: q,
        value: code.slice(start + 1, i - 1),
      });
      prevSignificant = "str";
      continue;
    }
    if (ch === "`") {
      const start = i;
      i++;
      let depth = 0;
      while (i < n) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === "$" && code[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (code[i] === "}" && depth > 0) {
          depth--;
          i++;
          continue;
        }
        if (code[i] === "`" && depth === 0) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: "template", start, end: i });
      prevSignificant = "str";
      continue;
    }
    if (ch === "/" && regexPrev.has(prevSignificant)) {
      i++;
      let inClass = false;
      while (i < n) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === "[") inClass = true;
        else if (code[i] === "]") inClass = false;
        else if (code[i] === "/" && !inClass) {
          i++;
          break;
        } else if (code[i] === "\n") {
          break;
        }
        i++;
      }
      while (i < n && isIdentStart(code[i])) i++;
      tokens.push({ type: "regex" });
      prevSignificant = "regex";
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < n && isIdentPart(code[i])) i++;
      const word = code.slice(start, i);
      tokens.push({ type: "ident", value: word, start, end: i });
      prevSignificant = word;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      while (i < n && (isIdentPart(code[i]) || code[i] === ".")) i++;
      tokens.push({ type: "num" });
      prevSignificant = "num";
      continue;
    }
    if (ch === "=" && code[i + 1] === ">") {
      tokens.push({ type: "punct", value: "=>" });
      prevSignificant = "=>";
      i += 2;
      continue;
    }
    tokens.push({ type: "punct", value: ch });
    prevSignificant = ch;
    i++;
  }

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.type !== "ident") continue;
    if (tokens[t - 1]?.type === "punct" && tokens[t - 1].value === ".") continue;

    if (tok.value === "import") {
      const next = tokens[t + 1];
      if (!next) continue;
      if (next.type === "string") {
        specs.push({ ...next, dynamic: false });
      } else if (next.type === "punct" && next.value === "(") {
        const arg = tokens[t + 2];
        const close = tokens[t + 3];
        if (
          arg?.type === "string" &&
          close?.type === "punct" &&
          (close.value === ")" || close.value === ",")
        ) {
          specs.push({ ...arg, dynamic: true });
        }
      } else {
        for (let k = t + 1; k < tokens.length; k++) {
          if (tokens[k].type === "punct" && tokens[k].value === ";") break;
          if (
            tokens[k].type === "ident" &&
            tokens[k].value === "from" &&
            tokens[k + 1]?.type === "string"
          ) {
            specs.push({ ...tokens[k + 1], dynamic: false });
            break;
          }
          if (
            tokens[k].type === "ident" &&
            (tokens[k].value === "import" || tokens[k].value === "export")
          ) {
            break;
          }
        }
      }
    } else if (tok.value === "export") {
      const next = tokens[t + 1];
      if (!next) continue;
      if (next.type === "punct" && next.value === "*") {
        if (
          tokens[t + 2]?.type === "ident" &&
          tokens[t + 2].value === "from" &&
          tokens[t + 3]?.type === "string"
        ) {
          specs.push({ ...tokens[t + 3], dynamic: false });
        } else if (
          tokens[t + 2]?.type === "ident" &&
          tokens[t + 2].value === "as" &&
          tokens[t + 4]?.type === "ident" &&
          tokens[t + 4].value === "from" &&
          tokens[t + 5]?.type === "string"
        ) {
          specs.push({ ...tokens[t + 5], dynamic: false });
        }
      } else if (next.type === "punct" && next.value === "{") {
        let k = t + 2;
        while (k < tokens.length && !(tokens[k].type === "punct" && tokens[k].value === "}")) {
          k++;
        }
        if (
          tokens[k + 1]?.type === "ident" &&
          tokens[k + 1].value === "from" &&
          tokens[k + 2]?.type === "string"
        ) {
          specs.push({ ...tokens[k + 2], dynamic: false });
        }
      }
    }
  }

  return specs;
}

function isBareSpecifier(spec) {
  return (
    !spec.startsWith(".") &&
    !spec.startsWith("/") &&
    !spec.startsWith("https://") &&
    !spec.startsWith("http://")
  );
}

function shouldFetchDynamicTarget(resolvedUrl) {
  const mTheme = resolvedUrl.match(/\/@shikijs\/themes@[^/]+\/es\d+\/([^/.]+)\.mjs$/);
  if (mTheme) return SHIKI_THEMES.has(mTheme[1]);
  const mLang = resolvedUrl.match(/\/@shikijs\/langs@[^/]+\/es\d+\/([^/.]+)\.mjs$/);
  if (mLang) return SHIKI_LANGS.has(mLang[1]);
  return true;
}

function makeRelativeImport(fromRelPath, toRelPath) {
  let rel = path.posix.relative(path.posix.dirname(fromRelPath), toRelPath);
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return rel;
}

async function fetchWithRetry(url, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": CHROME_USER_AGENT },
        redirect: "follow",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      return { finalUrl: res.url || url, text };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message || lastErr}`);
}

function rewriteModuleCode(code, finalUrl, currentRelPath) {
  const specs = scanModuleSpecifiers(code);
  const depsToFetch = [];

  if (specs.length === 0) {
    const cleaned = code.replace(/\n?\/\/# sourceMappingURL=[^\r\n]*/g, "");
    return { rewritten: cleaned, depsToFetch };
  }

  let out = "";
  let cursor = 0;

  for (const s of specs) {
    out += code.slice(cursor, s.start);
    if (isBareSpecifier(s.value)) {
      // Preserve bare specifiers (e.g. "react", "react/jsx-runtime", "react-dom")
      // so the browser importmap provides a single shared React runtime.
      out += code.slice(s.start, s.end);
      cursor = s.end;
      continue;
    }

    const resolvedTarget = new URL(s.value, finalUrl).href;
    if (!resolvedTarget.startsWith("https://esm.sh/")) {
      throw new Error(
        `Unexpected non-esm.sh dependency "${s.value}" -> "${resolvedTarget}" in ${finalUrl}`
      );
    }

    const targetRelPath = urlToRelVendorPath(resolvedTarget);
    const localRef = makeRelativeImport(currentRelPath, targetRelPath);
    out += `${s.quote}${localRef}${s.quote}`;
    cursor = s.end;

    if (!s.dynamic || shouldFetchDynamicTarget(resolvedTarget)) {
      depsToFetch.push(resolvedTarget);
    }
  }

  out += code.slice(cursor);
  out = out.replace(/\n?\/\/# sourceMappingURL=[^\r\n]*/g, "");
  return { rewritten: out, depsToFetch };
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function verifyVendoredFiles() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const esmFiles = walkFiles(ESM_ROOT_DIR);

  if (esmFiles.length === 0) {
    throw new Error(`No vendored ESM files found in ${ESM_ROOT_DIR}`);
  }

  const externalUrlViolations = [];
  const missingStaticTargets = [];

  for (const absPath of esmFiles) {
    const relFromVendor = path.relative(VENDOR_DIR, absPath).split(path.sep).join("/");
    const content = fs.readFileSync(absPath, "utf-8");

    if (/https?:\/\/esm\.sh/i.test(content)) {
      externalUrlViolations.push(relFromVendor);
    }

    const specs = scanModuleSpecifiers(content);
    for (const s of specs) {
      if (isBareSpecifier(s.value)) continue;
      if (s.value.startsWith("https://") || s.value.startsWith("http://") || s.value.startsWith("//")) {
        externalUrlViolations.push(`${relFromVendor} -> ${s.value}`);
        continue;
      }
      if (!s.dynamic) {
        const targetAbs = path.resolve(path.dirname(absPath), s.value);
        if (!fs.existsSync(targetAbs)) {
          missingStaticTargets.push(`${relFromVendor} -> ${s.value}`);
        }
      }
    }
  }

  // Verify every manifest entrypoint exists & sha256 matches
  const manifestErrors = [];
  for (const [key, info] of Object.entries(manifest.modules || {})) {
    const absPath = path.join(VENDOR_DIR, info.file);
    if (!fs.existsSync(absPath)) {
      manifestErrors.push(`Missing entrypoint file for "${key}": ${info.file}`);
      continue;
    }
    const actualHash = sha256Hex(fs.readFileSync(absPath));
    if (actualHash !== info.sha256) {
      manifestErrors.push(`SHA-256 mismatch for "${key}": expected ${info.sha256}, got ${actualHash}`);
    }
  }

  if (externalUrlViolations.length > 0) {
    throw new Error(
      `External URL check failed (${externalUrlViolations.length}):\n` +
        externalUrlViolations.slice(0, 10).join("\n")
    );
  }
  if (missingStaticTargets.length > 0) {
    throw new Error(
      `Missing static dependency targets (${missingStaticTargets.length}):\n` +
        missingStaticTargets.slice(0, 10).join("\n")
    );
  }
  if (manifestErrors.length > 0) {
    throw new Error(`Manifest integrity errors:\n${manifestErrors.join("\n")}`);
  }

  const totalBytes = esmFiles.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  return {
    fileCount: esmFiles.length,
    totalBytes,
    moduleCount: Object.keys(manifest.modules || {}).length,
  };
}

async function runVendorBuild() {
  const startedAt = Date.now();
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  // Clean previous esm tree so removed/updated versions leave no stale files
  if (fs.existsSync(ESM_ROOT_DIR)) {
    fs.rmSync(ESM_ROOT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(ESM_ROOT_DIR, { recursive: true });

  const visited = new Map(); // canonical URL -> { relPath, bytes, sha256 }
  const relPathOwners = new Map(); // relPath -> sourceUrl (collision guard)
  const queue = VENDOR_SPECS.map((s) => s.url);
  const inQueue = new Set(queue);
  const CONCURRENCY = 8;

  async function processUrl(url) {
    const { finalUrl, text } = await fetchWithRetry(url);
    const relPath = urlToRelVendorPath(url);
    const existingOwner = relPathOwners.get(relPath);
    if (existingOwner && existingOwner !== url) {
      throw new Error(`Path collision for ${relPath}: ${existingOwner} vs ${url}`);
    }
    relPathOwners.set(relPath, url);

    const { rewritten, depsToFetch } = rewriteModuleCode(text, finalUrl, relPath);
    const absOut = path.join(VENDOR_DIR, relPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    const buf = Buffer.from(rewritten, "utf-8");
    fs.writeFileSync(absOut, buf);

    visited.set(url, {
      relPath,
      finalUrl,
      bytes: buf.length,
      sha256: sha256Hex(buf),
    });

    for (const depUrl of depsToFetch) {
      if (!visited.has(depUrl) && !inQueue.has(depUrl)) {
        inQueue.add(depUrl);
        queue.push(depUrl);
      }
    }
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map((u) => processUrl(u)));
  }

  const modules = {};
  const importMap = {};
  for (const spec of VENDOR_SPECS) {
    const info = visited.get(spec.url);
    if (!info) {
      throw new Error(`Entrypoint was not fetched: ${spec.key} (${spec.url})`);
    }
    const webPath = `/vendor/${info.relPath}`;
    modules[spec.key] = {
      path: webPath,
      file: info.relPath,
      sha256: info.sha256,
      bytes: info.bytes,
      sourceUrl: spec.url,
    };
    importMap[spec.key] = webPath;
  }

  const totalBytes = [...visited.values()].reduce((sum, v) => sum + v.bytes, 0);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalFiles: visited.size,
    totalBytes,
    shikiThemes: [...SHIKI_THEMES],
    shikiLangs: [...SHIKI_LANGS],
    importMap,
    modules,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  const verification = verifyVendoredFiles();
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `[vendor_libs] Vendored ${verification.fileCount} files (${(verification.totalBytes / 1024 / 1024).toFixed(2)} MB) across ${verification.moduleCount} entrypoints in ${elapsedSec}s`
  );
  console.log(`[vendor_libs] Manifest written to ${MANIFEST_PATH}`);
  console.log(
    `[vendor_libs] Verification PASSED: 0 unresolved external https://esm.sh URLs, 0 missing static targets.`
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const verifyOnly = process.argv.includes("--verify-only");
  if (verifyOnly) {
    const res = verifyVendoredFiles();
    console.log(
      `[vendor_libs] Verification PASSED: ${res.fileCount} files, ${(res.totalBytes / 1024 / 1024).toFixed(2)} MB, ${res.moduleCount} manifest modules.`
    );
  } else {
    await runVendorBuild();
  }
}
