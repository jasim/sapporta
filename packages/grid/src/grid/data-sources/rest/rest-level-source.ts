// REST-backed `LevelDataSource`. The server owns the data; this source is
// the optimistic-edit + snapshot machinery that bridges it to the grid.
//
// Lifecycle: construction kicks off an initial `fetchPage`. The first
// snapshot has `status: 'loading'`. On resolve the source flips to
// `ready`; on reject to `error` with the host's error verbatim (project
// policy: never interpret backend errors).
//
// Mode mechanics: `serverManaged` is declared by the host and emitted on every
// snapshot unchanged. Displayed-row derivation gates `withSort` / `withFilter`
// against it. `setSort` / `setFilter` / `setPage` always update the declared
// state and emit so chrome reflects the new values immediately; they trigger a
// refetch only for concerns the server actually owns — flipping `setSort` on a
// `serverManaged.sort: false` source is a derivation-only concern, not a
// network round trip.
//
// All eight combinations of `serverManaged` flags are well-defined. The
// blessed combinations are all-client (in-memory tables) and all-server
// (REST-backed tables). Mixed modes are mechanically correct but the host
// owns the UX implications (e.g. a "page-local filter" only filters the
// visible page). The grid does not warn or refuse.
//
// In-flight ordering. Two cancellation primitives:
//   * `fetchToken` — bumped on every refetch. Stale fetch resolutions are
//     discarded (resolution-by-discard). This handles refetches triggered
//     by `setSort`/`setFilter`/`setPage` and explicit `refetch()`.
//   * `cellTokens[rowKey][colId]` — bumped per `setCell`. The same cell
//     edited twice cancels the first PATCH (last-write-wins); different
//     cells of the same row run independently. No internal retry, no
//     queue. A failed PATCH does NOT auto-revert and does NOT flip
//     `snapshot.status` to `'error'` — that field is reserved for
//     level-wide fetch failures, not per-cell write outcomes.
//
// `applyChanges` is atomic from the grid's view. Without a batch endpoint
// it fans out per-cell PATCHes in parallel; on any rejection it reverts
// every change to its prior value and emits one `'rejected'` event per
// change. Hosts that need stricter server-side atomicity supply a custom
// source.
//
// Edit-verb wiring. If the host supplies any of `patchCell` / `insertNode`
// / `removeNode`, ALL THREE must be wired — partial-write surfaces are a
// footgun. Construction throws synchronously when the set is incomplete.
// If none are supplied, the source returns a `ReadonlyLevelDataSource`.
//
// `PatchCellResponse` may confirm one value, patch the row, replace the row,
// or request a reload. The value for the edited cell drives the reconcile
// event; row patch/replacement responses can update sibling cells before the
// host sees `agreed` or `diverged`.

import { defaultRowKey } from "../../pipeline/stages/build-data";
import { assertBoundedInteger } from "@sapporta/shared/validation";
import type { ColId, RowKey } from "../../types/identity";
import type { FooterRow, TreeNode } from "../../types/level-row";
import type { RowPredicate, SortDescriptor } from "../../pipeline/types";
import type {
  FetchPageRequest,
  FetchPageResponse,
  InsertNodeRequest,
  LevelDataSource,
  LevelSnapshot,
  LevelStatus,
  PageBoundaryNavigation,
  PatchCellRequest,
  PatchCellResponse,
  ReadonlyLevelDataSource,
  ReconcileEvent,
  RemoveNodeRequest,
  WritableLevelDataSource,
} from "../types";

