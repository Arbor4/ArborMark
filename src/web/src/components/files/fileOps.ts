import { fs, pathUtil } from "@/bridge/fs";
import { useUi } from "@/stores/ui";
import { useWorkspace, type MoveResult } from "@/stores/workspace";

/* 文件级剪贴板（复制/剪切 → 粘贴到目标目录），与文本剪贴板独立。 */
let fileClipboard: { paths: string[]; mode: "copy" | "cut" } | null = null;

export function setFileClipboard(paths: string[], mode: "copy" | "cut") {
  fileClipboard = { paths, mode };
}

export function hasFileClipboard() {
  return !!fileClipboard;
}

export function clipboardMode() {
  return fileClipboard?.mode ?? null;
}

const toast = (message: string, kind: "success" | "info" | "danger") =>
  useUi.getState().toast(message, kind);

function destLabel(targetDir: string) {
  const ws = useWorkspace.getState();
  return targetDir === ws.rootPath ? ws.rootName || "根目录" : pathUtil.name(targetDir);
}

/** 规范化路径分隔符与盘符，统一 Windows、macOS 和 Linux 的比较标准。 */
export function normalizePath(p: string): string {
  if (!p) return "";
  let norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows 盘符规范化：小写盘符统一为大写（如 c:/xxx -> C:/xxx），防止字符串比较错漏
  if (/^[a-zA-Z]:\//.test(norm)) {
    norm = norm[0].toUpperCase() + norm.slice(1);
  }
  return norm;
}

/** 判断 child 是否位于 parent 目录内（直接或间接子孙，排除自身）。 */
export function isDescendantOf(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c.startsWith(p + "/");
}

/** 判断 path 是否属于当前工作区（等于 rootPath 或在其内部）。 */
export function isInsideWorkspace(path: string, rootPath: string | null): boolean {
  if (!path || !rootPath) return false;
  const p = normalizePath(path);
  const r = normalizePath(rootPath);
  return p === r || p.startsWith(r + "/");
}

/** 至少有一个项目会因这次移动落到新目录（排除移入自身、移入子孙目录、移入原地目录）。 */
export function canMoveInto(paths: string[], targetDir: string): boolean {
  const normalizedTarget = normalizePath(targetDir);
  return paths.some((p) => {
    const norm = normalizePath(p);
    if (norm === normalizedTarget) return false;
    if (normalizedTarget.startsWith(norm + "/")) return false; // 不能移入自己的子孙目录
    const parent = normalizePath(pathUtil.parent(p));
    if (parent === normalizedTarget) return false; // 原地不动
    return true;
  });
}

let movingLock = false;
let lastMoveKey = "";
let lastMoveTime = 0;

export function isMoving(): boolean {
  return movingLock;
}

/** 统一的移动入口：带防重互斥、数量/重名反馈与自动展开目标文件夹。 */
export async function movePaths(paths: string[], targetDir: string): Promise<MoveResult> {
  if (!paths.length || !targetDir) {
    return { moved: 0, errors: [], renamed: [] };
  }
  const moveKey = `${paths.slice().sort().join("|")} -> ${targetDir}`;
  const now = performance.now();
  if (movingLock || (moveKey === lastMoveKey && now - lastMoveTime < 1000)) {
    return { moved: 0, errors: [], renamed: [] };
  }
  movingLock = true;
  lastMoveKey = moveKey;
  lastMoveTime = now;

  try {
    const out = await useWorkspace.getState().move(paths, targetDir);
    if (out.moved > 0) {
      const note = out.renamed && out.renamed.length ? `（${out.renamed.join("，")}）` : "";
      toast(
        out.errors.length
          ? `已移动 ${out.moved} 项${note}，${out.errors.length} 项失败`
          : `已移动到 ${destLabel(targetDir)}${note}`,
        out.errors.length ? "info" : "success",
      );
    } else if (out.errors.length) {
      toast(out.errors[0], "danger");
    } else {
      toast("已在目标位置", "info");
    }
    return out;
  } finally {
    movingLock = false;
  }
}

/** 把系统外部拖入的文件/文件夹复制进目标目录（自动处理重名），返回实际导入数。 */
export async function importPaths(paths: string[], targetDir: string): Promise<number> {
  try {
    const count = await fs.importFiles(paths, targetDir);
    const ws = useWorkspace.getState();
    const nextExpanded = new Set(ws.expanded);
    if (targetDir && targetDir !== ws.rootPath) {
      let cur: string | null = normalizePath(targetDir);
      const normRoot = normalizePath(ws.rootPath);
      while (cur && cur.startsWith(normRoot) && cur !== normRoot) {
        nextExpanded.add(cur);
        const p = normalizePath(pathUtil.parent(cur));
        cur = p !== cur ? p : null;
      }
    }
    // 原子刷新展开，绝不产生分步闪烁
    await ws.refresh(nextExpanded);
    toast(count ? `已导入 ${count} 个项目` : "没有可导入的项目", count ? "success" : "info");
    return count;
  } catch (err) {
    toast(`导入失败：${err}`, "danger");
    return 0;
  }
}

/** 粘贴文件剪贴板。剪切走移动（成功后清空剪贴板）；复制由后端自动重名。 */
export async function pasteFileClipboard(targetDir: string) {
  const clip = fileClipboard;
  if (!clip) return;
  const safe = clip.paths.filter((p) => {
    const norm = normalizePath(p);
    const normTarget = normalizePath(targetDir);
    return norm !== normTarget && !normTarget.startsWith(norm + "/");
  });
  if (!safe.length) {
    toast("不能粘贴到原位置或自身子目录", "info");
    return;
  }
  if (clip.mode === "cut") {
    const out = await movePaths(safe, targetDir);
    if (out.moved > 0 && !out.errors.length) fileClipboard = null;
    return;
  }
  const count = await fs.importFiles(safe, targetDir);
  await useWorkspace.getState().refresh();
  toast(count ? `已粘贴 ${count} 个项目` : "没有可粘贴的项目", count ? "success" : "info");
}
