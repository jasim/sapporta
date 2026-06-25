// The structural channel — one store per runtime.
//
// Owns cross-path state: the global `cellCursor`, the global `rowCursor`, and
// which rows are expanded. These are cross-path decisions because:
//
//   - A cursor is a single piece of state across the whole grid. In cell-grid
//     mode the active path is derived from `cellCursor?.path`; in row-list mode
//     it is derived from `rowCursor?.path`. Active-ness determines whether a
//     level is "live" or "ghost" — a visual distinction that belongs to the
//     grid as a whole.
//   - Expansion drives which GridLevels mount and how cross-level
//     keyboard routing works between levels. Toggling expand on path
//     "orders" affects what the user sees under path
//     "orders.ord-3.lines".
//
// The coordinator never tracks the visible-order projection itself —
// it reads runtime + coordinator state at call time through
// `resolveVisibleRowNavigation`. There is no cached projection, no "topology
// snapshot": render and navigation read the same live inputs and so
// cannot disagree.
//
// Navigation: a key handler emits either a `CellNavigationIntent` or a
// `RowNavigationIntent` depending on `interaction.mode`. The coordinator
// resolves that intent from the canonical cursor, then dispatches through the
// cursor manager — the sole writer of global cursors and controller live-focus
// mirrors. The per-controller reducer is not in either cursor movement path.
//
// `setCellCursor` and `setRowCursor` are invoked only by the cursor manager.
// Every other call site (movement, navigate, click) goes through the cursor
// manager so the denormalization invariant is maintained in lockstep.
//
// `onExpand(path, rowId)` is the seam the runtime uses to drive its child
// source registry: when a row is first expanded the runtime resolves any
// missing child sources for that (path, rowKey) and registers them so
// `resolveVisibleRowNavigation` can include them on the next traversal.
//
// For the four-channel invariant this wires into, see `index.ts`.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { CellCursor, ColId, GridPath, RowId } from "../types/identity";
import type { RowCursor } from "../types/row-selection";
import type { LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type {
  CommitTarget,
  CellNavigationIntent,
  RowNavigationIntent,
  RowDirection,
} from "../types/action";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { CursorManager } from "./cursor-manager";
import {
  resolveRowSelectableNavigation,
  resolveVisibleRowNavigation,
} from "./visible-order";
import { firstFocusableRow } from "../types/level-row-traversal";

export type CoordinatorState = {
  cellCursor: CellCursor | null;
  rowCursor: RowCursor | null;
  expansion: Map<GridPath, Set<RowId>>;
};

export interface GridCoordinatorVerbs {
  toggleExpand: (path: GridPath, rowId: RowId) => void;
  navigateCell: (fromPath: GridPath, intent: CellNavigationIntent) => void;
  navigateRow: (fromPath: GridPath, intent: RowNavigationIntent) => void;
}

type ReadonlyCoordinatorStore = Pick<
  StoreApi<CoordinatorState>,
  "getState" | "getInitialState" | "subscribe"
>;

export type GridCoordinatorPublic = ReadonlyCoordinatorStore &
  GridCoordinatorVerbs;

export type GridCoordinatorStore = StoreApi<CoordinatorState> &
  GridCoordinatorVerbs & {
    // Internal: only the cursor manager writes the cursor.
    setCellCursor: (cursor: CellCursor | null) => void;
    setRowCursor: (cursor: RowCursor | null) => void;
  };

export type CreateCoordinatorArgs = {
  // Live runtime reference. The coordinator does not hold any derived
  // view; it queries the runtime each call so a freshly resolved child
  // source or a freshly applied sort is reflected immediately.
  getRuntime: () => GridRuntime;
  // Cursor manager reference, bound after construction (the cursor manager
  // depends on the coordinator and the controllerFor lookup). The coordinator
  // never writes cursors itself — it asks the cursor manager to apply targets,
  // and the cursor manager reaches back to `setCellCursor` / `setRowCursor` to
  // write the global half of the denormalisation.
  getCursorManager: () => CursorManager;
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
    cellCursor: null,
    rowCursor: null,
    expansion: new Map(),
  };
  const store = createStore<CoordinatorState>(
    () => initial,
  ) as GridCoordinatorStore;

  const coordinatorStore = store;

  store.setCellCursor = (cursor) => {
    const cur = store.getState();
    if (cur.cellCursor === cursor) return;
    store.setState({ ...cur, cellCursor: cursor }, true);
  };

  store.setRowCursor = (cursor) => {
    const cur = store.getState();
    if (cur.rowCursor === cursor) return;
    store.setState({ ...cur, rowCursor: cursor }, true);
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
      const cursorManager = args.getCursorManager();
      const cellCursor = cur.cellCursor;
      const rowCursor = cur.rowCursor;
      const collapsedChildPaths = runtime.materializedChildren(path, rowId);
      const parentRow = runtime.displayedRowsFor(path).rowById.get(rowId);
      const parentSchema = runtime.schemaAt(path);
      if (cellCursor) {
        const cellCursorIsInCollapsedSubtree = collapsedChildPaths.some(
          (cp) =>
            cellCursor.path === cp || cellCursor.path.startsWith(`${cp}.`),
        );
        if (cellCursorIsInCollapsedSubtree) {
          const parentCol =
            parentSchema.columns.find((c) => c.id === cellCursor.colId)?.id ??
            parentSchema.columns[0]?.id;
          if (
            parentRow &&
            parentCol &&
            args.capabilitiesFor(parentRow.kind).focusable
          ) {
            cursorManager.applyCellCursor({ path, rowId, colId: parentCol });
          } else {
            cursorManager.clearCellRange(cellCursor.path);
            cursorManager.clearCellCursor();
          }
        }
      }
      if (rowCursor) {
        const rowCursorIsInCollapsedSubtree = collapsedChildPaths.some(
          (cp) => rowCursor.path === cp || rowCursor.path.startsWith(`${cp}.`),
        );
        // Row cursor fallback is row-selectability based, not cell-focusability
        // based. The row cursor exists to drive row operations, so it must only
        // land where row selection could also land.
        if (
          rowCursorIsInCollapsedSubtree &&
          parentRow &&
          parentRow.rowSelectable
        ) {
          cursorManager.applyRowCursor({ path, rowId });
        } else if (rowCursorIsInCollapsedSubtree) {
          cursorManager.clearRowCursor();
        }
      }
    }
  };

  function rowMoveFor(intent: CellNavigationIntent): {
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
    current: CellCursor,
    runtime: GridRuntime,
  ): CellNavigationIntent {
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
    intent: CellNavigationIntent,
    fromPath: GridPath,
    cursor: CellCursor | null,
    runtime: GridRuntime,
  ): CellCursor | null {
    if (intent.type === "focusFirstCell") {
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
    const result = resolveVisibleRowNavigation(
      runtime,
      coordinatorStore,
      { path: fromPath, rowId: cursor.rowId, colId: cursor.colId },
      move.direction,
      move.colPolicy,
      { capabilitiesFor: args.capabilitiesFor },
    );
    if (result.target) return result.target;
    // A table may show footer or subtotal rows that are not real keyboard
    // targets. Treat those rows the same for in-page movement and page turns,
    // so pressing Down at the last editable row behaves predictably. Creating
    // a phantom row is the fallback only when the app cannot page forward.
    if (
      result.overflow &&
      runtime.requestPageBoundaryNavigation({
        kind: "cell",
        path: fromPath,
        direction: result.overflow,
        colId: cursor.colId,
        colPolicy: move.colPolicy,
        extend: move.extend,
      })
    ) {
      return null;
    }
    return result.overflow === "next"
      ? runtime.phantomBoundaryCellTarget(
          fromPath,
          cursor.colId,
          move.colPolicy,
        )
      : null;
  }

  store.navigateCell = (fromPath, intent) => {
    const runtime = args.getRuntime();
    const cursorManager = args.getCursorManager();
    if (intent.type === "toggleActiveRowSelection") {
      // Space in a cell-grid may toggle the effective active row, but it still
      // routes through rowInteraction so the operation target changes without
      // moving the cell cursor.
      const active = runtime.activeRowFor(fromPath);
      if (active)
        runtime.rowInteraction.toggleRowSelection(active.path, active.rowId);
      return;
    }
    const current = cursorManager.currentCellCursor();
    const target = resolveMovement(intent, fromPath, current, runtime);
    if (!target) return;
    const extend = "extend" in intent && intent.extend;
    if (extend && current && target.path === current.path) {
      cursorManager.extendCellSelectionTo(target);
    } else {
      cursorManager.moveCellCursorTo(target);
    }
    // Navigation may resolve to a cell outside the current viewport. Reveal is
    // requested here, not by the cursor manager, so pointer-originated cursor
    // placement can update focus without unexpectedly moving visible content.
    runtime
      .controllerFor(target.path)
      .revealCell({ rowId: target.rowId, colId: target.colId });
  };

  function resolveRowMovement(
    intent: RowNavigationIntent,
    fromPath: GridPath,
    rowCursor: RowCursor | null,
    runtime: GridRuntime,
  ): RowCursor | null {
    if (intent.type === "focusFirstRow") {
      // Row-list focus starts on the first row that can be an operation target.
      // Synthetic subtotal/footer rows may still render, but the row cursor
      // should not land on them.
      const first = runtime
        .displayedRowsFor(fromPath)
        .rows.find((row) => row.rowSelectable);
      return first ? { path: fromPath, rowId: first.id } : null;
    }
    if (!rowCursor || rowCursor.path !== fromPath) return null;
    if (intent.type === "moveActiveRow") {
      // Row traversal is deliberately column-free. It uses the same
      // rowSelectable gate as row selection so keyboard focus and operation
      // selection cannot disagree about which rows are valid.
      const result = resolveRowSelectableNavigation(
        runtime,
        coordinatorStore,
        rowCursor,
        intent.direction,
      );
      if (result.target) return result.target;
      // In a row-list, keyboard focus follows rows the app can operate on.
      // A visible footer at the edge should not block a page turn, and it
      // should not become the row cursor's landing target.
      if (
        result.overflow &&
        runtime.requestPageBoundaryNavigation({
          kind: "row",
          path: fromPath,
          direction: result.overflow,
          extend: intent.extend,
        })
      ) {
        return null;
      }
      return result.overflow === "next"
        ? runtime.phantomBoundaryRowTarget(fromPath)
        : null;
    }
    if (intent.type === "moveActiveRowEdge") {
      return resolveRowSelectableNavigation(
        runtime,
        coordinatorStore,
        rowCursor,
        intent.edge === "first" ? "first" : "last",
      ).target;
    }
    if (intent.type === "moveActiveRowDelta") {
      const result = resolveRowSelectableNavigation(
        runtime,
        coordinatorStore,
        rowCursor,
        {
          delta: intent.delta,
        },
      );
      if (result.target) return result.target;
      // Page-sized row-list jumps should not skip the rest of the current
      // page. First land on the nearest selectable edge row; a later jump from
      // that edge can ask the app for the adjacent page.
      if (
        result.overflow &&
        runtime.requestPageBoundaryNavigation({
          kind: "row",
          path: fromPath,
          direction: result.overflow,
          extend: intent.extend,
        })
      ) {
        return null;
      }
      return result.overflow === "next"
        ? runtime.phantomBoundaryRowTarget(fromPath)
        : null;
    }
    return null;
  }

  store.navigateRow = (fromPath, intent) => {
    const runtime = args.getRuntime();
    const cursorManager = args.getCursorManager();
    if (
      intent.type === "expandActiveRow" ||
      intent.type === "collapseActiveRow" ||
      intent.type === "toggleActiveRowExpansion"
    ) {
      const active = runtime.activeRowFor(fromPath);
      if (!active) return;
      if (runtime.schemaAt(active.path).childLevels.length === 0) return;
      const expanded =
        store.getState().expansion.get(active.path)?.has(active.rowId) ?? false;
      if (intent.type === "expandActiveRow" && expanded) return;
      if (intent.type === "collapseActiveRow" && !expanded) return;
      store.toggleExpand(active.path, active.rowId);
      return;
    }
    if (intent.type === "toggleActiveRowSelection") {
      const active = runtime.activeRowFor(fromPath);
      if (active)
        runtime.rowInteraction.toggleRowSelection(active.path, active.rowId);
      return;
    }
    if (intent.type === "clearRowSelection") {
      runtime.rowInteraction.clearRowSelection(fromPath);
      return;
    }
    const current = cursorManager.currentRowCursor();
    const target = resolveRowMovement(intent, fromPath, current, runtime);
    if (!target) return;
    if ("extend" in intent && intent.extend) {
      // Keyboard shift-extension is a row-cursor command: it moves the active
      // row and, when the interaction config allows it, extends independent
      // row selection from the old row cursor.
      cursorManager.extendRowSelectionToCursor(target);
    } else {
      cursorManager.moveRowCursorTo(target);
    }
    // Same rule as cell navigation: resolved navigation targets should be
    // brought into view, while direct pointer cursor placement remains
    // focus-only.
    runtime.controllerFor(target.path).revealRow(target.rowId);
  };

  return store;
}

// Convenience selector for code that wants the active path. Stored as a
// derived value of `cellCursor?.path` rather than a separate field — the
// active path is, by definition, the path the cursor is in.
export function activePathOf(state: CoordinatorState): GridPath | null {
  return state.cellCursor?.path ?? state.rowCursor?.path ?? null;
}
