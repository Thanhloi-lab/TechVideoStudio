#!/usr/bin/env node
// Creates a self-contained demo course (`HFDEMO`) exercising all 7 visual templates, with
// synthetic narration WAVs + subtitles, for HyperFrames compiler/renderer tests and previews.
//
// Usage:
//   node engine/hyperframes/fixtures/make_demo_course.mjs [--workspace <dir>] [--course HFDEMO] [--scene-sec 7]
//
// Course folders are git-ignored (/*/episodes/, /*/state/, /*/course.json).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..", "..");

export const DEMO_EPISODE_ID = "ep01-hyperframes-demo";

/** Mono 16-bit PCM WAV with a quiet, fading two-tone "voice" so audio mixing is verifiable. */
export function createToneWav(durationSec, { sampleRate = 24000, freq = 220, seed = 1 } = {}) {
  const n = Math.max(1, Math.round(durationSec * sampleRate));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.05, (durationSec - t) / 0.08);
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * (2.6 + seed * 0.1) * t);
    const v =
      0.18 * env * syllable * (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2.01 * t));
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
}

function cuesFor(texts, dur) {
  const slot = dur / texts.length;
  return texts.map((text, i) => ({
    start_sec: Math.round(i * slot * 1000) / 1000,
    end_sec: Math.round(((i + 1) * slot - 0.12) * 1000) / 1000,
    text,
  }));
}

