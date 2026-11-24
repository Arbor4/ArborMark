import { useCallback, useEffect, useRef, useState } from "react";
import {
  Files,
  ListTree,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeft,
  PenLine,
  Code2,
  ChevronUp,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
  Focus,
  AlignVerticalSpaceAround,
  Check,
} from "lucide-react";
import { useUi, type PanelId } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { useLang } from "@/bridge/i18n";
import { Tooltip } from "./common";
import { getCurrentThemeId, getThemeMode, setThemeMode, isDarkActive, subscribeThemes } from "@/theme/registry";
import { getPreviewKind } from "./editor/codeLanguage";
import { pathUtil } from "@/bridge/fs";
import { useSyncExternalStore } from "react";
import { shouldSuppressClick } from "./files/dragSession";

/* ── 活动栏：左侧图标导航（文件 / 大纲 / 搜索 / 设置） ─────────────────────── */

const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

const ACTIVITY_ITEMS: { id: PanelId; label: string; icon: typeof Files; shortcut: string }[] = [
  { id: "files", label: "文件", icon: Files, shortcut: isMac ? "⌘⇧2" : "Ctrl+Shift+2" },
  { id: "outline", label: "大纲", icon: ListTree, shortcut: isMac ? "⌘⇧1" : "Ctrl+Shift+1" },
];

export function ActivityBar() {
  const panel = useUi((s) => s.panel);
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const setPanel = useUi((s) => s.setPanel);
  const openSettings = useUi((s) => s.openSettings);
  const globalSearchOpen = useUi((s) => s.globalSearchOpen);
  const setGlobalSearch = useUi((s) => s.setGlobalSearch);
  const { t } = useLang();

  return (
    <nav
      aria-label="主导航"
      className="am-glass am-no-print flex h-full w-[52px] shrink-0 flex-col items-center border-r border-line bg-panel py-2.5"
    >
      <div className="flex flex-col gap-1">
        {ACTIVITY_ITEMS.map((item) => {
          const active = panel === item.id && sidebarVisible;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id} label={`${t(`nav.${item.id}`)}  ${item.shortcut}`} side="right">
              <button
                aria-label={t(`nav.${item.id}`)}
                aria-pressed={active}
                onClick={() => setPanel(item.id)}
                className={`relative flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-md transition-all duration-150 ${
                  active
                    ? "bg-active text-accent"
                    : "text-ink-secondary hover:bg-hover hover:text-ink"
                }`}
              >
                {active && (
                  <span className="absolute -left-[7px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
                )}
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span className="text-[8.5px] leading-none tracking-wide">{t(`nav.${item.id}`)}</span>
              </button>
            </Tooltip>
          );
        })}
        <Tooltip label={`${t("nav.search")}  ⌘⇧F`} side="right">
          <button
            aria-label={t("nav.search")}
            aria-pressed={globalSearchOpen}
            onClick={() => setGlobalSearch(true)}
            className={`relative flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-md transition-all duration-150 ${
              globalSearchOpen
                ? "bg-active text-accent"
                : "text-ink-secondary hover:bg-hover hover:text-ink"
            }`}
          >
            {globalSearchOpen && (
              <span className="absolute -left-[7px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
            )}
            <Search size={18} strokeWidth={globalSearchOpen ? 2.2 : 1.8} />
            <span className="text-[8.5px] leading-none tracking-wide">{t("nav.search")}</span>
          </button>
        </Tooltip>
      </div>
      <div className="flex-1" />
      <ThemeModeButton />
      <Tooltip label={`${t("nav.settings")}  ⌘,`} side="right">
        <button
          aria-label={t("nav.settings")}
          onClick={() => openSettings()}
          className="mb-1 flex h-10 w-10 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <Settings size={18} strokeWidth={1.8} />
        </button>
      </Tooltip>
    </nav>
  );
}

