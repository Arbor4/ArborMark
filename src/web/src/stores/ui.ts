import { create } from "zustand";

export type PanelId = "files" | "outline" | "search";
export type EditorMode = "edit" | "source";
export type ToastKind = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run: () => void };
}

interface UiState {
  panel: PanelId;
  sidebarVisible: boolean;
  railVisible: boolean;
  sidebarWidth: number;
  editorMode: EditorMode;
  focusMode: boolean;
  typewriterMode: boolean;
  lineNumbers: boolean;
  settingsOpen: boolean;
  settingsTab: string;
  quickOpenOpen: boolean;
  globalSearchOpen: boolean;
  imageInsertOpen: boolean;
  tablePickerPos: { x: number; y: number } | null;
  toasts: Toast[];
  autoSave: boolean;
  fontSize: number;
  editorWidth: "standard" | "wide" | "wider" | "full";
  toolbarVisible: boolean;
  statusBarVisible: boolean;
  wordCountVisible: boolean;
  readonlyMode: boolean;
  prefs: Record<string, boolean | string | number>;
  outlineActive: string | null;

  setPanel: (panel: PanelId) => void;
  toggleSidebar: () => void;
  toggleChrome: () => void;
  setSidebarWidth: (width: number) => void;
  setEditorMode: (mode: EditorMode) => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  toggleLineNumbers: () => void;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
  setQuickOpen: (open: boolean) => void;
  setGlobalSearch: (open: boolean) => void;
  setImageInsertOpen: (open: boolean) => void;
  setTablePickerPos: (pos: { x: number; y: number } | null) => void;
  toast: (message: string, kind?: ToastKind, action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  setAutoSave: (enabled: boolean) => void;
  setFontSize: (size: number) => void;
  setEditorWidth: (width: UiState["editorWidth"]) => void;
  toggleToolbar: () => void;
  toggleStatusBar: () => void;
  toggleWordCount: () => void;
  toggleReadonly: () => void;
  setPref: (key: string, value: boolean | string | number) => void;
  resetPrefs: () => void;
  setOutlineActive: (key: string | null) => void;
}

let toastId = 0;
let lastToastMsg = "";
let lastToastTime = 0;
const LS_KEY = "arbor.ui";

export const DEFAULT_PREFS: Record<string, boolean | string | number> = {
  // 文件与启动
  defaultFileExt: "md",
  defaultEol: "lf",
  autoSaveOnSwitch: true,
  // 语法与标点
  smartQuotes: true,
  smartDashes: true,
  finalNewline: true,
  preserveLineBreak: false,
  indentFirstLine: false,
  remapPunctuation: false,
  autoCheckUpdate: true,
  restoreSession: true,
  language: "zh-Hans",
  // Markdown 语法扩展（变更触发编辑器重挂载）
  enableInlineMath: true,
  enableHighlight: true,
  enableSuperscript: true,
  enableSubscript: true,
  enableDiagram: true,
  enableAlert: true,
  enableEmoji: true,
  blockHTML: true,
  autoNumberingForMath: false,
  unorderedListMarker: "-",
  defaultCodeLang: "",
  // 编辑器行为
  indentSize: 2,
  autoPair: true,
  spellcheck: false,
  lineWrapping: true,
  copyCutWholeLine: true,
  zoomOnScroll: true,
  showLineNumbersForFence: false,
  outlineHeadingHighlight: true,
  // 图片
  useRelativePathForImg: true,
  autoEscapeImageURL: true,
  imgInsertAction: "assets",
  imgApplyLocal: true,
  imgApplyNetwork: false,
  imgYamlUpload: false,
  imgAddDotSlash: false,
  imgCustomPath: "",
  // 导出与状态
  exportOpenFolder: true,
  statusMetric: "words",
  wordsPerMinute: 300,
};

function loadPersisted(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const persisted: Partial<UiState> = {
      sidebarWidth: parsed.sidebarWidth ?? 264,
      sidebarVisible: parsed.sidebarVisible ?? true,
      railVisible: parsed.railVisible ?? true,
      editorMode: parsed.editorMode === "source" ? "source" : "edit",
      lineNumbers: parsed.lineNumbers ?? false,
      autoSave: parsed.autoSave ?? true,
      fontSize: parsed.fontSize ?? 16,
      editorWidth: parsed.editorWidth ?? "standard",
      typewriterMode: parsed.typewriterMode ?? false,
    };
    // 旧版本持久化可能缺 prefs：与 DEFAULT_PREFS 合并
    persisted.prefs = { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) };
    return persisted;
  } catch {
    return {};
  }
}

