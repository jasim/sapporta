import type { Coord } from "./identity";
import type { EditTrigger, NonTypedEditTrigger } from "./schema";

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

// Reducer-level actions. Verbs on the controller (startEdit, commitEdit, …)
// fan out to one of these. Cursor motion does NOT — it goes through the
// focus manager (see `interaction/focus-manager.ts`); the reducer only
// handles edit lifecycle and range clearing.
export type StartEditAction =
  | { type: "START_EDIT"; coord: Coord; trigger: "type"; initial: string }
  | {
      type: "START_EDIT";
      coord: Coord;
      trigger: NonTypedEditTrigger;
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

export type NavigationIntent =
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
  | { type: "startEdit"; trigger: "type"; initial: string }
  | { type: "startEdit"; trigger: NonTypedEditTrigger; initial?: never }
  | { type: "clearSelection" }
  | { type: "focusFirst" };
