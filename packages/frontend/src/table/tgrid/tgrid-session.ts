import { createStore, type StoreApi } from "zustand/vanilla";
import {
  createGridRuntime,
  makeRowId,
  restGridDataSource,
  type GridActiveRow,
  type GridPath,
  type GridRuntime,
  type LoadedRowsBoundaryEvent,
  type RuntimeLevelDataSource,
  type RowQueryState,
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
  primaryKeyOf,
  tableTreeNode,
  type TGridDefinition,
} from "./tgrid-runtime-config";
import type { TGridFilter } from "./tgrid-filter";
import type {
  TGridLevelConfig,
  TGridLevelInfo,
  TGridLevelPagination,
  TGridLevelsConfigMap,
} from "./tgrid-level-config";
import { tgridPageWindow } from "./tgrid-page-window";
import {
  createTGridColumnMapper,
  type TGridColumnMapper,
} from "./tgrid-column-mapper";
import type {
  TGridRuntimeLevel,
  TGridSessionContext,
} from "./tgrid-cell-context";
import {
  projectTGridActiveRow,
  type TGridRowActivatedEvent,
  type TGridActiveRow,
} from "./tgrid-active-row";
import {
  checkRowDisplays,
  connectRowDataStore,
  createLookupStore,
  type LookupForColumn,
  type RowDataStore,
  type RowDisplays,
} from "../../lookup";
import { buildTableRowsQuery, buildTableSelectionQuery } from "../api/rows";
import { queryParamRecordToSearchParams } from "@sapporta/shared";
import { getApiBase } from "../../platform/client";
import type {
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "./tgrid-types";
import type {
  TGridRouteQuerySeed,
  TGridLevelQueryState,
} from "./tgrid-level-query-state";
export type { TGridRouteQuerySeed } from "./tgrid-level-query-state";

export type TGridLoadedRowsBoundaryHandler<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = (
  event: LoadedRowsBoundaryEvent,
  levelId: TGridLevelId<RowsByLevel>,
  session: TGridSession<RowsByLevel, AppServices>,
) => Promise<SourceLoadResult> | false;

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
  /** Handle loaded-row edges in the composition that owns the surrounding UI. */
  onLoadedRowsBoundary?: TGridLoadedRowsBoundaryHandler<
    RowsByLevel,
    AppServices
  >;
  /**
   * Display slots the session draws rows with: labels, references and
   * cells. React pages pass the displays of the nearest
   * `RowDisplayProvider`; code outside React passes them here. Read once,
   * when the session is created.
   */
  rowDisplays?: RowDisplays;
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
  /** Reads the current row with TGrid level and application context. */
  activeRow(): TGridActiveRow<RowsByLevel> | null;
  /** Observes active-row identity and displayed-value changes. */
  subscribeActiveRow(listener: () => void): () => void;
  /** Observes configured row activation gestures. */
  onRowActivate(
    handler: (event: TGridRowActivatedEvent<RowsByLevel>) => void,
  ): () => void;
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
  /**
   * Shows one root row: puts the cursor on it, opens the tree branches above
   * it and scrolls it into view. Use it after creating a row, so the user
   * sees where it landed. On a flat table, pass the row as the table API
   * saved it as `savedRow`: when the loaded rows don't include it, it joins
   * them at the top, and the other rows keep their places. It stays there
   * until the rows are read again, such as on reload or a change of page,
   * sort, search or filter. Otherwise the rows are read again when the
   * table doesn't have the row yet. With `clearQueryIfHidden`, a search or
   * filter that leaves the row out is then cleared, and the URL follows;
   * when clearing does not bring the row, the search and filters are put
   * back. Resolves to `"not-found"` when the row is still not on screen,
   * such as a row on another page of a paged table.
   */
  showRow(
    rowKey: string,
    options?: TGridShowRowOptions,
  ): Promise<TGridShowRowResult>;
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
  /** The session's row store: labels and computed values of the rows it
   *  shows, and the display slots that draw them. */
  lookups: RowDataStore;
  lookupForColumn: LookupForColumn;
  csvExportUrl(levelId?: TGridLevelId<RowsByLevel>): string;
  dispose(): void;
};

