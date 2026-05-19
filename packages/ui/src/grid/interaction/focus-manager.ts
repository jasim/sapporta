// The focus manager — sole writer of `coordinator.cursor` and every
// controller's `liveFocus`.
//
// Why this exists: cursor motion crosses two stores (the coordinator's
// `cursor` field and the per-path controller's `liveFocus` mirror).
// Maintaining the denormalization invariant — `controllerFor(P).liveFocus`
// is non-null iff `coordinator.cursor !== null && coordinator.cursor.path === P`
// — requires writing to both stores in lockstep, in a fixed order, and
// queueing DOM effects keyed off the global cursor diff (not any per-store
// equality). Centralising those writes here makes the invariant a one-line
// reading instead of an emergent property of half a dozen call sites.
//
// What goes wrong if you reach into `coordinator.setCursor` or
// `controller.setLiveFocus` from anywhere else:
//
//   - Skipping the `setLiveFocus(null)` on the previous path leaves a
//     stale focus indicator on the path the cursor left.
//   - Skipping the `focusContainer` queue on the new path means the
//     browser's focused element stays on the previous Grid's container,
//     so the next keystroke fires on the wrong grid.
//   - Reordering the writes (target liveFocus before cursor) lets the
//     target paint a "focus" cell for one frame before its grid root
//     flips `data-active="true"`, producing inactive-styled focus chrome
//     during the gap.
//
// Movement is a different concern (intent → target cursor); the focus
// manager owns the state transition after a target is known. The low-level
// `apply` primitive synchronises cursor/liveFocus only. User-facing movement
// goes through `moveTo` or `extendTo`, which encode the selection policy.

import type { Coord, GridCursor, GridPath } from "../types/identity";
import { cursorEqual } from "../types/identity";
import type { SelectionState } from "../types/selection";
import type { GridCoordinatorStore } from "./coordinator";
import type { GridControllerFocusPort } from "./controller";

export interface FocusManager {
  // Low-level cursor synchronisation. Maintains the denormalization
  // invariant; queues `focusContainer` + `scrollFocusIntoView` effects
  // on the target's effect channel when `target` is non-null and
  // the cursor actually changed. Does not change selection.
  apply: (target: GridCursor | null) => void;
  // Non-extending user movement. Moves focus and clears any remembered
  // range on both the previous and target paths.
  moveTo: (target: GridCursor) => void;
  // Range-extending move. Moves the cursor to `target` and updates the
  // target path's `selection` so the existing anchor (if any) is kept
  // and `head` becomes `target`. Cross-path extension is treated as a
  // non-extending move — the doc's `extendTo` semantics.
  extendTo: (target: GridCursor) => void;
  // Set an explicit range on `path`. Moves the cursor to `head`.
  setRange: (path: GridPath, anchor: Coord, head: Coord) => void;
  // Clear the range on `path` without touching the cursor.
  clearRange: (path: GridPath) => void;
  // Clear the cursor (and the corresponding path's liveFocus mirror).
  // Does not touch any path's selection range.
  clearFocus: () => void;
  // Read the current cursor. Convenience for movement code that does
  // not want to subscribe to the coordinator.
  currentCursor: () => GridCursor | null;
}

export type FocusManagerDeps = {
  coordinator: GridCoordinatorStore;
  controllerFocusPortFor: (path: GridPath) => GridControllerFocusPort;
};

export function createFocusManager(deps: FocusManagerDeps): FocusManager {
  function apply(target: GridCursor | null): void {
    const prev = deps.coordinator.getState().cursor;
    if (cursorEqual(prev, target)) return;

    // Step 1: clear the source path's liveFocus mirror, if the cursor is
    // leaving a path.
    if (prev && (!target || prev.path !== target.path)) {
      deps.controllerFocusPortFor(prev.path).setLiveFocus(null);
    }

    // Step 2: write the coordinator's cursor. This is the moment
    // `cursor?.path` flips, which Grids observe through `data-active`.
    // Step 2 precedes step 3 so no rendered frame can show the target's
    // cells painting `focus` chrome before its grid root has
    // `data-active="true"`.
    deps.coordinator.setCursor(target);

    // Step 3: set the target path's liveFocus mirror.
    if (target) {
      const ctrl = deps.controllerFocusPortFor(target.path);
      ctrl.setLiveFocus({ rowId: target.rowId, colId: target.colId });

      // Step 4: queue DOM effects on the target's channel. Drained by
      // the target Grid's EffectRunner after layout — including when
      // the target Grid is mounting for the first time, since
      // controllers (and their effect queues) outlive DOM presence.
      ctrl.queueEffect({ type: "focusContainer" });
      ctrl.queueEffect({
        type: "scrollFocusIntoView",
        coord: { rowId: target.rowId, colId: target.colId },
      });
    }
  }

  function moveTo(target: GridCursor): void {
    const prev = deps.coordinator.getState().cursor;
    apply(target);
    if (prev) {
      deps.controllerFocusPortFor(prev.path).setSelection(null);
    }
    if (!prev || prev.path !== target.path) {
      deps.controllerFocusPortFor(target.path).setSelection(null);
    }
  }

  function extendTo(target: GridCursor): void {
    const prev = deps.coordinator.getState().cursor;
    apply(target);
    const ctrl = deps.controllerFocusPortFor(target.path);
    const cur = ctrl.getState().selection;
    const head = { rowId: target.rowId, colId: target.colId };
    const anchor = anchorForExtension(prev, cur, target);
    // Skip the write if the range is already exactly this — saves a
    // spurious `selectionChanged` emission on no-op extensions (e.g.
    // shift-arrow into a clamped boundary).
    if (
      cur &&
      cur.anchor.rowId === anchor.rowId &&
      cur.anchor.colId === anchor.colId &&
      cur.head.rowId === head.rowId &&
      cur.head.colId === head.colId
    ) {
      return;
    }
    ctrl.setSelection({ anchor, head });
  }

  function setRange(path: GridPath, anchor: Coord, head: Coord): void {
    apply({ path, rowId: head.rowId, colId: head.colId });
    deps.controllerFocusPortFor(path).setSelection({ anchor, head });
  }

  function clearRange(path: GridPath): void {
    deps.controllerFocusPortFor(path).setSelection(null);
  }

  function clearFocus(): void {
    apply(null);
  }

  function currentCursor() {
    return deps.coordinator.getState().cursor;
  }

  return {
    apply,
    moveTo,
    extendTo,
    setRange,
    clearRange,
    clearFocus,
    currentCursor,
  };
}

// Pick the stable end of a Shift-selection range. sameLevel means the cursor
// before the extension and the target cell are in the same GridPath; that
// matters because ranges are stored per level, so only same-level extensions
// may reuse an existing anchor or start from the previous focused cell.
// Cross-level extension is not modelled as one range, so it starts and ends
// on the target cell.
function anchorForExtension(
  prev: GridCursor | null,
  cur: SelectionState | null,
  target: GridCursor,
): Coord {
  const sameLevel = !!prev && prev.path === target.path;
  if (sameLevel && cur) return cur.anchor;
  if (sameLevel && prev) return { rowId: prev.rowId, colId: prev.colId };
  return { rowId: target.rowId, colId: target.colId };
}
