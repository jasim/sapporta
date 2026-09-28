import type { TableSchema } from "@sapporta/shared/contracts";
import type { GridInteractionConfig } from "@sapporta/grid";
import { defineTGrid, type TGridDefinition } from "./tgrid-runtime-config";
import type {
  TGridLevelQueryConfig,
  TGridLevelsConfigMap,
} from "./tgrid-level-config";
import {
  buildSessionLevelsFromTableGridGraph,
  buildTableGridGraphFromSchema,
  type RootLevelQueryConfig,
} from "./tgrid-schema-compiler";
import type { TGridLevelColumns } from "./tgrid-column-spec";

// Row shape used by schema table grids.
// The exact columns come from the loaded table schema, so each row is a plain
// record keyed by column name.
export type SchemaTableRowsByLevel = Record<string, Record<string, unknown>>;

export type SchemaTableGridSource = {
  rootTableName: string;
  tablesByName: Record<string, TableSchema>;
};

export type SchemaTableRootRowsOptions = RootLevelQueryConfig;
export type SchemaTableRelatedRowsOptions = Omit<
  TGridLevelQueryConfig,
  "owner"
>;

/**
 * The root table's columns in one schema table grid: the spec list or
 * builder callback a `defineTGrid` level's `columns` takes. For example,
 * `(c) => [c.remainingTable({ exclude: ["created_at"] }), c.client("edit", …)]`.
 */
export type SchemaTableColumns<AppServices = unknown> = TGridLevelColumns<
  SchemaTableRowsByLevel,
  AppServices,
  string
>;

export type SchemaTGridConfigInput<AppServices = unknown> = {
  source: SchemaTableGridSource;
  rootRows?: SchemaTableRootRowsOptions;
  relatedRows?: SchemaTableRelatedRowsOptions;
  // The root table's columns in this grid, such as the schema's columns less
  // one a fixed filter holds to one value, plus a client column of row
  // actions. Other views of the table are unchanged. Leave it out to show
  // every visible column in schema order.
  columns?: SchemaTableColumns<AppServices>;
};

export type DefineSchemaTGridArgs = SchemaTGridConfigInput & {
  interaction?: GridInteractionConfig;
};

export function buildSchemaTGridConfig<AppServices = unknown>({
  source,
  rootRows,
  relatedRows,
  columns,
}: SchemaTGridConfigInput<AppServices>): {
  rootLevel: string;
  levels: TGridLevelsConfigMap<SchemaTableRowsByLevel, AppServices>;
} {
  const schemaGraph = buildTableGridGraphFromSchema(source);
  const generated = buildSessionLevelsFromTableGridGraph({
    graph: schemaGraph,
    rootLevelQuery: rootRows ?? {},
    childLevelQuery: relatedRows,
  });
  const levels = generated.levels as TGridLevelsConfigMap<
    SchemaTableRowsByLevel,
    AppServices
  >;
  if (columns) {
    levels[generated.rootLevel].columns = columns;
  }

  return {
    rootLevel: generated.rootLevel,
    levels,
  };
}

export function defineSchemaTGrid({
  interaction,
  ...config
}: DefineSchemaTGridArgs): TGridDefinition<SchemaTableRowsByLevel> {
  return defineTGrid<SchemaTableRowsByLevel>({
    ...buildSchemaTGridConfig(config),
    interaction,
    phantomRows: {},
  });
}
