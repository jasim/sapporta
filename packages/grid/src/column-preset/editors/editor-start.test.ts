import { describe, expect, it } from "vitest";
import type {
  CellEditorProps,
  CellEditorStart,
  ColumnSchema,
} from "../../grid/types/schema";
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

function props(editStart: CellEditorStart, value: unknown): CellEditorProps {
  const c = column("a");
  const row: LevelRow = {
    kind: "data",
    id: makeRowId(path, "r0"),
    rowSelectable: true,
    columns: { a: value },
    hasChildren: false,
    source: { rowKey: "r0", levelName: "rows", columns: { a: value } },
  };
  return {
    editStart,
    value,
    row,
    column: c,
    path,
    anchor: {} as HTMLElement,
    commit: () => {},
    cancel: () => {},
  };
}

function textInitialValue(editStart: CellEditorStart, value: unknown): string {
  const p = props(editStart, value);
  return initialTextEditorValue(p.value, p.editStart);
}

function numericInitialValue(
  editStart: CellEditorStart,
  value: unknown,
): string {
  const p = props(editStart, value);
  return initialNumericEditorValue(p.value, p.editStart);
}

function dateInitialValue(editStart: CellEditorStart, value: unknown): string {
  const p = props(editStart, value);
  return initialDateEditorValue(p.value, p.editStart);
}

describe("preset editor start values", () => {
  it("initializes text edits from the raw value on double-click", () => {
    expect(textInitialValue({ trigger: "doubleClick" }, "existing")).toBe(
      "existing",
    );
  });

  it("initializes text edits from the typed seed for type starts", () => {
    expect(
      textInitialValue({ trigger: "type", typedSeed: "z" }, "existing"),
    ).toBe("z");
  });

  it("initializes nullish text values as blank for non-type starts", () => {
    expect(textInitialValue({ trigger: "doubleClick" }, null)).toBe("");
    expect(textInitialValue({ trigger: "doubleClick" }, undefined)).toBe("");
  });

  it("initializes numeric edits from raw model values", () => {
    expect(numericInitialValue({ trigger: "doubleClick" }, 1234.5)).toBe(
      "1234.5",
    );
    expect(
      numericInitialValue({ trigger: "type", typedSeed: "7" }, 1234.5),
    ).toBe("7");
  });

  it("does not decorate currency or percentage raw values for editing", () => {
    expect(numericInitialValue({ trigger: "enter" }, 12.5)).toBe("12.5");
    expect(numericInitialValue({ trigger: "f2" }, 0.15)).toBe("0.15");
  });

  it("initializes date edits from the raw value unless type-started", () => {
    expect(dateInitialValue({ trigger: "doubleClick" }, "2026-05-15")).toBe(
      "2026-05-15",
    );
    expect(
      dateInitialValue({ trigger: "type", typedSeed: "2" }, "2026-05-15"),
    ).toBe("2");
  });
});
