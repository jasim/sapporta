import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { formatTable, truncateValues } from "./format.js";
import {
  requireSelect,
  rejectDangerousSQL,
  validateTableName,
  validateColumnNames,
  rejectControlChars,
} from "../introspect/sql-safety.js";
import {
  buildInsertQuery,
  assertTableExists,
  getTableColumns,
  validatePayloadColumns,
} from "../introspect/db-helpers.js";

describe("requireSelect", () => {
  it("allows SELECT queries", () => {
    expect(() => requireSelect("SELECT * FROM accounts")).not.toThrow();
  });

  it("allows WITH (CTE) queries", () => {
    expect(() =>
      requireSelect("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    ).not.toThrow();
  });

  it("allows case-insensitive", () => {
    expect(() => requireSelect("select * from accounts")).not.toThrow();
  });

  it("rejects INSERT", () => {
    expect(() =>
      requireSelect("INSERT INTO accounts (name) VALUES ('x')"),
    ).toThrow("Only SELECT");
  });

  it("rejects UPDATE", () => {
    expect(() => requireSelect("UPDATE accounts SET name = 'x'")).toThrow(
      "Only SELECT",
    );
  });

  it("rejects DELETE", () => {
    expect(() => requireSelect("DELETE FROM accounts")).toThrow("Only SELECT");
  });
});

describe("rejectDangerousSQL", () => {
  it("allows normal SELECT", () => {
    expect(() => rejectDangerousSQL("SELECT * FROM accounts")).not.toThrow();
  });

  it("allows normal INSERT", () => {
    expect(() =>
      rejectDangerousSQL("INSERT INTO accounts (name) VALUES ('x')"),
    ).not.toThrow();
  });

  it("rejects DROP DATABASE", () => {
    expect(() => rejectDangerousSQL("DROP DATABASE sapporta")).toThrow(
      "DROP DATABASE",
    );
  });

  it("rejects TRUNCATE", () => {
    expect(() => rejectDangerousSQL("TRUNCATE accounts")).toThrow("TRUNCATE");
  });

  it("rejects DROP SCHEMA", () => {
    expect(() => rejectDangerousSQL("DROP SCHEMA public CASCADE")).toThrow(
      "DROP SCHEMA",
    );
  });
});

describe("validateTableName", () => {
  it("accepts valid table names", () => {
    expect(() => validateTableName("accounts")).not.toThrow();
    expect(() => validateTableName("_private")).not.toThrow();
    expect(() => validateTableName("order_items")).not.toThrow();
  });

  it("rejects names with special characters", () => {
    expect(() => validateTableName("users; DROP TABLE")).toThrow(
      "Invalid table name",
    );
    expect(() => validateTableName("my-table")).toThrow("Invalid table name");
    expect(() => validateTableName("my table")).toThrow("Invalid table name");
  });

  it("rejects names starting with numbers", () => {
    expect(() => validateTableName("1table")).toThrow("Invalid table name");
  });

  it("rejects empty string", () => {
    expect(() => validateTableName("")).toThrow("Invalid table name");
  });
});

describe("validateColumnNames", () => {
  it("accepts valid column names", () => {
    expect(() =>
      validateColumnNames(["id", "first_name", "AccountType"]),
    ).not.toThrow();
  });

  it("rejects column names with semicolons", () => {
    expect(() => validateColumnNames(["id; DROP TABLE users"])).toThrow(
      "Invalid column name",
    );
  });

  it("rejects column names with special characters", () => {
    expect(() => validateColumnNames(["name?"])).toThrow("Invalid column name");
    expect(() => validateColumnNames(["col'name"])).toThrow(
      "Invalid column name",
    );
    expect(() => validateColumnNames(["col name"])).toThrow(
      "Invalid column name",
    );
  });

  it("rejects column names starting with numbers", () => {
    expect(() => validateColumnNames(["1column"])).toThrow(
      "Invalid column name",
    );
  });

  it("accepts empty array", () => {
    expect(() => validateColumnNames([])).not.toThrow();
  });
});

describe("buildInsertQuery", () => {
  it("builds a parameterized INSERT with RETURNING *", () => {
    const { query, values } = buildInsertQuery("accounts", {
      name: "Cash",
      type: "asset",
    });
    expect(query).toBe(
      'INSERT INTO "accounts" ("name", "type") VALUES (?, ?) RETURNING *',
    );
    expect(values).toEqual(["Cash", "asset"]);
  });

  it("double-quotes column names to handle reserved words", () => {
    const { query } = buildInsertQuery("items", { order: 1, group: "a" });
    expect(query).toContain('"order"');
    expect(query).toContain('"group"');
  });

  it("handles single-column insert", () => {
    const { query, values } = buildInsertQuery("tags", { label: "urgent" });
    expect(query).toBe('INSERT INTO "tags" ("label") VALUES (?) RETURNING *');
    expect(values).toEqual(["urgent"]);
  });
});

describe("rejectControlChars", () => {
  it("accepts normal text", () => {
    expect(() =>
      rejectControlChars('{"name":"Cash","amount":100}'),
    ).not.toThrow();
  });

  it("accepts whitespace characters (tab, newline, carriage return)", () => {
    expect(() => rejectControlChars('{\n\t"name": "Cash"\r\n}')).not.toThrow();
  });

  it("rejects null byte", () => {
    expect(() => rejectControlChars('{"name":"Cash\x00"}')).toThrow(
      "control characters",
    );
  });

  it("rejects bell character", () => {
    expect(() => rejectControlChars('{"name":"Cash\x07"}')).toThrow(
      "control characters",
    );
  });

  it("rejects backspace", () => {
    expect(() => rejectControlChars('{"name":"Cash\x08"}')).toThrow(
      "control characters",
    );
  });

  it("rejects form feed within restricted range", () => {
    expect(() => rejectControlChars('{"name":"Cash\x0e"}')).toThrow(
      "control characters",
    );
  });
});

describe("truncateValues", () => {
  it("truncates long strings", () => {
    const rows = [{ id: 1, text: "a".repeat(300) }];
    const result = truncateValues(rows, 200);
    expect((result[0].text as string).length).toBe(203); // 200 + "..."
    expect((result[0].text as string).endsWith("...")).toBe(true);
  });

  it("leaves short strings untouched", () => {
    const rows = [{ id: 1, text: "hello" }];
    const result = truncateValues(rows, 200);
    expect(result[0].text).toBe("hello");
  });

  it("leaves non-string values untouched", () => {
    const rows = [{ id: 1, amount: 99999 }];
    const result = truncateValues(rows);
    expect(result[0].amount).toBe(99999);
  });

  it("does not mutate original rows", () => {
    const rows = [{ id: 1, text: "a".repeat(300) }];
    truncateValues(rows, 200);
    expect((rows[0].text as string).length).toBe(300);
  });
});

describe("formatTable", () => {
  it("formats rows as aligned table", () => {
    const rows = [
      { id: 1, name: "Cash" },
      { id: 2, name: "Revenue" },
    ];
    const output = formatTable(rows);
    expect(output).toContain("id");
    expect(output).toContain("name");
    expect(output).toContain("Cash");
    expect(output).toContain("Revenue");
    // Check alignment (header + separator + 2 rows = 4 lines)
    expect(output.split("\n")).toHaveLength(4);
  });

  it("returns (empty) for no rows", () => {
    expect(formatTable([])).toBe("(empty)");
  });

  it("shows NULL for null/undefined values", () => {
    const rows = [{ id: 1, name: null }];
    const output = formatTable(rows);
    expect(output).toContain("NULL");
  });
});

// ---------------------------------------------------------------------------
// SQLite-based validation primitives
// ---------------------------------------------------------------------------
// These tests use a real in-memory SQLite database. The db-helpers functions
// are now synchronous and operate on better-sqlite3 directly.

describe("assertTableExists", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(
      `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT)`,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("passes when table exists", () => {
    expect(() => assertTableExists(sqlite, "accounts")).not.toThrow();
  });

  it("throws TABLE_NOT_FOUND when table does not exist", () => {
    expect(() => assertTableExists(sqlite, "missing")).toThrow("not found");
  });
});

describe("getTableColumns", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(
      `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT)`,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("returns column names as a Set", () => {
    const cols = getTableColumns(sqlite, "accounts");
    expect(cols).toEqual(new Set(["id", "name", "type"]));
  });

  it("returns empty Set for unknown table", () => {
    const cols = getTableColumns(sqlite, "missing");
    expect(cols).toEqual(new Set());
  });
});

describe("validatePayloadColumns", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(
      `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT)`,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("passes when all columns exist", () => {
    expect(() =>
      validatePayloadColumns(sqlite, "accounts", ["name", "type"]),
    ).not.toThrow();
  });

  it("throws for unknown columns", () => {
    expect(() =>
      validatePayloadColumns(sqlite, "accounts", ["name", "bogus"]),
    ).toThrow("Unknown column");
  });

  it("throws TABLE_NOT_FOUND if table missing", () => {
    expect(() => validatePayloadColumns(sqlite, "missing", ["x"])).toThrow(
      "not found",
    );
  });
});
