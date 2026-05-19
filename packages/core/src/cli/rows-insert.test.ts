import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { rowsInsert } from "./rows-insert.js";
import type { SqlClient } from "../introspect/types.js";

/**
 * Create a SqlClient adapter from a better-sqlite3 Database.
 *
 * The returned object is both a SqlClient (for rowsInsert's type signature)
 * and a Database.Database proxy (for the `sql as any` casts inside
 * rowsInsert that pass it to synchronous db-helpers functions like
 * validatePayloadColumns, assertTableExists, etc.).
 *
 * We achieve this by adding SqlClient methods directly onto the sqlite handle.
 */
function createTestSql(sqlite: Database.Database): SqlClient & Database.Database {
  const extended = sqlite as any;
  extended.unsafe = (query: string, params?: any[]) => {
    return Promise.resolve(sqlite.prepare(query).all(...(params ?? [])));
  };
  extended.begin = async () => {
    throw new Error("Not implemented");
  };
  extended.end = async () => {};
  return extended;
}

describe("rows insert", () => {
  let sqlite: Database.Database;
  let sql: SqlClient;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sql = createTestSql(sqlite);
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts a single row", async () => {
    const result = await rowsInsert(sql, "accounts", '{"name":"Cash","type":"asset"}');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Cash");
    expect(result.data[0].type).toBe("asset");

    // Verify in DB
    const rows = sqlite.prepare("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(1);
  });

  it("inserts multiple rows from array", async () => {
    const result = await rowsInsert(
      sql,
      "accounts",
      '[{"name":"Cash","type":"asset"},{"name":"Revenue","type":"revenue"}]',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);

    const rows = sqlite.prepare("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(2);
  });

  it("returns inserted row data", async () => {
    const result = await rowsInsert(sql, "accounts", '{"name":"Cash","type":"asset"}');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.message).toContain("Inserted 1 row(s)");
    expect(result.data[0].name).toBe("Cash");
  });

  it("rejects invalid table names", async () => {
    await expect(
      rowsInsert(sql, "'; DROP TABLE accounts; --", '{"name":"x"}'),
    ).rejects.toThrow("Invalid table name");
  });

  it("rejects invalid JSON", async () => {
    await expect(
      rowsInsert(sql, "accounts", "not json"),
    ).rejects.toThrow();
  });

  it("rejects column names with injection characters", async () => {
    await expect(
      rowsInsert(sql, "accounts", '{"name; DROP TABLE accounts":"Cash","type":"asset"}'),
    ).rejects.toThrow("Invalid column name");
  });

  it("rejects data containing control characters", async () => {
    await expect(
      rowsInsert(sql, "accounts", '{"name":"Cash\x00","type":"asset"}'),
    ).rejects.toThrow("control characters");
  });

  // -- Dry-run tests --

  it("dry-run validates successfully without inserting", async () => {
    const result = await rowsInsert(sql, "accounts", '{"name":"Cash","type":"asset"}', true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.dryRun).toBe(true);
    expect(result.meta?.validationPassed).toBe(true);

    // Verify nothing was actually inserted
    const rows = sqlite.prepare("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(0);
  });

  it("dry-run catches nonexistent table", async () => {
    await expect(
      rowsInsert(sql, "nonexistent", '{"name":"Cash"}', true),
    ).rejects.toThrow("not found");
  });

  it("dry-run catches unknown columns", async () => {
    await expect(
      rowsInsert(sql, "accounts", '{"name":"Cash","bogus_column":"x"}', true),
    ).rejects.toThrow("Unknown column");
  });
});
