import { describe, expect, it } from "vitest";
import { columnSchemaSchema, tableSchemaSchema } from "./meta-schema.js";

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

describe("tableSchemaSchema", () => {
  const table = {
    name: "accounts",
    label: "Accounts",
    immutable: false,
    columns: [],
    children: [],
    rowLabelColumns: ["name"],
    searchable: true,
  };

  it("keeps a tree declaration", () => {
    const tree = {
      parentColumn: "parent_id",
      column: "name",
      defaultExpanded: true,
      matchContext: "ancestors-and-descendants",
    };
    expect(tableSchemaSchema.parse({ ...table, tree }).tree).toEqual(tree);
    expect(tableSchemaSchema.parse(table).tree).toBeUndefined();
  });
});
