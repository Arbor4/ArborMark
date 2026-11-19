import React from "react";

interface Props { children: React.ReactNode; onError?: (kind: string, msg: string, stack?: string) => void }
interface State { error: Error | null }

/** 渲染期崩溃兜底：不再整窗空白，显示错误与重试，便于定位桌面端问题。 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.("render", error.message, `${error.stack || ""}\n${info.componentStack || ""}`);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f7f9", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 560, width: "100%", background: "#fff", border: "1px solid #d8dee4", borderRadius: 12, padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "#24292f" }}>界面渲染出错</h2>
          <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "#57606a", wordBreak: "break-all" }}>
            {this.state.error.message}
          </p>
          <pre style={{ margin: "12px 0 0", maxHeight: 180, overflow: "auto", fontSize: 11, lineHeight: 1.5, color: "#8b949e", background: "#f6f8fa", borderRadius: 8, padding: 10, whiteSpace: "pre-wrap" }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 16, height: 32, padding: "0 16px", borderRadius: 8, border: "none", background: "#42b983", color: "#fff", fontSize: 13, cursor: "pointer" }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}