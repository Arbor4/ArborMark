/**
 * HTML 渲染插件：把 commonmark 解析出的原始 html 节点渲染为真实 HTML（DOMPurify 净化），
 * 点击可在渲染态编辑源码。区分块级（details/center/p/img/注释）与行内（kbd/mark/u/sup/sub/abbr/a/br）。
 * 序列化回原始 HTML 文本。
 */
import { $nodeSchema, $remark, $view, $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { visit } from "unist-util-visit";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { resolveImageSrcAsync } from "../imageSrc";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

const INLINE_PARENTS = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "tableCell"]);
const VOID_TAGS = /^(br|img|hr|input|meta|link|area|base|col|embed|source|track|wbr)$/i;

/** details 内部 Markdown 渲染器（折叠块内容支持粗体、列表、行内代码等）。 */
const mdInner = new MarkdownIt({ html: true, breaks: false, linkify: true });

/** 把 <details>…</details>（内部为 Markdown）渲染为完整折叠块 HTML；非 details 返回 null。 */
function renderDetailsHtml(value: string): string | null {
  const trimmed = value.trim();
  if (!/^<details\b/i.test(trimmed)) return null;
  const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(trimmed);
  const summary = summaryMatch ? summaryMatch[1].trim() : "详情";
  let inner = trimmed
    .replace(/^<details[^>]*>/i, "")
    .replace(/<\/details>\s*$/i, "");
  if (summaryMatch) inner = inner.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, "");
  const innerHtml = mdInner.render(inner.trim());
  const summaryHtml = mdInner.renderInline(summary);
  return `<details class="am-details"><summary>${sanitize(summaryHtml)}</summary><div class="am-details-body">${sanitize(innerHtml)}</div></details>`;
}

/** 合并跨空行的 <details>…</details> 块为单个 html_details 节点（自定义类型，避免被流水线转为段落）。 */
function mergeDetailsBlocks(children: any[], src: string) {
  if (!children) return;
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node?.children && ["blockquote", "listItem"].includes(node.type)) mergeDetailsBlocks(node.children, src);
    const val = node?.type === "html" ? String(node.value ?? "").trim() : "";
    if (/^<details\b/i.test(val) && node.position) {
      let j = i + 1;
      while (j < children.length) {
        const vj = children[j]?.type === "html" ? String(children[j].value ?? "").trim() : "";
        if (/^<\/details\s*>$/i.test(vj)) break;
        j++;
      }
      if (j < children.length && children[j].position) {
        const start = node.position.start.offset;
        const end = children[j].position.end.offset;
        if (start != null && end != null && end > start) {
          children.splice(i, j - i + 1, {
            type: "html_details",
            value: src.slice(start, end),
            position: { start: node.position.start, end: children[j].position.end },
          });
          i++;
          continue;
        }
      }
    }
    i++;
  }
}

/** 首个 remark 插件：把 details 块合并为自定义 html_details 节点（须在 commonmark 之前注册）。 */
function remarkDetailsMerge() {
  return (tree: any, file: any) => {
    mergeDetailsBlocks(tree.children, String(file?.value ?? ""));
  };
}

export const detailsRemark = $remark("remarkDetailsMerge", () => remarkDetailsMerge);

/** 在行内容器中把 <tag>…</tag> 的碎片合并为单个完整 html_inline 节点（用源码偏移取原始 HTML）。 */
function mergeInlineHtml(children: any[], src: string) {
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node && (node.type === "html" || node.type === "html_inline") && node.position) {
      const v = String(node.value ?? "").trim();
      const open = /^<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>$/.exec(v);
      if (open && !VOID_TAGS.test(open[1]) && !v.endsWith("/>")) {
        const tag = open[1].toLowerCase();
        const openRe = new RegExp(`^<${tag}\\b[^>]*>$`, "i");
        const closeRe = new RegExp(`^</${tag}\\s*>$`, "i");
        let depth = 1;
        let j = i + 1;
        for (; j < children.length; j++) {
          const c = children[j];
          if (c && (c.type === "html" || c.type === "html_inline")) {
            const cv = String(c.value ?? "").trim();
            if (openRe.test(cv) && !cv.endsWith("/>")) depth++;
            else if (closeRe.test(cv)) { depth--; if (depth === 0) break; }
          }
        }
        if (j < children.length && depth === 0 && children[j].position) {
          const start = node.position.start.offset;
          const end = children[j].position.end.offset;
          if (start != null && end != null && end > start) {
            children.splice(i, j - i + 1, { type: "html_inline", value: src.slice(start, end) });
            i++;
            continue;
          }
        }
      }
    }
    i++;
  }
}

