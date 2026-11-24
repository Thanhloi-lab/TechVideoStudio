# Hướng dẫn Cài đặt & Khởi chạy nhanh (`Tech Course Video Studio`)

Tài liệu này dùng cho **cả người dùng và AI Agent** ngay sau khi `git clone` hoặc `git pull` repository này về máy mới.

---

## Cách 1: Giao cho AI Agent tự cài đặt (Khuyên dùng — không cần thao tác tay)

1. Mở thư mục repository vừa clone bằng **Antigravity** (hoặc agent tương thích).
2. Mở file `GUIDE.md` (hoặc gõ thẳng vào khung chat):
   > **"Hãy đọc `GUIDE.md` và thực hiện toàn bộ các bước setup tự động cho tôi."**

### Checklist dành riêng cho AI Agent (Agent Execution Runbook)

Khi người dùng yêu cầu làm theo `GUIDE.md`, Agent thực hiện tuần tự các bước sau:

1. **Chạy script setup tự động (SSOT -> Antigravity Plugin):**
   - Cài đặt cho **Antigravity** vào cả workspace (`.agents/plugins/tech-video-studio/`) và global (`~/.gemini/config/plugins/tech-video-studio/`):
     ```powershell
     node setup.mjs --workspace --global --json
     ```
   - Hoặc chỉ cài trong workspace hiện tại:
     ```powershell
     node setup.mjs --workspace --json
     ```
   - Script sẽ tự động:
     - Kiểm tra phiên bản `Node.js` (cần `>= 22`), `Python` (cần `>= 3.10`), `Google Chrome`, toàn bộ file trong `engine/`, và sự hiện diện dạng `true/false` của các biến môi trường API Key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` — không đọc hay in giá trị bí mật).
     - Sinh bộ plugin Antigravity từ nguồn chuẩn duy nhất (`AGENTS.md` + `plugin/tech-video-studio/`) gồm `plugin.json`, `mcp_config.json`, `rules/AGENTS.md` và **6 skills** (`curriculum-architect`, `curriculum-reviewer`, `episode-producer`, `content-reviewer`, `studio-worker`, `video-renderer`).
   - *(Lưu ý: `--agents claude|codex|all` và `--claude-desktop` vẫn được hỗ trợ khi người dùng yêu cầu rõ ràng sinh thêm adapter ngoài `.claude/` hoặc `.agents/skills/`.)*

2. **Kiểm tra trạng thái sau khi cài, đồng bộ state khóa học & kiểm thử (tùy chọn):**
   ```powershell
   node setup.mjs --check --json
   node engine/state_cli.mjs summary --course AWS
   node engine/test_phase1_three_stage.mjs
   node engine/test_ai_bridge_and_templates.mjs
   node engine/test_hyperframes.mjs
   node engine/scripts/vendor_libs.mjs --verify-only
   ```
   *(Nếu repo chưa có khóa học nào hoặc bạn tạo khóa mới, bỏ qua bước `state_cli.mjs`. Toàn bộ khóa học cục bộ `<COURSE>/`, `*.mp3`, `*.mp4`, adapter `.agents/`, `.claude/`, `.mcp.json` và file key/cache `engine/.ai_*.json`, `.env` đều đã được loại trừ trong `.gitignore`.)*

3. **Báo cáo ngắn gọn lại cho người dùng:**
   - Trạng thái cài plugin (`workspace.ok`, `global.ok`, `engine.ok`), đường dẫn MCP server đã cấu hình.
   - Cảnh báo rõ nếu thiếu điều kiện môi trường (ví dụ `Node < 22`, `Python < 3.10`, thiếu Chrome hoặc cần đặt `CHROME_PATH`, hoặc Linux/macOS cần đặt `PYTHON_BIN=python3`).
   - Nhắc người dùng **mở lại hoặc reload cuộc hội thoại/workspace** trong Antigravity để nạp 6 skill & MCP server mới, và hỏi xem có muốn Agent **khởi động Studio server port `3030`** ngay không.

4. **Khởi động Studio Server (chỉ chạy khi người dùng yêu cầu hoặc đồng ý):**
   ```powershell
   node engine/server.mjs
   ```
   *(Server chạy nền ở `http://localhost:3030`.)*

---

## Cách 2: Người dùng tự chạy 1 lệnh qua `npx` (Không cần `git clone` hay tải VieNeu-TTS riêng)

