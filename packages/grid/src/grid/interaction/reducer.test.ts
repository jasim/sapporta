import { describe, expect, it } from "vitest";
import { reduceController } from "./reducer";
import { capabilitiesFor } from "../types/capabilities";
import { rootPath, makeRowId } from "../types/identity";
import type { GridAction } from "../types/action";
import type { ColumnSchema } from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRow } from "../types/level-row";
import { buildDisplayed } from "../pipeline/stages/build-displayed";

const path = rootPath("rows");
const rowId = makeRowId(path, "r0");
const TestEditor = () => null;

const columns: ColumnSchema[] = [
  {
    id: "a",
    name: "A",
    renderCell: ({ value }) => String(value ?? ""),
    edit: {
      editor: TestEditor,
      startsOn: ["enter", "type", "doubleClick"],
    },
  },
];

const displayed: DisplayedRows = buildDisplayed([
  {
    kind: "data",
    id: rowId,
    rowSelectable: true,
    columns: {},
    hasChildren: false,
    source: { rowKey: "r0", levelName: "rows", columns: {} },
  } satisfies LevelRow,
]);

const state: ControllerState = {
  liveCellFocus: null,
  cellSelection: null,
  editing: null,
  liveRowFocus: null,
  rowSelection: null,
};

function start(action: GridAction) {
  return reduceController(state, action, {
    displayed,
    schema: columns,
    isCellEditable: (row, column) =>
      capabilitiesFor(row.kind).editable && column.edit !== undefined,
  })?.state.editing;
}

describe("reduceController START_EDIT", () => {
  it("stores a typed seed for type-started edits", () => {
    expect(
      start({
        type: "START_EDIT",
        coord: { rowId, colId: "a" },
        trigger: "type",
        initial: "x",
      }),
    ).toEqual({
      coord: { rowId, colId: "a" },
      editStart: {
        trigger: "type",
        typedSeed: "x",
      },
    });
  });

  it("stores no typed seed for double-click-started edits", () => {
    expect(
      start({
        type: "START_EDIT",
        coord: { rowId, colId: "a" },
        trigger: "doubleClick",
      }),
    ).toEqual({
      coord: { rowId, colId: "a" },
      editStart: { trigger: "doubleClick" },
    });
  });

  it("stores no typed seed for enter-started edits", () => {
    expect(
      start({
        type: "START_EDIT",
        coord: { rowId, colId: "a" },
        trigger: "enter",
      }),
    ).toEqual({
      coord: { rowId, colId: "a" },
      editStart: { trigger: "enter" },
    });
  });
});
