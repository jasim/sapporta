import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbIndexes } from "./indexes.js";
import { ErrorCode, OperationError } from "../errors.js";

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
    sqlite.exec(
      "CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);",
    );

    const result = dbIndexes(sqlite, "accounts");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.message).toBe("No indexes found for table 'accounts'.");
  });

  it("throws TABLE_NOT_FOUND when the table does not exist", () => {
    try {
      dbIndexes(sqlite, "nonexistent");
      throw new Error("Expected dbIndexes to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({
        code: ErrorCode.TABLE_NOT_FOUND,
        message: "Table 'nonexistent' not found",
      });
    }
  });
});
