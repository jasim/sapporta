import type { LevelOptions, TreeNode } from "../../types/level-row";
import type { ProtoRow } from "../types";

// Foundation step: TreeNode[] → ProtoRow[] (data rows only, no rollups
// or brackets). Subsequent stages decorate this list.
export function buildDataRows(
  nodes: readonly TreeNode[],
  options: LevelOptions,
): ProtoRow[] {
  void options;
  const out: ProtoRow[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const key = node.rowKey;
    const hasChildren =
      !!node.children && Object.keys(node.children).length > 0;
    if (
      node.kind === "opening" ||
      node.kind === "closing" ||
      node.kind === "subtotal"
    ) {
      out.push({
        kind: node.kind,
        rowKey: key,
        columns: node.columns,
        source: node,
      });
    } else {
      out.push({
        kind: "data",
        rowKey: key,
        columns: node.columns,
        hasChildren,
        source: node,
      });
    }
  }
  return out;
}
