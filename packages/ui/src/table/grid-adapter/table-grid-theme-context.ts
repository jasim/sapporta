import type { TableGridThemeContext } from "./table-grid-theme";
import type { TableLookupRegistry } from "@/table/lookup/table-lookup-registry";

export function createTableGridThemeContext(
  lookupRegistry: TableLookupRegistry,
): TableGridThemeContext {
  return {
    lookupBundleFor: ({ tableName, column }) =>
      lookupRegistry.bundleFor({ sourceTable: tableName, column }),
  };
}
