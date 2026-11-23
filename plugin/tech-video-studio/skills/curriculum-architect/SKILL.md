---
name: curriculum-architect
description: Design deep-dive Zero-to-Hero and certification-aligned video curricula (mandatory /grill-me onboarding, course.json with deep-dive metadata & default TTS voice, curriculum.md, independent curriculum-reviewer gate -> curriculum_review.md, and initialized state/*.json) in {{WORKSPACE_ROOT}}/<COURSE>.
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
     - **Q1 — Mục tiêu & Quy mô khóa học:** Chứng chỉ / Thực chiến Production / Zero-to-Hero, mức độ **Deep-Dive** (10–25 phút/tập chia nhỏ thành từng phần `<= 5 phút` để duyệt độc lập), và quy mô số tập (`10` / `20` / `30` tập).
     - **Q2 — Chọn Giọng đọc mặc định cho Khóa học:** Present the real profiles from `{{WORKSPACE_ROOT}}/engine/voices.json` (plus any discovered VoiceStudio voices), AND include an option to **tích hợp giọng VoiceStudio / custom HTTP mới ngay bây giờ** following [`TTS_VOICE_SPEC.md`]({{WORKSPACE_ROOT_FILE_URI}}/engine/TTS_VOICE_SPEC.md).
     - **Q3 — Độ sâu Lab / CLI / Code & Phong cách trình bày:** Tỷ lệ lý thuyết bản chất (*under-the-hood*) vs console mockup / CLI / YAML-IaC thực chiến và góc nhìn giải thích.
     - **Q4 — Phạm vi triển khai ngay sau khi chốt lộ trình:** Chỉ lên `course.json` + `curriculum.md` (+ review độc lập + `state_cli.mjs init`), hay tiếp tục triển khai ngay sóng Script đầu tiên (3–5 tập).

3. **Design Progressive Deep-Dive Stages (*Chặng*) & Realistic Episode Sizing**:
   - Group episodes into 4–6 logical Stages (*Chặng*) building a clean **prerequisite DAG** from fundamentals to internals, production operations, and certification/incident mastery.
   - **No arbitrary 3–5 minute episode cap!** Total duration of each deep-dive episode is decided by you (the Curriculum Architect) based on what is genuinely required for a self-learner to master the topic thoroughly — typically **10–25 minutes** per episode (or `6–10m` for simpler conceptual foundations), **split into `estimated_parts` of `<= 5 minutes` (`max_part_duration_sec: 300`) each**.
   - Every episode must map out concrete depth across its parts:
     - Concrete real-world problem / outage / cost tension (`problem`)
     - Under-the-hood mechanism, data/memory/protocol trace & architecture flow (`architecture`)
     - Practical setup: exact Console UI + CLI/Code/Diffs/Debugging (`setup`)
     - Production traps, measurable trade-offs & certification exam tips (`exam_tips`)
   - Specify explicit `prerequisites[]`, `learning_objectives[]`, and non-negotiable `must_cover_concepts[]` for every episode so Conversation 2 cannot skip hard internals or make forward-reference leaps.

4. **Write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/course.json` (Deep-Dive Metadata + Default Course Voice)**:
   Save deep-dive course metadata (`course_depth: "deep_dive"`, `max_part_duration_sec: 300`), chosen voice fields (`tts_profile`, `tts_provider`, `tts_voice`, `tts_rate`), and per-episode deep-dive specs:
   ```json
   {
     "id": "AWS",
     "title": "AWS Certified Developer – Associate (DVA-C02)",
     "subtitle": "Học bản chất qua sơ đồ động, thực hành setup & luyện thi chứng chỉ",
     "language": "vi",
     "target_exam": "DVA-C02",
     "course_depth": "deep_dive",
     "max_part_duration_sec": 300,
     "total_episodes": 20,
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
             "title": "IAM Cốt Lõi: Policy Evaluation Engine, Roles & STS",
             "estimated_duration_min": 16,
             "estimated_parts": 4,
             "prerequisites": [],
             "learning_objectives": [
               "Giải thích chính xác thứ tự đánh giá Explicit Deny > SCP > Resource Policy > Identity Policy",
               "Phân biệt IAM User static key vs IAM Role STS AssumeRole token ngắn hạn"
             ],
             "must_cover_concepts": [
               "Explicit Deny vs Implicit Deny evaluation precedence",
               "sts:AssumeRole trust policy & external ID",
               "aws sts get-caller-identity & aws iam simulate-principal-policy",
               "Session duration limits & credential leak blast radius"
             ],
             "status": "planned"
           }
         ]
       }
     ]
   }
   ```

5. **Write `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum.md`**:
   - Present a clear Vietnamese Markdown syllabus listing `course_depth: deep_dive`, `max_part_duration_sec: 300`, course voice profile, each Stage (*Chặng*), exam/production alignment, and per-episode details: `Tập`, `Slug`, `Chủ đề`, `Thời lượng & Số Part (<=5m/part)`, `Prerequisites`, `Learning Objectives`, `Must-Cover Concepts`, `Thực hành Setup/CLI`, and `Bẫy đề thi / Thực chiến`.

6. **Mandatory Independent Review Gate (`curriculum-reviewer`) BEFORE `state_cli.mjs init`**:
   - **Author MUST NEVER self-approve `course.json` or `curriculum.md`.**
   - After drafting `course.json` and `curriculum.md`, spawn an independent **`curriculum-reviewer`** subagent with **fresh context** (instructing it to follow `{{WORKSPACE_ROOT}}/plugin/tech-video-studio/skills/curriculum-reviewer/SKILL.md`).
   - The reviewer writes `{{WORKSPACE_ROOT}}/<COURSE_CODE>/curriculum_review.md` ending with `APPROVED` or `REVISE` across the 5 criteria (Coverage Depth, Topic Overload & Part Sizing `<= 5m`, Prerequisite Chain, Lab & Production Trap Depth, Duration-to-Depth Realism).
   - If the verdict is `REVISE`: fix every `BLOCKER` and `MAJOR` issue in `course.json` + `curriculum.md`, then re-run `curriculum-reviewer` in a fresh subagent context (**maximum 2 review rounds**; if still `REVISE` after Round 2, escalate remaining blockers to the user).
   - **ONLY after `curriculum_review.md` reaches `APPROVED`**, proceed to Step 7.

7. **Initialize Sharded Episode State (`<COURSE_CODE>/state/*.json`)**:
   - Run the pure-Node state CLI **only after `curriculum_review.md` is `APPROVED`**:
     ```powershell
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" init --course <COURSE_CODE>
     node "{{WORKSPACE_ROOT}}/engine/state_cli.mjs" summary --course <COURSE_CODE>
     ```
   - This generates `{{WORKSPACE_ROOT}}/<COURSE_CODE>/state/<ep-slug>.json` for every episode and seeds `state/events.jsonl` so the 3-screen Dashboard on `http://localhost:3030` displays the full roadmap and course voice badge.

8. **Hand off (Respecting Q4 Scope)**:
   - If Q4 chose roadmap-only, instruct the user (or next conversation) to run `state_cli.mjs next --course <COURSE_CODE> --stage scripting --limit 5` on **Gemini 4 Argon** (`episode-producer`) to begin wave-1 scripting.
   - If Q4 chose immediate wave-1 scripting, proceed into `episode-producer` on **Gemini 4 Argon**.
