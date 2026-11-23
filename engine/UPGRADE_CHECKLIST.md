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
- [x] **v2-3.1 Test Suite Cleanup & End-to-End Verification (`verifier`):**
  - [x] Clean dead legacy/`two_pass` tests and add 11-template + Visual Variety Guard checks in `engine/test_ai_bridge_and_templates.mjs`.
  - [x] Upgrade `engine/test_phase1_three_stage.mjs` (5-role routing, `REVISE -> APPROVED` review loop, `set-part`/`merge-parts`, TTS Audio-Spine reuse).
  - [x] Upgrade `engine/test_hyperframes.mjs` (all 11 templates determinism + Layout QC `errors=0`, `--part part_01` & merged episode render).
  - [x] Pass `REDIS` backward-compatibility checks, `setup.mjs --check --json`, live UI smoke check, and finalize `engine/UPGRADE_CHECKLIST.md` + `CHANGELOG.md`.

---

## Handover Snapshot (Updated After Each Phase)
- **Current Phase:** **v2 COMPLETED (Waves 1, 2 & 3 Verified)**
- **Wave Commits on `main` (since `5ec798f`):**
  - *Wave 1:* `937c2e9` (`cleanup-render`), `20dd309` (`state-tts`), `098a64f` (`skills-ssot`), `fa856e4` (Wave 1 checklist)
  - *Wave 2:* `ca07d3a` (`ai-pipeline`), `e71ec8e` (`visual-components`), `31628f4` (`studio-web-ui`), `9bd64f6` (SSOT field alignment & Wave 2 complete)
  - *Wave 3:* `verifier` test suite upgrade (`test_ai_bridge_and_templates.mjs`, `test_phase1_three_stage.mjs`, `test_hyperframes.mjs`, plus `--part` support in `snapshot.mjs` & `verify_video.mjs`) and release documentation (`engine/UPGRADE_CHECKLIST.md`, `CHANGELOG.md`)
