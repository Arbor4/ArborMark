/**
 * 自研 Emoji 插件：原生 Unicode 字符渲染（离线、随字号缩放），完整别名映射。
 * 替换 @milkdown/plugin-emoji（其 twemoji 走 CDN、图片巨大、缺 thumbsup 等别名）。
 * - remark：把文本中的 `:shortcode:` 转为 emoji 节点（跳过代码）。
 * - ProseMirror：inline atom 节点，渲染 <span class="am-emoji">😄</span>。
 * - 序列化：回写 `:shortcode:`。
 * - 输入规则：键入 `:smile:` 即时转换。
 */
import { $nodeSchema, $remark, $inputRule } from "@milkdown/utils";
import { visit } from "unist-util-visit";
import { InputRule } from "@milkdown/prose/inputrules";
import emojilib from "emojilib";

type EmojiEntry = { char: string; keywords?: string[] };
const lib = (emojilib as unknown as { lib: Record<string, EmojiEntry> }).lib;

/** shortcode（含别名）→ Unicode 字符。主名优先，别名补充。 */
const shortcodeMap = new Map<string, string>();
for (const [name, entry] of Object.entries(lib)) {
  if (entry?.char && !shortcodeMap.has(name)) shortcodeMap.set(name, entry.char);
}
for (const [name, entry] of Object.entries(lib)) {
  for (const kw of entry?.keywords ?? []) {
    if (!shortcodeMap.has(kw)) shortcodeMap.set(kw, entry.char);
  }
}
// 常见 GitHub 别名补充（emojilib 关键词未覆盖的）
const extraAlias: Record<string, string> = {
  thumbsup: "👍", thumbsdown: "👎", smile: "😄", laughing: "😆", heart: "❤️",
  rocket: "🚀", tada: "🎉", sparkles: "✨", fire: "🔥", "100": "💯", eyes: "👀",
  coffee: "☕", "+1": "👍", "-1": "👎",
};
for (const [k, v] of Object.entries(extraAlias)) if (!shortcodeMap.has(k)) shortcodeMap.set(k, v);

export function lookupEmoji(name: string): string | undefined {
  return shortcodeMap.get(name);
}

const SHORTCODE_RE = /:([a-zA-Z0-9_+\-]+):/g;

/** remark：文本节点里的 `:shortcode:` → emoji 节点（不处理 code/inlineCode）。 */
function remarkEmoji() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (!parent || index == null) return;
      if (parent.type === "code" || parent.type === "inlineCode") return;
      const value: string = node.value;
      if (!value.includes(":")) return;
      SHORTCODE_RE.lastIndex = 0;
      const out: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = SHORTCODE_RE.exec(value))) {
        const char = shortcodeMap.get(m[1]);
        if (!char) continue;
        if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
        out.push({ type: "emoji", shortcode: m[1], char });
        last = m.index + m[0].length;
      }
      if (!out.length) return;
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

export const emojiRemarkPlugin = $remark("remarkEmojiNative", () => remarkEmoji);

export const emojiSchema = $nodeSchema("emoji", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: {
    shortcode: { default: "" },
    char: { default: "" },
  },
  parseDOM: [
    {
      tag: "span[data-type='emoji']",
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return { shortcode: el.dataset.shortcode ?? "", char: el.textContent ?? "" };
      },
    },
  ],
  toDOM: (node) => {
    const span = document.createElement("span");
    span.className = "am-emoji";
    span.dataset.type = "emoji";
    span.dataset.shortcode = node.attrs.shortcode as string;
    span.textContent = node.attrs.char as string;
    span.setAttribute("title", `:${node.attrs.shortcode}:`);
    return span;
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "emoji",
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, { shortcode: node.shortcode, char: node.char });
    },
  },
  toMarkdown: {
    match: (node: any) => node.type.name === "emoji",
    runner: (state: any, node: any) => {
      // 回写为文本 `:shortcode:`，remark-stringify 原样输出。
      state.addNode("text", undefined, `:${node.attrs.shortcode}:`);
    },
  },
}));

/** 输入规则：键入 `:smile:` 空格前即转换为 emoji 节点。 */
export const emojiInputRule = $inputRule((ctx) => {
  return new InputRule(/:([a-zA-Z0-9_+\-]+):$/, (state, match, start, end) => {
    const char = shortcodeMap.get(match[1]);
    if (!char) return null;
    const type = emojiSchema.type(ctx);
    return state.tr.replaceWith(start, end, type.create({ shortcode: match[1], char }));
  });
});

export const emojiPlugin = [emojiRemarkPlugin, emojiSchema, emojiInputRule].flat();