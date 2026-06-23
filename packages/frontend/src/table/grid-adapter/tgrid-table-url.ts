import {
  decodeFilters,
  encodeFilters,
  eqCondition,
  type FilterCondition,
} from "@sapporta/shared/filter";
import { parseBoundedInteger } from "@sapporta/shared/validation";
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

// localStorage can outlive table schema changes, so persisted sort preferences
// are treated as best-effort UI state rather than invalid query input.
// Keeps only valid, unique sort descriptors for columns in the current table.
export function sanitizeSortDescriptors(
  value: readonly unknown[],
  validColIds: ReadonlySet<ColId>,
): SortDescriptor[] {
  const clean: SortDescriptor[] = [];
  const seen = new Set<ColId>();

  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const colIdValue = "colId" in item ? item.colId : null;
    const direction = "direction" in item ? item.direction : null;
    if (typeof colIdValue !== "string") continue;
    if (direction !== "asc" && direction !== "desc") continue;
    if (!validColIds.has(colIdValue as ColId)) continue;

    const colId = colIdValue as ColId;
    if (seen.has(colId)) continue;
    seen.add(colId);
    clean.push({ colId, direction });
  }

  return clean;
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

export type RelatedRowsTableHrefInput = {
  tableName: string;
  foreignKey: string;
  parentRowId: string;
  routePath?: string;
};

export function relatedRowsTableHref({
  tableName,
  foreignKey,
  parentRowId,
  routePath = `/tables/${tableName}`,
}: RelatedRowsTableHrefInput): string {
  const params = buildTableSearchParams({
    page: 1,
    sort: undefined,
    filters: [eqCondition(foreignKey, parentRowId)],
    search: null,
  });
  const queryString = params.toString();
  return `${routePath}${queryString ? `?${queryString}` : ""}`;
}

export function parseTableSearchParams(
  searchParams: URLSearchParams,
  validColIds: ReadonlySet<ColId>,
): TableUrlState {
  const page = parseTablePage(searchParams.get("page"));

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

function parseTablePage(raw: string | null): number {
  try {
    return parseBoundedInteger(raw ?? undefined, {
      name: "page",
      min: 1,
      defaultValue: 1,
      makeError: (message) => new Error(message),
    });
  } catch {
    return 1;
  }
}
