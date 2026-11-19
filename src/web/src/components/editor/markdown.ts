/**
 * CodeMirror 6 Markdown 编辑岛。
 * 高性能策略：CM6 增量解析 + 视口渲染；React 只负责挂载与状态桥接。
 *
 * 混合渲染（Hybrid rendering）：
 *  - 光标所在行显示原始 Markdown 标记；
 *  - 其余行隐藏标记符号，直接呈现格式效果（标题字号、粗斜体、行内代码…）；
 *  - 任务列表渲染为可点击复选框。
 */
import { EditorState, RangeSetBuilder, Compartment, StateField, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { findField } from "./findSync";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  CodeBlockWidget,
  TableWidget,
  MathWidget,
  ImageWidget,
  MermaidWidget,
} from "./widgets";

/* ── 语法高亮 → tok-* 类（样式在 app.css，随主题 token 变化） ─────────────── */

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: "tok-heading tok-heading1" },
  { tag: tags.heading2, class: "tok-heading tok-heading2" },
  { tag: tags.heading3, class: "tok-heading tok-heading3" },
  { tag: tags.heading4, class: "tok-heading tok-heading4" },
  { tag: tags.heading5, class: "tok-heading tok-heading5" },
  { tag: tags.heading6, class: "tok-heading tok-heading6" },
  { tag: tags.strong, class: "tok-strong" },
  { tag: tags.emphasis, class: "tok-emphasis" },
  { tag: tags.strikethrough, class: "tok-strikethrough" },
  { tag: tags.link, class: "tok-link" },
  { tag: tags.url, class: "tok-url" },
  { tag: tags.monospace, class: "tok-monospace" },
  { tag: tags.quote, class: "tok-quote" },
  { tag: tags.list, class: "tok-list" },
  { tag: tags.contentSeparator, class: "tok-hr" },
  { tag: tags.comment, class: "tok-comment" },
  { tag: tags.meta, class: "tok-meta" },
  { tag: tags.keyword, class: "tok-keyword" },
  { tag: tags.string, class: "tok-string" },
  { tag: tags.number, class: "tok-number" },
  { tag: tags.processingInstruction, class: "tok-meta" },
]);

/* ── 任务复选框 Widget ────────────────────────────────────────────────────── */

class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "am-task-checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为完成");
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const mark = this.checked ? "[x]" : "[ ]";
      const next = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: next },
      });
      view.focus();
    });
    return input;
  }
  ignoreEvent() {
    return false;
  }
}

/* ── WYSIWYG 即时渲染装饰 ─────────────────────────────────────────────────── */

interface DecoItem {
  from: number;
  to: number;
  deco: Decoration;
}

/** 扫描块级数学公式 $$...$$（跳过代码围栏）。返回源码区间与公式内容。 */
function findMathBlocks(doc: EditorState["doc"]): { from: number; to: number; tex: string }[] {
  const text = doc.toString();
  const lines = text.split("\n");
  const offsets: number[] = [];
  let off = 0;
  for (const line of lines) {
    offsets.push(off);
    off += line.length + 1;
  }
  const result: { from: number; to: number; tex: string }[] = [];
  let inFence = false;
  let start = -1;
  let texLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (start < 0) {
      if (trimmed.startsWith("$$")) {
        const rest = trimmed.slice(2);
        if (rest.trimEnd().endsWith("$$") && rest.trimEnd().length > 2) {
          result.push({
            from: offsets[i],
            to: offsets[i] + line.length,
            tex: rest.trimEnd().slice(0, -2).trim(),
          });
        } else {
          start = i;
          texLines = rest ? [rest] : [];
        }
      }
    } else if (trimmed.endsWith("$$")) {
      texLines.push(trimmed.slice(0, -2));
      result.push({ from: offsets[start], to: offsets[i] + line.length, tex: texLines.join("\n").trim() });
      start = -1;
      texLines = [];
    } else {
      texLines.push(line);
    }
  }
  return result;
}

