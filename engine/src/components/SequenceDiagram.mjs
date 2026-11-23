import React, { useMemo } from "react";
import { motion } from "motion/react";
import { getTone, renderIconSvg } from "../icons.mjs";
import { clamp01, easeQuartOut } from "../motion/kernel.mjs";

const h = React.createElement;

const MSG_STYLE_META = {
  solid: { color: "#10C0F0", badgeBg: "#10C0F0", dashed: false },
  dashed: { color: "#94A3B8", badgeBg: "#CBD5E1", dashed: true },
  danger: { color: "#EF4444", badgeBg: "#EF4444", dashed: false },
  async: { color: "#F59E0B", badgeBg: "#F59E0B", dashed: true },
};

const HL_TONE_META = {
  danger: { border: "#EF4444", bg: "rgba(239, 68, 68, 0.14)", text: "#FECACA", badge: "#EF4444", label: "BOTTLENECK" },
  warn: { border: "#F59E0B", bg: "rgba(245, 158, 11, 0.14)", text: "#FDE68A", badge: "#F59E0B", label: "LƯU Ý" },
  info: { border: "#10C0F0", bg: "rgba(16, 192, 240, 0.14)", text: "#BAE6FD", badge: "#10C0F0", label: "TRỌNG TÂM" },
  success: { border: "#10B981", bg: "rgba(16, 185, 129, 0.14)", text: "#A7F3D0", badge: "#10B981", label: "TỐI ƯU" },
};

