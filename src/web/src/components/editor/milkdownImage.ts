/**
 * 图片 node view：相对路径按文档目录解析（Tauri asset 协议，%20 解码）。
 * 单击 → 内联源码编辑行（名字 + 路径 + 选择文件 + 应用）；双击 → 放大模态。
 * 加载失败显示占位（仍可双击查看路径信息）。
 */
import { $view } from "@milkdown/utils";
import { imageSchema } from "@milkdown/preset-commonmark";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { useLightbox } from "@/stores/lightbox";
import { useWorkspace } from "@/stores/workspace";
import { pathUtil } from "@/bridge/fs";
import { t } from "@/bridge/i18n";
import { resolveImageSrcAsync, MAGNIFIER_SVG } from "./imageSrc";

export const imageView = $view(imageSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node: ProseNode = initialNode;
  let editing = false;
  let clickTimer = 0;
  // 视图级缩放/对齐（会话内保持，不写入 Markdown）
  let widthPct: number | null = null;
  let align: "left" | "center" | "right" = "left";

  const dom = document.createElement("span");
  dom.className = "am-image-wrap";
  dom.setAttribute("data-testid", "image");

  const applyLayout = (img: HTMLImageElement) => {
    if (widthPct == null && align === "left") {
      dom.style.display = "";
      img.style.width = "";
      img.style.margin = "";
      return;
    }
    dom.style.display = "block";
    img.style.display = "block";
    img.style.width = widthPct != null ? `${widthPct}%` : "";
    img.style.maxWidth = "100%";
    img.style.margin = align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";
  };

  const posOf = () => (typeof getPos === "function" ? getPos() : undefined);

  /** 选择本地图片 → 回调（相对文档目录路径或 data URI）。占位框与编辑行共用。 */
  const openFilePicker = (cb: (src: string, name: string) => void) => {
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
        cb(docDir && pathUtil.isUnder(p, docDir) ? p.slice(docDir.length + 1) : p, f.name);
      } else {
        const r = new FileReader();
        r.onload = () => cb(String(r.result), f.name);
        r.readAsDataURL(f);
      }
    };
    input.click();
  };

  /** 右上角放大镜：悬停显现，点击打开预览模态（不触发单击编辑/双击）。 */
  const makeZoomBtn = () => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "am-image-zoom";
    b.innerHTML = MAGNIFIER_SVG;
    b.title = t("img.preview");
    b.setAttribute("aria-label", t("img.preview"));
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openLightbox(); });
    b.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    return b;
  };

  const render = () => {
    const src = (node.attrs.src as string) || "";
    const alt = (node.attrs.alt as string) || "";
    editing = false;
    dom.classList.remove("am-image-broken", "am-image-editing", "am-image-empty", "am-image-tall", "am-img-scroll");
    dom.innerHTML = "";
    // 空白图片 ![]()：虚线占位框 + 「选择图片」按钮，选择后就地填充
    if (!src) {
      dom.classList.add("am-image-empty");
      const box = document.createElement("span");
      box.className = "am-image-empty-box";
      const icon = document.createElement("span");
      icon.className = "am-image-empty-icon";
      icon.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4.5 18.5l5-5.5 3.5 3.5 3-3 3.5 4"/></svg>';
      const label = document.createElement("span");
      label.className = "am-image-empty-label";
      label.textContent = alt || t("img.empty");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "am-image-empty-pick";
      btn.textContent = t("img.chooseImage");
      btn.setAttribute("aria-label", t("img.chooseImage"));
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFilePicker((s, name) => commit((node.attrs.alt as string) || name.replace(/\.[^.]+$/, ""), s));
      });
      box.append(icon, label, btn);
      dom.appendChild(box);
      return;
    }
    const img = document.createElement("img");
    img.alt = alt;
    img.loading = "lazy";
    img.draggable = false;
    resolveImageSrcAsync(src).then((u) => { img.src = u; });
    img.addEventListener("error", () => {
      dom.classList.add("am-image-broken");
      dom.innerHTML = "";
      const fb = document.createElement("span");
      fb.className = "am-image-fallback";
      fb.textContent = `🖼 ${alt || src}`;
      dom.appendChild(fb);
      dom.appendChild(makeZoomBtn());
    });
    img.addEventListener("load", () => {
      // 超长图（高/宽比大）在编辑区内限高滚动，避免撑爆文档布局
      if (img.naturalWidth > 0 && img.naturalHeight / img.naturalWidth > 2.5) {
        dom.classList.add("am-image-tall", "am-img-scroll");
      }
    });
    dom.appendChild(img);

    // 悬浮工具条：对齐（左/中/右）+ 放大查看
    const tools = document.createElement("span");
    tools.className = "am-image-tools";
    const alignBtn = (a: "left" | "center" | "right", label: string, path: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "am-image-tool";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${path}"/></svg>`;
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        align = a; applyLayout(img);
        tools.querySelectorAll(".am-image-tool").forEach((x) => x.classList.remove("am-image-tool-active"));
        b.classList.add("am-image-tool-active");
      });
      if (align === a) b.classList.add("am-image-tool-active");
      return b;
    };
    tools.append(
      alignBtn("left", "左对齐", "M3 5h18M3 10h12M3 15h18M3 20h12"),
      alignBtn("center", "居中", "M3 5h18M6 10h12M3 15h18M6 20h12"),
      alignBtn("right", "右对齐", "M3 5h18M9 10h12M3 15h18M9 20h12"),
    );
    const zoom = makeZoomBtn();
    zoom.classList.add("am-image-tool");
    tools.appendChild(zoom);
    dom.appendChild(tools);

    // 右下角拖拽缩放手柄
    const handle = document.createElement("span");
    handle.className = "am-image-resize";
    handle.title = "拖拽缩放";
    handle.addEventListener("mousedown", (e) => e.stopPropagation());
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const container = dom.parentElement?.getBoundingClientRect().width ?? dom.getBoundingClientRect().width;
      const startX = e.clientX;
      const startPct = widthPct ?? (img.getBoundingClientRect().width / container) * 100;
      const move = (ev: PointerEvent) => {
        widthPct = Math.min(100, Math.max(10, startPct + ((ev.clientX - startX) / container) * 100));
        applyLayout(img);
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    dom.appendChild(handle);
    applyLayout(img);
  };

  const commit = (alt: string, src: string) => {
    const pos = posOf();
    if (pos == null) return;
    if (alt !== node.attrs.alt || src !== node.attrs.src) {
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt, src }));
    }
  };

  const exitEdit = (save: boolean, altInput?: HTMLInputElement, srcInput?: HTMLInputElement) => {
    if (!editing) return;
    if (save && altInput && srcInput) commit(altInput.value, srcInput.value);
    render();
  };

  const enterEdit = () => {
    if (editing) return;
    editing = true;
    dom.classList.add("am-image-editing");
    dom.classList.remove("am-image-empty");
    dom.innerHTML = "";
    const row = document.createElement("span");
    row.className = "am-image-srcrow";

    const altInput = document.createElement("input");
    altInput.className = "am-image-src-alt";
    altInput.value = (node.attrs.alt as string) || "";
    altInput.placeholder = t("img.name");
    altInput.setAttribute("aria-label", t("img.name"));

    const srcInput = document.createElement("input");
    srcInput.className = "am-image-src-path";
    srcInput.value = (node.attrs.src as string) || "";
    srcInput.placeholder = t("img.src");
    srcInput.setAttribute("aria-label", t("img.src"));

    const fileBtn = document.createElement("button");
    fileBtn.type = "button";
    fileBtn.className = "am-image-src-file";
    fileBtn.textContent = t("img.choose");
    fileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFilePicker((s, name) => {
        srcInput.value = s;
        if (!altInput.value) altInput.value = name.replace(/\.[^.]+$/, "");
      });
    });

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "am-image-src-apply";
    applyBtn.textContent = t("img.apply");
    applyBtn.addEventListener("click", (e) => { e.stopPropagation(); exitEdit(true, altInput, srcInput); });

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "am-image-src-preview";
    previewBtn.innerHTML = MAGNIFIER_SVG;
    previewBtn.title = t("img.preview");
    previewBtn.setAttribute("aria-label", t("img.preview"));
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const src = srcInput.value || (node.attrs.src as string) || "";
      resolveImageSrcAsync(src).then((url) => {
        useLightbox.getState().openImage(url || src, altInput.value, src);
      });
    });
    previewBtn.addEventListener("mousedown", (e) => e.stopPropagation());

    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); exitEdit(true, altInput, srcInput); }
      else if (e.key === "Escape") { e.preventDefault(); exitEdit(false); }
    };
    altInput.addEventListener("keydown", onKey);
    srcInput.addEventListener("keydown", onKey);

    row.append(altInput, srcInput, fileBtn, previewBtn, applyBtn);
    dom.appendChild(row);
    altInput.focus();
    altInput.select();

    const outside = (e: MouseEvent) => {
      if (!dom.contains(e.target as Node)) {
        document.removeEventListener("mousedown", outside, true);
        exitEdit(true, altInput, srcInput);
      }
    };
    document.addEventListener("mousedown", outside, true);
  };

  const openLightbox = () => {
    const src = (node.attrs.src as string) || "";
    if (!src) return; // 未配置图片时不预览
    const alt = (node.attrs.alt as string) || "";
    resolveImageSrcAsync(src).then((url) => {
      useLightbox.getState().openImage(url || src, alt, src);
    });
  };

  dom.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (editing) return;
    clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => enterEdit(), 240);
  });
  dom.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(clickTimer);
    if (editing) return;
    openLightbox();
  });

  render();

  return {
    dom,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      const changed = newNode.attrs.src !== node.attrs.src || newNode.attrs.alt !== node.attrs.alt;
      node = newNode;
      if (changed && !editing) render();
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
    destroy() { clearTimeout(clickTimer); },
  };
});