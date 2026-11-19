import { useState, useRef } from "react";
import { X, Palette, PenLine, Info, Keyboard, Minus, Plus, TreePine, FileText, Settings2, Image as ImageIcon, Download, Upload, Sparkles, Globe, Trash2, Compass, CircleHelp, FolderOpen, FileDown, RotateCcw } from "lucide-react";
import { useUi, EDITOR_WIDTHS } from "@/stores/ui";
import { useWorkspace, setAutoSave as setWorkspaceAutoSave, setFinalNewline } from "@/stores/workspace";
import { exportSettings, pickAndImportSettings } from "@/bridge/settingsTransfer";
import { readConfig, writeConfig, defaultConfig, type WebSearchConfig } from "@/bridge/webSearch";
import { CelebrationLayer, type CelebrationHandle } from "./Celebration";
import { showOnboarding } from "../Onboarding";
import { useLang } from "@/bridge/i18n";
import { Modal, Switch, Checkbox } from "../common";
import { ThemeGallery } from "./ThemeGallery";

const TABS = [
  { id: "appearance", label: "settings.appearance", icon: Palette },
  { id: "file", label: "settings.file", icon: FolderOpen },
  { id: "editor", label: "settings.editor", icon: PenLine },
  { id: "markdown", label: "settings.markdown", icon: FileText },
  { id: "image", label: "settings.image", icon: ImageIcon },
  { id: "export", label: "settings.export", icon: FileDown },
  { id: "search", label: "settings.search", icon: Globe },
  { id: "general", label: "settings.general", icon: Settings2 },
  { id: "shortcuts", label: "settings.shortcuts", icon: Keyboard },
  { id: "about", label: "settings.about", icon: Info },
];

