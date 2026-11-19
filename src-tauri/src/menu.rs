//! 原生应用菜单。
//!
//! 菜单树来自 `menu-spec.json`（由旧版 Electron 的 `menu-builder.js` 导出），
//! 覆盖文件/编辑/段落/格式/视图/主题/窗口/帮助八个菜单，共 300+ 项：
//!   * `id` 沿用旧版“路径式 id”（如 `View→Source Code Mode`），渲染层
//!     `JSBridge.menu.update({ "View→…": { state: true } })` 能精确命中；
//!   * `clickCode` 是点击后在当前窗口执行的 JS，由渲染层命令系统解释；
//!   * `checked` / `enabled` 是初始状态，之后由 `menu.update` 增量同步。
//!
//! 最近文件/最近目录与主题的勾选是动态的：前两者在构建时从 AppState 读取，
//! 后者在主题切换后由 `sync_theme_checks()` 重新标记。

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::menu::{
    CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, MenuItemKind, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::{AppHandle, Manager, Runtime};

use crate::state::AppState;

/// 由旧版菜单模板导出的静态结构，编译期嵌入。
const MENU_SPEC: &str = include_str!("../menu-spec.json");

/// 上次构建菜单时的"最近列表"指纹。
///
/// 这份数据只有菜单关心（`AppState` 已经够大了），所以放在模块里：拿它跟当前
/// 列表比对，就能判断值不值得花几百个菜单项的代价重建整棵树。
static RECENT_FINGERPRINT: Mutex<String> = Mutex::new(String::new());

/// 渲染层最后一次推送的主题注册表（`menu.dump` 重建"主题"子菜单用）。
static THEMES_CACHE: Mutex<Option<Value>> = Mutex::new(None);

/// 最近文件 / 最近目录的唯一输入指纹。
///
/// `AppState::recents()` 会把 `lastSession` 合并进来，但会话对象里带着时间戳，
/// 每次落盘都在变——它并不出现在菜单里，剔除后才能稳定地判断"要不要重建"。
fn recents_fingerprint(app: &AppHandle) -> String {
    let Some(state) = app.try_state::<AppState>() else {
        return String::new();
    };
    match state.recents() {
        Value::Object(mut map) => {
            map.remove("lastSession");
            Value::Object(map).to_string()
        }
        other => other.to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct SpecItem {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    accelerator: Option<String>,
    #[serde(default)]
    checked: Option<bool>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    dynamic: Option<String>,
    #[serde(default)]
    submenu: Option<Vec<SpecItem>>,
    #[serde(default, rename = "clickCode")]
    click_code: Option<String>,
}

/// `menu-spec.json` 的 label 是简体中文；按当前 locale 查 `Menu.json` 翻译。
///
/// 菜单 id 保持不变（渲染层按路径 id 同步勾选），只替换显示文案。
struct MenuLabels {
    locale: String,
    dict: std::collections::HashMap<String, String>,
    /// 中文 label -> `Menu.json` 的英文 key。
    reverse: std::collections::HashMap<String, String>,
}

impl MenuLabels {
    fn load(app: &AppHandle) -> Self {
        let locale = app
            .try_state::<AppState>()
            .map(|state| {
                let user_language = state
                    .get("userLanguage")
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                crate::locale::resolve_app_locale(Some(&user_language))
            })
            .unwrap_or_else(|| "zh-Hans".to_string());

        let root = locales_root(app);
        let dict = read_locale(&root, &locale);
        log::debug!(
            "[menu] 语言 {}，Menu.json 条目 {}",
            locale,
            dict.len()
        );
        let mut reverse = std::collections::HashMap::new();
        for (zh, en) in extra_zh_to_en() {
            let clean = zh
                .trim_end_matches('…')
                .trim_end_matches("...")
                .trim()
                .to_string();
            reverse.insert(zh, en.clone());
            reverse.insert(clean, en);
        }
        for (key, value) in read_locale(&root, "zh-Hans") {
            if value.trim().is_empty() {
                continue;
            }
            reverse.insert(value.clone(), key.clone());
            reverse.insert(value.trim_end_matches('…').trim().to_string(), key);
        }

        let labels = Self {
            locale,
            dict,
            reverse,
        };
        log::debug!(
            "[menu] label 示例：文件 -> {}，偏好设置… -> {}",
            labels.label("文件"),
            labels.label("偏好设置…")
        );
        labels
    }

    fn label(&self, raw: &str) -> String {
        translate_label(&self.locale, raw, &self.dict, &self.reverse)
    }
}

fn translate_label(
    locale: &str,
    raw: &str,
    dict: &std::collections::HashMap<String, String>,
    reverse: &std::collections::HashMap<String, String>,
) -> String {
    if raw.is_empty() {
        return raw.to_string();
    }
    // 简体中文直接使用 spec 里的原始文案（与旧版 isZh 分支一致）。
    if locale.starts_with("zh-Hans") {
        return raw.to_string();
    }

    let has_ellipsis = raw.ends_with('…') || raw.ends_with("...");
    let clean = raw
        .trim_end_matches('…')
        .trim_end_matches("...")
        .trim()
        .to_string();
    let en_key = reverse
        .get(raw)
        .or_else(|| reverse.get(&clean))
        .cloned()
        .unwrap_or_else(|| clean.clone());

    let mut translated = dict
        .get(&en_key)
        .or_else(|| dict.get(raw))
        .or_else(|| dict.get(&clean))
        .cloned()
        .unwrap_or_else(|| en_key.clone());

    if has_ellipsis && !translated.ends_with('…') && !translated.ends_with("...") {
        translated.push('…');
    }
    translated
}

/// 菜单翻译目录：打包后随应用分发（bundle resources），开发期用源码树。
fn locales_root(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("locales");
        if bundled.is_dir() {
            return bundled;
        }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("locales")
}

fn read_locale(root: &std::path::Path, locale: &str) -> std::collections::HashMap<String, String> {
    let path = root.join(format!("{locale}.lproj")).join("Menu.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn extra_zh_to_en() -> std::collections::HashMap<String, String> {
    let pairs = [
        ("文件", "File"),
        ("编辑", "Edit"),
        ("段落", "Paragraph"),
        ("格式", "Format"),
        ("视图", "View"),
        ("主题", "Themes"),
        ("窗口", "Window"),
        ("帮助", "Help"),
        ("全局搜索", "Global Search"),
        ("（无最近文件）", "No Recent Files"),
        ("（无最近目录）", "No Recent Files"),
        ("清除最近目录", "Clear Items"),
        ("清除最近文件", "Clear Items"),
        ("使用上次的导出设置导出", "Export with Previous"),
        ("导出并覆盖上一次导出的文件", "Export and Overwrite with Previous"),
        ("复制图片内容", "Copy Image Content"),
        ("选中当前行或句", "Select Line / Sentence"),
        ("选中当前格式文本", "Select Styled Scope"),
        ("选中当前词", "Select Word"),
        ("选中段落或块", "Select Paragraph / Block"),
        ("解析时重映射 Unicode 标点", "Remap Unicode Punctuation on Parse"),
        ("保存时插入末尾换行符", "Insert Final New Line On Save"),
        ("空白与换行", "Whitespace and Line Breaks"),
        ("段落首行缩进", "Indent first line of paragraphs"),
        ("保留单个换行", "Preserve single line break"),
        ("可见换行符", "Visible <br/>"),
        ("删除选区", "Delete Selected"),
        ("删除段落或块", "Delete Paragraph / Block"),
        ("跳转", "Jump To"),
        ("全部替换", "Replace All"),
        ("拼写与语法", "Spelling and Grammar"),
        ("立即检查文档", "Check Document Now"),
        ("显示拼写检查面板", "Spell Check"),
        ("键入时检查拼写", "Check Spelling While Typing"),
        ("检查拼写及语法", "Check Grammar With Spelling"),
        ("自动更正拼写", "Correct Spelling Automatically"),
        ("自动缩进选中的代码", "Auto Indent Selected Code"),
        ("自动缩进整个代码块", "Auto Indent Whole Code"),
        ("复制代码内容", "Copy Code Content"),
        ("标记为完成", "Mark as Complete"),
        ("标记为未完成", "Mark as Incomplete"),
        ("提醒", "Alert"),
        ("备注 (Note)", "Note Block"),
        ("提示 (Tip)", "Tip Block"),
        ("重要 (Important)", "Important Block"),
        ("警告 (Warning)", "Warning Block"),
        ("严重 (Caution)", "Caution Block"),
        ("复制图片文件到文件夹", "Copy Image File to Folder"),
        ("使用图片根路径", "Use Image Root Path"),
        ("插入本地图片", "Insert Local Images"),
        ("重命名或移动图片到", "Rename or Move Image to"),
        ("字数统计", "Toggle Word Count Popover"),
        ("大纲", "Toggle Outline Popover"),
        ("打开主题文件夹", "Open Themes Folder"),
        ("快速入门", "Quick Start"),
        ("Markdown 语法参考", "Markdown Reference"),
        ("Markdown 参考", "Markdown Reference"),
        ("Markdown 功能示例", "Markdown Demo"),
        ("安装与使用 Pandoc", "Install and Use Pandoc"),
        ("自定义主题", "Custom Themes"),
        ("在 ArborMark 中使用图片", "Use Images in ArborMark"),
        ("数据恢复与版本控制", "Data Recovery and Version Control"),
        ("更多文档…", "More Documents…"),
        ("更多文档", "More Documents"),
        ("新特性…", "What's New…"),
        ("新特性", "What's New"),
        ("发行说明…", "What's New…"),
        ("发行说明", "What's New"),
        ("官方网站", "Website"),
        ("更新日志", "Change Log"),
        ("隐私条款", "Privacy Policy"),
        ("鸣谢", "Credits"),
        ("关于", "About"),
        ("关于 ArborMark", "About ArborMark"),
        ("检查更新", "Check Updates"),
        ("偏好设置", "Preferences"),
        ("退出", "Quit ArborMark"),
        ("退出 ArborMark", "Quit ArborMark"),
        ("清除最近文件", "Clear Items"),
        ("选择编码重新打开", "Reopen with Encoding"),
        ("自动", "Auto"),
        ("属性", "Properties"),
        ("打开文件位置", "Open File Location"),
        ("在侧边栏中显示", "Reveal in Sidebar"),
        ("关闭", "Close"),
        ("新建窗口", "New Window"),
        ("保存全部打开的文件", "Save All"),
        ("更多主题", "More Themes"),
        ("反馈", "Feedback"),
        ("我的许可证", "My License"),
        ("欢迎使用 ArborMark", "Welcome to ArborMark"),
        ("Markdown 功能示例", "Markdown Demo"),
        ("GitHub 项目主页", "GitHub Repository"),
    ];
    pairs
        .iter()
        .map(|(zh, en)| (zh.to_string(), en.to_string()))
        .collect()
}

fn label_of(item: &SpecItem, labels: &MenuLabels) -> String {
    let raw = item
        .label
        .clone()
        .or_else(|| item.role.clone())
        .unwrap_or_default();
    labels.label(&raw)
}

fn is_macos() -> bool {
    cfg!(target_os = "macos")
}

/// 把 Electron 的 role 映射到 Tauri 的预定义菜单项。
fn predefined<R: Runtime>(
    app: &AppHandle<R>,
    role: &str,
    label: &str,
) -> tauri::Result<Option<PredefinedMenuItem<R>>> {
    let text = (!label.is_empty()).then_some(label);
    let item = match role {
        "cut" => PredefinedMenuItem::cut(app, text)?,
        "copy" => PredefinedMenuItem::copy(app, text)?,
        "paste" => PredefinedMenuItem::paste(app, text)?,
        "selectAll" | "select_all" => PredefinedMenuItem::select_all(app, text)?,
        "undo" => PredefinedMenuItem::undo(app, text)?,
        "redo" => PredefinedMenuItem::redo(app, text)?,
        "minimize" => PredefinedMenuItem::minimize(app, text)?,
        "zoom" | "maximize" => PredefinedMenuItem::maximize(app, text)?,
        "togglefullscreen" => PredefinedMenuItem::fullscreen(app, text)?,
        "front" | "bringAllToFront" => {
            if is_macos() {
                PredefinedMenuItem::bring_all_to_front(app, text)?
            } else {
                return Ok(None);
            }
        }
        "about" => PredefinedMenuItem::about(app, text, None)?,
        "services" if is_macos() => PredefinedMenuItem::services(app, text)?,
        "hide" if is_macos() => PredefinedMenuItem::hide(app, text)?,
        "hideOthers" if is_macos() => PredefinedMenuItem::hide_others(app, text)?,
        "unhide" if is_macos() => PredefinedMenuItem::show_all(app, text)?,
        "quit" if is_macos() => PredefinedMenuItem::quit(app, text)?,
        _ => return Ok(None),
    };
    Ok(Some(item))
}

fn register_click<R: Runtime>(app: &AppHandle<R>, id: &str, code: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        state.set_menu_command(id, code);
    }
}

/// 菜单规格里写的是 `recentFiles` / `recentFolders`，`AppState::push_recent`
/// 那边用的却是 `file` / `folder`。两边都得认 —— 之前只判 `kind == "folder"`，
/// 于是「最近使用的目录」子菜单读成了**文件**列表，两个菜单长得一模一样。
fn recent_is_folder(kind: &str) -> bool {
    matches!(kind, "folder" | "folders" | "recentFolders")
}

/// 追加“最近文件 / 最近目录”子菜单（构建时快照，menu.refresh 可重建）。
fn push_recent<'m, R: Runtime>(
    app: &'m AppHandle<R>,
    mut submenu: SubmenuBuilder<'m, R, AppHandle<R>>,
    kind: &str,
    used: &mut HashSet<String>,
    labels: &MenuLabels,
) -> tauri::Result<SubmenuBuilder<'m, R, AppHandle<R>>> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(submenu);
    };
    let is_folder = recent_is_folder(kind);
    let recents = state.recents();
    let key = if is_folder { "folders" } else { "files" };
    let entries = recents
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if entries.is_empty() {
        let placeholder = if is_folder { "（无最近目录）" } else { "（无最近文件）" };
        let placeholder = labels.label(placeholder);
        let id = format!("recent:{kind}:empty");
        if used.insert(id.clone()) {
            let item = MenuItemBuilder::with_id(id, &placeholder)
                .enabled(false)
                .build(app)?;
            submenu = submenu.item(&item);
        }
    } else {
        for (index, entry) in entries.iter().take(10).enumerate() {
            let Some(path) = entry.get("path").and_then(Value::as_str) else {
                continue;
            };
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    std::path::Path::new(path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.to_string())
                });
            let pinned = entry.get("pinned").and_then(Value::as_bool).unwrap_or(false);
            let label = if pinned { format!("📌 {name}") } else { name };
            let id = format!("recent:{kind}:{index}");
            if !used.insert(id.clone()) {
                continue;
            }
            let code = if is_folder {
                // 目录：先弹窗让用户选「当前窗口 / 新窗口 / 取消」。
                format!(
                    "window.ClientCommand?.openRecentFolderWithChoice?.({})",
                    serde_json::to_string(path).unwrap_or_else(|_| "\"\"".into())
                )
            } else {
                format!(
                    "window.ClientCommand?.openWithPath?.({})",
                    serde_json::to_string(path).unwrap_or_else(|_| "\"\"".into())
                )
            };
            register_click(app, &id, &code);
            let item = MenuItemBuilder::with_id(id, label).build(app)?;
            submenu = submenu.item(&item);
        }
    }

    submenu = submenu.item(&PredefinedMenuItem::separator(app)?);
    let clear_id = format!("recent:{kind}:clear");
    if used.insert(clear_id.clone()) {
        // 「清除最近目录」以前调到 `File.clearRecentLocations()`，而它当时清的是
        // **最近文件**（走的 askForClearRecentDocuments）。现在两条各走各的通道。
        let (raw_label, code) = if is_folder {
            (
                "清除最近目录",
                "window.JSBridge?.invoke?.(\"setting.askForClearRecentLocations\")",
            )
        } else {
            (
                "清除最近文件",
                "window.JSBridge?.invoke?.(\"setting.askForClearRecentDocuments\")",
            )
        };
        let label = labels.label(raw_label);
        register_click(app, &clear_id, code);
        let mut builder = MenuItemBuilder::with_id(clear_id, &label);
        if entries.is_empty() {
            builder = builder.enabled(false);
        }
        let item = builder.build(app)?;
        submenu = submenu.item(&item);
    }
    Ok(submenu)
}

