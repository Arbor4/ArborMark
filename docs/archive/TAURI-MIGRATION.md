# Electron → Tauri 2 + Rust 迁移方案

> 分支：`feat/tauri-rust`　目标版本：ArborMark 3.0.0
>
> 本文是迁移的**唯一事实来源**：记录架构决策、边界划分、阶段计划与已知风险。
> 每完成一个阶段，请同步更新文末的「进度」。

## 1. 现状盘点（迁移前）

| 层         | 位置                                                   | 规模                                                | 处理方式                       |
| ---------- | ------------------------------------------------------ | --------------------------------------------------- | ------------------------------ |
| 主进程     | `src/main/**`                                          | \~8.8k 行 JS，9 个 IPC 域模块 + 窗口/菜单/协议/配置 | **用 Rust 重写**               |
| Preload 桥 | `src/preload/preload.cjs`                              | 302 行                                              | **用 JS shim + Rust 命令**重写 |
| 渲染层     | `src/renderer/**`                                      | \~194k 行 JS（不含 vendor）                         | **保留**，按兼容层适配         |
| 静态资源   | `src/renderer/static/**`                               | 迁移前 53 MB（含 `node_modules` 与两个 `.asar`）    | 清掉 Electron 专有产物后 26 MB |
| 通道契约   | `src/main/channels.json`、`src/shared/ipc-channels.js` | 208 个通道                                          | 作为 Rust 与 JS 的共同契约     |
| 构建       | `tools/build.mjs`、`esbuild`                           | Electron 打包 + 页面编译                            | 保留页面编译，替换打包为 Tauri |

### 关键约束：渲染层依赖 Node

渲染层通过 preload 注入的 `reqnode(...)` 直接使用 Node 模块（387 处调用）：

| 模块            | 调用数 | 说明                                                               |
| --------------- | ------ | ------------------------------------------------------------------ |
| `path`          | 106    | 纯函数，可在 JS 内实现                                             |
| `fs`            | 98     | **含 96 处同步调用**（`readFileSync` / `statSync` / `existsSync`） |
| `fs-extra`      | 68     | 同上，异步为主                                                     |
| `electron`      | 46     | `ipcRenderer` / `webFrame`（缩放、拼写检查）                       |
| `fs-plus`       | 16     | 同上                                                               |
| `child_process` | 12     | 外部命令（pandoc、rg）                                             |

Tauri 的 WebView **没有 Node 运行时**，因此必须在 Rust 侧补一个 Node 兼容层。这是整个迁移的核心难点。

## 2. 架构决策

### 2.1 保留渲染层，替换外壳

不重写 194k 行渲染层。Rust 提供两套接口，渲染层代码**基本零改动**：

```
┌──────────────────────────────────────────────┐
│ WebView（现有渲染层，原样加载）              │
│   window.JSBridge   ← src/tauri/bridge.js    │
│   window.reqnode    ← src/tauri/node-shim.js │
└───────────┬──────────────────────┬───────────┘
            │ Tauri invoke (异步)  │ sync XHR (同步)
┌───────────▼──────────────────────▼───────────┐
│ Rust 后端                                     │
│   ipc_invoke  ── 208 通道分发（等价旧 ipcMain）│
│   nodebridge  ── 127.0.0.1 回环 HTTP（同步桥） │
└──────────────────────────────────────────────┘
```

### 2.2 同步 fs 的解决办法：回环 HTTP + 同步 XHR

Tauri 没有同步 IPC，而渲染层有 96 处 `fs.*Sync`。方案：

1. Rust 启动时在 `127.0.0.1` 绑定一个 **随机端口** 的 `tiny_http` 服务，生成一次性 token；
2. 创建窗口时用 `initialization_script` 把 `{port, token}` 同步注入 `window.__ARBOR_BRIDGE__`；
3. JS shim 的同步方法用 `XMLHttpRequest(..., async=false)` 走回环请求。

安全性：只监听回环地址、随机端口、每次启动新 token、请求头校验、仅暴露白名单方法。
代价：同步调用从「进程内函数调用」变成「本地 HTTP 往返」（约 0.1–1 ms），对本项目的文件 IO 频率无影响。

### 2.3 通道契约不变

`ipc_invoke(channel, payload)` 与旧 `ipcMain.handle` 一一对应；未实现的通道返回 `null`，
与旧 `ipc-router.js` 的 `invokeUnsupported` 兜底行为一致。这样渲染层里 208 个通道不需要逐个改。

## 3. 阶段计划 

