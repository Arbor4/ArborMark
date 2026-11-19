import { useEffect, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { readConfig, enabledEngines, defaultEngine, openSearch, type SearchEngine } from "@/bridge/webSearch";
import { useUi } from "@/stores/ui";
import { useLang } from "@/bridge/i18n";

/** 选中文本后浮现的搜索气泡：默认引擎一键搜索 + 引擎下拉。可在偏好设置关闭。 */
export function SelectionSearchBubble() {
  const [pos, setPos] = useState<{ x: number; y: number; text: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const prefsTick = useUi((s) => s.prefs.webSearchConfig);
  const { t } = useLang();

  useEffect(() => {
    let timer = 0;
    const update = () => {
      const cfg = readConfig();
      if (!cfg.enabled || !cfg.bubble) { setPos(null); return; }
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setPos(null); setPickerOpen(false); return; }
      const text = sel.toString().trim();
      if (!text || text.length > 200) { setPos(null); return; }
      const anchor = sel.anchorNode;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement;
      if (!el || !el.closest(".am-milkdown-view, .cm-content")) { setPos(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) { setPos(null); return; }
      setPos({ x: rect.left + rect.width / 2, y: rect.top, text });
    };
    const onSel = () => { clearTimeout(timer); timer = window.setTimeout(update, 180); };
    const onScroll = () => { setPos(null); setPickerOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); setPickerOpen(false); } };
    document.addEventListener("selectionchange", onSel);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [prefsTick]);

  if (!pos) return null;
  const cfg = readConfig();
  const engines = enabledEngines(cfg);
  const def = defaultEngine(cfg);
  if (!def || !engines.length) return null;

  const left = Math.max(8, Math.min(pos.x - 60, window.innerWidth - 160));
  const top = Math.max(8, pos.y - 40);

  const run = (eng: SearchEngine) => { openSearch(eng, pos.text); setPos(null); setPickerOpen(false); };

  return (
    <div className="am-pop-in am-no-print fixed z-[70] flex items-center gap-0.5 rounded-lg border border-line bg-elevated/95 p-0.5 shadow-menu backdrop-blur-md" style={{ left, top }}>
      <button
        onClick={() => run(def)}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink transition-colors hover:bg-hover"
        title={`用 ${def.name} 搜索选中文本`}
      >
        <Search size={13} className="text-accent" /> {def.name}
      </button>
      <div className="relative">
        <button aria-label="选择搜索引擎" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)} className="flex h-7 w-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink">
          <ChevronDown size={12} />
        </button>
        {pickerOpen && (
          <div className="am-pop-in absolute right-0 top-8 z-50 w-[150px] rounded-lg border border-line bg-elevated p-1 shadow-menu">
            {engines.map((e) => (
              <button key={e.id} onClick={() => run(e)} className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-hover">
                {e.name}
                {e.id === def.id && <span className="text-[10px] text-accent">{t("默认")}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}