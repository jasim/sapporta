import type { KeyboardEvent, MouseEvent } from "react";
import { rowSelectionGestureFromModifiers } from "../../interaction/key-handling";
import type { GridPath } from "../../types/identity";
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
  // `rowSelectable` is the displayed-row capability used by navigation,
  // operation targeting, and row-selection normalization. Synthetic totals and
  // footers therefore expose the same disabled state in every interaction path.
  const disabled = !row.rowSelectable;

  // The structural control has no cell coordinate. It owns DOM focus while
  // the coordinator clears logical cell focus and applies row selection.
  // Consuming the event here prevents surrounding row and cell handlers from
  // starting a second interaction for the same input.
  function selectFromPointer(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    runtime.coordinator.navigateCell(path, {
      type: "rowPressed",
      target: row.id,
      origin: { kind: "row-control" },
      gesture: rowSelectionGestureFromModifiers(event),
    });
  }

  // Grid installs a native keydown listener on each grid root. That listener
  // ignores `row-header-control` targets because this React handler owns Space
  // and Escape. The DOM guard and propagation stop work together so one key
  // produces exactly one row-selection command, including inside nested grids.
  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!disabled) {
        runtime.coordinator.navigateCell(path, {
          type: "rowPressed",
          target: row.id,
          origin: { kind: "row-control" },
          gesture: "toggle",
        });
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      runtime.coordinator.navigateCell(path, { type: "clearRowSelection" });
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
