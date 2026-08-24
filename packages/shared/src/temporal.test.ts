import { describe, expect, it } from "vitest";
import {
  Temporal,
  canonicalizeInstantString,
  describeInstantForDisplay,
  deviceTimeZone,
  formatCanonicalInstant,
  formatInstantForDateInput,
  formatInstantForDateTimeLocalInput,
  formatInstantForDisplay,
  formatPlainDateForDateInput,
  formatPlainDateForDisplay,
  formatTemporalForDisplay,
  formatTimeZoneOffsetLabel,
  isValidTimeZone,
  localDayInZone,
  parseCanonicalInstant,
  parseDateInputToInstantString,
  parseDateInputToPlainDateString,
  parseDateTimeLocalInputToCanonicalInstantString,
  parsePlainDate,
  parseTimeZone,
  supportedTimeZones,
  type TimeZone,
} from "./temporal.js";

// Layer 5 §1–§2 (DATA-TYPE-PRINCIPLES.md Part V) pinned in tests:
// timestamp precision normalization and strict calendar validity.

// Every codec below that renders or bounds a moment is given its zone, so
// these expectations hold under any host TZ — nothing here stubs the
// environment. Asia/Kolkata is the zone most of them name, for two properties
// a UTC runner would hide: the offset is +05:30, so an implementation that
// rounds to whole hours is caught, and it is far enough east that an evening
// UTC instant falls on the next calendar day, so an implementation that skips
// the conversion is caught too. The zone has no DST, so these hold in any
// month.
const IN = parseTimeZone("Asia/Kolkata");
const UTC = parseTimeZone("UTC");
// Spring-forward in Los Angeles: 02:00 does not exist on 2026-03-08.
const DST = parseTimeZone("America/Los_Angeles");

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
        formatInstantForDateTimeLocalInput(instant, IN),
        IN,
      ),
    ).toBe(instant);
  });

  it("reads a wall clock in the zone it is given, not the host's", () => {
    const wall = "2024-01-15T12:34:56";
    // 12:34:56 wall-clock is a different instant in each zone, by its offset.
    expect(parseDateTimeLocalInputToCanonicalInstantString(wall, UTC)).toBe(
      "2024-01-15T12:34:56Z",
    );
    expect(parseDateTimeLocalInputToCanonicalInstantString(wall, IN)).toBe(
      "2024-01-15T07:04:56Z",
    );
  });

  it("serializes datetime-local input back to canonical UTC whole seconds", () => {
    const value = parseDateTimeLocalInputToCanonicalInstantString(
      "2024-01-15T12:34:56",
      IN,
    );
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("clears empty datetime-local input values to null", () => {
    expect(parseDateTimeLocalInputToCanonicalInstantString("", IN)).toBeNull();
  });
});

