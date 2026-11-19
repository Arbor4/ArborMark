import { create } from "zustand";
import { fs, pathUtil, type FsEntry } from "@/bridge/fs";
import { isTauri } from "@/bridge/ipc";
import { MOCK_ROOT } from "@/bridge/mockFs";
import { getPreviewKind } from "@/components/editor/codeLanguage";
import { useUi } from "./ui";

export interface TreeNode {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  children: TreeNode[] | null; // null = 未加载
  loading?: boolean; // 占位行：冷目录枚举中
}

export interface MoveResult {
  moved: number;
  errors: string[];
  renamed: string[];
}

interface WorkspaceState {
  rootPath: string;
  rootName: string;
  tree: TreeNode[];
  expanded: Set<string>;
  selected: Set<string>;
  anchorPath: string | null;
  activePath: string | null;
  content: string;
  savedContent: string;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  recentFolders: { path: string; name: string; pinned: boolean }[];

  openFolder: (path: string) => Promise<void>;
  openDefault: () => Promise<void>;
  refresh: (expandedOverride?: Set<string>, extraState?: Partial<WorkspaceState>) => Promise<void>;
  toggleExpand: (path: string) => Promise<void>;
  expandFolder: (path: string) => Promise<void>;
  expandTo: (path: string) => Promise<void>;
  select: (path: string, opts?: { shift?: boolean; toggle?: boolean }) => void;
  selectOnly: (path: string) => void;
  clearSelection: () => void;
  openFile: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  openHelp: (name: string, content: string) => void;
  setContent: (text: string) => void;
  setBaseline: (text: string) => void;
  save: () => Promise<boolean>;
  createFile: (parentDir: string, name?: string) => Promise<string | null>;
  createFolder: (parentDir: string, name?: string) => Promise<string | null>;
  rename: (path: string, newName: string) => Promise<boolean>;
  trash: (paths: string[]) => Promise<void>;
  move: (paths: string[], targetDir: string) => Promise<MoveResult>;
  duplicate: (path: string) => Promise<void>;
  loadRecent: () => Promise<void>;
  clearRecent: () => Promise<void>;
}

function toNode(entry: FsEntry): TreeNode {
  return {
    path: entry.path,
    name: entry.name,
    isDir: entry.isDir,
    size: entry.size,
    mtime: entry.mtime,
    children: entry.isDir ? null : [],
  };
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, "zh") : a.isDir ? -1 : 1,
  );
}

// 启动恢复与系统打开事件（访达双击）会并发触发「挂载+打开」；openFolder 完成时
// 会清空编辑器，不串行化就会互相覆盖（双击打开的文件被会话恢复抹掉）。
let openChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = openChain.then(fn, fn);
  openChain = run.catch(() => {});
  return run;
}

/** 不可变地更新树中某个节点。 */
function updateNode(
  nodes: TreeNode[],
  path: string,
  fn: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return fn(node);
    if (node.children && pathUtil.isUnder(path, node.path)) {
      return { ...node, children: updateNode(node.children, path, fn) };
    }
    return node;
  });
}

function removeNode(nodes: TreeNode[], path: string): TreeNode[] {
  return nodes
    .filter((node) => node.path !== path)
    .map((node) =>
      node.children && pathUtil.isUnder(path, node.path)
        ? { ...node, children: removeNode(node.children, path) }
        : node,
    );
}

/** 可见节点平铺序列（Shift 连选用）。 */
export function flattenVisible(tree: TreeNode[], expanded: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.loading) continue; // 占位行不参与扁平序列
      out.push(node);
      if (node.isDir && expanded.has(node.path) && node.children) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** 全树查找节点（不受展开状态限制），供展开时按需加载子目录。 */
function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.isDir && n.children && pathUtil.isUnder(path, n.path)) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 目录清单缓存：hover 预取与展开点击共用，冷目录只枚举一次。
 * 全量失效点在 refresh/openFolder（所有变更操作最终都走 refresh）。
 */
const dirCache = new Map<string, TreeNode[]>();
const dirInflight = new Map<string, Promise<TreeNode[]>>();

