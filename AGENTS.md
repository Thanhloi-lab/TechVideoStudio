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
3. Produce `episodes/<ep-id>/script.json` (4-part blueprint: `problem`, `architecture`, `setup`, `exam_tips`) and `episodes/<ep-id>/notes.md`.
4. **V2 Motion `script.json` Optional Fields** (all backward-compatible):
   - `scene.highlight_words` (`string[]`): extra technical keywords accented in box-free subtitles (`parseSubtitleSegments`).
   - `flow_step.camera_focus` (`{ x, y, zoom }`): explicit 16:9 camera rig pan/zoom target (`x`/`y` in `0..100`, `zoom` in `1.0..1.25`) for `architecture` scenes.
   - `highlight_phase.code_override` (`string[] | string`): updated code snapshot per phase for `@shikijs/magic-move` morphing in `code_cli` scenes.
   - `highlight_phase.laser_scan` (`boolean | number[]`): triggers red laser scanline sweep and danger highlight on risk/error code phases in `code_cli` scenes.
5. **Architecture Diagram Zones, Auto-Layout & Clean Routing Rules (`visual_type: "architecture"`):**
   - **Auto-Layout (`visual_data.layout_mode: "auto"`):** Set `layout_mode: "auto"` (or omit manual node `x, y`) to run Zero-LLM Layered DAG Auto-Layout in `engine/src/motion/kernel.mjs` (supports `orientation: "LR" | "TB"`, optional `node.tier`, zone-aware barycenter ordering, `[8..92] x [14..84]` bounds, and symmetric curved upgrade for bidirectional `routing: "auto"` edges). Supplying finite `x, y` on all nodes with `layout_mode !== "auto"` preserves manual coordinates verbatim.
   - **Zones (`visual_data.zones[]`):** Group related nodes into clear visual containers (max **2 nested levels** via `parent_zone`; roles: `client`, `network`, `compute`, `security`, `data`, `danger`; supply `node_ids` for auto-bounding or explicit `x, y, w, h` in `0..100`).
   - **Directional Layout:** Flow **User -> Server -> Cloud** cleanly left-to-right or top-to-bottom so nodes never collide.
   - **Clean Edge Routing (`edge.routing`):** Default to `"auto"` (straight for aligned unidirectional pairs, orthogonal rounded-elbow otherwise), `"straight"`, or `"orthogonal"`. Use `"curved"` **ONLY** for bidirectional pairs (`A <-> B`) or unavoidable skip-node arcs.
   - **Short Non-Overlapping Labels:** Keep edge `label` and `packet_label` concise so labels never overlap nodes or other labels.
   - **Automated 7-Template Validation & 2-Pass AI Scripting:** SSOT schema lives in `engine/src/template_schema.mjs`; run `node "engine/state_cli.mjs" validate-diagrams --course <COURSE>` (validates all 7 templates + scene metadata, also enforced automatically by `state_cli.mjs set --stage scripting --status completed`). Built-in AI runs (`engine/ai/runner.mjs` & `queue_broker.mjs`) support 2-Pass Storyboard -> Compiler (`mode: "auto" | "two_pass" | "single_pass" | "storyboard_only"`, `normalizeCompiledScript`) and targeted scene-level self-repair (`repairInvalidScenes`).
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
3. Render the 1920x1080 video offline via headless Chrome (`WebCodecs` + `MediaRecorder` fallback, modular Canvas 2D templates in `engine/src/canvas_templates/*.mjs` with `tokyo-night` syntax highlighting, and offline ESM vendoring in `engine/public/vendor/esm/` via `node "engine/scripts/vendor_libs.mjs"` + `engine/public/styles.css`):
   ```powershell
   node "engine/render_video.mjs" --course <COURSE> --episode <EP_ID> [--port 3030] [--format webm|mp4]
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

---

## 4. 3-Screen Dashboard, Multi-Provider AI, Revision Queue & Voice Studio (`http://localhost:3030`)

