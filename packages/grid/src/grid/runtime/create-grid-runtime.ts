// The runtime — a plain TypeScript value (not React) that owns the
// grid's entire non-React state graph.
//
// The runtime holds a `GridSchema` + `GridDataSource`, derives
// `SchemaTopology` once, and registers child sources as rows are expanded.
// Sources publish display-ready nodes and lifecycle state; source or host
// capabilities own query/loading policy. The runtime owns expansion,
// phantoms, mutation events, and per-path displayed-row stores that derive
// `DisplayedRowsInput` into full rows plus row sequences. There is no
// `applyTransaction` and no `nodes/sort/filter/page` map in the runtime.
//
// Four non-interfering channels. Grid state lives in exactly four
// channels, each with its own mechanism and lifetime. A change in one
// channel never causes subscribers of another channel to wake up:
//
//   1. STATIC — props and context (`GridRuntimeProvider` + a runtime
//      value). Schema, level columns, level options, column
//      renderers/editors. Changes only when the input `GridSchema` is
//      replaced.
//
//   2. TRANSIENT — `GridController`, one Zustand store per `GridPath`.
//      Selection, focus, editing. Each path's controller is independent;
//      a selection change in one path never wakes subscribers in another.
//
//   3. STRUCTURAL — `GridCoordinator`, one Zustand store per runtime.
//      Cross-path concerns: expansion and active path. Boundary
//      navigation resolves on demand through visible-order helpers and
//      dispatches focus directly to the target controller — no
//      pendingFocus mailbox.
//
//   4. DATA — `LevelDataSource` (per `GridPath`). Publishes nodes that are
//      already shaped for display, optional footers, lifecycle state, and
//      optional query/write capabilities. The runtime never owns data or
//      page state; it receives a `GridDataSource` from the host and
//      registers sources as paths are expanded.
//
// The runtime is also the single seam through which writes flow:
// `writeCell`, `applyChanges`, `createRow`, `removeRow`, and
// `commitPhantomRow` look up the source for that path, capture pre-state,
// ask the source to apply the change, and emit `mutationCommitted`.
// All write verbs throw if the resolved source is readonly.
//
// Source lifecycle: the registry is keyed on
// `(parentPath, parentRowKey, childLevelName)`; a row's first expansion
// resolves the child source via `gridDataSource.resolveChild(...)` and
// installs it. Collapsing leaves the entry — re-expanding reuses it
// (the registry guarantees `resolveChild` is invoked at most once per
// key per runtime lifetime). `dispose()` tears down every entry, the
// data-source itself, the phantom channel, then the controllers.
//
// For the four-channel invariant this wires together, see `index.ts`.
//
// Row interaction theory in one place:
//
//   - `activeRowFor(path)` is the canonical read for the active row. In a
//     cell-grid it is derived from the cell cursor when configured; in a
//     row-list it is derived from that path's live row focus.
//
//   - `selectedRowsFor(path)` is the canonical read for selected operation
//     targets. It may be disabled, derived from active row, or read from the
//     path-local stored row selection depending on `interaction.selectedRows`.
//
//   - `rowInteraction` commands mutate operation targets without moving either
//     cursor, except for the explicitly cursor-shaped commands. This lets a
//     checkbox column be ordinary presentation chrome on top of headless
//     runtime primitives.
//
// Runtime row interaction reads are path-scoped. A `GridPath` names one
// rendered grid part: the root level, an expanded child level under a row, or a
// deeper descendant. The runtime can enumerate registered paths, but it does
// not store one whole-table row selection. Page-level commands must choose
// their scope and aggregate path-local projections explicitly.
//
// Row operation targets are a command-level idea. They may be sourced from
// explicit row selection, rows covered by cell selection, or active-row
// fallback, but that projection should stay separate from stored rowSelection
// so cell-grid and row-list interaction state remain independent.

import { capabilitiesFor } from "../types/capabilities";
import {
  childPath as makeChildPath,
  cursorEqual,
  decomposePath,
  makeRowId,
  pathOfRowId,
  phantomKeyFromDisplayedRowId,
  rootPath,
  rowKeyOfRowId,
  trailingEdge,
} from "../types/identity";
import type {
  CellCursor,
  ColId,
  Coord,
  GridPath,
  RowId,
  RowKey,
} from "../types/identity";
import type { ColPolicy } from "../types/action";
import type { GridInteractionConfig } from "../types/interaction";
import { normalizeInteraction } from "../interaction/normalize-interaction";
import type {
  RowCursor,
  RowInteractionSnapshot,
  RowInteractionStatus,
  RowSelection,
} from "../types/row-selection";
import {
  activeRowFor,
  makeRowRangeSelection,
  makeRowSetSelection,
  makeSingleRowSelection,
  normalizeRowSelection,
  rowIdsInRowSelection,
  rowSelectionContainsRow as rowSelectionHasRow,
  rowCursorEqual,
  selectedRowsFor,
} from "../types/row-selection";
import type {
  DisplayedRows,
  DisplayedRowSequence,
  LevelRow,
  PhantomRow,
  PhantomRowsConfig,
  TreeNode,
} from "../types/level-row";
import type {
  CellActionApi,
  CellActivationContext,
  CellRenderActivation,
  CellActivationTrigger,
  GridSchema,
  LevelSchema,
} from "../types/schema";
import { describeCellActivation } from "../types/schema";
import {
  assertTreeNodeCanBeInserted,
  assertUniqueTreeNodeRowKeys,
  rowKeyOfTreeNode,
} from "../row-identity";
import {
  createObserverList,
  reportObserverError,
  type ObserverList,
} from "../observer-notification";
import type {
  CellChange,
  CreateNodeResult,
  GridDataSource,
  LevelDataSource,
  LevelQueryCapabilities,
  LevelSnapshot,
  LevelSourceState,
  LevelStatus,
  RuntimeLevelDataSource,
  ReconcileEvent,
  SourceLoadResult,
  WriteCapability,
} from "../data-sources/types";
import {
  createDisplayedRowsStore,
  deriveDisplayedRowsState,
  type DisplayedRowsInput,
  type DisplayedRowsInvalidationReason,
  type DisplayedRowsStore,
  type DisplayedRowsViewState,
} from "../displayed-rows";
import { buildSchemaTopology, type SchemaTopology } from "../schema";
import {
  createGridController,
  type GridControllerPublic,
  type GridControllerStore,
} from "../interaction/controller";
import {
  createGridCoordinator,
  type GridCoordinatorPublic,
  type GridCoordinatorStore,
} from "../interaction/coordinator";
import {
  createCursorManager,
  type CursorManagerInternal,
} from "../interaction/cursor-manager";
import {
  planCursorContinuation,
  type CursorContinuation,
  type CursorContinuationRow,
  type RowRemovalRef,
} from "../interaction/cursor-continuation";
import { visibleRows } from "../interaction/visible-order";
import {
  createPhantomChannel,
  disposePhantomPath,
} from "../data-sources/phantom-channel";
import { createEmitter, type GridEmitter, type GridEvents } from "./emitter";
import type { PhantomChannel } from "../data-sources/types";
import {
  createStructuralSnapshotCache,
  snapshotLevelSnapshot,
} from "../data-sources/immutable-snapshot";
import { createPhantomRowLifecycle } from "./phantom-row-lifecycle";
import {
  createGridLevelRuntime,
  disposeGridLevelRuntime,
  type GridLevelRuntime,
} from "./grid-level-runtime";
import {
  createRowOperations,
  type GridRowOperations,
  type RowOperationTarget,
  type RowOperationsController,
  type RowRemovalCursorToken,
  type RowRemovalResult,
} from "./row-operations";
import { rowsInSelection } from "../types/selection";
import {
  firstFocusableRow,
  lastFocusableRow,
} from "../types/level-row-traversal";

export type RuntimeArgs = {
  readonly schema: GridSchema;
  readonly dataSource: GridDataSource;
  readonly interaction?: GridInteractionConfig;
  readonly phantoms?: PhantomChannel;
  readonly phantomRows?: PhantomRowsConfig;
  // A host can own displayed-row edge policy for loaded windows. The runtime
  // emits a boundary event and waits for the host/source load promise. After a
  // ready result, it samples displayed rows and lands on the requested edge.
  readonly onLoadedRowsBoundary?: (
    event: LoadedRowsBoundaryEvent,
  ) => Promise<SourceLoadResult> | false;
  readonly on?: {
    readonly [E in keyof GridEvents]?: (payload: GridEvents[E]) => void;
  };
  readonly onObserverError?: (error: unknown) => void;
};

export type GridRuntime = {
  readonly schema: GridSchema;
  readonly interaction: GridInteractionConfig;
  readonly root: GridLevelRuntime;
  level(path: GridPath): GridLevelRuntime;
  registeredLevels(): readonly GridLevelRuntime[];
  subscribeLevels(listener: () => void): () => void;
  schemaAt(path: GridPath): LevelSchema;
  readonly rowOperations: GridRowOperations;
  on<E extends keyof GridEvents>(
    event: E,
    listener: (payload: GridEvents[E]) => void,
  ): () => void;
  dispose(): void;
};

/** Package-private runtime surface used by the renderer and advanced entry. */
export type GridRuntimeInternals = {
  schema: GridSchema;
  schemaTopology: SchemaTopology;
  // Fires every time the child-source registry's key set changes — e.g.
  // when a row's first expansion installs a new child source. Status
  // flips do NOT trigger this; status is read lazily through
  // `snapshotFor` at the call site.
  registeredPaths: () => readonly GridPath[];
  subscribeRegistry: (fn: () => void) => () => void;

  coordinator: GridCoordinatorPublic;
  cursorManager: CursorManagerInternal;
  phantoms: PhantomChannel;
  interaction: GridInteractionConfig;

  activeRowFor: (path: GridPath) => RowCursor | null;
  selectedRowsFor: (path: GridPath) => RowSelection;
  selectedRowIds: (path: GridPath) => readonly RowId[];
  rowInteractionSnapshotFor: (path: GridPath) => RowInteractionSnapshot;
  rowOperationTargetsFor: (path: GridPath) => readonly RowOperationTarget[];
  subscribeActiveRow: (path: GridPath, fn: () => void) => () => void;
  subscribeSelectedRows: (path: GridPath, fn: () => void) => () => void;
  subscribeSelectedRowIds: (path: GridPath, fn: () => void) => () => void;
  subscribeRowInteractionSnapshot: (
    path: GridPath,
    fn: () => void,
  ) => () => void;
  rowInteraction: RowInteractionCommands;

  displayedRowsFor: (path: GridPath) => DisplayedRows;
  displayedRowSequenceFor: (path: GridPath) => DisplayedRowSequence;
  displayedRowFor: (path: GridPath, rowId: RowId) => LevelRow | undefined;
  subscribeDisplayedRowSequence: (path: GridPath, fn: () => void) => () => void;
  subscribeDisplayedRow: (
    path: GridPath,
    rowId: RowId,
    fn: () => void,
  ) => () => void;
  invalidateDisplayedRows: (
    path: GridPath,
    reason: DisplayedRowsInvalidationReason,
  ) => void;
  snapshotFor: (path: GridPath) => LevelSnapshot;
  sourceStateFor: (path: GridPath) => LevelSourceState;
  controllerFor: (path: GridPath) => GridControllerPublic;
  cellActivationFor: (
    path: GridPath,
    coord: Coord,
    trigger?: CellActivationTrigger,
  ) => CellRenderActivation | null;
  // Schema at a given path. Works for any well-formed GridPath, even when
  // no source has yet been registered for it — the level name is decoded
  // from the path and looked up in `schemaTopology`.
  schemaAt: (path: GridPath) => LevelSchema;
  // Child paths whose source is registered for `(parentPath, rowId)`,
  // returned in schema declaration order. "Materialized" means *source
  // registered*, not *currently expanded*: collapse leaves the source
  // cached, and the caller (render or visible-order traversal) is
  // responsible for filtering by expansion.
  materializedChildren: (parentPath: GridPath, rowId: RowId) => GridPath[];
  // Returns the read view for the source registered for `path`, or throws
  // if `path` has not yet been resolved (root is always resolved on first
  // use; child paths are resolved by `coordinator.toggleExpand` via
  // `onExpand`). Write verbs are intentionally absent from this view.
  sourceFor: (path: GridPath) => RuntimeLevelDataSource;

  // Single seam for cell writes. Resolves the source for `path`, reads the
  // prior value, calls `setCell`, and emits `mutationCommitted`. Throws
  // synchronously when the source is readonly or when the path has no resolved
  // source.
  writeCell: (path: GridPath, coord: Coord, value: unknown) => void;
  // Batched edit on one path. Emits one `mutationCommitted` event. The source
  // is responsible for atomicity — partial failures are not exposed to the host.
  applyChanges: (path: GridPath, changes: readonly CellChange[]) => void;
  // Runtime-owned row insertion/removal. These are the host-facing row
  // mutation verbs; the concrete source verbs are private to the runtime.
  createRow: (
    path: GridPath,
    node: TreeNode,
    atIndex?: number,
  ) => Promise<CreateNodeResult>;
  removeRow: (path: GridPath, rowKey: RowKey) => Promise<void>;
  // Plan against the current visible tree before row mutations begin, then
  // apply once so logical focus and DOM focus continue independently of source
  // timing. The host remains responsible for deciding which rows to remove.
  planCursorContinuationForRowRemoval: (
    removals: readonly RowRemovalRef[],
  ) => CursorContinuation;
  applyCursorContinuation: (continuation: CursorContinuation) => void;
  commitPhantomRow: (
    path: GridPath,
    rowKey: RowKey,
    atIndex?: number,
  ) => Promise<CreateNodeResult>;
  phantomBoundaryCellTarget: (
    path: GridPath,
    colId: ColId,
    colPolicy: "preserve" | "first" | "last",
  ) => CellCursor | null;
  phantomBoundaryRowTarget: (path: GridPath) => RowCursor | null;
  requestLoadedRowsBoundary: (event: LoadedRowsBoundaryEvent) => boolean;

  observe: <Args extends readonly unknown[]>(
    listener: (...args: Args) => void,
  ) => (...args: Args) => void;
  on: GridEmitter["on"];
  dispose: () => void;
};

