---
name: episode-producer
description: Produce tutorial video episodes (script.json with architecture zones, clean edge routing, V2 motion fields, notes.md, revision queue handling, and Vietnamese TTS audio & subtitles) in {{WORKSPACE_ROOT}}/<COURSE>/episodes/<ep-slug>.
---

# Episode Producer

Use this skill to author or revise episode scripts (`script.json` + `notes.md`) in **Conversation 2 (Script Factory)** and synthesize Vietnamese TTS voiceovers in **Conversation 3 (Video Factory)** inside `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/`.

**Model Allocation:**
- **Scripting, Scene Design & Review (Conv 2):** Use **Gemini 4 Argon** (`gemini-4-argon-high` / `medium`), with automatic fallback to **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`) if Argon quota runs out (brief the user clearly on switch).
- **TTS Execution & Video Pipeline (Conv 3):** Use **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).

## Step 0: State Discovery, Revision Queue & Wave Claiming (Conv 2)

Always discover live progress and open revision tickets first, then claim a batch wave of **3–5 episodes** instead of guessing:
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> --status open
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" next --course <COURSE_CODE> --stage scripting --limit 5
```
Track each episode through `planning` -> `in_progress` -> `reviewing` -> `completed` (`overall_status: "script_ready"`) or `needs_revision`:
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status planning --owner "<agent>"
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status in_progress --owner "<agent>"
```

## Step 1: Author `script.json`

Write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/script.json` matching the exact schema expected by `{{WORKSPACE_ROOT}}/engine/`:

```json
{
  "course_id": "AWS",
  "episode_id": "ep01-iam-core",
  "episode_number": 1,
  "title": "Tiêu đề tập học",
  "subtitle": "Mô tả ngắn gọn",
  "aspect_ratio": "16:9",
  "language": "vi",
  "scenes": [
    {
      "id": "scene_01_hook",
      "part": "problem",
      "part_label": "Phần 1: Bài toán thực tế",
      "title": "Tiêu đề cảnh",
      "visual_type": "architecture",
      "narration": "Lời đọc Tiếng Việt tự nhiên giữ nguyên thuật ngữ Tiếng Anh...",
      "key_points": ["Ý chính 1", "Ý chính 2"],
      "highlight_words": ["Explicit Deny", "SessionToken"],
      "visual_data": {}
    }
  ]
}
```
*(Voice tip: leave `tts_profile`/`tts_voice` omitted in `script.json` to inherit the course default from `<COURSE_CODE>/course.json`, or specify `tts_profile` / `tts_voice` / `tts_rate` only when overriding a single episode. See [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md).)*

### Supported `part` values
- `"problem"` (`Phần 1: Bài toán thực tế`)
- `"architecture"` (`Phần 2: Sơ đồ Kiến trúc & Luồng hoạt động`)
- `"setup"` (`Phần 3: Thực hành Setup & Code`)
- `"exam_tips"` (`Phần 4: Bẫy đề thi & Thực chiến`)