| 阶段 | 内容                                                                    | 完成标志               |
| ---- | ----------------------------------------------------------------------- | ---------------------- |
| P0   | 分支、方案、`src-tauri` 骨架、Tauri 配置                                | `cargo check` 通过     |
| P1   | Node 兼容层：`fs`/`path`/`os`/`child_process` + 回环桥                  | 渲染层能读写文件       |
| P2   | JSBridge shim（invoke/send/on/callSync）+ 启动注入                      | 渲染层能启动、加载文档 |
| P3   | IPC 域 handler：dialog / shell / clipboard / window / setting / library | 主要交互可用           |
| P4   | 重活：export（打印/PDF/长图）、document、pandoc、菜单                   | 导出与菜单可用         |
| P5   | 构建与 CI：移除 electron-builder，接入 `tauri build`，6 平台产物        | Release 可发布         |
| P6   | CSS 整理：主题样式与系统/基础样式分离                                   | 见第 5 节              |

## 4. 目录结构（目标）

```
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/default.json
  src/
    main.rs            # 入口
    lib.rs             # Builder 装配
    state.rs           # 运行时状态（设置、最近文件、路径）
    protocol.rs        # arbormark:// 自定义协议
    menu.rs            # 原生菜单
    ipc/mod.rs         # 通道分发
    ipc/{dialog,shell,clipboard,window,setting,library,export,document,misc}.rs
    nodebridge/mod.rs  # 回环 HTTP 同步桥
    nodebridge/{fs_ops,path_ops,os_ops}.rs
src/tauri/
  bootstrap.js         # 安装 window.JSBridge / reqnode / _options
  bridge.js            # JSBridge 实现（基于 Tauri invoke）
  node-shim.js         # reqnode 实现（基于回环桥 + JS 内建 path）
```

## 5. CSS 整理（P6）

目标：把「主题样式」与「系统/基础样式」分开，消除散落的默认值，并让规则可校验。

### 5.1 现状盘点

`src/renderer/static/style/` 下是两层：

- **基础层**：`base.css`、`base-control.css`、`window.css`、`mac.css`、`megamenu.css`、`codemirror.css`
- **主题层**：`themes/{github,liquid-glass,night,newsprint,pixyll,whitey}.css`，以及
  `themes/{night,liquid-glass}/{codeblock,mermaid,sourcemode}.dark.css` 三个分片（由主题 `@import`）

问题不在「没有分层」，而在**默认值散落**：`:root` 里的 token 默认值分别写在
`base.css`、`base-control.css`、`window.css` 三个文件里，且有 2 个 `:root` 块互相覆盖，
谁也说不清最终生效的是哪一个。

### 5.2 已完成

1. 新增 `style/tokens.css`：把三处 `:root` 按**原覆盖顺序**合并成一份契约，
   按语义分组（画布 / 强调色 / 选区 / 控件 / 编辑器 / 边框 / 尺寸 / 排版 / 侧边栏）并加注释；
   合并后各 token 的最终取值与原状一致，视觉零变化。
2. 从 `base.css`、`base-control.css`、`window.css` 中删除全部 4 个 `:root` 块；
   默认值现在只存在于 `tokens.css` 一处。顺带清掉 6 条规则内的完全重复声明
   （`margin-right:4px;margin-right:4px` 这类，纯噪声）。
3. 修复 `--side-bar-menu-active-tint: var(--side-bar-menu-active-tint)` 的自引用 bug
   （永远解析失败），显式给成 `transparent` 以保持现有观感。
4. `window.html` 与 `html/preview.html` 在 `base.css` 之前引入 `tokens.css`；
   `window.html` 里带上 `css-include`，保证导出 HTML 内联主题变量。
5. `tokens.css` 明确分成两段：**A. 主题契约**（12 个主题应当覆盖的 token）与
   **B. 结构默认值**（布局尺寸、次要配色、等宽字体）。`--monospace` 各主题取值一致，
   归入 B 段；liquid-glass 的 `--glass-*`、`--cursor-color` 作为主题私有扩展。
6. 新增 `tools/check-css-separation.mjs`（`npm run lint:css`）：
   - 基础层不得出现 `:root`；
   - 基础层不得出现内置主题选择器；
   - 主题至少定义一个 token（核心 token 缺失仅告警，允许继承默认值）；
   - 统计基础层「真·硬编码颜色」，`color:#fff; color:var(--x)` 这类渐进降级不计入；
   - 统计每个主题对主题契约的覆盖率（当前 `pixyll.css` 只覆盖 1/12，其余走默认值）；
   - 主题里出现契约之外且非私有前缀的 token 时告警（防拼写错误）。

### 5.3 未完成（按数据排的优先级）

基础层仍有 297 处声明直接使用颜色字面量（未走 token）：

