//! 语言解析：等价旧主进程的 `config/locale-manager.js`。
//!
//! 渲染层把偏好设置里的 `userLanguage` 原样存下来（空串表示跟随系统），
//! 窗口启动时需要把它解析成 `locales/<name>.lproj` 目录名：
//!   * `Base` 是英文（不是 "en-US"）；
//!   * `zh-Hans` / `zh-Hant` 分别对应简繁；
//!   * 其余语言按 `SUPPORTED_LOCALES` 精确/前缀匹配；
//!   * 空值时读系统语言，最后回退到 `zh-Hans`（与旧版默认一致）。

use std::sync::OnceLock;

pub const SUPPORTED_LOCALES: &[&str] = &[
    "ar-SA", "Base", "ca-ES", "cs-CZ", "da-DK", "de-CH", "de-DE", "el-GR", "es-ES", "fa-IR",
    "fr-FR", "ga-IE", "gl-ES", "he-IL", "hi-IN", "hr-HR", "hu-HU", "id-ID", "it-IT", "ja-JP",
    "ko-KR", "ms-MY", "nb-NO", "nl-NL", "nn-NO", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU",
    "sk-SK", "sl-SI", "sv-SE", "th-TH", "tr-TR", "uk-UA", "vi-VN", "zh-Hans", "zh-Hant",
];

/// 解析 `userLanguage`（可能为空）为本地化目录名。
pub fn resolve_app_locale(user_language: Option<&str>) -> String {
    resolve_with(user_language, &system_locale())
}

/// 纯函数版本，便于测试（不读取环境变量）。
pub fn resolve_with(user_language: Option<&str>, system_locale: &str) -> String {
    if let Some(raw) = user_language {
        let raw = raw.trim();
        if raw.eq_ignore_ascii_case("Base")
            || raw.eq_ignore_ascii_case("en")
            || raw.eq_ignore_ascii_case("en-US")
            || raw.eq_ignore_ascii_case("en-GB")
        {
            return "Base".into();
        }
        if raw.len() > 3
            && raw[..2].eq_ignore_ascii_case("zh")
            && raw.as_bytes().get(2) == Some(&b'-')
        {
            let rest = raw[3..].to_ascii_lowercase();
            if rest.starts_with("tw") || rest.starts_with("hk") || rest.starts_with("mo") {
                return "zh-Hant".into();
            }
            if rest.starts_with("cn") || rest.starts_with("sg") {
                return "zh-Hans".into();
            }
        }
        if raw.eq_ignore_ascii_case("zh") {
            return "zh-Hans".into();
        }
        if !raw.is_empty() && !raw.eq_ignore_ascii_case("system") {
            if let Some(matched) = match_supported(raw) {
                return matched;
            }
        }
    }

    let sys = system_locale.trim();
    if sys.starts_with("zh-TW") || sys.starts_with("zh-HK") || sys.starts_with("zh-MO") {
        return "zh-Hant".into();
    }
    if sys.starts_with("zh") {
        return "zh-Hans".into();
    }
    if sys.starts_with("en") {
        return "Base".into();
    }
    if !sys.is_empty() {
        if let Some(matched) = match_supported(sys) {
            return matched;
        }
    }

    "zh-Hans".into()
}

fn match_supported(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    if let Some(found) = SUPPORTED_LOCALES
        .iter()
        .find(|locale| locale.eq_ignore_ascii_case(raw))
    {
        return Some((*found).to_string());
    }
    if let Some(found) = SUPPORTED_LOCALES
        .iter()
        .find(|locale| locale.to_ascii_lowercase().starts_with(&(lower.clone() + "-")))
    {
        return Some((*found).to_string());
    }
    // 反向前缀：系统给出 "zh-Hans-CN" 时匹配 "zh-Hans"。
    if let Some(found) = SUPPORTED_LOCALES.iter().find(|locale| {
        lower.starts_with(&(locale.to_ascii_lowercase() + "-"))
    }) {
        return Some((*found).to_string());
    }
    None
}

/// 渲染层 `_options.appLocale` 的取值：`Base` 换成 `en-US`，其余原样。
pub fn app_locale(locale: &str) -> String {
    if locale == "Base" {
        "en-US".into()
    } else {
        locale.into()
    }
}

/// 系统语言（只读一次）。macOS 的 GUI 进程经常没有 LANG，退回 `defaults`。
pub fn system_locale() -> String {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE.get_or_init(detect_system_locale).clone()
}

fn detect_system_locale() -> String {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() {
                return clean_locale(value);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("defaults")
            .args(["read", "-g", "AppleLocale"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !text.is_empty() {
                    return clean_locale(&text);
                }
            }
        }
    }

    String::new()
}

fn clean_locale(raw: &str) -> String {
    let mut value = raw.trim().replace('_', "-");
    if let Some(index) = value.find('@') {
        value.truncate(index);
    }
    if let Some(index) = value.find('.') {
        value.truncate(index);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_choices_map_to_locale_directories() {
        assert_eq!(resolve_with(Some("Base"), ""), "Base");
        assert_eq!(resolve_with(Some("en-US"), ""), "Base");
        assert_eq!(resolve_with(Some("zh-Hans"), ""), "zh-Hans");
        assert_eq!(resolve_with(Some("zh-TW"), ""), "zh-Hant");
        assert_eq!(resolve_with(Some("ja"), ""), "ja-JP");
        assert_eq!(resolve_with(Some("ja-JP"), ""), "ja-JP");
        assert_eq!(resolve_with(Some("de-de"), ""), "de-DE");
    }

    #[test]
    fn empty_or_system_uses_os_locale() {
        assert_eq!(resolve_with(Some(""), "zh-TW"), "zh-Hant");
        assert_eq!(resolve_with(Some("system"), "en-US"), "Base");
        assert_eq!(resolve_with(None, "ja-JP"), "ja-JP");
        assert_eq!(resolve_with(Some(""), "fr-FR"), "fr-FR");
        assert_eq!(resolve_with(Some(""), "zh-Hans-CN"), "zh-Hans");
    }

    #[test]
    fn unknown_system_falls_back_to_simplified_chinese() {
        assert_eq!(resolve_with(Some(""), "xx-YY"), "zh-Hans");
        assert_eq!(resolve_with(None, ""), "zh-Hans");
    }

    #[test]
    fn app_locale_alias() {
        assert_eq!(app_locale("Base"), "en-US");
        assert_eq!(app_locale("zh-Hant"), "zh-Hant");
    }

    #[test]
    fn cleans_macos_locale_suffixes() {
        assert_eq!(clean_locale("en_US.UTF-8"), "en-US");
        assert_eq!(clean_locale("zh-Hans_CN@calendar=gregorian"), "zh-Hans-CN");
    }
}
