/**
 * 统一工具栏命令：分发到当前活跃编辑器。
 * Milkdown（编辑态）用 ProseMirror 语义命令；命令不适用或无 Milkdown 时
 * 回退 CM6（源码态）文本命令。md() 返回命令是否真正应用，避免静默失效。
 */
import { toggleMark, setBlockType, wrapIn } from "@milkdown/prose/commands";
import { wrapInList, liftListItem } from "@milkdown/prose/schema-list";
import { editorViewCtx, schemaCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type { Schema, NodeType, Node as ProseNode } from "@milkdown/prose/model";
import { getMilkdown, getCm6, notifyUserEdit } from "./activeEditor";
import { wrapSelectionForToolbar, insertAtCursor, toggleLinePrefixForToolbar } from "./toolbarActions";

type PMCommand = (state: any, dispatch?: any, view?: EditorView) => boolean;

function md(fn: (view: EditorView, schema: Schema) => boolean): boolean {
  const editor = getMilkdown();
  if (!editor) return false;
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const schema = ctx.get(schemaCtx);
    notifyUserEdit();
    const ok = fn(view, schema);
    if (ok) view.focus();
    return ok;
  });
}

function runMark(name: string, attrs?: Record<string, unknown>) {
  return md((view, schema) => {
    const mark = schema.marks[name];
    if (!mark) return false;
    return (toggleMark(mark, attrs) as PMCommand)(view.state, view.dispatch, view);
  });
}
function runBlock(name: string, attrs?: Record<string, unknown>) {
  return md((view, schema) => {
    const node = schema.nodes[name];
    if (!node) return false;
    return (setBlockType(node, attrs) as PMCommand)(view.state, view.dispatch, view);
  });
}
function runWrap(name: string) {
  return md((view, schema) => {
    const node = schema.nodes[name];
    if (!node) return false;
    return (wrapIn(node) as PMCommand)(view.state, view.dispatch, view);
  });
}
function runList(name: string) {
  return md((view, schema) => {
    const node = schema.nodes[name];
    const itemType = schema.nodes.list_item;
    if (!node || !itemType) return false;
    const { $from } = view.state.selection;
    let listDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      const t = $from.node(d).type;
      if (t === schema.nodes.bullet_list || t === schema.nodes.ordered_list) { listDepth = d; break; }
    }
    if (listDepth > 0) {
      // 同型列表 → 取消；异型列表 → 先 lift 再 wrap 转换
      if ($from.node(listDepth).type === node) {
        return liftListItem(itemType)(view.state, view.dispatch, view);
      }
      if (!liftListItem(itemType)(view.state, view.dispatch, view)) return false;
      return (wrapInList(node) as PMCommand)(view.state, view.dispatch, view);
    }
    return (wrapInList(node) as PMCommand)(view.state, view.dispatch, view);
  });
}
function insertNode(name: string, attrs?: Record<string, unknown>) {
  return md((view, schema) => {
    const node = schema.nodes[name];
    if (!node) return false;
    const n = node.createAndFill(attrs);
    if (!n) return false;
    view.dispatch(view.state.tr.replaceSelectionWith(n));
    return true;
  });
}
/** 整块插入后把光标落到块后文本行（无则补空行），避免下一次插入替换刚插入的块。 */
function dispatchBlockInsert(view: EditorView, schema: Schema, n: ProseNode) {
  const tr = view.state.tr.replaceSelectionWith(n);
  let sel = TextSelection.near(tr.doc.resolve(Math.min(tr.selection.to, tr.doc.content.size)), 1);
  if (!(sel instanceof TextSelection)) {
    tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
    sel = TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1), 1);
  }
  view.dispatch(tr.setSelection(sel));
}
function insertBlockNode(name: string, attrs?: Record<string, unknown>) {
  return md((view, schema) => {
    const type = schema.nodes[name];
    if (!type) return false;
    dispatchBlockInsert(view, schema, type.create(attrs));
    return true;
  });
}

