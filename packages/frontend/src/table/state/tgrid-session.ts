import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createGridRuntime,
  makeRowId,
  restGridDataSource,
  rootPath,
  type GridPath,
  type GridRuntime,
  type RuntimeLevelDataSource,
  type RowKey,
  type SortDescriptor,
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
} from "@/table/grid-adapter/tgrid-runtime-config";
import type { TGridFilter } from "@/table/grid-adapter/tgrid-filter";
import type {
  TGridLevelConfig,
  TGridLevelInfo,
  TGridLevelsConfigMap,
} from "@/table/grid-adapter/tgrid-level-config";
import {
  createTGridColumnMapper,
  type TGridColumnMapper,
} from "@/table/grid-adapter/tgrid-column-mapper";
import type {
  TGridRuntimeLevel,
  TGridSessionContext,
} from "@/table/grid-adapter/tgrid-cell-context";
import { createTGridLookupResolver } from "@/table/grid-adapter/tgrid-lookup-resolver";
import {
  createTableLookupRegistry,
  type TableLookupRegistry,
} from "@/table/lookup/table-lookup-registry";
import { buildTableRowsQuery } from "@/table/api/rows";
import { getApiBase } from "@/platform/client";
import { buildTableSearchParams } from "@/table/grid-adapter/tgrid-table-url";
import type {
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "@/table/grid-adapter/tgrid-types";
import type { TGridLevelQueryState } from "./tgrid-level-query-state";

// Session constructor and runtime façade for typed TGrid behavior.
// This is the user-facing edge after level config has been declared.
// A TGrid session converts declarative config into live query state + runtime.
// A TGrid session is a typed bridge between level config and runtime behavior.
// It owns one level graph, one runtime, host query stores, and row/CSV helpers.
// IMPORTANT: getVisibleRows/getLoadedRow are memory snapshots, not DB-wide queries.

// Input shape required to create one concrete TGrid session.
// Supplies root, level graph, optional app services, and optional URL sync callback.
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
  hostQuerySeeds?: Partial<
    Record<TGridLevelId<RowsByLevel>, TGridHostQuerySeeds>
  >;
};

export type TGridHostQuerySeeds = {
  page?: number;
  sort?: readonly SortDescriptor[];
  filters?: readonly FilterCondition[];
  search?: string | null;
};

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

// Public session contract returned to app code.
// Gives immediate access to runtime, query stores, row helpers, and CSV/export URLs.
export type TGridSession<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = TGridSessionContext<RowsByLevel, AppServices> & {
  rootTableName: string;
  queryStore: StoreApi<TGridLevelQueryState<RowsByLevel[TGridLevelId<RowsByLevel>]>>;
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
  // The session registry narrows full sessions to this one method when
  // app-level actions only need to refetch a mounted table page.
  reloadRows(levelId?: TGridLevelId<RowsByLevel>, path?: GridPath): void;
  csvExportUrl(levelId?: TGridLevelId<RowsByLevel>): string;
  tablePageUrl(page: number, levelId?: TGridLevelId<RowsByLevel>): string;
  dispose(): void;
};

