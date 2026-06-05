import type { Coord, GridPath } from "../types/identity";
import { cursorEqual } from "../types/identity";
import type { CellCursor } from "../types/identity";
import type { CellSelectionState } from "../types/selection";
import type { GridInteractionConfig } from "../types/interaction";
import type { RowCursor, RowSelection } from "../types/row-selection";
import {
  normalizeRowSelection,
  rowCursorEqual,
} from "../types/row-selection";
import type { GridCoordinatorStore } from "./coordinator";
import type { GridControllerCursorPort } from "./controller";
import type { DisplayedRows } from "../types/level-row";

// The cursor manager is the only place that writes the denormalized focus
// mirrors:
//
//   coordinator.cellCursor <-> controller(path).liveCellFocus
//   coordinator.rowCursor  <-> controller(path).liveRowFocus
//
// The coordinator needs one global cursor so navigation can cross paths. Each
// controller also needs a path-local mirror so visible cells/rows can subscribe
// narrowly. Writing both halves here keeps the invariant simple: a controller's
// live focus is non-null exactly when the matching global cursor is in that
// path.
//
// The manager also separates cursor commands from selection commands. Cursor
// commands move the keyboard target; selection commands choose operation
// targets. A row-selector checkbox therefore calls `setRowSelection` without
// moving the row cursor or changing keyboard routing.
export interface CursorManager {
  applyCellCursor: (target: CellCursor | null) => void;
  moveCellCursorTo: (target: CellCursor) => void;
  extendCellSelectionTo: (target: CellCursor) => void;
  setCellRange: (path: GridPath, anchor: Coord, head: Coord) => void;
  clearCellRange: (path: GridPath) => void;
  clearCellCursor: () => void;
  currentCellCursor: () => CellCursor | null;

  applyRowCursor: (target: RowCursor | null) => void;
  moveRowCursorTo: (target: RowCursor) => void;
  extendRowSelectionToCursor: (target: RowCursor) => void;
  setRowSelection: (path: GridPath, selection: RowSelection) => void;
  clearRowSelection: (path: GridPath) => void;
  clearRowCursor: () => void;
  currentRowCursor: () => RowCursor | null;
}

export type CursorManagerDeps = {
  interaction: GridInteractionConfig;
  coordinator: GridCoordinatorStore;
  controllerCursorPortFor: (path: GridPath) => GridControllerCursorPort;
  displayedRowsFor: (path: GridPath) => DisplayedRows;
};

