/**
 * 选区复制：编辑态把 ProseMirror 选区序列化为 Markdown（而非纯文本/整篇），
 * 源码态取 CM6 选区；统一经 clipboard helper 写入（桌面/浏览器/回退）。
 */
import { getMilkdown, getCm6 } from "./activeEditor";
import { editorViewCtx, serializerCtx } from "@milkdown/core";
import { renderMarkdown } from "./preview";
import { writeClipboardText, writeClipboardHtml } from "@/bridge/clipboard";
import { useUi } from "@/stores/ui";

export function selectionMarkdown(): string {
  const md = getMilkdown();
  if (md) {
    let out = "";
    md.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serialize = ctx.get(serializerCtx);
      const { from, to, empty } = view.state.selection;
      const slice = empty ? view.state.doc.slice(0, view.state.doc.content.size) : view.state.doc.slice(from, to);
      const schema = view.state.schema;
      const doc = schema.topNodeType.createAndFill(null, slice.content) ?? schema.topNodeType.create(null, slice.content);
      out = serialize(doc);
    });
    return out;
  }
  const cm = getCm6();
  if (cm) {
    const r = cm.state.selection.main;
    return r.empty ? cm.state.doc.toString() : cm.state.sliceDoc(r.from, r.to);
  }
  return window.getSelection()?.toString() ?? "";
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|%%)(.*?)\1/g, "$2")
    .replace(/(\*|_|`)(.*?)\1/g, "$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "");
}

export type CopyKind = "markdown" | "html" | "plain" | "semantic-html";

export async function copySelectionAs(as: CopyKind): Promise<boolean> {
  const md = selectionMarkdown();
  if (!md.trim()) {
    useUi.getState().toast("没有可复制的选区", "info");
    return false;
  }
  let ok = false;
  if (as === "markdown") ok = await writeClipboardText(md);
  else if (as === "plain") ok = await writeClipboardText(stripMarkdown(md));
  else if (as === "html") ok = await writeClipboardText(renderMarkdown(md));
  else ok = await writeClipboardHtml(renderMarkdown(md), stripMarkdown(md));
  useUi.getState().toast(ok ? "已复制" : "复制失败", ok ? "success" : "danger");
  return ok;
}