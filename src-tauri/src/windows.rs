//! 窗口工厂：创建直接加载 src/web 前端的 WebView 窗口。
//!
//! 前端是自包含的 React 应用（Tauri IPC + menuBridge），不需要任何
//! initialization_script 注入：旧 bootstrap 兼容层（reqnode / JSBridge /
//! 拖放蒙版）已随旧渲染层一起移除。

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn app_settings(app: &AppHandle) -> Value {
    app.try_state::<crate::state::AppState>()
        .map(|state| state.all_settings())
        .unwrap_or_else(|| json!({}))
}

/// 路径 / 语言上下文（`setting.loadAll`、`setting.getExtraOption` 消费）。
///
/// 这些路径会被调用方用 `+ "/xxx"` 直接拼接，必须是没有 `\\?\` 前缀的普通
/// 路径，否则 Rust 侧的 `Path::exists()` 解析不了正斜杠。
pub fn path_context(app: &AppHandle) -> Value {
    let user_data = crate::protocol::plain_path(crate::protocol::data_root()).join("userData");

    // 导出 / 打印视图依赖 tempPath；缺失时路径会拼成 "undefined/..."。
    let temp_dir = crate::protocol::plain_path(std::env::temp_dir()).join("arbormark");
    let _ = std::fs::create_dir_all(&temp_dir);

    let documents = dirs::document_dir()
        .map(|p| crate::protocol::plain_path(p).to_string_lossy().to_string())
        .unwrap_or_else(|| user_data.to_string_lossy().to_string());
    let home = dirs::home_dir()
        .map(|p| crate::protocol::plain_path(p).to_string_lossy().to_string())
        .unwrap_or_default();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| user_data.to_string_lossy().to_string());

    let settings = app_settings(app);
    let user_language = settings
        .get("userLanguage")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let resolved_locale = crate::locale::resolve_app_locale(Some(&user_language));

    json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "title": "ArborMark",
        "userData": user_data.to_string_lossy(),
        "userDataPath": user_data.to_string_lossy(),
        "tempPath": temp_dir.to_string_lossy(),
        "documentsPath": documents,
        "_documentPath": documents,
        "userPath": home,
        "cwd": cwd,
        "userLocale": resolved_locale,
        "locale": resolved_locale,
        "appLocale": crate::locale::app_locale(&resolved_locale),
        "userLanguage": user_language,
        "platform": std::env::consts::OS,
        "canUseDarkMode": true,
        "hasLicense": true,
        "devVersion": false,
        "zoomFactor": settings.get("zoomFactor").cloned().unwrap_or(Value::Null),
    })
}

