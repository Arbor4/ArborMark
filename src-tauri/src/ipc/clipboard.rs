//! 剪贴板（`arboard`）。

use std::borrow::Cow;

use arboard::Clipboard;
use base64::Engine as _;
use serde_json::{json, Value};

fn with_clipboard<T>(f: impl FnOnce(&mut Clipboard) -> Result<T, String>) -> Result<T, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    f(&mut clipboard)
}

/// 渲染层 `invoke(channel, a, b)` 会被 bootstrap 打包成 `[a, b]`；
/// 真正的有效载荷永远是数组的第一个元素。
fn first_arg(payload: &Value) -> &Value {
    match payload {
        Value::Array(items) => items.first().unwrap_or(&Value::Null),
        other => other,
    }
}

/// 渲染层可能传对象，也可能传 `JSON.stringify({ html, text })` 的字符串。
#[cfg(test)]
fn text_from_payload(payload: &Value) -> Option<String> {
    let payload = first_arg(payload);
    let data = match payload {
        Value::String(raw) => serde_json::from_str(raw).unwrap_or(Value::Null),
        other => other.clone(),
    };
    data.get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| payload.as_str().filter(|text| !text.trim_start().starts_with('{')).map(str::to_string))
}

/// `clipboard.readFilePaths`：返回剪贴板中的文件路径。
///
/// Windows = 资源管理器「复制」文件时的 CF_HDROP；剪贴板只有位图（截图等）
/// 时返回空数组，渲染层据此回退到「临时 PNG → 按偏好规则入库」的流程。
pub fn read_file_paths() -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        windows_file_paths()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(json!([]))
    }
}

#[cfg(target_os = "windows")]
fn windows_file_paths() -> Result<Value, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

    const CF_HDROP: u32 = 15;
    let mut out: Vec<String> = Vec::new();
    unsafe {
        if OpenClipboard(null_mut()) == 0 {
            return Ok(json!(out));
        }
        let hdrop = GetClipboardData(CF_HDROP);
        if !hdrop.is_null() {
            let count = DragQueryFileW(hdrop as HDROP, u32::MAX, null_mut(), 0);
            let mut buf = vec![0u16; 4096];
            for index in 0..count {
                let len = DragQueryFileW(hdrop as HDROP, index, buf.as_mut_ptr(), buf.len() as u32);
                if len > 0 && (len as usize) < buf.len() {
                    out.push(String::from_utf16_lossy(&buf[..len as usize]));
                }
            }
        }
        CloseClipboard();
    }
    Ok(json!(out))
}

pub fn read_text() -> Result<Value, String> {
    match with_clipboard(|c| c.get_text().map_err(|e| e.to_string())) {
        Ok(text) => Ok(json!(text)),
        // 剪贴板为空不是错误，返回空串（与 Electron 行为一致）
        Err(_) => Ok(json!("")),
    }
}

pub fn read_html() -> Result<Value, String> {
    Ok(json!(""))
}

pub fn write_text(payload: &Value) -> Result<Value, String> {
    let text = first_arg(payload).as_str().unwrap_or_default().to_string();
    with_clipboard(|c| c.set_text(text).map_err(|e| e.to_string()))?;
    Ok(Value::Null)
}

pub fn write(payload: &Value) -> Result<Value, String> {
    // 渲染层调用的是 `clipboard.write` + JSON.stringify({html, text})，
    // 所以 payload 到这里可能是字符串而不是对象；之前只按对象取 text，
    // 结果“复制文件路径 / 复制链接”写了个寂寞。
    let data = first_arg(payload);
    let obj = match data {
        Value::String(raw) => serde_json::from_str(raw).unwrap_or(Value::Null),
        other => other.clone(),
    };
    let text = obj
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| data.as_str().filter(|t| !t.trim_start().starts_with('{')).map(str::to_string));
    let html = obj.get("html").and_then(Value::as_str).map(str::to_string);
    if let Some(text) = text {
        with_clipboard(|c| {
            if let Some(html) = html {
                // 语义 HTML：写 text/html flavor，alt 文本作为 plain 回退。
                // Linux 不支持 set_html 时回退纯文本。
                if c.set_html(html, Some(text.clone())).is_ok() {
                    return Ok(());
                }
            }
            c.set_text(text).map_err(|e| e.to_string())
        })?;
    }
    Ok(Value::Null)
}


