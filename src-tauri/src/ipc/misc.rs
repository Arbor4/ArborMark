//! 杂项应用通道。

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// `app.launchFile`：命令行/Dock 传入的启动文件路径（React 前端消费）。
///
/// setup 早期把 launch_file 作为局部变量用掉后不再暴露；这里从进程参数重新解析，
/// 并优先返回 pending_switch 里已挂起的目标（覆盖「会话恢复 + 新文件」竞态）。
/// 无启动文件时返回空字符串。
pub fn launch_file(app: &AppHandle) -> Result<Value, String> {
    let pending = app
        .try_state::<crate::state::AppState>()
        .and_then(|state| state.target_file("main"))
        .or_else(crate::pending_opened_file)
        .or_else(crate::startup::launch_file);
    Ok(Value::String(pending.unwrap_or_default()))
}

/// `preference.open`：打开偏好设置。
///
/// 遵循单一主窗口架构，直接通知主窗口唤起内嵌偏好设置面板，不再弹出独立子窗口。
pub fn open_preference(app: &tauri::AppHandle) -> Result<Value, String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(
            "arbor-event",
            json!({
                "channel": "open-preference",
                "payload": true
            }),
        );
    }
    Ok(json!(true))
}

pub fn download(payload: &Value) -> Result<Value, String> {
    let url = payload
        .as_str()
        .or_else(|| payload.get("url").and_then(Value::as_str))
        .ok_or("missing url")?;
    open::that(url).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// 渲染层 -> 所有窗口的事件广播（对应旧版 `app.sendEvent`）。
///
/// 旧渲染层调用形态是 `invoke("app.sendEvent", name, payload)`，
/// preload 会把它打包成 `[name, payload]`；bootstrap 的接收端固定监听
/// `arbor-event`，再按 `channel` 分发给 `ipcRenderer.on(name, ...)`。
/// 解析 `app.sendEvent` 的两种旧调用形态。
fn send_event_args(payload: &Value) -> (String, Value) {
    match payload {
        Value::Array(items) => (
            items
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            items.get(1).cloned().unwrap_or(Value::Null),
        ),
        Value::Object(map) => (
            map.get("event")
                .or_else(|| map.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            map.get("payload")
                .or_else(|| map.get("data"))
                .cloned()
                .unwrap_or(Value::Null),
        ),
        Value::String(event) => (event.clone(), Value::Null),
        _ => (String::new(), Value::Null),
    }
}

pub fn send_event(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let (event, data) = send_event_args(payload);
    if event.is_empty() {
        return Ok(Value::Null);
    }
    app.emit(
        "arbor-event",
        json!({ "channel": event, "payload": data }),
    )
    .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// `logger.*` / `app.log`：把渲染层日志并入 Rust 的日志输出。
pub fn log_message(level: &str, payload: &Value) -> Result<Value, String> {
    let message = if let Some(msg) = payload.get("message").and_then(Value::as_str) {
        msg.to_string()
    } else if let Some(s) = payload.as_str() {
        s.to_string()
    } else {
        payload.to_string()
    };

    match level {
        "error" => log::error!("[renderer] {message}"),
        "warn" => log::warn!("[renderer] {message}"),
        "debug" => log::debug!("[renderer] {message}"),
        _ => log::info!("[renderer] {message}"),
    }
    // 同时落到 startup.log：GUI 进程没有稳定可读的 stderr，日志重定向又容易
    // 绑错进程，把渲染层诊断信息写进持久化文件，排查问题时不用猜是哪个进程。
    crate::diagnostics::log(&format!("[renderer:{level}] {message}"));
    Ok(Value::Null)
}

/// `updater.checkForUpdates`：Tauri 侧尚未接入 updater 插件，先返回"已是最新"。
pub fn check_for_updates() -> Result<Value, String> {
    Ok(json!({ "upToDate": true, "version": env!("CARGO_PKG_VERSION") }))
}

/// `license.*`：当前版本没有授权服务器，返回与旧重构版一致的固定值。
pub fn machine_code() -> Result<Value, String> {
    Ok(json!("ARBORMARK-RECON-VALID-CODE"))
}

pub fn license_activate(payload: &Value) -> Result<Value, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .unwrap_or("");
    log::info!("[license] activate 请求（未接入服务器）: {} 字符", key.len());
    Ok(json!(true))
}

pub fn license_deactivate() -> Result<Value, String> {
    Ok(json!(true))
}

/// `setting.showWelcome` / `app.showWelcome` / `welcome.show`
/// 欢迎指引：通知主窗口激活欢迎或关于面板，不再创建独立子窗口
pub fn show_welcome(app: &AppHandle) -> Result<Value, String> {
    let target = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(_, window)| window)
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = target {
        let _ = window.emit(
            "arbor-event",
            json!({
                "channel": "show-welcome-dialog",
                "payload": true
            }),
        );
        let _ = window.eval("if (window.File && window.File.megaMenu && window.File.megaMenu.showWelcome) { window.File.megaMenu.showWelcome(); }");
    }
    Ok(json!(true))
}

/// `setting.showLicense` / `license.show`
/// 许可证：收敛至主窗口偏好设置的 License 标签，不再创建独立子窗口
pub fn show_license(app: &AppHandle) -> Result<Value, String> {
    let target = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(_, window)| window)
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = target {
        let _ = window.emit(
            "arbor-event",
            json!({
                "channel": "show-preference-tab",
                "payload": "License"
            }),
        );
        let _ = window.eval("if (window.File && window.File.megaMenu && window.File.megaMenu.showLicensePanel) { window.File.megaMenu.showLicensePanel(); }");
    }
    Ok(json!(true))
}

