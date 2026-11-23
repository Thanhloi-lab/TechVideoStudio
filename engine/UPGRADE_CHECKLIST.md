# TechVideoStudio — 3-Phase Upgrade Checklist & Context Handover

> **Purpose:** Persistent execution tracker for upgrading `TechVideoStudio` with decoupled 3-stage scriptwriting, dynamic per-role AI provider routing, Dual-Text TTS + Audio-Spine locking, HyperFrames micro-motion/theme upgrades, WebAudio SFX/LUFS post-mix, and automated DOM/Audio QC gates. Update checkboxes and the **Handover Snapshot** at the end of every phase so work can resume seamlessly across context compaction or new sessions.

---

## Global Invariants (Never Violate)
1. **Zero External Binaries (WDAC Safe):** Pure Node.js (`>= 22`), pure Python stdlib (`>= 3.10`), pure browser ESM (`React.createElement` via `h(...)`, zero JSX/build step), Google Chrome headless. Never invoke `ffmpeg.exe`, `ffprobe.exe`, `pip.exe`, `esbuild.exe`, or install npm/pip packages.
2. **Dynamic AI Agent / Provider Routing:** Never hardcode any specific AI agent or model string (e.g., `"Gemini 4 Argon"`, `"Hydrogen"`, `"claude"`, `"openai"`) in runtime routing or execution fallbacks. Always resolve dynamically via: explicit request override → `pipeline_routing` in `engine/.ai_preferences.json` → job's selected provider/model → `last_selection` → first ready provider.
3. **Keep 7 Deterministic DOM+GSAP Templates:** Do not let LLMs emit raw HTML/GSAP per episode. Compile visual upgrades through `engine/hyperframes/compiler.mjs` and `engine/hyperframes/runtime/scenes/*.mjs` (`gsap.config({ force3D: false })`, deterministic `window.__hf.seek(t)`).
4. **Strict Scripting vs. Production Separation:** Scripting stages (`runner.mjs`, `episode-producer`, `studio-worker`) must never auto-run TTS/video rendering unless `auto_produce === true` (and never when paused at a scripting gate).
5. **100% Backward Compatibility:** Existing courses (`REDIS`) and legacy `script.json` files without `brief.json`, `dialogue.json`, `tts_text`, `world_theme`, `sfx_cues`, or `causal_mechanic` must continue validating, playing, synthesizing TTS, and rendering cleanly.

---

