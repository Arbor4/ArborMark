/**
 * [TOC] 目录插件：把仅含 [TOC] 的段落渲染为可点击目录（动态读取标题）。
 * 序列化回 Markdown 时仍输出 [TOC]。
 */
import { $nodeSchema, $remark, $view } from "@milkdown/utils";
import { visit } from "unist-util-visit";
import { TextSelection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

function remarkToc() {
  return (tree: any) => {
    visit(tree, "paragraph", (node: any, index: number | undefined, parent: any) => {
      if (
        node.children?.length === 1 &&
        node.children[0].type === "text" &&
        node.children[0].value.trim() === "[TOC]"
      ) {
        if (parent && index != null) {
          parent.children.splice(index, 1, { type: "toc" });
        }
      }
    });
  };
}

export const tocRemarkPlugin = $remark("remarkToc", () => remarkToc);

export const tocSchema = $nodeSchema("toc", () => ({
  group: "block",
  atom: true,
  isolating: true,
  parseDOM: [{ tag: "div[data-toc]" }],
  toDOM: () => {
    const dom = document.createElement("div");
    dom.setAttribute("data-toc", "");
    return dom;
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === "toc",
    runner: (state: any, _node: any, type: any) => {
      state.addNode(type);
    },
  },
  toMarkdown: {
    match: (node: ProseNode) => node.type.name === "toc",
    runner: (state: any) => {
      state.addNode("paragraph", undefined, "[TOC]");
    },
  },
}));

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

function collectHeadings(view: EditorView): HeadingItem[] {
  const items: HeadingItem[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      items.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
  });
  return items;
}

export const tocNodeView = $view(tocSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node = initialNode;
  const dom = document.createElement("div");
  dom.className = "am-toc";
  dom.setAttribute("data-testid", "toc");

  const render = () => {
    const headings = collectHeadings(view);
    dom.innerHTML = "";
    const title = document.createElement("div");
    title.className = "am-toc-title";
    title.textContent = "目录";
    dom.appendChild(title);
    if (headings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "am-toc-empty";
      empty.textContent = "暂无标题";
      dom.appendChild(empty);
      return;
    }
    const list = document.createElement("ul");
    list.className = "am-toc-list";
    for (const h of headings) {
      const li = document.createElement("li");
      li.className = `am-toc-item am-toc-level-${h.level}`;
      const a = document.createElement("a");
      a.textContent = h.text;
      a.href = "javascript:void(0)";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(h.pos + 1)));
        view.dispatch(tr);
        const domAtPos = view.nodeDOM(h.pos);
        if (domAtPos instanceof HTMLElement) {
          domAtPos.scrollIntoView({ block: "start", behavior: "smooth" });
        }
        view.focus();
      });
      li.appendChild(a);
      list.appendChild(li);
    }
    dom.appendChild(list);
  };

  render();

  return {
    dom,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      render();
      return true;
    },
    // 文档其它位置变化（标题增删）时也刷新目录
    ignoreMutation() {
      return true;
    },
    destroy() {},
  };
});

export const tocPlugin = [tocRemarkPlugin, tocSchema, tocNodeView].flat();