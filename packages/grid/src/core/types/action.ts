import type { Coord, RowId } from "./identity";
import type {
  CellActivationTrigger,
  CellEditGesture,
  NonTypedCellEditGesture,
} from "./schema";
import type { RowActivationTrigger, RowSelectionGesture } from "./interaction";

export type NavigationDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "next"
  | "prev"
  | "rowStart"
  | "rowEnd"
  | "start"
  | "end"
  | "pageUp"
  | "pageDown";

// What target a commit should move to. "stay" keeps focus on the same cell.
export type CommitTarget = NavigationDirection | "stay";

// Reducer-level actions. Verbs on the controller (startEdit, commitEdit, ...)
// fan out to one of these. Cursor motion does NOT — it goes through the cursor
// manager (see `interaction/cursor-manager.ts`); the reducer only handles edit
// lifecycle.
export type StartEditAction =
  | {
      readonly type: "START_EDIT";
      readonly coord: Coord;
      readonly trigger: "type";
      readonly initial: string;
    }
  | {
      readonly type: "START_EDIT";
      readonly coord: Coord;
      readonly trigger: NonTypedCellEditGesture;
      readonly initial?: never;
    };

export type GridAction =
  | StartEditAction
  | { readonly type: "CANCEL_EDIT" }
  | {
      readonly type: "COMMIT_EDIT";
      readonly value: unknown;
      readonly commit: CommitTarget;
    };

export type RowDirection =
  "up" | "down" | "first" | "last" | { readonly delta: number };

// "preserve" — prefer the source colId on the target if present;
// otherwise fall back to the target's first focusable column.
// "first" — always use the target's first focusable column.
// "last" — always use the target's last focusable column.
export type ColPolicy = "preserve" | "first" | "last";

// Interaction intents are split by the runtime's keyboard-routing domain. A
// cell-grid may still expose row-selection controls, but using one does not
// switch Arrow-key routing to the row-list domain. Controllers and pointer
// adapters emit the matching intent; the coordinator applies it using the
// canonical cursors and path-local selection state.
export type CellNavigationIntent =
  | {
      readonly type: "commitMove";
      readonly target: Exclude<CommitTarget, "stay">;
    }
  | {
      readonly type: "moveColumn";
      readonly direction: "left" | "right" | "rowStart" | "rowEnd";
      readonly extend: boolean;
    }
  | {
      readonly type: "moveRow";
      readonly direction: "up" | "down";
      readonly colPolicy: ColPolicy;
      readonly extend: boolean;
    }
  | {
      readonly type: "moveRowDelta";
      readonly delta: number;
      readonly colPolicy: "preserve";
      readonly extend: boolean;
    }
  | {
      readonly type: "moveGridEdge";
      readonly edge: "first" | "last";
      readonly colPolicy: "preserve";
      readonly extend: boolean;
    }
  | {
      readonly type: "startEdit";
      readonly coord: Coord;
      readonly trigger: "type";
      readonly initial: string;
    }
  | {
      readonly type: "startEdit";
      readonly coord: Coord;
      readonly trigger: NonTypedCellEditGesture;
      readonly initial?: never;
    }
  | {
      readonly type: "activateCell";
      readonly coord: Coord;
      readonly trigger: CellActivationTrigger;
    }
  | {
      readonly type: "activateRow";
      readonly rowId: RowId;
      readonly coord: Coord;
      readonly trigger: RowActivationTrigger;
    }
  // Pointer selection enters through the same coordinator as keyboard
  // navigation. The coordinator can therefore apply one cross-path selection
  // rule before the cursor manager updates path-local focus and ranges.
  | {
      readonly type: "cellPressed";
      readonly target: Coord;
      readonly extend: boolean;
    }
  | {
      readonly type: "rowPressed";
      readonly target: RowId;
      // A data-backed row header remains the active cell and therefore supplies
      // a cell coordinate. A structural row control owns DOM focus and has no
      // cell coordinate, so the coordinator clears the logical cell cursor.
      readonly origin:
        | { readonly kind: "cell"; readonly target: Coord }
        | { readonly kind: "row-control" };
      readonly gesture: RowSelectionGesture;
    }
  | { readonly type: "clearCellSelection" }
  | { readonly type: "clearRowSelection" }
  | { readonly type: "focusFirstCell" }
  | { readonly type: "toggleActiveRowSelection" };

export type CellEditorStartTrigger = CellEditGesture;

export type RowNavigationIntent =
  | {
      readonly type: "moveActiveRow";
      readonly direction: "up" | "down";
      readonly extend: boolean;
    }
  | {
      readonly type: "moveActiveRowDelta";
      readonly delta: number;
      readonly extend: boolean;
    }
  | {
      readonly type: "moveActiveRowEdge";
      readonly edge: "first" | "last";
      readonly extend: boolean;
    }
  | { readonly type: "focusFirstRow" }
  | { readonly type: "toggleActiveRowSelection" }
  | { readonly type: "clearRowSelection" }
  | {
      readonly type: "activateRow";
      readonly rowId: RowId;
      readonly trigger: RowActivationTrigger;
    }
  | { readonly type: "expandActiveRow" }
  | { readonly type: "collapseActiveRow" }
  | { readonly type: "toggleActiveRowExpansion" };
