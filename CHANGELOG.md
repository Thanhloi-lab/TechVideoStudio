# Changelog

Ghi chép các thay đổi đã hoàn thiện và kiểm thử trong `TechVideoStudio` (theo lộ trình tại [`engine/UPGRADE_CHECKLIST.md`](engine/UPGRADE_CHECKLIST.md)).

---

## [v2.0 / 2026-11-23] — Deep-Dive Multi-Part Course Factory, Independent Reviewers (`curriculum-reviewer` & `content_reviewer`), 11 Visual Components & Level-1 Cleanup

### 1. Kiến trúc Khóa học Chuyên sâu Đa Phần (`deep_course`, Không Giới Hạn 3–5 Phút/Tập)
- **Mở khóa thời lượng bài học theo chiều sâu kỹ thuật (`course_depth: "deep_dive"`):**
  - Thời lượng tổng mỗi tập do `curriculum-architect` quyết định theo độ phức tạp kiến thức (thường **10–25 phút/tập**), tự động chia thành các phần độc lập **`parts/part_01..part_N` (`<= 5 phút` / `max_part_duration_sec: 300`, ~600–850 từ tiếng Việt đọc)** để người học và tác giả dễ kiểm duyệt từng phần trước khi gộp.
  - Bổ sung `episode_canon` (`shared_glossary`, `running_example`, `target_audience_assumptions`) trong `brief.json` cùng `entry_bridge` / `exit_bridge` và cơ chế truyền `previousPartHandoff` giữa các phần để `part_02+` nối mạch tự nhiên, không lặp lại phần chào mở đầu hay kết bài.
- **Quản lý Trạng thái & Gộp Đa Phần Tất Định (`engine/state_cli.mjs`):**
  - Bổ sung 3 lệnh CLI mới: `parts --course <C> --ep <E> [--json]`, `set-part --course <C> --ep <E> --part <P> [--status ...] [--ai-verdict APPROVED|REVISE] [--approved true|false]`, và `merge-parts --course <C> --ep <E> [--force]`.
  - `merge-parts` kiểm tra toàn bộ các phần đã được duyệt (`approved === true`), tự động gắn tiền tố `<part_id>_` cho `scene.id`, ánh xạ lại đường dẫn âm thanh `parts/<part_id>/audio/<profile>/*` và `voice_tracks` (không nhân bản file âm thanh trên đĩa), cộng dồn mốc thời gian `subtitles.srt` liên tục qua các phần, tổng hợp mục lục `notes.md`, chạy `validateScriptDiagrams`, và bật `production.tts_done = true` khi tất cả các phần đã có audio.

### 2. Hai Cổng Phản Biện Độc Lập (`curriculum-reviewer` & `content_reviewer`) + Định Tuyến 5 Vai Trò
- **Bộ 6 Kỹ năng Antigravity (`plugin/tech-video-studio/skills/`):**
  - Thêm **`curriculum-reviewer`** (`plugin/tech-video-studio/skills/curriculum-reviewer/SKILL.md`): subagent ngữ cảnh sạch kiểm định `course.json` + `curriculum.md` theo 5 tiêu chí và xuất `<COURSE>/curriculum_review.md` (`APPROVED` / `REVISE`) tối đa 2 vòng trước khi chạy `state_cli.mjs init`.
  - Thêm **`content-reviewer`** (`plugin/tech-video-studio/skills/content-reviewer/SKILL.md`): subagent ngữ cảnh sạch kiểm định `brief.json` (`brief_review.md`) và từng `parts/<part_id>/dialogue.json` + `notes.md` (`parts/<part_id>/review.md`) theo 5 tiêu chí (*Coverage & Fidelity*, *Technical Depth & Proof*, *Pedagogical Clarity & Dual-Text TTS*, *Part Pacing <= 300s & Continuity*, *Notes Completeness*).
