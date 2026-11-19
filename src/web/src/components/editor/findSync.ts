/**
 * 文件内搜索（⌘/Ctrl+F）与替换（⌘/Ctrl+R）：双模式匹配高亮 + 导航 + 替换。
 * Milkdown 用 inline decoration（跨 inline 节点拆分区间），CM6 用 mark decoration；
 * 匹配区间随文档变化映射更新；导航（query/index/seq 变化）时选中并滚动到当前匹配。
 *
 * 滚动不依赖编辑器焦点（焦点保留在搜索框）：按 coords/行块位置 + 滚动容器手动定位；
 * 代码块/公式浏览态等隐藏 contentDOM 的节点视图回退为整块滚动。
 * 匹配以非文本节点为边界（虚拟换行），杜绝跨块命中与跨块替换。
 */
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView as PmEditorView } from "@milkdown/prose/view";
import { editorViewCtx } from "@milkdown/core";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration as CmDecoration, EditorView as CmEditorView, type DecorationSet as CmDecorationSet } from "@codemirror/view";
import { getMilkdown, getCm6 } from "./activeEditor";
import { useFind } from "@/stores/find";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";

export interface FindRange { from: number; to: number }
interface FindDecoState { ranges: FindRange[]; current: number }

export const findKey = new PluginKey<FindDecoState>("am-find");

export const findPlugin = $prose(
  () =>
    new Plugin({
      key: findKey,
      state: {
        init: (): FindDecoState => ({ ranges: [], current: -1 }),
        apply(tr, val): FindDecoState {
          const meta = tr.getMeta(findKey);
          if (meta) return meta;
          if (tr.docChanged && val.ranges.length) {
            return {
              ranges: val.ranges.map((r) => ({ from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) })).filter((r) => r.from < r.to),
              current: val.current,
            };
          }
          return val;
        },
      },
      props: {
        decorations(state) {
          const s = findKey.getState(state);
          if (!s || !s.ranges.length) return DecorationSet.empty;
          return DecorationSet.create(
            state.doc,
            s.ranges.map((r, i) =>
              Decoration.inline(r.from, r.to, { class: i === s.current ? "am-find-match am-find-match-current" : "am-find-match" }),
            ),
          );
        },
      },
    }),
);

export const findEffect = StateEffect.define<FindDecoState>();
export const findField = StateField.define<CmDecorationSet>({
  create: () => CmDecoration.none,
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(findEffect)) {
        const { ranges, current } = e.value;
        return ranges.length
          ? CmDecoration.set(ranges.map((r, i) => CmDecoration.mark({ class: i === current ? "am-find-match am-find-match-current" : "am-find-match" }).range(r.from, r.to)))
          : CmDecoration.none;
      }
    }
    return v.map(tr.changes);
  },
  provide: (f) => CmEditorView.decorations.from(f),
});

/** 全文匹配区间。Milkdown 在非文本节点处插入虚拟换行边界（查询不含换行 → 不会跨块命中）；CM6 直接偏移。 */
function computeRanges(): FindRange[] {
  const { query, caseSensitive } = useFind.getState();
  if (!query) return [];
  const q = caseSensitive ? query : query.toLowerCase();
  const ranges: FindRange[] = [];
  const md = getMilkdown();
  if (md) {
    md.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      const segs: { from: number; text: string }[] = [];
      doc.descendants((node, pos) => {
        if (node.isText) segs.push({ from: pos, text: node.text ?? "" });
        else segs.push({ from: -1, text: "\n" });
        return true;
      });
      const full = segs.map((s) => s.text).join("");
      const hay = caseSensitive ? full : full.toLowerCase();
      let i = hay.indexOf(q);
      while (i >= 0 && ranges.length < 2000) {
        const s = i;
        const e = i + q.length;
        let acc = 0;
        for (const seg of segs) {
          const segEnd = acc + seg.text.length;
          if (seg.from >= 0 && s < segEnd && e > acc) {
            ranges.push({ from: seg.from + Math.max(0, s - acc), to: seg.from + Math.min(seg.text.length, e - acc) });
          }
          acc = segEnd;
          if (acc >= e) break;
        }
        i = hay.indexOf(q, i + q.length);
      }
    });
    return ranges;
  }
  const cm = getCm6();
  if (cm) {
    const full = cm.state.doc.toString();
    const hay = caseSensitive ? full : full.toLowerCase();
    let i = hay.indexOf(q);
    while (i >= 0 && ranges.length < 2000) {
      ranges.push({ from: i, to: i + q.length });
      i = hay.indexOf(q, i + q.length);
    }
  }
  return ranges;
}

/* ── 滚动定位（不依赖编辑器焦点） ─────────────────────────────────────── */

