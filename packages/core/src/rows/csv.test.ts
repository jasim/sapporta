import { describe, it, expect } from "vitest";
import { csvEscape, cellToString } from "./csv.js";

describe("csvEscape", () => {
  it("passes through plain strings unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape("")).toBe("");
  });

  it("quotes cells containing commas", () => {
    expect(csvEscape("a,b")).toBe(`"a,b"`);
  });

  it("quotes and doubles internal double quotes", () => {
    expect(csvEscape(`she said "hi"`)).toBe(`"she said ""hi"""`);
  });

  it("quotes cells containing CR or LF", () => {
    expect(csvEscape("line1\nline2")).toBe(`"line1\nline2"`);
    expect(csvEscape("line1\rline2")).toBe(`"line1\rline2"`);
  });
});

describe("cellToString", () => {
  it("returns empty string for null and undefined", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(undefined)).toBe("");
  });

  it("stringifies booleans", () => {
    expect(cellToString(true)).toBe("true");
    expect(cellToString(false)).toBe("false");
  });

  it("serializes Dates as ISO 8601", () => {
    const d = new Date("2026-04-18T12:34:56Z");
    expect(cellToString(d)).toBe("2026-04-18T12:34:56.000Z");
  });

  it("stringifies numbers", () => {
    expect(cellToString(0)).toBe("0");
    expect(cellToString(42)).toBe("42");
    expect(cellToString(3.14)).toBe("3.14");
  });

  it("passes through plain strings", () => {
    expect(cellToString("hello")).toBe("hello");
  });
});