export const toolbar = {
  bold() {
    if (!runMark("strong")) wrapSelectionForToolbar("**");
  },
  italic() {
    if (!runMark("emphasis")) wrapSelectionForToolbar("*");
  },
  strikethrough() {
    if (!runMark("strike_through")) wrapSelectionForToolbar("~~");
  },
  inlineCode() {
    if (!runMark("inlineCode")) wrapSelectionForToolbar("`");
  },
  heading(level: number) {
    if (!runBlock("heading", { level })) toggleLinePrefixForToolbar("#".repeat(level) + " ");
  },
  paragraph() {
    if (!runBlock("paragraph")) toggleLinePrefixForToolbar("");
  },
  quote() {
    if (!runWrap("blockquote")) toggleLinePrefixForToolbar("> ");
  },
  bulletList() {
    if (!runList("bullet_list")) toggleLinePrefixForToolbar("- ");
  },
  orderedList() {
    if (!runList("ordered_list")) toggleLinePrefixForToolbar("1. ");
  },
  taskList() {
    const done = md((view, schema) => {
      const listType = schema.nodes.bullet_list;
      const itemType = schema.nodes.list_item;
      if (!listType || !itemType) return false;
      let tr = view.state.tr;
      const { $from } = view.state.selection;
      let inList = false;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === itemType) { inList = true; break; }
      }
      if (!inList && !wrapInList(listType)(view.state, (t) => { tr = t; })) return false;
      const targets: number[] = [];
      tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
        if (node.type === itemType) targets.push(pos);
      });
      if (!targets.length) return false;
      // 范围内存在非 task 项 → 全部转 task；否则全部还原普通列表项
      const makeTask = targets.some((pos) => tr.doc.nodeAt(pos)!.attrs.checked == null);
      for (const pos of targets) {
        const node = tr.doc.nodeAt(pos)!;
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: makeTask ? false : null });
      }
      view.dispatch(tr);
      return true;
    });
    if (!done) toggleLinePrefixForToolbar("- [ ] ");
  },
  link() {
    const done = md((view, schema) => {
      const mark = schema.marks.link;
      if (!mark) return false;
      const { state } = view;
      if (state.selection.empty) {
        // 空选区插入占位链接文本，保证按钮有可见反馈
        const text = schema.text("链接", [mark.create({ href: "https://", title: "" })]);
        view.dispatch(state.tr.replaceSelectionWith(text, false));
        return true;
      }
      return (toggleMark(mark, { href: "https://", title: "" }) as PMCommand)(state, view.dispatch, view);
    });
    if (!done) insertAtCursor("[链接](https://)");
  },
  codeBlock() {
    const done = md((view, schema) => {
      const node = schema.nodes.code_block;
      if (!node) return false;
      if ((setBlockType(node) as PMCommand)(view.state, view.dispatch, view)) return true;
      // list_item 首子节点必须为 paragraph：先 lift 出列表再转换
      const itemType = schema.nodes.list_item;
      if (itemType && liftListItem(itemType)(view.state, view.dispatch, view)) {
        return (setBlockType(node) as PMCommand)(view.state, view.dispatch, view);
      }
      return false;
    });
    if (!done) insertAtCursor("```\n\n```");
  },
  hr() {
    if (!insertNode("hr")) insertAtCursor("\n---\n");
  },
  table(rows = 3, cols = 3) {
    const r = Math.max(2, Math.min(20, Math.round(rows)));
    const c = Math.max(1, Math.min(12, Math.round(cols)));
    const done = md((view, schema) => {
      const cell = schema.nodes.table_cell;
      const header = schema.nodes.table_header;
      const row = schema.nodes.table_row;
      const headerRow = schema.nodes.table_header_row;
      const tableNode = schema.nodes.table;
      const paragraph = schema.nodes.paragraph;
      if (!cell || !row || !headerRow || !tableNode || !paragraph) return false;
      // gfm 单元格 content 为 block+，文本必须包在 paragraph 内；新建表格全空（含表头行）
      const makeCell = (type: NodeType) =>
        type.createAndFill(null, paragraph.create())!;
      const hRow = headerRow.createAndFill(
        null,
        Array.from({ length: c }, () => makeCell(header ?? cell)),
      );
      const bodyRows = Array.from({ length: r - 1 }, () =>
        row.createAndFill(null, Array.from({ length: c }, () => makeCell(cell))),
      );
      if (!hRow || bodyRows.some((b) => !b)) return false;
      const t = tableNode.createAndFill(null, [hRow, ...bodyRows.filter((b): b is NonNullable<typeof b> => b != null)]);
      if (!t) return false;
      // 光标在表格内时插到该表之后，避免嵌套表格
      const { $from } = view.state.selection;
      let d = $from.depth;
      while (d > 0 && $from.node(d).type.name !== "table") d--;
      let tr = view.state.tr;
      if (d > 0) {
        while (d > 1 && $from.node(d - 1).type.name === "table") d--;
        const end = $from.before(d) + $from.node(d).nodeSize;
        tr = tr.insert(end, t);
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2), 1));
      } else {
        tr = tr.replaceSelectionWith(t);
      }
      view.dispatch(tr);
      return true;
    });
    if (!done) {
      const head = `| ${Array.from({ length: c }, () => " ").join(" | ")} |`;
      const divider = `| ${Array.from({ length: c }, () => "---").join(" | ")} |`;
      const empty = `| ${Array.from({ length: c }, () => " ").join(" | ")} |`;
      insertAtCursor([head, divider, ...Array.from({ length: r - 1 }, () => empty)].join("\n") + "\n");
    }
  },
  mathBlock() {
    const done = md((view, schema) => {
      const type = schema.nodes.math_block;
      if (!type) return false;
      const { from, to, empty } = view.state.selection;
      const value = empty ? "" : view.state.doc.textBetween(from, to);
      dispatchBlockInsert(view, schema, type.create({ value }));
      return true;
    });
    if (!done) insertAtCursor("$$\n\n$$");
  },
  diagram() {
    if (!insertBlockNode("diagram", { value: "" })) insertAtCursor("```mermaid\n\n```");
  },
  blankImage() {
    const done = md((view, schema) => {
      const node = schema.nodes.image;
      if (!node) return false;
      view.dispatch(view.state.tr.replaceSelectionWith(node.create({ src: "", alt: "" })));
      return true;
    });
    if (!done) insertAtCursor("![]()");
  },
};

/** 供菜单桥接调用：当前是否处于 Milkdown 编辑态。 */
export function isMilkdownActive(): boolean {
  return !!getMilkdown();
}
export function cm6Fallback() {
  return getCm6();
}