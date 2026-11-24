# Tech Course Video Studio (`tech-video-studio`)

A portable Antigravity plugin and pure-Node/Python Web Studio for building complete deep-dive technical tutorial video courses—roadmaps with independent curriculum review, multi-part scripts (`<= 5m` per review part) with independent content review, Vietnamese + English-term voiceovers with **Multi-Voice A/B switching** and **Audio-Spine beat reuse**, **2-layer animation-to-voice synchronization**, 11 animated visual templates, and offline Full HD/4K export via HyperFrames—inside your VideoMaker workspace (`{{WORKSPACE_ROOT}}`).

> **Zero External Packages:** Pure Node.js (`>= 22`) + Python standard library (`>= 3.10`) + Google Chrome. Never runs `npm install`, `pip install`, or unsigned `.exe` wrappers (`ffmpeg.exe`, `pip.exe`, `esbuild.exe`), keeping full compatibility with Windows Application Control.

---

## Single Source of Truth Installation (`npx` or `setup.mjs`)

Install on any machine without manual `git clone` (auto-detects locally installed AI Agents, optionally installs Python/Chrome & bundled **VieNeu-TTS v3 Turbo** on port `8000` without Docker):

```powershell
# Interactive setup (detected AI agents + optional Python/Chrome + bundled VieNeu-TTS)
npx github:Thanhloi-lab/TechVideoStudio

# Non-interactive full setup (including VieNeu-TTS v3 Turbo ONNX on port 8000)
npx github:Thanhloi-lab/TechVideoStudio setup --install-deps --with-vieneu --yes

# Start Web Studio (port 3030) + VieNeu-TTS (port 8000) together
npx github:Thanhloi-lab/TechVideoStudio studio
```

Or run from the root of your cloned repository (`plugin/tech-video-studio/` + `AGENTS.md` are the SSOT):

```powershell
# Recommended: Sync Antigravity plugin into workspace + global (~/.gemini/config/plugins)
node setup.mjs --workspace --global

# Workspace only (.agents/plugins/tech-video-studio) or Global only
node setup.mjs --workspace
node setup.mjs --global

# Read-only environment & adapter diagnostics
node setup.mjs --check --json
```

*(Note: `--agents claude|codex|all` and `--claude-desktop` remain available if explicitly opting into external agent adapters.)*

---

## Supported Agent Workflows & Skills (6 Skills)

