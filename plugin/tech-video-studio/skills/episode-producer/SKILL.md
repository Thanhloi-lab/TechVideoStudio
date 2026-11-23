---
name: episode-producer
description: Produce deep-dive multi-part tutorial episodes (brief.json with episode_canon -> brief_review.md, parts/part_k/dialogue.json + notes.md -> independent content-reviewer gate, optional audio_spine.json with beat reuse, 11-template visual compilation with Visual Variety Guard, set-part / merge-parts, and Vietnamese TTS) in {{WORKSPACE_ROOT}}/<COURSE>/episodes/<ep-slug>.
---

# Episode Producer (Deep-Dive Multi-Part + Independent Review)

Use this skill to author or revise deep-dive multi-part episode scripts (`brief.json` -> `parts/part_01..part_N/*` -> merged `script.json` + `notes.md`) in **Conversation 2 (Script Factory)** and synthesize Vietnamese TTS voiceovers in **Conversation 3 (Video Factory)** inside `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/`.

**Model Allocation:**
- **Scripting, Scene Design & Review (Conv 2):** Use **Gemini 4 Argon** (`gemini-4-argon-high` / `medium`), with automatic fallback to **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`) if Argon quota runs out (brief the user clearly on switch).
- **TTS Execution & Video Pipeline (Conv 3):** Use **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).

> **Hard Anti-Self-Approval Rule:** The Episode Producer (Author) **MUST NEVER self-approve** `brief.json` or any `parts/<part_id>/dialogue.json` + `notes.md`. Every brief and every part MUST pass an independent **`content-reviewer`** subagent running in fresh context before visual compilation or final approval.

---

## Step 0: State Discovery, Revision Queue & Wave Claiming (Conv 2)

Discover live progress and open revision tickets first, then claim a batch wave of **3–5 episodes**:
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> --status open
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" next --course <COURSE_CODE> --stage scripting --limit 5
```
Read `<COURSE_CODE>/course.json` for the episode's `estimated_duration_min`, `estimated_parts`, `prerequisites[]`, `learning_objectives[]`, and `must_cover_concepts[]`. Transition state:
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status planning --owner "<agent>"
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status in_progress --owner "<agent>"
```

---

## Step 1: Master Brief (`brief.json`) + `content-reviewer` Gate (`brief_review.md`)

Author `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/brief.json` (**WITHOUT visual templates, coordinates, CSS, or GSAP**). Decide the number of parts (`part_01` .. `part_N`) so each part stays **`<= 5 minutes` (`target_duration_sec <= 300`)** and 100% of `must_cover_concepts[]` are assigned:

```json
{
  "course_id": "AWS",
  "episode_id": "ep01-iam-core",
  "episode_number": 1,
  "title": "IAM Cốt Lõi: Policy Evaluation Engine, Roles & STS",
  "subtitle": "Hiểu bản chất đánh giá quyền & token tạm thời trong production",
  "hook_angle": {
    "family": "outage_story",
    "conflict_statement": "Vì sao một quyền Allow rõ ràng vẫn trả về AccessDenied lúc 2h sáng?",
    "stakes": "Nhầm thứ tự Explicit Deny hoặc nhúng Access Key tĩnh làm sập service hoặc lộ tài khoản AWS."
  },
  "narrative_arc": {
    "setup": "Developer tưởng có Allow là chạy được nhưng bị SCP/Permission Boundary chặn.",
    "escalation": "Mổ xẻ Decision Tree 5 bước & cơ chế STS AssumeRole cấp credential ngắn hạn.",
    "reversal": "Bẫy Cross-Account Role + Explicit Deny override toàn bộ Allow."
  },
  "episode_canon": {
    "shared_glossary": {
      "STS": "Security Token Service (dịch vụ cấp token tạm thời)",
      "Trust Policy": "Chính sách quyết định AI được phép AssumeRole",
      "Permission Policy": "Chính sách quyết định Role được phép làm GÌ"
    },
    "running_example": "Dịch vụ checkout-api trên ECS cần đọc bucket prod-orders-invoices và ghi DynamoDB orders-table.",
    "target_audience_assumptions": ["Đã biết khái niệm AWS Account và JSON cơ bản"]
  },
  "parts": [
    {
      "part_id": "part_01",
      "title": "Bài toán AccessDenied & Policy Evaluation Engine",
      "target_duration_sec": 260,
      "must_cover_concepts": ["Explicit Deny vs Implicit Deny evaluation precedence"],
      "entry_bridge": "Mở đầu bằng sự cố checkout-api bị AccessDenied dù Policy đã có Allow.",
      "exit_bridge": "Đã hiểu thứ tự Evaluate — nhưng làm sao ECS nhận token động mà không lưu Access Key?",
      "teaching_beats": [
        {
          "id": "beat_01",
          "part": "problem",
          "goal": "Thấy ngay hậu quả thực tế của Explicit Deny vs Allow",
          "key_claim": "Mọi request mặc định bị Implicit Deny; một Explicit Deny duy nhất luôn thắng mọi Allow.",
          "concrete_proof_anchor": "aws iam simulate-principal-policy trả về explicitDeny từ SCP."
        }
      ]
    }
  ]
}
```

**Stage 1.5 Independent Review Gate:**
- Spawn an independent **`content-reviewer`** subagent (fresh context, reading `{{WORKSPACE_ROOT}}/plugin/tech-video-studio/skills/content-reviewer/SKILL.md`) to review `brief.json` and write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/brief_review.md`.
- If `brief_review.md` returns `REVISE`, refine `brief.json` and re-verify (max **2 rounds**) until `APPROVED`.

