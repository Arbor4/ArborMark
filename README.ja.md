<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>

<h1 align="center">ArborMark</h1>

<p align="center">ローカルファーストの WYSIWYG Markdown エディター</p>

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
  <img src="https://img.shields.io/badge/version-4.0.4-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark のメイン画面：左側がアウトラインパネル、右側が WYSIWYG 編集エリア">
</p>

---

## はじめに

ArborMark（中国語名：簡筑）は、ネイティブ基盤に **Tauri 2 + Rust**、リアルタイム描画に **React 19 + Milkdown（ProseMirror）**、そしてソースモードに産業グレードの **CodeMirror 6** を採用した、極めて軽量で高性能なデスクトップ向け WYSIWYG Markdown エディターです。

Markdown の簡潔さとリッチテキストの即時性を融合させ、入力しながらリアルタイムに描画され、ショートカット（`⌘/Ctrl + /`）ひとつで即座にソースモードへ切り替えられます。すべての文書は標準の `.md` ファイルとしてローカルに保存されます。**アカウント登録不要、データ送信ゼロ、完全なプライバシー優先**です。

- リポジトリ：<https://github.com/Arbor4/ArborMark>
- 問題報告：<https://github.com/Arbor4/ArborMark/issues>
- ダウンロード：<https://github.com/Arbor4/ArborMark/releases>

---

## 主な特長・優位性

| 指標 / 観点 | ArborMark | 従来の Electron 系 Markdown エディタ | メリット |
| :--- | :--- | :--- | :--- |
| **インストーラー容量** | **~15 MB** | 120 MB ~ 180 MB | 🚀 **約 90% 削減**、瞬時にダウンロード完了 |
| **メモリ消費** | **~50 MB - 80 MB** | 300 MB ~ 600 MB+ | 🍃 圧倒的に省リソース。複数ウィンドウ起動も軽快 |
| **起動速度** | **< 300 ms** 瞬時起動 | 2 秒 ~ 4 秒（ロード待ち） | ⚡ ひらめいたアイデアを待たずに即記録 |
| **ローカルファースト** | **100% オフライン完全保護** | クラウド必須 / アカウント強制 | 🔒 個人情報・業務データを一切外部へ送信しません |
| **デュアルエンジン** | **Milkdown + CodeMirror 6** | 単一 Webview または左右分割画面 | 🎨 WYSIWYG 編集と高度なコード編集を両立 |
| **マルチウィンドウ** | **ネイティブ複数ウィンドウ (⌘⇧N)** | タブ切り替えの重さやメモリ倍増 | 🪟 複数文書を並行して軽快に執筆・参照可能 |

---

## 機能

| 機能 | 説明 |
| :--- | :--- |
| WYSIWYG リアルタイム編集 | 入力と同時に描画。見出し、テーブル、数式、コードブロック、図表をその場で直接編集 |
| デュアルモード（ソース編集） | CodeMirror 6 によるプレーンテキスト編集、行番号固定、コード折りたたみ、構文ハイライト（⌘/Ctrl + / で即座に切替） |
| ファイルとナビゲーション | フォルダーツリー、フラット一覧、見出しアウトライン、クイックオープン（⌘P）、全体検索（⌘⇧F） |
| 環境設定システム | ファイル、外観、エディタ、Markdown、画像、エクスポート、一般設定を独立管理。改行コード（LF/CRLF）や初期化に対応 |
| 高度な編集操作 | 未選択時の行単位コピー/切り取り（⌘C / ⌘X）、Ctrl/⌘ + ホイールによるフォント伸縮、記号の自動ペア補完 |
| テーブルと数式 | ツールバーによる行・列の追加削除、列幅ドラッグ調整。KaTeX による数式その場編集と自動採番 |
| 図表レンダリング | Mermaid、Flowchart.js、Sequence 図のアスペクト比自動維持と遅延レンダリング |
| 画像と PDF | ドラッグ＆ドロップ保存、相対パス設定、アプリ内拡大ビューアーと PDF プレビュー |
| マルチウィンドウ対応 | 完全に独立したネイティブ複数ウィンドウ作業（⌘⇧N） |
| インポート／エクスポート | 高品質 PDF / HTML エクスポート、Pandoc による Word / EPUB / LaTeX 変換 |
| テーマシステム | **Liquid Glass** を含む厳選テーマ + CSS/JSON ユーザーテーマの動的読み込み |
| グローバル多言語 | 日本語、簡体字中国語、繁体字中国語、英語、韓国語、ドイツ語など 16+ 言語とネイティブメニュー同期 |
| 安全な保存 | ファイル切替時の自動保存、入力デバウンス、ダーティ状態追跡、クラッシュセーフ |
| コマンドラインとドラッグ | CLI またはウィンドウへのドラッグでファイルやフォルダーを即座に開く |

## ダウンロードとインストール

