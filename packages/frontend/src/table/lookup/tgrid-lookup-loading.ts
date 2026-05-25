import type { TGridSession } from "@/table/state/tgrid-session";
import type { TGridRowsByLevel } from "@/table/grid-adapter/tgrid-types";
import { startLoadingValueLookupEntriesForGridRows } from "@sapporta/grid/lookup";

// Returns a teardown function. Caller wires this to `useEffect` cleanup so
// long-lived subscriptions stop when the page unmounts.
export function startTGridLookupLoading<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(session: TGridSession<RowsByLevel, AppServices>): () => void {
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