export type RestLevelSourceOpts<F = unknown> = {
  fetchPage: (req: FetchPageRequest<F>) => Promise<FetchPageResponse>;
  patchCell?: (req: PatchCellRequest) => Promise<PatchCellResponse>;
  insertNode?: (req: InsertNodeRequest) => Promise<TreeNode>;
  removeNode?: (req: RemoveNodeRequest) => Promise<void>;

  // When provided, the source treats the host as the single owner of query
  // state. Called on every refetch and on every snapshot build. The source
  // carries no internal sort/filter/page state in this mode and `setSort`
  // / `setFilter` / `setPage` become no-ops — the host updates its store
  // and calls `refetch()` directly.
  //
  // When omitted, the source owns query state via its own setSort/setFilter
  // /setPage verbs and its initial* options.
  query?: () => FetchPageRequest<F>;

  // Required when `query` is omitted; ignored when `query` is provided.
  initialPagination?: { page: number; pageSize: number };
  initialSort?: SortDescriptor[];
  initialFilter?: F;

  // The host's grammar-to-predicate compiler. This is the trust boundary
  // for filtering: the host owns `F` (the grammar), the host owns the
  // compiler that turns `F` into a `RowPredicate` the grid can call, and
  // the grid trusts the result without introspection. The compiler is the
  // single place a grammar bug can exist.
  //
  // Required when `serverManaged.filter` is false (because the pipeline
  // has to filter rows locally and needs a predicate to do it).
  // Construction throws synchronously when this combination is wired
  // wrong — surface contract violations at the boundary, not deep in a
  // runtime call. Optional otherwise: server-side filtering means the
  // server already shaped `nodes`, and the grid has nothing to filter.
  compileFilter?: (filter: F | undefined) => RowPredicate | undefined;

  serverManaged: { sort: boolean; filter: boolean; pagination: boolean };
  // Per-level rowKey resolver. The grid source forwards this from the
  // schema's `LevelOptions.rowKey`; hosts wiring `restLevelSource` directly
  // can override. Defaults to array index.
  rowKey?: (node: TreeNode, localIdx: number) => RowKey;

  pageBoundaryNavigation?: PageBoundaryNavigation;
};

