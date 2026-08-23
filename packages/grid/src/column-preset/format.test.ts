import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  describeInstant,
  formatCurrency,
  formatDate,
  formatTimestamp,
} from "./format";

// Date and timestamp text is written on the reader's wall clock, so the host
// zone is pinned rather than inherited. Asia/Kolkata is +05:30 year-round: the
// half-hour offset catches whole-hour rounding, and an evening UTC instant
// lands on the next calendar day, which catches a missing conversion.
const DISPLAY_TIME_ZONE = "Asia/Kolkata";
// 20:30 UTC is 02:00 on the following day in that zone.
const EVENING_INSTANT = "2026-08-23T20:30:00Z";

beforeAll(() => {
  vi.stubEnv("TZ", DISPLAY_TIME_ZONE);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("column preset formatters", () => {
  it("formats currency magnitudes without adding a currency symbol or code", () => {
    const formatted = formatCurrency(125);

    expect(formatted).toMatch(/^125[.,]00$/);
    expect(formatted).not.toContain("$");
    expect(formatted).not.toContain("USD");
  });

  it("leaves a canonical date as the short calendar date it already is", () => {
    expect(formatDate("2026-08-23")).toBe("2026-08-23");
  });

  it("reads a timestamp back without the ISO punctuation or seconds", () => {
    expect(formatTimestamp("2026-08-23T11:08:00Z")).toBe("2026-08-23 16:38");
  });

  it("puts a timestamp on the calendar day the reader sees it on", () => {
    expect(formatTimestamp(EVENING_INSTANT)).toBe("2026-08-24 02:00");
  });

  it("reduces an instant in a date column to its calendar day", () => {
    expect(formatDate(EVENING_INSTANT)).toBe("2026-08-24");
  });

  it("reads a Date on the same clock as the string it stands for", () => {
    // A Date is an instant. Slicing its UTC face would print the 23rd here
    // while the timestamp column beside it prints the 24th.
    expect(formatDate(new Date(EVENING_INSTANT))).toBe("2026-08-24");
    expect(formatTimestamp(new Date(EVENING_INSTANT))).toBe("2026-08-24 02:00");
  });

  it("has no time to add to a date in a timestamp column", () => {
    expect(formatTimestamp("2026-08-23")).toBe("2026-08-23");
  });

  it("shows text that is not a date exactly as it arrived", () => {
    expect(formatDate("sometime last week")).toBe("sometime last week");
    expect(formatTimestamp("2026-08")).toBe("2026-08");
  });

  it("has nothing to show for a missing value", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatTimestamp(null)).toBe("");
    expect(formatTimestamp("")).toBe("");
  });

  it("describes an instant with the seconds and offset the cell drops", () => {
    expect(describeInstant(EVENING_INSTANT)).toBe(
      "2026-08-24 02:00:00 (UTC+05:30)",
    );
    expect(describeInstant(new Date(EVENING_INSTANT))).toBe(
      "2026-08-24 02:00:00 (UTC+05:30)",
    );
  });

  it("has no moment to describe for anything that is not an instant", () => {
    expect(describeInstant("2026-08-23")).toBeUndefined();
    expect(describeInstant("sometime last week")).toBeUndefined();
    expect(describeInstant(null)).toBeUndefined();
  });
});
