import { useState, useCallback } from "react";
import {
  Scissors, Copy, ClipboardPaste, Bold, Italic, Strikethrough, Code2,
  Link2, Table2, Quote, FileCode2, Type, CheckSquare,
  Heading1, Heading2, Heading3, Heading4, List, ListOrdered, ListTodo,
  Minus, ClipboardCopy, Pilcrow, Globe, Search, ImagePlus, Sigma, Workflow,
  Hash, Check, ChevronsDownUp, ChevronsUpDown, Replace,
} from "lucide-react";
import { selectAll } from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { ContextMenu, type MenuItem } from "./common";
import { toolbar } from "./editor/toolbarCommands";
import { copySelectionAs, selectionMarkdown, stripMarkdown } from "./editor/selectionCopy";
import { getCm6 } from "./editor/activeEditor";
import { readClipboardText, writeClipboardText } from "@/bridge/clipboard";
import { readConfig, enabledEngines, openSearch } from "@/bridge/webSearch";
import { useFind } from "@/stores/find";
import { useUi } from "@/stores/ui";
import { useLang } from "@/bridge/i18n";

const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** 跨平台快捷键展示格式化：macOS 显示 ⌘/⌥/⇧，Windows 显示 Ctrl/Alt/Shift */
export function formatShortcut(combo: string): string {
  const parts = combo.split("+");
  if (isMac) {
    const hasAlt = parts.includes("Alt") || parts.includes("Option");
    const hasShift = parts.includes("Shift");
    const hasCtrl = parts.includes("Ctrl") || parts.includes("Control");
    const main = parts.filter((p) => !["Ctrl", "Control", "Alt", "Option", "Shift", "Cmd", "Command"].includes(p)).join("");
    let mod = "";
    if (hasCtrl) mod += "⌃";
    if (hasAlt) mod += "⌥";
    mod += "⌘";
    if (hasShift) mod += "⇧";
    return mod + main;
  } else {
    const prefix: string[] = ["Ctrl"];
    if (parts.includes("Alt") || parts.includes("Option")) prefix.push("Alt");
    if (parts.includes("Shift")) prefix.push("Shift");
    const main = parts.filter((p) => !["Ctrl", "Control", "Alt", "Option", "Shift", "Cmd", "Command"].includes(p)).join("+");
    return prefix.join("+") + (main ? `+${main}` : "");
  }
}

function cmSelectedText(): string {
  const v = getCm6();
  if (!v) return "";
  const { from, to } = v.state.selection.main;
  return from < to ? v.state.sliceDoc(from, to) : "";
}

function cmCopyOrCut(cut: boolean) {
  const v = getCm6();
  if (!v) return;
  const { from, to } = v.state.selection.main;
  let cFrom = from;
  let cTo = to;
  if (from === to) {
    if (!useUi.getState().prefs.copyCutWholeLine) return;
    const line = v.state.doc.lineAt(from);
    cFrom = line.from;
    cTo = Math.min(line.to + 1, v.state.doc.length);
  }
  const text = v.state.sliceDoc(cFrom, cTo);
  if (text) void writeClipboardText(text);
  if (cut && !v.state.readOnly && cFrom < cTo) {
    v.dispatch({
      changes: { from: cFrom, to: cTo, insert: "" },
      selection: { anchor: cFrom },
      scrollIntoView: true,
    });
  }
  v.focus();
}

function cmPaste() {
  void readClipboardText().then((text) => {
    if (text == null) return;
    const v = getCm6();
    if (!v || v.state.readOnly) return;
    const { from, to } = v.state.selection.main;
    v.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    v.focus();
  });
}

