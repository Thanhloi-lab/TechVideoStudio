// Automated DOM Layout & Safe-Zone QC Gate for HyperFrames compositions.
// Pure Node.js ESM + browser-side self-contained evaluation expressions (no external deps).

import { buildRenderBridgeScript } from "./bridge.mjs";
import { evaluate } from "./cdp.mjs";

export const DEFAULT_QC_CHECKPOINTS = Object.freeze([0.1, 0.5, 0.9]);

export const VIEWPORT_WIDTH = 1920;
export const VIEWPORT_HEIGHT = 1080;
export const VIEWPORT_TOLERANCE_PX = 4;
export const STAGE_TOLERANCE_PX = 14;
export const COLLISION_TOLERANCE_PX = 4;
export const SUBTITLE_SAFE_MARGINS = Object.freeze({ left: 24, right: 1896, bottom: 1072 });
export const TEXT_CLIP_TOLERANCE_PX = 4;

/**
 * Build a self-contained browser JS IIFE that evaluates all 6 DOM layout & safe-zone QC checks
 * at the current seeked timestamp for a scene.
 *
 * Returns JSON:
 *   { ok, scene_id, scene_index, visual_type, checkpoint, timestamp, findings: [...] }
 */
export function buildLayoutQcExpression({ sceneId, sceneIndex, visualType, checkpoint, timestamp }) {
  const argsJson = JSON.stringify({
    sceneId: String(sceneId ?? `scene_${sceneIndex ?? 0}`),
    sceneIndex: Number(sceneIndex) || 0,
    visualType: String(visualType ?? "unknown"),
    checkpoint: Number(checkpoint) || 0,
    timestamp: Number(timestamp) || 0,
    VIEWPORT_WIDTH,
    VIEWPORT_HEIGHT,
    VIEWPORT_TOLERANCE_PX,
    STAGE_TOLERANCE_PX,
    COLLISION_TOLERANCE_PX,
    SUBTITLE_SAFE_MARGINS,
    TEXT_CLIP_TOLERANCE_PX,
  });

  return `(() => {
  const cfg = ${argsJson};
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const toRect = (r) => ({
    left: r2(r.left),
    top: r2(r.top),
    right: r2(r.right),
    bottom: r2(r.bottom),
    width: r2(Math.max(0, r.right - r.left)),
    height: r2(Math.max(0, r.bottom - r.top)),
  });

  const root = document.querySelector("[data-composition-id]");
  if (!root) {
    return {
      ok: true,
      scene_id: cfg.sceneId,
      scene_index: cfg.sceneIndex,
      visual_type: cfg.visualType,
      checkpoint: cfg.checkpoint,
      timestamp: cfg.timestamp,
      findings: [],
    };
  }

  const EXCLUDED_SELECTOR = [
    ".tvs-bg",
    ".tvs-bg-grid",
    ".tvs-bg-light",
    "#tvs-ambient",
    "#tvs-fx",
    ".tvs-bokeh",
    ".tvs-sparkle",
    ".tvs-sparkle-flash",
    ".tvs-progress",
  ].join(", ");

  const DECORATIVE_RING_RE = /\\b(tf__halo|tf__ring|ex__halo|ex__ofx-halo|km__halo|km__shock|cset-vf|cset-bk|cset-field__glow|cset-btn__glow|ccli-glow)\\b/;
  const SVG_ALLOWED_TAGS = new Set(["text", "tspan"]);
  const INLINE_TAGS = new Set(["SPAN", "B", "STRONG", "I", "EM", "CODE", "SMALL", "MARK", "A", "BR"]);

  const styleCache = new WeakMap();
  const csOf = (el) => {
    let cs = styleCache.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      styleCache.set(el, cs);
    }
    return cs;
  };

  const isExcludedNode = (el) => {
    if (!el || el.nodeType !== 1) return true;
    if (el.closest(EXCLUDED_SELECTOR)) return true;
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      const tag = String(el.tagName || "").toLowerCase();
      if (!SVG_ALLOWED_TAGS.has(tag)) return true;
    }
    return false;
  };

  const isDecorativeOverlay = (el) => {
    const cls = typeof el.className === "string" ? el.className : (el.className?.baseVal || "");
    if (DECORATIVE_RING_RE.test(cls)) return true;
    if (el.closest(".cset-vf, .cset-bk")) return true;
    return false;
  };

  const isElementVisible = (el, stopAt) => {
    let curr = el;
    while (curr && curr.nodeType === 1) {
      const cs = csOf(curr);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const op = parseFloat(cs.opacity);
      if (Number.isFinite(op) && op <= 0.05) return false;
      if (curr === stopAt || curr === root) break;
      curr = curr.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r && r.width >= 1 && r.height >= 1;
  };

  const hasVisibleColor = (val) => {
    if (!val || val === "none" || val === "transparent") return false;
    const m = String(val).match(/rgba?\\([^)]+\\)/g);
    if (!m) return true;
    for (const part of m) {
      const nums = part.match(/[0-9.]+/g);
      if (!nums) continue;
      if (nums.length < 4 || parseFloat(nums[3]) > 0.02) return true;
    }
    return false;
  };

  const hasDirectText = (el) => {
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) return true;
    }
    return false;
  };

  const hasVisualPaint = (el) => {
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO") return true;
    if (el.namespaceURI === "http://www.w3.org/2000/svg" && SVG_ALLOWED_TAGS.has(tag.toLowerCase())) {
      return Boolean((el.textContent || "").trim());
    }
    if (el.classList.contains("arch__node") || el.classList.contains("arch__zone") || el.classList.contains("arch-node")) {
      return true;
    }
    if (hasDirectText(el)) return true;
    const cs = csOf(el);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
    if (hasVisibleColor(cs.backgroundColor)) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    const bw =
      (parseFloat(cs.borderTopWidth) || 0) +
      (parseFloat(cs.borderRightWidth) || 0) +
      (parseFloat(cs.borderBottomWidth) || 0) +
      (parseFloat(cs.borderLeftWidth) || 0);
    if (bw > 0) {
      const anyStyle =
        cs.borderTopStyle !== "none" ||
        cs.borderRightStyle !== "none" ||
        cs.borderBottomStyle !== "none" ||
        cs.borderLeftStyle !== "none";
      if (
        anyStyle &&
        (hasVisibleColor(cs.borderTopColor) ||
          hasVisibleColor(cs.borderRightColor) ||
          hasVisibleColor(cs.borderBottomColor) ||
          hasVisibleColor(cs.borderLeftColor))
      ) {
        return true;
      }
    }
    return false;
  };

  const getEffectiveRect = (el, stopAt) => {
    const raw = el.getBoundingClientRect();
    let left = raw.left;
    let top = raw.top;
    let right = raw.right;
    let bottom = raw.bottom;
    let clippedBy = null;
    let curr = el.parentElement;
    while (curr && curr !== stopAt && curr !== document.documentElement) {
      const cs = csOf(curr);
      const ox = cs.overflowX || cs.overflow;
      const oy = cs.overflowY || cs.overflow;
      if (ox === "hidden" || ox === "clip" || oy === "hidden" || oy === "clip") {
        const ar = curr.getBoundingClientRect();
        if (ox === "hidden" || ox === "clip") {
          left = Math.max(left, ar.left);
          right = Math.min(right, ar.right);
        }
        if (oy === "hidden" || oy === "clip") {
          top = Math.max(top, ar.top);
          bottom = Math.min(bottom, ar.bottom);
        }
        clippedBy = curr;
      }
      if (right - left < 1 || bottom - top < 1) {
        return { left, top, right, bottom, width: 0, height: 0, raw, clippedBy };
      }
      curr = curr.parentElement;
    }
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
      raw,
      clippedBy,
    };
  };

  const buildSelector = (el) => {
    if (!el || el.nodeType !== 1) return "unknown";
    const parts = [];
    let curr = el;
    let depth = 0;
    while (curr && curr.nodeType === 1 && curr !== root && depth < 5) {
      let seg = String(curr.tagName || "div").toLowerCase();
      if (curr.id) {
        parts.unshift("#" + curr.id);
        break;
      }
      const clsStr = typeof curr.className === "string" ? curr.className : (curr.className?.baseVal || "");
      const classes = clsStr.trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (classes.length) seg += "." + classes.join(".");
      const nodeAttr = curr.getAttribute("data-node");
      if (nodeAttr) seg += '[data-node="' + nodeAttr + '"]';
      else if (curr.parentElement) {
        let same = 0;
        let idx = 0;
        const sibs = curr.parentElement.children;
        for (let i = 0; i < sibs.length; i++) {
          if (sibs[i].tagName === curr.tagName) {
            same++;
            if (sibs[i] === curr) idx = same;
          }
        }
        if (same > 1 && idx > 0) seg += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(seg);
      curr = curr.parentElement;
      depth++;
    }
    return parts.join(" > ") || String(el.tagName || "div").toLowerCase();
  };

  const findings = [];
  const seenKeys = new Set();
  const pushFinding = (code, severity, el, message, rect) => {
    const selector = buildSelector(el);
    const dedupKey = cfg.sceneId + "|" + cfg.checkpoint + "|" + code + "|" + selector;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);
    findings.push({
      scene_id: cfg.sceneId,
      scene_index: cfg.sceneIndex,
      visual_type: cfg.visualType,
      checkpoint: cfg.checkpoint,
      timestamp: cfg.timestamp,
      code,
      severity,
      selector,
      message,
      rect: toRect(rect),
    });
  };

  const clip = document.querySelector("#scene-" + cfg.sceneIndex);
  if (!clip || !isElementVisible(clip, root)) {
    return {
      ok: true,
      scene_id: cfg.sceneId,
      scene_index: cfg.sceneIndex,
      visual_type: cfg.visualType,
      checkpoint: cfg.checkpoint,
      timestamp: cfg.timestamp,
      findings: [],
    };
  }
  const sceneInner = clip.querySelector(".tvs-scene-inner");
  if (sceneInner && !isElementVisible(sceneInner, clip)) {
    return {
      ok: true,
      scene_id: cfg.sceneId,
      scene_index: cfg.sceneIndex,
      visual_type: cfg.visualType,
      checkpoint: cfg.checkpoint,
      timestamp: cfg.timestamp,
      findings: [],
    };
  }

  const topbar = clip.querySelector(".tvs-topbar");
  const topbarVisible = Boolean(topbar && isElementVisible(topbar, clip));
  const topbarRect = topbarVisible ? topbar.getBoundingClientRect() : null;

  const stage = clip.querySelector(".tvs-stage");
  const stageVisible = Boolean(stage && isElementVisible(stage, clip));
  const stageRect = stageVisible ? stage.getBoundingClientRect() : null;

  const visibleSubtitles = [];
  for (const subEl of root.querySelectorAll(".tvs-subtitles .tvs-subtitle__text")) {
    if (!isElementVisible(subEl, root)) continue;
    const rawSr = subEl.getBoundingClientRect();
    if (rawSr.width < 1 || rawSr.height < 1) continue;
    let sr = rawSr;
    if (subEl.scrollWidth > subEl.clientWidth + cfg.TEXT_CLIP_TOLERANCE_PX || subEl.scrollHeight > subEl.clientHeight + cfg.TEXT_CLIP_TOLERANCE_PX) {
      try {
        const rng = document.createRange();
        rng.selectNodeContents(subEl);
        const rr = rng.getBoundingClientRect();
        if (rr && rr.width >= 1 && rr.height >= 1) {
          const left = Math.min(rawSr.left, rr.left);
          const top = Math.min(rawSr.top, rr.top);
          const right = Math.max(rawSr.right, rr.right);
          const bottom = Math.max(rawSr.bottom, rr.bottom);
          sr = { left, top, right, bottom, width: right - left, height: bottom - top };
        }
      } catch {
        // ignore Range errors on detached nodes
      }
    }
    visibleSubtitles.push({ el: subEl, rect: sr });
  }

  const vpMinX = -cfg.VIEWPORT_TOLERANCE_PX;
  const vpMaxX = cfg.VIEWPORT_WIDTH + cfg.VIEWPORT_TOLERANCE_PX;
  const vpMinY = -cfg.VIEWPORT_TOLERANCE_PX;
  const vpMaxY = cfg.VIEWPORT_HEIGHT + cfg.VIEWPORT_TOLERANCE_PX;

  const checkViewport = (el, eff) => {
    if (eff.left < vpMinX || eff.right > vpMaxX || eff.top < vpMinY || eff.bottom > vpMaxY) {
      pushFinding(
        "viewport_overflow",
        "error",
        el,
        "Element extends outside 1920x1080 viewport bounds (" +
          r2(eff.left) + "," + r2(eff.top) + ".." + r2(eff.right) + "," + r2(eff.bottom) + ")",
        eff
      );
    }
  };

  const isTextClippedCandidate = (el, cs) => {
    const ox = cs.overflowX || cs.overflow;
    const oy = cs.overflowY || cs.overflow;
    if (!["hidden", "clip"].includes(ox) && !["hidden", "clip"].includes(oy)) return false;
    if (cs.display === "inline") return false;
    if (el.clientWidth < 1 || el.clientHeight < 1) return false;
    if (
      (el.classList.contains("ccli-cmd") || el.classList.contains("cset-typed")) &&
      cs.whiteSpace === "pre" &&
      String(el.style.width || "").endsWith("ch")
    ) {
      return false;
    }
    if (hasDirectText(el)) return true;
    if (!el.textContent || !el.textContent.trim()) return false;
    const children = Array.from(el.children);
    if (children.length === 0) return true;
    return children.every((c) => INLINE_TAGS.has(c.tagName) && csOf(c).position !== "absolute");
  };

  // Detect active camera zoom inside architecture scenes (pan/zoom inside .arch__viewport is intentional)
  const isInZoomedArchCamera = (el) => {
    const cam = el.closest(".arch__camera");
    if (!cam || !stage || !stage.contains(cam)) return null;
    const vp = cam.closest(".arch__viewport");
    if (!vp || !stage.contains(vp)) return null;
    const tr = csOf(cam).transform;
    if (!tr || tr === "none") return null;
    const m = tr.match(/^matrix\\(([^)]+)\\)$/);
    if (!m) return null;
    const parts = m[1].split(",").map((v) => parseFloat(v.trim()));
    if (parts.length !== 6) return null;
    const sx = Math.hypot(parts[0], parts[1]);
    const sy = Math.hypot(parts[2], parts[3]);
    if (sx > 1.015 || sy > 1.015 || Math.abs(parts[4]) > 4 || Math.abs(parts[5]) > 4) {
      return vp.getBoundingClientRect();
    }
    return null;
  };

  // 1) Topbar checks (viewport_overflow + topbar_title_truncated)
  if (topbarVisible) {
    const topNodes = [topbar, ...topbar.querySelectorAll("*")];
    for (const el of topNodes) {
      if (isExcludedNode(el) || !isElementVisible(el, clip)) continue;
      const eff = getEffectiveRect(el, clip);
      if (eff.width < 1 || eff.height < 1) continue;
      if (hasVisualPaint(el)) checkViewport(el, eff);
      if (el.classList.contains("tvs-topbar__title")) {
        const cs = csOf(el);
        if (isTextClippedCandidate(el, cs)) {
          if (
            el.scrollHeight > el.clientHeight + cfg.TEXT_CLIP_TOLERANCE_PX ||
            el.scrollWidth > el.clientWidth + cfg.TEXT_CLIP_TOLERANCE_PX
          ) {
            pushFinding(
              "topbar_title_truncated",
              "warning",
              el,
              "Topbar title truncated (scroll=" + el.scrollWidth + "x" + el.scrollHeight +
                ", client=" + el.clientWidth + "x" + el.clientHeight + ")",
              eff
            );
          }
        }
      }
    }
  }

  // 2) Subtitle checks (viewport_overflow + subtitle_overflow)
  for (const sub of visibleSubtitles) {
    checkViewport(sub.el, sub.rect);
    const sr = sub.rect;
    const reasons = [];
    if (sr.left < cfg.SUBTITLE_SAFE_MARGINS.left) reasons.push("left=" + r2(sr.left) + "<" + cfg.SUBTITLE_SAFE_MARGINS.left);
    if (sr.right > cfg.SUBTITLE_SAFE_MARGINS.right) reasons.push("right=" + r2(sr.right) + ">" + cfg.SUBTITLE_SAFE_MARGINS.right);
    if (sr.bottom > cfg.SUBTITLE_SAFE_MARGINS.bottom) reasons.push("bottom=" + r2(sr.bottom) + ">" + cfg.SUBTITLE_SAFE_MARGINS.bottom);
    if (topbarRect) {
      const ox = Math.min(sr.right, topbarRect.right) - Math.max(sr.left, topbarRect.left);
      const oy = Math.min(sr.bottom, topbarRect.bottom) - Math.max(sr.top, topbarRect.top);
      if (ox > 0 && oy > 0) reasons.push("intersects topbar");
    }
    if (reasons.length) {
      pushFinding(
        "subtitle_overflow",
        "error",
        sub.el,
        "Subtitle violates safe-zone (" + reasons.join(", ") + ")",
        sr
      );
    }
  }

  // 3) Stage checks (viewport_overflow, stage_overflow, topbar_collision, subtitle_collision, clipped_text)
  if (stageVisible && stageRect) {
    const tol = cfg.STAGE_TOLERANCE_PX;
    const colTol = cfg.COLLISION_TOLERANCE_PX;
    for (const el of stage.querySelectorAll("*")) {
      if (isExcludedNode(el) || isDecorativeOverlay(el)) continue;
      if (!isElementVisible(el, clip)) continue;
      const eff = getEffectiveRect(el, stage);
      if (eff.width < 1 || eff.height < 1) continue;
      const cs = csOf(el);

      if (isTextClippedCandidate(el, cs)) {
        if (
          el.scrollHeight > el.clientHeight + cfg.TEXT_CLIP_TOLERANCE_PX ||
          el.scrollWidth > el.clientWidth + cfg.TEXT_CLIP_TOLERANCE_PX
        ) {
          pushFinding(
            "clipped_text",
            "error",
            el,
            "Text clipped inside overflow container (scroll=" + el.scrollWidth + "x" + el.scrollHeight +
              ", client=" + el.clientWidth + "x" + el.clientHeight + ")",
            eff
          );
        }
      }

      if (!hasVisualPaint(el)) continue;

      const camVpRect = isInZoomedArchCamera(el);
      const vpCheckRect = camVpRect
        ? {
            ...eff,
            left: Math.max(eff.left, 0),
            right: Math.min(eff.right, cfg.VIEWPORT_WIDTH),
          }
        : eff;

      // 3a) viewport_overflow
      checkViewport(el, vpCheckRect);

      // 3b) stage_overflow
      if (camVpRect) {
        // Zoomed architecture camera pans/zooms inside .arch__viewport; ensure nodes stay inside
        // the viewport horizontally and above subtitle band vertically.
        const maxBottom = Math.min(camVpRect.bottom, stageRect.bottom + tol);
        if (
          eff.left < camVpRect.left - tol ||
          eff.right > camVpRect.right + tol ||
          eff.top < camVpRect.top - tol ||
          eff.bottom > maxBottom
        ) {
          pushFinding(
            "stage_overflow",
            "error",
            el,
            "Zoomed architecture element exceeds camera viewport bounds",
            eff
          );
        }
      } else {
        // .arch__banner intentionally sits in the topbar-to-stage gutter (top: -16px -> frame y=112)
        const topLimit = el.classList.contains("arch__banner") ? stageRect.top - 22 : stageRect.top - tol;
        if (
          eff.left < stageRect.left - tol ||
          eff.right > stageRect.right + tol ||
          eff.top < topLimit ||
          eff.bottom > stageRect.bottom + tol
        ) {
          const dLeft = r2(stageRect.left - eff.left);
          const dRight = r2(eff.right - stageRect.right);
          const dTop = r2(stageRect.top - eff.top);
          const dBottom = r2(eff.bottom - stageRect.bottom);
          pushFinding(
            "stage_overflow",
            "error",
            el,
            "Element overflows stage by >" + tol + "px (L=" + dLeft + ", T=" + dTop + ", R=" + dRight + ", B=" + dBottom + ")",
            eff
          );
        }
      }

      // 3c) topbar_collision
      if (topbarRect) {
        const ox = Math.min(eff.right, topbarRect.right) - Math.max(eff.left, topbarRect.left);
        const oy = Math.min(eff.bottom, topbarRect.bottom) - Math.max(eff.top, topbarRect.top);
        if (ox > colTol && oy > colTol) {
          pushFinding(
            "topbar_collision",
            "error",
            el,
            "Stage element collides with topbar (overlap " + r2(ox) + "x" + r2(oy) + "px)",
            eff
          );
        }
      }

      // 3d) subtitle_collision
      for (const sub of visibleSubtitles) {
        const ox = Math.min(eff.right, sub.rect.right) - Math.max(eff.left, sub.rect.left);
        const oy = Math.min(eff.bottom, sub.rect.bottom) - Math.max(eff.top, sub.rect.top);
        if (ox > colTol && oy > colTol) {
          pushFinding(
            "subtitle_collision",
            "error",
            el,
            "Stage element collides with subtitle text (overlap " + r2(ox) + "x" + r2(oy) + "px)",
            eff
          );
        }
      }
    }
  }

  return {
    ok: findings.every((f) => f.severity !== "error"),
    scene_id: cfg.sceneId,
    scene_index: cfg.sceneIndex,
    visual_type: cfg.visualType,
    checkpoint: cfg.checkpoint,
    timestamp: cfg.timestamp,
    findings,
  };
})()`;
}

