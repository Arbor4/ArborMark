/**
 * 内置帮助文档：帮助菜单的 Docs/*.md 在任意工作区都可用（只读虚拟文档）。
 * 「Markdown 功能示例」复用演示文档源。
 */
import quickStart from "./docs/Quick Start.md?raw";
import markdownReference from "./docs/Markdown Reference.md?raw";
import pandoc from "./docs/Install and Use Pandoc.md?raw";
import customThemes from "./docs/Custom Themes.md?raw";
import useImages from "./docs/Use Images in ArborMark.md?raw";
import autoSave from "./docs/Auto Save, Version Control and Recovery.md?raw";
import moreDocuments from "./docs/More Documents.md?raw";
import credits from "./docs/Credits.md?raw";
import changeLog from "./docs/Change Log.md?raw";
import privacy from "./docs/Privacy Policy.md?raw";
import welcome from "./docs/Welcome.md?raw";
import demo from "./demo/markdown-full-demo.md?raw";

export const HELP_DOCS: Record<string, string> = {
  "Quick Start.md": quickStart,
  "Markdown Reference.md": markdownReference,
  "Markdown Demo.md": demo,
  "Install and Use Pandoc.md": pandoc,
  "Custom Themes.md": customThemes,
  "Use Images in ArborMark.md": useImages,
  "Auto Save, Version Control and Recovery.md": autoSave,
  "More Documents.md": moreDocuments,
  "Credits.md": credits,
  "Change Log.md": changeLog,
  "Privacy Policy.md": privacy,
  "Welcome.md": welcome,
};

/** 菜单路径（window.dirname + "/Docs/x.md"）→ 内置文档；非 Docs 路径返回 null。 */
export function helpDocFor(path: string): { name: string; content: string } | null {
  const m = /(?:^|[/\\])Docs[/\\]([^/\\]+\.md)$/.exec(path);
  if (!m) return null;
  const content = HELP_DOCS[m[1]];
  return content != null ? { name: m[1], content } : null;
}