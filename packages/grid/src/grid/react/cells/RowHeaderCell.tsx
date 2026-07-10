import type { KeyboardEvent, MouseEvent } from "react";
import type { GridRuntime } from "../../runtime/create-grid-runtime";
import type { GridPath, RowId } from "../../types/identity";
import type { LevelRow } from "../../types/level-row";
import { useGridRuntime } from "../GridRuntimeProvider";

export function EmptyRowHeaderCell({
  row,
  path,
  selected,
}: {
  row: LevelRow;
  path: GridPath;
  selected: boolean;
}) {
  const runtime = useGridRuntime();
  const disabled = !row.rowSelectable;

  function selectFromPointer(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    clearCellInteractionAcrossGrid(runtime);
    applyRowHeaderSelection(runtime, path, row.id, event);
  }

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!disabled) {
        clearCellInteractionAcrossGrid(runtime);
        runtime.rowInteraction.toggleRowSelection(path, row.id);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      clearRowSelectionAcrossGrid(runtime);
    }
  }

  return (
    <div
      role="rowheader"
      data-grid-part="row-header-cell"
      data-row-header-kind="empty-selectable-cell"
    >
      <button
        type="button"
        aria-label="Select row"
        aria-pressed={selected}
        disabled={disabled}
        data-grid-part="row-header-control"
        onClick={selectFromPointer}
        onKeyDown={selectFromKeyboard}
      />
    </div>
  );
}

export function applyRowHeaderSelection(
  runtime: GridRuntime,
  path: GridPath,
  rowId: RowId,
  modifiers: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
): void {
  if (modifiers.ctrlKey || modifiers.metaKey) {
    runtime.rowInteraction.toggleRowSelection(path, rowId);
    return;
  }

  clearRowSelectionAcrossGrid(runtime, path);
  if (modifiers.shiftKey) {
    runtime.rowInteraction.extendRowSelectionTo(path, rowId);
  } else {
    runtime.rowInteraction.selectRow(path, rowId);
  }
}

export function clearRowSelectionAcrossGrid(
  runtime: GridRuntime,
  exceptPath?: GridPath,
): void {
  for (const registeredPath of runtime.registeredPaths()) {
    if (registeredPath !== exceptPath) {
      runtime.rowInteraction.clearRowSelection(registeredPath);
    }
  }
}

function clearCellInteractionAcrossGrid(runtime: GridRuntime): void {
  for (const registeredPath of runtime.registeredPaths()) {
    runtime.cursorManager.clearCellRange(registeredPath);
  }
  runtime.cursorManager.clearCellCursor();
}