export function createCursorManager(deps: CursorManagerDeps): CursorManager {
  function assertCellGrid(command: string): boolean {
    if (deps.interaction.mode === "cell-grid") return true;
    throw new Error(`CursorManager.${command}: cell cursor commands require cell-grid interaction.`);
  }

  function assertRowList(command: string): boolean {
    if (deps.interaction.mode === "row-list") return true;
    throw new Error(`CursorManager.${command}: row cursor commands require row-list interaction.`);
  }

  function applyCellCursor(target: CellCursor | null): void {
    assertCellGrid("applyCellCursor");
    const prev = deps.coordinator.getState().cellCursor;
    if (cursorEqual(prev, target)) return;

    // When the cell cursor leaves a path, clear that path's live mirror before
    // installing the new cursor. This prevents two levels from rendering as
    // active during the same store tick.
    if (prev && (!target || prev.path !== target.path)) {
      deps.controllerCursorPortFor(prev.path).setLiveCellFocus(null);
    }

    deps.coordinator.setCellCursor(target);

    if (target) {
      const ctrl = deps.controllerCursorPortFor(target.path);
      ctrl.setLiveCellFocus({ rowId: target.rowId, colId: target.colId });
      ctrl.queueEffect({ type: "focusContainer" });
    }
  }

  function moveCellCursorTo(target: CellCursor): void {
    assertCellGrid("moveCellCursorTo");
    const prev = deps.coordinator.getState().cellCursor;
    applyCellCursor(target);
    // Plain movement starts a new cell interaction, so any remembered range is
    // discarded. `applyCellCursor` is lower-level and intentionally does not
    // touch ranges; it is used by commands like collapse fallback.
    if (prev) deps.controllerCursorPortFor(prev.path).setCellSelection(null);
    if (!prev || prev.path !== target.path) {
      deps.controllerCursorPortFor(target.path).setCellSelection(null);
    }
  }

  function extendCellSelectionTo(target: CellCursor): void {
    assertCellGrid("extendCellSelectionTo");
    const prev = deps.coordinator.getState().cellCursor;
    applyCellCursor(target);
    const ctrl = deps.controllerCursorPortFor(target.path);
    const cur = ctrl.getState().cellSelection;
    const head = { rowId: target.rowId, colId: target.colId };
    // Shift-extension keeps the old anchor when possible. Crossing paths starts
    // a new range at the target, because ranges are path-local.
    const anchor = anchorForCellExtension(prev, cur, target);
    if (
      cur &&
      cur.anchor.rowId === anchor.rowId &&
      cur.anchor.colId === anchor.colId &&
      cur.head.rowId === head.rowId &&
      cur.head.colId === head.colId
    ) {
      return;
    }
    ctrl.setCellSelection({ anchor, head });
  }

  function setCellRange(path: GridPath, anchor: Coord, head: Coord): void {
    assertCellGrid("setCellRange");
    applyCellCursor({ path, rowId: head.rowId, colId: head.colId });
    deps.controllerCursorPortFor(path).setCellSelection({ anchor, head });
  }

  function clearCellRange(path: GridPath): void {
    assertCellGrid("clearCellRange");
    deps.controllerCursorPortFor(path).setCellSelection(null);
  }

  function applyRowCursor(target: RowCursor | null): void {
    assertRowList("applyRowCursor");
    const prev = deps.coordinator.getState().rowCursor;
    if (rowCursorEqual(prev, target)) return;

    // Same denormalization rule as cells: one global row cursor, plus a
    // path-local liveRowFocus only on the path that owns it.
    if (prev && (!target || prev.path !== target.path)) {
      deps.controllerCursorPortFor(prev.path).setLiveRowFocus(null);
    }

    deps.coordinator.setRowCursor(target);

    if (target) {
      const ctrl = deps.controllerCursorPortFor(target.path);
      ctrl.setLiveRowFocus(target.rowId);
      ctrl.queueEffect({ type: "focusContainer" });
    }
  }

  function moveRowCursorTo(target: RowCursor): void {
    assertRowList("moveRowCursorTo");
    // Plain row movement does not write stored row selection. If selection
    // follows the active row, runtime.selectedRowsFor derives that on read.
    applyRowCursor(target);
  }

  function extendRowSelectionToCursor(target: RowCursor): void {
    assertRowList("extendRowSelectionToCursor");
    const interaction = deps.interaction;
    if (interaction.mode !== "row-list") return;
    const prev = deps.coordinator.getState().rowCursor;
    const selectedRows = deps.interaction.selectedRows;
    if (
      selectedRows.kind !== "enabled" ||
      selectedRows.sync.kind !== "independent" ||
      interaction.activeRow.keyboard.shiftArrows !== "extend-selected-rows"
    ) {
      // The keyboard policy can say "Shift+arrows still just move". In that
      // case this remains a cursor command, not a selection mutation.
      applyRowCursor(target);
      return;
    }

    applyRowCursor(target);
    const ctrl = deps.controllerCursorPortFor(target.path);
    const cur = ctrl.getState().rowSelection;
    const anchor =
      prev && prev.path === target.path
        ? cur?.kind === "range"
          ? cur.anchor
          : cur?.kind === "single"
            ? cur.rowId
            : prev.rowId
        : target.rowId;
    setRowSelection(target.path, {
      kind: "range",
      anchor,
      head: target.rowId,
    });
  }

  function setRowSelection(path: GridPath, selection: RowSelection): void {
    const selectedRows = deps.interaction.selectedRows;
    if (
      selectedRows.kind !== "enabled" ||
      selectedRows.sync.kind !== "independent"
    ) {
      // Disabled or derived row selection has no stored value to mutate.
      return;
    }
    // Normalize at the write boundary. Controller state should never contain
    // rows that are filtered out, missing after a data refresh, or not valid
    // operation targets for their row kind.
    const next = normalizeRowSelection(
      selection,
      deps.displayedRowsFor(path),
      selectedRows.mode,
    );
    const ctrl = deps.controllerCursorPortFor(path);
    if (ctrl.getState().rowSelection === next) return;
    ctrl.setRowSelection(next);
  }

  function clearRowSelection(path: GridPath): void {
    setRowSelection(path, null);
  }

  return {
    applyCellCursor,
    moveCellCursorTo,
    extendCellSelectionTo,
    setCellRange,
    clearCellRange,
    clearCellCursor: () => applyCellCursor(null),
    currentCellCursor: () => deps.coordinator.getState().cellCursor,
    applyRowCursor,
    moveRowCursorTo,
    extendRowSelectionToCursor,
    setRowSelection,
    clearRowSelection,
    clearRowCursor: () => applyRowCursor(null),
    currentRowCursor: () => deps.coordinator.getState().rowCursor,
  };
}

function anchorForCellExtension(
  prev: CellCursor | null,
  cur: CellSelectionState | null,
  target: CellCursor,
): Coord {
  const sameLevel = !!prev && prev.path === target.path;
  if (sameLevel && cur) return cur.anchor;
  if (sameLevel && prev) return { rowId: prev.rowId, colId: prev.colId };
  return { rowId: target.rowId, colId: target.colId };
}
