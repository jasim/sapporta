import type { Coord } from "./identity";
import type {
  CellActivationTrigger,
  CellEditGesture,
  NonTypedCellEditGesture,
} from "./schema";

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
  | { type: "START_EDIT"; coord: Coord; trigger: "type"; initial: string }
  | {
      type: "START_EDIT";
      coord: Coord;
      trigger: NonTypedCellEditGesture;
      initial?: never;
    };

export type GridAction =
  | StartEditAction
  | { type: "CANCEL_EDIT" }
  | { type: "COMMIT_EDIT"; value: unknown; commit: CommitTarget };

export type RowDirection = "up" | "down" | "first" | "last" | { delta: number };

// "preserve" — prefer the source colId on the target if present;
// otherwise fall back to the target's first focusable column.
// "first" — always use the target's first focusable column.
// "last" — always use the target's last focusable column.
export type ColPolicy = "preserve" | "first" | "last";

// Navigation intents are split by domain so a row operation never has to be
// smuggled through a cell movement shape. The controller chooses the parser
// from `interaction.mode`, then the coordinator resolves the intent using the
// matching global cursor.
export type CellNavigationIntent =
  | {
      type: "commitMove";
      target: Exclude<CommitTarget, "stay">;
    }
  | {
      type: "moveColumn";
      direction: "left" | "right" | "rowStart" | "rowEnd";
      extend: boolean;
    }
  | {
      type: "moveRow";
      direction: "up" | "down";
      colPolicy: ColPolicy;
      extend: boolean;
    }
  | {
      type: "moveRowDelta";
      delta: number;
      colPolicy: "preserve";
      extend: boolean;
    }
  | {
      type: "moveGridEdge";
      edge: "first" | "last";
      colPolicy: "preserve";
      extend: boolean;
    }
  | { type: "startEdit"; coord: Coord; trigger: "type"; initial: string }
  | {
      type: "startEdit";
      coord: Coord;
      trigger: NonTypedCellEditGesture;
      initial?: never;
    }
  | { type: "activateCell"; coord: Coord; trigger: CellActivationTrigger }
  | { type: "clearCellSelection" }
  | { type: "clearRowSelection" }
  | { type: "focusFirstCell" }
  | { type: "toggleActiveRowSelection" };

export type CellEditorStartTrigger = CellEditGesture;

export type RowNavigationIntent =
  | { type: "moveActiveRow"; direction: "up" | "down"; extend: boolean }
  | { type: "moveActiveRowDelta"; delta: number; extend: boolean }
  | { type: "moveActiveRowEdge"; edge: "first" | "last"; extend: boolean }
  | { type: "focusFirstRow" }
  | { type: "toggleActiveRowSelection" }
  | { type: "clearRowSelection" }
  | { type: "expandActiveRow" }
  | { type: "collapseActiveRow" }
  | { type: "toggleActiveRowExpansion" };
