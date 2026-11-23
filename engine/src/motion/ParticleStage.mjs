import React, { useEffect, useMemo, useRef } from "react";
import { MOTION_TOKENS, clamp01 } from "./kernel.mjs";

const h = React.createElement;

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
 * Deterministic for any timeSec (supports scrubbing & live playback).
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

function resolveBurstCoords(burstPoint, width, height) {
  if (!burstPoint || typeof burstPoint !== "object") {
    return { x: width * 0.5, y: height * 0.36 };
  }
  const rawX = Number(burstPoint.x);
  const rawY = Number(burstPoint.y);
  const x = Number.isFinite(rawX)
    ? rawX >= 0 && rawX <= 1
      ? rawX * width
      : rawX
    : width * 0.5;
  const y = Number.isFinite(rawY)
    ? rawY >= 0 && rawY <= 1
      ? rawY * height
      : rawY
    : height * 0.36;
  return { x, y };
}

/**
 * Dual-layer Canvas overlay for Studio stage:
 * - Layer 0 (.particle-layer-ambient, z-index 1): subtle 60px blueprint grid + slow bokeh
 * - Layer 2 (.particle-layer-burst, z-index 14): multi-color pixel confetti burst on triggerKey change
 */
export function ParticleStage({ triggerKey, burstPoint, isPlaying = false, timeSec }) {
  const bgCanvasRef = useRef(null);
  const fxCanvasRef = useRef(null);
  const seeds = useMemo(() => createBokehSeeds(22), []);

  const particlesRef = useRef([]);
  const sizeRef = useRef({ width: 1280, height: 720, dpr: 1 });
  const timeRef = useRef(Number.isFinite(timeSec) ? timeSec : 0);
  const isPlayingRef = useRef(Boolean(isPlaying));
  const lastTriggerRef = useRef(undefined);

  timeRef.current = Number.isFinite(timeSec) ? timeSec : timeRef.current;
  isPlayingRef.current = Boolean(isPlaying);

  // Sync canvas dimensions cleanly with container resize
  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    const fxCanvas = fxCanvasRef.current;
    if (!bgCanvas || !fxCanvas) return;

    const updateSize = () => {
      const parent = bgCanvas.parentElement || bgCanvas;
      const w = Math.max(1, parent.clientWidth || 1280);
      const hPx = Math.max(1, parent.clientHeight || 720);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width: w, height: hPx, dpr };

      for (const canvas of [bgCanvas, fxCanvas]) {
        const targetW = Math.round(w * dpr);
        const targetH = Math.round(hPx * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
      }
    };

    updateSize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSize) : null;
    if (ro && bgCanvas.parentElement) {
      ro.observe(bgCanvas.parentElement);
    }
    window.addEventListener("resize", updateSize);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  // Trigger Layer 2 multi-color pixel confetti burst whenever triggerKey changes
  useEffect(() => {
    if (triggerKey === undefined || triggerKey === null) return;
    if (lastTriggerRef.current === triggerKey) return;
    lastTriggerRef.current = triggerKey;

    const { width, height } = sizeRef.current;
    const { x, y } = resolveBurstCoords(burstPoint, width, height);
    const fresh = createSparkleParticles(x, y, 22);
    particlesRef.current = particlesRef.current.concat(fresh);
  }, [triggerKey, burstPoint?.x, burstPoint?.y]);

  // Render Layer 0 ambient + step Layer 2 burst particles
  useEffect(() => {
    let rafId = 0;
    let prevNow = performance.now();
    let ambientWall = timeRef.current || 0;

    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - prevNow) / 1000));
      prevNow = now;

      const { width, height, dpr } = sizeRef.current;
      const bgCanvas = bgCanvasRef.current;
      const fxCanvas = fxCanvasRef.current;

      if (bgCanvas) {
        const bgCtx = bgCanvas.getContext("2d");
        if (bgCtx) {
          bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          bgCtx.clearRect(0, 0, width, height);
          const renderTime = Number.isFinite(timeSec)
            ? timeRef.current
            : (ambientWall += isPlayingRef.current ? dt : dt * 0.45);
          renderAmbientLayer(bgCtx, width, height, renderTime, seeds, {
            drawBackground: false,
            gridSize: Math.max(36, Math.round(60 * (width / 1920))),
          });
        }
      }

      if (fxCanvas) {
        const fxCtx = fxCanvas.getContext("2d");
        if (fxCtx) {
          fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          fxCtx.clearRect(0, 0, width, height);
          if (particlesRef.current.length > 0) {
            particlesRef.current = stepSparkleParticles(particlesRef.current, dt);
            if (particlesRef.current.length > 0) {
              renderSparkleBurst(fxCtx, particlesRef.current);
            }
          }
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [seeds, timeSec === undefined]);

  return h(
    React.Fragment,
    null,
    h("canvas", {
      ref: bgCanvasRef,
      className: "particle-layer-ambient",
      "aria-hidden": "true",
    }),
    h("canvas", {
      ref: fxCanvasRef,
      className: "particle-layer-burst",
      "aria-hidden": "true",
    })
  );
}

export default ParticleStage;
