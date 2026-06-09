import { describe, expect, it } from "vitest";
import {
  keyEventToCellIntent as parseCellIntent,
  keyEventToRowIntent as parseRowIntent,
} from "./key-handling";
import { capabilitiesFor } from "../types/capabilities";
import {
  CELL_EDITING_GRID,
  ROW_MULTISELECT_LIST,
  ROW_PRIMARY_MASTER_DETAIL,
} from "../types/interaction";
import { rootPath, makeRowId } from "../types/identity";
import type { ControllerState } from "../types/controller-state";
import type { ColumnSchema } from "../types/schema";
import type { DisplayedRows, LevelRow } from "../types/level-row";
import { buildDisplayed } from "../pipeline/stages/build-displayed";

const path = rootPath("rows");
const TestEditor = () => null;
const testColumn = (id: string, name: string): ColumnSchema => ({
  id,
  name,
  renderCell: ({ value }) => String(value ?? ""),
  editCell: TestEditor,
});
const cols: ColumnSchema[] = [
  testColumn("a", "A"),
  testColumn("b", "B"),
  testColumn("c", "C"),
];

function makeRows(
  specs: Array<{ key: string; kind: LevelRow["kind"] }>,
): DisplayedRows {
  const rows = specs.map((s) => {
    const id = makeRowId(path, s.key);
    if (s.kind === "data") {
      return {
        kind: "data",
        id,
        rowSelectable: true,
        columns: {},
        hasChildren: false,
        source: {} as never,
      };
    }
    if (s.kind === "footer") {
      return { kind: "footer", id, columns: {}, source: {} as never };
    }
    if (s.kind === "rollup")
      return { kind: "rollup", id, columns: {}, source: {} as never };
    return { kind: s.kind, id, columns: {}, source: {} as never };
  }) as LevelRow[];
  return buildDisplayed(rows);
}

const baseState: ControllerState = {
  liveCellFocus: null,
  cellSelection: null,
  editing: null,
  liveRowFocus: null,
  rowSelection: null,
};

function focusAt(rowKey: string, colId: string): ControllerState {
  const c = { rowId: makeRowId(path, rowKey), colId };
  return {
    liveCellFocus: c,
    cellSelection: { anchor: c, head: c },
    editing: null,
    liveRowFocus: null,
    rowSelection: null,
  };
}

function keyEventToCellIntent(
  e: KeyboardEvent,
  state: ControllerState,
  displayed: DisplayedRows,
  schema: ColumnSchema[],
  caps: typeof capabilitiesFor,
) {
  return parseCellIntent(e, CELL_EDITING_GRID, state, displayed, schema, caps);
}

function keyEventToRowIntent(e: KeyboardEvent, state: ControllerState) {
  return parseRowIntent(
    e,
    ROW_PRIMARY_MASTER_DETAIL,
    state,
    makeRows([{ key: "r0", kind: "data" }]),
  );
}

function ev(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  } as unknown as KeyboardEvent;
}

