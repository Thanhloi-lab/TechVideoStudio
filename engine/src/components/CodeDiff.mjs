import React, { useEffect, useMemo, useState } from "react";
import { getSingletonHighlighter } from "shiki";
import { clamp01 } from "../motion/kernel.mjs";

const h = React.createElement;

const SHIKI_THEME = "tokyo-night";
const PRELOADED_LANGS = ["json", "python", "bash", "yaml", "javascript", "typescript"];
const LANG_ALIASES = {
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tf: "hcl",
  terraform: "hcl",
};

let diffHighlighterPromise = null;
function getDiffHighlighter() {
  if (!diffHighlighterPromise) {
    diffHighlighterPromise = getSingletonHighlighter({
      themes: [SHIKI_THEME],
      langs: PRELOADED_LANGS,
    }).catch((err) => {
      diffHighlighterPromise = null;
      throw err;
    });
  }
  return diffHighlighterPromise;
}

function normalizeLang(rawLang) {
  const clean = String(rawLang || "json").trim().toLowerCase();
  return LANG_ALIASES[clean] || clean || "json";
}

function toLineArray(val) {
  if (Array.isArray(val)) return val.map((x) => String(x ?? ""));
  if (typeof val === "string") return val.split("\n");
  return [];
}

const STEP_TONE_STYLE = {
  danger: { bar: "#EF4444", bg: "rgba(239, 68, 68, 0.16)", border: "rgba(239, 68, 68, 0.5)" },
  success: { bar: "#10B981", bg: "rgba(16, 185, 129, 0.16)", border: "rgba(16, 185, 129, 0.5)" },
  info: { bar: "#10C0F0", bg: "rgba(16, 192, 240, 0.14)", border: "rgba(16, 192, 240, 0.5)" },
};

