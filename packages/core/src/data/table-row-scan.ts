import Database from "better-sqlite3";
import { asc, type InferSelectModel, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  getTableConfig,
  type AnySQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { findPkColumn } from "../schema/pk.js";
import type { TableDef } from "../schema/table.js";

export type TableRowScanOrder = SQLiteColumn | SQL;

export interface TableRowScanInput {
  where?: SQL;
  orderBy?: TableRowScanOrder | readonly TableRowScanOrder[];
}

/**
 * Read selected table rows through one SQLite statement and cursor.
 *
 * Drizzle's better-sqlite3 driver maps complete result arrays but does not
 * expose the driver's iterator. This adapter therefore lets Drizzle compile
 * the selection, predicates, ordering, and bound parameters, then crosses the
 * driver boundary only to call better-sqlite3's `iterate()`. Each raw value is
 * decoded with its selected Drizzle column, preserving the same boolean,
 * timestamp, JSON, custom-column, and null mapping as an ordinary select.
 *
 * The active SQLite statement owns the read snapshot. Exhausting the iterable
 * or cancelling it early closes the iterator in `finally`, releasing that
 * snapshot. There is deliberately no application batch-size input: SQLite
 * advances one prepared statement instead of rerunning paged queries.
 */
export function scanTableRows<TTable extends AnySQLiteTable>(
  db: BetterSQLite3Database,
  table: TableDef<TTable>,
  input: TableRowScanInput = {},
): AsyncIterable<InferSelectModel<TTable, { dbColumnNames: true }>> {
  const columns = getTableConfig(table.drizzle).columns;
  const selection: Record<string, SQLiteColumn> = Object.fromEntries(
    columns.map((column) => [column.name, column]),
  );
  const orderBy = deterministicOrder(input.orderBy, table);
  const query = db
    .select(selection)
    .from(table.drizzle)
    .where(input.where)
    .orderBy(...orderBy)
    .toSQL();
  const sqlite = betterSqliteClient(db);

  return (async function* iterateTableRows() {
    const statement = sqlite.prepare<unknown[], unknown[]>(query.sql).raw();
    const iterator = statement.iterate(...query.params);

    try {
      while (true) {
        const result = iterator.next();
        if (result.done) return;
        yield mapDriverRow<TTable>(columns, result.value);
      }
    } finally {
      iterator.return?.();
    }
  })();
}

function deterministicOrder(
  requested: TableRowScanInput["orderBy"],
  table: TableDef,
): readonly TableRowScanOrder[] {
  const primaryKey = findPkColumn(table);
  if (requested !== undefined) {
    const clauses = Array.isArray(requested) ? [...requested] : [requested];
    return [...clauses, asc(primaryKey)];
  }
  return table.meta.defaultSort
    ? [table.meta.defaultSort, asc(primaryKey)]
    : [asc(primaryKey)];
}

function mapDriverRow<TTable extends AnySQLiteTable>(
  columns: readonly SQLiteColumn[],
  values: readonly unknown[],
): InferSelectModel<TTable, { dbColumnNames: true }> {
  if (values.length !== columns.length) {
    throw new Error(
      `SQLite returned ${values.length} values for ${columns.length} selected columns.`,
    );
  }

  return Object.fromEntries(
    columns.map((column, index) => {
      const value = values[index];
      return [
        column.name,
        value === null ? null : column.mapFromDriverValue(value),
      ];
    }),
  ) as InferSelectModel<TTable, { dbColumnNames: true }>;
}

function betterSqliteClient(db: BetterSQLite3Database): Database.Database {
  // `drizzle(client)` publicly returns `$client`, while the base
  // `BetterSQLite3Database` class type used by Sapporta omits that intersection.
  // Narrow only at this explicit driver adapter rather than leaking the raw
  // client through the storage API.
  const client = (db as unknown as { readonly $client?: unknown }).$client;
  if (!(client instanceof Database)) {
    throw new TypeError(
      "Table row scans require a Drizzle better-sqlite3 database with its raw client.",
    );
  }
  return client;
}
