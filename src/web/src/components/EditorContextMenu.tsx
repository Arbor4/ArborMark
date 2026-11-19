import { useState, useCallback } from "react";
import {
  Scissors, Copy, ClipboardPaste, Bold, Italic, Strikethrough, Code2,
  Link2, Table2, Quote, FileCode2, Type, CheckSquare,
  Heading1, Heading2, Heading3, Heading4, List, ListOrdered, ListTodo,
  Minus, ClipboardCopy, Pilcrow, Globe, Search, ImagePlus, Sigma, Workflow,
} from "lucide-react";
import { ContextMenu, type MenuItem } from "./common";
import { toolbar } from "./editor/toolbarCommands";
import { copySelectionAs, selectionMarkdown, stripMarkdown } from "./editor/selectionCopy";
import { readConfig, enabledEngines, openSearch } from "@/bridge/webSearch";
import { useUi } from "@/stores/ui";
import { useLang } from "@/bridge/i18n";

/** 编辑区右键菜单：经典分组，可折叠（段落 / 格式 / 插入 / 复制为）。 */
export function useEditorContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const { t } = useLang();

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  const openTablePicker = () => {
    if (pos) useUi.getState().setTablePickerPos({ x: pos.x, y: pos.y });
  };

  // 常用动作：图标网格 2 行 × 6 列
  const grid: MenuItem[] = [
    { id: "g-cut", label: t("ctx.cut"), shortcut: "⌘X", icon: <Scissors size={15} />, run: () => document.execCommand("cut") },
    { id: "g-copy", label: t("ctx.copy"), shortcut: "⌘C", icon: <Copy size={15} />, run: () => document.execCommand("copy") },
    { id: "g-paste", label: t("ctx.paste"), shortcut: "⌘V", icon: <ClipboardPaste size={15} />, run: () => document.execCommand("paste") },
    { id: "g-bold", label: t("toolbar.bold"), shortcut: "⌘B", icon: <Bold size={15} />, run: () => toolbar.bold() },
    { id: "g-italic", label: t("toolbar.italic"), shortcut: "⌘I", icon: <Italic size={15} />, run: () => toolbar.italic() },
    { id: "g-strike", label: t("toolbar.strike"), shortcut: "⌘⇧X", icon: <Strikethrough size={15} />, run: () => toolbar.strikethrough() },
    { id: "g-code", label: t("toolbar.inlineCode"), shortcut: "⌘E", icon: <Code2 size={15} />, run: () => toolbar.inlineCode() },
    { id: "g-quote", label: t("toolbar.quote"), icon: <Quote size={15} />, run: () => toolbar.quote() },
    { id: "g-codeblock", label: t("toolbar.codeblock"), icon: <FileCode2 size={15} />, run: () => toolbar.codeBlock() },
    { id: "g-link", label: t("toolbar.link"), icon: <Link2 size={15} />, run: () => toolbar.link() },
    { id: "g-image", label: t("toolbar.image"), icon: <ImagePlus size={15} />, run: () => toolbar.blankImage() },
    { id: "g-table", label: t("toolbar.table"), icon: <Table2 size={15} />, run: openTablePicker },
  ];

  const wsCfg = readConfig();
  const searchGroup: MenuItem[] = wsCfg.enabled && wsCfg.contextMenu
    ? [{
        id: "websearch", label: t("ctx.webSearch"), icon: <Globe size={13} />,
        children: enabledEngines(wsCfg).map((e) => ({
          id: `ws-${e.id}`, label: e.name, icon: <Search size={13} />,
          run: () => { openSearch(e, stripMarkdown(selectionMarkdown())); },
        })),
      }]
    : [];

  const items: MenuItem[] = [
    {
      id: "copyas", label: t("ctx.copyAs"), icon: <ClipboardCopy size={13} />,
      children: [
        { id: "copymd", label: t("ctx.md"), icon: <Copy size={13} />, run: () => copySelectionAs("markdown") },
        { id: "copyhtml", label: t("ctx.htmlSource"), icon: <Code2 size={13} />, run: () => copySelectionAs("html") },
        { id: "copysemantic", label: t("ctx.semanticHtml"), icon: <Type size={13} />, run: () => copySelectionAs("semantic-html") },
        { id: "copyplain", label: t("ctx.plain"), icon: <Type size={13} />, run: () => copySelectionAs("plain") },
      ],
    },
    { id: "sep2", label: "", separator: true },
    {
      id: "para", label: t("ctx.paragraph"), icon: <Pilcrow size={13} />,
      children: [
        { id: "p", label: t("ctx.body"), icon: <Type size={13} />, run: () => toolbar.paragraph() },
        { id: "h1", label: t("toolbar.h1"), icon: <Heading1 size={13} />, run: () => toolbar.heading(1) },
        { id: "h2", label: t("toolbar.h2"), icon: <Heading2 size={13} />, run: () => toolbar.heading(2) },
        { id: "h3", label: t("toolbar.h3"), icon: <Heading3 size={13} />, run: () => toolbar.heading(3) },
        { id: "h4", label: t("toolbar.h4"), icon: <Heading4 size={13} />, run: () => toolbar.heading(4) },
        { id: "sep-p", label: "", separator: true },
        { id: "ul", label: t("toolbar.ul"), icon: <List size={13} />, run: () => toolbar.bulletList() },
        { id: "ol", label: t("toolbar.ol"), icon: <ListOrdered size={13} />, run: () => toolbar.orderedList() },
        { id: "task", label: t("toolbar.task"), icon: <ListTodo size={13} />, run: () => toolbar.taskList() },
      ],
    },
    {
      id: "insert", label: t("ctx.insert"), icon: <ImagePlus size={13} />,
      children: [
        { id: "link", label: t("toolbar.link"), icon: <Link2 size={13} />, run: () => toolbar.link() },
        { id: "image", label: t("toolbar.image"), icon: <ImagePlus size={13} />, run: () => toolbar.blankImage() },
        { id: "table", label: t("toolbar.table"), icon: <Table2 size={13} />, run: openTablePicker },
        { id: "codeblock", label: t("toolbar.codeblock"), icon: <FileCode2 size={13} />, run: () => toolbar.codeBlock() },
        { id: "mathblock", label: t("ctx.mathBlock"), icon: <Sigma size={13} />, run: () => toolbar.mathBlock() },
        { id: "diagram", label: t("ctx.diagram"), icon: <Workflow size={13} />, run: () => toolbar.diagram() },
        { id: "hr", label: t("toolbar.hr"), icon: <Minus size={13} />, run: () => toolbar.hr() },
      ],
    },
    { id: "sep3", label: "", separator: true },
    ...searchGroup,
    ...(searchGroup.length ? [{ id: "sep-ws", label: "", separator: true } as MenuItem] : []),
    { id: "selectall", label: t("ctx.selectAll"), icon: <Type size={13} />, shortcut: "⌘A", run: () => document.execCommand("selectAll") },
    {
      id: "source", label: t("ctx.toggleSource"), icon: <CheckSquare size={13} />,
      run: () => {
        const ui = useUi.getState();
        ui.setEditorMode(ui.editorMode === "source" ? "edit" : "source");
      },
    },
  ];

  const menu = pos ? <ContextMenu x={pos.x} y={pos.y} items={items} grid={grid} onClose={() => setPos(null)} /> : null;
  return { onContextMenu, menu };
}