// Data plane — the fourth grid channel.
//
// `LevelDataSource` owns nodes, sort/filter/pagination state, server-supplied
// footers/aggregates, and `loading | error | ready` status for one
// `GridPath`. `GridDataSource` is the hierarchical seam through which deeper
// paths come into existence — the runtime calls `resolveChild` on expansion
// and registers the returned `LevelDataSource`.
//
// Seven invariants govern the data plane. Every source, runtime, and
// displayed-row derivation stage must honor them; every consumer can rely on
// them.
//
//   1. Displayed-row derivation is pure and synchronous. Async lives only in
//      data sources. A derivation stage never awaits, never reads a clock,
//      never decides based on `status`.
//
//   2. The runtime never owns data. It receives a `GridDataSource` from
//      the host. There is no in-runtime store of nodes/sort/filter — those
//      concerns live on the source. Optimistic edits flow through source
//      verbs.
//
//   3. Mode is declared, not inferred. Each snapshot carries
//      `serverManaged: { sort, filter, pagination }`. Displayed-row
//      derivation switches on those flags; nothing else inspects the source's
//      wiring. All eight combinations are well-defined; the grid does not warn
//      or refuse.
//
//   4. Identity stability is the source's contract. A snapshot whose
//      contents didn't change must be `===` to the previous one. Displayed-row
//      identity preservation and `React.memo` rely on this and must not be
//      papered over with deep equality.
//
//   5. Loading is data, not chrome state. `status` is on the snapshot;
//      the Grid component renders chrome from it. There is no parallel
//      "isLoadingByPath" map. Loading chrome renders as a band above the
//      body, never as a sentinel row inside `displayed.rows` — sentinel
//      rows would infect focus targets, selection ranges, copy buffers,
//      and boundary navigation with special cases.
//
//   6. Phantoms are not data. They are author-state, kept on a separate
//      per-path `PhantomChannel` and layered into displayed-row derivation
//      alongside the data snapshot. A source never sees a phantom.
//      `commitPhantom` is a host-orchestrated two-step: source verb
//      (`insertNode`) plus phantom removal — done in the runtime helper, not
//      on the source.
//
// Read-only sources omit the edit verbs entirely so the discriminated union
// prevents callers from invoking writes on them at compile time (and at
// runtime `'setCell' in source === false`).
//
//   7. Source-internal mutations are not user-attributable mutations.
//      Refetches, authoritative reconcile updates, atomic rollbacks, and
//      wholesale replacements surface through `subscribe()` only. The
//      runtime is the sole emitter of `mutationCommitted`, and it emits that
//      event iff a runtime write verb was invoked.

import type { ColId, GridPath, RowKey } from "../types/identity";
import type {
  FooterRow,
  PhantomRow,
  TreeNode,
} from "../types/level-row";
import type { RowPredicate, SortDescriptor } from "../pipeline/types";

export type LevelStatus = "idle" | "loading" | "error" | "ready";

