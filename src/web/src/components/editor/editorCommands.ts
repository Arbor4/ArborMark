/**
 * 编辑器命令集：供原生 Mac 菜单（window.File.editor.*）与工具栏调用。
 * 优先 Milkdown（ProseMirror 语义命令，保留撤销栈）；无 Milkdown 时回退 CM6 文本命令。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { toggleMark, setBlockType, wrapIn, lift } from "@milkdown/prose/commands";
import { wrapInList, liftListItem, sinkListItem } from "@milkdown/prose/schema-list";
import { editorViewCtx, schemaCtx, serializerCtx, parserCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView as PMView } from "@milkdown/prose/view";
import type { Schema, Node as PMNode } from "@milkdown/prose/model";
import { addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, deleteTable } from "prosemirror-tables";
import { getEditorView } from "./EditorHost";
import { getMilkdown } from "./activeEditor";
import { useUi } from "@/stores/ui";
import { insertAtCursor, wrapSelectionForToolbar, toggleLinePrefixForToolbar } from "./toolbarActions";
import { toolbar } from "./toolbarCommands";

function cm(): EditorView | null {
  return getEditorView();
}
function pm<T>(fn: (view: PMView, schema: Schema) => T): T | undefined {
  const editor = getMilkdown();
  if (!editor) return undefined;
  return editor.action((ctx) => fn(ctx.get(editorViewCtx), ctx.get(schemaCtx)));
}
function pmDo(fn: (view: PMView, schema: Schema) => boolean): boolean {
  return pm((v, s) => {
    const ok = fn(v, s);
    if (ok) v.focus();
    return ok;
  }) ?? false;
}
type PMCmd = (state: any, dispatch?: any, view?: PMView) => boolean;
const run = (cmd: PMCmd) => (v: PMView) => cmd(v.state, v.dispatch, v);

/** 当前顶层块（depth 1）信息。 */
function topBlock(v: PMView): { node: PMNode; pos: number } | null {
  const { $from } = v.state.selection;
  if ($from.depth < 1) return null;
  return { node: $from.node(1), pos: $from.before(1) };
}
function ancestor(v: PMView, name: string): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = v.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === name) return { node: $from.node(d), pos: $from.before(d), depth: d };
  }
  return null;
}
function markActive(v: PMView, schema: Schema, name: string): boolean {
  const mark = schema.marks[name];
  if (!mark) return false;
  const { from, to, empty, $from } = v.state.selection;
  if (empty) return !!mark.isInSet(v.state.storedMarks || $from.marks());
  return v.state.doc.rangeHasMark(from, to, mark);
}

/* ── 选择与跳转 ─────────────────────────────────────────────────────────── */

