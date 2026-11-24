# Motion Style & Engine Upgrade Specification (`MOTION_SPEC.md`)

> Đặc tả kỹ thuật phân tích phong cách motion từ 2 video tham chiếu trong `D:\VideoMaker\ref\` và kiến trúc nâng cấp thuần ESM trình duyệt cho `D:\VideoMaker\engine\` (tương thích chính sách Windows Application Control — không phụ thuộc `.exe` bên ngoài).

---

## Phần I — Hồ sơ Dữ liệu Tham chiếu (Reference Baseline)

Hai video tham chiếu được giải mã từng frame ở tốc độ gốc `30.000 fps` (`33.333 ms/frame`) qua WebCodecs `VideoDecoder` + phổ âm thanh qua `AudioContext.decodeAudioData`:

| Thuộc tính đo được | Video 1 — `Awesome-REA` (`V1`) | Video 2 — `Dify` (`V2`) |
|---|---|---|
| File nguồn | `FSave.com_Reels_1-253-cong-cu-dich-nguoc-431-case-study-_Media_3641659486003505_001_1080p.mp4` | `FSave.com_Reels_152-896-sao-GitHub-hon-ca-LangChain-ma-r_Media_1523854553119272_001_1080p.mp4` |
| Dung lượng / Định dạng | `31.65 MB` • `1080×1920` (9:16) • `30.000 fps` CFR | `27.78 MB` • `1080×1920` (9:16) • `30.000 fps` CFR |
| Độ dài / Tổng số frame | `169.033s` (`5,071` frame, H.264 `avc1.4D4028` + AAC) | `170.533s` (`5,116` frame, H.264 `avc1.4D4028` + AAC) |
| Mức độ tối nền (`luma < 40`) | `70.2%` pixel tối (Mean luma `38.2`) | `93.4%` pixel tối (Mean luma `22.1`) |
| Tỷ lệ frame giữ tĩnh/ambient (`< 0.8 MAD`) | `90.4%` | `90.8%` |
| Tỷ lệ frame chuyển nhẹ (`0.8–4 MAD`) | `8.2%` | `8.2%` |
| Tỷ lệ frame chuyển động rõ (`4–25 MAD`) | `1.0%` | `0.7%` |
| Full-screen flash/hard cut (`>= 25 MAD`) | `0` | `0` |
| Số cảnh lớn (Major Scenes) | 9–10 cảnh (Hook `10.97s`, còn lại `~15–21s`) | 10 cảnh (Hook `6.67s`, còn lại `~15–21s`) |
| Số burst chuyển động (`>= 2 MAD`) | `29` burst (`0.17 burst/s`) | `26` burst (`0.15 burst/s`) |
| Thời lượng burst / Khoảng nghỉ (trung vị) | `67 ms` (chính `166–233 ms`) / Nghỉ `2.63s` | `100 ms` (chính `133–266 ms`) / Nghỉ `1.67s` |

**Kết luận cốt lõi:** Cả 2 video thuộc **cùng một hệ thống template và tác giả** (cùng cấu trúc kể chuyện và dùng chung card kết *Beeknoee API Platform* ở `161s–170s`), trong đó **V2 (`Dify`) là phiên bản tiến hóa tinh gọn hơn V1 (`Awesome-REA`)**.

---

## Phần II — Phân tích Chuyên sâu 6 Chiều Motion Style

### 1. Nhịp chuyển cảnh (Pacing & Narrative Cadence)

Phong cách vận hành theo nguyên lý **"Slow Macro, Micro Pop" (Nền chậm để đọc, Bật nhịp để giữ chú ý)**:

1. **Cấu trúc Macro (`15–21s / cảnh`):**
   - Mỗi cảnh là một *không gian khái niệm duy nhất* giữ ổn định trong `11–21 giây` thay vì cắt cảnh dồn dập kiểu TikTok truyền thống.
   - Riêng đoạn **Hook mở đầu** được V2 siết lại chỉ còn `6.67s` (so với `10.97s` ở V1) để tăng tỷ lệ giữ chân.
2. **Xây dựng cộng dồn từ trên xuống (Additive Progressive Build):**
   - Trong một cảnh, nội dung xuất hiện theo `3–5` nhịp cách nhau **trung vị `1.67s–2.63s`**, khớp trực tiếp từng mệnh đề lời thoại:
     - **Nhịp 1 (`+0.0s`):** Header cảnh (Icon badge + Tiêu đề) ở vùng trên.
     - **Nhịp 2 (`+1.5s–3.5s`):** Khối Hero chính (UI mockup / sơ đồ / biểu đồ / nhóm thẻ).
     - **Nhịp 3–4 (`+4s–12s`):** Thẻ chi tiết phụ, KPI số lớn, hộp so sánh `VS`, hoặc tem cảnh báo xếp bên dưới.
   - Các khối đã xuất hiện **tiếp tục ở lại trên màn hình** giúp người xem nhìn thấy bức tranh logic hoàn chỉnh trước khi thoát cảnh.
3. **Thoát cảnh đồng nhất + Khoảng thở tối (`Dark Breather`):**
   - Mọi chuyển cảnh lớn đều dùng **cùng một nhịp thoát `166–233 ms` (`5–7 frame`)**, sau đó để **`100–250 ms` nền tối trống (chỉ còn Layer 0 ambient + phụ đề)** rồi cảnh mới mới dựng lại từ trên xuống.
4. **Đồng bộ Âm–Hình (Audio-Visual Sync):**
   - Giọng nam đọc đều, rõ nhịp (`~145–160 từ/phút`); nhạc nền electronic/lo-fi tối giản nén sâu (`mean ~ -22 đến -24 dB`).
   - Đỉnh âm cao tần SFX (`whoosh / pop / UI click`) ở V2 đa số kích hoạt tại **`-67 ms` đến `+0 ms` (trước 0–2 frame)** so với thời điểm chuyển cảnh thị giác, tạo lực dẫn mắt tự nhiên.

---

### 2. Hiệu ứng Camera Zoom / Pan & Pseudo-Camera

Điểm đặc biệt của bộ video tham chiếu là **không dùng rung lắc camera (handheld shake) hay Ken Burns zoom toàn khung liên tục**, mà giả lập chiều sâu bằng **"Pseudo-Camera Depth & Spotlight"**:

1. **Spotlight Zoom-Pop (Phóng nổi trọng tâm thay cho Camera Zoom):**
   - Quan sát trong `V1` (`12s–26s`, giao diện Search *Awesome-REA*): nền UI bên dưới bị làm tối mờ đi, **một thẻ kết quả trọng tâm (`Mario Kart Wii · Party 4 · 64`)** bật to lên trục Z (`scale ~1.06`), đổ bóng sâu và viền glow sáng mảnh `1.5px`, tạo cảm giác camera vừa punch-in vào đúng dòng dữ liệu đó mà vẫn giữ ngữ cảnh xung quanh.
2. **Viewfinder Framing (Khung ngắm HUD):**
   - Xung quanh cửa sổ UI chính đặt 4 góc chữ **`L` mảnh** (`[ ]`) như ống ngắm kỹ thuật, giúp cô lập vùng chú ý mà không cần crop hay phóng to toàn màn hình.
3. **Exit Z-Recede (Lùi nhẹ khi thoát cảnh):**
   - Toàn sân khấu đồng thời thu nhỏ nhẹ `scale: 1.0 → 0.96` kèm `blur(0px → 20px)` và `opacity: 1 → 0`, mô phỏng hiệu ứng ống kính mất nét / lùi ra sau.
4. **Layout Reflow Pan (Đẩy ngang dọn chỗ):**
   - Ở cảnh so sánh (`V1 149s`): thẻ *"THƯ VIỆN"* ban đầu đứng giữa hơi lệch trái, đến lúc nhắc phe 2 thì **trượt ngang sang trái** để nhường không gian cho huy hiệu `VS` và thẻ *"KHO BÁU"* bật ra bên phải.
5. **Ứng dụng nâng cấp cho màn hình ngang `16:9` (`D:\VideoMaker\engine`):**
   - Trên khung rộng `1920×1080`, ngoài Spotlight dimming, ta **nên bổ sung thêm Camera Rig thực (`scale 1.0 → 1.25–1.45` + `translate(dx, dy)`)** xoay quanh vùng `fields` của `CleanConsoleMockup` hoặc cụm node đang hoạt động trong `ArchitectureDiagram`, dùng easing `power3.inOut` (`550–700 ms`) để người xem không phải nheo mắt đọc form/sơ đồ rộng.

---

### 3. Kiểu Easing, Spring & Hiệu ứng "Materialize" Chữ ký

Phân tích chuỗi `MAD` (Mean Absolute Difference) ở 30fps cho thấy đường cong vận tốc đặc trưng của toàn bộ hệ thống:

1. **Đường cong chủ đạo — Steep Ease-Out / Quart-Out (Không lê thê):**
   - Chuỗi delta đo trực tiếp trên chuyển động thuần (`#4253..#4257`): `[11.8, 9.0, 6.8, 4.5, 2.7]`; (`#3803..#3808`): `[10.3, 10.0, 3.9, 2.1]`.
   - Khởi tốc cực đại ở `frame 1–2`, hãm tốc nhanh và dừng êm không giật ngược (`cubic-bezier(0.16, 1, 0.3, 1)` hoặc GSAP `power3.out` / `power4.out`).
