import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { MigrationMeta } from "drizzle-orm/migrator";
import type { TableDef } from "../schema/table.js";

const DRIZZLE_LEDGER_TABLE = "__drizzle_migrations";

type JournalEntry = {
  tag: string;
  when: number;
};

type Journal = {
  entries: JournalEntry[];
};

type LedgerRow = {
  hash: string;
  created_at: number | string | null;
};

/** A migration file on disk that the database's ledger does not list. */
export type PendingMigration = {
  /** The migration's name in Drizzle's journal, such as `0003_add_notes`. */
  tag: string;
  /** The journal's `when` timestamp, which is how the ledger identifies it. */
  folderMillis: number;
};

/**
 * The migrations in `migrationsDir` that have not been applied to `sqlite`,
 * oldest first. `migrationsDir` is a directory written by `drizzle-kit
 * generate`: SQL files beside `meta/_journal.json`.
 */
export function pendingMigrations(
  sqlite: Database.Database,
  migrationsDir: string,
): PendingMigration[] {
  return readMigrationState(sqlite, migrationsDir).pending;
}

/**
 * Apply the pending migrations in `migrationsDir` to `sqlite` and return the
 * ones that were applied. This runs drizzle-orm's own `migrate()`, so an app
 * can migrate its database at startup from its own code.
 *
 * `migrate()` applies only the migrations dated after the latest one in the
 * ledger, and it applies them in one transaction: all of them or, on an
 * error, none. A pending migration dated at or before the latest applied one,
 * such as one merged in from another branch, would be skipped without an
 * error. This function therefore refuses to migrate when it finds one.
 */
export function applyMigrations(
  sqlite: Database.Database,
  migrationsDir: string,
): PendingMigration[] {
  const pending = pendingMigrations(sqlite, migrationsDir);
  if (pending.length === 0) return [];

  const latestApplied = Math.max(
    ...readLedger(sqlite).map((row) => normalizeCreatedAt(row.created_at) ?? 0),
  );
  const outOfOrder = pending.filter(
    (migration) => migration.folderMillis <= latestApplied,
  );
  if (outOfOrder.length > 0) {
    throw migrationError([
      "Migrations are dated before the latest applied migration.",
      "",
      "Drizzle applies only migrations dated after the latest one in the ledger,",
      "so it would skip these:",
      ...outOfOrder.map((migration) => `  ${migration.tag}`),
      "",
      `Migrations: ${migrationsDir}`,
    ]);
  }

  migrate(drizzle(sqlite), { migrationsFolder: migrationsDir });
  return pending;
}

export function assertMigrationsReady(options: {
  projectRoot: string;
  apiDistDir: string;
  sqlite: Database.Database;
  tables: readonly TableDef[];
  /**
   * Absolute path to the directory holding the Drizzle migrations. Defaults
   * to `packages/api/migrations` under `projectRoot`.
   */
  migrationsDir?: string;
}): void {
  if (options.tables.length === 0) return;

  const migrationsDir =
    options.migrationsDir ??
    join(options.projectRoot, "packages", "api", "migrations");
  // The commands below belong to the default project layout. An app that
  // names its own directory also migrates its own way.
  const usesDefaultDir = options.migrationsDir === undefined;
  if (!existsSync(migrationsDir)) {
    throw migrationError([
      "Migration directory is missing.",
      "",
      `Expected: ${migrationsDir}`,
      ...(usesDefaultDir
        ? [
            "",
            "Run:",
            "  pnpm --filter ./packages/api db:generate --name init",
            "  pnpm --filter ./packages/api db:migrate",
          ]
        : []),
    ]);
  }

  const { pending, missingOnDisk, changedOnDisk } = readMigrationState(
    options.sqlite,
    migrationsDir,
  );

  if (
    pending.length === 0 &&
    missingOnDisk.length === 0 &&
    changedOnDisk.length === 0
  )
    return;

  const lines = [
    "Sapporta migrations are not ready.",
    "",
    // The database is named because a wrong SAPPORTA_DATA_DIR looks exactly
    // like a database that was never migrated.
    `Database: ${options.sqlite.name}`,
    "",
  ];
  if (pending.length > 0) {
    lines.push(
      pending.length === 1 ? "Pending migration:" : "Pending migrations:",
    );
    for (const migration of pending) {
      lines.push(`  ${migration.tag}`);
    }
    lines.push("");
  }
  if (missingOnDisk.length > 0) {
    lines.push(
      missingOnDisk.length === 1
        ? "Applied migration missing from disk:"
        : "Applied migrations missing from disk:",
    );
    for (const row of missingOnDisk) {
      lines.push(`  created_at=${String(row.created_at)} hash=${row.hash}`);
    }
    lines.push("");
  }
  if (changedOnDisk.length > 0) {
    lines.push(
      changedOnDisk.length === 1
        ? "Applied migration hash differs from disk:"
        : "Applied migration hashes differ from disk:",
    );
    for (const row of changedOnDisk) {
      lines.push(`  created_at=${String(row.created_at)} hash=${row.hash}`);
    }
    lines.push("");
  }
  if (usesDefaultDir) {
    lines.push("Run:", "  pnpm --filter ./packages/api db:migrate");
  } else {
    lines.push(`Migrations: ${migrationsDir}`);
  }
  throw migrationError(lines);
}

