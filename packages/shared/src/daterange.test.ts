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
import { parsePlainDate } from "./temporal.js";

const today = parsePlainDate("2025-04-15");

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
        today,
      ),
    ).toEqual({
      state: custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-01-31")),
      from: "2024-01-01",
      to: "2024-01-31",
    });
  });

  it("resolves relative query params against the supplied today", () => {
    expect(
      resolveDateRangeQueryBounds("period", { period_relative: "mtd" }, today),
    ).toEqual({
      state: relative("mtd"),
      from: "2025-04-01",
      to: "2025-04-15",
    });
  });

  it("returns null bounds for all time", () => {
    expect(resolveDateRangeQueryBounds("period", {}, today)).toEqual({
      state: allTime(),
      from: null,
      to: null,
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
