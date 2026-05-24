import type { CellCursor, GridPath, RowId } from "./identity";
import type { DisplayedRows } from "./level-row";
import type { GridInteractionConfig, RowSelectionMode } from "./interaction";

// Row interaction has two different values:
//
//   - `RowCursor`: the row that owns row-list keyboard navigation.
//   - `RowSelection`: the rows that an operation should apply to.
//
// A cursor answers "where will the next Arrow key start?". Selection answers
// "which rows are targets for delete/export/bulk action?". Keeping the two
// values separate is what lets a checkbox column toggle operation targets
// without stealing keyboard focus or changing routing.
export type RowCursor = {
  path: GridPath;
  rowId: RowId;
};

export function rowCursorEqual(
  a: RowCursor | null,
  b: RowCursor | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.rowId === b.rowId;
}

export type RowSelection =
  | null
  | { kind: "single"; rowId: RowId }
  // Range is stored as anchor/head and interpreted against current displayed
  // row order. Sorting or filtering can therefore change which rows lie
  // between the endpoints, and normalization prunes invalid endpoints.
  | { kind: "range"; anchor: RowId; head: RowId }
  // The Set is an implementation detail for arbitrary membership. Public
  // projection always returns ids in displayed order, never insertion order.
  | { kind: "set"; rowIds: ReadonlySet<RowId> };

export function makeRowCursor(path: GridPath, rowId: RowId): RowCursor {
  return { path, rowId };
}

export function makeSingleRowSelection(rowId: RowId): RowSelection {
  return { kind: "single", rowId };
}

export function makeRowRangeSelection(
  anchor: RowId,
  head: RowId,
): RowSelection {
  return { kind: "range", anchor, head };
}

export function makeRowSetSelection(rowIds: Iterable<RowId>): RowSelection {
  const rowIdsSet = new Set(rowIds);
  // Empty selected-row sets are represented by null. That gives subscribers
  // one empty value to compare and avoids storing `{ kind: "set", size: 0 }`.
  return rowIdsSet.size === 0 ? null : { kind: "set", rowIds: rowIdsSet };
}

export function activeRowFor(
  config: GridInteractionConfig,
  cellCursor: CellCursor | null,
  liveRowFocus: RowId | null,
  path: RowCursor["path"],
): RowCursor | null {
  if (config.mode === "cell-grid") {
    if (config.activeRow.kind === "none") return null;
    // Cell-grid active row is derived, not stored. A cell cursor may point at a
    // row in another path; runtime.activeRowFor(path) filters that after this
    // pure helper returns the canonical active-row value.
    return cellCursor ? { path: cellCursor.path, rowId: cellCursor.rowId } : null;
  }
  return liveRowFocus ? { path, rowId: liveRowFocus } : null;
}

export function selectedRowsFor(
  config: GridInteractionConfig,
  activeRow: RowCursor | null,
  storedSelection: RowSelection,
): RowSelection {
  if (config.selectedRows.kind === "none") return null;
  if (config.selectedRows.sync.kind === "follows-active-row") {
    // Derived selection intentionally ignores storedSelection. This is the
    // side-panel/master-detail case: moving the active row changes the
    // effective selected row, but no controller rowSelection write occurs.
    return activeRow ? { kind: "single", rowId: activeRow.rowId } : null;
  }
  return storedSelection;
}

export function rowIdsInRowSelection(
  selection: RowSelection,
  displayed: DisplayedRows,
): readonly RowId[] {
  if (!selection) return [];
  if (selection.kind === "single") {
    return isDisplayedRowSelectable(displayed, selection.rowId)
      ? [selection.rowId]
      : [];
  }
  if (selection.kind === "range") {
    const ai = displayed.rowIndexById.get(selection.anchor);
    const hi = displayed.rowIndexById.get(selection.head);
    if (ai == null || hi == null) return [];
    const lo = Math.min(ai, hi);
    const hi2 = Math.max(ai, hi);
    return displayed.rows
      .slice(lo, hi2 + 1)
      .filter((row) => row.rowSelectable)
      .map((row) => row.id);
  }
  return displayed.rows
    .filter((row) => row.rowSelectable && selection.rowIds.has(row.id))
    .map((row) => row.id);
}

export function rowSelectionContainsRow(
  selection: RowSelection,
  rowId: RowId,
  displayed: DisplayedRows,
): boolean {
  return rowIdsInRowSelection(selection, displayed).includes(rowId);
}

export function normalizeRowSelection(
  selection: RowSelection,
  displayed: DisplayedRows,
  mode: RowSelectionMode,
): RowSelection {
  // The invariant for stored independent row selection: only rows that are
  // currently displayed and row-selectable may remain. DisplayedRows already
  // carries `rowSelectable`, so selection helpers do not re-derive capabilities
  // from row kind and cannot drift from the renderer's view of the row.
  const valid = rowIdsInRowSelection(selection, displayed);
  if (valid.length === 0) return null;
  if (mode === "single") {
    const next = { kind: "single" as const, rowId: valid[0] };
    return rowSelectionSameValue(selection, next, displayed) ? selection : next;
  }
  if (mode === "range") {
    const next =
      selection?.kind === "single" || valid.length === 1
        ? { kind: "single" as const, rowId: valid[0] }
        : {
            kind: "range" as const,
            anchor: valid[0],
            head: valid[valid.length - 1],
          };
    return rowSelectionSameValue(selection, next, displayed) ? selection : next;
  }
  if (selection?.kind === "single") {
    const next = { kind: "single" as const, rowId: valid[0] };
    return rowSelectionSameValue(selection, next, displayed) ? selection : next;
  }
  if (selection?.kind === "range") {
    const next =
      valid.length === 1
        ? { kind: "single" as const, rowId: valid[0] }
        : {
            kind: "range" as const,
            anchor: valid[0],
            head: valid[valid.length - 1],
          };
    return rowSelectionSameValue(selection, next, displayed) ? selection : next;
  }
  const next = makeRowSetSelection(valid);
  return rowSelectionSameValue(selection, next, displayed) ? selection : next;
}

function isDisplayedRowSelectable(
  displayed: DisplayedRows,
  rowId: RowId,
): boolean {
  return displayed.rowById.get(rowId)?.rowSelectable === true;
}

function rowSelectionSameValue(
  a: RowSelection,
  b: RowSelection,
  displayed: DisplayedRows,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "single":
      return b.kind === "single" && a.rowId === b.rowId;
    case "range":
      return b.kind === "range" && a.anchor === b.anchor && a.head === b.head;
    case "set": {
      if (b.kind !== "set") return false;
      const aIds = rowIdsInRowSelection(a, displayed);
      const bIds = rowIdsInRowSelection(b, displayed);
      if (aIds.length !== bIds.length) return false;
      for (let i = 0; i < aIds.length; i++) {
        if (aIds[i] !== bIds[i]) return false;
      }
      return true;
    }
  }
}
