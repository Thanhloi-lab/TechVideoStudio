import React, { useEffect, useRef, useState } from "react";
import { annotate } from "rough-notation";
import { motion, AnimatePresence } from "motion/react";
import { MOTION_TOKENS, clamp01, dampedSpring } from "../motion/kernel.mjs";

const h = React.createElement;

const REVEAL_EASE = [0.16, 1, 0.3, 1];
const STAMP_SPRING = {
  type: "spring",
  stiffness: MOTION_TOKENS.easings.stampSpring.stiffness,
  damping: MOTION_TOKENS.easings.stampSpring.damping,
  mass: MOTION_TOKENS.easings.stampSpring.mass,
};

function ExamComparisonCard({ cmp, revealed, progress, sceneId }) {
  const wrongRef = useRef(null);
  const rightRef = useRef(null);
  const annsRef = useRef([]);

  const start = cmp.progress_start ?? 0;
  // Deterministic spring impact for scrubbed/headless frames right after reveal
  const impactT = revealed ? clamp01((progress - start) / 0.008) : 0;
  const springImpactScale = revealed
    ? dampedSpring(impactT, { ...MOTION_TOKENS.easings.stampSpring, from: 1.28, to: 1.0 })
    : 0.85;

  useEffect(() => {
    for (const ann of annsRef.current) {
      try {
        ann.remove();
      } catch {
        // Ignore stale DOM cleanup errors
      }
    }
    annsRef.current = [];

    if (!revealed) return undefined;

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const created = [];
      try {
        if (wrongRef.current) {
          const strike = annotate(wrongRef.current, {
            type: "strike-through",
            color: "rgba(239, 68, 68, 0.9)",
            strokeWidth: 2,
            iterations: 1,
            animationDuration: 300,
          });
          strike.show();
          created.push(strike);
        }
        if (rightRef.current) {
          const circle = annotate(rightRef.current, {
            type: "circle",
            color: "#10B981",
            strokeWidth: 1.8,
            padding: [2, 6],
            iterations: 1,
            animationDuration: 340,
          });
          circle.show();
          created.push(circle);
        }
      } catch {
        // Ignore annotation errors if element is detached
      }
      annsRef.current = created;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      for (const ann of annsRef.current) {
        try {
          ann.remove();
        } catch {
          // Ignore stale DOM cleanup errors
        }
      }
      annsRef.current = [];
    };
  }, [revealed, sceneId]);

  return h(
    motion.div,
    {
      className: `exam-card ${revealed ? "is-revealed anim-blur-reveal" : "is-hidden"}`,
      initial: { opacity: 0.18, filter: "blur(10px)", scale: 0.94, y: 8 },
      animate: revealed
        ? { opacity: 1, filter: "blur(0px)", scale: 1, y: 0 }
        : { opacity: 0.18, filter: "blur(6px)", scale: 0.96, y: 6 },
      transition: { duration: 0.267, ease: REVEAL_EASE },
    },
    h(
      "div",
      {
        className: "exam-card-title",
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
      },
      h("span", null, cmp.title),
      revealed
        ? h(
            "span",
            {
              style: {
                fontSize: "0.62rem",
                fontWeight: 800,
                letterSpacing: "0.05em",
                padding: "1px 6px",
                borderRadius: "4px",
                background: "rgba(16, 192, 240, 0.14)",
                border: "1px solid rgba(16, 192, 240, 0.45)",
                color: "#90E0F0",
                transform: `scale(${springImpactScale.toFixed(3)})`,
                transformOrigin: "center center",
              },
            },
            "CHECK"
          )
        : null
    ),
    h(
      "div",
      { className: "exam-row exam-wrong" },
      h(
        motion.span,
        {
          className: "exam-icon",
          initial: { scale: 1.45, rotate: -6, opacity: 0 },
          animate: revealed ? { scale: 1, rotate: 0, opacity: 1 } : { scale: 0.85, rotate: 0, opacity: 0.4 },
          transition: STAMP_SPRING,
          style: { display: "inline-flex", alignItems: "center", flexShrink: 0 },
        },
        "❌"
      ),
      h(
        "span",
        null,
        h(
          "strong",
          {
            ref: wrongRef,
            style: { marginRight: "5px", color: "#FCA5A5" },
          },
          "Bẫy:"
        ),
        cmp.wrong
      )
    ),
    h(
      "div",
      { className: "exam-row exam-right" },
      h(
        motion.span,
        {
          className: "exam-icon",
          initial: { scale: 1.45, rotate: 6, opacity: 0 },
          animate: revealed ? { scale: 1, rotate: 0, opacity: 1 } : { scale: 0.85, rotate: 0, opacity: 0.4 },
          transition: { ...STAMP_SPRING, delay: revealed ? 0.08 : 0 },
          style: { display: "inline-flex", alignItems: "center", flexShrink: 0 },
        },
        "✅"
      ),
      h(
        "span",
        null,
        h(
          "strong",
          {
            ref: rightRef,
            style: { marginRight: "6px", color: "#A7F3D0" },
          },
          "Chuẩn:"
        ),
        cmp.right
      )
    )
  );
}

