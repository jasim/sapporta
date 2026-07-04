import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createGridRuntime,
  makeRowId,
  restGridDataSource,
  rootPath,
  type GridPath,
  type GridRuntime,
  type LevelSourceState,
  type PageBoundaryNavigationRequest,
  type RuntimeLevelDataSource,
  type RowQueryState,
  type RowKey,
  type SortDescriptor,
  type SourceLoadResult,
} from "@sapporta/grid";
import {
  filtersEqual,
  mintFilterId,
  normalizeFilters,
  type FilterCondition,
  type NewFilterCondition,
} from "@sapporta/shared/filter";
import { sortOrderEqual } from "@sapporta/grid";
import {
  compileTGridRuntimeConfig,
  type TGridDefinition,
} from "../grid-adapter/tgrid-runtime-config";
import type { TGridFilter } from "../grid-adapter/tgrid-filter";
import type {
  TGridLevelConfig,
  TGridLevelInfo,
  TGridLevelsConfigMap,
} from "../grid-adapter/tgrid-level-config";
import {
  createTGridColumnMapper,
  type TGridColumnMapper,
} from "../grid-adapter/tgrid-column-mapper";
import type {
  TGridRuntimeLevel,
  TGridSessionContext,
} from "../grid-adapter/tgrid-cell-context";
import { createTGridLookupResolver } from "../grid-adapter/tgrid-lookup-resolver";
import {
  createTableLookupRegistry,
  type TableLookupRegistry,
} from "../lookup/table-lookup-registry";
import {
  createColumnLookupResolver,
  type LookupForColumn,
} from "../lookup/column-lookup";
import { buildTableRowsQuery } from "../api/rows";
import { getApiBase } from "../../platform/client";
import type {
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "../grid-adapter/tgrid-types";
import type {
  TGridRouteQuerySeed,
  TGridLevelQueryState,
} from "./tgrid-level-query-state";
export type { TGridRouteQuerySeed } from "./tgrid-level-query-state";

// Options for a table page. Pass `services` for custom cells/editors,
// `routeQuerySeeds` for route-provided starting controls, and `onQueryUrlChange`
// when the page should keep its URL in sync with table controls.
export type CreateTGridSessionArgs<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = {
  services?: AppServices;
  onQueryUrlChange?: (state: {
    level: TGridLevelId<RowsByLevel>;
    page: number;
    sort: SortDescriptor[];
    filters: FilterCondition[];
    search: string | null;
  }) => void;
  routeQuerySeeds?: Partial<
    Record<TGridLevelId<RowsByLevel>, TGridRouteQuerySeed>
  >;
};

// Values a mounted React page can update without recreating the table session.
export type TGridLiveInputs<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = CreateTGridSessionArgs<RowsByLevel, AppServices>;

export type TGridLiveInputsRef<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = {
  current: TGridLiveInputs<RowsByLevel, AppServices>;
};

// A live table view. Use it to read loaded rows, reload data, build export URLs,
// and give custom cells access to app services and level metadata.
//
// `getVisibleRows` and `getLoadedRow` read rows already loaded into the grid.
// They are not database queries; use a row client or endpoint when you need data
// that may not be visible on the current page.
export type TGridSession<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = TGridSessionContext<RowsByLevel, AppServices> & {
  rootTableName: string;
  queryStore: StoreApi<
    TGridLevelQueryState<RowsByLevel[TGridLevelId<RowsByLevel>]>
  >;
  rootSource: RuntimeLevelDataSource;
  columnMapper: TGridColumnMapper;
  levelInfoById: Record<TGridLevelId<RowsByLevel>, TGridLevelInfo>;
  getVisibleRows<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId?: LevelId,
    path?: GridPath,
  ): readonly Readonly<RowsByLevel[LevelId]>[];
  getLoadedRow<LevelId extends TGridLevelId<RowsByLevel>>(
    rowKey: string,
    levelId?: LevelId,
    path?: GridPath,
  ): Readonly<RowsByLevel[LevelId]> | undefined;
  getQueryState<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId?: LevelId,
  ): TGridLevelQueryState<RowsByLevel[LevelId]>;
  reloadRows(
    levelId?: TGridLevelId<RowsByLevel>,
    path?: GridPath,
  ): Promise<SourceLoadResult>;
  setLevelSort(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    sort: SortDescriptor[],
  ): Promise<SourceLoadResult>;
  setLevelFilter(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    filter: TGridFilter | undefined,
  ): Promise<SourceLoadResult>;
  setLevelPage(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    page: number,
    pageSize: number,
  ): Promise<SourceLoadResult>;
  setErrorBanner(message: string | null): void;
  lookupForColumn: LookupForColumn;
  csvExportUrl(levelId?: TGridLevelId<RowsByLevel>): string;
  dispose(): void;
};

