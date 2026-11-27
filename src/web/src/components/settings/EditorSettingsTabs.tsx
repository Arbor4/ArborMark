import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, CircleHelp, FolderOpen, RefreshCw, RotateCcw, ExternalLink, FileClock } from "lucide-react";
import { useUi, EDITOR_WIDTHS } from "@/stores/ui";
import { useWorkspace, setAutoSave as setWorkspaceAutoSave, setFinalNewline } from "@/stores/workspace";
import { useLang } from "@/bridge/i18n";
import { fs } from "@/bridge/fs";
import { invoke, isTauri } from "@/bridge/ipc";
import { Switch, Checkbox } from "../common";
import { ThemeGallery } from "./ThemeGallery";
import { Section, Row, PrefSwitch, Select } from "./SettingsPrimitives";

const isMacPlatform = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

export function FileSettings() {
  const { t } = useLang();
  const autoSave = useUi((s) => s.autoSave);
  const setAutoSave = useUi((s) => s.setAutoSave);
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const clearRecent = useWorkspace((s) => s.clearRecent);
  const refreshTree = useWorkspace((s) => s.refresh);
  const recentFolders = useWorkspace((s) => s.recentFolders);

  const startupAction = String(
    prefs.startupAction ?? (prefs.restoreSession === false ? "blank" : "restore"),
  );
  const startupFolder = String(prefs.startupFolder ?? "");

  const recoverLatestDraft = async () => {
    const ui = useUi.getState();
    try {
      if (isTauri()) {
        const res = await invoke<{ found?: boolean; name?: string; content?: string }>("setting.latestUnsavedDraft");
        if (res?.found && typeof res.content === "string") {
          useWorkspace.setState({
            activePath: `untitled://${res.name || "草稿.md"}`,
            content: res.content,
            savedContent: "",
            dirty: true,
          });
          ui.closeSettings();
          ui.toast(t("已恢复最新未保存草稿"), "success");
          return;
        }
      } else {
        const raw = localStorage.getItem("arbor.latest_draft");
        if (raw) {
          const parsed = JSON.parse(raw) as { name?: string; content?: string };
          if (typeof parsed.content === "string") {
            useWorkspace.setState({
              activePath: `untitled://${parsed.name || "草稿.md"}`,
              content: parsed.content,
              savedContent: "",
              dirty: true,
            });
            ui.closeSettings();
            ui.toast(t("已恢复最新未保存草稿"), "success");
            return;
          }
        }
      }
      ui.toast(t("暂无可恢复的草稿"), "info");
    } catch {
      ui.toast(t("恢复草稿失败"), "warning");
    }
  };

  return (
    <div>
      <Section title={t("启动选项")}>
        <Row
          label={t("启动时")}
          hint={t("决定打开 ArborMark 后的初始工作区")}
          control={
            <Select
              value={startupAction}
              onChange={(v) => setPref("startupAction", v)}
              ariaLabel={t("启动选项")}
              options={[
                ["restore", t("恢复上次目录与文档")],
                ["new", t("打开新空白文档")],
                ["folder", t("打开指定目录")],
                ["blank", t("保持空白工作区")],
              ]}
            />
          }
        />
        {startupAction === "folder" && (
          <div className="flex items-center gap-2 border-b border-line py-2.5">
            <input
              value={startupFolder}
              onChange={(e) => setPref("startupFolder", e.target.value)}
              placeholder={t("输入或选择启动目录路径…")}
              aria-label={t("启动目录路径")}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-field px-2.5 font-mono text-[11.5px] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={async () => {
                const res = await fs.openFolderDialog();
                if (!res.canceled && res.filePaths[0]) {
                  setPref("startupFolder", res.filePaths[0]);
                }
              }}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <FolderOpen size={12} /> {t("选择文件夹…")}
            </button>
          </div>
        )}
      </Section>

      <Section title={t("保存与恢复")}>
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
          hint={t("关闭后切换未保存文档将弹出确认提示")}
        />
        <Row
          label={t("保存时插入末尾换行符")}
          hint={t("保存文件时若末尾无换行则自动追加一个换行符")}
          control={
            <Switch
              checked={prefs.finalNewline !== false}
              label={t("保存时插入末尾换行符")}
              onChange={(v) => {
                setPref("finalNewline", v);
                setFinalNewline(v);
              }}
            />
          }
        />
        <Row
          label={t("未保存的草稿")}
          hint={t("意外退出或关闭自动保存时可从草稿恢复最近编辑内容")}
          control={
            <button
              type="button"
              onClick={() => void recoverLatestDraft()}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <FileClock size={13} /> {t("恢复未保存的草稿")}
            </button>
          }
        />
      </Section>

      <Section title={t("默认格式与大纲")}>
        <Row
          label={t("默认文件类型 / 扩展名")}
          hint={t("新建未指定后缀的文件时默认采用的扩展名")}
          control={
            <Select
              value={String(prefs.defaultFileExt ?? "md")}
              onChange={(v) => setPref("defaultFileExt", v)}
              ariaLabel={t("默认扩展名")}
              options={[
                ["md", "Markdown (.md)"],
                ["markdown", "Markdown (.markdown)"],
                ["txt", t("纯文本 (.txt)")],
              ]}
            />
          }
        />
        <PrefSwitch
          k="outlineCollapsible"
          label={t("大纲允许折叠与展开")}
          hint={t("控制侧边栏大纲标题树是否显示折叠控件")}
        />
      </Section>

      <Section title={t("文件树与历史")}>
        <Row
          label={t("显示隐藏文件")}
          hint={t("文件树中显示以 . 开头的文件与目录")}
          control={
            <Switch
              checked={prefs.showHiddenFiles === true}
              label={t("显示隐藏文件")}
              onChange={(v) => {
                setPref("showHiddenFiles", v);
                void refreshTree();
              }}
            />
          }
        />
        <PrefSwitch
          k="recordRecentHistory"
          label={t("记录历史文件与目录")}
          hint={t("打开文件夹时记入最近访问列表")}
        />
        <Row
          label={t("历史文件与目录记录")}
          hint={
            recentFolders.length > 0
              ? t("当前已记录 {n} 个历史目录", { n: recentFolders.length })
              : t("暂无历史记录")
          }
          control={
            <button
              onClick={async () => {
                await clearRecent();
                useUi.getState().toast(t("已清除历史文件与目录记录"), "success");
              }}
              className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
            >
              <Trash2 size={13} /> {t("清除历史记录")}
            </button>
          }
        />
      </Section>

      <Section title={t("拖放行为控制")}>
        <Row
          label={t("拖入文件夹时")}
          control={
            <Select
              value={String(prefs.dragDropFolderAction ?? "open")}
              onChange={(v) => setPref("dragDropFolderAction", v)}
              ariaLabel={t("拖入文件夹时")}
              options={[
                ["open", t("作为工作区打开")],
                ["ignore", t("不处理")],
              ]}
            />
          }
        />
        <Row
          label={t("拖入可导入文件时")}
          hint={t("如 .docx / .tex / .rst / .org 等（需 Pandoc）")}
          control={
            <Select
              value={String(prefs.dragDropImportAction ?? "import")}
              onChange={(v) => setPref("dragDropImportAction", v)}
              ariaLabel={t("拖入可导入文件时")}
              options={[
                ["import", t("自动转换并导入")],
                ["ignore", t("不处理")],
              ]}
            />
          }
        />
      </Section>
    </div>
  );
}