[Releases](https://github.com/Arbor4/ArborMark/releases) から各プラットフォームのインストーラーを取得してください。

- macOS：`.dmg` / `.zip`
- Windows：NSIS インストーラー / ポータブル `.zip`
- Linux：`.AppImage` / `.deb`

macOS で初回起動がブロックされた場合は、**システム設定 → プライバシーとセキュリティ** で許可してください。

## 開発

### 必要環境

- Node.js **20+**
- npm 10+
- macOS / Windows / Linux

### 起動

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install
npm run build
npm start
```

開発モード（ページとランタイムをビルドして Electron を起動）：

```bash
npm run dev
```

インストーラーを作成する場合：

```bash
npm run dist:mac
```

### テスト

```bash
# ユニットテスト + 統合テスト
npm test

# E2E テスト（デスクトップ環境が必要）
npm run test:e2e
```

### パッケージング

```bash
npm run dist:mac     # macOS dmg / zip
npm run dist:win     # Windows nsis / zip
npm run dist:linux   # Linux AppImage / deb
```

> 変更のたびにパッケージングする必要はありません。`npm start` で最新のソースを直接読み込めます。

## プロジェクト構成

```text
ArborMark/
├── src/
│   ├── main/                  # Electron メインプロセス（ウィンドウ、メニュー、IPC、プロトコル、保存）
│   ├── preload/               # コンテキスト分離と安全なブリッジ
│   ├── renderer/
│   │   ├── core/              # エディターコア、選択範囲、元に戻す／やり直し
│   │   ├── block/             # コードブロック、テーブル、数式、図表、画像
│   │   ├── markdown/          # Markdown の解析とシリアライズ
│   │   ├── io/                # ファイル、エクスポート、クリップボード、Pandoc
│   │   ├── ui/                # メニュー、サイドバー、アウトライン、検索、ファイルツリー
│   │   ├── pages/             # React の設定・ウェルカム・ライセンス画面
│   │   ├── vendor/            # サードパーティ製ランタイム（CodeMirror、jQuery、Rangy など）
│   │   └── static/            # ホスト HTML、テーマ、組み込みドキュメント、アイコン
│   └── shared/                # メインとレンダラーで共有する定数
├── tools/                     # ビルドとテストのスクリプト
├── test/                      # ユニット、統合、E2E テスト
├── resources/                 # アプリアイコンとインストーラー素材
└── docs/                      # アーキテクチャとサードパーティの記録
```

詳しいモジュール構成は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## 設計メモ

- **ローカルファースト**：文書、画像、テーマ、設定は既定でローカルに保存されます。
- **プレーンテキスト**：すべて標準 Markdown として保存され、他のエディターでも開けます。
- **テーマ拡張**：テーマは通常の CSS ファイルです。ユーザーテーマフォルダーに置くと自動的に認識されます。
- **安全な境界**：レンダラーには最小限の preload API のみを公開し、外部リンクはプロトコルの許可リストを通します。
- **保守性**：メイン、レンダラー、共有層を分離し、主要な動作には回帰テストを用意しています。

アプリ内の **ヘルプ → Markdown 機能サンプル** から全機能のサンプルを開けます。元ファイルは [Markdown Demo.md](src/web/src/bridge/demo/markdown-full-demo.md) です。

## コントリビュート

Issue と Pull Request を歓迎します。

1. リポジトリを Fork し、`feat/your-feature` または `fix/your-fix` ブランチを作成します。
2. 送信前に関連テストを実行します：`node tools/run-tests.mjs test/unit/<test>.test.mjs`
3. コミットメッセージは意味のある形式にしてください：
   - `feat(editor): コードブロックの対応言語を追加`
   - `fix(export): PDF 書き出しの画像欠落を修正`
4. Pull Request には変更内容、テスト方法、UI 変更のスクリーンショットを記載してください。

コントリビュートを送信した時点で、プロジェクトのオープンソースライセンスで公開することに同意したものとみなします。

## ライセンス

ArborMark は **GNU General Public License v3.0 or later（GPL-3.0-or-later）** で公開されています。

- プロジェクトの使用、複製、変更
- 変更版の配布
- 商用利用

が自由に行えます。ただし copyleft の条件として、**派生物を配布する場合は GPL-3.0-or-later で公開し、完全なソースコードを提供する必要があります**。本ソフトウェアは無保証で提供されます。

全文は [LICENSE](LICENSE) を参照してください。

> GPL-3.0 を選んだ理由：成熟した強い copyleft ライセンスであり、デスクトップアプリ全体に適しています。同梱の MIT / Apache-2.0 コンポーネントと互換性があり、派生版がクローズドソースで再配布されることを防げます。

## サードパーティコンポーネント

主に次のオープンソースプロジェクトを利用しています。

- [Electron](https://www.electronjs.org/)（MIT）
- [CodeMirror](https://codemirror.net/5/)（MIT）
- [MathJax](https://www.mathjax.org/)（Apache-2.0）
- [Mermaid](https://mermaid.js.org/)（MIT）
- [jQuery](https://jquery.com/)（MIT）
- [Rangy](https://github.com/timdown/rangy)（MIT）
- [DOMPurify](https://github.com/cure53/DOMPurify)（Apache-2.0 / MPL-2.0）
- [React](https://react.dev/)（MIT）

完全な著作権・ライセンス情報は、アプリ内の **ヘルプ → クレジット** と各依存関係の LICENSE ファイルを参照してください。

## 免責事項

ArborMark は独立したオープンソースプロジェクトであり、いかなる商用 Markdown エディターとも提携、承認、後援関係にありません。プロジェクト名、アイコン、UI 素材はオリジナルまたは許諾を得て使用しています。サードパーティコンポーネントの著作権は各作者に帰属します。

権利侵害があると思われる場合は [Issues](https://github.com/Arbor4/ArborMark/issues) までご連絡ください。

---

Copyright © 2026 Arbor · ArborMark contributors
