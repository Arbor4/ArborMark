# 安装与使用 Pandoc

Pandoc 是通用文档转换器，可与 ArborMark 配合完成导出与格式互转。

## 安装

- **macOS**：`brew install pandoc`
- **Windows**：`choco install pandoc` 或下载安装包
- **Linux**：`sudo apt install pandoc`

验证：`pandoc --version`。

## 常用转换

```bash
# Markdown → Word
pandoc note.md -o note.docx

# Markdown → PDF（需 LaTeX 或 wkhtmltopdf）
pandoc note.md -o note.pdf --pdf-engine=xelatex -V mainfont="PingFang SC"

# Markdown → HTML（独立页面，含样式）
pandoc note.md -s -o note.html

# Word → Markdown
pandoc draft.docx -t gfm -o draft.md
```

## 与 ArborMark 配合

1. 在 ArborMark 中完成写作与即时渲染校对。
2. 保存后用上述命令导出目标格式；数学公式加 `--mathjax`（HTML）或保留 LaTeX（PDF）。
3. 需要目录时加 `--toc`；需要编号章节加 `--number-sections`。

> 提示：ArborMark 的扩展语法（`==高亮==`、`[TOC]`、提示块）Pandoc 不认识，
> 导出前可先替换为标准写法，或使用 `--from markdown+extensions` 自定义解析。