export function EditorSettings() {
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
      <Section title={t("默认缩进与输入辅助")}>
        <Row
          label={t("缩进宽度")}
          hint={t("Tab 与列表缩进的空格数")}
          control={
            <Select
              value={String(prefs.indentSize ?? 2)}
              onChange={(v) => setPref("indentSize", Number(v))}
              ariaLabel={t("缩进宽度")}
              options={[
                ["2", t("2 空格")],
                ["4", t("4 空格")],
              ]}
            />
          }
        />
        <PrefSwitch
          k="autoPair"
          label={t("匹配括号和引号")}
          hint={t("自动补全成对的 () [] {} 与引号")}
        />
        <PrefSwitch
          k="autoPairMarkdown"
          label={t("匹配 Markdown 行内符号")}
          hint={t("自动补全成对的反引号 ` 等标记")}
        />
        <PrefSwitch
          k="spellcheck"
          label={t("拼写检查")}
          hint={t("浏览器原生拼写提示")}
          def={false}
        />
      </Section>

      <Section title={t("复制与换行")}>
        <PrefSwitch
          k="copyMarkdownByDefault"
          label={t("复制时默认输出 Markdown 源码")}
          hint={t("在所见即所得视图中直接 Ctrl/⌘+C 时以 Markdown 纯文本写入剪贴板")}
          def={false}
        />
        <PrefSwitch
          k="copyCutWholeLine"
          label={t("复制/剪切整行")}
          hint={t("复制或剪切时，若没有文字被选中，则处理光标所在的整段/整行")}
        />
        <Row
          label={t("默认换行符 (EOL)")}
          hint={t("保存文档时采用的行尾序列")}
          control={
            <Select
              value={String(prefs.defaultEol ?? "lf")}
              onChange={(v) => setPref("defaultEol", v)}
              ariaLabel={t("默认换行符")}
              options={[
                ["lf", "LF (Unix / macOS)"],
                ["crlf", "CRLF (Windows)"],
              ]}
            />
          }
        />
      </Section>

      <Section title={t("显示与写作模式")}>
        <PrefSwitch
          k="lineWrapping"
          label={t("自动换行")}
          hint={t("长行软换行而非横向滚动")}
        />
        <Row
          label={t("显示行号")}
          hint={t("源码模式与代码文件中显示行号")}
          control={<Switch checked={lineNumbers} label={t("显示行号")} onChange={toggleLineNumbers} />}
        />
        <Row
          label={t("打字机模式")}
          hint={t("输入或移动光标时尽量保持在视口垂直居中")}
          control={<Switch checked={typewriter} label={t("打字机模式")} onChange={toggleTypewriter} />}
        />
        <Row
          label={t("专注模式")}
          hint={t("淡化非当前段落，聚焦写作")}
          control={<Switch checked={focusMode} label={t("专注模式")} onChange={toggleFocusMode} />}
        />
        <Row
          label={t("只读模式")}
          hint={t("锁定编辑，仅浏览")}
          control={<Switch checked={readonlyMode} label={t("只读模式")} onChange={toggleReadonly} />}
        />
      </Section>

      <Section title={t("渲染引擎")}>
        <p className="rounded-md bg-hover px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
          {t("编辑态采用 Milkdown（ProseMirror）所见即所得引擎：直接在渲染结果上编辑标题、引用、列表、表格（增删行列）、代码块、公式与 Mermaid 图表。源码态为纯文本 CodeMirror，{key} 在两者间切换。", {
            key: isMacPlatform ? "⌘/" : "Ctrl+/",
          })}
        </p>
      </Section>
    </div>
  );
}

