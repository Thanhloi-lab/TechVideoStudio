import React, { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { annotate } from "rough-notation";
import { MOTION_TOKENS, clamp01, easeQuartOut } from "../motion/kernel.mjs";

const h = React.createElement;

function renderPointerSvg() {
  return h(
    "svg",
    {
      width: 24,
      height: 24,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
    },
    h("path", {
      d: "M5 3.2L19.2 12.6L12.7 14.1L15.4 20.1L12.8 21.3L10.1 15.2L5.6 19.3V3.2Z",
      fill: "#FFFFFF",
      stroke: "#020A14",
      strokeWidth: "1.8",
      strokeLinejoin: "round",
    })
  );
}

export function CleanConsoleMockup({ scene, progress }) {
  const data = scene.visual_data || {};
  const steps = data.steps || [];
  const navItems = data.nav_items || [];

  const activeStep = useMemo(() => {
    if (!steps.length) return null;
    return (
      steps.find((s) => progress >= s.progress_start && progress <= s.progress_end) ||
      steps[steps.length - 1] ||
      null
    );
  }, [steps, progress]);

  const stepProgress = activeStep
    ? clamp01(
        (progress - activeStep.progress_start) /
          Math.max(0.01, activeStep.progress_end - activeStep.progress_start)
      )
    : 0;

  const fields = activeStep?.fields || [];
  const hasHighlightedField = fields.some((f) => f.highlight === true);
  const firstHighlightIdx = fields.findIndex((f) => f.highlight === true);

  const tipAccentRef = useRef(null);
  const fieldAccentRef = useRef(null);
  const annotationRef = useRef(null);

  const stepIdentity = `${scene.id || "console"}-${activeStep?.step_number ?? "none"}`;

  useEffect(() => {
    if (annotationRef.current) {
      try {
        annotationRef.current.remove();
      } catch (_) {}
      annotationRef.current = null;
    }

    if (!activeStep) return undefined;

    // Wait for the 220ms Blur-to-Sharp step transition to settle before measuring layout
    const timer = setTimeout(() => {
      const targetEl = activeStep.tip ? tipAccentRef.current : fieldAccentRef.current;
      if (!targetEl) return;

      try {
        const ann = annotate(targetEl, {
          type: activeStep.tip ? "underline" : "box",
          color: activeStep.tip ? MOTION_TOKENS.paletteV2.gold : MOTION_TOKENS.paletteV2.accentCyan,
          strokeWidth: 2,
          padding: activeStep.tip ? 2 : 4,
          iterations: 1,
          animationDuration: 360,
        });
        annotationRef.current = ann;
        ann.show();
      } catch (_) {}
    }, 240);

    return () => {
      clearTimeout(timer);
      if (annotationRef.current) {
        try {
          annotationRef.current.remove();
        } catch (_) {}
        annotationRef.current = null;
      }
    };
  }, [stepIdentity, activeStep?.tip]);

  // Deterministic fake mouse cursor + click ripple near end of each step
  const showCursor = Boolean(activeStep?.primary_button && activeStep?.highlight_button && stepProgress >= 0.56);
  const cursorGlideT = showCursor ? easeQuartOut(clamp01((stepProgress - 0.56) / 0.26)) : 0;
  const cursorOpacity = showCursor ? clamp01((stepProgress - 0.56) / 0.08) : 0;
  const cursorOffsetX = (1 - cursorGlideT) * -108;
  const cursorOffsetY = (1 - cursorGlideT) * -52;

  const isClicking = showCursor && stepProgress >= 0.84;
  const clickT = isClicking ? clamp01((stepProgress - 0.84) / 0.14) : 0;
  const pressDip = isClicking && clickT < 0.35 ? 1 - 0.07 * Math.sin((clickT / 0.35) * Math.PI) : 1;
  const rippleScale = 0.35 + clickT * 2.15;
  const rippleOpacity = isClicking ? Math.max(0, 0.92 * (1 - clickT)) : 0;

  return h(
    "div",
    { className: "scene-stage scene-console" },
    h(
      "div",
      { className: "console-window" },
      // Browser top bar
      h(
        "div",
        { className: "console-topbar" },
        h(
          "div",
          { className: "console-dots" },
          h("span", { className: "dot-r" }),
          h("span", { className: "dot-y" }),
          h("span", { className: "dot-g" })
        ),
        h("div", { className: "console-url" }, "🔒 ", data.url || "console.aws.amazon.com"),
        h(
          "div",
          { className: "console-step-pill" },
          activeStep ? `Bước ${activeStep.step_number}/${steps.length}` : "Console Setup"
        )
      ),

      // Main AWS Console Layout
      h(
        "div",
        { className: "console-body" },
        // Left Nav Rail
        h(
          "div",
          { className: "console-nav" },
          h("div", { className: "console-nav-title" }, data.service_name || "Cloud Console"),
          ...navItems.map((item) =>
            h(
              "div",
              {
                key: item,
                className: `console-nav-item ${item === data.active_nav ? "is-active" : ""}`,
              },
              item
            )
          )
        ),

        // Right Active Step Canvas
        h(
          "div",
          { className: "console-main" },
          // Step stepper bar
          h(
            "div",
            { className: "console-stepper" },
            ...steps.map((st) => {
              const isCurrent = activeStep && st.step_number === activeStep.step_number;
              const isDone = activeStep && st.step_number < activeStep.step_number;
              return h(
                "div",
                {
                  key: st.step_number,
                  className: `stepper-chip ${isCurrent ? "is-current" : ""} ${isDone ? "is-done" : ""}`,
                },
                h("span", { className: "stepper-num" }, isDone ? "✓" : st.step_number),
                h("span", { className: "stepper-label" }, st.heading)
              );
            })
          ),

          h(
            AnimatePresence,
            { mode: "wait", initial: false },
            activeStep
              ? h(
                  motion.div,
                  {
                    key: stepIdentity,
                    className: "console-form-card",
                    initial: { opacity: 0, filter: "blur(8px)", scale: 0.985 },
                    animate: { opacity: 1, filter: "blur(0px)", scale: 1 },
                    exit: { opacity: 0, filter: "blur(8px)", scale: 0.985 },
                    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                  },
                  h("div", { className: "console-form-title" }, activeStep.heading),
                  h(
                    "div",
                    { className: "console-fields" },
                    ...fields.map((field, idx) => {
                      const isSpotlight = field.highlight === true;
                      const isDimmed = hasHighlightedField && !isSpotlight;
                      const attachFieldRef = !activeStep.tip && idx === firstHighlightIdx;

                      return h(
                        "div",
                        {
                          key: idx,
                          ref: attachFieldRef ? fieldAccentRef : undefined,
                          className: `console-field ${isSpotlight ? "is-spotlight viewfinder-frame" : ""} ${isDimmed ? "is-dimmed" : ""}`,
                        },
                        isSpotlight
                          ? [
                              h("span", { key: "tl", className: "vf-bracket vf-tl", "aria-hidden": "true" }),
                              h("span", { key: "tr", className: "vf-bracket vf-tr", "aria-hidden": "true" }),
                              h("span", { key: "bl", className: "vf-bracket vf-bl", "aria-hidden": "true" }),
                              h("span", { key: "br", className: "vf-bracket vf-br", "aria-hidden": "true" }),
                            ]
                          : null,
                        h("div", { className: "console-field-label" }, field.label),
                        field.type === "radio"
                          ? h(
                              "div",
                              { className: "console-radio-group" },
                              ...(field.options || []).map((opt) =>
                                h(
                                  "div",
                                  {
                                    key: opt,
                                    className: `console-radio-opt ${opt === field.selected ? "is-selected" : ""}`,
                                  },
                                  h("span", { className: "radio-circle" }),
                                  h("span", null, opt)
                                )
                              )
                            )
                          : field.type === "checkbox_row"
                            ? h(
                                "div",
                                { className: "console-checkbox-row" },
                                h("span", { className: "check-box" }, "✓"),
                                h("span", { className: "check-value" }, field.value)
                              )
                            : h("div", { className: "console-input-box" }, field.value)
                      );
                    })
                  ),
                  h(
                    "div",
                    { className: "console-footer" },
                    activeStep.tip
                      ? h(
                          "div",
                          { className: "console-tip" },
                          "💡 ",
                          h(
                            "span",
                            {
                              ref: tipAccentRef,
                              className: "console-tip-text",
                            },
                            activeStep.tip
                          )
                        )
                      : h("div"),
                    activeStep.primary_button
                      ? h(
                          "div",
                          {
                            style: {
                              position: "relative",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          },
                          h(
                            "button",
                            {
                              className: `console-btn ${activeStep.highlight_button ? "is-spotlight-btn" : ""}`,
                              type: "button",
                              style: isClicking
                                ? {
                                    transform: `scale(${pressDip})`,
                                    transition: "transform 60ms ease-out",
                                  }
                                : undefined,
                            },
                            activeStep.primary_button
                          ),
                          isClicking
                            ? h("span", {
                                className: "console-click-ripple",
                                "aria-hidden": "true",
                                style: {
                                  left: "50%",
                                  top: "50%",
                                  animation: "none",
                                  transform: `translate(-50%, -50%) scale(${rippleScale})`,
                                  opacity: rippleOpacity,
                                },
                              })
                            : null,
                          showCursor
                            ? h(
                                "span",
                                {
                                  className: "console-cursor-pointer",
                                  "aria-hidden": "true",
                                  style: {
                                    left: "56%",
                                    top: "54%",
                                    opacity: cursorOpacity,
                                    transform: `translate(${cursorOffsetX}px, ${cursorOffsetY}px) scale(${pressDip})`,
                                    transformOrigin: "4px 3px",
                                  },
                                },
                                renderPointerSvg()
                              )
                            : null
                        )
                      : null
                  )
                )
              : null
          )
        )
      )
    )
  );
}
