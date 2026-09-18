import {
  resolveTableTree,
  type ChildSchema,
  type ColumnSchema as TableColumnSchema,
  type Row,
  type TableSchema,
  type TableTree,
  type TreeMatchContext,
} from "@sapporta/shared/contracts";
import {
  mintFilterId,
  parseFilterValue,
  parseFiltersForTable,
  serializeTypedValue,
  type TypedFilterCondition,
  type TypedValue,
} from "@sapporta/shared/filter";
import {
  CELL_GRID_WITH_ROW_CLICK_ACTIVATION,
  childPath,
  hostBackedRowQuery,
  rootPath,
  sourceOwnedRowQuery,
  validateLevelTree,
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
import type { TGridColumnMapper } from "./tgrid-column-mapper";
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
import type { TGridTreeResult } from "./tgrid-level-query-state";
import type {
  TGridLevelQueryConfig,
  TGridLevelInfo,
  TGridLevelPagination,
  TableRowsClient,
  TGridLevelConfig,
  TGridLevelsConfigMap,
} from "./tgrid-level-config";
import { tgridPageWindow } from "./tgrid-page-window";

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
  // The default enables semantic row activation on plain click: pointer and
  // keyboard behavior is unchanged, and narrow card layouts use the event to
  // open the record detail sheet on tap.
  return {
    ...definition,
    interaction: definition.interaction ?? CELL_GRID_WITH_ROW_CLICK_ACTIVATION,
  };
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
  recordTreeResult?: (
    levelId: TGridLevelId<RowsByLevel>,
    result: TGridTreeResult,
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
    const tree = resolveLevelTree(levelId, config, "compileTGridRuntimeConfig");
    // A tree level reads every row at once so the whole tree can be built.
    // Query state, row requests, pagers, and URL state all follow this value.
    const pagination: TGridLevelPagination = tree ? "all" : "pages";

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
      rowKeyColumn: pkCol.name,
      rowHeaderColumn: config.rowHeaderColumn,
      immutable: table.immutable ?? false,
      expandable: config.childLevels.length > 0,
      treeColumn: tree?.column ?? null,
      columnMapper: args.columnMapper,
      sessionContext: args.sessionContext ?? missingTGridSessionContext,
    });

    levels[levelId] = {
      name: levelId,
      columns: columnBuild.columns,
      rowHeaderColumn: columnBuild.rowHeaderColumn,
      options: { allowPhantoms: !(table.immutable ?? false) },
      childLevels: [...config.childLevels],
      ...(tree
        ? {
            tree: {
              parentKeyField: tree.parentColumn,
              // A child draft stores its parent's primary key as the table
              // types it, such as a number, like the rows the server returns.
              parentKeyValue: (parent: TreeNode) => parent.columns[pkCol.name],
              defaultExpanded: tree.defaultExpanded,
            },
          }
        : {}),
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
      // The column that `withTreeColumn` wrapped. It differs from the declared
      // column when the declared column is not shown on this level.
      tree: tree
        ? { ...tree, column: columnBuild.treeColumnId ?? tree.column }
        : null,
      pagination,
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
      rowKeyColumn: pkCol.name,
      parent: parent
        ? {
            parentLevelId: parent.parentLevelId,
            foreignKey: parent.foreignKey,
            defaultSort,
          }
        : undefined,
      queryConfig,
      pagination,
      rowQueryState:
        queryConfig.owner === "host"
          ? () => args.hostRowQueryState?.(levelId)
          : undefined,
      recordTotalCount: (totalCount) =>
        args.recordTotalCount?.(levelId, totalCount),
      tree: tree
        ? {
            matchContext: tree.matchContext,
            // The server walks only a tree the table itself declares.
            serverWalk: table.tree?.parentColumn === tree.parentColumn,
            recordResult: (result) => args.recordTreeResult?.(levelId, result),
          }
        : null,
      rowsClient,
      saveCellValueByColumn: columnBuild.saveCellValueByColumn,
      sessionContext: args.sessionContext as
        (() => TGridSessionContext<TGridRowsByLevel, unknown>) | undefined,
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
    resolveLevelTree(levelId, config, label);
  }
}

