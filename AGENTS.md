# VideoMaker Workspace Rules & Pipeline Handoff

Every new conversation operating in this VideoMaker workspace must follow these workspace rules, state-discovery steps, onboarding interviews, diagram rules, and model allocation policies strictly.

> **New machine & multi-agent setup:** Read [`GUIDE.md`](GUIDE.md) or run `node setup.mjs` (default Antigravity workspace plugin) or `node setup.mjs --agents all` (Antigravity + Claude Code `.claude/skills/` & `.mcp.json` + Codex `.agents/skills/`; add `--claude-desktop` to merge into Claude Desktop config with `.bak` backup).

---

## 1. State Discovery First (Mandatory on Every New Conversation)

Before planning, scripting, or rendering any episode, **never guess progress from memory**. Run the state CLI immediately to inspect live course and episode status:

```powershell
node "engine/state_cli.mjs" summary --course AWS
node "engine/state_cli.mjs" revisions --course AWS --status open
```

*(Replace `AWS` with the target `<COURSE>` code.)*

- Sharded per-episode state files live in `<COURSE>/state/<ep-id>.json`.
- Append-only audit events live in `<COURSE>/state/events.jsonl`.
- Never hand-edit state files directly when `state_cli.mjs` can update them atomically.

---

## 2. Three-Conversation Pipeline & State Commands

Work is split into three focused conversation roles connected by `<COURSE>/state/*.json` and the 3-screen Dashboard (`http://localhost:3030`).

### Conversation 1 — Curriculum Architect (`curriculum-architect` skill)
1. **Mandatory Course Onboarding `/grill-me` (before authoring `course.json` / `curriculum.md`):**
   Whenever a user starts a new conversation with a broad course request (e.g., `"Tạo video dạy K8s chi tiết, nâng cao"`), **unless the user explicitly says `"bỏ qua hỏi, dùng mặc định"`**, the Agent MUST:
   - Read [`engine/voices.json`](engine/voices.json) (and optionally run `python "engine/tts_pipeline.py" --discover-voicestudio --json` if VoiceStudio may be running).
   - Interview the user **1 question at a time** using `ask_question` with `(Recommended)` first:
     1. **Q1:** Mục tiêu / Chứng chỉ / Thực chiến & Quy mô số tập (`10` / `20` / `30` tập).
     2. **Q2:** Chọn Giọng đọc mặc định cho Khóa học from the real list in `voices.json` (+ option to integrate a new VoiceStudio / custom HTTP voice right now per [`engine/TTS_VOICE_SPEC.md`](engine/TTS_VOICE_SPEC.md)).
     3. **Q3:** Độ sâu Lab / CLI / Code & Phong cách trình bày.
     4. **Q4:** Phạm vi triển khai ngay sau khi chốt lộ trình (chỉ lên `course.json` + `curriculum.md`, hoặc tiếp tục triển khai sóng Script đầu tiên).
   - Save the selected `tts_profile`, `tts_provider`, `tts_voice`, and `tts_rate` into `<COURSE>/course.json`.
2. Author `<COURSE>/course.json` and `<COURSE>/curriculum.md` with progressive Stages (*Chặng*) and 3–5 minute episodes.
3. Initialize sharded episode state files from `course.json` and disk artifacts:
   ```powershell
   node "engine/state_cli.mjs" init --course <COURSE>
   node "engine/state_cli.mjs" summary --course <COURSE>
   ```

### Conversation 2 — Script Factory (Planner -> Executor -> Reviewer, `episode-producer` skill)
1. Discover the next wave of episodes needing scripts or revisions (process in stage/batch waves of **3–5 episodes**):
   ```powershell
   node "engine/state_cli.mjs" next --course <COURSE> --stage scripting --limit 5
   node "engine/state_cli.mjs" revisions --course <COURSE> --status open
   ```
