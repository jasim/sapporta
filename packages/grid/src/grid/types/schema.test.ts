import { describe, expect, it } from "vitest";
import {
  describeCellActivation,
  editStartsOn,
  type ColumnSchema,
} from "./schema";

describe("ColumnSchema helpers", () => {
  it("requires host rendering at compile time", () => {
    // @ts-expect-error ColumnSchema requires an explicit renderer.
    const missingRenderer: ColumnSchema = {
      id: "name" as never,
      name: "Name",
    };

    expect(missingRenderer).toBeDefined();
  });

  it("accepts readonly edit gesture arrays", () => {
    const column: ColumnSchema = {
      id: "name" as never,
      name: "Name",
      renderCell: ({ value }) => String(value ?? ""),
      edit: {
        editor: () => null,
        startsOn: ["enter", "f2"] as const,
      },
    };

    expect(editStartsOn(column, "enter")).toBe(true);
    expect(editStartsOn(column, "type")).toBe(false);
  });

  it("normalizes string activation descriptions to enabled states", () => {
    const column: ColumnSchema = {
      id: "name" as never,
      name: "Name",
      renderCell: ({ value }) => String(value ?? ""),
      activation: {
        startsOn: ["enter"],
        describe: "Open row",
        run: () => {},
      },
    };

    expect(
      describeCellActivation(column.activation!, {
        trigger: { kind: "keyboard", gesture: "enter" },
        value: "Ada",
        row: {
          kind: "data",
          id: "rows#1" as never,
          rowSelectable: true,
          columns: { name: "Ada" },
          hasChildren: false,
          source: {} as never,
        },
        column: { id: column.id, name: column.name },
        path: "rows" as never,
        coord: { rowId: "rows#1" as never, colId: column.id },
        actions: {
          rowExpansion: {
            canToggle: () => false,
            isExpanded: () => false,
            toggle: () => {},
          },
        },
      }),
    ).toEqual({
      label: "Open row",
      availability: { kind: "enabled" },
    });
  });
});