---

## Step 2: Per-Part Dialogue & Notes (`parts/<part_id>/`) + Independent Review Gate

For each part (`part_01`, `part_02`, ..., `part_N`) sequentially:

1. **Author `parts/<part_id>/dialogue.json` and `parts/<part_id>/notes.md`:**
   - Pass the previous part's summary + `exit_bridge` as handoff context into `part_02+` so narration flows seamlessly via `entry_bridge` **WITHOUT** repeating an episode intro or greeting, and intermediate parts (`part_01..part_{N-1}`) do **NOT** include premature final episode outros.
   - Target **`<= 300s` (~600–850 spoken Vietnamese words)** per part.
   - Enforce **Under-the-Hood Depth** (mechanism + concrete trace on `episode_canon.running_example` + why/trade-off), **What vs. Why separation** (`on_screen_fact` vs `display_text`), and **Dual-Text TTS safety** (`display_text` keeps authentic English spellings like `K8s`, `140ms`, `O(log N)`; `tts_text` holds phonetic Vietnamese safe for TTS).
   - `parts/<part_id>/notes.md` provides part-focused cheat sheet notes, copy-pasteable commands/configs, and scenario quiz items.
   ```json
   {
     "course_id": "AWS",
     "episode_id": "ep01-iam-core",
     "part_id": "part_01",
     "title": "Bài toán AccessDenied & Policy Evaluation Engine",
     "beats": [
       {
         "beat_id": "p01_b01",
         "part": "problem",
         "scene_group": "scene_01_outage",
         "scene_title": "Sự cố 2h sáng: Có Allow vẫn AccessDenied",
         "spoken_purpose": "Đặt xung đột từ sự cố checkout-api",
         "on_screen_fact": "checkout-api -> S3 GetObject -> 403 AccessDenied",
         "display_text": "Lúc 2 giờ sáng, service checkout-api bất ngờ trả 403 AccessDenied dù Policy của Role đã ghi rõ Allow S3 GetObject.",
         "tts_text": "Lúc hai giờ sáng, service checkout A-P-I bất ngờ trả bốn trăm lẻ ba Access Denied dù Policy của Role đã ghi rõ Allow S-3 Get Object.",
         "highlight_words": ["AccessDenied", "Allow", "checkout-api"],
         "cue_hint": "Hiện luồng request bị chặn đỏ tại S3"
       }
     ]
   }
   ```

