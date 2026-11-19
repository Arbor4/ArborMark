<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>

<h1 align="center">ArborMark（简筑）</h1>

<p align="center">本地优先的桌面级所见即所得 Markdown 编辑器</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.es.md">Español</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/tauri-2-FFC131.svg" alt="Tauri">
  <img src="https://img.shields.io/badge/version-4.0.1-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark 主窗口：左侧文件树，右侧所见即所得编辑区">
</p>

***

## 简介

ArborMark（中文名：简筑）是一款现代、轻量、高性能的桌面级所见即所得 Markdown 编辑器。后端采用 **Tauri 2 + Rust** 构建原生基座，前端采用 **React 19 + Milkdown（ProseMirror）** 实现流畅的即时渲染，源码模式则配备了专业的 **CodeMirror 6** 纯文本引擎。

它将 Markdown 的轻便纯粹与富文本排版的即时反馈融为一体：边输入边呈现精美版面，随时按下快捷键（`⌘/Ctrl + /`）即可无缝切换到纯代码模式。所有数据以标准 `.md` 文件纯本地落盘——**零账号绑定、零数据上传、永久属于你自己**。

* 仓库：<https://github.com/Arbor4/ArborMark>
* 问题反馈：<https://github.com/Arbor4/ArborMark/issues>
* 最新下载：<https://github.com/Arbor4/ArborMark/releases>

---

## 核心优势

| 指标 / 维度 | ArborMark（简筑） | 传统 Electron Markdown 编辑器 | 带来收益 |
| :--- | :--- | :--- | :--- |
| **安装包体积** | **~15 MB** | 120 MB ~ 180 MB | 🚀 **缩小 90%**，秒级下载安装，不占磁盘 |
| **内存开销** | **~50 MB - 80 MB** | 300 MB ~ 600 MB+ | 🍃 极致省电轻快，多开窗口、后台长驻毫无负担 |
| **启动速度** | **< 300 ms** 毫秒级闪启 | 2 秒 ~ 4 秒冷启动 | ⚡ 双击即开，随时记录突发灵感 |
| **本地优先** | **100% 纯本地离线** | 强制联网登录 / 依赖云端同步 | 🔒 隐私绝对安全，数据脱敏，杜绝泄露 |
| **双核引擎** | **Milkdown (ProseMirror) + CodeMirror 6** | 虚拟 DOM 单一视图或 Webview 分屏渲染 | 🎨 即时排版与专业代码编辑两者兼得 |
| **多窗口架构** | **原生多窗口 (⌘⇧N)** | 多标签卡顿或多实例内存翻倍 | 🪟 多文档独立开辟视口，并行参考写作 |

---

## 亮点功能

### 1. 沉浸写作与极致手感
* **双模瞬时切换**：所见即所得渲染态与纯文本源码态通过 `⌘/`（或 `Ctrl+/`）无缝切换，光标行号平滑对齐。
* **打字机模式**：输入时光标始终智能居中于屏幕垂直中线，视线无需上下疲劳追逐。
* **专注模式**：淡化非当前聚焦段落，高亮正在编辑的文字块，心无旁骛深度码字。
* **未选中时复制/剪切整行**：光标处无需费力划选，按 `⌘C` / `Ctrl+C` 自动复制当前整行，按 `⌘X` / `Ctrl+X` 自动剪切并删除整行（深度复刻 Typora / VS Code 直觉）。
* **Ctrl/⌘ + 鼠标滚轮缩放**：按住修饰键滚动鼠标滚轮，以 1px 步进平滑无级缩放字号（12px ~ 28px）。
* **智能成对匹配**：括号、引号、以及 Markdown 标记（`*`、`~`、`$`）自动闭合补全。

### 2. 强大的表格与数学公式
* **交互式表格工具条**：悬浮工具栏提供一键添加/删除行、添加/删除列、清空与删除表格。
* **拖拽排版**：支持鼠标拖拽直观调整表格列宽，支持拖拽重排行列顺序。
* **KaTeX 原位数学公式**：行内 `$LaTeX$` 与块级 `$$LaTeX$$` 极速渲染；点击公式即可原位唤起 TeX 源码编辑，按 `Esc` 重新渲染；支持公式自动编号。

### 3. 图表渲染与图片资产
* **Mermaid 与主流图表**：内置 Mermaid 引擎，原生支持流程图、时序图、类图、甘特图、状态图；自动读取 viewBox 保持原生宽高比，杜绝过大失真或留白。
* **图片自动落盘策略**：支持拖拽或粘贴图片直接落盘，提供多种落盘目录策略（当前目录 `./`、`./assets`、`./${filename}.assets`、自定义目录）；相对路径优先并自动 URL 特殊字符转义。
* **内置图片灯箱与 PDF 预览**：点击图片即刻呼出全功能灯箱，支持滚轮/双指平滑缩放、双击还原与自适应窗口；原生支持内嵌 PDF 预览。

