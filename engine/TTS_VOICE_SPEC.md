# TTS Voice Catalog & Custom Provider Specification (`TTS_VOICE_SPEC.md`)

> Engineering guide for configuring, discovering, and integrating Vietnamese + English technical TTS voices and custom HTTP/local TTS providers into `D:\VideoMaker\engine\` using **pure Python standard library** (Windows Application Control compliant — no `pip` installs or unsigned `.exe` wrappers).

---

## 1. Architecture & Windows Guardrails

- **Voice Catalog:** [`D:\VideoMaker\engine\voices.json`](file:///D:/VideoMaker/engine/voices.json) stores all curated and user-added voice profiles, the global `default_profile`, and `voicestudio_base_url`.
- **TTS Engine:** [`D:\VideoMaker\engine\tts_pipeline.py`](file:///D:/VideoMaker/engine/tts_pipeline.py) synthesizes scene audio (`audio/<scene_id>.mp3` or `.wav`), generates `subtitles.srt`, and updates `script.json` (`tts_profile`, `tts_voice`, `tts_provider_used`, `total_duration_sec`, `scenes[].audio_file`, `scenes[].duration_sec`, `scenes[].subtitles`).
- **Studio Web Integration:** [`D:\VideoMaker\engine\server.mjs`](file:///D:/VideoMaker/engine/server.mjs) exposes `/api/voices*` and `/api/jobs/run-production` so users can browse, preview, add, assign, and run TTS + headless render directly from `http://localhost:3030`.
- **Strict Pure-Stdlib Rule:** Because Windows Application Control blocks unsigned `.exe` wrappers (`pip.exe`, `ffmpeg.exe`, `esbuild.exe`), **all custom providers MUST operate over HTTP/WebSocket using Python stdlib (`urllib.request`, `ssl`, `socket`, `json`, `base64`, `wave`, `io`)**. Never `pip install` SDK packages or shell out to unsigned binaries.
- **Audio Format Support:** `tts_pipeline.py` inspects returned audio bytes and supports both **MP3** (MPEG frame stripping + exact duration measurement) and **WAV** (pure-stdlib `wave` + `io.BytesIO` PCM chunk merging and duration measurement), writing `.mp3` or `.wav` cleanly.

---

## 2. `D:\VideoMaker\engine\voices.json` Schema

```json
{
  "default_profile": "auto-vi",
  "voicestudio_base_url": "http://localhost:8000",
  "profiles": [
    {
      "id": "auto-vi",
      "label": "Mặc định Studio (Auto: Edge -> Google dự phòng)",
      "provider": "auto",
      "voice_id": "vi-VN-HoaiMyNeural",
      "rate": "+6%",
      "pitch": "+0Hz",
      "language": "vi",
      "gender": "female",
      "response_format": "mp3",
      "sample_text": "Xin chào, hôm nay chúng ta sẽ cùng khám phá kiến trúc hệ thống thực chiến.",
      "notes": "Thử Edge Neural trước và tự động dự phòng sang Google TTS nếu Edge bị chặn"
    },
    {
      "id": "edge-hoaimy",
      "label": "Hoài My (Nữ · Chuẩn truyền cảm)",
      "provider": "edge",
      "voice_id": "vi-VN-HoaiMyNeural",
      "rate": "+6%",
      "pitch": "+0Hz",
      "language": "vi",
      "gender": "female",
      "response_format": "mp3",
      "sample_text": "Xin chào, hôm nay chúng ta sẽ cùng khám phá kiến trúc hệ thống thực chiến.",
      "notes": "Mặc định rõ ràng, hợp tutorial công nghệ"
    }
  ]
}
```

### Top-Level Fields
| Field | Type | Description |
|---|---|---|
| `default_profile` | `string` | Profile `id` used when neither `script.json`, `course.json`, nor CLI overrides specify a voice. |
| `voicestudio_base_url` | `string` | Base URL probed by `--discover-voicestudio` and `GET /api/voices?discover=1` (default `http://localhost:8000`). |
| `profiles` | `object[]` | Array of curated and custom voice profiles. |

