# Tech Course Video Studio

**Language:** [Tiếng Việt](README.md) | **English**

**Tech Course Video Studio** is a complete multi-agent studio for producing technical tutorial video courses—covering curriculum design, scene-by-scene scripting, Vietnamese voiceovers with authentic English technical terminology, synchronized subtitles, animated architecture diagrams, Console/CLI/Code walkthroughs, and Full HD/4K video export—powered by **Universal Multi-Agent Adapters (`Antigravity`, `Claude Code / Desktop`, `Codex`)**, a **3-screen Web Studio (`http://localhost:3030`) with 9 built-in AI channels (ChatGPT, Claude, DeepSeek, Gemini, OpenRouter, Ollama, LM Studio, Antigravity Worker, `$0` Manual Web)**, and a **pure Node.js + Python standard library engine**.

> Built with a strict **Zero External Packages** design: no `npm install`, no `pip install`, and no unsigned `.exe` wrappers (such as `ffmpeg.exe`, `pip.exe`, or `esbuild.exe`), making it compliant with Windows Application Control policies.

---

## Table of Contents

- [1. Key Features](#1-key-features)
- [2. System Requirements](#2-system-requirements)
- [3. Universal Multi-Agent Setup After Cloning / Pulling](#3-universal-multi-agent-setup-after-cloning--pulling)
- [4. Starting the Studio, Multi-Provider AI & Workflow](#4-starting-the-studio-multi-provider-ai--workflow)
- [5. CLI, API & Environment Variable Reference](#5-cli-api--environment-variable-reference)
- [6. Repository Structure](#6-repository-structure)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. Key Features

### 1.1. 3-Conversation Production Pipeline with Sharded State
Every episode's lifecycle is tracked atomically in `<COURSE>/state/<ep-slug>.json` alongside an append-only event stream in `<COURSE>/state/events.jsonl` managed by `engine/state_cli.mjs`:
1. **Conversation 1 — Curriculum Architect (`curriculum-architect`):**
   - Runs a sequential `/grill-me` onboarding interview (target exam/production goal, `10/20/30` episodes, default voice selection from `engine/voices.json`, lab/CLI depth, and immediate rollout scope).
   - Generates `course.json` (with default TTS voice metadata), a staged `curriculum.md` roadmap, and initializes sharded per-episode state files.
2. **Conversation 2 — Script Factory (`episode-producer` / Web Studio AI Engine):**
   - Supports **decoupled 3-stage scripting (`mode: "three_stage"`: `brief.json` → `dialogue.json` + `notes.md` → optional `audio_spine.json` via `tts_pipeline.py --audio-spine` → `script.json`)** alongside `two_pass`/`single_pass`/`auto`/`storyboard_only`, with stage gates & resume (`pause_after: "none" | "brief" | "dialogue"`, `start_from: "brief" | "dialogue" | "visual"`, `lock_audio_spine`), **dynamic per-role provider routing (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`)** via `RoleRoutingPanel` (`BrandHealthGrid` / `AiScriptModal`), and an intermediate review/edit modal (`ScriptingStageModal`).
   - **Strict Scripting vs. Production Separation (`auto_produce`):** Scripting always stops at `script_ready` (or a `pause_after` gate) for Storyboard Preview review and **never auto-runs full TTS/Render** unless `auto_produce === true` (and never when paused at `brief`/`dialogue`). `--audio-spine` runs only when `lock_audio_spine === true` or explicitly requested.
   - Produces single episodes, 3–5 episode waves, or **unlimited multi-select batches (`☑️ Chọn nhiều`)** on a single model, handles open revision tickets, writes `script.json` following the 4-part blueprint (**Real-World Problem `problem` → Animated Architecture `architecture` → Practical Setup & Code `setup` → Exam Tips & Production Traps `exam_tips`**) plus `notes.md`.
   - Automatically validates architecture diagrams against node, label, edge, and zone collisions before advancing to `script_ready`. Rewriting an existing episode from the Player's **`🛠️ Sửa`** tab (**`🔄 Gửi AI Sửa Kịch Bản`**) or batch modal requires explicit change notes and automatically flags `production.stale = true` if prior audio/video existed.
3. **Conversation 3 — Video Factory (`episode-producer` + `video-renderer`):**
   - Synthesizes multi-track voiceovers (`audio/<profile_id>/` + `subtitles.<profile_id>.srt`) with **Layer 1 automatic Subtitle-Cue Alignment** via `engine/tts_pipeline.py`, refines timings via Playhead Calibration (Layer 2) in Studio Player if needed, renders videos offline in headless Chrome (`engine/render_video.mjs`), verifies zero console/page errors, and marks the episode `completed`.

### 1.2. Multi-Provider AI & Zero-Leakage Key Security (`engine/ai/`)
Supports **9 AI channels** directly from the Web Studio (`BrandHealthGrid`) via `GET /api/ai/providers`, `POST /api/ai/providers/credentials`, and `POST /api/ai/providers/test`:
- **Cloud APIs (BYOK):** **OpenAI (ChatGPT)**, **Anthropic (Claude)**, **DeepSeek**, **Google Gemini**, **OpenRouter**.
  - Performs **`$0`-token handshakes** (live chat/reasoning model filtering; DeepSeek checks `/user/balance`; OpenRouter checks `/key` for real remaining limits).
  - Supports an optional **`🧪 Test 1 token`** check to verify active credits.
  - **Strict Key Security:** Credentials live locally in `engine/.ai_credentials.json` (gitignored) merged with OS environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `OPENROUTER_API_KEY`). API responses **never return raw or masked key characters (`sk-...`)**—only `has_credential` booleans and `auth_status` enums.
- **Local AI (Free / Offline):** **Ollama** (`http://127.0.0.1:11434`) & **LM Studio** (`http://127.0.0.1:1234/v1`).
- **Agent MCP Worker:** **Antigravity Worker** (`studio-worker` via `worker_wait.mjs`).
- **`$0` Manual Web Mode (`manual_web`):** Generates a **Prompt Pack** (`POST /api/ai/manual-prompt`) for external web chats, then validates and saves pasted JSON (`POST /api/ai/manual-submit`).
- **Selection Memory & Quota-Safe Pause/Resume:** Persists `last_selection` in `engine/.ai_preferences.json`. If a batch hits `429`/`402`/error mid-run, the job enters `paused` (`⏸️ Hết Quota` / `⏸️ Tạm dừng`), keeps completed episodes intact, and lets you click **`▶ Tiếp tục (Resume / Đổi Model)`** (`POST /api/ai/jobs/resume`) with a different provider or model.

### 1.3. 7 Visual Templates & V2 Motion Engine
The 16:9 stage renderer (`engine/src/components/` + `engine/src/motion/kernel.mjs`) supports 7 visual scene templates:
- **`architecture`**: Animated architecture diagrams with up to 2 nested `zones[]` levels (`client`, `network`, `compute`, `security`, `data`, `danger`), a catalog of **15 multi-color SVG illustrations (`node.svg`, `engine/assets/svg/`)**, smart edge routing (`auto`, `straight`, `orthogonal`, `curved`), `flow_steps`, and `camera_focus` (`x`, `y`, `zoom`).
- **`console_setup`**: Clean Console UI mockups highlighting fields, dropdown options, and action buttons step by step.
- **`code_cli`**: Split/code/terminal layouts with `highlight_phases`, `code_override` (`@shikijs/magic-move`), and `laser_scan` (red scanline sweeps for vulnerabilities/errors).
- **`exam_tips`**: Side-by-side *Wrong vs Right* cards with interactive certification quiz overlays.
- **`comparison_matrix`**: Comparison table (up to 4 columns / 6 rows) with a summary takeaway.
- **`timeline_flow`**: Horizontal or vertical protocol/lifecycle timelines (2–6 milestones).
- **`kpi_metrics`**: Up to 4 animated KPI cards (with sparklines and optional `SharpTag` badges), an optional bar chart (`<= 8` bars), and an `alert_stamp`.
- Supports Phase 2 scene metadata (`world_theme: "dark" | "light"`, `visual_job`, `causal_mechanic`, `sfx_cues`, `bgm_file`) and per-scene `highlight_words` to accent domain keywords in box-free V2 subtitles.

### 1.4. Pure-Python Pluggable Multi-Voice TTS & 2-Layer Sync (`engine/tts_pipeline.py`)
Built strictly on Python standard library modules (`urllib`, `ssl`, `socket`, `wave`, etc.):
- **3-Tier Voice Inheritance:** CLI `--profile` / `script.json` (per-episode override) → `course.json` (course default) → `engine/voices.json` (Studio default — pre-configured with **25 VieNeu-TTS v3 Turbo voices** via `openai_compat` at `http://127.0.0.1:8000/v1/audio/speech`).
- **Dual-Text TTS & `--audio-spine`:** Supports `tts_beats` / `tts_narration` (`normalize_vietnamese_tts_text`) and audio-first synthesis (`--audio-spine` writing `audio_spine.json`) before visual direction compilation.
- **Multi-Voice A/B Preservation:** Synthesizing a new voice writes to `audio/<profile_id>/<scene_id>.(mp3|wav)` + `subtitles.<profile_id>.srt` and updates `script.voice_tracks`—**preserving all previously synthesized voice tracks and timings** for instant `$0` A/B switching.
- **2-Layer Animation-to-Voice Sync:**
  - *Layer 1 (Subtitle-Cue Alignment):* Runs automatically on TTS generation or standalone via `tts_pipeline.py --realign-only [--scene <id>]`, prioritizing 1-based `cue_sentence` + `cue_text`/keyword matching across all 7 templates against measured subtitle timestamps using `scene._base_timings`.
  - *Layer 2 (Playhead Calibration):* Fine-tune individual animation step thresholds right inside Studio Player's **`⏱️ Khớp nhịp Animation`** panel (`POST /api/episodes/scene-timings`).
- **Supported Providers:** `openai_compat` / `voicestudio` (`http://127.0.0.1:8000/v1/audio/speech` or `VOICESTUDIO_API_URL`), `auto`, `edge`, `google`, `custom_http` (see [`engine/TTS_VOICE_SPEC.md`](engine/TTS_VOICE_SPEC.md)).

### 1.5. 3-Screen Web Studio Dashboard (`http://localhost:3030`)
Served by `engine/server.mjs` with live Server-Sent Events (`/api/stream`):
1. **Project Dashboard (`?view=projects`):** Course cards, segmented progress bars, and open revision ticket counts.
2. **Episode Roadmap & Live Monitor (`?view=roadmap`):**
   - Top bar pill **`🤖 AI Worker & Models`** opens **`BrandHealthGrid`** + **`RoleRoutingPanel`** (`🧭 Định tuyến AI theo vai trò`) across all 9 AI brands (single active selection `◉` + `✓ Đang chọn`, active selection header chip, unclipped `Online` badge) and dynamic per-role overrides for `outliner`, `brief_scriptwriter`, `visual_director`, and `repair`.
   - Stage-grouped episodes: click any scripted card directly to open Studio Player (clean card footers omit `Mở Studio` / `🔄 Viết lại KB`; unscripted cards keep **`✍️ Biên kịch`**); `AiScriptModal` defaults to `three_stage` with a compact `RoleRoutingPanel` and `auto_produce` OFF by default, while **`ScriptingStageModal`** lets you inspect/edit `brief.json`, `dialogue.json`, and `audio_spine.json`; plus **`✍️ Biên kịch Đợt / Hàng loạt`**, **`☑️ Chọn nhiều`** + **`FloatingBatchBar`** (**`✍️ Biên kịch hàng loạt (1 Model)`**), paused-job **`▶ Tiếp tục (Resume / Đổi Model)`**, `HeaderJobsTray`, `VoiceStudioModal` (`🎙️ Giọng đọc Khóa học`), and `Live Activity`, `🛠️ Yêu cầu sửa`, and `curriculum.md` right tabs.
3. **Studio Player (`?view=player`):**
   - Synchronized 16:9 playback, silent **Storyboard Preview Mode**, `&scene=<scene_id>` deep-linking, and per-episode voice override picker.
   - **Multi-Voice A/B Switcher** in the top bar to swap active tracks (`POST /api/episodes/voice-track/activate`) or delete unused tracks (`/api/episodes/voice-track/delete`).
   - **Unified `🎬 Xuất Video ▾` Popover:** Combines render quality presets (Hardware, Format/Codec, 720p–4K, FPS, Speed), optional TTS re-synthesis toggle, an editable **`Tên file đầu ra`** field (pre-filled with `<ep-id>`, locked `.mp4`/`.webm` extension badge matching the selected codec, real-time **overwrite collision warning** + 1-click **`✨ Đổi sang <stem>-v2.<ext>`** rename helper), and the primary **`🚀 Bắt đầu Xuất Video`** CTA. *(All video download links/APIs were removed because exports are saved directly into `<COURSE>/episodes/<ep-id>/`.)*
   - **Lesson Detail `📁 Video đã xuất (<N>)` Panel:** Lists every rendered `.mp4`/`.webm` file directly below the Player timeline with **`▶ Xem thử`** (in-app `<video>` preview modal), **`✏️ Chọn tên`** (pre-fills the export filename popover), **`📋 Copy path`**, and **`🗑️ Xóa`** (`POST /api/episodes/video/delete`).
   - **`🎬 Phân cảnh`** tab houses the collapsible **`⏱️ Khớp nhịp Animation`** playhead calibrator; **`🛠️ Sửa`** tab includes an inline quick-add revision form (auto-tracks `currentSceneId` until manually switched) and **`🔄 Gửi AI Sửa Kịch Bản`** launching `AiScriptModal`.

### 1.6. HyperFrames Video Renderer (`engine/render_video.mjs`)
- **Default engine: [HyperFrames](https://github.com/heygen-com/hyperframes)** — each episode is compiled into a standard HyperFrames project (`<COURSE>/episodes/<EP_ID>/hyperframes/index.html`, the 7 templates rewritten in DOM + GSAP, official `hyperframe.runtime.iife.js` vendored offline), then headless Chrome seeks every frame through the HyperFrames protocol and encodes with WebCodecs (H.264/HEVC/VP9 + AAC/Opus) — **no FFmpeg, no npm**. Details: [`engine/HYPERFRAMES_ENGINE.md`](engine/HYPERFRAMES_ENGINE.md).
- **Phase 2 Motion Grammar & `-16 LUFS` Post-Mix:**
  - Continuous `.tvs-bg-grid` ambient drift + stage `creepZoom` (`1.0 → 1.015`, `force3D: false`), `world_theme` (`dark`/`light`) alternation, smart same-`part` overlaps (with `140ms` dark breathers on `part` changes), `SharpTag` badges, and `causal_mechanic` entrance rotation.
  - WebAudio SFX bus mixing 6 procedural 48kHz WAVs (`engine/assets/sfx/*.wav`, `-33ms` lead), optional looping `bgm_file` (`1800Hz -6dB` peaking EQ carve via `OfflineAudioContext`), and pure-JS **ITU-R BS.1770-4 `-16 LUFS`** normalization + soft limiter (`0.8414` ≈ `-1.5 dBTP`) in `engine/src/audio_dsp.mjs` and `engine/src/hf_encoder.mjs`.
- **Phase 3 DOM Layout & Safe-Zone QC Gate (`engine/hyperframes/layout_qc.mjs`):**
  - Automatically inspects the 1920×1080 DOM composition at `[0.1, 0.5, 0.9]` checkpoints for 6 layout defects: `viewport_overflow`, `stage_overflow`, `topbar_collision`, `subtitle_collision`, `subtitle_overflow`, and `clipped_text` (plus `topbar_title_truncated` warnings).
  - Enabled by default in `render_video.mjs` (`--check-layout`, disable via `--no-check-layout`, fail render on errors via `--qc-strict`), and available standalone via `snapshot.mjs --check-layout [--qc-strict]` and `verify_video.mjs --check-layout [--qc-strict]`.
- The previous Canvas 2D exporter (`window.__STUDIO_RENDER_OFFLINE__`) remains available via `--engine legacy` or the **Engine render** choice in the **`🎬 Xuất Video ▾`** popover.
- Configurable resolution (`720p`, `1080p`, `1440p`, `2160p`), FPS (`24`, `30`, `60`), container (`mp4`, `webm`), playback speed (`1x`–`2x`), and hardware mode (`auto`, `gpu`, `cpu`).

### 1.7. Universal MCP Bridge (Stdio + Loopback HTTP `/mcp`)
- Shared `engine/mcp/rpc.mjs` core powering both **Stdio** (`engine/mcp_server.mjs`) and **Loopback HTTP** (`GET|POST http://127.0.0.1:3030/mcp`), compatible with **Antigravity**, **Claude Code / Claude Desktop**, and **Codex / Agent Skills**.
- Exposes **9 tools** (`studio_worker_heartbeat`, `studio_poll_ai_job`, `studio_claim_ai_job`, `studio_get_context`, `studio_report_ai_progress`, `studio_validate_script`, `studio_submit_episode_script`, `studio_complete_ai_job`, `studio_fail_ai_job`) and **4 MCP resources** (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).
- `engine/worker_wait.mjs` maintains a 5-second heartbeat and long-polls at **0 AI token cost** while idle.

---

## 2. System Requirements

| Requirement | Version / Details | Notes |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.0.0` | Required for global `WebSocket` in `engine/render_video.mjs`. Zero `npm install` needed. |
| **Python** | `>= 3.10` | Uses stdlib only (`engine/tts_pipeline.py`). Set `PYTHON_BIN=python3` if needed. |
| **Google Chrome** | Installed locally | Windows defaults to `C:\Program Files\Google\Chrome\Application\chrome.exe`. Set `CHROME_PATH` for custom paths. |
| **Internet Access** | Required for UI & Cloud AI/TTS | Frontend imports ESM libraries from `https://esm.sh/`; default TTS (`edge`/`google`) and cloud LLMs call online endpoints *(or run offline with Ollama/LM Studio + VoiceStudio)*. |
| **AI Agent / API** | Optional | Use **Antigravity**, **Claude Code / Desktop**, **Codex**, any BYOK API key, or **Manual `$0` Web Prompt Pack**. |

---

## 3. Universal Multi-Agent Setup After Cloning / Pulling

### Step 1: Clone the repository

```powershell
git clone git@github.com:Thanhloi-lab/TechVideoStudio.git
cd TechVideoStudio
```

### Step 2: Run `setup.mjs` (Single Source of Truth -> Multi-Agent Adapters)

From the single source of truth (`AGENTS.md` + `plugin/tech-video-studio/`), `setup.mjs` + `engine/setup_adapters.mjs` generate agent-specific adapters:

- **Install for All Supported Agents (Antigravity + Claude Code + Codex) — Recommended:**
  ```powershell
  node setup.mjs --agents all
  ```
  Generates (all gitignored so `git status` stays clean):
  - **Antigravity:** `.agents/plugins/tech-video-studio/` (`plugin.json`, `mcp_config.json`, `rules/AGENTS.md`, 4 skills).
  - **Claude Code:** `.claude/skills/*/SKILL.md` + `.mcp.json` at repo root *(safely merged, preserving existing MCP servers; paired with [`CLAUDE.md`](CLAUDE.md))*.
  - **Codex / Open Agent Skills:** `.agents/skills/*/SKILL.md` *(paired with [`AGENTS.md`](AGENTS.md))*.

- **Antigravity Workspace Only (100% backward compatible default):**
  ```powershell
  node setup.mjs
  ```
  *(On Windows, you can also run `.\setup.bat`.)*

- **Merge into Claude Desktop OS Config:**
  ```powershell
  node setup.mjs --agents claude --claude-desktop
  ```
  *Creates a timestamped `<path>.<timestamp>.bak` backup before merging `tech-video-studio` into `claude_desktop_config.json`, preserving all other MCP servers.*

- **Global Antigravity or Read-Only Diagnostics:**
  ```powershell
  node setup.mjs --global                 # Install to ~/.gemini/config/plugins/tech-video-studio
  node setup.mjs --global --agy           # Install via 'agy plugin install' if available
  node setup.mjs --all                    # Install into both workspace and global Antigravity paths
  node setup.mjs --check --json           # Inspect Node/Python/Chrome, adapters, and boolean-only OS env keys
  ```

### Step 3: Reload IDE / Agent & Start Web Studio (Port `3030`)

```powershell
node engine/server.mjs
```

Open **`http://localhost:3030`** in your browser.

---

## 4. Starting the Studio, Multi-Provider AI & Workflow

| Stage | How to Run | Notes |
| :--- | :--- | :--- |
| **1. Curriculum (`curriculum-architect`)** | Prompt Antigravity / Claude Code / Codex: *"Create a new video course on Kubernetes (CKA) at K8S"* | Runs `/grill-me`, writes `course.json`, `curriculum.md`, `state/*.json`. |
| **2a. Web UI Scripting (9 AI Brands)** | Click **`🤖 AI Worker & Models`** -> select provider/model -> click **`✍️ Biên kịch`** (unscripted), or **`☑️ Chọn nhiều`** -> **`✍️ Biên kịch hàng loạt (1 Model)`**; to revise a scripted episode, open it -> **`🛠️ Sửa`** tab -> **`🔄 Gửi AI Sửa Kịch Bản`** | Auto-validates diagrams, persists `last_selection`, supports `⏸️` pause & **`▶ Tiếp tục (Resume / Đổi Model)`** on quota exhaustion. |
| **2b. MCP Worker (`studio-worker`)** | Open an Antigravity chat and type **`Bật VideoMaker Worker`** (runs `worker_wait.mjs` at 0 idle token cost) | Executes `script_episode` / `script_batch` (max 5 episodes/batch). |
| **2c. `$0` Manual Web (`manual_web`)** | Select **Manual Web** in `AiScriptModal` -> **`📋 Tạo Prompt Pack`** -> paste JSON -> **`✅ Kiểm tra & Lưu Kịch bản`** | Zero API cost while preserving full schema & diagram validation. |
| **3. Audio, Sync & Video (`video-renderer`)** | Run `tts_pipeline.py` + `render_video.mjs`, or in Studio Player click **`🎙️ Tạo Audio (TTS)`** / swap A/B voice tracks / calibrate **`⏱️ Khớp nhịp Animation`** / open **`🎬 Xuất Video ▾`** -> customize filename if keeping multiple versions -> **`🚀 Bắt đầu Xuất Video`** | Preserves prior voice tracks in `audio/<profile_id>/`, saves multiple named videos directly in `<COURSE>/episodes/<ep-id>/` (preview/manage in **`📁 Video đã xuất`**), and flags `production.stale` on track/timing changes. |

---

## 5. CLI, API & Environment Variable Reference

### 5.1. State Management & Diagram Validation (`engine/state_cli.mjs`)

```powershell
node engine/state_cli.mjs init --course <COURSE>
node engine/state_cli.mjs summary --course <COURSE> [--json]
node engine/state_cli.mjs next --course <COURSE> --stage <scripting|production> [--limit 5] [--json]
node engine/state_cli.mjs set --course <COURSE> --ep <EP_ID> --stage <scripting|production> --status <STATUS> [--owner "..."] [--note "..."] [--tts-done true] [--video-done true] [--verified true]
node engine/state_cli.mjs validate-diagrams --course <COURSE> [--ep <EP_ID>] [--json]
node engine/state_cli.mjs svg-list [--json]
node engine/state_cli.mjs sync --course <COURSE>
node engine/state_cli.mjs revisions --course <COURSE> [--ep <EP_ID>] [--status open|in_progress|resolved|all]
node engine/state_cli.mjs add-revision --course <COURSE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc "<details>"
node engine/state_cli.mjs resolve-revision --course <COURSE> --ep <EP_ID> --rev <REV-001> --note "<fix summary>"
```

### 5.2. TTS (`engine/tts_pipeline.py`) & Headless Video Rendering (`engine/render_video.mjs`)

```powershell
python engine/tts_pipeline.py --episode "<COURSE>/episodes/<EP_ID>/script.json" --course "<COURSE>/course.json" --json
python engine/tts_pipeline.py --audio-spine "<COURSE>/episodes/<EP_ID>/dialogue.json" --course "<COURSE>/course.json" --json
python engine/tts_pipeline.py --realign-only --episode "<COURSE>/episodes/<EP_ID>/script.json" [--scene <SCENE_ID>] [--profile <PROFILE_ID>] --json
python engine/tts_pipeline.py --list-profiles
python engine/tts_pipeline.py --discover-voicestudio --json
python engine/tts_pipeline.py --preview --profile edge-hoaimy --text "Xin chào" --out preview.mp3

node engine/scripts/generate_sfx_assets.mjs   # (Optional) regenerate the 6 procedural 48kHz SFX WAVs in engine/assets/sfx/
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> --port 3030 --format mp4 --codec h264 --resolution 1080p --fps 60 --speed 1 --hardware auto [--output <FILENAME>] [--workers 1..8] [--engine hyperframes|legacy] [--check-layout|--no-check-layout] [--qc-strict]
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> --compile-only   # build the HyperFrames project only
node engine/hyperframes/snapshot.mjs --course <COURSE> --episode <EP_ID> --scene 0 --at 0.1,0.5,0.9 --check-determinism [--check-layout] [--qc-strict]
node engine/hyperframes/verify_video.mjs --course <COURSE> --episode <EP_ID> --file <EP_ID>.mp4 --frames 3,30 [--check-layout] [--qc-strict]

# Run automated 3-Stage Scripting, E2E Chrome UI, and HyperFrames (-16 LUFS) test suites
node engine/test_phase1_three_stage.mjs
node engine/test_ai_bridge_and_templates.mjs
node engine/test_hyperframes.mjs
```

### 5.3. Key AI & MCP Server Endpoints (`engine/server.mjs`)

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/ai/providers[?force=1]` | Returns all 9 AI brands, auth status (`verified`/`invalid`/`quota_exhausted`/`unconfigured`, etc.), live models, `last_selection`, and `pipeline_routing` (zero key leakage). |
| `POST /api/ai/providers/credentials` | Saves/updates/clears API keys or custom `base_url` in `engine/.ai_credentials.json` and runs a `$0` handshake. |
| `POST /api/ai/providers/test` | Re-runs handshake or sends a minimal `ping_one_token: true` probe. |
| `POST /api/ai/preferences/routing` | Saves dynamic per-role provider routing (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`) into `engine/.ai_preferences.json`. |
| `POST /api/ai/jobs` | Dispatches `script_episode` or `script_batch` (supports `mode: "three_stage"`, `pause_after`, `start_from`, `lock_audio_spine`, `role_routing`, `auto_produce` default `false`, `rewrite_notes` / `rewrite_note`, unlimited episodes for built-in providers). |
| `GET /api/episodes/scripting-artifacts` & `POST /api/episodes/{brief,dialogue,audio-spine}` | Inspects/edits `brief.json`, `dialogue.json` and synthesizes pre-visual audio timings (`audio_spine.json`). |
| `POST /api/ai/jobs/resume` | Resumes a `paused`/`failed` job across remaining episodes (allows switching `provider_id` / `model`). |
| `POST /api/ai/manual-prompt` & `manual-submit` | Generates a `$0` Prompt Pack and validates/saves pasted script JSON. |
| `POST /api/episodes/voice-track/activate` & `delete` | Instantly swaps active Multi-Voice A/B tracks (`0` TTS calls) or deletes unused tracks. |
| `POST /api/episodes/scene-timings` | Persists Playhead calibration (`action: "save"`) or invokes Layer 1 (`action: "auto_align"` via `--realign-only`). |
| `POST /api/jobs/run-production` | Starts TTS/Render production (accepts optional `output_filename` to keep multiple distinct renders per episode). |
| `POST /api/episodes/video/delete` | Deletes a specific `.mp4`/`.webm` file from an episode folder and reconciles `state/<ep>.json` (guarded against active jobs). |
| `GET\|POST /mcp` | Loopback HTTP Streamable MCP endpoint (9 `studio_*` tools + 4 `studio://*` resources). |

### 5.4. Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` / `VIDEO_MAKER_PORT` | `3030` | HTTP port for `server.mjs`, `mcp_server.mjs`, and `worker_wait.mjs`. |
| `VIDEO_MAKER_WORKSPACE_ROOT` | Parent directory of `engine/` | Overrides where course folders are read/written. |
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Chrome/Chromium binary path for macOS, Linux, or custom Windows installs. |
| `PYTHON_BIN` | `python` | Python executable spawned by `server.mjs` (e.g., `python3` on Linux/macOS). |
| `VOICESTUDIO_BASE_URL` / `VOICESTUDIO_API_URL` | `http://localhost:8000` | Local VoiceStudio API base URL or speech endpoint. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | *(optional)* | Auto-detected on backend startup (or stored locally via Web UI in `engine/.ai_credentials.json`). |

---

## 6. Repository Structure

```text
TechVideoStudio/
├── AGENTS.md                         # Canonical workspace rules (Antigravity, Codex, Universal)
├── CHANGELOG.md                      # Upgrade changelog & verified test results
├── CLAUDE.md                         # Thin adapter (~20 lines) pointing Claude Code/Desktop to AGENTS.md
├── GUIDE.md                          # Agent-executable & manual setup runbook
├── README.md                         # Vietnamese documentation
├── README.en.md                      # English documentation (this file)
├── setup.mjs                         # Pure-Node multi-agent adapter installer & env checker
├── setup.bat                         # Windows convenience launcher for setup.mjs
├── .gitignore                        # Excludes local courses (<COURSE>/, *.mp3, *.mp4...), .agents/, .claude/, .mcp.json, .env*, .ai_*.json
├── plugin/
│   └── tech-video-studio/            # Portable plugin bundle (Single Source of Truth for setup_adapters.mjs)
│       ├── plugin.json
│       ├── mcp_config.json
│       ├── README.md
│       ├── assets/logo.svg
│       ├── rules/AGENTS.md
│       └── skills/                   # curriculum-architect, episode-producer, studio-worker, video-renderer
├── engine/                           # Studio server, multi-provider AI, MCP, TTS, state CLI & exporter
│   ├── server.mjs                    # 3-screen Web Studio server + API + SSE + /mcp
│   ├── mcp_server.mjs                # Stdio MCP bridge for Antigravity / Claude / Codex
│   ├── setup_adapters.mjs            # Generates Antigravity, Claude Code/Desktop & Codex adapters
│   ├── worker_wait.mjs               # Zero-token idle long-poll listener for studio-worker
│   ├── state_cli.mjs                 # Sharded state, revision queue & diagram validator
│   ├── tts_pipeline.py               # Pure-stdlib Multi-Voice A/B TTS, subtitles & Layer 1 alignment
│   ├── render_video.mjs              # Video render CLI (default HyperFrames, --engine legacy = Canvas 2D)
│   ├── hyperframes/                  # HyperFrames engine: compiler, 7 DOM+GSAP templates, CDP renderer, snapshot, layout_qc
│   ├── HYPERFRAMES_ENGINE.md         # HyperFrames engine design & operations notes
│   ├── UPGRADE_CHECKLIST.md          # 3-phase upgrade checklist & handover state
│   ├── assets/                       # Rich architecture SVG catalog (svg/) & 48kHz procedural SFX WAVs (sfx/)
│   ├── scripts/                      # SHA-256 pinned runtime vendor & SFX WAV generator (generate_sfx_assets.mjs)
│   ├── test_phase1_three_stage.mjs   # Automated tests for 3-stage scripting, dynamic routing & Audio Spine
│   ├── test_ai_bridge_and_templates.mjs  # 17-section automated E2E & Chrome UI test suite
│   ├── test_hyperframes.mjs          # HyperFrames engine test suite (determinism, Light/Dark, -16 LUFS, layout QC)
│   ├── voices.json                   # Voice profile catalog (incl. VieNeu-TTS v3 Turbo)
│   ├── MOTION_SPEC.md                # V2 motion engine specification
│   ├── TTS_VOICE_SPEC.md             # Custom TTS provider specification
│   ├── ai/                           # Multi-provider credentials/handshakes, 3-stage LLM runner, batch queue broker
│   ├── mcp/                          # Shared JSON-RPC handler (9 tools + 4 resources) for Stdio & HTTP
│   ├── public/index.html             # Web UI entry point & esm.sh importmap
│   └── src/                          # Player UI, RoleRoutingPanel, ScriptingStageModal, 7 templates, audio_dsp (-16 LUFS), exporter
└── <COURSE>/                         # Local course workspace created on demand (e.g., AWS/, K8S/ — gitignored)
```

---

## 7. Troubleshooting

- **`render_video.mjs` reports `Chrome executable not found`:**
  Run `node setup.mjs --check` to see which Chrome path was detected, then set `CHROME_PATH` before running `render_video.mjs` or `server.mjs`.
- **Python command fails on macOS/Linux (`spawn python ENOENT`):**
  Launch the server with `PYTHON_BIN=python3 node engine/server.mjs`.
- **AI scripting reports unconfigured provider or quota exhaustion:**
  Click **`🤖 AI Worker & Models`** in the Roadmap header to select any of the 9 brands (or **`Manual Web $0`**), run a `$0` handshake / `🧪 Test 1 token`, or click **`▶ Tiếp tục (Resume / Đổi Model)`** on a paused job to switch models without losing completed episodes.
- **Skills or MCP tools do not appear right after `setup.mjs --agents all`:**
  Start a new conversation or reload your Antigravity / Claude Code / Claude Desktop / Codex session so the newly generated adapters are loaded.
- **Blank Web UI or frontend module import errors:**
  Ensure Internet access is available, as `engine/public/index.html` and `engine/src/exporter.mjs` load ESM modules from `https://esm.sh/`.