export function SequenceDiagram({ scene, progress = 0 }) {
  const p = clamp01(progress);
  const data = scene?.visual_data || {};
  const actors = (Array.isArray(data.actors) ? data.actors : []).slice(0, 5);
  const messages = (Array.isArray(data.messages) ? data.messages : []).slice(0, 10);
  const highlights = (Array.isArray(data.highlights) ? data.highlights : []).slice(0, 4);

  const actorIndexMap = useMemo(
    () => new Map(actors.map((a, idx) => [String(a?.id || ""), idx])),
    [actors]
  );

  const colCount = Math.max(1, actors.length);
  const colCenterPct = (idx) => ((idx + 0.5) / colCount) * 100;

  let activeMsgIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    const ps = Number(messages[i]?.progress_start ?? 0);
    if (p >= ps) activeMsgIdx = i;
  }

  const visibleHighlights = highlights.filter(
    (hl) => p >= Number(hl?.show_at_progress ?? 0.72)
  );
  const activeHighlight = visibleHighlights[visibleHighlights.length - 1] || null;

  return h(
    "div",
    { className: "scene-stage scene-seq" },
    h(
      "div",
      {
        className: "tpl-seq-shell",
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
          className: "tpl-seq-topbar",
          style: { display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 },
        },
        h("span", { className: "tpl-badge-pill" }, data.badge || "Sequence Trace"),
        data.subtitle ? h("span", { className: "tpl-topbar-subtitle" }, data.subtitle) : null
      ),

      h(
        "div",
        {
          className: "tpl-seq-canvas",
          style: {
            position: "relative",
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          },
        },
        // Actors row
        h(
          "div",
          {
            className: "tpl-seq-actors",
            style: {
              display: "grid",
              gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
              gap: "12px",
              flexShrink: 0,
              zIndex: 2,
            },
          },
          ...actors.map((actor, idx) => {
            const tone = getTone(actor?.tone || "blue");
            return h(
              "div",
              {
                key: actor?.id || idx,
                className: "tpl-seq-actor",
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "12px",
                  border: `1.5px solid ${tone.border}`,
                  background: "rgba(9, 17, 34, 0.92)",
                  minWidth: 0,
                },
              },
              h(
                "div",
                {
                  className: "tpl-seq-actor-icon",
                  style: {
                    width: "30px",
                    height: "30px",
                    borderRadius: "8px",
                    background: tone.bg,
                    border: `1px solid ${tone.border}`,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                  },
                },
                renderIconSvg(React, actor?.icon || "ec2", tone.text, 17)
              ),
              h(
                "div",
                { style: { minWidth: 0, flex: 1 } },
                h(
                  "div",
                  {
                    className: "tpl-seq-actor-label",
                    style: {
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#F8FAFC",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    },
                  },
                  actor?.label || actor?.id || `Actor ${idx + 1}`
                ),
                actor?.sublabel
                  ? h(
                      "div",
                      {
                        className: "tpl-seq-actor-sub",
                        style: {
                          fontSize: "11px",
                          fontFamily: "var(--mono)",
                          color: tone.text,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        },
                      },
                      actor.sublabel
                    )
                  : null
              )
            );
          })
        ),

        // Lifelines + Messages area
        h(
          "div",
          {
            style: {
              position: "relative",
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-around",
              padding: "4px 0",
            },
          },
          // Lifelines
          h(
            "div",
            {
              className: "tpl-seq-lifelines",
              "aria-hidden": "true",
              style: {
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                zIndex: 1,
              },
            },
            ...actors.map((a, idx) =>
              h("div", {
                key: a?.id || idx,
                className: "tpl-seq-lifeline",
                style: {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${colCenterPct(idx)}%`,
                  width: "2px",
                  transform: "translateX(-1px)",
                  borderLeft: "2px dashed rgba(148, 163, 184, 0.28)",
                },
              })
            )
          ),

          // Messages rows
          h(
            "div",
            {
              className: "tpl-seq-messages",
              style: {
                position: "relative",
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-evenly",
                height: "100%",
                gap: "4px",
              },
            },
            ...messages.map((m, idx) => {
              const fromIdx = actorIndexMap.get(String(m?.from || "")) ?? 0;
              const toIdx = actorIndexMap.get(String(m?.to || "")) ?? fromIdx;
              const ps = Number(m?.progress_start ?? 0);
              const pe = Math.max(ps + 0.02, Number(m?.progress_end ?? ps + 0.12));
              const visible = p >= ps;
              const revealT = visible ? easeQuartOut(clamp01((p - ps) / Math.min(0.12, Math.max(0.03, (pe - ps) * 0.6)))) : 0;
              const isActive = idx === activeMsgIdx;
              const st = MSG_STYLE_META[m?.style] || MSG_STYLE_META.solid;

              const leftPct = Math.min(colCenterPct(fromIdx), colCenterPct(toIdx));
              const rightPct = Math.max(colCenterPct(fromIdx), colCenterPct(toIdx));
              const isSelf = fromIdx === toIdx;
              const spanPct = isSelf ? 14 : Math.max(8, rightPct - leftPct);
              const boxLeftPct = isSelf ? Math.min(82, colCenterPct(fromIdx)) : leftPct;
              const goingRight = toIdx >= fromIdx;

              return h(
                motion.div,
                {
                  key: m?.id || idx,
                  className: `tpl-seq-msg ${isActive ? "is-active" : ""} ${
                    m?.style === "danger" ? "is-danger" : m?.style === "async" ? "is-async" : ""
                  }`,
                  style: {
                    position: "relative",
                    minHeight: "34px",
                    opacity: visible ? Math.max(0.25, revealT) : 0.12,
                    transform: `translateY(${visible ? ((1 - revealT) * 6).toFixed(1) : 6}px)`,
                  },
                },
                h(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      left: `${boxLeftPct}%`,
                      width: `${spanPct}%`,
                      top: "50%",
                      transform: "translateY(-50%)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "3px",
                    },
                  },
                  h(
                    "div",
                    {
                      className: "tpl-seq-msg-pill",
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "2px 9px",
                        borderRadius: "8px",
                        border: `1.5px solid ${st.color}`,
                        background: isActive ? "rgba(15, 28, 52, 0.98)" : "rgba(9, 17, 34, 0.92)",
                        boxShadow: isActive ? `0 0 14px ${st.color}44` : "none",
                        maxWidth: "100%",
                      },
                    },
                    m?.badge
                      ? h(
                          "span",
                          {
                            style: {
                              fontFamily: "var(--mono)",
                              fontSize: "10px",
                              fontWeight: 800,
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: st.badgeBg,
                              color: "#020A14",
                              flexShrink: 0,
                            },
                          },
                          m.badge
                        )
                      : null,
                    h(
                      "span",
                      {
                        style: {
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#F8FAFC",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        },
                      },
                      m?.label || ""
                    )
                  ),
                  h(
                    "div",
                    {
                      className: "tpl-seq-msg-line",
                      style: {
                        width: "100%",
                        height: "2px",
                        position: "relative",
                        borderTop: `2.5px ${st.dashed ? "dashed" : "solid"} ${st.color}`,
                      },
                    },
                    h("span", {
                      style: {
                        position: "absolute",
                        top: "-6px",
                        ...(goingRight ? { right: "-2px" } : { left: "-2px" }),
                        color: st.color,
                        fontSize: "11px",
                        lineHeight: "10px",
                        fontWeight: 900,
                      },
                    }, isSelf ? "↺" : goingRight ? "▶" : "◀")
                  ),
                  m?.detail
                    ? h(
                        "div",
                        {
                          className: "tpl-seq-msg-detail",
                          style: {
                            fontSize: "10.5px",
                            fontFamily: "var(--mono)",
                            color: "#94A3B8",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          },
                        },
                        m.detail
                      )
                    : null
                )
              );
            })
          )
        )
      ),

      // Highlight banner
      activeHighlight
        ? h(
            "div",
            {
              className: "tpl-seq-highlights",
              style: { flexShrink: 0 },
            },
            (() => {
              const ht = HL_TONE_META[activeHighlight.tone] || HL_TONE_META.info;
              return h(
                "div",
                {
                  className: "tpl-seq-highlight-pill",
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 14px",
                    borderRadius: "10px",
                    border: `1.5px solid ${ht.border}`,
                    background: ht.bg,
                    color: ht.text,
                    fontSize: "13px",
                    fontWeight: 600,
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: "10.5px",
                      fontWeight: 800,
                      padding: "2px 7px",
                      borderRadius: "5px",
                      background: ht.badge,
                      color: "#020A14",
                      flexShrink: 0,
                    },
                  },
                  ht.label
                ),
                h("span", null, activeHighlight.label)
              );
            })()
          )
        : null
    )
  );
}
