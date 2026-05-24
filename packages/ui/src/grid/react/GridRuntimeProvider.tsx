import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import type {
  GridRuntime,
  RowInteractionStatus,
} from "../runtime/create-grid-runtime";
import type { LevelSnapshot } from "../data-sources/types";
import type { CellCursor, Coord, GridPath, RowId } from "../types/identity";
import type { CellSelectionState } from "../types/selection";
import type { RowCursor, RowSelection } from "../types/row-selection";
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
  return useSyncExternalStore(
    (cb) => runtime.sourceFor(path).subscribe(cb),
    () => runtime.snapshotFor(path),
  );
}

// Subscribe to one path's phantom array. Identity-stable: the phantom
// channel returns the same reference until the path's phantom set
// actually changes.
export function usePhantoms(path: GridPath): PhantomRow[] {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.phantoms.subscribe(path, cb),
    () => runtime.phantoms.get(path),
  );
}

// Body-level read model: ordered row references only. It intentionally omits
// cell values and lookup maps so row content edits do not wake the body.
export function useDisplayedRowSequence(path: GridPath): DisplayedRowSequence {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeDisplayedRowSequence(path, cb),
    () => runtime.displayedRowSequenceFor(path),
  );
}

export function useDisplayedRow(path: GridPath, rowId: RowId): LevelRow {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeDisplayedRow(path, rowId, cb),
    () => {
      const row = runtime.displayedRowFor(path, rowId);
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
  return useStore(runtime.coordinator, (s) => s.cellCursor);
}

export function useActiveCellForPath(path: GridPath): Coord | null {
  const runtime = useGridRuntime();
  return useStore(
    runtime.controllerFor(path),
    (s: ControllerState) => s.liveCellFocus,
  );
}

export function useCellSelection(path: GridPath): CellSelectionState | null {
  const runtime = useGridRuntime();
  return useStore(
    runtime.controllerFor(path),
    (s: ControllerState) => s.cellSelection,
  );
}

export function useActiveRow(path: GridPath): RowCursor | null {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeActiveRow(path, cb),
    () => runtime.activeRowFor(path),
    () => null,
  );
}

export function useSelectedRows(path: GridPath): RowSelection {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeSelectedRows(path, cb),
    () => runtime.selectedRowsFor(path),
    () => null,
  );
}

export function useSelectedRowIds(path: GridPath): readonly RowId[] {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeSelectedRowIds(path, cb),
    () => runtime.selectedRowIds(path),
    () => [],
  );
}

export function useRowSelectionContainsRow(
  path: GridPath,
  rowId: RowId,
): boolean {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeRowSelectionContainsRow(path, rowId, cb),
    () => runtime.rowSelectionContainsRow(path, rowId),
    () => false,
  );
}

export function useRowInteractionStatus(
  path: GridPath,
  rowId: RowId,
): RowInteractionStatus {
  const runtime = useGridRuntime();
  return useSyncExternalStore(
    (cb) => runtime.subscribeRowInteractionStatus(path, rowId, cb),
    () => runtime.rowInteractionStatusFor(path, rowId),
    () => "idle",
  );
}