export function ExamTipCard({ scene, progress }) {
  const data = scene?.visual_data || {};
  const comparisons = data.comparisons || [];
  const quiz = data.quiz || null;
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    setSelectedKey(null);
  }, [scene?.id]);

  const showQuiz = Boolean(quiz && progress >= (quiz.show_at_progress ?? 0.68));

  return h(
    "div",
    { className: "scene-stage scene-exam" },
    h(
      "div",
      { className: "exam-header-row" },
      h("span", { className: "exam-badge" }, "🎯 ", data.badge || "DVA-C02 Exam Tips"),
      h("span", { className: "exam-sub" }, "Tránh bẫy đề thi & Chuẩn Production AWS")
    ),

    h(
      "div",
      { className: "exam-grid" },
      ...comparisons.map((cmp, idx) =>
        h(ExamComparisonCard, {
          key: `${scene?.id || "exam"}-${idx}`,
          cmp,
          revealed: progress >= (cmp.progress_start ?? 0),
          progress,
          sceneId: scene?.id,
        })
      )
    ),

    h(
      AnimatePresence,
      { mode: "wait" },
      showQuiz
        ? h(
            motion.div,
            {
              key: `quiz-${scene?.id || "default"}`,
              className: "exam-quiz-box",
              initial: { opacity: 0, filter: "blur(16px)", y: 12, scale: 0.96 },
              animate: { opacity: 1, filter: "blur(0px)", y: 0, scale: 1 },
              exit: { opacity: 0, filter: "blur(12px)", y: 8, scale: 0.97 },
              transition: { duration: 0.267, ease: REVEAL_EASE },
            },
            h("div", { className: "quiz-tag" }, "⚡ CÂU HỎI NHANH DVA-C02 (Bấm chọn đáp án)"),
            h("div", { className: "quiz-question" }, quiz.question),
            h(
              "div",
              { className: "quiz-options" },
              ...(quiz.options || []).map((opt) => {
                const isChosen = selectedKey === opt.key;
                const isCorrect = opt.key === quiz.correct_key;
                let stateClass = "";
                let animState = { opacity: 1, scale: 1, x: 0 };

                if (selectedKey) {
                  if (isCorrect) {
                    stateClass = "is-correct";
                    animState = {
                      scale: [1, 1.03, 1],
                      opacity: 1,
                      boxShadow: "0 0 18px rgba(16, 185, 129, 0.35)",
                    };
                  } else if (isChosen) {
                    stateClass = "is-wrong";
                    animState = {
                      x: [0, -5, 5, -3, 3, 0],
                      opacity: 1,
                      boxShadow: "0 0 14px rgba(239, 68, 68, 0.3)",
                    };
                  } else {
                    animState = { opacity: 0.62, scale: 0.99, x: 0 };
                  }
                }

                return h(
                  motion.button,
                  {
                    key: opt.key,
                    type: "button",
                    className: `quiz-opt-btn ${stateClass}`,
                    onClick: () => setSelectedKey(opt.key),
                    whileHover: { scale: 1.015, y: -1 },
                    whileTap: { scale: 0.985 },
                    animate: animState,
                    transition: { duration: 0.24, ease: REVEAL_EASE },
                  },
                  h("strong", null, `${opt.key}. `),
                  opt.text
                );
              })
            ),
            h(
              AnimatePresence,
              null,
              selectedKey
                ? h(
                    motion.div,
                    {
                      key: `explain-${selectedKey}`,
                      className: "quiz-explain",
                      initial: { opacity: 0, y: 6, filter: "blur(6px)" },
                      animate: { opacity: 1, y: 0, filter: "blur(0px)" },
                      exit: { opacity: 0, y: -4 },
                      transition: { duration: 0.22, ease: REVEAL_EASE },
                    },
                    selectedKey === quiz.correct_key ? "🎉 Chính xác! " : "💡 Giải thích: ",
                    quiz.explanation
                  )
                : null
            )
          )
        : null
    )
  );
}