/** 首个 overflow-y auto/scroll 祖先（Milkdown 的外层滚动容器）。 */
function findScroller(dom: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = dom;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

/** 目标区间（相对滚动容器顶部）不在安全视区内时平滑滚动居中。顶部留白避开搜索悬浮框。 */
function revealRelative(scroller: HTMLElement, relTop: number, relBottom: number) {
  const padTop = 72;
  const padBottom = 28;
  if (relTop >= scroller.scrollTop + padTop && relBottom <= scroller.scrollTop + scroller.clientHeight - padBottom) return;
  const target = relTop - (scroller.clientHeight - (relBottom - relTop)) / 2;
  scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
}

/** 在可见渲染文本中按字符偏移取精确视口坐标（代码块浏览态的高亮 pre）。 */
function rectAtTextOffset(root: Element, offset: number): { top: number; bottom: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = (n.textContent ?? "").length;
    if (acc + len > offset) {
      const local = offset - acc;
      const range = document.createRange();
      range.setStart(n, local);
      range.setEnd(n, Math.min(local + 1, len));
      const r = range.getBoundingClientRect();
      if (r.height > 0) return { top: r.top, bottom: r.bottom };
      return null;
    }
    acc += len;
  }
  return null;
}

/** Milkdown 匹配的视口坐标；隐藏 contentDOM（代码块/公式浏览态）coords 为零 → 回退块级定位。 */
function milkdownRangeRect(view: PmEditorView, r: FindRange): { top: number; bottom: number } | null {
  try {
    const c = view.coordsAtPos(r.from);
    if (c && (c.top !== 0 || c.bottom !== 0)) return { top: c.top, bottom: Math.max(c.bottom, c.top + 1) };
  } catch {
    /* 位置失效时走块级回退 */
  }
  try {
    const $pos = view.state.doc.resolve(r.from);
    const blockPos = $pos.depth > 0 ? $pos.before(1) : r.from;
    const block = view.state.doc.nodeAt(blockPos);
    const dom = view.nodeDOM(blockPos);
    if (dom instanceof HTMLElement) {
      // 代码块浏览态：在可见高亮区按字符偏移定位到具体行，而非整块居中
      if (block && block.type.name === "code_block" && !dom.classList.contains("am-codeblock-editing")) {
        const viewPre = dom.querySelector("pre.am-codeblock-view");
        if (viewPre) {
          const rect = rectAtTextOffset(viewPre, r.from - blockPos - 1);
          if (rect) return rect;
        }
      }
      const rect = dom.getBoundingClientRect();
      if (rect.height > 0) return { top: rect.top, bottom: rect.bottom };
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/* ── 浏览态代码块可见高亮 ───────────────────────────────────────────────
   代码块浏览态的 contentDOM 隐藏，PM 装饰不可见；把匹配按字符偏移
   包进可见高亮区（pre.am-codeblock-view）的文本节点，跨 hljs span 拆分包裹。 */

function unwrapFindMarks(root: Element) {
  root.querySelectorAll("span.am-find-match").forEach((sp) => {
    const parent = sp.parentNode;
    if (!parent) return;
    while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
    parent.removeChild(sp);
  });
  root.normalize();
}

function wrapFindRange(root: Element, s: number, e: number, cls: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: { node: Text; ls: number; le: number }[] = [];
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const len = t.data.length;
    if (acc < e && acc + len > s) parts.push({ node: t, ls: Math.max(0, s - acc), le: Math.min(len, e - acc) });
    acc += len;
    if (acc >= e) break;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const { node, ls, le } = parts[i];
    let mid = node;
    if (ls > 0) mid = node.splitText(ls);
    if (le - ls < mid.data.length) mid.splitText(le - ls);
    const span = document.createElement("span");
    span.className = cls;
    mid.parentNode?.insertBefore(span, mid);
    span.appendChild(mid);
  }
}

/** 重画所有浏览态代码块内的搜索高亮；编辑中的代码块交给 PM 装饰。 */
export function paintCodeFind() {
  const md = getMilkdown();
  if (!md) return;
  const { open, query } = useFind.getState();
  const ranges = open && query ? lastRanges : [];
  const current = lastCurrent;
  md.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== "code_block") return true;
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return true;
      const code = dom.querySelector("pre.am-codeblock-view code");
      if (!code) return true;
      unwrapFindMarks(code);
      if (dom.classList.contains("am-codeblock-editing")) return true;
      const start = pos + 1;
      const end = start + node.content.size;
      ranges.forEach((r, i) => {
        if (r.from >= start && r.to <= end) {
          wrapFindRange(code, r.from - start, r.to - start, i === current ? "am-find-match am-find-match-current" : "am-find-match");
        }
      });
      return true;
    });
  });
}

/* ── 刷新与导航 ───────────────────────────────────────────────────────── */

let lastNavKey = "";
let lastRanges: FindRange[] = [];
let lastDocRef: unknown = null;
let lastMode = "";
let lastOpen = false;
let lastQuery = "";
let lastCase = false;
let lastCurrent = -2;
let replacing = false;

function resetFindCache() {
  lastNavKey = "";
  lastRanges = [];
  lastDocRef = null;
  lastMode = "";
  lastOpen = false;
  lastQuery = "";
  lastCase = false;
  lastCurrent = -2;
}

