// Pure ESM Architecture Diagram & Visual Template Validator (Node.js & Browser safe; zero DOM dependencies).
// Uses canonical 1000x560 geometry and template tokens from motion/kernel.mjs and SSOT rules from template_schema.mjs.

import { computeArchitectureLayout, SUPPORTED_VISUAL_TYPES } from "./motion/kernel.mjs";
import {
  TEMPLATE_LAYOUT_BUDGETS,
  VALID_SCENE_PARTS,
  VALID_VISUAL_JOBS,
  VALID_WORLD_THEMES,
} from "./template_schema.mjs";

const CANONICAL_W = 1000;
const CANONICAL_H = 560;
const VALID_PART_SET = new Set(VALID_SCENE_PARTS);
const VALID_VISUAL_JOB_SET = new Set(VALID_VISUAL_JOBS);
const VALID_WORLD_THEME_SET = new Set(VALID_WORLD_THEMES);
const SUPPORTED_VISUAL_SET = new Set(SUPPORTED_VISUAL_TYPES);

function isMissingCoord(val) {
  return val === undefined || val === null || val === "";
}

function isProgressInRange(val) {
  if (val === undefined || val === null || val === "") return false;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function overlapBoxArea(a, b) {
  const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return ox > 0 && oy > 0 ? { ox, oy, area: ox * oy } : { ox: 0, oy: 0, area: 0 };
}

function segmentHitsInsetRect(p1, p2, rect, inset = 6) {
  const rx1 = rect.x + inset;
  const ry1 = rect.y + inset;
  const rx2 = rect.right - inset;
  const ry2 = rect.bottom - inset;
  if (rx1 >= rx2 || ry1 >= ry2) return false;

  const inside = (p) => p.x >= rx1 && p.x <= rx2 && p.y >= ry1 && p.y <= ry2;
  if (inside(p1) || inside(p2)) return true;

  // Cohen-Sutherland / Liang-Barsky clip test
  let t0 = 0;
  let t1 = 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const checks = [
    [-dx, p1.x - rx1],
    [dx, rx2 - p1.x],
    [-dy, p1.y - ry1],
    [dy, ry2 - p1.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

/**
 * Validate a single architecture scene's visual_data in canonical 1000x560 layout space.
 */
export function validateArchitectureData(visualData, sceneId = "scene") {
  const data = visualData || {};
  const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  const rawEdges = Array.isArray(data.edges) ? data.edges : [];
  const rawZones = Array.isArray(data.zones) ? data.zones : [];
  const rawFlowSteps = Array.isArray(data.flow_steps) ? data.flow_steps : [];

  const errors = [];
  const warnings = [];
  const sid = String(sceneId || "scene");

  const layout = computeArchitectureLayout(data, CANONICAL_W, CANONICAL_H);

  // 1. Zone hierarchy & bounds checks
  for (const diag of layout.zoneDiagnostics) {
    errors.push({
      code: diag.code,
      scene_id: sid,
      message: diag.message,
    });
  }

  const nodeIdSet = new Set(rawNodes.map((n) => n?.id).filter(Boolean));
  const edgeIdSet = new Set(rawEdges.map((e) => e?.id).filter(Boolean));

  for (const z of rawZones) {
    if (!z) continue;
    const hasExplicit = [z.x, z.y, z.w, z.h].some((v) => v !== undefined && v !== null);
    if (hasExplicit) {
      const zx = Number(z.x);
      const zy = Number(z.y);
      const zw = Number(z.w);
      const zh = Number(z.h);
      if (
        !Number.isFinite(zx) ||
        !Number.isFinite(zy) ||
        !Number.isFinite(zw) ||
        !Number.isFinite(zh) ||
        zx < 0 ||
        zy < 0 ||
        zw <= 0 ||
        zh <= 0 ||
        zx + zw > 100 ||
        zy + zh > 100
      ) {
        errors.push({
          code: "zone-out-of-bounds",
          scene_id: sid,
          message: `Zone "${z.id || z.label || "?"}" vượt ngoài khung 0..100% (x=${z.x}, y=${z.y}, w=${z.w}, h=${z.h}).`,
        });
      }
    }
    if (Array.isArray(z.node_ids)) {
      for (const nid of z.node_ids) {
        if (!nodeIdSet.has(nid)) {
          warnings.push({
            code: "zone-unknown-node",
            scene_id: sid,
            message: `Zone "${z.id || "?"}" chứa node_id không tồn tại: "${nid}".`,
          });
        }
      }
    }
  }

  if ((rawNodes.length >= 3 || rawEdges.length >= 3) && rawZones.length === 0) {
    warnings.push({
      code: "missing-zones",
      scene_id: sid,
      message: `Scene có ${rawNodes.length} nodes / ${rawEdges.length} edges nhưng chưa khai báo visual_data.zones (nên gom nhóm User/Server/Cloud).`,
    });
  }

  // 2. Node bounds & node-node overlap
  // Allow nodes missing x/y when layout_mode==='auto' or deferred to computeArchitectureLayout.
  const nodesWithMissingCoords = new Set();
  for (const n of rawNodes) {
    if (!n) continue;
    const missingX = isMissingCoord(n.x);
    const missingY = isMissingCoord(n.y);
    if (missingX || missingY) {
      if (n.id) nodesWithMissingCoords.add(n.id);
    }
    if (!missingX) {
      const nx = Number(n.x);
      if (!Number.isFinite(nx) || nx < 0 || nx > 100) {
        errors.push({
          code: "node-out-of-bounds",
          scene_id: sid,
          message: `Node "${n.id || n.label || "?"}" có tọa độ x ngoài phạm vi 0..100 (x=${n.x}).`,
        });
      }
    }
    if (!missingY) {
      const ny = Number(n.y);
      if (!Number.isFinite(ny) || ny < 0 || ny > 100) {
        errors.push({
          code: "node-out-of-bounds",
          scene_id: sid,
          message: `Node "${n.id || n.label || "?"}" có tọa độ y ngoài phạm vi 0..100 (y=${n.y}).`,
        });
      }
    }
    if (n.svg !== undefined && n.svg !== null && n.svg !== "") {
      const slug = String(n.svg).trim().replace(/\.svg$/i, "");
      if (!/^[a-z0-9_-]+$/i.test(slug)) {
        errors.push({
          code: "invalid-svg-id",
          scene_id: sid,
          message: `Node "${n.id || "?"}" có svg="${n.svg}" không hợp lệ (chỉ dùng [a-z0-9_-]).`,
        });
      }
    }
  }

  for (const ln of layout.nodes) {
    if (!nodesWithMissingCoords.has(ln.id)) continue;
    const lx = Number.isFinite(ln.xPct) ? ln.xPct : (ln.cx / CANONICAL_W) * 100;
    const ly = Number.isFinite(ln.yPct) ? ln.yPct : (ln.cy / CANONICAL_H) * 100;
    if (!Number.isFinite(lx) || !Number.isFinite(ly) || lx < 0 || lx > 100 || ly < 0 || ly > 100) {
      errors.push({
        code: "node-out-of-bounds",
        scene_id: sid,
        message: `Node "${ln.id}" sau auto-layout có tọa độ ngoài phạm vi 0..100 (x=${lx}, y=${ly}).`,
      });
    }
  }

  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      const ov = overlapBoxArea(a, b);
      if (ov.ox > 4 && ov.oy > 4) {
        errors.push({
          code: "node-overlap",
          scene_id: sid,
          message: `Node "${a.id}" và "${b.id}" bị đè lên nhau (${Math.round(ov.ox)}x${Math.round(ov.oy)}px).`,
        });
      }
    }
  }

  // 3. Unknown edge endpoints & edge-node collisions
  for (const bad of layout.unknownEdgeTargets) {
    errors.push({
      code: "edge-unknown-node",
      scene_id: sid,
      message: `Edge "${bad.id}" tham chiếu node không tồn tại (from="${bad.from}", to="${bad.to}").`,
    });
  }

  for (const ce of layout.edges) {
    const samples = [];
    for (let k = 0; k <= 16; k++) {
      const t = 0.05 + (k / 16) * 0.9;
      samples.push(ce.pointAt(t));
    }

    for (const nr of layout.nodes) {
      if (nr.id === ce.from || nr.id === ce.to) continue;
      let hit = false;
      for (let s = 0; s < samples.length - 1; s++) {
        if (segmentHitsInsetRect(samples[s], samples[s + 1], nr, 8)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        errors.push({
          code: "edge-node-collision",
          scene_id: sid,
          message: `Đường nối "${ce.id}" (${ce.from} -> ${ce.to}) đi xuyên qua node "${nr.id}".`,
        });
      }
    }
  }

  // 4. Label-node & label-label overlap checks
  const labelBoxes = [];
  for (const ce of layout.edges) {
    if (!ce.label || ce.labelW <= 0) continue;
    const lBox = {
      edgeId: ce.id,
      label: ce.label,
      x: ce.labelX - ce.labelW * 0.5,
      y: ce.labelY - ce.labelH * 0.5,
      right: ce.labelX + ce.labelW * 0.5,
      bottom: ce.labelY + ce.labelH * 0.5,
    };
    labelBoxes.push(lBox);

    for (const nr of layout.nodes) {
      const ov = overlapBoxArea(lBox, nr);
      if (ov.area > 24) {
        warnings.push({
          code: "label-node-overlap",
          scene_id: sid,
          message: `Nhãn "${ce.label}" (${ce.id}) chạm vào node "${nr.id}".`,
        });
      }
    }
  }

  const overlappingEdgeIds = new Set();
  const overlapPairs = [];
  for (let i = 0; i < labelBoxes.length; i++) {
    for (let j = i + 1; j < labelBoxes.length; j++) {
      const a = labelBoxes[i];
      const b = labelBoxes[j];
      const ov = overlapBoxArea(a, b);
      if (ov.ox > 3 && ov.oy > 3) {
        overlappingEdgeIds.add(a.edgeId);
        overlappingEdgeIds.add(b.edgeId);
        overlapPairs.push(`${a.edgeId} <-> ${b.edgeId}`);
      }
    }
  }

  if (overlapPairs.length > 0) {
    const issue = {
      code: "label-label-overlap",
      scene_id: sid,
      message: `Nhãn edge bị chồng chéo (${overlapPairs.join(", ")}).`,
    };
    if (overlappingEdgeIds.size > 2) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  // 5. flow_steps[] reference & progress bounds checks
  for (let fi = 0; fi < rawFlowSteps.length; fi++) {
    const step = rawFlowSteps[fi];
    if (!step || typeof step !== "object") {
      errors.push({
        code: "flow-step-invalid",
        scene_id: sid,
        message: `flow_steps[${fi}] phải là một object hợp lệ.`,
      });
      continue;
    }

    const psOk = isProgressInRange(step.progress_start);
    const peOk = isProgressInRange(step.progress_end);
    if (!psOk || !peOk) {
      errors.push({
        code: "flow-step-progress-bounds",
        scene_id: sid,
        message: `flow_steps[${fi}] có progress_start/progress_end ngoài phạm vi [0..1] (start=${step.progress_start}, end=${step.progress_end}).`,
      });
    } else if (Number(step.progress_start) > Number(step.progress_end)) {
      errors.push({
        code: "flow-step-progress-order",
        scene_id: sid,
        message: `flow_steps[${fi}] có progress_start (${step.progress_start}) > progress_end (${step.progress_end}).`,
      });
    }

    if (Array.isArray(step.active_nodes)) {
      for (const nid of step.active_nodes) {
        if (!nodeIdSet.has(nid)) {
          errors.push({
            code: "flow-step-unknown-node",
            scene_id: sid,
            message: `flow_steps[${fi}].active_nodes tham chiếu node không tồn tại: "${nid}".`,
          });
        }
      }
    }

    if (Array.isArray(step.active_edges)) {
      for (const eid of step.active_edges) {
        if (!edgeIdSet.has(eid)) {
          errors.push({
            code: "flow-step-unknown-edge",
            scene_id: sid,
            message: `flow_steps[${fi}].active_edges tham chiếu edge không tồn tại: "${eid}".`,
          });
        }
      }
    }

    if (step.camera_focus && typeof step.camera_focus === "object") {
      const cx = Number(step.camera_focus.x);
      const cy = Number(step.camera_focus.y);
      if (!Number.isFinite(cx) || cx < 0 || cx > 100 || !Number.isFinite(cy) || cy < 0 || cy > 100) {
        warnings.push({
          code: "camera-focus-bounds",
          scene_id: sid,
          message: `flow_steps[${fi}].camera_focus có tọa độ (x=${step.camera_focus.x}, y=${step.camera_focus.y}) ngoài [0..100].`,
        });
      }
      if (step.camera_focus.zoom !== undefined && step.camera_focus.zoom !== null) {
        const zoom = Number(step.camera_focus.zoom);
        if (!Number.isFinite(zoom) || zoom < 1.0 || zoom > 1.25) {
          warnings.push({
            code: "camera-focus-zoom",
            scene_id: sid,
            message: `flow_steps[${fi}].camera_focus.zoom (${step.camera_focus.zoom}) nên nằm trong [1.0..1.25].`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateConsoleSetupData(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = visualData || {};
  const budget = TEMPLATE_LAYOUT_BUDGETS.console_setup;
  const steps = Array.isArray(data.steps) ? data.steps : null;

  if (!steps || steps.length < budget.minSteps) {
    errors.push(`[${sceneTag}] console_setup requires a non-empty visual_data.steps array.`);
    return { valid: false, errors, warnings };
  }
  if (steps.length > budget.maxSteps) {
    warnings.push({
      code: "console-too-many-steps",
      scene_id: sceneTag,
      message: `console_setup has ${steps.length} steps (recommended max ${budget.maxSteps} to keep stepper bar legible).`,
    });
  }

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (!st || typeof st !== "object") {
      errors.push(`[${sceneTag}] console_setup.steps[${i}] must be an object.`);
      continue;
    }

    const stepNum = Number(st.step_number);
    if (!Number.isFinite(stepNum) || stepNum < 1) {
      errors.push(`[${sceneTag}] console_setup.steps[${i}] requires numeric "step_number" >= 1.`);
    }
    if (!String(st.heading || "").trim()) {
      errors.push(`[${sceneTag}] console_setup.steps[${i}] requires non-empty "heading".`);
    }

    const psOk = isProgressInRange(st.progress_start);
    const peOk = isProgressInRange(st.progress_end);
    if (!psOk || !peOk) {
      errors.push(
        `[${sceneTag}] console_setup.steps[${i}] requires progress_start and progress_end in [0..1] (got start=${st.progress_start}, end=${st.progress_end}).`
      );
    } else if (Number(st.progress_start) > Number(st.progress_end)) {
      errors.push(
        `[${sceneTag}] console_setup.steps[${i}] has progress_start (${st.progress_start}) > progress_end (${st.progress_end}).`
      );
    }

    const fields = Array.isArray(st.fields) ? st.fields : null;
    if (!fields || fields.length === 0) {
      errors.push(`[${sceneTag}] console_setup.steps[${i}] requires a non-empty "fields" array.`);
    } else {
      if (fields.length > budget.maxFieldsPerStep) {
        warnings.push({
          code: "console-too-many-fields",
          scene_id: sceneTag,
          message: `console_setup.steps[${i}] has ${fields.length} fields (recommended max ${budget.maxFieldsPerStep} to avoid vertical overflow).`,
        });
      }
      for (let fi = 0; fi < fields.length; fi++) {
        const f = fields[fi];
        if (!f || !String(f.label || "").trim()) {
          errors.push(`[${sceneTag}] console_setup.steps[${i}].fields[${fi}] requires non-empty "label".`);
          continue;
        }
        if (f.type && f.type !== "text" && f.type !== "radio" && f.type !== "checkbox_row") {
          warnings.push({
            code: "console-unknown-field-type",
            scene_id: sceneTag,
            message: `console_setup.steps[${i}].fields[${fi}] has unknown type "${f.type}" (expected "text" | "radio" | "checkbox_row").`,
          });
        }
        if (f.type === "radio" && (!Array.isArray(f.options) || f.options.length === 0)) {
          errors.push(
            `[${sceneTag}] console_setup.steps[${i}].fields[${fi}] with type="radio" requires non-empty "options" array.`
          );
        }
      }
    }

    if (st.tip && String(st.tip).length > budget.maxTipChars) {
      warnings.push({
        code: "console-long-tip",
        scene_id: sceneTag,
        message: `console_setup.steps[${i}].tip is ${String(st.tip).length} chars (recommended <= ${budget.maxTipChars} chars to avoid footer clipping).`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateCodeCliData(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = visualData || {};
  const budget = TEMPLATE_LAYOUT_BUDGETS.code_cli;

  const codeLines = Array.isArray(data.code_lines) ? data.code_lines : [];
  const phases = Array.isArray(data.highlight_phases) ? data.highlight_phases : [];
  const cmds = Array.isArray(data.terminal_commands) ? data.terminal_commands : [];

  if (data.layout !== undefined && data.layout !== null && data.layout !== "" && data.layout !== "split") {
    warnings.push({
      code: "legacy-layout",
      scene_id: sceneTag,
      message: `Legacy visual_data.layout="${data.layout}" is deprecated; runtime infers layout from code_lines and terminal_commands.`,
    });
  }

  const hasCodeOverride = phases.some((p) =>
    Array.isArray(p?.code_override)
      ? p.code_override.length > 0
      : typeof p?.code_override === "string" && p.code_override.trim().length > 0
  );

  if (codeLines.length === 0 && !hasCodeOverride && cmds.length === 0) {
    errors.push(
      `[${sceneTag}] code_cli requires non-empty visual_data.code_lines (or code_override) or visual_data.terminal_commands.`
    );
    return { valid: false, errors, warnings };
  }

  if (codeLines.length > budget.maxCodeLines) {
    warnings.push({
      code: "code-too-many-lines",
      scene_id: sceneTag,
      message: `code_cli.code_lines has ${codeLines.length} lines (Canvas exporter slices at ${budget.maxCodeLines} lines).`,
    });
  }

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (!p || typeof p !== "object") {
      errors.push(`[${sceneTag}] code_cli.highlight_phases[${i}] must be an object.`);
      continue;
    }

    const psOk = isProgressInRange(p.progress_start);
    const peOk = isProgressInRange(p.progress_end);
    if (!psOk || !peOk) {
      errors.push(
        `[${sceneTag}] code_cli.highlight_phases[${i}] requires progress_start and progress_end in [0..1] (got start=${p.progress_start}, end=${p.progress_end}).`
      );
    } else if (Number(p.progress_start) > Number(p.progress_end)) {
      errors.push(
        `[${sceneTag}] code_cli.highlight_phases[${i}] has progress_start (${p.progress_start}) > progress_end (${p.progress_end}).`
      );
    }

    const activeLineCount = Array.isArray(p.code_override)
      ? p.code_override.length
      : typeof p.code_override === "string"
        ? p.code_override.split("\n").length
        : codeLines.length;

    if (p.code_override && activeLineCount > budget.maxCodeLines) {
      warnings.push({
        code: "code-override-too-many-lines",
        scene_id: sceneTag,
        message: `code_cli.highlight_phases[${i}].code_override has ${activeLineCount} lines (recommended <= ${budget.maxCodeLines}).`,
      });
    }

    if (p.lines !== undefined) {
      if (!Array.isArray(p.lines)) {
        errors.push(`[${sceneTag}] code_cli.highlight_phases[${i}].lines must be an array of 1-based line numbers.`);
      } else {
        for (const ln of p.lines) {
          if (!Number.isInteger(ln) || ln < 1 || activeLineCount === 0 || ln > activeLineCount) {
            errors.push(
              `[${sceneTag}] code_cli.highlight_phases[${i}].lines has invalid 1-based line number ${ln} (active snapshot has ${activeLineCount} lines).`
            );
          }
        }
      }
    }

    if (Array.isArray(p.laser_scan)) {
      for (const ln of p.laser_scan) {
        if (!Number.isInteger(ln) || ln < 1 || activeLineCount === 0 || ln > activeLineCount) {
          errors.push(
            `[${sceneTag}] code_cli.highlight_phases[${i}].laser_scan has invalid 1-based line number ${ln} (active snapshot has ${activeLineCount} lines).`
          );
        }
      }
    }
  }

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c || !String(c.command || "").trim()) {
      errors.push(`[${sceneTag}] code_cli.terminal_commands[${i}] requires non-empty "command".`);
    }
    if (!isProgressInRange(c?.progress_start)) {
      errors.push(
        `[${sceneTag}] code_cli.terminal_commands[${i}] requires progress_start in [0..1] (got ${c?.progress_start}).`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateExamTipsData(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = visualData || {};
  const budget = TEMPLATE_LAYOUT_BUDGETS.exam_tips;

  const comparisons = Array.isArray(data.comparisons) ? data.comparisons : [];
  const quiz = data.quiz && typeof data.quiz === "object" ? data.quiz : null;

  if (comparisons.length === 0 && !quiz) {
    errors.push(`[${sceneTag}] exam_tips requires at least 1 entry in visual_data.comparisons or a valid visual_data.quiz.`);
    return { valid: false, errors, warnings };
  }

  if (comparisons.length > budget.maxComparisons) {
    warnings.push({
      code: "exam-too-many-comparisons",
      scene_id: sceneTag,
      message: `exam_tips has ${comparisons.length} comparisons (2x2 grid displays up to ${budget.maxComparisons} cards cleanly).`,
    });
  }

  for (let i = 0; i < comparisons.length; i++) {
    const cmp = comparisons[i];
    if (!cmp || typeof cmp !== "object") {
      errors.push(`[${sceneTag}] exam_tips.comparisons[${i}] must be an object.`);
      continue;
    }
    if (!String(cmp.wrong || "").trim()) {
      errors.push(`[${sceneTag}] exam_tips.comparisons[${i}] requires non-empty "wrong".`);
    }
    if (!String(cmp.right || "").trim()) {
      errors.push(`[${sceneTag}] exam_tips.comparisons[${i}] requires non-empty "right".`);
    }
    if (!String(cmp.title || "").trim()) {
      warnings.push({
        code: "exam-missing-comparison-title",
        scene_id: sceneTag,
        message: `exam_tips.comparisons[${i}] is missing "title".`,
      });
    }
    if (cmp.progress_start !== undefined && cmp.progress_start !== null && !isProgressInRange(cmp.progress_start)) {
      errors.push(`[${sceneTag}] exam_tips.comparisons[${i}].progress_start must be in [0..1].`);
    }
  }

  if (quiz) {
    if (!String(quiz.question || "").trim()) {
      errors.push(`[${sceneTag}] exam_tips.quiz requires non-empty "question".`);
    }
    const options = Array.isArray(quiz.options) ? quiz.options : null;
    if (!options || options.length < budget.minQuizOptions) {
      errors.push(`[${sceneTag}] exam_tips.quiz.options requires at least ${budget.minQuizOptions} options.`);
    } else {
      if (options.length > budget.maxQuizOptions) {
        warnings.push({
          code: "exam-too-many-quiz-options",
          scene_id: sceneTag,
          message: `exam_tips.quiz has ${options.length} options (recommended max ${budget.maxQuizOptions}).`,
        });
      }
      const optionKeys = new Set();
      for (let oi = 0; oi < options.length; oi++) {
        const opt = options[oi];
        const key = String(opt?.key ?? "").trim();
        const text = String(opt?.text ?? "").trim();
        if (!key || !text) {
          errors.push(`[${sceneTag}] exam_tips.quiz.options[${oi}] requires non-empty "key" and "text".`);
        } else if (optionKeys.has(key)) {
          errors.push(`[${sceneTag}] exam_tips.quiz.options duplicate key "${key}".`);
        } else {
          optionKeys.add(key);
        }
      }
      const correctKey = String(quiz.correct_key ?? "").trim();
      if (!correctKey || !optionKeys.has(correctKey)) {
        errors.push(
          `[${sceneTag}] exam_tips.quiz.correct_key (${JSON.stringify(quiz.correct_key)}) must match one of quiz.options[].key.`
        );
      }
    }

    if (quiz.show_at_progress !== undefined && quiz.show_at_progress !== null && !isProgressInRange(quiz.show_at_progress)) {
      errors.push(`[${sceneTag}] exam_tips.quiz.show_at_progress must be in [0..1].`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateComparisonMatrixData(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = visualData || {};
  const columns = Array.isArray(data.columns) ? data.columns : null;
  const rows = Array.isArray(data.rows) ? data.rows : null;

  if (!columns || columns.length < 2) {
    errors.push(`[${sceneTag}] comparison_matrix requires at least 2 entries in visual_data.columns.`);
    return { valid: false, errors, warnings };
  }
  if (columns.length > 4) {
    errors.push(`[${sceneTag}] comparison_matrix has ${columns.length} columns (max 4 allowed to fit 1080p cleanly).`);
  }

  const colIds = new Set();
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (!col || !col.id || !String(col.title || "").trim()) {
      errors.push(`[${sceneTag}] comparison_matrix.columns[${i}] requires non-empty "id" and "title".`);
      continue;
    }
    if (colIds.has(col.id)) {
      errors.push(`[${sceneTag}] comparison_matrix duplicate column id "${col.id}".`);
    }
    colIds.add(col.id);
  }

  if (!rows || rows.length === 0) {
    errors.push(`[${sceneTag}] comparison_matrix requires at least 1 entry in visual_data.rows.`);
  } else {
    if (rows.length > 6) {
      errors.push(`[${sceneTag}] comparison_matrix has ${rows.length} rows (max 6 allowed to prevent vertical overflow above subtitles).`);
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !String(row.criterion || "").trim()) {
        errors.push(`[${sceneTag}] comparison_matrix.rows[${r}] requires non-empty "criterion".`);
      }
      const values = row?.values;
      if (!values || typeof values !== "object") {
        errors.push(`[${sceneTag}] comparison_matrix.rows[${r}] requires "values" object keyed by column id.`);
        continue;
      }
      for (const id of colIds) {
        const cell = values[id];
        if (!cell || !String(cell.text ?? "").trim()) {
          warnings.push(`[${sceneTag}] comparison_matrix.rows[${r}].values["${id}"] is missing text.`);
        } else if (String(cell.text).length > 95) {
          warnings.push(`[${sceneTag}] comparison_matrix.rows[${r}].values["${id}"] exceeds 95 chars and may wrap heavily.`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateTimelineFlowData(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = visualData || {};
  const orientation = data.orientation ?? "horizontal";
  if (orientation !== "horizontal" && orientation !== "vertical") {
    errors.push(`[${sceneTag}] timeline_flow invalid orientation "${orientation}" (expected "horizontal" or "vertical").`);
  }

  const milestones = Array.isArray(data.milestones) ? data.milestones : null;
  if (!milestones || milestones.length < 2) {
    errors.push(`[${sceneTag}] timeline_flow requires at least 2 milestones in visual_data.milestones.`);
    return { valid: false, errors, warnings };
  }
  if (milestones.length > 6) {
    errors.push(`[${sceneTag}] timeline_flow has ${milestones.length} milestones (max 6 allowed to fit 1080p stage cleanly).`);
  }

  let prevStart = -1;
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (!m || !String(m.title || "").trim()) {
      errors.push(`[${sceneTag}] timeline_flow.milestones[${i}] requires non-empty "title".`);
    }
    if (String(m?.description || "").length > 110) {
      warnings.push(`[${sceneTag}] timeline_flow.milestones[${i}].description exceeds 110 chars.`);
    }
    if (m?.progress_start !== undefined && m?.progress_end !== undefined) {
      const ps = Number(m.progress_start);
      const pe = Number(m.progress_end);
      if (Number.isFinite(ps) && Number.isFinite(pe) && pe < ps) {
        errors.push(`[${sceneTag}] timeline_flow.milestones[${i}] has progress_end (${pe}) < progress_start (${ps}).`);
      }
    }
    if (m?.progress_start !== undefined) {
      const ps = Number(m.progress_start);
      if (Number.isFinite(ps)) {
        if (ps < prevStart) {
          warnings.push(`[${sceneTag}] timeline_flow.milestones[${i}].progress_start (${ps}) is earlier than previous milestone (${prevStart}).`);
        }
        prevStart = ps;
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateKpiMetricsData(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = visualData || {};
  const cards = Array.isArray(data.cards) ? data.cards : null;

  if (!cards || cards.length === 0) {
    errors.push(`[${sceneTag}] kpi_metrics requires at least 1 card in visual_data.cards.`);
    return { valid: false, errors, warnings };
  }
  if (cards.length > 4) {
    errors.push(`[${sceneTag}] kpi_metrics has ${cards.length} cards (max 4 allowed to fit 1080p cleanly).`);
  }

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (!c || !String(c.label || "").trim()) {
      errors.push(`[${sceneTag}] kpi_metrics.cards[${i}] requires non-empty "label".`);
    }
    const hasValue = c?.value !== undefined && c?.value !== null && String(c.value).trim() !== "";
    const hasTarget = Number.isFinite(Number(c?.numeric_target));
    if (!hasValue && !hasTarget) {
      errors.push(`[${sceneTag}] kpi_metrics.cards[${i}] requires "value" or finite "numeric_target".`);
    }
  }

  if (data.chart) {
    const series = Array.isArray(data.chart.series) ? data.chart.series : null;
    if (!series || series.length === 0) {
      errors.push(`[${sceneTag}] kpi_metrics.chart requires non-empty "series" array.`);
    } else {
      if (series.length > 8) {
        errors.push(`[${sceneTag}] kpi_metrics.chart.series has ${series.length} bars (max 8 allowed).`);
      }
      for (let j = 0; j < series.length; j++) {
        const pt = series[j];
        if (!pt || !String(pt.label || "").trim() || !Number.isFinite(Number(pt.value))) {
          errors.push(`[${sceneTag}] kpi_metrics.chart.series[${j}] requires "label" and finite numeric "value".`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function extractVisualPayload(input) {
  if (!input || typeof input !== "object") return {};
  if (
    "visual_data" in input &&
    !("actors" in input || "lanes" in input || "left_lines" in input || "branches" in input)
  ) {
    return input.visual_data && typeof input.visual_data === "object" ? input.visual_data : {};
  }
  return input;
}

export function validateSequenceDiagram(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = extractVisualPayload(visualData);
  const budget = TEMPLATE_LAYOUT_BUDGETS.sequence_diagram;

  const actors = Array.isArray(data.actors) ? data.actors : null;
  if (!actors || actors.length < budget.minActors) {
    errors.push(`[${sceneTag}] sequence_diagram requires at least ${budget.minActors} actors in visual_data.actors.`);
    return { valid: false, errors, warnings };
  }
  if (actors.length > budget.maxActors) {
    errors.push(
      `[${sceneTag}] sequence_diagram has ${actors.length} actors (max ${budget.maxActors} allowed to fit 1080p lifelines cleanly).`
    );
  }

  const actorIds = new Set();
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    const id = String(a?.id ?? "").trim();
    const label = String(a?.label ?? "").trim();
    if (!a || !id || !label) {
      errors.push(`[${sceneTag}] sequence_diagram.actors[${i}] requires non-empty "id" and "label".`);
      continue;
    }
    if (actorIds.has(id)) {
      errors.push(`[${sceneTag}] sequence_diagram duplicate actor id "${id}".`);
    } else {
      actorIds.add(id);
    }
  }

  const messages = Array.isArray(data.messages) ? data.messages : null;
  const msgIdSet = new Set();
  const validStyles = new Set(budget.styles);
  if (!messages || messages.length < budget.minMessages) {
    errors.push(`[${sceneTag}] sequence_diagram requires at least ${budget.minMessages} message in visual_data.messages.`);
  } else {
    if (messages.length > budget.maxMessages) {
      errors.push(
        `[${sceneTag}] sequence_diagram has ${messages.length} messages (max ${budget.maxMessages} allowed to prevent vertical overflow).`
      );
    }
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!m || typeof m !== "object") {
        errors.push(`[${sceneTag}] sequence_diagram.messages[${i}] must be an object.`);
        continue;
      }
      if (m.id !== undefined && m.id !== null && String(m.id).trim() !== "") {
        const mid = String(m.id).trim();
        if (msgIdSet.has(mid)) {
          errors.push(`[${sceneTag}] sequence_diagram duplicate message id "${mid}".`);
        }
        msgIdSet.add(mid);
      }
      const from = String(m.from ?? "").trim();
      const to = String(m.to ?? "").trim();
      if (!from || !actorIds.has(from)) {
        errors.push(`[${sceneTag}] sequence_diagram.messages[${i}].from references unknown actor "${m.from}".`);
      }
      if (!to || !actorIds.has(to)) {
        errors.push(`[${sceneTag}] sequence_diagram.messages[${i}].to references unknown actor "${m.to}".`);
      }
      const label = String(m.label ?? "").trim();
      if (!label) {
        errors.push(`[${sceneTag}] sequence_diagram.messages[${i}] requires non-empty "label".`);
      } else if (label.length > budget.maxLabelChars) {
        warnings.push({
          code: "sequence-long-label",
          scene_id: sceneTag,
          message: `sequence_diagram.messages[${i}].label is ${label.length} chars (recommended <= ${budget.maxLabelChars}).`,
        });
      }
      if (m.detail && String(m.detail).length > budget.maxDetailChars) {
        warnings.push({
          code: "sequence-long-detail",
          scene_id: sceneTag,
          message: `sequence_diagram.messages[${i}].detail exceeds ${budget.maxDetailChars} chars.`,
        });
      }
      if (m.style !== undefined && m.style !== null && String(m.style).trim() !== "" && !validStyles.has(m.style)) {
        warnings.push({
          code: "sequence-unknown-style",
          scene_id: sceneTag,
          message: `sequence_diagram.messages[${i}].style "${m.style}" is not one of ${budget.styles.join("|")}.`,
        });
      }
      const psOk = isProgressInRange(m.progress_start);
      const peOk = isProgressInRange(m.progress_end);
      if (!psOk || !peOk) {
        errors.push(
          `[${sceneTag}] sequence_diagram.messages[${i}] requires progress_start and progress_end in [0..1] (got start=${m.progress_start}, end=${m.progress_end}).`
        );
      } else if (Number(m.progress_start) > Number(m.progress_end)) {
        errors.push(
          `[${sceneTag}] sequence_diagram.messages[${i}] has progress_start (${m.progress_start}) > progress_end (${m.progress_end}).`
        );
      }
    }
  }

  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  if (highlights.length > budget.maxHighlights) {
    warnings.push({
      code: "sequence-too-many-highlights",
      scene_id: sceneTag,
      message: `sequence_diagram has ${highlights.length} highlights (recommended max ${budget.maxHighlights}).`,
    });
  }
  const validHlTones = new Set(budget.highlightTones);
  const msgCount = messages ? messages.length : 0;
  const resolveMsgRef = (ref, fieldName, hi) => {
    if (ref === undefined || ref === null || ref === "") return null;
    if (typeof ref === "number") {
      if (!Number.isInteger(ref) || ref < 0 || ref > msgCount) {
        errors.push(`[${sceneTag}] sequence_diagram.highlights[${hi}].${fieldName} index ${ref} out of range.`);
        return null;
      }
      return ref;
    }
    const s = String(ref).trim();
    if (msgIdSet.has(s)) return s;
    if (/^\d+$/.test(s)) {
      const idx = Number(s);
      if (idx >= 0 && idx <= msgCount) return idx;
    }
    errors.push(`[${sceneTag}] sequence_diagram.highlights[${hi}].${fieldName} references unknown message "${ref}".`);
    return null;
  };

  for (let hi = 0; hi < highlights.length; hi++) {
    const hl = highlights[hi];
    if (!hl || typeof hl !== "object") {
      errors.push(`[${sceneTag}] sequence_diagram.highlights[${hi}] must be an object.`);
      continue;
    }
    if (!String(hl.label ?? "").trim()) {
      errors.push(`[${sceneTag}] sequence_diagram.highlights[${hi}] requires non-empty "label".`);
    }
    if (hl.show_at_progress !== undefined && hl.show_at_progress !== null && !isProgressInRange(hl.show_at_progress)) {
      errors.push(`[${sceneTag}] sequence_diagram.highlights[${hi}].show_at_progress must be in [0..1].`);
    }
    if (hl.tone && !validHlTones.has(hl.tone)) {
      warnings.push({
        code: "sequence-unknown-highlight-tone",
        scene_id: sceneTag,
        message: `sequence_diagram.highlights[${hi}].tone "${hl.tone}" should be danger|warn|info|success.`,
      });
    }
    resolveMsgRef(hl.from_msg, "from_msg", hi);
    resolveMsgRef(hl.to_msg, "to_msg", hi);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateMemoryLayout(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = extractVisualPayload(visualData);
  const budget = TEMPLATE_LAYOUT_BUDGETS.memory_layout;
  const validStates = new Set(budget.cellStates);

  const lanes = Array.isArray(data.lanes) ? data.lanes : null;
  if (!lanes || lanes.length < budget.minLanes) {
    errors.push(`[${sceneTag}] memory_layout requires at least ${budget.minLanes} lane in visual_data.lanes.`);
    return { valid: false, errors, warnings };
  }
  if (lanes.length > budget.maxLanes) {
    errors.push(
      `[${sceneTag}] memory_layout has ${lanes.length} lanes (max ${budget.maxLanes} allowed to fit 1080p stage cleanly).`
    );
  }

  const laneCellMap = new Map();
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    const lid = String(lane?.id ?? "").trim();
    const llabel = String(lane?.label ?? "").trim();
    if (!lane || !lid || !llabel) {
      errors.push(`[${sceneTag}] memory_layout.lanes[${li}] requires non-empty "id" and "label".`);
      continue;
    }
    if (laneCellMap.has(lid)) {
      errors.push(`[${sceneTag}] memory_layout duplicate lane id "${lid}".`);
      continue;
    }
    const cells = Array.isArray(lane.cells) ? lane.cells : null;
    if (!cells || cells.length < budget.minCellsPerLane) {
      errors.push(`[${sceneTag}] memory_layout.lanes[${li}] requires at least ${budget.minCellsPerLane} cell.`);
      laneCellMap.set(lid, new Set());
      continue;
    }
    if (cells.length > budget.maxCellsPerLane) {
      errors.push(
        `[${sceneTag}] memory_layout.lanes[${li}] has ${cells.length} cells (max ${budget.maxCellsPerLane} allowed).`
      );
    }
    const cellIds = new Set();
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const cid = String(cell?.id ?? "").trim();
      const clabel = String(cell?.label ?? "").trim();
      if (!cell || !cid || !clabel) {
        errors.push(`[${sceneTag}] memory_layout.lanes[${li}].cells[${ci}] requires non-empty "id" and "label".`);
        continue;
      }
      if (cellIds.has(cid)) {
        errors.push(`[${sceneTag}] memory_layout.lanes[${li}] duplicate cell id "${cid}".`);
      } else {
        cellIds.add(cid);
      }
      if (cell.state !== undefined && cell.state !== null && cell.state !== "" && !validStates.has(cell.state)) {
        warnings.push({
          code: "memory-unknown-cell-state",
          scene_id: sceneTag,
          message: `memory_layout.lanes[${li}].cells[${ci}].state "${cell.state}" should be ${budget.cellStates.join("|")}.`,
        });
      }
    }
    laneCellMap.set(lid, cellIds);
  }

  const checkCellRef = (laneId, cellId, ctxLabel) => {
    const lid = String(laneId ?? "").trim();
    const cid = String(cellId ?? "").trim();
    const cells = laneCellMap.get(lid);
    if (!cells) {
      errors.push(`[${sceneTag}] ${ctxLabel} references unknown lane_id "${laneId}".`);
      return false;
    }
    if (!cells.has(cid)) {
      errors.push(`[${sceneTag}] ${ctxLabel} references unknown cell_id "${cellId}" in lane "${lid}".`);
      return false;
    }
    return true;
  };

  const steps = Array.isArray(data.steps) ? data.steps : null;
  if (!steps || steps.length < budget.minSteps) {
    errors.push(`[${sceneTag}] memory_layout requires at least ${budget.minSteps} step in visual_data.steps.`);
  } else {
    if (steps.length > budget.maxSteps) {
      errors.push(`[${sceneTag}] memory_layout has ${steps.length} steps (max ${budget.maxSteps} allowed).`);
    }
    for (let si = 0; si < steps.length; si++) {
      const st = steps[si];
      if (!st || typeof st !== "object") {
        errors.push(`[${sceneTag}] memory_layout.steps[${si}] must be an object.`);
        continue;
      }
      if (!String(st.label ?? "").trim()) {
        errors.push(`[${sceneTag}] memory_layout.steps[${si}] requires non-empty "label".`);
      }
      const psOk = isProgressInRange(st.progress_start);
      const peOk = isProgressInRange(st.progress_end);
      if (!psOk || !peOk) {
        errors.push(
          `[${sceneTag}] memory_layout.steps[${si}] requires progress_start and progress_end in [0..1] (got start=${st.progress_start}, end=${st.progress_end}).`
        );
      } else if (Number(st.progress_start) > Number(st.progress_end)) {
        errors.push(
          `[${sceneTag}] memory_layout.steps[${si}] has progress_start (${st.progress_start}) > progress_end (${st.progress_end}).`
        );
      }
      if (st.callout && String(st.callout).length > budget.maxCalloutChars) {
        warnings.push({
          code: "memory-long-callout",
          scene_id: sceneTag,
          message: `memory_layout.steps[${si}].callout exceeds ${budget.maxCalloutChars} chars.`,
        });
      }
      if (Array.isArray(st.highlight_cells)) {
        for (let hi = 0; hi < st.highlight_cells.length; hi++) {
          const hc = st.highlight_cells[hi];
          if (!hc || typeof hc !== "object") {
            errors.push(`[${sceneTag}] memory_layout.steps[${si}].highlight_cells[${hi}] must be an object.`);
            continue;
          }
          checkCellRef(hc.lane_id, hc.cell_id, `memory_layout.steps[${si}].highlight_cells[${hi}]`);
          if (hc.state && !validStates.has(hc.state)) {
            warnings.push({
              code: "memory-unknown-highlight-state",
              scene_id: sceneTag,
              message: `memory_layout.steps[${si}].highlight_cells[${hi}].state "${hc.state}" is non-standard.`,
            });
          }
        }
      }
      if (Array.isArray(st.pointers)) {
        for (let pi = 0; pi < st.pointers.length; pi++) {
          const ptr = st.pointers[pi];
          if (!ptr || typeof ptr !== "object") {
            errors.push(`[${sceneTag}] memory_layout.steps[${si}].pointers[${pi}] must be an object.`);
            continue;
          }
          checkCellRef(ptr.from_lane, ptr.from_cell, `memory_layout.steps[${si}].pointers[${pi}] (from)`);
          checkCellRef(ptr.to_lane, ptr.to_cell, `memory_layout.steps[${si}].pointers[${pi}] (to)`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateCodeDiff(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = extractVisualPayload(visualData);
  const budget = TEMPLATE_LAYOUT_BUDGETS.code_diff;
  const validTones = new Set(budget.tones);

  if (!String(data.left_title ?? "").trim()) {
    errors.push(`[${sceneTag}] code_diff requires non-empty "left_title".`);
  }
  if (!String(data.right_title ?? "").trim()) {
    errors.push(`[${sceneTag}] code_diff requires non-empty "right_title".`);
  }

  const leftLines = Array.isArray(data.left_lines) ? data.left_lines : null;
  const rightLines = Array.isArray(data.right_lines) ? data.right_lines : null;

  if (!leftLines || leftLines.length < budget.minLines) {
    errors.push(`[${sceneTag}] code_diff requires non-empty "left_lines" (${budget.minLines}..${budget.maxLines} lines).`);
  } else {
    if (leftLines.length > budget.maxLines) {
      errors.push(
        `[${sceneTag}] code_diff.left_lines has ${leftLines.length} lines (max ${budget.maxLines} allowed to fit 1080p diff panes).`
      );
    }
    leftLines.forEach((ln, idx) => {
      if (String(ln ?? "").length > budget.maxLineChars) {
        warnings.push({
          code: "diff-long-left-line",
          scene_id: sceneTag,
          message: `code_diff.left_lines[${idx}] exceeds ${budget.maxLineChars} chars and may wrap.`,
        });
      }
    });
  }

  if (!rightLines || rightLines.length < budget.minLines) {
    errors.push(`[${sceneTag}] code_diff requires non-empty "right_lines" (${budget.minLines}..${budget.maxLines} lines).`);
  } else {
    if (rightLines.length > budget.maxLines) {
      errors.push(
        `[${sceneTag}] code_diff.right_lines has ${rightLines.length} lines (max ${budget.maxLines} allowed to fit 1080p diff panes).`
      );
    }
    rightLines.forEach((ln, idx) => {
      if (String(ln ?? "").length > budget.maxLineChars) {
        warnings.push({
          code: "diff-long-right-line",
          scene_id: sceneTag,
          message: `code_diff.right_lines[${idx}] exceeds ${budget.maxLineChars} chars and may wrap.`,
        });
      }
    });
  }

  const leftLen = leftLines ? leftLines.length : 0;
  const rightLen = rightLines ? rightLines.length : 0;
  const steps = Array.isArray(data.focus_steps) ? data.focus_steps : null;
  if (!steps || steps.length < budget.minFocusSteps) {
    errors.push(`[${sceneTag}] code_diff requires at least ${budget.minFocusSteps} entry in visual_data.focus_steps.`);
  } else {
    if (steps.length > budget.maxFocusSteps) {
      errors.push(`[${sceneTag}] code_diff.focus_steps has ${steps.length} items (max ${budget.maxFocusSteps} allowed).`);
    }
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (!st || typeof st !== "object") {
        errors.push(`[${sceneTag}] code_diff.focus_steps[${i}] must be an object.`);
        continue;
      }
      const callout = String(st.callout ?? "").trim();
      if (!callout) {
        errors.push(`[${sceneTag}] code_diff.focus_steps[${i}] requires non-empty "callout".`);
      } else if (callout.length > budget.maxCalloutChars) {
        warnings.push({
          code: "diff-long-callout",
          scene_id: sceneTag,
          message: `code_diff.focus_steps[${i}].callout exceeds ${budget.maxCalloutChars} chars.`,
        });
      }
      const psOk = isProgressInRange(st.progress_start);
      const peOk = isProgressInRange(st.progress_end);
      if (!psOk || !peOk) {
        errors.push(
          `[${sceneTag}] code_diff.focus_steps[${i}] requires progress_start and progress_end in [0..1] (got start=${st.progress_start}, end=${st.progress_end}).`
        );
      } else if (Number(st.progress_start) > Number(st.progress_end)) {
        errors.push(
          `[${sceneTag}] code_diff.focus_steps[${i}] has progress_start (${st.progress_start}) > progress_end (${st.progress_end}).`
        );
      }
      if (st.tone !== undefined && st.tone !== null && st.tone !== "" && !validTones.has(st.tone)) {
        warnings.push({
          code: "diff-unknown-tone",
          scene_id: sceneTag,
          message: `code_diff.focus_steps[${i}].tone "${st.tone}" should be danger|success|info.`,
        });
      }
      if (st.left_lines !== undefined) {
        if (!Array.isArray(st.left_lines)) {
          errors.push(`[${sceneTag}] code_diff.focus_steps[${i}].left_lines must be an array of 1-based line numbers.`);
        } else {
          for (const ln of st.left_lines) {
            if (!Number.isInteger(ln) || ln < 1 || (leftLen > 0 && ln > leftLen)) {
              errors.push(
                `[${sceneTag}] code_diff.focus_steps[${i}].left_lines has invalid 1-based line number ${ln} (left_lines has ${leftLen} lines).`
              );
            }
          }
        }
      }
      if (st.right_lines !== undefined) {
        if (!Array.isArray(st.right_lines)) {
          errors.push(`[${sceneTag}] code_diff.focus_steps[${i}].right_lines must be an array of 1-based line numbers.`);
        } else {
          for (const ln of st.right_lines) {
            if (!Number.isInteger(ln) || ln < 1 || (rightLen > 0 && ln > rightLen)) {
              errors.push(
                `[${sceneTag}] code_diff.focus_steps[${i}].right_lines has invalid 1-based line number ${ln} (right_lines has ${rightLen} lines).`
              );
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateConceptBreakdown(visualData, sceneTag = "scene") {
  const errors = [];
  const warnings = [];
  const data = extractVisualPayload(visualData);
  const budget = TEMPLATE_LAYOUT_BUDGETS.concept_breakdown;

  if (data.mode !== undefined && data.mode !== null && data.mode !== "" && !budget.modes.includes(data.mode)) {
    errors.push(
      `[${sceneTag}] concept_breakdown invalid mode "${data.mode}" (expected ${budget.modes.join(" | ")}).`
    );
  }

  const core = data.core;
  if (!core || typeof core !== "object" || !String(core.label ?? "").trim()) {
    errors.push(`[${sceneTag}] concept_breakdown requires visual_data.core with non-empty "label".`);
  } else if (core.code_snippet && String(core.code_snippet).split("\n").length > budget.maxCoreCodeLines) {
    warnings.push({
      code: "breakdown-long-core-snippet",
      scene_id: sceneTag,
      message: `concept_breakdown.core.code_snippet exceeds ${budget.maxCoreCodeLines} lines.`,
    });
  }

  const branches = Array.isArray(data.branches) ? data.branches : null;
  if (!branches || branches.length < budget.minBranches) {
    errors.push(
      `[${sceneTag}] concept_breakdown requires at least ${budget.minBranches} branches in visual_data.branches.`
    );
    return { valid: false, errors, warnings };
  }
  if (branches.length > budget.maxBranches) {
    errors.push(
      `[${sceneTag}] concept_breakdown has ${branches.length} branches (max ${budget.maxBranches} allowed to fit 1080p stage cleanly).`
    );
  }

  const branchIds = new Set();
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    if (!b || typeof b !== "object") {
      errors.push(`[${sceneTag}] concept_breakdown.branches[${i}] must be an object.`);
      continue;
    }
    const bid = String(b.id ?? "").trim();
    if (!bid) {
      errors.push(`[${sceneTag}] concept_breakdown.branches[${i}] requires non-empty "id".`);
    } else if (branchIds.has(bid)) {
      errors.push(`[${sceneTag}] concept_breakdown duplicate branch id "${bid}".`);
    } else {
      branchIds.add(bid);
    }
    if (!String(b.label ?? "").trim()) {
      errors.push(`[${sceneTag}] concept_breakdown.branches[${i}] requires non-empty "label".`);
    }
    const detail = String(b.detail ?? "").trim();
    if (!detail) {
      errors.push(`[${sceneTag}] concept_breakdown.branches[${i}] requires non-empty "detail".`);
    } else if (detail.length > budget.maxDetailChars) {
      warnings.push({
        code: "breakdown-long-detail",
        scene_id: sceneTag,
        message: `concept_breakdown.branches[${i}].detail exceeds ${budget.maxDetailChars} chars.`,
      });
    }
    const psOk = isProgressInRange(b.progress_start);
    const peOk = isProgressInRange(b.progress_end);
    if (!psOk || !peOk) {
      errors.push(
        `[${sceneTag}] concept_breakdown.branches[${i}] requires progress_start and progress_end in [0..1] (got start=${b.progress_start}, end=${b.progress_end}).`
      );
    } else if (Number(b.progress_start) > Number(b.progress_end)) {
      errors.push(
        `[${sceneTag}] concept_breakdown.branches[${i}] has progress_start (${b.progress_start}) > progress_end (${b.progress_end}).`
      );
    }
  }

  if (data.takeaway !== undefined && data.takeaway !== null) {
    if (typeof data.takeaway !== "object" || !String(data.takeaway.text ?? "").trim()) {
      errors.push(`[${sceneTag}] concept_breakdown.takeaway requires non-empty "text" when provided.`);
    } else if (
      data.takeaway.show_at_progress !== undefined &&
      data.takeaway.show_at_progress !== null &&
      !isProgressInRange(data.takeaway.show_at_progress)
    ) {
      errors.push(`[${sceneTag}] concept_breakdown.takeaway.show_at_progress must be in [0..1].`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a single scene (template payload + scene metadata).
 */
export function validateSingleScene(scene, index = 0) {
  const fallbackTag = `scene_${index + 1}`;
  if (!scene || typeof scene !== "object") {
    return {
      valid: false,
      errors: [`[${fallbackTag}] Scene must be an object.`],
      warnings: [],
      scene_id: fallbackTag,
      visual_type: null,
      is_architecture: false,
    };
  }

  const rawId = typeof scene.id === "string" ? scene.id.trim() : "";
  const tag = rawId || fallbackTag;
  const vtype = scene.visual_type || "architecture";
  const errors = [];
  const warnings = [];

  if (!SUPPORTED_VISUAL_SET.has(vtype)) {
    errors.push(`[${tag}] Unsupported visual_type "${vtype}". Supported: ${SUPPORTED_VISUAL_TYPES.join(", ")}`);
  } else if (vtype === "architecture") {
    const res = validateArchitectureData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "console_setup") {
    const res = validateConsoleSetupData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "code_cli") {
    const res = validateCodeCliData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "exam_tips") {
    const res = validateExamTipsData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "comparison_matrix") {
    const res = validateComparisonMatrixData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "timeline_flow") {
    const res = validateTimelineFlowData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "kpi_metrics") {
    const res = validateKpiMetricsData(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "sequence_diagram") {
    const res = validateSequenceDiagram(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "memory_layout") {
    const res = validateMemoryLayout(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "code_diff") {
    const res = validateCodeDiff(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  } else if (vtype === "concept_breakdown") {
    const res = validateConceptBreakdown(scene.visual_data, tag);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  }

  // Scene metadata validation (appended after visual_data checks to preserve visual error ordering)
  if (!rawId) {
    errors.push(`[${tag}] Scene requires non-empty string "id".`);
  }
  if (!VALID_PART_SET.has(scene.part)) {
    errors.push(
      `[${tag}] Scene requires valid "part" (${VALID_SCENE_PARTS.join(" | ")}), got ${JSON.stringify(scene.part)}.`
    );
  }
  if (typeof scene.narration !== "string" || !scene.narration.trim()) {
    errors.push(`[${tag}] Scene requires non-empty "narration".`);
  }

  // Optional editorial & motion metadata checks (warnings only for backward compatibility)
  if (scene.visual_job !== undefined && scene.visual_job !== null && String(scene.visual_job).trim() !== "") {
    if (!VALID_VISUAL_JOB_SET.has(String(scene.visual_job).trim())) {
      warnings.push(
        `[${tag}] Unknown visual_job ${JSON.stringify(scene.visual_job)} (expected ${VALID_VISUAL_JOBS.join(" | ")}).`
      );
    }
  }
  if (scene.world_theme !== undefined && scene.world_theme !== null && String(scene.world_theme).trim() !== "") {
    if (!VALID_WORLD_THEME_SET.has(String(scene.world_theme).trim())) {
      warnings.push(
        `[${tag}] Unknown world_theme ${JSON.stringify(scene.world_theme)} (expected ${VALID_WORLD_THEMES.join(" | ")}).`
      );
    }
  }

  const narrationWords = typeof scene.narration === "string"
    ? scene.narration.trim().split(/\s+/).filter(Boolean).length
    : 0;
  if (narrationWords > 28 && scene.visual_data && typeof scene.visual_data === "object") {
    const vd = scene.visual_data;
    const stepCount =
      (Array.isArray(vd.flow_steps) ? vd.flow_steps.length : 0) +
      (Array.isArray(vd.steps) ? vd.steps.length : 0) +
      (Array.isArray(vd.highlight_phases) ? vd.highlight_phases.length : 0) +
      (Array.isArray(vd.comparisons) ? vd.comparisons.length : 0) +
      (Array.isArray(vd.rows) ? vd.rows.length : 0) +
      (Array.isArray(vd.milestones) ? vd.milestones.length : 0) +
      (Array.isArray(vd.cards) ? vd.cards.length : 0) +
      (Array.isArray(vd.messages) ? vd.messages.length : 0) +
      (Array.isArray(vd.focus_steps) ? vd.focus_steps.length : 0) +
      (Array.isArray(vd.branches) ? vd.branches.length : 0);
    if (stepCount <= 1) {
      warnings.push(
        `[${tag}] Long narration (${narrationWords} words) with <= 1 animation step may cause >3.5s static hold; consider adding more sub-steps.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    scene_id: tag,
    visual_type: vtype,
    is_architecture: vtype === "architecture",
  };
}

/**
 * Validate all scenes inside a script.json object across all 11 templates,
 * including non-blocking Visual Variety Guard warnings.
 */
export function validateScriptDiagrams(scriptJson) {
  const scenes = Array.isArray(scriptJson?.scenes) ? scriptJson.scenes : [];
  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  const validScenes = [];
  let sceneCount = 0;
  let architectureCount = 0;

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    if (!scene) continue;
    validScenes.push({ scene, idx });
    const res = validateSingleScene(scene, idx);
    if (res.visual_type && SUPPORTED_VISUAL_SET.has(res.visual_type)) {
      sceneCount++;
    }
    if (res.is_architecture) {
      architectureCount++;
    }
    errors.push(...res.errors);
    warnings.push(...res.warnings);

    const rawId = typeof scene.id === "string" ? scene.id.trim() : "";
    if (rawId) {
      if (seenIds.has(rawId)) {
        errors.push(`[${rawId}] Duplicate scene.id "${rawId}".`);
      } else {
        seenIds.add(rawId);
      }
    }
  }

  // Visual Variety Guard (non-blocking warnings only)
  if (validScenes.length > 1) {
    for (let i = 1; i < validScenes.length; i++) {
      const prev = validScenes[i - 1].scene;
      const cur = validScenes[i].scene;
      const prevType = prev?.visual_type || "architecture";
      const curType = cur?.visual_type || "architecture";
      if (prevType !== curType) continue;

      const isCodeCliLabContinuation =
        curType === "code_cli" &&
        (cur?.part === "setup" ||
          prev?.part === "setup" ||
          Boolean(cur?.continuation || cur?.is_continuation || cur?.visual_data?.continuation) ||
          (cur?.source_part && prev?.source_part && cur.source_part !== prev.source_part));
      if (isCodeCliLabContinuation) continue;

      const curTag = (typeof cur?.id === "string" && cur.id.trim()) || `scene_${validScenes[i].idx + 1}`;
      warnings.push({
        code: "duplicate-adjacent-visual-type",
        scene_id: curTag,
        message: `[${curTag}] Hai scene liên tiếp dùng cùng visual_type "${curType}" (nên luân phiên template khác nhau trừ khi nối tiếp lab code_cli).`,
      });
    }
  }

  if (validScenes.length >= 4) {
    const distinctTypes = new Set(validScenes.map(({ scene }) => scene?.visual_type || "architecture"));
    if (distinctTypes.size < 3) {
      const firstTag =
        (typeof validScenes[0]?.scene?.id === "string" && validScenes[0].scene.id.trim()) || "script";
      warnings.push({
        code: "low-visual-variety",
        scene_id: firstTag,
        message: `Script có ${validScenes.length} scenes nhưng chỉ dùng ${distinctTypes.size} loại visual_type (${[...distinctTypes].join(", ")}); nên dùng >= 3 loại template khác nhau để tránh đơn điệu.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    scene_count: sceneCount,
    architecture_count: architectureCount,
  };
}
