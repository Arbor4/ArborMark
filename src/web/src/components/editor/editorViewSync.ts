/**
 * 编辑 ↔ 源码 视图切换的行定位。
 * 源文件可能含多余空行 / Setext 标题等与序列化输出不一致的写法，行号累加会漂移；
 * 因此用「文本锚点」映射：以块的首行（序列化首行或纯文本首行，空白归一化）在源文件中
 * 单调顺序搜索真实行号，块内偏移按比例估算。不依赖 mdast position（parserCtx 返回 PM doc）。
 * - 编辑态卸载：选区块 → 源文件行/列锚点；
 * - 源码态卸载：CM 光标行/列 → 锚点；
 * - 另一视图挂载后消费锚点：设置选区并滚动居中。
 */
import { editorViewCtx, serializerCtx } from "@milkdown/core";
import type { Editor } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { EditorView } from "@codemirror/view";
import type { EditorView as CmView } from "@codemirror/view";
import { useWorkspace } from "@/stores/workspace";

export interface ViewAnchor {
  line: number;
  column: number;
}

let anchor: ViewAnchor | null = null;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** 源文件块扫描器：行状态机切块，返回每块起始行（0-based），与 PM 顶层块按序对齐。 */
export function scanSourceBlocks(src: string): number[] {
  const lines = src.split("\n");
  const starts: number[] = [];
  let i = 0;
  const isBlank = (s: string) => s.trim() === "";
  const isTableSep = (s: string) => /^\|?[\s:|-]+\|?$/.test(s.trim()) && s.includes("-") && s.includes("|");
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (isBlank(line)) { i++; continue; }
    const start = i;
    if (i === 0 && t === "---") {
      i++;
      while (i < lines.length && lines[i].trim() !== "---") i++;
      i++;
    } else if (/^(```|~~~)/.test(t)) {
      const fence = t.slice(0, 3);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) i++;
      i++;
    } else if (t === "$$") {
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") i++;
      i++;
    } else if (/^<details\b/i.test(t)) {
      while (i < lines.length && !/^<\/details\s*>$/i.test(lines[i].trim())) i++;
      i++;
    } else if (/^<[a-zA-Z]/.test(t) && !/^<(a|span|kbd|mark|u|sup|sub|abbr|em|strong|code|br)\b/i.test(t)) {
      i++;
    } else if (/^#{1,6}\s/.test(t)) {
      i++;
    } else if (/^(\*{3,}|-{3,}|_{3,})$/.test(t)) {
      i++;
    } else if (i + 1 < lines.length && /^=+\s*$/.test(lines[i + 1])) {
      i += 2;
    } else if (t.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      i += 2;
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) i++;
    } else if (/^>/.test(t)) {
      while (i < lines.length && (/^>/.test(lines[i].trim()) || (!isBlank(lines[i]) && /^>/.test(lines[i - 1]?.trim() ?? "")))) i++;
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      i++;
      while (i < lines.length && !isBlank(lines[i]) && (/^\s*([-*+]|\d+\.)\s/.test(lines[i]) || /^\s+\S/.test(lines[i]))) i++;
    } else if (i + 1 < lines.length && /^-+\s*$/.test(lines[i + 1]) && !isTableSep(lines[i + 1])) {
      i += 2;
    } else {
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !/^#{1,6}\s/.test(lines[i].trim()) && !/^(```|~~~)/.test(lines[i].trim()) && !/^>/.test(lines[i].trim())) i++;
    }
    starts.push(start);
  }
  return starts;
}

/** 块在源文件中的候选首行（序列化首行 / 纯文本首行，空白归一化后精确匹配）。 */
function candidates(block: ProseNode, serFirst: string): string[] {
  const text = block.textContent;
  const firstTextLine = text.split("\n")[0] ?? "";
  return [norm(serFirst), norm(firstTextLine)].filter((c) => c.length > 0);
}

/** 从 from 开始单调搜索候选首行对应的源文件行（0-based，精确匹配防误命中）。 */
function findLine(srcLines: string[], cands: string[], from: number): number {
  for (let i = Math.max(0, from); i < srcLines.length; i++) {
    const l = norm(srcLines[i]);
    if (!l) continue;
    for (const c of cands) {
      if (l === c) return i;
    }
  }
  return -1;
}

/** 逐块文本锚点映射：返回与 PM 顶层块一一对应的源文件起始行（0-based）。 */
export function computeBlockStartLines(
  src: string,
  doc: ProseNode,
  serialize: (n: ProseNode) => string,
): number[] {
  const srcLines = src.split("\n");
  const starts: number[] = [];
  let from = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const b = doc.child(i);
    const ser = serialize(doc.type.create(null, b)).replace(/\n$/, "");
    const cands = candidates(b, ser.split("\n")[0]);
    let f = findLine(srcLines, cands.slice(0, 1), from);
    if (f < 0) f = findLine(srcLines, cands.slice(1), from);
    if (f < 0) f = from; // 锚点缺失时沿用单调推进，避免错位放大
    starts.push(f);
    from = f + 1;
  }
  return starts;
}

