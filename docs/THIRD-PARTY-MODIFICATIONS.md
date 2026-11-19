# Third-party modifications

ArborMark vendors a small number of third-party libraries under `src/renderer/vendor/`. This document records the changes made to them.

All upstream projects remain under their original licenses. Only the changes listed here are specific to ArborMark.

## CodeMirror 5

- **Inline code block scrolling**: set `scrollerGap` to `0` for inline code blocks so pressing Enter on the last line no longer scrolls the block upward and clips the first line.
- **macOS wheel handling**: prevent the code block scroller from swallowing wheel events when it cannot scroll further, allowing the outer document to scroll.

Tests: `test/unit/fences-scroll-offset.test.mjs`, `test/unit/vendor-modernization.test.mjs`

## Keymaster

- Normalize `Command` / `Ctrl` / `Shift` key names.
- Ignore `undefined` / `null` key bindings instead of aborting editor initialization.
- Handle case-insensitive key comparisons safely.

Tests: `test/unit/vendor-modernization.test.mjs`, `test/unit/context-menu-mac-shortcuts.test.mjs`

## jQuery and shim

- Keep `$.htmlPrefilter` compatible with self-closing tags.
- Expose jQuery through `window.jQuery` for legacy modules.

Tests: `test/unit/vendor-modernization.test.mjs`

## FastDOM

- Export the library through the shared module wrapper instead of relying on minified local variables.

## DOMPurify

- Wrap the library in a clean module boundary and keep the default export intact.

## Raven.js

- Export the client through `url-resolver` so error reporting can be disabled without affecting the editor.

## List.js and fuzzy search

- Keep the original readable sources and expose them through the existing module ids.

## Verification

```bash
node tools/build.mjs .
node tools/run-tests.mjs test/unit/vendor-modernization.test.mjs
node tools/run-tests.mjs test/unit/fences-scroll-offset.test.mjs
node tools/run-tests.mjs test/unit/context-menu-mac-shortcuts.test.mjs
```
