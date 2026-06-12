// Single home for all client-side sort/filter/paginate/aggregate logic.
// `inMemoryLevelSource` is the writable variant; `inMemoryReadonlyLevelSource`
// drops the edit verbs and reconciliation channel so a host that wants a
// derived readonly level cannot accidentally call `setCell` on it
// (the discriminated union enforces this at compile time, the missing
// keys at runtime).
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
// construction for an in-memory source, so `onReconcile` never fires. The
// design doc (L217) permits either "skip emission" or "fire `agreed` sync"
// for in-memory; we pick skip — fewer events keeps tests stable and the
// host can detect "nothing reconciled" by `writable: true` plus a sync
// source. `'diverged'` and `'rejected'` are unreachable here.
//
// Mode semantics:
//   - `serverManaged` is always `{ sort: false, filter: false, pagination: false }`
//     because this source applied those concerns itself.
//   - `sortMode: 'none'` / `filterMode: 'none'` / `paginationMode: 'none'`
//     means the verb is a no-op and the snapshot omits the field —
//     chrome won't render paging controls for a level that doesn't page.
//   - These are orthogonal: `'client'` means the source applies the concern
//     and publishes the result; `'none'` means the concern is absent.
//     Displayed-row derivation never sees an in-memory source with
//     `serverManaged` flags.
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
// The input `initialNodes` array is copied on construction so external
// mutation of the input doesn't bleed into the source's snapshots.

import type { ColId, RowKey } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import type { FooterRow, LevelOptions, TreeNode } from "../../types/level-row";
import type { RowPredicate, SortDescriptor } from "../../pipeline/types";
import { makeRowComparator } from "../../pipeline/stages/sort-impl";
import { defaultRowKey } from "../../pipeline/stages/build-data";
import type {
  LevelSnapshot,
  ReadonlyLevelDataSource,
  ReconcileEvent,
  WritableLevelDataSource,
} from "../types";

type ClientMode = "client" | "none";

export type InMemoryAggregator = (
  nodes: TreeNode[],
  columns: ColumnSchema[],
) => {
  perRowRollup: Map<RowKey, Record<ColId, unknown>>;
  footerRows: FooterRow[];
};

export type InMemoryLevelSourceOpts<F = unknown> = {
  initialNodes: TreeNode[];
  options: LevelOptions;
  columns: ColumnSchema[];
  sortMode: ClientMode;
  filterMode: ClientMode;
  paginationMode: ClientMode;
  // Honored only when the corresponding mode is `'client'`. With mode
  // `'none'` the verb is ignored and the snapshot omits the field.
  initialSort?: SortDescriptor[];
  initialFilter?: F;
  initialPage?: number;
  initialPageSize?: number;
  aggregator?: InMemoryAggregator;
  // The host's grammar-to-predicate compiler — the trust boundary for
  // filtering. The host owns `F`, the host owns the compiler, the grid
  // calls the resulting `RowPredicate` without inspection. Required when
  // `filterMode === 'client'` (the source must actually filter); ignored
  // when `'none'`. Construction throws when this combination is wired
  // wrong, surfacing the contract at the boundary.
  compileFilter?: (filter: F | undefined) => RowPredicate | undefined;
};

// `Object.freeze` so accidental writes from a host or a future stage fail
// loudly instead of silently corrupting the shared sentinel.
const SERVER_MANAGED = Object.freeze({
  sort: false,
  filter: false,
  pagination: false,
}) as { sort: false; filter: false; pagination: false };

type Core<F> = {
  read: ReadonlyLevelDataSource;
  // Edit verbs — present only on writable sources, but built here so the
  // readonly factory can simply omit them rather than wire a separate
  // implementation.
  setCell: WritableLevelDataSource["setCell"];
  applyChanges: WritableLevelDataSource["applyChanges"];
  createNode: WritableLevelDataSource["createNode"];
  removeNode: WritableLevelDataSource["removeNode"];
  onReconcile: WritableLevelDataSource["onReconcile"];
  // Bulk replacement — primarily for hosts that hand the in-memory
  // source server-fetched rows. Not part of the cross-source
  // `WritableLevelDataSource` contract; a host that wants this verb knows
  // it is talking to an in-memory source.
  replaceNodes: (nodes: TreeNode[]) => void;
};