## Phase 1 — Decoupled 3-Stage Scriptwriting, Dynamic Provider Routing & Dual-Text TTS
- [x] **1.1 Persistent Checklist:** Create `engine/UPGRADE_CHECKLIST.md` with invariants, 3-phase checklists, and Handover Snapshot.
- [x] **1.2 Dynamic Per-Role Routing (`engine/ai/providers.mjs`, `engine/ai/queue_broker.mjs`):**
  - [x] Add `VALID_PIPELINE_ROLES` (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`) and `pipeline_routing` persistence in `loadAiPreferences` / `savePipelineRouting` (`engine/.ai_preferences.json`).
  - [x] Add `resolveRoleProvider(role, { overrides, job, engineDir })` with zero hardcoded provider/model fallbacks.
  - [x] Expose `pipeline_routing` in `getProvidersOverview()` and add `POST /api/ai/preferences/routing`.
  - [x] Neutralize hardcoded model fallback in `recordWorkerHeartbeat` (`"connected-agent"` instead of `"Gemini 4 Argon"`).
- [x] **1.3 Schema & Validator Optional Fields (`engine/src/template_schema.mjs`, `engine/src/diagram_validator.mjs`):**
  - [x] Register optional scene fields (`visual_job`, `world_theme`, `causal_mechanic`, `sfx_cues`, `tts_narration`, `tts_beats`).
  - [x] Add non-breaking warnings in `validateSingleScene` for unknown `visual_job`, unknown `world_theme`, and potential `> 3.5s` static holds (`> 28` words with `<= 1` animation steps).
- [x] **1.4 3-Stage Decoupled Runner (`engine/ai/runner.mjs`):**
  - [x] Support `mode: "three_stage"`, `pause_after: "none" | "brief" | "dialogue"`, `start_from: "brief" | "dialogue" | "visual"`.
  - [x] Implement `buildContentBriefPrompt` & `parseBriefPayload` → `brief.json` (0% visual/template mentions).
  - [x] Implement `buildDialoguePrompt` & `parseDialoguePayload` → `dialogue.json` + `notes.md` (Beats, What vs. Why, Dual-Text `tts_text` vs `display_text`, 0% visual/template mentions).
  - [x] Implement `buildVisualDirectionPrompt` (locked `dialogueJson`, optional `audioSpine`, `availableSvgs`, `Visual Job`, `causal_mechanic`, `sfx_cues`, `cue_sentence`, preserves `tts_beats`).
  - [x] Support `onBeforeVisualStage` hook for optional Audio-Spine locking between Stage 2 and Stage 3.
  - [x] Update `normalizeCompiledScript` & `generateEpisodeScript` to wire 3-stage execution + dynamic per-role provider resolution + targeted `repairInvalidScenes`.
- [x] **1.5 State, Queue Broker & Server Endpoints (`engine/state_cli.mjs`, `engine/ai/queue_broker.mjs`, `engine/server.mjs`):**
  - [x] Detect `brief` (`brief.json`), `dialogue` (`dialogue.json`), `audio_spine` (`audio_spine.json`) in `inspectEpisodeArtifacts`.
  - [x] Expose `has_brief`, `has_dialogue`, `has_audio_spine`, `scripting_phase` in `loadEpisodePayload` (`/api/courses`).
  - [x] Handle `three_stage`, `pause_after`, `start_from`, `lock_audio_spine`, `role_routing`, `paused_at` in `queue_broker.mjs` without breaking `auto`/`two_pass`/`single_pass`/MCP flows.
  - [x] Add `GET /api/episodes/scripting-artifacts`, `POST /api/episodes/brief`, `POST /api/episodes/dialogue`, `POST /api/episodes/audio-spine`.
- [x] **1.6 Dual-Text TTS & `--audio-spine` (`engine/tts_pipeline.py`):**
  - [x] Add `normalize_vietnamese_tts_text` helper (safe tech acronym/unit normalization).
  - [x] Support `tts_beats` / `tts_narration` Dual-Text synthesis in `process_episode` while preserving `display_text` subtitles & `cue_sentence` alignment.
  - [x] Implement `--audio-spine <dialogue.json>` (`process_audio_spine`) writing per-beat audio + `<epDir>/audio_spine.json` with `duration_ms`, `start_ms`, `end_ms`, `start_frame`, `end_frame` (`fps=30`).
- [x] **1.7 Web Studio UI (`AiScriptModal.mjs`, `ScriptingStageModal.mjs`, `EpisodeRoadmap.mjs`, `studio.mjs`):**
  - [x] Add `three_stage` / `pause_after` / `lock_audio_spine` controls in `AiScriptModal.mjs` (pure `h(...)`, no hardcoded agents/models).
  - [x] Create `ScriptingStageModal.mjs` for viewing/editing `brief.json`, `dialogue.json`, `notes.md`, running `POST /api/episodes/audio-spine`, and advancing to the next stage.
  - [x] Wire phase chips & modal triggers in `EpisodeRoadmap.mjs`, `RevisionPanel.mjs`, `studio.mjs`, and `public/styles.css`.
- [x] **1.8 Phase 1 Verification:**
  - [x] Write and pass `engine/test_phase1_three_stage.mjs`.
  - [x] Pass `engine/test_ai_bridge_and_templates.mjs`.
  - [x] Pass `engine/test_hyperframes.mjs --skip-render`.
  - [x] Pass `state_cli.mjs summary --course REDIS` and `validate-diagrams --course REDIS`.
  - [x] Update Handover Snapshot below before concluding Phase 1.

---

## Phase 2 — HyperFrames Motion/Theme Upgrade & WebAudio SFX/LUFS Post-Mix
- [x] **2.1 HyperFrames Visual Grammar (`engine/hyperframes/runtime/` & `compiler.mjs`):**
  - [x] Continuous micro-motion floor: deterministic grid drift on `.tvs-bg-grid` (inside `.tvs-bg`, replacing static `::after`) + subtle `creepZoom` (`scale 1.0 -> 1.015`) on active scene stage (`force3D: false`).
  - [x] Light / Dark World Alternation (`scene.world_theme: "dark" | "light"`) with smooth deterministic background crossfade (`#020A14` vs `#F5F5F5`).
  - [x] Smart scene transitions: smooth overlap (`min(0.45s, nextDuration * 0.22)`) between scenes in the same `part`; keep `dark breather` (`140ms`) at `part` boundaries.
  - [x] `sharpTag()` helper & CSS primitive (`border-radius: 3px`, `1.5px` border, label/value split) in `tvs-hf-common.mjs` & `tvs-hf.css`.
  - [x] Support `scene.causal_mechanic` entrance variations across `tvs-hf-main.mjs` + `tvs-hf-common.mjs#reveal` and templates (`comparison_matrix`, `timeline_flow`, `exam_tips`, `kpi_metrics`, plus envelope mechanics for all 7 scene templates).
- [x] **2.2 Programmatic SFX Bus & `-16 LUFS` Post-Mix (Zero-FFmpeg):**
  - [x] Generate clean 48kHz PCM WAV SFX assets in `engine/assets/sfx/` (`whoosh_short.wav`, `pop.wav`, `click.wav`, `typing_fast.wav`, `impact.wav`, `chime.wav`).
  - [x] Extract/auto-schedule `sfx_cues` (with `-33ms` lead) into `composition.json`.
  - [x] Upgrade `buildAudioMix()` in `engine/src/hf_encoder.mjs` to mix `master_vo` + `sfx_bus` + optional `bgm_bed` (1800Hz `-6dB` static EQ carve via `OfflineAudioContext`).
  - [x] Implement pure-JS ITU-R BS.1770-4 K-weighted integrated loudness normalization to `-16 LUFS` + soft true-peak limiter (`0.8414` ≈ `-1.5 dBTP`).
- [x] **2.3 Phase 2 Verification:**
  - [x] Extend `engine/test_hyperframes.mjs` for determinism (`snapshot.mjs --check-determinism`), Light/Dark theme, overlap transitions, SFX mix, and `-16 LUFS` output verification via `verify_video.mjs`.

---

## Phase 3 — Per-Role Routing UI, DOM Safe-Zone QC Gate & Plugin/Skills Sync
- [x] **3.1 Per-Role Provider Routing UI:**
  - [x] Add compact Per-Role routing selector panel in Web Studio (`engine/src/components/ai/RoleRoutingPanel.mjs` inside `BrandHealthGrid.mjs` & `AiScriptModal.mjs` + `.role-routing-*` in `engine/public/styles.css`) backed by `POST /api/ai/preferences/routing` + dynamic provider discovery (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`).
- [x] **3.2 Automated DOM Layout & Safe-Zone QC Gate (`snapshot.mjs`, `verify_video.mjs`, `render_video.mjs`):**
  - [x] Measure `getBoundingClientRect()` at scene checkpoints (`0.1, 0.5, 0.9`) in `engine/hyperframes/layout_qc.mjs` to catch `viewport_overflow`, `stage_overflow`, `topbar_collision`, `subtitle_collision`, `subtitle_overflow`, and `clipped_text` (`topbar_title_truncated` warning).
  - [x] Surface structured QC findings per `scene_id` and timestamp in `snapshot.mjs`, `verify_video.mjs`, `render.mjs`, and `render_video.mjs` (`--check-layout`, `--no-check-layout`, `--qc-strict`).
- [x] **3.3 Plugin, Rules & Skills Synchronization:**
  - [x] Update `AGENTS.md`, `plugin/tech-video-studio/rules/AGENTS.md`, `{episode-producer,studio-worker,video-renderer}/SKILL.md`, `plugin/tech-video-studio/README.md`, `README.md`, and `README.en.md` to enforce the decoupled 3-stage pipeline, dynamic per-role routing, Phase 2/3 HyperFrames features, and strict `auto_produce` separation.
  - [x] Run `node setup.mjs --agents all` & `node setup.mjs --check --json`, and verify live Studio UI (`http://localhost:3030`) with zero console/page errors.

---

## v2 — Deep-Dive Multi-Part Course Factory, Independent Reviewers, 11 Components & Level-1 Cleanup

### Wave 1 — Core Foundation & Level-1 Cleanup
- [x] **v2-1.1 Level-1 Legacy Cleanup & Render Upgrade (`cleanup-render`):**
  - [x] Extract 7 shared encode/mux helpers from `exporter.mjs` into `engine/src/video_encode_utils.mjs` and rewire `engine/src/hf_encoder.mjs`.
  - [x] Delete legacy Canvas 2D renderer (`engine/src/exporter.mjs`, `engine/src/canvas_templates/*`) and Canvas-only bokeh/sparkle FX in `engine/src/motion/kernel.mjs` (preserving `ParticleStage.mjs` overlay).
  - [x] Remove `--engine legacy` from `engine/render_video.mjs`, default FPS to `30`, add `--part <part_id>` preview rendering, scale timeout for long episodes, and wire `partId` in `engine/hyperframes/{render,studio_server}.mjs`.
- [x] **v2-1.2 Multi-Part State CLI & TTS Audio-Spine Reuse (`state-tts`):**
  - [x] Extend `inspectEpisodeArtifacts` & `state/<epId>.json` schema (`parts[]`, `merged_at`) in `engine/state_cli.mjs`.
  - [x] Implement `parts`, `set-part`, and `merge-parts` (deterministic script/audio remap/SRT offset/notes TOC merge) + export `getEpisodeParts`, `setPartState`, `mergeEpisodeParts`.
  - [x] Fix `engine/tts_pipeline.py` to reuse matching `audio_spine.json` beats in `process_episode()` (zero duplicate TTS calls) and align `cue_sentence` for the 4 new templates (`messages`, `steps`, `focus_steps`, `branches`).
- [x] **v2-1.3 Independent Reviewer Skills & SSOT Sync (`skills-ssot`):**
  - [x] Author `plugin/tech-video-studio/skills/curriculum-reviewer/SKILL.md` and `content-reviewer/SKILL.md` (mandatory independent review rubrics).
  - [x] Upgrade `curriculum-architect`, `episode-producer`, `video-renderer`, `studio-worker`, `AGENTS.md`, `plugin/tech-video-studio/rules/AGENTS.md`, `README.md`, `GUIDE.md`, and `setup_adapters.mjs` for Deep-Dive Multi-Part (`<= 5m` parts) & 11 templates.
  - [x] Delete duplicate `.claude/skills/`, `.agents/skills/`, `CLAUDE.md`, `README.en.md` and resync via `node setup.mjs --workspace --global` (`OK`, 11 files each).

### Wave 2 — AI Engine, 4 New Visual Components & Studio Web UI
- [x] **v2-2.1 Deep-Course Multi-Part AI Pipeline (`ai-pipeline`):**
  - [x] Add 5th role `"content_reviewer"` to `VALID_PIPELINE_ROLES` in `engine/ai/providers.mjs`.
  - [x] Unify `engine/ai/runner.mjs` on `deep_course` (remove `single_pass`/`two_pass`/`auto`/`storyboard_only`), add `episode_canon` + `parts[] (<= 5m)`, per-part Stage 2 + handoff, Stage 2.5 independent `content_reviewer` loop (max 2 rounds), and per-part Stage 3 Visual Compile (11-template diversity).
  - [x] Update `engine/ai/queue_broker.mjs` to route `content_reviewer`, support optional `part_id` & `pause_after: "brief" | "part_review" | "dialogue" | "none"`, and persist `parts/<part_id>/*` + `brief_review.md`.
- [x] **v2-2.2 Expand Visual Library 7 -> 11 Components (`visual-components`):**
  - [x] Register `"sequence_diagram"`, `"memory_layout"`, `"code_diff"`, `"concept_breakdown"` in `template_schema.mjs` & `diagram_validator.mjs` (+ Visual Variety Guard warnings).
  - [x] Build 4 deterministic HyperFrames scenes + CSS (`engine/hyperframes/runtime/scenes/*.mjs`, `tvs-hf-main.mjs`, `tvs-hf.css`, `compiler.mjs` with `code_diff` Shiki + `partId`).
  - [x] Build 4 matching pure-ESM React components (`SequenceDiagram.mjs`, `MemoryLayout.mjs`, `CodeDiff.mjs`, `ConceptBreakdown.mjs`) and document all 11 components in `engine/VISUAL_COMPONENTS.md`.
- [x] **v2-2.3 Studio Web UI & Server Multi-Part Workflow (`studio-web-ui`):**
  - [x] Remove `legacy` render engine option (`server.mjs`, `studio.mjs`), default export FPS to `30`, expose `parts[]` in `/api/courses`, add `GET /api/episodes/part`, `POST /api/episodes/part/approve`, `POST /api/episodes/merge-parts`, and `part_id` support in `routes/media.mjs` & `/api/render`.
  - [x] Add 5th role in `RoleRoutingPanel.mjs`; streamline `AiScriptModal.mjs` for `deep_course`; upgrade `ScriptingStageModal.mjs` (part selector, `review.md` tab, Approve Part, Merge Parts); add Part Switcher + 4 new React templates in `studio.mjs` & `styles.css`.

### Wave 3 — Verification & Documentation
- [ ] **v2-3.1 Test Suite Cleanup & End-to-End Verification (`verifier`):**
  - [ ] Clean dead legacy/`two_pass` tests and add 11-template + Visual Variety Guard checks in `engine/test_ai_bridge_and_templates.mjs`.
  - [ ] Upgrade `engine/test_phase1_three_stage.mjs` (5-role routing, `REVISE -> APPROVED` review loop, `set-part`/`merge-parts`, TTS Audio-Spine reuse).
  - [ ] Upgrade `engine/test_hyperframes.mjs` (all 11 templates determinism + Layout QC `errors=0`, `--part part_01` & merged episode render).
  - [ ] Pass `REDIS` backward-compatibility checks, `setup.mjs --check --json`, live UI smoke check, and finalize `engine/UPGRADE_CHECKLIST.md` + `CHANGELOG.md`.

---

## Handover Snapshot (Updated After Each Phase)
- **Current Phase:** **v2 Wave 2 COMPLETED** (`ca07d3a`, `e71ec8e`, `31628f4`) — Starting **Wave 3** (`verifier`)
- **Prior Baseline (v1 Completed 2026-11-20):** Phases 1–3 passed (`test_phase1_three_stage` 5/5, `test_hyperframes` 9/9, `test_ai_bridge_and_templates` 17/17, `REDIS` valid).
- **Phase 3 Files Created:**
  - `engine/src/components/ai/RoleRoutingPanel.mjs` (collapsible `🧭 Định tuyến AI theo vai trò` UI for `outliner`, `brief_scriptwriter`, `visual_director`, `repair` via `POST /api/ai/preferences/routing`, dynamic `builtin` provider/model discovery, custom model input, zero hardcoded models)
  - `engine/hyperframes/layout_qc.mjs` (`DEFAULT_QC_CHECKPOINTS = [0.1, 0.5, 0.9]`, `buildLayoutQcExpression`, `runCompositionLayoutQc`, `formatLayoutQcSummary`, 6 DOM layout/safe-zone checks + `--hfForceTimelineRebind`)
- **Phase 3 Files Modified:**
  - *Phase 3.1:* `engine/src/components/ai/BrandHealthGrid.mjs`, `engine/src/components/AiScriptModal.mjs`, `engine/public/styles.css`, `engine/test_phase1_three_stage.mjs`
  - *Phase 3.2:* `engine/hyperframes/snapshot.mjs`, `engine/hyperframes/verify_video.mjs`, `engine/hyperframes/render.mjs`, `engine/render_video.mjs`, `engine/test_hyperframes.mjs`
  - *Phase 3.3:* `AGENTS.md`, `plugin/tech-video-studio/rules/AGENTS.md`, `plugin/tech-video-studio/skills/{episode-producer,studio-worker,video-renderer}/SKILL.md`, `plugin/tech-video-studio/README.md`, `README.md`, `README.en.md`, `engine/UPGRADE_CHECKLIST.md`, `CHANGELOG.md` *(plus regenerated gitignored adapters `.agents/` and `.claude/` via `node setup.mjs --agents all`)*
- **Git Staging Note:** Root `.gitignore` line 20 (`/*/hyperframes/`) ignores untracked files inside `*/hyperframes/`, so **`git add -f engine/hyperframes/layout_qc.mjs`** is required when staging `layout_qc.mjs`.
- **Phase 3 Verification Results (Independent Verifier, Exit Code 0, Isolated Temp Runs):**
  - `node engine/test_phase1_three_stage.mjs` → **PASS (`5/5` sections, exit 0)** (includes Phase 3.1 headless Chrome `RoleRoutingPanel` verification in Roadmap + `AiScriptModal`, `0` console/page errors).
  - `node engine/test_hyperframes.mjs` (full run, no `--skip-render`) → **PASS (`9/9` checks, exit 0)**:
    - BS.1770 DSP: `-28.64 → -16 LUFS`; `ep03-qc-broken` mix: `-19.24 → -16 LUFS` (`peak 0.4691`).
    - `HFTEST/ep01-demo`: determinism (7 frames) + strict Layout QC PASS (`scenes=7, frames=21, checkpoints=[0.1,0.5,0.9], errors=0, warnings=0`).
    - `HFTEST/ep02-phase2`: Light/Dark + `SharpTag` + BGM determinism + strict Layout QC PASS (`scenes=4, frames=12, checkpoints=[0.1,0.5,0.9], errors=0, warnings=0`).
    - `HFTEST/ep03-qc-broken`: strict Layout QC FAIL (`scenes=2, frames=6, errors=223, warnings=3`, plus direct `topbar_collision` probe) and triggers `qcStrict` failures in both `snapshot.mjs` and `render.mjs`.
    - `render_video.mjs` + `verifyEpisodeVideo({ checkLayout: true })` on `hf-e2e.mp4`: `1280x720`, `17.51s`, `audio rms 0.122`, **`-16.02 LUFS`**, `qc scenes=7 errors=0`.
  - `node engine/test_ai_bridge_and_templates.mjs` → **PASS (`17/17` sections, exit 0)**.
  - `node engine/state_cli.mjs summary --course REDIS` → `Total: 10 | planned: 7 | scripting: 1 | script_ready: 1 | completed: 1`.
  - `node engine/state_cli.mjs validate-diagrams --course REDIS` → `ep01`, `ep02`, `ep03` all **`0 errors, 0 warnings`**.
  - Real-Episode DOM Layout QC (`node engine/hyperframes/snapshot.mjs --course REDIS --episode ep01-redis-in-memory-architecture --check-layout`) → **PASS (`scenes=5, frames=15, checkpoints=[0.1,0.5,0.9], errors=0, warnings=0`, `0` console/page errors)**.
  - `node setup.mjs --check --json` → `engine.ok: true`, `workspace.ok: true` (`fileCount: 9`), `global.ok: true`, `adapters.antigravityPlugin.ok: true`, `agentSkills.ok: true`, `claudeSkills.ok: true`, `claudeMcp.ok: true` (`claudeDesktop.ok: false` — not installed/requested).
  - Live Studio UI Headless Chrome Smoke Check (`?view=projects`, `?course=REDIS&view=roadmap` w/ `RoleRoutingPanel` save `1/4 tùy chỉnh` + reset `Mặc định chung` & `AiScriptModal` `three_stage` compact panel, `?course=REDIS&ep=ep01-redis-in-memory-architecture&view=player`) → **`0` console/page/log errors across all 3 views**.
- **Phase 1 & 2 Baseline Artifacts:**
  - *Phase 2 Created:* `engine/scripts/generate_sfx_assets.mjs`, `engine/assets/sfx/{whoosh_short,pop,click,typing_fast,impact,chime}.wav`, `engine/src/audio_dsp.mjs`
  - *Minor Pre-Existing Note:* `engine/worker_wait.mjs:29` defaults `args.model || "Gemini 4 Argon"` when `--model` is omitted (`studio-worker/SKILL.md` passes `--model` explicitly).
- **Next Resume Action (Ready for Release / Commit):**
  1. Stage modified/new files (using `git add -f engine/hyperframes/layout_qc.mjs` so root `.gitignore`'s `/*/hyperframes/` rule does not skip it).
  2. Proceed with course production or future feature sprints following `AGENTS.md` and `README.md`.