export function ImageSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const [showHelp, setShowHelp] = useState(false);
  const bool = (k: string, def = true) =>
    prefs[k] === undefined ? def : prefs[k] !== false && prefs[k] !== "false";
  const action = String(prefs.imgInsertAction ?? "assets");
  const uploader = String(prefs.imgUploader ?? "none");

  const Check = ({
    k,
    label,
    def = true,
    help,
  }: {
    k: string;
    label: string;
    def?: boolean;
    help?: string;
  }) => (
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
    <button
      onClick={() => setShowHelp((v) => !v)}
      className="text-[11px] text-accent underline underline-offset-2 hover:text-accent-hover"
    >
      {t("了解更多…")}
    </button>
  );

  return (
    <div>
      <Section title={t("插入图片时")}>
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
                <div className="flex items-center gap-1.5">
                  <input
                    value={String(prefs.imgCustomPath ?? "")}
                    onChange={(e) => setPref("imgCustomPath", e.target.value)}
                    aria-label={t("指定路径")}
                    placeholder="/path/to/images"
                    className="h-7 min-w-0 flex-1 rounded-md border border-line bg-field px-2 font-mono text-[11.5px] text-ink outline-none focus:border-accent"
                  />
                  {isTauri() && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fs.openFolderDialog();
                        if (!res.canceled && res.filePaths[0]) {
                          setPref("imgCustomPath", res.filePaths[0]);
                        }
                      }}
                      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary hover:bg-hover hover:text-ink"
                    >
                      <FolderOpen size={12} /> {t("浏览")}
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1 pt-1">
                <Check k="imgApplyLocal" label={t("对本地位置的图片应用上述规则")} />
                <Check k="imgApplyNetwork" label={t("对网络位置的图片应用上述规则")} def={false} />
                <Check
                  k="imgYamlUpload"
                  label={t("允许根据 YAML 设置自动上传图片")}
                  def={false}
                  help={t("检测到 Front Matter 含 typora-copy-images-to: upload 时自动走上传服务")}
                />
              </div>
            </div>
          </div>
        </div>
        <Row
          label={t("文件名模板")}
          hint={t("复制落盘时的命名方式")}
          control={
            <Select
              value={String(prefs.imgNamePattern ?? "original")}
              onChange={(v) => setPref("imgNamePattern", v)}
              ariaLabel={t("文件名模板")}
              options={[
                ["original", t("保留原文件名")],
                ["timestamp", t("时间戳")],
                ["docseq", t("文档名-序号")],
              ]}
            />
          }
        />
        <Row
          label={t("以文件名作为 alt")}
          hint={t("插入时自动填充图片描述文本")}
          control={
            <Switch
              checked={bool("imgAltFromName")}
              label={t("文件名作 alt")}
              onChange={(v) => setPref("imgAltFromName", v)}
            />
          }
        />
      </Section>

      <Section title={t("图片语法与路径")}>
        <div className="border-b border-line py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap pt-1">
              <span className="text-[12.5px] font-medium text-ink">{t("图片语法偏好")}</span>
              <LearnMore />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Check k="useRelativePathForImg" label={t("优先使用相对路径")} />
              <Check
                k="imgAddDotSlash"
                label={t("为相对路径添加 ./")}
                def={false}
                help={t("相对路径以 ./ 开头，便于某些渲染器解析")}
              />
              <Check
                k="autoEscapeImageURL"
                label={t("插入时自动转义图片 URL")}
                help={t("对空格与括号等字符进行百分号转义")}
              />
            </div>
          </div>
        </div>
        <Row
          label={t("相对路径基准")}
          hint={t("相对路径以哪个目录为起点计算")}
          control={
            <Select
              value={String(prefs.imgBase ?? "doc")}
              onChange={(v) => setPref("imgBase", v)}
              ariaLabel={t("相对路径基准")}
              options={[
                ["doc", t("当前文档目录")],
                ["workspace", t("工作区根目录")],
              ]}
            />
          }
        />
        {showHelp && (
          <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-[11px] leading-relaxed text-accent">
            {t("插入图片时按所选动作复制/引用；「应用规则」分别控制本地与网络图片。语法偏好决定生成 Markdown 的路径形态（相对/绝对、./ 前缀、URL 转义）。")}
          </p>
        )}
      </Section>

      <Section title={t("上传服务设定")}>
        <Row
          label={t("上传服务")}
          hint={t("桌面端支持调用 PicGo CLI 或自定义上传脚本，从标准输出提取图片 URL")}
          control={
            <Select
              value={uploader}
              onChange={(v) => setPref("imgUploader", v)}
              ariaLabel={t("上传服务")}
              options={[
                ["none", t("无（仅本地引用）")],
                ["picgo", "PicGo (CLI)"],
                ["custom", t("自定义命令")],
              ]}
            />
          }
        />
        {uploader === "custom" && (
          <div className="border-b border-line py-2.5">
            <input
              value={String(prefs.imgUploadCommand ?? "")}
              onChange={(e) => setPref("imgUploadCommand", e.target.value)}
              placeholder={t("例如：piclist upload $IMAGES")}
              aria-label={t("自定义上传命令")}
              className="h-7 w-full rounded-md border border-line bg-field px-2.5 font-mono text-[11.5px] text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-[10.5px] text-ink-muted">
              {t("可使用 $IMAGES 作为图片路径占位符（省略时自动追加到命令末尾），需在 stdout 输出 https:// URL。")}
            </p>
          </div>
        )}
        <p className="mt-2 rounded-md bg-hover px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
          {t("拖拽或粘贴图片到编辑区、或经菜单「插入本地图片」时，按以上偏好落盘或上传。浏览器环境粘贴回退为自包含 data URI；桌面端支持真实文件复制与 CLI 图床上传。")}
        </p>
      </Section>
    </div>
  );
}

