//! 导出相关通道（打印 / PDF / 长图）。
//!
//! Electron 依赖 `webContents.printToPDF` 与隐藏窗口，Tauri 侧按平台拆开：
//!   - 打印：把导出 HTML 放进独立窗口，调用系统打印对话框
//!     （macOS 可在对话框里选择"存储为 PDF"）；
//!   - PDF：Windows 用 WebView2 的 `ICoreWebView2_7::PrintToPdf` 直出文件，
//!     和 Electron 是同一套 Chromium 排版引擎；其它平台没有等价 API，
//!     返回错误三元组，渲染层会回落成打印对话框。

use serde_json::{json, Value};

pub fn handle(channel: &str, _payload: &Value) -> Result<Value, String> {
    log::warn!("[export] 通道尚未迁移: {channel}");
    Ok(Value::Null)
}

/// `export.printToPDF`
///
/// 渲染层按 `invoke("export.printToPDF", tempFilePath, options)` 调用，并把结果
/// 解构成 `[pdfData, styleJson, errorMsg]`。Electron 的 `pdfData` 是 PDF Buffer；
/// 这里返回**临时文件路径**——几 MB 的二进制塞进 IPC 会膨胀成等量级的 JSON
/// 数字数组，直接读文件便宜得多。渲染层的 `toPdfBuffer()` 负责读成 Buffer
/// 并删掉临时文件。
///
/// 状态码约定：成功 `[路径, null, null]`；失败 `[null, null, 错误文案]`。
/// 失败也返回三元组而不是 `Err`，是为了让渲染层走它自己写好的
/// `if (!pdfData) reject(...)` 分支，而不是抛一个 IPC 异常。
pub async fn print_to_pdf(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        return match windows_pdf::render(app, state, payload).await {
            Ok(path) => Ok(json!([path, Value::Null, Value::Null])),
            Err(err) => {
                log::warn!("[export] printToPDF 失败: {err}");
                Ok(json!([Value::Null, Value::Null, err]))
            }
        };
    }

    #[cfg(target_os = "macos")]
    {
        return match macos_pdf::render(app, state, payload).await {
            Ok(path) => Ok(json!([path, Value::Null, Value::Null])),
            Err(err) => {
                log::warn!("[export] printToPDF 失败: {err}");
                Ok(json!([Value::Null, Value::Null, err]))
            }
        };
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, state, payload);
        log::warn!("[export] printToPDF 在当前平台不可用（没有 webContents.printToPDF 的等价 API）");
        Ok(json!([
            Value::Null,
            Value::Null,
            "PDF export is not supported on this platform. Use Print and choose \"Save as PDF\"."
        ]))
    }
}

// ---------------------------------------------------------------------------
// 打印视图：把导出用的临时 HTML 放进独立窗口，再用系统打印对话框输出
// （macOS 的打印对话框里可以选择"存储为 PDF"）。
// ---------------------------------------------------------------------------

use std::path::Path;

fn payload_strings(payload: &Value) -> Vec<String> {
    if let Some(items) = payload.as_array() {
        return items.iter().filter_map(Value::as_str).map(str::to_string).collect();
    }
    payload
        .as_str()
        .map(|value| vec![value.to_string()])
        .unwrap_or_default()
}

/// `export.genPrintView(tempFilePath, activePrintView)`
pub fn gen_print_view(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    use tauri::Manager;

    let args = payload_strings(payload);
    let Some(temp_file) = args.first() else {
        return Ok(Value::Null);
    };

    // 关掉上一份打印视图
    if let Some(previous) = state.print_view() {
        if let Some(window) = app.get_webview_window(&previous) {
            let _ = window.close();
        }
    }

    let name = Path::new(temp_file)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "invalid temp file".to_string())?;

    let seq = state.next_window_seq();
    let label = format!("print-{seq}");
    let url = format!("arbormark://app/tempfile/{}", name);

    crate::windows::build_print_view(app, &label, &url)?;
    state.set_print_view(Some(label.clone()));
    Ok(json!(label))
}

/// `export.print(printView, options)`：优先打印打印视图，否则打印调用方窗口。
pub fn print(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    caller: &tauri::WebviewWindow,
) -> Result<Value, String> {
    use tauri::Manager;

    let target = state
        .print_view()
        .and_then(|label| app.get_webview_window(&label));

    match target {
        Some(window) => {
            // 隐藏窗口在部分平台上无法直接打印，先显示再打印
            let _ = window.show();
            let _ = window.set_focus();
            window.print().map_err(|e| e.to_string())?;
        }
        None => {
            caller.print().map_err(|e| e.to_string())?;
        }
    }
    Ok(Value::Null)
}

/// `export.destroyPrintView(printView)`
///
/// 打印视图和长图用的捕获视图都走这个通道收尾（渲染层的 `releaseCaptureWin`
/// 把 `captureWindowId` 传给的就是它）。
pub fn destroy_print_view(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    use tauri::Manager;

    let view_id = payload_strings(payload).first().cloned();

    if let Some(label) = view_id.as_deref().and_then(|id| state.take_capture_view(id)) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }

    if let Some(label) = state.print_view() {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        state.set_print_view(None);
    }
    Ok(Value::Null)
}

// ---------------------------------------------------------------------------
// 长图导出：隐藏视图分段截图
//
// 渲染层的契约（pdf-export.js 的 exportToImage）：
//   prepareImageCapture(filePath, {imageWidth, quality})
//     -> { winId, totalHeight, pageHeight, scale } 或 null
//   captureImage(winId, yOffset, {imageWidth, pageHeight, quality})
//     -> JSON 字符串 "{ newScrollHeight, data: \"data:image/png;base64,...\" }"
// 图片本身由渲染层的 image-worker 拼接成 PNG/JPEG，Rust 侧只负责出图。
// ---------------------------------------------------------------------------

