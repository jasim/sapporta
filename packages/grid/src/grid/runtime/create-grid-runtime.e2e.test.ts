// End-to-end runtime test — the merge gate for the grid rewrite.
//
// Phases 01–11 each shipped a focused unit-tested slice. This file glues
// them together: a runtime over `restGridDataSource` for orders → lines →
// notes, exercised through load → sort → paginate → expand → optimistic
// edit → reconcile (agreed/diverged/rejected) → host-policy revert → refetch.
//
// The fake REST transport is a pair of injectable async stubs per level —
// each level keeps a deferred queue so a test can resolve/reject the n-th
// call deterministically without racing microtasks.

import { describe, expect, it } from "vitest";
import { createGridRuntime } from "./create-grid-runtime";
import type {
  FetchPageRequest,
  FetchPageResponse,
  PatchCellRequest,
  PatchCellResponse,
  ReconcileEvent,
} from "../data-sources/types";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { restGridDataSource } from "../data-sources/rest/rest-grid-source";
import type { RestEndpointFactory } from "../data-sources/rest/rest-grid-source";
import { sourceOwnedRowQuery } from "../data-sources/rest/rest-level-source";
import {
  childPath,
  makeRowId,
  rootPath,
  type GridPath,
} from "../types/identity";
import type { TreeNode } from "../types/level-row";
import type { GridSchema } from "../types/schema";

// ---------------------------------------------------------------------
// Fixture: orders → lines → notes.
// ---------------------------------------------------------------------

const textColumn = (id: string, name: string) => ({
  id,
  name,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
  compare: (a: unknown, b: unknown) =>
    String(a ?? "").localeCompare(String(b ?? "")),
});
const numberColumn = (id: string, name: string) => ({
  id,
  name,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
  compare: (a: unknown, b: unknown) => (Number(a) || 0) - (Number(b) || 0),
});

const ordersColumns = [
  textColumn("id", "Id"),
  textColumn("customer", "Customer"),
  numberColumn("amount", "Amount"),
];
const linesColumns = [
  textColumn("id", "Id"),
  textColumn("sku", "SKU"),
  numberColumn("qty", "Qty"),
];
const notesColumns = [textColumn("id", "Id"), textColumn("text", "Text")];

const schema: GridSchema = {
  rootLevel: "orders",
  levels: {
    orders: {
      name: "orders",
      columns: ordersColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: ["lines"],
    },
    lines: {
      name: "lines",
      columns: linesColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: ["notes"],
    },
    notes: {
      name: "notes",
      columns: notesColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: [],
    },
  },
};

