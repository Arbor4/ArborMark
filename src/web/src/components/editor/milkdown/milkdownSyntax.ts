/**
 * Milkdown 语法扩展：==高亮==、^上标^、~下标~、YAML Front Matter、GitHub 提示块。
 * 这些是 commonmark/gfm 默认不渲染的扩展语法。
 * 通过 remark 插件识别 mdast，ProseMirror mark/node 渲染，自定义 stringify handler 回写。
 */
import { $markSchema, $nodeSchema, $remark, $view } from "@milkdown/utils";
import { visit } from "unist-util-visit";
import type { Node as ProseNode } from "@milkdown/prose/model";

/* ── ==高亮== / ^上标^ / ~下标~（行内 mark） ─────────────────────────────── */

// 组合正则：group1=高亮内容，group2=上标内容，group3=下标内容，group4=注释内容。
// 上/下标要求无空白（避免误判）；~~删除线~~ 已被 gfm 解析为 delete，不会进入文本节点。
const INLINE_EXT_RE = /==([^=\n]+)==|\^([^\^\s]+)\^|~([^~\s]+)~|%%([^%\n]+)%%/g;

function remarkInlineExt(opts: { highlight?: boolean; superscript?: boolean; subscript?: boolean } = {}) {
  const { highlight = true, superscript = true, subscript = true } = opts;
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (!parent || index == null) return;
      if (parent.type === "code" || parent.type === "inlineCode") return;
      // 已被 mark/sup/sub/comment 包裹的内容不再处理
      if (["mark", "superscript", "subscript", "comment"].includes(parent.type)) return;
      const value: string = node.value;
      INLINE_EXT_RE.lastIndex = 0;
      if (!INLINE_EXT_RE.test(value)) return;
      INLINE_EXT_RE.lastIndex = 0;
      const out: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = INLINE_EXT_RE.exec(value))) {
        let type: string | null = null;
        let inner = "";
        if (m[1] != null && highlight) { type = "mark"; inner = m[1]; }
        else if (m[2] != null && superscript) { type = "superscript"; inner = m[2]; }
        else if (m[3] != null && subscript) { type = "subscript"; inner = m[3]; }
        else if (m[4] != null) { type = "comment"; inner = m[4]; }
        if (!type) continue;
        if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
        out.push({ type, children: [{ type: "text", value: inner }] });
        last = m.index + m[0].length;
      }
      if (!out.length) return;
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

export const inlineExtRemark = $remark("remarkInlineExt", () => () => remarkInlineExt());

export const markSchema = $markSchema("mark", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", 0],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "mark",
    runner: (state: any, node: any, markType: any) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === "mark",
    runner: (state: any, mark: any) => { state.withMark(mark, "mark"); },
  },
}));

export const superscriptSchema = $markSchema("superscript", () => ({
  parseDOM: [{ tag: "sup" }],
  toDOM: () => ["sup", 0],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "superscript",
    runner: (state: any, node: any, markType: any) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === "superscript",
    runner: (state: any, mark: any) => { state.withMark(mark, "superscript"); },
  },
}));

export const subscriptSchema = $markSchema("subscript", () => ({
  parseDOM: [{ tag: "sub" }],
  toDOM: () => ["sub", 0],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "subscript",
    runner: (state: any, node: any, markType: any) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === "subscript",
    runner: (state: any, mark: any) => { state.withMark(mark, "subscript"); },
  },
}));

/* ── %%注释%%（行内 mark，灰显）─────────────────────────────────────────── */

export const commentSchema = $markSchema("comment", () => ({
  parseDOM: [{ tag: "span", getAttrs: (dom) => ((dom as HTMLElement).classList.contains("am-comment") ? {} : false) }],
  toDOM: () => ["span", { class: "am-comment" }, 0],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "comment",
    runner: (state: any, node: any, markType: any) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === "comment",
    runner: (state: any, mark: any) => { state.withMark(mark, "comment"); },
  },
}));

/* ── <u>下划线</u>（行内 mark；须在 htmlRemark 之前把碎片合并为 underline）── */

