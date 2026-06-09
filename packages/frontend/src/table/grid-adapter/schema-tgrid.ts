import type { TableSchema } from "@sapporta/shared/contracts";
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

// Row shape used by schema-driven tables.
// The exact columns come from the loaded table schema, so each row is a plain
// record keyed by column name.
export type SchemaDrivenRowsByLevel = Record<string, Record<string, unknown>>;

// Inputs for building a table grid directly from Sapporta table schemas.
// Use this when a custom page wants the same columns, child rows, and default
// row transport as the built-in table page, with optional query defaults.
export type SchemaTGridConfigInput = {
  rootTableName: string;
  tablesByName: Record<string, TableSchema>;
  rootLevelQuery?: RootLevelQueryConfig;
  childLevelQuery?: Omit<TGridLevelQueryConfig, "owner">;
};

// Build the level map for a schema-driven table without creating a definition
// yet. This is the customization point for pages that want schema-derived
// levels but need to override columns, editors, renderers, row clients, or
// services before calling `defineTGrid`.
export function buildSchemaTGridConfig({
  rootTableName,
  tablesByName,
  rootLevelQuery,
  childLevelQuery,
}: SchemaTGridConfigInput): {
  rootLevel: string;
  levels: TGridLevelsConfigMap<SchemaDrivenRowsByLevel, unknown>;
} {
  const config = buildSessionLevelsFromTableGridGraph({
    graph: buildTableGridGraphFromSchema({
      rootTableName,
      tablesByName,
    }),
    rootLevelQuery: rootLevelQuery ?? {},
    childLevelQuery,
  });
  const levels = config.levels as TGridLevelsConfigMap<
    SchemaDrivenRowsByLevel,
    unknown
  >;

  return {
    rootLevel: config.rootLevel,
    levels,
  };
}

// Define the standard schema-driven table grid.
// This is the shortest path for pages that want the default Sapporta table UI.
export function defineSchemaTGrid(
  args: SchemaTGridConfigInput,
): TGridDefinition<SchemaDrivenRowsByLevel, unknown> {
  return defineTGrid<SchemaDrivenRowsByLevel>(buildSchemaTGridConfig(args));
}
