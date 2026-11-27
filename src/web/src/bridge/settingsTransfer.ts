/**
 * 偏好设置导出 / 导入：JSON 快照（主题、字号、宽度、开关与全部 prefs）。
 * 桌面端走原生保存/打开对话框 + fs 读写；浏览器端走下载 / 文件选择。
 */
import { useUi } from "@/stores/ui";
import { applyTheme, getAllThemes, getCurrentThemeId, getThemeMode, setThemeMode, type ThemeMode } from "@/theme/registry";
import { invoke, isTauri } from "@/bridge/ipc";
import { fs } from "@/bridge/fs";

export interface SettingsSnapshot {
  theme: string;
  themeMode: ThemeMode;
  fontSize: number;
  editorWidth: string;
  lineNumbers: boolean;
  autoSave: boolean;
  typewriterMode: boolean;
  toolbarVisible?: boolean;
  statusBarVisible?: boolean;
  wordCountVisible?: boolean;
  prefs: Record<string, boolean | string | number>;
}

export function collectSettings(): SettingsSnapshot {
  const s = useUi.getState();
  return {
    theme: getCurrentThemeId(),
    themeMode: getThemeMode(),
    fontSize: s.fontSize,
    editorWidth: s.editorWidth,
    lineNumbers: s.lineNumbers,
    autoSave: s.autoSave,
    typewriterMode: s.typewriterMode,
    toolbarVisible: s.toolbarVisible,
    statusBarVisible: s.statusBarVisible,
    wordCountVisible: s.wordCountVisible,
    prefs: { ...s.prefs },
  };
}

export type TransferResult = { status: "saved" | "imported" | "canceled" | "error"; error?: string };

export async function exportSettings(): Promise<TransferResult> {
  const payload = JSON.stringify(
    { app: "ArborMark", kind: "settings", version: 1, exportedAt: new Date().toISOString(), settings: collectSettings() },
    null,
    2,
  );
  try {
    if (isTauri()) {
      const r = await invoke<{ canceled: boolean; filePath: string | null }>("dialog.showSaveDialog", {
        title: "导出设置",
        defaultPath: "arbormark-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (r.canceled || !r.filePath) return { status: "canceled" };
      await fs.writeFile(r.filePath, payload);
    } else {
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "arbormark-settings.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    return { status: "saved" };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

export function applySettings(raw: unknown): { ok: boolean; error?: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "文件内容不是有效对象" };
  const file = raw as { app?: string; settings?: unknown };
  if (file.app && file.app !== "ArborMark") return { ok: false, error: "不是 ArborMark 设置文件" };
  const s = (file.settings ?? raw) as Record<string, unknown>;
  if (!s || typeof s !== "object") return { ok: false, error: "缺少 settings 字段" };
  const ui = useUi.getState();
  if (s.prefs && typeof s.prefs === "object") {
    for (const [k, v] of Object.entries(s.prefs as Record<string, unknown>)) {
      if (typeof v === "boolean" || typeof v === "string" || typeof v === "number") ui.setPref(k, v);
    }
  }
  if (typeof s.fontSize === "number") ui.setFontSize(s.fontSize);
  if (typeof s.editorWidth === "string" && ["standard", "wide", "wider", "full"].includes(s.editorWidth)) {
    ui.setEditorWidth(s.editorWidth as SettingsSnapshot["editorWidth"] as never);
  }
  if (typeof s.lineNumbers === "boolean" && s.lineNumbers !== useUi.getState().lineNumbers) ui.toggleLineNumbers();
  if (typeof s.autoSave === "boolean") ui.setAutoSave(s.autoSave);
  if (typeof s.typewriterMode === "boolean" && s.typewriterMode !== useUi.getState().typewriterMode) ui.toggleTypewriterMode();
  if (typeof s.toolbarVisible === "boolean" && s.toolbarVisible !== useUi.getState().toolbarVisible) ui.toggleToolbar();
  if (typeof s.statusBarVisible === "boolean" && s.statusBarVisible !== useUi.getState().statusBarVisible) ui.toggleStatusBar();
  if (typeof s.wordCountVisible === "boolean" && s.wordCountVisible !== useUi.getState().wordCountVisible) ui.toggleWordCount();
  if (typeof s.theme === "string" && getAllThemes().some((t) => t.id === s.theme)) applyTheme(s.theme);
  if (s.themeMode === "light" || s.themeMode === "dark" || s.themeMode === "system") setThemeMode(s.themeMode);
  return { ok: true };
}

export async function pickAndImportSettings(): Promise<TransferResult> {
  try {
    let text: string | null = null;
    if (isTauri()) {
      const r = await invoke<{ canceled: boolean; filePaths: string[] }>("dialog.showOpenDialog", {
        title: "导入设置",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (r.canceled || !r.filePaths[0]) return { status: "canceled" };
      text = await fs.readFile(r.filePaths[0]);
    } else {
      text = await new Promise<string | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("cancel", () => resolve(null));
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          f.text().then(resolve, () => resolve(null));
        };
        input.click();
      });
      if (text == null) return { status: "canceled" };
    }
    const res = applySettings(JSON.parse(text));
    return res.ok ? { status: "imported" } : { status: "error", error: res.error };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}