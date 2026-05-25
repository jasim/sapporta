import {
  decodeFilters,
  encodeFilters,
  eqCondition,
  type FilterCondition,
} from "@sapporta/shared/filter";
import type { ColId, SortDescriptor } from "@sapporta/grid";
import { parseSortString, stringifySortOrder } from "@sapporta/grid";

export interface TableUrlState {
  page: number;
  // undefined = URL is silent about sort (defer to persisted/default).
  // [] = explicit "no sort" (wins over persisted).
  // non-empty = explicit sort (wins over persisted).
  sort: SortDescriptor[] | undefined;
  filters: FilterCondition[];
  search: string | null;
}

export function buildTableSearchParams(state: TableUrlState): URLSearchParams {
  const params = encodeFilters(state.filters);

  if (state.page > 1) {
    params.set("page", String(state.page));
  }

  const sortStr =
    state.sort === undefined ? null : stringifySortOrder(state.sort);
  if (sortStr) {
    params.set("sort", sortStr);
  }

  if (state.search) {
    params.set("q", state.search);
  }

  return params;
}

/**
 * URL for a table view pre-filtered by column equalities. Used by FK drill-up,
 * master->children drill-down, and report `kind: "table"` links.
 */
export function tableFilteredByUrl(
  table: string,
  column: string,
  value: unknown,
): string;
export function tableFilteredByUrl(
  table: string,
  filters: Record<string, unknown>,
): string;
export function tableFilteredByUrl(
  table: string,
  columnOrFilters: string | Record<string, unknown>,
  value?: unknown,
): string {
  const entries =
    typeof columnOrFilters === "string"
      ? [[columnOrFilters, value] as const]
      : Object.entries(columnOrFilters);
  const conditions: FilterCondition[] = entries.map(([col, v]) =>
    eqCondition(col, String(v)),
  );
  const params = buildTableSearchParams({
    page: 1,
    sort: undefined,
    filters: conditions,
    search: null,
  });
  return `/tables/${table}?${params.toString()}`;
}

export function parseTableSearchParams(
  searchParams: URLSearchParams,
  validColIds: ReadonlySet<ColId>,
): TableUrlState {
  const pageStr = searchParams.get("page");
  const page = pageStr ? Math.max(1, parseInt(pageStr, 10) || 1) : 1;

  // `has("sort")` distinguishes URL-silent (undefined) from explicit empty
  // (`?sort=` -> []). Downstream layers use this to decide whether the URL
  // overrides a persisted preference or defers to it.
  const sort = searchParams.has("sort")
    ? parseSortString(searchParams.get("sort"), validColIds)
    : undefined;

  // `q=` or `q=<whitespace>` round-trip to null so the controller's
  // equality guard stays correct after a clear-input -> URL-push -> parse.
  const qRaw = searchParams.get("q");
  const search = qRaw && qRaw.trim() !== "" ? qRaw : null;

  const filters = decodeFilters(searchParams);

  return { page, sort, filters, search };
}