- **Vòng lặp Phản biện Ngữ cảnh Sạch & Định tuyến 5 Vai trò (`engine/ai/providers.mjs`, `engine/ai/runner.mjs`, `engine/ai/queue_broker.mjs`):**
  - Mở rộng `VALID_PIPELINE_ROLES` lên **5 vai trò**: `outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair`.
  - Thống nhất chế độ sinh kịch bản về **`deep_course`** (tương thích ngược các bí danh cũ): Stage 1 (`brief.json`) → Stage 1.5 (`brief_review.md`) → theo từng phần Stage 2 (`dialogue.json` + `notes.md`) → Stage 2.5 (`content_reviewer` chạy trong ngữ cảnh sạch `messages.length === 2`, tự động truyền `rewrite_instructions` để viết lại tối đa 2 vòng khi `REVISE`) → Stage 3 (biên dịch sang 11 visual templates + `repairInvalidScenes`).
  - Hỗ trợ cổng dừng `pause_after: "none" | "brief" | "part_review" | "dialogue"` và `start_from: "brief" | "dialogue" | "visual"` (+ `part_id`), luôn cưỡng bức `auto_produce = false` khi dừng ở cổng trung gian.

### 3. Mở Rộng Thư Viện Trực Quan 7 → 11 Templates & Visual Variety Guard
- **4 Template Kỹ thuật Chuyên sâu Mới (`engine/src/template_schema.mjs`, `engine/src/diagram_validator.mjs`, `engine/VISUAL_COMPONENTS.md`):**
  - **`sequence_diagram`**: Sơ đồ chuỗi thời gian đa tác nhân (`actors[]`, `messages[]` đồng bộ/bất đồng bộ/trả về/tự gọi, `highlights[]`).
  - **`memory_layout`**: Cấu trúc bộ nhớ, thanh ghi, slab/ring buffer, page table (`lanes[].cells[]` với trạng thái `idle|active|match|write|danger`, `steps[]` với `highlight_cells[]` và con trỏ `pointers[]` `from_lane`/`from_cell` → `to_lane`/`to_cell`).
  - **`code_diff`**: So sánh mã nguồn và cấu hình Trước vs. Sau song song (`left_lines[]`, `right_lines[]`, `focus_steps[]` tô sáng dòng 1-based kèm Shiki syntax tokens).
  - **`concept_breakdown`**: Phân rã kiến trúc trung tâm và các nhánh nguyên lý (`core`, `branches[]` kèm `progress_start..progress_end` và metric badge, `takeaway`).
- **Đối xứng HyperFrames Runtime & Studio React Player (Dark & Light Themes):**
  - Thêm 4 module HyperFrames DOM + GSAP (`engine/hyperframes/runtime/scenes/{sequence_diagram,memory_layout,code_diff,concept_breakdown}.mjs`) và 4 component React thuần ESM (`engine/src/components/{SequenceDiagram,MemoryLayout,CodeDiff,ConceptBreakdown}.mjs`).
  - **Visual Variety Guard (`diagram_validator.mjs`):** Cảnh báo khi lặp lại cùng một `visual_type` ở hai scene liên tiếp (`duplicate-adjacent-visual-type`, có ngoại lệ cho chuỗi lab `code_cli`) hoặc khi tập/phần có từ 4 scenes trở lên nhưng dùng dưới 3 loại template (`low-visual-variety`), đồng thời căn chỉnh phụ đề Layer 1 trong `engine/tts_pipeline.py` cho cả 11 templates.

### 4. Tái Sử Dụng Audio-Spine (`reused_scenes`), Dọn Dẹp Level-1 & Render `--part` @ 30fps
- **Tái sử dụng Beat Audio-Spine Không Gọi Lại TTS (`engine/tts_pipeline.py`):**
  - Khi `audio_spine.json` đã được khóa trước Stage 3, `process_episode()` tự động ghép nối lại các file âm thanh beat khớp `beat_id` và `tts_text` đã chuẩn hóa (`reused_scenes`), tiết kiệm 100% lượt gọi TTS trùng lặp.
