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
): RowComparator {
  const colIndex: Record<string, ColumnSchema> = {};
  for (const c of columns) colIndex[c.id] = c;
  // Each descriptor becomes the row fields its column orders by. A column
  // without a comparison, or one this level lacks, does not sort.
  const keyed: {
    descriptor: SortDescriptor;
    keys: readonly ColumnSortKey[];
  }[] = [];
  for (const descriptor of sort) {
    const column = colIndex[descriptor.colId];
    if (!column) continue;
    const keys =
      column.sortKeys ??
      (column.compare ? [{ field: column.id, compare: column.compare }] : []);
    if (keys.length > 0) keyed.push({ descriptor, keys });
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
