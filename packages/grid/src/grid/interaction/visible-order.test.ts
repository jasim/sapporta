import { describe, expect, it } from "vitest";
import {
  nextColumn,
  resolveRowSelectableNavigation,
  resolveVisibleRowNavigation,
  visibleRows,
  type VisibleCursor,
} from "./visible-order";
import { capabilitiesFor } from "../types/capabilities";
import { createGridRuntime } from "../runtime/create-grid-runtime";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { childPath, makeRowId, rootPath } from "../types/identity";
import type { GridPath, RowId } from "../types/identity";
import type { TreeNode } from "../types/level-row";
import type { LevelRow } from "../types/level-row";
import { buildSchemaTopology } from "../schema";
import type { ColPolicy, RowDirection } from "../types/action";
import type { GridSchema } from "../types/schema";

const testColumn = (id: string, name: string) => ({
  id,
  name,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
});

const reportSchema: GridSchema = {
  rootLevel: "cat",
  levels: {
    cat: {
      name: "cat",
      columns: [testColumn("name", "Name"), testColumn("qty", "Qty")],
      options: { rowKey: (n: TreeNode) => String(n.columns.name) },
      childLevels: ["items"],
    },
    items: {
      name: "items",
      columns: [testColumn("name", "Name"), testColumn("weight", "Weight")],
      options: { rowKey: (n: TreeNode) => String(n.columns.name) },
      childLevels: [],
    },
  },
};

const root = rootPath("cat");
const fruitItems = childPath(root, "Fruit", "items");
const vegItems = childPath(root, "Veg", "items");

const tree: TreeNode[] = [
  {
    levelName: "cat",
    columns: { name: "Fruit", qty: 2 },
    children: {
      items: [
        { levelName: "items", columns: { name: "Apple", weight: 1 } },
        { levelName: "items", columns: { name: "Banana", weight: 2 } },
      ],
    },
  },
  {
    levelName: "cat",
    columns: { name: "Veg", qty: 1 },
    children: {
      items: [{ levelName: "items", columns: { name: "Carrot", weight: 3 } }],
    },
  },
];

function setup({ expand = [] as string[] } = {}) {
  const ds = inMemoryGridDataSource({
    schema: reportSchema,
    tree,
    levels: {
      cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
      items: { sortMode: "none", filterMode: "none", paginationMode: "none" },
    },
  });
  const rt = createGridRuntime({ schema: reportSchema, dataSource: ds });
  for (const name of expand) {
    rt.coordinator.toggleExpand(root, makeRowId(root, name));
  }
  return rt;
}

const deps = { capabilitiesFor };

function cellTarget(
  runtime: GridRuntime,
  coordinator: GridRuntime["coordinator"],
  from: VisibleCursor,
  dir: RowDirection,
  colPolicy: ColPolicy,
  resolveDeps: typeof deps,
): VisibleCursor | null {
  return resolveVisibleRowNavigation(
    runtime,
    coordinator,
    from,
    dir,
    colPolicy,
    resolveDeps,
  ).target;
}

function fakeRuntimeWithRows(rows: LevelRow[]): GridRuntime {
  const rowById = new Map<RowId, LevelRow>();
  const rowIndexById = new Map<RowId, number>();
  rows.forEach((row, index) => {
    rowById.set(row.id, row);
    rowIndexById.set(row.id, index);
  });
  const runtime = {
    schema: reportSchema,
    schemaTopology: buildSchemaTopology(reportSchema),
    coordinator: {
      getState: () => ({
        cellCursor: null,
        rowCursor: null,
        expansion: new Map<GridPath, Set<RowId>>(),
      }),
      getInitialState: () => ({
        cellCursor: null,
        rowCursor: null,
        expansion: new Map<GridPath, Set<RowId>>(),
      }),
      subscribe: () => () => {},
      expand: () => {},
      collapse: () => {},
      toggleExpand: () => {},
      navigateCell: () => {},
      navigateRow: () => {},
    },
    displayedRowsFor: () => ({
      rows,
      rowById,
      rowIndexById,
    }),
    materializedChildren: () => [],
    sourceStateFor: () => ({
      status: "ready",
      snapshot: {
        nodes: [],
      },
    }),
    schemaAt: () => reportSchema.levels.cat,
  };
  return runtime as unknown as GridRuntime;
}

