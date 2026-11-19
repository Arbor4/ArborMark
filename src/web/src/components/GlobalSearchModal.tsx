import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CaseSensitive,
  WholeWord,
  Regex,
  ChevronRight,
  FileText,
  Replace,
  ReplaceAll,
  CornerDownLeft,
  Loader2,
  X,
} from "lucide-react";
import { useSearch } from "@/stores/search";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { jumpToMatch } from "./editor/editorNav";
import { Modal, Tooltip } from "./common";
import { useLang } from "@/bridge/i18n";

interface FlatMatch {
  file: string;
  fileName: string;
  dir: string;
  line: number;
  text: string;
  start: number;
  end: number;
  match?: string;
  indexInFile: number;
}

/** 全局搜索：居中弹窗，结果按文件分组，点击/回车跳转到对应行。 */
export function GlobalSearchModal() {
  const { t } = useLang();
  const open = useUi((s) => s.globalSearchOpen);
  const setOpen = useUi((s) => s.setGlobalSearch);
  const toast = useUi((s) => s.toast);

  const query = useSearch((s) => s.query);
  const replaceText = useSearch((s) => s.replaceText);
  const results = useSearch((s) => s.results);
  const searching = useSearch((s) => s.searching);
  const error = useSearch((s) => s.error);
  const caseSensitive = useSearch((s) => s.caseSensitive);
  const wholeWord = useSearch((s) => s.wholeWord);
  const useRegexp = useSearch((s) => s.useRegexp);
  const setQuery = useSearch((s) => s.setQuery);
  const setReplaceText = useSearch((s) => s.setReplaceText);
  const toggleOption = useSearch((s) => s.toggleOption);
  const run = useSearch((s) => s.run);
  const replaceOne = useSearch((s) => s.replaceOne);
  const replaceAll = useSearch((s) => s.replaceAll);

  const openFile = useWorkspace((s) => s.openFile);
  const rootPath = useWorkspace((s) => s.rootPath);

  const [cursor, setCursor] = useState(0);
  const [showReplace, setShowReplace] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // 平铺所有匹配，供键盘导航
  const flat: FlatMatch[] = useMemo(() => {
    const out: FlatMatch[] = [];
    for (const file of results) {
      if (collapsed.has(file.path)) continue;
      file.matches.forEach((m, i) => {
        out.push({
          file: file.path,
          fileName: file.name,
          dir: file.dir,
          line: m.line,
          text: m.text,
          start: m.start,
          end: m.end,
          match: m.match,
          indexInFile: i,
        });
      });
    }
    return out;
  }, [results, collapsed]);

  const totalMatches = results.reduce((s, f) => s + f.matches.length, 0);

  useEffect(() => {
    if (open) {
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 40);
      run();
    }
  }, [open, run]);

  // 输入防抖搜索
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => run(), 240);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, caseSensitive, wholeWord, useRegexp, open, run]);

  useEffect(() => setCursor(0), [query, results]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-flat="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const jump = async (m: FlatMatch) => {
    setOpen(false);
    await openFile(m.file);
    await jumpToMatch(m);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(flat.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[cursor]) jump(flat[cursor]);
    }
  };

  const optionBtn = (
    key: "caseSensitive" | "wholeWord" | "useRegexp",
    label: string,
    icon: React.ReactNode,
    active: boolean,
  ) => (
    <Tooltip label={label}>
      <button
        aria-label={label}
        aria-pressed={active}
        onClick={() => toggleOption(key)}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
          active ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink"
        }`}
      >
        {icon}
      </button>
    </Tooltip>
  );

  let flatIndex = -1;

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={720} labelledBy="global-search-title" align="top">
      <div className="flex max-h-[76vh] flex-col">
        {/* 搜索输入 */}
        <div className="shrink-0 border-b border-line p-3.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-field px-3 transition-colors focus-within:border-transparent focus-within:bg-hover">
            <Search size={16} className="shrink-0 text-ink-muted" />
            <input
              ref={inputRef}
              id="global-search-title"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={t("在所有文件中搜索…（↑↓ 选择，↵ 跳转到行）")}
              aria-label={t("全局搜索")}
              className="h-[42px] min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-muted"
            />
            {optionBtn("caseSensitive", "区分大小写", <CaseSensitive size={15} />, caseSensitive)}
            {optionBtn("wholeWord", "全词匹配", <WholeWord size={15} />, wholeWord)}
            {optionBtn("useRegexp", "正则表达式", <Regex size={15} />, useRegexp)}
            <Tooltip label={showReplace ? "隐藏替换" : "显示替换"}>
              <button
                aria-label={t("切换替换")}
                aria-pressed={showReplace}
                onClick={() => setShowReplace(!showReplace)}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  showReplace ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink"
                }`}
              >
                <Replace size={15} />
              </button>
            </Tooltip>
          </div>
          {showReplace && (
            <div className="am-fade-in mt-2 flex items-center gap-2 rounded-lg border border-line bg-field px-3 transition-colors focus-within:border-transparent focus-within:bg-hover">
              <Replace size={15} className="shrink-0 text-ink-muted" />
              <input
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={t("替换为…")}
                aria-label={t("替换内容")}
                className="h-[36px] min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-muted"
              />
              <button
                disabled={!totalMatches}
                onClick={async () => {
                  await replaceAll();
                  toast("全部替换完成", "success");
                }}
                className="flex h-7 items-center gap-1 rounded-md border border-line px-2.5 text-[11.5px] text-ink-secondary transition-colors hover:bg-hover disabled:opacity-30"
              >
                <ReplaceAll size={13} /> {t("全部替换")}
              </button>
            </div>
          )}
          {error && <p className="mt-2 px-1 text-[11.5px] text-danger">{error}</p>}
        </div>

        {/* 结果 */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {searching ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12.5px] text-ink-muted">
              <Loader2 size={15} className="animate-spin" /> {t("搜索中…")}
            </div>
          ) : !rootPath ? (
            <p className="py-12 text-center text-[12.5px] text-ink-muted">{t("尚未打开文件夹")}</p>
          ) : !query.trim() ? (
            <p className="py-12 text-center text-[12.5px] text-ink-muted">
              {t("输入关键词开始全局搜索")}
            </p>
          ) : results.length === 0 ? (
            <p className="py-12 text-center text-[12.5px] text-ink-muted">
              {t("gs.noMatch", { query })}
            </p>
          ) : (
            results.map((file) => {
              const isCollapsed = collapsed.has(file.path);
              return (
                <div key={file.path} className="mb-1">
                  <button
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(file.path)) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                    aria-expanded={!isCollapsed}
                  >
                    <ChevronRight
                      size={13}
                      className={`shrink-0 text-ink-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                    />
                    <FileText size={14} className="shrink-0 text-accent opacity-80" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                      {file.name}
                    </span>
                    <span className="shrink-0 truncate text-[10.5px] text-ink-muted">{file.dir}</span>
                    <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] tabular-nums text-accent">
                      {file.matches.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="ml-3 border-l border-line pl-1.5">
                      {file.matches.map((m, i) => {
                        flatIndex++;
                        const idx = flatIndex;
                        const active = idx === cursor;
                        return (
                          <div
                            key={`${m.line}-${m.start}-${i}`}
                            data-flat={idx}
                            className={`group flex items-center gap-2 rounded-md px-2 py-[4px] transition-colors ${
                              active ? "bg-accent-soft" : "hover:bg-hover"
                            }`}
                            onMouseEnter={() => setCursor(idx)}
                          >
                            <button
                              onClick={() =>
                                jump({
                                  file: file.path,
                                  fileName: file.name,
                                  dir: file.dir,
                                  line: m.line,
                                  text: m.text,
                                  start: m.start,
                                  end: m.end,
                                  indexInFile: i,
                                })
                              }
                              className="flex min-w-0 flex-1 items-baseline gap-2.5 text-left"
                              title={t("gs.jumpLine", { n: m.line })}
                            >
                              <span className="w-8 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-ink-muted">
                                {m.line}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-secondary">
                                {m.text.slice(0, m.start)}
                                <mark className="rounded-sm bg-accent-soft px-0.5 font-semibold text-accent">
                                  {m.text.slice(m.start, m.end)}
                                </mark>
                                {m.text.slice(m.end)}
                              </span>
                              {active && (
                                <CornerDownLeft size={12} className="shrink-0 text-ink-muted" />
                              )}
                            </button>
                            {showReplace && (
                              <Tooltip label={t("替换此处")}>
                                <button
                                  aria-label={t("替换此处")}
                                  onClick={() => replaceOne(file.path, i)}
                                  className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-active hover:text-accent group-hover:flex"
                                >
                                  <Replace size={11} />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 底栏 */}
        {query.trim() && results.length > 0 && (
          <div className="flex shrink-0 items-center gap-3 border-t border-line px-3.5 py-2 text-[11px] text-ink-muted">
            <span>
              {t("gs.summary", { n: totalMatches, m: results.length })}
            </span>
            <span className="flex-1" />
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line px-1">↑↓</kbd> {t("选择")}
              <kbd className="rounded border border-line px-1">↵</kbd> {t("跳转")}
              <kbd className="rounded border border-line px-1">esc</kbd> {t("关闭")}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}