import { describe, expect, it, vi } from "vitest";
import { createGridRuntime } from "./create-grid-runtime";
import { collectRowOperationTargets } from "./row-operation-targets";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { inMemoryLevelSource } from "../data-sources/memory/in-memory-level-source";
import type {
  GridDataSource,
  LevelDataSource,
  LevelSnapshot,
  LevelStatus,
  WritableLevelDataSource,
} from "../data-sources/types";
import {
  childPath,
  displayedPhantomRowKey,
  makeRowId,
  rootPath,
  type GridPath,
  type RowKey,
} from "../types/identity";
import type { PhantomRow, TreeNode } from "../types/level-row";
import type { ColumnSchema, GridSchema, LevelSchema } from "../types/schema";
import {
  CELL_EDITING_GRID,
  CELL_GRID_WITH_ACTIVE_ROW,
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  CELL_PRIMARY_WITH_SIDE_PANEL_ROW,
  ROW_MULTISELECT_LIST,
} from "../types/interaction";
import { rowInteractionStatusFor } from "../types/row-selection";

const TestEditor = () => null;

function phantom(
  rowKey: string,
  columns: Record<string, unknown> = {},
): PhantomRow {
  return { rowKey, columns, state: { kind: "editing" } };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const cols: ColumnSchema[] = [
  {
    id: "name",
    name: "Name",
    renderCell: ({ value }) => String(value ?? ""),
    edit: {
      editor: TestEditor,
      startsOn: ["enter", "f2", "type", "doubleClick"],
    },
  },
  {
    id: "qty",
    name: "Qty",
    renderCell: ({ value }) => String(value ?? ""),
    compare: (a, b) => (Number(a) || 0) - (Number(b) || 0),
    edit: {
      editor: TestEditor,
      startsOn: ["enter", "f2", "type", "doubleClick"],
    },
  },
];

const textColumn = (id: string, name: string): ColumnSchema => ({
  id,
  name,
  renderCell: ({ value }) => String(value ?? ""),
});

const tableSchema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      columns: cols,
      options: {
        rowKey: (n: TreeNode) => String(n.columns.id),
        allowPhantoms: true,
      },
      childLevels: [],
    },
  },
};

const tableNodes = (): TreeNode[] => [
  { levelName: "rows", columns: { id: "a", name: "Apple", qty: 1 } },
  { levelName: "rows", columns: { id: "b", name: "Banana", qty: 2 } },
];

