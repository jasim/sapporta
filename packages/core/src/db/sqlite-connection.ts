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
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { localDayInZone, parseTimeZone } from "@sapporta/shared/temporal";

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

  registerLocalDayFunction(sqlite);

  const db = drizzle(sqlite);
  return { sqlite, db };
}

/**
 * Teaches this connection to bucket a stored instant by the calendar day it
 * falls on in a named zone.
 *
 * SQLite ships no time zone database. `date(col, 'localtime')` resolves
 * against the `TZ` of whichever process opened the file, and there is no
 * equivalent of PostgreSQL's `date_trunc('day', ts, 'Asia/Kolkata')`. What
 * SQLite does have is an extension point: a driver may register a function
 * written in the host language and call it from SQL. So the zone database
 * SQLite lacks is the one Node already ships, and the truncation is written
 * once and named:
 *
 *   SELECT to_tz_date(created_at, :zone) AS day, count(*) AS n
 *   FROM   txns
 *   WHERE  (:from IS NULL OR created_at >= :from)
 *     AND  (:until IS NULL OR created_at <  :until)
 *   GROUP  BY day
 *
 * The result is exact. There is no offset approximation and no transition to
 * reason about, because the answer for each row is computed against the full
 * tz database rather than against one offset applied to a whole range — which
 * is why a day that runs 23 or 25 hours comes out with the right number of
 * rows in it.
 *
 * `connectProject` is the single place a project database is opened, so every
 * connection that can run report SQL has this. `conn.sqlite` and the Drizzle
 * wrapper are one handle, so a Drizzle `sql` template reaches the same
 * function. A person holding a `sqlite3` shell does not, and will get
 * `unknown function: to_tz_date()`; `date(col, '±HH:MM')` is the shell
 * workaround, and it is wrong across a daylight-saving transition, which is
 * why it is a workaround and not the design.
 *
 * On a database with its own zone support this is a one-line substitution —
 * PostgreSQL 16's `date_trunc('day', ts, tz)`, MySQL's `CONVERT_TZ`,
 * BigQuery's `TIMESTAMP_TRUNC(ts, DAY, tz)`, ClickHouse's
 * `toStartOfDay(ts, tz)` — and every call site is found by grepping for one
 * name. What moves is where the tz database lives; the grouped result does
 * not change, because both are exact.
 */
function registerLocalDayFunction(sqlite: Database.Database): void {
  sqlite.function(
    "to_tz_date",
    // `deterministic` states the truth — the same instant and zone always give
    // the same day — which is what lets SQLite treat two calls with the same
    // arguments as interchangeable. Declaring it wrongly would license
    // optimizations that are not sound.
    //
    // `directOnly` forbids the function anywhere its use would be recorded in
    // the database file: an expression index, a view, a trigger, a CHECK
    // constraint, a generated column. Without it,
    // `CREATE INDEX ... ON txns(to_tz_date(created_at, 'Asia/Kolkata'))` is
    // accepted, and from that moment the file can only be written by a process
    // that has registered a JavaScript function of that name — reads still
    // work, but INSERT and even PRAGMA integrity_check fail, so no sqlite3
    // shell, backup tool, or schema-push step can touch it. This turns the
    // mistake into an error at CREATE INDEX time instead. Reports only ever
    // call it from a plain SELECT, so nothing legitimate is lost.
    { deterministic: true, directOnly: true },
    (instant: unknown, zone: unknown) => {
      // `new Date(null)` is the epoch rather than an invalid date, so a
      // nullable timestamp column would otherwise grow a silent 1970 bucket.
      // A missing instant has no day, and that is what it reports.
      if (instant === null) return null;
      // `parseTimeZone` runs per row but costs a set lookup after the first,
      // and a report binds one zone for the whole query. It is here for its
      // error message, which names the bad id.
      return localDayInZone(String(instant), parseTimeZone(String(zone)));
    },
  );
}
