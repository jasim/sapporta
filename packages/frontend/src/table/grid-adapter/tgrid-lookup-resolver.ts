import type { TableLookupRegistry } from "@/table/lookup/table-lookup-registry";
import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import type { TableForeignKeyLookupBundle } from "@/table/lookup/table-lookup-registry";

export type TGridLookupResolver = {
  bundleFor(args: {
    tableName: string;
    column: TableColumnSchema;
  }): TableForeignKeyLookupBundle | undefined;
};

export function createTGridLookupResolver(
  lookupRegistry: TableLookupRegistry,
): TGridLookupResolver {
  return {
    bundleFor({ tableName, column }) {
      return lookupRegistry.bundleFor({ sourceTable: tableName, column });
    },
  };
}