Start the pure-Node Studio server if not already running:
```powershell
node "engine/server.mjs"
```
- **Screen 1 (`view=projects`, default `/`):** Project Dashboard showing all courses, segmented progress bars, open revision counts, and live SSE status (`GET /api/stream`). *(Course creation stays strictly in Antigravity/Agent Conv 1 `/grill-me`, never on Web UI.)*
- **Screen 2 (`view=roadmap`):** Episode Roadmap & Live Monitor grouped by Stage (*Chặng*) with dual Scripting/Video status badges, `production.stale` indicators, and:
  - **Top Pill (`🤖 AI Worker & Models`) & `BrandHealthGrid`:** Live health & `$0` handshake check across **9 brands** (`antigravity`, `openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, `ollama`, `lmstudio`, `manual_web`) via `GET /api/ai/providers[?force=1]`, `POST /api/ai/providers/credentials`, and `POST /api/ai/providers/test` (1-token ping). Highlights the single active selection (`◉` + `✓ Đang chọn` + active summary chip) with unclipped `Online` badge. Credentials stay in `engine/.ai_credentials.json` + OS env vars and are **never** leaked back to the frontend. Remembers `last_selection` in `engine/.ai_preferences.json`.
  - **Episode Cards & Multi-Select Batch AI Scripting:** Clicking any scripted card opens Studio Player directly (card footers omit `Mở Studio` and `🔄 Viết lại KB`; unscripted cards keep **`✍️ Biên kịch`**). Supports **`✍️ Biên kịch Đợt / Hàng loạt`** and **`☑️ Chọn nhiều`** (`FloatingBatchBar` with **`✍️ Biên kịch hàng loạt (1 Model)`**, no 5-episode cap for built-in providers; 5-episode cap for Antigravity MCP worker). Rewriting an existing episode (via Player tab `🛠️ Sửa` **`🔄 Gửi AI Sửa Kịch Bản`** or batch modal) requires a non-empty change note (`rewrite_notes`) and sets `production.stale = true` if prior audio/video existed.
  - **Quota-Safe Pause & Resume + Manual `$0` Mode:** If a batch hits `429`/`402`/error mid-run, the job enters `status: "paused"` (`pause_reason: "quota_exhausted"|"error"`) keeping completed episodes intact; click **`▶ Tiếp tục (Resume / Đổi Model)`** (`POST /api/ai/jobs/resume`) to switch provider/model and finish remaining episodes. **`manual_web`** builds a Prompt Pack (`POST /api/ai/manual-prompt`) and validates pasted JSON (`POST /api/ai/manual-submit`).
  - **Voice, Revisions & Right Tabs:** **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal` + `/api/voices*`), **`⚠️ Yêu cầu sửa`** (`RevisionModal`), and 3 right-panel tabs (`📡 Live Activity`, **`🛠️ Yêu cầu sửa`**, `🗺️ curriculum.md`).
- **Screen 3 (`view=player`):** 16:9 Studio Player supporting full-audio playback, silent **Storyboard Preview Mode** across all **7 symmetric Visual Templates** (`architecture`, `console_setup`, `code_cli`, `exam_tips`, `comparison_matrix`, `timeline_flow`, `kpi_metrics`), deep-linking (`&scene=<scene_id>`), **Multi-Voice A/B Switcher** (`POST /api/episodes/voice-track/activate` & `/delete`), unified **`🎬 Xuất Video ▾`** popover (quality presets, optional TTS toggle, **`🚀 Bắt đầu Xuất Video`**, and existing video download link; no `btn-revision-topbar`), **`⏱️ Khớp nhịp Animation`** Playhead Calibration inside tab `🎬 Phân cảnh` (`POST /api/episodes/scene-timings`), **`🛠️ Sửa`** tab with inline quick-add revision form (defaults to `currentSceneId`, manual lock on scene switch), **`🔄 Gửi AI Sửa Kịch Bản`**, `Copy Prompt cho Agent`, Voice picker, and **`🎙️ Tạo Audio (TTS)`**.
- **Universal MCP Bridge (`engine/mcp/rpc.mjs`):** Available via Stdio (`engine/mcp_server.mjs`) and loopback HTTP (`GET|POST /mcp` on `:3030`), exposing 9 `studio_*` tools and 4 MCP resources (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).

---

## 5. Environment & Binary Guardrails

- On Windows Application Control environments, unsigned `.exe` wrappers (`pip.exe`, `esbuild.exe`, `ffmpeg.exe`) are blocked.
- **Allowed runtimes only:** `python` (pure Python standard library for `tts_pipeline.py`), `node` (pure Node.js ES modules for `server.mjs`, `state_cli.mjs`, `render_video.mjs`), and Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH` env var).
- Never install npm/pip dependencies or run `ffmpeg.exe` / unsigned `.exe` tools. For integrating custom TTS engines, follow [`engine/TTS_VOICE_SPEC.md`](engine/TTS_VOICE_SPEC.md).
