import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import { X, ZoomIn, ZoomOut, Maximize2, ImageOff, Scan, MoveHorizontal } from "lucide-react";
import { useLightbox } from "@/stores/lightbox";
import { Tooltip } from "./common";
import { useLang } from "@/bridge/i18n";
import { initialImageView, wholeFitScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE } from "./editor/imageSrc";

const BASE_MATH_PX = 28;

/** 放大预览模态：支持图片、矢量图表（SVG）与数学公式（KaTeX），原生滚动 + 缩放 + 快捷键。 */
export function ImageLightbox() {
  const { t } = useLang();
  const open = useLightbox((s) => s.open);
  const kind = useLightbox((s) => s.kind);
  const src = useLightbox((s) => s.src);
  const alt = useLightbox((s) => s.alt);
  const raw = useLightbox((s) => s.raw);
  const svg = useLightbox((s) => s.svg);
  const svgWidth = useLightbox((s) => s.width);
  const svgHeight = useLightbox((s) => s.height);
  const tex = useLightbox((s) => s.tex);
  const title = useLightbox((s) => s.title);
  const close = useLightbox((s) => s.close);

  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const mathHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setStatus("loading");
    setNatural({ w: 0, h: 0 });
  }, [open, kind, src, svg, tex]);

  const stageSize = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect();
    return { sw: r?.width ?? window.innerWidth, sh: r?.height ?? window.innerHeight };
  }, []);

  const zoomTo = useCallback((next: number) => {
    const st = stageRef.current;
    const clamped = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, next));
    if (!st) {
      setScale(clamped);
      return;
    }
    const dw = st.scrollWidth - st.clientWidth, dh = st.scrollHeight - st.clientHeight;
    const fx = dw > 0 ? st.scrollLeft / dw : 0, fy = dh > 0 ? st.scrollTop / dh : 0;
    setScale(clamped);
    requestAnimationFrame(() => {
      const nw = st.scrollWidth - st.clientWidth, nh = st.scrollHeight - st.clientHeight;
      st.scrollLeft = fx * nw;
      st.scrollTop = fy * nh;
    });
  }, []);

  // SVG 图表初始化与缩放尺寸同步
  useEffect(() => {
    if (!open || kind !== "svg" || !svgHostRef.current) return;
    svgHostRef.current.innerHTML = svg;
    const svgEl = svgHostRef.current.querySelector("svg");
    const w = Math.max(1, svgWidth || 600);
    const h = Math.max(1, svgHeight || 400);
    setNatural({ w, h });
    const { sw, sh } = stageSize();
    const fit = Math.min((sw - 96) / w, (sh - 120) / h);
    const init = fit >= 1 ? Math.min(fit, 2) : Math.max(MIN_VIEW_SCALE, fit);
    setScale(init);
    setStatus("ready");
    if (svgEl) {
      svgEl.style.maxWidth = "none";
      svgEl.style.width = `${Math.round(w * init)}px`;
      svgEl.style.height = `${Math.round(h * init)}px`;
    }
  }, [open, kind, svg, svgWidth, svgHeight, stageSize]);

  useEffect(() => {
    if (!open || kind !== "svg" || !svgHostRef.current || status !== "ready") return;
    const svgEl = svgHostRef.current.querySelector("svg");
    if (!svgEl) return;
    svgEl.style.maxWidth = "none";
    svgEl.style.width = `${Math.round(natural.w * scale)}px`;
    svgEl.style.height = `${Math.round(natural.h * scale)}px`;
  }, [open, kind, scale, natural, status]);

  // 数学公式初始化渲染与自适应缩放
  useEffect(() => {
    if (!open || kind !== "math" || !mathHostRef.current) return;
    const el = mathHostRef.current;
    el.style.fontSize = `${BASE_MATH_PX}px`;
    katex.render(tex, el, { throwOnError: false, strict: false, trust: false, output: "html", displayMode: true });
    const r = el.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    setNatural({ w, h });
    const { sw, sh } = stageSize();
    const init = Math.min((sw - 120) / w, (sh - 140) / h, 1);
    setScale(Math.max(MIN_VIEW_SCALE, init));
    setStatus("ready");
  }, [open, kind, tex, stageSize]);

  const isLong = natural.h / Math.max(1, natural.w) > 2.5;
  const fitWhole = useCallback(() => {
    const { sw, sh } = stageSize();
    const pad = kind === "image" ? 0 : 96;
    zoomTo(wholeFitScale(natural.w, natural.h, Math.max(120, sw - pad), Math.max(120, sh - pad)));
  }, [kind, natural, stageSize, zoomTo]);
  const fitWidth = useCallback(() => {
    const { sw } = stageSize();
    const pad = kind === "image" ? 0 : 96;
    zoomTo(Math.min(Math.max(120, sw - pad) / Math.max(1, natural.w), 1));
  }, [kind, natural, stageSize, zoomTo]);
  const actualSize = useCallback(() => zoomTo(1), [zoomTo]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(scale * 1.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomTo(scale / 1.25); }
      else if (e.key === "0") { e.preventDefault(); fitWhole(); }
      else if (e.key === "1") { e.preventDefault(); actualSize(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close, zoomTo, scale, fitWhole, actualSize]);

  useEffect(() => {
    const st = stageRef.current;
    if (!open || !st || status !== "ready") return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoomTo(scale * Math.exp(-e.deltaY * 0.0025));
      }
    };
    st.addEventListener("wheel", onWheel, { passive: false });
    return () => st.removeEventListener("wheel", onWheel);
  }, [open, status, scale, zoomTo]);

  if (!open) return null;

  const fallbackLabel = kind === "math" ? t("onboard.demo.math") : kind === "svg" ? t("ctx.diagram") : "图片";
  const name = (kind === "image" ? raw.split("/").pop() : "") || title || alt || fallbackLabel;
  const btn = "flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || alt || name}
      className="am-no-print fixed inset-0 z-[80] flex flex-col bg-black/75 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate text-[12px] text-white/80">
          {name}
          {kind === "image" && status === "ready" && natural.w > 0 && (
            <span className="ml-2 tabular-nums text-white/50">{natural.w} × {natural.h}</span>
          )}
        </p>
        <div className="am-glass flex items-center gap-0.5 rounded-lg border border-white/15 bg-white/10 px-1 py-1 backdrop-blur-md">
          <Tooltip label={t("缩小 −")} side="bottom"><button aria-label={t("缩小")} onClick={() => zoomTo(scale / 1.25)} className={btn}><ZoomOut size={14} /></button></Tooltip>
          <span className="min-w-[46px] text-center text-[11px] tabular-nums text-white/80">{Math.round(scale * 100)}%</span>
          <Tooltip label={t("放大 +")} side="bottom"><button aria-label={t("放大")} onClick={() => zoomTo(scale * 1.25)} className={btn}><ZoomIn size={14} /></button></Tooltip>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <Tooltip label={t("适应窗口 0")} side="bottom"><button aria-label={t("适应窗口")} onClick={fitWhole} className={btn}><Maximize2 size={14} /></button></Tooltip>
          <Tooltip label={t("适应宽度")} side="bottom"><button aria-label={t("适应宽度")} onClick={fitWidth} className={btn}><MoveHorizontal size={14} /></button></Tooltip>
          <Tooltip label={t("原始尺寸 1")} side="bottom"><button aria-label={t("原始尺寸")} onClick={actualSize} className={btn}><Scan size={14} /></button></Tooltip>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <Tooltip label={t("关闭 Esc")} side="bottom"><button aria-label={t("关闭")} onClick={close} className={btn}><X size={14} /></button></Tooltip>
        </div>
      </div>

      <div
        ref={stageRef}
        className="am-img-scroll am-img-scroll-dark relative min-h-0 flex-1"
        onDoubleClick={() => (Math.abs(scale - 1) < 0.01 ? (isLong ? fitWidth() : fitWhole()) : actualSize())}
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "image" && status !== "error" && (
          <div className="am-img-center">
            <img
              key={src}
              src={src}
              alt={alt || name}
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
                setNatural({ w, h });
                const { sw, sh } = stageSize();
                setScale(initialImageView(w, h, sw, sh).scale);
                setStatus("ready");
                requestAnimationFrame(() => {
                  if (stageRef.current) stageRef.current.scrollTop = 0;
                });
              }}
              onError={() => setStatus("error")}
              className="max-w-none select-none"
              style={{ width: natural.w * scale, height: natural.h * scale, opacity: status === "ready" ? 1 : 0, boxShadow: "0 12px 48px rgba(0,0,0,0.5)" }}
            />
          </div>
        )}
        {kind === "svg" && (
          <div className="am-img-center p-6">
            <div ref={svgHostRef} className="rounded-xl border border-line bg-elevated p-6 text-ink shadow-modal" />
          </div>
        )}
        {kind === "math" && (
          <div className="am-img-center p-6">
            <div className="rounded-xl border border-line bg-elevated px-10 py-8 text-ink shadow-modal">
              <div ref={mathHostRef} style={{ fontSize: `${Math.round(BASE_MATH_PX * scale)}px` }} />
            </div>
          </div>
        )}
        {kind === "image" && status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
          </div>
        )}
        {kind === "image" && status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <div className="am-glass flex max-w-[420px] flex-col items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-8 py-8 text-center backdrop-blur-md">
              <ImageOff size={28} className="text-white/60" />
              <p className="text-[13px] font-medium text-white/90">{t("图片无法加载")}</p>
              <p className="break-all text-[11.5px] leading-relaxed text-white/60">{raw || src}</p>
            </div>
          </div>
        )}
      </div>

      <p className="px-4 pb-2.5 text-center text-[10.5px] text-white/40">{t("滚轮滚动 · Ctrl+滚轮缩放 · 双击切换原始/适应尺寸 · Esc 关闭")}</p>
    </div>
  );
}
