/**
 * 图片地址解析：相对路径按当前文档目录解析；Tauri 下转 asset 协议 URL。
 * 转换器异步加载（@tauri-apps/api/core），加载完成后调用方需重新应用 src。
 */
import { isTauri, invoke } from "@/bridge/ipc";
import { fs, pathUtil } from "@/bridge/fs";
import { useWorkspace } from "@/stores/workspace";

/** 绝对路径判定：POSIX 以 / 开头；Windows 为盘符（C:\ 或 C:/）或 UNC 前缀。 */
function isAbsoluteFs(p: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p);
}

/** 归一化路径（折叠 ./ 与 ../），保证 mock 查找与自定义协议（拒绝 ..）都能命中。
 *  Windows 盘符路径保留盘符并以 \ 拼接；POSIX 路径保持 / 前缀。 */
function normalize(p: string): string {
  const win = /^[A-Za-z]:[\\/]/.test(p);
  const head = win ? p.slice(0, 2) : "";
  const out: string[] = [];
  for (const seg of (win ? p.slice(2) : p).split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return win ? `${head}\\${out.join("\\")}` : "/" + out.join("/");
}

/** 相对路径按当前文档目录解析为绝对路径；绝对路径原样归一化。 */
function toAbsolute(decoded: string): string {
  if (isAbsoluteFs(decoded)) return normalize(decoded);
  const active = useWorkspace.getState().activePath ?? "";
  return normalize(active ? pathUtil.join(pathUtil.parent(active), decoded) : decoded);
}

/** 放大镜图标（内联 SVG，供 node view / widget 的预览按钮复用）。 */
export const MAGNIFIER_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';

export const MIN_VIEW_SCALE = 0.05;
export const MAX_VIEW_SCALE = 12;

/** 整图适应窗口的缩放（可能很小）。 */
export function wholeFitScale(w: number, h: number, sw: number, sh: number): number {
  return Math.min(sw / Math.max(1, w), sh / Math.max(1, h), 1);
}

/**
 * 初始视图：普通图整图适应；超长图（高/宽比大或整图缩放过小）改为按宽适应并顶部对齐，
 * 保证文字可读、可上下平移，避免缩成一条看不清的细条。
 */
export function initialImageView(w: number, h: number, sw: number, sh: number): { scale: number; tx: number; ty: number } {
  const whole = wholeFitScale(w, h, sw, sh);
  const long = h / Math.max(1, w) > 2.5 || whole < 0.12;
  if (long) {
    const scale = Math.max(Math.min(sw / Math.max(1, w), 1), MIN_VIEW_SCALE);
    return { scale, tx: 0, ty: Math.max(0, (h * scale - sh) / 2) };
  }
  return { scale: whole, tx: 0, ty: 0 };
}

let converter: ((p: string) => string) | null = null;
let loading: Promise<void> | null = null;

export function ensureImageConverter(): Promise<void> {
  if (!isTauri() || converter) return Promise.resolve();
  if (!loading) {
    loading = import("@tauri-apps/api/core").then((m) => {
      converter = m.convertFileSrc;
    });
  }
  return loading;
}

export function resolveImageSrc(src: string): string {
  if (!src || /^(https?:|data:|blob:|asset:)/i.test(src) || src.startsWith("http://asset.")) return src;
  // 本地路径：解码百分号编码（a%20a → "a a"）后再解析/转 asset
  let decoded = src;
  try { decoded = decodeURIComponent(src); } catch { /* 保留原样 */ }
  if (!isTauri() || !converter) return decoded;
  return converter(toAbsolute(decoded));
}

const dataUrlCache = new Map<string, string>();

/** 桌面端优先经 IPC 读为 data URL（资产协议 scope 可能为空），失败回退 asset；浏览器原样返回。 */
export async function resolveImageSrcAsync(src: string): Promise<string> {
  if (!src || /^(https?:|data:|blob:|asset:)/i.test(src) || src.startsWith("http://asset.")) return src;
  let decoded = src;
  try { decoded = decodeURIComponent(src); } catch { /* 保留原样 */ }
  const abs = toAbsolute(decoded);
  if (!isTauri()) {
    // 浏览器 mock：读取内存文件，SVG / data URI 转成可加载的 data URL
    const hit = dataUrlCache.get(abs);
    if (hit) return hit;
    try {
      const text = await fs.readFile(abs);
      if (typeof text === "string" && text) {
        const url = text.startsWith("data:")
          ? text
          : text.trim().startsWith("<svg")
            ? `data:image/svg+xml;utf8,${encodeURIComponent(text)}`
            : "";
        if (url) { dataUrlCache.set(abs, url); return url; }
      }
    } catch { /* 非 mock 资源，原样返回 */ }
    return resolveImageSrc(src);
  }
  const hit = dataUrlCache.get(abs);
  if (hit) return hit;
  try {
    const url = await invoke<string | null>("images.readDataUrl", { path: abs });
    if (url) { dataUrlCache.set(abs, url); return url; }
  } catch { /* 回退 asset */ }
  await ensureImageConverter();
  return resolveImageSrc(src);
}