/// `clipboard.readImage`：把系统剪贴板里的图片编码成 PNG data URL。
///
/// 渲染层 `JSBridge.clipboard.readImage()`（sidebar-resizer 的 shim）等待的就是
/// 这个 data URL：它去掉前缀后按 base64 写到目标目录，再插入 Markdown。
/// 之前这里和 `writeImage` 一起返回 `null`，所以粘贴图片永远没有反应。
pub fn read_image() -> Result<Value, String> {
    let image = match with_clipboard(|clipboard| {
        clipboard.get_image().map_err(|e| e.to_string())
    }) {
        Ok(image) => image,
        // 剪贴板里没有图片是正常情况，交给调用方回退到纯文本粘贴。
        Err(_) => return Ok(Value::Null),
    };

    let data_url = rgba_to_png_data_url(image.width, image.height, &image.bytes)?;
    Ok(json!(data_url))
}

/// `clipboard.writeImage`：把 data URL 或本地图片文件写入系统剪贴板。
///
/// 旧实现同样是 `Ok(Value::Null)`，导致"复制图片"也没有效果。
pub fn write_image(payload: &Value) -> Result<Value, String> {
    let payload = first_arg(payload);
    let source = payload
        .get("dataURL")
        .and_then(Value::as_str)
        .or_else(|| payload.get("path").and_then(Value::as_str))
        .or_else(|| payload.as_str());

    let Some(source) = source else {
        return Ok(json!(false));
    };

    let bytes = if source.starts_with("data:") {
        data_url_bytes(source)?
    } else {
        std::fs::read(source).map_err(|e| format!("读取图片失败 {source}: {e}"))?
    };

    let decoded = image::load_from_memory(&bytes)
        .map_err(|e| format!("无法解析图片: {e}"))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();

    with_clipboard(|clipboard| {
        clipboard
            .set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: Cow::Owned(rgba.into_raw()),
            })
            .map_err(|e| e.to_string())
    })?;

    Ok(json!(true))
}

fn rgba_to_png_data_url(width: usize, height: usize, bytes: &[u8]) -> Result<String, String> {
    let image = image::RgbaImage::from_raw(width as u32, height as u32, bytes.to_vec())
        .ok_or_else(|| "剪贴板图片尺寸与像素数据不匹配".to_string())?;
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut png),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("PNG 编码失败: {e}"))?;

    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

fn data_url_bytes(source: &str) -> Result<Vec<u8>, String> {
    let (_, encoded) = source
        .split_once(',')
        .ok_or_else(|| "无效的 data URL".to_string())?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| format!("data URL 解码失败: {e}"))
}

/// `clipboard.postCopy`：mac 通知主进程复制已完成（同步 Touch Bar 状态等）。
/// 渲染层 fire-and-forget；接受即可。
pub fn post_copy() -> Result<Value, String> {
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::{data_url_bytes, rgba_to_png_data_url, text_from_payload};
    use serde_json::json;

    #[test]
    fn accepts_json_string_payload() {
        let payload = json!(r#"{"html":"<span>/tmp/a.md</span>","text":"/tmp/a.md"}"#);
        assert_eq!(text_from_payload(&payload).as_deref(), Some("/tmp/a.md"));
    }

    #[test]
    fn accepts_object_payload() {
        let payload = json!({ "text": "/tmp/b.md" });
        assert_eq!(text_from_payload(&payload).as_deref(), Some("/tmp/b.md"));
    }

    #[test]
    fn ignores_missing_text() {
        assert_eq!(text_from_payload(&json!({ "html": "<b>x</b>" })), None);
        assert_eq!(text_from_payload(&json!(null)), None);
    }

    /// `setClipboard` 是 `invoke("clipboard.write", json, clearIfNull)` —— 两个参数会被
    /// 打包成数组，之前只认对象/字符串，"复制文件路径"因此写了个寂寞。
    #[test]
    fn accepts_array_payload() {
        let payload = json!([r#"{"html":"<span>x</span>","text":"C:\\a b\\c.md"}"#, true]);
        assert_eq!(text_from_payload(&payload).as_deref(), Some("C:\\a b\\c.md"));
    }

    #[test]
    fn decodes_png_data_url() {
        let bytes = data_url_bytes("data:image/png;base64,aGVsbG8=").expect("decode");
        assert_eq!(bytes, b"hello");
    }

    #[test]
    fn clipboard_rgba_is_encoded_as_png_data_url() {
        let url = rgba_to_png_data_url(1, 1, &[255, 0, 0, 255]).expect("encode");
        assert!(url.starts_with("data:image/png;base64,"));
        let bytes = data_url_bytes(&url).expect("decode");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }
}
