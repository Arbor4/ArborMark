import { useEffect, useRef, useState } from "react";
import { ExternalLink, Check, Unlink, X } from "lucide-react";
import { useLinkEdit } from "@/stores/linkEdit";
import { getMilkdown } from "./editor/activeEditor";
import { editorViewCtx } from "@milkdown/core";
import { openLinkTarget } from "./editor/openLink";
import { useLang } from "@/bridge/i18n";

/** 单击链接浮现的内联编辑条：改文字/URL/标题，打开、应用、移除链接。 */
export function LinkEditBubble() {
  const s = useLinkEdit();
  const { t } = useLang();
  const [text, setText] = useState("");
  const [href, setHref] = useState("");
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (s.open) { setText(s.text); setHref(s.href); setTitle(s.title); }
  }, [s.open, s.from, s.to, s.text, s.href, s.title]);

  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); s.close(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) s.close(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onDown); };
  }, [s.open, s.close]);

  if (!s.open) return null;

  const navigate = () => {
    void openLinkTarget(href);
    s.close();
  };

  const apply = () => {
    const md = getMilkdown();
    if (!md) { s.close(); return; }
    md.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const linkType = view.state.schema.marks.link;
      if (!linkType) return;
      const { from, to } = s;
      let tr = view.state.tr;
      const mark = linkType.create({ href: href.trim(), title: title.trim() || null });
      if (text !== s.text) {
        tr = tr.insertText(text, from, to);
        const newTo = from + text.length;
        tr = tr.removeMark(from, newTo, linkType);
        if (text.length) tr = tr.addMark(from, newTo, mark);
      } else {
        tr = tr.removeMark(from, to, linkType);
        tr = tr.addMark(from, to, mark);
      }
      view.dispatch(tr);
      view.focus();
    });
    s.close();
  };

  const unlink = () => {
    const md = getMilkdown();
    if (md) md.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const linkType = view.state.schema.marks.link;
      if (linkType) view.dispatch(view.state.tr.removeMark(s.from, s.to, linkType));
      view.focus();
    });
    s.close();
  };

  const left = Math.max(8, Math.min(s.x - 160, window.innerWidth - 340));
  const top = Math.max(8, s.y - 84);
  const input = "h-7 rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent";

  return (
    <div ref={ref} className="am-pop-in am-no-print fixed z-[70] w-[324px] rounded-lg border border-line bg-elevated/95 p-2 shadow-menu backdrop-blur-md" style={{ left, top }}>
      <div className="flex items-center gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("link.text")} aria-label={t("link.text")} className={`${input} w-[104px] flex-none`} />
        <input value={href} onChange={(e) => setHref(e.target.value)} placeholder={t("link.url")} aria-label={t("link.url")} className={`${input} min-w-0 flex-1 font-mono`} />
        <button aria-label={t("link.close")} onClick={s.close} className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"><X size={13} /></button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("link.title")} aria-label={t("link.title")} className={`${input} min-w-0 flex-1`} />
        <button onClick={navigate} title={t("link.open")} className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary hover:bg-hover hover:text-ink"><ExternalLink size={12} /> {t("link.open")}</button>
        <button onClick={unlink} title={t("link.unlink")} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-secondary hover:bg-danger/10 hover:text-danger"><Unlink size={12} /></button>
        <button onClick={apply} className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11.5px] font-medium text-on-accent hover:bg-accent-hover"><Check size={12} /> {t("link.apply")}</button>
      </div>
      <p className="mt-1 text-[10px] text-ink-muted">{t("link.hint")}</p>
    </div>
  );
}