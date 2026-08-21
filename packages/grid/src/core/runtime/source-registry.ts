import type { GridPath, RowKey } from "../types/identity";
import type { TreeNode } from "../types/level-row";
import {
  createObserverList,
  reportObserverError,
  type ObserverList,
} from "../observer-notification";
import type {
  LevelDataSource,
  LevelQueryCapabilities,
  LevelSnapshot,
  LevelSourceState,
  LevelStatus,
  ReconcileEvent,
  RuntimeLevelDataSource,
  SourceLoadResult,
} from "../data-sources/types";
import {
  createStructuralSnapshotCache,
  snapshotLevelSnapshot,
} from "../data-sources/immutable-snapshot";

declare const levelHandleBrand: unique symbol;

/** Opaque identity for one registration of a grid path. */
export type LevelHandle = {
  readonly path: GridPath;
  readonly [levelHandleBrand]: never;
};

export type SourceRefresh = {
  readonly handle: LevelHandle;
  readonly state: LevelSourceState;
  readonly statusChanged:
    | { readonly status: LevelStatus; readonly error?: Error }
    | undefined;
};

type RowMembership = {
  // A row receives a new generation whenever its key enters after being
  // absent. Operations issued for an older occurrence then become stale.
  readonly generation: number;
  readonly present: boolean;
};

type SourceEntry = {
  readonly handle: LevelHandle;
  readonly path: GridPath;
  readonly source: LevelDataSource;
  /** Current and historical membership for stale-target detection. */
  readonly membership: Map<RowKey, RowMembership>;
  /** Removals awaiting an authoritative source snapshot without the row. */
  readonly pendingRemovals: Set<RowKey>;
  /** Source, reconcile, level, and view cleanup tied to this registration. */
  readonly registrationCleanup: Set<() => void>;
  /** Subscribers of the readonly `level.data` view. */
  readonly viewListeners: ObserverList<[]>;
  /** Subscribers of reconciliation events on the readonly source view. */
  readonly reconcileListeners: ObserverList<[event: ReconcileEvent]>;
  state: LevelSourceState;
  lastNotifiedStatus: LevelStatus;
  hasIdentityError: boolean;
  view: RuntimeLevelDataSource | undefined;
  active: boolean;
  disposed: boolean;
};

export type SourceRegistry = ReturnType<typeof createSourceRegistry>;

