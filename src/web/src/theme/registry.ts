import {
  DEFAULT_TOKENS,
  REQUIRED_COLOR_TOKENS,
  type ThemeDefinition,
  type ThemeTokens,
} from "./contract";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./presets";
import { isTauri, invoke } from "@/bridge/ipc";

/**
 * 主题注册表：内置主题 + 用户自定义主题的加载、校验、应用与持久化。
 *
 * 应用机制：
 *  - data-theme / data-theme-mode 属性挂到 <html>；
 *  - token 以 CSS 变量写入 :root（专用 <style id="am-theme-vars">）；
 *  - 主题的扩展 CSS 注入 <style id="am-theme-css">（已限定 [data-theme] 作用域）。
 *
 * 用户主题来源：
 *  - Tauri：userData/themes/*.json（{...ThemeDefinition}）与 *.css（纯 token 文件）；
 *  - 浏览器：localStorage（画廊导入 / 导出）。
 */

export type ThemeMode = "light" | "dark" | "system";

const LS_THEME = "arbor.theme";
const LS_MODE = "arbor.theme-mode";
const LS_USER_THEMES = "arbor.user-themes";

let userThemes: ThemeDefinition[] = [];
let currentThemeId = DEFAULT_THEME_ID;
let currentMode: ThemeMode = "system";
const listeners = new Set<() => void>();

// useSyncExternalStore 要求 getSnapshot 返回缓存值（不能每次新建数组），
// 否则触发无限重渲染。主题集合变化时重建快照。
let themesSnapshot: ThemeDefinition[] = [...BUILTIN_THEMES];
function rebuildThemesSnapshot() {
  themesSnapshot = [...BUILTIN_THEMES, ...userThemes];
}

export function subscribeThemes(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function emit() {
  rebuildThemesSnapshot();
  listeners.forEach((fn) => fn());
}

export function getAllThemes(): ThemeDefinition[] {
  return themesSnapshot;
}
export function getTheme(id: string): ThemeDefinition | undefined {
  return getAllThemes().find((t) => t.id === id);
}
export function getCurrentThemeId() {
  return currentThemeId;
}
export function getThemeMode() {
  return currentMode;
}
export function isDarkActive(): boolean {
  if (currentMode === "dark") return true;
  if (currentMode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 解析某主题在给定明暗下的有效 token（含默认兜底）。 */
export function resolveTokens(theme: ThemeDefinition, dark: boolean): ThemeTokens {
  const set = dark
    ? theme.dark ?? theme.light ?? {}
    : theme.light ?? theme.dark ?? {};
  return { ...DEFAULT_TOKENS, ...set };
}

function ensureStyleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/** 颜色串的相对亮度（0~1）：支持 #rgb/#rrggbb/rgb()/hsl()；解析不了返回 null。 */
function colorLuminance(input: string): number | null {
  const s = (input || "").trim().toLowerCase();
  if (!s) return null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgb) {
    const nums = rgb[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(parseFloat);
    if (nums.length === 3 && nums.every((n) => !Number.isNaN(n))) {
      return (0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2]) / 255;
    }
    return null;
  }
  const hsl = /^hsla?\(([^)]+)\)$/.exec(s);
  if (hsl) {
    const nums = hsl[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(parseFloat);
    if (nums.length >= 3 && nums.every((n) => !Number.isNaN(n))) return nums[2] / 100;
  }
  return null;
}

/** 应用主题 + 明暗模式到 DOM。 */
export function applyTheme(themeId: string, mode: ThemeMode = currentMode) {
  const theme = getTheme(themeId) ?? getTheme(DEFAULT_THEME_ID)!;
  currentThemeId = theme.id;
  currentMode = mode;

  // 主题只提供单一外观时，锁定到该外观
  const dark =
    theme.appearance === "dark"
      ? true
      : theme.appearance === "light"
        ? false
        : mode === "dark"
          ? true
          : mode === "light"
            ? false
            : window.matchMedia("(prefers-color-scheme: dark)").matches;

  const tokens = resolveTokens(theme, dark);
  const vars = Object.entries(tokens)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  ensureStyleEl("am-theme-vars").textContent = `:root {\n${vars}\n}`;
  ensureStyleEl("am-theme-css").textContent = theme.css ?? "";

  const root = document.documentElement;
  root.setAttribute("data-theme", theme.id);
  root.setAttribute("data-theme-mode", dark ? "dark" : "light");
  root.style.backgroundColor = (tokens["--am-bg"] as string) || "";
  root.style.colorScheme = dark ? "dark" : "light";

  try {
    localStorage.setItem(LS_THEME, theme.id);
    localStorage.setItem(LS_MODE, mode);
  } catch {
    /* 隐私模式下忽略 */
  }

  // 通知原生窗口跟随明暗（标题栏 / 菜单栏）：轻量防抖合并，避免连续切主题引起原生消息风暴与卡顿
  if (isTauri()) {
    const bg = String(tokens["--am-bg-editor"] ?? tokens["--am-bg"] ?? "");
    const lum = colorLuminance(bg);
    const nativeDark = lum === null ? dark : lum < 0.5;
    syncTauriTheme(nativeDark, theme.id);
  }
  // 通知依赖烘焙配色的视图（Mermaid 等）重渲染
  window.dispatchEvent(new CustomEvent("am-theme-change"));
  emit();
}

let tauriSyncTimer: ReturnType<typeof setTimeout> | null = null;
function syncTauriTheme(nativeDark: boolean, themeId: string) {
  if (tauriSyncTimer) clearTimeout(tauriSyncTimer);
  tauriSyncTimer = setTimeout(() => {
    invoke("theme.setThemeSource", { mode: nativeDark ? "dark" : "light" }).catch(() => {});
    invoke("theme.apply", { theme: themeId }).catch(() => {});
  }, 40);
}

// 多窗口跨窗口联动：当任一窗口变更主题或模式时，其他窗口立即无缝应用
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LS_THEME || e.key === LS_MODE) {
      const nextTheme = localStorage.getItem(LS_THEME) || DEFAULT_THEME_ID;
      const nextMode = (localStorage.getItem(LS_MODE) as ThemeMode) || "auto";
      if (nextTheme !== currentThemeId || nextMode !== currentMode) {
        applyTheme(nextTheme, nextMode);
      }
    }
  });
}

