# Danh mục 11 Visual Components & Quy tắc Visual Variety Guard

Tài liệu tham chiếu chính thức (SSOT khớp với [`engine/src/template_schema.mjs`](src/template_schema.mjs) và [`engine/src/diagram_validator.mjs`](src/diagram_validator.mjs)) cho toàn bộ **11 Visual Templates** trên cả **Studio Web Player** và **HyperFrames Render Engine (1920×1080)**.

---

## 1. Visual Variety Guard & Quy tắc Nhịp điệu Scene

Khi biên dịch `dialogue.json` thành `script.json`, mọi tập và mọi phần (`part_01..part_N`) phải tuân thủ:

1. **Không lặp lại `visual_type` liên tiếp (`duplicate-adjacent-visual-type`):**
   - `scene[i].visual_type !== scene[i-1].visual_type`.
   - Ngoại lệ duy nhất: chuỗi nối tiếp code lab dùng `code_cli` liên hoàn trong `part: "setup"` (hoặc chuyển tiếp `source_part` lab).
2. **Độ đa dạng tối thiểu (`low-visual-variety`):**
   - Script có `>= 4` scenes phải dùng ít nhất **`3` loại `visual_type` khác nhau**.
3. **Luân phiên Dark/Light Theme & Causal Mechanic:**
   - Xen kẽ `world_theme`: `"dark"` và `"light"` để tạo nhịp tương phản thị giác giữa các ý lớn.
   - Luân phiên `causal_mechanic`: `"blur-materialize" | "wire-draw" | "arc-emission" | "width-push" | "squash-drop" | "typographic-strike"`.
   - Gắn `visual_job`: `"Proof" | "Mechanism" | "Consequence" | "Action" | "Transition"` cho badge góc trên bên phải.
4. **Kiểm tra tự động:**
   ```powershell
   node "engine/state_cli.mjs" validate-diagrams --course <COURSE> [--ep <EP_ID>]
   ```

---

## 2. Bảng chọn nhanh: Khi nào dùng Component nào?

| # | `visual_type` | Thành phần chuyên biệt | Khi nào nên dùng | Giới hạn an toàn (1080p) |
|---|---|---|---|---|
| 1 | `architecture` | `ArchitectureDiagram` | Luồng request qua nhiều service, trust boundary, VPC, IAM, data flow | `1..8` nodes (khuyên `<= 6`), zone lồng tối đa 2 cấp |
| 2 | `console_setup` | `CleanConsoleMockup` | Thao tác từng bước trên Cloud Console / Web Dashboard UI | `1..6` steps, `<= 4` fields/step, tip `<= 110` ký tự |
| 3 | `code_cli` | `TerminalAndCode` | Policy JSON, code config, chạy lệnh CLI + output thật hoặc Magic Move morph | `<= 18` dòng code, `<= 6` lệnh terminal |
| 4 | `exam_tips` | `ExamTipCard` | Bẫy đề thi / production anti-patterns (Sai vs Chuẩn) + câu hỏi quiz | `<= 4` comparisons, quiz `2..4` options |
| 5 | `comparison_matrix` | `ComparisonMatrix` | So sánh kiến trúc, thuật toán, dịch vụ theo nhiều tiêu chí | `2..4` columns × `1..6` rows |
| 6 | `timeline_flow` | `TimelineFlow` | Chuỗi lifecycle, CI/CD pipeline, quá trình tiến hóa theo mốc thời gian | `2..6` milestones (`horizontal` / `vertical`) |
| 7 | `kpi_metrics` | `KpiMetricsCard` | Số liệu benchmark, latency/throughput/cost, biểu đồ cột & alert stamp | `1..4` cards, chart `1..8` series |
| 8 | `sequence_diagram` | `SequenceDiagram` | **Handshake, RPC, OAuth/TLS, Raft/2PC, Event Loop trace theo actor lifelines** | `2..5` actors, `1..10` messages, `<= 4` highlights |
| 9 | `memory_layout` | `MemoryLayout` | **RAM/Stack/Heap, Redis Hash/SkipList, Ring Buffer, B-Tree page & Con trỏ** | `1..4` lanes × `1..8` cells/lane, `1..8` steps |
| 10 | `code_diff` | `CodeDiff` | **So sánh trực diện Before (Buggy/Rủi ro) vs After (Fixed/Tối ưu) bằng Shiki** | `1..16` dòng mỗi bên, `1..6` `focus_steps` |
| 11 | `concept_breakdown` | `ConceptBreakdown` | **Mổ xẻ giải phẫu khái niệm (`anatomy`), cây quyết định (`decision`), tổng quan (`chapter`)** | 1 `core` + `2..6` `branches` |

---

