import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  asc,
  desc,
  and,
  sql,
  type SQL,
  type AnyColumn,
} from "drizzle-orm";
import type {
  CountQuery,
  ExportRowsQuery,
  ListRowsQuery,
  LookupQuery,
} from "@sapporta/shared/contracts";
import { DEFAULT_COUNT_GROUP_LIMIT } from "@sapporta/shared";
import {
  parseBoundedInteger,
  parseOptionalBoundedInteger,
} from "@sapporta/shared/validation";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { SapportaAuthContext } from "../auth/context.js";
import type {
  CountRowsByInput,
  CountRowsInput,
  LookupRowsInput,
  PageRowsInput,
  RowsQuery,
  TableColumn,
} from "../data/scoped-rows.js";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_LOOKUP_LIMIT,
  MAX_PAGE_LIMIT,
} from "../data/scoped-rows.js";
import { findPkColumn } from "../schema/pk.js";
import type { TableDef } from "../schema/table.js";
import { columnBySqlName } from "../schema/column.js";
import { resolveColumnKind } from "../schema/resolve-kind.js";
import { QueryParseError } from "../db/errors.js";
import type { SearchPlan } from "../search/search-plan.js";
import { buildSearchPredicate } from "../search/search-sql.js";
import {
  decodeFilters,
  parseFilters,
  serializeTypedValue,
  FilterParseError,
  TypedFilterParseError,
  type TypedFilterCondition,
  type TypedValue,
} from "@sapporta/shared/filter";

export interface ResolveRowsQueryOptions {
  auth: SapportaAuthContext;
  searchPlan: SearchPlan;
}

export type ResolvedCountQuery<TTable extends AnySQLiteTable = AnySQLiteTable> =
  | {
      kind: "total";
      input: CountRowsInput;
    }
  | {
      kind: "grouped";
      input: CountRowsByInput<TTable>;
    };

const PAGE_QUERY_KEYS = new Set(["page", "limit", "sort", "q"]);
const EXPORT_QUERY_KEYS = new Set(["sort", "q"]);
const COUNT_QUERY_KEYS = new Set(["group_by", "order", "limit"]);

/**
 * Parse query string parameters into Drizzle query parts.
 *
 * Grammar is owned by `@sapporta/shared/filter` — the same `decodeFilters`
 * the UI uses to build the URL also validates it here. This module layers
 * on the server-only concerns: column existence, SQL emission, and
 * pagination and root search policy.
 *
 * Filter grammar (from shared):
 *   eq, neq                         equality / inequality
 *   gt, gte, lt, lte                ordinal
 *   in, nin                         CSV membership (e.g. in=1,2,3)
 *   contains, startswith, endswith  substring match; `%` and `_` in `value`
 *                                   are escaped so they match literally
 *   is                              value must be `null` or `notnull`
 *
 * Top-level (server-only):
 *   q=term                          trimmed search term compiled through the
 *                                   catalog search plan. Empty / whitespace
 *                                   `q` is treated as absent.
 *   sort=col,-col2                  leading `-` is descending
 *   page=N, limit=M                 M ∈ [1, MAX_PAGE_LIMIT]
 *
 * Errors (QueryParseError → HTTP 400):
 *   unknown_filter_shape            filter[col] without [op], etc.
 *   unknown_op                      op not in the supported set
 *   bad_value                       is={other}, in=/nin= empty or empty-item
 *   unknown_column                  filter or sort names a column not on
 *                                   the table
 *   bad_limit, bad_page             non-numeric or out-of-range
 *   no_search_config                q set on a table with search: false
 *
 * Silent-ignore is rejected as a class: typos like filter[naration]=foo
 * return 400, not "all rows".
 */
