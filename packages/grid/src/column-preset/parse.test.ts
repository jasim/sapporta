import { describe, expect, it } from "vitest";
import { parseNumericInput } from "./parse";

describe("parseNumericInput", () => {
  it("decodes finite editor text", () => {
    expect(parseNumericInput("12.50")).toEqual({ ok: true, value: 12.5 });
    expect(parseNumericInput(" 1,250 ")).toEqual({ ok: true, value: 1250 });
  });

  it("keeps empty and invalid input distinct", () => {
    expect(parseNumericInput("  ")).toEqual({ ok: true, value: null });
    expect(parseNumericInput("-")).toEqual({ ok: false });
  });
});
