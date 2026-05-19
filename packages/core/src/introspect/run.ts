// ============================================================================
// SQLite SQL proxy — auto-dispatching runner
// ============================================================================
//
// One entry point for ad-hoc SQL. We prepare the statement and let
// better-sqlite3 tell us whether it returns rows (`stmt.reader`). Read
// statements get `.all()`; everything else gets `.run()` and reports the
// row-change count. Callers don't have to pick the right verb.
//
// Dangerous statements (DROP DATABASE, TRUNCATE, DROP SCHEMA) are rejected
// up front. `dryRun` is meaningful only for writes — it uses
// EXPLAIN QUERY PLAN to validate without executing.

import type Database from "better-sqlite3";
import type { OperationResult } from "./types.js";
import { rejectDangerousSQL } from "./sql-safety.js";

export interface DbRunOptions {
  /** Cap returned rows. Ignored for statements that don't return rows. */
  limit?: number;
  /** For writes: validate via EXPLAIN QUERY PLAN instead of executing. */
  dryRun?: boolean;
}

export function dbRun(
  sqlite: Database.Database,
  rawSql: string,
  opts: DbRunOptions = {},
): OperationResult {
  rejectDangerousSQL(rawSql);

  const stmt = sqlite.prepare(rawSql);

  if (stmt.reader) {
    const { limit } = opts;
    let effectiveSql = rawSql;
    if (limit !== undefined) {
      effectiveSql = `SELECT * FROM (${rawSql}) LIMIT ${limit}`;
    }
    const rows = sqlite.prepare(effectiveSql).all() as Record<
      string,
      unknown
    >[];
    const truncated = limit !== undefined && rows.length >= limit;
    return {
      ok: true,
      data: rows,
      meta: {
        rowCount: rows.length,
        ...(truncated && { truncated: true, limit }),
      },
    };
  }

  if (opts.dryRun) {
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${rawSql}`)
      .all() as Record<string, unknown>[];
    return {
      ok: true,
      data: plan,
      meta: {
        message: "Dry run: SQL is valid (EXPLAIN QUERY PLAN succeeded)",
        dryRun: true,
        tableOutputHandled: true,
      },
    };
  }

  const info = stmt.run();
  return {
    ok: true,
    data: [],
    meta: {
      rowCount: info.changes,
      ...(info.changes === 0 && { message: "OK (0 rows)" }),
    },
  };
}
