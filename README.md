# Tech Course Video Studio

**Tech Course Video Studio** là hệ thống sản xuất video bài giảng công nghệ **Deep-Dive** hoàn chỉnh (lộ trình học có phản biện độc lập, kịch bản đa phần *multi-part* `<= 5 phút/phần`, giọng đọc Tiếng Việt giữ nguyên thuật ngữ Tiếng Anh, phụ đề đồng bộ, 11 template trực quan hóa động và xuất video Full HD/4K qua HyperFrames), kết hợp giữa **Plugin SSOT (`plugin/tech-video-studio/` + `AGENTS.md`)**, **Web Studio 3 màn hình (`http://localhost:3030`) với 9 kênh AI (ChatGPT, Claude, DeepSeek, Gemini, OpenRouter, Ollama, LM Studio, Antigravity Worker, Manual `$0`)**, và **engine thuần Node.js + Python standard library**.

> Toàn bộ hệ thống hoạt động theo kiến trúc **Zero External Packages**: không cần `npm install`, không cần `pip install`, và không gọi file thực thi `.exe` chưa ký số (như `ffmpeg.exe`, `pip.exe`, `esbuild.exe`), tương thích tốt với chính sách bảo mật Windows Application Control.

---

## Mục lục

- [1. Tính năng nổi bật](#1-tính-năng-nổi-bật)
- [2. Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
- [3. Cài đặt (Setup) sau khi Clone / Pull](#3-cài-đặt-setup-sau-khi-clone--pull)
- [4. Khởi động Studio, AI Đa Provider & Luồng làm việc](#4-khởi-động-studio-ai-đa-provider--luồng-làm-việc)
- [5. Tham chiếu CLI, API & Biến môi trường](#5-tham-chiếu-cli-api--biến-môi-trường)
- [6. Cấu trúc thư mục dự án](#6-cấu-trúc-thư-mục-dự-án)
- [7. Khắc phục sự cố thường gặp](#7-khắc-phục-sự-cố-thường-gặp)

---

## 1. Tính năng nổi bật

### 1.1. Quy trình Deep-Dive Multi-Part & Phản biện Độc lập (3 Conversations)
Tiến độ từng tập video được lưu nguyên tử (atomic) tại `<COURSE>/state/<ep-slug>.json` (gồm `parts[]`, `merged_at`, `revisions[]`) kèm nhật ký `<COURSE>/state/events.jsonl` do `engine/state_cli.mjs` quản lý:
1. **Conversation 1 — Thiết kế & Phản biện Lộ trình (`curriculum-architect` + `curriculum-reviewer`):**
   - Thực hiện phỏng vấn `/grill-me` từng câu (mục tiêu chứng chỉ/thực chiến deep-dive, quy mô `10/20/30` tập, giọng đọc mặc định từ `engine/voices.json`, độ sâu Lab/CLI/Code, phạm vi triển khai).
   - **Không giới hạn cứng 3–5 phút/tập:** Kiến trúc sư Lộ trình tự quyết định tổng thời lượng mỗi tập (thường **10–25 phút**) chia nhỏ thành `estimated_parts` **tối đa `<= 5 phút/phần`** (`course_depth: "deep_dive"`, `max_part_duration_sec: 300`, `prerequisites[]`, `learning_objectives[]`, `must_cover_concepts[]`).
   - **Cổng Phản biện Độc lập:** Subagent `curriculum-reviewer` (context độc lập, không tự duyệt) chấm 5 tiêu chí và ghi `<COURSE>/curriculum_review.md` (`APPROVED` / `REVISE`, tối đa 2 vòng) trước khi chạy `state_cli.mjs init`.
2. **Conversation 2 — Nhà máy Kịch bản Đa phần (`episode-producer` + `content-reviewer` / Web Studio `deep_course`):**
   - **Chế độ hợp nhất `deep_course` với 5 vai trò động (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair`):**
     - **Stage 1 (`brief.json`) + Stage 1.5 (`brief_review.md`):** Thiết lập `episode_canon` (`shared_glossary`, `running_example`) và phân bổ `parts[]` (`<= 5m/phần`, phủ 100% `must_cover_concepts[]`, có `entry_bridge`/`exit_bridge`), sau đó `content-reviewer` độc lập phản biện.
     - **Stage 2 (`parts/<part_id>/dialogue.json` + `notes.md`) + Stage 2.5 (`parts/<part_id>/review.md`):** Viết từng phần nối tiếp (handoff từ phần trước, không lặp intro/outro, độ sâu bản chất + trace thực tế, Dual-Text TTS), bắt buộc qua `content-reviewer` độc lập (tối đa 2 vòng; **tác giả không bao giờ tự duyệt**).
     - **Tùy chọn Audio-Spine (`audio_spine.json`):** Khóa timing từ giọng đọc thật; khi chạy TTS đầy đủ sau đó, các scene khớp beat sẽ **tái sử dụng thẳng audio chunk** mà không gọi lại TTS.
     - **Stage 3 (`parts/<part_id>/script.json`):** Biên dịch sang **11 Visual Templates** kèm **Visual Variety Guard** (không lặp `visual_type` liên tiếp, `>= 3` loại/phần, luân phiên `dark`/`light`).
   - **Duyệt từng phần & Merge tất định:** Xem thử từng phần `<= 5m` trên Studio Player hoặc `render_video.mjs --part <part_id>`, bấm Approve (`set-part --approved true`), rồi chạy `state_cli.mjs merge-parts` để gộp `script.json` (remap audio & `voice_tracks`), cộng offset `subtitles.srt` và tạo mục lục `notes.md`.
   - **Tách bạch chặt Biên kịch vs Sản xuất (`auto_produce`):** Biên kịch luôn dừng ở `script_ready` (hoặc cổng `pause_after`: `"brief" | "part_review" | "dialogue" | "none"`), không tự chạy full TTS/Render trừ khi bật `auto_produce === true`.
3. **Conversation 3 — Nhà máy Video (`episode-producer` + `video-renderer`):**
   - Tổng hợp giọng đọc đa track (`audio/<profile_id>/` + `subtitles.<profile_id>.srt`), tái sử dụng `audio_spine.json`, **tự động khớp nhịp animation theo phụ đề (Layer 1)** trên cả 11 template, tinh chỉnh theo playhead (Layer 2), render video qua headless Chrome + **HyperFrames** (`engine/render_video.mjs`, mặc định **30fps**, hỗ trợ `--part <part_id>`), kiểm tra Layout QC & console, và chốt `completed`.

### 1.2. Multi-Provider AI & Bảo mật Key tuyệt đối (`engine/ai/`)
Hỗ trợ **9 kênh AI** ngay trong Web Studio (`BrandHealthGrid`) thông qua `GET /api/ai/providers`, `POST /api/ai/providers/credentials`, `POST /api/ai/providers/test`:
- **Cloud API (BYOK):** **OpenAI (ChatGPT)**, **Anthropic (Claude)**, **DeepSeek**, **Google Gemini**, **OpenRouter** (`$0` handshake + `🧪 Test 1 token`; API key lưu cục bộ tại `engine/.ai_credentials.json` hoặc biến môi trường OS, không bao giờ rò rỉ ra frontend).
- **Local AI:** **Ollama** (`http://127.0.0.1:11434`) & **LM Studio** (`http://127.0.0.1:1234/v1`).
- **Agent MCP Worker:** **Antigravity Worker** (`studio-worker` qua `worker_wait.mjs`).
- **Thủ công `$0` (`manual_web`):** Tạo Prompt Pack & validate JSON dán vào.
- **Lưu lựa chọn & Quota-Safe Pause/Resume:** Ghi nhớ `last_selection` + định tuyến 5 vai trò trong `engine/.ai_preferences.json`; khi gặp `429`/`402`, job tạm dừng an toàn và cho phép **`▶ Tiếp tục (Resume / Đổi Model)`**.

### 1.3. 11 Visual Templates, Visual Variety Guard & Bộ máy Motion V2
Giao diện trình chiếu (`engine/src/components/` + `engine/src/motion/kernel.mjs` + HyperFrames DOM/GSAP) hỗ trợ **11 mẫu cảnh đối xứng** tỷ lệ 16:9 (xem [`engine/VISUAL_COMPONENTS.md`](engine/VISUAL_COMPONENTS.md) & `engine/src/template_schema.mjs`):
- **7 mẫu nền tảng:** `architecture` (`zones[]` tối đa 2 cấp, kho SVG `engine/assets/svg/`, `layout_mode: "auto"`, `camera_focus`), `console_setup`, `code_cli` (Shiki Magic Move `code_override` + `laser_scan`), `exam_tips`, `comparison_matrix`, `timeline_flow`, `kpi_metrics`.
- **4 mẫu chuyên sâu mới (Deep-Dive):**
  - **`sequence_diagram`**: Trục thời gian gọi hàm / giao thức / RPC / auth giữa `actors[]`, `messages[]`, `highlights[]`.
  - **`memory_layout`**: Trực quan hóa bộ nhớ, stack/heap, buffer, B-tree page với `lanes[]` (`cells[]`) & `steps[]` (`highlight_cells`, `pointers`).
  - **`code_diff`**: So sánh code trước/sau (Shiki syntax highlighting, `left_lines[]`, `right_lines[]`, `focus_steps[]`).
  - **`concept_breakdown`**: Phân rã giải phẫu khái niệm / cây quyết định / chuyển chương (`core`, `branches[]`, `takeaway`). — Xem chi tiết tại [`engine/VISUAL_COMPONENTS.md`](engine/VISUAL_COMPONENTS.md).
- **Visual Variety Guard:** `diagram_validator.mjs` kiểm tra không lặp `visual_type` ở 2 cảnh liền kề, khuyến khích `>= 3` template/part và luân phiên `world_theme` (`"dark" | "light"`), `causal_mechanic`, `sfx_cues`, `bgm_file`.

### 1.4. Tổng hợp giọng đọc TTS đa track (Multi-Voice A/B), Audio-Spine Reuse & Khớp nhịp 2 lớp (`engine/tts_pipeline.py`)
Viết hoàn toàn bằng thư viện chuẩn Python (`urllib`, `ssl`, `socket`, `wave`, ...):
- **Kế thừa giọng 3 tầng:** `--profile` CLI / `script.json` → `course.json` → `engine/voices.json` (tích hợp sẵn **25 giọng VieNeu-TTS v3 Turbo** qua `openai_compat` tại `http://127.0.0.1:8000/v1/audio/speech`).
- **Audio-Spine Beat Reuse & Dual-Text:** Hỗ trợ `tts_beats` / `tts_narration`; nếu `audio_spine.json` tồn tại với các beat khớp `beat_id` + `tts_text` và file audio hợp lệ, `process_episode()` tái sử dụng trực tiếp audio beat (`reused_scenes`) không gọi lại TTS.
- **Multi-Voice A/B Preservation & 2-Layer Sync:** Giữ nguyên track cũ trong `audio/<profile_id>/` + `subtitles.<profile_id>.srt`; Layer 1 (`--realign-only`) khớp `cue_sentence` / `cue_text` trên cả **11 visual templates** từ `_base_timings`; Layer 2 tinh chỉnh qua **`⏱️ Khớp nhịp Animation`**.

### 1.5. Studio Web Dashboard 3 Màn hình (`http://localhost:3030`)
Khởi chạy qua `engine/server.mjs` và đồng bộ real-time bằng Server-Sent Events (`/api/stream`):
1. **Project Dashboard (`?view=projects`):** Tổng quan tất cả khóa học, thanh tiến độ và số ticket sửa lỗi.
2. **Episode Roadmap & Live Monitor (`?view=roadmap`):** Pill **`🤖 AI Worker & Models`** (`BrandHealthGrid` + **`RoleRoutingPanel`** 5 vai trò), `AiScriptModal` (`deep_course`, `auto_produce: false`), **`ScriptingStageModal`** (Part selector, `brief.json`, `dialogue.json`, tab **`review.md`**, `audio_spine.json`, **Approve Part**, **Merge Parts**), batch/resume, `VoiceStudioModal`, và 3 tab bên phải.
3. **Studio Player (`?view=player`):** **Part Switcher** (xem tập gộp hoặc từng `part_01..part_N`), Storyboard Preview trên cả 11 template, Multi-Voice A/B Switcher, popover **`🎬 Xuất Video ▾`** (HyperFrames duy nhất, mặc định **30fps**, không còn tùy chọn legacy), khung **`📁 Video đã xuất`**, tab **`🎬 Phân cảnh`** (`⏱️ Khớp nhịp Animation`) và **`🛠️ Sửa`**.

### 1.6. Render Video bằng HyperFrames (`engine/render_video.mjs`)
- **Engine duy nhất: [HyperFrames](https://github.com/heygen-com/hyperframes)** — biên dịch thành project `<ep>/hyperframes/index.html` (11 template DOM + GSAP, runtime `hyperframe.runtime.iife.js` vendor offline), render mặc định ở **`30` fps** qua Chrome headless CDP + WebCodecs (không cần FFmpeg hay npm), hỗ trợ `--part <part_id>` cho bản preview `<= 5m`, tự động mở rộng timeout cho tập dài 15–25 phút, mix 6 SFX 48kHz (`-33ms` lead), carved BGM (`1800Hz -6dB`), chuẩn hóa **BS.1770-4 `-16 LUFS`**, và chạy **DOM Layout & Safe-Zone QC Gate** (`engine/hyperframes/layout_qc.mjs`).

### 1.7. Universal MCP Bridge (Stdio + Loopback HTTP `/mcp`)
- Dùng chung `engine/mcp/rpc.mjs` cho **Stdio** (`engine/mcp_server.mjs`) và **Loopback HTTP** (`GET|POST http://127.0.0.1:3030/mcp`), cung cấp **9 tools** (`studio_*`) và **4 MCP resources** (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).

---

## 2. Yêu cầu hệ thống

| Thành phần | Phiên bản / Yêu cầu | Lý do & Ghi chú |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.0.0` | `engine/render_video.mjs` dùng API `WebSocket` global. Không cần `npm install`. |
| **Python** | `>= 3.10` | `engine/tts_pipeline.py` dùng thuần stdlib. Nếu dùng `python3`, đặt `PYTHON_BIN=python3`. |
| **Google Chrome** | Đã cài trên máy | Windows mặc định tìm `C:\Program Files\Google\Chrome\Application\chrome.exe`. Đặt `CHROME_PATH` nếu cài ở nơi khác. |
| **Kết nối Internet** | Cần khi dùng Web UI & Cloud AI/TTS | Web UI nạp ESM từ `https://esm.sh/`; TTS `edge`/`google` và Cloud AI gọi API online *(hoặc chạy hoàn toàn local với Ollama/LM Studio + VoiceStudio)*. |

---

## 3. Cài đặt (Setup) sau khi Clone / Pull hoặc qua `npx`

### Cách nhanh nhất trên máy mới (Không cần `git clone`) — `npx`

```powershell
# Chạy trực tiếp từ GitHub (hoặc `npx tech-video-studio` nếu đã publish npm)
npx github:Thanhloi-lab/TechVideoStudio

# Chỉ kiểm tra dependencies & danh sách AI Agent hiện có trên máy
npx github:Thanhloi-lab/TechVideoStudio check

# Tự động cài thêm Python / Chrome nếu máy chưa có và chọn toàn bộ Agent phát hiện được
npx github:Thanhloi-lab/TechVideoStudio setup --install-deps --yes

# Mở Web Studio UI tùy chọn (cổng 3030 — không bắt buộc khi tạo lộ trình/kịch bản/render video)
npx github:Thanhloi-lab/TechVideoStudio studio
```

- CLI tự động quét các AI Agent phổ biến trên máy (cả bản **App/IDE** lẫn **CLI**: Antigravity App, Antigravity CLI `agy`, Claude Desktop, Claude Code CLI, Codex App/CLI, Gemini CLI, Cursor, Windsurf, VS Code + Copilot, OpenCode CLI) và **chỉ hiển thị đúng những Agent đang tồn tại trên máy** để bạn chọn cài đặt.
- Khi chạy qua `npx`, runtime `engine/` + `plugin/` sẽ được đồng bộ bền vững vào `~/.tech-video-studio` (hoặc `--install-dir <dir>`), đồng thời kiểm tra & hỗ trợ cài tự động **Python `>= 3.10`** và **Google Chrome** qua `winget` / `brew` / `apt` / `dnf`.

### Bước 1: Clone repository về máy (nếu muốn phát triển trực tiếp)

```powershell
git clone git@github.com:Thanhloi-lab/TechVideoStudio.git
cd TechVideoStudio
```

### Bước 2: Chạy `setup.mjs` (Single Source of Truth -> Plugin Workspace & Global)

Từ nguồn chuẩn duy nhất (`AGENTS.md` + `plugin/tech-video-studio/`), chạy `setup.mjs`:

```powershell
# Khuyên dùng: Đồng bộ Antigravity plugin (6 skills) cho cả workspace & global (~/.gemini/config/plugins)
node setup.mjs --workspace --global

# Hoặc chỉ cài cho workspace (.agents/plugins/tech-video-studio) / chỉ global
node setup.mjs --workspace
node setup.mjs --global

# Kiểm tra chẩn đoán không ghi file (Node/Python/Chrome, plugin status, env keys true/false)
node setup.mjs --check --json
```

*(Tùy chọn mở rộng: `--agents claude|codex|all` và `--claude-desktop` vẫn được hỗ trợ khi bạn chủ động muốn sinh adapter ngoài.)*

### Bước 3: Reload IDE / Agent & Khởi động Web Studio (Port `3030`)

```powershell
node engine/server.mjs
```

Mở trình duyệt tại **`http://localhost:3030`**.

---

## 4. Khởi động Studio, AI Đa Provider & Luồng làm việc

| Giai đoạn | Cách thực hiện | Ghi chú |
| :--- | :--- | :--- |
| **1. Lộ trình (`curriculum-architect` + `curriculum-reviewer`)** | Nhắn Agent: *"Tạo khóa học video mới về Kubernetes (CKA) tại K8S"* | Phỏng vấn `/grill-me`, thiết kế tập deep-dive chia part `<= 5m`, subagent `curriculum-reviewer` duyệt `curriculum_review.md` rồi mới `init`. |
| **2a. Biên kịch trên Web UI (`deep_course` 5 vai trò)** | Chọn provider/model trong **`🤖 AI Worker & Models`** -> gán vai trò tại **`RoleRoutingPanel`** -> bấm **`✍️ Biên kịch`** hoặc **`☑️ Chọn nhiều`** | Hỗ trợ `brief.json` + `brief_review.md` -> từng `parts/<part_id>/` + `review.md` -> Audio-Spine -> `script.json` (11 templates), Approve Part & Merge Parts. |
| **2b. Biên kịch qua MCP Worker (`studio-worker`)** | Mở chat Antigravity mới và nhắn **`Bật VideoMaker Worker`** (`worker_wait.mjs` 0 token khi rảnh) | Thực thi `script_episode` / `script_batch` (tối đa 5 tập/lượt). |
| **2c. Biên kịch `$0` Thủ công (`manual_web`)** | Chọn **Manual Web** trong `AiScriptModal` -> **`📋 Tạo Prompt Pack`** -> dán JSON -> **`✅ Kiểm tra & Lưu`** | Không tốn phí API key, vẫn validate sơ đồ & cập nhật state chuẩn. |
| **3. Audio, Đồng bộ & Video (`video-renderer`)** | Chạy `tts_pipeline.py` (tái sử dụng `audio_spine.json`) + `render_video.mjs` (30fps, hỗ trợ `--part part_01`), hoặc thao tác ngay trên Studio Player | Bảo toàn track giọng A/B trong `audio/<profile_id>/`, hỗ trợ preview từng part `<= 5m` hoặc tập đã merge. |

---

## 5. Tham chiếu CLI, API & Biến môi trường

### 5.1. Quản lý State, Multi-Part & Kiểm tra Sơ đồ (`engine/state_cli.mjs`)

```powershell
node engine/state_cli.mjs init --course <COURSE>
node engine/state_cli.mjs summary --course <COURSE> [--json]
node engine/state_cli.mjs next --course <COURSE> --stage <scripting|production> [--limit 5] [--json]
node engine/state_cli.mjs set --course <COURSE> --ep <EP_ID> --stage <scripting|production> --status <STATUS> [--owner "..."] [--note "..."] [--tts-done true] [--video-done true] [--verified true]
node engine/state_cli.mjs parts --course <COURSE> --ep <EP_ID> [--json]
node engine/state_cli.mjs set-part --course <COURSE> --ep <EP_ID> --part <PART_ID> [--status pending|in_progress|reviewing|needs_revision|completed] [--approved true|false] [--ai-verdict APPROVED|REVISE] [--note "..."]
node engine/state_cli.mjs merge-parts --course <COURSE> --ep <EP_ID> [--force]
node engine/state_cli.mjs validate-diagrams --course <COURSE> [--ep <EP_ID>] [--json]
node engine/state_cli.mjs svg-list [--json]
node engine/state_cli.mjs sync --course <COURSE>
node engine/state_cli.mjs revisions --course <COURSE> [--ep <EP_ID>] [--status open|in_progress|resolved|all]
node engine/state_cli.mjs add-revision --course <COURSE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc "<mô tả lỗi>"
node engine/state_cli.mjs resolve-revision --course <COURSE> --ep <EP_ID> --rev <REV-001> --note "<đã sửa>"
```

### 5.2. Tổng hợp TTS (`engine/tts_pipeline.py`) & Render HyperFrames (`engine/render_video.mjs`)

```powershell
python engine/tts_pipeline.py --episode "<COURSE>/episodes/<EP_ID>/script.json" --course "<COURSE>/course.json" --json
python engine/tts_pipeline.py --audio-spine "<COURSE>/episodes/<EP_ID>/parts/part_01/dialogue.json" --course "<COURSE>/course.json" --json
python engine/tts_pipeline.py --realign-only --episode "<COURSE>/episodes/<EP_ID>/script.json" [--scene <SCENE_ID>] [--profile <PROFILE_ID>] --json
python engine/tts_pipeline.py --list-profiles
python engine/tts_pipeline.py --discover-voicestudio --json
python engine/tts_pipeline.py --preview --profile edge-hoaimy --text "Xin chào" --out preview.mp3

node engine/scripts/generate_sfx_assets.mjs
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> [--part part_01] --port 3030 --format mp4 --codec h264 --resolution 1080p --fps 30 --speed 1 --hardware auto [--output <TEN_FILE>] [--workers 1..8] [--check-layout|--no-check-layout] [--qc-strict]
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> --compile-only
node engine/hyperframes/snapshot.mjs --course <COURSE> --episode <EP_ID> [--part part_01] --scene 0 --at 0.1,0.5,0.9 --check-determinism [--check-layout] [--qc-strict]
node engine/hyperframes/verify_video.mjs --course <COURSE> --episode <EP_ID> --file <EP_ID>.mp4 --frames 3,30 [--check-layout] [--qc-strict]

node engine/test_phase1_three_stage.mjs
node engine/test_ai_bridge_and_templates.mjs
node engine/test_hyperframes.mjs
```

### 5.3. API AI & MCP Endpoints chính (`engine/server.mjs`)

| Endpoint | Mục đích |
| :--- | :--- |
| `GET /api/ai/providers[?force=1]` | Danh sách 9 brand AI, trạng thái auth, model live, `last_selection`, `pipeline_routing` (không trả về key). |
| `POST /api/ai/providers/credentials` | Lưu/cập nhật/xóa key vào `engine/.ai_credentials.json` và chạy handshake `$0`. |
| `POST /api/ai/providers/test` | Kiểm tra lại kết nối hoặc test `ping_one_token: true`. |
| `POST /api/ai/preferences/routing` | Lưu định tuyến 5 vai trò (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair`) vào `engine/.ai_preferences.json`. |
| `POST /api/ai/jobs` | Tạo job `deep_course` (`pause_after`, `start_from`, `part_id`, `lock_audio_spine`, `role_routing`, `auto_produce: false`). |
| `GET /api/episodes/scripting-artifacts` & `POST /api/episodes/{brief,dialogue,audio-spine}` | Đọc/sửa `brief.json`, `parts/<part_id>/dialogue.json`, `review.md`, và chạy `--audio-spine`. |
| `GET /api/episodes/part`, `POST /api/episodes/part/approve`, `POST /api/episodes/merge-parts` | Đọc dữ liệu từng phần, duyệt phần, và gộp các phần đã duyệt thành tập hoàn chỉnh. |
| `POST /api/ai/jobs/resume` | Tiếp tục job đang `paused`/`failed` trên các tập còn lại. |
| `POST /api/ai/manual-prompt` & `manual-submit` | Tạo Prompt Pack `$0` và validate/lưu JSON kịch bản dán vào. |
| `POST /api/episodes/voice-track/activate` & `delete` | Chuyển đổi tức thì giữa các track giọng A/B đã tạo (`0` gọi TTS) hoặc xóa track dư. |
| `POST /api/episodes/scene-timings` | Lưu timing Playhead (`action: "save"`) hoặc chạy Layer 1 (`action: "auto_align"`). |
| `POST /api/jobs/run-production` & `POST /api/episodes/video/delete` | Khởi chạy TTS/Render HyperFrames (hỗ trợ `part_id`) hoặc xóa file video trong thư mục bài học. |
| `GET\|POST /mcp` | Loopback HTTP Streamable MCP endpoint (9 `studio_*` tools + 4 `studio://*` resources). |

### 5.4. Biến môi trường hữu ích

| Biến môi trường | Mặc định | Tác dụng |
| :--- | :--- | :--- |
| `PORT` / `VIDEO_MAKER_PORT` | `3030` | Đổi cổng Studio HTTP server, MCP bridge (`mcp_server.mjs`), và `worker_wait.mjs`. |
| `VIDEO_MAKER_WORKSPACE_ROOT` | Thư mục cha của `engine/` | Trỏ thư mục chứa các khóa học nếu đặt tách khỏi repo. |
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Đường dẫn Chrome/Chromium khi render trên macOS, Linux hoặc Windows tùy chỉnh. |
| `PYTHON_BIN` | `python` | Lệnh Python dùng để gọi `tts_pipeline.py` (ví dụ `python3` trên Linux/macOS). |
| `VOICESTUDIO_BASE_URL` / `VOICESTUDIO_API_URL` | `http://localhost:8000` | Địa chỉ server VoiceStudio cục bộ. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | *(tùy chọn)* | Tự động nhận diện ở backend (hoặc nhập trên Web UI vào `engine/.ai_credentials.json`). |

---

## 6. Cấu trúc thư mục dự án

```text
TechVideoStudio/
├── AGENTS.md                         # Nguồn quy tắc workspace chuẩn (SSOT)
├── CHANGELOG.md                      # Lịch sử nâng cấp & kiểm thử theo từng giai đoạn
├── GUIDE.md                          # Runbook setup dành cho AI Agent & người dùng
├── README.md                         # Tài liệu chính (file này)
├── setup.mjs                         # Script cài đặt plugin & kiểm tra môi trường (pure Node)
├── setup.bat                         # Launcher chạy nhanh setup.mjs trên Windows
├── .gitignore                        # Loại trừ khóa học cục bộ (<COURSE>/, *.mp3, *.mp4...), .agents/, .claude/, .mcp.json, .env*, .ai_*.json
├── plugin/
│   └── tech-video-studio/            # Bản nguồn plugin di động (Single Source of Truth cho setup_adapters.mjs)
│       ├── plugin.json
│       ├── mcp_config.json
│       ├── README.md
│       ├── assets/logo.svg
│       ├── rules/AGENTS.md
│       └── skills/                   # curriculum-architect, curriculum-reviewer, episode-producer, content-reviewer, studio-worker, video-renderer
├── engine/                           # Bộ máy Studio, Multi-Provider AI, MCP, TTS, State CLI & HyperFrames Renderer
│   ├── server.mjs                    # Web Studio server (3 màn hình + API + SSE + /mcp)
│   ├── mcp_server.mjs                # Stdio MCP bridge cho Antigravity / Claude / Codex
│   ├── setup_adapters.mjs            # Trình sinh adapter từ plugin/tech-video-studio
│   ├── worker_wait.mjs               # Long-poll chờ job 0-token cho studio-worker
│   ├── state_cli.mjs                 # Quản lý state phân mảnh, multi-part merge, revision queue & validate sơ đồ
│   ├── tts_pipeline.py               # Tổng hợp giọng đọc đa track A/B, audio-spine reuse, subtitles & khớp nhịp Lớp 1
│   ├── render_video.mjs              # CLI render video HyperFrames (mặc định 30fps, hỗ trợ --part)
│   ├── hyperframes/                  # Engine HyperFrames: compiler, 11 template DOM+GSAP, renderer CDP, snapshot, layout_qc
│   ├── HYPERFRAMES_ENGINE.md         # Ghi chép thiết kế & vận hành engine HyperFrames
│   ├── UPGRADE_CHECKLIST.md          # Checklist nâng cấp & trạng thái bàn giao
│   ├── VISUAL_COMPONENTS.md          # Tài liệu tham khảo toàn bộ 11 visual components
│   ├── assets/                       # Kho minh họa kiến trúc SVG (svg/) & hiệu ứng âm thanh SFX 48kHz (sfx/)
│   ├── scripts/                      # Vendor runtime/GSAP pin SHA-256 & tạo SFX WAV
│   ├── test_phase1_three_stage.mjs   # Kiểm thử pipeline deep_course 5 vai trò, review loop, merge-parts & Audio-Spine reuse
│   ├── test_ai_bridge_and_templates.mjs  # Bộ kiểm thử E2E, 11 templates & Chrome UI
│   ├── test_hyperframes.mjs          # Bộ kiểm thử engine HyperFrames (11 templates, determinism, --part, -16 LUFS, layout QC)
│   ├── voices.json                   # Danh mục profile giọng đọc (gồm VieNeu-TTS v3 Turbo)
│   ├── MOTION_SPEC.md                # Đặc tả motion engine V2
│   ├── TTS_VOICE_SPEC.md             # Đặc tả tích hợp custom TTS provider
│   ├── ai/                           # Multi-provider credentials/handshake, deep_course 5-role runner, queue broker
│   ├── mcp/                          # Dùng chung JSON-RPC handler (9 tools + 4 resources) cho Stdio & HTTP
│   ├── public/index.html             # Entry Web UI & importmap esm.sh
│   └── src/                          # Studio player, RoleRoutingPanel, ScriptingStageModal, 11 templates, audio_dsp (-16 LUFS), hf_encoder
└── <COURSE>/                         # Khóa học cục bộ tạo trên máy (vd: AWS/, K8S/ — đã được .gitignore loại trừ khỏi Git)
```

---

## 7. Khắc phục sự cố thường gặp

- **`render_video.mjs` báo `Chrome executable not found`:**
  Chạy `node setup.mjs --check` để xem đường dẫn Chrome được phát hiện, rồi đặt `CHROME_PATH` trước khi render hoặc bật `server.mjs`.
- **Lỗi gọi Python trên macOS/Linux (`spawn python ENOENT`):**
  Chạy server với `PYTHON_BIN=python3 node engine/server.mjs`.
- **Nút `✍️ Biên kịch` báo Provider chưa cấu hình hoặc hết quota:**
  Mở **`🤖 AI Worker & Models`** trên thanh trên cùng màn hình Roadmap để chọn 1 trong 9 brand (hoặc dùng **Manual Web `$0`**), kiểm tra `$0` handshake / `🧪 Test 1 token`, hoặc bấm **`▶ Tiếp tục (Resume / Đổi Model)`** trên job bị tạm dừng để đổi sang model khác.
- **Đã chạy `setup.mjs --workspace --global` nhưng IDE chưa thấy skill / MCP tool mới:**
  Đóng/mở lại cuộc hội thoại hoặc reload cửa sổ Antigravity để nạp lại 6 skill & MCP server mới sinh.
- **Web UI trắng hoặc lỗi import module JS:**
  Kiểm tra kết nối Internet vì `engine/public/index.html` và `engine/src/video_encode_utils.mjs` nạp thư viện ESM từ `https://esm.sh/`.
