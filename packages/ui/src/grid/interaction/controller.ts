// The transient channel — one store per `GridPath`.
//
// Holds three orthogonal pieces of per-path state:
//
//   - `liveFocus` — the per-path mirror of the global cursor. Non-null
//     iff this path is the path the cursor is in. Cells subscribe to
//     this for the focus indicator. Owned and written exclusively by
//     the focus manager (via `setLiveFocus`); no reducer, movement
//     code, or click handler writes it directly. The single invariant
//     is enforced in one place — see `focus-manager.ts`.
//
//   - `selection` — the per-path *remembered range* (`anchor` + `head`).
//     Updated only by genuinely range-changing operations: shift+arrow,
//     click+drag, explicit range API. Non-extending user movement clears
//     it through the focus manager; the low-level cursor synchronisation
//     primitive does not rewrite it.
//
//   - `editing` — per-cell editor lifecycle, untouched by this design.
//
// State outlives DOM presence: collapsing and re-expanding a level
// preserves its focus mirror and selection (the controller is lazily
// created by the runtime and cached for its lifetime, not tied to
// mount/unmount).
//
// A sibling `effects` store carries pure reducer outputs out to
// EffectRunner for DOM work — see `types/effects.ts`. The focus manager
// also queues onto this channel directly via `queueEffect`, since
// `focusContainer` and `scrollFocusIntoView` are keyed off the global
// cursor diff (not any per-store equality).
//
// Selection changes never invalidate displayed rows. The displayed-rows store
// is the only source of body render input; it invalidates only on source,
// phantom, or future view-state changes. This is critical: focus and
// selection changes must not trigger displayed-row derivation.
//
// For the four-channel invariant this wires into, see `index.ts`.

import { createStore, type StoreApi } from "zustand/vanilla";
import { keyEventToIntent } from "./key-handling";
import type {
  ColumnSchema,
  EditTrigger,
  NonTypedEditTrigger,
} from "../types/schema";
import { triggerAllowed } from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type { Coord, GridPath } from "../types/identity";
import type {
  CommitTarget,
  GridAction,
  NavigationIntent,
} from "../types/action";
import type { GridEffect } from "../types/effects";
import type { SelectionState } from "../types/selection";
import { reduceController } from "./reducer";

export interface GridControllerPublicVerbs {
  startEdit: {
    (coord: Coord, trigger: "type", initial: string): void;
    (coord: Coord, trigger: NonTypedEditTrigger): void;
  };
  cancelEdit: () => void;
  // commitEdit closes the editor, performs the cell write, and (when
  // `commit !== "stay"`) fires a movement intent in the requested
  // direction so the user lands where Tab / Enter / Shift+Tab promised.
  commitEdit: (value: unknown, commit?: CommitTarget) => void;
  clearSelection: () => void;
  // host I/O — stable; bound once to DOM by Grid.tsx. Returns true if the
  // event was consumed (caller should preventDefault), false otherwise.
  handleKey: (e: KeyboardEvent) => boolean;
  flushEffects: () => void;
  // Sibling channel for queued effects. EffectRunner subscribes to this and
  // calls flushEffects() after running them.
  effects: StoreApi<GridEffect[]>;
}

export interface GridControllerFocusPort {
  getState: StoreApi<ControllerState>["getState"];
  setLiveFocus: (focus: Coord | null) => void;
  setSelection: (selection: SelectionState | null) => void;
  queueEffect: (effect: GridEffect) => void;
}

type ReadonlyControllerStore = Pick<
  StoreApi<ControllerState>,
  "getState" | "getInitialState" | "subscribe"
>;

export type GridControllerPublic = ReadonlyControllerStore &
  GridControllerPublicVerbs;

export type GridControllerStore = StoreApi<ControllerState> &
  GridControllerPublicVerbs &
  GridControllerFocusPort & {
    dispatch: (action: GridAction) => void;
  };

export type CreateControllerArgs = {
  path: GridPath;
  // The runtime supplies these as live getters — the controller doesn't store
  // them so changing the displayed/schema/capabilities does not invalidate
  // the store.
  getDisplayed: () => DisplayedRows;
  getSchema: () => ColumnSchema[];
  capabilitiesFor: (kind: LevelRowKind) => RowCapabilities;
  onNavigate?: (intent: NavigationIntent) => void;
  clearRange?: (path: GridPath) => void;
  // Cell value writer — invoked from commitEdit. The runtime wires this to the
  // path's writable `LevelDataSource.setCell` via `writeCell`, where
  // `mutationCommitted` is emitted.
  writeValue?: (coord: Coord, newValue: unknown) => void;
};

const INITIAL: ControllerState = {
  liveFocus: null,
  selection: null,
  editing: null,
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
      capabilitiesFor: args.capabilitiesFor,
    };
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

  // Focus-manager-owned writers. Path-local idempotence is the only
  // short-circuit here; cross-path concerns are handled in the focus
  // manager.
  store.setLiveFocus = (focus) => {
    const cur = store.getState();
    const same =
      (cur.liveFocus === null && focus === null) ||
      (!!cur.liveFocus &&
        !!focus &&
        cur.liveFocus.rowId === focus.rowId &&
        cur.liveFocus.colId === focus.colId);
    if (same) return;
    store.setState({ ...cur, liveFocus: focus }, true);
  };

  store.setSelection = (selection) => {
    const cur = store.getState();
    if (cur.selection === selection) return;
    store.setState({ ...cur, selection }, true);
  };

  store.queueEffect = (effect) => {
    pushEffects([effect]);
  };

  store.startEdit = (coord, trigger, initial?: string) => {
    if (trigger === "type") {
      if (initial === undefined) return;
      dispatch({ type: "START_EDIT", coord, trigger, initial });
      return;
    }
    dispatch({ type: "START_EDIT", coord, trigger });
  };
  store.cancelEdit = () => dispatch({ type: "CANCEL_EDIT" });
  store.clearSelection = () => {
    args.clearRange?.(args.path);
  };

  function applyIntent(intent: NavigationIntent): boolean {
    const focus = store.getState().liveFocus;
    switch (intent.type) {
      case "clearSelection":
        store.clearSelection();
        return true;
      case "focusFirst": {
        args.onNavigate?.(intent);
        return !!args.onNavigate;
      }
      case "startEdit":
        if (!focus) return false;
        if (intent.trigger === "type") {
          dispatch({
            type: "START_EDIT",
            coord: focus,
            trigger: intent.trigger,
            initial: intent.initial,
          });
        } else {
          dispatch({
            type: "START_EDIT",
            coord: focus,
            trigger: intent.trigger,
          });
        }
        return true;
      case "moveColumn":
      case "moveRow":
      case "moveRowDelta":
      case "moveGridEdge":
      case "commitMove":
        args.onNavigate?.(intent);
        return !!args.onNavigate;
    }
  }

  store.commitEdit = (value, commit = "stay") => {
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
      applyIntent({ type: "commitMove", target: commit });
    }
  };

  store.handleKey = (e) => {
    const intent = keyEventToIntent(
      e,
      store.getState(),
      args.getDisplayed(),
      args.getSchema(),
      args.capabilitiesFor,
    );
    if (!intent) return false;
    return applyIntent(intent);
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
export function cursorForTrigger(trigger: EditTrigger): "atEnd" | "selectAll" {
  return trigger === "type" ? "atEnd" : "selectAll";
}

// Re-exported so consumers (the table-controller wrapper, mostly) can ask
// "would this trigger open an editor on this column?"
export { triggerAllowed };
export type { GridEffect };
