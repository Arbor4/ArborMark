/**
 * 插入表格下拉：8×8 悬停网格（参考 Word 的表格 picker）+ 行/列步进器（更大尺寸）。
 * 网格点击即插入；步进器配合「插入」按钮插入自定义尺寸。行数含表头行（PM 表格至少 2 行）。
 */
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Table2 } from "lucide-react";
import { useLang } from "@/bridge/i18n";

const GRID = 8;
const MAX_ROWS = 20;
const MAX_COLS = 12;

export function TablePicker({
  onPick,
  onClose,
}: {
  onPick: (rows: number, cols: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const { t } = useLang();
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const eff = hover ?? { r: rows, c: cols };

  const stepper = (
    label: string,
    value: number,
    min: number,
    max: number,
    set: (n: number) => void,
  ) => (
    <div className="flex items-center gap-1">
      <span className="w-7 text-[11px] text-ink-secondary">{label}</span>
      <button
        aria-label={`${label}减一`}
        disabled={value <= min}
        onClick={() => set(Math.max(min, value - 1))}
        className="flex h-5 w-5 items-center justify-center rounded border border-line text-ink-secondary transition-colors hover:bg-hover disabled:opacity-30"
      >
        <Minus size={11} />
      </button>
      <span className="w-6 text-center font-mono text-[12px] text-ink">{value}</span>
      <button
        aria-label={`${label}加一`}
        disabled={value >= max}
        onClick={() => set(Math.min(max, value + 1))}
        className="flex h-5 w-5 items-center justify-center rounded border border-line text-ink-secondary transition-colors hover:bg-hover disabled:opacity-30"
      >
        <Plus size={11} />
      </button>
    </div>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="选择表格尺寸"
      className="am-glass absolute left-1/2 top-full z-[60] mt-1.5 w-[248px] -translate-x-1/2 rounded-lg border border-line bg-elevated/95 p-3 shadow-menu backdrop-blur-md"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-ink">
          {eff.r} × {eff.c} {t("表格")}
        </span>
        <span className="text-[10.5px] text-ink-muted">{t("点击网格插入")}</span>
      </div>
      <div
        className="grid grid-cols-8 gap-[3px]"
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const r = Math.floor(i / GRID) + 1;
          const c = (i % GRID) + 1;
          const on = r <= eff.r && c <= eff.c;
          return (
            <button
              key={i}
              aria-label={`插入 ${r} 行 ${c} 列表格`}
              onMouseEnter={() => setHover({ r, c })}
              onFocus={() => setHover({ r, c })}
              onClick={() => onPick(r, c)}
              className={`h-[16px] rounded-[3px] border transition-colors ${
                on
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-field hover:border-accent/60"
              }`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {stepper(t("行数"), rows, 2, MAX_ROWS, setRows)}
        {stepper(t("列数"), cols, 1, MAX_COLS, setCols)}
      </div>
      <button
        onClick={() => onPick(rows, cols)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
      >
        <Table2 size={13} />
        {t("插入")} {rows} × {cols} {t("表格")}
      </button>
    </div>
  );
}