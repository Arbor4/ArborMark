import { invoke } from "./ipc";

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface FsStat {
  exists: boolean;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface SearchMatch {
  line: number;
  text: string;
  start: number;
  end: number;
  /** 命中的原文片段（Rust 端返回 match，mock 端由 start/end 推导） */
  match?: string;
}

export interface SearchFileResult {
  path: string;
  name: string;
  dir: string;
  matches: SearchMatch[];
}

/** 路径工具：统一 "/" 分隔（Tauri 侧会归一化 Windows 分隔符）。 */
export const pathUtil = {
  join(parent: string, name: string): string {
    return `${parent.replace(/[\\/]+$/, "")}/${name}`;
  },
  /** child 是否位于 parent 子树内（兼容 Windows \ 与 POSIX / 分隔符）。 */
  isUnder(child: string, parent: string): boolean {
    return (
      child.length > parent.length + 1 &&
      child.startsWith(parent) &&
      (child[parent.length] === "/" || child[parent.length] === "\\")
    );
  },
  parent(path: string): string {
    const normalized = path.replace(/[\\/]+$/, "");
    const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    // idx=0 时父目录是根 "/"；返回原值会让 expandTo 的父目录回 walk 死循环。
    if (idx < 0) return "";
    if (idx === 0) return "/";
    return normalized.slice(0, idx);
  },
  name(path: string): string {
    const normalized = path.replace(/[\\/]+$/, "");
    const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    return normalized.slice(idx + 1);
  },
  ext(name: string): string {
    const idx = name.lastIndexOf(".");
    return idx <= 0 ? "" : name.slice(idx + 1).toLowerCase();
  },
  stem(name: string): string {
    const idx = name.lastIndexOf(".");
    return idx <= 0 ? name : name.slice(0, idx);
  },
  isMarkdown(name: string): boolean {
    return ["md", "markdown", "mdown", "mkd", "txt"].includes(pathUtil.ext(name));
  },
};

export const fs = {
  readDir: (path: string) => invoke<FsEntry[]>("fs.readDir", { path }),
  readFile: (path: string) => invoke<string>("fs.readFile", { path }),
  writeFile: (path: string, content: string) =>
    invoke<boolean>("fs.writeFile", { path, content }),
  stat: (path: string) => invoke<FsStat>("fs.stat", { path }),
  createDir: (path: string) => invoke<boolean>("fs.createDir", { path }),

  newFile: (path: string) => invoke<boolean>("library.newFile", { path }),
  newFolder: (path: string) => invoke<boolean>("library.newFolder", { path }),
  rename: (from: string, to: string) =>
    invoke<boolean>("library.renameFile", { from, to }),
  move: (from: string, to: string) => invoke<boolean>("library.moveFile", { from, to }),
  duplicate: (path: string) => invoke<string | false>("library.duplicate", { path }),
  trash: (path: string) => invoke<boolean>("library.trashItem", { path }),
  /** 系统拖入/粘贴：复制文件或目录到 targetDir（重名自动编号），返回导入数量。 */
  importFiles: (paths: string[], targetDir: string) =>
    invoke<number>("fs.importFiles", { paths, targetDir }),

  search: (root: string, query: string, opts: Record<string, unknown> = {}) =>
    invoke<{ files: SearchFileResult[]; error?: string }>("search.content", {
      root,
      query,
      ...opts,
    }),

  recentFolders: async () => {
    // 真实后端返回数组 [{path,name,pinned}]；mock 返回 {folders:[...]}。统一归一。
    const raw = await invoke<unknown>("library.getRecentFolders");
    const folders = Array.isArray(raw)
      ? raw
      : ((raw as { folders?: unknown[] })?.folders ?? []);
    return { folders: folders as { path: string; name: string; pinned: boolean }[] };
  },
  addRecentFolder: (path: string) => invoke<boolean>("setting.addRecentFolder", { path }),
  clearRecentHistory: async () => {
    try {
      await Promise.all([
        invoke("setting.askForClearRecentDocuments"),
        invoke("setting.askForClearRecentLocations"),
      ]);
      return true;
    } catch {
      return false;
    }
  },

  openFolderDialog: () =>
    invoke<{ canceled: boolean; filePaths: string[] }>("dialog.showOpenDialog", {
      properties: ["openDirectory"],
    }),
  showInFolder: (path: string) => invoke("shell.showItemInFolder", { path }),
  openExternal: (url: string) => invoke("shell.openExternal", { url }),

  themeDir: () => invoke<string>("app.themeDir"),
  setTitle: (title: string) => invoke("window.setTitle", { title }),
};