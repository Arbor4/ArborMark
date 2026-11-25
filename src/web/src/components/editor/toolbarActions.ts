import { getEditorView } from "./codemirror/EditorHost";

/** 工具栏动作：直接操作 CM6 视图（保留撤销栈）。 */

export function wrapSelectionForToolbar(before: string, after = before) {
  const view = getEditorView();
  if (!view) return;
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: before + selected + after },
    selection: {
      anchor: range.from + before.length,
      head: range.from + before.length + selected.length,
    },
  });
  view.focus();
}

export function insertAtCursor(text: string) {
  const view = getEditorView();
  if (!view) return;
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
  view.focus();
}

export function toggleLinePrefixForToolbar(prefix: string) {
  const view = getEditorView();
  if (!view) return;
  const range = view.state.selection.main;
  const startLine = view.state.doc.lineAt(range.from);
  const endLine = view.state.doc.lineAt(range.to);
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}`);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let l = startLine.number; l <= endLine.number; l++) {
    const line = view.state.doc.line(l);
    const m = re.exec(line.text);
    if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    else changes.push({ from: line.from, to: line.from, insert: prefix });
  }
  view.dispatch({ changes });
  view.focus();
}