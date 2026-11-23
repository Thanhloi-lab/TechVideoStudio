# Changelog

Ghi chép các thay đổi đã hoàn thiện và kiểm thử trong `TechVideoStudio` (theo lộ trình tại [`engine/UPGRADE_CHECKLIST.md`](engine/UPGRADE_CHECKLIST.md)).

---

## [Unreleased / 2026-11-20] — Phase 3: Per-Role Routing UI, Automated DOM Safe-Zone QC Gate & Plugin/Skills Sync

### 1. Per-Role AI Provider Routing UI (Phase 3.1)
- **`RoleRoutingPanel` (`engine/src/components/ai/RoleRoutingPanel.mjs`, `engine/public/styles.css`):**
  - Thêm bảng thu gọn **`🧭 Định tuyến AI theo vai trò`** (`data-testid="role-routing-toggle"` / `"role-routing-body"`) hiển thị số vai trò tùy chỉnh (`N/4 tùy chỉnh` / `Mặc định chung`) và chip tóm tắt ngay cả khi thu gọn.
  - Khám phá động các provider `execution_mode === "builtin"` (loại trừ `antigravity` và `manual_web`, phân biệt trạng thái sẵn sàng vs chưa cấu hình) và danh sách model live từ `/api/ai/providers` cho đủ **4 vai trò** `outliner`, `brief_scriptwriter`, `visual_director`, `repair`, hỗ trợ ô nhập custom model khi `allow_custom_model` bật, nút **`💾 Lưu định tuyến`** và **`↺ Đặt lại mặc định`** gọi `POST /api/ai/preferences/routing` (không gắn cứng tên AI/model mặc định).
- **Tích hợp Studio (`engine/src/components/ai/BrandHealthGrid.mjs`, `engine/src/components/AiScriptModal.mjs`):**
  - Gắn `RoleRoutingPanel` vào `BrandHealthGrid` (Roadmap drawer, prop `showRoleRouting = true`) và bản thu gọn bên trong `.ai-pipeline-stage-box` của `AiScriptModal` khi chọn chế độ `three_stage` (`showRoleRouting={false}` trên `BrandHealthGrid` bên trong modal để tránh trùng lặp).
- **Kiểm thử:** Mở rộng `engine/test_phase1_three_stage.mjs` với headless Chrome CDP UI verification cho cả Roadmap drawer và `AiScriptModal` (`5/5` sections PASS, `0` console/page errors).

### 2. Automated DOM Layout & Safe-Zone QC Gate (Phase 3.2)
- **Bộ kiểm tra DOM thuần Node + CDP (`engine/hyperframes/layout_qc.mjs`):**
  - Xuất `DEFAULT_QC_CHECKPOINTS = [0.1, 0.5, 0.9]`, `buildLayoutQcExpression`, `runCompositionLayoutQc`, và `formatLayoutQcSummary`, đảm bảo bind timeline qua `__hfForceTimelineRebind()` trước khi seek kiểm tra.
  - Thực hiện **6 phép kiểm tra** trên khung 1920×1080 tại mỗi checkpoint: `viewport_overflow`, `stage_overflow` (dùng `stage.getBoundingClientRect()` thực tế với `STAGE_TOLERANCE_PX = 14` để tính cả `creepZoom`, tôn trọng ancestor `overflow: hidden|clip`), `topbar_collision`, `subtitle_collision`, `subtitle_overflow` (kèm đo `Range`), và `clipped_text` (cùng cảnh báo `topbar_title_truncated`). Loại trừ lớp nền/FX/typewriter span/hình học SVG thuần (nhưng giữ SVG `<text>` và `.arch__node`/card) và khử trùng lặp theo `(scene_id, checkpoint, code, selector)`.
- **Tích hợp CLI & Render Pipeline (`engine/hyperframes/snapshot.mjs`, `verify_video.mjs`, `render.mjs`, `engine/render_video.mjs`):**
  - `render_video.mjs` & `render.mjs`: Mặc định chạy Layout QC trước bước capture (`--check-layout` bật sẵn, có thể bỏ qua với `--no-check-layout`, hoặc chặn render khi có lỗi bằng `--qc-strict`).
  - `snapshot.mjs` & `verify_video.mjs`: Bổ sung cờ `--check-layout`, `--qc-strict`, và `--qc-checkpoints`, trả về báo cáo `layoutQc` / `layout_qc` theo từng `scene_id` và timestamp.