2. **Hiệu ứng Vào cảnh Chữ ký — "Blur-to-Sharp + Particle Confetti Sparkle" (`233–333 ms` / `7–10 frame`):**
   - Quan sát nhất quán ở cả V1 (`Awesome REA` 43.3s, KPI `1.655/+500/339` 94.3s, `THƯ VIỆN VS KHO BÁU` 149.1s) và V2 (Chart `+120` 14.8s, Scene *"Sao ai cũng cắm sao?"* 24.3s, nút `✓ demo / ⚡ production` 38.1s, *Sandbox Linux* 77.3s, *License* 127.4s):
     - **Pha 1 (`0–67 ms`):** Khối UI hiện mờ dần với `opacity: 0 → 0.85`, `filter: blur(18px–24px)`, `scale: 0.94 → 1.0`.
     - **Pha 2 (`67–200 ms`):** Một điểm lõi sáng `cyan/trắng` kích hoạt tại tâm khối hoặc icon, bung **15–30 hạt pixel confetti đa sắc** (cyan, magenta, vàng, xanh ngọc) bay tỏa tròn bán kính nhỏ rồi mờ dần.
     - **Pha 3 (`133–300 ms`):** `blur` thu nhanh về `0px` sắc nét. Với thẻ danh sách nhiều hàng (*License rows* ở V2 `127.4s`), các hàng **stagger unblur từ trên xuống cách nhau `33–67 ms`**.
