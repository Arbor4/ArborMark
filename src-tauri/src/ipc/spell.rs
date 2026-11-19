//! `word.*`：拼写检查与文本替换域。
//!
//! 原版语义均依赖 macOS 系统服务（NSSpellChecker / 系统文本替换规则），
//! 渲染层调用点都在 `File.isMac` 分支内。Windows 侧提供**类型正确的空实现**：
//! 消费方对返回值的形态有明确期望（见各函数注释），返回空集合即可让调用链
//! 正常走完（0 条建议 / 无替换规则），而不是因通道缺失抛 TypeError。

use serde_json::{json, Value};

/// `word.getSpellSuggestionInContext`：拼写建议列表。
///
/// 渲染层（editor-views.js `search()`）消费 `matches.length` 并分页展示，
/// 返回空数组 = "0 条建议"，面板正常渲染空态。
pub fn get_spell_suggestion_in_context() -> Result<Value, String> {
    Ok(json!([]))
}

/// `word.getTextReplacement`：macOS 系统文本替换规则表（`{缩写: 全文}`）。
///
/// 渲染层（fences.js `handleMacUserReplacement`）直接 `Object.keys(result)`，
/// 返回空对象 = 无替换规则。
pub fn get_text_replacement() -> Result<Value, String> {
    Ok(json!({}))
}

/// `word.updateWordCount`：字数统计通知（原版用于更新 Touch Bar / Dock 角标）。
///
/// 渲染层 fire-and-forget；Windows 侧没有对应的系统级字数展示面，接受即可。
pub fn update_word_count() -> Result<Value, String> {
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestion_list_is_empty_array() {
        // 消费方 `matches.length` 要求数组；null 会让 .length 抛错。
        assert_eq!(get_spell_suggestion_in_context().unwrap(), json!([]));
    }

    #[test]
    fn text_replacement_is_empty_object() {
        // 消费方 `Object.keys(result)` 要求对象。
        assert_eq!(get_text_replacement().unwrap(), json!({}));
    }
}