- **Kiểm thử (`engine/test_hyperframes.mjs` — `9/9` checks PASS, không `--skip-render`):**
  - `HFTEST/ep01-demo` (7 templates, 21 frames) và `HFTEST/ep02-phase2` (4 scenes, 12 frames): **0 errors, 0 warnings**.
  - Fixture lỗi tổng hợp `ep03-qc-broken`: bắt đủ 6 lỗi (`errors=223, warnings=3`, plus `topbar_collision`) và kích hoạt lỗi `--qc-strict` ở cả `snapshot.mjs` lẫn `renderEpisodeHyperframes`.
  - Render & kiểm định E2E `hf-e2e.mp4`: `1280×720`, `17.51s`, `audio rms 0.122`, **`-16.02 LUFS`**, `qc scenes=7 errors=0`.
  - Kiểm tra tập thực tế `REDIS/ep01-redis-in-memory-architecture` qua `snapshot.mjs --check-layout`: **`scenes=5, frames=15, errors=0, warnings=0`**.
  - *(Lưu ý git staging: `.gitignore` dòng 20 có `/*/hyperframes/`, cần dùng `git add -f engine/hyperframes/layout_qc.mjs` khi stage file mới này.)*

### 3. Plugin, Rules, Skills & Docs Synchronization (Phase 3.3)
- **Đồng bộ SSOT & Adapter (`AGENTS.md`, `plugin/tech-video-studio/`, `README.md`, `README.en.md`):**
  - Cập nhật quy trình `mode: "three_stage"` (`brief.json` → `dialogue.json` + `notes.md` → tùy chọn `audio_spine.json` qua `--audio-spine <dialogue.json>` → `script.json`), `pause_after`, `start_from`, `lock_audio_spine`, `ScriptingStageModal`, định tuyến 4 vai trò (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`) qua `RoleRoutingPanel`, Phase 2 metadata (`visual_job`, `world_theme`, `causal_mechanic`, `sfx_cues`, `bgm_file`, `tts_narration`, `tts_beats`), và các cờ QC Gate Phase 3.
  - Chuẩn hóa đường dẫn `{{WORKSPACE_ROOT}}` / `{{PYTHON_BIN}}` và loại bỏ tên model gắn cứng khỏi các ví dụ runtime trong `studio-worker/SKILL.md` (`<ACTIVE_SESSION_MODEL>` / `"connected-agent"`).
  - Siết chặt tách bạch **Biên kịch vs Sản xuất (`auto_produce`)** trong `episode-producer/SKILL.md` (Step 2.4) và `studio-worker/SKILL.md` (Step C.3): không bao giờ tự chạy full TTS/Render khi biên kịch trừ khi `auto_produce === true` (và không chạy khi dừng tại cổng `brief`/`dialogue`); `--audio-spine` chỉ chạy khi `lock_audio_spine === true` hoặc được yêu cầu tường minh.
  - Chạy lại `node setup.mjs --agents all` & `node setup.mjs --check --json` (`ok: true` trên toàn bộ `engine`, `workspace`, `antigravityPlugin`, `agentSkills`, `claudeSkills`, `claudeMcp`).
  - Xác minh tổng hợp độc lập: `test_phase1_three_stage.mjs` (**5/5**), `test_hyperframes.mjs` (**9/9**), `test_ai_bridge_and_templates.mjs` (**17/17**), `state_cli.mjs validate-diagrams --course REDIS` (**0 errors, 0 warnings**), và Live Studio UI 3 màn hình (`view=projects`, `roadmap` + `RoleRoutingPanel` + `AiScriptModal`, `player`) đạt **0 lỗi console/page**.

---

## [Unreleased / 2026-11-19] — Decoupled 3-Stage Scripting, Rich SVG Catalog, VieNeu-TTS & HyperFrames Phase 2 Audio/Motion Upgrade

### 1. Decoupled 3-Stage Scripting & Dynamic Per-Role AI Routing (Phase 1)
- **Tách quy trình biên kịch 3 bước (`engine/ai/runner.mjs`, `engine/ai/queue_broker.mjs`):**
  - Thêm chế độ `three_stage` tách biệt **Stage 1 (`brief.json`)** (mục tiêu sư phạm, vấn đề cốt lõi, `visual_job`, `world_theme`) → **Stage 2 (`dialogue.json`)** (kịch bản lời thoại tự nhiên kèm Dual-Text TTS `tts_beats`/`tts_narration`) → *(tùy chọn)* **Audio Spine (`audio_spine.json`)** khóa nhịp giây thật trước khi dựng hình → **Stage 3 (`script.json`)** (biên dịch scene, Visual Template, Motion & Layout).
  - Hỗ trợ tạm dừng duyệt giữa chặng (`pause_after`), tiếp tục từ bước cụ thể (`start_from`), và `lock_audio_spine`.
- **Dynamic Per-Role Provider Routing (`engine/ai/providers.mjs`):**
  - Thêm `VALID_PIPELINE_ROLES` (`outliner`, `brief_scriptwriter`, `visual_director`, `repair`), `savePipelineRouting`, `resolveRoleProvider` và endpoint `POST /api/ai/preferences/routing` — không gắn cứng AI agent/model nào (fallback trung lập `"connected-agent"`).
- **Dual-Text TTS & Audio Spine (`engine/tts_pipeline.py`, `engine/server.mjs`, `engine/state_cli.mjs`):**
  - Bổ sung `normalize_vietnamese_tts_text`, hỗ trợ `tts_beats` / `tts_narration` và cờ `--audio-spine` tạo `audio_spine.json` ghi thời lượng audio thật từng câu/từng cảnh trước Stage 3.
  - Thêm endpoint Studio: `GET /api/episodes/scripting-artifacts`, `POST /api/episodes/brief`, `POST /api/episodes/dialogue`, `POST /api/episodes/audio-spine`.
  - Cập nhật `inspectEpisodeArtifacts` trong `state_cli.mjs` nhận diện `brief.json`, `dialogue.json`, `audio_spine.json`.
- **Studio Web UI (`engine/src/components/ScriptingStageModal.mjs`, `AiScriptModal.mjs`, `EpisodeRoadmap.mjs`, `RevisionPanel.mjs`, `studio.mjs`, `styles.css`):**
  - Bổ sung badge trạng thái từng chặng (`Brief` / `Lời thoại` / `Audio`) và modal duyệt/chỉnh sửa `brief.json` & `dialogue.json`, cùng nút kích hoạt Audio Spine.
- **Schema & Validator (`engine/src/template_schema.mjs`, `engine/src/diagram_validator.mjs`):**
  - Bổ sung trường metadata tùy chọn `visual_job` (`Proof | Mechanism | Consequence | Action | Transition`), `world_theme` (`dark | light`), `causal_mechanic`, cùng cảnh báo không chặn (non-blocking) khi narration dài có ít nhịp animation.
- **Kiểm thử:** Thêm `engine/test_phase1_three_stage.mjs`.

### 2. HyperFrames Motion/Theme Grammar, SFX Bus & Pure-JS `-16 LUFS` Post-Mix (Phase 2)
- **Visual Grammar & Smart Transitions (`engine/hyperframes/runtime/` & `compiler.mjs`):**
  - *Continuous Micro-Motion Floor (`force3D: false`):* Thêm lớp `.tvs-bg-grid` trôi liên tục modulo `60px` và hiệu ứng `creepZoom` (`scale 1.0 → 1.015`) trên stage của từng scene.
  - *Light / Dark World Alternation:* Hỗ trợ `scene.world_theme` (`"dark"` vs `"light"`) với chuyển nền mượt qua `.tvs-bg-light` và override tương phản `.tvs-scene--light`.
  - *Smart Scene Transitions:* Tự động chồng lấn chuyển cảnh mượt (`min(0.45s, nextDuration * 0.22)`) giữa các scene trong cùng `part` (`data-overlap-out` / `data-overlap-in`), giữ nguyên `dark breather` (`140ms`) tại ranh giới chuyển `part`.
  - *Primitives & Causal Mechanics:* Thêm `sharpTag()` / `.tvs-sharp-tag` (`border-radius: 3px`, `1.5px` border, label/value) và xoay tua `CAUSAL_MECHANICS` (`blur-materialize`, `wire-draw`, `width-push`, `arc-emission`, `squash-drop`, `typographic-strike`) kèm reset `filter`/`clipPath` thời lượng `0` bằng `tl.fromTo` nhằm đảm bảo determinism khi seek ngược (`snapshot.mjs --check-determinism`).
- **Programmatic SFX Bus, Vocal-Carve BGM & Pure-JS `-16 LUFS` (`engine/scripts/generate_sfx_assets.mjs`, `engine/src/audio_dsp.mjs`, `engine/src/hf_encoder.mjs`, `engine/hyperframes/render.mjs`, `verify_video.mjs`):**
  - Tạo 6 file SFX 48kHz PCM WAV chuẩn hóa `-6 dBFS` trong `engine/assets/sfx/` (`whoosh_short.wav`, `pop.wav`, `click.wav`, `typing_fast.wav`, `impact.wav`, `chime.wav`).
  - `compiler.mjs` trích xuất `sfx_cues` hoặc tự sinh cue theo template với độ dẫn `-33ms` vào `manifest.sfx`, đồng thời hỗ trợ tùy chọn nhạc nền `bgm_file` (`manifest.bgm`).
  - `hf_encoder.mjs` trộn `narration + sfx_bus + optional bgm_bed` (với peaking EQ cắt `1800Hz -6dB Q=1.4` qua `OfflineAudioContext`), rồi chuẩn hóa âm lượng bằng pure-JS ITU-R BS.1770-4 K-weighting + gated LUFS về **`-16 LUFS`** kèm soft-limiter (`0.8414` ≈ `-1.5 dBTP`) trong `audio_dsp.mjs` (Zero FFmpeg).
  - `verify_video.mjs` đo lại LUFS và peak trực tiếp từ audio track của video xuất ra.
- **Kiểm thử:** Mở rộng `engine/test_hyperframes.mjs` lên **8 checks** (kiểm tra 6 WAV, BS.1770 `-16 LUFS`, overlap HTML attributes, mixed Light/Dark + rotated `causal_mechanic` + `SharpTag` + `bgm.wav` determinism, và E2E render MP4 đạt **`-16.02 LUFS`**).

### 3. Rich SVG Illustration Catalog, `cue_sentence` Sync & VieNeu-TTS Presets
- **Kho SVG Minh họa Kiến trúc (`engine/assets/svg/`, `engine/src/svg_catalog.mjs`, `engine/routes/media.mjs`, `engine/state_cli.mjs`):**
  - Thêm 15 SVG đa sắc + `catalog.json` (tương thích Dark UI & Light UI), phục vụ qua `/assets/svg/*`, tự copy khi biên dịch HyperFrames, hỗ trợ `node.svg` trên cả Studio Player (`ArchitectureDiagram.mjs`) lẫn HyperFrames (`architecture.mjs`), cùng lệnh `node engine/state_cli.mjs svg-list`.
- **Khớp nhịp theo chỉ số câu (`cue_sentence` / `cue_text`) & VieNeu-TTS (`engine/tts_pipeline.py`, `engine/voices.json`, `plugin/tech-video-studio/skills/`):**
  - Hỗ trợ `cue_sentence` (1-based) trên các phần tử visual để đồng bộ 1:1 theo thời điểm câu đọc thật trong audio.
  - Bổ sung danh mục 25 profile **VieNeu-TTS v3 Turbo** (`openai_compat` tại `http://127.0.0.1:8000/v1/audio/speech`) trong `engine/voices.json` và cập nhật hướng dẫn tương ứng trong `episode-producer` & `studio-worker` skills.

### 4. Repository Hygiene (`.gitignore`)
- Bổ sung loại trừ file phụ đề sinh tự động (`*.srt`), thư mục render tạm (`/*/hyperframes/`, `/*/hyperframes-snapshots/`, `/*/hyperframes-verify/`, `snapshots/`, `snapshots-p2/`), cache giọng (`engine/.voice_cache/`), môi trường ảo (`.venv/`, `.xpu_venv/`, `node_modules/`), cấu hình IDE (`.vscode/`, `.idea/`), và giữ nguyên theo dõi 6 asset SFX lõi của engine (`!engine/assets/sfx/*.wav`).
