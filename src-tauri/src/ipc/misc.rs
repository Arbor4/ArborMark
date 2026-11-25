//! 杂项应用通道。

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// `app.launchFile`：命令行/Dock 传入的启动文件路径（React 前端消费）。
///
/// setup 早期把 launch_file 作为局部变量用掉后不再暴露；这里从进程参数重新解析，
/// 并优先返回 pending_switch 里已挂起的目标（覆盖「会话恢复 + 新文件」竞态）。
/// 无启动文件时返回空字符串。
pub fn launch_file(app: &AppHandle) -> Result<Value, String> {
    let pending = app
        .try_state::<crate::state::AppState>()
        .and_then(|state| state.target_file("main"))
        .or_else(crate::pending_opened_file)
        .or_else(crate::startup::launch_file);
    Ok(Value::String(pending.unwrap_or_default()))
}

/// `preference.open`：打开偏好设置。
///
/// 遵循单一主窗口架构，直接通知主窗口唤起内嵌偏好设置面板，不再弹出独立子窗口。
pub fn open_preference(app: &tauri::AppHandle) -> Result<Value, String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(
            "arbor-event",
            json!({
                "channel": "open-preference",
                "payload": true
            }),
        );
    }
    Ok(json!(true))
}

pub fn download(payload: &Value) -> Result<Value, String> {
    let url = payload
        .as_str()
        .or_else(|| payload.get("url").and_then(Value::as_str))
        .ok_or("missing url")?;
    open::that(url).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// 渲染层 -> 所有窗口的事件广播（对应旧版 `app.sendEvent`）。
///
/// 旧渲染层调用形态是 `invoke("app.sendEvent", name, payload)`，
/// preload 会把它打包成 `[name, payload]`；bootstrap 的接收端固定监听
/// `arbor-event`，再按 `channel` 分发给 `ipcRenderer.on(name, ...)`。
/// 解析 `app.sendEvent` 的两种旧调用形态。
fn send_event_args(payload: &Value) -> (String, Value) {
    match payload {
        Value::Array(items) => (
            items
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            items.get(1).cloned().unwrap_or(Value::Null),
        ),
        Value::Object(map) => (
            map.get("event")
                .or_else(|| map.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            map.get("payload")
                .or_else(|| map.get("data"))
                .cloned()
                .unwrap_or(Value::Null),
        ),
        Value::String(event) => (event.clone(), Value::Null),
        _ => (String::new(), Value::Null),
    }
}

pub fn send_event(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let (event, data) = send_event_args(payload);
    if event.is_empty() {
        return Ok(Value::Null);
    }
    app.emit(
        "arbor-event",
        json!({ "channel": event, "payload": data }),
    )
    .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// `logger.*` / `app.log`：把渲染层日志并入 Rust 的日志输出。
pub fn log_message(level: &str, payload: &Value) -> Result<Value, String> {
    let message = if let Some(msg) = payload.get("message").and_then(Value::as_str) {
        msg.to_string()
    } else if let Some(s) = payload.as_str() {
        s.to_string()
    } else {
        payload.to_string()
    };

    match level {
        "error" => log::error!("[renderer] {message}"),
        "warn" => log::warn!("[renderer] {message}"),
        "debug" => log::debug!("[renderer] {message}"),
        _ => log::info!("[renderer] {message}"),
    }
    // 同时落到 startup.log：GUI 进程没有稳定可读的 stderr，日志重定向又容易
    // 绑错进程，把渲染层诊断信息写进持久化文件，排查问题时不用猜是哪个进程。
    crate::diagnostics::log(&format!("[renderer:{level}] {message}"));
    Ok(Value::Null)
}

const GITHUB_REPO: &str = "Arbor4/ArborMark";

pub(crate) fn make_curl_command(max_time_secs: u64) -> std::process::Command {
    let mut cmd = std::process::Command::new("curl");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        // Windows Schannel 在部分企业/代理网络下会因无法访问 CRL 导致 TLS 握手失败
        cmd.arg("--ssl-no-revoke");
    }
    cmd.args([
        "--connect-timeout",
        "6",
        "--max-time",
        &max_time_secs.to_string(),
        "-A",
        concat!("ArborMark/", env!("CARGO_PKG_VERSION")),
    ]);
    cmd
}

fn parse_github_release_json(body: &str) -> Option<(String, String, String, String)> {
    let v: Value = serde_json::from_str(body).ok()?;
    let tag = v.get("tag_name").and_then(Value::as_str)?.trim();
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    if latest.is_empty() {
        return None;
    }
    let release_url = v
        .get("html_url")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://github.com/{GITHUB_REPO}/releases/tag/{tag}"));
    let notes = v
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let published_at = v
        .get("published_at")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Some((latest, release_url, notes, published_at))
}

fn xml_between<'a>(src: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = src.find(open)? + open.len();
    let rest = &src[start..];
    let end = rest.find(close)?;
    Some(&rest[..end])
}

fn strip_basic_html(raw: &str) -> String {
    let decoded = raw
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let mut out = String::with_capacity(decoded.len());
    let mut in_tag = false;
    for ch in decoded.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.trim().to_string()
}

fn parse_releases_atom(xml: &str) -> Option<(String, String, String, String)> {
    let entry = xml_between(xml, "<entry>", "</entry>")?;
    let href = entry
        .split("href=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())?;
    let tag = href.rsplit('/').next()?.trim();
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    if latest.is_empty() {
        return None;
    }
    let published_at = xml_between(entry, "<updated>", "</updated>")
        .unwrap_or("")
        .trim()
        .to_string();
    let notes = entry
        .find("<content")
        .and_then(|i| {
            let after = &entry[i..];
            let gt = after.find('>')?;
            let inner = &after[gt + 1..];
            let end = inner.find("</content>")?;
            Some(strip_basic_html(&inner[..end]))
        })
        .unwrap_or_default();
    Some((latest, href.to_string(), notes, published_at))
}

fn parse_latest_redirect_headers(headers: &str) -> Option<(String, String)> {
    for line in headers.lines() {
        let Some((name, val)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("location") {
            let loc = val.trim();
            if loc.contains("/releases/tag/") {
                let tag = loc.rsplit('/').next()?.trim();
                let latest = tag.trim_start_matches(['v', 'V']).to_string();
                if !latest.is_empty() {
                    let url = if loc.starts_with("http") {
                        loc.to_string()
                    } else {
                        format!("https://github.com{loc}")
                    };
                    return Some((latest, url));
                }
            }
        }
    }
    None
}

fn fetch_latest_release_sync() -> Result<(String, String, String, String), String> {
    // 1. 首选 GitHub REST API（提供完整 Markdown 更新日志）
    let api_url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    if let Ok(out) = make_curl_command(10)
        .args([
            "-sL",
            "-H",
            "Accept: application/vnd.github.v3+json",
            "-w",
            "\n%{http_code}",
            &api_url,
        ])
        .output()
    {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            if let Some((body, code)) = raw.rsplit_once('\n') {
                if code.trim() == "200" {
                    if let Some(parsed) = parse_github_release_json(body) {
                        return Ok(parsed);
                    }
                }
            }
        }
    }

    // 2. 备用：GitHub Releases Atom Feed（无 60 次/小时 API 限流，返回最新标签与简要说明）
    let atom_url = format!("https://github.com/{GITHUB_REPO}/releases.atom");
    if let Ok(out) = make_curl_command(10).args(["-sL", &atom_url]).output() {
        if out.status.success() {
            let xml = String::from_utf8_lossy(&out.stdout);
            if let Some(parsed) = parse_releases_atom(&xml) {
                return Ok(parsed);
            }
        }
    }

    // 3. 兜底：轻量 HEAD 请求抓取 /releases/latest 的 302 Location（无 API 限流，体积极小）
    let latest_url = format!("https://github.com/{GITHUB_REPO}/releases/latest");
    if let Ok(out) = make_curl_command(10).args(["-sI", &latest_url]).output() {
        if out.status.success() {
            let headers = String::from_utf8_lossy(&out.stdout);
            if let Some((latest, release_url)) = parse_latest_redirect_headers(&headers) {
                return Ok((latest, release_url, String::new(), String::new()));
            }
        }
    }

    Err("无法连接到 GitHub Releases".to_string())
}

/// `updater.checkForUpdates`：通过多源容错（GitHub API → Releases Atom → 302 跳转）检查最新版本，
/// 规避 WebView CORS 限制与 GitHub API 匿名限流（HTTP 403）。
pub async fn check_for_updates() -> Result<Value, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let (latest, release_url, notes, published_at) =
        tauri::async_runtime::spawn_blocking(fetch_latest_release_sync)
            .await
            .map_err(|e| format!("检查更新任务异常: {e}"))??;
    Ok(json!({
        "currentVersion": current,
        "latestVersion": latest,
        "releaseUrl": release_url,
        "releaseNotes": notes,
        "publishedAt": published_at,
        "upToDate": latest == current,
        "version": current,
    }))
}

/// `license.*`：当前版本没有授权服务器，返回与旧重构版一致的固定值。
pub fn machine_code() -> Result<Value, String> {
    Ok(json!("ARBORMARK-RECON-VALID-CODE"))
}

pub fn license_activate(payload: &Value) -> Result<Value, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .unwrap_or("");
    log::info!("[license] activate 请求（未接入服务器）: {} 字符", key.len());
    Ok(json!(true))
}

