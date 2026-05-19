// ============================================================================
// SQLite Schema Migration — push schema changes via drizzle-kit/api
// ============================================================================
//
// drizzle-kit/api verification results (Step 1.2):
//   - Export: pushSQLiteSchema (separate function from pushSchema)
//   - Signature: pushSQLiteSchema(imports, drizzleInstance)
//     - imports: Record<string, SQLiteTable> (flat object of table names → Drizzle objects)
//     - drizzleInstance: BetterSQLite3Database (uses .all() and .run() internally)
//   - Returns: { hasDataLoss, warnings, statementsToExecute: string[], apply() }
//   - NO tablesFilter parameter (unlike Postgres pushSchema which has one)
//   - apply() executes ALL statementsToExecute — we don't call it, we execute
//     filtered statements manually to skip destructive DROPs
//
// Differences from the old Postgres migrate.ts:
//   - No PgEnum parameter (SQLite has no native enums)
//   - No db.execute(sql.raw()) proxy wrapper (SQLite Drizzle doesn't have
//     the Postgres res.rows compatibility issue)
//   - sqlite.exec(stmt) for direct DDL execution instead of db.execute()
//   - DROP SEQUENCE/DROP TYPE patterns removed (SQLite doesn't have these)
//   - No tablesFilter — pushSQLiteSchema introspects ALL tables in the DB,
//     so the destructive DROP filter is the only defense against dropping
//     UI-managed tables. This is adequate because:
//       1. The statement filter catches DROP TABLE for UI tables
//       2. SQLite has no sequences or custom types to produce spurious DROPs
//
// Same two-layer safety philosophy as the old Postgres version, but Layer 1
// (tablesFilter) is unavailable, so Layer 2 (statement filter) is the
// primary defense.

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { pushSQLiteSchema } from "drizzle-kit/api";
import type { TableDef } from "./table.js";
import { logger } from "../db/logger.js";

const log = logger.child({ module: "schema" });

/**
 * Matches destructive DROP statements that should never be auto-executed.
 *
 * Only top-level DROP TABLE and DROP INDEX are relevant for SQLite.
 * ALTER TABLE ... DROP COLUMN is intentionally NOT matched — dropping
 * a column is a legitimate schema change when a developer removes it
 * from a file-managed table definition.
 */
const DESTRUCTIVE_DROP = [/^DROP\s+TABLE\b/i, /^DROP\s+INDEX\b/i];

function isDestructiveDrop(stmt: string): boolean {
  return DESTRUCTIVE_DROP.some((re) => re.test(stmt.trimStart()));
}

/**
 * Push file-managed schema changes to the SQLite database.
 *
 * ## Safety: no tablesFilter available
 *
 * Unlike Postgres's pushSchema which accepts a tablesFilter for positive
 * inclusion, pushSQLiteSchema introspects ALL tables in the database.
 * This means UI-managed tables appear as "extra" and generate DROP TABLE
 * statements. The destructive statement filter is the sole defense:
 * it strips all DROP TABLE/DROP INDEX before execution.
 *
 * This is safe because:
 * 1. UI-managed tables are created via direct DDL, not schema push
 * 2. The only way a DROP TABLE appears is if a table exists in DB but
 *    not in the schema objects — which is exactly the UI-managed case
 * 3. SQLite has no sequences or custom types that could cause spurious DROPs
 *
 * ## Caller invariant
 *
 * The `schemas` parameter must contain only file-managed tables.
 * The caller passes registry.fileManaged(), not registry.all().
 *
 * @returns Object with applied and skipped statement lists for logging.
 */
