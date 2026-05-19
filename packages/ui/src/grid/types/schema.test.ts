import { describe, expect, it } from "vitest";
import { triggersFor, type ColumnSchema } from "./schema";

describe("ColumnSchema helpers", () => {
  it("requires host rendering at compile time", () => {
    // @ts-expect-error ColumnSchema requires an explicit renderer.
    const missingRenderer: ColumnSchema = {
      id: "name" as never,
      name: "Name",
    };

    expect(missingRenderer).toBeDefined();
  });

  it("accepts readonly edit trigger arrays", () => {
    const editTriggers = ["enter", "f2"] as const;
    const column: ColumnSchema = {
      id: "name" as never,
      name: "Name",
      renderCell: ({ value }) => String(value ?? ""),
      editTriggers,
    };

    expect(triggersFor(column)).toBe(editTriggers);
  });
});
