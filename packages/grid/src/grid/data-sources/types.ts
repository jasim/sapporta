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
  readonly nodes: readonly TreeNode[];
  // Server-supplied or source-computed aggregates for this level.
  readonly footerRows?: readonly FooterRow[];
};

export type LevelSourceState =
  | {
      readonly status: "initialLoading";
      readonly snapshot: LevelSnapshot;
    }
  | { readonly status: "ready"; readonly snapshot: LevelSnapshot }
  | {
      readonly status: "refreshing";
      readonly snapshot: LevelSnapshot;
      readonly previous: LevelSnapshot;
    }
  | {
      readonly status: "initialError";
      readonly snapshot: LevelSnapshot;
      readonly error: Error;
    }
  | {
      readonly status: "refreshError";
      readonly snapshot: LevelSnapshot;
      readonly previous: LevelSnapshot;
      readonly error: Error;
    };

export type SourceLoadResult =
  // A source command promise resolves after the source has published the state
  // that the caller can observe through `state()` and subscriptions. The result
  // describes the data-source load only. It does not describe React rendering,
  // DOM focus, scroll position, URL state, or any host workflow that may run
  // after the load settles.
  | {
      readonly kind: "ready";
      readonly state: Extract<LevelSourceState, { status: "ready" }>;
    }
  | {
      readonly kind: "error";
      readonly state: Extract<
        LevelSourceState,
        { status: "initialError" | "refreshError" }
      >;
    }
  | { readonly kind: "unchanged"; readonly state: LevelSourceState }
  | { readonly kind: "superseded" }
  | { readonly kind: "disposed" };

export type CellChange = {
  readonly rowKey: RowKey;
  readonly colId: ColId;
  readonly value: unknown;
};

export type CreateNodeResult = {
  readonly node: TreeNode;
  readonly atIndex: number;
};

// The named outcome of an optimistic edit, surfaced after the server
// roundtrip resolves. Hosts read this to drive notifications, conflict
// UX, or revert decisions.
export type ReconcileEvent =
  | {
      readonly kind: "agreed";
      readonly rowKey: RowKey;
      readonly colId: ColId;
      // The value the server confirmed — equal to the optimistic value
      // the caller passed to `setCell`.
      readonly value: unknown;
    }
  | {
      readonly kind: "diverged";
      readonly rowKey: RowKey;
      readonly colId: ColId;
      // The value the caller submitted.
      readonly optimisticValue: unknown;
      // The value the server actually stored. The source has ALREADY
      // updated `nodes` to this value before emitting, so by the time
      // the host sees this event the grid is showing truth.
      readonly authoritativeValue: unknown;
      // Value visible immediately before the optimistic edit.
      readonly priorValue: unknown;
    }
  | {
      readonly kind: "rejected";
      readonly rowKey: RowKey;
      readonly colId: ColId;
      // The optimistic value still standing in `nodes` — the source
      // does NOT auto-revert.
      readonly optimisticValue: unknown;
      // Backend error text, surfaced verbatim per project policy.
      readonly reason: string;
      // Value visible immediately before the optimistic edit.
      readonly priorValue: unknown;
    };

export type SortQueryCapability = {
  readonly current: () => readonly SortDescriptor[] | undefined;
  readonly set: (
    sort: readonly SortDescriptor[] | undefined,
  ) => Promise<SourceLoadResult>;
};

export type FilterQueryCapability<TFilter = unknown> = {
  readonly current: () => TFilter | undefined;
  readonly set: (filter: TFilter | undefined) => Promise<SourceLoadResult>;
};

export type LevelQueryCapabilities = {
  readonly sort?: SortQueryCapability;
  readonly filter?: FilterQueryCapability<unknown>;
  readonly refetch?: () => Promise<SourceLoadResult>;
};

