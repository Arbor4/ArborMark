/**
 * 浏览器开发模式的内存文件系统。
 * 让 `npm run dev` 在无 Tauri 的浏览器里也能完整体验：
 * 文件树、拖拽、新建/重命名/删除、搜索、主题、设置全部可用。
 * 种子内容是一份真实的 ArborMark 使用文档。
 */
import MARKDOWN_FULL_DEMO from "./demo/markdown-full-demo.md?raw";

interface MockNode {
  path: string;
  name: string;
  isDir: boolean;
  content: string;
  mtime: number;
}

const ROOT = "/ArborMark 演示";
const nodes = new Map<string, MockNode>();
const settings = new Map<string, unknown>();

function join(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}
function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}
function now(): number {
  return Date.now();
}

function seedFile(path: string, content: string, ageMinutes = 0) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  nodes.set(path, { path, name, isDir: false, content, mtime: now() - ageMinutes * 60000 });
}
function seedDir(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  nodes.set(path, { path, name, isDir: true, content: "", mtime: now() });
}

/* ── 种子文档 ─────────────────────────────────────────────────────────────── */

const WELCOME = `# 欢迎使用 ArborMark 🌲

ArborMark 是一款**轻量、现代**的 Markdown 编辑器。左侧是文件库，右侧是你的文字。

> 写作应该是心流，而不是与工具搏斗。

## 三分钟上手

1. 在左侧文件栏点击 \`+\` 新建文件，或直接把文件拖进来
2. 用 \`#\` 开始一个标题，用 \`-\` 开始一个列表
3. 按 \`⌘/Ctrl + S\` 保存，按 \`⌘/Ctrl + P\` 快速打开文件

## 它支持什么

- [x] 标准 Markdown 与 GFM 扩展
- [x] 任务列表（点一下复选框试试）
- [ ] 你的下一篇大作
- [ ] 以及再下一篇

### 代码高亮

\`\`\`typescript
interface Theme {
  id: string;
  name: string;
  tokens: Record<string, string>;
}

function applyTheme(theme: Theme) {
  for (const [key, value] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(key, value);
  }
}
\`\`\`

### 表格

| 功能 | 快捷键 | 说明 |
| ---- | ------ | ---- |
| 快速打开 | ⌘P | 模糊搜索文件名 |
| 全局搜索 | ⌘⇧F | 在所有文件中搜索 |
| 切换视图 | ⌘/ | 源码 / 即时渲染 |
| 专注模式 | ⌘⇧D | 淡化非当前段落 |

### 数学公式

行内公式 $E = mc^2$，以及块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

### 图表

流程图（Mermaid 即时渲染，点击可回到源码编辑）：

\`\`\`mermaid
graph TD
    A[打开文档] --> B{是否 Markdown?}
    B -->|是| C[即时渲染]
    B -->|否| D[源码模式]
    C --> E[所见即所得]
    D --> E
\`\`\`

时序图：

\`\`\`mermaid
sequenceDiagram
    participant U as 用户
    participant E as 编辑器
    participant R as 渲染器
    U->>E: 输入 Markdown
    E->>R: 解析语法树
    R-->>E: 返回渲染块
    E-->>U: 即时呈现
\`\`\`

### 图片

![ArborMark 示意](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='480'%20height='180'%3E%3Crect%20width='480'%20height='180'%20rx='14'%20fill='%233d7a4f'/%3E%3Ctext%20x='240'%20y='100'%20font-size='28'%20fill='white'%20text-anchor='middle'%20font-family='sans-serif'%3EArborMark%3C/text%3E%3C/svg%3E)

### 引用与提示

> [!NOTE]
> 主题可以在 **设置 → 外观** 中切换，也可以导入你自己的主题 JSON。

> [!TIP]
> 把 \`.md\` 文件从系统文件管理器拖进侧边栏，即可移动或导入。

---

*用 Markdown 写作，让排版自己发生。*
`;

