import { describe, expect, it } from "vitest";
import { formatCurrency } from "./format";

describe("column preset formatters", () => {
  it("formats currency magnitudes without adding a currency symbol or code", () => {
    const formatted = formatCurrency(125);

    expect(formatted).toMatch(/^125[.,]00$/);
    expect(formatted).not.toContain("$");
    expect(formatted).not.toContain("USD");
  });
});
