import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbSample } from "./sample.js";
import { ErrorCode, OperationError } from "../errors.js";

describe("db sample", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      INSERT INTO accounts (name) VALUES ('A'), ('B'), ('C'), ('D'), ('E'), ('F');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("shows sample rows with default limit", () => {
    const result = dbSample(sqlite, "accounts");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(5);
    expect(result.meta?.rowCount).toBe(5);
    expect(result.meta?.limit).toBe(5);
  });

  it("respects custom limit", () => {
    const result = dbSample(sqlite, "accounts", 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.meta?.rowCount).toBe(2);
    expect(result.meta?.limit).toBe(2);
  });

  it("rejects invalid limits", () => {
    for (const limit of [Number.NaN, 0, -1, 1.9]) {
      try {
        dbSample(sqlite, "accounts", limit);
        throw new Error("Expected dbSample to throw.");
      } catch (err) {
        expect(err).toBeInstanceOf(OperationError);
        expect(err).toMatchObject({ code: ErrorCode.BAD_LIMIT });
      }
    }
  });

  it("shows empty message for empty table", () => {
    sqlite.exec("DELETE FROM accounts");

    const result = dbSample(sqlite, "accounts");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.message).toBe("Table 'accounts' is empty.");
  });

  it("rejects invalid table names", () => {
    expect(() => dbSample(sqlite, "'; DROP TABLE accounts; --")).toThrow(
      "Invalid table name",
    );
  });

  it("throws TABLE_NOT_FOUND when the table does not exist", () => {
    try {
      dbSample(sqlite, "missing");
      throw new Error("Expected dbSample to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({
        code: ErrorCode.TABLE_NOT_FOUND,
        message: "Table 'missing' not found",
      });
    }
  });

  it("selects specific fields with --fields", () => {
    const result = dbSample(sqlite, "accounts", 5, ["name"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(5);
    // Should only have the 'name' column (plus id from ORDER BY isn't added)
    expect(Object.keys(result.data[0])).toEqual(["name"]);
  });

  it("throws INVALID_COLUMN_NAME when a requested field does not exist", () => {
    try {
      dbSample(sqlite, "accounts", 5, ["missing"]);
      throw new Error("Expected dbSample to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({
        code: ErrorCode.INVALID_COLUMN_NAME,
        message: "Unknown column(s) in 'accounts': missing",
      });
    }
  });
});
