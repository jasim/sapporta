import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../types/level-row";
import type {
  FetchPageRequest,
  FetchPageResponse,
  PatchCellRequest,
  PatchCellResponse,
  ReconcileEvent,
  WriteCapability,
} from "../types";
import {
  hostBackedRowQuery,
  restLevelSource,
  sourceOwnedRowQuery,
  type RestLevelSourceOpts,
} from "./rest-level-source";

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
  { rowKey: "a", levelName: "rows", columns: { id: "a", v: 1 } },
  { rowKey: "b", levelName: "rows", columns: { id: "b", v: 2 } },
  { rowKey: "c", levelName: "rows", columns: { id: "c", v: 3 } },
];

type TestFilter = Record<string, (value: unknown) => boolean>;

const baseOpts = (
  extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
): RestLevelSourceOpts<TestFilter> => ({
  fetchPage: vi.fn(async () => ({ nodes: fixtureNodes() })),
  rowQuery: sourceOwnedRowQuery({ page: 0, pageSize: 10 }),
  ...extra,
});

type WritableTestSource = ReturnType<typeof restLevelSource> & {
  write: WriteCapability;
};

function requireWrite(
  src: ReturnType<typeof restLevelSource>,
): WriteCapability {
  if (!src.write) throw new Error("expected writable source");
  return src.write;
}

