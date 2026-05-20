import type { TableHandle } from "@/table/state/table-state";
import { startLoadingValueLookupEntriesForGridRows } from "@/lookup/cache/grid-row-loader";
import { tableGridThemeColumnMeta } from "@/table/grid-adapter/table-grid-theme";

// Returns a teardown function. Caller wires this to `useEffect` cleanup so
// long-lived subscriptions stop when the page unmounts.
export function startTableLookupLoading(handle: TableHandle): () => void {
  return startLoadingValueLookupEntriesForGridRows({
    runtime: handle.runtime,
    lookupColumnsForGridPath: (path) => {
      const level = handle.runtime.schemaAt(path);
      const levelMeta = handle.levelMetaById[level.name];
      if (!levelMeta) return [];

      return level.columns.flatMap((gridColumn) => {
        const tableColumn = tableGridThemeColumnMeta(gridColumn)?.schema;
        if (!tableColumn?.foreignKey) return [];

        const bundle = handle.lookupRegistry.bundleFor({
          sourceTable: levelMeta.tableName,
          column: tableColumn,
        });
        if (!bundle) return [];

        return [{ colId: gridColumn.id, valueLookup: bundle.valueLookup }];
      });
    },
  });
}