export function createSourceRegistry(args: {
  readonly rootPath: GridPath;
  readonly assertRuntimeLive: () => void;
  readonly runOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly onRefresh: (refresh: SourceRefresh) => void;
  readonly onReconcile: (handle: LevelHandle, event: ReconcileEvent) => void;
  readonly onObserverError?: (error: unknown) => void;
}) {
  // `entries` contains only current registrations. `entriesByHandle` also
  // finds a deactivated entry during final disposal and rejects stale handles.
  const entries = new Map<GridPath, SourceEntry>();
  const entriesByHandle = new WeakMap<LevelHandle, SourceEntry>();
  const adaptedSourceSnapshots = new WeakMap<LevelSnapshot, LevelSnapshot>();
  const adaptedStructuralSnapshots = createStructuralSnapshotCache();
  const adaptedSnapshotsByNodes = new WeakMap<
    readonly TreeNode[],
    {
      readonly footerRows: LevelSnapshot["footerRows"];
      readonly snapshot: LevelSnapshot;
    }
  >();
  let membershipGeneration = 0;

  function entryForHandle(handle: LevelHandle): SourceEntry | undefined {
    const entry = entriesByHandle.get(handle);
    return entry?.active && entries.get(entry.path) === entry
      ? entry
      : undefined;
  }

  function assertHandleLive(handle: LevelHandle): SourceEntry {
    args.assertRuntimeLive();
    const entry = entryForHandle(handle);
    if (!entry) throw new Error("Grid level is no longer registered.");
    return entry;
  }

  function handleFor(path: GridPath): LevelHandle {
    args.assertRuntimeLive();
    const entry = entries.get(path);
    if (!entry?.active) throw missingSourceError(path);
    return entry.handle;
  }

  function has(path: GridPath): boolean {
    return entries.get(path)?.active === true;
  }

  function paths(): readonly GridPath[] {
    return Array.from(entries.keys());
  }

  function source(path: GridPath): LevelDataSource | undefined {
    const entry = entries.get(path);
    return entry?.active ? entry.source : undefined;
  }

  function state(path: GridPath): LevelSourceState {
    const entry = entries.get(path);
    if (!entry?.active) throw missingSourceError(path);
    return entry.state;
  }

  function stateForHandle(handle: LevelHandle): LevelSourceState {
    return assertHandleLive(handle).state;
  }

  function adaptSnapshot(snapshot: LevelSnapshot): LevelSnapshot {
    // Sources may allocate a new wrapper around unchanged node/footer arrays.
    // Reuse the adapted snapshot so downstream identity comparisons stay quiet.
    const existing = adaptedSourceSnapshots.get(snapshot);
    if (existing) return existing;
    const byNodes = adaptedSnapshotsByNodes.get(snapshot.nodes);
    if (byNodes && byNodes.footerRows === snapshot.footerRows) {
      adaptedSourceSnapshots.set(snapshot, byNodes.snapshot);
      return byNodes.snapshot;
    }
    const adapted = snapshotLevelSnapshot(snapshot, adaptedStructuralSnapshots);
    adaptedSourceSnapshots.set(snapshot, adapted);
    adaptedSnapshotsByNodes.set(snapshot.nodes, {
      footerRows: snapshot.footerRows,
      snapshot: adapted,
    });
    return adapted;
  }

  function cacheState(entry: SourceEntry, next: LevelSourceState): void {
    try {
      const adapted = snapshotSourceState(next, adaptSnapshot);
      assertUniqueNodeKeys(adapted.snapshot.nodes, entry.path);
      if ("previous" in adapted) {
        assertUniqueNodeKeys(adapted.previous.nodes, entry.path);
      }
      entry.state = adapted;
      entry.hasIdentityError = false;
      updateMembership(entry, adapted.snapshot.nodes);
    } catch (cause) {
      // Duplicate or malformed row identity makes lookup and mutation unsafe.
      // Preserve the last usable snapshot as an error state and disable writes.
      const error = errorOf(cause);
      const previous = entry.state?.snapshot ?? EMPTY_LEVEL_SNAPSHOT;
      entry.state =
        previous.nodes.length === 0
          ? Object.freeze({ status: "initialError", snapshot: previous, error })
          : Object.freeze({
              status: "refreshError",
              snapshot: previous,
              previous,
              error,
            });
      entry.hasIdentityError = true;
    }
  }

  function updateMembership(entry: SourceEntry, nodes: readonly TreeNode[]) {
    const previous = new Map(entry.membership);
    const present = new Set(nodes.map((node) => node.rowKey));
    for (const [rowKey, membership] of previous) {
      entry.membership.set(rowKey, {
        generation: membership.generation,
        present: present.has(rowKey),
      });
    }
    for (const rowKey of present) {
      const old = previous.get(rowKey);
      entry.membership.set(rowKey, {
        generation:
          old?.present === true ? old.generation : ++membershipGeneration,
        present: true,
      });
    }
  }

  function refresh(entry: SourceEntry): void {
    // Source state is cached before onRefresh runs. Every runtime callback can
    // therefore re-read this entry and observe the new state.
    if (!entry.active || entries.get(entry.path) !== entry) return;
    cacheState(entry, entry.source.state());
    const status = entry.state.status;
    const statusChanged =
      entry.lastNotifiedStatus === status
        ? undefined
        : {
            status,
            ...(entry.state.status === "initialError" ||
            entry.state.status === "refreshError"
              ? { error: entry.state.error }
              : {}),
          };
    entry.lastNotifiedStatus = status;
    args.onRefresh({ handle: entry.handle, state: entry.state, statusChanged });
  }

  function register(
    path: GridPath,
    acquire: () => LevelDataSource,
  ): LevelHandle {
    args.assertRuntimeLive();
    // Registration is idempotent for the current path lifetime. This is what
    // makes repeated expansion reuse its already acquired child source.
    if (entries.has(path)) return entries.get(path)!.handle;
    const source = acquire();
    const handle = Object.freeze({ path }) as LevelHandle;
    const entry: SourceEntry = {
      handle,
      path,
      source,
      membership: new Map(),
      pendingRemovals: new Set(),
      registrationCleanup: new Set(),
      viewListeners: createObserverList(args.onObserverError),
      reconcileListeners: createObserverList(args.onObserverError),
      state: EMPTY_INITIAL_STATE,
      lastNotifiedStatus: "initialLoading",
      hasIdentityError: false,
      view: undefined,
      active: true,
      disposed: false,
    };
    entries.set(path, entry);
    entriesByHandle.set(handle, entry);
    const acquired: Array<() => void> = [];
    try {
      // Read the first state before subscribing. A conforming source publishes
      // state before notification, so no later callback can expose an older
      // snapshot than this one.
      cacheState(entry, source.state());
      entry.lastNotifiedStatus = entry.state.status;
      acquired.push(
        source.subscribe(() => {
          refresh(entry);
        }),
      );
      if (source.write) {
        acquired.push(
          source.write.onReconcile((event) => {
            if (!entry.active) return;
            args.onReconcile(handle, event);
            entry.reconcileListeners.notify(event);
          }),
        );
      }
      for (const cleanup of acquired) entry.registrationCleanup.add(cleanup);
      return handle;
    } catch (error) {
      entry.active = false;
      entries.delete(path);
      for (const cleanup of acquired.reverse()) cleanupSafely(cleanup);
      disposeEntry(entry);
      throw error;
    }
  }

  function addCleanup(handle: LevelHandle, cleanup: () => void): () => void {
    // Cleanup joins the registration lifetime and is itself idempotent. Level
    // subscriptions use this to stop when their source registration ends.
    const entry = assertHandleLive(handle);
    let active = true;
    const tracked = () => {
      if (!active) return;
      active = false;
      entry.registrationCleanup.delete(tracked);
      cleanupSafely(cleanup);
    };
    entry.registrationCleanup.add(tracked);
    return tracked;
  }

  function deactivate(handle: LevelHandle): LevelHandle | undefined {
    // Deactivation makes every dynamic view fail immediately. Source disposal
    // is separate so the runtime can first release dependent level resources.
    const entry = entryForHandle(handle);
    if (!entry) return undefined;
    entry.active = false;
    entries.delete(entry.path);
    for (const cleanup of Array.from(entry.registrationCleanup).reverse()) {
      cleanupSafely(cleanup);
    }
    entry.registrationCleanup.clear();
    entry.viewListeners.clear();
    entry.reconcileListeners.clear();
    return handle;
  }

  function deactivatePath(path: GridPath): LevelHandle | undefined {
    const entry = entries.get(path);
    return entry ? deactivate(entry.handle) : undefined;
  }

  function disposeHandle(handle: LevelHandle): void {
    const entry = entriesByHandle.get(handle);
    if (entry) disposeEntry(entry);
  }

  function disposeEntry(entry: SourceEntry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    cleanupSafely(() => entry.source.dispose());
    entry.membership.clear();
    entry.pendingRemovals.clear();
    entry.view = undefined;
  }

  function dispose(): void {
    for (const entry of Array.from(entries.values())) {
      deactivate(entry.handle);
      disposeEntry(entry);
    }
  }

  function view(handle: LevelHandle): RuntimeLevelDataSource {
    const entry = assertHandleLive(handle);
    if (entry.view) return entry.view;
    const query = wrapQuery(entry);
    // The public view keeps reads, queries, and reconcile observation. Concrete
    // write verbs stay behind the runtime mutation boundary.
    entry.view = Object.freeze({
      get canWrite() {
        assertHandleLive(handle);
        return entry.source.write !== undefined;
      },
      state: () => stateForHandle(handle),
      subscribe(listener: () => void) {
        assertHandleLive(handle);
        return addCleanup(handle, entry.viewListeners.subscribe(listener));
      },
      ...(query ? { query } : {}),
      onReconcile(listener: (event: ReconcileEvent) => void) {
        assertHandleLive(handle);
        if (!entry.source.write) return () => {};
        return addCleanup(handle, entry.reconcileListeners.subscribe(listener));
      },
    });
    return entry.view;
  }

  function wrapQuery(entry: SourceEntry): LevelQueryCapabilities | undefined {
    const sourceQuery = entry.source.query;
    if (!sourceQuery) return undefined;
    const handle = entry.handle;
    return Object.freeze({
      ...(sourceQuery.sort
        ? {
            sort: Object.freeze({
              current: () => {
                assertHandleLive(handle);
                return sourceQuery.sort!.current();
              },
              set: (
                sort: Parameters<
                  NonNullable<typeof sourceQuery.sort>["set"]
                >[0],
              ) =>
                args.runOperation(async () => {
                  assertHandleLive(handle);
                  return adaptLoadResult(
                    entry,
                    await sourceQuery.sort!.set(sort),
                  );
                }),
            }),
          }
        : {}),
      ...(sourceQuery.filter
        ? {
            filter: Object.freeze({
              current: () => {
                assertHandleLive(handle);
                return sourceQuery.filter!.current();
              },
              set: (
                filter: Parameters<
                  NonNullable<typeof sourceQuery.filter>["set"]
                >[0],
              ) =>
                args.runOperation(async () => {
                  assertHandleLive(handle);
                  return adaptLoadResult(
                    entry,
                    await sourceQuery.filter!.set(filter),
                  );
                }),
            }),
          }
        : {}),
      ...(sourceQuery.refetch
        ? {
            refetch: () =>
              args.runOperation(async () => {
                assertHandleLive(handle);
                return adaptLoadResult(entry, await sourceQuery.refetch!());
              }),
          }
        : {}),
    });
  }

  function adaptLoadResult(
    entry: SourceEntry,
    result: SourceLoadResult,
  ): SourceLoadResult {
    if (result.kind === "superseded" || result.kind === "disposed")
      return result;
    const current = entry.state;
    if (current.status === "ready") return { kind: "ready", state: current };
    if (
      current.status === "initialError" ||
      current.status === "refreshError"
    ) {
      return { kind: "error", state: current };
    }
    return { kind: "unchanged", state: current };
  }

  function notifyView(handle: LevelHandle): void {
    // Runtime orchestration calls this only after displayed rows, selection,
    // boundary navigation, and host status events have processed the refresh.
    const entry = entryForHandle(handle);
    entry?.viewListeners.notify();
  }

  function membershipGenerationFor(path: GridPath, rowKey: RowKey) {
    const membership = entries.get(path)?.membership.get(rowKey);
    return membership?.present ? membership.generation : undefined;
  }

  function isWritable(path: GridPath): boolean {
    const entry = entries.get(path);
    return !!entry?.source.write && !entry.hasIdentityError;
  }

  function pendingRemovals(path: GridPath): Set<RowKey> | undefined {
    return entries.get(path)?.pendingRemovals;
  }

  function cleanupSafely(cleanup: () => void): void {
    try {
      cleanup();
    } catch (error) {
      reportObserverError(error, args.onObserverError);
    }
  }

  return {
    register,
    has,
    paths,
    handleFor,
    assertHandleLive,
    entryForHandle,
    source,
    state,
    stateForHandle,
    view,
    addCleanup,
    deactivate,
    deactivatePath,
    disposeHandle,
    dispose,
    refreshPath(path: GridPath) {
      const entry = entries.get(path);
      if (entry) refresh(entry);
    },
    notifyView,
    membershipGenerationFor,
    isWritable,
    pendingRemovals,
  };
}

