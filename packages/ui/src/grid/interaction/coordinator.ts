// The structural channel — one store per runtime.
//
// Owns cross-path state: the global `cursor` and which rows are expanded.
// These are cross-path decisions because:
//
//   - The cursor is a single piece of state across the whole grid; the
//     active path is derived from `cursor?.path`. Active-ness determines
//     whether a level is "live" or "ghost" — a visual distinction that
//     belongs to the grid as a whole.
//   - Expansion drives which GridLevels mount and how cross-level
//     keyboard routing works between levels. Toggling expand on path
//     "orders" affects what the user sees under path
//     "orders.ord-3.lines".
//
// The coordinator never tracks the visible-order projection itself —
// it reads runtime + coordinator state at call time through
// `nextVisibleRow`. There is no cached projection, no "topology
// snapshot": render and navigation read the same live inputs and so
// cannot disagree.
//
// Navigation: a key handler emits a path-local `NavigationIntent`.
// The coordinator resolves that intent from the canonical cursor via
// `resolveMovement`, then dispatches focus through the focus manager —
// the sole writer of `cursor` and of every controller's `liveFocus`.
// The per-controller reducer is not in the cursor movement path.
//
// `setCursor` is the coordinator's only `cursor` writer. It is invoked
// only by the focus manager — every other call site (movement,
// navigate, click) goes through the focus manager so
// the denormalization invariant (controller.liveFocus mirrors cursor on
// the matching path) is maintained in lockstep.
//
// `onExpand(path, rowId)` is the seam the runtime uses to drive its child
// source registry: when a row is first expanded the runtime resolves any
// missing child sources for that (path, rowKey) and registers them so
// `nextVisibleRow` can include them on the next traversal.
//
// For the four-channel invariant this wires into, see `index.ts`.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { ColId, GridCursor, GridPath, RowId } from "../types/identity";
import type { LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type {
  CommitTarget,
  NavigationIntent,
  RowDirection,
} from "../types/action";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { FocusManager } from "./focus-manager";
import { nextVisibleRow } from "./visible-order";
import { firstFocusableRow } from "../types/level-row-traversal";

export type CoordinatorState = {
  cursor: GridCursor | null;
  expansion: Map<GridPath, Set<RowId>>;
};

export interface GridCoordinatorVerbs {
  toggleExpand: (path: GridPath, rowId: RowId) => void;
  navigate: (fromPath: GridPath, intent: NavigationIntent) => void;
}

type ReadonlyCoordinatorStore = Pick<
  StoreApi<CoordinatorState>,
  "getState" | "getInitialState" | "subscribe"
>;

export type GridCoordinatorPublic = ReadonlyCoordinatorStore &
  GridCoordinatorVerbs;

export type GridCoordinatorStore = StoreApi<CoordinatorState> &
  GridCoordinatorVerbs & {
    // Internal: only the focus manager writes the cursor.
    setCursor: (cursor: GridCursor | null) => void;
  };

export type CreateCoordinatorArgs = {
  // Live runtime reference. The coordinator does not hold any derived
  // view; it queries the runtime each call so a freshly resolved child
  // source or a freshly applied sort is reflected immediately.
  getRuntime: () => GridRuntime;
  // Focus manager reference, bound after construction (the focus
  // manager depends on the coordinator and the controllerFor lookup).
  // The coordinator never writes `cursor` itself — it asks the focus
  // manager to apply targets, and the focus manager reaches back to
  // `setCursor` to write the global half of the denormalisation.
  getFocusManager: () => FocusManager;
  capabilitiesFor: (kind: LevelRowKind) => RowCapabilities;
  // Invoked just before the coordinator commits a toggleExpand that
  // adds `rowId` to `path`'s expansion set. The runtime hooks this to
  // resolve any missing child sources for (path, rowKey) so that
  // downstream readers (GridLevel mount, visible-order traversal) see
  // the new paths on the next sample.
  onExpand?: (path: GridPath, rowId: RowId) => void;
};

export function createGridCoordinator(
  args: CreateCoordinatorArgs,
): GridCoordinatorStore {
  const initial: CoordinatorState = {
    cursor: null,
    expansion: new Map(),
  };
  const store = createStore<CoordinatorState>(
    () => initial,
  ) as GridCoordinatorStore;

  const coordinatorStore = store;

  store.setCursor = (cursor) => {
    const cur = store.getState();
    if (cur.cursor === cursor) return;
    store.setState({ ...cur, cursor }, true);
  };

  store.toggleExpand = (path, rowId) => {
    const cur = store.getState();
    const at = cur.expansion.get(path);
    const willExpand = !(at && at.has(rowId));
    // Resolve child sources BEFORE we mutate state — readers of
    // `expansion` (GridLevel) sample `runtime.materializedChildren` on
    // the next render, and the runtime's onExpand is what populates
    // the registry with the new child paths.
    if (willExpand) args.onExpand?.(path, rowId);
    const nextSet = new Set(at ?? []);
    if (nextSet.has(rowId)) nextSet.delete(rowId);
    else nextSet.add(rowId);
    const nextExpansion = new Map(cur.expansion);
    if (nextSet.size === 0) nextExpansion.delete(path);
    else nextExpansion.set(path, nextSet);
    store.setState({ ...cur, expansion: nextExpansion }, true);

    if (!willExpand) {
      const runtime = args.getRuntime();
      const focusManager = args.getFocusManager();
      const cursor = cur.cursor;
      if (!cursor) return;
      const collapsedChildPaths = runtime.materializedChildren(path, rowId);
      const cursorIsInCollapsedSubtree = collapsedChildPaths.some(
        (cp) => cursor.path === cp || cursor.path.startsWith(`${cp}.`),
      );
      if (!cursorIsInCollapsedSubtree) return;

      const parentRow = runtime.displayedRowsFor(path).rowById.get(rowId);
      const parentSchema = runtime.schemaAt(path);
      const parentCol =
        parentSchema.columns.find((c) => c.id === cursor.colId)?.id ??
        parentSchema.columns[0]?.id;
      if (
        parentRow &&
        parentCol &&
        args.capabilitiesFor(parentRow.kind).focusable
      ) {
        focusManager.apply({ path, rowId, colId: parentCol });
        return;
      }
      // No focusable parent fallback — the cursor's home is gone, so we
      // clear both the cursor and the (now-orphaned) range on the path
      // the cursor was leaving.
      focusManager.clearRange(cursor.path);
      focusManager.clearFocus();
    }
  };

  function rowMoveFor(
    intent: NavigationIntent,
  ): {
    direction: RowDirection;
    colPolicy: "preserve" | "first" | "last";
    extend: boolean;
  } | null {
    switch (intent.type) {
      case "moveRow":
        return {
          direction: intent.direction,
          colPolicy: intent.colPolicy,
          extend: intent.extend,
        };
      case "moveRowDelta":
        return {
          direction: { delta: intent.delta },
          colPolicy: intent.colPolicy,
          extend: intent.extend,
        };
      case "moveGridEdge":
        return {
          direction: intent.edge,
          colPolicy: intent.colPolicy,
          extend: intent.extend,
        };
      default:
        return null;
    }
  }

  function nextColForDirection(
    schema: { id: ColId }[],
    fromColId: ColId,
    direction: "left" | "right" | "rowStart" | "rowEnd",
  ): ColId | null {
    const idx = schema.findIndex((c) => c.id === fromColId);
    if (idx < 0) return null;
    let nextIdx: number;
    switch (direction) {
      case "left":
        nextIdx = Math.max(0, idx - 1);
        break;
      case "right":
        nextIdx = Math.min(schema.length - 1, idx + 1);
        break;
      case "rowStart":
        nextIdx = 0;
        break;
      case "rowEnd":
        nextIdx = schema.length - 1;
        break;
    }
    return schema[nextIdx]?.id ?? null;
  }

  function intentForCommit(
    target: Exclude<CommitTarget, "stay">,
    current: GridCursor,
    runtime: GridRuntime,
  ): NavigationIntent {
    switch (target) {
      case "up":
      case "down":
        return {
          type: "moveRow",
          direction: target,
          colPolicy: "preserve",
          extend: false,
        };
      case "pageUp":
        return {
          type: "moveRowDelta",
          delta: -10,
          colPolicy: "preserve",
          extend: false,
        };
      case "pageDown":
        return {
          type: "moveRowDelta",
          delta: 10,
          colPolicy: "preserve",
          extend: false,
        };
      case "start":
      case "end":
        return {
          type: "moveGridEdge",
          edge: target === "start" ? "first" : "last",
          colPolicy: "preserve",
          extend: false,
        };
      case "next": {
        const schema = runtime.schemaAt(current.path).columns;
        const idx = schema.findIndex((c) => c.id === current.colId);
        return idx >= 0 && idx < schema.length - 1
          ? { type: "moveColumn", direction: "right", extend: false }
          : {
              type: "moveRow",
              direction: "down",
              colPolicy: "first",
              extend: false,
            };
      }
      case "prev": {
        const schema = runtime.schemaAt(current.path).columns;
        const idx = schema.findIndex((c) => c.id === current.colId);
        return idx > 0
          ? { type: "moveColumn", direction: "left", extend: false }
          : {
              type: "moveRow",
              direction: "up",
              colPolicy: "last",
              extend: false,
            };
      }
      case "left":
      case "right":
      case "rowStart":
      case "rowEnd":
        return { type: "moveColumn", direction: target, extend: false };
    }
  }

  function resolveMovement(
    intent: NavigationIntent,
    fromPath: GridPath,
    cursor: GridCursor | null,
    runtime: GridRuntime,
  ): GridCursor | null {
    if (intent.type === "focusFirst") {
      const first = firstFocusableRow(
        runtime.displayedRowsFor(fromPath),
        args.capabilitiesFor,
      );
      const colId = runtime.schemaAt(fromPath).columns[0]?.id;
      return first && colId ? { path: fromPath, rowId: first.id, colId } : null;
    }

    if (!cursor || cursor.path !== fromPath) return null;

    if (intent.type === "commitMove") {
      return resolveMovement(
        intentForCommit(intent.target, cursor, runtime),
        fromPath,
        cursor,
        runtime,
      );
    }

    if (intent.type === "moveColumn") {
      const nextColId = nextColForDirection(
        runtime.schemaAt(fromPath).columns,
        cursor.colId,
        intent.direction,
      );
      return nextColId
        ? { path: fromPath, rowId: cursor.rowId, colId: nextColId }
        : null;
    }

    const move = rowMoveFor(intent);
    if (!move) return null;
    return nextVisibleRow(
      runtime,
      coordinatorStore,
      { path: fromPath, rowId: cursor.rowId, colId: cursor.colId },
      move.direction,
      move.colPolicy,
      { capabilitiesFor: args.capabilitiesFor },
    );
  }

  store.navigate = (fromPath, intent) => {
    const runtime = args.getRuntime();
    const focusManager = args.getFocusManager();
    const current = focusManager.currentCursor();
    const target = resolveMovement(intent, fromPath, current, runtime);
    if (!target) return;
    const extend = "extend" in intent && intent.extend;
    if (extend && current && target.path === current.path) {
      focusManager.extendTo(target);
    } else {
      focusManager.moveTo(target);
    }
  };

  return store;
}

// Convenience selector for code that wants the active path. Stored as a
// derived value of `cursor?.path` rather than a separate field — the
// active path is, by definition, the path the cursor is in.
export function activePathOf(state: CoordinatorState): GridPath | null {
  return state.cursor?.path ?? null;
}
