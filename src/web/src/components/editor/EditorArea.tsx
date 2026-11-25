import { useState, useEffect } from "react";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { MilkdownEditor, syntaxSignature } from "./milkdown/MilkdownEditor";
import { CodeEditor } from "./codemirror/CodeEditor";
import { isMarkdownFile, getPreviewKind } from "./codemirror/codeLanguage";
import { FilePreview } from "./FilePreview";
import { pathUtil } from "@/bridge/fs";
import { TablePicker } from "./TablePicker";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { SelectionSearchBubble } from "../SelectionSearchBubble";
import { LinkEditBubble } from "../LinkEditBubble";
import { FindInFile } from "../FindInFile";
import { refreshOutlineSync, resetOutlineSync } from "./outlineSync";
import { Tooltip } from "../common";
import {
  Bold,
  Italic,
  Code2,
  Strikethrough,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Heading1,
  Heading2,
  Minus,
  Table2,
  Focus,
  AlignVerticalSpaceAround,
  Hash,
  ImagePlus,
} from "lucide-react";
import { getEditorView } from "./codemirror/EditorHost";
import { toolbar } from "./toolbarCommands";
import { useEditorContextMenu, formatShortcut } from "../EditorContextMenu";
import { useLang } from "@/bridge/i18n";

/** 编辑区：工具栏 + 编辑（即时渲染）/ 源码双态。 */
export function EditorArea() {
  const mode = useUi((s) => s.editorMode);
  const focusMode = useUi((s) => s.focusMode);
  const toggleFocus = useUi((s) => s.toggleFocusMode);
  const typewriter = useUi((s) => s.typewriterMode);
  const toggleTypewriter = useUi((s) => s.toggleTypewriterMode);
  const lineNumbers = useUi((s) => s.lineNumbers);
  const toggleLineNumbers = useUi((s) => s.toggleLineNumbers);
  const toolbarVisible = useUi((s) => s.toolbarVisible);
  const toggleToolbar = useUi((s) => s.toggleToolbar);
  const activePath = useWorkspace((s) => s.activePath);
  const prefs = useUi((s) => s.prefs);
  const milkdownKey = syntaxSignature(prefs);
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgOpen = useUi((s) => s.imageInsertOpen);
  const setImgOpen = useUi((s) => s.setImageInsertOpen);
  const pickerPos = useUi((s) => s.tablePickerPos);
  const setPickerPos = useUi((s) => s.setTablePickerPos);

  const disabled = !activePath;
  const ctxMenu = useEditorContextMenu();
  const fileName = activePath ? pathUtil.name(activePath) : "";
  const isCodeFile = Boolean(activePath) && !isMarkdownFile(fileName);
  const previewKind = activePath ? getPreviewKind(fileName) : null;
  const { t } = useLang();

  /* 编辑区 → 大纲 滚动联动：模式/文件切换时清空并重算高亮 */
  useEffect(() => {
    if (previewKind) return;
    resetOutlineSync();
    refreshOutlineSync();
  }, [mode, activePath, milkdownKey, previewKind]);

  const tool = (
    label: string,
    icon: React.ReactNode,
    run: () => void,
    active = false,
  ) => (
    <Tooltip label={label}>
      <button
        aria-label={label}
        disabled={disabled}
        onClick={run}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
          active ? "bg-accent-soft text-accent" : "text-ink-secondary hover:bg-hover hover:text-ink"
        }`}
      >
        {icon}
      </button>
    </Tooltip>
  );

  const sep = <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />;

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-editor" aria-label={t("编辑区")}>
      {/* 悬浮工具栏：只放工具按钮（保存走 Ctrl+S/菜单/自动保存）；窄窗口自动换行、始终居中 */}
      {toolbarVisible && !isCodeFile && !previewKind && (
      <div className="am-no-print am-glass absolute bottom-[44px] left-1/2 z-30 flex max-w-[calc(100%-20px)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-0.5 gap-y-0.5 rounded-xl border border-line bg-elevated/95 px-1.5 py-1 shadow-menu backdrop-blur-md">
        {tool(`${t("toolbar.bold")} ${formatShortcut("B")}`, <Bold size={14} />, () => toolbar.bold())}
        {tool(`${t("toolbar.italic")} ${formatShortcut("I")}`, <Italic size={14} />, () => toolbar.italic())}
        {tool(`${t("toolbar.strike")} ${formatShortcut("Shift+X")}`, <Strikethrough size={14} />, () => toolbar.strikethrough())}
        {tool(`${t("toolbar.inlineCode")} ${formatShortcut("E")}`, <Code2 size={14} />, () => toolbar.inlineCode())}
        {sep}
        {tool(`${t("toolbar.h1")} ${formatShortcut("1")}`, <Heading1 size={14} />, () => toolbar.heading(1))}
        {tool(`${t("toolbar.h2")} ${formatShortcut("2")}`, <Heading2 size={14} />, () => toolbar.heading(2))}
        {tool(`${t("toolbar.quote")} ${formatShortcut("Alt+Q")}`, <Quote size={14} />, () => toolbar.quote())}
        {sep}
        {tool(`${t("toolbar.ul")} ${formatShortcut("Alt+U")}`, <List size={14} />, () => toolbar.bulletList())}
        {tool(`${t("toolbar.ol")} ${formatShortcut("Alt+O")}`, <ListOrdered size={14} />, () => toolbar.orderedList())}
        {tool(`${t("toolbar.task")} ${formatShortcut("Shift+X")}`, <ListTodo size={14} />, () => toolbar.taskList())}
        {sep}
        {tool(`${t("toolbar.link")} ${formatShortcut("K")}`, <Link2 size={14} />, () => toolbar.link())}
        {tool(`${t("toolbar.image")} ${formatShortcut("Shift+I")}`, <ImagePlus size={14} />, () => setImgOpen(true))}
        <span className="relative shrink-0">
          {tool(`${t("toolbar.table")} ${formatShortcut("Alt+T")}`, <Table2 size={14} />, () => setPickerOpen((o) => !o), pickerOpen)}
          {pickerOpen && (
            <TablePicker
              onPick={(r, c) => {
                toolbar.table(r, c);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </span>
        {tool(t("toolbar.hr"), <Minus size={14} />, () => toolbar.hr())}
        {tool(`${t("toolbar.codeblock")} ${formatShortcut("Alt+C")}`, <Code2 size={14} />, () => toolbar.codeBlock())}
        {sep}
        {mode === "source" && tool(t("行号"), <Hash size={14} />, toggleLineNumbers, lineNumbers)}
        {tool(t("toolbar.typewriter"), <AlignVerticalSpaceAround size={14} />, toggleTypewriter, typewriter)}
        {tool(`${t("toolbar.focus")} ${formatShortcut("Shift+D")}`, <Focus size={14} />, toggleFocus, focusMode)}
      </div>
      )}

      <FindInFile />
      <SelectionSearchBubble />
      <LinkEditBubble />
      <ImageInsertDialog open={imgOpen} onClose={() => setImgOpen(false)} />

      {/* 右键/菜单触发的表格尺寸 picker：浮动锚点，视口内夹紧 */}
      {pickerPos && (
        <div
          className="fixed z-[80]"
          style={{
            left: Math.min(Math.max(pickerPos.x, 140), window.innerWidth - 140),
            top: Math.min(Math.max(pickerPos.y, 8), window.innerHeight - 360),
          }}
        >
          <TablePicker
            onPick={(r, c) => {
              toolbar.table(r, c);
              setPickerPos(null);
            }}
            onClose={() => setPickerPos(null)}
          />
        </div>
      )}

      {/* 内容：图片/PDF=预览；md 编辑=Milkdown 原位 WYSIWYG；源码/代码=统一 CodeEditor */}
      <div className="relative min-h-0 flex-1" onContextMenu={previewKind ? undefined : ctxMenu.onContextMenu}>
        {previewKind ? (
          <FilePreview path={activePath!} kind={previewKind} />
        ) : !isCodeFile && mode === "edit" ? (
          <MilkdownEditor key={milkdownKey} />
        ) : (
          <CodeEditor />
        )}
      </div>
      {!previewKind && ctxMenu.menu}
    </main>
  );
}