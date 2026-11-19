
<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>

<h1 align="center">ArborMark</h1>

<p align="center">A local-first, WYSIWYG Markdown editor for the desktop</p>

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
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark main window: file tree on the left, WYSIWYG editor on the right">
</p>

***

## Introduction

ArborMark (Chinese name: 简筑) is an independent desktop Markdown editor built with **Tauri 2 + Rust** on the backend and **React + Milkdown (ProseMirror)** on the frontend, with **CodeMirror 6** for plain-text source mode.

It combines the simplicity of Markdown with the immediacy of a rich-text editor: content is rendered as you type, and a single shortcut (⌘/Ctrl + /) takes you to source mode. Documents are always saved locally as standard `.md` files — no lock-in, no account required.

- Repository: <https://github.com/Arbor4/ArborMark>
- Issues: <https://github.com/Arbor4/ArborMark/issues>
- Downloads: <https://github.com/Arbor4/ArborMark/releases>

## Features

| Feature            | Description                                                                                |
| :----------------- | :----------------------------------------------------------------------------------------- |
| Live WYSIWYG       | Render while typing; edit headings, tables, math and diagrams in place                     |
| Source mode        | CodeMirror 6 plain-text editing with syntax highlighting, ⌘/Ctrl + / to switch             |
| Files & navigation | Folder tree, flat list, heading outline, quick open (⌘P) and global search (⌘⇧F)           |
| Extended syntax    | Tables, task lists, footnotes, YAML front matter, highlight, superscript, subscript        |
| Math               | Inline and block LaTeX via KaTeX, with optional equation numbering                         |
| Diagrams           | Mermaid, Flowchart.js and Sequence diagrams, rendered lazily for long documents            |
| Tables             | Floating row/column toolbar, drag to resize columns and reorder rows/columns               |
| Images & PDF       | Drag/drop with relative paths and copy-to-folder; in-app image/PDF preview; resize & align |
| Find & replace     | Live match count, per-match and replace-all, case toggle                                   |
| Import and export  | PDF / HTML export; Pandoc-based Word / EPUB / LaTeX when Pandoc is installed               |
| Themes             | Five built-in themes (incl. **Liquid Glass**) plus user CSS/JSON themes                    |
| Localization       | Simplified Chinese / English UI, following the system or selected manually                 |
| Safe saving        | Auto-save, dirty tracking, and crash-safe local files                                      |
| Command line       | Open a file or folder from the command line or by dragging onto the app                    |

## Download and install

Get the installer for your platform from [Releases](https://github.com/Arbor4/ArborMark/releases):

- macOS: `.dmg` / `.app`
- Windows: NSIS installer (standard and offline WebView2 editions)
- Linux: `.AppImage` / `.deb`

On macOS, if Gatekeeper blocks the first launch, allow the app under **System Settings → Privacy & Security**.

## Development

### Requirements

- Node.js **20+** and npm 10+
- Rust toolchain **stable** (`rustup`, edition 2021)
- macOS, Windows, or Linux (Linux needs the WebKitGTK 4.1 / GTK 3 dev packages)

### Run locally

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install                 # root: Tauri CLI
npm install --prefix src/web

npm run dev                 # tauri dev: starts the Vite dev server + native shell
# or frontend-only in a browser:
npm run web:dev
```

### Check & test

```bash
npm run web:build           # typecheck (tsc --noEmit) + Vite production build
npm --prefix src/web run typecheck
(cd src-tauri && cargo test)   # Rust unit tests
```

### Packaging

```bash
npm run dist:mac       # macOS app + dmg
npm run dist:win       # Windows nsis (+ offline WebView2 edition)
npm run dist:linux     # Linux deb + AppImage
```

## Project structure

```text
ArborMark/
├── src/
│   └── web/                 # React frontend (Vite)
│       └── src/
│           ├── components/  # Editor (Milkdown/CodeMirror), files, outline, settings, lightbox
│           ├── stores/      # Zustand stores: workspace, ui, find, lightbox, search
│           ├── bridge/      # Typed IPC / fs / i18n bridges to the Rust backend
│           ├── theme/       # Theme contract, built-in presets, registry
│           └── styles/      # Design tokens + component styles
├── src-tauri/               # Rust backend (Tauri 2)
│   └── src/
│       ├── ipc/             # IPC domains: fs, images, export, shell, settings, ...
│       ├── menu.rs          # Native menu (macOS/Windows/Linux) + parity sync
│       ├── protocol.rs      # arbormark:// custom protocol (local file serving)
│       └── lib.rs           # App setup, window & drag-drop wiring
├── resources/               # App icons and installer assets
├── tools/                   # Icon generation helpers
└── docs/                    # Architecture notes and screenshots
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a closer look at the module layout.

## Design notes

- **Local-first**: documents, images, themes, and settings live on your machine by default.
- **Plain text**: everything is saved as standard Markdown and can be opened elsewhere.
- **Themeable**: themes are token sets (CSS/JSON); drop one into the user theme folder and it is discovered automatically.
- **Safe by default**: the webview talks to Rust through a narrow IPC surface; local files are served via a scoped custom protocol.
- **Performance**: heavy node views (diagrams) render lazily near the viewport; long images scroll in place.

The built-in full-feature example is available from **Help → Markdown Demo** inside the app. The source file is [markdown-full-demo.md](src/web/src/bridge/demo/markdown-full-demo.md).

## Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a branch: `feat/your-feature` or `fix/your-fix`.
2. Run the relevant checks before submitting (`npm run web:build`, `cargo test`).
3. Use semantic commit messages, for example:
   - `feat(editor): support an additional code-block language`
   - `fix(export): restore missing images in PDF export`
4. Describe the change, how it was tested, and include screenshots for UI changes.

By submitting a contribution, you agree to license it under the project's open-source license.

## License

ArborMark is released under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.

You are free to use, copy, modify, and distribute the project, including commercially. The copyleft requirement applies: **if you distribute a derivative work, it must also be released under GPL-3.0-or-later with complete source code**. The software is provided without warranty.

See [LICENSE](LICENSE) for the full text.

## Third-party components

ArborMark builds on several excellent open-source projects, including:

- [Tauri](https://tauri.app/) and [Rust](https://www.rust-lang.org/) (MIT / Apache-2.0)
- [React](https://react.dev/) (MIT)
- [Milkdown](https://milkdown.dev/) / [ProseMirror](https://prosemirror.net/) (MIT)
- [CodeMirror](https://codemirror.net/) (MIT)
- [KaTeX](https://katex.org/) (MIT)
- [Mermaid](https://mermaid.js.org/) (MIT)
- [highlight.js](https://highlightjs.org/) (BSD-3-Clause)
- [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0)

Full copyright and license information is available in each dependency's LICENSE file.

## Disclaimer

ArborMark is an independent open-source project and is not affiliated with, endorsed by, or sponsored by any commercial Markdown editor. The project name, icons, and interface assets are original or used with permission; third-party components remain the property of their respective authors.

If you believe content in this project infringes your rights, please contact us via [Issues](https://github.com/Arbor4/ArborMark/issues).

***

Copyright © 2026 Arbor · ArborMark contributors