pub fn license_deactivate() -> Result<Value, String> {
    Ok(json!(true))
}

/// `setting.showWelcome` / `app.showWelcome` / `welcome.show`
/// 欢迎指引：通知主窗口激活欢迎或关于面板，不再创建独立子窗口
pub fn show_welcome(app: &AppHandle) -> Result<Value, String> {
    let target = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(_, window)| window)
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = target {
        let _ = window.emit(
            "arbor-event",
            json!({
                "channel": "show-welcome-dialog",
                "payload": true
            }),
        );
        let _ = window.eval("if (window.File && window.File.megaMenu && window.File.megaMenu.showWelcome) { window.File.megaMenu.showWelcome(); }");
    }
    Ok(json!(true))
}

/// `setting.showLicense` / `license.show`
/// 许可证：收敛至主窗口偏好设置的 License 标签，不再创建独立子窗口
pub fn show_license(app: &AppHandle) -> Result<Value, String> {
    let target = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(_, window)| window)
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = target {
        let _ = window.emit(
            "arbor-event",
            json!({
                "channel": "show-preference-tab",
                "payload": "License"
            }),
        );
        let _ = window.eval("if (window.File && window.File.megaMenu && window.File.megaMenu.showLicensePanel) { window.File.megaMenu.showLicensePanel(); }");
    }
    Ok(json!(true))
}

