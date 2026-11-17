# Hướng dẫn Cài đặt & Khởi chạy nhanh (`Tech Course Video Studio`)

Tài liệu này dùng cho **cả người dùng và AI Agent (Antigravity, Claude Code / Desktop, Codex)** ngay sau khi `git clone` hoặc `git pull` repository này về máy mới.

---

## Cách 1: Giao cho AI Agent tự cài đặt (Khuyên dùng — không cần thao tác tay)

1. Mở thư mục repository vừa clone bằng **Antigravity**, **Claude Code**, hoặc **Codex**.
2. Mở file `GUIDE.md` (hoặc gõ thẳng vào khung chat):
   > **"Hãy đọc `GUIDE.md` và thực hiện toàn bộ các bước setup tự động cho tôi."**

### Checklist dành riêng cho AI Agent (Agent Execution Runbook)

Khi người dùng yêu cầu làm theo `GUIDE.md`, Agent thực hiện tuần tự các bước sau:

1. **Chạy script setup tự động:**
   - Chỉ cài cho **Antigravity** (mặc định vào `.agents/plugins/tech-video-studio/`):
     ```powershell
     node setup.mjs --json
     ```
   - Hoặc cài **đồng bộ cho mọi Agent** (Antigravity + Claude Code `.claude/skills/` & `.mcp.json` + Codex `.agents/skills/`):
     ```powershell
     node setup.mjs --agents all --json
     ```
   - Script sẽ tự động:
     - Kiểm tra phiên bản `Node.js` (cần `>= 22`), `Python` (cần `>= 3.10`), `Google Chrome`, toàn bộ file trong `engine/`, và sự hiện diện dạng `true/false` của các biến môi trường API Key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` — không đọc hay in giá trị bí mật).
     - Sinh bộ plugin/adapter từ nguồn duy nhất (`AGENTS.md` + `plugin/tech-video-studio/`) với đường dẫn tuyệt đối chuẩn theo máy hiện tại:
       - **Antigravity:** `.agents/plugins/tech-video-studio/` (`plugin.json`, `mcp_config.json`, `rules/AGENTS.md`, 4 skills).
       - **Claude Code / Desktop:** `.claude/skills/*/SKILL.md` + `.mcp.json` (merge an toàn, giữ nguyên các MCP server khác; thêm `--claude-desktop` nếu muốn ghi vào `claude_desktop_config.json` của OS kèm bản sao lưu `.bak`).
       - **Codex / Agent Skills chuẩn mở:** `.agents/skills/*/SKILL.md` (dùng cùng `AGENTS.md` ở thư mục gốc).
   - *(Lưu ý: chỉ chạy `node setup.mjs --global --json` nếu người dùng yêu cầu rõ ràng cài Antigravity plugin toàn cục vào `~/.gemini/config/plugins/tech-video-studio/`.)*

2. **Kiểm tra trạng thái sau khi cài, đồng bộ state khóa học & kiểm thử (tùy chọn):**
   ```powershell
   node setup.mjs --check --json
   node engine/state_cli.mjs summary --course AWS
   node engine/test_ai_bridge_and_templates.mjs   # Chạy bộ test tự động 13 phần + Chrome UI
   node engine/test_hyperframes.mjs               # Test engine render HyperFrames (compile, determinism 7 template, render MP4)
   node engine/scripts/vendor_libs.mjs --verify-only   # Kiểm tra SHA-256 thư viện vendor (gồm runtime HyperFrames + GSAP)
   ```
   *(Nếu repo chưa có khóa học nào hoặc bạn tạo khóa mới, bỏ qua bước `state_cli.mjs`. Toàn bộ khóa học cục bộ `<COURSE>/`, `*.mp3`, `*.mp4`, adapter `.agents/`, `.claude/`, `.mcp.json` và file key/cache `engine/.ai_*.json`, `.env` đều đã được loại trừ trong `.gitignore`.)*

3. **Báo cáo ngắn gọn lại cho người dùng:**
   - Trạng thái cài plugin / adapter (`ok: true`), đường dẫn MCP server đã cấu hình.
   - Cảnh báo rõ nếu thiếu điều kiện môi trường (ví dụ `Node < 22`, `Python < 3.10`, thiếu Chrome hoặc cần đặt `CHROME_PATH`, hoặc Linux/macOS cần đặt `PYTHON_BIN=python3`).
   - Nhắc người dùng **mở lại hoặc reload cuộc hội thoại/workspace** trong IDE/Agent (Antigravity, Claude Code/Desktop, hoặc Codex) để nạp skill & MCP server mới, và hỏi xem có muốn Agent **khởi động Studio server port `3030`** ngay không.

4. **Khởi động Studio Server (chỉ chạy khi người dùng yêu cầu hoặc đồng ý):**
   ```powershell
   node engine/server.mjs
   ```
   *(Server chạy nền ở `http://localhost:3030`.)*

---

## Cách 2: Người dùng tự chạy 1 lệnh (Không cần qua Agent)

Mở terminal tại thư mục gốc của repo vừa clone và chạy:

- **Cài đặt mặc định cho Antigravity (`.agents/plugins/`):**
  ```powershell
  node setup.mjs
  ```
  *(Trên Windows có thể chạy `.\setup.bat`.)*

- **Cài cho tất cả Agent phổ biến (Antigravity + Claude Code + Codex):**
  ```powershell
  node setup.mjs --agents all
  ```

