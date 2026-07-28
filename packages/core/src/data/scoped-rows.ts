/**
 * Row-scoped table operations for generated routes and ordinary product code.
 *
 * `scopedRows()` is Sapporta's default table API after a request has an auth
 * context. The principal may be signed in or anonymous; row access comes from
 * `auth.dataAuthority`, not from assuming there is always a workspace user.
 * The helper binds one Drizzle table to the request's row-security policy,
 * then exposes CRUD, bounded and paged reads, scans, lookup, and count
 * operations that never let callers choose or bypass ownership columns.
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
 * URL query strings into the Drizzle-shaped inputs accepted here. This module
 * applies row visibility, performs persistence, and returns plain row objects.
 */

import {
  asc,
  eq,
  inArray,
  or,
  sql,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  getTableConfig,
  type AnySQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { RowId } from "@sapporta/shared/row-id";
import {
  DEFAULT_LOOKUP_LIMIT,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_LOOKUP_IDS,
  MAX_LOOKUP_LIMIT,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  type LookupEntry,
} from "@sapporta/shared/contracts";
import type { SapportaAuthContext } from "../auth/context.js";
import { ValidationError } from "../db/errors.js";
import { findPkColumn } from "../schema/pk.js";
import { resolveColumnKind } from "../schema/resolve-kind.js";
import type { TableDef } from "../schema/table.js";
import { savePipeline } from "./save-pipeline.js";
import { rowLabeller } from "./row-label.js";
import { resolveRowFields } from "./row-fields.js";
import type { GroupCount } from "@sapporta/shared";
import { countTableRows, countTableRowsBy } from "./count-rows.js";
import { scanTableRows } from "./table-row-scan.js";

export type TableColumn<TTable extends AnySQLiteTable = AnySQLiteTable> =
  TTable["_"]["columns"][keyof TTable["_"]["columns"]];

export type RowsOrderBy = SQLiteColumn | SQL;

/** A table row keyed by public SQL column names. */
export type TableRow<TTable extends AnySQLiteTable = AnySQLiteTable> =
  InferSelectModel<TTable, { dbColumnNames: true }>;

export interface RowsQuery {
  where?: SQL;
  orderBy?: RowsOrderBy | readonly RowsOrderBy[];
}

export interface FindManyRowsInput extends RowsQuery {
  /** Required upper bound for the number of returned rows. */
  limit: number;
  /** Number of matching rows to skip. Defaults to zero. */
  offset?: number;
}

export interface PageRowsInput extends RowsQuery {
  page?: number;
  limit?: number;
}

export type LookupRowsByIdInput = {
  ids: readonly RowId[];
  search?: never;
  fields?: never;
  limit?: never;
};

export type LookupRowsBySearchInput<
  TTable extends AnySQLiteTable = AnySQLiteTable,
> = {
  ids?: never;
  search?: string;
  fields?: readonly TableColumn<TTable>[];
  limit?: number;
};

export type LookupRowsInput<TTable extends AnySQLiteTable = AnySQLiteTable> =
  LookupRowsByIdInput | LookupRowsBySearchInput<TTable>;

export interface CountRowsInput {
  where?: SQL;
}

export interface CountRowsByInput<
  TTable extends AnySQLiteTable = AnySQLiteTable,
> extends CountRowsInput {
  column: TableColumn<TTable>;
  order?: "asc" | "desc";
  limit?: number;
}

export interface PageRowsResult<
  TTable extends AnySQLiteTable = AnySQLiteTable,
> {
  data: TableRow<TTable>[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface ScopedRows<TTable extends AnySQLiteTable = AnySQLiteTable> {
  findMany(input: FindManyRowsInput): Promise<TableRow<TTable>[]>;
  page(input?: PageRowsInput): Promise<PageRowsResult<TTable>>;
  get(id: RowId): Promise<TableRow<TTable>>;
  create(input: readonly unknown[]): Promise<TableRow<TTable>[]>;
  create(input: Record<string, unknown>): Promise<TableRow<TTable>>;
  create(input: unknown): Promise<TableRow<TTable> | TableRow<TTable>[]>;
  update(id: RowId, patch: unknown): Promise<TableRow<TTable>>;
  delete(id: RowId): Promise<TableRow<TTable>>;
  scan(input?: RowsQuery): AsyncIterable<TableRow<TTable>>;
  lookup(input?: LookupRowsInput<TTable>): Promise<LookupEntry[]>;
  count(input?: CountRowsInput): Promise<number>;
  countBy(input: CountRowsByInput<TTable>): Promise<GroupCount[]>;
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

type OrderClause = RowsOrderBy;
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

export function scopedRows<TTable extends AnySQLiteTable>(
  db: BetterSQLite3Database,
  auth: SapportaAuthContext,
  table: TableDef<TTable>,
): ScopedRows<TTable> {
  // Resolve the request-bound access policy once so every operation below uses
  // the same table metadata, workspace, user, and row-scope interpretation.
  const access = auth.rowSecurity.forTable(table);
  const pk = resolvePk(table);
  const publicRow = resolveRowFields(
    table,
    getTableConfig(table.drizzle).columns.map((column) => column.name),
  );

  const pickPublicRow = (row: Record<string, unknown>): TableRow<TTable> =>
    publicRow.pick(row) as TableRow<TTable>;

  async function findMany(
    input: FindManyRowsInput,
  ): Promise<TableRow<TTable>[]> {
    const { limit, offset } = normalizedFindManyWindow(input);
    const where = access.ownedRows(input.where);
    const orderBy = normalizeOrderBy(input.orderBy);
    const rows = (await applyOrderBy(
      db.select().from(table.drizzle).where(where),
      orderBy,
      table,
      pk.drizzlePk,
    )
      .limit(limit)
      .offset(offset)) as Record<string, unknown>[];

    return rows.map(pickPublicRow);
  }

  async function create(input: readonly unknown[]): Promise<TableRow<TTable>[]>;
  async function create(
    input: Record<string, unknown>,
  ): Promise<TableRow<TTable>>;
  async function create(
    input: unknown,
  ): Promise<TableRow<TTable> | TableRow<TTable>[]>;
  async function create(
    input: unknown,
  ): Promise<TableRow<TTable> | TableRow<TTable>[]> {
    // Accept either a single API payload or a batch, but prepare each row
    // independently so row-security can stamp trusted scope fields.
    const isBatch = isUnknownArray(input);
    const records = isBatch ? input : [input];
    if (records.length === 0) {
      throw new ValidationError([
        { field: "body", message: "Expected at least one row" },
      ]);
    }
    const results: TableRow<TTable>[] = [];
    for (const record of records) {
      const prepared = await access.insertValues(db, record);
      results.push(
        (await savePipeline(table, db, prepared)) as TableRow<TTable>,
      );
    }
    return isBatch ? results : results[0]!;
  }

  async function count(input: CountRowsInput = {}): Promise<number> {
    return countTableRows(db, table, access.ownedRows(input.where));
  }

  return {
    findMany,

    async page(input = {}) {
      const { page, limit, offset } = normalizedPageWindow(input);
      const total = await count({ where: input.where });
      const data = await findMany({
        where: input.where,
        orderBy: input.orderBy,
        limit,
        offset,
      });

      return {
        data,
        meta: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
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
      return pickPublicRow(rows[0]!);
    },

    create,

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
        })) as TableRow<TTable>;
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
      return pickPublicRow(deleted[0]!);
    },

    scan(input = {}) {
      return scanTableRows(db, table, {
        where: access.ownedRows(input.where),
        orderBy: input.orderBy,
      });
    },

    async lookup(input = {}) {
      // Lookup backs foreign-key pickers and autocomplete. Optional ids preserve
      // selected entries. Search follows the fields displayed by the picker;
      // returned metadata contains only ordinary visible table fields.
      const { pkName, labelColumns, label } = rowLabeller(table);
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
      if (input.ids === undefined) {
        const searchText = input.search?.trim().toLocaleLowerCase() ?? "";
        const limit = normalizeLookupLimit(input.limit);
        const displayedFields = normalizeLookupFields(table, input.fields);
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
        rows = (await query.limit(limit)) as Record<string, unknown>[];
      } else {
        const ids = normalizeLookupIds(input.ids, table, pk.pkCol.name);
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

    count,

    async countBy(input) {
      return countTableRowsBy(
        db,
        table,
        {
          column: input.column,
          order: input.order,
          limit: input.limit,
        },
        access.ownedRows(input.where),
      );
    },
  };
}

// Drizzle exposes columns by property name, while query parameters and result
// rows use database column names. Keep both primary-key forms together.
function resolvePk(table: TableDef) {
  const pkCol = findPkColumn(table);
  return { pkCol, drizzlePk: pkCol };
}

// Drizzle's fluent query types differ after orderBy/limit/offset. These small
// structural types model only the call chain this module needs.
function applyOrderBy(
  queryBuilder: unknown,
  orderBy: readonly OrderClause[],
  table: TableDef,
  pk: SQLiteColumn,
): OrderedRowsQuery {
  const orderable = queryBuilder as OrderableRowsQuery;
  if (orderBy.length > 0) {
    return orderable.orderBy(...orderBy, asc(pk));
  }
  if (table.meta.defaultSort) {
    return orderable.orderBy(table.meta.defaultSort, asc(pk));
  }
  return orderable.orderBy(asc(pk));
}

function normalizeOrderBy(
  orderBy: RowsQuery["orderBy"],
): readonly OrderClause[] {
  if (orderBy === undefined) return [];
  return isOrderByArray(orderBy) ? [...orderBy] : [orderBy];
}

function isOrderByArray(
  value: RowsOrderBy | readonly RowsOrderBy[],
): value is readonly RowsOrderBy[] {
  return Array.isArray(value);
}

function normalizedFindManyWindow(input: FindManyRowsInput): {
  limit: number;
  offset: number;
} {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_PAGE_SIZE
  ) {
    throw new RangeError(
      `Find-many limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`,
    );
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("Find-many offset must be a nonnegative integer.");
  }
  return { limit: input.limit, offset };
}

function normalizedPageWindow(input: PageRowsInput): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = input.page ?? DEFAULT_PAGE;
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new RangeError(`Page must be an integer from 1 to ${MAX_PAGE}.`);
  }
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError(
      `Page limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`,
    );
  }
  return { page, limit, offset: (page - 1) * limit };
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function normalizeLookupIds(
  ids: readonly RowId[],
  table: TableDef,
  primaryKeyColumn: string,
): readonly (string | number)[] {
  if (ids.length > MAX_LOOKUP_IDS) {
    throw new RangeError(
      `Lookup ids must contain at most ${MAX_LOOKUP_IDS} values.`,
    );
  }
  const kind = resolveColumnKind(table, primaryKeyColumn);
  switch (kind) {
    case "text": {
      const invalid = ids.find((id) => typeof id !== "string");
      if (invalid !== undefined) {
        throw new TypeError(
          `Lookup id for text column "${primaryKeyColumn}" must be a string, got ${JSON.stringify(invalid)}.`,
        );
      }
      return ids;
    }
    case "number":
      return ids.map((id) => {
        const value = Number(id);
        if (!Number.isFinite(value)) {
          throw new TypeError(
            `Lookup id for numeric column "${primaryKeyColumn}" must be a finite number, got ${JSON.stringify(id)}.`,
          );
        }
        return value;
      });
    case "boolean":
    case "date":
    case "timestamp":
      throw new TypeError(`Lookup does not support ${kind} primary keys.`);
    case undefined:
      throw new Error(`Column "${primaryKeyColumn}" not found.`);
  }
}

