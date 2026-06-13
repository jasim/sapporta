import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import type { ProjectDbConnection } from "../db/sqlite-connection.js";

/**
 * Create an in-memory SQLite database for testing.
 *
 * Returns both the raw better-sqlite3 handle and a Drizzle instance.
 * This is the "unit test" variant — use it for testing individual functions
 * that accept a Drizzle db parameter.
 *
 * Configures WAL mode and foreign keys to match production settings
 * from sqlite-connection.ts.
 */
export function createTestDb(): {
  sqlite: Database.Database;
  db: BetterSQLite3Database;
} {
  const sqlite = new Database(":memory:");
  // Match production PRAGMA settings from sqlite-connection.ts.
  // WAL mode isn't meaningful for :memory: but setting it keeps the
  // configuration path consistent with production.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite) as BetterSQLite3Database;
  return { sqlite, db };
}

/**
 * Create an in-memory SQLite ProjectDbConnection for integration tests.
 *
 * The returned connection has the same ProjectDbConnection shape as
 * production (sqlite + db), backed by an ephemeral in-memory database.
 */
export function createTestConnection(): {
  conn: ProjectDbConnection;
  teardown: () => void;
} {
  const { sqlite, db } = createTestDb();
  return {
    conn: { sqlite, db },
    teardown: () => sqlite.close(),
  };
}
