// ============================================================================
// SQLite Sample Rows — fetch sample data from a table
// ============================================================================
//
// Same safety checks as the old Postgres version: validates table and column
// names via isSafeIdentifier() before interpolating into SQL.

import type Database from "better-sqlite3";
import type { OperationResult } from "./types.js";
import { validateTableName, validateColumnNames } from "./sql-safety.js";

/**
 * Return sample rows from a table, optionally selecting specific columns.
 *
 * Table and column names are validated against SQL injection via
 * isSafeIdentifier() before being interpolated into the query string.
 * The limit is passed as a query parameter (not interpolated).
 */
export function dbSample(
  sqlite: Database.Database,
  tableName: string,
  limit: number = 5,
  fields?: string[],
): OperationResult {
  validateTableName(tableName);

  let selectClause = "*";
  if (fields && fields.length > 0) {
    validateColumnNames(fields);
    selectClause = fields.map((f) => `"${f}"`).join(", ");
  }

  const rows = sqlite
    .prepare(`SELECT ${selectClause} FROM "${tableName}" ORDER BY id LIMIT ?`)
    .all(limit) as Record<string, unknown>[];

  if (rows.length === 0) {
    return {
      ok: true,
      data: [],
      meta: { message: `Table '${tableName}' is empty.` },
    };
  }

  return {
    ok: true,
    data: rows,
    meta: { rowCount: rows.length, limit },
  };
}
