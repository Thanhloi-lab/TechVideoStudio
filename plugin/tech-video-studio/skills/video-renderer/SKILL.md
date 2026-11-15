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

Use the pure-Node headless Chrome renderer (uses Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` or `CHROME_PATH` env var + WebCodecs VP9/H.264 offline capture with `MediaRecorder` fallback; auto-starts `server.mjs` if port `3030` is not listening; never invokes unsigned `.exe` wrappers like `ffmpeg.exe`):

```powershell
node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status rendering --owner "<agent>"
node "{{WORKSPACE_ROOT}}/engine/render_video.mjs" --course <COURSE_CODE> --episode <ep-slug> --port 3030
```
*(Optional: pass `--format mp4` or `--format webm`.)*

`render_video.mjs` navigates headless Chrome to `http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player&headless=1`, runs `window.__STUDIO_RENDER_OFFLINE__`, uploads the video via `POST /api/save-video` into `{{WORKSPACE_ROOT}}/<COURSE_CODE>/episodes/<ep-slug>/<ep-slug>.webm` (or `.mp4`), verifies `size > 0`, and updates `state/<ep-slug>.json`.

*(Alternative Web UI Flow: In Screen 3 Studio Player, users can click **`🎙️ Tạo Audio (TTS)`** or **`🎬 Tạo Audio & Render Video`** directly via `POST /api/jobs/run-production`, watching live SSE `job_update` progress without leaving the browser.)*

## Step 3: Verify, Resolve Revisions & Mark Production Completed

1. Verify the rendered video file exists and is non-empty, and confirm the Studio Player (`http://localhost:3030/?course=<COURSE_CODE>&ep=<ep-slug>&view=player`) loads with zero console/page errors.
2. If you fixed an open `production` revision ticket (`REV-XXX`), resolve it first, then mark production completed (which clears `production.stale = false`):
   ```powershell
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" resolve-revision --course <COURSE_CODE> --ep <ep-slug> --rev <REV_ID> --note "Re-synthesized and re-rendered"
   node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" set --course <COURSE_CODE> --ep <ep-slug> --stage production --status completed --video-done true --verified true --note "Rendered and verified in headless Chrome"
   ```
3. If a **script or visual diagram defect** is discovered during rendering/verification, file a structured ticket so Conversation 2 (Argon) fixes it cleanly:
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
   - Stage-grouped episode cards with dual Scripting/Video status icons, `production.stale` (`🔄 Cần render lại`) indicators, and **`⚠️ Yêu cầu sửa`** (`RevisionModal` with `scope`, `scene_id`, and custom description).
   - Topbar **`🎙️ Giọng đọc Khóa học`** button (`VoiceStudioModal`) to browse `voices.json`, probe VoiceStudio (`localhost:8000`), preview sample audio, add custom HTTP/VoiceStudio profiles, and assign the course default voice.
   - Right panel tabs: `📡 Live Activity` (`/api/events`), `🗺️ curriculum.md`, and **`🛠️ Yêu cầu sửa`** (`RevisionPanel` filterable queue where clicking any ticket deep-links directly to `?view=player&scene=<scene_id>`).
3. **Screen 3 — Studio Player (`view=player`)**:
   - 16:9 stage with synchronized voiceover, V2 box-free subtitles, Storyboard Preview Mode, deep-link `&scene=<scene_id>`, `notes.md`, and `curriculum.md`.
   - **`🛠️ Yêu cầu sửa`** drawer tab (`Copy Prompt cho Agent` grouped by Argon `script`/`visual` vs Hydrogen `production`, Resolve/Reopen/Delete, and **`▶ Chạy lại TTS & Render ngay`**).
   - Episode Voice override picker + direct **`🎙️ Tạo Audio (TTS)`** and **`🎬 Tạo Audio & Render Video`** buttons (`POST /api/jobs/run-production` with live SSE `job_update` progress).
