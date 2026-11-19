//! `arbormark://` 自定义协议。
//!
//! 前端资源由 Tauri 自带的 frontendDist（src/web 构建产物）提供，这里只保留
//! 两条文件路由：
//!   arbormark://app/__read__/<base64url(path)>  -> 本地文件字节（图片等子资源）
//!   arbormark://app/tempfile/<name>             -> <系统 temp>/arbormark/<name>
//!                                                  （导出打印视图用）

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::Value;

/// `__read__` 单文件上限。文档要整块进内存，但仍需封顶。
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// 当前平台默认主题（设置层兜底值）。
pub fn default_theme() -> &'static str {
    if cfg!(target_os = "macos") {
        "liquid-glass.css"
    } else {
        "github.css"
    }
}

/// 去掉 Windows 的 verbatim 前缀（`\\?\`）。
///
/// `AppHandle::path().resource_dir()` 返回的是 canonicalize 过的路径，Windows 上
/// 带 `\\?\` 前缀；这个前缀会**关闭** Win32 的路径归一化，正斜杠在 Rust 的
/// `Path::exists()` 里不再被当成分隔符。注入给渲染层前统一剥掉。
pub fn plain_path(path: PathBuf) -> PathBuf {
    // 顺带把 `a/../b` 这种写法解开：这些路径会被拼进 URL、显示在界面上。
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            // UNC（`\\?\UNC\server\share`）要还原成 `\\server\share`。
            if let Some(unc) = rest.strip_prefix(r"UNC\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest.to_string());
        }
    }
    path
}

static DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 由 `lib.rs` 在 setup 阶段写入真实的 app data 目录，
/// 避免协议层自己猜平台路径（Windows 与 macOS 的规则不同）。
pub fn set_data_root(path: PathBuf) {
    let _ = DATA_ROOT.set(plain_path(path));
}

pub fn data_root() -> PathBuf {
    DATA_ROOT.get().cloned().unwrap_or_else(|| {
        dirs::data_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("com.arbor.arbormark")
    })
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "json" | "map" => "application/json",
        "html" | "htm" => "text/html",
        "txt" => "text/plain",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "eot" => "application/vnd.ms-fontobject",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// 百分号解码（协议路径里中文文件名、空格很常见）。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 解析 `__read__/<base64url>` 并在命中时返回文件字节。
fn read_file_route(encoded: &str) -> (u16, &'static str, Vec<u8>) {
    use base64::Engine as _;

    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let decoded = match engine.decode(percent_decode(encoded)) {
        Ok(bytes) => bytes,
        Err(_) => return (400, "text/plain", b"bad path".to_vec()),
    };
    let Ok(target) = String::from_utf8(decoded) else {
        return (400, "text/plain", b"bad path".to_vec());
    };
    serve_absolute(Path::new(&target))
}

/// 读取一个绝对路径文件：拒绝相对路径 / `..` / 目录 / 超大文件。
fn serve_absolute(path: &Path) -> (u16, &'static str, Vec<u8>) {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return (404, "text/plain", b"not found".to_vec());
    }
    match std::fs::metadata(path) {
        Ok(meta) if !meta.is_file() => return (404, "text/plain", b"not found".to_vec()),
        Ok(meta) if meta.len() > MAX_READ_BYTES => {
            log::warn!("[protocol] 拒绝超大文件 {}: {} 字节", path.display(), meta.len());
            return (413, "text/plain", b"file too large".to_vec());
        }
        Ok(_) => {}
        Err(_) => return (404, "text/plain", b"not found".to_vec()),
    }
    match std::fs::read(path) {
        Ok(bytes) => (200, mime_for(path), bytes),
        Err(err) => {
            log::warn!("[protocol] 读取失败 {}: {err}", path.display());
            (404, "text/plain", b"read failed".to_vec())
        }
    }
}

/// 读取当前主题：优先 settings.json 里的 curTheme，其次 theme。
pub fn current_theme() -> String {
    let settings: Value = std::fs::read_to_string(data_root().join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null);

    let raw = settings
        .get("curTheme")
        .and_then(Value::as_str)
        .or_else(|| settings.get("theme").and_then(Value::as_str))
        .unwrap_or("");

    if raw.is_empty() {
        return default_theme().to_string();
    }
    if raw.ends_with(".css") {
        raw.to_string()
    } else {
        format!("{raw}.css")
    }
}

