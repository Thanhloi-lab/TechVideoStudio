---
name: video-renderer
description: Monitor courses via the 3-screen Dashboard (localhost:3030), manage Voice Studio & Revision Queue workflows, render 16:9 Full HD tutorial videos headlessly with render_video.mjs, and verify outputs against state_cli.mjs.
---

# Video Renderer (Conversation 3)

Use this skill to discover `script_ready` or `production.stale` episodes, synthesize/re-synthesize voiceovers (via CLI or Studio Web UI), render 1920x1080 videos offline via headless Chrome (`render_video.mjs`), handle revision tickets, and verify final outputs.

**Model Allocation:** Run video execution, TTS synthesis, headless rendering, and verification on **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).

## Step 1: Discover Production Queue, Revisions & Verify Assets

Check which episodes have completed scripting, have `production.stale === true` (after a script or voice change), or have open `production` revision tickets:
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> --status open
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" next --course <COURSE_CODE> --stage production --limit 5
```
Ensure each target episode folder contains:
- `script.json` with populated `duration_sec` and `subtitles` (run `tts_pipeline.py --episode ... --course ...` first if missing or if `production.stale` is due to a voice/script update — see [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md))
- `audio/*.mp3` (or `audio/*.wav` for custom WAV providers) for every scene (non-empty)
- `subtitles.srt` and `notes.md`

## Step 2: Automated Headless Batch Rendering (`render_video.mjs`)

Use the pure-Node headless Chrome renderer. The default engine is **HyperFrames** (see [`HYPERFRAMES_ENGINE.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/HYPERFRAMES_ENGINE.md)): the episode is compiled into a HyperFrames project (`<ep-slug>/hyperframes/index.html`, DOM + GSAP templates, official vendored `hyperframe.runtime.iife.js`), featuring **Phase 2** Light/Dark themes (`world_theme`), smart same-`part` overlaps (`140ms` dark breathers), procedural SFX bus (`engine/assets/sfx/*.wav`, `-33ms` lead), vocal-carved `bgm_file` (`1800Hz -6dB` via `OfflineAudioContext`), and pure-JS **ITU-R BS.1770-4 `-16 LUFS`** loudness normalization + soft limiter (`audio_dsp.mjs`, `hf_encoder.mjs`). It is captured frame-by-frame through the HyperFrames seek protocol in headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH`) and encoded with WebCodecs H.264/HEVC/VP9 + AAC/Opus. It auto-starts `server.mjs` if port `3030` is not listening and never invokes FFmpeg, npm or other unsigned `.exe` wrappers. `--engine legacy` keeps the previous Canvas 2D exporter:

```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status rendering --owner "<agent>"
node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --port 3030 [--check-layout|--no-check-layout] [--qc-strict]
```
*(Optional: `--format mp4|webm`, `--codec h264|hevc|vp9`, `--resolution 720p|1080p|1440p|2160p`, `--fps 24|30|60`, `--speed 1|1.25|1.5|2`, `--workers 1..8`, `--engine legacy`, `--compile-only`, `--check-layout` (default on HyperFrames), `--no-check-layout`, `--qc-strict`.)*

With the HyperFrames engine, `render_video.mjs` compiles `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/hyperframes/`, runs the **Phase 3 DOM Layout & Safe-Zone QC Gate** (`engine/hyperframes/layout_qc.mjs` checking `viewport_overflow`, `stage_overflow`, `topbar_collision`, `subtitle_collision`, `subtitle_overflow`, `clipped_text` across `[0.1, 0.5, 0.9]`), opens N isolated capture tabs + one WebCodecs encoder tab (`/public/hf-encoder.html`), uploads the video via `POST /api/save-video` into `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/<ep-slug>.mp4` (or `.webm`), verifies `size > 0` and zero console/page/build errors. Quick visual & layout QC checks before/after render:

```powershell
node "{{WORKSPACE_ROOT}}/engine/hyperframes/snapshot.mjs" --course <COURSE_CODE> --episode <ep-slug> --scene <N> --at 0.1,0.5,0.9 --scale 0.5 --check-determinism [--check-layout] [--qc-strict]
node "{{WORKSPACE_ROOT}}/engine/hyperframes/verify_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --file <ep-slug>.mp4 --frames 3,30 [--check-layout] [--qc-strict]
```

*(Alternative Web UI Flow: In Screen 3 Studio Player, users can click **`🎙️ Tạo Audio (TTS)`** or use **`🎬 Xuất Video ▾`** directly via `POST /api/jobs/run-production`, watching live SSE `job_update` progress without leaving the browser.)*

## Step 3: Verify, Resolve Revisions & Mark Production Completed

1. Verify the rendered video file exists and is non-empty (plus `-16 LUFS` audio & optional `--check-layout` via `verify_video.mjs`), and confirm the Studio Player (`http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player`) loads with zero console/page errors.
2. If you fixed an open `production` revision ticket (`REV-XXX`), resolve it first, then mark production completed (which clears `production.stale = false`):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" resolve-revision --course <COURSE_CODE> --ep <ep-slug> --rev <REV_ID> --note "Re-synthesized and re-rendered"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status completed --video-done true --verified true --note "Rendered and verified in headless Chrome"
   ```
3. If a **script or visual diagram defect** is discovered during rendering/verification, file a structured ticket so Conversation 2 fixes it cleanly:
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" add-revision --course <COURSE_CODE> --ep <ep-slug> --scope script --scene <scene_id> --desc "<exact defect>" --owner "<agent>"
   ```

## Step 4: 3-Screen Dashboard, Revision Queue & Voice Studio (`http://localhost:3030`)

Start the pure-Node Studio server if not already running:
```powershell
node "{{WORKSPACE_ROOT}}/engine/server.mjs"
```
Verify `/api/courses` returns HTTP 200. Open `http://localhost:3030` to use the 3-screen Studio UI (live-synced via SSE `GET /api/stream`):
1. **Screen 1 — Project Dashboard (`view=projects`)**: Overview cards per course with segmented progress bars (`Scripted`, `Processing`, `Completed`, `Needs Revision`) and open revision counts.
2. **Screen 2 — Episode Roadmap & Live Monitor (`view=roadmap`)**:
   - Stage-grouped episode cards with dual Scripting/Video status icons, `production.stale` (`🔄 Cần render lại`) indicators, **`ScriptingStageModal`** (for 3-stage `brief.json` / `dialogue.json` / `audio_spine.json` review), and **`⚠️ Yêu cầu sửa`** (`RevisionModal` with `scope`, `scene_id`, and custom description).
   - Topbar **`🤖 AI Worker & Models`** (`BrandHealthGrid` + **`RoleRoutingPanel`** `🧭 Định tuyến AI theo vai trò` for `outliner`, `brief_scriptwriter`, `visual_director`, `repair` via `POST /api/ai/preferences/routing`) and **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal`) to browse `voices.json`, probe VoiceStudio (`localhost:8000`), preview sample audio, add custom HTTP/VoiceStudio profiles, and assign the course default voice.
   - Right panel tabs: `📡 Live Activity` (`/api/events`), `🗺️ curriculum.md`, and **`🛠️ Yêu cầu sửa`** (`RevisionPanel` filterable queue where clicking any ticket deep-links directly to `?view=player&scene=<scene_id>`).
3. **Screen 3 — Studio Player (`view=player`)**:
   - 16:9 stage with synchronized voiceover, V2 box-free subtitles, Storyboard Preview Mode, deep-link `&scene=<scene_id>`, `notes.md`, and `curriculum.md`.
   - **`🛠️ Sửa`** drawer tab (`Copy Prompt cho Agent` grouped by `script`/`visual` vs `production`, **`🔄 Gửi AI Sửa Kịch Bản`**, Resolve/Reopen/Delete, and **`▶ Chạy lại TTS & Render ngay`**).
   - Episode Voice override picker, Multi-Voice A/B Switcher, unified **`🎬 Xuất Video ▾`** popover, **`📁 Video đã xuất`** gallery, and direct **`🎙️ Tạo Audio (TTS)`** (`POST /api/jobs/run-production` with live SSE `job_update` progress).
