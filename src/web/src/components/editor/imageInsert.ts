/**
 * 图片插入：统一读取「插入与路径」偏好（相对路径基准 / 附件目录 / 复制行为 /
 * 文件名模板 / 默认 alt / URL 转义），桌面端复制真实文件，浏览器粘贴回退 data URI。
 */
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { t } from "@/bridge/i18n";
import { fs, pathUtil } from "@/bridge/fs";
import { invoke, isTauri } from "@/bridge/ipc";
import { getMilkdown, getCm6 } from "./activeEditor";
import { editorViewCtx, parserCtx } from "@milkdown/core";

export interface ImagePrefs {
  relative: boolean;
  base: "doc" | "workspace";
  folder: string;
  copy: boolean;
  pattern: "original" | "timestamp" | "docseq";
  escape: boolean;
  altFromName: boolean;
  action: "none" | "current" | "assets" | "filename.assets" | "upload" | "custom";
  applyLocal: boolean;
  applyNetwork: boolean;
  yamlUpload: boolean;
  addDotSlash: boolean;
  customPath: string;
}

const ACTIONS = ["none", "current", "assets", "filename.assets", "upload", "custom"] as const;

export function imagePrefs(): ImagePrefs {
  const p = useUi.getState().prefs;
  const action = (ACTIONS as readonly string[]).includes(String(p.imgInsertAction)) ? (p.imgInsertAction as ImagePrefs["action"]) : "assets";
  return {
    relative: p.useRelativePathForImg !== false,
    base: p.imgBase === "workspace" ? "workspace" : "doc",
    folder: typeof p.imgFolder === "string" ? p.imgFolder : "assets",
    copy: action !== "none" && action !== "upload",
    pattern: p.imgNamePattern === "timestamp" || p.imgNamePattern === "docseq" ? p.imgNamePattern : "original",
    escape: p.autoEscapeImageURL !== false,
    altFromName: p.imgAltFromName !== false,
    action,
    applyLocal: p.imgApplyLocal !== false,
    applyNetwork: p.imgApplyNetwork === true,
    yamlUpload: p.imgYamlUpload === true,
    addDotSlash: p.imgAddDotSlash === true,
    customPath: typeof p.imgCustomPath === "string" ? p.imgCustomPath : "",
  };
}

/** 动作 → 目标子目录（相对基准目录），custom 可为绝对路径。 */
function actionFolder(pref: ImagePrefs): string {
  const ws = useWorkspace.getState();
  const docStem = ws.activePath ? pathUtil.stem(pathUtil.name(ws.activePath)) : "img";
  switch (pref.action) {
    case "current": return "";
    case "assets": return "assets";
    case "filename.assets": return `${docStem}.assets`;
    case "custom": return pref.customPath.trim();
    default: return pref.folder.trim();
  }
}

export function imageTargetDir(): string {
  const ws = useWorkspace.getState();
  const pref = imagePrefs();
  const root = pref.base === "workspace" ? ws.rootPath ?? "" : ws.activePath ? pathUtil.parent(ws.activePath) : ws.rootPath ?? "";
  const folder = actionFolder(pref).replace(/^\/+|\/+$/g, "");
  if (pref.action === "custom" && pref.customPath.trim().startsWith("/")) return pref.customPath.trim();
  return folder ? pathUtil.join(root, folder) : root;
}

function escapeUrl(u: string): string {
  return u.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function patternName(original: string, index: number): string {
  const pref = imagePrefs();
  const ext = pathUtil.ext(original) || "png";
  const stem = pathUtil.stem(original);
  if (pref.pattern === "timestamp") return `${Date.now()}-${index}.${ext}`;
  if (pref.pattern === "docseq") {
    const doc = useWorkspace.getState().activePath ? pathUtil.stem(pathUtil.name(useWorkspace.getState().activePath!)) : "img";
    return `${doc}-${index + 1}.${ext}`;
  }
  return `${stem}.${ext}`;
}

/** 由目标绝对路径生成插入用 dest（相对当前文档或绝对），并按偏好转义/加 ./。 */
export function destFor(absPath: string): string {
  const pref = imagePrefs();
  const ws = useWorkspace.getState();
  let dest = absPath;
  let isRelative = false;
  if (pref.relative && ws.activePath) {
    const docDir = pathUtil.parent(ws.activePath);
    if (pathUtil.isUnder(absPath, docDir)) { dest = absPath.slice(docDir.length + 1); isRelative = true; }
  }
  if (pref.addDotSlash && isRelative && !dest.startsWith("./") && !dest.startsWith("../")) dest = `./${dest}`;
  return pref.escape ? escapeUrl(dest) : dest;
}

export function altFor(name: string): string {
  return imagePrefs().altFromName ? pathUtil.stem(name) : "";
}

export function imageMarkdown(dest: string, alt: string): string {
  return `![${alt}](${dest})`;
}

/** 网络图片按「对网络位置应用规则」尝试下载落盘；失败回退原 URL。 */
async function localizeNetwork(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    if (!isTauri()) return data;
    // savePNG 的 payload 为裸 data URI 字符串（后端 payload.as_str()）
    const temp = await invoke<string>("images.savePNG", data as unknown as Record<string, unknown>);
    if (!temp) return null;
    const target = imageTargetDir();
    await fs.createDir(target).catch(() => false);
    await invoke("fs.importFiles", { paths: [temp], targetDir: target }).catch(() => null);
    return pathUtil.join(target, pathUtil.name(temp));
  } catch {
    return null;
  }
}

