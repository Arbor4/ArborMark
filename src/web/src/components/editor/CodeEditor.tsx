import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit,
  syntaxHighlighting, HighlightStyle, ensureSyntaxTree, syntaxTreeAvailable,
} from "@codemirror/language";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { useWorkspace } from "@/stores/workspace";
import { useUi, EDITOR_WIDTHS } from "@/stores/ui";
import { setActiveEditor } from "./activeEditor";
import { captureFromCm, applyToCm } from "./editorViewSync";
import { openLinkTarget } from "./openLink";
import { loadLanguage, languageLabel, isMarkdownFile } from "./codeLanguage";
import { refreshFind } from "./findSync";
import { attachImageHandlers } from "./imageInsert";
import { useLang } from "@/bridge/i18n";

/** 主题感知的代码高亮配色（全部走主题 token）。 */
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--am-info)", fontWeight: "600" },
  { tag: tags.controlKeyword, color: "var(--am-info)", fontWeight: "600" },
  { tag: tags.moduleKeyword, color: "var(--am-info)", fontWeight: "600" },
  { tag: tags.operator, color: "var(--am-text-secondary)" },
  { tag: tags.string, color: "var(--am-success)" },
  { tag: tags.special(tags.string), color: "var(--am-accent)" },
  { tag: tags.number, color: "var(--am-warning)" },
  { tag: tags.bool, color: "var(--am-warning)" },
  { tag: tags.null, color: "var(--am-warning)" },
  { tag: tags.atom, color: "var(--am-warning)" },
  { tag: tags.comment, color: "var(--am-text-muted)", fontStyle: "italic" },
  { tag: tags.lineComment, color: "var(--am-text-muted)", fontStyle: "italic" },
  { tag: tags.blockComment, color: "var(--am-text-muted)", fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: "var(--am-accent)" },
  { tag: tags.definition(tags.variableName), color: "var(--am-accent)" },
  { tag: tags.standard(tags.name), color: "var(--am-accent)" },
  { tag: tags.standard(tags.variableName), color: "var(--am-accent)" },
  { tag: tags.special(tags.variableName), color: "var(--am-accent)" },
  { tag: tags.macroName, color: "var(--am-accent)" },
  { tag: tags.typeName, color: "var(--am-info)", fontWeight: "500" },
  { tag: tags.className, color: "var(--am-info)" },
  { tag: tags.tagName, color: "var(--am-danger)" },
  { tag: tags.attributeName, color: "var(--am-warning)" },
  { tag: tags.propertyName, color: "var(--am-accent)" },
  { tag: tags.variableName, color: "var(--am-text)" },
  { tag: tags.bracket, color: "var(--am-text-secondary)" },
  { tag: tags.punctuation, color: "var(--am-text-muted)" },
  { tag: tags.heading, color: "var(--am-md-heading)", fontWeight: "bold" },
  { tag: tags.link, color: "var(--am-info)", textDecoration: "underline" },
  { tag: tags.meta, color: "var(--am-text-muted)" },
]);

const codeTheme = EditorView.theme({
  "&": { backgroundColor: "var(--am-bg-editor)", color: "var(--am-text)", fontSize: "var(--am-editor-size, 15px)", outline: "none !important" },
  "&.cm-focused": { outline: "none !important" },
  "&.cm-editor": { outline: "none !important" },
  "&.cm-editor.cm-focused": { outline: "none !important" },
  ".cm-scroller": { outline: "none !important" },
  ".cm-scroller:focus": { outline: "none !important" },
  ".cm-content": { fontFamily: "var(--am-font-mono)", caretColor: "var(--am-accent)", padding: "16px 0", outline: "none !important" },
  ".cm-content:focus": { outline: "none !important" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--am-accent)", borderLeftWidth: "2px", transition: "opacity 0.15s ease" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--am-selection-bg)" },
  ".cm-gutters": { backgroundColor: "var(--am-bg-editor)", color: "var(--am-text-muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--am-text) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--am-text) 5%, var(--am-bg-editor))", color: "var(--am-text-secondary)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--am-accent-soft)", outline: "1px solid var(--am-accent)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--am-bg-hover)", border: "none", color: "var(--am-text-muted)" },
  ".cm-tooltip": { backgroundColor: "var(--am-bg-elevated)", border: "1px solid var(--am-border)" },
  ".cm-panels": { backgroundColor: "var(--am-bg-elevated)", color: "var(--am-text)" },
  ".cm-searchMatch": { backgroundColor: "var(--am-accent-soft)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--am-accent)" },
}, { dark: false });

/** 偏好 → CM6 扩展：自动配对符号 + 缩进宽度。 */
function pairExtensions(prefs: Record<string, boolean | string | number>) {
  const size = Math.max(1, Math.min(8, Number(prefs.indentSize ?? 2) || 2));
  return [
    ...(prefs.autoPair === false ? [] : [closeBrackets()]),
    indentUnit.of(" ".repeat(size)),
  ];
}

