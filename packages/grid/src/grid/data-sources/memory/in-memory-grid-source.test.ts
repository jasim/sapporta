import { describe, expect, it, vi } from "vitest";
import { rootPath, type GridPath } from "../../types/identity";
import type { TreeNode } from "../../types/level-row";
import type { GridSchema } from "../../types/schema";
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
      columns: orderColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: ["lines"],
    },
    lines: {
      name: "lines",
      columns: lineColumns,
      options: { rowKey: (n) => String(n.columns.id) },
      childLevels: ["notes"],
    },
    notes: {
      name: "notes",
      columns: noteColumns,
      options: { rowKey: (n) => String(n.columns.id) },
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
    levelName: "orders",
    columns: { id: "ord-1", customer: "Alice" },
    children: {
      lines: [
        {
          levelName: "lines",
          columns: { id: "ln-1", amount: 10 },
          children: {
            notes: [
              { levelName: "notes", columns: { id: "n-1", text: "first" } },
            ],
          },
        },
        { levelName: "lines", columns: { id: "ln-2", amount: 20 } },
      ],
    },
  },
  {
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
    const snap = ds.rootSource().snapshot();
    expect(snap.status).toBe("ready");
    expect(snap.nodes).toHaveLength(2);
    expect(snap.nodes[0].columns.id).toBe("ord-1");
    expect(snap.nodes[1].columns.id).toBe("ord-2");
  });

  it("resolveChild walks to the parent and returns its children", () => {
    const tree = fixtureTree();
    const ds = inMemoryGridDataSource(baseOpts({ tree }));
    const child = ds.resolveChild(root, "ord-1", "lines");
    const snap = child.snapshot();
    expect(snap.status).toBe("ready");
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(
      tree[0].children!.lines instanceof Array
        ? (tree[0].children!.lines as TreeNode[]).map((n) => n.columns.id)
        : [],
    );
  });

  it("resolveChild for a parent missing the childLevelName returns an empty source with status ready", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const child = ds.resolveChild(root, "ord-2", "lines");
    const snap = child.snapshot();
    expect(snap.status).toBe("ready");
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
    ).toThrow(/no node with rowKey 'ord-99'/);
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
    // Path "orders.ord-1.lines" is the lines level under order ord-1.
    const notes = ds.resolveChild(
      "orders.ord-1.lines" as GridPath,
      "ln-1",
      "notes",
    );
    const snap = notes.snapshot();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].columns.id).toBe("n-1");
  });

  it("depth-2 walk still resolves correctly after the parent level's nodes are sorted", () => {
    // The walk is rowKey-keyed: re-ordering the parent array must not affect
    // path resolution.
    const ds = inMemoryGridDataSource(baseOpts());
    const root1 = ds.rootSource();
    if (!root1.writable) throw new Error("expected writable root");
    // Sort orders by `customer` descending — moves "ord-1" (Alice) below
    // "ord-2" (Bob) in the in-memory level source.
    root1.setSort([{ colId: "customer", direction: "desc" }]);
    // Path resolution still finds ord-1's lines.
    const lines = ds.resolveChild(root, "ord-1", "lines");
    expect(lines.snapshot().nodes.map((n) => n.columns.id)).toEqual([
      "ln-1",
      "ln-2",
    ]);
  });

  it("mutating the returned root source does NOT mutate the input tree array", () => {
    const tree = fixtureTree();
    const originalFirst = tree[0];
    const originalLength = tree.length;
    const ds = inMemoryGridDataSource(baseOpts({ tree }));

    const r = ds.rootSource();
    if (!r.writable) throw new Error("expected writable root");
    r.setCell("ord-1", "customer", "Aliceeee");
    r.insertNode({
      levelName: "orders",
      columns: { id: "ord-3", customer: "C" },
    });

    expect(tree.length).toBe(originalLength);
    expect(tree[0]).toBe(originalFirst);
    expect(tree[0].columns.customer).toBe("Alice");
  });

  it("dispose() chains to root and to every source produced via resolveChild", () => {
    const ds = inMemoryGridDataSource(baseOpts());
    const r = ds.rootSource();
    const lines = ds.resolveChild(root, "ord-1", "lines");

    const rootSub = vi.fn();
    const linesSub = vi.fn();
    r.subscribe(rootSub);
    lines.subscribe(linesSub);

    ds.dispose();

    // Post-dispose mutations on the underlying sources must not fire subs.
    if (r.writable) r.setCell("ord-1", "customer", "X");
    if (lines.writable) lines.setCell("ln-1", "amount", 999);
    expect(rootSub).not.toHaveBeenCalled();
    expect(linesSub).not.toHaveBeenCalled();
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
    expect(() =>
      ds.resolveChild("orders.ord-1.lines" as GridPath, "ln-1", "notes"),
    ).toThrow(/opts.levels has no entry for level 'notes'/);
  });
});
