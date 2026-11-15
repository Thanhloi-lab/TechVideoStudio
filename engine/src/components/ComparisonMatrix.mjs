import React from "react";
import { motion } from "motion/react";
import { getTone } from "../icons.mjs";
import { computeComparisonMatrixState } from "../motion/kernel.mjs";

const h = React.createElement;

const CELL_STATUS_META = {
  good: { cls: "is-good", icon: "✓", label: "Ưu điểm" },
  best: { cls: "is-good", icon: "★", label: "Tối ưu" },
  warn: { cls: "is-warn", icon: "!", label: "Lưu ý" },
  neutral: { cls: "is-neutral", icon: "•", label: "" },
  bad: { cls: "is-bad", icon: "✕", label: "Rủi ro" },
  risk: { cls: "is-bad", icon: "✕", label: "Rủi ro" },
};

export function ComparisonMatrix({ scene, progress }) {
  const data = scene?.visual_data || {};
  const state = computeComparisonMatrixState(data, progress);
  const { columns, rows, showTakeaway, takeawayReveal, takeaway, badge } = state;

  const colTemplate = `minmax(180px, 1.05fr) repeat(${Math.max(1, columns.length)}, minmax(0, 1.35fr))`;

  return h(
    "div",
    { className: "scene-stage scene-matrix" },
    h(
      "div",
      { className: "tpl-matrix-shell" },
      h(
        "div",
        { className: "tpl-matrix-topbar" },
        h("span", { className: "tpl-badge-pill" }, badge),
        data.title ? h("span", { className: "tpl-topbar-subtitle" }, data.title) : null
      ),

      h(
        "div",
        { className: "tpl-matrix-table", style: { "--matrix-cols": colTemplate } },
        // Column Header Row
        h(
          "div",
          { className: "tpl-matrix-row tpl-matrix-header", style: { gridTemplateColumns: colTemplate } },
          h("div", { className: "tpl-matrix-criterion-head" }, data.criterion_heading || "Tiêu chí so sánh"),
          ...columns.map((col, cIdx) => {
            const tone = getTone(col.tone || (cIdx === columns.length - 1 ? "green" : "blue"));
            return h(
              "div",
              {
                key: col.id || cIdx,
                className: "tpl-matrix-col-head",
                style: {
                  borderColor: tone.border,
                  background: tone.bg,
                },
              },
              h(
                "div",
                { className: "tpl-matrix-col-head-top" },
                h("span", { className: "tpl-matrix-col-title", style: { color: "#F8FAFC" } }, col.title || col.id),
                col.badge
                  ? h(
                      "span",
                      {
                        className: "tpl-matrix-col-badge",
                        style: { background: tone.badge, color: "#020A14" },
                      },
                      col.badge
                    )
                  : null
              ),
              col.subtitle ? h("div", { className: "tpl-matrix-col-sub", style: { color: tone.text } }, col.subtitle) : null
            );
          })
        ),

        // Data Rows
        h(
          "div",
          { className: "tpl-matrix-body" },
          ...rows.map((row) => {
            const blurPx = row.visible ? Math.max(0, (1 - row.revealProgress) * 14) : 14;
            const opacity = row.visible ? Math.max(0.15, row.revealProgress) : 0.14;
            const translateY = row.visible ? (1 - row.revealProgress) * 12 : 12;

            return h(
              motion.div,
              {
                key: row.index,
                className: `tpl-matrix-row tpl-matrix-data-row ${row.active ? "is-spotlight" : ""} ${
                  !row.visible ? "is-pending" : ""
                }`,
                style: {
                  gridTemplateColumns: colTemplate,
                  opacity,
                  filter: `blur(${blurPx.toFixed(1)}px)`,
                  transform: `translateY(${translateY.toFixed(1)}px) ${row.active ? "scale(1.01)" : "scale(1)"}`,
                },
              },
              h("div", { className: "tpl-matrix-criterion-cell" }, row.criterion),
              ...columns.map((col, cIdx) => {
                const cell = row.values?.[col.id] || {};
                const statusMeta = CELL_STATUS_META[cell.status] || CELL_STATUS_META.neutral;
                return h(
                  "div",
                  { key: col.id || cIdx, className: `tpl-matrix-cell ${statusMeta.cls}` },
                  cell.status && cell.status !== "neutral"
                    ? h("span", { className: `tpl-matrix-status-dot ${statusMeta.cls}` }, statusMeta.icon)
                    : null,
                  h("span", { className: "tpl-matrix-cell-text" }, String(cell.text ?? "—"))
                );
              })
            );
          })
        )
      ),

      // Takeaway Footer
      showTakeaway && takeaway?.text
        ? h(
            motion.div,
            {
              className: "tpl-matrix-takeaway",
              initial: { opacity: 0, y: 12, filter: "blur(8px)" },
              animate: {
                opacity: takeawayReveal,
                y: (1 - takeawayReveal) * 10,
                filter: `blur(${((1 - takeawayReveal) * 6).toFixed(1)}px)`,
              },
              transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
            },
            h("span", { className: "tpl-takeaway-label" }, takeaway.label || "💡 Nguyên tắc chốt"),
            h("span", { className: "tpl-takeaway-text" }, takeaway.text)
          )
        : null
    )
  );
}
