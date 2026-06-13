import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../types/level-row";
import type {
  FetchPageRequest,
  FetchPageResponse,
  PatchCellRequest,
  PatchCellResponse,
  ReconcileEvent,
} from "../types";
import { restLevelSource, type RestLevelSourceOpts } from "./rest-level-source";

// A controllable promise — lets a test resolve / reject the host side
// of a `fetchPage` or `patchCell` call deterministically.
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

// Drain any pending microtasks. The source's promise chain has up to
// three awaits between `Promise.resolve()` and the visible state flip
// (outer .then → host's async fn → handler), so a tight loop guarantees
// we observe the settled state regardless of the chain's depth.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const fixtureNodes = (): TreeNode[] => [
  { levelName: "rows", columns: { id: "a", v: 1 } },
  { levelName: "rows", columns: { id: "b", v: 2 } },
  { levelName: "rows", columns: { id: "c", v: 3 } },
];

type TestFilter = Record<string, (value: unknown) => boolean>;

const baseOpts = (
  extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
): RestLevelSourceOpts<TestFilter> => ({
  fetchPage: vi.fn(async () => ({ nodes: fixtureNodes() })),
  initialPagination: { page: 0, pageSize: 10 },
  serverManaged: { sort: true, filter: true, pagination: true },
  rowKey: (n) => String(n.columns.id),
  ...extra,
});

