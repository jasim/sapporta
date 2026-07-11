import { describe, expect, it, vi } from "vitest";
import { createGridRuntime, runtimeInternalsFor } from "./create-grid-runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { inMemoryLevelSource } from "../data-sources/memory/in-memory-level-source";
import { createPhantomChannel } from "../data-sources/phantom-channel";
import type {
  GridDataSource,
  LevelDataSource,
  LevelSnapshot,
  LevelSourceState,
  LevelStatus,
  SourceLoadResult,
  WriteCapability,
} from "../data-sources/types";
import {
  childPath,
  makeLevelRowId,
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
      rowHeaderColumn: "none",
      columns: cols,
      options: {
        allowPhantoms: true,
      },
      childLevels: [],
    },
  },
};

const tableNodes = (): TreeNode[] => [
  {
    rowKey: "a",
    levelName: "rows",
    columns: { id: "a", name: "Apple", qty: 1 },
  },
  {
    rowKey: "b",
    levelName: "rows",
    columns: { id: "b", name: "Banana", qty: 2 },
  },
];

const reportSchema: GridSchema = {
  rootLevel: "cat",
  levels: {
    cat: {
      name: "cat",
      rowHeaderColumn: "none",
      columns: [
        {
          id: "name",
          name: "C",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: {},
      childLevels: ["items"],
    } as LevelSchema,
    items: {
      name: "items",
      rowHeaderColumn: "none",
      columns: [
        {
          id: "name",
          name: "I",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: {},
      childLevels: [],
    } as LevelSchema,
  },
};

const reportTree: TreeNode[] = [
  {
    rowKey: "Fruit",
    levelName: "cat",
    columns: { name: "Fruit" },
    children: {
      items: [
        { rowKey: "Apple", levelName: "items", columns: { name: "Apple" } },
        {
          rowKey: "Banana",
          levelName: "items",
          columns: { name: "Banana" },
        },
      ],
    },
  },
];

const booksSchema: GridSchema = {
  rootLevel: "books",
  levels: {
    books: {
      name: "books",
      rowHeaderColumn: "none",
      columns: [textColumn("title", "Title")],
      options: {
        allowPhantoms: true,
      },
      childLevels: ["quotes"],
    },
    quotes: {
      name: "quotes",
      rowHeaderColumn: "none",
      columns: [textColumn("text", "Quote")],
      options: {
        allowPhantoms: true,
      },
      childLevels: [],
    },
  },
};

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

function readyState(snapshot: LevelSnapshot): LevelSourceState {
  return { status: "ready", snapshot };
}

function unchangedLoadResult(
  state: LevelSourceState = readyState({
    nodes: [],
  }),
): Promise<SourceLoadResult> {
  return Promise.resolve({ kind: "unchanged", state });
}

function stateWithStatus(
  status: LevelStatus,
  snapshot: LevelSnapshot,
): LevelSourceState {
  switch (status) {
    case "ready":
      return { status, snapshot };
    case "initialLoading":
      return { status, snapshot };
    case "refreshing":
      return {
        status,
        snapshot,
        previous: snapshot,
      };
    case "initialError":
      return {
        status,
        snapshot,
        error: new Error("failed"),
      };
    case "refreshError":
      return {
        status,
        snapshot,
        previous: snapshot,
        error: new Error("failed"),
      };
  }
}

type TestLevelSnapshot = LevelSnapshot & { status?: LevelStatus };
type WritableTestSource = LevelDataSource & { write: WriteCapability };

function normalizeTestSnapshot(input: TestLevelSnapshot): {
  status: LevelStatus;
  snapshot: LevelSnapshot;
} {
  const { status = "ready", ...snapshot } = input;
  return { status, snapshot };
}

function writableSourceWithCreate(
  createNode: WriteCapability["createNode"],
  nodes: TreeNode[] = [],
): WritableTestSource {
  return {
    state: () =>
      readyState({
        nodes,
      }),
    subscribe: () => () => {},
    query: {
      sort: { current: () => undefined, set: () => unchangedLoadResult() },
      filter: { current: () => undefined, set: () => unchangedLoadResult() },
      refetch: () => unchangedLoadResult(),
    },
    dispose: () => {},
    write: {
      setCell: () => {},
      applyChanges: () => {},
      createNode,
      removeNode: () => {},
      onReconcile: () => () => {},
      canAppendRow: () => true,
    },
  };
}

function writableSourceFromSnapshot(
  snapshot: LevelSnapshot,
  canAppendRow: () => boolean = () => true,
): WritableTestSource {
  return {
    state: () => readyState(snapshot),
    subscribe: () => () => {},
    query: {
      sort: { current: () => undefined, set: () => unchangedLoadResult() },
      filter: { current: () => undefined, set: () => unchangedLoadResult() },
      refetch: () => unchangedLoadResult(),
    },
    dispose: () => {},
    write: {
      setCell: () => {},
      applyChanges: () => {},
      createNode: async (node, atIndex) => ({
        node,
        atIndex: atIndex ?? snapshot.nodes.length,
      }),
      removeNode: () => {},
      onReconcile: () => () => {},
      canAppendRow,
    },
  };
}

function mutableWritableSource(initialSnapshot: TestLevelSnapshot): {
  source: WritableTestSource;
  publish: (snapshot: TestLevelSnapshot) => void;
  setCanAppendRow: (canAppendRow: () => boolean) => void;
} {
  let current = normalizeTestSnapshot(initialSnapshot);
  let canAppendRow = () => true;
  const subscribers = new Set<() => void>();
  const source: WritableTestSource = {
    state: () => stateWithStatus(current.status, current.snapshot),
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    query: {
      sort: { current: () => undefined, set: () => unchangedLoadResult() },
      filter: { current: () => undefined, set: () => unchangedLoadResult() },
      refetch: () => unchangedLoadResult(),
    },
    dispose: () => {
      subscribers.clear();
    },
    write: {
      setCell: () => {},
      applyChanges: () => {},
      createNode: async (node, atIndex) => ({
        node,
        atIndex: atIndex ?? current.snapshot.nodes.length,
      }),
      removeNode: () => {},
      onReconcile: () => () => {},
      canAppendRow: () => canAppendRow(),
    },
  };
  return {
    source,
    setCanAppendRow: (next) => {
      canAppendRow = next;
    },
    publish: (nextSnapshot) => {
      current = normalizeTestSnapshot(nextSnapshot);
      for (const fn of subscribers) fn();
    },
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

  it("rejects cell-grid row headers without independent row selection", () => {
    const rowHeaderSchema: GridSchema = {
      ...tableSchema,
      levels: {
        rows: {
          ...tableSchema.levels.rows,
          rowHeaderColumn: "empty-selectable-cell",
        },
      },
    };

    expect(() =>
      createGridRuntime({
        schema: rowHeaderSchema,
        dataSource: tableDataSource(),
        interaction: CELL_EDITING_GRID,
      }),
    ).toThrow(/row headers require independent row selection/);

    const runtime = createGridRuntime({
      schema: rowHeaderSchema,
      dataSource: tableDataSource(),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    runtime.dispose();
  });

  it("root displayedRows is identity-stable across no-op calls", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const a = rt.root.displayedRows();
    const b = rt.root.displayedRows();
    expect(a).toBe(b);
  });

  it("root displayedRowSequence is identity-stable across no-op calls", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const a = rt.root.displayedRowSequence();
    const b = rt.root.displayedRowSequence();

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
    const internals = runtimeInternalsFor(rt);
    const c1 = internals.controllerFor(rowsRoot);
    const c2 = internals.controllerFor(rowsRoot);
    expect(c1).toBe(c2);
  });

  it("guards public state reads after disposal", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });

    rt.dispose();
    rt.dispose();

    expect(() => rt.root.data.state()).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => rt.root.displayedRows()).toThrow(
      "GridRuntime has been disposed.",
    );
  });

  it("guards retained source views after disposal", async () => {
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
    });
    const source = rt.root.data;

    rt.dispose();

    expect(() => source.state().snapshot).toThrow(
      "GridRuntime has been disposed.",
    );
    expect(() => source.subscribe(() => {})).toThrow(
      "GridRuntime has been disposed.",
    );
    await expect(
      source.query!.sort!.set([{ colId: "qty", direction: "asc" }]),
    ).rejects.toThrow("GridRuntime has been disposed.");
    expect(() => source.onReconcile(() => {})).toThrow(
      "GridRuntime has been disposed.",
    );
  });

  it("allows retained source-view unsubscribe after disposal", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const source = rt.root.data;
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

    expect(() => rt.level(unresolvedChildPath)).toThrow(
      "Grid level is no longer registered.",
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
    rt.root.writeCell(coord, 99);
    const displayed = rt.root.displayedRows();
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
    const src = rt.root.data;
    expect(src.canWrite).toBe(true);
    expect("setCell" in src).toBe(false);
    expect("applyChanges" in src).toBe(false);
    expect("createNode" in src).toBe(false);
    expect("removeNode" in src).toBe(false);
    expect("dispose" in src).toBe(false);
    expect(src.state().snapshot.nodes).toHaveLength(2);
  });

  it("sourceFor returns a live view for read and query operations", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const source = rt.root.data;

    expect(() => {
      source.state().snapshot;
      source.query?.sort?.set([{ colId: "qty", direction: "desc" }]);
      source.query?.refetch?.();
    }).not.toThrow();
  });

  it("writeCell on a readonly source throws synchronously", () => {
    const readonlyDataSource: GridDataSource = {
      rootSource() {
        const writable = inMemoryLevelSource({
          initialNodes: tableNodes(),
          columns: tableSchema.levels.rows.columns,
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        });
        const readonly: LevelDataSource = {
          state: writable.state,
          subscribe: writable.subscribe,
          query: writable.query,
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
      rt.root.writeCell({ rowId: makeRowId(rowsRoot, "a"), colId: "qty" }, 7),
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
    rt.root.toggleExpand(fruitRow);
    rt.root.toggleExpand(fruitRow); // collapse
    rt.root.toggleExpand(fruitRow); // re-expand
    expect(resolveChild).toHaveBeenCalledTimes(1);
    expect(resolveChild.mock.calls[0]).toEqual([reportRoot, "Fruit", "items"]);
    const itemsPath = childPath(reportRoot, "Fruit", "items");
    const items = rt.level(itemsPath).displayedRows();
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

  it("registeredLevels omits a child until its source is registered", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    const fruitRow = makeRowId(reportRoot, "Fruit");
    expect(rt.registeredLevels().map((level) => level.path)).toEqual([
      reportRoot,
    ]);
    rt.root.toggleExpand(fruitRow);
    expect(rt.registeredLevels().map((level) => level.path)).toEqual([
      reportRoot,
      childPath(reportRoot, "Fruit", "items"),
    ]);
    // Source survives collapse — materialization is "registered", not
    // "currently expanded".
    rt.root.toggleExpand(fruitRow);
    expect(rt.registeredLevels().map((level) => level.path)).toEqual([
      reportRoot,
      childPath(reportRoot, "Fruit", "items"),
    ]);
  });

  it("registeredLevels includes root immediately and is stable until registry changes", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    const first = rt.registeredLevels();
    const second = rt.registeredLevels();

    expect(first.map((level) => level.path)).toEqual([reportRoot]);
    expect(second).toBe(first);

    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    const afterExpand = rt.registeredLevels();
    expect(afterExpand).not.toBe(first);
    expect(afterExpand.map((level) => level.path)).toEqual([
      reportRoot,
      childPath(reportRoot, "Fruit", "items"),
    ]);
    expect(rt.registeredLevels()).toBe(afterExpand);
  });

  it("materializedChildren returns child paths in schema declaration order", () => {
    const multiChildSchema: GridSchema = {
      rootLevel: "cat",
      levels: {
        cat: {
          name: "cat",
          rowHeaderColumn: "none",
          columns: [textColumn("name", "C")],
          options: {},
          childLevels: ["a", "b"],
        } as LevelSchema,
        a: {
          name: "a",
          rowHeaderColumn: "none",
          columns: [textColumn("v", "V")],
          options: {},
          childLevels: [],
        } as LevelSchema,
        b: {
          name: "b",
          rowHeaderColumn: "none",
          columns: [textColumn("v", "V")],
          options: {},
          childLevels: [],
        } as LevelSchema,
      },
    };
    const tree: TreeNode[] = [
      {
        rowKey: "X",
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
    rt.root.toggleExpand(xRow);
    expect(rt.registeredLevels().map((level) => level.path)).toEqual([
      root,
      childPath(root, "X", "a"),
      childPath(root, "X", "b"),
    ]);
  });

  it("notifies subscribeLevels listeners when a child source is resolved", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    let ticks = 0;
    rt.subscribeLevels(() => {
      ticks += 1;
    });
    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    expect(ticks).toBe(1);
    expect(rt.registeredLevels().map((level) => level.path)).toEqual([
      reportRoot,
      childPath(reportRoot, "Fruit", "items"),
    ]);
    // Re-expanding does not re-resolve, so no extra tick.
    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    expect(ticks).toBe(1);
  });

  it("emits cellReconciled when a writable source emits a reconcile event", () => {
    let reconcileFn:
      | ((e: import("../data-sources/types").ReconcileEvent) => void)
      | null = null;
    const fakeWritable: WritableTestSource = {
      state: () =>
        readyState({
          nodes: tableNodes(),
        }),
      subscribe: () => () => {},
      dispose: () => {},
      write: {
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
        canAppendRow: () => true,
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
    let status: import("../data-sources/types").LevelStatus = "initialLoading";
    const subs = new Set<() => void>();
    const fake: LevelDataSource = {
      state: () =>
        stateWithStatus(status, {
          nodes: [],
        }),
      subscribe: (fn) => {
        subs.add(fn);
        return () => {
          subs.delete(fn);
        };
      },
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
    let status: LevelStatus = "initialLoading";
    const nodes = tableNodes();
    const footerRows = [{ rowKey: "total" as RowKey, columns: { qty: 3 } }];
    const subs = new Set<() => void>();
    const fake: LevelDataSource = {
      state: () =>
        stateWithStatus(status, {
          nodes,
          footerRows,
        }),
      subscribe: (fn) => {
        subs.add(fn);
        return () => {
          subs.delete(fn);
        };
      },
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
    const before = rt.root.displayedRows();

    status = "ready";
    for (const fn of subs) fn();

    expect(rt.root.displayedRows()).toBe(before);
  });

  it("dispose tears down sources, controllers, and the data-source", () => {
    const sourceDispose = vi.fn();
    const dataSourceDispose = vi.fn();
    const writable = inMemoryLevelSource({
      initialNodes: tableNodes(),
      columns: tableSchema.levels.rows.columns,
      sortMode: "none",
      filterMode: "none",
      paginationMode: "none",
    });
    const original = writable.dispose;
    const source = {
      ...writable,
      dispose: () => {
        sourceDispose();
        original();
      },
    };
    const dataSource: GridDataSource = {
      rootSource: () => source,
      resolveChild() {
        throw new Error("not used");
      },
      dispose: dataSourceDispose,
    };
    const rt = createGridRuntime({ schema: tableSchema, dataSource });
    runtimeInternalsFor(rt).controllerFor(rowsRoot);
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
    const internals = runtimeInternalsFor(rt);
    const c = internals.controllerFor(rowsRoot);
    const coord = { rowId: makeRowId(rowsRoot, "a"), colId: "qty" };
    internals.cursorManager.setCellRange(rowsRoot, coord, coord);
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

  it("controller commitEdit fans out across a single-column multi-row selection", () => {
    const handler = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: handler },
    });
    const internals = runtimeInternalsFor(rt);
    const c = internals.controllerFor(rowsRoot);
    const aQty = { rowId: makeRowId(rowsRoot, "a"), colId: "qty" };
    const bQty = { rowId: makeRowId(rowsRoot, "b"), colId: "qty" };

    internals.cursorManager.setCellRange(rowsRoot, aQty, bQty);
    c.startEdit(aQty, "f2");
    c.commitEdit(42);

    expect(rt.root.displayedRow(aQty.rowId)?.columns.qty).toBe(42);
    expect(rt.root.displayedRow(bQty.rowId)?.columns.qty).toBe(42);
    expect(rt.root.displayedRow(aQty.rowId)?.columns.name).toBe("Apple");
    expect(handler).toHaveBeenCalledWith({
      kind: "cells",
      path: rowsRoot,
      edits: [
        {
          coord: aQty,
          oldValue: 1,
          newValue: 42,
        },
        {
          coord: bQty,
          oldValue: 2,
          newValue: 42,
        },
      ],
    });
  });

  it("controller commitEdit keeps multi-column selections to one cell", () => {
    const handler = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: handler },
    });
    const internals = runtimeInternalsFor(rt);
    const c = internals.controllerFor(rowsRoot);
    const aName = { rowId: makeRowId(rowsRoot, "a"), colId: "name" };
    const aQty = { rowId: makeRowId(rowsRoot, "a"), colId: "qty" };
    const bQty = { rowId: makeRowId(rowsRoot, "b"), colId: "qty" };

    internals.cursorManager.setCellRange(rowsRoot, aName, bQty);
    c.startEdit(aQty, "f2");
    c.commitEdit(42);

    expect(rt.root.displayedRow(aQty.rowId)?.columns.qty).toBe(42);
    expect(rt.root.displayedRow(bQty.rowId)?.columns.qty).toBe(2);
    expect(handler).toHaveBeenCalledWith({
      kind: "cell",
      path: rowsRoot,
      coord: aQty,
      oldValue: 1,
      newValue: 42,
    });
  });

  it("controller commitEdit without selection keeps the single-cell write", () => {
    const handler = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: handler },
    });
    const c = runtimeInternalsFor(rt).controllerFor(rowsRoot);
    const coord = { rowId: makeRowId(rowsRoot, "a"), colId: "qty" };

    c.startEdit(coord, "f2");
    c.commitEdit(42);

    expect(rt.root.displayedRow(coord.rowId)?.columns.qty).toBe(42);
    expect(rt.root.displayedRow(makeRowId(rowsRoot, "b"))?.columns.qty).toBe(2);
    expect(handler).toHaveBeenCalledWith({
      kind: "cell",
      path: rowsRoot,
      coord,
      oldValue: 1,
      newValue: 42,
    });
  });

  it("controller commitEdit fans out to phantom cells without mutation events for those cells", () => {
    const handler = vi.fn();
    const phantomRowKey = "draft1";
    const phantomRowId = makeLevelRowId(rowsRoot, "phantom", phantomRowKey);
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      phantomRows: {},
      phantoms: createPhantomChannel(
        new Map([
          [
            rowsRoot,
            [phantom(phantomRowKey, { id: "c", name: "", qty: null })],
          ],
        ]),
      ),
      on: { mutationCommitted: handler },
    });
    const internals = runtimeInternalsFor(rt);
    const c = internals.controllerFor(rowsRoot);
    const bQty = { rowId: makeRowId(rowsRoot, "b"), colId: "qty" };
    const phantomQty = { rowId: phantomRowId, colId: "qty" };

    internals.cursorManager.setCellRange(rowsRoot, bQty, phantomQty);
    c.startEdit(bQty, "f2");
    c.commitEdit(42);

    expect(rt.root.displayedRow(makeRowId(rowsRoot, "a"))?.columns.qty).toBe(1);
    expect(rt.root.displayedRow(bQty.rowId)?.columns.qty).toBe(42);
    expect(rt.root.displayedRow(phantomRowId)?.columns.qty).toBe(42);
    expect(handler).toHaveBeenCalledWith({
      kind: "cells",
      path: rowsRoot,
      edits: [
        {
          coord: bQty,
          oldValue: 2,
          newValue: 42,
        },
      ],
    });
  });

  it("subscribeDisplayedRowSequence wakes on create and remove", async () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const listener = vi.fn();
    const before = rt.root.displayedRowSequence();
    rt.root.subscribeDisplayedRowSequence(listener);

    await rt.root.createRow({
      rowKey: "c",
      levelName: "rows",
      columns: { id: "c", name: "Cherry", qty: 3 },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const afterInsert = rt.root.displayedRowSequence();
    expect(afterInsert).not.toBe(before);

    await rt.root.removeRow("c");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(rt.root.displayedRowSequence()).not.toBe(afterInsert);
  });

  it("subscribeDisplayedRow wakes on a single-cell edit without waking the row sequence", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
    });
    const sequence = vi.fn();
    const row = vi.fn();
    const before = rt.root.displayedRowSequence();
    rt.root.subscribeDisplayedRowSequence(sequence);
    rt.root.subscribeDisplayedRow(makeRowId(rowsRoot, "a"), row);

    rt.root.writeCell({ rowId: makeRowId(rowsRoot, "a"), colId: "qty" }, 99);

    expect(sequence).not.toHaveBeenCalled();
    expect(rt.root.displayedRowSequence()).toBe(before);
    expect(row).toHaveBeenCalledTimes(1);
    expect(rt.root.displayedRow(makeRowId(rowsRoot, "a"))?.columns.qty).toBe(
      99,
    );
  });

  it("phantom changes notify row sequence and phantom row subscribers precisely", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      phantomRows: {},
    });
    const sequence = vi.fn();
    const before = rt.root.displayedRowSequence();
    rt.root.subscribeDisplayedRowSequence(sequence);

    rt.root.drafts.add("draft1", { name: "X" });

    const phantomId = makeLevelRowId(rowsRoot, "phantom", "draft1");
    const afterAdd = rt.root.displayedRowSequence();
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(afterAdd).not.toBe(before);
    expect(rt.root.displayedRow(phantomId)?.kind).toBe("phantom");

    const phantomRow = vi.fn();
    rt.root.subscribeDisplayedRow(phantomId, phantomRow);
    rt.root.drafts.setCell("draft1", "name", "Y");

    expect(sequence).toHaveBeenCalledTimes(1);
    expect(rt.root.displayedRowSequence()).toBe(afterAdd);
    expect(phantomRow).toHaveBeenCalledTimes(1);

    rt.root.drafts.remove("draft1");
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(rt.root.displayedRowSequence()).not.toBe(afterAdd);
    expect(phantomRow).toHaveBeenCalledTimes(2);
  });

  it("source emission for one path does not wake row-sequence subscribers for another path", async () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;
    const rootList = vi.fn();
    const childList = vi.fn();
    rt.root.subscribeDisplayedRowSequence(rootList);
    rt.level(itemsPath).subscribeDisplayedRowSequence(childList);

    await rt.level(itemsPath).createRow({
      rowKey: "Cherry",
      levelName: "items",
      columns: { name: "Cherry" },
    });

    expect(rootList).not.toHaveBeenCalled();
    expect(childList).toHaveBeenCalledTimes(1);
  });

  it("drafts exposed through the root level reach the displayed rows", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      phantomRows: {},
    });
    rt.root.drafts.add("draft1", { name: "X" });
    const displayed = rt.root.displayedRows();
    expect(displayed.rows.some((r) => r.kind === "phantom")).toBe(true);
    rt.root.drafts.remove("draft1");
    const after = rt.root.displayedRows();
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

    expect(rt.root.drafts.get()).toHaveLength(0);
    expect(rt.root.displayedRows().rows).toEqual([]);
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
    const phantoms = rt.root.drafts.get();
    expect(phantoms).toHaveLength(1);
    expect(phantoms[0].state).toEqual({ kind: "editing" });
    expect(rt.root.displayedRows().rows.map((row) => row.kind)).toEqual([
      "phantom",
    ]);
  });

  it("editing a phantom row stays local and does not emit mutationCommitted", () => {
    const setCell = vi.fn();
    const mutationCommitted = vi.fn();
    const source: WritableTestSource = {
      state: () =>
        readyState({
          nodes: [],
        }),
      subscribe: () => () => {},
      dispose: () => {},
      write: {
        setCell,
        applyChanges: () => {},
        createNode: async (node, atIndex) => ({
          node,
          atIndex: atIndex ?? 0,
        }),
        removeNode: () => {},
        onReconcile: () => () => {},
        canAppendRow: () => true,
      },
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

    const phantomRow = rt.root.drafts.get()[0];
    rt.root.writeCell(
      {
        rowId: makeLevelRowId(rowsRoot, "phantom", phantomRow.rowKey),
        colId: "name",
      },
      "New row",
    );

    expect(setCell).not.toHaveBeenCalled();
    expect(mutationCommitted).not.toHaveBeenCalled();
    expect(rt.root.drafts.get()[0].columns.name).toBe("New row");
  });

  it("ArrowDown at the last row creates or reuses one blank phantom", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      phantomRows: {},
    });
    const internals = runtimeInternalsFor(rt);
    const lastDataCursor = {
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "b"),
      colId: "qty",
    };
    internals.cursorManager.moveCellCursorTo(lastDataCursor);

    internals.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    const firstTarget = internals.cursorManager.currentCellCursor();
    expect(firstTarget).not.toBeNull();
    expect(rt.root.displayedRow(firstTarget!.rowId)?.kind).toBe("phantom");
    expect(rt.root.drafts.get()).toHaveLength(1);

    internals.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.root.drafts.get()).toHaveLength(1);
    expect(internals.cursorManager.currentCellCursor()).toEqual(firstTarget);
  });

  it("ArrowDown at a non-final page boundary does not create a phantom", () => {
    const source = writableSourceFromSnapshot(
      {
        nodes: tableNodes(),
      },
      () => false,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(source),
      phantomRows: {},
    });
    const internals = runtimeInternalsFor(rt);
    const lastPageRowCursor = {
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "b"),
      colId: "qty",
    };
    internals.cursorManager.moveCellCursorTo(lastPageRowCursor);

    internals.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });

    expect(rt.root.drafts.get()).toHaveLength(0);
    expect(internals.cursorManager.currentCellCursor()).toEqual(
      lastPageRowCursor,
    );
  });

  it("ArrowDown before a footer requests a loaded-row boundary instead of creating a phantom", () => {
    const source = writableSourceFromSnapshot(
      {
        nodes: [
          {
            rowKey: "b",
            levelName: "rows",
            columns: { id: "b", name: "Banana", qty: 2 },
          },
        ],
        footerRows: [{ rowKey: "total", columns: { qty: 2 } }],
      },
      () => false,
    );
    const onLoadedRowsBoundary = vi.fn(() =>
      unchangedLoadResult(source.state()),
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(source),
      phantomRows: {},
      onLoadedRowsBoundary,
    });
    const internals = runtimeInternalsFor(rt);
    const lastDataCursor = {
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "b"),
      colId: "qty",
    };
    internals.cursorManager.moveCellCursorTo(lastDataCursor);

    internals.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });

    expect(rt.root.drafts.get()).toHaveLength(0);
    expect(onLoadedRowsBoundary).toHaveBeenCalledWith({
      kind: "cell",
      loadPath: rowsRoot,
      direction: "after",
      origin: lastDataCursor,
      colPolicy: "preserve",
      extend: false,
    });
    expect(internals.cursorManager.currentCellCursor()).toEqual(lastDataCursor);
  });

  it("requestLoadedRowsBoundary returns false while the source snapshot is loading", () => {
    const mutable = mutableWritableSource({
      status: "initialLoading",
      nodes: tableNodes(),
    });
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(mutable.source),
    });

    const accepted = runtimeInternalsFor(rt).requestLoadedRowsBoundary({
      kind: "cell",
      loadPath: rowsRoot,
      direction: "after",
      origin: {
        path: rowsRoot,
        rowId: makeRowId(rowsRoot, "b"),
        colId: "name",
      },
      colPolicy: "preserve",
      extend: false,
    });

    expect(accepted).toBe(false);
  });

  it("does not record pending loaded-row boundary navigation while loading", () => {
    const mutable = mutableWritableSource({
      status: "initialLoading",
      nodes: tableNodes(),
    });
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(mutable.source),
    });

    expect(
      runtimeInternalsFor(rt).requestLoadedRowsBoundary({
        kind: "cell",
        loadPath: rowsRoot,
        direction: "after",
        origin: {
          path: rowsRoot,
          rowId: makeRowId(rowsRoot, "b"),
          colId: "name",
        },
        colPolicy: "preserve",
        extend: false,
      }),
    ).toBe(false);

    mutable.publish({
      nodes: [
        {
          rowKey: "c",
          levelName: "rows",
          columns: { id: "c", name: "Cherry", qty: 3 },
        },
      ],
    });

    expect(
      runtimeInternalsFor(rt).cursorManager.currentCellCursor(),
    ).toBeNull();
  });

  it("returns false when the host loaded-row boundary hook declines", () => {
    const mutable = mutableWritableSource({
      nodes: [
        {
          rowKey: "b",
          levelName: "rows",
          columns: { id: "b", name: "Banana", qty: 2 },
        },
      ],
    });
    const onLoadedRowsBoundary = vi.fn(() => false as const);
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(mutable.source),
      onLoadedRowsBoundary,
    });

    const accepted = runtimeInternalsFor(rt).requestLoadedRowsBoundary({
      kind: "cell",
      loadPath: rowsRoot,
      direction: "before",
      origin: { path: rowsRoot, rowId: makeRowId(rowsRoot, "b"), colId: "qty" },
      colPolicy: "preserve",
      extend: false,
    });

    expect(accepted).toBe(false);
    expect(onLoadedRowsBoundary).toHaveBeenCalledOnce();
  });

  it("ready loaded-row boundary navigation records and resolves focus after host load", async () => {
    const mutable = mutableWritableSource({
      nodes: [
        {
          rowKey: "b",
          levelName: "rows",
          columns: { id: "b", name: "Banana", qty: 2 },
        },
      ],
    });
    const onLoadedRowsBoundary = vi.fn(async () => {
      mutable.publish({
        nodes: [
          {
            rowKey: "c",
            levelName: "rows",
            columns: { id: "c", name: "Cherry", qty: 3 },
          },
        ],
      });
      const state = mutable.source.state();
      if (state.status !== "ready") throw new Error("expected ready");
      return { kind: "ready" as const, state };
    });
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(mutable.source),
      onLoadedRowsBoundary,
    });

    expect(
      runtimeInternalsFor(rt).requestLoadedRowsBoundary({
        kind: "cell",
        loadPath: rowsRoot,
        direction: "after",
        origin: {
          path: rowsRoot,
          rowId: makeRowId(rowsRoot, "b"),
          colId: "qty",
        },
        colPolicy: "preserve",
        extend: false,
      }),
    ).toBe(true);
    await flushMicrotasks();

    expect(runtimeInternalsFor(rt).cursorManager.currentCellCursor()).toEqual({
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "c"),
      colId: "qty",
    });
  });

  it("ArrowDown at the final datasource row of a paginated source creates a phantom", () => {
    const source = writableSourceFromSnapshot({
      nodes: [
        {
          rowKey: "c",
          levelName: "rows",
          columns: { id: "c", name: "Cherry", qty: 3 },
        },
      ],
    });
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(source),
      phantomRows: {},
    });
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "c"),
      colId: "qty",
    });

    internals.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });

    expect(rt.root.drafts.get()).toHaveLength(1);
    const target = internals.cursorManager.currentCellCursor();
    expect(target).not.toBeNull();
    expect(rt.root.displayedRow(target!.rowId)?.kind).toBe("phantom");
  });

  it("does not eagerly create an empty-path phantom for an empty non-final page", () => {
    const source = writableSourceFromSnapshot({ nodes: [] }, () => false);
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(source),
      phantomRows: {},
    });

    expect(rt.root.drafts.get()).toHaveLength(0);
    expect(rt.root.displayedRows().rows).toHaveLength(0);
  });

  it("creates an empty-path phantom on the first page when total count is unknown", () => {
    const source = writableSourceFromSnapshot({
      nodes: [],
    });

    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(source),
      phantomRows: {},
    });

    expect(rt.root.drafts.get()).toHaveLength(1);
    expect(rt.root.displayedRows().rows.map((row) => row.kind)).toEqual([
      "phantom",
    ]);
  });

  it("removes a blank append phantom when the source leaves the append boundary", () => {
    const source = mutableWritableSource({
      nodes: [
        {
          rowKey: "c",
          levelName: "rows",
          columns: { id: "c", name: "Cherry", qty: 3 },
        },
      ],
    });
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(source.source),
      phantomRows: {},
    });
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "c"),
      colId: "qty",
    });
    internals.coordinator.navigateCell(rowsRoot, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.root.drafts.get()).toHaveLength(1);

    source.setCanAppendRow(() => false);
    source.publish({
      nodes: tableNodes(),
    });

    expect(rt.root.drafts.get()).toHaveLength(0);
    expect(
      rt.root.displayedRows().rows.some((row) => row.kind === "phantom"),
    ).toBe(false);
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
    const internals = runtimeInternalsFor(rt);
    const phantomRow = rt.root.drafts.get()[0];
    const rowId = makeLevelRowId(rowsRoot, "phantom", phantomRow.rowKey);
    internals.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId,
      colId: "name",
    });
    rt.root.writeCell({ rowId, colId: "id" }, "c");
    rt.root.writeCell({ rowId, colId: "name" }, "Cherry");

    internals.cursorManager.clearCellCursor();
    await flushMicrotasks();

    expect(rt.root.drafts.get()).toHaveLength(0);
    expect(
      rt.root.data.state().snapshot.nodes.map((node) => node.columns.id),
    ).toEqual(["c"]);
    expect(mutationCommitted).toHaveBeenCalledTimes(1);
    expect(phantomRowCommitted).toHaveBeenCalledTimes(1);
  });

  it("leaving a nonblank child-level phantom row creates one child row", async () => {
    const booksRoot = rootPath("books");
    const quotesPath = childPath(booksRoot, "book-1", "quotes");
    const createQuoteNode = vi.fn<WriteCapability["createNode"]>(
      async (node, atIndex) => ({
        node: {
          rowKey: "quote-3",
          levelName: "quotes",
          columns: { id: "quote-3", ...node.columns },
        },
        atIndex: atIndex ?? 2,
      }),
    );
    const phantomRowCommitted = vi.fn();
    const rt = createGridRuntime({
      schema: booksSchema,
      dataSource: {
        rootSource: () =>
          writableSourceWithCreate(vi.fn(), [
            {
              rowKey: "book-1",
              levelName: "books",
              columns: { id: "book-1", title: "Dune" },
            },
          ]),
        resolveChild: (parentPath, parentRowKey, childLevelName) => {
          expect(parentPath).toBe(booksRoot);
          expect(parentRowKey).toBe("book-1");
          expect(childLevelName).toBe("quotes");
          return writableSourceWithCreate(createQuoteNode, [
            {
              rowKey: "quote-1",
              levelName: "quotes",
              columns: { id: "quote-1", text: "Fear is the mind-killer." },
            },
            {
              rowKey: "quote-2",
              levelName: "quotes",
              columns: { id: "quote-2", text: "The sleeper must awaken." },
            },
          ]);
        },
        dispose: () => {},
      },
      phantomRows: {},
      on: { phantomRowCommitted },
    });
    rt.root.toggleExpand(makeRowId(booksRoot, "book-1"));
    const internals = runtimeInternalsFor(rt);
    const quotes = rt.level(quotesPath);

    internals.cursorManager.moveCellCursorTo({
      path: quotesPath,
      rowId: makeRowId(quotesPath, "quote-2"),
      colId: "text",
    });
    internals.coordinator.navigateCell(quotesPath, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });

    expect(rt.root.drafts.get()).toHaveLength(0);
    const quotePhantoms = quotes.drafts.get();
    expect(quotePhantoms).toHaveLength(1);
    const phantomRow = quotePhantoms[0];
    const phantomRowId = makeLevelRowId(
      quotesPath,
      "phantom",
      phantomRow.rowKey,
    );
    expect(internals.cursorManager.currentCellCursor()).toEqual({
      path: quotesPath,
      rowId: phantomRowId,
      colId: "text",
    });
    expect(quotes.displayedRow(phantomRowId)?.kind).toBe("phantom");

    quotes.writeCell(
      { rowId: phantomRowId, colId: "text" },
      "The mystery of life isn't a problem to solve.",
    );
    expect(createQuoteNode).not.toHaveBeenCalled();

    internals.cursorManager.clearCellCursor();
    await flushMicrotasks();

    expect(createQuoteNode).toHaveBeenCalledTimes(1);
    expect(createQuoteNode).toHaveBeenCalledWith(
      {
        rowKey: phantomRow.rowKey,
        levelName: "quotes",
        columns: { text: "The mystery of life isn't a problem to solve." },
      },
      undefined,
    );
    expect(quotes.drafts.get()).toHaveLength(0);
    expect(phantomRowCommitted).toHaveBeenCalledWith({
      path: quotesPath,
      rowKey: phantomRow.rowKey,
      node: {
        rowKey: "quote-3",
        levelName: "quotes",
        columns: {
          id: "quote-3",
          text: "The mystery of life isn't a problem to solve.",
        },
      },
      atIndex: 2,
    });
  });

  it("double commitPhantomRow reuses the pending create", async () => {
    const created = deferred<{
      node: TreeNode;
      atIndex: number;
    }>();
    const createNode = vi.fn<WriteCapability["createNode"]>(
      () => created.promise,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(writableSourceWithCreate(createNode)),
      phantomRows: {},
    });
    rt.root.drafts.add("draft1", { id: "c", name: "Cherry" });

    const first = rt.root.drafts.commit("draft1");
    const second = rt.root.drafts.commit("draft1");

    expect(second).toBe(first);
    expect(createNode).toHaveBeenCalledTimes(1);

    const serverNode: TreeNode = {
      rowKey: "c",
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
    const createNode = vi.fn<WriteCapability["createNode"]>(
      () => created.promise,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(writableSourceWithCreate(createNode)),
      phantomRows: {},
    });
    const internals = runtimeInternalsFor(rt);
    const phantomRow = rt.root.drafts.get()[0];
    const rowId = makeLevelRowId(rowsRoot, "phantom", phantomRow.rowKey);
    internals.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId,
      colId: "name",
    });
    rt.root.writeCell({ rowId, colId: "id" }, "c");

    internals.cursorManager.clearCellCursor();
    const direct = rt.root.drafts.commit(phantomRow.rowKey);

    expect(createNode).toHaveBeenCalledTimes(1);
    created.resolve({
      node: { rowKey: "c", levelName: "rows", columns: { id: "c" } },
      atIndex: 0,
    });
    await expect(direct).resolves.toEqual({
      node: { rowKey: "c", levelName: "rows", columns: { id: "c" } },
      atIndex: 0,
    });
  });

  it("committing a phantom snapshots columns and rejects edits while saving", async () => {
    const created = deferred<{
      node: TreeNode;
      atIndex: number;
    }>();
    const createNode = vi.fn<WriteCapability["createNode"]>(
      () => created.promise,
    );
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: dataSourceWithRoot(writableSourceWithCreate(createNode)),
      phantomRows: {},
    });
    rt.root.drafts.add("draft1", { id: "c", name: "Cherry" });
    const rowId = makeLevelRowId(rowsRoot, "phantom", "draft1");

    const promise = rt.root.drafts.commit("draft1");

    expect(() =>
      rt.root.writeCell({ rowId, colId: "name" }, "Changed"),
    ).toThrow(/is saving and cannot be edited/);
    expect(
      rt.root.drafts.get().find((draft) => draft.rowKey === "draft1")?.columns
        .name,
    ).toBe("Cherry");
    expect(createNode).toHaveBeenCalledWith(
      {
        rowKey: "draft1",
        levelName: "rows",
        columns: { id: "c", name: "Cherry" },
      },
      undefined,
    );

    expect(() =>
      rt.root.drafts.setCell("draft1", "name", "Direct channel edit"),
    ).toThrow(/is saving and cannot be edited/);
    created.resolve({
      node: {
        rowKey: "c",
        levelName: "rows",
        columns: { id: "c", name: "Cherry" },
      },
      atIndex: 0,
    });
    await promise;
    expect(createNode.mock.calls[0][0].columns.name).toBe("Cherry");
  });

  it("failed phantom row creates keep the phantom with failure state", async () => {
    const createFailed = vi.fn();
    const source: WritableTestSource = {
      state: () =>
        readyState({
          nodes: [],
        }),
      subscribe: () => () => {},
      dispose: () => {},
      write: {
        setCell: () => {},
        applyChanges: () => {},
        createNode: async () => {
          throw new Error("validation failed");
        },
        removeNode: () => {},
        onReconcile: () => () => {},
        canAppendRow: () => true,
      },
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
    const internals = runtimeInternalsFor(rt);
    const phantomRow = rt.root.drafts.get()[0];
    const rowId = makeLevelRowId(rowsRoot, "phantom", phantomRow.rowKey);
    internals.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId,
      colId: "name",
    });
    rt.root.writeCell({ rowId, colId: "name" }, "Cherry");

    internals.cursorManager.clearCellCursor();
    await flushMicrotasks();

    expect(rt.root.drafts.get()).toHaveLength(1);
    expect(rt.root.drafts.get()[0].state).toEqual({
      kind: "failed",
      reason: "validation failed",
    });
    expect(createFailed).toHaveBeenCalledWith({
      path: rowsRoot,
      rowKey: phantomRow.rowKey,
      reason: "validation failed",
    });

    rt.root.writeCell({ rowId, colId: "name" }, "Cherry retry");
    expect(rt.root.drafts.get()[0].state).toEqual({ kind: "editing" });
    expect(rt.root.drafts.get()[0].columns.name).toBe("Cherry retry");
  });

  it("setCell on a different path does not invalidate sibling pipelines", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
    });
    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;
    const beforeChild = rt.level(itemsPath).displayedRows();
    rt.root.writeCell(
      { rowId: makeRowId(reportRoot, "Fruit"), colId: "name" },
      "Fruit!",
    );
    expect(rt.level(itemsPath).displayedRows()).toBe(beforeChild);
  });

  it("createRow and removeRow are runtime verbs and emit mutationCommitted", async () => {
    const mutation = vi.fn();
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      on: { mutationCommitted: mutation },
    });
    const node: TreeNode = {
      rowKey: "c",
      levelName: "rows",
      columns: { id: "c", name: "Cherry", qty: 3 },
    };
    await rt.root.createRow(node);
    expect(
      rt.root.data.state().snapshot.nodes.map((n) => n.columns.id),
    ).toEqual(["a", "b", "c"]);
    expect(mutation).toHaveBeenLastCalledWith({
      kind: "insert",
      path: rowsRoot,
      node,
      atIndex: 2,
    });

    await rt.root.removeRow("b");
    expect(
      rt.root.data.state().snapshot.nodes.map((n) => n.columns.id),
    ).toEqual(["a", "c"]);
    expect(mutation).toHaveBeenLastCalledWith({
      kind: "remove",
      path: rowsRoot,
      node: {
        rowKey: "b",
        levelName: "rows",
        columns: { id: "b", name: "Banana", qty: 2 },
      },
      atIndex: 1,
    });
  });

  it("plans and applies cursor continuation before a row removal", async () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    const b = makeRowId(rowsRoot, "b");
    const c = makeRowId(rowsRoot, "c");
    await rt.root.createRow({
      rowKey: "c",
      levelName: "rows",
      columns: { id: "c", name: "Cherry", qty: 3 },
    });
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId: b,
      colId: "qty",
    });
    internals.controllerFor(rowsRoot).flushEffects();

    const continuation = internals.planCursorContinuationForRowRemoval([
      { path: rowsRoot, rowId: b },
    ]);
    expect(continuation).toEqual({
      kind: "cell",
      target: { path: rowsRoot, rowId: c, colId: "qty" },
    });

    internals.applyCursorContinuation(continuation);

    expect(internals.cursorManager.currentCellCursor()).toEqual({
      path: rowsRoot,
      rowId: c,
      colId: "qty",
    });
    expect(
      internals
        .controllerFor(rowsRoot)
        .effects.getState()
        .map((effect) => effect.type),
    ).toEqual(["focusContainer", "scrollFocusIntoView"]);

    await rt.root.removeRow("b");
    expect(internals.cursorManager.currentCellCursor()?.rowId).toBe(c);
  });

  it("records the latest selection gesture lead and clears it with selection", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");

    const internals = runtimeInternalsFor(rt);
    rt.root.selectRow(a);
    expect(internals.coordinator.getState().rowSelectionLead).toEqual({
      path: rowsRoot,
      rowId: a,
    });

    rt.root.extendRowSelectionTo(b);
    expect(internals.coordinator.getState().rowSelectionLead).toEqual({
      path: rowsRoot,
      rowId: b,
    });

    rt.root.clearRowSelection();
    expect(internals.coordinator.getState().rowSelectionLead).toBe(null);
  });

  it("skips an expanded child subtree when its parent row is removed", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: inMemoryGridDataSource({
        schema: reportSchema,
        tree: [
          ...reportTree,
          { rowKey: "Veg", levelName: "cat", columns: { name: "Veg" } },
        ],
        levels: {
          cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
          items: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
        },
      }),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    const fruit = makeRowId(reportRoot, "Fruit");
    const itemsPath = childPath(reportRoot, "Fruit", "items");
    rt.root.toggleExpand(fruit);
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveCellCursorTo({
      path: itemsPath,
      rowId: makeRowId(itemsPath, "Apple"),
      colId: "name",
    });

    expect(
      internals.planCursorContinuationForRowRemoval([
        { path: reportRoot, rowId: fruit },
      ]),
    ).toEqual({
      kind: "cell",
      target: {
        path: reportRoot,
        rowId: makeRowId(reportRoot, "Veg"),
        colId: "name",
      },
    });
  });

  it("cursorManager rejects cursor commands from the wrong interaction mode", () => {
    const rowList = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });
    expect(() =>
      runtimeInternalsFor(rowList).cursorManager.moveCellCursorTo({
        path: rowsRoot,
        rowId: makeRowId(rowsRoot, "a"),
        colId: "name",
      }),
    ).toThrow(/cell-grid interaction/);
    expect(runtimeInternalsFor(rowList).coordinator.getState().cellCursor).toBe(
      null,
    );

    const cellGrid = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_GRID_WITH_ACTIVE_ROW,
    });
    expect(() =>
      runtimeInternalsFor(cellGrid).cursorManager.extendRowSelectionToCursor({
        path: rowsRoot,
        rowId: makeRowId(rowsRoot, "a"),
      }),
    ).toThrow(/row-list interaction/);
    expect(runtimeInternalsFor(cellGrid).coordinator.getState().rowCursor).toBe(
      null,
    );
  });

  it("controller startEdit is a no-op in row-list mode", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });

    const controller = runtimeInternalsFor(rt).controllerFor(rowsRoot);
    controller.startEdit(
      { rowId: makeRowId(rowsRoot, "a"), colId: "name" },
      "f2",
    );

    expect(controller.getState().editing).toBe(null);
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

    rt.root.setRowSelection(selection);
    rowSelectionChanged.mockClear();
    const internals = runtimeInternalsFor(rt);
    internals.invalidateDisplayedRows(rowsRoot, { type: "view" });

    expect(internals.controllerFor(rowsRoot).getState().rowSelection).toBe(
      selection,
    );
    expect(rowSelectionChanged).not.toHaveBeenCalled();
  });

  it("derived row projections preserve identity across unchanged reads", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: CELL_PRIMARY_WITH_SIDE_PANEL_ROW,
    });

    expect(rt.root.selectedRowIds()).toBe(rt.root.selectedRowIds());
    expect(rt.root.rowInteractionSnapshot()).toBe(
      rt.root.rowInteractionSnapshot(),
    );

    runtimeInternalsFor(rt).cursorManager.moveCellCursorTo({
      path: rowsRoot,
      rowId: makeRowId(rowsRoot, "a"),
      colId: "name",
    });

    expect(rt.root.activeRow()).toBe(rt.root.activeRow());
    expect(rt.root.selectedRows()).toBe(rt.root.selectedRows());
    expect(rt.root.selectedRowIds()).toBe(rt.root.selectedRowIds());
    expect(rt.root.rowInteractionSnapshot()).toBe(
      rt.root.rowInteractionSnapshot(),
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

    runtimeInternalsFor(rt).rowInteraction.setRowCursor({
      path: rowsRoot,
      rowId: a,
    });
    rt.root.setRowSelection({
      kind: "set",
      rowIds: new Set([a, b]),
    });

    const snapshot = rt.root.rowInteractionSnapshot();
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

    runtimeInternalsFor(rt).cursorManager.setCellRange(
      rowsRoot,
      { rowId: a, colId: "name" },
      { rowId: b, colId: "qty" },
    );

    expect(
      rt.rowOperations.targets().map((target) => ({
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

    runtimeInternalsFor(rt).cursorManager.setCellRange(
      rowsRoot,
      { rowId: a, colId: "name" },
      { rowId: a, colId: "qty" },
    );
    rt.root.setRowSelection({
      kind: "single",
      rowId: b,
    });

    expect(
      rt.rowOperations.targets().map((target) => ({
        rowId: target.rowId,
        rowKey: target.rowKey,
      })),
    ).toEqual([{ rowId: b, rowKey: "b" }]);
  });

  it("rowOperations.targets reads all registered levels", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
      interaction: CELL_EDITING_GRID,
    });
    const fruit = makeRowId(reportRoot, "Fruit");
    rt.root.toggleExpand(fruit);
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;

    runtimeInternalsFor(rt).cursorManager.setCellRange(
      itemsPath,
      { rowId: makeRowId(itemsPath, "Apple"), colId: "name" },
      { rowId: makeRowId(itemsPath, "Banana"), colId: "name" },
    );

    expect(
      rt.rowOperations.targets().map((target) => ({
        path: target.path,
        rowKey: target.rowKey,
      })),
    ).toEqual([
      { path: itemsPath, rowKey: "Apple" },
      { path: itemsPath, rowKey: "Banana" },
    ]);
  });

  it("selectedRows preserves selection shape when projected row ids match", () => {
    const rt = createGridRuntime({
      schema: tableSchema,
      dataSource: tableDataSource(),
      interaction: ROW_MULTISELECT_LIST,
    });
    const a = makeRowId(rowsRoot, "a");
    const b = makeRowId(rowsRoot, "b");

    rt.root.setRowSelection({
      kind: "range",
      anchor: a,
      head: b,
    });

    const selectedRowsChanged = vi.fn();
    const selectedRowIdsChanged = vi.fn();
    const rowInteractionChanged = vi.fn();
    rt.root.subscribeSelectedRows(selectedRowsChanged);
    rt.root.subscribeSelectedRowIds(selectedRowIdsChanged);
    rt.root.subscribeRowInteractionSnapshot(rowInteractionChanged);

    rt.root.setRowSelection({
      kind: "set",
      rowIds: new Set([a, b]),
    });

    expect(rt.root.selectedRows()).toEqual({
      kind: "set",
      rowIds: new Set([a, b]),
    });
    expect(rt.root.selectedRowIds()).toEqual([a, b]);
    expect(selectedRowsChanged).toHaveBeenCalledTimes(1);
    expect(selectedRowIdsChanged).not.toHaveBeenCalled();
    expect(rowInteractionChanged).not.toHaveBeenCalled();
  });

  it("selected row id subscribers wake when displayed order changes", async () => {
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

    rt.root.setRowSelection({
      kind: "set",
      rowIds: new Set([a, b]),
    });
    expect(rt.root.selectedRowIds()).toEqual([a, b]);

    rt.root.subscribeSelectedRows(selectedRowsChanged);
    rt.root.subscribeSelectedRowIds(selectedRowIdsChanged);

    await rt.root.data.query!.sort!.set([{ colId: "qty", direction: "desc" }]);

    expect(rt.root.selectedRows()).toEqual({
      kind: "set",
      rowIds: new Set([a, b]),
    });
    expect(rt.root.selectedRowIds()).toEqual([b, a]);
    expect(selectedRowsChanged).not.toHaveBeenCalled();
    expect(selectedRowIdsChanged).toHaveBeenCalledTimes(1);
  });

  it("active row is path-local in cell-grid mode", () => {
    const rt = createGridRuntime({
      schema: reportSchema,
      dataSource: reportDataSource(),
      interaction: CELL_GRID_WITH_ACTIVE_ROW,
    });
    rt.root.toggleExpand(makeRowId(reportRoot, "Fruit"));
    const itemsPath = childPath(reportRoot, "Fruit", "items") as GridPath;
    const rootActive = vi.fn();
    const childActive = vi.fn();
    rt.root.subscribeActiveRow(rootActive);
    rt.level(itemsPath).subscribeActiveRow(childActive);

    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveCellCursorTo({
      path: reportRoot,
      rowId: makeRowId(reportRoot, "Fruit"),
      colId: "name",
    });
    expect(rootActive).toHaveBeenCalledTimes(1);
    expect(childActive).not.toHaveBeenCalled();

    internals.cursorManager.moveCellCursorTo({
      path: itemsPath,
      rowId: makeRowId(itemsPath, "Apple"),
      colId: "name",
    });
    expect(rootActive).toHaveBeenCalledTimes(2);
    expect(childActive).toHaveBeenCalledTimes(1);
    expect(rt.root.activeRow()).toBe(null);
    expect(rt.level(itemsPath).activeRow()).toEqual({
      path: itemsPath,
      rowId: makeRowId(itemsPath, "Apple"),
    });
  });
});
