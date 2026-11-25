/**
 * 二进制文件预览：图片 / PDF。侧边栏选中这类文件时不走文本编辑器。
 * 图片为可滚动舞台：长图按宽适应 + 原生滚动条（主题化），普通图整图适应；
 * 滚轮滚动、Ctrl+滚轮/按钮缩放、双击切换原始/适应，可放大查看或系统打开。
 * PDF 内嵌渲染（桌面经自定义协议，浏览器回退提示）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, Scan, ExternalLink, RefreshCw, ImageOff, FileText, MoveHorizontal, FileVideo, Music, FileX } from "lucide-react";
import { useLightbox } from "@/stores/lightbox";
import { useUi } from "@/stores/ui";
import { invoke, isTauri } from "@/bridge/ipc";
import { pathUtil } from "@/bridge/fs";
import { resolveImageSrcAsync, initialImageView, wholeFitScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE } from "./imageSrc";
import type { PreviewKind } from "./codemirror/codeLanguage";
import { useLang } from "@/bridge/i18n";

const btn =
  "flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink";

const KIND_LABEL: Record<PreviewKind, string> = {
  image: "图片",
  pdf: "PDF",
  video: "视频",
  audio: "音频",
  unsupported: "不支持",
};

export function FilePreview({ path, kind }: { path: string; kind: PreviewKind }) {
  const { t } = useLang();
  const name = pathUtil.name(path);
  const openItem = () => invoke("shell.openItem", { path }).catch(() => useUi.getState().toast(t("无法打开文件"), "warning"));

  return (
    <div className="absolute inset-0 flex flex-col bg-editor">
      <div className="am-no-print flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2">
        <p className="min-w-0 truncate text-[12px] text-ink-secondary">
          <span className="mr-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            {t(KIND_LABEL[kind])}
          </span>
          {name}
        </p>
        <button aria-label={t("用系统应用打开")} title={t("用系统应用打开")} onClick={openItem} className={btn}>
          <ExternalLink size={14} />
        </button>
      </div>
      {kind === "image" ? <ImageViewer path={path} />
        : kind === "pdf" ? <PdfViewer path={path} />
        : kind === "unsupported" ? <UnsupportedView path={path} />
        : <MediaViewer path={path} kind={kind} />}
    </div>
  );
}

function ImageViewer({ path }: { path: string }) {
  const { t } = useLang();
  const [src, setSrc] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setSrc("");
    resolveImageSrcAsync(path).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

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

  useEffect(() => {
    const st = stageRef.current;
    if (!st || status !== "ready") return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoomTo(scale * Math.exp(-e.deltaY * 0.0025));
      }
    };
    st.addEventListener("wheel", onWheel, { passive: false });
    return () => st.removeEventListener("wheel", onWheel);
  }, [status, scale, zoomTo]);

  const isLong = natural.h / Math.max(1, natural.w) > 2.5;
  const fitWhole = () => {
    const { sw, sh } = stageSize();
    zoomTo(wholeFitScale(natural.w, natural.h, sw, sh));
  };
  const fitWidth = () => {
    const { sw } = stageSize();
    zoomTo(Math.min(sw / Math.max(1, natural.w), 1));
  };
  const actual = () => zoomTo(1);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={stageRef}
        className="am-img-scroll absolute inset-0"
        onDoubleClick={() => (Math.abs(scale - 1) < 0.01 ? (isLong ? fitWidth() : fitWhole()) : actual())}
      >
        {status !== "error" && src && (
          <div className="am-img-center">
            <img
              src={src}
              alt={pathUtil.name(path)}
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
              style={{ width: natural.w * scale, height: natural.h * scale, boxShadow: "0 12px 48px rgba(0,0,0,0.25)" }}
            />
          </div>
        )}
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-muted">
            <ImageOff size={28} />
            <p className="text-[12.5px]">{t("图片无法加载")}</p>
          </div>
        )}
      </div>

      {status === "ready" && (
        <div className="am-glass absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-elevated/95 px-1 py-1 shadow-menu backdrop-blur-md">
          <button aria-label={t("缩小")} onClick={() => zoomTo(scale / 1.25)} className={btn}><ZoomOut size={14} /></button>
          <span className="min-w-[46px] text-center text-[11px] tabular-nums text-ink-secondary">{Math.round(scale * 100)}%</span>
          <button aria-label={t("放大")} onClick={() => zoomTo(scale * 1.25)} className={btn}><ZoomIn size={14} /></button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button aria-label={t("适应窗口")} onClick={fitWhole} className={btn}><Maximize2 size={14} /></button>
          <button aria-label={t("适应宽度")} onClick={fitWidth} className={btn}><MoveHorizontal size={14} /></button>
          <button aria-label={t("原始尺寸")} onClick={actual} className={btn}><Scan size={14} /></button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button aria-label={t("放大查看")} onClick={() => useLightbox.getState().openImage(src, pathUtil.name(path), path)} className={btn}><ZoomIn size={14} /></button>
          <span className="ml-1 hidden text-[10.5px] tabular-nums text-ink-muted sm:inline">{natural.w} × {natural.h}</span>
        </div>
      )}
    </div>
  );
}

/** 经 IPC 把文件读成 blob URL（WebView2 不拦截自定义协议子资源请求，统一走 blob）。 */
function useBlobUrl(path: string) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    if (!isTauri()) {
      setFailed(true);
      return;
    }
    (async () => {
      try {
        const dataUrl = await invoke<string | null>("images.readDataUrl", { path });
        if (!dataUrl) throw new Error("readDataUrl returned null");
        const blob = await (await fetch(dataUrl)).blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, nonce]);

  return { url, failed, retry: () => setNonce((n) => n + 1) };
}

