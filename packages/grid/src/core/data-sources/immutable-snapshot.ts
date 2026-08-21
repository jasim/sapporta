import type { FooterRow, TreeNode } from "../types/level-row";
import type { LevelSnapshot } from "./types";

export type StructuralSnapshotCache = {
  readonly treeNodes: WeakMap<TreeNode, TreeNode>;
  readonly footerRows: WeakMap<FooterRow, FooterRow>;
};

export function createStructuralSnapshotCache(): StructuralSnapshotCache {
  return {
    treeNodes: new WeakMap(),
    footerRows: new WeakMap(),
  };
}

export function snapshotFooterRow(
  row: FooterRow,
  cache: StructuralSnapshotCache,
): FooterRow {
  const existing = cache.footerRows.get(row);
  if (existing) return existing;
  const snapshot = Object.freeze({
    rowKey: row.rowKey,
    columns: Object.freeze({ ...row.columns }),
  });
  cache.footerRows.set(row, snapshot);
  cache.footerRows.set(snapshot, snapshot);
  return snapshot;
}

export function snapshotFooterRows(
  rows: readonly FooterRow[],
  cache: StructuralSnapshotCache,
): readonly FooterRow[] {
  return Object.freeze(rows.map((row) => snapshotFooterRow(row, cache)));
}

export function snapshotTreeNode(
  node: TreeNode,
  cache: StructuralSnapshotCache,
): TreeNode {
  const existing = cache.treeNodes.get(node);
  if (existing) return existing;

  const children: Record<string, TreeNode | readonly TreeNode[]> = {};
  for (const [levelName, child] of Object.entries(node.children ?? {})) {
    children[levelName] = Array.isArray(child)
      ? snapshotTreeNodes(child, cache)
      : snapshotTreeNode(child as TreeNode, cache);
  }

  const childFooterRows: Record<string, readonly FooterRow[]> = {};
  for (const [levelName, rows] of Object.entries(node.childFooterRows ?? {})) {
    childFooterRows[levelName] = snapshotFooterRows(rows, cache);
  }

  const snapshot = Object.freeze({
    rowKey: node.rowKey,
    levelName: node.levelName,
    columns: Object.freeze({ ...node.columns }),
    ...(node.rollup ? { rollup: Object.freeze({ ...node.rollup }) } : {}),
    ...(Object.keys(children).length > 0
      ? { children: Object.freeze(children) }
      : {}),
    ...(Object.keys(childFooterRows).length > 0
      ? { childFooterRows: Object.freeze(childFooterRows) }
      : {}),
    ...(node.kind ? { kind: node.kind } : {}),
  });
  cache.treeNodes.set(node, snapshot);
  cache.treeNodes.set(snapshot, snapshot);
  return snapshot;
}

export function snapshotTreeNodes(
  nodes: readonly TreeNode[],
  cache: StructuralSnapshotCache,
): readonly TreeNode[] {
  return Object.freeze(nodes.map((node) => snapshotTreeNode(node, cache)));
}

export function snapshotLevelSnapshot(
  snapshot: LevelSnapshot,
  cache: StructuralSnapshotCache,
): LevelSnapshot {
  const nodes = snapshotTreeNodes(snapshot.nodes, cache);
  const footerRows = snapshot.footerRows
    ? snapshotFooterRows(snapshot.footerRows, cache)
    : undefined;
  return Object.freeze({
    nodes,
    ...(footerRows ? { footerRows } : {}),
  });
}