describe("display codecs", () => {
  it("keeps a plain date as its canonical calendar date", () => {
    expect(formatPlainDateForDisplay("2024-01-15")).toBe("2024-01-15");
  });

  it("shows an instant on the wall clock of the zone it is given", () => {
    expect(formatInstantForDisplay("2024-01-15T12:34:56Z", "minute", IN)).toBe(
      "2024-01-15 18:04",
    );
  });

  it("reads one instant differently in each zone, by that zone's offset", () => {
    const instant = "2026-08-23T11:08:00Z";
    expect(formatInstantForDisplay(instant, "minute", UTC)).toBe(
      "2026-08-23 11:08",
    );
    expect(formatInstantForDisplay(instant, "minute", IN)).toBe(
      "2026-08-23 16:38",
    );
    expect(formatInstantForDisplay(instant, "minute", DST)).toBe(
      "2026-08-23 04:08",
    );
    expect(
      formatInstantForDisplay(
        instant,
        "minute",
        parseTimeZone("Australia/Adelaide"),
      ),
    ).toBe("2026-08-23 20:38");
  });

  it("follows a zone across its daylight-saving jump", () => {
    // 02:00 never happens in Los Angeles on 2026-03-08; the hour before it
    // reads 01:30 and the hour after reads 03:30.
    expect(formatInstantForDisplay("2026-03-08T09:30:00Z", "minute", DST)).toBe(
      "2026-03-08 01:30",
    );
    expect(formatInstantForDisplay("2026-03-08T11:30:00Z", "minute", DST)).toBe(
      "2026-03-08 04:30",
    );
  });

  it("carries an instant onto the calendar day it falls on in that zone", () => {
    // 20:30 UTC is already the 16th at +05:30. A reader filtering or
    // reconciling by day needs the day they live in, not the stored one.
    expect(formatInstantForDisplay("2024-01-15T20:30:00Z", "minute", IN)).toBe(
      "2024-01-16 02:00",
    );
    expect(formatTemporalForDisplay("2024-01-15T20:30:00Z", "day", IN)).toBe(
      "2024-01-16",
    );
    expect(formatTemporalForDisplay("2024-01-15T20:30:00Z", "day", UTC)).toBe(
      "2024-01-15",
    );
  });

  it("prints local midnight as 00:00, never 24:00", () => {
    // 18:30 UTC is 00:00 the next day at +05:30: the moment a day begins reads
    // as the start of that day, not as the end of the one before it.
    expect(formatInstantForDisplay("2024-01-15T18:30:00Z", "minute", IN)).toBe(
      "2024-01-16 00:00",
    );
  });

  it("writes display text in the zone the input codecs read", () => {
    const instant = "2024-01-15T12:34:56Z";
    const wallClock = formatInstantForDateTimeLocalInput(instant, IN);

    expect(formatInstantForDisplay(instant, "minute", IN)).toBe(
      `${wallClock.slice(0, 10)} ${wallClock.slice(11, 16)}`,
    );
  });

  it("reads offset encodings as the same moment as their UTC form", () => {
    expect(
      formatTemporalForDisplay("2024-01-15T14:00:00+02:00", "minute", IN),
    ).toBe(formatTemporalForDisplay("2024-01-15T12:00:00Z", "minute", IN));
  });

  it("treats precision as a ceiling, never as an invitation to invent a time", () => {
    expect(formatTemporalForDisplay("2024-01-15", "minute", IN)).toBe(
      "2024-01-15",
    );
    expect(formatTemporalForDisplay("2024-01-15", "day", IN)).toBe(
      "2024-01-15",
    );
    expect(formatTemporalForDisplay("2024-01-15T12:34:56Z", "minute", IN)).toBe(
      "2024-01-15 18:04",
    );
  });

  it("leaves a plain date alone whichever zone it is read in", () => {
    for (const precision of ["day", "minute"] as const) {
      expect(formatTemporalForDisplay("2024-01-15", precision, UTC)).toBe(
        "2024-01-15",
      );
      expect(
        formatTemporalForDisplay(
          "2024-01-15",
          precision,
          parseTimeZone("Pacific/Kiritimati"),
        ),
      ).toBe("2024-01-15");
    }
  });

  it("reports values it cannot vouch for rather than inventing a date", () => {
    expect(formatTemporalForDisplay("", "minute", IN)).toBeNull();
    expect(formatTemporalForDisplay("not a date", "minute", IN)).toBeNull();
    expect(formatTemporalForDisplay("2024-02-30", "minute", IN)).toBeNull();
    expect(
      formatTemporalForDisplay("2024-01-15T12:34:56", "minute", IN),
    ).toBeNull();
    // An impossible day in instant form, which the Temporal parser refuses
    // where `Date.parse` would roll it forward to March 1.
    expect(
      formatTemporalForDisplay("2024-02-30T00:00:00Z", "minute", IN),
    ).toBeNull();
  });

  it("reads the sub-second UTC shape a Date serializes to", () => {
    // `Date.prototype.toISOString` writes milliseconds, and that is how an
    // instant reaches display when the value in the cell is a Date.
    expect(
      formatTemporalForDisplay("2024-01-15T12:34:56.789Z", "minute", IN),
    ).toBe("2024-01-15 18:04");
  });

  it("rejects a zone the runtime does not know instead of falling back", () => {
    // Only reachable by bypassing the check these codecs take their argument
    // from. Pinned anyway: the answer is a refusal, never a moment read on
    // some other clock.
    const bad = "Nowhere/Bad" as TimeZone;
    expect(() =>
      formatInstantForDisplay("2024-01-15T12:34:56Z", "minute", bad),
    ).toThrow();
    expect(
      formatTemporalForDisplay("2024-01-15T12:34:56Z", "minute", bad),
    ).toBeNull();
    expect(describeInstantForDisplay("2024-01-15T12:34:56Z", bad)).toBeNull();
  });

  it("describes the full moment with the seconds and the offset display drops", () => {
    expect(describeInstantForDisplay("2024-01-15T12:34:56Z", IN)).toBe(
      "2024-01-15 18:04:56 (UTC+05:30)",
    );
    expect(describeInstantForDisplay("2024-01-15T12:34:56Z", UTC)).toBe(
      "2024-01-15 12:34:56 (UTC+00:00)",
    );
    expect(describeInstantForDisplay("2024-01-15T12:34:56Z", DST)).toBe(
      "2024-01-15 04:34:56 (UTC-08:00)",
    );
  });

  it("describes a moment the cell text can be read off the front of", () => {
    // A reader hovers a cell and gets the tooltip, so the two are read
    // together. Both are read off one `ZonedDateTime`, so one cannot
    // contradict the other; this is the shape of that, on the day a zone
    // leaves daylight saving.
    const instant = "2026-04-05T06:30:00Z";
    const cell = formatInstantForDisplay(instant, "minute", DST);

    expect(describeInstantForDisplay(instant, DST)).toBe(
      `${cell}:00 (UTC-07:00)`,
    );
    expect(formatInstantForDisplay(instant, "day", DST)).toBe(
      cell.slice(0, 10),
    );
  });

  it("has no moment to describe for a calendar date", () => {
    expect(describeInstantForDisplay("2024-01-15", IN)).toBeNull();
    expect(describeInstantForDisplay("not a date", IN)).toBeNull();
  });
});

