import type { SortDescriptor } from "@sapporta/grid";
import type { TypedFilterCondition } from "@sapporta/shared/filter";
import type { TGridFilter } from "../grid-adapter/tgrid-filter";
import type { TGridTableRow } from "../grid-adapter/tgrid-types";

// Query values supplied by the current route. Omitted fields keep the level's
// configured defaults; present empty arrays/nulls intentionally clear defaults.
export type TGridRouteQuerySeed = Partial<{
  page: number;
  sort: readonly SortDescriptor[];
  filters: readonly TypedFilterCondition[];
  search: string | null;
}>;

export type TGridLevelQueryState<
  RowShape extends TGridTableRow = TGridTableRow,
> = {
  level: string;
  sort: SortDescriptor[];
  filters: TypedFilterCondition[];
  search: string | null;
  page: number;
  pageSize: number;
  totalCount: number | null;
  errorBanner: string | null;

  // Source-facing setters. These mutate query state and return whether the
  // effective query changed. They do not load rows, push URLs, or update focus.
  // Table controls should call the command methods below, or session-level
  // source commands when they know the concrete GridPath.
  setSortState: (sort: SortDescriptor[]) => "changed" | "unchanged";
  setFilterState: (filter: TGridFilter | undefined) => "changed" | "unchanged";
  setPageState: (page: number, pageSize: number) => "changed" | "unchanged";
  setTotalCount: (totalCount: number | null) => void;

  // UI-facing commands for root-level table controls. These commands route
  // through the source and then sync application-visible state such as the URL.
  setSort: (sort: SortDescriptor[]) => void;
  clearSort: () => void;
  addFilter: (cond: TypedFilterCondition) => void;
  updateFilter: (id: string, patch: TypedFilterCondition) => void;
  removeFilter: (id: string) => void;
  clearFilters: () => void;
  setSearch: (q: string | null) => void;
  setFilter: (filter: TGridFilter | undefined) => void;
  setPage: (page: number) => void;
  setErrorBanner: (msg: string | null) => void;

  syncFromUrl: (seed: TGridRouteQuerySeed) => void;
};

export type TGridQueryState<RowShape extends TGridTableRow = TGridTableRow> =
  TGridLevelQueryState<RowShape>;
