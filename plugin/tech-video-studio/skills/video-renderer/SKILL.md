---
name: video-renderer
description: Monitor courses via the 3-screen Dashboard (localhost:3030), synthesize/reuse TTS tracks, render 16:9 Full HD tutorial videos headlessly with HyperFrames (default 30fps, --part support for 5-minute preview parts), and verify outputs against state_cli.mjs.
---

# Video Renderer (Conversation 3)

Use this skill to discover `script_ready` or `production.stale` episodes, synthesize/re-synthesize voiceovers (via CLI or Studio Web UI), render 1920x1080 videos offline via headless Chrome (`render_video.mjs` + **HyperFrames**, sole render engine), handle revision tickets, and verify final outputs.

**Model Allocation:** Run video execution, TTS synthesis, headless rendering, and verification on **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`).

## Step 1: Discover Production Queue, Revisions & Verify Assets

Check which episodes have completed scripting, have `production.stale === true` (after a script or voice change), or have open `production` revision tickets:
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" revisions --course <COURSE_CODE> --status open
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" next --course <COURSE_CODE> --stage production --limit 5
```
Ensure each target episode (or preview `--part <part_id>`) contains:
- `script.json` (or `parts/<part_id>/script.json`) with populated `duration_sec` and `subtitles`.
  - If missing or `production.stale` is due to a voice/script update, run `tts_pipeline.py --episode ... --course ...` (see [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md)).
  - **Audio-Spine Beat Reuse:** If `audio_spine.json` exists alongside matching `tts_beats` (`beat_id` + normalized `tts_text` and valid beat audio files on disk) for the active voice profile, `tts_pipeline.py` concatenates those beat chunks directly with **zero duplicate TTS calls** (`reused_scenes` reported in `--json` output) and aligns cues across all **11 visual templates**.
  - **Merged Parts Reuse:** After `state_cli.mjs merge-parts`, if every part already had TTS generated, `script.json` points cleanly to `parts/<part_id>/audio/...` and `subtitles.srt` already carries cumulative offsets — no redundant TTS synthesis is needed!
- `audio/<profile_id>/*.mp3` (or `.wav`) for every scene (non-empty)
- `subtitles.srt` and `notes.md`

## Step 2: Automated Headless Rendering (`render_video.mjs` — HyperFrames Only, Default 30fps)

