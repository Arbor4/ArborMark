/**
 * Markdown → HTML 渲染管线：markdown-it → 扩展（数学/提示块/任务）→ 高亮 → 净化。
 * 供导出 HTML、复制为 HTML 与 CM6 渲染 widget 使用；所有颜色走主题 token。
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import { useUi } from "@/stores/ui";

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        /* fallthrough */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

/* ── 数学公式：$...$ 行内，$$...$$ 块级 ───────────────────────────────────── */

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html",
    });
  } catch {
    return `<code>${md.utils.escapeHtml(tex)}</code>`;
  }
}

// 块级 $$
md.block.ruler.before(
  "fence",
  "math_block",
  (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const firstLine = state.src.slice(startPos, max).trim();
    if (!firstLine.startsWith("$$")) return false;
    if (silent) return true;

    let content = firstLine.slice(2);
    let line = startLine;
    let closed = content.trimEnd().endsWith("$$");
    if (closed) content = content.trimEnd().slice(0, -2);
    while (!closed && line + 1 < endLine) {
      line++;
      const text = state.src.slice(
        state.bMarks[line] + state.tShift[line],
        state.eMarks[line],
      );
      if (text.trimEnd().endsWith("$$")) {
        content += "\n" + text.trimEnd().slice(0, -2);
        closed = true;
      } else {
        content += "\n" + text;
      }
    }
    state.line = line + 1;
    const token = state.push("math_block", "div", 0);
    token.block = true;
    token.content = content.trim();
    token.map = [startLine, state.line];
    return true;
  },
  { alt: ["paragraph", "reference", "blockquote", "list"] },
);

md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="am-math-block">${renderKatex(tokens[idx].content, true)}</div>`;

// 行内 $...$
md.inline.ruler.after("escape", "math_inline", (state, silent) => {
  if (state.src[state.pos] !== "$") return false;
  // 避免 $$ 与货币误判：要求闭合 $ 且内容非空
  const start = state.pos + 1;
  let end = start;
  while (end < state.posMax) {
    if (state.src[end] === "$" && state.src[end - 1] !== "\\") break;
    end++;
  }
  if (end >= state.posMax || end === start) return false;
  const content = state.src.slice(start, end);
  if (/^\s|\s$/.test(content) || content.includes("\n")) return false;
  if (!silent) {
    const token = state.push("math_inline", "span", 0);
    token.content = content;
  }
  state.pos = end + 1;
  return true;
});

md.renderer.rules.math_inline = (tokens, idx) => renderKatex(tokens[idx].content, false);

/* ── GitHub 风格提示块 > [!NOTE]（图标统一使用 Lucide 静态 SVG） ───────────── */

/** 生成 Lucide 风格的内联 SVG（24×24 网格、currentColor 描边）。 */
function lucideSvg(inner: string, size = 14): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="am-alert-icon" aria-hidden="true">${inner}</svg>`;
}

const ALERT_META: Record<string, { label: string; icon: string }> = {
  note: {
    label: "注意",
    icon: lucideSvg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  },
  tip: {
    label: "提示",
    icon: lucideSvg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  },
  important: {
    label: "重要",
    icon: lucideSvg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
  },
  warning: {
    label: "警告",
    icon: lucideSvg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  },
  caution: {
    label: "小心",
    icon: lucideSvg('<path d="M7.86 2h8.44L22 7.86v8.44L16.14 22H7.86L2 16.14V7.86L7.86 2"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  },
};

const defaultBlockquoteOpen =
  md.renderer.rules.blockquote_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
  // 检查块quote第一个 paragraph 是否以 [!TYPE] 开头
  const next = tokens[idx + 1];
  if (next && next.type === "paragraph_open") {
    const inline = tokens[idx + 2];
    if (inline && inline.type === "inline") {
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i.exec(inline.content);
      if (m) {
        const kind = m[1].toLowerCase();
        inline.content = inline.content.slice(m[0].length);
        if (inline.children) {
          // 移除首个 text 子节点里的标记
          const first = inline.children[0];
          if (first && first.type === "text") {
            first.content = first.content.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, "");
          }
        }
        const meta = ALERT_META[kind];
        return `<div class="am-alert am-alert-${kind}"><div class="am-alert-title">${meta.icon}<span>${meta.label}</span></div>`;
      }
    }
  }
  return defaultBlockquoteOpen(tokens, idx, options, env, self);
};

