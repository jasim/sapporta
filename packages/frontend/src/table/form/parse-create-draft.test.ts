import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { parseDateTimeLocalInputToCanonicalInstantString } from "@sapporta/shared/temporal";
import { parseCreateDraft } from "./parse-create-draft";

const TABLE: TableSchema = {
  name: "invoices",
  label: "Invoices",
  immutable: false,
  rowLabelColumns: ["number"],
  children: [],
  columns: [
    {
      name: "id",
      label: "ID",
      kind: "number",
      primary: true,
      hasDefault: true,
    },
    { name: "number", label: "Number", kind: "text", notNull: true },
    { name: "total", label: "Total", kind: "number", notNull: true },
    {
      name: "discount",
      label: "Discount",
      kind: "number",
      notNull: true,
      hasDefault: true,
    },
    { name: "tax", label: "Tax", kind: "number" },
    { name: "notes", label: "Notes", kind: "text" },
    { name: "issued_on", label: "Issued on", kind: "date" },
    { name: "sent_at", label: "Sent at", kind: "timestamp" },
  ],
};

describe("parseCreateDraft", () => {
  it("turns a finite currency draft into the numeric request value", () => {
    expect(
      parseCreateDraft(TABLE, {
        number: "INV-1",
        total: "12.50",
      }),
    ).toEqual({
      ok: true,
      value: { number: "INV-1", total: 12.5 },
    });
  });

  it("reports invalid numeric text without changing the draft", () => {
    const draft = { number: "INV-1", total: "-" };
    expect(parseCreateDraft(TABLE, draft)).toEqual({
      ok: false,
      issues: [{ field: "total", message: "Enter a finite number." }],
    });
    expect(draft.total).toBe("-");
  });

  it("distinguishes required, defaulted, nullable, and empty text values", () => {
    expect(
      parseCreateDraft(TABLE, {
        number: "INV-1",
        total: "",
        discount: "",
        tax: "",
        notes: "",
      }),
    ).toEqual({
      ok: false,
      issues: [{ field: "total", message: "Total is required." }],
    });

    expect(
      parseCreateDraft(TABLE, {
        number: "INV-1",
        total: "5",
        discount: "",
        tax: "",
        notes: "",
      }),
    ).toEqual({
      ok: true,
      value: { number: "INV-1", total: 5, notes: "" },
    });
  });

  it("strictly decodes dates and canonicalizes local timestamps", () => {
    const timestamp = "2026-07-18T10:30:45";
    expect(
      parseCreateDraft(TABLE, {
        number: "INV-1",
        total: "5",
        issued_on: "2026-07-18",
        sent_at: timestamp,
      }),
    ).toEqual({
      ok: true,
      value: {
        number: "INV-1",
        total: 5,
        issued_on: "2026-07-18",
        sent_at: parseDateTimeLocalInputToCanonicalInstantString(timestamp),
      },
    });

    expect(
      parseCreateDraft(TABLE, {
        number: "INV-1",
        total: "5",
        issued_on: "2026-02-30",
      }),
    ).toEqual({
      ok: false,
      issues: [{ field: "issued_on", message: "Enter a valid date." }],
    });
  });
});