/// `app.rendererReady`：渲染层初始化完成的第一份体检报告。
pub fn renderer_ready(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    log::info!(
        "[renderer] 初始化完成 hasFile={} hasEditor={} title={} theme={} bg={} href={}",
        payload.get("hasFile").and_then(Value::as_bool).unwrap_or(false),
        payload.get("hasEditor").and_then(Value::as_bool).unwrap_or(false),
        payload.get("title").and_then(Value::as_str).unwrap_or(""),
        payload.get("theme").and_then(Value::as_str).unwrap_or(""),
        payload.get("bodyBg").and_then(Value::as_str).unwrap_or(""),
        payload.get("themeHref").and_then(Value::as_str).unwrap_or("")
    );
    log::info!(
        "[renderer] tempPath={} writeLen={}",
        payload.get("tempPath").and_then(Value::as_bool).unwrap_or(false),
        payload.get("writeLen").and_then(Value::as_i64).unwrap_or(-1)
    );
    // 渲染层已就绪：显示窗口（建窗时是隐藏的，避免首帧闪无样式内容）。
    let _ = window.show();
    // show() 到窗口真正上屏有延迟；立刻 set_focus 会让系统在首帧之前
    // 把焦点从原窗口切走，原窗口标题栏会短暂发黑。等一帧后再抢焦点。
    let focus_window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(80));
        let _ = focus_window.set_focus();
    });
    // 渲染层已就绪：把建窗口时挂起的"要打开的文档"切过去。
    if payload.get("hasEditor").and_then(Value::as_bool).unwrap_or(false) {
        crate::windows::flush_pending_switch(app, window);
    }
    Ok(Value::Null)
}


