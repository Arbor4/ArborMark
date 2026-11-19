import { useEffect, useRef } from "react";
import { Compartment, EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, lineNumbers, type DecorationSet } from "@codemirror/view";
import { useWorkspace } from "@/stores/workspace";
import { useUi, EDITOR_WIDTHS } from "@/stores/ui";
import { markdownExtensions, jumpToLine, wysiwygComp, hybridField, highlightComp, markdownHighlightExt } from "./markdown";
import { invalidateMermaidCache } from "./widgets";
import { setActiveEditor, getCm6 } from "./activeEditor";
import { captureFromCm, applyToCm } from "./editorViewSync";
import { attachImageHandlers } from "./imageInsert";
import { openLinkTarget } from "./openLink";
import { slugify } from "./milkdownAnchors";
import { fs } from "@/bridge/fs";
import { isTauri } from "@/bridge/ipc";
import { refreshFind } from "./findSync";
import { subscribeThemes } from "@/theme/registry";
import { FileText, FolderOpen, Feather } from "lucide-react";
import { useLang } from "@/bridge/i18n";

/** 模块级视图引用：大纲 / 搜索导航直接操作编辑器，不经过 React 渲染循环。
 *  源码/代码模式统一由 CodeEditor 承载，未挂载 EditorHost 时回退到活跃 CM6 视图。 */
let activeView: EditorView | null = null;
export function getEditorView(): EditorView | null {
  return activeView ?? getCm6();
}
export function editorJumpTo(line: number, column = 0) {
  const v = activeView ?? getCm6();
  if (v) jumpToLine(v, line, column);
}

