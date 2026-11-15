// Pure-math Motion Kernel & Canvas FX utilities shared between Studio DOM & Canvas 2D Exporter.
// Zero external dependencies; safe for both Browser ESM and Node.js.

export const MOTION_TOKENS = {
  fps: 30,
  timing: {
    sceneExitMs: 200,          // 6 frame @30fps (opacity 1->0, blur 0->20px, scale 1->0.96)
    sceneBreatherMs: 140,      // ~4 frame nền tối Layer 0 thở giữa 2 cảnh
    elementRevealMs: 267,      // 8 frame @30fps (blur 20px->0 + sparkle confetti)
    listStaggerMs: 50,         // Stagger từ trên xuống cho list card / row
    stampSlamMs: 133,          // 4 frame @30fps spring scale 1.45 -> 0.96 -> 1.0
    cameraFocusMs: 600,        // Pan/zoom tới cụm node hoặc field console (16:9)
    sfxLeadMs: -33,            // SFX đi trước 0-1 frame (-33ms..-67ms) trước chuyển cảnh
    cursorBlinkHalfMs: 450,    // Con trỏ khối terminal nhấp nháy
  },
  easings: {
    revealCss: "cubic-bezier(0.16, 1, 0.3, 1)",   // Quart-Out / GSAP "power3.out"
    exitCss: "cubic-bezier(0.4, 0, 1, 1)",         // Fast accelerate out
    cameraGsap: "power3.inOut",
    stampSpring: { stiffness: 420, damping: 24, mass: 0.9 },
  },
  paletteV2: {
    bgTop: "#020A14",
    bgMid: "#060811",
    bgBottom: "#02060E",
    gridLine: "rgba(148, 163, 184, 0.045)",
    accentPrimary: "#2A62FF",
    accentCyan: "#10C0F0",
    accentGlow: "#90E0F0",
    gold: "#F0C040",
    danger: "#EF4444",
    dangerText: "#F08070",
    warning: "#F59E0B",
    success: "#10B981",
    subtitleText: "#FFFFFF",
    subtitleAccent: "#10C0F0",
  },
  layout: {
    progressBarHeightPx: 6,    // Top progress bar y=0 (1080p)
    subtitleChunkWords: [3, 5],
    safeBottomPct16x9: 6,      // ~65px ở 1920x1080 (không bọc khung hộp)
    safeBottomPct9x16: 21,     // Vùng 75%-80% chiều cao, chừa sạch 20% đáy cho Reels/TikTok
  },
};

export function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function easeQuartOut(t) {
  const u = clamp01(t);
  const inv = 1 - u;
  return 1 - inv * inv * inv * inv;
}

export function easeCubicInOut(t) {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * Analytical damped harmonic oscillator spring.
 * Maps normalized progress t in [0, 1] (or opts.timeSec) using stampSpring defaults.
 * Supports optional { stiffness, damping, mass, durationSec, velocity, from, to, timeSec }.
 */
export function dampedSpring(t, opts = {}) {
  const springDefaults = MOTION_TOKENS.easings.stampSpring;
  const stiffness = opts.stiffness ?? springDefaults.stiffness;
  const damping = opts.damping ?? springDefaults.damping;
  const mass = Math.max(0.01, opts.mass ?? springDefaults.mass);
  const durationSec = Math.max(0.05, opts.durationSec ?? 0.34);
  const velocity = opts.velocity ?? 0;
  const hasRange = opts.from !== undefined || opts.to !== undefined;
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;

  const u = clamp01(t);
  if (opts.timeSec === undefined) {
    if (u <= 0) return hasRange ? from : 0;
    if (u >= 1) return hasRange ? to : 1;
  }

  const tau = opts.timeSec !== undefined ? Math.max(0, opts.timeSec) : u * durationSec;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  let factor;
  if (zeta < 0.9999) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * w0 * tau);
    factor = 1 - env * (Math.cos(wd * tau) + ((zeta * w0 - velocity) / wd) * Math.sin(wd * tau));
  } else if (zeta <= 1.0001) {
    const env = Math.exp(-w0 * tau);
    factor = 1 - env * (1 + (w0 - velocity) * tau);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s);
    const r2 = -w0 * (zeta + s);
    const c2 = (velocity - r1) / (r2 - r1);
    const c1 = 1 - c2;
    factor = 1 - (c1 * Math.exp(r1 * tau) + c2 * Math.exp(r2 * tau));
  }

  return hasRange ? from + (to - from) * factor : factor;
}

/**
 * Compute a smooth Cubic Bezier edge between (x1, y1) and (x2, y2).
 * When curveOffset is omitted, automatically bows perpendicular to the segment.
 */
export function computeBezierEdge(x1, y1, x2, y2, curveOffset) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  // Perpendicular unit vector
  const nx = -ty;
  const ny = tx;

  let offset = curveOffset;
  if (offset === undefined || offset === null || !Number.isFinite(offset)) {
    const autoMag = Math.min(120, len * 0.16);
    // Keep horizontal edges arcing gently upward so labels below stay clear
    offset = Math.abs(dy) < len * 0.15 ? (ny <= 0 ? autoMag : -autoMag) : autoMag;
  }

  const cx1 = x1 + dx * 0.33 + nx * offset;
  const cy1 = y1 + dy * 0.33 + ny * offset;
  const cx2 = x1 + dx * 0.67 + nx * offset;
  const cy2 = y1 + dy * 0.67 + ny * offset;

  const fmt = (n) => Number(n.toFixed(2));
  const pathD = `M ${fmt(x1)} ${fmt(y1)} C ${fmt(cx1)} ${fmt(cy1)}, ${fmt(cx2)} ${fmt(cy2)}, ${fmt(x2)} ${fmt(y2)}`;

  const pointAt = (t) => {
    const u = clamp01(t);
    const mt = 1 - u;
    const mt2 = mt * mt;
    const u2 = u * u;
    return {
      x: mt2 * mt * x1 + 3 * mt2 * u * cx1 + 3 * mt * u2 * cx2 + u2 * u * x2,
      y: mt2 * mt * y1 + 3 * mt2 * u * cy1 + 3 * mt * u2 * cy2 + u2 * u * y2,
    };
  };

  const tangentAt = (t) => {
    const u = clamp01(t);
    const mt = 1 - u;
    const dxdt =
      3 * mt * mt * (cx1 - x1) +
      6 * mt * u * (cx2 - cx1) +
      3 * u * u * (x2 - cx2);
    const dydt =
      3 * mt * mt * (cy1 - y1) +
      6 * mt * u * (cy2 - cy1) +
      3 * u * u * (y2 - cy2);
    const mag = Math.hypot(dxdt, dydt) || 1;
    const angleRad = Math.atan2(dydt, dxdt);
    return {
      dx: dxdt,
      dy: dydt,
      nx: dxdt / mag,
      ny: dydt / mag,
      angleRad,
      angleDeg: (angleRad * 180) / Math.PI,
    };
  };

  return { pathD, cx1, cy1, cx2, cy2, pointAt, tangentAt };
}

export const DEFAULT_SUBTITLE_KEYWORDS = [
  "Explicit Deny",
  "Implicit Deny",
  "Trust Policy",
  "Permissions Policy",
  "Least Privilege",
  "Access Key",
  "Root Account",
  "AssumeRole",
  "SessionToken",
  "DVA-C02",
  "Lambda",
  "Policy",
  "Group",
  "boto3",
  "Role",
  "User",
  "IAM",
  "STS",
  "ARN",
  "EC2",
  "S3",
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse subtitle text into [{ text, accent }] highlighting **...** markers
 * and key AWS / technical terms.
 */
export function parseSubtitleSegments(text, extraKeywords = []) {
  const input = String(text ?? "");
  if (!input) return [];

  const merged = [...DEFAULT_SUBTITLE_KEYWORDS, ...(Array.isArray(extraKeywords) ? extraKeywords : [])]
    .map((k) => String(k || "").trim())
    .filter(Boolean);

  // Deduplicate case-insensitively and sort longest-first so multi-word phrases win
  const seen = new Set();
  const keywords = [];
  for (const kw of merged.sort((a, b) => b.length - a.length)) {
    const low = kw.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      keywords.push(kw);
    }
  }

  const kwRegex = keywords.length
    ? new RegExp(`(?<![A-Za-z0-9_])(${keywords.map(escapeRegExp).join("|")})(?![A-Za-z0-9_])`, "gi")
    : null;

  const rawSegments = [];
  const boldRe = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match;

  const pushPlainWithKeywords = (chunk) => {
    if (!chunk) return;
    if (!kwRegex) {
      rawSegments.push({ text: chunk, accent: false });
      return;
    }
    kwRegex.lastIndex = 0;
    let pos = 0;
    let m;
    while ((m = kwRegex.exec(chunk)) !== null) {
      if (m.index > pos) {
        rawSegments.push({ text: chunk.slice(pos, m.index), accent: false });
      }
      rawSegments.push({ text: m[0], accent: true });
      pos = m.index + m[0].length;
    }
    if (pos < chunk.length) {
      rawSegments.push({ text: chunk.slice(pos), accent: false });
    }
  };

  while ((match = boldRe.exec(input)) !== null) {
    if (match.index > lastIdx) {
      pushPlainWithKeywords(input.slice(lastIdx, match.index));
    }
    if (match[1]) {
      rawSegments.push({ text: match[1], accent: true });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < input.length) {
    pushPlainWithKeywords(input.slice(lastIdx));
  }

  // Merge adjacent segments with identical accent flags
  const mergedOut = [];
  for (const seg of rawSegments) {
    if (!seg.text) continue;
    const prev = mergedOut[mergedOut.length - 1];
    if (prev && prev.accent === seg.accent) {
      prev.text += seg.text;
    } else {
      mergedOut.push({ text: seg.text, accent: seg.accent });
    }
  }
  return mergedOut;
}

/**
 * Compute scene-level envelope implementing:
 * - 267ms Blur-to-Sharp reveal (opacity 0->1, blur 20->0px, scale 0.94->1.0)
 * - 200ms Exit Z-recede (opacity 1->0, blur 0->20px, scale 1.0->0.96)
 * - 140ms Dark Breather at tail of scene (opacity 0, inBreather: true)
 */
export function computeSceneEnvelope(sceneTime, durationSec) {
  const dur = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const t = Number.isFinite(sceneTime) ? Math.max(0, sceneTime) : 0;

  if (dur <= 0) {
    return { opacity: 1, scale: 1, blurPx: 0, inBreather: false, isEntering: false, isExiting: false };
  }

  let revealSec = MOTION_TOKENS.timing.elementRevealMs / 1000;   // 0.267
  let exitSec = MOTION_TOKENS.timing.sceneExitMs / 1000;         // 0.200
  let breatherSec = MOTION_TOKENS.timing.sceneBreatherMs / 1000; // 0.140

  const minTotal = revealSec + exitSec + breatherSec;
  if (dur < minTotal + 0.05) {
    const scaleFactor = dur / (minTotal + 0.05);
    revealSec *= scaleFactor;
    exitSec *= scaleFactor;
    breatherSec *= scaleFactor;
  }

  const breatherStart = Math.max(0, dur - breatherSec);
  const exitStart = Math.max(0, breatherStart - exitSec);

  if (t >= breatherStart) {
    return {
      opacity: 0,
      scale: 0.96,
      blurPx: 20,
      inBreather: true,
      isEntering: false,
      isExiting: false,
    };
  }

  if (t >= exitStart && exitSec > 0) {
    const raw = clamp01((t - exitStart) / exitSec);
    // Accelerate-out curve matching cubic-bezier(0.4, 0, 1, 1)
    const p = raw * raw;
    return {
      opacity: 1 - p,
      scale: 1 - 0.04 * p,
      blurPx: 20 * p,
      inBreather: false,
      isEntering: false,
      isExiting: true,
    };
  }

  if (t < revealSec && revealSec > 0) {
    const p = easeQuartOut(clamp01(t / revealSec));
    return {
      opacity: clamp01(p * 1.15),
      scale: 0.94 + 0.06 * p,
      blurPx: 20 * (1 - p),
      inBreather: false,
      isEntering: true,
      isExiting: false,
    };
  }

  return {
    opacity: 1,
    scale: 1,
    blurPx: 0,
    inBreather: false,
    isEntering: false,
    isExiting: false,
  };
}

function createRng(seed = 20260401) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

const BOKEH_COLORS = [
  MOTION_TOKENS.paletteV2.accentPrimary,
  MOTION_TOKENS.paletteV2.accentCyan,
  MOTION_TOKENS.paletteV2.accentGlow,
  MOTION_TOKENS.paletteV2.gold,
];

const SPARKLE_COLORS = [
  MOTION_TOKENS.paletteV2.accentCyan,
  MOTION_TOKENS.paletteV2.accentGlow,
  MOTION_TOKENS.paletteV2.gold,
  "#F472B6",
  MOTION_TOKENS.paletteV2.success,
  "#FFFFFF",
];

/**
 * Create deterministic ambient bokeh seeds for Layer 0.
 */
export function createBokehSeeds(count = 22) {
  const n = Math.max(0, Math.floor(count));
  const rand = createRng(133742);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    const angle = rand() * Math.PI * 2;
    const speed = 0.002 + rand() * 0.0045; // slow drift in normalized [0..1] units/sec
    seeds.push({
      x: rand(),
      y: rand(),
      r: 1.8 + rand() * 3.8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.0012,
      alpha: 0.06 + rand() * 0.16,
      phase: rand() * Math.PI * 2,
      pulseSpeed: 0.4 + rand() * 0.7,
      color: BOKEH_COLORS[i % BOKEH_COLORS.length],
    });
  }
  return seeds;
}

