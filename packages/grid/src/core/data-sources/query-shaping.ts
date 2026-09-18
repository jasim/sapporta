import type { RowPredicate, SortDescriptor } from "../pipeline/types";
import type { RowKey } from "../types/identity";
import type { TreeNode } from "../types/level-row";
import type { ColumnSchema } from "../types/schema";
import { makeRowComparator } from "../pipeline/stages/sort-impl";
import { treeParentKey } from "../types/tree";

// Source shaping runs before display rows exist. These helpers only see
// `TreeNode` arrays, so rollup payloads stay attached to their owner nodes and
// footer/phantom/structural rows cannot accidentally enter query shaping.
export function filterSourceNodes(
  nodes: readonly TreeNode[],
  predicate: RowPredicate | undefined,
): readonly TreeNode[] {
  if (!predicate) return nodes;
  return nodes.filter((node) => predicate(node.columns));
}

export function sortSourceNodes(
  nodes: readonly TreeNode[],
  sort: readonly SortDescriptor[] | undefined,
  columns: readonly ColumnSchema[],
): readonly TreeNode[] {
  if (!sort || sort.length === 0) return nodes;
  const copy = nodes.slice();
  const compare = makeRowComparator(sort, columns);
  copy.sort((a, b) => compare(a.columns, b.columns));
  return copy;
}

export function sliceSourceNodes(
  nodes: readonly TreeNode[],
  slice: { offset: number; limit: number },
): readonly TreeNode[] {
  const end = Number.isFinite(slice.limit)
    ? slice.offset + slice.limit
    : nodes.length;
  return nodes.slice(slice.offset, end);
}

/**
 * What a filtered tree level keeps besides the rows that match.
 *
 * - `"ancestors"`: each match's ancestors, so the match shows in place.
 * - `"ancestors-and-descendants"`: the ancestors, and every descendant of a
 *   match, so a matching parent shows its whole subtree.
 */
export type TreeMatchContext = "ancestors" | "ancestors-and-descendants";

export type TreeFilterResult = {
  /** Matches plus their context, in input order. */
  readonly nodes: readonly TreeNode[];
  /** Ancestors present only because a descendant matched, in input order. */
  readonly contextRowKeys: readonly RowKey[];
  readonly matchCount: number;
};

// Filtering a tree level must keep the tree connected: a match deep in the
// tree is shown under its ancestors. The ancestors that do not match
// themselves are context rows; `LevelSnapshot.treeContextRowKeys` carries
// them so the grid can style them. A parent key that names no row, or a
// parent loop, ends the walk.
export function filterTreeSourceNodes(
  nodes: readonly TreeNode[],
  predicate: RowPredicate | undefined,
  options: {
    readonly parentKeyField: string;
    readonly matchContext?: TreeMatchContext;
  },
): TreeFilterResult {
  if (!predicate) {
    return { nodes, contextRowKeys: [], matchCount: nodes.length };
  }
  const parentKeyOf = new Map<RowKey, RowKey | null>();
  const childKeysOf = new Map<RowKey, RowKey[]>();
  for (const node of nodes) parentKeyOf.set(node.rowKey, null);
  for (const node of nodes) {
    const parentKey = treeParentKey(node.columns[options.parentKeyField]);
    if (parentKey === null || !parentKeyOf.has(parentKey)) continue;
    parentKeyOf.set(node.rowKey, parentKey);
    const siblings = childKeysOf.get(parentKey);
    if (siblings) siblings.push(node.rowKey);
    else childKeysOf.set(parentKey, [node.rowKey]);
  }

  const matched = nodes
    .filter((node) => predicate(node.columns))
    .map((node) => node.rowKey);
  const included = new Set<RowKey>(matched);
  if ((options.matchContext ?? "ancestors-and-descendants") !== "ancestors") {
    const pending = [...matched];
    while (pending.length > 0) {
      for (const child of childKeysOf.get(pending.pop()!) ?? []) {
        if (included.has(child)) continue;
        included.add(child);
        pending.push(child);
      }
    }
  }
  // Every row a walk adds becomes included, so a walk stops at a row it has
  // already seen, and a parent loop ends there too.
  const context = new Set<RowKey>();
  for (const rowKey of matched) {
    let parentKey = parentKeyOf.get(rowKey) ?? null;
    while (parentKey !== null && !included.has(parentKey)) {
      included.add(parentKey);
      context.add(parentKey);
      parentKey = parentKeyOf.get(parentKey) ?? null;
    }
  }

  return {
    nodes: nodes.filter((node) => included.has(node.rowKey)),
    contextRowKeys: nodes
      .filter((node) => context.has(node.rowKey))
      .map((node) => node.rowKey),
    matchCount: matched.length,
  };
}