export type TGridShowRowOptions = {
  /** The row as the table API saved it. A flat table that has not loaded
   *  the row shows it at the top of its loaded rows. */
  savedRow?: Readonly<Record<string, unknown>>;
  /** Clear the search and filters when they leave the row out. */
  clearQueryIfHidden?: boolean;
};

export type TGridShowRowResult = "shown" | "not-found";

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
  private readonly rootRowKeyColumn: string;
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
  readonly lookups: RowDataStore;
  private readonly disconnectLookups: () => void;
  readonly lookupForColumn: LookupForColumn;
  readonly columnMapper: TGridColumnMapper;
  readonly levelInfoById: Record<TGridLevelId<RowsByLevel>, TGridLevelInfo>;
  readonly levels: TGridSessionContext<RowsByLevel, AppServices>["levels"];
  private disposed = false;
  // Ends each `rootRowsSettled` wait when the session is disposed.
  private readonly settleWaiters = new Set<() => void>();
  private activeGridRowSnapshot: GridActiveRow | null = null;
  private activeTGridRowSnapshot: TGridActiveRow<RowsByLevel> | null = null;

  constructor(
    definition: TGridDefinition<RowsByLevel, AppServices>,
    liveInputsRef: TGridLiveInputsRef<RowsByLevel, AppServices>,
  ) {
    this.liveInputsRef = liveInputsRef;
    this.rootLevel = definition.rootLevel;
    this.rootTableName = definition.levels[definition.rootLevel].table.name;
    this.rootRowKeyColumn = primaryKeyOf(
      definition.levels[definition.rootLevel].table,
      definition.rootLevel,
    ).name;
    const rowDisplays = liveInputsRef.current.rowDisplays ?? {};
    this.lookups = createLookupStore({ rowDisplays });
    this.disconnectLookups = connectRowDataStore(this.lookups);
    // A slot naming a table, column or computed field that does not exist
    // would never draw; fail here, where the schemas are known.
    checkRowDisplays(
      rowDisplays,
      Object.keys(rowDisplays).flatMap((name) => {
        const schema =
          Object.values(definition.levels).find(
            (level) => level.table.name === name,
          )?.table ?? this.lookups.tableSchema(name);
        return schema ? [schema] : [];
      }),
    );
    this.lookupForColumn = (column) => this.lookups.foreignKey(column);
    this.columnMapper = createTGridColumnMapper({
      lookups: this.lookups,
      rowData: this.lookups,
    });

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
      recordTreeResult: (levelId, result) =>
        this.queryStoresByLevel.get(levelId)?.getState().setTreeResult(result),
      sessionContext: this.currentSessionContext,
      rowData: this.lookups,
    });

    // Levels with visible table controls need query stores so filters, search,
    // paging, export links, and row fetches all use the same state. The stores
    // exist before the runtime, whose sources read them. Each store holds its
    // level to the page window the compiled level reads.
    for (const [levelId, level] of Object.entries(definition.levels) as Array<
      [TGridLevelId<RowsByLevel>, TGridLevelConfig<RowsByLevel, AppServices>]
    >) {
      if (
        (level.query?.owner ??
          (levelId === definition.rootLevel ? "host" : "source")) === "host"
      ) {
        this.queryStoresByLevel.set(
          levelId,
          this.createQueryStore(
            levelId,
            level,
            runtimeConfig.levelInfoById[levelId].pagination,
          ),
        );
      }
    }

    const dataSource = restGridDataSource<TGridFilter>({
      schema: runtimeConfig.gridSchema,
      endpoints: runtimeConfig.endpointFactoriesByLevel,
    });

    this.runtime = createGridRuntime({
      schema: runtimeConfig.gridSchema,
      dataSource,
      interaction: definition.interaction,
      phantomRows: definition.phantomRows,
      // The runtime keeps one stable callback. The session adapter delegates
      // each event to the current host policy supplied through live inputs.
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

    this.rootGridPath = this.runtime.root.path;
    this.rootSource = this.runtime.root.data;
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
      .level(path)
      .displayedRows()
      .rows.filter((row) => row.kind === "data")
      .map((row) => row.columns as RowsByLevel[LevelId]);
  }

  getLoadedRow<LevelId extends TGridLevelId<RowsByLevel>>(
    rowKey: string,
    levelId: LevelId = this.rootLevel as LevelId,
    path: GridPath = this.rootGridPath,
  ): Readonly<RowsByLevel[LevelId]> | undefined {
    void levelId;
    const level = this.runtime.level(path);
    const row = level.displayedRow(makeRowId(level.path, rowKey));
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

  async showRow(
    rowKey: string,
    options: TGridShowRowOptions = {},
  ): Promise<TGridShowRowResult> {
    const treeColumn = this.levelInfoById[this.rootLevel].tree?.column;
    const focus = () =>
      !this.disposed &&
      this.runtime.root.focusRow(
        rowKey,
        treeColumn ? { colId: treeColumn } : undefined,
      );

    // A read already under way, such as one the URL started, may bring the
    // row; wait for it rather than asking for the same rows twice.
    const settled = await this.rootRowsSettled();
    if (this.disposed) return "not-found";
    if (settled && focus()) return "shown";
    // A flat table keeps the rows the user is looking at, such as the page
    // they are on: the saved row joins them at the top rather than the table
    // reading its rows again to place it by sort.
    if (settled && options.savedRow && this.addSavedRootRow(options.savedRow)) {
      return focus() ? "shown" : "not-found";
    }
    if (!(await this.rootRowsAfter(this.reloadRows()))) return "not-found";
    if (focus()) return "shown";

    const query = this.queryStore.getState();
    if (
      !options.clearQueryIfHidden ||
      (query.filters.length === 0 && query.search === null)
    ) {
      return "not-found";
    }
    // Through the session's own filter command, so the URL is written the
    // way every search and filter change writes it.
    const cleared = this.setLevelFilter(
      this.rootLevel,
      this.rootGridPath,
      undefined,
    );
    if ((await this.rootRowsAfter(cleared)) && focus()) return "shown";
    // The query was not what hid the row, such as a row on another page of a
    // paged table, so the user's search and filters come back.
    if (!this.disposed) {
      await this.setLevelFilter(this.rootLevel, this.rootGridPath, {
        conditions: query.filters,
        search: query.search,
      });
    }
    return "not-found";
  }

  async setLevelSort(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    sort: SortDescriptor[],
  ): Promise<SourceLoadResult> {
    const level = this.runtime.level(path);
    const result =
      (await level.data.query?.sort?.set(sort)) ??
      this.unchangedSourceResult(path);
    this.pushUrlAfterReady(levelId, result);
    return result;
  }

  async setLevelFilter(
    levelId: TGridLevelId<RowsByLevel>,
    path: GridPath,
    filter: TGridFilter | undefined,
  ): Promise<SourceLoadResult> {
    const level = this.runtime.level(path);
    const result =
      (await level.data.query?.filter?.set(filter)) ??
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
    this.disposed = true;
    for (const stopWaiting of this.settleWaiters) stopWaiting();
    this.runtime.dispose();
    this.disconnectLookups();
    this.lookups.clear();
  }

  // Adds a saved row to the top of a flat root level's loaded rows. False on a
  // tree level, whose rows go under their parents, and when the row is already
  // loaded but could not take the cursor.
  private addSavedRootRow(row: Readonly<Record<string, unknown>>): boolean {
    if (this.levelInfoById[this.rootLevel].tree) return false;
    const node = tableTreeNode(row, this.rootLevel, this.rootRowKeyColumn);
    const loaded = this.rootSource
      .state()
      .snapshot.nodes.some((one) => one.rowKey === node.rowKey);
    if (loaded) return false;
    return this.runtime.root.addSavedRow(node, 0);
  }

  // True once the root rows are ready, false when they failed to load or the
  // session was disposed while waiting.
  private rootRowsSettled(): Promise<boolean> {
    return new Promise((resolve) => {
      const settled = (): boolean => {
        if (this.disposed) {
          resolve(false);
          return true;
        }
        const { status } = this.rootSource.state();
        if (status === "initialLoading" || status === "refreshing") {
          return false;
        }
        resolve(status === "ready");
        return true;
      };
      if (settled()) return;
      const stop = () => {
        unsubscribe();
        this.settleWaiters.delete(stop);
        resolve(false);
      };
      const unsubscribe = this.rootSource.subscribe(() => {
        if (settled()) stop();
      });
      this.settleWaiters.add(stop);
    });
  }

  // Whether a root load left rows to look at. A load that a newer one replaced
  // waits for that one.
  private async rootRowsAfter(
    load: Promise<SourceLoadResult>,
  ): Promise<boolean> {
    const result = await load;
    if (result.kind === "superseded") return this.rootRowsSettled();
    return result.kind === "ready" || result.kind === "unchanged";
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
    const queryString = queryParamRecordToSearchParams(
      buildTableSelectionQuery({
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
    const handler = this.liveInputsRef.current.onLoadedRowsBoundary;
    if (!handler) return false;

    const level = this.runtime.level(event.loadPath);
    const levelId = level.schema.name as TGridLevelId<RowsByLevel>;
    return handler(event, levelId, this);
  }

  private refetchSource(path: GridPath): Promise<SourceLoadResult> {
    const level = this.runtime.level(path);
    return (
      level.data.query?.refetch?.() ??
      Promise.resolve(this.unchangedSourceResult(path))
    );
  }

  private unchangedSourceResult(path: GridPath): SourceLoadResult {
    return {
      kind: "unchanged",
      state: this.runtime.level(path).data.state(),
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
    pagination: TGridLevelPagination,
  ): StoreApi<TGridLevelQueryState<TGridTableRow>> {
    const initial = initialQueryState(
      level.query,
      this.routeQuerySeed(levelId),
      level.table,
      pagination,
    );

    return createStore<TGridLevelQueryState<TGridTableRow>>()((set, get) => ({
      level: levelId,
      sort: [...initial.sort],
      filters: [...initial.filters],
      search: initial.search,
      page: initial.page,
      pageSize: initial.pageSize,
      totalCount: null,
      treeResult: null,
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
      setPageState: (requestedPage, requestedPageSize) => {
        const { page, pageSize } = tgridPageWindow(pagination, {
          page: requestedPage,
          pageSize: requestedPageSize,
        });
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
      setTreeResult: (treeResult) => {
        const current = get().treeResult;
        if (
          current === treeResult ||
          (current !== null &&
            treeResult !== null &&
            current.matchCount === treeResult.matchCount &&
            current.loadedRowCount === treeResult.loadedRowCount &&
            current.truncated === treeResult.truncated)
        ) {
          return;
        }
        set({ treeResult });
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
        const next = initialQueryState(
          level.query,
          seed,
          level.table,
          pagination,
        );
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
    const levelId = this.runtime.level(path).schema
      .name as TGridLevelId<RowsByLevel>;
    return (
      this.queryStoresByLevel.get(levelId) ??
      this.queryStoresByLevel.get(this.rootLevel)
    );
  }

  activeRow(): TGridActiveRow<RowsByLevel> | null {
    const active = this.runtime.activeRow();
    if (!active) {
      this.activeGridRowSnapshot = null;
      this.activeTGridRowSnapshot = null;
      return null;
    }
    if (this.activeGridRowSnapshot === active && this.activeTGridRowSnapshot) {
      return this.activeTGridRowSnapshot;
    }
    this.activeGridRowSnapshot = active;
    this.activeTGridRowSnapshot = this.rowContext(active);
    return this.activeTGridRowSnapshot;
  }

  subscribeActiveRow(listener: () => void): () => void {
    return this.runtime.subscribeActiveRow(listener);
  }

  onRowActivate(
    handler: (event: TGridRowActivatedEvent<RowsByLevel>) => void,
  ): () => void {
    return this.runtime.on("rowActivated", ({ activeRow, trigger }) => {
      handler({ activeRow: this.rowContext(activeRow), trigger });
    });
  }

  private rowContext(active: GridActiveRow): TGridActiveRow<RowsByLevel> {
    const levelName = active.level.schema.name;
    if (!(levelName in this.levels)) {
      throw new Error(
        `TGridSession: active row belongs to unknown level '${levelName}'`,
      );
    }
    return projectTGridActiveRow<RowsByLevel>(
      active,
      this.runtime,
      levelName as TGridLevelId<RowsByLevel>,
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
  pagination: TGridLevelPagination,
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
    ...tgridPageWindow(pagination, {
      page: seed?.page ?? query?.initialPage ?? 1,
      pageSize: defaultPageSize(query?.pageSize),
    }),
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
