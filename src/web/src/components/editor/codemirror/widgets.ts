/**
 * WYSIWYG 块级渲染 Widget。
 * 光标不在块内时，把 Markdown 源码替换为渲染后的 DOM（所见即所得）；
 * 点击渲染结果即把光标移回源码进入编辑。所有配色走主题 token。
 */
import { EditorView, WidgetType } from "@codemirror/view";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import "katex/dist/katex.min.css";
import { renderMarkdown } from "../preview";
import { resolveImageSrc, ensureImageConverter, MAGNIFIER_SVG } from "../imageSrc";
import { useLightbox } from "@/stores/lightbox";
import { useWorkspace } from "@/stores/workspace";
import { pathUtil } from "@/bridge/fs";
import { t } from "@/bridge/i18n";

let widgetUid = 0;

/** 点击渲染块 → 光标回到源码起点进入编辑。交互子元素自行 stopPropagation。 */
function editable(el: HTMLElement, view: EditorView, from: number) {
  el.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("[data-no-edit]")) return;
    e.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/* ── 代码块 ───────────────────────────────────────────────────────────────── */

export class CodeBlockWidget extends WidgetType {
  constructor(readonly code: string, readonly lang: string, readonly from: number) {
    super();
  }
  eq(other: CodeBlockWidget) {
    return other.code === this.code && other.lang === this.lang && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "am-wysiwyg-code";
    wrap.setAttribute("data-testid", "wysiwyg-code");

    const header = document.createElement("div");
    header.className = "am-code-header";
    const label = document.createElement("span");
    label.className = "am-code-lang";
    label.textContent = this.lang || "text";
    const copy = document.createElement("button");
    copy.className = "am-code-copy";
    copy.setAttribute("data-no-edit", "");
    copy.setAttribute("aria-label", t("复制代码"));
    copy.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>' + t("复制") + "</span>";
    copy.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard?.writeText(this.code).then(() => {
        copy.classList.add("copied");
        copy.querySelector("span")!.textContent = "已复制";
        setTimeout(() => {
          copy.classList.remove("copied");
          copy.querySelector("span")!.textContent = "复制";
        }, 1600);
      });
    });
    header.append(label, copy);

    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    if (this.lang && hljs.getLanguage(this.lang)) {
      try {
        codeEl.innerHTML = hljs.highlight(this.code, { language: this.lang, ignoreIllegals: true }).value;
      } catch {
        codeEl.textContent = this.code;
      }
    } else {
      codeEl.textContent = this.code;
    }
    pre.appendChild(codeEl);
    wrap.append(header, pre);
    editable(wrap, view, this.from);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/* ── 表格 ─────────────────────────────────────────────────────────────────── */

export class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "am-wysiwyg-table";
    wrap.setAttribute("data-testid", "wysiwyg-table");
    wrap.innerHTML = renderMarkdown(this.source);
    editable(wrap, view, this.from);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/* ── 数学公式 ─────────────────────────────────────────────────────────────── */

