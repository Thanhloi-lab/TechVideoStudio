# VideoMaker Workspace Rules & Pipeline Handoff (`tech-video-studio`)

Every new conversation operating inside `{{WORKSPACE_ROOT}}` must follow these workspace rules, state-discovery steps, onboarding interviews, independent review gates, multi-part deep-dive workflows, diagram/template rules, and model allocation policies strictly.

> **Single Source of Truth & Setup:** [`plugin/tech-video-studio/`]({{WORKSPACE_ROOT_FILE_URI}}/plugin/tech-video-studio) and [`AGENTS.md`]({{WORKSPACE_ROOT_FILE_URI}}/AGENTS.md) are the sole SSOT. Run `node "{{WORKSPACE_ROOT}}/setup.mjs" --workspace --global` to sync the Antigravity plugin (6 skills) into `.agents/plugins/tech-video-studio/` and `~/.gemini/config/plugins/tech-video-studio/`. Read [`GUIDE.md`]({{WORKSPACE_ROOT_FILE_URI}}/GUIDE.md) for environment diagnostics (`node "{{WORKSPACE_ROOT}}/setup.mjs" --check --json`).

---

## 1. State Discovery First & Course Structure (Mandatory on Every New Conversation)

Before planning, scripting, or rendering any episode, **never guess progress from memory**. Run the state CLI immediately to inspect live course and episode status:

```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course AWS
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course AWS --status open
```

*(Replace `AWS` with the target `<COURSE_CODE>`.)*

- All reusable rendering, state, diagram validation, AI, and TTS tools reside in `{{WORKSPACE_ROOT}}/engine/`.
- Voice catalog & custom TTS provider spec live in [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json) and [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md).
- Course directories live in `{{WORKSPACE_ROOT}}/<COURSE_CODE>/` containing `course.json`, `curriculum.md`, `curriculum_review.md`, `state/<ep-id>.json`, `state/events.jsonl`, and `episodes/<ep-id>/`.
- Per-episode deep-dive artifacts live in `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-id>/`: `brief.json`, `brief_review.md`, `parts/<part_id>/` (`dialogue.json`, `notes.md`, `review.md`, optional `audio_spine.json`, `script.json`, `audio/<profile_id>/*`, `subtitles.srt`, `<part_id>.mp4`), and merged root outputs (`script.json`, `notes.md`, `subtitles.srt`, `<ep-id>.mp4|webm`).
- Never hand-edit state files directly when `state_cli.mjs` can update them atomically.

---

## 2. Three-Conversation Deep-Dive Pipeline & State Commands

Work is split into three focused conversation roles connected by `<COURSE_CODE>/state/*.json` and the 3-screen Dashboard (`http://localhost:3030`).

### Conversation 1 — Curriculum Architect + Independent Reviewer (`curriculum-architect` + `curriculum-reviewer` skills)
1. **Mandatory Course Onboarding `/grill-me` (before authoring `course.json` / `curriculum.md`):**
   Whenever a user starts a new conversation with a broad course request (e.g., `"Tạo video dạy K8s chi tiết, nâng cao"`), **unless the user explicitly says `"bỏ qua hỏi, dùng mặc định"`**, the Agent MUST:
   - Read [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json) (and optionally run `{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --discover-voicestudio --json` if VoiceStudio may be running).
   - Interview the user **1 question at a time** using `ask_question` with `(Recommended)` first:
     1. **Q1:** Mục tiêu / Chứng chỉ / Thực chiến Deep-Dive (10–25 phút/tập chia part `<= 5 phút`) & Quy mô số tập (`10` / `20` / `30` tập).
     2. **Q2:** Chọn Giọng đọc mặc định cho Khóa học from the real list in `voices.json` (+ option to integrate a new VoiceStudio / custom HTTP voice right now per [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md)).
     3. **Q3:** Độ sâu Lab / CLI / Code & Phong cách trình bày (*under-the-hood* vs thực hành).
     4. **Q4:** Phạm vi triển khai ngay sau khi chốt lộ trình (chỉ lên `course.json` + `curriculum.md` + review + `init`, hoặc tiếp tục triển khai sóng Script đầu tiên).
   - Save the selected `tts_profile`, `tts_provider`, `tts_voice`, and `tts_rate` into `<COURSE_CODE>/course.json`.
