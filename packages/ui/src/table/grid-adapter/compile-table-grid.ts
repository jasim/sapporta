import type {
  ChildSchema,
  ColumnSchema as TableColumnSchema,
  Row,
  TableSchema,
} from "@sapporta/shared/contracts";
import type {
  ColId,
  GridSchema,
  LevelSchema,
  RestEndpointFactory,
  SortDescriptor,
  TreeNode,
} from "@/grid";
import { eqCondition, type FilterCondition } from "@sapporta/shared/filter";
import {
  fetchRows,
  createRow as apiCreateRow,
  updateRow as apiUpdateRow,
  deleteRow as apiDeleteRow,
  type FetchRowsParams,
} from "@/table/api/rows";
import { parseSortString } from "@/grid/sort";
import type { RowId } from "@sapporta/shared/row-id";
import { tableColumnsToGridThemeColumns } from "./table-grid-theme";
import { tableRowIdentity } from "./table-row-identity";
import type { TableGridThemeContext } from "./table-grid-theme";

export type TableFilter = {
  conditions: FilterCondition[];
  search: string | null;
};

export type TableLevelMeta = {
  levelId: string;
  tableName: string;
  parent?: {
    parentLevelId: string;
    foreignKey: string;
  };
  childSchemas: ChildSchema[];
};

type TableGridApi = {
  fetchRows: typeof fetchRows;
  createRow: typeof apiCreateRow;
  updateRow: typeof apiUpdateRow;
  deleteRow: typeof apiDeleteRow;
};

export type CompileTableGridArgs = {
  rootTable: TableSchema;
  tablesByName: Record<string, TableSchema>;
  theme: TableGridThemeContext;
  rootStatePolicy: {
    query: () => {
      page: number;
      pageSize: number;
      sort: SortDescriptor[];
      filter: TableFilter;
    };
  };
  childQueryPolicy?: {
    pageSize?: number | (() => number);
  };
  api?: TableGridApi;
};

export type CompiledTableGrid = {
  schema: GridSchema;
  endpoints: Record<string, RestEndpointFactory<TableFilter>>;
  levelMetaById: Record<string, TableLevelMeta>;
};

export function compileTableGrid(
  args: CompileTableGridArgs,
): CompiledTableGrid {
  const api: TableGridApi = args.api ?? {
    fetchRows,
    createRow: apiCreateRow,
    updateRow: apiUpdateRow,
    deleteRow: apiDeleteRow,
  };
  const levels: Record<string, LevelSchema> = {};
  const endpoints: Record<string, RestEndpointFactory<TableFilter>> = {};
  const levelMetaById: Record<string, TableLevelMeta> = {};

  function compileLevel(params: {
    table: TableSchema;
    levelId: string;
    projectedColumns?: string[];
    parent?: { parentLevelId: string; foreignKey: string; defaultSort: string };
  }): void {
    const { table, levelId, projectedColumns, parent } = params;
    if (levels[levelId]) {
      throw new Error(`compileTableGrid: duplicate level id '${levelId}'`);
    }

    const pkCol = primaryKeyOf(table, levelId);
    const children = table.children ?? [];
    const childLevelIds = children.map((child) => `${levelId}.${child.table}`);
    levels[levelId] = {
      name: levelId,
      columns: tableColumnsToGridThemeColumns({
        table,
        projectedColumns,
        immutable: table.immutable ?? false,
        expandable: childLevelIds.length > 0,
        context: args.theme,
      }),
      options: tableRowIdentity(pkCol.name, table.immutable ?? false),
      childLevels: childLevelIds,
    };

    levelMetaById[levelId] = {
      levelId,
      tableName: table.name,
      ...(parent
        ? {
            parent: {
              parentLevelId: parent.parentLevelId,
              foreignKey: parent.foreignKey,
            },
          }
        : {}),
      childSchemas: children,
    };

    endpoints[levelId] = makeEndpointFactory({
      levelId,
      table,
      parent,
      rootQuery: args.rootStatePolicy.query,
      childPageSize: args.childQueryPolicy?.pageSize,
      api,
    });

    for (const child of children) {
      const childTable = args.tablesByName[child.table];
      if (!childTable) {
        throw new Error(
          `compileTableGrid: child table '${child.table}' declared by '${table.name}' was not found`,
        );
      }
      compileLevel({
        table: childTable,
        levelId: `${levelId}.${child.table}`,
        projectedColumns: child.columns,
        parent: {
          parentLevelId: levelId,
          foreignKey: child.foreignKey,
          defaultSort: child.defaultSort,
        },
      });
    }
  }

  compileLevel({ table: args.rootTable, levelId: args.rootTable.name });
  return {
    schema: { rootLevel: args.rootTable.name, levels },
    endpoints,
    levelMetaById,
  };
}

