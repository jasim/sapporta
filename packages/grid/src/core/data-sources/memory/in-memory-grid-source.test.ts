import { describe, expect, it, vi } from "vitest";
import { childPath, rootPath, type GridPath } from "../../types/identity";
import type { TreeNode } from "../../types/level-row";
import type { GridSchema } from "../../types/schema";
import type { InMemoryLevelSource } from "./in-memory-level-source";
import {
  inMemoryGridDataSource,
  type InMemoryGridDataSourceOpts,
  type InMemoryLevelOpts,
} from "./in-memory-grid-source";

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

const orderColumns = [
  textColumn("id", "Id"),
  textColumn("customer", "Customer"),
];
const lineColumns = [textColumn("id", "Id"), numberColumn("amount", "Amount")];
const noteColumns = [textColumn("id", "Id"), textColumn("text", "Text")];

const schema: GridSchema = {
  rootLevel: "orders",
  levels: {
    orders: {
      name: "orders",
      rowHeaderColumn: "none",
      columns: orderColumns,
      options: {},
      childLevels: ["lines"],
    },
    lines: {
      name: "lines",
      rowHeaderColumn: "none",
      columns: lineColumns,
      options: {},
      childLevels: ["notes"],
    },
    notes: {
      name: "notes",
      rowHeaderColumn: "none",
      columns: noteColumns,
      options: {},
      childLevels: [],
    },
  },
};

const allClient: InMemoryLevelOpts = {
  sortMode: "client",
  filterMode: "client",
  paginationMode: "client",
  compileFilter: () => undefined,
};

const fixtureTree = (): TreeNode[] => [
  {
    rowKey: "ord-1",
    levelName: "orders",
    columns: { id: "ord-1", customer: "Alice" },
    children: {
      lines: [
        {
          rowKey: "ln-1",
          levelName: "lines",
          columns: { id: "ln-1", amount: 10 },
          children: {
            notes: [
              {
                rowKey: "n-1",
                levelName: "notes",
                columns: { id: "n-1", text: "first" },
              },
            ],
          },
        },
        {
          rowKey: "ln-2",
          levelName: "lines",
          columns: { id: "ln-2", amount: 20 },
        },
      ],
    },
  },
  {
    rowKey: "ord-2",
    levelName: "orders",
    columns: { id: "ord-2", customer: "Bob" },
    // No `children` at all — should resolve to empty.
  },
];

const baseOpts = (
  extra: Partial<InMemoryGridDataSourceOpts> = {},
): InMemoryGridDataSourceOpts => ({
  schema,
  tree: fixtureTree(),
  levels: {
    orders: allClient,
    lines: allClient,
    notes: allClient,
  },
  ...extra,
});

