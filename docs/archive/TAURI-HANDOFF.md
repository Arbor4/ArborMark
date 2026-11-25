# ArborMark · Tauri 2 + Rust 交接说明

分支：`feat/tauri-rust`。渲染层保持原样，主进程 / IPC / Node 兼容层改由 Rust 实现，
构建与 CI 换成 Tauri。详细设计见 [TAURI-MIGRATION.md](TAURI-MIGRATION.md)。

## 1. 现在能做什么

| 能力                                | 状态 | 验证方式                                                                                                  |
| ----------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| 启动、加载渲染层                    | ✅    | `hasEditor=true`（启动日志）                                                                              |
| 打开 Markdown（读盘 → 解析 → 渲染） | ✅    | `ARBORMARK_SELFTEST=smoke` 退出码 0                                                                       |
| 主题切换（6 个主题）                | ✅    | 每个主题都声明 13 个契约令牌，`lint:css` 通过                                                             |
| 快速打开 Cmd+P                      | ✅    | `ARBORMARK_SELFTEST=quickopen` 返回 600 个文件                                                            |
| 打印（含"存储为 PDF"）              | ✅    | `ARBORMARK_SELFTEST=print`                                                                                |
| 多窗口、原生菜单、弹出菜单          | ✅    | 332 项菜单（含帮助）/ 247 个命令项；`menu.update` 勾选同步已验证                                          |
| 打包（含主题/文档资源）             | ✅    | macOS arm64/x64 各一个 DMG（并行构建），单架构约 38.4 MiB；打包产物实测 19 个样式表、bootstrap 241 条规则 |
| 偏好设置                            | ✅    | 主窗口内嵌 `<iframe>`（不再单独弹窗），`setting.getExtraOption` 提供 locale/路径                          |

## 2. 怎么验证

```bash
# 工具链在本仓库内（已 gitignore）
export PATH="$PWD/.toolchain/cargo/bin:$PWD/.toolchain/node/bin:$PATH"
export CARGO_HOME="$PWD/.toolchain/cargo" RUSTUP_HOME="$PWD/.toolchain/rustup"

npm test                 # 126 个 Node 单测
npm run check:tauri      # 版本号 / frontendDist / 图标 / 窗口 label / CSP / bootstrap 语法
npm run lint:css         # CSS 分层契约
npm run check:ipc        # IPC 覆盖率守卫（基线 96 个未实现）

cd src-tauri && cargo test --lib   # 22 个 Rust 单测（协议、状态、检索）

# 端到端自检（可对 debug 或 release 产物跑）
ARBORMARK_DATA_DIR=$PWD/.test-data ARBORMARK_SELFTEST=smoke \
  ./src-tauri/target/release/bundle/macos/ArborMark.app/Contents/MacOS/ArborMark
echo $?   # 0 = 通过
```

其余自检模式：`quickopen`、`print`、`perf`、`rawfs`。

## 3. 架构要点

```
WebView（原渲染层，未改）
  ├─ JSBridge.invoke(channel, payload)  → Rust ipc_invoke（按通道分发）
  ├─ window.reqnode("fs"|"path"|...)     → 回环 HTTP 同步桥（sync XHR）
  └─ Worker（快速打开）                  → quick-open-worker-shim.js → Rust 检索
自定义协议：arbormark://app/{typemark,userData,tempfile}/...
```

- 同步桥存在的原因：渲染层有 96 处同步 `fs.*Sync` 调用，WebView 里没有同步 IPC。
- 快速打开把"循环"搬进 Rust（一次请求扫描 600 个文件），Worker 只做协议转接。
- 主题走 `tokens.css` 的 12 个令牌契约，基础层不引用主题变量。

### CI 打包策略

> 本机 Windows 打包（环境、命令、NSIS/MSI 差异、踩坑清单）见 [BUILD-WINDOWS.md](BUILD-WINDOWS.md)。

macOS 不再构建 universal 包：`--target universal-apple-darwin` 会把 Rust 依赖完整编译两遍
（aarch64 约 3 分钟 + x86_64 再约 3 分钟）。现在矩阵里两个 macOS job 并行，各自
`--target aarch64-apple-darwin` / `x86_64-apple-darwin`，Release 里得到两个 DMG。
缓存按 `matrix.label` 分开，避免互相覆盖；tag 构建的缓存作用域另见 GitHub Actions 说明。

Rust 编译时间构成（冷缓存、GitHub 2 核 runner）：