export function restLevelSource<F = unknown>(
  opts: RestLevelSourceOpts<F>,
): LevelDataSource {
  const editEndpoints = [opts.patchCell, opts.insertNode, opts.removeNode];
  const presentCount = editEndpoints.filter((e) => e !== undefined).length;
  const writable = presentCount > 0;
  if (writable && presentCount < editEndpoints.length) {
    const present = (
      [
        ["patchCell", opts.patchCell],
        ["insertNode", opts.insertNode],
        ["removeNode", opts.removeNode],
      ] as const
    )
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    const missing = (
      [
        ["patchCell", opts.patchCell],
        ["insertNode", opts.insertNode],
        ["removeNode", opts.removeNode],
      ] as const
    )
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    throw new Error(
      `restLevelSource: when any edit endpoint is supplied, all of {patchCell, insertNode, removeNode} must be wired (got ${present.join(", ")}; missing ${missing.join(", ")})`,
    );
  }

  const rowKeyFn = opts.rowKey ?? defaultRowKey;
  const hostOwned = opts.query !== undefined;

  if (!hostOwned && !opts.initialPagination) {
    throw new Error(
      "restLevelSource: initialPagination is required when `query` is not provided",
    );
  }

  if (!opts.serverManaged.filter && !opts.compileFilter) {
    throw new Error(
      "restLevelSource: compileFilter is required when serverManaged.filter is false — the source must compile its grammar to a RowPredicate for the pipeline",
    );
  }

  let status: LevelStatus = "loading";
  let error: Error | undefined;
  let nodes: TreeNode[] = [];
  let footerRows: FooterRow[] | undefined;
  let totalCount: number | undefined;
  let sort: SortDescriptor[] | undefined = opts.initialSort;
  let filter: F | undefined = opts.initialFilter;
  let page = opts.initialPagination?.page ?? 0;
  let pageSize = opts.initialPagination?.pageSize ?? 0;

  let cachedSnapshot: LevelSnapshot<F> | null = null;
  let fetchToken = 0;

  // Per-cell in-flight PATCH counter — supersession key. The latest token
  // is the only one whose resolution is allowed to mutate state.
  const cellTokens = new Map<RowKey, Map<ColId, number>>();
  let cellTokenCounter = 0;

  const subs = new Set<() => void>();
  const reconcileSubs = new Set<(e: ReconcileEvent) => void>();
  let disposed = false;

  function buildSnapshot(): LevelSnapshot<F> {
    // In host-owned mode the snapshot's pagination reads from the latest
    // `query()` so chrome that derives from the snapshot stays consistent
    // with the host's store; sort/filter remain the host's concern (chrome
    // already renders from the store) and are not echoed onto the snapshot.
    const q = opts.query ? opts.query() : undefined;
    const snapPage = q ? q.page : page;
    const snapPageSize = q ? q.pageSize : pageSize;
    const snap: LevelSnapshot<F> = {
      status,
      nodes,
      serverManaged: opts.serverManaged,
      pagination:
        totalCount === undefined
          ? { page: snapPage, pageSize: snapPageSize }
          : { page: snapPage, pageSize: snapPageSize, totalCount },
    };
    if (error) snap.error = error;
    if (footerRows) snap.footerRows = footerRows;
    if (!hostOwned) {
      // Source-owned mode: the source is authoritative for `sort` / `filter`,
      // so echo them onto the snapshot for chrome that reads off the snap.
      // In host-owned mode the host's store is authoritative and chrome
      // already reads from there; echoing here would just duplicate state.
      if (sort) snap.sort = sort;
      if (filter !== undefined) snap.filter = filter;
    }
    if (!opts.serverManaged.filter) {
      // Displayed-row derivation will run `withFilter` — supply the predicate. In
      // host-owned mode the canonical filter lives on the latest
      // `query()` return; in source-owned mode it's our internal `filter`.
      // `compileFilter` is non-null here because construction throws
      // when `serverManaged.filter === false && compileFilter === undefined`.
      const predicate = opts.compileFilter!(hostOwned ? q?.filter : filter);
      if (predicate) snap.applyFilter = predicate;
    }
    return snap;
  }

  function snapshot(): LevelSnapshot<F> {
    if (cachedSnapshot === null) cachedSnapshot = buildSnapshot();
    return cachedSnapshot;
  }

  function invalidate(): void {
    cachedSnapshot = null;
  }

  function notify(): void {
    if (disposed) return;
    for (const fn of [...subs]) fn();
  }

  function emit(): void {
    invalidate();
    notify();
  }

  function emitReconcile(event: ReconcileEvent): void {
    if (disposed) return;
    for (const fn of [...reconcileSubs]) fn(event);
  }

  function findNodeIdx(rowKey: RowKey): number {
    for (let i = 0; i < nodes.length; i++) {
      if (rowKeyFn(nodes[i], i) === rowKey) return i;
    }
    return -1;
  }

  function requireNodeIdx(rowKey: RowKey): number {
    const idx = findNodeIdx(rowKey);
    if (idx < 0) {
      throw new Error(`restLevelSource: no node with rowKey '${rowKey}'`);
    }
    return idx;
  }

  function setNodeCell(idx: number, colId: ColId, value: unknown): void {
    const node = nodes[idx];
    nodes = nodes.slice();
    nodes[idx] = { ...node, columns: { ...node.columns, [colId]: value } };
  }

  function bumpCellToken(rowKey: RowKey, colId: ColId): number {
    let perRow = cellTokens.get(rowKey);
    if (!perRow) {
      perRow = new Map();
      cellTokens.set(rowKey, perRow);
    }
    const t = ++cellTokenCounter;
    perRow.set(colId, t);
    return t;
  }

  function isCellTokenCurrent(
    rowKey: RowKey,
    colId: ColId,
    t: number,
  ): boolean {
    return cellTokens.get(rowKey)?.get(colId) === t;
  }

  function clearCellToken(rowKey: RowKey, colId: ColId, t: number): void {
    const perRow = cellTokens.get(rowKey);
    if (perRow && perRow.get(colId) === t) {
      perRow.delete(colId);
      if (perRow.size === 0) cellTokens.delete(rowKey);
    }
  }

  function reasonOf(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err === null || err === undefined) return "";
    return String(err);
  }

  function refetch(): void {
    const myToken = ++fetchToken;
    status = "loading";
    error = undefined;
    emit();
    let req: FetchPageRequest<F>;
    if (opts.query) {
      req = opts.query();
    } else {
      req = { page, pageSize };
      if (sort) req.sort = sort;
      if (filter !== undefined) req.filter = filter;
    }
    // Invoke directly — `fetchPage` returns a Promise synchronously; tests
    // and the runtime expect the host call to land before the next
    // microtask, not after a wrapping `Promise.resolve()`.
    opts.fetchPage(req).then(
      (res) => {
        if (disposed || myToken !== fetchToken) return;
        nodes = res.nodes;
        footerRows = res.footerRows;
        totalCount = res.totalCount;
        status = "ready";
        error = undefined;
        emit();
      },
      (err) => {
        if (disposed || myToken !== fetchToken) return;
        status = "error";
        error = err instanceof Error ? err : new Error(reasonOf(err));
        emit();
      },
    );
  }

  function setSourceOwnedPage(p: number, ps: number): void {
    if (hostOwned) return;
    assertPageWindow(p, ps);
    if (page === p && pageSize === ps) return;
    page = p;
    pageSize = ps;
    if (opts.serverManaged.pagination) {
      refetch();
    } else {
      emit();
    }
  }

  // Initial fetch — every REST source starts in `loading`.
  refetch();

  function sourceOwnedPageBoundaryNavigation():
    | PageBoundaryNavigation
    | undefined {
    if (hostOwned) return undefined;
    return {
      canGoPrevious: () => status === "ready" && page > 0,
      canGoNext: () => {
        if (status !== "ready") return false;
        if (!Number.isFinite(pageSize)) return false;
        if (totalCount !== undefined) {
          return (page + 1) * pageSize < totalCount;
        }
        return nodes.length >= pageSize;
      },
      goPrevious: () => {
        if (status !== "ready") return;
        if (page <= 0) return;
        setSourceOwnedPage(page - 1, pageSize);
      },
      goNext: () => {
        if (status !== "ready") return;
        if (!Number.isFinite(pageSize)) return;
        setSourceOwnedPage(page + 1, pageSize);
      },
    };
  }

  const read: ReadonlyLevelDataSource = {
    writable: false,
    snapshot,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    setSort(s) {
      // Host-owned mode: the host owns query state and calls `refetch()`
      // directly after mutating its store. The verb is a no-op so the
      // `LevelDataSource` interface stays uniform without forcing
      // host-owned sources to expose verbs they would never use.
      if (hostOwned) return;
      if (sort === s) return;
      sort = s;
      if (opts.serverManaged.sort) {
        refetch();
      } else {
        emit();
      }
    },
    setFilter(f) {
      if (hostOwned) return;
      // The cross-source `LevelDataSource.setFilter` accepts `unknown` so
      // the runtime can wire any source uniformly; this concrete source
      // was typed at construction over `F`, so the cast lands the value
      // back into the source's grammar slot. There is no validation —
      // `F` is opaque to the grid by design.
      const next = f as F | undefined;
      if (filter === next) return;
      filter = next;
      if (opts.serverManaged.filter) {
        refetch();
      } else {
        emit();
      }
    },
    setPage(p, ps) {
      setSourceOwnedPage(p, ps);
    },
    refetch,
    pageBoundaryNavigation:
      opts.pageBoundaryNavigation ?? sourceOwnedPageBoundaryNavigation(),
    dispose() {
      disposed = true;
      // Bump tokens so any still-pending resolution short-circuits.
      fetchToken++;
      cellTokens.clear();
      subs.clear();
      reconcileSubs.clear();
    },
  };

  if (!writable) return read;

  const setCell: WritableLevelDataSource["setCell"] = (
    rowKey,
    colId,
    value,
  ) => {
    const idx = requireNodeIdx(rowKey);
    const priorValue = nodes[idx].columns[colId];
    setNodeCell(idx, colId, value);
    emit();

    const myToken = bumpCellToken(rowKey, colId);
    opts.patchCell!({
      rowKey,
      colId,
      value,
      row: { ...nodes[idx].columns },
    }).then(
      (res) => {
        if (disposed) return;
        if (!isCellTokenCurrent(rowKey, colId, myToken)) return;
        clearCellToken(rowKey, colId, myToken);
        applyPatchCellResponse({
          res,
          rowKey,
          colId,
          optimisticValue: value,
          priorValue,
        });
      },
      (err) => {
        if (disposed) return;
        if (!isCellTokenCurrent(rowKey, colId, myToken)) return;
        clearCellToken(rowKey, colId, myToken);
        emitReconcile({
          kind: "rejected",
          rowKey,
          colId,
          optimisticValue: value,
          reason: reasonOf(err),
          priorValue,
        });
      },
    );
  };

  function applyPatchCellResponse(args: {
    res: PatchCellResponse;
    rowKey: RowKey;
    colId: ColId;
    optimisticValue: unknown;
    priorValue: unknown;
  }): void {
    const { res, rowKey, colId, optimisticValue, priorValue } = args;
    if (!res || typeof res !== "object") {
      emitReconcile({
        kind: "rejected",
        rowKey,
        colId,
        optimisticValue,
        reason: "patchCell response missing result object",
        priorValue,
      });
      return;
    }

    if ("kind" in res) {
      switch (res.kind) {
        case "value":
          applyAuthoritativeValue({
            rowKey,
            colId,
            optimisticValue,
            authoritativeValue: res.value,
            priorValue,
          });
          return;
        case "patch":
          applyAuthoritativePatch({
            rowKey,
            colId,
            optimisticValue,
            patch: res.patch,
            priorValue,
          });
          return;
        case "row":
          applyAuthoritativeRow({
            rowKey,
            colId,
            optimisticValue,
            node: res.node,
            priorValue,
          });
          return;
        case "reload":
          refetch();
          emitReconcile({
            kind: "agreed",
            rowKey,
            colId,
            value: optimisticValue,
          });
          return;
      }
    }

    if (!("value" in res)) {
      emitReconcile({
        kind: "rejected",
        rowKey,
        colId,
        optimisticValue,
        reason: "patchCell response missing 'value' field",
        priorValue,
      });
      return;
    }

    applyAuthoritativeValue({
      rowKey,
      colId,
      optimisticValue,
      authoritativeValue: res.value,
      priorValue,
    });
  }

  function applyAuthoritativeValue(args: {
    rowKey: RowKey;
    colId: ColId;
    optimisticValue: unknown;
    authoritativeValue: unknown;
    priorValue: unknown;
  }): void {
    const { rowKey, colId, optimisticValue, authoritativeValue, priorValue } =
      args;
    if (Object.is(authoritativeValue, optimisticValue)) {
      emitReconcile({
        kind: "agreed",
        rowKey,
        colId,
        value: authoritativeValue,
      });
      return;
    }
    const idx = findNodeIdx(rowKey);
    if (idx >= 0) {
      setNodeCell(idx, colId, authoritativeValue);
      emit();
    }
    emitReconcile({
      kind: "diverged",
      rowKey,
      colId,
      optimisticValue,
      authoritativeValue,
      priorValue,
    });
  }

  function applyAuthoritativePatch(args: {
    rowKey: RowKey;
    colId: ColId;
    optimisticValue: unknown;
    patch: Record<ColId, unknown>;
    priorValue: unknown;
  }): void {
    const { rowKey, colId, optimisticValue, patch, priorValue } = args;
    const authoritativeValue = colId in patch ? patch[colId] : optimisticValue;
    const idx = findNodeIdx(rowKey);
    if (idx >= 0) {
      const next = nodes.slice();
      next[idx] = {
        ...next[idx],
        columns: { ...next[idx].columns, ...patch },
      };
      nodes = next;
      emit();
    }
    emitPatchReconcile({
      rowKey,
      colId,
      optimisticValue,
      authoritativeValue,
      priorValue,
    });
  }

  function applyAuthoritativeRow(args: {
    rowKey: RowKey;
    colId: ColId;
    optimisticValue: unknown;
    node: TreeNode;
    priorValue: unknown;
  }): void {
    const { rowKey, colId, optimisticValue, node, priorValue } = args;
    const authoritativeValue = node.columns[colId];
    const idx = findNodeIdx(rowKey);
    if (idx >= 0) {
      const next = nodes.slice();
      next[idx] = node;
      nodes = next;
      emit();
    }
    emitPatchReconcile({
      rowKey,
      colId,
      optimisticValue,
      authoritativeValue,
      priorValue,
    });
  }

  function emitPatchReconcile(args: {
    rowKey: RowKey;
    colId: ColId;
    optimisticValue: unknown;
    authoritativeValue: unknown;
    priorValue: unknown;
  }): void {
    const { rowKey, colId, optimisticValue, authoritativeValue, priorValue } =
      args;
    if (Object.is(authoritativeValue, optimisticValue)) {
      emitReconcile({
        kind: "agreed",
        rowKey,
        colId,
        value: authoritativeValue,
      });
      return;
    }
    emitReconcile({
      kind: "diverged",
      rowKey,
      colId,
      optimisticValue,
      authoritativeValue,
      priorValue,
    });
  }

  const applyChanges: WritableLevelDataSource["applyChanges"] = (changes) => {
    if (changes.length === 0) return;
    // Validate every rowKey resolves before mutating anything — a throw
    // here leaves state untouched.
    const idxs = changes.map((c) => requireNodeIdx(c.rowKey));
    // Capture priors keyed by index — applying changes shifts the nodes
    // array each time but preserves the position, so the same index
    // refers to the same logical row across the loop.
    const localPriors: Array<{ rowKey: RowKey; colId: ColId; value: unknown }> =
      [];
    for (let k = 0; k < changes.length; k++) {
      const c = changes[k];
      const idx = idxs[k];
      const priorValue = nodes[idx].columns[c.colId];
      localPriors.push({ rowKey: c.rowKey, colId: c.colId, value: priorValue });
      setNodeCell(idx, c.colId, c.value);
    }
    emit();

    // Per-cell tokens — applyChanges supersedes any in-flight setCell on
    // the same cell, just like a fresh setCell would.
    const myTokens = changes.map((c) => bumpCellToken(c.rowKey, c.colId));

    Promise.allSettled(
      changes.map((c) =>
        opts.patchCell!({
          rowKey: c.rowKey,
          colId: c.colId,
          value: c.value,
          row: { ...nodes[requireNodeIdx(c.rowKey)].columns },
        }),
      ),
    ).then((results) => {
      if (disposed) return;
      // Drop results whose token has been superseded — a later setCell on
      // the same cell beat us. Those events fire from that later edit.
      const live = results.map((r, i) =>
        isCellTokenCurrent(changes[i].rowKey, changes[i].colId, myTokens[i])
          ? r
          : null,
      );
      const anyLiveRejected = live.some(
        (r) => r !== null && r.status === "rejected",
      );

      if (anyLiveRejected) {
        // Atomic-from-grid revert: roll back every live change. Cells
        // that were already superseded keep whatever the later edit set.
        for (let i = 0; i < live.length; i++) {
          if (live[i] === null) continue;
          const idx = findNodeIdx(localPriors[i].rowKey);
          if (idx >= 0)
            setNodeCell(idx, localPriors[i].colId, localPriors[i].value);
          clearCellToken(changes[i].rowKey, changes[i].colId, myTokens[i]);
        }
        emit();
        for (let i = 0; i < live.length; i++) {
          const r = live[i];
          if (r === null) continue;
          const reason =
            r.status === "rejected"
              ? reasonOf(r.reason)
              : "atomic revert: peer change failed";
          emitReconcile({
            kind: "rejected",
            rowKey: changes[i].rowKey,
            colId: changes[i].colId,
            optimisticValue: changes[i].value,
            reason,
            priorValue: localPriors[i].value,
          });
        }
        return;
      }

      // All live results fulfilled. Process agreed/diverged per cell.
      for (let i = 0; i < live.length; i++) {
        const r = live[i];
        if (r === null) continue;
        clearCellToken(changes[i].rowKey, changes[i].colId, myTokens[i]);
        if (r.status !== "fulfilled") continue;
        applyPatchCellResponse({
          res: r.value,
          rowKey: changes[i].rowKey,
          colId: changes[i].colId,
          optimisticValue: changes[i].value,
          priorValue: localPriors[i].value,
        });
      }
    });
  };

  const createNode: WritableLevelDataSource["createNode"] = async (
    node,
    atIndex,
  ) => {
    const serverNode = await opts.insertNode!({ node, atIndex });
    const idx = atIndex === undefined ? nodes.length : atIndex;
    if (disposed) return { node: serverNode, atIndex: idx };
    const next = nodes.slice();
    next.splice(idx, 0, serverNode);
    nodes = next;
    emit();
    return { node: serverNode, atIndex: idx };
  };

  const removeNode: WritableLevelDataSource["removeNode"] = (rowKey) => {
    const idx = requireNodeIdx(rowKey);
    const next = nodes.slice();
    next.splice(idx, 1);
    nodes = next;
    emit();
    return opts.removeNode!({ rowKey });
  };

  const onReconcile: WritableLevelDataSource["onReconcile"] = (fn) => {
    reconcileSubs.add(fn);
    return () => {
      reconcileSubs.delete(fn);
    };
  };

  const writableSource: WritableLevelDataSource = {
    writable: true,
    snapshot: read.snapshot,
    subscribe: read.subscribe,
    setSort: read.setSort,
    setFilter: read.setFilter,
    setPage: read.setPage,
    refetch: read.refetch,
    pageBoundaryNavigation: read.pageBoundaryNavigation,
    dispose: read.dispose,
    setCell,
    applyChanges,
    createNode,
    removeNode,
    onReconcile,
  };
  return writableSource;
}

function assertPageWindow(page: number, pageSize: number): void {
  assertBoundedInteger(page, {
    name: "page",
    min: 0,
    makeError: (message) => new Error(message),
  });
  assertBoundedInteger(pageSize, {
    name: "pageSize",
    min: 1,
    makeError: (message) => new Error(message),
  });
}
