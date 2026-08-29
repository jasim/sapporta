// The runtime is a plain TypeScript value that owns the grid's live resources.
// See README.md for the reader-facing lifecycle, subscription guide, ordering
// rules, and module map.
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
//   - `runtime.activeRow()` is the application projection across paths. It
//     resolves the global cursor to its live level and displayed row, and its
//     subscription follows both cursor movement and changes to that row.
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
// Level row interaction reads are path-scoped. A `GridPath` names one rendered
// grid part: the root level, an expanded child level under a row, or a deeper
// descendant. The global active-row projection is singular because both cursor
// modes have one global cursor. Row selection remains path-scoped; page-level
// commands must choose their scope and aggregate those projections explicitly.
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
import {
  CELL_EDITING_GRID,
  type GridInteractionConfig,
  type RowActivationTrigger,
} from "../types/interaction";
import { assertValidInteraction } from "../interaction/validate-interaction";
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
  createObserverList,
  reportObserverError,
} from "../observer-notification";
import type {
  CellChange,
  CreateNodeResult,
  GridDataSource,
  LevelDataSource,
  LevelSnapshot,
  LevelSourceState,
  RuntimeLevelDataSource,
  SourceLoadResult,
} from "../data-sources/types";
import type { DisplayedRowsInvalidationReason } from "../displayed-rows";
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
export type GridRowActivatedEvent = GridEvents["rowActivated"];
import type { PhantomChannel } from "../data-sources/types";
import {
  createSourceRegistry,
  type LevelHandle,
  type SourceRefresh,
  type SourceRegistry,
} from "./source-registry";
import { createDisplayedRowsRuntime } from "./displayed-rows";
import {
  createLoadedBoundaryRuntime,
  type LoadedRowsBoundaryEvent,
} from "./loaded-boundary";
export type { LoadedRowsBoundaryEvent } from "./loaded-boundary";
import { createMutationRuntime } from "./mutations";
import { createDraftRuntime } from "./drafts";
import { createInteractionRuntime } from "./interaction-runtime";
import { createPhantomRowLifecycle } from "./phantom-row-lifecycle";
import {
  createGridLevelRuntime,
  disposeGridLevelRuntime,
  type GridLevelRuntime,
} from "./grid-level-runtime";
import { createGridActiveRow, type GridActiveRow } from "./grid-active-row";
export type { GridActiveRow } from "./grid-active-row";
import {
  createRowOperations,
  type GridRowOperations,
  type RowOperationTarget,
  type RowOperationsController,
  type RowRemovalCursorToken,
} from "./row-operations";
import { rowsInSelection } from "../types/selection";

export type RuntimeArgs = {
  /** Static levels, columns, and parent-child relationships for this runtime. */
  readonly schema: GridSchema;
  /** Acquires the root source and child sources as paths are registered. */
  readonly dataSource: GridDataSource;
  /** Chooses cell-grid or row-list behavior for the runtime's full lifetime. */
  readonly interaction?: GridInteractionConfig;
  /** Optional draft channel. The runtime creates and owns one when omitted. */
  readonly phantoms?: PhantomChannel;
  /** Enables and configures automatic append-row drafts. */
  readonly phantomRows?: PhantomRowsConfig;
  // A host can own displayed-row edge policy for loaded windows. The runtime
  // emits a boundary event and waits for the host/source load promise. After a
  // ready result, it samples displayed rows and lands on the requested edge.
  readonly onLoadedRowsBoundary?: (
    event: LoadedRowsBoundaryEvent,
  ) => Promise<SourceLoadResult> | false;
  /** Initial host event listeners. They are installed before root acquisition. */
  readonly on?: {
    readonly [E in keyof GridEvents]?: (payload: GridEvents[E]) => void;
  };
  /** Receives observer failures without interrupting a runtime transition. */
  readonly onObserverError?: (error: unknown) => void;
};