/// `menu-spec.json` 沿用 Electron 的 `CmdOrCtrl` / `Command` 写法。
///
/// muda 在 Windows 上会把 macOS 语义的修饰键（`CmdOrCtrl` / `Command` / `Cmd`）
/// 解析成 META(Super) 并直接拒绝
/// （`Couldn't recognize "Windows accelerator modifier: Modifiers(META)"`），
/// 连带整棵顶层菜单构建失败被跳过。这里按平台归一化：Windows 一律用 Ctrl，
/// 其余平台保留原写法（macOS 上 muda 解析为 Cmd）。
fn normalize_accelerator(accelerator: &str) -> String {
    if cfg!(target_os = "windows") {
        // 顺序要紧：长前缀先替换，否则 "CommandOrControl" 会被 "Command" 截断。
        accelerator
            .replace("CommandOrControl", "Ctrl")
            .replace("CmdOrCtrl", "Ctrl")
            .replace("Command", "Ctrl")
            .replace("Cmd", "Ctrl")
    } else {
        accelerator.to_string()
    }
}

fn append_items<'m, R: Runtime>(
    app: &'m AppHandle<R>,
    mut parent: SubmenuBuilder<'m, R, AppHandle<R>>,
    items: &[SpecItem],
    used: &mut HashSet<String>,
    labels: &MenuLabels,
) -> tauri::Result<SubmenuBuilder<'m, R, AppHandle<R>>> {
    for item in items {
        if item.kind.as_deref() == Some("separator") {
            match PredefinedMenuItem::separator(app) {
                Ok(separator) => parent = parent.item(&separator),
                Err(err) => log::warn!("[menu] 分隔符创建失败，跳过: {err}"),
            }
            continue;
        }

        if let Some(dynamic) = item.dynamic.as_deref() {
            let sub = SubmenuBuilder::new(app, label_of(item, labels));
            let sub = match push_recent(app, sub, dynamic, used, labels) {
                Ok(sub) => sub,
                Err(err) => {
                    log::warn!("[menu] 最近列表子菜单创建失败，跳过: {err}");
                    continue;
                }
            };
            match sub.build() {
                Ok(built) => parent = parent.item(&built),
                Err(err) => log::warn!("[menu] 最近列表子菜单构建失败，跳过: {err}"),
            }
            continue;
        }

        if let Some(children) = item.submenu.as_ref() {
            let mut sub = SubmenuBuilder::new(app, label_of(item, labels));
            if let Some(enabled) = item.enabled {
                sub = sub.enabled(enabled);
            }
            let sub = match append_items(app, sub, children, used, labels) {
                Ok(sub) => sub,
                Err(err) => {
                    log::warn!("[menu] 子菜单创建失败，跳过: {err}");
                    continue;
                }
            };
            match sub.build() {
                Ok(built) => parent = parent.item(&built),
                Err(err) => log::warn!("[menu] 子菜单构建失败，跳过: {err}"),
            }
            continue;
        }

        if let Some(role) = item.role.as_deref() {
            match predefined(app, role, &label_of(item, labels)) {
                Ok(Some(pre)) => parent = parent.item(&pre),
                Ok(None) => {}
                Err(err) => log::warn!("[menu] 预定义项 {role} 创建失败，跳过: {err}"),
            }
            continue;
        }

        let label = label_of(item, labels);
        let id = item.id.clone().unwrap_or_else(|| {
            // 无 id 的普通项用一个稳定占位 id，保证可点击但不参与状态同步。
            format!("menu:{label}")
        });
        if !used.insert(id.clone()) {
            continue;
        }
        if let Some(code) = item.click_code.as_deref() {
            if !code.is_empty() {
                register_click(app, &id, code);
            }
        }

        let enabled = item.enabled.unwrap_or(true);
        if item.kind.as_deref() == Some("checkbox") {
            match CheckMenuItemBuilder::with_id(id, label)
                .checked(item.checked.unwrap_or(false))
                .enabled(enabled)
                .build(app)
            {
                Ok(entry) => {
                    if let Some(accel) = item.accelerator.as_deref() {
                        let _ = entry.set_accelerator(Some(&normalize_accelerator(accel)));
                    }
                    parent = parent.item(&entry);
                }
                Err(err) => log::warn!("[menu] 勾选项构建失败，跳过: {err}"),
            }
        } else {
            let mut builder = MenuItemBuilder::with_id(id, label).enabled(enabled);
            if let Some(accel) = item.accelerator.as_deref() {
                builder = builder.accelerator(normalize_accelerator(accel));
            }
            match builder.build(app) {
                Ok(entry) => parent = parent.item(&entry),
                Err(err) => log::warn!("[menu] 菜单项构建失败，跳过: {err}"),
            }
        }
    }
    Ok(parent)
}