/** remark：合并行内 HTML 碎片，并按上下文重命名为 html_block / html_inline。 */
function remarkHtmlSplit() {
  return (tree: any, file: any) => {
    const src = String(file?.value ?? "");
    // 1. 行内容器内合并成对标签（<kbd>…</kbd> 等）
    visit(tree, (node: any) => {
      if (node.children && INLINE_PARENTS.has(node.type)) mergeInlineHtml(node.children, src);
    });
    // 2. 剩余 html 节点按上下文重命名
    visit(tree, "html", (node: any, _index: number | undefined, parent: any) => {
      node.type = parent && INLINE_PARENTS.has(parent.type) ? "html_inline" : "html_block";
    });
  };
}

export const htmlRemark = $remark("remarkHtmlSplit", () => remarkHtmlSplit);

const PURIFY_CFG = {
  ADD_ATTR: ["align", "id", "width", "height", "title", "alt", "target", "colspan", "rowspan"],
  ADD_TAGS: ["kbd", "mark", "abbr", "details", "summary", "center"],
};

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CFG);
}

export const htmlBlockSchema = $nodeSchema("html_block", () => ({
  group: "block",
  atom: true,
  isolating: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: "div[data-html-block]", getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }) }],
  toDOM: (node) => {
    const dom = document.createElement("div");
    dom.setAttribute("data-html-block", "");
    dom.dataset.value = node.attrs.value as string;
    return dom;
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "html_block",
    runner: (state: any, node: any, type: any) => state.addNode(type, { value: node.value }),
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === "html_block",
    runner: (state: any, node: any) => state.addNode("html", undefined, node.attrs.value),
  },
}));

export const htmlInlineSchema = $nodeSchema("html_inline", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: "span[data-html-inline]", getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }) }],
  toDOM: (node) => {
    const dom = document.createElement("span");
    dom.setAttribute("data-html-inline", "");
    dom.dataset.value = node.attrs.value as string;
    return dom;
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "html_inline",
    runner: (state: any, node: any, type: any) => state.addNode(type, { value: node.value }),
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === "html_inline",
    runner: (state: any, node: any) => state.addNode("html", undefined, node.attrs.value),
  },
}));

export const htmlDetailsSchema = $nodeSchema("html_details", () => ({
  group: "block",
  atom: true,
  isolating: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: "div[data-html-details]", getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }) }],
  toDOM: (node) => {
    const dom = document.createElement("div");
    dom.setAttribute("data-html-details", "");
    dom.dataset.value = node.attrs.value as string;
    return dom;
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "html_details",
    runner: (state: any, node: any, type: any) => state.addNode(type, { value: node.value }),
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === "html_details",
    runner: (state: any, node: any) => state.addNode("html", undefined, node.attrs.value),
  },
}));

