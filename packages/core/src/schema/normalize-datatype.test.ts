import { describe, it, expect } from "vitest";
import { normalizeDataType, isDateObjectMode } from "./normalize-datatype.js";

describe("normalizeDataType", () => {
  // Drizzle reports date/timestamp columns as dataType:"string", but
  // the UI needs "date" for date pickers and formatters. These tests
  // cover the override path; non-date types pass through unchanged.

  it("Pg PgDateString → date (overrides Drizzle's 'string')", () => {
    expect(normalizeDataType({ columnType: "PgDateString", dataType: "string" })).toBe("date");
  });

  it("Pg PgTimestampString → date (overrides Drizzle's 'string')", () => {
    expect(normalizeDataType({ columnType: "PgTimestampString", dataType: "string" })).toBe("date");
  });

  it("Pg PgTimestamp (Date mode) → date", () => {
    expect(normalizeDataType({ columnType: "PgTimestamp", dataType: "date" })).toBe("date");
  });

  it("Pg PgDate → date (overrides Drizzle's 'string')", () => {
    expect(normalizeDataType({ columnType: "PgDate", dataType: "string" })).toBe("date");
  });

  it("SQLite timestamp → date (matched by columnType, not dataType)", () => {
    expect(normalizeDataType({ columnType: "SQLiteTimestamp", dataType: "date" })).toBe("date");
  });

  // Non-date types fall through to Drizzle's dataType unchanged.

  it("unknown columnType falls through to dataType", () => {
    expect(normalizeDataType({ columnType: "SomeFutureType", dataType: "string" })).toBe("string");
    expect(normalizeDataType({ columnType: "SomeFutureType", dataType: "number" })).toBe("number");
    expect(normalizeDataType({ columnType: "SomeFutureType", dataType: "boolean" })).toBe("boolean");
  });
});

describe("isDateObjectMode", () => {
  it("PgTimestamp (default mode) returns Date objects", () => {
    expect(isDateObjectMode({ columnType: "PgTimestamp" })).toBe(true);
  });

  it("PgTimestampString (string mode) does NOT return Date objects", () => {
    expect(isDateObjectMode({ columnType: "PgTimestampString" })).toBe(false);
  });

  it("SQLiteTimestamp (mode: timestamp) returns Date objects", () => {
    expect(isDateObjectMode({ columnType: "SQLiteTimestamp" })).toBe(true);
  });

  it("SQLiteText does NOT return Date objects", () => {
    expect(isDateObjectMode({ columnType: "SQLiteText" })).toBe(false);
  });

  it("SQLiteInteger does NOT return Date objects", () => {
    expect(isDateObjectMode({ columnType: "SQLiteInteger" })).toBe(false);
  });
});