export type RowInteractionCommands = {
  setRowCursor: (target: RowCursor) => void;
  clearRowCursor: () => void;
  selectRow: (path: GridPath, rowId: RowId) => void;
  setRowSelection: (path: GridPath, selection: RowSelection) => void;
  toggleRowSelection: (path: GridPath, rowId: RowId) => void;
  extendRowSelectionTo: (path: GridPath, rowId: RowId) => void;
  extendRowSelectionToCursor: (target: RowCursor) => void;
  clearRowSelection: (path: GridPath) => void;
};

type PendingPhantomCreate = {
  readonly promise: Promise<CreateNodeResult>;
};

export type LoadedRowsBoundaryEvent =
  | {
      readonly kind: "cell";
      readonly loadPath: GridPath;
      readonly direction: "before" | "after";
      readonly origin: CellCursor;
      readonly colPolicy: ColPolicy;
      readonly extend: boolean;
    }
  | {
      readonly kind: "row";
      readonly loadPath: GridPath;
      readonly direction: "before" | "after";
      readonly origin: RowCursor;
      readonly extend: boolean;
    };

type PendingLoadedRowsBoundary = {
  readonly event: LoadedRowsBoundaryEvent;
  readonly token: number;
};

const internalsByRuntime = new WeakMap<GridRuntime, GridRuntimeInternals>();

export function runtimeInternalsFor(
  runtime: GridRuntime,
): GridRuntimeInternals {
  const internals = internalsByRuntime.get(runtime);
  if (!internals) {
    throw new Error("GridRuntime: value was not created by createGridRuntime.");
  }
  return internals;
}