- **Tùy chọn riêng cho Claude Desktop / Claude Code / Codex:**
  ```powershell
  node setup.mjs --agents claude --claude-desktop
  node setup.mjs --agents codex
  ```
  *(`--claude-desktop` tự động tạo file backup `.bak` có timestamp trước khi merge `tech-video-studio` vào `claude_desktop_config.json`, giữ nguyên toàn bộ MCP server đang có.)*

- **Cài đặt Global Antigravity (`~/.gemini/config/plugins/tech-video-studio`):**
  ```powershell
  node setup.mjs --global
  ```
  *(Thêm `--agy` nếu máy có Antigravity CLI `agy` để cài qua `agy plugin install`; hoặc `--all` để cài cả workspace + global.)*

- **Kiểm tra chẩn đoán không ghi file:**
  ```powershell
  node setup.mjs --check --json
  ```

- **Khởi động Web Studio (cổng `3030`):**
  ```powershell
  node engine/server.mjs
  ```
  Sau đó mở trình duyệt tại `http://localhost:3030`.

---

## Yêu cầu môi trường trên máy mới

| Thành phần | Yêu cầu | Ghi chú |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.0.0` | Không cần `npm install` (`engine/` dùng thuần built-in ESM; `render_video.mjs` cần `WebSocket` global từ Node 22+). Engine render mặc định là HyperFrames (runtime JS vendor sẵn, không cần FFmpeg) — xem [`engine/HYPERFRAMES_ENGINE.md`](engine/HYPERFRAMES_ENGINE.md). |
| **Python** | `>= 3.10` | Không cần `pip install` (`engine/tts_pipeline.py` dùng thuần standard library). Nếu máy dùng lệnh `python3`, đặt `PYTHON_BIN=python3` khi chạy `server.mjs`. |
| **Google Chrome** | Có cài Chrome | Windows mặc định tìm `C:\Program Files\Google\Chrome\Application\chrome.exe`. Nếu cài chỗ khác hoặc trên macOS/Linux, đặt biến môi trường `CHROME_PATH`. |
| **AI Provider (tùy chọn)** | 1 trong 9 kênh | Dùng **Antigravity Worker**, hoặc nhập API key trực tiếp trong Web Studio (`OpenAI`, `Anthropic`, `DeepSeek`, `Gemini`, `OpenRouter`), chạy local **Ollama / LM Studio**, hoặc dùng **Manual `$0` Web Prompt Pack** (không cần API key). |
| **Internet** | Có kết nối | Giao diện Web tải thư viện JS qua `https://esm.sh/` và TTS mặc định dùng `edge` / `google`. |

---

## Cách sử dụng sau khi cài xong

- **Thiết kế khóa học mới (Conversation 1):**
  `Tạo khóa học video mới về Kubernetes (CKA) tại K8S` (dùng trong Antigravity / Claude Code / Codex với skill `curriculum-architect`).
- **Biên kịch trực tiếp trên Web Studio (`http://localhost:3030`):**
  1. Bấm pill **`🤖 AI Worker & Models`** trên thanh trên cùng màn hình Roadmap để chọn 1 trong **9 brand AI** (hiển thị rõ 1 thẻ đang chọn `◉` + `✓ Đang chọn`, hoặc nhập API key để kiểm tra `$0` handshake & nạp danh sách model live).
  2. Bấm **`✍️ Biên kịch`** trên các tập chưa có kịch bản, **`✍️ Biên kịch Đợt / Hàng loạt`**, hoặc bật **`☑️ Chọn nhiều`** để chạy hàng loạt không giới hạn tập trên 1 model. Để xem hoặc sửa/viết lại tập đã có kịch bản, bấm trực tiếp vào thẻ tập để mở **Studio Player** → tab **`🛠️ Sửa`** (thêm nhanh ticket theo cảnh hiện tại và bấm **`🔄 Gửi AI Sửa Kịch Bản`**).
  3. Nếu gặp hết quota giữa đợt, hệ thống tự tạm dừng an toàn (`⏸️ Hết Quota`), giữ nguyên các tập đã xong và cho phép bấm **`▶ Tiếp tục (Resume / Đổi Model)`** để đổi sang model/provider khác chạy nốt phần còn lại.
- **Bật Antigravity Worker (`studio-worker`):**
  Mở một chat mới và gõ: `Bật VideoMaker Worker` (chạy 0 token khi chờ qua `engine/worker_wait.mjs` + MCP `tech-video-studio`).
- **Tạo giọng đọc Multi-Voice A/B, Khớp nhịp 2 lớp & Render video Full HD (Conversation 3):**
  Dùng skill `video-renderer`, hoặc ngay trên **Studio Player** (`http://localhost:3030`): bấm **`🎙️ Tạo Audio (TTS)`** (bảo toàn các giọng cũ để đổi A/B tức thì), mở **`⏱️ Khớp nhịp Animation`** trong tab **`🎬 Phân cảnh`** để tinh chỉnh timing theo playhead, và mở **`🎬 Xuất Video ▾`** để chọn chất lượng, đặt/sửa **Tên file đầu ra** (điền sẵn `<ep-id>`, tự cảnh báo ghi đè kèm nút đổi tên `-v2` nếu trùng) rồi bấm **`🚀 Bắt đầu Xuất Video`**. Toàn bộ file xuất được lưu thẳng vào `<COURSE>/episodes/<ep-id>/` và hiển thị tại khung **`📁 Video đã xuất`** ngay dưới timeline (hỗ trợ **`▶ Xem thử`** trong app, **`✏️ Chọn tên`**, **`📋 Copy path`**, **`🗑️ Xóa`**; không cần nút download lặp lại).
