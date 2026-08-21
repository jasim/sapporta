import { describe, expect, it } from "vitest";
import { buildDisplayed } from "../pipeline/stages/build-displayed";
import { makeRowId, rootPath, rowKeyOfRowId } from "./identity";
import type { DisplayedRows, LevelRow } from "./level-row";
import {
  makeRowRangeSelection,
  makeRowSetSelection,
  normalizeRowSelection,
  rowIdsInRowSelection,
  rowSelectionContainsRow,
} from "./row-selection";

const path = rootPath("rows");
const r0 = makeRowId(path, "r0");
const r1 = makeRowId(path, "r1");
const r2 = makeRowId(path, "r2");

function displayed(): DisplayedRows {
  return buildDisplayed([row(r0, true), row(r1, false), row(r2, true)]);
}

function row(id: typeof r0, rowSelectable: boolean): LevelRow {
  return {
    kind: "data",
    id,
    rowSelectable,
    columns: {},
    hasChildren: false,
    source: { rowKey: rowKeyOfRowId(id), levelName: "rows", columns: {} },
  };
}

describe("row selection helpers", () => {
  it("projects sets in displayed order and filters non-selectable rows", () => {
    const selection = makeRowSetSelection([r2, r1, r0]);

    expect(rowIdsInRowSelection(selection, displayed())).toEqual([r0, r2]);
    expect(rowSelectionContainsRow(selection, r1, displayed())).toBe(false);
  });

  it("normalizes range selections over displayed row-selectable rows", () => {
    const selection = makeRowRangeSelection(r0, r2);

    expect(rowIdsInRowSelection(selection, displayed())).toEqual([r0, r2]);
    expect(normalizeRowSelection(selection, displayed(), "single")).toEqual({
      kind: "single",
      rowId: r0,
    });
  });

  it("does not store empty row sets", () => {
    expect(makeRowSetSelection([])).toBe(null);
    expect(
      normalizeRowSelection(makeRowSetSelection([r1]), displayed(), "multi"),
    ).toBe(null);
  });
});
