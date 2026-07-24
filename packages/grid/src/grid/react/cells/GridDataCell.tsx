import { useStore } from "zustand";
import type { MouseEvent } from "react";
import type { GridPath } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import type { DisplayedRows, LevelRow } from "../../types/level-row";
import type { CellSelectionStatus } from "../../types/selection";
import { selectionContainsCoord } from "../../types/selection";
import type { ControllerState } from "../../types/controller-state";
import type { ColId } from "../../types/identity";
import { rowSelectionGestureFromModifiers } from "../../interaction/key-handling";
import { CellShell } from "./CellShell";
import { useGridRuntime } from "../GridRuntimeProvider";
import { runtimeInternalsFor } from "../../runtime/runtime";
import { eventTargetIsWithin } from "../internal/dom-targets";

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
  rowHeader = false,
}: {
  row: LevelRow;
  column: ColumnSchema;
  path: GridPath;
  colOrder: readonly ColId[];
  rowHeader?: boolean;
}) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const internals = runtimeInternalsFor(runtime);
  const controller = internals.controllerFor(path);

  const status = useStore(controller, (s: ControllerState) =>
    selectCellStatus(s, row.id, column.id, level.displayedRows(), colOrder),
  );

  // Pointer interaction has two ordered phases. Mouse down establishes the
  // cursor and selection before click or double-click asks the controller to
  // activate or edit cell content. Preventing the browser default keeps DOM
  // focus from moving into arbitrary rendered content. A cursor change queues
  // `focusContainer`, and this path's EffectRunner focuses the grid root after
  // React commits the state change.
  function onMouseDown(e: MouseEvent) {
    // Without this check, pressing a button in a dialog opened by this cell
    // moves the grid cursor here and takes focus away from the dialog.
    if (!eventTargetIsWithin(e.target, e.currentTarget)) return;
    if (e.button !== 0) return;
    if (runtime.interaction.mode !== "cell-grid") return;
    e.preventDefault();
    const coord = { rowId: row.id, colId: column.id };
    if (rowHeader) {
      internals.coordinator.navigateCell(path, {
        type: "rowPressed",
        target: row.id,
        origin: { kind: "cell", target: coord },
        gesture: rowSelectionGestureFromModifiers(e),
      });
      return;
    }
    internals.coordinator.navigateCell(path, {
      type: "cellPressed",
      target: coord,
      extend: e.shiftKey,
    });
  }

  function onClick(event: MouseEvent) {
    // Without this check, clicking inside a dialog opened by this cell also
    // activates the cell.
    if (!eventTargetIsWithin(event.target, event.currentTarget)) return;
    if (rowHeader) return;
    const coord = { rowId: row.id, colId: column.id };
    if (
      controller.handleCellPointer(coord, {
        gesture: "click",
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
    ) {
      event.stopPropagation();
    }
  }

  function onDoubleClick(event: MouseEvent) {
    // Without this check, double-clicking inside a dialog opened by this cell
    // can start editing the cell behind it.
    if (!eventTargetIsWithin(event.target, event.currentTarget)) return;
    if (rowHeader) return;
    const coord = { rowId: row.id, colId: column.id };
    if (
      controller.handleCellPointer(coord, {
        gesture: "doubleClick",
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
    ) {
      event.stopPropagation();
    }
  }

  const value = row.columns[column.id];
  const coord = { rowId: row.id, colId: column.id };
  const content = column.renderCell({
    value,
    row,
    column,
    path,
    rowHeader,
    activation: internals.cellActivationFor(path, coord),
  });

  return (
    <CellShell
      status={status}
      column={column}
      rowHeader={rowHeader}
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
  displayed: DisplayedRows,
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
