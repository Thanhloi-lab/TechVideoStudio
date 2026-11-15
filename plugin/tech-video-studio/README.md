# Tech Course Video Studio (`tech-video-studio`)

An Antigravity plugin for building complete interactive video courses (roadmap, scripts, Vietnamese + English-term voiceovers, animated architecture diagrams, clean console setup mockups, code/CLI walkthroughs, and exam cheat sheets) inside your VideoMaker workspace (`{{WORKSPACE_ROOT}}`).

## Installation

Run from the root of the cloned repository:

```powershell
# Install into workspace (.agents/plugins/tech-video-studio) — recommended & agent-safe
node setup.mjs

# Or install globally (~/.gemini/config/plugins/tech-video-studio)
node setup.mjs --global
```

See `GUIDE.md` at the repository root for full human & AI-agent onboarding steps.

## Supported Workflows
1. **Design a Course Roadmap (`curriculum-architect`)**: Create a Zero-to-Hero & Certification-aligned syllabus in `<COURSE>/curriculum.md` and `course.json` (e.g., AWS DVA-C02, Kubernetes CKA, Docker, System Design).
2. **Produce an Episode (`episode-producer`)**: Generate `script.json`, synthesize scene-by-scene MP3 voiceovers + `subtitles.srt` via `engine/tts_pipeline.py`, and author `notes.md` with cheat sheets and scenario quiz questions.
3. **Preview & Export Video (`video-renderer`)**: Launch `engine/server.mjs` (`http://localhost:3030`) to preview 16:9 animated videos in real time and export `.webm` / `.mp4` recordings.
4. **Standby Web Worker (`studio-worker`)**: Connect an Antigravity session to `localhost:3030` at 0 idle token cost to handle AI scripting jobs dispatched from the Web UI.

## TTS Providers (`tts_pipeline.py`)
- `auto` (default): Tries `edge` (Microsoft Edge ReadAloud neural voices) and seamlessly falls back to `google` chunked TTS.
- `voicestudio`: Connects to a local `debpalash/VoiceStudio` OpenAI-compatible speech endpoint (`http://localhost:8000/v1/audio/speech` or `VOICESTUDIO_API_URL`).
- `edge` / `google`: Explicitly selects either provider.
