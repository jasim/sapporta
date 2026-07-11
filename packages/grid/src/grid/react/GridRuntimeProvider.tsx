import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import {
  runtimeInternalsFor,
  type GridRuntime,
} from "../runtime/create-grid-runtime";
import type { LevelSnapshot, LevelSourceState } from "../data-sources/types";
import type { CellCursor, Coord, GridPath, RowId } from "../types/identity";
import type { CellSelectionState } from "../types/selection";
import type {
  RowCursor,
  RowInteractionSnapshot,
  RowInteractionStatus,
  RowSelection,
} from "../types/row-selection";
import type { ControllerState } from "../types/controller-state";
import type {
  DisplayedRowSequence,
  LevelRow,
  PhantomRow,
} from "../types/level-row";

const RuntimeContext = createContext<GridRuntime | null>(null);

export function GridRuntimeProvider({
  runtime,
  children,
}: {
  runtime: GridRuntime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useGridRuntime(): GridRuntime {
  const v = useContext(RuntimeContext);
  if (!v)
    throw new Error("useGridRuntime must be used inside <GridRuntimeProvider>");
  return v;
}

// Subscribe to one path's snapshot. Re-renders only when the source emits.
// `LevelDataSource.subscribe` fires once per snapshot transition; the snapshot
// itself is identity-stable so React bails out when nothing changed.
//
// No `useState` over data. The runtime exposes external stores for what you'd
// otherwise memoize (displayed rows, schema, materialized child paths).
// `useState` would create a second source of truth that drifts from the store.
export function useLevelSnapshot(path: GridPath): LevelSnapshot {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.data.subscribe,
    () => level.data.state().snapshot,
    () => level.data.state().snapshot,
  );
}

export function useLevelSourceState(path: GridPath): LevelSourceState {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.data.subscribe,
    level.data.state,
    level.data.state,
  );
}

// Subscribe to one path's phantom array. Identity-stable: the phantom
// channel returns the same reference until the path's phantom set
// actually changes.
export function usePhantoms(path: GridPath): readonly PhantomRow[] {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.drafts.subscribe,
    level.drafts.get,
    level.drafts.get,
  );
}

// Body-level read model: ordered row references only. It intentionally omits
// cell values and lookup maps so row content edits do not wake the body.
export function useDisplayedRowSequence(path: GridPath): DisplayedRowSequence {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.subscribeDisplayedRowSequence,
    level.displayedRowSequence,
    level.displayedRowSequence,
  );
}

export function useDisplayedRow(path: GridPath, rowId: RowId): LevelRow {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    (cb) => level.subscribeDisplayedRow(rowId, cb),
    () => {
      const row = level.displayedRow(rowId);
      if (!row) {
        throw new Error(
          `GridRuntime: displayed row "${rowId}" no longer exists at path "${path}".`,
        );
      }
      return row;
    },
    () => {
      const row = level.displayedRow(rowId);
      if (!row) {
        throw new Error(
          `GridRuntime: displayed row "${rowId}" no longer exists at path "${path}".`,
        );
      }
      return row;
    },
  );
}

export function useActiveCell(): CellCursor | null {
  const runtime = useGridRuntime();
  const internals = runtimeInternalsFor(runtime);
  return useStore(internals.coordinator, (s) => s.cellCursor);
}

export function useActiveCellForPath(path: GridPath): Coord | null {
  const runtime = useGridRuntime();
  return useStore(
    runtimeInternalsFor(runtime).controllerFor(path),
    (s: ControllerState) => s.liveCellFocus,
  );
}

export function useCellSelection(path: GridPath): CellSelectionState | null {
  const runtime = useGridRuntime();
  return useStore(
    runtimeInternalsFor(runtime).controllerFor(path),
    (s: ControllerState) => s.cellSelection,
  );
}

export function useActiveRow(path: GridPath): RowCursor | null {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.subscribeActiveRow,
    level.activeRow,
    () => null,
  );
}

export function useSelectedRows(path: GridPath): RowSelection {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.subscribeSelectedRows,
    level.selectedRows,
    () => null,
  );
}

export function useSelectedRowIds(path: GridPath): readonly RowId[] {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.subscribeSelectedRowIds,
    level.selectedRowIds,
    () => EMPTY_ROW_IDS,
  );
}

export function useRowInteractionSnapshot(
  path: GridPath,
): RowInteractionSnapshot {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  return useSyncExternalStore(
    level.subscribeRowInteractionSnapshot,
    level.rowInteractionSnapshot,
    () => EMPTY_ROW_INTERACTION,
  );
}

const EMPTY_ROW_IDS: readonly RowId[] = [];
const EMPTY_ROW_STATUS: ReadonlyMap<RowId, RowInteractionStatus> = new Map();
const EMPTY_ROW_INTERACTION: RowInteractionSnapshot = {
  activeRowId: null,
  selectedRowIds: EMPTY_ROW_IDS,
  statusByRowId: EMPTY_ROW_STATUS,
};
