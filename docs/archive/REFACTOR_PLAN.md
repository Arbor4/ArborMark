# ArborMark 单窗口现代化与架构重构执行计划 (Refactor Plan)

> **目标**：贯彻单一主窗口架构，清理历史冗余独立窗口（许可证、欢迎页），将偏好设置重构成现代化、跨平台统一（无需分 Mac/Windows 两套）的内嵌模态框系统；统一页面样式主题与设计语言，完整保留现有功能。
> **创建时间**：2026-11-07\
> **执行模式**：`/goal` 长期自动推进，阶段性验证、代码提交与勾选。

---

## 阶段清单与进展 (Milestones & Checklist)

- [x] **Phase 1: 规划与基线校验**
  - [x] 分析现有窗口体系与 React 页面编译管线
  - [x] 验证当前测试套件（213 个测试通过）与代码卫生守卫
  - [x] 创建重构计划跟踪文档与测试基准

- [x] **Phase 2: 清理独立无用多窗口 (Remove Standalone Windows)**
  - [x] 移除 `tools/build-pages.mjs` 中的 `LicenseIndex`、`WelcomeIndex` 打包入口
  - [x] 清理后端 `src-tauri/src/ipc/misc.rs` 中的 `show_license`、`show_welcome` 独立子窗口创建
  - [x] 将菜单与界面的“许可证/激活”动作收敛至主窗口偏好设置的 License 标签
  - [x] 更新相关单测断言（移除过时的 530x440 独立窗口硬编码要求）
  - [x] 阶段性验证（`npm run check` & `npm test`）与提交

- [x] **Phase 3: 设置页面跨平台统一与内嵌模态框现代化重构**
  - [x] 统一 `PreferencesApp.jsx` 与选项卡，消除 Mac/Windows 页面割裂，采用环境探测局部条件渲染
  - [x] 将设置面板由全屏 iframe 容器升级为现代化内嵌居中模态框（磨砂半透明遮罩、平滑微动效、圆角、原生主题 Token 联动）
  - [x] 完善键盘与手势交互（`ESC` 键平滑退出、点击遮罩关闭、`Cmd/Ctrl+,` 切换）
  - [x] 阶段性验证（`npm run check` & `npm test`）与提交

- [x] **Phase 4: 统一现代模态框系统与关于面板重构**
  - [x] 构建主窗口集中式模态框层（统一管理 Preferences、About 等弹窗）
  - [x] 现代化重构“关于 (About)”面板：整合高清图标、版本徽章、授权状态与帮助文档快速入口
  - [x] 阶段性验证（`npm run check` & `npm test`）与提交

- [x] **Phase 5: 主窗口现代布局与主题质感打磨与全量验收**
  - [x] 打磨主窗口顶栏、侧边栏与模态框的整体视觉融合与微动效
  - [x] 验证现有功能无任何回退（大纲、代码块增强、防闪白、平滑滚动、拖拽吸附）
  - [x] 全量回归测试与卫生检查通过（`npm run check` & `npm test`）
  - [x] 完成任务清单全部勾选与最终提交

- [x] **Phase 6: UI 按钮与矢量图标防侵权现代化重绘 (UI Icon Modernization)**
  - [x] 细微调整重绘 `src/renderer/pages/common/icons.jsx` 全部 14 个 UI 矢量图标（Help, Close, Restart, Back, Markdown, Editor, Appearance, Export, Image, Folder, Check, Warning, Files, License），语义完全保持一致，消除历史原版矢量坐标侵权风险
  - [x] 细微调整重绘 `src/renderer/static/window.html` 与 `content.html` 底部查找替换选项按钮符号（大小写匹配 Aa、全字匹配 |ab|、正则表达式 .\*），采用现代规范几何路径
  - [x] 重绘 `src/renderer/pages/welcome/index.jsx` 全部 9 个辅助与引导按钮图标（Edit, Bolt, Export, Syntax, Files, Themes, Customize, Plus, Arrow）
  - [x] 编写 `test/unit/icons-modernization.test.mjs` 自动化测试守护，确保无旧路径回退与语义完整
  - [x] 全量构建（`npm run build`）、规范检查（`npm run check`）与 217 个测试全绿验证通过

- [x] **Phase 7: 依赖与渲染架构升级 - React 19 最新稳定版全面迁移 (React 19 Modernization)**
  - [x] 将 `package.json` 中的 `react` 与 `react-dom` 依赖升级到 React 19 最新版本（`^19.2.0` / `19.3.1`）
  - [x] 迁移所有 JSX 页面挂载入口，消除 React 19 中彻底废弃的 `ReactDOM.render`，全面采用 `react-dom/client` 的 `createRoot` API 并实现根容器幂等复用
  - [x] 在 `tools/build-pages.mjs` 中完善所有页面入口（Preferences, localSettingIndex, WelcomeIndex, LicenseIndex）的 esbuild 打包管线
  - [x] 编写 `test/unit/react19-modernization.test.mjs` 单元测试，自动验证 React 19 依赖版本、`createRoot` 挂载规范以及生成的构建制品
  - [x] 全量构建（`npm run build`）、规范检查（`npm run check`）与 222 个测试全量通过

- [x] **Phase 8: 许可证精简、烟花保留至关于面板与欢迎向导现代重塑 (License Cleanup & Confetti in About & Welcome)**
  - [x] 菜单与偏好设置精简：从原生帮助菜单（`menu-spec.json`）与偏好设置选项卡（`PreferencesApp`、`Sidebar`、`GeneralTab`）中移除“我的许可证”，消除冗余商业激活表单
  - [x] 烟花特效进驻关于面板：保留 `canvas-confetti` 绚丽烟花动效，打开“关于 (About)”时自动绽放，并在关于面板提供“🎉 放烟花庆祝”交互按钮
  - [x] 欢迎使用引导保留并内嵌化：菜单“帮助 -> 欢迎使用 ArborMark”唤起现代化主窗口磨砂居中模态框（`#uni-welcome-panel`），无缝整合于单窗口架构
  - [x] 引导最终页重塑为“关于与烟花”：移除购买与序列号激活表单，尾页呈现开源理念与版本徽章，伴随烟花绚丽绽放，点击“开始使用”直接开始写作
  - [x] 全量测试套件（222 个测试）全绿，代码卫生检查通过，Tauri 原生 Debug 可执行文件编译验证就绪