function ThemeModeButton() {
  const mode = useSyncExternalStore(subscribeThemes, getThemeMode);
  const dark = useSyncExternalStore(subscribeThemes, isDarkActive);
  const { t } = useLang();
  const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
  const label = mode === "system" ? t("theme.system") : mode === "light" ? t("theme.light") : t("theme.dark");
  const Icon = mode === "system" ? Monitor : dark ? Moon : Sun;
  return (
    <Tooltip label={`${label} · ${t("theme.switch")}`} side="right">
      <button
        aria-label={`${t("nav.appearance")}: ${label}`}
        onClick={() => setThemeMode(next)}
        className="mb-1 flex h-10 w-10 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
      >
        <Icon size={17} strokeWidth={1.8} />
      </button>
    </Tooltip>
  );
}

/* ── 侧边栏容器 + 宽度拖拽 ────────────────────────────────────────────────── */

export function Sidebar({ children }: { children: React.ReactNode }) {
  const visible = useUi((s) => s.sidebarVisible);
  const width = useUi((s) => s.sidebarWidth);
  const setWidth = useUi((s) => s.setSidebarWidth);
  const dragging = useRef(false);
  const asideRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(width);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      pendingRef.current = useUi.getState().sidebarWidth;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      // 拖拽期关闭宽度过渡，直接写 DOM，保证跟手
      if (asideRef.current) asideRef.current.style.transition = "none";
    },
    [],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    // 活动栏宽 52px；拖拽期只写 DOM，不触发 React 渲染/持久化
    const w = Math.min(480, Math.max(200, e.clientX - 52));
    pendingRef.current = w;
    if (asideRef.current) asideRef.current.style.width = `${w}px`;
    if (innerRef.current) {
      innerRef.current.style.width = `${w}px`;
      innerRef.current.style.minWidth = `${w}px`;
    }
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (asideRef.current) asideRef.current.style.transition = "";
      setWidth(pendingRef.current); // 释放时一次性提交 + 持久化
    },
    [setWidth],
  );

  return (
    <aside
      ref={asideRef}
      data-sidebar="1"
      aria-label="侧边栏"
      inert={!visible}
      className="am-glass am-no-print relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-panel transition-[width] duration-200 ease-out select-none"
      style={{ width: visible ? width : 0, borderRightWidth: visible ? 1 : 0 }}
    >
      <div ref={innerRef} className="flex h-full flex-col" style={{ width, minWidth: width }}>
        {children}
      </div>
      {visible && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧边栏宽度"
          className="absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize hover:bg-accent/30 active:bg-accent/50"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => setWidth(264)}
        />
      )}
    </aside>
  );
}

/* ── 面板头部 ─────────────────────────────────────────────────────────────── */

export function PanelHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const { t } = useLang();
  return (
    <header className="flex h-[42px] shrink-0 items-center gap-1 border-b border-line px-3">
      <h2 className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {title}
      </h2>
      {actions}
      <Tooltip label={`${t("收起侧边栏")}  ${isMac ? "⌘\\ / ⌘⇧L" : "Ctrl+\\ / Ctrl+Shift+L"}`}>
        <button
          aria-label={t("收起侧边栏")}
          onClick={toggleSidebar}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <PanelLeftClose size={14} />
        </button>
      </Tooltip>
    </header>
  );
}

/* ── 状态栏 ───────────────────────────────────────────────────────────────── */

