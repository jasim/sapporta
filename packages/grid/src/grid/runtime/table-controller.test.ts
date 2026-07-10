import { describe, expect, it } from "vitest";
import { createGridRuntime } from "./create-grid-runtime";
import { createTableController } from "./table-controller";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { inMemoryReadonlyLevelSource } from "../data-sources/memory/in-memory-level-source";
import { rootPath, makeRowId } from "../types/identity";
import type { PhantomRow, TreeNode } from "../types/level-row";
import type { ColumnSchema, GridSchema } from "../types/schema";
import type { GridDataSource } from "../data-sources/types";
import type { RowPredicate } from "../pipeline/types";

type TestFilter = Record<string, (value: unknown) => boolean>;

function phantom(
  rowKey: string,
  columns: Record<string, unknown> = {},
): PhantomRow {
  return { rowKey, columns, state: { kind: "editing" } };
}

const compileTestFilter = (
  filter: TestFilter | undefined,
): RowPredicate | undefined => {
  if (!filter) return undefined;
  const keys = Object.keys(filter);
  if (keys.length === 0) return undefined;
  return (cols) => keys.every((k) => filter[k](cols[k]));
};

const cols: ColumnSchema[] = [
  {
    id: "id",
    name: "ID",
    renderCell: ({ value }) => String(value ?? ""),
  },
  {
    id: "qty",
    name: "Qty",
    renderCell: ({ value }) => String(value ?? ""),
    compare: (a, b) => (Number(a) || 0) - (Number(b) || 0),
  },
];

const schema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      rowHeaderColumn: "none",
      columns: cols,
      options: {
        rowKey: (n: TreeNode) => String(n.columns.id),
        allowPhantoms: true,
      },
      childLevels: [],
    },
  },
};

function makeRows(): TreeNode[] {
  return Array.from({ length: 25 }, (_, i) => ({
    levelName: "rows",
    columns: { id: `r${i}`, qty: i },
  }));
}

function buildRuntime(opts?: {
  sortMode?: "client" | "none";
  filterMode?: "client" | "none";
  paginationMode?: "client" | "none";
}) {
  const dataSource = inMemoryGridDataSource<TestFilter>({
    schema,
    tree: makeRows(),
    levels: {
      rows: {
        sortMode: opts?.sortMode ?? "client",
        filterMode: opts?.filterMode ?? "client",
        paginationMode: opts?.paginationMode ?? "client",
        compileFilter: compileTestFilter,
      },
    },
  });
  return createGridRuntime({ schema, dataSource });
}

function buildReadonlyRuntime() {
  const readonlyRoot = inMemoryReadonlyLevelSource<TestFilter>({
    initialNodes: makeRows(),
    options: schema.levels.rows.options,
    columns: cols,
    sortMode: "client",
    filterMode: "client",
    paginationMode: "client",
    compileFilter: compileTestFilter,
  });
  const dataSource: GridDataSource = {
    rootSource: () => readonlyRoot,
    resolveChild: () => {
      throw new Error("no child levels");
    },
    dispose: () => {
      readonlyRoot.dispose();
    },
  };
  return createGridRuntime({ schema, dataSource });
}

describe("TableController — writable construction", () => {
  it("rootSource and rootController identity-stable across the runtime lifetime", async () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    if (!tc.writable) throw new Error("expected writable");
    const sourceRef = tc.rootSource;
    const controllerRef = tc.rootController;
    await tc.rootSource.query!.sort!.set([
      { colId: "qty", direction: "desc" },
    ]);
    expect(tc.rootSource).toBe(sourceRef);
    expect(tc.rootController).toBe(controllerRef);
  });

  it("rootSource exposes only the read surface even when writable", () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    expect(tc.writable).toBe(true);
    if (!tc.writable) return;
    expect(tc.rootSource.canWrite).toBe(true);
    expect("setCell" in tc.rootSource).toBe(false);
    expect("createNode" in tc.rootSource).toBe(false);
    expect("removeNode" in tc.rootSource).toBe(false);
  });
});

