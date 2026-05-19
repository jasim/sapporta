import { describe, expect, it, vi } from "vitest";
import {
  childPath,
  rootPath,
  type GridPath,
  type GridRuntime,
  type RuntimeLevelDataSource,
  type TreeNode,
} from "../../grid";
import { startLoadingValueLookupEntriesForGridRows } from "./grid-row-loader";
import type { ValueLookup } from "./value-lookup";

const root = rootPath("orders");

function makeNode(columns: Record<string, unknown>): TreeNode {
  return { levelName: "test", columns };
}

function makeLookup(): ValueLookup {
  return {
    entryForValue: vi.fn(),
    loadMissingEntries: vi.fn(async () => {}),
    subscribeToLookupChanges: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

function makeSource(initialNodes: TreeNode[]) {
  let nodes = initialNodes;
  const listeners = new Set<() => void>();
  const source: RuntimeLevelDataSource = {
    writable: false,
    snapshot: () => ({
      status: "ready",
      nodes,
      serverManaged: { sort: false, filter: false, pagination: false },
    }),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setSort: () => {},
    setFilter: () => {},
    setPage: () => {},
    refetch: () => {},
    dispose: () => {},
    onReconcile: () => () => {},
  };

  return {
    source,
    emit: () => {
      for (const fn of Array.from(listeners)) fn();
    },
    replaceNodes: (next: TreeNode[]) => {
      nodes = next;
      for (const fn of Array.from(listeners)) fn();
    },
    listenerCount: () => listeners.size,
  };
}

function makeRuntime(args: {
  paths: GridPath[];
  sources: Map<GridPath, RuntimeLevelDataSource>;
}) {
  let paths = args.paths;
  const registryListeners = new Set<() => void>();
  const runtime = {
    registeredPaths: () => paths,
    sourceFor: (path: GridPath) => {
      const source = args.sources.get(path);
      if (!source) throw new Error(`missing source ${path}`);
      return source;
    },
    subscribeRegistry: (fn: () => void) => {
      registryListeners.add(fn);
      return () => {
        registryListeners.delete(fn);
      };
    },
  } as unknown as GridRuntime;

  return {
    runtime,
    setPaths: (next: GridPath[]) => {
      paths = next;
    },
    emitRegistry: () => {
      for (const fn of Array.from(registryListeners)) fn();
    },
    registryListenerCount: () => registryListeners.size,
  };
}

describe("startLoadingValueLookupEntriesForGridRows", () => {
  it("loads root path values into the configured lookup", () => {
    const lookup = makeLookup();
    const source = makeSource([
      makeNode({ customer_id: "2" }),
      makeNode({ customer_id: "3" }),
    ]);
    const runtime = makeRuntime({
      paths: [root],
      sources: new Map([[root, source.source]]),
    });

    const stop = startLoadingValueLookupEntriesForGridRows({
      runtime: runtime.runtime,
      lookupColumnsForGridPath: () => [
        { colId: "customer_id", valueLookup: lookup },
      ],
    });

    expect(lookup.loadMissingEntries).toHaveBeenCalledWith(["2", "3"]);
    stop();
  });

  it("subscribes to newly registered child paths after the registry changes", () => {
    const child = childPath(root, "42", "orders.lines");
    const lookup = makeLookup();
    const rootSource = makeSource([makeNode({ id: "42" })]);
    const childSource = makeSource([
      makeNode({ product_id: "5" }),
      makeNode({ product_id: "6" }),
    ]);
    const runtime = makeRuntime({
      paths: [root],
      sources: new Map([
        [root, rootSource.source],
        [child, childSource.source],
      ]),
    });

    const stop = startLoadingValueLookupEntriesForGridRows({
      runtime: runtime.runtime,
      lookupColumnsForGridPath: (path) =>
        path === child ? [{ colId: "product_id", valueLookup: lookup }] : [],
    });

    expect(childSource.listenerCount()).toBe(0);

    runtime.setPaths([root, child]);
    runtime.emitRegistry();

    expect(childSource.listenerCount()).toBe(1);
    expect(lookup.loadMissingEntries).toHaveBeenCalledWith(["5", "6"]);
    stop();
  });

  it("loads multiple child paths into the same lookup cache", () => {
    const firstChild = childPath(root, "42", "orders.lines");
    const secondChild = childPath(root, "43", "orders.lines");
    const lookup = makeLookup();
    const sources = new Map<GridPath, RuntimeLevelDataSource>([
      [root, makeSource([makeNode({ id: "42" })]).source],
      [firstChild, makeSource([makeNode({ product_id: "5" })]).source],
      [
        secondChild,
        makeSource([
          makeNode({ product_id: "5" }),
          makeNode({ product_id: "6" }),
        ]).source,
      ],
    ]);
    const runtime = makeRuntime({
      paths: [root, firstChild, secondChild],
      sources,
    });

    const stop = startLoadingValueLookupEntriesForGridRows({
      runtime: runtime.runtime,
      lookupColumnsForGridPath: (path) =>
        path === root ? [] : [{ colId: "product_id", valueLookup: lookup }],
    });

    expect(lookup.loadMissingEntries).toHaveBeenCalledWith(["5"]);
    expect(lookup.loadMissingEntries).toHaveBeenCalledWith(["5", "6"]);
    stop();
  });

  it("does not reload when a source emits with the same nodes identity", () => {
    const lookup = makeLookup();
    const source = makeSource([makeNode({ customer_id: "2" })]);
    const runtime = makeRuntime({
      paths: [root],
      sources: new Map([[root, source.source]]),
    });

    const stop = startLoadingValueLookupEntriesForGridRows({
      runtime: runtime.runtime,
      lookupColumnsForGridPath: () => [
        { colId: "customer_id", valueLookup: lookup },
      ],
    });

    source.emit();
    expect(lookup.loadMissingEntries).toHaveBeenCalledTimes(1);

    source.replaceNodes([makeNode({ customer_id: "2" })]);
    expect(lookup.loadMissingEntries).toHaveBeenCalledTimes(2);
    stop();
  });

  it("cleanup unsubscribes source and registry listeners", () => {
    const lookup = makeLookup();
    const source = makeSource([makeNode({ customer_id: "2" })]);
    const runtime = makeRuntime({
      paths: [root],
      sources: new Map([[root, source.source]]),
    });

    const stop = startLoadingValueLookupEntriesForGridRows({
      runtime: runtime.runtime,
      lookupColumnsForGridPath: () => [
        { colId: "customer_id", valueLookup: lookup },
      ],
    });

    expect(source.listenerCount()).toBe(1);
    expect(runtime.registryListenerCount()).toBe(1);

    stop();

    expect(source.listenerCount()).toBe(0);
    expect(runtime.registryListenerCount()).toBe(0);
    source.replaceNodes([makeNode({ customer_id: "3" })]);
    runtime.emitRegistry();
    expect(lookup.loadMissingEntries).toHaveBeenCalledTimes(1);
  });
});
