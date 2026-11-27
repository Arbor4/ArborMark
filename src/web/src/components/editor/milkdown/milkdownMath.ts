/**
 * 数学公式 node view：KaTeX 渲染 + 点击编辑。
 * 编辑态与图表一致的分栏：上方 TeX 源码、下方实时渲染预览（输入中途语法不全时
 * 保留上一帧正确渲染并提示「语法待完善…」）。
 * - math_inline（content text*）：行内紧凑分栏面板，事务改写文本内容。
 * - math_block（attrs.value）：块级分栏，attrs.value 单一数据源。
 */
import { $view } from "@milkdown/utils";
import { mathInlineSchema, mathBlockSchema } from "@milkdown/plugin-math";
import { TextSelection } from "@milkdown/prose/state";
import katex from "katex";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { t } from "@/bridge/i18n";
import { useLightbox } from "@/stores/lightbox";
import { useUi } from "@/stores/ui";
import { createZoomButton } from "../imageSrc";

export const PHYSICS_MACROS: Record<string, string> = {
  "\\dd": "\\mathrm{d}",
  "\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
  "\\pdv": "\\frac{\\partial #1}{\\partial #2}",
  "\\bra": "\\langle #1 |",
  "\\ket": "| #1 \\rangle",
  "\\braket": "\\langle #1 | #2 \\rangle",
  "\\abs": "\\left| #1 \\right|",
  "\\norm": "\\left\\| #1 \\right\\|",
  "\\ev": "\\langle #1 \\rangle",
  "\\qty": "\\left( #1 \\right)",
};

export function getKatexOptions(displayMode: boolean, outputOverride?: "html" | "mathml" | "htmlAndMathml") {
  const prefs = useUi.getState().prefs;
  const physics = prefs.enablePhysicsPackage === true;
  return {
    throwOnError: false,
    strict: false,
    trust: false,
    output: (outputOverride ?? "html") as "html" | "mathml" | "htmlAndMathml",
    displayMode,
    ...(physics ? { macros: PHYSICS_MACROS } : {}),
  };
}

function renderKatex(tex: string, el: HTMLElement, displayMode: boolean) {
  try {
    katex.render(tex, el, getKatexOptions(displayMode));
  } catch {
    el.textContent = tex;
    el.classList.add("katex-error");
  }
}

/** 编辑态实时预览：语法不全时保留上一帧，仅亮错误徽章。 */
function makeLivePreview(target: HTMLElement, badge: HTMLElement, displayMode: boolean) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const probe = document.createElement("div");
  const renderNow = (tex: string) => {
    if (!tex.trim()) {
      target.innerHTML = '<span class="am-math-empty">' + t("空公式") + "</span>";
      badge.style.display = "none";
      return;
    }
    try {
      katex.render(tex, probe, { ...getKatexOptions(displayMode), throwOnError: true });
      target.innerHTML = probe.innerHTML;
      badge.style.display = "none";
    } catch {
      badge.textContent = "语法待完善…";
      badge.style.display = "";
    }
  };
  return {
    schedule(tex: string) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => renderNow(tex), 180);
    },
    flush(tex: string) {
      if (timer) clearTimeout(timer);
      renderNow(tex);
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  };
}

function makePaneHeader(title: string, onDone: () => void) {
  const pane = document.createElement("div");
  pane.className = "am-diagram-editor-pane";
  pane.style.display = "none";
  const header = document.createElement("div");
  header.className = "am-diagram-pane-header";
  header.contentEditable = "false";
  const label = document.createElement("span");
  label.className = "am-diagram-pane-title";
  label.textContent = title;
  const done = document.createElement("button");
  done.type = "button";
  done.className = "am-diagram-done";
  done.textContent = "完成";
  done.addEventListener("mousedown", (e) => e.preventDefault());
  done.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDone();
  });
  header.append(label, done);
  pane.append(header);
  return { pane, done };
}

