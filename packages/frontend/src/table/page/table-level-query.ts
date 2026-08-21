import { useStore } from "zustand";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { TypedFilterCondition } from "@sapporta/shared/filter";
import type { LookupForColumn } from "../../lookup";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "../tgrid/tgrid-types";
import type { TGridSession } from "../tgrid/tgrid-session";
import { requireHostQueryStore } from "./table-query-store";

export type TableLevelQuery = {
  columns: readonly ColumnSchema[];
  filters: readonly TypedFilterCondition[];
  search: string | null;
  searchable: boolean;
  hasSort: boolean;
  activeFilterCount: number;
  lookupForColumn?: LookupForColumn;
  addFilter: (condition: TypedFilterCondition) => void;
  updateFilter: (id: string, patch: TypedFilterCondition) => void;
  removeFilter: (id: string) => void;
  setSearch: (query: string | null) => void;
  clearSort: () => void;
};

export function useTableLevelQuery<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  level?: TGridLevelId<RowsByLevel>,
): TableLevelQuery {
  const levelId = level ?? session.rootLevel;
  const table = session.levels[levelId].table;
  const store = requireHostQueryStore(session, levelId, "useTableLevelQuery");
  const filters = useStore(store, (state) => state.filters);
  const search = useStore(store, (state) => state.search);
  const hasSort = useStore(store, (state) => state.sort.length > 0);

  return {
    columns: table.columns,
    filters,
    search,
    searchable: table.searchable,
    hasSort,
    activeFilterCount: filters.length,
    lookupForColumn: session.lookupForColumn,
    addFilter: (condition) => store.getState().addFilter(condition),
    updateFilter: (id, patch) => store.getState().updateFilter(id, patch),
    removeFilter: (id) => store.getState().removeFilter(id),
    setSearch: (query) => store.getState().setSearch(query),
    clearSort: () => store.getState().clearSort(),
  };
}
