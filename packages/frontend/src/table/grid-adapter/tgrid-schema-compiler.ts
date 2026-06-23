import type { ChildSchema, TableSchema } from "@sapporta/shared/contracts";
import type { FilterCondition } from "@sapporta/shared/filter";
import type { SortDescriptor } from "@sapporta/grid";
import type {
  TGridLevelConfig,
  TGridLevelQueryConfig,
  TGridLevelsConfigMap,
} from "@/table/grid-adapter/tgrid-level-config";

// Table schemas keyed by table name. Schema-driven pages need this lookup so a
// child relation such as `orders -> order_lines` can find the child table's
// columns and nested children.
export type TableSchemaRegistry = Record<string, TableSchema>;

// One child table as it appears under a parent table.
// The level id is path-like (`orders.order_lines`) so the same table can appear
// in different parent contexts without colliding.
export type TableGridGraphLevelRelation = {
  childTable: ChildSchema;
  childLevelId: string;
};

// One visible level in a schema-driven grid.
// A level has a table to show, an optional parent relation, and child levels the
// user can expand into from each row.
export type TableGridGraphNode = {
  table: TableSchema;
  parent?: {
    parentLevelId: string;
    foreignKey: string;
    defaultSort: string;
    columns: readonly string[];
  };
  children: readonly TableGridGraphLevelRelation[];
};

// Complete expandable table shape for one root table.
// The graph is built before session config so schema problems such as missing
// child tables or cycles fail early.
export type TableGridGraph = {
  rootLevel: string;
  levels: Record<string, TableGridGraphNode>;
};

// Read table metadata and build the expandable level graph a user will see.
// Root level ids use the root table name; child level ids append table names as
// the path descends through children.
export function buildTableGridGraphFromSchema(args: {
  rootTableName: string;
  tablesByName: TableSchemaRegistry;
}): TableGridGraph {
  const { rootTableName, tablesByName } = args;
  const rootTable = tablesByName[rootTableName];
  if (!rootTable) {
    throw new Error(
      `buildTableGridGraphFromSchema: root table '${rootTableName}' was not found`,
    );
  }

  const levels: Record<string, TableGridGraphNode> = {};
  const build = (
    levelId: string,
    tableName: string,
    parent?: {
      parentLevelId: string;
      foreignKey: string;
      defaultSort: string;
      columns: readonly string[];
    },
    ancestorTables: readonly string[] = [],
  ): void => {
    // A level id names one exact parent path. If two schema paths produce the
    // same id, the page would not know which rows or children belong there.
    if (levels[levelId]) {
      throw new Error(
        `buildTableGridGraphFromSchema: duplicate level id '${levelId}'`,
      );
    }

    // The table view expands downward. A cycle would let a row expand forever,
    // so fail while reading the schema instead of rendering a broken grid.
    if (ancestorTables.includes(tableName)) {
      throw new Error(
        `buildTableGridGraphFromSchema: cyclic table ancestry detected for '${tableName}' via '${ancestorTables.join(" -> ")}'`,
      );
    }

    const table = tablesByName[tableName];
    if (!table) {
      throw new Error(
        `buildTableGridGraphFromSchema: table '${tableName}' was not found`,
      );
    }

    const childRelations: TableGridGraphLevelRelation[] = [];
    const nextAncestors = [...ancestorTables, tableName];

    // Child levels are named by their route through the table tree. The name is
    // stable enough for custom column definitions to target a specific level.
    for (const child of table.children ?? []) {
      const childLevelId = `${levelId}.${child.table}`;
      childRelations.push({
        childTable: child,
        childLevelId,
      });
      build(
        childLevelId,
        child.table,
        {
          parentLevelId: levelId,
          foreignKey: child.foreignKey,
          defaultSort: child.defaultSort,
          columns: child.columns,
        },
        nextAncestors,
      );
    }

    levels[levelId] = {
      table,
      parent,
      children: childRelations,
    };
  };

  build(rootTableName, rootTable.name);

  return { rootLevel: rootTableName, levels };
}

// Query defaults callers may apply to the visible root table.
// The root is controlled by the page, while child levels load from the row
// expansion that opened them.
export type RootLevelQueryConfig = Omit<TGridLevelQueryConfig, "owner"> & {
  initialSort?: readonly SortDescriptor[];
  initialFilters?: readonly FilterCondition[];
  initialSearch?: string | null;
  initialPage?: number;
  pageSize?: number | (() => number);
};

type AnyRowsByLevel = Record<string, Record<string, unknown>>;

// Schema-driven rows are discovered from table metadata, so this shape stays
// broad. Custom definitions can use narrower row types when the page knows them.
export type BuiltSessionLevelMap = TGridLevelsConfigMap<
  AnyRowsByLevel,
  unknown
>;

// Level config ready to pass to `defineTGrid`.
// Every child and parent link has already been resolved from table metadata.
export type TGridSessionLevelConfigFromGraph = {
  rootLevel: string;
  levels: BuiltSessionLevelMap;
};

// Convert the schema graph into the explicit level declarations used by TGrid.
// This is where the default query rule becomes concrete: root tables are
// controlled by the page, child tables are controlled by the row they expand from.
export function buildSessionLevelsFromTableGridGraph(args: {
  graph: TableGridGraph;
  rootLevelQuery: RootLevelQueryConfig;
  childLevelQuery?: Omit<TGridLevelQueryConfig, "owner">;
}): TGridSessionLevelConfigFromGraph {
  const { graph, rootLevelQuery, childLevelQuery } = args;

  const levels: Record<string, TGridLevelConfig<AnyRowsByLevel, unknown>> = {};

  for (const [levelId, level] of Object.entries(graph.levels)) {
    levels[levelId] = {
      table: level.table,
      childLevels: level.children.map((child) => child.childLevelId),
      ...(level.parent
        ? {
            includedColumnNames: level.parent.columns,
            parent: {
              level: level.parent.parentLevelId,
              foreignKey: level.parent.foreignKey,
              defaultSort: level.parent.defaultSort,
            },
          }
        : {}),
      query: {
        owner: levelId === graph.rootLevel ? "host" : "source",
        ...(levelId === graph.rootLevel
          ? rootLevelQuery
          : (childLevelQuery ?? {})),
      } as TGridLevelQueryConfig,
    };
  }

  return {
    rootLevel: graph.rootLevel,
    levels: levels as BuiltSessionLevelMap,
  };
}
