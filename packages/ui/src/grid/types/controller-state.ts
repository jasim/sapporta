import type { Coord, RowId } from "./identity";
import type { EditingState } from "./editing";
import type { CellSelectionState } from "./selection";
import type { RowSelection } from "./row-selection";

// The full controller state — what the keyEventToAction sees and what the
// reducer mutates. Stored in a per-path Zustand store. Effects live on a
// sibling channel (controller.effects), not here.
//
// Five fields, five responsibilities:
//
//   - `liveCellFocus`: the per-path mirror of the global cursor. Non-null on
//     exactly the path the cursor is in; null on every other path. Owned
//     and written exclusively by the cursor manager. Cells subscribe to
//     this for the focus indicator — never to `coordinator.cellCursor`, which
//     would broadcast every move to every visible cell.
//
//   - `cellSelection`: the per-path remembered cell range (`anchor` + `head`).
//     Updated only by genuinely range-changing operations (Shift+arrow
//     extend, click+drag, explicit range API). Non-extending user
//     movement clears the range instead of moving its head.
//
//   - `editing`: the per-cell editor lifecycle. Independent of focus and
//     selection. Cleared by COMMIT_EDIT / CANCEL_EDIT.
//
//   - `liveRowFocus`: the per-path mirror of the global row cursor. Meaningful
//     only in row-list mode; cell-grid mode derives active row from the cell
//     cursor when configured.
//
//   - `rowSelection`: independent row operation targets. Meaningful only when
//     `interaction.selectedRows.sync.kind === "independent"`. When selected
//     rows follow the active row, callers must read the effective value through
//     `runtime.selectedRowsFor(path)` instead of reading this field directly.
export type ControllerState = {
  liveCellFocus: Coord | null;
  cellSelection: CellSelectionState | null;
  editing: EditingState | null;
  liveRowFocus: RowId | null;
  rowSelection: RowSelection;
};
