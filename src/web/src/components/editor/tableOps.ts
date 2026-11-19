/**
 * 表格操作命令层：基于 prosemirror-tables 的选区矩形（selectedRect）定位当前行列。
 * 插行/插列自行实现：上游 prosemirror-tables 命令假设表头是普通行内 header cell，
 * 与 Milkdown gfm 的独立 table_header_row schema 不兼容（会在表头位置插出非法内容，
 * 被 PM slice fit 拆成空表）。新单元格继承所在列的对齐属性。
 */
import {
  selectedRect,
  moveTableRow,
  moveTableColumn,
  deleteRow,
  deleteColumn,
  deleteTable,
} from "prosemirror-tables";
import type { EditorState } from "@milkdown/prose/state";
import { Fragment, type Node as ProseNode } from "@milkdown/prose/model";

export type TableCommand = (state: any, dispatch?: (tr: any) => void) => boolean;

export { deleteTable };

function rectOf(state: EditorState) {
  try {
    return selectedRect(state);
  } catch {
    return null;
  }
}

function rowPos(table: ProseNode, tableStart: number, row: number): number {
  let pos = tableStart;
  for (let i = 0; i < row; i++) pos += table.child(i).nodeSize;
  return pos;
}

function columnAlignments(table: ProseNode, width: number): (string | null)[] {
  const header = table.firstChild;
  return Array.from({ length: width }, (_, c) => header?.child(c)?.attrs.alignment ?? null);
}

/** 插行：表头之上不可插（返回 false，按钮禁用）；新行为 body 行并继承列对齐。 */
export const insertRow = (where: "before" | "after"): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  const index = where === "before" ? r.top : r.bottom;
  if (index === 0) return false;
  if (!dispatch) return true;
  const { table, tableStart, map } = r;
  const schema = table.type.schema;
  const aligns = columnAlignments(table, map.width);
  const cells = aligns.map((a) =>
    schema.nodes.table_cell.createAndFill({ alignment: a }, schema.nodes.paragraph.create()),
  );
  if (cells.some((c) => !c)) return false;
  const row = schema.nodes.table_row.create(null, cells.filter((c): c is NonNullable<typeof c> => c != null));
  dispatch(state.tr.insert(rowPos(table, tableStart, index), row));
  return true;
};

/** 插列：逐行自底向上插入，表头行插 header cell，其余插 body cell。 */
export const insertColumn = (where: "left" | "right"): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  const index = where === "left" ? r.left : r.right;
  if (!dispatch) return true;
  const { table, tableStart, map } = r;
  const schema = table.type.schema;
  const aligns = columnAlignments(table, map.width);
  const align = aligns[Math.min(index, map.width - 1)] ?? null;
  let tr = state.tr;
  for (let row = map.height - 1; row >= 0; row--) {
    const rowNode = table.child(row);
    const type = rowNode.type.name === "table_header_row" ? schema.nodes.table_header : schema.nodes.table_cell;
    const cell = type.createAndFill({ alignment: align }, schema.nodes.paragraph.create());
    if (!cell) return false;
    let off = 1;
    for (let c = 0; c < index; c++) off += rowNode.child(c).nodeSize;
    tr = tr.insert(rowPos(table, tableStart, row) + off, cell);
  }
  dispatch(tr);
  return true;
};

/** 删行：表头行被删时提升下一行为表头；仅剩一行时删除整表。 */
export const removeRow = (): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  const { table, tableStart, map } = r;
  if (map.height === 1) return deleteTable(state, dispatch);
  if (r.top === 0) {
    if (!dispatch) return true;
    const schema = table.type.schema;
    const oldHeader = table.firstChild;
    const next = table.child(1);
    const aligns = columnAlignments(table, map.width);
    const headers = Array.from({ length: next.childCount }, (_, c) =>
      schema.nodes.table_header.createAndFill({ alignment: aligns[c] ?? null }, next.child(c).content),
    );
    if (headers.some((h) => !h)) return false;
    const headerRow = schema.nodes.table_header_row.create(null, headers.filter((h): h is NonNullable<typeof h> => h != null));
    // 单步替换 [表头行, 下一行) 为新表头行，避免多步位置偏移
    dispatch(state.tr.replaceWith(rowPos(table, tableStart, 0), rowPos(table, tableStart, 2), headerRow));
    return true;
  }
  return deleteRow(state, dispatch);
};

/** 删列：仅剩一列时删除整表。 */
export const removeColumn = (): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  if (r.map.width === 1) return deleteTable(state, dispatch);
  return deleteColumn(state, dispatch);
};