/** 专注模式：当前段落保持清晰，其余淡化（行装饰）。 */
function focusExtension(enabled: boolean) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(_value, tr) {
      if (!enabled) return Decoration.none;
      const doc = tr.state.doc;
      const cursor = tr.state.selection.main;
      let start = doc.lineAt(cursor.from).number;
      let end = doc.lineAt(cursor.to).number;
      while (start > 1 && doc.line(start - 1).text.trim() !== "") start--;
      while (end < doc.lines && doc.line(end + 1).text.trim() !== "") end++;
      const builder = new RangeSetBuilder<Decoration>();
      for (let l = start; l <= end; l++) {
        const info = doc.line(l);
        builder.add(info.from, info.from, Decoration.line({ class: "am-active-block" }));
      }
      return builder.finish();
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

export function EditorHost({ wysiwyg = true }: { wysiwyg?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingExternal = useRef(false);
  const lineNumbersComp = useRef(new Compartment());
  const focusComp = useRef(new Compartment());
  const readonlyComp = useRef(new Compartment());
  const lastPath = useRef<string | null>(null);

  const activePath = useWorkspace((s) => s.activePath);
  const content = useWorkspace((s) => s.content);
  const focusMode = useUi((s) => s.focusMode);
  const typewriterMode = useUi((s) => s.typewriterMode);
  const lineNumbersOn = useUi((s) => s.lineNumbers);
  const fontSize = useUi((s) => s.fontSize);
  const editorWidth = useUi((s) => s.editorWidth);
  const { t } = useLang();

  const makeExtensions = () => {
    const ui = useUi.getState();
    return [
      markdownExtensions({
        lineNumbers: ui.lineNumbers,
        onChange: (text) => {
          if (applyingExternal.current) return;
          useWorkspace.getState().setContent(text);
        },
        onSave: () => {
          useWorkspace.getState().save().then((ok) => {
            if (ok) useUi.getState().toast("已保存", "success");
          });
        },
      }),
      lineNumbersComp.current.of(ui.lineNumbers ? lineNumbers() : []),
      focusComp.current.of(focusExtension(ui.focusMode)),
      readonlyComp.current.of(EditorState.readOnly.of(ui.readonlyMode || (useWorkspace.getState().activePath ?? "").startsWith("help://"))),
      EditorView.domEventHandlers({
        click: (e, view) => {
          if (!(e.ctrlKey || e.metaKey)) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          const off = pos - line.from;
          const re = /\[[^\]]*\]\(([^)\s]+)[^)]*\)|<(https?:[^>]+)>/g;
          let m: RegExpExecArray | null;
          let href: string | null = null;
          while ((m = re.exec(line.text))) {
            if (off >= m.index && off <= m.index + m[0].length) { href = m[1] ?? m[2]; break; }
          }
          if (!href) return false;
          e.preventDefault();
          void openLinkTarget(href);
          return true;
        },
      }),
    ];
  };

  /* 挂载编辑器（只创建一次；配置变化走 compartment，保留撤销历史） */
  useEffect(() => {
    if (!containerRef.current) return;
    const ws = useWorkspace.getState();
    const view = new EditorView({
      state: EditorState.create({ doc: ws.content, extensions: makeExtensions() }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    activeView = view;
    setActiveEditor({ kind: "cm6", view });
    lastPath.current = ws.activePath;
    // 视图切换：恢复编辑态光标对应的行/列
    applyToCm(view);
    refreshFind();
    return () => {
      captureFromCm(view);
      activeView = null;
      viewRef.current = null;
      setActiveEditor(null);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 文件切换 / 外部内容变更 → 同步文档 */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const pathChanged = activePath !== lastPath.current;
    const currentDoc = view.state.doc.toString();
    if (pathChanged || currentDoc !== content) {
      applyingExternal.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        ...(pathChanged ? { selection: { anchor: 0 } } : {}),
      });
      applyingExternal.current = false;
      lastPath.current = activePath;
      if (pathChanged) {
        view.dispatch({ effects: EditorView.scrollIntoView(0) });
        view.focus();
      }
    }
  }, [activePath, content]);

  /* 行号开关 */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineNumbersComp.current.reconfigure(lineNumbersOn ? lineNumbers() : []),
    });
  }, [lineNumbersOn]);

  /* WYSIWYG 即时渲染开关（编辑态启用，源码态关闭并去除语法高亮 → 纯文本） */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        wysiwygComp.reconfigure(wysiwyg ? hybridField : []),
        highlightComp.reconfigure(wysiwyg ? markdownHighlightExt : []),
      ],
    });
  }, [wysiwyg]);

  /* 只读模式（含内置帮助文档） */
  const readonlyMode = useUi((s) => s.readonlyMode);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readonlyComp.current.reconfigure(EditorState.readOnly.of(readonlyMode || (activePath ?? "").startsWith("help://"))),
    });
  }, [readonlyMode, activePath]);

  /* 主题切换：清空图表缓存并以新配色重建渲染块 */
  useEffect(() => {
    return subscribeThemes(() => {
      invalidateMermaidCache();
      const v = viewRef.current;
      if (v) v.dispatch({ selection: { anchor: v.state.selection.main.anchor } });
    });
  }, []);

  /* 专注模式 */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: focusComp.current.reconfigure(focusExtension(focusMode)),
    });
  }, [focusMode]);

  /* 字体大小 / 编辑区宽度 → CSS 变量 */
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    host.style.setProperty("--am-editor-size", `${fontSize}px`);
    host.style.setProperty("--am-editor-width", EDITOR_WIDTHS[editorWidth]);
  }, [fontSize, editorWidth]);

  /* 粘贴 / 拖拽图片 */
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    return attachImageHandlers(host);
  }, []);

  return (
    <div className="absolute inset-0">
      {/* 宿主容器始终挂载：空态只是覆盖层，避免文件打开后 CM6 视图无处创建。
          绝对定位填充父级（relative + 有界高度），保证 CM6 滚动容器高度有界。 */}
      <div
        ref={containerRef}
        className={`am-editor-host h-full bg-editor ${focusMode ? "am-focus-mode" : ""} ${typewriterMode ? "am-typewriter" : ""}`}
        data-testid="editor-host"
      />
      {!activePath && !content && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-editor px-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Feather size={30} strokeWidth={1.6} />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold text-ink">{t("开始写作")}</h2>
            <p className="mt-1.5 max-w-[340px] text-[12.5px] leading-relaxed text-ink-muted">
              {t("从左侧选择一个文件，或新建一个 Markdown 文档。支持拖拽整理、全局搜索与可定制主题。")}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const ws = useWorkspace.getState();
                if (ws.rootPath) {
                  ws.createFile(ws.rootPath);
                  return;
                }
                const r = await fs.openFolderDialog();
                if (!r.canceled && r.filePaths[0]) {
                  await ws.openFolder(r.filePaths[0]);
                  ws.createFile(r.filePaths[0]);
                }
              }}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              <FileText size={14} /> {t("新建文档")}
            </button>
            <button
              onClick={() => {
                fs.openFolderDialog().then((r) => {
                  if (!r.canceled && r.filePaths[0]) useWorkspace.getState().openFolder(r.filePaths[0]);
                });
              }}
              className="flex items-center gap-1.5 rounded-md border border-line bg-elevated px-3.5 py-2 text-[12.5px] font-medium text-ink-secondary transition-colors hover:bg-hover"
            >
              <FolderOpen size={14} /> {t("打开文件夹")}
            </button>
          </div>
          <p className="mt-4 text-[11px] text-ink-muted">
            {t("⌘N 新建 · ⌘P 快速打开 · ⌘⇧F 全局搜索 · ⌘/ 切换视图")}
          </p>
        </div>
      )}
    </div>
  );
}