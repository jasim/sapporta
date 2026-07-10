import type {
  ChildSchema,
  ColumnSchema as TableColumnSchema,
  Row,
  TableSchema,
} from "@sapporta/shared/contracts";
import {
  eqCondition,
  parseFilterForTable,
  parseFiltersForTable,
  type TypedFilterCondition,
} from "@sapporta/shared/filter";
import {
  childPath,
  hostBackedRowQuery,
  rootPath,
  sourceOwnedRowQuery,
  type GridInteractionConfig,
  type PhantomRowsConfig,
} from "@sapporta/grid";
import type {
  BuildRowsRequest,
  ColId,
  GridPath,
  GridSchema,
  LevelSchema,
  PatchCellResponse,
  RestEndpointFactory,
  RowQueryState,
  RowKey,
  SortDescriptor,
  TreeNode,
} from "@sapporta/grid";
import { parseSortString, stringifySortOrder } from "@sapporta/grid";
import {
  fetchTableRows,
  createTableRow,
  updateTableRow,
  deleteTableRow,
  type FetchTableRowsParams,
} from "../api/rows";
import type { RowId } from "@sapporta/shared/row-id";
import type { TGridColumnMapper } from "./tgrid-column-mapper";
import { tableRowIdentity } from "./table-row-identity";
import type {
  TableColumnName,
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
  RowFieldName,
} from "./tgrid-types";
import {
  createTGridColumnsBuilder,
  type TGridColumnSpec,
  type TGridColumnSpecBuilder,
} from "./tgrid-column-spec";
import {
  buildTGridColumnsForTable,
  type TGridRuntimeCellWriteHandler,
  type TGridRuntimeCellWriteResult,
} from "./tgrid-column-builder";
import type { TGridSessionContext } from "./tgrid-cell-context";
import type { TGridFilter } from "./tgrid-filter";
import type {
  TGridLevelQueryConfig,
  TGridLevelInfo,
  TableRowsClient,
  TGridLevelConfig,
  TGridLevelsConfigMap,
} from "./tgrid-level-config";

export type TGridDefinition<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = {
  readonly rootLevel: TGridLevelId<RowsByLevel>;
  readonly interaction?: GridInteractionConfig;
  readonly phantomRows?: PhantomRowsConfig;
  readonly levels: TGridLevelsConfigMap<RowsByLevel, AppServices>;
};

// Declare the table experience a page wants to show: levels, columns, editors,
// renderers, query defaults, row transport, and interaction behavior.
export function defineTGrid<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
>(
  definition: TGridDefinition<RowsByLevel, AppServices>,
): TGridDefinition<RowsByLevel, AppServices> {
  validateTGridDefinition(
    definition.rootLevel,
    definition.levels,
    "defineTGrid",
  );
  return definition;
}

// Inputs needed to prepare a TGrid definition for a mounted table view.
type CompileTGridRuntimeConfigArgs<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
> = {
  rootLevel: TGridLevelId<RowsByLevel>;
  levels: TGridLevelsConfigMap<RowsByLevel, AppServices>;
  columnMapper: TGridColumnMapper;
  hostRowQueryState?: (
    levelId: TGridLevelId<RowsByLevel>,
  ) => RowQueryState<TGridFilter> | undefined;
  recordTotalCount?: (
    levelId: TGridLevelId<RowsByLevel>,
    totalCount: number | null,
  ) => void;
  sessionContext?: () => TGridSessionContext<RowsByLevel, AppServices>;
};

// Prepared table view data: row loading, cell editing, and level metadata.
export type CompiledTGridRuntimeConfig<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
> = {
  gridSchema: GridSchema;
  endpointFactoriesByLevel: Record<
    TGridLevelId<RowsByLevel>,
    RestEndpointFactory<TGridFilter>
  >;
  levelInfoById: Record<TGridLevelId<RowsByLevel>, TGridLevelInfo>;
};

