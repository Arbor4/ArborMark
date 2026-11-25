import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ChevronRight,
  FolderOpen,
  Folder,
  FileText,
  FileCode2,
  FileImage,
  File as FileIcon,
  Check,
} from "lucide-react";
import { useWorkspace, prefetchDir, type TreeNode } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { pathUtil } from "@/bridge/fs";
import { useLang } from "@/bridge/i18n";
import {
  armNativeDrag,
  beginHtml5Drag,
  nativeDragJustEnded,
  nativeFileDrag,
  shouldSuppressClick,
} from "./dragSession";

/* ── 文件图标 ─────────────────────────────────────────────────────────────── */

export function FileGlyph({ name, size = 14 }: { name: string; size?: number }) {
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

export function TreeRow({
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