describe("inMemoryGridDataSource", () => {
  const root = rootPath("orders");

  it("rootSource() returns the same reference across calls (cached on first call)", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const a = ds.rootSource();
    const b = ds.rootSource();
    expect(a).toBe(b);
  });

  it("rootSource()'s nodes match the input tree (after slice)", () => {
    const tree = fixtureTree();
    const ds = inMemoryGridDataSource(baseOpts({ tree }));
    const state = ds.rootSource().state();
    expect(state.status).toBe("ready");
    const snap = state.snapshot;
    expect(snap.nodes).toHaveLength(2);
    expect(snap.nodes[0].columns.id).toBe("ord-1");
    expect(snap.nodes[1].columns.id).toBe("ord-2");
  });

  it("can construct read-only level sources for immutable trees", () => {
    const ds = inMemoryGridDataSource(
      baseOpts({
        levels: {
          orders: { ...allClient, readonly: true },
          lines: { ...allClient, readonly: true },
          notes: { ...allClient, readonly: true },
        },
      }),
    );
    const rootSource = ds.rootSource();
    const childSource = ds.resolveChild(root, "ord-1", "lines");

    expect(rootSource.write).toBeUndefined();
    expect(childSource.write).toBeUndefined();
    expect("setCell" in rootSource).toBe(false);
    expect("setCell" in childSource).toBe(false);
  });

  it("publishes root and child footer rows from static tree data", () => {
    const tree = fixtureTree();
    tree[0] = {
      ...tree[0],
      childFooterRows: {
        lines: [{ rowKey: "lines-total", columns: { amount: 30 } }],
      },
    };
    const ds = inMemoryGridDataSource(
      baseOpts({
        tree,
        levels: {
          orders: {
            ...allClient,
            footerRows: [
              { rowKey: "orders-total", columns: { customer: "Total" } },
            ],
          },
          lines: allClient,
          notes: allClient,
        },
      }),
    );

    expect(ds.rootSource().state().snapshot.footerRows).toEqual([
      { rowKey: "orders-total", columns: { customer: "Total" } },
    ]);
    expect(
      ds.resolveChild(root, "ord-1", "lines").state().snapshot.footerRows,
    ).toEqual([{ rowKey: "lines-total", columns: { amount: 30 } }]);
  });

  it("resolveChild walks to the parent and returns its children", () => {
    const tree = fixtureTree();
    const ds = inMemoryGridDataSource(baseOpts({ tree }));
    const child = ds.resolveChild(root, "ord-1", "lines");
    const state = child.state();
    expect(state.status).toBe("ready");
    const snap = state.snapshot;
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(
      tree[0].children!.lines instanceof Array
        ? (tree[0].children!.lines as TreeNode[]).map((n) => n.columns.id)
        : [],
    );
  });

  it("resolveChild for a parent missing the childLevelName returns an empty source with status ready", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const child = ds.resolveChild(root, "ord-2", "lines");
    const state = child.state();
    expect(state.status).toBe("ready");
    const snap = state.snapshot;
    expect(snap.nodes).toEqual([]);
  });

  it("resolveChild on an unknown parentRowKey throws synchronously", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    expect(() => ds.resolveChild(root, "ord-ghost", "lines")).toThrow(
      /no node with rowKey 'ord-ghost'/,
    );
  });

  it("resolveChild walking past a missing parent at depth-2 throws", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    expect(() =>
      ds.resolveChild("orders.ord-99.lines" as GridPath, "ln-1", "notes"),
    ).toThrow(
      /parent level source 'orders\.ord-99\.lines' has not been resolved/,
    );
  });

  it("resolveChild on a parentPath whose root segment doesn't match schema.rootLevel throws", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    expect(() =>
      ds.resolveChild("warehouses.w-1.lines" as GridPath, "ln-1", "notes"),
    ).toThrow(/does not match schema\.rootLevel 'orders'/);
  });

  it("resolveChild returns a fresh source on every call (no internal cache)", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const a = ds.resolveChild(root, "ord-1", "lines");
    const b = ds.resolveChild(root, "ord-1", "lines");
    expect(a).not.toBe(b);
  });

  it("walks two levels deep: order → line → notes", () => {
    const tree = fixtureTree();
    const ds = inMemoryGridDataSource(baseOpts({ tree }));
    ds.resolveChild(root, "ord-1", "lines");
    // Path "orders.ord-1.lines" is now the live lines level under order ord-1.
    const notes = ds.resolveChild(
      "orders.ord-1.lines" as GridPath,
      "ln-1",
      "notes",
    );
    const snap = notes.state().snapshot;
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].columns.id).toBe("n-1");
  });

  it("depth-2 walk still resolves correctly after the parent level's nodes are sorted", () => {
    // The walk is rowKey-keyed: re-ordering the parent array must not affect
    // path resolution.
    const ds = inMemoryGridDataSource(baseOpts());
    const root1 = ds.rootSource();
    if (!root1.query?.sort) throw new Error("expected sortable root");
    // Sort orders by `customer` descending — moves "ord-1" (Alice) below
    // "ord-2" (Bob) in the in-memory level source.
    void root1.query.sort.set([{ colId: "customer", direction: "desc" }]);
    // Path resolution still finds ord-1's lines.
    const lines = ds.resolveChild(root, "ord-1", "lines");
    expect(lines.state().snapshot.nodes.map((n) => n.columns.id)).toEqual([
      "ln-1",
      "ln-2",
    ]);
  });

  it("resolves children from a parent inserted into the live root source", async () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const rootSource = ds.rootSource();
    if (!rootSource.write) throw new Error("expected writable root");
    await rootSource.write.createNode({
      rowKey: "ord-3",
      levelName: "orders",
      columns: { id: "ord-3", customer: "Cara" },
      children: {
        lines: [
          {
            rowKey: "ln-3",
            levelName: "lines",
            columns: { id: "ln-3", amount: 30 },
          },
        ],
      },
    });

    const lines = ds.resolveChild(root, "ord-3", "lines");
    expect(lines.state().snapshot.nodes.map((node) => node.rowKey)).toEqual([
      "ln-3",
    ]);
  });

  it("resolves restored parent identity from current root data, not constructor seed data", async () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const rootSource = ds.rootSource();
    if (!rootSource.write) throw new Error("expected writable root");
    const originalLines = ds.resolveChild(root, "ord-1", "lines");

    rootSource.write.removeNode("ord-1");
    await rootSource.write.createNode({
      rowKey: "ord-1",
      levelName: "orders",
      columns: { id: "ord-1", customer: "Restored" },
      children: {
        lines: [
          {
            rowKey: "ln-restored",
            levelName: "lines",
            columns: { id: "ln-restored", amount: 99 },
          },
        ],
      },
    });

    const restoredLines = ds.resolveChild(root, "ord-1", "lines");
    expect(restoredLines).not.toBe(originalLines);
    expect(
      restoredLines.state().snapshot.nodes.map((node) => node.rowKey),
    ).toEqual(["ln-restored"]);
  });

  it("resolves grandchildren from edits to the live child source", async () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const lines = ds.resolveChild(root, "ord-1", "lines");
    if (!lines.write) throw new Error("expected writable child");
    await lines.write.createNode({
      rowKey: "ln-3",
      levelName: "lines",
      columns: { id: "ln-3", amount: 30 },
      children: {
        notes: [
          {
            rowKey: "n-live",
            levelName: "notes",
            columns: { id: "n-live", text: "live child" },
          },
        ],
      },
    });

    const notes = ds.resolveChild(
      childPath(root, "ord-1", "lines"),
      "ln-3",
      "notes",
    );
    expect(notes.state().snapshot.nodes.map((node) => node.rowKey)).toEqual([
      "n-live",
    ]);
  });

  it("resolves children from the latest bulk replacement", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const rootSource = ds.rootSource() as InMemoryLevelSource;
    rootSource.replaceNodes([
      {
        rowKey: "ord-1",
        levelName: "orders",
        columns: { id: "ord-1", customer: "Replaced" },
        children: {
          lines: [
            {
              rowKey: "ln-replaced",
              levelName: "lines",
              columns: { id: "ln-replaced", amount: 55 },
            },
          ],
        },
      },
    ]);

    const lines = ds.resolveChild(root, "ord-1", "lines");
    expect(lines.state().snapshot.nodes.map((node) => node.rowKey)).toEqual([
      "ln-replaced",
    ]);
  });

  it("mutating the returned root source does NOT mutate the input tree array", async () => {
    const tree = fixtureTree();
    const originalFirst = tree[0];
    const originalLength = tree.length;
    const ds = inMemoryGridDataSource(baseOpts({ tree }));

    const r = ds.rootSource();
    if (!r.write) throw new Error("expected writable root");
    r.write.setCell("ord-1", "customer", "Aliceeee");
    await r.write.createNode({
      rowKey: "ord-3",
      levelName: "orders",
      columns: { id: "ord-3", customer: "C" },
    });

    expect(tree.length).toBe(originalLength);
    expect(tree[0]).toBe(originalFirst);
    expect(tree[0].columns.customer).toBe("Alice");
  });

  it("dispose() does not dispose level sources returned to the runtime", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const r = ds.rootSource();
    const lines = ds.resolveChild(root, "ord-1", "lines");

    const rootSub = vi.fn();
    const linesSub = vi.fn();
    r.subscribe(rootSub);
    lines.subscribe(linesSub);

    ds.dispose();

    // The runtime owns these sources and can still finish in-flight work before
    // it disposes them itself.
    r.write?.setCell("ord-1", "customer", "X");
    lines.write?.setCell("ln-1", "amount", 999);
    expect(rootSub).toHaveBeenCalledTimes(1);
    expect(linesSub).toHaveBeenCalledTimes(1);
  });

  it("throws at construction if schema.rootLevel is not in schema.levels", () => {
    const bad: GridSchema = {
      rootLevel: "missing",
      levels: { orders: schema.levels.orders },
    };
    expect(() =>
      inMemoryGridDataSource({
        schema: bad,
        tree: [],
        levels: { orders: allClient },
      }),
    ).toThrow(/rootLevel 'missing' not found/);
  });

  it("throws if a level used at runtime has no entry in opts.levels", () => {
    const ds = inMemoryGridDataSource(
      baseOpts({ levels: { orders: allClient, lines: allClient } }),
    );
    ds.resolveChild(root, "ord-1", "lines");
    expect(() =>
      ds.resolveChild("orders.ord-1.lines" as GridPath, "ln-1", "notes"),
    ).toThrow(/opts.levels has no entry for level 'notes'/);
  });
});
