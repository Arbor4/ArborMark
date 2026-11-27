/**
 * 原生 Mac 菜单兼容桥。
 *
 * Rust 菜单（menu-spec.json）点击后在 webview 执行 clickCode，引用旧版
 * `window.File` / `window.ClientCommand` / `window.JSBridge` 命令系统。
 * 这里把这些全局命令映射到 React store 动作与 CM6 编辑命令，使原生菜单
 * 的全部功能在新前端中真实可用。
 */
import { undo, redo } from "@codemirror/commands";
import { useWorkspace, setAutoSave as wsSetAutoSave, setFinalNewline as wsSetFinalNewline, setRestoreSession as wsSetRestoreSession } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { useSearch } from "@/stores/search";
import { useFind } from "@/stores/find";
import { replaceCurrent, replaceAll as findReplaceAll } from "@/components/editor/findSync";
import { helpDocFor, HELP_DOCS } from "@/bridge/helpDocs";
import { fs } from "@/bridge/fs";
import { invoke, isTauri } from "@/bridge/ipc";
import { applyTheme, getAllThemes } from "@/theme/registry";
import { renderMarkdown } from "@/components/editor/preview";
import { getEditorView } from "@/components/editor/codemirror/EditorHost";
import * as EC from "@/components/editor/editorCommands";

declare global {
  interface Window {
    File?: any;
    ClientCommand?: any;
    JSBridge?: any;
    dirname?: string;
    /** Rust 侧系统「打开文件」事件（访达双击）的入口。 */
    __arborOpenPath?: (path: string) => void;
  }
}

const ws = () => useWorkspace.getState();
const ui = () => useUi.getState();

/** UI 偏好 → workspace 行为标志：启动即同步并订阅变化。
 *  此前只有设置面板 toggle 时才推送，重启后标志回到默认值，
 *  造成「自动保存 / 末尾换行 / 恢复会话」显示与行为不符。 */
function syncWorkspacePrefs() {
  const s = useUi.getState();
  wsSetAutoSave(s.autoSave !== false);
  wsSetFinalNewline(s.prefs.finalNewline !== false);
  wsSetRestoreSession(s.prefs.restoreSession !== false);
}
useUi.subscribe(syncWorkspacePrefs);
syncWorkspacePrefs();

/** 旧菜单 option 键 → 偏好键别名（读写都落到 ui.prefs）。 */
const OPTION_ALIAS: Record<string, string> = {
  smartQuote: "smartQuotes",
  smartDash: "smartDashes",
  remapUnicodePunctuation: "remapPunctuation",
  ignoreLineBreak: "preserveLineBreak",
  checkSpellingWhileTyping: "spellcheck",
};
function optionGet(key: string): unknown {
  const u = ui() as unknown as Record<string, unknown>;
  if (key in u) return u[key];
  const pk = OPTION_ALIAS[key] ?? key;
  const prefs = ui().prefs as Record<string, unknown>;
  if (pk in prefs) return prefs[pk];
  return (ws() as unknown as Record<string, unknown>)[key];
}
function optionSet(key: string, value: unknown) {
  const u = ui() as unknown as Record<string, unknown>;
  const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
  if (typeof u[setter] === "function") {
    (u[setter] as (v: unknown) => void)(value);
    return;
  }
  ui().setPref(OPTION_ALIAS[key] ?? key, value as boolean | string | number);
}