const reportSchema: GridSchema = {
  rootLevel: "cat",
  levels: {
    cat: {
      name: "cat",
      columns: [
        {
          id: "name",
          name: "C",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: { rowKey: (n: TreeNode) => String(n.columns.name) },
      childLevels: ["items"],
    } as LevelSchema,
    items: {
      name: "items",
      columns: [
        {
          id: "name",
          name: "I",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: { rowKey: (n: TreeNode) => String(n.columns.name) },
      childLevels: [],
    } as LevelSchema,
  },
};

const reportTree: TreeNode[] = [
  {
    levelName: "cat",
    columns: { name: "Fruit" },
    children: {
      items: [
        { levelName: "items", columns: { name: "Apple" } },
        { levelName: "items", columns: { name: "Banana" } },
      ],
    },
  },
];

function tableDataSource() {
  return inMemoryGridDataSource({
    schema: tableSchema,
    tree: tableNodes(),
    levels: {
      rows: { sortMode: "none", filterMode: "none", paginationMode: "none" },
    },
  });
}

function dataSourceWithRoot(source: LevelDataSource): GridDataSource {
  return {
    rootSource: () => source,
    resolveChild: () => {
      throw new Error("not used");
    },
    dispose: () => {},
  };
}

function writableSourceWithCreate(
  createNode: WritableLevelDataSource["createNode"],
  nodes: TreeNode[] = [],
): WritableLevelDataSource {
  return {
    writable: true,
    snapshot: () => ({
      status: "ready",
      nodes,
      serverManaged: { sort: false, filter: false, pagination: false },
    }),
    subscribe: () => () => {},
    setSort: () => {},
    setFilter: () => {},
    setPage: () => {},
    refetch: () => {},
    dispose: () => {},
    setCell: () => {},
    applyChanges: () => {},
    createNode,
    removeNode: () => {},
    onReconcile: () => () => {},
  };
}

function reportDataSource(): GridDataSource {
  return inMemoryGridDataSource({
    schema: reportSchema,
    tree: reportTree,
    levels: {
      cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
      items: { sortMode: "none", filterMode: "none", paginationMode: "none" },
    },
  });
}

describe("GridRuntime", () => {
  const rowsRoot = rootPath("rows");
  const reportRoot = rootPath("cat");

  it("displayedRowsFor is identity-stable across no-op calls", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const a = rt.displayedRowsFor(rowsRoot);
    const b = rt.displayedRowsFor(rowsRoot);
    expect(a).toBe(b);
  });

  it("displayedRowSequenceFor is identity-stable across no-op calls", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const a = rt.displayedRowSequenceFor(rowsRoot);
    const b = rt.displayedRowSequenceFor(rowsRoot);

    expect(a).toBe(b);
    expect(a.rows).toEqual([
      { id: makeRowId(rowsRoot, "a"), kind: "data" },
      { id: makeRowId(rowsRoot, "b"), kind: "data" },
    ]);
  });

  it("controllerFor returns the same instance per path", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const c1 = rt.controllerFor(rowsRoot);
    const c2 = rt.controllerFor(rowsRoot);
    expect(c1).toBe(c2);
  });

  it("guards public state reads after disposal", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });

    rt.dispose();
    rt.dispose();

    expect(() => rt.sourceFor(rowsRoot)).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => rt.displayedRowsFor(rowsRoot)).toThrow(
      "GridRuntime has been disposed.",
    );
  });

  it("guards retained source views after disposal", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const source = rt.sourceFor(rowsRoot);

    rt.dispose();

    expect(() => source.snapshot()).toThrow("GridRuntime has been disposed.");
    expect(() => source.refetch()).toThrow("GridRuntime has been disposed.");
    expect(() => source.subscribe(() => {})).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => source.setSort([{ colId: "qty", direction: "asc" }])).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => source.setFilter(undefined)).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => source.setPage(1, 25)).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => source.onReconcile(() => {})).toThrow(
      "GridRuntime has been disposed.",
    );
  });

  it("allows retained source-view unsubscribe after disposal", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const source = rt.sourceFor(rowsRoot);
    const unsubscribe = source.subscribe(() => {});

    rt.dispose();

    expect(() => unsubscribe()).not.toThrow();
  });

  it("distinguishes missing child sources from missing root sources", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    const unresolvedChildPath = childPath(
      reportRoot,
      "Fruit" as RowKey,
      "items",
    );

    expect(() => rt.sourceFor(unresolvedChildPath)).toThrow(
      'GridRuntime.sourceFor: no source has been resolved for path "cat.Fruit.items". Expand the parent row first.',
    );
  });

  it("writeCell flows through the source and emits mutationCommitted", () => {
    const mutation = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: mutation },
    });
    const coord = { rowId: makeRowId(rowsRoot, "a"), colId: "qty" };
    rt.writeCell(rowsRoot, coord, 99);
    const displayed = rt.displayedRowsFor(rowsRoot);
    const updated = displayed.rowById.get(makeRowId(rowsRoot, "a"));
    expect(updated?.columns.qty).toBe(99);
    expect(mutation).toHaveBeenCalledWith({
      kind: "cell",
      path: rowsRoot,
      coord,
      oldValue: 1,
      newValue: 99,
    });
  });

  it("sourceFor returns a read view with writable verbs hidden", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const src = rt.sourceFor(rowsRoot);
    expect(src.writable).toBe(true);
    expect("setCell" in src).toBe(false);
    expect("applyChanges" in src).toBe(false);
    expect("createNode" in src).toBe(false);
    expect("removeNode" in src).toBe(false);
    expect("dispose" in src).toBe(false);
    expect(src.snapshot().nodes).toHaveLength(2);
  });

  it("sourceFor returns a live view for read, query, and refresh operations", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const source = rt.sourceFor(rowsRoot);

    expect(() => {
      source.snapshot();
      source.setSort([{ colId: "qty", direction: "desc" }]);
      source.setPage(1, 25);
      source.refetch();
    }).not.toThrow();
  });

  it("writeCell on a readonly source throws synchronously", () => {
    const readonlyDataSource: GridDataSource = {
      rootSource() {
        const writable = inMemoryLevelSource({
          initialNodes: tableNodes(),
          options: tableSchema.levels.rows.options,
          columns: tableSchema.levels.rows.columns,
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        });
        const readonly: LevelDataSource = {
          writable: false,
          snapshot: writable.snapshot,
          subscribe: writable.subscribe,
          setSort: writable.setSort,
          setFilter: writable.setFilter,
          setPage: writable.setPage,
          refetch: writable.refetch,
          dispose: writable.dispose,
        };
        return readonly;
      },
      resolveChild() {
        throw new Error("not used");
      },
      dispose() {},
    };
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: readonlyDataSource,
    });
    expect(() =>
      rt.writeCell(
        rowsRoot,
        { rowId: makeRowId(rowsRoot, "a"), colId: "qty" },
        7,
      ),
    ).toThrow(/readonly/);
  });

  it("expandRow resolves the child source exactly once per (path, rowKey, childLevel)", () => {
    const inner = reportDataSource();
    const resolveChild = vi.fn(inner.resolveChild);
    const dataSource: GridDataSource = {
      rootSource: inner.rootSource,
      resolveChild,
      dispose: inner.dispose,
    };
    const rt = createGridRuntime({ schema: reportSchema, dataSource });
    const fruitRow = makeRowId(reportRoot, "Fruit");
    rt.coordinator.toggleExpand(reportRoot, fruitRow);
    rt.coordinator.toggleExpand(reportRoot, fruitRow); // collapse
    rt.coordinator.toggleExpand(reportRoot, fruitRow); // re-expand
    expect(resolveChild).toHaveBeenCalledTimes(1);
    expect(resolveChild.mock.calls[0]).toEqual([reportRoot, "Fruit", "items"]);
    const itemsPath = childPath(reportRoot, "Fruit", "items");
    const items = rt.displayedRowsFor(itemsPath);
    expect(items.rows.map((r) => r.columns.name)).toEqual(["Apple", "Banana"]);
  });

  it("schemaAt returns a level schema for any well-formed path", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    expect(rt.schemaAt(reportRoot).name).toBe("cat");
    // Works for an unmaterialized child path — looked up by level name.
    const itemsPath = childPath(reportRoot, "Fruit", "items");
    expect(rt.schemaAt(itemsPath).name).toBe("items");
  });

  it("materializedChildren returns nothing until the child source is registered", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    const fruitRow = makeRowId(reportRoot, "Fruit");
    expect(rt.materializedChildren(reportRoot, fruitRow)).toEqual([]);
    rt.coordinator.toggleExpand(reportRoot, fruitRow);
    expect(rt.materializedChildren(reportRoot, fruitRow)).toEqual([
      childPath(reportRoot, "Fruit", "items"),
    ]);
    // Source survives collapse — materialization is "registered", not
    // "currently expanded".
    rt.coordinator.toggleExpand(reportRoot, fruitRow);
    expect(rt.materializedChildren(reportRoot, fruitRow)).toEqual([
      childPath(reportRoot, "Fruit", "items"),
    ]);
  });

  it("registeredPaths includes root immediately and is stable until registry changes", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    const first = rt.registeredPaths();
    const second = rt.registeredPaths();

    expect(first).toEqual([reportRoot]);
    expect(second).toBe(first);

    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    const afterExpand = rt.registeredPaths();
    expect(afterExpand).not.toBe(first);
    expect(afterExpand).toEqual([
      reportRoot,
      childPath(reportRoot, "Fruit", "items"),
    ]);
    expect(rt.registeredPaths()).toBe(afterExpand);
  });

  it("materializedChildren returns child paths in schema declaration order", () => {
    const multiChildSchema: GridSchema = {
      rootLevel: "cat",
      levels: {
        cat: {
          name: "cat",
          columns: [textColumn("name", "C")],
          options: { rowKey: (n: TreeNode) => String(n.columns.name) },
          childLevels: ["a", "b"],
        } as LevelSchema,
        a: {
          name: "a",
          columns: [textColumn("v", "V")],
          options: { rowKey: (n: TreeNode) => String(n.columns.v) },
          childLevels: [],
        } as LevelSchema,
        b: {
          name: "b",
          columns: [textColumn("v", "V")],
          options: { rowKey: (n: TreeNode) => String(n.columns.v) },
          childLevels: [],
        } as LevelSchema,
      },
    };
    const tree: TreeNode[] = [
      {
        levelName: "cat",
        columns: { name: "X" },
        children: { a: [], b: [] },
      },
    ];
    const ds = inMemoryGridDataSource({
      schema: multiChildSchema,
      tree,
      levels: {
        cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
        a: { sortMode: "none", filterMode: "none", paginationMode: "none" },
        b: { sortMode: "none", filterMode: "none", paginationMode: "none" },
      },
    });
    const rt = createGridRuntime({ schema: multiChildSchema, dataSource: ds });
    const root = rootPath("cat");
    const xRow = makeRowId(root, "X");
    rt.coordinator.toggleExpand(root, xRow);
    expect(rt.materializedChildren(root, xRow)).toEqual([
      childPath(root, "X", "a"),
      childPath(root, "X", "b"),
    ]);
  });

  it("notifies subscribeRegistry listeners when a child source is resolved", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    let ticks = 0;
    rt.subscribeRegistry(() => {
      ticks += 1;
    });
    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    expect(ticks).toBe(1);
    expect(rt.registeredPaths()).toEqual([
      reportRoot,
      childPath(reportRoot, "Fruit", "items"),
    ]);
    // Re-expanding does not re-resolve, so no extra tick.
    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    expect(ticks).toBe(1);
  });

  it("emits cellReconciled when a writable source emits a reconcile event", () => {
    let reconcileFn:
      | ((e: import("../data-sources/types").ReconcileEvent) => void)
      | null = null;
    const fakeWritable: WritableLevelDataSource = {
      writable: true,
      snapshot: () => ({
        status: "ready",
        nodes: tableNodes(),
        serverManaged: { sort: false, filter: false, pagination: false },
      }),
      subscribe: () => () => {},
      setSort: () => {},
      setFilter: () => {},
      setPage: () => {},
      refetch: () => {},
      dispose: () => {},
      setCell: () => {},
      applyChanges: () => {},
      createNode: async (node, atIndex) => ({
        node,
        atIndex: atIndex ?? 0,
      }),
      removeNode: () => {},
      onReconcile: (fn) => {
        reconcileFn = fn;
        return () => {
          reconcileFn = null;
        };
      },
    };
    const dataSource: GridDataSource = {
      rootSource: () => fakeWritable,
      resolveChild() {
        throw new Error("not used");
      },
      dispose() {},
    };
    const handler = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource,
      on: { cellReconciled: handler },
    });
    expect(reconcileFn).not.toBeNull();
    reconcileFn!({
      kind: "agreed",
      rowKey: "a" as RowKey,
      colId: "qty",
      value: 5,
    });
    expect(handler).toHaveBeenCalledWith({
      path: rowsRoot,
      event: { kind: "agreed", rowKey: "a", colId: "qty", value: 5 },
    });
    rt.dispose();
  });

  it("emits levelStatusChanged when a source's status transitions", () => {
    let status: import("../data-sources/types").LevelStatus = "loading";
    const subs = new Set<() => void>();
    const fake: LevelDataSource = {
      writable: false,
      snapshot: () => ({
        status,
        nodes: [],
        serverManaged: { sort: false, filter: false, pagination: false },
      }),
      subscribe: (fn) => {
        subs.add(fn);
        return () => {
          subs.delete(fn);
        };
      },
      setSort: () => {},
      setFilter: () => {},
      setPage: () => {},
      refetch: () => {},
      dispose: () => {},
    };
    const dataSource: GridDataSource = {
      rootSource: () => fake,
      resolveChild() {
        throw new Error("not used");
      },
      dispose() {},
    };
    const handler = vi.fn();
    createGridRuntime({
      schema: tableSchema,
      dataSource,
      on: { levelStatusChanged: handler },
    });
    status = "ready";
    for (const fn of subs) fn();
    expect(handler).toHaveBeenCalledWith({ path: rowsRoot, status: "ready" });
  });

  it("keeps displayed rows stable across status-only source emissions", () => {
    let status: LevelStatus = "loading";
    const nodes = tableNodes();
    const footerRows = [{ rowKey: "total" as RowKey, columns: { qty: 3 } }];
    const serverManaged = Object.freeze({
      sort: false,
      filter: false,
      pagination: false,
    });
    const subs = new Set<() => void>();
    const fake: LevelDataSource = {
      writable: false,
      snapshot: (): LevelSnapshot => ({
        status,
        nodes,
        footerRows,
        serverManaged,
      }),
      subscribe: (fn) => {
        subs.add(fn);
        return () => {
          subs.delete(fn);
        };
      },
      setSort: () => {},
      setFilter: () => {},
      setPage: () => {},
      refetch: () => {},
      dispose: () => {},
    };
    const dataSource: GridDataSource = {
      rootSource: () => fake,
      resolveChild() {
        throw new Error("not used");
      },
      dispose() {},
    };
    const rt = createGridRuntime({ schema: tableSchema, dataSource });
    const before = rt.displayedRowsFor(rowsRoot);

    status = "ready";
    for (const fn of subs) fn();

    expect(rt.displayedRowsFor(rowsRoot)).toBe(before);
  });

  it("dispose tears down sources, controllers, and the data-source", () => {
    const sourceDispose = vi.fn();
    const dataSourceDispose = vi.fn();
    const writable = inMemoryLevelSource({
      initialNodes: tableNodes(),
      options: tableSchema.levels.rows.options,
      columns: tableSchema.levels.rows.columns,
      sortMode: "none",
      filterMode: "none",
      paginationMode: "none",
    });
    const original = writable.dispose;
    writable.dispose = () => {
      sourceDispose();
      original();
    };
    const dataSource: GridDataSource = {
      rootSource: () => writable,
      resolveChild() {
        throw new Error("not used");
      },
      dispose: dataSourceDispose,
    };
    const rt = createGridRuntime({ schema: tableSchema, dataSource });
    rt.controllerFor(rowsRoot);
    rt.dispose();
    expect(sourceDispose).toHaveBeenCalledTimes(1);
    expect(dataSourceDispose).toHaveBeenCalledTimes(1);
  });

  it("controller commitEdit drives mutationCommitted through the runtime", () => {
    const handler = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: handler },
    });
    const c = rt.controllerFor(rowsRoot);
    const coord = { rowId: makeRowId(rowsRoot, "a"), colId: "qty" };
    rt.cursorManager.setCellRange(rowsRoot, coord, coord);
    c.startEdit(coord, "f2");
    c.commitEdit(42);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cell",
        path: rowsRoot,
        coord,
        oldValue: 1,
        newValue: 42,
      }),
    );
  });

  it("subscribeDisplayedRowSequence wakes on create and remove", async () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const listener = vi.fn();
    const before = rt.displayedRowSequenceFor(rowsRoot);
    rt.subscribeDisplayedRowSequence(rowsRoot, listener);

    await rt.createRow(rowsRoot, {
      levelName: "rows",
      columns: { id: "c", name: "Cherry", qty: 3 },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const afterInsert = rt.displayedRowSequenceFor(rowsRoot);
    expect(afterInsert).not.toBe(before);

    await rt.removeRow(rowsRoot, "c");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(rt.displayedRowSequenceFor(rowsRoot)).not.toBe(afterInsert);
  });

  it("subscribeDisplayedRow wakes on a single-cell edit without waking the row sequence", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const sequence = vi.fn();
    const row = vi.fn();
    const before = rt.displayedRowSequenceFor(rowsRoot);
    rt.subscribeDisplayedRowSequence(rowsRoot, sequence);
    rt.subscribeDisplayedRow(rowsRoot, makeRowId(rowsRoot, "a"), row);

    rt.writeCell(
      rowsRoot,
      { rowId: makeRowId(rowsRoot, "a"), colId: "qty" },
      99,
    );

    expect(sequence).not.toHaveBeenCalled();
    expect(rt.displayedRowSequenceFor(rowsRoot)).toBe(before);
    expect(row).toHaveBeenCalledTimes(1);
    expect(
      rt.displayedRowFor(rowsRoot, makeRowId(rowsRoot, "a"))?.columns.qty,
    ).toBe(99);
  });

  it("phantom changes notify row sequence and phantom row subscribers precisely", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const sequence = vi.fn();
    const before = rt.displayedRowSequenceFor(rowsRoot);
    rt.subscribeDisplayedRowSequence(rowsRoot, sequence);

    rt.phantoms.add(rowsRoot, phantom("draft1", { name: "X" }));

    const phantomId = makeRowId(rowsRoot, displayedPhantomRowKey("draft1"));
    const afterAdd = rt.displayedRowSequenceFor(rowsRoot);
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(afterAdd).not.toBe(before);
    expect(rt.displayedRowFor(rowsRoot, phantomId)?.kind).toBe("phantom");

    const phantomRow = vi.fn();
    rt.subscribeDisplayedRow(rowsRoot, phantomId, phantomRow);
    rt.phantoms.setCell(rowsRoot, "draft1", "name", "Y");

    expect(sequence).toHaveBeenCalledTimes(1);
    expect(rt.displayedRowSequenceFor(rowsRoot)).toBe(afterAdd);
    expect(phantomRow).toHaveBeenCalledTimes(1);

    rt.phantoms.remove(rowsRoot, "draft1");
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(rt.displayedRowSequenceFor(rowsRoot)).not.toBe(afterAdd);
    expect(phantomRow).toHaveBeenCalledTimes(2);
  });

  it("source emission for one path does not wake row-sequence subscribers for another path", async () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;
    const rootList = vi.fn();
    const childList = vi.fn();
    rt.subscribeDisplayedRowSequence(reportRoot, rootList);
    rt.subscribeDisplayedRowSequence(itemsPath, childList);

    await rt.createRow(itemsPath, {
      levelName: "items",
      columns: { name: "Cherry" },
    });

    expect(rootList).not.toHaveBeenCalled();
    expect(childList).toHaveBeenCalledTimes(1);
  });

  it("phantoms exposed via runtime.phantoms reach the displayed rows", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    rt.phantoms.add(rowsRoot, phantom("draft1", { name: "X" }));
    const displayed = rt.displayedRowsFor(rowsRoot);
    expect(displayed.rows.some((r) => r.kind === "phantom")).toBe(true);
    rt.phantoms.remove(rowsRoot, "draft1");
    const after = rt.displayedRowsFor(rowsRoot);
    expect(after.rows.every((r) => r.kind !== "phantom")).toBe(true);
  });

  it("base grid does not auto-create blank phantoms without lifecycle config", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: inMemoryGridDataSource({
        schema: tableSchema,
        tree: [],
        levels: {
          rows: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
        },
      }),
    });

    expect(rt.phantoms.get(rowsRoot)).toHaveLength(0);
    expect(rt.displayedRowsFor(rowsRoot).rows).toEqual([]);
  });

  it("empty ready writable phantom-enabled levels get one editable phantom row", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: inMemoryGridDataSource({
        schema: tableSchema,
        tree: [],
        levels: {
          rows: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
        },
      }),
      phantomRows: {},
    });

    const phantoms = rt.phantoms.get(rowsRoot);
    expect(phantoms).toHaveLength(1);
    expect(phantoms[0].state).toEqual({ kind: "editing" });
    expect(rt.displayedRowsFor(rowsRoot).rows.map((row) => row.kind)).toEqual([
      "phantom",
    ]);
  });

  it("editing a phantom row stays local and does not emit mutationCommitted", () => {
    const setCell = vi.fn();
    const mutationCommitted = vi.fn();
    const source: WritableLevelDataSource = {
      writable: true,
      snapshot: () => ({
        status: "ready",
        nodes: [],
        serverManaged: { sort: false, filter: false, pagination: false },
      }),
      subscribe: () => () => {},
      setSort: () => {},
      setFilter: () => {},
      setPage: () => {},
      refetch: () => {},
      dispose: () => {},
      setCell,
      applyChanges: () => {},
      createNode: async (node, atIndex) => ({
        node,
        atIndex: atIndex ?? 0,
      }),
      removeNode: () => {},
      onReconcile: () => () => {},
    };
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: {
        rootSource: () => source,
        resolveChild: () => {
          throw new Error("not used");
        },
        dispose: () => {},
      },
      phantomRows: {},
      on: { mutationCommitted },
    });

    const phantomRow = rt.phantoms.get(rowsRoot)[0];
    rt.writeCell(
      rowsRoot,
      {
        rowId: makeRowId(rowsRoot, displayedPhantomRowKey(phantomRow.rowKey)),
        colId: "name",
      },
      "New row",
    );

    expect(setCell).not.toHaveBeenCalled();
    expect(mutationCommitted).not.toHaveBeenCalled();
    expect(rt.phantoms.get(rowsRoot)[0].columns.name).toBe("New row");
  });

  it("ArrowDown at the last row creates or reuses one blank phantom", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      phantomRows: {},
    });
    const lastDataCursor = {
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "b"),
      colId: "qty",
    };
    rt.cursorManager.moveCellCursorTo(lastDataCursor);

    rt.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    const firstTarget = rt.cursorManager.currentCellCursor();
    expect(firstTarget).not.toBeNull();
    expect(rt.displayedRowFor(rowsRoot, firstTarget!.rowId)?.kind).toBe(
      "phantom",
    );
    expect(rt.phantoms.get(rowsRoot)).toHaveLength(1);

    rt.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.phantoms.get(rowsRoot)).toHaveLength(1);
    expect(rt.cursorManager.currentCellCursor()).toEqual(firstTarget);
  });

  it("leaving a nonblank phantom row creates one authoritative row", async () => {
    const mutationCommitted = vi.fn();
    const phantomRowCommitted = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: inMemoryGridDataSource({
        schema: tableSchema,
        tree: [],
        levels: {
          rows: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
        },
      }),
      phantomRows: {},
      on: {
        mutationCommitted,
        phantomRowCommitted,
      },
    });
    const phantomRow = rt.phantoms.get(rowsRoot)[0];
    const rowId = makeRowId(
      rowsRoot,
      displayedPhantomRowKey(phantomRow.rowKey),
    );
    rt.cursorManager.moveCellCursorTo({ path: rowsRoot, rowId, colId: "name" });
    rt.writeCell(rowsRoot, { rowId, colId: "id" }, "c");
    rt.writeCell(rowsRoot, { rowId, colId: "name" }, "Cherry");

    rt.cursorManager.clearCellCursor();
    await flushMicrotasks();

    expect(rt.phantoms.get(rowsRoot)).toHaveLength(0);
    expect(
      rt.snapshotFor(rowsRoot).nodes.map((node) => node.columns.id),
    ).toEqual(["c"]);
    expect(mutationCommitted).toHaveBeenCalledTimes(1);
    expect(phantomRowCommitted).toHaveBeenCalledTimes(1);
  });

  it("double commitPhantomRow reuses the pending create", async () => {
    const created = deferred<{
      node: TreeNode;
      atIndex: number;
    }>();
    const createNode = vi.fn<WritableLevelDataSource["createNode"]>(
      () => created.promise,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(writableSourceWithCreate(createNode)),
    });
    rt.phantoms.add(rowsRoot, phantom("draft1", { id: "c", name: "Cherry" }));

    const first = rt.commitPhantomRow(rowsRoot, "draft1");
    const second = rt.commitPhantomRow(rowsRoot, "draft1");

    expect(second).toBe(first);
    expect(createNode).toHaveBeenCalledTimes(1);

    const serverNode: TreeNode = {
      levelName: "rows",
      columns: { id: "c", name: "Cherry" },
    };
    created.resolve({ node: serverNode, atIndex: 0 });
    await expect(first).resolves.toEqual({ node: serverNode, atIndex: 0 });
  });

  it("cursor leave plus direct commit does not create a phantom twice", async () => {
    const created = deferred<{
      node: TreeNode;
      atIndex: number;
    }>();
    const createNode = vi.fn<WritableLevelDataSource["createNode"]>(
      () => created.promise,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(writableSourceWithCreate(createNode)),
      phantomRows: {},
    });
    const phantomRow = rt.phantoms.get(rowsRoot)[0];
    const rowId = makeRowId(
      rowsRoot,
      displayedPhantomRowKey(phantomRow.rowKey),
    );
    rt.cursorManager.moveCellCursorTo({ path: rowsRoot, rowId, colId: "name" });
    rt.writeCell(rowsRoot, { rowId, colId: "id" }, "c");

    rt.cursorManager.clearCellCursor();
    const direct = rt.commitPhantomRow(rowsRoot, phantomRow.rowKey);

    expect(createNode).toHaveBeenCalledTimes(1);
    created.resolve({
      node: { levelName: "rows", columns: { id: "c" } },
      atIndex: 0,
    });
    await expect(direct).resolves.toEqual({
      node: { levelName: "rows", columns: { id: "c" } },
      atIndex: 0,
    });
  });

  it("committing a phantom snapshots columns and rejects edits while saving", async () => {
    const created = deferred<{
      node: TreeNode;
      atIndex: number;
    }>();
    const createNode = vi.fn<WritableLevelDataSource["createNode"]>(
      () => created.promise,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(writableSourceWithCreate(createNode)),
    });
    rt.phantoms.add(rowsRoot, phantom("draft1", { id: "c", name: "Cherry" }));
    const rowId = makeRowId(rowsRoot, displayedPhantomRowKey("draft1"));

    const promise = rt.commitPhantomRow(rowsRoot, "draft1");

    expect(() =>
      rt.writeCell(rowsRoot, { rowId, colId: "name" }, "Changed"),
    ).toThrow(/is saving and cannot be edited/);
    expect(rt.phantoms.get(rowsRoot)[0].columns.name).toBe("Cherry");
    expect(createNode).toHaveBeenCalledWith(
      { levelName: "rows", columns: { id: "c", name: "Cherry" } },
      undefined,
    );

    rt.phantoms.setCell(rowsRoot, "draft1", "name", "Direct channel edit");
    created.resolve({
      node: { levelName: "rows", columns: { id: "c", name: "Cherry" } },
      atIndex: 0,
    });
    await promise;
    expect(createNode.mock.calls[0][0].columns.name).toBe("Cherry");
  });

  it("failed phantom row creates keep the phantom with failure state", async () => {
    const createFailed = vi.fn();
    const source: WritableLevelDataSource = {
      writable: true,
      snapshot: () => ({
        status: "ready",
        nodes: [],
        serverManaged: { sort: false, filter: false, pagination: false },
      }),
      subscribe: () => () => {},
      setSort: () => {},
      setFilter: () => {},
      setPage: () => {},
      refetch: () => {},
      dispose: () => {},
      setCell: () => {},
      applyChanges: () => {},
      createNode: async () => {
        throw new Error("validation failed");
      },
      removeNode: () => {},
      onReconcile: () => () => {},
    };
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: {
        rootSource: () => source,
        resolveChild: () => {
          throw new Error("not used");
        },
        dispose: () => {},
      },
      phantomRows: {},
      on: { phantomRowCreateFailed: createFailed },
    });
    const phantomRow = rt.phantoms.get(rowsRoot)[0];
    const rowId = makeRowId(
      rowsRoot,
      displayedPhantomRowKey(phantomRow.rowKey),
    );
    rt.cursorManager.moveCellCursorTo({ path: rowsRoot, rowId, colId: "name" });
    rt.writeCell(rowsRoot, { rowId, colId: "name" }, "Cherry");

    rt.cursorManager.clearCellCursor();
    await flushMicrotasks();

    expect(rt.phantoms.get(rowsRoot)).toHaveLength(1);
    expect(rt.phantoms.get(rowsRoot)[0].state).toEqual({
      kind: "failed",
      reason: "validation failed",
    });
    expect(createFailed).toHaveBeenCalledWith({
      path: rowsRoot,
      rowKey: phantomRow.rowKey,
      reason: "validation failed",
    });

    rt.writeCell(rowsRoot, { rowId, colId: "name" }, "Cherry retry");
    expect(rt.phantoms.get(rowsRoot)[0].state).toEqual({ kind: "editing" });
    expect(rt.phantoms.get(rowsRoot)[0].columns.name).toBe("Cherry retry");
  });

  it("setCell on a different path does not invalidate sibling pipelines", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;
    const beforeChild = rt.displayedRowsFor(itemsPath);
    rt.writeCell(
      reportRoot,
      { rowId: makeRowId(reportRoot, "Fruit"), colId: "name" },
      "Fruit!",
    );
    expect(rt.displayedRowsFor(itemsPath)).toBe(beforeChild);
  });

  it("createRow and removeRow are runtime verbs and emit mutationCommitted", async () => {
    const mutation = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: mutation },
    });
    const node: TreeNode = {
      levelName: "rows",
      columns: { id: "c", name: "Cherry", qty: 3 },
    };
    await rt.createRow(rowsRoot, node);
    expect(rt.snapshotFor(rowsRoot).nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(mutation).toHaveBeenLastCalledWith({
      kind: "insert",
      path: rowsRoot,
      node,
      atIndex: 2,
    });

    await rt.removeRow(rowsRoot, "b");
    expect(rt.snapshotFor(rowsRoot).nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "c",
    ]);
    expect(mutation).toHaveBeenLastCalledWith({
      kind: "remove",
      path: rowsRoot,
      node: { levelName: "rows", columns: { id: "b", name: "Banana", qty: 2 } },
      atIndex: 1,
    });
  });

  it("cursorManager rejects cursor commands from the wrong interaction mode", () => {
    const rowList = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });
    expect(() =>
      rowList.cursorManager.moveCellCursorTo({
        path: rowsRoot,
        rowId: makeRowId(rowsRoot, "a"),
        colId: "name",
      }),
    ).toThrow(/cell-grid interaction/);
    expect(rowList.coordinator.getState().cellCursor).toBe(null);

    const cellGrid = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_GRID_WITH_ACTIVE_ROW,
    });
    expect(() =>
      cellGrid.cursorManager.extendRowSelectionToCursor({
        path: rowsRoot,
        rowId: makeRowId(rowsRoot, "a"),
      }),
    ).toThrow(/row-list interaction/);
    expect(cellGrid.coordinator.getState().rowCursor).toBe(null);
  });

  it("controller startEdit is a no-op in row-list mode", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });

    rt.controllerFor(rowsRoot).startEdit(
      { rowId: makeRowId(rowsRoot, "a"), colId: "name" },
      "f2",
    );

    expect(rt.controllerFor(rowsRoot).getState().editing).toBe(null);
  });

  it("row selection reconciliation preserves identity on no-op normalization", () => {
    const rowSelectionChanged = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
      on: { rowSelectionChanged },
    });
    const selection = {
      kind: "single" as const,
      rowId: makeRowId(rowsRoot, "a"),
    };

    rt.rowInteraction.setRowSelection(rowsRoot, selection);
    rowSelectionChanged.mockClear();
    rt.invalidateDisplayedRows(rowsRoot, { type: "view" });

    expect(rt.controllerFor(rowsRoot).getState().rowSelection).toBe(selection);
    expect(rowSelectionChanged).not.toHaveBeenCalled();
  });

  it("derived row projections preserve identity across unchanged reads", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_PRIMARY_WITH_SIDE_PANEL_ROW,
    });

    expect(rt.selectedRowIds(rowsRoot)).toBe(rt.selectedRowIds(rowsRoot));
    expect(rt.rowInteractionSnapshotFor(rowsRoot)).toBe(
      rt.rowInteractionSnapshotFor(rowsRoot),
    );

    rt.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "a"),
      colId: "name",
    });

    expect(rt.activeRowFor(rowsRoot)).toBe(rt.activeRowFor(rowsRoot));
    expect(rt.selectedRowsFor(rowsRoot)).toBe(rt.selectedRowsFor(rowsRoot));
    expect(rt.selectedRowIds(rowsRoot)).toBe(rt.selectedRowIds(rowsRoot));
    expect(rt.rowInteractionSnapshotFor(rowsRoot)).toBe(
      rt.rowInteractionSnapshotFor(rowsRoot),
    );
  });

  it("row interaction snapshot projects active and selected row chrome", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");
    const c = makeRowId(rowsRoot, "c");

    rt.rowInteraction.setRowCursor({ path: rowsRoot, rowId: a });
    rt.rowInteraction.setRowSelection(rowsRoot, {
      kind: "set",
      rowIds: new Set([a, b]),
    });

    const snapshot = rt.rowInteractionSnapshotFor(rowsRoot);
    expect(snapshot.activeRowId).toBe(a);
    expect(snapshot.selectedRowIds).toEqual([a, b]);
    expect(rowInteractionStatusFor(a, snapshot)).toBe("cursor-selected");
    expect(rowInteractionStatusFor(b, snapshot)).toBe("selected");
    expect(rowInteractionStatusFor(c, snapshot)).toBe("idle");
  });

  it("row operation targets project rows covered by cell selection", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_EDITING_GRID,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");

    rt.cursorManager.setCellRange(
      rowsRoot,
      { rowId: a, colId: "name" },
      { rowId: b, colId: "qty" },
    );

    expect(
      rt.rowOperationTargetsFor(rowsRoot).map((target) => ({
        rowId: target.rowId,
        rowKey: target.rowKey,
      })),
    ).toEqual([
      { rowId: a, rowKey: "a" },
      { rowId: b, rowKey: "b" },
    ]);
  });

  it("row operation targets prefer explicit row selection over cell selection", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");

    rt.cursorManager.setCellRange(
      rowsRoot,
      { rowId: a, colId: "name" },
      { rowId: a, colId: "qty" },
    );
    rt.rowInteraction.setRowSelection(rowsRoot, {
      kind: "single",
      rowId: b,
    });

    expect(
      rt.rowOperationTargetsFor(rowsRoot).map((target) => ({
        rowId: target.rowId,
        rowKey: target.rowKey,
      })),
    ).toEqual([{ rowId: b, rowKey: "b" }]);
  });

  it("collectRowOperationTargets reads all registered paths", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
      interaction: CELL_EDITING_GRID,
    });
    const fruit = makeRowId(reportRoot, "Fruit");
    rt.coordinator.toggleExpand(reportRoot, fruit);
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;

    rt.cursorManager.setCellRange(
      itemsPath,
      { rowId: makeRowId(itemsPath, "Apple"), colId: "name" },
      { rowId: makeRowId(itemsPath, "Banana"), colId: "name" },
    );

    expect(
      collectRowOperationTargets(rt).map((target) => ({
        path: target.path,
        rowKey: target.rowKey,
      })),
    ).toEqual([
      { path: itemsPath, rowKey: "Apple" },
      { path: itemsPath, rowKey: "Banana" },
    ]);
  });

  it("selectedRowsFor preserves selection shape when projected row ids match", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");

    rt.rowInteraction.setRowSelection(rowsRoot, {
      kind: "range",
      anchor: a,
      head: b,
    });

    const selectedRowsChanged = vi.fn();
    const selectedRowIdsChanged = vi.fn();
    const rowInteractionChanged = vi.fn();
    rt.subscribeSelectedRows(rowsRoot, selectedRowsChanged);
    rt.subscribeSelectedRowIds(rowsRoot, selectedRowIdsChanged);
    rt.subscribeRowInteractionSnapshot(rowsRoot, rowInteractionChanged);

    rt.rowInteraction.setRowSelection(rowsRoot, {
      kind: "set",
      rowIds: new Set([a, b]),
    });

    expect(rt.selectedRowsFor(rowsRoot)).toEqual({
      kind: "set",
      rowIds: new Set([a, b]),
    });
    expect(rt.selectedRowIds(rowsRoot)).toEqual([a, b]);
    expect(selectedRowsChanged).toHaveBeenCalledTimes(1);
    expect(selectedRowIdsChanged).not.toHaveBeenCalled();
    expect(rowInteractionChanged).not.toHaveBeenCalled();
  });

  it("selected row id subscribers wake when displayed order changes", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: inMemoryGridDataSource({
        schema: tableSchema,
        tree: tableNodes(),
        levels: {
          rows: {
            sortMode: "client",
            filterMode: "none",
            paginationMode: "none",
          },
        },
      }),
      interaction: ROW_MULTISELECT_LIST,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");
    const selectedRowsChanged = vi.fn();
    const selectedRowIdsChanged = vi.fn();

    rt.rowInteraction.setRowSelection(rowsRoot, {
      kind: "set",
      rowIds: new Set([a, b]),
    });
    expect(rt.selectedRowIds(rowsRoot)).toEqual([a, b]);

    rt.subscribeSelectedRows(rowsRoot, selectedRowsChanged);
    rt.subscribeSelectedRowIds(rowsRoot, selectedRowIdsChanged);

    rt.sourceFor(rowsRoot).setSort([{ colId: "qty", direction: "desc" }]);

    expect(rt.selectedRowsFor(rowsRoot)).toEqual({
      kind: "set",
      rowIds: new Set([a, b]),
    });
    expect(rt.selectedRowIds(rowsRoot)).toEqual([b, a]);
    expect(selectedRowsChanged).not.toHaveBeenCalled();
    expect(selectedRowIdsChanged).toHaveBeenCalledTimes(1);
  });

  it("active row is path-local in cell-grid mode", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
      interaction: CELL_GRID_WITH_ACTIVE_ROW,
    });
    rt.coordinator.toggleExpand(reportRoot, makeRowId(reportRoot, "Fruit"));
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;
    const rootActive = vi.fn();
    const childActive = vi.fn();
    rt.subscribeActiveRow(reportRoot, rootActive);
    rt.subscribeActiveRow(itemsPath, childActive);

    rt.cursorManager.moveCellCursorTo({
      path: reportRoot,
      rowId: makeRowId(reportRoot, "Fruit"),
      colId: "name",
    });
    expect(rootActive).toHaveBeenCalledTimes(1);
    expect(childActive).not.toHaveBeenCalled();

    rt.cursorManager.moveCellCursorTo({
      path: itemsPath,
      rowId: makeRowId(itemsPath, "Apple"),
      colId: "name",
    });
    expect(rootActive).toHaveBeenCalledTimes(2);
    expect(childActive).toHaveBeenCalledTimes(1);
    expect(rt.activeRowFor(reportRoot)).toBe(null);
    expect(rt.activeRowFor(itemsPath)).toEqual({
      path: itemsPath,
      rowId: makeRowId(itemsPath, "Apple"),
    });
  });
});