/// 一次装载最多渲染多高。Electron 版也是分段截取：
/// WebView 的渲染面尺寸有限，一次把整页撑开既慢又容易失败。
const IMAGE_CHUNK_HEIGHT: f64 = 4096.0;

pub async fn prepare_image_capture(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        return windows_capture::prepare(app, state, payload).await;
    }

    #[cfg(target_os = "macos")]
    {
        return macos_capture::prepare(app, state, payload).await;
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, state, payload);
        log::warn!("[export] 长图导出当前平台没有等价 API");
        Ok(Value::Null)
    }
}

pub async fn capture_image(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        return windows_capture::grab(app, state, payload).await;
    }

    #[cfg(target_os = "macos")]
    {
        return macos_capture::grab(app, state, payload).await;
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, state, payload);
        Ok(Value::Null)
    }
}

/// `controller.screenshotHTML`：HTML → PNG 临时文件（路径字符串）。
pub async fn screenshot_html(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        return windows_capture::screenshot_html(app, state, payload).await;
    }

    #[cfg(target_os = "macos")]
    {
        return macos_capture::screenshot_html(app, state, payload).await;
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, state, payload);
        log::warn!("[export] screenshotHTML 在当前平台没有等价 API");
        Ok(Value::Null)
    }
}

/// 测量整页高度：隐藏滚动条后取 clientHeight / scrollHeight 的最大值，
/// 与 Electron 版 `CAPTURE_STYLE_SCRIPT` 的做法一致。
const MEASURE_SCRIPT: &str = r#"(() => {
    const style = document.createElement("style");
    style.textContent = "html,body{overflow:hidden !important}";
    document.head.appendChild(style);
    document.body.parentElement.scrollTop = document.body.clientHeight;
    const root = document.body.parentElement;
    return Math.max(document.body.clientHeight, root.scrollHeight, root.clientHeight);
})()"#;

#[cfg_attr(not(windows), allow(dead_code))]
fn scroll_script(offset: f64, height: f64) -> String {
    format!(
        r#"(async () => {{
            const deadline = Date.now() + 2000;
            while (window.innerHeight < {height} && Date.now() < deadline) {{
                await new Promise((r) => requestAnimationFrame(r));
            }}
            const root = document.body.parentElement;
            root.scrollTop = {offset};
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return Math.max(document.body.clientHeight, root.scrollHeight, root.clientHeight);
        }})()"#
    )
}

fn number_or(options: &Value, key: &str, fallback: f64) -> f64 {
    options.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}

fn parse_number(text: String) -> f64 {
    if let Ok(value) = serde_json::from_str::<Value>(&text) {
        if let Some(num) = value.as_f64().or_else(|| value.as_str()?.parse::<f64>().ok()) {
            return num;
        }
    }
    text.trim().parse::<f64>().unwrap_or(0.0)
}