const SHORTCUTS = `# 快捷键速查

## 文件

| 操作 | macOS | Windows / Linux |
| ---- | ----- | --------------- |
| 新建文件 | ⌘N | Ctrl+N |
| 保存 | ⌘S | Ctrl+S |
| 快速打开 | ⌘P | Ctrl+P |
| 全局搜索 | ⌘⇧F | Ctrl+Shift+F |

## 编辑

| 操作 | macOS | Windows / Linux |
| ---- | ----- | --------------- |
| 加粗 | ⌘B | Ctrl+B |
| 斜体 | ⌘I | Ctrl+I |
| 行内代码 | ⌘E | Ctrl+E |
| 切换视图 | ⌘/ | Ctrl+/ |
| 标题 1 ~ 6 | ⌘1 ~ ⌘6 | Ctrl+1 ~ 6 |
| 普通段落 | ⌘0 | Ctrl+0 |
| 专注模式 | ⌘⇧D | Ctrl+Shift+D |

## 侧边栏

- \`⌘⇧1\` 大纲面板
- \`⌘⇧2\` 文件面板
- \`⌘⇧F\` 全局搜索
- \`⌘\\\` 或 \`⌘⇧L\` 收起 / 展开侧边栏

> 在文件树中按住 **Shift** 点击可连选，按住 **⌘/Ctrl** 点击可多选；
> 选中后拖拽即可批量移动。
`;

const THEMING = `# 主题定制指南

ArborMark 的主题系统是**完全开放**的：每个主题只是一组设计 token。

## 主题结构

\`\`\`json
{
  "id": "my-theme",
  "name": "My Theme",
  "appearance": "auto",
  "light": {
    "--am-bg": "#ffffff",
    "--am-text": "#24292f",
    "--am-accent": "#0969da"
  },
  "dark": {
    "--am-bg": "#0d1117",
    "--am-text": "#f0f6fc",
    "--am-accent": "#4493f8"
  }
}
\`\`\`

## 核心 token

| Token | 作用 |
| ----- | ---- |
| \`--am-bg\` | 应用底色 |
| \`--am-bg-sidebar\` | 侧边栏背景 |
| \`--am-bg-editor\` | 编辑区背景 |
| \`--am-text\` | 正文颜色 |
| \`--am-accent\` | 强调色 |
| \`--am-border\` | 边框颜色 |

完整契约见 \`src/web/src/theme/contract.ts\`。

## 安装主题

1. 设置 → 外观 → 主题画廊 → **导入主题**
2. 或把 JSON / CSS 文件放入 \`userData/themes/\` 目录
3. 重启后自动识别

> [!IMPORTANT]
> 主题只负责外观。布局与交互由系统保证，任何主题下体验一致。

## 高级：扩展 CSS

主题可以携带一段作用于 \`[data-theme="my-theme"]\` 的 CSS，
用来做玻璃拟态、纸张纹理等 token 之外的质感：

\`\`\`css
[data-theme="my-theme"] body {
  background-image: radial-gradient(
    1000px 600px at 20% -10%,
    rgba(9, 105, 218, 0.08),
    transparent 60%
  );
}
\`\`\`
`;

const READING = `# 读书摘录

## 《设计中的设计》 · 原研哉

> 设计不是一种技能，而是捕捉事物本质的感觉能力和洞察能力。

- 再设计（Re-Design）：把日常用品回到原点重新审视
- 空（Emptiness）：容器因为空，才能容纳使用者的想象
- 感觉的领域：设计是五感的沟通

## 《禅与摩托车维修艺术》 · 波西格

> 当你做某件事的时候，一旦想要求快，就表示你再也不关心它，而想去做别的事。

关于「良质」（Quality）：

1. 良质先于主体与客体
2. 良质是主体与客体的共同源头
3. 用心与不用心，做出来的东西完全不同

## 待读

- [ ] 《建筑的复杂性与矛盾性》
- [x] 《阴翳礼赞》
- [ ] 《侘寂》
`;