/// 安装完整业务菜单（macOS 由第一个子菜单承载应用菜单）。
///
/// 构建完顺便记下最近列表指纹，下一次 `refresh_recent` 就能判断要不要重建。
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    install_inner(app)?;
    note_recents(app);
    Ok(())
}

fn install_inner(app: &AppHandle) -> tauri::Result<()> {
    let spec: Vec<SpecItem> =
        serde_json::from_str(MENU_SPEC).unwrap_or_else(|err| {
            log::error!("[menu] menu-spec.json 解析失败: {err}");
            Vec::new()
        });

    let mut used: HashSet<String> = HashSet::new();
    let mut builder = MenuBuilder::new(app);
    let labels = MenuLabels::load(app);

    for node in &spec {
        let is_app_menu = node.label.as_deref() == Some("ArborMark");
        if is_app_menu && !is_macos() {
            continue;
        }
        let mut sub = SubmenuBuilder::new(app, label_of(node, &labels));
        if let Some(enabled) = node.enabled {
            sub = sub.enabled(enabled);
        }
        if let Some(children) = node.submenu.as_ref() {
            sub = match append_items(app, sub, children, &mut used, &labels) {
                Ok(sub) => sub,
                Err(err) => {
                    log::warn!("[menu] 顶层菜单构建失败，跳过: {err}");
                    continue;
                }
            };
        }
        match sub.build() {
            Ok(built) => builder = builder.item(&built),
            Err(err) => log::warn!("[menu] 顶层菜单构建失败，跳过: {err}"),
        }
    }

    let menu = builder.build()?;
    app.set_menu(menu)?;
    sync_theme_checks(app);

    if let Some(state) = app.try_state::<AppState>() {
        log::info!(
            "[menu] 已安装业务菜单，共 {} 个命令项",
            state.menu_command_ids().len()
        );
    }
    Ok(())
}

