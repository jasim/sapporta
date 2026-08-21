// Reduction helpers for in-memory aggregators. Hosts assemble these into the
// `aggregator` callback they pass to `inMemoryLevelSource` — so the source
// stays agnostic of the specific aggregation, but the common cases (sum a
// column, average a column) don't ask each host to write its own loop.
//
// Inputs that aren't finite numbers are skipped silently. `avgBy` over an
// empty set or a set with no finite values returns `null` — the host
// decides how to render an undefined average; this helper does not invent
// `0` or `NaN`.

import type { ColId } from "../../types/identity";
import type { TreeNode } from "../../types/level-row";

function pickNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function sumBy(nodes: readonly TreeNode[], colId: ColId): number {
  let total = 0;
  for (const n of nodes) {
    const v = pickNumeric(n.columns[colId]);
    if (v !== null) total += v;
  }
  return total;
}

export function avgBy(nodes: readonly TreeNode[], colId: ColId): number | null {
  let total = 0;
  let count = 0;
  for (const n of nodes) {
    const v = pickNumeric(n.columns[colId]);
    if (v !== null) {
      total += v;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}