export function StatusBar() {
  const activePath = useWorkspace((s) => s.activePath);
  const content = useWorkspace((s) => s.content);
  const dirty = useWorkspace((s) => s.dirty);
  const [savedFlash, setSavedFlash] = useState(false);
  const prevDirty = useRef(dirty);
  useEffect(() => {
    if (prevDirty.current && !dirty) {
      setSavedFlash(true);
      const timer = setTimeout(() => setSavedFlash(false), 1600);
      prevDirty.current = dirty;
      return () => clearTimeout(timer);
    }
    prevDirty.current = dirty;
  }, [dirty]);
  const editorMode = useUi((s) => s.editorMode);
  const setEditorMode = useUi((s) => s.setEditorMode);
  const statusBarVisible = useUi((s) => s.statusBarVisible);
  const wordCountVisible = useUi((s) => s.wordCountVisible);
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const railVisible = useUi((s) => s.railVisible);
  const toggleChrome = useUi((s) => s.toggleChrome);
  const toolbarVisible = useUi((s) => s.toolbarVisible);
  const toggleToolbar = useUi((s) => s.toggleToolbar);
  const focusMode = useUi((s) => s.focusMode);
  const toggleFocus = useUi((s) => s.toggleFocusMode);
  const typewriter = useUi((s) => s.typewriterMode);
  const toggleTypewriter = useUi((s) => s.toggleTypewriterMode);
  const metric = useUi((s) => s.prefs.statusMetric ?? "words");
  const setPref = useUi((s) => s.setPref);
  const { t } = useLang();
  const chromeVisible = sidebarVisible || railVisible;

  const [metricOpen, setMetricOpen] = useState(false);
  const metricRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!metricOpen) return;
    const onDown = (e: MouseEvent) => { if (metricRef.current && !metricRef.current.contains(e.target as Node)) setMetricOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMetricOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [metricOpen]);

  // 性能优化：字数分词与行数统计在浏览器空闲调度（requestIdleCallback）或微防抖计算，杜绝打字主线程卡顿
  const [metrics, setMetrics] = useState(() => ({
    words: countWords(content),
    chars: content.length,
    lines: content ? content.split("\n").length : 0,
  }));

  useEffect(() => {
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | number | null = null;

    const compute = () => {
      if (cancelled) return;
      const w = countWords(content);
      const c = content.length;
      const l = content ? content.split("\n").length : 0;
      setMetrics({ words: w, chars: c, lines: l });
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      handle = (window as Window & { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback(compute, { timeout: 350 });
    } else {
      handle = setTimeout(compute, 200);
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && "cancelIdleCallback" in window && typeof handle === "number") {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(handle);
      } else if (handle) {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    };
  }, [content]);

  const { words, chars, lines } = metrics;
  const readMinutes = Math.max(1, Math.round(words / 380));
  const metricLabel = metric === "chars" ? `${chars} ${t("status.chars")}` : metric === "lines" ? `${lines} ${t("status.lines")}` : `${words} ${t("status.words")}`;
  const previewName = activePath ? pathUtil.name(activePath) : "";
  const previewKind = getPreviewKind(previewName);
  const isPreview = previewKind !== null;

  if (!statusBarVisible) return null;

  const quickBtn = (active: boolean) =>
    `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover ${active ? "bg-accent-soft text-accent" : "text-ink-secondary hover:text-ink"}`;

  return (
    <footer className="am-no-print pointer-events-none absolute inset-x-0 bottom-0 z-30 flex h-[36px] items-center justify-between px-2 text-[11px] text-ink-secondary">
      {/* 左下角：默认隐藏，悬停该区域显现 */}
      <div className="group pointer-events-auto flex items-center gap-1 rounded-md px-1 py-0.5">
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <Tooltip label={chromeVisible ? `${t("status.collapseSidebar")}  ⌘\\` : `${t("status.expandSidebar")}  ⌘\\`} side="top">
            <button
              aria-label={chromeVisible ? t("status.collapseSidebar") : t("status.expandSidebar")}
              aria-pressed={chromeVisible}
              onClick={toggleChrome}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-ink"
            >
              {chromeVisible ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
            </button>
          </Tooltip>
          <Tooltip label={editorMode === "edit" ? `${t("status.toggleSource")}  ⌘/` : `${t("status.toggleEdit")}  ⌘/`} side="top">
            <button
              aria-label={editorMode === "edit" ? t("status.toggleSource") : t("status.toggleEdit")}
              onClick={() => setEditorMode(editorMode === "edit" ? "source" : "edit")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-hover hover:text-ink"
            >
              {editorMode === "edit" ? <PenLine size={14} /> : <Code2 size={14} />}
            </button>
          </Tooltip>
          <Tooltip label={toolbarVisible ? t("status.collapseToolbar") : t("status.expandToolbar")} side="top">
            <button
              aria-label={toolbarVisible ? t("status.collapseToolbar") : t("status.expandToolbar")}
              aria-pressed={toolbarVisible}
              onClick={toggleToolbar}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-ink"
            >
              {toolbarVisible ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>
      {/* 右下角：快捷开关 + 单指标字数（点击展开详情） */}
      <div className="group pointer-events-auto flex items-center gap-1">
        {activePath && (
          <span className="hidden max-w-[160px] truncate px-1 xl:inline" title={activePath}>
            {activePath.split("/").pop()}
          </span>
        )}
        <div
          className={`flex items-center gap-1 overflow-hidden transition-all duration-200 ${
            focusMode || typewriter
              ? "visible max-w-[76px] opacity-100"
              : "invisible max-w-0 opacity-0 group-hover:visible group-hover:max-w-[76px] group-hover:opacity-100"
          }`}
        >
          <Tooltip label={`${t("status.focus")} ⌘⇧D`} side="top">
            <button aria-label={t("status.focus")} aria-pressed={focusMode} onClick={toggleFocus} className={quickBtn(focusMode)}>
              <Focus size={13} />
            </button>
          </Tooltip>
          <Tooltip label={t("status.typewriter")} side="top">
            <button aria-label={t("status.typewriter")} aria-pressed={typewriter} onClick={toggleTypewriter} className={quickBtn(typewriter)}>
              <AlignVerticalSpaceAround size={13} />
            </button>
          </Tooltip>
        </div>
        {savedFlash && !isPreview && (
          <span className="am-pop-in flex items-center gap-1 px-1.5 text-[11px] text-ok" aria-live="polite">
            <Check size={11} /> {t("已保存")}
          </span>
        )}
        {isPreview && (
          <span className="px-2 text-[11px] text-ink-muted">
            {previewKind === "image" ? t("图片预览")
              : previewKind === "pdf" ? "PDF"
              : previewKind === "video" ? t("视频预览")
              : previewKind === "audio" ? t("音频预览")
              : t("不支持的文件类型")}
          </span>
        )}
        {wordCountVisible && !isPreview && (
          <div ref={metricRef} className="relative">
            <button
              aria-label={t("status.metric")}
              aria-expanded={metricOpen}
              onClick={() => setMetricOpen((v) => !v)}
              className="flex h-6 shrink-0 items-center gap-1 rounded-md px-2 tabular-nums transition-colors hover:bg-hover hover:text-ink"
            >
              {metricLabel}
              <ChevronUp size={11} className={`opacity-60 transition-transform ${metricOpen ? "" : "rotate-180"}`} />
            </button>
            {metricOpen && (
              <div className="am-pop-in absolute bottom-8 right-0 z-40 w-[168px] rounded-lg border border-line bg-elevated p-1 shadow-menu">
                {([["words", `${words} ${t("status.words")}`], ["chars", `${chars} ${t("status.chars")}`], ["lines", `${lines} ${t("status.lines")}`]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setPref("statusMetric", key); setMetricOpen(false); }}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-hover ${metric === key ? "text-accent" : "text-ink"}`}
                  >
                    {label}
                    {metric === key && <Check size={12} />}
                  </button>
                ))}
                <div className="mx-2 my-1 h-px bg-line" />
                <p className="px-2.5 py-1 text-[11px] text-ink-muted">{t("status.readMin", { n: readMinutes })}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}

function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latin = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ").match(/[A-Za-z0-9_'-]+/g) || []).length;
  return cjk + latin;
}

/* 窗口焦点时刷新文件树（外部改动兜底） */
export function useFocusRefresh() {
  const refresh = useWorkspace((s) => s.refresh);
  useEffect(() => {
    const onFocus = () => {
      // 拖拽移动或压制窗口内严禁并发刷新，避免覆盖正在展开/更新的树
      if (shouldSuppressClick()) return;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
}