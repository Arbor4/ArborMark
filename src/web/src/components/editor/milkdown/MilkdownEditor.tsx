/**
 * Milkdown WYSIWYG 编辑器（编辑态）。
 * 基于 ProseMirror，实现「在渲染结果上直接编辑」：
 * 表格原位增删行列、代码块原位高亮编辑、公式原位编辑、Mermaid 图表、嵌套引用、
 * HTML/Front Matter/高亮/上下标/Emoji/GitHub 提示块/[TOC]。
 * 源码态仍由 CodeMirror 承担（见 EditorHost）。
 *
 * 语法扩展开关（偏好设置）变更时，由 EditorArea 通过 key 重挂载本组件生效。
 */
import { useEffect, useRef } from "react";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { commonmark, remarkPreserveEmptyLinePlugin } from "@milkdown/preset-commonmark";
import { gfm, remarkGFMPlugin } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history } from "@milkdown/plugin-history";
import { clipboard } from "@milkdown/plugin-clipboard";
import { cursor } from "@milkdown/plugin-cursor";
import { math, katexOptionsCtx, remarkMathPlugin } from "@milkdown/plugin-math";
import { diagram, mermaidConfigCtx } from "@milkdown/plugin-diagram";
import { nord } from "@milkdown/theme-nord";
import { replaceAll, $prose } from "@milkdown/utils";
import { Plugin, TextSelection } from "@milkdown/prose/state";
import { mermaidNodeView } from "./milkdownDiagrams";
import { flowSequencePlugins } from "./milkdownFlowSequence";
import { tocPlugin } from "./milkdownToc";
import { emojiPlugin } from "./milkdownEmoji";
import { buildSyntaxPlugins, syntaxStringifyHandlers, normalizeMarkdown, eastAsianWidth, type BulletMarker } from "./milkdownSyntax";
import { blankLinesRemark, joinEmptyParagraph, docPreserveTrailing } from "./milkdownBlankLines";
import { htmlPlugins, detailsPlugins, emptyDocNormalize, htmlRemark } from "./milkdownHtml";
import { mathViews } from "./milkdownMath";
import { codeBlockNodeView, codeHighlightPlugin, codeBlockEscapePlugin, placeBlockCaret } from "./milkdownCodeBlock";
import { imageView } from "./milkdownImage";
import { anchorPlugin } from "./milkdownAnchors";
import { flashPlugin } from "./milkdownFlash";
import { findPlugin, refreshFind } from "../findSync";
import { pasteCaretPlugin } from "./milkdownPaste";
import { captureFromMilkdown, applyToMilkdown } from "../editorViewSync";
import { attachImageHandlers } from "../imageInsert";
import { tableNodeView } from "./milkdownTable";
import { taskListNodeView } from "./milkdownTaskList";
import { useWorkspace } from "@/stores/workspace";
import { useUi, EDITOR_WIDTHS } from "@/stores/ui";
import { t } from "@/bridge/i18n";
import { setActiveEditor, onUserEdit } from "../activeEditor";
import "@milkdown/theme-nord/style.css";
import "katex/dist/katex.min.css";

/** 语法扩展签名：变更时触发编辑器重挂载。 */
export function syntaxSignature(prefs: Record<string, boolean | string | number>): string {
  const keys = ["enableHighlight", "enableSuperscript", "enableSubscript", "enableAlert", "enableDiagram", "enableEmoji", "blockHTML", "enableInlineMath", "enableCodeBlockMath", "preserveLineBreak", "unorderedListMarker"];
  return keys.map((k) => `${k}=${prefs[k] ?? "def"}`).join("|");
}

/**
 * 右键选区保护：macOS WKWebView 两指轻点 / 右键在空行上触发 contextmenu 时，
 * 系统会在 mousedown 阶段自动扩展选区覆盖空行及下一行首。
 * 当右击位置不在已有非空选区内时，阻止默认选区扩展并将光标折叠到点击处。
 */