### Profile Fields (`profiles[]`)
| Field | Required | Values / Description |
|---|---|---|
| `id` | Yes | Unique slug (e.g. `auto-vi`, `edge-hoaimy`, `edge-namminh`, `voicestudio-local`, `vieneu-custom`). |
| `label` | Yes | Human-readable label shown in the Studio UI and onboarding `/grill-me` options. |
| `provider` | Yes | `"auto"` \| `"edge"` \| `"voicestudio"` \| `"openai_compat"` \| `"custom_http"` \| `"google"`. |
| `voice_id` | Yes | Provider voice ID (e.g. `"vi-VN-HoaiMyNeural"`, `"vi-VN-NamMinhNeural"`, `"default"`, `"vi"`). |
| `rate` | No | Speed adjustment: SSML relative rate (`"+6%"`, `"+0%"`, `"-2%"`) for `edge`, or numeric string (`"1.0"`) for `voicestudio` / `openai_compat`. |
| `pitch` | No | SSML pitch shift (`"+0Hz"`, `"-1Hz"`, `"-3Hz"`) for `edge` or `{{pitch}}` template variable. |
| `language` | No | Language tag (default `"vi"`). |
| `gender` | No | `"female"` \| `"male"` \| `"neutral"`. |
| `model` | No | Model name for `voicestudio` / `openai_compat` (default `"tts-1"`). |
| `endpoint` | Conditional | Required for `voicestudio` (defaults to `VOICESTUDIO_API_URL` or `http://localhost:8000/v1/audio/speech`), `openai_compat`, and `custom_http`. |
| `method` | No | HTTP verb for `custom_http` (default `"POST"`). |
| `headers_env` | No | Environment variable name (or header map referencing env vars) for Bearer/API-key auth (e.g. `"OPENAI_API_KEY"`, `"ELEVENLABS_API_KEY"`). **Never hardcode raw secret keys in `voices.json`.** |
| `payload_template` | Conditional | JSON object template for `custom_http` supporting placeholders: `{{text}}`, `{{voice_id}}`, `{{rate}}`, `{{pitch}}`, `{{language}}`, `{{response_format}}`. |
| `audio_json_field` | No | For `custom_http` endpoints returning JSON instead of binary audio: dot-path or key name containing base64-encoded audio bytes (e.g. `"audio_base64"` or `"data.audio"`). |
| `response_format` | No | `"mp3"` (default) or `"wav"`. |
| `requires_local_server` | No | `true` when the profile requires a locally running TTS server (e.g. VoiceStudio, F5-TTS, VieNeu-TTS). |
| `sample_text` | No | Short Vietnamese sentence used by `--preview` and the Web UI sample player. |
| `notes` | No | Usage guidance shown in UI tooltips and onboarding. |

---

## 3. 3-Tier Voice Inheritance & Safety Rules

`tts_pipeline.py` resolves the active voice profile in strict priority order:

1. **CLI Override (Highest):** `--profile <id>` or `--provider <provider> --voice <voice_id>`
2. **Episode Override:** `episodes/<ep-id>/script.json` (`tts_profile`, `tts_voice`, `tts_rate`) — also mirrored to `state/<ep-id>.json` (`voice_override`) when assigned via Web UI
3. **Course Default:** `<COURSE>/course.json` (`tts_profile`, `tts_provider`, `tts_voice`, `tts_rate`), loaded via `--course <path/to/course.json>` or auto-detected at `../../course.json` relative to `script.json`
4. **Engine Default (Lowest):** `default_profile` in `D:\VideoMaker\engine\voices.json`

### No Silent Fallback for Explicit Profiles
- Only `provider == "auto"` falls back from `edge` to `google` when Edge ReadAloud is unreachable.
- Whenever a user or `course.json` selects a specific profile (such as `edge-namminh`, `voicestudio-local`, or any `custom_http` / `openai_compat` profile), `tts_pipeline.py` **must fail loudly with an actionable error** rather than silently substituting Google Translate TTS.

---

## 4. Concrete Integration Recipes

### Recipe A — Integrating a Cloned / Custom VoiceStudio Voice (`localhost:8000`)

Use this when the user runs a local **VoiceStudio** server (OpenAI-compatible `/v1/audio/speech` + `/v1/audio/voices` or `/voices`):

1. **Probe the running VoiceStudio server:**
   ```powershell
   python "D:\VideoMaker\engine\tts_pipeline.py" --discover-voicestudio --json
   ```
   Verify `"reachable": true` and inspect the returned `voices[]` list for the cloned/custom `voice_id`.
   *(If VoiceStudio runs on a non-default port or host, set `VOICESTUDIO_API_URL` or update `voicestudio_base_url` / `endpoint`.)*

