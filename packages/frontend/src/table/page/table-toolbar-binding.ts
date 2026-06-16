import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { FilterCondition } from "@sapporta/shared/filter";
import type {
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "@/table/grid-adapter/tgrid-types";
import type { TGridLevelQueryState } from "@/table/state/tgrid-level-query-state";
import type { TGridSession } from "@/table/state/tgrid-session";
import type { TableToolbarProps } from "./TableToolbar";

// Inputs needed to drive the standard table toolbar from a live grid session.
// Pass `filters` only when the page wants to show a subset of the active query
// as user-editable; the session still keeps the full query.
export type UseTableToolbarPropsArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  table: TableSchema;
  totalCount: number;
  level?: TGridLevelId<RowsByLevel>;
  filters?: readonly FilterCondition[];
  onNewRecord?: () => void;
};

// Convert the table's current query state into plain props for `TableToolbar`.
// Custom toolbars can call this hook and then render the pieces they want.
export function useTableToolbarProps<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  session,
  table,
  totalCount,
  level,
  filters,
  onNewRecord,
}: UseTableToolbarPropsArgs<RowsByLevel, AppServices>): TableToolbarProps {
  const levelId = level ?? session.rootLevel;
  const store = requireHostQueryStore(session, levelId, "useTableToolbarProps");
  const sort = useStore(store, (state) => state.sort);
  const activeFilters = useStore(store, (state) => state.filters);
  const search = useStore(store, (state) => state.search);
  const onAddFilter = (
    condition: Parameters<TableToolbarProps["onAddFilter"]>[0],
  ) => store.getState().addFilter(condition);
  const onUpdateFilter: TableToolbarProps["onUpdateFilter"] = (id, patch) =>
    store.getState().updateFilter(id, patch);
  const onRemoveFilter: TableToolbarProps["onRemoveFilter"] = (id) =>
    store.getState().removeFilter(id);

  return {
    session,
    tableName: table.name,
    tableLabel: table.label ?? table.name,
    totalCount,
    columns: table.columns,
    filters: filters ?? activeFilters,
    search,
    searchable: (table.search?.columns.length ?? 0) > 0,
    exportUrl: session.csvExportUrl(levelId),
    hasSort: sort.length > 0,
    onAddFilter,
    onUpdateFilter,
    onRemoveFilter,
    onSearchChange: (query) => store.getState().setSearch(query),
    onClearSort: () => store.getState().clearSort(),
    onNewRecord,
    lookupForColumn: session.lookupForColumn,
  };
}

// Toolbar and pagination controls need a level whose query is controlled by the
// page. Source-owned child levels load from expansion context instead, so they
// do not have a toolbar-style query store.
export function requireHostQueryStore<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  level: TGridLevelId<RowsByLevel>,
  caller: string,
): StoreApi<TGridLevelQueryState<TGridTableRow>> {
  const store = session.levels[level].queryStore as
    | StoreApi<TGridLevelQueryState<TGridTableRow>>
    | undefined;
  if (!store) {
    throw new Error(
      `${caller}: level '${String(level)}' does not have host-owned query state`,
    );
  }
  return store;
}