2. **Stage 2.5 Mandatory Independent Review (`content-reviewer`):**
   - Spawn an independent **`content-reviewer`** subagent (fresh context) to audit `parts/<part_id>/dialogue.json` + `parts/<part_id>/notes.md` against `brief.json` (`episode_canon`, `must_cover_concepts`, bridges) and prior part continuity.
   - Reviewer writes `parts/<part_id>/review.md` ending with `## Verdict: APPROVED` or `## Verdict: REVISE`.
   - Record verdict in part state:
     ```powershell
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set-part --course <COURSE_CODE> --ep <ep-slug> --part <part_id> --status reviewing --ai-verdict APPROVED
     ```
   - If `REVISE`: apply the exact `rewrite_instructions` and send back to a fresh `content-reviewer` subagent (**max 2 loops**; escalate to user if unresolved after Round 2).

---

## Step 3: Optional Audio-Spine -> Visual Compile (`parts/<part_id>/script.json`) Across 11 Templates

### A. Optional Audio-Spine Lock (`--audio-spine`)
Only when `lock_audio_spine === true` (and not paused at `"brief"`, `"part_review"`, or `"dialogue"`) or explicitly requested by the user:
```powershell
{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --audio-spine "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/parts/<part_id>/dialogue.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json" --json
```
This writes `parts/<part_id>/audio_spine.json` and per-beat audio files. Later, when running `tts_pipeline.py --episode .../parts/<part_id>/script.json`, any scene whose `tts_beats` (`beat_id` + `tts_text`) still match `audio_spine.json` **reuses the existing beat audio directly** with zero duplicate TTS synthesis!

### B. Compile `parts/<part_id>/script.json` & Enforce Visual Variety Guard
Preserve the locked spoken wording verbatim (`scene.narration` = joined `display_text`, `scene.tts_beats` = `[{ beat_id, display_text, tts_text }]`). Assign `part` (`"problem" | "architecture" | "setup" | "exam_tips"`), `visual_job` (`"Proof" | "Mechanism" | "Consequence" | "Action" | "Transition"`), `world_theme` (`"dark" | "light"`), `causal_mechanic`, `highlight_words[]`, `sfx_cues[]`, and `cue_sentence` (1-based) + `cue_text` on every step/cue element.

**Mandatory Visual Variety Guard (Checked by `validate-diagrams`):**
1. **No Back-to-Back Repeat:** Never place two consecutive scenes with the same `visual_type` (`scene[i].visual_type !== scene[i-1].visual_type`).
2. **Minimum Variety Per Part:** Use **`>= 3` distinct `visual_type` templates** in every part (`>= 2` only if a tiny part has `<= 2` scenes).
3. **Alternate Light & Dark Worlds + Mechanics:** Mix `world_theme` (`"dark"` vs `"light"`) cleanly across scenes and rotate `causal_mechanic` (`"blur-materialize" | "wire-draw" | "arc-emission" | "width-push" | "squash-drop" | "typographic-strike"`).

### C. Mandatory SVG Asset Check (Before `architecture` Scenes)
1. Inspect `{{WORKSPACE_ROOT}}/engine/assets/svg/catalog.json` or run `node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" svg-list`.
2. If an illustration is missing, author/register `<id>.svg` in `{{WORKSPACE_ROOT}}/engine/assets/svg/` and `catalog.json` before referencing `node.svg` (`validate-diagrams` rejects unknown `node.svg` IDs).

### D. Supported 11 `visual_type` Schemas (SSOT in `engine/src/template_schema.mjs`)

1. **`"architecture"` (`ArchitectureDiagram`)**:
   - `layout_mode`: `"auto"` (recommended; Zero-LLM DAG layout in `kernel.mjs`, `orientation: "LR" | "TB"`, optional `node.tier`, omits manual `x, y`) or `"manual"`.
   - `zones`: `[{ id, label, sublabel?, role: "client"|"network"|"compute"|"security"|"data"|"danger", parent_zone?, node_ids?, x?, y?, w?, h? }]` (max 2 nested levels).
   - `nodes`: `[{ id, label, sublabel?, icon, svg?, tone, x?, y?, tier? }]`.
   - `edges`: `[{ id, from, to, label?, style: "solid"|"dashed"|"danger", routing?: "auto"|"straight"|"orthogonal"|"curved" }]` (use `"curved"` only for bidirectional `A <-> B` or skip-node arcs).
   - `flow_steps`: `[{ progress_start, progress_end, active_nodes[], active_edges[], badge_text?, packet_label?, camera_focus?: { x, y, zoom }, cue_sentence?, cue_text? }]`.

