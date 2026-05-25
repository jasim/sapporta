import { describe, expect, it } from "vitest";
import {
  childPath,
  coordsEqual,
  decodeRowKeySegment,
  decomposePath,
  encodeRowKeySegment,
  makeRowId,
  parseChildPath,
  pathOfRowId,
  rootPath,
  rowKeyOfRowId,
  type GridPath,
} from "./identity";
import { capabilitiesFor } from "./capabilities";

describe("identity", () => {
  it("rootPath returns the root level name", () => {
    expect(rootPath("orders")).toBe("orders");
    expect(rootPath("rows")).toBe("rows");
  });

  it("childPath composes parent + rowKey + childKey", () => {
    expect(childPath(rootPath("orders"), "ord-1", "lines")).toBe(
      "orders.ord-1.lines",
    );
    expect(
      childPath(
        childPath(rootPath("orders"), "ord-1", "lines"),
        "ln-2",
        "notes",
      ),
    ).toBe("orders.ord-1.lines.ln-2.notes");
  });

  it("childPath rejects empty rowKey", () => {
    expect(() => childPath(rootPath("orders"), "", "lines")).toThrow(
      /empty rowKey/,
    );
  });

  it("makeRowId / pathOfRowId / rowKeyOfRowId are inverse", () => {
    const path = rootPath("rows");
    const id = makeRowId(path, "row-7");
    expect(id).toBe("rows#row-7");
    expect(pathOfRowId(id)).toBe(path);
    expect(rowKeyOfRowId(id)).toBe("row-7");
  });

  it("coordsEqual compares structurally", () => {
    const a = { rowId: makeRowId(rootPath("rows"), "x"), colId: "c1" };
    const b = { rowId: makeRowId(rootPath("rows"), "x"), colId: "c1" };
    const c = { rowId: makeRowId(rootPath("rows"), "x"), colId: "c2" };
    expect(coordsEqual(a, b)).toBe(true);
    expect(coordsEqual(a, c)).toBe(false);
  });

  // RowId is keyed on rowKey, not array index — so reordering rows in the
  // input array does not move identity.
  it("RowId survives a row-array reorder when rowKey is value-derived", () => {
    const rowKey = (node: { columns: { id: string } }) => node.columns.id;
    const before = [
      { columns: { id: "a" } },
      { columns: { id: "b" } },
      { columns: { id: "c" } },
    ];
    const after = [before[2], before[0], before[1]]; // c, a, b

    const path = rootPath("rows");
    const idsBefore = before.map((n) => makeRowId(path, rowKey(n)));
    const idsAfter = after.map((n) => makeRowId(path, rowKey(n)));

    // The set of ids is unchanged; only the array index per id moved.
    expect(new Set(idsBefore)).toEqual(new Set(idsAfter));
    expect(idsAfter).toEqual([idsBefore[2], idsBefore[0], idsBefore[1]]);
  });
});