### Optional V2 Motion, Phase 2 Visual/Audio & Dual-Text Fields (`script.json`)
- `scene.highlight_words` (`string[]`): optional extra keywords accented in V2 box-free subtitles alongside default core keywords.
- `scene.visual_job` (`"Proof" | "Mechanism" | "Consequence" | "Action" | "Transition"`): optional editorial job badge rendered as `SharpTag` in the HyperFrames topbar.
- `scene.world_theme` (`"dark" | "light"`): optional dark/light stage background and palette grammar (`"dark"` by default).
- `scene.causal_mechanic` (`"blur-materialize" | "wire-draw" | "arc-emission" | "width-push" | "squash-drop" | "typographic-strike"`): optional deterministic entrance style (rotate across consecutive scenes for visual variety).
- `scene.sfx_cues` (`Array<{ type: "whoosh_short"|"pop"|"click"|"typing_fast"|"impact"|"chime", progress?: 0..1, time_sec?: number, frame_offset?: number, volume?: number }>`): optional explicit SFX cues; when omitted, HyperFrames auto-derives up to 4 cues/scene with `-33ms` lead.
- `bgm_file` (`string`, top-level `script.json` or episode metadata, + optional `bgm_volume`): optional relative path to looping background music bed (automatically vocal-carved at `1800Hz -6dB` and mixed at `-16 LUFS`).
- `scene.tts_narration` (`string`): optional scene-level phonetic Vietnamese TTS string matching `scene.narration` sentences for Dual-Text TTS safety.
- `scene.tts_beats` (`Array<{ beat_id?, display_text, tts_text? }>`): optional per-beat Dual-Text pairs separating exact subtitle/UI spelling (`display_text`) from phonetic TTS phrasing (`tts_text`).
- `flow_step.camera_focus` (`{ x, y, zoom }`): optional explicit 16:9 camera rig pan/zoom (`x`/`y` in `0..100`, `zoom` in `1.0..1.25`) inside `architecture` `flow_steps`.
- `cue_sentence` (`number`, 1-based) & `cue_text` (`string`): attach to every `flow_step`, `milestone`, `card`, `highlight_phase`, `comparison`, `row`, `terminal_command`, `quiz`, `callout`, `takeaway`, `chart`, and `alert_stamp` so `tts_pipeline.py` locks each component to the exact millisecond that sentence begins in real synthesized audio.
  - **Strict Narration-to-Visual Order:** Write `scene.narration` as crisp sentences in the **exact chronological order** of visual steps (`cue_sentence: 1`, `2`, `3`, ...), and never mention a later step's keywords prematurely in the opening sentence if you want keyword fallback to stay clean.
- `highlight_phase.code_override` (`string[] | string`): optional updated code lines for `@shikijs/magic-move` smooth code morphing between phases in `code_cli`.
- `highlight_phase.laser_scan` (`boolean | number[]`): optional red laser scanline sweep and danger emphasis for security vulnerability or error phases in `code_cli`.

### Decoupled 3-Stage Scripting (`mode: "three_stage"`) & Dynamic Per-Role Routing
- Alongside `"auto" | "two_pass" | "single_pass" | "storyboard_only"`, the Studio AI pipeline (`engine/ai/runner.mjs` & `queue_broker.mjs`) supports `mode: "three_stage"`:
  1. **Stage 1 (`brief.json`):** Content Brief (`hook_angle`, `narrative_arc`, `teaching_beats`).
  2. **Stage 2 (`dialogue.json` + `notes.md`):** Spoken Vietnamese beats (`display_text`, phonetic `tts_text`, `on_screen_fact`, `scene_group`).
  3. **Optional Audio-Spine (`audio_spine.json`):** Synthesizes per-beat durations via `tts_pipeline.py --audio-spine <dialogue.json>` **ONLY** when `lock_audio_spine === true` (with `pause_after === "none"`) or explicitly requested by the user.
  4. **Stage 3 (`script.json`):** Visual Director & Motion Compiler expands locked dialogue (+ optional `audio_spine.json`) into the 7 visual templates (`normalizeCompiledScript`) with targeted scene repair (`repairInvalidScenes`).
- **Gates, Resume & Intermediate Review:** `pause_after: "none" | "brief" | "dialogue"` and `start_from: "brief" | "dialogue" | "visual"` let you pause/resume across stages; inspect or edit intermediate files in **`ScriptingStageModal`** (`GET /api/episodes/scripting-artifacts`, `POST /api/episodes/{brief,dialogue,audio-spine}`).
- **Dynamic Per-Role Routing:** Built-in Studio runs route each role via exact backend keys **`outliner`**, **`brief_scriptwriter`**, **`visual_director`**, and **`repair`** (`POST /api/ai/preferences/routing`), configurable dynamically from **`RoleRoutingPanel`** (`BrandHealthGrid` / `AiScriptModal`) with zero hardcoded model defaults.

