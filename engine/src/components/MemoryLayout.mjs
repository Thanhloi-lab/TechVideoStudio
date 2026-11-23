import React, { useMemo } from "react";
import { getTone } from "../icons.mjs";
import { clamp01 } from "../motion/kernel.mjs";

const h = React.createElement;

const CELL_STATE_STYLE = {
  idle: { border: "rgba(148, 163, 184, 0.28)", bg: "rgba(15, 23, 42, 0.8)", text: "#F8FAFC" },
  active: { border: "#10C0F0", bg: "rgba(16, 192, 240, 0.18)", text: "#E0F7FF" },
  match: { border: "#10B981", bg: "rgba(16, 185, 129, 0.2)", text: "#D1FAE5" },
  write: { border: "#F59E0B", bg: "rgba(245, 158, 11, 0.2)", text: "#FEF3C7" },
  danger: { border: "#EF4444", bg: "rgba(239, 68, 68, 0.22)", text: "#FECACA" },
};

export function MemoryLayout({ scene, progress = 0 }) {
  const p = clamp01(progress);
  const data = scene?.visual_data || {};
  const lanes = (Array.isArray(data.lanes) ? data.lanes : []).slice(0, 4);
  const steps = (Array.isArray(data.steps) ? data.steps : []).slice(0, 8);

  const activeStepIdx = useMemo(() => {
    if (!steps.length) return -1;
    let found = -1;
    for (let i = 0; i < steps.length; i++) {
      if (p >= Number(steps[i]?.progress_start ?? 0)) found = i;
    }
    return found >= 0 ? found : 0;
  }, [steps, p]);

  const activeStep = activeStepIdx >= 0 ? steps[activeStepIdx] : null;
  const complexityText = activeStep?.complexity || data.complexity_badge || "";

  const activeCellStateMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(activeStep?.highlight_cells)) {
      for (const hc of activeStep.highlight_cells) {
        if (hc?.lane_id && hc?.cell_id) {
          map.set(`${hc.lane_id}::${hc.cell_id}`, hc.state || "active");
        }
      }
    }
    return map;
  }, [activeStep]);

  const activePointers = Array.isArray(activeStep?.pointers) ? activeStep.pointers : [];

  return h(
    "div",
    { className: "scene-stage scene-mem" },
    h(
      "div",
      {
        className: "tpl-mem-shell",
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          minHeight: 0,
        },
      },
      h(
        "div",
        {
          className: "tpl-mem-topbar",
          style: { display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 },
        },
        h("span", { className: "tpl-badge-pill" }, data.badge || "Memory & Data Layout"),
        data.subtitle ? h("span", { className: "tpl-topbar-subtitle", style: { flex: 1 } }, data.subtitle) : h("span", { style: { flex: 1 } }),
        complexityText
          ? h(
              "span",
              {
                className: "tpl-mem-complexity",
                style: {
                  fontFamily: "var(--mono)",
                  fontSize: "12px",
                  fontWeight: 800,
                  padding: "4px 10px",
                  borderRadius: "8px",
                  background: "rgba(16, 192, 240, 0.16)",
                  border: "1px solid rgba(16, 192, 240, 0.45)",
                  color: "#90E0F0",
                  flexShrink: 0,
                },
              },
              complexityText
            )
          : null
      ),

      // Memory Lanes
      h(
        "div",
        {
          className: "tpl-mem-lanes",
          style: {
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "10px",
          },
        },
        ...lanes.map((lane, lIdx) => {
          const lid = String(lane?.id || `lane_${lIdx}`);
          const tone = getTone(lane?.tone || "blue");
          const cells = (Array.isArray(lane?.cells) ? lane.cells : []).slice(0, 8);
          return h(
            "div",
            {
              key: lid,
              className: "tpl-mem-lane",
              style: {
                display: "grid",
                gridTemplateColumns: "180px minmax(0, 1fr)",
                gap: "12px",
                alignItems: "center",
                padding: "10px 14px",
                borderRadius: "12px",
                border: "1.5px solid rgba(148, 163, 184, 0.24)",
                borderLeft: `4px solid ${tone.border}`,
                background: "rgba(9, 17, 34, 0.9)",
              },
            },
            h(
              "div",
              { className: "tpl-mem-lane-head", style: { minWidth: 0 } },
              h(
                "div",
                {
                  className: "tpl-mem-lane-title",
                  style: { fontSize: "13.5px", fontWeight: 700, color: "#F8FAFC" },
                },
                lane?.label || lid
              ),
              lane?.sublabel
                ? h(
                    "div",
                    {
                      className: "tpl-mem-lane-sub",
                      style: { fontSize: "11px", fontFamily: "var(--mono)", color: tone.text, marginTop: "2px" },
                    },
                    lane.sublabel
                  )
                : null
            ),
            h(
              "div",
              {
                className: "tpl-mem-cells",
                style: {
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.max(1, cells.length)}, minmax(0, 1fr))`,
                  gap: "8px",
                },
              },
              ...cells.map((cell, cIdx) => {
                const cid = String(cell?.id || `c_${cIdx}`);
                const stKey = activeCellStateMap.get(`${lid}::${cid}`) || cell?.state || "idle";
                const st = CELL_STATE_STYLE[stKey] || CELL_STATE_STYLE.idle;
                return h(
                  "div",
                  {
                    key: cid,
                    className: `tpl-mem-cell is-${stKey}`,
                    style: {
                      borderRadius: "9px",
                      border: `1.5px solid ${st.border}`,
                      background: st.bg,
                      padding: "7px 8px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "2px",
                      minWidth: 0,
                      transition: "border-color 0.2s ease, background 0.2s ease",
                    },
                  },
                  h(
                    "div",
                    {
                      className: "tpl-mem-cell-lbl",
                      style: { fontSize: "10.5px", fontFamily: "var(--mono)", color: "#94A3B8", fontWeight: 700 },
                    },
                    cell?.label || cid
                  ),
                  cell?.value !== undefined && cell?.value !== null && String(cell.value) !== ""
                    ? h(
                        "div",
                        {
                          className: "tpl-mem-cell-val",
                          style: {
                            fontSize: "14px",
                            fontFamily: "var(--mono)",
                            fontWeight: 800,
                            color: st.text,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          },
                        },
                        String(cell.value)
                      )
                    : null,
                  cell?.subtext
                    ? h(
                        "div",
                        {
                          className: "tpl-mem-cell-sub",
                          style: {
                            fontSize: "10px",
                            fontFamily: "var(--mono)",
                            color: "#CBD5E1",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          },
                        },
                        cell.subtext
                      )
                    : null
                );
              })
            )
          );
        })
      ),

      // Step pointers summary + callout bar
      activeStep
        ? h(
            "div",
            {
              className: "tpl-mem-stepbar",
              style: {
                flexShrink: 0,
                padding: "9px 14px",
                borderRadius: "12px",
                border: "1.5px solid rgba(16, 192, 240, 0.45)",
                background: "rgba(9, 17, 34, 0.94)",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              },
            },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
              h(
                "span",
                {
                  style: {
                    fontFamily: "var(--mono)",
                    fontSize: "11px",
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(16, 192, 240, 0.18)",
                    border: "1px solid #10C0F0",
                    color: "#90E0F0",
                  },
                },
                `BƯỚC ${activeStepIdx + 1}/${steps.length}`
              ),
              h("span", { style: { fontSize: "13.5px", fontWeight: 700, color: "#F8FAFC" } }, activeStep.label),
              ...activePointers.map((ptr, pi) => {
                const ptone = getTone(ptr?.tone || "blue");
                return h(
                  "span",
                  {
                    key: pi,
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: "11px",
                      padding: "2px 7px",
                      borderRadius: "6px",
                      border: `1px solid ${ptone.border}`,
                      background: ptone.bg,
                      color: ptone.text,
                    },
                  },
                  `${ptr.from_cell} → ${ptr.to_cell}${ptr.label ? ` (${ptr.label})` : ""}`
                );
              })
            ),
            activeStep.callout
              ? h("div", { className: "tpl-mem-callout", style: { fontSize: "12.5px", color: "#CBD5E1" } }, activeStep.callout)
              : null
          )
        : null
    )
  );
}
