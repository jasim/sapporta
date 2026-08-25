// Single home for all client-side sort/filter/window/aggregate logic.
// `inMemoryLevelSource` attaches `write`; `inMemoryReadonlyLevelSource` omits
// it. Runtime callers read `source.write` to decide whether mutation commands
// are available, so edit verbs never live on the read surface.
//
// Identity-stability contract: `snapshot()` returns the same object across
// no-op reads; on any state change the source allocates a new top-level
// snapshot, a new `nodes` array reference, and new `footerRows` only when
// aggregates moved. Mutated nodes are cloned (not mutated in place) so
// references inside an old snapshot's `nodes` array remain stable for any
// downstream consumer that still holds it.
//
// The runtime owns user-attributable mutation events; this source only
// mutates data and notifies snapshot subscribers.
//
// Reconciliation: the optimistic and authoritative values are equal by
// construction for an in-memory source, so `onReconcile` never fires.
// `'diverged'` and `'rejected'` are unreachable here because there is no
// authoritative async system that can disagree with the local write.
//
// Query semantics:
//   - `sortMode: 'client'` and `filterMode: 'client'` expose matching query
//     capabilities and apply them before publishing `snapshot.nodes`.
//   - `paginationMode: 'client'` slices rows inside this source. Pagination is
//     not exposed as a generic grid command.
//   - `sortMode: 'none'` / `filterMode: 'none'` means the source does not
//     expose that query capability.
//
// Aggregation: when an `aggregator` is supplied, it runs after
// sort/filter/window and its rollup payloads are merged into `node.rollup`
// (without mutating the original input nodes) and `footerRows` is published.
// Aggregates reflect the *visible* (post-filter, post-window) set, not the
// universe — the host opts in by passing `aggregator`.
//
// Pagination is never a derivation stage. Whether client or server, the source
// publishes already-windowed nodes. Displayed-row derivation cannot tell the
// difference and must not try.
//
// Input rows are structurally snapshotted on ingress so external mutation of
// nodes, columns, children, or footers cannot alter published source state.

import type { ColId, RowKey } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import type { FooterRow, TreeNode } from "../../types/level-row";
import type { RowPredicate, SortDescriptor } from "../../pipeline/types";
import { assertBoundedInteger } from "@sapporta/shared/validation";
import {
  assertTreeNodeCanBeInserted,
  assertUniqueTreeNodeRowKeys,
} from "../../row-identity";
import { createObserverList } from "../../observer-notification";
import type {
  LevelDataSource,
  LevelQueryCapabilities,
  LevelSnapshot,
  LevelSourceState,
  ReconcileEvent,
  SourceLoadResult,
  WriteCapability,
} from "../types";
import {
  filterSourceNodes,
  sliceSourceNodes,
  sortSourceNodes,
} from "../query-shaping";
import {
  createStructuralSnapshotCache,
  snapshotFooterRows,
  snapshotTreeNode,
  snapshotTreeNodes,
} from "../immutable-snapshot";

type ClientMode = "client" | "none";

export type InMemoryAggregator = (
  nodes: readonly TreeNode[],
  columns: readonly ColumnSchema[],
) => {
  perRowRollup: Map<RowKey, Record<ColId, unknown>>;
  footerRows: FooterRow[];
};

export type InMemoryLevelSourceOpts<F = unknown> = {
  initialNodes: readonly TreeNode[];
  columns: readonly ColumnSchema[];
  sortMode: ClientMode;
  filterMode: ClientMode;
  paginationMode: ClientMode;
  // Honored only when the corresponding mode is `'client'`. With mode
  // `'none'` the verb is ignored and the snapshot omits the field.
  initialSort?: readonly SortDescriptor[];
  initialFilter?: F;
  initialPage?: number;
  initialPageSize?: number;
  footerRows?: readonly FooterRow[];
  aggregator?: InMemoryAggregator;
  onObserverError?: (error: unknown) => void;
  // The host's grammar-to-predicate compiler — the trust boundary for
  // filtering. The host owns `F`, the host owns the compiler, the grid
  // calls the resulting `RowPredicate` without inspection. Required when
  // `filterMode === 'client'` (the source must actually filter); ignored
  // when `'none'`. Construction throws when this combination is wired
  // wrong, surfacing the contract at the boundary.
  compileFilter?: (filter: F | undefined) => RowPredicate | undefined;
};

