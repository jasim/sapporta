import { describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "../../types/schema";
import type { LevelOptions, TreeNode } from "../../types/level-row";
import type { RowPredicate } from "../../pipeline/types";
import {
  inMemoryLevelSource,
  inMemoryReadonlyLevelSource,
  type InMemoryLevelSourceOpts,
} from "./in-memory-level-source";

const columns: ColumnSchema[] = [
  {
    id: "id",
    name: "Id",
    renderCell: ({ value }) => String(value ?? ""),
  },
  {
    id: "amount",
    name: "Amount",
    renderCell: ({ value }) => String(value ?? ""),
    compare: (a, b) => (Number(a) || 0) - (Number(b) || 0),
  },
  {
    id: "name",
    name: "Name",
    renderCell: ({ value }) => String(value ?? ""),
    compare: (a, b) => String(a ?? "").localeCompare(String(b ?? "")),
  },
];

const options: LevelOptions = {
  // Stable rowKey from the id column — robust across sort/filter so the
  // tests can call setCell after sorting without rowKey collisions.
  rowKey: (node) => String(node.columns.id),
};

const fixtureNodes = (): TreeNode[] => [
  { levelName: "items", columns: { id: "a", amount: 30, name: "Apple" } },
  { levelName: "items", columns: { id: "b", amount: 10, name: "Banana" } },
  { levelName: "items", columns: { id: "c", amount: 20, name: "Cherry" } },
];

// A column-keyed predicate map — the simplest test grammar that exercises
// the parametric `F` seam. The host's compiler folds it into a single
// `RowPredicate` for the source to apply.
type TestFilter = Record<string, (value: unknown) => boolean>;

const compileTestFilter = (
  filter: TestFilter | undefined,
): RowPredicate | undefined => {
  if (!filter) return undefined;
  const colIds = Object.keys(filter);
  if (colIds.length === 0) return undefined;
  return (cols) => colIds.every((id) => filter[id](cols[id]));
};

const baseOpts = (
  extra: Partial<InMemoryLevelSourceOpts<TestFilter>> = {},
): InMemoryLevelSourceOpts<TestFilter> => ({
  initialNodes: fixtureNodes(),
  options,
  columns,
  sortMode: "client",
  filterMode: "client",
  paginationMode: "client",
  compileFilter: compileTestFilter,
  ...extra,
});

describe("inMemoryLevelSource (writable)", () => {
  it("writable === true", () => {
    const src = inMemoryLevelSource(baseOpts());
    expect(src.writable).toBe(true);
  });

  it("serverManaged is { false, false, false } on every snapshot", () => {
    const src = inMemoryLevelSource(baseOpts());
    expect(src.state().snapshot.serverManaged).toEqual({
      sort: false,
      filter: false,
      pagination: false,
    });
    src.setSort([{ colId: "amount", direction: "asc" }]);
    expect(src.state().snapshot.serverManaged).toEqual({
      sort: false,
      filter: false,
      pagination: false,
    });
    src.setCell("a", "amount", 99);
    expect(src.state().snapshot.serverManaged).toEqual({
      sort: false,
      filter: false,
      pagination: false,
    });
  });

  it("snapshot() returns identity-stable refs across no-op reads", () => {
    const src = inMemoryLevelSource(baseOpts());
    const s1 = src.state().snapshot;
    const s2 = src.state().snapshot;
    expect(s1).toBe(s2);
    expect(s1.nodes).toBe(s2.nodes);
  });

  it("setSort re-sorts, allocates new nodes ref, fires subscribers exactly once", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const sub = vi.fn();
    src.subscribe(sub);

    src.setSort([{ colId: "amount", direction: "asc" }]);

    expect(sub).toHaveBeenCalledTimes(1);
    const after = src.state().snapshot;
    expect(after).not.toBe(before);
    expect(after.nodes).not.toBe(before.nodes);
    expect(after.nodes.map((n) => n.columns.id)).toEqual(["b", "c", "a"]);
    expect(after.sort).toEqual([{ colId: "amount", direction: "asc" }]);
  });

  it("setFilter applies the predicate, allocates new nodes ref, fires subscribers exactly once", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const sub = vi.fn();
    src.subscribe(sub);

    src.setFilter({
      amount: (v: unknown) => typeof v === "number" && v >= 20,
    } satisfies TestFilter);

    expect(sub).toHaveBeenCalledTimes(1);
    const after = src.state().snapshot;
    expect(after.nodes).not.toBe(before.nodes);
    expect(after.nodes.map((n) => n.columns.id)).toEqual(["a", "c"]);
  });

  it("setPage windows and surfaces pagination metadata", () => {
    const many: TreeNode[] = Array.from({ length: 25 }, (_, i) => ({
      levelName: "items",
      columns: { id: `r${i}`, amount: i, name: `n${i}` },
    }));
    const src = inMemoryLevelSource(
      baseOpts({ initialNodes: many, initialPage: 0, initialPageSize: 10 }),
    );

    src.setPage(2, 10);
    const snap = src.state().snapshot;
    expect(snap.pagination).toEqual({ page: 2, pageSize: 10, totalCount: 25 });
    expect(snap.nodes).toHaveLength(5);
    expect(snap.nodes[0].columns.id).toBe("r20");
  });

  it("setPage resolves ready when pagination changes and unchanged for the same page", async () => {
    const many: TreeNode[] = Array.from({ length: 12 }, (_, i) => ({
      levelName: "items",
      columns: { id: `r${i}`, amount: i, name: `n${i}` },
    }));
    const src = inMemoryLevelSource(
      baseOpts({ initialNodes: many, initialPage: 0, initialPageSize: 5 }),
    );

    const changed = await src.setPage(1, 5);
    expect(changed.kind).toBe("ready");
    expect(src.state().snapshot.pagination?.page).toBe(1);
    expect(src.state().snapshot.nodes[0].columns.id).toBe("r5");

    const unchanged = await src.setPage(1, 5);
    expect(unchanged.kind).toBe("unchanged");
  });

  it("setPage rejects non-integer pagination windows", () => {
    const src = inMemoryLevelSource(
      baseOpts({ initialPage: 0, initialPageSize: 10 }),
    );

    expect(() => src.setPage(1.5, 10)).toThrow(/page must be an integer/);
    expect(() => src.setPage(1, 0)).toThrow(/pageSize must be an integer/);
  });

  it("setCell mutates the matching node and allocates a new nodes ref", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;

    src.setCell("a", "amount", 999);
    const after = src.state().snapshot;

    expect(after.nodes).not.toBe(before.nodes);
    const a = after.nodes.find((n) => n.columns.id === "a")!;
    expect(a.columns.amount).toBe(999);
  });

  it("does not mutate the original input node objects", () => {
    const initial = fixtureNodes();
    const originalA = initial[0];
    const src = inMemoryLevelSource(baseOpts({ initialNodes: initial }));

    src.setCell("a", "amount", 999);

    // Caller's original reference is untouched — the source clones on edit.
    expect(originalA.columns.amount).toBe(30);
  });

  it("applyChanges applies all changes atomically and fires subscribers exactly once", () => {
    const src = inMemoryLevelSource(baseOpts());
    const sub = vi.fn();
    src.subscribe(sub);

    src.applyChanges([
      { rowKey: "a", colId: "amount", value: 100 },
      { rowKey: "b", colId: "amount", value: 200 },
      { rowKey: "c", colId: "amount", value: 300 },
    ]);

    expect(sub).toHaveBeenCalledTimes(1);
    const snap = src.state().snapshot;
    const byId = new Map(
      snap.nodes.map((n) => [n.columns.id, n.columns.amount]),
    );
    expect(byId.get("a")).toBe(100);
    expect(byId.get("b")).toBe(200);
    expect(byId.get("c")).toBe(300);
  });

  it("applyChanges throws on a missing rowKey and leaves the snapshot unchanged", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const sub = vi.fn();
    src.subscribe(sub);

    expect(() =>
      src.applyChanges([
        { rowKey: "a", colId: "amount", value: 100 },
        { rowKey: "ghost", colId: "amount", value: 999 },
      ]),
    ).toThrow(/no node with rowKey 'ghost'/);

    expect(src.state().snapshot).toBe(before);
    expect(sub).not.toHaveBeenCalled();
  });

  it("setCell on a missing rowKey throws and does not mutate state", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;

    expect(() => src.setCell("ghost", "amount", 1)).toThrow(
      /no node with rowKey 'ghost'/,
    );
    expect(src.state().snapshot).toBe(before);
  });

  it("createNode appends by default and surfaces the new node", async () => {
    const src = inMemoryLevelSource(baseOpts());
    const result = await src.createNode({
      levelName: "items",
      columns: { id: "d", amount: 5, name: "Date" },
    });
    expect(result).toEqual({
      node: {
        levelName: "items",
        columns: { id: "d", amount: 5, name: "Date" },
      },
      atIndex: 3,
    });
    const snap = src.state().snapshot;
    expect(snap.nodes).toHaveLength(4);
    expect(snap.nodes[3].columns.id).toBe("d");
  });

  it("createNode at index puts the node in the right base position", async () => {
    const src = inMemoryLevelSource(baseOpts());
    await src.createNode(
      { levelName: "items", columns: { id: "z", amount: 0, name: "Z" } },
      1,
    );
    const snap = src.state().snapshot;
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["a", "z", "b", "c"]);
  });

  it("removeNode drops the node", () => {
    const src = inMemoryLevelSource(baseOpts());
    src.setCell("b", "amount", 100);
    src.removeNode("b");
    const snap = src.state().snapshot;
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["a", "c"]);
  });

  it("onReconcile never fires for in-memory sources", () => {
    const src = inMemoryLevelSource(baseOpts());
    const onR = vi.fn();
    src.onReconcile(onR);

    src.setCell("a", "amount", 999);
    src.applyChanges([{ rowKey: "b", colId: "amount", value: 77 }]);

    expect(onR).not.toHaveBeenCalled();
  });

  it("aggregator runs after filter/sort/window; rollups and footerRows reflect the windowed set", () => {
    const many: TreeNode[] = Array.from({ length: 5 }, (_, i) => ({
      levelName: "items",
      columns: { id: `r${i}`, amount: (i + 1) * 10, name: `n${i}` },
    }));
    let lastSeen: TreeNode[] | null = null;
    const src = inMemoryLevelSource(
      baseOpts({
        initialNodes: many,
        initialPage: 0,
        initialPageSize: 2,
        aggregator: (nodes) => {
          lastSeen = nodes;
          let total = 0;
          const perRowRollup = new Map<string, Record<string, unknown>>();
          for (const n of nodes) {
            const v = Number(n.columns.amount);
            total += v;
            perRowRollup.set(String(n.columns.id), { amount: v * 2 });
          }
          return {
            perRowRollup,
            footerRows: [{ rowKey: "total", columns: { amount: total } }],
          };
        },
      }),
    );

    const snap = src.state().snapshot;
    expect(lastSeen!).toHaveLength(2);
    expect(snap.nodes).toHaveLength(2);
    // Rollups merged into the published nodes without mutating originals.
    expect(snap.nodes[0].rollup).toEqual({ amount: 20 });
    expect(snap.nodes[1].rollup).toEqual({ amount: 40 });
    expect(snap.footerRows).toEqual([
      { rowKey: "total", columns: { amount: 30 } },
    ]);
    // Original input is untouched.
    expect(many[0].rollup).toBeUndefined();
  });

  it("snapshot.footerRows ref is preserved across writes that don't change aggregates", () => {
    const aggregator = vi.fn((nodes: TreeNode[]) => ({
      perRowRollup: new Map<string, Record<string, unknown>>(),
      footerRows: [
        {
          rowKey: "total",
          columns: {
            amount: nodes.reduce(
              (s, n) => s + Number(n.columns.amount || 0),
              0,
            ),
          },
        },
      ],
    }));
    const src = inMemoryLevelSource(baseOpts({ aggregator }));
    const before = src.state().snapshot;
    // Same total → the source reuses the prior footerRows reference.
    src.setCell("a", "name", "Apricot");
    const after = src.state().snapshot;
    expect(after.footerRows).toBe(before.footerRows);
    expect(after.nodes).not.toBe(before.nodes);
  });

  it("dispose stops further subscriber fires", () => {
    const src = inMemoryLevelSource(baseOpts());
    const sub = vi.fn();
    src.subscribe(sub);
    src.dispose();
    src.setSort([{ colId: "amount", direction: "asc" }]);
    expect(sub).not.toHaveBeenCalled();
  });

  it("setSort with the same reference is a no-op (no notification)", () => {
    const sort = [{ colId: "amount" as const, direction: "asc" as const }];
    const src = inMemoryLevelSource(baseOpts({ initialSort: sort }));
    const sub = vi.fn();
    src.subscribe(sub);
    src.setSort(sort);
    expect(sub).not.toHaveBeenCalled();
  });

  it("with sortMode 'none', setSort is ignored and the snapshot omits sort", () => {
    const src = inMemoryLevelSource(baseOpts({ sortMode: "none" }));
    src.setSort([{ colId: "amount", direction: "asc" }]);
    const snap = src.state().snapshot;
    expect(snap.sort).toBeUndefined();
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["a", "b", "c"]);
  });

  it("with paginationMode 'none', the snapshot omits pagination", () => {
    const src = inMemoryLevelSource(baseOpts({ paginationMode: "none" }));
    expect(src.state().snapshot.pagination).toBeUndefined();
  });
});

