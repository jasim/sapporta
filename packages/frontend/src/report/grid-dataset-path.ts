import { decomposePath, type GridPath } from "@sapporta/grid";
import type {
  GridDataset,
  GridDatasetNode,
} from "@sapporta/shared/grid-dataset";

export function gridDatasetAncestorsForPath(
  dataset: GridDataset,
  path: GridPath,
): GridDatasetNode[] {
  const ancestors: GridDatasetNode[] = [];
  let nodes: GridDatasetNode[] = dataset.nodes;

  for (const edge of decomposePath(path).edges) {
    const parent = nodes.find((node) => node.rowKey === edge.rowKey);
    if (!parent) return ancestors;
    ancestors.push(parent);
    nodes = parent.children?.[edge.levelName] ?? [];
  }

  return ancestors;
}