function PdfViewer({ path }: { path: string }) {
  const { t } = useLang();
  const [ready, setReady] = useState(false);
  const { url, failed, retry } = useBlobUrl(path);

  return (
    <div className="relative min-h-0 flex-1 bg-panel">
      {url && !failed ? (
        <iframe
          src={url}
          title={pathUtil.name(path)}
          className="absolute inset-0 h-full w-full border-0"
          onLoad={() => setReady(true)}
          onError={() => setReady(true)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-ink-muted">
          <FileText size={28} />
          <p className="text-[12.5px] text-ink-secondary">{t("PDF 预览不可用")}</p>
          <p className="max-w-[420px] text-[11.5px] leading-relaxed">{t("可改用系统默认应用打开该 PDF。")}</p>
        </div>
      )}
      {!ready && !failed && url && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        </div>
      )}
      <div className="am-glass absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-elevated/95 px-1 py-1 shadow-menu backdrop-blur-md">
        <button aria-label={t("刷新")} onClick={() => { setReady(false); retry(); }} className={btn}>
          <RefreshCw size={14} />
        </button>
        <button aria-label={t("用系统应用打开")} onClick={() => invoke("shell.openItem", { path }).catch(() => {})} className={btn}>
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

/** 音视频播放：blob URL + 原生 <video>/<audio> 控件。 */
function MediaViewer({ path, kind }: { path: string; kind: "video" | "audio" }) {
  const { t } = useLang();
  const { url, failed, retry } = useBlobUrl(path);
  const openItem = () => invoke("shell.openItem", { path }).catch(() => {});

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-ink-muted">
        {kind === "video" ? <FileVideo size={28} /> : <Music size={28} />}
        <p className="text-[12.5px] text-ink-secondary">{t("无法播放该媒体文件")}</p>
        <p className="max-w-[420px] text-[11.5px] leading-relaxed">{t("文件可能过大、编码不支持或已损坏，可用系统播放器打开。")}</p>
        <button onClick={openItem} className="mt-1 flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-hover">
          <ExternalLink size={12} /> {t("用系统应用打开")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 bg-black/90">
      {url && (kind === "video" ? (
        <video src={url} controls className="absolute inset-0 h-full w-full" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-10">
          <Music size={56} className="text-ink-muted" />
          <p className="max-w-[520px] truncate text-[13px] text-ink-secondary">{pathUtil.name(path)}</p>
          <audio src={url} controls className="w-full max-w-[560px]" />
        </div>
      ))}
      {!url && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        </div>
      )}
      <div className="am-glass absolute bottom-4 right-4 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-elevated/95 px-1 py-1 shadow-menu backdrop-blur-md">
        <button aria-label={t("刷新")} onClick={retry} className={btn}>
          <RefreshCw size={14} />
        </button>
        <button aria-label={t("用系统应用打开")} onClick={openItem} className={btn}>
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

/** 二进制文件（.lnk/.zip/.exe 等）：不读文本，只提示并提供系统打开。 */
function UnsupportedView({ path }: { path: string }) {
  const { t } = useLang();
  const openItem = () => invoke("shell.openItem", { path }).catch(() => useUi.getState().toast(t("无法打开文件"), "warning"));
  return (
    <div className="relative min-h-0 flex-1 bg-panel">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-ink-muted">
        <FileX size={30} />
        <p className="text-[13px] text-ink-secondary">{t("不支持的文件类型")}</p>
        <p className="max-w-[440px] text-[11.5px] leading-relaxed">
          {t("这是二进制文件，以文本打开只会显示乱码。可用系统关联的应用打开。")}
        </p>
        <button onClick={openItem} className="mt-1 flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-hover">
          <ExternalLink size={12} /> {t("用系统应用打开")}
        </button>
      </div>
    </div>
  );
}