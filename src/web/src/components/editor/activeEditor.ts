/**
 * 活跃编辑器注册表：编辑态为 Milkdown（ProseMirror），源码态为 CodeMirror。
 * 工具栏与原生菜单命令通过统一接口分发到当前活跃编辑器。
 */
import type { EditorView } from "@codemirror/view";
import type { Editor } from "@milkdown/core";

export type ActiveEditor =
  | { kind: "cm6"; view: EditorView }
  | { kind: "milkdown"; editor: Editor }
  | null;

let active: ActiveEditor = null;

const userEditListeners = new Set<() => void>();

export function onUserEdit(fn: () => void): () => void {
  userEditListeners.add(fn);
  return () => {
    userEditListeners.delete(fn);
  };
}

export function notifyUserEdit() {
  for (const fn of userEditListeners) {
    try {
      fn();
    } catch {
      // 容错
    }
  }
}

export function setActiveEditor(a: ActiveEditor) {
  active = a;
}
export function getActiveEditor(): ActiveEditor {
  return active;
}
export function getMilkdown(): Editor | null {
  return active?.kind === "milkdown" ? active.editor : null;
}
export function getCm6(): EditorView | null {
  return active?.kind === "cm6" ? active.view : null;
}