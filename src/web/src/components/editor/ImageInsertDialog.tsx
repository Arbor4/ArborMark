import { useEffect, useRef, useState } from "react";
import { ImagePlus, Link2, Upload, X } from "lucide-react";
import { Modal } from "../common";
import { insertImagePaths, insertImageFilesDataUri, insertAtCursor, imageMarkdown, altFor, destFor } from "./imageInsert";
import { resolveImageSrc } from "./imageSrc";
import { useUi } from "@/stores/ui";
import { useLang } from "@/bridge/i18n";

type Mode = "file" | "path";

/** 插入图片对话框：选择本地文件 或 粘贴路径/URL，预览后按偏好插入。 */
export function ImageInsertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [pathText, setPathText] = useState("");
  const [alt, setAlt] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setFiles([]); setPathText(""); setAlt(""); setPreview(null); setMode("file"); }
  }, [open]);

  useEffect(() => {
    if (mode === "file" && files.length) {
      const url = URL.createObjectURL(files[0]);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    if (mode === "path") {
      const first = pathText.split("\n").map((s) => s.trim()).filter(Boolean)[0];
      setPreview(first ? (/^(https?:|data:)/i.test(first) ? first : resolveImageSrc(first)) : null);
    } else setPreview(null);
  }, [mode, files, pathText]);

  const pickFiles = (list: FileList | null) => {
    const imgs = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (imgs.length) setFiles(imgs);
  };

  const doInsert = async () => {
    let md = "";
    if (mode === "file") {
      if (!files.length) return;
      const paths = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => Boolean(p));
      md = paths.length === files.length ? await insertImagePaths(paths) : await insertImageFilesDataUri(files);
    } else {
      const lines = pathText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return;
      const parts: string[] = [];
      const locals: string[] = [];
      for (const l of lines) {
        if (/^(https?:|data:)/i.test(l)) parts.push(imageMarkdown(l, alt || ""));
        else locals.push(l);
      }
      if (locals.length) parts.unshift(await insertImagePaths(locals));
      md = parts.join("\n");
    }
    if (alt && mode === "file") md = md.replace(/!\[[^\]]*\]/g, `![${alt}]`);
    insertAtCursor(md);
    useUi.getState().toast("已插入图片", "success");
    onClose();
  };

  const tab = (m: Mode, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${mode === m ? "bg-accent-soft font-medium text-accent" : "text-ink-secondary hover:bg-hover hover:text-ink"}`}
    >
      {icon} {label}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} width={520} labelledBy="img-insert-title">
      <div className="flex max-h-[86vh] flex-col">
        <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-3">
          <h2 id="img-insert-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <ImagePlus size={16} className="text-accent" /> {t("插入图片")}
          </h2>
          <button aria-label={t("关闭")} onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="mb-4 flex gap-1 rounded-lg bg-hover p-1">
          {tab("file", t("本地文件"), <Upload size={13} />)}
          {tab("path", t("路径 / URL"), <Link2 size={13} />)}
        </div>

        {mode === "file" ? (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-field text-ink-secondary transition-colors hover:border-accent hover:text-ink"
          >
            <Upload size={20} />
            <span className="text-[12.5px]">{t("点击选择图片（可多选）")}</span>
            <span className="text-[11px] text-ink-muted">{files.length ? t("img.selected", { n: files.length }) : t("img.pickHint")}</span>
          </button>
        ) : (
          <textarea
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            rows={4}
            placeholder={"每行一个图片路径或 URL，例如：\nassets/photo.png\nhttps://example.com/a.png"}
            className="w-full rounded-lg border border-line bg-field px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-muted focus:border-accent"
          />
        )}
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />

        <div className="mt-3 flex items-center gap-2">
          <label className="text-[12px] text-ink-secondary" htmlFor="img-alt">{t("替代文本")}</label>
          <input
            id="img-alt"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={mode === "file" && files.length ? altFor(files[0].name) : "图片描述（可选）"}
            className="h-8 flex-1 rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent"
          />
        </div>

        {preview && (
          <div className="mt-3 flex h-[140px] items-center justify-center overflow-hidden rounded-lg border border-line bg-hover">
            <img src={preview} alt="预览" className="max-h-full max-w-full object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.25"; }} />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => { insertAtCursor("![]()"); useUi.getState().toast(t("img.insertBlank"), "success"); onClose(); }}
            className="mr-auto flex h-8 items-center gap-1.5 rounded-md border border-dashed border-line px-3 text-[12.5px] text-ink-secondary hover:border-accent hover:text-ink"
          >
            <ImagePlus size={13} /> {t("img.insertBlank")}
          </button>
          <button onClick={onClose} className="h-8 rounded-md border border-line px-3 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink">{t("取消")}</button>
          <button
            onClick={doInsert}
            disabled={mode === "file" ? !files.length : !pathText.trim()}
            className="h-8 rounded-md bg-accent px-4 text-[12.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t("插入")}
          </button>
        </div>
        </div>
      </div>
    </Modal>
  );
}