// Primary user entry point for session creation.
// Call this from views/feature code when you already have fully declared level config.
export function createTGridSession<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
>(
  definition: TGridDefinition<RowsByLevel, AppServices>,
  args: CreateTGridSessionArgs<RowsByLevel, AppServices> = {},
): TGridSession<RowsByLevel, AppServices> {
  return createTGridSessionWithRef(definition, { current: args });
}

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

  readonly queryStore: StoreApi<TGridLevelQueryState<RowsByLevel[TGridLevelId<RowsByLevel>]>>;
  readonly runtime: GridRuntime;
  readonly rootSource: RuntimeLevelDataSource;
  readonly lookupRegistry: TableLookupRegistry;
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

    const lookupResolver = createTGridLookupResolver(this.lookupRegistry);
    this.columnMapper = createTGridColumnMapper(lookupResolver);

    // Only levels that own host query state get local stores.
    // This is usually root + explicitly host-owned descendants.
    for (const [levelId, level] of Object.entries(definition.levels) as Array<
      [TGridLevelId<RowsByLevel>, TGridLevelConfig<RowsByLevel, AppServices>]
    >) {
      if (((level.query?.owner ?? (levelId === definition.rootLevel ? "host" : "source")) === "host")) {
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
      hostQueryState: (levelId) => {
        const state = this.queryStoresByLevel.get(levelId)?.getState();
        if (!state) return undefined;
        return {
          page: state.page,
          pageSize: state.pageSize,
          sort: state.sort,
          filters: state.filters,
          search: state.search,
        };
      },
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
    // "Visible" refers to rows already materialized for this path, not
    // every row in the database.
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
    // Return only a loaded row by RowKey. If the row is not in the current
    // displayed-page cache, this returns undefined even if it exists in DB.
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
    _levelId: TGridLevelId<RowsByLevel> = this.rootLevel,
    path: GridPath = this.rootGridPath,
  ): void {
    this.runtime.sourceFor(path).refetch();
  }

  csvExportUrl(levelId: TGridLevelId<RowsByLevel> = this.rootLevel): string {
    const runtimeLevel = this.levels[levelId];
    return runtimeLevel.csvExportUrl();
  }

  tablePageUrl(
    page: number,
    levelId: TGridLevelId<RowsByLevel> = this.rootLevel,
  ): string {
    const level = this.levels[levelId];
    const s = this.getQueryStore(levelId).getState();
    const params = buildTableSearchParams({
      page,
      sort: s.sort,
      filters: s.filters,
      search: s.search,
    });
    const queryString = params.toString();
    return `/tables/${level.table.name}${queryString ? `?${queryString}` : ""}`;
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
    const store = this.queryStoresByLevel.get(levelId);
    const s = store?.getState();
    const queryString = new URLSearchParams(
      buildTableRowsQuery({
        sort: s?.sort ?? [],
        filters: s ? [...s.filters] : [],
        search: s?.search ?? undefined,
      }),
    ).toString();
    return `${getApiBase()}/tables/${level.table.name}/export.csv${queryString ? `?${queryString}` : ""}`;
  }

  private createQueryStore<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
    level: TGridLevelConfig<RowsByLevel, AppServices, LevelId>,
  ): StoreApi<TGridLevelQueryState<TGridTableRow>> {
    const query = level.query ?? {};
    const pageSize =
      typeof query.pageSize === "function"
        ? query.pageSize()
        : query.pageSize ?? 50;

    return createStore<TGridLevelQueryState<TGridTableRow>>()((set, get) => ({
      level: levelId,
      sort: [...(this.hostQuerySeed(levelId)?.sort ?? [])],
      filters: normalizeFilters([...(this.hostQuerySeed(levelId)?.filters ?? [])]),
      search: this.hostQuerySeed(levelId)?.search ?? null,
      page: this.hostQuerySeed(levelId)?.page ?? 1,
      pageSize,
      errorBanner: null,

      setSort: (sort) => {
        if (sortOrderEqual(get().sort, sort)) return;
        set({ sort, page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      clearSort: () => {
        if (get().sort.length === 0) return;
        set({ sort: [], page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      addFilter: (cond) => {
        const next = [
          ...get().filters,
          { ...cond, id: mintFilterId(cond.column, cond.op) },
        ];
        set({ filters: next, page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      updateFilter: (id, patch) => {
        const idx = get().filters.findIndex((f) => f.id === id);
        if (idx < 0) return;
        const next = [...get().filters];
        next[idx] = { ...patch, id } as FilterCondition;
        set({ filters: next, page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      removeFilter: (id) => {
        const next = get().filters.filter((f) => f.id !== id);
        if (next.length === get().filters.length) return;
        set({ filters: next, page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      clearFilters: () => {
        if (get().filters.length === 0) return;
        set({ filters: [], page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      setSearch: (q) => {
        const normalized = q && q.trim() !== "" ? q : null;
        if (get().search === normalized) return;
        set({ search: normalized, page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      setFilter: (filter) => {
        const nextFilters = normalizeFilters(filter?.conditions ?? []);
        const nextSearch =
          filter?.search && filter.search.trim() !== "" ? filter.search : null;
        const cur = get();
        if (
          filtersEqual(cur.filters, nextFilters) &&
          cur.search === nextSearch
        ) {
          return;
        }
        set({ filters: nextFilters, search: nextSearch, page: 1 });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },
      setPage: (page) => {
        if (get().page === page) return;
        set({ page });
        this.reloadRows(levelId);
        this.pushUrl(levelId);
      },

      setErrorBanner: (msg) => set({ errorBanner: msg }),

      syncFromUrl: (params) => {
        const cur = get();
        const patch: Partial<TGridLevelQueryState<TGridTableRow>> = {};
        if (cur.page !== params.page) patch.page = params.page;
        if (cur.search !== params.search) patch.search = params.search;
        if (!filtersEqual(cur.filters, params.filters)) {
          patch.filters = params.filters;
        }
        if (
          params.sort !== undefined &&
          !sortOrderEqual(cur.sort, params.sort)
        ) {
          patch.sort = params.sort;
        }
        if (Object.keys(patch).length === 0) return;
        set(patch);
        this.reloadRows(levelId);
      },
    }));
  }

  private pushUrl(levelId: TGridLevelId<RowsByLevel>): void {
    const runtimeLevel = this.levels[levelId];
    const syncEnabled = runtimeLevel.config.query?.urlSync ?? levelId === this.rootLevel;
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

  private hostQuerySeed(
    levelId: TGridLevelId<RowsByLevel>,
  ): TGridHostQuerySeeds | undefined {
    return this.liveInputsRef.current.hostQuerySeeds?.[levelId];
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

  private readonly currentSessionContext = (): TGridSessionContext<
    RowsByLevel,
    AppServices
  > => this;
}
