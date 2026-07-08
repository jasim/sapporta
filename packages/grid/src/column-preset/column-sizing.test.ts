import { describe, expect, it } from "vitest";
import { columnPreset } from "./columns";
import {
  columnSizingTemplateColumns,
  sanitizeColumnSizingOverrides,
} from "./column-sizing";

const schema = [
  columnPreset.text({
    id: "name",
    name: "Name",
    width: { min: 72, max: 180 },
  }),
  columnPreset.number({
    id: "amount",
    name: "Amount",
  }),
  columnPreset.text({
    id: "notes",
    name: "Notes",
    width: "fill",
  }),
];

describe("column sizing", () => {
  it("sanitizes persisted widths against the current schema", () => {
    expect(
      sanitizeColumnSizingOverrides(
        {
          name: 64,
          amount: 500,
          notes: Number.NaN,
          removed: 120,
          invalid: "wide",
        },
        schema,
      ),
    ).toEqual({
      name: 72,
      amount: 112,
    });
  });

  it("accepts the wrapped persisted shape", () => {
    expect(
      sanitizeColumnSizingOverrides(
        {
          widths: {
            name: 120,
          },
        },
        schema,
      ),
    ).toEqual({ name: 120 });
  });

  it("returns no overrides for invalid persisted shapes", () => {
    expect(sanitizeColumnSizingOverrides(null, schema)).toEqual({});
    expect(sanitizeColumnSizingOverrides(["name", 120], schema)).toEqual({});
    expect(
      sanitizeColumnSizingOverrides({ widths: ["name", 120] }, schema),
    ).toEqual({});
  });

  it("keeps the existing template when there are no overrides", () => {
    expect(columnPreset.templateColumns(schema)).toBe(
      "minmax(72px, 180px) minmax(80px, 112px) minmax(0, 1fr)",
    );
  });

  it("applies pixel overrides to the template", () => {
    expect(columnSizingTemplateColumns(schema, { name: 144 })).toBe(
      "144px minmax(80px, 112px) minmax(0, 1fr)",
    );
  });
});
