import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createGridRuntime,
  makeRowId,
  restGridDataSource,
  rootPath,
  type GridPath,
  type GridRuntime,
  type LoadedRowsBoundaryEvent,
  type RuntimeLevelDataSource,
  type RowQueryState,
  type RowKey,
  type SortDescriptor,
  type SourceLoadResult,
} from "@sapporta/grid";
import {
  filtersEqual,
  parseFiltersForTable,
  type TypedFilterCondition,
} from "@sapporta/shared/filter";
import type { TableSchema } from "@sapporta/shared/contracts";
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
import {
  createLookupStore,
  type LookupForColumn,
  type LookupStore,
} from "../../lookup";
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
    filters: TypedFilterCondition[];
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
  lookups: LookupStore;
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
  readonly lookups: LookupStore;
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
    this.lookups = createLookupStore();
    this.lookupForColumn = (column) => this.lookups.foreignKey(column);
    this.columnMapper = createTGridColumnMapper({ lookups: this.lookups });

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
      recordTotalCount: (levelId, totalCount) =>
        this.queryStoresByLevel
          .get(levelId)
          ?.getState()
          .setTotalCount(totalCount),
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
      onLoadedRowsBoundary: (event) => this.handleLoadedRowsBoundary(event),
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
    return this.refetchSource(targetPath);
  }

  async setLevelSort(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    sort: SortDescriptor[],
  ): Promise<SourceLoadResult> {
    const result =
      (await this.runtime.sourceFor(path).query?.sort?.set(sort)) ??
      this.unchangedSourceResult(path);
    this.pushUrlAfterReady(levelId, result);
    return result;
  }

  async setLevelFilter(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    filter: TGridFilter | undefined,
  ): Promise<SourceLoadResult> {
    const result =
      (await this.runtime.sourceFor(path).query?.filter?.set(filter)) ??
      this.unchangedSourceResult(path);
    this.pushUrlAfterReady(levelId, result);
    return result;
  }

  async setLevelPage(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    page: number,
    pageSize: number,
  ): Promise<SourceLoadResult> {
    const changed = this.getQueryStore(levelId)
      .getState()
      .setPageState(page, pageSize);
    const result =
      changed === "changed"
        ? await this.refetchSource(path)
        : this.unchangedSourceResult(path);
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
    this.lookups.clear();
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
      ...parseFiltersForTable(query.fixedFilters ?? [], level.table),
      ...(hasQueryState
        ? state.filters
        : parseFiltersForTable(query.initialFilters ?? [], level.table)),
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
      setSortState: (sort) => store.getState().setSortState([...(sort ?? [])]),
      setFilterState: (filter) => store.getState().setFilterState(filter),
      setPageState: (page, pageSize) =>
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

  private handleLoadedRowsBoundary(
    event: LoadedRowsBoundaryEvent,
  ): Promise<SourceLoadResult> | false {
    // The low-level grid reports only "loaded rows ended before/after this
    // path". TGrid translates that into its own table contract: one-based page
    // numbers, page-size policy, route state, and total-count checks. Returning
    // false tells the runtime to try an ancestor path or normal append-row
    // fallback.
    const levelId = this.runtime.schemaAt(event.loadPath)
      .name as TGridLevelId<RowsByLevel>;
    const store = this.queryStoresByLevel.get(levelId);
    if (!store) return false;
    const query = store.getState();
    if (!Number.isFinite(query.pageSize)) return false;

    const nextPage =
      event.direction === "after" ? query.page + 1 : query.page - 1;
    if (nextPage < 1) return false;

    const sourceState = this.runtime.sourceStateFor(event.loadPath);
    if (sourceState.status !== "ready") return false;
    if (
      event.direction === "after" &&
      query.totalCount !== null &&
      query.page * query.pageSize >= query.totalCount
    ) {
      return false;
    }
    if (
      event.direction === "after" &&
      query.totalCount === null &&
      sourceState.snapshot.nodes.length < query.pageSize
    ) {
      return false;
    }

    return this.setLevelPage(levelId, event.loadPath, nextPage, query.pageSize);
  }

  private refetchSource(path: GridPath): Promise<SourceLoadResult> {
    return (
      this.runtime.sourceFor(path).query?.refetch?.() ??
      Promise.resolve(this.unchangedSourceResult(path))
    );
  }

  private unchangedSourceResult(path: GridPath): SourceLoadResult {
    return {
      kind: "unchanged",
      state: this.runtime.sourceStateFor(path),
    };
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
      level.table,
    );

    return createStore<TGridLevelQueryState<TGridTableRow>>()((set, get) => ({
      level: levelId,
      sort: [...initial.sort],
      filters: [...initial.filters],
      search: initial.search,
      page: initial.page,
      pageSize: initial.pageSize,
      totalCount: null,
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
        const nextFilters = [...(filter?.conditions ?? [])];
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
      setTotalCount: (totalCount) => {
        if (get().totalCount === totalCount) return;
        set({ totalCount });
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
        const next = [...get().filters, cond];
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
        next[idx] = { ...patch, id };
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
        const next = initialQueryState(level.query, seed, level.table);
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
  table: TableSchema,
): Pick<
  TGridLevelQueryState<TGridTableRow>,
  "sort" | "filters" | "search" | "page" | "pageSize"
> {
  // A missing route value means "use the table default"; an explicit empty
  // value means the user or URL intentionally cleared that default.
  return {
    sort: [...(seed?.sort ?? query?.initialSort ?? [])],
    filters: [
      ...(seed?.filters ??
        parseFiltersForTable(query?.initialFilters ?? [], table)),
    ],
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
