// ============================================================================
// SQLite Sample Rows — fetch sample data from a table
// ============================================================================
//
// Same safety checks as the old Postgres version: validates table and column
// names via isSafeIdentifier() before interpolating into SQL.

import type Database from "better-sqlite3";
import { ErrorCode, OperationError, type OperationResult } from "./types.js";
import { validateTableName, validateColumnNames } from "./sql-safety.js";
import { assertTableExists, validatePayloadColumns } from "./db-helpers.js";
import { assertBoundedInteger } from "../validation/bounded-integer.js";

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
  assertTableExists(sqlite, tableName);
  validateSampleLimit(limit);

  let selectClause = "*";
  if (fields && fields.length > 0) {
    validateColumnNames(fields);
    validatePayloadColumns(sqlite, tableName, fields);
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

function validateSampleLimit(limit: number): void {
  assertBoundedInteger(limit, {
    name: "limit",
    min: 1,
    max: 1000,
    makeError: (message) => new OperationError(message, ErrorCode.BAD_LIMIT),
  });
}
