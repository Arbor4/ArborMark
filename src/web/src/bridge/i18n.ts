/**
 * 轻量 i18n：prefs.language（zh-Hans / en）真实切换 UI 文案。
 * t(key) 供非 React 环境（node view / 命令）读取当前语言；useLang() 供组件订阅。
 */
import { useUi } from "@/stores/ui";
import { zhHant, jaJP, koKR, deDE, frFR, esES, ruRU, itIT, ptBR, nlNL, plPL, trTR, arSA } from "./locales";

export type Lang =
  | "system"
  | "zh-Hans"
  | "zh-Hant"
  | "en"
  | "ja-JP"
  | "ko-KR"
  | "de-DE"
  | "fr-FR"
  | "es-ES"
  | "ru-RU"
  | "it-IT"
  | "pt-BR"
  | "nl-NL"
  | "pl-PL"
  | "tr-TR"
  | "ar-SA";

const zh: Record<string, string> = {
  "nav.files": "文件", "nav.outline": "大纲", "nav.search": "搜索", "nav.appearance": "外观", "nav.settings": "偏好设置",
  "panel.files": "文件", "panel.outline": "大纲", "panel.search": "搜索",
  "status.focus": "专注模式", "status.typewriter": "打字机模式", "status.source": "源码模式", "status.edit": "编辑模式",
  "status.metric": "字数统计详情", "status.words": "词", "status.chars": "字符", "status.lines": "行", "status.readMin": "约 {n} 分钟阅读",
  "status.collapseSidebar": "收起侧边栏", "status.expandSidebar": "展开侧边栏", "status.toggleSource": "切换源码视图", "status.toggleEdit": "切换编辑视图",
  "status.collapseToolbar": "收起工具栏", "status.expandToolbar": "展开工具栏",
  "toolbar.bold": "加粗", "toolbar.italic": "斜体", "toolbar.strike": "删除线", "toolbar.inlineCode": "行内代码",
  "toolbar.h1": "一级标题", "toolbar.h2": "二级标题", "toolbar.h3": "三级标题", "toolbar.h4": "四级标题", "toolbar.quote": "引用", "toolbar.ul": "无序列表", "toolbar.ol": "有序列表", "toolbar.task": "任务列表",
  "toolbar.link": "插入链接", "toolbar.image": "插入图片", "toolbar.table": "插入表格", "toolbar.hr": "分隔线", "toolbar.codeblock": "代码块",
  "toolbar.save": "保存", "toolbar.typewriter": "打字机模式", "toolbar.focus": "专注模式",
  "find.placeholder": "文件内搜索…", "find.replacePlaceholder": "替换为…", "find.prev": "上一个匹配", "find.next": "下一个匹配",
  "find.case": "区分大小写", "find.close": "关闭搜索", "find.replace": "替换", "find.replaceAll": "全部替换", "find.toggleReplace": "切换替换",
  "ctx.cut": "剪切", "ctx.copy": "复制", "ctx.paste": "粘贴", "ctx.copyAs": "复制为", "ctx.paragraph": "段落", "ctx.format": "格式",
  "ctx.insert": "插入", "ctx.webSearch": "网络搜索", "ctx.selectAll": "全选", "ctx.toggleSource": "切换源码模式",
  "ctx.mathBlock": "公式块", "ctx.diagram": "图表块", "ctx.blankImage": "空白图片",
  "ctx.body": "正文", "ctx.md": "Markdown", "ctx.htmlSource": "HTML 源码", "ctx.semanticHtml": "语义 HTML（富文本）", "ctx.plain": "纯文本",
  "img.title": "插入图片", "img.local": "本地文件", "img.path": "路径 / URL", "img.pick": "点击选择图片（可多选）", "img.pickHint": "支持 PNG / JPG / GIF / SVG / WebP",
  "img.selected": "已选 {n} 张", "img.alt": "替代文本", "img.altPh": "图片描述（可选）", "img.preview": "预览", "img.cancel": "取消", "img.insert": "插入",
  "img.pathPh": "每行一个图片路径或 URL", "img.name": "名字", "img.src": "路径", "img.choose": "选择文件", "img.apply": "应用",
  "img.empty": "空白图片", "img.chooseImage": "选择图片", "img.insertBlank": "插入空白图片",
  "img.uploadUnavailable": "未配置图床服务，已引用原图",
  "editor.emptyHint": "开始输入，或粘贴 Markdown…",
  "lightbox.zoomIn": "放大", "lightbox.zoomOut": "缩小", "lightbox.fit": "适应窗口", "lightbox.actual": "原始尺寸", "lightbox.close": "关闭图片",
  "lightbox.hint": "滚轮/双指缩放 · 拖拽平移 · 双击切换原始/适应尺寸 · Esc 关闭", "lightbox.error": "图片无法加载", "lightbox.errorHint": "文件不存在或路径不可访问；桌面端请确认图片位于本机。",
  "outline.count": "{n} 个标题", "outline.empty": "大纲为空", "outline.emptyHint": "打开文档后，这里会显示标题结构", "outline.none": "没有标题", "outline.noneHint": "用 # 开始一个标题，大纲会自动出现", "outline.nav": "文档大纲",
  "quick.ph": "按文件名搜索…", "quick.aria": "快速打开文件", "quick.empty": "无匹配文件", "quick.emptyHint": "换个关键词试试",
  "gs.noMatch": "未找到 “{query}” 的匹配", "gs.summary": "{n} 处匹配 · {m} 个文件", "gs.jumpLine": "跳转到第 {n} 行",
  "set.saving": "保存", "settings.title": "偏好设置", "settings.appearance": "外观", "settings.file": "文件", "settings.editor": "编辑器", "settings.markdown": "Markdown", "settings.image": "图片", "settings.export": "导出",
  "settings.search": "搜索", "settings.general": "通用", "settings.shortcuts": "快捷键", "settings.about": "关于",
  "onboard.lang": "语言", "onboard.appearance": "外观", "onboard.theme": "主题",
  "onboard.skip": "跳过", "onboard.next": "下一步", "onboard.back": "上一步", "onboard.done": "开始使用",
  "onboard.demo.source": "源码", "onboard.demo.render": "即时渲染", "onboard.demo.replace": "替换",
  "onboard.demo.math": "数学公式", "onboard.demo.diagram": "Mermaid 图表", "onboard.demo.code": "代码高亮", "onboard.demo.image": "拖拽 / 粘贴图片",
  "onboard.demo.prefs": "偏好设置", "onboard.demo.immersive": "沉浸模式", "onboard.demo.focus": "专注模式", "onboard.demo.zoom": "缩放",
  "onboard.demo.recap": "你当前的选择", "onboard.demo.hotkeys": "常用快捷键",
  "onboard.demo.new": "新建", "onboard.demo.quick": "快速打开", "onboard.demo.save": "保存", "onboard.demo.view": "切换视图",
  "onboard.demo.sentence": "Markdown 编辑器直接打开 Markdown 文件。",
  "common.copied": "已复制", "common.copyFail": "复制失败", "common.saved": "已保存",
  "about.reopen": "重新打开欢迎引导", "about.celebrate": "撒花庆祝",
  "about.body": "轻量、现代的 Markdown 编辑器。所见即所得内核：Milkdown（ProseMirror）；源码：CodeMirror 6；渲染：KaTeX + highlight.js + Mermaid。主题系统完全开放，欢迎创作你自己的主题。",
  "about.version": "版本 4.0.4 · Tauri 2 + React 19 + Milkdown / CodeMirror 6",
  "link.text": "链接文字", "link.url": "链接地址", "link.title": "标题（可选）", "link.open": "打开", "link.apply": "应用", "link.unlink": "移除链接", "link.close": "关闭", "link.hint": "单击编辑链接 · ⌘/Ctrl+单击跳转",
  "theme.system": "跟随系统", "theme.light": "浅色模式", "theme.dark": "深色模式", "theme.switch": "点击切换",
};

