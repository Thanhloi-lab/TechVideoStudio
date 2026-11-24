# HyperFrames Render Engine — Ghi chép thiết kế & vận hành

> Tài liệu gốc (SSOT) cho engine render video dựa trên [HyperFrames](https://github.com/heygen-com/hyperframes)
> của Tech Video Studio. Ghi lại: nghiên cứu HyperFrames, các quyết định kiến trúc, hợp đồng
> composition / scene module, renderer zero-dependency, cách chạy, kiểm thử và giới hạn.
>
> Bắt đầu: 2026-11-17 · Nhánh: `worktree-hyperframes-engine`

---

## 1. Tóm tắt quyết định (2026-11-17)

| Câu hỏi | Quyết định | Lý do |
|---|---|---|
| Tích hợp HyperFrames theo hướng nào? | **Runtime HyperFrames chính thức + renderer zero-dep của mình** | `npx hyperframes render` cần FFmpeg + npm (`puppeteer-core`, `esbuild.exe` native) — vi phạm guardrail §5 của `AGENTS.md` (Windows Application Control chặn `.exe` không ký). |
| Nội dung hình ảnh trong composition | **Viết lại 7 template bằng DOM + GSAP** | Composition là HTML/CSS + GSAP timeline đúng chuẩn HyperFrames, mở/sửa được bằng HyperFrames Studio, render được bằng CLI chính thức trên máy có FFmpeg. |
| Engine Canvas 2D cũ (`window.__STUDIO_RENDER_OFFLINE__`) | **Giữ làm fallback `--engine legacy`** | HyperFrames là mặc định; engine cũ chỉ chạy khi chỉ định rõ, để lùi lại nếu cần. |

Hệ quả:

- Mỗi tập được **biên dịch** từ `script.json` thành một **project HyperFrames chuẩn** (`index.html` +
  `lib/` + `assets/`) nằm trong `<COURSE>/episodes/<EP>/hyperframes/`.
- Project chạy bằng **`hyperframe.runtime.iife.js` chính thức** (`@hyperframes/core@0.9.59`, Apache-2.0),
  vendor offline vào `engine/public/vendor/raw/` (chỉ là file JS, không cài npm).
- Render mặc định bằng `engine/render_video.mjs` (zero-dep, raw CDP) theo **đúng giao thức seek của
  HyperFrames** (`window.__hf.seek` → `window.__player.renderSeek`) và encode bằng **WebCodecs** trong
  Chrome — **không cần FFmpeg**.
- Cùng thư mục project đó có thể render bằng `npx hyperframes render` trên máy có FFmpeg + npm.

---

## 2. Nghiên cứu HyperFrames (tóm tắt)

### 2.1 Tổng quan

- Framework của HeyGen, **Apache-2.0**, biến HTML/CSS/media + animation seek được thành MP4
  **deterministic**. Monorepo gồm: `hyperframes` (CLI), `@hyperframes/core` (types, parser, linter,
  **runtime**, frame adapters), `@hyperframes/engine` (capture bằng Puppeteer + FFmpeg),
  `@hyperframes/producer` (pipeline capture → encode → mix audio), `@hyperframes/studio`,
  `@hyperframes/player`, `@hyperframes/shader-transitions`, `@hyperframes/aws-lambda`.
- Yêu cầu của CLI chính thức: **Node ≥ 22**, **FFmpeg**, Chrome (tự tải nếu thiếu).
- Phiên bản npm mới nhất lúc nghiên cứu: `0.9.59` (GitHub `main`: `0.9.60`).

### 2.2 Hợp đồng HTML composition (`reference/html-schema`)

Root:

| Thuộc tính | Bắt buộc | Ý nghĩa |
|---|---|---|
| `data-composition-id` | Có | ID duy nhất, **phải trùng key** `window.__timelines[...]` |
| `data-start="0"` | Có (root top-level) | Mốc bắt đầu |
| `data-width`, `data-height` | Có | Kích thước khung (px) |
| `data-duration` | Thường có | Tổng thời lượng (giây); compiler đọc trước khi script chạy |
| `data-no-timeline` | Chỉ khi không có timeline | Tránh runtime chờ timeline 45s |

Clip có thời gian: `id`, `data-start` (giây hoặc biểu thức `intro + 0.5`), `data-duration` (bắt buộc
cho DOM clip), `data-track-index` (chỉ dùng cho editor, render bỏ qua), `class="clip"`. Xếp lớp bằng
CSS `z-index`.

Media (`<audio>`/`<video>`): `data-media-start`, `data-playback-rate` (0.1–10), `data-volume`
(1 = 0 dB), `data-fade-in`, `data-fade-out`; `<video>` phải `muted` hoặc `data-has-audio="true"`.
**Không** tự gọi `play()/pause()/currentTime`.

Timeline: **một** `gsap.timeline({ paused: true })` hữu hạn, đăng ký vào
`window.__timelines["<composition-id>"]` sau khi đã thêm toàn bộ tween (setup async thì đăng ký
khi xong). Không dùng wall-clock, random không seed, repeat vô hạn.

### 2.3 Runtime & giao thức seek (đọc từ source `packages/core`, `packages/engine`, `packages/producer`)

- Runtime build ra `dist/hyperframe.runtime.iife.js`. Globals ổn định: `window.__player`,
  `window.__playerReady`, `window.__renderReady`, `window.__timelines`, `window.__clipManifest`,
  `window.__hyperframes` (helpers: `registerFrameSource`, `getVariables`, `fitTextFontSize`, ...).
- Producer của HyperFrames inject vào trang:
  1. runtime ở `<head>` (và **strip** mọi `<script>` nhúng sẵn có `src` kết thúc bằng
     `hyperframe.runtime.iife.js` hoặc có thuộc tính `data-hyperframes-preview-runtime`);
  2. *render-mode script* chờ `__player.renderSeek` rồi đặt `__playerReady = true`;
  3. *bridge script*: `window.__hf.duration` (getter, trả 0 khi `!__renderReady`) và
     `window.__hf.seek(t, opts)` → `__player.renderSeek(t, opts)`.
- Engine capture (`frameCapture.ts`): chờ `window.__hf && typeof __hf.seek === "function" &&
  __hf.duration > 0`; mỗi frame: `__hf.seek(t)` → `await window.__hfWaitForSeekCompletion()` →
  chụp (`HeadlessExperimental.beginFrame` trên Linux, `Page.captureScreenshot` ở nơi khác).
- Thời gian frame: `time = floor(frame) / fps` (integer math, không đọc đồng hồ thật).
- GSAP adapter seek bằng `timeline.totalTime(t, suppressEvents)` ⇒ **callback (`onUpdate`,
  `call`) có thể bị chặn** — hình ảnh phải là hàm thuần của thời gian, không dựa vào callback.
- Frame adapter (API v0 thử nghiệm): `{ id, init?, getDurationFrames, seekFrame, destroy? }`;
  seek phải xử lý mọi thứ tự, cùng frame ⇒ cùng kết quả.
- Canvas/WebGL: `window.__hyperframes.registerFrameSource({ element, ready, render(t, signal) })`
  hoặc sự kiện `hf-seek` (adapter Three.js/TypeGPU).

### 2.4 CLI chính thức (tham khảo)

`npx hyperframes init | preview | render | lint | check | doctor | add <block> | browser ensure`.
`render`: `--output`, `--format mp4|mov|webm|gif|png-sequence|hls`, `--fps` (mặc định 30),
`--quality draft|looks|high`, `--crf`, `--video-bitrate`, `--gpu`, `--hdr`, `--docker`,
`--composition`. Mã lỗi đáng chú ý: `ffmpeg_not_found`, `chrome_not_found`,
`node_version_unsupported`.

### 2.5 Hiện trạng máy dev (2026-11-17)

- Node `v22.18.0` ✅ · Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe` ✅ ·
  **FFmpeg ❌ (không có)** · `npx` có nhưng guardrail cấm cài npm deps.

---

## 3. Kiến trúc

```
script.json (+ voice track đang active, audio/*.mp3, subtitles)
        │  GET /api/courses  (server.mjs chuẩn hoá voice track)
        ▼
engine/hyperframes/compiler.mjs  ── Node, zero-dep
        │  • tính timeline (thời lượng cảnh theo audio thật / speed)
        │  • tô màu code bằng Shiki (vendored) lúc biên dịch
        │  • chép audio + lib vào project
        ▼
<COURSE>/episodes/<EP>/hyperframes/        ← project HyperFrames chuẩn
  index.html            root composition (data-composition-id="main")
  composition.json      manifest cho renderer (timing, audio clips, tuỳ chọn)
  lib/                  hyperframe.runtime.iife.js, gsap.min.js, tvs-hf.css, *.mjs
  assets/audio/         audio từng cảnh
        │
        ├──► npx hyperframes render (máy có FFmpeg)      [tuỳ chọn]
        │
        ▼
engine/render_video.mjs --engine hyperframes (mặc định)
        │  Chrome headless (raw CDP): N tab worker seek + chụp JPEG/PNG
        │  1 tab encoder: WebCodecs H.264/HEVC/VP9 + mp4-muxer/webm-muxer
        │  audio: decode + WSOLA time-stretch + mix + AAC/Opus
        ▼
<COURSE>/episodes/<EP>/<output>.mp4|webm
```

### 3.1 Bản đồ file

| File | Vai trò |
|---|---|
| `engine/hyperframes/compiler.mjs` | Node: payload tập → project HyperFrames (timing, Shiki, audio, HTML, `composition.json`) |
| `engine/hyperframes/audio_probe.mjs` | Đo thời lượng WAV/MP3 thuần JS (Xing/Info/VBRI hoặc quét frame) |
| `engine/hyperframes/runtime/tvs-hf-main.mjs` | Bootstrap trong trình duyệt: nền, progress bar, top bar, envelope cảnh, sparkle, phụ đề, gọi builder, đăng ký `window.__timelines.main` |
| `engine/hyperframes/runtime/tvs-hf-common.mjs` | Helper cho builder: `el`, `svg`, `icon`, `reveal`, `stamp`, `typewriter`, `blink`, `drawPath`, `rng`, `formatNumber`, `STAGE`, `EASE`, `DUR` |
| `engine/hyperframes/runtime/tvs-hf.css` | Token màu, layer, top bar, phụ đề, primitive (`.tvs-badge`, `.tvs-card`) |
| `engine/hyperframes/runtime/scenes/<visual_type>.mjs` | 7 template DOM + GSAP (một module / template) |
| `engine/hyperframes/bridge.mjs` | Script render-mode (`__hf.seek` → `__player.renderSeek`) + biểu thức ready/seek |
| `engine/hyperframes/cdp.mjs` | Chrome launcher + CDP client zero-dep (dùng chung renderer/snapshot) |
| `engine/hyperframes/studio_server.mjs` | Dùng lại / bật tạm `server.mjs`, đọc payload `GET /api/courses` |
| `engine/hyperframes/snapshot.mjs` | Chụp PNG tại các mốc thời gian + kiểm tra determinism |
| `engine/hyperframes/fixtures/make_demo_course.mjs` | Tạo khoá demo `HFDEMO` đủ 7 template + audio tổng hợp |
| `engine/public/vendor/raw/...` | `hyperframe.runtime.iife.js` (+ LICENSE) và `gsap.min.js`, pin SHA-256 trong `vendor_libs.mjs` |

---

## 4. Project HyperFrames được sinh ra

```
<COURSE>/episodes/<EP>/hyperframes/
├── index.html              # root composition
├── composition.json        # manifest cho renderer
├── lib/
│   ├── hyperframe.runtime.iife.js   # @hyperframes/core 0.9.59 (CLI chính thức sẽ thay bằng bản verified của nó)
│   ├── HYPERFRAMES_LICENSE.txt      # Apache-2.0
│   ├── gsap.min.js                  # GSAP 3.15.1 UMD → window.gsap
│   ├── tvs-hf.css · tvs-hf-main.mjs · tvs-hf-common.mjs
│   ├── kernel.mjs · icons.mjs       # chép nguyên từ engine/src (layout DAG, state helpers, icon)
│   └── scenes/*.mjs                 # 7 builder
└── assets/audio/NN-<scene>.mp3|wav  # audio từng cảnh (chép từ voice track đang active)
```

Cấu trúc `index.html` (rút gọn):

```html
<script data-hyperframes-preview-runtime src="./lib/hyperframe.runtime.iife.js"></script>
<script src="./lib/gsap.min.js"></script>
<div id="root" data-composition-id="main" data-start="0" data-duration="49" data-width="1920" data-height="1080">
  <div class="tvs-bg"></div>  <div id="tvs-ambient"></div>                      <!-- nền + bokeh -->
  <section id="scene-0" class="clip tvs-scene" data-start="0" data-duration="7" data-track-index="1"
           data-scene-id="s1_architecture" data-visual-type="architecture"></section>   <!-- track 1: cảnh -->
  …
  <div id="tvs-fx"></div>                                                       <!-- sparkle -->
  <div class="tvs-subtitles">
    <div id="sub-0-0" class="clip tvs-subtitle" data-start="0" data-duration="3.38" data-track-index="2">…</div>
  </div>                                                                        <!-- track 2: phụ đề -->
  <div class="tvs-progress"><div id="tvs-progress-fill"></div></div>
  <audio id="audio-0" src="assets/audio/01-s1_architecture.wav" data-start="0" data-duration="7"
         data-media-start="0" data-volume="1" data-track-index="10"></audio>    <!-- track 10: lời đọc -->
</div>
<script type="application/json" id="tvs-episode-data">{…scenes, timing, episode…}</script>
<script type="module" src="./lib/tvs-hf-main.mjs"></script>
```

Quy tắc thời gian:

- Thời lượng cảnh = thời lượng audio thật (đo bằng `audio_probe.mjs`) ÷ `speed`; không có audio thì
  `duration_sec` ÷ `speed` (mặc định 5s). Tốc độ được "nướng" vào timeline (`data-playback-rate` trên
  `<audio>` khi `speed ≠ 1`).
- Phụ đề: mốc trong `scene.subtitles[]` (`start_sec/end_sec` hoặc `start/end`, giây audio 1x) ÷ `speed`;
  hiển thị tới `end + 0.15s` như engine cũ, cắt trước cue kế tiếp và cuối cảnh.
- Code `code_cli` được tô màu bằng Shiki (tokyo-night) **lúc compile** → `scene.code = { lang, base,
  snapshots[{ lines, tokens[[{ t, c, s }]] }], phase_snapshot[] }` (`s` = Shiki fontStyle bitmask).

---

## 5. Hợp đồng runtime trong trình duyệt

1. Runtime HyperFrames chạy trước (classic script trong `<head>`), tạo `window.__timelines`.
2. `tvs-hf-main.mjs` đọc `#tvs-episode-data`, chờ `document.fonts.ready`, **import động** builder của
   các `visual_type` có mặt (module hỏng chỉ làm hỏng cảnh của nó → placeholder lỗi + `window.__tvsBuildErrors`).
3. Dựng: nền + 22 bokeh (wrap bằng `modifiers`, nhấp nháy `repeat` hữu hạn), progress bar (`scaleX` 0→1),
   mỗi cảnh: `.tvs-scene-inner` (top bar + `.tvs-stage`) → builder → envelope (reveal 267ms blur 20→0 /
   scale .94→1; exit 200ms; breather 140ms) → sparkle tại mỗi lần đổi `getSceneBurstInfo().key`.
4. Đệm timeline đúng bằng `data-duration` (`tl.set({}, {}, total)`), đăng ký
   `window.__timelines["main"] = tl`, đặt `window.__tvsReady = true`.

Kiểm chứng (2026-11-17): runtime báo `__player.getDuration() = 49`, `__renderReady = true`,
`__hfWaitForSeekCompletion` có sẵn; seek xuôi/ngược cho ảnh trùng từng pixel.

---

## 6. Hợp đồng scene module (cho người viết template)

```js
// engine/hyperframes/runtime/scenes/<visual_type>.mjs
export default function build(ctx) { … }
```

`ctx`:

| Trường | Ý nghĩa |
|---|---|
| `gsap`, `tl` | GSAP và **master timeline** (paused) — mọi tween thêm vào `tl` ở **thời điểm tuyệt đối** |
| `common` | module `tvs-hf-common.mjs` (`el`, `svg`, `icon`, `reveal`, `stamp`, `typewriter`, `blink`, `drawPath`, `roughStrikePath`, `roughEllipsePath`, `sparklinePoints`, `formatNumber`, `rng`, `hashString`, `mark`, `getTone`, `palette`, `EASE`, `DUR`, `STAGE`, `FRAME_W/H`) |
| `scene`, `vd` | scene đã compile và `scene.visual_data` (`scene.code` cho `code_cli`) |
| `start`, `dur` | giây tuyệt đối bắt đầu cảnh và thời lượng (giây output) |
| `at(p)` | `start + clamp01(p) * dur` — đổi `progress_*` trong `visual_data` sang giây tuyệt đối |
| `stage` | `div.tvs-stage` (absolute, 1744×772 tại x=88, y=128) — nơi dựng nội dung |
| `sceneEl` | `.tvs-scene-inner` 1920×1080 (cho overlay toàn khung, ví dụ con trỏ) |
| `index`, `seed`, `data` | chỉ số cảnh, seed ổn định, dữ liệu tập |

Quy tắc bắt buộc (determinism của HyperFrames):

1. **Không** `Math.random`, `Date`, `performance.now`, `requestAnimationFrame`, `setTimeout`,
   `setInterval`; **không** callback GSAP (`onUpdate`, `onComplete`, `call`) — HyperFrames seek bằng
   `totalTime(t, suppressEvents)`. Số đếm (counter) dùng `innerText` + `snap`/`modifiers`.
2. Mọi tween đặt bằng vị trí tuyệt đối (`tl.fromTo(el, from, to, ctx.at(0.3))`), kết thúc ≤ `start + dur`.
   Không `repeat: -1` (dùng `common.blink` / repeat hữu hạn).
3. **From-state của tween sớm nhất trên một phần tử chính là thứ hiển thị trước khi tween bắt đầu**
   (`immediateRender`). Vì vậy tween đầu tiên phải đi từ trạng thái "trước sự kiện" (thường là ẩn:
   `autoAlpha: 0`). Các thay đổi sau đó dùng `tl.to(...)` hoặc `fromTo(..., { immediateRender: false })`.
4. Layout cố định theo `common.STAGE` (đừng đo `clientWidth` — clip có thể đang bị runtime ẩn).
   Đo chữ bằng canvas `measureText` thì được (fonts đã sẵn sàng).
5. CSS riêng của template: chèn một `<style id="tvs-style-<template>">` (xem `comparison_matrix.mjs`),
   prefix class theo template để không đụng nhau.
6. Kiểm tra: `node engine/hyperframes/snapshot.mjs --course <C> --episode <EP> --scene <idx> --at 0.1,0.5,0.9
   --scale 0.5 --check-determinism` phải in `OK: 0 console/page errors`.
7. Bài học rút ra khi viết 7 template (2026-11-17):
   - **Layer raster của Chrome**: phần tử đang di chuyển sub-pixel bằng `transform` có thể bị nâng thành
     compositor layer; raster của layer đó bị dùng lại ở offset cũ ⇒ chữ mờ và pixel khác nhau theo thứ tự
     seek. Bootstrap đặt `gsap.config({ force3D: false })` (transform 2D) và CSS không dùng `will-change`.
     Hộp lớn chứa chữ nên reveal bằng opacity/blur; phần chuyển động dài dùng `top/left/width/clip-path`.
   - Không để lại `filter: blur(0px)` sau khi reveal xong (`common.reveal` và envelope tự đặt `filter: none`).
   - Không dùng ease có overshoot cho `filter` (blur âm là CSS không hợp lệ ⇒ frame cũ bị giữ).
   - Counter: tween `innerText` với `snap` + `modifiers`; `modifiers` không chạy ở lần render đầu ⇒ dùng
     `immediateRender: false` và đặt sẵn text "0" đã format.
   - `to()` ghi giá trị bắt đầu một cách lười ⇒ lệch ~1e-5 tuỳ thứ tự seek; với phần tử có nhiều tween
     liên tiếp, dùng `fromTo` với giá trị bắt đầu tường minh (`immediateRender: false`).
   - Tránh box-shadow blur lớn, `outline`, chữ xoay, `overflow:hidden` + `border-radius` sát nội dung động
     (nhiễu raster). `common.drawPath` không truyền `length` sẽ dùng `pathLength="1"`.

Template tham chiếu: `runtime/scenes/comparison_matrix.mjs`.

### 6.1 Ghi chú từng template (khác biệt có chủ đích so với Canvas 2D cũ)

| Template | Ghi chú |
|---|---|
| `architecture` | Cùng `computeArchitectureLayout` (hộp 1780×780 tại 70,126, card 244×150). Packet chạy vòng khớp step, dashed edge chảy suốt cảnh, mũi tên hiện khi vẽ xong, nhãn dài co tới 18px rồi xuống 2 dòng, icon vector. Không có `camera_focus` ⇒ giữ hành vi cũ (zoom 1.1 vào tâm node active; đổi `AUTO_FOCUS=false` đầu file để về trung tính). Trước step đầu: trạng thái trung tính; khoảng trống giữa các step giữ step trước. |
| `console_setup` | Khung trình duyệt + nav + stepper; field `text` gõ chữ có caret, `radio`, `checkbox_row`; `highlight` có spotlight + brackets; con trỏ lướt & click (56–82% / 84% step). Trước step đầu hiển thị step 1 (engine cũ hiện step cuối). |
| `code_cli` | Shiki tokens, morph cấp dòng khi `code_override`, annotate (gạch chân vàng / khung đỏ khi `accent` là `danger`/`red`), terminal gõ lệnh + output, lỗi đỏ + banner; `type_duration` theo đơn vị progress (giá trị > 1 hiểu là giây). Phase không có `code_override` quay về `code_lines` (giống engine cũ). |
| `comparison_matrix` | Hàng mờ 0.14 trước khi reveal, khung active trượt giữa các hàng, takeaway ở `show_at_progress`. |
| `exam_tips` | Gạch ngang tay vẽ trên đáp án sai, khoanh elip đáp án đúng; quiz **tự lộ đáp án** (~42% thời gian còn lại sau khi quiz hiện, tối thiểu 0.9s) — tuỳ chỉnh bằng trường mới tuỳ chọn `quiz.reveal_at_progress`; nhãn đề lấy từ `badge` (hoặc `quiz.tag`). |
| `timeline_flow` | Ngang/dọc, trạng thái pending/active/done theo đúng ngưỡng `computeTimelineFlowState`, rail vẽ theo đoạn giữa các mốc. |
| `kpi_metrics` | Counter seek-safe (frame cuối hiển thị đúng `value`), sparkline vẽ dần, bar chart + nhãn đếm, stamp nằm ở dải tiêu đề chart (hoặc khoảng trống dưới card), slam ~0.35s. |

---

## 7. Renderer zero-dependency (`engine/hyperframes/render.mjs`)

Luồng một lần render:

1. `ensureStudioServer(port)` — dùng server đang chạy hoặc bật tạm `server.mjs`; đọc payload tập từ
   `GET /api/courses` (voice track đang active đã được server áp vào `script.json`).
2. `compileEpisodeProject()` → `<ep>/hyperframes/` (xem §4). `totalFrames = ceil(total × fps)`.
3. Chrome headless (raw CDP, `cdp.mjs`):
   - **Encoder tab** mở `/public/hf-encoder.html` → `engine/src/hf_encoder.mjs`:
     `resolveWebCodecsProfile()` (dùng chung với engine cũ), muxer vendored, giải mã + resample
     48 kHz stereo + time-stretch WSOLA (khi `speed ≠ 1`) + trộn mọi `<audio>` theo `data-start`,
     cắt theo `data-duration`; AAC (MP4) / Opus (WebM).
   - **N worker tab**, mỗi tab một *browser context* riêng (renderer process riêng):
     `Emulation.setDeviceMetricsOverride(1920×1080, deviceScaleFactor = width/1920)` → 720p…4K;
     `Page.addScriptToEvaluateOnNewDocument(buildRenderBridgeScript({ fps }))` đặt
     `__HF_EXPORT_RENDER_SEEK_CONFIG.fps` (canonical fps của runtime — nếu không runtime lượng tử hoá
     seek theo 30fps và video 60fps sẽ bị lặp frame) và cầu `__hf.seek → __player.renderSeek`;
     chờ `__hf.duration > 0 && __tvsReady`; lỗi build ⇒ dừng render.
4. Frame `i` (thời điểm `i / fps`) giao cho worker `i mod N`; worker: `__hf.seek(t)` →
   `await __hfWaitForSeekCompletion()` → `Page.captureScreenshot` (JPEG q92 `optimizeForSpeed`, hoặc
   PNG). Bộ điều phối đẩy frame **đúng thứ tự** sang encoder qua `Runtime.callFunctionOn`
   (`createImageBitmap` → `VideoFrame` → `VideoEncoder`), audio được encode xen kẽ; cửa sổ trượt
   `3 × N` frame giữ RAM ổn định.
5. `finish()` flush + mux + `POST /api/save-video` → file nằm ở `<ep>/<output>.mp4|webm` như cũ;
   `render_video.mjs` kiểm tra file tồn tại, > 0 byte, 0 lỗi console/page.

Hiệu năng đo được (i5-1135G7, 4C/8T, 2026-11-17, 3 agent khác đang chạy Chrome song song):
49s demo, 720p30, 2 worker → **1470 frame, ~17 frame/s capture, 95s**. Số worker mặc định =
`min(4, floor(CPU/3))`, chỉnh bằng `--workers 1..8`.

---

## 8. Cách dùng

```powershell
# Render mặc định (HyperFrames)
node "engine/render_video.mjs" --course <COURSE> --episode <EP_ID> [--format mp4|webm] [--resolution 720p|1080p|1440p|2160p] [--fps 24|30|60] [--speed 1|1.25|1.5|2] [--output <tên>] [--workers 1..8] [--capture-format jpeg|png] [--jpeg-quality 50..100]

# Chỉ biên dịch project HyperFrames (để xem / sửa / render bằng CLI chính thức)
node "engine/render_video.mjs" --course <COURSE> --episode <EP_ID> --compile-only
#   → mở http://localhost:3030/courses/<COURSE>/episodes/<EP_ID>/hyperframes/index.html

# Chụp nhanh khung hình + kiểm tra determinism
node "engine/hyperframes/snapshot.mjs" --course <COURSE> --episode <EP_ID> --scene 2 --at 0.1,0.5,0.9 --scale 0.5 --check-determinism

# Kiểm tra file video đã render (thời lượng, kích thước, audio không câm, trích frame)
node "engine/hyperframes/verify_video.mjs" --course <COURSE> --episode <EP_ID> --file <EP_ID>.mp4 --frames 3,30

# Khoá demo đủ 7 template
node "engine/hyperframes/fixtures/make_demo_course.mjs" --course HFDEMO

# Cập nhật / kiểm tra file vendor (runtime HyperFrames + GSAP UMD)
node "engine/scripts/vendor_libs.mjs" --raw-only
node "engine/scripts/vendor_libs.mjs" --verify-only
```

Studio (`http://localhost:3030`, popover **🎬 Xuất Video ▾**): nhóm **Engine render** chọn
`HyperFrames (DOM + GSAP)` (mặc định) hoặc `Canvas 2D cũ (nhanh)`; giá trị gửi qua
`POST /api/jobs/run-production` trường `engine` → `render_video.mjs --engine`. Biến môi trường
`TVS_RENDER_ENGINE=legacy` đổi mặc định cho cả CLI và server.

---

## 9. Fallback engine cũ

`node "engine/render_video.mjs" --engine legacy ...` chạy nguyên đường Canvas 2D trước đây
(`window.__STUDIO_RENDER_OFFLINE__` trong `engine/src/exporter.mjs`, MediaRecorder dự phòng khi
không có WebCodecs). Không bị thay đổi hành vi; chỉ export thêm `loadMuxerModule`,
`saveVideoToServer`, `EXPORT_AUDIO_SAMPLE_RATE`, `EXPORT_AUDIO_CHANNELS` để encoder HyperFrames dùng chung.
Timeout mặc định của engine HyperFrames gấp 4 lần engine cũ (CLI và job server).

---

## 10. Render bằng CLI HyperFrames chính thức (tuỳ chọn, ngoài guardrail)

Trên máy **được phép** cài FFmpeg + npm (không phải máy dev Windows có Application Control):

```bash
node engine/render_video.mjs --course <COURSE> --episode <EP_ID> --compile-only
cd <COURSE>/episodes/<EP_ID>/hyperframes
npx hyperframes lint
npx hyperframes render --output ../<EP_ID>.mp4 --fps 30 --quality high
```

CLI chính thức tự strip `lib/hyperframe.runtime.iife.js` (thuộc tính `data-hyperframes-preview-runtime`)
và inject runtime đã verify của nó; mix audio từ các thẻ `<audio>` (lưu ý: `data-playback-rate` của
HyperFrames có thể không giữ cao độ như WSOLA của mình khi `speed ≠ 1`).

---

## 11. Kiểm thử

| Lệnh | Nội dung |
|---|---|
| `node engine/test_hyperframes.mjs` | vendor pin, `audio_probe` (WAV + MP3 CBR), `computeTimeline`, 6 SFX WAVs + pure-JS BS.1770 `-16 LUFS` DSP, hợp đồng HTML/manifest (SVG/SFX/overlap), Shiki tokens, runtime build 7 template 0 lỗi + determinism, mixed Light/Dark + `causal_mechanic` + `SharpTag` + `bgm.wav` determinism, render MP4 720p24 thật + verify (1280×720, 17.5s ±0.15, RMS > 0, **`-16.02 LUFS`**) |
| `node engine/test_hyperframes.mjs --skip-render` | như trên, bỏ bước render |
| `node engine/test_phase1_three_stage.mjs` | dynamic per-role routing, 3-stage `brief -> dialogue -> audio_spine -> script`, Dual-Text TTS |
| `node engine/test_ai_bridge_and_templates.mjs` | test tổng 17 phần: mục 6 render cả **HyperFrames (mặc định)** lẫn **`--engine legacy`** |

Cách `snapshot --check-determinism` hoạt động: chụp các mốc theo thứ tự xuôi, seek tới cuối composition
rồi đi ngược lại; so **trạng thái hiệu lực** của mọi phần tử đang hiển thị (computed `opacity`,
`transform`, `filter`, màu, kích thước, `clip-path`, thuộc tính SVG `d/points/…`, text lá). Khác trạng
thái ⇒ lỗi. Cùng trạng thái nhưng khác pixel ⇒ chỉ cảnh báo "raster-only pixel noise" (khử răng cưa /
tiling của Chrome; khi kiểm tra Chrome chạy `--disable-gpu-rasterization` để giảm nhiễu). Phần tử bị ẩn
(cảnh khác) được bỏ qua vì có thể giữ giá trị tween chưa render khác nhau mà không ảnh hưởng hình.

Kết quả 2026-11-19 (Phase 2 Visual Grammar, SFX Bus & `-16 LUFS` Post-Mix):

- `node engine/test_hyperframes.mjs` → **8/8 PASS** (6 SFX WAVs 48kHz, pure-JS BS.1770 `-28.64 → -16 LUFS`, 7/7 template determinism, fixture `ep02-phase2` Light/Dark + `causal_mechanic` + `SharpTag` + `bgm.wav` determinism 0 lỗi, render `hf-e2e.mp4` `1280×720`, `17.51s`, `rms 0.122`, **`-16.02 LUFS`**).
- `node engine/test_phase1_three_stage.mjs` → **`ALL PHASE 1 TESTS PASSED!`**.
- `node engine/test_ai_bridge_and_templates.mjs` → **`ALL TESTS PASSED!`** (17/17 phần, HyperFrames WebM `918 KB` + legacy WebM `918 KB`).

### 11.1. Tóm tắt nâng cấp Phase 2 (2026-11-19)

- **Visual Grammar & Smart Transitions (`tvs-hf.css`, `tvs-hf-common.mjs`, `tvs-hf-main.mjs`, `compiler.mjs`):**
  - Chuyển động nền `.tvs-bg-grid` (wrap modulo `60px`) + `creepZoom` (`1.0 → 1.015`, `force3D: false`).
  - Hỗ trợ `world_theme: "dark" | "light"` (`.tvs-bg-light` / `.tvs-scene--light`), `SharpTag` (`sharpTag()`), `CAUSAL_MECHANICS` (`blur-materialize`, `wire-draw`, `width-push`, `arc-emission`, `squash-drop`, `typographic-strike`) kèm reset `filter`/`clipPath` 0s bằng `fromTo` để giữ determinism khi seek ngược.
  - Tự động chồng lấn chuyển cảnh mượt (`min(0.45s, nextDuration * 0.22)`) giữa các scene cùng `part`, giữ `dark breather` (`140ms`) tại ranh giới chuyển `part`.
  - Hỗ trợ ảnh SVG đa sắc `node.svg` từ `engine/assets/svg/` trong `scenes/architecture.mjs`.
- **Programmatic SFX Bus, Vocal-Carve BGM & Pure-JS `-16 LUFS` (`audio_dsp.mjs`, `hf_encoder.mjs`, `render.mjs`, `verify_video.mjs`):**
  - 6 file 48kHz PCM WAV trong `engine/assets/sfx/` (`whoosh_short`, `pop`, `click`, `typing_fast`, `impact`, `chime`) phát theo `sfx_cues` / auto-derive với lead `-33ms`; `bgm_file` tùy chọn được cắt EQ `1800Hz -6dB Q=1.4` qua `OfflineAudioContext`.
  - Đo & chuẩn hóa BS.1770-4 K-weighted về `-16 LUFS` kèm soft limiter (`0.8414` ≈ `-1.5 dBTP`) thuần JS (Zero FFmpeg), đo lại trực tiếp trong `verify_video.mjs`.

---

## 12. Giới hạn & việc tiếp theo

- Capture DOM chậm hơn Canvas 2D (mỗi frame là một lần seek + screenshot); dùng `--workers`, 30fps
  hoặc `--engine legacy` khi cần nhanh. HyperFrames dùng `HeadlessExperimental.beginFrame` trên Linux
  để nhanh hơn — chưa áp dụng (Windows không hỗ trợ).
- Font: dùng font hệ thống (`Be Vietnam Pro` nếu đã cài, fallback `Segoe UI`); chưa nhúng webfont vào
  project nên render trên máy khác có thể khác font.
- Studio Player (Screen 3) vẫn preview bằng component React hiện có; composition HyperFrames xem
  trực tiếp qua URL `…/hyperframes/index.html` hoặc HyperFrames Studio.
- `data-playback-rate` + CLI chính thức: xem §10.

---

## 10. Nguồn tham khảo

- Repo: https://github.com/heygen-com/hyperframes
- Docs index: https://hyperframes.heygen.com/llms.txt
- HTML schema: https://hyperframes.heygen.com/reference/html-schema.md
- Frame adapters: https://hyperframes.heygen.com/concepts/frame-adapters.md
- Determinism: https://hyperframes.heygen.com/concepts/determinism.md
- Rendering: https://hyperframes.heygen.com/guides/rendering.md
- CLI: https://hyperframes.heygen.com/packages/cli.md
- Runtime package: https://www.npmjs.com/package/@hyperframes/core (file `dist/hyperframe.runtime.iife.js`)