function normalizeCheckpoints(checkpoints) {
  if (!Array.isArray(checkpoints) || !checkpoints.length) return [...DEFAULT_QC_CHECKPOINTS];
  const valid = checkpoints.map(Number).filter((n) => Number.isFinite(n));
  return valid.length ? valid : [...DEFAULT_QC_CHECKPOINTS];
}

function defaultQcSeekExpression(t) {
  return `(async () => {
    if (!window.__tvsTimelineBound && typeof window.__hfForceTimelineRebind === "function") {
      window.__hfForceTimelineRebind();
      window.__tvsTimelineBound = true;
    }
    window.__hf.seek(${Number(t)});
    if (typeof window.__hfWaitForSeekCompletion === "function") await window.__hfWaitForSeekCompletion();
    return true;
  })()`;
}

/**
 * Evaluate DOM layout & safe-zone QC across every scene in `manifest.scenes` at each checkpoint.
 */
export async function runCompositionLayoutQc({
  cdp,
  sessionId,
  manifest,
  checkpoints = DEFAULT_QC_CHECKPOINTS,
  evaluateFn,
  seekExpressionFn,
} = {}) {
  const evalFn = evaluateFn || ((expr) => evaluate(cdp, sessionId, expr));
  const seekFn = seekExpressionFn || defaultQcSeekExpression;
  const cps = normalizeCheckpoints(checkpoints);
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];

  const findings = [];
  const seenKeys = new Set();
  const by_scene = {};
  let frames_checked = 0;
  let error_count = 0;
  let warning_count = 0;

  for (const sc of scenes) {
    const sceneId = String(sc?.id ?? `scene_${sc?.index ?? 0}`);
    const sceneIndex = Number(sc?.index) || 0;
    const visualType = String(sc?.visual_type ?? "architecture");
    const sceneEntry = {
      scene_id: sceneId,
      scene_index: sceneIndex,
      visual_type: visualType,
      error_count: 0,
      warning_count: 0,
      findings: [],
    };
    by_scene[sceneId] = sceneEntry;

    const start = Number(sc?.start) || 0;
    const duration = Math.max(0.1, Number(sc?.duration) || 0.1);

    for (const cp of cps) {
      const clampedCp = Math.min(0.999, Math.max(0, cp));
      const timestamp = Math.round((start + clampedCp * duration) * 1000) / 1000;
      await evalFn(seekFn(timestamp));
      const expr = buildLayoutQcExpression({
        sceneId,
        sceneIndex,
        visualType,
        checkpoint: cp,
        timestamp,
      });
      const res = await evalFn(expr);
      frames_checked++;

      const rawFindings = Array.isArray(res?.findings) ? res.findings : [];
      for (const f of rawFindings) {
        const key = `${f.scene_id}|${f.checkpoint}|${f.code}|${f.selector}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        findings.push(f);
        sceneEntry.findings.push(f);
        if (f.severity === "error") {
          error_count++;
          sceneEntry.error_count++;
        } else {
          warning_count++;
          sceneEntry.warning_count++;
        }
      }
    }
  }

  return {
    checkpoints: cps,
    scenes_checked: scenes.length,
    frames_checked,
    error_count,
    warning_count,
    findings,
    by_scene,
  };
}

/** Format a concise human-readable summary of a runCompositionLayoutQc report. */
export function formatLayoutQcSummary(report) {
  if (!report) return "no layout QC report";
  const status = report.error_count > 0 ? "FAIL" : "PASS";
  const cps = Array.isArray(report.checkpoints) ? report.checkpoints.join(",") : "";
  return `${status} (scenes=${report.scenes_checked}, frames=${report.frames_checked}, checkpoints=[${cps}], errors=${report.error_count}, warnings=${report.warning_count})`;
}

export { buildRenderBridgeScript };
