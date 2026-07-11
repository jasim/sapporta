import { describe, expect, it } from "vitest";
import { makeRowId, rootPath } from "../types/identity";
import type { LevelSchema } from "../types/schema";
import type { LevelSnapshot } from "../data-sources/types";
import type {
  TreeNode,
  LevelOptions,
  FooterRow,
  PhantomRow,
} from "../types/level-row";
import { buildDataRows } from "../pipeline/stages/build-data";
import { withRollup } from "../pipeline/stages/with-rollup";
import { withFooters } from "../pipeline/stages/with-footers";
import { withPhantoms } from "../pipeline/stages/with-phantoms";
import { withSort } from "../pipeline/stages/with-sort";
import { withRowIds } from "../pipeline/stages/with-row-ids";
import { buildDisplayed } from "../pipeline/stages/build-displayed";
import { deriveDisplayedRowsState } from ".";
import type { DisplayedRowsInput } from ".";

function phantom(rowKey: string): PhantomRow {
  return { rowKey, columns: {}, state: { kind: "editing" } };
}

const cols = [
  {
    id: "name",
    name: "Name",
    renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
    compare: (a: unknown, b: unknown) =>
      String(a ?? "").localeCompare(String(b ?? "")),
  },
  {
    id: "qty",
    name: "Qty",
    renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
    compare: (a: unknown, b: unknown) => (Number(a) || 0) - (Number(b) || 0),
  },
];

const opts: LevelOptions = {
  allowPhantoms: true,
};

const reportOpts: LevelOptions = {
  allowPhantoms: false,
};

const nodes: TreeNode[] = [
  {
    rowKey: "a",
    levelName: "root",
    columns: { id: "a", name: "Apple", qty: 3 },
  },
  {
    rowKey: "b",
    levelName: "root",
    columns: { id: "b", name: "Banana", qty: 1 },
  },
  {
    rowKey: "c",
    levelName: "root",
    columns: { id: "c", name: "Cherry", qty: 2 },
  },
];

function makeSchema(options: LevelOptions = opts, columns = cols): LevelSchema {
  return {
    name: "root",
    columns,
    rowHeaderColumn: "none",
    options,
    childLevels: [],
  };
}

function makeSnapshot(
  args: {
    nodes?: TreeNode[];
    footerRows?: FooterRow[];
  } = {},
): LevelSnapshot {
  return {
    nodes: args.nodes ?? nodes,
    ...(args.footerRows ? { footerRows: args.footerRows } : {}),
  };
}

function makeInput(
  args: {
    schema?: LevelSchema;
    snapshot?: LevelSnapshot;
    phantomRows?: PhantomRow[];
  } = {},
): DisplayedRowsInput {
  return {
    path: rootPath("root"),
    schema: args.schema ?? makeSchema(),
    sourceSnapshot: args.snapshot ?? makeSnapshot(),
    phantomRows: args.phantomRows ?? [],
    viewState: {},
  };
}

describe("buildDataRows", () => {
  it("emits one ProtoRow per TreeNode with derived rowKey", () => {
    const out = buildDataRows(nodes, opts);
    expect(out.map((r) => r.rowKey)).toEqual(["a", "b", "c"]);
    expect(out.every((r) => r.kind === "data")).toBe(true);
  });

  it("treats TreeNode.kind opening/closing/subtotal as bracket rows", () => {
    const mixed: TreeNode[] = [
      {
        rowKey: "open",
        levelName: "x",
        columns: { id: "open" },
        kind: "opening",
      },
      { rowKey: "d1", levelName: "x", columns: { id: "d1" } },
      {
        rowKey: "sub",
        levelName: "x",
        columns: { id: "sub" },
        kind: "subtotal",
      },
    ];
    const out = buildDataRows(mixed, opts);
    expect(out.map((r) => r.kind)).toEqual(["opening", "data", "subtotal"]);
  });
});