function dataRow(rowKey: string): LevelRow {
  return {
    kind: "data",
    id: makeRowId(root, rowKey),
    rowSelectable: true,
    columns: { name: rowKey },
    hasChildren: false,
    source: { levelName: "cat", columns: { name: rowKey } },
  };
}

function footerRow(rowKey: string): LevelRow {
  return {
    kind: "footer",
    id: makeRowId(root, rowKey),
    rowSelectable: false,
    columns: { name: rowKey },
    source: { rowKey, columns: { name: rowKey } },
  };
}

describe("visibleRows", () => {
  it("yields only the parent rows when nothing is expanded", () => {
    const rt = setup();
    const seq = Array.from(visibleRows(rt, rt.coordinator, root));
    expect(seq.map((s) => s.rowId)).toEqual([
      makeRowId(root, "Fruit"),
      makeRowId(root, "Veg"),
    ]);
  });

  it("interleaves children between their owning parent rows", () => {
    const rt = setup({ expand: ["Fruit", "Veg"] });
    const seq = Array.from(visibleRows(rt, rt.coordinator, root));
    expect(seq).toEqual([
      { path: root, rowId: makeRowId(root, "Fruit") },
      { path: fruitItems, rowId: makeRowId(fruitItems, "Apple") },
      { path: fruitItems, rowId: makeRowId(fruitItems, "Banana") },
      { path: root, rowId: makeRowId(root, "Veg") },
      { path: vegItems, rowId: makeRowId(vegItems, "Carrot") },
    ]);
  });

  it("follows display order, not expansion order", () => {
    // Expand Veg first, then Fruit — visible sequence still places
    // Fruit's children before Veg's because display order leads.
    const rt = setup({ expand: ["Veg", "Fruit"] });
    const seq = Array.from(visibleRows(rt, rt.coordinator, root));
    expect(seq.map((s) => s.rowId)).toEqual([
      makeRowId(root, "Fruit"),
      makeRowId(fruitItems, "Apple"),
      makeRowId(fruitItems, "Banana"),
      makeRowId(root, "Veg"),
      makeRowId(vegItems, "Carrot"),
    ]);
  });

  it("collapses descendants immediately when a row is collapsed", () => {
    const rt = setup({ expand: ["Fruit"] });
    rt.coordinator.toggleExpand(root, makeRowId(root, "Fruit")); // collapse
    const seq = Array.from(visibleRows(rt, rt.coordinator, root));
    expect(seq.map((s) => s.rowId)).toEqual([
      makeRowId(root, "Fruit"),
      makeRowId(root, "Veg"),
    ]);
  });
});

