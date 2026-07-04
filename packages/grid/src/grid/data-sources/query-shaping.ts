import type { RowPredicate, SortDescriptor } from "../pipeline/types";
import type { TreeNode } from "../types/level-row";
import type { ColumnSchema } from "../types/schema";
import { makeRowComparator } from "../pipeline/stages/sort-impl";

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