2. Drive each episode through the scripting state transitions:
   `planning` -> `in_progress` -> `reviewing` -> `completed` (`overall_status: "script_ready"`) or `needs_revision`:
   ```powershell
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage scripting --status planning --owner "<agent>"
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage scripting --status in_progress --owner "<agent>"
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage scripting --status reviewing --owner "<reviewer>"
   # If approved (automatically runs diagram validation on script.json):
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage scripting --status completed --note "Script and notes.md approved"
   # If defects remain:
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage scripting --status needs_revision --note "<exact fix needed>"
   ```
3. **Decoupled 3-Stage Scripting (`mode: "three_stage"`) & Strict Production Separation (`auto_produce`):**
   - Produce `episodes/<ep-id>/script.json` (4-part blueprint: `problem`, `architecture`, `setup`, `exam_tips`) and `episodes/<ep-id>/notes.md`.
   - Built-in AI runs (`engine/ai/runner.mjs` & `queue_broker.mjs`) support `mode: "three_stage"` alongside `"auto" | "two_pass" | "single_pass" | "storyboard_only"`:
     - **Stage 1 (`brief.json`):** Content Brief (`hook_angle`, `narrative_arc`, `teaching_beats`).
     - **Stage 2 (`dialogue.json` + `notes.md`):** Spoken Vietnamese beats with Dual-Text TTS safety (`display_text` vs phonetic `tts_text`, `on_screen_fact`, `scene_group`).
     - **Optional Pre-Visual Audio-Spine (`audio_spine.json`):** Runs `python "engine/tts_pipeline.py" --audio-spine "<COURSE>/episodes/<EP_ID>/dialogue.json" --course "<COURSE>/course.json" --json` **ONLY** when `lock_audio_spine === true` (with `pause_after === "none"`) or explicitly requested by the user.
     - **Stage 3 (`script.json`):** Visual Director & Motion Compiler compiles locked beats + optional `audio_spine.json` into the 7 visual templates (`normalizeCompiledScript`) with scene-level self-repair (`repairInvalidScenes`).
   - **Gates, Resume & Intermediate Review UI:** Control execution with `pause_after: "none" | "brief" | "dialogue"` and `start_from: "brief" | "dialogue" | "visual"`; inspect/edit intermediate artifacts in `ScriptingStageModal` (`GET /api/episodes/scripting-artifacts`, `POST /api/episodes/{brief,dialogue,audio-spine}`).
   - **Dynamic Per-Role Routing:** Route each pipeline role independently using exact backend role keys **`outliner`**, **`brief_scriptwriter`**, **`visual_director`**, and **`repair`** via `POST /api/ai/preferences/routing` (or per-job `role_routing`), configurable from **`RoleRoutingPanel`** inside `BrandHealthGrid` and `AiScriptModal` (no hardcoded model defaults).
   - **Strict Scripting vs. Production Separation:** Scripting (Conv 2 & `studio-worker`) MUST stop at `script_ready` (or a `pause_after` gate) and NEVER auto-run full `tts_pipeline.py` or `render_video.mjs` unless `auto_produce === true` (and NEVER when `pause_after` is `"brief"` or `"dialogue"`). Full TTS + rendering belongs to Conv 3 (`video-renderer`) or explicit `auto_produce === true`.