- `swatinem/rust-cache` 已用于 Rust 测试与四个打包 job；它只能加速**第二次及以后**的构建，
  tag 构建首次仍可能拿不到分支缓存。
- macOS 两个架构并行后，墙钟约为单架构时间，而不是两遍。
- Linux 的 `cargo test` 与打包都启用 `lld`（`-C link-arg=-fuse-ld=lld`），跳过 GNU ld 的慢链接。
- CI 的发布构建用 `CARGO_PROFILE_RELEASE_LTO=thin` + `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16`，
  替代 `Cargo.toml` 里的 fat LTO + 单 codegen unit；二进制略大，但链接时间明显下降。
- NSIS / WiX / 离线 WebView2 安装器缓存到 `tauri` 工具缓存目录，避免 Windows 每次重下约 130 MB。
- 六个打包 job 按平台 + CPU 架构拆分：macOS arm64/x64 DMG、Windows x64/arm64 NSIS+MSI、
  Linux x64/arm64 deb+AppImage。Windows ARM64 使用 `windows-11-arm` runner 原生编译
  `aarch64-pc-windows-msvc`；Linux ARM64 使用 `ubuntu-22.04-arm` + `aarch64-unknown-linux-gnu`。

发布流程（避免 `Error: other side closed`）：

- 六个 `build-installers` job **只构建**，用 `actions/upload-artifact` 上传安装包；
- 单独一个 `publish-release` job 下载全部 artifact，再统一 `gh release create/upload --clobber`；
- 不再给 `tauri-action` 传 `tagName` / `releaseName`，否则六个 job 会并发创建同一个
  Release，并撞上同名的 macOS `ArborMark.app.tar.gz`；
- 上传失败自动重试 3 次； 
- tag 版本与 `package.json` / `Cargo.toml` / `tauri.conf.json` 不一致时，`test` job 直接失败，
  不再带着旧版本号打包。

### 菜单树从哪来

`src-tauri/menu-spec.json` 由旧版 `src/main/menu/menu-builder.js`（commit `3ff646d^`）
导出，保留原路径式 id（`View→Source Code Mode`）与渲染层 `menu.update` 的契约。
旧文件已随 Electron 主进程删除，后续增删菜单项**直接编辑该 JSON** 即可：

- `type: "checkbox"` → 原生勾选项，`checked` 是初始状态；
- `clickCode` → 点击后在当前窗口执行的 JS；
- `role` → 预定义菜单项（copy/quit/minimize…）；
- `dynamic: "recentFiles" | "recentFolders"` → 由 Rust 从最近列表生成。

## 4. 已知限制

| 项                           | 原因                                                                                                                          | 影响                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ~~导出 PDF（`printToPDF`）~~ | 已修复：Windows 走 WebView2 `ICoreWebView2_7::PrintToPdf`（`ARBORMARK_SELFTEST=pdf`）；macOS/Linux 无等价 API                 | macOS/Linux 回落"打印 → 存储为 PDF"（丢书签与页眉页脚）                                     |
| 长图导出（`captureImage`）   | 无 `capturePage` 等价 API                                                                                                     | ✅ Windows 用隐藏 WebView2 `CapturePreview` 分段出图，拼接仍由渲染层 image-worker 完成       |
| ~~业务菜单树~~               | 已实现：菜单树由 `src-tauri/menu-spec.json` 驱动（332 项，含帮助菜单），`menu.update` 已接通勾选/启用状态                     | —                                                                                           |
| 基础层少量硬编码颜色         | 视觉决策，逐条需回归                                                                                                          | 主题切换基本一致，个别控件沿底色                                                            |
| ~~快通道~~                   | 已修复：IPC 自定义协议在此 WebView 下失败并回退到 postMessage（字节被 JSON 化），改用 `arbormark://app/__read__/…` 直接取字节 | 2MB 读从 70ms 降到 **1ms**                                                                  |
| CI 工作流未实跑              | 需要在远端推分支                                                                                                              | 本地全部检查通过                                                                            |
| 打包产物缺主题/图标样式      | `arbormark://` 协议按磁盘路径读 `style/`、`Docs/`，而 `frontendDist` 只把资源嵌进二进制                                       | 已在 `bundle.resources` 里把 `src/renderer/static` 映射到 `renderer/`；`check:tauri` 会校验 |

## 5. 需要你做的事

