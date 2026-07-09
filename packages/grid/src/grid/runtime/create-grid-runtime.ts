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
  decomposePath,
  makeRowId,
  phantomKeyFromDisplayedRowId,
  rootPath,
  rowKeyOfRowId,
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
import { defaultRowKey } from "../pipeline/stages/build-data";
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
  type CursorManager,
} from "../interaction/cursor-manager";
import { createPhantomChannel } from "../data-sources/phantom-channel";
import { createEmitter, type GridEmitter, type GridEvents } from "./emitter";
import type { PhantomChannel } from "../data-sources/types";
import { createPhantomRowLifecycle } from "./phantom-row-lifecycle";
import { rowsInSelection } from "../types/selection";
import {
  firstFocusableRow,
  lastFocusableRow,
} from "../types/level-row-traversal";

export type RuntimeArgs = {
  schema: GridSchema;
  dataSource: GridDataSource;
  interaction?: GridInteractionConfig;
  initialPhantomsByPath?: Map<GridPath, PhantomRow[]>;
  phantomRows?: PhantomRowsConfig;
  // A host can own displayed-row edge policy for loaded windows. The runtime
  // emits a boundary event and waits for the host/source load promise. After a
  // ready result, it samples displayed rows and lands on the requested edge.
  onLoadedRowsBoundary?: (
    event: LoadedRowsBoundaryEvent,
  ) => Promise<SourceLoadResult> | false;
  on?: { [E in keyof GridEvents]?: (payload: GridEvents[E]) => void };
};

type RowOperationTarget = {
  path: GridPath;
  rowId: RowId;
  rowKey: RowKey;
  row: LevelRow;
};

export type GridRuntime = {
  schema: GridSchema;
  schemaTopology: SchemaTopology;
  // Fires every time the child-source registry's key set changes — e.g.
  // when a row's first expansion installs a new child source. Status
  // flips do NOT trigger this; status is read lazily through
  // `snapshotFor` at the call site.
  registeredPaths: () => GridPath[];
  subscribeRegistry: (fn: () => void) => () => void;

  coordinator: GridCoordinatorPublic;
  cursorManager: CursorManager;
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
  applyChanges: (path: GridPath, changes: CellChange[]) => void;
  // Runtime-owned row insertion/removal. These are the host-facing row
  // mutation verbs; the concrete source verbs are private to the runtime.
  createRow: (
    path: GridPath,
    node: TreeNode,
    atIndex?: number,
  ) => Promise<CreateNodeResult>;
  removeRow: (path: GridPath, rowKey: RowKey) => Promise<void>;
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
  promise: Promise<CreateNodeResult>;
  node: TreeNode;
  atIndex?: number;
};

export type LoadedRowsBoundaryEvent =
  | {
      kind: "cell";
      loadPath: GridPath;
      direction: "before" | "after";
      origin: CellCursor;
      colPolicy: ColPolicy;
      extend: boolean;
    }
  | {
      kind: "row";
      loadPath: GridPath;
      direction: "before" | "after";
      origin: RowCursor;
      extend: boolean;
    };

type PendingLoadedRowsBoundary = LoadedRowsBoundaryEvent;