describe("withRollup", () => {
  it("inserts a rollup row after each data row carrying sourceSnapshot.rollup", () => {
    const withRollupNodes: TreeNode[] = [
      {
        rowKey: "a",
        levelName: "x",
        columns: { id: "a", qty: 1 },
        rollup: { id: "a-r", qty: 5 },
      },
      { rowKey: "b", levelName: "x", columns: { id: "b", qty: 2 } },
    ];
    const protos = buildDataRows(withRollupNodes, opts);
    const rolled = withRollup(protos);
    expect(rolled.map((r) => r.kind)).toEqual(["data", "rollup", "data"]);
    expect(rolled[1].rowKey).toBe("a");
  });

  it("returns the same array reference when nothing rolls up", () => {
    const protos = buildDataRows(nodes, opts);
    expect(withRollup(protos)).toBe(protos);
  });
});

describe("withFooters", () => {
  it("appends footers and namespaces their rowKeys", () => {
    const protos = buildDataRows(nodes, opts);
    const footers: FooterRow[] = [
      { rowKey: "total", columns: { name: "Total", qty: 6 } },
    ];
    const out = withFooters(protos, footers);
    expect(out[out.length - 1].kind).toBe("footer");
    expect(out[out.length - 1].rowKey).toBe("total");
  });

  it("returns the same array when no footers", () => {
    const protos = buildDataRows(nodes, opts);
    expect(withFooters(protos, [])).toBe(protos);
  });
});

describe("withPhantoms", () => {
  it("appends phantoms when level allows them", () => {
    const protos = buildDataRows(nodes, opts);
    const phantomRows: PhantomRow[] = [phantom("draft1")];
    const out = withPhantoms(protos, phantomRows, opts);
    expect(out[out.length - 1].kind).toBe("phantom");
  });

  it("ignores phantoms on a level that disallows them", () => {
    const protos = buildDataRows(nodes, reportOpts);
    const phantomRows: PhantomRow[] = [phantom("draft1")];
    expect(withPhantoms(protos, phantomRows, reportOpts)).toBe(protos);
  });
});