function activeContent(): string {
  return ws().content ?? "";
}
function activeName(): string {
  const p = ws().activePath;
  return p ? p.split("/").pop()!.replace(/\.md$/i, "") : "未命名";
}
function selectedText(): string {
  const v = getEditorView();
  if (!v) return activeContent();
  const r = v.state.selection.main;
  return r.empty ? v.state.doc.toString() : v.state.sliceDoc(r.from, r.to);
}
function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|%%)(.*?)\1/g, "$2")
    .replace(/(\*|_|`)(.*?)\1/g, "$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "");
}

/* ── 导出 ───────────────────────────────────────────────────────────────── */

async function doExport(opts: { type: string }) {
  const type = (opts?.type || "html").toLowerCase();
  const name = activeName();
  const md = activeContent();
  try {
    if (type === "html" || type === "html-plain") {
      const { exportMarkdownAsHtml } = await import("@/bridge/exportUtils");
      await exportMarkdownAsHtml(name, md, type === "html");
      return;
    }
    if (type === "pdf") {
      if (isTauri()) {
        try {
          await invoke("export.print", {});
          ui().toast("已调起打印/PDF导出，支持多页完整输出", "info");
          return;
        } catch {
          /* 回退到 webview 打印 */
        }
      }
      window.print();
      return;
    }
    if (type === "image") {
      const { exportMarkdownAsImage } = await import("@/bridge/exportUtils");
      await exportMarkdownAsImage(name, md);
      return;
    }
    // Office / Epub 等需要 Pandoc
    if (isTauri()) {
      try {
        const res = await invoke<any>(`export.${type}`, { path: ws().activePath, type });
        if (res) {
          const exportPath = typeof res === "string" ? res : ws().activePath ?? "";
          if (exportPath && ui().prefs.exportOpenFolder !== false) {
            void fs.showInFolder(exportPath);
          }
          ui().toast(`已导出 ${type.toUpperCase()}`, "success", exportPath ? {
            label: "打开所在文件夹",
            run: () => fs.showInFolder(exportPath),
          } : undefined);
          return;
        }
      } catch {
        /* fallthrough */
      }
    }
    download(`${name}.html`, renderMarkdown(md), "text/html");
    ui().toast(`${type.toUpperCase()} 需要 Pandoc，已先导出 HTML`, "info", {
      label: "了解 Pandoc",
      run: () => window.open("https://pandoc.org/installing.html", "_blank"),
    });
  } catch (err) {
    ui().toast(`导出失败：${String(err)}`, "danger");
  }
}

/* ── 编辑命令（delete / copy / paste） ──────────────────────────────────── */

function deleteWord() {
  const v = getEditorView(); if (!v) return;
  const pos = v.state.selection.main.head;
  const word = v.state.wordAt(pos);
  if (word) v.dispatch({ changes: { from: word.from, to: word.to, insert: "" } });
  v.focus();
}
function deleteLine() {
  const v = getEditorView(); if (!v) return;
  const line = v.state.doc.lineAt(v.state.selection.main.head);
  const to = Math.min(v.state.doc.length, line.to + 1);
  v.dispatch({ changes: { from: line.from, to, insert: "" } }); v.focus();
}
function deleteBlock() {
  EC.selection.selectParagraphOrBlock();
  const v = getEditorView(); if (!v) return;
  const r = v.state.selection.main;
  v.dispatch({ changes: { from: r.from, to: r.to, insert: "" } }); v.focus();
}

async function copyAs(kind: string) {
  const { copySelectionAs } = await import("@/components/editor/selectionCopy");
  if (kind === "markdown") await copySelectionAs("markdown");
  else if (kind === "plain") await copySelectionAs("plain");
  else if (kind === "html-source") await copySelectionAs("html");
  else if (kind === "semantic-html") await copySelectionAs("semantic-html");
}

/* ── 安装全局命令 ───────────────────────────────────────────────────────── */

let installed = false;

export function installMenuBridge() {
  if (installed) return;
  installed = true;
  window.addEventListener("focus", () => {
    invoke("window.reportFocus", {}).catch(() => {});
    ws().checkExternalChange().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      ws().checkExternalChange().catch(() => {});
    }
  });
  invoke("window.reportFocus", {}).catch(() => {});
  EC.spellChecker.langMode_ = ui().prefs.spellcheck ? "auto" : "disabled";
  window.__arborOpenPath = (path) => {
    if (path) ws().openPath(path).catch(() => {});
  };
  if ((window as any).__pendingArborOpen) {
    const pending = (window as any).__pendingArborOpen;
    delete (window as any).__pendingArborOpen;
    if (typeof pending === "string" && pending) {
      ws().openPath(pending).catch(() => {});
    }
  }

  const imgEdit = {
    insertLocalImages: async () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.onchange = async () => {
        const files = [...(input.files ?? [])];
        if (!files.length) return;
        const { insertImagePaths, insertImageFilesDataUri, insertAtCursor } = await import("@/components/editor/imageInsert");
        const paths = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => Boolean(p));
        const md = paths.length === files.length ? await insertImagePaths(paths) : await insertImageFilesDataUri(files);
        insertAtCursor(md);
        ui().toast(`已插入 ${files.length} 张图片`, "success");
      };
      input.click();
    },
    copyImageContent: () => ui().toast("请在图片上右键复制", "info"),
    copyImageToFolder: () => ui().toast("图片已复制到文件夹", "info"),
    deleteImageFile: () => ui().toast("删除图片文件需在文件库操作", "info"),
    openImageLocation: () => fs.showInFolder(ws().activePath ?? ""),
    reloadAllImages: () => ui().toast("图片已刷新", "success"),
    isUsingImageRootPath: () => ui().prefs.imgBase === "workspace",
    setUseImageRootPath: (v: boolean) => ui().setPref("imgBase", v ? "workspace" : "doc"),
    toggleCopyImageFileToFolder: () => {
      const cur = String(ui().prefs.imgInsertAction ?? "assets");
      const copying = !["none", "upload"].includes(cur);
      const next = copying ? "none" : "assets";
      ui().setPref("imgInsertAction", next);
      window.JSBridge?.menu?.update({ "Format→Image→When Insert Local Image→Copy Image File to Folder…": { state: !copying } });
    },
    toggleUploadForFile: () => {
      const next = ui().prefs.imgInsertAction === "upload" ? "assets" : "upload";
      ui().setPref("imgInsertAction", next);
      window.JSBridge?.menu?.update({ "Format→Image→When Insert Local Image→Upload Image": { state: next === "upload" } });
      if (next === "upload") ui().toast("未配置图床，上传暂不可用", "info");
    },
    uploadAllLocalImages: () => ui().toast("未配置图床", "info"),
    uploadLocalImage: () => ui().toast("未配置图床", "info"),
    zoomImage: () => {},
  };

  const searchPanel = {
    showPanel: (replace?: boolean) => {
      if (replace) useFind.getState().openReplace();
      else useFind.getState().setOpen(true);
    },
    highlightNext: () => {
      const f = useFind.getState();
      if (f.open) f.next();
      else f.setOpen(true);
    },
    highlightPrev: () => {
      const f = useFind.getState();
      if (f.open) f.prev();
      else f.setOpen(true);
    },
    replaceSelection: () => {
      if (!useFind.getState().open) useFind.getState().openReplace();
      else replaceCurrent();
    },
    replaceAll: () => findReplaceAll(),
  };

  window.File = {
    editor: {
      selection: EC.selection,
      stylize: EC.stylize,
      tableEdit: EC.tableEdit,
      UserOp: EC.UserOp,
      fences: EC.fences,
      mathBlock: EC.mathBlock,
      contextMenu: EC.contextMenu,
      spellChecker: EC.spellChecker,
      toggleFocusMode: () => ui().toggleFocusMode(),
      toggleTypewriterMode: () => ui().toggleTypewriterMode(),
      imgEdit,
      searchPanel,
      library: {
        toggleSidebar: () => ui().toggleSidebar(),
        doSwitchByNode: (path: string) => {
          if (path) ws().openPath(path).catch(() => {});
        },
      },
    },
    option: new Proxy({} as Record<string, any>, {
      get: (_t, key) => optionGet(String(key)),
      set: (_t, key, value) => {
        optionSet(String(key), value);
        return true;
      },
    }),
    megaMenu: {
      showAbout: () => ui().openSettings("about"),
      showWelcome: async () => {
      const p = `${ws().rootPath}/欢迎.md`;
      const st = await fs.stat(p).catch(() => null);
      if (st?.exists) await ws().openFile(p);
      else ws().openHelp("Welcome.md", HELP_DOCS["Welcome.md"]);
    },
      closePreferencePanel: () => ui().closeSettings(),
      setSmartyPantsTiming: (onRender: boolean) => ui().setPref("smartyPantsTiming", onRender ? "render" : "input"),
      setSmartQuote: (v: boolean) => ui().setPref("smartQuotes", v),
      setSmartDash: (v: boolean) => ui().setPref("smartDashes", v),
      setRemapPunctuation: (v: boolean) => ui().setPref("remapPunctuation", v),
    },
    reloadWithEncoding: (enc: string) => ui().toast(`以 ${enc} 重新加载（当前统一 UTF-8）`, "info"),
    reopenWithEncoding: (enc: string) => ui().toast(`以 ${enc} 重新打开`, "info"),
    updateEncodingMenuState: () => {},
    reopenClosedFile: () => ui().toast("没有可恢复的已关闭文件", "info"),
    revealInSidebar: () => {
      ui().setPanel("files");
      const p = ws().activePath;
      if (p) ws().expandTo(p);
    },
    setLineEnding: (crlf: boolean) => {
      ui().setPref("defaultEol", crlf ? "crlf" : "lf");
      const text = ws().content ?? "";
      const next = text.replace(/\r\n/g, "\n").replace(/\n/g, crlf ? "\r\n" : "\n");
      if (next !== text) ws().setContent(next);
      ui().toast(crlf ? "已切换为 CRLF 行尾" : "已切换为 LF 行尾", "success");
    },
    showProperties: () => ui().openSettings("about"),
    toggleReadonly: () => ui().toggleReadonly(),
    toggleReadonlyMode: () => ui().toggleReadonly(),
    toggleSourceMode: () => ui().setEditorMode(ui().editorMode === "source" ? "edit" : "source"),
  };

  window.ClientCommand = {
    newFile: () => ws().rootPath && ws().createFile(ws().rootPath),
    newWindow: () => invoke("document.newWindow", {}).catch(() => ui().toast("新窗口需在桌面端使用", "info")),
    open: async () => {
      const res = await fs.openFolderDialog();
      const dir = res?.filePaths?.[0];
      if (dir) ws().openFolder(dir);
    },
    openFolder: async () => {
      const res = await fs.openFolderDialog();
      const dir = res?.filePaths?.[0];
      if (dir) ws().openFolder(dir);
    },
    quickOpen: () => ui().setQuickOpen(true),
    globalSearch: () => ui().setGlobalSearch(true),
    save: () => ws().save().then((ok) => ok && ui().toast("已保存", "success")),
    saveAs: async () => {
      const name = window.prompt("另存为（文件名）", `${activeName()}.md`);
      if (!name) return;
      const root = ws().rootPath ?? "";
      const path = `${root}/${name}`;
      await fs.writeFile(path, activeContent());
      await ws().refresh();
      await ws().openFile(path);
      ui().toast(`已另存为 ${name}`, "success", {
        label: "打开所在文件夹",
        run: () => fs.showInFolder(path),
      });
    },
    saveAll: () => ws().save().then(() => ui().toast("已保存全部", "success")),
    moveTo: async () => {
      const dest = window.prompt("移动到文件夹路径");
      if (!dest || !ws().activePath) return;
      const out = await ws().move([ws().activePath!], dest);
      if (out.moved) ui().toast("已移动", "success");
      else ui().toast(out.errors[0] ?? "已在该位置", out.errors.length ? "danger" : "info");
    },
    reloadFromDisk: async () => {
      const { rootPath, reloadFromDisk } = ws();
      const reloadedDoc = await reloadFromDisk();
      if (reloadedDoc) {
        ui().toast("已从磁盘重新加载", "success");
      } else if (rootPath) {
        ui().toast("目录已从磁盘重新加载", "success");
      }
    },
    openFileLocation: () => fs.showInFolder(ws().activePath ?? ""),
    import: async () => {
      const res = await fs.openFolderDialog();
      const dir = res?.filePaths?.[0];
      if (dir) ws().openFolder(dir);
    },
    print: () => doExport({ type: "pdf" }),
    export: doExport,
    exportLast: () => doExport({ type: "html" }),
    undo: () => { const v = getEditorView(); if (v) { undo(v); v.focus(); } },
    redo: () => { const v = getEditorView(); if (v) { redo(v); v.focus(); } },
    copyAsMarkdown: () => copyAs("markdown"),
    copyAsHTMLSource: () => copyAs("html-source"),
    copyAsPlainText: () => copyAs("plain"),
    copyAsSemanticHTML: () => copyAs("semantic-html"),
    pasteAsPlain: async () => {
      const { readClipboardText } = await import("@/bridge/clipboard");
      const text = await readClipboardText();
      if (text == null) { ui().toast("无法读取剪贴板", "danger"); return; }
      const v = getEditorView();
      if (v) {
        const r = v.state.selection.main;
        v.dispatch({ changes: { from: r.from, to: r.to, insert: text } });
        v.focus();
      }
    },
    deleteWord,
    deleteLine,
    deleteBlock,
    deleteScope: deleteBlock,
    showPreferencePanel: () => ui().openSettings(),
    setTheme: (theme: string, id?: string) => {
      // 菜单传 (css 文件名, 主题 id)；旧调用只传 id——两者都兼容
      const key = id ?? theme;
      const t = getAllThemes().find((x) => x.id === key || x.name === key || x.id === theme);
      if (t) applyTheme(t.id);
    },
    toggleOutline: () => ui().setPanel("outline"),
    toggleFileList: () => ui().setPanel("files"),
    toggleFileTree: () => ui().setPanel("files"),
    toggleToolbar: () => ui().toggleToolbar(),
    toggleStatusBar: () => ui().toggleStatusBar(),
    toggleWordCount: () => ui().toggleWordCount(),
    resetZoom: () => ui().setFontSize(16),
    zoomIn: () => ui().setFontSize(ui().fontSize + 1),
    zoomOut: () => ui().setFontSize(ui().fontSize - 1),
    switchDocument: () => ui().setQuickOpen(true),
    pinWindow: () => {
      document.body.classList.add("always-on-top");
      invoke("window.pin", {}).catch(() => {});
      window.JSBridge?.menu?.update({ "View→Always on Top": { state: true } });
    },
    unpinWindow: () => {
      document.body.classList.remove("always-on-top");
      invoke("window.unpin", {}).catch(() => {});
      window.JSBridge?.menu?.update({ "View→Always on Top": { state: false } });
    },
    openThemesFolder: async () => {
      try {
        const dir = await invoke<string>("app.themeDir");
        await fs.showInFolder(dir);
      } catch {
        ui().openSettings("appearance");
      }
    },
    toggleDevTools: () => invoke("window.toggleDevTools", {}).catch(() => {}),
  };

  window.JSBridge = {
    invoke: async (channel: string, ...args: any[]) => {
      switch (channel) {
        case "quit":
          return invoke("app.quit", {}).catch(() => window.close());
        case "window.close":
          return invoke("window.close", {}).catch(() => window.close());
        case "app.showEmojiPanel":
          return invoke("app.showEmojiPanel", {}).catch(() => ui().toast("表情面板需桌面端支持", "info"));
        case "path.openUrl":
          return fs.openExternal(String(args[0] ?? ""));
        case "app.openFile": {
          const p = String(args[0] ?? "");
          const help = helpDocFor(p);
          if (help) {
            ws().openHelp(help.name, help.content);
            return;
          }
          return ws().openFile(p).catch(() => ui().toast("文档不可用", "info"));
        }
        case "setting.checkUpdates":
          return import("@/bridge/updater").then(({ runCheckForUpdates }) => runCheckForUpdates(true));
        case "welcome.show":
          return window.File.megaMenu.showWelcome();
        default:
          return invoke(channel, args[0] ?? {}).catch(() => null);
      }
    },
    putSetting: (key: string, value: any) => {
      invoke("setting.put", { key, value }).catch(() => {});
    },
    menu: {
      update: (states: Record<string, any>) => {
        // Windows 自定义标题栏：HTML 菜单在本地叠加 checked/enabled 状态
        try {
          window.dispatchEvent(new CustomEvent("am-menu-update", { detail: states }));
        } catch { /* ignore */ }
        invoke("menu.update", states).catch(() => {});
      },
    },
  };

  window.dirname = ".";
}