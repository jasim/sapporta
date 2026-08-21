import type { Coord, RowId } from "./identity";
import type { EditingState } from "./editing";
import type { CellSelectionState } from "./selection";
import type { RowSelection } from "./row-selection";

// The full controller state — what the keyEventToAction sees and what the
// reducer mutates. Stored in a per-path Zustand store. Effects live on a
// sibling channel (controller.effects), not here.
//
// Path-local is the key invariant: this store describes one rendered grid
// part, not the whole table tree. A page-level toolbar that wants "all selected
// rows" must ask the runtime for registered paths and combine path-local
// projections deliberately.
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
//   - `rowSelection`: path-local independent row operation selection.
//     Meaningful only when
//     `interaction.selectedRows.sync.kind === "independent"`. When selected
//     rows follow the active row, callers must read the effective value through
//     `runtime.level(path).selectedRows()` instead of reading this field
//     directly.
//     This is not a global table/page selection store.
export type ControllerState = {
  readonly liveCellFocus: Coord | null;
  readonly cellSelection: CellSelectionState | null;
  readonly editing: EditingState | null;
  readonly liveRowFocus: RowId | null;
  readonly rowSelection: RowSelection;
};
