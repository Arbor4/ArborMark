/**
 * Windows 自定义标题栏（VS Code 风格）：HTML 菜单栏 + 拖拽区 + 窗口控制按钮。
 *
 * 仅 Windows 生效（无边框窗口，见 windows.rs）；mac / Linux 返回 null，
 * 继续使用原生标题栏 + 原生菜单。菜单数据来自 `menuModel`（Rust menu.dump）。
 *
 * openPath 约定：[0] = 顶层菜单索引；[k>=1] = 第 k-1 层面板中高亮的条目索引。
 * 某条目是子菜单且被高亮时，其子面板立即渲染（子面板自己的高亮位是 openPath[k+1]）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/bridge/ipc";
import { useWorkspace } from "@/stores/workspace";
import { useLang } from "@/bridge/i18n";
import { pathUtil } from "@/bridge/fs";
import {
  execNode,
  installMenuShortcuts,
  loadMenuTree,
  menuTree,
  subscribeMenu,
  type MenuNode,
} from "./menuModel";

const isWindowsUA = typeof navigator !== "undefined" && /Windows NT/.test(navigator.userAgent);

export function useCustomTitlebar(): boolean {
  return isTauri() && isWindowsUA;
}

type OpenPath = number[];

/** 沿 openPath 走到第 idxBase 层面板的条目列表；路径无效时返回 null。 */
function panelItems(tree: MenuNode[], openPath: OpenPath, idxBase: number): MenuNode[] | null {
  let items: MenuNode[] | undefined = tree[openPath[0]]?.items;
  for (let d = 1; d < idxBase; d++) {
    const node = items?.[openPath[d]];
    if (!node || node.type !== "sub") return null;
    items = node.items;
  }
  return items ?? null;
}

/** 当前渲染出来的最深面板的 idxBase（>=1）。 */
function deepestIdxBase(tree: MenuNode[], openPath: OpenPath): number {
  let d = 1;
  for (;;) {
    const items = panelItems(tree, openPath, d);
    if (!items) return d - 1 >= 1 ? d - 1 : 1;
    const node = items[openPath[d]];
    if (node?.type === "sub" && (node.items?.length ?? 0) > 0) d++;
    else return d;
  }
}

function MenuRow({
  node,
  highlighted,
  onHover,
  onExec,
}: {
  node: MenuNode;
  highlighted: boolean;
  onHover: () => void;
  onExec: () => void;
}) {
  const hasSub = node.type === "sub" && (node.items?.length ?? 0) > 0;
  const disabled = node.enabled === false;
  return (
    <div className="relative" onMouseEnter={onHover}>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled && !hasSub) onExec();
        }}
        className={`flex w-full items-center gap-2 rounded px-2 py-[4px] text-left text-[12.5px] ${
          disabled
            ? "cursor-default text-ink-muted opacity-60"
            : highlighted
              ? "bg-hover text-ink"
              : "text-ink hover:bg-hover"
        }`}
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          {node.type === "check" && node.checked ? <Check size={13} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        {node.accel && !hasSub ? (
          <span className="ml-4 shrink-0 text-[11px] tabular-nums text-ink-muted">{node.accel}</span>
        ) : null}
        {hasSub ? <ChevronRight size={12} className="shrink-0 text-ink-muted" /> : null}
      </button>
    </div>
  );
}

