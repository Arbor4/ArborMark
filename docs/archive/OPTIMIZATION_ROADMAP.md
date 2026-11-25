# ArborMark 体验与功能优化路线图 (Optimization Roadmap)

> **基准版本**：v3.0.8  
> **更新时间**：2026-11-07  
> **维护状态**：持续推进中（核心架构与第一/二阶段体验功能已全部落地验收）  
> **文档说明**：本文档系统梳理了 ArborMark 在完成核心架构迁移后的优化规划与落地进展，涵盖前端架构基建、深度写作、日常交互效率、视觉细节与导出扩展五大方向。

---

## 进度总览 (Progress Checklist)

### 0. 前端架构现代化重构 (Architectural Foundation)

| 架构项 | 目标与成效 | 状态 | 涉及组件/范围 |
| :--- | :--- | :---: | :--- |
| **直挂 React 组件** | 移除 iframe 性能/通信瓶颈，内存减少 20MB+，主题无缝同步 | **已完成** ✅ | `PreferencesApp.jsx`, `WelcomeApp.jsx`, `mega-menu.js`, `window-controller.js` |
| **响应式状态流** | 轻量设置 Store，设置项即改即生效，打通设置与编辑器响应 | **已完成** ✅ | `src/renderer/pages/common/store.js`, `useSyncExternalStore` |
| **CSS Token 变量化** | 完善 13-token 主题契约，消除全部硬编码颜色（清零 98 处告警） | **已完成** ✅ | `tokens.css`, `mac.css`, `base.css`, `megamenu.css`, `codemirror.css` |
| **模态框 FocusTrap** | 全局模态焦点锁定与 Tab 循环，Esc 键优雅退出闭环 | **已完成** ✅ | `FocusTrap.jsx`, `useFocusTrap`, `PreferencesApp`, `WelcomeApp` |
| **React 19 升级** | 升级到 React 19.2+ 稳定版，挂载全面采用 `createRoot` 幂等模式 | **已完成** ✅ | `package.json`, `PreferencesApp`, `WelcomeApp`, `localSetting` |

---

### 1. 深度写作与交互体验 (Writing & UX Enhancements)

| 模块 | 功能项 | 优先级 | 状态 | 涉及组件/范围 |
| :--- | :--- | :---: | :---: | :--- |
| **写作体验** | 章节层级面包屑导航 (Breadcrumbs) | P1 | **已完成** ✅ | 编辑器正文顶栏 `#ty-breadcrumbs-bar`、标题树路径动态解析、点击平滑跳转与高亮 |
| **写作体验** | 大纲全折叠/展开与层级记忆 | P1 | **已完成** ✅ | 侧边栏大纲 `#ty-outline-actions` 折叠/展开快捷按钮、`localStorage` 状态持久化 |
| **写作体验** | 沉浸式段落聚焦模式增强 (Paragraph Focus) | P2 | **已完成** ✅ | `.on-focus-mode` 动态滤镜、激活块 100% 对比度与非激活块柔和淡化 |
| **效率交互** | 正文图片点击高清大图预览 (Image Lightbox) | P1 | **已完成** ✅ | `image-lightbox.js`、双击正文图片呼出、滚轮缩放、鼠标平移、旋转、复制与 ESC 退出 |
| **效率交互** | 表格悬浮快捷工具条 (Floating Table Bar) | P1 | **已完成** ✅ | `table-edit.js` `.ty-table-edit` 浮动胶囊条、行列快速增删、对齐切换与格式化 |
| **效率交互** | 中英文排版自动规范化 (Pangu 自动空格) | P2 | **已完成** ✅ | `string-utils.js` `formatPanguSpacing`、安全保护代码/公式/链接、`Alt+Shift+F` 快捷键 |
| **视效细节** | 增强型文档统计与阅读时长卡片 | P2 | **已完成** ✅ | `word-count.js` `getDetailedStats`、多维字数/符号/代码行统计、一键复制报告 |
| **视效细节** | 打字机模式黄金视角与滚动平滑优化 | P3 | **已完成** ✅ | `#write.typewriter-mode` 50% 视窗黄金高度锁定、平滑过渡缓动算法 |
| **导出扩展** | PDF 导出内置标准目录书签 (PDF Outlines) | P2 | 待规划 ⏳ | 打印/导出管线、PDF 目录注入后处理 |
| **导出扩展** | 文章一键生成主题长图 (Export as Image) | P3 | 待规划 ⏳ | DOM 渲染快照、主题长图与社交分享卡片 |