/**
 * Render Layer 0 subtle 60px blueprint grid + slow ambient bokeh particles.
 * Deterministic for any timeSec (supports scrubbing & offline rendering).
 */
export function renderAmbientLayer(ctx, W, H, timeSec = 0, seeds = [], opts = {}) {
  if (!ctx || W <= 0 || H <= 0) return;

  const drawBackground = opts.drawBackground !== false;
  const gridStep = opts.gridSize ?? Math.max(36, Math.round(60 * (W / 1920)));
  const t = Number.isFinite(timeSec) ? timeSec : 0;

  ctx.save();

  if (drawBackground) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, MOTION_TOKENS.paletteV2.bgTop);
    grad.addColorStop(0.55, MOTION_TOKENS.paletteV2.bgMid);
    grad.addColorStop(1, MOTION_TOKENS.paletteV2.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle radial Navy-Cyan atmospheric glow
    const rad1 = ctx.createRadialGradient(W * 0.22, H * 0.18, 0, W * 0.22, H * 0.18, Math.max(W, H) * 0.55);
    rad1.addColorStop(0, "rgba(42, 98, 255, 0.11)");
    rad1.addColorStop(1, "rgba(2, 10, 20, 0)");
    ctx.fillStyle = rad1;
    ctx.fillRect(0, 0, W, H);

    const rad2 = ctx.createRadialGradient(W * 0.82, H * 0.8, 0, W * 0.82, H * 0.8, Math.max(W, H) * 0.48);
    rad2.addColorStop(0, "rgba(16, 192, 240, 0.08)");
    rad2.addColorStop(1, "rgba(2, 6, 14, 0)");
    ctx.fillStyle = rad2;
    ctx.fillRect(0, 0, W, H);
  }

  // Subtle blueprint grid (60px @ 1080p)
  ctx.strokeStyle = MOTION_TOKENS.paletteV2.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += gridStep) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = 0; y <= H; y += gridStep) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();

  // Slow ambient bokeh particles
  const scaleFactor = Math.max(0.65, W / 1920);
  const activeSeeds = Array.isArray(seeds) ? seeds : [];
  for (let i = 0; i < activeSeeds.length; i++) {
    const s = activeSeeds[i];
    const wrap = (v) => ((v % 1) + 1) % 1;
    const px = wrap(s.x + s.vx * t) * W;
    const py = wrap(s.y + s.vy * t) * H;
    const radius = s.r * scaleFactor * 1.6;
    const twinkle = 0.65 + 0.35 * Math.sin(t * s.pulseSpeed + s.phase);

    ctx.globalAlpha = s.alpha * twinkle;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();

    // Soft outer halo on larger bokeh
    if (s.r > 3.2) {
      ctx.globalAlpha = s.alpha * twinkle * 0.28;
      ctx.beginPath();
      ctx.arc(px, py, radius * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Create a Layer 2 multi-color pixel confetti burst centered at (x, y).
 */
export function createSparkleParticles(x, y, count = 22) {
  const n = Math.max(1, Math.floor(count));
  const particles = [];
  for (let i = 0; i < n; i++) {
    const baseAngle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.35;
    const speed = 130 + Math.random() * 260;
    const maxLife = 0.22 + Math.random() * 0.16;
    particles.push({
      x,
      y,
      originX: x,
      originY: y,
      vx: Math.cos(baseAngle) * speed,
      vy: Math.sin(baseAngle) * speed,
      size: 3.5 + Math.random() * 5.5,
      color: SPARKLE_COLORS[i % SPARKLE_COLORS.length],
      alpha: 1,
      life: 0,
      maxLife,
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 14,
      isDiamond: i % 3 === 0,
    });
  }
  return particles;
}

/**
 * Advance sparkle particles by dt seconds (updates in place and returns active particles).
 */
export function stepSparkleParticles(particles, dt) {
  if (!Array.isArray(particles) || particles.length === 0) return [];
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const drag = Math.exp(-5.8 * step);
  const alive = [];

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.life += step;
    if (p.life >= p.maxLife) continue;
    p.vx *= drag;
    p.vy = p.vy * drag + 48 * step; // slight settle gravity
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.rotation += p.vRot * step;
    const progress = clamp01(p.life / p.maxLife);
    p.alpha = 1 - progress * progress;
    alive.push(p);
  }
  return alive;
}

/**
 * Render Layer 2 pixel confetti burst particles + initial cyan/white core flash.
 */
export function renderSparkleBurst(ctx, particles) {
  if (!ctx || !Array.isArray(particles) || particles.length === 0) return;

  ctx.save();

  // Core cyan/white glow flash during early burst (< 95ms)
  const sample = particles[0];
  if (sample && sample.life < 0.095) {
    const flashP = 1 - sample.life / 0.095;
    const cx = sample.originX ?? sample.x;
    const cy = sample.originY ?? sample.y;
    const rad = 10 + (1 - flashP) * 34;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.85 * flashP})`);
    g.addColorStop(0.45, `rgba(16, 192, 240, ${0.55 * flashP})`);
    g.addColorStop(1, "rgba(16, 192, 240, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.alpha <= 0.01) continue;
    ctx.save();
    ctx.globalAlpha = clamp01(p.alpha);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;

    const half = p.size * 0.5;
    if (p.isDiamond) {
      ctx.beginPath();
      ctx.moveTo(0, -half * 1.2);
      ctx.lineTo(half * 0.9, 0);
      ctx.lineTo(0, half * 1.2);
      ctx.lineTo(-half * 0.9, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(-half, -half * 0.72, p.size, p.size * 0.72);
    }
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// Shared Architecture Diagram Layout Engine (Studio SVG + Canvas 2D + Validator)
// ============================================================================

export const ZONE_ROLE_STYLES = {
  client: {
    fill: "rgba(56, 189, 248, 0.065)",
    fillNested: "rgba(56, 189, 248, 0.10)",
    stroke: "rgba(56, 189, 248, 0.44)",
    badgeBg: "rgba(10, 30, 56, 0.92)",
    badgeText: "#7DD3FC",
    subText: "#93C5FD",
    dashed: false,
  },
  network: {
    fill: "rgba(16, 192, 240, 0.055)",
    fillNested: "rgba(16, 192, 240, 0.09)",
    stroke: "rgba(16, 192, 240, 0.46)",
    badgeBg: "rgba(6, 26, 46, 0.92)",
    badgeText: "#67E8F9",
    subText: "#A5F3FC",
    dashed: true,
  },
  compute: {
    fill: "rgba(255, 153, 0, 0.06)",
    fillNested: "rgba(255, 153, 0, 0.095)",
    stroke: "rgba(255, 153, 0, 0.45)",
    badgeBg: "rgba(42, 24, 6, 0.92)",
    badgeText: "#FDBA74",
    subText: "#FCD34D",
    dashed: false,
  },
  security: {
    fill: "rgba(168, 85, 247, 0.065)",
    fillNested: "rgba(168, 85, 247, 0.10)",
    stroke: "rgba(168, 85, 247, 0.48)",
    badgeBg: "rgba(32, 16, 56, 0.92)",
    badgeText: "#D8B4FE",
    subText: "#C4B5FD",
    dashed: true,
  },
  data: {
    fill: "rgba(16, 185, 129, 0.06)",
    fillNested: "rgba(16, 185, 129, 0.095)",
    stroke: "rgba(16, 185, 129, 0.45)",
    badgeBg: "rgba(6, 36, 28, 0.92)",
    badgeText: "#6EE7B7",
    subText: "#A7F3D0",
    dashed: false,
  },
  danger: {
    fill: "rgba(239, 68, 68, 0.07)",
    fillNested: "rgba(239, 68, 68, 0.105)",
    stroke: "rgba(239, 68, 68, 0.50)",
    badgeBg: "rgba(48, 12, 18, 0.92)",
    badgeText: "#FCA5A5",
    subText: "#FECACA",
    dashed: true,
  },
};

const SIDE_DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

function fmtNum(n) {
  return Number(n.toFixed(2));
}

function rectOverlapArea(a, b, pad = 0) {
  const ox = Math.max(0, Math.min(a.right + pad, b.right) - Math.max(a.x - pad, b.x));
  const oy = Math.max(0, Math.min(a.bottom + pad, b.bottom) - Math.max(a.y - pad, b.y));
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function pointInRect(px, py, rect, pad = 0) {
  return (
    px >= rect.x - pad &&
    px <= rect.right + pad &&
    py >= rect.y - pad &&
    py <= rect.bottom + pad
  );
}

function orient2d(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax, ay, bx, by, px, py) {
  return (
    px >= Math.min(ax, bx) - 1e-6 &&
    px <= Math.max(ax, bx) + 1e-6 &&
    py >= Math.min(ay, by) - 1e-6 &&
    py <= Math.max(ay, by) + 1e-6
  );
}

function segmentsIntersect(p1, p2, p3, p4) {
  const o1 = orient2d(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const o2 = orient2d(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
  const o3 = orient2d(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
  const o4 = orient2d(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);

  if (((o1 > 1e-6 && o2 < -1e-6) || (o1 < -1e-6 && o2 > 1e-6)) &&
      ((o3 > 1e-6 && o4 < -1e-6) || (o3 < -1e-6 && o4 > 1e-6))) {
    return true;
  }
  if (Math.abs(o1) <= 1e-6 && onSegment(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)) return true;
  if (Math.abs(o2) <= 1e-6 && onSegment(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y)) return true;
  if (Math.abs(o3) <= 1e-6 && onSegment(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y)) return true;
  if (Math.abs(o4) <= 1e-6 && onSegment(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y)) return true;
  return false;
}

function segmentIntersectsRect(p1, p2, rect, pad = 0) {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  if (maxX < rect.x - pad || minX > rect.right + pad || maxY < rect.y - pad || minY > rect.bottom + pad) {
    return false;
  }
  if (pointInRect(p1.x, p1.y, rect, pad) || pointInRect(p2.x, p2.y, rect, pad)) {
    return true;
  }
  const tl = { x: rect.x - pad, y: rect.y - pad };
  const tr = { x: rect.right + pad, y: rect.y - pad };
  const br = { x: rect.right + pad, y: rect.bottom + pad };
  const bl = { x: rect.x - pad, y: rect.bottom + pad };
  return (
    segmentsIntersect(p1, p2, tl, tr) ||
    segmentsIntersect(p1, p2, tr, br) ||
    segmentsIntersect(p1, p2, br, bl) ||
    segmentsIntersect(p1, p2, bl, tl)
  );
}

function simplifyPolyline(pts) {
  if (!pts.length) return [];
  const deduped = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) {
      deduped.push(pts[i]);
    }
  }
  if (deduped.length <= 2) return deduped;
  const out = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const a = out[out.length - 1];
    const b = deduped[i];
    const c = deduped[i + 1];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const cross = Math.abs(v1x * v2y - v1y * v2x);
    const dot = v1x * v2x + v1y * v2y;
    if (cross <= 0.5 && dot >= 0) {
      continue; // Collinear point
    }
    out.push(b);
  }
  out.push(deduped[deduped.length - 1]);
  return out;
}

function quadPoint(x0, y0, cx, cy, x1, y1, u) {
  const mt = 1 - u;
  return {
    x: mt * mt * x0 + 2 * mt * u * cx + u * u * x1,
    y: mt * mt * y0 + 2 * mt * u * cy + u * u * y1,
  };
}

function quadTangent(x0, y0, cx, cy, x1, y1, u) {
  const dx = 2 * (1 - u) * (cx - x0) + 2 * u * (x1 - cx);
  const dy = 2 * (1 - u) * (cy - y0) + 2 * u * (y1 - cy);
  const mag = Math.hypot(dx, dy) || 1;
  const angleRad = Math.atan2(dy, dx);
  return {
    dx,
    dy,
    nx: dx / mag,
    ny: dy / mag,
    angleRad,
    angleDeg: (angleRad * 180) / Math.PI,
  };
}

function buildPolylineEdgeModel(rawWaypoints, cornerRadius) {
  const waypoints = simplifyPolyline(rawWaypoints);
  if (waypoints.length < 2) {
    const p = waypoints[0] || { x: 0, y: 0 };
    return {
      waypoints: [p, p],
      svgPathD: `M ${fmtNum(p.x)} ${fmtNum(p.y)}`,
      totalLen: 0,
      pointAt: () => ({ x: p.x, y: p.y }),
      tangentAt: () => ({ dx: 1, dy: 0, nx: 1, ny: 0, angleRad: 0, angleDeg: 0 }),
      drawCanvasPath: () => {},
    };
  }

  const primitives = [];
  let cursor = { x: waypoints[0].x, y: waypoints[0].y };

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];

    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const inLen = Math.hypot(inDx, inDy);

    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const outLen = Math.hypot(outDx, outDy);

    if (inLen < 0.5 || outLen < 0.5) continue;

    const r = Math.min(cornerRadius, inLen * 0.45, outLen * 0.45);
    if (r < 2) {
      const segLen = Math.hypot(curr.x - cursor.x, curr.y - cursor.y);
      if (segLen > 0.2) {
        primitives.push({ type: "line", x0: cursor.x, y0: cursor.y, x1: curr.x, y1: curr.y, len: segLen });
        cursor = { x: curr.x, y: curr.y };
      }
      continue;
    }

    const entryX = curr.x - (inDx / inLen) * r;
    const entryY = curr.y - (inDy / inLen) * r;
    const exitX = curr.x + (outDx / outLen) * r;
    const exitY = curr.y + (outDy / outLen) * r;

    const lineLen = Math.hypot(entryX - cursor.x, entryY - cursor.y);
    if (lineLen > 0.2) {
      primitives.push({ type: "line", x0: cursor.x, y0: cursor.y, x1: entryX, y1: entryY, len: lineLen });
    }

    let qLen = 0;
    let prevPt = { x: entryX, y: entryY };
    for (let s = 1; s <= 8; s++) {
      const pt = quadPoint(entryX, entryY, curr.x, curr.y, exitX, exitY, s / 8);
      qLen += Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
      prevPt = pt;
    }
    primitives.push({
      type: "quad",
      x0: entryX,
      y0: entryY,
      cx: curr.x,
      cy: curr.y,
      x1: exitX,
      y1: exitY,
      len: Math.max(0.5, qLen),
    });
    cursor = { x: exitX, y: exitY };
  }

  const endPt = waypoints[waypoints.length - 1];
  const tailLen = Math.hypot(endPt.x - cursor.x, endPt.y - cursor.y);
  if (tailLen > 0.2 || primitives.length === 0) {
    primitives.push({
      type: "line",
      x0: cursor.x,
      y0: cursor.y,
      x1: endPt.x,
      y1: endPt.y,
      len: Math.max(0.5, tailLen),
    });
  }

  let totalLen = 0;
  for (const pr of primitives) {
    pr.startDist = totalLen;
    totalLen += pr.len;
    pr.endDist = totalLen;
  }

  const parts = [`M ${fmtNum(waypoints[0].x)} ${fmtNum(waypoints[0].y)}`];
  for (const pr of primitives) {
    if (pr.type === "line") {
      parts.push(`L ${fmtNum(pr.x1)} ${fmtNum(pr.y1)}`);
    } else {
      parts.push(`Q ${fmtNum(pr.cx)} ${fmtNum(pr.cy)} ${fmtNum(pr.x1)} ${fmtNum(pr.y1)}`);
    }
  }
  const svgPathD = parts.join(" ");

  const locate = (t) => {
    const u = clamp01(t);
    if (totalLen <= 0.001) return { pr: primitives[0], localU: 0 };
    const target = u * totalLen;
    for (let i = 0; i < primitives.length; i++) {
      const pr = primitives[i];
      if (target <= pr.endDist || i === primitives.length - 1) {
        const localU = pr.len > 0.001 ? clamp01((target - pr.startDist) / pr.len) : 1;
        return { pr, localU };
      }
    }
    const last = primitives[primitives.length - 1];
    return { pr: last, localU: 1 };
  };

  const pointAt = (t) => {
    const { pr, localU } = locate(t);
    if (pr.type === "line") {
      return {
        x: pr.x0 + (pr.x1 - pr.x0) * localU,
        y: pr.y0 + (pr.y1 - pr.y0) * localU,
      };
    }
    return quadPoint(pr.x0, pr.y0, pr.cx, pr.cy, pr.x1, pr.y1, localU);
  };

  const tangentAt = (t) => {
    const { pr, localU } = locate(t);
    if (pr.type === "line") {
      const dx = pr.x1 - pr.x0;
      const dy = pr.y1 - pr.y0;
      const mag = Math.hypot(dx, dy) || 1;
      const angleRad = Math.atan2(dy, dx);
      return {
        dx,
        dy,
        nx: dx / mag,
        ny: dy / mag,
        angleRad,
        angleDeg: (angleRad * 180) / Math.PI,
      };
    }
    return quadTangent(pr.x0, pr.y0, pr.cx, pr.cy, pr.x1, pr.y1, localU);
  };

  const drawCanvasPath = (ctx, drawT = 1) => {
    const p = clamp01(drawT);
    if (p <= 0.001) return;
    ctx.beginPath();
    ctx.moveTo(waypoints[0].x, waypoints[0].y);
    if (p >= 0.999) {
      for (const pr of primitives) {
        if (pr.type === "line") {
          ctx.lineTo(pr.x1, pr.y1);
        } else {
          ctx.quadraticCurveTo(pr.cx, pr.cy, pr.x1, pr.y1);
        }
      }
      ctx.stroke();
      return;
    }

    const target = p * totalLen;
    for (const pr of primitives) {
      if (target >= pr.endDist - 1e-4) {
        if (pr.type === "line") {
          ctx.lineTo(pr.x1, pr.y1);
        } else {
          ctx.quadraticCurveTo(pr.cx, pr.cy, pr.x1, pr.y1);
        }
      } else {
        const localU = pr.len > 0.001 ? clamp01((target - pr.startDist) / pr.len) : 0;
        if (pr.type === "line") {
          ctx.lineTo(pr.x0 + (pr.x1 - pr.x0) * localU, pr.y0 + (pr.y1 - pr.y0) * localU);
        } else {
          const endP = quadPoint(pr.x0, pr.y0, pr.cx, pr.cy, pr.x1, pr.y1, localU);
          const subCx = pr.x0 + (pr.cx - pr.x0) * localU;
          const subCy = pr.y0 + (pr.cy - pr.y0) * localU;
          ctx.quadraticCurveTo(subCx, subCy, endP.x, endP.y);
        }
        break;
      }
    }
    ctx.stroke();
  };

  return { waypoints, svgPathD, totalLen, pointAt, tangentAt, drawCanvasPath };
}

function buildCurvedEdgeModel(sx, sy, ex, ey, offset) {
  const bez = computeBezierEdge(sx, sy, ex, ey, offset);
  const drawCanvasPath = (ctx, drawT = 1) => {
    const p = clamp01(drawT);
    if (p <= 0.001) return;
    if (p >= 0.995) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(bez.cx1, bez.cy1, bez.cx2, bez.cy2, ex, ey);
      ctx.stroke();
      return;
    }
    const steps = 28;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 1; i <= steps; i++) {
      const pt = bez.pointAt((i / steps) * p);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  };
  return {
    svgPathD: bez.pathD,
    cx1: bez.cx1,
    cy1: bez.cy1,
    cx2: bez.cx2,
    cy2: bez.cy2,
    pointAt: bez.pointAt,
    tangentAt: bez.tangentAt,
    drawCanvasPath,
  };
}

function getPortPoint(nodeRect, side, offsetPx, portOutset) {
  if (side === "left") {
    return { x: nodeRect.x - portOutset, y: nodeRect.cy + offsetPx };
  }
  if (side === "right") {
    return { x: nodeRect.right + portOutset, y: nodeRect.cy + offsetPx };
  }
  if (side === "top") {
    return { x: nodeRect.cx + offsetPx, y: nodeRect.y - portOutset };
  }
  return { x: nodeRect.cx + offsetPx, y: nodeRect.bottom + portOutset };
}

function buildOrthogonalCandidates(sx, sy, srcSide, ex, ey, dstSide, obstacleRects, W, H, scale) {
  const sDir = SIDE_DIRS[srcSide];
  const dDir = SIDE_DIRS[dstSide];
  const stub = 18 * scale;
  const pStart = { x: sx, y: sy };
  const pEnd = { x: ex, y: ey };
  const sStub = { x: sx + sDir.x * stub, y: sy + sDir.y * stub };
  const dStub = { x: ex + dDir.x * stub, y: ey + dDir.y * stub };
  const candidates = [];

  const isSrcH = srcSide === "left" || srcSide === "right";
  const isDstH = dstSide === "left" || dstSide === "right";

  if (isSrcH && isDstH) {
    const forward =
      (srcSide === "right" && dstSide === "left" && ex - sx >= stub * 1.4) ||
      (srcSide === "left" && dstSide === "right" && sx - ex >= stub * 1.4);

    if (forward) {
      if (Math.abs(sy - ey) <= 4 * scale) {
        candidates.push([pStart, pEnd]);
      }
      for (const ratio of [0.5, 0.36, 0.64, 0.24, 0.76]) {
        const mx = sx + (ex - sx) * ratio;
        candidates.push([pStart, { x: mx, y: sy }, { x: mx, y: ey }, pEnd]);
      }
    }

    // U-shape detours above and below obstacles (or self-looping sides)
    let minObsY = Math.min(sy, ey);
    let maxObsY = Math.max(sy, ey);
    for (const r of obstacleRects) {
      if (r.right >= Math.min(sStub.x, dStub.x) - 10 && r.x <= Math.max(sStub.x, dStub.x) + 10) {
        minObsY = Math.min(minObsY, r.y);
        maxObsY = Math.max(maxObsY, r.bottom);
      }
    }
    const detourAboveY = Math.max(46 * (H / 560), minObsY - 26 * scale);
    const detourBelowY = Math.min(H - 18 * (H / 560), maxObsY + 26 * scale);
    candidates.push([pStart, sStub, { x: sStub.x, y: detourAboveY }, { x: dStub.x, y: detourAboveY }, dStub, pEnd]);
    candidates.push([pStart, sStub, { x: sStub.x, y: detourBelowY }, { x: dStub.x, y: detourBelowY }, dStub, pEnd]);
  } else if (!isSrcH && !isDstH) {
    const forward =
      (srcSide === "bottom" && dstSide === "top" && ey - sy >= stub * 1.4) ||
      (srcSide === "top" && dstSide === "bottom" && sy - ey >= stub * 1.4);

    if (forward) {
      if (Math.abs(sx - ex) <= 4 * scale) {
        candidates.push([pStart, pEnd]);
      }
      for (const ratio of [0.5, 0.36, 0.64, 0.24, 0.76]) {
        const my = sy + (ey - sy) * ratio;
        candidates.push([pStart, { x: sx, y: my }, { x: ex, y: my }, pEnd]);
      }
    }

    let minObsX = Math.min(sx, ex);
    let maxObsX = Math.max(sx, ex);
    for (const r of obstacleRects) {
      if (r.bottom >= Math.min(sStub.y, dStub.y) - 10 && r.y <= Math.max(sStub.y, dStub.y) + 10) {
        minObsX = Math.min(minObsX, r.x);
        maxObsX = Math.max(maxObsX, r.right);
      }
    }
    const detourLeftX = Math.max(16 * (W / 1000), minObsX - 28 * scale);
    const detourRightX = Math.min(W - 16 * (W / 1000), maxObsX + 28 * scale);
    candidates.push([pStart, sStub, { x: detourLeftX, y: sStub.y }, { x: detourLeftX, y: dStub.y }, dStub, pEnd]);
    candidates.push([pStart, sStub, { x: detourRightX, y: sStub.y }, { x: detourRightX, y: dStub.y }, dStub, pEnd]);
  } else if (isSrcH && !isDstH) {
    // H-first L-shape if exit & entry face the corner cleanly
    const exitForward = sDir.x * (ex - sx) > stub;
    const entryForward = dDir.y * (sy - ey) > stub;
    if (exitForward && entryForward) {
      candidates.push([pStart, { x: ex, y: sy }, pEnd]);
    }
    // Stubbed Z/C fallback
    candidates.push([pStart, sStub, { x: sStub.x, y: dStub.y }, dStub, pEnd]);
    const midX = (sStub.x + ex) * 0.5;
    candidates.push([pStart, sStub, { x: midX, y: sStub.y }, { x: midX, y: dStub.y }, dStub, pEnd]);
  } else {
    // V-first L-shape
    const exitForward = sDir.y * (ey - sy) > stub;
    const entryForward = dDir.x * (sx - ex) > stub;
    if (exitForward && entryForward) {
      candidates.push([pStart, { x: sx, y: ey }, pEnd]);
    }
    candidates.push([pStart, sStub, { x: dStub.x, y: sStub.y }, dStub, pEnd]);
    const midY = (sStub.y + ey) * 0.5;
    candidates.push([pStart, sStub, { x: sStub.x, y: midY }, { x: dStub.x, y: midY }, dStub, pEnd]);
  }

  return candidates.map(simplifyPolyline);
}

function scorePolyline(pts, obstacleRects, placedSegments, W, H, scale) {
  let nodeHits = 0;
  let edgeCrossings = 0;
  let marginPenalty = 0;
  let length = 0;

  const padX = 10 * (W / 1000);
  const padTop = 44 * (H / 560);
  const padBottom = 12 * (H / 560);
  const nodeClearPad = 9 * scale;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    length += Math.hypot(b.x - a.x, b.y - a.y);

    for (const rect of obstacleRects) {
      if (segmentIntersectsRect(a, b, rect, nodeClearPad)) {
        nodeHits++;
      }
    }

    for (const seg of placedSegments) {
      if (segmentsIntersect(a, b, seg.a, seg.b)) {
        edgeCrossings++;
      }
    }

    for (const p of [a, b]) {
      if (p.x < padX) marginPenalty += (padX - p.x) * 4;
      if (p.x > W - padX) marginPenalty += (p.x - (W - padX)) * 4;
      if (p.y < padTop) marginPenalty += (padTop - p.y) * 4;
      if (p.y > H - padBottom) marginPenalty += (p.y - (H - padBottom)) * 4;
    }
  }

  const bends = Math.max(0, pts.length - 2);
  const score =
    -nodeHits * 5000 -
    edgeCrossings * 1200 -
    marginPenalty -
    length * 0.12 -
    bends * 18;

  return { score, nodeHits, edgeCrossings, length };
}

/**
 * Compute shared architecture diagram layout (zones, node rects, clean ports,
 * orthogonal/straight/curved edges, and anti-overlap labels) in any canvas space.
 */
export function computeArchitectureLayout(visualData = {}, canvasW = 1000, canvasH = 560, options = {}) {
  const W = Number.isFinite(canvasW) && canvasW > 0 ? canvasW : 1000;
  const H = Number.isFinite(canvasH) && canvasH > 0 ? canvasH : 560;
  const scaleX = W / 1000;
  const scaleY = H / 560;
  const scale = Math.min(scaleX, scaleY);

  const cardW = options.cardW ?? Math.round(162 * scaleX);
  const cardH = options.cardH ?? Math.round(116 * scaleY);
  const cornerRadius = options.cornerRadius ?? Math.round(14 * scale);
  const labelScale = options.labelScale ?? scale;
  const portOutset = options.portOutset ?? 3 * scale;
  const measureLabelWidth = typeof options.measureLabelWidth === "function" ? options.measureLabelWidth : null;

  const rawNodes = Array.isArray(visualData?.nodes) ? visualData.nodes : [];
  const rawEdges = Array.isArray(visualData?.edges) ? visualData.edges : [];
  const rawZones = Array.isArray(visualData?.zones) ? visualData.zones : [];

  // 1. Node Rectangles
  const nodes = [];
  const nodeMap = new Map();
  for (const n of rawNodes) {
    if (!n || !n.id) continue;
    const xPct = Number(n.x);
    const yPct = Number(n.y);
    const cx = (Number.isFinite(xPct) ? xPct / 100 : 0.5) * W;
    const cy = (Number.isFinite(yPct) ? yPct / 100 : 0.5) * H;
    const rect = {
      id: n.id,
      cx,
      cy,
      x: cx - cardW / 2,
      y: cy - cardH / 2,
      w: cardW,
      h: cardH,
      right: cx + cardW / 2,
      bottom: cy + cardH / 2,
      xPct,
      yPct,
      raw: n,
    };
    nodes.push(rect);
    nodeMap.set(n.id, rect);
  }

  // 2. Zones (up to 2 nested levels via parent_zone)
  const rawZoneMap = new Map();
  for (const z of rawZones) {
    if (z && z.id) rawZoneMap.set(z.id, z);
  }

  const zoneDiagnostics = [];
  const zoneDepths = new Map();
  for (const z of rawZones) {
    if (!z || !z.id) continue;
    let depth = 0;
    let curr = z;
    const visited = new Set([z.id]);
    let broken = false;

    while (curr.parent_zone) {
      if (!rawZoneMap.has(curr.parent_zone)) {
        zoneDiagnostics.push({
          code: "zone-unknown-parent",
          zoneId: z.id,
          message: `Zone "${z.id}" tham chiếu parent_zone không tồn tại: "${curr.parent_zone}".`,
        });
        broken = true;
        break;
      }
      if (visited.has(curr.parent_zone)) {
        zoneDiagnostics.push({
          code: "zone-cycle",
          zoneId: z.id,
          message: `Zone "${z.id}" có vòng lặp parent_zone.`,
        });
        broken = true;
        break;
      }
      visited.add(curr.parent_zone);
      curr = rawZoneMap.get(curr.parent_zone);
      depth++;
      if (depth > 3) break;
    }

    if (!broken && depth > 1) {
      zoneDiagnostics.push({
        code: "zone-max-depth",
        zoneId: z.id,
        message: `Zone "${z.id}" lồng quá 2 tầng (depth=${depth}; tối đa depth 0 và depth 1).`,
      });
    }
    zoneDepths.set(z.id, Math.min(depth, 1));
  }

  const computedZoneMap = new Map();
  const resolveZoneRect = (z) => {
    const depth = zoneDepths.get(z.id) ?? 0;
    const hasExplicit = [z.x, z.y, z.w, z.h].every((v) => Number.isFinite(Number(v)));
    let zx;
    let zy;
    let zw;
    let zh;

    if (hasExplicit) {
      zx = (Number(z.x) / 100) * W;
      zy = (Number(z.y) / 100) * H;
      zw = (Number(z.w) / 100) * W;
      zh = (Number(z.h) / 100) * H;
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      const padX = (depth === 0 ? 26 : 20) * scaleX;
      const padTop = (z.sublabel ? (depth === 0 ? 48 : 44) : depth === 0 ? 40 : 36) * scaleY;
      const padBottom = (depth === 0 ? 20 : 16) * scaleY;

      for (const nid of z.node_ids || []) {
        const nr = nodeMap.get(nid);
        if (!nr) continue;
        minX = Math.min(minX, nr.x - padX);
        minY = Math.min(minY, nr.y - padTop);
        maxX = Math.max(maxX, nr.right + padX);
        maxY = Math.max(maxY, nr.bottom + padBottom);
      }

      if (depth === 0) {
        const childPadX = 16 * scaleX;
        const childPadTop = (z.sublabel ? 44 : 36) * scaleY;
        const childPadBottom = 14 * scaleY;
        for (const cz of computedZoneMap.values()) {
          if (cz.parent_zone !== z.id) continue;
          minX = Math.min(minX, cz.x - childPadX);
          minY = Math.min(minY, cz.y - childPadTop);
          maxX = Math.max(maxX, cz.right + childPadX);
          maxY = Math.max(maxY, cz.bottom + childPadBottom);
        }
      }

      if (!Number.isFinite(minX)) {
        return null;
      }

      const marginX = 4 * scaleX;
      const marginY = 4 * scaleY;
      zx = Math.max(marginX, minX);
      zy = Math.max(marginY, minY);
      const right = Math.min(W - marginX, maxX);
      const bottom = Math.min(H - marginY, maxY);
      zw = Math.max(60 * scaleX, right - zx);
      zh = Math.max(40 * scaleY, bottom - zy);
    }

    const role = z.role && ZONE_ROLE_STYLES[z.role] ? z.role : "network";
    const style = ZONE_ROLE_STYLES[role];
    const labelText = String(z.label || z.id || "");
    const subText = z.sublabel ? String(z.sublabel) : "";
    const badgeFontSize = Math.round(11 * labelScale * 10) / 10;
    const badgeH = Math.round((subText ? 24 : 21) * labelScale);
    const labelCharW = 6.8 * labelScale;
    const subCharW = 5.8 * labelScale;
    const badgeW = Math.min(
      Math.max(40, zw - 16 * scaleX),
      Math.round(
        labelText.length * labelCharW +
          (subText ? subText.length * subCharW + 18 * labelScale : 0) +
          22 * labelScale
      )
    );

    return {
      id: z.id,
      label: labelText,
      sublabel: subText,
      role,
      parent_zone: z.parent_zone || null,
      depth,
      x: zx,
      y: zy,
      w: zw,
      h: zh,
      right: zx + zw,
      bottom: zy + zh,
      hasExplicitBounds: hasExplicit,
      dashed: z.dashed !== undefined ? Boolean(z.dashed) : style.dashed,
      style,
      badgeX: zx + 10 * scaleX,
      badgeY: zy + 8 * scaleY,
      badgeW,
      badgeH,
      badgeFontSize,
      raw: z,
    };
  };

  // Compute depth 1 first so depth 0 parent zones auto-expand around children
  for (const z of rawZones) {
    if (!z || !z.id) continue;
    if ((zoneDepths.get(z.id) ?? 0) === 1) {
      const resolved = resolveZoneRect(z);
      if (resolved) computedZoneMap.set(z.id, resolved);
    }
  }
  for (const z of rawZones) {
    if (!z || !z.id) continue;
    if ((zoneDepths.get(z.id) ?? 0) === 0) {
      const resolved = resolveZoneRect(z);
      if (resolved) computedZoneMap.set(z.id, resolved);
    }
  }
  const zones = Array.from(computedZoneMap.values()).sort((a, b) => a.depth - b.depth);

  // 3. Edge Classification & Port Side Selection
  const validEdges = [];
  const unknownEdgeTargets = [];
  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i];
    if (!e) continue;
    const src = nodeMap.get(e.from);
    const dst = nodeMap.get(e.to);
    if (!src || !dst) {
      unknownEdgeTargets.push({
        id: e.id || `edge_${i}`,
        from: e.from,
        to: e.to,
      });
      continue;
    }
    validEdges.push({ edge: e, index: i, src, dst });
  }

  const directedSet = new Set(validEdges.map((item) => `${item.edge.from}->${item.edge.to}`));
  const undirectedCounts = new Map();
  for (const item of validEdges) {
    const key = [item.edge.from, item.edge.to].sort().join("--");
    undirectedCounts.set(key, (undirectedCounts.get(key) || 0) + 1);
  }

  const prelimEdges = validEdges.map((item) => {
    const { edge, index, src, dst } = item;
    const isBidirectional = directedSet.has(`${edge.to}->${edge.from}`);
    const pairKey = [edge.from, edge.to].sort().join("--");
    const isParallel = (undirectedCounts.get(pairKey) || 0) > 1;
    const dx = dst.cx - src.cx;
    const dy = dst.cy - src.cy;

    const obstacles = nodes.filter((nr) => nr.id !== src.id && nr.id !== dst.id);

    const primaryH = Math.abs(dx) / Math.max(1, cardW) >= Math.abs(dy) / Math.max(1, cardH);
    const oppSrc = primaryH ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
    const oppDst = primaryH ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom";

    let chosenSrcSide = oppSrc;
    let chosenDstSide = oppDst;

    const alignedH = Math.abs(dy) <= cardH * 0.35;
    const alignedV = Math.abs(dx) <= cardW * 0.35;

    if (!isBidirectional && !alignedH && !alignedV && edge.routing !== "curved" && edge.routing !== "straight") {
      // Compare opposite Z-shape vs L-shape H-first vs L-shape V-first
      const sidePairs = [
        [oppSrc, oppDst, 0],
        [dx >= 0 ? "right" : "left", dy >= 0 ? "top" : "bottom", -12],
        [dy >= 0 ? "bottom" : "top", dx >= 0 ? "left" : "right", -12],
      ];
      let bestPairScore = -Infinity;
      for (const [sSide, dSide, bias] of sidePairs) {
        const sp = getPortPoint(src, sSide, 0, portOutset);
        const dp = getPortPoint(dst, dSide, 0, portOutset);
        const cands = buildOrthogonalCandidates(sp.x, sp.y, sSide, dp.x, dp.y, dSide, obstacles, W, H, scale);
        for (const pts of cands) {
          const ev = scorePolyline(pts, obstacles, [], W, H, scale);
          if (ev.score + bias > bestPairScore) {
            bestPairScore = ev.score + bias;
            chosenSrcSide = sSide;
            chosenDstSide = dSide;
          }
        }
      }
    }

    return {
      edge,
      index,
      src,
      dst,
      isBidirectional,
      isParallel,
      srcSide: chosenSrcSide,
      dstSide: chosenDstSide,
      obstacles,
    };
  });

  // 4. Distribute Parallel / Multi-Edge Ports along Each Card Side
  const portBuckets = new Map();
  const addPort = (nodeId, side, record) => {
    const key = `${nodeId}:${side}`;
    if (!portBuckets.has(key)) portBuckets.set(key, []);
    portBuckets.get(key).push(record);
  };

  for (const item of prelimEdges) {
    addPort(item.src.id, item.srcSide, {
      item,
      role: "src",
      otherNode: item.dst,
    });
    addPort(item.dst.id, item.dstSide, {
      item,
      role: "dst",
      otherNode: item.src,
    });
  }

  for (const [key, list] of portBuckets.entries()) {
    const side = key.split(":")[1];
    const isVerticalEdge = side === "left" || side === "right";
    list.sort((a, b) => {
      const coordDiff = isVerticalEdge
        ? a.otherNode.cy - b.otherNode.cy
        : a.otherNode.cx - b.otherNode.cx;
      if (Math.abs(coordDiff) > 4) return coordDiff;
      if (a.item.isBidirectional && b.item.isBidirectional && a.otherNode.id === b.otherNode.id) {
        // Align port lane with the direction computeBezierEdge(+mag) bows so A->B and B->A never cross at ports
        const eA = a.item.edge;
        const nFrom = nodeMap.get(eA.from);
        const nTo = nodeMap.get(eA.to);
        const edx = (nTo?.cx ?? 0) - (nFrom?.cx ?? 0);
        const edy = (nTo?.cy ?? 0) - (nFrom?.cy ?? 0);
        const laneOf = (dxVal, dyVal) => (isVerticalEdge ? (dxVal >= 0 ? 1 : -1) : (dyVal >= 0 ? -1 : 1));
        const eB = b.item.edge;
        const bFrom = nodeMap.get(eB.from);
        const bTo = nodeMap.get(eB.to);
        const bdx = (bTo?.cx ?? 0) - (bFrom?.cx ?? 0);
        const bdy = (bTo?.cy ?? 0) - (bFrom?.cy ?? 0);
        return laneOf(edx, edy) - laneOf(bdx, bdy);
      }
      return a.item.index - b.item.index;
    });

    const n = list.length;
    const maxSpan = isVerticalEdge ? cardH * 0.64 : cardW * 0.68;
    const step = n > 1 ? Math.min(22 * scale, maxSpan / (n - 1)) : 0;
    const totalSpan = step * (n - 1);

    for (let i = 0; i < n; i++) {
      const offsetPx = n === 1 ? 0 : -totalSpan / 2 + i * step;
      if (list[i].role === "src") {
        list[i].item.srcPortOffset = offsetPx;
      } else {
        list[i].item.dstPortOffset = offsetPx;
      }
    }
  }

  // 5. Route Every Edge (Straight / Orthogonal Rounded-Elbow / Gentle Curved)
  const placedSegments = [];
  const computedEdges = [];

  for (const item of prelimEdges) {
    const { edge, src, dst, srcSide, dstSide, isBidirectional, obstacles } = item;
    const sp = getPortPoint(src, srcSide, item.srcPortOffset || 0, portOutset);
    const dp = getPortPoint(dst, dstSide, item.dstPortOffset || 0, portOutset);
    let sx = sp.x;
    let sy = sp.y;
    let ex = dp.x;
    let ey = dp.y;

    const reqRouting = edge.routing || "auto";
    const isOppH = (srcSide === "right" && dstSide === "left") || (srcSide === "left" && dstSide === "right");
    const isOppV = (srcSide === "bottom" && dstSide === "top") || (srcSide === "top" && dstSide === "bottom");

    // Snap perfectly horizontal/vertical when single-port aligned
    if (!isBidirectional && reqRouting !== "curved") {
      if (isOppH && Math.abs(sy - ey) <= 8 * scale && (item.srcPortOffset || 0) === 0 && (item.dstPortOffset || 0) === 0) {
        const avgY = (sy + ey) * 0.5;
        sy = avgY;
        ey = avgY;
      }
      if (isOppV && Math.abs(sx - ex) <= 8 * scale && (item.srcPortOffset || 0) === 0 && (item.dstPortOffset || 0) === 0) {
        const avgX = (sx + ex) * 0.5;
        sx = avgX;
        ex = avgX;
      }
    }

    const straightAligned =
      (isOppH && Math.abs(sy - ey) <= 2 * scale) ||
      (isOppV && Math.abs(sx - ex) <= 2 * scale);

    const straightHitsNode = obstacles.some((r) => segmentIntersectsRect({ x: sx, y: sy }, { x: ex, y: ey }, r, 9 * scale));

    let routing = "orthogonal";
    let model = null;
    let curveOffsetUsed = 0;

    const buildGentleCurve = (offsetsToTry) => {
      let bestOffset = offsetsToTry[0];
      let bestModel = null;
      let bestScore = -Infinity;

      for (const off of offsetsToTry) {
        const cand = buildCurvedEdgeModel(sx, sy, ex, ey, off);
        let hitsNode = 0;
        let boundaryPen = 0;
        let edgeHits = 0;
        let prevPt = cand.pointAt(0);
        for (let s = 1; s <= 12; s++) {
          const pt = cand.pointAt(s / 12);
          if (pt.y < 44 * scaleY) boundaryPen += (44 * scaleY - pt.y) * 5;
          if (pt.y > H - 14 * scaleY) boundaryPen += (pt.y - (H - 14 * scaleY)) * 5;
          if (pt.x < 14 * scaleX) boundaryPen += (14 * scaleX - pt.x) * 4;
          if (pt.x > W - 14 * scaleX) boundaryPen += (pt.x - (W - 14 * scaleX)) * 4;
          for (const r of obstacles) {
            if (pointInRect(pt.x, pt.y, r, 8 * scale)) hitsNode++;
          }
          for (const seg of placedSegments) {
            if (segmentsIntersect(prevPt, pt, seg.a, seg.b)) edgeHits++;
          }
          prevPt = pt;
        }
        const sc = -hitsNode * 4000 - edgeHits * 900 - boundaryPen;
        if (sc > bestScore) {
          bestScore = sc;
          bestOffset = off;
          bestModel = cand;
        }
      }
      return { model: bestModel, offset: bestOffset };
    };

    const dist = Math.hypot(ex - sx, ey - sy);
    const restrainedMag = Math.min(36 * scale, Math.max(18 * scale, dist * 0.11));

    if (reqRouting === "straight") {
      routing = "straight";
      model = buildPolylineEdgeModel([{ x: sx, y: sy }, { x: ex, y: ey }], cornerRadius);
    } else if (reqRouting === "curved") {
      routing = "curved";
      const explicitOff = Number.isFinite(Number(edge.curve_offset))
        ? Math.max(-36 * scale, Math.min(36 * scale, Number(edge.curve_offset) * scale))
        : null;
      const res = buildGentleCurve(
        explicitOff !== null ? [explicitOff] : isBidirectional ? [restrainedMag] : [restrainedMag, -restrainedMag]
      );
      model = res.model;
      curveOffsetUsed = res.offset;
    } else if (reqRouting === "auto" && isBidirectional) {
      routing = "curved";
      const res = buildGentleCurve([restrainedMag]);
      model = res.model;
      curveOffsetUsed = res.offset;
    } else if (reqRouting === "auto" && straightAligned && !straightHitsNode) {
      routing = "straight";
      model = buildPolylineEdgeModel([{ x: sx, y: sy }, { x: ex, y: ey }], cornerRadius);
    } else {
      const cands = buildOrthogonalCandidates(sx, sy, srcSide, ex, ey, dstSide, obstacles, W, H, scale);
      let bestCand = cands[0] || [{ x: sx, y: sy }, { x: ex, y: ey }];
      let bestEval = { score: -Infinity, nodeHits: 1 };
      for (const pts of cands) {
        const ev = scorePolyline(pts, obstacles, placedSegments, W, H, scale);
        if (ev.score > bestEval.score) {
          bestEval = ev;
          bestCand = pts;
        }
      }

      if (reqRouting === "auto" && bestEval.nodeHits > 0) {
        // Fallback to gentle curve only when orthogonal cannot clear intermediate nodes
        routing = "curved";
        const skipMag = Math.min(48 * scale, Math.max(26 * scale, dist * 0.14));
        const res = buildGentleCurve([restrainedMag, -restrainedMag, skipMag, -skipMag]);
        model = res.model;
        curveOffsetUsed = res.offset;
      } else {
        routing = "orthogonal";
        model = buildPolylineEdgeModel(bestCand, cornerRadius);
      }
    }

    // Record segments for subsequent edge crossing avoidance & label placement
    const edgeSamplePts = [];
    if (routing === "curved") {
      for (let s = 0; s <= 10; s++) {
        edgeSamplePts.push(model.pointAt(s / 10));
      }
      for (let s = 0; s < edgeSamplePts.length - 1; s++) {
        placedSegments.push({ edgeId: edge.id, a: edgeSamplePts[s], b: edgeSamplePts[s + 1] });
      }
    } else {
      const wps = model.waypoints;
      for (let s = 0; s < wps.length - 1; s++) {
        placedSegments.push({ edgeId: edge.id, a: wps[s], b: wps[s + 1] });
      }
      for (let s = 0; s <= 10; s++) {
        edgeSamplePts.push(model.pointAt(s / 10));
      }
    }

    computedEdges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label || "",
      style: edge.style || "solid",
      routing,
      isBidirectional,
      curveOffset: curveOffsetUsed,
      srcSide,
      dstSide,
      sx,
      sy,
      ex,
      ey,
      svgPathD: model.svgPathD,
      drawCanvasPath: model.drawCanvasPath,
      pointAt: model.pointAt,
      tangentAt: model.tangentAt,
      waypoints: model.waypoints || null,
      samplePts: edgeSamplePts,
      raw: edge,
    });
  }

  // 6. Anti-Overlap Edge Label Placement
  const placedLabels = [];
  const topCalloutRect = {
    x: W * 0.2,
    y: 0,
    right: W * 0.8,
    bottom: 46 * scaleY,
  };

  for (const ce of computedEdges) {
    if (!ce.label) {
      ce.labelX = ce.pointAt(0.5).x;
      ce.labelY = ce.pointAt(0.5).y;
      ce.labelW = 0;
      ce.labelH = 0;
      continue;
    }

    const labelW = measureLabelWidth
      ? Math.max(84 * scaleX, measureLabelWidth(ce.label))
      : Math.max(88 * scaleX, ce.label.length * 7.2 * labelScale + 22 * labelScale);
    const labelH = Math.round(23 * labelScale);

    const tSamples = [0.5, 0.38, 0.62];
    const sideOffsets = ce.isBidirectional
      ? [18 * scale, 30 * scale, -18 * scale, -30 * scale]
      : [-18 * scale, 18 * scale, -30 * scale, 30 * scale];

    let bestCand = null;
    let bestScore = -Infinity;

    for (let ti = 0; ti < tSamples.length; ti++) {
      const tVal = tSamples[ti];
      const pt = ce.pointAt(tVal);
      const tan = ce.tangentAt(tVal);
      // Perpendicular normal
      let nx = -tan.ny;
      let ny = tan.nx;
      // For non-bidirectional horizontal-ish lines, make negative offset point upward cleanly
      if (!ce.isBidirectional && ny < 0) {
        nx = -nx;
        ny = -ny;
      }

      for (let oi = 0; oi < sideOffsets.length; oi++) {
        const off = sideOffsets[oi];
        const rawX = pt.x + nx * off;
        const rawY = pt.y + ny * off;
        const lx = Math.max(labelW * 0.5 + 8 * scaleX, Math.min(W - labelW * 0.5 - 8 * scaleX, rawX));
        const ly = Math.max(labelH * 0.5 + 8 * scaleY, Math.min(H - labelH * 0.5 - 8 * scaleY, rawY));

        const candRect = {
          x: lx - labelW * 0.5,
          y: ly - labelH * 0.5,
          right: lx + labelW * 0.5,
          bottom: ly + labelH * 0.5,
        };

        let penalty = 0;

        // Node card overlap (hard penalty)
        for (const nr of nodes) {
          const ov = rectOverlapArea(candRect, nr, 5 * scale);
          if (ov > 0) penalty += 4500 + ov * 10;
        }

        // Placed label overlap (hard penalty)
        for (const pl of placedLabels) {
          const ov = rectOverlapArea(candRect, pl, 5 * scale);
          if (ov > 0) penalty += 5500 + ov * 15;
        }

        // Top callout bar overlap
        const calloutOv = rectOverlapArea(candRect, topCalloutRect, 2 * scale);
        if (calloutOv > 0) penalty += 2200 + calloutOv * 6;

        // Other edges' path overlap
        for (const other of computedEdges) {
          if (other.id === ce.id) continue;
          for (let s = 0; s < other.samplePts.length - 1; s++) {
            if (segmentIntersectsRect(other.samplePts[s], other.samplePts[s + 1], candRect, 5 * scale)) {
              penalty += 950;
              break;
            }
          }
        }

        // Slight preference for t=0.5 and smaller perpendicular offset (18px over 30px)
        const centerBonus = tVal === 0.5 ? 24 : 0;
        const distPenalty = Math.abs(off) * 0.8 + Math.hypot(lx - rawX, ly - rawY) * 2;
        const score = centerBonus - penalty - distPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestCand = { lx, ly, rect: candRect };
        }
      }
    }

    ce.labelX = bestCand.lx;
    ce.labelY = bestCand.ly;
    ce.labelW = labelW;
    ce.labelH = labelH;
    placedLabels.push(bestCand.rect);
  }

  // 6b. Lock Packet Badge Side (Opposite-Side Lock)
  const zoneBadgeRects = zones
    .filter((z) => z.label)
    .map((z) => ({
      x: z.badgeX,
      y: z.badgeY,
      right: z.badgeX + z.badgeW,
      bottom: z.badgeY + z.badgeH,
    }));
  const badgeW = 96 * scaleX;
  const badgeH = 20 * scaleY;
  const badgeOffset = 22 * scale;
  const sampleCount = 21;

  for (const ce of computedEdges) {
    const isPolyline = Boolean(ce.waypoints && ce.waypoints.length >= 2);
    let refNx = 0;
    let refNy = 1;

    if (isPolyline) {
      let maxLen = -1;
      let bestDx = 1;
      let bestDy = 0;
      for (let i = 0; i < ce.waypoints.length - 1; i++) {
        const a = ce.waypoints[i];
        const b = ce.waypoints[i + 1];
        const segDx = b.x - a.x;
        const segDy = b.y - a.y;
        const segLen = Math.hypot(segDx, segDy);
        if (segLen > maxLen) {
          maxLen = segLen;
          bestDx = segDx;
          bestDy = segDy;
        }
      }
      if (maxLen > 1e-6) {
        refNx = -bestDy / maxLen;
        refNy = bestDx / maxLen;
      } else {
        const tan = ce.tangentAt(0.5);
        refNx = -tan.ny;
        refNy = tan.nx;
      }
    } else {
      const tan = ce.tangentAt(0.5);
      refNx = -tan.ny;
      refNy = tan.nx;
    }

    const badgeSamples = [];
    for (let s = 0; s < sampleCount; s++) {
      const t = s / (sampleCount - 1);
      badgeSamples.push({
        pt: ce.pointAt(t),
        tan: isPolyline ? null : ce.tangentAt(t),
      });
    }

    const buildBadgeRect = (sp, side) => {
      const bnx = (isPolyline ? refNx : -sp.tan.ny) * side;
      const bny = (isPolyline ? refNy : sp.tan.nx) * side;
      const bx = sp.pt.x + bnx * badgeOffset;
      const by = sp.pt.y + bny * badgeOffset;
      return {
        x: bx - badgeW * 0.5,
        y: by - badgeH * 0.5,
        right: bx + badgeW * 0.5,
        bottom: by + badgeH * 0.5,
      };
    };

    let packetBadgeSide;
    if (ce.label) {
      let closestPt = badgeSamples[0].pt;
      let minDistSq = Infinity;
      for (const sp of badgeSamples) {
        const dSq = (sp.pt.x - ce.labelX) ** 2 + (sp.pt.y - ce.labelY) ** 2;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          closestPt = sp.pt;
        }
      }
      const dot = (ce.labelX - closestPt.x) * refNx + (ce.labelY - closestPt.y) * refNy;
      const preferredSide = dot >= 0 ? -1 : 1;
      const labelRect = {
        x: ce.labelX - ce.labelW * 0.5,
        y: ce.labelY - ce.labelH * 0.5,
        right: ce.labelX + ce.labelW * 0.5,
        bottom: ce.labelY + ce.labelH * 0.5,
      };
      const evalLabelOverlap = (side) => {
        let ov = 0;
        for (const sp of badgeSamples) {
          ov += rectOverlapArea(buildBadgeRect(sp, side), labelRect);
        }
        return ov;
      };
      const ovPref = evalLabelOverlap(preferredSide);
      const ovOther = evalLabelOverlap(-preferredSide);
      packetBadgeSide = ovOther + 1e-3 < ovPref ? -preferredSide : preferredSide;
    } else {
      const preferredSide = Math.abs(refNy) > 1e-6 ? (refNy > 0 ? -1 : 1) : -1;
      const obstacleNodes = nodes.filter((nr) => nr.id !== ce.from && nr.id !== ce.to);
      const evalObstacleOverlap = (side) => {
        let ov = 0;
        for (const sp of badgeSamples) {
          const rect = buildBadgeRect(sp, side);
          for (const nr of obstacleNodes) {
            ov += rectOverlapArea(rect, nr);
          }
          for (const zr of zoneBadgeRects) {
            ov += rectOverlapArea(rect, zr);
          }
        }
        return ov;
      };
      const ovPref = evalObstacleOverlap(preferredSide);
      const ovOther = evalObstacleOverlap(-preferredSide);
      packetBadgeSide = ovOther + 1e-3 < ovPref ? -preferredSide : preferredSide;
    }

    ce.packetBadgeSide = packetBadgeSide;
    ce.packetBadgeRefNx = refNx;
    ce.packetBadgeRefNy = refNy;
  }

  return {
    width: W,
    height: H,
    scaleX,
    scaleY,
    scale,
    cardW,
    cardH,
    zones,
    nodes,
    edges: computedEdges,
    zoneDiagnostics,
    unknownEdgeTargets,
  };
}

/**
 * Compute packet_label badge position using the edge's locked opposite side.
 */
export function computePacketBadgePos(pktPos, pktTan, geom, options = {}) {
  const {
    offset = 22,
    canvasW = 1000,
    canvasH = 560,
    padX = 54,
    padYTop = 18,
    padYBottom = 16,
  } = options || {};
  const side = geom?.packetBadgeSide ?? -1;
  let nx;
  let ny;
  if (
    geom?.waypoints &&
    geom.waypoints.length >= 2 &&
    Number.isFinite(geom.packetBadgeRefNx) &&
    Number.isFinite(geom.packetBadgeRefNy)
  ) {
    nx = geom.packetBadgeRefNx * side;
    ny = geom.packetBadgeRefNy * side;
  } else {
    nx = -(pktTan?.ny ?? 0) * side;
    ny = (pktTan?.nx ?? 1) * side;
  }
  const x = (pktPos?.x ?? 0) + nx * offset;
  const y = (pktPos?.y ?? 0) + ny * offset;
  return {
    x: Math.max(padX, Math.min(canvasW - padX, x)),
    y: Math.max(padYTop, Math.min(canvasH - padYBottom, y)),
  };
}

export const SUPPORTED_VISUAL_TYPES = Object.freeze([
  "architecture",
  "console_setup",
  "code_cli",
  "exam_tips",
  "comparison_matrix",
  "timeline_flow",
  "kpi_metrics",
]);

function readProgressMark(val, fallback) {
  const n = Number(val);
  return val !== undefined && val !== null && val !== "" && Number.isFinite(n)
    ? clamp01(n)
    : clamp01(fallback);
}

/**
 * Shared state computation for `comparison_matrix` scenes (React DOM & Canvas 2D).
 */
export function computeComparisonMatrixState(visualData, progress = 0) {
  const p = clamp01(progress);
  const data = visualData || {};
  const columns = Array.isArray(data.columns) ? data.columns : [];
  const rawRows = Array.isArray(data.rows) ? data.rows : [];
  const count = rawRows.length;

  const rows = rawRows.map((row, idx) => {
    const fallbackStart = 0.08 + (idx / Math.max(1, count)) * 0.62;
    const progressStart = readProgressMark(row?.progress_start, fallbackStart);
    const localT = clamp01((p - progressStart) / 0.11);
    const revealProgress = easeQuartOut(localT);
    const visible = p >= progressStart;
    return {
      index: idx,
      criterion: String(row?.criterion || ""),
      values: row?.values && typeof row.values === "object" ? row.values : {},
      progressStart,
      visible,
      active: false,
      revealProgress,
    };
  });

  let activeRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].visible) activeRowIndex = i;
  }

  const takeaway = data.takeaway && typeof data.takeaway === "object" ? data.takeaway : null;
  const takeawayStart = readProgressMark(takeaway?.show_at_progress, 0.78);
  const showTakeaway = Boolean(takeaway?.text && p >= takeawayStart);
  const takeawayReveal = showTakeaway ? easeQuartOut(clamp01((p - takeawayStart) / 0.12)) : 0;

  for (let i = 0; i < rows.length; i++) {
    rows[i].active = !showTakeaway && i === activeRowIndex;
  }

  return {
    badge: String(data.badge || "So sánh Chuyên sâu"),
    columns,
    rows,
    activeRowIndex,
    visibleCount: rows.filter((r) => r.visible).length,
    takeaway,
    takeawayStart,
    showTakeaway,
    takeawayReveal,
  };
}

/**
 * Shared state computation for `timeline_flow` scenes (React DOM & Canvas 2D).
 */
export function computeTimelineFlowState(visualData, progress = 0) {
  const p = clamp01(progress);
  const data = visualData || {};
  const orientation = data.orientation === "vertical" ? "vertical" : "horizontal";
  const rawMilestones = Array.isArray(data.milestones) ? data.milestones : [];
  const count = rawMilestones.length;

  const milestones = rawMilestones.map((m, idx) => {
    const defaultStart = 0.06 + (idx / Math.max(1, count)) * 0.68;
    const progressStart = readProgressMark(m?.progress_start, defaultStart);
    const defaultEnd = idx + 1 < count
      ? readProgressMark(rawMilestones[idx + 1]?.progress_start, 0.06 + ((idx + 1) / Math.max(1, count)) * 0.68)
      : 0.92;
    const rawEnd = readProgressMark(m?.progress_end, defaultEnd);
    const progressEnd = Math.max(progressStart + 0.04, rawEnd);
    const revealProgress = easeQuartOut(clamp01((p - progressStart) / 0.11));
    return {
      index: idx,
      id: String(m?.id || `m${idx + 1}`),
      timeLabel: String(m?.time_label || `Bước ${idx + 1}`),
      title: String(m?.title || ""),
      description: String(m?.description || ""),
      icon: String(m?.icon || "code"),
      tone: String(m?.tone || "blue"),
      metricBadge: m?.metric_badge ? String(m.metric_badge) : "",
      progressStart,
      progressEnd,
      revealProgress,
      started: p >= progressStart,
      completed: false,
      active: false,
    };
  });

  const callout = data.callout && typeof data.callout === "object" ? data.callout : null;
  const calloutStart = readProgressMark(callout?.show_at_progress, 0.80);
  const showCallout = Boolean((callout?.title || callout?.text) && p >= calloutStart);
  const calloutReveal = showCallout ? easeQuartOut(clamp01((p - calloutStart) / 0.12)) : 0;

  let activeIndex = -1;
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const nextStarted = i + 1 < milestones.length ? p >= milestones[i + 1].progressStart : false;
    const pastOwnEnd = p > m.progressEnd;
    if (nextStarted || pastOwnEnd || (i === milestones.length - 1 && showCallout && p >= m.progressEnd)) {
      m.completed = m.started;
    }
    if (m.started && !m.completed) {
      activeIndex = i;
    }
  }
  if (activeIndex === -1 && milestones.length > 0 && p >= milestones[0].progressStart && !showCallout) {
    for (let i = milestones.length - 1; i >= 0; i--) {
      if (milestones[i].started && !milestones[i].completed) {
        activeIndex = i;
        break;
      }
    }
  }
  if (activeIndex >= 0 && milestones[activeIndex]) {
    milestones[activeIndex].active = true;
  }

  let trackFillRatio = 0;
  if (milestones.length === 1) {
    trackFillRatio = milestones[0].revealProgress;
  } else if (milestones.length > 1) {
    const firstStart = milestones[0].progressStart;
    const lastStart = milestones[milestones.length - 1].progressStart;
    if (p <= firstStart) {
      trackFillRatio = 0;
    } else if (p >= lastStart) {
      trackFillRatio = 1;
    } else {
      for (let i = 0; i < milestones.length - 1; i++) {
        const cur = milestones[i].progressStart;
        const nxt = milestones[i + 1].progressStart;
        if (p >= cur && p <= nxt) {
          const segSpan = Math.max(0.01, nxt - cur);
          const segRatio = clamp01((p - cur) / segSpan);
          trackFillRatio = (i + easeCubicInOut(segRatio)) / (milestones.length - 1);
          break;
        }
      }
    }
  }

  return {
    orientation,
    milestones,
    activeIndex,
    trackFillRatio: clamp01(trackFillRatio),
    callout,
    calloutStart,
    showCallout,
    calloutReveal,
  };
}

function formatKpiDisplayNumber(target, ratio, card) {
  if (ratio >= 0.999 && card?.value !== undefined && card?.value !== null && card?.value !== "") {
    return String(card.value);
  }
  const hasExplicitDecimals = Number.isInteger(card?.decimals) && card.decimals >= 0;
  let decimals = hasExplicitDecimals ? card.decimals : 0;
  if (!hasExplicitDecimals) {
    const asStr = String(target);
    const dot = asStr.indexOf(".");
    if (dot >= 0) decimals = Math.min(3, asStr.length - dot - 1);
  }
  const current = target * ratio;
  const formatted = decimals > 0
    ? current.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : Math.round(current).toLocaleString("en-US");
  const prefix = card?.prefix ? String(card.prefix) : "";
  const suffix = card?.suffix ? String(card.suffix) : "";
  return `${prefix}${formatted}${suffix}`;
}

/**
 * Shared state computation for `kpi_metrics` scenes (React DOM & Canvas 2D).
 */
export function computeKpiMetricsState(visualData, progress = 0) {
  const p = clamp01(progress);
  const data = visualData || {};
  const rawCards = Array.isArray(data.cards) ? data.cards : [];
  const count = rawCards.length;

  const cards = rawCards.map((card, idx) => {
    const fallbackStart = 0.06 + idx * 0.09;
    const progressStart = readProgressMark(card?.progress_start, fallbackStart);
    const visible = p >= progressStart;
    const revealT = clamp01((p - progressStart) / 0.12);
    const countT = clamp01((p - progressStart) / 0.24);
    const countEased = easeQuartOut(countT);
    const sparklineT = easeQuartOut(clamp01((p - progressStart - 0.03) / 0.28));

    const hasNumeric = Number.isFinite(Number(card?.numeric_target));
    const displayValue = !visible
      ? (card?.prefix ? `${card.prefix}0${card.suffix || ""}` : "0")
      : hasNumeric
        ? formatKpiDisplayNumber(Number(card.numeric_target), countEased, card)
        : String(card?.value || "");

    const sparkline = Array.isArray(card?.sparkline)
      ? card.sparkline.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : [];

    return {
      index: idx,
      id: String(card?.id || `kpi${idx + 1}`),
      label: String(card?.label || ""),
      value: String(card?.value || ""),
      displayValue,
      deltaText: card?.delta_text ? String(card.delta_text) : "",
      deltaTone: String(card?.delta_tone || card?.tone || "blue"),
      tone: String(card?.tone || "blue"),
      sparkline,
      progressStart,
      visible,
      revealProgress: easeQuartOut(revealT),
      sparklineProgress: sparklineT,
      active: visible && countT < 1.0,
    };
  });

  const chart = data.chart && typeof data.chart === "object" ? data.chart : null;
  const rawSeries = Array.isArray(chart?.series) ? chart.series : [];
  const chartStart = readProgressMark(chart?.show_at_progress, 0.40);
  const showChart = Boolean(chart && rawSeries.length > 0 && p >= chartStart);
  const chartReveal = showChart ? easeQuartOut(clamp01((p - chartStart) / 0.14)) : 0;
  const series = rawSeries.map((pt, idx) => {
    const barStart = chartStart + idx * 0.032;
    const barRatio = showChart ? easeQuartOut(clamp01((p - barStart) / 0.22)) : 0;
    return {
      index: idx,
      label: String(pt?.label || ""),
      value: Number.isFinite(Number(pt?.value)) ? Number(pt.value) : 0,
      highlight: Boolean(pt?.highlight),
      barRatio,
    };
  });

  const alertStamp = data.alert_stamp && typeof data.alert_stamp === "object" ? data.alert_stamp : null;
  const stampStart = readProgressMark(alertStamp?.show_at_progress, 0.72);
  const showStamp = Boolean(alertStamp?.text && p >= stampStart);
  const stampT = showStamp ? clamp01((p - stampStart) / 0.16) : 0;
  const stampScale = showStamp ? dampedSpring(stampT, { from: 1.55, to: 1.0, durationSec: 0.36 }) : 1;

  let activeCardIndex = -1;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].visible) activeCardIndex = i;
  }

  return {
    cards,
    activeCardIndex,
    visibleCardCount: cards.filter((c) => c.visible).length,
    chart: chart
      ? {
          title: String(chart.title || ""),
          type: String(chart.type || "bar"),
          unit: String(chart.unit || ""),
          series,
        }
      : null,
    chartStart,
    showChart,
    chartReveal,
    alertStamp,
    stampStart,
    showStamp,
    stampScale,
    stampProgress: stampT,
  };
}

/**
 * Shared burst key & focal point across all 7 visual types (React ParticleStage & Canvas 2D Exporter).
 */
export function getSceneBurstInfo(scene, progress = 0, W = 1920, H = 1080, sceneIdx = 0) {
  const fallback = { key: "none", nx: 0.5, ny: 0.36, cx: 0.5 * W, cy: 0.36 * H };
  if (!scene) return fallback;
  const p = clamp01(progress);
  const data = scene.visual_data || {};
  const vtype = scene.visual_type || "architecture";
  const prefix = `${sceneIdx}:`;

  let nx = 0.5;
  let ny = 0.36;
  let key = "none";

  if (vtype === "console_setup") {
    const steps = data.steps || [];
    const idx = steps.findIndex((s) => p >= s.progress_start && p <= s.progress_end);
    const activeIdx = idx >= 0 ? idx : Math.max(0, steps.length - 1);
    key = `${prefix}console:${activeIdx}`;
    nx = 0.56;
    ny = 0.34;
  } else if (vtype === "code_cli") {
    const phases = data.highlight_phases || [];
    const pIdx = phases.findIndex((ph) => p >= ph.progress_start && p <= ph.progress_end);
    const activePIdx = pIdx >= 0 ? pIdx : Math.max(0, phases.length - 1);
    const startedCmds = (data.terminal_commands || []).filter((c) => p >= c.progress_start).length;
    key = `${prefix}codecli:${activePIdx}:${startedCmds}`;
    nx = startedCmds > 0 ? 0.72 : 0.32;
    ny = 0.38;
  } else if (vtype === "exam_tips") {
    const revealed = (data.comparisons || []).filter((c) => p >= (c.progress_start ?? 0)).length;
    const quizShown = data.quiz && p >= (data.quiz.show_at_progress ?? 0.68) ? 1 : 0;
    key = `${prefix}exam:${revealed}:${quizShown}`;
    nx = 0.5;
    ny = quizShown ? 0.72 : 0.34;
  } else if (vtype === "comparison_matrix") {
    const st = computeComparisonMatrixState(data, p);
    if (st.showTakeaway) {
      key = `${prefix}matrix-takeaway`;
      nx = 0.50;
      ny = 0.78;
    } else {
      key = `${prefix}matrix-row:${st.visibleCount}`;
      nx = 0.50;
      ny = Math.min(0.72, 0.28 + Math.max(0, st.activeRowIndex) * 0.085);
    }
  } else if (vtype === "timeline_flow") {
    const st = computeTimelineFlowState(data, p);
    if (st.showCallout) {
      key = `${prefix}timeline-callout`;
      nx = 0.50;
      ny = 0.75;
    } else {
      const mCount = st.milestones.length;
      const idx = Math.max(0, st.activeIndex);
      key = `${prefix}timeline-step:${st.activeIndex}`;
      if (st.orientation === "vertical") {
        nx = 0.48;
        ny = Math.min(0.76, 0.24 + idx * 0.11);
      } else {
        nx = mCount > 1 ? 0.16 + (idx / (mCount - 1)) * 0.68 : 0.50;
        ny = 0.44;
      }
    }
  } else if (vtype === "kpi_metrics") {
    const st = computeKpiMetricsState(data, p);
    if (st.showStamp) {
      key = `${prefix}kpi-stamp`;
      nx = 0.80;
      ny = 0.72;
    } else if (st.showChart) {
      key = `${prefix}kpi-chart:${st.visibleCardCount}`;
      nx = 0.50;
      ny = 0.62;
    } else {
      const cCount = Math.max(1, st.cards.length);
      const idx = Math.max(0, st.activeCardIndex);
      key = `${prefix}kpi-card:${st.visibleCardCount}`;
      nx = cCount > 1 ? 0.18 + (idx / (cCount - 1)) * 0.64 : 0.50;
      ny = 0.28;
    }
  } else {
    const flowSteps = data.flow_steps || [];
    const sIdx = flowSteps.findIndex((s) => p >= s.progress_start && p <= s.progress_end);
    const activeSIdx = sIdx >= 0 ? sIdx : Math.max(0, flowSteps.length - 1);
    const activeStep = flowSteps[activeSIdx];
    const firstNodeId = activeStep?.active_nodes?.[0];
    const node = (data.nodes || []).find((n) => n.id === firstNodeId);
    key = `${prefix}arch:${activeSIdx}`;
    nx = node ? Math.max(0.12, Math.min(0.88, (Number(node.x) || 50) / 100)) : 0.5;
    ny = node ? Math.max(0.16, Math.min(0.82, (Number(node.y) || 36) / 100)) : 0.36;
  }

  return { key, nx, ny, cx: nx * W, cy: ny * H };
}