describe("date input codec for instant columns", () => {
  it("shows the calendar day an instant falls on in that zone", () => {
    expect(formatInstantForDateInput("2024-01-15T20:30:00Z", IN)).toBe(
      "2024-01-16",
    );
    expect(formatInstantForDateInput("2024-01-15T20:30:00Z", UTC)).toBe(
      "2024-01-15",
    );
  });

  it("has nothing to show for a value that is not an instant", () => {
    expect(formatInstantForDateInput("2024-01-15", IN)).toBe("");
    expect(formatInstantForDateInput("", IN)).toBe("");
    expect(formatInstantForDateInput(null, IN)).toBe("");
  });

  it("resolves a named day to its first and last stored moment in that zone", () => {
    expect(parseDateInputToInstantString("2024-01-16", "startOfDay", IN)).toBe(
      "2024-01-15T18:30:00Z",
    );
    expect(parseDateInputToInstantString("2024-01-16", "endOfDay", IN)).toBe(
      "2024-01-16T18:29:59Z",
    );
  });

  /**
   * `America/Santiago` puts its clocks back at midnight on 2026-04-05, so
   * local `2026-04-04T23:59:59` happens twice and the earlier of the two is an
   * hour before April 4 is over. A bound built from that wall clock drops the
   * last hour of the day; a bound built backwards from where April 5 begins
   * does not.
   */
  it("keeps the last hour of a day whose zone puts its clocks back at midnight", () => {
    const santiago = parseTimeZone("America/Santiago");
    const end = parseDateInputToInstantString(
      "2026-04-04",
      "endOfDay",
      santiago,
    );

    expect(end).toBe("2026-04-05T03:59:59Z");
    // The moment a local `23:59:59` bound would have stopped at. Canonical
    // instants are fixed-width, so string order is chronological.
    expect("2026-04-05T02:59:59Z" < end!).toBe(true);
    // And it is still inside the day it bounds, by the same reader's clock.
    expect(formatTemporalForDisplay(end!, "day", santiago)).toBe("2026-04-04");
  });

  /**
   * `America/New_York` springs forward on 2026-03-08, so that local day has no
   * `02:00` and runs 23 hours. Both edges still land exactly on it.
   */
  it("bounds a 23-hour day exactly", () => {
    const newYork = parseTimeZone("America/New_York");
    expect(
      parseDateInputToInstantString("2026-03-08", "startOfDay", newYork),
    ).toBe("2026-03-08T05:00:00Z");
    expect(
      parseDateInputToInstantString("2026-03-08", "endOfDay", newYork),
    ).toBe("2026-03-09T03:59:59Z");
  });

  it("bounds a day so that every instant displayed on it falls inside", () => {
    const day = "2024-01-16";
    const start = parseDateInputToInstantString(day, "startOfDay", IN);
    const end = parseDateInputToInstantString(day, "endOfDay", IN);
    const firstMinute = "2024-01-15T18:30:00Z";
    const lastMinute = "2024-01-16T18:29:00Z";

    expect(formatTemporalForDisplay(firstMinute, "day", IN)).toBe(day);
    expect(formatTemporalForDisplay(lastMinute, "day", IN)).toBe(day);
    // Canonical instants are fixed-width, so string order is chronological.
    expect(start !== null && firstMinute >= start).toBe(true);
    expect(end !== null && lastMinute <= end).toBe(true);
  });

  it("clears empty date input values to null", () => {
    expect(parseDateInputToInstantString("", "startOfDay", IN)).toBeNull();
  });

  it("rejects a day that is not a calendar date", () => {
    expect(() =>
      parseDateInputToInstantString("2024-02-30", "startOfDay", IN),
    ).toThrow();
  });
});

