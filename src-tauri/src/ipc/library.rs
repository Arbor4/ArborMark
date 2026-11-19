//! 文件操作通道：`library.*` 与 `path.*` 的落地实现。
//!
//! 契约以渲染层实际调用方式为准（不是猜测）：
//!   library.newFile(fullPath) / newFolder(fullPath)   -> bool
//!   library.renameFile({old, new})                    -> bool
//!   library.moveFile({source, dest})                  -> bool
//!   library.duplicate(filePath)                       -> 新路径 | false
//!   library.trashItem(filePath)                       -> bool
//!   path.copyFile(from, to) / moveFile({from,to})     -> bool
//!   path.delete(path) / removeFiles([paths])          -> bool
//!   path.moveTo({source, folder})                     -> bool
//!
//! 旧版分布在 `library-handlers.js`，语义为"出错返回 false，不抛异常"，
//! 这里保持一致。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn as_string(payload: &Value, keys: &[&str]) -> Option<String> {
    if let Some(text) = payload.as_str() {
        return Some(crate::paths::native(text));
    }
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_str))
        .map(crate::paths::native)
}

/// 从 `[from, to]` 或 `{from/to/source/dest}` 里取一对路径。
fn read_pair(payload: &Value) -> (Option<String>, Option<String>) {
    if let Some(items) = payload.as_array() {
        let from = items
            .first()
            .and_then(Value::as_str)
            .map(crate::paths::native);
        let to = items
            .get(1)
            .and_then(Value::as_str)
            .map(crate::paths::native);
        return (from, to);
    }
    (
        as_string(payload, &["from", "source", "old", "path"]),
        as_string(payload, &["to", "dest", "destination", "new"]),
    )
}

fn ensure_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
}

fn move_path(from: &str, to: &str) -> bool {
    let source = Path::new(from);
    let target = PathBuf::from(to);
    // 不覆盖已有文件，也不允许把目录移进自身/子孙（否则递归复制会自我膨胀）
    if !source.exists() || target.exists() || target.starts_with(source) {
        return false;
    }
    ensure_parent(&target);
    if std::fs::rename(source, &target).is_ok() {
        return true;
    }
    // 跨设备时 rename 失败：目录也要能递归复制后删除源，而不是只支持文件
    let copied = if source.is_dir() {
        copy_dir(source, &target).is_ok()
    } else {
        std::fs::copy(source, &target).is_ok()
    };
    if !copied {
        if target.is_dir() {
            let _ = std::fs::remove_dir_all(&target);
        } else {
            let _ = std::fs::remove_file(&target);
        }
        return false;
    }
    remove_path(from)
}

fn remove_path(target: &str) -> bool {
    let path = Path::new(target);
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.is_dir() {
        std::fs::remove_dir_all(path).is_ok()
    } else {
        std::fs::remove_file(path).is_ok()
    }
}

// ---------------------------------------------------------------- library.*

pub fn new_file(payload: &Value) -> Result<Value, String> {
    let Some(full_path) = as_string(payload, &["path", "fullPath"]) else {
        return Ok(json!(false));
    };
    let path = PathBuf::from(&full_path);
    if path.exists() {
        return Ok(json!(false));
    }
    ensure_parent(&path);
    Ok(json!(std::fs::write(&path, "").is_ok()))
}

pub fn new_folder(payload: &Value) -> Result<Value, String> {
    let Some(full_path) = as_string(payload, &["path", "fullPath"]) else {
        return Ok(json!(false));
    };
    Ok(json!(std::fs::create_dir_all(&full_path).is_ok()))
}

pub fn rename(payload: &Value) -> Result<Value, String> {
    let (from, to) = read_pair(payload);
    match (from, to) {
        (Some(from), Some(to)) => Ok(json!(move_path(&from, &to))),
        _ => Ok(json!(false)),
    }
}

pub fn move_file(payload: &Value) -> Result<Value, String> {
    let (from, to) = read_pair(payload);
    match (from, to) {
        (Some(from), Some(to)) => Ok(json!(move_path(&from, &to))),
        _ => Ok(json!(false)),
    }
}

pub fn duplicate(payload: &Value) -> Result<Value, String> {
    let Some(source) = as_string(payload, &["path", "filePath"]) else {
        return Ok(json!(false));
    };
    let source_path = Path::new(&source);
    if !source_path.exists() {
        return Ok(json!(false));
    }

    let stem = source_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "copy".into());
    let ext = source_path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    let parent = source_path.parent().unwrap_or(Path::new("."));

    let mut candidate = parent.join(format!("{stem} copy{ext}"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem} copy {counter}{ext}"));
        counter += 1;
    }

    let ok = if source_path.is_dir() {
        copy_dir(source_path, &candidate).is_ok()
    } else {
        std::fs::copy(source_path, &candidate).is_ok()
    };

    if ok {
        Ok(json!(candidate.to_string_lossy()))
    } else {
        Ok(json!(false))
    }
}

