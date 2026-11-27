import { useMemo, useState } from "react";
import {
  X,
  Palette,
  PenLine,
  Info,
  Keyboard,
  FileText,
  Settings2,
  Image as ImageIcon,
  Globe,
  FolderOpen,
  FileDown,
  Search,
} from "lucide-react";
import { useUi } from "@/stores/ui";
import { useLang } from "@/bridge/i18n";
import { Modal } from "../common";
import {
  AppearanceSettings,
  FileSettings,
  EditorSettings,
  MarkdownSettings,
  ImageSettings,
  ExportSettings,
} from "./EditorSettingsTabs";
import {
  WebSearchSettings,
  GeneralSettings,
  ShortcutSettings,
  AboutSettings,
} from "./AppSettingsTabs";

const TABS = [
  { id: "file", label: "settings.file", icon: FolderOpen, group: 1 },
  { id: "editor", label: "settings.editor", icon: PenLine, group: 1 },
  { id: "image", label: "settings.image", icon: ImageIcon, group: 1 },
  { id: "markdown", label: "settings.markdown", icon: FileText, group: 1 },
  { id: "export", label: "settings.export", icon: FileDown, group: 1 },
  { id: "appearance", label: "settings.appearance", icon: Palette, group: 1 },
  { id: "search", label: "settings.search", icon: Globe, group: 2 },
  { id: "shortcuts", label: "settings.shortcuts", icon: Keyboard, group: 2 },
  { id: "general", label: "settings.general", icon: Settings2, group: 2 },
  { id: "about", label: "settings.about", icon: Info, group: 2 },
];

const SEARCH_INDEX: { tab: string; title: string; keys: string }[] = [
  { tab: "file", title: "启动选项 / 恢复会话 / 打开新文档", keys: "startup restore new blank folder 启动 目录" },
  { tab: "file", title: "自动保存 / 切换保存 / 恢复草稿 / 末尾换行", keys: "autosave switch draft newline 草稿 保存" },
  { tab: "file", title: "默认扩展名 / 大纲折叠", keys: "extension md markdown txt outline 大纲 折叠" },
  { tab: "file", title: "隐藏文件 / 历史记录 / 拖放行为", keys: "hidden dotfile recent history drag drop 拖入 隐藏" },
  { tab: "editor", title: "缩进宽度 / 自动配对 / 拼写检查", keys: "indent tab autopair bracket markdown spellcheck 缩进 配对 拼写" },
  { tab: "editor", title: "复制 Markdown / 复制整行 / 默认换行符 EOL", keys: "copy markdown whole line lf crlf eol 复制 换行符" },
  { tab: "editor", title: "自动换行 / 行号 / 打字机 / 专注 / 只读", keys: "wrap line numbers typewriter focus readonly 打字机 专注 只读" },
  { tab: "image", title: "插入图片规则 / 复制目录 / 网络图片 / YAML", keys: "image insert assets copy network yaml 图片 插入" },
  { tab: "image", title: "相对路径 / ./ 前缀 / URL 转义 / 图床 PicGo", keys: "relative path escape alt upload picgo 图床 上传" },
  { tab: "markdown", title: "无序列表符号 / 扩展语法 / 链接识别", keys: "bullet list linkify math highlight superscript subscript diagram alert emoji html" },
  { tab: "markdown", title: "代码块默认语言 / 行号 / 自动换行 / Shift+Tab", keys: "codeblock lang line number wrap shift tab indent 代码块" },
  { tab: "markdown", title: "公式自动编号 / physics 宏包 / HTML 公式输出", keys: "math formula numbering physics svg mathml 公式 编号" },
  { tab: "markdown", title: "智能引号 / 智能破折号 / 空白与首行缩进", keys: "smart quotes dashes punctuation linebreak indent 智能标点 首行缩进" },
  { tab: "export", title: "默认导出目录 / 导出后打开目录 / Pandoc 路径", keys: "export folder pandoc docx epub latex pdf html png 导出" },
  { tab: "appearance", title: "主题管理 / 浅色深色模式 / 编辑器字号 / 页面缩放", keys: "theme dark light font size zoom width 主题 字号 缩放 宽度" },
  { tab: "appearance", title: "工具栏 / 状态栏 / 字数统计 / 阅读速度", keys: "toolbar statusbar wordcount outline highlight wpm 状态栏 字数 阅读速度" },
  { tab: "search", title: "选中文本网络搜索 / 自定义搜索引擎", keys: "web search bubble context engine 搜索 气泡" },
  { tab: "shortcuts", title: "自定义快捷键录制 / 重置快捷键", keys: "shortcut keybinding hotkey 快捷键" },
  { tab: "general", title: "界面语言 / 自动更新 / 测试版 / 配置目录 / 备份重置", keys: "language update beta config export import reset 语言 更新 备份 重置" },
  { tab: "about", title: "版本信息 / 欢迎引导", keys: "about version onboarding 关于 版本" },
];

