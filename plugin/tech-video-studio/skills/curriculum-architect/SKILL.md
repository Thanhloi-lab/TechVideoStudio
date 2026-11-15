---
name: curriculum-architect
description: Design structured Zero-to-Hero and certification-aligned video curricula (mandatory /grill-me onboarding, course.json with default TTS voice metadata, curriculum.md, and initialized state/*.json) for any technology in {{WORKSPACE_ROOT}}/<COURSE>.
---

# Curriculum Architect (Conversation 1)

Use this skill whenever the user wants to start a new technology video course or expand/reorganize an existing course roadmap inside `{{WORKSPACE_ROOT}}/<COURSE_CODE>/`.

**Model Allocation:** Run curriculum design and roadmap planning on **Gemini 4 Argon** (`gemini-4-argon-high` / `medium`). If Argon quota runs out, fall back automatically to **Gemini 4 Hydrogen** (`gemini-4-hydrogen-high`) and inform the user clearly.

## Workflow

1. **Discover Existing State & Voice Catalog**:
   - Identify `<COURSE_CODE>` (uppercase short code: `AWS`, `DOCKER`, `K8S`, `SYSTEM_DESIGN`, etc.).
   - If the course already exists, run state discovery first:
     ```powershell
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
     ```
   - Read [`voices.json`]({{WORKSPACE_ROOT_FILE_URI}}/engine/voices.json) to inspect real curated/custom voice profiles.
   - Optionally probe if a local VoiceStudio server is running:
     ```powershell
     {{PYTHON_BIN}} "{{WORKSPACE_ROOT}}/engine/tts_pipeline.py" --discover-voicestudio --json
     ```
   - Check if `{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json` already exists before overwriting.

2. **Mandatory Course Onboarding `/grill-me` (Before Authoring `course.json` / `curriculum.md`)**:
   - Whenever a user starts a new conversation with a broad course request (e.g., `"Tạo video dạy K8s chi tiết, nâng cao"`), **BEFORE** writing `course.json` or `curriculum.md`, interview the user **1 question at a time** using `ask_question` (put the recommended option first, prefixed with `(Recommended)`).
   - **Skip ONLY if** the user explicitly says `"bỏ qua hỏi, dùng mặc định"` (in which case use the recommended defaults + `default_profile` from `voices.json`).
   - Ask sequentially (1 question per turn):
     - **Q1 — Mục tiêu & Quy mô khóa học:** Chứng chỉ / Thực chiến Production / Zero-to-Hero, và quy mô số tập (`10` / `20` / `30` tập).
     - **Q2 — Chọn Giọng đọc mặc định cho Khóa học:** Present the real profiles from `{{WORKSPACE_ROOT}}/engine/voices.json` (plus any discovered VoiceStudio voices), AND include an option to **tích hợp giọng VoiceStudio / custom HTTP mới ngay bây giờ** following [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md).
     - **Q3 — Độ sâu Lab / CLI / Code & Phong cách trình bày:** Tỷ lệ lý thuyết vs console mockup / CLI / YAML-IaC thực chiến và góc nhìn giải thích.
     - **Q4 — Phạm vi triển khai ngay sau khi chốt lộ trình:** Chỉ lên `course.json` + `curriculum.md` (+ `state_cli.mjs init`), hay tiếp tục triển khai ngay sóng Script đầu tiên (3–5 tập).

3. **Design Progressive Stages (*Chặng*)**:
   - Group episodes into 4–6 logical Stages (*Chặng*) building from fundamentals to advanced architecture and exam/production mastery.
   - Each episode must correspond to a focused 3–5 minute topic (`ep01-<slug>`, `ep02-<slug>`, ...), covering:
     - Concrete real-world problem (`problem`)
     - Visual architecture diagram with zones & clean data flow (`architecture`)
     - Practical setup: Console UI + CLI/Code (`setup`)
     - Production traps / exam tips (`exam_tips`)

4. **Write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json` (with Default Course Voice)**:
   Save the chosen voice metadata (`tts_profile`, `tts_provider`, `tts_voice`, `tts_rate`) at the top level of `course.json` so Conversation 3 and the Studio Web UI inherit it automatically:
   ```json
   {
     "id": "AWS",
     "title": "AWS Certified Developer – Associate (DVA-C02)",
     "subtitle": "Học bản chất qua sơ đồ động, thực hành setup & luyện thi chứng chỉ",
     "language": "vi",
     "target_exam": "DVA-C02",
     "total_episodes": 30,
     "tts_profile": "auto-vi",
     "tts_provider": "auto",
     "tts_voice": "vi-VN-HoaiMyNeural",
     "tts_rate": "+6%",
     "stages": [
       {
         "stage": 1,
         "title": "Nền tảng Cloud & Bảo mật IAM",
         "episodes": [
           {
             "id": "ep01-iam-core",
             "number": 1,
             "title": "IAM Cốt Lõi (Users, Groups, Roles & Policies)",
             "duration_target": "4m",
             "status": "planned"
           }
         ]
       }
     ]
   }
   ```

5. **Write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum.md`**:
   - Present a clear Vietnamese Markdown syllabus listing course voice profile, each Stage (*Chặng*), exam/production alignment, and a table of episodes (`Tập`, `Slug`, `Chủ đề`, `Mục tiêu hiểu bản chất`, `Thực hành Setup`, `Bẫy đề thi / Thực chiến`).

6. **Initialize Sharded Episode State (`<COURSE_CODE>/state/*.json`)**:
   - Always run the pure-Node state CLI after creating or updating `course.json`:
     ```powershell
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" init --course <COURSE_CODE>
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
     ```
   - This generates `{{WORKSPACE_ROOT}}/<COURSE_CODE>/state/<ep-slug>.json` for every episode and seeds `state/events.jsonl` so the 3-screen Dashboard on `http://localhost:3030` immediately displays the full roadmap and course voice badge.

7. **Hand off (Respecting Q4 Scope)**:
   - If Q4 chose roadmap-only, instruct the user (or next conversation) to run `state_cli.mjs next --course <COURSE_CODE> --stage scripting --limit 5` on **Gemini 4 Argon** (`episode-producer`) to begin batch scripting.
   - If Q4 chose immediate wave-1 scripting, proceed into `episode-producer` on **Gemini 4 Argon**.