pub(crate) fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

pub fn trash(payload: &Value) -> Result<Value, String> {
    let Some(target) = as_string(payload, &["path", "filePath", "item"]) else {
        return Ok(json!(false));
    };
    Ok(json!(trash::delete(&target).is_ok()))
}

// ------------------------------------------------------------------- path.*

pub fn copy_file(payload: &Value) -> Result<Value, String> {
    let (from, to) = read_pair(payload);
    match (from, to) {
        (Some(from), Some(to)) => {
            let target = PathBuf::from(&to);
            ensure_parent(&target);
            Ok(json!(std::fs::copy(&from, &target).is_ok()))
        }
        _ => Ok(json!(false)),
    }
}

pub fn delete(payload: &Value) -> Result<Value, String> {
    match as_string(payload, &["path", "target"]) {
        Some(target) => Ok(json!(remove_path(&target))),
        None => Ok(json!(false)),
    }
}

pub fn remove_files(payload: &Value) -> Result<Value, String> {
    let Some(items) = payload.as_array() else {
        return Ok(json!(false));
    };
    let all_ok = items
        .iter()
        .filter_map(Value::as_str)
        .all(remove_path);
    Ok(json!(all_ok))
}

/// `path.moveTo({source, folder})`：移动到目标目录下，保持文件名。
pub fn move_to(payload: &Value) -> Result<Value, String> {
    let source = as_string(payload, &["source", "from"]);
    let folder = as_string(payload, &["folder", "dest", "to"]);
    let (Some(source), Some(folder)) = (source, folder) else {
        return Ok(json!(false));
    };

    let name = Path::new(&source)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return Ok(json!(false));
    }

    let _ = std::fs::create_dir_all(&folder);
    let target = Path::new(&folder).join(name);
    Ok(json!(move_path(&source, &target.to_string_lossy())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arbormark-lib-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn creates_files_and_folders() {
        let dir = temp_dir();

        let file = dir.join("note.md");
        assert_eq!(new_file(&json!(file.to_string_lossy())).unwrap(), json!(true));
        assert!(file.exists());
        // 重复创建返回 false，且不覆盖
        assert_eq!(new_file(&json!(file.to_string_lossy())).unwrap(), json!(false));

        let folder = dir.join("sub").join("deeper");
        assert_eq!(new_folder(&json!(folder.to_string_lossy())).unwrap(), json!(true));
        assert!(folder.is_dir());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn renames_and_moves_files() {
        let dir = temp_dir();
        let from = dir.join("a.md");
        let to = dir.join("b.md");
        std::fs::write(&from, "x").unwrap();

        assert_eq!(
            rename(&json!({ "old": from.to_string_lossy(), "new": to.to_string_lossy() })).unwrap(),
            json!(true)
        );
        assert!(!from.exists() && to.exists());

        let moved_dir = dir.join("moved");
        assert_eq!(
            move_to(&json!({ "source": to.to_string_lossy(), "folder": moved_dir.to_string_lossy() })).unwrap(),
            json!(true)
        );
        assert!(moved_dir.join("b.md").exists());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn duplicates_with_copy_suffix() {
        let dir = temp_dir();
        let src = dir.join("doc.md");
        std::fs::write(&src, "hello").unwrap();

        let first = duplicate(&json!(src.to_string_lossy())).unwrap();
        assert_eq!(first, json!(dir.join("doc copy.md").to_string_lossy()));
        assert!(dir.join("doc copy.md").exists());

        let second = duplicate(&json!(src.to_string_lossy())).unwrap();
        assert_eq!(second, json!(dir.join("doc copy 2.md").to_string_lossy()));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn moves_directories_with_contents_and_refuses_overwrite() {
        let dir = temp_dir();
        let src = dir.join("docs");
        std::fs::create_dir_all(src.join("nested")).unwrap();
        std::fs::write(src.join("nested").join("a.md"), "x").unwrap();

        let dest = dir.join("moved");
        std::fs::create_dir_all(&dest).unwrap();
        assert_eq!(
            move_to(&json!({ "source": src.to_string_lossy(), "folder": dest.to_string_lossy() })).unwrap(),
            json!(true)
        );
        assert!(dest.join("docs").join("nested").join("a.md").exists());
        assert!(!src.exists());

        // 目标已存在时拒绝覆盖
        let a = dir.join("a.md");
        let b = dir.join("b.md");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        assert_eq!(
            move_file(&json!({ "from": a.to_string_lossy(), "to": b.to_string_lossy() })).unwrap(),
            json!(false)
        );
        assert!(a.exists() && b.exists());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deletes_single_and_multiple_paths() {
        let dir = temp_dir();
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        std::fs::write(&a, "1").unwrap();
        std::fs::write(&b, "2").unwrap();

        assert_eq!(delete(&json!(a.to_string_lossy())).unwrap(), json!(true));
        assert!(!a.exists());

        assert_eq!(
            remove_files(&json!([b.to_string_lossy()])).unwrap(),
            json!(true)
        );
        assert!(!b.exists());

        // 不存在的路径返回 false 而不是报错
        assert_eq!(delete(&json!(dir.join("missing").to_string_lossy())).unwrap(), json!(false));

        let _ = std::fs::remove_dir_all(dir);
    }
}

// ---------------------------------------------------------------------------
// library.* 库视图通道（mac 原生文件树 / 检索；isNode 分支走 fs shim）。
// Windows 上大多不触达，实现为语义等价或类型正确的空结果。
// ---------------------------------------------------------------------------

/// 文档扩展名（与 file-explorer 的列表过滤一致）。
const DOC_EXTS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "mdx"];

fn doc_entry(path: &Path) -> Value {
    let meta = std::fs::metadata(path).ok();
    json!({
        "path": path.to_string_lossy(),
        "name": path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
        "isOpen": false,
        "lastModified": meta.as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    })
}

/// `library.listDocsUnder(path)`：目录下的文档与子目录（mac 文件树节点数据）。
///
/// 渲染层消费 `{ name, subdir, lastModified, createDate, alias }`。
pub fn list_docs_under(payload: &Value) -> Result<Value, String> {
    let Some(dir) = payload.as_str().map(PathBuf::from) else {
        return Ok(Value::Null);
    };
    let mut subdir = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                subdir.push(json!({
                    "path": path.to_string_lossy(),
                    "name": name,
                    "isOpen": false,
                    "subdir": [],
                }));
            } else if DOC_EXTS.contains(&name.rsplit('.').next().unwrap_or("").to_lowercase().as_str()) {
                subdir.push(doc_entry(&path));
            }
        }
    }
    Ok(json!({
        "name": dir.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
        "subdir": subdir,
        "lastModified": 0,
        "createDate": 0,
        "alias": Value::Null,
    }))
}

/// `library.search({text, ...})`：库内文件名模糊检索（mac 分支）。
/// 结果集消费方对空数组/空对象都能正常渲染空态；返回空列表。
pub fn search() -> Result<Value, String> {
    Ok(json!([]))
}

/// `library.fetchAllDocs(mountFolder)`：请求全量文档列表（mac 主进程随后推送）。
pub fn fetch_all_docs() -> Result<Value, String> {
    Ok(json!(true))
}

/// `library.getRecentFolders(cb)`：最近文件夹列表（复用 state.recents）。
pub fn get_recent_folders(state: &tauri::State<'_, crate::state::AppState>) -> Result<Value, String> {
    Ok(json!(state.recents()["folders"].clone()))
}

/// `library.updateListItem({path, mark})`：标记库条目当前打开状态（fire-and-forget）。
pub fn update_list_item() -> Result<Value, String> {
    Ok(json!(true))
}

/// `library.updateListItemIfIsOpen`：同上。
pub fn update_list_item_if_is_open() -> Result<Value, String> {
    Ok(json!(true))
}

/// `library.newFileUnder(path)`：在指定目录下新建文档（mac 分支）。
pub fn new_file_under(payload: &Value) -> Result<Value, String> {
    let Some(dir) = payload.as_str().map(PathBuf::from) else {
        return Ok(json!(false));
    };
    let mut name = "Untitled.md".to_string();
    let mut dest = dir.join(&name);
    let mut counter = 1;
    while dest.exists() {
        name = format!("Untitled-{counter}.md");
        dest = dir.join(&name);
        counter += 1;
    }
    match std::fs::write(&dest, "") {
        Ok(_) => Ok(json!({ "path": dest.to_string_lossy(), "name": name })),
        Err(err) => {
            log::warn!("[library] newFileUnder 失败: {err}");
            Ok(json!(false))
        }
    }
}

/// `library.showProperty(path)`：mac 显示文件属性面板（Finder 信息）。
pub fn show_property() -> Result<Value, String> {
    Ok(json!(true))
}

#[cfg(test)]
mod library_tests {
    use super::*;

    #[test]
    fn list_docs_under_returns_expected_shape() {
        let dir = std::env::temp_dir().join(format!("arbormark-lib-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.md"), "x").unwrap();
        std::fs::write(dir.join("b.txt"), "x").unwrap();
        std::fs::write(dir.join(".hidden.md"), "x").unwrap();

        let result = list_docs_under(&json!(dir.to_string_lossy())).unwrap();
        assert!(result["subdir"].is_array());
        assert!(result["name"].is_string());
        let names: Vec<&str> = result["subdir"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v["name"].as_str())
            .collect();
        assert!(names.contains(&"a.md"), "md 文档必须列出");
        assert!(!names.contains(&"b.txt"), "非文档扩展名不列出");
        assert!(!names.iter().any(|n| n.starts_with('.')), "隐藏文件跳过");
        let _ = std::fs::remove_dir_all(dir);
    }
}
