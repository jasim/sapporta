import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbDescribeAll } from "./describe-all.js";

describe("db describe-all", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("returns all tables with their columns", () => {
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER);
    `);

    const result = dbDescribeAll(sqlite);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Structured per-table data is in meta.tables
    const tables = result.meta?.tables as any[];
    expect(tables).toHaveLength(2);

    const tableNames = tables.map((t: any) => t.table_name);
    expect(tableNames).toContain("accounts");
    expect(tableNames).toContain("invoices");

    // Check columns are populated
    const accounts = tables.find(
      (t: any) => t.table_name === "accounts",
    ) as any;
    const colNames = accounts.columns.map((c: any) => c.column_name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
  });

  it("includes foreign keys in column data", () => {
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER REFERENCES accounts(id)
      );
    `);

    const result = dbDescribeAll(sqlite);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // FK info is embedded in the column descriptions
    const tables = result.meta?.tables as any[];
    const invoices = tables.find(
      (t: any) => t.table_name === "invoices",
    ) as any;
    const fkCol = invoices.columns.find(
      (c: any) => c.column_name === "account_id",
    );
    expect(fkCol.foreign_table).toBe("accounts");
    expect(fkCol.foreign_column).toBe("id");
  });

  it("returns empty when no tables", () => {
    const result = dbDescribeAll(sqlite);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.message).toBe("No tables found.");
  });
});
