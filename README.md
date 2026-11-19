# Tech Course Video Studio

**Ngôn ngữ:** **Tiếng Việt (Mặc định)** | [English](README.en.md)

**Tech Course Video Studio** là hệ thống sản xuất video bài giảng công nghệ hoàn chỉnh (lộ trình học, kịch bản phân cảnh, giọng đọc Tiếng Việt giữ nguyên thuật ngữ Tiếng Anh, phụ đề đồng bộ, sơ đồ kiến trúc động, mockup giao diện Console/CLI/Code và xuất video Full HD/4K), kết hợp giữa **Bộ Adapter Đa Agent (`Antigravity`, `Claude Code / Desktop`, `Codex`)**, **Web Studio 3 màn hình (`http://localhost:3030`) với 9 kênh AI (ChatGPT, Claude, DeepSeek, Gemini, OpenRouter, Ollama, LM Studio, Antigravity Worker, Manual `$0`)**, và **engine render thuần Node.js + Python standard library**.

> Toàn bộ hệ thống hoạt động theo kiến trúc **Zero External Packages**: không cần `npm install`, không cần `pip install`, và không gọi file thực thi `.exe` chưa ký số (như `ffmpeg.exe`, `pip.exe`, `esbuild.exe`), tương thích tốt với chính sách bảo mật Windows Application Control.

---

## Mục lục

