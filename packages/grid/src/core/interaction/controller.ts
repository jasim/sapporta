// The transient channel — one store per `GridPath`.
//
// Holds five orthogonal pieces of per-path state:
//
//   - `liveCellFocus` — the per-path mirror of the global cell cursor. Non-null
//     iff this path is the path the cell cursor is in. Cells subscribe to this
//     for the focus indicator. Owned and written exclusively by the cursor
//     manager (via `setLiveCellFocus`); no reducer, movement code, or click
//     handler writes it directly.
//
//   - `cellSelection` — the per-path remembered cell range (`anchor` + `head`).
//     Updated only by genuinely range-changing operations: shift+arrow,
//     click+drag, explicit range API. Non-extending user movement clears
//     it through the cursor manager; the low-level cursor synchronisation
//     primitive does not rewrite it.
//
//   - `editing` — per-cell editor lifecycle, untouched by this design.
//
//   - `liveRowFocus` — the path-local mirror of the global row cursor. It is
//     meaningful only in row-list mode; cell-grid mode derives any active row
//     from the active cell instead.
//
//   - `rowSelection` — stored independent row operation targets. It is ignored
//     when selected rows are configured to follow the active row.
//
// State outlives DOM presence: collapsing and re-expanding a level
// preserves its focus mirrors and selections (the controller is lazily
// created by the runtime and cached for its lifetime, not tied to
// mount/unmount).
//
// A sibling `effects` store carries pure reducer outputs out to
// EffectRunner for DOM work — see `types/effects.ts`. Cursor moves use it for
// focus, and navigation explicitly requests reveal effects after it resolves a
// target.
//
// Selection changes never invalidate displayed rows. The displayed-rows store
// is the only source of body render input; it invalidates only on source,
// phantom, or future view-state changes. This is critical: focus and
// selection changes must not trigger displayed-row derivation.
//
// For the four-channel invariant this wires into, see `index.ts`.

import { createStore, type StoreApi } from "zustand/vanilla";
import {
  keyEventToCellIntent,
  keyEventToRowIntent,
  pointerEventToCellIntent,
  pointerEventToRowIntent,
  type CellKeyboardPresentation,
} from "./key-handling";
import type {
  CellActivationTrigger,
  ColumnSchema,
  NonTypedCellEditGesture,
} from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRow } from "../types/level-row";
import { capabilitiesFor } from "../types/capabilities";
import type { Coord, GridPath, RowId } from "../types/identity";
import type {
  CommitTarget,
  CellNavigationIntent,
  GridAction,
  RowNavigationIntent,
} from "../types/action";
import type { GridEffect } from "../types/effects";
import type { CellSelectionState } from "../types/selection";
import type {
  GridPointerInput,
  GridInteractionConfig,
  RowActivationTrigger,
} from "../types/interaction";
import type { RowSelection } from "../types/row-selection";
import { reduceController } from "./reducer";

export interface GridControllerPublicVerbs {
  readonly startEdit: {
    (coord: Coord, trigger: "type", initial: string): void;
    (coord: Coord, trigger: NonTypedCellEditGesture): void;
  };
  readonly activateCell: (coord: Coord, trigger: CellActivationTrigger) => void;
  readonly handleCellPointer: (
    coord: Coord,
    pointer: GridPointerInput,
    presentation: CellKeyboardPresentation,
  ) => boolean;
  readonly handleRowPointer: (
    rowId: RowId,
    pointer: GridPointerInput,
  ) => boolean;
  readonly cancelEdit: () => void;
  // Closes the editor, writes the cell, and (when `commit !== "stay"`) moves
  // focus in the promised direction, in `presentation`'s column order.
  readonly commitEdit: (
    value: unknown,
    commit: CommitTarget,
    presentation: CellKeyboardPresentation,
  ) => void;
  readonly clearCellSelection: () => void;
  readonly clearRowSelection: () => void;
  // Return browser focus to this grid without changing its cursor, selection,
  // editing state, or viewport.
  readonly focus: () => void;
  // host I/O — stable; bound once to DOM by Grid.tsx. Returns true if the
  // event was consumed (caller should preventDefault), false otherwise.
  readonly handleKey: (
    e: KeyboardEvent,
    presentation: CellKeyboardPresentation,
  ) => boolean;
  // Explicit viewport reveal. This is deliberately not part of cursor
  // placement: pointer clicks should be able to move focus without moving
  // visible content, while keyboard-style navigation can reveal its resolved
  // destination after choosing a target.
  readonly revealCell: (coord: Coord) => void;
  readonly revealRow: (rowId: RowId) => void;
  readonly flushEffects: () => void;
  // Sibling channel for queued effects. EffectRunner subscribes to this and
  // calls flushEffects() after running them.
  readonly effects: Pick<
    StoreApi<readonly GridEffect[]>,
    "getState" | "getInitialState" | "subscribe"
  >;
}