- **v2 Net Diff Stats (`5ec798f..HEAD`):** `62 files changed, 14460 insertions(+), 7624 deletions(-)` (`9` legacy files deleted including `engine/src/exporter.mjs`, `engine/src/canvas_templates/*`, `CLAUDE.md`, `README.en.md`; `12` new files created including `engine/src/video_encode_utils.mjs`, `engine/VISUAL_COMPONENTS.md`, 2 independent reviewer skills `curriculum-reviewer` & `content-reviewer`, 4 HyperFrames scene modules, and 4 React components `SequenceDiagram`, `MemoryLayout`, `CodeDiff`, `ConceptBreakdown`).
- **v2 Wave 3 Verification Results (All Exit Code 0):**
  - `node "setup.mjs" --workspace --global` & `node "setup.mjs" --check --json` → **PASS (exit 0)** (`node 22.10.0`, `python 3.13.5`, `chrome.exe` found, `engine.ok: true`, `workspace.ok: true` with `fileCount: 11`, `global.ok: true` with `fileCount: 11`).
  - `python -m py_compile "engine/tts_pipeline.py"` → **PASS (exit 0)**.
  - `node "engine/state_cli.mjs" summary --course REDIS` → **PASS (exit 0)** (`Total: 10 | planned: 4 | scripting: 1 | completed: 5`).
  - `node "engine/state_cli.mjs" validate-diagrams --course REDIS` → **PASS (exit 0)** (`ep01`..`ep06` all `0 errors, 0 warnings`, zero regression on single-script episodes).
  - `node "engine/test_hyperframes.mjs"` (full run, no `--skip-render`) → **PASS (`12/12` checks, exit 0)**:
    - Vendor manifest (`14` ESM modules, `3` pinned raw files), `audio_probe`, `computeTimeline`, and BS.1770-4 DSP (`-28.64 → -16 LUFS`).
    - Core 7 templates (`HFTEST/ep01-demo`, 21 frames), Phase 2 Light/Dark + BGM (`ep02-phase2`, 12 frames), and all 4 new engineering templates (`sequence_diagram`, `memory_layout`, `code_diff`, `concept_breakdown`) in BOTH Dark & Light themes (`ep04-new-templates`, 8 scenes, 24 frames): determinism + strict Layout QC **PASS (`errors=0, warnings=0`)**.
    - Synthetic broken fixture (`ep03-qc-broken`): triggers all 6 layout QC checks (`errors=223, warnings=3`, plus direct `topbar_collision`) and fails `qcStrict`.
    - Full E2E renders + `verifyEpisodeVideo({ checkLayout: true })`: `hf-e2e.mp4` (`1280x720`, `17.51s`, `-16.02 LUFS`, `qc scenes=7 errors=0`), single-part preview `--part part_01` (`part_01.mp4`, `4.42s`, `-16.02 LUFS`, `qc scenes=2 errors=0 warnings=0`), and post-merge full episode `ep05-merged.mp4` reading remapped `parts/part_k/audio/*` (`8.81s`, `-16.02 LUFS`, `qc scenes=4 errors=0 warnings=0`).
  - `node "engine/test_phase1_three_stage.mjs"` → **PASS (`6/6` sections, exit 0)**:
    - 5-role dynamic routing (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair`), `pause_after` gates (`brief`, `dialogue`, `part_review`, `none`), `auto_produce` guardrail, `audio_spine.json` beat reuse (`reused_scenes === 2`, `0` duplicate TTS calls), multi-part `deep_course` with fresh-context `content_reviewer` (`REVISE` round 1 with `rewrite_instructions` → `APPROVED` round 2 writing `review.md`), `part_02` handoff, 4-new-template cue alignment, `state_cli.mjs` `parts` / `set-part --approved true` / `merge-parts`, and headless Chrome UI verification of 5-role `RoleRoutingPanel` (`2/5 tùy chỉnh`, `1/5 tùy chỉnh`) + `ScriptingStageModal` (`4. 🛡️ AI Review` tab & Part Switcher, `0` console/page errors).
  - `node "engine/test_ai_bridge_and_templates.mjs"` → **PASS (`18/18` sections, exit 0)**:
    - Kernel state, validator unit checks, MCP stdio + HTTP `/mcp` (`9` tools, `11` supported visual types), worker wakeup, Chrome UI preview, HyperFrames WebM export + `--engine legacy` removal rejection, `auto_produce` & TTL expiry, 9-provider zero-key-leakage handshakes, 7-episode `deep_course` batch 429 pause & DeepSeek resume (`5` episodes × `5` stages = `25` requests), universal setup adapters (`6` skills), multi-voice A/B & 2-layer alignment, video management, 11-template SSOT schema (`buildTemplatesSchemaDoc`), Zero-LLM DAG auto-layout, unified `deep_course` runner + targeted scene-level `repairInvalidScenes`, `/courses/*` whitelist & atomic `/api/save-video`, and all **11 visual templates** + **Visual Variety Guard** (`duplicate-adjacent-visual-type`, `code_cli` setup continuation exception, `low-visual-variety`).
  - Live Studio UI Headless Chrome Smoke Check (`view=projects`, `view=roadmap` w/ `course=REDIS` + 5-role `RoleRoutingPanel` + `AiScriptModal` `deep_course` controls, `view=player` on single-script `REDIS/ep02` and multi-part fixture exercising Part Switcher + `SequenceDiagram`, `MemoryLayout`, `CodeDiff`, `ConceptBreakdown` + `ScriptingStageModal` `4. 🛡️ AI Review` tab) → **PASS (`0` console errors, `0` page errors, `0` broken imports)**.
- **Next Resume Action:**
  - v2 upgrade is complete and committed on `main`. Proceed with deep-dive multi-part course authoring and video production following `AGENTS.md`, `GUIDE.md`, and `engine/VISUAL_COMPONENTS.md`.