// `F` is the host's filter grammar — opaque to the grid. The grid neither
// defines operators nor knows what "search" means; it carries `F` through
// as a parameter and only ever invokes a `RowPredicate` (compiled from `F`
// by the host) when it actually has to filter rows locally. Real backends
// speak operators (`eq`/`like`/`gt`/`in`), permit multiple conditions on
// the same column (`amount > 100 AND amount < 500`), have free-text search
// as a sibling concern, and may carry boolean structure (AND/OR groups);
// `F` admits any of those. A typical host grammar might look like
// `{ conditions: FilterCondition[]; search: string | null }` — but that
// shape is the host's call, not the grid's.
//
// `F` defaults to `unknown` deliberately. From a consumer's perspective
// `unknown` is uninhabited: you can't read `filter.x` off it without a
// cast. So an unparameterized source physically cannot be combined with a
// `query` / `fetchPage` that depends on the grammar. Either commit to a
// grammar by parameterizing the factory (`restLevelSource<TableFilter>`)
// or don't use filtering — there is no third path where the grid quietly
// accepts a bag of anything.
//
// Two channels carry filter information through the snapshot, with
// disjoint responsibilities:
//
//   - `filter: F` is *data*. Displayed-row derivation never reads it. It exists so
//     the source's own `query()` and `fetchPage(req)` see the same shape,
//     and so chrome that derives from the snapshot has something to read
//     in source-owned mode. It is the round-trip channel.
//
//   - `applyFilter: RowPredicate` is *behavior*. Displayed-row derivation
//     calls it iff `serverManaged.filter` is false (i.e. iff filtering hasn't
//     already happened upstream). The host's `compileFilter` produces it from
//     `F`. Hosts that always filter server-side don't supply one; hosts that
//     filter client-side do.
//
// They are orthogonal because they answer orthogonal questions: "what is
// the host's current filter state?" vs. "how does the pipeline drop rows
// right now?" Conflating them was the previous design's bug — a single
// `Record<ColId, predicate>` shape served both roles and forced any host
// with a richer wire grammar to smuggle data past the contract.
export type LevelSnapshot<F = unknown> = {
  status: LevelStatus;
  // Present iff status === "error".
  error?: Error;
  // The nodes displayed-row derivation sees. Already windowed/sorted/filtered
  // if the source declared those concerns server-managed. Identity-stable.
  nodes: TreeNode[];
  // Server-supplied or source-computed aggregates for this level.
  footerRows?: FooterRow[];
  // Current declared state — round-tripped through `query()`/`fetchPage(req)`,
  // and read by source-owned chrome (paging buttons, sort indicators) when
  // the host doesn't render its own. Displayed-row derivation never reads
  // `filter`.
  sort?: SortDescriptor[];
  filter?: F;
  // The data channel's behavior counterpart. Used only when
  // `serverManaged.filter` is false. The source compiles its grammar to a
  // predicate (via host-supplied `compileFilter`) and supplies the result
  // here; displayed-row derivation calls it. The grid never compiles a grammar
  // — it has no idea what one is.
  applyFilter?: RowPredicate;
  pagination?: { page: number; pageSize: number; totalCount?: number };
  // Declarative: which concerns the source has already applied to `nodes`.
  // Displayed-row derivation skips matching stages. Static for a given source
  // — the same triple is re-emitted on every snapshot — but lives on the
  // snapshot so derivation is a pure function of `DisplayedRowsInput` with no side
  // reads into the source.
  serverManaged: { sort: boolean; filter: boolean; pagination: boolean };
};

export type CellChange = { rowKey: RowKey; colId: ColId; value: unknown };

// The named outcome of an optimistic edit, surfaced after the server
// roundtrip resolves. Hosts read this to drive notifications, conflict
// UX, or revert decisions.
export type ReconcileEvent =
  | {
      kind: "agreed";
      rowKey: RowKey;
      colId: ColId;
      // The value the server confirmed — equal to the optimistic value
      // the caller passed to `setCell`.
      value: unknown;
    }
  | {
      kind: "diverged";
      rowKey: RowKey;
      colId: ColId;
      // The value the caller submitted.
      optimisticValue: unknown;
      // The value the server actually stored. The source has ALREADY
      // updated `nodes` to this value before emitting, so by the time
      // the host sees this event the grid is showing truth.
      authoritativeValue: unknown;
      // Value visible immediately before the optimistic edit.
      priorValue: unknown;
    }
  | {
      kind: "rejected";
      rowKey: RowKey;
      colId: ColId;
      // The optimistic value still standing in `nodes` — the source
      // does NOT auto-revert.
      optimisticValue: unknown;
      // Backend error text, surfaced verbatim per project policy.
      reason: string;
      // Value visible immediately before the optimistic edit.
      priorValue: unknown;
    };

// Read surface — every source has this. Sources that cannot mutate stop
// here. The grid statically knows not to show edit affordances for them.
//
// `LevelDataSource` is intentionally non-parametric over `F`. The reason
// is type-system contravariance: `setFilter: (f?: F) => void` is *contra*
// in `F`, so `LevelDataSource<TableFilter>` would NOT be assignable to
// `LevelDataSource<unknown>` (a caller passing `unknown` couldn't safely
// hand it to a callee expecting `TableFilter`). The runtime needs to hold
// any source uniformly regardless of grammar, so the cross-source contract
// erases `F` to `unknown` here. Type-safe filter wiring lives one layer up:
// `RestLevelSourceOpts<F>` / `InMemoryLevelSourceOpts<F>` thread `F` through
// `query()` and `fetchPage(req)`, and the source's internal state is typed
// over `F`. The runtime never reads `setFilter`'s argument; only the host
// (which knows its own grammar) does.
export type ReadonlyLevelDataSource = {
  writable: false;
  snapshot(): LevelSnapshot;
  // Subscribe to snapshot transitions. The callback receives no payload —
  // consumers re-read `snapshot()` after the callback fires. Returns an
  // unsubscribe function.
  subscribe(fn: () => void): () => void;
  setSort: (s?: SortDescriptor[]) => void;
  // `unknown` here is the cross-source contract's type erasure (see the
  // type comment above). A typed source casts internally; an untyped caller
  // can pass anything but cannot meaningfully construct one without knowing
  // the grammar.
  setFilter: (f?: unknown) => void;
  setPage: (page: number, pageSize: number) => void;
  refetch: () => void;
  // Tear down the source. After dispose, `subscribe` callbacks must NOT
  // fire — the source is expected to drop its subscriber list on dispose
  // rather than emit a final synthetic event.
  dispose(): void;
};

