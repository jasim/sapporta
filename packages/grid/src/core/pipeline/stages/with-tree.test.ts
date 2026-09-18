import { describe, expect, it } from "vitest";
import {
  makeLevelRowId,
  makeRowId,
  rootPath,
  type RowId,
} from "../../types/identity";
import type { PhantomRow, TreeNode } from "../../types/level-row";
import { treeParentKey, type TreeExpansionView } from "../../types/tree";
import type { ProtoRow } from "../types";
import { buildDataRows } from "./build-data";
import { withTree } from "./with-tree";

const path = rootPath("accounts");
const id = (key: string) => makeRowId(path, key);

function node(rowKey: string, parent: unknown, name = rowKey): TreeNode {
  return {
    rowKey,
    levelName: "accounts",
    columns: { name, parent_id: parent },
  };
}

const expanded: TreeExpansionView = {
  defaultExpanded: true,
  toggled: new Set(),
};

function derive(
  nodes: readonly TreeNode[],
  options: {
    expansion?: TreeExpansionView;
    phantoms?: readonly PhantomRow[];
    contextRowKeys?: readonly string[];
  } = {},
) {
  return withTree({
    path,
    rows: buildDataRows(nodes, {}),
    phantoms: options.phantoms ?? [],
    options: { allowPhantoms: true },
    parentKeyField: "parent_id",
    expansion: options.expansion ?? expanded,
    contextRowKeys: options.contextRowKeys,
  });
}

function keysOf(rows: readonly ProtoRow[]): string[] {
  return rows.map((row) => row.rowKey);
}

function factsOf(rows: readonly ProtoRow[], rowKey: string) {
  const row = rows.find((candidate) => candidate.rowKey === rowKey);
  if (!row || (row.kind !== "data" && row.kind !== "phantom")) {
    throw new Error(`no tree row ${rowKey}`);
  }
  return row.tree;
}

// Assets(1) > Checking(2), Savings(3); Expenses(4) > Taxes(5) > Federal(6).
// Children are listed before their parents to show that source order only
// orders siblings.
const accounts: TreeNode[] = [
  node("6", 5, "Federal"),
  node("2", 1, "Checking"),
  node("1", null, "Assets"),
  node("5", 4, "Taxes"),
  node("4", null, "Expenses"),
  node("3", 1, "Savings"),
];