export function createGridRuntime(args: RuntimeArgs): GridRuntime {
  const { schema, dataSource } = args;
  const interaction = normalizeInteraction(args.interaction);
  const schemaTopology = buildSchemaTopology(schema);

  const emitter = createEmitter();
  const phantoms = createPhantomChannel(args.initialPhantomsByPath);

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
  const sourceViews = new Map<GridPath, RuntimeLevelDataSource>();
  const sourceUnsubs = new Map<GridPath, () => void>();
  const reconcileUnsubs = new Map<GridPath, () => void>();
  const lastStatusByPath = new Map<GridPath, LevelStatus>();
  const pendingPhantomCreates = new Map<string, PendingPhantomCreate>();
  let pendingLoadedRowsBoundary: PendingLoadedRowsBoundary | null = null;
  const phantomLifecycle = createPhantomRowLifecycle({
    config: args.phantomRows,
    getSource: (path) => sources.get(path),
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

  const root = rootPath(schemaTopology.rootLevelName);
  let disposed = false;

  function assertLive(): void {
    if (disposed) {
      throw new Error("GridRuntime has been disposed.");
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
  const controllerUnsubs: Array<() => void> = [];
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

  // useSyncExternalStore-style subscribers fired on every registry-key
  // change. Consumers re-read the path-derived view they need, commonly
  // `materializedChildren`, on the next tick.
  const registryListeners = new Set<() => void>();
  let registeredPathSnapshot: GridPath[] | null = null;

  function registeredPaths(): GridPath[] {
    assertLive();
    if (!registeredPathSnapshot) {
      registeredPathSnapshot = Array.from(sources.keys());
    }
    return registeredPathSnapshot;
  }

  function subscribeRegistry(fn: () => void): () => void {
    assertLive();
    registryListeners.add(fn);
    return () => {
      registryListeners.delete(fn);
    };
  }

  function notifyRegistryChanged(): void {
    registeredPathSnapshot = null;
    for (const fn of registryListeners) fn();
  }

  function levelNameOf(path: GridPath): string {
    const decomp = decomposePath(path);
    return decomp.edges.length === 0
      ? decomp.rootLevelName
      : decomp.edges[decomp.edges.length - 1].levelName;
  }

  function onSourceSnapshotChanged(path: GridPath): void {
    const src = sources.get(path);
    if (!src) return;
    const state = src.state();
    const status = state.status;
    const prev = lastStatusByPath.get(path);
    if (prev !== status) {
      lastStatusByPath.set(path, status);
      const error = "error" in state ? state.error : undefined;
      emitter.emit(
        "levelStatusChanged",
        error ? { path, status, error } : { path, status },
      );
    }
    phantomLifecycle.reconcileBlankAppendPhantoms(path);
    phantomLifecycle.ensureBlankForEmptyPath(path);
  }

  // Eagerly install the root so initial reads (snapshotFor,
  // displayedRowsFor) do not race the first expansion. Root sources
  // never come from `resolveChild`, so a separate code path here keeps
  // `ensureChildSources` focused on the child-path case.
  {
    const src = dataSource.rootSource();
    sources.set(root, src);
    lastStatusByPath.set(root, src.state().status);
    sourceUnsubs.set(
      root,
      src.subscribe(() => {
        onSourceSnapshotChanged(root);
        invalidateDisplayedRows(root, { type: "source" });
        // After a host-owned boundary load, the cursor should land on rows
        // from the window the app just loaded. Recompute displayed rows first
        // so the landing target comes from current source state, not the
        // previous window.
        resolvePendingLoadedRowsBoundary(root);
      }),
    );
    if (src.write) {
      reconcileUnsubs.set(
        root,
        src.write.onReconcile((event) => {
          emitter.emit("cellReconciled", { path: root, event });
        }),
      );
    }
    phantomLifecycle.ensureBlankForEmptyPath(root);
    notifyRegistryChanged();
  }

  function ensureChildSources(parentPath: GridPath, rowId: RowId): void {
    const parentLevelName = levelNameOf(parentPath);
    const childLevels = schemaTopology.childLevelsOf(parentLevelName);
    if (childLevels.length === 0) return;
    const parentRowKey = rowKeyOfRowId(rowId);
    let bumped = false;
    for (const childLevelName of childLevels) {
      const childPath = makeChildPath(parentPath, parentRowKey, childLevelName);
      if (sources.has(childPath)) continue;
      const src = dataSource.resolveChild(
        parentPath,
        parentRowKey,
        childLevelName,
      );
      sources.set(childPath, src);
      lastStatusByPath.set(childPath, src.state().status);
      sourceUnsubs.set(
        childPath,
        src.subscribe(() => {
          onSourceSnapshotChanged(childPath);
          invalidateDisplayedRows(childPath, { type: "source" });
          // Expanded child tables load boundaries independently. A parent
          // refresh should not finish a pending boundary load inside a child
          // table, or vice versa.
          resolvePendingLoadedRowsBoundary(childPath);
        }),
      );
      if (src.write) {
        reconcileUnsubs.set(
          childPath,
          src.write.onReconcile((event) => {
            emitter.emit("cellReconciled", { path: childPath, event });
          }),
        );
      }
      phantomLifecycle.ensureBlankForEmptyPath(childPath);
      bumped = true;
    }
    if (bumped) notifyRegistryChanged();
  }

  function snapshotFor(path: GridPath): LevelSnapshot {
    return sourceStateFor(path).snapshot;
  }

  function sourceStateFor(path: GridPath): LevelSourceState {
    assertLive();
    const src = sources.get(path);
    if (!src) {
      const root = rootPath(schemaTopology.rootLevelName);
      throw new Error(
        path === root
          ? `GridRuntime.snapshotFor: root source for "${path}" is missing. The runtime was initialized inconsistently or has been disposed.`
          : `GridRuntime.snapshotFor: no source has been resolved for path "${path}". Expand the parent row first or invoke runtime.sourceFor on a known path.`,
      );
    }
    return src.state();
  }

  function schemaForPath(path: GridPath): LevelSchema {
    assertLive();
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
    });
    displayedRowsStoresByPath.set(path, store);
    phantomSubscriptionUnsubs.set(
      path,
      phantoms.subscribe(path, () => {
        invalidateDisplayedRows(path, { type: "phantoms" });
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
    assertLive();
    const store = displayedRowsStoresByPath.get(path);
    if (!store) {
      return;
    }
    store.invalidateDisplayedRows(reason);
    // Data/view changes may make a stored row selection invalid: a selected row
    // can be filtered out, deleted, or become non-row-selectable. The reverse
    // is not true — row selection changes must not invalidate displayed rows.
    reconcileRowSelection(path);
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
    if (next !== current) controller.setRowSelection(next);
  }

  function requestLoadedRowsBoundary(
    event: PendingLoadedRowsBoundary,
  ): boolean {
    assertLive();
    const src = sources.get(event.loadPath);
    if (!src) return false;
    // While rows are loading, repeated key presses should not skip ahead based
    // on stale counts. Wait until the latest rows are settled before accepting
    // another boundary turn.
    const state = src.state();
    if (state.status !== "ready") return false;
    const hostLoad = args.onLoadedRowsBoundary?.(event);
    if (!hostLoad) return false;
    pendingLoadedRowsBoundary = event;
    // The host promise describes the source load, not React paint. Source
    // subscriptions may already have resolved the pending landing before the
    // promise callback runs. Keep both paths legal: a ready promise performs a
    // final sample if needed, and non-ready outcomes clear only the still-live
    // intent.
    void hostLoad.then((result) => {
      if (result.kind === "ready") {
        resolvePendingLoadedRowsBoundary(event.loadPath);
        return;
      }
      if (pendingLoadedRowsBoundary === event) {
        pendingLoadedRowsBoundary = null;
      }
    });
    return true;
  }

  function resolvePendingLoadedRowsBoundary(path: GridPath): void {
    const pending = pendingLoadedRowsBoundary;
    if (!pending || pending.loadPath !== path) return;

    const state = sourceStateFor(path);
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

    if (pending.kind === "cell") {
      const target = pendingLoadedRowsBoundaryCellTarget(pending);
      pendingLoadedRowsBoundary = null;
      if (!target) return;
      if (pending.extend) {
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

    const target = pendingLoadedRowsBoundaryRowTarget(pending);
    pendingLoadedRowsBoundary = null;
    if (!target) return;
    if (pending.extend) {
      cursorManager.extendRowSelectionToCursor(target);
    } else {
      cursorManager.moveRowCursorTo(target);
    }
    controllerCursorPortFor(target.path).revealRow(target.rowId);
  }

  function pendingLoadedRowsBoundaryCellTarget(
    pending: Extract<PendingLoadedRowsBoundary, { kind: "cell" }>,
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
    pending: Extract<PendingLoadedRowsBoundary, { kind: "row" }>,
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
    assertLive();
    const src = sources.get(path);
    if (!src) {
      const root = rootPath(schemaTopology.rootLevelName);
      throw new Error(
        path === root
          ? `GridRuntime.sourceFor: root source for "${path}" is missing. The runtime was initialized inconsistently or has been disposed.`
          : `GridRuntime.sourceFor: no source has been resolved for path "${path}". Expand the parent row first.`,
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
                sort: {
                  current: () => {
                    assertLive();
                    return sourceQuery.sort!.current();
                  },
                  set: (sort) => {
                    assertLive();
                    return sourceQuery.sort!.set(sort);
                  },
                },
              }
            : {}),
          ...(sourceQuery.filter
            ? {
                filter: {
                  current: () => {
                    assertLive();
                    return sourceQuery.filter!.current();
                  },
                  set: (filter) => {
                    assertLive();
                    return sourceQuery.filter!.set(filter);
                  },
                },
              }
            : {}),
          ...(sourceQuery.refetch
            ? {
                refetch: () => {
                  assertLive();
                  return sourceQuery.refetch!();
                },
              }
            : {}),
        }
      : undefined;
    view = {
      canWrite: src.write !== undefined,
      state: () => {
        assertLive();
        return src.state();
      },
      subscribe: (fn) => {
        assertLive();
        return src.subscribe(fn);
      },
      ...(query ? { query } : {}),
      onReconcile(fn) {
        assertLive();
        if (!src.write) return () => {};
        return src.write.onReconcile(fn);
      },
    };
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
      source.state().snapshot,
      schemaForPath(path),
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
    const pendingKey = phantomCreateKey(path, rowKey);
    const pending = pendingPhantomCreates.get(pendingKey);
    if (pending) return pending.promise;

    const phantom = phantoms.get(path).find((p) => p.rowKey === rowKey);
    if (!phantom) {
      return Promise.reject(
        new Error(
          `GridRuntime.commitPhantomRow: no phantom with rowKey "${rowKey}" at path "${path}".`,
        ),
      );
    }
    if (phantom.state.kind === "saving") {
      return Promise.reject(
        new Error(
          `GridRuntime.commitPhantomRow: phantom with rowKey "${rowKey}" at path "${path}" is already saving.`,
        ),
      );
    }
    if (phantomLifecycle.isBlank(phantom.columns)) {
      return Promise.reject(
        new Error(
          `GridRuntime.commitPhantomRow: phantom with rowKey "${rowKey}" at path "${path}" is blank.`,
        ),
      );
    }
    phantoms.setState(path, rowKey, { kind: "saving" });
    const node: TreeNode = {
      levelName: schemaForPath(path).name,
      columns: { ...phantom.columns },
    };
    const promise = (async () => {
      try {
        const result = await createRow(path, node, atIndex);
        phantoms.remove(path, rowKey);
        emitter.emit("phantomRowCommitted", { path, rowKey, ...result });
        return result;
      } catch (err) {
        const reason = reasonOf(err);
        phantoms.setState(path, rowKey, { kind: "failed", reason });
        emitter.emit("phantomRowCreateFailed", { path, rowKey, reason });
        throw err;
      } finally {
        pendingPhantomCreates.delete(pendingKey);
      }
    })();
    pendingPhantomCreates.set(pendingKey, { promise, node, atIndex });
    return promise;
  }

  function applyChanges(path: GridPath, changes: CellChange[]): void {
    const { source, write } = requireWritable(path);
    const levelSchema = schemaForPath(path);
    const snapshot = source.state().snapshot;
    // Read prior values BEFORE the source applies the change. Once
    // applyChanges returns, the snapshot reflects the writes and the prior
    // values are unavailable for mutation events.
    const priors = changes.map((c) =>
      readCellValue(snapshot, levelSchema, c.rowKey, c.colId),
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
    const result = await write.createNode(node, atIndex);
    emitter.emit("mutationCommitted", {
      kind: "insert",
      path,
      node: result.node,
      atIndex: result.atIndex,
    });
    return result;
  }

  async function removeRow(path: GridPath, rowKey: RowKey): Promise<void> {
    const { source, write } = requireWritable(path);
    const { node, index } = readNodeWithIndex(
      source.state().snapshot,
      schemaForPath(path),
      rowKey,
    );
    await write.removeNode(rowKey);
    emitter.emit("mutationCommitted", {
      kind: "remove",
      path,
      node,
      atIndex: index,
    });
  }

  // Coordinator reads runtime state through `getRuntime` — it never holds
  // a derived view, so a freshly resolved child source or a freshly
  // applied sort is reflected on the next call without explicit
  // invalidation. The reference is late-bound because the runtime
  // object is built below.
  let runtimeRef: GridRuntime | null = null;
  let cursorManagerRef: CursorManager | null = null;
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
    controllerUnsubs.push(unsub);
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
        cursorManager.setRowSelection(
          path,
          rowSelectionHasRow(current, rowId, displayed)
            ? null
            : makeSingleRowSelection(rowId),
        );
        return;
      }
      // Multi/range toggles rebuild from displayed-order projection. That
      // keeps the stored Set independent of insertion order and automatically
      // drops rows that are no longer displayed or row-selectable.
      const ids = new Set(rowIdsInRowSelection(current, displayed));
      if (ids.has(rowId)) ids.delete(rowId);
      else ids.add(rowId);
      cursorManager.setRowSelection(path, makeRowSetSelection(ids));
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
    },
    extendRowSelectionToCursor(target) {
      if (interaction.mode !== "row-list") return;
      cursorManager.extendRowSelectionToCursor(target);
    },
    clearRowSelection(path) {
      cursorManager.clearRowSelection(path);
    },
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const u of controllerUnsubs) u();
    controllerUnsubs.length = 0;
    for (const u of sourceUnsubs.values()) u();
    sourceUnsubs.clear();
    for (const u of reconcileUnsubs.values()) u();
    reconcileUnsubs.clear();
    for (const src of sources.values()) src.dispose();
    sources.clear();
    sourceViews.clear();
    registeredPathSnapshot = null;
    for (const store of displayedRowsStoresByPath.values()) store.dispose();
    displayedRowsStoresByPath.clear();
    for (const unsub of phantomSubscriptionUnsubs.values()) unsub();
    phantomSubscriptionUnsubs.clear();
    controllers.clear();
    activeRowSnapshots.clear();
    selectedRowsSnapshots.clear();
    selectedRowIdSnapshots.clear();
    rowInteractionSnapshots.clear();
    schemaCache.clear();
    lastStatusByPath.clear();
    pendingLoadedRowsBoundary = null;
    dataSource.dispose();
    emitter.clear();
  }

  const runtime: GridRuntime = {
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
    commitPhantomRow,
    phantomBoundaryCellTarget: phantomLifecycle.boundaryCellTarget,
    phantomBoundaryRowTarget: phantomLifecycle.boundaryRowTarget,
    requestLoadedRowsBoundary,
    on: emitter.on,
    dispose,
  };
  runtimeRef = runtime;
  return runtime;
}

// Read a cell value from a snapshot using the level schema's rowKey function.
// The runtime needs the prior value in `mutationCommitted` before the source
// applies the write, and the only reliable row lookup is the same keying
// function the source uses.
function readCellValue(
  snapshot: LevelSnapshot,
  schema: LevelSchema,
  rowKey: RowKey,
  colId: ColId,
): unknown {
  const rowKeyFn = schema.options.rowKey ?? defaultRowKey;
  for (let i = 0; i < snapshot.nodes.length; i++) {
    const node = snapshot.nodes[i];
    if (rowKeyFn(node, i) === rowKey) {
      return node.columns[colId];
    }
  }
  return undefined;
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
  schema: LevelSchema,
  rowKey: RowKey,
): { node: TreeNode; index: number } {
  const rowKeyFn = schema.options.rowKey ?? defaultRowKey;
  for (let i = 0; i < snapshot.nodes.length; i++) {
    const node = snapshot.nodes[i];
    if (rowKeyFn(node, i) === rowKey) {
      return { node, index: i };
    }
  }
  throw new Error(`GridRuntime.removeRow: no node with rowKey '${rowKey}'`);
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
