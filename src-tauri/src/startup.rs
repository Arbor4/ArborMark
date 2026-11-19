//! 启动参数：主窗口该恢复哪个目录、要不要直接打开某个文件。
//!
//! 这段是旧版 `resolveStartupLaunchOptions()` 的等价实现，属于**业务规则**
//! （`restoreWhenLaunch` 的四种取向 + 目录缺失时用文件父目录兜底），不是装配
//! 动作。放在 `lib.rs` 里会让「注册状态、建窗口」的主线被 60 行分支淹没，
//! 所以独立成模块：`boot()` 给装配层调用，`resolve()` 是纯函数，可以脱离
//! Tauri 直接单测。

use std::path::Path;

use serde_json::Value;

use crate::state::AppState;

/// `restoreWhenLaunch` 的四种取向：0 = 新建空白窗口；1 = 恢复上次目录；
/// 2 = 恢复上次文件和目录（默认）；3 = 打开偏好设置里固定的目录。
fn restore_mode(state: &AppState) -> i64 {
    let raw = state.get("restoreWhenLaunch");
    raw.as_i64()
        .or_else(|| raw.as_str().and_then(|text| text.parse::<i64>().ok()))
        .unwrap_or(2)
}

fn existing_file(value: Option<&str>) -> Option<String> {
    value
        .filter(|path| !path.is_empty() && Path::new(path).is_file())
        .map(str::to_string)
}

fn existing_dir(value: Option<&str>) -> Option<String> {
    value
        .filter(|path| !path.is_empty() && Path::new(path).is_dir())
        .map(str::to_string)
}

/// 纯规则：给定**已经校验过存在性**的候选路径，算出 `(打开的文件, 挂载的目录)`。
///
/// 传进来的 `last_file` / `last_folder` / `pinned` 都应是 `None` 或真实存在的路径；
/// 唯一还会碰文件系统的是模式 2 的兜底：目录丢了就用文件父目录顶上。
fn resolve(
    mode: i64,
    last_file: Option<String>,
    last_folder: Option<String>,
    pinned: Option<String>,
) -> (Option<String>, Option<String>) {
    match mode {
        0 => (None, None),
        1 => (None, last_folder),
        3 => (None, pinned),
        _ => {
            let mut mount = last_folder;
            if mount.is_none() {
                if let Some(file) = last_file.as_deref() {
                    mount = Path::new(file)
                        .parent()
                        .map(|parent| parent.to_string_lossy().to_string())
                        .filter(|parent| Path::new(parent).is_dir());
                }
            }
            (last_file, mount)
        }
    }
}

/// 主窗口启动时要恢复的文档（渲染层就绪后经 pending_switch 切换）。
pub fn boot(state: &AppState) -> Option<String> {
    let session = state.last_session();
    let (target, _mount) = resolve(
        restore_mode(state),
        existing_file(session.get("targetFile").and_then(Value::as_str)),
        existing_dir(session.get("mountFolder").and_then(Value::as_str)),
        existing_dir(state.get("pinFolder").as_str()),
    );
    target
}

/// 命令行传入的文件（`ArborMark ~/notes/a.md`）：启动即打开，且不恢复上次会话。
pub fn launch_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("arbormark-startup-{tag}"));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn mode_zero_starts_blank() {
        let (target, mount) = resolve(0, Some("a.md".into()), Some("docs".into()), Some("pin".into()));
        assert_eq!((target, mount), (None, None));
    }

    #[test]
    fn mode_one_restores_folder_only() {
        let (target, mount) = resolve(1, Some("a.md".into()), Some("docs".into()), Some("pin".into()));
        assert_eq!(target, None);
        assert_eq!(mount.as_deref(), Some("docs"));
    }

    #[test]
    fn mode_three_prefers_pinned_folder() {
        let (target, mount) = resolve(3, Some("a.md".into()), Some("docs".into()), Some("pin".into()));
        assert_eq!(target, None);
        assert_eq!(mount.as_deref(), Some("pin"));
    }

    #[test]
    fn mode_two_keeps_file_and_folder() {
        let dir = sample_dir("keep");
        let file = dir.join("note.md");
        std::fs::write(&file, "x").unwrap();
        let file_path = file.to_string_lossy().to_string();
        let dir_path = dir.to_string_lossy().to_string();

        let (target, mount) = resolve(2, Some(file_path.clone()), Some(dir_path.clone()), None);
        assert_eq!(target.as_deref(), Some(file_path.as_str()));
        assert_eq!(mount.as_deref(), Some(dir_path.as_str()));
    }

    #[test]
    fn mode_two_falls_back_to_file_parent_when_folder_missing() {
        let dir = sample_dir("parent");
        let file = dir.join("note.md");
        std::fs::write(&file, "x").unwrap();

        let (target, mount) = resolve(2, Some(file.to_string_lossy().to_string()), None, None);
        assert!(target.is_some());
        assert_eq!(mount.as_deref(), Some(dir.to_string_lossy().as_ref()));
    }

    #[test]
    fn mode_two_without_any_session_is_blank() {
        let (target, mount) = resolve(2, None, None, Some("pin".into()));
        assert_eq!((target, mount), (None, None));
    }
}
