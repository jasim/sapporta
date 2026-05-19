import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbIndexes } from "./indexes.js";

describe("db indexes", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("shows custom indexes", () => {
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE UNIQUE INDEX idx_accounts_name ON accounts(name);
    `);

    const result = dbIndexes(sqlite, "accounts");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const indexNames = result.data.map((r) => r.index_name);
    expect(indexNames).toContain("idx_accounts_name");
  });

  it("shows message when no indexes", () => {
    const result = dbIndexes(sqlite, "nonexistent");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.message).toBe(
      "No indexes found for table 'nonexistent'.",
    );
  });
});
