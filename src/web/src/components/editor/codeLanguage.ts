/**
 * 非 Markdown 文件的语法高亮语言加载：按扩展名懒加载对应语法
 * （优先 @codemirror/lang-*，其余走 @codemirror/legacy-modes StreamLanguage）。
 */
import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

export function isMarkdownFile(name: string): boolean {
  return ["md", "markdown", "mdown", "mkd", "txt", ""].includes(ext(name));
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];
export function isImageFile(name: string): boolean {
  return IMAGE_EXTS.includes(ext(name));
}
export function isPdfFile(name: string): boolean {
  return ext(name) === "pdf";
}

const VIDEO_EXTS = ["mp4", "webm", "ogv", "mov", "m4v"];
const AUDIO_EXTS = ["mp3", "wav", "wave", "ogg", "oga", "opus", "flac", "aac", "m4a", "mid", "midi"];
export function isVideoFile(name: string): boolean {
  return VIDEO_EXTS.includes(ext(name));
}
export function isAudioFile(name: string): boolean {
  return AUDIO_EXTS.includes(ext(name));
}

/** 明确的二进制文件：以文本打开只会乱码，统一走"不支持"面板（可用系统应用打开）。 */
const BINARY_EXTS = [
  // Windows / 可执行与目标文件
  "lnk", "exe", "dll", "sys", "drv", "ocx", "scr", "msi", "msix", "appx", "cab", "apk", "ipa",
  "jar", "class", "o", "obj", "lib", "a", "so", "dylib", "pdb", "ilk", "dmp", "pyc", "pyd", "ko",
  // 压缩包 / 磁盘镜像
  "zip", "rar", "7z", "gz", "bz2", "xz", "zst", "tgz", "tar", "iso", "img", "vhd", "vhdx", "wim", "esd",
  // 字体
  "ttf", "otf", "woff", "woff2", "eot",
  // Office / 电子书（zip/复合文档）
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub", "mobi", "azw3",
  // 设计 / 3D
  "psd", "ai", "sketch", "fig", "xd", "blend", "fbx", "glb", "usdz",
  // 数据库 / 其他
  "db", "sqlite", "sqlite3", "mdb", "cur",
];
export function isUnsupportedFile(name: string): boolean {
  return BINARY_EXTS.includes(ext(name));
}

export type PreviewKind = "image" | "pdf" | "video" | "audio" | "unsupported";

/** 文件路由分类：返回非 null 表示不走文本编辑器。 */
export function getPreviewKind(name: string): PreviewKind | null {
  if (isImageFile(name)) return "image";
  if (isPdfFile(name)) return "pdf";
  if (isVideoFile(name)) return "video";
  if (isAudioFile(name)) return "audio";
  if (isUnsupportedFile(name)) return "unsupported";
  return null;
}

/** 非文本文件（预览或"不支持"面板），一律不进编辑器、不读文本。 */
export function isPreviewFile(name: string): boolean {
  return getPreviewKind(name) !== null;
}

export function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function languageLabel(name: string): string {
  const e = ext(name);
  const map: Record<string, string> = {
    js: "JavaScript", jsx: "JSX", mjs: "JavaScript", cjs: "JavaScript",
    ts: "TypeScript", tsx: "TSX", java: "Java", py: "Python", rb: "Ruby",
    rs: "Rust", go: "Go", c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++",
    cs: "C#", css: "CSS", scss: "SCSS", less: "LESS", html: "HTML", htm: "HTML",
    xml: "XML", svg: "SVG", json: "JSON", yml: "YAML", yaml: "YAML",
    sh: "Shell", bash: "Shell", zsh: "Shell", sql: "SQL", php: "PHP",
    swift: "Swift", kt: "Kotlin", kts: "Kotlin", toml: "TOML", ini: "INI",
    lua: "Lua", pl: "Perl", r: "R", dart: "Dart", vue: "Vue", md: "Markdown",
    cmd: "Batch", bat: "Batch", btm: "Batch", ps1: "PowerShell", psd1: "PowerShell", psm1: "PowerShell",
  };
  return map[e] ?? (e ? e.toUpperCase() : "Plain Text");
}