const U_INLINE_PARENTS = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "tableCell"]);

function remarkUnderline() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (!node.children || !U_INLINE_PARENTS.has(node.type)) return;
      const children = node.children as any[];
      let i = 0;
      while (i < children.length) {
        const v = children[i]?.type === "html" ? String(children[i].value ?? "").trim() : "";
        if (/^<u\b[^>]*>$/i.test(v)) {
          let depth = 1;
          let j = i + 1;
          for (; j < children.length; j++) {
            const cv = children[j]?.type === "html" ? String(children[j].value ?? "").trim() : "";
            if (/^<u\b[^>]*>$/i.test(cv)) depth++;
            else if (/^<\/u\s*>$/i.test(cv)) { depth--; if (depth === 0) break; }
          }
          if (j < children.length && depth === 0) {
            children.splice(i, j - i + 1, { type: "underline", children: children.slice(i + 1, j) });
            continue;
          }
        }
        i++;
      }
    });
  };
}

export const underlineRemark = $remark("remarkUnderline", () => remarkUnderline);

export const underlineSchema = $markSchema("underline", () => ({
  parseDOM: [{ tag: "u" }],
  toDOM: () => ["u", 0],
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "underline",
    runner: (state: any, node: any, markType: any) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === "underline",
    runner: (state: any, mark: any) => { state.withMark(mark, "underline"); },
  },
}));

/* ── YAML Front Matter ───────────────────────────────────────────────────── */

/** 识别文件首部 `---\nYAML\n---`，合并为单个 yaml 节点（remark-parse 会拆成 HR+段落）。 */
function remarkFrontmatter() {
  return (tree: any, file: any) => {
    const src = String(file?.value ?? "");
    const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
    if (!m) return;
    const end = m[0].length;
    const children = tree.children as any[];
    let i = 0;
    while (i < children.length && children[i].position && children[i].position.start.offset < end) i++;
    if (i === 0) return;
    children.splice(0, i, { type: "yaml", value: m[1] });
  };
}

export const frontmatterRemark = $remark("remarkFrontmatter", () => remarkFrontmatter);

export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
  group: "block",
  content: "text*",
  parseDOM: [{ tag: "div[data-frontmatter]", contentElement: "pre" }],
  toDOM: () => {
    const dom = document.createElement("div");
    dom.setAttribute("data-frontmatter", "");
    const pre = document.createElement("pre");
    pre.className = "am-frontmatter-view";
    dom.appendChild(pre);
    return { dom, contentDOM: pre };
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "yaml",
    runner: (state: any, node: any, type: any) => {
      state.openNode(type);
      state.addText(node.value || "");
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === "frontmatter",
    runner: (state: any, node: ProseNode) => state.addNode("yaml", undefined, node.textContent),
  },
}));

/* ── GitHub 提示块 [!NOTE]/[!TIP]/[!IMPORTANT]/[!WARNING]/[!CAUTION] ─────── */

const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

function remarkAlert() {
  return (tree: any) => {
    visit(tree, "blockquote", (node: any, index: number | undefined, parent: any) => {
      if (!parent || index == null) return;
      const first = node.children?.[0];
      if (!first || first.type !== "paragraph") return;
      const firstText = first.children?.[0];
      if (!firstText || firstText.type !== "text") return;
      const m = ALERT_RE.exec(firstText.value);
      if (!m) return;
      // 去掉首段的 [!TYPE] 标记
      firstText.value = firstText.value.slice(m[0].length);
      if (!firstText.value && first.children.length === 1) node.children.shift();
      else if (!firstText.value) first.children.shift();
      parent.children.splice(index, 1, {
        type: "alert",
        alertType: m[1].toLowerCase(),
        children: node.children,
      });
      return index + 1;
    });
  };
}

export const alertRemark = $remark("remarkAlert", () => remarkAlert);

