import { useRef, useState, useSyncExternalStore } from "react";
import {
  Palette,
  Download,
  Upload,
  FolderOpen,
  Trash2,
  Check,
  Sun,
  Moon,
  Monitor,
  FileJson2,
  Sparkles,
} from "lucide-react";
import {
  getAllThemes,
  getCurrentThemeId,
  getThemeMode,
  applyTheme,
  setThemeMode,
  subscribeThemes,
  isDarkActive,
  addUserTheme,
  removeUserTheme,
  exportTheme,
  themeScaffold,
  resolveTokens,
  type ThemeMode,
} from "@/theme/registry";
import type { ThemeDefinition } from "@/theme/contract";
import { useUi } from "@/stores/ui";
import { fs } from "@/bridge/fs";
import { isTauri } from "@/bridge/ipc";
import { Tooltip } from "../common";
import { useLang } from "@/bridge/i18n";

/** 主题画廊：实时预览卡片 + 导入 / 导出 / 删除。 */
export function ThemeGallery() {
  const themes = useSyncExternalStore(subscribeThemes, getAllThemes);
  const currentId = useSyncExternalStore(subscribeThemes, getCurrentThemeId);
  const mode = useSyncExternalStore(subscribeThemes, getThemeMode);
  const dark = useSyncExternalStore(subscribeThemes, isDarkActive);
  const toast = useUi((s) => s.toast);
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of [...files]) {
      try {
        const text = await file.text();
        if (/\.json$/i.test(file.name)) {
          const result = addUserTheme(JSON.parse(text));
          if (result.ok) toast(`已导入主题 ${file.name}`, "success");
          else toast(`导入失败：${result.errors[0]}`, "danger");
        } else if (/\.css$/i.test(file.name)) {
          const { parseCssTheme } = await import("@/theme/registry");
          const theme = parseCssTheme(text, file.name);
          if (theme) {
            const result = addUserTheme(theme);
            if (result.ok) toast(`已导入主题 ${file.name}`, "success");
            else toast(`导入失败：${result.errors[0]}`, "danger");
          } else toast("CSS 中未找到 --am-* token", "warning");
        }
      } catch {
        toast(`无法解析 ${file.name}`, "danger");
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const download = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openThemeFolder = async () => {
    try {
      const dir = await fs.themeDir();
      if (isTauri()) fs.showInFolder(dir);
      else toast(`主题目录：${dir}`, "info");
    } catch {
      toast("无法打开主题目录", "warning");
    }
  };

  return (
    <div className="space-y-4">
      {/* 明暗模式 */}
      <div>
        <p className="mb-2 text-[12px] font-medium text-ink-secondary">{t("外观模式")}</p>
        <div className="flex gap-1.5">
          {(
            [
              ["light", t("浅色"), <Sun size={13} key="l" />],
              ["dark", t("深色"), <Moon size={13} key="d" />],
              ["system", t("跟随系统"), <Monitor size={13} key="s" />],
            ] as [ThemeMode, string, React.ReactNode][]
          ).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => setThemeMode(m)}
              aria-pressed={mode === m}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] transition-colors ${
                mode === m
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-secondary hover:bg-hover"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* 主题卡片 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-medium text-ink-secondary">
            {t("主题")} <span className="text-ink-muted">（{themes.length}）</span>
          </p>
          <div className="flex gap-1">
            <Tooltip label={t("导入主题 JSON / CSS")}>
              <button
                aria-label={t("导入主题")}
                onClick={() => fileRef.current?.click()}
                className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary transition-colors hover:bg-hover"
              >
                <Upload size={12} /> {t("导入")}
              </button>
            </Tooltip>
            <Tooltip label={t("导出主题模板（JSON）")}>
              <button
                aria-label={t("导出主题模板")}
                onClick={() => {
                  download("my-theme.json", themeScaffold());
                  toast(t("模板已导出，修改后导入即可"), "success");
                }}
                className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary transition-colors hover:bg-hover"
              >
                <FileJson2 size={12} /> {t("模板")}
              </button>
            </Tooltip>
            <Tooltip label={t("打开主题文件夹")}>
              <button
                aria-label={t("打开主题文件夹")}
                onClick={openThemeFolder}
                className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary transition-colors hover:bg-hover"
              >
                <FolderOpen size={12} />
              </button>
            </Tooltip>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.css"
          multiple
          className="hidden"
          onChange={(e) => importFiles(e.target.files)}
          aria-label="选择主题文件"
        />
        <div className="grid grid-cols-2 gap-2.5">
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              active={theme.id === currentId}
              dark={dark}
              onDelete={
                theme.builtin
                  ? undefined
                  : () => {
                      if (confirmDelete === theme.id) {
                        removeUserTheme(theme.id);
                        setConfirmDelete(null);
                        toast(t("主题已删除"), "success");
                      } else {
                        setConfirmDelete(theme.id);
                        setTimeout(() => setConfirmDelete(null), 3000);
                      }
                    }
              }
              deleteConfirm={confirmDelete === theme.id}
              onExport={() => {
                download(`${theme.id}.json`, exportTheme(theme.id));
                toast(t("主题已导出"), "success");
              }}
            />
          ))}
        </div>
      </div>

      <p className="flex items-start gap-1.5 rounded-md bg-accent-soft px-3 py-2 text-[11px] leading-relaxed text-ink-secondary">
        <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" />
        {t("主题完全开放：每个主题只是一组设计 token（--am-*）。导出模板、修改配色、导入即可生效；也可以把 JSON / CSS 文件放入主题文件夹，重启后自动识别。")}
      </p>
    </div>
  );
}