export function CodeDiff({ scene, progress = 0 }) {
  const p = clamp01(progress);
  const data = scene?.visual_data || {};
  const lang = normalizeLang(data.language || data.code_language || "json");
  const leftLines = useMemo(() => toLineArray(data.left_lines).slice(0, 16), [data.left_lines]);
  const rightLines = useMemo(() => toLineArray(data.right_lines).slice(0, 16), [data.right_lines]);
  const focusSteps = useMemo(() => (Array.isArray(data.focus_steps) ? data.focus_steps.slice(0, 6) : []), [data.focus_steps]);

  const [tokensState, setTokensState] = useState({ left: null, right: null });
  const leftText = useMemo(() => leftLines.join("\n"), [leftLines]);
  const rightText = useMemo(() => rightLines.join("\n"), [rightLines]);

  useEffect(() => {
    if (!leftText && !rightText) {
      setTokensState({ left: null, right: null });
      return undefined;
    }
    let cancelled = false;
    getDiffHighlighter()
      .then(async (hl) => {
        if (cancelled) return;
        const loaded = hl.getLoadedLanguages ? hl.getLoadedLanguages() : [];
        let resolvedLang = lang;
        if (!loaded.includes(lang)) {
          try {
            await hl.loadLanguage(lang);
          } catch {
            resolvedLang = "text";
          }
        }
        if (cancelled) return;
        const leftTok = leftText ? hl.codeToTokens(leftText, { lang: resolvedLang, theme: SHIKI_THEME })?.tokens : null;
        const rightTok = rightText ? hl.codeToTokens(rightText, { lang: resolvedLang, theme: SHIKI_THEME })?.tokens : null;
        if (!cancelled) setTokensState({ left: leftTok, right: rightTok });
      })
      .catch(() => {
        // Keep plain fallback on load error
      });
    return () => {
      cancelled = true;
    };
  }, [leftText, rightText, lang]);

  const activeStepIdx = useMemo(() => {
    if (!focusSteps.length) return -1;
    let found = -1;
    for (let i = 0; i < focusSteps.length; i++) {
      if (p >= Number(focusSteps[i]?.progress_start ?? 0)) found = i;
    }
    return found >= 0 ? found : 0;
  }, [focusSteps, p]);

  const activeStep = activeStepIdx >= 0 ? focusSteps[activeStepIdx] : null;
  const stepTone = activeStep?.tone || "info";
  const leftFocusSet = useMemo(() => new Set(activeStep?.left_lines || []), [activeStep]);
  const rightFocusSet = useMemo(() => new Set(activeStep?.right_lines || []), [activeStep]);

  const renderPane = (side, badge, title, lines, tokens, focusSet) => {
    const isLeft = side === "left";
    const paneTone = isLeft ? STEP_TONE_STYLE.danger : STEP_TONE_STYLE.success;
    const lineAccent = stepTone === "info" ? paneTone : STEP_TONE_STYLE[stepTone] || paneTone;
    const anyFocused = focusSet.size > 0;
    const glowActive =
      (isLeft && stepTone === "danger") || (!isLeft && stepTone === "success");

    return h(
      "div",
      {
        className: `tpl-diff-pane ${isLeft ? "is-before" : "is-after"}`,
        style: {
          background: "#060C18",
          borderRadius: "10px",
          border: `1.5px solid ${glowActive ? paneTone.bar : "rgba(148, 163, 184, 0.22)"}`,
          boxShadow: glowActive ? `0 0 18px ${paneTone.bg}` : "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        },
      },
      h(
        "div",
        {
          className: "tpl-diff-pane-head",
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            background: "#0F1A2E",
            borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
          },
        },
        h(
          "span",
          {
            className: "tpl-diff-pane-badge",
            style: {
              fontFamily: "var(--mono)",
              fontSize: "10.5px",
              fontWeight: 800,
              padding: "2px 7px",
              borderRadius: "5px",
              background: paneTone.bg,
              border: `1px solid ${paneTone.border}`,
              color: isLeft ? "#FCA5A5" : "#6EE7B7",
              flexShrink: 0,
            },
          },
          badge
        ),
        h(
          "span",
          {
            className: "tpl-diff-pane-title",
            style: {
              fontSize: "12.5px",
              fontWeight: 700,
              color: "#F8FAFC",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          title
        )
      ),
      h(
        "div",
        {
          className: "tpl-diff-body",
          style: {
            padding: "8px 0",
            flex: "1 1 auto",
            overflow: "hidden",
            fontFamily: "var(--mono)",
            fontSize: "11.5px",
            lineHeight: "1.45",
          },
        },
        ...lines.map((line, idx) => {
          const lineNo = idx + 1;
          const isFocused = focusSet.has(lineNo);
          const isDimmed = anyFocused && !isFocused;
          const rowTokens = tokens?.[idx] || null;
          return h(
            "div",
            {
              key: lineNo,
              className: `tpl-diff-line ${isFocused ? "is-focused" : ""} ${isDimmed ? "is-dimmed" : ""}`,
              style: {
                display: "flex",
                alignItems: "baseline",
                padding: "1px 10px 1px 8px",
                whiteSpace: "pre",
                borderLeft: isFocused ? `3px solid ${lineAccent.bar}` : "3px solid transparent",
                background: isFocused ? lineAccent.bg : "transparent",
                opacity: isDimmed ? 0.36 : 1,
                transition: "opacity 0.2s ease, background 0.2s ease",
              },
            },
            h(
              "span",
              {
                className: "tpl-diff-ln",
                style: { width: "24px", flexShrink: 0, textAlign: "right", marginRight: "10px", color: "#64748B", userSelect: "none" },
              },
              lineNo
            ),
            h(
              "span",
              { className: "tpl-diff-code", style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } },
              rowTokens && rowTokens.length
                ? rowTokens.map((tk, ti) =>
                    h(
                      "span",
                      {
                        key: ti,
                        style: {
                          color: tk.color || "#E2E8F0",
                          fontStyle: tk.fontStyle && (tk.fontStyle & 1) ? "italic" : undefined,
                          fontWeight: tk.fontStyle && (tk.fontStyle & 2) ? "700" : undefined,
                        },
                      },
                      tk.content
                    )
                  )
                : line || " "
            )
          );
        })
      )
    );
  };

  return h(
    "div",
    { className: "scene-stage scene-diff" },
    h(
      "div",
      {
        className: "tpl-diff-shell",
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
          className: "tpl-diff-topbar",
          style: { display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 },
        },
        h("span", { className: "tpl-badge-pill" }, data.badge || "Code Diff · Before vs After"),
        data.subtitle ? h("span", { className: "tpl-topbar-subtitle", style: { flex: 1 } }, data.subtitle) : h("span", { style: { flex: 1 } }),
        h(
          "span",
          {
            style: {
              fontFamily: "var(--mono)",
              fontSize: "11.5px",
              fontWeight: 800,
              padding: "3px 9px",
              borderRadius: "6px",
              background: "rgba(42, 98, 255, 0.2)",
              border: "1px solid rgba(16, 192, 240, 0.45)",
              color: "#90E0F0",
            },
          },
          lang.toUpperCase()
        )
      ),

      h(
        "div",
        {
          className: "tpl-diff-grid",
          style: {
            flex: "1 1 auto",
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "12px",
          },
        },
        renderPane("left", data.left_badge || "BEFORE", data.left_title || "Before", leftLines, tokensState.left, leftFocusSet),
        renderPane("right", data.right_badge || "AFTER", data.right_title || "After", rightLines, tokensState.right, rightFocusSet)
      ),

      activeStep
        ? h(
            "div",
            {
              className: "tpl-diff-callout",
              style: {
                flexShrink: 0,
                padding: "9px 14px",
                borderRadius: "10px",
                border: "1.5px solid rgba(16, 192, 240, 0.45)",
                background: "rgba(9, 17, 34, 0.94)",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              },
            },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "10px" } },
              h(
                "span",
                {
                  style: {
                    fontFamily: "var(--mono)",
                    fontSize: "10.5px",
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: "5px",
                    background: "rgba(16, 192, 240, 0.18)",
                    border: "1px solid #10C0F0",
                    color: "#90E0F0",
                    flexShrink: 0,
                  },
                },
                `FOCUS ${activeStepIdx + 1}/${focusSteps.length}`
              ),
              h("span", { style: { fontSize: "13px", fontWeight: 700, color: "#F8FAFC" } }, activeStep.callout)
            ),
            activeStep.consequence || activeStep.fix_reason
              ? h(
                  "div",
                  { className: "tpl-diff-callout-meta", style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
                  activeStep.consequence
                    ? h(
                        "span",
                        {
                          style: {
                            fontSize: "11.5px",
                            padding: "2px 8px",
                            borderRadius: "6px",
                            background: "rgba(239, 68, 68, 0.14)",
                            border: "1px solid rgba(239, 68, 68, 0.42)",
                            color: "#FECACA",
                          },
                        },
                        `⚠ ${activeStep.consequence}`
                      )
                    : null,
                  activeStep.fix_reason
                    ? h(
                        "span",
                        {
                          style: {
                            fontSize: "11.5px",
                            padding: "2px 8px",
                            borderRadius: "6px",
                            background: "rgba(16, 185, 129, 0.14)",
                            border: "1px solid rgba(16, 185, 129, 0.42)",
                            color: "#A7F3D0",
                          },
                        },
                        `✓ ${activeStep.fix_reason}`
                      )
                    : null
                )
              : null
          )
        : null
    )
  );
}
