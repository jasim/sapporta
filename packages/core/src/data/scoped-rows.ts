/**
 * Row-scoped table operations for generated routes and ordinary product code.
 *
 * `scopedRows(db, auth, table)` is Sapporta's default table API after a request
 * has an auth context. The principal may be signed in or anonymous; row access
 * comes from `auth.dataAuthority`, not from assuming there is always a
 * workspace user. The helper binds one Drizzle table to the request's
 * row-security policy, then exposes CRUD, lookup, count, and export operations
 * that never let callers choose or bypass ownership columns.
 *
 * The important rule is that primary keys and API payloads are not security
 * boundaries. Reads and destructive writes add the table's workspace/user
 * visibility predicate in SQL. Creates and updates first reject API-supplied
 * ownership fields, then stamp trusted scope values from request data
 * authority. Prepared creates and patches then pass through `savePipeline()`;
 * callers of `scopedRows()` receive the same structural parsing and application
 * validation as generated HTTP routes and master-detail writes.
 *
 * The row-security module builds that request-bound policy with
 * `createRowSecurity()`, exposed on `SapportaAuthContext` as `RowSecurity`.
 * `RowSecurity.forTable(table)` returns the per-table helpers used here:
 * `ownedRows()` produces the SQL condition that limits reads, updates, and
 * deletes to rows visible to the current request; `insertValues()` and
 * `patchValues()` prepare safe write objects by preserving API-writable fields,
 * rejecting forbidden ownership fields, and adding server-trusted workspace/user
 * values where the table scope requires them.
 *
 * This file intentionally stays below HTTP concerns. Route handlers translate
 * these domain errors into responses; this module only parses table queries,
 * applies row visibility, performs persistence, and returns plain row objects.
 */

import { asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { RowId } from "@sapporta/shared/row-id";
import type { SapportaAuthContext } from "../auth/context.js";
import { QueryParseError, ValidationError } from "../db/errors.js";
import { parseOptionalBoundedInteger } from "@sapporta/shared/validation";
import { findPkColumn } from "../schema/pk.js";
import { resolveColumnKind } from "../schema/resolve-kind.js";
import type { TableDef } from "../schema/table.js";
import { savePipeline } from "./save-pipeline.js";
import { parseQuery, type ParsedQuery } from "./query-parser.js";
import { rowLabeller } from "./row-label.js";
import { resolveRowFields, UnknownRowFieldsError } from "./row-fields.js";
import type { LookupEntry } from "@sapporta/shared/contracts";

export interface ListRowsInput {
  [key: string]: string | undefined;
}

export interface ListRowsResult {
  data: Record<string, unknown>[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface ScopedRows {
  list(query?: ListRowsInput): Promise<ListRowsResult>;
  get(id: RowId): Promise<Record<string, unknown>>;
  create(
    input: unknown,
  ): Promise<Record<string, unknown> | Record<string, unknown>[]>;
  update(id: RowId, patch: unknown): Promise<Record<string, unknown>>;
  delete(id: RowId): Promise<Record<string, unknown>>;
  exportRows(query?: ListRowsInput): Promise<Record<string, unknown>[]>;
  lookup(query?: ListRowsInput): Promise<LookupEntry[]>;
  count(query?: ListRowsInput): Promise<Record<string, number>>;
}

export class ImmutableTableOperationError extends Error {
  constructor(tableName: string) {
    super(`Records in table "${tableName}" are immutable.`);
    this.name = "ImmutableTableOperationError";
  }
}

export class RowNotFoundError extends Error {
  constructor() {
    super("Row not found.");
    this.name = "RowNotFoundError";
  }
}

type OrderClause = SQL | SQLiteColumn;
type OffsettableRowsQuery = {
  offset(offset: number): PromiseLike<unknown>;
};
type LimitedRowsQuery = {
  limit(limit: number): OffsettableRowsQuery;
};
type OrderedRowsQuery = LimitedRowsQuery & PromiseLike<unknown>;
type OrderableRowsQuery = {
  orderBy(...clauses: OrderClause[]): OrderedRowsQuery;
};

export function scopedRows(
  db: BetterSQLite3Database,
  auth: SapportaAuthContext,
  table: TableDef,
): ScopedRows {
  // Resolve the request-bound access policy once so every operation below uses
  // the same table metadata, workspace, user, and row-scope interpretation.
  const access = auth.rowSecurity.forTable(table);
  const pk = resolvePk(table);
  const publicRow = resolveRowFields(
    table,
    getTableConfig(table.drizzle).columns.map((column) => column.name),
  );

  return {
    async list(input = {}) {
      // Parse filtering/search/sort/pagination first, then wrap the parsed
      // predicate in row ownership before using it for both rows and totals.
      const query = parseRowsQuery(input, table);
      const where = access.ownedRows(query.where);
      const total = await countRows(db, table, where);
      const rows = (await applyOrderBy(
        db.select().from(table.drizzle).where(where),
        query,
        table,
        pk.drizzlePk,
      )
        .limit(query.limit)
        .offset(query.offset)) as Record<string, unknown>[];

      return {
        data: rows.map((row) => publicRow.pick(row)),
        meta: {
          total,
          page: Math.floor(query.offset / query.limit) + 1,
          limit: query.limit,
          pages: Math.ceil(total / query.limit),
        },
      };
    },

    async get(id) {
      // A primary-key hit only counts when the row is visible to this request.
      const rows = (await db
        .select()
        .from(table.drizzle)
        .where(access.ownedRows(eq(pk.drizzlePk, id)))
        .limit(1)) as Record<string, unknown>[];
      if (rows.length === 0) throw new RowNotFoundError();
      return publicRow.pick(rows[0]!);
    },

    async create(input) {
      // Accept either a single API payload or a batch, but prepare each row
      // independently so row-security can stamp trusted scope fields.
      const records = Array.isArray(input) ? input : [input];
      if (records.length === 0) {
        throw new ValidationError([
          { field: "body", message: "Expected at least one row" },
        ]);
      }
      const results: Record<string, unknown>[] = [];
      for (const record of records) {
        const prepared = await access.insertValues(db, record);
        results.push(
          (await savePipeline(table, db, prepared)) as Record<string, unknown>,
        );
      }
      return Array.isArray(input) ? results : results[0]!;
    },

    async update(id, patch) {
      // Immutable tables may still be readable, but generated mutation paths
      // stop here before preparing or persisting the patch.
      if (table.meta.immutable) {
        throw new ImmutableTableOperationError(table.sqlName);
      }
      const preparedPatch = await access.patchValues(db, patch);
      try {
        // `savePipeline()` owns validation/reference semantics; the extra
        // predicate keeps the SQL update scoped even when the id exists.
        return (await savePipeline(table, db, preparedPatch, id, {
          updatePredicate: access.ownedRows(),
        })) as Record<string, unknown>;
      } catch (err) {
        if (isPersistenceNotFoundError(err)) throw new RowNotFoundError();
        throw err;
      }
    },

    async delete(id) {
      // Delete uses the same authorization shape as get/update: id plus owned
      // rows in SQL, with "not found" covering absent and invisible rows.
      if (table.meta.immutable) {
        throw new ImmutableTableOperationError(table.sqlName);
      }
      const deleted = (await db
        .delete(table.drizzle)
        .where(access.ownedRows(eq(pk.drizzlePk, id)))
        .returning()) as Record<string, unknown>[];
      if (deleted.length === 0) throw new RowNotFoundError();
      return publicRow.pick(deleted[0]!);
    },

    async exportRows(input = {}) {
      // Export is the unpaginated list path; it keeps query parsing, ordering,
      // and row ownership identical to list.
      const query = parseRowsQuery(input, table);
      const where = access.ownedRows(query.where);
      const rows = (await applyOrderBy(
        db.select().from(table.drizzle).where(where),
        query,
        table,
        pk.drizzlePk,
      )) as unknown as Record<string, unknown>[];
      return rows.map((row) => publicRow.pick(row));
    },

    async lookup(input = {}) {
      // Lookup backs foreign-key pickers and autocomplete. Optional ids preserve
      // selected entries. Search follows the fields displayed by the picker;
      // returned metadata contains only ordinary visible table fields.
      const { pkName, labelColumns, label } = rowLabeller(table);
      const idsParam = input.ids;
      const searchText = input.q?.trim().toLocaleLowerCase() ?? "";
      const limit = parseLookupLimit(input.limit);
      const displayedFields = resolveLookupDisplayedFields(table, input.fields);
      const visibleFields = getTableConfig(table.drizzle)
        .columns.map((column) => column.name)
        .filter(
          (columnName) =>
            table.meta.columns[columnName]?.visuallyHidden !== true,
        );
      const responseFields = resolveRowFields(table, visibleFields);
      const queryFields = resolveRowFields(
        table,
        uniqueNames([pkName, ...labelColumns, ...visibleFields]),
      );

      let rows: Record<string, unknown>[];
      if (idsParam === undefined) {
        const searchWhere =
          searchText === ""
            ? undefined
            : lookupDisplayedFieldsSearchCondition(
                table,
                labelColumns,
                displayedFields,
                searchText,
              );
        const query = db
          .select(queryFields.databaseSelection)
          .from(table.drizzle)
          .where(access.ownedRows(searchWhere))
          .orderBy(asc(pk.drizzlePk));
        rows = (await (limit === undefined
          ? query
          : query.limit(limit))) as Record<string, unknown>[];
      } else {
        const ids = parseLookupIds(idsParam, table, pk.pkCol.name);
        if (ids.length === 0) return [];
        rows = (await db
          .select(queryFields.databaseSelection)
          .from(table.drizzle)
          .where(access.ownedRows(inArray(pk.drizzlePk, ids)))) as Record<
          string,
          unknown
        >[];
      }

      const entries: LookupEntry[] = [];
      for (const row of rows) {
        const rowLabel = label(row);
        const value = row[pkName];
        if (typeof value === "string" || typeof value === "number") {
          entries.push({
            value,
            label: rowLabel,
            meta: responseFields.pick(row),
          });
        }
      }
      return entries;
    },

    async count(input = {}) {
      // Count supports generated relationship badges: count visible rows grouped
      // by a requested foreign-key-like column for a supplied set of ids.
      const groupBy = input.group_by;
      const idsParam = input.ids;
      if (!groupBy || !idsParam) return {};

      const config = getTableConfig(table.drizzle);
      const column = config.columns.find((col) => col.name === groupBy);
      if (!column) {
        throw new QueryParseError(
          "unknown_column",
          `Column "${groupBy}" not found`,
        );
      }

      const ids = parseCommaSeparatedValues(idsParam);
      if (ids.length === 0) return {};

      const drizzleColumn = (
        table.drizzle as unknown as Record<string, SQLiteColumn>
      )[groupBy];
      if (!drizzleColumn) {
        throw new QueryParseError(
          "unknown_column",
          `Column "${groupBy}" not found`,
        );
      }

      const rows = (await db
        .select({
          groupKey: drizzleColumn,
          count: sql<number>`count(*)`,
        })
        .from(table.drizzle)
        .where(access.ownedRows(inArray(drizzleColumn, ids)))
        .groupBy(drizzleColumn)) as Array<{
        groupKey: unknown;
        count: number;
      }>;

      const result: Record<string, number> = {};
      for (const row of rows) {
        result[String(row.groupKey)] = row.count;
      }
      return result;
    },
  };
}

// Drizzle exposes columns by property name, while query parameters and result
// rows use database column names. Keep both primary-key forms together.
function resolvePk(table: TableDef) {
  const pkCol = findPkColumn(table);
  return { pkCol, drizzlePk: pkCol };
}

async function countRows(
  db: BetterSQLite3Database,
  table: TableDef,
  where: SQL,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(table.drizzle)
    .where(where);
  return Number(rows[0]?.count ?? 0);
}

// Drizzle's fluent query types differ after orderBy/limit/offset. These small
// structural types model only the call chain this module needs.
function applyOrderBy(
  queryBuilder: unknown,
  query: ParsedQuery,
  table: TableDef,
  pk: SQLiteColumn,
): OrderedRowsQuery {
  const orderable = queryBuilder as OrderableRowsQuery;
  if (query.orderBy.length > 0) return orderable.orderBy(...query.orderBy);
  if (table.meta.defaultSort) return orderable.orderBy(table.meta.defaultSort);
  return orderable.orderBy(asc(pk));
}

function parseRowsQuery(input: ListRowsInput, table: TableDef): ParsedQuery {
  return parseQuery(withoutUndefinedValues(input), table);
}

function withoutUndefinedValues(input: ListRowsInput): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) params[key] = value;
  }
  return params;
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(",")
    .map((value) => value.trim())
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

function parseLookupLimit(limitParam: string | undefined): number | undefined {
  return parseOptionalBoundedInteger(limitParam, {
    name: "limit",
    min: 1,
    max: 500,
    makeError: (message) => new QueryParseError("bad_limit", message),
  });
}

function resolveLookupDisplayedFields(
  table: TableDef,
  fieldsParam: string | undefined,
): readonly string[] {
  if (fieldsParam === undefined) return [];
  const fields = uniqueNames(parseCommaSeparatedValues(fieldsParam));

  try {
    resolveRowFields(table, fields);
  } catch (error) {
    if (error instanceof UnknownRowFieldsError) {
      throw new QueryParseError("unknown_column", error.message);
    }
    throw error;
  }

  const hiddenFields = fields.filter(
    (field) => table.meta.columns[field]?.visuallyHidden === true,
  );
  if (hiddenFields.length > 0) {
    throw new QueryParseError(
      "unknown_column",
      `Lookup field(s) are not visible on table "${table.sqlName}": ${hiddenFields.join(", ")}`,
    );
  }

  return fields;
}

function lookupDisplayedFieldsSearchCondition(
  table: TableDef,
  labelFields: readonly string[],
  displayedFields: readonly string[],
  searchText: string,
): SQL | undefined {
  const labelColumns = Object.values(
    resolveRowFields(table, labelFields).databaseSelection,
  );
  const labelExpression = labelColumns.reduce<SQL | null>(
    (expression, column) => {
      const value = sql`coalesce(cast(${column} as text), '')`;
      return expression === null
        ? value
        : sql`${expression} || ' ' || ${value}`;
    },
    null,
  );
  if (labelExpression === null) return undefined;

  const pattern = `%${searchText}%`;
  const conditions: SQL[] = [sql`lower(${labelExpression}) like ${pattern}`];
  const labelFieldSet = new Set(labelFields);
  for (const column of Object.values(
    resolveRowFields(
      table,
      displayedFields.filter((field) => !labelFieldSet.has(field)),
    ).databaseSelection,
  )) {
    conditions.push(
      sql`lower(coalesce(cast(${column} as text), '')) like ${pattern}`,
    );
  }
  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

function uniqueNames(names: readonly string[]): string[] {
  return Array.from(new Set(names));
}

function isPersistenceNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("not found");
}
