import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { createTestDb } from "../testing/test-utils.js";
import { table } from "../schema/table.js";
import { assertMigrationsReady } from "./guard.js";

const sampleTable = table({
  drizzle: sqliteTable("sample", {
    id: integer("id").primaryKey({ autoIncrement: true }),
  }),
});

describe("assertMigrationsReady", () => {
  it("reports pending migrations from Drizzle's journal", () => {
    const projectRoot = projectWithJournal([{ tag: "0000_initial", when: 1760000000000 }]);
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

  it("reports applied ledger entries missing from disk", () => {
    const projectRoot = projectWithJournal([{ tag: "0000_initial", when: 1760000000000 }]);
    const conn = createTestDb();
    conn.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO "__drizzle_migrations" (hash, created_at)
      VALUES ('abc', 1760000000000), ('def', 1760000001000);
    `);

    expect(() =>
      assertMigrationsReady({
        projectRoot,
        apiDistDir: join(projectRoot, "packages/api/dist"),
        sqlite: conn.sqlite,
        tables: [sampleTable],
      }),
    ).toThrow(/Applied migration missing from disk:\n  created_at=1760000001000 hash=def/);
  });

  it("passes when journal entries and ledger rows match", () => {
    const projectRoot = projectWithJournal([{ tag: "0000_initial", when: 1760000000000 }]);
    const conn = createTestDb();
    conn.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO "__drizzle_migrations" (hash, created_at)
      VALUES ('abc', 1760000000000);
    `);

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

function projectWithJournal(entries: Array<{ tag: string; when: number }>): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "sapporta-migrations-"));
  const migrationsDir = join(projectRoot, "packages/api/migrations");
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
  for (const entry of entries) {
    writeFileSync(join(migrationsDir, `${entry.tag}.sql`), "SELECT 1;\n");
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
  return projectRoot;
}