function primaryKeyOf(table: TableSchema, levelId: string): TableColumnSchema {
  const pk = table.columns.find((c) => c.primary);
  if (!pk) {
    throw new Error(
      `compileTableGrid: level '${levelId}' table '${table.name}' has no primary key column`,
    );
  }
  return pk;
}

function childPageSizeOf(policy: number | (() => number) | undefined): number {
  if (typeof policy === "function") return policy();
  return policy ?? 50;
}

function makeEndpointFactory(args: {
  levelId: string;
  table: TableSchema;
  parent?: { parentLevelId: string; foreignKey: string; defaultSort: string };
  rootQuery: CompileTableGridArgs["rootStatePolicy"]["query"];
  childPageSize: number | (() => number) | undefined;
  api: TableGridApi;
}): RestEndpointFactory<TableFilter> {
  const validColIds: ReadonlySet<ColId> = new Set(
    args.table.columns.map((c) => c.name as ColId),
  );
  const defaultSort = args.parent
    ? parseSortString(args.parent.defaultSort, validColIds)
    : [];

  return (ctx) => {
    const parentRowKey = args.parent
      ? parentKeyFor(args.levelId, args.parent.parentLevelId, ctx.ancestors)
      : null;
    return {
      serverManaged: { sort: true, filter: true, pagination: true },
      query: () => {
        if (!args.parent) return args.rootQuery();
        return {
          page: 1,
          pageSize: childPageSizeOf(args.childPageSize),
          sort: defaultSort,
          filter: {
            conditions: [
              eqCondition(args.parent.foreignKey, String(parentRowKey)),
            ],
            search: null,
          },
        };
      },
      fetchPage: async (req) => {
        const res = await args.api.fetchRows({
          tableName: args.table.name,
          page: req.page,
          limit: req.pageSize,
          sort: req.sort,
          filters: req.filter?.conditions ?? [],
          search: req.filter?.search ?? undefined,
        } satisfies FetchRowsParams);
        return {
          nodes: buildTableTreeNodes(res.data, args.levelId),
          totalCount: res.meta.total,
        };
      },
      patchCell: async (req) => {
        const result = await args.api.updateRow(
          args.table.name,
          String(req.rowKey) as RowId,
          { [req.colId]: req.value } as Row,
        );
        return { value: (result.data as Row)[req.colId] };
      },
      insertNode: async (req) => {
        const columns = args.parent
          ? { ...req.node.columns, [args.parent.foreignKey]: parentRowKey }
          : req.node.columns;
        const result = await args.api.createRow(
          args.table.name,
          columns as Row,
        );
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return { levelName: args.levelId, columns: row };
      },
      removeNode: async (req) => {
        await args.api.deleteRow(args.table.name, String(req.rowKey) as RowId);
      },
    };
  };
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
  ancestors: Parameters<RestEndpointFactory<TableFilter>>[0]["ancestors"],
): string {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) {
    throw new Error(
      `compileTableGrid: child endpoint '${levelId}' requires a parent ancestor`,
    );
  }
  if (parent.levelName !== parentLevelId) {
    throw new Error(
      `compileTableGrid: child endpoint '${levelId}' expected parent level '${parentLevelId}', got '${parent.levelName}'`,
    );
  }
  return parent.rowKey;
}
