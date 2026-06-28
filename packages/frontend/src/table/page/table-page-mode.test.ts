import { describe, expect, it } from "vitest";
import {
  NARROW_TABLE_PAGE_MAX_WIDTH,
  resolveTableGridPresentation,
  resolveTablePageMode,
} from "./table-page-mode";

describe("table page mode", () => {
  it("resolves narrowCards below the narrow breakpoint", () => {
    expect(resolveTablePageMode(NARROW_TABLE_PAGE_MAX_WIDTH - 1)).toBe(
      "narrowCards",
    );
  });

  it("resolves wide at the breakpoint and above", () => {
    expect(resolveTablePageMode(NARROW_TABLE_PAGE_MAX_WIDTH)).toBe("wide");
    expect(resolveTablePageMode(NARROW_TABLE_PAGE_MAX_WIDTH + 1)).toBe("wide");
  });

  it("forces card presentation in narrow mode", () => {
    expect(
      resolveTableGridPresentation({
        mode: "narrowCards",
        preference: "tabular",
      }),
    ).toBe("cards");
  });

  it("maps wide auto to tabular and honors wide cards", () => {
    expect(
      resolveTableGridPresentation({ mode: "wide", preference: "auto" }),
    ).toBe("tabular");
    expect(
      resolveTableGridPresentation({ mode: "wide", preference: "cards" }),
    ).toBe("cards");
  });
});
