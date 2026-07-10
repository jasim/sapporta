import { describe, expect, it } from "vitest";
import { makeRowId, rootPath, type GridPath } from "../types/identity";
import {
  planCursorContinuation,
  type CursorContinuationRow,
} from "./cursor-continuation";

const root = rootPath("rows");

function row(
  key: string,
  overrides: Partial<CursorContinuationRow> = {},
): CursorContinuationRow {
  return {
    path: root,
    rowId: makeRowId(root, key),
    survivesRemoval: true,
    cellFocusable: true,
    rowSelectable: true,
    colIds: ["name", "qty"],
    ...overrides,
  };
}

describe("planCursorContinuation", () => {
  it("lands on the next surviving row and preserves the column", () => {
    const rows = [row("a"), row("b", { survivesRemoval: false }), row("c")];

    expect(
      planCursorContinuation({
        mode: "cell-grid",
        rows,
        cellCursor: { path: root, rowId: rows[1].rowId, colId: "qty" },
        rowSelectionLead: null,
        fallbackPath: root,
      }),
    ).toEqual({
      kind: "cell",
      target: { path: root, rowId: rows[2].rowId, colId: "qty" },
    });
  });

  it("skips the complete removed run", () => {
    const rows = [
      row("a"),
      row("b", { survivesRemoval: false }),
      row("c", { survivesRemoval: false }),
      row("d"),
    ];

    expect(
      planCursorContinuation({
        mode: "cell-grid",
        rows,
        cellCursor: { path: root, rowId: rows[1].rowId, colId: "name" },
        rowSelectionLead: null,
        fallbackPath: root,
      }),
    ).toEqual({
      kind: "cell",
      target: { path: root, rowId: rows[3].rowId, colId: "name" },
    });
  });

  it("falls back to the previous surviving row at the end", () => {
    const rows = [row("a"), row("b", { survivesRemoval: false })];

    expect(
      planCursorContinuation({
        mode: "row-list",
        rows,
        rowCursor: { path: root, rowId: rows[1].rowId },
        rowSelectionLead: null,
        fallbackPath: root,
      }),
    ).toEqual({
      kind: "row",
      target: { path: root, rowId: rows[0].rowId },
    });
  });

  it("retains a surviving cursor so the executor can refocus it", () => {
    const rows = [row("a"), row("b", { survivesRemoval: false })];

    expect(
      planCursorContinuation({
        mode: "cell-grid",
        rows,
        cellCursor: { path: root, rowId: rows[0].rowId, colId: "qty" },
        rowSelectionLead: null,
        fallbackPath: root,
      }),
    ).toEqual({
      kind: "cell",
      target: { path: root, rowId: rows[0].rowId, colId: "qty" },
    });
  });

  it("uses the row-selection lead when a structural selector cleared cell focus", () => {
    const rows = [row("a"), row("b", { survivesRemoval: false }), row("c")];

    expect(
      planCursorContinuation({
        mode: "cell-grid",
        rows,
        cellCursor: null,
        rowSelectionLead: { path: root, rowId: rows[1].rowId },
        fallbackPath: root,
      }),
    ).toEqual({
      kind: "cell",
      target: { path: root, rowId: rows[2].rowId, colId: "name" },
    });
  });

  it("skips rows removed with an ancestor and can land in another path", () => {
    const child = "rows.a.lines" as GridPath;
    const rows = [
      row("a", { survivesRemoval: false }),
      row("line-1", {
        path: child,
        rowId: makeRowId(child, "line-1"),
        survivesRemoval: false,
        colIds: ["description"],
      }),
      row("b"),
    ];

    expect(
      planCursorContinuation({
        mode: "cell-grid",
        rows,
        cellCursor: {
          path: child,
          rowId: rows[1].rowId,
          colId: "description",
        },
        rowSelectionLead: null,
        fallbackPath: root,
      }),
    ).toEqual({
      kind: "cell",
      target: { path: root, rowId: rows[2].rowId, colId: "name" },
    });
  });

  it("focuses the grid when no row survives", () => {
    const rows = [row("a", { survivesRemoval: false })];

    expect(
      planCursorContinuation({
        mode: "cell-grid",
        rows,
        cellCursor: { path: root, rowId: rows[0].rowId, colId: "name" },
        rowSelectionLead: null,
        fallbackPath: root,
      }),
    ).toEqual({ kind: "grid", path: root });
  });
});
