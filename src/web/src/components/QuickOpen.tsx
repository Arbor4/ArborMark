import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, CornerDownLeft, Clock } from "lucide-react";
import { useWorkspace, flattenVisible, type TreeNode } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { fs, pathUtil } from "@/bridge/fs";
import { Modal } from "./common";
import { useLang } from "@/bridge/i18n";

interface QuickOpenItem {
  file: TreeNode;
  score: number;
  isRecent?: boolean;
}

/** 快速打开：⌘P 模糊搜索文件名，最近文件置顶优先。 */
export function QuickOpen() {
  const { t } = useLang();
  const open = useUi((s) => s.quickOpenOpen);
  const setOpen = useUi((s) => s.setQuickOpen);
  const tree = useWorkspace((s) => s.tree);
  const rootPath = useWorkspace((s) => s.rootPath);
  const openFile = useWorkspace((s) => s.openFile);
  const selectOnly = useWorkspace((s) => s.selectOnly);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const files = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) walk(n.children);
        } else if (pathUtil.isMarkdown(n.name)) {
          out.push(n);
        }
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  const scored = useMemo<QuickOpenItem[]>(() => {
    const q = query.trim().toLowerCase();
    const recentSet = new Set(recentPaths);

    if (!q) {
      // 搜索框为空时：优先置顶显示最近打开的文件列表
      const recentItems: QuickOpenItem[] = [];
      const seen = new Set<string>();

      for (const p of recentPaths) {
        const found = files.find((f) => f.path === p);
        if (found && !seen.has(p)) {
          seen.add(p);
          recentItems.push({ file: found, score: 1000, isRecent: true });
        }
      }

      const otherItems: QuickOpenItem[] = files
        .filter((f) => !seen.has(f.path))
        .map((f) => ({ file: f, score: 0 }));

      return [...recentItems, ...otherItems].slice(0, 50);
    }

    return files
      .map((file) => {
        const name = file.name.toLowerCase();
        const rel = rootPath ? file.path.slice(rootPath.length + 1).toLowerCase() : file.path.toLowerCase();
        let score = -1;
        if (name.startsWith(q)) score = 100;
        else if (name.includes(q)) score = 70;
        else if (rel.includes(q)) score = 40;
        else {
          // 子序列模糊匹配
          let qi = 0;
          for (let i = 0; i < name.length && qi < q.length; i++) {
            if (name[i] === q[qi]) qi++;
          }
          if (qi === q.length) score = 20;
        }

        const isRecent = recentSet.has(file.path);
        if (score >= 0 && isRecent) {
          score += 15; // 最近文件赋予搜索提权
        }

        return { file, score, isRecent };
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [files, query, rootPath, recentPaths]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      fs.recentFiles()
        .then((res) => {
          setRecentPaths((res.files ?? []).map((f) => f.path));
        })
        .catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const choose = async (index: number) => {
    const item = scored[index];
    if (!item) return;
    setOpen(false);
    selectOnly(item.file.path);
    await openFile(item.file.path);
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={520} labelledBy="quick-open-title">
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search size={15} className="shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          id="quick-open-title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(scored.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(cursor);
            }
          }}
          placeholder={t("按文件名搜索…（支持最近文件优先）")}
          aria-label={t("快速打开文件")}
          className="h-[46px] min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-muted"
        />
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted">
          ESC
        </kbd>
      </div>
      <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
        {scored.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-ink-muted">
            {files.length === 0 ? t("文件库为空") : t("没有匹配的文件")}
          </p>
        ) : (
          scored.map(({ file, isRecent }, i) => (
            <button
              key={file.path}
              data-index={i}
              onClick={() => choose(i)}
              onMouseEnter={() => setCursor(i)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                i === cursor ? "bg-accent-soft" : ""
              }`}
            >
              {isRecent ? (
                <Clock size={14} className="shrink-0 text-accent opacity-90" />
              ) : (
                <FileText size={14} className="shrink-0 text-accent opacity-80" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] text-ink">{file.name}</span>
                  {isRecent && (
                    <span className="rounded bg-accent/10 px-1 py-0.2 text-[9.5px] font-medium text-accent">
                      {t("最近")}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[10.5px] text-ink-muted">
                  {rootPath && file.path.startsWith(rootPath)
                    ? pathUtil.parent(file.path).slice(rootPath.length + 1) || "/"
                    : pathUtil.parent(file.path)}
                </span>
              </span>
              {i === cursor && <CornerDownLeft size={13} className="shrink-0 text-ink-muted" />}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}