### Mandatory SVG Illustration Check (Before Authoring `architecture` Scenes)
1. **Always check the rich SVG catalog first:** inspect `{{WORKSPACE_ROOT}}/engine/assets/svg/catalog.json` (or run `node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" svg-list` / inspect `available_svgs` from `studio_get_context`).
2. **If a needed illustration is missing:** Search/fetch an official or open-source dark-theme vector SVG (or author a crisp multi-color `<id>.svg` in `{{WORKSPACE_ROOT}}/engine/assets/svg/`) and register it in `catalog.json` **BEFORE** referencing `svg: "<id>"` in `script.json` (`validate-diagrams` rejects missing `node.svg` assets).
3. Always provide `svg: "<id>"` for prominent multi-color illustration nodes alongside a fallback `icon` (`VALID_ICONS`) for legacy Canvas compatibility.

### Supported `visual_type` schemas

1. **`"architecture"` (`ArchitectureDiagram`)**:
   - `visual_data.layout_mode` (optional): `"auto"` | `"manual"`. Set `layout_mode: "auto"` (or omit `x, y` on nodes) to run Zero-LLM Layered DAG Auto-Layout in `kernel.mjs` (supports `visual_data.orientation`: `"LR"` default or `"TB"`, optional numeric `node.tier`, zone-aware ordering, `[8..92] x [14..84]` bounds, and automatic curved upgrade for bidirectional `routing: "auto"` edges). Supplying finite `x, y` on all nodes with `layout_mode !== "auto"` preserves manual coordinates verbatim.
   - `visual_data.zones`: array of `{ id, label, sublabel?, role?, parent_zone?, node_ids?, x?, y?, w?, h? }`
     - **Max 2 nested levels** via `parent_zone` (e.g. `aws-cloud` -> `vpc-private`).
     - `role`: `"client" | "network" | "compute" | "security" | "data" | "danger"`.
     - Supply `node_ids` for automatic bounding boxes around member nodes, or explicit `x, y, w, h` in `0..100`. Parent zones auto-expand around child zones.
   - `visual_data.nodes`: array of `{ id, label, sublabel, icon, svg?, x?, y?, tier?, tone }`
     - `x`, `y` are percentages `0..100` on the stage canvas (optional when `layout_mode: "auto"`).
     - `svg`: rich SVG asset id from `engine/assets/svg/catalog.json` (e.g. `"server-rack"`, `"redis-stack"`, `"ram-stick"`, `"ssd-disk"`, `"postgres"`). Check/add missing SVGs first!
     - `icon`: fallback `"user" | "iam-user" | "iam-group" | "iam-role" | "iam-policy" | "sts" | "ec2" | "s3" | "lambda" | "apigw" | "dynamodb" | "vpc" | "docker" | "database" | "shield" | "hacker" | "code" | "check" | "deny"`
     - `tone`: `"orange" | "blue" | "green" | "purple" | "red" | "slate"`
   - `visual_data.edges`: array of `{ id, from, to, label, style, routing? }`
     - `style`: `"solid" | "dashed" | "danger"`
     - `routing`: `"auto" | "straight" | "orthogonal" | "curved"` (optional, defaults to `"auto"`).
   - `visual_data.flow_steps`: array of `{ progress_start, progress_end, active_nodes: [...], active_edges: [...], badge_text, packet_label, camera_focus?: { x, y, zoom } }` (`progress_start`/`progress_end` in `0..1`)

   **Strict Architecture Layout & Routing Rules:**
   - Arrange nodes cleanly along **User -> Server -> Cloud** flow (left-to-right or top-to-bottom) with comfortable spacing (`>= 18` horizontal / `>= 22` vertical `%` between adjacent cards).
   - Default to `"auto"` (straight lines for aligned unidirectional pairs; orthogonal rounded-elbow routes otherwise). Use `"curved"` **ONLY** for bidirectional pairs (`A <-> B`) or unavoidable skip-node arcs.
   - Keep `edge.label` and `flow_step.packet_label` concise (2–4 words) so labels never overlap node cards or other edge labels.
   - Scenes with `>= 3` nodes/edges should include `zones[]` to clarify trust/network boundaries.

