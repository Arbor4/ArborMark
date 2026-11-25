# ArborMark 架构说明

ArborMark 基于 **Tauri 2（Rust）+ React 19 + TypeScript + Tailwind CSS v4** 构建，编辑内核采用 **Milkdown（ProseMirror）** 所见即所得引擎与 **CodeMirror 6** 纯文本源码 / 代码引擎，支持毫秒级启动、多窗口同步、主题开放体系及跨平台桌面集成。

---

## 目录结构

```text
ArborMark/
├── src/web/                        # 前端应用（React 19 + Vite + Tailwind CSS v4）
│   └── src/
│       ├── App.tsx                 # 根装配：全局快捷键、原生拖放、自动更新与弹窗容器
│       ├── bridge/                 # Tauri IPC、文件系统抽象、i18n 多语言与更新检查
│       ├── chrome/                 # Windows 自定义标题栏与菜单数据模型
│       ├── stores/                 # Zustand 状态管理（workspace / ui / search / find / lightbox）
│       ├── theme/                  # 主题契约（CSS tokens）、内置预设与注册中心
│       ├── styles/                 # 全局样式与打印分页样式
│       └── components/
│           ├── common.tsx          # Modal / Tooltip / ContextMenu / ConfirmDialog / Toasts
│           ├── layout.tsx          # 活动栏（ActivityBar）、侧边栏容器、状态栏与焦点刷新
│           ├── files/              # 文件树面板（FilePanel / FileTreeRow / dragSession / fileOps）
│           ├── outline/            # 文档大纲面板（OutlinePanel）
│           ├── settings/           # 偏好设置（SettingsPanel / EditorSettingsTabs / AppSettingsTabs）
│           └── editor/             # 编辑器核心与交互
│               ├── milkdown/       # Milkdown WYSIWYG 编辑器与节点插件（表格/代码块/公式/图表/图片）
│               ├── codemirror/     # CodeMirror 6 源码模式、多语言代码编辑与装饰插件
│               ├── EditorArea.tsx  # 编辑态 / 源码态 / 媒体预览调度
│               └── ...             # 命令总线（editorCommands / toolbarCommands）、导航与搜索联动
├── src-tauri/                      # Tauri 2 原生后端（Rust）
│   ├── locales/                    # 原生菜单多语言资源包
│   ├── menu-spec.json              # 原生菜单结构与快捷键声明
│   └── src/
│       ├── lib.rs                  # 应用装配：插件注册、状态注入、窗口构建与菜单派发
│       ├── startup.rs              # 启动参数与会话恢复策略
│       ├── ipc/                    # 按域拆分的 IPC 处理器（fs / document / library / export / setting / misc）
│       ├── menu.rs                 # 原生应用菜单与 Windows menu.dump 序列化
│       ├── protocol.rs             # arbormark:// 与临时打印预览协议路由
│       ├── state.rs                # 线程安全全局状态与持久化
│       ├── paths.rs                # 跨平台路径与大小写归一化
│       └── windows.rs              # 多窗口创建、关闭握手与主题同步
├── resources/                      # 应用图标与安装包资源
├── tools/                          # 构建/图标生成脚本
└── docs/                           # 架构说明、构建指南与规范矩阵
    ├── images/                     # README 展示截图
    └── archive/                    # 历史迁移与重构规划归档
```

---

## 前后端边界约定

1. **`src-tauri/src/lib.rs` 只负责装配**：协议注册、状态 `.manage()`、主窗口初始化、菜单事件与 `generate_handler!`。
2. **`src-tauri/src/ipc/mod.rs` 只放路由表**：按域分发到 `ipc/*` 子模块，保持接口清晰、测试可独立覆盖。
3. **跨平台路径归一化**：所有进入 Rust IPC 的本地路径均通过 `crate::paths` 统一规范化，前端统一使用 `pathUtil` 处理。
4. **编辑态基线与磁盘快照分离**：`useWorkspace` 将编辑器序列化基线（`savedContent`）与磁盘原始快照（`diskContent` / `diskMtime` / `diskSize`）解耦，既能精准判定 `dirty`，又彻底避免 Windows CRLF 或格式归一化触发误重载。
5. **本地优先与纯文本标准**：所有笔记、主题与配置默认保存在本地；文档始终保持标准 Markdown / GFM，无私有封装格式。

---

## 常用开发命令

```bash
# 安装依赖
npm install && npm --prefix src/web install

# 类型检查、前端构建与 Rust 单元测试
npm test

# 桌面端开发热重载
npm run dev

# 打包当前平台安装包
npm run build
```