/** The application-facing control surface for one running grid. */
export type GridRuntime = {
  /** The immutable schema snapshot used by this runtime. */
  readonly schema: GridSchema;
  /** The immutable interaction configuration used by this runtime. */
  readonly interaction: GridInteractionConfig;
  /** The eagerly registered root level. */
  readonly root: GridLevelRuntime;
  /**
   * Returns the current registration for a path.
   * The call fails when the path has not been expanded or was unregistered.
   */
  level(path: GridPath): GridLevelRuntime;
  /** Returns an identity-stable snapshot of current level registrations. */
  registeredLevels(): readonly GridLevelRuntime[];
  /**
   * Observes additions and removals in the level registry. Source state, row
   * data, selection, and ordinary expansion changes do not wake it.
   */
  subscribeLevels(listener: () => void): () => void;
  /** Reads the current row and its latest displayed values. */
  activeRow(): GridActiveRow | null;
  /** Observes active-row identity and displayed-value changes. */
  subscribeActiveRow(listener: () => void): () => void;
  /** Resolves static level schema from a well-formed path. */
  schemaAt(path: GridPath): LevelSchema;
  /** Builds and removes validated row-operation targets across paths. */
  readonly rowOperations: GridRowOperations;
  /**
   * Observes a typed host event. Events describe commands and outcomes; they
   * are separate from the subscriptions used to render current state.
   */
  on<E extends keyof GridEvents>(
    event: E,
    listener: (payload: GridEvents[E]) => void,
  ): () => void;
  /** Stops notifications and releases resources. Repeated calls are safe. */
  dispose(): void;
};