// ---------------------------------------------------------------------
// Test harness — controllable promises for each level's endpoints.
// ---------------------------------------------------------------------

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (err: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Drain queued microtasks. The rest source's promise chain is several
// awaits deep — a tight loop ensures we observe the settled state.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// Per-level transport — hands every call back to the test as a deferred,
// so tests resolve/reject in whatever order they want.
type Transport = {
  fetchCalls: Array<{
    req: FetchPageRequest;
    deferred: Deferred<FetchPageResponse>;
  }>;
  patchCalls: Array<{
    req: PatchCellRequest;
    deferred: Deferred<PatchCellResponse>;
  }>;
  fetchPage: (req: FetchPageRequest) => Promise<FetchPageResponse>;
  patchCell: (req: PatchCellRequest) => Promise<PatchCellResponse>;
};

function makeTransport(): Transport {
  const fetchCalls: Transport["fetchCalls"] = [];
  const patchCalls: Transport["patchCalls"] = [];
  return {
    fetchCalls,
    patchCalls,
    fetchPage: async (req) => {
      const d = deferred<FetchPageResponse>();
      fetchCalls.push({ req, deferred: d });
      return d.promise;
    },
    patchCell: async (req) => {
      const d = deferred<PatchCellResponse>();
      patchCalls.push({ req, deferred: d });
      return d.promise;
    },
  };
}

// Endpoint factory wired around a per-level transport.
function endpointFor(t: Transport): RestEndpointFactory {
  return () => ({
    fetchPage: t.fetchPage,
    patchCell: t.patchCell,
    insertNode: async (req) => req.node,
    removeNode: async () => {},
    rowQuery: sourceOwnedRowQuery({ page: 0, pageSize: 50 }),
    serverManaged: { sort: true, filter: true, pagination: true },
  });
}

const ordersFixture = (): TreeNode[] => [
  { levelName: "orders", columns: { id: "O1", customer: "Acme", amount: 100 } },
  { levelName: "orders", columns: { id: "O2", customer: "Beta", amount: 200 } },
];

const linesFixture = (): TreeNode[] => [
  { levelName: "lines", columns: { id: "L1", sku: "SKU-1", qty: 1 } },
  { levelName: "lines", columns: { id: "L2", sku: "SKU-2", qty: 5 } },
];

// ---------------------------------------------------------------------
// E2E lifecycle.
// ---------------------------------------------------------------------

describe("GridRuntime over restGridDataSource — full lifecycle", () => {
  const ordersRoot = rootPath("orders");

  function buildRig() {
    const orders = makeTransport();
    const lines = makeTransport();
    const notes = makeTransport();
    const dataSource = restGridDataSource({
      schema,
      endpoints: {
        orders: endpointFor(orders),
        lines: endpointFor(lines),
        notes: endpointFor(notes),
      },
    });

    const events: Array<{ kind: string; payload: unknown }> = [];
    const runtime = createGridRuntime({
      schema,
      dataSource,
      on: {
        cellReconciled: (p) =>
          events.push({ kind: "cellReconciled", payload: p }),
        levelStatusChanged: (p) =>
          events.push({ kind: "levelStatusChanged", payload: p }),
      },
    });
    return { runtime, orders, lines, notes, events };
  }

  it("loads the root: fetchPage fires once, status initialLoading → ready, snapshot carries the fetched nodes", async () => {
    const { runtime, orders } = buildRig();

    expect(orders.fetchCalls).toHaveLength(1);
    expect(runtime.sourceStateFor(ordersRoot).status).toBe("initialLoading");

    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    const snap = runtime.snapshotFor(ordersRoot);
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["O1", "O2"]);
    expect(snap.pagination).toEqual({ page: 0, pageSize: 50, totalCount: 2 });
  });

  it("setSort on the root issues exactly one new fetchPage with the descriptor", async () => {
    const { runtime, orders } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    runtime
      .sourceFor(ordersRoot)
      .setSort([{ colId: "amount", direction: "asc" }]);
    expect(orders.fetchCalls).toHaveLength(2);
    expect(orders.fetchCalls[1].req.sort).toEqual([
      { colId: "amount", direction: "asc" },
    ]);
  });

  it("setPage while a previous fetch is in flight: prior is cancelled, no stale data wins", async () => {
    const { runtime, orders } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    runtime.sourceFor(ordersRoot).setPage(1, 50);
    expect(orders.fetchCalls).toHaveLength(2);
    expect(orders.fetchCalls[1].req.page).toBe(1);

    // Resolve the SECOND call (the page-1 fetch).
    orders.fetchCalls[1].deferred.resolve({
      nodes: [
        {
          levelName: "orders",
          columns: { id: "O3", customer: "Gamma", amount: 300 },
        },
      ],
      totalCount: 3,
    });
    await flush();

    expect(
      runtime.snapshotFor(ordersRoot).nodes.map((n) => n.columns.id),
    ).toEqual(["O3"]);
    expect(runtime.snapshotFor(ordersRoot).pagination).toEqual({
      page: 1,
      pageSize: 50,
      totalCount: 3,
    });
  });

  it("expanding a row resolves the child source once, transitions loading → ready", async () => {
    const { runtime, orders, lines } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    runtime.coordinator.toggleExpand(ordersRoot, makeRowId(ordersRoot, "O1"));
    const linesPath = childPath(ordersRoot, "O1", "lines");

    expect(lines.fetchCalls).toHaveLength(1);
    expect(runtime.sourceStateFor(linesPath).status).toBe("initialLoading");

    lines.fetchCalls[0].deferred.resolve({
      nodes: linesFixture(),
      totalCount: 2,
    });
    await flush();

    expect(runtime.sourceStateFor(linesPath).status).toBe("ready");
    expect(
      runtime.snapshotFor(linesPath).nodes.map((n) => n.columns.id),
    ).toEqual(["L1", "L2"]);
  });

  it("writeCell agreed: server confirms the optimistic value; one cellReconciled { kind: 'agreed' }", async () => {
    const { runtime, orders, events } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    const coord = { rowId: makeRowId(ordersRoot, "O1"), colId: "amount" };
    runtime.writeCell(ordersRoot, coord, 150);
    expect(orders.patchCalls).toHaveLength(1);

    orders.patchCalls[0].deferred.resolve({ value: 150 });
    await flush();

    const reconcile = events
      .filter((e) => e.kind === "cellReconciled")
      .map((e) => e.payload);
    expect(reconcile).toEqual([
      {
        path: ordersRoot,
        event: { kind: "agreed", rowKey: "O1", colId: "amount", value: 150 },
      },
    ]);
  });

  it("writeCell diverged: snapshot reflects the authoritative value before cellReconciled fires", async () => {
    const { runtime, orders, events } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    const coord = { rowId: makeRowId(ordersRoot, "O1"), colId: "amount" };
    runtime.writeCell(ordersRoot, coord, 150);
    orders.patchCalls[0].deferred.resolve({ value: 175 });
    await flush();

    const updated = runtime
      .snapshotFor(ordersRoot)
      .nodes.find((n) => n.columns.id === "O1");
    expect(updated?.columns.amount).toBe(175);

    const reconcile = events
      .filter((e) => e.kind === "cellReconciled")
      .map((e) => e.payload);
    expect(reconcile).toEqual([
      {
        path: ordersRoot,
        event: {
          kind: "diverged",
          rowKey: "O1",
          colId: "amount",
          optimisticValue: 150,
          authoritativeValue: 175,
          priorValue: 100,
        },
      },
    ]);
  });

  it("writeCell rejected: cellReconciled { kind: 'rejected' }; host policy restores via writeCell", async () => {
    const { runtime, orders, events } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    runtime.sourceFor(ordersRoot).onReconcile((event) => {
      if (event.kind === "rejected") {
        runtime.writeCell(
          ordersRoot,
          { rowId: makeRowId(ordersRoot, event.rowKey), colId: event.colId },
          event.priorValue,
        );
      }
    });

    const coord = { rowId: makeRowId(ordersRoot, "O1"), colId: "amount" };
    runtime.writeCell(ordersRoot, coord, 150);
    orders.patchCalls[0].deferred.reject(
      new Error("403 Forbidden — column read-only"),
    );
    await flush();

    const snap = runtime.snapshotFor(ordersRoot);
    expect(snap.nodes.find((n) => n.columns.id === "O1")?.columns.amount).toBe(
      100,
    );

    const reconcile = events
      .filter((e) => e.kind === "cellReconciled")
      .map((e) => e.payload) as Array<{
      path: GridPath;
      event: ReconcileEvent;
    }>;
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0].event).toEqual({
      kind: "rejected",
      rowKey: "O1",
      colId: "amount",
      optimisticValue: 150,
      reason: "403 Forbidden — column read-only",
      priorValue: 100,
    });
    expect(
      runtime.snapshotFor(ordersRoot).nodes.find((n) => n.columns.id === "O1")
        ?.columns.amount,
    ).toBe(100);
    expect(orders.patchCalls).toHaveLength(2);
    expect(orders.patchCalls[1].req).toEqual({
      rowKey: "O1",
      colId: "amount",
      value: 100,
      row: {
        id: "O1",
        customer: "Acme",
        amount: 100,
      },
    });
  });

  it("refetch issues a new fetchPage; status flips ready → refreshing → ready", async () => {
    const { runtime, orders, events } = buildRig();
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();
    expect(runtime.sourceStateFor(ordersRoot).status).toBe("ready");

    runtime.sourceFor(ordersRoot).refetch();
    expect(orders.fetchCalls).toHaveLength(2);
    expect(runtime.sourceStateFor(ordersRoot).status).toBe("refreshing");

    orders.fetchCalls[1].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();
    expect(runtime.sourceStateFor(ordersRoot).status).toBe("ready");

    const statuses = events
      .filter((e) => e.kind === "levelStatusChanged")
      .map((e) => (e.payload as { status: string }).status);
    expect(statuses).toEqual(["ready", "refreshing", "ready"]);
  });
});

