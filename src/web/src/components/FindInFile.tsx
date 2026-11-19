import { useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, ChevronRight, X, CaseSensitive } from "lucide-react";
import { useFind } from "@/stores/find";
import { useUi } from "@/stores/ui";
import { replaceCurrent, replaceAll } from "./editor/findSync";
import { Tooltip } from "./common";
import { useLang } from "@/bridge/i18n";

/** 文件内搜索（⌘/Ctrl+F）+ 替换（⌘/Ctrl+R）：编辑区顶部居中悬浮框。
 *  实时计数 + 上下导航 + 大小写开关；左侧箭头展开替换行（单个替换 / 全部替换）。 */
export function FindInFile() {
  const open = useFind((s) => s.open);
  const query = useFind((s) => s.query);
  const count = useFind((s) => s.count);
  const index = useFind((s) => s.index);
  const caseSensitive = useFind((s) => s.caseSensitive);
  const replaceMode = useFind((s) => s.replaceMode);
  const replaceText = useFind((s) => s.replaceText);
  const readonly = useUi((s) => s.readonlyMode);
  const { t } = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    if (open && replaceMode) replaceRef.current?.focus();
  }, [open, replaceMode]);

  if (!open) return null;

  const toggleReplace = () => useFind.getState().setReplaceMode(!useFind.getState().replaceMode);
  const modR = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      e.stopPropagation();
      toggleReplace();
      return true;
    }
    return false;
  };

  return (
    <div
      role="search"
      aria-label="文件内搜索与替换"
      className="am-no-print am-glass absolute left-1/2 top-2 z-40 -translate-x-1/2 rounded-lg border border-line bg-elevated/95 px-2 py-1.5 shadow-menu backdrop-blur-md"
    >
      <div className="flex items-center gap-1">
        <Tooltip label={`${t("find.toggleReplace")} ⌘R`} side="bottom">
          <button
            aria-label={t("find.toggleReplace")}
            aria-pressed={replaceMode}
            onClick={toggleReplace}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover ${
              replaceMode ? "text-accent" : "text-ink-secondary hover:text-ink"
            }`}
          >
            <ChevronRight size={13} className={`transition-transform duration-150 ${replaceMode ? "rotate-90" : ""}`} />
          </button>
        </Tooltip>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => useFind.getState().setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (modR(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) useFind.getState().prev();
              else useFind.getState().next();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              useFind.getState().close();
              return;
            }
            e.stopPropagation();
          }}
          placeholder={t("find.placeholder")}
          aria-label={t("find.placeholder")}
          className="h-6 w-52 rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
        />
        <span className="min-w-[52px] text-center text-[11px] tabular-nums text-ink-secondary" aria-live="polite">
          {query ? (count ? `${index + 1}/${count}` : "0/0") : ""}
        </span>
        <Tooltip label={`${t("find.prev")} ⇧↵`} side="bottom">
          <button
            aria-label={t("find.prev")}
            disabled={!count}
            onClick={() => useFind.getState().prev()}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <ChevronUp size={13} />
          </button>
        </Tooltip>
        <Tooltip label={`${t("find.next")} ↵`} side="bottom">
          <button
            aria-label={t("find.next")}
            disabled={!count}
            onClick={() => useFind.getState().next()}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <ChevronDown size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t("find.case")} side="bottom">
          <button
            aria-label={t("find.case")}
            aria-pressed={caseSensitive}
            onClick={() => useFind.getState().toggleCase()}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-hover ${
              caseSensitive ? "bg-accent-soft text-accent" : "text-ink-secondary hover:text-ink"
            }`}
          >
            <CaseSensitive size={13} />
          </button>
        </Tooltip>
        <Tooltip label={`${t("find.close")} Esc`} side="bottom">
          <button
            aria-label={t("find.close")}
            onClick={() => useFind.getState().close()}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </Tooltip>
      </div>
      {replaceMode && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-6 shrink-0" aria-hidden="true" />
          <input
            ref={replaceRef}
            value={replaceText}
            onChange={(e) => useFind.getState().setReplaceText(e.target.value)}
            onKeyDown={(e) => {
              if (modR(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) replaceAll();
                else replaceCurrent();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                useFind.getState().close();
                return;
              }
              e.stopPropagation();
            }}
            placeholder={t("find.replacePlaceholder")}
            aria-label={t("find.replacePlaceholder")}
            className="h-6 w-52 rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <Tooltip label={`${t("find.replace")} ↵`} side="bottom">
            <button
              aria-label={t("find.replace")}
              disabled={!count || readonly}
              onClick={() => replaceCurrent()}
              className="h-6 shrink-0 rounded-md border border-line px-2 text-[11px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
            >
              {t("替换")}
            </button>
          </Tooltip>
          <Tooltip label={`${t("find.replaceAll")} ⌘↵`} side="bottom">
            <button
              aria-label={t("find.replaceAll")}
              disabled={!count || readonly}
              onClick={() => replaceAll()}
              className="h-6 shrink-0 rounded-md border border-line px-2 text-[11px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
            >
              {t("全部替换")}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
