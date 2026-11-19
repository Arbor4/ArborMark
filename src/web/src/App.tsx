import { useEffect } from "react";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { useSearch } from "@/stores/search";
import { initThemes } from "@/theme/registry";
import { ActivityBar, Sidebar, StatusBar, useFocusRefresh } from "@/components/layout";
import { installOutlineSync } from "@/components/editor/outlineSync";
import { TitleBar } from "@/chrome/TitleBar";
import { installFindSync } from "@/components/editor/findSync";
import { useFind } from "@/stores/find";
import { FilePanel } from "@/components/files/FilePanel";
import { OutlinePanel } from "@/components/outline/OutlinePanel";
import { GlobalSearchModal } from "@/components/GlobalSearchModal";
import { EditorArea } from "@/components/editor/EditorArea";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { QuickOpen } from "@/components/QuickOpen";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Onboarding } from "@/components/Onboarding";
import { Toasts } from "@/components/common";
import { isTauri, invoke } from "@/bridge/ipc";
import { fs, pathUtil } from "@/bridge/fs";

export default function App() {
  const panel = useUi((s) => s.panel);
  const railVisible = useUi((s) => s.railVisible);
  const activePath = useWorkspace((s) => s.activePath);
  const dirty = useWorkspace((s) => s.dirty);
  useFocusRefresh();

  /* 文件状态只体现在窗口标题：未保存加 ● 前缀（状态栏不展示） */
  useEffect(() => {
    const name = activePath ? activePath.split("/").pop() : "";
    fs.setTitle(`${dirty ? "● " : ""}${name ? `${name} — ` : ""}ArborMark`);
  }, [activePath, dirty]);

  /* 启动：主题 → 工作区（Tauri 下回报渲染层就绪并消费启动参数 targetFile） */
  useEffect(() => {
    initThemes().then(async () => {
      const ws = useWorkspace.getState();
      if (isTauri()) {
        // 就绪回报：触发 Rust 侧 show() + flush_pending_switch（挂起的启动/恢复文档）。
        invoke("app.rendererReady", { hasFile: false, hasEditor: true, title: document.title }).catch(() => {});
        // 命令行/访达双击传入的文件：优先于会话恢复，直接打开（openPath 自带挂载父目录）。
        // （Rust setup 已把 launch_file 挂成 pending target；通道返回空串表示无。）
        let target = "";
        try {
          target = String(await invoke<string>("app.launchFile") ?? "");
        } catch {
          /* 通道缺失时静默回退到会话恢复 */
        }
        if (target) {
          await useWorkspace.getState().openPath(target).catch(() => {});
        } else {
          await ws.openDefault();
        }
        return;
      }
      ws.openDefault();
    });
  }, []);

  /* 编辑区 ↔ 大纲 滚动联动（全局捕获 scroll，模式切换无需重绑） */
  useEffect(() => installOutlineSync(), []);

  /* 文件内搜索同步（⌘/Ctrl+F） */
  useEffect(() => installFindSync(), []);

  /* 全局快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const ui = useUi.getState();
      const ws = useWorkspace.getState();

      if (mod && e.key === "p") {
        e.preventDefault();
        ui.setQuickOpen(!ui.quickOpenOpen);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        ui.openSettings();
      } else if (mod && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        ui.setGlobalSearch(true);
      } else if (mod && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        useFind.getState().setOpen(true);
      } else if (mod && (e.key === "r" || e.key === "R" || e.key === "h" || e.key === "H")) {
        e.preventDefault();
        useFind.getState().openReplace();
      } else if (mod && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const f = useFind.getState();
        if (f.open) f.prev();
        else f.setOpen(true);
      } else if (mod && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const f = useFind.getState();
        if (f.open) f.next();
        else f.setOpen(true);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        ui.toggleChrome();
      } else if (mod && ["1", "2"].includes(e.key)) {
        e.preventDefault();
        ui.setPanel((["files", "outline"] as const)[Number(e.key) - 1]);
      } else if (mod && e.key === "3") {
        e.preventDefault();
        ui.setGlobalSearch(true);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        ui.setEditorMode(ui.editorMode === "edit" ? "source" : "edit");
      } else if (mod && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        ui.toggleFocusMode();
      } else if (mod && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        window.ClientCommand?.newWindow?.();
      } else if (mod && (e.key === "n" || e.key === "N") && !e.shiftKey) {
        e.preventDefault();
        if (ws.rootPath) ws.createFile(ws.rootPath);
      } else if (mod && (e.key === "o" || e.key === "O") && !e.shiftKey) {
        e.preventDefault();
        import("@/bridge/fs").then(({ fs }) =>
          fs.openFolderDialog().then((r) => {
            if (!r.canceled && r.filePaths[0]) ws.openFolder(r.filePaths[0]);
          }),
        );
      } else if (mod && e.key === "s") {
        e.preventDefault();
        ws.save().then((ok) => ok && ui.toast("已保存", "success"));
      } else if (e.key === "Escape") {
        if (useFind.getState().open) useFind.getState().close();
        else if (ui.globalSearchOpen) ui.setGlobalSearch(false);
        else if (ui.quickOpenOpen) ui.setQuickOpen(false);
        else if (ui.settingsOpen) ui.closeSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* 支持 Ctrl/Cmd + 鼠标滚轮缩放字号 (Typora 外观偏好：按住 Ctrl 时使用鼠标滑轮缩放) */
  useEffect(() => {
    let lastWheelTime = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const ui = useUi.getState();
      if (ui.prefs.zoomOnScroll === false) return;

      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelTime < 60) return;
      lastWheelTime = now;

      const delta = e.deltaY;
      const current = ui.fontSize;
      if (delta < 0 && current < 28) {
        ui.setFontSize(current + 1);
      } else if (delta > 0 && current > 12) {
        ui.setFontSize(current - 1);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  /* 监听运行时文件打开（应用已在运行中从访达双击或 open -a 传入文件） */
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | null = null;
    import("@/bridge/ipc").then(({ listen }) => {
      listen<string>("open-file", (event) => {
        const filePath = typeof event === "string" ? event : (event as any).payload;
        if (filePath && typeof filePath === "string") {
          useWorkspace.getState().openPath(filePath).catch(() => {});
        }
      }).then((u) => (un = u));
    });
    return () => un?.();
  }, []);

  /* Tauri 菜单事件桥接（原生菜单 → 前端动作） */
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | null = null;
    import("@/bridge/ipc").then(({ listen }) => {
      listen<{ action: string }>("arbor-menu-action", ({ action }) => {
        const ui = useUi.getState();
        const ws = useWorkspace.getState();
        switch (action) {
          case "newFile":
            if (ws.rootPath) ws.createFile(ws.rootPath);
            break;
          case "save":
            ws.save();
            break;
          case "quickOpen":
            ui.setQuickOpen(true);
            break;
          case "globalSearch":
            ui.setGlobalSearch(true);
            break;
          case "preferences":
            ui.openSettings();
            break;
          case "toggleSidebar":
            ui.toggleChrome();
            break;
        }
      }).then((u) => (un = u));
    });
    return () => un?.();
  }, []);

  /* 原生拖放：尚无工作区时，拖入的文件夹/文件直接打开。
     已有工作区时由 FilePanel 负责导入到当前目录。 */
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | null = null;
    import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      getCurrentWebviewWindow()
        .onDragDropEvent(async (event) => {
          if (event.payload.type !== "drop") return;
          const ws = useWorkspace.getState();
          if (ws.rootPath) return;
          const first = event.payload.paths[0];
          if (!first) return;
          const st = await fs.stat(first).catch(() => null);
          if (!st?.exists) return;
          if (st.isDir) {
            await ws.openFolder(first).catch(() => {});
          } else {
            const dir = pathUtil.parent(first);
            await ws.openFolder(dir).catch(() => {});
            await useWorkspace.getState().openFile(first).catch(() => {});
          }
        })
        .then((u) => (un = u));
    });
    return () => un?.();
  }, []);

  /* 根治 WebKit 离开视口时的 I-beam 光标残留缺陷：
     鼠标靠近或穿出视口顶端原生标题栏时，强制恢复系统默认箭头指针 */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // 鼠标进入顶部 6px 缓冲带时，立即将 body 光标切回 default，促使 WebKit 重置系统光标
      if (e.clientY <= 6) {
        if (document.body.style.cursor !== "default") {
          document.body.style.cursor = "default";
        }
      } else if (document.body.style.cursor === "default") {
        document.body.style.cursor = "";
      }
    };
    const onMouseLeave = () => {
      document.body.style.cursor = "default";
      window.getSelection()?.removeAllRanges();
    };
    const onMouseEnter = () => {
      document.body.style.cursor = "";
    };
    const onBlur = () => {
      document.body.style.cursor = "default";
      setTimeout(() => {
        document.body.style.cursor = "";
      }, 50);
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    document.documentElement.addEventListener("mouseenter", onMouseEnter);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      document.documentElement.removeEventListener("mouseenter", onMouseEnter);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-app text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {/* 折叠侧边栏时活动栏一并收起；宽度动画与侧边栏同步 */}
        <div
          className="am-no-print shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
          style={{ width: railVisible ? 52 : 0 }}
          inert={!railVisible}
        >
          <ActivityBar />
        </div>
        <Sidebar>
          {panel === "files" && <FilePanel />}
          {panel === "outline" && <OutlinePanel />}
        </Sidebar>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <EditorArea />
          <StatusBar />
        </div>
      </div>
      <SettingsPanel />
      <QuickOpen />
      <GlobalSearchModal />
      <ImageLightbox />
      <Onboarding />
      <Toasts />
    </div>
  );
}