/**
 * 语法预热加速器：
 * CodeMirror 6 默认仅解析初始视口（首屏数十行），后续代码依靠 requestIdle 慢速解析。
 * 对于 SQL/Python/C/Rust 等 StreamLanguage 模式，向下滚动时未解析到的行高亮树为空，
 * 导致用户向下滚动时下方代码呈现未上色的纯白文字，甚至停顿数秒才上色。
 *
 * 本函数在语言挂载/文件切换/内容加载后发起前置快速解析，
 * 对于常规代码文件（一般 10~30ms 内完成），直接一次性构建全文语法树并更新状态，
 * 确保向下极速滚动时任意行均已上色，彻底告别滚动白字/不上色。
 */
function warmupSyntax(view: EditorView) {
  if (!view.dom.isConnected) return;
  const docLen = view.state.doc.length;
  if (docLen === 0) return;

  // 1. 同步快推进：先保证当前视口及下方 30,000 字符（约 500-1000 行）立即就绪
  const immediateUpto = Math.min(docLen, Math.max(view.viewport.to + 30000, 30000));
  const tree = ensureSyntaxTree(view.state, immediateUpto, 250);
  if (tree) {
    view.dispatch({});
  }

  // 2. 若超大文件尚未全量就绪，在后台分片跑完剩余部分
  if (!syntaxTreeAvailable(view.state, docLen)) {
    const parseRest = () => {
      if (!view.dom.isConnected) return;
      const t = ensureSyntaxTree(view.state, docLen, 500);
      if (t) {
        view.dispatch({});
      }
      if (!syntaxTreeAvailable(view.state, docLen)) {
        setTimeout(parseRest, 16);
      }
    };
    setTimeout(parseRest, 0);
  }
}

