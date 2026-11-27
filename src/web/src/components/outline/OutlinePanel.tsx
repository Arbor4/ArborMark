import { useEffect, useMemo, useRef, useState } from "react";
import { ListTree, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { extractOutline } from "../editor/preview";
import { jumpToHeading } from "../editor/editorNav";
import { EmptyState, Tooltip } from "../common";
import { PanelHeader } from "../layout";
import { useLang } from "@/bridge/i18n";

interface OutlineItem {
  line: number;
  text: string;
  level: number;
}
interface OutlineNode {
  item: OutlineItem;
  occurrence: number;
  children: OutlineNode[];
}

/** 由扁平标题列表构建层级树，并记录重复标题的出现序号。 */
function buildTree(outline: OutlineItem[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const seen = new Map<string, number>();
  for (const item of outline) {
    const key = `${item.level}:${item.text}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const node: OutlineNode = { item, occurrence, children: [] };
    while (stack.length && stack[stack.length - 1].item.level >= item.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root.push(node);
    stack.push(node);
  }
  return root;
}

function collectIds(nodes: OutlineNode[], acc: Set<string>) {
  for (const n of nodes) {
    if (n.children.length) acc.add(`${n.item.line}`);
    collectIds(n.children, acc);
  }
}

/** 大纲面板：可折叠标题树 + 展开/折叠按钮栏，点击跳转编辑器。 */
export function OutlinePanel() {
  const { t } = useLang();
  const content = useWorkspace((s) => s.content);
  const activePath = useWorkspace((s) => s.activePath);
  const activeKey = useUi((s) => s.outlineActive);
  const collapsible = useUi((s) => s.prefs.outlineCollapsible !== false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  // 性能优化：打字时防抖解析大纲（250ms），切文件时立即同步，避免万字文档高频击键卡顿
  const [debouncedContent, setDebouncedContent] = useState(content);
  const prevPathRef = useRef(activePath);

  useEffect(() => {
    if (prevPathRef.current !== activePath) {
      prevPathRef.current = activePath;
      setDebouncedContent(content);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedContent(content);
    }, 250);
    return () => clearTimeout(timer);
  }, [content, activePath]);

  const outline = useMemo(() => extractOutline(debouncedContent), [debouncedContent]);
  const tree = useMemo(() => buildTree(outline), [outline]);
  const allIds = useMemo(() => {
    const s = new Set<string>();
    collectIds(tree, s);
    return s;
  }, [tree]);

  /* 编辑区滚动联动：高亮当前标题并滚入大纲视口；自动展开其祖先分支 */
  useEffect(() => {
    if (!activeKey) return;
    const ancestors: string[] = [];
    const walk = (nodes: OutlineNode[], path: string[]): boolean => {
      for (const n of nodes) {
        const id = `${n.item.line}`;
        if (`${n.item.level}:${n.item.text}` === activeKey) {
          ancestors.push(...path);
          return true;
        }
        if (walk(n.children, [...path, id])) return true;
      }
      return false;
    };
    walk(tree, []);
    if (ancestors.some((id) => collapsed.has(id))) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        ancestors.forEach((id) => next.delete(id));
        return next;
      });
    }
    const t = setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-outline-key="${CSS.escape(activeKey)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, tree]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (node: OutlineNode, depth: number) => {
    const id = `${node.item.line}`;
    const key = `${node.item.level}:${node.item.text}`;
    const isActive = activeKey === key;
    const hasChildren = collapsible && node.children.length > 0;
    const isCollapsed = collapsible && collapsed.has(id);
    return (
      <div key={`${id}-${node.occurrence}`}>
        <div
          data-outline-key={key}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button[data-chevron]")) return;
            useUi.getState().setOutlineActive(key);
            jumpToHeading(node.item.line, node.item.text, node.item.level, node.occurrence);
          }}
          className={`group flex w-full cursor-pointer items-center gap-0.5 rounded-md py-[3px] pr-2 text-left text-[12.5px] transition-colors ${
            isActive
              ? "bg-accent-soft text-accent"
              : "text-ink-secondary hover:bg-hover hover:text-ink"
          }`}
          style={{ paddingLeft: (collapsible ? 4 : 10) + depth * 14 }}
          title={node.item.text}
        >
          {collapsible && (
            <button
              data-chevron="true"
              aria-label={isCollapsed ? t("展开") : t("折叠")}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggle(id);
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-transform ${
                hasChildren ? "text-ink-muted hover:text-ink" : "invisible"
              } ${isCollapsed ? "" : "rotate-90"}`}
            >
              <ChevronRight size={11} />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center text-left select-none">
            <span className={`truncate ${depth <= 1 || isActive ? "font-medium" : ""} ${isActive ? "text-accent" : depth <= 1 ? "text-ink" : ""}`}>{node.item.text}</span>
          </div>
        </div>
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <section className="flex h-full flex-col" aria-label={t("大纲")}>
      <PanelHeader title={t("大纲")} />
      {outline.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
          {collapsible && (
            <>
              <Tooltip label={t("全部展开")}>
                <button
                  aria-label={t("全部展开")}
                  onClick={() => setCollapsed(new Set())}
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
                >
                  <ChevronsUpDown size={13} />
                </button>
              </Tooltip>
              <Tooltip label={t("全部折叠")}>
                <button
                  aria-label={t("全部折叠")}
                  onClick={() => setCollapsed(new Set(allIds))}
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
                >
                  <ChevronsDownUp size={13} />
                </button>
              </Tooltip>
            </>
          )}
          <span className="ml-auto text-[10.5px] text-ink-muted">{t("outline.count", { n: outline.length })}</span>
        </div>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {!activePath ? (
          <EmptyState
            icon={<ListTree size={28} strokeWidth={1.4} />}
            title={t("大纲为空")}
            hint={t("打开文档后，这里会显示标题结构")}
          />
        ) : outline.length === 0 ? (
          <EmptyState
            icon={<ListTree size={28} strokeWidth={1.4} />}
            title={t("没有标题")}
            hint={t("用 # 开始一个标题，大纲会自动出现")}
          />
        ) : (
          <nav aria-label={t("文档大纲")}>{tree.map((n) => renderNode(n, 0))}</nav>
        )}
      </div>
    </section>
  );
}