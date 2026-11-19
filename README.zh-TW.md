<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>

<h1 align="center">ArborMark · 簡築</h1>

<p align="center">本地優先、所見即所得的桌面 Markdown 編輯器</p>

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
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark 主介面：左側大綱面板，右側所見即所得編輯區">
</p>

---

## 簡介

ArborMark（中文名「簡築」）是一款現代、輕量、高效能的桌面級所見即所得 Markdown 編輯器。後端採用 **Tauri 2 + Rust** 打造原生基座，前端採用 **React 19 + Milkdown（ProseMirror）** 提供即時排版反饋，源碼模式則配備專業的 **CodeMirror 6** 純文字引擎。

它將 Markdown 的純粹與富文字排版的即時性結合在一起：邊寫邊渲染，隨時按下快速鍵（`⌘/Ctrl + /`）即可無縫切換到純代碼模式。所有文件始終以標準 `.md` 純文字儲存在本機——**零帳號綁定、零資料上傳、完全隱私優先**。

- 專案倉庫：<https://github.com/Arbor4/ArborMark>
- 問題回報：<https://github.com/Arbor4/ArborMark/issues>
- 下載安裝檔：<https://github.com/Arbor4/ArborMark/releases>

---

## 核心優勢

| 指標 / 維度 | ArborMark（簡築） | 傳統 Electron Markdown 編輯器 | 帶來效益 |
| :--- | :--- | :--- | :--- |
| **安裝包體積** | **~15 MB** | 120 MB ~ 180 MB | 🚀 **縮小 90%**，秒級下載安裝，不佔磁碟 |
| **記憶體佔用** | **~50 MB - 80 MB** | 300 MB ~ 600 MB+ | 🍃 極致省電輕快，多開視窗、背景長駐毫無負擔 |
| **啟動速度** | **< 300 ms** 毫秒級快啟 | 2 秒 ~ 4 秒冷啟動 | ⚡ 隨點即開，隨時記錄靈感 |
| **本機優先** | **100% 離線隱私** | 強制聯網登入 / 依賴雲端同步 | 🔒 隱私絕對安全，資料完全歸使用者所有 |
| **雙核引擎** | **Milkdown (ProseMirror) + CodeMirror 6** | 單一 Webview 或分屏預覽 | 🎨 即時排版與專業代碼編輯兩者兼得 |
| **多視窗架構** | **原生多視窗 (⌘⇧N)** | 多分頁卡頓或雙倍記憶體 | 🪟 多文件獨立開闢視窗，並行參考寫作 |

---

## 功能特色

| 功能 | 說明 |
| :--- | :--- |
| 所見即所得 | 邊寫邊渲染；標題、表格、公式、圖表、程式碼區塊均支援原位點擊編輯 |
| 雙模原始碼 | CodeMirror 6 純文字編輯，吸頂行號列、程式碼折疊與語法醒目提示，⌘/Ctrl + / 秒級切換 |
| 輕量效能 | 安裝包僅 ~15MB，待機記憶體僅 ~60MB，冷啟動 <300ms，超長文章虛擬視口延遲渲染 |
| 人性化體驗 | 打字機模式、專注模式、無選取範圍時整行複製/剪下（⌘C / ⌘X）、按住 Ctrl/⌘ 滾輪縮放字型大小 |
| 檔案與導覽 | 資料夾樹、平鋪清單、標題大綱、快速開啟（⌘P）、全域搜尋（⌘⇧F） |
| 偏好設定系統 | 獨立的檔案、外觀、編輯器、Markdown、圖片、匯出與一般設定，支援換行符號（LF/CRLF）、預設副檔名與原廠還原 |
| 高頻編輯增強 | 無選取範圍時整行複製/剪下（⌘C / ⌘X）、按住 Ctrl/⌘ 滑鼠滾輪縮放字型大小、成對符號智慧配對 |
| 表格增強 | 懸浮行列工具列；原位增刪行列、拖曳調整欄寬與重排列/欄 |
| 數學公式 | KaTeX 行內與區塊 LaTeX，原位點擊編輯 TeX 程式碼，可選公式自動編號 |
| 圖表 | Mermaid、Flowchart.js、Sequence 原位編輯與自適應比例渲染，長文延遲渲染 |
| 圖片與 PDF | 拖曳與貼上落盤、相對路徑偏好；應用程式內縮放檢視器、按兩下還原、PDF 預覽 |
| 多視窗支援 | 原生獨立多視窗工作流程（⌘⇧N），多任務互不干擾 |
| 匯入匯出 | PDF / HTML（含樣式/純淨）匯出；安裝 Pandoc 後支援 Word / EPUB / LaTeX 轉換 |
| 佈景主題 | 多套精選內建主題（含 **Liquid Glass**）+ 使用者 CSS/JSON 自訂主題熱載入 |
| 全球多語言 | 繁體中文、簡體中文、English、日本語、한국어、Deutsch 等 16+ 種語言介面與原生選單同步 |
| 安全儲存 | 切換檔案自動儲存、輸入微防手震寫入、已修改狀態追蹤、本機檔案當機復原 |
| 命令列與拖曳 | 命令列或拖曳檔案/資料夾到應用程式即可快速開啟或匯入 |

## 下載與安裝