const PLAN = `# 前端重构计划

## 目标

用 **React 19 + Vite + Tailwind CSS v4** 重建前端外壳，
编辑器保留高性能的 CodeMirror 6 岛。

## 架构分层

\`\`\`
src/web/
├── theme/      主题契约 · 内置主题 · 注册表
├── bridge/     Tauri IPC · 浏览器 mock
├── stores/     Zustand 状态（工作区 / UI / 搜索）
├── components/ 布局 · 文件 · 大纲 · 搜索 · 编辑器 · 设置
└── styles/     Tailwind 入口 + 编辑器排版
\`\`\`

## 里程碑

- [x] 设计 token 契约
- [x] 主题注册表与画廊
- [x] 文件树（拖拽 / 多选 / 重命名）
- [x] CodeMirror 混合渲染
- [ ] 导出 PDF
- [ ] 多窗口同步

## 风险

> [!WARNING]
> 旧版 window.html 的 jQuery 事件链不能与新外壳并存，
> 迁移期间只保留一条渲染路径。

| 模块 | 状态 | 负责人 |
| ---- | ---- | ------ |
| 外壳 | ✅ 完成 | Arbor |
| 编辑器 | ✅ 完成 | Arbor |
| 主题 | ✅ 完成 | Arbor |
`;

const README = `# ArborMark

轻量、现代的 Markdown 编辑器。

## 特性

- 🌲 文件库：树形 / 列表视图，拖拽整理
- 📑 大纲：标题导航，随光标定位
- 🔍 搜索：全局内容搜索与替换
- 🎨 主题：token 化设计系统，人人可定制
- ⚡ 编辑器：CodeMirror 6，大文档不卡顿

## 开发

\`\`\`bash
npm install
npm run dev        # 浏览器开发模式（内置演示文件）
npm run tauri dev  # 桌面应用
\`\`\`

## 许可

GPL-3.0-or-later
`;

/* ── 代码演示文件 ─────────────────────────────────────────────────────────── */

const CODE_TS = `/** 主题注册表：内置 + 用户主题的加载与应用。 */
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./presets";

export interface ThemeTokens {
  [token: \`--am-\${string}\`]: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  appearance: "light" | "dark" | "auto";
  light?: ThemeTokens;
  dark?: ThemeTokens;
}

const listeners = new Set<() => void>();
let current = DEFAULT_THEME_ID;

export function applyTheme(id: string, dark: boolean): void {
  const theme = BUILTIN_THEMES.find((t) => t.id === id) ?? BUILTIN_THEMES[0];
  const tokens = { ...(dark ? theme.dark : theme.light) };
  const css = Object.entries(tokens)
    .map(([k, v]) => \`  \${k}: \${v};\`)
    .join("\\n");
  let style = document.getElementById("am-theme-vars");
  if (!style) {
    style = document.createElement("style");
    style.id = "am-theme-vars";
    document.head.appendChild(style);
  }
  style.textContent = \`:root {\\n\${css}\\n}\`;
  current = id;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
`;

const CODE_JS = `// 防抖与节流：编辑器自动保存的基础工具。
export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, limit = 100) {
  let waiting = false;
  return (...args) => {
    if (waiting) return;
    fn(...args);
    waiting = true;
    setTimeout(() => (waiting = false), limit);
  };
}

const save = debounce((doc) => localStorage.setItem("draft", doc), 800);
document.addEventListener("input", (e) => save(e.target.value));
`;

const CODE_PY = `"""统计 Markdown 文档的词数与阅读时长。"""
from __future__ import annotations
import re
from dataclasses import dataclass

CJK = re.compile(r"[一-鿿]")
WORD = re.compile(r"[A-Za-z0-9_'-]+")

@dataclass
class Stats:
    words: int
    chars: int
    minutes: int

def analyze(text: str) -> Stats:
    cjk = len(CJK.findall(text))
    latin = len(WORD.findall(text))
    words = cjk + latin
    return Stats(words=words, chars=len(text), minutes=max(1, round(words / 380)))

if __name__ == "__main__":
    sample = "用 Markdown 写作，让排版自己发生。Hello ArborMark!"
    print(analyze(sample))
`;

const CODE_RS = `//! 全局搜索：按文件名 + 内容扫描工作区，跳过构建产物。
use std::fs;
use std::path::Path;

const SKIP_DIRS: [&str; 4] = ["node_modules", ".git", "dist", "target"];

pub fn search(root: &Path, query: &str) -> Vec<String> {
    let mut hits = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
            } else if name.ends_with(".md") || name.ends_with(".rs") {
                if let Ok(text) = fs::read_to_string(&path) {
                    if text.contains(query) {
                        hits.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    hits
}
`;

