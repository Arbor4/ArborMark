import type { DragEvent as ReactDragEvent } from "react";
import { pathUtil } from "@/bridge/fs";
import { isTauri } from "@/bridge/ipc";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { canMoveInto, isMoving, normalizePath } from "./fileOps";

export const isMacUA = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);
/** 仅 macOS 桌面端启用原生拖出（让文件能直接拖出到系统访达/桌面），其它平台走标准 HTML5 拖拽。 */
export const nativeFileDrag = isTauri() && isMacUA;

export interface DragSession {
  paths: string[];
  label: string;
  isDir: boolean;
  startedAt: number;
}

let session: DragSession | null = null;
let lastSession: { paths: string[]; endedAt: number } | null = null;

export const dragSession = {
  get: () => session,
  begin(paths: string[], label: string, isDir = false) {
    session = { paths, label, isDir, startedAt: performance.now() };
  },
  end() {
    if (session) {
      lastSession = { paths: session.paths, endedAt: performance.now() };
    }
    session = null;
  },
  /** 检查这批路径是否在最近 1.5 秒内由当前应用内部拖拽发起（防止原生事件乱序导致 session 丢失）。 */
  wasRecentlyInternal(paths: string[]): boolean {
    if (session) return true;
    if (!lastSession) return false;
    if (performance.now() - lastSession.endedAt > 1500) return false;
    const normLast = new Set(lastSession.paths.map(normalizePath));
    return paths.some((p) => normLast.has(normalizePath(p)));
  },
};

/* ── 原生坐标 → 视口 CSS Client 坐标 ─────────────────────────────────────── */

/**
 * 获取系统标题栏高度。浏览器环境按 outer/inner 高度差估算。
 */
export function getTitleBarHeight(): number {
  if (typeof window === "undefined") return 0;
  const diff = window.outerHeight - window.innerHeight;
  if (diff > 0 && diff < 120) return diff;
  return isMacUA ? 28 : 0;
}

/**
 * 将 Tauri 原生 onDragDropEvent 坐标转换为 DOM client 视口坐标：
 * - macOS: 原生上报的 position 1:1 对齐客户区视口；
 * - Windows / Linux: 原生上报的是物理像素（PhysicalPosition），需除以 devicePixelRatio 转换为逻辑像素。
 */
export function toClientPoint(p: { x: number; y: number }): { x: number; y: number } {
  if (isMacUA) {
    return {
      x: Math.max(0, p.x),
      y: Math.max(0, p.y),
    };
  }
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.max(0, p.x / dpr),
    y: Math.max(0, p.y / dpr),
  };
}

/** 预取拖出插件，避免第一次拖拽时等待动态 import。 */
export async function primeNativeMetrics() {
  if (!nativeFileDrag) return;
  void import("@crabnebula/tauri-plugin-drag");
}

/* ── 指针指尖精准命中与落点解析 ─────────────────────────────────────────── */

export interface DropResolution {
  /** 鼠标指针正下方命中的具体节点路径（无论是文件夹还是文件） */
  hoveredPath: string | null;
  /** 放手后即将移入的目标文件夹（文件夹自身 / 文件的父目录 / 根目录） */
  targetDir: string | null;
  /** 命中的节点本身是否是文件夹 */
  isDir: boolean;
}

export function sidebarElementAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  return (el?.closest?.("aside[data-sidebar]") as HTMLElement | null) ?? null;
}

/**
 * 基于鼠标光标指针指尖位置的精细落点解析：
 * 采用多点容错采样，确保无论点击在树行最左侧的缩进处还是文字处，都能精准捕获当前行。
 */
export function resolveDropAt(x: number, y: number, rootPath: string | null): DropResolution {
  const aside = sidebarElementAt(x, y);
  if (!aside) {
    return { hoveredPath: null, targetDir: null, isDir: false };
  }

  // 1. 指尖直接命中采样
  let el = document.elementFromPoint(x, y);
  let row = el?.closest?.("[data-path]") as HTMLElement | null;

  // 2. 缩进容错采样：如果指尖点在左侧留白/树枝间距处，往节点内容区（x + 30）做一次备用探测
  if (!row) {
    const fallbackEl = document.elementFromPoint(Math.max(x, 60), y);
    if (fallbackEl && fallbackEl.closest("aside[data-sidebar]")) {
      row = fallbackEl.closest("[data-path]") as HTMLElement | null;
    }
  }

  const path = row?.dataset.path;
  if (!path) {
    // 鼠标在侧边栏底部的留白或空白区域：落点为根目录
    return { hoveredPath: null, targetDir: rootPath, isDir: false };
  }

  const isDir = row!.dataset.isdir === "1";
  const targetDir = isDir
    ? path
    : row!.closest('[role="list"]')
      ? rootPath
      : pathUtil.parent(path);

  return { hoveredPath: path, targetDir, isDir };
}