2. **`"console_setup"` (`CleanConsoleMockup`)**:
   - `visual_data.url`: e.g. `"console.aws.amazon.com/iam/home#/roles/create"`
   - `visual_data.service_name`: e.g. `"IAM > Roles > Create role"`
   - `visual_data.nav_items`: array of strings for left navigation rail
   - `visual_data.active_nav`: string
   - `visual_data.steps`: array of `{ step_number, progress_start, progress_end, heading, fields: [{ label, type, value, options, selected, highlight }], primary_button, highlight_button, tip }`

3. **`"code_cli"` (`TerminalAndCode`)**:
   - `visual_data.layout`: `"split"` (default), `"code"` / `"code_only"`, or `"terminal"`
   - `visual_data.code_title`: filename e.g. `"s3-read-only-policy.json"`
   - `visual_data.code_language`: `"json" | "python" | "yaml" | "bash"`
   - `visual_data.code_lines`: array of strings (each string is one line)
   - `visual_data.highlight_phases`: array of `{ progress_start, progress_end, lines: [1, 2], callout, code_override?, laser_scan? }` (1-based line numbers)
   - `visual_data.terminal_title`: e.g. `"AWS CLI / Production Check"`
   - `visual_data.terminal_commands`: array of `{ progress_start, command, output_lines: [...] }`

4. **`"exam_tips"` (`ExamTipCard`)**:
   - `visual_data.badge`: e.g. `"DVA-C02 Exam Mastery"`
   - `visual_data.comparisons`: array of `{ title, wrong, right, progress_start }`
   - `visual_data.quiz`: `{ question, options: [{ key, text }], correct_key, explanation, show_at_progress }`

5. **`"comparison_matrix"` (`ComparisonMatrix` — max 4 columns, max 6 rows)**:
   - `visual_data.badge`, `visual_data.title`, `visual_data.criterion_heading`
   - `visual_data.columns`: array of `{ id, title, subtitle?, tone?, badge? }`
   - `visual_data.rows`: array of `{ criterion, progress_start, values: { [colId]: { text, status?: "good"|"best"|"warn"|"neutral"|"bad"|"risk" } } }`
   - `visual_data.takeaway`: `{ label?, text, show_at_progress }`

6. **`"timeline_flow"` (`TimelineFlow` — 2..6 milestones)**:
   - `visual_data.orientation`: `"horizontal"` (default) or `"vertical"`
   - `visual_data.badge`, `visual_data.subtitle`
   - `visual_data.milestones`: array of `{ id, time_label, title, description, icon?, tone?, metric_badge?, progress_start, progress_end }`
   - `visual_data.callout`: `{ title, text, show_at_progress }`

7. **`"kpi_metrics"` (`KpiMetricsCard` — 1..4 cards, optional bar chart `<= 8` points)**:
   - `visual_data.cards`: array of `{ id, label, value, numeric_target?, prefix?, suffix?, decimals?, delta_text?, delta_tone?, tone?, sparkline?: number[], progress_start }`
   - `visual_data.chart` (optional): `{ title, type: "bar", show_at_progress, unit?, series: [{ label, value, highlight? }] }`
   - `visual_data.alert_stamp` (optional): `{ text, tone?: "danger"|"success", show_at_progress }`

> **UI Worker Dispatch (`studio-worker`):** This workflow can also be triggered directly from the Web UI (`http://localhost:3030`) when an Antigravity `studio-worker` session is Online (`script_episode` / `script_batch` only).


## Step 2: Validate Diagrams, Author `notes.md`, Preview & Complete Review (Conv 2)

1. Create `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/notes.md` containing:
   - **One-Page Cheat Sheet**: Core definitions, comparison table, and golden rules.
   - **Mẫu cấu hình & Lệnh thực hành**: Copy-pasteable JSON/YAML/CLI/SDK snippets.
   - **3 Câu hỏi trắc nghiệm chuẩn đề thi**: Realistic scenario questions with detailed explanation of why the correct option works and why each distractor fails.
