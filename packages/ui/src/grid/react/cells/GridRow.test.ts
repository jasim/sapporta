import { describe, expect, it } from "vitest";
import { rowChromeStateFromInteractionStatus } from "./GridRow";

describe("rowChromeStateFromInteractionStatus", () => {
  it.each([
    ["idle", { active: false, selected: false }],
    ["selected", { active: false, selected: true }],
    ["cursor", { active: true, selected: false }],
    ["cursor-selected", { active: true, selected: true }],
  ] as const)("projects %s into orthogonal row chrome", (status, chrome) => {
    expect(rowChromeStateFromInteractionStatus(status)).toEqual(chrome);
  });
});