const rightClickGuardPlugin = $prose(() => {
  let collapseNextContextMenu = false;
  let lastClickCoords: { left: number; top: number } | null = null;
  let lastClickAt = 0;

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          const isContextClick = event.button === 2 || (event.button === 0 && event.ctrlKey);
          if (!isContextClick) {
            collapseNextContextMenu = false;
            return false;
          }
          const coords = { left: event.clientX, top: event.clientY };
          const hit = view.posAtCoords(coords);
          const { selection, doc } = view.state;
          const insideExisting =
            !selection.empty && hit != null && hit.pos >= selection.from && hit.pos <= selection.to;
          collapseNextContextMenu = !insideExisting;
          lastClickCoords = coords;
          lastClickAt = Date.now();
          event.preventDefault();
          if (!insideExisting && hit != null) {
            const tr = view.state.tr.setSelection(TextSelection.near(doc.resolve(hit.pos)));
            view.dispatch(tr.setMeta("addToHistory", false));
          }
          view.focus();
          return false;
        },
        contextmenu: (view, event) => {
          if (!collapseNextContextMenu || Date.now() - lastClickAt > 1000) return false;
          collapseNextContextMenu = false;
          const { selection, doc } = view.state;
          const domSel = document.getSelection();
          if (!selection.empty || (domSel && !domSel.isCollapsed && view.dom.contains(domSel.anchorNode))) {
            const coords = lastClickCoords ?? { left: event.clientX, top: event.clientY };
            const hit = view.posAtCoords(coords);
            const target = hit ? hit.pos : selection.from;
            const tr = view.state.tr.setSelection(TextSelection.near(doc.resolve(target)));
            view.dispatch(tr.setMeta("addToHistory", false));
            view.focus();
          }
          return false;
        },
      },
    },
  });
});

/**
 * 编辑态偏好行为插件：
 * - 智能引号 / 智能破折号（输入时转换，跳过代码块与行内代码）；
 * - 成对符号自动补全（括号、引号与 Markdown 行内符号）；
 * - copyMarkdownByDefault（复制选区时默认写入 Markdown 源码）；
 * - copyCutWholeLine（无选区时复制或剪切当前段落/块）。
 */