export function MarkdownSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const bool = (k: string) => prefs[k] !== false;
  const toggle = (k: string) => (v: boolean) => setPref(k, v);
  const numberingMode =
    prefs.autoNumberingMode === "all" || prefs.autoNumberingMode === "ams" || prefs.autoNumberingMode === "none"
      ? String(prefs.autoNumberingMode)
      : prefs.autoNumberingForMath
        ? "all"
        : "none";

  return (
    <div>
      <Section title={t("语法偏好")}>
        <Row
          label={t("无序列表符号")}
          hint={t("插入及序列化无序列表时的默认项目标记")}
          control={
            <Select
              value={String(prefs.unorderedListMarker ?? "-")}
              onChange={(v) => setPref("unorderedListMarker", v)}
              ariaLabel={t("无序列表标记")}
              options={[
                ["-", "- (减号，推荐)"],
                ["*", "* (星号)"],
                ["+", "+ (加号)"],
              ]}
            />
          }
        />
      </Section>

      <Section title={t("Markdown 扩展语法")}>
        <p className="mb-2 rounded-md bg-accent-soft px-3 py-2 text-[11px] leading-relaxed text-accent">
          {t("开关即时生效（编辑器按当前配置重新渲染）。覆盖常用 Markdown 扩展。")}
        </p>
        <PrefSwitch k="enableLinkify" label={t("自动识别链接")} hint={t("导出与渲染 HTML 时自动把 URL 转为可点击链接")} />
        <PrefSwitch k="enableInlineMath" label={t("内联数学公式")} hint={t("$...$ 行内公式（块级 $$ 始终支持）")} />
        <PrefSwitch k="enableCodeBlockMath" label={t("Code Block Math")} hint={t("将 ```math 代码块渲染为数学公式块")} />
        <PrefSwitch k="enableHighlight" label={t("高亮")} hint={t("==高亮文字==")} />
        <PrefSwitch k="enableSuperscript" label={t("上标")} hint={t("^上标^")} />
        <PrefSwitch k="enableSubscript" label={t("下标")} hint={t("~下标~")} />
        <PrefSwitch k="enableDiagram" label={t("Mermaid 图表")} hint={t("```mermaid 流程图/时序图等")} />
        <PrefSwitch k="enableAlert" label={t("GitHub 提示块")} hint={t("[!NOTE]/[!TIP]/[!WARNING] 等")} />
        <PrefSwitch k="enableEmoji" label={t("Emoji 简码")} hint={t(":smile: 等简码渲染为表情")} />
        <PrefSwitch k="blockHTML" label={t("渲染 HTML")} hint={t("渲染内联/块级 HTML 标签")} />
      </Section>

      <Section title={t("代码块")}>
        <Row
          label={t("默认代码块语言")}
          hint={t("新建代码块未指定语言时的默认语法识别")}
          control={
            <Select
              value={String(prefs.defaultCodeLang ?? "")}
              onChange={(v) => setPref("defaultCodeLang", v)}
              ariaLabel={t("默认代码块语言")}
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
        <PrefSwitch
          k="showLineNumbersForFence"
          label={t("代码块显示行号")}
          hint={t("在编辑区代码块左侧显示行号标尺")}
          def={false}
        />
        <PrefSwitch
          k="codeBlockWrap"
          label={t("代码块自动换行")}
          hint={t("长代码行自动折行显示而非横向滚动")}
          def={false}
        />
        <PrefSwitch
          k="codeBlockShiftTab"
          label={t("使用 Shift+Tab 减少代码缩进")}
          hint={t("在代码块中按 Tab 增加缩进、Shift+Tab 减少缩进")}
        />
        <Row
          label={t("代码缩进宽度")}
          hint={t("代码块内按 Tab 插入或减少的空格数")}
          control={
            <Select
              value={String(prefs.codeIndentSize ?? 4)}
              onChange={(v) => setPref("codeIndentSize", Number(v))}
              ariaLabel={t("代码缩进宽度")}
              options={[
                ["2", t("2 空格")],
                ["4", t("4 空格")],
              ]}
            />
          }
        />
      </Section>

      <Section title={t("公式")}>
        <PrefSwitch
          k="enablePhysicsPackage"
          label={t("启用 physics 物理宏包")}
          hint={t("支持 \\dd, \\dv, \\pdv, \\bra, \\ket, \\abs 等常用物理宏")}
          def={false}
        />
        <Row
          label={t("公式自动编号")}
          hint={t("控制块级公式右侧是否显示序号")}
          control={
            <Select
              value={numberingMode}
              onChange={(v) => setPref("autoNumberingMode", v)}
              ariaLabel={t("公式自动编号")}
              options={[
                ["none", t("不启用自动编号")],
                ["all", t("为全部块级公式编号")],
                ["ams", t("仅对含 \\label / \\tag 公式编号")],
              ]}
            />
          }
        />
        <Row
          label={t("导出 HTML 时的公式输出")}
          hint={t("选择导出 HTML 或复制为 HTML 时 KaTeX 渲染形式")}
          control={
            <Select
              value={String(prefs.exportHtmlMathFormat ?? "html")}
              onChange={(v) => setPref("exportHtmlMathFormat", v)}
              ariaLabel={t("导出 HTML 公式输出")}
              options={[
                ["html", "HTML + CSS"],
                ["mathml", "MathML"],
              ]}
            />
          }
        />
      </Section>

      <Section title={t("智能标点")}>
        <Row
          label={t("转换时机")}
          hint={t("控制直引号与 -- 破折号在何时转换")}
          control={
            <Select
              value={String(prefs.smartyPantsTiming ?? "input")}
              onChange={(v) => setPref("smartyPantsTiming", v)}
              ariaLabel={t("智能标点转换时机")}
              options={[
                ["input", t("输入时实时转换")],
                ["render", t("仅导出与渲染 HTML 时转换")],
              ]}
            />
          }
        />
        <Row
          label={t("智能引号")}
          hint={t("将直引号转换为弯引号")}
          control={<Switch checked={bool("smartQuotes")} label={t("智能引号")} onChange={toggle("smartQuotes")} />}
        />
        <Row
          label={t("智能破折号")}
          hint={t("将 -- 转换为破折号")}
          control={<Switch checked={bool("smartDashes")} label={t("智能破折号")} onChange={toggle("smartDashes")} />}
        />
        <Row
          label={t("解析时重映射 Unicode 标点")}
          control={<Switch checked={bool("remapPunctuation")} label={t("重映射标点")} onChange={toggle("remapPunctuation")} />}
        />
      </Section>

      <Section title={t("空白与换行")}>
        <PrefSwitch k="preserveLineBreak" label={t("保留单个换行")} hint={t("单个换行渲染为换行而非合并")} def={false} />
        <PrefSwitch k="indentFirstLine" label={t("段落首行缩进")} hint={t("段首缩进两个字符")} def={false} />
      </Section>
    </div>
  );
}

