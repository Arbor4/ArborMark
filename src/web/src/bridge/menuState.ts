/**
 * 原生菜单勾选/可用状态同步。
 * 从活跃编辑器（Milkdown 优先、CM6 回退）与 ui/workspace/主题注册表计算状态，
 * 经 menu.update 增量推送到 Rust 菜单；主题列表变化时经 menu.rebuildThemes 重建子菜单。
 */
import { editorViewCtx, schemaCtx } from "@milkdown/core";
import type { EditorView as PMView } from "@milkdown/prose/view";
import type { Schema } from "@milkdown/prose/model";
import { getMilkdown, getCm6 } from "@/components/editor/activeEditor";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { getAllThemes, getCurrentThemeId, subscribeThemes } from "@/theme/registry";
import { isTauri, invoke } from "@/bridge/ipc";

type MenuState = { state?: boolean; enabled?: boolean };
type States = Record<string, MenuState>;

interface EditorCtx {
  heading: number;
  paragraph: boolean;
  quote: boolean;
  ol: boolean;
  ul: boolean;
  task: boolean;
  taskChecked: boolean | null;
  fences: boolean;
  math: boolean;
  table: boolean;
  marks: Set<string>;
}

const EMPTY: EditorCtx = {
  heading: 0,
  paragraph: false,
  quote: false,
  ol: false,
  ul: false,
  task: false,
  taskChecked: null,
  fences: false,
  math: false,
  table: false,
  marks: new Set(),
};

function pmContext(): EditorCtx | null {
  const editor = getMilkdown();
  if (!editor) return null;
  return editor.action((ctx) => {
    const view: PMView = ctx.get(editorViewCtx);
    const schema: Schema = ctx.get(schemaCtx);
    const { $from, from, to, empty } = view.state.selection;
    const c: EditorCtx = { ...EMPTY, marks: new Set() };
    const b = $from.depth >= 1 ? $from.node(1) : null;
    if (b) {
      if (b.type.name === "heading") c.heading = b.attrs.level as number;
      c.paragraph = b.type.name === "paragraph";
      c.fences = b.type.name === "code_block";
      c.math = b.type.name === "math_block";
      c.table = b.type.name === "table";
    }
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      const name = n.type.name;
      if (name === "blockquote" || name === "alert") c.quote = true;
      if (name === "ordered_list") c.ol = true;
      if (name === "bullet_list") c.ul = true;
      if (name === "table") c.table = true;
      if (name === "code_block") c.fences = true;
      if (name === "math_block") c.math = true;
      if (name === "list_item" && n.attrs.checked != null) {
        c.task = true;
        c.taskChecked = Boolean(n.attrs.checked);
      }
    }
    if (c.task) c.ul = false;
    const activeMarks = empty ? $from.marks() : null;
    for (const name of Object.keys(schema.marks)) {
      const mark = schema.marks[name];
      const on = activeMarks
        ? !!mark.isInSet(activeMarks)
        : view.state.doc.rangeHasMark(from, to, mark);
      if (on) c.marks.add(name);
    }
    if (!empty && c.marks.size === 0) {
      // 选区跨多种 mark 时 rangeHasMark 已覆盖；空选区用 storedMarks 补充
      for (const m of view.state.storedMarks ?? []) c.marks.add(m.type.name);
    }
    return c;
  });
}

