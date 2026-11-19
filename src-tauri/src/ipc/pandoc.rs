//! `pandoc.*`：Pandoc 文档导入集成。
//!
//! 渲染层（io/pandoc.js）负责版本校验 UI 与流式转换；主进程职责：
//! - `pandoc.version`：探测 PATH 里的 pandoc 并返回版本字符串（≥2.0 视为可用）；
//! - `pandoc.setVersion`：渲染层显式登记版本（含 "false" 表示不可用）；
//! - `pandoc.import`：选文件 → pandoc 转 GFM → 写临时 md → 交给打开文档管线。

use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;

fn pandoc_version() -> Option<String> {
    let output = std::process::Command::new("pandoc")
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout);
    // "pandoc 3.1.9" → "3.1.9"
    first
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .map(str::to_string)
}

/// `pandoc.version`：版本字符串；未安装返回空串（渲染层据此弹安装指引）。
pub fn version() -> Result<Value, String> {
    Ok(json!(pandoc_version().unwrap_or_default()))
}

/// `pandoc.setVersion(versionStr)`：渲染层登记检测结果（fire-and-forget）。
pub fn set_version(payload: &Value) -> Result<Value, String> {
    let version = payload.as_str().unwrap_or("");
    log::info!("[pandoc] 渲染层登记版本: {version}");
    Ok(json!(true))
}

/// pandoc 导入支持的输入格式（与渲染层 importFormats 白名单一致）。
const IMPORT_FORMATS: [&str; 11] = [
    "latex", "ltx", "tex", "wiki", "dokuwiki", "docx", "rst", "rest", "org", "textile", "opml",
];

fn import_filter() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![(
        "Pandoc Importable",
        IMPORT_FORMATS.to_vec(),
    )]
}

/// `pandoc.import(isDiscardableUntitledImport)`：
/// 选择文件 → `pandoc -f <fmt> -t gfm-smart...` 转换 → 写临时 md → 打开。
///
/// 返回 `{ winId }` 与 app.openFile 一致（渲染层可能解构）。
pub fn import(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let _discardable = payload.as_bool().unwrap_or(false);

    let mut builder = app.dialog().file().set_title("Import with Pandoc");
    for (name, exts) in import_filter() {
        builder = builder.add_filter(name, &exts);
    }
    let Some(picked) = builder.blocking_pick_file() else {
        return Ok(json!({ "winId": Value::Null, "canceled": true }));
    };
    let src = picked.to_string();
    let ext = Path::new(&src)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMPORT_FORMATS.contains(&ext.as_str()) {
        return Err(format!("pandoc: 不支持的导入格式 .{ext}"));
    }

    let output = std::process::Command::new("pandoc")
        .args([
            &src,
            "--quiet",
            "--wrap=none",
            "-t",
            "gfm-smart+tex_math_dollars-fenced_divs-bracketed_spans-raw_html",
            "-o",
            "-",
        ])
        .output()
        .map_err(|e| format!("pandoc 运行失败（请确认已安装）: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "pandoc 转换失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let temp_md = std::env::temp_dir()
        .join("arbormark")
        .join(format!("import-{}.md", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)));
    std::fs::create_dir_all(temp_md.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&temp_md, output.stdout).map_err(|e| e.to_string())?;

    // 转换产物按普通文档打开（新窗口，与 app.openFile 管线一致）。
    let payload = json!({ "filePath": temp_md.to_string_lossy() });
    crate::ipc::document::open_file(app, state, &payload)
}

use std::path::Path;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_returns_empty_string_when_pandoc_missing_or_present() {
        // 两种环境都要返回字符串：渲染层对 undefined 会走异常分支。
        let result = version().unwrap();
        assert!(result.is_string());
        if let Some(v) = result.as_str() {
            if !v.is_empty() {
                // 有 pandoc 时版本必须可解析为数字开头
                assert!(
                    v.chars().next().unwrap().is_ascii_digit(),
                    "版本号应以数字开头: {v}"
                );
            }
        }
    }

    #[test]
    fn import_formats_cover_renderer_whitelist() {
        // 渲染层 importFormats 白名单（file-action.js:334）必须全部可导入。
        for fmt in [
            "latex", "ltx", "tex", "wiki", "dokuwiki", "docx", "rst", "rest", "org", "textile",
            "opml",
        ] {
            assert!(IMPORT_FORMATS.contains(&fmt), "缺少格式 {fmt}");
        }
    }
}