## 3. Chi tiết Schema & JSON Skeleton của 11 Components

### 1. `architecture` (`ArchitectureDiagram`)
Dùng `layout_mode: "auto"` để kernel tự tính tọa độ DAG không chồng chéo, và tham chiếu `node.svg` từ [`engine/assets/svg/catalog.json`](assets/svg/catalog.json).
```json
{
  "layout_mode": "auto",
  "orientation": "LR",
  "zones": [
    { "id": "z_vpc", "label": "VPC Production", "role": "network", "node_ids": ["app", "sts"] }
  ],
  "nodes": [
    { "id": "app", "label": "EC2 App", "sublabel": "Instance Profile", "icon": "ec2", "svg": "server-rack", "tone": "orange" },
    { "id": "sts", "label": "AWS STS", "sublabel": "AssumeRole", "icon": "sts", "tone": "purple" },
    { "id": "s3", "label": "S3 Bucket", "sublabel": "prod-data", "icon": "s3", "tone": "green" }
  ],
  "edges": [
    { "id": "e1", "from": "app", "to": "sts", "label": "AssumeRole", "style": "solid", "routing": "auto" },
    { "id": "e2", "from": "sts", "to": "s3", "label": "Temp Token", "style": "dashed", "routing": "auto" }
  ],
  "flow_steps": [
    {
      "progress_start": 0.05,
      "progress_end": 0.55,
      "active_nodes": ["app", "sts"],
      "active_edges": ["e1"],
      "badge_text": "1. Xin credential tạm",
      "packet_label": "AssumeRole",
      "camera_focus": { "x": 45, "y": 50, "zoom": 1.12 },
      "cue_sentence": 1
    }
  ]
}
```

### 2. `console_setup` (`CleanConsoleMockup`)
```json
{
  "url": "console.aws.amazon.com/iam/home#/roles/create",
  "service_name": "AWS IAM Console",
  "nav_items": ["Dashboard", "Users", "Roles", "Policies"],
  "active_nav": "Roles",
  "steps": [
    {
      "step_number": 1,
      "progress_start": 0.05,
      "progress_end": 0.95,
      "heading": "Chọn Trusted Entity",
      "fields": [
        { "label": "Trusted entity type", "type": "radio", "options": ["AWS service", "AWS account"], "selected": "AWS service", "highlight": true },
        { "label": "Role name", "type": "text", "value": "checkout-s3-reader" }
      ],
      "primary_button": "Create role",
      "highlight_button": true,
      "tip": "Luôn áp dụng Least Privilege cho Role."
    }
  ]
}
```

### 3. `code_cli` (`TerminalAndCode`)
Hỗ trợ Shiki highlighting, `code_override` morphing (`@shikijs/magic-move`), và `laser_scan` trên các dòng rủi ro.
```json
{
  "code_title": "trust-policy.json",
  "code_language": "json",
  "code_lines": [
    "{",
    "  \"Effect\": \"Allow\",",
    "  \"Principal\": { \"Service\": \"ec2.amazonaws.com\" },",
    "  \"Action\": \"sts:AssumeRole\"",
    "}"
  ],
  "highlight_phases": [
    { "progress_start": 0.05, "progress_end": 0.55, "lines": [3], "callout": "Chỉ dịch vụ EC2 được phép AssumeRole", "annotate_text": "EC2" }
  ],
  "terminal_title": "AWS CloudShell",
  "terminal_commands": [
    { "progress_start": 0.55, "command": "aws sts get-caller-identity", "output_lines": ["\"Arn\": \"arn:aws:sts::123:assumed-role/app\""] }
  ]
}
```

### 4. `exam_tips` (`ExamTipCard`)
```json
{
  "badge": "DVA-C02 Exam Tips",
  "comparisons": [
    { "title": "Cấp quyền cho EC2", "wrong": "Lưu Access Key vào .env", "right": "Gắn IAM Role qua Instance Profile", "progress_start": 0.05 }
  ],
  "quiz": {
    "show_at_progress": 0.55,
    "question": "Cách an toàn nhất để Lambda đọc DynamoDB?",
    "options": [
      { "key": "A", "text": "Nhúng Access Key vào Env Var" },
      { "key": "B", "text": "Execution Role theo Least Privilege" }
    ],
    "correct_key": "B",
    "explanation": "Execution Role tự cấp và xoay SessionToken ngắn hạn."
  }
}
```

