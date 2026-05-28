import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
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

export function assertMigrationsReady(options: {
  projectRoot: string;
  apiDistDir: string;
  sqlite: Database.Database;
  tables: TableDef[];
}): void {
  if (options.tables.length === 0) return;

  const migrationsDir = join(options.projectRoot, "packages", "api", "migrations");
  if (!existsSync(migrationsDir)) {
    throw migrationError([
      "Migration directory is missing.",
      "",
      `Expected: ${migrationsDir}`,
      "",
      "Run:",
      "  pnpm --filter ./packages/api db:generate --name init",
      "  pnpm --filter ./packages/api db:migrate",
    ]);
  }

  const diskMigrations = readDrizzleMigrationFiles(migrationsDir);
  const journalTags = readJournalTags(migrationsDir);
  const diskByWhen = new Map(diskMigrations.map((migration) => [migration.folderMillis, migration]));
  const applied = readLedger(options.sqlite);
  const appliedTimes = new Set(applied.map((row) => normalizeCreatedAt(row.created_at)));
  const pending = diskMigrations.filter((migration) => !appliedTimes.has(migration.folderMillis));
  const missingOnDisk = applied.filter((row) => {
    const createdAt = normalizeCreatedAt(row.created_at);
    return createdAt !== null && !diskByWhen.has(createdAt);
  });

  if (pending.length === 0 && missingOnDisk.length === 0) return;

  const lines = ["Sapporta migrations are not ready.", ""];
  if (pending.length > 0) {
    lines.push(pending.length === 1 ? "Pending migration:" : "Pending migrations:");
    for (const migration of pending) {
      lines.push(`  ${journalTags.get(migration.folderMillis) ?? migration.folderMillis}`);
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
  lines.push("Run:", "  pnpm --filter ./packages/api db:migrate");
  throw migrationError(lines);
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
    .prepare(`SELECT hash, created_at FROM "${DRIZZLE_LEDGER_TABLE}" ORDER BY created_at ASC`)
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
      return typeof candidate.tag === "string" && typeof candidate.when === "number";
    })
  );
}

function migrationError(lines: string[]): Error {
  return new Error(lines.join("\n"));
}