### 4. 深度对齐 Typora 的偏好设置系统
* **独立的 7 大设置面板**：文件、外观、编辑器、Markdown、图像、导出与通用设置。
* **换行符标准定制**：自由选择换行符偏好（`LF (Unix/macOS)` 或 `CRLF (Windows)`），保存文件时严格遵循。
* **新文件默认扩展名**：新建文档未输后缀时自动按偏好补全 `.md` 或 `.markdown`。
* **保存与历史管理**：支持切换文件自动保存修改、停止输入 0.8s 自动保存、一键清除最近文件与历史目录记录、一键出厂恢复默认设置。

### 5. 组织导航与导出生态
* **大纲与全速搜索**：支持各级标题折叠与展开、正文滚动联动大纲高亮（ScrollSpy）；毫秒级快速打开（`⌘P`）与跨目录全局正则查找替换（`⌘⇧F`）。
* **开放主题商店**：内置包含 **Liquid Glass**、Lucid Light 等精选主题；主题基于 CSS 变量完全解耦，支持导出模板与一键导入自定义主题。
* **全格式导出**：一键导出高质量 PDF、带完整样式的单文件 HTML、纯净语义 HTML；支持检测 Pandoc CLI 扩展导出 Word (`.docx`)、EPUB、LaTeX。
* **全球化多语言**：内置简体中文、繁體中文、English、日本語、한국어、Deutsch、Français、Español 等 16+ 种语言界面与系统原生菜单栏无缝同步。

---

## 功能一览表

| 模块 | 核心能力 |
| :--- | :--- |
| **即时渲染** | 所见即所得排版；标题、列表、引用、表格、代码块、公式与图表均支持原位点击编辑 |
| **源码双模** | CodeMirror 6 纯文本编辑，吸顶实色行号槽、代码折叠与语法高亮，`⌘/Ctrl + /` 秒级无缝切换 |
| **轻量性能** | 安装包仅 ~15MB，待机内存仅 ~60MB，冷启动 <300ms，超长文档虚拟视口与延迟渲染 |
| **手感打磨** | 打字机模式、专注模式、无选区整行复制/剪切、Ctrl/⌘ 滚轮字号缩放、智能配对符号 |
| **表格增强** | 悬浮行列工具条；原位增删行列、拖拽调整列宽与重排列/行 |
| **数学与图表** | KaTeX 行内/块级 LaTeX 公式原位编辑与自动编号；Mermaid 流程图/时序图保持自适应宽高比 |
| **图片与 PDF** | 拖拽粘贴自动落盘、多种附件路径规则；应用内缩放灯箱查看器、PDF 原位预览 |
| **偏好设置** | 完整对齐 Typora：文件/外观/编辑器/Markdown/图片/导出/通用 7 大分类，支持 LF/CRLF 与出厂重置 |
| **多窗口支持** | 原生独立多窗口工作流（`⌘⇧N`），多个工程/文档分屏或分桌面并行编辑互不干扰 |
| **文件与大纲** | 文件夹树、平铺列表、章节大纲折叠与滚动高亮跟踪、快速打开（`⌘P`）、全局正则替换（`⌘⇧F`） |
| **导入与导出** | 一键导出高质量 PDF、自包含单文件 HTML、纯净 HTML；支持系统 Pandoc 扩展导出 Word / EPUB / LaTeX |
| **主题与生态** | 内置多套精选主题（含 macOS 经典 **Liquid Glass**）+ 用户自定义 CSS/JSON 主题热重载 |
| **国际化多语言** | 简中、繁中、English、日本語、한국어、Deutsch 等 16+ 种语言界面与原生系统菜单联动 |
| **数据安全** | 切换文件自动保存、输入微防抖持久化、脏标记实时追踪、纯本地存储拒绝云端绑定 |

## 下载安装

