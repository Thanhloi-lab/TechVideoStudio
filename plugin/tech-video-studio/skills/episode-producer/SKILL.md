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

### Optional V2 Motion Fields (`script.json`)
- `scene.highlight_words` (`string[]`): optional extra keywords accented in V2 box-free subtitles alongside default core keywords.
- `flow_step.camera_focus` (`{ x, y, zoom }`): optional explicit 16:9 camera rig pan/zoom (`x`/`y` in `0..100`, `zoom` in `1.0..1.25`) inside `architecture` `flow_steps`.
- `highlight_phase.code_override` (`string[] | string`): optional updated code lines for `@shikijs/magic-move` smooth code morphing between phases in `code_cli`.
- `highlight_phase.laser_scan` (`boolean | number[]`): optional red laser scanline sweep and danger emphasis for security vulnerability or error phases in `code_cli`.

### Supported `visual_type` schemas

1. **`"architecture"` (`ArchitectureDiagram`)**:
   - `visual_data.zones`: array of `{ id, label, sublabel?, role?, parent_zone?, node_ids?, x?, y?, w?, h? }`
     - **Max 2 nested levels** via `parent_zone` (e.g. `aws-cloud` -> `vpc-private`).
     - `role`: `"client" | "network" | "compute" | "security" | "data" | "danger"`.
     - Supply `node_ids` for automatic bounding boxes around member nodes, or explicit `x, y, w, h` in `0..100`. Parent zones auto-expand around child zones.
   - `visual_data.nodes`: array of `{ id, label, sublabel, icon, x, y, tone }`
     - `x`, `y` are percentages `0..100` on the stage canvas.
     - `icon`: `"user" | "iam-user" | "iam-group" | "iam-role" | "iam-policy" | "sts" | "ec2" | "s3" | "lambda" | "apigw" | "dynamodb" | "vpc" | "docker" | "database" | "shield" | "hacker" | "code" | "check" | "deny"`
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
   - `visual_data.layout`: `"split"` (default) or `"code"` or `"terminal"`
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
2. Validate all `architecture` scenes against node/label/edge collisions and zone rules:
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" validate-diagrams --course <COURSE_CODE> --ep <ep-slug>
   ```
   *(Fix any reported node/label/edge overlaps or >2-level zones before approving.)*
3. Preview the episode silently in **Storyboard Preview Mode** on `http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player` (available as soon as `script.json` exists, even without audio).
4. If fixing tickets from the Revision Queue (`REV-XXX` with `scope: "script"` or `"visual"`), resolve each fixed ticket first, then approve scripting (`state_cli.mjs set --stage scripting --status completed` also runs `validateScriptDiagrams` automatically):
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

This writes `audio/<scene_id>.mp3` (or `.wav`) for every scene, writes `subtitles.srt`, and updates `script.json` with `tts_profile`, `tts_voice`, `tts_provider_used`, `duration_sec`, `audio_file`, `subtitles`, and `total_duration_sec`. You can also trigger TTS + Render directly from the Studio Player UI (**`🎙️ Tạo Audio (TTS)`** / **`🎬 Tạo Audio & Render Video`**), or proceed to `video-renderer` (`render_video.mjs`) to generate and verify the final video.
