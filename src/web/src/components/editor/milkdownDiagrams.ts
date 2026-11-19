/**
 * Mermaid 图表 node view：
 * - 读取 viewBox 固有尺寸，保持宽高比缩放到容器内（修复拉伸/过大/留白）。
 * - 配色随主题 token 联动（theme=base + themeVariables）。
 * - 点击进入「上源码 / 下实时预览」分栏编辑：上方 textarea 改源码，下方图表随输入
 *   防抖实时重渲染（语法中途出错保留上一帧并提示），完成/Esc/外部点击收起为纯图表。
 * - attrs.value 为单一数据源（修复 contentDOM 与 attrs 不一致）。
 */
import { $view } from "@milkdown/utils";
import { diagramSchema } from "@milkdown/plugin-diagram";
import mermaid from "mermaid";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { t } from "@/bridge/i18n";

let diagramUid = 0;
let lastThemeKey = "";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 依据当前主题 token 初始化 mermaid（主题变化时重新初始化）。 */
function ensureMermaid() {
  const dark = document.documentElement.getAttribute("data-theme-mode") === "dark";
  const accent = cssVar("--am-accent", "#42b983");
  const accentSoft = cssVar("--am-accent-soft", "#e8f5ee");
  const text = cssVar("--am-text", "#24292f");
  const textMuted = cssVar("--am-text-muted", "#6e7781");
  const border = cssVar("--am-border", "#d0d7de");
  const bg = cssVar("--am-bg-elevated", "#ffffff");
  const key = `${dark}|${accent}|${text}|${border}|${bg}`;
  if (key === lastThemeKey) return;
  lastThemeKey = key;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    themeVariables: {
      darkMode: dark,
      background: bg,
      primaryColor: accentSoft,
      primaryTextColor: text,
      primaryBorderColor: accent,
      secondaryColor: bg,
      secondaryTextColor: text,
      secondaryBorderColor: border,
      tertiaryColor: bg,
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      lineColor: textMuted,
      textColor: text,
      mainBkg: accentSoft,
      nodeBorder: accent,
      clusterBkg: bg,
      clusterBorder: border,
      titleColor: text,
      edgeLabelBackground: bg,
      fontSize: "14px",
    },
  });
}

/** 把 SVG 按固有宽高比缩放到 (maxW, maxH) 内，居中显示。 */
function fitSvg(svgEl: SVGSVGElement, maxW: number, maxH: number) {
  const vb = svgEl.viewBox?.baseVal;
  let w = vb && vb.width ? vb.width : 0;
  let h = vb && vb.height ? vb.height : 0;
  if (!w || !h) {
    w = svgEl.width?.baseVal?.value || 600;
    h = svgEl.height?.baseVal?.value || 400;
  }
  const scale = Math.min(maxW / w, maxH / h, 1.5);
  svgEl.removeAttribute("width");
  svgEl.removeAttribute("height");
  svgEl.style.width = `${Math.round(w * scale)}px`;
  svgEl.style.height = `${Math.round(h * scale)}px`;
  svgEl.style.maxWidth = "100%";
  svgEl.style.display = "block";
  svgEl.style.margin = "0 auto";
}

/**
 * 通用图表 node view 工厂：mermaid / flowchart.js(flow) / sequence 共用。
 * toMermaid 把源码转换为 mermaid 语法用于渲染；编辑区始终显示原始源码，
 * 序列化回写原始语言（```mermaid / ```flow / ```sequence）。
 */
