/**
 * Windows 自定义标题栏的菜单模型。
 *
 * 数据源是 Rust `menu.dump`（spec + 翻译 + 最近列表 + 主题缓存 + 快捷键归一化），
 * 本模块负责：加载/缓存树、叠加渲染层推送的 checked/enabled 状态（menu.update 事件）、
 * 执行条目（clickCode 直接本地执行，role 映射到窗口/剪贴板操作）、全局快捷键表。
 */
import { invoke } from "@/bridge/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type MenuNodeType = "item" | "check" | "sep" | "sub" | "role";

export interface MenuNode {
  type: MenuNodeType;
  id?: string;
  label: string;
  accel?: string;
  enabled?: boolean;
  checked?: boolean;
  role?: string;
  clickCode?: string;
  items?: MenuNode[];
}

let tree: MenuNode[] = [];
const overlay = new Map<string, { checked?: boolean; enabled?: boolean }>();
const listeners = new Set<() => void>();

function bump() {
  rebuildAccels();
  listeners.forEach((fn) => fn());
}

export function subscribeMenu(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadMenuTree(): Promise<MenuNode[]> {
  try {
    const data = await invoke<MenuNode[]>("menu.dump", {});
    if (Array.isArray(data)) tree = data;
  } catch (err) {
    console.warn("[menuModel] menu.dump 失败:", err);
  }
  bump();
  return tree;
}

function applyOverlay(nodes: MenuNode[]): MenuNode[] {
  if (overlay.size === 0) return nodes;
  return nodes.map((n) => {
    const o = n.id ? overlay.get(n.id) : undefined;
    const copy: MenuNode = { ...n };
    if (o?.checked !== undefined) copy.checked = o.checked;
    if (o?.enabled !== undefined) copy.enabled = o.enabled;
    if (n.items) copy.items = applyOverlay(n.items);
    return copy;
  });
}

export function menuTree(): MenuNode[] {
  return applyOverlay(tree);
}

// 渲染层的 JSBridge.menu.update 会广播到这里（Windows 没有原生菜单可更新，
// 状态叠加在内存里由 HTML 菜单呈现）。
if (typeof window !== "undefined") {
  window.addEventListener("am-menu-update", (event) => {
    const detail = (event as CustomEvent).detail as
      | Record<string, { state?: boolean; enabled?: boolean }>
      | undefined;
    if (!detail) return;
    for (const [id, st] of Object.entries(detail)) {
      if (!st) continue;
      const prev = overlay.get(id) ?? {};
      const next = { ...prev };
      if (typeof st.state === "boolean") next.checked = st.state;
      if (typeof st.enabled === "boolean") next.enabled = st.enabled;
      overlay.set(id, next);
    }
    bump();
  });
}

/** 执行一个菜单条目：clickCode 本地执行；role 映射到窗口/剪贴板命令。 */
export function execNode(n: MenuNode) {
  if (n.enabled === false || n.type === "sep" || n.type === "sub") return;
  if (n.clickCode) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(n.clickCode)();
    } catch (err) {
      console.warn("[menuModel] clickCode 执行失败:", n.id, err);
    }
    return;
  }
  if (n.role) void runRole(n.role);
}

async function runRole(role: string) {
  const w = getCurrentWindow();
  switch (role) {
    case "undo":
    case "redo":
    case "cut":
    case "copy":
    case "paste":
      try {
        document.execCommand(role);
      } catch {
        /* 焦点不在可编辑区时忽略 */
      }
      break;
    case "selectAll":
      try {
        document.execCommand("selectAll");
      } catch {
        /* 忽略 */
      }
      break;
    case "minimize":
      await w.minimize().catch(() => {});
      break;
    case "zoom":
    case "maximize":
      await w.toggleMaximize().catch(() => {});
      break;
    case "togglefullscreen": {
      const fs = await w.isFullscreen().catch(() => false);
      await w.setFullscreen(!fs).catch(() => {});
      break;
    }
    case "quit":
      invoke("app.quit", {}).catch(() => w.close());
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 全局快捷键（仅带 clickCode 的条目；role 项交给编辑器/浏览器原生键位，避免双触发）
// ---------------------------------------------------------------------------

interface AccelBinding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
  run: () => void;
}

let accels: AccelBinding[] = [];

function parseAccel(raw: string, run: () => void): AccelBinding | null {
  const parts = raw.split("+");
  const key = parts[parts.length - 1]?.toLowerCase();
  if (!key) return null;
  const lower = raw.toLowerCase();
  return {
    ctrl: /(^|\+)ctrl(\+|$)/.test(lower),
    shift: /(^|\+)shift(\+|$)/.test(lower),
    alt: /(^|\+)alt(\+|$)/.test(lower),
    meta: /(^|\+)(super|meta)(\+|$)/.test(lower),
    key,
    run,
  };
}

function rebuildAccels() {
  const out: AccelBinding[] = [];
  const walk = (nodes: MenuNode[]) => {
    for (const n of nodes) {
      if (n.accel && n.clickCode && n.type !== "sep" && n.type !== "sub") {
        const binding = parseAccel(n.accel, () => execNode(n));
        if (binding) out.push(binding);
      }
      if (n.items) walk(n.items);
    }
  };
  walk(tree);
  accels = out;
}

let shortcutsInstalled = false;

/** 安装全局快捷键分发（bubble 阶段，晚于应用内已有处理器；被处理过的事件不重复触发）。 */
export function installMenuShortcuts(): () => void {
  if (shortcutsInstalled) return () => {};
  shortcutsInstalled = true;
  const handler = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat) return;
    const key = e.key.toLowerCase();
    for (const a of accels) {
      if (a.ctrl !== e.ctrlKey || a.shift !== e.shiftKey || a.alt !== e.altKey || a.meta !== e.metaKey) continue;
      if (a.key !== key) continue;
      e.preventDefault();
      a.run();
      return;
    }
  };
  window.addEventListener("keydown", handler);
  return () => {
    shortcutsInstalled = false;
    window.removeEventListener("keydown", handler);
  };
}
