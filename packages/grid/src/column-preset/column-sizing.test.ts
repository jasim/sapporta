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
      // 64 is under the column's declared min and 500 is over the numeric
      // preset's max. Both were set by hand, so both stand.
      name: 64,
      amount: 500,
    });
  });

  it("floors an explicit width at the grid's resize minimum", () => {
    expect(sanitizeColumnSizingOverrides({ name: 10 }, schema)).toEqual({
      name: 48,
    });
    expect(sanitizeColumnSizingOverrides({ name: 10 }, schema, 96)).toEqual({
      name: 96,
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

  it("lets an override widen a column past its preset track", () => {
    expect(columnSizingTemplateColumns(schema, { amount: 400 })).toBe(
      "minmax(72px, 180px) 400px minmax(0, 1fr)",
    );
  });
});