/** Windows 批处理（.cmd/.bat）轻量高亮：关键字 / 变量 / 字符串 / 注释 / 标签。 */
const batchMode = {
  name: "batch",
  token(stream: any): string | null {
    if (stream.sol() && stream.match(/^@?echo\s+(off|on)\b/i)) return "keyword";
    if (stream.match(/^(rem\b|::)/i)) { stream.skipToEnd(); return "comment"; }
    if (stream.sol() && stream.match(/^:[^:]/)) { stream.skipToEnd(); return "tag"; }
    if (stream.match(/%[^%\s]+%|%~?[a-z0-9]/i)) return "variableName";
    if (stream.match(/"[^"]*"/)) return "string";
    if (stream.match(/\b(set|if|else|for|in|do|goto|call|exit|pause|shift|start|title|color|cls|pushd|popd|cd|md|rd|del|copy|move|ren|type|more|find|findstr|choice|timeout|errorlevel|not|exist|defined|equ|neq|lss|leq|gtr|geq)\b/i)) return "keyword";
    if (stream.match(/\b\d+\b/)) return "number";
    if (stream.match(/[&|<>]=?|==/)) return "operator";
    stream.next();
    return null;
  },
};

export async function loadLanguage(name: string): Promise<Extension | null> {
  const e = ext(name);
  switch (e) {
    case "cmd": case "bat": case "btm":
      return StreamLanguage.define(batchMode as never);
    case "js": case "jsx": case "mjs": case "cjs": case "json": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: e === "jsx" });
    }
    case "ts": case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: e === "tsx", typescript: true });
    }
    case "css": case "scss": case "less": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "html": case "htm": case "vue": case "svg": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "md": case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
  }
  // legacy-modes：单包多语法
  const legacy: Record<string, () => Promise<{ default: unknown } | Record<string, unknown>>> = {
    java: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).java })),
    c: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).c })),
    h: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).c })),
    cpp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).cpp })),
    cc: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).cpp })),
    hpp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).cpp })),
    cs: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).csharp })),
    kotlin: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).kotlin })),
    kt: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).kotlin })),
    scala: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).scala })),
    dart: () => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ default: (m as any).dart })),
    py: () => import("@codemirror/legacy-modes/mode/python").then((m) => ({ default: (m as any).python })),
    rb: () => import("@codemirror/legacy-modes/mode/ruby").then((m) => ({ default: (m as any).ruby })),
    rs: () => import("@codemirror/legacy-modes/mode/rust").then((m) => ({ default: (m as any).rust })),
    go: () => import("@codemirror/legacy-modes/mode/go").then((m) => ({ default: (m as any).go })),
    swift: () => import("@codemirror/legacy-modes/mode/swift").then((m) => ({ default: (m as any).swift })),
    sh: () => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ default: (m as any).shell })),
    bash: () => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ default: (m as any).shell })),
    zsh: () => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ default: (m as any).shell })),
    ps1: () => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ default: (m as any).shell })),
    psd1: () => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ default: (m as any).shell })),
    psm1: () => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ default: (m as any).shell })),
    sql: () => import("@codemirror/legacy-modes/mode/sql").then((m) => ({ default: (m as any).mySQL || (m as any).standardSQL || (typeof (m as any).sql === "function" ? (m as any).sql({}) : (m as any).sql) })),
    yml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => ({ default: (m as any).yaml })),
    yaml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => ({ default: (m as any).yaml })),
    xml: () => import("@codemirror/legacy-modes/mode/xml").then((m) => ({ default: (m as any).xml })),
    toml: () => import("@codemirror/legacy-modes/mode/toml").then((m) => ({ default: (m as any).toml })),
    ini: () => import("@codemirror/legacy-modes/mode/properties").then((m) => ({ default: (m as any).properties })),
    lua: () => import("@codemirror/legacy-modes/mode/lua").then((m) => ({ default: (m as any).lua })),
    pl: () => import("@codemirror/legacy-modes/mode/perl").then((m) => ({ default: (m as any).perl })),
    r: () => import("@codemirror/legacy-modes/mode/r").then((m) => ({ default: (m as any).r })),
  };
  const loader = legacy[e];
  if (!loader) return null;
  try {
    const mod = await loader();
    const mode = (mod as { default?: unknown }).default ?? mod;
    return StreamLanguage.define(mode as never);
  } catch {
    return null;
  }
}