export function ExportSettings() {
  const { t } = useLang();
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const [pandocVer, setPandocVer] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const pandocPath = String(prefs.pandocPath ?? "");
  const defaultExportDir = String(prefs.defaultExportDir ?? "");

  const checkPandoc = async (customPath?: string) => {
    if (!isTauri()) {
      setPandocVer("");
      return;
    }
    setChecking(true);
    try {
      const v = await invoke<string>("pandoc.version", { pandocPath: customPath ?? pandocPath });
      setPandocVer(typeof v === "string" ? v.trim() : "");
    } catch {
      setPandocVer("");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void checkPandoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <Section title={t("通用导出设置")}>
        <PrefSwitch
          k="exportOpenFolder"
          label={t("导出后打开所在目录")}
          hint={t("导出 HTML、长图或 Pandoc 文档后，自动在系统文件管理器中定位目标文件")}
        />
        <div className="border-b border-line py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div>
              <p className="text-[12.5px] text-ink">{t("默认导出文件夹")}</p>
              <p className="text-[11px] text-ink-muted">{t("留空时由系统默认或当前文档所在目录决定")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={defaultExportDir}
              onChange={(e) => setPref("defaultExportDir", e.target.value)}
              placeholder={t("自动（当前工作区 / 文档目录）")}
              aria-label={t("默认导出文件夹")}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-field px-2.5 font-mono text-[11.5px] text-ink outline-none focus:border-accent"
            />
            {isTauri() && (
              <button
                type="button"
                onClick={async () => {
                  const res = await fs.openFolderDialog();
                  if (!res.canceled && res.filePaths[0]) {
                    setPref("defaultExportDir", res.filePaths[0]);
                  }
                }}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary hover:bg-hover hover:text-ink"
              >
                <FolderOpen size={12} /> {t("浏览")}
              </button>
            )}
            {defaultExportDir && (
              <button
                type="button"
                onClick={() => setPref("defaultExportDir", "")}
                className="h-7 shrink-0 rounded-md border border-line px-2 text-[11.5px] text-ink-muted hover:bg-hover hover:text-ink"
              >
                {t("重置")}
              </button>
            )}
          </div>
        </div>
        <div className="py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12.5px] text-ink">{t("Pandoc 集成与路径")}</p>
              <p className="text-[11px] text-ink-muted">
                {pandocVer
                  ? t("已检测到 Pandoc v{v}，支持导入与导出 Word / Epub / LaTeX 等格式", { v: pandocVer })
                  : isTauri()
                    ? t("未在 PATH 或指定路径检测到 Pandoc；导出 Word / Epub / LaTeX 等格式需先安装")
                    : t("Pandoc 扩展格式转换需在桌面端运行")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isTauri() && !pandocVer && (
                <button
                  type="button"
                  onClick={() => void fs.openExternal("https://pandoc.org/installing.html")}
                  className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
                >
                  <ExternalLink size={12} /> {t("安装指引")}
                </button>
              )}
              <button
                type="button"
                disabled={checking}
                onClick={() => void checkPandoc()}
                className="flex h-7 items-center gap-1 rounded-md border border-line px-2.5 text-[11.5px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
              >
                <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
                {t("重新检测")}
              </button>
            </div>
          </div>
          <input
            value={pandocPath}
            onChange={(e) => setPref("pandocPath", e.target.value)}
            placeholder={t("（自动检测 PATH 中的 pandoc）")}
            aria-label={t("Pandoc 可执行文件路径")}
            className="h-7 w-full rounded-md border border-line bg-field px-2.5 font-mono text-[11.5px] text-ink outline-none focus:border-accent"
          />
        </div>
      </Section>

      <Section title={t("支持格式")}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: "PDF", desc: t("高质量排版文档，保留完整主题色彩与数学公式") },
            { name: t("HTML (含样式)"), desc: t("自包含主题样式的网页文件，任何浏览器可直接浏览") },
            { name: t("HTML (无样式)"), desc: t("纯净语义化 HTML，便于嵌入 CMS 或博客系统") },
            { name: t("长图 (PNG)"), desc: t("高清 2x 视网膜长图渲染，适合社交分享与归档") },
            { name: "Markdown", desc: t("规范化格式后的 Markdown 源文件") },
            { name: t("Pandoc 扩展格式"), desc: t("配置 Pandoc 后支持导出 Word (.docx)、OpenOffice、RTF、Epub、LaTeX、MediaWiki、reStructuredText、Textile、OPML") },
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

export function AppearanceSettings() {
  const { t } = useLang();
  const fontSize = useUi((s) => s.fontSize);
  const setFontSize = useUi((s) => s.setFontSize);
  const editorWidth = useUi((s) => s.editorWidth);
  const setEditorWidth = useUi((s) => s.setEditorWidth);
  const toolbarVisible = useUi((s) => s.toolbarVisible);
  const toggleToolbar = useUi((s) => s.toggleToolbar);
  const statusBarVisible = useUi((s) => s.statusBarVisible);
  const toggleStatusBar = useUi((s) => s.toggleStatusBar);
  const wordCountVisible = useUi((s) => s.wordCountVisible);
  const toggleWordCount = useUi((s) => s.toggleWordCount);
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);

  const uiZoom = Number(prefs.uiZoom ?? 100);
  const wpm = Number(prefs.wordsPerMinute ?? 300);

  return (
    <div>
      <Section title={t("主题")}>
        <ThemeGallery />
      </Section>

      <Section title={t("字体大小与缩放")}>
        <Row
          label={t("编辑器字号")}
          hint={t("正文基准大小，编辑与源码同步（范围 12px - 24px）")}
          control={
            <div className="flex items-center gap-1.5">
              {fontSize !== 16 && (
                <button
                  aria-label={t("重置字号")}
                  title={t("恢复默认 16px")}
                  onClick={() => setFontSize(16)}
                  className="flex h-6 items-center gap-1 rounded border border-line px-1.5 text-[11px] text-ink-muted hover:bg-hover hover:text-ink"
                >
                  <RotateCcw size={10} /> 16px
                </button>
              )}
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
          label={t("全局界面缩放 (Zoom)")}
          hint={t("整体界面缩放比例")}
          control={
            <div className="flex items-center gap-1.5">
              {uiZoom !== 100 && (
                <button
                  type="button"
                  onClick={() => setPref("uiZoom", 100)}
                  className="flex h-6 items-center gap-1 rounded border border-line px-1.5 text-[11px] text-ink-muted hover:bg-hover hover:text-ink"
                >
                  <RotateCcw size={10} /> 100%
                </button>
              )}
              <Select
                value={String(uiZoom)}
                onChange={(v) => setPref("uiZoom", Number(v))}
                ariaLabel={t("全局界面缩放")}
                options={[
                  ["80", "80%"],
                  ["90", "90%"],
                  ["100", "100%"],
                  ["110", "110%"],
                  ["125", "125%"],
                  ["150", "150%"],
                ]}
              />
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
              ariaLabel={t("编辑区宽度")}
              options={[
                ["auto", t("自动")],
                ["standard", t("标准 · 860px")],
                ["wide", t("宽 · 1040px")],
                ["wider", t("更宽 · 1240px")],
                ["full", t("占满窗口")],
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
        <Row
          label={t("显示工具栏")}
          hint={t("底部浮动格式化工具栏")}
          control={<Switch checked={toolbarVisible} label={t("显示工具栏")} onChange={toggleToolbar} />}
        />
        <Row
          label={t("显示状态栏")}
          hint={t("底部模式切换与文档信息栏")}
          control={<Switch checked={statusBarVisible} label={t("显示状态栏")} onChange={toggleStatusBar} />}
        />
        <Row
          label={t("显示字数统计")}
          hint={t("状态栏右下角显示词数、字符数与阅读时长")}
          control={<Switch checked={wordCountVisible} label={t("显示字数统计")} onChange={toggleWordCount} />}
        />
        <PrefSwitch
          k="outlineHeadingHighlight"
          label={t("大纲高亮当前标题")}
          hint={t("滚动时高亮所在章节")}
        />
        <Row
          label={t("阅读速度")}
          hint={t("状态栏预估阅读时长的参考基准（词/分钟）")}
          control={
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={50}
                max={2000}
                step={10}
                value={wpm}
                onChange={(e) => {
                  const n = Math.max(50, Math.min(2000, Number(e.target.value) || 300));
                  setPref("wordsPerMinute", n);
                }}
                aria-label={t("阅读速度")}
                className="h-7 w-[72px] rounded-md border border-line bg-field px-2 text-right text-[12px] tabular-nums text-ink outline-none focus:border-accent"
              />
              {wpm !== 300 && (
                <button
                  type="button"
                  onClick={() => setPref("wordsPerMinute", 300)}
                  className="h-7 rounded-md border border-line px-2 text-[11px] text-ink-muted hover:bg-hover hover:text-ink"
                >
                  {t("重置")}
                </button>
              )}
            </div>
          }
        />
      </Section>
    </div>
  );
}