2. **Add a profile to `D:\VideoMaker\engine\voices.json`** (or via the Web UI **"➕ Thêm Giọng Tùy Chỉnh"** in `VoiceStudioModal`, which calls `POST /api/voices`):
   ```json
   {
     "id": "voicestudio-founder",
     "label": "Giọng Cloned (VoiceStudio Local)",
     "provider": "voicestudio",
     "voice_id": "my-cloned-voice-id",
     "model": "tts-1",
     "endpoint": "http://localhost:8000/v1/audio/speech",
     "rate": "1.0",
     "pitch": "+0Hz",
     "language": "vi",
     "response_format": "mp3",
     "requires_local_server": true,
     "sample_text": "Xin chào, đây là giọng nói tùy chỉnh từ VoiceStudio cục bộ."
   }
   ```

3. **Preview-test before generating a full episode:**
   ```powershell
   python "D:\VideoMaker\engine\tts_pipeline.py" --preview --profile voicestudio-founder --out "D:\VideoMaker\.tmp_test\preview.mp3" --json
   ```

---

### Recipe B — Adding Another Microsoft Edge Neural Voice / Prosody Variant

Edge ReadAloud works out-of-the-box over pure-stdlib TLS WebSocket with no API key:

1. **Add a profile entry to `D:\VideoMaker\engine\voices.json`:**
   ```json
   {
     "id": "edge-namminh-fast",
     "label": "Nam Minh (Nam · Nhanh gọn)",
     "provider": "edge",
     "voice_id": "vi-VN-NamMinhNeural",
     "rate": "+10%",
     "pitch": "+0Hz",
     "language": "vi",
     "gender": "male",
     "response_format": "mp3",
     "sample_text": "Chào mừng bạn đến với bài học triển khai hệ thống thực chiến."
   }
   ```
   - Common Vietnamese voices: `vi-VN-HoaiMyNeural` (Female), `vi-VN-NamMinhNeural` (Male).
   - `rate` and `pitch` are injected directly into `<prosody pitch='...' rate='...'>`.
   - For English-only courses, set `language: "en"` and e.g. `voice_id: "en-US-AndrewNeural"`.

2. **Verify immediately with `--preview`:**
   ```powershell
   python "D:\VideoMaker\engine\tts_pipeline.py" --preview --profile edge-namminh-fast --out "D:\VideoMaker\.tmp_test\preview.mp3" --json
   ```

---

### Recipe C — Integrating an OpenAI-Compatible or Custom HTTP/JSON TTS Provider (ElevenLabs / F5-TTS / VieNeu-TTS)

All external/local TTS tools can be wired **purely declaratively in `voices.json`** (zero `pip install`, zero `.exe` wrappers):

1. **OpenAI-Compatible Endpoint (`provider: "openai_compat"`):**
   Works with any local or hosted `/v1/audio/speech` server (Kokoro-FastAPI, OpenAI TTS, AllTalk, LocalAI, etc.):
   ```json
   {
     "id": "openai-alloy",
     "label": "OpenAI / Compatible (Alloy)",
     "provider": "openai_compat",
     "voice_id": "alloy",
     "model": "gpt-4o-mini-tts",
     "endpoint": "https://api.openai.com/v1/audio/speech",
     "headers_env": "OPENAI_API_KEY",
     "rate": "1.0",
     "language": "vi",
     "response_format": "mp3",
     "sample_text": "Xin chào, đây là giọng thử nghiệm qua chuẩn OpenAI TTS."
   }
   ```
   Set `$env:OPENAI_API_KEY = "..."` in PowerShell before running `tts_pipeline.py` or `server.mjs`.

2. **Custom HTTP Binary Audio (`provider: "custom_http"`, e.g. ElevenLabs or local F5-TTS/VieNeu-TTS returning WAV/MP3 bytes):**
   ```json
   {
     "id": "f5tts-local-vi",
     "label": "F5-TTS / VieNeu-TTS Local (WAV)",
     "provider": "custom_http",
     "voice_id": "vi-speaker-01",
     "endpoint": "http://localhost:8010/synthesize",
     "method": "POST",
     "payload_template": {
       "text": "{{text}}",
       "speaker": "{{voice_id}}",
       "speed": "{{rate}}",
       "language": "{{language}}",
       "format": "{{response_format}}"
     },
     "response_format": "wav",
     "requires_local_server": true,
     "sample_text": "Xin chào, đây là giọng nói tổng hợp từ mô hình tiếng Việt cục bộ."
   }
   ```

