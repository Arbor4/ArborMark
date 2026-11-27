import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, CircleHelp, FolderOpen, RefreshCw, RotateCcw, ExternalLink } from "lucide-react";
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
          label={t("自动配对符号")}
          hint={t("自动补全括号、引号与 Markdown 标记")}
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
          k="copyCutWholeLine"
          label={t("复制/剪切整行")}
          hint={t("复制或剪切时，若没有文字被选中，则处理光标所在的一整行")}
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
                <Check k="imgYamlUpload" label={t("允许根据 YAML 设置自动上传图片")} def={false} />
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

      <Section title={t("图床与说明")}>
        <Row
          label={t("上传服务")}
          hint={t("当前版本优先保证本地相对路径与附件目录稳定落盘；未配置外部图床时将回退为本地引用")}
          control={<span className="rounded bg-hover px-2 py-0.5 text-[11px] text-ink-muted">{t("无（本地优先）")}</span>}
        />
        <p className="mt-2 rounded-md bg-hover px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
          {t("拖拽或粘贴图片到编辑区、或经菜单「插入本地图片」时，按以上偏好落盘并生成路径。浏览器环境粘贴回退为自包含 data URI；桌面端复制真实文件到附件目录。点击图片可放大查看；导出 PDF/HTML 时相对路径按设置保留或转换。")}
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
        <PrefSwitch k="enableInlineMath" label={t("内联数学公式")} hint={t("$...$ 行内公式（块级 $$ 始终支持）")} />
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
      </Section>

      <Section title={t("公式")}>
        <PrefSwitch
          k="autoNumberingForMath"
          label={t("公式自动编号")}
          hint={t("为块级 $$ 公式右侧添加自动序号 (1), (2)…")}
          def={false}
        />
      </Section>

      <Section title={t("智能标点")}>
        <Row
          label={t("智能引号")}
          hint={t("渲染与导出 HTML 时将直引号转换为弯引号")}
          control={<Switch checked={bool("smartQuotes")} label={t("智能引号")} onChange={toggle("smartQuotes")} />}
        />
        <Row
          label={t("智能破折号")}
          hint={t("渲染与导出 HTML 时将 -- 转换为破折号")}
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
  const [pandocVer, setPandocVer] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const checkPandoc = async () => {
    if (!isTauri()) {
      setPandocVer("");
      return;
    }
    setChecking(true);
    try {
      const v = await invoke<string>("pandoc.version");
      setPandocVer(typeof v === "string" ? v.trim() : "");
    } catch {
      setPandocVer("");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void checkPandoc();
  }, []);

  return (
    <div>
      <Section title={t("通用导出设置")}>
        <PrefSwitch
          k="exportOpenFolder"
          label={t("导出后打开所在目录")}
          hint={t("导出 HTML、长图或 Pandoc 文档后，自动在系统文件管理器中定位目标文件")}
        />
        <Row
          label={t("Pandoc 集成")}
          hint={
            pandocVer
              ? t("已检测到 Pandoc v{v}，支持导入与导出 Word / Epub / LaTeX 等格式", { v: pandocVer })
              : isTauri()
                ? t("未在系统 PATH 中检测到 Pandoc；导出 Word / Epub / LaTeX 等格式需先安装 Pandoc")
                : t("Pandoc 扩展格式转换需在桌面端运行")
          }
          control={
            <div className="flex items-center gap-1.5">
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
          }
        />
      </Section>

      <Section title={t("支持格式")}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: "PDF", desc: t("高质量排版文档，保留完整主题色彩与数学公式") },
            { name: t("HTML (含样式)"), desc: t("自包含主题样式的网页文件，任何浏览器可直接浏览") },
            { name: t("HTML (无样式)"), desc: t("纯净语义化 HTML，便于嵌入 CMS 或博客系统") },
            { name: t("长图 (PNG)"), desc: t("高清 2x 视网膜长图渲染，适合社交分享与归档") },
            { name: "Markdown", desc: t("规范化格式后的 Markdown 源文件") },
            { name: t("Pandoc 扩展格式"), desc: t("配置 Pandoc 后支持 Word (.docx)、Epub、LaTeX、RTF 等") },
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
          label={t("编辑区宽度")}
          hint={t("长文写作的最佳行宽")}
          control={
            <Select
              value={editorWidth}
              onChange={(v) => setEditorWidth(v as keyof typeof EDITOR_WIDTHS)}
              ariaLabel={t("编辑区宽度")}
              options={[
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
          hint={t("状态栏预估阅读时长的参考基准")}
          control={
            <Select
              value={String(prefs.wordsPerMinute ?? 300)}
              onChange={(v) => setPref("wordsPerMinute", Number(v))}
              ariaLabel={t("阅读速度")}
              options={[
                ["200", t("200 词/分钟 (精读)")],
                ["300", t("300 词/分钟 (标准)")],
                ["380", t("380 词/分钟 (常规)")],
                ["400", t("400 词/分钟 (快速)")],
                ["500", t("500 词/分钟 (速览)")],
              ]}
            />
          }
        />
      </Section>
    </div>
  );
}
