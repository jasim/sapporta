import { describe, expect, it } from "vitest";
import {
  assertBoundedInteger,
  parseBoundedInteger,
  parseOptionalBoundedInteger,
} from "./bounded-integer.js";

const makeError = (message: string) => new Error(message);

describe("bounded integer validation", () => {
  it("uses the default value for required undefined input", () => {
    expect(
      parseBoundedInteger(undefined, {
        name: "page",
        min: 1,
        defaultValue: 1,
        makeError,
      }),
    ).toBe(1);
  });

  it("treats blank optional strings as undefined by default", () => {
    expect(
      parseOptionalBoundedInteger("  ", {
        name: "limit",
        min: 1,
        makeError,
      }),
    ).toBeUndefined();
  });

  it("accepts canonical decimal integer strings and number inputs", () => {
    const options = {
      name: "limit",
      min: 1,
      max: 100,
      makeError,
    };

    expect(parseOptionalBoundedInteger("25", options)).toBe(25);
    expect(parseOptionalBoundedInteger(25, options)).toBe(25);
  });

  it("rejects non-canonical integer strings", () => {
    const options = {
      name: "limit",
      min: 1,
      max: 100,
      makeError,
    };

    for (const raw of ["01", "1.0", "1abc", " 1", "+1"]) {
      expect(() => parseOptionalBoundedInteger(raw, options)).toThrow(
        /limit must be an integer/,
      );
    }
  });

  it("enforces lower and upper bounds", () => {
    const options = {
      name: "limit",
      min: 1,
      max: 100,
      makeError,
    };

    expect(() => parseOptionalBoundedInteger("0", options)).toThrow(
      /limit must be an integer/,
    );
    expect(() => parseOptionalBoundedInteger("101", options)).toThrow(
      /limit must be an integer/,
    );
  });

  it("asserts existing numbers against the same bounds", () => {
    expect(() =>
      assertBoundedInteger(10, {
        name: "limit",
        min: 1,
        max: 100,
        makeError,
      }),
    ).not.toThrow();
  });
});
