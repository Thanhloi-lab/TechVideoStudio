// comparison_matrix — DOM + GSAP scene builder (HyperFrames composition).
// Reference implementation of the scene-module contract (see engine/HYPERFRAMES_ENGINE.md §6):
//   export default function build(ctx) — creates DOM inside ctx.stage and adds tweens to ctx.tl
//   at ABSOLUTE times (ctx.at(progress)). No callbacks, no randomness, no wall clock.

import { computeComparisonMatrixState } from "../kernel.mjs";

const STYLE_ID = "tvs-style-comparison-matrix";
const CSS = `
.cm { position: absolute; inset: 0; display: flex; flex-direction: column; }
.cm__head { display: flex; align-items: center; gap: 18px; height: 38px; }
.cm__title { font: 500 20px var(--tvs-font); color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cm__table { position: relative; margin-top: 14px; display: grid; column-gap: 14px; row-gap: 10px; align-content: start; }
.cm__cell { position: relative; border-radius: 12px; border: 1.2px solid rgba(148,163,184,0.22); background: rgba(9,17,34,0.78);
  display: flex; align-items: center; padding: 10px 18px; min-height: 58px; }
.cm__hcell { border-radius: 14px; border-width: 2px; min-height: 82px; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; }
.cm__hcell--crit { background: rgba(15,23,42,0.85); border: 1.5px solid rgba(148,163,184,0.28); color: #94a3b8; font: 700 21px var(--tvs-font); }
.cm__htitle { font: 700 23px var(--tvs-font); color: #f8fafc; }
.cm__hsub { font: 500 17px var(--tvs-font); }
.cm__hbadge { position: absolute; top: 12px; right: 14px; height: 26px; line-height: 26px; padding: 0 10px; border-radius: 13px;
  color: #020a14; font: 700 14px var(--tvs-font); white-space: nowrap; }
.cm__crit { font: 600 19px/24px var(--tvs-font); color: #e2e8f0; background: rgba(9,17,34,0.85); }
.cm__val { font: 500 18px/23px var(--tvs-font); color: #e2e8f0; gap: 12px; }
.cm__dot { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font: 800 16px var(--tvs-font); }
.cm__text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cm__row { display: contents; }
.cm__active { position: absolute; left: -4px; right: -4px; top: 0; height: 60px; border-radius: 14px; border: 2.2px solid var(--tvs-cyan); box-shadow: 0 0 22px rgba(16,192,240,0.35), inset 0 0 0 1px rgba(16,192,240,0.25);
  background: rgba(16,42,74,0.25); pointer-events: none; }
.cm__takeaway { position: absolute; left: 0; right: 0; bottom: 6px; height: 62px; border-radius: 16px; border: 2px solid var(--tvs-cyan);
  background: rgba(10,32,58,0.94); display: flex; align-items: center; gap: 20px; padding: 0 24px; box-shadow: 0 0 28px rgba(16,192,240,0.25); }
.cm__tlabel { flex: none; font: 700 18px var(--tvs-font); color: var(--tvs-cyan); white-space: nowrap; }
.cm__ttext { font: 600 20px var(--tvs-font); color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

const STATUS = {
  good: { color: "#10B981", glyph: "✓", text: "#D1FAE5", border: "rgba(16,185,129,0.35)" },
  best: { color: "#10B981", glyph: "★", text: "#D1FAE5", border: "rgba(16,185,129,0.35)" },
  bad: { color: "#EF4444", glyph: "✕", text: "#FECACA", border: "rgba(239,68,68,0.35)" },
  risk: { color: "#EF4444", glyph: "✕", text: "#FECACA", border: "rgba(239,68,68,0.35)" },
  warn: { color: "#F59E0B", glyph: "!", text: "#FDE68A", border: "rgba(245,158,11,0.35)" },
};

function ensureStyle(common) {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(common.el("style", { id: STYLE_ID, text: CSS }));
}

export default function buildComparisonMatrix(ctx) {
  const { tl, common, vd, stage, at } = ctx;
  const { el, getTone, reveal, DUR, EASE } = common;
  ensureStyle(common);

  // Static structure comes from the shared kernel state (same thresholds as Studio/Canvas).
  const base = computeComparisonMatrixState(vd, 0);
  const columns = base.columns;
  const rows = base.rows;
  const colCount = Math.max(1, columns.length);
  const hasTakeaway = Boolean(base.takeaway?.text);

  const root = el("div.cm");
  const head = el("div.cm__head", {}, el("div.tvs-badge", { text: base.badge || "So sánh Chuyên sâu" }));
  if (vd.title) head.appendChild(el("div.cm__title", { text: vd.title }));
  root.appendChild(head);

  const critW = Math.round(common.STAGE.width * 0.23);
  const table = el("div.cm__table", {
    style: { gridTemplateColumns: `${critW}px repeat(${colCount}, minmax(0, 1fr))` },
  });
  root.appendChild(table);

  // Header row
  table.appendChild(el("div.cm__cell.cm__hcell.cm__hcell--crit", { text: vd.criterion_heading || "Tiêu chí so sánh" }));
  const headerCells = columns.map((col, cIdx) => {
    const tone = getTone(col.tone || (cIdx === colCount - 1 ? "green" : "blue"));
    const cell = el(
      "div.cm__cell.cm__hcell",
      { style: { background: tone.bg, borderColor: tone.border } },
      el("div.cm__htitle", { text: col.title || col.id || "" }),
      col.subtitle ? el("div.cm__hsub", { text: col.subtitle, style: { color: tone.text } }) : null,
      col.badge ? el("div.cm__hbadge", { text: col.badge, style: { background: tone.badge } }) : null
    );
    table.appendChild(cell);
    return cell;
  });

  // Rows: available height shrinks rows like the legacy layout (58..96px)
  const takeawayReserve = hasTakeaway ? 88 : 16;
  const rowsAreaH = Math.max(120, common.STAGE.height - 52 - 82 - takeawayReserve);
  const rowH = Math.min(96, Math.max(58, Math.floor((rowsAreaH - 10 * Math.max(0, rows.length - 1)) / Math.max(1, rows.length))));

  const rowCells = rows.map((row) => {
    const cells = [el("div.cm__cell.cm__crit", { style: { height: `${rowH}px` } }, el("div.cm__text", { text: row.criterion }))];
    columns.forEach((col) => {
      const cell = row.values?.[col.id] || {};
      const st = STATUS[cell.status] || null;
      cells.push(
        el(
          "div.cm__cell.cm__val",
          { style: { height: `${rowH}px`, borderColor: st ? st.border : undefined, color: st ? st.text : undefined } },
          st ? el("div.cm__dot", { text: st.glyph, style: { color: st.color, background: `${st.color}3D` } }) : null,
          el("div.cm__text", { text: cell.text ?? "—" })
        )
      );
    });
    cells.forEach((c) => table.appendChild(c));
    return cells;
  });

  // Active-row highlight frame (moves between rows)
  const activeFrame = el("div.cm__active");
  table.appendChild(activeFrame);

  let takeawayEl = null;
  if (hasTakeaway) {
    takeawayEl = el(
      "div.cm__takeaway",
      {},
      el("div.cm__tlabel", { text: base.takeaway.label || "💡 Nguyên tắc chốt" }),
      el("div.cm__ttext", { text: base.takeaway.text })
    );
    root.appendChild(takeawayEl);
  }
  stage.appendChild(root);

  // ---- Timeline -------------------------------------------------------------
  const t0 = at(0);
  const mech = ctx.mechanic || "blur-materialize";
  reveal(tl, head, t0 + 0.05, { y: -10, mechanic: mech });
  headerCells.forEach((cell, i) => reveal(tl, cell, t0 + 0.12 + i * DUR.stagger, { y: 14, mechanic: mech }));
  reveal(tl, table.firstChild, t0 + 0.08, { y: 14, mechanic: mech });

  // Rows start dimmed (legacy: 0.14 alpha) and reveal at progress_start with Quart-Out over 11% of the scene
  const tableTop = 82 + 10; // header row height + row gap
  rows.forEach((row, rIdx) => {
    const cells = rowCells[rIdx];
    const tRow = at(row.progressStart);
    const revealDur = Math.max(0.2, 0.11 * ctx.dur);
    tl.fromTo(cells, { opacity: 0.14, y: 12, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: revealDur, ease: EASE.reveal, stagger: 0.04 }, tRow);
    const y = tableTop + rIdx * (rowH + 10) - 4;
    if (rIdx === 0) {
      tl.fromTo(
        activeFrame,
        { autoAlpha: 0, y, height: rowH + 8 },
        { autoAlpha: 1, duration: 0.2, ease: EASE.reveal },
        tRow
      );
    } else {
      tl.to(activeFrame, { y, height: rowH + 8, duration: 0.32, ease: EASE.camera }, tRow);
    }
  });

  if (takeawayEl) {
    const tTake = at(base.takeawayStart);
    tl.to(activeFrame, { autoAlpha: 0, duration: 0.18, ease: EASE.exit }, tTake);
    tl.fromTo(takeawayEl, { autoAlpha: 0, y: 14, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: Math.max(0.25, 0.12 * ctx.dur), ease: EASE.reveal }, tTake);
  }
}
