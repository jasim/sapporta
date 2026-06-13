// In-memory `GridDataSource`. The host hands a single nested-children blob
// (`tree`) plus per-level opts; we wrap each parent's `children[childLevelName]`
// slice in a fresh `inMemoryLevelSource` on demand.
//
// `levels` is static opts per level, not a factory of `(ancestors) => opts`
// like `restGridDataSource`. REST needs the factory because parent IDs bake
// into URLs (`/orders/${orderId}/lines`); in-memory locates a child slice by
// tree walk, so nothing in a level's config varies per parent. Hosts that
// genuinely need per-parent in-memory variation write a custom `GridDataSource`.
//
// Lifecycle: the runtime owns caching and double-resolve guarding (see
// `GridDataSource` contract). Each call to `resolveChild` returns a fresh
// source; `dispose()` chains to every source we handed out so the host can
// tear the whole graph down without enumerating children itself.
//
// Path walking: `parentPath` is decoded as an alternation of (levelName,
// rowKey, …, levelName) segments per `identity.ts`. At each step we scan the
// current array for the node whose rowKey matches the segment, then descend
// through its `children[childLevelName]`. The walk is rowKey-keyed end to
// end — sort/filter/reorder/insert/delete on intermediate levels does not
// invalidate paths. Linear scan per step is fine because the walk runs once
// per `(parentPath, parentRowKey, childLevelName)` triple — i.e., once per
// child-level expansion, then cached by the runtime's registry. A per-level
// rowKey-index map would need maintenance across mutations and would cost
// more than it saves.
//
// Re-walks on every call are fine — the runtime's registry guarantees one
// call per `(parentPath, parentRowKey, childLevelName)` per runtime lifetime.
// The input `tree` array is treated as read-only seed data; mutating the
// returned root source (e.g. `setCell`) does NOT mutate the input `tree`.

import { defaultRowKey } from "../../pipeline/stages/build-data";
import { decomposePath } from "../../types/identity";
import type { GridPath, RowKey } from "../../types/identity";
import type { TreeNode } from "../../types/level-row";
import type { GridSchema } from "../../types/schema";
import {
  inMemoryLevelSource,
  type InMemoryLevelSourceOpts,
} from "./in-memory-level-source";
import type { GridDataSource, LevelDataSource } from "../types";

export type InMemoryLevelOpts<F = unknown> = Omit<
  InMemoryLevelSourceOpts<F>,
  "initialNodes" | "columns" | "options"
>;

export type InMemoryGridDataSourceOpts<F = unknown> = {
  schema: GridSchema;
  tree: TreeNode[];
  levels: { [levelName: string]: InMemoryLevelOpts<F> };
};

export function inMemoryGridDataSource<F = unknown>(
  opts: InMemoryGridDataSourceOpts<F>,
): GridDataSource {
  const { schema, tree, levels } = opts;

  if (!schema.levels[schema.rootLevel]) {
    throw new Error(
      `inMemoryGridDataSource: schema.rootLevel '${schema.rootLevel}' not found in schema.levels (available: ${Object.keys(schema.levels).join(", ") || "<none>"})`,
    );
  }

  const handed: LevelDataSource[] = [];
  let rootCached: LevelDataSource | null = null;

  function buildLevelSource(
    levelName: string,
    initialNodes: TreeNode[],
  ): LevelDataSource {
    const levelSchema = schema.levels[levelName];
    if (!levelSchema) {
      throw new Error(
        `inMemoryGridDataSource: schema.levels has no entry for level '${levelName}'`,
      );
    }
    const levelOpts = levels[levelName];
    if (!levelOpts) {
      throw new Error(
        `inMemoryGridDataSource: opts.levels has no entry for level '${levelName}'`,
      );
    }
    const src = inMemoryLevelSource<F>({
      initialNodes,
      options: levelSchema.options,
      columns: levelSchema.columns,
      ...levelOpts,
    });
    handed.push(src);
    return src;
  }

  return {
    rootSource() {
      if (rootCached === null) {
        rootCached = buildLevelSource(schema.rootLevel, tree);
      }
      return rootCached;
    },

    resolveChild(parentPath, parentRowKey, childLevelName) {
      const { arr: parentLevelArr, levelName: parentLevelName } =
        walkToParentLevel(tree, parentPath, schema);
      const parent = findByRowKey(
        parentLevelArr,
        parentRowKey,
        parentLevelName,
        schema,
      );
      const children = parent.children?.[childLevelName];
      const initialNodes: TreeNode[] =
        children === undefined
          ? []
          : Array.isArray(children)
            ? children
            : [children];
      return buildLevelSource(childLevelName, initialNodes);
    },

    dispose() {
      for (const src of handed) src.dispose();
      handed.length = 0;
      rootCached = null;
    },
  };
}

function walkToParentLevel(
  tree: TreeNode[],
  parentPath: GridPath,
  schema: GridSchema,
): { arr: TreeNode[]; levelName: string } {
  const decomp = decomposePath(parentPath);
  if (decomp.rootLevelName !== schema.rootLevel) {
    throw new Error(
      `inMemoryGridDataSource: parentPath '${parentPath}' root segment '${decomp.rootLevelName}' does not match schema.rootLevel '${schema.rootLevel}'`,
    );
  }
  let arr: TreeNode[] = tree;
  let levelName = decomp.rootLevelName;
  for (let i = 0; i < decomp.edges.length; i++) {
    const edge = decomp.edges[i];
    const parent = findByRowKey(arr, edge.rowKey, levelName, schema);
    const childSlice = parent.children?.[edge.levelName];
    if (childSlice === undefined) {
      throw new Error(
        `inMemoryGridDataSource: parentPath '${parentPath}' references missing child key '${edge.levelName}' at edge ${i}`,
      );
    }
    arr = Array.isArray(childSlice) ? childSlice : [childSlice];
    levelName = edge.levelName;
  }
  return { arr, levelName };
}

function findByRowKey(
  arr: TreeNode[],
  rowKey: RowKey,
  levelName: string,
  schema: GridSchema,
): TreeNode {
  const levelSchema = schema.levels[levelName];
  if (!levelSchema) {
    throw new Error(
      `inMemoryGridDataSource: schema.levels has no entry for level '${levelName}'`,
    );
  }
  const rowKeyFn = levelSchema.options.rowKey ?? defaultRowKey;
  for (let i = 0; i < arr.length; i++) {
    if (rowKeyFn(arr[i], i) === rowKey) return arr[i];
  }
  throw new Error(
    `inMemoryGridDataSource: no node with rowKey '${rowKey}' in level '${levelName}'`,
  );
}
