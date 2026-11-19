//! 外部打开、定位文件、回收站。

use serde_json::{json, Value};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

fn path_arg(payload: &Value) -> Result<String, String> {
    payload
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .map(crate::paths::native)
        .ok_or_else(|| "missing path".to_string())
}

pub fn open_external(payload: &Value) -> Result<Value, String> {
    let url = payload
        .as_str()
        .map(str::to_string)
        .or_else(|| payload.get("url").and_then(Value::as_str).map(str::to_string))
        .ok_or_else(|| "missing url".to_string())?;
    open::that(&url).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn open_item(payload: &Value) -> Result<Value, String> {
    let path = path_arg(payload)?;
    open::that(&path).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// Windows：在资源管理器中打开目标所在目录并选中它。
///
/// explorer.exe 只认「仅路径带引号」的写法：`/select,"C:\a b\c.md"`。
/// 若写成 `.arg(format!("/select,{path}"))`，路径含空格时 Rust 会把**整条**参数
/// 包成 `"/select,C:\a b\c.md"`，explorer 解析不出开关，静默退回「文档」目录——
/// 用户看到的就是"打开的文件夹不对"。所以这里用 `raw_arg` 精确控制引号位置。
/// 返回 Err 表示 explorer 没能启动（由调用方降级为直接打开父目录）。
#[cfg(target_os = "windows")]
fn reveal_in_explorer(path: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;

    // 路径在 `path_arg` 里已经统一成原生分隔符；这里只去掉结尾分隔符，
    // 否则 `"C:\dir\"` 的收尾引号会被 explorer 当成转义。
    let mut target = path.trim_end_matches('\\');
    if target.is_empty() {
        target = path;
    }

    std::process::Command::new("explorer")
        .raw_arg(format!("/select,\"{target}\""))
        .spawn()
        .map(|_| ())
}

pub fn show_item_in_folder(payload: &Value) -> Result<Value, String> {
    let path = path_arg(payload)?;
    let target = Path::new(&path);
    log::info!("[shell] showItemInFolder: {path}");

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // 没有父目录（盘符根目录等）时无处可"选中"，直接打开目标本身。
        let has_parent = target
            .parent()
            .map(|p| !p.as_os_str().is_empty())
            .unwrap_or(false);

        if !has_parent {
            open::that(&path).map_err(|e| e.to_string())?;
        } else if let Err(err) = reveal_in_explorer(&path) {
            log::warn!("[shell] showItemInFolder 启动 explorer 失败（{err}），改为打开父目录: {path}");
            let parent = target.parent().unwrap_or(target);
            open::that(parent).map_err(|e| e.to_string())?;
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(target);
        open::that(parent).map_err(|e| e.to_string())?;
    }

    Ok(Value::Null)
}

/// `shell.showProperties`：打开系统的「属性」对话框。
///
/// 旧版这条走的是 Electron 原生扩展 `node_modules/main.node`（`winShell().openProperties`），
/// Tauri 里没有那个 .node 模块，右键菜单的「属性」因此一按就抛异常、什么都不发生。
/// 这里用 shell32 的 `SHObjectProperties` 直接弹系统对话框。
#[cfg(target_os = "windows")]
pub fn show_properties(payload: &Value) -> Result<Value, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHObjectProperties, SHOP_FILEPATH};

    let path = path_arg(payload)?;
    let target = Path::new(&path);
    if !target.exists() {
        log::warn!("[shell] showProperties 目标不存在: {path}");
        return Err(format!("文件不存在：{path}"));
    }

    let wide: Vec<u16> = std::ffi::OsStr::new(&path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let ok = unsafe {
        SHObjectProperties(
            std::ptr::null_mut(),
            SHOP_FILEPATH as u32,
            wide.as_ptr(),
            std::ptr::null(),
        )
    };
    if ok == 0 {
        log::warn!("[shell] SHObjectProperties 失败: {path}");
        return Err(format!("打开属性对话框失败：{path}"));
    }
    log::info!("[shell] showProperties ok: {path}");
    Ok(Value::Null)
}

#[cfg(not(target_os = "windows"))]
pub fn show_properties(payload: &Value) -> Result<Value, String> {
    let path = path_arg(payload)?;
    log::warn!("[shell] showProperties 仅 Windows 实现，忽略: {path}");
    Ok(Value::Null)
}

pub fn trash_item(payload: &Value) -> Result<Value, String> {
    let path = path_arg(payload)?;
    trash::delete(&path).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

pub fn show_download(payload: &Value) -> Result<Value, String> {
    let path = path_arg(payload)?;
    show_item_in_folder(&json!({ "path": path }))
}

/// `shell.isFolder(path)`：目录判断（渲染层 image-edit 的目标目录探测）。
pub fn is_folder(payload: &Value) -> Result<Value, String> {
    let Ok(path) = path_arg(payload) else {
        return Ok(json!(false));
    };
    Ok(json!(Path::new(&path).is_dir()))
}

/// `shell.removeIfEmpty(path)`：目录为空则删除，返回是否已删。
pub fn remove_if_empty(payload: &Value) -> Result<Value, String> {
    let Ok(path) = path_arg(payload) else {
        return Ok(json!(false));
    };
    let dir = Path::new(&path);
    let is_empty = dir
        .read_dir()
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false);
    if dir.is_dir() && is_empty {
        match std::fs::remove_dir(dir) {
            Ok(_) => Ok(json!(true)),
            Err(err) => {
                log::warn!("[shell] removeIfEmpty 失败 {path}: {err}");
                Ok(json!(false))
            }
        }
    } else {
        Ok(json!(false))
    }
}

/// `shell.showSaveImage(absSrc)`：右键图片"存储到…"（mac QuickLook 语义的保存流）。
/// 等价实现：弹保存框 → 复制文件。
pub fn show_save_image(
    app: &tauri::AppHandle,
    payload: &Value,
) -> Result<Value, String> {
    let Ok(src) = path_arg(payload) else {
        return Ok(json!(false));
    };
    let file_name = Path::new(&src)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .blocking_save_file();
    let Some(dest) = picked else {
        return Ok(json!(false));
    };
    match std::fs::copy(&src, dest.to_string()) {
        Ok(_) => Ok(json!(true)),
        Err(err) => {
            log::warn!("[shell] showSaveImage 复制失败: {err}");
            Ok(json!(false))
        }
    }
}