export function resolvePageQuery<TTable extends AnySQLiteTable>(
  query: ListRowsQuery,
  table: TableDef<TTable>,
  options: ResolveRowsQueryOptions,
): PageRowsInput {
  const filters = extractFilterParams(query, PAGE_QUERY_KEYS, "list");
  const where = parseTableFilters(filters, table);
  const searchTerm = parseSearchTerm(query.q, table);
  return {
    where: resolveSearchWhere(where, searchTerm, table, options),
    orderBy: parseSortClauses(query.sort, table),
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
  };
}

export function resolveExportQuery<TTable extends AnySQLiteTable>(
  query: ExportRowsQuery,
  table: TableDef<TTable>,
  options: ResolveRowsQueryOptions,
): RowsQuery {
  const filters = extractFilterParams(query, EXPORT_QUERY_KEYS, "export");
  const where = parseTableFilters(filters, table);
  const searchTerm = parseSearchTerm(query.q, table);
  return {
    where: resolveSearchWhere(where, searchTerm, table, options),
    orderBy: parseSortClauses(query.sort, table),
  };
}

export function resolveLookupQuery<TTable extends AnySQLiteTable>(
  query: LookupQuery,
  table: TableDef<TTable>,
): LookupRowsInput<TTable> {
  return {
    ids:
      query.ids === undefined
        ? undefined
        : parseLookupIds(query.ids, table, findPkColumn(table).name),
    search: normalizedSearch(query.q),
    fields: resolveLookupFields(table, query.fields),
    limit: parseLookupLimit(query.limit),
  };
}

export function resolveCountQuery<TTable extends AnySQLiteTable>(
  query: CountQuery,
  table: TableDef<TTable>,
): ResolvedCountQuery<TTable> {
  const where = parseTableFilters(
    extractFilterParams(query, COUNT_QUERY_KEYS, "count"),
    table,
  );
  const groupBy = query.group_by;

  if (groupBy === undefined) {
    if (query.order !== undefined || query.limit !== undefined) {
      throw new QueryParseError(
        "bad_value",
        "order and limit require group_by",
      );
    }
    return { kind: "total", input: { where } };
  }

  const column = columnBySqlName(table, groupBy);
  if (!column) {
    throw new QueryParseError(
      "unknown_column",
      `Column "${groupBy}" not found on table "${table.sqlName}"`,
    );
  }

  return {
    kind: "grouped",
    input: {
      where,
      column: column as CountRowsByInput<TTable>["column"],
      order: query.order ?? "desc",
      limit: query.limit ?? DEFAULT_COUNT_GROUP_LIMIT,
    },
  };
}

function resolveSearchWhere(
  where: SQL | undefined,
  searchTerm: string | undefined,
  table: TableDef,
  options: ResolveRowsQueryOptions,
): SQL | undefined {
  if (!searchTerm) return where;
  if (options.searchPlan.table !== table) {
    throw new Error(
      `Search plan for "${options.searchPlan.table.sqlName}" cannot be used with table "${table.sqlName}".`,
    );
  }
  return and(
    where,
    buildSearchPredicate(options.searchPlan, searchTerm, options.auth),
  );
}

function extractFilterParams(
  query: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  surface: string,
): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (allowedKeys.has(key)) continue;
    if (!key.startsWith("filter[")) {
      throw new QueryParseError(
        "bad_value",
        `Unknown ${surface} query parameter ${JSON.stringify(key)}.`,
      );
    }
    if (typeof value !== "string") {
      throw new QueryParseError(
        "bad_value",
        `${surface} filter ${JSON.stringify(key)} must be a string.`,
      );
    }
    filters[key] = value;
  }
  return filters;
}

/**
 * Parse only the canonical `filter[col][op]=value` grammar.
 *
 * List and count reads share this boundary so a filter cannot be accepted
 * by one surface and silently ignored or interpreted differently by another.
 */
