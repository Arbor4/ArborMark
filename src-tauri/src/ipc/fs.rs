//! 新前端（src/web）的文件系统 IPC 通道。
//!
//! 与旧渲染层的 nodebridge fs shim 不同，这里提供面向 JSON 的简洁契约：
//!   fs.readDir / fs.readFile / fs.writeFile / fs.stat / fs.createDir / fs.importFiles
//!   app.themeDir
//!
//! 路径统一接受 "/" 分隔（Windows 上 std::fs 同样识别）；mtime 以毫秒返回。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// 文件树不展示的内部/运行时隐藏目录（.github/.idea 等正常隐藏目录仍显示）。
const HIDDEN_DENYLIST: [&str; 10] = [
    ".git",
    ".DS_Store",
    ".toolchain",
    ".dev-data",
    ".dev-webview",
    ".test-data",
    ".npm-cache",
    ".workbuddy",
    ".electron-cache",
    ".vscode",
];

fn arg_str(payload: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = payload.get(key).and_then(Value::as_str) {
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `fs.readDir`：列出直接子项，目录优先、按名排序。
/// 显示 .github/.idea 等隐藏目录，但跳过内部/运行时目录（.git、缓存等）。
pub fn read_dir(payload: &Value) -> Result<Value, String> {
    let dir = arg_str(payload, &["path"]).ok_or("缺少 path")?;
    let started = std::time::Instant::now();
    let mut out: Vec<Value> = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("无法读取目录: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if HIDDEN_DENYLIST.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        // 目录用 d_type 判断（免 stat）；仅文件 stat 取大小/时间，大目录提速明显
        let Ok(ft) = entry.file_type() else { continue };
        let is_dir = ft.is_dir();
        let (size, mtime) = if is_dir {
            (0, 0)
        } else {
            match entry.metadata() {
                Ok(m) => (m.len(), mtime_ms(&m)),
                Err(_) => (0, 0),
            }
        };
        out.push(json!({
            "name": name,
            "path": path.to_string_lossy(),
            "isDir": is_dir,
            "size": size,
            "mtime": mtime,
        }));
    }
    out.sort_by(|a, b| {
        let ad = a["isDir"].as_bool().unwrap_or(false);
        let bd = b["isDir"].as_bool().unwrap_or(false);
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        bd.cmp(&ad).then_with(|| an.to_lowercase().cmp(&bn.to_lowercase()))
    });
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    if elapsed_ms > 200.0 {
        log::info!("[fs] read_dir 慢目录 {}：{} 项，耗时 {:.0}ms", dir, out.len(), elapsed_ms);
    }
    Ok(json!(out))
}

/// `fs.readFile`：读取文本（UTF-8，容忍 BOM）。
/// 二进制防呆：前 8KB 出现 NUL 字节即拒绝，避免 lnk/exe/zip 等以乱码文本打开。
pub fn read_file(payload: &Value) -> Result<Value, String> {
    let path = arg_str(payload, &["path"]).ok_or("缺少 path")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取文件: {e}"))?;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err("binary file".to_string());
    }
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
    Ok(json!(text))
}

/// `fs.writeFile`：写入文本（自动创建父目录）。
pub fn write_file(payload: &Value) -> Result<Value, String> {
    let path = arg_str(payload, &["path"]).ok_or("缺少 path")?;
    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("");
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&target, content).map_err(|e| format!("无法写入文件: {e}"))?;
    Ok(json!(true))
}

/// `fs.stat`：返回存在性与元信息。
pub fn stat(payload: &Value) -> Result<Value, String> {
    let path = arg_str(payload, &["path"]).ok_or("缺少 path")?;
    match std::fs::metadata(&path) {
        Ok(meta) => Ok(json!({
            "exists": true,
            "isDir": meta.is_dir(),
            "size": meta.len(),
            "mtime": mtime_ms(&meta),
        })),
        Err(_) => Ok(json!({ "exists": false, "isDir": false, "size": 0, "mtime": 0 })),
    }
}

/// `fs.createDir`：递归创建目录。
pub fn create_dir(payload: &Value) -> Result<Value, String> {
    let path = arg_str(payload, &["path"]).ok_or("缺少 path")?;
    std::fs::create_dir_all(&path).map_err(|e| format!("无法创建目录: {e}"))?;
    Ok(json!(true))
}

/// `fs.importFiles`：把外部文件/文件夹复制进工作区（OS 拖拽导入、粘贴复制）。
pub fn import_files(payload: &Value) -> Result<Value, String> {
    let target_dir = arg_str(payload, &["targetDir"]).ok_or("缺少 targetDir")?;
    let paths = payload
        .get("paths")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let target_root = PathBuf::from(&target_dir);
    let mut count = 0u64;
    for value in paths {
        let Some(src) = value.as_str() else { continue };
        let src_path = Path::new(src);
        if !src_path.exists() {
            continue;
        }
        // 把父目录拖进自己的子孙目录会无限递归，直接跳过
        if src_path.is_dir() && target_root.starts_with(src_path) {
            continue;
        }
        let Some(name) = src_path.file_name() else { continue };
        let mut dest = target_root.join(name);
        // 同名自动加序号，避免覆盖
        let mut i = 2;
        let stem = src_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = src_path.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
        while dest.exists() {
            dest = target_root.join(format!("{stem} {i}{ext}"));
            i += 1;
        }
        let copied = if src_path.is_dir() {
            let ok = super::library::copy_dir(src_path, &dest).is_ok();
            if !ok {
                let _ = std::fs::remove_dir_all(&dest);
            }
            ok
        } else {
            std::fs::copy(src_path, &dest).is_ok()
        };
        if copied {
            count += 1;
        }
    }
    Ok(json!(count))
}

/// `app.themeDir`：用户主题目录（userData/themes），不存在则创建。
pub fn theme_dir() -> Result<Value, String> {
    let dir = crate::protocol::data_root().join("userData").join("themes");
    let _ = std::fs::create_dir_all(&dir);
    Ok(json!(dir.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arbormark-fs-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn imports_files_and_directories_with_rename() {
        let src = temp_dir("src");
        let target = temp_dir("target");
        let file = src.join("a.md");
        std::fs::write(&file, "hello").unwrap();
        let folder = src.join("pics");
        std::fs::create_dir_all(folder.join("sub")).unwrap();
        std::fs::write(folder.join("sub").join("b.png"), "img").unwrap();
        std::fs::write(target.join("a.md"), "existing").unwrap();

        let count = import_files(&json!({
            "targetDir": target.to_string_lossy(),
            "paths": [file.to_string_lossy(), folder.to_string_lossy()],
        }))
        .unwrap();
        assert_eq!(count, json!(2));
        assert_eq!(std::fs::read_to_string(target.join("a.md")).unwrap(), "existing");
        assert!(target.join("a 2.md").exists());
        assert!(target.join("pics").join("sub").join("b.png").exists());

        let _ = std::fs::remove_dir_all(src);
        let _ = std::fs::remove_dir_all(target);
    }

    #[test]
    fn refuses_importing_directory_into_itself() {
        let src = temp_dir("self");
        let inner = src.join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        let count = import_files(&json!({
            "targetDir": inner.to_string_lossy(),
            "paths": [src.to_string_lossy()],
        }))
        .unwrap();
        assert_eq!(count, json!(0));
        let _ = std::fs::remove_dir_all(src);
    }
}