/** 便捷兼容包装：获取落点目标目录。 */
export function dropDirAt(x: number, y: number, rootPath: string | null): string | null {
  return resolveDropAt(x, y, rootPath).targetDir;
}

/* ── 拖拽边缘自动滚动（Auto-Scroller） ─────────────────────────────────────── */

class AutoScroller {
  private container: HTMLElement | null = null;
  private animId: number | null = null;
  private speed = 0;
  private onScrollTick: (() => void) | null = null;

  attach(container: HTMLElement | null, onScrollTick?: () => void) {
    this.container = container;
    this.onScrollTick = onScrollTick ?? null;
  }

  update(clientY: number) {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    const zone = 44; // 边缘触发感应区（44px）
    const maxSpeed = 15; // 最大滚动速度（px/frame）

    if (clientY >= rect.top && clientY <= rect.top + zone) {
      // 靠近顶部：平滑向上滚动
      const factor = 1 - (clientY - rect.top) / zone;
      this.speed = -Math.max(2, Math.round(factor * maxSpeed));
      this.startLoop();
    } else if (clientY <= rect.bottom && clientY >= rect.bottom - zone) {
      // 靠近底部：平滑向下滚动
      const factor = 1 - (rect.bottom - clientY) / zone;
      this.speed = Math.max(2, Math.round(factor * maxSpeed));
      this.startLoop();
    } else {
      this.stop();
    }
  }

  stop() {
    this.speed = 0;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  private startLoop() {
    if (this.animId !== null) return;
    const loop = () => {
      if (this.speed !== 0 && this.container) {
        this.container.scrollTop += this.speed;
        this.onScrollTick?.();
        this.animId = requestAnimationFrame(loop);
      } else {
        this.animId = null;
      }
    };
    this.animId = requestAnimationFrame(loop);
  }
}

export const autoScroller = new AutoScroller();

/* ── 悬停自动展开（弹簧文件夹） ─────────────────────────────────────────── */

let springTimer: ReturnType<typeof setTimeout> | null = null;
let springDir: string | null = null;
let springDone = false;

export function clearSpring() {
  if (springTimer) {
    clearTimeout(springTimer);
    springTimer = null;
  }
  springDir = null;
  springDone = false;
}

export function scheduleSpring(dir: string | null) {
  if (dir !== springDir) {
    clearSpring();
    springDir = dir;
  }
  if (!dir || springDone) return;
  const ws = useWorkspace.getState();
  if (dir === ws.rootPath || ws.expanded.has(dir)) return;
  springTimer = setTimeout(() => {
    springTimer = null;
    springDone = true;
    // 必须使用 expandFolder 单向展开，绝不能使用 toggleExpand 引起反向收缩
    useWorkspace.getState().expandFolder(dir);
  }, 600);
}

/* ── HTML5 拖拽（浏览器 / Windows 辅助） ────────────────────────────────── */

export function beginHtml5Drag(
  e: ReactDragEvent,
  paths: string[],
  label: string,
  isDir = false,
) {
  dragSession.begin(paths, label, isDir);
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/x-arbor-paths", JSON.stringify(paths));
  const ghost = document.createElement("div");
  ghost.className = "am-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 12, 14);
  setTimeout(() => ghost.remove(), 0);
}

/* ── 原生拖出（macOS 桌面端） ─────────────────────────────────────────────── */

let nativeDragEndedAt = 0;
let suppressClickUntil = 0;
const endListeners = new Set<() => void>();

export function onNativeDragEnd(fn: () => void) {
  endListeners.add(fn);
  return () => {
    endListeners.delete(fn);
  };
}

/** 在拖拽中及拖拽结束后的时间窗口内强力抑制 DOM 点击，彻底杜绝松手时误触发文件树点击事件。 */
export function suppressClicks(duration = 1200) {
  suppressClickUntil = Math.max(suppressClickUntil, performance.now() + duration);
  nativeDragEndedAt = Math.max(nativeDragEndedAt, performance.now());
}

export function shouldSuppressClick(): boolean {
  return (
    dragSession.get() !== null ||
    isMoving() ||
    performance.now() < suppressClickUntil ||
    performance.now() - nativeDragEndedAt < 1200
  );
}

export function nativeDragJustEnded(): boolean {
  return shouldSuppressClick();
}

if (typeof window !== "undefined") {
  // 在 window 顶层捕获阶段截杀所有拖拽期间与拖拽结束瞬间的合成事件，绝不向下传递给组件
  const intercept = (e: Event) => {
    if (shouldSuppressClick()) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };

  window.addEventListener("click", intercept, true);
  window.addEventListener("mouseup", intercept, true);
  window.addEventListener(
    "pointerup",
    (e) => {
      if (dragSession.get()) {
        suppressClicks(1200);
      }
      intercept(e);
    },
    true,
  );
  window.addEventListener("contextmenu", intercept, true);
}

const previewCache = new Map<string, string>();

/** 拖拽预览图标：自绘高清 PNG。 */
export function dragPreview(label: string, count: number, isDir: boolean): string {
  const key = `${isDir ? "d" : "f"}:${Math.min(count, 99)}:${label}`;
  const cached = previewCache.get(key);
  if (cached) return cached;

  const size = 72;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue("--am-accent").trim() || "#4f7cff";

  g.clearRect(0, 0, size, size);
  g.save();
  g.shadowColor = "rgba(0, 0, 0, 0.28)";
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;

  if (isDir) {
    g.fillStyle = "#f2b64c";
    g.beginPath();
    g.roundRect(10, 20, 52, 38, 6);
    g.fill();
    g.beginPath();
    g.roundRect(10, 14, 24, 14, 5);
    g.fill();
    g.restore();
    g.fillStyle = "rgba(255, 255, 255, 0.35)";
    g.beginPath();
    g.roundRect(14, 26, 44, 6, 3);
    g.fill();
  } else {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.roundRect(16, 8, 40, 54, 6);
    g.fill();
    g.restore();
    g.fillStyle = accent;
    g.beginPath();
    g.roundRect(16, 8, 7, 54, [6, 0, 0, 6]);
    g.fill();
    g.strokeStyle = "#d6d9e0";
    g.lineWidth = 2.5;
    g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(29, 24 + i * 10);
      g.lineTo(48, 24 + i * 10);
      g.stroke();
    }
  }

