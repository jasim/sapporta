import { describe, expect, it } from "vitest";
import {
  allTime,
  custom,
  DateRangeParseError,
  dateRangeFieldNames,
  parseDateRange,
  relative,
  resolveDateRange,
  resolveDateRangeQueryBounds,
  serializeDateRange,
  snapshotDateRange,
} from "./daterange.js";
import {
  parseCanonicalInstant,
  parsePlainDate,
  parseTimeZone,
} from "./temporal.js";

const today = parsePlainDate("2025-04-15");
const utc = parseTimeZone("UTC");
const kolkata = parseTimeZone("Asia/Kolkata");
const santiago = parseTimeZone("America/Santiago");
const newYork = parseTimeZone("America/New_York");
/** 2025-04-15 in UTC, and still 2025-04-15 in Kolkata five and a half hours on. */
const now = parseCanonicalInstant("2025-04-15T12:00:00Z");

describe("resolveDateRange", () => {
  it("all_time → unbounded both sides", () => {
    expect(resolveDateRange(allTime(), today)).toEqual({
      from: null,
      to: null,
    });
  });

  it("relative 7d → today minus 7 days to today", () => {
    const { from, to } = resolveDateRange(relative("7d"), today);
    expect(from?.toString()).toBe("2025-04-08");
    expect(to?.toString()).toBe("2025-04-15");
  });

  it("relative 30d", () => {
    const { from, to } = resolveDateRange(relative("30d"), today);
    expect(from?.toString()).toBe("2025-03-16");
    expect(to?.toString()).toBe("2025-04-15");
  });

  it("relative 1y", () => {
    const { from, to } = resolveDateRange(relative("1y"), today);
    expect(from?.toString()).toBe("2024-04-15");
    expect(to?.toString()).toBe("2025-04-15");
  });

  it("relative mtd → first of this month to today", () => {
    const { from, to } = resolveDateRange(relative("mtd"), today);
    expect(from?.toString()).toBe("2025-04-01");
    expect(to?.toString()).toBe("2025-04-15");
  });

  it("relative ytd → jan 1 this year to today", () => {
    const { from, to } = resolveDateRange(relative("ytd"), today);
    expect(from?.toString()).toBe("2025-01-01");
    expect(to?.toString()).toBe("2025-04-15");
  });

  it("custom passes dates through", () => {
    const s = parsePlainDate("2024-01-01");
    const e = parsePlainDate("2024-12-31");
    expect(resolveDateRange(custom(s, e), today)).toEqual({ from: s, to: e });
  });

  it("custom open start", () => {
    const e = parsePlainDate("2024-12-31");
    expect(resolveDateRange(custom(null, e), today)).toEqual({
      from: null,
      to: e,
    });
  });

  it("custom open end", () => {
    const s = parsePlainDate("2024-01-01");
    expect(resolveDateRange(custom(s, null), today)).toEqual({
      from: s,
      to: null,
    });
  });
});

describe("dateRangeFieldNames", () => {
  it("prefixes the three suffixes with the param name", () => {
    expect(dateRangeFieldNames("period")).toEqual({
      relative: "period_relative",
      from: "period_from",
      to: "period_to",
    });
  });
});

describe("serializeDateRange / parseDateRange — round-trip", () => {
  const P = "period";
  const cases: {
    state: ReturnType<typeof allTime>;
    wire: Record<string, string>;
  }[] = [
    { state: allTime(), wire: {} },
    { state: relative("30d"), wire: { period_relative: "30d" } },
    { state: relative("mtd"), wire: { period_relative: "mtd" } },
    {
      state: custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-12-31")),
      wire: { period_from: "2024-01-01", period_to: "2024-12-31" },
    },
    {
      state: custom(null, parsePlainDate("2024-12-31")),
      wire: { period_to: "2024-12-31" },
    },
    {
      state: custom(parsePlainDate("2024-01-01"), null),
      wire: { period_from: "2024-01-01" },
    },
    { state: custom(null, null), wire: {} },
  ];

  for (const { state, wire } of cases) {
    it(`${state.type}: ${JSON.stringify(wire)}`, () => {
      expect(serializeDateRange(state, P)).toEqual(wire);
      const parsed = parseDateRange(P, wire);
      expect(serializeDateRange(parsed, P)).toEqual(wire);
    });
  }
});

describe("parseDateRange — error cases", () => {
  it("rejects unknown relative duration", () => {
    expect(() => parseDateRange("period", { period_relative: "5d" })).toThrow(
      DateRangeParseError,
    );
  });

  it("rejects invalid custom date", () => {
    expect(() =>
      parseDateRange("period", { period_from: "2024-13-01" }),
    ).toThrow(DateRangeParseError);
  });

  it("rejects relative combined with from/to", () => {
    expect(() =>
      parseDateRange("period", {
        period_relative: "30d",
        period_from: "2024-01-01",
      }),
    ).toThrow(DateRangeParseError);
  });

  it("rejects non-string field values", () => {
    expect(() =>
      parseDateRange("period", { period_from: 20240101 as unknown as string }),
    ).toThrow(DateRangeParseError);
  });

  it("isolates fields to the named param", () => {
    // Other keys in the map must not leak into this param's parsing.
    expect(
      parseDateRange("period", {
        period: "ignored",
        other_relative: "30d",
      }),
    ).toEqual(allTime());
  });
});