/// `app.rendererReady`：渲染层初始化完成的第一份体检报告。
pub fn renderer_ready(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    log::info!(
        "[renderer] 初始化完成 hasFile={} hasEditor={} title={} theme={} bg={} href={}",
        payload.get("hasFile").and_then(Value::as_bool).unwrap_or(false),
        payload.get("hasEditor").and_then(Value::as_bool).unwrap_or(false),
        payload.get("title").and_then(Value::as_str).unwrap_or(""),
        payload.get("theme").and_then(Value::as_str).unwrap_or(""),
        payload.get("bodyBg").and_then(Value::as_str).unwrap_or(""),
        payload.get("themeHref").and_then(Value::as_str).unwrap_or("")
    );
    log::info!(
        "[renderer] tempPath={} writeLen={}",
        payload.get("tempPath").and_then(Value::as_bool).unwrap_or(false),
        payload.get("writeLen").and_then(Value::as_i64).unwrap_or(-1)
    );
    // 渲染层已就绪：显示窗口（建窗时是隐藏的，避免首帧闪无样式内容）。
    let _ = window.show();
    // show() 到窗口真正上屏有延迟；立刻 set_focus 会让系统在首帧之前
    // 把焦点从原窗口切走，原窗口标题栏会短暂发黑。等一帧后再抢焦点。
    let focus_window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(80));
        let _ = focus_window.set_focus();
    });
    // 渲染层已就绪：把建窗口时挂起的"要打开的文档"切过去。
    if payload.get("hasEditor").and_then(Value::as_bool).unwrap_or(false) {
        crate::windows::flush_pending_switch(app, window);
    }
    Ok(Value::Null)
}


/// `url.request(url)`：主进程代为抓取远程图片（绕过渲染层 CORS）。
///
/// 渲染层（text-range-util）消费 `{ type: mime, data: [字节块] }` 做 DPI 嗅探；
/// 字节块按 JSON 数组传输（`Buffer.from(chunk)` 兼容普通数组）。
/// 用系统 curl（Win10+/macOS/Linux 自带）避免引入 TLS 依赖。
pub fn url_request(payload: &Value) -> Result<Value, String> {
    let url = payload
        .as_str()
        .or_else(|| payload.get("url").and_then(Value::as_str))
        .unwrap_or("");
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(Value::Null);
    }
    let output = std::process::Command::new("curl")
        .args(["-sL", "--max-time", "15", "-w", "\n%{content_type}", url])
        .output();
    let Ok(output) = output else {
        return Ok(Value::Null);
    };
    if !output.status.success() {
        return Ok(Value::Null);
    }
    // curl 把 content_type 追加在最后一行，与 body 之间以 \n 分隔。
    let stdout = output.stdout;
    let split_at = stdout
        .iter()
        .rposition(|&b| b == b'\n')
        .unwrap_or(stdout.len());
    let body = &stdout[..split_at];
    let mime = String::from_utf8_lossy(&stdout[split_at + 1..])
        .trim()
        .split(';')
        .next()
        .unwrap_or("")
        .to_string();
    let bytes: Vec<Value> = body.iter().map(|b| json!(b)).collect();
    Ok(json!({ "type": mime, "data": [bytes] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_event_accepts_array_and_object_shapes() {
        assert_eq!(
            send_event_args(&json!(["willSave", "/tmp/a.md"])),
            ("willSave".to_string(), json!("/tmp/a.md"))
        );
        assert_eq!(
            send_event_args(&json!({ "event": "didRename", "payload": { "oldPath": "a" } })),
            ("didRename".to_string(), json!({ "oldPath": "a" }))
        );
        assert_eq!(send_event_args(&json!(["", null])).0, "");
    }
}
