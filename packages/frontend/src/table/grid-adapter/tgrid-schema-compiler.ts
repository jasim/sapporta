import type { ChildSchema, TableSchema } from "@sapporta/shared/contracts";
import type { FilterCondition } from "@sapporta/shared/filter";
import type { SortDescriptor } from "@sapporta/grid";
import type {
  TGridLevelConfig,
  TGridLevelQueryConfig,
  TGridLevelsConfigMap,
} from "@/table/grid-adapter/tgrid-level-config";

// Converts legacy table `children` metadata into explicit TGrid level inputs.
// It is the migration bridge so schema-driven pages keep working with the new graph contract.
export type TableSchemaRegistry = Record<string, TableSchema>;

// Captures one child relation discovered from table metadata.
// Stores child schema plus derived level-id for recursive graph construction.
export type TableGridGraphLevelRelation = {
  childTable: ChildSchema;
  childLevelId: string;
};

// Normalized graph node for one level id.
// It carries the table, optional parent link, and list of outbound child edges.
export type TableGridGraphNode = {
  table: TableSchema;
  parent?: {
    parentLevelId: string;
    foreignKey: string;
    defaultSort: string;
  };
  children: readonly TableGridGraphLevelRelation[];
};

// A complete recursive level graph keyed by level id.
// This is the intermediate contract before converting to `createTGridSession` args.
export type TableGridGraph = {
  rootLevel: string;
  levels: Record<string, TableGridGraphNode>;
};

// Canonical graph result from table metadata.
// `buildSessionLevelsFromTableGridGraph` consumes this directly.
// Builds one level graph from table metadata so later compiler stages can stay deterministic.
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
    },
    ancestorTables: readonly string[] = [],
  ): void => {
    // Duplicate child ids are a data-model error because each level id maps to
    // one table in one parent context. The explicit graph relies on uniqueness.
    if (levels[levelId]) {
      throw new Error(
        `buildTableGridGraphFromSchema: duplicate level id '${levelId}'`,
      );
    }

    // Track ancestry to catch cycles before the grid runtime is ever created.
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

    // Each child becomes a child level id by appending its table name.
    // This preserves both uniqueness (for different branches) and a
    // human-readable path (`orders.items`, `orders.items.allocations`, ...).
    for (const child of table.children ?? []) {
      const childLevelId = `${levelId}.${child.table}`;
      childRelations.push({
        childTable: child,
        childLevelId,
      });
      build(childLevelId, child.table, {
        parentLevelId: levelId,
        foreignKey: child.foreignKey,
        defaultSort: child.defaultSort,
      }, nextAncestors);
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

// Root-level query seed config before ownership split.
// Separates URL-synced root defaults from source-owned child defaults.
export type RootLevelQueryConfig = Omit<TGridLevelQueryConfig, "owner"> & {
  initialSort?: readonly SortDescriptor[];
  initialFilters?: readonly FilterCondition[];
  initialSearch?: string | null;
  initialPage?: number;
  pageSize?: number | (() => number);
};

type AnyRowsByLevel = Record<string, Record<string, unknown>>;

// Internal typed alias for the compiler result.
// Keeps generic shapes readable while compiling the graph.
export type BuiltSessionLevelMap = TGridLevelsConfigMap<
  AnyRowsByLevel,
  unknown
>;

// Final compiler output used to initialize a TGrid session.
// Provides the explicit `rootLevel` and fully materialized `levels` map.
export type TGridSessionLevelConfigFromGraph = {
  rootLevel: string;
  levels: BuiltSessionLevelMap;
};

// Compatibility entry point for schema-driven pages.
// Converts `TableGridGraph` into `rootLevel + levels` args for session creation.
export function buildSessionLevelsFromTableGridGraph(
  args: {
    graph: TableGridGraph;
    rootLevelQuery: RootLevelQueryConfig;
    childLevelQuery?: Omit<TGridLevelQueryConfig, "owner">;
  },
): TGridSessionLevelConfigFromGraph {
  const { graph, rootLevelQuery, childLevelQuery } = args;

  const levels: Record<string, TGridLevelConfig<AnyRowsByLevel, unknown>> = {};

  // Convert graph nodes into explicit session levels.
  // Child/parent links and query ownership now live here, not hidden in
  // helper behavior later in runtime config.
  for (const [levelId, level] of Object.entries(graph.levels)) {
    levels[levelId] = {
      table: level.table,
      childLevels: level.children.map((child) => child.childLevelId),
      ...(level.parent
        ? {
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
          : childLevelQuery ?? {}),
      } as TGridLevelQueryConfig,
    };
  }

  return {
    rootLevel: graph.rootLevel,
    levels: levels as BuiltSessionLevelMap,
  };
}
