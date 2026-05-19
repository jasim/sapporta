import type { NewTableHandle } from "./new-table-state";
import { startLoadingValueLookupEntriesForGridRows } from "../../modules/lookup-cache/grid-row-loader";
import { tableGridThemeColumnMeta } from "./table-grid-theme";

// Returns a teardown function. Caller wires this to `useEffect` cleanup so
// long-lived subscriptions stop when the page unmounts.
export function startTableLookupLoading(handle: NewTableHandle): () => void {
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
