// Pristine state container for the new grid path. Owns sort/filters/search/
// page (all URL-synced). FK cell/editor lookups are owned by
// `TableLookupRegistry`. The grid runtime sits next to the store: it is backed
// by a `restGridDataSource` configured in host-owned mode, so the
// source asks the store for the current `FetchPageRequest` on every fetch
// and never carries its own copy of sort/filter/page state. Page/sort/
// filter changes flow `store.set* → handle.refetch() → query() →
// fetchPage(req)`. The store does not own row data — that is the source's
// job.
//
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createGridRuntime,
  restGridDataSource,
  rootPath,
  type GridRuntime,
  type RuntimeLevelDataSource,
  type SortDescriptor,
} from "@/grid";
import {
  filtersEqual,
  mintFilterId,
  normalizeFilters,
  type FilterCondition,
  type NewFilterCondition,
} from "@sapporta/shared/filter";
import type { TableSchema } from "@sapporta/shared/contracts";
import { sortOrderEqual } from "../../lib/sort";
import {
  compileTableGrid,
  type TableFilter,
  type TableLevelMeta,
} from "./compile-table-grid";
import { createTableGridThemeContext } from "./table-grid-theme-context";
import {
  createTableLookupRegistry,
  type TableLookupRegistry,
} from "./table-lookup-registry";

export type NewTableState = {
  tableName: string;
  sort: SortDescriptor[];
  filters: FilterCondition[];
  search: string | null;
  page: number;
  pageSize: number;
  // Sticky banner text — surfaced in `NewTablePage` above the grid. Driven
  // today by `cellReconciled` rejections; future row-delete failures land
  // here too. The grid stays usable underneath; the user can dismiss or
  // retry.
  errorBanner: string | null;

  setSort: (sort: SortDescriptor[]) => void;
  clearSort: () => void;
  addFilter: (cond: NewFilterCondition) => void;
  updateFilter: (id: string, patch: NewFilterCondition) => void;
  removeFilter: (id: string) => void;
  clearFilters: () => void;
  setSearch: (q: string | null) => void;
  setTableFilter: (filter: TableFilter | undefined) => void;
  setPage: (page: number) => void;

  setErrorBanner: (msg: string | null) => void;

  syncFromUrl: (params: {
    page: number;
    sort: SortDescriptor[] | undefined;
    filters: FilterCondition[];
    search: string | null;
  }) => void;
};

export type NewTableHandle = {
  store: StoreApi<NewTableState>;
  runtime: GridRuntime;
  source: RuntimeLevelDataSource;
  lookupRegistry: TableLookupRegistry;
  levelMetaById: Record<string, TableLevelMeta>;
  refetch: () => void;
  dispose: () => void;
};

export type CreateNewTableArgs = {
  tableName: string;
  tableSchema: TableSchema;
  tablesByName: Record<string, TableSchema>;
  initialSort?: SortDescriptor[];
  initialFilters?: FilterCondition[];
  initialSearch?: string | null;
  initialPage?: number;
  pageSize?: number;
  // Pushed after every user-initiated state change. The host wires this
  // to `react-router`'s `navigate(replace: true)`. Not invoked from
  // `syncFromUrl` — the URL is already correct in that path, and pushing
  // again would loop.
  onUrlChange?: (state: {
    page: number;
    sort: SortDescriptor[];
    filters: FilterCondition[];
    search: string | null;
  }) => void;
};