### 5. `comparison_matrix` (`ComparisonMatrix`)
```json
{
  "badge": "So sánh Kiến trúc",
  "title": "Long-term Key vs STS Role",
  "criterion_heading": "Tiêu chí",
  "columns": [
    { "id": "user", "title": "IAM User", "tone": "red" },
    { "id": "role", "title": "IAM Role + STS", "tone": "green", "badge": "Recommended" }
  ],
  "rows": [
    {
      "criterion": "Thời hạn Credential",
      "progress_start": 0.12,
      "values": {
        "user": { "text": "Tĩnh vĩnh viễn", "status": "bad" },
        "role": { "text": "Token tạm 15m–12h", "status": "best" }
      }
    }
  ],
  "takeaway": { "label": "💡 Nguyên tắc chốt", "text": "Production workload luôn dùng STS temporary credentials.", "show_at_progress": 0.78 }
}
```

### 6. `timeline_flow` (`TimelineFlow`)
```json
{
  "orientation": "horizontal",
  "badge": "Chuỗi xử lý",
  "subtitle": "Vòng đời một Request",
  "milestones": [
    { "id": "m1", "time_label": "Bước 1", "title": "Auth Check", "description": "Xác thực JWT và quyền.", "icon": "shield", "tone": "blue", "progress_start": 0.06, "progress_end": 0.45 },
    { "id": "m2", "time_label": "Bước 2", "title": "DB Commit", "description": "Ghi WAL trước khi ACK.", "icon": "database", "tone": "green", "progress_start": 0.48, "progress_end": 0.85 }
  ],
  "callout": { "title": "Chốt lại", "text": "Mỗi bước đều phải idempotent khi retry.", "show_at_progress": 0.85 }
}
```

### 7. `kpi_metrics` (`KpiMetricsCard`)
```json
{
  "cards": [
    { "id": "c1", "label": "P99 Latency", "numeric_target": 12, "suffix": "ms", "delta_text": "-68%", "delta_tone": "green", "tone": "blue", "sparkline": [42, 34, 21, 12], "progress_start": 0.08 }
  ],
  "chart": {
    "title": "Throughput theo cấu hình",
    "unit": "req/s",
    "show_at_progress": 0.42,
    "series": [
      { "label": "Sync", "value": 1200 },
      { "label": "Async Pool", "value": 8400, "highlight": true }
    ]
  },
  "alert_stamp": { "text": "7x FASTER", "tone": "success", "show_at_progress": 0.76 }
}
```

### 8. `sequence_diagram` (`SequenceDiagram`)
Dành cho trace giao thức mạng, auth handshake, concurrency lock, hoặc message queue giữa `2..5` actors và `1..10` messages.
```json
{
  "badge": "TLS 1.3 + OAuth2 Trace",
  "subtitle": "Luồng trao đổi token không lưu secret trên browser",
  "actors": [
    { "id": "client", "label": "SPA Client", "sublabel": "PKCE", "icon": "user", "tone": "blue" },
    { "id": "auth", "label": "Auth Server", "sublabel": "IdP", "icon": "shield", "tone": "purple" },
    { "id": "api", "label": "Backend API", "sublabel": "Resource", "icon": "ec2", "tone": "green" }
  ],
  "messages": [
    { "id": "m1", "from": "client", "to": "auth", "label": "GET /authorize + code_challenge", "style": "solid", "badge": "1", "progress_start": 0.06, "progress_end": 0.30 },
    { "id": "m2", "from": "auth", "to": "client", "label": "302 Redirect ?code=xyz", "style": "dashed", "badge": "2", "progress_start": 0.32, "progress_end": 0.55 },
    { "id": "m3", "from": "client", "to": "api", "label": "POST /orders (Leak Token)", "detail": "Replay attack nếu thiếu PoP/TLS", "style": "danger", "badge": "RISK", "progress_start": 0.58, "progress_end": 0.85 }
  ],
  "highlights": [
    { "label": "Vùng rủi ro: Authorization Code bị chặn nếu thiếu code_verifier PKCE", "from_msg": "m2", "to_msg": "m3", "tone": "danger", "show_at_progress": 0.72 }
  ]
}
```

