// Pure row-comparator factory. Used by `withSort` for the proto-row sort and
// by `inMemoryLevelSource` for the TreeNode sort — keeping a single
// comparator means client-side and pipeline-side sorts cannot drift.

import type { ColId } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
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
  const comparable = sort
    .map((descriptor) => {
      const column = colIndex[descriptor.colId];
      return column?.compare ? { descriptor, column } : null;
    })
    .filter(
      (
        item,
      ): item is {
        descriptor: SortDescriptor;
        column: ColumnSchema & {
          compare: NonNullable<ColumnSchema["compare"]>;
        };
      } => item !== null,
    );

  return (a, b) => {
    for (const { descriptor, column } of comparable) {
      const cmp = column.compare(a[descriptor.colId], b[descriptor.colId]);
      if (cmp !== 0) return descriptor.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}