describe("restLevelSource — read surface", () => {
  it("issues exactly one fetchPage on construction; transitions loading → ready on resolve", async () => {
    const fetched = deferred<FetchPageResponse>();
    const fetchPage = vi.fn(async (_req: FetchPageRequest) => fetched.promise);
    const src = restLevelSource(baseOpts({ fetchPage }));

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(src.state().status).toBe("initialLoading");

    fetched.resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await fetched.promise;
    await flush();

    expect(src.state().status).toBe("ready");
    expect(src.state().snapshot.nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect("pagination" in src.state().snapshot).toBe(false);
  });

  it("owns immutable fetched row and footer snapshots", async () => {
    const response = {
      nodes: [
        {
          rowKey: "a",
          levelName: "rows",
          columns: { id: "a", v: 1 },
        },
      ],
      footerRows: [{ rowKey: "total", columns: { v: 1 } }],
    };
    const src = restLevelSource(baseOpts({ fetchPage: async () => response }));
    await flush();
    const ready = src.state();

    response.nodes[0].rowKey = "mutated";
    response.nodes[0].columns.v = 99;
    response.footerRows[0].columns.v = 99;

    expect(src.state()).toBe(ready);
    expect(ready.snapshot.nodes[0].rowKey).toBe("a");
    expect(ready.snapshot.nodes[0].columns.v).toBe(1);
    expect(ready.snapshot.footerRows?.[0].columns.v).toBe(1);
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.snapshot)).toBe(true);
    expect(Object.isFrozen(ready.snapshot.nodes)).toBe(true);
    expect(Object.isFrozen(ready.snapshot.nodes[0].columns)).toBe(true);
  });

  it("propagates fetchPage rejection: status initialLoading → initialError, error.message verbatim", async () => {
    const fetched = deferred<FetchPageResponse>();
    const fetchPage = vi.fn(async () => fetched.promise);
    const src = restLevelSource(baseOpts({ fetchPage }));

    fetched.reject(new Error("500 Internal Server Error — connection refused"));
    await fetched.promise.catch(() => {});
    await flush();

    const state = src.state();
    expect(state.status).toBe("initialError");
    if (state.status !== "initialError")
      throw new Error("expected initialError");
    expect(state.error.message).toBe(
      "500 Internal Server Error — connection refused",
    );
  });

  it("publishes an initial error instead of an invalid identity snapshot", async () => {
    const missingKey = {
      levelName: "rows",
      columns: { id: "missing", v: 1 },
    } as unknown as TreeNode;
    const src = restLevelSource(
      baseOpts({ fetchPage: async () => ({ nodes: [missingKey] }) }),
    );

    await flush();
    const state = src.state();
    expect(state.status).toBe("initialError");
    if (state.status !== "initialError") {
      throw new Error("expected initialError");
    }
    expect(state.snapshot.nodes).toEqual([]);
    expect(state.error.message).toContain("TreeNode.rowKey is required");
  });

  it("preserves the last valid rows when a refresh has duplicate row keys", async () => {
    let fetchCount = 0;
    const fetchPage = vi.fn(async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? { nodes: fixtureNodes() }
        : {
            nodes: [
              { rowKey: "same", levelName: "rows", columns: { id: "one" } },
              { rowKey: "same", levelName: "rows", columns: { id: "two" } },
            ],
          };
    });
    const src = restLevelSource(baseOpts({ fetchPage }));
    await flush();
    const beforeNodes = src.state().snapshot.nodes;

    const result = await src.query!.refetch!();

    expect(result.kind).toBe("error");
    const state = src.state();
    expect(state.status).toBe("refreshError");
    expect(state.snapshot.nodes).toBe(beforeNodes);
    if (state.status !== "refreshError") {
      throw new Error("expected refreshError");
    }
    expect(state.error.message).toContain('duplicate TreeNode.rowKey "same"');
  });

  it("reports throwing subscribers, continues in order, and keeps duplicate registrations independent", async () => {
    const fetched = deferred<FetchPageResponse>();
    const observerError = new Error("observer failed");
    const report = vi.fn();
    const calls: string[] = [];
    const duplicate = vi.fn(() => calls.push("duplicate"));
    const src = restLevelSource(
      baseOpts({
        fetchPage: async () => fetched.promise,
        onObserverError: report,
      }),
    );
    const unsubscribeFirst = src.subscribe(duplicate);
    src.subscribe(() => {
      calls.push("throw");
      throw observerError;
    });
    src.subscribe(duplicate);

    fetched.resolve({ nodes: fixtureNodes() });
    await fetched.promise;
    await flush();

    expect(calls).toEqual(["duplicate", "throw", "duplicate"]);
    expect(report).toHaveBeenCalledWith(observerError);
    unsubscribeFirst();
    await src.query!.refetch!();
    expect(duplicate).toHaveBeenCalledTimes(4);
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

    void src.query!.sort!.set([{ colId: "v", direction: "asc" }]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(calls[1].req.sort).toEqual([{ colId: "v", direction: "asc" }]);

    // Resolve the stale (first) fetch — it should NOT win.
    calls[0].deferred.resolve({
      nodes: [
        {
          rowKey: "stale",
          levelName: "rows",
          columns: { id: "stale", v: 0 },
        },
      ],
      totalCount: 1,
    });
    await calls[0].deferred.promise;
    await flush();
    expect(src.state().status).toBe("initialLoading");

    calls[1].deferred.resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await calls[1].deferred.promise;
    await flush();
    expect(src.state().status).toBe("ready");
    expect(src.state().snapshot.nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("refetch after rowQuery page change cancels the prior fetch; no stale data wins", async () => {
    const calls: Array<ReturnType<typeof deferred<FetchPageResponse>>> = [];
    const fetchPage = vi.fn(async () => {
      const d = deferred<FetchPageResponse>();
      calls.push(d);
      return d.promise;
    });
    const rowQuery = sourceOwnedRowQuery<TestFilter>({
      page: 0,
      pageSize: 10,
    });
    const src = restLevelSource(baseOpts({ fetchPage, rowQuery }));
    rowQuery.setPageState(1, 10);
    void src.query!.refetch!();
    expect(fetchPage).toHaveBeenCalledTimes(2);

    calls[0].resolve({
      nodes: [
        {
          rowKey: "stale-page-0",
          levelName: "rows",
          columns: { id: "stale-page-0", v: 0 },
        },
      ],
    });
    await calls[0].promise;
    await flush();
    expect(src.state().status).toBe("initialLoading");

    calls[1].resolve({ nodes: fixtureNodes(), totalCount: 3 });
    await calls[1].promise;
    await flush();
    expect(src.state().snapshot.nodes.map((n) => n.columns.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("source-owned rowQuery page changes fetch through refetch", async () => {
    const fetchPage = vi.fn(async (req: FetchPageRequest) => ({
      nodes: fixtureNodes().slice(0, req.pageSize),
      totalCount: 30,
    }));
    const rowQuery = sourceOwnedRowQuery<TestFilter>({
      page: 0,
      pageSize: 10,
    });
    const src = restLevelSource(
      baseOpts({
        fetchPage,
        rowQuery,
      }),
    );
    await flush();

    rowQuery.setPageState(1, 10);
    const result = await src.query!.refetch!();
    expect(result.kind).toBe("ready");
    expect(fetchPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 });
  });

  it("source-owned rowQuery rejects non-integer pagination windows", () => {
    const rowQuery = sourceOwnedRowQuery({ page: 0, pageSize: 10 });

    expect(() => rowQuery.setPageState(1.5, 10)).toThrow(
      /page must be an integer/,
    );
    expect(() => rowQuery.setPageState(1, 0)).toThrow(
      /pageSize must be an integer/,
    );
  });

  it("REST snapshots omit query metadata", async () => {
    const src = restLevelSource(baseOpts());
    await flush();
    expect("sort" in src.state().snapshot).toBe(false);
    expect("filter" in src.state().snapshot).toBe(false);
    expect("serverManaged" in src.state().snapshot).toBe(false);
  });

  it("resolves an older load as superseded when a newer refetch starts", async () => {
    const calls: Array<ReturnType<typeof deferred<FetchPageResponse>>> = [];
    const fetchPage = vi.fn(async () => {
      const d = deferred<FetchPageResponse>();
      calls.push(d);
      return d.promise;
    });
    const src = restLevelSource(baseOpts({ fetchPage }));
    expect(calls).toHaveLength(1);

    const first = src.query!.refetch!();
    const second = src.query!.refetch!();

    await expect(first).resolves.toEqual({ kind: "superseded" });

    calls[2].resolve({ nodes: fixtureNodes() });
    const result = await second;
    expect(result.kind).toBe("ready");
    expect(src.state().status).toBe("ready");
  });

  it("resolves a pending load as disposed when the source is disposed", async () => {
    const fetched = deferred<FetchPageResponse>();
    const fetchPage = vi.fn(async () => fetched.promise);
    const src = restLevelSource(baseOpts({ fetchPage }));

    const load = src.query!.refetch!();
    src.dispose();

    await expect(load).resolves.toEqual({ kind: "disposed" });
  });
});

describe("restLevelSource — host-backed row query", () => {
  it("refetch() calls current() and forwards the built request to fetchPage", async () => {
    let cur: FetchPageRequest = {
      page: 2,
      pageSize: 25,
      sort: [{ colId: "v", direction: "desc" }],
    };
    const current = vi.fn(() => cur);
    const fetchPage = vi.fn(async (_req: FetchPageRequest) => ({
      nodes: fixtureNodes(),
      totalCount: 99,
    }));
    const src = restLevelSource({
      fetchPage,
      rowQuery: hostBackedRowQuery({
        current,
        setSortState: () => "unchanged",
        setFilterState: () => "unchanged",
        setPageState: () => "unchanged",
      }),
    });
    await flush();
    await flush();

    expect(current).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toEqual({
      page: 2,
      pageSize: 25,
      sort: [{ colId: "v", direction: "desc" }],
    });

    cur = {
      page: 5,
      pageSize: 25,
      sort: [{ colId: "v", direction: "asc" }],
    };
    await src.query!.refetch!();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0]).toEqual({
      page: 5,
      pageSize: 25,
      sort: [{ colId: "v", direction: "asc" }],
    });
  });

  it("refetch reads page state from host row query without publishing pagination metadata", async () => {
    let cur: FetchPageRequest = { page: 1, pageSize: 10 };
    const fetchPage = vi.fn(async (_req: FetchPageRequest) => ({
      nodes: fixtureNodes(),
      totalCount: 42,
    }));
    const src = restLevelSource({
      fetchPage,
      rowQuery: hostBackedRowQuery({
        current: () => cur,
        setSortState: () => "unchanged",
        setFilterState: () => "unchanged",
        setPageState: () => "unchanged",
      }),
    });
    await flush();
    await flush();

    expect(fetchPage.mock.calls[0][0]).toEqual({ page: 1, pageSize: 10 });
    expect("pagination" in src.state().snapshot).toBe(false);

    cur = { page: 7, pageSize: 10 };
    await src.query!.refetch!();
    expect(fetchPage.mock.calls[1][0]).toEqual({ page: 7, pageSize: 10 });
    expect("pagination" in src.state().snapshot).toBe(false);
  });

  it("query capabilities reflect sort/filter from the host-owned query", async () => {
    const filter = { v: (value: unknown) => Number(value) > 1 };
    const fetchPage = vi.fn(async (_req: FetchPageRequest<TestFilter>) => ({
      nodes: fixtureNodes(),
    }));
    const src = restLevelSource({
      fetchPage,
      rowQuery: hostBackedRowQuery({
        current: () => ({
          page: 0,
          pageSize: 10,
          sort: [{ colId: "v", direction: "asc" }],
          filter,
        }),
        setSortState: () => "unchanged",
        setFilterState: () => "unchanged",
        setPageState: () => "unchanged",
      }),
    });
    await flush();
    await flush();

    expect(src.query!.sort!.current()).toEqual([
      { colId: "v", direction: "asc" },
    ]);
    expect(src.query!.filter!.current()).toBe(filter);
    expect("sort" in src.state().snapshot).toBe(false);
    expect("filter" in src.state().snapshot).toBe(false);
  });

  it("query sort/filter mutate host state and fetch; host page changes refetch explicitly", async () => {
    let cur: FetchPageRequest<TestFilter> = {
      page: 0,
      pageSize: 10,
    };
    const fetchPage = vi.fn(async (_req: FetchPageRequest<TestFilter>) => ({
      nodes: fixtureNodes(),
    }));
    const src = restLevelSource<TestFilter>({
      fetchPage,
      rowQuery: hostBackedRowQuery({
        current: () => cur,
        setSortState: (sort) => {
          cur = { ...cur, sort };
          return "changed";
        },
        setFilterState: (filter) => {
          cur = { ...cur, filter };
          return "changed";
        },
        setPageState: (page, pageSize) => {
          cur = { ...cur, page, pageSize };
          return "changed";
        },
      }),
    });
    await flush();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    await src.query!.sort!.set([{ colId: "v", direction: "asc" }]);
    await src.query!.filter!.set({ v: () => true });
    cur = { ...cur, page: 99, pageSize: 99 };
    await src.query!.refetch!();

    expect(fetchPage).toHaveBeenCalledTimes(4);
    expect(fetchPage.mock.calls[1][0].sort).toEqual([
      { colId: "v", direction: "asc" },
    ]);
    expect(fetchPage.mock.calls[2][0].filter).toEqual({ v: expect.anything() });
    expect(fetchPage.mock.calls[3][0]).toMatchObject({
      page: 99,
      pageSize: 99,
    });
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
      rowQuery: hostBackedRowQuery({
        current: () => ({ page: 0, pageSize: 10 }),
        setSortState: () => "unchanged",
        setFilterState: () => "unchanged",
        setPageState: () => "unchanged",
      }),
      patchCell,
      insertNode: async (req) => req.node,
      removeNode: async () => {},
    });
    const write = requireWrite(src);
    await flush();
    await flush();

    const events: ReconcileEvent[] = [];
    write.onReconcile((e) => events.push(e));

    write.setCell("a", "v", 42);
    expect(src.state().snapshot.nodes[0].columns.v).toBe(42);

    patches[0].resolve({ value: 42 });
    await patches[0].promise;
    await flush();

    expect(events).toEqual([
      { kind: "agreed", rowKey: "a", colId: "v", value: 42 },
    ]);
  });
});

describe("restLevelSource — read-only / writable discrimination", () => {
  it("with no edit endpoints supplied, omits the write capability", () => {
    const src = restLevelSource(baseOpts());
    expect(src.write).toBeUndefined();
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

  it("with all three edit endpoints, exposes a write capability", () => {
    const src = restLevelSource(
      baseOpts({
        patchCell: async () => ({ value: 0 }),
        insertNode: async (req) => req.node,
        removeNode: async () => {},
      }),
    );
    expect(src.write).toBeDefined();
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
  ): Promise<WritableTestSource> {
    const src = restLevelSource(writableOpts(extra));
    requireWrite(src);
    // Drain the initial fetchPage microtasks.
    await flush();
    await flush();
    return src as WritableTestSource;
  }

  it("agreed: server returns the optimistic value; nodes unchanged after confirm", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const patchCell = vi.fn(async (_req: PatchCellRequest) => {
      const d = deferred<PatchCellResponse>();
      patches.push(d);
      return d.promise;
    });
    const src = await readyWritable({ patchCell });
    const write = src.write;

    const events: ReconcileEvent[] = [];
    write.onReconcile((e) => events.push(e));

    write.setCell("a", "v", 99);
    expect(src.state().snapshot.nodes[0].columns.v).toBe(99);

    patches[0].resolve({ value: 99 });
    await patches[0].promise;
    await flush();

    expect(events).toEqual([
      { kind: "agreed", rowKey: "a", colId: "v", value: 99 },
    ]);
    expect(src.state().snapshot.nodes[0].columns.v).toBe(99);
  });

  it("diverged: nodes update to authoritative value before the event fires", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const patchCell = vi.fn(async () => {
      const d = deferred<PatchCellResponse>();
      patches.push(d);
      return d.promise;
    });
    const src = await readyWritable({ patchCell });
    const write = src.write;

    const events: ReconcileEvent[] = [];
    let nodesAtEvent: readonly TreeNode[] | null = null;
    write.onReconcile((e) => {
      events.push(e);
      nodesAtEvent = src.state().snapshot.nodes;
    });

    write.setCell("a", "v", 99);
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
    const write = src.write;

    const events: ReconcileEvent[] = [];
    write.onReconcile((e) => events.push(e));

    write.setCell("a", "v", 99);
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
    expect(src.state().snapshot.nodes[0].columns.v).toBe(99);
    expect(src.state().status).toBe("ready");
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
    const write = src.write;

    const events: ReconcileEvent[] = [];
    write.onReconcile((e) => events.push(e));

    write.setCell("a", "v", 99);
    write.setCell("a", "v", 100);
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
    expect(src.state().snapshot.nodes[0].columns.v).toBe(100);
  });

  it("two setCell on different cells of the same row: both PATCHes issue independently", async () => {
    const patchCell = vi.fn(async (_req: PatchCellRequest) => ({
      value: _req.value,
    }));
    const src = await readyWritable({ patchCell });
    const write = src.write;

    write.setCell("a", "v", 99);
    write.setCell("a", "id", "z");
    expect(patchCell).toHaveBeenCalledTimes(2);
    const colIds = patchCell.mock.calls.map((c) => c[0].colId).sort();
    expect(colIds).toEqual(["id", "v"]);
  });

  it("rejects a full-row response that changes identity without publishing it", async () => {
    const patches: Array<ReturnType<typeof deferred<PatchCellResponse>>> = [];
    const src = await readyWritable({
      patchCell: async () => {
        const patch = deferred<PatchCellResponse>();
        patches.push(patch);
        return patch.promise;
      },
    });
    const events: ReconcileEvent[] = [];
    src.write.onReconcile((event) => events.push(event));

    src.write.setCell("a", "v", 9);
    const optimistic = src.state().snapshot;
    patches[0].resolve({
      kind: "row",
      node: {
        rowKey: "changed-a",
        levelName: "rows",
        columns: { id: "a", v: 10 },
      },
    });
    await patches[0].promise;
    await flush();

    expect(src.state().snapshot).toBe(optimistic);
    expect(src.state().snapshot.nodes[0].rowKey).toBe("a");
    expect(events).toEqual([
      expect.objectContaining({
        kind: "rejected",
        rowKey: "a",
        reason: expect.stringContaining("TreeNode.rowKey changed"),
      }),
    ]);
  });

  it("isolates reconcile observers and keeps duplicate callbacks independently registered", async () => {
    const observerError = new Error("reconcile observer failed");
    const report = vi.fn();
    const calls: string[] = [];
    const duplicate = vi.fn(() => calls.push("duplicate"));
    const src = await readyWritable({
      patchCell: async (request) => ({ value: request.value }),
      onObserverError: report,
    });
    const unsubscribeFirst = src.write.onReconcile(duplicate);
    src.write.onReconcile(() => {
      calls.push("throw");
      throw observerError;
    });
    src.write.onReconcile(duplicate);

    src.write.setCell("a", "v", 11);
    await flush();
    expect(calls).toEqual(["duplicate", "throw", "duplicate"]);
    expect(report).toHaveBeenCalledWith(observerError);

    unsubscribeFirst();
    src.write.setCell("a", "v", 12);
    await flush();
    expect(duplicate).toHaveBeenCalledTimes(3);
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
  ): Promise<WritableTestSource> {
    const src = restLevelSource(writableOpts(extra));
    requireWrite(src);
    await flush();
    await flush();
    return src as WritableTestSource;
  }

  it("all PATCHes succeed: every change applies, agreed events fire per cell", async () => {
    const src = await readyWritable();
    const write = src.write;

    const events: ReconcileEvent[] = [];
    write.onReconcile((e) => events.push(e));

    write.applyChanges([
      { rowKey: "a", colId: "v", value: 10 },
      { rowKey: "b", colId: "v", value: 20 },
    ]);
    expect(src.state().snapshot.nodes[0].columns.v).toBe(10);
    expect(src.state().snapshot.nodes[1].columns.v).toBe(20);

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
    const write = src.write;

    const events: ReconcileEvent[] = [];
    write.onReconcile((e) => events.push(e));

    write.applyChanges([
      { rowKey: "a", colId: "v", value: 10 },
      { rowKey: "b", colId: "v", value: 20 },
    ]);
    // Optimistic state visible immediately.
    expect(src.state().snapshot.nodes[0].columns.v).toBe(10);
    expect(src.state().snapshot.nodes[1].columns.v).toBe(20);

    await flush();
    await flush();
    await flush();
    // Atomic revert.
    expect(src.state().snapshot.nodes[0].columns.v).toBe(1);
    expect(src.state().snapshot.nodes[1].columns.v).toBe(2);
    expect(events.map((e) => e.kind)).toEqual(["rejected", "rejected"]);
    expect(
      events.map((e) => (e.kind === "rejected" ? e.priorValue : undefined)),
    ).toEqual([1, 2]);
  });
});

describe("restLevelSource — createNode", () => {
  async function readyWritable(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ): Promise<WritableTestSource> {
    const src = restLevelSource(
      baseOpts({
        patchCell: async () => ({ value: 0 }),
        insertNode: async (req) => req.node,
        removeNode: async () => {},
        ...extra,
      }),
    );
    requireWrite(src);
    await flush();
    await flush();
    return src as WritableTestSource;
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
    const write = src.write;

    const draft: TreeNode = {
      rowKey: "draft-d",
      levelName: "rows",
      columns: { v: 4 },
    };
    const promise = write.createNode(draft);
    expect(src.state().snapshot.nodes).toHaveLength(3);

    const serverNode = {
      rowKey: "d",
      levelName: "rows",
      columns: { id: "d", v: 40 },
    };
    creates[0].resolve(serverNode);
    await expect(promise).resolves.toEqual({ node: serverNode, atIndex: 3 });
    await flush();

    expect(src.state().snapshot.nodes).toHaveLength(4);
    expect(src.state().snapshot.nodes[3]).toStrictEqual(serverNode);
    expect(src.state().snapshot.nodes[3] === serverNode).toBe(false);
    serverNode.rowKey = "mutated";
    serverNode.columns.v = 99;
    expect(src.state().snapshot.nodes[3].rowKey).toBe("d");
    expect(src.state().snapshot.nodes[3].columns.v).toBe(40);
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
    const write = src.write;

    const first = write.createNode({
      rowKey: "d",
      levelName: "rows",
      columns: { id: "d", v: 4 },
    });
    const second = write.createNode({
      rowKey: "e",
      levelName: "rows",
      columns: { id: "e", v: 5 },
    });

    const secondServerNode: TreeNode = {
      rowKey: "e",
      levelName: "rows",
      columns: { id: "e", v: 50 },
    };
    creates[1].resolve(secondServerNode);
    await expect(second).resolves.toEqual({
      node: secondServerNode,
      atIndex: 3,
    });

    const firstServerNode: TreeNode = {
      rowKey: "d",
      levelName: "rows",
      columns: { id: "d", v: 40 },
    };
    creates[0].resolve(firstServerNode);
    await expect(first).resolves.toEqual({
      node: firstServerNode,
      atIndex: 4,
    });

    expect(src.state().snapshot.nodes.map((node) => node.columns.id)).toEqual([
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
    const write = src.write;
    const before = src.state().snapshot.nodes;

    await expect(
      write.createNode({
        rowKey: "draft",
        levelName: "rows",
        columns: { v: 4 },
      }),
    ).rejects.toThrow("nope");

    expect(src.state().snapshot.nodes).toBe(before);
  });

  it("validates the create input before calling the endpoint", async () => {
    const insertNode = vi.fn(
      async (request: { node: TreeNode }) => request.node,
    );
    const src = await readyWritable({ insertNode });
    const before = src.state().snapshot;

    await expect(
      src.write.createNode({ rowKey: "", levelName: "rows", columns: {} }),
    ).rejects.toThrow("TreeNode.rowKey must be non-empty");

    expect(insertNode).not.toHaveBeenCalled();
    expect(src.state().snapshot).toBe(before);
  });

  it("rejects a duplicate authoritative create before publication", async () => {
    const src = await readyWritable({
      insertNode: async () => ({
        rowKey: "a",
        levelName: "rows",
        columns: { id: "server-a", v: 40 },
      }),
    });
    const before = src.state().snapshot;
    const subscriber = vi.fn();
    src.subscribe(subscriber);

    await expect(
      src.write.createNode({
        rowKey: "provisional",
        levelName: "rows",
        columns: { v: 4 },
      }),
    ).rejects.toThrow('duplicate TreeNode.rowKey "a"');

    expect(src.state().snapshot).toBe(before);
    expect(subscriber).not.toHaveBeenCalled();
  });
});

describe("restLevelSource — removeNode", () => {
  async function readyWritable(
    extra: Partial<RestLevelSourceOpts<TestFilter>> = {},
  ): Promise<WritableTestSource> {
    const src = restLevelSource(
      baseOpts({
        patchCell: async () => ({ value: 0 }),
        insertNode: async (req) => req.node,
        removeNode: async () => {},
        ...extra,
      }),
    );
    requireWrite(src);
    await flush();
    await flush();
    return src as WritableTestSource;
  }

  it("keeps rows unchanged while delete is pending and when it rejects", async () => {
    const deletion = deferred<void>();
    const src = await readyWritable({
      removeNode: async () => deletion.promise,
    });
    const write = src.write;
    const before = src.state().snapshot;
    const subscriber = vi.fn();
    src.subscribe(subscriber);

    const removal = write.removeNode("b");
    expect(src.state().snapshot).toBe(before);
    expect(subscriber).not.toHaveBeenCalled();

    deletion.reject(new Error("delete denied"));
    await expect(removal).rejects.toThrow("delete denied");
    expect(src.state().snapshot).toBe(before);
    expect(src.state().snapshot.nodes.map((node) => node.rowKey)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("removes from the latest nodes after the endpoint succeeds", async () => {
    const deletion = deferred<void>();
    let fetchCount = 0;
    const src = await readyWritable({
      fetchPage: async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? { nodes: fixtureNodes() }
          : {
              nodes: [
                ...fixtureNodes(),
                { rowKey: "d", levelName: "rows", columns: { id: "d", v: 4 } },
              ],
            };
      },
      removeNode: async () => deletion.promise,
    });

    const removal = src.write.removeNode("b");
    expect(src.state().snapshot.nodes.map((node) => node.rowKey)).toEqual([
      "a",
      "b",
      "c",
    ]);

    await src.query!.refetch!();
    deletion.resolve(undefined);
    await removal;

    expect(src.state().snapshot.nodes.map((node) => node.rowKey)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("treats a successful delete as a no-op when a refresh already removed the row", async () => {
    const deletion = deferred<void>();
    let fetchCount = 0;
    const src = await readyWritable({
      fetchPage: async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? { nodes: fixtureNodes() }
          : { nodes: fixtureNodes().filter((node) => node.rowKey !== "b") };
      },
      removeNode: async () => deletion.promise,
    });

    const removal = src.write.removeNode("b");
    await src.query!.refetch!();
    const refreshed = src.state().snapshot;
    const subscriber = vi.fn();
    src.subscribe(subscriber);

    deletion.resolve(undefined);
    await removal;

    expect(src.state().snapshot).toBe(refreshed);
    expect(subscriber).not.toHaveBeenCalled();
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
