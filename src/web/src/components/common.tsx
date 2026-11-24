import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useUi } from "@/stores/ui";
import { CheckCircle2, AlertTriangle, Info, XCircle, X, ChevronRight } from "lucide-react";

/* ── Tooltip：轻量提示，hover 400ms 后出现 ─────────────────────────────────── */

export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  side?: "bottom" | "right" | "top";
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [effSide, setEffSide] = useState<"bottom" | "right" | "top">(side);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  const enter = () => {
    timer.current = setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      let s = side;
      if (s === "top" && rect.top < 40) s = "bottom";
      else if (s === "bottom" && rect.bottom + 34 > window.innerHeight) s = "top";
      const x = s === "right" ? rect.right + 8 : rect.left + rect.width / 2;
      const y = s === "bottom" ? rect.bottom + 8 : s === "top" ? rect.top - 8 : rect.top + rect.height / 2;
      setEffSide(s);
      setPos({ x: Math.max(70, Math.min(x, window.innerWidth - 70)), y });
      setShow(true);
    }, 420);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  };

  return (
    <span ref={ref} onMouseEnter={enter} onMouseLeave={leave} className="inline-flex">
      {children}
      {show &&
        createPortal(
          <span
            className="am-pop-in pointer-events-none fixed z-[9999] -translate-x-1/2 rounded-md border border-line bg-elevated px-2.5 py-1 text-[11.5px] text-ink shadow-menu"
            style={{
              left: pos.x,
              top: pos.y,
              transform: effSide === "right" ? "translateY(-50%)" : effSide === "top" ? "translate(-50%, -100%)" : "translateX(-50%)",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

/* ── 上下文菜单 ───────────────────────────────────────────────────────────── */

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  children?: MenuItem[];
  run?: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  grid,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  grid?: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - rect.width - 8);
    const ny = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(4, nx), y: Math.max(4, ny) });
  }, [x, y]);

  // 展开/收起分组后重新夹取视口，避免底部溢出
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      setPos((p) => ({ ...p, y: Math.max(4, window.innerHeight - rect.height - 8) }));
    }
  }, [openGroup]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const rowCls = (item: MenuItem) =>
    `flex w-full items-center gap-2.5 rounded-md px-2.5 py-[5px] text-left text-[12.5px] transition-colors ${
      item.disabled
        ? "cursor-default text-ink-muted opacity-50"
        : item.danger
          ? "text-danger hover:bg-danger/10"
          : "text-ink hover:bg-hover"
    }`;

  const renderItems = (list: MenuItem[], depth: number): ReactNode =>
    list.map((item) => {
      if (item.separator) return <div key={item.id} className="mx-2 my-1 h-px bg-line" />;
      if (item.children?.length) {
        const open = openGroup === item.id;
        return (
          <div key={item.id}>
            <button
              role="menuitem"
              aria-expanded={open}
              className={rowCls(item)}
              onClick={() => setOpenGroup(open ? null : item.id)}
            >
              <span className="flex w-4 justify-center opacity-75">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <ChevronRight size={12} className={`opacity-60 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
            {open && (
              <div className="mt-0.5 mb-1 ml-4 border-l border-line pl-1.5">
                {renderItems(item.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }
      return (
        <button
          key={item.id}
          role="menuitem"
          title={item.shortcut ? `${item.label}  ${item.shortcut}` : item.label}
          disabled={item.disabled}
          className={rowCls(item)}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.run?.();
          }}
        >
          <span className="flex w-4 justify-center opacity-75">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {item.shortcut && <span className="ml-3 font-mono text-[10.5px] text-ink-muted">{item.shortcut}</span>}
        </button>
      );
    });

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="am-pop-in fixed z-[9000] max-h-[calc(100vh-16px)] min-w-[210px] overflow-y-auto rounded-lg border border-line bg-elevated p-1 shadow-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {grid && grid.length > 0 && (
        <>
          <div className="grid grid-cols-6 gap-0.5 p-1">
            {grid.map((g) => (
              <Tooltip key={g.id} label={g.shortcut ? `${g.label}  ${g.shortcut}` : g.label} side="top">
                <button
                  role="menuitem"
                  aria-label={g.shortcut ? `${g.label} ${g.shortcut}` : g.label}
                  disabled={g.disabled}
                  onClick={() => { if (g.disabled) return; onClose(); g.run?.(); }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
                >
                  {g.icon}
                </button>
              </Tooltip>
            ))}
          </div>
          <div className="mx-2 my-1 h-px bg-line" />
        </>
      )}
      {renderItems(items, 0)}
    </div>,
    document.body,
  );
}

/* ── 模态框 ───────────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  children,
  width = 560,
  labelledBy,
  align = "center",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  labelledBy?: string;
  align?: "center" | "top";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className={`am-fade-in fixed inset-0 z-[8000] flex justify-center bg-black/40 p-6 backdrop-blur-[2px] ${
        align === "top" ? "items-start pt-[10vh]" : "items-center"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="am-pop-in am-glass max-h-[86vh] w-full overflow-hidden rounded-lg border border-line bg-elevated shadow-modal"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ── Toast 通知 ───────────────────────────────────────────────────────────── */

const TOAST_ICONS = {
  info: <Info size={15} className="text-info" />,
  success: <CheckCircle2 size={15} className="text-ok" />,
  warning: <AlertTriangle size={15} className="text-warn" />,
  danger: <XCircle size={15} className="text-danger" />,
};

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return createPortal(
    <div className="am-no-print pointer-events-none fixed bottom-16 left-1/2 z-[9500] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="am-toast-in am-glass pointer-events-auto flex items-center gap-2.5 rounded-lg border border-line bg-elevated px-3.5 py-2 text-[12.5px] text-ink shadow-menu"
        >
          {TOAST_ICONS[t.kind]}
          <span>{t.message}</span>
          {t.action && (
            <button
              className="ml-1 rounded px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            aria-label="关闭通知"
            className="ml-0.5 rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => dismiss(t.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ── 空状态 ───────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="mb-1 text-ink-muted opacity-60">{icon}</span>
      <p className="text-[13px] font-medium text-ink-secondary">{title}</p>
      {hint && <p className="max-w-[220px] text-[11.5px] leading-relaxed text-ink-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ── 开关 ─────────────────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-accent" : "bg-line-strong"
      }`}
    >
      <span
        className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
          checked ? "left-[18px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150 ${
        checked ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-field text-transparent hover:border-accent"
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </button>
  );
}