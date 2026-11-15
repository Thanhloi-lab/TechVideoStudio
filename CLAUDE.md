# Tech Course Video Studio — Claude Adapter

This repository uses [`AGENTS.md`](AGENTS.md) as the **single source of truth** for workspace rules, 3-conversation pipeline workflows, diagram validation, and environment guardrails. Do not duplicate rules here.

## Quick Pointers
- **Full Rules & Pipeline:** Read [`AGENTS.md`](AGENTS.md) before designing courses, authoring scripts, or rendering videos.
- **Setup & Multi-Agent Install:** Follow [`GUIDE.md`](GUIDE.md) (`node setup.mjs --agents all` generates `.claude/skills/`, `.mcp.json`, `.agents/skills/`, and `.agents/plugins/`).
- **State & Diagram CLI:** `node "engine/state_cli.mjs" summary --course <COURSE>` / `next` / `set` / `validate-diagrams` / `revisions`.
- **Web Studio (Port 3030):** Start `node "engine/server.mjs"` and open `http://localhost:3030` (3-screen Dashboard, Voice Studio, Storyboard Preview, AI Dispatch).
- **MCP Bridge (`tech-video-studio`):** `.mcp.json` connects `node "engine/mcp_server.mjs"` (or loopback HTTP `GET|POST /mcp` on `:3030`) exposing 9 `studio_*` tools (`studio_worker_heartbeat`, `studio_poll_ai_job`, `studio_claim_ai_job`, `studio_get_context`, `studio_report_ai_progress`, `studio_validate_script`, `studio_submit_episode_script`, `studio_complete_ai_job`, `studio_fail_ai_job`) and 4 resources (`studio://courses`, `studio://courses/{course}`, `studio://jobs/queue`, `studio://templates/schema`).
- **Skills:** Loaded from `.claude/skills/*/SKILL.md` (`curriculum-architect`, `episode-producer`, `studio-worker`, `video-renderer`).
- **Environment Guardrails:** Zero external npm/pip packages; use `node`, `python`, and Chrome only (never `ffmpeg.exe` / unsigned `.exe` wrappers).
