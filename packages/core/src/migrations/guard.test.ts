import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { readMigrationFiles } from "drizzle-orm/migrator";
import Database from "better-sqlite3";
import { createTestDb } from "../testing/test-utils.js";
import { sapportaTable } from "../schema/table.js";
import {
  applyMigrations,
  assertMigrationsReady,
  pendingMigrations,
} from "./guard.js";

const sampleTable = sapportaTable({
  drizzle: sqliteTable("sample", {
    id: integer("id").primaryKey({ autoIncrement: true }),
  }),
  meta: { rowLabelColumns: ["id"] },
});

const INITIAL_SQL =
  "CREATE TABLE `sample` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL);\n";
const ADD_NOTE_SQL = "ALTER TABLE `sample` ADD `note` text;\n";

describe("assertMigrationsReady", () => {
  it("reports pending migrations from Drizzle's journal", () => {
    const projectRoot = projectWithJournal([
      { tag: "0000_initial", when: 1760000000000 },
    ]);
    const conn = createTestDb();

    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "packages/api/dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
      }),
    ).toThrow(/Pending migration:\n  0000_initial/);
  });

  it("names the database it checked", () => {
    const projectRoot = projectWithJournal([
      { tag: "0000_initial", when: 1760000000000 },
    ]);
    const databaseFile = join(projectRoot, "sqlite.db");
    const sqlite = new Database(databaseFile);

    try {
      expect(() =>
        assertMigrationsReady({
          projectRoot,
          apiDistDir: join(projectRoot, "packages/api/dist"),
          sqlite,
          tables: [sampleTable],
        }),
      ).toThrow(`Database: ${databaseFile}\n`);
    } finally {
      sqlite.close();
    }
  });

  it("reports applied ledger entries missing from disk", () => {
    const projectRoot = projectWithJournal([
      { tag: "0000_initial", when: 1760000000000 },
    ]);
    const hash = migrationHash(projectRoot, 1760000000000);
    const conn = createTestDb();
    conn.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    conn.sqlite
      .prepare(
        'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?), (?, ?)',
      )
      .run(hash, 1760000000000, "def", 1760000001000);

    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "packages/api/dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
      }),
    ).toThrow(
      /Applied migration missing from disk:\n  created_at=1760000001000 hash=def/,
    );
  });

  it("reports modified migration files after they have been applied", () => {
    const projectRoot = projectWithJournal([
      { tag: "0000_initial", when: 1760000000000 },
    ]);
    const conn = createTestDb();
    conn.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO "__drizzle_migrations" (hash, created_at)
      VALUES ('stale-hash', 1760000000000);
    `);

    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "packages/api/dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
      }),
    ).toThrow(
      /Applied migration hash differs from disk:\n  created_at=1760000000000 hash=stale-hash/,
    );
  });

  it("passes when journal entries and ledger rows match", () => {
    const projectRoot = projectWithJournal([
      { tag: "0000_initial", when: 1760000000000 },
    ]);
    const hash = migrationHash(projectRoot, 1760000000000);
    const conn = createTestDb();
    conn.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    conn.sqlite
      .prepare(
        'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
      )
      .run(hash, 1760000000000);

    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "packages/api/dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
      }),
    ).not.toThrow();
  });
});

describe("migrations in a directory the app names", () => {
  // The migrations sit outside the project root, as they do for an app that
  // ships them inside its own installed package.
  const entries = [
    { tag: "0000_initial", when: 1760000000000, sql: INITIAL_SQL },
    { tag: "0001_add_note", when: 1760000001000, sql: ADD_NOTE_SQL },
  ];

  it("applies the migrations and reports none pending afterwards", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "sapporta-project-"));
    const migrationsDir = mkdtempSync(join(tmpdir(), "sapporta-app-package-"));
    writeMigrations(migrationsDir, entries);
    const conn = createTestDb();

    expect(pendingMigrations(conn.sqlite, migrationsDir)).toEqual([
      { tag: "0000_initial", folderMillis: 1760000000000 },
      { tag: "0001_add_note", folderMillis: 1760000001000 },
    ]);

    expect(applyMigrations(conn.sqlite, migrationsDir)).toEqual([
      { tag: "0000_initial", folderMillis: 1760000000000 },
      { tag: "0001_add_note", folderMillis: 1760000001000 },
    ]);
    expect(pendingMigrations(conn.sqlite, migrationsDir)).toEqual([]);
    expect(applyMigrations(conn.sqlite, migrationsDir)).toEqual([]);
    expect(
      conn.sqlite.prepare("SELECT name FROM pragma_table_info('sample')").all(),
    ).toEqual([{ name: "id" }, { name: "note" }]);
    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
        migrationsDir,
      }),
    ).not.toThrow();
  });

  it("reports a pending migration in that directory", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "sapporta-project-"));
    const migrationsDir = mkdtempSync(join(tmpdir(), "sapporta-app-package-"));
    writeMigrations(migrationsDir, entries.slice(0, 1));
    const conn = createTestDb();
    applyMigrations(conn.sqlite, migrationsDir);
    writeMigrations(migrationsDir, entries);

    expect(pendingMigrations(conn.sqlite, migrationsDir)).toEqual([
      { tag: "0001_add_note", folderMillis: 1760000001000 },
    ]);
    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
        migrationsDir,
      }),
    ).toThrow(
      new RegExp(
        `Pending migration:\\n  0001_add_note\\n\\nMigrations: ${migrationsDir}$`,
      ),
    );
  });

  it("refuses a pending migration dated before the latest applied one", () => {
    const migrationsDir = mkdtempSync(join(tmpdir(), "sapporta-app-package-"));
    writeMigrations(migrationsDir, [entries[0]]);
    const conn = createTestDb();
    applyMigrations(conn.sqlite, migrationsDir);
    // A migration from another branch, dated before the one already applied.
    writeMigrations(migrationsDir, [
      { tag: "0000_from_branch", when: 1759999999000, sql: ADD_NOTE_SQL },
      entries[0],
    ]);

    expect(() => applyMigrations(conn.sqlite, migrationsDir)).toThrow(
      /dated before the latest applied migration[\s\S]*0000_from_branch/,
    );
    expect(pendingMigrations(conn.sqlite, migrationsDir)).toEqual([
      { tag: "0000_from_branch", folderMillis: 1759999999000 },
    ]);
  });

  it("names the directory when it is missing", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "sapporta-project-"));
    const migrationsDir = join(projectRoot, "elsewhere");
    const conn = createTestDb();

    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
        migrationsDir,
      }),
    ).toThrow(`Migration directory is missing.\n\nExpected: ${migrationsDir}`);
  });
});

function projectWithJournal(
  entries: Array<{ tag: string; when: number }>,
): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "sapporta-migrations-"));
  writeMigrations(join(projectRoot, "packages/api/migrations"), entries);
  return projectRoot;
}

function writeMigrations(
  migrationsDir: string,
  entries: Array<{ tag: string; when: number; sql?: string }>,
): void {
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
  for (const entry of entries) {
    writeFileSync(
      join(migrationsDir, `${entry.tag}.sql`),
      entry.sql ?? "SELECT 1;\n",
    );
  }
  writeFileSync(
    join(migrationsDir, "meta/_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "sqlite",
        entries: entries.map((entry, idx) => ({
          idx,
          version: "6",
          when: entry.when,
          tag: entry.tag,
          breakpoints: true,
        })),
      },
      null,
      2,
    ),
  );
}

function migrationHash(projectRoot: string, folderMillis: number): string {
  const migration = readMigrationFiles({
    migrationsFolder: join(projectRoot, "packages/api/migrations"),
  }).find((candidate) => candidate.folderMillis === folderMillis);
  if (!migration) {
    throw new Error(`Missing test migration for ${folderMillis}`);
  }
  return migration.hash;
}