| 文件               | 硬编码颜色 | 说明                                                                                                       |
| ------------------ | ---------: | ---------------------------------------------------------------------------------------------------------- |
| `base-control.css` |        150 | 控件/弹层，占比最大，且与 Bootstrap 覆盖纠缠                                                               |
| `window.css`       |         50 | 窗口外壳                                                                                                   |
| `megamenu.css`     |         29 | 开始菜单                                                                                                   |
| `base.css`         |         27 | 画布与排版                                                                                                 |
| `codemirror.css`   |         35 | **不建议动**：绝大部分是 `.cm-keyword` / `.cm-string` 这类语法高亮调色板，不是主题表面色，token 化没有意义 |
| `mac.css`          |          6 | macOS 专属细节                                                                                             |

下一步：按 `window.css` → `megamenu.css` → `base.css` → `mac.css` 的顺序推进，
`base-control.css` 放最后。每一处改动都应先确认「该颜色是否本应跟随主题」，避免把
语法高亮这类语义色误当成主题色。

> 已完成一次取值校验：35 个 token 的合并结果与改动前逐项比对，除
> `--side-bar-menu-active-tint`（自引用 bug 的修复）外**取值完全一致**，即本次重构不改变渲染结果。

### 5.4 有意不做的

- **不移动文件目录**（`style/base/`）：`window.html`、`preview.html`、协议层与导出流程都在
  引用现有路径，在无法启动应用验证的前提下改路径只会增加回归面。分层靠 `tokens.css` +
  校验脚本约束，收益相同、风险更低。
- **不把每个主题拆成 `tokens.css` + `overrides.css`**：六个主题里 GitHub / Night / Newsprint /
  Whitey 本身只有 2.5–3 KB，拆开只增加导入开销；Liquid Glass 40 KB 且已用 `@import` 分片，
  保持现状更清晰。

## 6. 风险与对策

| 风险                                  | 影响             | 对策                                                                            |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| 本机没有 `cargo` / `node`             | 无法本地编译验证 | 所有 Rust 改动需在 CI 或开发机 `cargo check` 后再合并                           |
| 同步 XHR 被 WebView 限制              | 文件读写失败     | 启动自检 `__ARBOR_BRIDGE__` 探活；失败时降级为异步并记录                        |
| `webFrame`（缩放/拼写检查）无对应 API | 功能缺失         | 缩放改用 CSS `zoom` + 保存系数；拼写检查用系统能力                              |
| 打印/PDF 依赖 Chromium 打印           | 导出能力弱化     | Windows 已用 WebView2 `PrintToPdf` 补齐；macOS/Linux 回落打印对话框（长图仍缺） |
| 208 通道中仅约 40 个有实现            | 行为差异         | 保持 `null` 兜底，逐通道补齐并加测试                                            |

## 6.5 验证与运维事项

### 可以跑的验证

