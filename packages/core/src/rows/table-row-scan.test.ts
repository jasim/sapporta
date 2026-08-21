import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import { sapportaTable } from "../schema/table.js";
import { createTestDb } from "../testing/test-utils.js";
import { scanTableRows } from "./table-row-scan.js";

const entriesTable = sqliteTable("scan_entries", {
  id: integer("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
  priority: integer("priority").notNull(),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull(),
});

const entries = sapportaTable({
  drizzle: entriesTable,
  meta: {
    rowScope: "systemGlobal",
    rowLabelColumns: ["title"],
  },
});

function createEntriesDatabase() {
  const connection = createTestDb();
  connection.sqlite.exec(`
    CREATE TABLE scan_entries (
      id INTEGER PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      priority INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL
    );
    INSERT INTO scan_entries
      (id, workspace_id, title, priority, occurred_at, is_active)
    VALUES
      (1, 'workspace-1', 'One',   2, 1785196800000, 1),
      (2, 'workspace-2', 'Two',   5, 1785283200000, 1),
      (3, 'workspace-1', 'Three', 3, 1785369600000, 1),
      (4, 'workspace-1', 'Four',  3, 1785456000000, 1),
      (5, 'workspace-1', 'Five',  1, 1785542400000, 0);
  `);
  return connection;
}

async function collectRows(
  rows: AsyncIterable<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

function sqliteStatement(value: unknown): Database.Statement {
  if (
    typeof value !== "object" ||
    value === null ||
    !("busy" in value) ||
    typeof value.busy !== "boolean"
  ) {
    throw new TypeError("Expected a better-sqlite3 statement.");
  }
  return value as Database.Statement;
}

describe("scanTableRows", () => {
  it("returns complete scoped and deterministically ordered rows with one query", async () => {
    const { db, sqlite } = createEntriesDatabase();
    const prepare = vi.spyOn(sqlite, "prepare");

    try {
      const rows = await collectRows(
        scanTableRows(db, entries, {
          where: and(
            eq(entriesTable.workspaceId, "workspace-1"),
            eq(entriesTable.isActive, true),
          ),
          orderBy: desc(entriesTable.priority),
        }),
      );

      expect(rows.map((row) => row.id)).toEqual([3, 4, 1]);
      expect(prepare).toHaveBeenCalledTimes(1);
      const sql = prepare.mock.calls[0]?.[0];
      expect(sql).toMatch(/^select /i);
      expect(sql).not.toMatch(/\boffset\b/i);
    } finally {
      prepare.mockRestore();
      sqlite.close();
    }
  });

  it("matches Drizzle boolean and timestamp decoding under SQL names", async () => {
    const { db, sqlite } = createEntriesDatabase();

    try {
      const drizzleRows = await db
        .select({
          id: entriesTable.id,
          workspace_id: entriesTable.workspaceId,
          title: entriesTable.title,
          priority: entriesTable.priority,
          occurred_at: entriesTable.occurredAt,
          is_active: entriesTable.isActive,
        })
        .from(entriesTable)
        .orderBy(entriesTable.id);
      const scannedRows = await collectRows(scanTableRows(db, entries));

      expect(scannedRows).toEqual(drizzleRows);
      expect(scannedRows[0]).toEqual({
        id: 1,
        workspace_id: "workspace-1",
        title: "One",
        priority: 2,
        occurred_at: new Date(1785196800000),
        is_active: true,
      });
      expect(scannedRows[4]?.is_active).toBe(false);
      expect(scannedRows[0]).not.toHaveProperty("workspaceId");
      expect(scannedRows[0]).not.toHaveProperty("occurredAt");
      expect(scannedRows[0]).not.toHaveProperty("isActive");
    } finally {
      sqlite.close();
    }
  });

  it("releases the active statement when the consumer stops early", async () => {
    const { db, sqlite } = createEntriesDatabase();
    const prepare = vi.spyOn(sqlite, "prepare");

    try {
      for await (const row of scanTableRows(db, entries)) {
        expect(row.id).toBe(1);
        const statement = sqliteStatement(prepare.mock.results[0]?.value);
        expect(statement.busy).toBe(true);
        break;
      }

      const statement = sqliteStatement(prepare.mock.results[0]?.value);
      expect(statement.busy).toBe(false);
    } finally {
      prepare.mockRestore();
      sqlite.close();
    }
  });

  it("holds one SQLite read snapshot while a second connection writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sapporta-table-row-scan-"));
    const filename = join(directory, "scan.sqlite");
    const reader = new Database(filename);
    reader.pragma("journal_mode = WAL");
    const writer = new Database(filename);
    let cursor:
      AsyncIterator<Record<string, unknown>, void, undefined> | undefined;

    try {
      reader.exec(`
        CREATE TABLE scan_entries (
          id INTEGER PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          title TEXT NOT NULL,
          priority INTEGER NOT NULL,
          occurred_at INTEGER NOT NULL,
          is_active INTEGER NOT NULL
        );
        INSERT INTO scan_entries
          (id, workspace_id, title, priority, occurred_at, is_active)
        VALUES
          (1, 'workspace-1', 'One', 1, 1785196800000, 1),
          (2, 'workspace-1', 'Two', 2, 1785283200000, 1);
      `);
      const db = drizzle(reader);
      cursor = scanTableRows(db, entries)[Symbol.asyncIterator]();

      await expect(cursor.next()).resolves.toMatchObject({
        done: false,
        value: { id: 1 },
      });
      writer
        .prepare(
          `INSERT INTO scan_entries
            (id, workspace_id, title, priority, occurred_at, is_active)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(3, "workspace-1", "Three", 3, 1785369600000, 1);

      const remaining: Record<string, unknown>[] = [];
      while (true) {
        const result = await cursor.next();
        if (result.done) break;
        remaining.push(result.value);
      }
      expect(remaining.map((row) => row.id)).toEqual([2]);
      expect(
        writer.prepare("SELECT COUNT(*) AS count FROM scan_entries").get(),
      ).toEqual({ count: 3 });
    } finally {
      await cursor?.return?.();
      writer.close();
      reader.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
