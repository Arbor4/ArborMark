//! 设置读写：等价旧版 `setting.put` / `setting.loadAll`。

use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};

use crate::state::AppState;

/// 把旧渲染层的多种 `setting.put` 调用形态归一成 `(key, value)` 列表：
///
/// * `[key, value]`：preload 会把 `invoke(channel, a, b)` 的多参数打包成数组；
/// * `{ key, val }` / `{ key, value }`：bridge.putSetting / macBridge 形态；
/// * `{ k1: v1, k2: v2 }`：旧版支持一次写多个设置。
fn setting_entries(payload: &Value) -> Vec<(String, Value)> {
    match payload {
        Value::Array(items) => {
            if items.len() >= 2 {
                if let Some(key) = items[0].as_str() {
                    let value = items[1..]
                        .iter()
                        .find(|value| !value.is_null())
                        .cloned()
                        .unwrap_or(Value::Null);
                    return vec![(key.to_string(), value)];
                }
            }
            items
                .first()
                .map(setting_entries)
                .unwrap_or_default()
        }
        Value::Object(map) => {
            if let Some(key) = map.get("key").and_then(Value::as_str) {
                let value = map
                    .get("val")
                    .or_else(|| map.get("value"))
                    .cloned()
                    .unwrap_or(Value::Null);
                return vec![(key.to_string(), value)];
            }
            map.iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        }
        Value::String(key) => vec![(key.clone(), Value::Null)],
        _ => Vec::new(),
    }
}

/// 从单值 / 数组 / 对象里取第一个字符串参数。
/// 旧渲染层常用 `invoke("setting.setCurTheme", themeCss, themeName)`，
/// preload 会把两个参数打包成数组，这里两种形态都要吃。
fn first_string_arg(payload: &Value, keys: &[&str]) -> Option<String> {
    match payload {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => items
            .iter()
            .find_map(|item| item.as_str().map(str::to_string))
            .or_else(|| items.iter().find_map(|item| first_string_arg(item, keys))),
        Value::Object(map) => keys
            .iter()
            .find_map(|key| map.get(*key).and_then(Value::as_str).map(str::to_string))
            .or_else(|| {
                map.values()
                    .find_map(|value| value.as_str().map(str::to_string))
            }),
        _ => None,
    }
}

/// 语言键统一落成 `userLanguage`（旧版 `userLocale` / `locale` 都是它的别名）。
fn normalized_language_value(value: &Value) -> Value {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() || text.eq_ignore_ascii_case("auto") || text.eq_ignore_ascii_case("system") {
                json!("")
            } else {
                json!(text)
            }
        }
        Value::Null => json!(""),
        other => other.clone(),
    }
}

pub fn put(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let mut changed_language = false;
    let mut changed_theme = false;
    let mut applied: Vec<Value> = Vec::new();

    for (key, val) in setting_entries(payload) {
        if key.is_empty() {
            continue;
        }
        let normalized_key = if key == "userLocale" || key == "locale" {
            "userLanguage"
        } else {
            key.as_str()
        };
        let val = if normalized_key == "userLanguage" {
            normalized_language_value(&val)
        } else {
            val
        };
        let prev_val = state.get(normalized_key);
        if prev_val == val {
            if normalized_key != key.as_str() && state.get(&key) != Value::Null {
                state.put(&key, Value::Null);
            }
            continue;
        }
        if normalized_key == "userLanguage" {
            changed_language = true;
        }
        if normalized_key == "userLanguage" {
            let lang_str = val.as_str().unwrap_or("");
            let resolved_locale = crate::locale::resolve_app_locale(Some(lang_str));
            let app_locale = crate::locale::app_locale(&resolved_locale);
            state.put("userLocale", json!(&resolved_locale));
            state.put("locale", json!(&resolved_locale));
            state.put("appLocale", json!(&app_locale));
            applied.push(json!(["userLocale", resolved_locale]));
            applied.push(json!(["locale", resolved_locale]));
            applied.push(json!(["appLocale", app_locale]));
        }
        if normalized_key == "curTheme" || normalized_key == "theme" || normalized_key == "darkTheme" {
            changed_theme = true;
        }
        log::debug!("[setting] put {} = {}", normalized_key, val);
        applied.push(json!([normalized_key, val.clone()]));
        state.put(normalized_key, val);

        // 渲染层收到 userLocale/locale 时可能同时写多个别名，避免留下旧键。
        if normalized_key != key.as_str() {
            state.put(&key, Value::Null);
        }
    }

    if !applied.is_empty() {
        // 旧版由主进程 execForAll 把新值同步进所有窗口的 _options / File.option；
        // bootstrap 监听这个事件，让偏好设置修改立即生效（重启后仍由 boot options 恢复）。
        let _ = app.emit("arbor-setting-changed", json!(applied));
    }
    if changed_theme {
        crate::menu::sync_theme_checks(app);
    }
    if changed_language {
        // 语言变化后菜单文案需要立即跟上（界面本身由渲染层提示重启）。
        if let Err(err) = crate::menu::refresh(app) {
            log::warn!("[setting] 语言变化后重建菜单失败: {err}");
        }
    }

    Ok(json!(true))
}

