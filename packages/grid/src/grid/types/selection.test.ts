import { describe, expect, it } from "vitest";
import { makeRowId, rootPath, type RowId } from "./identity";
import type { DisplayedRows, LevelRow } from "./level-row";
import type { ColumnSchema } from "./schema";
import type { CellSelectionState } from "./selection";
import { resolveCellSelectionRectangle, rowsInSelection } from "./selection";

const path = rootPath("rows");
const rowTwo = row("two", { a: 2, b: 20, c: 200 });
const rowOne = row("one", { a: 1, b: 10, c: 100 });
const rowThree = row("three", { a: 3, b: 30, c: 300 });
const displayed = displayedRows([rowTwo, rowOne, rowThree]);

describe("resolveCellSelectionRectangle", () => {
  it.each([
    ["forward", selection(rowTwo.id, "b", rowThree.id, "c")],
    ["reverse", selection(rowThree.id, "c", rowTwo.id, "b")],
  ])(
    "resolves %s ranges in displayed row and schema column order",
    (_direction, selected) => {
      const columns = [column("a"), column("b"), column("c")];

      expect(
        resolveCellSelectionRectangle(selected, displayed, columns),
      ).toEqual({
        rows: [rowTwo, rowOne, rowThree],
        columns: [columns[1], columns[2]],
      });
    },
  );

  it("returns null for stale row or column endpoints", () => {
    const columns = [column("a")];

    expect(
      resolveCellSelectionRectangle(
        selection(makeRowId(path, "missing"), "a", rowOne.id, "a"),
        displayed,
        columns,
      ),
    ).toBeNull();
    expect(
      resolveCellSelectionRectangle(
        selection(rowOne.id, "missing", rowThree.id, "a"),
        displayed,
        columns,
      ),
    ).toBeNull();
  });
});

describe("rowsInSelection", () => {
  it("keeps its row-only projection independent of column endpoints", () => {
    expect(
      rowsInSelection(
        selection(rowThree.id, "stale", rowTwo.id, "also-stale"),
        displayed,
      ),
    ).toEqual([rowTwo.id, rowOne.id, rowThree.id]);
  });
});

function column(id: string): ColumnSchema {
  return {
    id,
    name: id.toUpperCase(),
    renderCell: ({ value }) => String(value ?? ""),
  };
}

function row(
  rowKey: string,
  columns: Readonly<Record<string, unknown>>,
): LevelRow {
  return {
    kind: "data",
    id: makeRowId(path, rowKey),
    rowSelectable: true,
    columns,
    hasChildren: false,
    source: { rowKey, levelName: "rows", columns },
  };
}

function displayedRows(rows: readonly LevelRow[]): DisplayedRows {
  return {
    rows,
    rowById: new Map(rows.map((current) => [current.id, current])),
    rowIndexById: new Map(rows.map((current, index) => [current.id, index])),
  };
}

function selection(
  anchorRowId: RowId,
  anchorColId: string,
  headRowId: RowId,
  headColId: string,
): CellSelectionState {
  return {
    anchor: { rowId: anchorRowId, colId: anchorColId },
    head: { rowId: headRowId, colId: headColId },
  };
}
