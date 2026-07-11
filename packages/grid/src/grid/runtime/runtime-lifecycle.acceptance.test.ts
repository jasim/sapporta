import { describe, expect, it, vi } from "vitest";
import { controllerFor } from "../advanced";
import type {
  GridDataSource,
  CreateNodeResult,
  LevelDataSource,
  LevelSourceState,
  PhantomChannel,
  SourceLoadResult,
  WriteCapability,
} from "../data-sources/types";
import { createPhantomChannel } from "../data-sources/phantom-channel";
import {
  childPath,
  makeRowId,
  rootPath,
  type GridPath,
  type RowKey,
} from "../types/identity";
import type { TreeNode } from "../types/level-row";
import type { GridSchema } from "../types/schema";
import {
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  ROW_MULTISELECT_LIST,
} from "../types/interaction";
import {
  createGridRuntime,
  runtimeInternalsFor,
  type LoadedRowsBoundaryEvent,
} from "./runtime";

const textColumn = {
  id: "name",
  name: "Name",
  renderCell: ({ value }: { readonly value: unknown }) => String(value ?? ""),
};

const flatSchema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      rowHeaderColumn: "none",
      columns: [textColumn],
      options: { allowPhantoms: true },
      childLevels: [],
    },
  },
};

const hierarchySchema: GridSchema = {
  rootLevel: "groups",
  levels: {
    groups: {
      name: "groups",
      rowHeaderColumn: "none",
      columns: [textColumn],
      options: {},
      childLevels: ["items"],
    },
    items: {
      name: "items",
      rowHeaderColumn: "none",
      columns: [textColumn],
      options: {},
      childLevels: [],
    },
  },
};

const flatNodes = (): TreeNode[] => [
  { rowKey: "a", levelName: "rows", columns: { name: "Alpha" } },
  { rowKey: "b", levelName: "rows", columns: { name: "Beta" } },
  { rowKey: "c", levelName: "rows", columns: { name: "Gamma" } },
];

const groupNodes = (): TreeNode[] => [
  { rowKey: "fruit", levelName: "groups", columns: { name: "Fruit" } },
  { rowKey: "veg", levelName: "groups", columns: { name: "Vegetables" } },
];

const itemNodes = (): TreeNode[] => [
  { rowKey: "apple", levelName: "items", columns: { name: "Apple" } },
  { rowKey: "banana", levelName: "items", columns: { name: "Banana" } },
];

type WritableLevelSource = LevelDataSource & { write: WriteCapability };
type Refetch = NonNullable<NonNullable<LevelDataSource["query"]>["refetch"]>;

type MutableSourceApi = {
  readonly nodes: () => readonly TreeNode[];
  readonly publish: (nodes: readonly TreeNode[]) => void;
};

type MutableSourceOptions = {
  readonly removeNode?: (
    rowKey: RowKey,
    api: MutableSourceApi,
  ) => void | Promise<void>;
  readonly createNode?: WriteCapability["createNode"];
  readonly refetch?: Refetch;
};

type MutableSourceHarness = MutableSourceApi & {
  readonly source: WritableLevelSource;
  readonly removeNode: ReturnType<typeof vi.fn<WriteCapability["removeNode"]>>;
  readonly createNode: ReturnType<typeof vi.fn<WriteCapability["createNode"]>>;
  readonly refetch: ReturnType<typeof vi.fn<Refetch>>;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
};

function mutableSource(
  initialNodes: readonly TreeNode[],
  options: MutableSourceOptions = {},
): MutableSourceHarness {
  let state: Extract<LevelSourceState, { status: "ready" }> = {
    status: "ready",
    snapshot: { nodes: initialNodes },
  };
  const subscribers = new Set<() => void>();

  const api: MutableSourceApi = {
    nodes: () => state.snapshot.nodes,
    publish(nodes) {
      state = { status: "ready", snapshot: { nodes } };
      for (const subscriber of Array.from(subscribers)) subscriber();
    },
  };

  const removeNode = vi.fn<WriteCapability["removeNode"]>((rowKey) => {
    if (options.removeNode) return options.removeNode(rowKey, api);
    api.publish(api.nodes().filter((node) => node.rowKey !== rowKey));
  });
  const createNode = vi.fn<WriteCapability["createNode"]>(
    options.createNode ??
      (async (node, atIndex) => {
        const next = api.nodes().slice();
        const index = atIndex ?? next.length;
        next.splice(index, 0, node);
        api.publish(next);
        return { node, atIndex: index };
      }),
  );
  const refetch = vi.fn<Refetch>(
    options.refetch ??
      (async () => ({
        kind: "ready",
        state,
      })),
  );
  const dispose = vi.fn(() => {
    subscribers.clear();
  });

  const source: WritableLevelSource = {
    state: () => state,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    query: { refetch },
    write: {
      setCell(rowKey, colId, value) {
        api.publish(
          api
            .nodes()
            .map((node) =>
              node.rowKey === rowKey
                ? { ...node, columns: { ...node.columns, [colId]: value } }
                : node,
            ),
        );
      },
      applyChanges(changes) {
        let nodes = api.nodes();
        for (const change of changes) {
          nodes = nodes.map((node) =>
            node.rowKey === change.rowKey
              ? {
                  ...node,
                  columns: { ...node.columns, [change.colId]: change.value },
                }
              : node,
          );
        }
        api.publish(nodes);
      },
      createNode,
      removeNode,
      onReconcile: () => () => {},
      canAppendRow: () => true,
    },
    dispose,
  };

  return { ...api, source, removeNode, createNode, refetch, dispose };
}