pub fn get(state: &State<'_, AppState>, payload: &Value) -> Result<Value, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .or_else(|| {
            payload
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str)
        })
        .unwrap_or("");

    if key == "userLocale" || key == "locale" {
        let user_language = state
            .get("userLanguage")
            .as_str()
            .unwrap_or("")
            .to_string();
        return Ok(json!(crate::locale::resolve_app_locale(Some(&user_language))));
    }
    if key == "userLanguage" {
        return Ok(json!(state
            .get("userLanguage")
            .as_str()
            .unwrap_or("")));
    }
    Ok(state.get(key))
}

/// `setting.loadAll`：与旧版返回结构对齐。
/// 旧实现返回 `{curTheme, themes, allThemes, isDarkMode, send_usage_info, ...settings}`，
/// 偏好设置面板依赖 `themes` / `allThemes` 渲染主题网格。
pub fn load_all(app: &tauri::AppHandle, state: &State<'_, AppState>) -> Result<Value, String> {
    let all_themes = available_themes();
    let base_names: Vec<String> = all_themes
        .iter()
        .map(|name| name.trim_end_matches(".css").to_string())
        .collect();

    // 路径 / 语言上下文打底，再铺全部持久化设置。
    let mut out = crate::windows::path_context(app)
        .as_object()
        .cloned()
        .unwrap_or_default();
    out.insert(
        "curTheme".into(),
        state
            .get("curTheme")
            .as_str()
            .filter(|value| !value.is_empty())
            .map(|value| json!(value))
            .unwrap_or_else(|| json!(crate::protocol::default_theme())),
    );
    out.insert("themes".into(), json!(base_names));
    out.insert("allThemes".into(), json!(all_themes));
    out.insert("isDarkMode".into(), json!(false));
    out.insert("send_usage_info".into(), json!(false));

    let user_language = state
        .get("userLanguage")
        .as_str()
        .unwrap_or("")
        .to_string();
    let locale = crate::locale::resolve_app_locale(Some(&user_language));
    out.insert("userLanguage".into(), json!(user_language));
    out.insert("userLocale".into(), json!(locale));
    out.insert("locale".into(), json!(locale));
    out.insert("appLocale".into(), json!(crate::locale::app_locale(&locale)));

    if let Some(settings) = state.all_settings().as_object() {
        for (key, value) in settings {
            // 早期多参数 IPC 丢值写进去的 null 不应覆盖上面的默认值；
            // userLocale/locale 必须用当前解析结果，不能被旧别名覆盖。
            if value.is_null() || key == "userLocale" || key == "locale" || key == "appLocale" {
                continue;
            }
            out.insert(key.clone(), value.clone());
        }
    }

    Ok(Value::Object(out))
}

/// 最近列表变化后重建原生菜单的"最近文件/目录"子菜单。
/// 旧 Electron 版在主进程 store 变化时重建应用菜单，Tauri 侧在这里补上。
fn refresh_recent_menu(app: &tauri::AppHandle) {
    // 列表内容没变就不用重建整棵树（启动时会连着来好几次）。
    if let Err(err) = crate::menu::refresh_recent(app) {
        log::warn!("[menu] 最近列表变化后重建菜单失败: {err}");
    }
}