function makePreviewLabel() {
  const label = document.createElement("div");
  label.className = "am-diagram-preview-label";
  label.style.display = "none";
  label.contentEditable = "false";
  const title = document.createElement("span");
  title.textContent = "实时预览";
  const badge = document.createElement("span");
  badge.className = "am-diagram-err";
  badge.style.display = "none";
  label.append(title, badge);
  return { label, badge };
}

/* ── 行内公式：紧凑分栏面板（上 input / 下实时预览） ─────────────────────── */
export const mathInlineView = $view(mathInlineSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node: ProseNode = initialNode;
  let editing = false;

  const dom = document.createElement("span");
  dom.className = "am-math-inline";
  dom.setAttribute("data-testid", "math-inline");
  const renderArea = document.createElement("span");
  renderArea.className = "am-math-render";

  const panel = document.createElement("span");
  panel.className = "am-math-split";
  panel.style.display = "none";
  const input = document.createElement("input");
  input.className = "am-math-src";
  input.spellcheck = false;
  input.setAttribute("aria-label", "行内公式 TeX 源码");
  const { label: previewLabel, badge } = makePreviewLabel();
  previewLabel.className = "am-math-split-label";
  const preview = document.createElement("span");
  preview.className = "am-math-split-preview";
  panel.append(input, previewLabel, preview);
  dom.append(renderArea, panel);

  const live = makeLivePreview(preview, badge, false);
  const posOf = () => (typeof getPos === "function" ? getPos() : undefined);
  const render = () => renderKatex(node.textContent, renderArea, false);

  const commit = () => {
    const pos = posOf();
    if (pos == null) return;
    if (input.value !== node.textContent) {
      const start = pos + 1;
      const end = start + node.content.size;
      view.dispatch(view.state.tr.insertText(input.value, start, end));
    }
  };

  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  const enterEdit = () => {
    if (editing) return;
    editing = true;
    dom.classList.add("am-math-editing");
    renderArea.style.display = "none";
    panel.style.display = "inline-block";
    input.value = node.textContent;
    live.flush(input.value);
    outsideHandler = (e: MouseEvent) => {
      if (!dom.contains(e.target as Node)) exitEdit();
    };
    document.addEventListener("mousedown", outsideHandler, true);
    input.focus();
    input.select();
  };

  const exitEdit = () => {
    if (!editing) return;
    editing = false;
    live.cancel();
    if (outsideHandler) {
      document.removeEventListener("mousedown", outsideHandler, true);
      outsideHandler = null;
    }
    commit();
    dom.classList.remove("am-math-editing");
    panel.style.display = "none";
    renderArea.style.display = "";
    render();
  };

  renderArea.addEventListener("click", enterEdit);
  input.addEventListener("input", () => {
    commit();
    live.schedule(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter") { exitEdit(); view.focus(); }
    e.stopPropagation();
  });

  render();

  return {
    dom,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      if (!editing) render();
      return true;
    },
    selectNode() { dom.classList.add("am-math-selected"); },
    deselectNode() { dom.classList.remove("am-math-selected"); exitEdit(); },
    stopEvent(event: Event) { return editing && panel.contains(event.target as Node); },
    ignoreMutation() { return true; },
    destroy() {
      live.cancel();
      if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
    },
  };
});