/** Package-private runtime surface used by the renderer and advanced entry. */
export type RuntimeKernel = {
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
  // `colId` is the landing column, already resolved by the coordinator.
  phantomBoundaryCellTarget: (
    path: GridPath,
    colId: ColId,
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

const kernels = new WeakMap<GridRuntime, RuntimeKernel>();

export function runtimeInternalsFor(runtime: GridRuntime): RuntimeKernel {
  const internals = kernels.get(runtime);
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
    const configuredInteraction = args.interaction ?? CELL_EDITING_GRID;
    assertValidInteraction(configuredInteraction);
    interaction = snapshotGridInteraction(configuredInteraction);
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
  const phantomLifecycleSources = new Map<GridPath, LevelDataSource>();
  let sourceRegistry: SourceRegistry;
  let loadedBoundaryRuntime:
    ReturnType<typeof createLoadedBoundaryRuntime> | undefined;
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
    const source = sourceRegistry.source(path);
    if (!source) return undefined;
    const view: LevelDataSource = {
      state: () => sourceRegistry.state(path),
      subscribe: source.subscribe,
      dispose: () => {},
      ...(source.query ? { query: source.query } : {}),
      ...(source.write ? { write: source.write } : {}),
    };
    phantomLifecycleSources.set(path, view);
    return view;
  }

  const root = rootPath(schemaTopology.rootLevelName);
  let shutdownRequested = false;
  let runtimeFault: Error | null = null;
  let retainedResourcesReleased = false;
  let inFlightOperations = 0;

  function assertLive(): void {
    if (shutdownRequested) {
      throw new Error("GridRuntime has been disposed.");
    }
    if (runtimeFault) {
      throw new Error(`GridRuntime has faulted: ${runtimeFault.message}`);
    }
  }

  function receiveSourceNotification(path: GridPath): void {
    try {
      sourceRegistry.refreshPath(path);
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
    if (!sourceRegistry.has(path)) {
      throw new Error("Grid level is no longer registered.");
    }
  }

  function assertLevelRegistrationLive(
    path: GridPath,
    registration: LevelHandle,
  ): void {
    if (registration.path !== path)
      throw new Error("Grid level is no longer registered.");
    sourceRegistry.assertHandleLive(registration);
  }

  function runOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      assertLive();
    } catch (error) {
      return Promise.reject(error);
    }
    inFlightOperations += 1;
    try {
      return operation().finally(() => {
        inFlightOperations -= 1;
        if (shutdownRequested && inFlightOperations === 0)
          releaseRetainedResources();
      });
    } catch (error) {
      inFlightOperations -= 1;
      if (shutdownRequested && inFlightOperations === 0)
        releaseRetainedResources();
      return Promise.reject(error);
    }
  }

  sourceRegistry = createSourceRegistry({
    rootPath: root,
    assertRuntimeLive: assertLive,
    runOperation,
    onRefresh: (refresh) => {
      try {
        onSourceSnapshotChanged(refresh);
      } catch (error) {
        faultRuntime(error);
      }
    },
    onReconcile: (handle, event) => {
      if (!shutdownRequested)
        emitter.emit("cellReconciled", { path: handle.path, event });
    },
    onObserverError: args.onObserverError,
  });

  // One displayed-rows store per path that has been rendered or read. The
  // runtime owns these stores because only the runtime can gather the full
  // `DisplayedRowsInput`: schema from topology, source snapshot from the
  // registered source, phantoms from the author-state channel, and body view
  // state. Components consume cached projections from this store; they do not
  // assemble or memoize row data in render.
  const displayedRowsRuntime = createDisplayedRowsRuntime({
    phantoms,
    assertLive,
    sourceState: sourceRegistry.state,
    schemaAt: schemaForPath,
    beforeNotify: reconcileRowSelection,
    onFault: faultRuntime,
    onObserverError: args.onObserverError,
  });
  const mutations = createMutationRuntime({
    assertLive,
    source: sourceRegistry.source,
    sourceSnapshot: (path) => sourceRegistry.state(path).snapshot,
    isWritable: sourceRegistry.isWritable,
    displayedRows: displayedRowsRuntime.rows,
    schemaAt: schemaForPath,
    setDraftCell: (path, rowKey, colId, value) =>
      phantomLifecycle.setPhantomCell(path, rowKey, colId, value),
    emit: emitter.emit,
    fault: faultRuntime,
    isDisposed: () => shutdownRequested,
  });
  const drafts = createDraftRuntime({
    phantoms,
    source: sourceRegistry.source,
    sourceState: sourceRegistry.state,
    schemaAt: schemaForPath,
    isRegistered: sourceRegistry.has,
    assertLevelLive,
    runOperation,
    createRow: mutations.createRow,
    setLifecycleCell: (path, rowKey, colId, value) =>
      phantomLifecycle.setPhantomCell(path, rowKey, colId, value),
    isBlank: phantomLifecycle.isBlank,
    emit: emitter.emit,
    isDisposed: () => shutdownRequested,
  });

  // Lazy controllers. Identity-stable per path for the runtime's
  // lifetime; collapsing/re-expanding does not recreate them.
  let interactionRuntime: ReturnType<typeof createInteractionRuntime>;
  const emptyRowIds: readonly RowId[] = [];

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
      registeredPathSnapshot = Object.freeze(sourceRegistry.paths());
    }
    return registeredPathSnapshot;
  }

  function registeredLevels(): readonly GridLevelRuntime[] {
    assertLive();
    if (registeredLevelSnapshot) return registeredLevelSnapshot;
    const next = Object.freeze(
      sourceRegistry.paths().map((path) => levelRuntimeFor(path)),
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
    if (!shutdownRequested) registryListeners.notify();
  }

  function levelNameOf(path: GridPath): string {
    const decomp = decomposePath(path);
    return decomp.edges.length === 0
      ? decomp.rootLevelName
      : decomp.edges[decomp.edges.length - 1].levelName;
  }

  function onSourceSnapshotChanged(refresh: SourceRefresh): void {
    const { handle, state, statusChanged } = refresh;
    const path = handle.path;
    applyAuthoritativeRemovalCleanup(path, state.snapshot.nodes);
    if (shutdownRequested) return;
    phantomLifecycle.reconcileBlankAppendPhantoms(path);
    phantomLifecycle.ensureBlankForEmptyPath(path);
    invalidateDisplayedRows(path, { type: "source" });
    resolvePendingLoadedRowsBoundary(path);
    if (statusChanged) {
      emitter.emit("levelStatusChanged", {
        path,
        status: statusChanged.status,
        ...(statusChanged.error ? { error: statusChanged.error } : {}),
      });
    }
    sourceRegistry.notifyView(handle);
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
    try {
      sourceRegistry.register(root, () => dataSource.rootSource());
      phantomLifecycle.ensureBlankForEmptyPath(root);
      levelRuntimeFor(root);
      notifyRegistryChanged();
    } catch (error) {
      sourceRegistry.dispose();
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
        if (sourceRegistry.has(childPath)) continue;
        sourceRegistry.register(childPath, () =>
          dataSource.resolveChild(parentPath, parentRowKey, childLevelName),
        );
        addedPaths.push(childPath);
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

  function sourceStateFor(path: GridPath): LevelSourceState {
    assertLevelLive(path);
    return sourceRegistry.state(path);
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
      if (sourceRegistry.has(cp)) out.push(cp);
    }
    return out;
  }

  // Snapshot read for code that needs full rows and lookup maps. Interaction
  // and navigation read it imperatively; multi-row React consumers subscribe
  // through `subscribeDisplayedRows`. Body rendering uses the sequence surface
  // below because it must not wake on cell-content edits.
  function displayedRowsFor(path: GridPath): DisplayedRows {
    return displayedRowsRuntime.rows(path);
  }

  // React body read: row refs only. The body uses this to mount stable row
  // shells; cell content stays behind `displayedRowFor` so a cell edit is local
  // to the affected row subscriber.
  function displayedRowSequenceFor(path: GridPath): DisplayedRowSequence {
    return displayedRowsRuntime.sequence(path);
  }

  function displayedRowFor(path: GridPath, rowId: RowId): LevelRow | undefined {
    return displayedRowsRuntime.row(path, rowId);
  }

  function subscribeDisplayedRowSequence(
    path: GridPath,
    fn: () => void,
  ): () => void {
    return displayedRowsRuntime.subscribeSequence(path, fn);
  }

  function subscribeDisplayedRow(
    path: GridPath,
    rowId: RowId,
    fn: () => void,
  ): () => void {
    return displayedRowsRuntime.subscribeRow(path, rowId, fn);
  }

  function invalidateDisplayedRows(
    path: GridPath,
    reason: DisplayedRowsInvalidationReason,
  ): void {
    displayedRowsRuntime.invalidate(path, reason);
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
    if (!loadedBoundaryRuntime) return false;
    return loadedBoundaryRuntime.request(event);
  }

  function resolvePendingLoadedRowsBoundary(path: GridPath): void {
    loadedBoundaryRuntime?.resolve(path);
  }

  function sourceFor(path: GridPath): RuntimeLevelDataSource {
    return sourceRegistry.view(sourceRegistry.handleFor(path));
  }

  const requireWritable = mutations.requireWritable;
  const writeCell = mutations.writeCell;

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

  const commitPhantomRow = drafts.commit;

  const applyChanges = mutations.applyChanges;
  const createRow = mutations.createRow;
  const removeRow = mutations.removeRow;

  // Coordinator reads runtime state through `getRuntime` — it never holds
  // a derived view, so a freshly resolved child source or a freshly
  // applied sort is reflected on the next call without explicit
  // invalidation. The reference is late-bound because the runtime
  // object is built below.
  let runtimeRef: RuntimeKernel | null = null;
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
  interactionRuntime = createInteractionRuntime({
    coordinator,
    cursorManager,
    createController: createControllerForPath,
    onObserverError: args.onObserverError,
  });
  loadedBoundaryRuntime = createLoadedBoundaryRuntime({
    assertLive,
    sourceState: sourceRegistry.state,
    sourceExists: sourceRegistry.has,
    displayedRows: displayedRowsFor,
    schemaAt: schemaForPath,
    load: args.onLoadedRowsBoundary,
    moveCell: (target, extend) => {
      if (extend) cursorManager.extendCellSelectionTo(target);
      else cursorManager.moveCellCursorTo(target);
    },
    revealCell: (target) =>
      controllerCursorPortFor(target.path).revealCell({
        rowId: target.rowId,
        colId: target.colId,
      }),
    moveRow: (target, extend) => {
      if (extend) cursorManager.extendRowSelectionToCursor(target);
      else cursorManager.moveRowCursorTo(target);
    },
    revealRow: (target) =>
      controllerCursorPortFor(target.path).revealRow(target.rowId),
    onObserverError: args.onObserverError,
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
    return interactionRuntime.controller(path);
  }

  function createControllerForPath(path: GridPath): {
    readonly controller: GridControllerStore;
    readonly cleanup: () => void;
  } {
    const controller = createGridController({
      path,
      interaction,
      getDisplayed: () => displayedRowsFor(path),
      getSchema: () => schemaForPath(path).columns,
      // Keep this lazy for the controller's lifetime. An identity error can
      // disable writes after the controller is created, and a later valid
      // refresh can restore them; the next primary action must see that state.
      isWritable: () => sourceRegistry.isWritable(path),
      onNavigateCell: (intent, presentation) => {
        coordinator.navigateCell(path, intent, presentation);
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
      activateRow: (rowId, trigger, coord) =>
        activateRow(path, rowId, trigger, coord),
    });
    const cleanup = controller.subscribe((s, prev) => {
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
    return { controller, cleanup };
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

  function activateRow(
    path: GridPath,
    rowId: RowId,
    trigger: RowActivationTrigger,
    coord?: Coord,
  ): boolean {
    assertLive();
    const row = displayedRowFor(path, rowId);
    if (
      !row ||
      !capabilitiesFor(row.kind).focusable ||
      interaction.activeRow.kind === "none"
    ) {
      return false;
    }

    if (interaction.mode === "row-list") {
      cursorManager.moveRowCursorTo({ path, rowId });
    } else {
      const current = coordinator.getState().cellCursor;
      const colId =
        coord?.rowId === rowId
          ? coord.colId
          : current?.path === path
            ? current.colId
            : schemaForPath(path).columns[0]?.id;
      if (!colId) return false;
      if (!schemaForPath(path).columns.some((column) => column.id === colId)) {
        return false;
      }
      cursorManager.moveCellCursorTo({ path, rowId, colId });
    }

    const active = activeRowForRuntime();
    if (!active || active.level.path !== path || active.row.id !== rowId) {
      return false;
    }
    emitter.emit("rowActivated", { activeRow: active, trigger });
    return true;
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
    const prev = interactionRuntime.activeRows.get(path) ?? null;
    if (rowCursorSnapshotEqual(prev, next)) return prev;
    interactionRuntime.activeRows.set(path, next);
    return next;
  }

  let runtimeActiveRowSnapshot: GridActiveRow | null = null;

  function activeRowCursorForRuntime(): RowCursor | null {
    const state = coordinator.getState();
    if (interaction.mode === "row-list") return state.rowCursor;
    return interaction.activeRow.kind === "from-active-cell" && state.cellCursor
      ? { path: state.cellCursor.path, rowId: state.cellCursor.rowId }
      : null;
  }

  function activeRowForRuntime(): GridActiveRow | null {
    assertLive();
    const cursor = activeRowCursorForRuntime();
    if (!cursor) {
      runtimeActiveRowSnapshot = null;
      return null;
    }
    const row = displayedRowFor(cursor.path, cursor.rowId);
    if (!row) {
      runtimeActiveRowSnapshot = null;
      return null;
    }
    const level = levelRuntimeFor(cursor.path);
    if (
      runtimeActiveRowSnapshot?.level.path === cursor.path &&
      runtimeActiveRowSnapshot.row.id === cursor.rowId &&
      runtimeActiveRowSnapshot.row === row &&
      runtimeActiveRowSnapshot.level === level
    ) {
      return runtimeActiveRowSnapshot;
    }
    runtimeActiveRowSnapshot = createGridActiveRow(level, row);
    return runtimeActiveRowSnapshot;
  }

  function subscribeRuntimeActiveRow(fn: () => void): () => void {
    let prev = activeRowForRuntime();
    let unsubscribeRow = subscribeToRow(prev);

    function subscribeToRow(active: GridActiveRow | null): () => void {
      return active
        ? subscribeDisplayedRow(active.level.path, active.row.id, update)
        : () => {};
    }

    function update(): void {
      const next = activeRowForRuntime();
      if (
        prev?.level.path !== next?.level.path ||
        prev?.row.id !== next?.row.id
      ) {
        unsubscribeRow();
        unsubscribeRow = subscribeToRow(next);
      }
      if (prev === next) return;
      prev = next;
      fn();
    }

    const unsubscribeCursor = coordinator.subscribe(update);
    return () => {
      unsubscribeCursor();
      unsubscribeRow();
    };
  }

  function selectedRowsForPath(path: GridPath): RowSelection {
    const controller = controllerCursorPortFor(path);
    const next = selectedRowsFor(
      interaction,
      activeRowForPath(path),
      controller.getState().rowSelection,
    );
    const prev = interactionRuntime.selectedRows.get(path) ?? null;
    if (rowSelectionExactEqual(prev, next)) return prev;
    interactionRuntime.selectedRows.set(path, next);
    return next;
  }

  function selectedRowIds(path: GridPath): readonly RowId[] {
    const projected = rowIdsInRowSelection(
      selectedRowsForPath(path),
      displayedRowsFor(path),
    );
    const next = projected.length === 0 ? emptyRowIds : projected;
    const prev = interactionRuntime.selectedRowIds.get(path) ?? emptyRowIds;
    if (rowIdSnapshotsEqual(prev, next)) return prev;
    interactionRuntime.selectedRowIds.set(path, next);
    return next;
  }

  function rowInteractionSnapshotForPath(
    path: GridPath,
  ): RowInteractionSnapshot {
    const active = activeRowForPath(path);
    const activeRowId = active?.rowId ?? null;
    const selectedIds = selectedRowIds(path);
    const prev = interactionRuntime.rowSnapshots.get(path);
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
    interactionRuntime.rowSnapshots.set(path, next);
    return next;
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
    const registration = sourceRegistry.handleFor(path);

    const observe = (listener: () => void): (() => void) =>
      isolateObserver(listener);
    const level = createGridLevelRuntime({
      path,
      schema: schemaForPath(path),
      data: sourceFor(path),
      assertLive: () => assertLevelRegistrationLive(path, registration),
      isLive: () =>
        !shutdownRequested &&
        !runtimeFault &&
        sourceRegistry.entryForHandle(registration) !== undefined,
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
        subscribeDisplayedRows: (listener) => {
          assertLevelLive(path);
          return displayedRowsRuntime.subscribeRows(path, observe(listener));
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
            return drafts.get(path);
          },
          subscribe: (listener: () => void) => {
            assertLevelLive(path);
            return drafts.subscribe(path, observe(listener));
          },
          add: (
            rowKey: RowKey,
            columns: Readonly<Record<ColId, unknown>> = {},
          ) => {
            assertLevelLive(path);
            drafts.add(path, rowKey, columns);
          },
          remove: (rowKey: RowKey) => {
            assertLevelLive(path);
            drafts.remove(path, rowKey);
          },
          setCell: (rowKey: RowKey, colId: ColId, value: unknown) => {
            assertLevelLive(path);
            drafts.setCell(path, rowKey, colId, value);
          },
          commit: (rowKey: RowKey, atIndex?: number) =>
            commitPhantomRow(path, rowKey, atIndex),
        }),
      },
    });
    sourceRegistry.addCleanup(registration, () =>
      disposeGridLevelRuntime(level),
    );
    levelsByPath.set(path, level);
    return level;
  }

  function isolateObserver<Args extends readonly unknown[]>(
    listener: (...args: Args) => void,
  ): (...args: Args) => void {
    return (...listenerArgs) => {
      if (shutdownRequested || runtimeFault) return;
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
    if (!sourceRegistry.has(path)) {
      throw new Error("Grid level is no longer registered.");
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
    const rowId = target.row.id;
    const path = pathOfRowId(rowId);
    const rowKey = rowKeyOfRowId(rowId);
    const source = sourceRegistry.source(path);
    const write = source?.write;
    if (!source || !write) {
      throw new Error("Grid level is no longer registered.");
    }
    const { node, index } = readNodeWithIndex(
      sourceRegistry.state(path).snapshot,
      rowKey,
    );
    const pending = sourceRegistry.pendingRemovals(path);
    if (!pending) throw new Error("Grid level is no longer registered.");
    pending.add(rowKey);

    try {
      await write.removeNode(rowKey);
      // A conforming source publishes before the promise settles. Read once
      // more for custom sources that settled synchronously without notifying.
      if (
        sourceRegistry
          .state(path)
          .snapshot.nodes.some((candidate) => candidate.rowKey === rowKey)
      ) {
        receiveSourceNotification(path);
      }
      const stillPresent = sourceRegistry
        .state(path)
        .snapshot.nodes.some((candidate) => candidate.rowKey === rowKey);
      if (stillPresent) {
        throw new Error(
          `GridRuntime.removeRow: source settled without publishing removal of rowKey '${rowKey}'.`,
        );
      }
      applyAuthoritativeRemovalCleanup(
        path,
        sourceRegistry.state(path).snapshot.nodes,
      );
      if (!shutdownRequested) {
        emitter.emit("mutationCommitted", {
          kind: "remove",
          path,
          node,
          atIndex: index,
        });
      }
    } catch (error) {
      pending.delete(rowKey);
      throw error;
    }
  }

  async function settleTouchedPaths(
    paths: ReadonlySet<GridPath>,
  ): Promise<void> {
    if (shutdownRequested) return;
    const refetches: Promise<unknown>[] = [];
    for (const path of paths) {
      const refetch = sourceRegistry.source(path)?.query?.refetch;
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
      targets.map(({ row }) => ({
        path: pathOfRowId(row.id),
        rowId: row.id,
      })),
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
    if (shutdownRequested) return;
    const token = opaqueToken as RuntimeRemovalCursorToken;
    if (cursorRevision !== token.revision && currentCursorIsValid()) return;
    if (complete && currentCursorIsValid()) return;
    const removalsByPath = new Map<GridPath, Set<RowId>>();
    for (const { row } of removed) {
      const rowId = row.id;
      const path = pathOfRowId(rowId);
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
      if (!cursor || !sourceRegistry.has(cursor.path)) return cursor === null;
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
    if (!cursor || !sourceRegistry.has(cursor.path)) return cursor === null;
    return displayedRowFor(cursor.path, cursor.rowId)?.rowSelectable === true;
  }

  function applyAuthoritativeRemovalCleanup(
    path: GridPath,
    nodes: readonly TreeNode[],
  ): void {
    const pending = sourceRegistry.pendingRemovals(path);
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
    if (registryChanged) notifyRegistryChanged();
  }

  function unregisterDescendantsOfRow(
    parentPath: GridPath,
    parentRowKey: RowKey,
  ): boolean {
    const descendants = sourceRegistry
      .paths()
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
    const handle = sourceRegistry.deactivatePath(path);
    if (!handle) return;
    const level = levelsByPath.get(path);
    if (level) cleanupSafely(() => disposeGridLevelRuntime(level));
    interactionRuntime.unregister(path);
    displayedRowsRuntime.unregister(path);
    cleanupSafely(() => disposePhantomPath(phantoms, path));
    sourceRegistry.disposeHandle(handle);
    phantomLifecycleSources.delete(path);
    levelsByPath.delete(path);
  }

  rowOperationsController = createRowOperations({
    registeredPaths: () => registeredPaths(),
    isRegistered: (path) => sourceRegistry.has(path),
    displayedRows: displayedRowsRuntime.rows,
    selectedRowIds,
    cellSelectedRowIds,
    membershipGeneration: sourceRegistry.membershipGenerationFor,
    isWritable: sourceRegistry.isWritable,
    removeTarget: removeRowOperationTarget,
    settleTouchedPaths,
    beginCursorContinuation: beginRemovalCursorContinuation,
    finishCursorContinuation: finishRemovalCursorContinuation,
    runOperation,
  });

  function dispose() {
    if (shutdownRequested) return;
    shutdownRequested = true;
    for (const level of levelsByPath.values()) {
      cleanupSafely(() => disposeGridLevelRuntime(level));
    }
    emitter.clear();
    registryListeners.clear();
    displayedRowsRuntime.dispose();
    interactionRuntime.dispose();
    cleanupSafely(unsubscribeCursorRevision);
    loadedBoundaryRuntime?.dispose();
    if (inFlightOperations === 0) releaseRetainedResources();
  }

  function releaseRetainedResources(): void {
    if (retainedResourcesReleased) return;
    retainedResourcesReleased = true;
    sourceRegistry.dispose();
    phantomLifecycleSources.clear();
    levelsByPath.clear();
    registeredPathSnapshot = null;
    registeredLevelSnapshot = null;
    drafts.dispose();
    cleanupSafely(() => phantoms.dispose());
    cleanupSafely(() => dataSource.dispose());
  }

  const internals: RuntimeKernel = {
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
      if (!level || !sourceRegistry.has(path)) {
        throw new Error("Grid level is no longer registered.");
      }
      return level;
    },
    registeredLevels,
    subscribeLevels: subscribeRegistry,
    activeRow: activeRowForRuntime,
    subscribeActiveRow(listener: () => void) {
      assertLive();
      return subscribeRuntimeActiveRow(isolateObserver(listener));
    },
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
  kernels.set(publicRuntime, internals);
  return publicRuntime;
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
      activeRow:
        interaction.activeRow.kind === "none"
          ? Object.freeze({ kind: "none" as const })
          : interaction.activeRow.activation === undefined
            ? Object.freeze({ ...interaction.activeRow })
            : Object.freeze({
                ...interaction.activeRow,
                activation: Object.freeze({
                  startsOn: Object.freeze([
                    ...interaction.activeRow.activation.startsOn,
                  ]),
                }),
              }),
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
      ...(interaction.activeRow.activation
        ? {
            activation: Object.freeze({
              startsOn: Object.freeze([
                ...interaction.activeRow.activation.startsOn,
              ]),
            }),
          }
        : {}),
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
  });
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
