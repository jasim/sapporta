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
  or,
  sql,
  type SQL,
  type AnyColumn,
} from "drizzle-orm";
import type { TableDef } from "../schema/table.js";
import { resolveColumnKind } from "../schema/resolve-kind.js";
import { QueryParseError } from "../db/errors.js";
import { parseBoundedInteger } from "@sapporta/shared/validation";
import {
  decodeFilters,
  parseFilters,
  serializeTypedValue,
  FilterParseError,
  TypedFilterParseError,
  type TypedFilterCondition,
  type TypedValue,
} from "@sapporta/shared/filter";

export interface ParsedQuery {
  where: SQL | undefined;
  orderBy: SQL[];
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

/**
 * Parse query string parameters into Drizzle query parts.
 *
 * Grammar is owned by `@sapporta/shared/filter` — the same `decodeFilters`
 * the UI uses to build the URL also validates it here. This module layers
 * on the server-only concerns: column existence, SQL emission, and
 * pagination/search policy.
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
 *   q=term                          OR LIKE across meta.search.columns,
 *                                   AND-ed with filters. Empty / whitespace
 *                                   `q` is treated as absent.
 *   sort=col,-col2                  leading `-` is descending
 *   page=N, limit=M                 M ∈ [1, MAX_LIMIT]
 *
 * Errors (QueryParseError → HTTP 400):
 *   unknown_filter_shape            filter[col] without [op], etc.
 *   unknown_op                      op not in the supported set
 *   bad_value                       is={other}, in=/nin= empty or empty-item
 *   unknown_column                  filter or sort names a column not on
 *                                   the table
 *   bad_limit, bad_page             non-numeric or out-of-range
 *   no_search_config                q set on a table with no meta.search
 *   unknown_search_column           meta.search references a missing column
 *
 * Silent-ignore is rejected as a class: typos like filter[naration]=foo
 * return 400, not "all rows".
 */
export function parseQuery(
  params: Record<string, string>,
  schema: TableDef,
): ParsedQuery {
  const conditions: SQL[] = [];

  const limit = parseLimit(params.limit);
  const page = parsePage(params.page);
  const offset = (page - 1) * limit;

  // Grammar parse → typed-boundary parse → SQL. The typed parse owns
  // column existence (via `resolveColumnKind` returning undefined),
  // operator applicability, and value parsing per declared `kind`.
  const rawConditions = parseFilterConditions(params);
  const typedConditions = parseFilterConditionsTyped(rawConditions, schema);
  for (const cond of typedConditions) {
    const col = findColumn(schema, cond.column)!;
    conditions.push(buildFilterSql(col, cond));
  }

  const qClause = buildSearchSql(params.q, schema);
  if (qClause) conditions.push(qClause);

  return {
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: parseSortClauses(params.sort, schema),
    limit,
    offset,
  };
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

function buildSearchSql(
  rawQ: string | undefined,
  schema: TableDef,
): SQL | null {
  const qTerm = rawQ?.trim();
  if (!qTerm) return null;
  const searchCols = schema.meta.search?.columns;
  if (!searchCols || searchCols.length === 0) {
    throw new QueryParseError(
      "no_search_config",
      `Table \`${schema.sqlName}\` has no search columns configured`,
    );
  }
  const likeParts: SQL[] = [];
  for (const colName of searchCols) {
    const col = findColumn(schema, colName);
    if (!col) {
      throw new QueryParseError(
        "unknown_search_column",
        `Search column \`${colName}\` does not exist on table \`${schema.sqlName}\``,
      );
    }
    likeParts.push(like(col, `%${qTerm}%`));
  }
  return likeParts.length === 1 ? likeParts[0] : or(...likeParts)!;
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
    max: MAX_LIMIT,
    defaultValue: DEFAULT_LIMIT,
    makeError: (message) => new QueryParseError("bad_limit", message),
  });
}

function parsePage(raw: string | undefined): number {
  return parseBoundedInteger(raw, {
    name: "page",
    min: 1,
    defaultValue: 1,
    makeError: (message) => new QueryParseError("bad_page", message),
  });
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
  const cols = schema.drizzle as unknown as Record<string, AnyColumn>;
  return cols[name] ?? null;
}
