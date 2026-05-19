import type { ProtoRow } from "../types";

// Insert a `rollup` row immediately after each `data` row that supplies
// `source.rollup`. The rollup row's identity is derived from the parent's
// rowKey (`<rowKey>:rollup`) so it is stable across reorders of the parent.
export function withRollup(rows: ProtoRow[]): ProtoRow[] {
  let dirty = false;
  const out: ProtoRow[] = [];
  for (const row of rows) {
    out.push(row);
    if (row.kind === "data" && row.source.rollup) {
      out.push({
        kind: "rollup",
        rowKey: `${row.rowKey}:rollup`,
        columns: row.source.rollup,
        source: row.source,
      });
      dirty = true;
    }
  }
  // Identity-preserving when nothing changed.
  return dirty ? out : rows;
}
