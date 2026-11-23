// Single Source of Truth (SSOT) Schema & Layout Budgets for all 11 Tech Video Studio Visual Templates.
// Pure Node.js ESM & Browser-safe; zero external dependencies.

import { SUPPORTED_VISUAL_TYPES } from "./motion/kernel.mjs";

export const VALID_SCENE_PARTS = Object.freeze([
  "problem",
  "architecture",
  "setup",
  "exam_tips",
]);

export const VALID_VISUAL_JOBS = Object.freeze([
  "Proof",
  "Mechanism",
  "Consequence",
  "Action",
  "Transition",
]);

export const VALID_WORLD_THEMES = Object.freeze([
  "dark",
  "light",
]);

export const VALID_ZONE_ROLES = Object.freeze([
  "client",
  "network",
  "compute",
  "security",
  "data",
  "danger",
]);

export const VALID_EDGE_ROUTINGS = Object.freeze([
  "auto",
  "straight",
  "orthogonal",
  "curved",
]);

export const VALID_EDGE_STYLES = Object.freeze([
  "solid",
  "dashed",
  "danger",
]);

export const VALID_TONES = Object.freeze([
  "orange",
  "blue",
  "green",
  "purple",
  "red",
  "slate",
]);

export const VALID_ICONS = Object.freeze([
  "user",
  "iam-user",
  "iam-group",
  "iam-role",
  "iam-policy",
  "sts",
  "ec2",
  "s3",
  "lambda",
  "apigw",
  "dynamodb",
  "vpc",
  "k8s-pod",
  "docker",
  "database",
  "shield",
  "hacker",
  "code",
  "check",
  "deny",
]);

export const V2_MOTION_FIELDS = Object.freeze({
  "scene.highlight_words":
    "string[] — technical English keywords accented in box-free subtitles (parseSubtitleSegments)",
  "flow_step.camera_focus":
    "{ x: number (0..100), y: number (0..100), zoom?: number (1.0..1.25) } — 16:9 camera rig pan/zoom target in architecture scenes",
  "highlight_phase.code_override":
    "string[] | string — updated code snapshot per phase for @shikijs/magic-move morphing in code_cli scenes",
  "highlight_phase.laser_scan":
    "boolean | number[] — triggers red laser scanline sweep and danger highlight on risk/error lines in code_cli scenes",
});

export const TEMPLATE_LAYOUT_BUDGETS = Object.freeze({
  architecture: Object.freeze({
    minNodes: 1,
    maxNodes: 8,
    recommendedMaxNodes: 6,
    maxZoneDepth: 2,
    coordMin: 0,
    coordMax: 100,
    safeAreaX: [8, 92],
    safeAreaY: [14, 84],
    maxEdgeLabelChars: 28,
    maxPacketLabelChars: 20,
    cameraZoomRange: [1.0, 1.25],
  }),
  console_setup: Object.freeze({
    minSteps: 1,
    maxSteps: 6,
    maxFieldsPerStep: 4,
    maxTipChars: 110,
    maxFieldValueChars: 90,
  }),
  code_cli: Object.freeze({
    maxCodeLines: 18,
    maxCodeLineChars: 64,
    maxTerminalCommands: 6,
    maxOutputLinesPerCommand: 8,
  }),
  exam_tips: Object.freeze({
    maxComparisons: 4,
    maxWrongRightChars: 120,
    minQuizOptions: 2,
    maxQuizOptions: 4,
  }),
  comparison_matrix: Object.freeze({
    minColumns: 2,
    maxColumns: 4,
    minRows: 1,
    maxRows: 6,
    maxCellChars: 95,
  }),
  timeline_flow: Object.freeze({
    minMilestones: 2,
    maxMilestones: 6,
    maxDescriptionChars: 110,
    orientations: ["horizontal", "vertical"],
  }),
  kpi_metrics: Object.freeze({
    minCards: 1,
    maxCards: 4,
    minChartSeries: 1,
    maxChartSeries: 8,
  }),
  sequence_diagram: Object.freeze({
    minActors: 2,
    maxActors: 5,
    minMessages: 1,
    maxMessages: 10,
    maxHighlights: 4,
    maxLabelChars: 48,
    maxDetailChars: 80,
    styles: ["solid", "dashed", "danger", "async"],
    highlightTones: ["danger", "warn", "info", "success"],
  }),
  memory_layout: Object.freeze({
    minLanes: 1,
    maxLanes: 4,
    minCellsPerLane: 1,
    maxCellsPerLane: 8,
    minSteps: 1,
    maxSteps: 8,
    maxCalloutChars: 110,
    cellStates: ["idle", "active", "match", "write", "danger"],
  }),
  code_diff: Object.freeze({
    minLines: 1,
    maxLines: 16,
    maxLineChars: 62,
    minFocusSteps: 1,
    maxFocusSteps: 6,
    maxCalloutChars: 110,
    tones: ["danger", "success", "info"],
  }),
  concept_breakdown: Object.freeze({
    minBranches: 2,
    maxBranches: 6,
    modes: ["anatomy", "decision", "chapter"],
    maxDetailChars: 110,
    maxCoreCodeLines: 5,
  }),
});