const defaultBlockquoteClose =
  md.renderer.rules.blockquote_close ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
  // 与 open 对应：向前找最近的 blockquote_open 判断是否为 alert
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].type === "blockquote_close") depth++;
    if (tokens[i].type === "blockquote_open") {
      if (depth === 0) {
        const next = tokens[i + 1];
        const inline = tokens[i + 2];
        if (
          next?.type === "paragraph_open" &&
          inline?.type === "inline" &&
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(inline.content)
        ) {
          return "</div>";
        }
        break;
      }
      depth--;
    }
  }
  return defaultBlockquoteClose(tokens, idx, options, env, self);
};

/* ── 任务列表复选框 ───────────────────────────────────────────────────────── */

md.core.ruler.after("inline", "task_lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== "inline") continue;
    const prev = tokens[i - 1];
    if (prev?.type !== "heading_open" && prev?.type !== "paragraph_open") continue;
    const content = tokens[i].content;
    const m = /^\[([ xX])\]\s+/.exec(content);
    if (!m) continue;
    // 仅处理列表项内的段落
    let inList = false;
    for (let j = i - 2; j >= 0; j--) {
      if (tokens[j].type === "list_item_open") {
        inList = true;
        break;
      }
      if (tokens[j].type === "blockquote_open" || tokens[j].type === "bullet_list_close") break;
    }
    if (!inList) continue;
    tokens[i].content = content.slice(m[0].length);
    if (tokens[i].children) {
      const first = tokens[i].children![0];
      if (first?.type === "text") first.content = first.content.replace(/^\[([ xX])\]\s+/, "");
    }
    const checked = m[1].toLowerCase() === "x";
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input type="checkbox" disabled ${checked ? "checked" : ""} />`;
    tokens[i].children!.unshift(checkbox);
  }
});

/* ── ==高亮== ─────────────────────────────────────────────────────────────── */

md.inline.ruler.before("emphasis", "mark", (state, silent) => {
  const start = state.pos;
  if (state.src.slice(start, start + 2) !== "==") return false;
  const end = state.src.indexOf("==", start + 2);
  if (end < 0) return false;
  const content = state.src.slice(start + 2, end);
  if (!content.trim()) return false;
  if (!silent) {
    const open = state.push("mark_open", "mark", 1);
    open.markup = "==";
    const text = state.push("text", "", 0);
    text.content = content;
    const close = state.push("mark_close", "mark", -1);
    close.markup = "==";
  }
  state.pos = end + 2;
  return true;
});

/* ── 对外接口 ─────────────────────────────────────────────────────────────── */

export function renderMarkdown(source: string): string {
  const prefs = useUi.getState().prefs;
  md.set({
    html: prefs.blockHTML !== false,
    breaks: prefs.preserveLineBreak === true,
    typographer: prefs.smartQuotes !== false || prefs.smartDashes !== false,
  });
  const raw = md.render(source ?? "");
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ["input", "mjx-container"],
    ADD_ATTR: ["checked", "disabled", "type", "aria-hidden", "style", "class"],
    FORBID_TAGS: ["style", "script", "iframe", "form"],
    FORBID_ATTR: ["onerror", "onclick", "onload"],
  });
}

/** 提取大纲标题（供 OutlinePanel）。 */
export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

export function extractOutline(source: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = (source ?? "").split("\n");
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      items.push({
        level: m[1].length,
        text: m[2].replace(/[*_`~]/g, ""),
        line: i + 1,
      });
    }
  });
  return items;
}