export const selection = {
  jumpTop() {
    if (pmDo((v) => { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(0), 1)).scrollIntoView()); return true; })) return;
    const v = cm(); if (!v) return;
    v.dispatch({ selection: { anchor: 0 }, scrollIntoView: true }); v.focus();
  },
  jumpBottom() {
    if (pmDo((v) => { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(v.state.doc.content.size), 1)).scrollIntoView()); return true; })) return;
    const v = cm(); if (!v) return;
    v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }); v.focus();
  },
  jumpToLineStart() {
    if (pmDo((v) => { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(v.state.selection.$from.start()), 1))); return true; })) return;
    const v = cm(); if (!v) return;
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    v.dispatch({ selection: { anchor: line.from } }); v.focus();
  },
  jumpToLineEnd() {
    if (pmDo((v) => { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(v.state.selection.$from.end()), 1))); return true; })) return;
    const v = cm(); if (!v) return;
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    v.dispatch({ selection: { anchor: line.to } }); v.focus();
  },
  jumpToSelection() {
    if (pmDo((v) => { v.dispatch(v.state.tr.scrollIntoView()); return true; })) return;
    const v = cm(); if (!v) return;
    v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }) });
    v.focus();
  },
  selectWord() {
    if (pmDo((v) => {
      const { $from } = v.state.selection;
      if (!$from.parent.isTextblock) return false;
      const text = $from.parent.textContent;
      const off = $from.parentOffset;
      const isW = (c: string) => /[\w一-鿿]/.test(c);
      let s = off, e = off;
      while (s > 0 && isW(text[s - 1])) s--;
      while (e < text.length && isW(text[e])) e++;
      if (s === e) return false;
      const base = $from.start();
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, base + s, base + e)));
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const word = v.state.wordAt(v.state.selection.main.head);
    if (word) v.dispatch({ selection: EditorSelection.range(word.from, word.to) });
    v.focus();
  },
  selectSentence() {
    if (pmDo((v) => {
      const { $from } = v.state.selection;
      if (!$from.parent.isTextblock) return false;
      const text = $from.parent.textContent;
      const off = $from.parentOffset;
      const stops = /[.!?。！？\n]/;
      let s = off, e = off;
      while (s > 0 && !stops.test(text[s - 1])) s--;
      while (s < off && /\s/.test(text[s])) s++;
      while (e < text.length && !stops.test(text[e])) e++;
      if (e < text.length && /[.!?。！？]/.test(text[e])) e++;
      const base = $from.start();
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, base + s, base + e)));
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const { doc } = v.state;
    const pos = v.state.selection.main.head;
    const text = doc.toString();
    const stops = /[.!?。！？\n]/;
    let start = pos;
    while (start > 0 && !stops.test(text[start - 1])) start--;
    while (start < pos && /\s/.test(text[start])) start++;
    let end = pos;
    while (end < text.length && !stops.test(text[end])) end++;
    if (end < text.length && /[.!?。！？]/.test(text[end])) end++;
    v.dispatch({ selection: EditorSelection.range(start, end) }); v.focus();
  },
  selectParagraphOrBlock() {
    if (pmDo((v) => {
      const b = topBlock(v);
      if (!b) return false;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, b.pos, b.pos + b.node.nodeSize)).scrollIntoView());
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const { doc } = v.state;
    const pos = v.state.selection.main.head;
    let startLine = doc.lineAt(pos).number;
    let endLine = startLine;
    while (startLine > 1 && doc.line(startLine - 1).text.trim() !== "") startLine--;
    while (endLine < doc.lines && doc.line(endLine + 1).text.trim() !== "") endLine++;
    v.dispatch({ selection: EditorSelection.range(doc.line(startLine).from, doc.line(endLine).to) });
    v.focus();
  },
  selectStyledScope() {
    if (pmDo((v) => {
      const { $from } = v.state.selection;
      const marks = $from.marks();
      if (!marks.length) return false;
      const mark = marks[marks.length - 1];
      const text = $from.parent.textContent;
      const off = $from.parentOffset;
      const base = $from.start();
      const has = (i: number) => mark.isInSet(v.state.doc.resolve(base + i).marks());
      let s = off, e = off;
      while (s > 0 && has(s - 1)) s--;
      while (e < text.length && has(e)) e++;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, base + s, base + e)));
      return true;
    })) return;
    selection.selectWord();
  },
};

/* ── 行内格式 ───────────────────────────────────────────────────────────── */

const STYLE_WRAP: Record<string, [string, string]> = {
  strong: ["**", "**"],
  em: ["*", "*"],
  underline: ["<u>", "</u>"],
  code: ["`", "`"],
  del: ["~~", "~~"],
  comment: ["%%", "%%"],
  highlight: ["==", "=="],
  superscript: ["^", "^"],
  subscript: ["~", "~"],
  inline_math: ["$", "$"],
};
const PM_MARK: Record<string, string> = {
  strong: "strong",
  em: "emphasis",
  underline: "underline",
  code: "inlineCode",
  del: "strike_through",
  comment: "comment",
  highlight: "mark",
  superscript: "superscript",
  subscript: "subscript",
};

function toggleWrap(before: string, after: string) {
  const v = cm(); if (!v) return;
  const range = v.state.selection.main;
  const selected = v.state.sliceDoc(range.from, range.to);
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    v.dispatch({ changes: { from: range.from, to: range.to, insert: inner }, selection: { anchor: range.from, head: range.from + inner.length } });
  } else if (
    v.state.sliceDoc(Math.max(0, range.from - before.length), range.from) === before &&
    v.state.sliceDoc(range.to, range.to + after.length) === after
  ) {
    v.dispatch({
      changes: [
        { from: range.from - before.length, to: range.from, insert: "" },
        { from: range.to, to: range.to + after.length, insert: "" },
      ],
      selection: { anchor: range.from - before.length, head: range.to - before.length },
    });
  } else {
    wrapSelectionForToolbar(before, after);
    return;
  }
  v.focus();
}