const CODE_CSS = `/* 设计 token：所有颜色都从这里派生，主题只覆盖变量。 */
:root {
  --am-bg: #f6f5f1;
  --am-bg-editor: #fbfaf7;
  --am-text: #2a2e28;
  --am-accent: #3d7a4f;
  --am-border: rgba(42, 46, 40, 0.12);
  --am-radius: 8px;
}

[data-theme-mode="dark"] {
  --am-bg: #191c18;
  --am-bg-editor: #22261f;
  --am-text: #e4e7de;
  --am-accent: #7fc48d;
}

.editor {
  background: var(--am-bg-editor);
  color: var(--am-text);
  border-radius: var(--am-radius);
  transition: background-color 0.25s ease, color 0.25s ease;
}

.editor ::selection {
  background: color-mix(in srgb, var(--am-accent) 20%, transparent);
}
`;

const CODE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ArborMark · 预览</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="editor">
      <h1>你好，ArborMark </h1>
      <p>这是一个用于演示 <strong>代码高亮</strong> 与 <em>预览</em> 的页面。</p>
      <ul>
        <li>语义化 HTML</li>
        <li>token 化样式</li>
        <li>无障碍优先</li>
      </ul>
    </main>
    <script type="module" src="app.js"></script>
  </body>
</html>
`;

const CODE_JSON = `{
  "name": "arbormark-demo",
  "version": "4.0.3",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  }
}
`;

const CODE_CMD = `@echo off
rem ArborMark Windows 开发启动脚本
setlocal EnableDelayedExpansion
title ArborMark Dev

set "ROOT=%~dp0"
set "NODE_ENV=development"

if not exist "%ROOT%node_modules" (
  echo 安装依赖...
  call npm install
)

echo 启动开发服务器...
call npm run dev

endlocal
pause
`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3d7a4f"/>
      <stop offset="1" stop-color="#7fc48d"/>
    </linearGradient>
  </defs>
  <rect width="480" height="240" rx="20" fill="url(#g)"/>
  <g fill="#ffffff">
    <path d="M240 60l40 60h-24l34 52h-100l34-52h-24z" opacity="0.95"/>
    <rect x="232" y="172" width="16" height="26" rx="4"/>
  </g>
  <text x="240" y="222" font-size="24" fill="#ffffff" text-anchor="middle" font-family="sans-serif" font-weight="600">ArborMark</text>
</svg>
`;

const BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="0.5" stop-color="#5e5ce6"/>
      <stop offset="1" stop-color="#30d158"/>
    </linearGradient>
  </defs>
  <rect width="640" height="200" rx="16" fill="url(#a)"/>
  <circle cx="120" cy="60" r="46" fill="#ffffff" opacity="0.18"/>
  <circle cx="520" cy="150" r="70" fill="#ffffff" opacity="0.12"/>
  <text x="320" y="108" font-size="30" fill="#ffffff" text-anchor="middle" font-family="sans-serif" font-weight="700">Local-first Markdown</text>
</svg>
`;

const DEMO_MEDIA = `# 代码与图片演示

这个文档展示 ArborMark 对**代码文件**与**图片**的处理。

## 图片

相对路径引用 \`assets/\` 下的图片，单击编辑、双击放大：

![ArborMark Logo](../assets/logo.svg)

![渐变横幅](../assets/banner.svg)

![生成的位图](../assets/photo.png)

## 代码

打开左侧 \`代码/\` 目录下的任意文件，可看到对应语言的语法高亮：

\`\`\`typescript
const greet = (name: string): string => \`你好，\${name}\`;
console.log(greet("ArborMark"));
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

> [!TIP]
> 图片支持拖拽缩放与左 / 中 / 右对齐；代码文件以 CodeMirror 6 高亮编辑。
`;