#[cfg(windows)]
mod windows_capture {
    use std::path::PathBuf;
    use std::ptr::null_mut;
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::Manager;
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};
    use webview2_com::CapturePreviewCompletedHandler;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream};
    use windows::Win32::System::Com::IStream;
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    use super::{IMAGE_CHUNK_HEIGHT, MEASURE_SCRIPT, number_or, parse_number, scroll_script};

    /// 在 WebView2 里执行脚本并把返回值（JSON 字符串）取回来。
    ///
    /// Tauri 的 `WebviewWindow::eval` 是发后不理的；而分段截图必须知道"滚动完成了没"，
    /// 靠 sleep 猜时机既不可靠又慢。`ICoreWebView2::ExecuteScript` 自带完成回调，
    /// 正好用得上。
    async fn eval(window: &WebviewWindow, script: &str) -> Result<String, String> {
        use windows::core::PCWSTR;
        use webview2_com::ExecuteScriptCompletedHandler;

        let (tx, mut rx) = tauri::async_runtime::channel::<Result<String, String>>(1);
        let script = script.to_string();
        let label = window.label().to_string();
        window
            .with_webview(move |webview| {
                let core = match unsafe { webview.controller().CoreWebView2() } {
                    Ok(core) => core,
                    Err(err) => {
                        let _ = tx.blocking_send(Err(format!("取不到 CoreWebView2：{err}")));
                        return;
                    }
                };
                let handler = ExecuteScriptCompletedHandler::create(Box::new(
                    move |result: windows::core::Result<()>, value: String| {
                        let outcome = match result {
                            Ok(()) => Ok(value),
                            Err(err) => Err(format!("ExecuteScript 失败：{err}")),
                        };
                        let _ = tx.blocking_send(outcome);
                        Ok(())
                    },
                ));
                let wide: Vec<u16> = script.encode_utf16().chain(std::iter::once(0)).collect();
                if let Err(err) = unsafe { core.ExecuteScript(PCWSTR(wide.as_ptr()), &handler) } {
                    log::warn!("[export] ExecuteScript 发起失败: {err}");
                }
            })
            .map_err(|err| format!("with_webview 失败（{label}）：{err}"))?;

        match rx.recv().await {
            Some(result) => result,
            None => Err("ExecuteScript 回调没有回来".to_string()),
        }
    }

    /// `export.prepareImageCapture`
    pub(super) async fn prepare(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<Value, String> {
        let items = payload.as_array().cloned().unwrap_or_default();
        let head = items.first().cloned().unwrap_or(Value::Null);
        let file_path = head
            .as_str()
            .or_else(|| payload.as_str())
            .unwrap_or_default()
            .to_string();
        let options = items.get(1).cloned().unwrap_or(Value::Null);

        if file_path.is_empty() {
            return Ok(Value::Null);
        }
        let source = PathBuf::from(&file_path);
        if !source.is_file() {
            log::warn!("[export] prepareImageCapture 找不到临时文件：{file_path}");
            return Ok(Value::Null);
        }
        let url = tauri::Url::from_file_path(&source)
            .map_err(|_| format!("临时文件路径无法转成 URL：{file_path}"))?;

        let image_width = number_or(&options, "imageWidth", 640.0).max(1.0);
        let quality = number_or(&options, "quality", 0.0);

        let label = format!("capture-{}", state.next_window_seq());
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<f64, String>>(1);

        // 看门狗：页面加载/测量脚本一旦不回调，下面的 `rx.recv()` 会永远等下去，
        // 截图窗口就留在那儿（用户看到的是"弹出一个关不掉的窗口"），渲染层也一直
        // 停在「Exporting...」。20 秒还没量出高度就按失败收场。
        {
            let watchdog = tx.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                let _ = watchdog.blocking_send(Err("测量页面高度超时".to_string()));
            });
        }

        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title("ArborMark")
            .inner_size(image_width, 720.0)
            .position(-32000.0, 0.0)
            .decorations(false)
            // 截图必须发生在**可见**窗口上（WebView2 的 CapturePreview 对隐藏窗口
            // 出白图），但用户不该看到它：移出屏幕 + 不进任务栏 + 不抢焦点。
            .skip_taskbar(true)
            .focused(false)
            .visible(true)
            .on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let tx = tx.clone();
                // 等字体加载、插图解码结束再量：这些都会改变页面高度，
                // 抢在前面量出来的是排完版之前的旧值。
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(350));
                    let outcome = tauri::async_runtime::block_on(async move {
                        Ok::<f64, String>(parse_number(eval(&window, MEASURE_SCRIPT).await?))
                    });
                    let _ = tx.blocking_send(outcome);
                });
            })
            .build()
            .map_err(|err| err.to_string())?;

        let scale = window.scale_factor().unwrap_or(1.0);
        let total_height = match rx.recv().await {
            Some(Ok(height)) => height,
            Some(Err(err)) => {
                log::warn!("[export] 测量页面高度失败: {err}");
                let _ = window.close();
                return Ok(Value::Null);
            }
            None => {
                let _ = window.close();
                return Ok(Value::Null);
            }
        };

        if total_height <= 0.0 {
            let _ = window.close();
            return Ok(Value::Null);
        }

        state.register_capture_view(label.clone(), label.clone());
        Ok(json!({
            "winId": label,
            "totalHeight": total_height,
            "pageHeight": IMAGE_CHUNK_HEIGHT,
            "scale": scale,
            "quality": quality,
        }))
    }

    /// `export.captureImage`
    pub(super) async fn grab(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<Value, String> {
        let items = payload.as_array().cloned().unwrap_or_default();
        let win_id = items.first().and_then(Value::as_str).unwrap_or_default().to_string();
        let offset = items
            .get(1)
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0);
        let options = items.get(2).cloned().unwrap_or(Value::Null);

        let Some(label) = state.capture_view(&win_id) else {
            log::warn!("[export] captureImage 找不到视图 {win_id}");
            return Ok(Value::Null);
        };
        let Some(window) = app.get_webview_window(&label) else {
            return Ok(Value::Null);
        };

        let width = number_or(&options, "imageWidth", 640.0).max(1.0);
        let height = number_or(&options, "pageHeight", IMAGE_CHUNK_HEIGHT).max(1.0);

        // WebView 的可视区比窗口尺寸多出一圈（滚动条/边框），直接按请求高度截取会
        // 让每段多出几十像素，拼起来就重复一条。先量一次实际可视区，把差值补回去，
        // 而不是把某个魔法像素写死在这里。
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|err| err.to_string())?;
        let mut viewport = parse_number(eval(&window, "String(window.innerHeight)").await?);
        let overshoot = viewport - height;
        if overshoot.abs() >= 1.0 {
            let corrected = (height - overshoot).max(1.0);
            window
                .set_size(tauri::LogicalSize::new(width, corrected))
                .map_err(|err| err.to_string())?;
            viewport = parse_number(eval(&window, "String(window.innerHeight)").await?);
        }

        let new_scroll_height = match eval(&window, &scroll_script(offset, viewport)).await {
            Ok(text) => parse_number(text),
            Err(err) => {
                log::warn!("[export] 滚动到 {offset} 失败: {err}");
                return Ok(Value::Null);
            }
        };

        let png = capture_frame(&window)?;
        use base64::Engine as _;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&png);
        Ok(json!(format!(
            "{{\"newScrollHeight\":{}, \"data\":\"data:image/png;base64,{encoded}\"}}",
            new_scroll_height
        )))
    }

    /// 抓当前可视区的一帧，返回 PNG 字节。
    ///
    /// WebView2 的 `CapturePreview` 只对**可见**窗口出内容，所以这个窗口是"可见
    /// 但移出屏幕"——`visible(false)` 的窗口会给出空白图。
    fn capture_frame(window: &WebviewWindow) -> Result<Vec<u8>, String> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();
        window
            .with_webview(move |webview| {
                if let Err(err) = start_capture(&webview, tx.clone()) {
                    let _ = tx.send(Err(err));
                }
            })
            .map_err(|err| err.to_string())?;

        rx.recv_timeout(Duration::from_secs(30))
            .map_err(|_| "等待 WebView2 截图回调超时".to_string())?
    }

    /// 只负责发起，不阻塞：`CapturePreview` 的结果由完成回调送回。
    fn start_capture(
        webview: &tauri::webview::PlatformWebview,
        done: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
    ) -> Result<(), String> {
        use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;

        let core = unsafe { webview.controller().CoreWebView2() }.map_err(|err| err.to_string())?;
        // 截图结果写进这段 COM 流；第二个参数为 true 表示流释放时连带释放内存。
        let stream: IStream =
            unsafe { CreateStreamOnHGlobal(HGLOBAL(null_mut()), true) }.map_err(|err| err.to_string())?;

        let readback = stream.clone();
        let handler = CapturePreviewCompletedHandler::create(Box::new(
            move |result: windows::core::Result<()>| {
                let outcome = match result {
                    Ok(()) => drain_stream(&readback),
                    Err(err) => Err(err.to_string()),
                };
                let _ = done.send(outcome);
                Ok(())
            },
        ));

        unsafe { core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler) }
            .map_err(|err| err.to_string())
    }

    /// 把 HGLOBAL 底流里的字节拷出来。空Lock/空流都按失败处理，
    /// 否则后面会把一段空字节当成图交给渲染层。
    fn drain_stream(stream: &IStream) -> Result<Vec<u8>, String> {
        unsafe {
            let handle = GetHGlobalFromStream(stream).map_err(|err| err.to_string())?;
            let pointer = GlobalLock(handle) as *const u8;
            if pointer.is_null() {
                return Err("截图流没有内容".to_string());
            }
            let bytes = std::slice::from_raw_parts(pointer, GlobalSize(handle)).to_vec();
            let _ = GlobalUnlock(handle);
            Ok(bytes)
        }
    }

    /// `controller.screenshotHTML({html, rect})`：把一段 HTML 渲染成 PNG，返回临时文件路径。
    ///
    /// 渲染层（media-op.js:314）拿路径后写剪贴板或 moveFile 到最终位置。
    /// 复用长图导出的离屏捕获窗口：写临时 html → file:// 加载 → PageLoad 后整页一帧。
    pub(super) async fn screenshot_html(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<Value, String> {
        let html = payload
            .get("html")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if html.is_empty() {
            return Ok(Value::Null);
        }
        let rect = payload.get("rect").cloned().unwrap_or_else(|| json!({}));
        let width = number_or(&rect, "width", 800.0).max(1.0);
        let height = number_or(&rect, "height", 600.0).max(1.0);

        let temp_dir = std::env::temp_dir().join("arbormark");
        std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let html_path = temp_dir.join(format!(
            "shot-{}.html",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
        std::fs::write(&html_path, html).map_err(|e| e.to_string())?;
        let url = tauri::Url::from_file_path(&html_path)
            .map_err(|_| "临时 HTML 无法转成 URL".to_string())?;

        let label = format!("shot-{}", state.next_window_seq());
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), String>>(1);
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title("ArborMark")
            .inner_size(width, height)
            .position(-32000.0, 0.0)
            .decorations(false)
            .visible(true)
            .on_page_load(move |window, load| {
                if load.event() != PageLoadEvent::Finished {
                    return;
                }
                let tx = tx.clone();
                std::thread::spawn(move || {
                    // 与长图导出一致：给字体/插图解码留出余量再截图。
                    std::thread::sleep(Duration::from_millis(350));
                    let _ = tx.blocking_send(Ok(()));
                    let _ = window;
                });
            })
            .build()
            .map_err(|err| err.to_string())?;

        let load_result = rx.recv().await;
        let outcome = (|| -> Result<Value, String> {
            match load_result {
                Some(Ok(())) => {}
                other => return Err(format!("截图窗口加载异常: {other:?}")),
            }
            let png = capture_frame(&window)?;
            let png_path = temp_dir.join(format!(
                "shot-{}.png",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ));
            std::fs::write(&png_path, &png).map_err(|e| e.to_string())?;
            Ok(json!(png_path.to_string_lossy()))
        })();

        let _ = window.close();
        let _ = std::fs::remove_file(&html_path);
        outcome
    }
}

// ---------------------------------------------------------------------------
// PDF 渲染：WebView2 的 `ICoreWebView2_7::PrintToPdf`
//
// 渲染层已经把导出用的 HTML 写到 tempPath 了（分页、锚点、主题样式都在里面），
// 这里只需要一个隐藏窗口把它排版出来并打印到文件。页眉页脚合成、大纲注入
// 仍然由渲染层的 pdf-lib 做，和 Electron 时期完全一样。
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod windows_pdf {
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use serde_json::Value;
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_7, ICoreWebView2Environment6};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, PCWSTR};

    /// 纸张尺寸（英寸），取值与 `pages/local-setting` 的 `paperSize` 对齐。
    fn paper_size(name: &str) -> Option<(f64, f64)> {
        match name {
            "A4" => Some((8.2677, 11.6929)),
            "A3" => Some((11.6929, 16.5354)),
            "A5" => Some((5.8268, 8.2677)),
            "Letter" => Some((8.5, 11.0)),
            "Legal" => Some((8.5, 14.0)),
            "Tabloid" => Some((11.0, 17.0)),
            _ => None,
        }
    }

    #[derive(Clone, Debug)]
    struct PrintOptions {
        width: f64,
        height: f64,
        /// 上 / 下 / 左 / 右，单位英寸
        margins: [f64; 4],
        backgrounds: bool,
    }

    impl Default for PrintOptions {
        fn default() -> Self {
            // 与 `pdf-export.js` 的默认值一致：A4 + 16mm 页边距。
            Self {
                width: 8.2677,
                height: 11.6929,
                margins: [0.6299; 4],
                backgrounds: true,
            }
        }
    }

    impl PrintOptions {
        /// 入参就是 Electron `printToPDF` 的选项形状：
        /// `{ printBackground, margins: {top,bottom,left,right}, pageSize: "A4" | {width,height} }`，
        /// 其中长度单位统一是英寸（`pdf-export.js` 已经换算过）。
        fn from_value(options: &Value) -> Self {
            let mut parsed = Self::default();

            match options.get("pageSize") {
                Some(Value::String(name)) => {
                    if let Some((width, height)) = paper_size(name) {
                        parsed.width = width;
                        parsed.height = height;
                    }
                }
                Some(Value::Object(size)) => {
                    if let Some(width) = size.get("width").and_then(Value::as_f64) {
                        parsed.width = width;
                    }
                    if let Some(height) = size.get("height").and_then(Value::as_f64) {
                        parsed.height = height;
                    }
                }
                _ => {}
            }

            if let Some(margins) = options.get("margins") {
                for (index, key) in ["top", "bottom", "left", "right"].iter().enumerate() {
                    if let Some(value) = margins.get(*key).and_then(Value::as_f64) {
                        parsed.margins[index] = value;
                    }
                }
            }

            if let Some(backgrounds) = options.get("printBackground").and_then(Value::as_bool) {
                parsed.backgrounds = backgrounds;
            }

            parsed
        }
    }

    /// 渲染层的 `invoke(channel, tempFilePath, options)` 会变成一个二元数组。
    fn split_payload(payload: &Value) -> (String, Value) {
        if let Some(items) = payload.as_array() {
            return (
                crate::paths::native(items.first().and_then(Value::as_str).unwrap_or_default()),
                items.get(1).cloned().unwrap_or(Value::Null),
            );
        }
        (
            crate::paths::native(payload.as_str().unwrap_or_default()),
            Value::Null,
        )
    }

    pub(super) async fn render(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<String, String> {
        let (temp_file, options) = split_payload(payload);
        let source = PathBuf::from(&temp_file);
        if !source.is_file() {
            return Err(format!("找不到待导出的临时文件：{temp_file}"));
        }

        // 导出页的主题 CSS / 插图都是 `file://` 绝对路径（`export.js` 在
        // forPrint 下只产出 link 标签，不做内联），所以打印视图必须从 file://
        // 打开：换成 `http://arbormark.localhost` 会让这些子资源全部被跨源挡掉，
        // 出来就是一张没有样式的白页。
        let url = tauri::Url::from_file_path(&source)
            .map_err(|_| format!("临时文件路径无法转成 URL：{temp_file}"))?;

        let output_dir = std::env::temp_dir().join("arbormark");
        std::fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
        let output = output_dir.join(format!("pdf-{}.pdf", uuid::Uuid::new_v4()));

        let label = format!("pdf-{}", state.next_window_seq());
        let settings = PrintOptions::from_value(&options);
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), String>>(1);

        let window = {
            let output = output.clone();
            let tx = tx.clone();
            WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
                .title("ArborMark")
                .inner_size(900.0, 1200.0)
                .visible(false)
                .on_page_load(move |window, payload| {
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    let output = output.clone();
                    let settings = settings.clone();
                    let tx = tx.clone();
                    // 页面加载回调跑在 UI 线程上，这里只能「发起」打印：结果要等
                    // COM 完成回调，关窗口和等待一律交给独立线程，否则主线程的
                    // 消息泵被堵住，回调永远送不回来。
                    std::thread::spawn(move || {
                        // 首帧之后字体还要加载、图片还要解码，printToPdf 抢在解码
                        // 之前会把插图输出成空白（Electron 那边同样是先等一下再打）。
                        std::thread::sleep(Duration::from_millis(350));
                        let result = print_to_file(&window, &output, &settings);
                        let _ = window.close();
                        let _ = tx.blocking_send(result);
                    });
                })
                .build()
                .map_err(|err| err.to_string())?
        };

        // 兜底：页面加载失败时 `on_page_load` 可能压根不触发，不能让 invoke 永远挂着。
        let watchdog = tx.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(60));
            let _ = watchdog.blocking_send(Err("PDF 渲染超时（60 秒）".to_string()));
        });

        let result = match rx.recv().await {
            Some(result) => result,
            None => Err("PDF 渲染线程提前退出".to_string()),
        };
        let _ = window.close();
        result.map(|()| output.to_string_lossy().to_string())
    }

    /// 在 `<label>` 窗口上发起一次打印到文件，等它完成。
    fn print_to_file(
        window: &WebviewWindow,
        output: &Path,
        settings: &PrintOptions,
    ) -> Result<(), String> {
        let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let output = output.to_path_buf();
        let settings = settings.clone();

        window
            .with_webview(move |webview| {
                if let Err(err) = start_print(&webview, &output, &settings, done_tx.clone()) {
                    let _ = done_tx.send(Err(err));
                }
            })
            .map_err(|err| err.to_string())?;

        done_rx
            .recv_timeout(Duration::from_secs(50))
            .map_err(|_| "等待 WebView2 打印回调超时".to_string())?
    }

    /// 只负责发起，不阻塞：`PrintToPdf` 是异步 API，结果由完成回调送回。
    fn start_print(
        webview: &tauri::webview::PlatformWebview,
        output: &Path,
        settings: &PrintOptions,
        done: std::sync::mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let controller = webview.controller();
        let core = unsafe { controller.CoreWebView2() }.map_err(|err| err.to_string())?;
        // `PrintToPdf` 在 ICoreWebView2_7 上，需要 WebView2 运行时 ≥ 1.0.1020。
        let core: ICoreWebView2_7 = core
            .cast()
            .map_err(|err| format!("当前 WebView2 运行时版本过旧，无法导出 PDF：{err}"))?;
        let environment: ICoreWebView2Environment6 = webview
            .environment()
            .cast()
            .map_err(|err| format!("当前 WebView2 运行时没有打印设置接口：{err}"))?;
        let print_settings = unsafe { environment.CreatePrintSettings() }
            .map_err(|err| format!("创建打印设置失败：{err}"))?;

        unsafe {
            print_settings
                .SetShouldPrintBackgrounds(settings.backgrounds)
                .map_err(|err| err.to_string())?;
            // 页眉页脚由渲染层用 pdf-lib 叠加上去，这里不要打第二份。
            print_settings
                .SetShouldPrintHeaderAndFooter(false)
                .map_err(|err| err.to_string())?;
            print_settings
                .SetPageWidth(settings.width)
                .map_err(|err| err.to_string())?;
            print_settings
                .SetPageHeight(settings.height)
                .map_err(|err| err.to_string())?;
            print_settings
                .SetMarginTop(settings.margins[0])
                .map_err(|err| err.to_string())?;
            print_settings
                .SetMarginBottom(settings.margins[1])
                .map_err(|err| err.to_string())?;
            print_settings
                .SetMarginLeft(settings.margins[2])
                .map_err(|err| err.to_string())?;
            print_settings
                .SetMarginRight(settings.margins[3])
                .map_err(|err| err.to_string())?;
        }

        let handler = PrintToPdfCompletedHandler::create(Box::new(
            move |result: windows::core::Result<()>, printed: bool| {
                let outcome = match result {
                    Err(err) => Err(format!("WebView2 打印失败：{err}")),
                    Ok(()) if !printed => Err("WebView2 没有写出 PDF（打印被取消）".to_string()),
                    Ok(()) => Ok(()),
                };
                let _ = done.send(outcome);
                Ok(())
            },
        ));

        // WebView2 在调用期间只借用这个缓冲区，出了作用域就可以释放。
        let wide: Vec<u16> = output
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe { core.PrintToPdf(PCWSTR(wide.as_ptr()), &print_settings, &handler) }
            .map_err(|err| err.to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;

        fn close(actual: f64, expected: f64) -> bool {
            (actual - expected).abs() < 1e-4
        }

        #[test]
        fn defaults_match_renderer_defaults() {
            // 缺省参数（渲染层偶尔会只传 printBackground）要落回 A4 + 16mm。
            let parsed = PrintOptions::from_value(&Value::Null);
            assert!(close(parsed.width, 8.2677));
            assert!(close(parsed.height, 11.6929));
            assert!(parsed.margins.iter().all(|value| close(*value, 0.6299)));
            assert!(parsed.backgrounds);
        }

        #[test]
        fn named_paper_maps_to_inches() {
            let parsed = PrintOptions::from_value(&json!({ "pageSize": "A3" }));
            assert!(close(parsed.width, 11.6929));
            assert!(close(parsed.height, 16.5354));

            let unknown = PrintOptions::from_value(&json!({ "pageSize": "B5" }));
            assert!(close(unknown.width, 8.2677), "未知纸张应落回 A4");
        }

        #[test]
        fn custom_page_size_and_margins_win() {
            let parsed = PrintOptions::from_value(&json!({
                "pageSize": { "width": 4.0, "height": 6.0 },
                "printBackground": false,
                "margins": { "top": 1.0, "bottom": 2.0, "left": 0.5, "right": 0.25 }
            }));
            assert!(close(parsed.width, 4.0) && close(parsed.height, 6.0));
            assert_eq!(parsed.margins, [1.0, 2.0, 0.5, 0.25]);
            assert!(!parsed.backgrounds);
        }

        #[test]
        fn page_size_object_keeps_the_other_dimension() {
            // 只给宽度时高度必须保留默认值，不能变成 0（WebView2 会直接拒绝）。
            let parsed = PrintOptions::from_value(&json!({ "pageSize": { "width": 10.0 } }));
            assert!(close(parsed.width, 10.0));
            assert!(close(parsed.height, 11.6929));
        }

        /// 路径进了 IPC 就会被 `paths::native` 归一化（Windows 上 `/` → `\`），
        /// 免得后面 shell32 / explorer 拿到混合分隔符直接失败。
        fn expected_native(path: &str) -> String {
            crate::paths::native(path)
        }

        #[test]
        fn payload_splits_path_and_options() {
            let (path, options) =
                split_payload(&json!(["C:/tmp/export.html", { "printBackground": true }]));
            assert_eq!(path, expected_native("C:/tmp/export.html"));
            assert_eq!(options["printBackground"], json!(true));
        }

        #[test]
        fn payload_accepts_bare_path() {
            let (path, options) = split_payload(&json!("C:/tmp/export.html"));
            assert_eq!(path, expected_native("C:/tmp/export.html"));
            assert!(options.is_null());
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_capture {
    use std::path::PathBuf;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::WKWebView;
    use serde_json::{json, Value};
    use tauri::Manager;
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    use super::{IMAGE_CHUNK_HEIGHT, MEASURE_SCRIPT, number_or, parse_number};

    fn nsimage_to_png(image: &NSImage) -> Option<Vec<u8>> {
        let tiff = image.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
        let props = NSDictionary::new();
        let png_data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)? };
        Some(png_data.to_vec())
    }

    async fn eval(window: &WebviewWindow, script: &str) -> Result<String, String> {
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<String, String>>(1);
        let script = script.to_string();
        let label = window.label().to_string();

        window
            .with_webview(move |webview| {
                let wk = webview.inner() as *mut WKWebView;
                if wk.is_null() {
                    let _ = tx.blocking_send(Err("WKWebView 指针为空".to_string()));
                    return;
                }
                let wk = unsafe { &*wk };
                let ns_script = NSString::from_str(&script);
                let tx_clone = tx.clone();
                let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
                    if let Some(err) = unsafe { error.as_ref() } {
                        let _ = tx_clone.blocking_send(Err(err.localizedDescription().to_string()));
                    } else if let Some(res) = unsafe { result.as_ref() } {
                        let desc: Retained<NSString> = unsafe { msg_send![res, description] };
                        let _ = tx_clone.blocking_send(Ok(desc.to_string()));
                    } else {
                        let _ = tx_clone.blocking_send(Ok(String::new()));
                    }
                });
                unsafe {
                    wk.evaluateJavaScript_completionHandler(&ns_script, Some(&handler));
                }
            })
            .map_err(|err| format!("with_webview 失败（{label}）：{err}"))?;

        match rx.recv().await {
            Some(result) => result,
            None => Err("evaluateJavaScript 回调没有回来".to_string()),
        }
    }

    fn capture_frame(window: &WebviewWindow) -> Result<Vec<u8>, String> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();
        window
            .with_webview(move |webview| {
                let wk = webview.inner() as *mut WKWebView;
                if wk.is_null() {
                    let _ = tx.send(Err("WKWebView 指针为空".to_string()));
                    return;
                }
                let wk = unsafe { &*wk };
                let done = tx.clone();
                let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                    if let Some(err) = unsafe { error.as_ref() } {
                        let _ = done.send(Err(err.localizedDescription().to_string()));
                    } else if let Some(img) = unsafe { image.as_ref() } {
                        match nsimage_to_png(img) {
                            Some(png) => {
                                let _ = done.send(Ok(png));
                            }
                            None => {
                                let _ = done.send(Err("NSImage 转 PNG 失败".to_string()));
                            }
                        }
                    } else {
                        let _ = done.send(Err("截图结果为空且无错误".to_string()));
                    }
                });
                unsafe {
                    wk.takeSnapshotWithConfiguration_completionHandler(None, &handler);
                }
            })
            .map_err(|err| err.to_string())?;

        rx.recv_timeout(Duration::from_secs(30))
            .map_err(|_| "等待 WKWebView 截图回调超时".to_string())?
    }

    /// `export.prepareImageCapture`
    pub(super) async fn prepare(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<Value, String> {
        let items = payload.as_array().cloned().unwrap_or_default();
        let head = items.first().cloned().unwrap_or(Value::Null);
        let file_path = head
            .as_str()
            .or_else(|| payload.as_str())
            .unwrap_or_default()
            .to_string();
        let options = items.get(1).cloned().unwrap_or(Value::Null);

        if file_path.is_empty() {
            return Ok(Value::Null);
        }
        let source = PathBuf::from(&file_path);
        if !source.is_file() {
            log::warn!("[export] prepareImageCapture 找不到临时文件：{file_path}");
            return Ok(Value::Null);
        }
        let url = tauri::Url::from_file_path(&source)
            .map_err(|_| format!("临时文件路径无法转成 URL：{file_path}"))?;

        let image_width = number_or(&options, "imageWidth", 640.0).max(1.0);
        let quality = number_or(&options, "quality", 0.0);

        let label = format!("capture-{}", state.next_window_seq());
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<f64, String>>(1);

        {
            let watchdog = tx.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                let _ = watchdog.blocking_send(Err("测量页面高度超时".to_string()));
            });
        }

        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title("ArborMark")
            .inner_size(image_width, 720.0)
            .position(-32000.0, 0.0)
            .decorations(false)
            .skip_taskbar(true)
            .focused(false)
            .visible(true)
            .on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let tx = tx.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(350));
                    let outcome = tauri::async_runtime::block_on(async move {
                        Ok::<f64, String>(parse_number(eval(&window, MEASURE_SCRIPT).await?))
                    });
                    let _ = tx.blocking_send(outcome);
                });
            })
            .build()
            .map_err(|err| err.to_string())?;

        let scale = window.scale_factor().unwrap_or(1.0);
        let total_height = match rx.recv().await {
            Some(Ok(height)) => height,
            Some(Err(err)) => {
                log::warn!("[export] 测量页面高度失败: {err}");
                let _ = window.close();
                return Ok(Value::Null);
            }
            None => {
                let _ = window.close();
                return Ok(Value::Null);
            }
        };

        if total_height <= 0.0 {
            let _ = window.close();
            return Ok(Value::Null);
        }

        state.register_capture_view(label.clone(), label.clone());
        Ok(json!({
            "winId": label,
            "totalHeight": total_height,
            "pageHeight": IMAGE_CHUNK_HEIGHT,
            "scale": scale,
            "quality": quality,
        }))
    }

    fn macos_scroll_script(offset: f64) -> String {
        format!(
            r#"(() => {{
                const root = document.body.parentElement;
                root.scrollTop = {offset};
                return Math.max(document.body.clientHeight, root.scrollHeight, root.clientHeight);
            }})()"#
        )
    }

    /// `export.captureImage`
    pub(super) async fn grab(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<Value, String> {
        let items = payload.as_array().cloned().unwrap_or_default();
        let win_id = items.first().and_then(Value::as_str).unwrap_or_default().to_string();
        let offset = items
            .get(1)
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0);
        let options = items.get(2).cloned().unwrap_or(Value::Null);

        let Some(label) = state.capture_view(&win_id) else {
            log::warn!("[export] captureImage 找不到视图 {win_id}");
            return Ok(Value::Null);
        };
        let Some(window) = app.get_webview_window(&label) else {
            return Ok(Value::Null);
        };

        let width = number_or(&options, "imageWidth", 640.0).max(1.0);
        let height = number_or(&options, "pageHeight", IMAGE_CHUNK_HEIGHT).max(1.0);

        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|err| err.to_string())?;

        let new_scroll_height = match eval(&window, &macos_scroll_script(offset)).await {
            Ok(text) => parse_number(text),
            Err(err) => {
                log::warn!("[export] 滚动到 {offset} 失败: {err}");
                return Ok(Value::Null);
            }
        };

        let png = capture_frame(&window)?;
        use base64::Engine as _;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&png);
        Ok(json!(format!(
            "{{\"newScrollHeight\":{}, \"data\":\"data:image/png;base64,{encoded}\"}}",
            new_scroll_height
        )))
    }

    /// `controller.screenshotHTML`：HTML → PNG 临时文件（路径字符串）。
    pub(super) async fn screenshot_html(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<Value, String> {
        let html = payload
            .get("html")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if html.is_empty() {
            return Ok(Value::Null);
        }
        let rect = payload.get("rect").cloned().unwrap_or_else(|| json!({}));
        let width = number_or(&rect, "width", 800.0).max(1.0);
        let height = number_or(&rect, "height", 600.0).max(1.0);

        let temp_dir = std::env::temp_dir().join("arbormark");
        std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let html_path = temp_dir.join(format!(
            "shot-{}.html",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
        std::fs::write(&html_path, html).map_err(|e| e.to_string())?;
        let url = tauri::Url::from_file_path(&html_path)
            .map_err(|_| "临时 HTML 无法转成 URL".to_string())?;

        let label = format!("shot-{}", state.next_window_seq());
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), String>>(1);
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title("ArborMark")
            .inner_size(width, height)
            .position(-32000.0, 0.0)
            .decorations(false)
            .visible(true)
            .on_page_load(move |window, load| {
                if load.event() != PageLoadEvent::Finished {
                    return;
                }
                let tx = tx.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(350));
                    let _ = tx.blocking_send(Ok(()));
                    let _ = window;
                });
            })
            .build()
            .map_err(|err| err.to_string())?;

        let load_result = rx.recv().await;
        let outcome = (|| -> Result<Value, String> {
            match load_result {
                Some(Ok(())) => {}
                other => return Err(format!("截图窗口加载异常: {other:?}")),
            }
            let png = capture_frame(&window)?;
            let png_path = temp_dir.join(format!(
                "shot-{}.png",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ));
            std::fs::write(&png_path, &png).map_err(|e| e.to_string())?;
            Ok(json!(png_path.to_string_lossy()))
        })();

        let _ = window.close();
        let _ = std::fs::remove_file(&html_path);
        outcome
    }
}

