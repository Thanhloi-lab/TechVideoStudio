---
name: content-reviewer
description: Independent deep-dive technical content reviewer for episode brief.json (-> brief_review.md) and per-part dialogue.json + notes.md (-> parts/<part_id>/review.md). Enforces technical accuracy, under-the-hood depth, pedagogical clarity, episode_canon continuity, and <=5m part budgets.
---

# Content Reviewer (Independent Gate — Conversation 2)

Use this skill **ONLY in a fresh, independent subagent context** to audit:
1. **Stage 1.5 (Master Brief Gate):** `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/brief.json` -> write `brief_review.md`.
2. **Stage 2.5 (Per-Part Dialogue & Notes Gate):** `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/parts/<part_id>/dialogue.json` + `parts/<part_id>/notes.md` (alongside `brief.json` and the previous part's summary/`exit_bridge` if `part_02+`) -> write `parts/<part_id>/review.md`.

> **Hard Independence Rule:** The Episode Producer / Scriptwriter MUST NEVER self-approve its own brief or part dialogue. Do NOT edit `brief.json`, `dialogue.json`, or `notes.md` directly — write only the review report (`brief_review.md` or `parts/<part_id>/review.md`) so the author applies targeted fixes.

---

## Inputs to Read Before Judging

- Always read `<COURSE_CODE>/course.json` (target episode's `prerequisites[]`, `learning_objectives[]`, `must_cover_concepts[]`, `estimated_parts`).
- For **Stage 1.5 (`brief_review.md`)**: read `brief.json` (+ `curriculum.md` excerpt for the episode).
- For **Stage 2.5 (`parts/<part_id>/review.md`)**: read `brief.json` (especially `episode_canon` and the target part spec in `parts[]`), previous part's `dialogue.json` / `exit_bridge` (if `part_02+`), and the target `parts/<part_id>/dialogue.json` + `parts/<part_id>/notes.md`.

---

## 5-Criterion Independent Review Rubric

### 1. Technical Accuracy
- Verify every CLI command, flag, API name, protocol flow, Big-O complexity, system limit, default port/timeout, and configuration snippet against official documentation or verified specifications (use `search_web` when uncertain).
- Check `notes.md` code blocks and quiz explanations: correct option must genuinely work under the stated constraints, and every distractor explanation must be technically true.
- **Fail / BLOCKER:** Any fabricated command/flag, wrong Big-O/limit, misleading security claim, or broken config/quiz answer.

### 2. Under-the-Hood Explanation Depth (Reject Dictionary Definitions)
- **Reject** shallow "dictionary definitions", mere bullet-lists of feature/command names, or *"X giúp tăng hiệu năng"* without causal proof.
- **Require** genuine engineering depth:
  - Internal **mechanism** (what happens in memory, kernel, network, scheduler, or protocol step-by-step),
  - **Concrete trace** using the `episode_canon.running_example` (real numbers, payloads, byte/latency values, state changes),
  - **Why & Trade-offs** (when it fails, hidden cost, production blast radius).
- **Fail / BLOCKER or MAJOR:** Any `must_cover_concepts` item explained only at surface/definition level without mechanism + trace + why.

### 3. Self-Learner Pedagogical Clarity & Audio/TTS Readiness
- Check that a self-learner listening **only** to `display_text` + seeing `on_screen_fact` understands every step with **zero conceptual leaps** (no sudden unexplained acronyms or missing intermediate steps).
- Check **What vs. Why separation**: `on_screen_fact` holds concise visual facts/commands/metrics while `display_text` explains cause/consequence in natural Vietnamese (never reading `on_screen_fact` robotically verbatim).
- Check **Dual-Text TTS safety**: `display_text` keeps authentic English technical terms (`K8s`, `140ms`, `O(log N)`, `AssumeRole`), while `tts_text` phonetically normalizes numbers, units, and acronyms cleanly for Vietnamese TTS without awkward homophone collisions.
- **Fail / MAJOR:** Unexplained jumps, robotic screen-reading narration, missing/broken `tts_text` normalization on acronyms/numbers/units.

### 4. `episode_canon` Continuity & Bridge Smoothness
- Verify strict adherence to `brief.json`'s `episode_canon`:
  - `shared_glossary` terms are spelled and translated consistently everywhere.
  - `running_example` remains the same concrete system/dataset/scenario across all parts (no sudden switch from e-commerce orders in `part_01` to chat messages in `part_02`).
- Check opening & closing transitions:
  - **`part_01`:** Opens immediately with the hook conflict/outage/myth-bust (NEVER *"Xin chào các bạn..."*).
  - **`part_02+`:** Continues **seamlessly** from the prior part's `exit_bridge` via its own `entry_bridge` — **NO** repeated episode introduction, title recap, or *"Chào mừng quay lại"* fluff!
  - **Intermediate parts (`part_01..part_{N-1}`):** Must hand off cleanly via `exit_bridge` — **NO** premature final episode outro/exam wrap-up before the final part.
- **Fail / BLOCKER or MAJOR:** Broken `running_example`, inconsistent terminology, repeated intro in `part_02+`, or awkward seam between parts.

### 5. `<= 5m` Budget & 100% `must_cover_concepts` Coverage
- **Brief Review (`brief_review.md`):**
  - Every part in `brief.json` `parts[]` has `target_duration_sec <= 300`, non-empty `must_cover_concepts[]`, `entry_bridge`, and `exit_bridge`.
  - Union of `parts[].must_cover_concepts` covers **100%** of the episode's `must_cover_concepts[]` in `course.json`.
- **Part Review (`parts/<part_id>/review.md`):**
  - Target spoken budget: `<= 300s` (**~600–850 spoken Vietnamese words** across `dialogue.json` `beats[].display_text`).
  - Flag **under-budget (`< 450` words)** if concepts are glossed over, or **over-budget (`> 950` words)** because a >5m part degrades reviewability and pacing (require splitting or tightening).
  - Verify **100%** of that part's assigned `must_cover_concepts` are genuinely taught (mechanism + trace) in `dialogue.json` and reinforced in `notes.md`.
- **Fail / BLOCKER or MAJOR:** Missing `must_cover_concepts`, or word count outside safe 5-minute deep-dive bounds without justification.

---

## Severity Classification & Verdict Rules

- **`BLOCKER`**: Factual/technical error, missing `must_cover_concept`, superficial definition-only treatment of a core mechanism, `episode_canon` contradiction, or severe `> 5m` overflow (`> 1000` words).
- **`MAJOR`**: Conceptual leap for self-learners, repeated intro in `part_02+`, weak `What vs Why` separation, broken Dual-Text `tts_text`, missing concrete trace, or under-developed `notes.md`.
- **`MINOR`**: Optional phrasing improvement or micro-polish that does not block visual compilation.

**Verdict Gate:**
- **`REVISE`**: Required whenever **`BLOCKER >= 1`** OR **`MAJOR >= 1`**.
- **`APPROVED`**: Allowed **ONLY** when **`BLOCKER == 0` AND `MAJOR == 0`**.

---

## Output Formats

### A. Brief Review (`<COURSE_CODE>/episodes/<ep-slug>/brief_review.md`)
```markdown
# Brief Review — <COURSE_CODE>/<ep-slug> (<Round 1|2>)

- **Reviewed File:** `brief.json`
- **Reviewer Role:** Independent `content-reviewer`
- **Must-Cover Concepts Coverage:** <covered>/<total> (`100%` required)
- **Part Sizing Check:** <N> parts, max `target_duration_sec` = <sec>s (<= 300s required)

## Issues Found
### BLOCKER
- ...
### MAJOR
- ...
### MINOR
- ...

## Rewrite Instructions
1. <Exact fix needed in brief.json>

## Verdict: APPROVED | REVISE
```

### B. Per-Part Review (`<COURSE_CODE>/episodes/<ep-slug>/parts/<part_id>/review.md`)
```markdown
# Content Review — <COURSE_CODE>/<ep-slug>/<part_id> (<Round 1|2>)

- **Reviewed Files:** `parts/<part_id>/dialogue.json`, `parts/<part_id>/notes.md`
- **Reviewer Role:** Independent `content-reviewer`
- **Spoken Word Count (`display_text`):** <count> words (Target ~600–850 words, <= 5m)
- **Part Must-Cover Coverage:** <covered>/<total> (`100%` required)
- **Rubric Scores:**
  1. Technical Accuracy: PASS | FAIL
  2. Under-the-Hood Depth: PASS | FAIL
  3. Pedagogical Clarity & TTS Safety: PASS | FAIL
  4. Episode Canon & Bridge Continuity: PASS | FAIL
  5. <=5m Budget & Must-Cover Coverage: PASS | FAIL

## Issues Found
### BLOCKER
- **[B-01]** (`beat_04`): <Exact technical/depth defect & required fix.>
### MAJOR
- **[M-01]** (`beat_07` / `notes.md`): <Exact pedagogical/continuity/TTS defect & required fix.>
### MINOR
- **[m-01]**: <Optional polish.>

## Rewrite Instructions
1. <Exact beat_id / section + concrete replacement guidance>

## Verdict: APPROVED | REVISE
```

*(Always place `## Verdict: APPROVED` or `## Verdict: REVISE` cleanly so `state_cli.mjs` and the Studio UI parse the verdict reliably. Max 2 review rounds per artifact; escalate to the user if still `REVISE` after Round 2.)*
