//! 原生对话框（`tauri-plugin-dialog`）。

use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub fn filters(payload: &Value) -> Vec<(String, Vec<String>)> {
    payload
        .get("filters")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .map(|f| {
                    let name = f.get("name").and_then(Value::as_str).unwrap_or("Files").to_string();
                    let exts = f
                        .get("extensions")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                        .unwrap_or_default();
                    (name, exts)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn is_dir_dialog(payload: &Value) -> bool {
    payload
        .get("properties")
        .and_then(Value::as_array)
        .map(|props| props.iter().any(|p| p.as_str() == Some("openDirectory")))
        .unwrap_or(false)
}

fn is_multi(payload: &Value) -> bool {
    payload
        .get("properties")
        .and_then(Value::as_array)
        .map(|props| props.iter().any(|p| p.as_str() == Some("multiSelections")))
        .unwrap_or(false)
}

/// 对话框收发路径一律走 `paths::native`。
///
/// 渲染层可能把 `C:\dir/sub/Untitled.md` 这类混合分隔符当作默认路径传进来
/// （文件列表模式的"新建文件"曾经就是这样），Windows 的 shell 对话框会**原样**
/// 把正斜杠回传；这条路径随后会被写进 data-path、窗口标题和剪贴板。
/// 在边界上归一化，比要求每个调用点都拼对更可靠。
/// tauri-plugin-dialog 返回的是 `FilePath`（本地路径或 URL），先转字符串。
fn native_path(path: &tauri_plugin_dialog::FilePath) -> String {
    crate::paths::native(&path.to_string())
}

pub fn show_open(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let mut builder = app.dialog().file();
    if let Some(title) = payload.get("title").and_then(Value::as_str) {
        builder = builder.set_title(title);
    }
    if let Some(dir) = payload.get("defaultPath").and_then(Value::as_str) {
        builder = builder.set_directory(crate::paths::native(dir));
    }
    for (name, exts) in filters(payload) {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        builder = builder.add_filter(&name, &refs);
    }

    if is_dir_dialog(payload) {
        return Ok(match builder.blocking_pick_folder() {
            Some(path) => json!({ "canceled": false, "filePaths": [native_path(&path)] }),
            None => json!({ "canceled": true, "filePaths": [] }),
        });
    }

    if is_multi(payload) {
        let paths: Vec<String> = builder
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| native_path(&p))
            .collect();
        return Ok(json!({ "canceled": paths.is_empty(), "filePaths": paths }));
    }

    Ok(match builder.blocking_pick_file() {
        Some(path) => json!({ "canceled": false, "filePaths": [native_path(&path)] }),
        None => json!({ "canceled": true, "filePaths": [] }),
    })
}

pub fn show_save(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let mut builder = app.dialog().file();
    if let Some(title) = payload.get("title").and_then(Value::as_str) {
        builder = builder.set_title(title);
    }
    if let Some(raw_path) = payload.get("defaultPath").and_then(Value::as_str) {
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
    for (name, exts) in filters(payload) {
        let filtered: Vec<&str> = exts.iter().map(String::as_str).filter(|e| *e != "*").collect();
        if !filtered.is_empty() {
            builder = builder.add_filter(&name, &filtered);
        }
    }

    Ok(match builder.blocking_save_file() {
        Some(path) => json!({ "canceled": false, "filePath": native_path(&path) }),
        None => json!({ "canceled": true, "filePath": Value::Null }),
    })
}

pub fn show_message(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let message = payload.get("message").and_then(Value::as_str).unwrap_or("");
    let detail = payload.get("detail").and_then(Value::as_str).unwrap_or("");
    let title = payload.get("title").and_then(Value::as_str).unwrap_or("ArborMark");

    let kind = match payload.get("type").and_then(Value::as_str) {
        Some("warning") => MessageDialogKind::Warning,
        Some("error") => MessageDialogKind::Error,
        _ => MessageDialogKind::Info,
    };

    let buttons = payload
        .get("buttons")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_else(|| vec!["OK".to_string()]);

    // tauri-plugin-dialog 的 MessageDialogBuilder 没有 description 方法，
    // 详情直接并入正文（Electron 的 detail 也是同样的展示效果）。
    let full_message = if detail.is_empty() {
        message.to_string()
    } else {
        format!("{message}\n\n{detail}")
    };

    let pressed_first = app
        .dialog()
        .message(full_message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancelCustom(
            buttons.first().cloned().unwrap_or_else(|| "OK".into()),
            buttons.get(1).cloned().unwrap_or_else(|| "Cancel".into()),
        ))
        .blocking_show();
    let response = if pressed_first { 0 } else { 1 };
    Ok(json!({ "response": response, "checkboxChecked": false }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 对话框返回的路径必须归一化：Windows 上 `C:\a\b/c.md` 会让 data-path、
    /// 窗口标题、剪贴板和 shell32 一起出问题（列表模式"新建文件"就是这样）。
    #[test]
    fn native_path_flattens_mixed_separators() {
        let file_path =
            tauri_plugin_dialog::FilePath::Path(std::path::PathBuf::from(r"C:\a\b/c.md"));
        let out = native_path(&file_path);
        if cfg!(windows) {
            assert_eq!(out, r"C:\a\b\c.md");
        } else {
            assert!(out.ends_with("c.md"));
        }
    }
}
