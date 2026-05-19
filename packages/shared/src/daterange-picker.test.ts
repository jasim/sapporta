import { describe, expect, it } from "vitest";
import { DATE_RANGE_SELECT_KEYS } from "./daterange-picker.js";

describe("DATE_RANGE_SELECT_KEYS", () => {
  it("includes every union arm and every relative duration exactly once", () => {
    const set = new Set(DATE_RANGE_SELECT_KEYS);
    expect(set.size).toBe(DATE_RANGE_SELECT_KEYS.length);
    expect(set.has("all_time")).toBe(true);
    expect(set.has("custom")).toBe(true);
    for (const d of ["7d", "30d", "90d", "1y", "mtd", "ytd"] as const) {
      expect(set.has(d)).toBe(true);
    }
  });
});