export function createDiagramNodeView(schema: { node: any }, toMermaid: (code: string) => string, langLabel = "Mermaid") {
  return $view(schema.node, () => (initialNode: ProseNode, view: EditorView, getPos: (() => number | undefined) | boolean) => {
  let node: ProseNode = initialNode;
  let editing = false;
  let destroyed = false;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let renderSeq = 0;
  // 长文性能：离屏图表先显示轻量源码占位，进入视口附近才真正渲染 mermaid
  let rendered = false;
  let io: IntersectionObserver | null = null;

  const dom = document.createElement("div");
  dom.className = "am-diagram-wrap";
  dom.setAttribute("data-testid", "diagram-wrap");

  // 源码编辑面板（编辑态置顶）
  const editorPane = document.createElement("div");
  editorPane.className = "am-diagram-editor-pane";
  editorPane.style.display = "none";
  const paneHeader = document.createElement("div");
  paneHeader.className = "am-diagram-pane-header";
  paneHeader.contentEditable = "false";
  const paneTitle = document.createElement("span");
  paneTitle.className = "am-diagram-pane-title";
  paneTitle.textContent = `${langLabel} ${t("源码")}`;
  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "am-diagram-done";
  doneBtn.textContent = t("完成");
  paneHeader.append(paneTitle, doneBtn);
  const editor = document.createElement("textarea");
  editor.className = "am-diagram-code";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Mermaid 源码编辑");
  editorPane.append(paneHeader, editor);

  // 实时预览标签（编辑态显示在源码与图表之间）
  const previewLabel = document.createElement("div");
  previewLabel.className = "am-diagram-preview-label";
  previewLabel.style.display = "none";
  previewLabel.contentEditable = "false";
  const previewTitle = document.createElement("span");
  previewTitle.textContent = t("实时预览");
  const errBadge = document.createElement("span");
  errBadge.className = "am-diagram-err";
  errBadge.style.display = "none";
  previewLabel.append(previewTitle, errBadge);

  const renderArea = document.createElement("div");
  renderArea.className = "am-diagram-render";
  const hint = document.createElement("div");
  hint.className = "am-diagram-hint";
  hint.textContent = t("点击编辑图表代码");
  // 顺序：源码面板（上）→ 预览标签 → 图表（下）→ 提示
  dom.append(editorPane, previewLabel, renderArea, hint);

  const posOf = () => (typeof getPos === "function" ? getPos() : undefined);

  const renderDiagram = async (code: string, keepOnError = false) => {
    const seq = ++renderSeq;
    if (!code.trim()) {
      if (destroyed || seq !== renderSeq) return;
      renderArea.innerHTML = '<span class="am-diagram-empty">' + t("空图表") + "</span>";
      errBadge.style.display = "none";
      return;
    }
    const id = `am-diagram-${++diagramUid}`;
    try {
      ensureMermaid();
      const { svg } = await mermaid.render(id, toMermaid(code));
      if (destroyed || seq !== renderSeq) return;
      renderArea.innerHTML = svg;
      const svgEl = renderArea.querySelector("svg");
      if (svgEl) {
        const maxW = Math.max(240, renderArea.clientWidth - 8);
        fitSvg(svgEl as SVGSVGElement, maxW, editing ? 320 : 400);
      }
      errBadge.style.display = "none";
    } catch {
      document.getElementById(`d${id}`)?.remove();
      if (destroyed || seq !== renderSeq) return;
      if (keepOnError) {
        // 编辑态：保留上一帧正确渲染，仅提示语法待完善（输入中途不闪 fallback）
        errBadge.textContent = "语法待完善…";
        errBadge.style.display = "";
      } else {
        renderArea.innerHTML = `<pre class="am-diagram-fallback"></pre>`;
        renderArea.querySelector("pre")!.textContent = code;
      }
    }
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

  const scheduleLiveRender = () => {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderDiagram(editor.value, true), 280);
  };

  const enterEdit = () => {
    if (editing) return;
    editing = true;
    rendered = true;
    io?.disconnect();
    io = null;
    dom.classList.add("am-diagram-editing");
    editorPane.style.display = "block";
    previewLabel.style.display = "flex";
    hint.style.display = "none";
    editor.value = (node.attrs.value as string) ?? "";
    autoSize();
    editor.focus();
    renderDiagram(editor.value, true);
  };

  const exitEdit = () => {
    if (!editing) return;
    editing = false;
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    commit();
    dom.classList.remove("am-diagram-editing");
    editorPane.style.display = "none";
    previewLabel.style.display = "none";
    hint.style.display = "";
    errBadge.style.display = "none";
    renderDiagram((node.attrs.value as string) ?? "");
  };

  renderArea.addEventListener("click", () => { if (!editing) enterEdit(); });
  doneBtn.addEventListener("mousedown", (e) => e.preventDefault());
  doneBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); exitEdit(); view.focus(); });
  editor.addEventListener("input", () => { commit(); autoSize(); scheduleLiveRender(); });
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { exitEdit(); view.focus(); }
    e.stopPropagation();
  });
  // 点击图表卡片之外退出编辑（ProseMirror 焦点在根节点，blur 不可靠）
  const outsideHandler = (e: MouseEvent) => {
    if (editing && !dom.contains(e.target as Node)) exitEdit();
  };
  document.addEventListener("mousedown", outsideHandler, true);
  // 明暗 / 主题切换时重渲染（mermaid 配色为烘焙值，需重新初始化）
  const onThemeChange = () => {
    if (!editing && !destroyed) renderDiagram((node.attrs.value as string) ?? "");
  };
  window.addEventListener("am-theme-change", onThemeChange);

  const showPlaceholder = () => {
    renderArea.innerHTML = '<pre class="am-diagram-fallback"></pre>';
    renderArea.querySelector("pre")!.textContent = (node.attrs.value as string) ?? "";
  };
  const renderOnce = () => {
    if (rendered || destroyed) return;
    rendered = true;
    io?.disconnect();
    io = null;
    renderDiagram((node.attrs.value as string) ?? "");
  };

  if (typeof IntersectionObserver !== "undefined") {
    showPlaceholder();
    io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) renderOnce(); },
      { rootMargin: "300px 0px" },
    );
    io.observe(dom);
  } else {
    renderOnce();
  }

  return {
    dom,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      if (!editing) {
        if (rendered) renderDiagram((node.attrs.value as string) ?? "");
        else showPlaceholder();
      }
      return true;
    },
    selectNode() { dom.classList.add("am-diagram-selected"); },
    deselectNode() { dom.classList.remove("am-diagram-selected"); },
    stopEvent(event: Event) {
      const t = event.target as Node;
      return editorPane.contains(t) || previewLabel.contains(t);
    },
    ignoreMutation() { return true; },
    destroy() {
      destroyed = true;
      if (renderTimer) clearTimeout(renderTimer);
      io?.disconnect();
      document.removeEventListener("mousedown", outsideHandler, true);
      window.removeEventListener("am-theme-change", onThemeChange);
    },
  };
  });
}

/** Mermaid 图表：源码即 mermaid 语法，直接渲染。 */
export const mermaidNodeView = createDiagramNodeView(diagramSchema, (c) => c);