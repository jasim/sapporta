import { describe, expect, it } from "vitest";
import { columnSchemaSchema } from "./meta-schema.js";

describe("columnSchemaSchema", () => {
  it("requires the semantic kind promised by table metadata", () => {
    expect(
      columnSchemaSchema.safeParse({
        name: "total",
        label: "Total",
        kind: "number",
        apiWritable: false,
      }).success,
    ).toBe(true);
    expect(
      columnSchemaSchema.safeParse({ name: "total", label: "Total" }).success,
    ).toBe(false);
  });
});