function buildDecorations(state: EditorState): DecorationSet {
  const cursor = state.selection.main;
  const tree = syntaxTree(state);
  const doc = state.doc;

  const blocks: DecoItem[] = []; // 整块替换（代码/表格/图表/块级公式）
  const lineClasses: { line: number; cls: string }[] = []; // 行装饰
  const inline: DecoItem[] = []; // 行内替换（隐藏标记/行内公式/图片）
  const points: DecoItem[] = []; // 点装饰（任务复选框）
  const renderedRanges: { from: number; to: number }[] = [];
  const fenceRanges: { from: number; to: number }[] = [];

  const intersects = (from: number, to: number) => cursor.from <= to && cursor.to >= from;
  const inRendered = (pos: number) => renderedRanges.some((r) => pos >= r.from && pos <= r.to);

  const addBlock = (nodeFrom: number, nodeTo: number, widget: WidgetType) => {
    const startLine = doc.lineAt(nodeFrom);
    const endLine = doc.lineAt(Math.max(nodeFrom, nodeTo - 1));
    const from = startLine.from;
    const to = endLine.to;
    renderedRanges.push({ from, to });
    blocks.push({ from, to, deco: Decoration.replace({ widget, block: true }) });
  };

  tree.iterate({
    enter: (node) => {
      const { from, to, name } = node;

      // 代码块 / Mermaid 图表
      if (name === "FencedCode") {
        fenceRanges.push({ from, to });
        if (!intersects(from, to)) {
          const text = doc.sliceString(from, to);
          const codeLines = text.split("\n");
          const lang = codeLines[0].replace(/^`{3,}\s*/, "").trim();
          codeLines.shift();
          if (codeLines.length && /^`{3,}\s*$/.test(codeLines[codeLines.length - 1])) codeLines.pop();
          const code = codeLines.join("\n");
          const widget =
            lang.toLowerCase() === "mermaid"
              ? new MermaidWidget(code, from)
              : new CodeBlockWidget(code, lang, from);
          addBlock(from, to, widget);
        } else {
          const startLine = doc.lineAt(from);
          const endLine = doc.lineAt(Math.max(from, to - 1));
          for (let l = startLine.number; l <= endLine.number; l++) {
            lineClasses.push({ line: l, cls: "tok-codeblock" });
          }
        }
        return false;
      }

      // 表格
      if (name === "Table") {
        if (!intersects(from, to)) {
          addBlock(from, to, new TableWidget(doc.sliceString(from, to), from));
        }
        return false;
      }

      // 图片：由下方正则扫描统一处理（兼容 data URI），此处仅跳过子节点
      if (name === "Image") {
        return false;
      }

      if (inRendered(from)) return;

      // 标题
      if (/^ATXHeading[1-6]$/.test(name)) {
        const level = Number(name.slice(-1));
        const line = doc.lineAt(from);
        lineClasses.push({ line: line.number, cls: `tok-heading tok-heading${level}` });
        const mark = /^#{1,6}\s+/.exec(line.text);
        const cursorLineStart = doc.lineAt(cursor.from).number;
        const cursorLineEnd = doc.lineAt(cursor.to).number;
        if (mark && !(line.number >= cursorLineStart && line.number <= cursorLineEnd)) {
          inline.push({ from: line.from, to: line.from + mark[0].length, deco: Decoration.replace({}) });
        }
        return;
      }
      if (name === "SetextHeading1" || name === "SetextHeading2") {
        const line = doc.lineAt(from);
        lineClasses.push({
          line: line.number,
          cls: `tok-heading ${name === "SetextHeading1" ? "tok-heading1" : "tok-heading2"}`,
        });
        return;
      }

      const cursorLineStart = doc.lineAt(cursor.from).number;
      const cursorLineEnd = doc.lineAt(cursor.to).number;
      const onCursorLine = (a: number, b: number) => {
        const la = doc.lineAt(a).number;
        const lb = doc.lineAt(Math.max(a, b - 1)).number;
        return la <= cursorLineEnd && lb >= cursorLineStart;
      };

      if (name === "EmphasisMark" || name === "StrikethroughMark" || name === "CodeMark") {
        if (!onCursorLine(from, to)) inline.push({ from, to, deco: Decoration.replace({}) });
        return;
      }
      if (name === "QuoteMark") {
        if (!onCursorLine(from, to)) {
          const line = doc.lineAt(from);
          const mark = /^\s*>\s?/.exec(line.text);
          if (mark) inline.push({ from: line.from, to: line.from + mark[0].length, deco: Decoration.replace({}) });
        }
        return;
      }
      if (name === "Blockquote") {
        const startLine = doc.lineAt(from);
        const endLine = doc.lineAt(Math.max(from, to - 1));
        for (let l = startLine.number; l <= endLine.number; l++) {
          lineClasses.push({ line: l, cls: "tok-quote" });
        }
        return;
      }
      if (name === "Link") {
        if (!onCursorLine(from, to)) {
          const text = doc.sliceString(from, to);
          const m = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(text);
          if (m) {
            inline.push({ from, to: from + 1, deco: Decoration.replace({}) });
            inline.push({ from: from + 1 + m[1].length, to, deco: Decoration.replace({}) });
          }
        }
        return;
      }
      if (name === "TaskMarker") {
        const text = doc.sliceString(from, to);
        const checked = /^\[x\]$/i.test(text);
        points.push({ from, to: from, deco: Decoration.widget({ widget: new TaskCheckboxWidget(checked, from), side: 1 }) });
        if (!onCursorLine(from, to)) inline.push({ from, to, deco: Decoration.replace({}) });
        return;
      }
      if (name === "HorizontalRule") {
        const line = doc.lineAt(from);
        lineClasses.push({ line: line.number, cls: "tok-hr" });
        return;
      }
    },
  });

  // 块级数学公式
  for (const mb of findMathBlocks(doc)) {
    if (intersects(mb.from, mb.to) || inRendered(mb.from)) continue;
    addBlock(mb.from, mb.to, new MathWidget(mb.tex, true, mb.from));
  }

  // 行内数学公式 $...$（跳过围栏/渲染块/光标行；排除货币 $5/$10 与空白边界误判）
  const cursorLineStart = doc.lineAt(cursor.from).number;
  const cursorLineEnd = doc.lineAt(cursor.to).number;
  const fullText = doc.toString();
  const inlineMathRe = /\$(?!\s)([^$\n]+?)\$(?!\d)/g;
  let mm: RegExpExecArray | null;
  while ((mm = inlineMathRe.exec(fullText))) {
    const from = mm.index;
    const to = from + mm[0].length;
    // 内容首尾不能是空白；开头 $ 前不能是数字/另一个 $（货币场景）
    if (/\s$/.test(mm[1])) {
      inlineMathRe.lastIndex = from + 1;
      continue;
    }
    if (from > 0 && /[\d$]/.test(fullText[from - 1])) {
      inlineMathRe.lastIndex = from + 1;
      continue;
    }
    const lineNo = doc.lineAt(from).number;
    if (lineNo >= cursorLineStart && lineNo <= cursorLineEnd) continue;
    if (inRendered(from) || fenceRanges.some((r) => from >= r.from && to <= r.to)) continue;
    inline.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(mm[1], false, from) }) });
  }

  // 图片 ![alt](url)：正则扫描（data URI 内含 http:// 会被 lezer 误判为链接，故不依赖 Image 节点）
  const imageRe = /!\[([^\]]*)\]\(([^)]*)\)/g;
  let im: RegExpExecArray | null;
  while ((im = imageRe.exec(fullText))) {
    const from = im.index;
    const to = from + im[0].length;
    const lineNo = doc.lineAt(from).number;
    if (lineNo >= cursorLineStart && lineNo <= cursorLineEnd) continue;
    if (inRendered(from) || fenceRanges.some((r) => from >= r.from && to <= r.to)) continue;
    const dest = im[2].trim();
    let url = dest;
    if (dest.startsWith("<")) {
      const close = dest.indexOf(">");
      url = close > 0 ? dest.slice(1, close) : dest.slice(1);
    } else {
      const titled = /^(\S+)\s+"[^"]*$/.exec(dest);
      if (titled) url = titled[1];
    }
    // data URI 中的字面空格需编码，否则 img 加载失败
    if (url.startsWith("data:")) url = url.replace(/ /g, "%20");
    inline.push({ from, to, deco: Decoration.replace({ widget: new ImageWidget(url, im[1], from) }) });
  }

  // 行装饰去重
  const seenLines = new Set<number>();
  for (const { line, cls } of lineClasses) {
    if (seenLines.has(line)) continue;
    seenLines.add(line);
    const info = doc.line(line);
    blocks.push({ from: info.from, to: info.from, deco: Decoration.line({ class: cls }) });
  }

  // 行内替换：排序 + 去重叠（replace 装饰不允许重叠）
  inline.sort((a, b) => a.from - b.from || a.to - b.to);
  const acceptedInline: DecoItem[] = [];
  let lastEnd = -1;
  for (const item of inline) {
    if (item.from < lastEnd) continue;
    acceptedInline.push(item);
    lastEnd = item.to;
  }

  // 汇总排序（RangeSetBuilder 要求按 from + startSide 有序）
  const all = [...blocks, ...acceptedInline, ...points];
  all.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of all) builder.add(from, to, deco);
  return builder.finish();
}

