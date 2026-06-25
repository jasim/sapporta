import { useStore } from "zustand";
import type { MouseEvent } from "react";
import type { GridPath } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import type { LevelRow } from "../../types/level-row";
import type { CellSelectionStatus } from "../../types/selection";
import { selectionContainsCoord } from "../../types/selection";
import type { ControllerState } from "../../types/controller-state";
import type { ColId } from "../../types/identity";
import { CellShell } from "./CellShell";
import { useGridRuntime } from "../GridRuntimeProvider";

// Per-cell view. One narrow subscription on the transient channel:
//
//   - `status` (from the controller — transient channel): one of
//     "none" | "in-selection" | "focus" | "editing". Derived from the
//     controller's `liveCellFocus` (focus indicator), `editing`, and
//     `cellSelection` (remembered range). A focus-only move flips the old
//     and new focus cells; a non-extending user move may also clear
//     selected cells.
//
// Active/ghost is level-scoped and reaches the DOM via `Grid`'s container
// `data-active` attribute, consumed by CSS — not by a per-cell
// subscription. CellShell composes only `status` into a class; the cell
// renderer sees neither status nor active-ness.
export function GridDataCell({
  row,
  column,
  path,
  colOrder,
}: {
  row: LevelRow;
  column: ColumnSchema;
  path: GridPath;
  colOrder: readonly ColId[];
}) {
  const runtime = useGridRuntime();
  const controller = runtime.controllerFor(path);

  const status = useStore(controller, (s: ControllerState) =>
    selectCellStatus(
      s,
      row.id,
      column.id,
      runtime.displayedRowsFor(path),
      colOrder,
    ),
  );

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if (runtime.interaction.mode !== "cell-grid") return;
    e.preventDefault();
    // Cell mousedown owns only cell-grid interaction. In row-list mode the row
    // shell handles row focus, so a click inside a cell does not create a cell
    // cursor or change cell selection.
    const coord = { rowId: row.id, colId: column.id };
    if (e.shiftKey) {
      runtime.cursorManager.extendCellSelectionTo({ path, ...coord });
    } else {
      runtime.cursorManager.moveCellCursorTo({ path, ...coord });
    }
  }

  function onClick() {
    if (runtime.interaction.mode !== "cell-grid") return;
    const coord = { rowId: row.id, colId: column.id };
    if (controller.handleCellPointer(coord, "click")) return;
  }

  function onDoubleClick() {
    if (runtime.interaction.mode !== "cell-grid") return;
    const coord = { rowId: row.id, colId: column.id };
    runtime.cursorManager.moveCellCursorTo({ path, ...coord });
    controller.handleCellPointer(coord, "doubleClick");
  }

  const value = row.columns[column.id];
  const coord = { rowId: row.id, colId: column.id };
  const content = column.renderCell({
    value,
    row,
    column,
    path,
    activation: runtime.cellActivationFor(path, coord),
  });

  return (
    <CellShell
      status={status}
      column={column}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {content}
    </CellShell>
  );
}

function selectCellStatus(
  s: ControllerState,
  rowId: LevelRow["id"],
  colId: ColumnSchema["id"],
  displayed: ReturnType<ReturnType<typeof useGridRuntime>["displayedRowsFor"]>,
  colOrder: readonly ColId[],
): CellSelectionStatus {
  // Editing wins, but only if this path is the cursor's path — `liveCellFocus`
  // is the per-path mirror of the cursor and is null on every inactive
  // path, so `editing` chrome cannot accidentally paint on a path the
  // cursor isn't in.
  if (
    s.editing &&
    s.liveCellFocus &&
    s.editing.coord.rowId === rowId &&
    s.editing.coord.colId === colId
  ) {
    return "editing";
  }
  if (
    s.liveCellFocus &&
    s.liveCellFocus.rowId === rowId &&
    s.liveCellFocus.colId === colId
  ) {
    return "focus";
  }
  if (
    s.cellSelection &&
    selectionContainsCoord(
      s.cellSelection,
      { rowId, colId },
      displayed,
      colOrder,
    )
  ) {
    return "in-selection";
  }
  return "none";
}
