// Lightweight Markdown-to-HTML renderer for curriculum.md and notes.md

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-strong">$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

export function renderMarkdownToHtml(md) {
  if (!md) return '<p class="text-slate-400">Chưa có nội dung.</p>';
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];
  let inList = false;
  let inTable = false;
  let tableHeaderDone = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      html.push("</tbody></table></div>");
      inTable = false;
      tableHeaderDone = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      closeList();
      closeTable();
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuf = [];
      } else {
        html.push(
          `<pre class="md-pre"><div class="md-pre-lang">${escapeHtml(codeLang || "code")}</div><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`
        );
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      closeTable();
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        tableHeaderDone = true;
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableHeaderDone = false;
        html.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>');
        for (const c of cells) html.push(`<th>${formatInline(c)}</th>`);
        html.push("</tr></thead><tbody>");
      } else {
        html.push("<tr>");
        for (const c of cells) html.push(`<td>${formatInline(c)}</td>`);
        html.push("</tr>");
      }
      continue;
    } else {
      closeTable();
    }

    if (trimmed === "---" || trimmed === "***") {
      closeList();
      html.push('<hr class="md-hr" />');
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level} class="md-h${level}">${formatInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      closeList();
      html.push(`<blockquote class="md-quote">${formatInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed) || /^\d+\.\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      if (!inList) {
        inList = true;
        html.push('<ul class="md-ul">');
      }
      html.push(`<li>${formatInline(listMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p class="md-p">${formatInline(trimmed)}</p>`);
  }

  closeList();
  closeTable();
  return html.join("\n");
}
