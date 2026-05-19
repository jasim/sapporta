/**
 * Pure functions for converting between URL search params and table/report state.
 */

import {
  parseSortString,
  stringifySortOrder,
} from "../lib/sort";
import type { ColId, SortDescriptor } from "@/grid";
import {
  encodeFilters,
  decodeFilters,
  eqCondition,
  type FilterCondition,
} from "@sapporta/shared/filter";
import { dateRangeFieldNames } from "@sapporta/shared";
import type { ReportParam } from "@sapporta/shared/contracts";
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
 * master→children drill-down, and report `kind: "table"` links.
 *
 * Two forms share one builder so the URL shape stays consistent:
 *   tableFilteredByUrl("accounts", "id", 42)
 *   tableFilteredByUrl("accounts", { parent_id: 7, type: "Asset" })
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
  // (`?sort=` → []). Downstream layers use this to decide whether the URL
  // overrides a persisted preference or defers to it.
  const sort = searchParams.has("sort")
    ? parseSortString(searchParams.get("sort"), validColIds)
    : undefined;

  // `q=` or `q=<whitespace>` round-trip to null so the controller's
  // equality guard (search === params.search) stays correct after a
  // clear-input → URL-push → URL-parse cycle.
  const qRaw = searchParams.get("q");
  const search = qRaw && qRaw.trim() !== "" ? qRaw : null;

  const filters = decodeFilters(searchParams);

  return { page, sort, filters, search };
}

// ── Report URL helpers ──

export function buildReportSearchParams(
  values: Record<string, string>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) {
    if (val) {
      params.set(key, val);
    }
  }
  return params;
}

/**
 * Report URLs stay in the flat wire shape. Dateranges therefore read/write the
 * three companion keys (`<name>_relative`, `<name>_from`, `<name>_to`) rather
 * than a nested object.
 */
export function parseReportSearchParams(
  searchParams: URLSearchParams,
  params: ReportParam[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const param of params) {
    if (param.type === "daterange") {
      const names = dateRangeFieldNames(param.name);
      for (const key of [names.relative, names.from, names.to]) {
        const value = searchParams.get(key);
        if (value !== null) result[key] = value;
      }
      continue;
    }

    const value = searchParams.get(param.name);
    if (value !== null) result[param.name] = value;
  }

  return result;
}

/** URL for a report view with pre-populated params. */
export function reportUrlWithParams(
  reportName: string,
  values: Record<string, string>,
): string {
  const params = buildReportSearchParams(values);
  return `/reports/${reportName}?${params.toString()}`;
}