### 9. `memory_layout` (`MemoryLayout`)
Dành cho cấu trúc dữ liệu nội bộ (Hash Table buckets, Ring Buffer, Stack/Heap frames, B-Tree page, CPU Cache lines) gồm `1..4` lanes (mỗi lane `1..8` cells) và `1..8` steps.
```json
{
  "badge": "Hash Table Rehashing",
  "subtitle": "Redis dict chuyển dần từng bucket khi tải tăng",
  "complexity_badge": "O(1) Amortized",
  "lanes": [
    {
      "id": "ht0",
      "label": "ht[0] (Cũ)",
      "sublabel": "size = 4",
      "tone": "orange",
      "cells": [
        { "id": "b0", "label": "[0]", "value": "k1→v1", "state": "idle" },
        { "id": "b1", "label": "[1]", "value": "EMPTY", "state": "idle" },
        { "id": "b2", "label": "[2]", "value": "k2→v2", "state": "idle" }
      ]
    },
    {
      "id": "ht1",
      "label": "ht[1] (Mới)",
      "sublabel": "size = 8",
      "tone": "green",
      "cells": [
        { "id": "n0", "label": "[0]", "value": "—", "state": "idle" },
        { "id": "n1", "label": "[1]", "value": "—", "state": "idle" },
        { "id": "n2", "label": "[2]", "value": "—", "state": "idle" }
      ]
    }
  ],
  "steps": [
    {
      "label": "Di chuyển bucket [0] từ ht[0] sang ht[1]",
      "callout": "Mỗi thao tác HGET/HSET chỉ rehash đúng 1 bucket, tránh stop-the-world.",
      "complexity": "O(1) / command",
      "highlight_cells": [
        { "lane_id": "ht0", "cell_id": "b0", "state": "active" },
        { "lane_id": "ht1", "cell_id": "n2", "state": "write" }
      ],
      "pointers": [
        { "from_lane": "ht0", "from_cell": "b0", "to_lane": "ht1", "to_cell": "n2", "label": "rehashidx=0", "tone": "green" }
      ],
      "progress_start": 0.12,
      "progress_end": 0.90
    }
  ]
}
```

### 10. `code_diff` (`CodeDiff`)
Hiển thị song song 2 khung code (trước/sau) với Shiki syntax highlighting (`1..16` dòng/bên) và `1..6` `focus_steps`.
```json
{
  "badge": "SQL N+1 vs Eager Join",
  "subtitle": "Triệt tiêu 101 round-trip query về 1 query duy nhất",
  "language": "python",
  "left_title": "n_plus_one.py",
  "left_badge": "BEFORE · O(N)",
  "left_lines": [
    "orders = db.query('SELECT * FROM orders LIMIT 100')",
    "for order in orders:",
    "    user = db.query('SELECT * FROM users WHERE id=?', order.user_id)",
    "    render(order, user)"
  ],
  "right_title": "eager_join.py",
  "right_badge": "AFTER · O(1)",
  "right_lines": [
    "rows = db.query(",
    "    'SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id LIMIT 100'",
    ")",
    "for row in rows: render(row)"
  ],
  "focus_steps": [
    {
      "left_lines": [2, 3],
      "right_lines": [2],
      "callout": "Vòng lặp gọi query lồng nhau làm tăng p99 latency theo cấp số tuyến tính.",
      "consequence": "101 round-trip TCP tới Database",
      "fix_reason": "JOIN gộp thành 1 query duy nhất",
      "tone": "danger",
      "progress_start": 0.10,
      "progress_end": 0.92
    }
  ]
}
```

### 11. `concept_breakdown` (`ConceptBreakdown`)
Hiển thị 1 nhân lõi (`core`) và `2..6` nhánh phân tích (`branches`) theo 3 chế độ: `"anatomy"`, `"decision"`, `"chapter"`.
```json
{
  "badge": "Giải phẫu JWT Token",
  "subtitle": "3 phần cấu thành JSON Web Token chuẩn RFC 7519",
  "mode": "anatomy",
  "core": {
    "label": "JWT (Stateless Auth Token)",
    "sublabel": "header.payload.signature",
    "badge": "RFC 7519",
    "code_snippet": "eyJhbGciOiJIUzI1NiJ9.\neyJzdWIiOiJ1c2VyXzEyMyJ9.\nSflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    "tone": "blue"
  },
  "branches": [
    { "id": "hdr", "label": "Header", "role_badge": "PART 1", "detail": "Chứa thuật toán ký (alg) và loại token (typ).", "example": "{\"alg\":\"HS256\",\"typ\":\"JWT\"}", "tone": "purple", "progress_start": 0.10, "progress_end": 0.35 },
    { "id": "pay", "label": "Payload (Claims)", "role_badge": "PART 2", "detail": "Chỉ mã hóa Base64URL, KHÔNG mã hóa bí mật — ai cũng đọc được.", "example": "{\"sub\":\"u1\",\"role\":\"admin\"}", "tone": "orange", "progress_start": 0.38, "progress_end": 0.65 },
    { "id": "sig", "label": "Signature", "role_badge": "PART 3", "detail": "Chữ ký HMAC/RSA bảo vệ toàn vẹn Header + Payload chống giả mạo.", "example": "HMACSHA256(b64H + '.' + b64P, secret)", "tone": "green", "progress_start": 0.68, "progress_end": 0.92 }
  ],
  "takeaway": {
    "label": "💡 Cảnh báo bảo mật",
    "text": "Không bao giờ lưu mật khẩu hoặc PII nhạy cảm vào JWT Payload.",
    "show_at_progress": 0.85
  }
}
```