export const stylize = {
  toggleStyle(style: string) {
    if (style === "link") { toolbar.link(); return; }
    if (style === "image") {
      if (getMilkdown()) { useUi.getState().setImageInsertOpen(true); return; }
      insertAtCursor("![图片描述](https://)"); return;
    }
    if (style === "inline_math") {
      if (pmDo((v, schema) => {
        const type = schema.nodes.math_inline;
        if (!type) return false;
        const { from, to, empty } = v.state.selection;
        const inside = ancestor(v, "math_inline");
        if (inside) {
          v.dispatch(v.state.tr.replaceWith(inside.pos, inside.pos + inside.node.nodeSize, schema.text(inside.node.attrs.value as string)));
          return true;
        }
        const value = empty ? "E=mc^2" : v.state.doc.textBetween(from, to);
        v.dispatch(v.state.tr.replaceSelectionWith(type.create({ value })));
        return true;
      })) return;
      toggleWrap("$", "$"); return;
    }
    const markName = PM_MARK[style];
    if (markName && pmDo((v, schema) => {
      const mark = schema.marks[markName];
      if (!mark) return false;
      return run(toggleMark(mark))(v);
    })) return;
    const wrap = STYLE_WRAP[style];
    if (wrap) toggleWrap(wrap[0], wrap[1]);
  },
  setHeading(level: number) {
    if (pmDo((v, schema) => {
      const b = topBlock(v);
      const node = schema.nodes.heading;
      if (!node) return false;
      if (b && b.node.type === node && b.node.attrs.level === level) return run(setBlockType(schema.nodes.paragraph))(v);
      return run(setBlockType(node, { level }))(v);
    })) return;
    const v = cm(); if (!v) return;
    const range = v.state.selection.main;
    const startLine = v.state.doc.lineAt(range.from);
    const endLine = v.state.doc.lineAt(range.to);
    const currentM = /^(#{1,6})\s+/.exec(startLine.text);
    const isSameLevel = currentM && currentM[1].length === level;
    const changes = [];
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = v.state.doc.line(l);
      const stripped = line.text.replace(/^#{1,6}\s+/, "");
      changes.push({
        from: line.from,
        to: line.to,
        insert: isSameLevel ? stripped : "#".repeat(level) + " " + stripped,
      });
    }
    v.dispatch({ changes }); v.focus();
  },
  setParagraph() {
    if (pmDo((v, schema) => run(setBlockType(schema.nodes.paragraph))(v))) return;
    const v = cm(); if (!v) return;
    const range = v.state.selection.main;
    const startLine = v.state.doc.lineAt(range.from);
    const endLine = v.state.doc.lineAt(range.to);
    const changes = [];
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = v.state.doc.line(l);
      changes.push({ from: line.from, to: line.to, insert: line.text.replace(/^#{1,6}\s+/, "") });
    }
    v.dispatch({ changes }); v.focus();
  },
  increaseHeadingLevel() {
    const level = pm((v) => {
      const b = topBlock(v);
      return b && b.node.type.name === "heading" ? (b.node.attrs.level as number) : 0;
    });
    if (level !== undefined) { stylize.setHeading(Math.min(6, level + 1)); return; }
    const v = cm(); if (!v) return;
    const m = /^(#{1,6})\s/.exec(v.state.doc.lineAt(v.state.selection.main.head).text);
    stylize.setHeading(m ? Math.min(6, m[1].length + 1) : 1);
  },
  decreaseHeadingLevel() {
    const level = pm((v) => {
      const b = topBlock(v);
      return b && b.node.type.name === "heading" ? (b.node.attrs.level as number) : 0;
    });
    if (level !== undefined) {
      if (level > 1) stylize.setHeading(level - 1);
      else stylize.setParagraph();
      return;
    }
    const v = cm(); if (!v) return;
    const m = /^(#{1,6})\s/.exec(v.state.doc.lineAt(v.state.selection.main.head).text);
    if (m && m[1].length > 1) stylize.setHeading(m[1].length - 1);
    else stylize.setParagraph();
  },
  increaseHeaderLevel() { stylize.increaseHeadingLevel(); },
  decreaseHeaderLevel() { stylize.decreaseHeadingLevel(); },
  toggleFences() {
    if (pmDo((v, schema) => {
      const inside = ancestor(v, "code_block");
      if (inside) {
        const text = inside.node.textContent;
        const para = schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
        v.dispatch(v.state.tr.replaceWith(inside.pos, inside.pos + inside.node.nodeSize, para));
        return true;
      }
      return run(setBlockType(schema.nodes.code_block))(v);
    })) return;
    toolbar.codeBlock();
  },
  toggleMathBlock() {
    if (pmDo((v, schema) => {
      const type = schema.nodes.math_block;
      if (!type) return false;
      const inside = ancestor(v, "math_block");
      if (inside) {
        const text = inside.node.attrs.value as string;
        const para = schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
        v.dispatch(v.state.tr.replaceWith(inside.pos, inside.pos + inside.node.nodeSize, para));
        return true;
      }
      const { from, to, empty } = v.state.selection;
      const value = empty ? "" : v.state.doc.textBetween(from, to);
      v.dispatch(v.state.tr.replaceSelectionWith(type.create({ value })));
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const range = v.state.selection.main;
    const selected = v.state.sliceDoc(range.from, range.to);
    const insert = "$$\n" + (selected || "") + "\n$$";
    v.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + 3 } });
    v.focus();
  },
  toggleIndent(kind?: string) {
    if (kind === "blockquote") {
      if (pmDo((v, schema) => {
        const inside = ancestor(v, "blockquote") ?? ancestor(v, "alert");
        if (inside) return run(lift)(v);
        return run(wrapIn(schema.nodes.blockquote))(v);
      })) return;
      toggleLinePrefixForToolbar("> "); return;
    }
    if (kind === "ol") { toolbar.orderedList(); return; }
    if (kind === "tasklist") { toolbar.taskList(); return; }
    if (kind === "ul") { toolbar.bulletList(); return; }
    UserOp.moreIndent();
  },
  toggleTaskStatus(done: boolean) {
    if (pmDo((v, schema) => {
      const itemType = schema.nodes.list_item;
      if (!itemType) return false;
      let item = ancestor(v, "list_item");
      let tr = v.state.tr;
      if (!item) {
        if (!run(wrapInList(schema.nodes.bullet_list))(v)) return false;
        item = ancestor(v, "list_item");
        if (!item) return false;
        tr = v.state.tr;
      }
      tr = tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, checked: done });
      v.dispatch(tr);
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    const mark = done ? "[x]" : "[ ]";
    const m = /^(\s*(?:[-*+]|\d+\.)\s+)\[[ xX]\]/.exec(line.text);
    if (m) {
      v.dispatch({ changes: { from: line.from + m[1].length, to: line.from + m[1].length + 3, insert: mark } });
    } else {
      const prefixMatch = /^(\s*)([-*+]\s+)?/.exec(line.text);
      const indent = prefixMatch?.[1] ?? "";
      const bullet = prefixMatch?.[2] ?? "- ";
      v.dispatch({ changes: { from: line.from, to: line.from + indent.length + (prefixMatch?.[2]?.length ?? 0), insert: `${indent}${bullet}${mark} ` } });
    }
    v.focus();
  },
  insertAlert(type: string) {
    if (pmDo((v, schema) => {
      const node = schema.nodes.alert;
      if (!node) return false;
      const para = schema.nodes.paragraph.create();
      const alert = node.create({ alertType: type.toLowerCase() }, para);
      v.dispatch(v.state.tr.replaceSelectionWith(alert));
      return true;
    })) return;
    insertAtCursor(`> [!${type}]\n> `);
  },
  insertHorizontalLine() { toolbar.hr(); },
  insertTOC() {
    if (pmDo((v, schema) => {
      v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create(null, schema.text("[TOC]"))));
      return true;
    })) return;
    insertAtCursor("[TOC]\n\n");
  },
  insertFootnote() {
    if (pmDo((v, schema) => {
      const tr = v.state.tr.insertText("[^1]");
      const def = schema.nodes.paragraph.create(null, schema.text("[^1]: 脚注内容"));
      tr.insert(tr.doc.content.size, def);
      v.dispatch(tr);
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const pos = v.state.selection.main.head;
    v.dispatch({ changes: { from: pos, insert: "[^1]" }, selection: { anchor: pos + 3 } });
    v.dispatch({ changes: { from: v.state.doc.length, insert: "\n\n[^1]: 脚注内容" } });
    v.focus();
  },
  insertLinkReference() {
    if (pmDo((v, schema) => {
      const p = (t: string) => schema.nodes.paragraph.create(null, schema.text(t));
      const tr = v.state.tr.replaceSelectionWith(p("[参考链接][1]"));
      tr.insert(tr.doc.content.size, p("[1]: https://"));
      v.dispatch(tr);
      return true;
    })) return;
    insertAtCursor("[参考链接][1]\n\n[1]: https://");
  },
  insertYAML() {
    if (pmDo((v, schema) => {
      const type = schema.nodes.frontmatter;
      if (!type) return false;
      if (v.state.doc.firstChild?.type === type) return false;
      v.dispatch(v.state.tr.insert(0, type.create(null, schema.text("title: \ndate: \ntags: []"))));
      return true;
    })) return;
    insertAtCursor("---\ntitle: \ndate: \ntags: []\n---\n\n");
  },
  insertMetaBlock() { stylize.insertYAML(); },
  insertBlock(kind: string) {
    switch (kind) {
      case "hr": stylize.insertHorizontalLine(); break;
      case "toc": stylize.insertTOC(); break;
      case "def_footnote": stylize.insertFootnote(); break;
      case "def_link": stylize.insertLinkReference(); break;
      case "math": stylize.toggleMathBlock(); break;
      case "fences": stylize.toggleFences(); break;
      default: insertAtCursor("\n");
    }
  },
  clearFormat() {
    if (pmDo((v, schema) => {
      const { from, to, empty } = v.state.selection;
      if (empty) return false;
      let tr = v.state.tr;
      for (const name of Object.keys(schema.marks)) tr = tr.removeMark(from, to, schema.marks[name]);
      v.dispatch(tr);
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const range = v.state.selection.main;
    const text = v.state.sliceDoc(range.from, range.to);
    const cleaned = text
      .replace(/(\*\*|__|~~|==|%%|\^|~)(.*?)\1/g, "$2")
      .replace(/(\*|_|`)(.*?)\1/g, "$2")
      .replace(/^#{1,6}\s+/gm, "");
    v.dispatch({ changes: { from: range.from, to: range.to, insert: cleaned } }); v.focus();
  },
  clearStyle() { stylize.clearFormat(); },
  switchImageSyntax(html: boolean) {
    if (pmDo((v, schema) => {
      const img = schema.nodes.image;
      const htmlInline = schema.nodes.html_inline;
      if (!img || !htmlInline) return false;
      let tr = v.state.tr;
      let changed = false;
      const replacements: { from: number; to: number; node: PMNode }[] = [];
      v.state.doc.descendants((node, pos) => {
        if (!html && node.type === img) {
          const alt = (node.attrs.alt as string) || "";
          const src = (node.attrs.src as string) || "";
          replacements.push({ from: pos, to: pos + node.nodeSize, node: htmlInline.create({ value: `<img src="${src}" alt="${alt}">` }) });
          changed = true;
        } else if (html && node.type === htmlInline) {
          const m = /^<img\b[^>]*>$/.exec(String(node.attrs.value ?? "").trim());
          if (m) {
            const src = /src="([^"]*)"/.exec(m[0])?.[1] ?? "";
            const alt = /alt="([^"]*)"/.exec(m[0])?.[1] ?? "";
            replacements.push({ from: pos, to: pos + node.nodeSize, node: img.create({ src, alt, title: null }) });
            changed = true;
          }
        }
      });
      if (!changed) return false;
      for (const r of replacements.reverse()) tr = tr.replaceWith(r.from, r.to, r.node);
      v.dispatch(tr);
      return true;
    })) {
      useUi.getState().toast(html ? "已转换为 HTML 图片语法" : "已转换为 Markdown 图片语法", "success");
      return;
    }
    const v = cm(); if (!v) return;
    const text = v.state.doc.toString();
    const next = html
      ? text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img src="$2" alt="$1">')
      : text.replace(/<img\b[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/g, "![$2]($1)");
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
    v.focus();
  },
};

/* ── 缩进与段落 ─────────────────────────────────────────────────────────── */

export const UserOp = {
  moreIndent() {
    if (pmDo((v, schema) => run(sinkListItem(schema.nodes.list_item))(v))) return;
    toggleLinePrefixForToolbar("  ");
  },
  lessIndent() {
    if (pmDo((v, schema) => run(liftListItem(schema.nodes.list_item))(v))) return;
    const v = cm(); if (!v) return;
    const range = v.state.selection.main;
    const startLine = v.state.doc.lineAt(range.from);
    const endLine = v.state.doc.lineAt(range.to);
    const changes = [];
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = v.state.doc.line(l);
      const m = /^(\t| {1,2})/.exec(line.text);
      if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
    v.dispatch({ changes }); v.focus();
  },
  insertParagraph(above: boolean) {
    if (pmDo((v, schema) => {
      const b = topBlock(v);
      if (!b) return false;
      const pos = above ? b.pos : b.pos + b.node.nodeSize;
      const tr = v.state.tr.insert(pos, schema.nodes.paragraph.create());
      v.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1), 1)).scrollIntoView());
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    const pos = above ? line.from : line.to;
    v.dispatch({ changes: { from: pos, insert: "\n" }, selection: { anchor: above ? pos : pos + 1 } });
    v.focus();
  },
};

/* ── 表格编辑 ───────────────────────────────────────────────────────────── */

function findTable(v: EditorView): { startLine: number; endLine: number; rows: string[][] } | null {
  const { doc } = v.state;
  const cursorLine = doc.lineAt(v.state.selection.main.head).number;
  let start = cursorLine, end = cursorLine;
  const isTableLine = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.includes("|");
  if (!isTableLine(cursorLine)) return null;
  while (start > 1 && isTableLine(start - 1)) start--;
  while (end < doc.lines && isTableLine(end + 1)) end++;
  const rows: string[][] = [];
  for (let l = start; l <= end; l++) {
    const text = doc.line(l).text.trim();
    if (/^\|?[\s:|-]+\|?$/.test(text) && text.includes("-")) continue;
    const cells = text.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    rows.push(cells);
  }
  return { startLine: start, endLine: end, rows };
}

function writeTable(v: EditorView, table: { startLine: number; endLine: number }, rows: string[][]) {
  if (rows.length === 0) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => { while (r.length < cols) r.push(""); return r; });
  const header = "| " + norm[0].join(" | ") + " |";
  const sep = "| " + norm[0].map(() => "---").join(" | ") + " |";
  const body = norm.slice(1).map((r) => "| " + r.join(" | ") + " |");
  const text = [header, sep, ...body].join("\n");
  const from = v.state.doc.line(table.startLine).from;
  const to = v.state.doc.line(table.endLine).to;
  v.dispatch({ changes: { from, to, insert: text } }); v.focus();
}

/** PM：表格行/列重排（prosemirror-tables 无移动命令，直接重建表节点）。 */
function fragIndex(frag: { childCount: number; child: (i: number) => PMNode }, node: PMNode): number {
  for (let i = 0; i < frag.childCount; i++) if (frag.child(i) === node) return i;
  return -1;
}
function pmMove(tablePos: number, table: PMNode, kind: "row" | "col", fromIdx: number, toIdx: number): PMNode | null {
  const rows = table.content;
  const rowCount = table.childCount;
  const colCount = table.firstChild?.childCount ?? 0;
  if (kind === "row") {
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= rowCount || toIdx >= rowCount) return null;
    const arr = Array.from({ length: rowCount }, (_, i) => table.child(i));
    const [m] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, m);
    return table.type.create(table.attrs, arr);
  }
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= colCount || toIdx >= colCount) return null;
  const newRows = Array.from({ length: rowCount }, (_, r) => {
    const row = table.child(r);
    const cells = Array.from({ length: row.childCount }, (_, c) => row.child(c));
    const [m] = cells.splice(fromIdx, 1);
    cells.splice(toIdx, 0, m);
    return row.type.create(row.attrs, cells);
  });
  return table.type.create(table.attrs, newRows);
}

export const tableEdit = {
  insertTable() {
    useUi.getState().setTablePickerPos({ x: window.innerWidth / 2, y: Math.max(72, window.innerHeight / 2 - 180) });
  },
  addRow(above = false) {
    if (pmDo((v) => run(above ? addRowBefore : addRowAfter)(v))) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    const cols = t.rows[0]?.length ?? 3;
    if (above) t.rows.splice(1, 0, new Array(cols).fill(""));
    else t.rows.push(new Array(cols).fill(""));
    writeTable(v, t, t.rows);
  },
  addCol(before = false) {
    if (pmDo((v) => run(before ? addColumnBefore : addColumnAfter)(v))) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    t.rows.forEach((r, i) => r.splice(before ? 0 : r.length, 0, i === 0 ? `列 ${r.length + 1}` : ""));
    writeTable(v, t, t.rows);
  },
  deleteRow() {
    if (pmDo((v) => run(deleteRow)(v))) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t || t.rows.length <= 1) return;
    const cursorLine = v.state.doc.lineAt(v.state.selection.main.head).number;
    const idx = Math.max(1, cursorLine - t.startLine);
    t.rows.splice(Math.min(idx, t.rows.length - 1), 1);
    writeTable(v, t, t.rows);
  },
  deleteCol() {
    if (pmDo((v) => run(deleteColumn)(v))) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t || (t.rows[0]?.length ?? 0) <= 1) return;
    t.rows.forEach((r) => r.pop());
    writeTable(v, t, t.rows);
  },
  deleteTable() {
    if (pmDo((v) => run(deleteTable)(v))) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    const from = v.state.doc.line(t.startLine).from;
    const to = v.state.doc.line(t.endLine).to;
    v.dispatch({ changes: { from, to, insert: "" } }); v.focus();
  },
  copyTable() {
    const copied = pm((v) => {
      const t = ancestor(v, "table");
      if (!t) return false;
      const editor = getMilkdown()!;
      const md = editor.action((ctx) => ctx.get(serializerCtx)(t.node));
      navigator.clipboard?.writeText(md);
      return true;
    });
    if (copied) { useUi.getState().toast("表格已复制为 Markdown", "success"); return; }
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    const text = v.state.doc.sliceString(v.state.doc.line(t.startLine).from, v.state.doc.line(t.endLine).to);
    navigator.clipboard?.writeText(text);
  },
  reformatTable() {
    const done = pm((v) => {
      const t = ancestor(v, "table");
      if (!t) return false;
      const editor = getMilkdown()!;
      const md = editor.action((ctx) => ctx.get(serializerCtx)(t.node));
      const parsed = editor.action((ctx) => ctx.get(parserCtx)(md));
      const next = parsed.firstChild;
      if (!next || next.type.name !== "table") return false;
      v.dispatch(v.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, next));
      return true;
    });
    if (done) { useUi.getState().toast("表格已格式化", "success"); return; }
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    writeTable(v, t, t.rows);
  },
  moveRowUpOrDown(up: boolean) {
    if (pmDo((v) => {
      const t = ancestor(v, "table");
      const row = ancestor(v, "table_row") ?? ancestor(v, "table_header_row");
      if (!t || !row) return false;
      const idx = fragIndex(t.node.content, row.node);
      const next = pmMove(t.pos, t.node, "row", idx, idx + (up ? -1 : 1));
      if (!next) return false;
      v.dispatch(v.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, next));
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    const cursorLine = v.state.doc.lineAt(v.state.selection.main.head).number;
    const idx = Math.max(1, cursorLine - t.startLine);
    const target = idx + (up ? -1 : 1);
    if (target < 1 || target >= t.rows.length) return;
    [t.rows[idx], t.rows[target]] = [t.rows[target], t.rows[idx]];
    writeTable(v, t, t.rows);
  },
  moveColLeftOrRight(left: boolean) {
    if (pmDo((v) => {
      const t = ancestor(v, "table");
      const cell = ancestor(v, "table_cell") ?? ancestor(v, "table_header");
      if (!t || !cell) return false;
      const row = cell.depth > 0 ? v.state.selection.$from.node(cell.depth - 1) : null;
      if (!row) return false;
      const idx = fragIndex(row.content, cell.node);
      const next = pmMove(t.pos, t.node, "col", idx, idx + (left ? -1 : 1));
      if (!next) return false;
      v.dispatch(v.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, next));
      return true;
    })) return;
    const v = cm(); if (!v) return;
    const t = findTable(v); if (!t) return;
    const cols = t.rows[0]?.length ?? 0;
    if (cols < 2) return;
    const idx = 0;
    const target = idx + (left ? -1 : 1);
    if (target < 0 || target >= cols) return;
    t.rows.forEach((r) => { [r[idx], r[target]] = [r[target], r[idx]]; });
    writeTable(v, t, t.rows);
  },
};

/* ── 代码围栏 / 数学 / 链接 / 拼写 ───────────────────────────────────────── */

const BRACE_LANG = /^(js|javascript|typescript|ts|jsx|tsx|java|c|cpp|csharp|cs|go|rust|json|swift|kotlin|scala|php|css|scss|less)/i;

function autoIndent(code: string, lang: string): string | null {
  if (!BRACE_LANG.test(lang)) return null;
  let depth = 0;
  return code
    .split("\n")
    .map((line) => {
      const t = line.trim();
      const leadClose = (t.match(/^[)}\]]+/) || [""])[0].length;
      const d = Math.max(0, depth - leadClose);
      const out = t ? "  ".repeat(d) + t : "";
      const opens = (t.match(/[{([]/g) || []).length;
      const closes = (t.match(/[)}\]]/g) || []).length;
      depth = Math.max(0, depth + opens - closes);
      return out;
    })
    .join("\n");
}

export const fences = {
  copyContent() {
    const copied = pm((v) => {
      const cb = ancestor(v, "code_block");
      if (!cb) return false;
      navigator.clipboard?.writeText(cb.node.textContent);
      return true;
    });
    if (copied) { useUi.getState().toast("代码内容已复制", "success"); return; }
    const v = cm(); if (!v) return;
    const { doc } = v.state;
    const line = doc.lineAt(v.state.selection.main.head);
    let start = line.number, end = line.number;
    while (start > 1 && !/^```/.test(doc.line(start - 1).text)) start--;
    while (end < doc.lines && !/^```/.test(doc.line(end + 1).text)) end++;
    const content = doc.sliceString(doc.line(start).from, doc.line(end).to);
    navigator.clipboard?.writeText(content);
    useUi.getState().toast("代码内容已复制", "success");
  },
  formatContent(selectedOnly = false) {
    const done = pm((v, schema) => {
      const cb = ancestor(v, "code_block");
      if (!cb) return false;
      const lang = (cb.node.attrs.language as string) || "";
      const next = autoIndent(cb.node.textContent, lang);
      if (next == null) { useUi.getState().toast("该语言不支持自动缩进", "info"); return true; }
      const replacement = schema.nodes.code_block.create({ ...cb.node.attrs }, next ? schema.text(next) : undefined);
      v.dispatch(v.state.tr.replaceWith(cb.pos, cb.pos + cb.node.nodeSize, replacement));
      return true;
    });
    if (done) return;
    const v = cm(); if (!v) return;
    const { doc } = v.state;
    const range = v.state.selection.main;
    let from = range.from, to = range.to;
    let scan = doc.lineAt(range.head).number;
    while (scan > 1 && !/^```/.test(doc.line(scan).text)) scan--;
    let lang = /^```(\w+)/.exec(doc.line(scan).text)?.[1] ?? "";
    if (!selectedOnly || range.empty) {
      let start = scan, end = doc.lineAt(range.head).number;
      while (start > 1 && !/^```/.test(doc.line(start - 1).text)) start--;
      while (end < doc.lines && !/^```/.test(doc.line(end + 1).text)) end++;
      lang = /^```(\w+)/.exec(doc.line(start).text)?.[1] ?? "";
      from = doc.line(Math.min(start + 1, end)).from;
      to = doc.line(end).to;
    }
    const next = autoIndent(doc.sliceString(from, to), lang);
    if (next == null) { useUi.getState().toast("该语言不支持自动缩进", "info"); return; }
    v.dispatch({ changes: { from, to, insert: next } });
    v.focus();
  },
};

export const mathBlock = {
  forceRefresh() {
    const done = pm((v, schema) => {
      let tr = v.state.tr;
      let changed = false;
      v.state.doc.descendants((node, pos) => {
        if (node.type.name === "math_block" || node.type.name === "math_inline") {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs });
          changed = true;
        }
      });
      if (changed) v.dispatch(tr);
      return changed;
    });
    useUi.getState().toast(done ? "数学公式已刷新" : "KaTeX 即时渲染，无需手动刷新", "success");
  },
};

export const contextMenu = {
  copyLink() {
    const href = pm((v, schema) => {
      const mark = schema.marks.link;
      if (!mark) return null;
      const link = v.state.selection.$from.marks().find((m) => m.type === mark);
      return link ? (link.attrs.href as string) : null;
    });
    if (href) { navigator.clipboard?.writeText(href); useUi.getState().toast("链接地址已复制", "success"); return; }
    const v = cm(); if (!v) return;
    const range = v.state.selection.main;
    const text = v.state.sliceDoc(range.from, range.to);
    const m = /\((https?:[^)]+)\)/.exec(text) || /\((https?:[^)]+)\)/.exec(v.state.doc.lineAt(range.head).text);
    if (m) navigator.clipboard?.writeText(m[1]);
  },
  openLink() {
    const href = pm((v, schema) => {
      const mark = schema.marks.link;
      if (!mark) return null;
      const marks = v.state.selection.$from.marks();
      const link = marks.find((m) => m.type === mark);
      return link ? (link.attrs.href as string) : null;
    });
    if (href) { window.open(href, "_blank"); return; }
    const v = cm(); if (!v) return;
    const line = v.state.doc.lineAt(v.state.selection.main.head).text;
    const m = /\((https?:[^)]+)\)/.exec(line);
    if (m) window.open(m[1], "_blank");
  },
};

export const spellChecker = {
  langMode_: "disabled",
  show() { useUi.getState().setPref("spellcheck", true); },
  reset() { useUi.getState().setPref("spellcheck", false); },
  setLangMode(mode: string) {
    spellChecker.langMode_ = mode;
    useUi.getState().setPref("spellcheck", mode !== "disabled");
  },
};