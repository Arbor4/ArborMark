/**
 * 标题闪烁高亮（Milkdown）：用 ProseMirror node decoration 而非直接改 class——
 * PM 的 DOMObserver 会把外部 class 变更视为 DOM 被改动而重建节点，导致闪烁丢失。
 * decoration 由编辑器自身管理，可安全存活于选区/文档更新。
 */
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { EditorView } from "@milkdown/prose/view";

export const flashKey = new PluginKey<{ from: number; to: number } | null>("am-heading-flash");

export const flashPlugin = $prose(
  () =>
    new Plugin({
      key: flashKey,
      state: {
        init: (): { from: number; to: number } | null => null,
        apply(tr, val) {
          const meta = tr.getMeta(flashKey);
          if (meta !== undefined) return meta;
          if (!val) return null;
          const from = tr.mapping.mapResult(val.from);
          if (from.deleted) return null;
          return { from: from.pos, to: tr.mapping.map(val.to) };
        },
      },
      props: {
        decorations(state) {
          const f = flashKey.getState(state);
          return f
            ? DecorationSet.create(state.doc, [Decoration.node(f.from, f.to, { class: "am-heading-flash" })])
            : DecorationSet.empty;
        },
      },
    }),
);

/** 闪烁指定节点（标题），1.3s 后自动清除。 */
export function flashNode(view: EditorView, pos: number, nodeSize: number) {
  view.dispatch(view.state.tr.setMeta(flashKey, { from: pos, to: pos + nodeSize }));
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(flashKey, null));
  }, 1300);
}

/** 找 ProseMirror 节点在 DOM 树中对应的最近 HTMLElement。 */
export function findNodeDOM(view: EditorView, pos: number): HTMLElement | null {
  const nodeDom = view.nodeDOM(pos);
  if (nodeDom instanceof HTMLElement) return nodeDom;
  if (nodeDom && (nodeDom as Node).parentElement instanceof HTMLElement) {
    return (nodeDom as Node).parentElement!.closest("h1, h2, h3, h4, h5, h6, p, blockquote, pre") ?? (nodeDom as Node).parentElement!;
  }
  try {
    const at = view.domAtPos(pos + 1);
    const n = at.node;
    if (n instanceof HTMLElement) {
      return n.closest("h1, h2, h3, h4, h5, h6, p, blockquote, pre") ?? n;
    }
    if (n && n.parentElement instanceof HTMLElement) {
      return n.parentElement.closest("h1, h2, h3, h4, h5, h6, p, blockquote, pre") ?? n.parentElement;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 找元素最近的可垂直滚动祖先；找不到则回退到文档滚动元素。 */
function scrollParentOf(el: HTMLElement): Element | null {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return document.scrollingElement;
}

/**
 * 等平滑滚动完全落位后再闪烁：
 * 优先监听现代浏览器的 `scrollend` 事件，同时辅以 rAF / 滚动位移静止检测与超时兜底；
 * 确保先完成视口平滑移动，落位后再执行标题高亮闪烁动画。
 */
export function flashNodeAfterScroll(view: EditorView, pos: number, nodeSize: number, maxWait = 1800) {
  let done = false;
  const flash = () => {
    if (done) return;
    done = true;
    cleanup();
    if (!view.isDestroyed) flashNode(view, pos, nodeSize);
  };

  const scroller = scrollParentOf(view.dom as HTMLElement);
  if (!scroller) {
    flash();
    return;
  }

  // 若目标元素已经在视口上方合适区域（无需大幅滚动），延时微小时机即闪烁
  const dom = findNodeDOM(view, pos);
  if (dom instanceof HTMLElement) {
    const sRect = scroller.getBoundingClientRect();
    const dRect = dom.getBoundingClientRect();
    const diff = Math.abs(dRect.top - sRect.top);
    if (diff < 12) {
      setTimeout(flash, 80);
      return;
    }
  }

  let cleanup = () => {};
  const onScrollEnd = () => {
    // 滚动停止后微等 60ms 确保布局彻底沉淀，再闪烁
    setTimeout(flash, 60);
  };

  // 1. 优先注册原生 scrollend 事件
  scroller.addEventListener("scrollend", onScrollEnd, { once: true });

  // 2. 双保险：rAF 定时跟踪滚动位移，处理不支持 scrollend 或微小惯性结束
  const start = performance.now();
  let lastTop = scroller.scrollTop;
  let stillSince = 0;
  let timerId: number | null = null;

  const check = () => {
    if (done) return;
    const now = performance.now();
    const curTop = scroller.scrollTop;
    if (Math.abs(curTop - lastTop) > 1) {
      lastTop = curTop;
      stillSince = now;
    } else {
      // 至少在平滑滚动启动 150ms 之后，且位移保持静止超过 120ms，才视为落位
      if (now - start >= 150 && now - stillSince >= 120) {
        flash();
        return;
      }
    }
    if (now - start >= maxWait) {
      flash();
      return;
    }
    timerId = window.requestAnimationFrame(check);
  };

  timerId = window.requestAnimationFrame(check);

  cleanup = () => {
    scroller.removeEventListener("scrollend", onScrollEnd);
    if (timerId != null) window.cancelAnimationFrame(timerId);
  };
}