// Prepare a TGrid definition for use by a table session. Most React pages call
// `useTGridSession`; use this directly for tests or custom session wrappers.
export function compileTGridRuntimeConfig<
  RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel,
  AppServices = unknown,
>(
  args: CompileTGridRuntimeConfigArgs<RowsByLevel, AppServices>,
): CompiledTGridRuntimeConfig<RowsByLevel> {
  const levels: Record<string, LevelSchema> = {};
  const endpointFactoriesByLevel: Record<
    string,
    RestEndpointFactory<TGridFilter>
  > = {};
  const levelInfoById: Record<string, TGridLevelInfo> = {};

  const rootLevel = args.rootLevel;
  validateTGridDefinition(rootLevel, args.levels, "compileTGridRuntimeConfig");

  const entries = Object.entries(args.levels) as Array<
    [
      TGridLevelId<RowsByLevel>,
      TGridLevelConfig<RowsByLevel, AppServices, TGridLevelId<RowsByLevel>>,
    ]
  >;

  for (const [levelId, config] of entries) {
    const table = config.table;
    const pkCol = primaryKeyOf(table, levelId);
    const childSchemas = table.children ?? [];

    const parent = config.parent
      ? {
          parentLevelId: config.parent.level,
          foreignKey: config.parent.foreignKey as TableColumnName,
        }
      : undefined;

    const columnBuild = buildTGridColumnsForTable({
      table,
      specs: resolveColumns(levelId, config.columns),
      levelId,
      includedColumnNames: config.includedColumnNames,
      rowHeaderColumn: config.rowHeaderColumn,
      immutable: table.immutable ?? false,
      expandable: config.childLevels.length > 0,
      columnMapper: args.columnMapper,
      sessionContext: args.sessionContext ?? missingTGridSessionContext,
    });

    levels[levelId] = {
      name: levelId,
      columns: columnBuild.columns,
      rowHeaderColumn: columnBuild.rowHeaderColumn,
      options: tableRowIdentity(pkCol.name, table.immutable ?? false),
      childLevels: [...config.childLevels],
    };

    levelInfoById[levelId] = {
      levelId: String(levelId),
      tableName: table.name,
      ...(parent
        ? {
            parent: {
              parentLevelId: parent.parentLevelId,
              foreignKey: parent.foreignKey,
            },
          }
        : {}),
      childSchemas,
    };

    // The root level normally follows visible table controls. Child levels use
    // their configured defaults unless the app explicitly gives them controls.
    const queryConfig: TGridLevelQueryConfig = {
      owner: levelId === rootLevel ? "host" : "source",
      ...(config.query ?? {}),
    };
    const rowsClient = config.rowsClient ?? {
      fetch: fetchTableRows,
      create: createTableRow,
      update: updateTableRow,
      remove: deleteTableRow,
    };

    const defaultSort = resolveSortDescriptor(
      queryConfig.initialSort ?? config.parent?.defaultSort,
      table,
    );

    endpointFactoriesByLevel[levelId] = makeEndpointFactory({
      levelId,
      table,
      parent: parent
        ? {
            parentLevelId: parent.parentLevelId,
            foreignKey: parent.foreignKey,
            defaultSort,
          }
        : undefined,
      queryConfig,
      rowQueryState:
        queryConfig.owner === "host"
          ? () => args.hostRowQueryState?.(levelId)
          : undefined,
      recordTotalCount: (totalCount) =>
        args.recordTotalCount?.(levelId, totalCount),
      rowsClient,
      saveCellValueByColumn: columnBuild.saveCellValueByColumn,
      sessionContext: args.sessionContext as
        | (() => TGridSessionContext<TGridRowsByLevel, unknown>)
        | undefined,
    });
  }

  return {
    gridSchema: { rootLevel, levels },
    endpointFactoriesByLevel,
    levelInfoById,
  };
}