describe("resolveDateRangeQueryBounds", () => {
  it("parses and serializes custom bounds for route handlers", () => {
    expect(
      resolveDateRangeQueryBounds(
        "period",
        {
          period_from: "2024-01-01",
          period_to: "2024-01-31",
        },
        utc,
        now,
      ),
    ).toMatchObject({
      state: custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-01-31")),
      days: { from: "2024-01-01", to: "2024-01-31" },
    });
  });

  it("resolves relative query params against the day it is in the zone", () => {
    expect(
      resolveDateRangeQueryBounds(
        "period",
        { period_relative: "mtd" },
        utc,
        now,
      ),
    ).toMatchObject({
      state: relative("mtd"),
      days: { from: "2025-04-01", to: "2025-04-15" },
    });
  });

  /**
   * The instant is the same; the day it falls on is not. This is what the
   * removed zone-free `today` default got wrong: it read
   * the host's `TZ`, so the same report answered differently depending on how
   * the container was started.
   */
  it("reads today in the workspace zone rather than the machine's", () => {
    const evening = parseCanonicalInstant("2025-04-15T19:00:00Z");
    expect(
      resolveDateRangeQueryBounds(
        "period",
        { period_relative: "7d" },
        utc,
        evening,
      ).days.to,
    ).toBe("2025-04-15");
    expect(
      resolveDateRangeQueryBounds(
        "period",
        { period_relative: "7d" },
        kolkata,
        evening,
      ).days.to,
    ).toBe("2025-04-16");
  });

  it("returns null bounds for all time, in both shapes", () => {
    expect(resolveDateRangeQueryBounds("period", {}, utc, now)).toEqual({
      state: allTime(),
      days: { from: null, to: null },
      instants: { from: null, until: null },
    });
  });

  it("bounds a custom range by the instants the days occupy in the zone", () => {
    expect(
      resolveDateRangeQueryBounds(
        "period",
        { period_from: "2024-01-01", period_to: "2024-01-31" },
        kolkata,
        now,
      ),
    ).toMatchObject({
      state: custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-01-31")),
      instants: {
        from: "2023-12-31T18:30:00Z",
        until: "2024-01-31T18:30:00Z",
      },
    });
  });

  /**
   * The upper bound is the start of the day after, so every instant stored on
   * the last named day is inside the window. An inclusive plain-date bound
   * compared against a `timestamp` column drops that day entirely, because
   * `"2024-01-31T09:00:00Z"` sorts after `"2024-01-31"`.
   */
  it("includes the whole of the last named day", () => {
    const { instants } = resolveDateRangeQueryBounds(
      "period",
      { period_from: "2024-01-31", period_to: "2024-01-31" },
      utc,
      now,
    );
    const until = instants.until;
    expect(until).toBe("2024-02-01T00:00:00Z");
    expect("2024-01-31T23:59:59Z" < until!).toBe(true);
  });

  /**
   * `America/Santiago` leaves daylight saving on 2026-04-05, so local
   * `2026-04-04T23:59:59` resolves an hour before the day actually ends. A
   * closed bound built from that wall clock drops the last hour of April 4;
   * the half-open bound is the start of April 5, which does not.
   */
  it("keeps the last hour of a day whose zone falls back", () => {
    const { instants } = resolveDateRangeQueryBounds(
      "period",
      { period_from: "2026-04-04", period_to: "2026-04-04" },
      santiago,
      now,
    );
    const until = instants.until;
    expect(until).toBe("2026-04-05T04:00:00Z");
    // The moment a closed `23:59:59` bound would have stopped at, an hour
    // before the day is over.
    expect("2026-04-05T02:59:59Z" < until!).toBe(true);
  });

  /**
   * `America/New_York` springs forward on 2026-03-08, so that local day has no
   * `00:00`-to-`24:00` shape and runs 23 hours. The window is still exactly
   * the day.
   */
  it("bounds a 23-hour day exactly", () => {
    expect(
      resolveDateRangeQueryBounds(
        "period",
        { period_from: "2026-03-08", period_to: "2026-03-08" },
        newYork,
        now,
      ),
    ).toMatchObject({
      instants: {
        from: "2026-03-08T05:00:00Z",
        until: "2026-03-09T04:00:00Z",
      },
    });
  });
});

describe("snapshotDateRange", () => {
  it("freezes relative → custom at today", () => {
    const snap = snapshotDateRange(relative("30d"), today);
    expect(snap.type).toBe("custom");
    if (snap.type === "custom") {
      expect(snap.start?.toString()).toBe("2025-03-16");
      expect(snap.end?.toString()).toBe("2025-04-15");
    }
  });

  it("leaves all_time unchanged", () => {
    expect(snapshotDateRange(allTime(), today)).toEqual(allTime());
  });

  it("leaves custom unchanged", () => {
    const s = custom(parsePlainDate("2024-01-01"), null);
    expect(snapshotDateRange(s, today)).toEqual(s);
  });
});
