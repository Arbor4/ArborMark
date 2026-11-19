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
  <img src="https://img.shields.io/badge/version-4.0.0-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark 主介面：左側大綱面板，右側所見即所得編輯區">
</p>

---

## 簡介

ArborMark（中文名「簡築」）是一款獨立開發的桌面 Markdown 編輯器，基於 **Electron** 與自研富文字排版引擎打造。

它把 Markdown 的簡潔與富文字的直觀放在同一個介面裡：輸入時即時渲染，需要時一鍵切換到原始碼模式；文件始終以純文字 `.md` 保存在本機，不鎖定格式，也不依賴雲端。

- 專案倉庫：<https://github.com/Arbor4/ArborMark>
- 問題回報：<https://github.com/Arbor4/ArborMark/issues>
- 下載安裝檔：<https://github.com/Arbor4/ArborMark/releases>

## 功能特色

| 功能 | 說明 |
| :--- | :--- |
| 即時預覽 | 輸入即渲染，游標所在區塊可顯示 Markdown 原始碼 |
| 原始碼模式 | 一鍵切換純文字編輯，適合精修 Markdown |
| 大綱與檔案樹 | 標題大綱、資料夾樹、清單檢視與全域搜尋 |
| 擴充語法 | 表格、待辦清單、腳註、YAML Front Matter、上標／下標、醒目提示 |
| 數學公式 | 行內與區塊 LaTeX（MathJax），支援自動編號 |
| 圖表 | Mermaid（流程圖、時序圖、類別圖、狀態圖、甘特圖、圓餅圖）、Flowchart.js、Sequence |
| 圖片處理 | 拖放插入、相對路徑、複製到指定資料夾、圖床的上傳 |
| 匯入匯出 | PDF、HTML、圖片，以及透過 Pandoc 的 Word / EPUB / LaTeX 等格式 |
| 主題 | 內建多套主題，macOS 預設為 **Liquid Glass** |
| 多語系 | 40 個語言包，跟隨系統或手動切換 |
| 安全儲存 | 自動儲存、崩潰復原、未儲存草稿復原 |
| 命令列 | 支援從命令列開啟檔案或資料夾 |

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