function MenuPanel({
  items,
  idxBase,
  openPath,
  setOpenPath,
  onExec,
}: {
  items: MenuNode[];
  idxBase: number;
  openPath: OpenPath;
  setOpenPath: (p: OpenPath) => void;
  onExec: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  const activeIndex = openPath[idxBase];

  // 靠近屏幕右缘时子菜单向左弹出
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.getBoundingClientRect().right > window.innerWidth - 4) setFlip(true);
  }, []);

  return (
    <div
      ref={ref}
      className={`absolute ${idxBase === 1 ? "top-full left-0" : flip ? "right-full -top-1" : "left-full -top-1"} z-50 min-w-[230px] rounded-md border border-line bg-elevated py-1 shadow-menu`}
    >
      {items.map((node, i) => {
        if (node.type === "sep") {
          return <div key={i} className="mx-2 my-1 h-px bg-line" />;
        }
        const hasSub = node.type === "sub" && (node.items?.length ?? 0) > 0;
        const highlighted = activeIndex === i;
        return (
          <div key={i}>
            <MenuRow
              node={node}
              highlighted={highlighted}
              onHover={() => {
                const p = openPath.slice(0, idxBase);
                p[idxBase] = i;
                p.length = idxBase + 1;
                setOpenPath(p);
              }}
              onExec={() => {
                execNode(node);
                onExec();
              }}
            />
            {hasSub && highlighted && (
              <MenuPanel
                items={node.items ?? []}
                idxBase={idxBase + 1}
                openPath={openPath}
                setOpenPath={setOpenPath}
                onExec={onExec}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CaptionIcon({ kind }: { kind: "min" | "max" | "restore" | "close" }) {
  const common = {
    width: 10,
    height: 10,
    viewBox: "0 0 10 10",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1,
  } as const;
  switch (kind) {
    case "min":
      return <svg {...common}><line x1="0" y1="5" x2="10" y2="5" /></svg>;
    case "max":
      return <svg {...common}><rect x="0.5" y="0.5" width="9" height="9" /></svg>;
    case "restore":
      return (
        <svg {...common}>
          <rect x="0.5" y="2.5" width="7" height="7" />
          <path d="M2.5 0.5 h7 v7" />
        </svg>
      );
    case "close":
      return <svg {...common}><path d="M0 0 L10 10 M10 0 L0 10" /></svg>;
  }
}

function CaptionButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex h-full w-[44px] shrink-0 items-center justify-center text-ink transition-colors ${
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const { t } = useLang();
  const activePath = useWorkspace((s) => s.activePath);
  const dirty = useWorkspace((s) => s.dirty);
  const [version, setVersion] = useState(0);
  const [openPath, setOpenPath] = useState<OpenPath>([]);
  const [maximized, setMaximized] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const custom = useCustomTitlebar();

  useEffect(() => {
    if (!custom) return;
    void loadMenuTree();
    const un = subscribeMenu(() => setVersion((v) => v + 1));
    const unKeys = installMenuShortcuts();
    return () => {
      un();
      unKeys();
    };
  }, [custom]);

  const win = useMemo(() => (isTauri() ? getCurrentWindow() : null), []);

  useEffect(() => {
    if (!win) return;
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const bind = (event: string, fn: () => void) => {
      win
        .listen(event, fn)
        .then((u) => {
          if (disposed) u();
          else unlisteners.push(u);
        })
        .catch(() => {});
    };
    bind("resize", () => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    // 失焦时收起展开的菜单（对齐 VS Code 行为）
    bind("blur", () => setOpenPath([]));
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
  }, [win]);

  const tree = useMemo(() => menuTree(), [version]);
  const open = openPath.length > 0;

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenPath([]);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  // 键盘：纯按 Alt 键（在没有与 Tab 等其他键组合时）松开时开关菜单；打开时方向键导航、Enter 执行、Esc 关闭
  const openPathRef = useRef<OpenPath>([]);
  openPathRef.current = openPath;

  useEffect(() => {
    if (!custom) return;

    let altPressed = false;
    let altChained = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (!e.repeat) {
          altPressed = true;
          altChained = false;
        }
        return;
      }

      // 如果按住了 Alt 并且按下了其他键（如 Tab、F4 等），标记为组合键，避免松开 Alt 时误展开菜单
      if (altPressed || e.altKey) {
        altChained = true;
      }

      const current = openPathRef.current;
      if (current.length === 0) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpenPath([]);
        return;
      }
      if (e.key === "ArrowLeft" && current.length === 1) {
        e.preventDefault();
        setOpenPath([Math.max(0, current[0] - 1)]);
        return;
      }
      if (e.key === "ArrowRight" && current.length === 1) {
        e.preventDefault();
        setOpenPath([Math.min(tree.length - 1, current[0] + 1)]);
        return;
      }
      const base = deepestIdxBase(tree, current);
      const items = panelItems(tree, current, base);
      if (!items) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const selectable = items.map((n, i) => ({ n, i })).filter(({ n }) => n.type !== "sep");
        if (selectable.length === 0) return;
        const pos = selectable.findIndex(({ i }) => i === current[base]);
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = selectable[(Math.max(0, pos) + step + selectable.length) % selectable.length];
        const p = current.slice(0, base);
        p[base] = next.i;
        p.length = base + 1;
        setOpenPath(p);
        return;
      }
      const node = items[current[base]];
      if (!node) return;
      if (e.key === "ArrowRight" && node.type === "sub") {
        e.preventDefault();
        const p = current.slice(0, base + 1);
        p[base + 1] = 0;
        p.length = base + 2;
        setOpenPath(p);
        return;
      }
      if (e.key === "ArrowLeft" && base > 1) {
        e.preventDefault();
        setOpenPath(current.slice(0, base));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (node.type === "sub") {
          const p = current.slice(0, base + 1);
          p[base + 1] = 0;
          p.length = base + 2;
          setOpenPath(p);
        } else {
          execNode(node);
          setOpenPath([]);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        // 仅在单独单击 Alt 键、未结合 Tab 或其他按键时才切换菜单展开状态
        if (altPressed && !altChained && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          setOpenPath(openPathRef.current.length > 0 ? [] : [0]);
        }
        altPressed = false;
        altChained = false;
      }
    };

    const onBlur = () => {
      altPressed = false;
      altChained = false;
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [custom, tree]);

  if (!custom) return null;

  const title = activePath ? pathUtil.name(activePath) : "ArborMark";

  return (
    <div
      ref={rootRef}
      className="am-no-print relative z-40 flex h-8 shrink-0 select-none items-stretch bg-panel text-ink"
    >
      {/* 菜单栏 */}
      <div className="flex items-center pl-1">
        {tree.map((menu, i) => (
          <div key={i} className="relative">
            <button
              type="button"
              onClick={() => {
                if (openPath[0] === i) setOpenPath([]);
                else {
                  setOpenPath([i]);
                  void loadMenuTree();
                }
              }}
              onMouseEnter={() => {
                if (open) setOpenPath([i]);
              }}
              className={`flex h-7 items-center rounded px-2.5 text-[12px] transition-colors ${
                openPath[0] === i ? "bg-hover text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink"
              }`}
            >
              {menu.label}
            </button>
            {openPath[0] === i && (
              <MenuPanel
                items={menu.items ?? []}
                idxBase={1}
                openPath={openPath}
                setOpenPath={setOpenPath}
                onExec={() => setOpenPath([])}
              />
            )}
          </div>
        ))}
      </div>

      {/* 拖拽区 + 标题（双击最大化由 tauri 拖拽区内置处理，勿重复绑定） */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center justify-center"
      >
        <span className="pointer-events-none max-w-[60%] truncate px-4 text-[11.5px] text-ink-muted">
          {title}
          {dirty ? " ●" : ""}
        </span>
      </div>

      {/* 窗口控制 */}
      <div className="flex items-stretch">
        <CaptionButton label={t("最小化")} onClick={() => win?.minimize().catch(() => {})}>
          <CaptionIcon kind="min" />
        </CaptionButton>
        <CaptionButton
          label={maximized ? t("还原") : t("最大化")}
          onClick={() => win?.toggleMaximize().catch(() => {})}
        >
          <CaptionIcon kind={maximized ? "restore" : "max"} />
        </CaptionButton>
        <CaptionButton label={t("关闭")} danger onClick={() => win?.close().catch(() => {})}>
          <CaptionIcon kind="close" />
        </CaptionButton>
      </div>
    </div>
  );
}