export function createNewTable(args: CreateNewTableArgs): NewTableHandle {
  const pkCol = args.tableSchema.columns.find((c) => c.primary);
  if (!pkCol) {
    throw new Error(
      `createNewTable: table '${args.tableName}' has no primary key column — every Sapporta table must declare one`,
    );
  }

  const pageSize = args.pageSize ?? 50;

  // Build the store before the runtime so the source's `fetchPage` closure
  // can read `store.getState()` for the latest sort/filter/search/page.
  const store = createStore<NewTableState>()((set, get) => ({
    tableName: args.tableName,
    sort: args.initialSort ?? [],
    filters: normalizeFilters(args.initialFilters ?? []),
    search: args.initialSearch ?? null,
    page: args.initialPage ?? 1,
    pageSize,
    errorBanner: null,

    setSort: (sort) => {
      if (sortOrderEqual(get().sort, sort)) return;
      set({ sort, page: 1 });
      handle.refetch();
      pushUrl();
    },
    clearSort: () => {
      if (get().sort.length === 0) return;
      set({ sort: [], page: 1 });
      handle.refetch();
      pushUrl();
    },
    addFilter: (cond) => {
      const next = [
        ...get().filters,
        { ...cond, id: mintFilterId(cond.column, cond.op) },
      ];
      set({ filters: next, page: 1 });
      handle.refetch();
      pushUrl();
    },
    updateFilter: (id, patch) => {
      const idx = get().filters.findIndex((f) => f.id === id);
      if (idx < 0) return;
      const next = [...get().filters];
      next[idx] = { ...patch, id } as FilterCondition;
      set({ filters: next, page: 1 });
      handle.refetch();
      pushUrl();
    },
    removeFilter: (id) => {
      const next = get().filters.filter((f) => f.id !== id);
      if (next.length === get().filters.length) return;
      set({ filters: next, page: 1 });
      handle.refetch();
      pushUrl();
    },
    clearFilters: () => {
      if (get().filters.length === 0) return;
      set({ filters: [], page: 1 });
      handle.refetch();
      pushUrl();
    },
    setSearch: (q) => {
      const normalized = q && q.trim() !== "" ? q : null;
      if (get().search === normalized) return;
      set({ search: normalized, page: 1 });
      handle.refetch();
      pushUrl();
    },
    setTableFilter: (filter) => {
      const nextFilters = normalizeFilters(filter?.conditions ?? []);
      const nextSearch =
        filter?.search && filter.search.trim() !== "" ? filter.search : null;
      const cur = get();
      if (filtersEqual(cur.filters, nextFilters) && cur.search === nextSearch) {
        return;
      }
      set({ filters: nextFilters, search: nextSearch, page: 1 });
      handle.refetch();
      pushUrl();
    },
    setPage: (page) => {
      if (get().page === page) return;
      set({ page });
      handle.refetch();
      pushUrl();
    },

    setErrorBanner: (msg) => set({ errorBanner: msg }),

    syncFromUrl: (params) => {
      const cur = get();
      const patch: Partial<NewTableState> = {};
      if (cur.page !== params.page) patch.page = params.page;
      if (cur.search !== params.search) patch.search = params.search;
      if (!filtersEqual(cur.filters, params.filters))
        patch.filters = params.filters;
      if (params.sort !== undefined && !sortOrderEqual(cur.sort, params.sort)) {
        patch.sort = params.sort;
      }
      if (Object.keys(patch).length === 0) return;
      set(patch);
      handle.refetch();
      // Deliberately no `pushUrl()` — the URL is already authoritative here;
      // pushing it back would create a feedback loop with `useSearchParams`.
    },
  }));

  function pushUrl(): void {
    if (!args.onUrlChange) return;
    const s = store.getState();
    args.onUrlChange({
      page: s.page,
      sort: s.sort,
      filters: s.filters,
      search: s.search,
    });
  }

  const lookupRegistry = createTableLookupRegistry();
  const theme = createTableGridThemeContext(lookupRegistry);
  const compiled = compileTableGrid({
    rootTable: args.tableSchema,
    tablesByName: args.tablesByName,
    theme,
    rootStatePolicy: {
      query: () => {
        const s = store.getState();
        return {
          page: s.page,
          pageSize: s.pageSize,
          sort: s.sort,
          filter: { conditions: s.filters, search: s.search },
        };
      },
    },
    childQueryPolicy: { pageSize: () => store.getState().pageSize },
  });

  const dataSource = restGridDataSource<TableFilter>({
    schema: compiled.schema,
    endpoints: compiled.endpoints,
  });

  const runtime = createGridRuntime({
    schema: compiled.schema,
    dataSource,
    on: {
      cellReconciled: ({ event }) => {
        if (event.kind === "rejected") {
          // Surface the verbatim server error per project policy. The user
          // sees a banner; they can dismiss it or retry the edit.
          store
            .getState()
            .setErrorBanner(
              `Failed to save ${String(event.colId)}: ${event.reason}`,
            );
        }
      },
    },
  });

  const source = runtime.sourceFor(rootPath(compiled.schema.rootLevel));

  const handle: NewTableHandle = {
    store,
    runtime,
    source,
    lookupRegistry,
    levelMetaById: compiled.levelMetaById,
    refetch: () => source.refetch(),
    dispose: () => {
      runtime.dispose();
      lookupRegistry.dispose();
    },
  };

  return handle;
}