function makePhotoPng(): string {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 360;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createLinearGradient(0, 0, 640, 360);
  grad.addColorStop(0, "#3d7a4f");
  grad.addColorStop(0.5, "#7fc48d");
  grad.addColorStop(1, "#b07d2a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 360);
  g.fillStyle = "rgba(255,255,255,0.25)";
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(80 + i * 100, 200 + (i % 2) * 60, 34 + (i % 3) * 12, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#ffffff";
  g.font = "600 34px sans-serif";
  g.textAlign = "center";
  g.fillText("ArborMark · 位图演示", 320, 120);
  return c.toDataURL("image/png");
}

function seed() {
  seedDir(ROOT);
  seedFile(join(ROOT, "欢迎.md"), WELCOME, 5);
  seedFile(join(ROOT, "README.md"), README, 60 * 24);
  seedDir(join(ROOT, "指南"));
  seedFile(join(ROOT, "指南/快捷键.md"), SHORTCUTS, 60 * 3);
  seedFile(join(ROOT, "指南/主题定制.md"), THEMING, 60 * 8);
  seedFile(join(ROOT, "指南/Markdown 全功能示例.md"), MARKDOWN_FULL_DEMO, 60 * 12);
  seedDir(join(ROOT, "笔记"));
  seedFile(join(ROOT, "笔记/读书摘录.md"), READING, 60 * 26);
  seedDir(join(ROOT, "项目"));
  seedFile(join(ROOT, "项目/重构计划.md"), PLAN, 30);
  // 代码演示
  seedDir(join(ROOT, "代码"));
  seedFile(join(ROOT, "代码/theme.ts"), CODE_TS, 40);
  seedFile(join(ROOT, "代码/app.js"), CODE_JS, 55);
  seedFile(join(ROOT, "代码/utils.py"), CODE_PY, 70);
  seedFile(join(ROOT, "代码/main.rs"), CODE_RS, 90);
  seedFile(join(ROOT, "代码/styles.css"), CODE_CSS, 110);
  seedFile(join(ROOT, "代码/index.html"), CODE_HTML, 130);
  seedFile(join(ROOT, "代码/package.json"), CODE_JSON, 150);
  seedFile(join(ROOT, "代码/dev.cmd"), CODE_CMD, 160);
  // 图片资源
  seedDir(join(ROOT, "assets"));
  seedFile(join(ROOT, "assets/logo.svg"), LOGO_SVG, 200);
  seedFile(join(ROOT, "assets/banner.svg"), BANNER_SVG, 210);
  seedFile(join(ROOT, "assets/photo.png"), makePhotoPng(), 220);
  // 综合演示
  seedDir(join(ROOT, "示例"));
  seedFile(join(ROOT, "示例/代码与图片.md"), DEMO_MEDIA, 15);
}
seed();

/* ── 通道实现 ─────────────────────────────────────────────────────────────── */

function listDir(path: string) {
  const prefix = path.replace(/\/+$/, "") + "/";
  const out: { name: string; path: string; isDir: boolean; size: number; mtime: number }[] = [];
  for (const node of nodes.values()) {
    if (node.path.startsWith(prefix) && node.path.slice(prefix.length).indexOf("/") === -1) {
      out.push({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        size: node.content.length,
        mtime: node.mtime,
      });
    }
  }
  out.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, "zh") : a.isDir ? -1 : 1,
  );
  return out;
}

function movePath(from: string, to: string): boolean {
  const node = nodes.get(from);
  if (!node || nodes.has(to)) return false;
  const affected = [...nodes.values()].filter(
    (n) => n.path === from || n.path.startsWith(from + "/"),
  );
  for (const n of affected) {
    nodes.delete(n.path);
  }
  for (const n of affected) {
    const next = to + n.path.slice(from.length);
    nodes.set(next, { ...n, path: next, name: next.slice(next.lastIndexOf("/") + 1) });
  }
  return true;
}

