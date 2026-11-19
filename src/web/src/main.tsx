import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installMenuBridge } from "./bridge/menuBridge";
import { initMenuStateSync } from "./bridge/menuState";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/app.css";

// 全局错误捕获：控制台 + （桌面端）落盘 /tmp/am-web-error.log，便于定位 webview 崩溃。
function report(kind: string, msg: string, stack?: string) {
  console.error(`[ArborMark:${kind}]`, msg, stack || "");
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
    if (w.__TAURI_INTERNALS__) {
      import("./bridge/ipc").then(({ invoke }) =>
        invoke("fs.writeFile", {
          path: "/tmp/am-web-error.log",
          content: `[${new Date().toISOString()}] ${kind}: ${msg}\n${stack || ""}\n`,
        }).catch(() => {}),
      );
    }
  } catch {
    /* ignore */
  }
}
window.addEventListener("error", (e) => report("error", e.message, e.error?.stack));
window.addEventListener("unhandledrejection", (e) => report("unhandledrejection", String(e.reason), (e.reason as Error)?.stack));

// 原生 Mac 菜单命令桥（window.File / ClientCommand / JSBridge）
installMenuBridge();
initMenuStateSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary onError={report}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);