import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { CellCursor, ColId, Coord } from "../types/identity";
import type { CellSelectionState } from "../types/selection";
import { makeSelection, selectionContainsCoord } from "../types/selection";
import type { DisplayedRows } from "../types/level-row";
import type { ColumnSchema } from "../types/schema";
import { cellCursorFromEventTarget } from "../react/internal/dom-targets";

export type GridCopyTarget = {
  path: CellCursor["path"];
  selection: CellSelectionState;
};

type ValidCursorContext = {
  cursor: CellCursor;
  coord: Coord;
  displayed: DisplayedRows;
  columns: readonly ColumnSchema[];
  colOrder: readonly ColId[];
};

function resolveGridCopyTargetFromActiveCell(
  runtime: GridRuntime,
): GridCopyTarget | null {
  if (runtime.interaction.mode !== "cell-grid") return null;

  const cursor = runtime.cursorManager.currentCellCursor();
  if (!cursor) return null;

  const context = validCursorContext(runtime, cursor);
  if (!context) return null;

  return selectionTargetForCursor(runtime, context) ?? singleCellTarget(cursor);
}

export function prepareGridCopyTarget(
  runtime: GridRuntime,
  eventTarget: EventTarget | null,
): GridCopyTarget | null {
  if (runtime.interaction.mode !== "cell-grid") return null;

  const cursor = cellCursorFromEventTarget(eventTarget);
  if (!cursor) return resolveGridCopyTargetFromActiveCell(runtime);

  const context = validCursorContext(runtime, cursor);
  if (!context) return null;

  const existingSelection = selectionTargetForCursor(runtime, context);
  if (existingSelection) return existingSelection;

  runtime.cursorManager.moveCellCursorTo(cursor);
  return singleCellTarget(cursor);
}

function selectionTargetForCursor(
  runtime: GridRuntime,
  { cursor, coord, displayed, colOrder }: ValidCursorContext,
): GridCopyTarget | null {
  const selection = safeControllerSelection(runtime, cursor.path);
  if (!selection) return null;
  if (!selectionContainsCoord(selection, coord, displayed, colOrder)) {
    return null;
  }
  return { path: cursor.path, selection };
}

function singleCellTarget(cursor: CellCursor): GridCopyTarget {
  return {
    path: cursor.path,
    selection: makeSelection({ rowId: cursor.rowId, colId: cursor.colId }),
  };
}

function validCursorContext(
  runtime: GridRuntime,
  cursor: CellCursor,
): ValidCursorContext | null {
  const displayed = safeDisplayedRowsFor(runtime, cursor.path);
  const columns = safeColumnsFor(runtime, cursor.path);
  if (!displayed || !columns) return null;
  if (!displayed.rowById.has(cursor.rowId)) return null;
  if (!columns.some((column) => column.id === cursor.colId)) return null;

  return {
    cursor,
    coord: { rowId: cursor.rowId, colId: cursor.colId },
    displayed,
    columns,
    colOrder: columns.map((column) => column.id),
  };
}

function safeDisplayedRowsFor(
  runtime: GridRuntime,
  path: CellCursor["path"],
): DisplayedRows | null {
  try {
    return runtime.displayedRowsFor(path);
  } catch {
    return null;
  }
}

function safeColumnsFor(
  runtime: GridRuntime,
  path: CellCursor["path"],
): readonly ColumnSchema[] | null {
  try {
    return runtime.schemaAt(path).columns;
  } catch {
    return null;
  }
}

function safeControllerSelection(
  runtime: GridRuntime,
  path: CellCursor["path"],
): CellSelectionState | null {
  try {
    return runtime.controllerFor(path).getState().cellSelection;
  } catch {
    return null;
  }
}