function validateTGridDefinition<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
>(
  rootLevel: TGridLevelId<RowsByLevel>,
  levels: TGridLevelsConfigMap<RowsByLevel, AppServices>,
  label: string,
): void {
  if (!levels[rootLevel]) {
    throw new Error(
      `${label}: root level '${String(rootLevel)}' was not found in levels`,
    );
  }

  const entries = Object.entries(levels) as Array<
    [
      TGridLevelId<RowsByLevel>,
      TGridLevelConfig<RowsByLevel, AppServices, TGridLevelId<RowsByLevel>>,
    ]
  >;

  for (const [levelId, config] of entries) {
    if (config.parent) {
      if (!(config.parent.level in levels)) {
        throw new Error(
          `${label}: level '${String(levelId)}' parent level '${String(config.parent.level)}' was not found`,
        );
      }
    } else if (levelId !== rootLevel) {
      throw new Error(
        `${label}: non-root level '${String(levelId)}' has no parent`,
      );
    }

    // Host query state is level-scoped. Non-root levels are path-scoped at
    // runtime, with one source per expanded parent row, so sharing host state
    // would mix page/sort/filter/count values between sibling child tables.
    if (levelId !== rootLevel && config.query?.owner === "host") {
      throw new Error(
        `${label}: non-root level '${String(levelId)}' cannot use query.owner "host". Use "source" for expanded child levels, or make '${String(levelId)}' the root level of its own TGrid.`,
      );
    }

    for (const childLevelId of config.childLevels) {
      if (!levels[childLevelId]) {
        throw new Error(
          `${label}: level '${String(levelId)}' child level '${String(childLevelId)}' was not found`,
        );
      }
    }

    primaryKeyOf(config.table, levelId);
  }
}

function resolveColumns<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  levelId: LevelId,
  cols:
    | TGridColumnSpecBuilder<RowsByLevel, AppServices, LevelId>
    | readonly TGridColumnSpec<RowsByLevel, AppServices, LevelId>[]
    | undefined,
): readonly TGridColumnSpec<RowsByLevel, AppServices, LevelId>[] | undefined {
  if (!cols) return undefined;
  if (typeof cols !== "function") return cols;
  return cols(
    createTGridColumnsBuilder<RowsByLevel, AppServices, LevelId>(levelId),
  );
}

function primaryKeyOf(table: TableSchema, levelId: string): TableColumnSchema {
  const pk = table.columns.find((c) => c.primary);
  if (!pk) {
    throw new Error(
      `compileTGridRuntimeConfig: level '${levelId}' table '${table.name}' has no primary key column`,
    );
  }
  return pk;
}

function resolveSortDescriptor(
  value: string | readonly SortDescriptor[] | undefined,
  table: TableSchema,
): SortDescriptor[] {
  if (!value) return [];
  const validColIds: ReadonlySet<ColId> = new Set(
    table.columns.map((c) => c.name as ColId),
  );
  if (typeof value === "string") {
    return parseSortString(value, validColIds);
  }
  return parseSortString(stringifySortOrder([...value]), validColIds);
}

function defaultPageSize(
  pageSize: number | (() => number) | undefined,
  fallback = 50,
): number {
  if (typeof pageSize === "function") return pageSize();
  return pageSize ?? fallback;
}

function missingTGridSessionContext(): never {
  throw new Error(
    "compileTGridRuntimeConfig: a custom TGrid column requested session context before a session was supplied",
  );
}