/** Compare the migration files on disk with the database's ledger. */
function readMigrationState(
  sqlite: Database.Database,
  migrationsDir: string,
): {
  pending: PendingMigration[];
  missingOnDisk: LedgerRow[];
  changedOnDisk: LedgerRow[];
} {
  const diskMigrations = readDrizzleMigrationFiles(migrationsDir);
  const journalTags = readJournalTags(migrationsDir);
  const diskByWhen = new Map(
    diskMigrations.map((migration) => [migration.folderMillis, migration]),
  );
  const applied = readLedger(sqlite);
  const appliedTimes = new Set(
    applied.map((row) => normalizeCreatedAt(row.created_at)),
  );
  const pending = diskMigrations
    .filter((migration) => !appliedTimes.has(migration.folderMillis))
    .map((migration) => ({
      tag:
        journalTags.get(migration.folderMillis) ??
        String(migration.folderMillis),
      folderMillis: migration.folderMillis,
    }));
  const missingOnDisk = applied.filter((row) => {
    const createdAt = normalizeCreatedAt(row.created_at);
    return createdAt !== null && !diskByWhen.has(createdAt);
  });
  const changedOnDisk = applied.filter((row) => {
    const createdAt = normalizeCreatedAt(row.created_at);
    if (createdAt === null) return false;
    const diskMigration = diskByWhen.get(createdAt);
    return diskMigration !== undefined && diskMigration.hash !== row.hash;
  });
  return { pending, missingOnDisk, changedOnDisk };
}

function readDrizzleMigrationFiles(migrationsDir: string): MigrationMeta[] {
  try {
    return readMigrationFiles({ migrationsFolder: migrationsDir });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw migrationError([
      "Drizzle migration files are unreadable.",
      "",
      `Directory: ${migrationsDir}`,
      `Reason: ${message}`,
      "",
      "Run:",
      "  pnpm --filter ./packages/api db:generate --name init",
      "  pnpm --filter ./packages/api db:migrate",
    ]);
  }
}

function readJournalTags(migrationsDir: string): Map<number, string> {
  const journalPath = join(migrationsDir, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    return new Map();
  }

  const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf-8"));
  if (!isJournal(parsed)) {
    return new Map();
  }
  return new Map(parsed.entries.map((entry) => [entry.when, entry.tag]));
}

function readLedger(sqlite: Database.Database): LedgerRow[] {
  const exists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(DRIZZLE_LEDGER_TABLE);
  if (!exists) return [];
  return sqlite
    .prepare(
      `SELECT hash, created_at FROM "${DRIZZLE_LEDGER_TABLE}" ORDER BY created_at ASC`,
    )
    .all() as LedgerRow[];
}

function normalizeCreatedAt(value: LedgerRow["created_at"]): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isJournal(value: unknown): value is Journal {
  if (typeof value !== "object" || value === null) return false;
  const entries = (value as { entries?: unknown }).entries;
  return (
    Array.isArray(entries) &&
    entries.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as { tag?: unknown; when?: unknown };
      return (
        typeof candidate.tag === "string" && typeof candidate.when === "number"
      );
    })
  );
}

function migrationError(lines: string[]): Error {
  return new Error(lines.join("\n"));
}
