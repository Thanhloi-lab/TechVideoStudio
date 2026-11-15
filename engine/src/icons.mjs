// Icon palette & vector primitives shared by React components and the 1920x1080 Canvas exporter.

export const TONE_STYLES = {
  orange: {
    border: "#FF9900",
    bg: "rgba(255, 153, 0, 0.14)",
    glow: "rgba(255, 153, 0, 0.45)",
    text: "#FDBA74",
    badge: "#FF9900",
  },
  blue: {
    border: "#38BDF8",
    bg: "rgba(56, 189, 248, 0.14)",
    glow: "rgba(56, 189, 248, 0.45)",
    text: "#7DD3FC",
    badge: "#0284C7",
  },
  green: {
    border: "#10B981",
    bg: "rgba(16, 185, 129, 0.14)",
    glow: "rgba(16, 185, 129, 0.45)",
    text: "#6EE7B7",
    badge: "#059669",
  },
  purple: {
    border: "#A855F7",
    bg: "rgba(168, 85, 247, 0.14)",
    glow: "rgba(168, 85, 247, 0.45)",
    text: "#D8B4FE",
    badge: "#9333EA",
  },
  red: {
    border: "#EF4444",
    bg: "rgba(239, 68, 68, 0.14)",
    glow: "rgba(239, 68, 68, 0.45)",
    text: "#FCA5A5",
    badge: "#DC2626",
  },
  slate: {
    border: "#64748B",
    bg: "rgba(100, 116, 139, 0.16)",
    glow: "rgba(148, 163, 184, 0.35)",
    text: "#CBD5E1",
    badge: "#475569",
  },
};

const TONE_ALIASES = {
  danger: "red",
  risk: "red",
  bad: "red",
  warn: "orange",
  warning: "orange",
  success: "green",
  good: "green",
  best: "green",
  neutral: "slate",
  info: "blue",
};

export function getTone(tone) {
  const key = TONE_ALIASES[tone] || tone;
  return TONE_STYLES[key] || TONE_STYLES.blue;
}

export const ICON_GLYPHS = {
  user: "👤",
  "iam-user": "🧑‍💻",
  "iam-group": "👥",
  "iam-role": "🎭",
  "iam-policy": "📜",
  sts: "🎟️",
  ec2: "🖥️",
  s3: "🪣",
  lambda: "λ",
  apigw: "🚪",
  dynamodb: "⚡",
  vpc: "🛡️",
  "k8s-pod": "☸️",
  docker: "🐳",
  database: "🗄️",
  shield: "🔐",
  hacker: "🕵️",
  code: "</>",
  check: "✅",
  deny: "⛔",
};

export function renderIconSvg(React, iconName, color = "#F8FAFC", size = 34) {
  const h = React.createElement;
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (iconName) {
    case "user":
    case "iam-user":
      return h("svg", props,
        h("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }),
        h("circle", { cx: "12", cy: "7", r: "4" })
      );
    case "iam-group":
      return h("svg", props,
        h("path", { d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" }),
        h("circle", { cx: "9", cy: "7", r: "4" }),
        h("path", { d: "M23 21v-2a4 4 0 0 0-3-3.87" }),
        h("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" })
      );
    case "iam-role":
      return h("svg", props,
        h("path", { d: "M12 2l7 4v5c0 5.25-3 9.74-7 11-4-1.26-7-5.75-7-11V6l7-4z" }),
        h("circle", { cx: "12", cy: "10", r: "2.5" }),
        h("path", { d: "M8.5 16c.8-1.5 2-2.2 3.5-2.2s2.7.7 3.5 2.2" })
      );
    case "iam-policy":
      return h("svg", props,
        h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
        h("polyline", { points: "14 2 14 8 20 8" }),
        h("line", { x1: "8", y1: "13", x2: "16", y2: "13" }),
        h("line", { x1: "8", y1: "17", x2: "13", y2: "17" })
      );
    case "sts":
      return h("svg", props,
        h("rect", { x: "3", y: "6", width: "18", height: "12", rx: "2" }),
        h("circle", { cx: "9", cy: "12", r: "2" }),
        h("path", { d: "M13 10h5M13 14h4" })
      );
    case "ec2":
      return h("svg", props,
        h("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }),
        h("rect", { x: "9", y: "9", width: "6", height: "6" }),
        h("path", { d: "M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" })
      );
    case "s3":
      return h("svg", props,
        h("path", { d: "M5 5h14l-1.5 14a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 5z" }),
        h("ellipse", { cx: "12", cy: "5", rx: "7", ry: "2.2" }),
        h("path", { d: "M7 11c2.5 1.2 7.5 1.2 10 0" })
      );
    case "lambda":
      return h("svg", props,
        h("rect", { x: "3", y: "3", width: "18", height: "18", rx: "3" }),
        h("path", { d: "M8 17l4-9M10.5 11.5L16 17M8 7h3" })
      );
    case "apigw":
      return h("svg", props,
        h("path", { d: "M4 4h16v16H4z" }),
        h("path", { d: "M9 12h6M12 9l3 3-3 3" })
      );
    case "dynamodb":
    case "database":
      return h("svg", props,
        h("ellipse", { cx: "12", cy: "5", rx: "8", ry: "3" }),
        h("path", { d: "M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" }),
        h("path", { d: "M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" })
      );
    case "shield":
    case "vpc":
      return h("svg", props,
        h("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }),
        h("path", { d: "M9 12l2 2 4-4" })
      );
    case "hacker":
      return h("svg", props,
        h("path", { d: "M12 2a5 5 0 0 1 5 5v3H7V7a5 5 0 0 1 5-5z" }),
        h("path", { d: "M3 10h18M5 10l-1 8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-1-8" }),
        h("circle", { cx: "9.5", cy: "14.5", r: "1" }),
        h("circle", { cx: "14.5", cy: "14.5", r: "1" })
      );
    case "code":
      return h("svg", props,
        h("polyline", { points: "16 18 22 12 16 6" }),
        h("polyline", { points: "8 6 2 12 8 18" })
      );
    case "deny":
      return h("svg", props,
        h("circle", { cx: "12", cy: "12", r: "9" }),
        h("line", { x1: "5.6", y1: "5.6", x2: "18.4", y2: "18.4" })
      );
    case "check":
      return h("svg", props,
        h("circle", { cx: "12", cy: "12", r: "9" }),
        h("path", { d: "M8.5 12.5l2.5 2.5 4.5-5" })
      );
    default:
      return h("svg", props,
        h("rect", { x: "3", y: "3", width: "18", height: "18", rx: "4" }),
        h("circle", { cx: "12", cy: "12", r: "4" })
      );
  }
}