export const alertSchema = $nodeSchema("alert", () => ({
  group: "block",
  content: "block+",
  attrs: { alertType: { default: "note" } },
  parseDOM: [{ tag: "div[data-alert]", getAttrs: (dom) => ({ alertType: (dom as HTMLElement).dataset.alert ?? "note" }) }],
  toDOM: (node) => {
    const dom = document.createElement("div");
    dom.className = `am-alert am-alert-${node.attrs.alertType}`;
    dom.setAttribute("data-alert", node.attrs.alertType as string);
    const title = document.createElement("div");
    title.className = "am-alert-title";
    title.textContent = alertTitle(node.attrs.alertType as string);
    const body = document.createElement("div");
    body.className = "am-alert-body";
    dom.append(title, body);
    return { dom, contentDOM: body };
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "alert",
    runner: (state: any, node: any, type: any) => {
      state.openNode(type, { alertType: node.alertType });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === "alert",
    runner: (state: any, node: any) => {
      state.openNode("alert", undefined, { alertType: node.attrs.alertType });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export function alertTitle(type: string): string {
  switch (type) {
    case "note": return "注意";
    case "tip": return "提示";
    case "important": return "重要";
    case "warning": return "警告";
    case "caution": return "危险";
    default: return "注意";
  }
}

/* ── remark-stringify 自定义 handler（回写 Markdown） ────────────────────── */

/**
 * 计算字符串在等宽字体中的展示宽度（中日韩全角字符算 2 列，半角字符算 1 列）。
 * 用于 GFM / Typora / VS Code / Obsidian 标准表格管道线（|）完美垂直对齐。
 */
export function eastAsianWidth(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      len += 2;
    } else {
      len += 1;
    }
  }
  return len;
}

/**
 * 规范化 Markdown 源码输出（业界标准 CommonMark / GFM / Typora 风格）：
 * 1. 代码围栏（``` 或 ~~~）与数学公式块（$$...$$）内部原样保留，绝对不触碰；
 * 2. 任务列表归一化：将任意层级、嵌套、引用块内的 `* [ ]`、`+ [ ]`、`* [x]`、`* [X]` 统一规范为 `- [ ]` 与 `- [x]`；
 * 3. 无序列表项归一化：将序列化产生的偶数嵌套层级 `* ` 或 `+ ` 统一规范为 `- `（含引用块内）；
 * 4. 水平分割线归一化：独立行的 `***`、`* * *` 等统一规整为标准的 `---`。
 */
export function normalizeMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceToken = "";
  let inMath = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 围栏代码块判定（``` 或 ~~~，至少 3 个标记）
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const token = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceToken = token[0];
      } else if (token[0] === fenceToken) {
        inFence = false;
        fenceToken = "";
      }
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    // 块级公式 $$
    if (trimmed.startsWith("$$")) {
      const rest = trimmed.slice(2).trim();
      if (rest.endsWith("$$") && rest.length > 2) {
        out.push(line);
        continue;
      }
      inMath = !inMath;
      out.push(line);
      continue;
    }

    if (inMath) {
      out.push(line);
      continue;
    }

    // 水平分割线：*** 或 * * * 或 ___ 或 _ _ _ 统一规范为 ---
    if (/^\s*([*_-])(\s*\1){2,}\s*$/.test(line)) {
      out.push("---");
      continue;
    }

    let processed = line;

    // 1. 待办列表归一化（包括普通缩进、嵌套、引用块内 > 等）
    // 将 * [ ] / + [ ] / - [X] 等统一规范为标准 - [ ] 与 - [x]
    processed = processed.replace(
      /^(\s*(?:>\s*)*)[*+-]\s+\[([ xX])\](?=\s|$)/,
      (_match, prefix, check) => `${prefix}- [${check.toLowerCase()}]`
    );

    // 2. 普通无序列表项归一化为 "- "（包括引用块内、缩进嵌套，排除上面已处理的任务列表）
    processed = processed.replace(
      /^(\s*(?:>\s*)*)[*+]\s+(?!\[[ xX]\])/,
      "$1- "
    );

    out.push(processed);
  }

  return out.join("\n");
}

export const normalizeBulletMarkers = normalizeMarkdown;

/** 合并到 remarkStringifyOptionsCtx.handlers，使自定义 mdast 节点能序列化回源码。 */
export const syntaxStringifyHandlers = {
  mark: (node: any, _p: any, state: any, info: any) => `==${state.containerPhrasing(node, info)}==`,
  superscript: (node: any, _p: any, state: any, info: any) => `^${state.containerPhrasing(node, info)}^`,
  subscript: (node: any, _p: any, state: any, info: any) => `~${state.containerPhrasing(node, info)}~`,
  comment: (node: any, _p: any, state: any, info: any) => `%%${state.containerPhrasing(node, info)}%%`,
  underline: (node: any, _p: any, state: any, info: any) => `<u>${state.containerPhrasing(node, info)}</u>`,
  yaml: (node: any) => `---\n${node.value}\n---`,
  alert: (node: any, _p: any, state: any, info: any) => {
    const inner = state.containerFlow(node, info);
    const marker = `[!${String(node.alertType ?? "note").toUpperCase()}]`;
    const body = inner ? `${marker}\n${inner}` : marker;
    return body.split("\n").map((l: string) => `> ${l}`).join("\n");
  },
};

/* ── Front Matter node view：原位编辑（pre 即 contentDOM）─────────────────
   光标点击直接进入文字编辑，无 textarea 切换、无聚焦边框、尺寸零跳变。 */

export const frontmatterView = $view(frontmatterSchema.node, () => (initialNode) => {
  let node: ProseNode = initialNode;

  const dom = document.createElement("div");
  dom.className = "am-frontmatter";
  dom.setAttribute("data-testid", "frontmatter");
  const header = document.createElement("div");
  header.className = "am-frontmatter-header";
  header.contentEditable = "false";
  header.textContent = "YAML Front Matter";
  const contentDOM = document.createElement("pre");
  contentDOM.className = "am-frontmatter-view";
  dom.append(header, contentDOM);

  // 光标进入即视为编辑态：与代码块一致的淡外圈（box-shadow，零布局跳变）。
  const syncRing = () => {
    const sel = document.getSelection();
    const inside = !!sel && sel.rangeCount > 0 && contentDOM.contains(sel.anchorNode);
    dom.classList.toggle("am-frontmatter-editing", inside);
  };
  document.addEventListener("selectionchange", syncRing);

  return {
    dom,
    contentDOM,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      return true;
    },
    stopEvent(event: Event) { return header.contains(event.target as Node); },
    ignoreMutation(mutation: { target: Node }) { return !contentDOM.contains(mutation.target); },
    destroy() { document.removeEventListener("selectionchange", syncRing); },
  };
});

export const syntaxPlugins = [
  inlineExtRemark,
  markSchema,
  superscriptSchema,
  subscriptSchema,
  commentSchema,
  underlineRemark,
  underlineSchema,
  frontmatterRemark,
  frontmatterSchema,
  frontmatterView,
  alertRemark,
  alertSchema,
].flat();

/** 依据偏好构建语法插件集合（开关变更时由编辑器重挂载生效）。 */
export function buildSyntaxPlugins(prefs: Record<string, boolean | string | number>): any[] {
  const enabled = (k: string, def = true) => {
    const v = prefs[k];
    return v === undefined ? def : v !== false && v !== "false";
  };
  const highlight = enabled("enableHighlight");
  const superscript = enabled("enableSuperscript");
  const subscript = enabled("enableSubscript");
  const alert = enabled("enableAlert");
  const plugins: any[] = [
    $remark("remarkInlineExt", () => () => remarkInlineExt({ highlight, superscript, subscript })),
  ];
  if (highlight) plugins.push(markSchema);
  if (superscript) plugins.push(superscriptSchema);
  if (subscript) plugins.push(subscriptSchema);
  plugins.push(commentSchema, underlineRemark, underlineSchema);
  plugins.push(frontmatterRemark, frontmatterSchema, frontmatterView);
  if (alert) plugins.push(alertRemark, alertSchema);
  return plugins.flat();
}