/* ── 块级公式：分栏编辑（上 TeX 源码 / 下实时渲染） ──────────────────────── */
export const mathBlockView = $view(mathBlockSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node: ProseNode = initialNode;
  let editing = false;
  let destroyed = false;

  const dom = document.createElement("div");
  dom.className = "am-math-block";
  dom.setAttribute("data-testid", "math-block");

  const { pane } = makePaneHeader("TeX 源码", () => { exitEdit(); view.focus(); });
  const editor = document.createElement("textarea");
  editor.className = "am-diagram-code";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "块级公式 TeX 源码");
  pane.append(editor);

  const { label: previewLabel, badge } = makePreviewLabel();
  const renderArea = document.createElement("div");
  renderArea.className = "am-math-render";
  renderArea.contentEditable = "false";
  const hint = document.createElement("div");
  hint.className = "am-math-hint";
  hint.contentEditable = "false";
  hint.textContent = "点击编辑公式";
  const zoomBtn = createZoomButton(t("放大查看"), () => {
    const tex = (node.attrs.value as string) ?? "";
    if (!tex.trim()) return;
    useLightbox.getState().openMath(tex, t("onboard.demo.math"));
  });
  // 顺序：源码面板（上）→ 预览标签 → 公式（下）→ 提示 → 放大按钮
  dom.append(pane, previewLabel, renderArea, hint, zoomBtn);

  const live = makeLivePreview(renderArea, badge, true);
  const posOf = () => (typeof getPos === "function" ? getPos() : undefined);
  const syncZoomBtn = () => {
    const tex = (node.attrs.value as string) ?? "";
    zoomBtn.style.display = !editing && !!tex.trim() ? "" : "none";
  };
  const render = () => {
    const tex = (node.attrs.value as string) ?? "";
    dom.dataset.mathAms = /\\(label|tag)\b/.test(tex) ? "true" : "false";
    renderKatex(tex, renderArea, true);
    syncZoomBtn();
  };

  const commit = () => {
    const pos = posOf();
    if (pos == null) return;
    if (editor.value !== node.attrs.value) {
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: editor.value }));
    }
  };

  const autoSize = () => {
    editor.style.height = "auto";
    editor.style.height = `${Math.min(editor.scrollHeight + 2, 320)}px`;
  };

  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  const enterEdit = () => {
    if (editing) return;
    editing = true;
    dom.classList.add("am-math-editing");
    pane.style.display = "block";
    previewLabel.style.display = "";
    hint.style.display = "none";
    syncZoomBtn();
    editor.value = (node.attrs.value as string) ?? "";
    autoSize();
    live.flush(editor.value);
    outsideHandler = (e: MouseEvent) => {
      if (!dom.contains(e.target as Node)) exitEdit();
    };
    document.addEventListener("mousedown", outsideHandler, true);
    editor.focus();
    const len = editor.value.length;
    editor.setSelectionRange(len, len);
  };

  const exitEdit = () => {
    if (!editing) return;
    editing = false;
    live.cancel();
    if (outsideHandler) {
      document.removeEventListener("mousedown", outsideHandler, true);
      outsideHandler = null;
    }
    commit();
    dom.classList.remove("am-math-editing");
    pane.style.display = "none";
    previewLabel.style.display = "none";
    hint.style.display = "";
    render();
  };

  renderArea.addEventListener("click", enterEdit);
  dom.addEventListener("am-enter-edit", enterEdit);
  editor.addEventListener("input", () => {
    commit();
    autoSize();
    live.schedule(editor.value);
  });
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { exitEdit(); view.focus(); }
    e.stopPropagation();
  });

  render();
  // 交互式创建空公式块（如输入 $$ 回车）：聚焦时自动展开编辑并将光标落入源码框
  if (view.hasFocus() && !String(node.attrs.value ?? "").trim()) {
    requestAnimationFrame(() => { if (!destroyed && !editing) enterEdit(); });
  }

  return {
    dom,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      if (!editing) render();
      return true;
    },
    selectNode() { dom.classList.add("am-math-selected"); },
    deselectNode() { dom.classList.remove("am-math-selected"); exitEdit(); },
    stopEvent(event: Event) {
      const target = event.target as Node;
      return (editing && pane.contains(target)) || zoomBtn.contains(target);
    },
    ignoreMutation() { return true; },
    destroy() {
      destroyed = true;
      live.cancel();
      if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
    },
  };
});

export const mathViews = [mathInlineView, mathBlockView].flat();