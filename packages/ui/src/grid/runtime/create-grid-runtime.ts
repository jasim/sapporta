// The runtime — a plain TypeScript value (not React) that owns the
// grid's entire non-React state graph.
//
// Phase 08 keystone: the runtime holds a `GridSchema` + `GridDataSource`,
// derives `SchemaTopology` once, and rebuilds `PathTopology` whenever
// its child-source registry mutates. Sources own data, sort, filter,
// pagination, and status; the runtime owns expansion (via the
// coordinator), phantoms (via the channel), and per-path displayed-row
// stores that derive `DisplayedRowsInput` into full rows plus row sequences.
// There is no `applyTransaction` and no `nodes/sort/filter`-by-path map —
// those concerns live on the source.
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
//      navigation resolves on demand through `nextVisibleRow` and
//      dispatches focus directly to the target controller — no
//      pendingFocus mailbox.
//
//   4. DATA — `LevelDataSource` (per `GridPath`). Owns nodes,
//      sort/filter/pagination state, server-supplied footers/aggregates,
//      and `loading | error | ready` status. The runtime never owns data;
//      it receives a `GridDataSource` from the host and registers sources
//      as paths are expanded.
//
// The runtime is also the single seam through which writes flow:
// `writeCell`, `applyChanges`, `insertRow`, `removeRow`, and
// `commitPhantom` look up the source for that path, capture pre-state,
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
// For the three-channel invariant this wires together, see `index.ts`.

import { capabilitiesFor } from "../types/capabilities";
import {
  childPath as makeChildPath,
  decomposePath,
  makeRowId,
  rootPath,
  rowKeyOfRowId,
} from "../types/identity";
import type { ColId, Coord, GridPath, RowId, RowKey } from "../types/identity";
import type {
  DisplayedRows,
  DisplayedRowSequence,
  LevelRow,
  PhantomRow,
  TreeNode,
} from "../types/level-row";
import type { GridSchema, LevelSchema } from "../types/schema";
import { defaultRowKey } from "../pipeline/stages/build-data";
import type {
  CellChange,
  GridDataSource,
  LevelDataSource,
  LevelSnapshot,
  LevelStatus,
  RuntimeLevelDataSource,
  WritableLevelDataSource,
} from "../data-sources/types";
import {
  createDisplayedRowsStore,
  deriveDisplayedRowsState,
  type DisplayedRowsInput,
  type DisplayedRowsInvalidationReason,
  type DisplayedRowsStore,
  type DisplayedRowsViewState,
} from "../displayed-rows";
import {
  buildSchemaTopology,
  type SchemaTopology,
} from "../schema/schema-topology";
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
  createFocusManager,
  type FocusManager,
} from "../interaction/focus-manager";
import { createPhantomChannel } from "../data-sources/phantom-channel";
import { createEmitter, type GridEmitter, type GridEvents } from "./emitter";
import type { PhantomChannel } from "../data-sources/types";

export type RuntimeArgs = {
  schema: GridSchema;
  dataSource: GridDataSource;
  initialPhantomsByPath?: Map<GridPath, PhantomRow[]>;
  on?: { [E in keyof GridEvents]?: (payload: GridEvents[E]) => void };
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
  focusManager: FocusManager;
  phantoms: PhantomChannel;

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
  controllerFor: (path: GridPath) => GridControllerPublic;
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
  insertRow: (path: GridPath, node: TreeNode, atIndex?: number) => void;
  removeRow: (path: GridPath, rowKey: RowKey) => void;
  // Host-orchestrated phantom commit: read the phantom for `(path,
  // rowKey)`, build a `TreeNode` from its columns, call `insertNode`
  // on the path's source, then drop the phantom from the channel and
  // emit `phantomCommitted`. Atomic from the host's view: if
  // `insertNode` throws the phantom stays. Throws if the path's source
  // is readonly or no phantom exists for `rowKey`.
  commitPhantom: (path: GridPath, rowKey: RowKey, atIndex?: number) => void;

  on: GridEmitter["on"];
  dispose: () => void;
};