function dataSourceWithRoot(
  root: MutableSourceHarness,
  dispose = vi.fn<() => void>(),
): GridDataSource {
  return {
    rootSource: () => root.source,
    resolveChild: () => {
      throw new Error("No child source was configured.");
    },
    dispose,
  };
}

function hierarchyDataSource(
  root: MutableSourceHarness,
  child: MutableSourceHarness,
  dispose = vi.fn<() => void>(),
): GridDataSource {
  return {
    rootSource: () => root.source,
    resolveChild: (parentPath, parentRowKey, childLevelName) => {
      expect(parentPath).toBe(rootPath("groups"));
      expect(parentRowKey).toBe("fruit");
      expect(childLevelName).toBe("items");
      return child.source;
    },
    dispose,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function readyLoadResult(source: MutableSourceHarness): SourceLoadResult {
  const state = source.source.state();
  if (state.status !== "ready") throw new Error("Expected a ready source.");
  return { kind: "ready", state };
}

function selectedHierarchyTargets(
  runtime: ReturnType<typeof createGridRuntime>,
): {
  readonly childPath: GridPath;
  readonly fruit: ReturnType<typeof makeRowId>;
  readonly apple: ReturnType<typeof makeRowId>;
  readonly banana: ReturnType<typeof makeRowId>;
} {
  const groupsPath = rootPath("groups");
  const fruit = makeRowId(groupsPath, "fruit");
  runtime.root.expand(fruit);
  const itemsPath = childPath(groupsPath, "fruit", "items");
  const apple = makeRowId(itemsPath, "apple");
  const banana = makeRowId(itemsPath, "banana");
  runtime.root.setRowSelection({ kind: "single", rowId: fruit });
  runtime.level(itemsPath).setRowSelection({
    kind: "set",
    rowIds: new Set([apple, banana]),
  });
  return { childPath: itemsPath, fruit, apple, banana };
}

describe("runtime lifecycle acceptance", () => {
  it("reuses unchanged adapted rows when a new source array changes only one raw node", () => {
    const initial = flatNodes();
    const source = mutableSource(initial);
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
    });
    const path = rootPath("rows");
    const a = makeRowId(path, "a");
    const b = makeRowId(path, "b");
    const beforeA = runtime.root.displayedRow(a);
    const beforeB = runtime.root.displayedRow(b);
    const aChanged = vi.fn();
    const bChanged = vi.fn();
    const sequenceChanged = vi.fn();
    runtime.root.subscribeDisplayedRow(a, aChanged);
    runtime.root.subscribeDisplayedRow(b, bChanged);
    runtime.root.subscribeDisplayedRowSequence(sequenceChanged);

    source.publish([
      { ...initial[0], columns: { name: "Alpha updated" } },
      initial[1],
      initial[2],
    ]);

    expect(runtime.root.displayedRow(a) === beforeA).toBe(false);
    expect(runtime.root.displayedRow(b) === beforeB).toBe(true);
    expect(aChanged).toHaveBeenCalledOnce();
    expect(bChanged).not.toHaveBeenCalled();
    expect(sequenceChanged).not.toHaveBeenCalled();
  });

  it("rejects invalid previous snapshots and freezes the synthetic identity-error state", () => {
    let state: LevelSourceState = {
      status: "ready",
      snapshot: { nodes: flatNodes() },
    };
    const subscribers = new Set<() => void>();
    const setCell = vi.fn<WriteCapability["setCell"]>();
    const source: WritableLevelSource = {
      state: () => state,
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      dispose: () => subscribers.clear(),
      write: {
        setCell,
        applyChanges: () => {},
        createNode: async (node, atIndex = 0) => ({ node, atIndex }),
        removeNode: () => {},
        onReconcile: () => () => {},
      },
    };
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: {
        rootSource: () => source,
        resolveChild: () => {
          throw new Error("No child source was configured.");
        },
        dispose: () => {},
      },
    });
    const priorRows = runtime.root.displayedRows();
    const duplicate = flatNodes();
    duplicate[1] = { ...duplicate[1], rowKey: duplicate[0].rowKey };
    state = {
      status: "refreshing",
      snapshot: { nodes: flatNodes() },
      previous: { nodes: duplicate },
    };

    for (const subscriber of subscribers) subscriber();

    const adapted = runtime.root.data.state();
    expect(adapted.status).toBe("refreshError");
    expect(Object.isFrozen(adapted)).toBe(true);
    expect(runtime.root.displayedRows()).toBe(priorRows);
    expect(() =>
      runtime.root.writeCell(
        { rowId: makeRowId(rootPath("rows"), "a"), colId: "name" },
        "Changed",
      ),
    ).toThrow("invalid row identity");
    expect(setCell).not.toHaveBeenCalled();
  });

  it("selectedDataTargets uses row selection only and never cell selection", () => {
    const source = mutableSource(flatNodes());
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    const path = rootPath("rows");
    const a = makeRowId(path, "a");
    const b = makeRowId(path, "b");

    runtimeInternalsFor(runtime).cursorManager.setCellRange(
      path,
      { rowId: a, colId: "name" },
      { rowId: b, colId: "name" },
    );

    expect(runtime.rowOperations.targets().map(({ rowKey }) => rowKey)).toEqual(
      ["a", "b"],
    );
    expect(runtime.rowOperations.selectedDataTargets()).toEqual([]);

    runtime.root.setRowSelection({ kind: "single", rowId: b });
    expect(
      runtime.rowOperations.selectedDataTargets().map(({ rowKey }) => rowKey),
    ).toEqual(["b"]);
  });

  it("preflights cloned, cross-runtime, and stale-generation targets before mutation and deduplicates valid input", async () => {
    const firstSource = mutableSource(flatNodes());
    const secondSource = mutableSource(flatNodes());
    const first = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(firstSource),
    });
    const second = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(secondSource),
    });
    const path = rootPath("rows");
    const a = first.root.dataRowTarget(makeRowId(path, "a"))!;
    const b = first.root.dataRowTarget(makeRowId(path, "b"))!;

    await expect(first.rowOperations.remove([a, { ...b }])).rejects.toThrow(
      "target was not issued by this runtime",
    );
    expect(firstSource.removeNode).not.toHaveBeenCalled();
    expect(firstSource.nodes().map(({ rowKey }) => rowKey)).toEqual([
      "a",
      "b",
      "c",
    ]);

    await expect(second.rowOperations.remove([a])).rejects.toThrow(
      "target was not issued by this runtime",
    );
    expect(secondSource.removeNode).not.toHaveBeenCalled();

    firstSource.publish([]);
    firstSource.publish(flatNodes());
    await expect(first.rowOperations.remove([a])).rejects.toThrow(
      `stale row target "${a.rowId}"`,
    );
    expect(firstSource.removeNode).not.toHaveBeenCalled();

    const fresh = first.root.dataRowTarget(makeRowId(path, "a"))!;
    const result = await first.rowOperations.remove([fresh, fresh]);
    expect(result.kind).toBe("complete");
    expect(result.removed).toEqual([fresh]);
    expect(firstSource.removeNode).toHaveBeenCalledOnce();
    expect(firstSource.removeNode).toHaveBeenCalledWith("a");
  });

  it("reports partial child-first removal, retains failed and unattempted selection, settles refetch, and corrects from actual removals", async () => {
    const calls: string[] = [];
    const firstRemoval = deferred<void>();
    const refetch = deferred<SourceLoadResult>();
    const failed = new Error("banana delete failed");
    const rootSource = mutableSource(groupNodes(), {
      removeNode(rowKey, api) {
        calls.push(`root:${rowKey}`);
        api.publish(api.nodes().filter((node) => node.rowKey !== rowKey));
      },
    });
    const childSource = mutableSource(itemNodes(), {
      removeNode(rowKey) {
        calls.push(`child:${rowKey}`);
        return rowKey === "apple"
          ? firstRemoval.promise
          : Promise.reject(failed);
      },
      refetch: () => refetch.promise,
    });
    const runtime = createGridRuntime({
      schema: hierarchySchema,
      dataSource: hierarchyDataSource(rootSource, childSource),
      interaction: ROW_MULTISELECT_LIST,
    });
    const selected = selectedHierarchyTargets(runtime);
    const veg = makeRowId(rootPath("groups"), "veg");
    runtimeInternalsFor(runtime).cursorManager.moveRowCursorTo({
      path: selected.childPath,
      rowId: selected.banana,
    });
    const targets = runtime.rowOperations.selectedDataTargets();

    const removal = runtime.rowOperations.remove(targets);

    expect(calls).toEqual(["child:apple"]);
    expect(
      runtimeInternalsFor(runtime).cursorManager.currentRowCursor(),
    ).toEqual({ path: rootPath("groups"), rowId: veg });

    childSource.publish(
      childSource.nodes().filter((node) => node.rowKey !== "apple"),
    );
    firstRemoval.resolve();
    await flushMicrotasks();

    expect(calls).toEqual(["child:apple", "child:banana"]);
    expect(childSource.refetch).toHaveBeenCalledOnce();
    let settled = false;
    void removal.then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    refetch.reject(new Error("refetch failed"));
    const result = await removal;

    expect(result).toMatchObject({
      kind: "partial",
      removed: [{ rowKey: "apple" }],
      failed: { rowKey: "banana" },
      unattempted: [{ rowKey: "fruit" }],
      error: failed,
    });
    expect(calls).toEqual(["child:apple", "child:banana"]);
    expect(rootSource.removeNode).not.toHaveBeenCalled();
    expect(runtime.root.selectedRowIds()).toEqual([selected.fruit]);
    expect(runtime.level(selected.childPath).selectedRowIds()).toEqual([
      selected.banana,
    ]);
    expect(
      runtimeInternalsFor(runtime).cursorManager.currentRowCursor(),
    ).toEqual({ path: selected.childPath, rowId: selected.banana });
  });

  it("completes removal child-first and prunes descendants before registry and source observers", async () => {
    const calls: string[] = [];
    const rootSource = mutableSource(groupNodes(), {
      removeNode(rowKey, api) {
        calls.push(`root:${rowKey}`);
        api.publish(api.nodes().filter((node) => node.rowKey !== rowKey));
      },
    });
    const childSource = mutableSource(itemNodes(), {
      removeNode(rowKey, api) {
        calls.push(`child:${rowKey}`);
        api.publish(api.nodes().filter((node) => node.rowKey !== rowKey));
      },
    });
    const runtime = createGridRuntime({
      schema: hierarchySchema,
      dataSource: hierarchyDataSource(rootSource, childSource),
      interaction: ROW_MULTISELECT_LIST,
    });
    const selected = selectedHierarchyTargets(runtime);
    const retainedLevel = runtime.level(selected.childPath);
    const retainedController = controllerFor(runtime, selected.childPath);
    const observations: Array<{
      readonly channel: "registry" | "source";
      readonly paths: readonly GridPath[];
      readonly expanded: boolean;
      readonly levelInactive: boolean;
      readonly controllerInactive: boolean;
    }> = [];

    function observe(channel: "registry" | "source"): void {
      let levelInactive = false;
      let controllerInactive = false;
      try {
        retainedLevel.displayedRows();
      } catch {
        levelInactive = true;
      }
      try {
        retainedController.getState();
      } catch {
        controllerInactive = true;
      }
      observations.push({
        channel,
        paths: runtime.registeredLevels().map(({ path }) => path),
        expanded: runtime.root.isExpanded(selected.fruit),
        levelInactive,
        controllerInactive,
      });
    }

    runtime.subscribeLevels(() => observe("registry"));
    runtime.root.data.subscribe(() => observe("source"));

    const result = await runtime.rowOperations.remove(
      runtime.rowOperations.selectedDataTargets(),
    );

    expect(result).toMatchObject({
      kind: "complete",
      removed: [{ rowKey: "apple" }, { rowKey: "banana" }, { rowKey: "fruit" }],
    });
    expect(calls).toEqual(["child:apple", "child:banana", "root:fruit"]);
    expect(observations).toEqual([
      {
        channel: "registry",
        paths: [rootPath("groups")],
        expanded: false,
        levelInactive: true,
        controllerInactive: true,
      },
      {
        channel: "source",
        paths: [rootPath("groups")],
        expanded: false,
        levelInactive: true,
        controllerInactive: true,
      },
    ]);
    expect(childSource.refetch).not.toHaveBeenCalled();
    expect(rootSource.refetch).toHaveBeenCalledOnce();
    expect(childSource.dispose).toHaveBeenCalledOnce();
    expect(() => runtime.level(selected.childPath)).toThrow(
      "Grid level is no longer registered.",
    );
  });

  it("keeps retained level, data, and controller facades inactive after the same path is registered again", async () => {
    const rootSource = mutableSource(groupNodes());
    const firstChildSource = mutableSource(itemNodes());
    const secondChildSource = mutableSource([
      {
        rowKey: "cherry",
        levelName: "items",
        columns: { name: "Cherry" },
      },
    ]);
    const childSources = [firstChildSource, secondChildSource] as const;
    let childResolution = 0;
    const runtime = createGridRuntime({
      schema: hierarchySchema,
      dataSource: {
        rootSource: () => rootSource.source,
        resolveChild: () => childSources[childResolution++].source,
        dispose: () => {},
      },
      interaction: ROW_MULTISELECT_LIST,
    });
    const groupsPath = rootPath("groups");
    const fruit = makeRowId(groupsPath, "fruit");
    const itemsPath = childPath(groupsPath, "fruit", "items");
    runtime.root.expand(fruit);
    const oldLevel = runtime.level(itemsPath);
    const oldData = oldLevel.data;
    const oldController = controllerFor(runtime, itemsPath);
    const target = runtime.root.dataRowTarget(fruit)!;

    await runtime.rowOperations.remove([target]);
    rootSource.publish(groupNodes());
    runtime.root.expand(fruit);

    const currentLevel = runtime.level(itemsPath);
    const currentController = controllerFor(runtime, itemsPath);
    expect(childResolution).toBe(2);
    expect(currentLevel === oldLevel).toBe(false);
    expect(currentLevel.data === oldData).toBe(false);
    expect(currentController === oldController).toBe(false);
    expect(
      currentLevel.displayedRows().rows.map((row) => row.source.rowKey),
    ).toEqual(["cherry"]);
    expect(() => oldLevel.displayedRows()).toThrow(
      "Grid level is no longer registered.",
    );
    expect(() => oldData.state()).toThrow(
      "Grid level is no longer registered.",
    );
    expect(() => oldController.getState()).toThrow(
      "Grid level is no longer registered.",
    );
  });

  it("preserves a newer user cursor move while removal is in flight", async () => {
    const pending = deferred<void>();
    const source = mutableSource(flatNodes(), {
      removeNode: () => pending.promise,
    });
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
      interaction: ROW_MULTISELECT_LIST,
    });
    const path = rootPath("rows");
    const a = makeRowId(path, "a");
    const b = makeRowId(path, "b");
    const c = makeRowId(path, "c");
    runtime.root.setRowSelection({ kind: "single", rowId: b });
    const cursors = runtimeInternalsFor(runtime).cursorManager;
    cursors.moveRowCursorTo({ path, rowId: b });

    const removal = runtime.rowOperations.remove(
      runtime.rowOperations.selectedDataTargets(),
    );
    expect(cursors.currentRowCursor()).toEqual({ path, rowId: c });

    cursors.moveRowCursorTo({ path, rowId: a });
    source.publish(source.nodes().filter((node) => node.rowKey !== "b"));
    pending.resolve();

    await expect(removal).resolves.toMatchObject({ kind: "complete" });
    expect(cursors.currentRowCursor()).toEqual({ path, rowId: a });
  });

  it("rejects a mismatched create levelName before source or event effects", async () => {
    const source = mutableSource(flatNodes());
    const mutationCommitted = vi.fn();
    const sourceObserver = vi.fn();
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
      on: { mutationCommitted },
    });
    runtime.root.data.subscribe(sourceObserver);

    await expect(
      runtime.root.createRow({
        rowKey: "wrong",
        levelName: "other-level",
        columns: { name: "Wrong" },
      }),
    ).rejects.toThrow(
      'node levelName "other-level" does not match level "rows"',
    );

    expect(source.createNode).not.toHaveBeenCalled();
    expect(sourceObserver).not.toHaveBeenCalled();
    expect(mutationCommitted).not.toHaveBeenCalled();
    expect(source.nodes().map(({ rowKey }) => rowKey)).toEqual(["a", "b", "c"]);
  });

  it("deduplicates a pending loaded-row boundary and lets only the latest origin land", async () => {
    const source = mutableSource(flatNodes());
    const firstLoad = deferred<SourceLoadResult>();
    const secondLoad = deferred<SourceLoadResult>();
    const loads = [firstLoad, secondLoad] as const;
    let loadIndex = 0;
    const onLoadedRowsBoundary = vi.fn(() => loads[loadIndex++].promise);
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
      interaction: ROW_MULTISELECT_LIST,
      onLoadedRowsBoundary,
    });
    const path = rootPath("rows");
    const a = makeRowId(path, "a");
    const b = makeRowId(path, "b");
    const cursors = runtimeInternalsFor(runtime).cursorManager;
    const request = runtimeInternalsFor(runtime).requestLoadedRowsBoundary;
    const firstEvent: LoadedRowsBoundaryEvent = {
      kind: "row",
      loadPath: path,
      direction: "after",
      origin: { path, rowId: b },
      extend: false,
    };
    cursors.moveRowCursorTo(firstEvent.origin);

    expect(request(firstEvent)).toBe(true);
    expect(request(firstEvent)).toBe(true);
    expect(onLoadedRowsBoundary).toHaveBeenCalledOnce();

    const secondEvent: LoadedRowsBoundaryEvent = {
      ...firstEvent,
      origin: { path, rowId: a },
    };
    cursors.moveRowCursorTo(secondEvent.origin);
    expect(request(secondEvent)).toBe(true);
    expect(onLoadedRowsBoundary).toHaveBeenCalledTimes(2);

    firstLoad.resolve(readyLoadResult(source));
    await flushMicrotasks();
    expect(cursors.currentRowCursor()).toEqual(secondEvent.origin);

    source.publish([
      { rowKey: "next", levelName: "rows", columns: { name: "Next" } },
    ]);
    expect(cursors.currentRowCursor()).toEqual({
      path,
      rowId: makeRowId(path, "next"),
    });

    secondLoad.resolve(readyLoadResult(source));
    await flushMicrotasks();
    expect(cursors.currentRowCursor()).toEqual({
      path,
      rowId: makeRowId(path, "next"),
    });
  });

  it("clears and reports a rejected loaded-row boundary without a later unrelated landing", async () => {
    const source = mutableSource(flatNodes());
    const load = deferred<SourceLoadResult>();
    const report = vi.fn();
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
      interaction: ROW_MULTISELECT_LIST,
      onLoadedRowsBoundary: () => load.promise,
      onObserverError: report,
    });
    const path = rootPath("rows");
    const b = makeRowId(path, "b");
    const origin = { path, rowId: b };
    const cursors = runtimeInternalsFor(runtime).cursorManager;
    cursors.moveRowCursorTo(origin);

    expect(
      runtimeInternalsFor(runtime).requestLoadedRowsBoundary({
        kind: "row",
        loadPath: path,
        direction: "after",
        origin,
        extend: false,
      }),
    ).toBe(true);

    const rejection = new Error("page load rejected");
    load.reject(rejection);
    await flushMicrotasks();
    expect(report).toHaveBeenCalledWith(rejection);
    expect(cursors.currentRowCursor()).toEqual(origin);

    source.publish([
      { rowKey: "later", levelName: "rows", columns: { name: "Later" } },
    ]);
    expect(cursors.currentRowCursor()).toEqual(origin);
  });

  it("isolates throwing event, source, displayed-row, draft, registry, and controller observers", () => {
    const report = vi.fn();
    const source = mutableSource(flatNodes());
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
      phantomRows: {},
      onObserverError: report,
    });
    const path = rootPath("rows");
    const a = makeRowId(path, "a");
    const errors = {
      event: new Error("event observer"),
      source: new Error("source observer"),
      displayed: new Error("displayed-row observer"),
      draft: new Error("draft observer"),
      registry: new Error("registry observer"),
      controller: new Error("controller observer"),
    };
    const later = {
      event: vi.fn(),
      source: vi.fn(),
      displayed: vi.fn(),
      draft: vi.fn(),
      registry: vi.fn(),
      controller: vi.fn(),
    };

    runtime.on("mutationCommitted", () => {
      throw errors.event;
    });
    runtime.on("mutationCommitted", later.event);
    runtime.root.data.subscribe(() => {
      throw errors.source;
    });
    runtime.root.data.subscribe(later.source);
    runtime.root.subscribeDisplayedRow(a, () => {
      throw errors.displayed;
    });
    runtime.root.subscribeDisplayedRow(a, later.displayed);
    runtime.root.drafts.subscribe(() => {
      throw errors.draft;
    });
    runtime.root.drafts.subscribe(later.draft);
    controllerFor(runtime, path).subscribe(() => {
      throw errors.controller;
    });
    controllerFor(runtime, path).subscribe(later.controller);

    expect(() => runtime.root.selectRow(a)).not.toThrow();
    expect(() =>
      runtime.root.writeCell({ rowId: a, colId: "name" }, "Alpha updated"),
    ).not.toThrow();
    expect(() =>
      runtime.root.drafts.add("draft", { name: "Draft" }),
    ).not.toThrow();

    const rootSource = mutableSource(groupNodes());
    const childSource = mutableSource(itemNodes());
    const hierarchical = createGridRuntime({
      schema: hierarchySchema,
      dataSource: hierarchyDataSource(rootSource, childSource),
      onObserverError: report,
    });
    hierarchical.subscribeLevels(() => {
      throw errors.registry;
    });
    hierarchical.subscribeLevels(later.registry);
    expect(() =>
      hierarchical.root.expand(makeRowId(rootPath("groups"), "fruit")),
    ).not.toThrow();

    expect(later.event).toHaveBeenCalledOnce();
    expect(later.source).toHaveBeenCalledOnce();
    expect(later.displayed).toHaveBeenCalledOnce();
    expect(later.draft).toHaveBeenCalledOnce();
    expect(later.registry).toHaveBeenCalledOnce();
    expect(later.controller).toHaveBeenCalledOnce();
    expect(report.mock.calls.map(([error]) => error)).toEqual(
      expect.arrayContaining(Object.values(errors)),
    );
    expect(report).toHaveBeenCalledTimes(Object.keys(errors).length);
  });

  it("keeps duplicate runtime observer registrations independent with idempotent unsubscribe", () => {
    const source = mutableSource(flatNodes());
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(source),
    });
    const path = rootPath("rows");
    const callback = vi.fn();
    const unsubscribeFirst = runtime.root.data.subscribe(callback);
    const unsubscribeSecond = runtime.root.data.subscribe(callback);

    runtime.root.writeCell(
      { rowId: makeRowId(path, "a"), colId: "name" },
      "First",
    );
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    unsubscribeFirst();
    runtime.root.writeCell(
      { rowId: makeRowId(path, "a"), colId: "name" },
      "Second",
    );
    expect(callback).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    unsubscribeSecond();
    runtime.root.writeCell(
      { rowId: makeRowId(path, "a"), colId: "name" },
      "Third",
    );
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("preserves an in-flight draft create result while disposal suppresses events and disposes dependencies once after settlement", async () => {
    const created = deferred<{
      readonly node: TreeNode;
      readonly atIndex: number;
    }>();
    const source = mutableSource(flatNodes(), {
      createNode: () => created.promise,
    });
    const sourceDisposeFailure = new Error("source dispose failed");
    const ownedSource: WritableLevelSource = {
      ...source.source,
      dispose() {
        source.dispose();
        throw sourceDisposeFailure;
      },
    };
    const dataSourceDispose = vi.fn();
    const rawPhantoms = createPhantomChannel();
    const phantomDispose = vi.fn(rawPhantoms.dispose);
    const phantoms: PhantomChannel = {
      ...rawPhantoms,
      dispose: phantomDispose,
    };
    const mutationCommitted = vi.fn();
    const phantomRowCommitted = vi.fn();
    const report = vi.fn();
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: {
        rootSource: () => ownedSource,
        resolveChild: () => {
          throw new Error("No child source was configured.");
        },
        dispose: dataSourceDispose,
      },
      phantoms,
      phantomRows: {},
      on: { mutationCommitted, phantomRowCommitted },
      onObserverError: report,
    });
    runtime.root.drafts.add("draft", { name: "Draft" });
    const draftObserver = vi.fn();
    runtime.root.drafts.subscribe(draftObserver);

    const commit = runtime.root.drafts.commit("draft");
    expect(draftObserver).toHaveBeenCalledOnce();
    draftObserver.mockClear();
    runtime.dispose();
    runtime.dispose();

    expect(source.dispose).not.toHaveBeenCalled();
    expect(dataSourceDispose).not.toHaveBeenCalled();
    expect(phantomDispose).not.toHaveBeenCalled();

    const result = {
      node: {
        rowKey: "created",
        levelName: "rows",
        columns: { name: "Created" },
      },
      atIndex: 3,
    } as const;
    created.resolve(result);

    await expect(commit).resolves.toEqual(result);
    expect(mutationCommitted).not.toHaveBeenCalled();
    expect(phantomRowCommitted).not.toHaveBeenCalled();
    expect(draftObserver).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(dataSourceDispose).toHaveBeenCalledOnce();
    expect(phantomDispose).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(sourceDisposeFailure);

    runtime.dispose();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(dataSourceDispose).toHaveBeenCalledOnce();
    expect(phantomDispose).toHaveBeenCalledOnce();
  });

  it("unwinds every acquired dependency when root registration fails", () => {
    const root = mutableSource(flatNodes());
    const failure = new Error("root subscription failed");
    const source: WritableLevelSource = {
      ...root.source,
      subscribe: () => {
        throw failure;
      },
    };
    const dataSourceDispose = vi.fn();
    const rawPhantoms = createPhantomChannel();
    const phantomDispose = vi.fn(rawPhantoms.dispose);
    const phantoms: PhantomChannel = {
      ...rawPhantoms,
      dispose: phantomDispose,
    };

    expect(() =>
      createGridRuntime({
        schema: flatSchema,
        dataSource: {
          rootSource: () => source,
          resolveChild: () => {
            throw new Error("No child source was configured.");
          },
          dispose: dataSourceDispose,
        },
        phantoms,
      }),
    ).toThrow(failure);

    expect(root.dispose).toHaveBeenCalledOnce();
    expect(dataSourceDispose).toHaveBeenCalledOnce();
    expect(phantomDispose).toHaveBeenCalledOnce();
  });

  it("rolls back sibling child registrations when one child factory fails", () => {
    const schema: GridSchema = {
      rootLevel: "groups",
      levels: {
        groups: {
          ...hierarchySchema.levels.groups,
          childLevels: ["items", "notes"],
        },
        items: hierarchySchema.levels.items,
        notes: {
          ...hierarchySchema.levels.items,
          name: "notes",
        },
      },
    };
    const root = mutableSource(groupNodes());
    const items = mutableSource(itemNodes());
    const failure = new Error("notes source failed");
    const cleanupFailure = new Error("items dispose failed");
    const report = vi.fn();
    const ownedItems: WritableLevelSource = {
      ...items.source,
      dispose() {
        items.dispose();
        throw cleanupFailure;
      },
    };
    const resolveChild = vi.fn(
      (
        _parentPath: GridPath,
        _parentRowKey: RowKey,
        childLevelName: string,
      ) => {
        if (childLevelName === "items") return ownedItems;
        throw failure;
      },
    );
    const runtime = createGridRuntime({
      schema,
      dataSource: {
        rootSource: () => root.source,
        resolveChild,
        dispose: () => {},
      },
      onObserverError: report,
    });
    const fruit = makeRowId(rootPath("groups"), "fruit");

    expect(() => runtime.root.expand(fruit)).toThrow(failure);
    expect(resolveChild.mock.calls.map(([, , name]) => name)).toEqual([
      "items",
      "notes",
    ]);
    expect(runtime.root.isExpanded(fruit)).toBe(false);
    expect(runtime.registeredLevels().map(({ path }) => path)).toEqual([
      rootPath("groups"),
    ]);
    expect(items.dispose).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(cleanupFailure);
  });

  it("installs a source entry before a synchronous subscription notification", () => {
    const root = mutableSource(flatNodes());
    const source: WritableLevelSource = {
      ...root.source,
      subscribe(listener) {
        const unsubscribe = root.source.subscribe(listener);
        listener();
        return unsubscribe;
      },
    };

    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: {
        rootSource: () => source,
        resolveChild: () => {
          throw new Error("No child source was configured.");
        },
        dispose: () => {},
      },
    });

    expect(runtime.root.displayedRows().rows).toHaveLength(3);
    runtime.dispose();
  });

  it("defers dependency disposal until every concurrent command settles", async () => {
    const first = deferred<CreateNodeResult>();
    const second = deferred<CreateNodeResult>();
    const pending = [first, second];
    const root = mutableSource(flatNodes(), {
      createNode: (node, atIndex) => {
        const operation = pending.shift();
        if (!operation) throw new Error("Unexpected create command.");
        return operation.promise.then(() => ({
          node,
          atIndex: atIndex ?? flatNodes().length,
        }));
      },
    });
    const dataSourceDispose = vi.fn();
    const runtime = createGridRuntime({
      schema: flatSchema,
      dataSource: dataSourceWithRoot(root, dataSourceDispose),
    });
    runtime.root.drafts.add("draft-1", { name: "One" });
    runtime.root.drafts.add("draft-2", { name: "Two" });
    const firstCommit = runtime.root.drafts.commit("draft-1");
    const secondCommit = runtime.root.drafts.commit("draft-2");

    runtime.dispose();
    expect(root.dispose).not.toHaveBeenCalled();
    expect(dataSourceDispose).not.toHaveBeenCalled();

    first.resolve({
      node: { rowKey: "ignored-1", levelName: "rows", columns: {} },
      atIndex: 0,
    });
    await firstCommit;
    expect(root.dispose).not.toHaveBeenCalled();

    second.resolve({
      node: { rowKey: "ignored-2", levelName: "rows", columns: {} },
      atIndex: 0,
    });
    await secondCommit;
    expect(root.dispose).toHaveBeenCalledOnce();
    expect(dataSourceDispose).toHaveBeenCalledOnce();
  });
});
