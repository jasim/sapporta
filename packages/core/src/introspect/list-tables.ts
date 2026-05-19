// ============================================================================
// SQLite Table Listing — enumerate user tables with row counts
// ============================================================================
//
// Uses sqlite_master for table enumeration and SELECT COUNT(*) for exact
// row counts. Exact counts are fine for SQLite's dataset sizes — if this
// ever becomes a bottleneck, we can switch to a stat table or sampling.
//
// Excludes internal tables:
//   - sqlite_* (sqlite_sequence, sqlite_stat1, etc.)
//   - _litestream_* (Litestream replication metadata)

import type Database from "better-sqlite3";
import type { OperationResult } from "./types.js";

export interface TableInfo {
  name: string;
  rowCount: number;
}

/**
 * List all user tables in the SQLite database with exact row counts.
 *
 * The WHERE filters use NOT LIKE rather than a NOT IN list so we
 * automatically cover any future internal table prefixes.
 */
export function listTables(sqlite: Database.Database): TableInfo[] {
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_litestream_%'
       ORDER BY name`,
    )
    .all() as { name: string }[];

  return tables.map((t) => ({
    name: t.name,
    rowCount: (
      sqlite.prepare(`SELECT COUNT(*) AS cnt FROM "${t.name}"`).get() as {
        cnt: number;
      }
    ).cnt,
  }));
}

/**
 * OperationResult wrapper for CLI/API consumption.
 */
export function dbListTables(sqlite: Database.Database): OperationResult {
  const rows = listTables(sqlite);

  if (rows.length === 0) {
    return { ok: true, data: [], meta: { message: "No tables found." } };
  }

  return {
    ok: true,
    data: rows.map((r) => ({ table_name: r.name, row_count: r.rowCount })),
  };
}
