import {
  decodeFilters,
  encodeTypedFilters,
  encodeFilters,
  eqCondition,
  parseFiltersForTable,
  mintFilterId,
  type FilterCondition,
  type TypedFilterCondition,
} from "@sapporta/shared/filter";
import { parseBoundedInteger } from "@sapporta/shared/validation";
import type { ColId, SortDescriptor } from "@sapporta/grid";
import { parseSortString, stringifySortOrder } from "@sapporta/grid";
import type { ColumnSchema } from "@sapporta/shared/contracts";

export interface TableUrlState {
  page: number;
  // undefined = URL is silent about sort (defer to persisted/default).
  // [] = explicit "no sort" (wins over persisted).
  // non-empty = explicit sort (wins over persisted).
  sort: SortDescriptor[] | undefined;
  filters: TypedFilterCondition[];
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

export function buildTableSearchParams(state: {
  page: number;
  sort: SortDescriptor[] | undefined;
  filters: readonly TypedFilterCondition[];
  search: string | null;
}): URLSearchParams {
  const params = encodeTypedFilters(state.filters);

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
  const params = encodeFilters(conditions);
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
  const params = encodeFilters([eqCondition(foreignKey, parentRowId)]);
  const queryString = params.toString();
  return `${routePath}${queryString ? `?${queryString}` : ""}`;
}

export function parseTableSearchParams(
  searchParams: URLSearchParams,
  columns: readonly ColumnSchema[],
): TableUrlState {
  const validColIds: ReadonlySet<ColId> = new Set(
    columns.map((column) => column.name as ColId),
  );
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

  const rawFilters = normalizeForeignKeyScalarFilters(
    decodeFilters(searchParams),
    columns,
  );
  const filters = parseFiltersForTable(rawFilters, { columns });

  return { page, sort, filters, search };
}

export function normalizeForeignKeyScalarFilters(
  filters: FilterCondition[],
  columns: readonly ColumnSchema[] | undefined,
): FilterCondition[] {
  if (!columns) return filters;

  const foreignKeyColumns = new Set(
    columns.filter((column) => column.foreignKey).map((column) => column.name),
  );
  if (foreignKeyColumns.size === 0) return filters;

  let changed = false;
  const normalized = filters.map((condition): FilterCondition => {
    if (!foreignKeyColumns.has(condition.column)) return condition;

    if (condition.op === "eq") {
      changed = true;
      return {
        id: mintFilterId(condition.column, "in"),
        column: condition.column,
        op: "in",
        values: [condition.value],
      };
    }

    if (condition.op === "neq") {
      changed = true;
      return {
        id: mintFilterId(condition.column, "nin"),
        column: condition.column,
        op: "nin",
        values: [condition.value],
      };
    }

    return condition;
  });

  return changed ? normalized : filters;
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
