// ============================================================================
// SQLite Report SQL Client — synchronous query adapter for the report engine
// ============================================================================
//
// better-sqlite3 is synchronous; the ReportSqlClient interface (engine.ts) is
// async. This module wraps a better-sqlite3 Database to match by wrapping
// synchronous results in Promise.resolve(). PLAN-2 will migrate the engine
// to a synchronous execution model and this wrapper will go away.

import type Database from "better-sqlite3";
import type { ReportSqlClient } from "./engine.js";

/**
 * Create a ReportSqlClient adapter from a better-sqlite3 Database.
 *
 * Maps the async ReportSqlClient.unsafe() interface to better-sqlite3's
 * synchronous prepare().all() — the result is wrapped in Promise.resolve()
 * for interface compatibility.
 *
 * The params array is spread into .all() which uses SQLite's ? positional
 * parameter binding (not Postgres's $1 positional binding). The caller
 * must use buildSQLitePositionalQuery() from sqlite-bind.ts to convert
 * $name variables to ? placeholders before calling this client.
 */
export function createReportSqlClient(
  sqlite: Database.Database,
): ReportSqlClient {
  return {
    unsafe: (
      sql: string,
      params?: unknown[],
    ): Promise<Record<string, unknown>[]> => {
      // better-sqlite3 types .all() with a VariableArgFunction signature
      // that isn't compatible with unknown[]; the runtime accepts any
      // bindable primitive, which is what TypedValue serializes to.
      const stmt = sqlite.prepare(sql) as unknown as {
        all: (...params: unknown[]) => Record<string, unknown>[];
      };
      return Promise.resolve(stmt.all(...(params ?? [])));
    },
  };
}