// Host-facing source view returned by `GridRuntime.sourceFor`. It preserves
// read/query/reconcile access while hiding write verbs, so all mutations flow
// through runtime methods.
export type RuntimeLevelDataSource = Omit<ReadonlyLevelDataSource, "writable"> & {
  writable: boolean;
  onReconcile(fn: (e: ReconcileEvent) => void): () => void;
};

// Write surface — extends the read surface. Edit verbs and the
// reconciliation channel only exist on writable sources.
export type WritableLevelDataSource = Omit<ReadonlyLevelDataSource, "writable"> & {
  writable: true;
  // Optimistic in-place edit. The source applies the change locally and
  // kicks off any server roundtrip.
  setCell: (rowKey: RowKey, colId: ColId, value: unknown) => void;
  // Atomic from the grid's view: every change applies or none does.
  applyChanges: (changes: CellChange[]) => void;
  insertNode: (node: TreeNode, atIndex?: number) => void;
  removeNode: (rowKey: RowKey) => void;
  // Per-cell reconciliation channel. Fires once per `setCell` /
  // `applyChanges` entry when the optimistic write has been resolved
  // against authoritative state. Sync sources may skip emission (the
  // optimistic and authoritative values are the same by construction);
  // async sources MUST emit exactly one event per submitted edit.
  onReconcile(fn: (e: ReconcileEvent) => void): () => void;
};

export type LevelDataSource = ReadonlyLevelDataSource | WritableLevelDataSource;

// The hierarchical seam — produces a fresh `LevelDataSource` for each
// expanded child. The runtime owns lifecycle and caching; the source
// must NOT maintain its own child registry.
export type GridDataSource = {
  rootSource: () => LevelDataSource;
  // Pure factory. Returns a fresh `LevelDataSource` for a child level
  // rooted at (parentPath, parentRowKey, childLevelName). The runtime's
  // registry guards against double-resolve.
  resolveChild: (
    parentPath: GridPath,
    parentRowKey: RowKey,
    childLevelName: string,
  ) => LevelDataSource;
  dispose: () => void;
};

// Phantoms — author-state, kept on a separate per-path channel and layered
// into the pipeline alongside the data snapshot. A source never sees a
// phantom. One `PhantomChannel` per runtime; the implementation lands in
// phase 02 (a Zustand-or-equivalent store keyed on path).
export type PhantomChannel = {
  // Identity-stable — same path with the same phantom set returns the
  // same array reference.
  get: (path: GridPath) => PhantomRow[];
  add: (path: GridPath, phantom: PhantomRow) => void;
  remove: (path: GridPath, rowKey: RowKey) => void;
  setCell: (path: GridPath, rowKey: RowKey, colId: ColId, value: unknown) => void;
  subscribe: (path: GridPath, fn: () => void) => () => void;
};

// REST request / response shapes consumed by `restLevelSource`. Declared
// here so the data module's type surface is self-contained.
//
// `FetchPageRequest<F>` is the host's wire shape. `filter: F` round-trips
// from the host's `query()` callback to its `fetchPage(req)` callback
// without inspection; nothing between those two points reads it. Edit
// verbs (`PatchCellRequest` / `InsertNodeRequest` / `RemoveNodeRequest`)
// describe operations on rows, not filter state, and need no
// parameterization — they are unaffected by the host's filter grammar.

export type FetchPageRequest<F = unknown> = {
  sort?: SortDescriptor[];
  filter?: F;
  page: number;
  pageSize: number;
};

export type FetchPageResponse = {
  // Already shaped per the source's declared serverManaged flags.
  nodes: TreeNode[];
  totalCount?: number;
  footerRows?: FooterRow[];
};

export type PatchCellRequest = {
  rowKey: RowKey;
  colId: ColId;
  value: unknown;
};

// `patchCell` returns the authoritative cell value as the server stored
// it. If it equals the optimistic value, the source emits `agreed`. If
// it differs, the source updates `nodes` to the authoritative value and
// emits `diverged`.
export type PatchCellResponse = { value: unknown };

export type InsertNodeRequest = {
  node: TreeNode;
  atIndex?: number;
};

export type RemoveNodeRequest = {
  rowKey: RowKey;
};
