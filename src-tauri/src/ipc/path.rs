//! `path.*` 与 `quickOpen.*` 通道。
//!
//! 对应旧主进程 `document-handlers.js` 里的实现：文件定位、用默认程序打开、
//! 判断目录、快捷打开（当前为常量桩，与旧版行为一致）。

use serde_json::{json, Value};
use std::path::Path;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn path_arg(payload: &Value) -> Option<String> {
    payload
        .as_str()
        .or_else(|| payload.get("path").and_then(Value::as_str))
        .or_else(|| payload.get("filePath").and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .map(crate::paths::native)
}

/// 在当前窗口里切换文档。
///
/// 旧版通过 `windowManager.execRenderer(...)` 调 `File.editor.library.doSwitchByNode`；
/// Tauri 侧用 `WebviewWindow::eval` 完成同样的事。
pub fn open_file(window: &WebviewWindow, payload: &Value) -> Result<Value, String> {
    let Some(mut file_path) = path_arg(payload) else {
        return Ok(json!(false));
    };

    if let Some(state) = window.app_handle().try_state::<crate::state::AppState>() {
        let user_language = state.get("userLanguage").as_str().unwrap_or("").to_string();
        let locale = crate::locale::resolve_app_locale(Some(&user_language));
        file_path = crate::ipc::document::resolve_localized_doc_path(&file_path, &locale);
    }

    let literal = serde_json::to_string(&file_path).map_err(|e| e.to_string())?;
    let script = format!(
        "try {{ window.File?.editor?.library?.doSwitchByNode?.({literal}); }} catch (e) {{ console.warn(e); }}"
    );
    window.eval(&script).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

/// 在文件管理器中显示。
pub fn open_folder_in_finder(payload: &Value) -> Result<Value, String> {
    if let Some(target) = path_arg(payload) {
        let _ = crate::ipc::shell::show_item_in_folder(&json!(target));
    }
    Ok(json!(true))
}

/// 外部链接：仅放行 http(s)/mailto，其余忽略（与旧版 sanitizeExternalUrl 对齐）。
pub fn open_url(payload: &Value) -> Result<Value, String> {
    if let Some(url) = payload
        .as_str()
        .or_else(|| payload.get("url").and_then(Value::as_str))
    {
        let lower = url.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
            let _ = open::that(url);
        } else {
            log::warn!("[path.openUrl] 已拦截非 http(s)/mailto 链接: {url}");
        }
    }
    Ok(json!(true))
}

/// 用系统默认程序打开（不限定协议，用于本地文件）。
pub fn open_file_with_application(payload: &Value) -> Result<Value, String> {
    if let Some(target) = path_arg(payload) {
        open::that(&target).map_err(|e| e.to_string())?;
    }
    Ok(json!(true))
}

/// 判断路径是否为目录；不存在或出错一律 false。
pub fn is_directory(payload: &Value) -> Result<Value, String> {
    let Some(target) = path_arg(payload) else {
        return Ok(json!(false));
    };
    Ok(json!(Path::new(&target).is_dir()))
}

/// `path.readText(filePath)`：读文本文件全文（旧版为 callSync 同步通道）。
pub fn read_text(payload: &Value) -> Result<Value, String> {
    let Some(path) = path_arg(payload) else {
        return Ok(Value::Null);
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(json!(content)),
        Err(err) => {
            log::warn!("[path] readText 失败 {path}: {err}");
            Ok(Value::Null)
        }
    }
}

/// `path.readTextLimited(filePath)`：读文件前若干字节做预览/二进制嗅探。
///
/// 渲染层（sidebar-panels FilePreview）对返回值 `JSON.parse` 后检查
/// `error` / `tooLarge` / `content`（含 `\0` 判二进制）。返回 **JSON 字符串**。
pub fn read_text_limited(payload: &Value) -> Result<Value, String> {
    let Some(path) = path_arg(payload) else {
        return Ok(Value::Null);
    };
    const LIMIT: u64 = 64 * 1024;
    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(err) => {
            return Ok(json!(format!("{{\"error\":\"{}\"}}", err)));
        }
    };
    if meta.len() > LIMIT {
        return Ok(json!("{\"tooLarge\":true}"));
    }
    match std::fs::read(&path) {
        Ok(bytes) => {
            let content = String::from_utf8_lossy(&bytes).to_string();
            Ok(json!(json!({ "content": content }).to_string()))
        }
        Err(err) => Ok(json!(format!("{{\"error\":\"{}\"}}", err))),
    }
}

/// `path.applicationsForFile`：mac 打开方式列表（NSWorkspace）。
/// Windows 等价信息没有稳定的 Rust API，渲染层非 mac 直接 resolve(null)。
pub fn applications_for_file() -> Result<Value, String> {
    Ok(Value::Null)
}

/// `path.showInFinder(path)`：定位到文件；直接复用 shell.showItemInFolder。
pub fn show_in_finder(payload: &Value) -> Result<Value, String> {
    crate::ipc::shell::show_item_in_folder(payload)
}

/// `path.selectFolderOrFile`：通用选择器（目录优先）。
///
/// file-helper.js 的 mac 分支；回调拿到所选路径或 null。
pub fn select_folder_or_file(app: &tauri::AppHandle) -> Result<Value, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(match picked {
        // 对话框返回的路径同样要归一化，别让正斜杠流进 data-path / 剪贴板。
        Some(path) => json!(crate::paths::native(&path.to_string())),
        None => Value::Null,
    })
}

/// `path.showSaveDialog`：保存对话框，回调拿 filePath（file-helper.js:367）。
pub fn show_save_dialog(app: &tauri::AppHandle, payload: &Value) -> Result<Value, String> {
    let mut builder = app.dialog().file();
    if let Some(title) = payload.get("title").and_then(Value::as_str) {
        builder = builder.set_title(title);
    }
    if let Some(raw_path) = payload
        .get("defaultPath")
        .or_else(|| payload.get("defaultName"))
        .and_then(Value::as_str)
    {
        let p = std::path::Path::new(raw_path);
        if p.is_dir() {
            builder = builder.set_directory(p);
        } else {
            if let Some(parent) = p.parent() {
                if parent.is_dir() {
                    builder = builder.set_directory(parent);
                }
            }
            if let Some(name) = p.file_name() {
                builder = builder.set_file_name(name.to_string_lossy());
            }
        }
    }
    for (name, exts) in crate::ipc::dialog::filters(payload) {
        let filtered: Vec<&str> = exts.iter().map(String::as_str).filter(|e| *e != "*").collect();
        if !filtered.is_empty() {
            builder = builder.add_filter(&name, &filtered);
        }
    }
    Ok(match builder.blocking_save_file() {
        Some(path) => json!(crate::paths::native(&path.to_string())),
        None => Value::Null,
    })
}
