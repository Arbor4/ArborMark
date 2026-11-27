/**
 * 代码块 node view：语言标签 + 复制按钮 + highlight.js 高亮（浏览态），
 * 点击进入原位编辑（contentDOM），编辑期间由 codeHighlightPlugin 以
 * ProseMirror 内联装饰实时着色，失焦回到浏览态高亮。
 * 复用 commonmark code_block schema（content text*，attrs.language）。
 */
import { $view, $prose } from "@milkdown/utils";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { editorViewCtx } from "@milkdown/core";
import { paintCodeFind } from "../findSync";
import { TextSelection, NodeSelection, Plugin, PluginKey, type Transaction } from "@milkdown/prose/state";
import { liftListItem } from "@milkdown/prose/schema-list";
import { Decoration } from "@milkdown/prose/view";
import { DecorationSet } from "prosemirror-view";
import hljs from "highlight.js/lib/common";
import type { Node as ProseNode, NodeType } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCode(code: string, lang: string): string {
  const l = (lang || "").toLowerCase();
  if (l && l !== "text" && l !== "plaintext" && hljs.getLanguage(l)) {
    try {
      return hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
    } catch {
      /* fall through */
    }
  }
  return escapeHtml(code);
}

/* ── 编辑态实时高亮：hljs token → ProseMirror 内联装饰 ───────────────────── */

type TokenRange = { from: number; to: number; cls: string };

const tokenCache = new Map<string, TokenRange[]>();
const TOKEN_CACHE_LIMIT = 256;

/** 把 hljs 输出的 HTML 解析为 (相对偏移, 类名) 区间；嵌套 span 的类名沿路径合并。 */
function extractTokenRanges(html: string, expectedLength: number): TokenRange[] {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const ranges: TokenRange[] = [];
  let offset = 0;
  const walk = (parent: Node, classes: string[]) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const len = (child.textContent ?? "").length;
        if (len > 0 && classes.length > 0) {
          ranges.push({ from: offset, to: offset + len, cls: classes.join(" ") });
        }
        offset += len;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const own = Array.from((child as Element).classList);
        walk(child, own.length ? classes.concat(own) : classes);
      }
    });
  };
  walk(tpl.content, []);
  // 文本总长必须与源码一致，否则位置会错位，宁可不高亮
  return offset === expectedLength ? ranges : [];
}

function tokenize(code: string, lang: string): TokenRange[] {
  const l = (lang || "").toLowerCase();
  if (!l || l === "text" || l === "plaintext" || !hljs.getLanguage(l)) return [];
  const key = `${l}\u0000${code}`;
  const hit = tokenCache.get(key);
  if (hit) return hit;
  let ranges: TokenRange[] = [];
  try {
    const html = hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
    ranges = extractTokenRanges(html, code.length);
  } catch {
    ranges = [];
  }
  if (tokenCache.size >= TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(key, ranges);
  return ranges;
}

function buildCodeDecorations(doc: ProseNode, type: NodeType): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== type || !node.textContent) return;
    const ranges = tokenize(node.textContent, (node.attrs.language as string) || "");
    const start = pos + 1;
    for (const r of ranges) {
      decos.push(Decoration.inline(start + r.from, start + r.to, { class: r.cls }));
    }
  });
  return DecorationSet.create(doc, decos);
}

const codeHighlightKey = new PluginKey("am-code-highlight");

/** 编辑态代码块实时着色：文档变化时重建装饰，未变更代码块命中缓存。 */
export const codeHighlightPlugin = $prose((ctx) => {
  const type = codeBlockSchema.type(ctx);
  return new Plugin({
    key: codeHighlightKey,
    state: {
      init: (_config, state) => buildCodeDecorations(state.doc, type),
      apply: (tr, prev) => (tr.docChanged ? buildCodeDecorations(tr.doc, type) : prev),
    },
    props: {
      decorations: (state) => codeHighlightKey.getState(state) ?? null,
    },
  });
});