export function createGridRuntime(args: RuntimeArgs): GridRuntime {
  let schema: GridSchema;
  let interaction: GridInteractionConfig;
  let schemaTopology: SchemaTopology;
  try {
    schema = snapshotGridSchema(args.schema);
    interaction = snapshotGridInteraction(
      normalizeInteraction(args.interaction),
    );
    schemaTopology = buildSchemaTopology(schema);
    assertRowHeaderInteractionCompatibility(schema, interaction);
  } catch (error) {
    try {
      args.phantoms?.dispose();
    } catch (cleanupError) {
      reportObserverError(cleanupError, args.onObserverError);
    }
    try {
      args.dataSource.dispose();
    } catch (cleanupError) {
      reportObserverError(cleanupError, args.onObserverError);
    }
    throw error;
  }
  const { dataSource } = args;

  const emitter = createEmitter(args.onObserverError);
  const phantoms =
    args.phantoms ?? createPhantomChannel(undefined, args.onObserverError);

  // Wire initial subscriptions before any source can fire — the host
  // wants to observe the very first transitions.
  if (args.on) {
    for (const k of Object.keys(args.on) as Array<keyof GridEvents>) {
      const handler = args.on[k];
      if (handler) emitter.on(k, handler as never);
    }
  }

  // Child-source registry keyed by GridPath. The root path is the only
  // entry whose source comes from `dataSource.rootSource()`; every
  // other entry comes from `dataSource.resolveChild(...)`. Render and
  // visible-order both ask "which child paths are registered for
  // (parent, rowId)?" through `materializedChildren`; the registry is
  // the canonical answer.
  const sources = new Map<GridPath, LevelDataSource>();
  const levelRegistrations = new Map<GridPath, object>();
  const sourceViews = new Map<GridPath, RuntimeLevelDataSource>();
  const sourceStates = new Map<GridPath, LevelSourceState>();
  const adaptedSourceSnapshots = new WeakMap<LevelSnapshot, LevelSnapshot>();
  const adaptedStructuralSnapshots = createStructuralSnapshotCache();
  const adaptedSnapshotsByNodes = new WeakMap<
    readonly TreeNode[],
    {
      readonly footerRows: LevelSnapshot["footerRows"];
      readonly snapshot: LevelSnapshot;
    }
  >();
  const sourceViewListeners = new Map<GridPath, ObserverList<[]>>();
  const sourceReconcileListeners = new Map<
    GridPath,
    ObserverList<[event: ReconcileEvent]>
  >();
  const sourceUnsubs = new Map<GridPath, () => void>();
  const reconcileUnsubs = new Map<GridPath, () => void>();
  const lastStatusByPath = new Map<GridPath, LevelStatus>();
  const membershipByPath = new Map<
    GridPath,
    Map<RowKey, { readonly generation: number; readonly present: boolean }>
  >();
  const pendingAuthoritativeRemovals = new Map<GridPath, Set<RowKey>>();
  const identityErrorPaths = new Set<GridPath>();
  const phantomLifecycleSources = new Map<GridPath, LevelDataSource>();
  let membershipGeneration = 0;
  const pendingPhantomCreates = new Map<string, PendingPhantomCreate>();
  let pendingLoadedRowsBoundary: PendingLoadedRowsBoundary | null = null;
  let loadedRowsBoundaryToken = 0;
  const phantomLifecycle = createPhantomRowLifecycle({
    config: args.phantomRows,
    getSource: sourceForPhantomLifecycle,
    schemaAt: (path) => schemaForPath(path),
    getPhantoms: (path) => phantoms.get(path),
    addPhantom: (path, phantom) => phantoms.add(path, phantom),
    removePhantom: (path, rowKey) => phantoms.remove(path, rowKey),
    setPhantomCell: (path, rowKey, colId, value) =>
      phantoms.setCell(path, rowKey, colId, value),
    setPhantomState: (path, rowKey, state) =>
      phantoms.setState(path, rowKey, state),
    commitPhantomRow: (path, rowKey) => {
      void commitPhantomRow(path, rowKey).catch(() => {});
    },
  });

  function sourceForPhantomLifecycle(
    path: GridPath,
  ): LevelDataSource | undefined {
    const existing = phantomLifecycleSources.get(path);
    if (existing) return existing;
    const source = sources.get(path);
    if (!source) return undefined;
    const view: LevelDataSource = {
      state: () => sourceStates.get(path) ?? source.state(),
      subscribe: source.subscribe,
      dispose: () => {},
      ...(source.query ? { query: source.query } : {}),
      ...(source.write ? { write: source.write } : {}),
    };
    phantomLifecycleSources.set(path, view);
    return view;
  }

  const root = rootPath(schemaTopology.rootLevelName);
  let disposed = false;
  let runtimeFault: Error | null = null;
  let dependenciesDisposed = false;
  let activeOperations = 0;

  function assertLive(): void {
    if (disposed) {
      throw new Error("GridRuntime has been disposed.");
    }
    if (runtimeFault) {
      throw new Error(`GridRuntime has faulted: ${runtimeFault.message}`);
    }
  }

  function receiveSourceNotification(path: GridPath): void {
    try {
      onSourceSnapshotChanged(path);
    } catch (error) {
      faultRuntime(error);
    }
  }

  function faultRuntime(error: unknown): void {
    if (!runtimeFault) runtimeFault = errorOf(error);
    emitter.clear();
    reportObserverError(error, args.onObserverError);
  }

  function assertLevelLive(path: GridPath): void {
    assertLive();
    if (!sources.has(path)) {
      throw new Error("Grid level is no longer registered.");
    }
  }

  function assertLevelRegistrationLive(
    path: GridPath,
    registration: object,
  ): void {
    assertLive();
    if (!sources.has(path) || levelRegistrations.get(path) !== registration) {
      throw new Error("Grid level is no longer registered.");
    }
  }

  function runOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      assertLive();
    } catch (error) {
      return Promise.reject(error);
    }
    activeOperations += 1;
    try {
      return operation().finally(() => {
        activeOperations -= 1;
        if (disposed && activeOperations === 0) disposeDependencies();
      });
    } catch (error) {
      activeOperations -= 1;
      if (disposed && activeOperations === 0) disposeDependencies();
      return Promise.reject(error);
    }
  }

  // One displayed-rows store per path that has been rendered or read. The
  // runtime owns these stores because only the runtime can gather the full
  // `DisplayedRowsInput`: schema from topology, source snapshot from the
  // registered source, phantoms from the author-state channel, and body view
  // state. Components consume cached projections from this store; they do not
  // assemble or memoize row data in render.
  const displayedRowsStoresByPath = new Map<GridPath, DisplayedRowsStore>();
  const phantomSubscriptionUnsubs = new Map<GridPath, () => void>();
  const EMPTY_DISPLAYED_ROWS_VIEW_STATE: DisplayedRowsViewState = {};

  // Lazy controllers. Identity-stable per path for the runtime's
  // lifetime; collapsing/re-expanding does not recreate them.
  const controllers = new Map<GridPath, GridControllerStore>();
  const controllerUnsubs = new Map<GridPath, () => void>();
  const activeRowSnapshots = new Map<GridPath, RowCursor | null>();
  const selectedRowsSnapshots = new Map<GridPath, RowSelection>();
  const selectedRowIdSnapshots = new Map<GridPath, readonly RowId[]>();
  const rowInteractionSnapshots = new Map<GridPath, RowInteractionSnapshot>();
  const emptyRowIds: readonly RowId[] = [];
  const emptyRowOperationTargets: readonly RowOperationTarget[] = [];

  // Memoized `LevelSchema` per path. The path's level name is a function
  // of the path string, so the entry is stable for the runtime's
  // lifetime — no invalidation needed.
  const schemaCache = new Map<GridPath, LevelSchema>();
  const levelsByPath = new Map<GridPath, GridLevelRuntime>();
  let registeredLevelSnapshot: readonly GridLevelRuntime[] | null = null;
  let rowOperationsController: RowOperationsController | null = null;

  // useSyncExternalStore-style subscribers fired on every registry-key
  // change. Consumers re-read the path-derived view they need, commonly
  // `materializedChildren`, on the next tick.
  const registryListeners = createObserverList<[]>(args.onObserverError);
  let registeredPathSnapshot: readonly GridPath[] | null = null;

  function registeredPaths(): readonly GridPath[] {
    assertLive();
    if (!registeredPathSnapshot) {
      registeredPathSnapshot = Object.freeze(Array.from(sources.keys()));
    }
    return registeredPathSnapshot;
  }

  function registeredLevels(): readonly GridLevelRuntime[] {
    assertLive();
    if (registeredLevelSnapshot) return registeredLevelSnapshot;
    const next = Object.freeze(
      Array.from(sources.keys(), (path) => levelRuntimeFor(path)),
    );
    registeredLevelSnapshot = next;
    return next;
  }

  function subscribeRegistry(fn: () => void): () => void {
    assertLive();
    return registryListeners.subscribe(fn);
  }

  function notifyRegistryChanged(): void {
    registeredPathSnapshot = null;
    registeredLevelSnapshot = null;
    if (!disposed) registryListeners.notify();
  }

  function levelNameOf(path: GridPath): string {
    const decomp = decomposePath(path);
    return decomp.edges.length === 0
      ? decomp.rootLevelName
      : decomp.edges[decomp.edges.length - 1].levelName;
  }

  function cacheSourceState(path: GridPath, state: LevelSourceState): void {
    try {
      const adapted = snapshotLevelSourceState(state, adaptSourceSnapshot);
      assertUniqueNodeKeys(adapted.snapshot.nodes, path);
      if ("previous" in adapted) {
        assertUniqueNodeKeys(adapted.previous.nodes, path);
      }
      sourceStates.set(path, adapted);
      identityErrorPaths.delete(path);
      updateMembership(path, adapted.snapshot.nodes);
    } catch (cause) {
      const error = errorOf(cause);
      const previous = sourceStates.get(path)?.snapshot ?? EMPTY_LEVEL_SNAPSHOT;
      const identityError: LevelSourceState =
        previous.nodes.length === 0
          ? Object.freeze({
              status: "initialError",
              snapshot: previous,
              error,
            })
          : Object.freeze({
              status: "refreshError",
              snapshot: previous,
              previous,
              error,
            });
      sourceStates.set(path, identityError);
      identityErrorPaths.add(path);
    }
  }

  function adaptSourceSnapshot(snapshot: LevelSnapshot): LevelSnapshot {
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

  function updateMembership(path: GridPath, nodes: readonly TreeNode[]): void {
    const previous = membershipByPath.get(path) ?? new Map();
    const present = new Set(nodes.map((node) => node.rowKey));
    const next = new Map<
      RowKey,
      { readonly generation: number; readonly present: boolean }
    >();
    for (const [rowKey, membership] of previous) {
      next.set(rowKey, {
        generation: membership.generation,
        present: present.has(rowKey),
      });
    }
    for (const rowKey of present) {
      const old = previous.get(rowKey);
      next.set(rowKey, {
        generation:
          old?.present === true ? old.generation : ++membershipGeneration,
        present: true,
      });
    }
    membershipByPath.set(path, next);
  }

  function membershipGenerationFor(
    path: GridPath,
    rowKey: RowKey,
  ): number | undefined {
    const membership = membershipByPath.get(path)?.get(rowKey);
    return membership?.present ? membership.generation : undefined;
  }

  function onSourceSnapshotChanged(path: GridPath): void {
    const src = sources.get(path);
    if (!src) return;
    cacheSourceState(path, src.state());
    const state = sourceStates.get(path)!;
    const status = state.status;
    const prev = lastStatusByPath.get(path);
    let statusPayload: GridEvents["levelStatusChanged"] | null = null;
    if (prev !== status) {
      lastStatusByPath.set(path, status);
      const error = "error" in state ? state.error : undefined;
      statusPayload = error ? { path, status, error } : { path, status };
    }
    applyAuthoritativeRemovalCleanup(path, state.snapshot.nodes);
    if (disposed) return;
    phantomLifecycle.reconcileBlankAppendPhantoms(path);
    phantomLifecycle.ensureBlankForEmptyPath(path);
    invalidateDisplayedRows(path, { type: "source" });
    resolvePendingLoadedRowsBoundary(path);
    if (statusPayload) emitter.emit("levelStatusChanged", statusPayload);
    notifySourceView(path);
  }

  function notifySourceView(path: GridPath): void {
    if (disposed) return;
    const listeners = sourceViewListeners.get(path);
    if (!listeners) return;
    listeners.notify();
  }

  function notifySourceReconcile(path: GridPath, event: ReconcileEvent): void {
    const listeners = sourceReconcileListeners.get(path);
    if (!listeners) return;
    listeners.notify(event);
  }

  function adaptedLoadResult(
    path: GridPath,
    result: SourceLoadResult,
  ): SourceLoadResult {
    if (result.kind === "superseded" || result.kind === "disposed") {
      return result;
    }
    const state = sourceStates.get(path) ?? result.state;
    if (state.status === "ready") return { kind: "ready", state };
    if (state.status === "initialError" || state.status === "refreshError") {
      return { kind: "error", state };
    }
    return { kind: "unchanged", state };
  }

  function cleanupSafely(cleanup: () => void): void {
    try {
      cleanup();
    } catch (error) {
      reportObserverError(error, args.onObserverError);
    }
  }

  // Eagerly install the root so initial reads (snapshotFor,
  // displayedRowsFor) do not race the first expansion. Root sources
  // never come from `resolveChild`, so a separate code path here keeps
  // `ensureChildSources` focused on the child-path case.
  {
    let src: LevelDataSource | undefined;
    try {
      src = dataSource.rootSource();
      sources.set(root, src);
      levelRegistrations.set(root, Object.freeze({}));
      cacheSourceState(root, src.state());
      lastStatusByPath.set(root, sourceStates.get(root)!.status);
      sourceUnsubs.set(
        root,
        src.subscribe(() => {
          receiveSourceNotification(root);
        }),
      );
      if (src.write) {
        reconcileUnsubs.set(
          root,
          src.write.onReconcile((event) => {
            if (!disposed) {
              emitter.emit("cellReconciled", { path: root, event });
              notifySourceReconcile(root, event);
            }
          }),
        );
      }
      phantomLifecycle.ensureBlankForEmptyPath(root);
      levelRuntimeFor(root);
      notifyRegistryChanged();
    } catch (error) {
      const sourceUnsubscribe = sourceUnsubs.get(root);
      if (sourceUnsubscribe) cleanupSafely(sourceUnsubscribe);
      const reconcileUnsubscribe = reconcileUnsubs.get(root);
      if (reconcileUnsubscribe) cleanupSafely(reconcileUnsubscribe);
      if (src) cleanupSafely(() => src!.dispose());
      cleanupSafely(() => phantoms.dispose());
      cleanupSafely(() => dataSource.dispose());
      emitter.clear();
      throw error;
    }
  }

  function ensureChildSources(parentPath: GridPath, rowId: RowId): void {
    const parentLevelName = levelNameOf(parentPath);
    const childLevels = schemaTopology.childLevelsOf(parentLevelName);
    if (childLevels.length === 0) return;
    const parentRowKey = rowKeyOfRowId(rowId);
    let bumped = false;
    const addedPaths: GridPath[] = [];
    try {
      for (const childLevelName of childLevels) {
        const childPath = makeChildPath(
          parentPath,
          parentRowKey,
          childLevelName,
        );
        if (sources.has(childPath)) continue;
        const src = dataSource.resolveChild(
          parentPath,
          parentRowKey,
          childLevelName,
        );
        sources.set(childPath, src);
        levelRegistrations.set(childPath, Object.freeze({}));
        addedPaths.push(childPath);
        cacheSourceState(childPath, src.state());
        lastStatusByPath.set(childPath, sourceStates.get(childPath)!.status);
        sourceUnsubs.set(
          childPath,
          src.subscribe(() => {
            receiveSourceNotification(childPath);
          }),
        );
        if (src.write) {
          reconcileUnsubs.set(
            childPath,
            src.write.onReconcile((event) => {
              if (!disposed) {
                emitter.emit("cellReconciled", { path: childPath, event });
                notifySourceReconcile(childPath, event);
              }
            }),
          );
        }
        phantomLifecycle.ensureBlankForEmptyPath(childPath);
        levelRuntimeFor(childPath);
        bumped = true;
      }
    } catch (error) {
      for (const path of addedPaths.reverse()) unregisterLevel(path);
      throw error;
    }
    if (bumped) notifyRegistryChanged();
  }

  function snapshotFor(path: GridPath): LevelSnapshot {
    return sourceStateFor(path).snapshot;
  }

  function sourceStateFor(path: GridPath): LevelSourceState {
    assertLevelLive(path);
    const state = sourceStates.get(path);
    if (!state) {
      const root = rootPath(schemaTopology.rootLevelName);
      throw new Error(
        path === root
          ? `GridRuntime: root source for "${path}" is missing. The runtime was initialized inconsistently or has been disposed.`
          : `GridRuntime: no source has been resolved for path "${path}". Expand the parent row first.`,
      );
    }
    return state;
  }

  function schemaForPath(path: GridPath): LevelSchema {
    let s = schemaCache.get(path);
    if (s) return s;
    s = schemaTopology.levelOf(levelNameOf(path));
    schemaCache.set(path, s);
    return s;
  }

  function materializedChildren(
    parentPath: GridPath,
    rowId: RowId,
  ): GridPath[] {
    assertLive();
    const parentLevelName = levelNameOf(parentPath);
    const childLevelNames = schemaTopology.childLevelsOf(parentLevelName);
    if (childLevelNames.length === 0) return [];
    const parentRowKey = rowKeyOfRowId(rowId);
    const out: GridPath[] = [];
    for (const childLevelName of childLevelNames) {
      const cp = makeChildPath(parentPath, parentRowKey, childLevelName);
      if (sources.has(cp)) out.push(cp);
    }
    return out;
  }

  function displayedRowsInputFor(path: GridPath): DisplayedRowsInput {
    return {
      path,
      schema: schemaForPath(path),
      sourceSnapshot: snapshotFor(path),
      phantomRows: phantoms.get(path),
      viewState: EMPTY_DISPLAYED_ROWS_VIEW_STATE,
    };
  }

  // Lazily creates the external store for a path. Source subscriptions are
  // installed when the source is registered; phantom subscriptions are
  // installed here because a path with no displayed-row store has no body
  // readers to notify. Once created, the runtime owns phantom-to-displayed
  // invalidation so body components do not need a second phantom subscription
  // just to keep the displayed-row read models current.
  function displayedRowsStoreFor(path: GridPath): DisplayedRowsStore {
    let store = displayedRowsStoresByPath.get(path);
    if (store) return store;

    store = createDisplayedRowsStore({
      readInput: () => displayedRowsInputFor(path),
      deriveDisplayedRowsState,
      beforeNotify: () => reconcileRowSelection(path),
      onObserverError: args.onObserverError,
    });
    displayedRowsStoresByPath.set(path, store);
    phantomSubscriptionUnsubs.set(
      path,
      phantoms.subscribe(path, () => {
        try {
          invalidateDisplayedRows(path, { type: "phantoms" });
        } catch (error) {
          faultRuntime(error);
        }
      }),
    );
    return store;
  }

  // Imperative snapshot read for code that needs full rows and lookup maps:
  // interaction, navigation, and tests. React body rendering uses the sequence
  // surface below because it must not wake on cell-content edits.
  function displayedRowsFor(path: GridPath): DisplayedRows {
    assertLive();
    return displayedRowsStoreFor(path).getDisplayedRows();
  }

  // React body read: row refs only. The body uses this to mount stable row
  // shells; cell content stays behind `displayedRowFor` so a cell edit is local
  // to the affected row subscriber.
  function displayedRowSequenceFor(path: GridPath): DisplayedRowSequence {
    assertLive();
    return displayedRowsStoreFor(path).getDisplayedRowSequence();
  }

  function displayedRowFor(path: GridPath, rowId: RowId): LevelRow | undefined {
    assertLive();
    return displayedRowsStoreFor(path).getDisplayedRow(rowId);
  }

  function subscribeDisplayedRowSequence(
    path: GridPath,
    fn: () => void,
  ): () => void {
    assertLive();
    return displayedRowsStoreFor(path).subscribeDisplayedRowSequence(fn);
  }

  function subscribeDisplayedRow(
    path: GridPath,
    rowId: RowId,
    fn: () => void,
  ): () => void {
    assertLive();
    return displayedRowsStoreFor(path).subscribeDisplayedRow(rowId, fn);
  }

  function invalidateDisplayedRows(
    path: GridPath,
    reason: DisplayedRowsInvalidationReason,
  ): void {
    const store = displayedRowsStoresByPath.get(path);
    if (!store) {
      return;
    }
    store.invalidateDisplayedRows(reason);
  }

  function reconcileRowSelection(path: GridPath): void {
    const selectedRows = interaction.selectedRows;
    if (
      selectedRows.kind !== "enabled" ||
      selectedRows.sync.kind !== "independent"
    ) {
      return;
    }
    const controller = controllerCursorPortFor(path);
    const current = controller.getState().rowSelection;
    const next = normalizeRowSelection(
      current,
      displayedRowsFor(path),
      selectedRows.mode,
    );
    if (next !== current) cursorManager.setRowSelection(path, next);
  }

  function requestLoadedRowsBoundary(event: LoadedRowsBoundaryEvent): boolean {
    assertLive();
    const existing = pendingLoadedRowsBoundary;
    if (existing && loadedBoundaryIntentEqual(existing.event, event)) {
      return true;
    }
    const src = sources.get(event.loadPath);
    if (!src) return false;
    // While rows are loading, repeated key presses should not skip ahead based
    // on stale counts. Wait until the latest rows are settled before accepting
    // another boundary turn.
    const state = sourceStates.get(event.loadPath)!;
    if (state.status !== "ready") return false;
    const pending = Object.freeze({
      event,
      token: ++loadedRowsBoundaryToken,
    });
    pendingLoadedRowsBoundary = pending;
    let hostLoad: Promise<SourceLoadResult> | false | undefined;
    try {
      hostLoad = args.onLoadedRowsBoundary?.(event);
    } catch (error) {
      pendingLoadedRowsBoundary = null;
      reportObserverError(error, args.onObserverError);
      return false;
    }
    if (!hostLoad) {
      if (pendingLoadedRowsBoundary?.token === pending.token) {
        pendingLoadedRowsBoundary = null;
      }
      return false;
    }
    // The host promise describes the source load, not React paint. Source
    // subscriptions may already have resolved the pending landing before the
    // promise callback runs. Keep both paths legal: a ready promise performs a
    // final sample if needed, and non-ready outcomes clear only the still-live
    // intent.
    void hostLoad.then(
      (result) => {
        if (pendingLoadedRowsBoundary?.token !== pending.token) return;
        if (result.kind === "ready") {
          resolvePendingLoadedRowsBoundary(event.loadPath);
          return;
        }
        pendingLoadedRowsBoundary = null;
      },
      (error: unknown) => {
        if (pendingLoadedRowsBoundary?.token === pending.token) {
          pendingLoadedRowsBoundary = null;
        }
        reportObserverError(error, args.onObserverError);
      },
    );
    return true;
  }

  function resolvePendingLoadedRowsBoundary(path: GridPath): void {
    const pending = pendingLoadedRowsBoundary;
    if (!pending || pending.event.loadPath !== path) return;
    const event = pending.event;

    const state = sourceStates.get(path)!;
    // Keep the requested landing while the next page loads. If the load fails,
    // leave the cursor where the user started instead of moving it during a
    // later, unrelated refresh.
    if (state.status === "initialLoading" || state.status === "refreshing") {
      return;
    }
    if (state.status !== "ready") {
      pendingLoadedRowsBoundary = null;
      return;
    }

    if (event.kind === "cell") {
      const target = pendingLoadedRowsBoundaryCellTarget(event);
      pendingLoadedRowsBoundary = null;
      if (!target) return;
      if (event.extend) {
        cursorManager.extendCellSelectionTo(target);
      } else {
        cursorManager.moveCellCursorTo(target);
      }
      controllerCursorPortFor(target.path).revealCell({
        rowId: target.rowId,
        colId: target.colId,
      });
      return;
    }

    const target = pendingLoadedRowsBoundaryRowTarget(event);
    pendingLoadedRowsBoundary = null;
    if (!target) return;
    if (event.extend) {
      cursorManager.extendRowSelectionToCursor(target);
    } else {
      cursorManager.moveRowCursorTo(target);
    }
    controllerCursorPortFor(target.path).revealRow(target.rowId);
  }

  function pendingLoadedRowsBoundaryCellTarget(
    pending: Extract<LoadedRowsBoundaryEvent, { kind: "cell" }>,
  ): CellCursor | null {
    const displayed = displayedRowsFor(pending.loadPath);
    // After an "after" boundary load, continue at the first focusable row;
    // after a "before" boundary load, continue at the last. Keep the same
    // column rule the user gets from Tab, Arrow, and Page keys inside the
    // current loaded window.
    const row =
      pending.direction === "after"
        ? firstFocusableRow(displayed, capabilitiesFor)
        : lastFocusableRow(displayed, capabilitiesFor);
    if (!row) return null;
    const colId = resolvePendingLoadedRowsBoundaryColumn(
      schemaForPath(pending.loadPath),
      pending.origin.colId,
      pending.colPolicy,
    );
    return colId ? { path: pending.loadPath, rowId: row.id, colId } : null;
  }

  function pendingLoadedRowsBoundaryRowTarget(
    pending: Extract<LoadedRowsBoundaryEvent, { kind: "row" }>,
  ): RowCursor | null {
    const rows = displayedRowsFor(pending.loadPath).rows;
    // Row-list pages can include visible rows that are not operation targets.
    // After paging, land on the first or last selectable row so bulk actions
    // and keyboard focus keep pointing at rows the app can actually use.
    if (pending.direction === "after") {
      const row = rows.find((candidate) => candidate.rowSelectable);
      return row ? { path: pending.loadPath, rowId: row.id } : null;
    }
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.rowSelectable) return { path: pending.loadPath, rowId: row.id };
    }
    return null;
  }

  function resolvePendingLoadedRowsBoundaryColumn(
    levelSchema: LevelSchema,
    sourceColId: ColId,
    policy: ColPolicy,
  ): ColId | null {
    const columns = levelSchema.columns;
    if (columns.length === 0) return null;
    if (policy === "first") return columns[0].id;
    if (policy === "last") return columns[columns.length - 1].id;
    return columns.some((column) => column.id === sourceColId)
      ? sourceColId
      : columns[0].id;
  }

  function sourceFor(path: GridPath): RuntimeLevelDataSource {
    assertLevelLive(path);
    const registration = levelRegistrations.get(path);
    if (!registration) {
      throw new Error("Grid level is no longer registered.");
    }
    const src = sources.get(path);
    if (!src) {
      const root = rootPath(schemaTopology.rootLevelName);
      throw new Error(
        path === root
          ? `GridRuntime: root source for "${path}" is missing. The runtime was initialized inconsistently or has been disposed.`
          : `GridRuntime: no source has been resolved for path "${path}". Expand the parent row first.`,
      );
    }
    let view = sourceViews.get(path);
    if (view) return view;
    const sourceQuery = src.query;
    // Runtime views wrap source capabilities so callers cannot hold a stale
    // source object after disposal and cannot reach write verbs directly.
    // Query commands are exposed because they are source loads; mutations still
    // go through runtime methods so `mutationCommitted` remains the single
    // user-attributable mutation channel.
    const query: LevelQueryCapabilities | undefined = sourceQuery
      ? {
          ...(sourceQuery.sort
            ? {
                sort: Object.freeze({
                  current: () => {
                    assertLevelRegistrationLive(path, registration);
                    return sourceQuery.sort!.current();
                  },
                  set: (sort) => {
                    return runOperation(async () => {
                      assertLevelRegistrationLive(path, registration);
                      return adaptedLoadResult(
                        path,
                        await sourceQuery.sort!.set(sort),
                      );
                    });
                  },
                }),
              }
            : {}),
          ...(sourceQuery.filter
            ? {
                filter: Object.freeze({
                  current: () => {
                    assertLevelRegistrationLive(path, registration);
                    return sourceQuery.filter!.current();
                  },
                  set: (filter) => {
                    return runOperation(async () => {
                      assertLevelRegistrationLive(path, registration);
                      return adaptedLoadResult(
                        path,
                        await sourceQuery.filter!.set(filter),
                      );
                    });
                  },
                }),
              }
            : {}),
          ...(sourceQuery.refetch
            ? {
                refetch: () => {
                  return runOperation(async () => {
                    assertLevelRegistrationLive(path, registration);
                    return adaptedLoadResult(
                      path,
                      await sourceQuery.refetch!(),
                    );
                  });
                },
              }
            : {}),
        }
      : undefined;
    const stableQuery = query ? Object.freeze(query) : undefined;
    view = Object.freeze({
      get canWrite() {
        assertLevelRegistrationLive(path, registration);
        return src.write !== undefined;
      },
      state: () => {
        assertLevelRegistrationLive(path, registration);
        return sourceStateFor(path);
      },
      subscribe: (fn) => {
        assertLevelRegistrationLive(path, registration);
        let listeners = sourceViewListeners.get(path);
        if (!listeners) {
          listeners = createObserverList(args.onObserverError);
          sourceViewListeners.set(path, listeners);
        }
        const unsubscribe = listeners.subscribe(fn);
        return () => {
          unsubscribe();
          if (listeners!.size() === 0) sourceViewListeners.delete(path);
        };
      },
      ...(stableQuery ? { query: stableQuery } : {}),
      onReconcile(fn) {
        assertLevelRegistrationLive(path, registration);
        if (!src.write) return () => {};
        let listeners = sourceReconcileListeners.get(path);
        if (!listeners) {
          listeners = createObserverList(args.onObserverError);
          sourceReconcileListeners.set(path, listeners);
        }
        const unsubscribe = listeners.subscribe(fn);
        return () => {
          unsubscribe();
          if (listeners!.size() === 0) sourceReconcileListeners.delete(path);
        };
      },
    });
    sourceViews.set(path, view);
    return view;
  }

  function requireWritable(path: GridPath): {
    source: LevelDataSource;
    write: WriteCapability;
  } {
    assertLive();
    const src = sources.get(path);
    if (!src) {
      throw new Error(
        `GridRuntime: no source has been resolved for path "${path}". Expand the parent row first.`,
      );
    }
    if (!src.write) {
      throw new Error(
        `GridRuntime: source for path "${path}" is readonly — writeCell/applyChanges/createRow/removeRow are not available.`,
      );
    }
    if (identityErrorPaths.has(path)) {
      throw new Error(
        `GridRuntime: source for path "${path}" has invalid row identity and cannot be mutated.`,
      );
    }
    // Capture the capability object once for this command. A source should not
    // swap write capabilities while a command is running; if it changes
    // writability, it should publish a new source lifecycle through its host.
    return { source: src, write: src.write };
  }

  function writeCell(path: GridPath, coord: Coord, value: unknown): void {
    const { source, write } = requireWritable(path);
    const row = displayedRowsFor(path).rowById.get(coord.rowId);
    if (!row) {
      throw new Error(
        `GridRuntime.writeCell: no displayed row "${coord.rowId}" at path "${path}".`,
      );
    }
    if (row.kind === "phantom") {
      const phantomKey = phantomKeyFromDisplayedRowId(coord.rowId);
      if (!phantomKey) {
        throw new Error(
          `GridRuntime.writeCell: malformed phantom row id "${coord.rowId}".`,
        );
      }
      phantomLifecycle.setPhantomCell(path, phantomKey, coord.colId, value);
      return;
    }
    if (row.kind !== "data") {
      throw new Error(
        `GridRuntime.writeCell: row "${coord.rowId}" is ${row.kind}, not editable data.`,
      );
    }
    const rowKey = rowKeyOfRowId(coord.rowId);
    const oldValue = readCellValue(
      sourceStates.get(path)!.snapshot,
      rowKey,
      coord.colId,
    );
    write.setCell(rowKey, coord.colId, value);
    emitter.emit("mutationCommitted", {
      kind: "cell",
      path,
      coord,
      oldValue,
      newValue: value,
    });
  }

  // If the user has selected multiple cells (of the same column, across many rows),
  // then a change made to a single cell inside it, is expected to replace the values
  // of all other cells (of the same column) in the selection as well. Example:
  // when I'm editing Draft Transactions, and want to mass-replace the target account for
  // a set of entries (that I've filtered to be of the same type), then I want to be able
  // to just select all of them, and make a single change and have it fan-out.
  //
  // This function does that; the existing public `writeCell` deliberately does not fan-out.
  function writeCellOrSelectedColumnCells(
    path: GridPath,
    coord: Coord,
    value: unknown,
  ): void {
    const selection = controllerCursorPortFor(path).getState().cellSelection;

    // No selection, just a single cell; or selection exist, but they span multiple
    // columns. In both cases, do the regular single cell update.
    if (
      !selection ||
      selection.anchor.colId !== selection.head.colId ||
      selection.anchor.colId !== coord.colId
    ) {
      writeCell(path, coord, value);
      return;
    }

    const displayed = displayedRowsFor(path);
    const selectedRowIds = rowsInSelection(selection, displayed);
    if (selectedRowIds.length <= 1 || !selectedRowIds.includes(coord.rowId)) {
      writeCell(path, coord, value);
      return;
    }

    requireWritable(path);

    // Keep source-backed data rows in one batched mutation event, while phantom
    // rows stay in the local phantom channel and do not emit mutationCommitted.
    const changes: CellChange[] = [];
    for (const rowId of selectedRowIds) {
      const row = displayed.rowById.get(rowId);
      if (!row || !capabilitiesFor(row.kind).editable) continue;

      if (row.kind === "data") {
        changes.push({
          rowKey: rowKeyOfRowId(rowId),
          colId: coord.colId,
          value,
        });
        continue;
      }

      if (row.kind === "phantom") {
        const phantomKey = phantomKeyFromDisplayedRowId(rowId);
        if (!phantomKey) continue;
        phantomLifecycle.setPhantomCell(path, phantomKey, coord.colId, value);
      }
    }

    if (changes.length > 0) applyChanges(path, changes);
  }

  function commitPhantomRow(
    path: GridPath,
    rowKey: RowKey,
    atIndex?: number,
  ): Promise<CreateNodeResult> {
    if (disposed) {
      return Promise.reject(new Error("GridRuntime has been disposed."));
    }
    if (!sources.has(path)) {
      return Promise.reject(new Error("Grid level is no longer registered."));
    }
    const pendingKey = phantomCreateKey(path, rowKey);
    const pending = pendingPhantomCreates.get(pendingKey);
    if (pending) return pending.promise;

    const promise = runOperation(async () => {
      assertLevelRegisteredForOperation(path);
      requireDraftEligibility(path);
      const phantom = phantoms.get(path).find((p) => p.rowKey === rowKey);
      if (!phantom) {
        throw new Error(
          `GridRuntime.commitPhantomRow: no phantom with rowKey "${rowKey}" at path "${path}".`,
        );
      }
      if (phantom.state.kind === "saving") {
        throw new Error(
          `GridRuntime.commitPhantomRow: phantom with rowKey "${rowKey}" at path "${path}" is already saving.`,
        );
      }
      if (phantomLifecycle.isBlank(phantom.columns)) {
        throw new Error(
          `GridRuntime.commitPhantomRow: phantom with rowKey "${rowKey}" at path "${path}" is blank.`,
        );
      }
      phantoms.setState(path, rowKey, { kind: "saving" });
      const node: TreeNode = {
        rowKey,
        levelName: schemaForPath(path).name,
        columns: { ...phantom.columns },
      };
      try {
        const result = await createRow(path, node, atIndex);
        phantoms.remove(path, rowKey);
        if (!disposed) {
          emitter.emit("phantomRowCommitted", { path, rowKey, ...result });
        }
        return result;
      } catch (err) {
        const reason = reasonOf(err);
        phantoms.setState(path, rowKey, { kind: "failed", reason });
        if (!disposed) {
          emitter.emit("phantomRowCreateFailed", { path, rowKey, reason });
        }
        throw err;
      } finally {
        pendingPhantomCreates.delete(pendingKey);
      }
    });
    pendingPhantomCreates.set(pendingKey, { promise });
    return promise;
  }

  function applyChanges(path: GridPath, changes: readonly CellChange[]): void {
    const { source, write } = requireWritable(path);
    const snapshot = sourceStates.get(path)!.snapshot;
    // Read prior values BEFORE the source applies the change. Once
    // applyChanges returns, the snapshot reflects the writes and the prior
    // values are unavailable for mutation events.
    const priors = changes.map((c) =>
      readCellValue(snapshot, c.rowKey, c.colId),
    );
    write.applyChanges(changes);
    const edits = changes.map((c, i) => ({
      coord: { rowId: makeRowId(path, c.rowKey), colId: c.colId },
      oldValue: priors[i],
      newValue: c.value,
    }));
    emitter.emit("mutationCommitted", { kind: "cells", path, edits });
  }

  async function createRow(
    path: GridPath,
    node: TreeNode,
    atIndex?: number,
  ): Promise<CreateNodeResult> {
    const { write } = requireWritable(path);
    const existingKeys = assertCreateNode(path, node);
    const result = await write.createNode(node, atIndex);
    try {
      assertAuthoritativeCreatedNode(path, result.node, existingKeys);
    } catch (error) {
      faultRuntime(error);
      return result;
    }
    if (!disposed) {
      emitter.emit("mutationCommitted", {
        kind: "insert",
        path,
        node: result.node,
        atIndex: result.atIndex,
      });
    }
    return result;
  }

  function assertCreateNode(
    path: GridPath,
    node: TreeNode,
  ): ReadonlySet<RowKey> {
    const schema = schemaForPath(path);
    if (node.levelName !== schema.name) {
      throw new Error(
        `GridRuntime.createRow: node levelName "${node.levelName}" does not match level "${schema.name}".`,
      );
    }
    rowKeyOfTreeNode(node, "GridRuntime.createRow");
    const nodes = sourceStates.get(path)!.snapshot.nodes;
    assertTreeNodeCanBeInserted(nodes, node, "GridRuntime.createRow");
    return new Set(nodes.map((existing) => existing.rowKey));
  }

  function assertAuthoritativeCreatedNode(
    path: GridPath,
    node: TreeNode,
    existingKeys: ReadonlySet<RowKey>,
  ): void {
    const schema = schemaForPath(path);
    if (node.levelName !== schema.name) {
      throw new Error(
        `GridRuntime.createRow: source returned levelName "${node.levelName}" for level "${schema.name}".`,
      );
    }
    const rowKey = rowKeyOfTreeNode(
      node,
      "GridRuntime.createRow authoritative result",
    );
    if (existingKeys.has(rowKey)) {
      throw new Error(
        `GridRuntime.createRow: source returned duplicate TreeNode.rowKey "${rowKey}".`,
      );
    }
  }

  async function removeRow(path: GridPath, rowKey: RowKey): Promise<void> {
    const { source, write } = requireWritable(path);
    const { node, index } = readNodeWithIndex(
      sourceStates.get(path)!.snapshot,
      rowKey,
    );
    await write.removeNode(rowKey);
    if (!disposed) {
      emitter.emit("mutationCommitted", {
        kind: "remove",
        path,
        node,
        atIndex: index,
      });
    }
  }

  // Coordinator reads runtime state through `getRuntime` — it never holds
  // a derived view, so a freshly resolved child source or a freshly
  // applied sort is reflected on the next call without explicit
  // invalidation. The reference is late-bound because the runtime
  // object is built below.
  let runtimeRef: GridRuntimeInternals | null = null;
  let cursorManagerRef: CursorManagerInternal | null = null;
  const coordinator: GridCoordinatorStore = createGridCoordinator({
    getRuntime: () => {
      if (!runtimeRef) {
        throw new Error(
          "GridRuntime: coordinator queried before runtime was constructed",
        );
      }
      return runtimeRef;
    },
    getCursorManager: () => {
      if (!cursorManagerRef) {
        throw new Error(
          "GridRuntime: coordinator queried cursor manager before runtime was constructed",
        );
      }
      return cursorManagerRef;
    },
    capabilitiesFor,
    onExpand: (path, rowId) => ensureChildSources(path, rowId),
  });

  const cursorManager = createCursorManager({
    interaction,
    coordinator,
    controllerCursorPortFor: (path) => controllerCursorPortFor(path),
    displayedRowsFor,
    onCellCursorChanging: phantomLifecycle.onCellCursorChanging,
    onRowCursorChanging: phantomLifecycle.onRowCursorChanging,
  });
  cursorManagerRef = cursorManager;
  let cursorRevision = 0;
  const unsubscribeCursorRevision = coordinator.subscribe((state, previous) => {
    if (
      state.cellCursor !== previous.cellCursor ||
      state.rowCursor !== previous.rowCursor
    ) {
      cursorRevision += 1;
    }
  });

  function cursorContinuationRows(
    removalsByPath: ReadonlyMap<GridPath, ReadonlySet<RowId>>,
  ): CursorContinuationRow[] {
    if (!runtimeRef) {
      throw new Error(
        "GridRuntime: cursor continuation requested before runtime construction completed.",
      );
    }
    return Array.from(visibleRows(runtimeRef, coordinator, root)).map(
      ({ path, rowId }) => {
        const row = displayedRowFor(path, rowId);
        const rowCapabilities = row ? capabilitiesFor(row.kind) : null;
        return {
          path,
          rowId,
          survivesRemoval: rowSurvivesRemoval(path, rowId, removalsByPath),
          cellFocusable: rowCapabilities?.focusable ?? false,
          rowSelectable: row?.rowSelectable ?? false,
          colIds: schemaForPath(path).columns.map((column) => column.id),
        };
      },
    );
  }

  function rowSurvivesRemoval(
    path: GridPath,
    rowId: RowId,
    removalsByPath: ReadonlyMap<GridPath, ReadonlySet<RowId>>,
  ): boolean {
    if (removalsByPath.get(path)?.has(rowId)) return false;

    let currentPath = path;
    let edge = trailingEdge(currentPath);
    while (edge) {
      const parentRowId = makeRowId(edge.parentPath, edge.parentRowKey);
      if (removalsByPath.get(edge.parentPath)?.has(parentRowId)) return false;
      currentPath = edge.parentPath;
      edge = trailingEdge(currentPath);
    }
    return true;
  }

  function planCursorContinuationForRowRemoval(
    removals: readonly RowRemovalRef[],
  ): CursorContinuation {
    assertLive();
    const removalsByPath = new Map<GridPath, Set<RowId>>();
    for (const removal of removals) {
      const ids = removalsByPath.get(removal.path) ?? new Set<RowId>();
      ids.add(removal.rowId);
      removalsByPath.set(removal.path, ids);
    }
    const rows = cursorContinuationRows(removalsByPath);
    const state = coordinator.getState();
    return interaction.mode === "cell-grid"
      ? planCursorContinuation({
          mode: "cell-grid",
          rows,
          cellCursor: state.cellCursor,
          rowSelectionLead: state.rowSelectionLead,
          fallbackPath: root,
        })
      : planCursorContinuation({
          mode: "row-list",
          rows,
          rowCursor: state.rowCursor,
          rowSelectionLead: state.rowSelectionLead,
          fallbackPath: root,
        });
  }

  function applyCursorContinuation(continuation: CursorContinuation): void {
    assertLive();
    if (continuation.kind === "cell") {
      if (interaction.mode !== "cell-grid") {
        throw new Error(
          "GridRuntime.applyCursorContinuation: cell landing requires cell-grid interaction.",
        );
      }
      const alreadyThere = cursorEqual(
        cursorManager.currentCellCursor(),
        continuation.target,
      );
      cursorManager.applyCellCursor(continuation.target);
      const controller = controllerCursorPortFor(continuation.target.path);
      if (alreadyThere) controller.queueEffect({ type: "focusContainer" });
      controller.revealCell({
        rowId: continuation.target.rowId,
        colId: continuation.target.colId,
      });
      return;
    }
    if (continuation.kind === "row") {
      if (interaction.mode !== "row-list") {
        throw new Error(
          "GridRuntime.applyCursorContinuation: row landing requires row-list interaction.",
        );
      }
      const alreadyThere = rowCursorEqual(
        cursorManager.currentRowCursor(),
        continuation.target,
      );
      cursorManager.applyRowCursor(continuation.target);
      const controller = controllerCursorPortFor(continuation.target.path);
      if (alreadyThere) controller.queueEffect({ type: "focusContainer" });
      controller.revealRow(continuation.target.rowId);
      return;
    }

    if (interaction.mode === "cell-grid") cursorManager.clearCellCursor();
    else cursorManager.clearRowCursor();
    controllerCursorPortFor(continuation.path).queueEffect({
      type: "focusContainer",
    });
  }

  function controllerCursorPortFor(path: GridPath): GridControllerStore {
    let c = controllers.get(path);
    if (c) return c;
    c = createGridController({
      path,
      interaction,
      getDisplayed: () => displayedRowsFor(path),
      getSchema: () => schemaForPath(path).columns,
      capabilitiesFor,
      onNavigateCell: (intent) => {
        coordinator.navigateCell(path, intent);
      },
      onNavigateRow: (intent) => {
        coordinator.navigateRow(path, intent);
      },
      clearCellRange: (path) => cursorManager.clearCellRange(path),
      clearRowSelection: (path) => cursorManager.clearRowSelection(path),
      writeValue: (coord, newValue) => {
        writeCellOrSelectedColumnCells(path, coord, newValue);
      },
      activateCell: (coord, trigger) => {
        activateCell(path, coord, trigger);
      },
    });
    controllers.set(path, c);
    const unsub = c.subscribe((s, prev) => {
      if (s.cellSelection !== prev.cellSelection) {
        emitter.emit("cellSelectionChanged", {
          path,
          selection: s.cellSelection,
        });
      }
      if (s.rowSelection !== prev.rowSelection) {
        emitter.emit("rowSelectionChanged", {
          path,
          selection: s.rowSelection,
        });
      }
    });
    controllerUnsubs.set(path, unsub);
    return c;
  }

  function controllerFor(path: GridPath): GridControllerPublic {
    assertLive();
    return controllerCursorPortFor(path);
  }

  function activationActions(): CellActionApi {
    return {
      rowExpansion: {
        canToggle: ({ path, row }) =>
          schemaForPath(path).childLevels.length > 0 &&
          capabilitiesFor(row.kind).canExpand,
        isExpanded: ({ path, rowId }) =>
          coordinator.getState().expansion.get(path)?.has(rowId) ?? false,
        toggle: ({ path, rowId }) => {
          const row = displayedRowsFor(path).rowById.get(rowId);
          if (!row) return;
          if (!activationActions().rowExpansion.canToggle({ path, row }))
            return;
          coordinator.toggleExpand(path, rowId);
        },
      },
    };
  }

  function activateCell(
    path: GridPath,
    coord: Coord,
    trigger: CellActivationTrigger,
  ): void {
    assertLive();
    const target = activationTarget(path, coord, trigger);
    if (!target) return;
    const { activation, context } = target;
    const state = describeCellActivation(activation, context);
    if (state.availability.kind === "disabled") return;
    try {
      const result = activation.run(context);
      if (isPromiseLike(result)) {
        void result.catch((error: unknown) => {
          emitter.emit("cellActivationError", {
            path,
            coord,
            trigger,
            error,
          });
        });
      }
    } catch (error) {
      emitter.emit("cellActivationError", {
        path,
        coord,
        trigger,
        error,
      });
    }
  }

  function cellActivationFor(
    path: GridPath,
    coord: Coord,
    trigger: CellActivationTrigger = {
      kind: "pointer",
      gesture: "click",
    },
  ): CellRenderActivation | null {
    const target = activationTarget(path, coord, trigger);
    if (!target) return null;
    const state = describeCellActivation(target.activation, target.context);
    return {
      label: state.label,
      availability: state.availability,
      run: () => activateCell(path, coord, trigger),
    };
  }

  function activationTarget(
    path: GridPath,
    coord: Coord,
    trigger: CellActivationTrigger,
  ): {
    activation: NonNullable<LevelSchema["columns"][number]["activation"]>;
    context: CellActivationContext;
  } | null {
    const column = schemaForPath(path).columns.find(
      (c) => c.id === coord.colId,
    );
    if (!column?.activation) return null;
    const row = displayedRowsFor(path).rowById.get(coord.rowId);
    if (!row) return null;
    const value = row.columns[column.id];
    return {
      activation: column.activation,
      context: {
        trigger,
        value,
        row,
        column: {
          id: column.id,
          name: column.name,
          meta: column.meta,
        },
        path,
        coord,
        actions: activationActions(),
      },
    };
  }

  function activeRowForPath(path: GridPath): RowCursor | null {
    const controller = controllerCursorPortFor(path);
    const active = activeRowFor(
      interaction,
      coordinator.getState().cellCursor,
      controller.getState().liveRowFocus,
      path,
    );
    const next = active?.path === path ? active : null;
    const prev = activeRowSnapshots.get(path) ?? null;
    if (rowCursorSnapshotEqual(prev, next)) return prev;
    activeRowSnapshots.set(path, next);
    return next;
  }

  function selectedRowsForPath(path: GridPath): RowSelection {
    const controller = controllerCursorPortFor(path);
    const next = selectedRowsFor(
      interaction,
      activeRowForPath(path),
      controller.getState().rowSelection,
    );
    const prev = selectedRowsSnapshots.get(path) ?? null;
    if (rowSelectionExactEqual(prev, next)) return prev;
    selectedRowsSnapshots.set(path, next);
    return next;
  }

  function selectedRowIds(path: GridPath): readonly RowId[] {
    const projected = rowIdsInRowSelection(
      selectedRowsForPath(path),
      displayedRowsFor(path),
    );
    const next = projected.length === 0 ? emptyRowIds : projected;
    const prev = selectedRowIdSnapshots.get(path) ?? emptyRowIds;
    if (rowIdSnapshotsEqual(prev, next)) return prev;
    selectedRowIdSnapshots.set(path, next);
    return next;
  }

  function rowInteractionSnapshotForPath(
    path: GridPath,
  ): RowInteractionSnapshot {
    const active = activeRowForPath(path);
    const activeRowId = active?.rowId ?? null;
    const selectedIds = selectedRowIds(path);
    const prev = rowInteractionSnapshots.get(path);
    if (
      prev?.activeRowId === activeRowId &&
      prev.selectedRowIds === selectedIds
    ) {
      return prev;
    }
    const statusByRowId = new Map<RowId, RowInteractionStatus>();
    for (const rowId of selectedIds) {
      statusByRowId.set(rowId, "selected");
    }
    if (activeRowId) {
      statusByRowId.set(
        activeRowId,
        statusByRowId.has(activeRowId) ? "cursor-selected" : "cursor",
      );
    }
    const next = {
      activeRowId,
      selectedRowIds: selectedIds,
      statusByRowId,
    };
    rowInteractionSnapshots.set(path, next);
    return next;
  }

  function rowOperationTargetsForPath(
    path: GridPath,
  ): readonly RowOperationTarget[] {
    // Command target projection for one path. Toolbar actions use this to turn
    // stored row selection, or a cell range when no rows are selected, into the
    // rows the command should affect.
    const explicit = rowOperationTargetsFromRowIds(path, selectedRowIds(path));
    if (explicit.length > 0) return explicit;

    const selection = controllerCursorPortFor(path).getState().cellSelection;
    if (!selection) return emptyRowOperationTargets;
    return rowOperationTargetsFromRowIds(
      path,
      rowsInSelection(selection, displayedRowsFor(path)),
    );
  }

  function rowOperationTargetsFromRowIds(
    path: GridPath,
    rowIds: readonly RowId[],
  ): readonly RowOperationTarget[] {
    // Resolve candidate ids through displayed row state so commands only target
    // rows that still exist, are visible, and are valid row-operation targets.
    if (rowIds.length === 0) return emptyRowOperationTargets;
    const displayed = displayedRowsFor(path);
    const targets: RowOperationTarget[] = [];
    for (const rowId of rowIds) {
      const row = displayed.rowById.get(rowId);
      if (!row?.rowSelectable) continue;
      targets.push({
        path,
        rowId,
        rowKey: rowKeyOfRowId(rowId),
        row,
      });
    }
    return targets.length === 0 ? emptyRowOperationTargets : targets;
  }

  function subscribeActiveRow(path: GridPath, fn: () => void): () => void {
    if (
      interaction.mode === "cell-grid" &&
      interaction.activeRow.kind === "from-active-cell"
    ) {
      let prev = activeRowForPath(path);
      return coordinator.subscribe(() => {
        const next = activeRowForPath(path);
        if (rowCursorSnapshotEqual(prev, next)) return;
        prev = next;
        fn();
      });
    }
    if (interaction.mode === "row-list") {
      const controller = controllerCursorPortFor(path);
      let prev = activeRowForPath(path);
      return controller.subscribe(() => {
        const next = activeRowForPath(path);
        if (rowCursorSnapshotEqual(prev, next)) return;
        prev = next;
        fn();
      });
    }
    return () => {};
  }

  function subscribeSelectedRows(path: GridPath, fn: () => void): () => void {
    const selectedRows = interaction.selectedRows;
    if (selectedRows.kind === "none") return () => {};
    let prev = selectedRowsForPath(path);
    const maybeNotify = () => {
      const next = selectedRowsForPath(path);
      if (rowSelectionExactEqual(prev, next)) return;
      prev = next;
      fn();
    };
    if (selectedRows.sync.kind === "follows-active-row") {
      return subscribeActiveRow(path, maybeNotify);
    }
    return controllerCursorPortFor(path).subscribe((s, previous) => {
      if (s.rowSelection !== previous.rowSelection) maybeNotify();
    });
  }

  function subscribeSelectedRowIds(path: GridPath, fn: () => void): () => void {
    const selectedRows = interaction.selectedRows;
    if (selectedRows.kind === "none") return () => {};
    let prev = selectedRowIds(path);
    const maybeNotify = () => {
      const next = selectedRowIds(path);
      if (rowIdSnapshotsEqual(prev, next)) return;
      prev = next;
      fn();
    };
    const unsubSelected = subscribeSelectedRows(path, maybeNotify);
    const unsubDisplayed = subscribeDisplayedRowSequence(path, maybeNotify);
    return () => {
      unsubSelected();
      unsubDisplayed();
    };
  }

  function subscribeRowInteractionSnapshot(
    path: GridPath,
    fn: () => void,
  ): () => void {
    let prev = rowInteractionSnapshotForPath(path);
    const maybeNotify = () => {
      const next = rowInteractionSnapshotForPath(path);
      if (prev === next) return;
      prev = next;
      fn();
    };
    const unsubs: Array<() => void> = [];
    const activeRowCanChange =
      interaction.mode === "row-list" ||
      (interaction.mode === "cell-grid" &&
        interaction.activeRow.kind === "from-active-cell");
    if (activeRowCanChange) {
      unsubs.push(subscribeActiveRow(path, maybeNotify));
    }
    const selectedRows = interaction.selectedRows;
    if (selectedRows.kind === "enabled") {
      if (selectedRows.sync.kind === "independent") {
        unsubs.push(subscribeSelectedRowIds(path, maybeNotify));
      } else {
        unsubs.push(subscribeDisplayedRowSequence(path, maybeNotify));
      }
    }
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  function recordRowSelectionLead(path: GridPath, rowId: RowId): void {
    const selection = controllerCursorPortFor(path).getState().rowSelection;
    if (!rowSelectionHasRow(selection, rowId, displayedRowsFor(path))) return;
    coordinator.setRowSelectionLead({ path, rowId });
  }

  const rowInteraction: RowInteractionCommands = {
    setRowCursor(target) {
      if (interaction.mode !== "row-list") return;
      if (
        !displayedRowsFor(target.path).rowById.get(target.rowId)?.rowSelectable
      )
        return;
      cursorManager.moveRowCursorTo(target);
    },
    clearRowCursor() {
      if (interaction.mode !== "row-list") return;
      cursorManager.clearRowCursor();
    },
    selectRow(path, rowId) {
      cursorManager.setRowSelection(path, makeSingleRowSelection(rowId));
      recordRowSelectionLead(path, rowId);
    },
    setRowSelection(path, selection) {
      cursorManager.setRowSelection(path, selection);
    },
    toggleRowSelection(path, rowId) {
      const displayed = displayedRowsFor(path);
      if (!displayed.rowById.get(rowId)?.rowSelectable) return;
      const config = interaction.selectedRows;
      if (config.kind !== "enabled" || config.sync.kind !== "independent")
        return;
      const current = controllerCursorPortFor(path).getState().rowSelection;
      if (config.mode === "single") {
        const selecting = !rowSelectionHasRow(current, rowId, displayed);
        cursorManager.setRowSelection(
          path,
          selecting ? makeSingleRowSelection(rowId) : null,
        );
        if (selecting) recordRowSelectionLead(path, rowId);
        return;
      }
      // Multi/range toggles rebuild from displayed-order projection. That
      // keeps the stored Set independent of insertion order and automatically
      // drops rows that are no longer displayed or row-selectable.
      const ids = new Set(rowIdsInRowSelection(current, displayed));
      if (ids.has(rowId)) ids.delete(rowId);
      else ids.add(rowId);
      cursorManager.setRowSelection(path, makeRowSetSelection(ids));
      if (ids.has(rowId)) {
        recordRowSelectionLead(path, rowId);
      }
    },
    extendRowSelectionTo(path, rowId) {
      const displayed = displayedRowsFor(path);
      if (!displayed.rowById.get(rowId)?.rowSelectable) return;
      const current = controllerCursorPortFor(path).getState().rowSelection;
      const currentCursor = cursorManager.currentRowCursor();
      // Pointer/checkbox shift-extension is a selection command, not a cursor
      // command. Prefer an existing range anchor, then a single selected row,
      // then the current row cursor on this path, and finally the clicked row.
      const anchor =
        current?.kind === "range"
          ? current.anchor
          : current?.kind === "single"
            ? current.rowId
            : currentCursor?.path === path
              ? currentCursor.rowId
              : rowId;
      cursorManager.setRowSelection(path, makeRowRangeSelection(anchor, rowId));
      recordRowSelectionLead(path, rowId);
    },
    extendRowSelectionToCursor(target) {
      if (interaction.mode !== "row-list") return;
      cursorManager.extendRowSelectionToCursor(target);
    },
    clearRowSelection(path) {
      cursorManager.clearRowSelection(path);
    },
  };

  function levelRuntimeFor(path: GridPath): GridLevelRuntime {
    const existing = levelsByPath.get(path);
    if (existing) return existing;
    const registration = levelRegistrations.get(path);
    if (!sources.has(path) || !registration) {
      throw new Error("Grid level is no longer registered.");
    }

    const observe = (listener: () => void): (() => void) =>
      isolateObserver(listener);
    const level = createGridLevelRuntime({
      path,
      schema: schemaForPath(path),
      data: sourceFor(path),
      assertLive: () => assertLevelRegistrationLive(path, registration),
      isLive: () =>
        !disposed &&
        !runtimeFault &&
        sources.has(path) &&
        levelRegistrations.get(path) === registration,
      onObserverError: (error) =>
        reportObserverError(error, args.onObserverError),
      ports: {
        displayedRows: () => {
          assertLevelLive(path);
          return displayedRowsFor(path);
        },
        displayedRowSequence: () => {
          assertLevelLive(path);
          return displayedRowSequenceFor(path);
        },
        displayedRow: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          return displayedRowFor(path, rowId);
        },
        dataRowTarget: (rowId) => {
          assertLevelLive(path);
          const operations = requireRowOperationsController();
          return operations.targetForKind(path, rowId, "data");
        },
        subscribeDisplayedRowSequence: (listener) => {
          assertLevelLive(path);
          return subscribeDisplayedRowSequence(path, observe(listener));
        },
        subscribeDisplayedRow: (rowId, listener) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          return subscribeDisplayedRow(path, rowId, observe(listener));
        },
        activeRow: () => {
          assertLevelLive(path);
          return activeRowForPath(path);
        },
        selectedRows: () => {
          assertLevelLive(path);
          return selectedRowsForPath(path);
        },
        selectedRowIds: () => {
          assertLevelLive(path);
          return selectedRowIds(path);
        },
        rowInteractionSnapshot: () => {
          assertLevelLive(path);
          return rowInteractionSnapshotForPath(path);
        },
        subscribeActiveRow: (listener) => {
          assertLevelLive(path);
          return subscribeActiveRow(path, observe(listener));
        },
        subscribeSelectedRows: (listener) => {
          assertLevelLive(path);
          return subscribeSelectedRows(path, observe(listener));
        },
        subscribeSelectedRowIds: (listener) => {
          assertLevelLive(path);
          return subscribeSelectedRowIds(path, observe(listener));
        },
        subscribeRowInteractionSnapshot: (listener) => {
          assertLevelLive(path);
          return subscribeRowInteractionSnapshot(path, observe(listener));
        },
        selectRow: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          rowInteraction.selectRow(path, rowId);
        },
        setRowSelection: (selection) => {
          assertLevelLive(path);
          rowInteraction.setRowSelection(path, selection);
        },
        toggleRowSelection: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          rowInteraction.toggleRowSelection(path, rowId);
        },
        extendRowSelectionTo: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          rowInteraction.extendRowSelectionTo(path, rowId);
        },
        clearRowSelection: () => {
          assertLevelLive(path);
          rowInteraction.clearRowSelection(path);
        },
        isExpanded: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          return (
            coordinator.getState().expansion.get(path)?.has(rowId) ?? false
          );
        },
        subscribeExpansion: (listener) => {
          assertLevelLive(path);
          let previous = coordinator.getState().expansion.get(path);
          const notify = observe(listener);
          return coordinator.subscribe((state) => {
            const next = state.expansion.get(path);
            if (next === previous) return;
            previous = next;
            notify();
          });
        },
        expand: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          coordinator.expand(path, rowId);
        },
        collapse: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          coordinator.collapse(path, rowId);
        },
        toggleExpand: (rowId) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, rowId);
          coordinator.toggleExpand(path, rowId);
        },
        writeCell: (coord, value) => {
          assertLevelLive(path);
          assertRowIdAtPath(path, coord.rowId);
          writeCell(path, coord, value);
        },
        applyChanges: (changes) => {
          assertLevelLive(path);
          applyChanges(path, changes);
        },
        createRow: (node, atIndex) =>
          runOperation(async () => {
            assertLevelRegisteredForOperation(path);
            return createRow(path, node, atIndex);
          }),
        removeRow: (rowKey) => removeSingleRow(path, rowKey),
        drafts: Object.freeze({
          get: () => {
            assertLevelLive(path);
            return phantoms.get(path);
          },
          subscribe: (listener: () => void) => {
            assertLevelLive(path);
            return phantoms.subscribe(path, observe(listener));
          },
          add: (
            rowKey: RowKey,
            columns: Readonly<Record<ColId, unknown>> = {},
          ) => {
            assertLevelLive(path);
            requireDraftEligibility(path);
            phantoms.add(path, {
              rowKey,
              columns: Object.freeze({ ...columns }),
              state: { kind: "editing" },
            });
          },
          remove: (rowKey: RowKey) => {
            assertLevelLive(path);
            phantoms.remove(path, rowKey);
          },
          setCell: (rowKey: RowKey, colId: ColId, value: unknown) => {
            assertLevelLive(path);
            requireDraftEditingEligibility(path);
            if (!phantoms.get(path).some((draft) => draft.rowKey === rowKey)) {
              throw new Error(
                `GridRuntime.drafts.setCell: no draft with rowKey "${rowKey}" at path "${path}".`,
              );
            }
            phantomLifecycle.setPhantomCell(path, rowKey, colId, value);
          },
          commit: (rowKey: RowKey, atIndex?: number) =>
            commitPhantomRow(path, rowKey, atIndex),
        }),
      },
    });
    levelsByPath.set(path, level);
    return level;
  }

  function isolateObserver<Args extends readonly unknown[]>(
    listener: (...args: Args) => void,
  ): (...args: Args) => void {
    return (...listenerArgs) => {
      if (disposed || runtimeFault) return;
      try {
        listener(...listenerArgs);
      } catch (error) {
        reportObserverError(error, args.onObserverError);
      }
    };
  }

  function assertRowIdAtPath(path: GridPath, rowId: RowId): void {
    if (pathOfRowId(rowId) === path) return;
    throw new Error(
      `GridRuntime: row "${rowId}" does not belong to path "${path}".`,
    );
  }

  function assertLevelRegisteredForOperation(path: GridPath): void {
    if (!sources.has(path)) {
      throw new Error("Grid level is no longer registered.");
    }
  }

  function requireDraftEligibility(path: GridPath): void {
    assertLevelRegisteredForOperation(path);
    if (args.phantomRows === undefined || args.phantomRows === false) {
      throw new Error(
        `GridRuntime: draft authoring is not enabled for path "${path}".`,
      );
    }
    const source = sources.get(path)!;
    const state = sourceStates.get(path)!;
    if (
      !source.write ||
      state.status !== "ready" ||
      source.write.canAppendRow?.() !== true ||
      schemaForPath(path).options.allowPhantoms !== true
    ) {
      throw new Error(
        `GridRuntime: path "${path}" is not currently eligible for draft authoring.`,
      );
    }
  }

  function requireDraftEditingEligibility(path: GridPath): void {
    assertLevelRegisteredForOperation(path);
    const source = sources.get(path)!;
    const state = sourceStates.get(path)!;
    if (
      args.phantomRows === undefined ||
      args.phantomRows === false ||
      !source.write ||
      state.status === "initialError" ||
      state.status === "refreshError" ||
      schemaForPath(path).options.allowPhantoms !== true
    ) {
      throw new Error(
        `GridRuntime: draft authoring is not enabled for path "${path}".`,
      );
    }
  }

  function requireRowOperationsController(): RowOperationsController {
    if (!rowOperationsController) {
      throw new Error(
        "GridRuntime: row operations were used before runtime construction completed.",
      );
    }
    return rowOperationsController;
  }

  async function removeSingleRow(
    path: GridPath,
    rowKey: RowKey,
  ): Promise<void> {
    assertLevelLive(path);
    const target = requireRowOperationsController().targetForKind(
      path,
      makeRowId(path, rowKey),
      "data",
    );
    if (!target) {
      throw new Error(
        `GridRuntime.removeRow: no current data row with rowKey '${rowKey}'`,
      );
    }
    const result = await requireRowOperationsController().public.remove([
      target,
    ]);
    if (result.kind === "partial") throw result.error;
  }

  function cellSelectedRowIds(path: GridPath): readonly RowId[] {
    const selection = controllerCursorPortFor(path).getState().cellSelection;
    return selection
      ? rowsInSelection(selection, displayedRowsFor(path))
      : emptyRowIds;
  }

  async function removeRowOperationTarget(
    target: RowOperationTarget<"data">,
  ): Promise<void> {
    const source = sources.get(target.path);
    const write = source?.write;
    if (!source || !write) {
      throw new Error("Grid level is no longer registered.");
    }
    const { node, index } = readNodeWithIndex(
      sourceStates.get(target.path)!.snapshot,
      target.rowKey,
    );
    let pending = pendingAuthoritativeRemovals.get(target.path);
    if (!pending) {
      pending = new Set();
      pendingAuthoritativeRemovals.set(target.path, pending);
    }
    pending.add(target.rowKey);

    try {
      await write.removeNode(target.rowKey);
      // A conforming source publishes before the promise settles. Read once
      // more for custom sources that settled synchronously without notifying.
      if (
        sourceStates
          .get(target.path)!
          .snapshot.nodes.some(
            (candidate) => candidate.rowKey === target.rowKey,
          )
      ) {
        receiveSourceNotification(target.path);
      }
      const stillPresent = sourceStates
        .get(target.path)!
        .snapshot.nodes.some((candidate) => candidate.rowKey === target.rowKey);
      if (stillPresent) {
        throw new Error(
          `GridRuntime.removeRow: source settled without publishing removal of rowKey '${target.rowKey}'.`,
        );
      }
      applyAuthoritativeRemovalCleanup(
        target.path,
        sourceStates.get(target.path)!.snapshot.nodes,
      );
      if (!disposed) {
        emitter.emit("mutationCommitted", {
          kind: "remove",
          path: target.path,
          node,
          atIndex: index,
        });
      }
    } catch (error) {
      pending.delete(target.rowKey);
      if (pending.size === 0) pendingAuthoritativeRemovals.delete(target.path);
      throw error;
    }
  }

  async function settleTouchedPaths(
    paths: ReadonlySet<GridPath>,
  ): Promise<void> {
    if (disposed) return;
    const refetches: Promise<unknown>[] = [];
    for (const path of paths) {
      const refetch = sources.get(path)?.query?.refetch;
      if (refetch) refetches.push(Promise.resolve().then(() => refetch()));
    }
    await Promise.allSettled(refetches);
  }

  type RuntimeRemovalCursorToken = RowRemovalCursorToken & {
    readonly revision: number;
    readonly cellCursor: CellCursor | null;
    readonly rowCursor: RowCursor | null;
    readonly rowSelectionLead: RowCursor | null;
  };

  function beginRemovalCursorContinuation(
    targets: readonly RowOperationTarget<"data">[],
  ): RowRemovalCursorToken {
    const origin = coordinator.getState();
    const continuation = planCursorContinuationForRowRemoval(
      targets.map(({ path, rowId }) => ({ path, rowId })),
    );
    applyCursorContinuation(continuation);
    return Object.freeze({
      revision: cursorRevision,
      cellCursor: origin.cellCursor,
      rowCursor: origin.rowCursor,
      rowSelectionLead: origin.rowSelectionLead,
    });
  }

  function finishRemovalCursorContinuation(
    opaqueToken: RowRemovalCursorToken,
    removed: readonly RowOperationTarget<"data">[],
    complete: boolean,
  ): void {
    if (disposed) return;
    const token = opaqueToken as RuntimeRemovalCursorToken;
    if (cursorRevision !== token.revision && currentCursorIsValid()) return;
    if (complete && currentCursorIsValid()) return;
    const removalsByPath = new Map<GridPath, Set<RowId>>();
    for (const { path, rowId } of removed) {
      const rowIds = removalsByPath.get(path) ?? new Set<RowId>();
      rowIds.add(rowId);
      removalsByPath.set(path, rowIds);
    }
    const rows = cursorContinuationRows(removalsByPath);
    const newerOrigin = cursorRevision !== token.revision;
    const state = coordinator.getState();
    const correction =
      interaction.mode === "cell-grid"
        ? planCursorContinuation({
            mode: "cell-grid",
            rows,
            cellCursor: newerOrigin ? state.cellCursor : token.cellCursor,
            rowSelectionLead: newerOrigin
              ? state.rowSelectionLead
              : token.rowSelectionLead,
            fallbackPath: root,
          })
        : planCursorContinuation({
            mode: "row-list",
            rows,
            rowCursor: newerOrigin ? state.rowCursor : token.rowCursor,
            rowSelectionLead: newerOrigin
              ? state.rowSelectionLead
              : token.rowSelectionLead,
            fallbackPath: root,
          });
    applyCursorContinuation(correction);
  }

  function currentCursorIsValid(): boolean {
    if (interaction.mode === "cell-grid") {
      const cursor = cursorManager.currentCellCursor();
      if (!cursor || !sources.has(cursor.path)) return cursor === null;
      const row = displayedRowFor(cursor.path, cursor.rowId);
      return (
        !!row &&
        capabilitiesFor(row.kind).focusable &&
        schemaForPath(cursor.path).columns.some(
          (column) => column.id === cursor.colId,
        )
      );
    }
    const cursor = cursorManager.currentRowCursor();
    if (!cursor || !sources.has(cursor.path)) return cursor === null;
    return displayedRowFor(cursor.path, cursor.rowId)?.rowSelectable === true;
  }

  function applyAuthoritativeRemovalCleanup(
    path: GridPath,
    nodes: readonly TreeNode[],
  ): void {
    const pending = pendingAuthoritativeRemovals.get(path);
    if (!pending) return;
    const present = new Set(nodes.map((node) => node.rowKey));
    let registryChanged = false;
    for (const rowKey of Array.from(pending)) {
      if (present.has(rowKey)) continue;
      pending.delete(rowKey);
      const rowId = makeRowId(path, rowKey);
      if (coordinator.getState().expansion.get(path)?.has(rowId)) {
        coordinator.collapse(path, rowId);
      }
      registryChanged =
        unregisterDescendantsOfRow(path, rowKey) || registryChanged;
    }
    if (pending.size === 0) pendingAuthoritativeRemovals.delete(path);
    if (registryChanged) notifyRegistryChanged();
  }

  function unregisterDescendantsOfRow(
    parentPath: GridPath,
    parentRowKey: RowKey,
  ): boolean {
    const descendants = Array.from(sources.keys())
      .filter((path) => isBelowParentRow(path, parentPath, parentRowKey))
      .sort(
        (left, right) =>
          decomposePath(right).edges.length - decomposePath(left).edges.length,
      );
    for (const path of descendants) unregisterLevel(path);
    return descendants.length > 0;
  }

  function isBelowParentRow(
    candidate: GridPath,
    parentPath: GridPath,
    parentRowKey: RowKey,
  ): boolean {
    let current = candidate;
    let edge = trailingEdge(current);
    while (edge) {
      if (
        edge.parentPath === parentPath &&
        edge.parentRowKey === parentRowKey
      ) {
        return true;
      }
      current = edge.parentPath;
      edge = trailingEdge(current);
    }
    return false;
  }

  function unregisterLevel(path: GridPath): void {
    const level = levelsByPath.get(path);
    if (level) cleanupSafely(() => disposeGridLevelRuntime(level));
    const sourceUnsubscribe = sourceUnsubs.get(path);
    if (sourceUnsubscribe) cleanupSafely(sourceUnsubscribe);
    sourceUnsubs.delete(path);
    const reconcileUnsubscribe = reconcileUnsubs.get(path);
    if (reconcileUnsubscribe) cleanupSafely(reconcileUnsubscribe);
    reconcileUnsubs.delete(path);
    const controllerUnsubscribe = controllerUnsubs.get(path);
    if (controllerUnsubscribe) cleanupSafely(controllerUnsubscribe);
    controllerUnsubs.delete(path);
    const phantomUnsubscribe = phantomSubscriptionUnsubs.get(path);
    if (phantomUnsubscribe) cleanupSafely(phantomUnsubscribe);
    phantomSubscriptionUnsubs.delete(path);
    const displayedRowsStore = displayedRowsStoresByPath.get(path);
    if (displayedRowsStore) cleanupSafely(() => displayedRowsStore.dispose());
    displayedRowsStoresByPath.delete(path);
    sourceViewListeners.get(path)?.clear();
    sourceViewListeners.delete(path);
    sourceReconcileListeners.get(path)?.clear();
    sourceReconcileListeners.delete(path);
    cleanupSafely(() => disposePhantomPath(phantoms, path));
    const source = sources.get(path);
    sources.delete(path);
    levelRegistrations.delete(path);
    if (source) cleanupSafely(() => source.dispose());
    sourceStates.delete(path);
    sourceViews.delete(path);
    phantomLifecycleSources.delete(path);
    membershipByPath.delete(path);
    pendingAuthoritativeRemovals.delete(path);
    identityErrorPaths.delete(path);
    lastStatusByPath.delete(path);
    controllers.delete(path);
    activeRowSnapshots.delete(path);
    selectedRowsSnapshots.delete(path);
    selectedRowIdSnapshots.delete(path);
    rowInteractionSnapshots.delete(path);
    levelsByPath.delete(path);
  }

  rowOperationsController = createRowOperations({
    registeredPaths: () => registeredPaths(),
    isRegistered: (path) => sources.has(path),
    displayedRows: (path) => displayedRowsStoreFor(path).getDisplayedRows(),
    selectedRowIds,
    cellSelectedRowIds,
    membershipGeneration: membershipGenerationFor,
    isWritable: (path) =>
      sources.get(path)?.write !== undefined && !identityErrorPaths.has(path),
    removeTarget: removeRowOperationTarget,
    settleTouchedPaths,
    beginCursorContinuation: beginRemovalCursorContinuation,
    finishCursorContinuation: finishRemovalCursorContinuation,
    runOperation,
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const level of levelsByPath.values()) {
      cleanupSafely(() => disposeGridLevelRuntime(level));
    }
    emitter.clear();
    registryListeners.clear();
    for (const listeners of sourceViewListeners.values()) listeners.clear();
    sourceViewListeners.clear();
    for (const listeners of sourceReconcileListeners.values()) {
      listeners.clear();
    }
    sourceReconcileListeners.clear();
    for (const store of displayedRowsStoresByPath.values()) {
      cleanupSafely(() => store.dispose());
    }
    for (const unsubscribe of controllerUnsubs.values()) {
      cleanupSafely(unsubscribe);
    }
    controllerUnsubs.clear();
    cleanupSafely(unsubscribeCursorRevision);
    pendingLoadedRowsBoundary = null;
    if (activeOperations === 0) disposeDependencies();
  }

  function disposeDependencies(): void {
    if (dependenciesDisposed) return;
    dependenciesDisposed = true;
    for (const unsubscribe of sourceUnsubs.values()) {
      cleanupSafely(unsubscribe);
    }
    sourceUnsubs.clear();
    for (const unsubscribe of reconcileUnsubs.values()) {
      cleanupSafely(unsubscribe);
    }
    reconcileUnsubs.clear();
    for (const source of sources.values()) {
      cleanupSafely(() => source.dispose());
    }
    sources.clear();
    levelRegistrations.clear();
    sourceStates.clear();
    sourceViews.clear();
    phantomLifecycleSources.clear();
    levelsByPath.clear();
    registeredPathSnapshot = null;
    registeredLevelSnapshot = null;
    displayedRowsStoresByPath.clear();
    for (const unsubscribe of phantomSubscriptionUnsubs.values()) {
      cleanupSafely(unsubscribe);
    }
    phantomSubscriptionUnsubs.clear();
    controllers.clear();
    activeRowSnapshots.clear();
    selectedRowsSnapshots.clear();
    selectedRowIdSnapshots.clear();
    rowInteractionSnapshots.clear();
    lastStatusByPath.clear();
    membershipByPath.clear();
    pendingAuthoritativeRemovals.clear();
    identityErrorPaths.clear();
    pendingPhantomCreates.clear();
    cleanupSafely(() => phantoms.dispose());
    cleanupSafely(() => dataSource.dispose());
  }

  const internals: GridRuntimeInternals = {
    schema,
    schemaTopology,
    registeredPaths,
    subscribeRegistry,
    coordinator,
    cursorManager,
    phantoms,
    interaction,
    activeRowFor: activeRowForPath,
    selectedRowsFor: selectedRowsForPath,
    selectedRowIds,
    rowInteractionSnapshotFor: rowInteractionSnapshotForPath,
    rowOperationTargetsFor: rowOperationTargetsForPath,
    subscribeActiveRow,
    subscribeSelectedRows,
    subscribeSelectedRowIds,
    subscribeRowInteractionSnapshot,
    rowInteraction,
    displayedRowsFor,
    displayedRowSequenceFor,
    displayedRowFor,
    subscribeDisplayedRowSequence,
    subscribeDisplayedRow,
    invalidateDisplayedRows,
    snapshotFor,
    sourceStateFor,
    controllerFor,
    cellActivationFor,
    schemaAt: schemaForPath,
    materializedChildren,
    sourceFor,
    writeCell,
    applyChanges,
    createRow,
    removeRow,
    planCursorContinuationForRowRemoval,
    applyCursorContinuation,
    commitPhantomRow,
    phantomBoundaryCellTarget: phantomLifecycle.boundaryCellTarget,
    phantomBoundaryRowTarget: phantomLifecycle.boundaryRowTarget,
    requestLoadedRowsBoundary,
    observe: isolateObserver,
    on: emitter.on,
    dispose,
  };
  runtimeRef = internals;

  const publicRuntime: GridRuntime = Object.freeze({
    schema,
    interaction,
    root: levelRuntimeFor(root),
    level(path: GridPath) {
      assertLive();
      const level = levelsByPath.get(path);
      if (!level || !sources.has(path)) {
        throw new Error("Grid level is no longer registered.");
      }
      return level;
    },
    registeredLevels,
    subscribeLevels: subscribeRegistry,
    schemaAt: schemaForPath,
    rowOperations: requireRowOperationsController().public,
    on<E extends keyof GridEvents>(
      event: E,
      listener: (payload: GridEvents[E]) => void,
    ) {
      assertLive();
      return emitter.on(event, listener);
    },
    dispose,
  });
  internalsByRuntime.set(publicRuntime, internals);
  return publicRuntime;
}