export function SettingsPanel() {
  const { t } = useLang();
  const open = useUi((s) => s.settingsOpen);
  const tab = useUi((s) => s.settingsTab);
  const close = useUi((s) => s.closeSettings);
  const openSettings = useUi((s) => s.openSettings);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_INDEX.filter(
      (item) => item.title.toLowerCase().includes(q) || item.keys.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Modal open={open} onClose={close} width={820} labelledBy="settings-title">
      <div className="relative flex h-[620px] max-h-[85vh]">
        {/* 左侧导航：查找框 + 分组列表 */}
        <nav className="flex w-[184px] shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2.5" aria-label={t("设置分类")}>
          <p id="settings-title" className="mb-2 px-2 pt-1 text-[13px] font-semibold text-ink">
            {t("settings.title")}
          </p>
          <div className="relative mb-2">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("查找设置…")}
              aria-label={t("查找设置…")}
              className="h-7 w-full rounded-md border border-line bg-field pl-7 pr-6 text-[11.5px] text-ink outline-none focus:border-accent"
            />
            {query && (
              <button
                type="button"
                aria-label={t("清除搜索")}
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {query.trim() ? (
            <div className="min-h-0 flex-1 overflow-y-auto space-y-1">
              {matches.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-ink-muted">{t("无匹配设置项")}</p>
              ) : (
                matches.map((m, i) => {
                  const tabMeta = TABS.find((tb) => tb.id === m.tab);
                  return (
                    <button
                      key={`${m.tab}-${i}`}
                      onClick={() => {
                        openSettings(m.tab);
                        setQuery("");
                      }}
                      className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                        tab === m.tab ? "bg-accent-soft text-accent" : "hover:bg-hover text-ink-secondary hover:text-ink"
                      }`}
                    >
                      <span className="block truncate text-[11.5px] font-medium">{t(m.title)}</span>
                      {tabMeta && <span className="block text-[10px] text-ink-muted">{t(tabMeta.label)}</span>}
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <>
              {TABS.map((tb, idx) => {
                const Icon = tb.icon;
                const showDivider = idx > 0 && TABS[idx - 1].group !== tb.group;
                return (
                  <div key={tb.id}>
                    {showDivider && <div className="mx-1.5 my-1.5 h-px bg-line" aria-hidden="true" />}
                    <button
                      onClick={() => openSettings(tb.id)}
                      aria-current={tab === tb.id}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                        tab === tb.id
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-ink-secondary hover:bg-hover hover:text-ink"
                      }`}
                    >
                      <Icon size={14} /> {t(tb.label)}
                    </button>
                  </div>
                );
              })}
              <span className="flex-1" />
            </>
          )}
          <p className="px-2 pt-1 text-[10px] text-ink-muted">ArborMark 4.0</p>
        </nav>

        {/* 固定关闭按钮：不随右侧设置内容滚动 */}
        <button
          aria-label={t("关闭设置")}
          onClick={close}
          className="absolute right-4 top-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-elevated/90 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <X size={15} />
        </button>

        {/* 右侧内容 */}
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {tab === "file" && <FileSettings />}
          {tab === "editor" && <EditorSettings />}
          {tab === "image" && <ImageSettings />}
          {tab === "markdown" && <MarkdownSettings />}
          {tab === "export" && <ExportSettings />}
          {tab === "appearance" && <AppearanceSettings />}
          {tab === "search" && <WebSearchSettings />}
          {tab === "shortcuts" && <ShortcutSettings />}
          {tab === "general" && <GeneralSettings />}
          {tab === "about" && <AboutSettings />}
        </div>
      </div>
    </Modal>
  );
}