export interface GridControllerCursorPort {
  getState: StoreApi<ControllerState>["getState"];
  setLiveCellFocus: (focus: Coord | null) => void;
  setCellSelection: (selection: CellSelectionState | null) => void;
  setLiveRowFocus: (rowId: RowId | null) => void;
  setRowSelection: (selection: RowSelection) => void;
  queueEffect: (effect: GridEffect) => void;
}

type ReadonlyControllerStore = Pick<
  StoreApi<ControllerState>,
  "getState" | "getInitialState" | "subscribe"
>;

export type GridControllerPublic = ReadonlyControllerStore &
  GridControllerPublicVerbs;

type MutableGridControllerPublicVerbs = {
  -readonly [
    Key in keyof GridControllerPublicVerbs
  ]: GridControllerPublicVerbs[Key];
};

export type GridControllerStore = StoreApi<ControllerState> &
  MutableGridControllerPublicVerbs &
  GridControllerCursorPort & {
    dispatch: (action: GridAction) => void;
  };

export type CreateControllerArgs = {
  path: GridPath;
  interaction: GridInteractionConfig;
  // These values are intentionally read when an input is handled. A controller
  // can outlive row refreshes and source-state changes, so a captured snapshot
  // could make the next Enter key act on a row or write capability that is no
  // longer current.
  getDisplayed: () => DisplayedRows;
  getSchema: () => readonly ColumnSchema[];
  /** Returns whether this path's source currently accepts writes. */
  isWritable: () => boolean;
  // `presentation` names the column order movement resolves against.
  onNavigateCell?: (
    intent: CellNavigationIntent,
    presentation: CellKeyboardPresentation,
  ) => void;
  onNavigateRow?: (intent: RowNavigationIntent) => void;
  clearCellRange?: (path: GridPath) => void;
  clearRowSelection?: (path: GridPath) => void;
  // Cell value writer — invoked from commitEdit. The runtime wires this to
  // `writeCell`, where it calls the path source's write capability and emits
  // `mutationCommitted`.
  writeValue?: (coord: Coord, newValue: unknown) => void;
  activateCell?: (coord: Coord, trigger: CellActivationTrigger) => void;
  activateRow?: (
    rowId: RowId,
    trigger: RowActivationTrigger,
    coord?: Coord,
  ) => boolean;
};

const INITIAL: ControllerState = {
  liveCellFocus: null,
  cellSelection: null,
  editing: null,
  liveRowFocus: null,
  rowSelection: null,
};

const EMPTY_EFFECTS: GridEffect[] = [];

