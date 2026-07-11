import { describe, expect, it } from "vitest";
import {
  describeCellActivation,
  editStartsOn,
  type ColumnSchema,
} from "./schema";
import { makeRowId, rootPath } from "./identity";

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
    const path = rootPath("rows");
    const rowId = makeRowId(path, "1");
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
          id: rowId,
          rowSelectable: true,
          columns: { name: "Ada" },
          hasChildren: false,
          source: { rowKey: "1", levelName: "rows", columns: { name: "Ada" } },
        },
        column: { id: column.id, name: column.name },
        path,
        coord: { rowId, colId: column.id },
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