#[cfg(target_os = "macos")]
mod macos_pdf {
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;
    use serde_json::Value;
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    fn split_payload(payload: &Value) -> (String, Value) {
        if let Some(items) = payload.as_array() {
            return (
                crate::paths::native(items.first().and_then(Value::as_str).unwrap_or_default()),
                items.get(1).cloned().unwrap_or(Value::Null),
            );
        }
        (
            crate::paths::native(payload.as_str().unwrap_or_default()),
            Value::Null,
        )
    }

    pub(super) async fn render(
        app: &tauri::AppHandle,
        state: &tauri::State<'_, crate::state::AppState>,
        payload: &Value,
    ) -> Result<String, String> {
        let (temp_file, _options) = split_payload(payload);
        let source = PathBuf::from(&temp_file);
        if !source.is_file() {
            return Err(format!("找不到待导出的临时文件：{temp_file}"));
        }

        let url = tauri::Url::from_file_path(&source)
            .map_err(|_| format!("临时文件路径无法转成 URL：{temp_file}"))?;

        let output_dir = std::env::temp_dir().join("arbormark");
        std::fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
        let output = output_dir.join(format!("pdf-{}.pdf", uuid::Uuid::new_v4()));

        let label = format!("pdf-{}", state.next_window_seq());
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), String>>(1);