const en: Record<string, string> = {
  "nav.files": "Files", "nav.outline": "Outline", "nav.search": "Search", "nav.appearance": "Appearance", "nav.settings": "Preferences",
  "panel.files": "Files", "panel.outline": "Outline", "panel.search": "Search",
  "status.focus": "Focus mode", "status.typewriter": "Typewriter mode", "status.source": "Source mode", "status.edit": "Edit mode",
  "status.metric": "Word count details", "status.words": "words", "status.chars": "chars", "status.lines": "lines", "status.readMin": "~{n} min read",
  "status.collapseSidebar": "Collapse sidebar", "status.expandSidebar": "Expand sidebar", "status.toggleSource": "Switch to source", "status.toggleEdit": "Switch to edit",
  "status.collapseToolbar": "Hide toolbar", "status.expandToolbar": "Show toolbar",
  "toolbar.bold": "Bold", "toolbar.italic": "Italic", "toolbar.strike": "Strikethrough", "toolbar.inlineCode": "Inline code",
  "toolbar.h1": "Heading 1", "toolbar.h2": "Heading 2", "toolbar.h3": "Heading 3", "toolbar.h4": "Heading 4", "toolbar.quote": "Quote", "toolbar.ul": "Bullet list", "toolbar.ol": "Numbered list", "toolbar.task": "Task list",
  "toolbar.link": "Insert link", "toolbar.image": "Insert image", "toolbar.table": "Insert table", "toolbar.hr": "Divider", "toolbar.codeblock": "Code block",
  "toolbar.save": "Save", "toolbar.typewriter": "Typewriter mode", "toolbar.focus": "Focus mode",
  "find.placeholder": "Find in file…", "find.replacePlaceholder": "Replace with…", "find.prev": "Previous match", "find.next": "Next match",
  "find.case": "Match case", "find.close": "Close search", "find.replace": "Replace", "find.replaceAll": "Replace all", "find.toggleReplace": "Toggle replace",
  "ctx.cut": "Cut", "ctx.copy": "Copy", "ctx.paste": "Paste", "ctx.copyAs": "Copy as", "ctx.paragraph": "Paragraph", "ctx.format": "Format",
  "ctx.insert": "Insert", "ctx.webSearch": "Web search", "ctx.selectAll": "Select all", "ctx.toggleSource": "Toggle source mode",
  "ctx.mathBlock": "Math block", "ctx.diagram": "Diagram block", "ctx.blankImage": "Blank image",
  "ctx.body": "Body", "ctx.md": "Markdown", "ctx.htmlSource": "HTML source", "ctx.semanticHtml": "Semantic HTML (rich)", "ctx.plain": "Plain text",
  "img.title": "Insert image", "img.local": "Local file", "img.path": "Path / URL", "img.pick": "Click to choose images (multi)", "img.pickHint": "PNG / JPG / GIF / SVG / WebP",
  "img.selected": "{n} selected", "img.alt": "Alt text", "img.altPh": "Description (optional)", "img.preview": "Preview", "img.cancel": "Cancel", "img.insert": "Insert",
  "img.pathPh": "One image path or URL per line", "img.name": "Name", "img.src": "Path", "img.choose": "Choose file", "img.apply": "Apply",
  "img.empty": "Blank image", "img.chooseImage": "Choose image", "img.insertBlank": "Insert blank image",
  "img.uploadUnavailable": "No image host configured; original referenced",
  "editor.emptyHint": "Start typing, or paste Markdown…",
  "lightbox.zoomIn": "Zoom in", "lightbox.zoomOut": "Zoom out", "lightbox.fit": "Fit window", "lightbox.actual": "Actual size", "lightbox.close": "Close image",
  "lightbox.hint": "Wheel/pinch zoom · drag pan · double-click fit/actual · Esc close", "lightbox.error": "Image failed to load", "lightbox.errorHint": "File missing or inaccessible; on desktop ensure the image is local.",
  "outline.count": "{n} headings", "outline.empty": "Outline empty", "outline.emptyHint": "Open a document to see its heading structure", "outline.none": "No headings", "outline.noneHint": "Start a heading with # and the outline appears", "outline.nav": "Document outline",
  "quick.ph": "Search by filename…", "quick.aria": "Quick open file", "quick.empty": "No matching files", "quick.emptyHint": "Try another keyword",
  "gs.noMatch": "No matches for “{query}”", "gs.summary": "{n} matches · {m} files", "gs.jumpLine": "Jump to line {n}",
  "set.saving": "Saving", "settings.title": "Preferences", "settings.appearance": "Appearance", "settings.file": "Files", "settings.editor": "Editor", "settings.markdown": "Markdown", "settings.image": "Image", "settings.export": "Export",
  "settings.search": "Search", "settings.general": "General", "settings.shortcuts": "Shortcuts", "settings.about": "About",
  "onboard.lang": "Language", "onboard.appearance": "Appearance", "onboard.theme": "Theme",
  "onboard.skip": "Skip", "onboard.next": "Next", "onboard.back": "Back", "onboard.done": "Get started",
  "onboard.demo.source": "Source", "onboard.demo.render": "Live render", "onboard.demo.replace": "Replace",
  "onboard.demo.math": "Math", "onboard.demo.diagram": "Mermaid diagrams", "onboard.demo.code": "Code highlight", "onboard.demo.image": "Drag & paste images",
  "onboard.demo.prefs": "Preferences", "onboard.demo.immersive": "Immersive", "onboard.demo.focus": "Focus mode", "onboard.demo.zoom": "Zoom",
  "onboard.demo.recap": "Your choices", "onboard.demo.hotkeys": "Handy shortcuts",
  "onboard.demo.new": "New", "onboard.demo.quick": "Quick open", "onboard.demo.save": "Save", "onboard.demo.view": "Toggle view",
  "onboard.demo.sentence": "The Markdown editor opens Markdown files in place.",
  "common.copied": "Copied", "common.copyFail": "Copy failed", "common.saved": "Saved",
  "about.body": "A lightweight, modern Markdown editor. WYSIWYG core: Milkdown (ProseMirror); source: CodeMirror 6; rendering: markdown-it + KaTeX + highlight.js + Mermaid. Fully open theme system — create your own.",
  "about.reopen": "Reopen welcome guide", "about.celebrate": "Celebrate",
  "about.version": "Version 4.0.4 · Tauri 2 + React 19 + Milkdown / CodeMirror 6",
  "link.text": "Link text", "link.url": "URL", "link.title": "Title (optional)", "link.open": "Open", "link.apply": "Apply", "link.unlink": "Unlink", "link.close": "Close", "link.hint": "Click to edit link · ⌘/Ctrl+click to open",
  "theme.system": "Follow system", "theme.light": "Light mode", "theme.dark": "Dark mode", "theme.switch": "click to switch",
};


