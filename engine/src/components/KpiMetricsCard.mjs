import React from "react";
import { motion } from "motion/react";
import { getTone } from "../icons.mjs";
import { computeKpiMetricsState } from "../motion/kernel.mjs";

const h = React.createElement;

function buildSparklinePoints(values, width = 160, height = 42, progress = 1) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal || 1;
  const padY = 5;
  const usableH = height - padY * 2;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - padY - ((v - minVal) / span) * usableH;
    return [x, y];
  });

  // Compute polyline length for smooth progressive stroke reveal
  let totalLen = 0;
  for (let i = 1; i < pts.length; i++) {
    totalLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const pointsAttr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const visibleLen = Math.max(1, totalLen) * Math.max(0, Math.min(1, progress));
  const areaPoints = `${pointsAttr} ${width},${height} 0,${height}`;
  return { pointsAttr, areaPoints, totalLen: Math.max(1, totalLen), visibleLen, lastPt: pts[pts.length - 1] };
}

export function KpiMetricsCard({ scene, progress }) {
  const data = scene?.visual_data || {};
  const state = computeKpiMetricsState(data, progress);
  const { cards, chart, showChart, chartReveal, alertStamp, showStamp, stampScale, stampProgress } = state;

  const gridCols = Math.min(4, Math.max(1, cards.length));
  const maxBarValue = chart?.series?.length
    ? Math.max(1, ...chart.series.map((pt) => Math.max(0, pt.value)))
    : 1;

  return h(
    "div",
    { className: "scene-stage scene-kpi" },
    h(
      "div",
      { className: "tpl-kpi-shell" },
      // Top KPI Cards Grid
      h(
        "div",
        {
          className: "tpl-kpi-grid",
          style: { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` },
        },
        ...cards.map((card) => {
          const tone = getTone(card.tone);
          const deltaTone = getTone(card.deltaTone);
          const opacity = card.visible ? Math.max(0.2, card.revealProgress) : 0.14;
          const blurPx = card.visible ? Math.max(0, (1 - card.revealProgress) * 14) : 10;
          const spark = buildSparklinePoints(card.sparkline, 180, 44, card.sparklineProgress);

          return h(
            motion.div,
            {
              key: card.id,
              className: `tpl-kpi-card ${card.active ? "is-counting" : ""} ${!card.visible ? "is-pending" : ""}`,
              style: {
                borderColor: card.visible ? tone.border : "rgba(148, 163, 184, 0.18)",
                background: card.visible ? "rgba(9, 17, 34, 0.88)" : "rgba(9, 17, 34, 0.45)",
                boxShadow: card.visible ? `0 10px 28px rgba(0,0,0,0.35), 0 0 22px ${tone.bg}` : "none",
                opacity,
                filter: `blur(${blurPx.toFixed(1)}px)`,
              },
            },
            h("div", { className: "tpl-kpi-label" }, card.label),
            h(
              "div",
              { className: "tpl-kpi-value", style: { color: tone.text } },
              card.displayValue
            ),
            card.deltaText
              ? h(
                  "div",
                  {
                    className: "tpl-kpi-delta",
                    style: { background: deltaTone.bg, color: deltaTone.text, borderColor: deltaTone.border },
                  },
                  card.deltaText
                )
              : null,
            spark
              ? h(
                  "svg",
                  { className: "tpl-kpi-spark", viewBox: "0 0 180 44", preserveAspectRatio: "none" },
                  h("polygon", {
                    points: spark.areaPoints,
                    fill: tone.bg,
                    opacity: card.sparklineProgress * 0.65,
                  }),
                  h("polyline", {
                    points: spark.pointsAttr,
                    fill: "none",
                    stroke: tone.border,
                    strokeWidth: "2.5",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    strokeDasharray: `${spark.totalLen}`,
                    strokeDashoffset: `${Math.max(0, spark.totalLen - spark.visibleLen)}`,
                  })
                )
              : null
          );
        })
      ),

      // Optional Bar Chart Section
      chart?.series?.length
        ? h(
            "div",
            {
              className: `tpl-kpi-chart-card ${showChart ? "is-visible" : "is-pending"}`,
              style: {
                opacity: showChart ? chartReveal : 0.12,
                filter: `blur(${showChart ? ((1 - chartReveal) * 8).toFixed(1) : 6}px)`,
              },
            },
            h(
              "div",
              { className: "tpl-kpi-chart-head" },
              h("span", { className: "tpl-kpi-chart-title" }, chart.title || "Biểu đồ xu hướng"),
              chart.unit ? h("span", { className: "tpl-kpi-chart-unit" }, chart.unit) : null
            ),
            h(
              "div",
              { className: "tpl-kpi-bars" },
              ...chart.series.map((pt, idx) => {
                const heightPct = Math.max(4, Math.round((Math.max(0, pt.value) / maxBarValue) * 100 * pt.barRatio));
                return h(
                  "div",
                  { key: idx, className: `tpl-kpi-bar-col ${pt.highlight ? "is-highlight" : ""}` },
                  h(
                    "div",
                    { className: "tpl-kpi-bar-val" },
                    pt.barRatio > 0.15 ? `${Math.round(pt.value * pt.barRatio).toLocaleString("en-US")}` : ""
                  ),
                  h(
                    "div",
                    { className: "tpl-kpi-bar-track" },
                    h("div", {
                      className: `tpl-kpi-bar-fill ${pt.highlight ? "is-highlight" : ""}`,
                      style: { height: `${heightPct}%` },
                    })
                  ),
                  h("div", { className: "tpl-kpi-bar-lbl" }, pt.label)
                );
              })
            )
          )
        : null,

      // Optional Stamp Overlay (stampSpring physics)
      showStamp && alertStamp?.text
        ? h(
            "div",
            {
              className: `tpl-kpi-stamp ${alertStamp.tone === "success" ? "is-success" : "is-danger"}`,
              style: {
                opacity: Math.min(1, stampProgress * 4),
                transform: `rotate(-7deg) scale(${stampScale.toFixed(4)})`,
              },
            },
            alertStamp.text
          )
        : null
    )
  );
}