3. **Controlled Spring chỉ dành cho Tem đóng dấu / Cảnh báo (`Impact Stamp`):**
   - Đo trực tiếp tại `V1 81.73s` (`#2450..#2458`, tem đỏ *"ĐỔI KEY NGAY!"*):
     - Bắt đầu ở `scale ~1.45, rotate ~ -2deg` → giật về `scale ~0.96, rotate ~ -7deg` → khóa chốt ở `scale 1.0, rotate -6deg` chỉ trong **`~133 ms` (4 frame)**.
     - Thông số spring tương đương: độ cứng cao, nảy rất ít (`stiffness: 420, damping: 24, mass: 0.9` — tương đương animejs/motion crisp spring).
4. **Ambient Loop (Sự sống nền khi giữ tĩnh):**
   - Hạt bụi bokeh trôi chậm liên tục, icon chuyển đổi xoay nhẹ (`GPT-4o ⇄ Claude Opus` ở `V2 104s`), con trỏ terminal nhấp nháy chu kỳ nửa pha `~450 ms`.

---

### 4. Cách vẽ Đường nối, Quỹ đạo & Gói tin Sơ đồ (Diagrams & Flows)

Video tham chiếu thay thế các đường thẳng thô cứng bằng **4 mô-típ đồ họa luồng dữ liệu**:

1. **Sơ đồ Lớp Isometric Bung tách (Exploded Layers — V1 Hook):**
   - 4 mặt phẳng nghiêng xếp dọc (từ website → game → app → binary → firmware), đường nét đứt mỏng + lưới/sóng nội khối + thước đo dọc bên trái, xuất hiện cùng cụm hạt sắc màu trong `~267 ms`.
2. **Sơ đồ Vòng Quỹ đạo Trung tâm (Orbital Hub — V2 Hook, Provider 94s, Beeknoee Outro):**
   - Logo trung tâm phát sáng nhẹ (`Dify`), bao quanh bởi **1–2 vòng tròn nét đứt đồng tâm (`stroke-dasharray`)**, các node vệ tinh (`Workflow`, `RAG`, `Agent`, `Model`) nối vào tâm qua tia mảnh kết thúc bằng **nút junction tròn có viền phát sáng (`●`)**.
3. **Vẽ Đồ thị & Biểu đồ Tuần tự (`V1 90s`, `V1 118s`, `V2 15s`):**
   - Đường cong tăng trưởng (`+120 sao/ngày`) vẽ nét mượt từ trái sang phải theo kiểu SVG `stroke-dashoffset` (`drawPath`) kèm vùng tô gradient mờ trượt theo ngay dưới đường.
   - Biểu đồ cột commit (`V1 118.5s`) dựng lên theo nhịp stagger, nhấn màu vàng phát sáng riêng cột đỉnh cao nhất.
4. **Flow Nối Bước Ngang Dọn Sạch (`V1 112s`, `V2 75s`, `V2 64s`):**
   - Thay vì nhồi quá nhiều mũi tên chéo, dùng **pipeline bước rõ ràng** (`REASONING → ANSWER → ACT` hoặc cụm thẻ `Cắt nhỏ | Embed | Vector` có thanh tiến độ cyan mảnh nằm mép trên mỗi bước), kết hợp danh sách cuộn dọc fade 2 đầu (`mask-image`) trỏ mũi tên sang icon đích.