/** 通用 HTML node view：渲染净化后的 HTML，点击切换源码编辑（attrs.value 单一数据源）。 */
function makeHtmlNodeView(inline: boolean) {
  return (initialNode: ProseNode, view: EditorView, getPos: (() => number | undefined) | boolean) => {
    let node = initialNode;
    let editing = false;
    let destroyed = false;

    const dom = document.createElement(inline ? "span" : "div");
    dom.className = inline ? "am-html-inline" : "am-html-block";
    const renderArea = document.createElement(inline ? "span" : "div");
    renderArea.className = "am-html-render";
    const editor = document.createElement(inline ? "input" : "textarea") as HTMLInputElement | HTMLTextAreaElement;
    editor.className = "am-html-editor";
    editor.style.display = "none";
    editor.spellcheck = false;
    dom.append(renderArea, editor);

    const render = () => {
      const value = node.attrs.value as string;
      if (!value.trim()) {
        renderArea.innerHTML = inline ? "" : '<span class="am-html-empty">（空 HTML）</span>';
        return;
      }
      const detailsHtml = !inline ? renderDetailsHtml(value) : null;
      renderArea.innerHTML = detailsHtml ?? sanitize(value);
      // HTML 内的相对路径图片按文档目录解析（与 Markdown 图片一致）。
      // 先摘除 src 防止浏览器/ WebView 用页面基址抢跑加载导致误报错误。
      const imgs = [...renderArea.querySelectorAll("img")];
      imgs.forEach((img) => {
        img.dataset.rawSrc = img.getAttribute("src") || "";
        img.removeAttribute("src");
        img.loading = "lazy";
      });
      imgs.forEach((img) => {
        const raw = img.dataset.rawSrc || "";
        resolveImageSrcAsync(raw).then((u) => {
          if (!img.isConnected) return;
          img.src = u || raw;
          img.addEventListener("error", () => {
            const chip = document.createElement("span");
            chip.className = "am-html-img-fallback";
            chip.textContent = img.getAttribute("alt") || raw || "图片";
            img.replaceWith(chip);
          }, { once: true });
        });
      });
    };

    const autoSize = () => {
      if (!inline) {
        const ta = editor as HTMLTextAreaElement;
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight + 2}px`;
      }
    };

    const posOf = () => (typeof getPos === "function" ? getPos() : undefined);

    const commit = () => {
      const pos = posOf();
      if (pos == null) return;
      if (editor.value !== node.attrs.value) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: editor.value }));
      }
    };

    let outsideHandler: ((e: MouseEvent) => void) | null = null;

    const enterEdit = () => {
      if (editing) return;
      editing = true;
      dom.classList.add("am-html-editing");
      renderArea.style.display = "none";
      editor.style.display = inline ? "inline-block" : "block";
      editor.value = node.attrs.value as string;
      autoSize();
      outsideHandler = (e: MouseEvent) => {
        if (!dom.contains(e.target as Node)) exitEdit();
      };
      document.addEventListener("mousedown", outsideHandler, true);
      editor.focus();
      // 光标置于末尾而非全选，避免一进入就整段反白
      const len = editor.value.length;
      editor.setSelectionRange(len, len);
      autoSize();
    };

    const exitEdit = () => {
      if (!editing) return;
      editing = false;
      if (outsideHandler) {
        document.removeEventListener("mousedown", outsideHandler, true);
        outsideHandler = null;
      }
      commit();
      dom.classList.remove("am-html-editing");
      editor.style.display = "none";
      renderArea.style.display = "";
      render();
    };

    renderArea.addEventListener("click", (e) => {
      // 允许 details/summary 原生展开与链接跳转之外的点击进入编辑
      const target = e.target as HTMLElement;
      if (target.closest("summary")) return; // 让 summary 原生折叠
      if (target.closest("a")) return; // 让链接可点击
      enterEdit();
    });
    editor.addEventListener("input", () => { commit(); autoSize(); });
    editor.addEventListener("keydown", (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === "Escape") { exitEdit(); view.focus(); }
      if (inline && e.key === "Enter") { exitEdit(); view.focus(); }
      e.stopPropagation();
    });

    render();

    return {
      dom,
      update(newNode: ProseNode) {
        if (newNode.type !== node.type) return false;
        node = newNode;
        if (!editing) render();
        return true;
      },
      selectNode() { dom.classList.add("am-html-selected"); },
      deselectNode() { dom.classList.remove("am-html-selected"); },
      stopEvent(event: Event) {
        return editing && editor.contains(event.target as Node);
      },
      ignoreMutation() { return true; },
      destroy() {
        destroyed = true;
        if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
      },
    };
  };
}

export const htmlBlockView = $view(htmlBlockSchema.node, () => makeHtmlNodeView(false));
export const htmlInlineView = $view(htmlInlineSchema.node, () => makeHtmlNodeView(true));
export const htmlDetailsView = $view(htmlDetailsSchema.node, () => makeHtmlNodeView(false));

export const htmlPlugins = [htmlBlockSchema, htmlInlineSchema, htmlBlockView, htmlInlineView].flat();

/** details 专用插件：须在 commonmark 之前注册（detailsRemark 先把 details 合并为自定义节点）。 */
export const detailsPlugins = [detailsRemark, htmlDetailsSchema, htmlDetailsView].flat();

/**
 * 空文档归一：空 md / 全选删除后 schema 默认填充会落到 html_details/html_block 原子节点，
 * 渲染出「（空 HTML）」占位块且不可直接输入。这里把「仅含一个空 HTML 原子」或「零节点」的文档
 * 归一为一个空 paragraph，保证空 md 干净、可直接 typing，不再出现占位块。
 */
export const emptyDocNormalize = $prose(
  () =>
    new Plugin({
      appendTransaction: (_trs, _oldState, newState) => {
        const doc = newState.doc;
        const isEmptyHtml = (n: ProseNode) =>
          (n.type.name === "html_details" || n.type.name === "html_block") && !String(n.attrs.value ?? "").trim();
        if (doc.childCount === 0) {
          return newState.tr.insert(0, newState.schema.nodes.paragraph.create());
        }
        if (doc.childCount === 1 && doc.firstChild && isEmptyHtml(doc.firstChild)) {
          return newState.tr.replaceWith(0, doc.content.size, newState.schema.nodes.paragraph.create());
        }
        return null;
      },
    }),
);