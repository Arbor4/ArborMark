/**
 * 粘贴光标保护：粘贴后若光标被事务重置到文档最顶（首行），而文档已插入多块内容，
 * 则把光标移到插入内容末尾并滚动到位，保证「粘贴完可继续输入」的直觉。
 * 仅在 paste 事件后的下一帧检查，不干扰正常编辑/导航。
 */
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { TextSelection } from "@milkdown/prose/state";

export const pasteCaretPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          paste: (view) => {
            requestAnimationFrame(() => {
              const { state } = view;
              if (state.selection.from > 1 || state.doc.childCount < 2) return;
              const end = state.doc.content.size;
              const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(end), -1)).scrollIntoView();
              view.dispatch(tr);
            });
            return false;
          },
        },
      },
    }),
);