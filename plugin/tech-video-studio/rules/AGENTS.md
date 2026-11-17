# Tech Course Video Studio Rules

Whenever working with `tech-video-studio` or any course directory inside `{{WORKSPACE_ROOT}}`, follow these rules strictly:

## 1. Course Workspace Structure & Sharded State
- All reusable rendering, state, diagram validation, and TTS tools reside in `{{WORKSPACE_ROOT}}/engine/`.
- Voice catalog & custom TTS provider spec live in [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json) and [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md).
- Each technology course resides in `{{WORKSPACE_ROOT}}/<COURSE_CODE>/` (for example, `{{WORKSPACE_ROOT}}/AWS/`, `{{WORKSPACE_ROOT}}/DOCKER/`).
- Every course directory must contain:
  - `course.json` — machine-readable course metadata, default voice fields (`tts_profile`, `tts_provider`, `tts_voice`, `tts_rate`), and stage/episode index.
  - `curriculum.md` — human-readable learning roadmap organized into progressive Stages (*Chặng*).
  - `state/<ep-slug>.json` — atomic per-episode dual-pipeline state (`scripting`, `production`, `production.stale`, `voice_override`, `revisions[]`, `artifacts`, `last_error`) managed by `{{WORKSPACE_ROOT}}/engine/state_cli.mjs`.
  - `state/events.jsonl` — append-only event log consumed by the Dashboard Live Activity Feed and SSE stream.
  - `episodes/<ep-slug>/` — one folder per episode containing `script.json` (with `active_voice_track`, `voice_tracks`, and per-scene `_base_timings`), `notes.md`, `audio/<profile_id>/*.mp3` (or `.wav`), `subtitles.srt` (+ `subtitles.<profile_id>.srt`), and exported `<ep-slug>.webm` (or `.mp4`).

## 2. State Discovery & 3-Conversation Pipeline
- **Always run State Discovery first** before starting work in any conversation:
  ```powershell
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
  node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> --status open
  ```
- **Conv 1 (Curriculum — Mandatory `/grill-me` Onboarding):** Before authoring `course.json` + `curriculum.md` for a broad course request (unless the user explicitly says `"bỏ qua hỏi, dùng mặc định"`):
  1. Read `{{WORKSPACE_ROOT}}/engine/voices.json` (and optionally probe `{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --discover-voicestudio --json`).
  2. Interview the user **1 question at a time** via `ask_question` with `(Recommended)` first: (Q1) Mục tiêu / Chứng chỉ / Quy mô `10/20/30` tập; (Q2) Chọn Giọng đọc mặc định từ `voices.json` (+ tùy chọn tích hợp VoiceStudio/custom voice theo `TTS_VOICE_SPEC.md`); (Q3) Độ sâu Lab/CLI/Code & phong cách; (Q4) Phạm vi triển khai ngay sau khi chốt lộ trình.
  3. Save `tts_profile`, `tts_provider`, `tts_voice`, `tts_rate` into `course.json`, write `curriculum.md`, and run `node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" init --course <COURSE_CODE>`.
- **Conv 2 (Script Factory — Planner -> Executor -> Reviewer):** Pull batches of 3–5 episodes via `state_cli.mjs next --course <COURSE_CODE> --stage scripting --limit 5` and inspect open `revisions --status open`. Transition `scripting.status` through `planning` -> `in_progress` -> `reviewing` -> `completed` (`overall_status: "script_ready"`, which runs `validateScriptDiagrams` across all 7 templates from `engine/src/template_schema.mjs` automatically) or `needs_revision`. Built-in AI runs (`runner.mjs` / `queue_broker.mjs`) also support 2-Pass Storyboard->Compiler (`mode: "auto" | "two_pass" | "single_pass" | "storyboard_only"`, `normalizeCompiledScript`) and targeted scene-level self-repair (`repairInvalidScenes`).
- **Conv 3 (Video Factory — Producer + Verifier):** Pull ready or stale episodes via `state_cli.mjs next --course <COURSE_CODE> --stage production`. Run `tts_pipeline.py --episode ... --course ...` (3-tier voice inheritance: `CLI / script.json -> course.json -> voices.json`; preserves existing `voice_tracks`, runs Layer 1 Subtitle-Cue Alignment from `_base_timings`, and records/clears `tts_fallback_reason` in `script.json` surfaced via `/api/courses`), render via `render_video.mjs` (default **HyperFrames engine**: episode compiled to `<ep>/hyperframes/index.html` with DOM + GSAP templates in `engine/hyperframes/runtime/scenes/*.mjs` and the vendored official `hyperframe.runtime.iife.js`, captured through the HyperFrames seek protocol and encoded with WebCodecs — see `engine/HYPERFRAMES_ENGINE.md`; `--engine legacy` keeps the Canvas 2D templates in `engine/src/canvas_templates/*.mjs`), verify on `http://localhost:3030`, and mark `production.status` `completed` (`--video-done true --verified true`, clearing `production.stale`).