4. **V2 Motion & Phase 2 `script.json` Optional Fields** (all backward-compatible):
   - `scene.highlight_words` (`string[]`): extra technical keywords accented in box-free subtitles (`parseSubtitleSegments`).
   - `scene.visual_job` (`"Proof" | "Mechanism" | "Consequence" | "Action" | "Transition"`): topbar `SharpTag` editorial badge.
   - `scene.world_theme` (`"dark" | "light"`): dark/light stage background & palette grammar (default `"dark"`).
   - `scene.causal_mechanic` (`"blur-materialize" | "wire-draw" | "arc-emission" | "width-push" | "squash-drop" | "typographic-strike"`): deterministic scene entrance mechanic (rotate across consecutive scenes).
   - `scene.sfx_cues` (`Array<{ type, progress?, time_sec?, frame_offset?, volume? }>`): explicit SFX triggers (`whoosh_short`, `pop`, `click`, `typing_fast`, `impact`, `chime`); auto-derived if omitted.
   - `bgm_file` (`string`, top-level `script.json` or episode metadata, + optional `bgm_volume`): optional looping background music file carved at `1800Hz -6dB` for vocal clarity.
   - `scene.tts_narration` (`string`) & `scene.tts_beats` (`Array<{ beat_id?, display_text, tts_text? }>`): Dual-Text TTS overrides separating display orthography from phonetic TTS text.
   - `flow_step.camera_focus` (`{ x, y, zoom }`): explicit 16:9 camera rig pan/zoom target (`x`/`y` in `0..100`, `zoom` in `1.0..1.25`) for `architecture` scenes.
   - `highlight_phase.code_override` (`string[] | string`): updated code snapshot per phase for `@shikijs/magic-move` morphing in `code_cli` scenes.
   - `highlight_phase.laser_scan` (`boolean | number[]`): triggers red laser scanline sweep and danger highlight on risk/error code phases in `code_cli` scenes.
5. **Architecture Diagram Zones, Auto-Layout & Clean Routing Rules (`visual_type: "architecture"`):**
   - **Auto-Layout (`visual_data.layout_mode: "auto"`):** Set `layout_mode: "auto"` (or omit manual node `x, y`) to run Zero-LLM Layered DAG Auto-Layout in `engine/src/motion/kernel.mjs` (supports `orientation: "LR" | "TB"`, optional `node.tier`, zone-aware barycenter ordering, `[8..92] x [14..84]` bounds, and symmetric curved upgrade for bidirectional `routing: "auto"` edges). Supplying finite `x, y` on all nodes with `layout_mode !== "auto"` preserves manual coordinates verbatim.
   - **Zones (`visual_data.zones[]`):** Group related nodes into clear visual containers (max **2 nested levels** via `parent_zone`; roles: `client`, `network`, `compute`, `security`, `data`, `danger`; supply `node_ids` for auto-bounding or explicit `x, y, w, h` in `0..100`).
   - **Directional Layout:** Flow **User -> Server -> Cloud** cleanly left-to-right or top-to-bottom so nodes never collide.
   - **Clean Edge Routing (`edge.routing`):** Default to `"auto"` (straight for aligned unidirectional pairs, orthogonal rounded-elbow otherwise), `"straight"`, or `"orthogonal"`. Use `"curved"` **ONLY** for bidirectional pairs (`A <-> B`) or unavoidable skip-node arcs.
   - **Short Non-Overlapping Labels:** Keep edge `label` and `packet_label` concise so labels never overlap nodes or other labels.
   - **Automated 7-Template Validation:** SSOT schema lives in `engine/src/template_schema.mjs`; run `node "engine/state_cli.mjs" validate-diagrams --course <COURSE>` (validates all 7 templates + scene metadata, also enforced automatically by `state_cli.mjs set --stage scripting --status completed`).
6. Preview scripts visually before audio generation using **Storyboard Preview Mode** in the Studio Player (`http://localhost:3030/?course=<COURSE>&ep=<EP_ID>&view=player`).

### Conversation 3 — Video Factory (Producer + Verifier, `episode-producer` + `video-renderer` skills)
1. Query episodes ready for production (`overall_status === "script_ready"`, `production.status === "needs_revision"`, or `production.stale === true` after script/voice updates):
   ```powershell
   node "engine/state_cli.mjs" next --course <COURSE> --stage production --limit 5
   ```
2. Synthesize Vietnamese TTS audio (`audio/<profile_id>/*.mp3` or `.wav`) and subtitles (`subtitles.srt` + `subtitles.<profile_id>.srt`) using 3-tier voice inheritance (`CLI / script.json` -> `course.json` -> [`engine/voices.json`](engine/voices.json) default; see [`engine/TTS_VOICE_SPEC.md`](engine/TTS_VOICE_SPEC.md) for custom voices). `tts_pipeline.py` preserves existing `voice_tracks`, runs **Layer 1 Subtitle-Cue Alignment** from `scene._base_timings` (also runnable standalone via `--realign-only [--scene <SCENE_ID>]`), and logs/persists `tts_fallback_reason` in `script.json` (cleared when primary Edge TTS succeeds, surfaced via `/api/courses`):
   ```powershell
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage production --status tts_processing --owner "<agent>"
   python "engine/tts_pipeline.py" --episode "<COURSE>/episodes/<EP_ID>/script.json" --course "<COURSE>/course.json"
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage production --status rendering --tts-done true
   ```
