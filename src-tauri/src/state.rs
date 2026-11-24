//! 运行时状态：设置、最近文件、路径。
//!
//! 对应旧主进程的 `config/settings-store.js` 与 `config/recent-store.js`，
//! 统一为一份 JSON 文件，避免 Node 版里散落的多个 store。

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 文件操作撤销栈的一项（重命名 / 移动）。
pub struct FileUndoItem {
    pub target: String,
    pub source: String,
    pub label: String,
}

pub struct AppState {
    /// 文件操作撤销栈（与旧主进程的 fileUndoStack 等价）
    file_undo: Mutex<Vec<FileUndoItem>>,
    /// 每个窗口打开的文件路径（等价旧版的 window._targetFile，按窗口 label 区分）
    target_files: Mutex<std::collections::HashMap<String, String>>,
    /// 窗口创建时请求打开、但渲染层还没就绪的文档。
    /// 渲染层在 `app.rendererReady` 里报告 hasEditor 后才消费——不再靠 setTimeout 轮询。
    pending_switch: Mutex<std::collections::HashMap<String, String>>,
    /// 文档窗口序号（用于生成唯一 label）
    window_seq: std::sync::atomic::AtomicUsize,
    /// 原生弹出菜单的动作表：菜单项 id -> (窗口 label, 点击时要执行的渲染层代码)
    menu_actions: Mutex<std::collections::HashMap<String, (String, String)>>,
    /// 业务菜单项 id -> 在窗口里执行的 JS 片段（全局，不随窗口变化）
    menu_commands: Mutex<std::collections::HashMap<String, String>>,
    /// 当前打印视图窗口 label（导出 / 打印流程复用同一个窗口）
    print_view: Mutex<Option<String>>,
    /// 长图导出用的捕获视图：winId -> 窗口 label。
    /// 打印视图是单槽位的，但长图可以同时在跑多个（渲染层按 winId 逐个取图）。
    capture_views: Mutex<std::collections::HashMap<String, String>>,
    /// 应用数据目录（等价 Electron 的 app.getPath("userData")）
    pub data_dir: PathBuf,
    /// 渲染层可写的 userData 目录
    #[allow(dead_code)]
    pub user_data_dir: PathBuf,
    /// 设置键值对，持久化到 settings.json
    settings: Mutex<Map<String, Value>>,
    /// 最近打开的文件 / 文件夹
    recents: Mutex<Value>,
    /// 上次会话：`{ targetFile, mountFolder, time }`，用于 `restoreWhenLaunch`。
    last_session: Mutex<Value>,
    /// textbundle 的未使用资产记账：文档路径 -> 正在使用的资产文件名列表。
    /// （`document.recordUnusedAssets` 写入，清理流程未来消费。）
    unused_assets: Mutex<std::collections::HashMap<String, Vec<String>>>,
    /// 跨窗口内容同步：文档路径 -> 最近一次由活动窗口推送的内容。
    /// 其它同文档窗口通过 `document.getContent` 拉取（原版 Electron 同款语义）。
    doc_sync: Mutex<std::collections::HashMap<String, DocSyncEntry>>,
    /// 挂载目录的文件监视器（`controller.bindFolderMonitor`），按目录去重。
    folder_watchers: Mutex<std::collections::HashMap<PathBuf, notify::RecommendedWatcher>>,
    /// 允许直接关闭的窗口（已完成保存/丢弃/未编辑检查）
    allowed_close_windows: Mutex<std::collections::HashSet<String>>,
    /// 正在进行关闭流程检查的窗口（防止重复触发）
    close_flow_running: Mutex<std::collections::HashSet<String>>,
    /// 最近获得焦点的文档窗口 label（用于顶栏菜单指令在 macOS 失去焦点时精确派发）
    last_focused_window: Mutex<Option<String>>,
}

/// 跨窗口同步的一条内容快照。
#[derive(Clone)]
pub struct DocSyncEntry {
    /// 推送方是否处于源码模式（未来差异化同步时消费）。
    #[allow(dead_code)]
    pub from_source_mode: bool,
    pub content: String,
}

/// 最近列表的条目结构（与渲染层 renderFolders / renderMenuItem 的期望一致）。
fn recent_entry(path: &str) -> Value {
    let name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    json!({ "path": path, "name": name, "pinned": false })
}

/// 老版本 recent.json 里存的是裸字符串，读入时统一升级成对象。
fn normalize_recents(value: Value) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    for key in ["files", "folders"] {
        let upgraded: Vec<Value> = object
            .get(key)
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|item| match item {
                        Value::String(path) => Some(recent_entry(path)),
                        Value::Object(_) => Some(item.clone()),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        object.insert(key.to_string(), Value::Array(upgraded));
    }
    Value::Object(object)
}