## 3. Mandatory Model Allocation Policy
- **Curriculum design, roadmap planning, episode scripting, scene design, and script review (Conv 1 & Conv 2):**
  - Use **Gemini 4 Argon** (`gemini-4-argon-high` / `gemini-4-argon-medium`).
  - Automatically fall back to **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`) if Argon quota runs out, and brief the user clearly on the switch.
- **Video execution, TTS synthesis, headless rendering, and verification (Conv 3):**
  - Use **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).

## 4. 4-Part Blueprint, Architecture Zones & V2 Motion Fields
Every tutorial video (target 16:9 Full HD, 3–5 minutes) must flow through 4 clear parts:
1. **Part 1 – Real-World Problem (`problem`)**: Open with a concrete developer scenario — why do engineers need this feature and what breaks without it?
2. **Part 2 – Animated Architecture Diagram (`architecture`)**:
   - Group components into `visual_data.zones[]` (max 2 nested levels via `parent_zone`; roles: `client`, `network`, `compute`, `security`, `data`, `danger`; supply `node_ids` or explicit `x, y, w, h`).
   - Lay out flows cleanly **User -> Server -> Cloud** (left-to-right or top-to-bottom). Set `visual_data.layout_mode: "auto"` (or omit node `x, y`) to use Zero-LLM Layered DAG Auto-Layout in `kernel.mjs` (`orientation: "LR" | "TB"`, optional `node.tier`, `[8..92] x [14..84]`, bidirectional `auto` -> symmetric `curved`), while manual finite `x, y` coordinates remain preserved verbatim.
   - Keep `edge.routing` at `"auto"` (straight or orthogonal rounded-elbow) — use `"curved"` **ONLY** for bidirectional pairs or unavoidable skip-node arcs. Keep `label` and `packet_label` short to avoid overlaps.
   - Validate all 7 templates with `node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" validate-diagrams --course <COURSE_CODE>`.
   - Support `flow_steps` with optional `camera_focus: { x, y, zoom }`.
3. **Part 3 – Practical Setup & Code (`setup`)**:
   - Use **Clean Console UI Mockup (`console_setup`)** to highlight exact fields, buttons, and options.
   - Use **Terminal & Code (`code_cli`)** to show policy JSON / YAML / IaC / CLI / SDK snippets with `highlight_phases` (optional `code_override` for Shiki Magic Move morphing and `laser_scan` for security/error scanline alerts).
4. **Part 4 – Exam Tips & Production Traps (`exam_tips`)**: Summarize certification exam traps vs production best practices, plus interactive quiz questions.
- **Optional Scene Field (`highlight_words`) & Extra Templates**: Supply `scene.highlight_words` (`string[]`) to accent additional domain keywords in box-free V2 subtitles. Alongside the core 4 scene types (`architecture`, `console_setup`, `code_cli`, `exam_tips`), you may use 3 symmetric V2 data templates: **`comparison_matrix`** (max 4 columns / 6 rows), **`timeline_flow`** (`2..6` milestones), and **`kpi_metrics`** (`1..4` cards + optional bar chart `<= 8` bars).

