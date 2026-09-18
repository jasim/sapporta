import { describe, expect, it } from "vitest";
import type { TreeNode } from "../types/level-row";
import { filterTreeSourceNodes } from "./query-shaping";
import { inMemoryLevelSource } from "./memory/in-memory-level-source";

function node(rowKey: string, parent: string | null, name: string): TreeNode {
  return {
    rowKey,
    levelName: "accounts",
    columns: { name, parent_id: parent },
  };
}

// Expenses(4) > Taxes(5) > Federal(6), State(7); Income(8).
const nodes = [
  node("4", null, "Expenses"),
  node("5", "4", "Taxes"),
  node("6", "5", "Federal"),
  node("7", "5", "State"),
  node("8", null, "Income"),
];

const named = (text: string) => (columns: Record<string, unknown>) =>
  String(columns.name).includes(text);

describe("filterTreeSourceNodes", () => {
  it("keeps ancestors as context and a match's descendants by default", () => {
    const result = filterTreeSourceNodes(nodes, named("Taxes"), {
      parentKeyField: "parent_id",
    });
    expect(result.nodes.map((n) => n.rowKey)).toEqual(["4", "5", "6", "7"]);
    expect(result.contextRowKeys).toEqual(["4"]);
    expect(result.matchCount).toBe(1);
  });

  it("keeps only ancestors when asked", () => {
    const result = filterTreeSourceNodes(nodes, named("Taxes"), {
      parentKeyField: "parent_id",
      matchContext: "ancestors",
    });
    expect(result.nodes.map((n) => n.rowKey)).toEqual(["4", "5"]);
  });

  it("does not mark a matching ancestor as context", () => {
    const matches = new Set(["Expenses", "Federal", "Income"]);
    const result = filterTreeSourceNodes(
      nodes,
      (columns) => matches.has(String(columns.name)),
      { parentKeyField: "parent_id", matchContext: "ancestors" },
    );
    expect(result.nodes.map((n) => n.rowKey)).toEqual(["4", "5", "6", "8"]);
    expect(result.contextRowKeys).toEqual(["5"]);
    expect(result.matchCount).toBe(3);
  });

  it("ends the walk at a parent loop", () => {
    const loop = [node("1", "2", "One"), node("2", "1", "Two")];
    const result = filterTreeSourceNodes(loop, named("One"), {
      parentKeyField: "parent_id",
    });
    expect(result.nodes.map((n) => n.rowKey)).toEqual(["1", "2"]);
  });
});

describe("inMemoryLevelSource with a tree", () => {
  it("publishes context rows while a filter is active", async () => {
    const source = inMemoryLevelSource<string>({
      initialNodes: nodes,
      columns: [],
      sortMode: "none",
      filterMode: "client",
      paginationMode: "none",
      compileFilter: (filter) => (filter ? named(filter) : undefined),
      tree: { parentKeyField: "parent_id" },
    });
    expect(source.state().snapshot.treeContextRowKeys).toBeUndefined();
    await source.query!.filter!.set("Federal");
    const snapshot = source.state().snapshot;
    expect(snapshot.nodes.map((n) => n.rowKey)).toEqual(["4", "5", "6"]);
    expect(snapshot.treeContextRowKeys).toEqual(["4", "5"]);
    await source.query!.filter!.set(undefined);
    expect(source.state().snapshot.treeContextRowKeys).toBeUndefined();
  });
});