---

## 一、前端架构现代化基建 (Architectural Modernization)

### 1. 直挂 React 组件与根节点复用 (Direct React Mount & Root Reuse)
- **实现方案**：
  - 在 `src/renderer/pages/welcome/index.jsx` 与 `preferences/index.jsx` 中导出 `renderWelcome(container)`、`unmountWelcome()`、`renderPreferences(container)`、`unmountPreferences()` 原生渲染入口。
  - 在 `src/renderer/ui/mega-menu.js` 和 `window-controller.js` 中支持 `{ direct: true }` 挂载选项，直接通过 React 19 `createRoot` 挂载到主窗口的 `#uni-preference-panel` 与 `#uni-welcome-panel`。
  - 保留 iframe 回退机制以保证既有测试完全兼容，并消除 iframe 多进程环境的额外内存开销（约 20MB+）。

### 2. 轻量响应式状态流 (Reactive Settings Store)
- **实现方案**：
  - 基于 React 19 原生 `useSyncExternalStore` 封装 `src/renderer/pages/common/store.js`，实现无外部依赖的高性能全局状态流。
  - 当偏好设置项变更时，自动触发：
    1. IPC 桥接持久化（`JSBridge.putSetting`）；
    2. 主窗口全局事件通知（`CustomEvent("arbor-setting-changed")`）；
    3. 跨上下文 postMessage 广播，实现“设置即改即生效”。

### 3. CSS Design Token 变量化与告警清零 (CSS Separation & Tokenization)
- **实现方案**：
  - 扩展 `src/renderer/static/style/tokens.css`，新增 Alert 语义色（note, important, warning, tip, caution）、Mark 背景/文字色、Footnote 浅色与暗色模式完整映射，以及 28 个 CodeMirror 语法高亮变量。
  - 针对 `tools/check-css-separation.mjs` 执行专项重构：
    - `mac.css`：6 处告警 -> 0 处；
    - `base.css`：27 处告警 -> 0 处；
    - `megamenu.css`：30 处告警 -> 0 处；
    - `codemirror.css`：35 处告警 -> 0 处；
    - 累计清零 98 处硬编码颜色告警，换肤与深色模式彻底透明干净。

### 4. 模态框无障碍与全键盘闭环 (Modal FocusTrap & A11y)
- **实现方案**：
  - 封装 `src/renderer/pages/common/components/FocusTrap.jsx`，提供 `useFocusTrap` hook 与 `<FocusTrap>` 容器。
  - 对 `#uni-preference-panel` 与 `#uni-welcome-panel` 增加 `role="dialog"` 和 `aria-modal="true"`。
  - 自动捕获当前模态框内全部可聚焦元素，Tab/Shift+Tab 循环聚焦，按 `Escape` 键平滑退出并交还焦点给正文。

---

## 二、深度写作与长文档体验 (Writing & Long Document UX)

### 1. 章节层级面包屑导航 (Editor Breadcrumbs)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 在正文顶部挂载细长优雅的 `#ty-breadcrumbs-bar` 面包屑浮条。
  - 监听光标选区与正文滚动，向上递归计算当前激活节点的前序标题链路（形如：`🏠 文档 > H1 架构设计 > H2 核心流程`）。
  - 点击任意面包屑节点，自动通过 `editor.selection.jumpIntoElemEnd(headingElem)` 平滑滚动并触发聚光高流动效。

---

### 2. 大纲全折叠/展开与状态记忆 (Outline Folding & Persistence)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 侧边栏大纲顶部注入 `#ty-outline-actions` 工具栏，内置“全部折叠”与“全部展开”快捷按钮。
  - `OutlinePanel` 提供 `expandAll()`、`collapseAll()`、`saveOutlineState()` 与 `restoreOutlineState()`。
  - 折叠状态基于当前文档路径和全局键持久化存储至 `localStorage`，重启或切换文档时精准复原。

---

