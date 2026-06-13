import type { ProtoRow, RowPredicate } from "../types";

// `withFilter` is the only place in the grid that "filters." It takes a
// pre-compiled `RowPredicate` — never a grammar — because the grid has no
// filter grammar of its own. The predicate is produced upstream by the
// source's `compileFilter` (host code) from the host's `F` and arrives
// here through `snapshot.applyFilter`. The grid trusts it and calls it.
//
// Filtering is row-kind-aware. Non-data rows (brackets, footers, phantoms)
// represent structural roles, not user data, so they always survive. A
// row's rollup follows the row: if the data row is filtered out, its
// rollup is dropped too — otherwise an orphan rollup would render against
// a deleted parent.
//
// Identity-stable: returns the input array reference unchanged when no rows
// were dropped, so displayed-row identity preservation can reuse the previous
// render snapshot.
export function withFilter(
  rows: ProtoRow[],
  predicate: RowPredicate | undefined,
): ProtoRow[] {
  if (!predicate) return rows;

  const out: ProtoRow[] = [];
  let dropOwner: ProtoRow["source"] | null = null;
  let changed = false;
  for (const row of rows) {
    if (row.kind === "data") {
      if (predicate(row.columns)) {
        out.push(row);
        dropOwner = null;
      } else {
        dropOwner = row.source;
        changed = true;
      }
    } else if (
      row.kind === "rollup" &&
      dropOwner !== null &&
      row.source === dropOwner
    ) {
      changed = true;
      // skip rollup tied to a dropped data row
    } else {
      out.push(row);
      dropOwner = null;
    }
  }
  return changed ? out : rows;
}