/** 以中文原文为键的英文映射：t("中文") 在 zh 返回原文、en 返回译文，便于批量覆盖既有文案。 */
const ZH2EN: Record<string, string> = {
  "在所有文件中搜索…（↑↓ 选择，↵ 跳转到行）": "Search all files… (↑↓ select, ↵ jump to line)",
  "缩小 −": "Zoom out −", "放大 +": "Zoom in +", "适应窗口 0": "Fit window 0", "原始尺寸 1": "Actual size 1", "关闭 Esc": "Close Esc",
  "设置分类": "Settings categories", "关闭设置": "Close settings",
  "引擎名称": "Engine name", "引擎 URL": "Engine URL", "自定义引擎名称": "Custom engine name", "自定义引擎 URL": "Custom engine URL",
  "空文件夹": "Empty folder", "点击上方 + 新建第一个文件": "Use + above to create your first file",
  "编辑区": "Editor area", "移动到文件夹路径": "Move to folder path",
  "主题": "Themes", "排版": "Typography", "界面": "Interface", "编辑体验": "Editing experience",
  "渲染引擎": "Render engine", "语法扩展": "Syntax extensions", "智能标点": "Smart punctuation", "空白与换行": "Whitespace & breaks",
  "插入与路径": "Insertion & paths", "说明": "Notes", "选中文本搜索": "Selection web search", "搜索引擎": "Search engines",
  "语言与更新": "Language & updates", "会话": "Session", "设置管理": "Settings management",
  "编辑器字号": "Editor font size", "正文基准大小，编辑与源码同步": "Base body size, synced across edit & source",
  "减小字号": "Decrease font size", "增大字号": "Increase font size",
  "编辑区宽度": "Editor width", "长文写作的最佳行宽": "Optimal line width for long-form writing",
  "显示工具栏": "Show toolbar", "顶部格式化按钮栏": "Top formatting button bar",
  "大纲高亮当前标题": "Outline highlights current heading", "滚动时高亮所在章节": "Highlight the section in view while scrolling",
  "自动保存": "Auto save", "停止输入 0.8 秒后写入磁盘": "Write to disk 0.8s after you stop typing",
  "显示行号": "Show line numbers", "源码模式下显示行号": "Line numbers in source mode",
  "打字机模式": "Typewriter mode", "光标始终保持在视口中央": "Keep the caret centered in the viewport",
  "专注模式": "Focus mode", "淡化非当前段落，聚焦写作": "Dim other paragraphs to focus writing",
  "只读模式": "Read-only mode", "锁定编辑，仅浏览": "Lock editing, browse only",
  "自动换行": "Word wrap", "长行软换行而非横向滚动": "Soft-wrap long lines instead of horizontal scroll",
  "拼写检查": "Spell check", "浏览器原生拼写提示": "Native browser spellcheck hints",
  "自动配对符号": "Auto-pair symbols", "自动补全括号、引号与 Markdown 标记": "Auto-close brackets, quotes and Markdown markers",
  "缩进宽度": "Indent width", "Tab 与列表缩进的空格数": "Spaces for Tab and list indentation",
  "内联数学公式": "Inline math", "$...$ 行内公式（块级 $$ 始终支持）": "$...$ inline math (block $$ always on)",
  "高亮": "Highlight", "==高亮文字==": "==highlighted text==",
  "上标": "Superscript", "^上标^": "^superscript^", "下标": "Subscript", "~下标~": "~subscript~",
  "Mermaid 图表": "Mermaid diagrams", "```mermaid 流程图/时序图等": "```mermaid flow/sequence diagrams",
  "GitHub 提示块": "GitHub alerts", "[!NOTE]/[!TIP]/[!WARNING] 等": "[!NOTE]/[!TIP]/[!WARNING] etc.",
  "Emoji 简码": "Emoji shortcodes", ":smile: 等简码渲染为表情": ":smile: etc. render as emoji",
  "渲染 HTML": "Render HTML", "渲染内联/块级 HTML 标签": "Render inline/block HTML tags",
  "公式自动编号": "Auto-number math", "为块级公式添加序号": "Number block equations",
  "智能引号": "Smart quotes", "将直引号转换为弯引号": "Convert straight quotes to curly",
  "智能破折号": "Smart dashes", "将 -- 转换为破折号": "Convert -- to em dash",
  "解析时重映射 Unicode 标点": "Remap Unicode punctuation on parse", "重映射标点": "Remap punctuation",
  "保存时插入末尾换行符": "Insert final newline on save", "文件末尾保留一个换行": "Keep one newline at file end", "末尾换行": "Final newline",
  "保留单个换行": "Preserve single line break", "单个换行渲染为换行而非合并": "Render single breaks as breaks, not merged",
  "段落首行缩进": "First-line indent", "段首缩进两个字符": "Indent paragraph first line by two chars",
  "使用相对路径": "Use relative paths", "插入图片时优先相对当前文档的路径": "Prefer paths relative to the current document",
  "相对路径基准": "Relative path base", "相对路径以哪个目录为起点计算": "Which directory relative paths resolve from",
  "当前文档目录": "Current document dir", "工作区根目录": "Workspace root",
  "附件子目录": "Assets subfolder", "复制图片时存放的子文件夹（留空为基准目录本身）": "Subfolder for copied images (empty = base dir)",
  "插入时复制到附件目录": "Copy into assets folder on insert", "关闭则仅引用原文件位置，不复制": "Off = reference original location, no copy", "插入时复制": "Copy on insert",
  "文件名模板": "Filename template", "复制落盘时的命名方式": "Naming when copying to disk",
  "保留原文件名": "Keep original name", "时间戳": "Timestamp", "文档名-序号": "Doc-name-sequence",
  "以文件名作为 alt": "Use filename as alt", "插入时自动填充图片描述文本": "Auto-fill image description on insert", "文件名作 alt": "Filename as alt",
  "自动转义图片 URL": "Auto-escape image URLs", "对 URL 中的空格与特殊字符转义": "Escape spaces and special chars in URLs",
  "图像": "Image", "插入图片时…": "When inserting images…", "了解更多…": "Learn more…",
  "无特殊操作": "No special action", "复制图片到当前文件夹（./）": "Copy image to current folder (./)",
  "复制图片到 ./assets 文件夹": "Copy image to ./assets folder", "复制图片到 ./${filename}.assets 文件夹": "Copy image to ./${filename}.assets folder",
  "上传图片": "Upload image", "复制到指定路径": "Copy to a specified path", "指定路径": "Specified path",
  "对本地位置的图片应用上述规则": "Apply the above rules to local images",
  "对网络位置的图片应用上述规则": "Apply the above rules to network images",
  "允许根据 YAML 设置自动上传图片": "Allow auto-upload based on YAML front-matter",
  "图片语法偏好": "Image syntax preferences", "优先使用相对路径": "Prefer relative paths",
  "为相对路径添加 ./": "Add ./ to relative paths", "插入时自动转义图片 URL": "Auto-escape image URLs on insert",
  "相对路径以 ./ 开头，便于某些渲染器解析": "Prefix relative paths with ./ for some renderers",
  "对空格与括号等字符进行百分号转义": "Percent-escape spaces, parentheses and similar characters",
  "图片": "Image", "图片预览": "Image preview", "用系统应用打开": "Open with system app",
  "无法打开文件": "Cannot open file", "放大查看": "Open zoom viewer",
  "PDF 预览不可用": "PDF preview unavailable", "可改用系统默认应用打开该 PDF。": "You can open this PDF with the system default app instead.",
  "适应宽度": "Fit width", "滚轮滚动 · Ctrl+滚轮缩放 · 双击切换原始/适应尺寸 · Esc 关闭": "Wheel to scroll · Ctrl+wheel to zoom · double-click toggles actual/fit · Esc closes",
  "复制文件": "Copy file", "剪切文件": "Cut file", "粘贴文件": "Paste file",
  "外观模式": "Appearance mode", "浅色": "Light", "深色": "Dark", "跟随系统": "Follow system",
  "导入": "Import", "模板": "Template", "导入主题": "Import theme", "导入主题 JSON / CSS": "Import theme JSON / CSS",
  "导出主题模板": "Export theme template", "导出主题模板（JSON）": "Export theme template (JSON)",
  "打开主题文件夹": "Open themes folder", "模板已导出，修改后导入即可": "Template exported; edit and re-import to apply",
  "主题已删除": "Theme deleted", "主题已导出": "Theme exported", "内置": "Built-in", "自定义": "Custom",
  "明 / 暗": "Light / Dark", "导出此主题": "Export this theme", "导出主题": "Export theme",
  "删除此主题": "Delete this theme", "删除主题": "Delete theme", "再次点击确认删除": "Click again to confirm delete",
  "主题完全开放：每个主题只是一组设计 token（--am-*）。导出模板、修改配色、导入即可生效；也可以把 JSON / CSS 文件放入主题文件夹，重启后自动识别。":
    "Themes are fully open: each is just a set of design tokens (--am-*). Export a template, tweak colors, and import to apply; or drop JSON / CSS files into the themes folder and they are picked up on restart.",
  "开关即时生效（编辑器按当前配置重新渲染）。覆盖常用 Markdown 扩展。":
    "Toggles apply instantly (the editor re-renders with the current config). Covers common Markdown extensions.",
  "在访达中显示": "Reveal in Finder", "在文件资源管理器中显示": "Show in File Explorer", "在文件管理器中显示": "Show in File Manager", "偏好设置": "Preferences", "删除线": "Strikethrough",
  "撤销 / 重做": "Undo / redo", "加粗 / 斜体 / 行内代码": "Bold / italic / inline code",
  "查找 / 替换（当前文件）": "Find / replace (current file)", "文件 / 大纲 / 搜索面板": "Files / Outline / Search panels",
  "收起 / 展开侧边栏": "Collapse / expand sidebar", "编辑 / 源码": "Edit / source",
  "连选 / 多选": "Range / multi select", "Shift 点击 / ⌘点击": "Shift-click / ⌘-click",
  "移动文件": "Move files", "拖拽到目标文件夹": "Drag to target folder", "删除所选": "Delete selected",
  "定位当前文件": "Locate current file", "没有打开的文件": "No file open",
  "还有 {n} 项，点击加载": "{n} more, click to load",
  "已保存": "Saved",
  "代码编辑模式 · 语法高亮 · ⌘S 保存": "Code mode · syntax highlighting · ⌘S to save",
  "源码模式 · 语法高亮 · ⌘S 保存": "Source mode · syntax highlighting · ⌘S to save",
  "替换": "Replace", "表格": "table", "点击网格插入": "Click a cell to insert",
  "行数": "Rows", "列数": "Cols", "默认": "Default", "暂无记录": "No recents",
  "开始写作": "Start writing", "新建文档": "New document",
  "从左侧选择一个文件，或新建一个 Markdown 文档。支持拖拽整理、全局搜索与可定制主题。":
    "Pick a file on the left, or create a new Markdown document. Drag to organize, global search, and customizable themes.",
  "⌘N 新建 · ⌘P 快速打开 · ⌘⇧F 全局搜索 · ⌘/ 切换视图": "⌘N new · ⌘P quick open · ⌘⇧F global search · ⌘/ toggle view",
  "复制": "Copy", "复制代码": "Copy code", "渲染图表…": "Rendering diagram…",
  "空公式": "Empty formula", "空图表": "Empty diagram", "源码": "Source", "完成": "Done",
  "实时预览": "Live preview", "点击编辑图表代码": "Click to edit diagram code",
  "启用网络搜索": "Enable web search", "选中文本后可一键跳转到搜索引擎 / AI 问答": "Jump to a search engine / AI chat from selected text",
  "选中气泡": "Selection bubble", "选中文本后浮现搜索气泡": "Show a search bubble over selected text",
  "右键菜单入口": "Context-menu entry", "在右键菜单显示「网络搜索」分组": "Show a Web search group in the context menu",
  "默认引擎": "Default engine", "气泡主按钮与首选搜索目标": "Bubble primary button and preferred target",
  "名称": "Name", "添加": "Add", "恢复默认": "Restore defaults", "保存": "Save", "编辑": "Edit", "删除": "Delete",
  "界面语言": "Interface language", "简体中文": "Simplified Chinese", "自动检查更新": "Auto-check updates",
  "启动时恢复上次会话": "Restore last session on launch", "重新打开上次的文件夹与文档": "Reopen last folder and document", "恢复会话": "Restore session",
  "显示隐藏文件": "Show hidden files", "文件树中显示以 . 开头的文件": "Show dot-files in the file tree",
  "导出设置": "Export settings", "将当前偏好保存为 JSON 文件，便于备份或迁移": "Save preferences as JSON for backup/migration", "导出…": "Export…",
  "导入设置": "Import settings", "从 JSON 文件恢复偏好（覆盖当前设置）": "Restore preferences from JSON (overwrites current)", "导入…": "Import…",
  "设置已导出": "Settings exported", "设置已导入并应用": "Settings imported and applied",
  "新建文件": "New file", "新建文件夹": "New folder", "切换列表视图": "Switch to list view", "切换树视图": "Switch to tree view",
  "切换视图": "Toggle view", "刷新": "Refresh", "刷新文件库": "Refresh library", "打开其他文件夹": "Open another folder",
  "打开文件夹": "Open folder", "打开文件夹…": "Open folder…", "未打开文件夹": "No folder open", "尚未打开文件夹": "No folder opened yet",
  "文件库": "File library", "文件树": "File tree", "文件列表": "File list", "打开": "Open", "重命名": "Rename", "创建副本": "Duplicate",
  "复制文件名": "Copy file name", "复制路径": "Copy path", "在文件夹中显示": "Reveal in folder", "移动到…": "Move to…",
  "打开一个文件夹开始写作，或把 Markdown 文件拖进来": "Open a folder to start writing, or drag Markdown files in",
  "全局搜索": "Global search", "区分大小写": "Match case", "全词匹配": "Whole word", "正则表达式": "Regular expression",
  "隐藏替换": "Hide replace", "显示替换": "Show replace", "切换替换": "Toggle replace", "替换为…": "Replace with…", "替换内容": "Replace content",
  "全部替换": "Replace all", "全部替换完成": "Replace all complete", "搜索中…": "Searching…", "输入关键词开始全局搜索": "Type a keyword to search all files",
  "替换此处": "Replace here", "选择": "select", "跳转": "jump", "关闭": "close",
  "大纲": "Outline", "个标题": "headings", "全部展开": "Expand all", "全部折叠": "Collapse all", "收起侧边栏": "Collapse sidebar", "暂无标题": "No headings", "标题栏": "Title bar",
  "快速打开": "Quick open", "无匹配文件": "No matching files",
  "放大": "Zoom in", "缩小": "Zoom out", "适应窗口": "Fit window", "原始尺寸": "Actual size", "关闭图片": "Close image",
  "图片无法加载": "Image failed to load", "文件不存在或路径不可访问；桌面端请确认图片位于本机。": "File missing or inaccessible; on desktop ensure the image is local.",
  "视频": "Video", "音频": "Audio", "不支持": "Unsupported", "视频预览": "Video preview", "音频预览": "Audio preview",
  "载入中…": "Loading…", "行号": "Line numbers", "在新窗口打开": "Open in New Window",
  "最小化": "Minimize", "最大化": "Maximize", "还原": "Restore",
  "不支持的文件类型": "Unsupported file type", "这是二进制文件，以文本打开只会显示乱码。可用系统关联的应用打开。": "Binary file — opening it as text would only show mojibake. Use a system app instead.",
  "无法播放该媒体文件": "Cannot play this media file", "文件可能过大、编码不支持或已损坏，可用系统播放器打开。": "The file may be too large, use an unsupported codec, or be corrupted. Try a system player.",
  "插入图片": "Insert image", "本地文件": "Local file", "路径 / URL": "Path / URL", "点击选择图片（可多选）": "Click to choose images (multi)",
  "替代文本": "Alt text", "图片描述（可选）": "Description (optional)", "预览": "Preview", "取消": "Cancel", "插入": "Insert",
  "每行一个图片路径或 URL": "One image path or URL per line",
  "滚轮缩放 · 拖拽平移 · 双击切换原始/适应尺寸 · Esc 关闭": "Wheel zoom · drag pan · double-click fit/actual · Esc close",
  "大纲为空": "Outline empty", "打开文档后，这里会显示标题结构": "Open a document to see its heading structure", "没有标题": "No headings", "用 # 开始一个标题，大纲会自动出现": "Start a heading with # and the outline appears", "文档大纲": "Document outline", "按文件名搜索…": "Search by filename…", "快速打开文件": "Quick open file", "文件": "Files", "视图": "View", "about.body": "轻量、现代的 Markdown 编辑器。编辑器内核：Milkdown（ProseMirror）所见即所得 · 源码：CodeMirror 6 · 渲染：markdown-it + KaTeX + highlight.js + Mermaid。主题系统完全开放，欢迎创作你自己的主题。",
  "保存与启动": "Saving & startup", "默认格式": "Default format", "默认文件类型 / 扩展名": "Default file type / extension",
  "新建未指定后缀的文件时默认采用的扩展名": "Default extension for new files without one", "默认扩展名": "Default extension",
  "默认换行符 (EOL)": "Default line ending (EOL)", "新文件的换行符标准": "Line ending standard for new files", "默认换行符": "Default line ending",
  "文件末尾保留换行符": "Keep final newline", "保存文件时若末尾无换行则自动追加一个换行符": "Automatically append a newline if missing on save",
  "最近使用的目录与历史": "Recent directories & history", "历史文件与目录记录": "Recent files & directories", "清除历史记录": "Clear history",
  "清除历史文件记录": "Clear history records", "已清除历史文件与目录记录": "Cleared recent files & directories",
  "切换文件时自动保存": "Auto save on switch", "切换文档时自动将未保存更改写回磁盘": "Automatically write unsaved changes when switching files",
  "复制/剪切整行": "Copy/cut whole line", "复制或剪切时，若没有文字被选中，则处理光标所在的一整行": "When nothing is selected, copy or cut the entire line at cursor",
  "语法偏好": "Syntax preferences", "无序列表符号": "Unordered list marker", "插入无序列表时的默认项目标记": "Default marker when inserting unordered lists",
  "无序列表标记": "Unordered list marker", "默认代码块语言": "Default code block language",
  "新建代码块未指定语言时的默认语法识别": "Default syntax when creating a code block without language", "无默认语言（纯文本）": "No default language (plain text)",
  "排版与缩放": "Typography & zoom", "鼠标滚轮缩放": "Mouse wheel zoom", "按住 Ctrl 或 ⌘ 滚动鼠标滚轮放大/缩小编辑器字号": "Hold Ctrl or ⌘ and scroll wheel to zoom font size",
  "界面与状态栏": "Interface & status bar", "阅读速度": "Reading speed", "状态栏预估阅读时长的参考基准": "Reference baseline for estimated reading time in status bar",
  "导出选项": "Export options", "导出后打开所在目录": "Reveal exported file in folder",
  "导出 PDF 或 HTML 文件后，自动在系统文件管理器中定位目标文件": "Automatically locate the exported file in file explorer",
  "支持格式": "Supported formats", "会话与文件树": "Session & file tree", "设置备份与迁移": "Settings backup & migration",
  "重置选项": "Reset options", "恢复默认偏好设置": "Reset all preferences to default",
  "将所有偏好设置重置为初始默认值": "Reset all preferences to factory defaults",
  "已恢复默认偏好设置": "Preferences restored to defaults", "重置全部警告提示对话框": "Reset all warning dialogs",
  "恢复所有被勾选「不再提示」的确认弹窗": "Restore all dismissed confirmation prompts", "重置对话框": "Reset dialogs",
  "已重置所有警告提示": "All warning dialogs reset",
  "最近打开": "Recent Folders",
  "最近": "Recent",
  "按文件名搜索…（支持最近文件优先）": "Search by filename… (Recent files prioritized)",
  "文件库为空": "Library is empty",
  "没有匹配的文件": "No matching files",
  "检查更新": "Check for updates",
  "立即检查": "Check now",
  "当前版本": "Current version",
  "重新打开上次使用的文件夹与文档": "Reopen the last used folder and document",
  "编辑态采用 Milkdown（ProseMirror）所见即所得引擎：直接在渲染结果上编辑标题、引用、列表、表格（增删行列）、代码块、公式与 Mermaid 图表。源码态为纯文本 CodeMirror，⌘/ 在两者间切换。":
    "WYSIWYG editing uses Milkdown (ProseMirror): edit headings, quotes, lists, tables (add/remove rows & cols), code blocks, math and Mermaid directly on rendered content. Source mode is plain CodeMirror; toggle with ⌘/.",
  "插入图片时按所选动作复制/引用；「应用规则」分别控制本地与网络图片。语法偏好决定生成 Markdown 的路径形态（相对/绝对、./ 前缀、URL 转义）。":
    "Images are copied or referenced based on the chosen action. Apply rules govern local and web images. Syntax preferences control relative/absolute paths, ./ prefix, and URL escaping.",
  "拖拽或粘贴图片到编辑区、或经菜单「插入本地图片」时，按以上偏好落盘并生成路径。浏览器环境粘贴回退为自包含 data URI；桌面端复制真实文件到附件目录。点击图片可放大查看；导出 PDF/HTML 时相对路径按设置保留或转换。":
    "Dragging or pasting images into the editor saves files and generates paths according to preferences. Web fallback uses data URIs; desktop copies files into the assets folder. Click images to zoom; paths are preserved or converted on export.",
  "自定义引擎需含名称与带 %s 或 {关键词} 的 URL": "Custom engine requires a name and a URL containing %s or {keyword}",
  "打开所在文件夹": "Open folder",
  "文件内搜索与替换": "Find & replace in file",
  "主导航": "Main navigation",
  "侧边栏": "Sidebar",
  "调整侧边栏宽度": "Resize sidebar width",
  "关闭通知": "Dismiss notification",
  "界面渲染出错": "UI Rendering Error",
  "重新加载": "Reload",
  "选择主题文件": "Select theme file",
  "选择表格尺寸": "Select table dimensions",
  "确定要恢复默认偏好设置吗？": "Are you sure you want to restore default preferences?",
  "导出失败": "Export failed",
  "导入失败": "Import failed",
  "确认": "Confirm",
  "确定": "OK",
  "展开": "Expand",
  "折叠": "Collapse",
  "正在检查更新…": "Checking for updates…",
  "已是最新版本 (v{v})": "You're up to date (v{v})",
  "检查更新失败，请检查网络连接": "Failed to check for updates. Please check your network connection.",
  "发现新版本": "Update available",
  "发现新版本 ArborMark v{latest}（当前版本 v{current}）！": "New version ArborMark v{latest} is available (current: v{current})!",
  "更新说明：": "Release notes:",
  "是否前往 GitHub Releases 下载更新？": "Open GitHub Releases to download the update?",
  "前往下载": "Download",
  "稍后再说": "Later",
  "文件已被外部修改，已自动重新加载": "File modified externally — reloaded automatically",
  "已重新加载磁盘最新版本": "Reloaded latest version from disk",
  "文件已被外部修改": "File modified externally",
  "文件「{name}」在磁盘上已被外部程序修改。\n\n是否从磁盘重新加载最新内容？\n（选择“确定”丢弃当前未保存内容并重载；选择“取消”保留当前编辑）":
    "File “{name}” was modified externally on disk.\n\nReload the latest content from disk?\n(Reloading discards unsaved edits; Cancel keeps your current edits.)",
  "从磁盘重载": "Reload from disk",
  "保留当前编辑": "Keep current edits",
  "保存失败": "Save failed",
  "重命名失败": "Rename failed",
  "已存在同名文件：{name}": "A file named “{name}” already exists",
};

