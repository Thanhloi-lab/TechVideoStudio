import React from "react";
import { motion } from "motion/react";
import { getTone } from "../icons.mjs";
import { clamp01, easeQuartOut } from "../motion/kernel.mjs";

const h = React.createElement;

const MODE_LABELS = {
  anatomy: "Concept Anatomy",
  decision: "Decision Matrix",
  chapter: "Chapter Overview",
};

export function ConceptBreakdown({ scene, progress = 0 }) {
  const p = clamp01(progress);
  const data = scene?.visual_data || {};
  const mode = MODE_LABELS[data.mode] ? data.mode : "anatomy";
  const core = data.core && typeof data.core === "object" ? data.core : { label: "Core Concept" };
  const branches = (Array.isArray(data.branches) ? data.branches : []).slice(0, 6);
  const takeaway = data.takeaway && data.takeaway.text ? data.takeaway : null;
  const showTakeaway = Boolean(takeaway && p >= Number(takeaway.show_at_progress ?? 0.8));

  const coreTone = getTone(core.tone || "blue");

  let activeBranchIdx = -1;
  for (let i = 0; i < branches.length; i++) {
    if (p >= Number(branches[i]?.progress_start ?? 0)) activeBranchIdx = i;
  }

  return h(
    "div",
    { className: "scene-stage scene-breakdown" },
    h(
      "div",
      {
        className: "tpl-breakdown-shell",
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
          className: "tpl-breakdown-topbar",
          style: { display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 },
        },
        h("span", { className: "tpl-badge-pill" }, data.badge || MODE_LABELS[mode]),
        data.subtitle ? h("span", { className: "tpl-topbar-subtitle" }, data.subtitle) : null
      ),

      h(
        "div",
        {
          style: {
            flex: "1 1 auto",
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(220px, 0.85fr) minmax(0, 1.55fr)",
            gap: "14px",
            alignItems: "center",
          },
        },
        // Central Core Card
        h(
          "div",
          {
            className: "tpl-breakdown-core",
            style: {
              padding: "16px",
              borderRadius: "14px",
              border: `2px solid ${coreTone.border}`,
              background: "linear-gradient(180deg, rgba(14, 28, 56, 0.96) 0%, rgba(9, 17, 34, 0.94) 100%)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              boxShadow: `0 10px 28px rgba(0, 0, 0, 0.38), 0 0 22px ${coreTone.bg}`,
            },
          },
          core.badge
            ? h(
                "span",
                {
                  className: "tpl-breakdown-core-badge",
                  style: {
                    alignSelf: "flex-start",
                    fontFamily: "var(--mono)",
                    fontSize: "10.5px",
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: coreTone.bg,
                    border: `1px solid ${coreTone.border}`,
                    color: coreTone.text,
                  },
                },
                core.badge
              )
            : null,
          h(
            "div",
            {
              className: "tpl-breakdown-core-title",
              style: { fontSize: "17px", fontWeight: 800, color: "#F8FAFC", lineHeight: 1.3 },
            },
            core.label
          ),
          core.sublabel
            ? h(
                "div",
                {
                  className: "tpl-breakdown-core-sub",
                  style: { fontSize: "12.5px", color: "#CBD5E1", lineHeight: 1.4 },
                },
                core.sublabel
              )
            : null,
          core.code_snippet
            ? h(
                "pre",
                {
                  className: "tpl-breakdown-core-code",
                  style: {
                    margin: 0,
                    padding: "8px 10px",
                    borderRadius: "8px",
                    background: "#040812",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    fontFamily: "var(--mono)",
                    fontSize: "11px",
                    lineHeight: 1.4,
                    color: "#90E0F0",
                    overflow: "hidden",
                    whiteSpace: "pre-wrap",
                  },
                },
                core.code_snippet
              )
            : null
        ),

        // Branches Grid
        h(
          "div",
          {
            className: "tpl-breakdown-branches",
            style: {
              display: "grid",
              gridTemplateColumns: branches.length >= 4 ? "repeat(2, minmax(0, 1fr))" : "1fr",
              gap: "10px",
              alignContent: "center",
            },
          },
          ...branches.map((b, idx) => {
            const ps = Number(b?.progress_start ?? 0);
            const visible = p >= ps;
            const revealT = visible ? easeQuartOut(clamp01((p - ps) / 0.12)) : 0;
            const isActive = !showTakeaway && idx === activeBranchIdx;
            const bTone = getTone(b?.tone || "blue");
            const roleLabel = b?.role_badge || (mode === "decision" ? `CASE ${idx + 1}` : mode === "chapter" ? `CH ${idx + 1}` : `0${idx + 1}`);

            return h(
              motion.div,
              {
                key: b?.id || idx,
                className: `tpl-breakdown-branch ${isActive ? "is-active" : ""} ${!visible ? "is-pending" : ""}`,
                style: {
                  padding: "11px 13px",
                  borderRadius: "12px",
                  border: `1.5px solid ${isActive ? bTone.border : "rgba(148, 163, 184, 0.25)"}`,
                  background: isActive ? "rgba(14, 30, 56, 0.94)" : "rgba(9, 17, 34, 0.86)",
                  boxShadow: isActive ? `0 0 18px ${bTone.bg}` : "none",
                  opacity: visible ? Math.max(0.24, revealT) : 0.16,
                  transform: `scale(${isActive ? 1.015 : visible ? 1 : 0.97})`,
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                },
              },
              h(
                "div",
                {
                  className: "tpl-breakdown-branch-head",
                  style: { display: "flex", alignItems: "center", gap: "8px" },
                },
                h(
                  "span",
                  {
                    className: "tpl-breakdown-role-badge",
                    style: {
                      fontFamily: "var(--mono)",
                      fontSize: "10px",
                      fontWeight: 800,
                      padding: "2px 7px",
                      borderRadius: "6px",
                      background: bTone.bg,
                      border: `1px solid ${bTone.border}`,
                      color: bTone.text,
                      flexShrink: 0,
                    },
                  },
                  roleLabel
                ),
                h(
                  "span",
                  {
                    className: "tpl-breakdown-branch-title",
                    style: { fontSize: "13.5px", fontWeight: 700, color: "#F8FAFC" },
                  },
                  b?.label || ""
                )
              ),
              h(
                "div",
                {
                  className: "tpl-breakdown-branch-detail",
                  style: { fontSize: "12px", color: "#CBD5E1", lineHeight: 1.4 },
                },
                b?.detail || ""
              ),
              b?.example
                ? h(
                    "div",
                    {
                      className: "tpl-breakdown-branch-example",
                      style: {
                        alignSelf: "flex-start",
                        fontFamily: "var(--mono)",
                        fontSize: "10.5px",
                        padding: "2px 7px",
                        borderRadius: "5px",
                        background: "rgba(15, 23, 42, 0.85)",
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                        color: "#90E0F0",
                      },
                    },
                    b.example
                  )
                : null
            );
          })
        )
      ),

      showTakeaway
        ? h(
            "div",
            {
              className: "tpl-breakdown-takeaway",
              style: {
                flexShrink: 0,
                padding: "9px 14px",
                borderRadius: "10px",
                background: "rgba(10, 32, 58, 0.94)",
                border: "1.5px solid #10C0F0",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "13px",
              },
            },
            h("span", { className: "tpl-takeaway-label" }, takeaway.label || "💡 Tổng kết"),
            h("span", { className: "tpl-takeaway-text" }, takeaway.text)
          )
        : null
    )
  );
}