前往 [Releases](https://github.com/Arbor4/ArborMark/releases) 下載對應平台的安裝檔：

- macOS：`.dmg` / `.zip`
- Windows：NSIS 安裝程式 / 免安裝 `.zip`
- Linux：`.AppImage` / `.deb`

macOS 首次開啟若被系統攔截，可在「系統設定 → 隱私權與安全性」中允許開啟。

## 本地開發

### 環境需求

- Node.js **20+**
- npm 10+
- macOS / Windows / Linux

### 啟動

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install
npm run build
npm start
```

開發模式（建置頁面與執行環境後啟動 Electron）：

```bash
npm run dev
```

如需產生安裝檔：

```bash
npm run dist:mac
```

### 測試

```bash
# 單元測試 + 整合測試
npm test

# 端對端測試（需要可用的桌面環境）
npm run test:e2e
```

### 打包

```bash
npm run dist:mac     # macOS dmg / zip
npm run dist:win     # Windows nsis / zip
npm run dist:linux   # Linux AppImage / deb
```

> 日常開發不建議頻繁打包；`npm start` 即可載入最新程式碼。

## 專案結構

```text
ArborMark/
├── src/
│   ├── main/                  # Electron 主程序（視窗、選單、IPC、通訊協定、儲存）
│   ├── preload/               # 內容隔離與安全橋接
│   ├── renderer/
│   │   ├── core/              # 編輯器核心、選取範圍、復原／重做
│   │   ├── block/             # 程式碼區塊、表格、公式、圖表、圖片
│   │   ├── markdown/          # Markdown 解析與序列化
│   │   ├── io/                # 檔案、匯出、剪貼簿、Pandoc
│   │   ├── ui/                # 選單、側邊欄、大綱、搜尋、檔案樹
│   │   ├── pages/             # React 偏好設定／歡迎／授權頁面
│   │   ├── vendor/            # 第三方執行環境（CodeMirror、jQuery、Rangy 等）
│   │   └── static/            # 宿主 HTML、主題、內建文件、圖示
│   └── shared/                # 主程序與渲染層共用常數
├── tools/                     # 建置與測試腳本
├── test/                      # 單元、整合、端對端測試
├── resources/                 # 應用程式圖示與安裝素材
└── docs/                      # 架構與第三方元件說明
```

更詳細的模組說明請見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 設計說明

- **本地優先**：文件、圖片、主題與設定預設都放在本機，不依賴帳號或雲端服務。
- **純文字**：所有內容都存成標準 Markdown，隨時可以用其他編輯器開啟。
- **可擴充主題**：主題是普通 CSS 檔案，放進使用者主題資料夾就會自動被發現。
- **安全邊界**：渲染程序只透過 preload 暴露最小 API，外部連結會經過通訊協定白名單檢查。
- **可維護性**：主程序、渲染層、共用層分離，核心模組都有回歸測試。

應用程式內的 **說明 → Markdown 功能範例** 可以開啟完整語法範例，原始檔為 [Markdown Demo.md](src/web/src/bridge/demo/markdown-full-demo.md)。

## 參與貢獻

歡迎提交 Issue 與 Pull Request。

1. Fork 本倉庫並建立分支：`feat/your-feature` 或 `fix/your-fix`
2. 提交前執行相關測試：`node tools/run-tests.mjs test/unit/<test>.test.mjs`
3. 提交訊息請使用語意化格式，例如：
   - `feat(editor): 支援新的程式碼區塊語言`
   - `fix(export): 修正 PDF 匯出圖片遺失`
4. 在 PR 中說明變更內容、測試方式與介面截圖（若涉及介面）。

提交程式碼即表示你同意以本專案的開源授權條款散布你的貢獻。

## 開源授權

本專案採用 **GNU General Public License v3.0 or later（GPL-3.0-or-later）**。

你可以自由：

- 使用、複製、修改本專案
- 散布修改後的版本
- 將本專案用於商業用途

但必須遵守 GPL 的 copyleft 要求：**散布衍生作品時，必須同樣以 GPL-3.0-or-later 開源，並提供完整原始碼**。本專案不提供任何擔保。

完整條款請見 [LICENSE](LICENSE)。

> 為什麼選擇 GPL-3.0：它是成熟且強力的 copyleft 授權，適合完整的桌面應用程式；與專案內建的 MIT / Apache-2.0 元件相容，同時能避免衍生版本閉源後再以同類產品散布。

## 第三方元件

本專案使用了以下優秀的開源專案：

- [Electron](https://www.electronjs.org/)（MIT）
- [CodeMirror](https://codemirror.net/5/)（MIT）
- [MathJax](https://www.mathjax.org/)（Apache-2.0）
- [Mermaid](https://mermaid.js.org/)（MIT）
- [jQuery](https://jquery.com/)（MIT）
- [Rangy](https://github.com/timdown/rangy)（MIT）
- [DOMPurify](https://github.com/cure53/DOMPurify)（Apache-2.0 / MPL-2.0）
- [React](https://react.dev/)（MIT）

完整著作權與授權資訊請見應用程式內的 **說明 → 致謝**，以及各相依套件自帶的 LICENSE 檔案。

## 免責聲明

ArborMark 是獨立的開源專案，與任何第三方商業 Markdown 編輯器沒有隸屬、授權或合作關係。專案中的名稱、圖示與介面素材皆為原創或已取得授權；第三方元件的著作權歸各自作者所有。

若你認為本專案內容侵害你的權利，請透過 [Issues](https://github.com/Arbor4/ArborMark/issues) 與我們聯絡，我們會儘快處理。

---

Copyright © 2026 Arbor · ArborMark contributors