const dicts: Record<string, Record<string, string>> = {
  "zh-Hans": zh,
  "zh-Hant": { ...zh, ...zhHant },
  en,
  "ja-JP": { ...en, ...jaJP },
  "ko-KR": { ...en, ...koKR },
  "de-DE": { ...en, ...deDE },
  "fr-FR": { ...en, ...frFR },
  "es-ES": { ...en, ...esES },
  "ru-RU": { ...en, ...ruRU },
  "it-IT": { ...en, ...itIT },
  "pt-BR": { ...en, ...ptBR },
  "nl-NL": { ...en, ...nlNL },
  "pl-PL": { ...en, ...plPL },
  "tr-TR": { ...en, ...trTR },
  "ar-SA": { ...en, ...arSA },
};

export function resolveLang(pref?: string): string {
  if (!pref || pref === "system") {
    const nav = typeof navigator !== "undefined" ? navigator.language : "zh-Hans";
    if (nav.startsWith("zh-TW") || nav.startsWith("zh-HK") || nav.startsWith("zh-MO") || nav.startsWith("zh-Hant")) return "zh-Hant";
    if (nav.startsWith("zh")) return "zh-Hans";
    if (nav.startsWith("ja")) return "ja-JP";
    if (nav.startsWith("ko")) return "ko-KR";
    if (nav.startsWith("de")) return "de-DE";
    if (nav.startsWith("fr")) return "fr-FR";
    if (nav.startsWith("es")) return "es-ES";
    if (nav.startsWith("ru")) return "ru-RU";
    if (nav.startsWith("it")) return "it-IT";
    if (nav.startsWith("pt")) return "pt-BR";
    if (nav.startsWith("nl")) return "nl-NL";
    if (nav.startsWith("pl")) return "pl-PL";
    if (nav.startsWith("tr")) return "tr-TR";
    if (nav.startsWith("ar")) return "ar-SA";
    return "en";
  }
  return pref;
}

