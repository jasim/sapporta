// ============================================================================
// SQLite DB Helpers — existence checks and query builders
// ============================================================================
//
// Low-level database helper functions for SQLite. These replace the Postgres
// versions which queried information_schema with async postgres.js calls.
//
// All functions are synchronous — better-sqlite3 returns results immediately.

import type Database from "better-sqlite3";
import { OperationError, ErrorCode } from "./types.js";

/**
 * Check whether a table exists in the database.
 * Uses sqlite_master (the authoritative catalog for SQLite).
 */
export function tableExists(
  sqlite: Database.Database,
  tableName: string,
): boolean {
  const row = sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  return row !== undefined;
}

/**
 * Check whether a specific column exists in a table.
 * Uses PRAGMA table_info which returns one row per column.
 */
export function columnExists(
  sqlite: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  const cols = sqlite.pragma(`table_info("${tableName}")`) as {
    name: string;
  }[];
  return cols.some((c) => c.name === columnName);
}

/**
 * Return the set of column names for a table.
 * Used to validate payload columns against actual table structure.
 */
export function getTableColumns(
  sqlite: Database.Database,
  tableName: string,
): Set<string> {
  const cols = sqlite.pragma(`table_info("${tableName}")`) as {
    name: string;
  }[];
  return new Set(cols.map((c) => c.name));
}

/**
 * Assert that a table exists in the database.
 * Throws TABLE_NOT_FOUND if the table doesn't exist.
 */
export function assertTableExists(
  sqlite: Database.Database,
  tableName: string,
): void {
  if (!tableExists(sqlite, tableName)) {
    throw new OperationError(
      `Table '${tableName}' not found`,
      ErrorCode.TABLE_NOT_FOUND,
    );
  }
}

/**
 * Validate that all payload columns exist in the target table.
 * Calls assertTableExists first, then checks each payload column against
 * the actual column set. Throws INVALID_COLUMN_NAME on unknown columns.
 */
export function validatePayloadColumns(
  sqlite: Database.Database,
  tableName: string,
  payloadColumns: string[],
): void {
  assertTableExists(sqlite, tableName);
  const dbColumns = getTableColumns(sqlite, tableName);
  const unknown = payloadColumns.filter((c) => !dbColumns.has(c));
  if (unknown.length > 0) {
    throw new OperationError(
      `Unknown column(s) in '${tableName}': ${unknown.join(", ")}`,
      ErrorCode.INVALID_COLUMN_NAME,
    );
  }
}

/**
 * Build a parameterized INSERT query from a table name and a row object.
 * Column names are double-quoted to handle reserved words.
 *
 * SQLite uses ? positional parameters (not $1, $2, ...) and returns
 * inserted rows via a separate SELECT (SQLite's RETURNING clause
 * requires SQLite 3.35+, which better-sqlite3 ships).
 */
export function buildInsertQuery(
  tableName: string,
  row: Record<string, unknown>,
): { query: string; values: unknown[] } {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = columns.map(() => "?");
  const query = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
  return { query, values };
}
