/**
 * 选中文本网络搜索：可配置引擎（百度/Google/Bing/DuckDuckGo/DeepSeek/自定义）。
 * 配置以 JSON 字符串存于 prefs.webSearchConfig（便于导出/导入），此处提供解析与默认值。
 */
import { useUi } from "@/stores/ui";
import { fs } from "@/bridge/fs";
import { isTauri } from "@/bridge/ipc";

export interface SearchEngine { id: string; name: string; url: string; enabled: boolean; builtin?: boolean }
export interface WebSearchConfig {
  enabled: boolean;
  bubble: boolean;
  contextMenu: boolean;
  defaultId: string;
  engines: SearchEngine[];
}

export const DEFAULT_ENGINES: SearchEngine[] = [
  { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s", enabled: true, builtin: true },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s", enabled: true, builtin: true },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s", enabled: true, builtin: true },
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s", enabled: false, builtin: true },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/?q={关键词}&autosend=1&search=1&thinking=1", enabled: true, builtin: true },
  { id: "github", name: "GitHub", url: "https://github.com/search?q=%s", enabled: false, builtin: true },
];

export function defaultConfig(): WebSearchConfig {
  return { enabled: true, bubble: true, contextMenu: true, defaultId: "baidu", engines: DEFAULT_ENGINES.map((e) => ({ ...e })) };
}

export function readConfig(): WebSearchConfig {
  const raw = useUi.getState().prefs.webSearchConfig;
  const base = defaultConfig();
  if (typeof raw !== "string" || !raw.trim()) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<WebSearchConfig>;
    const engines = Array.isArray(parsed.engines) && parsed.engines.length ? parsed.engines.filter((e) => e && e.id && e.url) : base.engines;
    // 迁移旧版 DeepSeek 默认地址到带 autosend/search/thinking 的新模板
    for (const e of engines) {
      if (e.id === "deepseek" && /^https:\/\/chat\.deepseek\.com\/\?prompt=/.test(e.url)) {
        e.url = base.engines.find((b) => b.id === "deepseek")!.url;
      }
    }
    return {
      enabled: parsed.enabled !== false,
      bubble: parsed.bubble !== false,
      contextMenu: parsed.contextMenu !== false,
      defaultId: typeof parsed.defaultId === "string" ? parsed.defaultId : base.defaultId,
      engines,
    };
  } catch {
    return base;
  }
}

export function writeConfig(cfg: WebSearchConfig) {
  useUi.getState().setPref("webSearchConfig", JSON.stringify(cfg));
}

export function enabledEngines(cfg: WebSearchConfig): SearchEngine[] {
  return cfg.engines.filter((e) => e.enabled);
}

export function defaultEngine(cfg: WebSearchConfig): SearchEngine | undefined {
  return cfg.engines.find((e) => e.id === cfg.defaultId && e.enabled) ?? enabledEngines(cfg)[0];
}

export function buildUrl(engine: SearchEngine, text: string): string {
  const q = encodeURIComponent(text.trim());
  if (/%s|\{关键词\}|\{query\}|\{keyword\}/.test(engine.url)) {
    return engine.url.replace(/%s|\{关键词\}|\{query\}|\{keyword\}/g, q);
  }
  return engine.url + q;
}

/** 引擎 CRUD：更新 / 删除 / 恢复内置默认。 */
export function updateEngine(id: string, patch: Partial<SearchEngine>) {
  const cfg = readConfig();
  writeConfig({ ...cfg, engines: cfg.engines.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}
export function removeEngine(id: string) {
  const cfg = readConfig();
  writeConfig({ ...cfg, engines: cfg.engines.filter((e) => e.id !== id), defaultId: cfg.defaultId === id ? (cfg.engines.find((e) => e.id !== id && e.enabled)?.id ?? cfg.defaultId) : cfg.defaultId });
}
export function resetEngines() {
  const cfg = readConfig();
  writeConfig({ ...cfg, engines: defaultConfig().engines, defaultId: "baidu" });
}

export async function openSearch(engine: SearchEngine, text: string) {
  const url = buildUrl(engine, text);
  if (isTauri()) await fs.openExternal(url);
  else window.open(url, "_blank", "noopener");
}