describe("keyEventToCellIntent", () => {
  const displayed = makeRows([
    { key: "r0", kind: "data" },
    { key: "r1", kind: "data" },
    { key: "r2", kind: "footer" },
  ]);

  it("returns null in edit mode regardless of key", () => {
    const editing: ControllerState = {
      liveCellFocus: { rowId: makeRowId(path, "r0"), colId: "a" },
      cellSelection: {
        anchor: { rowId: makeRowId(path, "r0"), colId: "a" },
        head: { rowId: makeRowId(path, "r0"), colId: "a" },
      },
      editing: {
        coord: { rowId: makeRowId(path, "r0"), colId: "a" },
        trigger: "f2",
      },
      liveRowFocus: null,
      rowSelection: null,
    };
    expect(
      keyEventToCellIntent(
        ev("ArrowDown"),
        editing,
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toBe(null);
    expect(
      keyEventToCellIntent(ev("Escape"), editing, displayed, cols, capabilitiesFor),
    ).toBe(null);
  });

  it("emits focusFirstCell when there is no live focus and an arrow is pressed", () => {
    const r = keyEventToCellIntent(
      ev("ArrowDown"),
      baseState,
      displayed,
      cols,
      capabilitiesFor,
    );
    expect(r).toEqual({ type: "focusFirstCell" });
  });

  it("ignores edit-trigger keys when there is no live focus", () => {
    expect(
      keyEventToCellIntent(ev("F2"), baseState, displayed, cols, capabilitiesFor),
    ).toBe(null);
    expect(
      keyEventToCellIntent(ev("a"), baseState, displayed, cols, capabilitiesFor),
    ).toBe(null);
  });

  it("Escape clears selection when one exists", () => {
    expect(
      keyEventToCellIntent(
        ev("Escape"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "clearCellSelection" });
  });

  it("ArrowDown emits a moveRow intent", () => {
    const r = keyEventToCellIntent(
      ev("ArrowDown"),
      focusAt("r0", "a"),
      displayed,
      cols,
      capabilitiesFor,
    );
    expect(r).toEqual({
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
  });

  it("uses the configured cards arrow policy for visual field order", () => {
    expect(
      parseCellIntent(
        ev("ArrowDown"),
        CELL_EDITING_GRID,
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
        "cards",
      ),
    ).toEqual({ type: "commitMove", target: "next" });
    expect(
      parseCellIntent(
        ev("ArrowUp"),
        CELL_EDITING_GRID,
        focusAt("r0", "b"),
        displayed,
        cols,
        capabilitiesFor,
        "cards",
      ),
    ).toEqual({ type: "commitMove", target: "prev" });
  });

  it("uses the configured cards arrow policy for left and right fields", () => {
    expect(
      parseCellIntent(
        ev("ArrowRight"),
        CELL_EDITING_GRID,
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
        "cards",
      ),
    ).toEqual({ type: "commitMove", target: "next" });
    expect(
      parseCellIntent(
        ev("ArrowLeft"),
        CELL_EDITING_GRID,
        focusAt("r0", "b"),
        displayed,
        cols,
        capabilitiesFor,
        "cards",
      ),
    ).toEqual({ type: "commitMove", target: "prev" });
  });

  it("Shift+ArrowDown sets extend on moveRow", () => {
    const r = keyEventToCellIntent(
      ev("ArrowDown", { shiftKey: true }),
      focusAt("r0", "a"),
      displayed,
      cols,
      capabilitiesFor,
    );
    expect(r).toEqual({
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: true,
    });
  });

  it("Tab emits target movement for coordinator resolution", () => {
    expect(
      keyEventToCellIntent(
        ev("Tab"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "commitMove", target: "next" });
    expect(
      keyEventToCellIntent(
        ev("Tab", { shiftKey: true }),
        focusAt("r0", "b"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "commitMove", target: "prev" });
  });

  it("F2 opens an edit on a data cell", () => {
    expect(
      keyEventToCellIntent(
        ev("F2"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "startEdit", trigger: "f2" });
  });

  it("Enter opens an edit", () => {
    expect(
      keyEventToCellIntent(
        ev("Enter"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "startEdit", trigger: "enter" });
  });

  it("printable key opens a 'type' edit and forwards the keystroke", () => {
    expect(
      keyEventToCellIntent(
        ev("z"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "startEdit", trigger: "type", initial: "z" });
  });

  it("does not open a 'type' edit on Ctrl+letter", () => {
    expect(
      keyEventToCellIntent(
        ev("z", { ctrlKey: true }),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toBe(null);
  });

  it("respects column.editTriggers — opt out of 'type'", () => {
    const restricted: ColumnSchema[] = [
      { ...testColumn("a", "A"), editTriggers: ["click", "f2", "enter"] },
      testColumn("b", "B"),
      testColumn("c", "C"),
    ];
    expect(
      keyEventToCellIntent(
        ev("z"),
        focusAt("r0", "a"),
        displayed,
        restricted,
        capabilitiesFor,
      ),
    ).toBe(null);
    expect(
      keyEventToCellIntent(
        ev("F2"),
        focusAt("r0", "a"),
        displayed,
        restricted,
        capabilitiesFor,
      ),
    ).toEqual({ type: "startEdit", trigger: "f2" });
  });

  it("does not treat editTriggers as editability without an editor", () => {
    const noEditor: ColumnSchema[] = [
      {
        id: "a",
        name: "A",
        renderCell: ({ value }) => String(value ?? ""),
        editTriggers: ["f2", "enter", "type"],
      },
    ];

    expect(
      keyEventToCellIntent(
        ev("F2"),
        focusAt("r0", "a"),
        displayed,
        noEditor,
        capabilitiesFor,
      ),
    ).toBe(null);
  });

  it("does not open an edit on a non-editable row (e.g. opening)", () => {
    const d = makeRows([
      { key: "open", kind: "opening" },
      { key: "r1", kind: "data" },
    ]);
    expect(
      keyEventToCellIntent(
        ev("F2"),
        focusAt("open", "a"),
        d,
        cols,
        capabilitiesFor,
      ),
    ).toBe(null);
    expect(
      keyEventToCellIntent(ev("z"), focusAt("open", "a"), d, cols, capabilitiesFor),
    ).toBe(null);
  });

  it("Ctrl+Home is moveGridEdge 'first'", () => {
    const r = keyEventToCellIntent(
      ev("Home", { ctrlKey: true }),
      focusAt("r1", "c"),
      displayed,
      cols,
      capabilitiesFor,
    );
    expect(r).toEqual({
      type: "moveGridEdge",
      edge: "first",
      colPolicy: "preserve",
      extend: false,
    });
  });

  it("Ctrl+End is moveGridEdge 'last'", () => {
    const r = keyEventToCellIntent(
      ev("End", { ctrlKey: true }),
      focusAt("r0", "a"),
      displayed,
      cols,
      capabilitiesFor,
    );
    expect(r).toEqual({
      type: "moveGridEdge",
      edge: "last",
      colPolicy: "preserve",
      extend: false,
    });
  });

  it("PageDown is moveRowDelta with positive delta", () => {
    expect(
      keyEventToCellIntent(
        ev("PageDown"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({
      type: "moveRowDelta",
      delta: 10,
      colPolicy: "preserve",
      extend: false,
    });
  });

  it("PageUp is moveRowDelta with negative delta", () => {
    expect(
      keyEventToCellIntent(
        ev("PageUp"),
        focusAt("r1", "b"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({
      type: "moveRowDelta",
      delta: -10,
      colPolicy: "preserve",
      extend: false,
    });
  });
});

describe("keyEventToRowIntent", () => {
  const rowFocused: ControllerState = {
    liveCellFocus: null,
    cellSelection: null,
    editing: null,
    liveRowFocus: makeRowId(path, "r0"),
    rowSelection: null,
  };

  it("maps right and left arrows to active-row expansion intents", () => {
    expect(keyEventToRowIntent(ev("ArrowRight"), rowFocused)).toEqual({
      type: "expandActiveRow",
    });
    expect(keyEventToRowIntent(ev("ArrowLeft"), rowFocused)).toEqual({
      type: "collapseActiveRow",
    });
  });

  it("maps Enter to active-row expansion toggle", () => {
    expect(keyEventToRowIntent(ev("Enter"), rowFocused)).toEqual({
      type: "toggleActiveRowExpansion",
    });
  });

  it("ignores expansion keys when row expansion is not configured", () => {
    expect(
      parseRowIntent(
        ev("ArrowRight"),
        ROW_MULTISELECT_LIST,
        rowFocused,
        makeRows([{ key: "r0", kind: "data" }]),
      ),
    ).toBe(null);
    expect(
      parseRowIntent(
        ev("Enter"),
        ROW_MULTISELECT_LIST,
        rowFocused,
        makeRows([{ key: "r0", kind: "data" }]),
      ),
    ).toBe(null);
  });
});
