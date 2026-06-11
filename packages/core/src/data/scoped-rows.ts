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
 * The important rule is that primary keys and client payloads are not security
 * boundaries. Reads and destructive writes add the table's workspace/user
 * visibility predicate in SQL. Creates and updates first reject client-supplied
 * ownership fields, then stamp trusted scope values from request data
 * authority.
 *
 * The row-security module builds that request-bound policy with
 * `createRowSecurity()`, exposed on `SapportaAuthContext` as `RowSecurity`.
 * `RowSecurity.forTable(table)` returns the per-table helpers used here:
 * `ownedRows()` produces the SQL condition that limits reads, updates, and
 * deletes to rows visible to the current request; `insertValues()` and
 * `patchValues()` prepare safe write objects by preserving client-owned fields,
 * rejecting forbidden ownership fields, and adding server-trusted workspace/user
 * values where the table scope requires them.
 *
 * This file intentionally stays below HTTP concerns. Route handlers translate
 * these domain errors into responses; this module only parses table queries,
 * applies row visibility, performs persistence, and returns plain row objects.
 */

import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { RowId } from "@sapporta/shared/row-id";
import type { SapportaAuthContext } from "../auth/context.js";
import { QueryParseError } from "../db/errors.js";
import { findPkColumn } from "../schema/pk.js";
import type { TableDef } from "../schema/table.js";
import { savePipeline } from "./save-pipeline.js";
import { parseQuery, type ParsedQuery } from "./query-parser.js";
import { rowLabeller } from "./row-label.js";

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
  lookup(query?: ListRowsInput): Promise<Record<string, string>>;
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
        data: rows,
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
      return rows[0]!;
    },

    async create(input) {
      // Accept either a single client payload or a batch, but prepare each row
      // independently so row-security can stamp trusted scope fields.
      const records = Array.isArray(input) ? input : [input];
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
      return deleted[0]!;
    },

    async exportRows(input = {}) {
      // Export is the unpaginated list path; it keeps query parsing, ordering,
      // and row ownership identical to list.
      const query = parseRowsQuery(input, table);
      const where = access.ownedRows(query.where);
      return (await applyOrderBy(
        db.select().from(table.drizzle).where(where),
        query,
        table,
        pk.drizzlePk,
      )) as unknown as Record<string, unknown>[];
    },

    async lookup(input = {}) {
      // Lookup backs foreign-key pickers and autocomplete. Optional ids preserve
      // selected labels; optional q filters visible labels in memory after the
      // SQL row-ownership predicate has already narrowed the result set.
      const { pkName, label } = rowLabeller(table);
      const idsParam = input.ids;
      const searchText = input.q?.trim().toLocaleLowerCase() ?? "";

      let rows: Record<string, unknown>[];
      if (idsParam === undefined) {
        rows = (await db
          .select()
          .from(table.drizzle)
          .where(access.ownedRows())) as Record<string, unknown>[];
      } else {
        const ids = parseIds(idsParam);
        if (ids.length === 0) return {};
        rows = (await db
          .select()
          .from(table.drizzle)
          .where(access.ownedRows(inArray(pk.drizzlePk, ids)))) as Record<
          string,
          unknown
        >[];
      }

      const data: Record<string, string> = {};
      for (const row of rows) {
        const rowLabel = label(row);
        if (
          idsParam === undefined &&
          searchText !== "" &&
          !rowLabel.toLocaleLowerCase().includes(searchText)
        ) {
          continue;
        }
        data[String(row[pkName])] = rowLabel;
      }
      return data;
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

      const ids = parseIds(idsParam);
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
  const columns = table.drizzle as unknown as Record<string, SQLiteColumn>;
  return { pkCol, drizzlePk: columns[pkCol.name]! };
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

function parseIds(idsParam: string): string[] {
  return idsParam
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isPersistenceNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("not found");
}