/** 块级装饰（widget/行装饰）必须由 StateField 提供，CM6 禁止 ViewPlugin 提供块级装饰。 */
export const hybridField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** WYSIWYG 即时渲染开关：编辑态启用，源码态关闭（保留语法高亮）。 */
export const wysiwygComp = new Compartment();

/** 语法高亮开关：源码模式关闭，呈现纯文本。 */
export const highlightComp = new Compartment();
export const markdownHighlightExt = syntaxHighlighting(markdownHighlight);

/* ── 专注模式装饰由 EditorHost 的 Compartment 注入（保留撤销历史） ────────── */

/* ── 打字机模式：光标始终保持在视口中央 ───────────────────────────────────── */

const typewriterPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.selectionSet && !update.docChanged) return;
      const enabled = update.view.dom.closest(".am-editor-host")?.classList.contains("am-typewriter");
      if (!enabled) return;
      const view = update.view;
      const head = view.state.selection.main.head;
      requestAnimationFrame(() => {
        const coords = view.coordsAtPos(head);
        if (!coords) return;
        const scroller = view.scrollDOM;
        const rect = scroller.getBoundingClientRect();
        const target = rect.top + rect.height / 2;
        const delta = coords.top - target;
        if (Math.abs(delta) > 24) {
          scroller.scrollBy({ top: delta, behavior: "smooth" });
        }
      });
    }
  },
);