1. **Curriculum Architect (`curriculum-architect`):** Runs sequential `/grill-me` onboarding (goal, deep-dive depth, `10/20/30` episode scale, default voice from `engine/voices.json`, lab depth, rollout scope), generates `<COURSE>/course.json` (`course_depth: "deep_dive"`, `max_part_duration_sec: 300`, `estimated_duration_min`, `estimated_parts`, `prerequisites[]`, `learning_objectives[]`, `must_cover_concepts[]`) and `curriculum.md`, passes the mandatory **`curriculum-reviewer`** gate (`curriculum_review.md`), and initializes sharded state via `engine/state_cli.mjs init`.
2. **Curriculum Reviewer (`curriculum-reviewer`):** Independent fresh-context subagent auditing `course.json` + `curriculum.md` across 5 criteria (Coverage Depth, Topic Overload & `<= 5m` Part Sizing, Prerequisite Chain, Lab & Production Trap Depth, Duration-to-Depth Realism) -> `<COURSE>/curriculum_review.md` (`APPROVED` / `REVISE`).
3. **Episode Producer (`episode-producer`):** Produces deep-dive multi-part scripts in **`deep_course`** mode: Master Brief (`brief.json` with `episode_canon` + `parts[] <= 5m`) -> `content-reviewer` (`brief_review.md`) -> per-part `parts/<part_id>/dialogue.json` + `notes.md` -> mandatory independent `content-reviewer` (`parts/<part_id>/review.md`) -> optional `audio_spine.json` -> `parts/<part_id>/script.json` across **11 symmetric 16:9 visual templates** (`architecture`, `console_setup`, `code_cli`, `exam_tips`, `comparison_matrix`, `timeline_flow`, `kpi_metrics`, plus `sequence_diagram`, `memory_layout`, `code_diff`, `concept_breakdown`) enforcing the **Visual Variety Guard** -> user approval (`set-part`) -> deterministic `merge-parts` (`script.json`, remapped audio/`voice_tracks`, offset `subtitles.srt`, TOC `notes.md`). Strictly stops at `script_ready` unless `auto_produce === true`.
4. **Content Reviewer (`content-reviewer`):** Independent fresh-context subagent auditing `brief.json` (`brief_review.md`) and each `parts/<part_id>/dialogue.json` + `notes.md` (`parts/<part_id>/review.md`) across 5 criteria (Technical Accuracy, Under-the-Hood Depth, Self-Learner Clarity, `episode_canon` & Bridge Continuity, `<= 5m` Budget & 100% `must_cover_concepts` Coverage). Author must never self-approve.
5. **Video Renderer (`video-renderer`):** Synthesizes multi-voice TTS audio + `subtitles.srt` via `engine/tts_pipeline.py` (automatically reusing matching `audio_spine.json` beats with zero duplicate TTS calls and aligning cues across all 11 templates) and exports 720p–4K `.webm`/`.mp4` offline via headless Chrome CDP + **HyperFrames** (sole render engine, default **`30` fps**, `--part <part_id>` support for 5-min previews, pure-JS BS.1770 `-16 LUFS` normalization, and **DOM Layout & Safe-Zone QC Gate**).
6. **Standby Web Worker (`studio-worker`):** Runs `engine/worker_wait.mjs` at **0 idle token cost** to handle `script_episode` / `script_batch` jobs dispatched from the Web UI (passing its active session model or `"connected-agent"` without hardcoded model strings).

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
   - **`🤖 AI Worker & Models` (`BrandHealthGrid` + `RoleRoutingPanel`):** Supports **9 AI brands** (`antigravity`, `openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, `ollama`, `lmstudio`, `manual_web`) with `$0` handshakes, zero key leakage (`engine/.ai_credentials.json`), `🧪 Test 1 token`, `last_selection` memory, and dynamic per-role routing across **5 roles** (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair` via `POST /api/ai/preferences/routing`) in `engine/.ai_preferences.json`.
   - **Multi-Part Scripting & Review Modal (`ScriptingStageModal`):** `AiScriptModal` runs unified `deep_course` mode (`auto_produce: false` default); `ScriptingStageModal` provides a **Part selector**, **`review.md` tab**, **Approve Part** (`POST /api/episodes/part/approve`), and **Merge Parts** (`POST /api/episodes/merge-parts`) alongside `brief.json`, `dialogue.json`, and `audio_spine.json`.
   - **Right Tabs:** `📡 Live Activity`, `🛠️ Yêu cầu sửa`, and collapsible `🗺️ curriculum.md`.
3. **Studio Player (`?view=player`):**
   - **Part Switcher & 11 Templates:** Switch between merged episode and individual parts (`GET /api/episodes/part`), preview all 11 visual templates silently, and deep-link to scenes.
   - **Unified `🎬 Xuất Video ▾` Popover & `📁 Video đã xuất`:** HyperFrames sole renderer (default 30fps, Format/Codec, 720p–4K, Speed, optional `--part` preview, optional TTS toggle), editable output filename with collision warning, and in-app video management.
   - **Multi-Voice A/B Switcher & 2-Layer Sync:** Instant A/B switching (`POST /api/episodes/voice-track/activate` / `delete`), Layer 1 (`--realign-only`), and Layer 2 **`⏱️ Khớp nhịp Animation`** (`POST /api/episodes/scene-timings`).

---

## Pluggable TTS Providers (`engine/tts_pipeline.py`)

3-tier voice inheritance (`CLI / script.json` -> `course.json` -> `engine/voices.json`), storing tracks under `audio/<profile_id>/<scene_id>.(mp3|wav)`:
- `auto` (Microsoft Edge ReadAloud neural voices with Google TTS fallback)
- `edge` / `google` / `voicestudio` / `openai_compat` / `custom_http` (see [`engine/TTS_VOICE_SPEC.md`](../../engine/TTS_VOICE_SPEC.md))