const editorBehaviorPlugin = $prose((ctx) => {
  const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "`": "`" };
  return new Plugin({
    props: {
      handleTextInput: (view, from, to, text) => {
        if (from !== to || text.length !== 1) return false;
        const { state } = view;
        const $from = state.doc.resolve(from);
        const parentName = $from.parent.type.name;
        if (parentName === "code_block" || parentName === "frontmatter") return false;
        const inInlineCode = $from.marks().some((m) => m.type.name === "inlineCode");
        if (inInlineCode) return false;

        const prefs = useUi.getState().prefs;
        const timing = String(prefs.smartyPantsTiming ?? "input");

        // 智能破折号：-- → —
        if (timing !== "render" && prefs.smartDashes !== false && text === "-" && $from.parentOffset > 0) {
          const prevChar = state.doc.textBetween(from - 1, from);
          if (prevChar === "-") {
            view.dispatch(state.tr.insertText("—", from - 1, to));
            return true;
          }
        }

        // 智能引号：" / ' → “ ” / ‘ ’
        if (timing !== "render" && prefs.smartQuotes !== false && (text === '"' || text === "'")) {
          const prevChar = $from.parentOffset > 0 ? state.doc.textBetween(from - 1, from) : "";
          const isOpen = !prevChar || /[\s(\[{—\u2014]/.test(prevChar);
          const ch = text === '"' ? (isOpen ? "“" : "”") : (isOpen ? "‘" : "’");
          view.dispatch(state.tr.insertText(ch, from, to));
          return true;
        }

        // 成对符号补全
        const closer = PAIRS[text];
        if (closer) {
          if (text === "`") {
            if (prefs.autoPairMarkdown === false) return false;
            // 行首连敲 ``` 时不干预代码块输入规则
            const lineBefore = $from.parent.textContent.slice(0, $from.parentOffset);
            if (/^`*$/.test(lineBefore)) return false;
          } else if (prefs.autoPair === false) {
            return false;
          }
          const tr = state.tr.insertText(text + closer, from, to);
          tr.setSelection(TextSelection.create(tr.doc, from + 1));
          view.dispatch(tr);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        copy: (view, event) => {
          const prefs = useUi.getState().prefs;
          const { selection, doc, schema } = view.state;
          if (selection.empty) {
            if (prefs.copyCutWholeLine === false) return false;
            const { $from } = selection;
            if (!$from.parent.isTextblock) return false;
            const text = $from.parent.textContent + "\n";
            event.clipboardData?.setData("text/plain", text);
            event.preventDefault();
            return true;
          }
          if (prefs.copyMarkdownByDefault === true) {
            const slice = doc.slice(selection.from, selection.to);
            const wrapped = schema.topNodeType.createAndFill(null, slice.content) ?? schema.topNodeType.create(null, slice.content);
            const md = ctx.get(serializerCtx)(wrapped);
            event.clipboardData?.setData("text/plain", md);
            event.preventDefault();
            return true;
          }
          return false;
        },
        cut: (view, event) => {
          const prefs = useUi.getState().prefs;
          if (prefs.copyCutWholeLine === false) return false;
          if (!view.editable) return false;
          const { selection, doc, schema } = view.state;
          if (!selection.empty) return false;
          const { $from } = selection;
          if (!$from.parent.isTextblock || $from.depth < 1) return false;
          const text = $from.parent.textContent + "\n";
          event.clipboardData?.setData("text/plain", text);
          const pos = $from.before($from.depth);
          const end = pos + $from.parent.nodeSize;
          const tr = view.state.tr.delete(pos, end);
          if (tr.doc.content.size === 0) tr.insert(0, schema.nodes.paragraph.create());
          const caret = Math.min(pos, tr.doc.content.size);
          view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(caret), 1)));
          event.preventDefault();
          return true;
        },
      },
    },
  });
});

export function MilkdownEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const loadingRef = useRef(true);
  const userInteractedRef = useRef(false);
  const lastPath = useRef<string | null>(null);
  const readyRef = useRef(false);
  const reloadToken = useWorkspace((s) => s.reloadToken);
  const lastReloadToken = useRef(reloadToken);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);

  // 立即将挂起的 Markdown 序列化写入全局 Workspace，保证保存、失焦、切换时零数据丢失
  const currentBullet = (): BulletMarker => {
    const m = String(useUi.getState().prefs.unorderedListMarker ?? "-");
    return m === "*" || m === "+" ? m : "-";
  };
  const flushPendingSync = () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (pendingMarkdownRef.current !== null) {
      const raw = pendingMarkdownRef.current;
      pendingMarkdownRef.current = null;
      const normalized = normalizeMarkdown(raw, currentBullet());
      useWorkspace.getState().setContent(normalized);
      updateEmptyHint();
    }
  };

  const activePath = useWorkspace((s) => s.activePath);
  const content = useWorkspace((s) => s.content);
  const readonlyMode = useUi((s) => s.readonlyMode);
  const focusMode = useUi((s) => s.focusMode);
  const typewriterMode = useUi((s) => s.typewriterMode);
  const fontSize = useUi((s) => s.fontSize);
  const editorWidth = useUi((s) => s.editorWidth);
  const indentFirstLine = useUi((s) => s.prefs.indentFirstLine);
  const lineWrapping = useUi((s) => s.prefs.lineWrapping);
  const spellcheck = useUi((s) => s.prefs.spellcheck);
  const showLineNumbersForFence = useUi((s) => s.prefs.showLineNumbersForFence === true);
  const codeBlockWrap = useUi((s) => s.prefs.codeBlockWrap === true);
  const autoNumberingMode = useUi((s) => {
    const mode = String(s.prefs.autoNumberingMode ?? "");
    if (mode === "all" || mode === "ams" || mode === "none") return mode;
    return s.prefs.autoNumberingForMath === true ? "all" : "none";
  });

  // 空文档占位提示：仅单个空段落且可编辑时显示
  const updateEmptyHint = () => {
    const host = containerRef.current;
    const ed = editorRef.current;
    if (!host || !ed) return;
    ed.action((c) => {
      const doc = c.get(editorViewCtx).state.doc;
      const first = doc.firstChild;
      const empty =
        doc.childCount === 1 && !!first && first.type.name === "paragraph" && first.content.size === 0;
      const locked = useUi.getState().readonlyMode || (useWorkspace.getState().activePath ?? "").startsWith("help://");
      host.dataset.empty = empty && !locked ? "true" : "false";
      host.style.setProperty("--am-empty-hint", `"${t("editor.emptyHint")}"`);
    });
  };

  /* 创建编辑器（只一次；语法开关变更经 key 重挂载） */
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    const ws = useWorkspace.getState();
    const prefs = useUi.getState().prefs;
    const enabled = (k: string, def = true) => {
      const v = prefs[k];
      return v === undefined ? def : v !== false && v !== "false";
    };

    let editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, containerRef.current!);
        ctx.set(defaultValueCtx, ws.content || "");
        // KaTeX 容错：非法公式渲染为错误文本而非抛异常崩溃。
        ctx.set(katexOptionsCtx.key, {
          throwOnError: false,
          strict: false,
          trust: false,
          output: "html",
        });
        ctx.set(mermaidConfigCtx.key, {
          startOnLoad: false,
          securityLevel: "loose",
          theme: "default",
        });
        // GFM 序列化规范（严格对齐 Typora / VS Code / Obsidian）：
        // 1. 关闭 singleTilde（把 ~ 留给下标）
        // 2. 表格管道对齐（tablePipeAlign）
        // 3. 单元格两侧空格补白（tableCellPadding）
        // 4. CJK 东亚宽字符感知（中英混排下管道线 | 完美垂直对齐）
        ctx.set(remarkGFMPlugin.options.key, {
          singleTilde: false,
          tableCellPadding: true,
          tablePipeAlign: true,
          stringLength: eastAsianWidth,
        });
        // 内联公式 $...$ 开关（块级 $$ 始终支持）。
        ctx.set(remarkMathPlugin.options.key as never, { singleDollarTextMath: enabled("enableInlineMath") });
        // 合并自定义 stringify handler（高亮/上下标/YAML/提示块回写源码）。
        // join：空段落回写为纯空行（每个空段落一个额外空行），与解析侧空行还原构成不动点。
        const opts = ctx.get(remarkStringifyOptionsCtx) as {
          handlers?: Record<string, unknown>;
          encode?: unknown[];
          join?: unknown[];
          bullet?: string;
          bulletOther?: string;
          bulletOrdered?: string;
          rule?: string;
          ruleRepetition?: number;
          ruleSpaces?: boolean;
          emphasis?: string;
          strong?: string;
          fence?: string;
          fences?: boolean;
          listItemIndent?: string;
          incrementListMarker?: boolean;
        };
        const bullet = currentBullet();
        ctx.set(remarkStringifyOptionsCtx, {
          ...opts,
          // 统一遵循主流 Markdown（CommonMark / GFM / Typora）标准：
          bullet,
          bulletOther: bullet === "*" ? "-" : "*",
          bulletOrdered: ".",
          rule: "-",
          ruleRepetition: 3,
          ruleSpaces: false,
          emphasis: "*",
          strong: "*",
          fence: "`",
          fences: true,
          listItemIndent: "one",
          incrementListMarker: true,
          join: [joinEmptyParagraph, ...(opts.join ?? [])] as never,
          handlers: { ...(opts.handlers ?? {}), ...syntaxStringifyHandlers },
        });
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          // 加载期或用户尚未产生实际编辑交互时：规范化序列化仅回写为基线（绝不标 dirty，绝不触发自动保存）；
          // 仅在就绪且用户发生了真实输入或编辑交互后，才进入 setContent 标记 dirty。
          if (loadingRef.current || !userInteractedRef.current) {
            const normalized = normalizeMarkdown(markdown, bullet);
            useWorkspace.getState().setBaseline(normalized);
            updateEmptyHint();
            return;
          }

          // 核心性能优化：用户打字阶段实施 180ms 微防抖，解绑击键同步全量序列化/正则与下游全局订阅重算
          pendingMarkdownRef.current = markdown;
          if (isComposingRef.current) {
            // IME 输入法选字拼音未上屏期间暂缓提交，待 compositionend 结算
            return;
          }
          if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
          syncTimerRef.current = setTimeout(() => {
            syncTimerRef.current = null;
            if (pendingMarkdownRef.current !== null) {
              const raw = pendingMarkdownRef.current;
              pendingMarkdownRef.current = null;
              const normalized = normalizeMarkdown(raw, bullet);
              useWorkspace.getState().setContent(normalized);
              updateEmptyHint();
            }
          }, 180);
        });
      })
      .config(nord);

    // details 合并插件须在 commonmark 之前注册，避免块级 HTML 被流水线转为段落
    // htmlRemark  likewise 先注册：块级 HTML 保持 html_block 原子（居中/间距由块级 CSS 控制）
    if (enabled("blockHTML")) editor = editor.use(detailsPlugins).use(htmlRemark);
    // 空行保留插件先于 commonmark：旧版 <br /> 占位先迁移为空段落
    editor = editor.use(blankLinesRemark);
    const skipPreserveBr = new Set<unknown>([remarkPreserveEmptyLinePlugin.options, remarkPreserveEmptyLinePlugin.plugin]);

    editor = editor
      // 去掉 preset 的 <br /> 空行占位插件，空段落以纯空行回写源码
      .use(commonmark.filter((p) => !skipPreserveBr.has(p)))
      // 覆盖 preset doc 的末尾空段落裁剪，保证空行往返不丢
      .use(docPreserveTrailing)
      .use(gfm)
      .use(listener)
      .use(history)
      .use(clipboard)
      .use(pasteCaretPlugin)
      .use(rightClickGuardPlugin)
      .use(editorBehaviorPlugin)
      .use(cursor)
      .use(math)
      .use(buildSyntaxPlugins(prefs))
      .use(codeBlockNodeView)
      .use(codeHighlightPlugin)
      .use(codeBlockEscapePlugin)
      .use(imageView)
      .use(anchorPlugin)
      .use(flashPlugin)
      .use(findPlugin)
      .use(tableNodeView)
      .use(taskListNodeView)
      .use(mathViews)
      .use(tocPlugin)
      .use(emptyDocNormalize);

    if (enabled("enableDiagram")) editor = editor.use(diagram).use(mermaidNodeView).use(flowSequencePlugins);
    if (enabled("enableEmoji")) editor = editor.use(emojiPlugin);
    if (enabled("blockHTML")) editor = editor.use(htmlPlugins);

    editor
      .create()
      .then((ed) => {
        if (destroyed) {
          ed.destroy();
          return;
        }
        editorRef.current = ed;
        readyRef.current = true;
        lastPath.current = useWorkspace.getState().activePath;
        setActiveEditor({ kind: "milkdown", editor: ed });
        // 视图切换：恢复源码态光标对应的块/行位置
        applyToMilkdown(ed, useWorkspace.getState().content);
        refreshFind();
        ed.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dom.setAttribute("aria-label", "Markdown 编辑区");
          view.dom.classList.add("am-milkdown-view");
          // 初始空文档可能默认填充为空 HTML 原子（渲染「（空 HTML）」占位）；归一为空 paragraph
          const doc = view.state.doc;
          const first = doc.firstChild;
          const blankHtml =
            first &&
            (first.type.name === "html_details" || first.type.name === "html_block") &&
            !String(first.attrs.value ?? "").trim();
          if (doc.childCount === 0) {
            view.dispatch(view.state.tr.insert(0, view.state.schema.nodes.paragraph.create()));
          } else if (doc.childCount === 1 && blankHtml) {
            view.dispatch(view.state.tr.replaceWith(0, doc.content.size, view.state.schema.nodes.paragraph.create()));
          }
        });
        // 初始加载窗口：规范化序列化回写为基线，窗口结束后用户编辑才标 dirty。
        // 显式回写一次：listener 仅在 doc 变更事务触发，纯加载可能不触发，
        // 旧版 <br /> 占位等需立即规范化为纯空行基线。
        ed.action((ctx) => {
          const md = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc);
          useWorkspace.getState().setBaseline(normalizeMarkdown(md, currentBullet()));
        });
        updateEmptyHint();
        setTimeout(() => {
          loadingRef.current = false;
        }, 300);
      })
      .catch((err) => {
        console.error("[milkdown] 创建失败", err);
      });

    return () => {
      flushPendingSync();
      destroyed = true;
      readyRef.current = false;
      captureFromMilkdown(editorRef.current);
      setActiveEditor(null);
      editorRef.current?.destroy().catch(() => {});
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 监听用户真实编辑事件（工具栏操作、复选框点击、键盘输入、粘贴、剪切、拖放、IME 拼音等） */
  useEffect(() => {
    const un = onUserEdit(() => {
      if (!loadingRef.current) userInteractedRef.current = true;
    });

    const el = containerRef.current;
    if (!el) return un;

    const handleInput = () => {
      if (!loadingRef.current) userInteractedRef.current = true;
    };
    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };
    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      if (!loadingRef.current) userInteractedRef.current = true;
      if (pendingMarkdownRef.current !== null) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
          syncTimerRef.current = null;
          flushPendingSync();
        }, 180);
      }
    };
    const handleBlur = () => {
      flushPendingSync();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        // 保存快捷键按下时，瞬间冲刷挂起微防抖内容，确保保存落盘包含最新所有击键
        flushPendingSync();
        return;
      }
      const ignore = [
        "Control", "Shift", "Alt", "Meta", "CapsLock", "Escape",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "PageUp", "PageDown", "Home", "End",
      ];
      if (ignore.includes(e.key)) return;
      if ((e.metaKey || e.ctrlKey) && ["c", "a"].includes(e.key.toLowerCase())) return;
      if (!loadingRef.current) userInteractedRef.current = true;
    };

    el.addEventListener("input", handleInput, true);
    el.addEventListener("beforeinput", handleInput, true);
    el.addEventListener("compositionstart", handleCompositionStart, true);
    el.addEventListener("compositionend", handleCompositionEnd, true);
    el.addEventListener("blur", handleBlur, true);
    el.addEventListener("paste", handleInput, true);
    el.addEventListener("cut", handleInput, true);
    el.addEventListener("drop", handleInput, true);
    el.addEventListener("keydown", handleKeyDown, true);

    return () => {
      un();
      el.removeEventListener("input", handleInput, true);
      el.removeEventListener("beforeinput", handleInput, true);
      el.removeEventListener("compositionstart", handleCompositionStart, true);
      el.removeEventListener("compositionend", handleCompositionEnd, true);
      el.removeEventListener("blur", handleBlur, true);
      el.removeEventListener("paste", handleInput, true);
      el.removeEventListener("cut", handleInput, true);
      el.removeEventListener("drop", handleInput, true);
      el.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  /* 文件切换 / 外部重载（从磁盘重载、外部修改感知） → 重置文档并建立新基线 */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;

    const pathChanged = activePath !== lastPath.current;
    const reloadTriggered = reloadToken !== lastReloadToken.current;

    if (!pathChanged && !reloadTriggered) return;

    lastPath.current = activePath;
    lastReloadToken.current = reloadToken;

    // 1. 丢弃任何未入库的微防抖挂起更新，防止冲掉新从磁盘加载的内容
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    pendingMarkdownRef.current = null;

    // 2. 外部重载时尽量保持滚动位置；切换文件时重置回顶部
    const scroller = containerRef.current?.parentElement;
    const prevScrollTop = reloadTriggered && !pathChanged ? scroller?.scrollTop : 0;

    // 3. 置位 loading 与交互标记，避免 replaceAll 触发 listener 被误当成用户打字
    loadingRef.current = true;
    userInteractedRef.current = false;

    // 4. 全量替换 ProseMirror 文档为目标内容
    editor.action(replaceAll(content || ""));
    editor.action((ctx) => {
      const md = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc);
      useWorkspace.getState().setBaseline(normalizeMarkdown(md, currentBullet()));
    });
    updateEmptyHint();

    if (reloadTriggered && !pathChanged && scroller && prevScrollTop != null && prevScrollTop > 0) {
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = prevScrollTop;
      });
    }

    const timer = setTimeout(() => {
      loadingRef.current = false;
    }, 300);
    return () => clearTimeout(timer);
  }, [activePath, content, reloadToken]);

  /* 只读模式（含内置帮助文档） */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const locked = readonlyMode || (activePath ?? "").startsWith("help://");
      view.dom.setAttribute("contenteditable", locked ? "false" : "true");
    });
    updateEmptyHint();
  }, [readonlyMode, activePath]);

  /* 拼写检查 */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;
    editor.action((ctx) => {
      ctx.get(editorViewCtx).dom.setAttribute("spellcheck", spellcheck ? "true" : "false");
    });
  }, [spellcheck]);

  /* 打字机模式：光标所在行始终保持在视口垂直居中 */
  useEffect(() => {
    if (!typewriterMode) return;
    const host = containerRef.current;
    const scroller = host?.parentElement;
    if (!host || !scroller) return;
    const centerCaret = () => {
      if (loadingRef.current) return;
      const ed = editorRef.current;
      if (!ed) return;
      ed.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view.hasFocus()) return;
        const coords = view.coordsAtPos(view.state.selection.head);
        const rect = scroller.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const delta = (coords.top + coords.bottom) / 2 - mid;
        if (Math.abs(delta) > 4) {
          scroller.scrollTop += delta;
        }
      });
    };
    const onSelection = () => requestAnimationFrame(centerCaret);
    document.addEventListener("selectionchange", onSelection);
    host.addEventListener("input", onSelection, true);
    requestAnimationFrame(centerCaret);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      host.removeEventListener("input", onSelection, true);
    };
  }, [typewriterMode]);

  /* 粘贴 / 拖拽图片：按「插入与路径」偏好落盘或 data URI 插入 */
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    return attachImageHandlers(host);
  }, []);

  /* 点击编辑区空白（host/滚动容器 padding）：光标落到最近块下一行行首（无则补空行），
     行首 Backspace 整块移除；捕获阶段拦截，避免 ProseMirror 默认落选区。 */
  useEffect(() => {
    const host = containerRef.current;
    const scroller = host?.parentElement;
    if (!host || !scroller) return;
    const onBlank = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, input, textarea, a, summary, .am-table-toolbar")) return;
      const ed = editorRef.current;
      if (!ed) return;
      let handled = false;
      ed.action((ctx) => {
        handled = placeBlockCaret(ctx.get(editorViewCtx), e.clientX, e.clientY);
      });
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    scroller.addEventListener("mousedown", onBlank, true);
    return () => scroller.removeEventListener("mousedown", onBlank, true);
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-editor">
      <div
        ref={containerRef}
        className={`am-milkdown-host mx-auto px-10 pt-10 pb-24 ${focusMode ? "am-focus-mode" : ""} ${indentFirstLine ? "am-indent-first" : ""} ${lineWrapping === false ? "am-no-wrap" : ""} ${showLineNumbersForFence ? "am-fence-linenos" : ""} ${codeBlockWrap ? "am-codeblock-wrap" : ""} ${autoNumberingMode !== "none" ? "am-math-numbered" : ""} ${autoNumberingMode === "ams" ? "am-math-ams" : ""}`}
        style={{ maxWidth: EDITOR_WIDTHS[editorWidth], fontSize: `${fontSize}px` }}
        data-testid="milkdown-host"
      />
    </div>
  );
}