describe("inMemoryReadonlyLevelSource", () => {
  it("writable === false", () => {
    const src = inMemoryReadonlyLevelSource(baseOpts());
    expect(src.writable).toBe(false);
  });

  it("edit verbs are absent (not just undefined) at runtime", () => {
    const src = inMemoryReadonlyLevelSource(baseOpts());
    expect("setCell" in src).toBe(false);
    expect("applyChanges" in src).toBe(false);
    expect("createNode" in src).toBe(false);
    expect("removeNode" in src).toBe(false);
    expect("onReconcile" in src).toBe(false);
  });

  it("setSort / setFilter / setPage work and emit identity-stable snapshots", () => {
    const many: TreeNode[] = Array.from({ length: 25 }, (_, i) => ({
      levelName: "items",
      columns: { id: `r${i}`, amount: i, name: `n${i}` },
    }));
    const src = inMemoryReadonlyLevelSource(
      baseOpts({ initialNodes: many, initialPage: 0, initialPageSize: 10 }),
    );

    const s1 = src.state().snapshot;
    expect(src.state().snapshot).toBe(s1);

    src.setSort([{ colId: "amount", direction: "desc" }]);
    const s2 = src.state().snapshot;
    expect(s2).not.toBe(s1);
    expect(s2.nodes[0].columns.id).toBe("r24");

    src.setFilter({
      amount: (v: unknown) => typeof v === "number" && v % 2 === 0,
    } satisfies TestFilter);
    const s3 = src.state().snapshot;
    expect(s3).not.toBe(s2);

    src.setPage(1, 5);
    const s4 = src.state().snapshot;
    expect(s4.pagination).toMatchObject({ page: 1, pageSize: 5 });

    expect(src.state().snapshot).toBe(s4);
  });

  it("refetch is a no-op on in-memory readonly sources", () => {
    const src = inMemoryReadonlyLevelSource(baseOpts());
    const before = src.state().snapshot;
    src.refetch();
    expect(src.state().snapshot).toBe(before);
  });
});
