import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Temporal,
  canonicalizeInstantString,
  describeInstantForDisplay,
  formatCanonicalInstant,
  formatInstantForDateInput,
  formatInstantForDateTimeLocalInput,
  formatInstantForDisplay,
  formatPlainDateForDateInput,
  formatPlainDateForDisplay,
  formatTemporalForDisplay,
  parseCanonicalInstant,
  parseDateInputToInstantString,
  parseDateInputToPlainDateString,
  parseDateTimeLocalInputToCanonicalInstantString,
  parsePlainDate,
} from "./temporal.js";

// Layer 5 §1–§2 (DATA-TYPE-PRINCIPLES.md Part V) pinned in tests:
// timestamp precision normalization and strict calendar validity.

// Every codec below that mentions "local" reads the host zone, so the host
// zone is pinned rather than inherited. Asia/Kolkata is chosen for two
// properties a UTC runner would hide: the offset is +05:30, so an
// implementation that rounds to whole hours is caught, and it is far enough
// east that an evening UTC instant falls on the next calendar day, so an
// implementation that skips the conversion entirely is caught too. The zone
// has no DST, so these expectations hold in any month.
const DISPLAY_TIME_ZONE = "Asia/Kolkata";

beforeAll(() => {
  vi.stubEnv("TZ", DISPLAY_TIME_ZONE);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

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

describe("date input codecs", () => {
  it("keeps date fields as canonical calendar dates", () => {
    expect(formatPlainDateForDateInput("2024-01-15")).toBe("2024-01-15");
    expect(parseDateInputToPlainDateString("2024-01-15")).toBe("2024-01-15");
  });

  it("does not reinterpret instants as date input values", () => {
    expect(formatPlainDateForDateInput("2024-01-15T12:00:00Z")).toBe("");
  });

  it("clears empty date input values to null", () => {
    expect(parseDateInputToPlainDateString("")).toBeNull();
  });
});

describe("datetime-local input codecs", () => {
  it("round-trips canonical instants through local datetime input values", () => {
    const instant = "2024-01-15T12:34:56Z";
    expect(
      parseDateTimeLocalInputToCanonicalInstantString(
        formatInstantForDateTimeLocalInput(instant),
      ),
    ).toBe(instant);
  });

  it("serializes datetime-local input back to canonical UTC whole seconds", () => {
    const value = parseDateTimeLocalInputToCanonicalInstantString(
      "2024-01-15T12:34:56",
    );
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("clears empty datetime-local input values to null", () => {
    expect(parseDateTimeLocalInputToCanonicalInstantString("")).toBeNull();
  });
});

describe("display codecs", () => {
  it("keeps a plain date as its canonical calendar date", () => {
    expect(formatPlainDateForDisplay("2024-01-15")).toBe("2024-01-15");
  });

  it("shows an instant on the reader's wall clock, without the T, Z, or seconds", () => {
    expect(formatInstantForDisplay("2024-01-15T12:34:56Z")).toBe(
      "2024-01-15 18:04",
    );
  });

  it("carries an instant onto the local calendar day it falls on", () => {
    // 20:30 UTC is already the 16th at +05:30. A reader filtering or
    // reconciling by day needs the day they live in, not the stored one.
    expect(formatInstantForDisplay("2024-01-15T20:30:00Z")).toBe(
      "2024-01-16 02:00",
    );
    expect(formatTemporalForDisplay("2024-01-15T20:30:00Z", "day")).toBe(
      "2024-01-16",
    );
  });

  it("writes display text in the zone the input codecs read", () => {
    const instant = "2024-01-15T12:34:56Z";
    const wallClock = formatInstantForDateTimeLocalInput(instant);

    expect(formatInstantForDisplay(instant)).toBe(
      `${wallClock.slice(0, 10)} ${wallClock.slice(11, 16)}`,
    );
  });

  it("reads offset encodings as the same moment as their UTC form", () => {
    expect(
      formatTemporalForDisplay("2024-01-15T14:00:00+02:00", "minute"),
    ).toBe(formatTemporalForDisplay("2024-01-15T12:00:00Z", "minute"));
  });

  it("treats precision as a ceiling, never as an invitation to invent a time", () => {
    expect(formatTemporalForDisplay("2024-01-15", "minute")).toBe("2024-01-15");
    expect(formatTemporalForDisplay("2024-01-15", "day")).toBe("2024-01-15");
    expect(formatTemporalForDisplay("2024-01-15T12:34:56Z", "minute")).toBe(
      "2024-01-15 18:04",
    );
  });

  it("reports values it cannot vouch for rather than inventing a date", () => {
    expect(formatTemporalForDisplay("", "minute")).toBeNull();
    expect(formatTemporalForDisplay("not a date", "minute")).toBeNull();
    expect(formatTemporalForDisplay("2024-02-30", "minute")).toBeNull();
    expect(
      formatTemporalForDisplay("2024-01-15T12:34:56", "minute"),
    ).toBeNull();
  });

  it("describes the full moment with the seconds and the offset display drops", () => {
    expect(describeInstantForDisplay("2024-01-15T12:34:56Z")).toBe(
      "2024-01-15 18:04:56 (UTC+05:30)",
    );
  });

  it("has no moment to describe for a calendar date", () => {
    expect(describeInstantForDisplay("2024-01-15")).toBeNull();
    expect(describeInstantForDisplay("not a date")).toBeNull();
  });
});

describe("date input codec for instant columns", () => {
  it("shows the local calendar day an instant falls on", () => {
    expect(formatInstantForDateInput("2024-01-15T20:30:00Z")).toBe(
      "2024-01-16",
    );
  });

  it("has nothing to show for a value that is not an instant", () => {
    expect(formatInstantForDateInput("2024-01-15")).toBe("");
    expect(formatInstantForDateInput("")).toBe("");
    expect(formatInstantForDateInput(null)).toBe("");
  });

  it("resolves a named day to its first and last stored moment", () => {
    expect(parseDateInputToInstantString("2024-01-16", "startOfDay")).toBe(
      "2024-01-15T18:30:00Z",
    );
    expect(parseDateInputToInstantString("2024-01-16", "endOfDay")).toBe(
      "2024-01-16T18:29:59Z",
    );
  });

  it("bounds a day so that every instant displayed on it falls inside", () => {
    const day = "2024-01-16";
    const start = parseDateInputToInstantString(day, "startOfDay");
    const end = parseDateInputToInstantString(day, "endOfDay");
    const firstMinute = "2024-01-15T18:30:00Z";
    const lastMinute = "2024-01-16T18:29:00Z";

    expect(formatTemporalForDisplay(firstMinute, "day")).toBe(day);
    expect(formatTemporalForDisplay(lastMinute, "day")).toBe(day);
    // Canonical instants are fixed-width, so string order is chronological.
    expect(start !== null && firstMinute >= start).toBe(true);
    expect(end !== null && lastMinute <= end).toBe(true);
  });

  it("clears empty date input values to null", () => {
    expect(parseDateInputToInstantString("", "startOfDay")).toBeNull();
  });

  it("rejects a day that is not a calendar date", () => {
    expect(() =>
      parseDateInputToInstantString("2024-02-30", "startOfDay"),
    ).toThrow();
  });
});
