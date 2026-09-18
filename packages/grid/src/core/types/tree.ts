// Shared vocabulary for tree levels (`LevelSchema.tree`).
//
// The `withTree` stage builds a `TreeStructure` and reads a
// `TreeExpansionView`. The runtime stores the view, sources read parent keys,
// and displayed-row derivation carries the structure. These types and helpers
// are in the types layer so that each of those layers can import them.

import type { RowId, RowKey } from "./identity";
import type { LevelTreeConfig } from "./schema";

/**
 * Which tree rows are expanded. A row with children is expanded when
 * `defaultExpanded` and `toggled.has(rowId)` differ, so rows that arrive later
 * follow the default without anyone expanding them.
 */
export type TreeExpansionView = {
  readonly defaultExpanded: boolean;
  readonly toggled: ReadonlySet<RowId>;
};

/**
 * The whole tree of one level, including rows hidden under a collapsed
 * ancestor. The runtime reads it for parent and child lookups.
 */
export type TreeStructure = {
  /** Every tree row in depth-first display order, hidden rows included. */
  readonly order: readonly RowId[];
  /**
   * The parent of every tree row, `null` at top level. Each chain of parents
   * ends at `null`, because `withTree` cuts parent loops.
   */
  readonly parentById: ReadonlyMap<RowId, RowId | null>;
  /** Children in sibling order. Rows without children are absent. */
  readonly childrenById: ReadonlyMap<RowId, readonly RowId[]>;
  /** Rows cut out of a parent loop and shown at top level. */
  readonly loopRowIds: readonly RowId[];
};

/** Reads a parent-key value. `null`, `undefined`, and `""` mean top level. */
export function treeParentKey(value: unknown): RowKey | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function isTreeRowExpanded(
  expansion: TreeExpansionView,
  rowId: RowId,
): boolean {
  return expansion.defaultExpanded !== expansion.toggled.has(rowId);
}

/** The toggles of a view in which every row follows the default. */
export const NO_TREE_TOGGLES: ReadonlySet<RowId> = new Set();

/** The expansion view of a tree level before the user toggles any row. */
export function initialTreeExpansion(tree: LevelTreeConfig): TreeExpansionView {
  return Object.freeze({
    defaultExpanded: tree.defaultExpanded ?? true,
    toggled: NO_TREE_TOGGLES,
  });
}

/**
 * The ancestors of a row, nearest first. The walk needs no loop guard because
 * every chain of parents in a `TreeStructure` ends at `null`.
 */
export function treeAncestors(structure: TreeStructure, rowId: RowId): RowId[] {
  const ancestors: RowId[] = [];
  let current = structure.parentById.get(rowId) ?? null;
  while (current !== null) {
    ancestors.push(current);
    current = structure.parentById.get(current) ?? null;
  }
  return ancestors;
}
