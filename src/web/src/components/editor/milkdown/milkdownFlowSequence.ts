/**
 * Flowchart.js（```flow）与 Sequence Diagram（```sequence）渲染。
 * 复用 Mermaid 引擎：把两种语法转换为 mermaid 语法渲染（统一配色/尺寸/分栏编辑），
 * 编辑区与序列化保留原始 ```flow / ```sequence 源码。
 * 转换失败时 mermaid 报错并保留上一帧，优雅降级。
 */
import { $nodeSchema, $remark } from "@milkdown/utils";
import { visit } from "unist-util-visit";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { createDiagramNodeView } from "./milkdownDiagrams";

/* ── flowchart.js → mermaid flowchart ────────────────────────────────────── */

function flowShape(type: string, name: string, label: string): string {
  const l = `"${label.replace(/"/g, "'")}"`;
  switch (type) {
    case "start":
    case "end":
      return `${name}([${l}])`;
    case "condition":
      return `${name}{${l}}`;
    case "subroutine":
      return `${name}[[${l}]]`;
    case "inputoutput":
      return `${name}[/${l}/]`;
    case "parallel":
      return `${name}[//${l}//]`;
    case "operation":
    default:
      return `${name}[${l}]`;
  }
}

export function flowToMermaid(code: string): string {
  const nodes = new Map<string, string>();
  const edges: string[] = [];
  const define = (name: string, type: string, label: string) => {
    if (name && !nodes.has(name)) nodes.set(name, flowShape(type, name, label.trim()));
  };
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const def = /^(\w+)=>(\w+):\s*(.+)$/.exec(line);
    if (def && !line.includes("->")) {
      define(def[1], def[2], def[3]);
      continue;
    }
    if (line.includes("->")) {
      const parsed = line.split("->").map((s) => s.trim()).map((seg) => {
        const d = /^(\w+)=>(\w+):\s*(.+)$/.exec(seg);
        if (d) { define(d[1], d[2], d[3]); return { name: d[1], branch: "" }; }
        const b = /^(\w+)\((\w+)\)$/.exec(seg);
        if (b) return { name: b[1], branch: b[2] };
        return { name: seg, branch: "" };
      });
      for (let i = 0; i < parsed.length - 1; i++) {
        const f = parsed[i], t = parsed[i + 1];
        if (!f.name || !t.name) continue;
        edges.push(f.branch ? `${f.name} -->|${f.branch}| ${t.name}` : `${f.name} --> ${t.name}`);
      }
    }
  }
  const body = [...nodes.values()].map((d) => `    ${d}`).concat(edges.map((e) => `    ${e}`));
  return `flowchart TD\n${body.join("\n")}`;
}

/* ── js-sequence-diagrams → mermaid sequenceDiagram ──────────────────────── */

export function sequenceToMermaid(code: string): string {
  const arrowMap: Record<string, string> = { "->": "->>", "-->": "-->>", "->>": "->>", "-->>": "-->>" };
  const out = ["sequenceDiagram"];
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(.+?)\s*(-->>|->>|-->|->)\s*(.+?)\s*:\s*(.*)$/.exec(line);
    if (m) {
      out.push(`    ${m[1].trim()}${arrowMap[m[2]]}${m[3].trim()}: ${m[4]}`);
    } else {
      // participant / Note / activate / deactivate 等与 mermaid 兼容
      out.push(`    ${line}`);
    }
  }
  return out.join("\n");
}

/* ── remark：把 ```flow / ```sequence 代码块转为图表节点 ─────────────────── */

function remarkFlowSequence() {
  return (tree: any) => {
    visit(tree, "code", (node: any, index: number | undefined, parent: any) => {
      if (!parent || index == null) return;
      const lang = String(node.lang ?? "").toLowerCase();
      if (lang === "flow") parent.children.splice(index, 1, { type: "flowchart", value: node.value });
      else if (lang === "sequence") parent.children.splice(index, 1, { type: "sequencediagram", value: node.value });
    });
  };
}

export const flowSequenceRemark = $remark("remarkFlowSequence", () => remarkFlowSequence);

function diagramLikeSchema(name: string, lang: string) {
  return $nodeSchema(name, () => ({
    group: "block",
    atom: true,
    isolating: true,
    defining: true,
    attrs: { value: { default: "" } },
    parseDOM: [{ tag: `div[data-${name}]`, getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }) }],
    toDOM: (node) => {
      const dom = document.createElement("div");
      dom.setAttribute(`data-${name}`, "");
      dom.dataset.value = node.attrs.value as string;
      return dom;
    },
    parseMarkdown: {
      match: ({ type }: { type: string }) => type === name,
      runner: (state: any, node: any, type: any) => state.addNode(type, { value: node.value }),
    },
    toMarkdown: {
      match: (node: ProseNode) => node.type.name === name,
      runner: (state: any, node: any) => state.addNode("code", undefined, node.attrs.value || "", { lang }),
    },
  }));
}

export const flowchartSchema = diagramLikeSchema("flowchart", "flow");
export const sequenceDiagramSchema = diagramLikeSchema("sequencediagram", "sequence");

export const flowchartNodeView = createDiagramNodeView(flowchartSchema, flowToMermaid, "Flowchart");
export const sequenceNodeView = createDiagramNodeView(sequenceDiagramSchema, sequenceToMermaid, "Sequence");

export const flowSequencePlugins = [
  flowSequenceRemark,
  flowchartSchema,
  sequenceDiagramSchema,
  flowchartNodeView,
  sequenceNodeView,
].flat();