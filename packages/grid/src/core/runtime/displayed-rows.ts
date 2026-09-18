import type { PhantomChannel } from "../data-sources/types";
import {
  createDisplayedRowsStore,
  deriveDisplayedRowsState,
  type DisplayedRowsInput,
  type DisplayedRowsInvalidationReason,
  type DisplayedRowsState,
  type DisplayedRowsStore,
  type DisplayedRowsViewState,
} from "../displayed-rows";
import type { LevelSnapshot, LevelSourceState } from "../data-sources/types";
import type { TreeStructure } from "../types/tree";
import { rowKeyOfRowId, type GridPath, type RowId } from "../types/identity";
import type {
  DisplayedRows,
  DisplayedRowSequence,
  LevelRow,
} from "../types/level-row";
import type { LevelSchema } from "../types/schema";
import { reportObserverError } from "../observer-notification";

export type DisplayedRowsRuntime = ReturnType<
  typeof createDisplayedRowsRuntime
>;

export function createDisplayedRowsRuntime(args: {
  readonly phantoms: PhantomChannel;
  readonly assertLive: () => void;
  readonly sourceState: (path: GridPath) => LevelSourceState;
  readonly schemaAt: (path: GridPath) => LevelSchema;
  readonly viewStateAt: (path: GridPath) => DisplayedRowsViewState;
  readonly beforeNotify: (path: GridPath) => void;
  readonly onFault: (error: unknown) => void;
  readonly onObserverError?: (error: unknown) => void;
}) {
  // Store and phantom subscription have the same path lifetime. Keeping their
  // cleanup maps separate lets unregister release either partially acquired
  // resource after construction or observer cleanup failures.
  const stores = new Map<GridPath, DisplayedRowsStore>();
  const phantomUnsubscribes = new Map<GridPath, () => void>();
  // The last source snapshot whose parent loop was reported, per path. A loop
  // is reported once per snapshot, not on every expand or draft edit.
  const reportedLoopSnapshots = new Map<GridPath, LevelSnapshot>();

  function storeFor(path: GridPath): DisplayedRowsStore {
    let store = stores.get(path);
    if (store) return store;
    args.assertLive();
    store = createDisplayedRowsStore({
      readInput: () => ({
        path,
        schema: args.schemaAt(path),
        sourceSnapshot: args.sourceState(path).snapshot,
        phantomRows: args.phantoms.get(path),
        viewState: args.viewStateAt(path),
      }),
      deriveDisplayedRowsState: (input, previous) => {
        const state = deriveDisplayedRowsState(input, previous);
        reportTreeLoop(input, state);
        return state;
      },
      beforeNotify: () => args.beforeNotify(path),
      onObserverError: args.onObserverError,
    });
    stores.set(path, store);
    phantomUnsubscribes.set(
      path,
      args.phantoms.subscribe(path, () => {
        try {
          invalidate(path, { type: "phantoms" });
        } catch (error) {
          args.onFault(error);
        }
      }),
    );
    return store;
  }

  function reportTreeLoop(
    input: DisplayedRowsInput,
    state: DisplayedRowsState,
  ): void {
    const loopRowIds = state.tree?.loopRowIds ?? [];
    if (loopRowIds.length === 0) return;
    if (reportedLoopSnapshots.get(input.path) === input.sourceSnapshot) return;
    reportedLoopSnapshots.set(input.path, input.sourceSnapshot);
    const rowKeys = loopRowIds.map((rowId) => `"${rowKeyOfRowId(rowId)}"`);
    reportObserverError(
      new Error(
        `Grid tree at path "${input.path}": the parent keys of rows ${rowKeys.join(", ")} form a loop. Those rows are shown at top level.`,
      ),
      args.onObserverError,
    );
  }

  function rows(path: GridPath): DisplayedRows {
    args.assertLive();
    return storeFor(path).getDisplayedRows();
  }

  function sequence(path: GridPath): DisplayedRowSequence {
    args.assertLive();
    return storeFor(path).getDisplayedRowSequence();
  }

  function row(path: GridPath, rowId: RowId): LevelRow | undefined {
    args.assertLive();
    return storeFor(path).getDisplayedRow(rowId);
  }

  function tree(path: GridPath): TreeStructure | null {
    args.assertLive();
    return storeFor(path).getTreeStructure();
  }

  function subscribeSequence(path: GridPath, listener: () => void) {
    args.assertLive();
    return storeFor(path).subscribeDisplayedRowSequence(listener);
  }

  function subscribeRows(path: GridPath, listener: () => void) {
    args.assertLive();
    return storeFor(path).subscribeDisplayedRows(listener);
  }

  function subscribeRow(path: GridPath, rowId: RowId, listener: () => void) {
    args.assertLive();
    return storeFor(path).subscribeDisplayedRow(rowId, listener);
  }

  function invalidate(path: GridPath, reason: DisplayedRowsInvalidationReason) {
    // Invalidation is intentionally a no-op until the path has a store. The
    // first read derives directly from the latest source and phantom state.
    stores.get(path)?.invalidateDisplayedRows(reason);
  }

  function unregister(path: GridPath): void {
    cleanup(phantomUnsubscribes.get(path));
    phantomUnsubscribes.delete(path);
    const store = stores.get(path);
    if (store) cleanup(() => store.dispose());
    stores.delete(path);
    reportedLoopSnapshots.delete(path);
  }

  function dispose(): void {
    for (const path of Array.from(stores.keys())) unregister(path);
    for (const cleanupFn of phantomUnsubscribes.values()) cleanup(cleanupFn);
    phantomUnsubscribes.clear();
  }

  function cleanup(cleanupFn: (() => void) | undefined): void {
    if (!cleanupFn) return;
    try {
      cleanupFn();
    } catch (error) {
      reportObserverError(error, args.onObserverError);
    }
  }

  return {
    rows,
    sequence,
    row,
    tree,
    subscribeRows,
    subscribeSequence,
    subscribeRow,
    invalidate,
    unregister,
    dispose,
  };
}
// Path-scoped displayed-row resources.
//
// Each store combines one source snapshot, that path's drafts, and static
// schema into the row model used by rendering and interaction. Stores are lazy:
// reading or subscribing to a path creates its store. A source refresh alone
// does not create work for paths nobody has read.
