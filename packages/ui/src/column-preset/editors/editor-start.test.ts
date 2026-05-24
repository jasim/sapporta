import { describe, expect, it } from "vitest";
import type { CellEditorProps, ColumnSchema } from "../../grid/types/schema";
import { rootPath, makeRowId } from "../../grid/types/identity";
import type { LevelRow } from "../../grid/types/level-row";
import { initialDateEditorValue } from "./DateEditor";
import { initialNumericEditorValue } from "./NumericEditor";
import { initialTextEditorValue } from "./TextEditor";

const path = rootPath("rows");

function column(id: string): ColumnSchema {
  return {
    id,
    name: id,
    renderCell: ({ value }) => String(value ?? ""),
  };
}

function props(
  start:
    | { trigger: "type"; typedSeed: string }
    | { trigger: "click" | "enter" | "f2" },
  value: unknown,
): CellEditorProps {
  const c = column("a");
  const row: LevelRow = {
    kind: "data",
    id: makeRowId(path, "r0"),
    rowSelectable: true,
    columns: { a: value },
    hasChildren: false,
    source: {} as never,
  };
  return {
    ...start,
    value,
    row,
    column: c,
    path,
    anchor: {} as HTMLElement,
    onCommit: () => {},
    onCancel: () => {},
  };
}

describe("preset editor start values", () => {
  it("initializes text edits from the raw value on click", () => {
    expect(initialTextEditorValue(props({ trigger: "click" }, "existing"))).toBe(
      "existing",
    );
  });

  it("initializes text edits from the typed seed for type starts", () => {
    expect(
      initialTextEditorValue(
        props({ trigger: "type", typedSeed: "z" }, "existing"),
      ),
    ).toBe("z");
  });

  it("initializes nullish text values as blank for non-type starts", () => {
    expect(initialTextEditorValue(props({ trigger: "click" }, null))).toBe("");
    expect(initialTextEditorValue(props({ trigger: "click" }, undefined))).toBe(
      "",
    );
  });

  it("initializes numeric edits from raw model values", () => {
    expect(initialNumericEditorValue(props({ trigger: "click" }, 1234.5))).toBe(
      "1234.5",
    );
    expect(
      initialNumericEditorValue(
        props({ trigger: "type", typedSeed: "7" }, 1234.5),
      ),
    ).toBe("7");
  });

  it("does not decorate currency or percentage raw values for editing", () => {
    expect(initialNumericEditorValue(props({ trigger: "enter" }, 12.5))).toBe(
      "12.5",
    );
    expect(initialNumericEditorValue(props({ trigger: "f2" }, 0.15))).toBe(
      "0.15",
    );
  });

  it("initializes date edits from the raw value unless type-started", () => {
    expect(
      initialDateEditorValue(props({ trigger: "click" }, "2026-05-15")),
    ).toBe("2026-05-15");
    expect(
      initialDateEditorValue(
        props({ trigger: "type", typedSeed: "2" }, "2026-05-15"),
      ),
    ).toBe("2");
  });
});
