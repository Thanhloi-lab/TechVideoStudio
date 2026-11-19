import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateScriptDiagrams } from "./diagram_validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_SVG_DIR = path.resolve(__dirname, "..", "assets", "svg");

/** Load the SVG illustration catalog from engine/assets/svg/catalog.json. */
export function loadSvgCatalog(svgDir = DEFAULT_SVG_DIR) {
  const catalogPath = path.join(svgDir, "catalog.json");
  let entries = [];
  if (fs.existsSync(catalogPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      if (Array.isArray(parsed?.svgs)) {
        entries = parsed.svgs;
      }
    } catch {
      entries = [];
    }
  }
  return entries.map((item) => {
    const id = String(item?.id || "").trim();
    const file = String(item?.file || (id ? `${id}.svg` : "")).trim();
    const exists = Boolean(file && fs.existsSync(path.join(svgDir, file)));
    return {
      id,
      file,
      label: String(item?.label || id),
      category: String(item?.category || "general"),
      keywords: Array.isArray(item?.keywords) ? item.keywords : [],
      exists,
    };
  });
}

/** Verify that every node.svg referenced in script.json exists in engine/assets/svg/. */
export function findMissingScriptSvgs(scriptJson, svgDir = DEFAULT_SVG_DIR) {
  const errors = [];
  const scenes = Array.isArray(scriptJson?.scenes) ? scriptJson.scenes : [];
  for (const scene of scenes) {
    if (!scene || scene.visual_type !== "architecture") continue;
    const nodes = Array.isArray(scene.visual_data?.nodes) ? scene.visual_data.nodes : [];
    for (const node of nodes) {
      if (!node || node.svg === undefined || node.svg === null || node.svg === "") continue;
      const slug = String(node.svg).trim().replace(/\.svg$/i, "");
      if (!/^[a-z0-9_-]+$/i.test(slug)) {
        errors.push({
          code: "invalid-svg-id",
          scene_id: scene.id || null,
          message: `Node "${node.id || "?"}" có svg="${node.svg}" không hợp lệ (chỉ dùng [a-z0-9_-]).`,
        });
        continue;
      }
      const svgPath = path.join(svgDir, `${slug}.svg`);
      if (!fs.existsSync(svgPath)) {
        errors.push({
          code: "missing-svg-asset",
          scene_id: scene.id || null,
          message: `Thiếu file SVG minh họa "${slug}.svg" trong engine/assets/svg/ cho node "${node.id || "?"}". Hãy kiểm tra catalog.json và tìm/bổ sung SVG trước khi nộp kịch bản.`,
        });
      }
    }
  }
  return errors;
}

/** Run structural diagram validation plus on-disk SVG catalog existence checks. */
export function validateScriptWithSvgs(scriptJson, svgDir = DEFAULT_SVG_DIR) {
  const base = validateScriptDiagrams(scriptJson);
  const svgErrors = findMissingScriptSvgs(scriptJson, svgDir);
  if (!svgErrors.length) return base;
  const errors = [...(base.errors || []), ...svgErrors];
  return {
    ...base,
    valid: errors.length === 0,
    errors,
  };
}