export const TEMPLATE_SPECS = Object.freeze({
  architecture: Object.freeze({
    visual_type: "architecture",
    label: "Architecture Diagram",
    recommended_parts: ["problem", "architecture"],
    description:
      "Interactive system architecture diagram with trust/network zones, directional node cards, routed edges, animated packets, and camera focus.",
    fields: {
      layout_mode: '"auto" | "manual" (optional; "auto" runs Zero-LLM DAG auto-layout in kernel.mjs)',
      orientation: '"LR" | "TB" (optional, for auto-layout; default "LR")',
      zones: [
        {
          id: "string (required if referenced by parent_zone)",
          label: "string (required)",
          sublabel: "string (optional)",
          role: "client | network | compute | security | data | danger",
          parent_zone: "string (optional; max 2 nested levels: depth 0 outer -> depth 1 inner)",
          node_ids: "string[] (preferred: auto-bounding box around listed node IDs)",
          x: "number 0..100 (optional explicit box)",
          y: "number 0..100 (optional explicit box)",
          w: "number >0..100 (optional explicit box)",
          h: "number >0..100 (optional explicit box)",
          dashed: "boolean (optional)",
        },
      ],
      nodes: [
        {
          id: "string (unique, required)",
          label: "string (required)",
          sublabel: "string (optional)",
          icon: VALID_ICONS.join(" | "),
          svg: "string (optional rich SVG asset id from engine/assets/svg/catalog.json, e.g. 'redis-stack', 'server-rack', 'ram-stick', 'ssd-disk', 'postgres')",
          tone: VALID_TONES.join(" | "),
          x: "number 0..100 (optional when layout_mode='auto' or omitted for auto-layout)",
          y: "number 0..100 (optional when layout_mode='auto' or omitted for auto-layout)",
          tier: "number (optional explicit DAG layer override for auto-layout)",
        },
      ],
      edges: [
        {
          id: "string (unique, required)",
          from: "string (must match existing node.id)",
          to: "string (must match existing node.id)",
          label: "string (optional, concise <= 28 chars)",
          style: "solid | dashed | danger",
          routing: "auto (default) | straight | orthogonal | curved (use curved only for bidirectional or skip-node arcs)",
          curve_offset: "number (optional)",
        },
      ],
      flow_steps: [
        {
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
          active_nodes: "string[] (each must match existing node.id)",
          active_edges: "string[] (each must match existing edge.id)",
          badge_text: "string (optional step callout banner)",
          packet_label: "string (optional moving packet pill)",
          cue_sentence: "number (optional 1-based sentence index in scene.narration for exact TTS sync)",
          cue_text: "string (optional exact spoken phrase in scene.narration for TTS sync)",
          camera_focus: "{ x: 0..100, y: 0..100, zoom: 1.0..1.25 } (optional V2)",
        },
      ],
    },
  }),

  console_setup: Object.freeze({
    visual_type: "console_setup",
    label: "Cloud Console Walkthrough",
    recommended_parts: ["setup"],
    description:
      "Step-by-step Cloud/Web Console UI walkthrough with sidebar navigation, form fields, spotlight viewfinder, tip callout, and animated cursor click.",
    fields: {
      url: "string (optional, e.g. 'console.aws.amazon.com/iam/home#/roles/create')",
      service_name: "string (optional, e.g. 'AWS IAM Console')",
      nav_items: "string[] (optional left nav menu labels)",
      active_nav: "string (optional active item matching nav_items)",
      steps: [
        {
          step_number: "number >= 1 (required)",
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
          heading: "string (required non-empty)",
          fields: [
            {
              label: "string (required)",
              type: "text | radio | checkbox_row",
              value: "string (used by text and checkbox_row)",
              options: "string[] (used when type='radio')",
              selected: "string (used when type='radio')",
              highlight: "boolean (optional spotlight bracket)",
            },
          ],
          primary_button: "string (optional, e.g. 'Next' or 'Create role')",
          highlight_button: "boolean (optional cursor glide & click ripple)",
          tip: "string (optional footer tip, recommended <= 110 chars)",
        },
      ],
    },
  }),

  code_cli: Object.freeze({
    visual_type: "code_cli",
    label: "Code & CLI Terminal",
    recommended_parts: ["architecture", "setup"],
    description:
      "Syntax-highlighted code viewer (with Magic Move morphing & laser scan) paired with an animated CLI terminal.",
    fields: {
      code_title: "string (optional, e.g. 'trust-policy.json')",
      code_language: "string (json | python | bash | yaml | javascript | typescript)",
      code_lines: "string[] (required unless terminal_commands or highlight_phases[].code_override is non-empty)",
      highlight_phases: [
        {
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
          lines: "number[] (1-based line numbers within active code snapshot)",
          callout: "string (optional explanation bar)",
          annotate_text: "string (optional exact substring inside callout to annotate)",
          code_override: "string[] | string (optional V2 morph snapshot)",
          laser_scan: "boolean | number[] (optional V2 red scanline on risk/error lines)",
          accent: "cyan | danger | red | amber | gold | warning (optional)",
        },
      ],
      terminal_badge: "string (optional, default 'SANDBOX · CLI')",
      terminal_title: "string (optional, default 'AWS Terminal')",
      terminal_commands: [
        {
          progress_start: "number in [0..1]",
          type_duration: "number (optional, default 0.14)",
          command: "string (required non-empty)",
          output_lines: "string[] (optional)",
          is_error: "boolean (optional; auto-detected on AccessDenied/Error)",
        },
      ],
    },
  }),

  exam_tips: Object.freeze({
    visual_type: "exam_tips",
    label: "Exam Traps & Quick Quiz",
    recommended_parts: ["exam_tips"],
    description:
      "Side-by-side wrong-vs-right exam trap cards with an interactive certification review quiz.",
    fields: {
      badge: "string (optional, e.g. 'DVA-C02 Exam Tips')",
      comparisons: [
        {
          title: "string (required)",
          wrong: "string (required non-empty)",
          right: "string (required non-empty)",
          progress_start: "number in [0..1] (optional, default 0)",
        },
      ],
      quiz: {
        show_at_progress: "number in [0..1] (optional, default 0.68)",
        question: "string (required non-empty when quiz is provided)",
        options: [
          {
            key: "string (e.g. 'A', 'B', 'C', 'D')",
            text: "string (required non-empty)",
          },
        ],
        correct_key: "string (must match one of options[].key)",
        explanation: "string (optional)",
        reveal_at_progress:
          "number in [0..1] (optional; when the correct answer is revealed on video — HyperFrames engine default ≈ show_at_progress + 42% of the remaining time)",
        tag: "string (optional quiz header tag; defaults to the exam code in `badge`)",
      },
    },
  }),

  comparison_matrix: Object.freeze({
    visual_type: "comparison_matrix",
    label: "Comparison Matrix",
    recommended_parts: ["problem", "architecture"],
    description:
      "Structured comparison table (2..4 columns x 1..6 rows) with status dots and a takeaway banner.",
    fields: {
      badge: "string (optional)",
      title: "string (optional)",
      criterion_heading: "string (optional, default 'Tiêu chí so sánh')",
      columns: [
        {
          id: "string (unique, required)",
          title: "string (required)",
          subtitle: "string (optional)",
          tone: VALID_TONES.join(" | "),
          badge: "string (optional)",
        },
      ],
      rows: [
        {
          criterion: "string (required)",
          progress_start: "number in [0..1] (optional)",
          values: "{ [columnId]: { text: string, status?: 'good'|'best'|'warn'|'neutral'|'bad'|'risk' } }",
        },
      ],
      takeaway: {
        label: "string (optional)",
        text: "string (required if takeaway present)",
        show_at_progress: "number in [0..1] (optional, default 0.78)",
      },
    },
  }),

  timeline_flow: Object.freeze({
    visual_type: "timeline_flow",
    label: "Timeline / Lifecycle Flow",
    recommended_parts: ["problem", "architecture", "setup"],
    description:
      "Sequential milestone progression (horizontal or vertical, 2..6 milestones) with animated rail and summary callout.",
    fields: {
      orientation: "horizontal (default) | vertical",
      badge: "string (optional)",
      subtitle: "string (optional)",
      milestones: [
        {
          id: "string (optional)",
          time_label: "string (optional, e.g. 'Bước 1')",
          title: "string (required)",
          description: "string (optional, <= 110 chars recommended)",
          icon: VALID_ICONS.join(" | "),
          tone: VALID_TONES.join(" | "),
          metric_badge: "string (optional)",
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
        },
      ],
      callout: {
        title: "string (optional)",
        text: "string (optional)",
        show_at_progress: "number in [0..1] (optional, default 0.80)",
      },
    },
  }),

  kpi_metrics: Object.freeze({
    visual_type: "kpi_metrics",
    label: "KPI Metrics & Bar Chart",
    recommended_parts: ["problem", "architecture", "exam_tips"],
    description:
      "Animated KPI counter cards (1..4) with sparklines, optional bar chart (1..8 series), and optional alert stamp.",
    fields: {
      cards: [
        {
          id: "string (optional)",
          label: "string (required)",
          value: "string | number (required unless numeric_target provided)",
          numeric_target: "number (optional animated count target)",
          prefix: "string (optional, e.g. '$')",
          suffix: "string (optional, e.g. 's' or '%')",
          decimals: "integer >= 0 (optional)",
          delta_text: "string (optional)",
          delta_tone: "success | danger | warning | blue | green | red",
          tone: VALID_TONES.join(" | "),
          sparkline: "number[] (optional, >= 2 numbers)",
          progress_start: "number in [0..1] (optional)",
        },
      ],
      chart: {
        title: "string (optional)",
        type: "'bar' (optional)",
        show_at_progress: "number in [0..1] (optional, default 0.40)",
        unit: "string (optional)",
        series: [
          {
            label: "string (required)",
            value: "number (required)",
            highlight: "boolean (optional)",
          },
        ],
      },
      alert_stamp: {
        text: "string (required if alert_stamp present)",
        tone: "danger | success",
        show_at_progress: "number in [0..1] (optional, default 0.72)",
      },
    },
  }),

  sequence_diagram: Object.freeze({
    visual_type: "sequence_diagram",
    label: "Sequence Diagram",
    recommended_parts: ["problem", "architecture", "setup"],
    description:
      "Protocol, RPC, auth handshake, and event-loop trace across 2..5 actor lifelines with 1..10 progressive message arrows and highlight bands.",
    fields: {
      badge: "string (optional, e.g. 'TLS 1.3 Handshake')",
      subtitle: "string (optional)",
      actors: [
        {
          id: "string (unique, required)",
          label: "string (required)",
          sublabel: "string (optional)",
          icon: VALID_ICONS.join(" | "),
          tone: VALID_TONES.join(" | "),
        },
      ],
      messages: [
        {
          id: "string (optional)",
          from: "string (must match existing actor.id)",
          to: "string (must match existing actor.id)",
          label: "string (required, concise <= 48 chars)",
          detail: "string (optional, <= 80 chars)",
          style: "solid | dashed | danger | async",
          badge: "string (optional, e.g. 'SYN', '200 OK')",
          cue_sentence: "number (optional 1-based sentence index in scene.narration)",
          cue_text: "string (optional spoken phrase for TTS sync)",
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
        },
      ],
      highlights: [
        {
          label: "string (required)",
          from_msg: "string | number (optional message id or index)",
          to_msg: "string | number (optional message id or index)",
          tone: "danger | warn | info | success",
          cue_sentence: "number (optional)",
          show_at_progress: "number in [0..1] (optional, default 0.72)",
        },
      ],
    },
  }),

  memory_layout: Object.freeze({
    visual_type: "memory_layout",
    label: "Memory & Data Structure Layout",
    recommended_parts: ["problem", "architecture"],
    description:
      "RAM, cache, stack/heap, buffer, hash-slot, or B-tree page layout across 1..4 lanes (1..8 cells/lane) with animated state steps and pointers.",
    fields: {
      badge: "string (optional)",
      subtitle: "string (optional)",
      complexity_badge: "string (optional, e.g. 'O(1) Lookup')",
      lanes: [
        {
          id: "string (unique, required)",
          label: "string (required)",
          sublabel: "string (optional)",
          tone: VALID_TONES.join(" | "),
          cells: [
            {
              id: "string (unique within lane, required)",
              label: "string (required)",
              value: "string (optional)",
              subtext: "string (optional)",
              state: "idle | active | match | write | danger",
            },
          ],
        },
      ],
      steps: [
        {
          label: "string (required)",
          callout: "string (optional, <= 110 chars)",
          complexity: "string (optional per-step badge override)",
          highlight_cells: [{ lane_id: "string (existing lane.id)", cell_id: "string (existing cell.id)", state: "idle | active | match | write | danger" }],
          pointers: [
            {
              from_lane: "string (existing lane.id)",
              from_cell: "string (existing cell.id)",
              to_lane: "string (existing lane.id)",
              to_cell: "string (existing cell.id)",
              label: "string (optional)",
              tone: VALID_TONES.join(" | "),
            },
          ],
          cue_sentence: "number (optional)",
          cue_text: "string (optional)",
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
        },
      ],
    },
  }),

  code_diff: Object.freeze({
    visual_type: "code_diff",
    label: "Side-by-Side Code Diff",
    recommended_parts: ["problem", "architecture", "setup", "exam_tips"],
    description:
      "Shiki-highlighted side-by-side comparison of buggy/insecure vs fixed/optimized code (1..16 lines per side) with progressive focus steps.",
    fields: {
      badge: "string (optional)",
      subtitle: "string (optional)",
      language: "string (json | python | bash | yaml | javascript | typescript | go | sql | hcl)",
      left_title: "string (required, e.g. 'vulnerable.json')",
      left_badge: "string (optional, e.g. 'BEFORE · BUGGY')",
      left_lines: "string[] (1..16 lines, required)",
      right_title: "string (required, e.g. 'hardened.json')",
      right_badge: "string (optional, e.g. 'AFTER · FIXED')",
      right_lines: "string[] (1..16 lines, required)",
      focus_steps: [
        {
          left_lines: "number[] (optional 1-based line numbers in left_lines)",
          right_lines: "number[] (optional 1-based line numbers in right_lines)",
          callout: "string (required, <= 110 chars)",
          consequence: "string (optional failure impact pill)",
          fix_reason: "string (optional fix explanation pill)",
          tone: "danger | success | info",
          cue_sentence: "number (optional)",
          cue_text: "string (optional)",
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
        },
      ],
    },
  }),

  concept_breakdown: Object.freeze({
    visual_type: "concept_breakdown",
    label: "Concept Breakdown Tree",
    recommended_parts: ["problem", "architecture", "exam_tips"],
    description:
      "Core-and-branches mental model diagram (anatomy, decision, or chapter overview) with 2..6 progressive branches and optional takeaway.",
    fields: {
      badge: "string (optional)",
      subtitle: "string (optional)",
      mode: "anatomy | decision | chapter (optional, default 'anatomy')",
      core: {
        label: "string (required)",
        sublabel: "string (optional)",
        badge: "string (optional)",
        code_snippet: "string (optional short <= 5-line snippet)",
        tone: VALID_TONES.join(" | "),
      },
      branches: [
        {
          id: "string (unique, required)",
          label: "string (required)",
          role_badge: "string (optional)",
          detail: "string (required, <= 110 chars)",
          example: "string (optional)",
          tone: VALID_TONES.join(" | "),
          cue_sentence: "number (optional)",
          cue_text: "string (optional)",
          progress_start: "number in [0..1] (<= progress_end)",
          progress_end: "number in [0..1] (>= progress_start)",
        },
      ],
      takeaway: {
        label: "string (optional)",
        text: "string (required if takeaway present)",
        show_at_progress: "number in [0..1] (optional, default 0.80)",
      },
    },
  }),
});

