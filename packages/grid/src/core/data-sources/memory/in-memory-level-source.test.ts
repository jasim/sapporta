import { describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "../../types/schema";
import type { TreeNode } from "../../types/level-row";
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

const fixtureNodes = (): TreeNode[] => [
  {
    rowKey: "a",
    levelName: "items",
    columns: { id: "a", amount: 30, name: "Apple" },
  },
  {
    rowKey: "b",
    levelName: "items",
    columns: { id: "b", amount: 10, name: "Banana" },
  },
  {
    rowKey: "c",
    levelName: "items",
    columns: { id: "c", amount: 20, name: "Cherry" },
  },
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
  columns,
  sortMode: "client",
  filterMode: "client",
  paginationMode: "client",
  compileFilter: compileTestFilter,
  ...extra,
});

describe("inMemoryLevelSource (writable)", () => {
  it("exposes a write capability", () => {
    const src = inMemoryLevelSource(baseOpts());
    expect(src.write).toBeDefined();
  });

  it("keeps query metadata out of every snapshot", async () => {
    const src = inMemoryLevelSource(baseOpts());
    expect(src.state().snapshot).toEqual({ nodes: fixtureNodes() });
    await src.query!.sort!.set([{ colId: "amount", direction: "asc" }]);
    expect("sort" in src.state().snapshot).toBe(false);
    src.write.setCell("a", "amount", 99);
    expect("serverManaged" in src.state().snapshot).toBe(false);
    expect("pagination" in src.state().snapshot).toBe(false);
  });

  it("snapshot() returns identity-stable refs across no-op reads", () => {
    const src = inMemoryLevelSource(baseOpts());
    const s1 = src.state().snapshot;
    const s2 = src.state().snapshot;
    expect(s1).toBe(s2);
    expect(s1.nodes).toBe(s2.nodes);
  });

  it("owns immutable structural snapshots for initial, replaced, and created rows", async () => {
    const initial = [
      {
        rowKey: "initial",
        levelName: "items",
        columns: { id: "initial", name: "Initial" },
        children: {
          details: [
            {
              rowKey: "detail",
              levelName: "details",
              columns: { name: "Detail" },
            },
          ],
        },
      },
    ];
    const footerRows = [{ rowKey: "total", columns: { name: "Total" } }];
    const src = inMemoryLevelSource(
      baseOpts({ initialNodes: initial, footerRows }),
    );
    const first = src.state();

    initial[0].rowKey = "mutated";
    initial[0].columns.name = "Mutated";
    initial[0].children.details[0].columns.name = "Mutated detail";
    footerRows[0].columns.name = "Mutated total";

    expect(src.state()).toBe(first);
    expect(first.snapshot.nodes[0].rowKey).toBe("initial");
    expect(first.snapshot.nodes[0].columns.name).toBe("Initial");
    const details = first.snapshot.nodes[0].children?.details;
    expect(Array.isArray(details) ? details[0].columns.name : undefined).toBe(
      "Detail",
    );
    expect(first.snapshot.footerRows?.[0].columns.name).toBe("Total");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    expect(Object.isFrozen(first.snapshot.nodes)).toBe(true);
    expect(Object.isFrozen(first.snapshot.nodes[0].columns)).toBe(true);

    const replacement = [
      {
        rowKey: "replacement",
        levelName: "items",
        columns: { id: "replacement", name: "Replacement" },
      },
    ];
    src.replaceNodes(replacement);
    replacement[0].columns.name = "Mutated replacement";
    expect(src.state().snapshot.nodes[0].columns.name).toBe("Replacement");

    const created = {
      rowKey: "created",
      levelName: "items",
      columns: { id: "created", name: "Created" },
    };
    const result = await src.write.createNode(created);
    created.columns.name = "Mutated created";
    expect(result.node.columns.name).toBe("Created");
    expect(src.state().snapshot.nodes[1].columns.name).toBe("Created");
    expect(Object.isFrozen(result.node)).toBe(true);
  });

  it("query.sort re-sorts, allocates new nodes ref, fires subscribers exactly once", async () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const sub = vi.fn();
    src.subscribe(sub);

    await src.query!.sort!.set([{ colId: "amount", direction: "asc" }]);

    expect(sub).toHaveBeenCalledTimes(1);
    const after = src.state().snapshot;
    expect(after).not.toBe(before);
    expect(after.nodes).not.toBe(before.nodes);
    expect(after.nodes.map((n) => n.columns.id)).toEqual(["b", "c", "a"]);
    expect(src.query!.sort!.current()).toEqual([
      { colId: "amount", direction: "asc" },
    ]);
  });

  it("query.filter applies the predicate, allocates new nodes ref, fires subscribers exactly once", async () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const sub = vi.fn();
    src.subscribe(sub);

    await src.query!.filter!.set({
      amount: (v: unknown) => typeof v === "number" && v >= 20,
    } satisfies TestFilter);

    expect(sub).toHaveBeenCalledTimes(1);
    const after = src.state().snapshot;
    expect(after.nodes).not.toBe(before.nodes);
    expect(after.nodes.map((n) => n.columns.id)).toEqual(["a", "c"]);
  });

  it("windows nodes from private initial pagination state", () => {
    const many: TreeNode[] = Array.from({ length: 25 }, (_, i) => ({
      rowKey: `r${i}`,
      levelName: "items",
      columns: { id: `r${i}`, amount: i, name: `n${i}` },
    }));
    const src = inMemoryLevelSource(
      baseOpts({ initialNodes: many, initialPage: 2, initialPageSize: 10 }),
    );

    const snap = src.state().snapshot;
    expect(snap.nodes).toHaveLength(5);
    expect(snap.nodes[0].columns.id).toBe("r20");
    expect("pagination" in snap).toBe(false);
  });

  it("write.canAppendRow reflects the private pagination boundary", () => {
    const many: TreeNode[] = Array.from({ length: 12 }, (_, i) => ({
      rowKey: `r${i}`,
      levelName: "items",
      columns: { id: `r${i}`, amount: i, name: `n${i}` },
    }));
    const middlePage = inMemoryLevelSource(
      baseOpts({ initialNodes: many, initialPage: 0, initialPageSize: 5 }),
    );
    const lastPage = inMemoryLevelSource(
      baseOpts({ initialNodes: many, initialPage: 2, initialPageSize: 5 }),
    );

    expect(middlePage.write.canAppendRow?.()).toBe(false);
    expect(lastPage.write.canAppendRow?.()).toBe(true);
  });

  it("rejects non-integer private pagination windows at construction", () => {
    expect(() =>
      inMemoryLevelSource(baseOpts({ initialPage: 1.5, initialPageSize: 10 })),
    ).toThrow(/page must be an integer/);
    expect(() =>
      inMemoryLevelSource(baseOpts({ initialPage: 1, initialPageSize: 0 })),
    ).toThrow(/pageSize must be an integer/);
  });

  it("setCell mutates the matching node and allocates a new nodes ref", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;

    src.write.setCell("a", "amount", 999);
    const after = src.state().snapshot;

    expect(after.nodes).not.toBe(before.nodes);
    expect(before.nodes[0].columns.amount).toBe(30);
    const a = after.nodes.find((n) => n.columns.id === "a")!;
    expect(a.columns.amount).toBe(999);
  });

  it("does not mutate the original input node objects", () => {
    const initial = fixtureNodes();
    const originalA = initial[0];
    const src = inMemoryLevelSource(baseOpts({ initialNodes: initial }));

    src.write.setCell("a", "amount", 999);

    // Caller's original reference is untouched — the source clones on edit.
    expect(originalA.columns.amount).toBe(30);
  });

  it("applyChanges applies all changes atomically and fires subscribers exactly once", () => {
    const src = inMemoryLevelSource(baseOpts());
    const sub = vi.fn();
    src.subscribe(sub);

    src.write.applyChanges([
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
      src.write.applyChanges([
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

    expect(() => src.write.setCell("ghost", "amount", 1)).toThrow(
      /no node with rowKey 'ghost'/,
    );
    expect(src.state().snapshot).toBe(before);
  });

  it("createNode appends by default and surfaces the new node", async () => {
    const src = inMemoryLevelSource(baseOpts());
    const result = await src.write.createNode({
      rowKey: "d",
      levelName: "items",
      columns: { id: "d", amount: 5, name: "Date" },
    });
    expect(result).toEqual({
      node: {
        rowKey: "d",
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
    await src.write.createNode(
      {
        rowKey: "z",
        levelName: "items",
        columns: { id: "z", amount: 0, name: "Z" },
      },
      1,
    );
    const snap = src.state().snapshot;
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["a", "z", "b", "c"]);
  });

  it("rejects invalid creates before mutation or notification", async () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const subscriber = vi.fn();
    src.subscribe(subscriber);

    await expect(
      src.write.createNode({
        rowKey: "a",
        levelName: "items",
        columns: { id: "replacement-a" },
      }),
    ).rejects.toThrow('duplicate TreeNode.rowKey "a"');

    expect(src.state().snapshot).toBe(before);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("validates replaceNodes before replacing the current snapshot", () => {
    const src = inMemoryLevelSource(baseOpts());
    const before = src.state().snapshot;
    const subscriber = vi.fn();
    src.subscribe(subscriber);

    expect(() =>
      src.replaceNodes([
        { rowKey: "same", levelName: "items", columns: { id: "one" } },
        { rowKey: "same", levelName: "items", columns: { id: "two" } },
      ]),
    ).toThrow('duplicate TreeNode.rowKey "same"');

    expect(src.state().snapshot).toBe(before);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("removeNode drops the node", () => {
    const src = inMemoryLevelSource(baseOpts());
    src.write.setCell("b", "amount", 100);
    src.write.removeNode("b");
    const snap = src.state().snapshot;
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["a", "c"]);
  });

  it("onReconcile never fires for in-memory sources", () => {
    const src = inMemoryLevelSource(baseOpts());
    const onR = vi.fn();
    src.write.onReconcile(onR);

    src.write.setCell("a", "amount", 999);
    src.write.applyChanges([{ rowKey: "b", colId: "amount", value: 77 }]);

    expect(onR).not.toHaveBeenCalled();
  });

  it("aggregator runs after filter/sort/window; rollups and footerRows reflect the windowed set", () => {
    const many: TreeNode[] = Array.from({ length: 5 }, (_, i) => ({
      rowKey: `r${i}`,
      levelName: "items",
      columns: { id: `r${i}`, amount: (i + 1) * 10, name: `n${i}` },
    }));
    let lastSeen: readonly TreeNode[] | null = null;
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
    const aggregator = vi.fn((nodes: readonly TreeNode[]) => ({
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
    src.write.setCell("a", "name", "Apricot");
    const after = src.state().snapshot;
    expect(after.footerRows).toBe(before.footerRows);
    expect(after.nodes).not.toBe(before.nodes);
  });

  it("dispose stops further subscriber fires", () => {
    const src = inMemoryLevelSource(baseOpts());
    const sub = vi.fn();
    src.subscribe(sub);
    src.dispose();
    void src.query!.sort!.set([{ colId: "amount", direction: "asc" }]);
    expect(sub).not.toHaveBeenCalled();
  });

  it("reports throwing subscribers, continues in order, and keeps duplicate registrations independent", () => {
    const observerError = new Error("observer failed");
    const report = vi.fn();
    const calls: string[] = [];
    const duplicate = vi.fn(() => calls.push("duplicate"));
    const src = inMemoryLevelSource(baseOpts({ onObserverError: report }));
    const unsubscribeFirst = src.subscribe(duplicate);
    src.subscribe(() => {
      calls.push("throw");
      throw observerError;
    });
    src.subscribe(duplicate);

    expect(() => src.write.setCell("a", "amount", 31)).not.toThrow();
    expect(calls).toEqual(["duplicate", "throw", "duplicate"]);
    expect(report).toHaveBeenCalledWith(observerError);

    unsubscribeFirst();
    src.write.setCell("a", "amount", 32);
    expect(duplicate).toHaveBeenCalledTimes(3);
  });

  it("query.sort with the same reference is a no-op (no notification)", async () => {
    const sort = [{ colId: "amount" as const, direction: "asc" as const }];
    const src = inMemoryLevelSource(baseOpts({ initialSort: sort }));
    const sub = vi.fn();
    src.subscribe(sub);
    await src.query!.sort!.set(sort);
    expect(sub).not.toHaveBeenCalled();
  });

  it("with sortMode 'none', no sort capability is exposed", () => {
    const src = inMemoryLevelSource(baseOpts({ sortMode: "none" }));
    const snap = src.state().snapshot;
    expect(src.query?.sort).toBeUndefined();
    expect(snap.nodes.map((n) => n.columns.id)).toEqual(["a", "b", "c"]);
  });

  it("with paginationMode 'none', snapshots stay unpaged and append is allowed", () => {
    const src = inMemoryLevelSource(baseOpts({ paginationMode: "none" }));
    expect("pagination" in src.state().snapshot).toBe(false);
    expect(src.write.canAppendRow?.()).toBe(true);
  });
});

describe("inMemoryReadonlyLevelSource", () => {
  it("rejects missing, empty, and duplicate initial row keys", () => {
    const missing = {
      levelName: "items",
      columns: { id: "missing" },
    } as unknown as TreeNode;
    expect(() =>
      inMemoryReadonlyLevelSource(baseOpts({ initialNodes: [missing] })),
    ).toThrow("TreeNode.rowKey is required");
    expect(() =>
      inMemoryReadonlyLevelSource(
        baseOpts({
          initialNodes: [
            { rowKey: "", levelName: "items", columns: { id: "empty" } },
          ],
        }),
      ),
    ).toThrow("TreeNode.rowKey must be non-empty");
    expect(() =>
      inMemoryReadonlyLevelSource(
        baseOpts({
          initialNodes: [
            { rowKey: "same", levelName: "items", columns: { id: "one" } },
            { rowKey: "same", levelName: "items", columns: { id: "two" } },
          ],
        }),
      ),
    ).toThrow('duplicate TreeNode.rowKey "same"');
  });

  it("omits the write capability", () => {
    const src = inMemoryReadonlyLevelSource(baseOpts());
    expect(src.write).toBeUndefined();
  });

  it("edit verbs are absent from the read surface", () => {
    const src = inMemoryReadonlyLevelSource(baseOpts());
    expect("setCell" in src).toBe(false);
    expect("applyChanges" in src).toBe(false);
    expect("createNode" in src).toBe(false);
    expect("removeNode" in src).toBe(false);
    expect("onReconcile" in src).toBe(false);
  });

  it("query sort/filter work and emit identity-stable snapshots", async () => {
    const many: TreeNode[] = Array.from({ length: 25 }, (_, i) => ({
      rowKey: `r${i}`,
      levelName: "items",
      columns: { id: `r${i}`, amount: i, name: `n${i}` },
    }));
    const src = inMemoryReadonlyLevelSource(
      baseOpts({ initialNodes: many, initialPage: 0, initialPageSize: 10 }),
    );

    const s1 = src.state().snapshot;
    expect(src.state().snapshot).toBe(s1);

    await src.query!.sort!.set([{ colId: "amount", direction: "desc" }]);
    const s2 = src.state().snapshot;
    expect(s2).not.toBe(s1);
    expect(s2.nodes[0].columns.id).toBe("r24");

    await src.query!.filter!.set({
      amount: (v: unknown) => typeof v === "number" && v % 2 === 0,
    } satisfies TestFilter);
    const s3 = src.state().snapshot;
    expect(s3).not.toBe(s2);
    expect("pagination" in s3).toBe(false);
    expect(src.state().snapshot).toBe(s3);
  });

  it("does not expose refetch on in-memory readonly sources", () => {
    const src = inMemoryReadonlyLevelSource(baseOpts());
    expect(src.query?.refetch).toBeUndefined();
  });
});