function normalizeLookupLimit(limit: number | undefined): number {
  const normalized = limit ?? DEFAULT_LOOKUP_LIMIT;
  if (
    !Number.isInteger(normalized) ||
    normalized < 1 ||
    normalized > MAX_LOOKUP_LIMIT
  ) {
    throw new RangeError(
      `Lookup limit must be an integer from 1 to ${MAX_LOOKUP_LIMIT}.`,
    );
  }
  return normalized;
}

function normalizeLookupFields<TTable extends AnySQLiteTable>(
  table: TableDef<TTable>,
  fields: readonly TableColumn<TTable>[] | undefined,
): SQLiteColumn[] {
  if (fields === undefined) return [];
  const tableColumns = new Set(getTableConfig(table.drizzle).columns);
  const unique = Array.from(new Set<SQLiteColumn>(fields));
  for (const column of unique) {
    if (!tableColumns.has(column)) {
      throw new Error(
        `Lookup field "${column.name}" does not belong to table "${table.sqlName}".`,
      );
    }
    if (table.meta.columns[column.name]?.visuallyHidden === true) {
      throw new Error(
        `Lookup field "${column.name}" is not visible on table "${table.sqlName}".`,
      );
    }
  }
  return unique;
}

function lookupDisplayedFieldsSearchCondition(
  table: TableDef,
  labelFields: readonly string[],
  displayedFields: readonly SQLiteColumn[],
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
  const labelFieldSet = new Set(labelColumns);
  for (const column of displayedFields.filter(
    (field) => !labelFieldSet.has(field),
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