describe("withSort", () => {
  it("orders data rows by the descriptor", () => {
    const protos = buildDataRows(nodes, opts);
    const out = withSort(protos, [{ colId: "qty", direction: "asc" }], cols);
    expect(out.map((r) => (r.kind === "data" ? r.columns.id : null))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts data rows even when non-data anchors are interleaved", () => {
    const protos = buildDataRows(nodes, opts);
    const interleaved = [
      protos[0],
      protos[1],
      {
        kind: "footer",
        rowKey: "f",
        columns: {},
        source: { rowKey: "f", columns: {} },
      } as never,
      protos[2],
    ];
    const out = withSort(
      interleaved,
      [{ colId: "qty", direction: "asc" }],
      cols,
    );
    const dataIds = out
      .filter((r) => r.kind === "data")
      .map((r) => r.columns.id);
    expect(dataIds).toEqual(["b", "c", "a"]);
    expect(out[2].kind).toBe("footer");
  });

  it("descending reverses the order", () => {
    const protos = buildDataRows(nodes, opts);
    const out = withSort(protos, [{ colId: "name", direction: "desc" }], cols);
    expect(out.map((r) => (r.kind === "data" ? r.columns.id : null))).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("skips descriptors whose columns have no comparator", () => {
    const protos = buildDataRows(nodes, opts);
    const unsortable = cols.map((c) =>
      c.id === "qty" ? { ...c, compare: undefined } : c,
    );
    const out = withSort(
      protos,
      [{ colId: "qty", direction: "asc" }],
      unsortable,
    );
    expect(out.map((r) => (r.kind === "data" ? r.columns.id : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("skips unknown sort columns", () => {
    const protos = buildDataRows(nodes, opts);
    const out = withSort(
      protos,
      [{ colId: "missing", direction: "asc" }],
      cols,
    );
    expect(out.map((r) => (r.kind === "data" ? r.columns.id : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("lets host comparator failures surface", () => {
    const protos = buildDataRows(nodes, opts);
    const throwing = cols.map((c) =>
      c.id === "qty"
        ? {
            ...c,
            compare: () => {
              throw new Error("bad compare");
            },
          }
        : c,
    );
    expect(() =>
      withSort(protos, [{ colId: "qty", direction: "asc" }], throwing),
    ).toThrow("bad compare");
  });

  it("keeps a row's rollup glued to the row when sorting", () => {
    const withRollupNodes: TreeNode[] = [
      {
        rowKey: "a",
        levelName: "x",
        columns: { id: "a", qty: 3 },
        rollup: { id: "a-r", qty: 99 },
      },
      { rowKey: "b", levelName: "x", columns: { id: "b", qty: 1 } },
    ];
    const a = buildDataRows(withRollupNodes, opts);
    const b = withRollup(a);
    const out = withSort(b, [{ colId: "qty", direction: "asc" }], cols);
    expect(out.map((r) => r.kind)).toEqual(["data", "data", "rollup"]);
    expect(out[1].rowKey).toBe("a");
    expect(out[2].rowKey).toBe("a");
  });
});

describe("withRowIds + buildDisplayed", () => {
  it("assigns RowId from path + rowKey and builds lookup tables", () => {
    const path = rootPath("root");
    const protos = buildDataRows(nodes, opts);
    const rows = withRowIds(protos, path);
    expect(rows[0].id).toBe(makeRowId(path, "a"));
    const displayed = buildDisplayed(rows);
    expect(displayed.rowIndexById.get(makeRowId(path, "b"))).toBe(1);
    expect(displayed.rowById.get(makeRowId(path, "c"))?.kind).toBe("data");
  });
});

describe("deriveDisplayedRowsState composition", () => {
  it("composes stages end to end", () => {
    const input = makeInput({
      snapshot: makeSnapshot({
        footerRows: [{ rowKey: "total", columns: { name: "Total", qty: 6 } }],
      }),
      phantomRows: [phantom("p1")],
    });
    const out = deriveDisplayedRowsState(input);
    expect(out.displayedRows.rows.map((r) => r.kind)).toEqual([
      "data",
      "data",
      "data",
      "footer",
      "phantom",
    ]);
    expect(
      out.displayedRows.rows
        .slice(0, 3)
        .map((r) => (r.kind === "data" ? r.columns.id : null)),
    ).toEqual(["a", "b", "c"]);
  });

  it("preserves the source's published row order", () => {
    const input = makeInput({
      snapshot: makeSnapshot({
        nodes: [nodes[1], nodes[2], nodes[0]],
      }),
    });
    const out = deriveDisplayedRowsState(input);
    expect(
      out.displayedRows.rows.map((r) =>
        r.kind === "data" ? r.columns.id : null,
      ),
    ).toEqual(["b", "c", "a"]);
  });
});

describe("deriveDisplayedRowsState identity preservation", () => {
  it("returns identical DisplayedRowsState ref when input is unchanged", () => {
    const input = makeInput();
    const a = deriveDisplayedRowsState(input);
    const b = deriveDisplayedRowsState(input, a);
    expect(a).toBe(b);
  });

  it("returns a new DisplayedRowsState ref when source row order changes", () => {
    const base = makeInput();
    const a = deriveDisplayedRowsState(base);
    expect(deriveDisplayedRowsState(base, a)).toBe(a);

    const sortedSnapshot = makeSnapshot({
      nodes: [nodes[1], nodes[2], nodes[0]],
    });
    const sortedInput: DisplayedRowsInput = {
      ...base,
      sourceSnapshot: sortedSnapshot,
    };
    const sorted = deriveDisplayedRowsState(sortedInput, a);
    expect(sorted).not.toBe(a);
    expect(deriveDisplayedRowsState(sortedInput, sorted)).toBe(sorted);
  });

  it("changing nodes invalidates everything downstream", () => {
    const base = makeInput();
    const a = deriveDisplayedRowsState(base);
    const newNodes = [
      ...nodes,
      {
        rowKey: "d",
        levelName: "root",
        columns: { id: "d", name: "Date", qty: 4 },
      },
    ];
    const b = deriveDisplayedRowsState(
      { ...base, sourceSnapshot: makeSnapshot({ nodes: newNodes }) },
      a,
    );
    expect(b).not.toBe(a);
    expect(b.displayedRows.rows.length).toBe(a.displayedRows.rows.length + 1);
  });

  it("phantom-only change keeps existing data rows semantically stable", () => {
    const base = makeInput({ phantomRows: [] });
    const first = deriveDisplayedRowsState(base);
    expect(first.displayedRows.rows.some((r) => r.kind === "phantom")).toBe(
      false,
    );
    const phantomRows: PhantomRow[] = [phantom("p1")];
    const second = deriveDisplayedRowsState({ ...base, phantomRows }, first);
    expect(second).not.toBe(first);
    expect(second.displayedRows.rows.some((r) => r.kind === "phantom")).toBe(
      true,
    );
    expect(
      second.displayedRows.rows
        .slice(0, 3)
        .map((r) => (r.kind === "data" ? r.columns.id : null)),
    ).toEqual(["a", "b", "c"]);
    expect(second.displayedRows.rows.slice(0, 3)).toEqual(
      first.displayedRows.rows.slice(0, 3),
    );
  });
});

describe("deriveDisplayedRowsState row sequence", () => {
  it("reuses DisplayedRowSequence when only row content changes", () => {
    const base = makeInput();
    const first = deriveDisplayedRowsState(base);
    const nextNodes = [
      {
        rowKey: "a",
        levelName: "root",
        columns: { id: "a", name: "Apricot", qty: 3 },
      },
      nodes[1],
      nodes[2],
    ];

    const second = deriveDisplayedRowsState(
      { ...base, sourceSnapshot: makeSnapshot({ nodes: nextNodes }) },
      first,
    );

    expect(second.displayedRowSequence).toBe(first.displayedRowSequence);
    expect(
      second.displayedRows.rowById.get(makeRowId(rootPath("root"), "a")),
    ).not.toBe(
      first.displayedRows.rowById.get(makeRowId(rootPath("root"), "a")),
    );
  });

  it("changes DisplayedRowSequence when source nodes change order or membership", () => {
    const base = makeInput();
    const first = deriveDisplayedRowsState(base);

    const sorted = deriveDisplayedRowsState(
      {
        ...base,
        sourceSnapshot: makeSnapshot({
          nodes: [nodes[1], nodes[2], nodes[0]],
        }),
      },
      first,
    );
    expect(sorted.displayedRowSequence).not.toBe(first.displayedRowSequence);
    expect(sorted.displayedRowSequence.rows.map((r) => r.id)).toEqual([
      makeRowId(rootPath("root"), "b"),
      makeRowId(rootPath("root"), "c"),
      makeRowId(rootPath("root"), "a"),
    ]);

    const filtered = deriveDisplayedRowsState(
      {
        ...base,
        sourceSnapshot: makeSnapshot({
          nodes: [nodes[0], nodes[2]],
        }),
      },
      first,
    );
    expect(filtered.displayedRowSequence).not.toBe(first.displayedRowSequence);
    expect(filtered.displayedRowSequence.rows.map((r) => r.id)).toEqual([
      makeRowId(rootPath("root"), "a"),
      makeRowId(rootPath("root"), "c"),
    ]);
  });

  it("returns the same state object between unchanged snapshots", () => {
    const input = makeInput();
    const first = deriveDisplayedRowsState(input);
    const second = deriveDisplayedRowsState(input, first);

    expect(second).toBe(first);
    expect(second.displayedRowSequence).toBe(first.displayedRowSequence);
  });
});
