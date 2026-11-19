import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ChevronRight,
  FilePlus2,
  FolderPlus,
  RefreshCw,
  LocateFixed,
  FolderOpen,
  Folder,
  FileText,
  FileCode2,
  FileImage,
  File as FileIcon,
  History,
  List,
  Network,
  ChevronsDownUp,
  Copy,
  Link as LinkIcon,
  PencilLine,
  Trash2,
  ExternalLink,
  FolderInput,
  Check,
  Pin,
  Scissors,
  ClipboardPaste,
  AppWindow,
} from "lucide-react";
import { useWorkspace, flattenVisible, prefetchDir, type TreeNode } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { fs, pathUtil } from "@/bridge/fs";
import { isTauri, invoke } from "@/bridge/ipc";
import { ContextMenu, EmptyState, Tooltip, type MenuItem } from "../common";
import { PanelHeader } from "../layout";
import { useLang } from "@/bridge/i18n";
import {
  armNativeDrag,
  autoScroller,
  beginHtml5Drag,
  clearSpring,
  dragSession,
  nativeDragJustEnded,
  nativeFileDrag,
  onNativeDragEnd,
  primeNativeMetrics,
  resolveDropAt,
  scheduleSpring,
  shouldSuppressClick,
  sidebarElementAt,
  suppressClicks,
  toClientPoint,
} from "./dragSession";
import {
  canMoveInto,
  hasFileClipboard,
  importPaths,
  isInsideWorkspace,
  movePaths,
  pasteFileClipboard,
  setFileClipboard,
} from "./fileOps";

/* ── 文件图标 ─────────────────────────────────────────────────────────────── */

function FileGlyph({ name, size = 14 }: { name: string; size?: number }) {
  const ext = pathUtil.ext(name);
  if (["md", "markdown", "mdown", "txt"].includes(ext))
    return <FileText size={size} className="shrink-0 text-accent opacity-80" />;
  if (["ts", "js", "tsx", "jsx", "json", "rs", "py", "go", "css", "html", "sh", "yml", "yaml", "toml"].includes(ext))
    return <FileCode2 size={size} className="shrink-0 text-info opacity-80" />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(ext))
    return <FileImage size={size} className="shrink-0 text-warn opacity-80" />;
  return <FileIcon size={size} className="shrink-0 text-ink-muted" />;
}

/* ── 内联重命名输入 ───────────────────────────────────────────────────────── */

function RenameInput({
  node,
  onDone,
}: {
  node: TreeNode;
  onDone: () => void;
}) {
  const { t } = useLang();
  const rename = useWorkspace((s) => s.rename);
  const toast = useUi((s) => s.toast);
  const [value, setValue] = useState(node.name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const dot = node.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 && !node.isDir ? dot : node.name.length);
  }, [node]);

  const commit = async () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== node.name) {
      const ok = await rename(node.path, trimmed);
      if (ok) toast(`已重命名为 ${trimmed}`, "success");
    }
    onDone();
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onDone();
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-[20px] w-full min-w-0 rounded border border-accent bg-field px-1 text-[12.5px] text-ink outline-none"
      aria-label={t("重命名")}
    />
  );
}

/* ── 树节点 ───────────────────────────────────────────────────────────────── */

