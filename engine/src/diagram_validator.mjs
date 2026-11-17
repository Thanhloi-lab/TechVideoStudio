// Pure ESM Architecture Diagram & Visual Template Validator (Node.js & Browser safe; zero DOM dependencies).
// Uses canonical 1000x560 geometry and template tokens from motion/kernel.mjs and SSOT rules from template_schema.mjs.

import { computeArchitectureLayout, SUPPORTED_VISUAL_TYPES } from "./motion/kernel.mjs";
import { TEMPLATE_LAYOUT_BUDGETS, VALID_SCENE_PARTS } from "./template_schema.mjs";

const CANONICAL_W = 1000;
const CANONICAL_H = 560;
const VALID_PART_SET = new Set(VALID_SCENE_PARTS);
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
 * Validate all scenes inside a script.json object across all 7 templates.
 */
export function validateScriptDiagrams(scriptJson) {
  const scenes = Array.isArray(scriptJson?.scenes) ? scriptJson.scenes : [];
  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  let sceneCount = 0;
  let architectureCount = 0;

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    if (!scene) continue;
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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    scene_count: sceneCount,
    architecture_count: architectureCount,
  };
}