/**
 * Full machine-readable schema doc exposed via MCP `studio://templates/schema`.
 */
export function buildTemplatesSchemaDoc() {
  return {
    parts: [...VALID_SCENE_PARTS],
    supported_visual_types: [...SUPPORTED_VISUAL_TYPES],
    scene_metadata: {
      required: ["id", "part", "title", "visual_type", "narration", "visual_data"],
      optional: [
        "part_label",
        "key_points",
        "highlight_words",
        "visual_job",
        "world_theme",
        "causal_mechanic",
        "sfx_cues",
        "tts_narration",
        "tts_beats",
      ],
      valid_parts: [...VALID_SCENE_PARTS],
    },
    v2_motion_fields: { ...V2_MOTION_FIELDS },
    architecture_rules: {
      zones:
        "roles: client|network|compute|security|data|danger; max 2 nested levels via parent_zone; use node_ids[] or x,y,w,h in 0..100",
      routing:
        "auto (default) | straight | orthogonal | curved (only for bidirectional pairs or skip-node arcs)",
      layout:
        "set layout_mode:'auto' (or omit node x/y) for Zero-LLM DAG auto-layout, or provide explicit non-overlapping x,y in 0..100",
    },
    template_limits: {
      architecture: {
        nodes: `${TEMPLATE_LAYOUT_BUDGETS.architecture.minNodes}..${TEMPLATE_LAYOUT_BUDGETS.architecture.maxNodes}`,
        max_zone_depth: TEMPLATE_LAYOUT_BUDGETS.architecture.maxZoneDepth,
      },
      console_setup: {
        steps: `${TEMPLATE_LAYOUT_BUDGETS.console_setup.minSteps}..${TEMPLATE_LAYOUT_BUDGETS.console_setup.maxSteps}`,
        max_fields_per_step: TEMPLATE_LAYOUT_BUDGETS.console_setup.maxFieldsPerStep,
        max_tip_chars: TEMPLATE_LAYOUT_BUDGETS.console_setup.maxTipChars,
      },
      code_cli: {
        max_code_lines: TEMPLATE_LAYOUT_BUDGETS.code_cli.maxCodeLines,
        max_terminal_commands: TEMPLATE_LAYOUT_BUDGETS.code_cli.maxTerminalCommands,
      },
      exam_tips: {
        max_comparisons: TEMPLATE_LAYOUT_BUDGETS.exam_tips.maxComparisons,
        quiz_options: `${TEMPLATE_LAYOUT_BUDGETS.exam_tips.minQuizOptions}..${TEMPLATE_LAYOUT_BUDGETS.exam_tips.maxQuizOptions}`,
      },
      comparison_matrix: {
        columns: `${TEMPLATE_LAYOUT_BUDGETS.comparison_matrix.minColumns}..${TEMPLATE_LAYOUT_BUDGETS.comparison_matrix.maxColumns}`,
        rows: `${TEMPLATE_LAYOUT_BUDGETS.comparison_matrix.minRows}..${TEMPLATE_LAYOUT_BUDGETS.comparison_matrix.maxRows}`,
      },
      timeline_flow: {
        orientation: TEMPLATE_LAYOUT_BUDGETS.timeline_flow.orientations.join("|"),
        milestones: `${TEMPLATE_LAYOUT_BUDGETS.timeline_flow.minMilestones}..${TEMPLATE_LAYOUT_BUDGETS.timeline_flow.maxMilestones}`,
      },
      kpi_metrics: {
        cards: `${TEMPLATE_LAYOUT_BUDGETS.kpi_metrics.minCards}..${TEMPLATE_LAYOUT_BUDGETS.kpi_metrics.maxCards}`,
        chart_series: `${TEMPLATE_LAYOUT_BUDGETS.kpi_metrics.minChartSeries}..${TEMPLATE_LAYOUT_BUDGETS.kpi_metrics.maxChartSeries}`,
      },
      sequence_diagram: {
        actors: `${TEMPLATE_LAYOUT_BUDGETS.sequence_diagram.minActors}..${TEMPLATE_LAYOUT_BUDGETS.sequence_diagram.maxActors}`,
        messages: `${TEMPLATE_LAYOUT_BUDGETS.sequence_diagram.minMessages}..${TEMPLATE_LAYOUT_BUDGETS.sequence_diagram.maxMessages}`,
        max_highlights: TEMPLATE_LAYOUT_BUDGETS.sequence_diagram.maxHighlights,
      },
      memory_layout: {
        lanes: `${TEMPLATE_LAYOUT_BUDGETS.memory_layout.minLanes}..${TEMPLATE_LAYOUT_BUDGETS.memory_layout.maxLanes}`,
        cells_per_lane: `${TEMPLATE_LAYOUT_BUDGETS.memory_layout.minCellsPerLane}..${TEMPLATE_LAYOUT_BUDGETS.memory_layout.maxCellsPerLane}`,
        steps: `${TEMPLATE_LAYOUT_BUDGETS.memory_layout.minSteps}..${TEMPLATE_LAYOUT_BUDGETS.memory_layout.maxSteps}`,
      },
      code_diff: {
        lines_per_side: `${TEMPLATE_LAYOUT_BUDGETS.code_diff.minLines}..${TEMPLATE_LAYOUT_BUDGETS.code_diff.maxLines}`,
        focus_steps: `${TEMPLATE_LAYOUT_BUDGETS.code_diff.minFocusSteps}..${TEMPLATE_LAYOUT_BUDGETS.code_diff.maxFocusSteps}`,
      },
      concept_breakdown: {
        branches: `${TEMPLATE_LAYOUT_BUDGETS.concept_breakdown.minBranches}..${TEMPLATE_LAYOUT_BUDGETS.concept_breakdown.maxBranches}`,
        modes: TEMPLATE_LAYOUT_BUDGETS.concept_breakdown.modes.join("|"),
      },
    },
    layout_budgets: TEMPLATE_LAYOUT_BUDGETS,
    templates: TEMPLATE_SPECS,
  };
}

