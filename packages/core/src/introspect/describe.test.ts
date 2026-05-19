import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbDescribe } from "./describe.js";

describe("db describe", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("describes table columns", () => {
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        balance INTEGER
      )
    `);

    const result = dbDescribe(sqlite, "accounts");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const columnNames = result.data.map((r) => r.column_name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("balance");
    expect(result.meta?.tableName).toBe("accounts");
  });

  it("shows foreign keys", () => {
    sqlite.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
    sqlite.exec(`
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        amount INTEGER NOT NULL
      )
    `);

    const result = dbDescribe(sqlite, "invoices");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fks = result.meta?.foreignKeys as Record<string, unknown>[];
    expect(fks).toHaveLength(1);
    expect(fks[0].column_name).toBe("account_id");
    expect(fks[0].foreign_table).toBe("accounts");
  });

  it("shows message for nonexistent table", () => {
    const result = dbDescribe(sqlite, "nonexistent");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.message).toBe("Table 'nonexistent' not found.");
  });
});
