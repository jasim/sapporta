import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { dbRun } from "./run.js";
import { ErrorCode, OperationError } from "./types.js";

describe("dbRun", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL
      );
      INSERT INTO accounts (name, type) VALUES ('Cash', 'asset'), ('Revenue', 'revenue');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  // -- Read path (auto-detected via stmt.reader) --

  it("runs a SELECT and returns rows", () => {
    const result = dbRun(sqlite, "SELECT id, name FROM accounts ORDER BY id");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe("Cash");
    expect(result.meta?.rowCount).toBe(2);
  });

  it("returns empty data for no results", () => {
    const result = dbRun(sqlite, "SELECT * FROM accounts WHERE id = 999");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.rowCount).toBe(0);
  });

  it("supports WITH (CTE) as a read", () => {
    const result = dbRun(
      sqlite,
      "WITH cte AS (SELECT * FROM accounts) SELECT * FROM cte",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("respects limit for reads", () => {
    const result = dbRun(sqlite, "SELECT * FROM accounts ORDER BY id", {
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.meta?.truncated).toBe(true);
    expect(result.meta?.limit).toBe(1);
  });

  it("binds positional params for reads", () => {
    const result = dbRun(sqlite, "SELECT name FROM accounts WHERE type = ?", {
      params: ["asset"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([{ name: "Cash" }]);
  });

  it("rejects invalid read limits", () => {
    for (const limit of [Number.NaN, 0, -1, 1.9, 1001]) {
      try {
        dbRun(sqlite, "SELECT * FROM accounts", { limit });
        throw new Error("Expected dbRun to throw.");
      } catch (err) {
        expect(err).toBeInstanceOf(OperationError);
        expect(err).toMatchObject({ code: ErrorCode.BAD_LIMIT });
      }
    }
  });

  it("does not set truncated when under limit", () => {
    const result = dbRun(sqlite, "SELECT * FROM accounts ORDER BY id", {
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.meta?.truncated).toBeUndefined();
  });

  // -- Write path (auto-dispatched when stmt doesn't return rows) --

  it("rejects INSERT by default and does not change data", () => {
    expect(() =>
      dbRun(
        sqlite,
        "INSERT INTO accounts (name, type) VALUES ('Equity', 'equity')",
      ),
    ).toThrow("allowDangerous");

    const rows = sqlite.prepare("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(2);
  });

  it("executes INSERT with allowDangerous and reports row count", () => {
    const result = dbRun(
      sqlite,
      "INSERT INTO accounts (name, type) VALUES ('Equity', 'equity')",
      { allowDangerous: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(0);
    expect(result.meta?.rowCount).toBe(1);
  });

  it("executes UPDATE and reports row count", () => {
    const result = dbRun(
      sqlite,
      "UPDATE accounts SET name = 'Petty Cash' WHERE name = 'Cash'",
      { allowDangerous: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.rowCount).toBe(1);
  });

  it("reports OK (0 rows) for no-op mutations", () => {
    const result = dbRun(
      sqlite,
      "UPDATE accounts SET name = 'x' WHERE name = 'missing'",
      { allowDangerous: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.message).toBe("OK (0 rows)");
  });

  it("executes DELETE", () => {
    const result = dbRun(sqlite, "DELETE FROM accounts WHERE name = 'Cash'", {
      allowDangerous: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.rowCount).toBe(1);
    const rows = sqlite.prepare("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(1);
  });

  it("binds positional params for writes", () => {
    const result = dbRun(
      sqlite,
      "INSERT INTO accounts (name, type) VALUES (?, ?)",
      { params: ["Receivable", "asset"], allowDangerous: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.rowCount).toBe(1);
  });

  // -- Dangerous SQL rejection --

  it("rejects DROP DATABASE", () => {
    expect(() => dbRun(sqlite, "DROP DATABASE sapporta")).toThrow(
      "DROP DATABASE",
    );
  });

  it("rejects TRUNCATE", () => {
    expect(() => dbRun(sqlite, "TRUNCATE accounts")).toThrow("TRUNCATE");
  });

  it("rejects DROP SCHEMA", () => {
    expect(() => dbRun(sqlite, "DROP SCHEMA public CASCADE")).toThrow(
      "DROP SCHEMA",
    );
  });

  it("rejects DROP TABLE", () => {
    expect(() => dbRun(sqlite, "DROP TABLE accounts")).toThrow("DROP TABLE");
  });

  it("classifies SQL syntax errors as INVALID_SQL", () => {
    try {
      dbRun(sqlite, "SELECT FROM");
      throw new Error("Expected dbRun to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({ code: ErrorCode.INVALID_SQL });
    }
  });

  it("classifies unique constraint failures as CONFLICT", () => {
    try {
      dbRun(
        sqlite,
        "INSERT INTO accounts (id, name, type) VALUES (1, 'X', 'x')",
        {
          allowDangerous: true,
        },
      );
      throw new Error("Expected dbRun to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({ code: ErrorCode.CONFLICT });
    }
  });

  // -- Dry-run (writes only) --

  it("dry-run returns EXPLAIN QUERY PLAN without executing", () => {
    const result = dbRun(
      sqlite,
      "INSERT INTO accounts (name, type) VALUES ('Equity', 'equity')",
      { dryRun: true, allowDangerous: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta?.dryRun).toBe(true);
    expect(result.meta?.message).toContain("Dry run");

    const rows = sqlite.prepare("SELECT * FROM accounts").all();
    expect(rows).toHaveLength(2);
  });

  it("dry-run still rejects dangerous SQL", () => {
    expect(() =>
      dbRun(sqlite, "DROP DATABASE sapporta", {
        dryRun: true,
        allowDangerous: true,
      }),
    ).toThrow("DROP DATABASE");
  });
});
