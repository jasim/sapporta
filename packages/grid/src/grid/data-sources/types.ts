// Data plane — the fourth grid channel.
//
// A source owns loading, subscriptions, query commands, writes, reconciliation,
// and disposal for one `GridPath`. A source snapshot is deliberately smaller:
// it is only the row data that can be rendered now. Sort, filter, retry, and
// append decisions live on capabilities or on the host layer that owns them.
// Page numbers are not a grid-core concept; a table host can keep one-based
// route/API page state while a custom source can expose a different loading
// capability without changing the render contract.

import type { ColId, GridPath, RowKey } from "../types/identity";
import type {
  FooterRow,
  PhantomRow,
  PhantomRowState,
  TreeNode,
} from "../types/level-row";
import type { SortDescriptor } from "../pipeline/types";

export type LevelStatus = LevelSourceState["status"];

export type LevelSnapshot = {
  // Already filtered, sorted, and windowed for display by the source or host.
  // Consumers render these nodes as-is. If an application needs a different
  // query policy, it belongs in the source that publishes this array.
  nodes: readonly TreeNode[];
  // Server-supplied or source-computed aggregates for this level.
  footerRows?: readonly FooterRow[];
};

export type LevelSourceState =
  | {
      status: "initialLoading";
      snapshot: LevelSnapshot;
    }
  | { status: "ready"; snapshot: LevelSnapshot }
  | {
      status: "refreshing";
      snapshot: LevelSnapshot;
      previous: LevelSnapshot;
    }
  | {
      status: "initialError";
      snapshot: LevelSnapshot;
      error: Error;
    }
  | {
      status: "refreshError";
      snapshot: LevelSnapshot;
      previous: LevelSnapshot;
      error: Error;
    };

export type SourceLoadResult =
  // A source command promise resolves after the source has published the state
  // that the caller can observe through `state()` and subscriptions. The result
  // describes the data-source load only. It does not describe React rendering,
  // DOM focus, scroll position, URL state, or any host workflow that may run
  // after the load settles.
  | {
      kind: "ready";
      state: Extract<LevelSourceState, { status: "ready" }>;
    }
  | {
      kind: "error";
      state: Extract<
        LevelSourceState,
        { status: "initialError" | "refreshError" }
      >;
    }
  | { kind: "unchanged"; state: LevelSourceState }
  | { kind: "superseded" }
  | { kind: "disposed" };

export type CellChange = { rowKey: RowKey; colId: ColId; value: unknown };

export type CreateNodeResult = {
  node: TreeNode;
  atIndex: number;
};

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

export type SortQueryCapability = {
  current(): readonly SortDescriptor[] | undefined;
  set(sort: readonly SortDescriptor[] | undefined): Promise<SourceLoadResult>;
};

export type FilterQueryCapability<TFilter = unknown> = {
  current(): TFilter | undefined;
  set(filter: TFilter | undefined): Promise<SourceLoadResult>;
};

export type LevelQueryCapabilities = {
  sort?: SortQueryCapability;
  filter?: FilterQueryCapability<unknown>;
  refetch?: () => Promise<SourceLoadResult>;
};

export type WriteCapability = {
  setCell(rowKey: RowKey, colId: ColId, value: unknown): void;
  applyChanges(changes: readonly CellChange[]): void;
  createNode(node: TreeNode, atIndex?: number): Promise<CreateNodeResult>;
  removeNode(rowKey: RowKey): void | Promise<void>;
  onReconcile(fn: (event: ReconcileEvent) => void): () => void;
  canAppendRow?: () => boolean;
};

export type LevelDataSource = {
  state(): LevelSourceState;
  // Subscribe to source state transitions. The callback receives no payload;
  // consumers re-read `state()` after it fires. A callback must run only after
  // the source has made the new state visible through `state()`.
  subscribe(fn: () => void): () => void;
  dispose(): void;

  query?: LevelQueryCapabilities;
  write?: WriteCapability;
};

// Host-facing source view returned by `GridRuntime.sourceFor`. It preserves
// read/query/reconcile access while hiding write verbs, so all mutations flow
// through runtime methods.
export type RuntimeLevelDataSource = {
  state(): LevelSourceState;
  subscribe(fn: () => void): () => void;
  query?: LevelQueryCapabilities;
  canWrite: boolean;
  onReconcile(fn: (e: ReconcileEvent) => void): () => void;
};

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
// phantom. One `PhantomChannel` exists per runtime, keyed by path.
export type PhantomChannel = {
  // Identity-stable — same path with the same phantom set returns the
  // same array reference.
  get: (path: GridPath) => PhantomRow[];
  add: (path: GridPath, phantom: PhantomRow) => void;
  remove: (path: GridPath, rowKey: RowKey) => void;
  setCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  setState: (path: GridPath, rowKey: RowKey, state: PhantomRowState) => void;
  update: (
    path: GridPath,
    rowKey: RowKey,
    update: (row: PhantomRow) => PhantomRow,
  ) => void;
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
  sort?: readonly SortDescriptor[];
  filter?: F;
  page: number;
  pageSize: number;
};

export type FetchPageResponse = {
  // Already shaped by the endpoint for display.
  nodes: readonly TreeNode[];
  totalCount?: number;
  footerRows?: readonly FooterRow[];
};

export type PatchCellRequest = {
  rowKey: RowKey;
  colId: ColId;
  value: unknown;
  row: Record<ColId, unknown>;
};

// `patchCell` can return the authoritative cell value, a row patch, a full
// row replacement, or request a reload. The simple `{ value }` shape is the
// source-level contract for direct cell updates.
export type PatchCellResponse =
  | { value: unknown }
  | { kind: "value"; value: unknown }
  | { kind: "patch"; patch: Record<ColId, unknown> }
  | { kind: "row"; node: TreeNode }
  | { kind: "reload" };

export type InsertNodeRequest = {
  node: TreeNode;
  atIndex?: number;
};

export type RemoveNodeRequest = {
  rowKey: RowKey;
};