// Create a table session outside React, such as in tests or custom mounting code.
export function createTGridSession<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
>(
  definition: TGridDefinition<RowsByLevel, AppServices>,
  args: CreateTGridSessionArgs<RowsByLevel, AppServices> = {},
): TGridSession<RowsByLevel, AppServices> {
  return createTGridSessionWithRef(definition, { current: args });
}

// Create a session whose app services and route callback can change while the
// table stays mounted.
export function createTGridSessionWithRef<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
>(
  definition: TGridDefinition<RowsByLevel, AppServices>,
  liveInputsRef: TGridLiveInputsRef<RowsByLevel, AppServices>,
): TGridSession<RowsByLevel, AppServices> {
  return new DefaultTGridSession(definition, liveInputsRef);
}

class DefaultTGridSession<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
> implements TGridSession<RowsByLevel, AppServices> {
  readonly rootLevel: TGridLevelId<RowsByLevel>;
  readonly rootTableName: string;
  private readonly liveInputsRef: TGridLiveInputsRef<RowsByLevel, AppServices>;
  private readonly rootGridPath: GridPath;
  private readonly queryStoresByLevel = new Map<
    TGridLevelId<RowsByLevel>,
    StoreApi<TGridLevelQueryState<TGridTableRow>>
  >();
  readonly queryStore: StoreApi<
    TGridLevelQueryState<RowsByLevel[TGridLevelId<RowsByLevel>]>
  >;
  readonly runtime: GridRuntime;
  readonly rootSource: RuntimeLevelDataSource;
  readonly lookupRegistry: TableLookupRegistry;
  readonly lookupForColumn: LookupForColumn;
  readonly columnMapper: TGridColumnMapper;
  readonly levelInfoById: Record<TGridLevelId<RowsByLevel>, TGridLevelInfo>;
  readonly levels: TGridSessionContext<RowsByLevel, AppServices>["levels"];

  constructor(
    definition: TGridDefinition<RowsByLevel, AppServices>,
    liveInputsRef: TGridLiveInputsRef<RowsByLevel, AppServices>,
  ) {
    this.liveInputsRef = liveInputsRef;
    this.rootLevel = definition.rootLevel;
    this.rootTableName = definition.levels[definition.rootLevel].table.name;
    this.lookupRegistry = createTableLookupRegistry();
    this.lookupForColumn = createColumnLookupResolver(
      this.lookupRegistry,
    ).lookupForColumn;

    const lookupResolver = createTGridLookupResolver(this.lookupRegistry);
    this.columnMapper = createTGridColumnMapper(lookupResolver);

    // Levels with visible table controls need query stores so filters, search,
    // paging, export links, and row fetches all use the same state.
    for (const [levelId, level] of Object.entries(definition.levels) as Array<
      [TGridLevelId<RowsByLevel>, TGridLevelConfig<RowsByLevel, AppServices>]
    >) {
      if (
        (level.query?.owner ??
          (levelId === definition.rootLevel ? "host" : "source")) === "host"
      ) {
        this.queryStoresByLevel.set(
          levelId,
          this.createQueryStore(levelId, level),
        );
      }
    }

    const runtimeConfig = compileTGridRuntimeConfig({
      rootLevel: definition.rootLevel,
      levels: definition.levels,
      columnMapper: this.columnMapper,
      hostRowQueryState: (levelId) => this.hostRowQueryState(levelId),
      sessionContext: this.currentSessionContext,
    });

    const dataSource = restGridDataSource<TGridFilter>({
      schema: runtimeConfig.gridSchema,
      endpoints: runtimeConfig.endpointFactoriesByLevel,
    });

    this.runtime = createGridRuntime({
      schema: runtimeConfig.gridSchema,
      dataSource,
      interaction: definition.interaction,
      phantomRows: definition.phantomRows,
      onPageBoundaryNavigation: ({ navigation, source, state }) =>
        this.handlePageBoundaryNavigation(navigation, source, state),
      on: {
        cellReconciled: ({ event }) => {
          if (event.kind === "rejected") {
            this.queryStoresByLevel
              .get(event.rowKey ? this.rootLevel : this.rootLevel)
              ?.getState()
              .setErrorBanner(
                `Failed to save ${String(event.colId)}: ${event.reason}`,
              );
          }
        },
        phantomRowCreateFailed: ({ path, reason }) => {
          this.errorStoreForPath(path)
            ?.getState()
            .setErrorBanner(`Failed to create row: ${reason}`);
        },
      },
    });

    this.rootGridPath = rootPath(runtimeConfig.gridSchema.rootLevel);
    this.rootSource = this.runtime.sourceFor(this.rootGridPath);
    this.levelInfoById = runtimeConfig.levelInfoById as Record<
      TGridLevelId<RowsByLevel>,
      TGridLevelInfo
    >;
    this.levels = this.createRuntimeLevels(definition.levels);
    this.queryStore = this.getQueryStore(definition.rootLevel) as StoreApi<
      TGridLevelQueryState<RowsByLevel[TGridLevelId<RowsByLevel>]>
    >;
  }

  get appServices(): AppServices {
    return this.liveInputsRef.current.services as AppServices;
  }

  getVisibleRows<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId = this.rootLevel as LevelId,
    path: GridPath = this.rootGridPath,
  ): readonly Readonly<RowsByLevel[LevelId]>[] {
    void levelId;
    return this.runtime
      .displayedRowsFor(path)
      .rows.filter((row) => row.kind === "data")
      .map((row) => row.columns as RowsByLevel[LevelId]);
  }

  getLoadedRow<LevelId extends TGridLevelId<RowsByLevel>>(
    rowKey: string,
    levelId: LevelId = this.rootLevel as LevelId,
    path: GridPath = this.rootGridPath,
  ): Readonly<RowsByLevel[LevelId]> | undefined {
    void levelId;
    const row = this.runtime.displayedRowFor(
      path,
      makeRowId(path, rowKey as RowKey),
    );
    if (!row || row.kind !== "data") return undefined;
    return row.columns as RowsByLevel[LevelId];
  }

  getQueryState<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId = this.rootLevel as LevelId,
  ): TGridLevelQueryState<RowsByLevel[LevelId]> {
    return this.getQueryStore(levelId).getState() as TGridLevelQueryState<
      RowsByLevel[LevelId]
    >;
  }

  reloadRows(
    levelId: TGridLevelId<RowsByLevel> = this.rootLevel,
    path?: GridPath,
  ): Promise<SourceLoadResult> {
    const targetPath = this.requireLoadPath(levelId, path, "reloadRows");
    return this.runtime.sourceFor(targetPath).refetch();
  }

  async setLevelSort(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    sort: SortDescriptor[],
  ): Promise<SourceLoadResult> {
    const result = await this.runtime.sourceFor(path).setSort(sort);
    this.pushUrlAfterReady(levelId, result);
    return result;
  }

  async setLevelFilter(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    filter: TGridFilter | undefined,
  ): Promise<SourceLoadResult> {
    const result = await this.runtime.sourceFor(path).setFilter(filter);
    this.pushUrlAfterReady(levelId, result);
    return result;
  }

  async setLevelPage(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    page: number,
    pageSize: number,
  ): Promise<SourceLoadResult> {
    const result = await this.runtime.sourceFor(path).setPage(page, pageSize);
    this.pushUrlAfterReady(levelId, result);
    return result;
  }

  setErrorBanner(message: string | null): void {
    this.queryStore.getState().setErrorBanner(message);
  }

  csvExportUrl(levelId: TGridLevelId<RowsByLevel> = this.rootLevel): string {
    const runtimeLevel = this.levels[levelId];
    return runtimeLevel.csvExportUrl();
  }

  dispose(): void {
    this.runtime.dispose();
    this.lookupRegistry.dispose();
  }

  private createRuntimeLevels(
    configs: TGridLevelsConfigMap<RowsByLevel, AppServices>,
  ): TGridSessionContext<RowsByLevel, AppServices>["levels"] {
    const entries = Object.entries(configs).map(([levelId, config]) => {
      const typedLevelId = levelId as TGridLevelId<RowsByLevel>;
      const runtimeLevel: TGridRuntimeLevel<
        RowsByLevel,
        AppServices,
        TGridLevelId<RowsByLevel>
      > = {
        levelId: typedLevelId,
        table: config.table,
        config,
        queryStore: this.queryStoresByLevel.get(typedLevelId),
        csvExportUrl: () => this.csvExportUrlFor(typedLevelId),
      };
      return [levelId, runtimeLevel];
    });
    return Object.fromEntries(entries) as TGridSessionContext<
      RowsByLevel,
      AppServices
    >["levels"];
  }

  private csvExportUrlFor(levelId: TGridLevelId<RowsByLevel>): string {
    const level = this.levels[levelId];
    const state = this.queryStoresByLevel.get(levelId)?.getState();
    const query = level.config.query ?? {};
    const hasQueryState = state !== undefined;
    const sort = hasQueryState ? state.sort : (query.initialSort ?? []);
    const filters = [
      ...(query.fixedFilters ?? []),
      ...(hasQueryState ? state.filters : (query.initialFilters ?? [])),
    ];
    const search = hasQueryState ? state.search : (query.initialSearch ?? null);
    const queryString = new URLSearchParams(
      buildTableRowsQuery({
        sort: [...sort],
        filters: [...filters],
        search: search ?? undefined,
      }),
    ).toString();
    return `${getApiBase()}/tables/${level.table.name}/export.csv${queryString ? `?${queryString}` : ""}`;
  }

  private hostRowQueryState(
    levelId: TGridLevelId<RowsByLevel>,
  ): RowQueryState<TGridFilter> | undefined {
    const store = this.queryStoresByLevel.get(levelId);
    if (!store) return undefined;
    return {
      // The REST source samples this value immediately before building a
      // request. The query store remains the application-visible state for URL
      // sync, exports, search controls, and filters.
      current: () => {
        const state = store.getState();
        return {
          page: state.page,
          pageSize: state.pageSize,
          sort: [...state.sort],
          filter: {
            conditions: [...state.filters],
            search: state.search,
          },
        };
      },
      // These setters are source-facing and passive. They update table query
      // state only. The source command that called them owns the row load, and
      // the session command owns any route sync that follows a ready result.
      setSort: (sort) => store.getState().setSortState(sort ?? []),
      setFilter: (filter) => store.getState().setFilterState(filter),
      setPage: (page, pageSize) =>
        store.getState().setPageState(page, pageSize),
    };
  }

  private pushUrlAfterReady(
    levelId: TGridLevelId<RowsByLevel>,
    result: SourceLoadResult,
  ): void {
    // URL state follows committed table state. A refreshing, errored,
    // superseded, disposed, or unchanged command leaves the route untouched so
    // browser history does not advertise rows that never became ready.
    if (result.kind === "ready") this.pushUrl(levelId);
  }

  private handlePageBoundaryNavigation(
    navigation: PageBoundaryNavigationRequest,
    source: RuntimeLevelDataSource,
    state: Extract<LevelSourceState, { status: "ready" }>,
  ): Promise<SourceLoadResult> | false {
    const pagination = state.snapshot.pagination;
    if (!pagination) return false;
    if (!Number.isFinite(pagination.pageSize)) return false;
    // TGrid table pages use 1-based page numbers because table routes and
    // export URLs expose page numbers to application users. The base grid never
    // assumes that convention. This hook translates keyboard edge navigation
    // into the same source command used by visible page controls.
    const nextPage =
      navigation.direction === "next"
        ? pagination.page + 1
        : pagination.page - 1;
    // Returning false is an authoritative "no page turn" for the runtime hook.
    // TGrid owns this boundary because its page numbers are route-visible and
    // 1-based; the generic grid fallback cannot safely reinterpret page 1 as a
    // source coordinate and request page 0.
    if (nextPage < 1) return false;
    if (
      navigation.direction === "next" &&
      pagination.totalCount !== undefined &&
      pagination.page * pagination.pageSize >= pagination.totalCount
    ) {
      return false;
    }
    if (
      navigation.direction === "next" &&
      pagination.totalCount === undefined &&
      state.snapshot.nodes.length < pagination.pageSize
    ) {
      return false;
    }
    const levelId = this.runtime.schemaAt(navigation.path)
      .name as TGridLevelId<RowsByLevel>;
    // The runtime keeps the pending cursor landing while this promise is
    // pending. The session pushes the URL after ready; the runtime then samples
    // displayed rows and lands focus on the first or last row for the requested
    // edge.
    return source.setPage(nextPage, pagination.pageSize).then((result) => {
      this.pushUrlAfterReady(levelId, result);
      return result;
    });
  }

  private requireLoadPath(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath | undefined,
    caller: string,
  ): GridPath {
    if (path) return path;
    if (levelId === this.rootLevel) return this.rootGridPath;
    // Query stores are keyed by level id. Runtime sources are keyed by
    // GridPath. A non-root level can be expanded many times under different
    // parent rows, so any row-loading command for that level must name the
    // concrete path it intends to reload.
    throw new Error(
      `TGridSession.${caller}: loading level '${String(levelId)}' requires a GridPath`,
    );
  }

  private createQueryStore<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
    level: TGridLevelConfig<RowsByLevel, AppServices, LevelId>,
  ): StoreApi<TGridLevelQueryState<TGridTableRow>> {
    const initial = initialQueryState(
      level.query,
      this.routeQuerySeed(levelId),
    );

    return createStore<TGridLevelQueryState<TGridTableRow>>()((set, get) => ({
      level: levelId,
      sort: [...initial.sort],
      filters: normalizeFilters([...initial.filters]),
      search: initial.search,
      page: initial.page,
      pageSize: initial.pageSize,
      errorBanner: null,

      // Passive state setters are the only setters called from REST
      // RowQueryState. They have no side effects beyond updating query values.
      // UI commands below call the exact source path, await the source load, and
      // then sync the URL when the source reaches ready.
      setSortState: (sort) => {
        if (sortOrderEqual(get().sort, sort)) return "unchanged";
        set({ sort, page: 1 });
        return "changed";
      },
      setFilterState: (filter) => {
        const nextFilters = normalizeFilters(filter?.conditions ?? []);
        const nextSearch =
          filter?.search && filter.search.trim() !== "" ? filter.search : null;
        const cur = get();
        if (
          filtersEqual(cur.filters, nextFilters) &&
          cur.search === nextSearch
        ) {
          return "unchanged";
        }
        set({ filters: nextFilters, search: nextSearch, page: 1 });
        return "changed";
      },
      setPageState: (page, pageSize) => {
        const cur = get();
        if (cur.page === page && cur.pageSize === pageSize) {
          return "unchanged";
        }
        set({ page, pageSize });
        return "changed";
      },

      setSort: (sort) => {
        void this.setLevelSort(
          levelId,
          this.requireLoadPath(levelId, undefined, "setSort"),
          sort,
        );
      },
      clearSort: () => {
        if (get().sort.length === 0) return;
        void this.setLevelSort(
          levelId,
          this.requireLoadPath(levelId, undefined, "clearSort"),
          [],
        );
      },
      addFilter: (cond) => {
        const next = [
          ...get().filters,
          { ...cond, id: mintFilterId(cond.column, cond.op) },
        ];
        void this.setLevelFilter(
          levelId,
          this.requireLoadPath(levelId, undefined, "addFilter"),
          {
            conditions: next,
            search: get().search,
          },
        );
      },
      updateFilter: (id, patch) => {
        const idx = get().filters.findIndex((f) => f.id === id);
        if (idx < 0) return;
        const next = [...get().filters];
        next[idx] = { ...patch, id } as FilterCondition;
        void this.setLevelFilter(
          levelId,
          this.requireLoadPath(levelId, undefined, "updateFilter"),
          {
            conditions: next,
            search: get().search,
          },
        );
      },
      removeFilter: (id) => {
        const next = get().filters.filter((f) => f.id !== id);
        if (next.length === get().filters.length) return;
        void this.setLevelFilter(
          levelId,
          this.requireLoadPath(levelId, undefined, "removeFilter"),
          {
            conditions: next,
            search: get().search,
          },
        );
      },
      clearFilters: () => {
        if (get().filters.length === 0) return;
        void this.setLevelFilter(
          levelId,
          this.requireLoadPath(levelId, undefined, "clearFilters"),
          {
            conditions: [],
            search: get().search,
          },
        );
      },
      setSearch: (q) => {
        const normalized = q && q.trim() !== "" ? q : null;
        if (get().search === normalized) return;
        void this.setLevelFilter(
          levelId,
          this.requireLoadPath(levelId, undefined, "setSearch"),
          {
            conditions: get().filters,
            search: normalized,
          },
        );
      },
      setFilter: (filter) => {
        void this.setLevelFilter(
          levelId,
          this.requireLoadPath(levelId, undefined, "setFilter"),
          filter,
        );
      },
      setPage: (page) => {
        if (get().page === page) return;
        void this.setLevelPage(
          levelId,
          this.requireLoadPath(levelId, undefined, "setPage"),
          page,
          get().pageSize,
        );
      },

      setErrorBanner: (msg) => set({ errorBanner: msg }),

      syncFromUrl: (seed) => {
        // Browser back/forward restores the table from the URL without pushing a
        // new history entry. Direct table-control changes update the URL instead.
        const next = initialQueryState(level.query, seed);
        const cur = get();
        const patch: Partial<TGridLevelQueryState<TGridTableRow>> = {};
        if (cur.page !== next.page) patch.page = next.page;
        if (cur.search !== next.search) patch.search = next.search;
        if (!filtersEqual(cur.filters, next.filters)) {
          patch.filters = next.filters;
        }
        if (!sortOrderEqual(cur.sort, next.sort)) {
          patch.sort = next.sort;
        }
        if (Object.keys(patch).length === 0) return;
        set(patch);
        void this.reloadRows(levelId);
      },
    }));
  }

  private pushUrl(levelId: TGridLevelId<RowsByLevel>): void {
    const runtimeLevel = this.levels[levelId];
    const syncEnabled =
      runtimeLevel.config.query?.urlSync ?? levelId === this.rootLevel;
    const onQueryUrlChange = this.liveInputsRef.current.onQueryUrlChange;
    if (!syncEnabled || !onQueryUrlChange) return;
    const s = this.getQueryStore(levelId).getState();
    onQueryUrlChange({
      level: levelId,
      page: s.page,
      sort: s.sort,
      filters: s.filters,
      search: s.search,
    });
  }

  private routeQuerySeed(
    levelId: TGridLevelId<RowsByLevel>,
  ): TGridRouteQuerySeed | undefined {
    return this.liveInputsRef.current.routeQuerySeeds?.[levelId];
  }

  private getQueryStore<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
  ): StoreApi<TGridLevelQueryState<TGridTableRow>> {
    const store = this.queryStoresByLevel.get(levelId);
    if (!store) {
      throw new Error(
        `TGridSession: level '${levelId}' does not have host-owned query state`,
      );
    }
    return store;
  }

  private errorStoreForPath(
    path: GridPath,
  ): StoreApi<TGridLevelQueryState<TGridTableRow>> | undefined {
    const levelId = this.runtime.schemaAt(path)
      .name as TGridLevelId<RowsByLevel>;
    return (
      this.queryStoresByLevel.get(levelId) ??
      this.queryStoresByLevel.get(this.rootLevel)
    );
  }

  private readonly currentSessionContext = (): TGridSessionContext<
    RowsByLevel,
    AppServices
  > => this;
}

function initialQueryState(
  query: TGridLevelConfig<TGridRowsByLevel>["query"] | undefined,
  seed: TGridRouteQuerySeed | undefined,
): Pick<
  TGridLevelQueryState<TGridTableRow>,
  "sort" | "filters" | "search" | "page" | "pageSize"
> {
  // A missing route value means "use the table default"; an explicit empty
  // value means the user or URL intentionally cleared that default.
  return {
    sort: [...(seed?.sort ?? query?.initialSort ?? [])],
    filters: normalizeFilters([
      ...(seed?.filters ?? query?.initialFilters ?? []),
    ]),
    search: normalizeSearch(
      seed && "search" in seed ? (seed.search ?? null) : query?.initialSearch,
    ),
    page: seed?.page ?? query?.initialPage ?? 1,
    pageSize: defaultPageSize(query?.pageSize),
  };
}

function defaultPageSize(
  pageSize: number | (() => number) | undefined,
  fallback = 50,
): number {
  if (typeof pageSize === "function") return pageSize();
  return pageSize ?? fallback;
}

function normalizeSearch(search: string | null | undefined): string | null {
  return search && search.trim() !== "" ? search : null;
}
