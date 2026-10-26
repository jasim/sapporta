// Pure row-comparator factory. Used by `withSort` for the proto-row sort and
// by `inMemoryLevelSource` for the TreeNode sort — keeping a single
// comparator means client-side and pipeline-side sorts cannot drift.

import type { ColId } from "../../types/identity";
import type { ColumnSchema, ColumnSortKey } from "../../types/schema";
import type { SortDescriptor } from "../types";

export type RowComparator = (
  a: Record<ColId, unknown>,
  b: Record<ColId, unknown>,
) => number;

export function makeRowComparator(
  sort: readonly SortDescriptor[],
  columns: readonly ColumnSchema[],
  label = "makeRowComparator",
): RowComparator {
  const colIndex: Record<string, ColumnSchema> = {};
  for (const c of columns) colIndex[c.id] = c;
  // Each descriptor becomes the row fields its column orders by. A descriptor
  // naming a column the level lacks, or a column with nothing to compare,
  // throws: skipping it would leave rows in an order that looks sorted but is
  // not.
  const keyed: {
    descriptor: SortDescriptor;
    keys: readonly ColumnSortKey[];
  }[] = [];
  for (const descriptor of sort) {
    const column = colIndex[descriptor.colId];
    if (!column) {
      throw new Error(
        `${label}: sort names column "${descriptor.colId}", which is not a column of the level (columns: ${columns.map((c) => c.id).join(", ")})`,
      );
    }
    const keys =
      column.sortKeys ??
      (column.compare ? [{ field: column.id, compare: column.compare }] : []);
    if (keys.length === 0) {
      throw new Error(
        `${label}: sort names column "${column.id}", which has no compare and no sortKeys`,
      );
    }
    keyed.push({ descriptor, keys });
  }

  return (a, b) => {
    for (const { descriptor, keys } of keyed) {
      for (const key of keys) {
        const cmp = key.compare(a[key.field], b[key.field]);
        if (cmp !== 0) return descriptor.direction === "asc" ? cmp : -cmp;
      }
    }
    return 0;
  };
}