2. **Deep-Dive Episode Sizing (No `3–5 minute` Episode Cap):**
   - **Total duration of each deep-dive episode is decided by the Curriculum Architect** based on what is needed to master the topic thoroughly (typically **10–25 minutes**, split into `estimated_parts` of **`<= 5 minutes` (`max_part_duration_sec: 300`)** each for focused review).
   - Author `<COURSE_CODE>/course.json` with `course_depth: "deep_dive"`, `max_part_duration_sec: 300`, progressive Stages (*Chặng*), and per-episode `estimated_duration_min`, `estimated_parts`, `prerequisites[]`, `learning_objectives[]`, and `must_cover_concepts[]`. Mirror the full syllabus in `<COURSE_CODE>/curriculum.md`.
3. **Mandatory Independent Review Gate (`curriculum-reviewer`) BEFORE `state_cli.mjs init`:**
   - **Author MUST NEVER self-approve.** Spawn an independent **`curriculum-reviewer`** subagent with fresh context to audit `course.json` + `curriculum.md` against the 5-criterion rubric (Coverage Depth, Topic Overload & `<= 5m` Part Sizing, Prerequisite Chain, Lab & Production Trap Depth, Duration-to-Depth Realism).
   - Reviewer outputs `<COURSE_CODE>/curriculum_review.md` (`APPROVED` or `REVISE` + `BLOCKER / MAJOR / MINOR`). Iterate up to **2 rounds** until `APPROVED`.
   - **ONLY after `curriculum_review.md` is `APPROVED`**, initialize sharded episode state:
     ```powershell
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" init --course <COURSE_CODE>
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
     ```

### Conversation 2 — Script Factory: Multi-Part Authoring & Independent Review (`episode-producer` + `content-reviewer` skills)
0. **Automatic Subagent Wave Orchestration & Same-Subagent Revision Reuse (No `/teamwork` Needed):**
   - To prevent context overflow across 10–30 deep-dive episodes (even when continuing in the same conversation after curriculum design), the main Agent automatically acts as a lightweight **Orchestrator**: spawn **1 dedicated `self` subagent per episode** in parallel waves of **3–5 episodes** (`Workspace: "inherit"`). Each subagent writes all artifacts to disk and returns **ONLY a 5–10 line summary** (never pasting raw scripts into the parent chat).
   - **Reuse the same subagent for edits:** Keep the `<ep-id> -> subagent conversationId` mapping and leave finished episode subagents idle (0 idle token cost). When the user asks to revise an episode authored earlier in the same conversation, send the revision instructions to that exact subagent via `send_message` (which preserves its context and auto-revives it if idle/restarted) rather than spawning a new subagent. Only spawn a fresh subagent reading from disk if the episode came from another conversation or its subagent was killed.
1. Discover the next wave of episodes needing scripts or revisions (process in stage/batch waves of **3–5 episodes**):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" next --course <COURSE_CODE> --stage scripting --limit 5
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> --status open
   ```
2. Drive each episode through `planning` -> `in_progress` -> `reviewing` -> `completed` (`overall_status: "script_ready"`) or `needs_revision`:
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <EP_ID> --stage scripting --status planning --owner "<agent>"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <EP_ID> --stage scripting --status in_progress --owner "<agent>"
   ```
