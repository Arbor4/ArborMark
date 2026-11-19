# 架构说明

宿主是 Tauri 2（`src-tauri/`），渲染层仍是原来那套单页应用：`src/renderer` 按职责拆模块，
`src/tauri/bootstrap.js` 在 WebView 里补齐 Electron preload 那层 `JSBridge` / `reqnode` / `_options`。

## 目录结构

```text
src/
├── tauri/                # WebView 兼容层（bootstrap：JSBridge / reqnode / 启动参数）
├── renderer/
│   ├── core/             # 编辑器、选区、撤销重做
│   ├── block/            # 代码块、表格、公式、图表、图片
│   ├── markdown/         # Markdown 解析与序列化
│   ├── io/               # 文件、导出、剪贴板、Pandoc
│   ├── ui/               # 菜单、侧边栏、大纲、搜索
│   ├── pages/            # 偏好设置 / 欢迎 / 许可证页面
│   ├── vendor/           # 第三方运行时
│   └── static/           # 宿主页面、主题、帮助文档、图标
└── shared/               # 跨进程常量与工具

src-tauri/src/
├── lib.rs                # 只做装配：协议注册、状态注入、建主窗口、挂 handler
├── startup.rs            # 启动参数规则（restoreWhenLaunch 的四种取向）
├── selftest.rs           # ARBORMARK_SELFTEST=* 自检钩子，不进产品路径
├── ipc/                  # 通道实现，按域分文件；mod.rs 只有路由表
├── state.rs              # 受管状态：settings / recents / lastSession / undo
├── menu.rs               # 原生菜单树与 menu.update
├── protocol.rs           # arbormark:// 静态资源与 tempfile 路由
├── windows.rs            # 窗口工厂 + bootstrap 注入
├── nodebridge/           # 回环 HTTP 桥（fs / path / os / quickOpen 检索）
└── diagnostics.rs        # 启动与崩溃日志
```

## 后端边界约定

- **`lib.rs` 只编排**：注册协议、`.manage()` 状态、建窗口、`generate_handler!`。
  规则性代码（启动参数、自检脚本）放 `startup.rs` / `selftest.rs`，不要往回塞。
- **`ipc/mod.rs` 只放路由**：一条通道一行，形如 `"域.动作" => 域模块::函数(...)`。
  处理逻辑写在对应域文件里；新通道按域入文件，`mod.rs` 不写业务分支。
- **命令函数保持 thin**：校验参数 → 读状态 → 调领域函数 → 映射错误。
  能被纯函数表达的规则（纸张换算、启动取向、路径归一化）单独拆出来，好让 `cargo test` 覆盖。
- **状态不加 `Arc`**：Tauri 的 `State` 已经管理生命周期，字段直接用 `Mutex<T>` / `RwLock<T>`，
  再套一层 `Arc` 只会多一次引用计数。

## 运行流程

1. `lib.rs` 注册 `arbormark://` / `arbormark-bg://` 协议，建主窗口并注入 `bootstrap.js`。
2. 渲染层通过 bootstrap 注入的 `JSBridge.invoke` → `ipc_invoke` 命令到达 `src-tauri/src/ipc`。
3. 编辑器在单个视口内维护 Markdown 文本与渲染节点，输入时增量更新。
4. 文件读写、导出与系统集成由 Rust 侧 IPC 完成；渲染层不直接访问本地文件系统，
   同步文件调用走 `nodebridge` 的回环 HTTP 桥（`reqnode("fs")`）。

## 关键约束

- **本地优先**：文档、图片、主题与配置默认保存在本机。
- **纯文本**：文档始终是标准 Markdown，不引入私有格式。
- **协议安全**：外部链接经过协议白名单校验；渲染层只能访问受控的本地资源。
- **可测试**：核心模块（标题、菜单、只读模式、导出、主题）均有回归测试。
- **路径统一**：详见下节「路径与分隔符」。

## 路径与分隔符

三个平台的分隔符不同（Windows `\`，macOS / Linux `/`），而渲染层又是纯字符串拼路径，
所以约定三层防线：

1. **Rust IPC 入口即归一化**：`crate::paths::native()` 把所有进来的路径统一成平台原生写法
   （Windows 下把 `/` 转成 `\`、合并重复分隔符、去掉结尾分隔符，`C:\` 与 UNC 根保留；
   `scheme://` 形式的 URL 原样返回）。`shell.*` / `path.*` / `library.*` / `document.*` /
   `export.*` / `fs_*` / nodebridge 的 `fs` 通道都走这一步。
   —— shell32（属性框）、`explorer /select` 这类接口**只认反斜杠**，混合路径会静默失败。
2. **渲染层拼路径只用 `StringUtils.joinPath()`**：等价 `path.join`，先用
   `toNativePath()` 归一化每一段再拼，避免 `mountFolder + "/" + 相对路径` 产出
   `C:\a\b/c.md`。比较路径用 `StringUtils.isSamePath()` / `isAncestorPathOf()`，
   它们会先归一化再按文件系统大小写规则比较。
3. **URL 分隔符恒为 `/`**：`href`、`file://`、自定义协议（`arbormark://app/...`）依旧用
   正斜杠，不要套 `joinPath`——`core/option.js` 的主题链接就是反例注释。