function readCellValue(
  snapshot: LevelSnapshot,
  rowKey: RowKey,
  colId: ColId,
): unknown {
  for (const node of snapshot.nodes) {
    if (node.rowKey === rowKey) {
      return node.columns[colId];
    }
  }
  return undefined;
}

function assertRowHeaderInteractionCompatibility(
  schema: GridSchema,
  interaction: GridInteractionConfig,
): void {
  if (interaction.mode !== "cell-grid") return;
  if (
    interaction.selectedRows.kind === "enabled" &&
    interaction.selectedRows.sync.kind === "independent"
  ) {
    return;
  }

  for (const [levelName, level] of Object.entries(schema.levels)) {
    if (level.rowHeaderColumn === "none") continue;
    throw new Error(
      `GridRuntime: level "${levelName}" declares a row header, but cell-grid row headers require independent row selection. Set rowHeaderColumn to "none" or configure interaction.selectedRows.sync as "independent".`,
    );
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function readNodeWithIndex(
  snapshot: LevelSnapshot,
  rowKey: RowKey,
): { node: TreeNode; index: number } {
  for (let i = 0; i < snapshot.nodes.length; i++) {
    const node = snapshot.nodes[i];
    if (node.rowKey === rowKey) {
      return { node, index: i };
    }
  }
  throw new Error(`GridRuntime.removeRow: no node with rowKey '${rowKey}'`);
}

const EMPTY_LEVEL_SNAPSHOT: LevelSnapshot = Object.freeze({
  nodes: Object.freeze([]),
});

function snapshotGridSchema(schema: GridSchema): GridSchema {
  const levels: Record<string, LevelSchema> = {};
  for (const [name, level] of Object.entries(schema.levels)) {
    const columns = level.columns.map((column) =>
      Object.freeze({
        ...column,
        ...(column.edit
          ? {
              edit: Object.freeze({
                ...column.edit,
                startsOn: Object.freeze([...column.edit.startsOn]),
              }),
            }
          : {}),
        ...(column.activation
          ? {
              activation: Object.freeze({
                ...column.activation,
                startsOn: Object.freeze([...column.activation.startsOn]),
              }),
            }
          : {}),
      }),
    );
    const rowHeaderColumn =
      typeof level.rowHeaderColumn === "object"
        ? Object.freeze({ ...level.rowHeaderColumn })
        : level.rowHeaderColumn;
    levels[name] = Object.freeze({
      ...level,
      columns: Object.freeze(columns),
      rowHeaderColumn,
      options: Object.freeze({ ...level.options }),
      childLevels: Object.freeze([...level.childLevels]),
    });
  }
  return Object.freeze({
    rootLevel: schema.rootLevel,
    levels: Object.freeze(levels),
  });
}

function snapshotGridInteraction(
  interaction: GridInteractionConfig,
): GridInteractionConfig {
  if (interaction.mode === "cell-grid") {
    return Object.freeze({
      ...interaction,
      activeCell: Object.freeze({
        ...interaction.activeCell,
        keyboard: Object.freeze({
          arrows: Object.freeze({
            ...interaction.activeCell.keyboard.arrows,
          }),
        }),
      }),
      selectedCells: Object.freeze({ ...interaction.selectedCells }),
      activeRow: Object.freeze({ ...interaction.activeRow }),
      selectedRows: snapshotSelectedRows(interaction.selectedRows),
    });
  }
  return Object.freeze({
    ...interaction,
    activeCell: Object.freeze({ ...interaction.activeCell }),
    selectedCells: Object.freeze({ ...interaction.selectedCells }),
    activeRow: Object.freeze({
      ...interaction.activeRow,
      keyboard: Object.freeze({ ...interaction.activeRow.keyboard }),
    }),
    selectedRows: snapshotSelectedRows(interaction.selectedRows),
  });
}

function snapshotSelectedRows(
  selectedRows: GridInteractionConfig["selectedRows"],
): GridInteractionConfig["selectedRows"] {
  if (selectedRows.kind === "none") {
    return Object.freeze({ kind: "none" });
  }
  return Object.freeze({
    ...selectedRows,
    sync: Object.freeze({ ...selectedRows.sync }),
    keyboard: Object.freeze({ ...selectedRows.keyboard }),
  });
}

function snapshotLevelSourceState(
  state: LevelSourceState,
  snapshotFor: (snapshot: LevelSnapshot) => LevelSnapshot,
): LevelSourceState {
  const snapshot = snapshotFor(state.snapshot);
  switch (state.status) {
    case "initialLoading":
      return Object.freeze({ status: state.status, snapshot });
    case "ready":
      return Object.freeze({ status: state.status, snapshot });
    case "refreshing":
      return Object.freeze({
        status: state.status,
        snapshot,
        previous: snapshotFor(state.previous),
      });
    case "initialError":
      return Object.freeze({
        status: state.status,
        snapshot,
        error: state.error,
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
  assertUniqueTreeNodeRowKeys(nodes, `GridRuntime source "${path}"`);
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function loadedBoundaryIntentEqual(
  left: LoadedRowsBoundaryEvent,
  right: LoadedRowsBoundaryEvent,
): boolean {
  if (
    left.kind !== right.kind ||
    left.loadPath !== right.loadPath ||
    left.direction !== right.direction ||
    left.extend !== right.extend
  ) {
    return false;
  }
  if (left.kind === "cell" && right.kind === "cell") {
    return (
      left.colPolicy === right.colPolicy &&
      cursorEqual(left.origin, right.origin)
    );
  }
  if (left.kind === "row" && right.kind === "row") {
    return rowCursorEqual(left.origin, right.origin);
  }
  return false;
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === null || err === undefined) return "";
  return String(err);
}

function phantomCreateKey(path: GridPath, rowKey: RowKey): string {
  return `${path}\u0000${rowKey}`;
}

function rowCursorSnapshotEqual(
  a: RowCursor | null,
  b: RowCursor | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.rowId === b.rowId;
}

function rowSelectionExactEqual(a: RowSelection, b: RowSelection): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "single":
      return b.kind === "single" && a.rowId === b.rowId;
    case "range":
      return b.kind === "range" && a.anchor === b.anchor && a.head === b.head;
    case "set": {
      if (b.kind !== "set") return false;
      if (a.rowIds.size !== b.rowIds.size) return false;
      for (const rowId of a.rowIds) {
        if (!b.rowIds.has(rowId)) return false;
      }
      return true;
    }
  }
}

function rowIdSnapshotsEqual(
  a: readonly RowId[],
  b: readonly RowId[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