/// 重建菜单（语言变化 / 渲染层显式要求；不看指纹）。
pub fn refresh(app: &AppHandle) -> Result<Value, String> {
    // Windows 自定义标题栏：web 端在打开菜单时重新 `menu.dump`，无需重建原生菜单。
    if cfg!(target_os = "windows") {
        return Ok(json!(true));
    }
    install(app).map_err(|err| err.to_string())?;
    Ok(json!(true))
}

/// 记下"当前菜单已经反映了这份最近列表"，供下次 diff。
///
/// 调用方不能已经持有 `RECENT_FINGERPRINT` 的锁——`refresh_recent` 会握着它去构建菜单，
/// 那条路径改用的是不碰这把锁的 `install_inner`。
fn note_recents(app: &AppHandle) {
    let fingerprint = recents_fingerprint(app);
    if let Ok(mut last) = RECENT_FINGERPRINT.lock() {
        *last = fingerprint;
    }
}

/// 最近列表变化后重建菜单；内容没变就跳过。
///
/// 启动阶段渲染层会把同一批路径连续 `updateRecent` 好几次（打开文档、挂载目录、
/// 恢复会话各自写一次），每次都是 246 个菜单项从头建一遍，日志里就是一串
/// `[menu] 已安装业务菜单`。这里先比指纹，只有真的变了才付这个代价。
/// 返回是否真的重建了，方便自检脚本核对。
pub fn refresh_recent(app: &AppHandle) -> Result<Value, String> {
    // Windows 自定义标题栏：没有原生菜单可重建；web 打开"文件"菜单时重新 dump。
    if cfg!(target_os = "windows") {
        return Ok(json!(false));
    }
    // 新窗口正在创建/挂载目录时不要重建整棵原生菜单：macOS 会重新绘制
    // 应用菜单和窗口标题栏，和“新窗口首帧 + 焦点切换”叠加时会闪黑一下。
    // 最近目录本身已经在主窗口菜单中；等回到单窗口后的下一次变更再刷新。
    if app.webview_windows().len() > 1 {
        log::debug!("[menu] 多窗口打开中，延后重建最近列表菜单");
        return Ok(json!(false));
    }
    // 锁要一直握到构建结束：启动阶段好几个 IPC 会并发更新最近列表，只锁比对的话
    // 它们会同时读到旧指纹、一起触发重建（实测每次启动都要多建一棵菜单）。
    let Ok(mut last) = RECENT_FINGERPRINT.lock() else {
        return refresh(app);
    };
    let fingerprint = recents_fingerprint(app);
    if *last == fingerprint {
        log::debug!("[menu] 最近列表无变化，跳过菜单重建");
        return Ok(json!(false));
    }
    install_inner(app).map_err(|err| err.to_string())?;
    *last = fingerprint;
    Ok(json!(true))
}

