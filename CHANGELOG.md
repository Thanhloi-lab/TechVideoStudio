# Changelog

Ghi chép các thay đổi đã hoàn thiện và kiểm thử trong `TechVideoStudio` (theo lộ trình tại [`engine/UPGRADE_CHECKLIST.md`](engine/UPGRADE_CHECKLIST.md)).

---

## [Unreleased / 2026-11-19] — Decoupled 3-Stage Scripting, Rich SVG Catalog, VieNeu-TTS & HyperFrames Phase 2 Audio/Motion Upgrade

### 1. Decoupled 3-Stage Scripting & Dynamic Per-Role AI Routing (Phase 1)
- **Tách quy trình biên kịch 3 bước (`engine/ai/runner.mjs`, `engine/ai/queue_broker.mjs`):**
  - Thêm chế độ `three_stage` tách biệt **Stage 1 (`brief.json`)** (mục tiêu sư phạm, vấn đề cốt lõi, `visual_job`, `world_theme`) → **Stage 2 (`dialogue.json`)** (kịch bản lời thoại tự nhiên kèm Dual-Text TTS `tts_beats`/`tts_narration`) → *(tùy chọn)* **Audio Spine (`audio_spine.json`)** khóa nhịp giây thật trước khi dựng hình → **Stage 3 (`script.json`)** (biên dịch scene, Visual Template, Motion & Layout).
  - Hỗ trợ tạm dừng duyệt giữa chặng (`pause_after`), tiếp tục từ bước cụ thể (`start_from`), và `lock_audio_spine`.
- **Dynamic Per-Role Provider Routing (`engine/ai/providers.mjs`):**
  - Thêm `VALID_PIPELINE_ROLES` (`brief`, `dialogue`, `visual_director`), `savePipelineRouting`, `resolveRoleProvider` và endpoint `POST /api/ai/preferences/routing` — không gắn cứng AI agent/model nào (fallback trung lập `"connected-agent"`).
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
