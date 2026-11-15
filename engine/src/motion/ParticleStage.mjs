import React, { useEffect, useMemo, useRef } from "react";
import {
  createBokehSeeds,
  createSparkleParticles,
  renderAmbientLayer,
  renderSparkleBurst,
  stepSparkleParticles,
} from "./kernel.mjs";

const h = React.createElement;

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
