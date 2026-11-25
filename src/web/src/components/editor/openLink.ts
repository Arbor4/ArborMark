import { fs, pathUtil } from "@/bridge/fs";
import { isTauri } from "@/bridge/ipc";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { getMilkdown } from "./activeEditor";
import { editorViewCtx } from "@milkdown/core";
import { jumpToAnchor } from "./milkdown/milkdownAnchors";

/** 规范化路径拼接（处理 . 与 ..，兼容 Windows \ 与 Unix /） */
export function resolveRelativePath(baseDir: string, relPath: string): string {
  if (!baseDir) return relPath;
  const isAbs = relPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relPath);
  if (isAbs) return relPath.replace(/\\/g, "/");

  const baseParts = baseDir.replace(/\\/g, "/").split("/").filter(Boolean);
  const relParts = relPath.replace(/\\/g, "/").split("/");

  for (const p of relParts) {
    if (p === "." || p === "") continue;
    if (p === "..") {
      if (baseParts.length > 0) baseParts.pop();
    } else {
      baseParts.push(p);
    }
  }
  const prefix = baseDir.startsWith("/") ? "/" : /^[a-zA-Z]:/.test(baseDir) ? "" : "";
  return prefix + baseParts.join("/");
}

/** 探测本地文件候选路径是否存在 */
export async function resolveLocalFile(href: string): Promise<{ resolvedPath: string; hash?: string } | null> {
  // 分离 #hash 锚点
  const hashIdx = href.indexOf("#");
  let rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const hash = hashIdx >= 0 ? href.slice(hashIdx + 1) : undefined;

  rawPath = decodeURIComponent(rawPath.trim());
  if (!rawPath) return null;

  // 去掉 file:// 协议头
  if (rawPath.startsWith("file://")) {
    rawPath = rawPath.replace(/^file:\/\/\/?/, "/");
    if (/^\/[a-zA-Z]:/.test(rawPath)) rawPath = rawPath.slice(1);
  }

  const ws = useWorkspace.getState();
  const activePath = ws.activePath;
  const currentDir = activePath ? pathUtil.parent(activePath) : "";
  const rootPath = ws.rootPath ?? "";

  const candidates: string[] = [];
  const isAbs = rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath);

  if (isAbs) {
    candidates.push(rawPath);
  } else {
    // 候选 1：优先相对于当前文档所在目录
    if (currentDir) candidates.push(resolveRelativePath(currentDir, rawPath));
    // 候选 2：相对于工作区根目录
    if (rootPath && rootPath !== currentDir) candidates.push(resolveRelativePath(rootPath, rawPath));
  }

  // 1. 直接检测候选路径
  for (const cand of candidates) {
    try {
      const stat = await fs.stat(cand);
      if (stat && stat.exists) {
        return { resolvedPath: cand, hash };
      }
    } catch {}
  }

  // 2. 如果没有扩展名，尝试常见文本扩展名探测
  if (!pathUtil.ext(rawPath)) {
    for (const cand of candidates) {
      for (const ext of [".md", ".markdown", ".txt", ".json"]) {
        try {
          const withExt = cand + ext;
          const stat = await fs.stat(withExt);
          if (stat && stat.exists) {
            return { resolvedPath: withExt, hash };
          }
        } catch {}
      }
    }
  }

  // 3. 兜底返回第一个候选路径
  if (candidates.length > 0) {
    return { resolvedPath: candidates[0], hash };
  }
  return null;
}

/**
 * 统一链接跳转核心调度：
 * - 纯锚点 #xxx → 当前文档 jumpToAnchor；
 * - http(s):// / mailto: → 系统外部默认浏览器；
 * - 本地相对/绝对文件 → ArborMark 内部打开，自动定位到锚点并展开树。
 */
export async function openLinkTarget(href: string): Promise<boolean> {
  const target = href.trim();
  if (!target || target.startsWith("javascript:")) return false;

  // 1. 纯文内锚点
  if (target.startsWith("#")) {
    const anchorId = decodeURIComponent(target.slice(1));
    const md = getMilkdown();
    if (md) {
      md.action((ctx) => jumpToAnchor(ctx.get(editorViewCtx), anchorId));
      return true;
    }
    return false;
  }

  // 2. 外部 Web / Mail / FTP 链接
  if (/^(https?:\/\/|mailto:|ftp:|tel:)/i.test(target)) {
    if (isTauri()) {
      await fs.openExternal(target);
    } else {
      window.open(target, "_blank", "noopener");
    }
    return true;
  }

  // 3. 本地文件相对/绝对路径
  const resolved = await resolveLocalFile(target);
  if (resolved) {
    const ws = useWorkspace.getState();
    try {
      const stat = await fs.stat(resolved.resolvedPath);
      if (!stat || !stat.exists) {
        useUi.getState().toast(`目标文件不存在：${pathUtil.name(resolved.resolvedPath)}`, "danger");
        return false;
      }
      if (stat.isDir) {
        // 如果链接指向目录，在侧边栏定位该目录
        ws.expandTo(resolved.resolvedPath);
        ws.selectOnly(resolved.resolvedPath);
        useUi.getState().toast(`已定位目录：${pathUtil.name(resolved.resolvedPath)}`, "info");
        return true;
      }
      // 打开目标文件
      await ws.openFile(resolved.resolvedPath);
      // 若带有 hash 锚点，延迟等待文档挂载完成后滚动至对应锚点
      if (resolved.hash) {
        const anchorId = decodeURIComponent(resolved.hash);
        setTimeout(() => {
          const md = getMilkdown();
          if (md) {
            md.action((ctx) => jumpToAnchor(ctx.get(editorViewCtx), anchorId));
          }
        }, 150);
      }
      return true;
    } catch (err) {
      useUi.getState().toast(`打开文件失败：${err}`, "danger");
      return false;
    }
  }

  // 兜底作为外部协议或 URL 处理
  if (isTauri()) {
    await fs.openExternal(target);
  } else {
    window.open(target, "_blank", "noopener");
  }
  return true;
}