function TreeRow({
  node,
  depth,
  renaming,
  setRenaming,
  onContextMenu,
  dropTarget,
  hoveredPath,
  onNodeDragOver,
}: {
  node: TreeNode;
  depth: number;
  renaming: string | null;
  setRenaming: (path: string | null) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  dropTarget: string | null;
  hoveredPath: string | null;
  onNodeDragOver: (node: TreeNode, e: DragEvent) => void;
}) {
  const expanded = useWorkspace((s) => s.expanded);
  const selected = useWorkspace((s) => s.selected);
  const activePath = useWorkspace((s) => s.activePath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const select = useWorkspace((s) => s.select);
  const openFile = useWorkspace((s) => s.openFile);
  const { t } = useLang();

  const isOpen = expanded.has(node.path);
  const isSelected = selected.has(node.path);
  const isActive = activePath === node.path;

  // 悬停高亮判定：
  // 1. 文件夹高亮：当前落点目标为该文件夹（全局唯一明确目标容器）
  const isDropFolder = node.isDir && dropTarget === node.path;
  // 2. 指尖正下方悬停项（轻度指示，避免双绿框冲突）
  const isHoveredItem = hoveredPath === node.path && !isDropFolder;

  const [limit, setLimit] = useState(200);

  // 冷目录枚举占位行：仅提示，不可交互
  if (node.loading) {
    return (
      <div
        className="flex h-[26px] items-center text-[11.5px] italic text-ink-muted"
        style={{ paddingLeft: 8 + depth * 14 + 20 }}
      >
        {t("载入中…")}
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    if (shouldSuppressClick() || nativeDragJustEnded()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      select(node.path, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
      return;
    }
    select(node.path);
    if (node.isDir) {
      toggleExpand(node.path);
    } else {
      openFile(node.path);
    }
  };

  /* 拖拽路径集合：拖已选中的项带上整个选区，否则只拖当前项并选中它。 */
  const dragPaths = () => {
    const state = useWorkspace.getState();
    if (!state.selected.has(node.path) || state.selected.size <= 1) {
      state.selectOnly(node.path);
      return [node.path];
    }
    return [...state.selected];
  };

  const handleDragStart = (e: DragEvent) => {
    if (nativeFileDrag || renaming === node.path) return;
    const paths = dragPaths();
    beginHtml5Drag(e, paths, paths.length > 1 ? `${paths.length} 个项目` : node.name, node.isDir);
  };

  return (
    <div role="treeitem" aria-expanded={node.isDir ? isOpen : undefined} aria-selected={isSelected}>
      <div
        draggable={!nativeFileDrag && renaming !== node.path}
        data-path={node.path}
        data-isdir={node.isDir ? "1" : "0"}
        onPointerDown={(e) => {
          if (renaming === node.path) return;
          armNativeDrag(e, () => {
            const paths = dragPaths();
            return {
              paths,
              label: paths.length > 1 ? `${paths.length} 个项目` : node.name,
              isDir: node.isDir,
            };
          });
        }}
        onDragStart={handleDragStart}
        onMouseEnter={() => {
          // 悬停即预取目录内容，点击展开时数据已就绪
          if (node.isDir && !isOpen && node.children === null) prefetchDir(node.path);
        }}
        onDragOver={(e) => onNodeDragOver(node, e)}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        onDoubleClick={() => !node.isDir && openFile(node.path)}
        className={`group relative flex h-[28px] cursor-default select-none items-center gap-1.5 rounded-md pr-2 text-[12.5px] transition-colors duration-100 ${
          isDropFolder
            ? "am-drop-target"
            : isHoveredItem
              ? "bg-hover text-ink"
              : isActive
                ? "bg-active text-ink"
                : isSelected
                  ? "bg-accent-soft text-ink"
                  : "text-ink-secondary hover:bg-hover hover:text-ink"
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.path}
      >
        {isActive && !isDropFolder && (
          <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
        )}
        {node.isDir ? (
          <ChevronRight
            size={13}
            className={`shrink-0 text-ink-muted transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {node.isDir ? (
          isOpen ? (
            <FolderOpen size={14} className={`shrink-0 ${isDropFolder ? "text-accent" : "text-warn"}`} />
          ) : (
            <Folder size={14} className={`shrink-0 ${isDropFolder ? "text-accent" : "text-warn opacity-80"}`} />
          )
        ) : (
          <FileGlyph name={node.name} />
        )}
        {renaming === node.path ? (
          <RenameInput node={node} onDone={() => setRenaming(null)} />
        ) : (
          <span className={`truncate select-none ${isActive ? "font-medium" : ""}`}>
            {node.isDir ? node.name : pathUtil.stem(node.name)}
            {!node.isDir && node.name.includes(".") && (
              <span className="opacity-45 select-none">{node.name.slice(node.name.lastIndexOf("."))}</span>
            )}
          </span>
        )}
        {isSelected && selected.size > 1 && (
          <Check size={12} className="ml-auto shrink-0 text-accent" />
        )}
      </div>
      {node.isDir && isOpen && node.children && (
        <div role="group">
          {node.children.length === 0 ? (
            <p
              className="py-1 text-[11px] italic text-ink-muted"
              style={{ paddingLeft: 8 + (depth + 1) * 14 + 20 }}
            >
              {t("空文件夹")}
            </p>
          ) : (
            <>
              {node.children.slice(0, limit).map((child) => (
                <TreeRow
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  renaming={renaming}
                  setRenaming={setRenaming}
                  onContextMenu={onContextMenu}
                  dropTarget={dropTarget}
                  hoveredPath={hoveredPath}
                  onNodeDragOver={onNodeDragOver}
                />
              ))}
              {node.children.length > limit && (
                <button
                  onClick={() => setLimit((l) => l + 500)}
                  className="block w-full py-1 text-left text-[11px] italic text-ink-muted hover:text-ink"
                  style={{ paddingLeft: 8 + (depth + 1) * 14 + 20 }}
                >
                  {t("还有 {n} 项，点击加载", { n: node.children.length - limit })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 外部文件导入（浏览器 File API；Tauri 桌面端走原生拖拽事件） ─────────────── */

async function importExternalFiles(files: File[], targetDir: string) {
  const toast = useUi.getState().toast;
  let count = 0;
  let skipped = 0;
  for (const file of files) {
    const dest = pathUtil.join(targetDir, file.name);
    if ((await fs.stat(dest)).exists) {
      skipped++;
      continue;
    }
    await fs.writeFile(dest, await file.text());
    count++;
  }
  if (count) {
    await useWorkspace.getState().refresh();
    toast(
      skipped ? `已导入 ${count} 个文件，${skipped} 个同名文件已跳过` : `已导入 ${count} 个文件`,
      "success",
    );
  } else if (skipped) {
    toast("同名文件已存在，未导入", "info");
  }
}

/* ── 文件面板 ─────────────────────────────────────────────────────────────── */

const isWindowsPlatform = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const isMacPlatform = typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent);

function getRevealInFolderLabel(t: (k: string) => string): string {
  if (isWindowsPlatform) return t("在文件资源管理器中显示");
  if (isMacPlatform) return t("在访达中显示");
  return t("在文件管理器中显示");
}

export function FilePanel() {
  const { t, lang } = useLang();
  const tree = useWorkspace((s) => s.tree);
  const activePath = useWorkspace((s) => s.activePath);
  const rootPath = useWorkspace((s) => s.rootPath);
  const rootName = useWorkspace((s) => s.rootName);
  const loading = useWorkspace((s) => s.loading);
  const recentFolders = useWorkspace((s) => s.recentFolders);
  const refresh = useWorkspace((s) => s.refresh);
  const openFolder = useWorkspace((s) => s.openFolder);
  const createFile = useWorkspace((s) => s.createFile);
  const createFolder = useWorkspace((s) => s.createFolder);
  const trash = useWorkspace((s) => s.trash);
  const duplicate = useWorkspace((s) => s.duplicate);
  const openFile = useWorkspace((s) => s.openFile);
  const selected = useWorkspace((s) => s.selected);
  const toast = useUi((s) => s.toast);

  const [view, setView] = useState<"tree" | "list">("tree");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef<HTMLDivElement>(null);

  // 最近文件夹下拉：外部点击、焦点移出、Esc、窗口失焦时收起
  useEffect(() => {
    if (!recentOpen) return;
    const node = recentRef.current;
    const onPointerDown = (e: PointerEvent) => {
      if (!node?.contains(e.target as Node)) setRecentOpen(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget && !node?.contains(e.relatedTarget as Node)) setRecentOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRecentOpen(false);
    };
    const onBlur = () => setRecentOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    node?.addEventListener("focusout", onFocusOut);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      node?.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", onBlur);
    };
  }, [recentOpen]);

  // 状态：落点目录与指尖直接悬停的节点
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const dropTargetRef = useRef<string | null>(null);
  const hoveredPathRef = useRef<string | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const applyDropInfo = useCallback((targetDir: string | null, hovered: string | null) => {
    const session = dragSession.get();
    if (targetDir && session && !canMoveInto(session.paths, targetDir)) {
      targetDir = null;
    }
    dropTargetRef.current = targetDir;
    hoveredPathRef.current = hovered;
    setDropTarget(targetDir);
    setHoveredPath(hovered);
  }, []);

  const clearDropInfo = useCallback(() => {
    applyDropInfo(null, null);
    clearSpring();
    autoScroller.stop();
  }, [applyDropInfo]);

  const [listSort, setListSort] = useState<"name" | "mtime">("name");
  const containerRef = useRef<HTMLDivElement>(null);

  // 挂载边缘自动滚动监听
  useEffect(() => {
    autoScroller.attach(containerRef.current, () => {
      // 每一帧滚动时，根据最后已知的鼠标指尖位置实时刷新高亮落点
      const { x, y } = lastMousePosRef.current;
      if (x > 0 || y > 0) {
        const res = resolveDropAt(x, y, useWorkspace.getState().rootPath);
        applyDropInfo(res.targetDir, res.hoveredPath);
        scheduleSpring(res.targetDir);
      }
    });
    return () => autoScroller.stop();
  }, [applyDropInfo]);

  const flatFiles = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) walk(n.children);
        } else out.push(n);
      }
    };
    walk(tree);
    return out.sort((a, b) =>
      listSort === "name" ? a.name.localeCompare(b.name, "zh") : b.mtime - a.mtime,
    );
  }, [tree, listSort]);

  const openFolderDialog = useCallback(async () => {
    const result = await fs.openFolderDialog();
    if (!result.canceled && result.filePaths[0]) {
      await openFolder(result.filePaths[0]);
    }
  }, [openFolder]);

  const buildMenu = useCallback(
    (node: TreeNode | null): MenuItem[] => {
      const ws = useWorkspace.getState();
      const targets = node
        ? ws.selected.has(node.path) && ws.selected.size > 1
          ? [...ws.selected]
          : [node.path]
        : [];
      const parentDir = node?.isDir ? node.path : node ? pathUtil.parent(node.path) : rootPath;
      const items: MenuItem[] = [];
      if (node && !node.isDir) {
        items.push({
          id: "open",
          label: t("打开"),
          icon: <FileText size={13} />,
          shortcut: "↵",
          run: () => openFile(node.path),
        });
      }
      if (node) {
        items.push(
          {
            id: "rename",
            label: t("重命名"),
            icon: <PencilLine size={13} />,
            shortcut: "F2",
            disabled: targets.length > 1,
            run: () => setRenaming(node.path),
          },
          {
            id: "duplicate",
            label: t("创建副本"),
            icon: <Copy size={13} />,
            disabled: targets.length > 1,
            run: () => duplicate(node.path),
          },
          {
            id: "copy-file",
            label: targets.length > 1 ? `复制 ${targets.length} 个项目` : t("复制文件"),
            icon: <Copy size={13} />,
            shortcut: "⌘C",
            run: () => {
              setFileClipboard(targets, "copy");
              toast(`已复制 ${targets.length} 个项目`, "success");
            },
          },
          {
            id: "cut-file",
            label: targets.length > 1 ? `剪切 ${targets.length} 个项目` : t("剪切文件"),
            icon: <Scissors size={13} />,
            shortcut: "⌘X",
            run: () => {
              setFileClipboard(targets, "cut");
              toast(`已剪切 ${targets.length} 个项目`, "info");
            },
          },
        );
      }
      items.push(
        {
          id: "paste-file",
          label: t("粘贴文件"),
          icon: <ClipboardPaste size={13} />,
          shortcut: "⌘V",
          disabled: !hasFileClipboard(),
          run: async () => {
            if (parentDir) await pasteFileClipboard(parentDir);
          },
        },
        {
          id: "new-file",
          label: t("新建文件"),
          icon: <FilePlus2 size={13} />,
          run: async () => {
            const path = await createFile(parentDir);
            if (path) setRenaming(path);
          },
        },
        {
          id: "new-folder",
          label: t("新建文件夹"),
          icon: <FolderPlus size={13} />,
          run: async () => {
            const path = await createFolder(parentDir);
            if (path) setRenaming(path);
          },
        },
      );
      if (node) {
        const copyPath = (label: string, value: string) => {
          navigator.clipboard?.writeText(value).then(
            () => toast(label, "success"),
            () => toast("复制失败", "danger"),
          );
        };
        items.push(
          { id: "sep1", label: "", separator: true },
          {
            id: "open-new-window",
            label: t("在新窗口打开"),
            icon: <AppWindow size={13} />,
            run: () => {
              if (!isTauri()) {
                toast("新窗口需在桌面端使用", "info");
                return;
              }
              invoke("document.newWindow", { filePath: node.path }).catch(() =>
                toast("打开新窗口失败", "danger"),
              );
            },
          },
          {
            id: "reveal",
            label: isTauri() ? getRevealInFolderLabel(t) : t("复制路径"),
            icon: <ExternalLink size={13} />,
            run: () => {
              if (isTauri()) fs.showInFolder(node.path);
              else copyPath("路径已复制", node.path);
            },
          },
          {
            id: "copy-path",
            label: node.isDir ? "复制文件夹路径" : "复制文件路径",
            icon: <LinkIcon size={13} />,
            run: () => copyPath("路径已复制", node.path),
          },
          {
            id: "copy-name",
            label: t("复制文件名"),
            icon: <Copy size={13} />,
            run: () => copyPath("名称已复制", pathUtil.name(node.path)),
          },
          {
            id: "delete",
            label: targets.length > 1 ? `删除 ${targets.length} 个项目` : "移到废纸篓",
            icon: <Trash2 size={13} />,
            shortcut: "⌫",
            danger: true,
            run: async () => {
              await trash(targets);
              toast(`已删除 ${targets.length} 个项目`, "success");
            },
          },
        );
      }
      return items;
    },
    [rootPath, openFile, duplicate, createFile, createFolder, trash, toast, lang],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode | null) => {
      e.preventDefault();
      e.stopPropagation();
      const ws = useWorkspace.getState();
      if (node && !ws.selected.has(node.path)) ws.selectOnly(node.path);
      setMenu({ x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const ws = useWorkspace.getState();
      const visible = flattenVisible(ws.tree, ws.expanded);
      const current = visible.findIndex((n) => ws.selected.has(n.path));
      if (e.key === "F2" && current >= 0) {
        e.preventDefault();
        setRenaming(visible[current].path);
      } else if ((e.key === "Delete" || e.key === "Backspace") && ws.selected.size) {
        e.preventDefault();
        const paths = [...ws.selected];
        trash(paths).then(() => toast(`已删除 ${paths.length} 个项目`, "success"));
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.min(visible.length - 1, Math.max(0, current + (e.key === "ArrowDown" ? 1 : -1)));
        if (visible[next]) {
          if (e.shiftKey) ws.select(visible[next].path, { shift: true });
          else ws.selectOnly(visible[next].path);
          containerRef.current
            ?.querySelector(`[data-path="${CSS.escape(visible[next].path)}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter" && current >= 0) {
        const node = visible[current];
        if (node.isDir) ws.toggleExpand(node.path);
        else ws.openFile(node.path);
      }
    },
    [trash, toast],
  );

  // 统一的拖拽放置处理器：严格区分应用内文件移动 vs 外部文件拖入
  const handleDropPayload = useCallback(
    async (paths: string[], targetDir: string | null, insideSidebar: boolean) => {
      if (!paths.length) return;
      const ws = useWorkspace.getState();
      const currentRoot = ws.rootPath;
      const activeSession = dragSession.get();

      // 判定是否是工作区内部文件的移动：
      const isInternal =
        !!activeSession ||
        dragSession.wasRecentlyInternal(paths) ||
        (currentRoot ? paths.every((p) => isInsideWorkspace(p, currentRoot)) : false);

      if (isInternal) {
        const pathsToMove = activeSession?.paths ?? paths;
        dragSession.end();
        if (insideSidebar && targetDir) {
          await movePaths(pathsToMove, targetDir);
        }
        return;
      }

      // 外部文件拖入（从系统访达/桌面拖入）
      if (insideSidebar) {
        if (targetDir) {
          await importPaths(paths, targetDir);
        }
      } else if (paths[0]) {
        await ws.openFile(paths[0]);
      }
    },
    [toast],
  );

  // HTML5 树节点 DragOver 处理
  const onNodeDragOver = useCallback(
    (node: TreeNode, e: DragEvent) => {
      const session = dragSession.get();
      const external = e.dataTransfer.types.includes("Files");
      if (!session && !external) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = session ? "move" : "copy";

      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      autoScroller.update(e.clientY);

      const res = resolveDropAt(e.clientX, e.clientY, rootPath);
      applyDropInfo(res.targetDir, res.hoveredPath);
      scheduleSpring(res.targetDir);
    },
    [rootPath, applyDropInfo],
  );

  // 引用最新闭包，让原生全局监听器只挂载一次，避免多次绑定事件导致双重弹窗
  const latestDropHandlerRef = useRef(handleDropPayload);
  latestDropHandlerRef.current = handleDropPayload;
  const lastDropTimeRef = useRef(0);

  // 原生拖拽通道（Tauri 桌面端）：只在初始化时挂载单例监听
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | null = null;
    let disposed = false;
    void primeNativeMetrics();

    import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      if (disposed) return;
      getCurrentWebviewWindow()
        .onDragDropEvent(async (event) => {
          const payload = event.payload;
          const currentRoot = useWorkspace.getState().rootPath;

          if (payload.type === "enter" || payload.type === "over") {
            const pt = toClientPoint(payload.position);
            lastMousePosRef.current = pt;
            autoScroller.update(pt.y);

            const res = resolveDropAt(pt.x, pt.y, currentRoot);
            applyDropInfo(res.targetDir, res.hoveredPath);
            scheduleSpring(res.targetDir);
            return;
          }

          if (payload.type === "leave") {
            clearDropInfo();
            return;
          }

          if (payload.type !== "drop") return;

          // 立刻强力压制合成点击、停止滚动、清理弹簧定时器
          suppressClicks(1200);
          clearSpring();
          autoScroller.stop();

          // 防抖防重：600ms 内仅处理一次 drop
          const now = performance.now();
          if (now - lastDropTimeRef.current < 600) return;
          lastDropTimeRef.current = now;

          const pt = toClientPoint(payload.position);
          const sidebar = !!sidebarElementAt(pt.x, pt.y);
          const res = resolveDropAt(pt.x, pt.y, currentRoot);
          const targetDir = res.targetDir ?? dropTargetRef.current;
          clearDropInfo();

          await latestDropHandlerRef.current(payload.paths, targetDir, sidebar);
        })
        .then((u) => {
          if (disposed) u();
          else un = u;
        });
    });

    return () => {
      disposed = true;
      clearDropInfo();
      un?.();
    };
  }, [applyDropInfo, clearDropInfo]);

  useEffect(() => {
    return onNativeDragEnd(() => {
      clearDropInfo();
    });
  }, [clearDropInfo]);

  useEffect(() => {
    const onDragEnd = () => {
      dragSession.end();
      clearDropInfo();
    };
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [clearDropInfo]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onSelectStart = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") {
        e.preventDefault();
      }
    };
    el.addEventListener("selectstart", onSelectStart);
    return () => el.removeEventListener("selectstart", onSelectStart);
  }, []);

  useEffect(() => {
    if (!activePath) return;
    const t = setTimeout(() => {
      containerRef.current
        ?.querySelector('[role="treeitem"][aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }, 80);
    return () => clearTimeout(t);
  }, [activePath, tree]);

  const locateActive = async () => {
    const ws = useWorkspace.getState();
    const p = ws.activePath;
    if (!p) {
      toast(t("没有打开的文件"), "info");
      return;
    }
    setView("tree");
    await ws.expandTo(p);
    ws.selectOnly(p);
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-path="${CSS.escape(p)}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  };

  const headerActions = (
    <>
      <Tooltip label={t("定位当前文件")}>
        <button
          aria-label={t("定位当前文件")}
          onClick={locateActive}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <LocateFixed size={14} />
        </button>
      </Tooltip>
      <Tooltip label={t("新建文件")}>
        <button
          aria-label={t("新建文件")}
          onClick={async () => {
            const path = await createFile(rootPath);
            if (path) setRenaming(path);
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <FilePlus2 size={14} />
        </button>
      </Tooltip>
      <Tooltip label={t("新建文件夹")}>
        <button
          aria-label={t("新建文件夹")}
          onClick={async () => {
            const path = await createFolder(rootPath);
            if (path) setRenaming(path);
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <FolderPlus size={14} />
        </button>
      </Tooltip>
      <Tooltip label={view === "tree" ? t("切换列表视图") : t("切换树视图")}>
        <button
          aria-label={t("切换视图")}
          onClick={() => setView(view === "tree" ? "list" : "tree")}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          {view === "tree" ? <List size={14} /> : <Network size={14} />}
        </button>
      </Tooltip>
      <Tooltip label={t("刷新")}>
        <button
          aria-label={t("刷新文件库")}
          onClick={() => refresh()}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <RefreshCw size={13} />
        </button>
      </Tooltip>
    </>
  );

  return (
    <section className="flex h-full flex-col select-none" aria-label={t("文件库")}>
      <PanelHeader title={t("文件")} actions={headerActions} />

      {/* 根目录 + 最近文件夹 */}
      <div ref={recentRef} className="relative flex h-[34px] shrink-0 items-center gap-1 border-b border-line px-2">
        <button
          onClick={() => setRecentOpen(!recentOpen)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover"
          aria-haspopup="menu"
          aria-expanded={recentOpen}
        >
          <FolderOpen size={13} className="shrink-0 text-warn" />
          <span className="truncate">{rootName || t("未打开文件夹")}</span>
          <ChevronRight size={11} className={`shrink-0 text-ink-muted transition-transform ${recentOpen ? "rotate-90" : ""}`} />
        </button>
        <Tooltip label={t("打开其他文件夹")}>
          <button
            aria-label={t("打开文件夹")}
            onClick={openFolderDialog}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-hover hover:text-ink"
          >
            <FolderInput size={13} />
          </button>
        </Tooltip>
        {recentOpen && (
          <div className="am-pop-in absolute left-2 right-2 top-[36px] z-40 max-h-[300px] overflow-auto rounded-lg border border-line bg-elevated p-1 shadow-menu">
            <p className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              <History size={11} /> 最近打开
            </p>
            {recentFolders.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-ink-muted">{t("暂无记录")}</p>
            )}
            {recentFolders.map((folder) => (
              <button
                key={folder.path}
                onClick={() => {
                  setRecentOpen(false);
                  openFolder(folder.path);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-hover ${
                  folder.path === rootPath ? "text-accent" : "text-ink"
                }`}
              >
                <Folder size={13} className="shrink-0 text-warn opacity-80" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{folder.name}</span>
                  <span className="block truncate text-[10.5px] text-ink-muted">{folder.path}</span>
                </span>
                {folder.pinned && <Pin size={10} className="shrink-0 text-ink-muted" />}
              </button>
            ))}
            <div className="mx-2 my-1 h-px bg-line" />
            <button
              onClick={() => {
                setRecentOpen(false);
                openFolderDialog();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-secondary hover:bg-hover"
            >
              <FolderInput size={13} /> {t("打开文件夹…")}
            </button>
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div
        ref={containerRef}
        role="tree"
        tabIndex={0}
        aria-label={t("文件树")}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => onContextMenu(e, null)}
        onDragOver={(e) => {
          const session = dragSession.get();
          const external = e.dataTransfer.types.includes("Files");
          if (!session && !external) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = session ? "move" : "copy";

          lastMousePosRef.current = { x: e.clientX, y: e.clientY };
          autoScroller.update(e.clientY);

          const res = resolveDropAt(e.clientX, e.clientY, rootPath);
          applyDropInfo(res.targetDir, res.hoveredPath);
          scheduleSpring(res.targetDir);
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) {
            clearDropInfo();
          }
        }}
        onDrop={async (e) => {
          suppressClicks(1200);
          clearSpring();
          autoScroller.stop();

          // 仅在 macOS 桌面端且启用了系统原生拖出（nativeFileDrag）时，才由 Tauri 原生 onDragDropEvent 独占处理；
          // 在 Windows / Linux 桌面端及 Web 预览环境，内部文件树拖动必须由 HTML5 onDrop 正常接管！
          if (nativeFileDrag && isTauri()) {
            e.preventDefault();
            return;
          }

          const external = e.dataTransfer.files.length > 0;
          const session = dragSession.get();
          if (!session && !external) return;
          e.preventDefault();

          const res = resolveDropAt(e.clientX, e.clientY, rootPath);
          const dir = res.targetDir ?? rootPath;
          clearDropInfo();
          if (!dir) return;

          if (session) {
            const paths = session.paths;
            dragSession.end();
            await movePaths(paths, dir);
            return;
          }

          await importExternalFiles([...e.dataTransfer.files], dir);
        }}
        className={`min-h-0 flex-1 select-none overflow-y-auto overflow-x-hidden px-1.5 py-1.5 outline-none ${
          dropTarget && dropTarget === rootPath && !hoveredPath ? "am-drop-root" : ""
        }`}
      >
        {loading ? (
          <div className="space-y-2 p-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-hover" style={{ width: `${80 - i * 9}%` }} />
            ))}
          </div>
        ) : !rootPath ? (
          <EmptyState
            icon={<FolderOpen size={30} strokeWidth={1.4} />}
            title={t("尚未打开文件夹")}
            hint={t("打开一个文件夹开始写作，或把 Markdown 文件拖进来")}
            action={
              <button
                onClick={openFolderDialog}
                className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                打开文件夹
              </button>
            }
          />
        ) : view === "tree" ? (
          tree.length === 0 ? (
            <EmptyState
              icon={<FileText size={28} strokeWidth={1.4} />}
              title={t("空文件夹")}
              hint={t("点击上方 + 新建第一个文件")}
            />
          ) : (
            tree.map((node) => (
              <div key={node.path}>
                <TreeRow
                  node={node}
                  depth={0}
                  renaming={renaming}
                  setRenaming={setRenaming}
                  onContextMenu={onContextMenu}
                  dropTarget={dropTarget}
                  hoveredPath={hoveredPath}
                  onNodeDragOver={onNodeDragOver}
                />
              </div>
            ))
          )
        ) : (
          <div role="list" aria-label={t("文件列表")}>
            <button
              onClick={() => setListSort(listSort === "name" ? "mtime" : "name")}
              className="mb-1 flex w-full items-center gap-1 px-2 text-[10.5px] text-ink-muted hover:text-ink-secondary"
            >
              <ChevronsDownUp size={11} />
              按{listSort === "name" ? "名称" : "修改时间"}排序 · {flatFiles.length} 个文件
            </button>
            {flatFiles.map((file) => {
              const listDragPaths = () => {
                const ws = useWorkspace.getState();
                if (!ws.selected.has(file.path) || ws.selected.size <= 1) {
                  ws.selectOnly(file.path);
                  return [file.path];
                }
                return [...ws.selected];
              };
              const isHovered = hoveredPath === file.path;
              return (
                <div
                  key={file.path}
                  data-path={file.path}
                  data-isdir="0"
                  role="listitem"
                  draggable={!nativeFileDrag}
                  onPointerDown={(e) => {
                    if (renaming === file.path) return;
                    armNativeDrag(e, () => {
                      const paths = listDragPaths();
                      return {
                        paths,
                        label: paths.length > 1 ? `${paths.length} 个项目` : file.name,
                        isDir: false,
                      };
                    });
                  }}
                  onDragStart={(e) => {
                    if (nativeFileDrag) return;
                    const paths = listDragPaths();
                    beginHtml5Drag(e, paths, paths.length > 1 ? `${paths.length} 个项目` : file.name, false);
                  }}
                  onDragEnd={() => {
                    dragSession.end();
                    clearDropInfo();
                  }}
                  onClick={(e) => {
                    if (shouldSuppressClick() || nativeDragJustEnded()) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    const ws = useWorkspace.getState();
                    if (e.shiftKey || e.metaKey || e.ctrlKey)
                      ws.select(file.path, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
                    else {
                      ws.selectOnly(file.path);
                      openFile(file.path);
                    }
                  }}
                  onContextMenu={(e) => onContextMenu(e, file)}
                  className={`flex cursor-default select-none items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] transition-colors ${
                    isHovered
                      ? "bg-hover text-ink"
                      : activePath === file.path
                        ? "bg-active text-ink"
                        : selected.has(file.path)
                          ? "bg-accent-soft"
                          : "text-ink-secondary hover:bg-hover hover:text-ink"
                  }`}
                >
                  <FileGlyph name={file.name} />
                  <span className="min-w-0 flex-1 truncate select-none">{file.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-muted">
                    {listSort === "mtime"
                      ? new Date(file.mtime).toLocaleDateString("zh-CN")
                      : pathUtil.parent(file.path).slice(rootPath.length + 1) || "/"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
