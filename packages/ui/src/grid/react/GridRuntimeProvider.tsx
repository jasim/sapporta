import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { LevelSnapshot } from "../data-sources/types";
import type { GridPath, RowId } from "../types/identity";
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