export type WriteCapability = {
  readonly setCell: (rowKey: RowKey, colId: ColId, value: unknown) => void;
  readonly applyChanges: (changes: readonly CellChange[]) => void;
  readonly createNode: (
    node: TreeNode,
    atIndex?: number,
  ) => Promise<CreateNodeResult>;
  readonly removeNode: (rowKey: RowKey) => void | Promise<void>;
  readonly onReconcile: (fn: (event: ReconcileEvent) => void) => () => void;
  readonly canAppendRow?: () => boolean;
};

export type LevelDataSource = {
  readonly state: () => LevelSourceState;
  // Subscribe to source state transitions. The callback receives no payload;
  // consumers re-read `state()` after it fires. A callback must run only after
  // the source has made the new state visible through `state()`.
  readonly subscribe: (fn: () => void) => () => void;
  readonly dispose: () => void;

  readonly query?: LevelQueryCapabilities;
  readonly write?: WriteCapability;
};

// Host-facing source view returned by `GridRuntime.sourceFor`. It preserves
// read/query/reconcile access while hiding write verbs, so all mutations flow
// through runtime methods.
export type RuntimeLevelDataSource = {
  readonly state: () => LevelSourceState;
  readonly subscribe: (fn: () => void) => () => void;
  readonly query?: LevelQueryCapabilities;
  readonly canWrite: boolean;
  readonly onReconcile: (fn: (event: ReconcileEvent) => void) => () => void;
};

// The hierarchical seam — produces a fresh `LevelDataSource` for each
// expanded child. The runtime owns lifecycle and caching; the source
// must NOT maintain its own child registry.
export type GridDataSource = {
  readonly rootSource: () => LevelDataSource;
  // Pure factory. Returns a fresh `LevelDataSource` for a child level
  // rooted at (parentPath, parentRowKey, childLevelName). The runtime's
  // registry guards against double-resolve.
  readonly resolveChild: (
    parentPath: GridPath,
    parentRowKey: RowKey,
    childLevelName: string,
  ) => LevelDataSource;
  readonly dispose: () => void;
};

// Phantoms — author-state, kept on a separate per-path channel and layered
// into the pipeline alongside the data snapshot. A source never sees a
// phantom. One `PhantomChannel` exists per runtime, keyed by path.
export type PhantomChannel = {
  // Identity-stable — same path with the same phantom set returns the
  // same array reference.
  readonly get: (path: GridPath) => readonly PhantomRow[];
  readonly add: (path: GridPath, phantom: PhantomRow) => void;
  readonly remove: (path: GridPath, rowKey: RowKey) => void;
  readonly setCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  readonly setState: (
    path: GridPath,
    rowKey: RowKey,
    state: PhantomRowState,
  ) => void;
  readonly update: (
    path: GridPath,
    rowKey: RowKey,
    update: (row: PhantomRow) => PhantomRow,
  ) => void;
  readonly subscribe: (path: GridPath, fn: () => void) => () => void;
  readonly dispose: () => void;
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
  readonly sort?: readonly SortDescriptor[];
  readonly filter?: F;
  readonly page: number;
  readonly pageSize: number;
};

export type FetchPageResponse = {
  // Already shaped by the endpoint for display.
  readonly nodes: readonly TreeNode[];
  readonly totalCount?: number;
  readonly footerRows?: readonly FooterRow[];
};

export type PatchCellRequest = {
  readonly rowKey: RowKey;
  readonly colId: ColId;
  readonly value: unknown;
  readonly row: Readonly<Record<ColId, unknown>>;
};

// `patchCell` can return the authoritative cell value, a row patch, a full
// row replacement, or request a reload. The simple `{ value }` shape is the
// source-level contract for direct cell updates.
export type PatchCellResponse =
  | { readonly value: unknown }
  | { readonly kind: "value"; readonly value: unknown }
  | {
      readonly kind: "patch";
      readonly patch: Readonly<Record<ColId, unknown>>;
    }
  | { readonly kind: "row"; readonly node: TreeNode }
  | { readonly kind: "reload" };

export type InsertNodeRequest = {
  readonly node: TreeNode;
  readonly atIndex?: number;
};

export type RemoveNodeRequest = {
  readonly rowKey: RowKey;
};