export function setThemeMode(mode: ThemeMode) {
  applyTheme(currentThemeId, mode);
}

/** 校验用户主题 JSON；返回错误列表（空 = 通过）。 */
export function validateTheme(input: unknown): { theme?: ThemeDefinition; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { errors: ["主题必须是 JSON 对象"] };
  }
  const raw = input as Record<string, unknown>;
  const id = String(raw.id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  if (!id) errors.push("缺少 id（kebab-case）");
  if (BUILTIN_THEMES.some((t) => t.id === id)) errors.push(`id "${id}" 与内置主题冲突`);
  if (!raw.name || typeof raw.name !== "string") errors.push("缺少 name");
  const appearance = raw.appearance ?? "auto";
  if (!["light", "dark", "auto"].includes(String(appearance))) {
    errors.push("appearance 必须是 light / dark / auto");
  }
  const light = (raw.light ?? undefined) as ThemeTokens | undefined;
  const dark = (raw.dark ?? undefined) as ThemeTokens | undefined;
  if (!light && !dark) errors.push("至少提供 light 或 dark 之一");
  for (const [label, set] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    if (!set) continue;
    for (const key of REQUIRED_COLOR_TOKENS) {
      if (!set[key]) errors.push(`${label} 缺少核心 token ${key}`);
    }
    for (const key of Object.keys(set)) {
      if (!key.startsWith("--am-")) errors.push(`非法 token 名 ${key}（必须以 --am- 开头）`);
    }
  }
  if (raw.css !== undefined && typeof raw.css !== "string") errors.push("css 必须是字符串");
  if (errors.length) return { errors };
  return {
    theme: {
      id,
      name: String(raw.name),
      author: raw.author ? String(raw.author) : undefined,
      description: raw.description ? String(raw.description) : undefined,
      appearance: appearance as ThemeDefinition["appearance"],
      light,
      dark,
      css: raw.css as string | undefined,
    },
    errors: [],
  };
}