function searchContent(root: string, query: string, opts: Record<string, unknown>) {
  const caseSensitive = Boolean(opts.caseSensitive);
  const useRegexp = Boolean(opts.useRegexp);
  let re: RegExp;
  try {
    const source = useRegexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(source, caseSensitive ? "g" : "gi");
  } catch {
    return { files: [], error: "正则表达式无效" };
  }
  const files: unknown[] = [];
  for (const node of nodes.values()) {
    if (node.isDir || !node.path.startsWith(root + "/")) continue;
    if (!/\.(md|markdown|txt|ts|tsx|js|jsx|py|rs|css|html|json|svg)$/i.test(node.name)) continue;
    const lines = node.content.split("\n");
    const matches: unknown[] = [];
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) && matches.length < 40) {
        matches.push({ line: i + 1, text: line, start: m.index, end: m.index + m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    if (matches.length) {
      files.push({
        path: node.path,
        name: node.name,
        dir: parentOf(node.path).slice(root.length + 1) || ".",
        matches,
      });
    }
    if (files.length >= 60) break;
  }
  return { files };
}

const recentFolders: { path: string; name: string; pinned: boolean }[] = [
  { path: ROOT, name: "ArborMark 演示", pinned: true },
];

export async function mockInvoke(channel: string, payload: Record<string, unknown>): Promise<unknown> {
  const p = payload as Record<string, string>;
  switch (channel) {
    case "fs.readDir":
      if (!nodes.has(p.path)) throw new Error(`目录不存在: ${p.path}`);
      return listDir(p.path);
    case "fs.readFile": {
      const node = nodes.get(p.path);
      if (!node || node.isDir) throw new Error(`文件不存在: ${p.path}`);
      return node.content;
    }
    case "fs.writeFile": {
      const node = nodes.get(p.path);
      if (node) {
        node.content = p.content ?? "";
        node.mtime = now();
      } else {
        seedFile(p.path, p.content ?? "");
      }
      return true;
    }
    case "fs.stat": {
      const node = nodes.get(p.path);
      return node
        ? { exists: true, isDir: node.isDir, size: node.content.length, mtime: node.mtime }
        : { exists: false, isDir: false, size: 0, mtime: 0 };
    }
    case "fs.createDir":
      seedDir(p.path);
      return true;
    case "app.themeDir":
      return "/mock/userData/themes";
    case "app.homeDir":
      return "/mock";
    case "library.newFile": {
      if (nodes.has(p.path)) return false;
      seedFile(p.path, "");
      return true;
    }
    case "library.newFolder":
      seedDir(p.path);
      return true;
    case "library.renameFile":
    case "library.moveFile":
      return movePath(p.from ?? p.oldPath, p.to ?? p.newPath);
    case "library.duplicate": {
      const node = nodes.get(p.path);
      if (!node) return false;
      const ext = node.name.includes(".") ? node.name.slice(node.name.lastIndexOf(".")) : "";
      const stem = node.name.slice(0, node.name.length - ext.length);
      let candidate = join(parentOf(p.path), `${stem} 副本${ext}`);
      let i = 2;
      while (nodes.has(candidate)) candidate = join(parentOf(p.path), `${stem} 副本 ${i++}${ext}`);
      if (node.isDir) {
        for (const n of [...nodes.values()]) {
          if (n.path === p.path || n.path.startsWith(p.path + "/")) {
            const next = candidate + n.path.slice(p.path.length);
            nodes.set(next, { ...n, path: next, name: next.slice(next.lastIndexOf("/") + 1) });
          }
        }
      } else {
        seedFile(candidate, node.content);
      }
      return candidate;
    }
    case "library.trashItem": {
      for (const n of [...nodes.values()]) {
        if (n.path === p.path || n.path.startsWith(p.path + "/")) nodes.delete(n.path);
      }
      return true;
    }
    case "library.getRecentFolders":
      return { folders: recentFolders };
    case "setting.askForClearRecentDocuments":
    case "setting.askForClearRecentLocations":
      recentFolders.length = 0;
      return true;
    case "library.addRecentFolder":
    case "setting.addRecentFolder": {
      const path = p.path;
      if (!recentFolders.some((f) => f.path === path)) {
        recentFolders.unshift({ path, name: path.slice(path.lastIndexOf("/") + 1), pinned: false });
      }
      return true;
    }
    case "search.content":
    case "globalSearch.query":
      return searchContent(p.root ?? ROOT, p.query ?? "", payload);
    case "dialog.showOpenDialog":
      return { canceled: false, filePaths: [ROOT] };
    case "setting.loadAll":
      return Object.fromEntries(settings);
    case "setting.put":
      settings.set(p.key, payload.value);
      return true;
    case "setting.setCurTheme":
      settings.set("curTheme", p.theme ?? p.name);
      return true;
    case "theme.setThemeSource":
      return true;
    case "shell.showItemInFolder":
    case "shell.openExternal":
    case "shell.openItem":
      return true;
    case "window.setTitle":
      if (typeof document !== "undefined") document.title = p.title ?? "ArborMark";
      return true;
    default:
      return null;
  }
}

export const MOCK_ROOT = ROOT;