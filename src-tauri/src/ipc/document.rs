//! `document.*` / `app.openFile*` 通道。
//!
//! 打开文件/文件夹会**派生新窗口**（`doc-<n>`），窗口由 `windows::build` 统一创建，
//! 加载完成后再切到目标文档。
//!
//! 注意返回值契约：渲染层存在 `JSBridge.invoke("app.openFile").then(({winId}) => ...)`
//! 这样的解构，返回 `null` 会直接抛 TypeError，因此这里始终返回 `{ winId }`。

use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

fn payload_path(payload: &Value) -> Option<String> {
    payload
        .get("filePath")
        .and_then(Value::as_str)
        .or_else(|| payload.get("targetFile").and_then(Value::as_str))
        .or_else(|| payload.get("path").and_then(Value::as_str))
        .or_else(|| payload.as_str())
        // preload 把 `invoke("app.openFileOrFolder", path, opts)` 打包成数组。
        .or_else(|| {
            payload
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str)
        })
        .filter(|value| !value.is_empty())
        .map(crate::paths::native)
}

/// 解析打开文件/文件夹的参数与可选的 mountFolder。
///
/// 旧渲染层有两种调用：`openFileOrFolder(path, {mountFolder})`（数组）
/// 与 `openFile({filePath, mountFolder})`（对象）。
fn open_args(payload: &Value) -> (Option<String>, Option<String>) {
    let mut path = payload_path(payload);
    let mut mount = payload
        .get("mountFolder")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if let Some(items) = payload.as_array() {
        if let Some(options) = items.get(1).and_then(Value::as_object) {
            if let Some(value) = options
                .get("mountFolder")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                mount = Some(value.to_string());
            }
            if path.is_none() {
                path = options
                    .get("filePath")
                    .or_else(|| options.get("path"))
                    .or_else(|| options.get("targetFile"))
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
            }
        }
    }
    (path, mount)
}

/// 根据当前软件语言解析内置 Docs 文件的多语言版本路径。
/// 若存在对应的语言子目录（如 `Docs/zh-Hans/xxx.md` 或 `Docs/en/xxx.md`），则返回对应路径；
/// 否则回退原路径。
pub fn resolve_localized_doc_path(path_str: &str, locale: &str) -> String {
    let normalized = path_str.replace('\\', "/");
    let docs_idx = match normalized.rfind("/Docs/") {
        Some(idx) => idx,
        None => return path_str.to_string(),
    };

    let rel_part = &normalized[docs_idx + "/Docs/".len()..];
    // 如果已经包含语言子文件夹，比如 "zh-Hans/Quick Start.md" 或 "en/..."，直接返回
    if rel_part.contains('/') {
        return path_str.to_string();
    }
    if !rel_part.ends_with(".md") {
        return path_str.to_string();
    }

    // 语言目录按优先级：当前语言 → 繁体中文回退简体 → 英文。
    // Base 是英文目录名；其余语言没有翻译时也回退英文，保证帮助文档永远可打开。
    let base_docs_dir = std::path::Path::new(&path_str[..docs_idx + "/Docs".len()]);
    let mut lang_dirs: Vec<&str> = Vec::new();
    if locale == "Base" || locale.is_empty() {
        lang_dirs.push("en");
    } else {
        // 瑞士德语没有单独的 Docs 目录，复用德语版本。
        let primary = if locale == "de-CH" { "de-DE" } else { locale };
        lang_dirs.push(primary);
        if locale == "zh-Hant" {
            lang_dirs.push("zh-Hans");
        }
        if primary != "en" {
            lang_dirs.push("en");
        }
    }

    for lang_dir in lang_dirs {
        // 语言目录里的文件名可以是本地化的（例如 `快速开始.md`）。
        // manifest.json 保存「英文 canonical 文件名 -> 本地化文件名」，
        // 帮助菜单仍然用英文文件名请求，由这里映射。
        let localized = localized_doc_filename(base_docs_dir, lang_dir, rel_part)
            .unwrap_or_else(|| rel_part.to_string());
        let candidate = base_docs_dir.join(lang_dir).join(localized);
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }

    path_str.to_string()
}