export const moveRow = (dir: -1 | 1): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  const from = r.top;
  const to = from + dir;
  if (to < 0 || to >= r.map.height || from === 0 || to === 0) return false;
  return moveTableRow({ from, to })(state, dispatch);
};

export const moveColumn = (dir: -1 | 1): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  const from = r.left;
  const to = from + dir;
  if (to < 0 || to >= r.map.width) return false;
  return moveTableColumn({ from, to })(state, dispatch);
};

/** 拖拽排序：把行 from 移到 to（表头行严密保护不参与重排）。优先使用确切的 tablePos。 */
export const moveRowTo = (from: number, to: number, pos?: number): TableCommand => (state, dispatch) => {
  if (from === to || from <= 0 || to <= 0) return false;
  let tableNode: ProseNode | null = null;
  let startPos = -1;

  if (typeof pos === "number") {
    const at = state.doc.nodeAt(pos);
    if (at && (at.type.name === "table" || (at.type.spec as any)?.tableRole === "table")) {
      tableNode = at;
      startPos = pos;
    }
  }
  if (!tableNode) {
    const r = rectOf(state);
    if (r) {
      tableNode = r.table;
      startPos = r.tableStart - 1;
    }
  }
  if (!tableNode || startPos < 0) return false;
  if (from >= tableNode.childCount || to >= tableNode.childCount) return false;

  const rows: ProseNode[] = [];
  for (let r = 0; r < tableNode.childCount; r++) {
    rows.push(tableNode.child(r));
  }
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);

  const newTable = tableNode.copy(Fragment.from(rows));
  if (dispatch) {
    dispatch(state.tr.replaceWith(startPos, startPos + tableNode.nodeSize, newTable));
  }
  return true;
};

/** 拖拽排序：把列 from 移到 to。优先使用确切的 tablePos，选区在表外亦可百分之百成功。 */
export const moveColumnTo = (from: number, to: number, pos?: number): TableCommand => (state, dispatch) => {
  if (from === to || from < 0 || to < 0) return false;
  let tableNode: ProseNode | null = null;
  let startPos = -1;

  if (typeof pos === "number") {
    const at = state.doc.nodeAt(pos);
    if (at && (at.type.name === "table" || (at.type.spec as any)?.tableRole === "table")) {
      tableNode = at;
      startPos = pos;
    }
  }
  if (!tableNode) {
    const r = rectOf(state);
    if (r) {
      tableNode = r.table;
      startPos = r.tableStart - 1;
    }
  }
  if (!tableNode || startPos < 0) return false;
  const colCount = tableNode.firstChild?.childCount ?? 0;
  if (from >= colCount || to >= colCount) return false;

  const newRows: ProseNode[] = [];
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    const cells: ProseNode[] = [];
    for (let c = 0; c < row.childCount; c++) {
      cells.push(row.child(c));
    }
    if (from < cells.length && to < cells.length) {
      const [moved] = cells.splice(from, 1);
      cells.splice(to, 0, moved);
    }
    newRows.push(row.copy(Fragment.from(cells)));
  }

  const newTable = tableNode.copy(Fragment.from(newRows));
  if (dispatch) {
    dispatch(state.tr.replaceWith(startPos, startPos + tableNode.nodeSize, newTable));
  }
  return true;
};

export type Alignment = "left" | "center" | "right";

/** 对齐作用于选区覆盖的所有列（光标态为当前列）。 */
export const alignColumn = (alignment: Alignment): TableCommand => (state, dispatch) => {
  const r = rectOf(state);
  if (!r) return false;
  if (!dispatch) return true;
  let tr = state.tr;
  for (let row = 0; row < r.map.height; row++) {
    for (let col = r.left; col < r.right; col++) {
      const offset = r.map.positionAt(row, col, r.table);
      const cell = r.table.nodeAt(offset);
      if (cell) tr = tr.setNodeMarkup(r.tableStart + offset, undefined, { ...cell.attrs, alignment });
    }
  }
  dispatch(tr);
  return true;
};

export function currentAlignment(state: EditorState): Alignment | null {
  const r = rectOf(state);
  if (!r) return null;
  const cell = r.table.nodeAt(r.map.positionAt(r.top, r.left, r.table));
  return (cell?.attrs.alignment as Alignment) ?? null;
}

export function inHeaderRow(state: EditorState): boolean {
  const r = rectOf(state);
  return !!r && r.top === 0;
}