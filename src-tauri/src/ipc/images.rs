//! `images.*` / `image.*`：图片文件操作域。
//!
//! 渲染层的 isNode 分支已经用 fs shim 覆盖了大多数场景（image-edit.js /
//! media-op.js 的 `File.isMac ? mac : isNode` 三元），这里的实现保证：
//! 1. mac 分支在 Tauri 下若被触达也有等价行为；
//! 2. 返回值形态与消费方期望一致（部分通道被 fire-and-forget，部分回调
//!    直接解构字段，见各函数注释）。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

fn arg_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

/// 复制文件到目标目录，目标名与源名相同；冲突时追加序号。
fn copy_into_dir(src: &Path, dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let file_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string());
    let mut dest = dir.join(&file_name);
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string());
    let ext = src.extension().map(|e| e.to_string_lossy().to_string());
    let mut counter = 1;
    while dest.exists() {
        let mut name = format!("{}-{}", stem.clone().unwrap_or_else(|| "image".into()), counter);
        if let Some(ext) = &ext {
            name.push('.');
            name.push_str(ext);
        }
        dest = dir.join(name);
        counter += 1;
    }
    std::fs::copy(src, &dest)?;
    Ok(dest)
}

/// 当前窗口正在编辑的文档所在目录（图片落地的默认位置）。
fn doc_dir(window: &tauri::WebviewWindow, state: &tauri::State<'_, crate::state::AppState>) -> Option<PathBuf> {
    state
        .target_file(window.label())
        .and_then(|p| Path::new(&p).parent().map(Path::to_path_buf))
}

/// `images.addToBundle({src})`：把图片复制进当前 textbundle 的 assets 目录。
///
/// 渲染层消费 `resp.filename`（`resp.filename ? resolve(...) : reject`）。
pub fn add_to_bundle(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let Some(src) = arg_str(payload, "src").map(PathBuf::from) else {
        return Ok(json!({}));
    };
    let Some(dir) = doc_dir(window, state) else {
        return Ok(json!({}));
    };
    let assets = dir.join("assets");
    match copy_into_dir(&src, &assets) {
        Ok(dest) => Ok(json!({ "filename": dest.file_name().map(|n| n.to_string_lossy().to_string()) })),
        Err(err) => {
            log::warn!("[images] addToBundle 复制失败: {err}");
            Ok(json!({}))
        }
    }
}

/// `images.copyImage({src, folder, ...})`：把图片复制进 `folder`。
///
/// 渲染层消费 `resp.success` / `resp.msg`（成功 resolve(msg)，失败 reject）。
pub fn copy_image(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let Some(src) = arg_str(payload, "src").map(PathBuf::from) else {
        return Ok(json!({ "success": false, "msg": "missing src" }));
    };
    // folder 是渲染层给的目标目录名；空/上传目录时落到文档目录。
    let folder = arg_str(payload, "folder").unwrap_or("");
    let base = doc_dir(window, state).unwrap_or_else(|| PathBuf::from("."));
    let dir = if folder.is_empty() || folder == "upload" {
        base
    } else {
        base.join(folder)
    };
    match copy_into_dir(&src, &dir) {
        Ok(dest) => Ok(json!({ "success": true, "msg": dest.to_string_lossy() })),
        Err(err) => Ok(json!({ "success": false, "msg": err.to_string() })),
    }
}

/// `images.savePNG(dataUri | {data, name})`：把 base64 图片写到临时文件。
///
/// 渲染层拿到 tempPath 后走「按偏好复制到目标目录」的流程（imageInsert.ts）。
/// 名称用时间戳保证连续粘贴互不覆盖；可选 name 提示用于保留原始文件名语义。
pub fn save_png(payload: &Value) -> Result<Value, String> {
    let (data, hint) = match payload {
        Value::String(text) => (text.as_str(), None),
        Value::Object(map) => (
            map.get("data").and_then(Value::as_str).unwrap_or(""),
            map.get("name").and_then(Value::as_str),
        ),
        _ => ("", None),
    };
    let header = &data[..data.find(',').unwrap_or(0)];
    let ext = if header.contains("jpeg") || header.contains("jpg") {
        "jpg"
    } else if header.contains("gif") {
        "gif"
    } else if header.contains("webp") {
        "webp"
    } else if header.contains("bmp") {
        "bmp"
    } else if header.contains("svg") {
        "svg"
    } else {
        "png"
    };
    let comma = match data.find(',') {
        Some(idx) => &data[idx + 1..],
        None => data,
    };
    let bytes = {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(comma)
            .map_err(|e| e.to_string())?
    };
    let mut stem = "image".to_string();
    if let Some(h) = hint {
        let cleaned: String = h
            .chars()
            .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
            .collect();
        let cleaned = cleaned.trim_matches('.').to_string();
        if !cleaned.is_empty() {
            stem = cleaned;
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join("arbormark");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut dest = dir.join(format!("{stem}-{ts}.{ext}"));
    let mut seq = 1;
    while dest.exists() {
        dest = dir.join(format!("{stem}-{ts}-{seq}.{ext}"));
        seq += 1;
    }
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(json!(dest.to_string_lossy()))
}

/// `images.selectImageSavePath({defaultName})`：另存图片的目标路径。
///
/// 渲染层 await 后直接得到路径字符串（image-edit.js:2073）。
pub fn select_image_save_path(
    app: &tauri::AppHandle,
    payload: &Value,
) -> Result<Value, String> {
    let mut builder = app.dialog().file();
    if let Some(name) = arg_str(payload, "defaultName") {
        builder = builder.set_file_name(name);
    }
    builder = builder.set_title("Copy and update image source to…");
    Ok(match builder.blocking_save_file() {
        Some(path) => json!(path.to_string()),
        None => Value::Null,
    })
}

/// `images.insertLocalImage(cb)`：弹多选框选本地图片，回调 `handleSelectedPaths`。
///
/// 渲染层回调签名 `handleSelectedPaths(filePaths)`（image-edit.js:1421）。
pub fn insert_local_image(app: &tauri::AppHandle) -> Result<Value, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"])
        .blocking_pick_files();
    let paths: Vec<String> = picked
        .unwrap_or_default()
        .iter()
        .map(|p| p.to_string())
        .collect();
    Ok(json!(paths))
}

/// `images.prepImageMove({folder})`：确保目标目录存在（旧版返回 "success" 才继续）。
pub fn prep_image_move(payload: &Value) -> Result<Value, String> {
    let folder = arg_str(payload, "folder").unwrap_or("");
    if !folder.is_empty() && folder != "upload" {
        if let Err(err) = std::fs::create_dir_all(folder) {
            log::warn!("[images] prepImageMove 建目录失败 {folder}: {err}");
            return Ok(json!("fail"));
        }
    }
    Ok(json!("success"))
}

/// `images.readDataUrl({path})`：读取本地图片/媒体/PDF 为 data URL。
/// 资产协议 scope 可能为空导致 convertFileSrc 被拒，渲染层改用此通道保证可加载。
/// 媒体文件上限 128 MiB（base64 经 JSON IPC 膨胀约 4/3，再大建议系统应用打开）。
pub fn read_data_url(payload: &Value) -> Result<Value, String> {
    const MAX_DATA_URL_BYTES: u64 = 128 * 1024 * 1024;
    let Some(path) = arg_str(payload, "path") else {
        return Ok(Value::Null);
    };
    let p = Path::new(path);
    if let Ok(meta) = std::fs::metadata(p) {
        if meta.len() > MAX_DATA_URL_BYTES {
            return Err(format!("文件过大（{} MiB），请用系统应用打开", meta.len() / 1024 / 1024));
        }
    }
    let bytes = std::fs::read(p).map_err(|e| format!("读取图片失败 {path}: {e}"))?;
    let mime = match p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" | "wave" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "mid" | "midi" => "audio/midi",
        _ => "application/octet-stream",
    };
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(json!(format!("data:{mime};base64,{b64}")))
}