**Đối chiếu với `D:\VideoMaker\engine\` hiện tại:**
[`ArchitectureDiagram.mjs`](file:///D:/VideoMaker/engine/src/components/ArchitectureDiagram.mjs) và [`drawArchitectureScene`](file:///D:/VideoMaker/engine/src/exporter.mjs#L119-L265) hiện chỉ vẽ đoạn thẳng nối tâm (`<line>`) với pad cứng `54/58`, đổi trạng thái active bằng CSS `transition: all 0.28s ease`, và gói tin là một `<circle>` chuyển động tuyến tính thô `pktT = (stepProgress * 1.6) % 1`. Nâng cấp sang đường cong Cubic Bézier, `createDrawable` / `createMotionPath` (Anime.js v4) + đuôi vệt sáng gói tin sẽ giải quyết dứt điểm độ cứng này.

---

### 5. Hiệu ứng Highlight Code, Terminal & Console Mockup

Quan sát chi tiết ở cả 2 video (`V1 12s–26s, 81s–87s`, `V2 49s–56s, 75s–88s, 94s–109s`):

1. **Gõ phím & Lọc danh sách Live (`V1 12s–26s`):**
   - Khung search bo góc đậm chất macOS/Raycast, gõ dần từng nhóm ký tự (`M → Ma → Mar → Mario` / `firmware` / `MCP`), danh sách và bộ đếm số lượng kết quả phía dưới cập nhật ngay theo chuỗi gõ.
2. **Nhấn mạnh Dòng Rủi ro & Tem Cảnh báo (`V1 81s–87s`):**
   - Trên pill mã nguồn `firmware.bin` / `API_KEY=sk-live-9f2a...`, highlight dòng rủi ro bằng `accent: "danger"` (đã loại bỏ hiệu ứng thanh dọc đỏ quét ngang `laser_scan`), sau đó tem `"ĐỔI KEY NGAY!"` dập xuống góc trên phải bằng spring.
3. **Tương phản Hai Dòng An toàn vs Nguy hiểm (`V2 104s–109s`):**
   - Xếp chồng sát nhau 2 pill code ngắn cùng cấu trúc để so sánh trực diện:
     - Dòng an toàn: viền xanh ngọc, icon khóa `🔒`, giá trị che mờ `sk-•••••••••••••`.
     - Dòng lộ key: viền đỏ cam phát glow, icon lửa `🔥`, giá trị lộ rõ `sk-live-9f2b...`.
4. **Terminal Sandbox & Screenshot Sản phẩm Nhúng (`V2 49s–56s, 75s–88s`):**
   - Ảnh screenshot giao diện thật (*Dify Studio*) được cắt gọn vào khung cửa sổ tối macOS, ghim **pill nổi hành động** (`▶ Test Run token / node`, `Publish → POST /v1/chat-messages`) ở vùng chân/góc để dẫn mắt thay vì để ảnh UI thô khó đọc.
   - Khung `SANDBOX · LINUX` chỉ hiện **2 dòng lệnh đắt giá nhất** (`$ pip install pandas ✓`, `$ python report.py █`) với con trỏ khối cyan nhấp nháy (`~450 ms/nhịp`) và dải cảnh báo sọc chéo hổ phách (`diagonal hazard stripes`) đặt ngay bên dưới.

**Bài học cho `D:\VideoMaker\engine\`:**
[`TerminalAndCode.mjs`](file:///D:/VideoMaker/engine/src/components/TerminalAndCode.mjs) hiện tô màu nền đơn sắc cho cả dòng (`is-highlighted` / `is-dimmed`) trên font monospace thô. Kết hợp **Shiki + `@shikijs/magic-move`** (morph token mượt mà giữa các pha code/policy hoặc thêm/bớt block JSON) cùng **`rough-notation`** (gạch chân/khoanh tròn/đánh dấu tay màu hổ phách vào chính key cần học như `"Action"`, `"Effect": "Allow"`, `"sts:AssumeRole"`) sẽ nâng tầm trực quan lên rõ rệt.

---

### 6. Typography, Bảng màu & Phụ đề (Captions & Color System)

1. **Tiến hóa Typography từ V1 → V2:**
   - **V1:** Phối *Bold Geometric Sans* (nhãn chính) + *High-Contrast Italic Serif gạch chân* cho động từ/từ khóa cảm xúc (*chạy, trước đã, có gì?, phe nào?*). Nhược điểm quan sát được là một số dấu tiếng Việt (`ế, ằ, ề`) trên font serif nghiêng bị hở/lệch nhẹ.
   - **V2 (Chuẩn khuyến nghị):** Thuần **Geometric Sans-Serif đậm nét** (nhóm *Be Vietnam Pro / Inter / Plus Jakarta Sans*, weight `700–900` cho headline, `500–700` cho subtext) + **Monospace** (`JetBrains Mono / Fira Code`) cho badge phiên bản, URL, API route, dòng lệnh. Số KPI lớn dùng *tabular numerals* kích thước gấp `3–4×` nhãn phụ bên dưới.
2. **Hệ thống Màu sắc & Độ tương phản:**
   - **V1 Palette (Warm Tech Editorial):** Nền `#2b1b1e → #0f0c0f`, accent hồng phấn `#f0a0b0`, vàng ấm `#f0c070`, cảnh báo san hô `#e07050`, đối lập xanh ngọc `#70d0c0`.
   - **V2 Palette (Sleek SaaS Navy-Cyan — chuẩn nền tối học thuật):**
     - Nền chính: `#020a14 → #060811 → #02060e` (rất sạch, tách nổi mọi UI card).
     - Accent chính: `#2a62ff` (Electric Cobalt) → `#10c0f0` / `#90e0f0` (Cyan).
     - Nhấn dữ liệu / sao: `#f0c040` (Amber Gold).
     - Cảnh báo / Bẫy bảo mật / Cấm: `#f08070` / `#ef4444` (Coral Red) & `#f59e0b` (Warning Amber).
     - Xanh xác nhận / An toàn: `#10b981` / `#60d0b0`.