/// 递归查找菜单项（Tauri 的 `Menu::get` 只查直属子项）。
fn find_item<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<MenuItemKind<R>> {
    fn walk<R: Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<MenuItemKind<R>> {
        for item in items {
            if item.id().0 == id {
                return Some(item);
            }
            if let MenuItemKind::Submenu(sub) = &item {
                if let Ok(children) = sub.items() {
                    if let Some(found) = walk(children, id) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    let menu: Menu<R> = app.menu()?;
    walk(menu.items().ok()?, id)
}

/// `menu.update`：应用渲染层发来的 `{ id: { state, enabled, hidden } }`。
pub fn update_menu_state(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let parsed: Value = match payload {
        Value::String(text) => serde_json::from_str(text).unwrap_or(Value::Null),
        other => other.clone(),
    };
    let Some(entries) = parsed.as_object() else {
        return Ok(json!(0));
    };

    let mut updated = 0usize;
    for (id, value) in entries {
        if !value.is_object() {
            continue;
        }
        let Some(item) = find_item(app, id) else {
            continue;
        };
        if let Some(checked) = value.get("state").and_then(Value::as_bool) {
            if let MenuItemKind::Check(entry) = &item {
                entry.set_checked(checked).map_err(|e| e.to_string())?;
                updated += 1;
            }
        }
        if let Some(enabled) = value.get("enabled").and_then(Value::as_bool) {
            match &item {
                MenuItemKind::MenuItem(entry) => entry.set_enabled(enabled),
                MenuItemKind::Check(entry) => entry.set_enabled(enabled),
                _ => Ok(()),
            }
            .map_err(|e| e.to_string())?;
            updated += 1;
        }
    }
    Ok(json!(updated))
}

/// `menu.rebuildThemes`：渲染层传入主题注册表 `{ themes: [{id,label}], current }`，
/// 重建“主题”子菜单，与 web 主题画廊（含用户自定义主题）保持一致。
pub fn rebuild_themes_menu(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let themes = payload.get("themes").and_then(Value::as_array).cloned().unwrap_or_default();
    let current = payload.get("current").and_then(Value::as_str).unwrap_or("").to_string();
    if let Ok(mut cache) = THEMES_CACHE.lock() {
        *cache = Some(json!({ "themes": themes, "current": current }));
    }
    // Windows 自定义标题栏：没有原生菜单可改，主题子菜单由 menu.dump 现取现用。
    if cfg!(target_os = "windows") {
        return Ok(json!(true));
    }
    let Some(menu) = app.menu() else {
        return Ok(json!(false));
    };
    let Ok(items) = menu.items() else {
        return Ok(json!(false));
    };
    for item in items {
        let MenuItemKind::Submenu(sub) = item else { continue };
        let label = sub.text().unwrap_or_default();
        if label != "主题" && label != "Themes" {
            continue;
        }
        if let Ok(children) = sub.items() {
            for child in children {
                let _ = sub.remove(&child);
            }
        }
        for t in &themes {
            let id = t.get("id").and_then(Value::as_str).unwrap_or("");
            if id.is_empty() {
                continue;
            }
            let label = t.get("label").and_then(Value::as_str).unwrap_or(id);
            let mid = format!("Themes→{id}");
            let code = format!(
                "window.ClientCommand && window.ClientCommand.setTheme && window.ClientCommand.setTheme(\"{id}.css\", \"{id}\")"
            );
            register_click(app, &mid, &code);
            let entry = CheckMenuItemBuilder::with_id(mid, label)
                .checked(id.eq_ignore_ascii_case(&current))
                .build(app)
                .map_err(|e| e.to_string())?;
            sub.append(&entry).map_err(|e| e.to_string())?;
        }
        let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
        sub.append(&sep).map_err(|e| e.to_string())?;
        let folder_id = "Themes→Open Folder";
        register_click(
            app,
            folder_id,
            "window.ClientCommand && window.ClientCommand.openThemesFolder && window.ClientCommand.openThemesFolder()",
        );
        let folder = MenuItemBuilder::with_id(folder_id, "打开主题文件夹…")
            .build(app)
            .map_err(|e| e.to_string())?;
        sub.append(&folder).map_err(|e| e.to_string())?;
        return Ok(json!(true));
    }
    Ok(json!(false))
}

/// 依据当前主题重新勾选“主题”子菜单。
pub fn sync_theme_checks(app: &AppHandle) {
    let Some(menu) = app.menu() else {
        return;
    };
    let themed = crate::protocol::current_theme();
    let base = themed.trim_end_matches(".css").to_lowercase();

    fn walk<R: Runtime>(items: Vec<MenuItemKind<R>>, base: &str) {
        for item in items {
            match &item {
                MenuItemKind::Check(entry) => {
                    let id = entry.id().0.clone();
                    if let Some(theme) = id.strip_prefix("Themes→") {
                        let _ = entry.set_checked(theme.eq_ignore_ascii_case(base));
                    }
                }
                MenuItemKind::Submenu(sub) => {
                    if let Ok(children) = sub.items() {
                        walk(children, base);
                    }
                }
                _ => {}
            }
        }
    }

    if let Ok(items) = menu.items() {
        walk(items, &base);
    }
}

// ---------------------------------------------------------------------------
// Windows 自定义标题栏：菜单树 JSON 序列化（menu.dump）
//
// 与 install_inner 复用同一份 spec / 翻译 / 最近列表 / 主题缓存，但不创建
// 原生菜单项；web 端按此结构渲染 HTML 菜单栏并直接执行 clickCode。
// ---------------------------------------------------------------------------

fn dump_recents(app: &AppHandle, kind: &str, labels: &MenuLabels) -> Vec<Value> {
    let mut out = Vec::new();
    let Some(state) = app.try_state::<AppState>() else {
        return out;
    };
    let is_folder = recent_is_folder(kind);
    let recents = state.recents();
    let key = if is_folder { "folders" } else { "files" };
    let entries = recents
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if entries.is_empty() {
        let placeholder = if is_folder { "（无最近目录）" } else { "（无最近文件）" };
        out.push(json!({
            "type": "item",
            "id": format!("recent:{kind}:empty"),
            "label": labels.label(placeholder),
            "enabled": false,
        }));
    } else {
        for (index, entry) in entries.iter().take(10).enumerate() {
            let Some(path) = entry.get("path").and_then(Value::as_str) else {
                continue;
            };
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    std::path::Path::new(path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.to_string())
                });
            let pinned = entry.get("pinned").and_then(Value::as_bool).unwrap_or(false);
            let label = if pinned { format!("📌 {name}") } else { name };
            let code = if is_folder {
                format!(
                    "window.ClientCommand?.openRecentFolderWithChoice?.({})",
                    serde_json::to_string(path).unwrap_or_else(|_| "\"\"".into())
                )
            } else {
                format!(
                    "window.ClientCommand?.openWithPath?.({})",
                    serde_json::to_string(path).unwrap_or_else(|_| "\"\"".into())
                )
            };
            out.push(json!({
                "type": "item",
                "id": format!("recent:{kind}:{index}"),
                "label": label,
                "clickCode": code,
            }));
        }
    }
    out.push(json!({ "type": "sep" }));
    let (raw_label, code) = if is_folder {
        (
            "清除最近目录",
            "window.JSBridge?.invoke?.(\"setting.askForClearRecentLocations\")",
        )
    } else {
        (
            "清除最近文件",
            "window.JSBridge?.invoke?.(\"setting.askForClearRecentDocuments\")",
        )
    };
    out.push(json!({
        "type": "item",
        "id": format!("recent:{kind}:clear"),
        "label": labels.label(raw_label),
        "clickCode": code,
        "enabled": !entries.is_empty(),
    }));
    out
}

fn dump_items(app: &AppHandle, items: &[SpecItem], labels: &MenuLabels) -> Vec<Value> {
    let mut out = Vec::new();
    for item in items {
        if item.kind.as_deref() == Some("separator") {
            out.push(json!({ "type": "sep" }));
            continue;
        }
        if let Some(dynamic) = item.dynamic.as_deref() {
            out.push(json!({
                "type": "sub",
                "label": label_of(item, labels),
                "items": dump_recents(app, dynamic, labels),
            }));
            continue;
        }
        if let Some(children) = item.submenu.as_ref() {
            let mut node = json!({
                "type": "sub",
                "label": label_of(item, labels),
                "items": dump_items(app, children, labels),
            });
            if let Some(enabled) = item.enabled {
                node["enabled"] = json!(enabled);
            }
            out.push(node);
            continue;
        }
        if let Some(role) = item.role.as_deref() {
            // macOS 专属角色在 Windows 自定义菜单栏里没有对应物，直接跳过。
            if matches!(
                role,
                "services" | "hide" | "hideOthers" | "unhide" | "quit" | "front" | "window"
            ) {
                continue;
            }
            let mut node = json!({ "type": "role", "role": role, "label": label_of(item, labels) });
            if let Some(accel) = item.accelerator.as_deref() {
                node["accel"] = json!(normalize_accelerator(accel));
            }
            out.push(node);
            continue;
        }
        let label = label_of(item, labels);
        let id = item.id.clone().unwrap_or_else(|| format!("menu:{label}"));
        let click_code = item
            .click_code
            .clone()
            .filter(|code| !code.is_empty())
            .or_else(|| {
                app.try_state::<AppState>()
                    .and_then(|state| state.menu_command(&id))
            });
        let is_check = item.kind.as_deref() == Some("checkbox");
        let mut node = json!({
            "type": if is_check { "check" } else { "item" },
            "id": id,
            "label": label,
            "enabled": item.enabled.unwrap_or(true),
        });
        if is_check {
            node["checked"] = json!(item.checked.unwrap_or(false));
        }
        if let Some(accel) = item.accelerator.as_deref() {
            node["accel"] = json!(normalize_accelerator(accel));
        }
        if let Some(code) = click_code {
            node["clickCode"] = json!(code);
        }
        out.push(node);
    }
    out
}

/// `menu.dump`：Windows 自定义标题栏用的菜单树 JSON。
pub fn dump(app: &AppHandle) -> Result<Value, String> {
    let spec: Vec<SpecItem> =
        serde_json::from_str(MENU_SPEC).map_err(|err| err.to_string())?;
    let labels = MenuLabels::load(app);
    let mut out = Vec::new();
    for node in &spec {
        let is_app_menu = node.label.as_deref() == Some("ArborMark");
        if is_app_menu && !is_macos() {
            continue;
        }
        let label = label_of(node, &labels);
        let mut items = dump_items(app, node.submenu.as_deref().unwrap_or(&[]), &labels);
        // “主题”顶层菜单：优先用渲染层推送的注册表（含用户主题），与原生
        // rebuild_themes_menu 的结果保持一致。
        if label == "主题" || label == "Themes" {
            let cache = THEMES_CACHE.lock().ok().and_then(|guard| guard.clone());
            if let Some(cache) = cache {
                let current = cache
                    .get("current")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase();
                let rebuilt: Vec<Value> = cache
                    .get("themes")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|theme| {
                        let id = theme.get("id").and_then(Value::as_str)?;
                        let name = theme.get("label").and_then(Value::as_str).unwrap_or(id);
                        Some(json!({
                            "type": "check",
                            "id": format!("Themes→{id}"),
                            "label": name,
                            "enabled": true,
                            "checked": id.to_lowercase() == current,
                            "clickCode": format!(
                                "window.ClientCommand && window.ClientCommand.setTheme && window.ClientCommand.setTheme(\"{id}.css\", \"{id}\")"
                            ),
                        }))
                    })
                    .collect();
                if !rebuilt.is_empty() {
                    let mut rebuilt = rebuilt;
                    rebuilt.push(json!({ "type": "sep" }));
                    rebuilt.push(json!({
                        "type": "item",
                        "id": "Themes→Open Folder",
                        "label": labels.label("打开主题文件夹…"),
                        "enabled": true,
                        "clickCode": "window.ClientCommand && window.ClientCommand.openThemesFolder && window.ClientCommand.openThemesFolder()",
                    }));
                    items = rebuilt;
                }
            }
        }
        out.push(json!({ "label": label, "items": items }));
    }
    Ok(Value::Array(out))
}


// ---------------------------------------------------------------------------
// 渲染层驱动的弹出菜单
//
// 渲染层通过 `menu.popup` 传入 Electron 风格的模板：
//   { label, type: "normal"|"separator"|"radio"|"checkbox", enabled, checked,
//     clickCode, submenu: [...] }
// 旧主进程会把 clickCode 还原成 click 函数；这里改为菜单点击后在该窗口
// 执行同一段代码，语义一致且不需要把结果回传给渲染层。
// ---------------------------------------------------------------------------

use tauri::menu::Submenu;
use tauri::WebviewWindow;

fn append_template<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    target: &Menu<R>,
    items: &[Value],
    counter: &mut usize,
) -> tauri::Result<()> {
    use crate::state::AppState;

    for item in items {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("normal");
        if kind == "separator" {
            target.append(&PredefinedMenuItem::separator(app)?)?;
            continue;
        }

        let label = item.get("label").and_then(Value::as_str).unwrap_or("");
        let enabled = item.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        let checked = item.get("checked").and_then(Value::as_bool).unwrap_or(false);

        if let Some(children) = item.get("submenu").and_then(Value::as_array) {
            let submenu = Submenu::new(app, label, enabled)?;
            append_template_into(app, window, &submenu, children, counter)?;
            target.append(&submenu)?;
            continue;
        }

        *counter += 1;
        let id = format!("popup-{counter}");

        let click_code = item.get("clickCode").and_then(Value::as_str).unwrap_or("");
        if !click_code.is_empty() {
            if let Some(state) = app.try_state::<AppState>() {
                state.set_menu_action(&id, window.label(), click_code);
            }
        }

        if kind == "radio" || kind == "checkbox" {
            let entry = CheckMenuItemBuilder::with_id(id, label)
                .checked(checked)
                .enabled(enabled)
                .build(app)?;
            target.append(&entry)?;
        } else {
            let entry = MenuItemBuilder::with_id(id, label).enabled(enabled).build(app)?;
            target.append(&entry)?;
        }
    }
    Ok(())
}