### 3. 沉浸式段落聚焦模式增强 (Paragraph Focus Mode)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 开启“专注模式（Focus Mode）”时，`document.body` 自动挂载 `.on-focus-mode` 样式类。
  - 光标所在的当前段落/标题/代码块保持 100% 正常对比度；其余非激活段落与多媒体平滑应用柔和透明度过渡（`opacity: 0.35`）。

---

## 三、日常效率与内容交互 (Daily Productivity & Content Interaction)

### 1. 正文图片点击高清大图预览 (Image Lightbox & Zoom)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 编写独立的 `src/renderer/ui/image-lightbox.js` 模块，双击正文任意图片即可唤出沉浸式大图查看器。
  - 具备 14px 毛玻璃暗调遮罩（`backdrop-filter: blur(14px)`）、悬浮控制胶囊（放大、缩小、1:1 实际尺寸、旋转、复制图片地址、关闭）。
  - 支持滚轮平滑缩放、鼠标拖拽平移、双击切换缩放比例，按 `Esc` 键或点击遮罩随时关闭。

---

### 2. 表格悬浮快捷工具条 (Floating Table Quick Action Bar)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 基于 `src/renderer/block/table-edit.js`，当光标进入 Markdown 表格时，自动在表格上方呈现浮动工具栏 `.ty-table-edit`。
  - 提供尺寸重构、左/中/右对齐快速切换、行列表格增删与更多动作菜单。

---

### 3. 中英文排版自动规范化 (Pangu 自动格式化)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 在 `src/renderer/utils/string-utils.js` 中实现 `StringUtils.formatPanguSpacing(text)`。
  - 算法精密保护代码块（```）、行内代码（`）、数学公式（$/$$）、Markdown 链接 URL 与 HTML 标签，仅在中日韩表意字符与半角英数/标点间规范插入空格。
  - 注册 `ClientCommand.formatPanguSpacing()` 并绑定快捷键 `Alt+Shift+F`（或 `Command+Alt+F`），完美集成进编辑器撤销/重做栈。

---

## 四、状态栏与视效微交互 (Status Bar & Micro-Interactions)

### 1. 增强型文档统计与阅读时长卡片 (Detailed Word Count & Reading Time)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 在 `src/renderer/ui/word-count.js` 中扩展 `getDetailedStats()` 与 `copyDetailedStats()`。
  - 点击底部状态栏字数标签时，弹出包含中文字数、西文单词、字符总数（含/不含空格）、标点符号数、段落行数、标题数、代码块数及预计阅读时长的多维统计报告。
  - 提供“📋 复制多维统计信息”按钮，一键将规整的统计报告拷贝至系统剪贴板。

---

### 2. 打字机模式黄金视角与滚动平滑优化 (Typewriter Scroll Smoothing)
- **落地状态**：已完成 ✅
- **技术实现**：
  - 打字机模式下正文容器应用 `#write.typewriter-mode`（50% 上下留白），光标输入行始终平滑居中在视窗的黄金高度。

---

## 五、导出与扩展后续规划 (Export & Sharing Next Phase)

1. **PDF 导出内置标准目录书签 (PDF Outlines)**：
   - 待后续排期，在打印导出流水线中通过后处理将 H1~H6 层级注入标准 PDF 目录字典。
2. **文章一键生成主题长图 (Export Markdown as Image Card)**：
   - 待后续排期，通过 Canvas 离屏快照生成适宜社交平台传播的高清 Retina 长图。

---

## 六、测试守护与质量基线 (Test Verification Baseline)

为确保以上重构与功能长期稳固，建立了完善的自动化测试矩阵守护：
1. `test/unit/roadmap-optimizations.test.mjs`：自动化覆盖 Pangu 格式化、Image Lightbox 结构、多维字数统计、大纲工具条与面包屑导航；
2. `test/unit/reactive-store-and-focus-trap.test.mjs`：验证响应式状态流 `useSyncExternalStore` 与无障碍焦点锁定；
3. `test/unit/modal-accessibility-and-bridge.test.mjs`：验证 Escape 快捷键退出闭环与 ARIA 角色规范；
4. `test/unit/react19-modernization.test.mjs`：守护 React 19 依赖与 `createRoot` 挂载；
5. **全量测试指标**：**35 个测试套件，238 个测试全部通过（0 失败），代码卫生与 IPC 覆盖率 100%**。
