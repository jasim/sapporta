import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbListTables } from "./list-tables.js";

describe("db list-tables", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("lists tables in the database", () => {
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER);
    `);

    const result = dbListTables(sqlite);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tableNames = result.data.map((r) => r.table_name);
    expect(tableNames).toContain("accounts");
    expect(tableNames).toContain("invoices");
  });

  it("shows message when no tables exist", () => {
    const result = dbListTables(sqlite);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.message).toBe("No tables found.");
  });
});