        let window = {
            let output = output.clone();
            let tx = tx.clone();
            WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
                .title("ArborMark")
                .inner_size(900.0, 1200.0)
                .position(-32000.0, 0.0)
                .decorations(false)
                .visible(false)
                .on_page_load(move |window, payload| {
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    let output = output.clone();
                    let tx = tx.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(350));
                        let result = print_to_file(&window, &output);
                        let _ = window.close();
                        let _ = tx.blocking_send(result);
                    });
                })
                .build()
                .map_err(|err| err.to_string())?
        };

        let watchdog = tx.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(60));
            let _ = watchdog.blocking_send(Err("PDF 渲染超时（60 秒）".to_string()));
        });

        let result = match rx.recv().await {
            Some(result) => result,
            None => Err("PDF 渲染线程提前退出".to_string()),
        };
        let _ = window.close();
        result.map(|()| output.to_string_lossy().to_string())
    }

    fn print_to_file(
        window: &WebviewWindow,
        output: &Path,
    ) -> Result<(), String> {
        let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();

        window
            .with_webview(move |webview| {
                let wk = webview.inner() as *mut WKWebView;
                if wk.is_null() {
                    let _ = done_tx.send(Err("WKWebView 指针为空".to_string()));
                    return;
                }
                let wk = unsafe { &*wk };
                let done = done_tx.clone();
                let handler = RcBlock::new(move |pdf_data: *mut NSData, error: *mut NSError| {
                    if let Some(err) = unsafe { error.as_ref() } {
                        let _ = done.send(Err(err.localizedDescription().to_string()));
                    } else if let Some(data) = unsafe { pdf_data.as_ref() } {
                        let _ = done.send(Ok(data.to_vec()));
                    } else {
                        let _ = done.send(Err("createPDF 返回空数据且无错误".to_string()));
                    }
                });
                unsafe {
                    wk.createPDFWithConfiguration_completionHandler(None, &handler);
                }
            })
            .map_err(|err| err.to_string())?;

        let bytes = done_rx
            .recv_timeout(Duration::from_secs(50))
            .map_err(|_| "等待 WKWebView 导出 PDF 超时".to_string())??;

        std::fs::write(output, &bytes).map_err(|e| format!("写入 PDF 文件失败: {e}"))?;
        Ok(())
    }
}

