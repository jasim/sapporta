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
import { classifySqliteError } from "../db/errors.js";
import { parseOptionalBoundedInteger } from "@sapporta/shared/validation";
import { ErrorCode, OperationError, type OperationResult } from "./types.js";
import { rejectDangerousSQL } from "./sql-safety.js";

export interface DbRunOptions {
  /** Cap returned rows. Ignored for statements that don't return rows. */
  limit?: number;
  /** For writes: validate via EXPLAIN QUERY PLAN instead of executing. */
  dryRun?: boolean;
  /** Allow non-reader statements to run. Dangerous DDL is still blocked. */
  allowDangerous?: boolean;
  /** Positional values bound to placeholders in the SQL statement. */
  params?: readonly unknown[];
}

export function dbRun(
  sqlite: Database.Database,
  rawSql: string,
  opts: DbRunOptions = {},
): OperationResult {
  rejectDangerousSQL(rawSql);

  try {
    const stmt = sqlite.prepare(rawSql);
    const params = opts.params ?? [];

    if (stmt.reader) {
      const limit = parseSqlLimit(opts.limit);
      const effectiveSql =
        limit === undefined ? rawSql : `SELECT * FROM (${rawSql}) LIMIT ?`;
      const effectiveParams: readonly unknown[] =
        limit === undefined ? params : [...params, limit];
      const rows = sqlite.prepare(effectiveSql).all(effectiveParams) as Record<
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

    if (opts.allowDangerous !== true) {
      throw new OperationError(
        "SQL statement is mutating. Pass allowDangerous: true to execute non-reader SQL.",
        ErrorCode.SELECT_ONLY,
      );
    }

    if (opts.dryRun) {
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${rawSql}`)
        .all(params) as Record<string, unknown>[];
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

    const info = stmt.run(params);
    return {
      ok: true,
      data: [],
      meta: {
        rowCount: info.changes,
        ...(info.changes === 0 && { message: "OK (0 rows)" }),
      },
    };
  } catch (err) {
    const classified = classifySqliteError(err, "sql");
    if (!classified) throw err;
    throw new OperationError(classified.message, classified.code);
  }
}

function parseSqlLimit(limit: number | undefined): number | undefined {
  return parseOptionalBoundedInteger(limit, {
    name: "limit",
    min: 1,
    max: 1000,
    makeError: (message) => new OperationError(message, ErrorCode.BAD_LIMIT),
  });
}
