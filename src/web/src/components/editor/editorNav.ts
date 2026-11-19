/**
 * 统一编辑器导航：大纲/搜索跳转到标题或行，适配 Milkdown 与 CM6。
 */
import { TextSelection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { editorViewCtx, serializerCtx } from "@milkdown/core";
import { getMilkdown, getCm6 } from "./activeEditor";
import { editorJumpTo } from "./EditorHost";
import { flashNodeAfterScroll, findNodeDOM } from "./milkdownFlash";
import { computeBlockStartLines } from "./editorViewSync";
import { jumpToLine as cmJumpToLine } from "./markdown";
import { useWorkspace } from "@/stores/workspace";
import type { EditorView } from "@milkdown/prose/view";

export interface MatchLocation {
  line: number;
  start: number;
  end: number;
  match?: string;
  text?: string;
}

/** 块内文本索引 → PM 绝对位置：嵌套块（列表/表格/引用）的节点边界占位置但不占文本，不能直接用 textContent 索引。 */
function textIndexToPos(block: ProseNode, blockPos: number, textIdx: number): number | null {
  let cum = 0;
  let result: number | null = null;
  block.descendants((node, p) => {
    if (result != null) return false;
    if (node.isText) {
      const len = (node.text ?? "").length;
      if (textIdx < cum + len) {
        result = blockPos + 1 + p + (textIdx - cum);
        return false;
      }
      cum += len;
    }
    return true;
  });
  return result;
}

/** 搜索跳转：双模式精确定位到命中片段（行/列归一化后），选中+滚动居中+闪烁。 */
export async function jumpToMatch(m: MatchLocation) {
  const src = useWorkspace.getState().content;
  const matchStr = m.match || (m.text ?? "").slice(m.start, m.end);
  const stripped = matchStr.replace(/[*_`~=^]/g, "");
  // 跨文件跳转后等待文档替换完成，避免映射到旧文档
  for (let i = 0; i < 12; i++) {
    const cm = getCm6();
    if (cm) {
      if (cm.state.doc.toString() === src) break;
    } else {
      const ed = getMilkdown();
      if (ed) {
        let ready = i >= 3;
        ed.action((ctx) => {
          const t = ctx.get(editorViewCtx).state.doc.textContent;
          if ((matchStr && t.includes(matchStr)) || (stripped && t.includes(stripped))) ready = true;
        });
        if (ready) break;
      }
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  const cm = getCm6();
  if (cm) {
    cmJumpToLine(cm, m.line, m.start);
    return;
  }
  const editor = getMilkdown();
  if (!editor) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const serialize = ctx.get(serializerCtx);
    const doc = view.state.doc;
    if (!doc.childCount) return;
    const starts = computeBlockStartLines(src, doc, (n) => serialize(n));
    let bi = 0;
    for (let k = 0; k < starts.length; k++) {
      if (starts[k] <= m.line - 1) bi = k;
      else break;
    }
    bi = Math.min(bi, doc.childCount - 1);
    let pos = 0;
    for (let k = 0; k < bi; k++) pos += doc.child(k).nodeSize;
    const block = doc.child(bi);
    const text = block.textContent;
    let idx = matchStr ? text.indexOf(matchStr) : -1;
    let len = matchStr.length;
    if (idx < 0 && stripped) {
      idx = text.indexOf(stripped);
      len = stripped.length;
    }
    if (idx < 0) {
      const blockLineCount = Math.max(1, (starts[bi + 1] ?? src.split("\n").length) - starts[bi]);
      const within = Math.max(0, m.line - 1 - starts[bi]);
      idx = Math.round((within / blockLineCount) * block.content.size);
      len = 0;
    }
    idx = Math.max(0, Math.min(idx, block.content.size));
    const mapped = textIndexToPos(block, pos, idx);
    const from = mapped ?? pos + 1 + idx;
    const to = Math.min(from + len, pos + 1 + block.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)));
    const dom = view.nodeDOM(pos);
    view.dom.focus({ preventScroll: true });
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
    flashNodeAfterScroll(view, pos, block.nodeSize);
  });
}

/** 跳转到标题（按 文本+级别+出现序号 定位，兼容重复标题），使用平滑滚动至视口上部，落位后闪烁标题。 */
export function jumpToHeading(line: number, text: string, level: number, occurrence: number) {
  const editor = getMilkdown();
  if (editor) {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let count = 0;
      let targetPos: number | null = null;
      let targetSize = 0;
      const normTarget = (text ?? "").trim().replace(/[*_`~#]/g, "");

      // 1. 精确匹配：level + 规整文本 + occurrence
      view.state.doc.descendants((node, pos) => {
        if (targetPos != null) return false;
        if (node.type.name === "heading" && node.attrs.level === level) {
          const normNode = (node.textContent ?? "").trim().replace(/[*_`~#]/g, "");
          if (normNode === normTarget) {
            if (count === occurrence) {
              targetPos = pos;
              targetSize = node.nodeSize;
              return false;
            }
            count++;
          }
        }
        return true;
      });

      // 2. 兜底匹配：若未命中序号，按包含关系或相同文本的首个匹配
      if (targetPos == null) {
        let fallbackCount = 0;
        view.state.doc.descendants((node, pos) => {
          if (targetPos != null) return false;
          if (node.type.name === "heading") {
            const normNode = (node.textContent ?? "").trim().replace(/[*_`~#]/g, "");
            if (
              (node.attrs.level === level && (normNode.includes(normTarget) || normTarget.includes(normNode))) ||
              normNode === normTarget
            ) {
              if (fallbackCount === occurrence || normNode === normTarget) {
                targetPos = pos;
                targetSize = node.nodeSize;
                return false;
              }
              fallbackCount++;
            }
          }
          return true;
        });
      }

      if (targetPos != null) {
        const headingEl = findNodeDOM(view, targetPos);
        const host = document.querySelector<HTMLElement>(".am-milkdown-host");
        const scroller = host?.parentElement;

        if (scroller && headingEl) {
          const scrollerRect = scroller.getBoundingClientRect();
          const headingRect = headingEl.getBoundingClientRect();
          // 平滑滚动至视口上部并预留 32px 舒适呼吸间距
          const targetTop = scroller.scrollTop + (headingRect.top - scrollerRect.top) - 32;
          scroller.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
          });
        } else if (headingEl) {
          headingEl.scrollIntoView({ block: "start", behavior: "smooth" });
        }

        // 平滑滚动落位后再闪烁标题，严格保证先滚动后闪烁
        flashNodeAfterScroll(view, targetPos, targetSize);

        // 设置光标选区（无需调用 view.dom.focus()，避免 WebKit 在 contenteditable 获焦时强制取消平滑滚动并复位）
        try {
          const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(targetPos + 1)));
          view.dispatch(tr);
        } catch {
          /* ignore */
        }
      } else {
        editorJumpTo(line);
      }
    });
    return;
  }
  editorJumpTo(line);
}

/** 跳转到源码行号（搜索/大纲回退）。Milkdown 态按文本匹配标题，否则尽力滚动。 */
export function jumpToLine(line: number) {
  const editor = getMilkdown();
  if (editor) {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // 估算位置：按文档块比例滚动
      const totalBlocks = view.state.doc.childCount;
      const approx = Math.min(totalBlocks - 1, Math.max(0, Math.floor((line / 600) * totalBlocks)));
      let pos = 0;
      for (let i = 0; i < approx; i++) pos += view.state.doc.child(i).nodeSize;
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return;
  }
  editorJumpTo(line);
}