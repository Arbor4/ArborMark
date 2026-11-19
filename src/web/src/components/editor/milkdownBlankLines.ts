/**
 * 空行保留：空段落回写源码为纯空行，而非 <br /> 占位。
 * 解析侧按 mdast position 的空行间隙还原空段落，保证 编辑↔源码 往返不丢空行；
 * 序列化侧 join 让每个空段落恰好贡献一个额外空行，与解析规则构成不动点。
 * 旧版保存的孤立 <br /> 块在解析时迁移为空段落，下次保存即自愈为纯空行。
 */
import { $remark, $node } from "@milkdown/utils";
import { visit } from "unist-util-visit";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { line: number }; end: { line: number } };
}

const BR_BLOCK = /^<br\s*\/?>$/i;
// htmlRemark 可能先把 html 重命名为 html_block/html_inline，两种形态都识别
const isBrNode = (n: MdNode) => (n.type === "html" || n.type === "html_block" || n.type === "html_inline") && BR_BLOCK.test((n.value ?? "").trim());
const isEmptyP = (n: MdNode) => n.type === "paragraph" && (!n.children || n.children.length === 0);
const emptyP = (): MdNode => ({ type: "paragraph", children: [] });

function preserveContainer(node: MdNode, src: string, isRoot: boolean) {
  const kids = node.children;
  if (!kids || !kids.length) return;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (isBrNode(c)) {
      kids[i] = { type: "paragraph", children: [], position: c.position };
    }
  }
  const out: MdNode[] = [];
  // 首/尾空行以整篇源码行号计算，仅根容器适用；嵌套容器只用块间间隙
  const first = kids[0];
  if (isRoot && first.position) {
    for (let i = 1; i < first.position.start.line; i++) out.push(emptyP());
  }
  for (let i = 0; i < kids.length; i++) {
    const prev = i > 0 ? kids[i - 1] : null;
    const cur = kids[i];
    if (prev?.position && cur.position) {
      const gap = cur.position.start.line - prev.position.end.line - 1;
      for (let k = 0; k < gap - 1; k++) out.push(emptyP());
    }
    out.push(cur);
  }
  const last = kids[kids.length - 1];
  if (isRoot && last.position && src) {
    const lines = src.split("\n");
    const trailingBlank = lines.length - last.position.end.line - (src.endsWith("\n") ? 1 : 0);
    for (let k = 0; k < trailingBlank; k++) out.push(emptyP());
  }
  node.children = out;
  for (const c of out) if (c.type === "blockquote") preserveContainer(c, src, false);
}

export function preserveBlankLines(tree: MdNode, src: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(tree as any, "paragraph", (n: MdNode) => {
    if (n.children?.length === 1 && isBrNode(n.children[0])) {
      n.children = [];
    }
  });
  preserveContainer(tree, src, true);
}

/** 空段落之后只换行不空行：每个空段落在源码中表现为一个额外空行。 */
export function joinEmptyParagraph(left: MdNode, _right: MdNode, parent: MdNode): number | undefined {
  if ((parent.type === "root" || parent.type === "blockquote") && isEmptyP(left)) return 0;
  return undefined;
}

export const blankLinesRemark = $remark("amBlankLines", () => () => (tree: MdNode, src: unknown) => {
  // Milkdown 运行时第二参为 markdown 字符串；unified 类型为 VFile，两者兼容取值
  const text = typeof src === "string" ? src : String((src as { value?: unknown })?.value ?? "");
  preserveBlankLines(tree, text);
});

/**
 * preset-commonmark 的 doc.toMarkdown 会裁掉末尾空段落，导致空行往返逐次丢失。
 * 同名 doc 后注册覆盖（Object.fromEntries 后者胜出）：完整序列化，空行与空段落一一对应。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const docPreserveTrailing = $node("doc", () => ({
  content: "block+",
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "root",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any, type: any) => state.injectRoot(node, type),
  },
  toMarkdown: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    match: (node: any) => node.type.name === "doc",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner: (state: any, node: any) => {
      state.openNode("root");
      state.next(node.content);
    },
  },
}));