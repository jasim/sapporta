import { describe, expect, it } from "vitest";
import {
  Temporal,
  canonicalizeInstantString,
  formatCanonicalInstant,
  parseCanonicalInstant,
  parsePlainDate,
} from "./temporal.js";

// Layer 5 §1–§2 (DATA-TYPE-PRINCIPLES.md Part V) pinned in tests:
// timestamp precision normalization and strict calendar validity.

describe("parsePlainDate — strict calendar validity", () => {
  it("accepts valid ISO dates", () => {
    expect(parsePlainDate("2024-01-15").toString()).toBe("2024-01-15");
  });

  it("rejects impossible month days (2024-02-30)", () => {
    expect(() => parsePlainDate("2024-02-30")).toThrow();
  });

  it("rejects impossible months (2024-13-01)", () => {
    expect(() => parsePlainDate("2024-13-01")).toThrow();
  });

  it("rejects US-format inputs", () => {
    expect(() => parsePlainDate("01/15/2024")).toThrow();
  });
});

describe("parseCanonicalInstant — strict validity", () => {
  it("rejects impossible times (25:00:00)", () => {
    expect(() => parseCanonicalInstant("2024-01-15T25:00:00Z")).toThrow();
  });

  it("rejects impossible offsets (+25:00)", () => {
    expect(() => parseCanonicalInstant("2024-01-15T12:00:00+25:00")).toThrow();
  });

  it("accepts canonical UTC instants", () => {
    const out = parseCanonicalInstant("2024-01-15T12:00:00Z");
    expect(out).toBeInstanceOf(Temporal.Instant);
  });

  it("accepts fractional-second inputs (truncated on serialize)", () => {
    // Parsing itself is tolerant; the *storage* form drops fractional seconds.
    const out = parseCanonicalInstant("2024-01-15T12:00:00.500Z");
    expect(out).toBeInstanceOf(Temporal.Instant);
  });

  it("accepts offset inputs (normalized on serialize)", () => {
    const out = parseCanonicalInstant("2024-01-15T14:00:00+02:00");
    expect(out).toBeInstanceOf(Temporal.Instant);
  });
});

describe("formatCanonicalInstant — fixed-width UTC, no fractional seconds", () => {
  it("drops sub-second precision", () => {
    const i = parseCanonicalInstant("2024-01-15T12:00:00.500Z");
    expect(formatCanonicalInstant(i)).toBe("2024-01-15T12:00:00Z");
  });

  it("canonicalizes offset inputs to Z", () => {
    const i = parseCanonicalInstant("2024-01-15T14:00:00+02:00");
    expect(formatCanonicalInstant(i)).toBe("2024-01-15T12:00:00Z");
  });

  it("preserves whole-second values unchanged", () => {
    const i = parseCanonicalInstant("2024-01-15T12:00:00Z");
    expect(formatCanonicalInstant(i)).toBe("2024-01-15T12:00:00Z");
  });

  it("canonicalizes same-instant encodings to the same string", () => {
    const forms = [
      "2024-01-15T12:00:00Z",
      "2024-01-15T12:00:00.000Z",
      "2024-01-15T14:00:00+02:00",
    ];
    const canon = forms.map(canonicalizeInstantString);
    expect(new Set(canon).size).toBe(1);
    expect(canon[0]).toBe("2024-01-15T12:00:00Z");
  });

  it("sorts lex-equal to chronological after canonicalization", () => {
    const raw = ["2024-01-15T12:00:00.500Z", "2024-01-15T12:00:00Z"];
    // Post-canonicalization, .500 collapses to the same whole second.
    // What the fixed-width rule actually defends against is *mixed-width*
    // stored values (e.g. `12:00:00Z` vs `12:00:00.500Z` both landing in
    // storage) — lex would then sort the millisecond form after the
    // whole-second form, reversing chronology. Canonicalizing collapses
    // both to the same width.
    const canon = raw.map(canonicalizeInstantString).sort();
    expect(canon).toEqual(["2024-01-15T12:00:00Z", "2024-01-15T12:00:00Z"]);
  });
});
