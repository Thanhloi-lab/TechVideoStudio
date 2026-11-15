import React from "react";
import { motion } from "motion/react";
import { getTone, renderIconSvg } from "../icons.mjs";
import { computeTimelineFlowState } from "../motion/kernel.mjs";

const h = React.createElement;

export function TimelineFlow({ scene, progress }) {
  const data = scene?.visual_data || {};
  const state = computeTimelineFlowState(data, progress);
  const { orientation, milestones, trackFillRatio, showCallout, callout, calloutReveal } = state;
  const isVertical = orientation === "vertical";

  return h(
    "div",
    { className: `scene-stage scene-timeline ${isVertical ? "is-vertical" : "is-horizontal"}` },
    h(
      "div",
      { className: "tpl-timeline-shell" },
      h(
        "div",
        { className: "tpl-timeline-topbar" },
        h("span", { className: "tpl-badge-pill" }, data.badge || "Chuỗi xử lý theo thời gian"),
        data.subtitle ? h("span", { className: "tpl-topbar-subtitle" }, data.subtitle) : null
      ),

      h(
        "div",
        { className: `tpl-timeline-track-area ${isVertical ? "is-vertical" : "is-horizontal"}` },
        // Track rail behind milestone circles
        h(
          "div",
          { className: "tpl-timeline-rail", "aria-hidden": "true" },
          h("div", {
            className: "tpl-timeline-rail-fill",
            style: isVertical
              ? { height: `${Math.round(trackFillRatio * 100)}%`, width: "100%" }
              : { width: `${Math.round(trackFillRatio * 100)}%`, height: "100%" },
          })
        ),

        h(
          "div",
          {
            className: `tpl-timeline-grid ${isVertical ? "is-vertical" : "is-horizontal"}`,
            style: isVertical
              ? undefined
              : { gridTemplateColumns: `repeat(${Math.max(1, milestones.length)}, minmax(0, 1fr))` },
          },
          ...milestones.map((m) => {
            const tone = getTone(m.tone);
            const opacity = m.started ? Math.max(0.28, m.revealProgress) : 0.22;
            const blurPx = m.started ? Math.max(0, (1 - m.revealProgress) * 12) : 6;
            const scale = m.active ? 1.035 : m.started ? 1 : 0.96;

            return h(
              motion.div,
              {
                key: m.id,
                className: `tpl-timeline-item ${m.active ? "is-active" : ""} ${
                  m.completed ? "is-completed" : ""
                } ${!m.started ? "is-pending" : ""}`,
                style: {
                  opacity,
                  filter: `blur(${blurPx.toFixed(1)}px)`,
                  transform: `scale(${scale})`,
                },
              },
              // Node circle marker on the rail
              h(
                "div",
                {
                  className: `tpl-timeline-marker ${m.active ? "is-active" : ""} ${m.completed ? "is-completed" : ""}`,
                  style: {
                    borderColor: m.active ? "#10C0F0" : m.completed ? "#10B981" : tone.border,
                    background: m.completed
                      ? "rgba(16, 185, 129, 0.22)"
                      : m.active
                        ? "rgba(16, 192, 240, 0.24)"
                        : "rgba(6, 12, 26, 0.94)",
                    boxShadow: m.active ? "0 0 24px rgba(16, 192, 240, 0.48)" : "none",
                  },
                },
                m.completed
                  ? h("span", { className: "tpl-timeline-check" }, "✓")
                  : renderIconSvg(React, m.icon, m.active ? "#90E0F0" : tone.text, 22)
              ),

              // Milestone Card Content
              h(
                "div",
                {
                  className: "tpl-timeline-card",
                  style: {
                    borderColor: m.active ? "#10C0F0" : m.completed ? "rgba(16, 185, 129, 0.55)" : "rgba(148, 163, 184, 0.22)",
                    background: m.active ? "rgba(14, 30, 56, 0.92)" : "rgba(9, 17, 34, 0.80)",
                  },
                },
                h(
                  "div",
                  { className: "tpl-timeline-card-head" },
                  h(
                    "span",
                    {
                      className: "tpl-timeline-step-tag",
                      style: { background: tone.bg, color: tone.text, borderColor: tone.border },
                    },
                    m.timeLabel
                  ),
                  m.metricBadge
                    ? h("span", { className: "tpl-timeline-metric-badge" }, m.metricBadge)
                    : null
                ),
                h("div", { className: "tpl-timeline-title" }, m.title),
                m.description ? h("div", { className: "tpl-timeline-desc" }, m.description) : null
              )
            );
          })
        )
      ),

      showCallout && callout
        ? h(
            motion.div,
            {
              className: "tpl-timeline-callout",
              style: {
                opacity: calloutReveal,
                transform: `translateY(${((1 - calloutReveal) * 10).toFixed(1)}px)`,
              },
            },
            callout.title ? h("span", { className: "tpl-callout-title" }, callout.title) : null,
            callout.text ? h("span", { className: "tpl-callout-text" }, callout.text) : null
          )
        : null
    )
  );
}