async function loadDir(path: string): Promise<TreeNode[]> {
  const hit = dirCache.get(path);
  if (hit) return hit;
  let p = dirInflight.get(path);
  if (!p) {
    p = fs
      .readDir(path)
      .then((entries) => {
        const nodes = sortNodes(entries.map(toNode));
        dirCache.set(path, nodes);
        return nodes;
      })
      .finally(() => {
        dirInflight.delete(path);
      });
    dirInflight.set(path, p);
  }
  return p;
}

/** 悬停预取目录内容：点击展开时数据已就绪，消除冷目录的"点了没反应"。 */
export function prefetchDir(path: string): void {
  void loadDir(path).catch(() => {});
}

/// 首层不自动展开的重目录（展开时再按需加载，避免首屏/刷新卡顿）。
const HEAVY_DIRS = new Set(["node_modules", "dist", "target", "build", "out", "release", ".git", ".toolchain", ".next"]);

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  rootPath: "",
  rootName: "",
  tree: [],
  expanded: new Set<string>(),
  selected: new Set<string>(),
  anchorPath: null,
  activePath: null,
  content: "",
  savedContent: "",
  dirty: false,
  loading: false,
  error: null,
  recentFolders: [],

  openFolder: async (path) => {
    dirCache.clear();
    set({ loading: true, error: null });
    try {
      const tree = await loadDir(path);
      const expanded = new Set<string>();
      // 默认展开第一层轻量目录（并行加载）；重目录保持折叠、按需展开
      await Promise.all(
        tree
          .filter((n) => n.isDir && !HEAVY_DIRS.has(n.name))
          .map(async (node) => {
            expanded.add(node.path);
            node.children = await loadDir(node.path);
          }),
      );
      set({
        rootPath: path,
        rootName: pathUtil.name(path),
        tree,
        expanded,
        selected: new Set(),
        anchorPath: null,
        activePath: null,
        content: "",
        savedContent: "",
        dirty: false,
        loading: false,
      });
      fs.addRecentFolder(path).catch(() => {});
      get().loadRecent();
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  openDefault: () => serialized(async () => {
    if (isTauri()) {
      // 「在新窗口打开」等派生窗口：flush_pending_switch 可能已先切到目标文档
      // （openPath 与本方法共用序列化队列）。此时不能再挂载最近目录，
      // 否则 openFolder 会清空刚打开的文档，表现为"文件闪一下变空白"。
      if (get().activePath) return;
      // 偏好「启动时恢复上次会话」关闭时：保持空工作区，由引导界面接管。
      if (!restoreSessionEnabled) return;
      try {
        const recent = await fs.recentFolders();
        const first = recent.folders?.[0];
        if (first) {
          await get().openFolder(first.path);
        }
      } catch {
        /* 首次安装无最近目录：保持空工作区，由引导界面接管，不弹系统选择框 */
      }
      return;
    }
    await get().openFolder(MOCK_ROOT);
    // 浏览器演示：直接打开欢迎文档
    const welcome = pathUtil.join(MOCK_ROOT, "欢迎.md");
    await get().openFile(welcome);
    get().selectOnly(welcome);
  }),

  refresh: async (expandedOverride, extraState) => {
    dirCache.clear();
    const { rootPath, expanded, activePath } = get();
    if (!rootPath) return;
    const targetExpanded = expandedOverride ?? expanded;
    try {
      const tree = await loadDir(rootPath);
      // 保留展开状态，并行重新加载已展开目录（含本次新展开的目录）
      const reload = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        await Promise.all(
          nodes.map(async (node) => {
            if (node.isDir && targetExpanded.has(node.path)) {
              node.children = await loadDir(node.path);
              await reload(node.children);
            }
          }),
        );
        return nodes;
      };
      await reload(tree);
      // 单步原子更新所有状态，绝不呈现未加载 children 的半成品中间帧
      set({
        tree,
        ...(expandedOverride ? { expanded: expandedOverride } : {}),
        ...(extraState ?? {}),
      });
      // 活动文件被外部删除时提示
      if (activePath) {
        const stat = await fs.stat(activePath);
        if (!stat.exists) set({ error: "当前文件已在外部被删除或移动" });
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  toggleExpand: async (path) => {
    const { expanded, tree } = get();
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
      set({ expanded: next });
      return;
    }
    next.add(path);
    const node = findNode(tree, path);
    if (node?.isDir && node.children === null) {
      const cached = dirCache.get(path);
      if (cached) {
        set({
          expanded: next,
          tree: updateNode(get().tree, path, (n) => ({ ...n, children: cached })),
        });
        return;
      }
      // 冷目录：先展开并显示"载入中"占位，数据到达后替换——点击必须有即时反馈
      set({
        expanded: next,
        tree: updateNode(get().tree, path, (n) => ({
          ...n,
          children: [{ path: `${path}/__loading__`, name: "", isDir: false, size: 0, mtime: 0, children: [], loading: true }],
        })),
      });
      try {
        const children = await loadDir(path);
        set({ tree: updateNode(get().tree, path, (n) => ({ ...n, children })) });
      } catch (err) {
        set({
          tree: updateNode(get().tree, path, (n) => ({ ...n, children: null })),
          error: String(err),
        });
      }
    } else {
      set({ expanded: next });
    }
  },

  expandFolder: async (path) => {
    const { expanded, tree, rootPath } = get();
    if (!path || path === rootPath || expanded.has(path)) return;
    const next = new Set(expanded);
    next.add(path);
    const node = findNode(tree, path);
    if (node?.isDir && node.children === null) {
      try {
        const children = await loadDir(path);
        set({
          expanded: next,
          tree: updateNode(get().tree, path, (n) => ({ ...n, children })),
        });
      } catch (err) {
        set({ expanded: next, error: String(err) });
      }
    } else {
      set({ expanded: next });
    }
  },

  expandTo: async (path) => {
    const { rootPath, expanded } = get();
    if (!rootPath) return;
    const next = new Set(expanded);
    let dir = pathUtil.parent(path);
    const toLoad: string[] = [];
    while (dir.startsWith(rootPath) && dir !== rootPath) {
      if (!next.has(dir)) toLoad.push(dir);
      next.add(dir);
      dir = pathUtil.parent(dir);
    }
    set({ expanded: next });
    for (const d of toLoad.reverse()) {
      try {
        const children = await loadDir(d);
        set({ tree: updateNode(get().tree, d, (n) => ({ ...n, children })) });
      } catch {
        /* 目录可能已不存在 */
      }
    }
  },

  select: (path, opts = {}) => {
    const { selected, anchorPath, tree, expanded } = get();
    if (opts.shift && anchorPath) {
      const visible = flattenVisible(tree, expanded);
      const a = visible.findIndex((n) => n.path === anchorPath);
      const b = visible.findIndex((n) => n.path === path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = visible.slice(lo, hi + 1).map((n) => n.path);
        set({ selected: new Set(range) });
        return;
      }
    }
    if (opts.toggle) {
      const next = new Set(selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      set({ selected: next, anchorPath: path });
      return;
    }
    set({ selected: new Set([path]), anchorPath: path });
  },

  selectOnly: (path) => set({ selected: new Set([path]), anchorPath: path }),
  clearSelection: () => set({ selected: new Set(), anchorPath: null }),

  openFile: async (path) => {
    const { dirty, activePath } = get();
    if (path === activePath) {
      // 搜索/快速打开跳转到当前文件时，文件树选中项也要跟随
      get().selectOnly(path);
      return;
    }
    if (dirty && activePath) {
      await get().save();
    }
    // 启动恢复/菜单直开文件时可能还没有工作区：挂载父目录，文件树才有上下文。
    if (!get().rootPath) {
      const dir = pathUtil.parent(path);
      if (dir && dir !== path) await get().openFolder(dir).catch(() => {});
    }
    try {
      // 图片/PDF/音视频/不支持的二进制：不读文本（避免乱码与大文件内存浪费），
      // 由 EditorArea 按扩展名路由到对应预览视图。
      if (getPreviewKind(pathUtil.name(path))) {
        set({ activePath: path, content: "", savedContent: "", dirty: false, error: null });
      } else {
        const content = await fs.readFile(path);
        set({
          activePath: path,
          content,
          savedContent: content,
          dirty: false,
          error: null,
        });
      }
      get().expandTo(path);
      get().selectOnly(path);
    } catch (err) {
      set({ error: `无法打开文件：${err}` });
    }
  },

  // 系统级打开（启动参数 / 访达双击）：文件不在当前工作区时先挂载其父目录。
  openPath: (path) => serialized(async () => {
    const st = await fs.stat(path).catch(() => null);
    if (!st?.exists || st.isDir) return;
    const dir = pathUtil.parent(path);
    if (get().rootPath !== dir) {
      await get().openFolder(dir).catch(() => {});
    }
    await get().openFile(path);
  }),

  // 内置帮助文档：只读虚拟文档（help:// 前缀），不落盘、不进入文件树。
  openHelp: (name, content) => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    set({ activePath: `help://${name}`, content, savedContent: content, dirty: false, error: null });
  },

  setContent: (text) => {
    const { savedContent, activePath } = get();
    const dirty = text !== savedContent;
    set({ content: text, dirty });
    // 自动保存（500ms 防抖；设置在 UI store 里控制开关，这里默认开启）
    if (dirty && activePath && useUiAutoSave()) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        get().save();
      }, 800);
    }
  },

  // 建立加载基线：编辑器规范化序列化后回写，不标记 dirty、不触发自动保存。
  setBaseline: (text) => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    set({ content: text, savedContent: text, dirty: false });
  },

  save: async () => {
    const { activePath, content, dirty } = get();
    if (!activePath || !dirty) return true;
    try {
      // 保存时插入末尾换行符（偏好设置）
      let out = finalNewlineEnabled && content.length > 0 && !content.endsWith("\n") ? content + "\n" : content;
      const eol = useUi.getState().prefs.defaultEol;
      if (eol === "crlf") {
        out = out.replace(/\r?\n/g, "\r\n");
      }
      await fs.writeFile(activePath, out);
      set({ content: out, savedContent: out, dirty: false });
      return true;
    } catch (err) {
      set({ error: `保存失败：${err}` });
      return false;
    }
  },

  createFile: async (parentDir, name) => {
    const defaultExt = String(useUi.getState().prefs.defaultFileExt ?? "md").replace(/^\./, "") || "md";
    const extWithDot = `.${defaultExt}`;
    const base = name ? (name.includes(".") ? name : `${name}${extWithDot}`) : `未命名${extWithDot}`;
    let candidate = pathUtil.join(parentDir, base);
    let i = 2;
    const stem = pathUtil.stem(base);
    const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : extWithDot;
    while ((await fs.stat(candidate)).exists) {
      candidate = pathUtil.join(parentDir, `${stem} ${i++}${ext}`);
    }
    const ok = await fs.newFile(candidate);
    if (!ok) return null;
    await get().refresh();
    get().selectOnly(candidate);
    await get().openFile(candidate);
    return candidate;
  },

  createFolder: async (parentDir, name) => {
    const base = name ?? "新建文件夹";
    let candidate = pathUtil.join(parentDir, base);
    let i = 2;
    while ((await fs.stat(candidate)).exists) {
      candidate = pathUtil.join(parentDir, `${base} ${i++}`);
    }
    const ok = await fs.newFolder(candidate);
    if (!ok) return null;
    const { expanded } = get();
    const next = new Set(expanded);
    next.add(parentDir);
    next.add(candidate);
    set({ expanded: next });
    await get().refresh();
    get().selectOnly(candidate);
    return candidate;
  },

  rename: async (path, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === pathUtil.name(path)) return false;
    const to = pathUtil.join(pathUtil.parent(path), trimmed);
    if ((await fs.stat(to)).exists) {
      set({ error: `已存在同名文件：${trimmed}` });
      return false;
    }
    const ok = await fs.rename(path, to);
    if (!ok) {
      set({ error: "重命名失败" });
      return false;
    }
    const { activePath, selected, expanded } = get();
    const remap = (p: string) => (p === path || pathUtil.isUnder(p, path) ? to + p.slice(path.length) : p);
    set({
      activePath: activePath ? remap(activePath) : null,
      selected: new Set([...selected].map(remap)),
      expanded: new Set([...expanded].map(remap)),
    });
    await get().refresh();
    return true;
  },

  trash: async (paths) => {
    for (const path of paths) {
      await fs.trash(path);
    }
    const { activePath, selected, expanded } = get();
    const gone = (p: string) => paths.some((t) => p === t || pathUtil.isUnder(p, t));
    set({
      selected: new Set([...selected].filter((p) => !gone(p))),
      expanded: new Set([...expanded].filter((p) => !gone(p))),
      ...(activePath && gone(activePath)
        ? { activePath: null, content: "", savedContent: "", dirty: false }
        : {}),
    });
    await get().refresh();
  },

  move: async (paths, targetDir) => {
    const errors: string[] = [];
    const moved: { from: string; to: string }[] = [];
    const renamed: string[] = [];
    const norm = (p: string) => {
      let s = p.replace(/\\/g, "/").replace(/\/+$/, "");
      if (/^[a-zA-Z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1);
      return s;
    };
    const normTargetDir = norm(targetDir);

    for (const path of paths) {
      const normP = norm(path);
      // 不能移入自身或移入自身的子孙目录
      if (normP === normTargetDir || normTargetDir.startsWith(normP + "/")) continue;

      const normParent = norm(pathUtil.parent(path));
      // 如果目标目录就是当前所在的父目录（原地操作），跳过
      if (normParent === normTargetDir) continue;

      const baseName = pathUtil.name(path);
      let targetName = baseName;
      let to = pathUtil.join(normTargetDir, targetName);
      let normTo = norm(to);

      // 目标路径与源路径相同，跳过
      if (normTo === normP) continue;

      // 如果目标位置已存在同名项目（如不同层级移入）：自动递增编号保存两者，避免阻断
      if ((await fs.stat(to)).exists) {
        const stem = pathUtil.stem(baseName);
        const ext = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".")) : "";
        let counter = 2;
        while ((await fs.stat(to)).exists) {
          targetName = `${stem} ${counter++}${ext}`;
          to = pathUtil.join(normTargetDir, targetName);
        }
        renamed.push(`${baseName} → ${targetName}`);
      }

      if (await fs.move(path, to)) moved.push({ from: path, to });
      else errors.push(`移动失败：${baseName}`);
    }
    if (moved.length) {
      const { activePath, selected, expanded, rootPath } = get();
      const nextExpanded = new Set([...expanded]);
      const normRoot = norm(rootPath);
      if (normTargetDir && normTargetDir !== normRoot) {
        // 目标目录及其所有祖先目录都加入展开列表
        let cur: string | null = normTargetDir;
        while (cur && cur.startsWith(normRoot) && cur !== normRoot) {
          nextExpanded.add(cur);
          const parentDir: string = norm(pathUtil.parent(cur));
          cur = parentDir !== cur ? parentDir : null;
        }
      }
      // 只重映射真正成功的路径；失败项保持原位，避免选中态指向不存在的文件
      const remap = (p: string) => {
        const hit = moved
          .filter(({ from }) => p === from || pathUtil.isUnder(p, from))
          .sort((a, b) => b.from.length - a.from.length)[0];
        return hit ? hit.to + p.slice(hit.from.length) : p;
      };
      const nextSelected = new Set(moved.map((m) => m.to));
      const finalExpanded = new Set([...nextExpanded].map(remap));

      // 单步原子更新：直接在后台把已展开及新展开的子目录全部读取完毕后一次性呈现，绝无闪烁跳变！
      await get().refresh(finalExpanded, {
        activePath: activePath ? remap(activePath) : null,
        selected: nextSelected.size ? nextSelected : new Set([...selected].map(remap)),
        error: errors[0] ?? null,
      });
    } else if (errors.length) {
      set({ error: errors[0] });
    }
    return { moved: moved.length, errors, renamed };
  },

  duplicate: async (path) => {
    const result = await fs.duplicate(path);
    if (result) {
      await get().refresh();
      get().selectOnly(result);
    }
  },

  loadRecent: async () => {
    try {
      const { folders } = await fs.recentFolders();
      set({ recentFolders: folders ?? [] });
    } catch {
      /* ignore */
    }
  },

  clearRecent: async () => {
    try {
      await fs.clearRecentHistory();
      set({ recentFolders: [] });
    } catch {
      /* ignore */
    }
  },
}));

/* 自动保存开关由 UI store 提供；避免循环依赖用惰性读取。 */
let autoSaveEnabled = true;
export function setAutoSave(enabled: boolean) {
  autoSaveEnabled = enabled;
}
let finalNewlineEnabled = true;
export function setFinalNewline(enabled: boolean) {
  finalNewlineEnabled = enabled;
}
let restoreSessionEnabled = true;
export function setRestoreSession(enabled: boolean) {
  restoreSessionEnabled = enabled;
}
function useUiAutoSave(): boolean {
  return autoSaveEnabled;
}