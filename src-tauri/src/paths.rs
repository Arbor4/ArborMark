//! 路径归一化。
//!
//! 渲染层的路径来源很杂：Rust 返回的原生路径、`mountFolder + "/" + 相对路径`
//! 拼出来的混合路径（`C:\a\b/c.md`）、拖拽/命令行给的路径、以及历史会话里存下来的旧值。
//!
//! `std::fs` 在 Windows 上会做 Win32 归一化，正斜杠也能用；但 **shell32**
//! （`SHObjectProperties`、`explorer /select`、`ShellExecute`）和字符串比较不吃这一套，
//! 混着写就会「文件明明在，属性框却打不开」。所有 IPC 入口统一在这里转成原生写法。

/// `scheme://` 形态的 URL 原样返回——把 `file:///C:/a` 转成 `file:\\\C:\a` 只会更糟。
fn looks_like_url(text: &str) -> bool {
    let Some(index) = text.find("://") else {
        return false;
    };
    // 盘符（`C://a`）也会命中 `://`，scheme 至少两个字符才当 URL。
    if index < 2 {
        return false;
    }
    text[..index]
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
}

/// 把任意来源的路径统一成当前平台的原生写法。
///
/// - Windows：`/` → `\`，合并重复分隔符，去掉结尾分隔符（盘符根 `C:\` 保留）
/// - macOS / Linux：原样返回（反斜杠在 POSIX 上是合法文件名字符，不能动）
pub fn native(input: &str) -> String {
    if input.is_empty() || looks_like_url(input) {
        return input.to_string();
    }

    #[cfg(windows)]
    {
        win_native(input)
    }
    #[cfg(not(windows))]
    {
        input.to_string()
    }
}

#[cfg(windows)]
fn win_native(input: &str) -> String {
    let replaced = input.replace('/', "\\");

    // `\\?\`（verbatim）和 `\\server`（UNC）的起始双斜杠必须保留，其余位置合并。
    let (prefix, rest) = if let Some(rest) = replaced.strip_prefix(r"\\?\") {
        (r"\\?\".to_string(), rest.to_string())
    } else if let Some(rest) = replaced.strip_prefix(r"\\") {
        (r"\\".to_string(), rest.to_string())
    } else {
        (String::new(), replaced)
    };

    let mut collapsed = String::with_capacity(rest.len());
    let mut previous_was_sep = false;
    for ch in rest.chars() {
        if ch == '\\' {
            if !previous_was_sep {
                collapsed.push(ch);
            }
            previous_was_sep = true;
        } else {
            collapsed.push(ch);
            previous_was_sep = false;
        }
    }

    let combined = format!("{prefix}{collapsed}");
    if combined.len() > 1 && combined.ends_with('\\') && !combined.ends_with(":\\") {
        combined[..combined.len() - 1].to_string()
    } else {
        combined
    }
}

/// 用于比较的规范形式：原生分隔符 + Windows 下转小写。
pub fn for_compare(input: &str) -> String {
    let normalized = native(input);
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn converts_forward_slashes() {
        assert_eq!(native(r"C:\a\b/c.md"), r"C:\a\b\c.md");
        assert_eq!(native("C:/a/b/c.md"), r"C:\a\b\c.md");
        assert_eq!(native(r"C:\Users\Arbor\Desktop\typore rea\test/55555.md"), r"C:\Users\Arbor\Desktop\typore rea\test\55555.md");
    }

    #[cfg(windows)]
    #[test]
    fn collapses_duplicate_separators() {
        assert_eq!(native(r"C:\\a\\\b"), r"C:\a\b");
        assert_eq!(native("C://a//b"), r"C:\a\b");
    }

    #[cfg(windows)]
    #[test]
    fn keeps_roots_and_unc() {
        assert_eq!(native(r"C:\"), r"C:\");
        assert_eq!(native("C:/"), r"C:\");
        assert_eq!(native(r"\\server\share\x"), r"\\server\share\x");
        assert_eq!(native(r"\\server\share\"), r"\\server\share");
    }

    #[cfg(windows)]
    #[test]
    fn trims_trailing_separator() {
        assert_eq!(native(r"C:\a\b\"), r"C:\a\b");
        assert_eq!(native(r"C:\a\b/"), r"C:\a\b");
    }

    #[test]
    fn keeps_urls_untouched() {
        assert_eq!(native("file:///C:/a/b.md"), "file:///C:/a/b.md");
        assert_eq!(native("https://example.com/a"), "https://example.com/a");
    }

    #[test]
    fn compares_case_insensitively_on_windows() {
        // 同一路径的大小写差异 + 分隔符差异，Windows 上应判等。
        let same = for_compare(r"C:\A\B") == for_compare("c:/a/b");
        if cfg!(windows) {
            assert!(same);
        } else {
            assert!(!same);
        }
    }
}
