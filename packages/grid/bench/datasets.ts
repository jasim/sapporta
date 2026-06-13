import type { ReactNode } from "react";
import type { GridSchema, ColumnSchema } from "../src/grid/types/schema";
import type { TreeNode } from "../src/grid/types/level-row";
import type { ColId, RowKey } from "../src/grid/types/identity";
import type { InMemoryGridDataSourceOpts } from "../src/grid/data-sources/memory/in-memory-grid-source";

export type BenchDatasetName =
  | "regular"
  | "medium"
  | "large"
  | "wideFlat"
  | "deepTree";

export type BenchDatasetConfig = {
  name: BenchDatasetName;
  rootRows: number;
  depth: number;
  branching: number;
  columns: number;
};

export type BenchDataset = {
  config: BenchDatasetConfig;
  schema: GridSchema;
  tree: TreeNode[];
  levels: InMemoryGridDataSourceOpts["levels"];
  expectedNodeCount: number;
};

const DATASETS: Record<BenchDatasetName, BenchDatasetConfig> = {
  regular: {
    name: "regular",
    rootRows: 1_000,
    depth: 2,
    branching: 3,
    columns: 10,
  },
  medium: {
    name: "medium",
    rootRows: 2_000,
    depth: 3,
    branching: 3,
    columns: 20,
  },
  large: {
    name: "large",
    rootRows: 5_000,
    depth: 3,
    branching: 5,
    columns: 30,
  },
  wideFlat: {
    name: "wideFlat",
    rootRows: 25_000,
    depth: 1,
    branching: 0,
    columns: 50,
  },
  deepTree: {
    name: "deepTree",
    rootRows: 100,
    depth: 6,
    branching: 3,
    columns: 16,
  },
};

export function datasetConfigFor(name: BenchDatasetName): BenchDatasetConfig {
  return DATASETS[name];
}

export function datasetNames(): BenchDatasetName[] {
  return Object.keys(DATASETS) as BenchDatasetName[];
}

export function buildBenchDataset(config: BenchDatasetConfig): BenchDataset {
  const schema = buildSchema(config);
  const tree = buildLevelRows(config, 0, config.rootRows, "r");
  return {
    config,
    schema,
    tree,
    levels: Object.fromEntries(
      Array.from({ length: config.depth }, (_, levelIndex) => [
        levelName(levelIndex),
        {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      ]),
    ),
    expectedNodeCount: countNodes(tree),
  };
}

function buildSchema(config: BenchDatasetConfig): GridSchema {
  const levels: GridSchema["levels"] = {};
  for (let levelIndex = 0; levelIndex < config.depth; levelIndex++) {
    levels[levelName(levelIndex)] = {
      name: levelName(levelIndex),
      columns: buildColumns(config.columns),
      options: {
        rowKey: (node) => node.columns.id as RowKey,
        allowPhantoms: true,
      },
      childLevels:
        levelIndex + 1 < config.depth ? [levelName(levelIndex + 1)] : [],
    };
  }
  return {
    rootLevel: levelName(0),
    levels,
  };
}

function buildColumns(count: number): ColumnSchema[] {
  return Array.from({ length: count }, (_, index) => {
    const id = (index === 0 ? "id" : `c${index}`) as ColId;
    return {
      id,
      name: id,
      renderCell: ({ value }): ReactNode => String(value ?? ""),
      compare: (a, b) => String(a ?? "").localeCompare(String(b ?? "")),
      editCell: undefined,
    };
  });
}

function buildLevelRows(
  config: BenchDatasetConfig,
  levelIndex: number,
  count: number,
  prefix: string,
): TreeNode[] {
  return Array.from({ length: count }, (_, rowIndex) => {
    const key = `${prefix}-${rowIndex}`;
    const columns: Record<ColId, unknown> = {
      id: key,
    };
    for (let colIndex = 1; colIndex < config.columns; colIndex++) {
      columns[`c${colIndex}`] = `${key}:c${colIndex}`;
    }
    const nextLevelIndex = levelIndex + 1;
    const children =
      nextLevelIndex < config.depth
        ? {
            [levelName(nextLevelIndex)]: buildLevelRows(
              config,
              nextLevelIndex,
              config.branching,
              key,
            ),
          }
        : undefined;
    return {
      levelName: levelName(levelIndex),
      columns,
      children,
    };
  });
}

function levelName(index: number): string {
  return `L${index}`;
}

function countNodes(nodes: readonly TreeNode[]): number {
  let count = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    count++;
    if (!node.children) continue;
    for (const child of Object.values(node.children)) {
      if (Array.isArray(child)) stack.push(...child);
      else stack.push(child);
    }
  }
  return count;
}