describe("resolveVisibleRowNavigation", () => {
  it("ArrowDown from a parent row enters its expanded child", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "down",
      "preserve",
      deps,
    );
    expect(next).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
  });

  it("ArrowDown from last child row crosses to the parent's next row", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "down",
      "preserve",
      deps,
    );
    expect(next).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("ArrowUp from a parent row drills into the previous expanded child", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "up",
      "preserve",
      deps,
    );
    expect(next).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    });
  });

  it("first lands on the very first focusable row", () => {
    const rt = setup({ expand: ["Veg"] });
    const from: VisibleCursor = {
      path: vegItems,
      rowId: makeRowId(vegItems, "Carrot"),
      colId: "name",
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "first",
      "preserve",
      deps,
    );
    expect(next).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
  });

  it("last lands on the deepest visible focusable row", () => {
    const rt = setup({ expand: ["Fruit", "Veg"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "last",
      "preserve",
      deps,
    );
    expect(next).toEqual({
      path: vegItems,
      rowId: makeRowId(vegItems, "Carrot"),
      colId: "name",
    });
  });

  it("colPolicy 'preserve' carries the source colId when the target schema has it", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name", // both root and items declare 'name'
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "down",
      "preserve",
      deps,
    );
    expect(next?.colId).toBe("name");
  });

  it("colPolicy 'preserve' falls back to the target's first column when the schema differs", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "qty", // items has no 'qty' column
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "down",
      "preserve",
      deps,
    );
    expect(next?.colId).toBe("name");
  });

  it("colPolicy 'first' always lands on the target's first column, ignoring the source", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "qty", // schema differs but 'first' policy applies regardless
    };
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      "down",
      "first",
      deps,
    );
    expect(next?.colId).toBe("name");

    // Even when the source colId IS valid on the target, "first" overrides.
    const from2: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    };
    const next2 = cellTarget(
      rt,
      rt.coordinator,
      from2,
      "down",
      "first",
      deps,
    );
    expect(next2?.colId).toBe("name"); // happens to match because items.first === 'name'
  });

  it("returns null when the move would land on the same step", () => {
    const rt = setup();
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    };
    expect(
      cellTarget(rt, rt.coordinator, from, "down", "preserve", deps),
    ).toBeNull();
  });

  it("delta jump moves across cross-level visible sequence", () => {
    const rt = setup({ expand: ["Fruit", "Veg"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    };
    // Sequence: Fruit, Apple, Banana, Veg, Carrot — delta +3 from Fruit lands on Veg.
    const next = cellTarget(
      rt,
      rt.coordinator,
      from,
      { delta: 3 },
      "preserve",
      deps,
    );
    expect(next).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("ArrowDown overflows next when a footer follows the last focusable row", () => {
    const rt = fakeRuntimeWithRows([
      dataRow("Fruit"),
      footerRow("total"),
    ]);

    const result = resolveVisibleRowNavigation(
      rt,
      rt.coordinator,
      { path: root, rowId: makeRowId(root, "Fruit"), colId: "name" },
      "down",
      "preserve",
      deps,
    );

    expect(result).toEqual({ target: null, overflow: "next" });
  });

  it("ArrowUp overflows previous when a footer precedes the first focusable row", () => {
    const rt = fakeRuntimeWithRows([
      footerRow("opening-total"),
      dataRow("Fruit"),
    ]);

    const result = resolveVisibleRowNavigation(
      rt,
      rt.coordinator,
      { path: root, rowId: makeRowId(root, "Fruit"), colId: "name" },
      "up",
      "preserve",
      deps,
    );

    expect(result).toEqual({ target: null, overflow: "previous" });
  });

  it("PageDown clamps to the last focusable row before next overflow", () => {
    const rt = fakeRuntimeWithRows([
      dataRow("Fruit"),
      dataRow("Apple"),
      dataRow("Banana"),
      footerRow("total"),
    ]);

    expect(
      resolveVisibleRowNavigation(
        rt,
        rt.coordinator,
        { path: root, rowId: makeRowId(root, "Fruit"), colId: "name" },
        { delta: 10 },
        "preserve",
        deps,
      ),
    ).toEqual({
      target: {
        path: root,
        rowId: makeRowId(root, "Banana"),
        colId: "name",
      },
      overflow: null,
    });

    expect(
      resolveVisibleRowNavigation(
        rt,
        rt.coordinator,
        { path: root, rowId: makeRowId(root, "Banana"), colId: "name" },
        { delta: 10 },
        "preserve",
        deps,
      ),
    ).toEqual({ target: null, overflow: "next" });
  });

  it("PageUp clamps to the first focusable row before previous overflow", () => {
    const rt = fakeRuntimeWithRows([
      footerRow("opening-total"),
      dataRow("Fruit"),
      dataRow("Apple"),
      dataRow("Banana"),
    ]);

    expect(
      resolveVisibleRowNavigation(
        rt,
        rt.coordinator,
        { path: root, rowId: makeRowId(root, "Banana"), colId: "name" },
        { delta: -10 },
        "preserve",
        deps,
      ),
    ).toEqual({
      target: {
        path: root,
        rowId: makeRowId(root, "Fruit"),
        colId: "name",
      },
      overflow: null,
    });

    expect(
      resolveVisibleRowNavigation(
        rt,
        rt.coordinator,
        { path: root, rowId: makeRowId(root, "Fruit"), colId: "name" },
        { delta: -10 },
        "preserve",
        deps,
      ),
    ).toEqual({ target: null, overflow: "previous" });
  });

  it("PageDown overflows next from the last focusable row before a footer", () => {
    const rt = fakeRuntimeWithRows([
      dataRow("Fruit"),
      footerRow("total"),
    ]);

    const result = resolveVisibleRowNavigation(
      rt,
      rt.coordinator,
      { path: root, rowId: makeRowId(root, "Fruit"), colId: "name" },
      { delta: 1 },
      "preserve",
      deps,
    );

    expect(result).toEqual({ target: null, overflow: "next" });
  });

  it("PageUp overflows previous from the first focusable row after a footer", () => {
    const rt = fakeRuntimeWithRows([
      footerRow("opening-total"),
      dataRow("Fruit"),
    ]);

    const result = resolveVisibleRowNavigation(
      rt,
      rt.coordinator,
      { path: root, rowId: makeRowId(root, "Fruit"), colId: "name" },
      { delta: -1 },
      "preserve",
      deps,
    );

    expect(result).toEqual({ target: null, overflow: "previous" });
  });
});

describe("resolveRowSelectableNavigation", () => {
  it("ArrowDown overflows next when a non-row-selectable row follows the last selectable row", () => {
    const rt = fakeRuntimeWithRows([
      dataRow("Fruit"),
      footerRow("total"),
    ]);

    const result = resolveRowSelectableNavigation(
      rt,
      rt.coordinator,
      { path: root, rowId: makeRowId(root, "Fruit") },
      "down",
    );

    expect(result).toEqual({ target: null, overflow: "next" });
  });

  it("ArrowUp overflows previous when a non-row-selectable row precedes the first selectable row", () => {
    const rt = fakeRuntimeWithRows([
      footerRow("opening-total"),
      dataRow("Fruit"),
    ]);

    const result = resolveRowSelectableNavigation(
      rt,
      rt.coordinator,
      { path: root, rowId: makeRowId(root, "Fruit") },
      "up",
    );

    expect(result).toEqual({ target: null, overflow: "previous" });
  });

  it("PageDown and PageUp clamp to row-selectable edges before overflow", () => {
    const afterClamp = fakeRuntimeWithRows([
      dataRow("Fruit"),
      dataRow("Apple"),
      dataRow("Banana"),
      footerRow("total"),
    ]);
    const beforeClamp = fakeRuntimeWithRows([
      footerRow("opening-total"),
      dataRow("Fruit"),
      dataRow("Apple"),
      dataRow("Banana"),
    ]);
    const after = fakeRuntimeWithRows([
      dataRow("Fruit"),
      footerRow("total"),
    ]);
    const before = fakeRuntimeWithRows([
      footerRow("opening-total"),
      dataRow("Fruit"),
    ]);

    expect(
      resolveRowSelectableNavigation(
        afterClamp,
        afterClamp.coordinator,
        { path: root, rowId: makeRowId(root, "Fruit") },
        { delta: 10 },
      ),
    ).toEqual({
      target: { path: root, rowId: makeRowId(root, "Banana") },
      overflow: null,
    });
    expect(
      resolveRowSelectableNavigation(
        beforeClamp,
        beforeClamp.coordinator,
        { path: root, rowId: makeRowId(root, "Banana") },
        { delta: -10 },
      ),
    ).toEqual({
      target: { path: root, rowId: makeRowId(root, "Fruit") },
      overflow: null,
    });
    expect(
      resolveRowSelectableNavigation(
        after,
        after.coordinator,
        { path: root, rowId: makeRowId(root, "Fruit") },
        { delta: 1 },
      ),
    ).toEqual({ target: null, overflow: "next" });
    expect(
      resolveRowSelectableNavigation(
        before,
        before.coordinator,
        { path: root, rowId: makeRowId(root, "Fruit") },
        { delta: -1 },
      ),
    ).toEqual({ target: null, overflow: "previous" });
  });
});

describe("nextColumn", () => {
  const schema = reportSchema.levels.cat;

  it("right advances within the schema", () => {
    expect(nextColumn(schema, "name", "right")).toBe("qty");
  });

  it("right at the last column returns null (overflow)", () => {
    expect(nextColumn(schema, "qty", "right")).toBeNull();
  });

  it("left at the first column returns null", () => {
    expect(nextColumn(schema, "name", "left")).toBeNull();
  });

  it("start and end jump to the schema's edges", () => {
    expect(nextColumn(schema, "qty", "start")).toBe("name");
    expect(nextColumn(schema, "name", "end")).toBe("qty");
  });
});
