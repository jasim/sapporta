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
// Lifecycle: the runtime owns caching, each returned level source, and the
// double-resolve guard (see `GridDataSource` contract). Grid-source disposal
// releases only this factory's path index; it never disposes level sources.
//
// Child resolution starts at the exact live source registered for
// `parentPath`, not at the constructor's nested seed tree. Root and child
// edits, inserts, removals, bulk replacements, and later restoration are
// therefore all visible when a descendant is resolved. The input `tree`
// remains seed data only.

import { childPath, decomposePath, rootPath } from "../../types/identity";
import type { GridPath, RowKey } from "../../types/identity";
import type { FooterRow, TreeNode } from "../../types/level-row";
import type { GridSchema } from "../../types/schema";
import {
  inMemoryLevelSource,
  inMemoryReadonlyLevelSource,
  currentInMemorySourceNodes,
  type InMemoryLevelSourceOpts,
} from "./in-memory-level-source";
import type { GridDataSource, LevelDataSource } from "../types";

export type InMemoryLevelOpts<F = unknown> = Omit<
  InMemoryLevelSourceOpts<F>,
  "initialNodes" | "columns" | "options"
> & {
  readonly?: boolean;
};

export type InMemoryGridDataSourceOpts<F = unknown> = {
  schema: GridSchema;
  tree: readonly TreeNode[];
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

  const root = rootPath(schema.rootLevel);
  const liveSources = new Map<GridPath, LevelDataSource>();
  let rootCached: LevelDataSource | null = null;

  function buildLevelSource(
    path: GridPath,
    levelName: string,
    initialNodes: readonly TreeNode[],
    footerRows?: readonly FooterRow[],
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
    const { readonly: readonlySource, ...sourceOpts } = levelOpts;
    const args = {
      initialNodes,
      columns: levelSchema.columns,
      ...sourceOpts,
      footerRows: footerRows ?? sourceOpts.footerRows,
    };
    const src = readonlySource
      ? inMemoryReadonlyLevelSource<F>(args)
      : inMemoryLevelSource<F>(args);
    liveSources.set(path, src);
    return src;
  }

  function rootSource(): LevelDataSource {
    if (rootCached === null) {
      rootCached = buildLevelSource(root, schema.rootLevel, tree);
    }
    return rootCached;
  }

  return {
    rootSource,

    resolveChild(parentPath, parentRowKey, childLevelName) {
      const decomposition = decomposePath(parentPath);
      if (decomposition.rootLevelName !== schema.rootLevel) {
        throw new Error(
          `inMemoryGridDataSource: parentPath '${parentPath}' root segment '${decomposition.rootLevelName}' does not match schema.rootLevel '${schema.rootLevel}'`,
        );
      }
      const parentLevelName =
        decomposition.edges.at(-1)?.levelName ?? decomposition.rootLevelName;
      const parentSource =
        liveSources.get(parentPath) ??
        (parentPath === root ? rootSource() : undefined);
      if (!parentSource) {
        throw new Error(
          `inMemoryGridDataSource: parent level source '${parentPath}' has not been resolved`,
        );
      }
      const parentLevelArr = currentInMemorySourceNodes(parentSource);
      const parent = findByRowKey(
        parentLevelArr,
        parentRowKey,
        parentLevelName,
        schema,
      );
      const children = parent.children?.[childLevelName];
      const footerRows = parent.childFooterRows?.[childLevelName];
      const initialNodes: readonly TreeNode[] =
        children === undefined
          ? []
          : Array.isArray(children)
            ? children
            : [children];
      return buildLevelSource(
        childPath(parentPath, parentRowKey, childLevelName),
        childLevelName,
        initialNodes,
        footerRows,
      );
    },

    dispose() {
      liveSources.clear();
      rootCached = null;
    },
  };
}

function findByRowKey(
  arr: readonly TreeNode[],
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
  for (const node of arr) {
    if (node.rowKey === rowKey) return node;
  }
  throw new Error(
    `inMemoryGridDataSource: no node with rowKey '${rowKey}' in level '${levelName}'`,
  );
}
