import type {
  ChildSchema,
  ColumnSchema as TableColumnSchema,
  Row,
  TableSchema,
} from "@sapporta/shared/contracts";
import { eqCondition, type FilterCondition } from "@sapporta/shared/filter";
import {
  childPath,
  rootPath,
  type GridInteractionConfig,
  type PhantomRowsConfig,
} from "@sapporta/grid";
import type {
  ColId,
  GridPath,
  GridSchema,
  LevelSchema,
  PatchCellResponse,
  RestEndpointFactory,
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
} from "@/table/api/rows";
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
  hostQueryState?: (
    levelId: TGridLevelId<RowsByLevel>,
  ) => TGridRowQueryState | undefined;
  setHostPage?: (levelId: TGridLevelId<RowsByLevel>, page: number) => void;
  sessionContext?: () => TGridSessionContext<RowsByLevel, AppServices>;
};

type TGridRowQueryState = {
  page: number;
  pageSize: number;
  sort: readonly SortDescriptor[];
  filters: readonly FilterCondition[];
  search: string | null;
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
      immutable: table.immutable ?? false,
      expandable: config.childLevels.length > 0,
      columnMapper: args.columnMapper,
      sessionContext: args.sessionContext ?? missingTGridSessionContext,
    });

    levels[levelId] = {
      name: levelId,
      columns: columnBuild.columns,
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
          ? () => args.hostQueryState?.(levelId)
          : undefined,
      setHostPage:
        queryConfig.owner === "host"
          ? (page) => args.setHostPage?.(levelId, page)
          : undefined,
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
  rowQueryState?: () => TGridRowQueryState | undefined;
  setHostPage?: (page: number) => void;
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
    let latestTotalCount: number | undefined;
    let latestLoadedRowCount = 0;
    return {
      serverManaged: { sort: true, filter: true, pagination: true },
      query: makeQuery(
        args,
        ctx,
        parentRowKey,
        args.parent
          ? eqCondition(args.parent.foreignKey, String(parentRowKey))
          : null,
      ),
      fetchPage: async (req) => {
        const res = await args.rowsClient.fetch({
          tableName: args.table.name,
          page: req.page,
          limit: req.pageSize,
          sort: req.sort,
          filters: req.filter?.conditions ?? [],
          search: req.filter?.search ?? undefined,
        } satisfies FetchTableRowsParams);
        latestTotalCount = res.meta.total;
        latestLoadedRowCount = res.data.length;
        return {
          nodes: buildTableTreeNodes(res.data, args.levelId),
          totalCount: res.meta.total,
        };
      },
      // Pages with their own table controls should see one pagination story:
      // page clicks, URL sync, and keyboard boundary navigation all change
      // the same query state. The latest fetch result is enough to know whether
      // another page exists.
      pageBoundaryNavigation:
        args.queryConfig.owner === "host" && args.setHostPage
          ? {
              canGoPrevious: () => {
                const q = args.rowQueryState?.();
                return q !== undefined && q.page > 1;
              },
              canGoNext: () => {
                const q = args.rowQueryState?.();
                if (!q) return false;
                if (latestTotalCount !== undefined) {
                  return q.page * q.pageSize < latestTotalCount;
                }
                return latestLoadedRowCount >= q.pageSize;
              },
              goPrevious: () => {
                const q = args.rowQueryState?.();
                if (!q || q.page <= 1) return;
                args.setHostPage?.(q.page - 1);
              },
              goNext: () => {
                const q = args.rowQueryState?.();
                if (!q) return;
                args.setHostPage?.(q.page + 1);
              },
            }
          : undefined,
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
    };
  };
}

function makeQuery(
  args: {
    levelId: string;
    parent?: {
      parentLevelId: string;
      foreignKey: TableColumnName;
      defaultSort: SortDescriptor[];
    };
    queryConfig: TGridLevelQueryConfig;
    rowQueryState?: () => TGridRowQueryState | undefined;
  },
  ctx: {
    ancestors: Parameters<RestEndpointFactory<TGridFilter>>[0]["ancestors"];
  },
  parentRowKey: string | null,
  parentConstraint: FilterCondition | null,
):
  | (() => {
      page: number;
      pageSize: number;
      sort: SortDescriptor[];
      filter: TGridFilter;
    })
  | undefined {
  const queryConfig = args.queryConfig;
  const hasParent = Boolean(args.parent);
  const parentFilter = parentConstraint ? [parentConstraint] : [];

  // Levels with visible controls use the current query state. Levels loaded from
  // an expanded parent row use configured defaults plus the parent-row filter.
  if (queryConfig.owner === "host" || hasParent) {
    if (queryConfig.owner === "host") {
      return () => {
        const q = args.rowQueryState?.();
        if (!q) {
          throw new Error(
            `compileTGridRuntimeConfig: no host query state found for level '${args.levelId}'.`,
          );
        }
        return {
          page: q.page,
          pageSize: q.pageSize,
          sort: [...q.sort],
          filter: {
            conditions: [
              ...parentFilter,
              ...(queryConfig.fixedFilters ?? []),
              ...q.filters,
            ],
            search: q.search,
          },
        };
      };
    }

    return () => {
      return {
        page: queryConfig.initialPage ?? 1,
        pageSize: defaultPageSize(queryConfig.pageSize),
        sort: [...(args.parent?.defaultSort ?? [])],
        filter: {
          conditions: [
            ...parentFilter,
            ...(queryConfig.fixedFilters ?? []),
            ...(queryConfig.initialFilters ?? []),
          ],
          search: queryConfig.initialSearch ?? null,
        },
      };
    };
  }

  return undefined;
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
