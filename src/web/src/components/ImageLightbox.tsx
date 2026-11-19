import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, Maximize2, ImageOff, Scan, MoveHorizontal } from "lucide-react";
import { useLightbox } from "@/stores/lightbox";
import { Tooltip } from "./common";
import { useLang } from "@/bridge/i18n";
import { initialImageView, wholeFitScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE } from "./editor/imageSrc";

/** 图片放大模态：可滚动舞台（长图原生滚动条），滚轮滚动、Ctrl+滚轮/按钮缩放、
 *  双击切换适应/原始尺寸、Esc 关闭。普通图整图适应，超长图按宽适应并顶部对齐。 */
export function ImageLightbox() {
  const { t } = useLang();
  const open = useLightbox((s) => s.open);
  const src = useLightbox((s) => s.src);
  const alt = useLightbox((s) => s.alt);
  const raw = useLightbox((s) => s.raw);
  const close = useLightbox((s) => s.close);

  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setScale(1);
      setStatus("loading");
      setNatural({ w: 0, h: 0 });
    }
  }, [open, src]);

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

  const isLong = natural.h / Math.max(1, natural.w) > 2.5;
  const fitWhole = useCallback(() => {
    const { sw, sh } = stageSize();
    zoomTo(wholeFitScale(natural.w, natural.h, sw, sh));
  }, [natural, stageSize, zoomTo]);
  const fitWidth = useCallback(() => {
    const { sw } = stageSize();
    zoomTo(Math.min(sw / Math.max(1, natural.w), 1));
  }, [natural, stageSize, zoomTo]);
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

  const name = raw.split("/").pop() || alt || "图片";
  const btn = "flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || name}
      className="am-no-print fixed inset-0 z-[80] flex flex-col bg-black/75 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate text-[12px] text-white/80">
          {alt || name}
          {status === "ready" && natural.w > 0 && <span className="ml-2 tabular-nums text-white/50">{natural.w} × {natural.h}</span>}
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
          <Tooltip label={t("关闭 Esc")} side="bottom"><button aria-label={t("关闭图片")} onClick={close} className={btn}><X size={14} /></button></Tooltip>
        </div>
      </div>

      <div
        ref={stageRef}
        className="am-img-scroll am-img-scroll-dark relative min-h-0 flex-1"
        onDoubleClick={() => (Math.abs(scale - 1) < 0.01 ? (isLong ? fitWidth() : fitWhole()) : actualSize())}
        onClick={(e) => e.stopPropagation()}
      >
        {status !== "error" && (
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
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
          </div>
        )}
        {status === "error" && (
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