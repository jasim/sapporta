import { describe, expect, it } from "vitest";
import { visiblePaginationItems } from "./visible-pagination-items";

describe("visiblePaginationItems", () => {
  it("shows the current page with four previous and four next pages", () => {
    expect(visiblePaginationItems(50, 200)).toEqual([
      1,
      "ellipsis",
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      "ellipsis",
      200,
    ]);
  });

  it("shows every page when the sibling window covers the full list", () => {
    const allEightPages = [1, 2, 3, 4, 5, 6, 7, 8];

    expect(visiblePaginationItems(3, 8)).toEqual(allEightPages);
    expect(visiblePaginationItems(6, 8)).toEqual(allEightPages);
  });

  it("uses ellipses around the four-page sibling window in a 15-page list", () => {
    expect(visiblePaginationItems(5, 15)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      "ellipsis",
      15,
    ]);
    expect(visiblePaginationItems(8, 15)).toEqual([
      1,
      "ellipsis",
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      "ellipsis",
      15,
    ]);
    expect(visiblePaginationItems(10, 15)).toEqual([
      1,
      "ellipsis",
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
    ]);
  });

  it("keeps the beginning contiguous when the current page is near the start", () => {
    expect(visiblePaginationItems(3, 20)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      "ellipsis",
      20,
    ]);
  });

  it("keeps the end contiguous when the current page is near the end", () => {
    expect(visiblePaginationItems(198, 200)).toEqual([
      1,
      "ellipsis",
      194,
      195,
      196,
      197,
      198,
      199,
      200,
    ]);
  });

  it("fills a one-page gap instead of showing an ellipsis", () => {
    expect(visiblePaginationItems(7, 20)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      "ellipsis",
      20,
    ]);
  });

  it("clamps invalid current pages into the valid page range", () => {
    expect(visiblePaginationItems(0, 10)).toEqual([
      1,
      2,
      3,
      4,
      5,
      "ellipsis",
      10,
    ]);
    expect(visiblePaginationItems(999, 10)).toEqual([
      1,
      "ellipsis",
      6,
      7,
      8,
      9,
      10,
    ]);
  });

  it("returns an empty range when there are no pages", () => {
    expect(visiblePaginationItems(1, 0)).toEqual([]);
  });
});
