import { describe, expect, it, vi } from "vitest";
import { createGridController } from "./controller";
import { capabilitiesFor } from "../types/capabilities";
import { CELL_EDITING_GRID } from "../types/interaction";
import { makeLevelRowId, makeRowId, rootPath } from "../types/identity";
import type { CellNavigationIntent } from "../types/action";
import type { Coord, GridPath } from "../types/identity";
import type { ColumnSchema } from "../types/schema";
import type { DisplayedRows, LevelRow } from "../types/level-row";
import { buildDisplayed } from "../pipeline/stages/build-displayed";

const path = rootPath("rows");
const TestEditor = () => null;
const cols: ColumnSchema[] = [
  {
    id: "a",
    name: "A",
    renderCell: ({ value }) => String(value ?? ""),
    edit: {
      editor: TestEditor,
      startsOn: ["enter", "f2", "type", "doubleClick"],
    },
  },
  {
    id: "b",
    name: "B",
    renderCell: ({ value }) => String(value ?? ""),
    edit: {
      editor: TestEditor,
      startsOn: ["enter", "f2", "type", "doubleClick"],
    },
  },
];

function makeRows(
  specs: Array<{ key: string; kind: LevelRow["kind"] }>,
): DisplayedRows {
  const rows: LevelRow[] = specs.map((s): LevelRow => {
    const id = makeLevelRowId(path, s.kind, s.key);
    const rowSelectable = capabilitiesFor(s.kind).rowSelectable;
    if (s.kind === "data") {
      return {
        kind: "data",
        id,
        rowSelectable,
        columns: {},
        hasChildren: false,
        source: { rowKey: s.key, levelName: "rows", columns: {} },
      };
    }
    if (s.kind === "footer") {
      return {
        kind: "footer",
        id,
        rowSelectable,
        columns: {},
        source: { rowKey: s.key, columns: {} },
      };
    }
    if (s.kind === "phantom") {
      return {
        kind: "phantom",
        id,
        rowSelectable,
        columns: {},
        source: { rowKey: s.key, columns: {}, state: { kind: "editing" } },
      };
    }
    return {
      kind: s.kind,
      id,
      rowSelectable,
      columns: {},
      source: { rowKey: s.key, levelName: "rows", columns: {} },
    };
  });
  return buildDisplayed(rows);
}

const displayed = makeRows([
  { key: "r0", kind: "data" },
  { key: "r1", kind: "data" },
]);

function makeController(
  opts: {
    onNavigate?: (intent: CellNavigationIntent) => void;
    clearCellRange?: (path: GridPath) => void;
    writeValue?: (coord: Coord, newValue: unknown) => void;
  } = {},
) {
  return createGridController({
    path,
    interaction: CELL_EDITING_GRID,
    getDisplayed: () => displayed,
    getSchema: () => cols,
    capabilitiesFor,
    onNavigateCell: opts.onNavigate,
    clearCellRange: opts.clearCellRange,
    writeValue: opts.writeValue,
  });
}

describe("GridController — verbs", () => {
  it("startEdit / cancelEdit toggle the editor without writing selection", () => {
    const c = makeController();
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    expect(c.getState().editing).toEqual({
      coord: { rowId: makeRowId(path, "r0"), colId: "a" },
      editStart: { trigger: "f2" },
    });
    expect(c.getState().cellSelection).toBe(null);
    c.cancelEdit();
    expect(c.getState().editing).toBe(null);
  });

  it("commitEdit closes the editor and forwards the new value to writeValue", () => {
    const writeValue = vi.fn();
    const c = makeController({ writeValue });
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    c.commitEdit("after");
    expect(c.getState().editing).toBe(null);
    expect(writeValue).toHaveBeenCalledWith(
      { rowId: makeRowId(path, "r0"), colId: "a" },
      "after",
    );
  });

  it("commitEdit queues focusContainer when the editor closes", () => {
    const writeValue = vi.fn();
    const c = makeController({ writeValue });
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    c.flushEffects();
    c.commitEdit("v");
    const types = c.effects.getState().map((e) => e.type);
    expect(types).toContain("focusContainer");
  });

  it("commitEdit with commit='next' emits a commit movement intent", () => {
    const onNavigate = vi.fn();
    const c = makeController({ onNavigate });
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    c.commitEdit("x", "next");
    expect(onNavigate).toHaveBeenCalledWith({
      type: "commitMove",
      target: "next",
    });
  });

  it("commitEdit with commit='down' emits a commit movement intent", () => {
    const onNavigate = vi.fn();
    const c = makeController({ onNavigate });
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "enter");
    c.commitEdit("x", "down");
    expect(onNavigate).toHaveBeenCalledWith({
      type: "commitMove",
      target: "down",
    });
  });

  it("flushEffects clears the queue", () => {
    const c = makeController();
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    expect(c.effects.getState().length).toBeGreaterThan(0);
    c.flushEffects();
    expect(c.effects.getState()).toEqual([]);
  });

  it("does not start editing when the target column has no editor", () => {
    const c = createGridController({
      path,
      interaction: CELL_EDITING_GRID,
      getDisplayed: () => displayed,
      getSchema: () => [
        {
          id: "a",
          name: "A",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      capabilitiesFor,
    });

    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");

    expect(c.getState().editing).toBe(null);
  });

  it("does not let direct startEdit bypass edit.startsOn", () => {
    const c = createGridController({
      path,
      interaction: CELL_EDITING_GRID,
      getDisplayed: () => displayed,
      getSchema: () => [
        {
          id: "a",
          name: "A",
          renderCell: ({ value }) => String(value ?? ""),
          edit: { editor: TestEditor, startsOn: ["enter"] },
        },
      ],
      capabilitiesFor,
    });

    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    expect(c.getState().editing).toBe(null);

    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "enter");
    expect(c.getState().editing).toEqual({
      coord: { rowId: makeRowId(path, "r0"), colId: "a" },
      editStart: { trigger: "enter" },
    });
  });
});

describe("GridController — effects channel identity", () => {
  it("preserves array reference across no-op transitions", () => {
    const c = makeController();
    c.startEdit({ rowId: makeRowId(path, "r0"), colId: "a" }, "f2");
    const before = c.effects.getState();
    c.flushEffects();
    const empty = c.effects.getState();
    c.cancelEdit();
    c.flushEffects();
    const empty2 = c.effects.getState();
    c.clearCellSelection();
    expect(c.effects.getState()).toBe(empty2);
    // Sanity: the *first* effect array is distinct from the post-flush one.
    expect(before).not.toBe(empty);
  });
});