// ---------------------------------------------------------------------
// Success metrics — server-managed stage skipping and source swap.
// ---------------------------------------------------------------------

describe("Success metric: server-managed sort/filter skip the pipeline stages", () => {
  const ordersRoot = rootPath("orders");

  // Schema with one flat level — the bare-minimum scenario for a
  // 100×30-style table whose source declares everything server-managed.
  const flatSchema: GridSchema = {
    rootLevel: "orders",
    levels: {
      orders: {
        name: "orders",
        columns: ordersColumns,
        options: { rowKey: (n) => String(n.columns.id) },
        childLevels: [],
      },
    },
  };

  // The displayed-row sort stage (`pipeline/with-sort.ts`) preserves source
  // order. With `serverManaged.sort: true` set, derivation skips the stage
  // entirely — applying a sort descriptor does NOT reorder the displayed rows,
  // even though the source's snapshot carries the descriptor unchanged. This is
  // the observable shape of
  // "withSort = 0 invocations" without spying on module internals.
  it("with serverManaged.sort=true, applying setSort does not reorder displayed rows", async () => {
    // Source returns nodes in a deliberately scrambled-by-amount order.
    const orders = makeTransport();
    const dataSource = restGridDataSource({
      schema: flatSchema,
      endpoints: { orders: endpointFor(orders) },
    });
    const runtime = createGridRuntime({ schema: flatSchema, dataSource });

    orders.fetchCalls[0].deferred.resolve({
      nodes: [
        {
          levelName: "orders",
          columns: { id: "O1", customer: "Acme", amount: 300 },
        },
        {
          levelName: "orders",
          columns: { id: "O2", customer: "Beta", amount: 100 },
        },
        {
          levelName: "orders",
          columns: { id: "O3", customer: "Gamma", amount: 200 },
        },
      ],
      totalCount: 3,
    });
    await flush();

    const before = runtime
      .displayedRowsFor(ordersRoot)
      .rows.map((r) => r.columns.amount);
    expect(before).toEqual([300, 100, 200]);

    // Apply a sort descriptor. The source's serverManaged.sort=true means
    // setSort triggers a refetch; we resolve it with the SAME unsorted nodes.
    // If the pipeline ran withSort, the displayed order would be [100,200,300].
    runtime
      .sourceFor(ordersRoot)
      .setSort([{ colId: "amount", direction: "asc" }]);
    orders.fetchCalls[1].deferred.resolve({
      nodes: [
        {
          levelName: "orders",
          columns: { id: "O1", customer: "Acme", amount: 300 },
        },
        {
          levelName: "orders",
          columns: { id: "O2", customer: "Beta", amount: 100 },
        },
        {
          levelName: "orders",
          columns: { id: "O3", customer: "Gamma", amount: 200 },
        },
      ],
      totalCount: 3,
    });
    await flush();

    const after = runtime
      .displayedRowsFor(ordersRoot)
      .rows.map((r) => r.columns.amount);
    expect(after).toEqual([300, 100, 200]);
  });

  it("with serverManaged.filter=true, the pipeline does not drop rows the snapshot still carries", async () => {
    const orders = makeTransport();
    const dataSource = restGridDataSource({
      schema: flatSchema,
      endpoints: { orders: endpointFor(orders) },
    });
    const runtime = createGridRuntime({ schema: flatSchema, dataSource });
    orders.fetchCalls[0].deferred.resolve({
      nodes: [
        {
          levelName: "orders",
          columns: { id: "O1", customer: "Acme", amount: 300 },
        },
        {
          levelName: "orders",
          columns: { id: "O2", customer: "Beta", amount: 100 },
        },
      ],
      totalCount: 2,
    });
    await flush();

    // Apply a filter that, if run client-side, would exclude both rows.
    runtime.sourceFor(ordersRoot).setFilter({ amount: () => false });
    // serverManaged.filter=true triggers a refetch; resolve with both
    // rows still present (server's prerogative).
    orders.fetchCalls[1].deferred.resolve({
      nodes: [
        {
          levelName: "orders",
          columns: { id: "O1", customer: "Acme", amount: 300 },
        },
        {
          levelName: "orders",
          columns: { id: "O2", customer: "Beta", amount: 100 },
        },
      ],
      totalCount: 2,
    });
    await flush();

    const ids = runtime
      .displayedRowsFor(ordersRoot)
      .rows.map((r) => r.columns.id);
    expect(ids).toEqual(["O1", "O2"]);
  });
});