3. **Custom HTTP returning Base64 JSON (`audio_json_field`):**
   If a server returns `{"status": "ok", "audio_base64": "UklGR..."}`, set `"audio_json_field": "audio_base64"` on the `custom_http` profile so `tts_pipeline.py` decodes the base64 payload into MP3/WAV bytes automatically.

4. **If a provider needs custom multi-part/non-JSON request logic:**
   Extend `tts_pipeline.py` using **only Python stdlib** (`urllib.request`, `json`, `base64`, `wave`), preserve the `synthesize_chunk` return contract `(audio_bytes, actual_provider_used)`, and verify with `python -m py_compile` + `--preview`.

---

### Recipe D — Re-Synthesizing Voice & Video (Web UI or CLI)

#### Option 1: Directly via Studio Web UI (`http://localhost:3030`)
1. **Course Default Voice (Screen 2 — Roadmap):** Click **`🎙️ Giọng đọc Khóa học`** -> preview or add a custom profile -> click **"Đặt làm mặc định Khóa học"** (`POST /api/voices/assign` without `episode`).
2. **Episode Voice & Instant Regeneration (Screen 3 — Player):**
   - Pick or add a voice for the episode (`POST /api/voices/assign` with `episode`, which sets `state/<ep>.json` `voice_override`, updates `script.json`, and marks `production.stale = true`).
   - Click **`🎙️ Tạo Audio (TTS)`** (`mode: "tts_only"`) or **`🎬 Tạo Audio & Render Video`** (`mode: "tts_and_render"`) to run `tts_pipeline.py` and `render_video.mjs` live via `/api/jobs/run-production` with SSE `job_update` progress!

#### Option 2: Via CLI (Conversation 3 / Batch Pipeline)
```powershell
# 1. Inspect available profiles
python "D:\VideoMaker\engine\tts_pipeline.py" --list-profiles --json

# 2. Re-synthesize audio + SRT for an episode with a specific profile
node "D:\VideoMaker\engine\state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage production --status tts_processing --owner "<agent>"
python "D:\VideoMaker\engine\tts_pipeline.py" --episode "D:\VideoMaker\<COURSE>\episodes\<EP_ID>\script.json" --course "D:\VideoMaker\<COURSE>\course.json" --profile <PROFILE_ID> --json

# 3. Re-render video and finalize state (clears production.stale)
node "D:\VideoMaker\engine\state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage production --status rendering --tts-done true
node "D:\VideoMaker\engine\render_video.mjs" --course <COURSE> --episode <EP_ID> --port 3030
node "D:\VideoMaker\engine\state_cli.mjs" set --course <COURSE> --ep <EP_ID> --stage production --status completed --video-done true --verified true
```

---

## 5. CLI & Server API Quick Reference

### `tts_pipeline.py` CLI Flags
| Command | Purpose |
|---|---|
| `--list-profiles [--json]` | List all profiles configured in `voices.json`. |
| `--discover-voicestudio [--json]` | Probe `voicestudio_base_url` (`/v1/audio/voices`, `/voices`) with a 1.5s timeout; returns `{ ok, reachable, base_url, voices }` without crashing if offline. |
| `--preview --profile <id> [--text "..."] --out <file> [--json]` | Synthesize a single sample audio file (`mp3`/`wav`) and return `{ ok, out, ext, duration_sec, provider_used, voice_id }`. |
| `--episode <script.json> [--course <course.json>] [--profile <id>] [--provider <p>] [--voice <v>] [--json]` | Synthesize all scenes in an episode, write `audio/<scene_id>.mp3|wav` and `subtitles.srt`, and update `script.json`. |

### `server.mjs` Voice & Job Endpoints
| Endpoint | Purpose |
|---|---|
| `GET /api/voices?discover=1` | Return `voices.json` profiles + optional live VoiceStudio discovery. |
| `POST /api/voices` | `{ op: "upsert" \| "delete" \| "set_default", profile?, id? }` — atomically update `voices.json` and broadcast SSE. |
| `POST /api/voices/preview` | `{ profile_id, text? }` — synthesize cached preview and return `{ ok, audio_url, provider_used }`. |
| `POST /api/voices/assign` | `{ course, episode?, profile_id }` — assign course default (`course.json`) or episode override (`voice_override` + `script.json` + `production.stale = true`). |
| `GET /api/jobs` | List active/recent background TTS and render jobs. |
| `POST /api/jobs/run-production` | `{ course, episode, mode: "tts_only" \| "tts_and_render", profile_id?, format? }` — run TTS (and optionally `render_video.mjs`) in background with live SSE `job_update` progress. |