3. Render the video offline with the **HyperFrames engine** (default; full design in [`engine/HYPERFRAMES_ENGINE.md`](engine/HYPERFRAMES_ENGINE.md)): the episode is compiled into a standard [HyperFrames](https://github.com/heygen-com/hyperframes) project (`<COURSE>/episodes/<EP_ID>/hyperframes/index.html`, 7 DOM + GSAP templates in `engine/hyperframes/runtime/scenes/*.mjs`, official `hyperframe.runtime.iife.js` vendored in `engine/public/vendor/raw/`), featuring Phase 2 Light/Dark themes, smart same-`part` overlaps (`140ms` dark breathers), procedural SFX bus (`engine/assets/sfx/*.wav`, `-33ms` lead), vocal-carved BGM (`1800Hz -6dB`), and pure-JS **BS.1770-4 `-16 LUFS`** normalization (`audio_dsp.mjs`, `hf_encoder.mjs`), then captured frame-by-frame in headless Chrome through the HyperFrames seek protocol and encoded with WebCodecs (no FFmpeg, no npm). Phase 3 adds the automated **DOM Layout & Safe-Zone QC Gate** (`engine/hyperframes/layout_qc.mjs`, checking `viewport_overflow`, `stage_overflow`, `topbar_collision`, `subtitle_collision`, `subtitle_overflow`, `clipped_text` at `[0.1, 0.5, 0.9]`). The previous Canvas 2D exporter stays available via `--engine legacy`:
   ```powershell
   node "engine/render_video.mjs" --course <COURSE> --episode <EP_ID> [--port 3030] [--format webm|mp4] [--resolution 720p|1080p|1440p|2160p] [--fps 24|30|60] [--workers 1..8] [--check-layout|--no-check-layout] [--qc-strict]
   node "engine/render_video.mjs" --course <COURSE> --episode <EP_ID> --compile-only          # build the HyperFrames project only
   node "engine/render_video.mjs" --course <COURSE> --episode <EP_ID> --engine legacy        # old Canvas 2D path
   node "engine/hyperframes/snapshot.mjs" --course <COURSE> --episode <EP_ID> --scene <N> --at 0.1,0.5,0.9 --check-determinism [--check-layout] [--qc-strict]
   node "engine/hyperframes/verify_video.mjs" --course <COURSE> --episode <EP_ID> --file <EP_ID>.mp4 [--frames 3,30] [--check-layout] [--qc-strict]
   ```
4. Verify visually in headless Chrome on `http://localhost:3030/?course=<COURSE>&ep=<EP_ID>&view=player` (0 console/page errors, non-empty video file on disk), then finalize state (which clears `production.stale`):
   ```powershell
   node "engine/state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage production --status completed --video-done true --verified true
   ```
   *(If a script or diagram defect is discovered during production/review, create a structured revision ticket via `add-revision` so Conv 2 fixes it.)*

### Revision Queue & Diagnostic Commands
- List open or resolved revision tickets (`revisions[]` with `REV-001`..):
  ```powershell
  node "engine/state_cli.mjs" revisions --course <COURSE> [--ep <EP_ID>] [--status open|in_progress|resolved|all]
  ```
- Create a structured revision ticket (`script`, `visual`, or `production`):
  ```powershell
  node "engine/state_cli.mjs" add-revision --course <COURSE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc "<text>" [--owner "<name>"]
  ```
- Resolve a revision ticket after applying the fix:
  ```powershell
  node "engine/state_cli.mjs" resolve-revision --course <COURSE> --ep <EP_ID> --rev <REV_ID> --note "<resolution summary>"
  ```
- Validate architecture diagrams across a course or single episode:
  ```powershell
  node "engine/state_cli.mjs" validate-diagrams --course <COURSE> [--ep <EP_ID>]
  ```
- Reconcile disk artifacts (`script.json`, `notes.md`, `audio/*`, `subtitles.srt`, `.webm`/`.mp4`) without clobbering active flags:
  ```powershell
  node "engine/state_cli.mjs" sync --course <COURSE>
  ```

---

## 3. Mandatory Model Allocation Policy

- **Curriculum Design, Roadmap Planning, Episode Scripting, Scene Design, and Script Review (Conv 1 & Conv 2):**
  - Use **Gemini 4 Argon** (`gemini-4-argon-high` or `gemini-4-argon-medium`).
  - **Automatic Fallback:** If Argon quota runs out (exhausted `quota_remaining`, `[quota]` warning, or capacity/quota error), switch immediately to **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`) and brief the user clearly on the switch so work continues without interruption.
- **Video Execution, TTS Synthesis, Headless Rendering, and Verification (Conv 3):**
  - Use **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).
- **Dynamic Runtime Routing (Zero Hardcoded Models in Runtime Code/Tools):**
  - Built-in Web Studio AI pipelines discover configured providers and models live from `GET /api/ai/providers` and route roles dynamically via **`outliner`**, **`brief_scriptwriter`**, **`visual_director`**, and **`repair`** (`POST /api/ai/preferences/routing`). Never hardcode AI agent/model names in runtime routing configs or MCP worker tool parameters (pass the active session model or `"connected-agent"`).

---

## 4. 3-Screen Dashboard, Multi-Provider AI, Revision Queue & Voice Studio (`http://localhost:3030`)

Start the pure-Node Studio server if not already running:
```powershell
node "engine/server.mjs"
```
- **Screen 1 (`view=projects`, default `/`):** Project Dashboard showing all courses, segmented progress bars, open revision counts, and live SSE status (`GET /api/stream`). *(Course creation stays strictly in Antigravity/Agent Conv 1 `/grill-me`, never on Web UI.)*
- **Screen 2 (`view=roadmap`):** Episode Roadmap & Live Monitor grouped by Stage (*Chặng*) with dual Scripting/Video status badges, `production.stale` indicators, and:
  - **Top Pill (`🤖 AI Worker & Models`), `BrandHealthGrid` & `RoleRoutingPanel`:** Live health & `$0` handshake check across **9 brands** (`antigravity`, `openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, `ollama`, `lmstudio`, `manual_web`) via `GET /api/ai/providers[?force=1]`, `POST /api/ai/providers/credentials`, and `POST /api/ai/providers/test` (1-token ping). Highlights the single active selection (`◉` + `✓ Đang chọn` + active summary chip) with unclipped `Online` badge. Credentials stay in `engine/.ai_credentials.json` + OS env vars and are **never** leaked back to the frontend. Remembers `last_selection` and per-role `pipeline_routing` (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`) in `engine/.ai_preferences.json`, editable via **`RoleRoutingPanel`** (`🧭 Định tuyến AI theo vai trò`, `POST /api/ai/preferences/routing`) inside `BrandHealthGrid` and `AiScriptModal` (`three_stage`).
  - **Episode Cards, 3-Stage Review & Batch AI Scripting:** Clicking any scripted card opens Studio Player directly (card footers omit `Mở Studio` and `🔄 Viết lại KB`; unscripted cards keep **`✍️ Biên kịch`**). `AiScriptModal` defaults to `mode: "three_stage"` (with `pause_after`, `start_from`, `lock_audio_spine`, compact `RoleRoutingPanel`, and `auto_produce` defaulting to `false`); intermediate `brief.json`, `dialogue.json`, and `audio_spine.json` artifacts are reviewed/edited in **`ScriptingStageModal`**. Supports **`✍️ Biên kịch Đợt / Hàng loạt`** and **`☑️ Chọn nhiều`** (`FloatingBatchBar` with **`✍️ Biên kịch hàng loạt (1 Model)`**, no 5-episode cap for built-in providers; 5-episode cap for Antigravity MCP worker). Rewriting an existing episode (via Player tab `🛠️ Sửa` **`🔄 Gửi AI Sửa Kịch Bản`** or batch modal) requires a non-empty change note (`rewrite_notes`) and sets `production.stale = true` if prior audio/video existed.
  - **Quota-Safe Pause & Resume + Manual `$0` Mode:** If a batch hits `429`/`402`/error mid-run, the job enters `status: "paused"` (`pause_reason: "quota_exhausted"|"error"`) keeping completed episodes intact; click **`▶ Tiếp tục (Resume / Đổi Model)`** (`POST /api/ai/jobs/resume`) to switch provider/model and finish remaining episodes. **`manual_web`** builds a Prompt Pack (`POST /api/ai/manual-prompt`) and validates pasted JSON (`POST /api/ai/manual-submit`).
  - **Voice, Revisions & Right Tabs:** **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal` + `/api/voices*`), **`⚠️ Yêu cầu sửa`** (`RevisionModal`), and 3 right-panel tabs (`📡 Live Activity`, **`🛠️ Yêu cầu sửa`**, `🗺️ curriculum.md`).
- **Screen 3 (`view=player`):** 16:9 Studio Player supporting full-audio playback, silent **Storyboard Preview Mode** across all **7 symmetric Visual Templates** (`architecture`, `console_setup`, `code_cli`, `exam_tips`, `comparison_matrix`, `timeline_flow`, `kpi_metrics`), deep-linking (`&scene=<scene_id>`), **Multi-Voice A/B Switcher** (`POST /api/episodes/voice-track/activate` & `/delete`), unified **`🎬 Xuất Video ▾`** popover (quality presets, optional TTS toggle, **`🚀 Bắt đầu Xuất Video`**, and existing video download link; no `btn-revision-topbar`), **`⏱️ Khớp nhịp Animation`** Playhead Calibration inside tab `🎬 Phân cảnh` (`POST /api/episodes/scene-timings`), **`🛠️ Sửa`** tab with inline quick-add revision form (defaults to `currentSceneId`, manual lock on scene switch), **`🔄 Gửi AI Sửa Kịch Bản`**, `Copy Prompt cho Agent`, Voice picker, and **`🎙️ Tạo Audio (TTS)`**.
- **Universal MCP Bridge (`engine/mcp/rpc.mjs`):** Available via Stdio (`engine/mcp_server.mjs`) and loopback HTTP (`GET|POST /mcp` on `:3030`), exposing 9 `studio_*` tools and 4 MCP resources (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).

---

## 5. Environment & Binary Guardrails

- On Windows Application Control environments, unsigned `.exe` wrappers (`pip.exe`, `esbuild.exe`, `ffmpeg.exe`) are blocked.
- **Allowed runtimes only:** `python` (pure Python standard library for `tts_pipeline.py`), `node` (pure Node.js ES modules for `server.mjs`, `state_cli.mjs`, `render_video.mjs`), and Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH` env var).
- Never install npm/pip dependencies or run `ffmpeg.exe` / unsigned `.exe` tools. For integrating custom TTS engines, follow [`engine/TTS_VOICE_SPEC.md`](engine/TTS_VOICE_SPEC.md).
- HyperFrames is used **without** its npm CLI: only its browser runtime file (`@hyperframes/core` `hyperframe.runtime.iife.js`) and the GSAP UMD build are vendored as plain JS, SHA-256 pinned in `engine/scripts/vendor_libs.mjs` (`node "engine/scripts/vendor_libs.mjs" --raw-only` / `--verify-only`). Do not run `npx hyperframes render` here (it needs FFmpeg + `esbuild.exe`); see `engine/HYPERFRAMES_ENGINE.md` §10 for machines where that is allowed.
