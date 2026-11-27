//! `pandoc.*`：Pandoc 文档导入与多格式导出集成。
//!
//! - `pandoc.version`：探测 PATH 或自定义路径里的 pandoc 并返回版本字符串；
//! - `pandoc.setVersion`：渲染层显式登记版本；
//! - `pandoc.import`：支持弹窗选文件或直接传入 filePath → pandoc 转 GFM → 打开；
//! - `pandoc.export`：通过 pandoc 将 Markdown 导出为 docx / odt / rtf / epub / latex / rst 等格式。

use serde_json::{json, Value};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

fn resolve_pandoc_bin(custom_path: Option<&str>) -> String {
    let trimmed = custom_path.unwrap_or("").trim();
    if trimmed.is_empty() {
        "pandoc".to_string()
    } else {
        trimmed.to_string()
    }
}

fn new_pandoc_cmd(bin: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn pandoc_version_with(bin: &str) -> Option<String> {
    let output = new_pandoc_cmd(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout);
    first
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .map(str::to_string)
}

/// `pandoc.version`：支持传入 `{ pandocPath }` 或读取全局设置，未安装返回空串。
pub fn version(state: Option<&crate::state::AppState>, payload: Option<&Value>) -> Result<Value, String> {
    let from_payload = payload
        .and_then(|p| p.get("pandocPath").and_then(Value::as_str).or_else(|| p.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let from_state = state.and_then(|s| {
        s.get("pandocPath")
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    });
    let bin = resolve_pandoc_bin(from_payload.as_deref().or(from_state.as_deref()));
    Ok(json!(pandoc_version_with(&bin).unwrap_or_default()))
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
    vec![("Pandoc Importable", IMPORT_FORMATS.to_vec())]
}

/// `pandoc.import`：支持直接传 `{ filePath, pandocPath }` 或弹窗选文件 → 转 GFM → 打开。
pub fn import(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let custom_bin = payload
        .get("pandocPath")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            state
                .get("pandocPath")
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
        });
    let bin = resolve_pandoc_bin(custom_bin.as_deref());

    let direct_path = payload
        .get("filePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let src = match direct_path {
        Some(p) => p,
        None => {
            let mut builder = app.dialog().file().set_title("Import with Pandoc");
            for (name, exts) in import_filter() {
                builder = builder.add_filter(name, &exts);
            }
            let Some(picked) = builder.blocking_pick_file() else {
                return Ok(json!({ "winId": Value::Null, "canceled": true }));
            };
            picked.to_string()
        }
    };

    let ext = Path::new(&src)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMPORT_FORMATS.contains(&ext.as_str()) {
        return Err(format!("pandoc: 不支持的导入格式 .{ext}"));
    }

    let output = new_pandoc_cmd(&bin)
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

    let stem = Path::new(&src)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "import".to_string());
    let temp_md = std::env::temp_dir()
        .join("arbormark")
        .join(format!(
            "{stem}-{}.md",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
    std::fs::create_dir_all(temp_md.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&temp_md, output.stdout).map_err(|e| e.to_string())?;

    let payload = json!({ "filePath": temp_md.to_string_lossy() });
    crate::ipc::document::open_file(app, state, &payload)
}

fn map_export_target(format: &str) -> Option<&'static str> {
    match format.to_lowercase().as_str() {
        "docx" | "word" => Some("docx"),
        "odt" | "openoffice" => Some("odt"),
        "rtf" => Some("rtf"),
        "epub" => Some("epub"),
        "latex" | "tex" => Some("latex"),
        "mediawiki" | "wiki" => Some("mediawiki"),
        "rst" | "rest" | "restructuredtext" => Some("rst"),
        "textile" => Some("textile"),
        "opml" => Some("opml"),
        _ => None,
    }
}

/// `pandoc.export` / `export.<format>`：把 Markdown 文本通过 pandoc 导出为指定格式文件。
pub fn export(
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let format = payload
        .get("format")
        .or_else(|| payload.get("type"))
        .and_then(Value::as_str)
        .ok_or("缺少导出格式")?;
    let target_fmt = map_export_target(format).ok_or_else(|| format!("不支持的 Pandoc 导出格式: {format}"))?;
    let output_path = payload
        .get("outputPath")
        .or_else(|| payload.get("path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("缺少输出文件路径")?;
    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("");
    let source_path = payload
        .get("sourcePath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let custom_bin = payload
        .get("pandocPath")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            state
                .get("pandocPath")
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
        });
    let bin = resolve_pandoc_bin(custom_bin.as_deref());

    let temp_dir = std::env::temp_dir().join("arbormark");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_in = temp_dir.join(format!(
        "export-in-{}.md",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::write(&temp_in, content).map_err(|e| e.to_string())?;

    if let Some(parent) = Path::new(output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut cmd = new_pandoc_cmd(&bin);
    cmd.arg(&temp_in)
        .args(["--from=gfm+tex_math_dollars", "--to", target_fmt, "--standalone"]);
    if !source_path.is_empty() {
        if let Some(dir) = Path::new(source_path).parent() {
            cmd.arg(format!("--resource-path={}", dir.to_string_lossy()));
        }
    }
    cmd.args(["-o", output_path]);

    let result = cmd.output();
    let _ = std::fs::remove_file(&temp_in);

    let output = result.map_err(|e| format!("pandoc 运行失败（请确认已安装或检查路径配置）: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "pandoc 导出失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(json!({ "ok": true, "path": output_path }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_returns_empty_string_when_pandoc_missing_or_present() {
        let result = version(None, None).unwrap();
        assert!(result.is_string());
        if let Some(v) = result.as_str() {
            if !v.is_empty() {
                assert!(
                    v.chars().next().unwrap().is_ascii_digit(),
                    "版本号应以数字开头: {v}"
                );
            }
        }
    }

    #[test]
    fn import_formats_cover_renderer_whitelist() {
        for fmt in [
            "latex", "ltx", "tex", "wiki", "dokuwiki", "docx", "rst", "rest", "org", "textile",
            "opml",
        ] {
            assert!(IMPORT_FORMATS.contains(&fmt), "缺少格式 {fmt}");
        }
    }

    #[test]
    fn export_format_mapping_covers_supported_targets() {
        for fmt in ["docx", "odt", "rtf", "epub", "latex", "mediawiki", "rst", "textile", "opml"] {
            assert!(map_export_target(fmt).is_some(), "缺少导出目标映射 {fmt}");
        }
        assert!(map_export_target("unknown").is_none());
    }
}