/// 上次会话的自愈：旧数据里可能把目录写进 targetFile、把文件写进 mountFolder。
fn normalize_last_session(value: Option<Value>) -> Value {
    let mut session = value
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let target = session
        .get("targetFile")
        .and_then(Value::as_str)
        .filter(|value| Path::new(value).is_absolute())
        .map(str::to_string);
    let mount = session
        .get("mountFolder")
        .and_then(Value::as_str)
        .filter(|value| Path::new(value).is_absolute())
        .map(str::to_string);

    let mut target = target;
    let mut mount = mount;

    if let Some(path) = target.clone() {
        if Path::new(&path).is_dir() {
            if mount.is_none() {
                mount = Some(path);
            }
            target = None;
        }
    }
    if let Some(path) = mount.clone() {
        if Path::new(&path).is_file() {
            if target.is_none() {
                target = Some(path.clone());
            }
            mount = Path::new(&path)
                .parent()
                .map(|parent| parent.to_string_lossy().to_string());
        }
    }

    if let Some(path) = target {
        session.insert("targetFile".into(), json!(path));
    } else {
        session.insert("targetFile".into(), Value::Null);
    }
    if let Some(path) = mount {
        session.insert("mountFolder".into(), json!(path));
    } else {
        session.insert("mountFolder".into(), Value::Null);
    }
    Value::Object(session)
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        let user_data_dir = data_dir.join("userData");
        let _ = std::fs::create_dir_all(&user_data_dir);

        let mut settings = read_json(&data_dir.join("settings.json"))
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        // 早期多参数 IPC 丢值会写入 `key: null`；这些键等价于"未设置"，
        // 保留它们会覆盖渲染层的默认值（例如 showSidebar 变成 null）。
        settings.retain(|_, value| !value.is_null());

        // 一次性迁移：旧版本曾把图表的默认值写成 enable_diagram=false，
        // 导致升级后 Mermaid 全部不渲染；只迁移一次，之后用户手动关闭仍然生效。
        let mut diagram_migrated = false;
        if !settings.contains_key("diagramEnabledMigration") {
            if settings.get("enable_diagram").and_then(Value::as_bool) == Some(false) {
                settings.insert("enable_diagram".into(), json!(true));
                diagram_migrated = true;
            }
            settings.insert("diagramEnabledMigration".into(), json!(true));
        }
        if diagram_migrated {
            let _ = write_json(
                &data_dir.join("settings.json"),
                &Value::Object(settings.clone()),
            );
        }

        let raw_recents = read_json(&data_dir.join("recent.json"))
            .unwrap_or_else(|| json!({ "files": [], "folders": [] }));
        let last_session = normalize_last_session(raw_recents.get("lastSession").cloned());
        let recents = normalize_recents(raw_recents);

        Self {
            data_dir,
            user_data_dir,
            file_undo: Mutex::new(Vec::new()),
            target_files: Mutex::new(std::collections::HashMap::new()),
            pending_switch: Mutex::new(std::collections::HashMap::new()),
            window_seq: std::sync::atomic::AtomicUsize::new(1),
            menu_actions: Mutex::new(std::collections::HashMap::new()),
            menu_commands: Mutex::new(std::collections::HashMap::new()),
            print_view: Mutex::new(None),
            capture_views: Mutex::new(std::collections::HashMap::new()),
            settings: Mutex::new(settings),
            recents: Mutex::new(recents),
            last_session: Mutex::new(last_session),
            unused_assets: Mutex::new(std::collections::HashMap::new()),
            doc_sync: Mutex::new(std::collections::HashMap::new()),
            folder_watchers: Mutex::new(std::collections::HashMap::new()),
            allowed_close_windows: Mutex::new(std::collections::HashSet::new()),
            close_flow_running: Mutex::new(std::collections::HashSet::new()),
            last_focused_window: Mutex::new(None),
        }
    }


    pub fn get(&self, key: &str) -> Value {
        self.settings
            .lock()
            .ok()
            .and_then(|map| map.get(key).cloned())
            .unwrap_or(Value::Null)
    }

    pub fn put(&self, key: &str, value: Value) {
        if let Ok(mut map) = self.settings.lock() {
            map.insert(key.to_string(), value);
        }
        self.persist();
    }

    pub fn all_settings(&self) -> Value {
        self.settings
            .lock()
            .map(|map| Value::Object(map.clone()))
            .unwrap_or_else(|_| json!({}))
    }

    pub fn recents(&self) -> Value {
        let mut snapshot = self
            .recents
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| json!({ "files": [], "folders": [] }));
        if let Some(object) = snapshot.as_object_mut() {
            if let Ok(session) = self.last_session.lock() {
                object.insert("lastSession".into(), session.clone());
            }
        }
        snapshot
    }

    /// 上次会话（`{targetFile, mountFolder, time}`）。
    pub fn last_session(&self) -> Value {
        self.last_session
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| json!({ "targetFile": null, "mountFolder": null }))
    }

    /// 更新上次会话。`None` 表示该字段不变，`Some(None)` 表示清空。
    pub fn set_last_session(
        &self,
        target: Option<Option<&str>>,
        mount: Option<Option<&str>>,
    ) {
        let Ok(mut session) = self.last_session.lock() else {
            return;
        };
        if !session.is_object() {
            *session = json!({});
        }
        if let Some(value) = target {
            let path = value
                .filter(|p| !p.is_empty() && Path::new(p).is_absolute())
                .map(|p| json!(p))
                .unwrap_or(Value::Null);
            session["targetFile"] = path;
        }
        if let Some(value) = mount {
            let path = value
                .filter(|p| !p.is_empty() && Path::new(p).is_absolute())
                .map(|p| json!(p))
                .unwrap_or(Value::Null);
            session["mountFolder"] = path;
        }
        session["time"] = json!(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        );
        // 先释放 last_session 锁，write_recents 会再次读取它并写文件。
        drop(session);

        let snapshot = self
            .recents
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| json!({ "files": [], "folders": [] }));
        self.write_recents(snapshot);
    }

    pub fn push_recent(&self, kind: &str, path: &str, limit: usize) {
        let mut guard = match self.recents.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let key = if kind == "folder" { "folders" } else { "files" };
        if let Some(list) = guard.get_mut(key).and_then(|v| v.as_array_mut()) {
            // 渲染层按 `{ path, name, pinned }` 使用最近列表：
            // 只存字符串会让 folder.path 变成 undefined，随后 path.indexOf(...)
            // 抛错，侧边栏与偏好设置的相关区域直接空白。
            list.retain(|item| item.get("path").and_then(Value::as_str) != Some(path));
            list.insert(0, recent_entry(path));
            list.truncate(limit);
        }
        let snapshot = guard.clone();
        drop(guard);
        self.write_recents(snapshot);
    }

    /// 从最近列表里移除某个路径（文件或文件夹）。
    pub fn remove_recent(&self, kind: &str, path: &str) {
        let key = if kind == "folder" { "folders" } else { "files" };
        let mut guard = match self.recents.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(list) = guard.get_mut(key).and_then(|v| v.as_array_mut()) {
            list.retain(|item| item.get("path").and_then(Value::as_str) != Some(path));
        }
        let snapshot = guard.clone();
        drop(guard);
        self.write_recents(snapshot);

        // 被移除的正好是上次会话时，同步清掉，避免下次启动恢复一个已删除的路径。
        let session = self.last_session();
        let key = if kind == "folder" { "mountFolder" } else { "targetFile" };
        if session.get(key).and_then(Value::as_str) == Some(path) {
            if kind == "folder" {
                self.set_last_session(None, Some(None));
            } else {
                self.set_last_session(Some(None), None);
            }
        }
    }

    /// 记录一次可撤销的文件操作。
    pub fn register_file_undo(&self, target: String, source: String, label: String) {
        if let Ok(mut stack) = self.file_undo.lock() {
            stack.push(FileUndoItem { target, source, label });
        }
    }

    /// 栈顶操作的显示名（空栈返回 None）。
    pub fn undo_label(&self) -> Option<String> {
        let stack = self.file_undo.lock().ok()?;
        let item = stack.last()?;
        Some(if item.label.is_empty() {
            "File Operation".to_string()
        } else {
            item.label.clone()
        })
    }

    /// 栈顶操作涉及的源路径（用于菜单定位）。
    pub fn undo_focus_path(&self) -> Option<String> {
        let stack = self.file_undo.lock().ok()?;
        let item = stack.last()?;
        if !item.source.is_empty() {
            Some(item.source.clone())
        } else if !item.target.is_empty() {
            Some(item.target.clone())
        } else {
            None
        }
    }

    /// 执行栈顶撤销：把 target 改回 source。
    pub fn perform_file_undo(&self) -> bool {
        let Ok(mut stack) = self.file_undo.lock() else {
            return false;
        };
        let Some(item) = stack.pop() else {
            return false;
        };
        if item.target.is_empty() || item.source.is_empty() {
            return false;
        }
        let target = std::path::Path::new(&item.target);
        let source = std::path::Path::new(&item.source);
        if target.exists() && !source.exists() {
            std::fs::rename(target, source).is_ok()
        } else {
            false
        }
    }

    pub fn clear_file_undo(&self) {
        if let Ok(mut stack) = self.file_undo.lock() {
            stack.clear();
        }
    }

    /// 指定窗口的当前文档路径（None 表示未命名文档）。
    pub fn target_file(&self, window_label: &str) -> Option<String> {
        self.target_files
            .lock()
            .ok()
            .and_then(|guard| guard.get(window_label).cloned())
    }

    /// 检查窗口是否已获准关闭（已通过保存/丢弃/未编辑检查）。
    pub fn is_close_allowed(&self, window_label: &str) -> bool {
        self.allowed_close_windows
            .lock()
            .map(|set| set.contains(window_label))
            .unwrap_or(false)
    }

    /// 标记/清除窗口的关闭许可。
    pub fn set_close_allowed(&self, window_label: &str, allowed: bool) {
        if let Ok(mut set) = self.allowed_close_windows.lock() {
            if allowed {
                set.insert(window_label.to_string());
            } else {
                set.remove(window_label);
            }
        }
    }

    /// 尝试开启窗口关闭流程（如果已在进行中则返回 false，防止重复触发）。
    pub fn start_close_flow(&self, window_label: &str) -> bool {
        if let Ok(mut set) = self.close_flow_running.lock() {
            set.insert(window_label.to_string())
        } else {
            false
        }
    }

    /// 重置窗口关闭流程状态。
    pub fn reset_close_flow(&self, window_label: &str) {
        if let Ok(mut set) = self.close_flow_running.lock() {
            set.remove(window_label);
        }
    }

    /// 记录 textbundle 正在使用的资产清单（`document.recordUnusedAssets`）。
    pub fn record_unused_assets(&self, doc_path: &str, used: Vec<String>) {
        if let Ok(mut guard) = self.unused_assets.lock() {
            guard.insert(doc_path.to_string(), used);
        }
    }

    /// 读取 textbundle 的资产清单（清理流程消费，见 task 文档）。
    #[allow(dead_code)]
    pub fn unused_assets_for(&self, doc_path: &str) -> Option<Vec<String>> {
        self.unused_assets
            .lock()
            .ok()
            .and_then(|guard| guard.get(doc_path).cloned())
    }

    /// 归一化文档路径以便跨窗口比较：
    /// - 统一分隔符（'/' -> '\\'）
    /// - Windows 下统一转小写（Windows 文件系统不区分大小写）
    /// - 去除尾部斜杠
    pub fn normalize_doc_path(path: &str) -> String {
        // 统一走 crate::paths：原生分隔符 + Windows 小写，跨窗口才能对上同一文档。
        crate::paths::for_compare(path)
    }

    /// 存储某文档最新的同步内容（由活动窗口推送）。
    pub fn set_sync_content(&self, doc_path: &str, entry: DocSyncEntry) {
        if let Ok(mut guard) = self.doc_sync.lock() {
            guard.insert(Self::normalize_doc_path(doc_path), entry);
        }
    }

    /// 读取某文档最新的同步内容。
    pub fn sync_content(&self, doc_path: &str) -> Option<DocSyncEntry> {
        self.doc_sync.lock().ok()?.get(&Self::normalize_doc_path(doc_path)).cloned()
    }

    /// 除 `except_label` 外，还有哪些窗口打开了同一文档。
    pub fn other_windows_for(
        &self,
        doc_path: &str,
        except_label: &str,
    ) -> Vec<String> {
        let Ok(guard) = self.target_files.lock() else {
            return Vec::new();
        };
        let norm_doc = Self::normalize_doc_path(doc_path);
        guard
            .iter()
            .filter(|(label, path)| {
                label.as_str() != except_label && Self::normalize_doc_path(path) == norm_doc
            })
            .map(|(label, _)| label.clone())
            .collect()
    }

    /// 注册挂载目录的文件监视器；同一目录只注册一次。
    /// `on_change` 在 notify 的事件线程上被调用（参数：变更的路径，可能为空）。
    pub fn register_folder_watcher(
        &self,
        dir: PathBuf,
        on_change: impl Fn(Option<String>) + Send + 'static,
    ) -> bool {
        let mut guard = match self.folder_watchers.lock() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        if guard.contains_key(&dir) {
            return true; // 已在监视
        }
        let watcher = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| match res {
                Ok(event) => {
                    let path = event
                        .paths
                        .first()
                        .map(|p| p.to_string_lossy().to_string());
                    on_change(path);
                }
                Err(err) => log::warn!("[watcher] 目录监视错误: {err}"),
            },
        );
        match watcher {
            Ok(mut watcher) => {
                use notify::Watcher;
                match watcher.watch(&dir, notify::RecursiveMode::Recursive) {
                    Ok(_) => {
                        guard.insert(dir, watcher);
                        true
                    }
                    Err(err) => {
                        log::warn!("[watcher] watch 失败 {dir:?}: {err}");
                        false
                    }
                }
            }
            Err(err) => {
                log::warn!("[watcher] 创建监视器失败: {err}");
                false
            }
        }
    }

    pub fn set_target_file(&self, window_label: &str, path: Option<String>) {
        if let Ok(mut guard) = self.target_files.lock() {
            match path {
                Some(value) => {
                    guard.insert(window_label.to_string(), value);
                }
                None => {
                    guard.remove(window_label);
                }
            }
        }
    }

    /// 记下"这个窗口还没就绪，等渲染层 ready 后再切到这个文档"。
    pub fn set_pending_switch(&self, window_label: &str, path: &str) {
        if let Ok(mut guard) = self.pending_switch.lock() {
            guard.insert(window_label.to_string(), path.to_string());
        }
    }

    /// 取走待切换文档（只消费一次）。
    pub fn take_pending_switch(&self, window_label: &str) -> Option<String> {
        self.pending_switch
            .lock()
            .ok()
            .and_then(|mut guard| guard.remove(window_label))
    }

    /// 其它窗口里是否存在同名文档（不含扩展名）。
    pub fn has_duplicate_name(&self, window_label: &str, title: &str) -> bool {
        let Ok(guard) = self.target_files.lock() else {
            return false;
        };
        guard.iter().any(|(label, path)| {
            if label == window_label {
                return false;
            }
            let base = std::path::Path::new(path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            base == title
        })
    }

    /// 重命名后同步最近列表：把旧路径替换成新路径（保持位置不变）。
    pub fn rename_recent(&self, old_path: &str, new_path: &str) {
        let mut guard = match self.recents.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(list) = guard.get_mut("files").and_then(|v| v.as_array_mut()) {
            for item in list.iter_mut() {
                // 条目是 `{path, name, pinned}` 对象（旧版可能是裸字符串）。
                let matches = item.get("path").and_then(Value::as_str) == Some(old_path)
                    || item.as_str() == Some(old_path);
                if matches {
                    let pinned = item.get("pinned").cloned().unwrap_or(json!(false));
                    *item = recent_entry(new_path);
                    item["pinned"] = pinned;
                }
            }
        }
        let snapshot = guard.clone();
        drop(guard);
        self.write_recents(snapshot);

        let session = self.last_session();
        if session.get("targetFile").and_then(Value::as_str) == Some(old_path) {
            self.set_last_session(Some(Some(new_path)), None);
        }
        if session.get("mountFolder").and_then(Value::as_str) == Some(old_path) {
            self.set_last_session(None, Some(Some(new_path)));
        }
    }

    /// 清空最近文件列表（保留最近文件夹）。
    pub fn clear_recent_documents(&self) {
        let mut guard = match self.recents.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(list) = guard.get_mut("files").and_then(|v| v.as_array_mut()) {
            list.clear();
        }
        let snapshot = guard.clone();
        drop(guard);
        self.write_recents(snapshot);
    }

    /// 清空最近目录列表（保留最近文件）。
    pub fn clear_recent_locations(&self) {
        let mut guard = match self.recents.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(list) = guard.get_mut("folders").and_then(|v| v.as_array_mut()) {
            list.clear();
        }
        let snapshot = guard.clone();
        drop(guard);
        self.write_recents(snapshot);
    }

    /// 生成下一个文档窗口 label 后缀。
    pub fn next_window_seq(&self) -> usize {
        self.window_seq
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// 登记一次弹出菜单的动作。
    pub fn set_menu_action(&self, id: &str, window_label: &str, code: &str) {
        if let Ok(mut map) = self.menu_actions.lock() {
            map.insert(id.to_string(), (window_label.to_string(), code.to_string()));
        }
    }

    /// 取出并移除菜单动作（一次性）。
    pub fn set_menu_command(&self, id: &str, code: &str) {
        if let Ok(mut map) = self.menu_commands.lock() {
            map.insert(id.to_string(), code.to_string());
        }
    }

    pub fn menu_command(&self, id: &str) -> Option<String> {
        self.menu_commands.lock().ok()?.get(id).cloned()
    }

    pub fn menu_command_ids(&self) -> Vec<String> {
        self.menu_commands
            .lock()
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// 记录最近获取焦点的窗口（原生顶栏菜单失焦时的路由目标）
    pub fn set_last_focused_window(&self, label: &str) {
        if let Ok(mut lock) = self.last_focused_window.lock() {
            *lock = Some(label.to_string());
        }
    }

    /// 获取最近活跃窗口 label
    pub fn last_focused_window(&self) -> Option<String> {
        self.last_focused_window
            .lock()
            .ok()
            .and_then(|lock| lock.clone())
    }

    /// 窗口销毁时清理活跃记录
    pub fn clear_last_focused_window(&self, label: &str) {
        if let Ok(mut lock) = self.last_focused_window.lock() {
            if lock.as_deref() == Some(label) {
                *lock = None;
            }
        }
    }

    pub fn take_menu_action(&self, id: &str) -> Option<(String, String)> {
        self.menu_actions.lock().ok()?.remove(id)
    }

    pub fn clear_menu_actions(&self) {
        if let Ok(mut map) = self.menu_actions.lock() {
            map.clear();
        }
    }

    pub fn set_print_view(&self, label: Option<String>) {
        if let Ok(mut slot) = self.print_view.lock() {
            *slot = label;
        }
    }

    pub fn print_view(&self) -> Option<String> {
        self.print_view.lock().ok().and_then(|slot| slot.clone())
    }

    pub fn register_capture_view(&self, view_id: String, label: String) {
        if let Ok(mut views) = self.capture_views.lock() {
            views.insert(view_id, label);
        }
    }

    pub fn capture_view(&self, view_id: &str) -> Option<String> {
        self.capture_views
            .lock()
            .ok()
            .and_then(|views| views.get(view_id).cloned())
    }

    /// 取出并注销捕获视图（由关窗口的一方调用）。
    pub fn take_capture_view(&self, view_id: &str) -> Option<String> {
        self.capture_views
            .lock()
            .ok()
            .and_then(|mut views| views.remove(view_id))
    }

    fn persist(&self) {
        let snapshot = self.all_settings();
        let _ = write_json(&self.data_dir.join("settings.json"), &snapshot);
    }

    /// `recent.json` 同时保存最近列表与上次会话；所有写入都走这里，
    /// 避免某一次只写 files/folders 把 `lastSession` 覆盖掉。
    fn write_recents(&self, recents: Value) {
        let mut snapshot = recents;
        if let Some(object) = snapshot.as_object_mut() {
            if let Ok(session) = self.last_session.lock() {
                object.insert("lastSession".into(), session.clone());
            }
        }
        let _ = write_json(&self.data_dir.join("recent.json"), &snapshot);
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into());
    std::fs::write(path, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arbormark-state-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn stores_and_reads_settings() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        assert_eq!(state.get("missing"), Value::Null);
        state.put("curTheme", json!("night.css"));
        assert_eq!(state.get("curTheme"), json!("night.css"));
        assert_eq!(state.all_settings()["curTheme"], json!("night.css"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn persists_settings_across_instances() {
        let dir = temp_dir();
        {
            let state = AppState::new(dir.clone());
            state.put("zoomFactor", json!(1.25));
        }

        let reopened = AppState::new(dir.clone());
        assert_eq!(reopened.get("zoomFactor"), json!(1.25));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn menu_actions_are_one_shot() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        state.set_menu_action("popup-1", "main", "window.doThing()");
        assert_eq!(
            state.take_menu_action("popup-1"),
            Some(("main".to_string(), "window.doThing()".to_string()))
        );
        // 取过一次就没了
        assert_eq!(state.take_menu_action("popup-1"), None);

        state.set_menu_action("popup-2", "doc-1", "window.other()");
        state.clear_menu_actions();
        assert_eq!(state.take_menu_action("popup-2"), None);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tracks_target_file_per_window() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        assert_eq!(state.target_file("main"), None);

        state.set_target_file("main", Some("/projects/a/notes.md".into()));
        state.set_target_file("doc-1", Some("/projects/b/notes.md".into()));

        assert_eq!(state.target_file("main").as_deref(), Some("/projects/a/notes.md"));
        assert_eq!(state.target_file("doc-1").as_deref(), Some("/projects/b/notes.md"));

        // 两个窗口都打开了 notes.md → 互相判定为同名
        assert!(state.has_duplicate_name("main", "notes"));
        assert!(state.has_duplicate_name("doc-1", "notes"));
        // 不同名不误报
        assert!(!state.has_duplicate_name("main", "other"));

        // main 关闭文档后，doc-1 不再有同名冲突
        state.set_target_file("main", None);
        assert_eq!(state.target_file("main"), None);
        assert!(!state.has_duplicate_name("doc-1", "notes"));

        // 跨窗口同文档查找：Windows 下大小写与正反斜杠都要归一化；
        // POSIX 大小写敏感，只验证相同的原生路径能命中。
        #[cfg(windows)]
        {
            state.set_target_file("main", Some("C:/Users/Arbor/Desktop/sandbox.md".into()));
            state.set_target_file("doc-1", Some("C:\\Users\\Arbor\\Desktop\\sandbox.md".into()));
            state.set_target_file("doc-2", Some("c:/users/arbor/desktop/sandbox.md".into()));

            let others_for_main =
                state.other_windows_for("C:\\Users\\Arbor\\Desktop\\sandbox.md", "main");
            assert_eq!(others_for_main.len(), 2);
            assert!(others_for_main.contains(&"doc-1".to_string()));
            assert!(others_for_main.contains(&"doc-2".to_string()));

            let others_for_doc1 =
                state.other_windows_for("c:\\users\\arbor\\desktop\\sandbox.md", "doc-1");
            assert_eq!(others_for_doc1.len(), 2);
            assert!(others_for_doc1.contains(&"main".to_string()));
            assert!(others_for_doc1.contains(&"doc-2".to_string()));
        }

        #[cfg(not(windows))]
        {
            state.set_target_file("main", Some("/tmp/sandbox.md".into()));
            state.set_target_file("doc-1", Some("/tmp/sandbox.md".into()));
            state.set_target_file("doc-2", Some("/tmp/other.md".into()));
            let others = state.other_windows_for("/tmp/sandbox.md", "main");
            assert_eq!(others, vec!["doc-1".to_string()]);
        }

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tracks_window_close_handshake_state() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        assert!(!state.is_close_allowed("main"));
        assert!(state.start_close_flow("main"));
        // 重复调用返回 false（防重入）
        assert!(!state.start_close_flow("main"));

        state.reset_close_flow("main");
        assert!(state.start_close_flow("main"));

        state.set_close_allowed("main", true);
        assert!(state.is_close_allowed("main"));

        state.set_close_allowed("main", false);
        assert!(!state.is_close_allowed("main"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn clear_recent_documents_keeps_folders() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        state.push_recent("file", "/a.md", 20);
        state.push_recent("file", "/b.md", 20);
        state.push_recent("folder", "/docs", 20);

        state.clear_recent_documents();

        let recents = state.recents();
        assert_eq!(recents["files"], json!([]));
        assert_eq!(recents["folders"][0]["path"], json!("/docs"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn clear_recent_locations_keeps_files() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        state.push_recent("file", "/a.md", 20);
        state.push_recent("folder", "/docs", 20);
        state.push_recent("folder", "/notes", 20);

        state.clear_recent_locations();

        let recents = state.recents();
        assert_eq!(recents["folders"], json!([]));
        assert_eq!(recents["files"][0]["path"], json!("/a.md"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn file_undo_stack_roundtrip() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        assert_eq!(state.undo_label(), None);
        assert!(!state.perform_file_undo());

        let target = dir.join("renamed.md");
        let source = dir.join("original.md");
        std::fs::write(&target, "content").expect("write target");

        state.register_file_undo(
            target.to_string_lossy().to_string(),
            source.to_string_lossy().to_string(),
            "Rename".to_string(),
        );

        assert_eq!(state.undo_label().as_deref(), Some("Rename"));
        assert_eq!(
            state.undo_focus_path(),
            Some(source.to_string_lossy().to_string())
        );

        assert!(state.perform_file_undo(), "undo should rename back");
        assert!(source.exists(), "source should exist after undo");
        assert!(!target.exists(), "target should be gone after undo");

        state.clear_file_undo();
        assert_eq!(state.undo_label(), None);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn push_recent_dedups_and_truncates() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        state.push_recent("file", "/a.md", 2);
        state.push_recent("file", "/b.md", 2);
        state.push_recent("file", "/a.md", 2);
        state.push_recent("file", "/c.md", 2);

        let files = state.recents()["files"].clone();
        let paths: Vec<&str> = files
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, vec!["/c.md", "/a.md"]);
        // 渲染层需要的字段
        assert_eq!(files[0]["name"], json!("c.md"));
        assert_eq!(files[0]["pinned"], json!(false));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn last_focused_window_tracks_and_clears() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());
        assert_eq!(state.last_focused_window(), None);

        state.set_last_focused_window("main");
        assert_eq!(state.last_focused_window(), Some("main".to_string()));

        state.set_last_focused_window("doc-1");
        assert_eq!(state.last_focused_window(), Some("doc-1".to_string()));

        // 清理非当前窗口不影响记录
        state.clear_last_focused_window("main");
        assert_eq!(state.last_focused_window(), Some("doc-1".to_string()));

        // 清理当前窗口归为 None
        state.clear_last_focused_window("doc-1");
        assert_eq!(state.last_focused_window(), None);

        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod recents_shape_tests {
    use super::*;

    #[test]
    fn legacy_string_recents_are_upgraded_on_load() {
        let dir = std::env::temp_dir().join(format!("arbormark-recents-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("recent.json"),
            r#"{"files":["/tmp/a.md"],"folders":["/tmp/notes"]}"#,
        )
        .unwrap();

        let state = AppState::new(dir.clone());
        let recents = state.recents();
        assert_eq!(recents["files"][0]["path"], json!("/tmp/a.md"));
        assert_eq!(recents["files"][0]["name"], json!("a.md"));
        assert_eq!(recents["folders"][0]["path"], json!("/tmp/notes"));
        assert_eq!(recents["folders"][0]["name"], json!("notes"));
        assert_eq!(recents["folders"][0]["pinned"], json!(false));

        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod last_session_tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arbormark-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn last_session_is_persisted_with_recents() {
        let dir = temp_dir();
        let file = dir.join("note.md");
        std::fs::write(&file, "hello").unwrap();
        let file_path = file.to_string_lossy().to_string();
        let dir_path = dir.to_string_lossy().to_string();

        {
            let state = AppState::new(dir.clone());
            state.set_last_session(Some(Some(file_path.as_str())), Some(Some(dir_path.as_str())));
            // 再写一次最近列表，不能把 lastSession 覆盖掉。
            state.push_recent("file", &file_path, 20);
        }

        let reopened = AppState::new(dir.clone());
        let session = reopened.last_session();
        assert_eq!(session["targetFile"], json!(file_path));
        assert_eq!(session["mountFolder"], json!(dir_path));
        assert_eq!(reopened.recents()["lastSession"]["targetFile"], json!(file_path));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn last_session_can_be_cleared_and_is_repaired() {
        let dir = temp_dir();
        let state = AppState::new(dir.clone());

        // 目录被写进 targetFile 时，加载后应挪到 mountFolder。
        let dir_text = dir.to_string_lossy().to_string();
        state.set_last_session(Some(Some(dir_text.as_str())), None);
        let session = AppState::new(dir.clone()).last_session();
        assert_eq!(session["targetFile"], Value::Null);
        assert_eq!(session["mountFolder"], json!(dir.to_string_lossy().to_string()));

        state.set_last_session(Some(None), Some(None));
        assert_eq!(state.last_session()["targetFile"], Value::Null);
        assert_eq!(state.last_session()["mountFolder"], Value::Null);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn null_settings_are_dropped_on_load() {
        let dir = temp_dir();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"showSidebar":null,"sidebar-width":null,"zoomFactor":1.25}"#,
        )
        .unwrap();

        let state = AppState::new(dir.clone());
        assert_eq!(state.get("showSidebar"), Value::Null);
        assert_eq!(state.get("zoomFactor"), json!(1.25));

        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod diagram_migration_tests {
    use super::*;

    #[test]
    fn legacy_disabled_diagram_is_enabled_once() {
        let dir = std::env::temp_dir().join(format!("arbormark-diagram-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"enable_diagram":false}"#,
        )
        .unwrap();

        let migrated = AppState::new(dir.clone());
        assert_eq!(migrated.get("enable_diagram"), json!(true));
        assert_eq!(migrated.get("diagramEnabledMigration"), json!(true));

        // 用户之后手动关闭时，标记已经存在，不再被迁移覆盖。
        migrated.put("enable_diagram", json!(false));
        let reopened = AppState::new(dir.clone());
        assert_eq!(reopened.get("enable_diagram"), json!(false));

        let _ = std::fs::remove_dir_all(dir);
    }
}