function ThemeCard({
  theme,
  active,
  dark,
  onDelete,
  deleteConfirm,
  onExport,
}: {
  theme: ThemeDefinition;
  active: boolean;
  dark: boolean;
  onDelete?: () => void;
  deleteConfirm: boolean;
  onExport: () => void;
}) {
  const tokens = resolveTokens(theme, dark);
  const { t } = useLang();
  const style = Object.fromEntries(
    Object.entries(tokens).filter(([, v]) => v),
  ) as React.CSSProperties;

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border transition-all ${
        active ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong"
      }`}
    >
      <button
        onClick={() => applyTheme(theme.id)}
        className="block w-full text-left"
        aria-label={`应用主题 ${theme.name}`}
        aria-pressed={active}
      >
        {/* 迷你预览：用主题自己的 token 渲染 */}
        <div style={style} className="pointer-events-none h-[86px] p-2.5" aria-hidden>
          <div
            className="flex h-full gap-1.5 rounded-md p-1.5"
            style={{ background: "var(--am-bg)", border: "1px solid var(--am-border)" }}
          >
            <div
              className="w-[26%] rounded-sm p-1"
              style={{ background: "var(--am-bg-sidebar)" }}
            >
              <div className="mb-1 h-1 w-4/5 rounded-full" style={{ background: "var(--am-text-muted)", opacity: 0.5 }} />
              <div className="mb-1 h-1 w-full rounded-full" style={{ background: "var(--am-accent)", opacity: 0.8 }} />
              <div className="h-1 w-3/5 rounded-full" style={{ background: "var(--am-text-muted)", opacity: 0.4 }} />
            </div>
            <div className="flex-1 rounded-sm p-1.5" style={{ background: "var(--am-bg-editor)" }}>
              <div className="mb-1 h-1.5 w-3/5 rounded-full" style={{ background: "var(--am-md-heading)" }} />
              <div className="mb-1 h-1 w-full rounded-full" style={{ background: "var(--am-text)", opacity: 0.55 }} />
              <div className="mb-1 h-1 w-4/5 rounded-full" style={{ background: "var(--am-text)", opacity: 0.4 }} />
              <div className="mt-1.5 flex gap-1">
                <span className="h-2 w-6 rounded-sm" style={{ background: "var(--am-accent)" }} />
                <span className="h-2 w-4 rounded-sm" style={{ background: "var(--am-accent-soft)" }} />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-t border-line bg-elevated px-2.5 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">{theme.name}</span>
            <span className="block truncate text-[10px] text-ink-muted">
              {theme.builtin ? t("内置") : theme.author ?? t("自定义")} ·{" "}
              {theme.appearance === "auto" ? t("明 / 暗") : theme.appearance === "dark" ? t("深色") : t("浅色")}
            </span>
          </span>
          {active && <Check size={14} className="shrink-0 text-accent" />}
        </div>
      </button>
      {/* 悬浮操作 */}
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip label={t("导出此主题")}>
          <button
            aria-label={`${t("导出主题")} ${theme.name}`}
            onClick={onExport}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-elevated text-ink-secondary shadow-menu hover:text-ink"
          >
            <Download size={12} />
          </button>
        </Tooltip>
        {onDelete && (
          <Tooltip label={deleteConfirm ? t("再次点击确认删除") : t("删除此主题")}>
            <button
              aria-label={`${t("删除主题")} ${theme.name}`}
              onClick={onDelete}
              className={`flex h-6 w-6 items-center justify-center rounded-md border shadow-menu ${
                deleteConfirm
                  ? "border-danger bg-danger text-white"
                  : "border-line bg-elevated text-ink-secondary hover:text-danger"
              }`}
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}