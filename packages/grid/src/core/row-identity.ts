import type { RowId, RowKey } from "./types/identity";
import type { LevelRow, TreeNode } from "./types/level-row";

export function rowKeyOfTreeNode(node: TreeNode, context: string): RowKey {
  const rowKey = (node as { readonly rowKey?: unknown }).rowKey;
  if (typeof rowKey !== "string") {
    throw new Error(`${context}: TreeNode.rowKey is required`);
  }
  if (rowKey.length === 0) {
    throw new Error(`${context}: TreeNode.rowKey must be non-empty`);
  }
  return rowKey;
}

export function assertUniqueTreeNodeRowKeys(
  nodes: readonly TreeNode[],
  context: string,
): void {
  const seen = new Set<RowKey>();
  for (const node of nodes) {
    const rowKey = rowKeyOfTreeNode(node, context);
    if (seen.has(rowKey)) {
      throw new Error(`${context}: duplicate TreeNode.rowKey "${rowKey}"`);
    }
    seen.add(rowKey);
  }
}

export function assertTreeNodeCanBeInserted(
  nodes: readonly TreeNode[],
  node: TreeNode,
  context: string,
): void {
  const rowKey = rowKeyOfTreeNode(node, context);
  for (const existing of nodes) {
    if (rowKeyOfTreeNode(existing, context) === rowKey) {
      throw new Error(`${context}: duplicate TreeNode.rowKey "${rowKey}"`);
    }
  }
}

export function assertUniqueDisplayedRowIds(
  rows: readonly LevelRow[],
  context: string,
): void {
  const seen = new Set<RowId>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`${context}: duplicate displayed RowId "${row.id}"`);
    }
    seen.add(row.id);
  }
}