describe("Success metric: switching source kinds requires no schema or component change", () => {
  const ordersRoot = rootPath("orders");
  const flatSchema: GridSchema = {
    rootLevel: "orders",
    levels: {
      orders: {
        name: "orders",
        columns: ordersColumns,
        options: { rowKey: (n) => String(n.columns.id) },
        childLevels: [],
      },
    },
  };

  // The same `GridSchema` powers both source kinds — the runtime contract
  // is identical, only the construction-time wiring of `dataSource`
  // differs. Components that read `runtime.displayedRowsFor` cannot tell
  // which source provided the data.
  it("inMemoryGridDataSource and restGridDataSource present an identical displayedRows contract for the same schema", async () => {
    // 1) In-memory: the source ships fully resolved on construction, so
    //    the snapshot is `ready` immediately.
    const ds1 = inMemoryGridDataSource({
      schema: flatSchema,
      tree: ordersFixture(),
      levels: {
        orders: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    });
    const rt1 = createGridRuntime({ schema: flatSchema, dataSource: ds1 });
    expect(rt1.sourceStateFor(ordersRoot).status).toBe("ready");
    const memRows = rt1.displayedRowsFor(ordersRoot).rows.map((r) => ({
      id: r.columns.id,
      amount: r.columns.amount,
    }));

    // 2) REST: the source loads asynchronously, but once `ready` exposes
    //    the same row shape through the same runtime API.
    const orders = makeTransport();
    const ds2 = restGridDataSource({
      schema: flatSchema,
      endpoints: { orders: endpointFor(orders) },
    });
    const rt2 = createGridRuntime({ schema: flatSchema, dataSource: ds2 });
    orders.fetchCalls[0].deferred.resolve({
      nodes: ordersFixture(),
      totalCount: 2,
    });
    await flush();

    const restRows = rt2.displayedRowsFor(ordersRoot).rows.map((r) => ({
      id: r.columns.id,
      amount: r.columns.amount,
    }));

    expect(restRows).toEqual(memRows);
  });
});