/// `setting.updateRecentFile`：把路径记入最近列表（文件或目录自动判别）。
pub fn update_recent(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let target = payload
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .unwrap_or("");

    if target.is_empty() {
        return Ok(Value::Null);
    }

    let kind = if std::path::Path::new(target).is_dir() { "folder" } else { "file" };
    state.push_recent(kind, target, 20);
    // `pinned` 是置顶操作，不应改写"上次会话"。
    let pinned = payload.get("pinned").is_some();
    if !pinned {
        if kind == "folder" {
            state.set_last_session(None, Some(Some(target)));
        } else {
            state.set_last_session(Some(Some(target)), None);
        }
    }
    refresh_recent_menu(app);
    Ok(Value::Null)
}

/// `setting.removeRecentDocument` / `setting.removeRecentFolder`
pub fn remove_recent(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
    kind: &str,
) -> Result<Value, String> {
    let target = payload
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .unwrap_or("");
    if !target.is_empty() {
        state.remove_recent(kind, target);
        refresh_recent_menu(app);
    }
    Ok(Value::Null)
}

/// `setting.openThemeFolder`：在文件管理器里打开用户主题目录。
pub fn open_theme_folder() -> Result<Value, String> {
    let dir = crate::protocol::data_root().join("userData").join("themes");
    let _ = std::fs::create_dir_all(&dir);
    open::that(&dir).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

pub fn recents(state: &State<'_, AppState>) -> Result<Value, String> {
    Ok(state.recents())
}

/// 内置主题列表（与 web `theme/presets.ts` 的 BUILTIN_THEMES 对齐，共 5 个）。
const BUILTIN_THEMES: [&str; 5] = [
    "arbor.css",
    "github.css",
    "liquid-glass.css",
    "night.css",
    "newsprint.css",
];

/// 扫描内置主题目录与用户主题目录，返回可用主题文件名。
pub fn available_themes() -> Vec<String> {
    use std::collections::BTreeSet;

    let mut themes: BTreeSet<String> = BUILTIN_THEMES.iter().map(|s| s.to_string()).collect();

    // 仅保留用户在 userData/themes 中自行添加的自定义主题，内置主题以 BUILTIN_THEMES 为准
    let user_themes_dir = crate::protocol::data_root().join("userData").join("themes");
    if let Ok(entries) = std::fs::read_dir(&user_themes_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".css") && !name.ends_with(".user.css") && name != "current-theme.css" {
                themes.insert(name);
            }
        }
    }

    themes.into_iter().collect()
}

/// `setting.getThemes`：返回 `{ all, current }`，与旧主进程契约一致。
pub fn get_themes(state: &State<'_, AppState>) -> Result<Value, String> {
    let current = state
        .get("curTheme")
        .as_str()
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| crate::protocol::default_theme().to_string());

    Ok(json!({
        "all": available_themes(),
        "current": current,
    }))
}

/// `setting.setCurTheme`：写入 curTheme / theme 两个键。
/// 协议层在下一个 `current-theme.css` 请求时就会读到新值，无需重启。
pub fn set_cur_theme(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let theme = first_string_arg(payload, &["theme", "name", "css"])
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| crate::protocol::default_theme().to_string());

    let base = theme.trim_end_matches(".css").to_string();
    state.put("curTheme", json!(theme));
    state.put("theme", json!(base));
    let _ = app.emit(
        "arbor-setting-changed",
        json!([["curTheme", theme], ["theme", base]]),
    );
    crate::menu::sync_theme_checks(app);
    Ok(json!(true))
}

/// `app.loadOptions` / 旧版 `loadOptions`：返回路径上下文（**不是**设置项）。
pub fn app_options() -> Result<Value, String> {
    let root = crate::protocol::data_root();
    let themes = root.join("userData").join("themes");
    Ok(json!({
        "dirname": root.to_string_lossy(),
        "appPath": root.to_string_lossy(),
        "resourcesPath": root.to_string_lossy(),
        "currentThemeFolder": themes.to_string_lossy(),
    }))
}

/// `setting.getUserDict`：旧实现返回 JSON 字符串。
pub fn get_user_dict() -> Result<Value, String> {
    Ok(json!("{\"words\":[]}"))
}