1. 推送 tag（或手动 Run workflow），确认六平台 CI（`tauri-action` 矩阵）真的绿。
2. 决定菜单树与长图导出的产品取向（PDF 已可用，见上表）。
3. ~~删除遗留 Electron 代码~~ —— 已完成：`src/main/**`、`src/preload/**`、
   `test/e2e/**`、`scripts/pack.mjs`（Electron 打包脚本）以及 31 个依赖
   `src/main` 的单测文件已删除。`npm test` 从 272 个用例降到 105 个（后又补回菜单/偏好设置/主题 token 回归，现为 125 个），
   减少的部分都是针对已删除主进程代码的测试；后端覆盖由 24 个 Rust 测试承担。

## 6. 踩过的坑（给后来者）

| 现象                                                                                   | 根因                                                                                                                                                                            |                                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| 应用白屏、无任何报错                                                                   | `bootstrap.js` 语法错误（`shift-jis:` 未加引号）；现在 `check:tauri` 会做语法检查                                                                                               |                                                                                                              |
| 只加载出外壳、编辑器不出来                                                             | 模块加载器用 `fileURLToPath` 解析 `tauri://` 地址失败                                                                                                                           |                                                                                                              |
| 设置夜间主题却始终白底                                                                 | `theme.setThemeSource("system")` 被当成主题名写进 `curTheme`                                                                                                                    |                                                                                                              |
| 打开文档卡死                                                                           | `statSync` 返回普通对象，`stats.isDirectory()` 抛错导致 `loadFile` 无限递归                                                                                                     |                                                                                                              |
| 文档显示成 `35,32,83,...`                                                              | 兼容层 Buffer 没实现 `toString`，退化成 `Uint8Array.prototype.toString()`                                                                                                       |                                                                                                              |
| 读文件得到空字符串                                                                     | 缺少 `jschardet` / `iconv-lite`                                                                                                                                                 |                                                                                                              |
| 偏好设置窗口丢失语言/主题目录                                                          | 设置页启动时会用 `setting.getExtraOption` 覆盖 `window._options`，通道返回 null 就退回英文                                                                                      | 通道改为返回完整 boot options                                                                                |
| 复制文件路径/链接没有反应                                                              | `clipboard.write` 收到的是 `JSON.stringify({html,text})` 字符串，Rust 侧只按对象取 `text`                                                                                       | 先解析字符串再写剪贴板                                                                                       |
| Mermaid 报 `kr.get(x.id).node` / `Cannot set properties of undefined (setting 'node')` | 代码优先用了 Mermaid 11 已废弃的 `mermaid.mermaidAPI.render`，它不接受容器参数                                                                                                  | 优先 `mermaid.render`（当前 API）；渲染串行化并兜底重试                                                      |
| 多个 Mermaid 同时渲染偶发内部错误                                                      | Mermaid 11 的全局 DB 不适合并发 render                                                                                                                                          | 渲染串行化                                                                                                   |
| 桌面文件拖进窗口不打开                                                                 | WKWebView 不提供 `File.path`，Tauri 在原生层接管拖放                                                                                                                            | 监听 `tauri://drag-drop` 打开 Markdown/图片/目录；拖入时显示蒙版提示；`webUtils.getPathForFile` 按文件名回填 |
| 大纲选中项跟随滚动有明显延迟                                                           | 之前只监听 `post-wheel`（500ms 防抖，busy 2s）                                                                                                                                  | 直接监听 `content` 的 scroll，80ms 前沿+尾随节流；实测首次切换 19ms、连续滚动约 74ms                         |
| 树视图新建文件后整列节点被左侧裁掉                                                     | 重命名 input 的默认 `size` 把 `display:table` 的文件树撑宽，聚焦时横向滚偏                                                                                                      | 重命名输入框改为绝对定位，不参与表格宽度；列表视图禁用横向滚动；`path.resolve` 不再保留末尾分隔符            |
| 点击图表后预览消失、只剩空白                                                           | 主题给 `#write pre.md-fences` 设了 `overflow:auto`；聚焦后 `.md-diagram-panel` 变成绝对定位并伸出代码块，被父级裁掉                                                             | 聚焦的高级代码块放开为 `overflow:visible`                                                                    |
| 玻璃主题代码块选中像“两层蓝”                                                           | CodeMirror 同时给 `.CodeMirror-selected` 与 `.CodeMirror-selectedtext` 上底色；半透明选区 token 叠成两层                                                                        | 文字层背景改为 transparent，只保留背景层                                                                     |
| 许可证窗口拖大后底部/右侧露白                                                          | 窗口可缩放，但页面按 530×440 设计稿排版                                                                                                                                         | 许可窗口禁用缩放；`html/body/#root/.page` 背景统一，放大也不露白                                             |
| 许可证页文字偏左、文字下方一大块空白                                                   | 固定 525px 文案框用 `left:0`，窗口又按 640×560 打开；CSS 是按 530×440 设计的                                                                                                    | 文案改 `left:50% + translateX(-50%)`，窗口恢复 530×440                                                       |
| 列表摘要里的中文变乱码                                                                 | 摘要只读前 600 字节，截断 UTF-8 多字节字符后 `jschardet` 误判成 windows-1252                                                                                                    | `detectEncodeByNode` 去掉末尾 1–3 字节再判断                                                                 |
| 主题卡片点击后没有选中反馈                                                             | `--side-bar-menu-active-tint` 被写死成 `transparent`，勾选图标与边框都不可见                                                                                                    | 改为 `var(--primary-color)`，并由主题 token 测试锁住                                                         |
| 点另一个文件"没反应"（标题变了、正文还是上一篇）                                       | `fs.watch` 返回的对象只有 `on/close`，没有 `removeAllListeners`。`file-info-panel` 第二次切换文档时抛 `TypeError`，而这行在 `resetEditorWithContent` 之前，正文渲染被整段跳过   |                                                                                                              |
| 文章列表全空、树视图正常                                                               | `fs-plus` 是 `fs` 的浅拷贝快照，之后才加上的 `createReadStream` 没有同步过去；列表读摘要时抛错，`appendItemToView` 一条都不会执行                                               |                                                                                                              |
| 偏好设置改完、重启后全部回到默认值                                                     | 旧渲染层用 `invoke("setting.put", key, value)` 两参数调用；`electronShim.ipcRenderer.invoke` 只声明了 `(channel, payload)`，第二个参数被丢掉，Rust 只收到 key，写入 `key: null` |                                                                                                              |
| 语言下拉框切换后界面仍是中文                                                           | `windows::boot_options` 把 `userLocale` / `locale` 硬编码成 `zh-Hans`，且只合并了 5 个设置键；`userLanguage` 从未参与启动参数                                                   |                                                                                                              |
| 重新打开应用不恢复上次的文件和目录                                                     | `recent.json` 只存最近列表，没有 `lastSession`；启动时也没有读取 `restoreWhenLaunch` / `pinFolder`                                                                              |                                                                                                              |
| 重命名/保存后其他窗口路径不更新                                                        | `app.sendEvent` 收到的是 `[name, payload]` 数组，Rust 只认 `{event, payload}`；同时事件名直接 emit，bootstrap 固定监听 `arbor-event`，且回调只传了一个参数                      |                                                                                                              |
| 标题栏的修改标记不出现/不消失                                                          | `window.setTitle(undefined, true)` 被 preload 打包成 `[null, true]`；Rust 只认字符串或 `{title}`                                                                                |                                                                                                              |
| 切到英文后原生菜单仍是中文                                                             | `menu-spec.json` 的 label 是简体中文，构建菜单时没有按当前 locale 查 `Menu.json`                                                                                                |                                                                                                              |
| 打开文件时侧边栏没有挂载目录                                                           | `app.openFileOrFolder(path, { mountFolder })` 的第二个参数被多参数问题丢掉；`new_window` 也没有从数组形态里取 options                                                           |                                                                                                              |
| Windows 安装界面全是英文                                                               | NSIS 默认 `languages = ["English"]`，WiX 默认 `en-US`；`tauri.conf.json` 没有覆盖                                                                                               |                                                                                                              |
| Windows 安装完成后双击没反应                                                           | `setup` 里 `menu::install(...)?` / `nodebridge::start(...)?` / `windows::build(...)?` 任一失败都会让 GUI 进程静默退出；`windows_subsystem = "windows"` 没有控制台可看           |                                                                                                              |
| Windows 顶部窗口栏/留白仍显示输入光标                                                  | `#write{cursor:text}` 覆盖了编辑器的 `padding-top`，而 native 模式下 `header` 高度为 0，这块留白就在窗口顶部                                                                    |                                                                                                              |
| Windows 缺少 WebView2 时只看到空白/闪退                                                | 默认 `downloadBootstrapper` 需要联网；安装器没有把运行时带进来                                                                                                                  |                                                                                                              |

共同点：**名字像 A、实际是 B 的通道语义**。光看通道名猜不出来，必须读调用点。