2. Validate all 7 templates (SSOT in `engine/src/template_schema.mjs`) against scene metadata, node/label/edge collisions, zone rules, and template field constraints:
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" validate-diagrams --course <COURSE_CODE> --ep <ep-slug>
   ```
   *(Fix any reported errors before approving; built-in AI jobs in `runner.mjs` / `queue_broker.mjs` also support 2-Pass Storyboard->Compiler generation and targeted scene-level self-repair `repairInvalidScenes`.)*
3. Preview the episode silently in **Storyboard Preview Mode** on `http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player` (available as soon as `script.json` exists, even without audio).
4. **Strict Scripting vs. Production Separation (`auto_produce`):**
   - Scripting in Conversation 2 MUST stop at `script_ready` (or at an intermediate gate `pause_after: "brief" | "dialogue"`) so the user can review `ScriptingStageModal` and **Storyboard Preview Mode** before committing to audio/video generation.
   - **NEVER** auto-run full `tts_pipeline.py --episode ...` or `render_video.mjs` during scripting unless `auto_produce === true` (and **NEVER** when paused at `pause_after: "brief" | "dialogue"`).
   - **Optional Audio-Spine Lock (`--audio-spine`):** Between Stage 2 (`dialogue.json`) and Stage 3 (`script.json`), run `{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --audio-spine "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/dialogue.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json" --json` **ONLY** when `lock_audio_spine === true` (with `pause_after === "none"`) or explicitly requested by the user.
   - Keep `cue_sentence` and `cue_text` (plus optional `tts_beats` / `tts_narration`) accurate in `script.json`; full TTS synthesis and video rendering belong to **Conversation 3 (`video-renderer`)** or an explicit `auto_produce === true` run.
5. If fixing tickets from the Revision Queue (`REV-XXX` with `scope: "script"` or `"visual"`), resolve each fixed ticket first, then approve scripting (`state_cli.mjs set --stage scripting --status completed` also runs `validateScriptDiagrams` automatically):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" resolve-revision --course <COURSE_CODE> --ep <ep-slug> --rev <REV_ID> --note "<what was fixed>"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status reviewing --owner "<reviewer>"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage scripting --status completed --note "Script and notes.md approved"
   ```
   *(If a script revision affects an episode that already had rendered video, `production.stale` is flagged so Conv 3 re-runs TTS & render.)*

## Step 3: Synthesize Audio & Subtitles (Conv 3 — Video Factory)

Before running TTS, verify the episode is ready via `state_cli.mjs next --course <COURSE_CODE> --stage production`.
`tts_pipeline.py` uses 3-tier voice inheritance (`--profile` CLI > `script.json` > `<COURSE_CODE>/course.json` > [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json) default). Never run unsigned `.exe` wrappers; use pure Python stdlib (see [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md) for custom voices or VoiceStudio):
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status tts_processing --owner "<agent>"
{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --episode "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/script.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json" --json
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status rendering --tts-done true
```
*(Optional: pass `--profile <profile_id>` to test or override a specific voice profile.)*

This writes `audio/<profile_id>/<scene_id>.mp3` (or `.wav`) for every scene, writes `subtitles.srt` + `subtitles.<profile_id>.srt`, preserves existing `voice_tracks` for instant A/B switching, aligns visual cues via Layer 1 (`_base_timings`), and updates `script.json` with `tts_profile`, `tts_voice`, `tts_provider_used`, `tts_fallback_reason` (populated only if Edge TTS falls back to Google TTS, cleared when primary succeeds, and surfaced in `/api/courses`), `duration_sec`, `audio_file`, `subtitles`, and `total_duration_sec`. You can also trigger TTS + Render directly from the Studio Player UI (**`🎙️ Tạo Audio (TTS)`** / **`🎬 Xuất Video ▾`**), or proceed to `video-renderer` (`render_video.mjs`) to generate and verify the final video.