2. **`"console_setup"` (`CleanConsoleMockup`)**:
   - `url?`, `service_name?`, `nav_items?`, `active_nav?`, `steps`: `[{ step_number, progress_start, progress_end, heading, fields: [{ label, type: "text"|"radio"|"checkbox_row", value?, options?, selected?, highlight? }], primary_button?, highlight_button?, tip?, cue_sentence?, cue_text? }]` (1..6 steps, <= 4 fields/step).

3. **`"code_cli"` (`TerminalAndCode`)**:
   - `layout?` (`"split" | "code" | "terminal"`), `code_title?`, `code_language?` (`json | python | yaml | bash | ...`), `code_lines?: string[]` (<= 18 lines).
   - `highlight_phases`: `[{ progress_start, progress_end, lines: number[], callout?, annotate_text?, code_override?: string[]|string, laser_scan?: boolean|number[], accent?, cue_sentence?, cue_text? }]`.
   - `terminal_title?`, `terminal_commands`: `[{ progress_start, command, output_lines?, is_error?, cue_sentence?, cue_text? }]`.

4. **`"exam_tips"` (`ExamTipCard`)**:
   - `badge?`, `comparisons`: `[{ title, wrong, right, progress_start, cue_sentence?, cue_text? }]` (<= 4).
   - `quiz`: `{ question, options: [{ key, text }], correct_key, explanation?, show_at_progress, reveal_at_progress?, tag?, cue_sentence?, cue_text? }`.

5. **`"comparison_matrix"` (`ComparisonMatrix` — 2..4 columns, 1..6 rows)**:
   - `badge?`, `title?`, `criterion_heading?`, `columns`: `[{ id, title, subtitle?, tone?, badge? }]`, `rows`: `[{ criterion, progress_start, values: { [colId]: { text, status?: "good"|"best"|"warn"|"neutral"|"bad"|"risk" } }, cue_sentence?, cue_text? }]`, `takeaway?`: `{ label?, text, show_at_progress, cue_sentence?, cue_text? }`.

6. **`"timeline_flow"` (`TimelineFlow` — 2..6 milestones)**:
   - `orientation?: "horizontal"|"vertical"`, `badge?`, `subtitle?`, `milestones`: `[{ id?, time_label?, title, description?, icon?, tone?, metric_badge?, progress_start, progress_end, cue_sentence?, cue_text? }]`, `callout?`: `{ title?, text, show_at_progress, cue_sentence?, cue_text? }`.

7. **`"kpi_metrics"` (`KpiMetricsCard` — 1..4 cards, optional bar chart <= 8 series)**:
   - `cards`: `[{ id?, label, value?, numeric_target?, prefix?, suffix?, decimals?, delta_text?, delta_tone?, tone?, sparkline?: number[], progress_start, cue_sentence?, cue_text? }]`, `chart?`: `{ title?, type: "bar", show_at_progress, unit?, series: [{ label, value, highlight? }], cue_sentence?, cue_text? }`, `alert_stamp?`: `{ text, tone?: "danger"|"success", show_at_progress, cue_sentence?, cue_text? }`.

8. **`"sequence_diagram"` (`SequenceDiagram` — protocol, RPC, auth & event-loop traces)**:
   - `badge?`, `subtitle?`
   - `actors`: `2..5` lifelines `[{ id, label, sublabel?, icon?, tone? }]`
   - `messages`: `1..10` `[{ id?, from, to, label, detail?, style?: "solid"|"dashed"|"danger"|"async", badge?, progress_start, progress_end, cue_sentence?, cue_text? }]`
   - `highlights?`: `<= 4` `[{ label, from_msg?, to_msg?, tone?: "danger"|"warn"|"info"|"success", show_at_progress, cue_sentence?, cue_text? }]`

9. **`"memory_layout"` (`MemoryLayout` — stack/heap, buffer/cache slots, B-tree pages, hash tables)**:
   - `badge?`, `subtitle?`, `complexity_badge?`
   - `lanes`: `1..4` `[{ id, label, sublabel?, tone?, cells: [{ id, label, value?, subtext?, state?: "idle"|"active"|"match"|"write"|"danger" }] (1..8) }]`
   - `steps`: `1..8` `[{ label, callout?, complexity?, highlight_cells?: [{ lane_id, cell_id, state }], pointers?: [{ from_lane, from_cell, to_lane, to_cell, label?, tone? }], progress_start, progress_end, cue_sentence?, cue_text? }]`