fn localized_doc_filename(base_docs_dir: &Path, lang_dir: &str, rel_part: &str) -> Option<String> {
    let manifest = std::fs::read_to_string(base_docs_dir.join(lang_dir).join("manifest.json")).ok()?;
    let value: Value = serde_json::from_str(&manifest).ok()?;
    value
        .as_object()?
        .get(rel_part)
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// 新建文档窗口（`app.openFile` / `document.newWindow` / `controller.openInNewWindow`）。
///
/// 与旧版一致：打开文件/文件夹都会派生新窗口，而不是复用当前窗口；
/// 新窗口加载同一套 React 前端，并在就绪后切到目标文档。
pub fn new_window(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let label = format!("doc-{}", state.next_window_seq());
    let (target, mut mount) = open_args(payload);
    let target = target.map(|p| {
        let user_language = state.get("userLanguage").as_str().unwrap_or("").to_string();
        let locale = crate::locale::resolve_app_locale(Some(&user_language));
        resolve_localized_doc_path(&p, &locale)
    });
    let is_dir = target
        .as_deref()
        .map(|path| std::path::Path::new(path).is_dir())
        .unwrap_or(false);

    // 目录挂载进最近列表（新前端 openDefault 取第一个）；文件路径等页面
    // 就绪后由 pending_switch -> doSwitchByNode 切换。
    let mut open_file_path: Option<String> = None;

    if is_dir {
        mount = target.clone();
        if let Some(folder) = target.as_deref() {
            state.push_recent("folder", folder, 20);
        }
    } else if let Some(path) = target.as_deref() {
        open_file_path = Some(path.to_string());
        if mount.is_none() {
            mount = std::path::Path::new(path)
                .parent()
                .map(|parent| parent.to_string_lossy().to_string());
        }
        if let Some(folder) = mount.as_deref() {
            state.push_recent("folder", folder, 20);
        }
    }

    if target.is_some() {
        state.set_last_session(Some(target.as_deref()), Some(mount.as_deref()));
    } else if mount.is_some() {
        state.set_last_session(None, Some(mount.as_deref()));
    }

    crate::windows::build(app, &label).map_err(|e| e.to_string())?;

    if let Some(path) = open_file_path {
        // 登记该窗口打开的文档路径。缺了这一步，后续 `doc.syncChange` /
        // `syncFullContent` 查 `target_file(label)` 会拿到 None，多窗口同文档
        // 的实时同步（以及其他按窗口查路径的逻辑）全部静默失效。
        state.set_target_file(&label, Some(path.clone()));
        // 渲染层 ready 后由 flush_pending_switch 切一次（不再自旋等 DOM）。
        state.set_pending_switch(&label, &path);
    }

    Ok(json!({ "winId": label }))
}

/// `app.openFile` / `app.openFileOrFolder` / `app.openFolder`
pub fn open_file(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    new_window(app, state, payload)
}


/// `app.openFolder` / `controller.openFolder`：派生新窗口。
/// 文件夹挂载（mountFolder）尚未在渲染层接通，先建空窗口避免调用方报错。
pub fn open_folder(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    new_window(app, state, payload)
}

/// `document.switchDocument`
/// `document.switchDocument(filePath)`：**返回快照 JSON 字符串**，与旧主进程一致。
///
/// 渲染层把它当作 `payloadJson` 解析后取 `filePath` 再读盘；早期这里返回了 `true`
/// 并顺手触发了 doSwitchByNode，于是既拿不到路径、又造成 loadFile <-> doSwitchByNode
/// 的无限递归（打开文档表现为卡死）。
pub fn switch_document(
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    let path = payload_path(payload).unwrap_or_default();
    if path.is_empty() {
        return snapshot_json(&json!({
            "snap": null,
            "filePath": "",
            "backups": null,
            "shouldReadFromDisk": false,
        }));
    }

    state.set_target_file(window.label(), Some(path.clone()));
    state.push_recent("file", &path, 20);

    // 恢复上次会话依赖这里：切换文档 = 当前文件发生变化。
    let mount = payload
        .get("mountFolder")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    state.set_last_session(Some(Some(path.as_str())), mount.map(Some));

    snapshot_json(&json!({
        "snap": null,
        "filePath": path,
        "backups": null,
        "shouldReadFromDisk": true,
    }))
}

/// `document.addSnapAndLastSync`：旧实现恒为 true。
pub fn add_snap_and_last_sync() -> Result<Value, String> {
    Ok(json!(true))
}

/// `document.isDocumentEdited`（同步通道，实际由 bootstrap 的 callSync 直接回答）
pub fn is_document_edited() -> Result<Value, String> {
    Ok(json!(false))
}

/// 兜底：尚未迁移的 `document.*` 通道，保持 null 语义。
pub fn handle_fallback(channel: &str, _payload: &Value) -> Result<Value, String> {
    log::debug!("[document] 通道尚未迁移: {channel}");
    Ok(Value::Null)
}

// ---------------------------------------------------------------------------
// filesOp.*：文件操作撤销栈（重命名 / 移动）
// ---------------------------------------------------------------------------

fn arg_at(payload: &Value, index: usize, key: &str) -> Option<String> {
    if let Some(items) = payload.as_array() {
        return items.get(index).and_then(Value::as_str).map(str::to_string);
    }
    payload.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn register_undo(
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let target = arg_at(payload, 0, "targetPath").unwrap_or_default();
    let source = arg_at(payload, 1, "sourcePath").unwrap_or_default();
    let label = arg_at(payload, 2, "label").unwrap_or_default();
    state.register_file_undo(target, source, label);
    Ok(json!(true))
}

pub fn undo_label(state: &tauri::State<'_, crate::state::AppState>) -> Result<Value, String> {
    Ok(match state.undo_label() {
        Some(label) => json!(label),
        None => Value::Null,
    })
}

pub fn undo_focus_path(state: &tauri::State<'_, crate::state::AppState>) -> Result<Value, String> {
    Ok(match state.undo_focus_path() {
        Some(path) => json!(path),
        None => Value::Null,
    })
}

pub fn perform_undo(state: &tauri::State<'_, crate::state::AppState>) -> Result<Value, String> {
    Ok(json!(state.perform_file_undo()))
}

pub fn clear_undo(state: &tauri::State<'_, crate::state::AppState>) -> Result<Value, String> {
    state.clear_file_undo();
    Ok(json!(true))
}

// ---------------------------------------------------------------------------
// 文档快照 / 生命周期
//
// 旧实现这几个通道返回的是 **JSON 字符串**（不是对象），渲染层会自己
// JSON.parse，这里必须保持同样的类型，否则解析会抛错。
// ---------------------------------------------------------------------------

fn snapshot_json<T: serde::Serialize>(value: &T) -> Result<Value, String> {
    let text = serde_json::to_string(value).map_err(|e| e.to_string())?;
    Ok(Value::String(text))
}

/// `document.loadData`
pub fn load_data(
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
) -> Result<Value, String> {
    let target = state.target_file(window.label()).unwrap_or_default();
    snapshot_json(&json!({
        "snap": null,
        "filePath": target,
        "backups": null,
        "shouldReadFromDisk": !target.is_empty(),
    }))
}

/// `document.getSnap` / `document.getSnapWithValidation`
pub fn get_snap() -> Result<Value, String> {
    snapshot_json(&json!({ "snap": null, "shouldReadFromDisk": false }))
}

/// `document.setContent` / `document.setLastSync`：旧实现恒为 true。
pub fn set_content() -> Result<Value, String> {
    Ok(json!(true))
}

/// 判断当前文档是否未在其它窗口打开（若仅当前窗口打开或为无标题文档，返回 true，关闭时须弹保存提示）。
pub fn no_other_window(
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
) -> Result<Value, String> {
    let current_label = window.label();
    if let Some(target) = state.target_file(current_label) {
        let others = state.other_windows_for(&target, current_label);
        Ok(json!(others.is_empty()))
    } else {
        Ok(json!(true))
    }
}

/// 标题栏消歧：其它窗口是否打开了同名文档（不含扩展名）。
pub fn has_duplicate_name(
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    let title = arg_at(payload, 0, "title").unwrap_or_default();
    if title.trim().is_empty() {
        return Ok(json!(false));
    }
    Ok(json!(state.has_duplicate_name(window.label(), title.trim())))
}

/// `document.switchToUntitled`
pub fn switch_to_untitled(
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
) -> Result<Value, String> {
    state.set_target_file(window.label(), None);
    state.set_last_session(Some(None), None);
    Ok(json!(true))
}

/// `document.rename(newPath, oldPath)`：同步当前文档路径与最近列表。
pub fn rename(
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    let new_path = arg_at(payload, 0, "newPath").unwrap_or_default();
    let old_path = arg_at(payload, 1, "oldPath").unwrap_or_default();

    if new_path.is_empty() {
        state.set_target_file(window.label(), None);
        return Ok(json!(true));
    }

    state.set_target_file(window.label(), Some(new_path.clone()));
    state.push_recent("file", &new_path, 20);
    if !old_path.is_empty() {
        state.rename_recent(&old_path, &new_path);
    }
    state.set_last_session(Some(Some(new_path.as_str())), None);
    Ok(json!(true))
}

// ---------------------------------------------------------------------------
// controller.*：旧主进程在 document.js 里实现的兼容器通道
// ---------------------------------------------------------------------------

/// `controller.switchFolder` 的渲染层通知脚本（与旧主进程 execRenderer 等价）。
fn switch_folder_script(folder: &str) -> String {
    let encoded = serde_json::to_string(folder).unwrap_or_else(|_| "\"\"".into());
    format!(
        "window.File?.setMountFolder?.({encoded}); \
         window.File?.editor?.library?.setMountFolder?.({encoded}, true);"
    )
}

/// `controller.openInArborMark` 的渲染层通知脚本。
fn open_in_arbormark_script(file: &str) -> String {
    let encoded = serde_json::to_string(file).unwrap_or_else(|_| "\"\"".into());
    format!("window.File?.editor?.library?.doSwitchByNode?.({encoded});")
}

/// `controller.switchFolder`：拖入文件夹且当前无挂载目录时，就地切换挂载点。
///
/// 与旧主进程一致：记录最近文件夹、更新上次会话，再通知渲染层刷新挂载状态。
pub fn switch_folder(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    let Some(folder) = payload_path(payload) else {
        return Ok(json!(false));
    };
    state.push_recent("folder", &folder, 20);
    state.set_last_session(None, Some(Some(folder.as_str())));
    if let Err(err) = crate::menu::refresh_recent(app) {
        log::warn!("[menu] 切换挂载目录后重建菜单失败: {err}");
    }
    let _ = window.eval(switch_folder_script(&folder));
    Ok(json!(true))
}

/// `controller.openInArborMark`：在当前窗口打开目标文件（旧版还会在无窗口时
/// 派生新主窗口；Tauri 里命令总由某个窗口发出，走就地切换分支即可）。
pub fn open_in_arbormark(
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    let Some(file) = payload_path(payload) else {
        return Ok(Value::Null);
    };
    let _ = window.eval(open_in_arbormark_script(&file));
    // 与文件头注释一致：渲染层可能解构 { winId }，不能返回 null。
    Ok(json!({ "winId": window.label() }))
}

/// `controller.canSwitchWithoutAsk`：旧实现就是常量 `true`。
pub fn can_switch_without_ask() -> Result<Value, String> {
    Ok(json!(true))
}

#[cfg(test)]
mod controller_tests {
    use super::*;

    #[test]
    fn switch_folder_script_notifies_both_entry_points() {
        let script = switch_folder_script("C://notes");
        assert!(script.contains(r#""C://notes""#), "路径必须 JSON 编码");
        assert!(script.contains("setMountFolder"), "File 主入口");
        assert!(script.contains("library?.setMountFolder"), "库侧栏入口");
    }

    #[test]
    fn open_in_arbormark_script_targets_library_switch() {
        let script = open_in_arbormark_script("/tmp/a.md");
        assert!(script.contains(r#""/tmp/a.md""#));
        assert!(script.contains("doSwitchByNode"));
    }

    #[test]
    fn can_switch_without_ask_is_true() {
        assert_eq!(can_switch_without_ask().unwrap(), json!(true));
    }
}

// ---------------------------------------------------------------------------
// controller.* 余项与 document 快照族（旧 rebuild 版未实现，本轮按语义补齐；
// 返回值契约均已核对渲染层消费方）
// ---------------------------------------------------------------------------

/// `controller.calcMountFolder`：当前窗口的挂载目录（文档所在目录）。
///
/// 渲染层回调 `setAndResolve(mountPath)`（sidebar-panels.js:4228）。
pub fn calc_mount_folder(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    let mount = state
        .target_file(window.label())
        .and_then(|path| Path::new(&path).parent().map(Path::to_path_buf))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(json!(mount))
}

/// `controller.shouldLoadFolder`：窗口没有当前文件时应加载挂载目录的文件列表。
pub fn should_load_folder(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    Ok(json!(state.target_file(window.label()).is_none()))
}

/// `controller.runCommand({args, cwd})`：执行导出管线命令（pandoc 等）。
///
/// 渲染层（export.js:229）消费 `[ok, message, error]` 数组，映射为
/// `{ code: ok ? 0 : -1, message, error }`。
pub fn run_command(payload: &Value) -> Result<Value, String> {
    let command = payload
        .get("args")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let cwd = payload.get("cwd").and_then(Value::as_str).unwrap_or("");
    if command.trim().is_empty() {
        return Ok(json!([false, "", "empty command"]));
    }
    let result = {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("cmd");
            cmd.arg("/C").arg(&command);
            if !cwd.is_empty() {
                cmd.current_dir(cwd);
            }
            cmd.output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = std::process::Command::new("sh");
            cmd.arg("-c").arg(&command);
            if !cwd.is_empty() {
                cmd.current_dir(cwd);
            }
            cmd.output()
        }
    };
    Ok(match result {
        Ok(output) => json!([
            output.status.success(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        ]),
        Err(err) => json!([false, "", err.to_string()]),
    })
}

/// `document.needsUpdateSnap`：标记快照待更新（fire-and-forget）。
pub fn needs_update_snap() -> Result<Value, String> {
    Ok(json!(true))
}

/// `document.addSnap(snapJson)`：暂存文档快照（旧版写入主进程备份目录）。
pub fn add_snap(payload: &Value) -> Result<Value, String> {
    let snap = payload.as_str().unwrap_or("");
    log::debug!("[document] addSnap {} 字节", snap.len());
    Ok(json!(true))
}

/// `document.requestBuildSnap`：请求构建快照（fire-and-forget）。
pub fn request_build_snap() -> Result<Value, String> {
    Ok(json!(true))
}

/// `document.getDataFromFile`：读当前窗口文档的磁盘内容。
///
/// 渲染层回调直接作为 content 使用（file.js:889，mac 分支；isNode 已走本地 fs）。
pub fn get_data_from_file(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    let Some(path) = state.target_file(window.label()) else {
        return Ok(json!(""));
    };
    Ok(json!(std::fs::read_to_string(path).unwrap_or_default()))
}

/// `document.refreshContentFromDisk`：从磁盘重读当前文档并通知渲染层重载。
pub fn refresh_content_from_disk(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    let Some(path) = state.target_file(window.label()) else {
        return Ok(json!(false));
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Ok(json!(false));
    };
    let encoded = serde_json::to_string(&content).unwrap_or_else(|_| "\"\"".into());
    let script = format!(
        "window.File?.reloadContent?.({encoded}, {{ fromDiskChange: true }});"
    );
    let _ = window.eval(&script);
    Ok(json!(true))
}

/// `document.enterOversize`：文档超限提示（fire-and-forget）。
pub fn enter_oversize() -> Result<Value, String> {
    Ok(json!(true))
}

/// `document.updateChangeCount`：mac 文档编辑计数同步（fire-and-forget）。
pub fn update_change_count() -> Result<Value, String> {
    Ok(json!(true))
}

/// `document.updateChangeCountIfUnedited`：同上（未编辑时才更新）。
pub fn update_change_count_if_unedited() -> Result<Value, String> {
    Ok(json!(true))
}

/// `document.checkIfMoveOnSave(targetPath)`：另存路径与主进程记录是否不同。
///
/// 渲染层据此决定是否广播 didRename（editor-core.js:9325）。旧版未实现恒 null。
pub fn check_if_move_on_save(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let Some(target) = payload_path(payload) else {
        return Ok(json!(false));
    };
    let moved = match state.target_file(window.label()) {
        Some(previous) => previous != target,
        None => false,
    };
    // 无论是否移动，主进程都以新路径为准（与旧版 win._targetFile 语义一致）。
    state.set_target_file(window.label(), Some(target));
    Ok(json!(moved))
}

/// `document.recordUnusedAssets(usedList)`：记录 textbundle 正在使用的资产。
pub fn record_unused_assets(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let used: Vec<String> = payload
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if let Some(doc) = state.target_file(window.label()) {
        state.record_unused_assets(&doc, used);
    }
    Ok(json!(true))
}

#[cfg(test)]
mod controller_extra_tests {
    use super::*;

    #[test]
    fn run_command_reports_ok_and_error_channels() {
        let result = run_command(&json!({ "args": "echo hello" })).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 3, "渲染层按 [ok, message, error] 解构");
        assert_eq!(arr[0], json!(true));
        assert_eq!(arr[1].as_str().unwrap().trim(), "hello");
        assert_eq!(arr[2].as_str().unwrap(), "");

        let failed = run_command(&json!({ "args": "" })).unwrap();
        assert_eq!(failed[0], json!(false), "空命令必须走失败分支");
    }
}

// ---------------------------------------------------------------------------
// 多窗口同文档同步（原版 mac 架构的 Tauri 平移）
//
// 协议：活动窗口编辑后推 `document.syncFullContent [inSourceMode, content]`，
// 主进程存储并广播给其它同文档窗口 eval `editor.applyFullContent`；
// 细粒度变更走 `doc.syncChange` → `editor.applyChange`；
// 非活动窗口 `applyFullContent` 内部有 isActiveWindow 守卫，不会覆盖活动窗口。
// ---------------------------------------------------------------------------

/// 解析同步推送的 `[inSourceMode, content]`（兼容对象形态）。
fn sync_args(payload: &Value) -> Option<(bool, String)> {
    if let Some(items) = payload.as_array() {
        // 空文档的 content 是合法的 ""，但缺元素视为畸形推送。
        if items.len() < 2 {
            return None;
        }
        let from_source = items.first().and_then(Value::as_bool).unwrap_or(false);
        let content = items.get(1).and_then(Value::as_str).unwrap_or("");
        return Some((from_source, content.to_string()));
    }
    Some((
        payload.get("inSourceMode").and_then(Value::as_bool)?,
        payload.get("content").and_then(Value::as_str)?.to_string(),
    ))
}

/// 向同文档的其它窗口广播一段 JS；返回触达的窗口数。
fn broadcast_to_same_file(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    sender_label: &str,
    doc_path: &str,
    build_script: impl Fn(&str) -> String,
) -> usize {
    let targets = state.other_windows_for(doc_path, sender_label);
    for label in &targets {
        if let Some(target) = app.get_webview_window(label) {
            let _ = target.eval(build_script(label));
        }
    }
    targets.len()
}

/// `document.syncFullContent` / `controller.syncFullContent`。
pub fn sync_full_content(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    let Some((from_source_mode, content)) = sync_args(payload) else {
        return Ok(json!(false));
    };
    let Some(doc_path) = state.target_file(window.label()) else {
        return Ok(json!(false)); // 未命名文档不参与同步
    };
    state.set_sync_content(
        &doc_path,
        crate::state::DocSyncEntry {
            from_source_mode,
            content: content.clone(),
        },
    );
    let encoded = serde_json::to_string(&content).unwrap_or_else(|_| "\"\"".into());
    let touched = broadcast_to_same_file(app, state, window.label(), &doc_path, |_| {
        format!(
            "(function(){{ \
               var f = window.File; if (!f || !f.editor || !f.editor.applyFullContent) return; \
               var prev = f.activeWindow; f.activeWindow = false; \
               f.editor.applyFullContent({from_source_mode}, {encoded}).then(function(){{ f.activeWindow = prev; }}); \
             }})();"
        )
    });
    if touched > 0 {
        crate::diagnostics::log(&format!("[sync] 全量内容同步到 {touched} 个窗口（{doc_path}）"));
        log::info!("[sync] 全量内容同步到 {touched} 个窗口（{doc_path}）");
    }
    Ok(json!(true))
}

/// `document.getContent`：非活动窗口拉取最近一次推送的内容；
/// 没有推送记录时回落到磁盘内容（渲染层对 undefined 有守卫，返回 null 会跳过同步）。
pub fn get_content(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    let Some(doc_path) = state.target_file(window.label()) else {
        return Ok(Value::Null);
    };
    if let Some(entry) = state.sync_content(&doc_path) {
        return Ok(json!(entry.content));
    }
    match std::fs::read_to_string(&doc_path) {
        Ok(content) => Ok(json!(content)),
        Err(_) => Ok(Value::Null),
    }
}

/// `document.syncChangeIfNeeded`：还有其它同文档窗口时让渲染层调度全量同步。
pub fn sync_change_if_needed(
    window: &tauri::WebviewWindow,
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<Value, String> {
    let Some(doc_path) = state.target_file(window.label()) else {
        return Ok(json!(false));
    };
    let others = state.other_windows_for(&doc_path, window.label());
    Ok(json!(!others.is_empty()))
}

/// `doc.syncChange` / `document.syncChange`：把细粒度变更转发给其它同文档窗口。
///
/// 原版编辑器 isNode 路径的实时同步机制：活动窗口编辑后
/// `ipc.send("doc.syncChange", changes)`，主进程转发给其它同文档窗口，
/// 接收窗口 `applyChange(changes)` 内有 `!File.isActiveWindow()` 守卫，只
/// 应用变更、绝不覆盖正在编辑的窗口。
pub fn sync_change(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
    payload: &Value,
) -> Result<Value, String> {
    // 渲染层发的是 JSON.stringify(changes) 字符串（兼容数组形态）。
    let changes = payload
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string(payload).unwrap_or_else(|_| "[]".into()));
    let Some(doc_path) = state.target_file(window.label()) else {
        log::warn!(
            "[sync] 窗口 {} 无登记文档路径，跳过同步",
            window.label()
        );
        return Ok(json!(false)); // 未命名文档不参与同步
    };
    let touched = broadcast_to_same_file(app, state, window.label(), &doc_path, |_| {
        // 接收端 applyChange 有 `!File.isActiveWindow()` 守卫，而 Windows 双窗口下
        // 焦点状态机不可靠（activeWindow 可能两个窗口都卡在 true）。这里在应用前
        // 临时强制 activeWindow=false，apply 后由下一次聚焦事件恢复 true，确保
        // 变更一定被应用。发送窗口自己不在 targets 里，不会误伤。
        format!(
            "(function(){{ \
               var f = window.File; if (!f || !f.editor || !f.editor.applyChange) return; \
               var prev = f.activeWindow; f.activeWindow = false; \
               try {{ f.editor.applyChange({changes}); }} finally {{ f.activeWindow = prev; }} \
             }})();"
        )
    });
    if touched > 0 {
        crate::diagnostics::log(&format!("[sync] 细粒度变更同步到 {touched} 个窗口（{doc_path}）"));
    }
    log::info!("[sync] 窗口 {} 文档 {doc_path} 同步到 {touched} 个其它窗口", window.label());
    Ok(json!(true))
}

/// `controller.showErrorDialog(msg)`：错误提示框（图床上传未配置等场景）。
pub fn show_error_dialog(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let message = payload.as_str().unwrap_or("");
    crate::ipc::dialog::show_message(
        app,
        &json!({ "type": "error", "message": message, "buttons": ["OK"] }),
    )
}

/// `controller.startDrag(itemPath)`：mac 把库文件拖出到 Finder。
/// Tauri 渲染层 isNode 分支走 Electron ondragstart 协议（不触达此通道）；
/// 桌面拖出需要 tauri-plugin-drag，暂以日志桩代替。
pub fn start_drag(payload: &Value) -> Result<Value, String> {
    let path = payload.as_str().unwrap_or("");
    log::debug!("[controller] startDrag（未接桌面拖出插件）: {path}");
    Ok(json!(true))
}

/// `controller.bindFolderMonitor`：递归监视当前文档所在目录。
///
/// 变更经 `arbor-event`（channel `controller.folderChanged`）推送渲染层；
/// 原版渲染层没有接收端 handler，事件流先打通，消费端可随时接上。
pub fn bind_folder_monitor(
    app: &AppHandle,
    state: &tauri::State<'_, crate::state::AppState>,
    window: &tauri::WebviewWindow,
) -> Result<Value, String> {
    let Some(doc_path) = state.target_file(window.label()) else {
        return Ok(json!(false));
    };
    let Some(dir) = Path::new(&doc_path).parent().map(Path::to_path_buf) else {
        return Ok(json!(false));
    };
    let emitter = app.clone();
    let registered = state.register_folder_watcher(dir.clone(), move |changed| {
        log::debug!("[watcher] 目录变更 {changed:?}");
        let _ = emitter.emit(
            "arbor-event",
            json!({ "channel": "controller.folderChanged", "payload": changed }),
        );
    });
    Ok(json!(registered))
}

#[cfg(test)]
mod sync_tests {
    use super::*;

    #[test]
    fn sync_args_accept_array_and_object() {
        assert_eq!(
            sync_args(&json!([true, "abc"])),
            Some((true, "abc".to_string()))
        );
        assert_eq!(
            sync_args(&json!({ "inSourceMode": false, "content": "x" })),
            Some((false, "x".to_string()))
        );
        assert_eq!(sync_args(&json!([true])), None, "缺 content 应拒绝");
    }
}

#[cfg(test)]
mod localized_doc_tests {
    use super::*;

    fn write_doc(base: &std::path::Path, locale: &str, name: &str) {
        let dir = base.join("Docs").join(locale);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), format!("{locale}:{name}")).unwrap();
    }

    fn write_manifest(base: &std::path::Path, locale: &str, from: &str, to: &str) {
        let dir = base.join("Docs").join(locale);
        std::fs::create_dir_all(&dir).unwrap();
        let map = json!({ from: to });
        std::fs::write(dir.join("manifest.json"), map.to_string()).unwrap();
    }

    #[test]
    fn docs_resolve_by_locale_and_fall_back() {
        let root = std::env::temp_dir().join(format!("arbormark_docs_{}", uuid::Uuid::new_v4()));
        let base = root.to_string_lossy().to_string();
        write_doc(&root, "en", "Quick Start.md");
        write_doc(&root, "zh-Hans", "Quick Start.md");
        write_doc(&root, "ja-JP", "クイックスタート.md");
        write_manifest(&root, "ja-JP", "Quick Start.md", "クイックスタート.md");

        let doc = format!("{base}/Docs/Quick Start.md");
        assert!(resolve_localized_doc_path(&doc, "ja-JP").ends_with("/Docs/ja-JP/クイックスタート.md"));
        assert!(resolve_localized_doc_path(&doc, "zh-Hans").ends_with("/Docs/zh-Hans/Quick Start.md"));
        // 繁体缺文件时回退简体。
        assert!(resolve_localized_doc_path(&doc, "zh-Hant").ends_with("/Docs/zh-Hans/Quick Start.md"));
        // 未翻译语言回退英文。
        assert!(resolve_localized_doc_path(&doc, "de-DE").ends_with("/Docs/en/Quick Start.md"));

        write_doc(&root, "zh-Hant", "Quick Start.md");
        assert!(resolve_localized_doc_path(&doc, "zh-Hant").ends_with("/Docs/zh-Hant/Quick Start.md"));

        let _ = std::fs::remove_dir_all(root);
    }
}
