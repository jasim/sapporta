import type { TGridSession } from "@/table/state/tgrid-session";
import type { TGridRowsByLevel } from "@/table/grid-adapter/tgrid-types";
import { startLoadingValueLookupEntriesForGridRows } from "@sapporta/grid/lookup";
import { lookupCapabilities, preset } from "@sapporta/grid/column-preset";

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

      return level.columns.flatMap((gridColumn) => {
        const columnPreset = preset(gridColumn);
        const valueLookup = columnPreset
          ? lookupCapabilities(columnPreset)?.valueLookup
          : undefined;
        if (!valueLookup) return [];

        return [{ colId: gridColumn.id, valueLookup }];
      });
    },
  });
}
