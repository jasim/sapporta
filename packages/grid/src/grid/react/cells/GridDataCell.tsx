import { useStore } from "zustand";
import type { MouseEvent } from "react";
import type { GridPath } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import { triggerAllowed } from "../../types/schema";
import type { LevelRow } from "../../types/level-row";
import type { CellSelectionStatus } from "../../types/selection";
import { selectionContainsCoord } from "../../types/selection";
import type { ControllerState } from "../../types/controller-state";
import type { ColId } from "../../types/identity";
import { capabilitiesFor } from "../../types/capabilities";
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
      if (
        triggerAllowed(column, "click") &&
        capabilitiesFor(row.kind).editable
      ) {
        // Single click does not auto-edit by default; double-click does.
      }
    }
  }

  function onDoubleClick() {
    if (runtime.interaction.mode !== "cell-grid") return;
    if (!capabilitiesFor(row.kind).editable) return;
    if (!column.editCell) return;
    if (!triggerAllowed(column, "click")) return;
    // Ensure the cursor lands on this cell before opening the editor —
    // the cursor manager is the single seam for path changes.
    const coord = { rowId: row.id, colId: column.id };
    runtime.cursorManager.moveCellCursorTo({ path, ...coord });
    controller.startEdit(coord, "click");
  }

  const value = row.columns[column.id];
  const content = column.renderCell({
    value,
    row,
    column,
    path,
  });

  return (
    <CellShell
      status={status}
      column={column}
      onMouseDown={onMouseDown}
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