describe("TableController — passthroughs", () => {
  it("rootSource.query.sort applies a SortDescriptor", async () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    await tc.rootSource.query!.sort!.set([
      { colId: "qty", direction: "desc" },
    ]);
    const displayed = rt.displayedRowsFor(rootPath("rows"));
    expect(displayed.rows[0].columns.qty).toBe(24);
    expect(displayed.rows[displayed.rows.length - 1].columns.qty).toBe(0);
  });

  it("rootSource.query.filter drops rows that fail the predicate", async () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    await tc.rootSource.query!.filter!.set({
      qty: (v: unknown) => Number(v) >= 20,
    } satisfies TestFilter);
    const displayed = rt.displayedRowsFor(rootPath("rows"));
    expect(displayed.rows.length).toBe(5);
    expect(displayed.rows.every((r) => Number(r.columns.qty) >= 20)).toBe(true);
  });
});

describe("TableController — phantoms", () => {
  it("phantoms.add shows the row in displayed output", () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    if (!tc.writable) throw new Error("expected writable");
    tc.phantoms.add(phantom("draft1", { id: "draft1", qty: 999 }));
    const displayed = rt.displayedRowsFor(rootPath("rows"));
    expect(displayed.rows.some((r) => r.kind === "phantom")).toBe(true);
    expect(tc.phantoms.get()).toHaveLength(1);
  });

  it("commitPhantomRow creates a real node, removes the phantom, emits phantomRowCommitted exactly once", async () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    if (!tc.writable) throw new Error("expected writable");
    let committed = 0;
    let lastPayload: { path: string; rowKey: string } | null = null;
    let lastMutation: unknown = null;
    rt.on("phantomRowCommitted", (e) => {
      committed += 1;
      lastPayload = { path: e.path, rowKey: e.rowKey };
    });
    rt.on("mutationCommitted", (e) => {
      lastMutation = e;
    });

    tc.phantoms.add(phantom("draft1", { id: "r25", qty: 25 }));
    await tc.commitPhantomRow("draft1");

    const displayed = rt.displayedRowsFor(rootPath("rows"));
    expect(displayed.rows.some((r) => r.kind === "phantom")).toBe(false);
    expect(displayed.rows[displayed.rows.length - 1].id).toBe(
      makeRowId(rootPath("rows"), "r25"),
    );
    expect(tc.phantoms.get()).toHaveLength(0);
    expect(committed).toBe(1);
    expect(lastPayload).toEqual({ path: "rows", rowKey: "draft1" });
    expect(lastMutation).toEqual({
      kind: "insert",
      path: "rows",
      node: { levelName: "rows", columns: { id: "r25", qty: 25 } },
      atIndex: 25,
    });
  });

  it("commitPhantomRow with a missing rowKey rejects and does not mutate state", async () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    if (!tc.writable) throw new Error("expected writable");
    let committed = 0;
    rt.on("phantomRowCommitted", () => {
      committed += 1;
    });
    const before = rt.snapshotFor(rootPath("rows")).nodes;
    await expect(tc.commitPhantomRow("ghost")).rejects.toThrow(
      /no phantom with rowKey "ghost"/,
    );
    expect(rt.snapshotFor(rootPath("rows")).nodes).toBe(before);
    expect(committed).toBe(0);
  });

  it("commitPhantomRow forwards atIndex to createNode", async () => {
    const rt = buildRuntime();
    const tc = createTableController({ runtime: rt });
    if (!tc.writable) throw new Error("expected writable");
    tc.phantoms.add(phantom("draft1", { id: "r99", qty: 99 }));
    await tc.commitPhantomRow("draft1", 0);
    const displayed = rt.displayedRowsFor(rootPath("rows"));
    expect(displayed.rows[0].id).toBe(makeRowId(rootPath("rows"), "r99"));
  });
});

describe("TableController — readonly root", () => {
  it("narrows to the readonly variant; no edit verbs and no phantom helpers", () => {
    const rt = buildReadonlyRuntime();
    const tc = createTableController({ runtime: rt });
    expect(tc.writable).toBe(false);
    if (tc.writable) return;
    expect(tc.rootSource.canWrite).toBe(false);
    expect("setCell" in tc.rootSource).toBe(false);
    expect("createNode" in tc.rootSource).toBe(false);
    expect("phantoms" in tc).toBe(false);
    expect("commitPhantomRow" in tc).toBe(false);
  });
});
