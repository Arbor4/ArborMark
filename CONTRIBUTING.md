# Contributing to ArborMark

Thank you for your interest in contributing to ArborMark! We welcome contributions of all kinds: bug reports, documentation updates, feature requests, pull requests, and feedback.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat all community members with respect and courtesy.

---

## Development Setup

### Prerequisites

- **Node.js**: v20 or higher (`node -v`)
- **npm**: v10 or higher (`npm -v`)
- **Rust toolchain**: Stable 1.77+ with Cargo (`rustup update stable`)
- **OS specific tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio C++ Build Tools with English language pack, WebView2 runtime
  - **Linux**: WebKitGTK 4.1, GTK 3, libsoup 3 dev libraries

### Getting Started

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/<your-username>/ArborMark.git
   cd ArborMark
   ```

2. **Install dependencies**:
   ```bash
   npm install                    # Root dependencies (Tauri CLI)
   npm install --prefix src/web   # Web frontend dependencies
   ```

3. **Start local development**:
   ```bash
   # Launch desktop application with hot reload:
   npm run dev

   # Or run the browser frontend only:
   npm run web:dev
   ```

---

## Testing & Quality Checks

Before submitting a Pull Request, please ensure all checks pass:

```bash
# Run all tests (typecheck + frontend build + rust tests):
npm test

# Run frontend TypeScript type checking:
npm run typecheck

# Run Rust unit tests:
cd src-tauri && cargo test
```

---

## Submitting Pull Requests

1. **Branching**:
   - Create a feature branch from `main`:
     ```bash
     git checkout -b feat/your-feature-name
     # or
     git checkout -b fix/your-bug-fix
     ```

2. **Commit Messages**:
   - Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
     - `feat(scope): add new capability`
     - `fix(scope): resolve issue description`
     - `docs(scope): update documentation`
     - `refactor(scope): optimize structure`
     - `style(scope): format code or styles`
     - `test(scope): add or modify tests`

3. **Pull Request Checklist**:
   - [ ] Code compiles and passes all checks (`npm test`).
   - [ ] No extraneous debug logs, commented-out dead code, or unintended files committed.
   - [ ] For visual or UI changes, screenshots or GIFs are included in the PR description.
   - [ ] New functionality includes corresponding unit tests or verification steps.

---

## Project Structure Overview

```text
ArborMark/
├── src/
│   └── web/                 # React frontend (Vite + Tailwind CSS)
│       └── src/
│           ├── components/  # Editors (editor/milkdown, editor/codemirror), panels (files, outline, settings)
│           ├── chrome/      # Custom title bar (Windows) & menu model
│           ├── stores/      # Zustand state stores (workspace, ui, search, find)
│           ├── bridge/      # IPC, file system abstraction, i18n, updater
│           ├── theme/       # Design tokens & theme registry
│           └── styles/      # CSS styles
├── src-tauri/               # Tauri 2 + Rust native backend
│   ├── locales/             # Native menu translation packs
│   └── src/
│       ├── ipc/             # IPC handlers (fs, document, library, export, setting, misc)
│       ├── menu.rs          # Native OS menu bar & accelerators
│       ├── protocol.rs      # Custom arbormark:// asset protocol
│       ├── state.rs         # Application state & persistence
│       └── windows.rs       # Window lifecycle & multi-window management
├── resources/               # Application icons & installer assets
├── tools/                   # Development utilities & scripts
└── docs/                    # Architecture notes, build guides & archived migration docs
```

---

## Reporting Issues

- Search existing [Issues](https://github.com/Arbor4/ArborMark/issues) to avoid duplicates.
- Use the issue template and include:
  - OS version and environment details.
  - Clear steps to reproduce the issue.
  - Expected vs. actual behavior.
  - Relevant logs, error traces, or screenshots.

Thank you for helping make ArborMark better for everyone!