type Core<F> = {
  read: LevelDataSource;
  // Edit verbs are present only on writable sources. The readonly factory omits
  // these verbs; the writable factory attaches this same implementation.
  write: WriteCapability;
  // Bulk replacement — primarily for hosts that hand the in-memory source
  // server-fetched rows. It is implementation-specific, so it stays off the
  // cross-source `LevelDataSource` contract.
  replaceNodes: (nodes: readonly TreeNode[]) => void;
  currentNodes: () => readonly TreeNode[];
};

// Returned shape for hosts that construct an in-memory source directly and want
// the `replaceNodes` verb. Cross-source code should depend on
// `LevelDataSource`; application code that owns this implementation can depend
// on the extra method.
export type InMemoryLevelSource = LevelDataSource & {
  write: WriteCapability;
  replaceNodes: (nodes: readonly TreeNode[]) => void;
};

const currentNodesBySource = new WeakMap<
  LevelDataSource,
  () => readonly TreeNode[]
>();

// Internal integration seam for the hierarchical in-memory grid source. It
// keeps the cross-source LevelDataSource contract free of implementation-only
// tree access while letting child resolution read the authoritative base rows
// of the exact live parent level.
export function currentInMemorySourceNodes(
  source: LevelDataSource,
): readonly TreeNode[] {
  const currentNodes = currentNodesBySource.get(source);
  if (!currentNodes) {
    throw new Error("currentInMemorySourceNodes: source is not in-memory");
  }
  return currentNodes();
}