/// 创建窗口：直接加载 React 前端（src/web 构建产物 index.html）。
pub fn build(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.set_focus();
        return Ok(existing);
    }

    // 原生标题栏/交通灯显式跟随应用明暗，避免新窗口建出来的第一帧
    // 跟随系统外观（系统暗、应用亮时标题栏会短暂发黑）。
    let app_dark = app
        .try_state::<crate::state::AppState>()
        .map(|state| {
            state.get("isDarkMode").as_bool().unwrap_or(false)
                || state
                    .get("themeMode")
                    .as_str()
                    .map(|mode| mode == "dark")
                    .unwrap_or(false)
        })
        .unwrap_or(false);
    let native_theme = if app_dark { Theme::Dark } else { Theme::Light };

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("ArborMark")
        .theme(Some(native_theme))
        // Windows：无边框，标题栏/菜单栏由前端 HTML 绘制（VS Code 风格）。
        // mac/linux 保留原生标题栏与原生菜单。
        .decorations(!cfg!(target_os = "windows"))
        .inner_size(1200.0, 800.0)
        .min_inner_size(320.0, 240.0)
        // 不指定位置时部分 Windows 多显示器/缩放环境会把窗口放到屏幕外。
        .center()
        .visible(false);
    let window = builder.build()?;
    // 允许把窗口拖得比屏幕更宽（多显示器横跨 / 超宽屏）。
    crate::window_bounds::allow_resize_beyond_screen(&window);
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        state.set_last_focused_window(label);
        let dark = state.get("isDarkMode").as_bool().unwrap_or(false)
            || state
                .get("themeMode")
                .as_str()
                .map(|mode| mode == "dark")
                .unwrap_or(false);
        crate::theme::apply_to_all(app, dark);
        // 恢复上次的页面缩放（原生 ZoomFactor）。
        let factor = state.get("zoomFactor").as_f64().unwrap_or(1.0);
        if factor.is_finite() && factor > 0.0 && (factor - 1.0).abs() > 1e-6 {
            let _ = crate::ipc::window::set_zoom(&window, factor);
        }
    }

    // 窗口销毁后清掉它记录的文档路径，否则同名判断会把已关闭的窗口算进去。
    let handle = app.clone();
    let window_label = label.to_string();
    window.on_window_event(move |event| {
        match event {
            // 关闭握手与保护：未获准关闭（!is_close_allowed）时阻止原生直接
            // 销毁，通过 eval 唤起渲染层的关闭流程；前端处理完（保存/丢弃）
            // 调 app.onCloseWin 放行，取消则调 app.cancelQuit。
            // Windows 平台：真实销毁前统一 remove_menu 保护 muda 全局共享 HMENU。
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let is_allowed = handle
                    .try_state::<crate::state::AppState>()
                    .map(|state| state.is_close_allowed(&window_label))
                    .unwrap_or(false);

                if !is_allowed {
                    api.prevent_close();

                    if let Some(state) = handle.try_state::<crate::state::AppState>() {
                        if state.start_close_flow(&window_label) {
                            if let Some(window) = handle.get_webview_window(&window_label) {
                                let code = r#"(function(){
                                    try {
                                        if (window.File && window.File.megaMenu && window.File.megaMenu.closePreferencePanel) {
                                            window.File.megaMenu.closePreferencePanel();
                                        }
                                    } catch {}
                                    try {
                                        if (typeof window.onbeforeunload === "function") {
                                            window.onbeforeunload();
                                            return;
                                        }
                                    } catch (err) {
                                        console.warn("[close-flow]", err);
                                    }
                                    if (window.JSBridge && window.JSBridge.invoke) {
                                        window.JSBridge.invoke("app.onCloseWin", {
                                            filePath: (window.File && window.File.bundle && window.File.bundle.filePath) || null,
                                            mountFolder: (window.File && typeof window.File.getMountFolder === "function" ? window.File.getMountFolder() : null) || null
                                        });
                                    }
                                })();"#;
                                if let Err(e) = window.eval(code) {
                                    log::warn!("[window] close flow eval failed: {e}, forcing close");
                                    state.set_close_allowed(&window_label, true);
                                    let _ = window.close();
                                }
                            }
                        }
                    }
                } else {
                    if let Some(state) = handle.try_state::<crate::state::AppState>() {
                        state.set_close_allowed(&window_label, false);
                        state.reset_close_flow(&window_label);
                    }
                    if let Some(window) = handle.get_webview_window(&window_label) {
                        let _ = window.remove_menu();
                    }
                }
            }
            tauri::WindowEvent::Focused(focused) => {
                if *focused {
                    if let Some(state) = handle.try_state::<crate::state::AppState>() {
                        state.set_last_focused_window(&window_label);
                    }
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Some(state) = handle.try_state::<crate::state::AppState>() {
                    state.set_target_file(&window_label, None);
                    state.set_close_allowed(&window_label, false);
                    state.reset_close_flow(&window_label);
                    state.clear_last_focused_window(&window_label);
                }
            }
            // 文件被拖到未激活的窗口上时主动激活它：macOS 不会因为拖放自动
            // 把后台窗口提到前台，随后的提示框会建在用户看不到的窗口里。
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Enter { .. }) => {
                if let Some(window) = handle.get_webview_window(&window_label) {
                    if !window.is_focused().unwrap_or(true) {
                        log::info!("[window] 拖入未激活窗口，先激活 {window_label}");
                        let _ = window.set_focus();
                    }
                }
            }
            _ => {}
        }
    });

    // 不要在 WebView 还没画好时就把窗口显示出来：由渲染层在初始化完成后
    // 调用 `app.rendererReady` 再显示；这里留 3 秒兜底，避免渲染层异常时
    // 窗口永远不出现。
    {
        let fallback = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let _ = fallback.show();
            std::thread::sleep(std::time::Duration::from_millis(80));
            let _ = fallback.set_focus();
        });
    }
    Ok(window)
}


/// 在新窗口加载完成后切换文档。
///
/// 渲染层就绪上报 `app.rendererReady` 时，menuBridge 的
/// `File.editor.library.doSwitchByNode` 已安装；窗口创建时只把目标文档丢进
/// `AppState::pending_switch`，由就绪回调切一次。
pub fn flush_pending_switch(app: &AppHandle, window: &WebviewWindow) {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let Some(path) = state.take_pending_switch(window.label()) else {
        return;
    };
    let Ok(literal) = serde_json::to_string(&path) else {
        return;
    };
    let script = format!(
        "try {{ if (typeof window.__arborOpenPath === 'function') {{ window.__arborOpenPath({literal}); }} else if (window.File && File.editor && File.editor.library) {{ File.editor.library.doSwitchByNode({literal}); }} else {{ window.__pendingArborOpen = {literal}; }} }} catch (e) {{ console.warn('[switch] ' + e); }}"
    );
    log::debug!("[window] 就绪后切文档 {} -> {path}", window.label());
    let _ = window.eval(&script);
}

/// 创建打印视图窗口：加载 `arbormark://app/tempfile/<name>`。
///
/// 导出流程把要打印的 HTML 写到 tempPath，再由这里加载并调用 `print()`；
/// 打印页是自包含的静态 HTML，不需要任何注入。
pub fn build_print_view(app: &AppHandle, label: &str, url: &str) -> Result<WebviewWindow, String> {
    let parsed = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(app, label, WebviewUrl::CustomProtocol(parsed))
        .title("ArborMark")
        .inner_size(900.0, 1200.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}