export class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean, readonly from: number) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "am-wysiwyg-math am-math-block" : "am-wysiwyg-math am-math-inline";
    el.setAttribute("data-testid", "wysiwyg-math");
    try {
      el.innerHTML = katex.renderToString(this.tex, {
        displayMode: this.display,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      el.textContent = this.tex;
    }
    editable(el, view, this.from);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/* ── 图片 ─────────────────────────────────────────────────────────────────── */

export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly from: number) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "am-wysiwyg-image";
    let clickTimer = 0;
    let editing = false;

    const makeZoomBtn = () => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "am-image-zoom";
      b.innerHTML = MAGNIFIER_SVG;
      b.title = t("img.preview");
      b.setAttribute("aria-label", t("img.preview"));
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); useLightbox.getState().openImage(resolveImageSrc(this.src) || this.src, this.alt, this.src); }, true);
      b.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      return b;
    };

    const renderImg = () => {
      editing = false;
      wrap.classList.remove("am-image-broken", "am-image-editing");
      wrap.innerHTML = "";
      const img = document.createElement("img");
      const apply = () => { img.src = resolveImageSrc(this.src); };
      apply();
      ensureImageConverter().then(apply);
      img.alt = this.alt;
      img.loading = "lazy";
      img.addEventListener("error", () => {
        wrap.classList.add("am-image-broken");
        wrap.innerHTML = `<span class="am-image-fallback">🖼 ${escapeHtml(this.alt || this.src)}</span>`;
        wrap.appendChild(makeZoomBtn());
      });
      wrap.appendChild(img);
      wrap.appendChild(makeZoomBtn());
    };

    const commit = (alt: string, src: string) => {
      const text = view.state.doc.sliceString(this.from, this.from + 400);
      const m = /^!\[[^\]]*\]\([^)]*\)/.exec(text);
      const len = m ? m[0].length : text.length;
      view.dispatch({ changes: { from: this.from, to: this.from + len, insert: `![${alt}](${src})` } });
    };

    const enterEdit = () => {
      if (editing) return;
      editing = true;
      wrap.classList.add("am-image-editing");
      wrap.innerHTML = "";
      const row = document.createElement("span");
      row.className = "am-image-srcrow";
      const altInput = document.createElement("input");
      altInput.className = "am-image-src-alt";
      altInput.value = this.alt;
      altInput.placeholder = t("img.name");
      const srcInput = document.createElement("input");
      srcInput.className = "am-image-src-path";
      srcInput.value = this.src;
      srcInput.placeholder = t("img.src");
      const fileBtn = document.createElement("button");
      fileBtn.type = "button";
      fileBtn.className = "am-image-src-file";
      fileBtn.textContent = t("img.choose");
      fileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return;
          const p = (f as File & { path?: string }).path;
          if (p) {
            const active = useWorkspace.getState().activePath;
            const docDir = active ? pathUtil.parent(active) : "";
            srcInput.value = docDir && pathUtil.isUnder(p, docDir) ? p.slice(docDir.length + 1) : p;
          } else {
            const r = new FileReader();
            r.onload = () => { srcInput.value = String(r.result); };
            r.readAsDataURL(f);
          }
          if (!altInput.value) altInput.value = f.name.replace(/\.[^.]+$/, "");
        };
        input.click();
      });
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "am-image-src-apply";
      applyBtn.textContent = t("img.apply");
      const exit = (save: boolean) => {
        document.removeEventListener("mousedown", outside, true);
        if (save) commit(altInput.value, srcInput.value);
        else renderImg();
      };
      applyBtn.addEventListener("click", (e) => { e.stopPropagation(); exit(true); });
      const previewBtn = document.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "am-image-src-preview";
      previewBtn.innerHTML = MAGNIFIER_SVG;
      previewBtn.title = t("img.preview");
      previewBtn.setAttribute("aria-label", t("img.preview"));
      previewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const src = srcInput.value || this.src;
        useLightbox.getState().openImage(resolveImageSrc(src) || src, altInput.value, src);
      });
      previewBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      const onKey = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); exit(true); }
        else if (e.key === "Escape") { e.preventDefault(); exit(false); }
      };
      altInput.addEventListener("keydown", onKey);
      srcInput.addEventListener("keydown", onKey);
      const outside = (e: MouseEvent) => { if (!wrap.contains(e.target as Node)) exit(true); };
      document.addEventListener("mousedown", outside, true);
      row.append(altInput, srcInput, fileBtn, previewBtn, applyBtn);
      wrap.appendChild(row);
      altInput.focus();
      altInput.select();
    };

    renderImg();
    wrap.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    wrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editing) return;
      clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => enterEdit(), 240);
    }, true);
    wrap.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(clickTimer);
      if (editing) return;
      useLightbox.getState().openImage(resolveImageSrc(this.src) || this.src, this.alt, this.src);
    }, true);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/* ── Mermaid 图表（异步渲染 + SVG 缓存 + 降级） ──────────────────────────── */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidReady = false;
const mermaidSvgCache = new Map<string, string>();
const mermaidFailed = new Set<string>();

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

