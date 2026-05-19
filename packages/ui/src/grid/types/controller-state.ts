import type { Coord } from "./identity";
import type { EditingState } from "./editing";
import type { SelectionState } from "./selection";

// The full controller state — what the keyEventToAction sees and what the
// reducer mutates. Stored in a per-path Zustand store. Effects live on a
// sibling channel (controller.effects), not here.
//
// Three fields, three responsibilities:
//
//   - `liveFocus`: the per-path mirror of the global cursor. Non-null on
//     exactly the path the cursor is in; null on every other path. Owned
//     and written exclusively by the focus manager. Cells subscribe to
//     this for the focus indicator — never to `coordinator.cursor`, which
//     would broadcast every move to every visible cell.
//
//   - `selection`: the per-path remembered range (`anchor` + `head`).
//     Updated only by genuinely range-changing operations (Shift+arrow
//     extend, click+drag, explicit range API). Non-extending user
//     movement clears the range instead of moving its head.
//
//   - `editing`: the per-cell editor lifecycle. Independent of focus and
//     selection. Cleared by COMMIT_EDIT / CANCEL_EDIT.
export type ControllerState = {
  liveFocus: Coord | null;
  selection: SelectionState | null;
  editing: EditingState | null;
};