export function currentLang(): string {
  const l = useUi.getState().prefs.language;
  return resolveLang(String(l ?? "zh-Hans"));
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = currentLang();
  const dict = dicts[lang];
  let s: string;
  if (dict && dict[key]) {
    s = dict[key];
  } else if (lang.startsWith("zh-Hant")) {
    s = dicts["zh-Hant"]?.[key] ?? zh[key] ?? key;
  } else if (lang.startsWith("zh")) {
    s = zh[key] ?? key;
  } else {
    s = dict?.[key] ?? en[key] ?? ZH2EN[key] ?? key;
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  return s;
}

/** 组件订阅语言变化。 */
export function useLang() {
  const pref = useUi((s) => s.prefs.language);
  const lang = resolveLang(String(pref ?? "zh-Hans"));
  return {
    lang,
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict = dicts[lang];
      let s: string;
      if (dict && dict[key]) {
        s = dict[key];
      } else if (lang.startsWith("zh-Hant")) {
        s = dicts["zh-Hant"]?.[key] ?? zh[key] ?? key;
      } else if (lang.startsWith("zh")) {
        s = zh[key] ?? key;
      } else {
        s = dict?.[key] ?? en[key] ?? ZH2EN[key] ?? key;
      }
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      return s;
    },
  };
}