- **Dọn dẹp Level-1 & Chuẩn hóa HyperFrames Duy Nhất (`engine/render_video.mjs`, `engine/src/video_encode_utils.mjs`):**
  - Xóa bỏ hoàn toàn trình xuất Canvas 2D cũ (`engine/src/exporter.mjs`, `engine/src/canvas_templates/*` — 7 file) và các tài liệu trùng lặp ở thư mục gốc (`CLAUDE.md`, `README.en.md`), trích xuất các tiện ích mã hóa dùng chung sang `engine/src/video_encode_utils.mjs`.
  - Đặt tốc độ khung hình mặc định là **`30` fps** trên toàn hệ thống (`render_video.mjs`, `server.mjs`, `studio.mjs`) và bổ sung cờ **`--part <part_id>`** trên `render_video.mjs`, `render.mjs`, `compiler.mjs`, `studio_server.mjs`, `snapshot.mjs`, `verify_video.mjs`, `hf_encoder.mjs`, và `routes/media.mjs` để xuất/kiểm định nhanh video preview cho từng phần (`episodes/<ep>/parts/<part_id>/<part_id>.mp4`) cũng như video tổng sau khi chạy `merge-parts`.
- **Nâng cấp Giao diện Web Studio (`engine/src/studio.mjs`, `AiScriptModal.mjs`, `ScriptingStageModal.mjs`, `RoleRoutingPanel.mjs`):**
  - Cập nhật `RoleRoutingPanel` hỗ trợ 5 vai trò (`N/5 tùy chỉnh`), tinh gọn `AiScriptModal` cho luồng `deep_course`, bổ sung thanh chọn Phần (`stage-parts-selector`), tab **`4. 🛡️ AI Review`** (`review.md`), nút **Duyệt Part** & **Gộp Parts** trong `ScriptingStageModal`, và thanh **Part Switcher** (`.player-part-switcher`) ngay trên Studio Player.

### 5. Kết Quả Kiểm Thử Đầu-Cuối (Wave 3 Verified, Exit Code 0)
- **Thống kê Git (`5ec798f..HEAD`):** `62 files changed, 14460 insertions(+), 7624 deletions(-)` (xóa 9 file legacy, thêm 12 file mới).
- **`node setup.mjs --workspace --global` & `node setup.mjs --check --json`:** PASS (`fileCount: 11` bao gồm 6 skills đồng bộ tại workspace & global).
- **`python -m py_compile engine/tts_pipeline.py` & `node engine/state_cli.mjs validate-diagrams --course REDIS`:** PASS (`ep01`..`ep06` đạt `0 errors, 0 warnings`).
- **`node engine/test_hyperframes.mjs` (full render, không `--skip-render`):** **PASS (`12/12` checks, exit 0)** — toàn bộ 11 templates (bao gồm 4 templates mới ở cả hai giao diện Dark & Light) vượt qua kiểm định tính tất định và strict Layout QC (`errors=0, warnings=0`), render preview `--part part_01` (`4.42s`, `-16.02 LUFS`, `0` lỗi QC) và render tập gộp `merge-parts` (`8.81s`, `-16.02 LUFS`, `0` lỗi QC).
- **`node engine/test_phase1_three_stage.mjs`:** **PASS (`6/6` sections, exit 0)** — kiểm chứng định tuyến 5 vai trò, luồng đa phần `deep_course`, vòng lặp `content_reviewer` ngữ cảnh sạch (`REVISE` vòng 1 → `APPROVED` vòng 2), handoff sang `part_02`, tái sử dụng `audio_spine.json` (`reused_scenes=2`, `0` lượt gọi TTS dư thừa), `state_cli.mjs parts / set-part / merge-parts`, và giao diện Chrome UI 5 vai trò + tab `4. 🛡️ AI Review`.
- **`node engine/test_ai_bridge_and_templates.mjs`:** **PASS (`18/18` sections, exit 0)** — kiểm chứng toàn bộ 11 templates, Visual Variety Guard (`duplicate-adjacent-visual-type`, ngoại lệ nối tiếp `code_cli`, `low-visual-variety`), từ chối `--engine legacy`, batch 7 tập `deep_course` tạm dừng 429 & tiếp tục qua DeepSeek, và đồng bộ 6 skills.
- **Live Studio UI Headless Chrome Smoke Check:** **PASS (`0` console errors, `0` page errors, `0` broken imports)** trên `view=projects`, `view=roadmap` (`course=REDIS`), và `view=player` (`REDIS/ep02` + tập đa phần với Part Switcher, 4 React components mới và `ScriptingStageModal`).

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