POSIX 下反斜杠是合法文件名字符，`toNativePath()` 在非 Windows 平台上**不改写**路径。

```js
// 正确
StringUtils.joinPath(File.getMountFolder(), "assets", name)
StringUtils.isSamePath(node.getAttribute("data-path"), File.bundle.filePath)

// 不要
File.getMountFolder() + "/" + name
```

回归测试：`src-tauri/src/paths.rs` 单测 + `test/unit/string-utils.test.mjs` 的
「Path separators on Windows / elsewhere」两组用例。

## 前端实现约束

样式与交互都别"先跑通再说"——两类硬手段各有脚本守着。

### 样式

- **不用 `!important` 压优先级**：先看是谁在竞争，用选择器特异性（如 `.sidebar-folder-right-icon.fa`）或层叠顺序解决。
- **不用负 margin / 负 inset 把元素"挪"到看起来对齐**：用 flex/grid 的 `gap`、`align-items`、`justify-content` 表达意图。
- **不用 `position:absolute` 硬顶布局**，除非元素本身就是浮层（tooltip / 菜单 / 表格插入标记）。
- **不逐个写死像素**：颜色、边框、字号走 token；侧边栏行内图标与点击热区统一用
  `--sidebar-action-size` / `--sidebar-action-icon-size` / `--sidebar-action-radius`。
- 新增结构性尺寸写进 `tokens.css` 的 B 段（结构默认值），主题只覆盖颜色类 token。
- **对话框是路径污染的常见源头**：默认路径（`defaultPath`）要用 `joinPath` 拼，
  Rust 侧 `dialog::show_save` / `path::show_save_dialog` 会把收发路径统一过 `paths::native`——
  系统对话框会把传入的 `/` 原样回传，随后写进 data-path、窗口标题和剪贴板。
- **主题不决定“显示与否”**：`display` / `flex` / `position` / `visibility` 这类状态属性，
  主题里不许加 `!important`（`lint:css` 会拦）。反例：liquid-glass 曾给 `.file-node-title`
  加 `display/flex !important`，把“编辑态隐藏标题”压掉，重命名输入框被标题挤开。
- 唯一允许 `!important` 的地方是**导出模板**（`io/export.js` 生成的独立 HTML），它必须压过用户主题。

守卫：`npm run lint:css`。除了分层规则，还带 `!important` / 负值定位的**预算**
（`tools/check-css-separation.mjs` 的 `BAND_AID_BUDGET`）：新增一处就失败；
清掉一批后记得把预算同步调低，别让它涨回去。

### 状态与交互

- **等"就绪"用事件，不要用 `setTimeout` 猜时间**。示例：新建窗口要打开某文档时，Rust 只把路径放进
  `AppState::pending_switch`，渲染层在 `app.rendererReady`（带 `hasEditor`）里触发
  `flush_pending_switch` 切换一次——不再每 150ms 自旋重试。
- **不用 `setInterval` 轮询状态**。确有周期性工作（自动备份、草稿列表清理）的，登记到
  `tools/check-renderer-hygiene.mjs` 的 `ALLOWED_INTERVALS` 并写清理由。
- **不用 `window.xxx` 全局绕开模块依赖**，跨模块请 `require("模块名")`。少数例外是 Rust 侧
  `eval` 会访问的契约（`window.File` / `window.JSBridge` / `window.dirname`）和 HTML 内联事件，
  改动前先确认调用方。
- **不把 DOM 当状态机**：别用 `classList` / `style` 记录业务状态再由别处读取；
  走已有的状态与事件回调，让样式由状态驱动。
- **WebView2 截图窗口的 `position(-32000, 0)` 是特例**：`CapturePreview` 只对可见窗口出图，
  不能改成 `visible(false)`，只能移出屏幕并 `skip_taskbar`。

守卫：`npm run check:renderer`。全部检查一次跑完：`npm run check`。

## 开发

```bash
npm install
npm run build
npm start
npm test
```

主题、帮助文档与图标分别位于 `src/renderer/static/style/themes/`、`src/renderer/static/Docs/`、`src/renderer/static/assets/icon/`。 

### 样式分层契约

样式按 `tokens → base → theme` 三层加载，构建与 CI 都有守卫：

| 层       | 文件                                                                                      | 规则                                                          |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Token 层 | `style/tokens.css`                                                                        | 唯一的 `:root` 变量来源；A 段是主题契约，B 段是结构默认值     |
| 基础层   | `base.css`、`base-control.css`、`window.css`、`mac.css`、`megamenu.css`、`codemirror.css` | 只消费 `var(--token)`，不定义 `:root`、不出现主题名           |
| 主题层   | `style/themes/*.css`                                                                      | 只提供 token 与正文排版；6 个内置主题必须覆盖 13 个契约 token |

- 新增主题：复制任一主题的 `:root` 块，补齐 13 个契约 token 即可；`npm run lint:css` 会校验。
- 新增交互色：先加到 `tokens.css`（或导出为结构 token），不要在基础层写死颜色。
- 主题选择等“点击态”统一使用 `--side-bar-menu-active-tint`（默认取 `--primary-color`），
  不要再用 `transparent` 或主题私有变量，否则勾选图标会不可见。
- 回归：`test/unit/tauri-desktop-parity.test.mjs` 锁住契约 token 与选中色，`npm run lint:css` 锁住分层。