/** 解析纯 CSS 主题文件（:root { --am-*: ... } 形式，视为 auto 主题的 light/dark 通用集）。 */
export function parseCssTheme(css: string, fileName: string): ThemeDefinition | null {
  const id = fileName.replace(/\.css$/i, "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!id || BUILTIN_THEMES.some((t) => t.id === id)) return null;
  const tokens: ThemeTokens = {};
  const re = /(--am-[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    (tokens as Record<string, string>)[m[1]] = m[2].trim();
  }
  if (Object.keys(tokens).length === 0) return null;
  // 提取 [data-theme] 作用域之外的自定义规则作为扩展 css（保留作者原样）
  return {
    id: `user-${id}`,
    name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    author: "自定义",
    description: `从 ${fileName} 导入`,
    appearance: "auto",
    light: tokens,
    dark: tokens,
  };
}

function persistUserThemes() {
  try {
    localStorage.setItem(LS_USER_THEMES, JSON.stringify(userThemes));
  } catch {
    /* ignore */
  }
}

export function addUserTheme(theme: ThemeDefinition): { ok: boolean; errors: string[] } {
  const { theme: valid, errors } = validateTheme(theme);
  if (!valid) return { ok: false, errors };
  userThemes = [...userThemes.filter((t) => t.id !== valid.id), valid];
  persistUserThemes();
  emit();
  return { ok: true, errors: [] };
}

export function removeUserTheme(id: string) {
  userThemes = userThemes.filter((t) => t.id !== id);
  persistUserThemes();
  if (currentThemeId === id) applyTheme(DEFAULT_THEME_ID);
  else emit();
}

/** 生成主题模板 JSON（供「导出主题模板」）。 */
export function themeScaffold(): string {
  const base = BUILTIN_THEMES[0];
  const scaffold = {
    id: "my-theme",
    name: "My Theme",
    author: "Your Name",
    description: "一句话描述这个主题的气质。",
    appearance: "auto",
    light: { ...base.light },
    dark: { ...base.dark },
    css: "/* 可选：[data-theme=\"my-theme\"] 作用域下的质感扩展 */\n",
  };
  return JSON.stringify(scaffold, null, 2);
}

/** 导出当前主题为 JSON。 */
export function exportTheme(id: string): string {
  const theme = getTheme(id);
  if (!theme) return "";
  const { builtin: _builtin, ...rest } = theme;
  return JSON.stringify(rest, null, 2);
}

/** 初始化：读取持久化选择 + 加载用户主题。 */
export async function initThemes(): Promise<void> {
  // 1. 用户主题
  try {
    const local = localStorage.getItem(LS_USER_THEMES);
    if (local) {
      const parsed = JSON.parse(local) as unknown[];
      userThemes = parsed
        .map((p) => validateTheme(p).theme)
        .filter((t): t is ThemeDefinition => Boolean(t));
    }
  } catch {
    userThemes = [];
  }

  if (isTauri()) {
    try {
      const dir = await invoke<string>("app.themeDir");
      const entries = await invoke<{ name: string; isDir: boolean }[]>("fs.readDir", {
        path: dir,
      });
      for (const entry of entries) {
        if (entry.isDir) continue;
        if (!/\.(json|css)$/i.test(entry.name)) continue;
        try {
          const text = await invoke<string>("fs.readFile", {
            path: `${dir}/${entry.name}`,
          });
          if (/\.json$/i.test(entry.name)) {
            const { theme } = validateTheme(JSON.parse(text));
            if (theme && !userThemes.some((t) => t.id === theme.id)) userThemes.push(theme);
          } else {
            const theme = parseCssTheme(text, entry.name);
            if (theme && !userThemes.some((t) => t.id === theme.id)) userThemes.push(theme);
          }
        } catch {
          /* 单个主题损坏不影响其余 */
        }
      }
    } catch {
      /* 主题目录不存在时静默 */
    }
  }

  // 2. 持久化选择
  let savedTheme = DEFAULT_THEME_ID;
  let savedMode: ThemeMode = "system";
  try {
    savedTheme = localStorage.getItem(LS_THEME) || DEFAULT_THEME_ID;
    const m = localStorage.getItem(LS_MODE);
    if (m === "light" || m === "dark" || m === "system") savedMode = m;
  } catch {
    /* ignore */
  }
  applyTheme(getTheme(savedTheme) ? savedTheme : DEFAULT_THEME_ID, savedMode);

  // 3. 系统外观变化时跟随（仅 system 模式）
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (currentMode === "system") applyTheme(currentThemeId, "system");
    });
}