fn append_template_into<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    target: &Submenu<R>,
    items: &[Value],
    counter: &mut usize,
) -> tauri::Result<()> {
    use crate::state::AppState;

    for item in items {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("normal");
        if kind == "separator" {
            target.append(&PredefinedMenuItem::separator(app)?)?;
            continue;
        }

        let label = item.get("label").and_then(Value::as_str).unwrap_or("");
        let enabled = item.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        let checked = item.get("checked").and_then(Value::as_bool).unwrap_or(false);

        if let Some(children) = item.get("submenu").and_then(Value::as_array) {
            let submenu = Submenu::new(app, label, enabled)?;
            append_template_into(app, window, &submenu, children, counter)?;
            target.append(&submenu)?;
            continue;
        }

        *counter += 1;
        let id = format!("popup-{counter}");
        let click_code = item.get("clickCode").and_then(Value::as_str).unwrap_or("");
        if !click_code.is_empty() {
            if let Some(state) = app.try_state::<AppState>() {
                state.set_menu_action(&id, window.label(), click_code);
            }
        }

        if kind == "radio" || kind == "checkbox" {
            let entry = CheckMenuItemBuilder::with_id(id, label)
                .checked(checked)
                .enabled(enabled)
                .build(app)?;
            target.append(&entry)?;
        } else {
            let entry = MenuItemBuilder::with_id(id, label).enabled(enabled).build(app)?;
            target.append(&entry)?;
        }
    }
    Ok(())
}

