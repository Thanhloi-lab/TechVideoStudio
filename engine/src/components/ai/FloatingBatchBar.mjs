import React from "react";

const h = React.createElement;

function isEpisodeRewrite(ep) {
  if (!ep) return false;
  return Boolean(
    ep.has_script ||
      ep.state?.overall_status === "completed" ||
      ep.state?.scripting?.status === "completed"
  );
}

export function FloatingBatchBar({
  selectedEpisodes = [],
  onClear,
  onOpenBatchModal,
}) {
  if (!Array.isArray(selectedEpisodes) || selectedEpisodes.length === 0) {
    return null;
  }

  const totalCount = selectedEpisodes.length;
  const rewriteCount = selectedEpisodes.filter(isEpisodeRewrite).length;
  const newCount = totalCount - rewriteCount;

  return h(
    "div",
    {
      className: "floating-batch-bar",
      role: "region",
      "aria-label": "Biên kịch hàng loạt",
    },
    h(
      "div",
      { className: "floating-batch-info" },
      h("span", { className: "floating-batch-dot" }),
      h(
        "span",
        { className: "floating-batch-count" },
        `Đã chọn ${totalCount} tập (${newCount} mới · ${rewriteCount} viết lại)`
      )
    ),
    h(
      "div",
      { className: "floating-batch-actions" },
      h(
        "button",
        {
          type: "button",
          className: "btn-export floating-batch-submit",
          onClick: () => onOpenBatchModal && onOpenBatchModal(),
        },
        "✍️ Biên kịch hàng loạt (1 Model)"
      ),
      h(
        "button",
        {
          type: "button",
          className: "btn-secondary floating-batch-clear",
          onClick: () => onClear && onClear(),
        },
        "Bỏ chọn"
      )
    )
  );
}