/** 非 Markdown 文件：带语法高亮的纯代码编辑器（CM6），可编辑/保存/搜索替换。 */
export function CodeEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const lineNoComp = useRef(new Compartment());
  const pairComp = useRef(new Compartment());
  const readonlyComp = useRef(new Compartment());
  const applyingExternal = useRef(false);
  const lastPath = useRef<string | null>(null);
  const reloadToken = useWorkspace((s) => s.reloadToken);
  const lastReloadToken = useRef(reloadToken);

  const activePath = useWorkspace((s) => s.activePath);
  const content = useWorkspace((s) => s.content);
  const fontSize = useUi((s) => s.fontSize);
  const editorWidth = useUi((s) => s.editorWidth);
  const lineNumbersOn = useUi((s) => s.lineNumbers);
  const readonlyMode = useUi((s) => s.readonlyMode);
  const autoPairOn = useUi((s) => s.prefs.autoPair !== false);
  const indentSize = Number(useUi((s) => s.prefs.indentSize ?? 2));
  const { t } = useLang();

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = useWorkspace.getState();
    const initUi = useUi.getState();
    const view = new EditorView({
      state: EditorState.create({
        doc: ws.content,
        extensions: [
          highlightSpecialChars(), history(),
          foldGutter({
            markerDOM(open) {
              const el = document.createElement("span");
              el.className = `am-fold-marker ${open ? "open" : "folded"}`;
              el.title = open ? "折叠代码块" : "展开代码块";
              // 直角折角箭头（90° 锐角几何折角，极简现代设计）
              el.innerHTML = open
                ? `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6 L8 10.5 L12.5 6"/></svg>`
                : `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 L10.5 8 L6 12.5"/></svg>`;
              return el;
            },
          }),
          drawSelection({ cursorBlinkRate: 1500 }), dropCursor(), EditorState.allowMultipleSelections.of(true),
          indentOnInput(), bracketMatching(), autocompletion(),
          rectangularSelection(), crosshairCursor(), highlightActiveLine(),
          syntaxHighlighting(codeHighlight), codeTheme,
          // 偏好驱动：行号 / 自动配对+缩进 / 只读
          lineNoComp.current.of(initUi.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
          pairComp.current.of(pairExtensions(initUi.prefs)),
          readonlyComp.current.of(EditorState.readOnly.of(initUi.readonlyMode)),
          // 搜索统一走应用内 FindInFile（顶部悬浮）：不含 searchKeymap，避免 CM6 底部搜索面板重复
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
          langComp.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applyingExternal.current) useWorkspace.getState().setContent(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            copy: (e, view) => {
              const ui = useUi.getState();
              if (ui.prefs.copyCutWholeLine === false) return false;
              const sel = view.state.selection.main;
              if (!sel.empty) return false;
              const line = view.state.doc.lineAt(sel.head);
              const text = line.text + "\n";
              e.clipboardData?.setData("text/plain", text);
              e.preventDefault();
              return true;
            },
            cut: (e, view) => {
              const ui = useUi.getState();
              if (ui.prefs.copyCutWholeLine === false) return false;
              if (view.state.readOnly) return false;
              const sel = view.state.selection.main;
              if (!sel.empty) return false;
              const line = view.state.doc.lineAt(sel.head);
              const text = line.text + "\n";
              e.clipboardData?.setData("text/plain", text);
              const from = line.from;
              const to = Math.min(view.state.doc.length, line.to + 1);
              view.dispatch({ changes: { from, to, insert: "" } });
              e.preventDefault();
              return true;
            },
            scroll: (_e, view) => {
              const vpTo = view.viewport.to;
              if (!syntaxTreeAvailable(view.state, vpTo)) {
                const target = Math.min(view.state.doc.length, vpTo + 30000);
                const tree = ensureSyntaxTree(view.state, target, 50);
                if (tree) view.dispatch({});
              }
              return false;
            },
            keydown: (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                useWorkspace.getState().save().then((ok) => ok && useUi.getState().toast("已保存", "success"));
                return true;
              }
              return false;
            },
            click: (e, view) => {
              if (!(e.ctrlKey || e.metaKey)) return false;
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return false;
              const line = view.state.doc.lineAt(pos);
              const off = pos - line.from;
              const re = /\[[^\]]*\]\(([^)\s]+)[^)]*\)|<([^>\s]+)>|(\bhttps?:\/\/[^\s)]+)/g;
              let m: RegExpExecArray | null;
              let href: string | null = null;
              while ((m = re.exec(line.text))) {
                if (off >= m.index && off <= m.index + m[0].length) {
                  href = m[1] ?? m[2] ?? m[3];
                  break;
                }
              }
              if (!href) return false;
              e.preventDefault();
              void openLinkTarget(href);
              return true;
            },
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    setActiveEditor({ kind: "cm6", view });
    applyToCm(view);
    lastPath.current = ws.activePath;
    loadLanguage(ws.activePath ?? "").then((lang) => {
      if (viewRef.current === view) {
        view.dispatch({ effects: langComp.current.reconfigure(lang ?? []) });
        warmupSyntax(view);
      }
    });
    refreshFind();
    return () => {
      captureFromCm(view);
      viewRef.current = null;
      setActiveEditor(null);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 偏好热更新：行号 / 自动配对+缩进 / 只读（Compartment 重配置，保留撤销历史与光标） */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineNoComp.current.reconfigure(lineNumbersOn ? [lineNumbers(), highlightActiveLineGutter()] : []),
    });
  }, [lineNumbersOn]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: pairComp.current.reconfigure(pairExtensions(useUi.getState().prefs)),
    });
  }, [autoPairOn, indentSize]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readonlyComp.current.reconfigure(EditorState.readOnly.of(readonlyMode)),
    });
  }, [readonlyMode]);

  /* 文件切换 / 外部变更 → 同步文档 + 重新加载语言 + 预热高亮 */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const pathChanged = activePath !== lastPath.current;
    const reloadTriggered = reloadToken !== lastReloadToken.current;
    lastReloadToken.current = reloadToken;

    if (pathChanged || reloadTriggered || view.state.doc.toString() !== content) {
      applyingExternal.current = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, ...(pathChanged ? { selection: { anchor: 0 } } : {}) });
      applyingExternal.current = false;
      lastPath.current = activePath;
      if (pathChanged) {
        loadLanguage(activePath ?? "").then((lang) => {
          if (viewRef.current === view) {
            view.dispatch({ effects: langComp.current.reconfigure(lang ?? []) });
            warmupSyntax(view);
          }
        });
      } else {
        warmupSyntax(view);
      }
    }
  }, [activePath, content, reloadToken]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    host.style.setProperty("--am-editor-size", `${fontSize}px`);
    host.style.setProperty("--am-editor-width", EDITOR_WIDTHS[editorWidth]);
  }, [fontSize, editorWidth]);

  // Markdown 源码模式保留粘贴/拖拽图片插入；代码文件不启用
  useEffect(() => {
    if (!containerRef.current || !isMarkdownFile(activePath ?? "")) return;
    return attachImageHandlers(containerRef.current);
  }, [activePath]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="am-no-print flex items-center gap-2 border-b border-line bg-panel px-4 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">{languageLabel(activePath ?? "")}</span>
        <span className="text-[11px] text-ink-muted">
          {isMarkdownFile(activePath ?? "") ? t("源码模式 · 语法高亮 · ⌘S 保存") : t("代码编辑模式 · 语法高亮 · ⌘S 保存")}
        </span>
      </div>
      {/* Markdown 源码模式跟随「编辑区宽度」偏好；代码文件保持靠左全宽 */}
      <div
        ref={containerRef}
        className={`am-editor-host min-h-0 flex-1 bg-editor ${isMarkdownFile(activePath ?? "") ? "" : "am-code-left"}`}
        data-testid="code-host"
      />
    </div>
  );
}