describe("withTree", () => {
  it("walks depth-first and keeps source order among siblings", () => {
    const result = derive(accounts);
    expect(keysOf(result.rows)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(factsOf(result.rows, "1")).toMatchObject({
      depth: 0,
      parentId: null,
    });
    expect(factsOf(result.rows, "6")).toMatchObject({
      depth: 2,
      parentId: id("5"),
    });
    expect(result.structure.order).toEqual(
      ["1", "2", "3", "4", "5", "6"].map(id),
    );
  });

  it("reports child counts and sibling positions from the whole snapshot", () => {
    const result = derive(accounts, {
      expansion: { defaultExpanded: true, toggled: new Set([id("1")]) },
    });
    expect(keysOf(result.rows)).toEqual(["1", "4", "5", "6"]);
    expect(factsOf(result.rows, "1")).toEqual({
      depth: 0,
      parentId: null,
      childCount: 2,
      expanded: false,
      positionInSet: 1,
      setSize: 2,
      context: false,
    });
    expect(factsOf(result.rows, "4")).toMatchObject({
      childCount: 1,
      expanded: true,
      positionInSet: 2,
      setSize: 2,
    });
    expect(factsOf(result.rows, "6")).toMatchObject({
      childCount: 0,
      expanded: false,
      positionInSet: 1,
      setSize: 1,
    });
    expect(result.structure.childrenById.get(id("1"))).toEqual([
      id("2"),
      id("3"),
    ]);
  });

  it("omits every descendant of a collapsed row", () => {
    const result = derive(accounts, {
      expansion: { defaultExpanded: false, toggled: new Set([id("4")]) },
    });
    // Expenses is toggled open against the collapsed default; Taxes is not.
    expect(keysOf(result.rows)).toEqual(["1", "4", "5"]);
    expect(factsOf(result.rows, "5")).toMatchObject({ expanded: false });
    // The structure still holds hidden rows.
    expect(result.structure.parentById.get(id("6"))).toBe(id("5"));
  });

  it("treats a leaf as not expanded whatever its toggle says", () => {
    const result = derive(accounts, {
      expansion: { defaultExpanded: true, toggled: new Set([id("2")]) },
    });
    expect(factsOf(result.rows, "2")).toMatchObject({
      childCount: 0,
      expanded: false,
    });
  });

  it("shows a row whose parent is missing at top level", () => {
    const result = derive([node("1", null), node("2", 99), node("3", 2)]);
    expect(keysOf(result.rows)).toEqual(["1", "2", "3"]);
    expect(factsOf(result.rows, "2")).toMatchObject({
      depth: 0,
      parentId: null,
      positionInSet: 2,
    });
    expect(factsOf(result.rows, "3")).toMatchObject({ depth: 1 });
    expect(result.structure.loopRowIds).toEqual([]);
  });

  it("compares parent keys as strings", () => {
    const result = derive([node("10", null), node("11", 10)]);
    expect(factsOf(result.rows, "11")).toMatchObject({
      depth: 1,
      parentId: id("10"),
    });
    expect(treeParentKey(10)).toBe("10");
    expect(treeParentKey("")).toBeNull();
    expect(treeParentKey(undefined)).toBeNull();
    expect(treeParentKey(0)).toBe("0");
  });

  it("cuts a two-row loop and shows each row once", () => {
    const result = derive([node("1", null), node("2", 3), node("3", 2)]);
    expect(keysOf(result.rows)).toEqual(["1", "2", "3"]);
    expect(factsOf(result.rows, "2")).toMatchObject({
      depth: 0,
      parentId: null,
    });
    expect(factsOf(result.rows, "3")).toMatchObject({
      depth: 1,
      parentId: id("2"),
    });
    expect(result.structure.loopRowIds).toEqual([id("2")]);
  });

  it("shows a row that names itself as parent once, at top level", () => {
    const result = derive([node("1", 1), node("2", 1)]);
    expect(keysOf(result.rows)).toEqual(["1", "2"]);
    expect(factsOf(result.rows, "1")).toMatchObject({
      depth: 0,
      childCount: 1,
    });
    expect(result.structure.loopRowIds).toEqual([id("1")]);
  });

  it("marks context rows from the source", () => {
    const result = derive(accounts, { contextRowKeys: ["4", "5"] });
    expect(factsOf(result.rows, "4")?.context).toBe(true);
    expect(factsOf(result.rows, "5")?.context).toBe(true);
    expect(factsOf(result.rows, "6")?.context).toBe(false);
  });

  it("places a draft under its parent's last descendant", () => {
    const draft: PhantomRow = {
      rowKey: "draft-1",
      columns: { parent_id: "4" },
      state: { kind: "editing" },
    };
    const topDraft: PhantomRow = {
      rowKey: "draft-2",
      columns: {},
      state: { kind: "editing" },
    };
    const result = derive(accounts, { phantoms: [draft, topDraft] });
    expect(keysOf(result.rows)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "draft-1",
      "draft-2",
    ]);
    expect(factsOf(result.rows, "draft-1")).toMatchObject({
      depth: 1,
      parentId: id("4"),
      positionInSet: 2,
      setSize: 2,
    });
    expect(factsOf(result.rows, "4")?.childCount).toBe(2);
    expect(factsOf(result.rows, "draft-2")).toMatchObject({
      depth: 0,
      parentId: null,
      positionInSet: 3,
    });
    const draftId: RowId = makeLevelRowId(path, "phantom", "draft-1");
    expect(result.structure.parentById.get(draftId)).toBe(id("4"));
  });

  it("gives a leaf its first child when a draft names it", () => {
    const result = derive(accounts, {
      phantoms: [
        {
          rowKey: "draft-1",
          columns: { parent_id: 2 },
          state: { kind: "editing" },
        },
      ],
    });
    expect(factsOf(result.rows, "2")).toMatchObject({
      childCount: 1,
      expanded: true,
    });
    expect(keysOf(result.rows).slice(0, 4)).toEqual(["1", "2", "draft-1", "3"]);
  });

  it("refuses structural rows", () => {
    expect(() =>
      derive([{ ...node("1", null), kind: "subtotal" as const }]),
    ).toThrow(/cannot show "subtotal" rows/);
  });
});