function parseTableFilters(
  params: Record<string, string>,
  schema: TableDef,
): SQL | undefined {
  const conditions: SQL[] = [];
  const rawConditions = parseFilterConditions(params);
  const typedConditions = parseFilterConditionsTyped(rawConditions, schema);
  for (const cond of typedConditions) {
    const col = findColumn(schema, cond.column)!;
    conditions.push(buildFilterSql(col, cond));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Delegate grammar parsing to shared, then rewrap its typed error into
 *  this package's `QueryParseError`. The error codes line up exactly, so
 *  the mapping is mechanical. */
function parseFilterConditions(
  params: Record<string, string>,
): ReturnType<typeof decodeFilters> {
  try {
    return decodeFilters(params);
  } catch (err) {
    if (err instanceof FilterParseError) {
      throw new QueryParseError(err.code, err.message);
    }
    throw err;
  }
}

/** Resolve each column's declared `kind` from the Drizzle schema, then
 *  run the typed-boundary parse. Rewraps `TypedFilterParseError` into
 *  `QueryParseError` so the HTTP layer emits a consistent 400. */
function parseFilterConditionsTyped(
  raw: ReturnType<typeof decodeFilters>,
  schema: TableDef,
): TypedFilterCondition[] {
  try {
    return parseFilters(raw, (column) => resolveColumnKind(schema, column));
  } catch (err) {
    if (err instanceof TypedFilterParseError) {
      throw new QueryParseError(err.code, err.message);
    }
    throw err;
  }
}

/** Translate one typed, column-resolved condition into SQL. The switch
 *  is exhaustive on the discriminated union — no op-string lookup needed.
 *  Temporal values are serialized to their canonical TEXT form at this
 *  edge (the factory owns the storage dialect); primitive number/boolean
 *  values pass straight through to Drizzle. */
function buildFilterSql(col: AnyColumn, cond: TypedFilterCondition): SQL {
  switch (cond.op) {
    case "eq":
      return eq(col, bind(cond.value));
    case "neq":
      return ne(col, bind(cond.value));
    case "gt":
      return gt(col, bind(cond.value));
    case "gte":
      return gte(col, bind(cond.value));
    case "lt":
      return lt(col, bind(cond.value));
    case "lte":
      return lte(col, bind(cond.value));
    case "contains":
      return likeWithEscape(col, `%${escapeLike(bindText(cond.value))}%`);
    case "startswith":
      return likeWithEscape(col, `${escapeLike(bindText(cond.value))}%`);
    case "endswith":
      return likeWithEscape(col, `%${escapeLike(bindText(cond.value))}`);
    case "in":
      return inArray(col, cond.values.map(bind));
    case "nin":
      return notInArray(col, cond.values.map(bind));
    case "is":
      return cond.polarity === "null" ? isNull(col) : isNotNull(col);
  }
}

/** Alias for the shared serializer — kept local to read naturally at call
 *  sites (`bind(cond.value)`). Drizzle/SQLite binding lives behind this
 *  boundary; `serializeTypedValue` collapses Temporal objects to their
 *  canonical TEXT form and passes primitives through. */
const bind = serializeTypedValue;

/** `contains`/`startswith`/`endswith` are text-only. The typed parse
 *  rejects them on non-text kinds, so the value here is guaranteed to
 *  be a string — `bindText` asserts that contract. */
function bindText(v: TypedValue): string {
  if (typeof v !== "string") {
    throw new QueryParseError(
      "bad_value",
      `LIKE operand must be a string, got ${typeof v}`,
    );
  }
  return v;
}

function parseSearchTerm(
  rawQ: string | undefined,
  schema: TableDef,
): string | undefined {
  const qTerm = rawQ?.trim();
  if (!qTerm) return undefined;
  if (schema.meta.search === false) {
    throw new QueryParseError(
      "no_search_config",
      `Table \`${schema.sqlName}\` has search disabled`,
    );
  }
  return qTerm;
}

function parseSortClauses(raw: string | undefined, schema: TableDef): SQL[] {
  if (!raw) return [];
  return raw.split(",").map((field) => {
    const descending = field.startsWith("-");
    const colName = descending ? field.slice(1) : field;
    const col = findColumn(schema, colName);
    if (!col) {
      throw new QueryParseError(
        "unknown_column",
        `Unknown sort column "${colName}" on table "${schema.sqlName}"`,
      );
    }
    return descending ? desc(col) : asc(col);
  });
}

function parseLimit(raw: string | undefined): number {
  return parseBoundedInteger(raw, {
    name: "limit",
    min: 1,
    max: MAX_PAGE_LIMIT,
    defaultValue: DEFAULT_PAGE_LIMIT,
    makeError: (message) => new QueryParseError("bad_limit", message),
  });
}

function parsePage(raw: string | undefined): number {
  return parseBoundedInteger(raw, {
    name: "page",
    min: 1,
    defaultValue: DEFAULT_PAGE,
    makeError: (message) => new QueryParseError("bad_page", message),
  });
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLookupIds(
  idsParam: string,
  table: TableDef,
  primaryKeyColumn: string,
): Array<string | number> {
  const ids = parseCommaSeparatedValues(idsParam);
  const kind = resolveColumnKind(table, primaryKeyColumn);
  switch (kind) {
    case "text":
      return ids;
    case "number":
      return ids.map((id) => {
        const value = Number(id);
        if (!Number.isFinite(value)) {
          throw new QueryParseError(
            "bad_value",
            `lookup id for column "${primaryKeyColumn}" must be a finite number, got ${JSON.stringify(id)}`,
          );
        }
        return value;
      });
    case "boolean":
    case "date":
    case "timestamp":
      throw new QueryParseError(
        "bad_value",
        `lookup does not support ${kind} primary keys`,
      );
    case undefined:
      throw new QueryParseError(
        "unknown_column",
        `Column "${primaryKeyColumn}" not found`,
      );
  }
}

function normalizedSearch(search: string | undefined): string | undefined {
  const normalized = search?.trim();
  return normalized ? normalized : undefined;
}

function parseLookupLimit(limitParam: string | undefined): number | undefined {
  return parseOptionalBoundedInteger(limitParam, {
    name: "limit",
    min: 1,
    max: MAX_LOOKUP_LIMIT,
    makeError: (message) => new QueryParseError("bad_limit", message),
  });
}

function resolveLookupFields<TTable extends AnySQLiteTable>(
  table: TableDef<TTable>,
  fieldsParam: string | undefined,
): readonly TableColumn<TTable>[] | undefined {
  if (fieldsParam === undefined) return undefined;
  const fields = Array.from(new Set(parseCommaSeparatedValues(fieldsParam)));
  const columns: SQLiteColumn[] = [];

  for (const field of fields) {
    const column = columnBySqlName(table, field);
    if (!column) {
      throw new QueryParseError(
        "unknown_column",
        `Unknown column(s) in '${table.sqlName}': ${field}`,
      );
    }
    if (table.meta.columns[field]?.visuallyHidden === true) {
      throw new QueryParseError(
        "unknown_column",
        `Lookup field(s) are not visible on table "${table.sqlName}": ${field}`,
      );
    }
    columns.push(column);
  }

  return columns as unknown as readonly TableColumn<TTable>[];
}

// Escape \, %, _ in a user-supplied substring so LIKE treats them literally.
// The caller prepends / appends the % wildcard(s) that drive the actual match.
function escapeLike(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function likeWithEscape(col: AnyColumn, pattern: string): SQL {
  return sql`${col} LIKE ${pattern} ESCAPE '\\'`;
}

function findColumn(schema: TableDef, name: string): AnyColumn | null {
  return columnBySqlName(schema, name);
}

export const tableHttpQuery = Object.freeze({
  page: resolvePageQuery,
  exportRows: resolveExportQuery,
  lookup: resolveLookupQuery,
  count: resolveCountQuery,
});
