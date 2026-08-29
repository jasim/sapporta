import type { KeyboardEvent, MouseEvent } from "react";
import { rowSelectionGestureFromModifiers } from "../../interaction/key-handling";
import type { GridPath } from "../../types/identity";
import type { GridPresentation } from "../../types/presentation";
import type { LevelRow } from "../../types/level-row";
import { useGridRuntime } from "../GridRuntimeProvider";
import { runtimeInternalsFor } from "../../runtime/runtime";

export function EmptyRowHeaderCell({
  row,
  path,
  selected,
  presentation,
}: {
  row: LevelRow;
  path: GridPath;
  selected: boolean;
  presentation: GridPresentation;
}) {
  const runtime = useGridRuntime();
  const coordinator = runtimeInternalsFor(runtime).coordinator;
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
    coordinator.navigateCell(
      path,
      {
        type: "rowPressed",
        target: row.id,
        origin: { kind: "row-control" },
        gesture: rowSelectionGestureFromModifiers(event),
      },
      presentation,
    );
  }

  // Grid's native listener yields to `row-header-control` before this delegated
  // React handler runs. Stopping propagation here then prevents ancestor grids
  // from seeing the same input. Plain Space is consumed too: a browser normally
  // turns Space on a button into a click, which would otherwise select the row
  // through the pointer path and silently restore the old shortcut.
  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey && !disabled) {
        coordinator.navigateCell(
          path,
          {
            type: "rowPressed",
            target: row.id,
            origin: { kind: "row-control" },
            gesture: "toggle",
          },
          presentation,
        );
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      coordinator.navigateCell(
        path,
        { type: "clearRowSelection" },
        presentation,
      );
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
        aria-keyshortcuts="Shift+Space"
        aria-pressed={selected}
        disabled={disabled}
        data-grid-part="row-header-control"
        onClick={selectFromPointer}
        onKeyDown={selectFromKeyboard}
      />
    </div>
  );
}
