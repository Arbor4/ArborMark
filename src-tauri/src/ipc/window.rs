//! 窗口控制。
//!
//! 所有函数都接收**调用方窗口**（而不是固定取 `main`）：
//! 多窗口下 `window.setTitle` / `close` / `minimize` 必须作用在发起请求的那个窗口，
//! 否则打开的第二个文档会去改主窗口的标题。

use serde_json::{json, Value};
use tauri::{AppHandle, WebviewWindow};

fn as_bool(payload: &Value) -> bool {
    payload
        .as_bool()
        .or_else(|| payload.get("value").and_then(Value::as_bool))
        .or_else(|| payload.get("fullscreen").and_then(Value::as_bool))
        .or_else(|| payload.get("fullScreen").and_then(Value::as_bool))
        .unwrap_or(false)
}

pub fn set_title(window: &WebviewWindow, payload: &Value) -> Result<Value, String> {
    // 旧渲染层有两种调用：
    //   setTitle("foo.md - ArborMark")
    //   setTitle(undefined, true/false)  // 只切换标题栏的修改标记
    // preload 会把后者打包成 `[null, true]`。
    let direct = payload
        .as_str()
        .or_else(|| payload.get("title").and_then(Value::as_str));
    if let Some(title) = direct {
        window.set_title(title).map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }

    let modified = payload
        .as_array()
        .and_then(|items| items.get(1))
        .and_then(Value::as_bool)
        .or_else(|| payload.get("modified").and_then(Value::as_bool))
        .or_else(|| payload.get("isModified").and_then(Value::as_bool));
    if let Some(modified) = modified {
        let current = window.title().unwrap_or_else(|_| "ArborMark".into());
        let clean = current.replace(" •", "");
        let clean = clean.trim();
        let next = if modified {
            format!("{clean} •")
        } else {
            clean.to_string()
        };
        window.set_title(&next).map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }

    Ok(Value::Null)
}