function makeEndpointFactory(args: {
  levelId: string;
  table: TableSchema;
  parent?: {
    parentLevelId: string;
    foreignKey: TableColumnName;
    defaultSort: SortDescriptor[];
  };
  queryConfig: TGridLevelQueryConfig;
  rowQueryState?: () => RowQueryState<TGridFilter> | undefined;
  recordTotalCount?: (totalCount: number | null) => void;
  rowsClient: TableRowsClient;
  saveCellValueByColumn: ReadonlyMap<
    ColId,
    TGridRuntimeCellWriteHandler<TGridRowsByLevel, unknown, string>
  >;
  sessionContext:
    | (() => TGridSessionContext<TGridRowsByLevel, unknown>)
    | undefined;
}): RestEndpointFactory<TGridFilter> {
  const validColIds: ReadonlySet<ColId> = new Set(
    args.table.columns.map((c) => c.name as ColId),
  );

  return (ctx) => {
    // Expanded child rows are always filtered to the parent row that opened them.
    const parentRowKey = args.parent
      ? parentKeyFor(args.levelId, args.parent.parentLevelId, ctx.ancestors)
      : null;
    // A REST level receives two independent pieces:
    //
    // - `rowQuery` stores the mutable page, sort, filter, and search values a
    //   user can change.
    // - `buildRowsRequest` adds the context that is always true for this level,
    //   such as parent-row constraints and fixed filters.
    //
    // This split keeps application-visible query state small and reusable. CSV
    // export, URL state, table controls, and row loading read the same mutable
    // query state, while child-table constraints stay attached to the expanded
    // source instance that owns them.
    const rowQuery =
      args.queryConfig.owner === "host"
        ? requireHostRowQuery(args.levelId, args.rowQueryState)
        : sourceOwnedRowQuery<TGridFilter>(
            initialSourceOwnedQuery(args.queryConfig, args.parent, args.table),
          );
    const parentConstraint = args.parent
      ? parseFilterForTable(
          eqCondition(args.parent.foreignKey, String(parentRowKey)),
          args.table,
        )
      : null;
    const buildRowsRequest = buildTGridRowsRequest({
      fixedFilters: parseFiltersForTable(
        args.queryConfig.fixedFilters ?? [],
        args.table,
      ),
      parentConstraint,
    });
    return {
      rowQuery,
      buildRowsRequest,
      fetchPage: async (req) => {
        const res = await args.rowsClient.fetch({
          tableName: args.table.name,
          page: req.page,
          limit: req.pageSize,
          sort: req.sort ? [...req.sort] : undefined,
          filters: req.filter?.conditions ?? [],
          search: req.filter?.search ?? undefined,
        } satisfies FetchTableRowsParams);
        args.recordTotalCount?.(res.meta.total);
        return {
          nodes: buildTableTreeNodes(res.data, args.levelId),
          totalCount: res.meta.total,
        };
      },
      patchCell: async (req) => {
        const saveCellValue = args.saveCellValueByColumn.get(req.colId);
        if (saveCellValue) {
          if (!args.sessionContext) {
            throw new Error(
              `compileTGridRuntimeConfig: custom saveCellValue for '${args.levelId}.${req.colId}' requires a TGrid session context`,
            );
          }
          const session = args.sessionContext();
          const result = await saveCellValue({
            value: req.value,
            row: req.row,
            rowKey: req.rowKey,
            levelId: args.levelId,
            path: pathForEndpoint(args.levelId, ctx.ancestors),
            runtime: session.runtime,
            appServices: session.appServices,
          });
          return patchCellResponseFromTGridResult(result, args.levelId);
        }

        const result = await args.rowsClient.update(
          args.table.name,
          String(req.rowKey) as RowId,
          { [req.colId]: req.value } as Row,
        );
        return { value: (result.data as Row)[req.colId] };
      },
      insertNode: async (req) => {
        // Creating a child row should attach it to the expanded parent row.
        const columns = args.parent
          ? { ...req.node.columns, [args.parent.foreignKey]: parentRowKey }
          : req.node.columns;
        const result = await args.rowsClient.create(
          args.table.name,
          columns as Row,
        );
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return { levelName: args.levelId, columns: row };
      },
      removeNode: async (req) => {
        await args.rowsClient.remove(
          args.table.name,
          String(req.rowKey) as RowId,
        );
      },
      canAppendRow: ({ request, visibleCount, totalCount }) => {
        // TGrid request pages are one-based because the table API and URL state
        // are one-based. The grid runtime never reads these coordinates; it
        // only asks whether the currently loaded rows are the append boundary.
        if (visibleCount === 0) {
          return request.page === 1 && totalCount === 0;
        }
        if (!Number.isFinite(request.pageSize)) return true;
        if (totalCount === undefined) return visibleCount < request.pageSize;
        const pageStart = (request.page - 1) * request.pageSize;
        return pageStart + visibleCount >= totalCount;
      },
    };
  };
}