describe("time zone validity", () => {
  it("accepts IANA ids and UTC the runtime can render", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects a typo and empty text", () => {
    expect(isValidTimeZone("Nowhere/Special")).toBe(false);
    expect(isValidTimeZone("Asia/Kolkota")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("reports the device zone as a valid, renderable zone", () => {
    const device = deviceTimeZone();
    expect(typeof device).toBe("string");
    expect(isValidTimeZone(device)).toBe(true);
  });

  it("hands back the same id it was given, once checked", () => {
    expect(parseTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    // The second ask is answered from the checked set, and must answer the
    // same way.
    expect(parseTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("names the mistake for a zone a caller got wrong", () => {
    expect(() => parseTimeZone("Asia/Kolkota")).toThrow(
      /not a time zone this runtime knows/,
    );
    expect(() => parseTimeZone("")).toThrow();
  });
});

describe("the zones a picker offers", () => {
  it("lists the runtime's zones, every one of them renderable", () => {
    const zones = supportedTimeZones();

    // A runtime with a trimmed tz database still knows the major zones; the
    // count is a floor, not the exact size of any one platform's list.
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain("America/New_York");
    // Under whichever of a renamed pair the runtime calls canonical: Node
    // lists Asia/Calcutta where Firefox lists Asia/Kolkata, and the list is
    // whatever the runtime says rather than a spelling restated here.
    expect(zones.some((zone) => /^Asia\/(Kolkata|Calcutta)$/.test(zone))).toBe(
      true,
    );
    expect(zones.every((zone) => isValidTimeZone(zone))).toBe(true);
  });

  it("leaves UTC out, since a picker offers it on its own", () => {
    expect(supportedTimeZones()).not.toContain("UTC");
  });
});

describe("the short name a zone is shown under", () => {
  // A fixed instant in January, so the northern-hemisphere zones below are on
  // their standard offsets rather than on whichever one today happens to fall
  // in.
  const WINTER = parseCanonicalInstant("2026-01-15T12:00:00Z");
  const SUMMER = parseCanonicalInstant("2026-07-15T12:00:00Z");

  it("reads as the offset in effect, to the minute", () => {
    expect(formatTimeZoneOffsetLabel(IN, WINTER)).toBe("UTC+05:30");
    expect(
      formatTimeZoneOffsetLabel(parseTimeZone("America/New_York"), WINTER),
    ).toBe("UTC-05:00");
  });

  it("says plain UTC where the offset is zero", () => {
    expect(formatTimeZoneOffsetLabel(UTC, WINTER)).toBe("UTC");
    expect(
      formatTimeZoneOffsetLabel(parseTimeZone("Europe/London"), WINTER),
    ).toBe("UTC");
  });

  it("follows a zone across daylight saving", () => {
    expect(formatTimeZoneOffsetLabel(DST, WINTER)).toBe("UTC-08:00");
    expect(formatTimeZoneOffsetLabel(DST, SUMMER)).toBe("UTC-07:00");
  });

  it("reads the offset in effect now when no moment is named", () => {
    expect(formatTimeZoneOffsetLabel(IN)).toBe("UTC+05:30");
  });
});

describe("the calendar day an instant falls on", () => {
  it("answers the local day, not the stored one", () => {
    // Half past nine at night in London is two in the morning in Kolkata, on
    // the next day.
    expect(localDayInZone("2026-08-23T21:30:00Z", UTC)).toBe("2026-08-23");
    expect(localDayInZone("2026-08-23T21:30:00Z", IN)).toBe("2026-08-24");
  });

  it("is exact at both edges of a local day", () => {
    // Kolkata is UTC+05:30, so 2026-08-24 there runs from 18:30 on the 23rd
    // to 18:30 on the 24th, in UTC.
    expect(localDayInZone("2026-08-23T18:29:59Z", IN)).toBe("2026-08-23");
    expect(localDayInZone("2026-08-23T18:30:00Z", IN)).toBe("2026-08-24");
    expect(localDayInZone("2026-08-24T18:29:59Z", IN)).toBe("2026-08-24");
    expect(localDayInZone("2026-08-24T18:30:00Z", IN)).toBe("2026-08-25");
  });

  /**
   * Los Angeles springs forward on 2026-03-08, so that local day has no 02:00
   * and runs 23 hours; it falls back on 2026-11-01, so that one runs 25 and
   * its 01:30 happens twice. The window a day occupies is resolved from the
   * zone rather than from an offset, so neither is a special case.
   */
  it("holds a day that runs 23 hours, and one that runs 25", () => {
    // The 23-hour day is [08:00Z on the 8th, 07:00Z on the 9th): it opens on
    // UTC-08:00 and closes on UTC-07:00.
    expect(localDayInZone("2026-03-08T07:59:59Z", DST)).toBe("2026-03-07");
    expect(localDayInZone("2026-03-08T08:00:00Z", DST)).toBe("2026-03-08");
    expect(localDayInZone("2026-03-09T06:59:59Z", DST)).toBe("2026-03-08");
    expect(localDayInZone("2026-03-09T07:00:00Z", DST)).toBe("2026-03-09");

    // Both 01:30s on the fall-back day, an hour apart, are on the same day.
    expect(localDayInZone("2026-11-01T08:30:00Z", DST)).toBe("2026-11-01");
    expect(localDayInZone("2026-11-01T09:30:00Z", DST)).toBe("2026-11-01");
    expect(localDayInZone("2026-11-01T06:59:59Z", DST)).toBe("2026-10-31");
    expect(localDayInZone("2026-11-02T07:59:59Z", DST)).toBe("2026-11-01");
    expect(localDayInZone("2026-11-02T08:00:00Z", DST)).toBe("2026-11-02");
  });

  it("holds a 12:45 offset, and the day it changes", () => {
    // Chatham is the awkward one: a quarter-hour offset that moves inside the
    // range a report would scan.
    const zone = parseTimeZone("Pacific/Chatham");

    expect(localDayInZone("2026-09-26T11:14:59Z", zone)).toBe("2026-09-26");
    expect(localDayInZone("2026-09-26T11:15:00Z", zone)).toBe("2026-09-27");
    expect(localDayInZone("2026-09-27T10:14:59Z", zone)).toBe("2026-09-27");
    expect(localDayInZone("2026-09-27T10:15:00Z", zone)).toBe("2026-09-28");
  });

  it("keeps zones apart", () => {
    const at = "2026-08-23T21:30:00Z";
    expect(localDayInZone(at, IN)).toBe("2026-08-24");
    expect(localDayInZone(at, UTC)).toBe("2026-08-23");
    expect(localDayInZone(at, IN)).toBe("2026-08-24");
  });

  it("refuses a value that is not an instant", () => {
    expect(() => localDayInZone("2026-02-30T00:00:00Z", UTC)).toThrow();
    expect(() => localDayInZone("not a moment", UTC)).toThrow();
  });
});