/// `setting.getUserDictionaryPath`：用户词典固定放在 userData/dictionaries 下。
pub fn get_user_dictionary_path() -> Result<Value, String> {
    let dir = crate::protocol::data_root().join("userData").join("dictionaries");
    Ok(json!(dir.to_string_lossy()))
}

/// `setting.getUnsavedDraftsPath`：自动保存草稿目录。
pub fn get_unsaved_drafts_path() -> Result<Value, String> {
    let dir = crate::protocol::data_root().join("userData").join("drafts");
    let _ = std::fs::create_dir_all(&dir);
    Ok(json!(dir.to_string_lossy()))
}

/// `setting.resetAllDialogWarnings` / `resetAdvancedSettings`：清空相关设置键。
pub fn reset_plain(state: &State<'_, AppState>, keys: &[&str]) -> Result<Value, String> {
    for key in keys {
        state.put(key, Value::Null);
    }
    Ok(json!(true))
}

/// `setting.addRecentFolder`
pub fn add_recent_folder(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let folder = payload
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| payload.as_str())
        .unwrap_or("");
    if folder.is_empty() {
        return Ok(json!(false));
    }
    state.push_recent("folder", folder, 20);
    state.set_last_session(None, Some(Some(folder)));
    refresh_recent_menu(app);
    Ok(json!(true))
}

