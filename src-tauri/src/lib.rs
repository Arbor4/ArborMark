//! ArborMark Tauri 后端装配入口。
//!
//! 1. 初始化数据目录与运行时状态；
//! 2. 创建主窗口（直接加载 src/web 前端）；
//! 3. 注册 IPC 分发命令与原生菜单。

mod diagnostics;
mod fs_ipc;
mod ipc;
mod locale;
mod menu;
mod paths;
mod protocol;
mod startup;
mod state;
mod theme;
mod window_bounds;
mod windows;

use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;

use state::AppState;

static PENDING_OPENED_URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 获取冷启动阶段（包括访达双击 / open -a / 命令行）传入的文件路径
pub fn pending_opened_file() -> Option<String> {
    let guard = PENDING_OPENED_URLS.lock().unwrap_or_else(|e| e.into_inner());
    guard.first().cloned()
}

/// 启动失败时弹出原生对话框并退出。
///
/// Windows 是 GUI 子系统，没有控制台；如果 WebView2 缺失/损坏，Tauri 的
/// `setup` 返回 Err 后进程会静默退出，用户只会看到"点了没反应"。
fn fail_startup(app: &tauri::AppHandle, title: &str, message: &str) {
    diagnostics::log(&format!("FATAL {title}: {message}"));
    log::error!("[startup] {title}: {message}");
    let text = format!("{message}\n\n诊断日志：{}", diagnostics::path().display());
    diagnostics::native_error(title, &text);
    app.exit(1);
}

/// MCP 调试桥：只在 debug 构建里注册，release 完全不存在。
#[cfg(debug_assertions)]
fn with_mcp_bridge(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_mcp_bridge::init())
}

#[cfg(not(debug_assertions))]
fn with_mcp_bridge(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    diagnostics::init();
    diagnostics::log("run: starting");
    diagnostics::log(&format!("run: args={:?}", std::env::args().collect::<Vec<_>>()));

    with_mcp_bridge(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .register_uri_scheme_protocol("arbormark", |_ctx, request| {
            let (status, mime, body) = protocol::resolve(request.uri().path());
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .header("Cache-Control", "no-cache")
                .body(std::borrow::Cow::Owned(body))
                .expect("build arbormark:// response")
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // ARBORMARK_DATA_DIR 可覆盖数据目录（便携模式 / 测试用）。
            let preferred = std::env::var_os("ARBORMARK_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    handle
                        .path()
                        .app_data_dir()
                        .unwrap_or_else(|_| std::env::temp_dir().join("arbormark"))
                });

            // 数据目录不可写时（只读沙箱、权限异常）不要直接崩掉，
            // 退回到临时目录并把原因写进日志。
            let data_dir = match std::fs::create_dir_all(&preferred) {
                Ok(()) => preferred,
                Err(err) => {
                    log::error!(
                        "[setup] 无法创建数据目录 {}: {err}，改用临时目录",
                        preferred.display()
                    );
                    diagnostics::log(&format!(
                        "setup: 数据目录不可写 {}: {err}，改用临时目录",
                        preferred.display()
                    ));
                    let fallback = std::env::temp_dir().join("arbormark");
                    if let Err(fallback_err) = std::fs::create_dir_all(&fallback) {
                        fail_startup(
                            &handle,
                            "ArborMark 启动失败",
                            &format!("无法创建数据目录：{err}\n备用目录也失败：{fallback_err}"),
                        );
                        return Ok(());
                    }
                    fallback
                }
            };
            protocol::set_data_root(data_dir.clone());
            diagnostics::log(&format!("setup: data_dir={}", data_dir.display()));

            app.manage(AppState::new(data_dir.clone()));

            // 原生菜单栏/标题栏的明暗由系统绘制：必须在创建菜单之前把进程级偏好
            // 设好，否则菜单会先用亮色画一遍。
            {
                let state = app.state::<AppState>();
                let dark = state.get("isDarkMode").as_bool().unwrap_or(false)
                    || state
                        .get("themeMode")
                        .as_str()
                        .map(|mode| mode == "dark")
                        .unwrap_or(false);
                theme::apply_app_mode(dark);
            }

            // 菜单失败不应让整个应用无法启动：Windows 上个别快捷键/角色
            // 可能不被系统支持，宁可少一个菜单项也要先让窗口显示出来。
            // Windows 走自定义 HTML 标题栏菜单（web 端 menu.dump 渲染），不建原生菜单栏。
            #[cfg(target_os = "windows")]
            let menu_result: tauri::Result<()> = Ok(());
            #[cfg(not(target_os = "windows"))]
            let menu_result = menu::install(&handle);
            if let Err(err) = menu_result {
                diagnostics::log(&format!("setup: menu install failed: {err}"));
                log::error!("[setup] 菜单安装失败（继续启动）: {err}");
            } else {
                #[cfg(not(target_os = "windows"))]
                diagnostics::log("setup: menu installed");
                #[cfg(target_os = "windows")]
                diagnostics::log("setup: native menu skipped (custom html titlebar)");
            }

            // 命令行传入或 macOS 访达双击传入文件时启动即打开（`ArborMark ~/notes/a.md`），
            // 此时不再恢复上次会话，避免刚双击的文件被旧会话覆盖。
            let initial_file = pending_opened_file().or_else(startup::launch_file);

            let restore_target = if initial_file.is_some() {
                None
            } else {
                startup::boot(&app.state::<AppState>())
            };

            let target_to_open = initial_file.or(restore_target);

            // 先把"要打开/恢复的文档"挂到 state 上，再建窗口：渲染层的 ready 回调不会
            // 在建窗口之前到，顺序不会反过来。
            if let Some(target) = target_to_open.as_deref() {
                app.state::<AppState>().set_pending_switch("main", target);
            }

            match windows::build(&handle, "main") {
                Ok(window) => window,
                Err(err) => {
                    let err_str = err.to_string();
                    let hint = if err_str.contains("0x800700AA")
                        || err_str.contains("资源在使用中")
                        || err_str.contains("in use")
                    {
                        "检测到已有 ArborMark 正在运行中（WebView2 数据目录被独占占用）。\n请切换到已打开的应用窗口，或在任务管理器中结束 ArborMark 进程后再试。"
                    } else {
                        "如果提示 WebView2 缺失，请安装 Microsoft Edge WebView2 Runtime 后重试。"
                    };
                    fail_startup(
                        &handle,
                        "ArborMark 无法打开窗口",
                        &format!("创建主窗口失败：{err}\n\n{hint}"),
                    );
                    return Ok(());
                }
            };
            diagnostics::log("setup: main window created");
            if let Some(ref target) = target_to_open {
                app.state::<AppState>().set_target_file("main", Some(target.clone()));
            }

            // 调试/联调用：ARBORMARK_EVAL 在窗口就绪后执行一段 JS。
            if let Ok(code) = std::env::var("ARBORMARK_EVAL") {
                if !code.trim().is_empty() {
                    let runner = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(2600));
                        if let Some(window) = runner.get_webview_window("main") {
                            log::info!("[eval] 执行注入脚本");
                            let _ = window.eval(&code);
                        }
                    });
                }
            }

            // 双重保险：1.5 秒后若前端未就绪或未切到文档，再次确认打开 initial_file
            if let Some(file) = target_to_open {
                let opener = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if let Some(window) = opener.get_webview_window("main") {
                        if let Ok(literal) = serde_json::to_string(&file) {
                            let _ = window.eval(&format!(
                                "if (typeof window.__arborOpenPath === 'function') {{ window.__arborOpenPath({literal}); }}"
                            ));
                        }
                    }
                });
            }

            Ok(())
        })
        // 弹出菜单点击 -> 执行渲染层给出的 clickCode（旧主进程的等价行为）
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };

            // 1) 渲染层驱动的弹出菜单：动作与窗口一一对应
            if let Some((label, code)) = state.take_menu_action(id) {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.eval(&code);
                }
                return;
            }

            // 2) 业务菜单：命令与窗口无关，作用于当前聚焦窗口
            if let Some(code) = state.menu_command(id) {
                let focused = app
                    .webview_windows()
                    .into_iter()
                    .find(|(_, window)| window.is_focused().unwrap_or(false))
                    .map(|(_, window)| window)
                    .or_else(|| app.get_webview_window("main"));
                if let Some(window) = focused {
                    log::debug!("[menu] 执行 {id} -> {}", window.label());
                    let _ = window.eval(&code);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ipc::ipc_invoke,
            fs_ipc::fs_read_bytes,
            fs_ipc::fs_read_bytes_sync,
            fs_ipc::fs_read_text,
            fs_ipc::fs_stat_many,
            fs_ipc::fs_read_text_many,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ArborMark")
        .run(|app, event| {
            let _ = &app; // app 仅在 macOS 的 Opened 分支中使用
            match &event {
                // RunEvent::Opened 仅存在于 macOS；Windows/Linux 通过 argv/单实例转发打开文件
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    diagnostics::log(&format!("run: Opened urls={urls:?}"));
                    handle_opened(app, urls.clone());
                }
                tauri::RunEvent::Ready => {
                    diagnostics::log("run: Ready");
                }
                _ => {}
            }
        });
}