describe("rowKey segment escape", () => {
  it("plain ASCII rowKey round-trips identically", () => {
    expect(encodeRowKeySegment("ord-1")).toBe("ord-1");
    expect(decodeRowKeySegment("ord-1")).toBe("ord-1");
  });

  it("`.` is encoded as `%2E`", () => {
    expect(encodeRowKeySegment("a.b")).toBe("a%2Eb");
    expect(decodeRowKeySegment("a%2Eb")).toBe("a.b");
  });

  it("`%` is encoded as `%25`", () => {
    expect(encodeRowKeySegment("50%")).toBe("50%25");
    expect(decodeRowKeySegment("50%25")).toBe("50%");
  });

  it("preserves distinction between `a.b` and the literal string `a%2Eb`", () => {
    expect(encodeRowKeySegment("a%2Eb")).toBe("a%252Eb");
    expect(decodeRowKeySegment("a%252Eb")).toBe("a%2Eb");
    expect(decodeRowKeySegment(encodeRowKeySegment("a.b"))).toBe("a.b");
    expect(decodeRowKeySegment(encodeRowKeySegment("a%2Eb"))).toBe("a%2Eb");
  });

  it("multi-byte UTF-8 round-trips unchanged", () => {
    for (const s of ["café", "🦀", "日本語", "人民币"]) {
      expect(decodeRowKeySegment(encodeRowKeySegment(s))).toBe(s);
    }
  });

  it("Unicode dot variants are not escaped (only ASCII `.` is)", () => {
    // U+FF0E fullwidth dot, U+2024 one-dot leader
    expect(encodeRowKeySegment("a．b")).toBe("a．b");
    expect(encodeRowKeySegment("a․b")).toBe("a․b");
  });

  it("decodes a malformed `%XX` by leaving it as-is", () => {
    // `%` followed by something other than `2E` / `25` is not produced by
    // encode; decode policy is to leave the literal character alone.
    expect(decodeRowKeySegment("a%41b")).toBe("a%41b");
    expect(decodeRowKeySegment("trailing%")).toBe("trailing%");
  });

  it("property test: decode(encode(s)) === s for arbitrary unicode", () => {
    const samples = [
      "",
      "a",
      ".",
      "%",
      "%.",
      "%2E",
      "%25",
      "..",
      "%%",
      "...",
      "a%b%c.d.e",
      "🦀.café.50%",
    ];
    for (const s of samples) {
      expect(decodeRowKeySegment(encodeRowKeySegment(s))).toBe(s);
    }
    // Random ASCII sample
    for (let i = 0; i < 50; i++) {
      let s = "";
      for (let j = 0; j < 12; j++) {
        s += String.fromCharCode(32 + Math.floor(Math.random() * 95));
      }
      expect(decodeRowKeySegment(encodeRowKeySegment(s))).toBe(s);
    }
  });

  it("rowKey containing `.` survives childPath/parseChildPath round-trip", () => {
    const parent = rootPath("orders");
    const cp = childPath(parent, "a.b", "lines");
    expect(cp).toBe("orders.a%2Eb.lines");
    expect(parseChildPath(parent, cp)).toEqual({
      rowKey: "a.b",
      childKey: "lines",
    });
  });

  it("level names containing `.` are encoded in paths and decoded by parsers", () => {
    const parent = rootPath("orders.lines");
    const child = childPath(parent, "ln.1", "orders.lines.allocations");

    expect(parent).toBe("orders%2Elines");
    expect(child).toBe("orders%2Elines.ln%2E1.orders%2Elines%2Eallocations");
    expect(decomposePath(child)).toEqual({
      rootLevelName: "orders.lines",
      edges: [{ rowKey: "ln.1", levelName: "orders.lines.allocations" }],
    });
    expect(parseChildPath(parent, child)).toEqual({
      rowKey: "ln.1",
      childKey: "orders.lines.allocations",
    });
  });

  it("parent prefix containing encoded dots still parses correctly", () => {
    const parent = "orders.a%2Eb.lines" as GridPath;
    const child = childPath(parent, "ln-1", "notes");
    expect(child).toBe("orders.a%2Eb.lines.ln-1.notes");
    expect(parseChildPath(parent, child)).toEqual({
      rowKey: "ln-1",
      childKey: "notes",
    });
  });
});

describe("parseChildPath", () => {
  it("returns null when child does not start with parent prefix", () => {
    const parent = rootPath("orders");
    expect(
      parseChildPath(parent, "warehouses.w-1.lines" as GridPath),
    ).toBeNull();
  });

  it("returns null when tail has no separator", () => {
    const parent = rootPath("orders");
    // No trailing dot at all (would happen if `child === parent`).
    expect(parseChildPath(parent, parent)).toBeNull();
  });

  it("returns null when child is a grand-grand-child (deeper than direct)", () => {
    const parent = rootPath("orders");
    expect(
      parseChildPath(parent, "orders.ord-1.lines.ln-2.notes" as GridPath),
    ).toBeNull();
  });

  it("returns rowKey and childKey for a direct descendant", () => {
    const parent = rootPath("orders");
    const child = childPath(parent, "ord-1", "lines");
    expect(parseChildPath(parent, child)).toEqual({
      rowKey: "ord-1",
      childKey: "lines",
    });
  });
});

describe("capabilitiesFor", () => {
  it("data rows are fully interactive and can expand", () => {
    expect(capabilitiesFor("data")).toEqual({
      editable: true,
      focusable: true,
      selectable: true,
      rowSelectable: true,
      hasContextMenu: true,
      canExpand: true,
    });
  });

  it("footer rows are render-only", () => {
    const c = capabilitiesFor("footer");
    expect(c.focusable).toBe(false);
    expect(c.editable).toBe(false);
    expect(c.selectable).toBe(false);
    expect(c.rowSelectable).toBe(false);
  });

  it("opening / closing rows are focusable but not editable or selectable", () => {
    for (const k of ["opening", "closing"] as const) {
      const c = capabilitiesFor(k);
      expect(c.focusable).toBe(true);
      expect(c.editable).toBe(false);
      expect(c.selectable).toBe(false);
      expect(c.rowSelectable).toBe(false);
    }
  });

  it("phantoms are editable but cannot expand", () => {
    const c = capabilitiesFor("phantom");
    expect(c.editable).toBe(true);
    expect(c.rowSelectable).toBe(true);
    expect(c.canExpand).toBe(false);
  });
});