// The tree a level shows: the table's declared `tree`, the level's overrides
// on top of it, or none. The grid's own rules for tree levels are checked here
// too, so a bad declaration is reported by `defineTGrid`.
function resolveLevelTree<RowsByLevel extends TGridRowsByLevel, AppServices>(
  levelId: TGridLevelId<RowsByLevel>,
  config: TGridLevelConfig<RowsByLevel, AppServices, TGridLevelId<RowsByLevel>>,
  label: string,
): TableTree | null {
  const table = config.table;
  const declared = table.tree;
  if (config.tree === false) return null;
  if (config.tree === undefined && !declared) return null;
  const override = config.tree ?? {};
  const parentColumn = override.parentColumn ?? declared?.parentColumn;
  if (!parentColumn) {
    throw new Error(
      `${label}: level '${String(levelId)}' tree needs a parentColumn, because table '${table.name}' declares no tree`,
    );
  }
  if (!table.columns.some((column) => column.name === parentColumn)) {
    throw new Error(
      `${label}: level '${String(levelId)}' tree parentColumn '${parentColumn}' is not a column of table '${table.name}'`,
    );
  }
  validateLevelTree(
    String(levelId),
    {
      tree: { parentKeyField: parentColumn },
      childLevels: config.childLevels.map(String),
    },
    label,
  );
  return resolveTableTree(
    {
      parentColumn,
      column: override.column ?? declared?.column,
      defaultExpanded: override.defaultExpanded ?? declared?.defaultExpanded,
      matchContext: override.matchContext ?? declared?.matchContext,
    },
    table.rowLabelColumns,
  );
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
  rowKeyColumn: TableColumnName;
  parent?: {
    parentLevelId: string;
    foreignKey: TableColumnName;
    defaultSort: SortDescriptor[];
  };
  queryConfig: TGridLevelQueryConfig;
  pagination: TGridLevelPagination;
  rowQueryState?: () => RowQueryState<TGridFilter> | undefined;
  recordTotalCount?: (totalCount: number | null) => void;
  tree: {
    matchContext: TreeMatchContext;
    serverWalk: boolean;
    recordResult: (result: TGridTreeResult) => void;
  } | null;
  rowsClient: TableRowsClient;
  saveCellValueByColumn: ReadonlyMap<
    ColId,
    TGridRuntimeCellWriteHandler<TGridRowsByLevel, unknown, string>
  >;
  sessionContext:
    (() => TGridSessionContext<TGridRowsByLevel, unknown>) | undefined;
}): RestEndpointFactory<TGridFilter> {
  return (ctx) => {
    // Expanded child rows belong to the parent row that opened them. A fetch
    // filters on the parent's key, and a new child row is saved with it.
    const parentKey = args.parent
      ? parentKeyFor(args.levelId, args.parent, args.table, ctx.ancestors)
      : null;
    // A REST level receives two independent pieces:
    //
    // - `rowQuery` stores the mutable page, sort, filter, and search values a
    //   user can change.
    // - `fixed` holds the conditions that are always true for this level: the
    //   parent-row constraint and the fixed filters. Every fetch sends them as
    //   the request's fixed conditions, apart from the user's filters and
    //   search.
    //
    // This split keeps application-visible query state small and reusable. CSV
    // export, URL state, table controls, and row loading read the same mutable
    // query state, while child-table constraints stay attached to the expanded
    // source instance that owns them. Sending the fixed conditions apart also
    // lets the server tell the conditions that bound a tree walk from those
    // that select its matches, so a tree search keeps only ancestors and
    // descendants that satisfy the fixed conditions.
    const rowQuery =
      args.queryConfig.owner === "host"
        ? requireHostRowQuery(args.levelId, args.rowQueryState)
        : sourceOwnedRowQuery<TGridFilter>(
            initialSourceOwnedQuery(
              args.queryConfig,
              args.parent,
              args.table,
              args.pagination,
            ),
          );
    const parentConstraint: TypedFilterCondition | null = parentKey
      ? {
          id: mintFilterId(parentKey.column.name, "eq"),
          column: parentKey.column.name,
          op: "eq",
          kind: parentKey.column.kind,
          value: parentKey.value,
        }
      : null;
    const fixed = [
      ...(parentConstraint ? [parentConstraint] : []),
      ...parseFiltersForTable(args.queryConfig.fixedFilters ?? [], args.table),
    ];
    return {
      rowQuery,
      buildRowsRequest: buildTGridRowsRequest(args.pagination),
      fetchPage: async (req) => {
        const res = await args.rowsClient.fetch({
          tableName: args.table.name,
          page: req.page,
          limit: req.pageSize,
          sort: req.sort ? [...req.sort] : undefined,
          fixed,
          filters: req.filter?.conditions ?? [],
          search: req.filter?.search ?? undefined,
          // A user filter or search on a tree keeps each match's ancestors,
          // so the match shows in place. The server walks the tree only when
          // the request has a filter or search.
          ...(args.tree?.serverWalk ? { tree: args.tree.matchContext } : {}),
        } satisfies FetchTableRowsParams);
        args.recordTotalCount?.(res.meta.total);
        args.tree?.recordResult({
          matchCount: res.meta.tree?.matchCount ?? null,
          loadedRowCount: res.data.length,
          truncated: res.meta.total > res.data.length,
        });
        return {
          nodes: buildTableTreeNodes(res.data, args.levelId, args.rowKeyColumn),
          totalCount: res.meta.total,
          ...(res.meta.tree
            ? { treeContextRowKeys: res.meta.tree.contextIds }
            : {}),
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
          const level = session.runtime.level(
            pathForEndpoint(args.levelId, ctx.ancestors),
          );
          const result = await saveCellValue({
            value: req.value,
            row: req.row,
            rowKey: req.rowKey,
            levelId: args.levelId,
            level,
            runtime: session.runtime,
            appServices: session.appServices,
          });
          return patchCellResponseFromTGridResult(
            result,
            args.levelId,
            args.rowKeyColumn,
          );
        }

        const result = await args.rowsClient.update(
          args.table.name,
          String(req.rowKey),
          { [req.colId]: req.value },
        );
        return { kind: "value", value: result.data[req.colId] };
      },
      insertNode: async (req) => {
        // Creating a child row should attach it to the expanded parent row.
        const columns = parentKey
          ? {
              ...req.node.columns,
              [parentKey.column.name]: serializeTypedValue(parentKey.value),
            }
          : { ...req.node.columns };
        const result = await args.rowsClient.create(args.table.name, columns);
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return tableTreeNode(row, args.levelId, args.rowKeyColumn);
      },
      removeNode: async (req) => {
        await args.rowsClient.remove(args.table.name, String(req.rowKey));
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
  pagination: TGridLevelPagination,
) {
  return {
    ...tgridPageWindow(pagination, {
      page: queryConfig.initialPage ?? 1,
      pageSize: defaultPageSize(queryConfig.pageSize),
    }),
    sort: [...(queryConfig.initialSort ?? parent?.defaultSort ?? [])],
    filter: {
      conditions: parseFiltersForTable(queryConfig.initialFilters ?? [], table),
      search: queryConfig.initialSearch ?? null,
    },
  };
}

function buildTGridRowsRequest(
  pagination: TGridLevelPagination,
): BuildRowsRequest<TGridFilter> {
  // Request building is sampled for loading states, retry state, and fetch
  // calls. The request's filter is the user's own filter and search; the
  // level's fixed conditions are added by `fetchPage`. Host query state is
  // already held to the level's page window; a source-owned query is not, so
  // the request applies the window too.
  return (query) => ({
    ...tgridPageWindow(pagination, {
      page: query.page,
      pageSize: query.pageSize,
    }),
    sort: query.sort ? [...query.sort] : [],
    filter: {
      conditions: [...(query.filter?.conditions ?? [])],
      search: query.filter?.search ?? null,
    },
  });
}

function patchCellResponseFromTGridResult(
  result: TGridRuntimeCellWriteResult,
  levelId: string,
  rowKeyColumn: TableColumnName,
): PatchCellResponse {
  switch (result.kind) {
    case "value":
      return { kind: "value", value: result.value };
    case "patch":
      return { kind: "patch", patch: result.patch };
    case "row":
      return {
        kind: "row",
        node: tableTreeNode(result.row, levelId, rowKeyColumn),
      };
    case "reload":
      return { kind: "reload" };
  }
}

function buildTableTreeNodes(
  rows: readonly Row[],
  levelId: string,
  rowKeyColumn: TableColumnName,
): TreeNode[] {
  return rows.map((row) => tableTreeNode(row, levelId, rowKeyColumn));
}

function tableTreeNode(
  row: Readonly<Record<string, unknown>> | undefined,
  levelId: string,
  rowKeyColumn: TableColumnName,
): TreeNode {
  if (!row) {
    throw new Error(
      `TGrid row adapter: '${levelId}' returned no authoritative row`,
    );
  }
  const primaryKey = row[rowKeyColumn];
  if (primaryKey === null || primaryKey === undefined || primaryKey === "") {
    throw new Error(
      `TGrid row adapter: '${levelId}' row is missing primary key '${rowKeyColumn}'`,
    );
  }
  return {
    rowKey: String(primaryKey),
    levelName: levelId,
    columns: row,
  };
}

// The key of the parent row that opened a child level, typed for the child's
// foreign key column.
//
// The ancestor chain holds the parent's row key as a string, such as "7". The
// foreign key column holds the same key as the child table types it, such as
// the number 7, and the server rejects a string for a number column. The key
// is therefore parsed here, under the column's kind, and both the parent-row
// filter and a new child row use the parsed value.
function parentKeyFor(
  levelId: string,
  parent: { parentLevelId: string; foreignKey: TableColumnName },
  table: TableSchema,
  ancestors: Parameters<RestEndpointFactory<TGridFilter>>[0]["ancestors"],
): { column: TableColumnSchema; value: TypedValue } {
  const parentRow = ancestors[ancestors.length - 1];
  if (!parentRow) {
    throw new Error(
      `compileTGridRuntimeConfig: child level '${levelId}' requires a parent ancestor`,
    );
  }
  if (parentRow.levelName !== parent.parentLevelId) {
    throw new Error(
      `compileTGridRuntimeConfig: child level '${levelId}' expected parent level '${parent.parentLevelId}', got '${parentRow.levelName}'`,
    );
  }
  const column = table.columns.find(
    (candidate) => candidate.name === parent.foreignKey,
  );
  if (!column) {
    throw new Error(
      `compileTGridRuntimeConfig: child level '${levelId}' foreign key '${parent.foreignKey}' is not a column of table '${table.name}'`,
    );
  }
  return { column, value: parseFilterValue(column.kind, parentRow.rowKey) };
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
  return childPath(path, parent.rowKey, levelId);
}