export function refreshFind() {
  if (replacing) return;
  const { open, query, caseSensitive, index, seq } = useFind.getState();
  const md = getMilkdown();
  const cm = getCm6();
  if (!md && !cm) return;
  // 以编辑器实际 doc 为缓存键：外部 setContent 时编辑器文档异步同步，
  // 若按 store.content 缓存会在旧文档上算出空区间并永久缓存。
  let docRef: unknown = null;
  if (md) md.action((ctx) => { docRef = ctx.get(editorViewCtx).state.doc; });
  else if (cm) docRef = cm.state.doc;
  const mode = useUi.getState().editorMode;
  const recompute =
    docRef !== lastDocRef || mode !== lastMode || open !== lastOpen || query !== lastQuery || caseSensitive !== lastCase;
  if (recompute) {
    lastRanges = open && query ? computeRanges() : [];
    lastDocRef = docRef;
    lastMode = mode;
    lastOpen = open;
    lastQuery = query;
    lastCase = caseSensitive;
  }
  const ranges = lastRanges;
  const current = ranges.length ? Math.min(index, ranges.length - 1) : -1;
  const navKey = `${open}|${query}|${caseSensitive}|${current}|${seq}`;
  const navigate = navKey !== lastNavKey;
  lastNavKey = navKey;
  const st = useFind.getState();
  if (st.count !== ranges.length || (ranges.length && st.index !== current)) {
    useFind.getState().setMatches(ranges.length, current < 0 ? 0 : current);
  }
  if (!recompute && current === lastCurrent && !navigate) return;
  lastCurrent = current;
  const target = navigate && current >= 0 ? ranges[current] : null;
  if (md) {
    md.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let tr = view.state.tr.setMeta(findKey, { ranges, current });
      if (target) {
        try {
          tr = tr.setSelection(TextSelection.create(view.state.doc, target.from, target.to));
        } catch {
          /* 映射后的区间可能落在非文本位置：仅高亮，不选中 */
        }
      }
      view.dispatch(tr);
      if (target) {
        const rect = milkdownRangeRect(view, target);
        const scroller = rect ? findScroller(view.dom) : null;
        if (rect && scroller) {
          const sRect = scroller.getBoundingClientRect();
          revealRelative(scroller, rect.top - sRect.top + scroller.scrollTop, rect.bottom - sRect.top + scroller.scrollTop);
        }
      }
    });
    paintCodeFind();
  } else if (cm) {
    const effects: any[] = [findEffect.of({ ranges, current })];
    cm.dispatch({ effects, ...(target ? { selection: { anchor: target.from, head: target.to } } : {}) });
    if (target) {
      const line = cm.lineBlockAt(target.from);
      revealRelative(cm.scrollDOM, line.top, line.bottom);
    }
  }
}

/* ── 替换 ─────────────────────────────────────────────────────────────── */

/** 替换当前匹配，并跳到替换位置之后的下一个匹配（末尾则回绕到首个）。 */
export function replaceCurrent() {
  const { query, replaceText, index, count } = useFind.getState();
  if (!query || !count || useUi.getState().readonlyMode) return;
  const md = getMilkdown();
  const cm = getCm6();
  if (!md && !cm) return;
  const ranges = computeRanges();
  if (!ranges.length) return;
  const r = ranges[Math.min(index, ranges.length - 1)];
  replacing = true;
  try {
    if (md) {
      md.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText(replaceText, r.from, r.to));
      });
    } else if (cm) {
      cm.dispatch({ changes: { from: r.from, to: r.to, insert: replaceText } });
    }
    const after = computeRanges();
    const cutoff = r.from + replaceText.length;
    let ni = after.findIndex((x) => x.from >= cutoff);
    if (ni < 0) ni = 0;
    useFind.getState().setMatches(after.length, ni);
  } finally {
    replacing = false;
  }
  resetFindCache();
  refreshFind();
}

/** 全部替换：单事务提交，可一次撤销。 */
export function replaceAll() {
  const { query, replaceText } = useFind.getState();
  if (!query || useUi.getState().readonlyMode) return;
  const md = getMilkdown();
  const cm = getCm6();
  if (!md && !cm) return;
  const ranges = computeRanges();
  if (!ranges.length) return;
  const n = ranges.length;
  replacing = true;
  try {
    if (md) {
      md.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        let tr = view.state.tr;
        for (const r of ranges) tr = tr.insertText(replaceText, r.from, r.to);
        view.dispatch(tr);
      });
    } else if (cm) {
      cm.dispatch({ changes: ranges.map((r) => ({ from: r.from, to: r.to, insert: replaceText })) });
    }
    useUi.getState().toast(`已替换 ${n} 处`, "success");
  } finally {
    replacing = false;
  }
  resetFindCache();
  refreshFind();
}

/** App 挂载一次：订阅 find/workspace/ui 变化刷新匹配与导航。 */
export function installFindSync(): () => void {
  const un1 = useFind.subscribe(refreshFind);
  const un2 = useWorkspace.subscribe(refreshFind);
  const un3 = useUi.subscribe(refreshFind);
  refreshFind();
  return () => {
    un1();
    un2();
    un3();
  };
}