Use the pure-Node headless Chrome renderer powered exclusively by **HyperFrames** (see [`HYPERFRAMES_ENGINE.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/HYPERFRAMES_ENGINE.md)): the episode (or single `--part <part_id>`) is compiled into a HyperFrames project (`hyperframes/index.html`, 11 DOM + GSAP templates, official vendored `hyperframe.runtime.iife.js`), featuring Light/Dark themes (`world_theme`), smart same-`part` overlaps (`140ms` dark breathers), procedural SFX bus (`engine/assets/sfx/*.wav`, `-33ms` lead), vocal-carved `bgm_file` (`1800Hz -6dB` via `OfflineAudioContext`), and pure-JS **ITU-R BS.1770-4 `-16 LUFS`** loudness normalization + soft limiter (`audio_dsp.mjs`, `hf_encoder.mjs`). It is captured frame-by-frame through the HyperFrames seek protocol in headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH`) and encoded with WebCodecs H.264/HEVC/VP9 + AAC/Opus. It auto-starts `server.mjs` if port `3030` is not listening and never invokes FFmpeg, npm, or unsigned `.exe` wrappers.

**Full Merged Episode Render (Default `30fps`):**
```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status rendering --owner "<agent>"
node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --port 3030 [--fps 30] [--check-layout|--no-check-layout] [--qc-strict]
```

**Single `<= 5m` Part Preview Render (`--part <part_id>`):**
Compile and render a single part (`parts/<part_id>/script.json` -> `parts/<part_id>/<part_id>.mp4`) before approving or merging:
```powershell
node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --part part_01 --fps 30 [--check-layout] [--qc-strict]
```

*(Options: `--part <part_id>`, `--format mp4|webm`, `--codec h264|hevc|vp9`, `--resolution 720p|1080p|1440p|2160p`, `--fps 24|30|60` [default `30`], `--speed 1|1.25|1.5|2`, `--workers 1..8`, `--compile-only`, `--check-layout` [default on], `--no-check-layout`, `--qc-strict`. Legacy Canvas 2D rendering is removed.)*

`render_video.mjs` compiles `hyperframes/`, runs the **DOM Layout & Safe-Zone QC Gate** (`engine/hyperframes/layout_qc.mjs` checking `viewport_overflow`, `stage_overflow`, `topbar_collision`, `subtitle_collision`, `subtitle_overflow`, `clipped_text` across `[0.1, 0.5, 0.9]`), scales timeouts cleanly for 15–25m deep-dive episodes, opens N isolated capture tabs + one WebCodecs encoder tab (`/public/hf-encoder.html`), uploads via `POST /api/save-video`, and verifies `size > 0` with zero console/page/build errors. Quick visual & layout QC checks before/after render:

```powershell
node "{{WORKSPACE_ROOT}}/engine/hyperframes/snapshot.mjs" --course <COURSE_CODE> --episode <ep-slug> [--part part_01] --scene <N> --at 0.1,0.5,0.9 --scale 0.5 --check-determinism [--check-layout] [--qc-strict]
node "{{WORKSPACE_ROOT}}/engine/hyperframes/verify_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --file <ep-slug>.mp4 --frames 3,30 [--check-layout] [--qc-strict]
```

*(Alternative Web UI Flow: In Screen 3 Studio Player, users can switch parts, click **`🎙️ Tạo Audio (TTS)`**, or use **`🎬 Xuất Video ▾`** [default 30fps, HyperFrames] directly via `POST /api/jobs/run-production` with live SSE `job_update` progress.)*

## Step 3: Verify, Resolve Revisions & Mark Production Completed

1. Verify the rendered video file exists and is non-empty (plus `-16 LUFS` audio & `--check-layout` via `verify_video.mjs`), and confirm the Studio Player (`http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player`) loads with zero console/page errors.
2. If you fixed an open `production` revision ticket (`REV-XXX`), resolve it first, then mark production completed (clearing `production.stale = false`):
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
Verify `/api/courses` returns HTTP 200. Open `http://localhost:3030`:
1. **Screen 1 — Project Dashboard (`view=projects`)**: Overview cards per course with segmented progress bars and open revision counts.
2. **Screen 2 — Episode Roadmap & Live Monitor (`view=roadmap`)**:
   - Stage-grouped episode cards with dual Scripting/Video status icons, multi-part progress indicators, `production.stale` (`🔄 Cần render lại`) indicators, **`ScriptingStageModal`** (Part selector, `brief.json`, `dialogue.json`, `audio_spine.json`, **`review.md` tab**, **Approve Part**, **Merge Parts**), and **`⚠️ Yêu cầu sửa`** (`RevisionModal`).
   - Topbar **`🤖 AI Worker & Models`** (`BrandHealthGrid` + **`RoleRoutingPanel`** `🧭 Định tuyến AI theo vai trò` for all 5 roles: `outliner`, `brief_scriptwriter`, `content_reviewer`, `visual_director`, `repair` via `POST /api/ai/preferences/routing`) and **`🎙️ Giọng đọc Khóa học`** (`VoiceStudioModal`).
   - Right panel tabs: `📡 Live Activity`, `🗺️ curriculum.md`, and **`🛠️ Yêu cầu sửa`** (`RevisionPanel`).
3. **Screen 3 — Studio Player (`view=player`)**:
   - **Part Switcher** (preview merged full episode OR any individual `part_01..part_N`), 16:9 stage across all **11 visual templates**, V2 box-free subtitles, Storyboard Preview Mode, deep-link `&scene=<scene_id>`, `notes.md`, and `curriculum.md`.
   - **`🛠️ Sửa`** drawer tab (`Copy Prompt cho Agent`, **`🔄 Gửi AI Sửa Kịch Bản`**, Resolve/Reopen/Delete), Voice override picker, Multi-Voice A/B Switcher, unified **`🎬 Xuất Video ▾`** popover (HyperFrames, 30fps default), **`📁 Video đã xuất`** gallery, and **`🎙️ Tạo Audio (TTS)`**.
