import { describe, expect, it } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import {
  decodeTableValueDraft,
  parseTablePatchValueDraft,
} from "./table-value-draft";

const amount = {
  name: "amount",
  label: "Amount",
  kind: "number",
} satisfies ColumnSchema;

describe("table value drafts", () => {
  it("uses the numeric editor grammar for schema-backed table inputs", () => {
    expect(decodeTableValueDraft(amount, "1,250.50")).toEqual({
      kind: "value",
      value: 1250.5,
    });
    expect(decodeTableValueDraft(amount, "-")).toEqual({
      kind: "invalid",
      message: "Enter a finite number.",
    });
  });

  it("keeps an empty text value but clears an empty non-text patch value", () => {
    expect(
      decodeTableValueDraft(
        { name: "notes", label: "Notes", kind: "text" },
        "",
      ),
    ).toEqual({ kind: "value", value: "" });
    expect(parseTablePatchValueDraft(amount, "")).toEqual({
      ok: true,
      value: null,
    });
  });
});
