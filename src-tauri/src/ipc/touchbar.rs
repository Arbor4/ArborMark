//! `touchBar.*`：macOS Touch Bar 通道。
//!
//! Touch Bar 是 mac 硬件，Windows/Linux 上没有对应物；渲染层的全部调用点都在
//! `File.isMac` 分支内，Tauri 下不会触达。这里提供**诚实 no-op 桩**：返回值与
//! 旧 Electron rebuild 版对齐（未实现 → null），保证渲染层 Promise/回调链
//! 不会因通道缺失而中断。每个通道的语义见各自注释，供未来 macOS 端口参考。

use serde_json::Value;

macro_rules! touchbar_noop {
    ($($name:ident => $desc:expr),+ $(,)?) => {
        $(
            #[doc = $desc]
            pub fn $name() -> Result<Value, String> {
                Ok(Value::Null)
            }
        )+
    };
}

touchbar_noop! {
    set_block_style => "`touchBar.setBlockStyle`：切换 Touch Bar 上的块级样式按钮组。",
    set_fences_on_set_lang => "`touchBar.setFencesOnSetLang`：代码块语言变化时更新 Touch Bar 段。",
    set_inline_enabled => "`touchBar.setInlineEnabled`：启用/禁用 Touch Bar 行内格式条。",
    set_inline_states => "`touchBar.setInlineStates`：同步行内格式（加粗/斜体等）激活态。",
    show_dialog_touch_bar => "`touchBar.showDialogTouchBar`：弹出对话框时切换 Touch Bar 布局。",
    show_find_replace_touch_bar => "`touchBar.showFindReplaceTouchBar`：查找替换面板的 Touch Bar 布局。",
    show_insert_table_touch_bar => "`touchBar.showInsertTableTouchBar`：插入表格选择器的 Touch Bar 布局。",
    update_find_replace_mode => "`touchBar.updateFindReplaceMode`：查找/替换模式切换通知。",
    update_insert_table_touch_bar => "`touchBar.updateInsertTableTouchBar`：表格尺寸选择变化通知。",
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_touchbar_channels_are_honest_noops() {
        // 渲染层对这批通道从不消费返回值（fire-and-forget），null 即旧 parity。
        assert_eq!(set_block_style().unwrap(), Value::Null);
        assert_eq!(set_fences_on_set_lang().unwrap(), Value::Null);
        assert_eq!(set_inline_enabled().unwrap(), Value::Null);
        assert_eq!(set_inline_states().unwrap(), Value::Null);
        assert_eq!(show_dialog_touch_bar().unwrap(), Value::Null);
        assert_eq!(show_find_replace_touch_bar().unwrap(), Value::Null);
        assert_eq!(show_insert_table_touch_bar().unwrap(), Value::Null);
        assert_eq!(update_find_replace_mode().unwrap(), Value::Null);
        assert_eq!(update_insert_table_touch_bar().unwrap(), Value::Null);
    }
}