/** 桌面端：把真实图片路径复制进目标目录（含模板改名），返回插入 Markdown。 */
export async function insertImagePaths(paths: string[]): Promise<string> {
  const pref = imagePrefs();
  const target = imageTargetDir();
  const lines: string[] = [];
  if (pref.action === "upload") {
    useUi.getState().toast(t("img.uploadUnavailable"), "info");
  }
  const shouldCopy = pref.copy && pref.applyLocal && isTauri() && pref.action !== "upload";
  if (shouldCopy) await fs.createDir(target).catch(() => false);
  for (let i = 0; i < paths.length; i++) {
    const src = paths[i];
    const isNet = /^https?:/i.test(src);
    if (isNet) {
      const local = pref.applyNetwork ? await localizeNetwork(src) : null;
      lines.push(imageMarkdown(local ? destFor(local) : src, altFor(pathUtil.name(src))));
      continue;
    }
    if (shouldCopy) {
      await invoke("fs.importFiles", { paths: [src], targetDir: target }).catch(() => null);
      const orig = pathUtil.name(src);
      const want = patternName(orig, i);
      let finalName = orig;
      if (want !== orig) {
        const ok = await fs.rename(pathUtil.join(target, orig), want).catch(() => false);
        if (ok) finalName = want;
      }
      lines.push(imageMarkdown(destFor(pathUtil.join(target, finalName)), altFor(orig)));
    } else {
      lines.push(imageMarkdown(destFor(src), altFor(pathUtil.name(src))));
    }
  }
  return lines.join("\n");
}

/** 浏览器粘贴/拖拽 File：读为 data URI 自包含插入。 */
export async function insertImageFilesDataUri(files: File[]): Promise<string> {
  const lines: string[] = [];
  for (const f of files) {
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    lines.push(imageMarkdown(data, altFor(f.name)));
  }
  return lines.join("\n");
}

/** 给编辑器宿主挂粘贴/拖拽图片处理（capture，优先于默认粘贴）。返回卸载函数。 */
export function attachImageHandlers(el: HTMLElement): () => void {
  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i;
  const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

  const fileToDataUri = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  /** 纯位图粘贴（截图 / 网页复制的图）：先写成临时 PNG，再走偏好规则（复制到附件目录 + 改名）。 */
  async function insertBitmapFiles(files: File[]): Promise<string> {
    const paths: string[] = [];
    for (const f of files) {
      try {
        const data = await fileToDataUri(f);
        const temp = await invoke<string>("images.savePNG", { data, name: f.name } as unknown as Record<string, unknown>);
        if (temp) paths.push(temp);
      } catch {
        /* 单项失败跳过 */
      }
    }
    if (!paths.length) return insertImageFilesDataUri(files);
    return insertImagePaths(paths);
  }

  const handle = (files: File[]) => {
    if (!files.length) return;
    if (isTauri()) {
      // Tauri 的 File 没有 .path：先问剪贴板要真实路径（资源管理器「复制」的文件），
      // 有就按偏好规则走（复制到 ./assets 等）；只有位图时先落盘再走同一规则。
      invoke<string[]>("clipboard.readFilePaths", {})
        .then((paths) => {
          const imgs = (Array.isArray(paths) ? paths : []).filter((p) => IMAGE_EXT_RE.test(p));
          if (imgs.length && imgs.length === files.length) return insertImagePaths(imgs);
          return insertBitmapFiles(files);
        })
        .catch(() => insertBitmapFiles(files))
        .then((md) => md && insertAtCursor(md));
      return;
    }
    void insertImageFilesDataUri(files).then(insertAtCursor);
  };

  const onPaste = (e: ClipboardEvent) => {
    const imgs = imageFiles(e.clipboardData?.files);
    if (!imgs.length) return;
    e.preventDefault();
    e.stopPropagation();
    handle(imgs);
  };
  const onDrop = (e: DragEvent) => {
    const imgs = imageFiles(e.dataTransfer?.files);
    if (!imgs.length) return;
    e.preventDefault();
    e.stopPropagation();
    handle(imgs);
  };
  el.addEventListener("paste", onPaste, true);
  el.addEventListener("drop", onDrop, true);
  return () => {
    el.removeEventListener("paste", onPaste, true);
    el.removeEventListener("drop", onDrop, true);
  };
}

/** 把 Markdown 插入当前活跃编辑器光标处。 */
export function insertAtCursor(md: string) {
  const milkdown = getMilkdown();
  if (milkdown) {
    milkdown.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // 解析为节点再插入：insertText 会把 ![]() 等转义成纯文本
      const parsed = ctx.get(parserCtx)(md);
      const { from, to } = view.state.selection;
      const $from = view.state.doc.resolve(from);
      const first = parsed.firstChild;
      const tr = view.state.tr;
      if (parsed.childCount === 1 && first?.type.name === "paragraph" && $from.parent.isTextblock) {
        tr.replaceWith(from, to, first.content);
      } else {
        tr.replaceWith(from, to, parsed.content);
      }
      view.dispatch(tr);
      view.focus();
    });
    return;
  }
  const cm = getCm6();
  if (cm) {
    const r = cm.state.selection.main;
    cm.dispatch({ changes: { from: r.from, to: r.to, insert: md }, selection: { anchor: r.from + md.length } });
    cm.focus();
  }
}