3. **Unified `deep_course` Multi-Part Pipeline & Independent Subagent Review Gate:**
   - **Stage 1 — Master Brief (`brief.json`) + Stage 1.5 Review (`brief_review.md`):**
     Author `episodes/<ep-id>/brief.json` with `hook_angle`, `narrative_arc`, **`episode_canon`** (`shared_glossary`, `running_example`, `target_audience_assumptions`), and **`parts[]`** (`part_01..part_N`, each `target_duration_sec <= 300`, assigning 100% of `must_cover_concepts[]`, `entry_bridge`, `exit_bridge`, and `teaching_beats[]`). Spawn a fresh **`content-reviewer`** subagent to write `brief_review.md` (`APPROVED` / `REVISE`, max 2 rounds).
   - **Stage 2 — Per-Part Dialogue & Notes (`parts/<part_id>/dialogue.json` + `notes.md`) + Stage 2.5 Review (`parts/<part_id>/review.md`):**
     Author each part sequentially passing the previous part's summary & `exit_bridge` as handoff so `part_02+` continues smoothly **without repeating intros/outros** (`<= 300s` / ~600–850 spoken Vietnamese words, Dual-Text TTS safety `display_text` vs phonetic `tts_text`, What-vs-Why separation, under-the-hood mechanism + concrete trace).
     **Mandatory Independent Gate:** Spawn a fresh **`content-reviewer`** subagent (`content-reviewer/SKILL.md`) to audit `parts/<part_id>/dialogue.json` + `notes.md` and write `parts/<part_id>/review.md` (`APPROVED` / `REVISE` + `rewrite_instructions`, max 2 loops). **Author MUST NEVER self-approve.**
   - **Optional Pre-Visual Audio-Spine & Beat Reuse (`audio_spine.json`):**
     Runs `{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --audio-spine "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<EP_ID>/parts/<part_id>/dialogue.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json" --json` **ONLY** when `lock_audio_spine === true` (with `pause_after === "none"`) or explicitly requested. When `tts_pipeline.py --episode ...` runs later, `process_episode()` automatically **reuses** matching `audio_spine.json` beat audio chunks (exact `beat_id` + normalized `tts_text`) with zero duplicate TTS synthesis (`reused_scenes`).
   - **Stage 3 — Visual Compile (`parts/<part_id>/script.json`) Across 11 Templates:**
     Compile locked dialogue (+ optional `audio_spine.json`) into the **11 visual templates** (`normalizeCompiledScript` + targeted `repairInvalidScenes`).
   - **Gates, Resume & Intermediate Review UI:** Control execution with `pause_after: "none" | "brief" | "part_review" | "dialogue"` and `start_from: "brief" | "dialogue" | "visual"` (+ optional `part_id`); inspect/edit `brief.json`, `dialogue.json`, `review.md`, and `audio_spine.json` in `ScriptingStageModal`.
   - **Dynamic Per-Role Routing (5 Roles):** Route all 5 pipeline roles independently using exact backend keys **`outliner`**, **`brief_scriptwriter`**, **`content_reviewer`**, **`visual_director`**, and **`repair`** via `POST /api/ai/preferences/routing` (or per-job `role_routing`), configurable in **`RoleRoutingPanel`** (`BrandHealthGrid` & `AiScriptModal`, zero hardcoded model defaults).
   - **Per-Part User Review, Approval & Deterministic Merge (`merge-parts`):**
     Preview each `<= 5m` part in Studio Player (Part Switcher) or via `render_video.mjs --part <part_id>`, approve parts, and merge deterministically into episode root (`script.json` with prefixed scene IDs & remapped `parts/<part_id>/audio/...` + `voice_tracks`, cumulative-offset `subtitles.srt`, and TOC `notes.md`):
     ```powershell
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" parts --course <COURSE_CODE> --ep <EP_ID>
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set-part --course <COURSE_CODE> --ep <EP_ID> --part <PART_ID> --status completed --ai-verdict APPROVED --approved true
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" merge-parts --course <COURSE_CODE> --ep <EP_ID>
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <EP_ID> --stage scripting --status completed --note "Multi-part deep-dive script and notes.md approved"
     ```
   - **Strict Scripting vs. Production Separation (`auto_produce`):** Scripting (Conv 2 & `studio-worker`) MUST stop at `script_ready` (or a `pause_after` gate) and NEVER auto-run full episode TTS or `render_video.mjs` unless `auto_produce === true` (and NEVER when paused at a gate).
