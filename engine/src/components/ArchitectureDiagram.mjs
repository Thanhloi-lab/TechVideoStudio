import React, { useEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { getTone, renderIconSvg } from "../icons.mjs";
import {
  MOTION_TOKENS,
  clamp01,
  computeArchitectureLayout,
  computePacketBadgePos,
  easeCubicInOut,
  easeQuartOut,
} from "../motion/kernel.mjs";

const h = React.createElement;

const SVG_W = 1000;
const SVG_H = 560;

/**
 * Compute camera rig target { scale, xPct, yPct } in percentage offsets
 * for a given flow step, supporting explicit flow_step.camera_focus or
 * automatic centroid framing of active_nodes.
 */
function computeStepCameraTarget(step, nodeMap, totalNodesCount) {
  if (!step) {
    return { scale: 1, xPct: 0, yPct: 0 };
  }

  if (step.camera_focus && Number.isFinite(step.camera_focus.x) && Number.isFinite(step.camera_focus.y)) {
    const zoom = Math.min(1.25, Math.max(1.0, Number(step.camera_focus.zoom ?? 1.18)));
    const maxShiftX = ((zoom - 1) / zoom) * 42;
    const maxShiftY = ((zoom - 1) / zoom) * 38;
    const xPct = Math.max(-maxShiftX, Math.min(maxShiftX, (50 - step.camera_focus.x) * 0.55));
    const yPct = Math.max(-maxShiftY, Math.min(maxShiftY, (50 - step.camera_focus.y) * 0.5));
    return { scale: zoom, xPct, yPct };
  }

  const activeIds = step.active_nodes || [];
  const activeNodes = activeIds.map((id) => nodeMap.get(id)).filter(Boolean);
  if (activeNodes.length === 0 || activeNodes.length >= totalNodesCount) {
    return { scale: 1.04, xPct: 0, yPct: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (const n of activeNodes) {
    sumX += n.x;
    sumY += n.y;
  }
  const cx = sumX / activeNodes.length;
  const cy = sumY / activeNodes.length;

  let maxSpread = 0;
  for (const n of activeNodes) {
    maxSpread = Math.max(maxSpread, Math.hypot(n.x - cx, n.y - cy));
  }

  // Tight cluster zooms closer (up to 1.2), wide cluster zooms subtly (1.12)
  const zoom = activeNodes.length === 1
    ? 1.2
    : maxSpread < 24
      ? 1.18
      : maxSpread < 38
        ? 1.14
        : 1.12;

  const maxShiftX = 11;
  const maxShiftY = 8;
  const xPct = Math.max(-maxShiftX, Math.min(maxShiftX, (50 - cx) * 0.28));
  const yPct = Math.max(-maxShiftY, Math.min(maxShiftY, (50 - cy) * 0.24));
  return { scale: zoom, xPct, yPct };
}

export function ArchitectureDiagram({ scene, progress }) {
  const data = scene.visual_data || {};
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const flowSteps = data.flow_steps || [];

  const rigRef = useRef(null);

  const activeStepIdx = useMemo(() => {
    if (!flowSteps.length) return -1;
    const idx = flowSteps.findIndex((s) => progress >= s.progress_start && progress <= s.progress_end);
    return idx >= 0 ? idx : flowSteps.length - 1;
  }, [flowSteps, progress]);

  const activeStep = activeStepIdx >= 0 ? flowSteps[activeStepIdx] : null;
  const prevStep = activeStepIdx > 0 ? flowSteps[activeStepIdx - 1] : null;

  const activeNodeSet = new Set(activeStep?.active_nodes || []);
  const activeEdgeSet = new Set(activeStep?.active_edges || []);

  const layout = useMemo(
    () => computeArchitectureLayout(data, SVG_W, SVG_H),
    [data]
  );

  const nodeMap = useMemo(() => {
    const map = new Map();
    for (const ln of layout.nodes) {
      map.set(ln.id, { ...ln.raw, x: ln.xPct, y: ln.yPct });
    }
    return map;
  }, [layout]);

  const edgeGeometries = useMemo(() => {
    const map = new Map();
    for (const ce of layout.edges) {
      map.set(ce.id, ce);
    }
    return map;
  }, [layout]);

  const stepProgress = activeStep
    ? clamp01(
        (progress - activeStep.progress_start) /
          Math.max(0.01, activeStep.progress_end - activeStep.progress_start)
      )
    : 0;

  // Deterministic Camera Rig interpolation between prevStep and activeStep
  const cameraState = useMemo(() => {
    const fromCam = prevStep
      ? computeStepCameraTarget(prevStep, nodeMap, nodes.length)
      : { scale: 1.0, xPct: 0, yPct: 0 };
    const toCam = computeStepCameraTarget(activeStep, nodeMap, nodes.length);
    const camBlend = activeStep ? easeCubicInOut(clamp01(stepProgress / 0.22)) : 1;
    return {
      scale: fromCam.scale + (toCam.scale - fromCam.scale) * camBlend,
      xPct: fromCam.xPct + (toCam.xPct - fromCam.xPct) * camBlend,
      yPct: fromCam.yPct + (toCam.yPct - fromCam.yPct) * camBlend,
    };
  }, [activeStep, prevStep, nodeMap, nodes.length, stepProgress]);

  useEffect(() => {
    if (!rigRef.current) return;
    gsap.set(rigRef.current, {
      scale: cameraState.scale,
      xPercent: cameraState.xPct,
      yPercent: cameraState.yPct,
      force3D: true,
    });
  }, [cameraState.scale, cameraState.xPct, cameraState.yPct]);

  const { paletteV2 } = MOTION_TOKENS;
  const sceneKey = scene.id || "arch";

  return h(
    "div",
    { className: "scene-stage scene-arch" },
    // Step Callout Banner pinned outside camera rig with Blur-to-Sharp reveal
    activeStep?.badge_text
      ? h(
          "div",
          {
            key: `callout-${sceneKey}-${activeStepIdx}`,
            className: "arch-callout anim-blur-reveal",
          },
          h("span", { className: "arch-callout-dot" }),
          h("span", null, activeStep.badge_text)
        )
      : null,

    // 16:9 Camera Rig Wrapper containing aligned Zones, SVG Edges & Node cards
    h(
      "div",
      {
        ref: rigRef,
        className: "arch-camera-rig",
      },
      h(
        "div",
        {
          style: {
            position: "absolute",
            inset: "18px 22px 68px 22px",
          },
        },
        h(
          "svg",
          {
            className: "arch-svg",
            style: { inset: 0, width: "100%", height: "100%" },
            viewBox: `0 0 ${SVG_W} ${SVG_H}`,
            preserveAspectRatio: "none",
          },
          h(
            "defs",
            null,
            h(
              "filter",
              { id: `arch-glow-${sceneKey}`, x: "-25%", y: "-25%", width: "150%", height: "150%" },
              h("feGaussianBlur", { stdDeviation: "4.5", result: "blur" }),
              h(
                "feMerge",
                null,
                h("feMergeNode", { in: "blur" }),
                h("feMergeNode", { in: "SourceGraphic" })
              )
            ),
            h(
              "marker",
              {
                id: "arrow-muted",
                viewBox: "0 0 10 10",
                refX: "8",
                refY: "5",
                markerWidth: "5.5",
                markerHeight: "5.5",
                orient: "auto-start-reverse",
              },
              h("path", { d: "M 0 1 L 10 5 L 0 9 z", fill: "#64748B" })
            ),
            ...edges.map((edge) => {
              const geom = edgeGeometries.get(edge.id);
              if (!geom) return null;
              const isActive = activeEdgeSet.has(edge.id);
              if (!isActive) return null;
              const drawT = easeQuartOut(clamp01(stepProgress / 0.34));
              return h(
                "mask",
                { key: `mask-${edge.id}`, id: `edge-mask-${sceneKey}-${edge.id}` },
                h("path", {
                  d: geom.svgPathD,
                  fill: "none",
                  stroke: "#FFFFFF",
                  strokeWidth: "46",
                  strokeLinecap: "round",
                  pathLength: 100,
                  strokeDasharray: "100 100",
                  strokeDashoffset: 100 * (1 - drawT),
                })
              );
            })
          ),

          // Layer A: Trust / Network Zones (depth 0 outer -> depth 1 inner)
          ...layout.zones.map((z) =>
            h(
              "g",
              { key: `zone-${z.id}` },
              h("rect", {
                x: z.x,
                y: z.y,
                width: z.w,
                height: z.h,
                rx: z.depth === 0 ? 16 : 12,
                fill: z.depth === 0 ? z.style.fill : z.style.fillNested,
                stroke: z.style.stroke,
                strokeWidth: z.depth === 0 ? 1.5 : 1.25,
                strokeDasharray: z.dashed ? "7 5" : undefined,
              }),
              h("rect", {
                x: z.badgeX,
                y: z.badgeY,
                width: z.badgeW,
                height: z.badgeH,
                rx: 6,
                fill: z.style.badgeBg,
                stroke: z.style.stroke,
                strokeWidth: 1,
              }),
              h(
                "text",
                {
                  x: z.badgeX + 9,
                  y: z.badgeY + z.badgeH * 0.5 + 3.5,
                  fill: z.style.badgeText,
                  fontSize: String(z.badgeFontSize),
                  fontWeight: "700",
                  fontFamily: '"Be Vietnam Pro", Inter, system-ui, sans-serif',
                },
                z.label,
                z.sublabel
                  ? h(
                      "tspan",
                      {
                        fill: z.style.subText,
                        fontWeight: "500",
                        fontSize: String(Math.max(9.5, z.badgeFontSize - 1)),
                      },
                      `  •  ${z.sublabel}`
                    )
                  : null
              )
            )
          ),

          // Layer B: Computed Edges, Labels & Animated Packets
          ...edges.map((edge) => {
            const geom = edgeGeometries.get(edge.id);
            if (!geom) return null;

            const { sx, sy, ex, ey, svgPathD, labelX, labelY, labelW, labelH } = geom;
            const isActive = activeEdgeSet.has(edge.id);
            const isDanger = edge.style === "danger";
            const isDashed = edge.style === "dashed";

            const stroke = isDanger
              ? paletteV2.danger
              : isActive
                ? paletteV2.accentCyan
                : "#475569";
            const auraColor = isDanger
              ? "rgba(239, 68, 68, 0.34)"
              : "rgba(16, 192, 240, 0.32)";
            const packetColor = isDanger ? paletteV2.danger : paletteV2.accentCyan;
            const packetCore = isDanger ? "#FECACA" : "#E0F7FF";

            const drawT = isActive ? easeQuartOut(clamp01(stepProgress / 0.34)) : 1;
            const endTan = geom.tangentAt(1);

            const rawCycle = (stepProgress * 1.45) % 1;
            const pktT = easeQuartOut(rawCycle);
            const showPacket = isActive && pktT <= drawT + 0.04;
            const pktPos = geom.pointAt(pktT);
            const pktTan = geom.tangentAt(pktT);
            const pktBadgePos = showPacket && activeStep?.packet_label
              ? computePacketBadgePos(pktPos, pktTan, geom, { offset: 22, canvasW: SVG_W, canvasH: SVG_H, padX: 54, padYTop: 18, padYBottom: 16 })
              : null;

            const trailOffsets = [0.032, 0.064, 0.098, 0.132];
            const pillW = labelW || (edge.label ? Math.max(88, edge.label.length * 7.2 + 22) : 0);
            const pillH = labelH || 23;

            return h(
              "g",
              { key: edge.id },
              isActive
                ? h("path", {
                    d: svgPathD,
                    fill: "none",
                    stroke: "rgba(148, 163, 184, 0.16)",
                    strokeWidth: "2",
                    strokeDasharray: isDashed ? "8 6" : undefined,
                  })
                : null,

              h(
                "g",
                {
                  mask: isActive ? `url(#edge-mask-${sceneKey}-${edge.id})` : undefined,
                  opacity: isActive ? 1 : 0.64,
                },
                isActive
                  ? h("path", {
                      d: svgPathD,
                      fill: "none",
                      stroke: auraColor,
                      strokeWidth: "11",
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      filter: `url(#arch-glow-${sceneKey})`,
                    })
                  : null,
                h("path", {
                  d: svgPathD,
                  fill: "none",
                  stroke,
                  strokeWidth: isActive ? "3.2" : "2.1",
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  strokeDasharray: isDashed ? "8 6" : undefined,
                  markerEnd: !isActive ? "url(#arrow-muted)" : undefined,
                }),
                isActive
                  ? h("path", {
                      d: "M -9 -5 L 1 0 L -9 5 z",
                      fill: stroke,
                      transform: `translate(${ex}, ${ey}) rotate(${endTan.angleDeg})`,
                      opacity: drawT > 0.82 ? clamp01((drawT - 0.82) / 0.18) : 0,
                    })
                  : null
              ),

              h("circle", {
                cx: sx,
                cy: sy,
                r: isActive ? 4.8 : 3,
                fill: isActive ? packetCore : "#475569",
                stroke: isActive ? stroke : "#1E293B",
                strokeWidth: isActive ? 2 : 1,
              }),
              h("circle", {
                cx: ex,
                cy: ey,
                r: isActive ? 4.8 : 3,
                fill: isActive ? packetCore : "#475569",
                stroke: isActive ? stroke : "#1E293B",
                strokeWidth: isActive ? 2 : 1,
                opacity: isActive ? (drawT > 0.85 ? clamp01((drawT - 0.85) / 0.15) : 0.25) : 0.75,
              }),

              edge.label
                ? h(
                    "g",
                    { transform: `translate(${labelX}, ${labelY})` },
                    h("rect", {
                      x: -pillW / 2,
                      y: -pillH / 2,
                      width: pillW,
                      height: pillH,
                      rx: 7,
                      fill: isActive ? "rgba(6, 12, 26, 0.94)" : "rgba(11, 20, 38, 0.88)",
                      stroke: isActive ? stroke : "rgba(71, 85, 105, 0.7)",
                      strokeWidth: isActive ? "1.4" : "1",
                    }),
                    h(
                      "text",
                      {
                        x: 0,
                        y: 3.5,
                        textAnchor: "middle",
                        fill: isActive ? "#F8FAFC" : "#94A3B8",
                        fontSize: "11.2",
                        fontWeight: isActive ? "700" : "500",
                        fontFamily: '"Be Vietnam Pro", Inter, system-ui, sans-serif',
                      },
                      edge.label
                    )
                  )
                : null,

              showPacket
                ? h(
                    "g",
                    null,
                    ...trailOffsets.map((dt, idx) => {
                      const tt = pktT - dt;
                      if (tt <= 0.01) return null;
                      const tPos = geom.pointAt(tt);
                      const tTan = geom.tangentAt(tt);
                      const fade = Math.max(0.08, 0.56 - idx * 0.13);
                      const w = Math.max(8, 17 - idx * 3);
                      const ht = Math.max(4, 7.5 - idx * 1.1);
                      return h("rect", {
                        key: `trail-${idx}`,
                        x: -w / 2,
                        y: -ht / 2,
                        width: w,
                        height: ht,
                        rx: ht / 2,
                        fill: packetColor,
                        opacity: fade,
                        transform: `translate(${tPos.x}, ${tPos.y}) rotate(${tTan.angleDeg})`,
                      });
                    }),
                    h(
                      "g",
                      { transform: `translate(${pktPos.x}, ${pktPos.y}) rotate(${pktTan.angleDeg})` },
                      h("rect", {
                        x: -15,
                        y: -7.5,
                        width: 30,
                        height: 15,
                        rx: 7.5,
                        fill: auraColor,
                      }),
                      h("rect", {
                        x: -11,
                        y: -4.5,
                        width: 22,
                        height: 9,
                        rx: 4.5,
                        fill: packetColor,
                        stroke: packetCore,
                        strokeWidth: "1.5",
                      })
                    ),
                    pktBadgePos
                      ? h(
                          "g",
                          { transform: `translate(${pktBadgePos.x}, ${pktBadgePos.y})` },
                          h("rect", {
                            x: -Math.max(36, activeStep.packet_label.length * 3.8 + 10),
                            y: -10,
                            width: Math.max(72, activeStep.packet_label.length * 7.6 + 20),
                            height: 18,
                            rx: 9,
                            fill: "rgba(2, 10, 20, 0.92)",
                            stroke: packetColor,
                            strokeWidth: "1",
                          }),
                          h(
                            "text",
                            {
                              x: 0,
                              y: 2.5,
                              textAnchor: "middle",
                              fill: isDanger ? "#FCA5A5" : paletteV2.gold,
                              fontSize: "10.5",
                              fontWeight: "700",
                              fontFamily: '"Be Vietnam Pro", Inter, system-ui, sans-serif',
                            },
                            activeStep.packet_label
                          )
                        )
                      : null
                  )
                : null
            );
          })
        ),

        // Layer C: Node Cards aligned 1:1 with SVG percentage space
        ...layout.nodes.map((ln) => {
          const node = ln.raw;
          const tone = getTone(node.tone);
          const isActive = activeNodeSet.size === 0 || activeNodeSet.has(node.id);
          const isHighlighted = activeNodeSet.has(node.id);
          const rawSvg = typeof node.svg === "string" ? node.svg.trim().replace(/\.svg$/i, "") : "";
          const hasSvgArt = Boolean(rawSvg && /^[a-z0-9_-]+$/i.test(rawSvg));

          return h(
            "div",
            {
              key: node.id,
              className: `arch-node ${hasSvgArt ? "has-svg-art" : ""} ${isHighlighted ? "is-highlighted" : ""} ${!isActive ? "is-dimmed" : ""}`,
              style: {
                left: `${ln.xPct}%`,
                top: `${ln.yPct}%`,
                borderColor: isHighlighted ? tone.border : "rgba(148,163,184,0.24)",
                background: isHighlighted ? tone.bg : "rgba(11, 20, 38, 0.9)",
                boxShadow: isHighlighted
                  ? `0 0 28px ${tone.glow}, 0 10px 28px rgba(2, 10, 20, 0.65)`
                  : "0 8px 24px rgba(0, 0, 0, 0.45)",
              },
            },
            hasSvgArt
              ? h(
                  "div",
                  { className: "arch-node-art" },
                  h("img", {
                    className: "arch-node-art-img",
                    src: `/assets/svg/${rawSvg}.svg`,
                    alt: node.label || node.id,
                    style: {
                      filter: isHighlighted
                        ? `drop-shadow(0 0 12px ${tone.glow}) drop-shadow(0 4px 10px rgba(0, 0, 0, 0.55))`
                        : "drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5))",
                    },
                  })
                )
              : h(
                  "div",
                  {
                    className: "arch-node-icon",
                    style: { backgroundColor: tone.bg, borderColor: tone.border },
                  },
                  renderIconSvg(React, node.icon, tone.text, 28)
                ),
            h("div", { className: "arch-node-label" }, node.label),
            node.sublabel
              ? h("div", { className: "arch-node-sub", style: { color: tone.text } }, node.sublabel)
              : null
          );
        })
      )
    )
  );
}