/* ── 快捷键：Markdown 格式化 ──────────────────────────────────────────────── */

function wrapSelection(view: EditorView, before: string, after = before): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  // 已包裹 → 解包
  const outerBefore = state.sliceDoc(Math.max(0, range.from - before.length), range.from);
  const outerAfter = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + after.length));
  if (outerBefore === before && outerAfter === after) {
    view.dispatch({
      changes: [
        { from: range.from - before.length, to: range.from, insert: "" },
        { from: range.to, to: range.to + after.length, insert: "" },
      ],
      selection: { anchor: range.from - before.length, head: range.to - before.length },
    });
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: before + selected + after },
    selection: {
      anchor: range.from + before.length,
      head: range.from + before.length + selected.length,
    },
  });
  return true;
}

function toggleLinePrefix(view: EditorView, prefix: string | RegExp): boolean {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const changes: { from: number; to: number; insert: string }[] = [];
  const re = typeof prefix === "string" ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) : prefix;
  for (let l = startLine.number; l <= endLine.number; l++) {
    const line = state.doc.line(l);
    const m = re.exec(line.text);
    if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    else changes.push({ from: line.from, to: line.from, insert: typeof prefix === "string" ? prefix : "- " });
  }
  view.dispatch({ changes });
  return true;
}

export const markdownKeymap = keymap.of([
  { key: "Mod-b", run: (v) => wrapSelection(v, "**") },
  { key: "Mod-i", run: (v) => wrapSelection(v, "*") },
  { key: "Mod-e", run: (v) => wrapSelection(v, "`") },
  { key: "Mod-Shift-x", run: (v) => wrapSelection(v, "~~") },
  { key: "Mod-Shift-k", run: (v) => wrapSelection(v, "```\n", "\n```") },
  { key: "Mod-Shift-7", run: (v) => toggleLinePrefix(v, /^\d+\.\s/) },
  { key: "Mod-Shift-8", run: (v) => toggleLinePrefix(v, /^[-*]\s/) },
  { key: "Mod-Shift-9", run: (v) => toggleLinePrefix(v, /^>\s?/) },
  {
    key: "Mod-Alt-1",
    run: (v) => toggleLinePrefix(v, /^#\s/),
  },
  {
    key: "Tab",
    run: (v) => {
      // 列表内 Tab 缩进
      const line = v.state.doc.lineAt(v.state.selection.main.from);
      if (/^\s*([-*]|\d+\.)\s/.test(line.text)) {
        v.dispatch({ changes: { from: line.from, insert: "  " } });
        return true;
      }
      return false;
    },
  },
]);

/* ── 对外暴露的扩展组合 ───────────────────────────────────────────────────── */

export function markdownExtensions(opts: {
  lineNumbers: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}): Extension[] {
  const exts: Extension[] = [
    markdown({ base: markdownLanguage, completeHTMLTags: false }),
    highlightComp.of(markdownHighlightExt),
    wysiwygComp.of(hybridField),
    typewriterPlugin,
    history(),
    closeBrackets(),
    highlightSelectionMatches(),
    markdownKeymap,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.state.doc.toString());
    }),
    keymap.of([
      {
        key: "Mod-s",
        run: () => {
          opts.onSave();
          return true;
        },
      },
    ]),
    EditorState.tabSize.of(2),
    flashField,
    findField,
    EditorView.theme({
      "&": { outline: "none !important" },
      "&.cm-focused": { outline: "none !important" },
      ".cm-scroller": { outline: "none !important" },
      ".cm-content": { outline: "none !important" },
    }),
    EditorView.contentAttributes.of({ "aria-label": "Markdown 编辑区", spellcheck: "false" }),
  ];
  if (opts.lineNumbers) {
    exts.push(lineNumbers());
  }
  return exts;
}

/** 行闪烁高亮：CM6 同样不能直接改 .cm-line class（DOMObserver 会重建），走行装饰。 */
const flashEffect = StateEffect.define<{ from: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        return e.value ? Decoration.set([Decoration.line({ class: "am-heading-flash" }).range(e.value.from)]) : Decoration.none;
      }
    }
    return v.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** 跳转到指定行（大纲 / 搜索结果导航用），使用平滑滚动并闪烁高亮目标行。 */
export function jumpToLine(view: EditorView, line: number, column = 0) {
  const info = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
  const pos = Math.min(info.from + column, info.to);
  const coords = view.coordsAtPos(pos);
  if (coords && view.scrollDOM) {
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const targetTop = view.scrollDOM.scrollTop + (coords.top - scrollerRect.top) - 32;
    view.scrollDOM.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  } else {
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
      effects: [EditorView.scrollIntoView(pos, { y: "start" })],
    });
  }
  view.dispatch({
    selection: { anchor: pos },
    effects: [flashEffect.of({ from: info.from })],
  });
  setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: flashEffect.of(null) });
  }, 1300);
}