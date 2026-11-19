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
- [ ] **3.1 Per-Role Provider Routing UI:**
  - [ ] Add compact Per-Role routing selector panel in Web Studio (`BrandHealthGrid` / `AiScriptModal` settings) backed by `POST /api/ai/preferences/routing` + dynamic provider discovery.
- [ ] **3.2 Automated DOM Layout & Safe-Zone QC Gate (`snapshot.mjs`, `verify_video.mjs`, `render_video.mjs`):**
  - [ ] Measure `getBoundingClientRect()` at scene checkpoints (`0.1, 0.5, 0.9`) to catch stage overflow, subtitle/topbar collisions, and clipped text.
  - [ ] Surface structured QC findings per `scene_id` and timestamp in `verify_video.mjs` & `render_video.mjs`.
- [ ] **3.3 Plugin, Rules & Skills Synchronization:**
  - [ ] Update `AGENTS.md`, `plugin/tech-video-studio/rules/AGENTS.md`, `episode-producer/SKILL.md`, and `studio-worker/SKILL.md` to enforce the decoupled 3-stage pipeline and `auto_produce` separation.
  - [ ] Run `node setup.mjs --agents all` & `node setup.mjs --check --json`, and verify live Studio UI (`http://localhost:3030`) with zero console/page errors.

---

## Handover Snapshot (Updated After Each Phase)
- **Current Phase:** Phase 2 COMPLETED (2026-11-19) — Ready for Phase 3
- **Phase 2 Files Created:**
  - `engine/scripts/generate_sfx_assets.mjs` (pure-Node 48kHz PCM WAV seeded SFX generator)
  - `engine/assets/sfx/{whoosh_short,pop,click,typing_fast,impact,chime}.wav` (6 SFX assets normalized to `-6 dBFS`)
  - `engine/src/audio_dsp.mjs` (`applyKWeighting`, `measureIntegratedLufs` BS.1770-4 gated LUFS, `normalizeLoudnessAndLimit` to `-16 LUFS` + `0.8414` ≈ `-1.5 dBTP` soft limiter)
- **Phase 2 Files Modified:**
  - `engine/hyperframes/runtime/tvs-hf.css` (`.tvs-bg-grid`, `.tvs-bg-light`, `.tvs-scene--light`, `.tvs-sharp-tag`)
  - `engine/hyperframes/runtime/tvs-hf-common.mjs` (`CAUSAL_MECHANICS`, `sharpTag()`, causal-mechanic `reveal()` with zero-duration `filter`/`clipPath` `fromTo` cleanup)
  - `engine/hyperframes/runtime/tvs-hf-main.mjs` (`.tvs-bg-grid` drift modulo `60px`, `buildWorldThemeLayer()`, `buildTopBar()` `SharpTag`, `creepZoom` `1 -> 1.015`, `buildEnvelope()` causal mechanics + smart same-part overlap vs cross-part dark breather)
  - `engine/hyperframes/runtime/scenes/{comparison_matrix,timeline_flow,exam_tips,kpi_metrics}.mjs` (`ctx.mechanic` head/element reveals + optional `sharpTag` badges)
  - `engine/hyperframes/compiler.mjs` (`VALID_SFX_TYPES`, `buildSfxCues()` with `-33ms` lead, `resolveBgmSource()`, `data-slot-duration`/`data-overlap-out`/`data-overlap-in`/`data-world-theme`, `manifest.sfx` & `manifest.bgm`)
  - `engine/src/hf_encoder.mjs` (`applyVocalCarveEq` `1800Hz -6dB Q=1.4`, `buildAudioMix` SFX + carved BGM + BS.1770 `-16 LUFS` post-mix, `window.__TVS_AUDIO_DSP__`)
  - `engine/hyperframes/render.mjs` & `engine/hyperframes/verify_video.mjs` (`sfx`/`bgm`/`loudnessTargetLufs: -16` wiring, `window.__TVS_AUDIO_DSP__` wait & LUFS/peak output measurement)
  - `engine/test_hyperframes.mjs` (added SFX/DSP assertions, overlap HTML checks, mixed Dark/Light + rotated mechanics + SharpTag + BGM determinism check, and E2E MP4 LUFS check)
- **Phase 2 Verification Results (All Exit Code 0):**
  - `node "c:\PersonalProject\TechVideoStudio\engine\test_hyperframes.mjs"` → `8 checks passed.` (`hf-e2e.mp4` `1280x720`, `17.51s`, `rms 0.122`, `-16.02 LUFS`; 7/7 template determinism + Light/Dark `ep02-phase2` determinism passed with 0 errors)
  - `node "c:\PersonalProject\TechVideoStudio\engine\test_phase1_three_stage.mjs"` → `ALL PHASE 1 TESTS PASSED!`
  - `node "c:\PersonalProject\TechVideoStudio\engine\test_ai_bridge_and_templates.mjs"` → `ALL TESTS PASSED!` (17/17 sections including HyperFrames & Legacy WebM exports)
  - `node "c:\PersonalProject\TechVideoStudio\engine\state_cli.mjs" validate-diagrams --course REDIS` → `0 errors, 0 warnings` (both episodes)
- **Next Resume Action (Starting Phase 3):**
  1. Read `engine/UPGRADE_CHECKLIST.md` Phase 3 items (`3.1`, `3.2`, `3.3`) and inspect `engine/src/components/{BrandHealthGrid,AiScriptModal}.mjs`, `engine/hyperframes/{snapshot,verify_video,render}.mjs`, `AGENTS.md`, `.agents/plugins/tech-video-studio/rules/AGENTS.md`, and `.agents/skills/{episode-producer,studio-worker}/SKILL.md`.
  2. Implement Phase 3.1 (compact Per-Role Provider Routing selector UI in Studio backed by `POST /api/ai/preferences/routing`).
  3. Implement Phase 3.2 (automated DOM `getBoundingClientRect()` layout & safe-zone QC gate at checkpoints `0.1, 0.5, 0.9` in `snapshot.mjs` / `verify_video.mjs` / `render_video.mjs`).
  4. Implement Phase 3.3 (sync `AGENTS.md`, plugin rules, and `SKILL.md` files for 3-stage pipeline + Phase 2 metadata, run `node setup.mjs --agents all` & `node setup.mjs --check --json`, verify live Studio UI `http://localhost:3030` with 0 console/page errors, and update `UPGRADE_CHECKLIST.md` Phase 3 completion snapshot).
