// Pure ESM Architecture Diagram & Visual Template Validator (Node.js & Browser safe; zero DOM dependencies).
// Uses canonical 1000x560 geometry and template tokens from motion/kernel.mjs to detect overlaps, collisions, and overflow risks.

import { computeArchitectureLayout, SUPPORTED_VISUAL_TYPES } from "./motion/kernel.mjs";

const CANONICAL_W = 1000;
const CANONICAL_H = 560;

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
  for (const n of rawNodes) {
    if (!n) continue;
    const nx = Number(n.x);
    const ny = Number(n.y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || nx > 100 || ny < 0 || ny > 100) {
      errors.push({
        code: "node-out-of-bounds",
        scene_id: sid,
        message: `Node "${n.id || n.label || "?"}" có tọa độ ngoài phạm vi 0..100 (x=${n.x}, y=${n.y}).`,
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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all architecture scenes inside a script.json object.
 */
const SUPPORTED_VISUAL_SET = new Set(SUPPORTED_VISUAL_TYPES);

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

export function validateScriptDiagrams(scriptJson) {
  const scenes = Array.isArray(scriptJson?.scenes) ? scriptJson.scenes : [];
  const errors = [];
  const warnings = [];
  let sceneCount = 0;
  let architectureCount = 0;

  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    if (!scene) continue;
    const tag = scene.id || `scene_${idx + 1}`;
    const vtype = scene.visual_type || "architecture";

    if (!SUPPORTED_VISUAL_SET.has(vtype)) {
      errors.push(`[${tag}] Unsupported visual_type "${vtype}". Supported: ${SUPPORTED_VISUAL_TYPES.join(", ")}`);
      continue;
    }

    if (vtype === "architecture") {
      sceneCount++;
      architectureCount++;
      const res = validateArchitectureData(scene.visual_data, tag);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
    } else if (vtype === "comparison_matrix") {
      sceneCount++;
      const res = validateComparisonMatrixData(scene.visual_data, tag);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
    } else if (vtype === "timeline_flow") {
      sceneCount++;
      const res = validateTimelineFlowData(scene.visual_data, tag);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
    } else if (vtype === "kpi_metrics") {
      sceneCount++;
      const res = validateKpiMetricsData(scene.visual_data, tag);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
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
