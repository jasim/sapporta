import { describe, it, expect } from "vitest";
import { buildSQLitePositionalQuery, extractBindVariables } from "./sqlite-bind.js";

describe("buildSQLitePositionalQuery", () => {
  it("replaces $name with ?", () => {
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t WHERE year = $year",
      ["year"],
      { year: 2024 },
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE year = ?");
    expect(result.values).toEqual([2024]);
  });

  it("handles multiple different variables", () => {
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t WHERE year = $year AND month = $month",
      ["year", "month"],
      { year: 2024, month: 1 },
    );
    expect(result.sql).toBe(
      "SELECT * FROM t WHERE year = ? AND month = ?",
    );
    expect(result.values).toEqual([2024, 1]);
  });

  it("duplicates values for repeated $name references", () => {
    // SQLite's ? params are strictly positional — each ? needs its own value
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t WHERE start_year = $year OR end_year = $year",
      ["year"],
      { year: 2024 },
    );
    expect(result.sql).toBe(
      "SELECT * FROM t WHERE start_year = ? OR end_year = ?",
    );
    // Value must be duplicated — two ?s need two values
    expect(result.values).toEqual([2024, 2024]);
  });

  it("uses null for missing values", () => {
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t WHERE x = $missing",
      ["missing"],
      {},
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE x = ?");
    expect(result.values).toEqual([null]);
  });

  it("does not replace $name inside single-quoted strings", () => {
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t WHERE name = '$literal'",
      [],
      {},
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE name = '$literal'");
    expect(result.values).toEqual([]);
  });

  it("does not replace $name inside line comments", () => {
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t -- WHERE year = $year\nWHERE 1=1",
      [],
      {},
    );
    expect(result.sql).toBe(
      "SELECT * FROM t -- WHERE year = $year\nWHERE 1=1",
    );
    expect(result.values).toEqual([]);
  });

  it("does not replace $name inside block comments", () => {
    const result = buildSQLitePositionalQuery(
      "SELECT * FROM t /* $year */ WHERE 1=1",
      [],
      {},
    );
    expect(result.sql).toBe("SELECT * FROM t /* $year */ WHERE 1=1");
    expect(result.values).toEqual([]);
  });
});

describe("extractBindVariables (re-exported)", () => {
  it("extracts variables from SQL", () => {
    const vars = extractBindVariables(
      "SELECT * FROM t WHERE year = $year AND month = $month",
    );
    expect(vars).toEqual(["year", "month"]);
  });

  it("deduplicates repeated variables", () => {
    const vars = extractBindVariables(
      "SELECT * FROM t WHERE x = $year OR y = $year",
    );
    expect(vars).toEqual(["year"]);
  });
});