export async function migrateSchemas(
  schemas: TableDef[],
  db: BetterSQLite3Database,
  sqlite: Database.Database,
): Promise<{ applied: string[]; skipped: string[] }> {
  if (schemas.length === 0) {
    log.info("Schema is up to date");
    return { applied: [], skipped: [] };
  }

  // Build the imports record: flat object of { tableName: DrizzleTable }
  const imports: Record<string, unknown> = {};
  for (const schema of schemas) {
    imports[schema.sqlName] = schema.drizzle;
  }

  // IMPORTANT: Temporarily remove non-schema tables from the database
  // before calling pushSQLiteSchema.
  //
  // pushSQLiteSchema introspects ALL tables in the database. If it finds
  // tables that aren't in the schema definition (like _sapporta_tables,
  // _sapporta_columns, or UI-managed tables), it triggers an interactive
  // prompt asking whether each new schema table should be created fresh or
  // renamed from an existing table. This prompt hangs in non-interactive
  // environments (tests, CI, automated deploys).
  //
  // The workaround: save the DDL + data for non-schema tables, drop them,
  // run pushSQLiteSchema on a clean DB, then restore. SQLite makes this
  // safe because all operations are synchronous and single-threaded — no
  // concurrent access can observe the temporary state.
  const schemaTableNames = new Set(Object.keys(imports));
  const allTables = sqlite.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  ).all() as { name: string; sql: string }[];

  // Save state of tables that aren't part of the file-managed schema
  const hiddenTables: { name: string; ddl: string; rows: unknown[] }[] = [];
  for (const { name, sql: ddl } of allTables) {
    if (!schemaTableNames.has(name)) {
      // Save the CREATE TABLE DDL and all rows
      const rows = sqlite.prepare(`SELECT * FROM "${name}"`).all();
      hiddenTables.push({ name, ddl, rows });
    }
  }

  // Drop non-schema tables so pushSQLiteSchema doesn't see them.
  // Order matters: drop child tables (with FK references) before parents.
  // Temporarily disable FK checks to avoid constraint violations during drop.
  sqlite.pragma("foreign_keys = OFF");
  for (const { name } of hiddenTables) {
    sqlite.exec(`DROP TABLE "${name}"`);
  }
  sqlite.pragma("foreign_keys = ON");

  let result;
  try {
    // Cast to any: drizzle-kit's type declarations expect LibSQLDatabase
    // but the runtime implementation only uses .all() and .run() which
    // BetterSQLite3Database provides. Verified working in Step 1.2 spike.
    result = await pushSQLiteSchema(imports, db as any);
  } finally {
    // Restore hidden tables regardless of success/failure.
    // Disable FK checks during restore to handle any FK ordering issues.
    sqlite.pragma("foreign_keys = OFF");
    for (const { name, ddl, rows } of hiddenTables) {
      sqlite.exec(ddl);
      if (rows.length > 0) {
        // Rebuild INSERT from row data. Use the column names from the first row.
        const cols = Object.keys(rows[0] as Record<string, unknown>);
        const placeholders = cols.map(() => "?").join(", ");
        const insertStmt = sqlite.prepare(
          `INSERT INTO "${name}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`
        );
        const insertAll = sqlite.transaction((data: unknown[]) => {
          for (const row of data) {
            const values = cols.map(c => (row as Record<string, unknown>)[c]);
            insertStmt.run(...values);
          }
        });
        insertAll(rows);
      }
    }
    sqlite.pragma("foreign_keys = ON");
  }

  if (result.warnings.length > 0) {
    log.warn("Schema migration warnings", { warnings: result.warnings });
  }

  // Filter destructive statements — primary defense since no tablesFilter
  const safe: string[] = [];
  const skipped: string[] = [];
  for (const stmt of result.statementsToExecute) {
    if (isDestructiveDrop(stmt)) {
      skipped.push(stmt);
    } else {
      safe.push(stmt);
    }
  }

  if (skipped.length > 0) {
    log.warn("Skipped destructive statements", { statements: skipped });
  }

  if (safe.length > 0) {
    log.info(`Applying ${safe.length} schema change(s)`);
    // Execute each statement via better-sqlite3's synchronous exec().
    // Unlike the old Postgres version which used db.execute(sql.raw()) for
    // PGlite compatibility, SQLite always has exec() available.
    for (const stmt of safe) {
      sqlite.exec(stmt);
    }
    log.info("Schema migration complete");
  } else {
    log.info("Schema is up to date");
  }

  return { applied: safe, skipped };
}
