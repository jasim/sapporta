import { describe, expect, it } from "vitest";
import { parseTimeZone } from "@sapporta/shared/temporal";
import {
  describeInstant,
  formatCurrency,
  formatDate,
  formatTimestamp,
} from "./format";

// Date and timestamp text is written on the wall clock of the zone the caller
// names, so the test names one rather than inheriting the host's. Asia/Kolkata
// is +05:30 year-round: the half-hour offset catches whole-hour rounding, and
// an evening UTC instant lands on the next calendar day, which catches a
// missing conversion.
const ZONE = parseTimeZone("Asia/Kolkata");
// 20:30 UTC is 02:00 on the following day in that zone.
const EVENING_INSTANT = "2026-08-23T20:30:00Z";

describe("column preset formatters", () => {
  it("formats currency magnitudes without adding a currency symbol or code", () => {
    const formatted = formatCurrency(125);

    expect(formatted).toMatch(/^125[.,]00$/);
    expect(formatted).not.toContain("$");
    expect(formatted).not.toContain("USD");
  });

  it("leaves a canonical date as the short calendar date it already is", () => {
    expect(formatDate("2026-08-23", ZONE)).toBe("2026-08-23");
  });

  it("reads a timestamp back without the ISO punctuation or seconds", () => {
    expect(formatTimestamp("2026-08-23T11:08:00Z", ZONE)).toBe(
      "2026-08-23 16:38",
    );
  });

  it("reads one timestamp differently in each zone it is given", () => {
    expect(formatTimestamp("2026-08-23T11:08:00Z", parseTimeZone("UTC"))).toBe(
      "2026-08-23 11:08",
    );
    expect(formatTimestamp("2026-08-23T11:08:00Z", ZONE)).toBe(
      "2026-08-23 16:38",
    );
  });

  it("puts a timestamp on the calendar day the reader sees it on", () => {
    expect(formatTimestamp(EVENING_INSTANT, ZONE)).toBe("2026-08-24 02:00");
  });

  it("reduces an instant in a date column to its calendar day", () => {
    expect(formatDate(EVENING_INSTANT, ZONE)).toBe("2026-08-24");
  });

  it("reads a Date on the same clock as the string it stands for", () => {
    // A Date is an instant. Slicing its UTC face would print the 23rd here
    // while the timestamp column beside it prints the 24th.
    expect(formatDate(new Date(EVENING_INSTANT), ZONE)).toBe("2026-08-24");
    expect(formatTimestamp(new Date(EVENING_INSTANT), ZONE)).toBe(
      "2026-08-24 02:00",
    );
  });

  it("has no time to add to a date in a timestamp column", () => {
    expect(formatTimestamp("2026-08-23", ZONE)).toBe("2026-08-23");
  });

  it("shows text that is not a date exactly as it arrived", () => {
    expect(formatDate("sometime last week", ZONE)).toBe("sometime last week");
    expect(formatTimestamp("2026-08", ZONE)).toBe("2026-08");
  });

  it("has nothing to show for a missing value", () => {
    expect(formatDate(null, ZONE)).toBe("");
    expect(formatDate(undefined, ZONE)).toBe("");
    expect(formatDate("", ZONE)).toBe("");
    expect(formatTimestamp(null, ZONE)).toBe("");
    expect(formatTimestamp("", ZONE)).toBe("");
  });

  it("describes an instant with the seconds and offset the cell drops", () => {
    expect(describeInstant(EVENING_INSTANT, ZONE)).toBe(
      "2026-08-24 02:00:00 (UTC+05:30)",
    );
    expect(describeInstant(new Date(EVENING_INSTANT), ZONE)).toBe(
      "2026-08-24 02:00:00 (UTC+05:30)",
    );
  });

  it("has no moment to describe for anything that is not an instant", () => {
    expect(describeInstant("2026-08-23", ZONE)).toBeUndefined();
    expect(describeInstant("sometime last week", ZONE)).toBeUndefined();
    expect(describeInstant(null, ZONE)).toBeUndefined();
  });
});