/** 当前主题签名：主题切换后图表需以新配色重渲染。 */
function themeSignature(): string {
  const el = document.documentElement;
  return `${el.getAttribute("data-theme") ?? ""}|${el.getAttribute("data-theme-mode") ?? ""}`;
}
function mermaidCacheKey(code: string): string {
  return `${themeSignature()}::${code}`;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 从主题 token 推导 Mermaid 配色，使图表与编辑器视觉一致。 */
function mermaidThemeVariables() {
  const dark = document.documentElement.getAttribute("data-theme-mode") === "dark";
  const accent = cssVar("--am-accent", dark ? "#7ee2a8" : "#3d7a4f");
  const text = cssVar("--am-text", dark ? "#e6e6e6" : "#1f2328");
  const border = cssVar("--am-border", dark ? "#3a3a3a" : "#e2e2e2");
  const bg = cssVar("--am-bg-elevated", dark ? "#1e1e1e" : "#ffffff");
  const soft = cssVar("--am-accent-soft", dark ? "rgba(126,226,168,0.16)" : "rgba(61,122,79,0.12)");
  const info = cssVar("--am-info", "#4a90d9");
  const success = cssVar("--am-success", "#3d9a5f");
  const warning = cssVar("--am-warning", "#d9a441");
  const danger = cssVar("--am-danger", "#d9534f");
  return {
    background: bg,
    primaryColor: soft,
    primaryTextColor: text,
    primaryBorderColor: border,
    lineColor: border,
    secondaryColor: soft,
    tertiaryColor: bg,
    mainBkg: soft,
    nodeBorder: border,
    clusterBkg: soft,
    clusterBorder: border,
    titleColor: text,
    edgeLabelBackground: bg,
    textColor: text,
    nodeTextColor: text,
    pie1: accent,
    pie2: info,
    pie3: success,
    pie4: warning,
    pie5: danger,
    pie6: cssVar("--am-text-muted", "#8a8a8a"),
    pie7: accent,
    pie8: info,
    pie9: success,
    pie10: warning,
    pie11: danger,
    pie12: border,
    pieTitleTextColor: text,
    pieSectionTextColor: dark ? "#1a1a1a" : "#ffffff",
    pieLegendTextColor: text,
    pieStrokeColor: bg,
    pieOuterStrokeColor: border,
  };
}

let mermaidLastSig = "";

/** 主题切换时清空图表缓存，强制以新配色重渲染。 */
export function invalidateMermaidCache() {
  mermaidSvgCache.clear();
  mermaidFailed.clear();
  mermaidLastSig = "";
}

function renderMermaid(code: string): Promise<string> {
  const key = mermaidCacheKey(code);
  const cached = mermaidSvgCache.get(key);
  if (cached) return Promise.resolve(cached);
  if (mermaidFailed.has(key)) return Promise.reject(new Error("cached failure"));
  const dark = document.documentElement.getAttribute("data-theme-mode") === "dark";
  const sig = themeSignature();
  return loadMermaid()
    .then((mermaid) => {
      // 主题变化或首次：以当前主题 token 重新初始化
      if (!mermaidReady || mermaidLastSig !== sig) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: dark ? "dark" : "base",
          themeVariables: mermaidThemeVariables(),
        });
        mermaidReady = true;
        mermaidLastSig = sig;
      }
      return mermaid.render(`am-mermaid-${++widgetUid}`, code);
    })
    .then(({ svg }) => {
      mermaidSvgCache.set(key, svg);
      return svg;
    })
    .catch((err) => {
      mermaidFailed.add(key);
      throw err;
    });
}

export class MermaidWidget extends WidgetType {
  constructor(readonly code: string, readonly from: number) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.code === this.code && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "am-wysiwyg-mermaid";
    wrap.setAttribute("data-testid", "wysiwyg-mermaid");
    editable(wrap, view, this.from);

    const insertSvg = (svg: string) => {
      wrap.innerHTML = svg;
      const svgEl = wrap.querySelector("svg");
      if (svgEl) {
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
      }
    };

    const cached = mermaidSvgCache.get(mermaidCacheKey(this.code));
    if (cached) {
      insertSvg(cached);
    } else if (mermaidFailed.has(mermaidCacheKey(this.code))) {
      wrap.innerHTML = `<pre class="am-mermaid-fallback"><code>${escapeHtml(this.code)}</code></pre>`;
    } else {
      wrap.innerHTML = '<div class="am-mermaid-loading"><span class="am-spinner"></span>' + t("渲染图表…") + "</div>";
      renderMermaid(this.code)
        .then((svg) => {
          if (wrap.isConnected) insertSvg(svg);
        })
        .catch(() => {
          if (wrap.isConnected) {
            wrap.innerHTML = `<pre class="am-mermaid-fallback"><code>${escapeHtml(this.code)}</code></pre>`;
          }
        });
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}