// Returned shape for hosts that construct an in-memory source directly
// and want the `replaceNodes` verb. The cross-source surface remains
// `WritableLevelDataSource`; widen here only when the host knows it
// owns the implementation.
export type InMemoryLevelSource = WritableLevelDataSource & {
  replaceNodes: (nodes: TreeNode[]) => void;
};

function buildCore<F>(opts: InMemoryLevelSourceOpts<F>): Core<F> {
  if (opts.filterMode === "client" && !opts.compileFilter) {
    throw new Error(
      "inMemoryLevelSource: compileFilter is required when filterMode is 'client' — the source must compile the host's grammar to a RowPredicate",
    );
  }

  const rowKeyFn = opts.options.rowKey ?? defaultRowKey;
  const initialPage = opts.initialPage ?? 0;
  const initialPageSize = opts.initialPageSize ?? Number.POSITIVE_INFINITY;

  // Copy on construction so external mutation of `initialNodes` doesn't
  // bleed into our snapshots after-the-fact.
  let baseNodes: TreeNode[] = opts.initialNodes.slice();
  let sort: SortDescriptor[] | undefined =
    opts.sortMode === "client" ? opts.initialSort : undefined;
  let filter: F | undefined =
    opts.filterMode === "client" ? opts.initialFilter : undefined;
  let page = opts.paginationMode === "client" ? initialPage : 0;
  let pageSize =
    opts.paginationMode === "client"
      ? initialPageSize
      : Number.POSITIVE_INFINITY;

  const subs = new Set<() => void>();
  const reconcileSubs = new Set<(e: ReconcileEvent) => void>();
  let disposed = false;

  // Cached published state. Invalidated on any mutation so the next
  // `snapshot()` rebuilds — and stays stable across no-op reads.
  let cachedSnapshot: LevelSnapshot<F> | null = null;
  let cachedRowKeyToBaseIdx: Map<RowKey, number> | null = null;
  // Last-published `nodes` and `footerRows` references — held so the next
  // recompute can reuse them when content didn't actually change.
  let lastNodes: TreeNode[] | null = null;
  let lastFooterRows: FooterRow[] | undefined = undefined;

  function recompute(): void {
    let pipelineNodes: TreeNode[] = baseNodes;

    // Filter is applied here, in the source, even though the grid
    // pipeline has its own `withFilter` stage. The reason is order: the
    // pipeline runs filter→sort, but `pagination` and the optional
    // `aggregator` happen INSIDE the source and must see the filtered
    // set (filter→sort→window→aggregate is the canonical order).
    // Filtering at the source ensures that.
    //
    // The compiled `predicate` is also published on the snapshot below (as
    // `applyFilter`) so displayed-row derivation sees a stable reference.
    // Derivation will run `withFilter` against already-filtered rows — every
    // survivor passes, so it's a no-op.
    // (`compileFilter!` is non-null here because construction throws
    // when `filterMode === 'client' && compileFilter === undefined`.)
    let predicate: RowPredicate | undefined;
    if (opts.filterMode === "client" && filter !== undefined) {
      predicate = opts.compileFilter!(filter);
      if (predicate) {
        const keep = predicate;
        pipelineNodes = pipelineNodes.filter((n) => keep(n.columns));
      }
    }

    if (opts.sortMode === "client" && sort && sort.length > 0) {
      if (pipelineNodes === baseNodes) pipelineNodes = pipelineNodes.slice();
      const cmp = makeRowComparator(sort, opts.columns);
      pipelineNodes.sort((a, b) => cmp(a.columns, b.columns));
    }

    let pagination: LevelSnapshot<F>["pagination"];
    if (opts.paginationMode === "client") {
      const totalCount = pipelineNodes.length;
      const start = page * pageSize;
      const end = Number.isFinite(pageSize) ? start + pageSize : totalCount;
      pipelineNodes = pipelineNodes.slice(start, end);
      pagination = { page, pageSize, totalCount };
    }

    // Build the rowKey index against original base references — sort/filter
    // shuffle the array but the node objects are still `===` to base entries
    // until the aggregator clones them. setCell/removeNode look up base
    // positions through this map.
    const rowKeyToBaseIdx = new Map<RowKey, number>();
    const baseIdxOf = new Map<TreeNode, number>();
    for (let i = 0; i < baseNodes.length; i++) baseIdxOf.set(baseNodes[i], i);
    for (let i = 0; i < pipelineNodes.length; i++) {
      const key = rowKeyFn(pipelineNodes[i], i);
      const baseIdx = baseIdxOf.get(pipelineNodes[i]);
      if (baseIdx !== undefined) rowKeyToBaseIdx.set(key, baseIdx);
    }

    let publishedNodes: TreeNode[] = pipelineNodes;
    let footerRows: FooterRow[] | undefined;
    if (opts.aggregator) {
      const result = opts.aggregator(pipelineNodes, opts.columns);
      if (result.perRowRollup.size > 0) {
        publishedNodes = pipelineNodes.map((n, idx) => {
          const key = rowKeyFn(n, idx);
          const rollup = result.perRowRollup.get(key);
          if (!rollup) return n;
          return { ...n, rollup: { ...(n.rollup ?? {}), ...rollup } };
        });
      }
      if (result.footerRows.length > 0) footerRows = result.footerRows;
    }

    // Reuse prior `nodes` / `footerRows` references when the content is
    // structurally identical, letting displayed-row derivation reuse rows
    // across writes that didn't actually change the published view.
    const finalNodes = nodesEqual(lastNodes, publishedNodes)
      ? lastNodes!
      : publishedNodes;
    const finalFooters = footerRowsEqual(lastFooterRows, footerRows)
      ? lastFooterRows
      : footerRows;

    const snapshot: LevelSnapshot<F> = {
      status: "ready",
      nodes: finalNodes,
      serverManaged: SERVER_MANAGED,
    };
    if (opts.sortMode === "client" && sort) snapshot.sort = sort;
    if (opts.filterMode === "client" && filter !== undefined)
      snapshot.filter = filter;
    // See the recompute comment: source filtered `finalNodes` already, so
    // the pipeline's `withFilter` against this predicate is a no-op. We
    // still publish the predicate so the pipeline's stage cache keys on a
    // stable reference instead of a fresh closure every snapshot — the
    // grid never sees the host's grammar, only the predicate.
    if (predicate) snapshot.applyFilter = predicate;
    if (pagination) snapshot.pagination = pagination;
    if (finalFooters) snapshot.footerRows = finalFooters;

    cachedSnapshot = snapshot;
    cachedRowKeyToBaseIdx = rowKeyToBaseIdx;
    lastNodes = finalNodes;
    lastFooterRows = finalFooters;
  }

  function ensureFresh(): void {
    if (cachedSnapshot === null) recompute();
  }

  function invalidate(): void {
    cachedSnapshot = null;
    cachedRowKeyToBaseIdx = null;
  }

  function notify(): void {
    if (disposed) return;
    for (const fn of subs) fn();
  }

  function lookupBaseIdx(rowKey: RowKey): number {
    ensureFresh();
    const idx = cachedRowKeyToBaseIdx!.get(rowKey);
    if (idx === undefined) {
      throw new Error(`inMemoryLevelSource: no node with rowKey '${rowKey}'`);
    }
    return idx;
  }

  function applyOne(rowKey: RowKey, colId: ColId, value: unknown): void {
    const baseIdx = lookupBaseIdx(rowKey);
    const node = baseNodes[baseIdx];
    baseNodes[baseIdx] = {
      ...node,
      columns: { ...node.columns, [colId]: value },
    };
  }

  const read: ReadonlyLevelDataSource = {
    writable: false,
    snapshot() {
      ensureFresh();
      return cachedSnapshot!;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    setSort(s) {
      if (opts.sortMode === "none") return;
      if (sort === s) return;
      sort = s;
      invalidate();
      notify();
    },
    setFilter(f) {
      if (opts.filterMode === "none") return;
      // `LevelDataSource.setFilter` is `unknown` to keep the cross-source
      // surface uniform; this source was typed at construction over `F`.
      const next = f as F | undefined;
      if (filter === next) return;
      filter = next;
      invalidate();
      notify();
    },
    setPage(p, ps) {
      if (opts.paginationMode === "none") return;
      if (page === p && pageSize === ps) return;
      page = p;
      pageSize = ps;
      invalidate();
      notify();
    },
    refetch() {
      // No upstream — refetch is a no-op for in-memory sources.
    },
    dispose() {
      disposed = true;
      subs.clear();
      reconcileSubs.clear();
    },
  };

  const setCell: WritableLevelDataSource["setCell"] = (
    rowKey,
    colId,
    value,
  ) => {
    applyOne(rowKey, colId, value);
    invalidate();
    notify();
  };

  const applyChanges: WritableLevelDataSource["applyChanges"] = (changes) => {
    // Atomic from the grid's view: validate every rowKey resolves before
    // mutating anything. A throw here leaves baseNodes untouched.
    for (const c of changes) lookupBaseIdx(c.rowKey);
    for (const c of changes) applyOne(c.rowKey, c.colId, c.value);
    invalidate();
    notify();
  };

  const createNode: WritableLevelDataSource["createNode"] = async (
    node,
    atIndex,
  ) => {
    const idx = atIndex === undefined ? baseNodes.length : atIndex;
    baseNodes = baseNodes.slice();
    baseNodes.splice(idx, 0, node);
    invalidate();
    notify();
    return { node, atIndex: idx };
  };

  const removeNode: WritableLevelDataSource["removeNode"] = (rowKey) => {
    const baseIdx = lookupBaseIdx(rowKey);
    baseNodes = baseNodes.slice();
    baseNodes.splice(baseIdx, 1);
    invalidate();
    notify();
  };

  const replaceNodes: Core<F>["replaceNodes"] = (nodes) => {
    baseNodes = nodes.slice();
    invalidate();
    notify();
  };

  const onReconcile: WritableLevelDataSource["onReconcile"] = (fn) => {
    // Documented contract: in-memory sources never emit reconcile events
    // (optimistic === authoritative). We accept the subscription so callers
    // can wire it uniformly across source kinds, but no event will ever
    // fire on it.
    reconcileSubs.add(fn);
    return () => {
      reconcileSubs.delete(fn);
    };
  };

  return {
    read,
    setCell,
    applyChanges,
    createNode,
    removeNode,
    onReconcile,
    replaceNodes,
  };
}

export function inMemoryLevelSource<F = unknown>(
  opts: InMemoryLevelSourceOpts<F>,
): InMemoryLevelSource {
  const core = buildCore<F>(opts);
  // Reproduce the read surface so the writable source has its own, fresh
  // identity object rather than sharing one with the readonly variant.
  return {
    writable: true,
    snapshot: core.read.snapshot,
    subscribe: core.read.subscribe,
    setSort: core.read.setSort,
    setFilter: core.read.setFilter,
    setPage: core.read.setPage,
    refetch: core.read.refetch,
    dispose: core.read.dispose,
    setCell: core.setCell,
    applyChanges: core.applyChanges,
    createNode: core.createNode,
    removeNode: core.removeNode,
    onReconcile: core.onReconcile,
    replaceNodes: core.replaceNodes,
  };
}

export function inMemoryReadonlyLevelSource<F = unknown>(
  opts: InMemoryLevelSourceOpts<F>,
): ReadonlyLevelDataSource {
  const core = buildCore<F>(opts);
  // Construct an object with ONLY the read keys so `'setCell' in source`
  // is false at runtime — not merely `setCell === undefined`.
  return {
    writable: false,
    snapshot: core.read.snapshot,
    subscribe: core.read.subscribe,
    setSort: core.read.setSort,
    setFilter: core.read.setFilter,
    setPage: core.read.setPage,
    refetch: core.read.refetch,
    dispose: core.read.dispose,
  };
}

function nodesEqual(prev: TreeNode[] | null, next: TreeNode[]): boolean {
  if (prev === null) return false;
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
  return true;
}

function footerRowsEqual(
  prev: FooterRow[] | undefined,
  next: FooterRow[] | undefined,
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