> 本地验证环境：`.toolchain/`（rustup minimal + Node 24 LTS），已加入 `.gitignore`。
>
> **运行验证（macOS, debug 与 release bundle）**：应用能启动、WebView 能加载渲染层、
> 文档与大纲正常渲染。日志证据：
>
> ```
> [nodebridge] 收到渲染层首个 RPC: os.arch
> [renderer] 初始化完成 hasFile=true hasEditor=true title=ArborMark theme=... bg=rgb(255, 255, 255) href=arbormark://app/userData/themes/current-theme.css
> [renderer] tempPath=true writeLen=60
>
> `hasEditor=true` 是分水岭：此前所有"能跑起来"的观察其实只跑起了外壳，
> 渲染层的模块加载器在 `tauri://` 下找不到 manifest，frame.js 直接抛错。
> ```
>
> 用法：`export PATH="$PWD/.toolchain/cargo/bin:$PWD/.toolchain/node/bin:$PATH"`
>
> 启动自检：`ARBORMARK_DATA_DIR=$PWD/.test-data ./src-tauri/target/debug/ArborMark`
> （数据目录可用该环境变量覆盖，便于便携模式与自动化验证）。

| 命令                                              | 覆盖内容                                                                                        | 需要                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| `cargo check` / `cargo build`                     | 后端能否编译、链接（已验证通过）                                                                | Rust 工具链             |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 协议路由、设置持久化、最近文件去重、文件撤销、按窗口文档状态、文件检索（22 个用例，已验证通过） | Rust 工具链             |
| `ARBORMARK_SELFTEST=smoke`                        | 打开一份临时 Markdown 并校验 DOM 渲染，退出码 0/1                                               | 打包产物或 debug 二进制 |
| `ARBORMARK_SELFTEST=quickopen`                    | 页面内真跑一次 Worker → Rust 检索，返回 600 个文件                                              | 同上                    |
| `ARBORMARK_SELFTEST=print`                        | 创建打印视图窗口并由自定义协议提供临时 HTML                                                     | 同上                    |
| `ARBORMARK_SELFTEST=perf`                         | 对比同步桥与 `invoke` 快通道的单次读耗时                                                        | 同上                    |
| `npm run check:tauri`                             | 版本号一致性、frontendDist、图标、窗口 label、bootstrap 依赖、CSP                               | Node                    |
| `npm run lint:css`                                | CSS 分层规则（基础层无 `:root`、无主题选择器、硬编码颜色统计）                                  | Node                    |
| `npm run check:ipc`                               | IPC 覆盖率守卫：与 `tools/ipc-coverage-baseline.json` 比对，新增未实现通道即失败                | Node                    |
| `npm test`                                        | 既有单元/集成测试（不再需要安装 electron 包）                                                   | Node                    |

CI 里 `rust` job 在打 tag 或手动 Run workflow 时跑 `cargo test`，
是当前唯一能真实编译 src-tauri 的地方；普通分支 push 不再自动触发，避免和 tag 构建重复。

### 需要注意

1. ~~`package-lock.json` 已过期~~ —— 已在本地 `npm install` 重新生成（砍掉 3984 行
   electron / electron-builder 依赖树），CI 已切回 `npm ci`。
2. **`electron` 不再是依赖**：`src/main/utils/electron-shim.js` 已改为 `createRequire` +
   try/catch 的可选加载，纯 Node 单测在没有 electron 包时走 fallback 分支。
   `test/e2e/**` 仍然会导入 electron，迁移收尾时需随 `src/main` 一起移除或改写。
3. 遗留代码：`src/preload/preload.cjs` 与 `src/main/**` 目前仅为参考实现保留，
   Tauri 构建不会加载它们；确认 `cargo test`/手工验收通过后再整体删除。

## 6.6 导出（export.\*）的现状与方案

Electron 的导出链路依赖 Chromium 私有能力：

| 通道                                          | Electron 实现                   | Tauri 现状                                                                |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `export.print`                                | `webContents.print()`           | ✅ 打印打印视图窗口，回落到调用方窗口                                      |
| `export.recordLastExport`                     | 恒 true                         | ✅ 恒 true                                                                 |
| `export.printToPDF`                           | `webContents.printToPDF()`      | ✅ Windows：WebView2 `ICoreWebView2_7::PrintToPdf`；其它平台返回错误三元组 |
| `export.genPrintView` / `destroyPrintView`    | 隐藏 BrowserWindow 渲染打印视图 | ✅ 独立窗口加载 `arbormark://app/tempfile/…`                               |
| `export.captureImage` / `prepareImageCapture` | `webContents.capturePage()`     | ✅ WebView2 `CapturePreview` 分段截图（Windows），见本节"长图链路"         |

> `printToPDF` 成功时返回 `[临时 PDF 路径, null, null]`，失败时返回 `[null, null, 错误信息]`。
> 之所以返回**路径**而不是字节：几 MB 的二进制走 IPC 会膨胀成等量级的 JSON 数字数组。
> 渲染层 `pdf-export.js` 的 `toPdfBuffer()` 负责读成 Buffer 并删掉临时文件。

> macOS / Linux 没有等价 API，`print_to_pdf` 返回错误三元组；渲染层的 `exportPDF`
> 在检测到「Tauri 且非 Windows」时直接改走打印视图（系统对话框里「存储为 PDF」）。

打印链路：导出时把 HTML 写到 `tempPath`，`export.genPrintView` 用
`arbormark://app/tempfile/<name>` 在独立窗口里加载它，`export.print` 调起系统打印
对话框（macOS 可在对话框里"存储为 PDF"）。

**长图链路的实现要点**（Windows，`ipc/export.rs::windows_capture`）：

1. `prepareImageCapture` 开一个**可见但移出屏幕**（`position(-32000, 0)`）的窗口
   加载同一份临时 HTML——`CapturePreview` 对 `visible(false)` 的窗口只会出空白图；
2. 页面高度用 `ICoreWebView2::ExecuteScript` 量出来（Tauri 的 `eval` 是发后不理，
   拿不到返回值；分段截图必须知道"滚到位了没"，靠 sleep 猜时机不可靠）；
3. `captureImage` 把窗口尺寸撑到切片高度、滚到偏移量、再 `CapturePreview` 进
   HGLOBAL 流取 PNG 字节，包成 data URL 返回，拼接仍由渲染层 image-worker 完成；
4. WebView 可视区比窗口尺寸多一圈，直接按请求高度截会让每段多几十像素、拼图重复，
   所以每次 resize 后先量 `window.innerHeight`，按差值修正窗口尺寸（自适应校准，
   不写死魔法像素）。
5. 自检：`ARBORMARK_SELFTEST=image` 会把一份 7800px 高的页面截成两段 PNG
   （`ARBORMARK_SELFTEST_KEEP=1` 保留产物），校验每段高度与请求一致。

**PDF 链路的实现要点**（Windows）：

1. 渲染层照旧用 `exportToHTML({ forPrint: true })` 生成完整 HTML 并写到 `tempPath`
   ——分页锚点、主题样式、MathJax/Mermaid 的内联都在这一步完成；
2. Rust 侧开一个隐藏窗口加载它，**必须用 `file://` 而不是自定义协议**：
   `export.js` 在 `forPrint` 下只产出 `<link href="file://…">`，页面若是
   `http://arbormark.localhost` 会被跨源挡掉，导出的就是一张没样式的白页；
3. 页面加载完成后再等 350ms（图片解码），用 `ICoreWebView2_7::PrintToPdf` 打到临时文件，
   纸张/页边距/是否打印背景由 `ICoreWebView2PrintSettings` 设置；
4. 结果交回渲染层，页眉页脚合成、PDF 大纲（书签）注入仍由 `pdf-lib` 完成，与 Electron 一致。

**`pdf-lib` 不能单独生成 PDF**：它只做后处理（注入大纲、叠加页眉页脚、合并页面），
页面本身必须由浏览器排版引擎光栅/矢量化。所以 `printToPDF` 是"导出 PDF"的唯一路径，
不存在"纯渲染层 pdf-lib 生成"的替代方案。

自检：`ARBORMARK_SELFTEST=pdf` 会把一份临时 HTML（含 `file://` 外链 CSS）渲染成 PDF，
校验产物以 `%PDF` 开头并以退出码给出结论；`ARBORMARK_SELFTEST_KEEP=1` 可保留产物。

`ARBORMARK_SELFTEST=print` 启动时会创建一份打印视图并加载临时 HTML，
日志会给出 `[selftest] 打印视图窗口创建成功` 与 `[protocol] 提供临时打印文件: …`，
用于验证自定义协议窗口链路（协议单元测试同时覆盖目录穿越防护）。

## 6.7 打包结果

```
tauri build --bundles app
  Built application at: src-tauri/target/release/ArborMark
  Bundling ArborMark.app (src-tauri/target/release/bundle/macos/ArborMark.app)
  Finished 1 bundle at: .../ArborMark.app  (12.13 MiB)
```

打包过程暴露的两个硬性约束：

1. **`frontendDist` 不能包含 `node_modules` 目录**（tauri 直接拒绝）。原静态目录里的
   `node_modules` / `node_modules.asar` 是 Electron 原生插件（fswin / cld / rg），
   WebView 根本加载不了，已删除；只有 692K 的 Hunspell 词典搬到了
   `static/dictionaries/hunspell`。
2. **`lib.asar` 在 Tauri 下不可读**。Electron 能透明读取 asar 归档内部，Tauri 只是静态
   文件服务。渲染层里 12 处 `lib.asar/...` 改为指向已解包的 `lib/`。

对比：Electron 版本的 macOS 安装包约 200 MB，当前 Tauri `.app` 为 12 MB。

> `--bundles dmg` 在当前受限沙箱里失败：`hdiutil create failed - 操作不被允许`。
> 这是环境限制（制作磁盘映像需要更高权限），`.app` 打包本身正常；
> 在普通开发机或 CI 上 dmg 步骤应当可以通过。

## 6.8 启动参数（boot options）对齐

旧版 `window-manager.js` 通过 `--tyopt` 注入一份相当完整的启动参数，渲染层启动时
直接读它。Tauri 侧的 `windows::boot_options` 起初只塞了路径，漏掉的关键项会让功能
**静默失效**：

| 缺失项                                             | 后果                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `tempPath`                                         | 导出/撤销/演示模式的临时文件路径变成 `undefined/...`，PDF 导出静默失败 |
| `allThemes`                                        | 主题菜单列表为空                                                       |
| `initFilePath` / `initialFile` / `initMountFolder` | 新窗口打开文件/文件夹的初始状态丢失                                    |
| `documentsPath` / `userPath`                       | 导出时的默认目录不对                                                   |
| `appLocale` / `userLanguage`                       | 语言相关分支走默认值                                                   |

另一个同类问题出在**通道语义**上：`theme.setThemeSource("dark" | "system")` 是配色方案提示，
不是主题文件名。早期它和 `theme.apply` 共用一个 handler，把 `curTheme` 覆盖成了
`system.css`（不存在的文件），实际表现为"设置了夜间主题却始终白底"。现在
`themeSource` 独立存储，主题选择只由 `theme.apply` 改写。

现在这些都已补齐，`tempPath` 还会自动创建 `<系统 temp>/arbormark` 目录。
启动探针会回报 `tempPath=true/false`，便于回归检查。

## 6.9 渲染层模块加载器

`appsrc/window/frame.js` 是一个 12 模块的加载器，它原本通过
`document.currentScript.src` + `url.fileURLToPath` 推导模块目录。在
`tauri://localhost/...` 下这个推导会失败，得到 `/tauri:/localhost/...` 这种路径，
随后 `fs.existsSync` 为假并抛出：

```
Modules manifest not found: /tauri:/localhost/appsrc/window/manifest.json
```

修复分三处：

1. **加载器**（`tools/build.mjs` 的 `LOADER_TEMPLATE`）：只有 `file://` 才走
   `fileURLToPath`；否则用注入的 `window.dirname` 作为目录。
2. **读取回退**：`readAsset()` 先试 `fs`（开发期能读到源码目录），失败则用
   **同步 XHR** 从页面同源地址取（打包后资源内嵌在 `tauri://` 里）。
3. **全局补齐**：`window.process`（渲染层直接读 `process.platform`）；
   `window.require` 改为 getter + 空 setter，避免 `window.html` 里
   `delete window.require` / `require = undefined` 把它清掉。

另外 Worker（`finder-worker.js`）在 WebView 里没有 Node 运行时，现在会探测并
退化为空结果，不再抛未捕获异常。

### 快速打开（Quick Open）

原来的 `finder-worker.js` 用 Node 的 fs 递归扫描工作区，Worker 里没有 Node 就跑不动。
现在改成：

- Rust 侧 `nodebridge` 增加 `search` 模块（`listFiles` / `find`）：深度受限、跳过隐藏
  目录与 `node_modules/dist/target`、按文件名做模糊匹配；
- 新增 `appsrc/quick-open-worker-shim.js`，**保持与原 Worker 完全相同的消息协议**
  （`initFileCache` / `queryMatch` / `queryEnd`），内部用 fetch 调回环桥；
- 面板检测到 `window.__ARBOR_BOOT__`（Tauri）时用 shim，其余代码零改动。

自检：`ARBORMARK_SELFTEST=quickopen` 会在页面里真的创建一个 shim Worker 并扫描当前
目录，日志输出 `{"ok":true,"size":600,"type":"initFileCache"}`。

## 6.10 打开文档：四个叠加缺陷（已全部修复）

`ARBORMARK_SELFTEST=smoke` 一路把这个功能从"卡死"推到"可用"：

| # | 缺陷                                  | 表现                                                                                                | 修复                                                              |
| - | ------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1 | `statSync` 返回普通对象               | 渲染层调用 `stats.isDirectory()` 抛异常 → `doSwitchByNode` 重试 → **loadFile 无限递归、渲染层冻结** | 返回带 `isFile()`/`isDirectory()` 的 `fs.Stats` 兼容对象          |
| 2 | `document.switchDocument` 返回 `true` | 拿不到 `filePath`，文件根本没读                                                                     | 返回快照 JSON 字符串 `{snap,filePath,backups,shouldReadFromDisk}` |
| 3 | `readFile` 返回裸 `Uint8Array`        | `Buffer.isBuffer()` 为假                                                                            | 返回真正继承 `Uint8Array` 的 Buffer 实例                          |
| 4 | Buffer 没有 `toString(encoding)`      | `String(buffer)` 退化为 `Uint8Array.prototype.toString()`，**整篇文档渲染成 `35,32,83,...`**        | Buffer 原型上实现 `toString`/`toJSON`                             |

修复后用打包产物验证：

```
$ ARBORMARK_SELFTEST=smoke ./ArborMark.app/Contents/MacOS/ArborMark
exit=0
{"pass":true,"stage":"content","htmlLen":633,"savedLen":30,
 "head":"<h1 ...>Smoke</h1><p ...>","theme":"night.css"}
```

## 6.11 文件 IO 性能：现状与官方路线

同步桥（回环 HTTP + base64 + JSON + 同步 XHR）是为了兼容渲染层的 Node 同步调用，
但**单次读到不了 Rust 应该有的水平**：2MB 文本约 15–25ms，其中真正读盘只有 0.5–1.5ms。

| 阶段                         |      量级 |
| ---------------------------- | --------: |
| Rust 读文件（page cache）    | 0.5–1.5ms |
| base64 编码                  | 1.5–2.5ms |
| JSON 包装与拷贝              |     3–5ms |
| 回环 HTTP                    |   0.3–1ms |
| JS `JSON.parse`              |     3–5ms |
| `atob` + 逐字节 `charCodeAt` |    5–10ms |
| `TextDecoder`                |     1–2ms |

### 已落地（本轮）

`src-tauri/src/fs_ipc.rs` 提供官方推荐的异步快通道：

| 命令                       | 返回                                             | 用途               |
| -------------------------- | ------------------------------------------------ | ------------------ |
| `fs_read_bytes(path)`      | `tauri::ipc::Response`（原始字节 → ArrayBuffer） | 文档/图片读取      |
| `fs_read_text(path)`       | `String`                                         | 配置、主题等小文本 |
| `fs_stat_many(paths)`      | JSON 数组                                        | 文件树批量 stat    |
| `fs_read_text_many(paths)` | JSON 数组（base64）                              | 小文件批量读       |

全部用 `spawn_blocking` 包住，避免阻塞 async worker。

JS 侧（`bootstrap.js`）的 `fs.promises.readFile` / `fs-extra.readFile` 可以走
`invoke("fs_read_bytes")`，但**默认关闭**（`ARBORMARK_RAW_FS=1` 才启用），原因是实测结果：

```
ARBORMARK_SELFTEST=perf（2MB 文本，各 8 次取中位数）
  invoke 快通道：syncMs = 71   asyncMs = 447   speedup = 0.2   ← 失败尝试
  协议直读：      syncMs = 12   asyncMs = 1     speedup = 12    ← 最终方案（release）
```

快通道反而慢 6 倍。探针显示 `fs_read_bytes` 的返回值在 JS 侧是
**`[object Array]` 的普通数字数组**（`ctor: "Array"`、`length: 12`），
也就是说字节被当作 JSON 数组传输——正是"不要用 `Vec<u8>` 做返回值"那个坑。
Rust 侧已经是裸 `tauri::ipc::Response`（`Vec<u8>` → `InvokeResponseBody::Raw`），
问题出在 `withGlobalTauri` 的 `invoke` 路径上；下一步要换成
`@tauri-apps/api` 的 `invoke`（或自定义 IPC 包装）才能拿到真正的 ArrayBuffer。

在解决这一点之前，回环桥（71ms/2MB）仍是更快、更稳的默认路径。

同步桥继续服务 `readFileSync` 等 96 处同步调用——这部分必须先改渲染层才能去掉。

### 后续（按收益排序）

| 阶段 | 做什么                                               | 预期                            |
| ---- | ---------------------------------------------------- | ------------------------------- |
| P0   | 修好 raw 载荷转换，文档打开/保存切到 `fs_read_bytes` | 2MB 读 15–25ms → 2–5ms          |
| P1   | 图片走 asset protocol / `fs_read_bytes`              | 10MB 图 100–300ms → 10–30ms     |
| P2   | 文件树用 `fs_stat_many`、搜索走 Rust 批处理          | 1k 文件 0.5–2s → 50–300ms       |
| P3   | 剩余同步调用异步化，删除回环 HTTP                    | 去掉 HTTP/token/CORS/单线程瓶颈 |

## 6.12 主题令牌一致性

6 个主题（github / night / newsprint / whitey / pixyll / liquid-glass）现在都声明
`tokens.css` 约定的 12 个主题令牌。pixyll 原本只声明 `--control-text-color`，
导致侧边栏、当前文件、选区、窗口边框全部落回基础层默认值——表现是"换了主题但
界面基本没变"。补齐后所有主题共享同一份契约，基础层保持主题无关。

`npm run lint:css` 会校验分层（基础层不得引用主题令牌、主题层不得定义结构性规则）。

## 7. 进度

- [x] P0 分支 `feat/tauri-rust`、方案文档、`src-tauri` 骨架（Cargo / tauri.conf / capabilities / IPC 路由）
- [x] P1 Node 兼容层 v1：`fs`（含同步方法）、`path`、`os`、`child_process`、`clipboard`，回环 HTTP 桥
- [x] P2 JSBridge shim v1：`src/tauri/bootstrap.js`，经 `initialization_script` 注入，恢复
  `window.JSBridge` / `window.reqnode` / `window._options` / `window.require`
- [x] P5 构建与 CI v1：移除 `electron` / `electron-builder` 依赖与配置，接入 `@tauri-apps/cli`，
  6 个平台工作流合并为 `tauri-action` 矩阵
- [x] P3 自定义协议：`arbormark://` / `arbormark-bg://`，含主题解析与默认主题回退；`setting.getThemes` / `setCurTheme`
- [x] P3c `path.*` / `quickOpen.*` 通道（定位文件、默认程序打开、目录判断、快捷打开桩）
- [x] P3b 其余 IPC 域：`export.*`（除 `printToPDF`）、`document.*`、`setting.*`、`library.*`、`filesOp.*`、`license.*`、`logger.*`、`updater.*` 均已迁移
- [x] P4a 系统菜单：撤销/重做、剪切/复制/粘贴、全屏、最小化/关闭（`src-tauri/src/menu.rs`）
- [x] P3d 多窗口：`windows.rs` 统一工厂、`doc-*` label、加载后切换文档；
  窗口类命令改为作用于**调用方窗口**（`ipc_invoke` 注入 `WebviewWindow`）
- [x] P4a2 `menu.popup`：原生弹出菜单（编码选择、最近目录、图片右键）
- [x] P3e `window.selectNextTab/selectPreviousTab`：在窗口间循环切换
- [ ] P4b 业务菜单树（文件/段落/格式/主题/帮助）与 `menu.update` 勾选同步
- [x] P4c 打印：`genPrintView` + 独立窗口加载 `arbormark://app/tempfile/...` + 系统打印对话框
- [x] P4c2 `printToPDF`：Windows 用 WebView2 `ICoreWebView2_7::PrintToPdf`（`ARBORMARK_SELFTEST=pdf` 校验）；长图仍未迁移（WebView 无 `capturePage` 等价 API）
- [x] P6 CSS 整理 v1：`style/tokens.css` 契约 + 移除 4 个散落 `:root` + `npm run lint:css` 校验
- [x] 验证基建：`cargo test`（22 个用例）、`npm run check:tauri`、`npm run lint:css`、`npm run check:ipc`、CI `rust` job
- [x] 端到端自检：`smoke`（打开文档）/ `quickopen`（Rust 检索）/ `print`（打印视图）/ `pdf`（WebView2 出 PDF）/ `perf`（读写耗时）
- [x] 运行验证：`cargo build` + 启动 + 渲染层 ready 上报（macOS）
- [x] P6b 主题令牌一致性：6 个主题全部声明 12 个主题令牌（pixyll 由 1 补到 13）
- [ ] P6c 基础层剩余硬编码颜色收敛到 token（codemirror.css 的语法调色板有意保留）

### 通道覆盖率

两个口径，用途不同：

| 口径           | 数值             | 含义                                                                              |
| -------------- | ---------------- | --------------------------------------------------------------------------------- |
| 旧主进程实现   | 144 / 180（80%） | 迁移保真度：Electron 真做过的通道，Tauri 覆盖了多少                               |
| 渲染层实际调用 | 125 / 221（57%） | 运行时风险面：渲染层会调 221 个，其中 96 个无实现（多数在 Electron 里也是空实现） |

第二个口径由 `npm run check:ipc` 守护：缺口清单固化成基线，**新增未实现通道会让 CI 失败**，
避免后续改动悄悄引入新的空实现。

### 已知未完成项（按优先级）

1. `export.*` / `document.*` 通道目前返回 `null`（渲染层不会崩，但导出功能不可用）。
2. 菜单：应用菜单只有系统级项；**渲染层驱动的弹出菜单已实现**（`menu.popup`
   按 Electron 模板构建 Tauri 菜单，点击后在该窗口执行 `clickCode`）。
   业务菜单树（新建/保存/导出/主题）与 `menu.update` 勾选同步仍未接入。
3. 多窗口基础设施已就绪：`windows.rs` 统一创建 + bootstrap 注入，`doc-*` / `welcome` /
   `license` label 均进入 capabilities；欢迎页与许可页已能独立打开（页面通过
   `window._options` 读平台与授权状态，不依赖查询串）。偏好设置仍是主窗口内的面板。
   打开文件夹时会把 `mountFolder` 注入新窗口的 boot options（渲染层启动即读），
   文件则等页面就绪后调 `doSwitchByNode`。当前文档路径按窗口 label 分别记录，
   `document.hasDuplicateName` 因此能做真正的跨窗口同名判断。
4. `renderer_root()` 在打包后指向源码目录，P5 需改为 `resource_dir()` 并把 `static/` 作为资源打包。
5. ~~Rust 代码未经编译~~ —— 已在 workspace 内安装本地工具链（`.toolchain/`，已 gitignore）
   并完成验证：`cargo build` 通过、`cargo test` 17/17、`npm test` 272/272。
   实测 `register_uri_scheme_protocol` 的 `(|ctx, request|)` 签名与
   `Response<Cow<'static, [u8]>>` 返回体在当前 Tauri 2.12 上正确。