10. **`"code_diff"` (`CodeDiff` — before-vs-after refactor, bug fix, policy hardening with Shiki)**:
    - `badge?`, `subtitle?`, `language?`
    - `left_title?`, `left_badge?`, `left_lines`: `string[]` (`1..16` lines)
    - `right_title?`, `right_badge?`, `right_lines`: `string[]` (`1..16` lines)
    - `focus_steps`: `1..6` `[{ left_lines?: number[], right_lines?: number[], callout, consequence?, fix_reason?, tone?: "danger"|"success"|"info", progress_start, progress_end, cue_sentence?, cue_text? }]`

11. **`"concept_breakdown"` (`ConceptBreakdown` — mental models, anatomy, decision trees, chapter openers)**:
    - `badge?`, `subtitle?`, `mode?: "anatomy" | "decision" | "chapter"`
    - `core`: `{ label, sublabel?, badge?, code_snippet?, tone? }`
    - `branches`: `2..6` `[{ id, label, role_badge?, detail, example?, tone?, progress_start, progress_end, cue_sentence?, cue_text? }]`
    - `takeaway?`: `{ label?, text, show_at_progress }`

*(Run `node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" validate-diagrams --course <COURSE_CODE> --ep <ep-slug>` or inspect [`VISUAL_COMPONENTS.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/VISUAL_COMPONENTS.md) / `engine/src/template_schema.mjs` for exact layout budgets.)*

---

## Step 4: Per-Part User Review, Approval & Deterministic Merge (`merge-parts`)

1. **Preview Each `<= 5m` Part:**
   - Open Storyboard Preview Mode in Studio Player (`http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player`, using the **Part Switcher**), OR run optional part TTS / preview render:
     ```powershell
     {{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --episode "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/parts/part_01/script.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json" --json
     node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --part part_01 --fps 30
     ```
2. **Approve Each Reviewed Part:**
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set-part --course <COURSE_CODE> --ep <ep-slug> --part part_01 --status completed --approved true
   ```
3. **Deterministic Merge into Full Episode (`merge-parts`):**
   Once every part (`part_01..part_N`) has `approved: true`, merge deterministically into the episode root (`script.json`, offset-adjusted `subtitles.srt`, and TOC-indexed `notes.md`):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" merge-parts --course <COURSE_CODE> --ep <ep-slug>
   ```
   *(If parts already had TTS synthesized, `merge-parts` remaps `audio_file` -> `parts/<part_id>/audio/...` and preserves `voice_tracks` so zero TTS re-synthesis is required!)*
4. **Resolve Any Open Revisions & Finalize Scripting State:**
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" resolve-revision --course <COURSE_CODE> --ep <ep-slug> --rev <REV_ID> --note "<what was fixed>"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status completed --note "Multi-part deep-dive script and notes.md approved & merged"
   ```
5. **Strict Scripting vs. Production Separation (`auto_produce`):**
   - Conv 2 MUST stop at `script_ready` (or a `pause_after` gate: `"brief" | "part_review" | "dialogue" | "none"`), **NEVER** auto-running full episode TTS or `render_video.mjs` unless `auto_produce === true` (and never when paused at a gate).
   - Web Studio AI runs use unified **`deep_course`** mode with 5 dynamically routed roles (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair` via `RoleRoutingPanel`).

---

## Step 5: Synthesize Full Audio & Subtitles (Conv 3 — Video Factory)

When an episode is `script_ready` (and if any merged scenes still lack audio or need a new voice track):
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status tts_processing --owner "<agent>"
{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --episode "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/script.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json" --json
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status rendering --tts-done true
```
*(Uses 3-tier voice inheritance: `--profile` CLI > `script.json` > `course.json` > [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json); reuses matching `audio_spine.json` beats with zero duplicate synthesis; preserves existing `voice_tracks` for A/B switching; aligns all 11 visual templates via Layer 1 `_base_timings`.)* Proceed to `video-renderer` (`render_video.mjs`) to render and verify the final video.