/** 块在源文件中的行跨度：到空行为止；代码围栏到闭合围栏。 */
function spanOf(srcLines: string[], start: number): number {
  if (start < 0) return 1;
  const first = srcLines[start].trim();
  let end = start;
  if (/^(```|~~~)/.test(first)) {
    end = start + 1;
    while (end < srcLines.length && !/^(```|~~~)/.test(srcLines[end].trim())) end++;
    return Math.min(end, srcLines.length - 1) - start + 1;
  }
  while (end + 1 < srcLines.length && srcLines[end + 1].trim() !== "") end++;
  return end - start + 1;
}

export function captureFromMilkdown(editor: Editor | null) {
  if (!editor) return;
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serialize = ctx.get(serializerCtx);
      const doc = view.state.doc;
      const { $from } = view.state.selection;
      const blockIndex = $from.index(0);
      const block = doc.child(blockIndex);
      // 真实源文件（可能含多余空行/Setext 等与序列化不同的写法）
      const src = useWorkspace.getState().content;
      const lines = src.split("\n");
      const starts = scanSourceBlocks(src);
      let found: number;
      if (starts.length === doc.childCount) {
        found = starts[blockIndex];
      } else {
        let from = 0;
        found = -1;
        for (let k = 0; k <= blockIndex; k++) {
          const b = doc.child(k);
          const s = serialize(doc.type.create(null, b)).replace(/\n$/, "");
          const cands = candidates(b, s.split("\n")[0]);
          // 优先序列化首行（含标记，唯一性强），纯文本首行兜底
          let f = findLine(lines, cands.slice(0, 1), from);
          if (f < 0) f = findLine(lines, cands.slice(1), from);
          if (k === blockIndex) found = f;
          if (f >= 0) from = f + 1;
        }
      }
      // 块首行 + 块内比例偏移（块边界可靠后比例可提升行精度）
      const off = $from.pos - $from.before(1) - 1;
      const span = spanOf(lines, found);
      const ratio = Math.min(1, Math.max(0, off / Math.max(1, block.content.size)));
      const line = (found >= 0 ? found : 0) + Math.round(ratio * (span - 1)) + 1;
      anchor = { line, column: 0 };
    });
  } catch {
    anchor = null;
  }
}

export function captureFromCm(view: CmView | null) {
  if (!view) return;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  anchor = { line: line.number, column: head - line.from };
}

export function applyToCm(view: CmView) {
  if (!anchor) return;
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(1, anchor.line), doc.lines));
  const pos = line.from + Math.min(anchor.column, line.length);
  anchor = null;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
  view.focus();
}

export function applyToMilkdown(editor: Editor, src: string) {
  if (!anchor) return;
  const target = anchor;
  anchor = null;
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serialize = ctx.get(serializerCtx);
      const doc = view.state.doc;
      if (!doc.childCount) return;
      const srcLines = src.split("\n");
      const starts = scanSourceBlocks(src);
      let pick = 0;
      let pickFound = 0;
      let pickSpan = 1;
      if (starts.length === doc.childCount) {
        for (let k = 0; k < starts.length; k++) {
          if (starts[k] <= target.line - 1) pick = k;
          else break;
        }
        pickFound = starts[pick];
        pickSpan = (starts[pick + 1] ?? srcLines.length) - pickFound;
      } else {
        let from = 0;
        for (let i = 0; i < doc.childCount; i++) {
          const b = doc.child(i);
          const ser = serialize(doc.type.create(null, b)).replace(/\n$/, "");
          const cands = candidates(b, ser.split("\n")[0]);
          let found = findLine(srcLines, cands.slice(0, 1), from);
          if (found < 0) found = findLine(srcLines, cands.slice(1), from);
          if (found < 0) continue;
          from = found + 1;
          const span = spanOf(srcLines, found);
          if (target.line >= found + 1 && target.line <= found + span) {
            pick = i;
            pickFound = found;
            pickSpan = span;
            break;
          }
          if (found + 1 <= target.line) {
            pick = i;
            pickFound = found;
            pickSpan = span;
          }
        }
      }
      let pos = 0;
      for (let k = 0; k < pick; k++) pos += doc.child(k).nodeSize;
      const block = doc.child(pick);
      const ratio = Math.min(1, Math.max(0, (target.line - 1 - pickFound) / Math.max(1, pickSpan - 1)));
      const off = Math.round(ratio * block.content.size);
      const sel = TextSelection.near(doc.resolve(pos + 1 + off), 1);
      view.dispatch(view.state.tr.setSelection(sel));
      // 显式计算滚动容器偏移，布局完成后执行（rAF + 超时双保险）
      const doScroll = () => {
        const dom = view.nodeDOM(pos);
        // preventScroll：避免浏览器焦点滚动把容器重置回顶部
        view.dom.focus({ preventScroll: true });
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center" });
      };
      requestAnimationFrame(doScroll);
      setTimeout(doScroll, 60);
      // 图表等异步渲染会重排布局，延迟重试确保最终居中
      setTimeout(doScroll, 250);
      setTimeout(doScroll, 600);
    });
  } catch {
    /* 定位失败不阻塞视图切换 */
  }
}