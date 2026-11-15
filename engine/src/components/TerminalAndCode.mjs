import React, { useEffect, useMemo, useRef, useState } from "react";
import { getSingletonHighlighter } from "shiki";
import { codeToKeyedTokens, createMagicMoveMachine } from "@shikijs/magic-move/core";
import { MagicMoveRenderer } from "@shikijs/magic-move/renderer";
import { annotate } from "rough-notation";
import { motion, AnimatePresence } from "motion/react";
import { clamp01, easeQuartOut } from "../motion/kernel.mjs";

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
};

let highlighterPromise = null;

function getCodeHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: [SHIKI_THEME],
      langs: PRELOADED_LANGS,
    }).catch((err) => {
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

function normalizeLang(rawLang) {
  const clean = String(rawLang || "json").trim().toLowerCase();
  return LANG_ALIASES[clean] || clean || "json";
}

async function ensureHighlighterLang(hl, rawLang) {
  const lang = normalizeLang(rawLang);
  const loaded = hl.getLoadedLanguages ? hl.getLoadedLanguages() : [];
  if (loaded.includes(lang)) return lang;
  try {
    await hl.loadLanguage(lang);
    return lang;
  } catch {
    return "text";
  }
}

function injectMagicMoveStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("shiki-magic-move-v2-css")) return;
  const style = document.createElement("style");
  style.id = "shiki-magic-move-v2-css";
  style.textContent = `
    .shiki-magic-move-container {
      position: relative;
      margin: 0;
      padding: 2px 14px;
      font-family: "JetBrains Mono", Consolas, "Fira Code", monospace;
      font-size: 0.76rem;
      line-height: 1.48;
      white-space: pre;
      background: transparent !important;
    }
    .shiki-magic-move-item {
      display: inline-block;
      transition: color 267ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .shiki-magic-move-line-number {
      color: #64748B;
      user-select: none;
      margin-right: 6px;
    }
    .shiki-magic-move-move {
      transition: transform 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 267ms ease;
    }
    .shiki-magic-move-enter-active,
    .shiki-magic-move-leave-active {
      transition: opacity 267ms cubic-bezier(0.16, 1, 0.3, 1), transform 267ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .shiki-magic-move-enter-from,
    .shiki-magic-move-leave-to {
      opacity: 0;
      transform: translateY(3px);
    }
    .shiki-magic-move-leave-active {
      position: absolute;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

const CALLOUT_KEYWORD_RE =
  /(Explicit Deny|Implicit Deny|Least Privilege|Trust Policy|Permissions Policy|SessionToken|AssumeRole|Access Key|hardcode Key|ARN|s3:GetObject|s3:ListBucket|Statement|Version|Effect|Action|Resource|boto3|IAM Role|DVA-C02)/i;

function splitCalloutHighlight(calloutText, preferredTarget) {
  const text = String(calloutText || "");
  if (!text) return { before: "", target: "", after: "" };

  if (preferredTarget) {
    const idx = text.indexOf(preferredTarget);
    if (idx >= 0) {
      return {
        before: text.slice(0, idx),
        target: text.slice(idx, idx + preferredTarget.length),
        after: text.slice(idx + preferredTarget.length),
      };
    }
  }

  const m = text.match(CALLOUT_KEYWORD_RE);
  if (m && m.index !== undefined) {
    return {
      before: text.slice(0, m.index),
      target: m[0],
      after: text.slice(m.index + m[0].length),
    };
  }

  const colonIdx = text.indexOf(":");
  if (colonIdx > 0 && colonIdx < 32) {
    return {
      before: "",
      target: text.slice(0, colonIdx),
      after: text.slice(colonIdx),
    };
  }

  return { before: "", target: text, after: "" };
}

function getPhaseAccent(phase) {
  if (!phase) {
    return { bar: "#10C0F0", bg: "rgba(16, 192, 240, 0.14)", glow: "rgba(16, 192, 240, 0.28)" };
  }
  if (phase.laser_scan || phase.accent === "danger" || phase.accent === "red") {
    return { bar: "#EF4444", bg: "rgba(239, 68, 68, 0.15)", glow: "rgba(239, 68, 68, 0.34)" };
  }
  if (phase.accent === "amber" || phase.accent === "gold" || phase.accent === "warning") {
    return { bar: "#FF9900", bg: "rgba(255, 153, 0, 0.16)", glow: "rgba(255, 153, 0, 0.32)" };
  }
  return { bar: "#10C0F0", bg: "rgba(16, 192, 240, 0.14)", glow: "rgba(16, 192, 240, 0.28)" };
}

function isErrorCommandOutput(item) {
  if (!item) return false;
  if (item.is_error) return true;
  const lines = item.output_lines || [];
  return lines.some((l) => /AccessDenied|error occurred|failed|denied|Exception|Error:/i.test(String(l)));
}

export function TerminalAndCode({ scene, progress }) {
  const data = scene?.visual_data || {};
  const codeLines = data.code_lines || [];
  const phases = data.highlight_phases || [];
  const terminalCmds = data.terminal_commands || [];
  const hasTerminal = terminalCmds.length > 0;
  const hasCode = codeLines.length > 0 || phases.some((p) => Boolean(p?.code_override));
  const codeLang = data.code_language || "json";

  const activePhaseIdx = useMemo(() => {
    if (!phases.length) return -1;
    const found = phases.findIndex((p) => progress >= p.progress_start && progress <= p.progress_end);
    return found >= 0 ? found : phases.length - 1;
  }, [phases, progress]);

  const activePhase = activePhaseIdx >= 0 ? phases[activePhaseIdx] : null;
  const highlightedLines = useMemo(() => new Set(activePhase?.lines || []), [activePhase]);
  const hasMagicMove = useMemo(() => phases.some((p) => Boolean(p && p.code_override)), [phases]);

  const baseCodeText = useMemo(() => codeLines.join("\n"), [codeLines]);
  const activeMagicCode = useMemo(() => {
    if (!hasMagicMove) return baseCodeText;
    const ov = activePhase?.code_override;
    if (Array.isArray(ov)) return ov.join("\n");
    if (typeof ov === "string") return ov;
    return baseCodeText;
  }, [hasMagicMove, activePhase, baseCodeText]);

  // Lazy Shiki tokenization for standard line-by-line mode (non-blocking fallback while loading)
  const [tokenizedLines, setTokenizedLines] = useState(null);

  useEffect(() => {
    if (!hasCode || hasMagicMove || !baseCodeText) {
      setTokenizedLines(null);
      return undefined;
    }
    let cancelled = false;
    getCodeHighlighter()
      .then(async (hl) => {
        if (cancelled) return;
        const resolvedLang = await ensureHighlighterLang(hl, codeLang);
        if (cancelled) return;
        const res = hl.codeToTokens(baseCodeText, { lang: resolvedLang, theme: SHIKI_THEME });
        if (!cancelled && Array.isArray(res?.tokens)) {
          setTokenizedLines(res.tokens);
        }
      })
      .catch(() => {
        // Keep plain-code fallback cleanly on network/WASM failure
      });
    return () => {
      cancelled = true;
    };
  }, [hasCode, hasMagicMove, baseCodeText, codeLang]);

  // @shikijs/magic-move/core + renderer when highlight_phases items provide code_override
  const magicContainerRef = useRef(null);
  const magicStateRef = useRef({ machine: null, renderer: null, lang: null });
  const [magicReady, setMagicReady] = useState(false);

  useEffect(() => {
    if (!hasMagicMove) {
      setMagicReady(false);
      magicStateRef.current = { machine: null, renderer: null, lang: null };
      return undefined;
    }

    let cancelled = false;
    injectMagicMoveStyles();

    getCodeHighlighter()
      .then(async (hl) => {
        if (cancelled || !magicContainerRef.current) return;
        const resolvedLang = await ensureHighlighterLang(hl, codeLang);
        if (cancelled || !magicContainerRef.current) return;

        let state = magicStateRef.current;
        if (!state.machine || !state.renderer || state.lang !== resolvedLang) {
          magicContainerRef.current.innerHTML = "";
          const machine = createMagicMoveMachine(
            (code, lineNumbers) =>
              codeToKeyedTokens(hl, code, { lang: resolvedLang, theme: SHIKI_THEME }, lineNumbers),
            { lineNumbers: true }
          );
          const renderer = new MagicMoveRenderer(magicContainerRef.current, {
            duration: 380,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            containerStyle: false,
          });
          state = { machine, renderer, lang: resolvedLang };
          magicStateRef.current = state;
        }

        const committed = state.machine.commit(activeMagicCode);
        await state.renderer.render(committed.current);
        if (!cancelled) setMagicReady(true);
      })
      .catch(() => {
        if (!cancelled) setMagicReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasMagicMove, activeMagicCode, codeLang]);

  // Rough Notation annotation on active phase callout keyword (with clean cleanup)
  const calloutTargetRef = useRef(null);
  const annotationRef = useRef(null);

  useEffect(() => {
    if (annotationRef.current) {
      try {
        annotationRef.current.remove();
      } catch {
        // Ignore stale DOM cleanup errors
      }
      annotationRef.current = null;
    }

    if (!activePhase?.callout) return undefined;

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled || !calloutTargetRef.current) return;
      try {
        const ann = annotate(calloutTargetRef.current, {
          type: activePhase.laser_scan ? "box" : "underline",
          color: activePhase.laser_scan ? "#EF4444" : "#F0C040",
          strokeWidth: 2,
          padding: [1, 3],
          iterations: 1,
          animationDuration: 300,
        });
        annotationRef.current = ann;
        ann.show();
      } catch {
        // Ignore annotation errors when offscreen
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (annotationRef.current) {
        try {
          annotationRef.current.remove();
        } catch {
          // Ignore stale DOM cleanup errors
        }
        annotationRef.current = null;
      }
    };
  }, [scene?.id, activePhaseIdx, activePhase?.callout, activePhase?.laser_scan]);

  const phaseAccent = getPhaseAccent(activePhase);
  const laserLineSet = Array.isArray(activePhase?.laser_scan) ? new Set(activePhase.laser_scan) : null;
  const fallbackLines = hasMagicMove ? activeMagicCode.split("\n") : codeLines;
  const calloutParts = splitCalloutHighlight(activePhase?.callout, activePhase?.annotate_text);

  // Determine which terminal commands are visible and whether the latest has completed typing
  const visibleTermEntries = terminalCmds
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => progress >= item.progress_start);
  const lastTermEntry = visibleTermEntries[visibleTermEntries.length - 1] || null;
  const lastTermTypeDur = lastTermEntry ? lastTermEntry.item.type_duration ?? 0.14 : 0.14;
  const lastTermFinished = lastTermEntry
    ? progress - lastTermEntry.item.progress_start >= lastTermTypeDur
    : false;

  return h(
    "div",
    { className: `scene-stage scene-codecli ${hasCode && hasTerminal ? "is-split" : "is-single"}` },
    hasCode
      ? h(
          "div",
          { className: "code-pane" },
          h(
            "div",
            { className: "pane-header" },
            h("span", { className: "pane-badge" }, codeLang.toUpperCase()),
            h("span", { className: "pane-title" }, data.code_title || "policy.json")
          ),
          h(
            "div",
            { className: `code-body ${hasMagicMove && activePhase?.laser_scan ? "laser-scan-wrap" : ""}` },
            hasMagicMove
              ? h("div", {
                  ref: magicContainerRef,
                  className: "magic-move-host",
                  style: { display: magicReady ? "block" : "none" },
                })
              : null,
            hasMagicMove && magicReady && activePhase?.laser_scan
              ? h("span", { className: "laser-scanline", "aria-hidden": "true" })
              : null,
            !hasMagicMove || !magicReady
              ? fallbackLines.map((line, idx) => {
                  const lineNo = idx + 1;
                  const isHighlighted = highlightedLines.has(lineNo);
                  const isDimmed = highlightedLines.size > 0 && !isHighlighted;
                  const lineTokens = tokenizedLines?.[idx] || null;
                  const showLaserOnLine =
                    Boolean(activePhase?.laser_scan) &&
                    (laserLineSet ? laserLineSet.has(lineNo) : isHighlighted);

                  return h(
                    "div",
                    {
                      key: lineNo,
                      className: `code-line ${isHighlighted ? "is-highlighted" : ""} ${
                        isDimmed ? "is-dimmed" : ""
                      } ${showLaserOnLine ? "laser-scan-wrap" : ""}`,
                      style: isHighlighted
                        ? {
                            borderLeft: `3px solid ${phaseAccent.bar}`,
                            background: phaseAccent.bg,
                            boxShadow: `inset 3px 0 14px ${phaseAccent.glow}`,
                          }
                        : isDimmed
                          ? { opacity: 0.35, filter: "blur(0.6px)" }
                          : undefined,
                    },
                    h("span", { className: "code-linenum" }, lineNo),
                    h(
                      "span",
                      { className: "code-text" },
                      lineTokens && lineTokens.length > 0
                        ? lineTokens.map((tok, tIdx) =>
                            h(
                              "span",
                              {
                                key: tIdx,
                                style: {
                                  color: tok.color || "#E2E8F0",
                                  fontStyle: tok.fontStyle && (tok.fontStyle & 1) ? "italic" : undefined,
                                  fontWeight: tok.fontStyle && (tok.fontStyle & 2) ? "700" : undefined,
                                },
                              },
                              tok.content
                            )
                          )
                        : line || " "
                    ),
                    showLaserOnLine
                      ? h("span", { className: "laser-scanline", "aria-hidden": "true" })
                      : null
                  );
                })
              : null
          ),
          h(
            AnimatePresence,
            { mode: "wait" },
            activePhase?.callout
              ? h(
                  motion.div,
                  {
                    key: `callout-${activePhaseIdx}`,
                    className: "code-callout",
                    initial: { opacity: 0, y: 4, filter: "blur(6px)" },
                    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
                    exit: { opacity: 0, y: -3 },
                    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                  },
                  "👉 ",
                  calloutParts.before,
                  calloutParts.target
                    ? h(
                        "span",
                        {
                          ref: calloutTargetRef,
                          style: {
                            color: activePhase?.laser_scan ? "#FCA5A5" : "#F0C040",
                            fontWeight: 800,
                          },
                        },
                        calloutParts.target
                      )
                    : null,
                  calloutParts.after
                )
              : null
          )
        )
      : null,

    hasTerminal
      ? h(
          "div",
          { className: "terminal-pane" },
          h(
            "div",
            { className: "pane-header terminal-header" },
            h("span", { className: "pane-badge term-badge" }, data.terminal_badge || "SANDBOX · CLI"),
            h("span", { className: "pane-title" }, data.terminal_title || "AWS Terminal")
          ),
          h(
            "div",
            { className: "terminal-body" },
            ...visibleTermEntries.map(({ item, idx }) => {
              const elapsed = progress - item.progress_start;
              const typeDur = item.type_duration ?? 0.14;
              const rawRatio = clamp01(elapsed / typeDur);
              const easedRatio = easeQuartOut(rawRatio);
              const visibleCmd = item.command.slice(0, Math.ceil(item.command.length * easedRatio));
              const showOutput = elapsed >= typeDur;
              const outLines = item.output_lines || [];
              const hasError = isErrorCommandOutput(item);
              const outputElapsed = Math.max(0, elapsed - typeDur);
              const lineStagger = Math.min(0.012, 0.05 / Math.max(1, outLines.length));

              return h(
                "div",
                { key: idx, className: "term-block" },
                h(
                  "div",
                  { className: "term-cmd-row" },
                  h("span", { className: "term-prompt" }, "$ "),
                  h("span", { className: "term-cmd" }, visibleCmd),
                  rawRatio < 1
                    ? h("span", {
                        className: "term-cursor cursor-blink-block",
                        "aria-hidden": "true",
                      })
                    : null
                ),
                showOutput
                  ? h(
                      "div",
                      { className: "term-output" },
                      ...outLines.map((outLine, oIdx) => {
                        const lineT = clamp01((outputElapsed - oIdx * lineStagger) / 0.022);
                        const lineEase = easeQuartOut(lineT);
                        return h(
                          "div",
                          {
                            key: oIdx,
                            className: "term-out-line",
                            style: {
                              opacity: lineEase,
                              transform: `translateY(${((1 - lineEase) * 6).toFixed(2)}px)`,
                              color: hasError ? "#FCA5A5" : undefined,
                            },
                          },
                          outLine
                        );
                      }),
                      hasError
                        ? h(
                            "div",
                            {
                              className: "term-hazard-banner hazard-stripes-danger",
                              style: {
                                marginTop: "6px",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                fontSize: "0.7rem",
                                fontWeight: 800,
                                letterSpacing: "0.04em",
                                color: "#FECACA",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              },
                            },
                            h("span", null, "⚠"),
                            h("span", null, "SANDBOX GUARD · ACCESS DENIED / POLICY BLOCKED")
                          )
                        : null
                    )
                  : null
              );
            }),
            !lastTermEntry || lastTermFinished
              ? h(
                  "div",
                  { className: "term-cmd-row", style: { opacity: 0.9 } },
                  h("span", { className: "term-prompt" }, "$ "),
                  h("span", {
                    className: "term-cursor cursor-blink-block",
                    "aria-hidden": "true",
                  })
                )
              : null
          )
        )
      : null
  );
}