/// `url.request(url)`：主进程代为抓取远程图片（绕过渲染层 CORS）。
///
/// 渲染层（text-range-util）消费 `{ type: mime, data: [字节块] }` 做 DPI 嗅探；
/// 字节块按 JSON 数组传输（`Buffer.from(chunk)` 兼容普通数组）。
/// 用系统 curl（Win10+/macOS/Linux 自带）避免引入 TLS 依赖。
pub fn url_request(payload: &Value) -> Result<Value, String> {
    let url = payload
        .as_str()
        .or_else(|| payload.get("url").and_then(Value::as_str))
        .unwrap_or("");
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(Value::Null);
    }
    let output = make_curl_command(15)
        .args(["-sL", "-w", "\n%{content_type}", url])
        .output();
    let Ok(output) = output else {
        return Ok(Value::Null);
    };
    if !output.status.success() {
        return Ok(Value::Null);
    }
    // curl 把 content_type 追加在最后一行，与 body 之间以 \n 分隔。
    let stdout = output.stdout;
    let split_at = stdout
        .iter()
        .rposition(|&b| b == b'\n')
        .unwrap_or(stdout.len());
    let body = &stdout[..split_at];
    let mime = String::from_utf8_lossy(&stdout[split_at + 1..])
        .trim()
        .split(';')
        .next()
        .unwrap_or("")
        .to_string();
    let bytes: Vec<Value> = body.iter().map(|b| json!(b)).collect();
    Ok(json!({ "type": mime, "data": [bytes] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_event_accepts_array_and_object_shapes() {
        assert_eq!(
            send_event_args(&json!(["willSave", "/tmp/a.md"])),
            ("willSave".to_string(), json!("/tmp/a.md"))
        );
        assert_eq!(
            send_event_args(&json!({ "event": "didRename", "payload": { "oldPath": "a" } })),
            ("didRename".to_string(), json!({ "oldPath": "a" }))
        );
        assert_eq!(send_event_args(&json!(["", null])).0, "");
    }

    #[test]
    fn parses_github_release_json_atom_and_redirect() {
        let json_body = r###"{
            "tag_name": "v4.0.4",
            "html_url": "https://github.com/Arbor4/ArborMark/releases/tag/v4.0.4",
            "body": "## What's New\n- Bug fixes",
            "published_at": "2026-11-25T12:00:00Z"
        }"###;
        let parsed_json = parse_github_release_json(json_body).expect("json");
        assert_eq!(parsed_json.0, "4.0.4");
        assert_eq!(parsed_json.1, "https://github.com/Arbor4/ArborMark/releases/tag/v4.0.4");
        assert!(parsed_json.2.contains("Bug fixes"));
        assert_eq!(parsed_json.3, "2026-11-25T12:00:00Z");

        let atom = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <updated>2026-11-24T15:08:35Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/Arbor4/ArborMark/releases/tag/v4.0.3"/>
    <title>ArborMark v4.0.3</title>
    <content type="html">&lt;p&gt;ArborMark v4.0.3&lt;/p&gt;</content>
  </entry>
</feed>"#;
        let parsed_atom = parse_releases_atom(atom).expect("atom");
        assert_eq!(parsed_atom.0, "4.0.3");
        assert_eq!(parsed_atom.1, "https://github.com/Arbor4/ArborMark/releases/tag/v4.0.3");
        assert_eq!(parsed_atom.2, "ArborMark v4.0.3");
        assert_eq!(parsed_atom.3, "2026-11-24T15:08:35Z");

        let headers = "HTTP/2 302 \r\nLocation: https://github.com/Arbor4/ArborMark/releases/tag/v4.0.5\r\n";
        let parsed_head = parse_latest_redirect_headers(headers).expect("redirect");
        assert_eq!(parsed_head.0, "4.0.5");
        assert_eq!(parsed_head.1, "https://github.com/Arbor4/ArborMark/releases/tag/v4.0.5");
    }
}