  if (count > 1) {
    g.fillStyle = accent;
    g.beginPath();
    g.arc(56, 56, 12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255, 255, 255, 0.95)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#fff";
    g.font = "bold 12px -apple-system, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(count > 99 ? "99+" : String(count), 56, 56.5);
  }

  const url = canvas.toDataURL("image/png");
  previewCache.set(key, url);
  return url;
}

async function startNativeFileDrag(paths: string[], label: string, isDir: boolean) {
  window.getSelection()?.removeAllRanges();
  dragSession.begin(paths, label, isDir);
  const finish = () => {
    suppressClicks(750);
    endListeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  };

  const guard = setTimeout(() => {
    if (dragSession.get()?.paths === paths) dragSession.end();
    finish();
  }, 30_000);

  try {
    const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
    await startDrag(
      {
        item: paths,
        icon: dragPreview(label, paths.length, isDir),
        mode: "copy",
      },
      () => {
        suppressClicks(750);
        setTimeout(() => {
          clearTimeout(guard);
          if (dragSession.get()?.paths === paths) dragSession.end();
          finish();
        }, 400);
      },
    );
  } catch (err) {
    clearTimeout(guard);
    console.error("[drag] 原生拖拽启动失败", err);
    useUi.getState().toast("拖拽启动失败", "danger");
    dragSession.end();
    finish();
  }
}

/**
 * 在文件树节点上按下鼠标后，移动超过 5px 才启动原生拖拽：
 * 避免影响普通点击/双击/多选选择，拖拽手势交给 AppKit。
 */
export function armNativeDrag(
  e: { button: number; clientX: number; clientY: number; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  candidate: () => { paths: string[]; label: string; isDir: boolean },
) {
  if (!nativeFileDrag || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
  // 彻底避免三指拖移/滑动或长按误触文字选中
  window.getSelection()?.removeAllRanges();
  const startX = e.clientX;
  const startY = e.clientY;
  let done = false;

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
  };
  const onUp = () => {
    done = true;
    cleanup();
  };
  const onMove = (ev: PointerEvent) => {
    if (done) return;
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
    done = true;
    cleanup();
    window.getSelection()?.removeAllRanges();
    const { paths, label, isDir } = candidate();
    if (paths.length) void startNativeFileDrag(paths, label, isDir);
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
}
