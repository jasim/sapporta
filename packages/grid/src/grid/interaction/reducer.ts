import type { ColumnSchema } from "../types/schema";
import { editStartsOn } from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type { GridAction } from "../types/action";
import type { GridEffect } from "../types/effects";

// Pure reducer for path-local edit lifecycle.
//
// Cursor motion and per-path `liveCellFocus` writes do NOT pass through this
// reducer — those flow through the cursor manager, which is the sole
// writer of `coordinator.cellCursor` and every controller's `liveCellFocus`.
// Cell range writes on Shift+arrow extension also bypass this reducer; they
// are the cursor manager's `extendCellSelectionTo` responsibility.
//
// What this reducer still owns:
//
//   - START_EDIT / CANCEL_EDIT / COMMIT_EDIT — the editor lifecycle is a
//     path-local concern and the only DOM effect is `focusCellEditor` on
//     open and `focusContainer` on close.

export type ReducerContext = {
  displayed: DisplayedRows;
  schema: ColumnSchema[];
  capabilitiesFor: (kind: LevelRowKind) => RowCapabilities;
};

export type ReducerOutcome = {
  state: ControllerState;
  effects: GridEffect[];
} | null;

export function reduceController(
  state: ControllerState,
  action: GridAction,
  ctx: ReducerContext,
): ReducerOutcome {
  const transition = transitionFor(state, action, ctx);
  if (!transition) return null;
  return {
    state: transition,
    effects: deriveEffects(state, transition),
  };
}

type Next = ControllerState;

function transitionFor(
  state: ControllerState,
  action: GridAction,
  ctx: ReducerContext,
): Next | null {
  switch (action.type) {
    case "START_EDIT": {
      const row = ctx.displayed.rowById.get(action.coord.rowId);
      if (!row) return null;
      if (!ctx.capabilitiesFor(row.kind).editable) return null;
      const column = ctx.schema.find((c) => c.id === action.coord.colId);
      if (!column?.edit) return null;
      if (!editStartsOn(column, action.trigger)) return null;
      const editStart =
        action.trigger === "type"
          ? { trigger: action.trigger, typedSeed: action.initial }
          : { trigger: action.trigger };
      return {
        liveCellFocus: state.liveCellFocus,
        cellSelection: state.cellSelection,
        liveRowFocus: state.liveRowFocus,
        rowSelection: state.rowSelection,
        editing: {
          coord: action.coord,
          editStart,
        },
      };
    }

    case "CANCEL_EDIT": {
      if (!state.editing) return null;
      return {
        liveCellFocus: state.liveCellFocus,
        cellSelection: state.cellSelection,
        liveRowFocus: state.liveRowFocus,
        rowSelection: state.rowSelection,
        editing: null,
      };
    }

    case "COMMIT_EDIT": {
      if (!state.editing) return null;
      // Reducer produces only the state change here — the actual data write
      // and the directional follow-up come from `commitEdit` on the
      // controller (see controller.ts), which calls `writeValue` (the runtime
      // emits `mutationCommitted` from there) and then issues a
      // movement intent through the cursor manager.
      return {
        liveCellFocus: state.liveCellFocus,
        cellSelection: state.cellSelection,
        liveRowFocus: state.liveRowFocus,
        rowSelection: state.rowSelection,
        editing: null,
      };
    }
  }
}

// Edit-lifecycle effects only. Cursor focus effects are queued by the cursor
// manager, and keyboard navigation requests reveal effects after resolving a
// movement target.
function deriveEffects(prev: ControllerState, next: Next): GridEffect[] {
  // Entered an edit: cursor placement inside the editor.
  if (next.editing && !prev.editing) {
    return [
      {
        type: "focusCellEditor",
        cursor:
          next.editing.editStart.trigger === "type" ? "atEnd" : "selectAll",
      },
    ];
  }
  // Exited an edit: return browser focus to the grid container. A
  // directional follow-up (commitEdit's `commit !== "stay"` path) may
  // queue another focusContainer afterward — that's harmless, it's just
  // a second `.focus()` on the same already-focused container.
  if (prev.editing && !next.editing) {
    return [{ type: "focusContainer" }];
  }
  return [];
}
