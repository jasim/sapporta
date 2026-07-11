// REST-backed `LevelDataSource`. The server owns the data; this source is
// the optimistic-edit + snapshot machinery that bridges it to the grid.
//
// Lifecycle: construction kicks off an initial `fetchPage`. The first state is
// `initialLoading`; on resolve the source flips to `ready`, and on reject to
// `initialError` with the host's error verbatim (project policy: never
// interpret backend errors). Once a committed snapshot exists, refetches publish
// `refreshing` with the previous snapshot still renderable, then settle to
// `ready` or `refreshError`.
//
// Query mechanics: the endpoint owns shaping for REST rows. Sort/filter query
// capabilities update row-query state and refetch; the source publishes the
// rows returned by the endpoint without local sort, filter, or window stages.
//
// In-flight ordering. Two cancellation primitives:
//   * `fetchToken` — bumped on every refetch. Stale fetch resolutions are
//     discarded (resolution-by-discard). This handles refetches triggered
//     by query capability setters and explicit `refetch()`.
//   * `cellTokens[rowKey][colId]` — bumped per `setCell`. The same cell
//     edited twice cancels the first PATCH (last-write-wins); different
//     cells of the same row run independently. No internal retry, no
//     queue. A failed PATCH does NOT auto-revert and does NOT flip the
//     `LevelSourceState` to an error variant — those variants are reserved for
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
// If none are supplied, the source omits the write capability.
//
// `PatchCellResponse` may confirm one value, patch the row, replace the row,
// or request a reload. The value for the edited cell drives the reconcile
// event; row patch/replacement responses can update sibling cells before the
// host sees `agreed` or `diverged`.

import { assertBoundedInteger } from "@sapporta/shared/validation";
import type { ColId, RowKey } from "../../types/identity";
import type { FooterRow, TreeNode } from "../../types/level-row";
import type { SortDescriptor } from "../../pipeline/types";
import {
  assertTreeNodeCanBeInserted,
  assertUniqueTreeNodeRowKeys,
  rowKeyOfTreeNode,
} from "../../row-identity";
import { createObserverList } from "../../observer-notification";
import {
  createStructuralSnapshotCache,
  snapshotFooterRows,
  snapshotTreeNode,
  snapshotTreeNodes,
} from "../immutable-snapshot";
import type {
  FetchPageRequest,
  FetchPageResponse,
  InsertNodeRequest,
  LevelDataSource,
  LevelQueryCapabilities,
  LevelSnapshot,
  LevelSourceState,
  PatchCellRequest,
  PatchCellResponse,
  ReconcileEvent,
  RemoveNodeRequest,
  SourceLoadResult,
  WriteCapability,
} from "../types";

export type RowQuery<F = unknown> = {
  page: number;
  pageSize: number;
  sort?: readonly SortDescriptor[];
  filter?: F;
};

export type RowQueryChange = "changed" | "unchanged";

export type RowQueryState<F = unknown> = {
  // `current()` is sampled at command time. Hosts that keep query values in
  // route state, Zustand, or another app store should return a fresh value
  // that reflects the state a user sees in controls and export links.
  current(): RowQuery<F>;
  // Setters mutate query storage only. They do not fetch rows, push URLs, or
  // move focus. The REST source owns the command sequence: mutate query state,
  // decide whether server-managed data must reload, then publish the result.
  setSortState(sort: readonly SortDescriptor[] | undefined): RowQueryChange;
  setFilterState(filter: F | undefined): RowQueryChange;
  setPageState(page: number, pageSize: number): RowQueryChange;
};

export type BuildRowsRequest<F = unknown> = (
  query: RowQuery<F>,
) => FetchPageRequest<F>;

// Source-owned query storage is the small in-source state container used by
// embedded grids and child levels that do not expose table controls. It stores
// only mutable user query values. Fixed constraints belong in
// `buildRowsRequest`, where every fetch and every snapshot can see them.
export function sourceOwnedRowQuery<F = unknown>(
  initial: RowQuery<F>,
): RowQueryState<F> {
  assertPageWindow(initial.page, initial.pageSize);
  let query: RowQuery<F> = { ...initial };
  return {
    current() {
      return { ...query };
    },
    setSortState(sort) {
      if (query.sort === sort) return "unchanged";
      query = { ...query, sort: sort ? [...sort] : undefined };
      return "changed";
    },
    setFilterState(filter) {
      if (Object.is(query.filter, filter)) return "unchanged";
      query = { ...query, filter };
      return "changed";
    },
    setPageState(page, pageSize) {
      assertPageWindow(page, pageSize);
      if (query.page === page && query.pageSize === pageSize) {
        return "unchanged";
      }
      query = { ...query, page, pageSize };
      return "changed";
    },
  };
}