/**
 * Generate AI-prompt schema specification from SSOT.
 * @param {object} [opts]
 * @param {boolean} [opts.compact=false] - Shorter token-efficient prompt summary when true.
 * @param {1|2} [opts.pass=2] - Pass 1 = storyboard intent; Pass 2 = full exact visual_data schema.
 */
export function getSchemaPromptSpec({ compact = false, pass = 2 } = {}) {
  const isPass1 = Number(pass) === 1;

  if (isPass1) {
    const lines = [
      "### Pass 1 — Storyboard & Scene Intent Specification",
      `1. \`part\` must be one of: ${VALID_SCENE_PARTS.map((p) => `"${p}"`).join(" | ")}.`,
      `2. \`visual_type\` must be one of the ${SUPPORTED_VISUAL_TYPES.length} supported templates: ${SUPPORTED_VISUAL_TYPES.join(", ")}.`,
      "3. Visual Variety Guard: avoid back-to-back identical `visual_type` (except consecutive `code_cli` lab continuations), use >= 3 distinct `visual_type` values on scripts with >= 4 scenes, and alternate `world_theme` (`dark`/`light`) & `causal_mechanic`.",
      "4. Each scene requires: `id` (unique slug), `part`, `part_label`, `title`, `visual_type`, `narration` (natural spoken Vietnamese, keeping English technical terms intact), `highlight_words` (`string[]`), `key_points` (`string[]`), and `visual_intent` (concise design plan):",
    ];
    if (compact) {
      lines.push(
        "   - `architecture`: zones + nodes + edges + flow_steps intent (prefer `layout_mode: 'auto'` unless explicit coords needed).",
        "   - `console_setup`: service_name + 1..6 sequential steps (<=4 fields/step).",
        "   - `code_cli`: code snippet (<=18 lines) and/or terminal commands + highlight phase goals.",
        "   - `exam_tips`: up to 4 wrong-vs-right traps + 1 multiple-choice quiz (A/B/C/D).",
        "   - `comparison_matrix`: 2..4 columns x 1..6 criterion rows + takeaway.",
        "   - `timeline_flow`: 2..6 sequential milestones (horizontal|vertical) + callout.",
        "   - `kpi_metrics`: 1..4 metric cards + optional bar chart (1..8 bars) + optional alert_stamp.",
        "   - `sequence_diagram`: 2..5 actor lifelines + 1..10 messages + optional highlight spans.",
        "   - `memory_layout`: 1..4 lanes (1..8 cells/lane) + 1..8 state/pointer steps.",
        "   - `code_diff`: before vs after code (1..16 lines/side) + 1..6 focus_steps.",
        "   - `concept_breakdown`: central core + 2..6 branches (anatomy|decision|chapter) + optional takeaway."
      );
    } else {
      lines.push(
        "   - `architecture`: Specify trust/network zones (max 2 nested levels), 2..8 nodes (`id`, `label`, `sublabel`, `icon`, `tone`), directional edges, and progressive `flow_steps`. Set `layout_mode: 'auto'` to let the engine compute collision-free coordinates.",
        "   - `console_setup`: Specify `service_name`, `nav_items`, and 1..6 console steps (`heading`, <=4 fields of type `text|radio|checkbox_row`, `primary_button`, concise `tip`).",
        "   - `code_cli`: Specify `code_language`, `code_title`, `code_lines` (<=18 lines) and/or `terminal_commands`, plus `highlight_phases` (optional `code_override` morphing and `laser_scan` on risky lines).",
        "   - `exam_tips`: Specify up to 4 `comparisons` (`title`, `wrong`, `right`) and optional `quiz` (`question`, 2..4 `{ key, text }` options, `correct_key`, `explanation`).",
        "   - `comparison_matrix`: Specify 2..4 `columns` (`id`, `title`, `tone`) and 1..6 `rows` (`criterion`, `values[colId]`) plus optional `takeaway`.",
        "   - `timeline_flow`: Specify `orientation` (`horizontal|vertical`), 2..6 `milestones` (`time_label`, `title`, `description`, `icon`, `tone`), and optional `callout`.",
        "   - `kpi_metrics`: Specify 1..4 `cards` (`label`, `value`/`numeric_target`, `delta_text`, `sparkline`), optional `chart` (`series[1..8]`), and optional `alert_stamp`.",
        "   - `sequence_diagram`: Specify 2..5 `actors` (`id`, `label`, `icon`, `tone`), 1..10 `messages` (`from`, `to`, `label`, `style`, `badge`), and optional `highlights` spanning key message ranges.",
        "   - `memory_layout`: Specify `complexity_badge`, 1..4 `lanes` (each with 1..8 `cells`), and 1..8 `steps` updating `highlight_cells` states and `pointers` between cells.",
        "   - `code_diff`: Specify `language`, `left_title`/`left_lines` (1..16) vs `right_title`/`right_lines` (1..16), and 1..6 `focus_steps` pointing out root cause vs fix.",
        "   - `concept_breakdown`: Specify `mode` (`anatomy|decision|chapter`), central `core`, 2..6 progressive `branches` (`id`, `label`, `role_badge`, `detail`, `example`), and optional `takeaway`."
      );
    }
    return lines.join("\n");
  }

  if (compact) {
    return [
      "### Visual Templates Exact Schema (Pass 2 — Strict Runtime Fields)",
      `Supported \`visual_type\` (${SUPPORTED_VISUAL_TYPES.length}): ${SUPPORTED_VISUAL_TYPES.join(", ")}`,
      `Required scene fields: \`id\` (unique non-empty), \`part\` (${VALID_SCENE_PARTS.join("|")}), \`title\`, \`visual_type\`, \`narration\` (non-empty), \`highlight_words[]\`, \`key_points[]\`, \`visual_data\`.`,
      "- `architecture`: `{ layout_mode?: 'auto'|'manual', orientation?: 'LR'|'TB', zones?: [{ id, label, sublabel?, role: 'client'|'network'|'compute'|'security'|'data'|'danger', parent_zone?, node_ids? }], nodes: [{ id, label, sublabel?, icon?, tone?, x?: 0..100, y?: 0..100, tier? }], edges: [{ id, from, to, label?, style?: 'solid'|'dashed'|'danger', routing?: 'auto'|'straight'|'orthogonal'|'curved' }], flow_steps: [{ progress_start, progress_end, active_nodes[], active_edges[], badge_text?, packet_label?, camera_focus?: { x, y, zoom } }] }` (omit node x/y when `layout_mode:'auto'`).",
      "- `console_setup`: `{ url?, service_name?, nav_items?, active_nav?, steps: [{ step_number, progress_start, progress_end, heading, fields: [{ label, type: 'text'|'radio'|'checkbox_row', value?, options?, selected?, highlight? }], primary_button?, highlight_button?, tip? }] }` (max 4 fields/step, tip <=110 chars).",
      "- `code_cli`: `{ code_title?, code_language?, code_lines?: string[], highlight_phases?: [{ progress_start, progress_end, lines?: number[] (1-based), callout?, annotate_text?, code_override?: string[]|string, laser_scan?: boolean|number[], accent? }], terminal_badge?, terminal_title?, terminal_commands?: [{ progress_start, type_duration?, command, output_lines?, is_error? }] }` (do NOT emit legacy `layout: 'code_only'`).",
      "- `exam_tips`: `{ badge?, comparisons?: [{ title, wrong, right, progress_start? }], quiz?: { show_at_progress?, question, options: [{ key, text }], correct_key, explanation? } }`.",
      "- `comparison_matrix`: `{ badge?, title?, criterion_heading?, columns: (2..4)[{ id, title, subtitle?, tone?, badge? }], rows: (1..6)[{ criterion, progress_start?, values: { [colId]: { text, status?: 'good'|'best'|'warn'|'neutral'|'bad'|'risk' } } }], takeaway?: { label?, text, show_at_progress? } }`.",
      "- `timeline_flow`: `{ orientation?: 'horizontal'|'vertical', badge?, subtitle?, milestones: (2..6)[{ id?, time_label?, title, description?, icon?, tone?, metric_badge?, progress_start, progress_end }], callout?: { title?, text, show_at_progress? } }`.",
      "- `kpi_metrics`: `{ cards: (1..4)[{ id?, label, value?, numeric_target?, prefix?, suffix?, decimals?, delta_text?, delta_tone?, tone?, sparkline?, progress_start? }], chart?: { title?, type?: 'bar', show_at_progress?, unit?, series: (1..8)[{ label, value, highlight? }] }, alert_stamp?: { text, tone: 'danger'|'success', show_at_progress? } }`.",
      "- `sequence_diagram`: `{ badge?, subtitle?, actors: (2..5)[{ id, label, sublabel?, icon?, tone? }], messages: (1..10)[{ id?, from, to, label, detail?, style?: 'solid'|'dashed'|'danger'|'async', badge?, cue_sentence?, cue_text?, progress_start, progress_end }], highlights?: [{ label, from_msg?, to_msg?, tone?: 'danger'|'warn'|'info'|'success', cue_sentence?, show_at_progress }] }`.",
      "- `memory_layout`: `{ badge?, subtitle?, complexity_badge?, lanes: (1..4)[{ id, label, sublabel?, tone?, cells: (1..8)[{ id, label, value?, subtext?, state?: 'idle'|'active'|'match'|'write'|'danger' }] }], steps: (1..8)[{ label, callout?, complexity?, highlight_cells?: [{ lane_id, cell_id, state }], pointers?: [{ from_lane, from_cell, to_lane, to_cell, label?, tone? }], cue_sentence?, cue_text?, progress_start, progress_end }] }`.",
      "- `code_diff`: `{ badge?, subtitle?, language?, left_title, left_badge?, left_lines: (1..16)string[], right_title, right_badge?, right_lines: (1..16)string[], focus_steps: (1..6)[{ left_lines?: number[], right_lines?: number[], callout, consequence?, fix_reason?, tone?: 'danger'|'success'|'info', cue_sentence?, cue_text?, progress_start, progress_end }] }`.",
      "- `concept_breakdown`: `{ badge?, subtitle?, mode?: 'anatomy'|'decision'|'chapter', core: { label, sublabel?, badge?, code_snippet?, tone? }, branches: (2..6)[{ id, label, role_badge?, detail, example?, tone?, cue_sentence?, cue_text?, progress_start, progress_end }], takeaway?: { label?, text, show_at_progress } }`.",
    ].join("\n");
  }

  return [
    "### Visual Templates Exact Schema (Pass 2 — SSOT Runtime Reference)",
    `1. Scene Metadata: each scene MUST have unique non-empty \`id\`, valid \`part\` (${VALID_SCENE_PARTS.map((p) => `'${p}'`).join(" | ")}), \`title\`, \`visual_type\` (${SUPPORTED_VISUAL_TYPES.join(" | ")}), non-empty spoken \`narration\`, optional \`part_label\`, \`key_points[]\`, and \`highlight_words[]\`.`,
    "2. Visual Variety Guard: never place two consecutive scenes with the same `visual_type` (except consecutive `code_cli` lab continuations), use >= 3 distinct `visual_type` templates when a script has >= 4 scenes, and alternate `world_theme` (`dark`/`light`) & `causal_mechanic`.",
    "3. Exact `visual_data` schemas per `visual_type`:",
    "   - `architecture`:",
    "     `{ layout_mode?: 'auto'|'manual', orientation?: 'LR'|'TB', zones?: [{ id, label, sublabel?, role: 'client'|'network'|'compute'|'security'|'data'|'danger', parent_zone?, node_ids?, x?, y?, w?, h? }], nodes: [{ id, label, sublabel?, icon, tone, x?, y?, tier? }], edges: [{ id, from, to, label?, style?: 'solid'|'dashed'|'danger', routing?: 'auto'|'straight'|'orthogonal'|'curved' }], flow_steps: [{ progress_start, progress_end, active_nodes: string[], active_edges: string[], badge_text?, packet_label?, camera_focus?: { x: 0..100, y: 0..100, zoom: 1.0..1.25 } }] }`.",
    "     Rules: `layout_mode:'auto'` computes non-overlapping x/y automatically (so x/y may be omitted). Max 2 zone nesting levels. `active_nodes` & `active_edges` must reference existing IDs; `0 <= progress_start <= progress_end <= 1`.",
    "   - `console_setup`:",
    "     `{ url?, service_name?, nav_items?: string[], active_nav?, steps: [{ step_number: 1..N, progress_start, progress_end, heading, fields: [{ label, type: 'text'|'radio'|'checkbox_row', value?, options?, selected?, highlight? }], primary_button?, highlight_button?, tip? }] }`.",
    "     Budgets: 1..6 steps, <= 4 fields per step, tip <= 110 chars.",
    "   - `code_cli`:",
    "     `{ code_title?, code_language?, code_lines?: string[], highlight_phases?: [{ progress_start, progress_end, lines?: number[] (1-based), callout?, annotate_text?, code_override?: string[]|string, laser_scan?: boolean|number[], accent? }], terminal_badge?, terminal_title?, terminal_commands?: [{ progress_start, type_duration?, command, output_lines?, is_error? }] }`.",
    "     Budgets: <= 18 code_lines (avoid truncation), valid 1-based line numbers in `lines` / `laser_scan` against active snapshot (`code_override` or `code_lines`). Do not rely on legacy `layout: 'code_only'`.",
    "   - `exam_tips`:",
    "     `{ badge?, comparisons?: [{ title, wrong, right, progress_start? }], quiz?: { show_at_progress?, question, options: [{ key, text }], correct_key, explanation? } }`.",
    "     Rules: non-empty `comparisons` (each with `wrong` and `right`, max 4) and/or valid `quiz` (`options` >= 2 with unique `key`, `correct_key` matching an option `key`).",
    "   - `comparison_matrix`:",
    "     `{ badge?, title?, criterion_heading?, columns: (2..4)[{ id, title, subtitle?, tone?, badge? }], rows: (1..6)[{ criterion, progress_start?, values: { [colId]: { text, status?: 'good'|'best'|'warn'|'neutral'|'bad'|'risk' } } }], takeaway?: { label?, text, show_at_progress? } }`.",
    "   - `timeline_flow`:",
    "     `{ orientation?: 'horizontal'|'vertical', badge?, subtitle?, milestones: (2..6)[{ id?, time_label?, title, description?, icon?, tone?, metric_badge?, progress_start, progress_end }], callout?: { title?, text, show_at_progress? } }`.",
    "   - `kpi_metrics`:",
    "     `{ cards: (1..4)[{ id?, label, value?, numeric_target?, prefix?, suffix?, decimals?, delta_text?, delta_tone?, tone?, sparkline?, progress_start? }], chart?: { title?, type?: 'bar', show_at_progress?, unit?, series: (1..8)[{ label, value, highlight? }] }, alert_stamp?: { text, tone?: 'danger'|'success', show_at_progress? } }`.",
    "   - `sequence_diagram`:",
    "     `{ badge?, subtitle?, actors: (2..5)[{ id, label, sublabel?, icon?, tone? }], messages: (1..10)[{ id?, from, to, label, detail?, style?: 'solid'|'dashed'|'danger'|'async', badge?, cue_sentence?, cue_text?, progress_start, progress_end }], highlights?: [{ label, from_msg?, to_msg?, tone?: 'danger'|'warn'|'info'|'success', cue_sentence?, show_at_progress }] }`.",
    "     Rules: `from`/`to` must match `actors[].id`; `0 <= progress_start <= progress_end <= 1`.",
    "   - `memory_layout`:",
    "     `{ badge?, subtitle?, complexity_badge?, lanes: (1..4)[{ id, label, sublabel?, tone?, cells: (1..8)[{ id, label, value?, subtext?, state?: 'idle'|'active'|'match'|'write'|'danger' }] }], steps: (1..8)[{ label, callout?, complexity?, highlight_cells?: [{ lane_id, cell_id, state }], pointers?: [{ from_lane, from_cell, to_lane, to_cell, label?, tone? }], cue_sentence?, cue_text?, progress_start, progress_end }] }`.",
    "     Rules: `highlight_cells` and `pointers` must reference valid `lane_id` and `cell_id` pairs.",
    "   - `code_diff`:",
    "     `{ badge?, subtitle?, language?, left_title, left_badge?, left_lines: (1..16)string[], right_title, right_badge?, right_lines: (1..16)string[], focus_steps: (1..6)[{ left_lines?: number[], right_lines?: number[], callout, consequence?, fix_reason?, tone?: 'danger'|'success'|'info', cue_sentence?, cue_text?, progress_start, progress_end }] }`.",
    "     Rules: 1-based line numbers in `left_lines`/`right_lines` must fall within `1..left_lines.length` / `1..right_lines.length`.",
    "   - `concept_breakdown`:",
    "     `{ badge?, subtitle?, mode?: 'anatomy'|'decision'|'chapter', core: { label, sublabel?, badge?, code_snippet?, tone? }, branches: (2..6)[{ id, label, role_badge?, detail, example?, tone?, cue_sentence?, cue_text?, progress_start, progress_end }], takeaway?: { label?, text, show_at_progress } }`.",
    `4. Valid Icons: ${VALID_ICONS.join(", ")}. Valid Tones: ${VALID_TONES.join(", ")}.`,
  ].join("\n");
}
