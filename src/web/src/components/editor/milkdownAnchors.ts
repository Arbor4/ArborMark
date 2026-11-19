/**
 * 文内锚点跳转：拦截编辑区 a[href^="#"] 点击（含 [TOC] 之外的 Markdown 锚点链接），
 * 依次按 已渲染自定义锚点 id → 标题 slug/原文 → 原始 HTML 中的 id 定义 定位，
 * 平滑滚动并闪烁目标块；「⬆ 回到顶部」等链接由此生效。
 */
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { flashNodeAfterScroll } from "./milkdownFlash";
import { useLinkEdit } from "@/stores/linkEdit";
import { openLinkTarget } from "./openLink";

/** GitHub 风格标题 slug：小写、去标点、空格转连字符（保留中文）。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrollToEl(view: EditorView, el: HTMLElement, block: "start" | "center") {
  el.scrollIntoView({ block, behavior: "smooth" });
  try {
    const pos = view.posAtDOM(el, 0);
    const $pos = view.state.doc.resolve(pos);
    const bp = $pos.depth > 0 ? $pos.before(1) : pos;
    const blockNode = view.state.doc.nodeAt(bp);
    if (blockNode) flashNodeAfterScroll(view, bp, blockNode.nodeSize);
  } catch {
    /* 忽略 */
  }
}

export function jumpToAnchor(view: EditorView, id: string) {
  // 1) 渲染态自定义锚点（<a id="top"></a> 等行内/块级 HTML）
  const el = view.dom.querySelector(`[id="${CSS.escape(id)}"]`);
  if (el instanceof HTMLElement) {
    scrollToEl(view, el, "center");
    return;
  }
  // 2) 标题 slug 或原文匹配
  let targetPos: number | null = null;
  let targetSize = 0;
  view.state.doc.descendants((node, pos) => {
    if (targetPos != null) return false;
    if (node.type.name === "heading" && (slugify(node.textContent) === id || node.textContent === id)) {
      targetPos = pos;
      targetSize = node.nodeSize;
      return false;
    }
    return true;
  });
  if (targetPos != null) {
    const dom = view.nodeDOM(targetPos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start", behavior: "smooth" });
    flashNodeAfterScroll(view, targetPos, targetSize);
    return;
  }
  // 3) 未渲染出 id 的原始 HTML 节点（源码态 id 定义）
  const idRe = new RegExp(`\\bid=["']${escapeRe(id)}["']`);
  view.state.doc.descendants((node, pos) => {
    if (targetPos != null) return false;
    const value = (node.attrs?.value as string) ?? "";
    if ((node.type.name === "html_block" || node.type.name === "html_inline") && idRe.test(value)) {
      targetPos = pos;
      return false;
    }
    return true;
  });
  if (targetPos != null) {
    const dom = view.nodeDOM(targetPos);
    if (dom instanceof HTMLElement) scrollToEl(view, dom, "center");
  }
}

export const anchorPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          click: (view, event) => {
            const target = event.target as HTMLElement | null;
            const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!a || !view.dom.contains(a)) return false;
            const href = a.getAttribute("href") ?? "";
            if (!href || href.startsWith("javascript:")) return false;
            event.preventDefault();
            const mod = event.ctrlKey || event.metaKey;
            if (mod) {
              // ⌘/Ctrl+单击：统一支持锚点跳转、本地相对文件无缝切换、外部网页打开
              void openLinkTarget(href);
              return true;
            }
            // 单击：进入链接编辑模式
            const from = view.posAtDOM(a, 0);
            const text = a.textContent ?? "";
            const rect = a.getBoundingClientRect();
            useLinkEdit.getState().openLink({
              x: rect.left + rect.width / 2,
              y: rect.top,
              from,
              to: from + text.length,
              text,
              href,
              title: a.getAttribute("title") ?? "",
            });
            return true;
          },
        },
      },
    }),
);