export function createGridRuntime(args: RuntimeArgs): GridRuntime {
  const { schema, dataSource } = args;
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

  // Memoized `LevelSchema` per path. The path's level name is a function
  // of the path string, so the entry is stable for the runtime's
  // lifetime — no invalidation needed.
  const schemaCache = new Map<GridPath, LevelSchema>();

  // useSyncExternalStore-style subscribers fired on every registry-key
  // change. Replaces the old `subscribePathTopology` — consumers who
  // previously rebuilt a topology now re-read whatever they need
  // (commonly `materializedChildren`) on the next tick.
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
    const status = src.snapshot().status;
    const prev = lastStatusByPath.get(path);
    if (prev !== status) {
      lastStatusByPath.set(path, status);
      const error = src.snapshot().error;
      emitter.emit(
        "levelStatusChanged",
        error ? { path, status, error } : { path, status },
      );
    }
  }

  // Eagerly install the root so initial reads (snapshotFor,
  // displayedRowsFor) do not race the first expansion. Root sources
  // never come from `resolveChild`, so a separate code path here keeps
  // `ensureChildSources` focused on the child-path case.
  {
    const src = dataSource.rootSource();
    sources.set(root, src);
    lastStatusByPath.set(root, src.snapshot().status);
    sourceUnsubs.set(
      root,
      src.subscribe(() => {
        onSourceSnapshotChanged(root);
        invalidateDisplayedRows(root, { type: "source" });
      }),
    );
    if (src.writable) {
      reconcileUnsubs.set(
        root,
        src.onReconcile((event) => {
          emitter.emit("cellReconciled", { path: root, event });
        }),
      );
    }
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
      lastStatusByPath.set(childPath, src.snapshot().status);
      sourceUnsubs.set(
        childPath,
        src.subscribe(() => {
          onSourceSnapshotChanged(childPath);
          invalidateDisplayedRows(childPath, { type: "source" });
        }),
      );
      if (src.writable) {
        reconcileUnsubs.set(
          childPath,
          src.onReconcile((event) => {
            emitter.emit("cellReconciled", { path: childPath, event });
          }),
        );
      }
      bumped = true;
    }
    if (bumped) notifyRegistryChanged();
  }

  function snapshotFor(path: GridPath): LevelSnapshot {
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
    return src.snapshot();
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
    view = {
      writable: src.writable,
      snapshot: () => {
        assertLive();
        return src.snapshot();
      },
      subscribe: (fn) => {
        assertLive();
        return src.subscribe(fn);
      },
      setSort: (sort) => {
        assertLive();
        src.setSort(sort);
      },
      setFilter: (filter) => {
        assertLive();
        src.setFilter(filter);
      },
      setPage: (page, pageSize) => {
        assertLive();
        src.setPage(page, pageSize);
      },
      refetch: () => {
        assertLive();
        src.refetch();
      },
      onReconcile(fn) {
        assertLive();
        if (!src.writable) return () => {};
        return src.onReconcile(fn);
      },
    };
    sourceViews.set(path, view);
    return view;
  }

  function requireWritable(path: GridPath): WritableLevelDataSource {
    assertLive();
    const src = sources.get(path);
    if (!src) {
      throw new Error(
        `GridRuntime: no source has been resolved for path "${path}". Expand the parent row first.`,
      );
    }
    if (!src.writable) {
      throw new Error(
        `GridRuntime: source for path "${path}" is readonly — writeCell/applyChanges/insertRow/removeRow are not available.`,
      );
    }
    return src;
  }

  function writeCell(path: GridPath, coord: Coord, value: unknown): void {
    const src = requireWritable(path);
    const rowKey = rowKeyOfRowId(coord.rowId);
    const oldValue = readCellValue(
      src.snapshot(),
      schemaForPath(path),
      rowKey,
      coord.colId,
    );
    src.setCell(rowKey, coord.colId, value);
    emitter.emit("mutationCommitted", {
      kind: "cell",
      path,
      coord,
      oldValue,
      newValue: value,
    });
  }

  function commitPhantom(
    path: GridPath,
    rowKey: RowKey,
    atIndex?: number,
  ): void {
    const src = requireWritable(path);
    const phantom = phantoms.get(path).find((p) => p.rowKey === rowKey);
    if (!phantom) {
      throw new Error(
        `GridRuntime.commitPhantom: no phantom with rowKey "${rowKey}" at path "${path}".`,
      );
    }
    const node = {
      levelName: schemaForPath(path).name,
      columns: phantom.columns,
    };
    const actualIndex = atIndex ?? src.snapshot().nodes.length;
    src.insertNode(node, atIndex);
    phantoms.remove(path, rowKey);
    emitter.emit("mutationCommitted", {
      kind: "insert",
      path,
      node,
      atIndex: actualIndex,
    });
    emitter.emit("phantomCommitted", { path, rowKey });
  }

  function applyChanges(path: GridPath, changes: CellChange[]): void {
    const src = requireWritable(path);
    const levelSchema = schemaForPath(path);
    const snapshot = src.snapshot();
    // Read prior values BEFORE the source applies the change — once
    // applyChanges returns, the snapshot will reflect the writes and
    // we can no longer recover the priors for the events.
    const priors = changes.map((c) =>
      readCellValue(snapshot, levelSchema, c.rowKey, c.colId),
    );
    src.applyChanges(changes);
    const edits = changes.map((c, i) => ({
      coord: { rowId: makeRowId(path, c.rowKey), colId: c.colId },
      oldValue: priors[i],
      newValue: c.value,
    }));
    emitter.emit("mutationCommitted", { kind: "cells", path, edits });
  }

  function insertRow(path: GridPath, node: TreeNode, atIndex?: number): void {
    const src = requireWritable(path);
    const actualIndex = atIndex ?? src.snapshot().nodes.length;
    src.insertNode(node, atIndex);
    emitter.emit("mutationCommitted", {
      kind: "insert",
      path,
      node,
      atIndex: actualIndex,
    });
  }

  function removeRow(path: GridPath, rowKey: RowKey): void {
    const src = requireWritable(path);
    const { node, index } = readNodeWithIndex(
      src.snapshot(),
      schemaForPath(path),
      rowKey,
    );
    src.removeNode(rowKey);
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
  let focusManagerRef: FocusManager | null = null;
  const coordinator: GridCoordinatorStore = createGridCoordinator({
    getRuntime: () => {
      if (!runtimeRef) {
        throw new Error(
          "GridRuntime: coordinator queried before runtime was constructed",
        );
      }
      return runtimeRef;
    },
    getFocusManager: () => {
      if (!focusManagerRef) {
        throw new Error(
          "GridRuntime: coordinator queried focus manager before runtime was constructed",
        );
      }
      return focusManagerRef;
    },
    capabilitiesFor,
    onExpand: (path, rowId) => ensureChildSources(path, rowId),
  });

  // Focus manager — sole writer of `coordinator.cursor` and every
  // controller's `liveFocus`.
  const focusManager = createFocusManager({
    coordinator,
    controllerFocusPortFor: (path) => controllerFocusPortFor(path),
  });
  focusManagerRef = focusManager;

  function controllerFocusPortFor(path: GridPath): GridControllerStore {
    let c = controllers.get(path);
    if (c) return c;
    c = createGridController({
      path,
      getDisplayed: () => displayedRowsFor(path),
      getSchema: () => schemaForPath(path).columns,
      capabilitiesFor,
      onNavigate: (intent) => {
        coordinator.navigate(path, intent);
      },
      clearRange: (path) => focusManager.clearRange(path),
      writeValue: (coord, newValue) => {
        writeCell(path, coord, newValue);
      },
    });
    controllers.set(path, c);
    const unsub = c.subscribe((s, prev) => {
      if (s.selection !== prev.selection) {
        emitter.emit("selectionChanged", { path, selection: s.selection });
      }
    });
    controllerUnsubs.push(unsub);
    return c;
  }

  function controllerFor(path: GridPath): GridControllerPublic {
    assertLive();
    return controllerFocusPortFor(path);
  }

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
    schemaCache.clear();
    lastStatusByPath.clear();
    dataSource.dispose();
    emitter.clear();
  }

  const runtime: GridRuntime = {
    schema,
    schemaTopology,
    registeredPaths,
    subscribeRegistry,
    coordinator,
    focusManager,
    phantoms,
    displayedRowsFor,
    displayedRowSequenceFor,
    displayedRowFor,
    subscribeDisplayedRowSequence,
    subscribeDisplayedRow,
    invalidateDisplayedRows,
    snapshotFor,
    controllerFor,
    schemaAt: schemaForPath,
    materializedChildren,
    sourceFor,
    writeCell,
    applyChanges,
    insertRow,
    removeRow,
    commitPhantom,
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