export function buildDemoScenes(sceneSec = 7) {
  return [
    {
      id: "s1_architecture",
      part: "architecture",
      part_label: "Phần 1 · Kiến trúc",
      title: "Luồng AssumeRole từ EC2 tới S3",
      narration: "Ứng dụng trên EC2 gọi STS để lấy token tạm rồi mới truy cập S3.",
      highlight_words: ["AssumeRole", "STS"],
      key_points: ["Không dùng Access Key tĩnh"],
      visual_type: "architecture",
      visual_data: {
        layout_mode: "auto",
        orientation: "LR",
        zones: [
          { id: "z_vpc", label: "VPC Production", role: "network", node_ids: ["app", "sts"] },
          { id: "z_data", label: "Data Plane", role: "data", node_ids: ["s3", "ddb"] },
        ],
        nodes: [
          { id: "user", label: "Developer", sublabel: "CI/CD", icon: "user", tone: "slate" },
          { id: "app", label: "EC2 App", sublabel: "Instance Profile", icon: "ec2", tone: "orange" },
          { id: "sts", label: "AWS STS", sublabel: "AssumeRole", icon: "sts", tone: "purple" },
          { id: "s3", label: "S3 Bucket", sublabel: "reports/*", icon: "s3", tone: "green" },
          { id: "ddb", label: "DynamoDB", sublabel: "Audit table", icon: "dynamodb", tone: "blue" },
        ],
        edges: [
          { id: "e1", from: "user", to: "app", label: "Deploy", style: "solid" },
          { id: "e2", from: "app", to: "sts", label: "AssumeRole", style: "solid" },
          { id: "e3", from: "sts", to: "s3", label: "Temp creds", style: "dashed" },
          { id: "e4", from: "app", to: "ddb", label: "PutItem", style: "solid" },
        ],
        flow_steps: [
          { progress_start: 0.05, progress_end: 0.3, active_nodes: ["user", "app"], active_edges: ["e1"], badge_text: "1. Deploy ứng dụng", packet_label: "artifact" },
          { progress_start: 0.3, progress_end: 0.6, active_nodes: ["app", "sts"], active_edges: ["e2"], badge_text: "2. Xin token tạm", packet_label: "AssumeRole", camera_focus: { x: 50, y: 45, zoom: 1.12 } },
          { progress_start: 0.6, progress_end: 0.95, active_nodes: ["sts", "s3", "ddb"], active_edges: ["e3", "e4"], badge_text: "3. Truy cập dữ liệu", packet_label: "SessionToken" },
        ],
      },
      subtitles: cuesFor(["EC2 gọi **AWS STS** để **AssumeRole**.", "Nhận **token tạm** rồi truy cập **S3**."], sceneSec),
    },
    {
      id: "s2_console",
      part: "setup",
      part_label: "Phần 2 · Thực hành",
      title: "Tạo IAM Role cho EC2 trên Console",
      narration: "Vào IAM Console, chọn trusted entity là AWS service rồi chọn EC2.",
      highlight_words: ["IAM Console", "EC2"],
      visual_type: "console_setup",
      visual_data: {
        url: "console.aws.amazon.com/iam/home#/roles/create",
        service_name: "AWS IAM Console",
        nav_items: ["Dashboard", "Users", "Roles", "Policies"],
        active_nav: "Roles",
        steps: [
          {
            step_number: 1,
            progress_start: 0.04,
            progress_end: 0.5,
            heading: "Chọn Trusted entity",
            fields: [
              { label: "Trusted entity type", type: "radio", options: ["AWS service", "AWS account", "Web identity"], selected: "AWS service", highlight: true },
              { label: "Use case", type: "text", value: "EC2" },
            ],
            primary_button: "Next",
            highlight_button: true,
            tip: "Role cho EC2 luôn dùng trusted entity là AWS service.",
          },
          {
            step_number: 2,
            progress_start: 0.5,
            progress_end: 0.96,
            heading: "Gắn quyền tối thiểu",
            fields: [
              { label: "Permissions policy", type: "checkbox_row", value: "AmazonS3ReadOnlyAccess", highlight: true },
              { label: "Role name", type: "text", value: "ec2-reports-reader" },
            ],
            primary_button: "Create role",
            highlight_button: true,
            tip: "Least Privilege: chỉ cấp đúng quyền đọc bucket cần thiết.",
          },
        ],
      },
      subtitles: cuesFor(["Chọn **AWS service** và use case **EC2**.", "Gắn policy đọc **S3** rồi tạo role."], sceneSec),
    },
    {
      id: "s3_code",
      part: "setup",
      part_label: "Phần 3 · Code & CLI",
      title: "Trust Policy và lệnh AssumeRole",
      narration: "Trust policy cho phép EC2 assume role; sau đó thử gọi bằng AWS CLI.",
      highlight_words: ["Trust Policy"],
      visual_type: "code_cli",
      visual_data: {
        code_title: "trust-policy.json",
        code_language: "json",
        code_lines: [
          "{",
          '  "Version": "2012-10-17",',
          '  "Statement": [{',
          '    "Effect": "Allow",',
          '    "Principal": { "Service": "ec2.amazonaws.com" },',
          '    "Action": "sts:AssumeRole"',
          "  }]",
          "}",
        ],
        highlight_phases: [
          { progress_start: 0.05, progress_end: 0.35, lines: [5], callout: "Principal: chỉ dịch vụ EC2 được assume", annotate_text: "EC2" },
          {
            progress_start: 0.35,
            progress_end: 0.6,
            lines: [4, 5],
            callout: "Sai lầm: Principal là * cho phép mọi người",
            accent: "danger",
            code_override: [
              "{",
              '  "Version": "2012-10-17",',
              '  "Statement": [{',
              '    "Effect": "Allow",',
              '    "Principal": "*",',
              '    "Action": "sts:AssumeRole"',
              "  }]",
              "}",
            ],
          },
          { progress_start: 0.6, progress_end: 0.95, lines: [6], callout: "Action sts:AssumeRole" },
        ],
        terminal_title: "AWS CloudShell",
        terminal_badge: "SANDBOX · CLI",
        terminal_commands: [
          { progress_start: 0.55, command: "aws sts assume-role --role-arn arn:aws:iam::123:role/app --role-session-name demo", output_lines: ['"AccessKeyId": "ASIA...EXAMPLE"', '"Expiration": "2026-11-17T10:00:00Z"'] },
          { progress_start: 0.78, command: "aws s3 ls s3://reports --profile intern", output_lines: ["An error occurred (AccessDenied) when calling ListObjectsV2"], is_error: true },
        ],
      },
      subtitles: cuesFor(["**Trust Policy** quy định ai được assume role.", "Thử lại bằng **AWS CLI** trong sandbox."], sceneSec),
    },
    {
      id: "s4_exam",
      part: "exam_tips",
      part_label: "Phần 4 · Mẹo thi",
      title: "Bẫy đề thi về Credential",
      narration: "Đề thi hay gài đáp án lưu Access Key trong code; đáp án đúng là IAM Role.",
      highlight_words: ["Access Key", "IAM Role"],
      visual_type: "exam_tips",
      visual_data: {
        badge: "DVA-C02 Exam Tips",
        comparisons: [
          { title: "Cấp quyền cho EC2", wrong: "Lưu Access Key trong file .env", right: "Gắn IAM Role qua Instance Profile", progress_start: 0.04 },
          { title: "Quyền tạm thời cross-account", wrong: "Tạo IAM User dùng chung", right: "sts:AssumeRole với ExternalId", progress_start: 0.26 },
        ],
        quiz: {
          show_at_progress: 0.55,
          question: "Ứng dụng Lambda cần đọc DynamoDB. Cách an toàn nhất?",
          options: [
            { key: "A", text: "Nhúng Access Key vào biến môi trường" },
            { key: "B", text: "Execution Role với quyền tối thiểu" },
            { key: "C", text: "Dùng Root Account" },
          ],
          correct_key: "B",
          explanation: "Execution Role cấp token tạm, tự xoay vòng.",
        },
      },
      subtitles: cuesFor(["Đừng bao giờ lưu **Access Key** trong code.", "Đáp án đúng luôn là **IAM Role**."], sceneSec),
    },
    {
      id: "s5_matrix",
      part: "problem",
      part_label: "Phần 5 · So sánh",
      title: "So sánh Static Access Key vs STS Temporary Token",
      narration: "So sánh IAM User tĩnh với IAM Role STS tạm thời cho môi trường production.",
      highlight_words: ["IAM Role", "STS"],
      visual_type: "comparison_matrix",
      visual_data: {
        badge: "So sánh Kiến trúc",
        title: "Quản lý Credential trên AWS",
        criterion_heading: "Tiêu chí",
        columns: [
          { id: "user", title: "IAM User", subtitle: "Long-term Key", tone: "red" },
          { id: "role", title: "IAM Role + STS", subtitle: "Recommended", tone: "green", badge: "Production" },
        ],
        rows: [
          { criterion: "Loại Credential", progress_start: 0.1, values: { user: { text: "Access Key tĩnh vĩnh viễn", status: "bad" }, role: { text: "Token tạm 15m–12h tự xoay", status: "good" } } },
          { criterion: "Rủi ro lộ Secret", progress_start: 0.32, values: { user: { text: "Cao nếu lỡ commit vào Git", status: "bad" }, role: { text: "Giảm tối đa nhờ tự hết hạn", status: "best" } } },
          { criterion: "Vận hành", progress_start: 0.52, values: { user: { text: "Phải xoay key thủ công", status: "warn" }, role: { text: "AWS tự động xoay vòng", status: "good" } } },
        ],
        takeaway: { label: "💡 Quy tắc vàng", text: "EC2 và Lambda luôn dùng IAM Role thay vì nhúng Access Key.", show_at_progress: 0.74 },
      },
      subtitles: cuesFor(["Dùng **IAM Role** với **STS** thay key tĩnh.", "Token tạm tự hết hạn, giảm rủi ro."], sceneSec),
    },
    {
      id: "s6_timeline",
      part: "architecture",
      part_label: "Phần 6 · Luồng STS",
      title: "Chuỗi AssumeRole từ Application tới S3",
      narration: "Ứng dụng gọi STS AssumeRole nhận token ngắn hạn trước khi truy cập S3.",
      visual_type: "timeline_flow",
      visual_data: {
        orientation: "horizontal",
        badge: "Luồng AssumeRole",
        subtitle: "Zero Static Secrets",
        milestones: [
          { id: "m1", time_label: "Bước 1", title: "App gọi STS", description: "Gửi yêu cầu AssumeRole kèm ExternalId", icon: "sts", tone: "blue", metric_badge: "TLS 1.3", progress_start: 0.08, progress_end: 0.36 },
          { id: "m2", time_label: "Bước 2", title: "Kiểm tra Trust Policy", description: "STS xác thực danh tính và điều kiện", icon: "shield", tone: "purple", metric_badge: "~18ms", progress_start: 0.36, progress_end: 0.68 },
          { id: "m3", time_label: "Bước 3", title: "Truy cập S3", description: "Dùng SessionToken để đọc bucket an toàn", icon: "s3", tone: "green", metric_badge: "Auto-Expire", progress_start: 0.68, progress_end: 0.92 },
        ],
        callout: { title: "Zero Static Key", text: "Toàn bộ chuỗi xác thực hoàn tất dưới 50ms.", show_at_progress: 0.78 },
      },
      subtitles: cuesFor(["Ứng dụng xin **token tạm** từ **AWS STS**.", "Rồi dùng token đó đọc **S3**."], sceneSec),
    },
    {
      id: "s7_kpi",
      part: "exam_tips",
      part_label: "Phần 7 · Tác động thực tế",
      title: "Chi phí & Rủi ro khi lộ Root Access Key",
      narration: "Lộ Access Key tĩnh có thể làm chi phí EC2 tăng vọt hàng chục nghìn đô trong vài giờ.",
      visual_type: "kpi_metrics",
      visual_data: {
        cards: [
          { id: "cost", label: "Thiệt hại khi lộ Key", value: "$48,200", numeric_target: 48200, prefix: "$", delta_text: "+1,400% chi phí EC2", delta_tone: "danger", tone: "red", sparkline: [12, 18, 25, 68, 95, 100], progress_start: 0.06 },
          { id: "revoked", label: "Thời gian thu hồi Role", value: "1.5s", numeric_target: 1.5, suffix: "s", decimals: 1, delta_text: "Cắt quyền tức thì", delta_tone: "success", tone: "green", sparkline: [90, 60, 35, 12, 5, 2], progress_start: 0.16 },
          { id: "keys", label: "Key bị quét trên GitHub", value: "2,350", numeric_target: 2350, delta_text: "mỗi ngày", delta_tone: "warning", tone: "orange", sparkline: [5, 9, 14, 22, 30, 41], progress_start: 0.24 },
        ],
        chart: {
          title: "Chi phí phát sinh theo giờ sau khi lộ Key",
          type: "bar",
          show_at_progress: 0.34,
          unit: "USD",
          series: [
            { label: "1h", value: 420 },
            { label: "3h", value: 4900 },
            { label: "6h", value: 18500, highlight: true },
            { label: "12h", value: 31200 },
          ],
        },
        alert_stamp: { text: "REVOKE KEY NGAY!", tone: "danger", show_at_progress: 0.65 },
      },
      subtitles: cuesFor(["Cảnh báo **chi phí EC2** tăng vọt khi lộ key.", "Hãy thu hồi key ngay lập tức."], sceneSec),
    },
  ];
}