4. **V2 Motion & Phase 2 `script.json` Optional Fields** (all backward-compatible):
   - `scene.highlight_words` (`string[]`): extra technical keywords accented in box-free subtitles (`parseSubtitleSegments`).
   - `scene.visual_job` (`"Proof" | "Mechanism" | "Consequence" | "Action" | "Transition"`): topbar `SharpTag` editorial badge.
   - `scene.world_theme` (`"dark" | "light"`): dark/light stage background & palette grammar (alternate cleanly across scenes).
   - `scene.causal_mechanic` (`"blur-materialize" | "wire-draw" | "arc-emission" | "width-push" | "squash-drop" | "typographic-strike"`): deterministic scene entrance mechanic (rotate across consecutive scenes).
   - `scene.sfx_cues` (`Array<{ type, progress?, time_sec?, frame_offset?, volume? }>`): explicit SFX triggers (`whoosh_short`, `pop`, `click`, `typing_fast`, `impact`, `chime`); auto-derived if omitted.
   - `bgm_file` (`string`, top-level `script.json` or episode metadata, + optional `bgm_volume`): optional looping background music file carved at `1800Hz -6dB` for vocal clarity.
   - `scene.tts_narration` (`string`) & `scene.tts_beats` (`Array<{ beat_id?, display_text, tts_text? }>`): Dual-Text TTS overrides separating display orthography from phonetic TTS text.
   - `flow_step.camera_focus` (`{ x, y, zoom }`): explicit 16:9 camera rig pan/zoom target (`x`/`y` in `0..100`, `zoom` in `1.0..1.25`) for `architecture` scenes.
   - `highlight_phase.code_override` (`string[] | string`): `@shikijs/magic-move` morphing in `code_cli` scenes (dùng `accent: "danger"` để highlight đỏ dòng rủi ro; đã bỏ hiệu ứng `laser_scan`).