export const codeBlockNodeView = $view(codeBlockSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node: ProseNode = initialNode;
  let editing = false;
  let destroyed = false;

  const dom = document.createElement("div");
  dom.className = "am-codeblock";
  dom.contentEditable = "false";
  dom.setAttribute("data-testid", "codeblock");

  const header = document.createElement("div");
  header.className = "am-codeblock-header";
  header.contentEditable = "false";
  const langBadge = document.createElement("span");
  langBadge.className = "am-codeblock-lang";
  const copyBtn = document.createElement("button");
  copyBtn.className = "am-codeblock-copy";
  copyBtn.type = "button";
  copyBtn.textContent = "复制";
  header.append(langBadge, copyBtn);

  const body = document.createElement("div");
  body.className = "am-codeblock-body";
  const gutter = document.createElement("div");
  gutter.className = "am-codeblock-gutter";
  gutter.contentEditable = "false";
  gutter.setAttribute("aria-hidden", "true");
  const viewArea = document.createElement("pre");
  viewArea.className = "am-codeblock-view hljs";
  viewArea.contentEditable = "false";
  const viewCode = document.createElement("code");
  viewArea.appendChild(viewCode);
  const editPre = document.createElement("pre");
  editPre.className = "am-codeblock-edit";
  editPre.style.display = "none";
  const contentDOM = document.createElement("code");
  contentDOM.className = "hljs";
  contentDOM.contentEditable = "true";
  editPre.appendChild(contentDOM);
  body.append(gutter, viewArea, editPre);
  dom.append(header, body);

  const posOf = () => (typeof getPos === "function" ? getPos() : undefined);

  const syncGutter = () => {
    const count = Math.max(1, node.textContent.split("\n").length);
    let html = "";
    for (let i = 1; i <= count; i++) html += `<span>${i}</span>`;
    gutter.innerHTML = html;
  };

  const renderView = () => {
    const lang = (node.attrs.language as string) || "";
    langBadge.textContent = lang || "text";
    const code = node.textContent;
    // 浏览态 pre 不为末尾换行生成空行行盒，而编辑态 ProseMirror 会（trailing break），
    // 补零宽空格保住空末行/空块，避免失焦回到浏览态时高度跳变。
    const html = highlightCode(code, lang);
    viewCode.innerHTML = code === "" || code.endsWith("\n") ? html + "\u200B" : html;
    syncGutter();
    paintCodeFind();
  };

  /* ── 语言标签点击编辑：回写围栏信息（```lang）并即时重高亮 ──
     自绘下拉（原生 datalist 在嵌套滚动容器下定位偏移）：fixed 跟随输入框、
     视口不足时向上翻转、键盘导航、主题化样式。 */
  const LANGS = ["typescript", "javascript", "python", "java", "go", "rust", "c", "cpp", "csharp", "html", "css", "json", "bash", "shell", "sql", "markdown", "yaml", "xml", "php", "ruby", "swift", "kotlin", "diff", "dockerfile", "makefile", "ini", "toml", "lua", "perl", "r", "scala", "powershell", "graphql", "protobuf", "latex", "vim", "plaintext"];
  let langInput: HTMLInputElement | null = null;
  let dropdown: HTMLDivElement | null = null;
  let options: string[] = [];
  let active = -1;

  const closeDropdown = () => {
    if (dropdown) dropdown.remove();
    dropdown = null;
    options = [];
    active = -1;
  };
  const positionDropdown = () => {
    if (!dropdown || !langInput) return;
    const r = langInput.getBoundingClientRect();
    const belowSpace = window.innerHeight - r.bottom - 8;
    const aboveSpace = r.top - 8;
    const placeBelow = belowSpace >= aboveSpace;
    const space = Math.max(96, placeBelow ? belowSpace : aboveSpace);
    dropdown.style.maxHeight = `${Math.min(240, space)}px`;
    const h = dropdown.offsetHeight;
    const top = placeBelow ? r.bottom + 4 : Math.max(8, r.top - h - 4);
    dropdown.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - dropdown.offsetWidth - 8))}px`;
    dropdown.style.top = `${top}px`;
  };
  const renderOptions = () => {
    if (!dropdown || !langInput) return;
    const q = langInput.value.trim().toLowerCase();
    options = q ? LANGS.filter((l) => l.includes(q)) : LANGS;
    if (active >= options.length) active = options.length - 1;
    dropdown.innerHTML = "";
    options.forEach((l, i) => {
      const item = document.createElement("div");
      item.className = `am-lang-option${i === active ? " active" : ""}`;
      item.textContent = l;
      item.addEventListener("mousedown", (ev) => ev.preventDefault());
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (langInput) langInput.value = l;
        commitLang(true);
      });
      item.addEventListener("mouseenter", () => {
        active = i;
        dropdown?.querySelectorAll(".am-lang-option").forEach((el, k) => el.classList.toggle("active", k === i));
      });
      dropdown!.appendChild(item);
    });
    positionDropdown();
  };
  const openDropdown = () => {
    if (dropdown || !langInput) return;
    dropdown = document.createElement("div");
    dropdown.className = "am-lang-dropdown";
    dropdown.setAttribute("role", "listbox");
    document.body.appendChild(dropdown);
    active = -1;
    renderOptions();
  };
  const commitLang = (commit: boolean) => {
    if (!langInput) return;
    const value = langInput.value.trim();
    const input = langInput;
    langInput = null;
    closeDropdown();
    header.replaceChild(langBadge, input);
    if (commit) {
      const pos = posOf();
      if (pos != null && value !== ((node.attrs.language as string) || "")) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: value }));
      }
    }
    renderView();
    view.focus();
  };
  langBadge.title = "点击编辑语言";
  langBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    if (langInput) return;
    langInput = document.createElement("input");
    langInput.className = "am-codeblock-lang-input";
    langInput.value = (node.attrs.language as string) || "";
    langInput.placeholder = "language";
    langInput.spellcheck = false;
    langInput.setAttribute("aria-label", "代码块语言");
    langInput.setAttribute("role", "combobox");
    langInput.setAttribute("aria-expanded", "true");
    header.replaceChild(langInput, langBadge);
    langInput.focus();
    langInput.select();
    openDropdown();
    langInput.addEventListener("input", () => {
      active = -1;
      if (!dropdown) openDropdown();
      else renderOptions();
    });
    langInput.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!dropdown) openDropdown();
        if (!options.length) return;
        active = ev.key === "ArrowDown" ? (active + 1) % options.length : (active - 1 + options.length) % options.length;
        renderOptions();
        dropdown?.querySelectorAll(".am-lang-option")[active]?.scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") {
        if (dropdown && active >= 0 && options[active]) langInput!.value = options[active];
        commitLang(true);
      } else if (ev.key === "Escape") {
        if (dropdown) closeDropdown();
        else commitLang(false);
      } else if (ev.key === "Tab") {
        closeDropdown();
      }
    });
    langInput.addEventListener("blur", () => commitLang(true));
  });
  const reposition = () => positionDropdown();
  document.addEventListener("scroll", reposition, true);

  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  /** 按点击坐标推算目标代码行与字符位置（适配非首行及行尾空白点击）。 */
  const resolveCodeClickPos = (code: string, blockStart: number, e: MouseEvent): number => {
    const lines = code.split("\n");
    const contentRect = contentDOM.getBoundingClientRect();
    const parsedLh = parseFloat(getComputedStyle(contentDOM).lineHeight);
    const lineHeight = Number.isFinite(parsedLh) && parsedLh > 0
      ? parsedLh
      : contentRect.height / Math.max(lines.length, 1);
    const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor((e.clientY - contentRect.top) / lineHeight)));

    let lineOffset = 0;
    for (let i = 0; i < lineIdx; i++) lineOffset += lines[i].length + 1;
    const lineStart = blockStart + lineOffset;
    const lineEnd = lineStart + lines[lineIdx].length;

    if (lines[lineIdx].length === 0 || e.clientX <= contentRect.left) return lineStart;
    if (e.clientX >= view.coordsAtPos(lineEnd).left - 2) return lineEnd;

    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (hit && hit.pos >= lineStart && hit.pos <= lineEnd) {
      if (hit.pos > lineStart || e.clientX <= view.coordsAtPos(lineStart).left + 6) {
        return hit.pos;
      }
    }

    let lo = lineStart;
    let hi = lineEnd;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const midX = (view.coordsAtPos(mid).left + view.coordsAtPos(mid + 1).left) / 2;
      if (e.clientX < midX) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const activateEditUI = () => {
    const prevScrollLeft = viewArea.scrollLeft;
    const prevScrollTop = viewArea.scrollTop;
    dom.classList.add("am-codeblock-editing");
    viewArea.style.display = "none";
    editPre.style.display = "block";
    editPre.scrollLeft = prevScrollLeft;
    editPre.scrollTop = prevScrollTop;
    paintCodeFind();
    if (!outsideHandler) {
      // ProseMirror 焦点始终在根 contenteditable，focusout 不可靠；用文档级外部点击退出。
      outsideHandler = (ev: MouseEvent) => {
        if (!dom.contains(ev.target as Node)) exitEdit();
      };
      document.addEventListener("mousedown", outsideHandler, true);
    }
    editing = true;
  };

  const enterEdit = (e?: MouseEvent) => {
    if (e && e.button !== 0) return;
    if (editing) return;
    activateEditUI();
    const pos = posOf();
    if (pos != null) {
      const targetPos = e ? resolveCodeClickPos(node.textContent, pos + 1, e) : pos + 1;
      const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(targetPos)));
      view.dispatch(tr);
    }
    view.focus();
  };

  const exitEdit = () => {
    if (!editing) return;
    editing = false;
    if (outsideHandler) {
      document.removeEventListener("mousedown", outsideHandler, true);
      outsideHandler = null;
    }
    dom.classList.remove("am-codeblock-editing");
    editPre.style.display = "none";
    viewArea.style.display = "block";
    renderView();
  };

  const selectionInsideThisNode = (target: ProseNode) => {
    const { $from, $to, from, to } = view.state.selection;
    try {
      const p = posOf();
      if (p != null) return from > p && to < p + target.nodeSize;
    } catch {
      /* NodeView 首次构造尚未挂载到父节点时，回退节点引用判定 */
    }
    return $from.parent === target && $to.parent === target;
  };

  viewArea.addEventListener("click", (e) => enterEdit(e));
  dom.addEventListener("am-codeblock-enter", () => {
    if (editing) return;
    activateEditUI();
    queueMicrotask(() => {
      if (destroyed || !editing) return;
      const anchor = document.getSelection()?.anchorNode ?? null;
      if (!anchor || !contentDOM.contains(anchor)) {
        const sel = view.state.selection;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.from, sel.to)).setMeta("addToHistory", false));
        view.focus();
      }
    });
  });
  // 选区离开代码块（键盘跳出 / 点击空白）时自动退出编辑态
  const syncEditBySelection = () => {
    if (!editing) return;
    const anchor = document.getSelection()?.anchorNode ?? null;
    if (!anchor || !contentDOM.contains(anchor)) exitEdit();
  };
  document.addEventListener("selectionchange", syncEditBySelection);
  dom.addEventListener("keydown", (e) => {
    // Esc 先退出代码编辑，不冒泡到全局（否则会连带关闭搜索框）
    if (e.key === "Escape" && editing) {
      e.stopPropagation();
      exitEdit();
      view.focus();
    }
  });
  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(node.textContent);
      copyBtn.textContent = "已复制";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "复制";
        copyBtn.classList.remove("copied");
      }, 1500);
    } catch {
      copyBtn.textContent = "失败";
      setTimeout(() => (copyBtn.textContent = "复制"), 1500);
    }
  });

  renderView();
  if (selectionInsideThisNode(node)) {
    activateEditUI();
  }

  return {
    dom,
    contentDOM,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      if (!editing && selectionInsideThisNode(newNode)) activateEditUI();
      if (!editing) renderView();
      else {
        langBadge.textContent = (node.attrs.language as string) || "text";
        syncGutter();
      }
      return true;
    },
    stopEvent(event: Event) {
      // contentDOM 内的事件交给 ProseMirror；头部/浏览态由本视图处理
      return !contentDOM.contains(event.target as Node);
    },
    ignoreMutation(mutation: { target: Node }) {
      return !contentDOM.contains(mutation.target);
    },
    destroy() {
      destroyed = true;
      closeDropdown();
      document.removeEventListener("scroll", reposition, true);
      document.removeEventListener("selectionchange", syncEditBySelection);
      if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
    },
  };
});

export function getCodeBlockView(ctx: { get: (k: typeof editorViewCtx) => EditorView }) {
  return ctx.get(editorViewCtx);
}

/** 视为「整块」的节点：代码块 / 表格 / 图表 / 公式块 / HTML 块等，删除时整块移除。 */
function isWholeBlock(n: ProseNode): boolean {
  return (
    ["code_block", "table", "diagram", "math_block", "html_block", "html_details"].includes(n.type.name) ||
    (!n.isTextblock && n.type.name !== "paragraph")
  );
}

/**
 * 代码块逃逸与删除：
 * - 末行↓ / 首行↑ 跳出到相邻块（无则补 paragraph）；
 * - 空代码块按 Backspace/Delete 直接删除；非空代码块行首 Backspace 解包为 paragraph（保留文本）；
 *   NodeSelection 选中整块、文本块行首/行尾紧邻整块时，删除键整块移除；
 *   首行空行 Backspace / 末尾空行 Delete 删除空行本身（唯一段落保留）；
 * - 点击块旁空白（表格右侧 / 块间 / 末尾下方）光标落到下一行行首（无则补空行），
 *   行首 Backspace 即整块移除；不在块边缘绘制光标，也不跳往文末。
 */

/** 表格取内层 table 的 rect（外层 wrapper 全宽，右侧空白落在 wrapper 内）。 */
function blockRect(dom: HTMLElement, node: ProseNode): DOMRect {
  if (node.type.name === "table") {
    const t = dom.querySelector("table");
    if (t) return t.getBoundingClientRect();
  }
  return dom.getBoundingClientRect();
}

/** 空白点击：光标落到最近块之后一行的行首（无下一行时就地补空行，复用已有空行）；
    普通段落旁空白落到段尾/段首。不在块边缘绘制光标。 */
export function placeBlockCaret(view: EditorView, x: number, y: number): boolean {
  const doc = view.state.doc;
  const caretAt = (pos: number, bias: 1 | -1) => {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos), bias)).scrollIntoView());
    view.focus();
  };
  const selectBlock = (pos: number) => {
    const node = doc.nodeAt(pos);
    if (!node || node.isText || node.isInline) return false;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, pos)).scrollIntoView());
    view.focus();
    return true;
  };
  const afterBlock = (end: number) => {
    const next = doc.resolve(end).nodeAfter;
    if (next && next.isTextblock) {
      caretAt(end, 1);
      return;
    }
    // 右侧/下方已是另一个整块：选中它，而不是在两块的缝隙里插一行
    if (next && selectBlock(end)) return;
    const tr = view.state.tr.insert(end, view.state.schema.nodes.paragraph.create());
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1), 1)).scrollIntoView());
    view.focus();
  };
  const beforeBlock = (start: number) => {
    const prev = start > 0 ? doc.resolve(start).nodeBefore : null;
    if (prev && prev.isTextblock) {
      caretAt(start, -1);
      return;
    }
    // 上方已是另一个整块：选中它，避免在两块之间多出空行
    if (prev && selectBlock(start - prev.nodeSize)) return;
    const tr = view.state.tr.insert(start, view.state.schema.nodes.paragraph.create());
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1), 1)).scrollIntoView());
    view.focus();
  };
  let pos = 0;
  let last: { start: number; end: number } | null = null;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    const start = pos;
    const end = pos + child.nodeSize;
    pos = end;
    if (!dom) continue;
    last = { start, end };
    const r = blockRect(dom, child);
    if (y < r.top) {
      if (isWholeBlock(child)) beforeBlock(start);
      else caretAt(start, 1);
      return true;
    }
    if (y <= r.bottom) {
      const right = x > r.right + 2;
      const left = x < r.left - 2;
      if (!right && !left) return false;
      if (isWholeBlock(child)) {
        if (right) afterBlock(end);
        else beforeBlock(start);
      } else {
        caretAt(right ? end : start, right ? -1 : 1);
      }
      return true;
    }
  }
  if (last) afterBlock(last.end);
  else caretAt(doc.content.size, 1);
  return true;
}

export const codeBlockEscapePlugin = $prose(
  () =>
    new Plugin({
      view: () => ({
        update: (editorView) => {
          const sel = editorView.state.selection;
          if (!(sel instanceof TextSelection)) return;
          const { $from, $to } = sel;
          if (!$from.sameParent($to) || $from.parent.type.name !== "code_block") return;
          const cbDom = editorView.nodeDOM($from.before($from.depth));
          if (cbDom instanceof HTMLElement && !cbDom.classList.contains("am-codeblock-editing")) {
            cbDom.dispatchEvent(new CustomEvent("am-codeblock-enter"));
          }
        },
      }),
      props: {
        handleKeyDown: (view, event) => {
          const key = event.key;
          const sel = view.state.selection;
          const doc = view.state.doc;
          const para = () => view.state.schema.nodes.paragraph.create();

          const isDelete = key === "Backspace" || key === "Delete";
          const isArrow = key === "ArrowDown" || key === "ArrowUp";
          if (!isDelete && !isArrow) return false;
          if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;

          if (isDelete && sel instanceof NodeSelection && isWholeBlock(sel.node)) {
            const tr = view.state.tr.deleteSelection();
            if (tr.doc.content.size === 0) tr.insert(0, para());
            // 光标留在删除处（而非跳回文档顶部）
            const at = Math.min(sel.from, tr.doc.content.size);
            view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at), 1)).scrollIntoView());
            return true;
          }

          if (!sel.empty) return false;
          const $from = sel.$from;
          // 空列表项行首 Backspace：嵌套→提升一级；顶层独子→整行删除；
          // 顶层空壳带子列表→提升并去掉空壳，保留子任务。
          if (key === "Backspace" && $from.parent.isTextblock && $from.parentOffset === 0 && $from.parent.content.size === 0) {
            let itemDepth = -1;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "list_item") { itemDepth = d; break; }
            }
            if (itemDepth > 0) {
              const item = $from.node(itemDepth);
              const list = $from.node(itemDepth - 1);
              const nested = itemDepth - 2 >= 0 && $from.node(itemDepth - 2).type.name === "list_item";
              const itemType = view.state.schema.nodes.list_item;
              if (nested) {
                return liftListItem(itemType)(view.state, view.dispatch, view);
              }
              const itemPos = $from.before(itemDepth);
              if (item.childCount === 1) {
                const listPos = $from.before(itemDepth - 1);
                const tr = view.state.tr.delete(itemPos, itemPos + item.nodeSize);
                const rest = tr.doc.nodeAt(listPos);
                if (rest && rest.type === list.type && rest.childCount === 0) tr.delete(listPos, listPos + rest.nodeSize);
                if (tr.doc.content.size === 0) tr.insert(0, para());
                view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(itemPos, tr.doc.content.size)), 1)).scrollIntoView());
                return true;
              }
              let lifted: Transaction | null = null;
              const ok = liftListItem(itemType)(view.state, (t) => { lifted = t; }, view);
              const base = lifted as Transaction | null;
              if (ok && base) {
                let tr: Transaction = base;
                const $p = tr.selection.$from;
                let caret = tr.selection.from;
                if ($p.parent.isTextblock && $p.parent.content.size === 0 && $p.depth >= 1 && $p.node($p.depth - 1).type.name !== "list_item") {
                  const pos = $p.before($p.depth);
                  tr = tr.delete(pos, pos + $p.parent.nodeSize);
                  caret = pos;
                }
                if (tr.doc.content.size === 0) tr.insert(0, para());
                view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size)), 1)).scrollIntoView());
                return true;
              }
              return false;
            }
          }
          /* 空表格：首格行首 Backspace / 末格行尾 Delete → 删除整个表格。
             位置沿 table→row→cell→paragraph 首/末子链推算，非空表格不触发。 */
          if (isDelete && $from.parent.isTextblock) {
            let td = -1;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "table") { td = d; break; }
            }
            if (td > 0) {
              const table = $from.node(td);
              const firstPara = table.firstChild?.firstChild?.firstChild;
              const lastPara = table.lastChild?.lastChild?.lastChild;
              if (table.textContent.trim() === "" && firstPara && lastPara) {
                const tablePos = $from.before(td);
                const firstText = tablePos + 4;
                const lastText = tablePos + table.nodeSize - 4;
                if ((key === "Backspace" && $from.pos === firstText) || (key === "Delete" && $from.pos === lastText)) {
                  const tr = view.state.tr.delete(tablePos, tablePos + table.nodeSize);
                  if (tr.doc.content.size === 0) tr.insert(0, para());
                  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tablePos, tr.doc.content.size)), 1)).scrollIntoView());
                  return true;
                }
              }
            }
          }
          /* 普通文本块（段落/标题等）光标删除语义：
             - 行首 Backspace：前邻整块 → 删整块；首行空行 → 删除空行本身；
             - 行尾 Delete：后邻整块 → 删整块；末尾空行 → 删除空行本身；
             - 其余交给 ProseMirror 默认合并/删字符。 */
          if (isDelete && $from.parent.isTextblock && !isWholeBlock($from.parent) && $from.depth >= 1) {
            const parent = $from.node($from.depth - 1);
            const idx = $from.index($from.depth - 1);
            const isEmpty = $from.parent.content.size === 0;
            const atStart = $from.parentOffset === 0;
            const atEnd = $from.parentOffset === $from.parent.content.size;
            const prev = idx > 0 ? parent.child(idx - 1) : null;
            const next = idx < parent.childCount - 1 ? parent.child(idx + 1) : null;
            const blockStart = $from.before($from.depth);
            const removeRange = (from: number, to: number, bias: 1 | -1) => {
              const tr = view.state.tr.delete(from, to);
              if (tr.doc.content.size === 0) tr.insert(0, para());
              view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), bias)).scrollIntoView());
            };
            if (key === "Backspace" && atStart) {
              // 夹在两个块之间的空行视为「多出的行」：优先删除空行本身，而非上面的整块
              if (isEmpty && prev && isWholeBlock(prev) && next) {
                removeRange(blockStart, blockStart + $from.parent.nodeSize, 1);
                return true;
              }
              if (prev && isWholeBlock(prev)) {
                removeRange(blockStart - prev.nodeSize, blockStart, 1);
                return true;
              }
              if (!prev && isEmpty && parent.childCount > 1 && $from.depth === 1) {
                removeRange(blockStart, blockStart + $from.parent.nodeSize, 1);
                return true;
              }
            }
            if (key === "Delete" && atEnd) {
              if (next && isWholeBlock(next)) {
                removeRange(blockStart + $from.parent.nodeSize, blockStart + $from.parent.nodeSize + next.nodeSize, 1);
                return true;
              }
              if (!next && isEmpty && parent.childCount > 1 && $from.depth === 1) {
                removeRange(blockStart, blockStart + $from.parent.nodeSize, -1);
                return true;
              }
            }
          }
          let depth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === "code_block") { depth = d; break; }
          }
          if (depth < 0) return false;
          const cbPos = $from.before(depth);
          const cb = $from.node(depth);
          const text = cb.textContent;
          const offset = $from.parentOffset;

          if (isDelete) {
            const isEmpty = text.trim() === "";
            const atStart = offset === 0;
            if (isEmpty || (key === "Backspace" && atStart)) {
              const tr = view.state.tr;
              if (isEmpty) {
                tr.replaceWith(cbPos, cbPos + cb.nodeSize, para());
              } else {
                const nodes = text.split("\n").map((l) =>
                  view.state.schema.nodes.paragraph.create(null, l ? view.state.schema.text(l) : undefined),
                );
                tr.replaceWith(cbPos, cbPos + cb.nodeSize, nodes);
              }
              view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(cbPos + 1), 1)).scrollIntoView());
              return true;
            }
            return false;
          }

          if (key === "ArrowDown") {
            const lastLineStart = text.lastIndexOf("\n") + 1;
            if (offset < lastLineStart) return false;
            const after = cbPos + cb.nodeSize;
            if (after < doc.content.size) {
              view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(after), 1)).scrollIntoView());
            } else {
              const tr = view.state.tr.insert(after, para());
              view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1)).scrollIntoView());
            }
            return true;
          }
          const firstLineEnd = text.indexOf("\n");
          const onFirstLine = firstLineEnd === -1 || offset <= firstLineEnd;
          if (!onFirstLine) return false;
          if (cbPos === 0) {
            const tr = view.state.tr.insert(0, para());
            view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(1), 1)).scrollIntoView());
          } else {
            view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(cbPos), -1)).scrollIntoView());
          }
          return true;
        },
        handleClick: (view, pos, event) => {
          if (pos == null) return placeBlockCaret(view, event.clientX, event.clientY);
          const $pos = view.state.doc.resolve(pos);
          const block = $pos.depth >= 1 ? $pos.node(1) : ($pos.nodeAfter ?? $pos.nodeBefore);
          if (block && isWholeBlock(block)) {
            const blockPos = $pos.depth >= 1 ? $pos.before(1) : $pos.nodeAfter ? pos : pos - block.nodeSize;
            const dom = view.nodeDOM(blockPos) as HTMLElement | null;
            if (dom) {
              const r = blockRect(dom, block);
              if (event.clientX > r.right + 2 || event.clientX < r.left - 2) {
                return placeBlockCaret(view, event.clientX, event.clientY);
              }
            }
          }
          return false;
        },
      },
    }),
);