/// `menu.popup({ template })`：按模板弹出原生菜单。
pub fn popup(app: &AppHandle, window: &WebviewWindow, payload: &Value) -> Result<Value, String> {
    let Some(items) = payload.get("template").and_then(Value::as_array) else {
        return Ok(Value::Null);
    };

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        state.clear_menu_actions();
    }

    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    let mut counter = 0usize;
    append_template(app, window, &menu, items, &mut counter).map_err(|e| e.to_string())?;

    window.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

#[cfg(test)]
mod label_tests {
    use super::*;
    use std::collections::HashMap;

    fn dict() -> HashMap<String, String> {
        [
            ("File", "File"),
            ("Preferences", "Preferences"),
            ("Check Updates", "Check Updates"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    fn reverse() -> HashMap<String, String> {
        [
            ("文件", "File"),
            ("偏好设置", "Preferences"),
            ("偏好设置…", "Preferences"),
            ("检查更新", "Check Updates"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    #[test]
    fn simplified_chinese_keeps_spec_labels() {
        assert_eq!(
            translate_label("zh-Hans", "偏好设置…", &dict(), &reverse()),
            "偏好设置…"
        );
    }

    #[test]
    fn english_translates_spec_labels_and_keeps_ellipsis() {
        assert_eq!(
            translate_label("Base", "文件", &dict(), &reverse()),
            "File"
        );
        assert_eq!(
            translate_label("Base", "偏好设置…", &dict(), &reverse()),
            "Preferences…"
        );
        // 没有词典条目时退回英文 key，而不是留下中文。
        assert_eq!(
            translate_label("Base", "检查更新", &dict(), &reverse()),
            "Check Updates"
        );
    }

    #[test]
    fn other_locales_fall_back_to_english_key() {
        let mut reversed = reverse();
        reversed.insert("关于".into(), "About".into());
        let mut translations = dict();
        translations.insert("About".into(), "Über".into());
        assert_eq!(
            translate_label("de-DE", "关于", &translations, &reversed),
            "Über"
        );
    }
}

#[cfg(test)]
mod accelerator_tests {
    use super::*;

    #[test]
    fn keeps_macos_modifiers_off_windows() {
        if !cfg!(target_os = "windows") {
            assert_eq!(normalize_accelerator("CmdOrCtrl+Shift+F"), "CmdOrCtrl+Shift+F");
            assert_eq!(normalize_accelerator("Command+K"), "Command+K");
        }
    }

    #[test]
    fn maps_apple_modifiers_to_ctrl_on_windows() {
        if cfg!(target_os = "windows") {
            assert_eq!(normalize_accelerator("CmdOrCtrl+Shift+F"), "Ctrl+Shift+F");
            assert_eq!(normalize_accelerator("Command+K"), "Ctrl+K");
            assert_eq!(normalize_accelerator("Cmd+Z"), "Ctrl+Z");
        }
    }

    #[test]
    fn replaces_longest_prefix_first() {
        // "CommandOrControl" 必须先于 "Command" 替换，否则会变成 "CtrlOrControl"
        if cfg!(target_os = "windows") {
            assert_eq!(normalize_accelerator("CommandOrControl+P"), "Ctrl+P");
        }
    }

    #[test]
    fn no_apple_modifier_survives_in_menu_spec() {
        // muda 在 Windows 上会把 Cmd/Command 解析成 META 并让整棵菜单构建失败
        fn collect(items: &[SpecItem], out: &mut Vec<String>) {
            for item in items {
                if let Some(accel) = item.accelerator.as_deref() {
                    out.push(accel.to_string());
                }
                if let Some(children) = item.submenu.as_deref() {
                    collect(children, out);
                }
            }
        }

        let spec: serde_json::Value = serde_json::from_str(MENU_SPEC).expect("menu-spec.json 应可解析");
        let items: Vec<SpecItem> = serde_json::from_value(spec).expect("符合 SpecItem 结构");
        let mut accelerators = Vec::new();
        collect(&items, &mut accelerators);
        assert!(!accelerators.is_empty(), "菜单里应该存在加速键");

        if cfg!(target_os = "windows") {
            let offenders: Vec<_> = accelerators
                .iter()
                .map(|accel| normalize_accelerator(accel))
                .filter(|accel| accel.contains("Cmd") || accel.contains("Command"))
                .collect();
            assert!(offenders.is_empty(), "Windows 上仍有 Apple 修饰键: {offenders:?}");
        }
    }
}

// ---------------------------------------------------------------------------
// contextMenu.*：mac 原生右键菜单构建通道（callSync，返回值被忽略）。
// Tauri 的右键菜单由渲染层驱动（menu.popup + clickCode eval），这两个通道
// 在 mac-only 路径里为原生菜单供数；Tauri 下保留空实现防回调链断掉。
// ---------------------------------------------------------------------------

/// `contextMenu.setItems`：把当前上下文可用的菜单项交给原生菜单。
pub fn context_set_items() -> Result<Value, String> {
    Ok(Value::Null)
}

/// `contextMenu.setActiveStyles`：同步当前激活的行内样式（粗体/斜体等勾选态）。
pub fn context_set_active_styles() -> Result<Value, String> {
    Ok(Value::Null)
}