## 5. Studio Dashboard, Multi-Provider AI, Universal MCP & Voice UI (`http://localhost:3030`)
`{{WORKSPACE_ROOT}}/engine/server.mjs` serves a 3-screen Dashboard & Studio UI with real-time SSE (`/api/stream`) and a whitelisted `tech-video-studio` MCP Bridge (`engine/mcp/rpc.mjs` via Stdio `mcp_server.mjs` and loopback HTTP `GET|POST /mcp`, exposing 9 `studio_*` tools + 4 resources `studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`):
1. **Project Dashboard (`view=projects`)**: Overview cards across all courses in `{{WORKSPACE_ROOT}}/`, including open revision counts (course creation stays strictly in Agent Conv 1 `/grill-me`, never on Web UI).
2. **Episode Roadmap & Live Monitor (`view=roadmap`)**: Per-stage episode list with dual Scripting/Video badges, `production.stale` flags, **`🤖 AI Worker & Models`** pill + `BrandHealthGrid` (9 brands: `antigravity`, `openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, `ollama`, `lmstudio`, `manual_web`; `$0` handshakes, zero key leakage, single-selection `◉` + `✓ Đang chọn`, unclipped `Online` badge, `last_selection` persistence), **`✍️ Biên kịch`** on unscripted cards (click any scripted card to open Studio Player; card footers omit `Mở Studio`/`Viết lại KB`), **`✍️ Biên kịch Đợt / Hàng loạt`**, **`☑️ Chọn nhiều`** + `FloatingBatchBar` (**`✍️ Biên kịch hàng loạt (1 Model)`**), paused-job **`▶ Tiếp tục (Resume / Đổi Model)`**, **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal`), **`⚠️ Yêu cầu sửa`** (`RevisionModal`), and 3 right tabs (`Live Activity`, `curriculum.md`, `🛠️ Yêu cầu sửa`).
3. **Studio Player (`view=player`)**: 16:9 stage playback across all 7 visual templates, Storyboard Preview Mode, deep-link `&scene=<scene_id>`, **Multi-Voice A/B Switcher** (`POST /api/episodes/voice-track/activate` & `/delete`), unified **`🎬 Xuất Video ▾`** popover (quality presets + TTS toggle + download link), **`⏱️ Khớp nhịp Animation`** Playhead Calibration inside tab `🎬 Phân cảnh` (`POST /api/episodes/scene-timings`), and **`🛠️ Sửa`** tab with inline quick-add revision form (auto-tracks `currentSceneId`), **`🔄 Gửi AI Sửa Kịch Bản`** button (mandatory rewrite note + `production.stale=true`), `Copy Prompt cho Agent`, Voice override picker, and direct **`🎙️ Tạo Audio (TTS)`**.

## 6. Language & Technical Accuracy
- Narration and explanations are written in natural, clear Vietnamese while preserving authentic English industry terms (e.g., *IAM Role*, *AssumeRole*, *Trust Policy*, *Inline Policy*, *STS*, *Least Privilege*, *Pod*, *Ingress*).
- Never fabricate service limits, API parameter names, IAM action names, or certification exam facts; verify against official documentation or existing course references when unsure.

## 7. Environment & Binary Guardrails
- On Windows Application Control environments, unsigned `.exe` wrappers (`pip.exe`, `esbuild.exe`, `ffmpeg.exe`) are blocked.
- HyperFrames runs without its npm CLI: only `hyperframe.runtime.iife.js` + GSAP UMD are vendored as plain JS (SHA-256 pinned, `node engine/scripts/vendor_libs.mjs --raw-only|--verify-only`); never run `npx hyperframes render` (needs FFmpeg + `esbuild.exe`).
- Always run TTS synthesis with `{{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py"` (pure Python standard library; see [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md) for integrating VoiceStudio or custom HTTP providers).
- Always run the Studio server, state CLI, and headless renderer with `node` (`server.mjs`, `state_cli.mjs`, `render_video.mjs` using Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH`).
