//! 文件 IO 的异步快通道。
//!
//! 回环 HTTP + base64 + JSON 的同步桥是为了兼容渲染层的 Node 同步调用，
//! 但"打开/保存文档、预览图片"这类热路径不需要同步语义，走它反而把
//! 1ms 的读盘放大成 15–25ms（base64、JSON、同步 XHR 各占一段）。
//!
//! 这里按 Tauri 官方建议提供异步命令：读取直接返回 `tauri::ipc::Response`
//! （原始字节，不经过 serde/JSON），统计走批量接口一次拿一批。
//! 同步调用暂时仍留在回环桥上，等待渲染层逐步异步化。

use serde_json::{json, Value};
use tauri::ipc::Response;

/// 读取文件原始字节。JS 侧拿到 ArrayBuffer。
///
/// 返回类型必须是裸 `Response`：包在 `Result<Response, _>` 里会被当成普通
/// 返回值走 serde，字节就退化成 JSON 数字数组（比 base64 还慢）。
/// 出错时返回空 body，调用方通过 `fs_stat_many` / 后续读取判断。
#[tauri::command]
pub async fn fs_read_bytes(path: String) -> Response {
    let path = crate::paths::native(&path);
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .unwrap_or_else(|err| Err(std::io::Error::other(err.to_string())))
        .unwrap_or_else(|err| {
            log::warn!("[fs_read_bytes] 读取失败: {err}");
            Vec::new()
        });
    Response::new(bytes)
}

/// 读取文本（UTF-8 宽松解码），返回字符串 —— 小文件、主题、配置用。
/// 二进制防呆：前 8KB 出现 NUL 字节即拒绝，渲染层不会拿到乱码文本。
#[tauri::command]
pub async fn fs_read_text(path: String) -> Result<String, String> {
    let path = crate::paths::native(&path);
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err("binary file".to_string());
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// 批量 stat：文件树、最近文件列表一次拿完，避免 N 次跨进程调用。
#[tauri::command]
pub async fn fs_stat_many(paths: Vec<String>) -> Result<Vec<Value>, String> {
    let paths: Vec<String> = paths.iter().map(|path| crate::paths::native(path)).collect();
    let result = tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| match std::fs::metadata(&path) {
                Ok(meta) => json!({
                    "path": path,
                    "ok": true,
                    "isFile": meta.is_file(),
                    "isDirectory": meta.is_dir(),
                    "size": meta.len(),
                    "mtimeMs": meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                }),
                Err(err) => json!({ "path": path, "ok": false, "error": err.to_string() }),
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(result)
}

/// 批量读取（每项返回 base64，仅供小文件批量用；大的走 fs_read_bytes 逐个读）。
#[tauri::command]
pub async fn fs_read_text_many(paths: Vec<String>) -> Result<Vec<Value>, String> {
    let paths: Vec<String> = paths.iter().map(|path| crate::paths::native(path)).collect();
    use base64::Engine as _;

    let result = tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| match std::fs::read(&path) {
                Ok(bytes) => json!({
                    "path": path,
                    "ok": true,
                    "size": bytes.len(),
                    "base64": base64::engine::general_purpose::STANDARD.encode(&bytes),
                }),
                Err(err) => json!({ "path": path, "ok": false, "error": err.to_string() }),
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(result)
}

/// 同步版本：Tauri 的同步命令在独立线程执行，返回裸 `Response` 时
/// IPC 层直接透传原始字节（async 命令的返回值可能被 JSON 化）。
#[tauri::command]
pub fn fs_read_bytes_sync(path: String) -> Response {
    match std::fs::read(&path) {
        Ok(bytes) => Response::new(bytes),
        Err(err) => {
            log::warn!("[fs_read_bytes_sync] 读取失败: {err}");
            Response::new(Vec::new())
        }
    }
}