function buildCore<F>(opts: InMemoryLevelSourceOpts<F>): Core<F> {
  if (opts.filterMode === "client" && !opts.compileFilter) {
    throw new Error(
      "inMemoryLevelSource: compileFilter is required when filterMode is 'client' — the source must compile the host's grammar to a RowPredicate",
    );
  }

  assertUniqueTreeNodeRowKeys(
    opts.initialNodes,
    "inMemoryLevelSource initialNodes",
  );
  const initialPage = opts.initialPage ?? 0;
  const initialPageSize = opts.initialPageSize ?? Number.POSITIVE_INFINITY;
  if (opts.paginationMode === "client") {
    assertPageWindow(initialPage, initialPageSize);
  }

  // Snapshot on ingress so caller-owned nodes and column records cannot mutate
  // a published source state without a source command and notification.
  let structuralSnapshots = createStructuralSnapshotCache();
  let baseNodes: readonly TreeNode[] = snapshotTreeNodes(
    opts.initialNodes,
    structuralSnapshots,
  );
  const configuredFooterRows = opts.footerRows
    ? snapshotFooterRows(opts.footerRows, structuralSnapshots)
    : undefined;
  let sort: readonly SortDescriptor[] | undefined =
    opts.sortMode === "client" ? opts.initialSort : undefined;
  let filter: F | undefined =
    opts.filterMode === "client" ? opts.initialFilter : undefined;
  let page = opts.paginationMode === "client" ? initialPage : 0;
  let pageSize =
    opts.paginationMode === "client"
      ? initialPageSize
      : Number.POSITIVE_INFINITY;

  const subscribers = createObserverList<[]>(opts.onObserverError);
  const reconcileSubscribers = createObserverList<[ReconcileEvent]>(
    opts.onObserverError,
  );
  let disposed = false;

  // Cached published state. Invalidated on any mutation so the next
  // `snapshot()` rebuilds — and stays stable across no-op reads.
  let cachedSnapshot: LevelSnapshot | null = null;
  let cachedState: LevelSourceState | null = null;
  let cachedRowKeyToBaseIdx: Map<RowKey, number> | null = null;
  let cachedShapeTotalCount = baseNodes.length;
  // Last-published `nodes` and `footerRows` references — held so the next
  // recompute can reuse them when content didn't actually change.
  let lastNodes: readonly TreeNode[] | null = null;
  let lastFooterRows: readonly FooterRow[] | undefined = undefined;

  function recompute(): void {
    let pipelineNodes: readonly TreeNode[] = baseNodes;

    let predicate: RowPredicate | undefined;
    if (opts.filterMode === "client" && filter !== undefined) {
      predicate = opts.compileFilter!(filter);
      pipelineNodes = filterSourceNodes(pipelineNodes, predicate);
    }

    if (opts.sortMode === "client") {
      pipelineNodes = sortSourceNodes(pipelineNodes, sort, opts.columns);
    }

    cachedShapeTotalCount = pipelineNodes.length;
    if (opts.paginationMode === "client") {
      const start = Number.isFinite(pageSize) ? page * pageSize : 0;
      pipelineNodes = sliceSourceNodes(pipelineNodes, {
        offset: start,
        limit: pageSize,
      });
    }

    // Build the rowKey index against original base references — sort/filter
    // shuffle the array but the node objects are still `===` to base entries
    // until the aggregator clones them. setCell/removeNode look up base
    // positions through this map.
    const rowKeyToBaseIdx = new Map<RowKey, number>();
    const baseIdxOf = new Map<TreeNode, number>();
    for (let i = 0; i < baseNodes.length; i++) baseIdxOf.set(baseNodes[i], i);
    for (let i = 0; i < pipelineNodes.length; i++) {
      const key = pipelineNodes[i].rowKey;
      const baseIdx = baseIdxOf.get(pipelineNodes[i]);
      if (baseIdx !== undefined) rowKeyToBaseIdx.set(key, baseIdx);
    }

    let publishedNodes: readonly TreeNode[] = pipelineNodes;
    let footerRows: readonly FooterRow[] | undefined = configuredFooterRows;
    if (opts.aggregator) {
      const result = opts.aggregator(pipelineNodes, opts.columns);
      if (result.perRowRollup.size > 0) {
        publishedNodes = pipelineNodes.map((n) => {
          const rollup = result.perRowRollup.get(n.rowKey);
          if (!rollup) return n;
          return { ...n, rollup: { ...(n.rollup ?? {}), ...rollup } };
        });
      }
      if (result.footerRows.length > 0) {
        footerRows = [...(footerRows ?? []), ...result.footerRows];
      }
    }

    // Reuse prior `nodes` / `footerRows` references when the content is
    // structurally identical, letting displayed-row derivation reuse rows
    // across writes that didn't actually change the published view.
    const immutableNodes = snapshotTreeNodes(
      publishedNodes,
      structuralSnapshots,
    );
    const immutableFooterRows = footerRows
      ? snapshotFooterRows(footerRows, structuralSnapshots)
      : undefined;
    const finalNodes = nodesEqual(lastNodes, immutableNodes)
      ? lastNodes!
      : immutableNodes;
    const finalFooters = footerRowsEqual(lastFooterRows, immutableFooterRows)
      ? lastFooterRows
      : immutableFooterRows;

    const snapshot: LevelSnapshot = finalFooters
      ? Object.freeze({ nodes: finalNodes, footerRows: finalFooters })
      : Object.freeze({ nodes: finalNodes });

    cachedSnapshot = snapshot;
    cachedState = Object.freeze({ status: "ready", snapshot });
    cachedRowKeyToBaseIdx = rowKeyToBaseIdx;
    lastNodes = finalNodes;
    lastFooterRows = finalFooters;
  }

  function ensureFresh(): void {
    if (cachedSnapshot === null) recompute();
  }

  function invalidate(): void {
    cachedSnapshot = null;
    cachedState = null;
    cachedRowKeyToBaseIdx = null;
  }

  function notify(): void {
    if (disposed) return;
    subscribers.notify();
  }

  function lookupBaseIdx(rowKey: RowKey): number {
    ensureFresh();
    const idx = cachedRowKeyToBaseIdx!.get(rowKey);
    if (idx === undefined) {
      throw new Error(`inMemoryLevelSource: no node with rowKey '${rowKey}'`);
    }
    return idx;
  }

  function readyResult(): Promise<SourceLoadResult> {
    // In-memory commands publish synchronously because all rows are local.
    // The resolved promise keeps the same caller contract as REST sources:
    // after `await source.query.sort?.set(...)`, `state()` already exposes the
    // recomputed ready snapshot.
    ensureFresh();
    const state = cachedState!;
    if (state.status !== "ready") {
      throw new Error("inMemoryLevelSource: expected ready state");
    }
    return Promise.resolve({ kind: "ready", state });
  }

  function unchangedResult(): Promise<SourceLoadResult> {
    ensureFresh();
    return Promise.resolve({ kind: "unchanged", state: cachedState! });
  }

  function applyOne(rowKey: RowKey, colId: ColId, value: unknown): void {
    const baseIdx = lookupBaseIdx(rowKey);
    const node = baseNodes[baseIdx];
    const next = baseNodes.slice();
    next[baseIdx] = snapshotTreeNode(
      {
        ...node,
        columns: { ...node.columns, [colId]: value },
      },
      structuralSnapshots,
    );
    baseNodes = Object.freeze(next);
  }

  function setSortQuery(
    nextSort: readonly SortDescriptor[] | undefined,
  ): Promise<SourceLoadResult> {
    if (sort === nextSort) return unchangedResult();
    sort = nextSort ? Object.freeze([...nextSort]) : undefined;
    invalidate();
    notify();
    return readyResult();
  }

  function setFilterQuery(
    nextFilter: F | undefined,
  ): Promise<SourceLoadResult> {
    if (filter === nextFilter) return unchangedResult();
    filter = nextFilter;
    invalidate();
    notify();
    return readyResult();
  }

  const query: {
    -readonly [
      Key in keyof LevelQueryCapabilities
    ]: LevelQueryCapabilities[Key];
  } = {};
  if (opts.sortMode === "client") {
    query.sort = {
      current: () => sort,
      set: setSortQuery,
    };
  }
  if (opts.filterMode === "client") {
    query.filter = {
      current: () => filter,
      set: (next) => setFilterQuery(next as F | undefined),
    };
  }

  const read: LevelDataSource = {
    state(): LevelSourceState {
      ensureFresh();
      return cachedState!;
    },
    subscribe(fn) {
      return subscribers.subscribe(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      reconcileSubscribers.clear();
    },
    ...(query.sort || query.filter || query.refetch ? { query } : {}),
  };

  const setCell: WriteCapability["setCell"] = (rowKey, colId, value) => {
    applyOne(rowKey, colId, value);
    invalidate();
    notify();
  };

  const applyChanges: WriteCapability["applyChanges"] = (changes) => {
    // Atomic from the grid's view: validate every rowKey resolves before
    // mutating anything. A throw here leaves baseNodes untouched.
    for (const c of changes) lookupBaseIdx(c.rowKey);
    for (const c of changes) applyOne(c.rowKey, c.colId, c.value);
    invalidate();
    notify();
  };

  const createNode: WriteCapability["createNode"] = async (node, atIndex) => {
    const createdNode = snapshotTreeNode(node, structuralSnapshots);
    assertTreeNodeCanBeInserted(
      baseNodes,
      createdNode,
      "inMemoryLevelSource.createNode",
    );
    const idx = atIndex === undefined ? baseNodes.length : atIndex;
    const next = baseNodes.slice();
    next.splice(idx, 0, createdNode);
    baseNodes = Object.freeze(next);
    invalidate();
    notify();
    return Object.freeze({ node: createdNode, atIndex: idx });
  };

  const removeNode: WriteCapability["removeNode"] = (rowKey) => {
    const baseIdx = lookupBaseIdx(rowKey);
    const next = baseNodes.slice();
    next.splice(baseIdx, 1);
    baseNodes = Object.freeze(next);
    invalidate();
    notify();
  };

  const replaceNodes: Core<F>["replaceNodes"] = (nodes) => {
    assertUniqueTreeNodeRowKeys(nodes, "inMemoryLevelSource.replaceNodes");
    structuralSnapshots = createStructuralSnapshotCache();
    baseNodes = snapshotTreeNodes(nodes, structuralSnapshots);
    invalidate();
    notify();
  };

  const onReconcile: WriteCapability["onReconcile"] = (fn) => {
    // Documented contract: in-memory sources never emit reconcile events
    // (optimistic === authoritative). We accept the subscription so callers
    // can wire it uniformly across source kinds, but no event will ever
    // fire on it.
    return reconcileSubscribers.subscribe(fn);
  };

  function canAppendRow(): boolean {
    if (opts.paginationMode === "none") return true;
    ensureFresh();
    const visibleCount = cachedSnapshot!.nodes.length;
    if (visibleCount === 0) return page === 0 && cachedShapeTotalCount === 0;
    if (!Number.isFinite(pageSize)) return true;
    return page * pageSize + visibleCount >= cachedShapeTotalCount;
  }

  return {
    read,
    write: {
      setCell,
      applyChanges,
      createNode,
      removeNode,
      onReconcile,
      canAppendRow,
    },
    replaceNodes,
    currentNodes: () => baseNodes,
  };
}

export function inMemoryLevelSource<F = unknown>(
  opts: InMemoryLevelSourceOpts<F>,
): InMemoryLevelSource {
  const core = buildCore<F>(opts);
  // Reproduce the read surface so the writable source has its own, fresh
  // identity object rather than sharing one with the readonly variant.
  const source: InMemoryLevelSource = {
    state: core.read.state,
    subscribe: core.read.subscribe,
    ...(core.read.query ? { query: core.read.query } : {}),
    dispose: core.read.dispose,
    write: core.write,
    replaceNodes: core.replaceNodes,
  };
  currentNodesBySource.set(source, core.currentNodes);
  return source;
}

export function inMemoryReadonlyLevelSource<F = unknown>(
  opts: InMemoryLevelSourceOpts<F>,
): LevelDataSource {
  const core = buildCore<F>(opts);
  const source: LevelDataSource = {
    state: core.read.state,
    subscribe: core.read.subscribe,
    ...(core.read.query ? { query: core.read.query } : {}),
    dispose: core.read.dispose,
  };
  currentNodesBySource.set(source, core.currentNodes);
  return source;
}

function assertPageWindow(page: number, pageSize: number): void {
  assertBoundedInteger(page, {
    name: "page",
    min: 0,
    makeError: (message) => new Error(message),
  });
  if (pageSize !== Number.POSITIVE_INFINITY) {
    assertBoundedInteger(pageSize, {
      name: "pageSize",
      min: 1,
      makeError: (message) => new Error(message),
    });
  }
}

function nodesEqual(
  prev: readonly TreeNode[] | null,
  next: readonly TreeNode[],
): boolean {
  if (prev === null) return false;
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
  return true;
}

function footerRowsEqual(
  prev: readonly FooterRow[] | undefined,
  next: readonly FooterRow[] | undefined,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a === b) continue;
    if (a.rowKey !== b.rowKey) return false;
    const ak = Object.keys(a.columns);
    const bk = Object.keys(b.columns);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a.columns[k] !== b.columns[k]) return false;
  }
  return true;
}
