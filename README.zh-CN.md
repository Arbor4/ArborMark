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
  <img src="https://img.shields.io/badge/version-4.0.0-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark 主窗口：左侧文件树，右侧所见即所得编辑区">
</p>

***

## 简介

ArborMark（中文名：简筑）是一款独立的桌面 Markdown 编辑器，后端采用 **Tauri 2 + Rust**，前端采用 **React + Milkdown（ProseMirror）**，源码模式使用 **CodeMirror 6**。

它把 Markdown 的简洁与富文本编辑器的即时性结合在一起：边写边渲染，一个快捷键（⌘/Ctrl + /）即可切换到纯文本源码模式。文档始终以标准 `.md` 文件保存在本地——无锁定、无需账号。

* 仓库：<https://github.com/Arbor4/ArborMark>
* 问题反馈：<https://github.com/Arbor4/ArborMark/issues>
* 下载：<https://github.com/Arbor4/ArborMark/releases>

## 功能特性

| 特性 | 说明 |
| :--- | :--- |
| 所见即所得 | 边写边渲染；标题、表格、公式、图表、代码块均支持原位点击编辑 |
| 双模源码 | CodeMirror 6 纯文本编辑，吸顶行号槽、代码折叠与语法高亮，⌘/Ctrl + / 秒级切换 |
| 文件与导航 | 文件夹树、平铺列表、标题大纲、快速打开（⌘P）、全局搜索（⌘⇧F） |
| 偏好设置系统 | 独立的文件、外观、编辑器、Markdown、图像、导出与通用设置，支持换行符（LF/CRLF）、默认扩展名与出厂重置 |
| 高频编辑增强 | 无选区时整行复制/剪切（⌘C / ⌘X）、按住 Ctrl/⌘ 鼠标滚轮缩放字号、成对符号智能匹配 |
| 表格增强 | 悬浮行列工具条；原位增删行列、拖拽调整列宽与重排行列 |
| 数学公式 | KaTeX 行内与块级 LaTeX，原位点击编辑 TeX 代码，可选公式自动编号 |
| 图表 | Mermaid、Flowchart.js、Sequence 原位编辑与自适应比例渲染，长文延迟渲染 |
| 图片与 PDF | 拖拽与粘贴落盘、相对路径偏好；应用内缩放查看器、双击还原、PDF 预览 |
| 多窗口支持 | 原生独立多窗口工作流（⌘⇧N），多任务互不干扰 |
| 导入导出 | PDF / HTML（含样式/纯净）导出；安装 Pandoc 后支持 Word / EPUB / LaTeX 转换 |
| 主题系统 | 多套精选内置主题（含 **Liquid Glass**）+ 用户 CSS/JSON 自定义主题热加载 |
| 全球多语言 | 简体中文、繁體中文、English、日本語、한국어、Deutsch 等 16+ 种语言界面与原生菜单同步 |
| 安全保存 | 切换文件自动保存、输入微防抖落盘、脏标记追踪、本地文件崩溃安全 |
| 命令行与拖拽 | 命令行或拖拽文件/文件夹到应用即可快速打开或导入 |

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