/** CM6：行前缀 + 围栏奇偶 + 包裹符号启发式。 */
function cmContext(): EditorCtx | null {
  const v = getCm6();
  if (!v) return null;
  const c: EditorCtx = { ...EMPTY, marks: new Set() };
  const { doc } = v.state;
  const pos = v.state.selection.main.head;
  const line = doc.lineAt(pos);
  let fence = false;
  let math = false;
  let fenceLangLine = 0;
  for (let i = 1; i <= line.number; i++) {
    const t = doc.line(i).text;
    if (/^```/.test(t)) { fence = !fence; fenceLangLine = i; }
    else if (/^\$\$/.test(t)) math = !math;
  }
  c.fences = fence;
  c.math = math;
  const hm = /^(#{1,6})\s/.exec(line.text);
  if (hm && !fence) c.heading = hm[1].length;
  c.quote = !fence && /^>\s?/.test(line.text);
  c.task = !fence && /^\s*[-*+]\s+\[[ xX]\]/.test(line.text);
  c.taskChecked = c.task ? /\[[xX]\]/.test(line.text) : null;
  c.ul = !fence && !c.task && /^\s*[-*+]\s+/.test(line.text);
  c.ol = !fence && /^\s*\d+\.\s+/.test(line.text);
  c.paragraph = !fence && !c.heading && !c.quote && !c.ul && !c.ol && !c.task && line.text.trim() !== "" && !line.text.includes("|");
  c.table = !fence && line.text.includes("|");
  const wrapped = (before: string, after: string) => {
    const text = line.text;
    const off = pos - line.from;
    let i = text.indexOf(before);
    while (i !== -1) {
      const j = text.indexOf(after, i + before.length);
      if (j !== -1 && off > i && off <= j + after.length) return true;
      i = text.indexOf(before, i + 1);
    }
    return false;
  };
  if (wrapped("**", "**")) c.marks.add("strong");
  if (wrapped("*", "*") && !wrapped("**", "**")) c.marks.add("emphasis");
  if (wrapped("`", "`")) c.marks.add("inlineCode");
  if (wrapped("~~", "~~")) c.marks.add("strike_through");
  if (wrapped("==", "==")) c.marks.add("mark");
  if (wrapped("%%", "%%")) c.marks.add("comment");
  if (wrapped("<u>", "</u>")) c.marks.add("underline");
  if (wrapped("^", "^")) c.marks.add("superscript");
  if (wrapped("$", "$")) c.marks.add("math_inline");
  if (/\[[^\]]*\]\([^)]*\)/.test(line.text)) c.marks.add("link");
  void fenceLangLine;
  return c;
}

function editorContext(): EditorCtx {
  return pmContext() ?? cmContext() ?? EMPTY;
}

export function computeMenuStates(): States {
  const ui = useUi.getState();
  const ws = useWorkspace.getState();
  const prefs = ui.prefs as Record<string, unknown>;
  const pref = (k: string, def = false) => (prefs[k] === undefined ? def : prefs[k] !== false && prefs[k] !== "false");
  const c = editorContext();
  const s: States = {};
  const put = (id: string, state: boolean, enabled?: boolean) => {
    s[id] = enabled === undefined ? { state } : { state, enabled };
  };

  /* 段落 */
  for (let l = 1; l <= 6; l++) put(`Paragraph→Heading ${l}`, c.heading === l);
  put("Paragraph→Paragraph", c.paragraph);
  put("Paragraph→Quote", c.quote);
  put("Paragraph→Ordered List", c.ol);
  put("Paragraph→Unordered List", c.ul);
  put("Paragraph→Task List", c.task);
  put("Paragraph→Code Fences", c.fences);
  put("Paragraph→Math Block", c.math);
  put("Paragraph→Task Status→Mark as Complete", c.taskChecked === true, c.task);
  put("Paragraph→Task Status→Mark as Incomplete", c.taskChecked === false, c.task);
  const tableOps = [
    "Add Row Above", "Add Row Below", "Add Column Before", "Add Column After",
    "Move Row Up", "Move Row Down", "Move Column Left", "Move Column Right",
    "Delete Row", "Delete Column", "Prettify Source Code", "Copy Table", "Delete Table",
  ];
  for (const op of tableOps) put(`Paragraph→Table→${op}`, false, c.table);
  put("Paragraph→Code Tools→Auto Indent Selected Code", false, c.fences);
  put("Paragraph→Code Tools→Auto Indent Whole Code", false, c.fences);
  put("Paragraph→Code Tools→Copy Code Content", false, c.fences);

  /* 格式 */
  put("Format→Strong", c.marks.has("strong"));
  put("Format→Emphasis", c.marks.has("emphasis"));
  put("Format→Underline", c.marks.has("underline"));
  put("Format→Code", c.marks.has("inlineCode"));
  put("Format→Strike", c.marks.has("strike_through"));
  put("Format→Comment", c.marks.has("comment"));
  put("Format→Hyperlink", c.marks.has("link"));
  put("Format→Inline Math", c.marks.has("math_inline"));
  put("Format→Highlight", c.marks.has("mark"));
  put("Format→Superscript", c.marks.has("superscript"));
  put("Format→Subscript", c.marks.has("subscript"));
  put("Format→Image→When Insert Local Image→Copy Image File to Folder…", !["none", "upload"].includes(String(prefs.imgInsertAction ?? "assets")));
  put("Format→Image→When Insert Local Image→Upload Image", prefs.imgInsertAction === "upload");
  put("Format→Image→Use Image Root Path", prefs.imgBase === "workspace");
  put("Format→Image→Switch Image Syntax→Markdown Style", !pref("imageSyntaxHtml"));
  put("Format→Image→Switch Image Syntax→HTML Style", pref("imageSyntaxHtml"));

  /* 视图 */
  put("View→Source Code Mode", ui.editorMode === "source");
  put("View→Readonly Mode", ui.readonlyMode || (ws.activePath ?? "").startsWith("help://"));
  put("View→Focus Mode", ui.focusMode);
  put("View→Typewriter Mode", ui.typewriterMode);
  put("View→Outline", ui.panel === "outline" && ui.sidebarVisible);
  put("View→Articles", ui.panel === "files" && ui.sidebarVisible);
  put("View→File Tree", ui.panel === "files" && ui.sidebarVisible);
  put("View→Toolbar", ui.toolbarVisible);
  put("View→Show Status Bar", ui.statusBarVisible);
  put("View→Toggle Word Count Popover", ui.wordCountVisible);
  put("View→Always on Top", document.body.classList.contains("always-on-top"));

  /* 编辑偏好 */
  put("Edit→Smart Punctuation→Convert on Input", (prefs.smartyPantsTiming ?? "input") === "input");
  put("Edit→Smart Punctuation→Convert on Rendering", prefs.smartyPantsTiming === "render");
  put("Edit→Smart Punctuation→Smart Quotes", pref("smartQuotes", true));
  put("Edit→Smart Punctuation→Smart Dashes", pref("smartDashes", true));
  put("Edit→Smart Punctuation→Remap Unicode Punctuation on Parse", pref("remapPunctuation"));
  put("Edit→Line Endings→Windows Line Endings (CRLF)", prefs.defaultEol === "crlf" || pref("useCRLF"));
  put("Edit→Line Endings→Unix Line Endings (LF)", prefs.defaultEol !== "crlf" && !pref("useCRLF"));
  put("Edit→Line Endings→Insert Final New Line On Save", pref("finalNewline", true));
  put("Edit→Whitespace and Line Breaks→Indent first line of paragraphs", pref("indentFirstLine"));
  put("Edit→Whitespace and Line Breaks→Preserve single line break", pref("preserveLineBreak"));
  put("Edit→Whitespace and Line Breaks→Visible <br/>", !pref("hideBr"));
  put("Edit→Spelling and Grammar→Check Spelling While Typing", pref("spellcheck"));
  put("Edit→Spelling and Grammar→Check Grammar With Spelling", pref("checkGrammarWithSpelling"));
  put("Edit→Spelling and Grammar→Correct Spelling Automatically", pref("autoCorrectMisspell"));

  /* 编码：统一 UTF-8 */
  put("File→Reopen with Encoding→Auto", true);
  put("File→Reopen with Encoding→UTF-8", true);

  /* 主题 */
  const current = getCurrentThemeId();
  for (const t of getAllThemes()) put(`Themes→${t.id}`, t.id === current);

  return s;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function syncMenuStates() {
  if (!isTauri()) return;
  invoke("menu.update", computeMenuStates()).catch(() => {});
}

export function rebuildThemeMenu() {
  if (!isTauri()) return;
  invoke("menu.rebuildThemes", {
    themes: getAllThemes().map((t) => ({ id: t.id, label: t.name })),
    current: getCurrentThemeId(),
  }).catch(() => {});
}

function schedule() {
  if (!isTauri()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(syncMenuStates, 120);
}

let initialized = false;

let lastThemeSignature = "";

export function initMenuStateSync() {
  if (initialized) return;
  initialized = true;
  document.addEventListener("selectionchange", schedule);
  useUi.subscribe(schedule);
  useWorkspace.subscribe(schedule);
  subscribeThemes(() => {
    // 仅在主题列表自身结构增删时才全量重建原生主题菜单；常规切主题只需增量同步勾选
    const sig = getAllThemes().map((t) => t.id).join(",");
    if (sig !== lastThemeSignature) {
      lastThemeSignature = sig;
      rebuildThemeMenu();
    }
    schedule();
  });
  // 兜底：文档变化不一定触发 selectionchange（如工具栏切换）
  setInterval(schedule, 800);
  lastThemeSignature = getAllThemes().map((t) => t.id).join(",");
  rebuildThemeMenu();
  // 启动流程（rendererReady/openDefault）可能按 spec 重建原生菜单，
  // 待启动稳定后再以 web 注册表（内置 + 用户主题）同步一次，保证数量一致。
  setTimeout(rebuildThemeMenu, 1500);
  schedule();
}