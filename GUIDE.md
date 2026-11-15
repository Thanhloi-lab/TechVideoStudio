# Hướng dẫn Cài đặt & Khởi chạy nhanh (`Tech Course Video Studio`)

Tài liệu này dùng cho **cả người dùng và AI Agent (Antigravity)** ngay sau khi `git clone` hoặc `git pull` repository này về máy mới.

---

## Cách 1: Giao cho AI Agent tự cài đặt (Khuyên dùng — không cần thao tác tay)

1. Mở thư mục repository vừa clone bằng **Antigravity**.
2. Mở file `GUIDE.md` (hoặc gõ thẳng vào khung chat):
   > **"Hãy đọc `GUIDE.md` và thực hiện toàn bộ các bước setup tự động cho tôi."**

### Checklist dành riêng cho AI Agent (Agent Execution Runbook)

Khi người dùng yêu cầu làm theo `GUIDE.md`, Agent thực hiện tuần tự các bước sau:

1. **Chạy script setup tự động (mặc định cài vào workspace `.agents/plugins/tech-video-studio/`):**
   ```powershell
   node setup.mjs --json
   ```
   - Script sẽ tự động:
     - Kiểm tra phiên bản `Node.js` (cần `>= 22`), `Python` (cần `>= 3.10`), `Google Chrome` và toàn bộ file trong `engine/`.
     - Sinh plugin hoàn chỉnh gồm `plugin.json`, `mcp_config.json` (trỏ đúng đường dẫn tuyệt đối tới `engine/mcp_server.mjs` trên máy hiện tại), `rules/AGENTS.md` và 4 skills (`curriculum-architect`, `episode-producer`, `studio-worker`, `video-renderer`) vào `.agents/plugins/tech-video-studio/`.
   - *(Lưu ý: chỉ chạy `node setup.mjs --global --json` nếu người dùng yêu cầu rõ ràng là muốn cài toàn cục vào `~/.gemini/config/plugins/tech-video-studio/`.)*

2. **Kiểm tra trạng thái sau khi cài & đồng bộ state khóa học (nếu có):**
   ```powershell
   node setup.mjs --check --json
   node engine/state_cli.mjs summary --course AWS
   ```
   *(Nếu repo chưa có khóa học nào hoặc bạn tạo khóa mới, bỏ qua bước `state_cli.mjs`.)*

3. **Báo cáo ngắn gọn lại cho người dùng:**
   - Trạng thái cài plugin & 4 skills (`ok: true`), đường dẫn MCP server đã cấu hình.
   - Cảnh báo rõ nếu thiếu điều kiện môi trường (ví dụ `Node < 22`, `Python < 3.10`, thiếu Chrome hoặc Chrome không nằm ở đường dẫn mặc định cần đặt `CHROME_PATH`, hoặc Linux/macOS cần đặt `PYTHON_BIN=python3`).
   - Nhắc người dùng **mở lại hoặc reload cuộc hội thoại/workspace** (nếu Antigravity chưa tự nạp lại `.agents/plugins/` ngay trong phiên hiện tại), và hỏi xem có muốn Agent **khởi động Studio server port `3030`** ngay không.

4. **Khởi động Studio Server (chỉ chạy khi người dùng yêu cầu hoặc đồng ý):**
   ```powershell
   node engine/server.mjs
   ```
   *(Server chạy nền ở `http://localhost:3030`.)*

---

## Cách 2: Người dùng tự chạy 1 lệnh (Không cần qua Agent)

Mở terminal tại thư mục gốc của repo vừa clone và chạy:

- **Cài đặt vào workspace hiện tại (khuyên dùng):**
  ```powershell
  node setup.mjs
  ```
  *(Trên Windows có thể chạy `.\setup.bat`.)*

- **Hoặc cài đặt toàn cục (Global vào `~/.gemini/config/plugins/tech-video-studio`):**
  ```powershell
  node setup.mjs --global
  ```
  *(Nếu máy có cài Antigravity CLI `agy`, có thể thêm `--agy` để cài thông qua `agy plugin install`.)*

- **Khởi động Web Studio (cổng `3030`):**
  ```powershell
  node engine/server.mjs
  ```
  Sau đó mở trình duyệt tại `http://localhost:3030`.

---

## Yêu cầu môi trường trên máy mới

| Thành phần | Yêu cầu | Ghi chú |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.0.0` | Không cần `npm install` (`engine/` dùng thuần built-in ESM; `render_video.mjs` cần `WebSocket` global từ Node 22+). |
| **Python** | `>= 3.10` | Không cần `pip install` (`engine/tts_pipeline.py` dùng thuần standard library). Nếu máy dùng lệnh `python3`, đặt `PYTHON_BIN=python3` khi chạy `server.mjs`. |
| **Google Chrome** | Có cài Chrome | Windows mặc định tìm `C:\Program Files\Google\Chrome\Application\chrome.exe`. Nếu cài chỗ khác hoặc trên macOS/Linux, đặt biến môi trường `CHROME_PATH`. |
| **Internet** | Có kết nối | Giao diện Web tải thư viện JS qua `https://esm.sh/...` và TTS mặc định dùng `edge` / `google`. |

---

## Cách sử dụng sau khi cài xong

- **Thiết kế khóa học mới (Conversation 1):**
  `Tạo khóa học video mới về Kubernetes (CKA) tại K8S`
- **Biên kịch các tập tiếp theo (Conversation 2):**
  Dùng skill `episode-producer` hoặc gõ yêu cầu sản xuất kịch bản cho tập kế tiếp.
- **Bật Worker nhận việc từ Web UI (`localhost:3030`):**
  Mở một chat Antigravity mới và gõ: `Bật VideoMaker Worker` (kích hoạt skill `studio-worker`).
- **Tạo giọng đọc TTS & Render video Full HD (Conversation 3):**
  Dùng skill `video-renderer` hoặc bấm trực tiếp nút trên giao diện Player (`http://localhost:3030`).