export function writeDemoCourse({ workspaceRoot = REPO_ROOT, courseId = "HFDEMO", sceneSec = 7 } = {}) {
  const courseDir = path.join(workspaceRoot, courseId);
  const epDir = path.join(courseDir, "episodes", DEMO_EPISODE_ID);
  const audioDir = path.join(epDir, "audio", "demo-tone");
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(path.join(courseDir, "state"), { recursive: true });

  const course = {
    id: courseId,
    title: "HyperFrames Engine Demo",
    subtitle: "7 visual templates rendered through HyperFrames",
    target_exam: "DVA-C02",
    tts_profile: "demo-tone",
    stages: [
      {
        stage: 1,
        title: "Chặng 1 · Demo",
        episodes: [{ id: DEMO_EPISODE_ID, number: 1, title: "HyperFrames Demo", duration_target: "1 phút" }],
      },
    ],
  };
  fs.writeFileSync(path.join(courseDir, "course.json"), JSON.stringify(course, null, 2) + "\n", "utf-8");
  if (!fs.existsSync(path.join(courseDir, "curriculum.md"))) {
    fs.writeFileSync(path.join(courseDir, "curriculum.md"), "# HyperFrames Demo\n\n- Tập 1: 7 template demo\n", "utf-8");
  }

  const scenes = buildDemoScenes(sceneSec).map((scene, i) => {
    const file = `audio/demo-tone/${scene.id}.wav`;
    fs.writeFileSync(path.join(epDir, ...file.split("/")), createToneWav(sceneSec, { freq: 196 + i * 22, seed: i + 1 }));
    return { ...scene, audio_file: file, duration_sec: sceneSec };
  });

  const script = {
    course_id: courseId,
    episode_id: DEMO_EPISODE_ID,
    episode_number: 1,
    title: "HyperFrames Demo — 7 Visual Templates",
    aspect_ratio: "16:9",
    tts_profile: "demo-tone",
    total_duration_sec: scenes.length * sceneSec,
    scenes,
  };
  fs.writeFileSync(path.join(epDir, "script.json"), JSON.stringify(script, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(epDir, "notes.md"), "# Demo notes\n", "utf-8");
  return { courseDir, epDir, courseId, episodeId: DEMO_EPISODE_ID };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const res = writeDemoCourse({
    workspaceRoot: path.resolve(get("--workspace", REPO_ROOT)),
    courseId: get("--course", "HFDEMO"),
    sceneSec: Number(get("--scene-sec", 7)) || 7,
  });
  console.log(`[make_demo_course] Wrote ${res.courseId}/${res.episodeId} → ${res.epDir}`);
}
