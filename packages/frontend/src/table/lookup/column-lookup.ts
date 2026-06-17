import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { TableLookupRegistry } from "./table-lookup-registry";

export type LookupForColumn = (args: {
  tableName: string;
  column: ColumnSchema;
}) => LookupCapabilities | undefined;

export type ColumnLookupResolver = {
  lookupForColumn: LookupForColumn;
};

export function createColumnLookupResolver(
  registry: TableLookupRegistry,
): ColumnLookupResolver {
  return {
    lookupForColumn({ tableName, column }) {
      const bundle = registry.bundleFor({ sourceTable: tableName, column });
      if (!bundle) return undefined;
      return {
        valueLookup: bundle.valueLookup,
        searchLookup: bundle.searchLookup,
      };
    },
  };
}