/// 系统「打开文件」事件：第一个文件交给主窗口，其余派生新窗口。
///
/// 冷启动时事件先于渲染层就绪到达：把路径挂到 target_file，前端启动流程
/// 经 `app.launchFile` 消费；热启动（应用已在运行）直接 eval 前端入口打开并 emit 事件。
#[cfg(target_os = "macos")]
fn handle_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let paths: Vec<String> = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .filter(|path| std::path::Path::new(path).is_file())
        .collect();
    if paths.is_empty() {
        return;
    }
    diagnostics::log(&format!("handle_opened: paths={paths:?}"));
    {
        let mut guard = PENDING_OPENED_URLS.lock().unwrap_or_else(|e| e.into_inner());
        guard.extend(paths.clone());
    }
    let state_opt = app.try_state::<AppState>();
    for (index, path) in paths.iter().enumerate() {
        diagnostics::log(&format!("opened: {path}"));
        if index == 0 {
            if let Some(ref state) = state_opt {
                state.set_target_file("main", Some(path.clone()));
                state.set_pending_switch("main", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                if let Ok(literal) = serde_json::to_string(path) {
                    let _ = window.eval(&format!(
                        "if (typeof window.__arborOpenPath === 'function') {{ window.__arborOpenPath({literal}); }} else {{ window.__pendingArborOpen = {literal}; }}"
                    ));
                }
                let _ = window.emit("open-file", path);
            }
        } else if let Some(ref state) = state_opt {
            if let Err(err) =
                ipc::document::new_window(app, state, &serde_json::json!({ "filePath": path }))
            {
                log::error!("[opened] 新窗口打开 {path} 失败: {err}");
            }
        }
    }
}