export function createGridController(
  args: CreateControllerArgs,
): GridControllerStore {
  const store = createStore<ControllerState>(
    () => INITIAL,
  ) as GridControllerStore;
  const effects = createStore<GridEffect[]>(() => EMPTY_EFFECTS);
  store.effects = effects;

  function ctx() {
    return {
      displayed: args.getDisplayed(),
      schema: args.getSchema(),
      isCellEditable,
    };
  }

  function isCellEditable(row: LevelRow, column: ColumnSchema): boolean {
    // An app can use the same editable column schema with writable and readonly
    // sources, while one displayed level can also contain structural rows that
    // must never open an editor. Keep this as one shared runtime predicate so
    // keyboard and pointer input choose the same primary action, and direct
    // startEdit calls are checked against the same current conditions.
    return (
      args.isWritable() &&
      capabilitiesFor(row.kind).editable &&
      column.edit !== undefined
    );
  }

  function pushEffects(toAppend: GridEffect[]): void {
    if (toAppend.length === 0) return;
    const cur = effects.getState();
    effects.setState(cur.length === 0 ? toAppend : [...cur, ...toAppend], true);
  }

  function dispatch(action: GridAction): void {
    const outcome = reduceController(store.getState(), action, ctx());
    if (!outcome) return;
    store.setState(outcome.state, true);
    pushEffects(outcome.effects);
  }

  store.dispatch = dispatch;

  // Cursor-manager-owned writers. Path-local idempotence is the only
  // short-circuit here; cross-path clearing and global cursor writes are
  // handled in the cursor manager.
  store.setLiveCellFocus = (focus) => {
    const cur = store.getState();
    const same =
      (cur.liveCellFocus === null && focus === null) ||
      (!!cur.liveCellFocus &&
        !!focus &&
        cur.liveCellFocus.rowId === focus.rowId &&
        cur.liveCellFocus.colId === focus.colId);
    if (same) return;
    store.setState({ ...cur, liveCellFocus: focus }, true);
  };

  store.setCellSelection = (selection) => {
    const cur = store.getState();
    if (cur.cellSelection === selection) return;
    store.setState({ ...cur, cellSelection: selection }, true);
  };

  store.setLiveRowFocus = (rowId) => {
    const cur = store.getState();
    if (cur.liveRowFocus === rowId) return;
    store.setState({ ...cur, liveRowFocus: rowId }, true);
  };

  store.setRowSelection = (selection) => {
    const cur = store.getState();
    if (cur.rowSelection === selection) return;
    store.setState({ ...cur, rowSelection: selection }, true);
  };

  store.queueEffect = (effect) => {
    pushEffects([effect]);
  };

  store.startEdit = (coord, trigger, initial?: string) => {
    if (args.interaction.mode !== "cell-grid") return;
    if (trigger === "type") {
      if (initial === undefined) return;
      dispatch({ type: "START_EDIT", coord, trigger, initial });
      return;
    }
    dispatch({ type: "START_EDIT", coord, trigger });
  };
  store.activateCell = (coord, trigger) => {
    args.activateCell?.(coord, trigger);
  };
  store.handleCellPointer = (coord, pointer, presentation) => {
    if (args.interaction.mode !== "cell-grid") return false;
    const row = args.getDisplayed().rowById.get(coord.rowId);
    const column = args.getSchema().find((c) => c.id === coord.colId);
    if (!row || !column) return false;
    const intent = pointerEventToCellIntent({
      column,
      rowId: coord.rowId,
      editable: isCellEditable(row, column),
      gesture: pointer.gesture,
    });
    if (intent) {
      args.onNavigateCell?.(
        { type: "cellPressed", target: coord, extend: false },
        presentation,
      );
      return applyCellIntent(intent, presentation);
    }
    const rowIntent = pointerEventToRowIntent({
      config: args.interaction,
      rowId: coord.rowId,
      pointer,
    });
    if (!rowIntent || rowIntent.type !== "activateRow" || !args.activateRow) {
      return false;
    }
    args.onNavigateCell?.(
      { type: "cellPressed", target: coord, extend: false },
      presentation,
    );
    return args.activateRow(rowIntent.rowId, rowIntent.trigger, coord);
  };
  store.handleRowPointer = (rowId, pointer) => {
    const intent = pointerEventToRowIntent({
      config: args.interaction,
      rowId,
      pointer,
    });
    return intent ? applyRowIntent(intent) : false;
  };
  store.cancelEdit = () => dispatch({ type: "CANCEL_EDIT" });
  store.clearCellSelection = () => {
    args.clearCellRange?.(args.path);
  };
  store.clearRowSelection = () => args.clearRowSelection?.(args.path);
  store.focus = () => {
    store.queueEffect({ type: "focusContainer" });
  };
  store.revealCell = (coord) => {
    store.queueEffect({ type: "scrollFocusIntoView", coord });
  };
  store.revealRow = (rowId) => {
    store.queueEffect({ type: "scrollRowIntoView", rowId });
  };

  function applyCellIntent(
    intent: CellNavigationIntent,
    presentation: CellKeyboardPresentation,
  ): boolean {
    const focus = store.getState().liveCellFocus;
    switch (intent.type) {
      case "clearCellSelection": {
        // Controllers created by GridRuntime have a navigation callback. The
        // callback keeps keyboard clearing on the same coordinator path as
        // pointer selection. A standalone controller with a cursor port can
        // still clear its own path when no coordinator is attached.
        if (args.onNavigateCell) {
          args.onNavigateCell(intent, presentation);
        } else {
          store.clearCellSelection();
        }
        return true;
      }
      case "clearRowSelection":
        args.onNavigateCell?.(intent, presentation);
        return !!args.onNavigateCell;
      case "focusFirstCell": {
        args.onNavigateCell?.(intent, presentation);
        return !!args.onNavigateCell;
      }
      case "toggleActiveRowSelection": {
        args.onNavigateCell?.(intent, presentation);
        return !!args.onNavigateCell;
      }
      case "activateCell":
        args.activateCell?.(intent.coord, intent.trigger);
        return !!args.activateCell;
      case "activateRow":
        if (!args.activateRow) return false;
        return args.activateRow(intent.rowId, intent.trigger, intent.coord);
      case "startEdit":
        if (intent.trigger === "type") {
          dispatch({
            type: "START_EDIT",
            coord: intent.coord,
            trigger: intent.trigger,
            initial: intent.initial,
          });
        } else {
          dispatch({
            type: "START_EDIT",
            coord: intent.coord,
            trigger: intent.trigger,
          });
        }
        return true;
      case "moveColumn":
      case "moveRow":
      case "moveRowDelta":
      case "moveGridEdge":
      case "commitMove":
      case "cellPressed":
      case "rowPressed":
        args.onNavigateCell?.(intent, presentation);
        return !!args.onNavigateCell;
    }
    return false;
  }

  function applyRowIntent(intent: RowNavigationIntent): boolean {
    switch (intent.type) {
      case "clearRowSelection": {
        // Row-list Escape is path-scoped, but the coordinator remains the
        // runtime authority for resolving that scope. The fallback preserves
        // the path-local controller contract outside a GridRuntime.
        if (args.onNavigateRow) {
          args.onNavigateRow(intent);
        } else {
          store.clearRowSelection();
        }
        return true;
      }
      case "focusFirstRow":
      case "moveActiveRow":
      case "moveActiveRowDelta":
      case "moveActiveRowEdge":
      case "toggleActiveRowSelection":
      case "expandActiveRow":
      case "collapseActiveRow":
      case "toggleActiveRowExpansion":
        args.onNavigateRow?.(intent);
        return !!args.onNavigateRow;
      case "activateRow":
        if (!args.activateRow) return false;
        return args.activateRow(intent.rowId, intent.trigger);
    }
    return false;
  }

  store.commitEdit = (value, commit, presentation) => {
    const editing = store.getState().editing;
    if (!editing) return;
    const coord = editing.coord;
    args.writeValue?.(coord, value);
    // Apply the COMMIT_EDIT state transition (closes the editor) — the
    // reducer queues `focusContainer` for the editor close, since the
    // browser focus needs to return to the grid container regardless of
    // whether the cursor moves below.
    dispatch({ type: "COMMIT_EDIT", value, commit });
    // Directional follow-up: Tab / Enter / Shift+Tab promised a focus move.
    if (commit !== "stay") {
      applyCellIntent({ type: "commitMove", target: commit }, presentation);
    }
  };

  store.handleKey = (e, presentation) => {
    const state = store.getState();
    // Mode owns keyboard routing. The controller does not ask which UI element
    // was touched last; a cell-grid runtime always parses keys as cell intents,
    // and a row-list runtime always parses keys as row intents.
    if (args.interaction.mode === "cell-grid") {
      const intent = keyEventToCellIntent(
        e,
        args.interaction,
        state,
        args.getDisplayed(),
        args.getSchema(),
        isCellEditable,
        presentation,
      );
      return intent ? applyCellIntent(intent, presentation) : false;
    }
    const intent = keyEventToRowIntent(e, args.interaction, state);
    return intent ? applyRowIntent(intent) : false;
  };

  store.flushEffects = () => {
    if (effects.getState().length === 0) return;
    effects.setState(EMPTY_EFFECTS, true);
  };

  return store;
}

// Cursor placement hint for editor mounts. The trigger that opened the editor
// determines what the cursor should do: a typed open positions at the end
// (the keystroke is the initial value), every other trigger selects all.
export function cursorForTrigger(
  trigger: "type" | NonTypedCellEditGesture,
): "atEnd" | "selectAll" {
  return trigger === "type" ? "atEnd" : "selectAll";
}

export type { GridEffect };