/// `setting.askForClearRecentDocuments`：清空最近文档（菜单刷新由渲染层负责）。
pub fn clear_recent_documents(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<Value, String> {
    state.clear_recent_documents();
    refresh_recent_menu(app);
    Ok(json!(true))
}

/// `setting.askForClearRecentLocations`：清空最近目录（保留最近文档）。
pub fn clear_recent_locations(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<Value, String> {
    state.clear_recent_locations();
    refresh_recent_menu(app);
    Ok(json!(true))
}

/// `theme.setThemeSource(dark|light|system)`：这是**配色方案提示**，不是主题文件名。
/// 早期把它当成主题写进 curTheme，导致主题被覆盖成不存在的 `system.css`。
///
/// 除了记状态，这里还要把 Windows 的原生标题栏 / 菜单栏一起切到对应明暗——
/// 它们由系统绘制，不会跟着页面 CSS 变。
pub fn set_theme_source(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
) -> Result<Value, String> {
    // 渲染层历史上用 { mode }，文档与部分调用点用 { source }，两者都接受。
    let source = first_string_arg(payload, &["source", "mode"])
        .unwrap_or_else(|| "system".to_string());
    let source = source.as_str();
    log::debug!("[theme] setThemeSource = {source}");
    state.put("themeSource", json!(source));
    let dark = match source {
        "dark" => true,
        "light" => false,
        // "system" 由渲染层解析后通常已经传 dark/light；真收到 system 就沿用当前状态。
        _ => state.get("isDarkMode").as_bool().unwrap_or(false),
    };
    state.put("isDarkMode", json!(dark));
    crate::theme::apply_to_all(app, dark);
    Ok(json!(true))
}

/// `theme.apply`：持久化主题名，下次协议请求即生效。
pub fn apply_theme(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    payload: &Value,
) -> Result<Value, String> {
    let theme = first_string_arg(payload, &["theme", "name"]).unwrap_or_default();

    if !theme.is_empty() {
        let with_ext = if theme.ends_with(".css") {
            theme.to_string()
        } else {
            format!("{theme}.css")
        };
        state.put("curTheme", json!(with_ext.clone()));
        state.put("theme", json!(with_ext.trim_end_matches(".css")));
        let _ = app.emit(
            "arbor-setting-changed",
            json!([
                ["curTheme", with_ext.clone()],
                ["theme", with_ext.trim_end_matches(".css")]
            ]),
        );
        crate::menu::sync_theme_checks(app);
    }
    Ok(json!(true))
}

// ---------------------------------------------------------------------------
// 旧主进程的常量桩（保持逐字节一致的返回值，渲染层会 JSON.parse 它们）
// ---------------------------------------------------------------------------

/// `setting.fetchAnalytics`：旧实现返回字符串 "{}"（table-sorter 会 JSON.parse）。
pub fn fetch_analytics() -> Result<Value, String> {
    Ok(json!("{}"))
}

/// `setting.getDownloadingDicts`：旧实现返回字符串 "[]"（spell-check 会 JSON.parse）。
pub fn get_downloading_dicts() -> Result<Value, String> {
    Ok(json!("[]"))
}

/// `setting.getKeyBinding`：旧实现返回字符串 "{}"（context-menu 的快捷键提示源）。
pub fn get_key_binding() -> Result<Value, String> {
    Ok(json!("{}"))
}

/// `setting.loadExports`：旧实现返回字符串 "[{},{}]"（mega-menu 解析 [标准, 自定义]）。
pub fn load_exports() -> Result<Value, String> {
    Ok(json!("[{},{}]"))
}

/// `setting.showAndHighlight`：旧实现向所有窗口广播 `File.megaMenu.highlight(key)`。
pub fn show_and_highlight(app: &tauri::AppHandle, payload: &Value) -> Result<Value, String> {
    let key = payload
        .as_str()
        .or_else(|| payload.get("key").and_then(Value::as_str))
        .unwrap_or("");
    let encoded = serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into());
    let script = format!("window.File?.megaMenu?.highlight?.({encoded});");
    for (_, window) in app.webview_windows() {
        let _ = window.eval(&script);
    }
    Ok(json!(true))
}

#[cfg(test)]
mod legacy_stub_tests {
    use super::*;

    #[test]
    fn legacy_stub_channels_return_json_strings() {
        // 旧主进程这些 handler 返回 JSON.stringify(...) 字符串，
        // 渲染层直接 JSON.parse —— 必须返回字符串而不是对象。
        assert_eq!(fetch_analytics().unwrap(), json!("{}"));
        assert_eq!(get_downloading_dicts().unwrap(), json!("[]"));
        assert_eq!(get_key_binding().unwrap(), json!("{}"));
        assert_eq!(load_exports().unwrap(), json!("[{},{}]"));
    }

    #[test]
    fn legacy_stubs_parse_back_to_expected_shapes() {
        // 渲染层消费方期望解析后的形态：对象 / 数组 / [标准导出, 自定义导出]。
        let analytics: Value = serde_json::from_str(fetch_analytics().unwrap().as_str().unwrap()).unwrap();
        assert!(analytics.is_object());
        let dicts: Value =
            serde_json::from_str(get_downloading_dicts().unwrap().as_str().unwrap()).unwrap();
        assert!(dicts.as_array().unwrap().is_empty());
        let exports: Value = serde_json::from_str(load_exports().unwrap().as_str().unwrap()).unwrap();
        let pair = exports.as_array().unwrap();
        assert_eq!(pair.len(), 2);
        assert!(pair[0].is_object() && pair[1].is_object());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_legacy_two_argument_shape() {
        // preload 把 `invoke("setting.put", key, value)` 打包成数组。
        let entries = setting_entries(&json!(["sidebar-width", 280]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "sidebar-width");
        assert_eq!(entries[0].1, json!(280));
    }

    #[test]
    fn accepts_object_and_multi_key_shapes() {
        let from_val = setting_entries(&json!({ "key": "showSidebar", "val": true }));
        assert_eq!(from_val[0], ("showSidebar".to_string(), json!(true)));

        let from_value = setting_entries(&json!({ "key": "useTreeStyle", "value": false }));
        assert_eq!(from_value[0], ("useTreeStyle".to_string(), json!(false)));

        let map = setting_entries(&json!({ "a": 1, "b": "x" }));
        assert_eq!(map.len(), 2);
        assert!(map.contains(&("a".to_string(), json!(1))));
        assert!(map.contains(&("b".to_string(), json!("x"))));
    }

    #[test]
    fn language_aliases_normalize_to_empty_string_for_auto() {
        assert_eq!(normalized_language_value(&json!("")), json!(""));
        assert_eq!(normalized_language_value(&json!("auto")), json!(""));
        assert_eq!(normalized_language_value(&json!("system")), json!(""));
        assert_eq!(normalized_language_value(&json!("Base")), json!("Base"));
        assert_eq!(normalized_language_value(&Value::Null), json!(""));
    }

    #[test]
    fn theme_argument_accepts_array_and_object() {
        assert_eq!(
            first_string_arg(&json!(["night.css", "night"]), &["theme"]).as_deref(),
            Some("night.css")
        );
        assert_eq!(
            first_string_arg(&json!({ "theme": "github.css" }), &["theme"]).as_deref(),
            Some("github.css")
        );
    }
}

// ---------------------------------------------------------------------------
// 拼写字典 / 草稿 / 焦点模式（旧 rebuild 版未实现，本轮按语义补齐）
// ---------------------------------------------------------------------------

/// `setting.downloadDict(localeCode)`：下载 hunspell 字典（.dic/.aff）到词典目录。
///
/// 渲染层（spell-check.js）在调用前把进度条置 0，随后监听
/// `dict-loaded` / `dict-download-err` 事件（经 arbor-event 广播）。
/// 用系统 curl 下载 LibreOffice dictionaries 仓库的公开字典文件，不引新依赖。
pub fn download_dict(app: &tauri::AppHandle, payload: &Value) -> Result<Value, String> {
    let locale = payload
        .as_str()
        .or_else(|| payload.get("locale").and_then(Value::as_str))
        .unwrap_or("")
        .trim()
        .to_string();
    if locale.is_empty() {
        return Ok(json!(false));
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        let dir = crate::protocol::data_root()
            .join("userData")
            .join("dictionaries");
        if std::fs::create_dir_all(&dir).is_err() {
            let _ = handle.emit(
                "arbor-event",
                json!({ "channel": "dict-download-err", "payload": locale }),
            );
            return;
        }
        let base = format!("https://raw.githubusercontent.com/LibreOffice/dictionaries/master/{locale}/{locale}");
        let mut ok = true;
        for ext in [".dic", ".aff"] {
            let dest = dir.join(format!("{locale}{ext}"));
            let output = super::misc::make_curl_command(120)
                .args(["-sL", "-o"])
                .arg(&dest)
                .arg(format!("{base}{ext}"))
                .output();
            let downloaded = output
                .map(|o| o.status.success() && dest.exists())
                .unwrap_or(false);
            if !downloaded {
                ok = false;
                break;
            }
        }
        if ok {
            let dict_path = dir.to_string_lossy().to_string();
            let _ = handle.emit(
                "arbor-event",
                json!({ "channel": "dict-loaded", "payload": dict_path }),
            );
        } else {
            let _ = handle.emit(
                "arbor-event",
                json!({ "channel": "dict-download-err", "payload": locale }),
            );
        }
    });
    Ok(json!(true))
}

/// `setting.openUnsavedDraft`：打开草稿目录里最近修改的一份草稿。
pub fn open_unsaved_draft(app: &tauri::AppHandle, state: &State<'_, AppState>) -> Result<Value, String> {
    let drafts = crate::protocol::data_root().join("userData").join("drafts");
    let latest = std::fs::read_dir(&drafts)
        .ok()
        .and_then(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.path())
                .max_by_key(|p| {
                    p.metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                })
        });
    match latest {
        Some(path) => {
            let payload = json!({ "filePath": path.to_string_lossy() });
            crate::ipc::document::open_file(app, state, &payload)
        }
        None => {
            log::info!("[setting] 没有未保存草稿");
            Ok(json!(false))
        }
    }
}

/// `setting.exitFocusAndTypewriterMode`：向主窗口广播退出焦点/打字机模式。
///
/// 偏好设置页已在本地执行同样脚本；此通道负责让**主窗口**同步退出
/// （与旧版 execForAll 语义一致）。
pub fn exit_focus_and_typewriter_mode(app: &tauri::AppHandle) -> Result<Value, String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let script = "(function(){ if(window.File){ File.isFocusMode=false; File.isTypeWriterMode=false; if(File.editor){ if(File.editor.updateFocusMode) File.editor.updateFocusMode(false); if(File.editor.setTypeWriterMode) File.editor.setTypeWriterMode(false, true); } } document.body.classList.remove('ty-show-notification'); })()";
        let _ = window.eval(script);
    }
    Ok(json!(true))
}