export function SettingsPanel() {
  const { t } = useLang();
  const open = useUi((s) => s.settingsOpen);
  const tab = useUi((s) => s.settingsTab);
  const close = useUi((s) => s.closeSettings);
  const openSettings = useUi((s) => s.openSettings);

  return (
    <Modal open={open} onClose={close} width={780} labelledBy="settings-title">
      <div className="flex h-[580px] max-h-[82vh]">
        {/* 左侧导航 */}
        <nav className="flex w-[160px] shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2.5" aria-label={t("设置分类")}>
          <p id="settings-title" className="mb-2 px-2 pt-1 text-[13px] font-semibold text-ink">
            {t("settings.title")}
          </p>
          {TABS.map((tb) => {
            const Icon = tb.icon;
            return (
              <button
                key={tb.id}
                onClick={() => openSettings(tb.id)}
                aria-current={tab === tb.id}
                className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                  tab === tb.id
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-hover hover:text-ink"
                }`}
              >
                <Icon size={14} /> {t(tb.label)}
              </button>
            );
          })}
          <span className="flex-1" />
          <p className="px-2 text-[10px] text-ink-muted">ArborMark 4.0</p>
        </nav>

        {/* 右侧内容 */}
        <div className="relative min-w-0 flex-1 overflow-y-auto p-5">
          <button
            aria-label={t("关闭设置")}
            onClick={close}
            className="absolute right-3.5 top-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
          {tab === "appearance" && <AppearanceSettings />}
          {tab === "file" && <FileSettings />}
          {tab === "editor" && <EditorSettings />}
          {tab === "markdown" && <MarkdownSettings />}
          {tab === "image" && <ImageSettings />}
          {tab === "export" && <ExportSettings />}
          {tab === "search" && <WebSearchSettings />}
          {tab === "general" && <GeneralSettings />}
          {tab === "shortcuts" && <ShortcutSettings />}
          {tab === "about" && <AboutSettings />}
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[12.5px] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>}
      </div>
      {control}
    </div>
  );
}

/** 偏好开关：读取 prefs[k]（默认 def），写入并持久化。 */
function usePrefBool(k: string, def = true): [boolean, (v: boolean) => void] {
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const v = prefs[k];
  const value = v === undefined ? def : v !== false && v !== "false";
  return [value, (nv) => setPref(k, nv)];
}

function PrefSwitch({ k, label, hint, def = true }: { k: string; label: string; hint?: string; def?: boolean }) {
  const [value, setValue] = usePrefBool(k, def);
  return <Row label={label} hint={hint} control={<Switch checked={value} label={label} onChange={setValue} />} />;
}

function Select({ value, onChange, options, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="rounded-md border border-line bg-field px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function AppearanceSettings() {
  const { t } = useLang();
  const fontSize = useUi((s) => s.fontSize);
  const setFontSize = useUi((s) => s.setFontSize);
  const editorWidth = useUi((s) => s.editorWidth);
  const setEditorWidth = useUi((s) => s.setEditorWidth);
  const toolbarVisible = useUi((s) => s.toolbarVisible);
  const toggleToolbar = useUi((s) => s.toggleToolbar);
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);

  return (
    <div>
      <Section title={t("主题")}>
        <ThemeGallery />
      </Section>
      <Section title={t("排版与缩放")}>
        <Row
          label={t("编辑器字号")}
          hint={t("正文基准大小，编辑与源码同步")}
          control={
            <div className="flex items-center gap-1.5">
              <button
                aria-label={t("减小字号")}
                onClick={() => setFontSize(fontSize - 1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-line text-ink-secondary hover:bg-hover"
              >
                <Minus size={12} />
              </button>
              <span className="w-10 text-center text-[12px] tabular-nums text-ink">{fontSize}px</span>
              <button
                aria-label={t("增大字号")}
                onClick={() => setFontSize(fontSize + 1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-line text-ink-secondary hover:bg-hover"
              >
                <Plus size={12} />
              </button>
            </div>
          }
        />
        <Row
          label={t("编辑区宽度")}
          hint={t("长文写作的最佳行宽")}
          control={
            <Select
              value={editorWidth}
              onChange={(v) => setEditorWidth(v as keyof typeof EDITOR_WIDTHS)}
              ariaLabel="编辑区宽度"
              options={[
                ["standard", "标准 · 860px"],
                ["wide", "宽 · 1040px"],
                ["wider", "更宽 · 1240px"],
                ["full", "占满窗口"],
              ]}
            />
          }
        />
        <PrefSwitch
          k="zoomOnScroll"
          label={t("鼠标滚轮缩放")}
          hint={t("按住 Ctrl 或 ⌘ 滚动鼠标滚轮放大/缩小编辑器字号")}
        />
      </Section>
      <Section title={t("界面与状态栏")}>
        <Row label={t("显示工具栏")} hint={t("顶部格式化按钮栏")} control={<Switch checked={toolbarVisible} label={t("显示工具栏")} onChange={toggleToolbar} />} />
        <PrefSwitch k="outlineHeadingHighlight" label={t("大纲高亮当前标题")} hint={t("滚动时高亮所在章节")} />
        <Row
          label={t("阅读速度")}
          hint={t("状态栏预估阅读时长的参考基准")}
          control={
            <Select
              value={String(prefs.wordsPerMinute ?? 300)}
              onChange={(v) => setPref("wordsPerMinute", Number(v))}
              ariaLabel="阅读速度"
              options={[
                ["200", "200 词/分钟 (精读)"],
                ["300", "300 词/分钟 (标准)"],
                ["400", "400 词/分钟 (快速)"],
                ["500", "500 词/分钟 (速览)"],
              ]}
            />
          }
        />
      </Section>
    </div>
  );
}

function FileSettings() {
  const { t } = useLang();
  const autoSave = useUi((s) => s.autoSave);
  const setAutoSave = useUi((s) => s.setAutoSave);
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const clearRecent = useWorkspace((s) => s.clearRecent);
  const recentFolders = useWorkspace((s) => s.recentFolders);

  return (
    <div>
      <Section title={t("保存与启动")}>
        <Row
          label={t("自动保存")}
          hint={t("停止输入 0.8 秒后写入磁盘")}
          control={
            <Switch
              checked={autoSave}
              label={t("自动保存")}
              onChange={(v) => {
                setAutoSave(v);
                setWorkspaceAutoSave(v);
              }}
            />
          }
        />
        <PrefSwitch
          k="autoSaveOnSwitch"
          label={t("切换文件时自动保存")}
          hint={t("切换文档时自动将未保存更改写回磁盘")}
        />
        <PrefSwitch
          k="restoreSession"
          label={t("启动时恢复上次会话")}
          hint={t("重新打开上次使用的文件夹与文档")}
        />
      </Section>
      <Section title={t("默认格式")}>
        <Row
          label={t("默认文件类型 / 扩展名")}
          hint={t("新建未指定后缀的文件时默认采用的扩展名")}
          control={
            <Select
              value={String(prefs.defaultFileExt ?? "md")}
              onChange={(v) => setPref("defaultFileExt", v)}
              ariaLabel="默认扩展名"
              options={[
                ["md", "Markdown (.md)"],
                ["markdown", "Markdown (.markdown)"],
                ["txt", "纯文本 (.txt)"],
              ]}
            />
          }
        />
        <Row
          label={t("默认换行符 (EOL)")}
          hint={t("新文件的换行符标准")}
          control={
            <Select
              value={String(prefs.defaultEol ?? "lf")}
              onChange={(v) => setPref("defaultEol", v)}
              ariaLabel="默认换行符"
              options={[
                ["lf", "LF (Unix / macOS)"],
                ["crlf", "CRLF (Windows Style)"],
              ]}
            />
          }
        />
        <PrefSwitch
          k="finalNewline"
          label={t("文件末尾保留换行符")}
          hint={t("保存文件时若末尾无换行则自动追加一个换行符")}
        />
      </Section>
      <Section title={t("最近使用的目录与历史")}>
        <Row
          label={t("历史文件与目录记录")}
          hint={t(recentFolders.length > 0 ? `当前已记录 ${recentFolders.length} 个历史项目` : "暂无历史记录")}
          control={
            <button
              onClick={async () => {
                await clearRecent();
                useUi.getState().toast("已清除历史文件与目录记录", "success");
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <Trash2 size={13} /> {t("清除历史记录")}
            </button>
          }
        />
      </Section>
    </div>
  );
}

function EditorSettings() {
  const { t } = useLang();
  const lineNumbers = useUi((s) => s.lineNumbers);
  const toggleLineNumbers = useUi((s) => s.toggleLineNumbers);
  const typewriter = useUi((s) => s.typewriterMode);
  const toggleTypewriter = useUi((s) => s.toggleTypewriterMode);
  const focusMode = useUi((s) => s.focusMode);
  const toggleFocusMode = useUi((s) => s.toggleFocusMode);
  const readonlyMode = useUi((s) => s.readonlyMode);
  const toggleReadonly = useUi((s) => s.toggleReadonly);
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);

  return (
    <div>
      <Section title={t("编辑体验")}>
        <Row label={t("显示行号")} hint={t("源码模式下显示行号")} control={<Switch checked={lineNumbers} label={t("显示行号")} onChange={toggleLineNumbers} />} />
        <Row label={t("打字机模式")} hint={t("光标始终保持在视口中央")} control={<Switch checked={typewriter} label={t("打字机模式")} onChange={toggleTypewriter} />} />
        <Row label={t("专注模式")} hint={t("淡化非当前段落，聚焦写作")} control={<Switch checked={focusMode} label={t("专注模式")} onChange={toggleFocusMode} />} />
        <Row label={t("只读模式")} hint={t("锁定编辑，仅浏览")} control={<Switch checked={readonlyMode} label={t("只读模式")} onChange={toggleReadonly} />} />
        <PrefSwitch k="lineWrapping" label={t("自动换行")} hint={t("长行软换行而非横向滚动")} />
        <PrefSwitch k="spellcheck" label={t("拼写检查")} hint={t("浏览器原生拼写提示")} def={false} />
        <PrefSwitch k="autoPair" label={t("自动配对符号")} hint={t("自动补全括号、引号与 Markdown 标记")} />
        <PrefSwitch
          k="copyCutWholeLine"
          label={t("复制/剪切整行")}
          hint={t("复制或剪切时，若没有文字被选中，则处理光标所在的一整行")}
        />
        <Row
          label={t("缩进宽度")}
          hint={t("Tab 与列表缩进的空格数")}
          control={
            <Select
              value={String(prefs.indentSize ?? 2)}
              onChange={(v) => setPref("indentSize", Number(v))}
              ariaLabel="缩进宽度"
              options={[["2", "2 空格"], ["4", "4 空格"]]}
            />
          }
        />
      </Section>
      <Section title={t("渲染引擎")}>
        <p className="rounded-md bg-hover px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
          编辑态采用 Milkdown（ProseMirror）所见即所得引擎：直接在渲染结果上编辑标题、
          引用、列表、表格（增删行列）、代码块、公式与 Mermaid 图表。源码态为纯文本
          CodeMirror，⌘/ 在两者间切换。
        </p>
      </Section>
    </div>
  );
}

function MarkdownSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const bool = (k: string) => prefs[k] !== false;
  const toggle = (k: string) => (v: boolean) => {
    setPref(k, v);
    if (k === "finalNewline") setFinalNewline(v);
  };
  return (
    <div>
      <Section title={t("语法偏好")}>
        <Row
          label={t("无序列表符号")}
          hint={t("插入无序列表时的默认项目标记")}
          control={
            <Select
              value={String(prefs.unorderedListMarker ?? "-")}
              onChange={(v) => setPref("unorderedListMarker", v)}
              ariaLabel="无序列表标记"
              options={[
                ["-", "- (减号，推荐)"],
                ["*", "* (星号)"],
                ["+", "+ (加号)"],
              ]}
            />
          }
        />
        <Row
          label={t("默认代码块语言")}
          hint={t("新建代码块未指定语言时的默认语法识别")}
          control={
            <Select
              value={String(prefs.defaultCodeLang ?? "")}
              onChange={(v) => setPref("defaultCodeLang", v)}
              ariaLabel="默认代码块语言"
              options={[
                ["", t("无默认语言（纯文本）")],
                ["markdown", "Markdown"],
                ["javascript", "JavaScript"],
                ["typescript", "TypeScript"],
                ["python", "Python"],
                ["rust", "Rust"],
                ["bash", "Bash / Shell"],
                ["json", "JSON"],
                ["html", "HTML"],
                ["css", "CSS"],
              ]}
            />
          }
        />
      </Section>
      <Section title={t("语法扩展")}>
        <p className="mb-2 rounded-md bg-accent-soft px-3 py-2 text-[11px] leading-relaxed text-accent">
          {t("开关即时生效（编辑器按当前配置重新渲染）。覆盖常用 Markdown 扩展。")}
        </p>
        <PrefSwitch k="enableInlineMath" label={t("内联数学公式")} hint={t("$...$ 行内公式（块级 $$ 始终支持）")} />
        <PrefSwitch k="enableHighlight" label={t("高亮")} hint={t("==高亮文字==")} />
        <PrefSwitch k="enableSuperscript" label={t("上标")} hint={t("^上标^")} />
        <PrefSwitch k="enableSubscript" label={t("下标")} hint={t("~下标~")} />
        <PrefSwitch k="enableDiagram" label={t("Mermaid 图表")} hint={t("```mermaid 流程图/时序图等")} />
        <PrefSwitch k="enableAlert" label={t("GitHub 提示块")} hint={t("[!NOTE]/[!TIP]/[!WARNING] 等")} />
        <PrefSwitch k="enableEmoji" label={t("Emoji 简码")} hint={t(":smile: 等简码渲染为表情")} />
        <PrefSwitch k="blockHTML" label={t("渲染 HTML")} hint={t("渲染内联/块级 HTML 标签")} />
        <PrefSwitch k="autoNumberingForMath" label={t("公式自动编号")} hint={t("为块级公式添加序号")} def={false} />
      </Section>
      <Section title={t("智能标点")}>
        <Row label={t("智能引号")} hint={t("将直引号转换为弯引号")} control={<Switch checked={bool("smartQuotes")} label={t("智能引号")} onChange={toggle("smartQuotes")} />} />
        <Row label={t("智能破折号")} hint={t("将 -- 转换为破折号")} control={<Switch checked={bool("smartDashes")} label={t("智能破折号")} onChange={toggle("smartDashes")} />} />
        <Row label={t("解析时重映射 Unicode 标点")} control={<Switch checked={bool("remapPunctuation")} label={t("重映射标点")} onChange={toggle("remapPunctuation")} />} />
      </Section>
      <Section title={t("空白与换行")}>
        <Row label={t("保存时插入末尾换行符")} hint={t("文件末尾保留一个换行")} control={<Switch checked={bool("finalNewline")} label={t("末尾换行")} onChange={toggle("finalNewline")} />} />
        <PrefSwitch k="preserveLineBreak" label={t("保留单个换行")} hint={t("单个换行渲染为换行而非合并")} def={false} />
        <PrefSwitch k="indentFirstLine" label={t("段落首行缩进")} hint={t("段首缩进两个字符")} def={false} />
      </Section>
    </div>
  );
}

function ImageSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const [showHelp, setShowHelp] = useState(false);
  const bool = (k: string, def = true) => (prefs[k] === undefined ? def : prefs[k] !== false && prefs[k] !== "false");
  const action = String(prefs.imgInsertAction ?? "assets");

  const Check = ({ k, label, def = true, help }: { k: string; label: string; def?: boolean; help?: string }) => (
    <label className="flex cursor-pointer select-none items-center gap-2 py-0.5">
      <Checkbox checked={bool(k, def)} label={label} onChange={(v) => setPref(k, v)} />
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">{label}</span>
      {help && (
        <span className="shrink-0 text-ink-muted" title={help} aria-label={help}>
          <CircleHelp size={13} />
        </span>
      )}
    </label>
  );
  const LearnMore = () => (
    <button onClick={() => setShowHelp((v) => !v)} className="text-[11px] text-accent underline underline-offset-2 hover:text-accent-hover">
      {t("了解更多…")}
    </button>
  );

  return (
    <div>
      <Section title={t("图像")}>
        <div className="border-b border-line py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap pt-1">
              <span className="text-[12.5px] font-medium text-ink">{t("插入图片时…")}</span>
              <LearnMore />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Select
                value={action}
                onChange={(v) => setPref("imgInsertAction", v)}
                ariaLabel={t("插入图片时…")}
                options={[
                  ["none", t("无特殊操作")],
                  ["current", t("复制图片到当前文件夹（./）")],
                  ["assets", t("复制图片到 ./assets 文件夹")],
                  ["filename.assets", t("复制图片到 ./${filename}.assets 文件夹")],
                  ["upload", t("上传图片")],
                  ["custom", t("复制到指定路径")],
                ]}
              />
              {action === "custom" && (
                <input
                  value={String(prefs.imgCustomPath ?? "")}
                  onChange={(e) => setPref("imgCustomPath", e.target.value)}
                  aria-label={t("指定路径")}
                  placeholder="/path/to/images"
                  className="h-7 rounded-md border border-line bg-field px-2 font-mono text-[11.5px] text-ink outline-none focus:border-accent"
                />
              )}
              <div className="flex flex-col gap-1 pt-1">
                <Check k="imgApplyLocal" label={t("对本地位置的图片应用上述规则")} />
                <Check k="imgApplyNetwork" label={t("对网络位置的图片应用上述规则")} def={false} />
                <Check k="imgYamlUpload" label={t("允许根据 YAML 设置自动上传图片")} def={false} />
              </div>
            </div>
          </div>
        </div>
        <div className="py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap pt-1">
              <span className="text-[12.5px] font-medium text-ink">{t("图片语法偏好")}</span>
              <LearnMore />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Check k="useRelativePathForImg" label={t("优先使用相对路径")} />
              <Check k="imgAddDotSlash" label={t("为相对路径添加 ./")} def={false} help={t("相对路径以 ./ 开头，便于某些渲染器解析")} />
              <Check k="autoEscapeImageURL" label={t("插入时自动转义图片 URL")} help={t("对空格与括号等字符进行百分号转义")} />
            </div>
          </div>
        </div>
        {showHelp && (
          <p className="mb-2 rounded-md bg-accent-soft px-3 py-2 text-[11px] leading-relaxed text-accent">
            插入图片时按所选动作复制/引用；「应用规则」分别控制本地与网络图片。
            语法偏好决定生成 Markdown 的路径形态（相对/绝对、./ 前缀、URL 转义）。
          </p>
        )}
      </Section>
      <Section title={t("插入与路径")}>
        <Row
          label={t("相对路径基准")}
          hint={t("相对路径以哪个目录为起点计算")}
          control={
            <Select
              value={String(prefs.imgBase ?? "doc")}
              onChange={(v) => setPref("imgBase", v)}
              ariaLabel="相对路径基准"
              options={[["doc", "当前文档目录"], ["workspace", "工作区根目录"]]}
            />
          }
        />
        <Row
          label={t("文件名模板")}
          hint={t("复制落盘时的命名方式")}
          control={
            <Select
              value={String(prefs.imgNamePattern ?? "original")}
              onChange={(v) => setPref("imgNamePattern", v)}
              ariaLabel="文件名模板"
              options={[["original", "保留原文件名"], ["timestamp", "时间戳"], ["docseq", "文档名-序号"]]}
            />
          }
        />
        <Row
          label={t("以文件名作为 alt")}
          hint={t("插入时自动填充图片描述文本")}
          control={<Switch checked={bool("imgAltFromName")} label={t("文件名作 alt")} onChange={(v) => setPref("imgAltFromName", v)} />}
        />
      </Section>
      <Section title={t("说明")}>
        <p className="rounded-md bg-hover px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
          拖拽或粘贴图片到编辑区、或经菜单「插入本地图片」时，按以上偏好落盘并生成路径。
          浏览器环境粘贴回退为自包含 data URI；桌面端复制真实文件到附件目录。
          点击图片可放大查看；导出 PDF/HTML 时相对路径按设置保留或转换。
        </p>
      </Section>
    </div>
  );
}

function WebSearchSettings() {
  const { t } = useLang();
  const [cfg, setCfg] = useState<WebSearchConfig>(() => readConfig());
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const update = (fn: (c: WebSearchConfig) => WebSearchConfig) => {
    setCfg((prev) => {
      const next = fn(prev);
      writeConfig(next);
      return next;
    });
  };
  const addCustom = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url || !/%s|\{关键词\}|\{query\}|\{keyword\}/.test(url)) {
      useUi.getState().toast("自定义引擎需含名称与带 %s 或 {关键词} 的 URL", "warning");
      return;
    }
    update((c) => ({ ...c, engines: [...c.engines, { id: `custom-${Date.now()}`, name, url, enabled: true }] }));
    setNewName("");
    setNewUrl("");
  };
  return (
    <div>
      <Section title={t("选中文本搜索")}>
        <Row label={t("启用网络搜索")} hint={t("选中文本后可一键跳转到搜索引擎 / AI 问答")} control={<Switch checked={cfg.enabled} label={t("启用网络搜索")} onChange={(v) => update((c) => ({ ...c, enabled: v }))} />} />
        <Row label={t("选中气泡")} hint={t("选中文本后浮现搜索气泡")} control={<Switch checked={cfg.bubble} label={t("选中气泡")} onChange={(v) => update((c) => ({ ...c, bubble: v }))} />} />
        <Row label={t("右键菜单入口")} hint={t("在右键菜单显示「网络搜索」分组")} control={<Switch checked={cfg.contextMenu} label={t("右键菜单入口")} onChange={(v) => update((c) => ({ ...c, contextMenu: v }))} />} />
        <Row
          label={t("默认引擎")}
          hint={t("气泡主按钮与首选搜索目标")}
          control={
            <Select
              value={cfg.defaultId}
              onChange={(v) => update((c) => ({ ...c, defaultId: v }))}
              ariaLabel="默认搜索引擎"
              options={cfg.engines.filter((e) => e.enabled).map((e) => [e.id, e.name] as [string, string])}
            />
          }
        />
      </Section>
      <Section title={t("搜索引擎")}>
        {cfg.engines.map((e) => (
          <div key={e.id}>
            <Row
              label={e.name}
              hint={e.url}
              control={
                <span className="flex items-center gap-1.5">
                  <Switch checked={e.enabled} label={`启用 ${e.name}`} onChange={(v) => update((c) => ({ ...c, engines: c.engines.map((x) => (x.id === e.id ? { ...x, enabled: v } : x)) }))} />
                  <button
                    aria-label={`编辑 ${e.name}`}
                    onClick={() => { setEditId(editId === e.id ? null : e.id); setEditName(e.name); setEditUrl(e.url); }}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
                  >
                    <PenLine size={12} />
                  </button>
                  <button aria-label={`删除 ${e.name}`} onClick={() => update((c) => ({ ...c, engines: c.engines.filter((x) => x.id !== e.id), defaultId: c.defaultId === e.id ? (c.engines.find((x) => x.id !== e.id && x.enabled)?.id ?? c.defaultId) : c.defaultId }))} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:bg-danger/10 hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                </span>
              }
            />
            {editId === e.id && (
              <div className="mb-2 ml-4 flex items-center gap-2 rounded-md border border-line bg-hover p-2">
                <input value={editName} onChange={(ev) => setEditName(ev.target.value)} aria-label={t("引擎名称")} className="h-7 w-[90px] rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent" />
                <input value={editUrl} onChange={(ev) => setEditUrl(ev.target.value)} aria-label={t("引擎 URL")} className="h-7 flex-1 rounded-md border border-line bg-field px-2 font-mono text-[11px] text-ink outline-none focus:border-accent" />
                <button
                  onClick={() => {
                    if (!editName.trim() || !/%s|\{关键词\}|\{query\}|\{keyword\}/.test(editUrl)) { useUi.getState().toast("URL 需含 %s 或 {关键词} 占位符", "warning"); return; }
                    update((c) => ({ ...c, engines: c.engines.map((x) => (x.id === e.id ? { ...x, name: editName.trim(), url: editUrl.trim() } : x)) }));
                    setEditId(null);
                  }}
                  className="h-7 rounded-md bg-accent px-2.5 text-[11.5px] text-on-accent hover:bg-accent-hover"
                >{t("保存")}</button>
              </div>
            )}
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("名称")} aria-label={t("自定义引擎名称")} className="h-8 w-[100px] rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent" />
          <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…?q=%s 或 {关键词}" aria-label={t("自定义引擎 URL")} className="h-8 flex-1 rounded-md border border-line bg-field px-2 font-mono text-[12px] text-ink outline-none focus:border-accent" />
          <button onClick={addCustom} className="flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink"><Plus size={13} /> {t("添加")}</button>
          <button onClick={() => update((c) => ({ ...c, engines: defaultConfig().engines, defaultId: "baidu" }))} className="flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">{t("恢复默认")}</button>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">{"%s 或 {关键词} 为选中文本占位符；DeepSeek 默认携带 autosend/search/thinking 参数。"}</p>
      </Section>
    </div>
  );
}

function ExportSettings() {
  const { t } = useLang();
  return (
    <div>
      <Section title={t("导出选项")}>
        <PrefSwitch
          k="exportOpenFolder"
          label={t("导出后打开所在目录")}
          hint={t("导出 PDF 或 HTML 文件后，自动在系统文件管理器中定位目标文件")}
        />
      </Section>
      <Section title={t("支持格式")}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: "PDF", desc: "高质量排版文档，保留完整主题色彩与数学公式" },
            { name: "HTML (含样式)", desc: "自包含主题样式的网页文件，任何浏览器可直接浏览" },
            { name: "HTML (无样式)", desc: "纯净语义化 HTML，便于嵌入 CMS 或博客系统" },
            { name: "Markdown", desc: "规范化格式后的 Markdown 源文件" },
          ].map((fmt) => (
            <div key={fmt.name} className="rounded-lg border border-line bg-hover/40 p-3">
              <p className="text-[12.5px] font-medium text-ink">{fmt.name}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{fmt.desc}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function GeneralSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const resetPrefs = useUi((s) => s.resetPrefs);
  const bool = (k: string) => prefs[k] !== false;
  return (
    <div>
      <Section title={t("语言与更新")}>
        <Row
          label={t("界面语言")}
          control={
            <Select
              value={String(prefs.language ?? "zh-Hans")}
              onChange={(v) => {
                setPref("language", v);
                import("@/bridge/ipc").then(({ invoke }) => {
                  invoke("setting.set", { userLanguage: v === "system" ? "" : v }).catch(() => {});
                });
              }}
              ariaLabel="界面语言"
              options={[
                ["system", t("跟随系统")],
                ["zh-Hans", "简体中文"],
                ["zh-Hant", "繁體中文"],
                ["en", "English"],
                ["ja-JP", "日本語"],
                ["ko-KR", "한국어"],
                ["de-DE", "Deutsch"],
                ["fr-FR", "Français"],
                ["es-ES", "Español"],
                ["ru-RU", "Русский"],
                ["it-IT", "Italiano"],
                ["pt-BR", "Português (Brasil)"],
                ["nl-NL", "Nederlands"],
                ["pl-PL", "Polski"],
                ["tr-TR", "Türkçe"],
                ["ar-SA", "العربية"],
              ]}
            />
          }
        />
        <Row label={t("自动检查更新")} control={<Switch checked={bool("autoCheckUpdate")} label={t("自动检查更新")} onChange={(v) => setPref("autoCheckUpdate", v)} />} />
      </Section>
      <Section title={t("会话与文件树")}>
        <Row label={t("启动时恢复上次会话")} hint={t("重新打开上次的文件夹与文档")} control={<Switch checked={bool("restoreSession")} label={t("恢复会话")} onChange={(v) => setPref("restoreSession", v)} />} />
        <PrefSwitch k="showHiddenFiles" label={t("显示隐藏文件")} hint={t("文件树中显示以 . 开头的文件")} def={false} />
      </Section>
      <Section title={t("设置备份与迁移")}>
        <Row
          label={t("导出设置")}
          hint={t("将当前偏好保存为 JSON 文件，便于备份或迁移")}
          control={
            <button
              onClick={async () => {
                const r = await exportSettings();
                const ui = useUi.getState();
                if (r.status === "saved") ui.toast("设置已导出", "success");
                else if (r.status === "error") ui.toast(`导出失败：${r.error ?? "未知错误"}`, "danger");
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <Download size={13} /> {t("导出…")}
            </button>
          }
        />
        <Row
          label={t("导入设置")}
          hint={t("从 JSON 文件恢复偏好（覆盖当前设置）")}
          control={
            <button
              onClick={async () => {
                const r = await pickAndImportSettings();
                const ui = useUi.getState();
                if (r.status === "imported") ui.toast("设置已导入并应用", "success");
                else if (r.status === "error") ui.toast(`导入失败：${r.error ?? "文件格式无效"}`, "danger");
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <Upload size={13} /> {t("导入…")}
            </button>
          }
        />
      </Section>
      <Section title={t("重置选项")}>
        <Row
          label={t("恢复默认偏好设置")}
          hint={t("将所有偏好设置重置为初始默认值")}
          control={
            <button
              onClick={() => {
                if (window.confirm("确定要恢复默认偏好设置吗？")) {
                  resetPrefs();
                  useUi.getState().toast("已恢复默认偏好设置", "success");
                }
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <RotateCcw size={13} /> {t("恢复默认")}
            </button>
          }
        />
        <Row
          label={t("重置全部警告提示对话框")}
          hint={t("恢复所有被勾选「不再提示」的确认弹窗")}
          control={
            <button
              onClick={() => {
                try {
                  localStorage.removeItem("arbor.dismissed_dialogs");
                  useUi.getState().toast("已重置所有警告提示", "success");
                } catch {
                  /* ignore */
                }
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <RotateCcw size={13} /> {t("重置对话框")}
            </button>
          }
        />
      </Section>
    </div>
  );
}

function ShortcutSettings() {
  const { t } = useLang();
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: t("文件"),
      items: [
        ["新建文件", "⌘N"],
        ["保存", "⌘S"],
        ["快速打开", "⌘P"],
        ["全局搜索", "⌘⇧F"],
        ["打开文件夹", "⌘O"],
      ],
    },
    {
      title: t("视图"),
      items: [
        ["文件 / 大纲 / 搜索面板", "⌘1 / 2 / ⌘3"],
        ["收起 / 展开侧边栏", "⌘\\"],
        ["编辑 / 源码", "⌘/"],
        ["专注模式", "⌘⇧D"],
        ["偏好设置", "⌘,"],
      ],
    },
    {
      title: t("编辑"),
      items: [
        ["加粗 / 斜体 / 行内代码", "⌘B / I / ⌘E"],
        ["删除线", "⌘⇧X"],
        ["查找 / 替换（当前文件）", "⌘F / ⌘⌥F"],
        ["撤销 / 重做", "⌘Z / ⇧Z"],
      ],
    },
    {
      title: t("文件树"),
      items: [
        ["重命名", "F2"],
        ["删除所选", "⌫"],
        ["连选 / 多选", "Shift 点击 / ⌘点击"],
        ["移动文件", "拖拽到目标文件夹"],
      ],
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6">
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.items.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between border-b border-line py-2 last:border-0">
              <span className="text-[12px] text-ink-secondary">{t(label)}</span>
              <kbd className="rounded border border-line bg-field px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
                {t(keys)}
              </kbd>
            </div>
          ))}
        </Section>
      ))}
    </div>
  );
}

function AboutSettings() {
  const celeb = useRef<CelebrationHandle>(null);
  const { t } = useLang();
  return (
    <div className="relative flex h-full flex-col items-center justify-center text-center">
      <CelebrationLayer ref={celeb} />
      <button
        aria-label={t("about.celebrate")}
        title={t("about.celebrate")}
        onClick={(e) => celeb.current?.fire(e.clientX, e.clientY)}
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent transition-transform hover:scale-105 active:scale-95"
      >
        <TreePine size={30} strokeWidth={1.6} />
      </button>
      <h2 className="text-[18px] font-semibold text-ink">ArborMark</h2>
      <p className="mt-1 text-[12px] text-ink-muted">{t("about.version")}</p>
      <p className="mt-4 max-w-[360px] text-[12.5px] leading-relaxed text-ink-secondary">
        {t("about.body")}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={() => showOnboarding()}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <Compass size={13} /> {t("about.reopen")}
        </button>
        <button
          onClick={() => celeb.current?.fire()}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <Sparkles size={13} /> {t("about.celebrate")}
        </button>
      </div>
      <p className="mt-6 text-[11px] text-ink-muted">GPL-3.0-or-later · ArborMark Team</p>
    </div>
  );
}