describe("restLevelSource — read surface", () => {
  it("issues exactly one fetchPage on construction; transitions loading → ready on resolve", async () => {
    const fetched = deferred<FetchPageResponse>();
    const fetchPage = vi.fn(async (_req: FetchPageRequest) => fetched.promise);
    const src = restLevelSource(baseOpts({ fetchPage }));

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(src.snapshot().status).toBe("loading");

    fetched.resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await fetched.promise;
    await flush();

    expect(src.snapshot().status).toBe("ready");
    expect(src.snapshot().nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(src.snapshot().pagination).toEqual({
      page: 0,
      pageSize: 10,
      totalCount: 3,
    });
  });

  it("propagates fetchPage rejection: status loading → error, error.message verbatim", async () => {
    const fetched = deferred<FetchPageResponse>();
    const fetchPage = vi.fn(async () => fetched.promise);
    const src = restLevelSource(baseOpts({ fetchPage }));

    fetched.reject(new Error("500 Internal Server Error — connection refused"));
    await fetched.promise.catch(() => {});
    await flush();

    const snap = src.snapshot();
    expect(snap.status).toBe("error");
    expect(snap.error?.message).toBe(
      "500 Internal Server Error — connection refused",
    );
  });

  it("setSort triggers exactly one refetch and cancels in-flight prior fetch", async () => {
    const calls: Array<{
      req: FetchPageRequest;
      deferred: ReturnType<typeof deferred<FetchPageResponse>>;
    }> = [];
    const fetchPage = vi.fn(async (req: FetchPageRequest) => {
      const d = deferred<FetchPageResponse>();
      calls.push({ req, deferred: d });
      return d.promise;
    });
    const src = restLevelSource(baseOpts({ fetchPage }));
    expect(calls).toHaveLength(1);

    src.setSort([{ colId: "v", direction: "asc" }]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(calls[1].req.sort).toEqual([{ colId: "v", direction: "asc" }]);

    // Resolve the stale (first) fetch — it should NOT win.
    calls[0].deferred.resolve({
      nodes: [{ levelName: "rows", columns: { id: "stale", v: 0 } }],
      totalCount: 1,
    });
    await calls[0].deferred.promise;
    await flush();
    expect(src.snapshot().status).toBe("loading");

    calls[1].deferred.resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await calls[1].deferred.promise;
    await flush();
    expect(src.snapshot().status).toBe("ready");
    expect(src.snapshot().nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("setPage while a previous fetch is in flight: prior is cancelled, no stale data wins", async () => {
    const calls: Array<ReturnType<typeof deferred<FetchPageResponse>>> = [];
    const fetchPage = vi.fn(async () => {
      const d = deferred<FetchPageResponse>();
      calls.push(d);
      return d.promise;
    });
    const src = restLevelSource(baseOpts({ fetchPage }));
    src.setPage(1, 10);
    expect(fetchPage).toHaveBeenCalledTimes(2);

    calls[0].resolve({
      nodes: [{ levelName: "rows", columns: { id: "stale-page-0", v: 0 } }],
    });
    await calls[0].promise;
    await flush();
    expect(src.snapshot().status).toBe("loading");

    calls[1].resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await calls[1].promise;
    await flush();
    expect(src.snapshot().pagination?.page).toBe(1);
    expect(src.snapshot().nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("setSort with serverManaged.sort=false updates state without refetching", async () => {
    const fetchPage = vi.fn(async () => ({
      nodes: fixtureNodes(),
      totalCount: 3,
    }));
    const src = restLevelSource(
      baseOpts({
        fetchPage,
        serverManaged: { sort: false, filter: false, pagination: true },
        compileFilter: () => undefined,
      }),
    );
    await flush();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    src.setSort([{ colId: "v", direction: "asc" }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(src.snapshot().sort).toEqual([{ colId: "v", direction: "asc" }]);
  });

  it("snapshot carries serverManaged unchanged from opts", async () => {
    const src = restLevelSource(
      baseOpts({
        serverManaged: { sort: true, filter: false, pagination: true },
        compileFilter: () => undefined,
      }),
    );
    await flush();
    expect(src.snapshot().serverManaged).toEqual({
      sort: true,
      filter: false,
      pagination: true,
    });
  });
});

describe("restLevelSource — host-owned query", () => {
  it("refetch() calls query() and forwards the result to fetchPage", async () => {
    const queryFn = vi.fn<() => FetchPageRequest>(() => ({
      page: 2,
      pageSize: 25,
      sort: [{ colId: "v", direction: "desc" }],
    }));
    const fetchPage = vi.fn(async (_req: FetchPageRequest) => ({
      nodes: fixtureNodes(),
      totalCount: 99,
    }));
    const src = restLevelSource({
      fetchPage,
      query: queryFn,
      serverManaged: { sort: true, filter: true, pagination: true },
      rowKey: (n) => String(n.columns.id),
    });
    await flush();
    await flush();

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toEqual({
      page: 2,
      pageSize: 25,
      sort: [{ colId: "v", direction: "desc" }],
    });

    queryFn.mockReturnValue({
      page: 5,
      pageSize: 25,
      sort: [{ colId: "v", direction: "asc" }],
    });
    src.refetch();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0]).toEqual({
      page: 5,
      pageSize: 25,
      sort: [{ colId: "v", direction: "asc" }],
    });
  });

  it("snapshot.pagination.page reflects the current query() and totalCount from last response", async () => {
    let cur: FetchPageRequest = { page: 1, pageSize: 10 };
    const fetchPage = vi.fn(async () => ({
      nodes: fixtureNodes(),
      totalCount: 42,
    }));
    const src = restLevelSource({
      fetchPage,
      query: () => cur,
      serverManaged: { sort: true, filter: true, pagination: true },
      rowKey: (n) => String(n.columns.id),
    });
    await flush();
    await flush();

    expect(src.snapshot().pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalCount: 42,
    });

    cur = { page: 7, pageSize: 10 };
    src.refetch();
    await flush();
    await flush();
    expect(src.snapshot().pagination).toEqual({
      page: 7,
      pageSize: 10,
      totalCount: 42,
    });
  });

  it("snapshot omits sort/filter in host-owned mode — chrome reads from the host store, not the snapshot", async () => {
    const fetchPage = vi.fn(async () => ({ nodes: fixtureNodes() }));
    const src = restLevelSource({
      fetchPage,
      query: () => ({
        page: 0,
        pageSize: 10,
        sort: [{ colId: "v", direction: "asc" }],
      }),
      serverManaged: { sort: true, filter: true, pagination: true },
      rowKey: (n) => String(n.columns.id),
    });
    await flush();
    await flush();

    const snap = src.snapshot();
    expect(snap.sort).toBeUndefined();
    expect(snap.filter).toBeUndefined();
  });

  it("setSort / setFilter / setPage are no-ops when query is provided", async () => {
    const queryFn = vi.fn<() => FetchPageRequest>(() => ({
      page: 0,
      pageSize: 10,
    }));
    const fetchPage = vi.fn(async () => ({ nodes: fixtureNodes() }));
    const src = restLevelSource({
      fetchPage,
      query: queryFn,
      serverManaged: { sort: true, filter: true, pagination: true },
      rowKey: (n) => String(n.columns.id),
    });
    await flush();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    src.setSort([{ colId: "v", direction: "asc" }]);
    src.setFilter({ v: () => true });
    src.setPage(99, 99);

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("throws at construction when both `query` and `initialPagination` are omitted", () => {
    expect(() =>
      restLevelSource({
        fetchPage: async () => ({ nodes: [] }),
        serverManaged: { sort: true, filter: true, pagination: true },
      }),
    ).toThrow(/initialPagination is required when `query` is not provided/);
  });

  it("edit lifecycle is identical: setCell agreed reconciles like source-owned mode", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const patchCell = vi.fn(async (_req: PatchCellRequest) => {
      const d = deferred<PatchCellResponse>();
      patches.push(d);
      return d.promise;
    });
    const src = restLevelSource({
      fetchPage: async () => ({ nodes: fixtureNodes(), totalCount: 3 }),
      query: () => ({ page: 0, pageSize: 10 }),
      serverManaged: { sort: true, filter: true, pagination: true },
      rowKey: (n) => String(n.columns.id),
      patchCell,
      insertNode: async (req) => req.node,
      removeNode: async () => {},
    });
    if (!src.writable) throw new Error("writable");
    await flush();
    await flush();

    const events: ReconcileEvent[] = [];
    src.onReconcile((e) => events.push(e));

    src.setCell("a", "v", 42);
    expect(src.snapshot().nodes[0].columns.v).toBe(42);

    patches[0].resolve({ value: 42 });
    await patches[0].promise;
    await flush();

    expect(events).toEqual([
      { kind: "agreed", rowKey: "a", colId: "v", value: 42 },
    ]);
  });
});

describe("restLevelSource — read-only / writable discrimination", () => {
  it("with no edit endpoints supplied, returns a ReadonlyLevelDataSource (writable: false)", () => {
    const src = restLevelSource(baseOpts());
    expect(src.writable).toBe(false);
    expect("setCell" in src).toBe(false);
  });

  it("supplying any edit endpoint without all of {patchCell, insertNode, removeNode} throws at construction", () => {
    expect(() =>
      restLevelSource(
        baseOpts({
          patchCell: async () => ({ value: 0 }),
        }),
      ),
    ).toThrow(/all of \{patchCell, insertNode, removeNode\} must be wired/);
  });

  it("with all three edit endpoints, returns a writable source", () => {
    const src = restLevelSource(
      baseOpts({
        patchCell: async () => ({ value: 0 }),
        insertNode: async (req) => req.node,
        removeNode: async () => {},
      }),
    );
    expect(src.writable).toBe(true);
  });
});

describe("restLevelSource — setCell reconciliation", () => {
  function writableOpts(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ): RestLevelSourceOpts<TestFilter> {
    return baseOpts({
      patchCell: async () => ({ value: 0 }),
      insertNode: async (req) => req.node,
      removeNode: async () => {},
      ...extra,
    });
  }

  async function readyWritable(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ) {
    const src = restLevelSource(writableOpts(extra));
    if (!src.writable) throw new Error("expected writable source");
    // Drain the initial fetchPage microtasks.
    await flush();
    await flush();
    return src;
  }

  it("agreed: server returns the optimistic value; nodes unchanged after confirm", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const patchCell = vi.fn(async (_req: PatchCellRequest) => {
      const d = deferred<PatchCellResponse>();
      patches.push(d);
      return d.promise;
    });
    const src = await readyWritable({ patchCell });
    if (!src.writable) throw new Error("writable");

    const events: ReconcileEvent[] = [];
    src.onReconcile((e) => events.push(e));

    src.setCell("a", "v", 99);
    expect(src.snapshot().nodes[0].columns.v).toBe(99);

    patches[0].resolve({ value: 99 });
    await patches[0].promise;
    await flush();

    expect(events).toEqual([
      { kind: "agreed", rowKey: "a", colId: "v", value: 99 },
    ]);
    expect(src.snapshot().nodes[0].columns.v).toBe(99);
  });

  it("diverged: nodes update to authoritative value before the event fires", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const patchCell = vi.fn(async () => {
      const d = deferred<PatchCellResponse>();
      patches.push(d);
      return d.promise;
    });
    const src = await readyWritable({ patchCell });
    if (!src.writable) throw new Error("writable");

    const events: ReconcileEvent[] = [];
    let nodesAtEvent: TreeNode[] | null = null;
    src.onReconcile((e) => {
      events.push(e);
      nodesAtEvent = src.snapshot().nodes;
    });

    src.setCell("a", "v", 99);
    patches[0].resolve({ value: 100 }); // server normalized
    await patches[0].promise;
    await flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "diverged",
      rowKey: "a",
      colId: "v",
      optimisticValue: 99,
      authoritativeValue: 100,
      priorValue: 1,
    });
    expect(nodesAtEvent![0].columns.v).toBe(100);
  });

  it("rejected: optimistic value stands; status stays ready; reason verbatim", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const patchCell = vi.fn(async () => {
      const d = deferred<PatchCellResponse>();
      patches.push(d);
      return d.promise;
    });
    const src = await readyWritable({ patchCell });
    if (!src.writable) throw new Error("writable");

    const events: ReconcileEvent[] = [];
    src.onReconcile((e) => events.push(e));

    src.setCell("a", "v", 99);
    patches[0].reject(new Error("403 Forbidden — column read-only"));
    await patches[0].promise.catch(() => {});
    await flush();

    expect(events).toEqual([
      {
        kind: "rejected",
        rowKey: "a",
        colId: "v",
        optimisticValue: 99,
        reason: "403 Forbidden — column read-only",
        priorValue: 1,
      },
    ]);
    expect(src.snapshot().nodes[0].columns.v).toBe(99);
    expect(src.snapshot().status).toBe("ready");
  });

  it("two setCell on same cell: first PATCH cancelled, last-write-wins", async () => {
    const patches: Array<{
      req: PatchCellRequest;
      deferred: ReturnType<typeof deferred<PatchCellResponse>>;
    }> = [];
    const patchCell = vi.fn(async (req: PatchCellRequest) => {
      const d = deferred<PatchCellResponse>();
      patches.push({ req, deferred: d });
      return d.promise;
    });
    const src = await readyWritable({ patchCell });
    if (!src.writable) throw new Error("writable");

    const events: ReconcileEvent[] = [];
    src.onReconcile((e) => events.push(e));

    src.setCell("a", "v", 99);
    src.setCell("a", "v", 100);
    expect(patches).toHaveLength(2);

    // Resolve the FIRST (superseded) one — it should NOT emit reconcile.
    patches[0].deferred.resolve({ value: 99 });
    await patches[0].deferred.promise;
    await flush();
    expect(events).toEqual([]);

    patches[1].deferred.resolve({ value: 100 });
    await patches[1].deferred.promise;
    await flush();
    expect(events).toEqual([
      { kind: "agreed", rowKey: "a", colId: "v", value: 100 },
    ]);
    expect(src.snapshot().nodes[0].columns.v).toBe(100);
  });

  it("two setCell on different cells of the same row: both PATCHes issue independently", async () => {
    const patchCell = vi.fn(async (_req: PatchCellRequest) => ({
      value: _req.value,
    }));
    const src = await readyWritable({ patchCell });
    if (!src.writable) throw new Error("writable");

    src.setCell("a", "v", 99);
    src.setCell("a", "id", "z");
    expect(patchCell).toHaveBeenCalledTimes(2);
    const colIds = patchCell.mock.calls.map((c) => c[0].colId).sort();
    expect(colIds).toEqual(["id", "v"]);
  });
});

describe("restLevelSource — applyChanges atomicity", () => {
  function writableOpts(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ): RestLevelSourceOpts<TestFilter> {
    return baseOpts({
      patchCell: async (req) => ({ value: req.value }),
      insertNode: async (req) => req.node,
      removeNode: async () => {},
      ...extra,
    });
  }

  async function readyWritable(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ) {
    const src = restLevelSource(writableOpts(extra));
    if (!src.writable) throw new Error("expected writable source");
    await flush();
    await flush();
    return src;
  }

  it("all PATCHes succeed: every change applies, agreed events fire per cell", async () => {
    const src = await readyWritable();
    if (!src.writable) throw new Error("writable");

    const events: ReconcileEvent[] = [];
    src.onReconcile((e) => events.push(e));

    src.applyChanges([
      { rowKey: "a", colId: "v", value: 10 },
      { rowKey: "b", colId: "v", value: 20 },
    ]);
    expect(src.snapshot().nodes[0].columns.v).toBe(10);
    expect(src.snapshot().nodes[1].columns.v).toBe(20);

    await flush();
    await flush();
    expect(events.map((e) => e.kind)).toEqual(["agreed", "agreed"]);
  });

  it("any PATCH rejects: every change reverts to prior, rejected events fire per cell", async () => {
    const patchCell = vi.fn(async (req: PatchCellRequest) => {
      if (req.rowKey === "b") throw new Error("conflict");
      return { value: req.value };
    });
    const src = await readyWritable({ patchCell });
    if (!src.writable) throw new Error("writable");

    const events: ReconcileEvent[] = [];
    src.onReconcile((e) => events.push(e));

    src.applyChanges([
      { rowKey: "a", colId: "v", value: 10 },
      { rowKey: "b", colId: "v", value: 20 },
    ]);
    // Optimistic state visible immediately.
    expect(src.snapshot().nodes[0].columns.v).toBe(10);
    expect(src.snapshot().nodes[1].columns.v).toBe(20);

    await flush();
    await flush();
    await flush();
    // Atomic revert.
    expect(src.snapshot().nodes[0].columns.v).toBe(1);
    expect(src.snapshot().nodes[1].columns.v).toBe(2);
    expect(events.map((e) => e.kind)).toEqual(["rejected", "rejected"]);
    expect(
      events.map((e) => (e.kind === "rejected" ? e.priorValue : undefined)),
    ).toEqual([1, 2]);
  });
});

describe("restLevelSource — createNode", () => {
  async function readyWritable(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ) {
    const src = restLevelSource(
      baseOpts({
        patchCell: async () => ({ value: 0 }),
        insertNode: async (req) => req.node,
        removeNode: async () => {},
        ...extra,
      }),
    );
    if (!src.writable) throw new Error("expected writable source");
    await flush();
    await flush();
    return src;
  }

  it("waits for the endpoint result before inserting the authoritative node", async () => {
    const creates: Array<ReturnType<typeof deferred<TreeNode>>> = [];
    const src = await readyWritable({
      insertNode: async () => {
        const d = deferred<TreeNode>();
        creates.push(d);
        return d.promise;
      },
    });
    if (!src.writable) throw new Error("writable");

    const draft: TreeNode = {
      levelName: "rows",
      columns: { v: 4 },
    };
    const promise = src.createNode(draft);
    expect(src.snapshot().nodes).toHaveLength(3);

    const serverNode: TreeNode = {
      levelName: "rows",
      columns: { id: "d", v: 40 },
    };
    creates[0].resolve(serverNode);
    await expect(promise).resolves.toEqual({ node: serverNode, atIndex: 3 });
    await flush();

    expect(src.snapshot().nodes).toHaveLength(4);
    expect(src.snapshot().nodes[3]).toBe(serverNode);
  });

  it("appends default creates at the index visible after each server response", async () => {
    const creates: Array<ReturnType<typeof deferred<TreeNode>>> = [];
    const src = await readyWritable({
      insertNode: async () => {
        const d = deferred<TreeNode>();
        creates.push(d);
        return d.promise;
      },
    });
    if (!src.writable) throw new Error("writable");

    const first = src.createNode({
      levelName: "rows",
      columns: { id: "d", v: 4 },
    });
    const second = src.createNode({
      levelName: "rows",
      columns: { id: "e", v: 5 },
    });

    const secondServerNode: TreeNode = {
      levelName: "rows",
      columns: { id: "e", v: 50 },
    };
    creates[1].resolve(secondServerNode);
    await expect(second).resolves.toEqual({
      node: secondServerNode,
      atIndex: 3,
    });

    const firstServerNode: TreeNode = {
      levelName: "rows",
      columns: { id: "d", v: 40 },
    };
    creates[0].resolve(firstServerNode);
    await expect(first).resolves.toEqual({
      node: firstServerNode,
      atIndex: 4,
    });

    expect(src.snapshot().nodes.map((node) => node.columns.id)).toEqual([
      "a",
      "b",
      "c",
      "e",
      "d",
    ]);
  });

  it("leaves source nodes unchanged when create rejects", async () => {
    const src = await readyWritable({
      insertNode: async () => {
        throw new Error("nope");
      },
    });
    if (!src.writable) throw new Error("writable");
    const before = src.snapshot().nodes;

    await expect(
      src.createNode({ levelName: "rows", columns: { v: 4 } }),
    ).rejects.toThrow("nope");

    expect(src.snapshot().nodes).toBe(before);
  });
});

describe("restLevelSource — removeNode", () => {
  async function readyWritable(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ) {
    const src = restLevelSource(
      baseOpts({
        patchCell: async () => ({ value: 0 }),
        insertNode: async (req) => req.node,
        removeNode: async () => {},
        ...extra,
      }),
    );
    if (!src.writable) throw new Error("expected writable source");
    await flush();
    await flush();
    return src;
  }

  it("surfaces backend delete failures to the caller", async () => {
    const src = await readyWritable({
      removeNode: async () => {
        throw new Error("delete denied");
      },
    });
    if (!src.writable) throw new Error("writable");

    await expect(src.removeNode("b")).rejects.toThrow("delete denied");
  });
});

describe("restLevelSource — dispose", () => {
  it("dispose stops subscriber notifications and discards in-flight resolutions", async () => {
    const fetched = deferred<FetchPageResponse>();
    const src = restLevelSource(
      baseOpts({ fetchPage: async () => fetched.promise }),
    );
    const sub = vi.fn();
    src.subscribe(sub);

    src.dispose();
    fetched.resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await fetched.promise;
    await flush();

    expect(sub).not.toHaveBeenCalled();
  });
});