function snapshotSourceState(
  state: LevelSourceState,
  snapshotFor: (snapshot: LevelSnapshot) => LevelSnapshot,
): LevelSourceState {
  const snapshot = snapshotFor(state.snapshot);
  switch (state.status) {
    case "initialLoading":
    case "ready":
      return Object.freeze({ status: state.status, snapshot });
    case "initialError":
      return Object.freeze({
        status: state.status,
        snapshot,
        error: state.error,
      });
    case "refreshing":
      return Object.freeze({
        status: state.status,
        snapshot,
        previous: snapshotFor(state.previous),
      });
    case "refreshError":
      return Object.freeze({
        status: state.status,
        snapshot,
        previous: snapshotFor(state.previous),
        error: state.error,
      });
  }
}

function assertUniqueNodeKeys(
  nodes: readonly TreeNode[],
  path: GridPath,
): void {
  const seen = new Set<RowKey>();
  for (const node of nodes) {
    if (seen.has(node.rowKey)) {
      throw new Error(
        `GridRuntime: duplicate TreeNode.rowKey "${node.rowKey}" at path "${path}".`,
      );
    }
    seen.add(node.rowKey);
  }
}

function missingSourceError(path: GridPath): Error {
  return new Error(
    `GridRuntime: no source has been resolved for path "${path}".`,
  );
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const EMPTY_LEVEL_SNAPSHOT: LevelSnapshot = Object.freeze({
  nodes: Object.freeze([]),
});
const EMPTY_INITIAL_STATE: LevelSourceState = Object.freeze({
  status: "initialLoading",
  snapshot: EMPTY_LEVEL_SNAPSHOT,
});
// Live source registrations for one grid runtime.
//
// A path string names a location, while LevelHandle names one particular
// registration of that location. The distinction matters after a parent row is
// removed: an old level object must remain stale even if the same path is later
// registered again.
//
// The registry adapts source state before the rest of the runtime sees it. It
// freezes snapshots, preserves identities, validates row keys, tracks row
// membership generations, and publishes a readonly runtime source view.
