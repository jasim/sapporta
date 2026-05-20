import { describe, expect, it } from "vitest";
import {
  allTime,
  custom,
  parsePlainDate,
  relative,
  serializeDateRange,
  type DateRangeState,
} from "@sapporta/shared";
import {
  customBoundString,
  parseDateRangeLenient,
  selectKeyFromState,
  stateFromSelectKey,
  updateCustomBound,
} from "./daterange-picker";

describe("selectKeyFromState", () => {
  it("all_time -> 'all_time'", () => {
    expect(selectKeyFromState(allTime())).toBe("all_time");
  });

  it("relative -> the duration token", () => {
    expect(selectKeyFromState(relative("7d"))).toBe("7d");
    expect(selectKeyFromState(relative("mtd"))).toBe("mtd");
    expect(selectKeyFromState(relative("ytd"))).toBe("ytd");
  });

  it("custom -> 'custom' regardless of bounds", () => {
    expect(selectKeyFromState(custom(null, null))).toBe("custom");
    expect(
      selectKeyFromState(
        custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-12-31")),
      ),
    ).toBe("custom");
  });
});

describe("stateFromSelectKey", () => {
  it("'all_time' -> allTime()", () => {
    expect(stateFromSelectKey("all_time", relative("30d"))).toEqual(allTime());
  });

  it("relative key -> relative(key)", () => {
    expect(stateFromSelectKey("30d", allTime())).toEqual(relative("30d"));
    expect(stateFromSelectKey("ytd", custom(null, null))).toEqual(
      relative("ytd"),
    );
  });

  it("'custom' from non-custom -> unbounded custom", () => {
    expect(stateFromSelectKey("custom", allTime())).toEqual(custom(null, null));
    expect(stateFromSelectKey("custom", relative("7d"))).toEqual(
      custom(null, null),
    );
  });

  it("'custom' while already in custom preserves bounds", () => {
    const prior = custom(parsePlainDate("2024-01-01"), null);
    expect(stateFromSelectKey("custom", prior)).toBe(prior);
  });
});

describe("parseDateRangeLenient", () => {
  it("no keys -> all_time", () => {
    expect(parseDateRangeLenient("period", {})).toEqual(allTime());
  });

  it("valid keys -> parsed state", () => {
    expect(parseDateRangeLenient("period", { period_relative: "30d" })).toEqual(
      relative("30d"),
    );
    expect(
      parseDateRangeLenient("period", {
        period_from: "2024-01-01",
        period_to: "2024-12-31",
      }),
    ).toEqual(
      custom(parsePlainDate("2024-01-01"), parsePlainDate("2024-12-31")),
    );
  });

  it("malformed values -> all_time without throwing", () => {
    expect(
      parseDateRangeLenient("period", { period_relative: "bogus" }),
    ).toEqual(allTime());
    expect(
      parseDateRangeLenient("period", { period_from: "2024-13-01" }),
    ).toEqual(allTime());
    expect(
      parseDateRangeLenient("period", {
        period_relative: "30d",
        period_from: "2024-01-01",
      }),
    ).toEqual(allTime());
  });

  it("URL-round-trip: the wire params survive URLSearchParams unchanged", () => {
    const wire = serializeDateRange(relative("7d"), "period");
    const sp = new URLSearchParams(wire);
    expect(sp.toString()).toBe("period_relative=7d");
    const decoded = Object.fromEntries(new URLSearchParams(sp.toString()));
    expect(parseDateRangeLenient("period", decoded)).toEqual(relative("7d"));
  });

  it("URL-round-trip for custom range", () => {
    const state = custom(
      parsePlainDate("2026-04-06"),
      parsePlainDate("2026-04-30"),
    );
    const wire = serializeDateRange(state, "period");
    const sp = new URLSearchParams(wire);
    expect(sp.toString()).toBe("period_from=2026-04-06&period_to=2026-04-30");
    const decoded = Object.fromEntries(new URLSearchParams(sp.toString()));
    expect(parseDateRangeLenient("period", decoded)).toEqual(state);
  });
});

describe("updateCustomBound", () => {
  const base: DateRangeState = custom(null, null);

  it("sets start", () => {
    expect(updateCustomBound(base, "start", "2024-01-01")).toEqual(
      custom(parsePlainDate("2024-01-01"), null),
    );
  });

  it("sets end", () => {
    expect(updateCustomBound(base, "end", "2024-12-31")).toEqual(
      custom(null, parsePlainDate("2024-12-31")),
    );
  });

  it("empty string clears bound to null", () => {
    const prior = custom(
      parsePlainDate("2024-01-01"),
      parsePlainDate("2024-12-31"),
    );
    expect(updateCustomBound(prior, "start", "")).toEqual(
      custom(null, parsePlainDate("2024-12-31")),
    );
    expect(updateCustomBound(prior, "end", "")).toEqual(
      custom(parsePlainDate("2024-01-01"), null),
    );
  });

  it("preserves the other bound when editing one side", () => {
    const prior = custom(
      parsePlainDate("2024-01-01"),
      parsePlainDate("2024-12-31"),
    );
    expect(updateCustomBound(prior, "start", "2024-06-01")).toEqual(
      custom(parsePlainDate("2024-06-01"), parsePlainDate("2024-12-31")),
    );
  });

  it("malformed date leaves state untouched", () => {
    const prior = custom(parsePlainDate("2024-01-01"), null);
    expect(updateCustomBound(prior, "end", "not-a-date")).toBe(prior);
    expect(updateCustomBound(prior, "end", "2024-13-40")).toBe(prior);
  });

  it("returns state unchanged when not in custom mode", () => {
    expect(updateCustomBound(allTime(), "start", "2024-01-01")).toEqual(
      allTime(),
    );
    expect(updateCustomBound(relative("7d"), "end", "2024-01-01")).toEqual(
      relative("7d"),
    );
  });
});

describe("customBoundString", () => {
  it("returns yyyy-mm-dd for a set bound", () => {
    const s = custom(
      parsePlainDate("2024-01-01"),
      parsePlainDate("2024-12-31"),
    );
    expect(customBoundString(s, "start")).toBe("2024-01-01");
    expect(customBoundString(s, "end")).toBe("2024-12-31");
  });

  it("returns '' for an open bound", () => {
    const s = custom(null, parsePlainDate("2024-12-31"));
    expect(customBoundString(s, "start")).toBe("");
    expect(customBoundString(s, "end")).toBe("2024-12-31");
  });

  it("returns '' when state is not custom", () => {
    expect(customBoundString(allTime(), "start")).toBe("");
    expect(customBoundString(relative("7d"), "end")).toBe("");
  });
});
