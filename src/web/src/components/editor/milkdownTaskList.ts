/**
 * 任务列表 node view：为 task 项渲染可点击复选框（切换 checked），普通列表项保持原结构。
 * 修复 gfm 任务列表只渲染 data-checked 属性、无可见/可点击复选框的问题。
 */
import { $view } from "@milkdown/utils";
import { listItemSchema } from "@milkdown/preset-commonmark";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { notifyUserEdit } from "./activeEditor";

export const taskListNodeView = $view(listItemSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node: ProseNode = initialNode;
  const isTask = node.attrs.checked != null;

  const dom = document.createElement("li");
  let checkbox: HTMLInputElement | null = null;
  let checkboxWrap: HTMLElement | null = null;
  let contentDOM: HTMLElement;

  if (isTask) {
    // 复选框外包一层交互壳：contenteditable 里鼠标按在原生 checkbox 上时，
    // Blink 会做按压预览、并在 click 被 preventDefault 后把 checkedness 回滚到
    // 按下前的值（不走 JS setter，发生在 applyAttrs 之后）——表现为文字划线了、框没勾上。
    // input 设 pointer-events:none 让鼠标事件永远不落到底层 input，回滚机制不再触发；
    // 键盘（Space/Enter）经 click 冒泡仍走同一处理路径，可访问性不受影响。
    checkboxWrap = document.createElement("span");
    checkboxWrap.className = "am-task-box";
    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "am-task-checkbox";
    checkbox.checked = Boolean(node.attrs.checked);
    checkbox.contentEditable = "false";
    checkbox.style.pointerEvents = "none";
    checkbox.setAttribute("aria-label", node.attrs.checked ? "标记为未完成" : "标记为完成");
    checkboxWrap.appendChild(checkbox);
    dom.appendChild(checkboxWrap);
    contentDOM = document.createElement("div");
    contentDOM.className = "am-task-content";
    dom.appendChild(contentDOM);
    checkboxWrap.addEventListener("mousedown", (e) => e.preventDefault());
    checkboxWrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      notifyUserEdit();
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (pos != null) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
      }
      view.focus();
    });
  } else {
    contentDOM = dom;
  }

  const applyAttrs = () => {
    dom.dataset.label = node.attrs.label as string;
    dom.dataset.listType = node.attrs.listType as string;
    dom.dataset.spread = String(node.attrs.spread);
    if (isTask) {
      dom.dataset.itemType = "task";
      dom.dataset.checked = String(node.attrs.checked);
      if (checkbox) {
        checkbox.checked = Boolean(node.attrs.checked);
        checkbox.setAttribute("aria-label", node.attrs.checked ? "标记为未完成" : "标记为完成");
      }
      dom.classList.toggle("am-task-done", Boolean(node.attrs.checked));
    }
  };
  applyAttrs();

  return {
    dom,
    contentDOM,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      // task 与非 task 结构不同，需重建
      if ((newNode.attrs.checked != null) !== isTask) return false;
      node = newNode;
      applyAttrs();
      return true;
    },
    stopEvent(event: Event) {
      return !!checkboxWrap && checkboxWrap.contains(event.target as Node);
    },
    ignoreMutation(mutation: { target: Node }) {
      if (!checkbox) return false;
      return !contentDOM.contains(mutation.target);
    },
    destroy() {},
  };
});