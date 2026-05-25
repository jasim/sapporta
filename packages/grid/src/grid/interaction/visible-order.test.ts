import { describe, expect, it } from "vitest";
import {
  nextColumn,
  nextVisibleRow,
  visibleRows,
  type VisibleCursor,
} from "./visible-order";
import { capabilitiesFor } from "../types/capabilities";
import { createGridRuntime } from "../runtime/create-grid-runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { childPath, makeRowId, rootPath } from "../types/identity";
import type { TreeNode } from "../types/level-row";
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

describe("nextVisibleRow", () => {
  it("ArrowDown from a parent row enters its expanded child", () => {
    const rt = setup({ expand: ["Fruit"] });
    const from: VisibleCursor = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    };
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next = nextVisibleRow(
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
    const next2 = nextVisibleRow(
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
      nextVisibleRow(rt, rt.coordinator, from, "down", "preserve", deps),
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
    const next = nextVisibleRow(
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
