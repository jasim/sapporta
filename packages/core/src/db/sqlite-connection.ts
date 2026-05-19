// ============================================================================
// SQLite Connection — project database connection for SQLite-backed projects
// ============================================================================
//
// Each Sapporta project gets its own SQLite database file. This module creates
// the connection with optimized PRAGMAs for a multi-reader, single-writer
// web application workload.
//
// Design: No abstraction layer — better-sqlite3's Database type is used
// directly throughout the codebase. The synchronous API naturally serializes
// writes, eliminating SQLITE_BUSY contention that plagues async drivers.
// If a different driver is ever needed, refactor then (YAGNI).
//
// The Drizzle ORM wrapper is returned alongside the raw handle because:
// - Raw handle: PRAGMA introspection, raw SQL, explicit transactions
// - Drizzle db: typed ORM queries, schema push via drizzle-kit/api

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export interface ProjectDbConnection {
  /** Raw better-sqlite3 handle — used for PRAGMAs, raw SQL, transactions */
  sqlite: Database.Database;
  /** Drizzle ORM wrapper — used for typed queries and schema push */
  db: BetterSQLite3Database;
}

/**
 * Open a SQLite database and configure it for server workloads.
 *
 * PRAGMA ordering matters:
 * 1. journal_mode=WAL must be set first — it changes the file format and
 *    affects how subsequent PRAGMAs interact with the database.
 * 2. foreign_keys=ON must be set per-connection (not persisted in the file),
 *    so it runs on every open.
 * 3. The remaining PRAGMAs are performance tuning and order-independent.
 *
 * @param filepath Path to the .sqlite file, or ":memory:" for tests.
 */
export function connectProject(filepath: string): ProjectDbConnection {
  if (filepath !== ":memory:") {
    const dir = dirname(resolve(filepath));
    if (!existsSync(dir)) {
      throw new Error(
        `Cannot open database "${resolve(filepath)}": parent directory "${dir}" does not exist`,
      );
    }
  }

  const sqlite = new Database(filepath);

  // WAL mode: allows concurrent reads while writing. Must be set before
  // any other operations on the database. Persists across connections
  // (stored in the file), but setting it is idempotent.
  sqlite.pragma("journal_mode = WAL");

  // Busy timeout: wait up to 5 seconds for locks instead of failing
  // immediately. Prevents transient SQLITE_BUSY errors under load.
  sqlite.pragma("busy_timeout = 5000");

  // NORMAL sync: WAL mode already provides crash safety via the WAL file.
  // NORMAL skips the extra fsync on each commit, trading a tiny risk of
  // losing the last transaction on OS crash for ~2x write throughput.
  sqlite.pragma("synchronous = NORMAL");

  // Foreign keys: OFF by default in SQLite (historical compatibility).
  // Must be enabled per-connection — not persisted in the database file.
  sqlite.pragma("foreign_keys = ON");

  // 8MB page cache: SQLite's default is ~2MB. More cache means fewer
  // disk reads for repeated queries against the same pages.
  // Negative value = size in KiB (so -8000 ≈ 8MB).
  sqlite.pragma("cache_size = -8000");

  const db = drizzle(sqlite);
  return { sqlite, db };
}
