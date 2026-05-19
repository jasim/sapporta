import { describe, expect, it } from "vitest";
import { keyEventToIntent } from "./key-handling";
import { capabilitiesFor } from "../types/capabilities";
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
  liveFocus: null,
  selection: null,
  editing: null,
};

function focusAt(rowKey: string, colId: string): ControllerState {
  const c = { rowId: makeRowId(path, rowKey), colId };
  return {
    liveFocus: c,
    selection: { anchor: c, head: c },
    editing: null,
  };
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

describe("keyEventToIntent", () => {
  const displayed = makeRows([
    { key: "r0", kind: "data" },
    { key: "r1", kind: "data" },
    { key: "r2", kind: "footer" },
  ]);

  it("returns null in edit mode regardless of key", () => {
    const editing: ControllerState = {
      liveFocus: { rowId: makeRowId(path, "r0"), colId: "a" },
      selection: {
        anchor: { rowId: makeRowId(path, "r0"), colId: "a" },
        head: { rowId: makeRowId(path, "r0"), colId: "a" },
      },
      editing: {
        coord: { rowId: makeRowId(path, "r0"), colId: "a" },
        trigger: "f2",
      },
    };
    expect(
      keyEventToIntent(
        ev("ArrowDown"),
        editing,
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toBe(null);
    expect(
      keyEventToIntent(ev("Escape"), editing, displayed, cols, capabilitiesFor),
    ).toBe(null);
  });

  it("emits focusFirst when there is no live focus and an arrow is pressed", () => {
    const r = keyEventToIntent(
      ev("ArrowDown"),
      baseState,
      displayed,
      cols,
      capabilitiesFor,
    );
    expect(r).toEqual({ type: "focusFirst" });
  });

  it("ignores edit-trigger keys when there is no live focus", () => {
    expect(
      keyEventToIntent(ev("F2"), baseState, displayed, cols, capabilitiesFor),
    ).toBe(null);
    expect(
      keyEventToIntent(ev("a"), baseState, displayed, cols, capabilitiesFor),
    ).toBe(null);
  });

  it("Escape clears selection when one exists", () => {
    expect(
      keyEventToIntent(
        ev("Escape"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "clearSelection" });
  });

  it("ArrowDown emits a moveRow intent", () => {
    const r = keyEventToIntent(
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

  it("Shift+ArrowDown sets extend on moveRow", () => {
    const r = keyEventToIntent(
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
      keyEventToIntent(
        ev("Tab"),
        focusAt("r0", "a"),
        displayed,
        cols,
        capabilitiesFor,
      ),
    ).toEqual({ type: "commitMove", target: "next" });
    expect(
      keyEventToIntent(
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
      keyEventToIntent(
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
      keyEventToIntent(
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
      keyEventToIntent(
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
      keyEventToIntent(
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
      keyEventToIntent(
        ev("z"),
        focusAt("r0", "a"),
        displayed,
        restricted,
        capabilitiesFor,
      ),
    ).toBe(null);
    expect(
      keyEventToIntent(
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
      keyEventToIntent(
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
      keyEventToIntent(
        ev("F2"),
        focusAt("open", "a"),
        d,
        cols,
        capabilitiesFor,
      ),
    ).toBe(null);
    expect(
      keyEventToIntent(ev("z"), focusAt("open", "a"), d, cols, capabilitiesFor),
    ).toBe(null);
  });

  it("Ctrl+Home is moveGridEdge 'first'", () => {
    const r = keyEventToIntent(
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
    const r = keyEventToIntent(
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
      keyEventToIntent(
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
      keyEventToIntent(
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
