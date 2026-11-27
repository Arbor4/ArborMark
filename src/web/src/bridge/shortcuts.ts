/**
 * 可自定义快捷键定义、序列化与匹配工具。
 * 规范键名格式：Mod+Shift+Alt+Key（Mod 在 macOS 为 ⌘，Windows/Linux 为 Ctrl）。
 */
import { useUi } from "@/stores/ui";

export interface ShortcutDef {
  id: string;
  group: string;
  label: string;
  defaultCombo: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: "file.new", group: "文件", label: "新建文件", defaultCombo: "Mod+N" },
  { id: "file.newWindow", group: "文件", label: "新建窗口", defaultCombo: "Mod+Shift+N" },
  { id: "file.openFolder", group: "文件", label: "打开文件夹", defaultCombo: "Mod+O" },
  { id: "file.save", group: "文件", label: "保存", defaultCombo: "Mod+S" },
  { id: "file.quickOpen", group: "文件", label: "快速打开", defaultCombo: "Mod+P" },
  { id: "file.globalSearch", group: "文件", label: "全局搜索", defaultCombo: "Mod+Shift+F" },
  { id: "edit.find", group: "编辑", label: "查找（当前文件）", defaultCombo: "Mod+F" },
  { id: "edit.replace", group: "编辑", label: "替换（当前文件）", defaultCombo: "Mod+R" },
  { id: "view.toggleChrome", group: "视图", label: "收起 / 展开侧边栏与活动栏", defaultCombo: "Mod+\\" },
  { id: "view.toggleSidebar", group: "视图", label: "收起 / 展开侧边栏", defaultCombo: "Mod+Shift+L" },
  { id: "view.outlinePanel", group: "视图", label: "大纲面板", defaultCombo: "Mod+Shift+1" },
  { id: "view.filesPanel", group: "视图", label: "文件面板", defaultCombo: "Mod+Shift+2" },
  { id: "view.toggleSource", group: "视图", label: "编辑 / 源码", defaultCombo: "Mod+/" },
  { id: "view.focusMode", group: "视图", label: "专注模式", defaultCombo: "Mod+Shift+D" },
  { id: "view.preferences", group: "视图", label: "偏好设置", defaultCombo: "Mod+," },
];

export function readCustomShortcuts(): Record<string, string> {
  const raw = useUi.getState().prefs.customShortcuts;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getShortcutCombo(id: string): string {
  const custom = readCustomShortcuts();
  const def = SHORTCUT_DEFS.find((d) => d.id === id)?.defaultCombo ?? "";
  return custom[id]?.trim() || def;
}

export function setShortcutCombo(id: string, combo: string | null) {
  const cur = readCustomShortcuts();
  if (!combo) {
    delete cur[id];
  } else {
    cur[id] = combo;
  }
  useUi.getState().setPref("customShortcuts", JSON.stringify(cur));
}

export function resetAllShortcuts() {
  useUi.getState().setPref("customShortcuts", "{}");
}

function normalizeKeyName(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function eventToCombo(e: KeyboardEvent): string | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !e.altKey && !/^F\d{1,2}$/.test(e.key)) return null;
  const parts: string[] = [];
  if (mod) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(normalizeKeyName(e.key));
  return parts.join("+");
}

const SHIFTED_SYMBOL_TO_KEY: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split("+").filter(Boolean);
  const keyPart = parts[parts.length - 1] ?? "";
  const needMod = parts.includes("Mod");
  const needShift = parts.includes("Shift");
  const needAlt = parts.includes("Alt");
  const hasMod = e.metaKey || e.ctrlKey;
  if (hasMod !== needMod || e.shiftKey !== needShift || e.altKey !== needAlt) return false;
  const pressed = normalizeKeyName(SHIFTED_SYMBOL_TO_KEY[e.key] ?? e.key);
  return pressed.toUpperCase() === keyPart.toUpperCase();
}

export function formatCombo(combo: string, isMac: boolean): string {
  const parts = combo.split("+").filter(Boolean);
  if (isMac) {
    return parts
      .map((p) => (p === "Mod" ? "⌘" : p === "Shift" ? "⇧" : p === "Alt" ? "⌥" : p))
      .join("");
  }
  return parts.map((p) => (p === "Mod" ? "Ctrl" : p)).join("+");
}