从 [Releases](https://github.com/Arbor4/ArborMark/releases) 获取对应平台安装包：

* macOS：`.dmg` / `.app`
* Windows：NSIS 安装包（标准版与离线 WebView2 版）
* Linux：`.AppImage` / `.deb`

macOS 首次启动若被 Gatekeeper 拦截，请在 **系统设置 → 隐私与安全性** 中允许运行。

## 开发

### 环境要求

* Node.js **20+**、npm 10+
* Rust **stable** 工具链（`rustup`，edition 2021）
* macOS / Windows / Linux（Linux 需 WebKitGTK 4.1 / GTK 3 开发包）

### 本地运行

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install                 # 根目录：Tauri CLI
npm install --prefix src/web

npm run dev                 # tauri dev：Vite 开发服务器 + 原生外壳
# 或仅在浏览器中跑前端：
npm run web:dev
```

### 检查与测试

```bash
npm run web:build           # 类型检查（tsc --noEmit）+ Vite 生产构建
npm --prefix src/web run typecheck
(cd src-tauri && cargo test)   # Rust 单元测试
```

### 打包

```bash
npm run dist:mac       # macOS app + dmg
npm run dist:win       # Windows nsis（含离线 WebView2 版）
npm run dist:linux     # Linux deb + AppImage
```

## 项目结构

```text
ArborMark/
├── src/
│   └── web/                 # React 前端（Vite）
│       └── src/
│           ├── components/  # 编辑器（Milkdown/CodeMirror）、文件、大纲、设置、放大查看
│           ├── stores/      # Zustand 状态：workspace、ui、find、lightbox、search
│           ├── bridge/      # 与 Rust 后端通信的 IPC / fs / i18n 桥
│           ├── theme/       # 主题契约、内置预设、注册表
│           └── styles/      # 设计 token + 组件样式
├── src-tauri/               # Rust 后端（Tauri 2）
│   └── src/
│       ├── ipc/             # IPC 域：fs、images、export、shell、settings 等
│       ├── menu.rs          # 原生菜单 +  parity 同步
│       ├── protocol.rs      # arbormark:// 自定义协议（本地文件服务）
│       └── lib.rs           # 应用装配、窗口与拖拽接线
├── resources/               # 应用图标与安装包资源
├── tools/                   # 图标生成等辅助脚本
└── docs/                    # 架构文档与截图
```

更多模块细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 设计说明

* **本地优先**：文档、图片、主题、设置默认都在本机。
* **纯文本**：一切以标准 Markdown 保存，可在任何编辑器打开。
* **可主题化**：主题是 token 集（CSS/JSON），放入用户主题目录即自动发现。
* **默认安全**：webview 通过窄 IPC 面与 Rust 通信；本地文件经受控自定义协议服务。
* **性能**：图表等重节点视图在视口附近延迟渲染；长图原位滚动。

应用内 **帮助 → Markdown 功能示例** 可打开内置全功能示例，源文件见 [markdown-full-demo.md](src/web/src/bridge/demo/markdown-full-demo.md)。

## 参与贡献

欢迎 Issue 与 Pull Request。

1. Fork 仓库并创建分支：`feat/your-feature` 或 `fix/your-fix`。
2. 提交前运行相关检查（`npm run web:build`、`cargo test`）。
3. 使用语义化提交信息，例如：
   * `feat(editor): 支持新的代码块语言`
   * `fix(export): 修复 PDF 导出丢失图片`
4. 描述改动与测试方式，UI 改动请附截图。

提交贡献即表示同意以本项目的开源许可证授权。

## 许可证

ArborMark 以 **GNU General Public License v3.0 or later（GPL-3.0-or-later）** 发布。

你可以自由使用、复制、修改、分发（含商用）。copyleft 要求：**若分发衍生作品，必须同样以 GPL-3.0-or-later 公开完整源码**。软件不提供任何担保。

完整文本见 [LICENSE](LICENSE)。

## 第三方组件

ArborMark 建立在以下优秀开源项目之上：

* [Tauri](https://tauri.app/) 与 [Rust](https://www.rust-lang.org/)（MIT / Apache-2.0）
* [React](https://react.dev/)（MIT）
* [Milkdown](https://milkdown.dev/) / [ProseMirror](https://prosemirror.net/)（MIT）
* [CodeMirror](https://codemirror.net/)（MIT）
* [KaTeX](https://katex.org/)（MIT）
* [Mermaid](https://mermaid.js.org/)（MIT）
* [highlight.js](https://highlightjs.org/)（BSD-3-Clause）
* [DOMPurify](https://github.com/cure53/DOMPurify)（Apache-2.0 / MPL-2.0）

完整版权与许可信息见各依赖的 LICENSE 文件。

## 免责声明

ArborMark 是独立开源项目，与任何商业 Markdown 编辑器无关联、未获其背书或赞助。项目名称、图标与界面资产为原创或经授权使用；第三方组件归各自作者所有。

如认为本项目内容侵犯您的权益，请通过 [Issues](https://github.com/Arbor4/ArborMark/issues) 联系。

***

Copyright © 2026 Arbor · ArborMark contributors