/// 解析 `arbormark://app/...` 的 pathname，返回 (status, content-type, body)。
pub fn resolve(pathname: &str) -> (u16, &'static str, Vec<u8>) {
    let path = percent_decode(pathname).replace('\\', "/");
    let path = path.trim_start_matches('/');

    // `__read__/<base64url(path)>`：把本地文件原样吐给 WebView。
    if let Some(encoded) = path.strip_prefix("__read__/") {
        return read_file_route(encoded);
    }

    // `tempfile/...` -> <系统 temp>/arbormark/...（导出打印视图用）
    if let Some(name) = path.strip_prefix("tempfile/") {
        if name.contains("..") {
            return (403, "text/plain; charset=utf-8", b"Forbidden".to_vec());
        }
        let candidate = std::env::temp_dir().join("arbormark").join(name);
        let (status, _, body) = serve_absolute(&candidate);
        if status == 200 {
            log::info!("[protocol] 提供临时打印文件: {name}");
            return (200, mime_for(&candidate), body);
        }
        return (status, "text/plain", body);
    }

    let body = format!("Not Found: {pathname}").into_bytes();
    (404, "text/plain; charset=utf-8", body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("%E4%B8%AD%E6%96%87"), "中文");
        assert_eq!(percent_decode("my%20theme.css"), "my theme.css");
        // 不完整的转义原样保留，不 panic
        assert_eq!(percent_decode("broken%2"), "broken%2");
    }

    #[test]
    fn maps_mime_types() {
        assert_eq!(mime_for(Path::new("a.css")), "text/css");
        assert_eq!(mime_for(Path::new("a.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a.unknown")), "application/octet-stream");
        assert_eq!(mime_for(Path::new("no-extension")), "application/octet-stream");
    }

    #[test]
    fn serves_temp_print_view_but_blocks_traversal() {
        let base = std::env::temp_dir().join("arbormark");
        std::fs::create_dir_all(&base).expect("create temp dir");
        let file = base.join("arbormark-print-test.html");
        std::fs::write(&file, "<html>print</html>").expect("write temp file");

        let (status, mime, body) = resolve("/tempfile/arbormark-print-test.html");
        assert_eq!(status, 200);
        assert_eq!(mime, "text/html");
        assert!(String::from_utf8_lossy(&body).contains("print"));

        let (status, _, _) = resolve("/tempfile/../../../etc/hosts");
        assert_eq!(status, 403);

        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn returns_404_for_missing_asset() {
        let (status, _, _) = resolve("/definitely-missing-9f3c.css");
        assert_eq!(status, 404);
    }
}

#[cfg(test)]
mod read_route_tests {
    use super::*;
    use base64::Engine as _;

    fn encode(path: &str) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(path.as_bytes())
    }

    #[test]
    fn reads_an_absolute_file() {
        let dir = std::env::temp_dir().join(format!("arbormark-read-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.txt");
        std::fs::write(&file, b"hello").unwrap();

        let (status, _, body) = resolve(&format!("/__read__/{}", encode(&file.to_string_lossy())));
        assert_eq!(status, 200);
        assert_eq!(body, b"hello");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_relative_and_missing_paths() {
        let (status, _, _) = resolve(&format!("/__read__/{}", encode("relative.txt")));
        assert_eq!(status, 404);
        let (status, _, _) = resolve("/__read__/not-base64!!");
        assert_eq!(status, 400);
    }

    #[test]
    fn rejects_parent_dir_in_read_payload() {
        let traversing = if cfg!(windows) { r"C:\Users\..\Windows\win.ini" } else { "/etc/../etc/hosts" };
        let (status, _, _) = resolve(&format!("/__read__/{}", encode(traversing)));
        assert_eq!(status, 404, "带 .. 的读请求应被拒绝");
    }

    #[test]
    fn rejects_directories() {
        let dir = std::env::temp_dir();
        let (status, _, _) = resolve(&format!("/__read__/{}", encode(&dir.to_string_lossy())));
        assert_eq!(status, 404, "目录不是可读文件");
    }
}