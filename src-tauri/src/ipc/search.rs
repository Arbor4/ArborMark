//! 全局搜索：按文件名 + 文件内容扫描当前工作区。
//!
//! 结果由渲染层的居中搜索框消费，按目录分组显示。只扫描文本文件，
//! 跳过隐藏目录与构建产物，限制单文件大小/匹配数，避免大仓库卡死。

use regex::{Regex, RegexBuilder};
use serde_json::{json, Value};
use std::path::Path;

const MAX_DEPTH: usize = 14;
const MAX_FILES_SCANNED: usize = 6000;
const MAX_RESULT_FILES: usize = 300;
const MAX_MATCHES_PER_FILE: usize = 8;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const SKIP_DIRS: [&str; 7] = ["node_modules", ".git", ".svn", "dist", "target", "build", ".idea"];

fn should_skip(name: &str, show_hidden: bool) -> bool {
    if name.starts_with('.') {
        return !show_hidden;
    }
    SKIP_DIRS.contains(&name)
}

fn build_regex(query: &str, case_sensitive: bool, whole_word: bool, use_regexp: bool) -> Result<Regex, String> {
    let mut pattern = if use_regexp {
        query.to_string()
    } else {
        regex::escape(query)
    };
    if whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|err| format!("正则表达式无效: {err}"))
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn relative_dir(root: &Path, path: &Path) -> String {
    let parent = path.parent().unwrap_or(root);
    let rel = parent.strip_prefix(root).unwrap_or(parent);
    let text = rel.to_string_lossy().replace('\\', "/");
    if text.is_empty() { ".".into() } else { text }
}

pub fn content(payload: &Value) -> Result<Value, String> {
    let root = payload.get("root").and_then(Value::as_str).unwrap_or("");
    let query = payload.get("query").and_then(Value::as_str).unwrap_or("").trim();
    if root.is_empty() || query.is_empty() {
        return Ok(json!({ "files": [] }));
    }

    let case_sensitive = payload
        .get("caseSensitive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let whole_word = payload
        .get("wholeWord")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let use_regexp = payload
        .get("useRegexp")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let show_hidden = payload
        .get("showHidden")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let regex = build_regex(query, case_sensitive, whole_word, use_regexp)?;
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Ok(json!({ "files": [] }));
    }

    let mut files = Vec::new();
    let mut stack = vec![(root_path.to_path_buf(), 0usize)];
    let mut scanned = 0usize;

    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH || scanned >= MAX_FILES_SCANNED || files.len() >= MAX_RESULT_FILES {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if scanned >= MAX_FILES_SCANNED || files.len() >= MAX_RESULT_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                if !should_skip(&name, show_hidden) {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            if !file_type.is_file() || should_skip(&name, show_hidden) {
                continue;
            }
            scanned += 1;

            let name_match = regex.is_match(&name);
            let metadata = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if metadata.len() > MAX_FILE_BYTES {
                if name_match {
                    files.push(json!({
                        "path": path.to_string_lossy(),
                        "name": name,
                        "dir": relative_dir(root_path, &path),
                        "nameMatch": true,
                        "matches": [],
                    }));
                }
                continue;
            }

            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            // 二进制文件直接跳过；文本文件才逐行匹配。
            if bytes.iter().take(4096).any(|byte| *byte == 0) {
                continue;
            }
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };

            let mut matches = Vec::new();
            for (index, line) in text.lines().enumerate() {
                let Some(found) = regex.find(line) else {
                    continue;
                };
                matches.push(json!({
                    "line": index + 1,
                    "column": found.start(),
                    "match": truncate(found.as_str(), 120),
                    "text": truncate(line.trim(), 240),
                }));
                if matches.len() >= MAX_MATCHES_PER_FILE {
                    break;
                }
            }

            if name_match || !matches.is_empty() {
                files.push(json!({
                    "path": path.to_string_lossy(),
                    "name": name,
                    "dir": relative_dir(root_path, &path),
                    "nameMatch": name_match,
                    "matches": matches,
                }));
            }
        }
    }

    files.sort_by(|a, b| {
        let left = a.get("path").and_then(Value::as_str).unwrap_or("");
        let right = b.get("path").and_then(Value::as_str).unwrap_or("");
        left.cmp(right)
    });

    Ok(json!({ "files": files }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("arbormark-global-search-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join("readme.md"), "hello world\nsecond hello\n").unwrap();
        fs::write(dir.join("notes").join("todo.md"), "nothing here\n").unwrap();
        fs::write(dir.join(".hidden").join("secret.md"), "hello hidden\n").unwrap();
        fs::write(dir.join("binary.bin"), [0u8, 1, 2, 3]).unwrap();
        dir
    }

    #[test]
    fn finds_content_grouped_by_directory() {
        let dir = fixture();
        let result = content(&json!({
            "root": dir.to_string_lossy(),
            "query": "hello",
            "caseSensitive": false,
        }))
        .unwrap();
        let files = result["files"].as_array().unwrap();
        assert_eq!(files.len(), 1, "only readme.md should match content");
        assert_eq!(files[0]["dir"], json!("."));
        assert_eq!(files[0]["matches"].as_array().unwrap().len(), 2);
        assert_eq!(files[0]["matches"][0]["match"], json!("hello"));
        assert_eq!(files[0]["matches"][0]["line"], json!(1));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn matches_file_names_and_skips_hidden_by_default() {
        let dir = fixture();
        let result = content(&json!({
            "root": dir.to_string_lossy(),
            "query": "todo",
        }))
        .unwrap();
        let files = result["files"].as_array().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0]["name"], json!("todo.md"));
        assert_eq!(files[0]["nameMatch"], json!(true));

        let hidden = content(&json!({
            "root": dir.to_string_lossy(),
            "query": "hidden",
            "showHidden": true,
        }))
        .unwrap();
        assert_eq!(hidden["files"].as_array().unwrap().len(), 1);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn searches_code_and_config_files() {
        let dir = std::env::temp_dir().join(format!(
            "arbormark-search-filter-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("note.md"), "needle\n").unwrap();
        fs::write(dir.join("README"), "needle\n").unwrap();
        fs::write(dir.join("page.html"), "needle\n").unwrap();
        fs::write(dir.join("data.json"), "needle\n").unwrap();
        fs::write(dir.join("main.rs"), "needle\n").unwrap();

        let result = content(&json!({ "root": dir.to_string_lossy(), "query": "needle" })).unwrap();
        let mut names: Vec<String> = result["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["name"].as_str().unwrap_or_default().to_string())
            .collect();
        names.sort();
        // 代码/配置文件同样可被搜索（代码模式可打开），二进制仍跳过。
        assert_eq!(
            names,
            vec![
                "README".to_string(),
                "data.json".to_string(),
                "main.rs".to_string(),
                "note.md".to_string(),
                "page.html".to_string(),
            ]
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn supports_case_and_whole_word() {
        let dir = fixture();
        let insensitive = content(&json!({ "root": dir.to_string_lossy(), "query": "HELLO" })).unwrap();
        assert_eq!(insensitive["files"].as_array().unwrap().len(), 1);

        let sensitive = content(&json!({
            "root": dir.to_string_lossy(),
            "query": "HELLO",
            "caseSensitive": true,
        }))
        .unwrap();
        assert_eq!(sensitive["files"].as_array().unwrap().len(), 0);

        let whole = content(&json!({
            "root": dir.to_string_lossy(),
            "query": "hell",
            "wholeWord": true,
        }))
        .unwrap();
        assert_eq!(whole["files"].as_array().unwrap().len(), 0);

        let _ = fs::remove_dir_all(dir);
    }
}
