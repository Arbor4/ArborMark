# ArborMark · Windows 安装包打包指南

> 适用于在 Windows 本机从源码构建 NSIS / MSI 安装包。CI 矩阵策略见 [TAURI-HANDOFF.md](TAURI-HANDOFF.md)。

## 1. 环境要求

| 依赖             | 要求                              | 检查命令                               |
| ---------------- | --------------------------------- | -------------------------------------- |
| Node.js          | ≥ 20                              | `node -v`                              |
| Rust (MSVC)      | stable                            | `cargo --version`                      |
| VS Build Tools   | C++ 工作负载（链接器 `link.exe`） | 装过 `rustup` 的 windows-msvc 默认即可 |
| WebView2 Runtime | 系统自带（Win11）                 | 打包不需要，运行需要                   |

依赖安装（**两处**，容易漏第二处）：

```powershell
npm install                      # 根目录：@tauri-apps/cli
npm --prefix src/web install     # 前端：React/CodeMirror/Milkdown 等
```

## 2. 一键打包

```powershell
npm run dist:win          # NSIS exe + MSI msi（推荐）
npm run dist:win:exe      # 仅 NSIS
```

内部执行 `tauri build --bundles nsis,msi`，流程：

1. `beforeBuildCommand`：`tsc --noEmit && vite build` 产出 `src/web/dist`
2. `cargo build --release`（首次约 3–10 分钟，增量约 2 分钟）
3. 下载并缓存 NSIS / WiX / WebView2 bootstrapper 到 `%LOCALAPPDATA%\tauri\`
4. 产出安装包（见下）

产物：

```
src-tauri\target\release\bundle\nsis\ArborMark_<版本>_x64-setup.exe
src-tauri\target\release\bundle\msi\ArborMark_<版本>_x64_en-US.msi
```

## 3. 两种安装器的差异（tauri.conf.json `bundle.windows`）

|            | NSIS (.exe)                         | MSI (.msi)                                                                   |
| ---------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| 安装范围   | 当前用户（免 UAC）                  | 全机器（需 UAC）                                                             |
| 安装位置   | `%LOCALAPPDATA%\Programs\ArborMark` | `%ProgramFiles%\ArborMark`                                                   |
| 界面语言   | 简体中文 / English 可选             | 仅 en-US                                                                     |
| WebView2   | 内嵌 bootstrapper 静默安装          | 同左                                                                         |
| 同版本覆盖 | 正常覆盖升级                        | ProductCode 由版本派生，**同版本号会被判定"已安装"而拒绝**，升级务必递增版本 |

## 4. 发版前检查

- 三处版本号一致：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`
- 目标机器若存在**另一种安装形态**（如先装过 MSI 再装 NSIS），先在「设置 → 应用」卸载旧版，避免双份卸载入口与文件关联混乱
- 安装包未做代码签名：首次运行会有 SmartScreen 蓝窗，点「更多信息 → 仍要执行」

## 5. 踩过的坑（按出现频率） 

1. **`npm run dist:win` 报前端构建失败**：漏了 `npm --prefix src/web install`。
2. **esbuild `spawn EPERM` / `Access is denied`（临时目录）**：在受限沙箱（AI agent 终端等）里构建时，esbuild 无法读写 `%TEMP%`。解决：构建前把 `TMP`/`TEMP` 指到工作区内目录（`$env:TMP=(Resolve-Path .tmp).Path`，构建完清理）。
3. **运行安装器报「Error writing temporary file」**：NSIS 引导进程向 `%TEMP%` 解压自身时与 Defender/SmartScreen 瞬时冲突，重试即可；反复出现就换 MSI。
4. **安装器双击后无界面挂起**：常见于旧版应用正在运行、或旧版是全机器 MSI 需要提权卸载。先关闭应用、卸载旧版再装。
5. **从 agent 终端启动 GUI 应用秒退**：agent 的 Windows Job Object 会在包装进程退出时连带杀死应用（WebView2 子进程被强杀后还会短时间独占数据目录，导致下次启动报 `0x800700AA 资源在使用中`）。测试安装包请**在桌面直接双击**；如遇该报错，等 30–60 秒或重启后再试。
6. **`RunEvent::Opened` 编译不过（Windows）**：该变体仅 macOS 存在，跨平台代码必须 `#[cfg(target_os = "macos")]` 门控（见 `src-tauri/src/lib.rs`）。
7. **Windows 上 `arbormark://` 自定义协议子资源请求不回调**：PDF/媒体预览统一走 IPC 读字节 + `blob:` URL（`FilePreview.tsx`），不要新增协议 iframe。

## 6. 快速验证产物

```powershell
Get-ChildItem src-tauri\target\release\bundle -Recurse -File |
  Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
```

时间戳应为本次构建时刻；NSIS 约 6.6 MB、MSI 约 7.5 MB。