/** 编辑区右键菜单：代码模式展示精简代码菜单，左侧行号栏展示行号/折叠菜单，Markdown 展示完整排版菜单。 */
export function useEditorContextMenu({ isCodeFile = false }: { isCodeFile?: boolean } = {}) {
  const [pos, setPos] = useState<{ x: number; y: number; gutter: boolean } | null>(null);
  const lineNumbers = useUi((s) => s.lineNumbers);
  const { t } = useLang();

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    const gutter = Boolean(target?.closest(".cm-gutters"));
    setPos({ x: e.clientX, y: e.clientY, gutter });
  }, []);

  const openTablePicker = () => {
    if (pos) useUi.getState().setTablePickerPos({ x: pos.x, y: pos.y });
  };

  // 常用动作：图标网格 2 行 × 6 列（每个动作悬停均显示快捷键提示）
  const grid: MenuItem[] = [
    { id: "g-cut", label: t("ctx.cut"), shortcut: formatShortcut("X"), icon: <Scissors size={15} />, run: () => document.execCommand("cut") },
    { id: "g-copy", label: t("ctx.copy"), shortcut: formatShortcut("C"), icon: <Copy size={15} />, run: () => document.execCommand("copy") },
    { id: "g-paste", label: t("ctx.paste"), shortcut: formatShortcut("V"), icon: <ClipboardPaste size={15} />, run: () => document.execCommand("paste") },
    { id: "g-bold", label: t("toolbar.bold"), shortcut: formatShortcut("B"), icon: <Bold size={15} />, run: () => toolbar.bold() },
    { id: "g-italic", label: t("toolbar.italic"), shortcut: formatShortcut("I"), icon: <Italic size={15} />, run: () => toolbar.italic() },
    { id: "g-strike", label: t("toolbar.strike"), shortcut: formatShortcut("Shift+X"), icon: <Strikethrough size={15} />, run: () => toolbar.strikethrough() },
    { id: "g-code", label: t("toolbar.inlineCode"), shortcut: formatShortcut("E"), icon: <Code2 size={15} />, run: () => toolbar.inlineCode() },
    { id: "g-quote", label: t("toolbar.quote"), shortcut: formatShortcut("Alt+Q"), icon: <Quote size={15} />, run: () => toolbar.quote() },
    { id: "g-codeblock", label: t("toolbar.codeblock"), shortcut: formatShortcut("Alt+C"), icon: <FileCode2 size={15} />, run: () => toolbar.codeBlock() },
    { id: "g-link", label: t("toolbar.link"), shortcut: formatShortcut("K"), icon: <Link2 size={15} />, run: () => toolbar.link() },
    { id: "g-image", label: t("toolbar.image"), shortcut: formatShortcut("Shift+I"), icon: <ImagePlus size={15} />, run: () => toolbar.blankImage() },
    { id: "g-table", label: t("toolbar.table"), shortcut: formatShortcut("Alt+T"), icon: <Table2 size={15} />, run: openTablePicker },
  ];

  const wsCfg = readConfig();
  const getSearchQuery = () => (isCodeFile ? cmSelectedText() : stripMarkdown(selectionMarkdown()));
  const searchGroup: MenuItem[] = wsCfg.enabled && wsCfg.contextMenu
    ? [{
        id: "websearch", label: t("ctx.webSearch"), icon: <Globe size={13} />,
        children: enabledEngines(wsCfg).map((e) => ({
          id: `ws-${e.id}`, label: e.name, icon: <Search size={13} />,
          run: () => { openSearch(e, getSearchQuery()); },
        })),
      }]
    : [];

  const lineNumberItem: MenuItem = {
    id: "toggle-linenos",
    label: t(lineNumbers ? "ctx.hideLineNumbers" : "ctx.showLineNumbers"),
    icon: lineNumbers ? <Check size={13} /> : <Hash size={13} />,
    run: () => useUi.getState().toggleLineNumbers(),
  };

  const foldItems: MenuItem[] = [
    {
      id: "fold-all", label: t("ctx.foldAll"), icon: <ChevronsDownUp size={13} />,
      run: () => { const v = getCm6(); if (v) { foldAll(v); v.focus(); } },
    },
    {
      id: "unfold-all", label: t("ctx.unfoldAll"), icon: <ChevronsUpDown size={13} />,
      run: () => { const v = getCm6(); if (v) { unfoldAll(v); v.focus(); } },
    },
  ];

  const gutterItems: MenuItem[] = [
    lineNumberItem,
    { id: "sep-g", label: "", separator: true },
    ...foldItems,
  ];

  const codeItems: MenuItem[] = [
    { id: "cut", label: t("ctx.cut"), shortcut: formatShortcut("X"), icon: <Scissors size={13} />, run: () => cmCopyOrCut(true) },
    { id: "copy", label: t("ctx.copy"), shortcut: formatShortcut("C"), icon: <Copy size={13} />, run: () => cmCopyOrCut(false) },
    { id: "paste", label: t("ctx.paste"), shortcut: formatShortcut("V"), icon: <ClipboardPaste size={13} />, run: cmPaste },
    { id: "sep-c1", label: "", separator: true },
    {
      id: "selectall", label: t("ctx.selectAll"), shortcut: formatShortcut("A"), icon: <Type size={13} />,
      run: () => { const v = getCm6(); if (v) { selectAll(v); v.focus(); } },
    },
    { id: "sep-c2", label: "", separator: true },
    { id: "find", label: t("ctx.find"), shortcut: formatShortcut("F"), icon: <Search size={13} />, run: () => useFind.getState().setOpen(true) },
    { id: "replace", label: t("ctx.replace"), shortcut: formatShortcut("R"), icon: <Replace size={13} />, run: () => useFind.getState().openReplace() },
    { id: "sep-c3", label: "", separator: true },
    lineNumberItem,
    ...foldItems,
    ...(searchGroup.length ? [{ id: "sep-ws", label: "", separator: true } as MenuItem, ...searchGroup] : []),
  ];

  const mdItems: MenuItem[] = [
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
        { id: "p", label: t("ctx.body"), shortcut: formatShortcut("0"), icon: <Type size={13} />, run: () => toolbar.paragraph() },
        { id: "h1", label: t("toolbar.h1"), shortcut: formatShortcut("1"), icon: <Heading1 size={13} />, run: () => toolbar.heading(1) },
        { id: "h2", label: t("toolbar.h2"), shortcut: formatShortcut("2"), icon: <Heading2 size={13} />, run: () => toolbar.heading(2) },
        { id: "h3", label: t("toolbar.h3"), shortcut: formatShortcut("3"), icon: <Heading3 size={13} />, run: () => toolbar.heading(3) },
        { id: "h4", label: t("toolbar.h4"), shortcut: formatShortcut("4"), icon: <Heading4 size={13} />, run: () => toolbar.heading(4) },
        { id: "sep-p", label: "", separator: true },
        { id: "ul", label: t("toolbar.ul"), shortcut: formatShortcut("Alt+U"), icon: <List size={13} />, run: () => toolbar.bulletList() },
        { id: "ol", label: t("toolbar.ol"), shortcut: formatShortcut("Alt+O"), icon: <ListOrdered size={13} />, run: () => toolbar.orderedList() },
        { id: "task", label: t("toolbar.task"), shortcut: formatShortcut("Shift+X"), icon: <ListTodo size={13} />, run: () => toolbar.taskList() },
      ],
    },
    {
      id: "insert", label: t("ctx.insert"), icon: <ImagePlus size={13} />,
      children: [
        { id: "link", label: t("toolbar.link"), shortcut: formatShortcut("K"), icon: <Link2 size={13} />, run: () => toolbar.link() },
        { id: "image", label: t("toolbar.image"), shortcut: formatShortcut("Shift+I"), icon: <ImagePlus size={13} />, run: () => toolbar.blankImage() },
        { id: "table", label: t("toolbar.table"), shortcut: formatShortcut("Alt+T"), icon: <Table2 size={13} />, run: openTablePicker },
        { id: "codeblock", label: t("toolbar.codeblock"), shortcut: formatShortcut("Alt+C"), icon: <FileCode2 size={13} />, run: () => toolbar.codeBlock() },
        { id: "mathblock", label: t("ctx.mathBlock"), shortcut: formatShortcut("Alt+B"), icon: <Sigma size={13} />, run: () => toolbar.mathBlock() },
        { id: "diagram", label: t("ctx.diagram"), icon: <Workflow size={13} />, run: () => toolbar.diagram() },
        { id: "hr", label: t("toolbar.hr"), icon: <Minus size={13} />, run: () => toolbar.hr() },
      ],
    },
    { id: "sep3", label: "", separator: true },
    ...searchGroup,
    ...(searchGroup.length ? [{ id: "sep-ws", label: "", separator: true } as MenuItem] : []),
    { id: "selectall", label: t("ctx.selectAll"), shortcut: formatShortcut("A"), icon: <Type size={13} />, run: () => document.execCommand("selectAll") },
    {
      id: "source", label: t("ctx.toggleSource"), shortcut: formatShortcut("/"), icon: <CheckSquare size={13} />,
      run: () => {
        const ui = useUi.getState();
        ui.setEditorMode(ui.editorMode === "source" ? "edit" : "source");
      },
    },
  ];

  const menu = pos ? (
    <ContextMenu
      x={pos.x}
      y={pos.y}
      items={pos.gutter ? gutterItems : isCodeFile ? codeItems : mdItems}
      grid={pos.gutter || isCodeFile ? undefined : grid}
      onClose={() => setPos(null)}
    />
  ) : null;
  return { onContextMenu, menu };
}