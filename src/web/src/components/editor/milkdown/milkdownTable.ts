/**
 * 表格 node view：渲染态表格操作栏。
 * 行组：上/下插行、上/下移行、删行；列组：左/右插列、左/右移列、删列；
 * 对齐组：左/中/右（作用于当前列）；删除表格。左侧实时显示 行×列 尺寸。
 * 工具按钮 mousedown 阻止默认以保持表格选区；选区变化时刷新尺寸与对齐态。
 */
import { $view } from "@milkdown/utils";
import { tableSchema } from "@milkdown/preset-gfm";
import { TextSelection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { attachFastTooltip } from "../domTooltip";
import {
  type TableCommand,
  type Alignment,
  insertRow,
  insertColumn,
  removeRow,
  removeColumn,
  deleteTable,
  moveRow,
  moveColumn,
  moveRowTo,
  moveColumnTo,
  alignColumn,
  currentAlignment,
  inHeaderRow,
} from "../tableOps";

const ICONS: Record<string, string> = {
  rowAbove: "M3 12.5h10M8 9.5V3M5.5 5.5L8 3l2.5 2.5",
  rowBelow: "M3 3.5h10M8 6.5V13M5.5 10.5L8 13l2.5-2.5",
  rowUp: "M5 7.5l3-3 3 3M5 12.5l3-3 3 3",
  rowDown: "M5 3.5l3 3 3-3M5 8.5l3 3 3-3",
  rowDel: "M3 6h10v4H3zM6.5 8h3",
  colLeft: "M12.5 3v10M9.5 8H3M5.5 5.5L3 8l2.5 2.5",
  colRight: "M3.5 3v10M6.5 8H13M10.5 5.5L13 8l-2.5 2.5",
  colLeftMove: "M7.5 5l-3 3 3 3M12.5 5l-3 3 3 3",
  colRightMove: "M3.5 5l3 3-3 3M8.5 5l3 3-3 3",
  colDel: "M6 3v10h4V3zM8 6.5v3",
  alignLeft: "M3 4h10M3 8h6M3 12h8",
  alignCenter: "M3 4h10M5 8h6M4 12h8",
  alignRight: "M3 4h10M7 8h6M5 12h8",
  tableDel: "M3 5h10M6 5V3h4v2M5 5l1 8h4l1-8",
};

function iconSvg(name: string): string {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

export const tableNodeView = $view(tableSchema.node, () => (initialNode, view: EditorView, getPos) => {
  let node: ProseNode = initialNode;

  const dom = document.createElement("div");
  dom.className = "am-table-wrap";
  dom.setAttribute("data-testid", "table-wrap");

  const toolbar = document.createElement("div");
  toolbar.className = "am-table-toolbar";
  toolbar.contentEditable = "false";

  const badge = document.createElement("span");
  badge.className = "am-table-size";
  toolbar.appendChild(badge);

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const colgroup = document.createElement("colgroup");
  table.appendChild(colgroup);
  table.appendChild(tbody);
  const scroll = document.createElement("div");
  scroll.className = "am-table-scroll";
  scroll.appendChild(table);
  const grips = document.createElement("div");
  grips.className = "am-table-grips";
  dom.append(toolbar, scroll, grips);

  // 拖拽落点指示器与全局指针拖拽状态
  const dropIndicator = document.createElement("div");
  dropIndicator.className = "am-table-drop-indicator";
  dropIndicator.style.display = "none";
  grips.appendChild(dropIndicator);

  let isDragging = false;
  let activeDrag: { type: "col" | "row"; from: number; pointerId: number } | null = null;
  let dropTargetIndex: number | null = null;

  // 视图级列宽（不写入 Markdown）
  let colWidths: (number | null)[] = [];
  const applyWidths = () => {
    colgroup.innerHTML = "";
    const n = node.firstChild?.childCount ?? 0;
    for (let c = 0; c < n; c++) {
      const col = document.createElement("col");
      const w = colWidths[c];
      if (w) col.style.width = `${w}px`;
      colgroup.appendChild(col);
    }
    if (colWidths.some((w) => w)) table.style.tableLayout = "fixed";
    else table.style.tableLayout = "";
  };

  const run = (cmd: TableCommand) => {
    ensureSelection();
    cmd(view.state, view.dispatch);
    view.focus();
    refresh();
  };

  const posOf = () => (typeof getPos === "function" ? getPos() : undefined);

  const insideThis = () => {
    const p = posOf();
    if (p == null) return false;
    const { from, to } = view.state.selection;
    return from >= p && to <= p + node.nodeSize;
  };

  // 操作栏永远作用于本表格：光标在别处时先定位进本表首个单元格
  const ensureSelection = () => {
    if (insideThis()) return;
    const p = posOf();
    if (p == null) return;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(p + 1), 1)),
    );
  };

  const alignBtns: { btn: HTMLButtonElement; align: Alignment }[] = [];

  const makeBtn = (icon: string, title: string, cmd: TableCommand, danger = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `am-table-btn am-table-btn-icon${danger ? " am-table-btn-danger" : ""}`;
    btn.innerHTML = iconSvg(icon);
    attachFastTooltip(btn, title);
    btn.setAttribute("aria-label", title);
    // 保持表格选区：阻止按钮夺走焦点
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      run(cmd);
    });
    return btn;
  };

  const sep = () => {
    const s = document.createElement("span");
    s.className = "am-table-sep";
    return s;
  };

  const group = (items: HTMLElement[]) => {
    const g = document.createElement("span");
    g.className = "am-table-group";
    g.append(...items);
    return g;
  };

  const alignBtn = (icon: string, title: string, align: Alignment) => {
    const btn = makeBtn(icon, title, alignColumn(align));
    alignBtns.push({ btn, align });
    return btn;
  };

  const rowAboveBtn = makeBtn("rowAbove", "在上方插入行", insertRow("before"));
  const rowUpBtn = makeBtn("rowUp", "上移当前行", moveRow(-1));

  toolbar.append(
    group([
      rowAboveBtn,
      makeBtn("rowBelow", "在下方插入行", insertRow("after")),
      rowUpBtn,
      makeBtn("rowDown", "下移当前行", moveRow(1)),
      makeBtn("rowDel", "删除当前行", removeRow(), true),
    ]),
    sep(),
    group([
      makeBtn("colLeft", "在左侧插入列", insertColumn("left")),
      makeBtn("colRight", "在右侧插入列", insertColumn("right")),
      makeBtn("colLeftMove", "左移当前列", moveColumn(-1)),
      makeBtn("colRightMove", "右移当前列", moveColumn(1)),
      makeBtn("colDel", "删除当前列", removeColumn(), true),
    ]),
    sep(),
    group([
      alignBtn("alignLeft", "当前列左对齐", "left"),
      alignBtn("alignCenter", "当前列居中对齐", "center"),
      alignBtn("alignRight", "当前列右对齐", "right"),
    ]),
    sep(),
    group([makeBtn("tableDel", "删除整个表格", deleteTable, true)]),
  );

  const rel = (r: DOMRect) => {
    const wrapRect = dom.getBoundingClientRect();
    return { x: r.left - wrapRect.left, y: r.top - wrapRect.top, w: r.width, h: r.height };
  };

  const updateColIndicator = (clientX: number) => {
    if (!activeDrag || activeDrag.type !== "col") return;
    const rows = (table as HTMLTableElement).rows;
    if (!rows.length) return;
    const header = rows[0];
    const nCols = header.cells.length;
    if (nCols <= 1) return;

    const from = activeDrag.from;
    const tableRect = table.getBoundingClientRect();
    const tRel = rel(tableRect);

    // 寻找最近的列间边界 boundary: 0..nCols
    let boundary = nCols;
    let lineX = rel(header.cells[nCols - 1].getBoundingClientRect()).x + rel(header.cells[nCols - 1].getBoundingClientRect()).w;

    for (let c = 0; c < nCols; c++) {
      const cellRect = header.cells[c].getBoundingClientRect();
      const midX = cellRect.left + cellRect.width / 2;
      if (clientX < midX) {
        boundary = c;
        lineX = rel(cellRect).x;
        break;
      }
    }

    const targetIdx = boundary <= from ? boundary : boundary - 1;
    dropTargetIndex = targetIdx;

    dropIndicator.className = "am-table-drop-indicator col";
    dropIndicator.style.left = `${Math.round(lineX - 1.5)}px`;
    dropIndicator.style.top = `${Math.round(tRel.y)}px`;
    dropIndicator.style.height = `${Math.round(tRel.h)}px`;
    dropIndicator.style.width = "3px";
    dropIndicator.style.display = "block";
  };

  const updateRowIndicator = (clientY: number) => {
    if (!activeDrag || activeDrag.type !== "row") return;
    const rows = (table as HTMLTableElement).rows;
    const nRows = rows.length;
    if (nRows <= 2) return;

    const from = activeDrag.from;
    const tableRect = table.getBoundingClientRect();
    const tRel = rel(tableRect);

    // 表头行 (0) 绝对保护，重排边界在 1..nRows
    let boundary = nRows;
    let lineY = rel(rows[nRows - 1].getBoundingClientRect()).y + rel(rows[nRows - 1].getBoundingClientRect()).h;

    for (let r = 1; r < nRows; r++) {
      const rowRect = rows[r].getBoundingClientRect();
      const midY = rowRect.top + rowRect.height / 2;
      if (clientY < midY) {
        boundary = r;
        lineY = rel(rowRect).y;
        break;
      }
    }

    const targetIdx = boundary <= from ? boundary : boundary - 1;
    dropTargetIndex = targetIdx;

    dropIndicator.className = "am-table-drop-indicator row";
    dropIndicator.style.left = `${Math.round(tRel.x)}px`;
    dropIndicator.style.top = `${Math.round(lineY - 1.5)}px`;
    dropIndicator.style.width = `${Math.round(tRel.w)}px`;
    dropIndicator.style.height = "3px";
    dropIndicator.style.display = "block";
  };

  // 覆盖层：列宽拖拽手柄 + 行/列拖拽排序抓手（基于 Pointer Events，杜绝浏览器 HTML5 拖拽闪烁与禁止图标）
  const layoutGrips = () => {
    if (isDragging) return;
    grips.innerHTML = "";
    grips.appendChild(dropIndicator);
    const rows = (table as HTMLTableElement).rows;
    if (!rows.length) return;
    const tableRect = table.getBoundingClientRect();
    const header = rows[0];
    const nCols = header.cells.length;

    for (let c = 0; c < nCols; c++) {
      const p = rel(header.cells[c].getBoundingClientRect());
      const cg = document.createElement("div");
      cg.className = "am-col-grip";
      cg.title = "按住拖动以排序列";
      cg.style.left = `${p.x + p.w / 2 - 10}px`;
      cg.style.top = `${p.y + 2}px`;

      const onColPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        activeDrag = { type: "col", from: c, pointerId: e.pointerId };
        dropTargetIndex = c;

        try {
          cg.setPointerCapture(e.pointerId);
        } catch {}
        cg.classList.add("dragging");
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";

        updateColIndicator(e.clientX);
      };

      const onColPointerMove = (e: PointerEvent) => {
        if (!isDragging || !activeDrag || activeDrag.type !== "col") return;
        e.preventDefault();
        e.stopPropagation();
        updateColIndicator(e.clientX);
      };

      const onColPointerUp = (e: PointerEvent) => {
        if (!isDragging || !activeDrag || activeDrag.type !== "col") return;
        e.preventDefault();
        e.stopPropagation();

        try {
          cg.releasePointerCapture(e.pointerId);
        } catch {}

        cg.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        dropIndicator.style.display = "none";

        const from = activeDrag.from;
        const to = dropTargetIndex;
        isDragging = false;
        activeDrag = null;
        dropTargetIndex = null;

        if (to != null && from !== to) {
          const tablePos = posOf();
          run(moveColumnTo(from, to, tablePos));
          if (colWidths.length > Math.max(from, to)) {
            const [moved] = colWidths.splice(from, 1);
            colWidths.splice(to, 0, moved);
          }
        }
        layoutGrips();
      };

      cg.addEventListener("pointerdown", onColPointerDown);
      cg.addEventListener("pointermove", onColPointerMove);
      cg.addEventListener("pointerup", onColPointerUp);
      cg.addEventListener("pointercancel", onColPointerUp);
      grips.appendChild(cg);

      if (c < nCols - 1) {
        const rh = document.createElement("div");
        rh.className = "am-col-resize";
        rh.title = "拖拽调整列宽";
        rh.style.left = `${p.x + p.w - 3}px`;
        rh.style.top = `${rel(tableRect).y}px`;
        rh.style.height = `${tableRect.height}px`;
        rh.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startW = header.cells[c].getBoundingClientRect().width;
          const move = (ev: PointerEvent) => {
            colWidths[c] = Math.max(48, startW + (ev.clientX - startX));
            applyWidths();
            layoutGrips();
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
        grips.appendChild(rh);
      }
    }

    for (let r = 1; r < rows.length; r++) {
      const rr = rel(rows[r].getBoundingClientRect());
      const rg = document.createElement("div");
      rg.className = "am-row-grip";
      rg.title = "按住拖动以排序行";
      rg.style.left = `${rel(tableRect).x + 2}px`;
      rg.style.top = `${rr.y + rr.h / 2 - 10}px`;

      const onRowPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        activeDrag = { type: "row", from: r, pointerId: e.pointerId };
        dropTargetIndex = r;

        try {
          rg.setPointerCapture(e.pointerId);
        } catch {}
        rg.classList.add("dragging");
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";

        updateRowIndicator(e.clientY);
      };

      const onRowPointerMove = (e: PointerEvent) => {
        if (!isDragging || !activeDrag || activeDrag.type !== "row") return;
        e.preventDefault();
        e.stopPropagation();
        updateRowIndicator(e.clientY);
      };

      const onRowPointerUp = (e: PointerEvent) => {
        if (!isDragging || !activeDrag || activeDrag.type !== "row") return;
        e.preventDefault();
        e.stopPropagation();

        try {
          rg.releasePointerCapture(e.pointerId);
        } catch {}

        rg.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        dropIndicator.style.display = "none";

        const from = activeDrag.from;
        const to = dropTargetIndex;
        isDragging = false;
        activeDrag = null;
        dropTargetIndex = null;

        if (to != null && from !== to && to >= 1) {
          const tablePos = posOf();
          run(moveRowTo(from, to, tablePos));
        }
        layoutGrips();
      };

      rg.addEventListener("pointerdown", onRowPointerDown);
      rg.addEventListener("pointermove", onRowPointerMove);
      rg.addEventListener("pointerup", onRowPointerUp);
      rg.addEventListener("pointercancel", onRowPointerUp);
      grips.appendChild(rg);
    }
  };

  const refresh = () => {
    badge.textContent = `${node.childCount} × ${node.firstChild?.childCount ?? 0}`;
    const inside = insideThis();
    const header = inside && inHeaderRow(view.state);
    rowAboveBtn.disabled = header;
    rowUpBtn.disabled = header;
    const align = inside ? currentAlignment(view.state) : null;
    for (const { btn, align: a } of alignBtns) {
      btn.classList.toggle("am-table-btn-active", align === a);
      btn.setAttribute("aria-pressed", String(align === a));
    }
    applyWidths();
    layoutGrips();
  };

  const onSelectionChange = () => {
    if (dom.contains(document.getSelection()?.anchorNode ?? null)) refresh();
  };
  const onLayout = () => layoutGrips();
  document.addEventListener("selectionchange", onSelectionChange);
  toolbar.addEventListener("pointerenter", refresh);
  scroll.addEventListener("scroll", onLayout);
  window.addEventListener("resize", onLayout);
  const ro = new ResizeObserver(onLayout);
  ro.observe(table);
  refresh();
  requestAnimationFrame(onLayout);

  return {
    dom,
    contentDOM: tbody,
    update(newNode: ProseNode) {
      if (newNode.type !== node.type) return false;
      node = newNode;
      refresh();
      return true;
    },
    stopEvent(event: Event) {
      if (isDragging) return true;
      return toolbar.contains(event.target as Node) || grips.contains(event.target as Node);
    },
    ignoreMutation(mutation: { target: Node }) {
      return !tbody.contains(mutation.target);
    },
    destroy() {
      if (isDragging) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        isDragging = false;
      }
      document.removeEventListener("selectionchange", onSelectionChange);
      scroll.removeEventListener("scroll", onLayout);
      window.removeEventListener("resize", onLayout);
      ro.disconnect();
    },
  };
});