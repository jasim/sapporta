import { describe, it, expect } from "vitest";
import { rejectControlChars, isSafeIdentifier } from "./sanitize.js";

describe("rejectControlChars", () => {
  it("accepts normal text", () => {
    expect(() => rejectControlChars('{"name":"Cash","amount":100}')).not.toThrow();
  });

  it("accepts whitespace characters (tab, newline, carriage return)", () => {
    expect(() => rejectControlChars('{\n\t"name": "Cash"\r\n}')).not.toThrow();
  });

  it("rejects null byte", () => {
    expect(() => rejectControlChars('{"name":"Cash\x00"}')).toThrow("control characters");
  });

  it("rejects bell character", () => {
    expect(() => rejectControlChars('{"name":"Cash\x07"}')).toThrow("control characters");
  });

  it("rejects backspace", () => {
    expect(() => rejectControlChars('{"name":"Cash\x08"}')).toThrow("control characters");
  });

  it("rejects form feed within restricted range", () => {
    expect(() => rejectControlChars('{"name":"Cash\x0e"}')).toThrow("control characters");
  });

  it("throws ValidationError", () => {
    expect(() => rejectControlChars("bad\x00")).toThrow("Validation failed");
  });
});

describe("isSafeIdentifier", () => {
  it("accepts valid identifiers", () => {
    expect(isSafeIdentifier("accounts")).toBe(true);
    expect(isSafeIdentifier("_private")).toBe(true);
    expect(isSafeIdentifier("order_items")).toBe(true);
    expect(isSafeIdentifier("AccountType")).toBe(true);
  });

  it("rejects names with special characters", () => {
    expect(isSafeIdentifier("users; DROP TABLE")).toBe(false);
    expect(isSafeIdentifier("my-table")).toBe(false);
    expect(isSafeIdentifier("my table")).toBe(false);
    expect(isSafeIdentifier("name?")).toBe(false);
    expect(isSafeIdentifier("col'name")).toBe(false);
  });

  it("rejects names starting with numbers", () => {
    expect(isSafeIdentifier("1table")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeIdentifier("")).toBe(false);
  });
});