export function hostBackedRowQuery<F = unknown>(
  state: RowQueryState<F>,
): RowQueryState<F> {
  // Host-backed query storage keeps the same command contract while the values
  // live in application state. The returned object is deliberately transparent:
  // the source still calls the same `current` and setter methods in the same
  // order as it does for source-owned storage.
  return state;
}

export type RestLevelSourceOpts<F = unknown> = {
  fetchPage: (req: FetchPageRequest<F>) => Promise<FetchPageResponse>;
  patchCell?: (req: PatchCellRequest) => Promise<PatchCellResponse>;
  insertNode?: (req: InsertNodeRequest) => Promise<TreeNode>;
  removeNode?: (req: RemoveNodeRequest) => Promise<void>;

  rowQuery: RowQueryState<F>;
  buildRowsRequest?: BuildRowsRequest<F>;

  canAppendRow?: (ctx: {
    request: FetchPageRequest<F>;
    visibleCount: number;
    totalCount: number | undefined;
  }) => boolean;
  onObserverError?: (error: unknown) => void;
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

  const buildRowsRequest = opts.buildRowsRequest ?? identityRowsRequest<F>;

  const structuralSnapshots = createStructuralSnapshotCache();
  let nodes: readonly TreeNode[] = Object.freeze([]);
  let footerRows: readonly FooterRow[] | undefined;
  let totalCount: number | undefined;
  // `displayRequest` is the effective request that describes the visible
  // request. It includes host query values plus fixed filters, parent
  // constraints, and defaults injected by `buildRowsRequest`.
  let displayRequest: FetchPageRequest<F> | undefined;

  let cachedSnapshot: LevelSnapshot | null = null;
  let committedSnapshot: LevelSnapshot | null = null;
  let currentState: LevelSourceState | null = null;
  let fetchToken = 0;
  let pendingLoad: {
    token: number;
    resolve: (result: SourceLoadResult) => void;
  } | null = null;

  // Per-cell in-flight PATCH counter — supersession key. The latest token
  // is the only one whose resolution is allowed to mutate state.
  const cellTokens = new Map<RowKey, Map<ColId, number>>();
  let cellTokenCounter = 0;

  const subscribers = createObserverList<[]>(opts.onObserverError);
  const reconcileSubscribers = createObserverList<[ReconcileEvent]>(
    opts.onObserverError,
  );
  let disposed = false;

  function buildSnapshot(): LevelSnapshot {
    return footerRows
      ? Object.freeze({ nodes, footerRows })
      : Object.freeze({ nodes });
  }

  function snapshot(): LevelSnapshot {
    if (cachedSnapshot === null) cachedSnapshot = buildSnapshot();
    return cachedSnapshot;
  }

  function request(): FetchPageRequest<F> {
    return buildRowsRequest(opts.rowQuery.current());
  }

  function state(): LevelSourceState {
    if (!currentState) {
      currentState = Object.freeze({
        status: "initialLoading",
        snapshot: snapshot(),
      });
    }
    return currentState;
  }

  function invalidate(): void {
    cachedSnapshot = null;
  }

  function notify(): void {
    if (disposed) return;
    subscribers.notify();
  }

  function emit(): void {
    notify();
  }

  function publishReady(): Extract<LevelSourceState, { status: "ready" }> {
    invalidate();
    const next = snapshot();
    committedSnapshot = next;
    currentState = Object.freeze({ status: "ready", snapshot: next });
    emit();
    return currentState;
  }

  function publishDataMutation(): void {
    invalidate();
    const next = snapshot();
    committedSnapshot = next;
    const cur = currentState;
    if (cur?.status === "refreshing") {
      currentState = Object.freeze({
        ...cur,
        snapshot: next,
        previous: next,
      });
    } else if (cur?.status === "refreshError") {
      currentState = Object.freeze({
        ...cur,
        snapshot: next,
        previous: next,
      });
    } else {
      currentState = Object.freeze({ status: "ready", snapshot: next });
    }
    emit();
  }

  function emitReconcile(event: ReconcileEvent): void {
    if (disposed) return;
    reconcileSubscribers.notify(event);
  }

  function findNodeIdx(rowKey: RowKey): number {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].rowKey === rowKey) return i;
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
    const next = nodes.slice();
    next[idx] = snapshotTreeNode(
      { ...node, columns: { ...node.columns, [colId]: value } },
      structuralSnapshots,
    );
    nodes = Object.freeze(next);
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

  function resolvePendingLoad(result: SourceLoadResult): void {
    if (!pendingLoad) return;
    pendingLoad.resolve(result);
    pendingLoad = null;
  }

  function resolveCurrentLoad(token: number, result: SourceLoadResult): void {
    if (pendingLoad?.token !== token) return;
    pendingLoad.resolve(result);
    pendingLoad = null;
  }

  function publishLoadError(
    err: unknown,
    req: FetchPageRequest<F>,
  ): Extract<LevelSourceState, { status: "initialError" | "refreshError" }> {
    void req;
    const error = err instanceof Error ? err : new Error(reasonOf(err));
    invalidate();
    const display = snapshot();
    if (committedSnapshot) {
      currentState = Object.freeze({
        status: "refreshError",
        snapshot: display,
        previous: committedSnapshot,
        error,
      });
    } else {
      currentState = Object.freeze({
        status: "initialError",
        snapshot: display,
        error,
      });
    }
    emit();
    return currentState;
  }

  function refetch(): Promise<SourceLoadResult> {
    // A caller may await a page turn, refresh button, or sort command. Starting
    // a load settles any in-flight awaited operation as `superseded`; user
    // workflows wait only for the load whose token can still publish state.
    resolvePendingLoad({ kind: "superseded" });
    const myToken = ++fetchToken;
    const req = request();
    displayRequest = req;
    invalidate();
    const display = snapshot();
    if (committedSnapshot) {
      currentState = Object.freeze({
        status: "refreshing",
        snapshot: display,
        previous: committedSnapshot,
      });
    } else {
      currentState = Object.freeze({
        status: "initialLoading",
        snapshot: display,
      });
    }
    emit();
    // Subscribers observe `initialLoading` or `refreshing` before the promise
    // is returned. React hooks that subscribe to source state can render loading
    // chrome in the same turn in which the caller receives the load promise.
    const promise = new Promise<SourceLoadResult>((resolve) => {
      pendingLoad = { token: myToken, resolve };
    });
    // Invoke directly — `fetchPage` returns a Promise synchronously; tests
    // and the runtime expect the host call to land before the next
    // microtask, not after a wrapping `Promise.resolve()`.
    let fetchPromise: Promise<FetchPageResponse>;
    try {
      fetchPromise = opts.fetchPage(req);
    } catch (err) {
      if (!disposed && myToken === fetchToken) {
        const errorState = publishLoadError(err, req);
        resolveCurrentLoad(myToken, { kind: "error", state: errorState });
      }
      return promise;
    }
    fetchPromise.then(
      (res) => {
        if (disposed || myToken !== fetchToken) return;
        try {
          const fetchedNodes = res.nodes;
          assertUniqueTreeNodeRowKeys(
            fetchedNodes,
            "restLevelSource.fetchPage response",
          );
          nodes = snapshotTreeNodes(fetchedNodes, structuralSnapshots);
          footerRows = res.footerRows
            ? snapshotFooterRows(res.footerRows, structuralSnapshots)
            : undefined;
          totalCount = res.totalCount;
          const readyState = publishReady();
          resolveCurrentLoad(myToken, { kind: "ready", state: readyState });
        } catch (error) {
          const errorState = publishLoadError(error, req);
          resolveCurrentLoad(myToken, { kind: "error", state: errorState });
        }
      },
      (err) => {
        if (disposed || myToken !== fetchToken) return;
        const errorState = publishLoadError(err, req);
        resolveCurrentLoad(myToken, { kind: "error", state: errorState });
      },
    );
    return promise;
  }

  // Initial fetch — every REST source starts in `loading`.
  void refetch();

  function unchangedResult(): Promise<SourceLoadResult> {
    return Promise.resolve({ kind: "unchanged", state: state() });
  }

  const query: LevelQueryCapabilities = {
    sort: {
      current: () => opts.rowQuery.current().sort,
      set: (sort) => {
        const changed = opts.rowQuery.setSortState(
          sort ? [...sort] : undefined,
        );
        return changed === "changed" ? refetch() : unchangedResult();
      },
    },
    filter: {
      current: () => opts.rowQuery.current().filter,
      set: (filter) => {
        const next = filter as F | undefined;
        const changed = opts.rowQuery.setFilterState(next);
        return changed === "changed" ? refetch() : unchangedResult();
      },
    },
    refetch,
  };

  const read: LevelDataSource = {
    state,
    subscribe(fn) {
      return subscribers.subscribe(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Disposal is observable to awaiting callers. Tokens prevent late network
      // callbacks from publishing rows or errors after subscribers are cleared.
      fetchToken++;
      resolvePendingLoad({ kind: "disposed" });
      cellTokens.clear();
      subscribers.clear();
      reconcileSubscribers.clear();
    },
    query,
  };

  if (!writable) return read;

  const setCell: WriteCapability["setCell"] = (rowKey, colId, value) => {
    const idx = requireNodeIdx(rowKey);
    const priorValue = nodes[idx].columns[colId];
    setNodeCell(idx, colId, value);
    publishDataMutation();

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
          void refetch();
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
      publishDataMutation();
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
    patch: Readonly<Record<ColId, unknown>>;
    priorValue: unknown;
  }): void {
    const { rowKey, colId, optimisticValue, patch, priorValue } = args;
    const authoritativeValue = colId in patch ? patch[colId] : optimisticValue;
    const idx = findNodeIdx(rowKey);
    if (idx >= 0) {
      const next = nodes.slice();
      next[idx] = snapshotTreeNode(
        {
          ...next[idx],
          columns: { ...next[idx].columns, ...patch },
        },
        structuralSnapshots,
      );
      nodes = Object.freeze(next);
      publishDataMutation();
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
    const idx = findNodeIdx(rowKey);
    if (idx >= 0) {
      try {
        const authoritativeRowKey = rowKeyOfTreeNode(
          node,
          "restLevelSource.patchCell row response",
        );
        if (authoritativeRowKey !== rowKey) {
          throw new Error(
            `restLevelSource.patchCell row response: TreeNode.rowKey changed from "${rowKey}" to "${authoritativeRowKey}"`,
          );
        }
        const next = nodes.slice();
        next[idx] = snapshotTreeNode(node, structuralSnapshots);
        assertUniqueTreeNodeRowKeys(
          next,
          "restLevelSource.patchCell row response",
        );
        nodes = Object.freeze(next);
        publishDataMutation();
      } catch (error) {
        emitReconcile({
          kind: "rejected",
          rowKey,
          colId,
          optimisticValue,
          reason: reasonOf(error),
          priorValue,
        });
        return;
      }
    }
    emitPatchReconcile({
      rowKey,
      colId,
      optimisticValue,
      authoritativeValue: node.columns[colId],
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

  const applyChanges: WriteCapability["applyChanges"] = (changes) => {
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
    publishDataMutation();

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
        publishDataMutation();
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

  const createNode: WriteCapability["createNode"] = async (node, atIndex) => {
    const requestedNode = snapshotTreeNode(node, structuralSnapshots);
    rowKeyOfTreeNode(requestedNode, "restLevelSource.createNode input");
    const responseNode = await opts.insertNode!({
      node: requestedNode,
      atIndex,
    });
    const idx = atIndex === undefined ? nodes.length : atIndex;
    const serverNode = snapshotTreeNode(responseNode, structuralSnapshots);
    rowKeyOfTreeNode(serverNode, "restLevelSource.insertNode response");
    if (disposed) return Object.freeze({ node: serverNode, atIndex: idx });
    assertTreeNodeCanBeInserted(
      nodes,
      serverNode,
      "restLevelSource.insertNode response",
    );
    const next = nodes.slice();
    next.splice(idx, 0, serverNode);
    nodes = Object.freeze(next);
    publishDataMutation();
    return Object.freeze({ node: serverNode, atIndex: idx });
  };

  const removeNode: WriteCapability["removeNode"] = async (rowKey) => {
    await opts.removeNode!({ rowKey });
    if (disposed) return;
    const idx = findNodeIdx(rowKey);
    if (idx < 0) return;
    const next = nodes.slice();
    next.splice(idx, 1);
    nodes = Object.freeze(next);
    publishDataMutation();
  };

  const onReconcile: WriteCapability["onReconcile"] = (fn) => {
    return reconcileSubscribers.subscribe(fn);
  };

  const writableSource: LevelDataSource = {
    state: read.state,
    subscribe: read.subscribe,
    query: read.query,
    dispose: read.dispose,
    write: {
      setCell,
      applyChanges,
      createNode,
      removeNode,
      onReconcile,
      canAppendRow: () => {
        const req = displayRequest ?? request();
        return (
          opts.canAppendRow?.({
            request: req,
            visibleCount: nodes.length,
            totalCount,
          }) ?? false
        );
      },
    },
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

function identityRowsRequest<F>(query: RowQuery<F>): FetchPageRequest<F> {
  return query;
}