- [1. Tính năng nổi bật](#1-tính-năng-nổi-bật)
- [2. Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
- [3. Cài đặt (Setup) Đa Agent sau khi Clone / Pull](#3-cài-đặt-setup-đa-agent-sau-khi-clone--pull)
- [4. Khởi động Studio, AI Đa Provider & Luồng làm việc](#4-khởi-động-studio-ai-đa-provider--luồng-làm-việc)
- [5. Tham chiếu CLI, API & Biến môi trường](#5-tham-chiếu-cli-api--biến-môi-trường)
- [6. Cấu trúc thư mục dự án](#6-cấu-trúc-thư-mục-dự-án)
- [7. Khắc phục sự cố thường gặp](#7-khắc-phục-sự-cố-thường-gặp)

---

## 1. Tính năng nổi bật

### 1.1. Quy trình sản xuất 3 chặng (3-Conversation Pipeline) với State phân mảnh
Tiến độ từng tập video được lưu nguyên tử (atomic) tại `<COURSE>/state/<ep-slug>.json` kèm nhật ký sự kiện `<COURSE>/state/events.jsonl` do `engine/state_cli.mjs` quản lý:
1. **Conversation 1 — Thiết kế Lộ trình (`curriculum-architect`):**
   - Thực hiện phỏng vấn `/grill-me` từng câu (mục tiêu chứng chỉ/thực chiến, quy mô `10/20/30` tập, giọng đọc mặc định từ `engine/voices.json`, độ sâu Lab/CLI/Code, phạm vi triển khai).
   - Tạo `course.json` (lưu cấu hình giọng mặc định), `curriculum.md` chia theo từng *Chặng*, và khởi tạo file state cho toàn bộ các tập.
2. **Conversation 2 — Nhà máy Kịch bản (`episode-producer` / Web Studio AI Engine):**
   - Hỗ trợ **biên kịch tách 3 giai đoạn (`three_stage`: `brief.json` → `dialogue.json` → `audio_spine.json` → `script.json`)** bên cạnh `two_pass`/`single_pass`, với định tuyến provider động theo từng vai trò (`brief`, `dialogue`, `visual_director`) và modal duyệt/sửa trung gian (`ScriptingStageModal`).
   - Viết từng tập, theo đợt 3–5 tập, hoặc **chọn nhiều tập không giới hạn (`☑️ Chọn nhiều`)** để chạy hàng loạt trên 1 model, xử lý ticket sửa lỗi (`revisions`), viết `script.json` theo cấu trúc chuẩn 4 phần (**Bài toán thực tế `problem` → Sơ đồ kiến trúc `architecture` → Thực hành Setup & Code `setup` → Bẫy đề thi & Thực chiến `exam_tips`**) và tài liệu ôn tập `notes.md`.
   - Tự động kiểm tra va chạm node/nhãn/cạnh và phân vùng trong sơ đồ trước khi chuyển trạng thái `script_ready`. Khi viết lại tập đã có kịch bản/audio/video từ tab **`🛠️ Sửa`** (`🔄 Gửi AI Sửa Kịch Bản`) hoặc từ modal batch, hệ thống yêu cầu ghi rõ ghi chú thay đổi và tự đánh dấu `production.stale = true`.
3. **Conversation 3 — Nhà máy Video (`episode-producer` + `video-renderer`):**
   - Tổng hợp giọng đọc đa track (`audio/<profile_id>/` + `subtitles.<profile_id>.srt`) và **tự động khớp nhịp animation theo phụ đề (Layer 1)** bằng `engine/tts_pipeline.py`, tinh chỉnh lại theo playhead (Layer 2) trong Studio Player nếu cần, render video qua headless Chrome (`engine/render_video.mjs`), kiểm tra lỗi console/file xuất và chốt trạng thái `completed`.

### 1.2. Multi-Provider AI & Bảo mật Key tuyệt đối (`engine/ai/`)
Hỗ trợ **9 kênh AI** ngay trong Web Studio (`BrandHealthGrid`) thông qua `GET /api/ai/providers`, `POST /api/ai/providers/credentials`, `POST /api/ai/providers/test`:
- **Cloud API (BYOK):** **OpenAI (ChatGPT)**, **Anthropic (Claude)**, **DeepSeek**, **Google Gemini**, **OpenRouter**.
  - Kiểm tra **handshake `$0` token** (tự lọc model chat/reasoning live; DeepSeek kiểm tra luôn `/user/balance`; OpenRouter kiểm tra `/key` để hiện hạn mức thực tế).
  - Hỗ trợ test nhanh **`🧪 Test 1 token`** khi cần kiểm tra credit thực tế.
  - **Bảo mật tuyệt đối:** API key lưu cục bộ ở `engine/.ai_credentials.json` (đã nằm trong `.gitignore`) hoặc đọc từ biến môi trường OS (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `OPENROUTER_API_KEY`). API **không bao giờ trả về key gốc hay key che (`sk-...`)** cho frontend — chỉ trả về cờ `has_credential` và `auth_status`.
- **Local AI (Miễn phí trên máy):** **Ollama** (`http://127.0.0.1:11434`) & **LM Studio** (`http://127.0.0.1:1234/v1`).
- **Agent MCP Worker:** **Antigravity Worker** (`studio-worker` qua `worker_wait.mjs`).
- **Chế độ Thủ công `$0` (`manual_web`):** Tạo **Prompt Pack** (`POST /api/ai/manual-prompt`) để copy sang ChatGPT/Claude/Gemini web, rồi dán JSON kết quả vào (`POST /api/ai/manual-submit`) để kiểm tra sơ đồ và lưu.
- **Lưu lựa chọn & Tự tạm dừng khi hết Quota:** Tự ghi nhớ model/provider vừa dùng trong `engine/.ai_preferences.json`. Khi chạy hàng loạt gặp `429`/`402`/lỗi giữa chừng, job chuyển sang `paused` (`⏸️ Hết Quota` / `⏸️ Tạm dừng`), bảo toàn các tập đã xong và cho phép bấm **`▶ Tiếp tục (Resume / Đổi Model)`** (`POST /api/ai/jobs/resume`) để đổi sang model/kênh khác chạy nốt phần còn lại.

### 1.3. 7 Visual Templates & Bộ máy Motion V2
Giao diện trình chiếu (`engine/src/components/` + `engine/src/motion/kernel.mjs`) hỗ trợ 7 mẫu cảnh đối xứng ở tỷ lệ 16:9:
- **`architecture`**: Sơ đồ kiến trúc động với `zones[]` lồng tối đa 2 cấp (`client`, `network`, `compute`, `security`, `data`, `danger`), kho **15 minh họa SVG đa sắc (`node.svg`, `engine/assets/svg/`)**, định tuyến cạnh (`auto`, `straight`, `orthogonal`, `curved`), `flow_steps` và `camera_focus` (`x`, `y`, `zoom`).
- **`console_setup`**: Mockup giao diện Cloud/Console sạch sẽ, làm nổi bật từng trường nhập liệu, lựa chọn và nút bấm theo tiến trình lời thoại.
- **`code_cli`**: Hiển thị code & terminal song song (`split`, `code`, `terminal`) với `highlight_phases`, hỗ trợ `code_override` (`@shikijs/magic-move`) và `laser_scan` (quét tia laser đỏ cảnh báo lỗ hổng/lỗi).
- **`exam_tips`**: Đối chiếu *Làm sai vs Chuẩn thực chiến/đề thi* kèm thẻ quiz trắc nghiệm tương tác.
- **`comparison_matrix`**: Bảng so sánh tối đa 4 cột / 6 hàng kèm takeaway.
- **`timeline_flow`**: Dòng thời gian 2–6 cột mốc (ngang/dọc).
- **`kpi_metrics`**: Tối đa 4 thẻ KPI (kèm sparkline, hỗ trợ badge `SharpTag`), biểu đồ cột (`<= 8` điểm) và tem cảnh báo (`alert_stamp`).
- Hỗ trợ metadata Phase 2 (`world_theme: "dark" | "light"`, `visual_job`, `causal_mechanic`, `sfx_cues`, `bgm_file`) và trường `highlight_words` ở mỗi cảnh để nhấn màu thuật ngữ chuyên ngành trong phụ đề V2 không hộp nền.

### 1.4. Tổng hợp giọng đọc TTS đa track (Multi-Voice A/B) & Khớp nhịp 2 lớp (`engine/tts_pipeline.py`)
Viết hoàn toàn bằng thư viện chuẩn Python (`urllib`, `ssl`, `socket`, `wave`, ...):
- **Kế thừa giọng 3 tầng:** `--profile` CLI / `script.json` (ghi đè riêng từng tập) → `course.json` (mặc định khóa học) → `engine/voices.json` (mặc định toàn Studio — đã tích hợp sẵn **25 giọng VieNeu-TTS v3 Turbo** qua `openai_compat` tại `http://127.0.0.1:8000/v1/audio/speech`).
- **Dual-Text TTS & `--audio-spine`:** Hỗ trợ `tts_beats` / `tts_narration` (chuẩn hóa đọc Tiếng Việt với `normalize_vietnamese_tts_text`) và tổng hợp xương sống audio (`audio_spine.json`) trước khi dựng visual.
- **Multi-Voice A/B Preservation:** Mỗi lần tạo audio cho một giọng mới, hệ thống lưu riêng vào `audio/<profile_id>/<scene_id>.(mp3|wav)` + `subtitles.<profile_id>.srt` và cập nhật `script.voice_tracks` — **giữ nguyên toàn bộ file & timing của các giọng đã tạo trước đó** để bạn chuyển đổi A/B tức thì (`0` chi phí tạo lại TTS).
- **Đồng bộ Animation theo Giọng đọc 2 lớp:**
  - *Lớp 1 (Subtitle-Cue Alignment):* Khi chạy TTS hoặc `tts_pipeline.py --realign-only [--scene <id>]`, engine ưu tiên khớp chính xác theo `cue_sentence` (chỉ số câu 1-based) + `cue_text`/từ khóa trên cả 7 visual template với mốc thời gian phụ đề thực tế, luôn tính từ ảnh chụp gốc `scene._base_timings`.
  - *Lớp 2 (Playhead Calibration):* Tinh chỉnh thủ công từng bước ngay trên Studio Player qua thanh **`⏱️ Khớp nhịp Animation`** (`POST /api/episodes/scene-timings`).
- **Hỗ trợ đa provider:** `openai_compat` / `voicestudio` (`http://127.0.0.1:8000/v1/audio/speech` hoặc `VOICESTUDIO_API_URL`), `auto`, `edge`, `google`, `custom_http` (xem [`engine/TTS_VOICE_SPEC.md`](engine/TTS_VOICE_SPEC.md)).

### 1.5. Studio Web Dashboard 3 Màn hình (`http://localhost:3030`)
Khởi chạy qua `engine/server.mjs` và đồng bộ real-time bằng Server-Sent Events (`/api/stream`):
1. **Project Dashboard (`?view=projects`):** Tổng quan tất cả khóa học, thanh tiến độ theo từng giai đoạn, số ticket sửa lỗi đang mở.
2. **Episode Roadmap & Live Monitor (`?view=roadmap`):**
   - Pill **`🤖 AI Worker & Models`** ở thanh trên cùng mở ngăn **`BrandHealthGrid`** để cấu hình/chọn nhanh trong 9 brand AI (hiển thị rõ 1 thẻ đang chọn `◉` + `✓ Đang chọn`, badge `Online` sắc nét không cắt chữ).
   - Danh sách tập theo Chặng: bấm trực tiếp vào thẻ tập đã có kịch bản để mở Studio Player (card gọn gàng, không còn nút `Mở Studio` / `🔄 Viết lại KB` ở chân card; tập chưa có kịch bản giữ nút **`✍️ Biên kịch`**); nút **`✍️ Biên kịch Đợt / Hàng loạt`**, chế độ **`☑️ Chọn nhiều`** + **`FloatingBatchBar`** (**`✍️ Biên kịch hàng loạt (1 Model)`**), banner **`▶ Tiếp tục (Resume / Đổi Model)`**, khay **`HeaderJobsTray`**, **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal`), và 3 tab bên phải (`📡 Live Activity`, `🛠️ Yêu cầu sửa`, `🗺️ curriculum.md`).
3. **Studio Player (`?view=player`):**
   - Phát đồng bộ 16:9, chế độ **Storyboard Preview Mode** (xem trước khi chưa có audio), deep-link tới từng cảnh (`&scene=<scene_id>`).
   - **Multi-Voice A/B Switcher** trên topbar cho phép chuyển nhanh giữa các track giọng đã tạo (`POST /api/episodes/voice-track/activate`) hoặc xóa track không dùng (`/api/episodes/voice-track/delete`).
   - Nút gộp **`🎬 Xuất Video ▾`** (`Export Menu Popover`) gom cấu hình chất lượng (Hardware, Format/Codec, 720p–4K, FPS, Speed), tùy chọn tạo lại TTS, ô **`Tên file đầu ra`** (điền sẵn `<ep-id>`, giữ đuôi `.mp4`/`.webm` khớp codec, tự **cảnh báo ghi đè** theo thời gian thực khi trùng tên kèm nút 1-click **`✨ Đổi sang <stem>-v2.<ext>`**), và nút **`🚀 Bắt đầu Xuất Video`**. *(Đã bỏ hoàn toàn các nút/API tải video vì video được xuất trực tiếp vào `<COURSE>/episodes/<ep-id>/`.)*
   - Khung **`📁 Video đã xuất (<N>)`** ngay dưới timeline trong Chi tiết bài học liệt kê toàn bộ file `.mp4`/`.webm` hiện có, hỗ trợ **`▶ Xem thử`** trực tiếp qua modal `<video>` trong app, **`✏️ Chọn tên`** (nạp lại tên file vào popover xuất), **`📋 Copy path`**, và **`🗑️ Xóa`** (`POST /api/episodes/video/delete`).
   - Tab **`🎬 Phân cảnh`** tích hợp hộp **`⏱️ Khớp nhịp Animation`** gắn với Playhead; tab **`🛠️ Sửa`** có form thêm nhanh yêu cầu sửa (tự bám theo cảnh đang xem, cho phép chọn đổi cảnh) và nút **`🔄 Gửi AI Sửa Kịch Bản`** để mở ngay `AiScriptModal`.

### 1.6. Render Video bằng HyperFrames (`engine/render_video.mjs`)
- **Engine mặc định: [HyperFrames](https://github.com/heygen-com/hyperframes)** — mỗi tập được biên dịch thành project HyperFrames chuẩn (`<COURSE>/episodes/<EP_ID>/hyperframes/index.html`, 7 template viết lại bằng DOM + GSAP, runtime chính thức `hyperframe.runtime.iife.js` vendor offline), sau đó Chrome headless seek từng frame theo giao thức HyperFrames và mã hoá bằng WebCodecs (H.264/HEVC/VP9 + AAC/Opus) — **không cần FFmpeg hay npm**. Chi tiết: [`engine/HYPERFRAMES_ENGINE.md`](engine/HYPERFRAMES_ENGINE.md).
- **Motion Grammar & Post-Mix Âm thanh `-16 LUFS` (Phase 2):**
  - Chuyển động nền `.tvs-bg-grid` liên tục + `creepZoom` (`1.0 → 1.015`, `force3D: false`), chuyển đổi nền Sáng/Tối (`world_theme`), chồng lấn chuyển cảnh thông minh cùng `part` (hoặc `dark breather` `140ms` khi đổi `part`), `SharpTag`, và xoay tua `causal_mechanic`.
  - Mix tự động 6 hiệu ứng âm thanh 48kHz (`engine/assets/sfx/*.wav`, lead `-33ms`), nhạc nền `bgm_file` cắt EQ giọng (`1800Hz -6dB` qua `OfflineAudioContext`), và chuẩn hóa **ITU-R BS.1770-4 `-16 LUFS`** + soft-limiter (`0.8414` ≈ `-1.5 dBTP`) hoàn toàn bằng JS thuần (`engine/src/audio_dsp.mjs`, `engine/src/hf_encoder.mjs`).
- Engine Canvas 2D cũ (`window.__STUDIO_RENDER_OFFLINE__`) vẫn dùng được qua `--engine legacy` hoặc lựa chọn **Engine render** trong popover **`🎬 Xuất Video ▾`**.
- Tùy chọn độ phân giải (`720p`, `1080p`, `1440p`, `2160p`), tốc độ khung hình (`24`, `30`, `60` fps), định dạng (`mp4`, `webm`), tăng tốc (`1x`–`2x`), và chế độ tăng tốc phần cứng (`auto`, `gpu`, `cpu`).

### 1.7. Universal MCP Bridge (Stdio + Loopback HTTP `/mcp`)
- Dùng chung `engine/mcp/rpc.mjs` cho cả **Stdio** (`engine/mcp_server.mjs`) và **Loopback HTTP** (`GET|POST http://127.0.0.1:3030/mcp`), tương thích **Antigravity**, **Claude Code / Claude Desktop**, và **Codex / Agent Skills**.
- Cung cấp **9 tools** (`studio_worker_heartbeat`, `studio_poll_ai_job`, `studio_claim_ai_job`, `studio_get_context`, `studio_report_ai_progress`, `studio_validate_script`, `studio_submit_episode_script`, `studio_complete_ai_job`, `studio_fail_ai_job`) và **4 MCP resources** (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).
- `engine/worker_wait.mjs` giữ heartbeat mỗi 5 giây và long-poll chờ job ở mức **0 AI token tiêu thụ** khi rảnh.

---

## 2. Yêu cầu hệ thống

| Thành phần | Phiên bản / Yêu cầu | Lý do & Ghi chú |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.0.0` | `engine/render_video.mjs` dùng API `WebSocket` global (có sẵn mặc định từ Node 22+). Không cần `npm install`. |
| **Python** | `>= 3.10` | `engine/tts_pipeline.py` dùng thuần stdlib. Nếu máy dùng `python3`, đặt `PYTHON_BIN=python3`. |
| **Google Chrome** | Đã cài trên máy | Windows mặc định tìm `C:\Program Files\Google\Chrome\Application\chrome.exe`. Đặt `CHROME_PATH` nếu cài ở nơi khác. |
| **Kết nối Internet** | Cần khi dùng Web UI & Cloud AI/TTS | Web UI nạp thư viện ESM từ `https://esm.sh/`; TTS `edge`/`google` và Cloud AI gọi API online *(hoặc chạy hoàn toàn local với Ollama/LM Studio + VoiceStudio)*. |
| **AI Agent / API** | Tùy chọn | Dùng **Antigravity**, **Claude Code / Desktop**, **Codex**, API key bất kỳ trong 9 brand, hoặc **Manual `$0` Web Prompt Pack**. |

---

## 3. Cài đặt (Setup) Đa Agent sau khi Clone / Pull

### Bước 1: Clone repository về máy

```powershell
git clone git@github.com:Thanhloi-lab/TechVideoStudio.git
cd TechVideoStudio
```

### Bước 2: Chạy `setup.mjs` (Single Source of Truth -> Multi-Agent Adapters)

Từ nguồn chuẩn duy nhất (`AGENTS.md` + `plugin/tech-video-studio/`), `setup.mjs` (cùng `engine/setup_adapters.mjs`) sinh tự động adapter cho từng công cụ:

- **Cài cho tất cả Agent phổ biến (Antigravity + Claude Code + Codex) — Khuyên dùng:**
  ```powershell
  node setup.mjs --agents all
  ```
  Sinh tự động (tất cả đều nằm trong `.gitignore` nên không làm bẩn `git status`):
  - **Antigravity:** `.agents/plugins/tech-video-studio/` (`plugin.json`, `mcp_config.json`, `rules/AGENTS.md`, 4 skills).
  - **Claude Code:** `.claude/skills/*/SKILL.md` + `.mcp.json` ở thư mục gốc *(merge an toàn, giữ nguyên các MCP server khác; kết hợp cùng [`CLAUDE.md`](CLAUDE.md))*.
  - **Codex / Agent Skills chuẩn mở:** `.agents/skills/*/SKILL.md` *(dùng cùng [`AGENTS.md`](AGENTS.md))*.

- **Chỉ cài mặc định cho Antigravity (tương thích ngược 100%):**
  ```powershell
  node setup.mjs
  ```
  *(Trên Windows có thể chạy `.\setup.bat`.)*

- **Tích hợp thêm Claude Desktop (OS global config):**
  ```powershell
  node setup.mjs --agents claude --claude-desktop
  ```
  *Tự tạo bản sao lưu `<path>.<timestamp>.bak` trước khi merge `tech-video-studio` vào `claude_desktop_config.json`, bảo toàn nguyên vẹn các MCP server sẵn có.*

- **Cài Global Antigravity hoặc Chẩn đoán không ghi file:**
  ```powershell
  node setup.mjs --global                 # Cài vào ~/.gemini/config/plugins/tech-video-studio
  node setup.mjs --global --agy           # Cài qua CLI `agy plugin install` nếu có
  node setup.mjs --all                    # Cài cả workspace + global Antigravity
  node setup.mjs --check --json           # Kiểm tra Node/Python/Chrome, các adapter, và env key (true/false)
  ```

### Bước 3: Reload IDE / Agent & Khởi động Web Studio (Port `3030`)

```powershell
node engine/server.mjs
```

Mở trình duyệt tại **`http://localhost:3030`**.

---

## 4. Khởi động Studio, AI Đa Provider & Luồng làm việc

| Giai đoạn | Cách thực hiện | Ghi chú |
| :--- | :--- | :--- |
| **1. Lộ trình (`curriculum-architect`)** | Nhắn Agent trong Antigravity / Claude Code / Codex: *"Tạo khóa học video mới về Kubernetes (CKA) tại K8S"* | Phỏng vấn `/grill-me`, tạo `course.json`, `curriculum.md`, `state/*.json`. |
| **2a. Biên kịch trên Web UI (9 Brand AI)** | Bấm **`🤖 AI Worker & Models`** -> chọn provider/model -> bấm **`✍️ Biên kịch`** (tập mới), hoặc **`☑️ Chọn nhiều`** -> **`✍️ Biên kịch hàng loạt (1 Model)`**; để sửa/viết lại tập đã có kịch bản, mở tập đó -> tab **`🛠️ Sửa`** -> **`🔄 Gửi AI Sửa Kịch Bản`** | Tự kiểm tra sơ đồ, tự lưu `last_selection`, hỗ trợ `⏸️` tạm dừng & **`▶ Tiếp tục (Resume / Đổi Model)`** khi hết quota. |
| **2b. Biên kịch qua MCP Worker (`studio-worker`)** | Mở chat Antigravity mới và nhắn **`Bật VideoMaker Worker`** (chạy `worker_wait.mjs` với 0 token khi rảnh) | Thực thi các job `script_episode` / `script_batch` (tối đa 5 tập/lượt). |
| **2c. Biên kịch `$0` Thủ công (`manual_web`)** | Chọn **Manual Web** trong `AiScriptModal` -> **`📋 Tạo Prompt Pack`** -> dán JSON -> **`✅ Kiểm tra & Lưu Kịch bản`** | Không tốn phí API key, vẫn validate sơ đồ & cập nhật state chuẩn. |
| **3. Audio, Đồng bộ & Video (`video-renderer`)** | Chạy `tts_pipeline.py` + `render_video.mjs`, hoặc trong Studio Player bấm **`🎙️ Tạo Audio (TTS)`** / chuyển giọng A/B / căn **`⏱️ Khớp nhịp Animation`** / mở **`🎬 Xuất Video ▾`** -> sửa tên file nếu muốn giữ nhiều phiên bản -> **`🚀 Bắt đầu Xuất Video`** | Bảo toàn track giọng cũ trong `audio/<profile_id>/`, lưu trực tiếp nhiều file video trong `<COURSE>/episodes/<ep-id>/` (quản lý & xem thử tại **`📁 Video đã xuất`**), tự đánh dấu `production.stale` khi đổi track/timing. |

---

## 5. Tham chiếu CLI, API & Biến môi trường

### 5.1. Quản lý State & Kiểm tra Sơ đồ (`engine/state_cli.mjs`)

```powershell
node engine/state_cli.mjs init --course <COURSE>
node engine/state_cli.mjs summary --course <COURSE> [--json]
node engine/state_cli.mjs next --course <COURSE> --stage <scripting|production> [--limit 5] [--json]
node engine/state_cli.mjs set --course <COURSE> --ep <EP_ID> --stage <scripting|production> --status <STATUS> [--owner "..."] [--note "..."] [--tts-done true] [--video-done true] [--verified true]
node engine/state_cli.mjs validate-diagrams --course <COURSE> [--ep <EP_ID>] [--json]
node engine/state_cli.mjs svg-list [--json]
node engine/state_cli.mjs sync --course <COURSE>
node engine/state_cli.mjs revisions --course <COURSE> [--ep <EP_ID>] [--status open|in_progress|resolved|all]
node engine/state_cli.mjs add-revision --course <COURSE> --ep <EP_ID> --scope <script|visual|production> [--scene <SCENE_ID>] --desc "<mô tả lỗi>"
node engine/state_cli.mjs resolve-revision --course <COURSE> --ep <EP_ID> --rev <REV-001> --note "<đã sửa>"
```

### 5.2. Tổng hợp TTS (`engine/tts_pipeline.py`) & Render (`engine/render_video.mjs`)

```powershell
python engine/tts_pipeline.py --episode "<COURSE>/episodes/<EP_ID>/script.json" --course "<COURSE>/course.json" --json
python engine/tts_pipeline.py --audio-spine --episode "<COURSE>/episodes/<EP_ID>/dialogue.json" --course "<COURSE>/course.json" --json
python engine/tts_pipeline.py --realign-only --episode "<COURSE>/episodes/<EP_ID>/script.json" [--scene <SCENE_ID>] [--profile <PROFILE_ID>] --json
python engine/tts_pipeline.py --list-profiles
python engine/tts_pipeline.py --discover-voicestudio --json
python engine/tts_pipeline.py --preview --profile edge-hoaimy --text "Xin chào" --out preview.mp3

node engine/scripts/generate_sfx_assets.mjs   # (Tùy chọn) tạo lại 6 file SFX WAV chuẩn 48kHz trong engine/assets/sfx/
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> --port 3030 --format mp4 --codec h264 --resolution 1080p --fps 60 --speed 1 --hardware auto [--output <TEN_FILE>] [--workers 1..8] [--engine hyperframes|legacy]
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> --compile-only   # chỉ sinh project HyperFrames
node engine/hyperframes/snapshot.mjs --course <COURSE> --episode <EP_ID> --scene 0 --at 0.1,0.5,0.9 --check-determinism

# Chạy các bộ kiểm thử E2E + UI Headless Chrome, 3-Stage Scripting và HyperFrames (-16 LUFS)
node engine/test_phase1_three_stage.mjs
node engine/test_ai_bridge_and_templates.mjs
node engine/test_hyperframes.mjs
```

### 5.3. API AI & MCP Endpoints chính (`engine/server.mjs`)

| Endpoint | Mục đích |
| :--- | :--- |
| `GET /api/ai/providers[?force=1]` | Danh sách 9 brand AI, trạng thái auth (`verified`/`invalid`/`quota_exhausted`/`unconfigured`...), model live, `last_selection` (không bao giờ trả về API key). |
| `POST /api/ai/providers/credentials` | Lưu/cập nhật/xóa key hoặc `base_url` tùy chỉnh vào `engine/.ai_credentials.json` và chạy handshake `$0`. |
| `POST /api/ai/providers/test` | Kiểm tra lại kết nối hoặc test `ping_one_token: true`. |
| `POST /api/ai/preferences/routing` | Lưu cấu hình định tuyến provider động cho từng vai trò (`brief`, `dialogue`, `visual_director`) vào `engine/.ai_preferences.json`. |
| `POST /api/ai/jobs` | Tạo job `script_episode` hoặc `script_batch` (hỗ trợ `mode: "three_stage"`, `pause_after`, `start_from`, `rewrite_notes` / `rewrite_note`, không giới hạn số tập với built-in AI). |
| `GET /api/episodes/scripting-artifacts` & `POST /api/episodes/{brief,dialogue,audio-spine}` | Đọc/sửa `brief.json`, `dialogue.json` và chạy TTS xương sống (`audio_spine.json`) cho từng tập. |
| `POST /api/ai/jobs/resume` | Tiếp tục job đang `paused`/`failed` trên các tập còn lại (có thể đổi sang `provider_id` / `model` khác). |
| `POST /api/ai/manual-prompt` & `manual-submit` | Tạo Prompt Pack `$0` và validate/lưu JSON kịch bản dán vào. |
| `POST /api/episodes/voice-track/activate` & `delete` | Chuyển đổi tức thì giữa các track giọng A/B đã tạo (`0` gọi TTS) hoặc xóa track dư. |
| `POST /api/episodes/scene-timings` | Lưu timing Playhead (`action: "save"`) hoặc chạy Layer 1 (`action: "auto_align"` qua `--realign-only`). |
| `POST /api/jobs/run-production` | Khởi chạy TTS/Render (`output_filename` tùy chọn để giữ nhiều bản render khác tên trong thư mục bài học). |
| `POST /api/episodes/video/delete` | Xóa một file `.mp4`/`.webm` cụ thể trong thư mục bài học và đồng bộ lại `state/<ep>.json` (chặn nếu tập đang render). |
| `GET\|POST /mcp` | Loopback HTTP Streamable MCP endpoint (9 `studio_*` tools + 4 `studio://*` resources). |

### 5.4. Biến môi trường hữu ích

| Biến môi trường | Mặc định | Tác dụng |
| :--- | :--- | :--- |
| `PORT` / `VIDEO_MAKER_PORT` | `3030` | Đổi cổng Studio HTTP server, MCP bridge (`mcp_server.mjs`), và `worker_wait.mjs`. |
| `VIDEO_MAKER_WORKSPACE_ROOT` | Thư mục cha của `engine/` | Trỏ thư mục chứa các khóa học nếu đặt tách khỏi repo. |
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Đường dẫn Chrome/Chromium khi render trên macOS, Linux hoặc Windows tùy chỉnh. |
| `PYTHON_BIN` | `python` | Lệnh Python dùng để gọi `tts_pipeline.py` (ví dụ `python3` trên Linux/macOS). |
| `VOICESTUDIO_BASE_URL` / `VOICESTUDIO_API_URL` | `http://localhost:8000` | Địa chỉ server VoiceStudio cục bộ. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | *(tùy chọn)* | Tự động được nhận diện ở backend (hoặc nhập trực tiếp trên Web UI vào `engine/.ai_credentials.json`). |

---

## 6. Cấu trúc thư mục dự án

```text
TechVideoStudio/
├── AGENTS.md                         # Nguồn quy tắc workspace chuẩn (Antigravity, Codex, Universal)
├── CHANGELOG.md                      # Lịch sử nâng cấp & kiểm thử theo từng giai đoạn
├── CLAUDE.md                         # Adapter mỏng (~20 dòng) trỏ Claude Code/Desktop về AGENTS.md
├── GUIDE.md                          # Runbook setup dành cho AI Agent & người dùng
├── README.md                         # Tài liệu Tiếng Việt (file này)
├── README.en.md                      # Tài liệu Tiếng Anh
├── setup.mjs                         # Script cài đa-agent & kiểm tra môi trường (pure Node)
├── setup.bat                         # Launcher chạy nhanh setup.mjs trên Windows
├── .gitignore                        # Loại trừ khóa học cục bộ (<COURSE>/, *.mp3, *.mp4...), .agents/, .claude/, .mcp.json, .env*, .ai_*.json
├── plugin/
│   └── tech-video-studio/            # Bản nguồn plugin di động (Single Source of Truth cho setup_adapters.mjs)
│       ├── plugin.json
│       ├── mcp_config.json
│       ├── README.md
│       ├── assets/logo.svg
│       ├── rules/AGENTS.md
│       └── skills/                   # curriculum-architect, episode-producer, studio-worker, video-renderer
├── engine/                           # Bộ máy Studio, Multi-Provider AI, MCP, TTS, State CLI & Renderer
│   ├── server.mjs                    # Web Studio server (3 màn hình + API + SSE + /mcp)
│   ├── mcp_server.mjs                # Stdio MCP bridge cho Antigravity / Claude / Codex
│   ├── setup_adapters.mjs            # Trình sinh adapter cho Antigravity, Claude Code/Desktop & Codex
│   ├── worker_wait.mjs               # Long-poll chờ job 0-token cho studio-worker
│   ├── state_cli.mjs                 # Quản lý state phân mảnh, revision queue & validate sơ đồ
│   ├── tts_pipeline.py               # Tổng hợp giọng đọc đa track A/B, subtitles & khớp nhịp Lớp 1 (pure Python stdlib)
│   ├── render_video.mjs              # CLI render video (mặc định HyperFrames, --engine legacy = Canvas 2D)
│   ├── hyperframes/                  # Engine HyperFrames: compiler, 7 template DOM+GSAP, renderer CDP, snapshot
│   ├── HYPERFRAMES_ENGINE.md         # Ghi chép thiết kế & vận hành engine HyperFrames
│   ├── UPGRADE_CHECKLIST.md          # Checklist nâng cấp 3 pha & trạng thái bàn giao
│   ├── assets/                       # Kho minh họa kiến trúc SVG (svg/) & hiệu ứng âm thanh SFX 48kHz (sfx/)
│   ├── scripts/                      # Vendor runtime/GSAP pin SHA-256 & tạo SFX WAV (generate_sfx_assets.mjs)
│   ├── test_phase1_three_stage.mjs   # Kiểm thử quy trình biên kịch 3 bước, dynamic routing & Audio Spine
│   ├── test_ai_bridge_and_templates.mjs  # Bộ kiểm thử E2E & Chrome UI 17 phần
│   ├── test_hyperframes.mjs          # Bộ kiểm thử engine HyperFrames (determinism, Light/Dark, -16 LUFS)
│   ├── voices.json                   # Danh mục profile giọng đọc (gồm VieNeu-TTS v3 Turbo)
│   ├── MOTION_SPEC.md                # Đặc tả motion engine V2
│   ├── TTS_VOICE_SPEC.md             # Đặc tả tích hợp custom TTS provider
│   ├── ai/                           # Multi-provider credentials/handshake, 3-stage LLM runner, batch queue broker
│   ├── mcp/                          # Dùng chung JSON-RPC handler (9 tools + 4 resources) cho Stdio & HTTP
│   ├── public/index.html             # Entry Web UI & importmap esm.sh
│   └── src/                          # Studio player, ScriptingStageModal, 7 templates, audio_dsp (-16 LUFS), exporter
└── <COURSE>/                         # Khóa học cục bộ tạo trên máy (vd: AWS/, K8S/ — đã được .gitignore loại trừ khỏi Git)
```

---

## 7. Khắc phục sự cố thường gặp

- **`render_video.mjs` báo `Chrome executable not found`:**
  Chạy `node setup.mjs --check` để xem đường dẫn Chrome được phát hiện, rồi đặt `CHROME_PATH` trước khi render hoặc bật `server.mjs`.
- **Lỗi gọi Python trên macOS/Linux (`spawn python ENOENT`):**
  Chạy server với `PYTHON_BIN=python3 node engine/server.mjs`.
- **Nút `✍️ Biên kịch` báo Provider chưa cấu hình hoặc hết quota:**
  Mở **`🤖 AI Worker & Models`** trên thanh trên cùng màn hình Roadmap để chọn 1 trong 9 brand (hoặc dùng **Manual Web `$0`**), kiểm tra `$0` handshake / `🧪 Test 1 token`, hoặc bấm **`▶ Tiếp tục (Resume / Đổi Model)`** trên job bị tạm dừng để đổi sang model khác mà không mất các tập đã hoàn thành.
- **Đã chạy `setup.mjs --agents all` nhưng IDE chưa thấy skill / MCP tool mới:**
  Đóng/mở lại cuộc hội thoại hoặc reload cửa sổ Antigravity / Claude Code / Claude Desktop / Codex để nạp lại adapter mới sinh.
- **Web UI trắng hoặc lỗi import module JS:**
  Kiểm tra kết nối Internet vì `engine/public/index.html` và `engine/src/exporter.mjs` tải thư viện ESM từ `https://esm.sh/`.