3. **Phụ đề tách rời & Thanh Tiến độ (Layer 3):**
   - **Ngắt cụm ngắn:** `3–5 từ/cụm` (1 dòng duy nhất), căn giữa ngang.
   - **Không nền hộp đen:** Chữ trắng `#FFFFFF` bold có drop shadow dịu, **tô màu accent cho đúng 1–2 từ khóa đắt giá nhất trong câu** (`#f0c070` ở V1, `#10c0f0` ở V2) — đổi thẳng theo cụm từ, không phóng to thu nhỏ từng chữ gây rối mắt.
   - **Vị trí Safe Zone:** V1 đặt ở `y ≈ 85%–90%`; V2 nâng hẳn lên **`y ≈ 75%–80%`** (tránh UI nền tảng).
   - **Top Progress Bar (V2):** Thanh gradient mảnh `~6–8 px` (ở 1080p), gradient `#2a62ff → #10c0f0` chạy suốt mép trên `y = 0` từ `0% → 100%`.

---

## Phần III — Đề xuất Phương án Nâng cấp cho `D:\VideoMaker\engine\`

### 1. Chẩn đoán Điểm nghẽn Kiến trúc Hiện tại

Qua kiểm tra trực tiếp mã nguồn [`server.mjs`](file:///D:/VideoMaker/engine/server.mjs), [`public/index.html`](file:///D:/VideoMaker/engine/public/index.html), [`studio.mjs`](file:///D:/VideoMaker/engine/src/studio.mjs), [`exporter.mjs`](file:///D:/VideoMaker/engine/src/exporter.mjs) và 4 component trong `src/components/`:

1. **Tách đôi Logic Render (Preview ≠ Export):**
   - [`studio.mjs`](file:///D:/VideoMaker/engine/src/studio.mjs) render **React DOM + SVG** (hiện chỉ có CSS `transition: all 0.28s ease`).
   - [`exporter.mjs`](file:///D:/VideoMaker/engine/src/exporter.mjs) lại **vẽ lại hoàn toàn bằng tay trên Canvas 2D** (`drawArchitectureScene`, `drawConsoleScene`, `drawCodeCliScene`, `drawExamScene`) rồi ghi `canvas.captureStream(30)` qua `MediaRecorder`.
   - **Hệ quả:** Nếu chỉ cài thêm `gsap`, `motion`, `animejs`, `rough-notation`, `@shikijs/magic-move` vào các component React thì phần **xem trước trên Studio sẽ rất đẹp nhưng file `.webm` xuất ra vẫn giữ nguyên hình tĩnh thô của Canvas 2D**.
2. **Thiếu Engine Timeline Tuyến tính Có thể Tua (Scrubbable Timeline):**
   - Hiện tại các CSS transition không đồng bộ ngược khi người dùng tua thanh timeline (`handleScrubGlobal`) hoặc khi exporter tick từng frame.
3. **Thiếu lớp FX & Typography Chuẩn Motion:**
   - Chưa có Particle Burst Canvas overlay, chưa có Gaussian blur-fade transition giữa các cảnh, phụ đề hiện bọc khung hộp dày ở sát đáy ăn mất diện tích `16:9`.

---

### 2. Stack Thư viện ESM Thuần Trình Duyệt (Verified, Zero `.exe`)

Tất cả các thư viện dưới đây đều đã xác minh phục vụ ESM trực tiếp qua `https://esm.sh` (không cần `npm.exe`, `esbuild.exe`, `pip.exe` hay `ffmpeg.exe`). Để chạy **offline 100% không cần Internet về sau**, có thể dùng 1 script Node.js thuần tải các file `.mjs` này vào `D:\VideoMaker\engine\public\vendor\` phục vụ qua `server.mjs`.

```html
<!-- Đề xuất cập nhật <script type="importmap"> trong D:\VideoMaker\engine\public\index.html -->
<script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18.3.1",
      "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
      "gsap": "https://esm.sh/gsap@3.15.1",
      "animejs": "https://esm.sh/animejs@4.5.0",
      "motion": "https://esm.sh/motion@14.14.0",
      "motion/react": "https://esm.sh/motion@14.14.0/react?external=react,react-dom",
      "rough-notation": "https://esm.sh/rough-notation@0.5.1",
      "shiki": "https://esm.sh/shiki@4.6.0",
      "@shikijs/magic-move/core": "https://esm.sh/@shikijs/magic-move@4.6.0/core",
      "@shikijs/magic-move/renderer": "https://esm.sh/@shikijs/magic-move@4.6.0/renderer",
      "webm-muxer": "https://esm.sh/webm-muxer@5.1.4"
    }
  }
</script>
```

> **Lưu ý kỹ thuật đã kiểm chứng:**
> - Package `shiki-magic-move` (tên cũ) ném lỗi khi import root, nên phải khai báo **`@shikijs/magic-move/core`** và **`@shikijs/magic-move/renderer`** (hoặc `/react?external=react,react-dom`).
> - Các gói phụ thuộc React (`motion/react`, `@shikijs/magic-move/react`) bắt buộc gắn `?external=react,react-dom` để tránh nạp trùng 2 bản React trên trình duyệt.

#### Vai trò Phân công Chính xác cho Từng Thư viện

| Thư viện | API cốt lõi sử dụng | Vai trò trong `D:\VideoMaker\engine\` |
|---|---|---|
| **`gsap@3.15.1`** | `gsap.timeline({ paused: true })`, `.progress(sceneProgress)` | **Xương sống Timeline & Camera Rig:** Điều khiển toàn bộ nhịp vào/ra cảnh (`Blur-Scale Exit 200ms`), Camera Zoom/Pan vào field console hoặc cụm node, stagger card theo đúng `progress_start / progress_end`, tua mượt xuôi/ngược theo `<audio>.currentTime`. |
| **`animejs@4.5.0`** | `createTimeline({ autoplay: false })`, `createDrawable`, `createMotionPath`, `createSpring`, `stagger`, `scrambleText` | **Đường nối Sơ đồ, Gói tin & Spring Đóng dấu:** Vẽ đường cong Bézier (`createDrawable` thay `<line>` tĩnh), cho gói tin chạy mượt kèm easing dọc đường cong (`createMotionPath`), kích hoạt vật lý `createSpring` cho tem cảnh báo/Exam card và hiệu ứng số nhảy KPI (`utils.round` / text scramble). |
| **`motion@14.14.0`** | `<AnimatePresence>`, `motion.div`, `animate()` | **Chuyển trạng thái UI & Micro-interaction trong Studio:** Xử lý morph/layout card (`layoutId`), chuyển tab / chọn đáp án quiz (`ExamTipCard.mjs`), hover & spotlight focus card nổi khối Z. |
| **`rough-notation@0.5.1`** | `annotate()`, `annotationGroup()` | **Ghi chú Thủ công Đồng bộ Giọng nói:** Khoanh `box`, gạch `underline`, tô `highlight`, đóng ngoặc `bracket` bằng nét vẽ tay SVG lên tiêu đề cảnh, trường console quan trọng, hoặc đáp án đúng/bẫy sai trong `ExamTipCard`. |
| **`@shikijs/magic-move@4.6.0` + `shiki`** | `codeToKeyedTokens()`, `createMagicMoveMachine()`, `MagicMoveRenderer` | **Highlight & Morph Code Từng Token:** Thay thế danh sách text đơn sắc của `TerminalAndCode.mjs` bằng syntax highlight chuẩn VS Code (JSON/YAML/Bash/Python) + chuyển pha `highlight_phases` có token bay/morph mượt, kết hợp spotlight sáng dòng (`accent: "danger"` cho dòng rủi ro). |

---

### 3. Bản đồ Ánh xạ Từng Component & Motion Tokens

#### A. Lớp Nền & Particle Overlay Dùng Chung (`src/motion/ParticleStage.mjs`)
- **Canvas Layer 0 (Ambient):** Lưới blueprint `60px` siêu mảnh (`rgba(148,163,184,0.04)`) + ~22 hạt bokeh trôi vận tốc chậm (`0.08–0.22 px/frame`), giữ canvas sống ngay cả lúc hold đọc chữ.
- **Canvas Layer 2 (Sparkle Confetti Burst):** Hàm `spawnSparkleBurst(x, y, theme)` bắn `18–26` hạt pixel đa sắc tỏa tròn từ lõi sáng cyan trong `220 ms` mỗi khi 1 bước mới (`flow_step`, `console step`, `exam comparison`, `scene header`) được kích hoạt.
- **Top Timeline Progress Bar:** Đưa thanh gradient `#2a62ff → #10c0f0` (`4–6 px`) lên sát mép trên `y = 0` (`exporter.mjs` + `studio.mjs`), bỏ viền hộp nặng quanh phụ đề.

#### B. Nâng cấp `ArchitectureDiagram.mjs`
- Chuyển đường nối từ `<line>` thẳng sang **Cubic Bézier SVG `<path>`** (tính độ cong dựa theo vector pháp tuyến để không đè chữ/node).
- Dùng `animejs` `createDrawable(pathEl)` + `createMotionPath(pathEl)` gắn vào `timeline.seek(sceneTime * 1000)`:
  - Đường active tự vẽ chiều dòng chảy kèm **glow aura** và gói tin hình viên nang có đuôi (`motion path` easing `outQuad` thay cho chia lấy dư `% 1` khô).
  - Node không active giảm sáng (`opacity: 0.42`, `filter: saturate(0.6)`); node active nổi scale `1.06` + Particle sparkle khi vừa bật sang bước mới.
- **Camera Rig (`16:9`):** Nếu `flow_step` định nghĩa `camera_focus: { x, y, zoom }` (tùy chọn), GSAP timeline tween `wrapper` tới cụm node đó (`duration: 0.55s, ease: "power3.inOut"`).

#### C. Nâng cấp `CleanConsoleMockup.mjs`
- Thêm **Fake Pointer / Spotlight Focus**: Khi `field.highlight === true`, làm mờ nhẹ các field khác (`opacity: 0.48`), scale nhẹ field đích (`1.03`), đóng 4 góc L-bracket quanh field hoặc khoanh `rough-notation` `box`/`underline` màu `#FF9900` / `#10c0f0` ngay tại `tip`.
- Chuyển giữa `Bước 1 → Bước 2 → ...` bằng cross-blur-fade `220 ms` (`opacity + blur(8px → 0)`) thay vì cắt nhảy tức thời.

#### D. Nâng cấp `TerminalAndCode.mjs`
- Dùng `shiki` + `@shikijs/magic-move/renderer` (`MagicMoveRenderer`) cho phần code JSON/YAML/IaC:
  - Cho phép `highlight_phases` truyền thêm `code_override` (tùy chọn) để morph trực tiếp ví dụ `"Effect": "Allow"` sang `"Deny"` hoặc mở rộng thêm block `"Condition"` bằng animation token FLIP mượt.
  - Dòng không nằm trong `activePhase.lines` giảm `opacity: 0.35, filter: blur(0.6px)`; dòng đang active gắn thanh chỉ thị trái phát sáng + tùy chọn `accent: "danger"` tô đỏ dòng nhạy cảm (vd hardcoded `AWS_SECRET_ACCESS_KEY`).
- Terminal CLI nâng cấp: giữ typing mượt theo `progress`, thêm con trỏ khối `#10c0f0` nhấp nháy chu kỳ `450 ms`, kết quả output trượt lên nhẹ từng dòng (`stagger 40 ms`, `translateY: 6px → 0`).

#### E. Nâng cấp `ExamTipCard.mjs` & Hệ thống Phụ đề
- Thẻ `exam-card` vào theo nhịp **Blur-to-Sharp + Particle Sparkle** (`260 ms`), riêng huy hiệu `❌ Bẫy thi` / `✅ Chuẩn Production` có thể kích hoạt `rough-notation` (`strike-through` đỏ cho câu sai / `highlight` hoặc `circle` xanh cho đáp án đúng) và tem đóng dấu dùng `anime.createSpring`.
- **Phụ đề (Layer 3):** Tách bỏ khung viền chữ nhật, dùng chữ trắng `#F8FAFC` cỡ `34–38 px` (ở 1080p) đặt ở safe zone sạch (`bottom: 44px` trên `16:9`, hoặc `bottom: 20%` khi xuất chế độ dọc `9:16`), hỗ trợ cú pháp đánh dấu từ khóa `**keyword**` hoặc mảng `highlight_words` trong `script.json` để tô màu accent (`#10c0f0` / `#FF9900`).

---

### 4. Giải pháp Xuất Video Một Nguồn Duy Nhất (Single-Source Export — Không dùng `ffmpeg.exe`)

Để loại bỏ tình trạng phải viết code 2 lần (DOM + Canvas 2D) mà vẫn chạy tốt trên Windows bị chặn `.exe`:

1. **Phương án Khuyến nghị 1 — Headless Chrome Deterministic Capture (`node engine/export_headless.mjs`, zero `.exe` mới):**
   - Tận dụng chính `chrome.exe` có sẵn trên máy + `node` ES module:
   - Studio lộ hook `window.__STUDIO_EXPORT_SEEK__(globalTimeSec)` điều khiển toàn bộ `gsap.timeline().seek()` + `anime.timeline().seek()` + `ParticleStage.renderAt(t)` **chính xác từng frame một (`step = 1/30 s`)** ở độ phân giải `1920×1080` (hoặc `1080×1920`).
   - Node điều khiển Chrome qua CDP (`Page.captureScreenshot` hoặc Canvas/Offscreen compositor) kết hợp audio từ `AudioContext` + **`webm-muxer` (WebCodecs `VideoEncoder` VP9 + `AudioEncoder` Opus)** ngay trong trình duyệt để tạo file `.webm` (hoặc `mp4-muxer` H.264/AAC) siêu nét, **không bao giờ rớt frame** ngay cả khi có nhiều blur filter, Shiki hay SVG animation nặng, và gửi thẳng về `POST /api/save-video`.
2. **Phương án Khuyến nghị 2 (Trong tab Studio hiện tại) — Tab/Element Region Capture:**
   - Dùng trực tiếp `navigator.mediaDevices.getDisplayMedia({ preferCurrentTab: true })` + `CropTarget.fromElement(stageEl)` (Region Capture API của Chromium) gộp chung với luồng `AudioContext` `dest.stream` vào `MediaRecorder`. Ưu điểm là 0 cần tiến trình phụ, ghi đúng 100% DOM (`GSAP + Shiki + RoughNotation + Canvas Particle`), chỉ cần máy đủ hiệu năng real-time 30fps.
3. **Phương án Chuyển tiếp (Tương thích ngược tức thì với `exporter.mjs`):**
   - Trong giai đoạn chưa bật Headless Capture, `exporter.mjs` có thể dùng chung **1 module Pure-Math Motion Kernel (`src/motion/kernel.mjs`)** — chứa hàm `easeQuartOut`, `dampedSpring`, đường cong Bézier, bộ `ParticleBurst` Canvas, `ctx.filter = "blur(...)"` chuyển cảnh `200ms` và parser tô màu từ khóa phụ đề — để chất lượng file xuất bằng `canvas.captureStream(30)` tiệm cận ngay 85% bản DOM mà không vỡ cấu trúc `script.json` hiện có ở `D:\VideoMaker\AWS\episodes\ep01-iam-core\script.json`.

---

## Phần IV — Checklist Token Kỹ thuật Chuẩn (Copy-Ready Constants)

```js
// Tham số chuẩn hóa rút trích từ video tham chiếu V2 (Dify) & tối ưu cho Tech Video Studio
export const MOTION_TOKENS = {
  fps: 30,
  timing: {
    sceneExitMs: 200,          // 6 frame @30fps (opacity 1->0, blur 0->20px, scale 1->0.96)
    sceneBreatherMs: 140,      // ~4 frame nền tối Layer 0 thở giữa 2 cảnh
    elementRevealMs: 267,      // 8 frame @30fps (blur 20px->0 + sparkle confetti)
    listStaggerMs: 50,         // Stagger từ trên xuống cho list card / row
    stampSlamMs: 133,          // 4 frame @30fps spring scale 1.45 -> 0.96 -> 1.0
    cameraFocusMs: 600,        // Pan/zoom tới cụm node hoặc field console (16:9)
    sfxLeadMs: -33,            // SFX đi trước 0-1 frame (-33ms..-67ms) trước chuyển cảnh
    cursorBlinkHalfMs: 450,    // Con trỏ khối terminal nhấp nháy
  },
  easings: {
    revealCss: "cubic-bezier(0.16, 1, 0.3, 1)",   // Quart-Out / GSAP "power3.out"
    exitCss: "cubic-bezier(0.4, 0, 1, 1)",         // Fast accelerate out
    cameraGsap: "power3.inOut",
    stampSpring: { stiffness: 420, damping: 24, mass: 0.9 },
  },
  paletteV2: {
    bgTop: "#020A14",
    bgMid: "#060811",
    bgBottom: "#02060E",
    gridLine: "rgba(148, 163, 184, 0.045)",
    accentPrimary: "#2A62FF",
    accentCyan: "#10C0F0",
    accentGlow: "#90E0F0",
    gold: "#F0C040",
    danger: "#EF4444",
    dangerText: "#F08070",
    warning: "#F59E0B",
    success: "#10B981",
    subtitleText: "#FFFFFF",
    subtitleAccent: "#10C0F0",
  },
  layout: {
    progressBarHeightPx: 6,    // Top progress bar y=0 (1080p)
    subtitleChunkWords: [3, 5],
    safeBottomPct16x9: 6,      // ~65px ở 1920x1080 (không bọc khung hộp)
    safeBottomPct9x16: 21,     // Vùng 75%-80% chiều cao, chừa sạch 20% đáy cho Reels/TikTok
  },
};
```

---

## Phần V — Bộ 7 Visual Template Được Hỗ Trợ (Symmetric DOM + Canvas 2D + Validator)

`SUPPORTED_VISUAL_TYPES` trong `src/motion/kernel.mjs` & `src/diagram_validator.mjs` hỗ trợ đồng bộ 7 template ở độ phân giải `1920×1080`:

| `visual_type` | Component React | Canvas 2D Exporter | Ràng buộc Validator | Đặc tả Animation & Mục đích |
|---|---|---|---|---|
| `"architecture"` | `ArchitectureDiagram` | `drawArchitectureScene` | Node/Zone/Edge collision check | Kiến trúc mạng/cloud có zones & gói tin Bézier |
| `"console_setup"` | `CleanConsoleMockup` | `drawConsoleScene` | Schema cơ bản | Mô phỏng giao diện Console Cloud & Spotlight field |
| `"code_cli"` | `TerminalAndCode` | `drawCodeCliScene` | Schema cơ bản | Highlight code Shiki Magic Move + Terminal + Danger Highlight |
| `"exam_tips"` | `ExamTipCard` | `drawExamScene` | Schema cơ bản | So sánh bẫy thi vs Best Practice + Quiz đóng dấu spring |
| `"comparison_matrix"` | `ComparisonMatrix` | `drawComparisonMatrixScene` | `2..4` columns, `1..6` rows | Bảng so sánh nhiều phương án, blur-to-sharp từng hàng + `takeaway` |
| `"timeline_flow"` | `TimelineFlow` | `drawTimelineFlowScene` | `2..6` milestones, `horizontal`/`vertical` | Chuỗi bước / vòng đời giao thức với thanh tiến độ cyan & `callout` |
| `"kpi_metrics"` | `KpiMetricsCard` | `drawKpiMetricsScene` | `1..4` cards, `chart.series` `<= 8` | Đếm số `easeQuartOut`, sparkline tự vẽ, bar chart cột vàng đỉnh + `alert_stamp` (`dampedSpring`) |

