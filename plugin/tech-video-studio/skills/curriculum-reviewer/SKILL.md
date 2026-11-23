---
name: curriculum-reviewer
description: Independent curriculum quality reviewer for {{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json and curriculum.md. Enforces deep-dive coverage, <=5m part sizing, prerequisite DAG integrity, concrete lab/trap depth, and realistic duration budgets before state_cli.mjs init.
---

# Curriculum Reviewer (Independent Gate — Conversation 1)

Use this skill **ONLY in a fresh, independent subagent context** after `curriculum-architect` drafts `{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json` and `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum.md` (and **BEFORE** `state_cli.mjs init`).

> **Hard Independence Rule:** The Curriculum Architect MUST NEVER self-approve its own syllabus. As `curriculum-reviewer`, you evaluate the artifacts cold, verify claims against official docs/specs when uncertain, and write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum_review.md` without modifying `course.json` or `curriculum.md` directly.

---

## Inputs to Read First

1. `{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json`
2. `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum.md`
3. Any existing course references or prior episode notes in `{{WORKSPACE_ROOT}}/<COURSE_CODE>/` (if expanding an existing course).

---

## 5-Criterion Independent Review Rubric

Evaluate every stage and every episode against all 5 criteria below. Cite specific `episode_id`s and exact fields (`estimated_duration_min`, `estimated_parts`, `prerequisites`, `must_cover_concepts`, `learning_objectives`) for every finding.

### 1. Coverage Depth (Zero Missing Core or Production Topics)
- Does the syllabus cover the **entire** target scope (official certification exam blueprint, production lifecycle, failure modes, security, observability, performance/tuning, and trade-offs)?
- Are foundational internals present alongside practical workflows (not just "happy-path quickstarts")?
- Does every episode define concrete `learning_objectives[]` and `must_cover_concepts[]` rather than vague titles?
- **Fail / BLOCKER:** Critical exam domain or essential production topic omitted; episode lacks `must_cover_concepts[]` or `learning_objectives[]`.

### 2. Topic Overload & Part Sizing (`<= 5 minutes` per Part)
- Check `course.json` top-level `course_depth: "deep_dive"` and `max_part_duration_sec: 300`.
- Inspect every episode's `must_cover_concepts[]` and topic breadth against its `estimated_parts`:
  - **Rule:** Each review part MUST target `<= 5 minutes` (`<= 300s`).
  - Flag any episode cramming `>= 2` heavy independent mechanisms into a single part (or squeezing 4+ deep internals into 1–2 parts).
  - Require splitting overloaded episodes into explicit `estimated_parts` (typically 2–5 parts of `<= 5m` each) or splitting into separate episodes if topics represent distinct mental models.
- **Fail / BLOCKER or MAJOR:** Episode packs multiple dense mechanisms without adequate `estimated_parts`, or implies a single `> 5m` undivided review block.

### 3. Prerequisite Chain (Strict Topological Order)
- Inspect `prerequisites[]` and the sequential order of `stages[].episodes[]` from Episode 1 to Episode N.
- Verify **zero forward references**: no episode assumes a CLI, architecture pattern, protocol, or primitive that is only introduced in a *later* episode (unless explicitly listed as an external entry prerequisite of the entire course).
- Verify smooth cognitive progression: mental model -> core mechanism -> configuration/code -> edge cases/production failure.
- **Fail / BLOCKER:** Episode `ep_k` requires understanding a concept taught in `ep_{k+m}`, or references undefined prerequisite IDs.

### 4. Lab & Production Trap Depth (No Vague Hand-Waving)
- Inspect lab/setup plans and exam/production trap specs in `curriculum.md` and `must_cover_concepts[]`.
- **Reject** generic placeholders such as *"Thực hành cấu hình cơ bản"*, *"Tìm hiểu best practices"*, *"Các lỗi thường gặp"*, or *"Demo CLI"*.
- **Require** concrete artifacts: exact CLI commands/subcommands, config keys/YAML/JSON policies, realistic misconfigurations, observable symptoms/error codes (`AccessDenied`, `OOMKilled`, `CrashLoopBackOff`, `Split-Brain`, etc.), and measurable trade-offs.
- **Fail / MAJOR:** Multiple episodes list vague practice/trap descriptions instead of concrete technical failure modes and verifiable commands/configs.

### 5. Duration-to-Depth Realism
- Verify `estimated_duration_min` and `estimated_parts` match the genuine teaching time required to master each topic deeply:
  - Reject superficial `3–5m` total episode budgets when a complex architecture/protocol/lab clearly requires **12–25 minutes across 3–4 parts** to explain *why* and trace *how* under the hood.
  - Conversely, reject inflated `estimated_parts` for trivial concepts padded with filler.
  - Verify `estimated_duration_min <= estimated_parts * 5` (every part stays `<= 5 minutes`) and `estimated_duration_min >= estimated_parts * 3` (no tiny 1-minute stub parts).
- **Fail / MAJOR:** Any episode retains an obsolete `3–5m` cap on a deep mechanism, or violates `3 * estimated_parts <= estimated_duration_min <= 5 * estimated_parts`.

---

## Severity Classification & Verdict Rules

Classify every issue strictly into:
- **`BLOCKER`**: Structural or accuracy flaw that makes the roadmap unusable or unteachable as designed (missing core domain, broken prerequisite chain, missing `must_cover_concepts`, severe overload, obsolete flat 3–5m cap across deep topics).
- **`MAJOR`**: Serious pedagogical or depth gap (vague lab/traps, unrealistic duration-to-parts ratio, missing `course_depth`/`max_part_duration_sec` metadata, weak `must_cover_concepts`).
- **`MINOR`**: Polishing improvement (clearer wording, optional extra comparison note, minor phrasing tweak) that does not block implementation.

**Verdict Gate:**
- **`REVISE`**: Required whenever there is **`>= 1 BLOCKER`** OR **`>= 1 MAJOR`** issue.
- **`APPROVED`**: Allowed **ONLY** when **`BLOCKER == 0` AND `MAJOR == 0`**.

---

## Output Format (`<COURSE_CODE>/curriculum_review.md`)

Write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum_review.md` using this exact structure:

```markdown
# Curriculum Review — <COURSE_CODE> (<Round 1|2>)

- **Reviewed Files:** `course.json`, `curriculum.md`
- **Reviewer Role:** Independent `curriculum-reviewer`
- **Rubric Scores:**
  1. Coverage Depth: PASS | FAIL
  2. Topic Overload & Part Sizing (<=5m/part): PASS | FAIL
  3. Prerequisite Chain: PASS | FAIL
  4. Lab & Production Trap Depth: PASS | FAIL
  5. Duration-to-Depth Realism: PASS | FAIL

## Issues Found

### BLOCKER
- **[B-01]** (`ep04-...` / Stage 2): <Exact problem, evidence from course.json/curriculum.md, and required fix.>

### MAJOR
- **[M-01]** (`ep02-...`): <Exact problem and concrete fix instruction.>

### MINOR
- **[m-01]** (...): <Optional polish suggestion.>

## Fix Instructions for Curriculum Architect
1. <Exact actionable step 1>
2. <Exact actionable step 2>

## Verdict: APPROVED | REVISE
```

*(Note: Always end with `## Verdict: APPROVED` or `## Verdict: REVISE` on its own clear line. Max 2 review iterations; if still `REVISE` after Round 2, halt and present the remaining blockers to the user.)*
