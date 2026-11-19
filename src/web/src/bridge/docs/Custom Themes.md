# 自定义主题

ArborMark 的配色全部来自主题 token，可整体替换而不改任何功能代码。

## 切换内置主题

偏好设置 → 外观 → 主题画廊，点击即可应用；支持浅色 / 深色 / 跟随系统。

## 导入自定义主题

1. 准备一份 CSS，定义以下变量（浅色与深色各一组）：

```css
:root {
  --am-bg: #fbfaf8;          /* 页面背景 */
  --am-bg-elevated: #ffffff; /* 卡片 / 面板 */
  --am-text: #24292f;        /* 正文 */
  --am-text-secondary: #57606a;
  --am-text-muted: #8b949e;
  --am-border: #d8dee4;
  --am-accent: #42b983;      /* 强调色 */
  --am-accent-soft: rgba(66, 185, 131, 0.16);
  --am-info: #0969da;
  --am-success: #1a7f37;
  --am-warning: #9a6700;
  --am-danger: #cf222e;
}
```

2. 在主题画廊中选择「导入主题 CSS」，校验通过后即出现在画廊中。
3. 也可以「导出主题」把当前主题保存为 CSS 继续修改。

## 设计建议

- 正文与背景对比度 ≥ 4.5:1；次要文字 ≥ 3:1。
- 强调色只用于交互与选中态，避免大面积高饱和铺色。
- 深色主题降低背景亮度而非纯黑，保留层次（bg / elevated / overlay）。
