// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeRowId, rootPath, type ColId } from "../../types/identity";
import {
  cellCursorFromEventTarget,
  eventBelongsToGridRoot,
  findGridCellElement,
  findGridRowElement,
  gridCellIdentityAttrs,
  gridRootIdentityAttrs,
  gridRowIdentityAttrs,
} from "./dom-targets";

describe("grid DOM targets", () => {
  it("finds rows and cells with escaped identifiers", () => {
    const { root, row, cell, rowId, colId } = renderGridCell({
      rowKey: 'r.1#quote"',
      colId: 'total "] amount',
    });

    expect(findGridRowElement(root, rowId)).toBe(row);
    expect(findGridCellElement(root, { rowId, colId })).toBe(cell);
  });

  it("returns the actual cell when card wrappers also carry data-col-id", () => {
    const { root, cell, rowId, colId } = renderGridCell({
      colId: "name",
      cardField: true,
    });

    const found = findGridCellElement(root, { rowId, colId });

    expect(found).toBe(cell);
    expect(found?.getAttribute("data-grid-part")).toBe("cell");
  });

  it("parses nested cell content into a CellCursor", () => {
    const { path, rowId, colId, content } = renderGridCell({
      rowKey: "a.1",
      colId: "note",
    });
    const text = document.createTextNode("nested value");
    content.append(text);

    expect(cellCursorFromEventTarget(text)).toEqual({ path, rowId, colId });
  });

  it("ignores headers, status bands, and empty areas", () => {
    const path = rootPath("quotes");
    const root = document.createElement("div");
    applyAttrs(root, gridRootIdentityAttrs(path));

    const header = document.createElement("div");
    header.setAttribute("data-grid-part", "header-cell");
    header.setAttribute("data-col-id", "note");

    const status = document.createElement("div");
    status.setAttribute("data-grid-part", "level-status");
    status.setAttribute("data-grid-path", path);

    const empty = document.createElement("div");
    empty.setAttribute("data-grid-part", "level-empty");
    empty.setAttribute("data-grid-path", path);

    root.append(header, status, empty);

    expect(cellCursorFromEventTarget(header)).toBeNull();
    expect(cellCursorFromEventTarget(status)).toBeNull();
    expect(cellCursorFromEventTarget(empty)).toBeNull();
  });

  it("matches only the innermost grid root for event routing", () => {
    const parent = document.createElement("div");
    applyAttrs(parent, gridRootIdentityAttrs(rootPath("parent")));
    const child = document.createElement("div");
    applyAttrs(child, gridRootIdentityAttrs(rootPath("child")));
    const button = document.createElement("button");
    child.append(button);
    parent.append(child);

    expect(eventBelongsToGridRoot(button, child)).toBe(true);
    expect(eventBelongsToGridRoot(button, parent)).toBe(false);
  });
});

function renderGridCell({
  rowKey = "r1",
  colId,
  cardField = false,
}: {
  rowKey?: string;
  colId: ColId;
  cardField?: boolean;
}) {
  const path = rootPath("quotes");
  const rowId = makeRowId(path, rowKey);
  const root = document.createElement("div");
  applyAttrs(root, gridRootIdentityAttrs(path));

  const row = document.createElement("div");
  applyAttrs(row, gridRowIdentityAttrs(rowId));

  const cell = document.createElement("div");
  applyAttrs(cell, gridCellIdentityAttrs(colId));

  const content = document.createElement("span");
  content.setAttribute("data-grid-part", "cell-content");
  cell.append(content);

  if (cardField) {
    const rowField = document.createElement("div");
    rowField.setAttribute("data-grid-part", "row-field");
    rowField.setAttribute("data-col-id", colId);
    rowField.append(cell);
    row.append(rowField);
  } else {
    row.append(cell);
  }
  root.append(row);

  return { root, row, cell, content, path, rowId, colId };
}

function applyAttrs(element: HTMLElement, attrs: Record<string, string>): void {
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
}
