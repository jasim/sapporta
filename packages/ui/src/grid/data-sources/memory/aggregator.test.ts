import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../types/level-row";
import { avgBy, sumBy } from "./aggregator";

const node = (cols: Record<string, unknown>): TreeNode => ({
  levelName: "items",
  columns: cols,
});

describe("sumBy", () => {
  it("sums numeric values", () => {
    expect(sumBy([node({ amount: 1 }), node({ amount: 2 }), node({ amount: 3 })], "amount")).toBe(6);
  });

  it("returns 0 over an empty set", () => {
    expect(sumBy([], "amount")).toBe(0);
  });

  it("coerces numeric strings", () => {
    expect(sumBy([node({ amount: "10" }), node({ amount: "20" })], "amount")).toBe(30);
  });

  it("skips null, undefined, NaN, empty strings, and non-numeric strings", () => {
    const nodes = [
      node({ amount: 5 }),
      node({ amount: null }),
      node({ amount: undefined }),
      node({ amount: NaN }),
      node({ amount: "" }),
      node({ amount: "abc" }),
      node({ amount: 7 }),
    ];
    expect(sumBy(nodes, "amount")).toBe(12);
  });
});

describe("avgBy", () => {
  it("averages numeric values", () => {
    expect(avgBy([node({ amount: 2 }), node({ amount: 4 }), node({ amount: 6 })], "amount")).toBe(4);
  });

  it("returns null on an empty set rather than 0 or NaN", () => {
    expect(avgBy([], "amount")).toBeNull();
  });

  it("returns null when no finite values are present", () => {
    expect(avgBy([node({ amount: null }), node({ amount: "abc" })], "amount")).toBeNull();
  });

  it("ignores non-numeric values when computing the denominator", () => {
    expect(avgBy([node({ amount: 2 }), node({ amount: null }), node({ amount: 6 })], "amount")).toBe(4);
  });
});