function requireHostRowQuery(
  levelId: string,
  rowQueryState: (() => RowQueryState<TGridFilter> | undefined) | undefined,
): RowQueryState<TGridFilter> {
  const state = rowQueryState?.();
  if (!state) {
    throw new Error(
      `compileTGridRuntimeConfig: no host query state found for level '${levelId}'.`,
    );
  }
  return hostBackedRowQuery(state);
}

function initialSourceOwnedQuery(
  queryConfig: TGridLevelQueryConfig,
  parent:
    | {
        defaultSort: SortDescriptor[];
      }
    | undefined,
  table: TableSchema,
) {
  return {
    page: queryConfig.initialPage ?? 1,
    pageSize: defaultPageSize(queryConfig.pageSize),
    sort: [...(queryConfig.initialSort ?? parent?.defaultSort ?? [])],
    filter: {
      conditions: parseFiltersForTable(queryConfig.initialFilters ?? [], table),
      search: queryConfig.initialSearch ?? null,
    },
  };
}

function buildTGridRowsRequest(args: {
  fixedFilters: readonly TypedFilterCondition[];
  parentConstraint: TypedFilterCondition | null;
}): BuildRowsRequest<TGridFilter> {
  // Request building is sampled for loading states, retry state, snapshots, and
  // fetch calls. The order below makes constraints visible in a stable way:
  // parent constraint first, fixed page constraints next, then user filters.
  // User controls do not mutate parent or fixed constraints; they only mutate
  // the row query that is passed into this function.
  const parentFilters = args.parentConstraint ? [args.parentConstraint] : [];
  return (query) => ({
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort ? [...query.sort] : [],
    filter: {
      conditions: [
        ...parentFilters,
        ...args.fixedFilters,
        ...(query.filter?.conditions ?? []),
      ],
      search: query.filter?.search ?? null,
    },
  });
}

function patchCellResponseFromTGridResult(
  result: TGridRuntimeCellWriteResult,
  levelId: string,
): PatchCellResponse {
  switch (result.kind) {
    case "value":
      return { kind: "value", value: result.value };
    case "patch":
      return { kind: "patch", patch: result.patch };
    case "row":
      return {
        kind: "row",
        node: { levelName: levelId, columns: result.row },
      };
    case "reload":
      return { kind: "reload" };
  }
}

function buildTableTreeNodes(rows: Row[], levelId: string): TreeNode[] {
  return rows.map((row) => ({
    levelName: levelId,
    columns: row as Record<string, unknown>,
  }));
}

function parentKeyFor(
  levelId: string,
  parentLevelId: string,
  ancestors: Parameters<RestEndpointFactory<TGridFilter>>[0]["ancestors"],
): string {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) {
    throw new Error(
      `compileTGridRuntimeConfig: child level '${levelId}' requires a parent ancestor`,
    );
  }
  if (parent.levelName !== parentLevelId) {
    throw new Error(
      `compileTGridRuntimeConfig: child level '${levelId}' expected parent level '${parentLevelId}', got '${parent.levelName}'`,
    );
  }
  return parent.rowKey;
}

function pathForEndpoint(
  levelId: string,
  ancestors: Parameters<RestEndpointFactory<TGridFilter>>[0]["ancestors"],
): GridPath {
  if (ancestors.length === 0) return rootPath(levelId);
  let path = rootPath(ancestors[0].levelName);
  for (let index = 1; index < ancestors.length; index += 1) {
    const previous = ancestors[index - 1];
    path = childPath(path, previous.rowKey, ancestors[index].levelName);
  }
  const parent = ancestors[ancestors.length - 1];
  return childPath(path, parent.rowKey as RowKey, levelId);
}
