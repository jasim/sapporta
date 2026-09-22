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
import type { TableColumnName } from "./tgrid-types";

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

export type SchemaTGridConfigInput = {
  source: SchemaTableGridSource;
  rootRows?: SchemaTableRootRowsOptions;
  relatedRows?: SchemaTableRelatedRowsOptions;
  // Root table columns this grid does not show, such as a column a fixed
  // filter holds to one value. Other views of the table still show them.
  hiddenColumns?: readonly TableColumnName[];
};

export type DefineSchemaTGridArgs = SchemaTGridConfigInput & {
  interaction?: GridInteractionConfig;
};

export function buildSchemaTGridConfig<AppServices = unknown>({
  source,
  rootRows,
  relatedRows,
  hiddenColumns,
}: SchemaTGridConfigInput): {
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

  if (hiddenColumns && hiddenColumns.length > 0) {
    const rootTable = levels[generated.rootLevel].table;
    for (const columnName of hiddenColumns) {
      if (!rootTable.columns.some((column) => column.name === columnName)) {
        throw new Error(
          `buildSchemaTGridConfig: table '${rootTable.name}' has no column '${columnName}' to hide`,
        );
      }
    }
    // The ordinary table columns, less the hidden ones, in schema order.
    levels[generated.rootLevel].columns = [
      { kind: "remainingTable", exclude: hiddenColumns },
    ];
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