5. **11 Visual Templates, Visual Variety Guard & Diagram Rules:**
   - **11 Supported Templates (SSOT in `{{WORKSPACE_ROOT}}/engine/src/template_schema.mjs`):**
     - Core 7: `architecture`, `console_setup`, `code_cli`, `exam_tips`, `comparison_matrix`, `timeline_flow`, `kpi_metrics`
     - Deep-Dive 4: `sequence_diagram` (`actors[]`, `messages[]`, `highlights[]`), `memory_layout` (`lanes[]`, `steps[]` w/ `highlight_cells` & `pointers`), `code_diff` (`left_lines[]`, `right_lines[]`, `focus_steps[]` with Shiki), `concept_breakdown` (`core`, `branches[]`, `takeaway`) — see [`VISUAL_COMPONENTS.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/VISUAL_COMPONENTS.md)
   - **Visual Variety Guard:** Never repeat the same `visual_type` back-to-back (`scene[i].visual_type !== scene[i-1].visual_type`); use `>= 3` distinct `visual_type` templates per part; alternate `world_theme` (`"dark"` / `"light"`) and `causal_mechanic`.
   - **Architecture Rules (`visual_type: "architecture"`):** Use `layout_mode: "auto"` (Zero-LLM DAG auto-layout in `engine/src/motion/kernel.mjs`), `zones[]` (max 2 nested levels via `parent_zone`), directional User -> Server -> Cloud flow, `edge.routing: "auto"` (`"curved"` only for bidirectional/skip arcs), concise non-overlapping labels, and pre-registered `node.svg` assets (`engine/assets/svg/catalog.json`).
   - **Automated 11-Template Validation:** Run `node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" validate-diagrams --course <COURSE_CODE>` (validates all 11 templates, scene metadata, and Visual Variety Guard; also enforced automatically by `state_cli.mjs set --stage scripting --status completed` and `merge-parts`).
6. Preview scripts visually before audio generation using **Storyboard Preview Mode** in the Studio Player (`http://localhost:3030/?course=<COURSE_CODE>&ep=<EP_ID>&view=player`).

### Conversation 3 — Video Factory (Producer + Verifier, `episode-producer` + `video-renderer` skills)
1. Query episodes ready for production (`overall_status === "script_ready"`, `production.status === "needs_revision"`, or `production.stale === true`):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" next --course <COURSE_CODE> --stage production --limit 5
   ```
2. Synthesize Vietnamese TTS audio (`audio/<profile_id>/*.mp3` or `.wav`) and subtitles (`subtitles.srt` + `subtitles.<profile_id>.srt`) using 3-tier voice inheritance (`CLI / script.json` -> `course.json` -> [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json) default; see [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md)). `tts_pipeline.py` preserves existing `voice_tracks`, **reuses matching `audio_spine.json` beats automatically** (`reused_scenes`, zero duplicate TTS calls), runs **Layer 1 Subtitle-Cue Alignment** across all **11 visual templates** (`--realign-only [--scene <SCENE_ID>]`), and tracks `tts_fallback_reason`:
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <EP_ID> --stage production --status tts_processing --owner "<agent>"
   {{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --episode "{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<EP_ID>/script.json" --course "{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <EP_ID> --stage production --status rendering --tts-done true
   ```
3. Render the video offline with **HyperFrames** (sole render engine, default **`30` fps**; full design in [`HYPERFRAMES_ENGINE.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/HYPERFRAMES_ENGINE.md)): compiled into `<COURSE_CODE>/episodes/<EP_ID>/hyperframes/index.html` (11 DOM + GSAP templates in `engine/hyperframes/runtime/scenes/*.mjs`, vendored `hyperframe.runtime.iife.js`), Light/Dark themes, smart same-`part` overlaps (`140ms` dark breathers), procedural SFX bus (`-33ms` lead), vocal-carved BGM (`1800Hz -6dB`), pure-JS **BS.1770-4 `-16 LUFS`** normalization, and **DOM Layout & Safe-Zone QC Gate** (`engine/hyperframes/layout_qc.mjs`), captured via headless Chrome CDP and encoded with WebCodecs (no FFmpeg, no npm). Supports `--part <part_id>` for rendering `<= 5m` preview parts and scales timeouts automatically for 15–25m deep-dive episodes:
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <EP_ID> [--part <PART_ID>] [--port 3030] [--format webm|mp4] [--resolution 720p|1080p|1440p|2160p] [--fps 24|30|60] [--workers 1..8] [--check-layout|--no-check-layout] [--qc-strict]
   node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <EP_ID> --compile-only
   node "{{WORKSPACE_ROOT}}/engine/hyperframes/snapshot.mjs" --course <COURSE_CODE> --episode <EP_ID> [--part <PART_ID>] --scene <N> --at 0.1,0.5,0.9 --check-determinism [--check-layout] [--qc-strict]
   node "{{WORKSPACE_ROOT}}/engine/hyperframes/verify_video.mjs" --course <COURSE_CODE> --episode <EP_ID> --file <EP_ID>.mp4 [--frames 3,30] [--check-layout] [--qc-strict]
   ```
4. Verify visually in headless Chrome on `http://localhost:3030/?course=<COURSE_CODE>&ep=<EP_ID>&view=player` (0 console/page errors, non-empty video file on disk), then finalize state (which clears `production.stale`):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <EP_ID> --stage production --status completed --video-done true --verified true
   ```
   *(If a script or diagram defect is discovered during production/review, create a structured revision ticket via `add-revision` so Conv 2 fixes it.)*

### Revision Queue & Diagnostic Commands
- List open or resolved revision tickets (`revisions[]` with `REV-001`..):
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> [--ep <EP_ID>] [--status open|in_progress|resolved|all]
  ```
- Create a structured revision ticket (`script`, `visual`, or `production`):
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" add-revision --course <COURSE_CODE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc "<text>" [--owner "<name>"]
  ```
- Resolve a revision ticket after applying the fix:
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" resolve-revision --course <COURSE_CODE> --ep <EP_ID> --rev <REV_ID> --note "<resolution summary>"
  ```
- Validate all 11 visual templates & Visual Variety Guard across a course or single episode:
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" validate-diagrams --course <COURSE_CODE> [--ep <EP_ID>]
  ```
- Inspect, approve, or merge multi-part episodes:
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" parts --course <COURSE_CODE> --ep <EP_ID> [--json]
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set-part --course <COURSE_CODE> --ep <EP_ID> --part <PART_ID> [--status pending|in_progress|reviewing|needs_revision|completed] [--approved true|false] [--ai-verdict APPROVED|REVISE] [--note "..."]
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" merge-parts --course <COURSE_CODE> --ep <EP_ID> [--force]
  ```
- Reconcile disk artifacts (`brief.json`, `parts/*`, `script.json`, `notes.md`, `audio/*`, `subtitles.srt`, `.webm`/`.mp4`) without clobbering active flags:
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" sync --course <COURSE_CODE>
  ```

---

## 3. Mandatory Model Allocation Policy

- **Curriculum Design, Roadmap Planning, Episode Scripting, Scene Design, and Independent Review (Conv 1 & Conv 2):**
  - Use **Gemini 4 Argon** (`gemini-4-argon-high` or `gemini-4-argon-medium`).
  - **Automatic Fallback:** If Argon quota runs out (exhausted `quota_remaining`, `[quota]` warning, or capacity/quota error), switch immediately to **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`) and brief the user clearly on the switch so work continues without interruption.
- **Video Execution, TTS Synthesis, Headless Rendering, and Verification (Conv 3):**
  - Use **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).
- **Dynamic Runtime Routing (Zero Hardcoded Models in Runtime Code/Tools):**
  - Built-in Web Studio AI pipelines discover configured providers and models live from `GET /api/ai/providers` and route all **5 roles** dynamically via **`outliner`**, **`brief_scriptwriter`**, **`content_reviewer`**, **`visual_director`**, and **`repair`** (`POST /api/ai/preferences/routing`). Never hardcode AI agent/model names in runtime routing configs or MCP worker tool parameters (pass the active session model or `"connected-agent"`).

---

## 4. 3-Screen Dashboard, Multi-Provider AI, Revision Queue & Voice Studio (`http://localhost:3030`)

Start the pure-Node Studio server if not already running:
```powershell
node "{{WORKSPACE_ROOT}}/engine/server.mjs"
```
- **Screen 1 (`view=projects`, default `/`):** Project Dashboard showing all courses, segmented progress bars, open revision counts, and live SSE status (`GET /api/stream`). *(Course creation stays strictly in Agent Conv 1 `/grill-me`, never on Web UI.)*
- **Screen 2 (`view=roadmap`):** Episode Roadmap & Live Monitor grouped by Stage (*Chặng*) with dual Scripting/Video status badges, multi-part progress, `production.stale` indicators, and:
  - **Top Pill (`🤖 AI Worker & Models`), `BrandHealthGrid` & `RoleRoutingPanel`:** Live health & `$0` handshake check across **9 brands** (`antigravity`, `openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, `ollama`, `lmstudio`, `manual_web`) via `GET /api/ai/providers[?force=1]`, `POST /api/ai/providers/credentials`, and `POST /api/ai/providers/test`. Highlights the single active selection with unclipped `Online` badge (`engine/.ai_credentials.json` + OS env vars, never leaked). Remembers `last_selection` and 5-role `pipeline_routing` (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair`) in `engine/.ai_preferences.json`, editable via **`RoleRoutingPanel`** (`🧭 Định tuyến AI theo vai trò`, `POST /api/ai/preferences/routing`) inside `BrandHealthGrid` and `AiScriptModal`.
  - **Episode Cards, Deep-Course Multi-Part Review & Batch Scripting:** Clicking any scripted card opens Studio Player directly; unscripted cards keep **`✍️ Biên kịch`**. `AiScriptModal` runs unified **`deep_course`** mode (with `pause_after: "none" | "brief" | "part_review" | "dialogue"`, `start_from`, `part_id`, `lock_audio_spine`, compact 5-role `RoleRoutingPanel`, and `auto_produce: false`). **`ScriptingStageModal`** adds a **Part selector**, **`review.md` tab**, **Approve Part** (`POST /api/episodes/part/approve`), and **Merge Parts** (`POST /api/episodes/merge-parts`) alongside `brief.json`, `dialogue.json`, and `audio_spine.json`. Supports batch scripting (`FloatingBatchBar`), quota-safe pause/resume (`POST /api/ai/jobs/resume`), and `manual_web` `$0` mode.
  - **Voice, Revisions & Right Tabs:** **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal` + `/api/voices*`), **`⚠️ Yêu cầu sửa`** (`RevisionModal`), and 3 right-panel tabs (`📡 Live Activity`, **`🛠️ Yêu cầu sửa`**, `🗺️ curriculum.md`).
- **Screen 3 (`view=player`):** 16:9 Studio Player supporting full-audio playback, **Part Switcher** (`GET /api/episodes/part` to inspect any `part_01..part_N` or the merged full episode), silent **Storyboard Preview Mode** across all **11 symmetric Visual Templates**, deep-linking (`&scene=<scene_id>`), **Multi-Voice A/B Switcher** (`POST /api/episodes/voice-track/activate` & `/delete`), unified **`🎬 Xuất Video ▾`** popover (HyperFrames sole renderer, default `30` fps, optional `part_id` preview, optional TTS toggle), **`⏱️ Khớp nhịp Animation`** Playhead Calibration (`POST /api/episodes/scene-timings`), **`🛠️ Sửa`** tab with inline quick-add revision form, **`🔄 Gửi AI Sửa Kịch Bản`**, Voice picker, and **`🎙️ Tạo Audio (TTS)`**.
- **Universal MCP Bridge (`engine/mcp/rpc.mjs`):** Available via Stdio (`engine/mcp_server.mjs`) and loopback HTTP (`GET|POST /mcp` on `:3030`), exposing 9 `studio_*` tools and 4 MCP resources (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).

---

## 5. Language, Accuracy & Environment Guardrails

- **Natural Vietnamese + Authentic Tech Terms:** Write narration and notes in crisp Vietnamese while keeping industry English technical terms intact (*Explicit Deny*, *AssumeRole*, *Consistent Hashing*, *Write-Ahead Log*). Never fabricate CLI flags, API parameters, system limits, or Big-O facts; verify against official documentation.
- **Windows Application Control & Allowed Runtimes:** Unsigned `.exe` wrappers (`pip.exe`, `esbuild.exe`, `ffmpeg.exe`) are blocked.
  - **Allowed runtimes only:** `python` (pure Python stdlib `>= 3.10` for `tts_pipeline.py`), `node` (pure Node.js ESM `>= 22` for `server.mjs`, `state_cli.mjs`, `render_video.mjs`), and Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH`).
  - Never install npm/pip dependencies or run `ffmpeg.exe` / unsigned `.exe` tools. For custom TTS engines, follow [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md).
  - HyperFrames runs without its npm CLI: only `@hyperframes/core` `hyperframe.runtime.iife.js` and GSAP UMD are vendored as plain JS, SHA-256 pinned in `engine/scripts/vendor_libs.mjs` (`node "{{WORKSPACE_ROOT}}/engine/scripts/vendor_libs.mjs" --raw-only` / `--verify-only`). Never run `npx hyperframes render` here (needs FFmpeg + `esbuild.exe`).
