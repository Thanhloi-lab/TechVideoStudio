# Tech Course Video Studio (`tech-video-studio`)

A portable multi-agent plugin and pure-Node/Python Web Studio for building complete technical tutorial video courses—roadmaps, 4-part scene scripts, Vietnamese + English-term voiceovers with **Multi-Voice A/B switching**, **2-layer animation-to-voice synchronization**, animated architecture diagrams, clean console mockups, code/CLI walkthroughs, and offline Full HD/4K export—inside your VideoMaker workspace (`{{WORKSPACE_ROOT}}`).

> **Zero External Packages:** Pure Node.js (`>= 22`) + Python standard library (`>= 3.10`) + Google Chrome. Never runs `npm install`, `pip install`, or unsigned `.exe` wrappers (`ffmpeg.exe`, `pip.exe`, `esbuild.exe`), keeping full compatibility with Windows Application Control.

---

## Multi-Agent Installation (`setup.mjs`)

Run from the root of your cloned repository:

```powershell
# Recommended: Install adapters for Antigravity, Claude Code, and Codex at once
node setup.mjs --agents all

# Default: Antigravity workspace plugin only (.agents/plugins/tech-video-studio)
node setup.mjs

# Include Claude Desktop global config (creates timestamped .bak backup before merge)
node setup.mjs --agents claude --claude-desktop

# Global Antigravity install or read-only environment diagnostics
node setup.mjs --global
node setup.mjs --check --json
```

---

## Supported Agent Workflows & Skills

1. **Curriculum Architect (`curriculum-architect`):** Runs sequential `/grill-me` onboarding (goal, `10/20/30` episode scale, default voice from `engine/voices.json`, lab depth, rollout scope), generates `<COURSE>/course.json` and `curriculum.md`, and initializes sharded state via `engine/state_cli.mjs init`.
2. **Episode Producer (`episode-producer`):** Produces `script.json` (4-part blueprint: `problem`, `architecture`, `setup`, `exam_tips`) across **7 symmetric 16:9 visual templates** (`architecture` with nested `zones[]`, **15 rich SVG illustrations via `node.svg`** & clean `auto` edge routing, `console_setup`, `code_cli` with Shiki Magic Move & `laser_scan`, `exam_tips`, `comparison_matrix`, `timeline_flow`, `kpi_metrics` with `SharpTag`), supports decoupled **3-stage scripting (`brief -> dialogue -> audio_spine -> script`)** + `cue_sentence`/`cue_text` 1:1 sync, and `notes.md`, validated by `validate-diagrams`.
3. **Video Renderer (`video-renderer`):** Synthesizes multi-voice TTS audio + `subtitles.srt` via `engine/tts_pipeline.py` (including VieNeu-TTS v3 Turbo presets) and exports 720p–4K `.webm`/`.mp4` offline via headless Chrome CDP (`engine/render_video.mjs` + HyperFrames Phase 2 Light/Dark grammar, smart overlaps, procedural SFX bus, carved BGM & pure-JS BS.1770 `-16 LUFS` normalization).
4. **Standby Web Worker (`studio-worker`):** Runs `engine/worker_wait.mjs` at **0 idle token cost** to handle `script_episode` / `script_batch` jobs dispatched from the Web UI.

---

## Universal MCP Bridge (Stdio + Loopback HTTP `/mcp`)

Powered by a single JSON-RPC core (`engine/mcp/rpc.mjs`), `tech-video-studio` supports both **Stdio** (`engine/mcp_server.mjs`) and **Loopback HTTP** (`GET|POST http://127.0.0.1:3030/mcp`), exposing:
- **9 Tools:** `studio_worker_heartbeat`, `studio_poll_ai_job`, `studio_claim_ai_job`, `studio_get_context`, `studio_report_ai_progress`, `studio_validate_script`, `studio_submit_episode_script`, `studio_complete_ai_job`, `studio_fail_ai_job`
- **4 Resources:** `studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`

---

## 3-Screen Web Studio & 9 AI Channels (`http://localhost:3030`)

Start the server with `node engine/server.mjs` and open `http://localhost:3030`:

1. **Project Dashboard (`?view=projects`):** Cross-course progress cards, segmented stage bars, open revision counts, and live SSE (`/api/stream`).
2. **Episode Roadmap & Live Monitor (`?view=roadmap`):**
   - **`🤖 AI Worker & Models` (`BrandHealthGrid`):** Supports **9 AI brands** (`antigravity`, `openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, `ollama`, `lmstudio`, `manual_web`) with `$0` handshakes, zero key leakage (`engine/.ai_credentials.json`), `🧪 Test 1 token`, and `last_selection` memory (`engine/.ai_preferences.json`).
   - **Clean Episode Cards & Batch Dispatch:** Click any scripted card to open Studio Player; unscripted cards retain `✍️ Biên kịch`; **`☑️ Chọn nhiều`** + **`FloatingBatchBar`** dispatches unlimited-size batches with quota-safe pause (`⏸️`) and **`▶ Tiếp tục (Resume / Đổi Model)`**.
   - **Right Tabs:** `📡 Live Activity`, `🛠️ Yêu cầu sửa`, and collapsible `🗺️ curriculum.md`.
3. **Studio Player (`?view=player`):**
   - **Unified `🎬 Xuất Video ▾` Popover:** Quality presets (Hardware, Format/Codec, 720p–4K, FPS, Speed), optional TTS re-synthesis checkbox, primary export CTA, and existing video download link.
   - **Multi-Voice A/B Switcher:** Switch instantly between synthesized voice tracks (`audio/<profile_id>/` + `subtitles.<profile_id>.srt`) via `POST /api/episodes/voice-track/activate` or remove unused tracks via `/api/episodes/voice-track/delete` (`0` re-synthesis cost).
   - **2-Layer Animation-to-Voice Sync:**
     - *Layer 1 (Subtitle-Cue Alignment):* `tts_pipeline.py` auto-aligns animation step timings from `_base_timings` against measured subtitle timestamps (also runnable via `--realign-only --scene <id>`).
     - *Layer 2 (Playhead Calibration):* Expand **`⏱️ Khớp nhịp Animation`** inside tab `🎬 Phân cảnh` to stamp steps to the playhead, trigger `⚡ Tự căn lại theo phụ đề`, and persist via `POST /api/episodes/scene-timings`.
   - **Inline Revision & AI Rewrite (`🛠️ Sửa` tab):** Quick-add revision form (auto-tracks `currentSceneId` until manually switched) + **`🔄 Gửi AI Sửa Kịch Bản`** button launching `AiScriptModal` with open tickets & rewrite notes.

---

## Pluggable TTS Providers (`engine/tts_pipeline.py`)

3-tier voice inheritance (`CLI / script.json` -> `course.json` -> `engine/voices.json`), storing tracks under `audio/<profile_id>/<scene_id>.(mp3|wav)`:
- `auto` (default: Microsoft Edge ReadAloud neural voices with Google TTS fallback)
- `edge` / `google`
- `voicestudio` (`http://localhost:8000/v1/audio/speech` or `VOICESTUDIO_API_URL`)
- `openai_compat` / `custom_http` (see [`engine/TTS_VOICE_SPEC.md`](../../engine/TTS_VOICE_SPEC.md))