function persist(state: UiState) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        sidebarWidth: state.sidebarWidth,
        sidebarVisible: state.sidebarVisible,
        railVisible: state.railVisible,
        editorMode: state.editorMode,
        lineNumbers: state.lineNumbers,
        autoSave: state.autoSave,
        fontSize: state.fontSize,
        editorWidth: state.editorWidth,
        typewriterMode: state.typewriterMode,
        prefs: state.prefs,
      }),
    );
  } catch {
    /* ignore */
  }
}

export const EDITOR_WIDTHS: Record<UiState["editorWidth"], string> = {
  standard: "860px",
  wide: "1040px",
  wider: "1240px",
  full: "none",
};

export const useUi = create<UiState>((set, get) => ({
  panel: "files",
  sidebarVisible: true,
  railVisible: true,
  sidebarWidth: 264,
  editorMode: "edit",
  focusMode: false,
  typewriterMode: false,
  lineNumbers: false,
  settingsOpen: false,
  settingsTab: "appearance",
  quickOpenOpen: false,
  globalSearchOpen: false,
  imageInsertOpen: false,
  tablePickerPos: null,
  toasts: [],
  autoSave: true,
  fontSize: 16,
  editorWidth: "standard",
  toolbarVisible: false,
  statusBarVisible: true,
  wordCountVisible: true,
  readonlyMode: false,
  outlineActive: null,
  prefs: { ...DEFAULT_PREFS },
  ...loadPersisted(),

  setPanel: (panel) => {
    const { panel: current, sidebarVisible } = get();
    if (panel === current && sidebarVisible) {
      set({ sidebarVisible: false });
    } else {
      set({ panel, sidebarVisible: true });
    }
  },
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  // 整条 chrome（活动栏 + 面板侧边栏）一起折叠/展开
  toggleChrome: () =>
    set((s) => {
      const visible = s.sidebarVisible || s.railVisible;
      return { sidebarVisible: !visible, railVisible: !visible };
    }),
  setSidebarWidth: (width) => {
    const clamped = Math.min(480, Math.max(200, width));
    set({ sidebarWidth: clamped });
    persist(get());
  },
  setEditorMode: (mode) => {
    set({ editorMode: mode });
    persist(get());
  },
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleTypewriterMode: () => {
    set((s) => ({ typewriterMode: !s.typewriterMode }));
    persist(get());
  },
  toggleLineNumbers: () => {
    set((s) => ({ lineNumbers: !s.lineNumbers }));
    persist(get());
  },
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab }),
  closeSettings: () => set({ settingsOpen: false }),
  setQuickOpen: (open) => set({ quickOpenOpen: open }),
  setGlobalSearch: (open) => set({ globalSearchOpen: open }),
  setImageInsertOpen: (open) => set({ imageInsertOpen: open }),
  setTablePickerPos: (pos) => set({ tablePickerPos: pos }),

  toast: (message, kind = "info", action) => {
    const now = performance.now();
    if (message === lastToastMsg && now - lastToastTime < 800) {
      return;
    }
    lastToastMsg = message;
    lastToastTime = now;
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 8000 : 3600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setAutoSave: (enabled) => {
    set({ autoSave: enabled });
    persist(get());
  },
  setFontSize: (size) => {
    const clamped = Math.min(24, Math.max(12, size));
    set({ fontSize: clamped });
    document.documentElement.style.setProperty("--am-editor-size", `${clamped}px`);
    persist(get());
  },
  setEditorWidth: (width) => {
    set({ editorWidth: width });
    document.documentElement.style.setProperty("--am-editor-width", EDITOR_WIDTHS[width]);
    persist(get());
  },
  toggleToolbar: () => set((s) => ({ toolbarVisible: !s.toolbarVisible })),
  toggleStatusBar: () => set((s) => ({ statusBarVisible: !s.statusBarVisible })),
  toggleWordCount: () => set((s) => ({ wordCountVisible: !s.wordCountVisible })),
  toggleReadonly: () => set((s) => ({ readonlyMode: !s.readonlyMode })),
  setPref: (key, value) => {
    set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
    persist(get());
  },
  resetPrefs: () => {
    set({ prefs: { ...DEFAULT_PREFS } });
    persist(get());
  },
  setOutlineActive: (key) => set({ outlineActive: key }),
}));