```powershell
# Cài đặt tương tác: chọn AI Agent có trên máy + tự cài thiếu Python/Chrome + gói VieNeu-TTS (port 8000)
npx github:Thanhloi-lab/TechVideoStudio

# Hoặc cài tự động toàn bộ (gồm Python/Chrome + VieNeu-TTS v3 Turbo ONNX, không Docker):
npx github:Thanhloi-lab/TechVideoStudio setup --install-deps --with-vieneu --yes

# Khởi chạy đồng thời Web Studio (port 3030) + VieNeu-TTS (port 8000):
npx github:Thanhloi-lab/TechVideoStudio studio

# Chỉ kiểm tra hệ thống, VieNeu-TTS & AI Agent có trên máy (không ghi file):
npx github:Thanhloi-lab/TechVideoStudio check
```

Hoặc mở terminal tại thư mục gốc của repo vừa clone và chạy:

- **Cài đặt đồng bộ cho Antigravity (workspace + global):**
  ```powershell
  node setup.mjs --workspace --global
  ```
- **Chỉ cài trong workspace (`.agents/plugins/tech-video-studio/`):**
  ```powershell
  node setup.mjs --workspace
  ```
  *(Trên Windows có thể chạy `.\setup.bat`.)*
- **Cài đặt Global Antigravity (`~/.gemini/config/plugins/tech-video-studio`) qua `agy` CLI (nếu có):**
  ```powershell
  node setup.mjs --global --agy
  ```
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
| **Node.js** | `>= 22.0.0` | Không cần `npm install` (`engine/` dùng thuần built-in ESM; `render_video.mjs` cần `WebSocket` global từ Node 22+). Engine render duy nhất là HyperFrames (runtime JS vendor sẵn, mặc định `30` fps, không cần FFmpeg) — xem [`engine/HYPERFRAMES_ENGINE.md`](engine/HYPERFRAMES_ENGINE.md). |
| **Python** | `>= 3.10` | Không cần `pip install` (`engine/tts_pipeline.py` dùng thuần standard library). Nếu máy dùng lệnh `python3`, đặt `PYTHON_BIN=python3` khi chạy `server.mjs`. |
| **Google Chrome** | Có cài Chrome | Windows mặc định tìm `C:\Program Files\Google\Chrome\Application\chrome.exe`. Nếu cài chỗ khác hoặc trên macOS/Linux, đặt biến môi trường `CHROME_PATH`. |
| **AI Provider (tùy chọn)** | 1 trong 9 kênh | Dùng **Antigravity Worker**, hoặc nhập API key trực tiếp trong Web Studio (`OpenAI`, `Anthropic`, `DeepSeek`, `Gemini`, `OpenRouter`), chạy local **Ollama / LM Studio**, hoặc dùng **Manual `$0` Web Prompt Pack** (không cần API key). |
| **Internet** | Có kết nối | Giao diện Web tải thư viện JS qua `https://esm.sh/` và TTS mặc định dùng `edge` / `google`. |

---

## Cách sử dụng sau khi cài xong

- **Thiết kế khóa học Deep-Dive mới (Conversation 1):**
  `Tạo khóa học video mới về Kubernetes (CKA) tại K8S` (dùng `curriculum-architect` + phản biện độc lập `curriculum-reviewer` -> `curriculum_review.md`).
- **Biên kịch Đa phần (`<= 5m/part`) trên Web Studio (`http://localhost:3030`):**
  1. Bấm pill **`🤖 AI Worker & Models`** trên thanh trên cùng màn hình Roadmap để chọn 1 trong **9 brand AI** và cấu hình định tuyến 5 vai trò (`outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair`).
  2. Bấm **`✍️ Biên kịch`** trên các tập chưa có kịch bản hoặc bật **`☑️ Chọn nhiều`** để chạy batch `deep_course`. Mở **`ScriptingStageModal`** để xem/sửa `brief.json`, từng `parts/<part_id>/dialogue.json`, tab **`review.md`**, bấm **Approve Part** và **Merge Parts**.
  3. Nếu hết quota giữa đợt, hệ thống tự tạm dừng an toàn (`⏸️ Hết Quota`) và cho phép **`▶ Tiếp tục (Resume / Đổi Model)`**.
- **Bật Antigravity Worker (`studio-worker`):**
  Mở một chat mới và gõ: `Bật VideoMaker Worker` (chạy 0 token khi chờ qua `engine/worker_wait.mjs` + MCP `tech-video-studio`).
- **Tạo giọng đọc, Preview Part & Render HyperFrames 30fps (Conversation 3):**
  Dùng skill `video-renderer` (`render_video.mjs --part part_01 --fps 30` hoặc cả tập đã merge), hoặc ngay trên **Studio Player**: chuyển Part bằng **Part Switcher**, bấm **`🎙️ Tạo Audio (TTS)`**, căn **`⏱️ Khớp nhịp Animation`**, và mở **`🎬 Xuất Video ▾`** để xuất trực tiếp vào thư mục bài học.