/// `images.getScale(fileUrl)`：图片 DPI 缩放（mac 消费 data-pixel-ratio）。
/// 需要解码图片头；未实现时返回 null，渲染层 `isValidScale(null)` 直接跳过。
pub fn get_scale() -> Result<Value, String> {
    Ok(Value::Null)
}

/// `images.iPicValidateBeforeUpload`：iPic 图床上传（mac 专属服务）。
pub fn i_pic_validate_before_upload() -> Result<Value, String> {
    Ok(json!(false))
}

/// `images.upload`：图床上传（mac iPic）。
pub fn upload() -> Result<Value, String> {
    Ok(json!(false))
}

/// `images.startCopyAllImages([defaultFolder, isMove])`：批量复制文档图片。
/// mac-only 且 fire-and-forget；Tauri 渲染层 isNode 分支自行遍历。
pub fn start_copy_all_images() -> Result<Value, String> {
    Ok(json!(true))
}

/// `image.saveSVG({path, content})`：把 SVG 文本写到目标路径。
pub fn save_svg(payload: &Value) -> Result<Value, String> {
    let Some(path) = arg_str(payload, "path") else {
        return Ok(json!(false));
    };
    let content = arg_str(payload, "content").unwrap_or("");
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

/// `image.saveSVGDialog`：弹保存框写 SVG；Tauri 渲染层 isNode 分支已覆盖，
/// 这里等价实现（选择路径 → 写文件）。
pub fn save_svg_dialog(
    app: &tauri::AppHandle,
    payload: &Value,
) -> Result<Value, String> {
    let content = arg_str(payload, "content").unwrap_or("");
    let picked = app
        .dialog()
        .file()
        .add_filter("SVG", &["svg"])
        .blocking_save_file();
    let Some(dest) = picked else {
        return Ok(json!(false));
    };
    std::fs::write(dest.to_string(), content).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_png_decodes_data_uri_and_writes_file() {
        let payload = json!("data:image/png;base64,aGVsbG8=");
        let path = save_png(&payload).unwrap();
        let path = path.as_str().unwrap();
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(bytes, b"hello");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn save_svg_writes_content() {
        let dir = std::env::temp_dir().join(format!("arbormark-svg-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("t.svg");
        let payload = json!({ "path": file.to_string_lossy(), "content": "<svg/>" });
        assert_eq!(save_svg(&payload).unwrap(), json!(true));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "<svg/>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn prep_image_move_creates_directory() {
        let dir = std::env::temp_dir().join(format!("arbormark-prep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let payload = json!({ "folder": dir.to_string_lossy() });
        assert_eq!(prep_image_move(&payload).unwrap(), json!("success"));
        assert!(dir.is_dir());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn copy_into_dir_avoids_name_clash() {
        let base = std::env::temp_dir().join(format!("arbormark-copy-{}", std::process::id()));
        let src_dir = base.join("src");
        let dest_dir = base.join("dest");
        let _ = std::fs::create_dir_all(&src_dir);
        let _ = std::fs::create_dir_all(&dest_dir);
        let src = src_dir.join("pic.png");
        std::fs::write(&src, b"a").unwrap();
        let first = copy_into_dir(&src, &dest_dir).unwrap();
        assert_eq!(first.file_name().unwrap(), "pic.png");
        let second = copy_into_dir(&src, &dest_dir).unwrap();
        assert_eq!(second.file_name().unwrap(), "pic-1.png");
        let _ = std::fs::remove_dir_all(base);
    }
}
