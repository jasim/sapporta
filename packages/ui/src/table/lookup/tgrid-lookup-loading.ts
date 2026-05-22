import type { TGridSession } from "@/table/state/tgrid-session";
import { startLoadingValueLookupEntriesForGridRows } from "@/lookup/cache/grid-row-loader";

// Returns a teardown function. Caller wires this to `useEffect` cleanup so
// long-lived subscriptions stop when the page unmounts.
export function startTGridLookupLoading(session: TGridSession): () => void {
  return startLoadingValueLookupEntriesForGridRows({
    runtime: session.runtime,
    lookupColumnsForGridPath: (path) => {
      const level = session.runtime.schemaAt(path);
      const levelInfo = session.levelInfoById[level.name];
      if (!levelInfo) return [];

      return level.columns.flatMap((gridColumn) => {
        const tableColumn = session.columnMapper.metaOf(gridColumn)?.schema;
        if (!tableColumn?.foreignKey) return [];

        const bundle = session.lookupRegistry.bundleFor({
          sourceTable: levelInfo.tableName,
          column: tableColumn,
        });
        if (!bundle) return [];

        return [{ colId: gridColumn.id, valueLookup: bundle.valueLookup }];
      });
    },
  });
}
