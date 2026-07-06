import { describe, expect, it } from "vitest";
import { cellToCsvString, csvEscape, csvRow } from "./csv.js";

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

describe("cellToCsvString", () => {
  it("returns empty string for null and undefined", () => {
    expect(cellToCsvString(null)).toBe("");
    expect(cellToCsvString(undefined)).toBe("");
  });

  it("stringifies booleans", () => {
    expect(cellToCsvString(true)).toBe("true");
    expect(cellToCsvString(false)).toBe("false");
  });

  it("serializes Dates as ISO 8601", () => {
    const date = new Date("2026-04-18T12:34:56Z");
    expect(cellToCsvString(date)).toBe("2026-04-18T12:34:56.000Z");
  });

  it("stringifies numbers", () => {
    expect(cellToCsvString(0)).toBe("0");
    expect(cellToCsvString(42)).toBe("42");
    expect(cellToCsvString(3.14)).toBe("3.14");
  });

  it("passes through plain strings", () => {
    expect(cellToCsvString("hello")).toBe("hello");
  });
});

describe("csvRow", () => {
  it("stringifies and escapes a full row", () => {
    expect(csvRow(["plain", null, true, "a,b", `say "hi"`])).toBe(
      `plain,,true,"a,b","say ""hi"""`,
    );
  });
});
