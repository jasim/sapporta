import { describe, expect, it, vi } from "vitest";
import { createGridRuntime } from "./create-grid-runtime";
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
  makeRowId,
  rootPath,
  type GridPath,
  type RowKey,
} from "../types/identity";
import type { TreeNode } from "../types/level-row";
import type { ColumnSchema, GridSchema, LevelSchema } from "../types/schema";

const TestEditor = () => null;
const cols: ColumnSchema[] = [
  {
    id: "name",
    name: "Name",
    renderCell: ({ value }) => String(value ?? ""),
    editCell: TestEditor,
  },
  {
    id: "qty",
    name: "Qty",
    renderCell: ({ value }) => String(value ?? ""),
    compare: (a, b) => (Number(a) || 0) - (Number(b) || 0),
    editCell: TestEditor,
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

    expect(() => rt.sourceFor(rowsRoot)).toThrow("GridRuntime has been disposed.");
    expect(() => rt.displayedRowsFor(rowsRoot)).toThrow(
      "GridRuntime has been disposed.",
    );
  });

  it("distinguishes missing child sources from missing root sources", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    const unresolvedChildPath = childPath(reportRoot, "Fruit" as RowKey, "items");

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
    expect("insertNode" in src).toBe(false);
    expect("removeNode" in src).toBe(false);
    expect(src.snapshot().nodes).toHaveLength(2);
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
      insertNode: () => {},
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
    rt.focusManager.setRange(rowsRoot, coord, coord);
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

  it("subscribeDisplayedRowSequence wakes on insert and remove", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const listener = vi.fn();
    const before = rt.displayedRowSequenceFor(rowsRoot);
    rt.subscribeDisplayedRowSequence(rowsRoot, listener);

    rt.insertRow(rowsRoot, {
      levelName: "rows",
      columns: { id: "c", name: "Cherry", qty: 3 },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const afterInsert = rt.displayedRowSequenceFor(rowsRoot);
    expect(afterInsert).not.toBe(before);

    rt.removeRow(rowsRoot, "c");

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

    rt.phantoms.add(rowsRoot, { rowKey: "draft1", columns: { name: "X" } });

    const phantomId = makeRowId(rowsRoot, "phantom:draft1");
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

  it("source emission for one path does not wake row-sequence subscribers for another path", () => {
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

    rt.insertRow(itemsPath, {
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
    rt.phantoms.add(rowsRoot, { rowKey: "draft1", columns: { name: "X" } });
    const displayed = rt.displayedRowsFor(rowsRoot);
    expect(displayed.rows.some((r) => r.kind === "phantom")).toBe(true);
    rt.phantoms.remove(rowsRoot, "draft1");
    const after = rt.displayedRowsFor(rowsRoot);
    expect(after.rows.every((r) => r.kind !== "phantom")).toBe(true);
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

  it("insertRow and removeRow are runtime verbs and emit mutationCommitted", () => {
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
    rt.insertRow(rowsRoot, node);
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

    rt.removeRow(rowsRoot, "b");
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
});