pub fn close(window: &WebviewWindow) -> Result<Value, String> {
    window.close().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn minimize(window: &WebviewWindow) -> Result<Value, String> {
    window.minimize().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn maximize(window: &WebviewWindow) -> Result<Value, String> {
    window.maximize().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn unmaximize(window: &WebviewWindow) -> Result<Value, String> {
    window.unmaximize().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn is_maximized(window: &WebviewWindow) -> Result<Value, String> {
    let value = window.is_maximized().map_err(|e| e.to_string())?;
    Ok(json!(value))
}

pub fn set_fullscreen(window: &WebviewWindow, payload: &Value) -> Result<Value, String> {
    window
        .set_fullscreen(as_bool(payload))
        .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn is_fullscreen(window: &WebviewWindow) -> Result<Value, String> {
    let value = window.is_fullscreen().map_err(|e| e.to_string())?;
    Ok(json!(value))
}

pub fn focus(window: &WebviewWindow) -> Result<Value, String> {
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn set_always_on_top(window: &WebviewWindow, value: bool) -> Result<Value, String> {
    window.set_always_on_top(value).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn toggle_devtools(window: &WebviewWindow) -> Result<Value, String> {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
    Ok(Value::Null)
}

/// `window.open`：只允许 http(s)/mailto，交给系统浏览器打开。
pub fn open_url(payload: &Value) -> Result<Value, String> {
    let url = payload
        .as_str()
        .or_else(|| payload.get("url").and_then(Value::as_str))
        .unwrap_or("");

    let allowed = url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:");
    if !allowed {
        return Ok(json!(false));
    }

    open::that(url).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

/// `webContents.*`：在 WebView 里执行对应的编辑命令。
pub fn exec_edit_command(window: &WebviewWindow, command: &str) -> Result<Value, String> {
    let script = format!("try {{ document.execCommand(\"{command}\"); }} catch (e) {{}}");
    window.eval(&script).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// `window.restore`：从最小化恢复并聚焦。
pub fn restore(window: &WebviewWindow) -> Result<Value, String> {
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(Value::Null)
}

/// `setZoom`：用 WebView 原生缩放（WebView2 ZoomFactor / WKWebView pageZoom）。
///
/// 之前用 CSS `zoom` 模拟：在代码块（CodeMirror）里，CSS zoom 会让编辑器的
/// 行高/坐标换算和鼠标事件坐标系对不上，表现为"光标位置和代码行错位"。
/// 原生缩放由浏览器统一处理布局与命中测试，没有这个问题。
///
/// 入参是倍率（1.0 = 100%）；非法值回落到 1，其余钳制到 0.3–6。
pub fn set_zoom(window: &WebviewWindow, factor: f64) -> Result<Value, String> {
    let factor = if factor.is_finite() && factor > 0.0 {
        factor.clamp(0.3, 6.0)
    } else {
        1.0
    };

    // wry 只在 WebKitGTK 上实现了 set_zoom；Windows 需要直接操作 WebView2
    // 控制器的 ZoomFactor（与浏览器"页面缩放"等价，布局和命中测试一并缩放）。
    #[cfg(target_os = "windows")]
    {
        let scale = factor;
        window
            .with_webview(move |webview| {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;
                let controller: ICoreWebView2Controller = webview.controller();
                unsafe {
                    let _ = controller.SetZoomFactor(scale);
                }
            })
            .map_err(|err| format!("with_webview 失败：{err}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        window.set_zoom(factor).map_err(|e| e.to_string())?;
    }

    Ok(json!(factor))
}

/// `setZoom` 的 payload 版本：接受数字或 `{factor|zoomFactor}`。
pub fn set_zoom_payload(window: &WebviewWindow, payload: &Value) -> Result<Value, String> {
    let factor = payload
        .as_f64()
        .or_else(|| payload.get("factor").and_then(Value::as_f64))
        .or_else(|| payload.get("zoomFactor").and_then(Value::as_f64))
        .unwrap_or(1.0);
    set_zoom(window, factor)
}

/// `menu.updateCustomZoom`：参数为 1（放大）/ -1（缩小）/ 0（重置）。
/// 缩放系数持久化到设置里，重启后保持。
///
/// 注意：渲染层刷新"视图"菜单时也会**无参**调用这条通道
/// （`ClientCommand.refreshViewMenu` → `JSBridge.invoke("menu.updateCustomZoom")`），
/// 那只是同步菜单状态，不能当成"重置"。以前这里把缺省 delta 当作 0，
/// 于是每次切换状态栏/工具栏/源码模式（都会 refreshViewMenu）都会把缩放打回
/// 100%，表现为"拖动一下窗口/点一下菜单，缩放就变回去了"。
pub fn update_custom_zoom(
    window: &WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let delta = payload
        .as_i64()
        .or_else(|| payload.get("delta").and_then(Value::as_i64));

    // 无参调用 = 只刷新菜单，返回当前倍率即可。
    let Some(delta) = delta else {
        return Ok(json!(state.get("zoomFactor").as_f64().unwrap_or(1.0)));
    };

    let current = state.get("zoomFactor").as_f64().unwrap_or(1.0);
    let next = if delta == 0 {
        1.0
    } else {
        (current + 0.1 * delta as f64).clamp(0.5, 3.0)
    };

    state.put("zoomFactor", json!(next));
    set_zoom(window, next)
}

/// `window.selectNextTab` / `selectPreviousTab`：在已打开的窗口间循环切换。
///
/// 旧版由 windowManager 维护标签顺序；这里按窗口 label 排序（main, doc-1, doc-2…），
/// 语义等价且不需要额外状态。
pub fn cycle_window(app: &AppHandle, window: &WebviewWindow, forward: bool) -> Result<Value, String> {
    use tauri::Manager;

    let mut labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    labels.sort();
    if labels.len() < 2 {
        return Ok(Value::Null);
    }

    let current = window.label().to_string();
    let index = labels.iter().position(|label| label == &current).unwrap_or(0);
    let next = if forward {
        (index + 1) % labels.len()
    } else {
        (index + labels.len() - 1) % labels.len()
    };

    if let Some(target) = app.get_webview_window(&labels[next]) {
        let _ = target.set_focus();
    }
    Ok(Value::Null)
}


// ---------------------------------------------------------------------------
// macOS 专属窗口通道：渲染层调用点全部在 `File.isMac` 分支内，Tauri 不触达。
// 提供诚实 no-op 桩保持回调链完整（旧 rebuild 版对这些通道也是 null）。
// ---------------------------------------------------------------------------

/// `window.setBackground`：mac 通知主进程同步窗口背景色（titlebar 振动色）。
pub fn set_background() -> Result<Value, String> {
    Ok(json!(true))
}

/// `window.setIsSchemeAwareness`：mac 通知主进程注册 URL scheme 感知。
pub fn set_is_scheme_awareness() -> Result<Value, String> {
    Ok(json!(true))
}

/// `window.previewFile`：mac QuickLook 预览（空格预览）。
/// Windows 侧没有 QuickLook；等价行为是用系统默认程序打开该文件。
pub fn preview_file(payload: &Value) -> Result<Value, String> {
    let Some(path) = payload.as_str().or_else(|| payload.get("path").and_then(Value::as_str)) else {
        return Ok(json!(false));
    };
    match open::that(path) {
        Ok(_) => Ok(json!(true)),
        Err(err) => {
            log::warn!("[window] previewFile 打开失败 {path}: {err}");
            Ok(json!(false))
        }
    }
}

/// `window.showDialog`：mac 版由主进程弹系统对话框（document-model 的确认流）。
/// Tauri 渲染层有跨平台 dialog 组件，此通道保留桩。
pub fn show_dialog() -> Result<Value, String> {
    Ok(json!(true))
}

/// `window.updateUIAfterExitSourceMode`：mac 通知主进程刷新窗口 UI 状态。
pub fn update_ui_after_exit_source_mode() -> Result<Value, String> {
    Ok(json!(true))
}

/// `window.refreshFullContentState`：mac 通知主进程刷新全屏/内容区状态。
pub fn refresh_full_content_state() -> Result<Value, String> {
    Ok(json!(true))
}

/// `window.setTitlebarTextMarginLeft`：mac 通知主进程平移标题栏文字（sidebar 展开时）。
/// Tauri 的系统标题栏由 OS 绘制，无法平移文字；值记录到日志便于未来自定义 titlebar。
pub fn set_titlebar_text_margin_left(payload: &Value) -> Result<Value, String> {
    let margin = payload.as_f64().or_else(|| payload.get("margin").and_then(Value::as_f64));
    log::debug!("[window] setTitlebarTextMarginLeft: {margin:?}（Tauri 暂不消费）");
    Ok(json!(true))
}

/// `window.execForAll`：把一段 JS/函数广播到所有窗口执行。
///
/// 渲染层 `ClientCommand.execForAll` 在 Electron 下走 ipcRenderer 广播，
/// mac 下走此通道。Tauri 里实现为对全部 webview 窗口 eval。
pub fn exec_for_all(app: &tauri::AppHandle, payload: &Value) -> Result<Value, String> {
    use tauri::Manager;
    let code = payload
        .as_str()
        .or_else(|| payload.get("code").and_then(Value::as_str))
        .unwrap_or("");
    if code.is_empty() {
        return Ok(json!(false));
    }
    for (_, window) in app.webview_windows() {
        let _ = window.eval(code);
    }
    Ok(json!(true))
}
